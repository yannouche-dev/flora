// @ts-check
// Tiny observable store + a Lit reactive controller to re-render subscribers.

import { config } from '../config.js';
import { moduleEvents, modulesState, useModeSource } from './modules.js';

/**
 * @typedef {Record<'status' | 'legal' | 'family' | 'genus' | 'photo' | 'french' | 'mine', string[]>} Filters
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
 * @property {boolean} [updateReady]  a new version of the app is installed: reloading shows it
 * @property {Query} query
 * @property {Results} results
 * @property {boolean} compact
 * @property {Set<number>} favorites    plant ids in the ♥ collection
 * @property {Map<number, string>} placed  plant id → one of my places where it is noted
 * @property {Mode} mode                  display mode of the app: épuré (actions, big photos), standard, scientifique
 * @property {Mode | null} gridView      results grid override of the mode (null: follow the mode)
 * @property {Mode | null} plantView     plant sheet override of the mode (null: follow the mode)
 * @property {Partial<Record<Mode, string[]>>} sheetBlocks  order of the plant sheet blocks, per view (only the views reordered by hand)
 * @property {Partial<Record<Mode, string[]>>} sheetHidden  plant sheet blocks folded away, per view (blocks of a module follow the module instead)
 * @property {string | null} target       collection or place the Épuré plant sheet adds to in one tap (last used)
 * @property {Record<import('./modules.js').ModuleKey, Record<Mode, boolean>>} modules  online services used in each mode (Réglages › Modules)
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

/** @typedef {'epure' | 'standard' | 'scientific'} Mode */
export const MODES = /** @type {const} */ (['epure', 'standard', 'scientific']);
export const MODE_LABELS = { epure: 'Épuré', standard: 'Standard', scientific: 'Scientifique' };

/** @param {any} v @returns {Mode | null} */
const asMode = v => MODES.includes(v) ? v : v === 'illustrated' ? 'epure' : null;

/** @param {string} key */
const readMode = key => {
  try { return asMode(localStorage.getItem(key)); } catch { return null; }
};

/** @param {string} key @param {string | null} value */
const writeKey = (key, value) => {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* not persisted */ }
};

const readCompact = () => {
  try { return localStorage.getItem(config.storageKeys.compact) === '1'; } catch { return false; }
};

/** @param {string} key @returns {Partial<Record<Mode, string[]>>} */
const readPerView = key => {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch { return {}; }
};
const readTarget = () => { try { return localStorage.getItem(config.storageKeys.target); } catch { return null; } };

const initialMode = readMode(config.storageKeys.mode) || 'standard';
/** An override equal to the mode is no override. @param {string} key */
const readOverride = key => { const v = readMode(key); return v === initialMode ? null : v; };

/** @type {Store} */
export const store = new Store({
  status: 'loading',
  offline: false,
  query: { q: '', filters: { status: [], legal: [], family: [], genus: [], photo: [], french: [], mine: [] }, sort: '' },
  results: { total: 0, items: [], facets: {}, suggestions: [], fuzzy: 0, sort: 'fr' },
  compact: readCompact(),
  favorites: new Set(),
  placed: new Map(),
  mode: initialMode,
  gridView: readOverride(config.storageKeys.gridView),
  plantView: readOverride(config.storageKeys.plantView),
  sheetBlocks: readPerView(config.storageKeys.sheetBlocks),
  sheetHidden: readPerView(config.storageKeys.sheetHidden),
  target: readTarget(),
  modules: modulesState(),
  collections: [],
  harvestMode: readHarvestMode() ?? false
});

moduleEvents.addEventListener('change', () => store.set({ modules: modulesState() }));
// Modules asked without a mode follow the app mode (maps, Autour, lists).
useModeSource(() => store.state.mode);

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

/** App-wide mode: applies everywhere, so it clears the grid and plant sheet overrides. @param {Mode} mode */
export function setMode(mode) {
  writeKey(config.storageKeys.mode, mode);
  writeKey(config.storageKeys.gridView, null);
  writeKey(config.storageKeys.plantView, null);
  store.set({ mode, gridView: null, plantView: null });
  // Maps, Autour and thumbnails follow the app mode's modules.
  moduleEvents.dispatchEvent(new CustomEvent('change', { detail: { mode } }));
}

/** Results grid override; null (or the mode itself) follows the mode. @param {Mode | null} view */
export function setGridView(view) {
  const gridView = view === store.state.mode ? null : view;
  writeKey(config.storageKeys.gridView, gridView);
  store.set({ gridView });
}

/** Plant sheet override; null (or the mode itself) follows the mode. @param {Mode | null} view */
export function setPlantView(view) {
  const plantView = view === store.state.mode ? null : view;
  writeKey(config.storageKeys.plantView, plantView);
  store.set({ plantView });
}

/** The one-tap target of the Épuré plant sheet: set when chosen there, or when a plant is added to a collection. @param {string | null} target */
export function setTarget(target) {
  writeKey(config.storageKeys.target, target);
  if (target !== store.state.target) store.set({ target });
}

/** @param {AppState} state @returns {Mode} */
export const gridViewOf = state => state.gridView ?? state.mode;
/** @param {AppState} state @returns {Mode} */
export const plantViewOf = state => state.plantView ?? state.mode;

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
