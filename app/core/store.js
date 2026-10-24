// @ts-check
// Tiny observable store + a Lit reactive controller to re-render subscribers.

import { config } from '../config.js';
import { moduleEvents, modulesState } from './modules.js';
import { baseOf, isMode, modeEvents, modeList } from './modes.js';
import { treeFromPlaces } from './pane-tree.js';
import { readJSON, readText, writeText } from './prefs.js';
import { quotaEvents } from './quota.js';
import { onStorage } from './sync.js';

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
 * @property {boolean} [counted]   each plant's observations given (a free layout's zone): the sort « Plus observées »
 * @property {number[] | null} [inZone]   kept to what a map shows of the zone: the zone's plants all the same, by id, in order
 *
 * @typedef {object} AppState
 * @property {'loading' | 'ready' | 'error'} status
 * @property {string} [statusText]
 * @property {any} [meta]
 * @property {boolean} offline
 * @property {boolean} [floraStoring]  a first launch: the search runs on the flora while its records are still being stored (not offline yet)
 * @property {boolean} [datasetDeferred]  a new flora was announced but could not be downloaded: the local copy stays, until the next launch
 * @property {boolean} [updateReady]  a new version of the app is installed: reloading shows it
 * @property {boolean} [storageFull]  a write was refused for lack of room (QuotaExceededError): a banner says what to do
 * @property {StorageProblem} [storageError]  the launch failed because IndexedDB did not open (core/db.js StorageError): why, and
 *   what the browser said — the banner says what to try (components/gf-storage-error.js)
 * @property {RestoreOutcome} [restore]  after « Réparer le stockage » (or a base the browser emptied: reason 'lost'), the
 *   backup copy put back (done: what it held), or not (error: what the browser said; tried again at the next launch)
 * @property {Query} query
 * @property {Results} results
 * @property {boolean} compact
 * @property {Set<number>} favorites    plant ids in the ♥ collection
 * @property {Map<number, string>} placed  plant id → one of my places where it is noted
 * @property {Mode} mode                  display mode of the app: épuré (actions, big photos), standard, scientifique
 * @property {Mode | null} gridView      results grid override of the mode (null: follow the mode)
 * @property {SheetLayout} sheetLayout  the plant sheet as arranged in « Mode King » (see sheet-blocks.js)
 * @property {import('./context.js').Context} [context]  where the user is in each part (see context.js)
 * @property {Record<import('./modules.js').ModuleKey, boolean>} modules  online services used on this device (Réglages › Modules)
 * @property {import('./modes.js').ModeInfo[]} modes  the display modes: the app's three and the ones made from them
 * @property {boolean} kingMode         « Mode King »: the plant sheet blocks can be moved, folded and revived (left with the crown)
 * @property {boolean} harvestMode      "Mode cueillette": harvest log, quality, seasons (look-alike warnings show without it)
 * @property {ShowSteps} showSteps       mini-apps: their steps bar shown until one is finished once (auto), always (on), never (off)
 * @property {import('./collections.js').CollectionSummary[]} collections
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

/** @typedef {import('./modes.js').Mode} Mode */
/** @typedef {{ kind: import('./db.js').OpenProblem, name: string, message: string }} StorageProblem */
/**
 * @typedef {{ done: boolean, reason: import('./collections.js').RestoreReason, contents?: import('./collections.js').BackupSummary | null,
 *   error?: { name: string, message: string }, closed?: boolean }} RestoreOutcome  `closed`: its banner dismissed
 */
/** @typedef {'auto' | 'on' | 'off'} ShowSteps */

/** @param {any} v @returns {Mode | null} */
const asMode = v => isMode(v) ? v : v === 'illustrated' ? 'epure' : null;

/** @param {string} key */
const readMode = key => asMode(readText(key));

