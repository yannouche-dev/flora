// @ts-check
// The plant sheet is made of titled blocks below its header, the same ones in every display mode (each mode
// shows them its own way: compact in Épuré, complete in Scientifique). Each mode has its own block order,
// rearranged by dragging a block's title, and its own folded blocks. Folding a block that shows a service is
// switching that module off for the mode (Réglages › Modules), and the other way round.

import { config } from '../config.js';
import { MODULES, moduleOn, setModule } from './modules.js';
import { store } from './store.js';

/** @typedef {import('./modules.js').Mode} Mode */
/** @typedef {import('./modules.js').ModuleKey} ModuleKey */
/** @typedef {{ key: string, title: string, module?: ModuleKey }} SheetBlock */

/** Every block of the sheet. @type {SheetBlock[]} */
export const BLOCKS = [
  { key: 'photos', title: 'Photos', module: 'photos' },
  { key: 'status', title: 'Protection et statuts' },
  { key: 'lookalikes', title: 'Plantes à confondre' },
  { key: 'collect', title: 'Ajouter à ma collection' },
  { key: 'taxonomy', title: 'Classification' },
  { key: 'mine', title: 'Mes collections' },
  { key: 'calendar', title: 'Calendrier' },
  { key: 'wikipedia', title: 'Wikipédia', module: 'wikipedia' },
  { key: 'descriptions', title: 'Descriptions', module: 'gbif' },
  { key: 'names', title: 'Noms' },
  { key: 'occurrences', title: 'Occurrences et répartition', module: 'gbif' },
  { key: 'gbifMedia', title: 'Médias GBIF', module: 'gbif' },
  { key: 'trefle', title: 'Trefle', module: 'trefle' },
  { key: 'ids', title: 'Identifiants' },
  { key: 'resources', title: 'Ressources' }
];

/** Default order of each mode: what the mode is about first. @type {Record<Mode, string[]>} */
const DEFAULTS = {
  epure: ['photos', 'status', 'lookalikes', 'collect', 'calendar', 'wikipedia', 'names', 'taxonomy', 'mine', 'descriptions', 'occurrences', 'gbifMedia', 'trefle', 'ids', 'resources'],
  standard: ['status', 'lookalikes', 'taxonomy', 'mine', 'calendar', 'photos', 'wikipedia', 'descriptions', 'names', 'resources', 'collect', 'occurrences', 'gbifMedia', 'trefle', 'ids'],
  scientific: ['lookalikes', 'taxonomy', 'status', 'calendar', 'occurrences', 'wikipedia', 'descriptions', 'photos', 'gbifMedia', 'trefle', 'ids', 'mine', 'resources', 'names', 'collect']
};

/** Keys of earlier versions (one list per mode) → today's block. */
const RENAMED = { photo: 'photos', about: 'taxonomy', statuses: 'status', description: 'wikipedia' };

/** @param {string} key */
export const blockOf = key => BLOCKS.find(b => b.key === key);

/** Title of a block. @param {string} key */
export const blockTitle = key => blockOf(key)?.title || key;

/** Name of the module a block shows, if any. @param {string} key */
export const blockModuleName = key => MODULES.find(m => m.key === blockOf(key)?.module)?.name || null;

/** @param {Mode} view */
export const defaultOrder = view => DEFAULTS[view];

/**
 * The block keys of a view, in the order chosen on this device. Unknown keys are dropped, old ones renamed;
 * blocks added since the order was saved come in at their default place.
 * @param {Mode} view @returns {string[]}
 */
export function blockOrder(view) {
  const defaults = DEFAULTS[view];
  const saved = [...new Set((store.state.sheetBlocks[view] || []).map(k => RENAMED[/** @type {keyof RENAMED} */ (k)] || k))]
    .filter(k => defaults.includes(k));
  const order = [...saved];
  defaults.forEach((key, i) => {
    if (order.includes(key)) return;
    // After the default predecessor already placed, else first.
    const before = defaults.slice(0, i).reverse().find(k => order.includes(k));
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, key);
  });
  return order;
}

/** Has this view been reordered or folded by hand? @param {Mode} view */
export const isCustom = view => Boolean(store.state.sheetBlocks[view] || store.state.sheetHidden[view]);

/** @param {string} storageKey @param {Partial<Record<Mode, string[]>>} value */
function persist(storageKey, value) {
  try {
    if (Object.keys(value).length) localStorage.setItem(storageKey, JSON.stringify(value));
    else localStorage.removeItem(storageKey);
  } catch { /* not persisted */ }
}

/** @param {Mode} view @param {string[]} keys */
export function setBlockOrder(view, keys) {
  const next = { ...store.state.sheetBlocks };
  if (keys.join() === DEFAULTS[view].join()) delete next[view];
  else next[view] = keys;
  persist(config.storageKeys.sheetBlocks, next);
  store.set({ sheetBlocks: next });
}

/** Is this block folded in this view? A block of a module is folded when the module is off. @param {Mode} view @param {string} key */
export function isHidden(view, key) {
  const module = blockOf(key)?.module;
  if (module) return !moduleOn(module, view) || (module === 'wikipedia' && !moduleOn('wikidata', view));
  return (store.state.sheetHidden[view] || []).includes(key);
}

/** Fold a block away, or bring it back. @param {Mode} view @param {string} key @param {boolean} hidden */
export function setHidden(view, key, hidden) {
  const module = blockOf(key)?.module;
  if (module) {
    setModule(module, view, !hidden);
    // The Wikipédia article is found through Wikidata.
    if (module === 'wikipedia' && !hidden && !moduleOn('wikidata', view)) setModule('wikidata', view, true);
    return;
  }
  const keys = new Set(store.state.sheetHidden[view] || []);
  if (hidden) keys.add(key); else keys.delete(key);
  const next = { ...store.state.sheetHidden };
  if (keys.size) next[view] = [...keys]; else delete next[view];
  persist(config.storageKeys.sheetHidden, next);
  store.set({ sheetHidden: next });
}

/** Back to the default order, every block shown (modules included). @param {Mode} view */
export function resetBlocks(view) {
  const order = { ...store.state.sheetBlocks };
  const hidden = { ...store.state.sheetHidden };
  delete order[view];
  delete hidden[view];
  persist(config.storageKeys.sheetBlocks, order);
  persist(config.storageKeys.sheetHidden, hidden);
  store.set({ sheetBlocks: order, sheetHidden: hidden });
  for (const b of BLOCKS) if (b.module && isHidden(view, b.key)) setHidden(view, b.key, false);
}
