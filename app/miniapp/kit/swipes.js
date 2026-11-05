// @ts-check
// The swipe core of a deck of cards (kit/ma-deck.js), one for every deck that keeps its swipes: the activities around
// a place (kit/session.js: Rencontres, Cueillette prudente, Mosaïque) and a screen's `deck` cell (layout/cells.js) —
// not Flore's swipe deck (gf-flora.js: no match, no ↺) nor Faux amis (its own answers and score). What it keeps: the
// cards passed and matched (Cueillette prudente: its toxic look-alikes recognised, to avoid — never a match nor a
// favourite), each swipe one write to its host's store; ↺, the last swipes, each taking back its own heart's favourite;
// the favourite a heart adds, never one that is there (a heart never removes a favourite), and its taking back, one
// plant's after the other (a ↺ then a heart before the write: added again, after); the heart flying off the deck. The
// host gives where the swipes are kept (`store`), its favourites (`favourites`: an activity's carry its origin, a
// screen's none) and which cards are to avoid (`avoids`, required: no silent « never »). Pure: no DOM but EventTarget
// and timers, no network, no core/collections.js — tested under Node (tests/unit/swipes.test.mjs).

import { avoid, deckOf, swipe, unswipe } from './cards.js';

/**
 * @typedef {import('./cards.js').Card} Card
 * @typedef {import('./cards.js').Swipes} Swipes
 * @typedef {'match' | 'pass' | 'avoid'} Side
 * @typedef {{ id: number, liked: boolean, fav: boolean, was?: number | null }} Swiped a swipe of ↺'s history: `liked`, a
 *   match; `fav`, its heart asked for a favourite; `was` (Rencontres), the plant chosen before its heart chose this one
 * @typedef {{ read(): Swipes, write(patch: Record<string, unknown>): void }} SwipeStore where the swipes are kept
 *   (an activity's context, app.c / app.set; a screen's: memoryStore)
 * @typedef {{ has(id: number): boolean, add(plant: any): Promise<unknown>, forget(id: number, token: any): Promise<boolean> }} FavouritePolicy
 *   the favourites of the hearts: `add` resolves to a token (the entry added) or null (a favourite already, not
 *   written); `forget(id, token)` takes back what `add` gave — `forget(id, null)`, the policy's own fallback (an
 *   activity: by its origin; a screen: nothing)
 */

/** The decks whose swipe hint was shown (once while the app is open), by key (an activity's id). @type {Set<string>} */
const hinted = new Set();

/** The deck's swipe hint: not shown yet for `key` (and now it is). @param {string} key */
export function hintOnce(key) {
  if (hinted.has(key)) return false;
  hinted.add(key);
  return true;
}

/** The swipe hint shown again for `key` (« Recommencer »). @param {string} key */
export function forgetHint(key) { hinted.delete(key); }

/**
 * Swipes kept in memory (a screen's deck: forgotten when it goes), from `init`. A store without `avoided` never gets
 * the key. @param {Swipes} [init] @returns {SwipeStore}
 */
export function memoryStore(init = { matches: [], passed: [] }) {
  let s = init;
  return { read: () => s, write: patch => { s = /** @type {Swipes} */ ({ ...s, ...patch }); } };
}

/** A heart flying off the deck lasts this long (ms) after the last one. */
const BURST_MS = 900;

/** The swipes of a deck. Fires `change` once per operation that changes what it shows, at its end. */
export class SwipeCore extends EventTarget {
  /** @type {SwipeStore} */ #store;
  /** @type {FavouritePolicy} */ #favourites;
  /** @type {(card: Card) => boolean} */ #avoids;
  /** Each heart's write (its history entry → the policy's token, or null): each ↺ takes back its own. @type {WeakMap<Swiped, Promise<unknown>>} */
  #tokens = new WeakMap();
  /** By plant id: the last of its favourite operations, each run after the one before. @type {Map<number, Promise<unknown>>} */
  #chain = new Map();
  /** By plant id: its forgets not done yet (a heart meanwhile adds again, after them). @type {Map<number, number>} */
  #forgetting = new Map();
  /** @type {ReturnType<typeof setTimeout> | undefined} */ #burstTimer;