/**
 * The plant sheet layout: per view, block order and folded blocks, sub-block order and hidden sub-blocks;
 * block titles changed by hand; the note blocks created. Only what differs from the defaults is kept.
 * @typedef {{ order: Partial<Record<Mode, string[]>>, hidden: Partial<Record<Mode, string[]>>,
 *   subOrder: Partial<Record<Mode, Record<string, string[]>>>, subHidden: Partial<Record<Mode, Record<string, string[]>>>,
 *   styles: Partial<Record<Mode, Record<string, string>>>, titleShown: Partial<Record<Mode, Record<string, boolean>>>,
 *   hideEmpty: Partial<Record<Mode, Record<string, boolean>>>, tree: Partial<Record<Mode, import('./pane-tree.js').PaneNode>>,
 *   mapBlocks: { id: string, title: string }[], maps: Record<string, any>,
 *   titles: Record<string, string>, notes: { id: string, title: string }[] }} SheetLayout
 */

/** @returns {SheetLayout} */
export const emptyLayout = () => ({ order: {}, hidden: {}, subOrder: {}, subHidden: {}, styles: {}, titleShown: {}, hideEmpty: {}, tree: {}, titles: {}, notes: [], mapBlocks: [], maps: {} });

/** @param {string} key */
const readObject = key => {
  const value = readJSON(key, null);
  return value && typeof value === 'object' ? value : null;
};

/**
 * Layouts of earlier versions: blocks « pinned » (one dock, on one side) and « en volet » become places —
 * the dock's side ('auto' was on the right) and size go to that edge. Nothing else changes.
 * @param {any} l @returns {any}
 */
export function migratePlaces(l) {
  if (!l || (!l.pinned && !l.paned && !l.dock)) return l;
  const place = { ...(l.place || {}) }, edges = { ...(l.edges || {}) };
  const views = new Set([...Object.keys(l.pinned || {}), ...Object.keys(l.paned || {}), ...Object.keys(l.dock || {})]);
  for (const view of views) {
    const dock = l.dock?.[view] || {};
    const edge = ['left', 'right', 'top', 'bottom'].includes(dock.side) ? dock.side : 'right';
    const mine = { ...(place[view] || {}) };
    for (const k of l.pinned?.[view] || []) mine[k] ??= edge;
    for (const k of l.paned?.[view] || []) mine[k] ??= 'beside';
    if (Object.keys(mine).length) place[view] = mine;
    if ((l.pinned?.[view] || []).length && (dock.size || dock.folded)) {
      edges[view] = { ...(edges[view] || {}), [edge]: { size: ['s', 'm', 'l'].includes(dock.size) ? dock.size : 'm', folded: dock.folded === true } };
    }
  }
  const { pinned, paned, dock, ...rest } = l;
  return { ...rest, place, edges };
}

/**
 * Layouts of the previous version: blocks stuck to an edge of the plant pane (`place`, `edges`) become the tree
 * of panes (pane-tree.js), mode by mode. Nothing else changes.
 * @param {any} l @returns {any}
 */
export function migrateTree(l) {
  if (!l || (!l.place && !l.edges)) return l;
  const tree = { ...(l.tree || {}) };
  for (const view of new Set([...Object.keys(l.place || {}), ...Object.keys(l.edges || {})])) {
    if (tree[view]) continue;
    const t = treeFromPlaces(l.place?.[view] || {}, l.edges?.[view] || {}, l.order?.[view] || []);
    if (t) tree[view] = t;
  }
  const { place, edges, ...rest } = l;
  return { ...rest, tree };
}

/** The saved layout, or the one of earlier versions (block order and folded blocks only). @returns {SheetLayout} */
const readLayout = () => {
  const saved = readObject(config.storageKeys.sheetLayout);
  if (saved) return { ...emptyLayout(), ...migrateTree(migratePlaces(saved)) };
  return { ...emptyLayout(), order: readObject(config.storageKeys.sheetBlocks) || {}, hidden: readObject(config.storageKeys.sheetHidden) || {} };
};

const initialMode = readMode(config.storageKeys.mode) || 'standard';
/** An override equal to the mode is no override. @param {string} key */
const readOverride = key => { const v = readMode(key); return v === initialMode ? null : v; };

