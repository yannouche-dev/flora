// @ts-check
// Tiny observable store + a Lit reactive controller to re-render subscribers.

import { config } from '../config.js';

/**
 * @typedef {Record<'status' | 'family' | 'genus' | 'photo' | 'french' | 'mine', string[]>} Filters
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
 * @property {Set<number>} favorites    plant ids in the ♥ collection
 * @property {boolean} harvestMode      "Mode cueillette": harvest log, seasons, look-alike warnings
 * @property {{ id: string, name: string, kind: string, count: number }[]} collections
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
  query: { q: '', filters: { status: [], family: [], genus: [], photo: [], french: [], mine: [] }, sort: '' },
  results: { total: 0, items: [], facets: {}, suggestions: [], fuzzy: 0, sort: 'fr' },
  compact: readCompact(),
  favorites: new Set(),
  collections: [],
  harvestMode: readHarvestMode() ?? false
});

/** Stored choice, or null when the user never chose (decided at startup from existing harvests). */
function readHarvestMode() {
  try {
    const value = localStorage.getItem(config.storageKeys.harvestMode);
    return value === null ? null : value === '1';
  } catch { return null; }
}

/** @param {boolean} on */
export function setHarvestMode(on) {
  try { localStorage.setItem(config.storageKeys.harvestMode, on ? '1' : '0'); } catch { /* not persisted */ }
  store.set({ harvestMode: on });
}

/** First launch with this setting: turn harvest mode on if the device already holds harvests. */
export function initHarvestMode(/** @type {boolean} */ hasHarvests) {
  if (readHarvestMode() === null) setHarvestMode(hasHarvests);
}

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