  /**
   * @param {{ store: SwipeStore, favourites: FavouritePolicy, avoids: (card: Card) => boolean }} o `avoids`: the cards
   *   whose right is « recognised, to avoid » — required (a host without a toxic side says so: `() => false`)
   */
  constructor({ store, favourites, avoids }) {
    super();
    if (typeof avoids !== 'function') throw new TypeError('SwipeCore: avoids (card => boolean) is required');
    this.#store = store;
    this.#favourites = favourites;
    this.#avoids = avoids;
    /** ↺: the last swipes (30), the last one last. @type {Swiped[]} */
    this.history = [];
    /** Hearts flying off the deck (a match after the first): back to 0 a moment after the last. */
    this.burst = 0;
  }

  #changed() { this.dispatchEvent(new Event('change')); }

  /** The swipes as kept. @returns {Swipes} */
  get swipes() { return this.#store.read(); }

  /**
   * The cards not swiped yet, in their order — `top` first when it is among them (a screen's current plant).
   * @param {Card[]} cards @param {number | null} [top]
   */
  deck(cards, top = null) {
    const left = deckOf(cards, this.swipes);
    const i = top == null ? -1 : left.findIndex(c => c.plant.id === top);
    return i > 0 ? [left[i], ...left.slice(0, i), ...left.slice(i + 1)] : left;
  }

  /** The cards matched. @param {Card[]} cards */
  matchCards(cards) {
    const ids = this.swipes.matches;
    return cards.filter(c => ids.includes(c.plant.id));
  }

  /** The cards recognised to avoid (Cueillette prudente; never among the matches). @param {Card[]} cards */
  avoidCards(cards) {
    const ids = this.swipes.avoided ?? [];
    return cards.filter(c => ids.includes(c.plant.id));
  }

  /** Is this plant swiped already (matched, passed or recognised to avoid)? @param {number} id */
  decided(id) {
    const s = this.swipes;
    return s.matches.includes(id) || s.passed.includes(id) || Boolean(s.avoided?.includes(id));
  }

  /** Which side a swipe takes: left, passed; right, a match — or, a card to avoid (avoids), recognised. @param {Card} card @param {boolean} liked @returns {Side} */
  sideOf(card, liked) { return !liked ? 'pass' : this.#avoids(card) ? 'avoid' : 'match'; }

  /**
   * A card swiped: one write to the store, one entry for ↺ — a match's heart asks for a favourite unless the plant is
   * one (or while one of its forgets is pending: added again after it). A card to avoid swiped right is recognised:
   * never a match nor a favourite, whatever asked it, and nothing of `also` merged into it. A card decided already is
   * ignored (null: a second click while it flies). `also`, a match's only: what its host adds to the entry (`was`) and
   * to the write (Rencontres: the plant chosen) — one write still.
   * @param {Card} card @param {boolean} liked
   * @param {{ entry?: { was?: number | null }, write?: Record<string, unknown> }} [also]
   * @returns {{ side: Side, fav: boolean, entry: Swiped } | null}
   */
  decide(card, liked, also = {}) {
    const id = card.plant.id;
    if (this.decided(id)) return null;
    const side = this.sideOf(card, liked);
    const match = side === 'match';
    const fav = match && (this.#forgetting.has(id) || !this.#favourites.has(id));
    /** @type {Swiped} */
    const entry = { id, liked: match, fav, ...(match ? also.entry : {}) };
    this.history = [...this.history, entry].slice(-30);
    const s = this.swipes;
    this.#store.write(side === 'avoid' ? avoid(s, id) : { ...swipe(s, id, match), ...(match ? also.write : {}) });
    if (fav) this.#tokens.set(entry, this.#run(id, () => this.#favourites.add(card.plant)));
    this.#changed();
    return { side, fav, entry };
  }

  /**
   * ↺: the last swipe undone, its card back in the deck — a heart's favourite taken back, once written (the policy
   * says what is taken back). `back`: what the host writes with it, given the swipe undone (read before the write).
   * @param {(last: Swiped) => Record<string, unknown>} [back] @returns {Swiped | null} the swipe undone
   */
  undo(back) {
    const last = this.history.at(-1);
    if (!last) return null;
    this.history = this.history.slice(0, -1);
    this.#store.write({ ...unswipe(this.swipes, last.id), ...back?.(last) });
    if (last.fav) {
      const token = this.#tokens.get(last);
      this.#tokens.delete(last);
      this.#forget(last.id, async () => { const t = await token; if (t) await this.#favourites.forget(last.id, t); });
    }
    this.#changed();
    return last;
  }

  /**
   * A match taken back (« Retirer »): out of the matches, and its favourite taken back, after its heart's write —
   * that of its last heart, else the policy's own fallback. Resolves whether the plant is still a favourite.
   * @param {Card} card @returns {Promise<boolean>}
   */
  async unmatch(card) {
    const id = card.plant.id;
    this.#store.write(unswipe(this.swipes, id));
    const hearts = this.history.filter(e => e.id === id && e.fav);
    const last = hearts[hearts.length - 1];
    const token = last ? this.#tokens.get(last) ?? null : null;
    if (last) this.#tokens.delete(last);
    this.#changed();
    await this.#forget(id, async () => this.#favourites.forget(id, token ? await token : null));
    return this.#favourites.has(id);
  }

  /** A card back in the deck (a plant touched elsewhere, brought on top); ↺'s history left alone. @param {number} id */
  restore(id) {
    this.#store.write(unswipe(this.swipes, id));
    this.#changed();
  }

  /** The cards passed back in the deck (« Revoir les plantes passées »), and those recognised to avoid where they are kept. */
  reset() {
    this.#store.write({ passed: [], ...('avoided' in this.swipes ? { avoided: [] } : {}) });
    this.#changed();
  }

  /**
   * The favourite of a plant taken back by the policy's own fallback (forget(id, null): an activity's, by its origin),
   * after its other favourite operations. Resolves whether one was taken back. @param {number} id @returns {Promise<boolean>}
   */
  unfavourite(id) {
    return this.#forget(id, () => this.#favourites.forget(id, null)).then(Boolean);
  }

  /** A match after the first: a heart flies off the deck, until a moment after the last one. */
  heart() {
    const n = ++this.burst;
    clearTimeout(this.#burstTimer);
    this.#burstTimer = setTimeout(() => { if (this.burst === n) { this.burst = 0; this.#changed(); } }, BURST_MS);
    this.#changed();
  }

  /** Its timer stopped (its deck gone). A favourite's write on its way cannot be cancelled: it ends. */
  dispose() {
    clearTimeout(this.#burstTimer);
    this.burst = 0;
  }

  /**
   * `fn` run after the plant's favourite operations before it (its errors swallowed: null).
   * @template T @param {number} id @param {() => T | Promise<T>} fn @returns {Promise<T | null>}
   */
  #run(id, fn) {
    const tail = (this.#chain.get(id) ?? Promise.resolve()).then(() => fn()).catch(() => null);
    this.#chain.set(id, tail);
    tail.then(() => { if (this.#chain.get(id) === tail) this.#chain.delete(id); });
    return tail;
  }

  /** A forget of the plant's favourite, counted as pending until it is done. @template T @param {number} id @param {() => Promise<T>} fn */
  #forget(id, fn) {
    this.#forgetting.set(id, (this.#forgetting.get(id) ?? 0) + 1);
    return this.#run(id, async () => {
      try { return await fn(); } finally {
        const n = (this.#forgetting.get(id) ?? 1) - 1;
        if (n > 0) this.#forgetting.set(id, n); else this.#forgetting.delete(id);
      }
    });
  }
}
