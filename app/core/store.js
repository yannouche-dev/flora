// @ts-check
// Tiny observable store + a Lit reactive controller to re-render subscribers.

import { config } from '../config.js';

/**
 * @typedef {Record<'status' | 'family' | 'genus' | 'photo' | 'french', string[]>} Filters
 * @typedef {{ q: string, filters: Filters, sort: string }} Query
 * @typedef {{ type: 'family' | 'genus', name: string, count: number }} Suggestion
 * @typedef {object} Results
 * @property {number} total
 * @property {any[]} items
 * @property {Record<string, Record<string, number>>} facets   faceted counts per value
 * @property {Suggestion[]} suggestions
 * @property {number} fuzzy   number of typo-tolerant matches included
 * @property {string} sort    effective sort
 *
 * @typedef {object} AppState
 * @property {'loading' | 'ready' | 'error'} status
 * @property {string} [statusText]
 * @property {any} [meta]
 * @property {boolean} offline
 * @property {Query} query
 * @property {Results} results
 * @property {boolean} compact
 */

export class Store extends EventTarget {
  /** @param {AppState} initial */
  constructor(initial) {
    super();
    this.state = initial;
  }

  /** @param {Partial<AppState>} patch */
  set(patch) {
    this.state = { ...this.state, ...patch };
    this.dispatchEvent(new Event('change'));
  }
}

const readCompact = () => {
  try { return localStorage.getItem(config.storageKeys.compact) === '1'; } catch { return false; }
};

/** @type {Store} */
export const store = new Store({
  status: 'loading',
  offline: false,
  query: { q: '', filters: { status: [], family: [], genus: [], photo: [], french: [] }, sort: '' },
  results: { total: 0, items: [], facets: {}, suggestions: [], fuzzy: 0, sort: 'fr' },
  compact: readCompact()
});

/** @param {boolean} compact */
export function setCompact(compact) {
  try { localStorage.setItem(config.storageKeys.compact, compact ? '1' : '0'); } catch { /* not persisted */ }
  store.set({ compact });
}

/** Resolves once the local dataset is in IndexedDB (deep links on a first visit must wait for it). */
export function whenReady() {
  return new Promise(resolve => {
    if (store.state.status === 'ready') return resolve(undefined);
    const check = () => {
      if (store.state.status !== 'ready') return;
      store.removeEventListener('change', check);
      resolve(undefined);
    };
    store.addEventListener('change', check);
  });
}

/** Lit ReactiveController: `new StoreController(this)` re-renders the host on every store change. */
export class StoreController {
  /** @param {import('lit').ReactiveControllerHost} host */
  constructor(host) {
    this.host = host;
    this.onChange = () => host.requestUpdate();
    host.addController(this);
  }

  get state() { return store.state; }

  hostConnected() { store.addEventListener('change', this.onChange); }
  hostDisconnected() { store.removeEventListener('change', this.onChange); }
}
