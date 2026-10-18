// @ts-check
// A search: its query (text, filters, sort) and its results, the plants it is kept to. The app has one, its store's
// (Flore, the free layout's first group: APP below); a free layout's other groups each have their own (SearchChannel):
// two lists, two maps that do not follow each other on one screen. The search components (results bar, filters,
// list…) read and change the one they are given (their `channel`, none: the app's) through SearchController and the
// functions of core/query.js.

import { store, whenReady } from './store.js';
import { runSearch, searchIn, setSearchScope } from './search.js';

/**
 * @typedef {import('./store.js').Query} Query
 * @typedef {import('./search.js').ScopeExtra} ScopeExtra
 * @typedef {{ readonly query: Query, readonly results: any, setQuery(query: Query): void, run(): void,
 *   setScope(ids: number[] | null, extra?: ScopeExtra): void, addEventListener: EventTarget['addEventListener'], removeEventListener: EventTarget['removeEventListener'] }} Channel
 *   `setScope`: the plants it is kept to (null: the whole flora), with what comes with them (each one's observations)
 */

/** A query with nothing in it. @returns {Query} */
export const emptyQuery = () => ({ q: '', filters: { status: [], legal: [], family: [], genus: [], photo: [], french: [], mine: [] }, sort: '' });

/** The app's search: its store (store.js) and the worker's search on screen (search.js). @type {Channel} */
export const APP = {
  get query() { return store.state.query; },
  get results() { return store.state.results; },
  setQuery(query) { store.set({ query }); },
  run() { runSearch(); },
  setScope(ids, extra) { setSearchScope(ids, extra); },
  addEventListener: (type, fn) => store.addEventListener(type, fn),
  removeEventListener: (type, fn) => store.removeEventListener(type, fn)
};

/** A search of its own (a free layout's group b, c…): fires `change` when its query or its results change. */
export class SearchChannel extends EventTarget {
  constructor() {
    super();
    /** @type {Query} */ this.query = emptyQuery();
    this.results = { total: 0, items: [], facets: {}, suggestions: [], fuzzy: 0, sort: 'fr', counted: false };
    /** The plants it is kept to (a zone's), null: the whole flora, and what comes with them. @type {number[] | null} */ this.scope = null;
    /** @type {ScopeExtra} */ this.extra = {};
    this.ran = 0;
  }

  /** @param {Query} query */
  setQuery(query) { this.query = query; this.#changed(); }

  /** @param {number[] | null} ids @param {ScopeExtra} [extra] */
  setScope(ids, extra = {}) { this.scope = ids ? [...ids] : null; this.extra = ids ? extra : {}; }

  /** Its search run in the worker (once the flora is there), the answer of an older query dropped. */
  async run() {
    const run = ++this.ran;
    await whenReady();
    const found = await searchIn(this.query, this.scope, this.extra).catch(() => null);
    if (!found || run !== this.ran) return;
    this.results = found;
    this.#changed();
  }

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