/** @type {Store} */
export const store = new Store({
  status: 'loading',
  offline: false,
  query: { q: '', filters: { status: [], legal: [], family: [], genus: [], photo: [], french: [], mine: [] }, sort: '' },
  results: { total: 0, items: [], facets: {}, suggestions: [], fuzzy: 0, sort: 'fr' },
  compact: readText(config.storageKeys.compact) === '1',
  favorites: new Set(),
  placed: new Map(),
  mode: initialMode,
  gridView: readOverride(config.storageKeys.gridView),
  sheetLayout: readLayout(),
  modules: modulesState(),
  modes: modeList(),
  collections: [],
  kingMode: readText(config.storageKeys.kingMode) === '1',
  harvestMode: readHarvestMode() ?? false,
  showSteps: readShowSteps()
});

moduleEvents.addEventListener('change', () => store.set({ modules: modulesState() }));
// A mode made or deleted: the switches list it; a deleted one in use gives way to its model.
modeEvents.addEventListener('change', () => {
  const { mode, gridView } = store.state;
  const fallback = (/** @type {Mode} */ m) => isMode(m) ? m : 'standard';
  if (!isMode(mode)) setMode(fallback(baseOf(mode)));
  if (gridView && !isMode(gridView)) setGridView(null);
  store.set({ modes: modeList() });
});
// Storage full: said once, in a banner (gf-app), until closed.
quotaEvents.addEventListener('full', () => store.set({ storageFull: true }));
// The layout arranged in another tab: this one shows it too (and its next change starts from it).
onStorage(config.storageKeys.sheetLayout, () => store.set({ sheetLayout: readLayout() }));

/** Stored choice, or null when the user never chose (« auto »: it follows the harvests on the device, followHarvests). */
function readHarvestMode() {
  const value = readText(config.storageKeys.harvestMode);
  return value === null ? null : value === '1';
}

/** Chosen during this visit (its write may have been refused: storage full or off — it holds for the visit all the same). */
let chosenNow = false;

/** The user's own choice (Réglages, a button of the guided discovery's end): kept, never decided again by the app. */
export const harvestModeChosen = () => chosenNow || readHarvestMode() !== null;

/** The user's choice, kept (only a button that says so calls it). @param {boolean} on */
export function setHarvestMode(on) {
  chosenNow = true;
  writeText(config.storageKeys.harvestMode, on ? '1' : '0');
  store.set({ harvestMode: on });
}

/** « Afficher les étapes » of the mini-apps: 'auto' unless chosen. @returns {ShowSteps} */
function readShowSteps() {
  const value = readText(config.storageKeys.showSteps);
  return value === 'on' || value === 'off' ? value : 'auto';
}

/** @param {ShowSteps} value */
export function setShowSteps(value) {
  writeText(config.storageKeys.showSteps, value === 'auto' ? null : value);
  store.set({ showSteps: value });
}

/** Enter or leave « Mode King » (editing the plant sheet blocks); kept until left. @param {boolean} on */
export function setKingMode(on) {
  writeText(config.storageKeys.kingMode, on ? '1' : null);
  store.set({ kingMode: on });
}

/**
 * « Auto » (never chosen): off at start, on as soon as the device holds harvests (a place's journal: an import, a
 * transfer link, the backup copy put back) — followed as they arrive (main.js), never written: a choice stays. Never
 * turned off during a visit: the last harvest deleted leaves the journal where it is (to note another one); the next
 * start finds none. @param {boolean} hasHarvests
 */
export function followHarvests(hasHarvests) {
  if (hasHarvests && !harvestModeChosen() && !store.state.harvestMode) store.set({ harvestMode: true });
}

/** @param {boolean} compact */
export function setCompact(compact) {
  writeText(config.storageKeys.compact, compact ? '1' : '0');
  store.set({ compact });
}

/** App-wide mode: applies everywhere, so it clears the grid's override. @param {Mode} mode */
export function setMode(mode) {
  writeText(config.storageKeys.mode, mode);
  writeText(config.storageKeys.gridView, null);
  store.set({ mode, gridView: null });
}

/** Results grid override; null (or the mode itself) follows the mode. @param {Mode | null} view */
export function setGridView(view) {
  const gridView = view === store.state.mode ? null : view;
  writeText(config.storageKeys.gridView, gridView);
  store.set({ gridView });
}

/** @param {AppState} state @returns {Mode} */
export const gridViewOf = state => state.gridView ?? state.mode;

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
