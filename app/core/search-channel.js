// @ts-check
// A search: its query (text, filters, sort) and its results — a screen's, kept to the plants of its zone. The app has
// one, its store's (Flore: APP below); each group of a screen of one's own has its own (SearchChannel): two lists, two
// maps that do not follow each other, and never Flore's. The search components (results bar, filters, list…) read and
// change the one they are given (their `channel`, none: the app's) through SearchController and the functions of
// core/query.js.

import { store, whenReady } from './store.js';
import { runSearch, searchIn } from './search.js';

/**
 * @typedef {import('./store.js').Query} Query
 * @typedef {import('./search.js').ScopeExtra} ScopeExtra
 * @typedef {{ readonly query: Query, readonly results: any, readonly answered?: boolean, readonly pending?: boolean, setQuery(query: Query): void, run(): void,
 *   addEventListener: EventTarget['addEventListener'], removeEventListener: EventTarget['removeEventListener'] }} Channel
 *   `answered`: false while its results are no answer yet (a search of its own, SearchChannel); none: always one (APP).
 *   `pending`: a new answer asked and not come yet (another text, filters, sort, plants kept to): its results are the
 *   answer before (SearchChannel); none: never said (APP).
 */

/** A query with nothing in it. @returns {Query} */
export const emptyQuery = () => ({ q: '', filters: { status: [], legal: [], family: [], genus: [], photo: [], french: [], mine: [] }, sort: '' });

/** Results with nothing in them: no answer yet. */
const noResults = () => ({ total: 0, items: [], facets: {}, suggestions: [], fuzzy: 0, sort: 'fr', counted: false, inZone: null });

/** The app's search, Flore's: its store (store.js) and the worker's search over the whole flora (search.js). @type {Channel} */
export const APP = {
  get query() { return store.state.query; },
  get results() { return store.state.results; },
  setQuery(query) { store.set({ query }); },
  run() { runSearch(); },
  addEventListener: (type, fn) => store.addEventListener(type, fn),
  removeEventListener: (type, fn) => store.removeEventListener(type, fn)
};

/** A search of its own (each group of a screen of one's own: a, b, c): fires `change` when its query or its results change. */
export class SearchChannel extends EventTarget {
  constructor() {
    super();
    this.results = noResults();
    /** The plants it is kept to (a zone's), null: the whole flora, and what comes with them. @type {number[] | null} */ this.scope = null;
    /** @type {ScopeExtra} */ this.extra = {};
    this.ran = 0;
    /** Its results are an answer (one published): until then « nothing found » is never said. */
    this.answered = false;
  }

  /** @type {Query} */ #query = emptyQuery();
  /** What it was asked (each query, each scope set) and what its results answer: apart, a new answer is pending. */
  #asked = 0;
  #answers = 0;
  /** What each answer fetched was asked for (fetch, then publish). @type {WeakMap<object, number>} */
  #askedOf = new WeakMap();

  /** Its query (text, filters, sort): set — here, or from the address —, a new answer is pending until published. */
  get query() { return this.#query; }
  set query(query) { this.#query = query; this.#asked++; }

  /** @param {Query} query */
  setQuery(query) { this.query = query; this.#changed(); }

  /**
   * The plants it is kept to (null: the whole flora), with what comes with them (each one's observations, those a map
   * shows): its next run follows. @param {number[] | null} ids @param {ScopeExtra} [extra]
   */
  setScope(ids, extra = {}) { this.scope = ids ? [...ids] : null; this.extra = ids ? extra : {}; this.#asked++; }

  /**
   * A new answer asked and not come yet (another text, filters, sort — typed and still resting too —, other plants
   * kept to): its results are the answer before — « nothing found » is not said of them.
   */
  get pending() { return this.#answers !== this.#asked; }

  /** Its search run in the worker (once the flora is there), published; an older run's answer dropped. @returns {Promise<void>} */
  async run() { const found = await this.fetch(); if (found) this.publish(found); }

  /** Its search run, not published: the answer, or null (a newer run started meanwhile, or it failed — then nothing pending). */
  async fetch() {
    const run = ++this.ran, asked = this.#asked;
    await whenReady();
    const found = await searchIn(this.query, this.scope, this.extra).catch(() => null);
    if (run !== this.ran) return null;
    if (!found) { this.#answers = asked; return null; }
    this.#askedOf.set(found, asked);
    return found;
  }

  /** An answer published: its results, answered (what it was asked for, no longer pending), `change`. @param {any} found */
  publish(found) { this.results = found; this.answered = true; this.#answers = this.#askedOf.get(found) ?? this.#asked; this.#changed(); }

  /**
   * Its answer forgotten, no answer yet (another screen's search: its plants, its count, nothing found, never said for
   * this one's before it answers); its scope kept, no `change` (its next run publishes).
   */
  forget() { this.results = noResults(); this.answered = false; }

  #changed() { this.dispatchEvent(new Event('change')); }
}

/**
 * A search component's state: the app's (store.js), its query and results those of the channel its host is given
 * (`channel`; none: the app's). Draws its host again on each change of either.
 */
export class SearchController {
  /** @param {import('lit').ReactiveControllerHost & { channel?: Channel | null }} host */
  constructor(host) {
    this.host = host;
    this.onChange = () => host.requestUpdate();
    /** @type {Channel | null} */ this.watched = null;
    host.addController(this);
  }

  /** The channel the host reads: its own, else the app's. */
  get channel() { return this.host.channel ?? APP; }

  /** Whether its results are an answer: a search of its own once it answered (until then « nothing found » is never said); the app's, always. */
  get answered() { return this.channel.answered !== false; }

  /** Whether a new answer of a search of its own is coming (its results the one before: « nothing found » held back); the app's, never. */
  get pending() { return this.channel.pending === true; }

  /** The app's state, with the channel's query and results. */
  get state() {
    const ch = this.host.channel;
    return ch && ch !== APP ? { ...store.state, query: ch.query, results: ch.results } : store.state;
  }

  hostConnected() { store.addEventListener('change', this.onChange); this.#watch(); }
  hostUpdate() { this.#watch(); }
  hostDisconnected() {
    store.removeEventListener('change', this.onChange);
    this.watched?.removeEventListener('change', this.onChange);
    this.watched = null;
  }

  /** Its host's channel followed (given after it was made, changed). */
  #watch() {
    const ch = this.host.channel && this.host.channel !== APP ? this.host.channel : null;
    if (ch === this.watched) return;
    this.watched?.removeEventListener('change', this.onChange);
    this.watched = ch;
    ch?.addEventListener('change', this.onChange);
  }
}
