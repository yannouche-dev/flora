// @ts-check
// The plant sheet is made of titled blocks below its header; each display mode has its own block order,
// rearranged by dragging a block's grip and kept on this device (Réglages › Affichage resets it).

import { config } from '../config.js';
import { store } from './store.js';

/** @typedef {import('./modules.js').Mode} Mode */
/** @typedef {{ key: string, title: string }} SheetBlock */

/** Every block of each view, in its default order. @type {Record<Mode, SheetBlock[]>} */
export const SHEET_BLOCKS = {
  epure: [
    { key: 'photo', title: 'Photo' },
    { key: 'status', title: 'Protection et statuts' },
    { key: 'lookalikes', title: 'Plantes à confondre' },
    { key: 'collect', title: 'Ajouter à ma collection' }
  ],
  standard: [
    { key: 'status', title: 'Protection et statuts' },
    { key: 'lookalikes', title: 'Plantes à confondre' },
    { key: 'about', title: 'Classification' },
    { key: 'mine', title: 'Mes collections' },
    { key: 'calendar', title: 'Calendrier' },
    { key: 'photos', title: 'Photos' },
    { key: 'description', title: 'Description' },
    { key: 'names', title: 'Noms français' },
    { key: 'resources', title: 'Ressources' }
  ],
  scientific: [
    { key: 'lookalikes', title: 'Plantes à confondre' },
    { key: 'taxonomy', title: 'Taxonomie' },
    { key: 'statuses', title: 'Statuts' },
    { key: 'calendar', title: 'Calendrier' },
    { key: 'occurrences', title: 'Occurrences et répartition' },
    { key: 'descriptions', title: 'Descriptions' },
    { key: 'photos', title: 'Photos' },
    { key: 'gbifMedia', title: 'Médias GBIF' },
    { key: 'trefle', title: 'Trefle' },
    { key: 'ids', title: 'Identifiants' },
    { key: 'mine', title: 'Mes collections' },
    { key: 'resources', title: 'Ressources' }
  ]
};

/** Title of a block. @param {Mode} view @param {string} key */
export const blockTitle = (view, key) => SHEET_BLOCKS[view].find(b => b.key === key)?.title || key;

/**
 * The block keys of a view, in the order chosen on this device. Blocks unknown to this version are dropped;
 * blocks added since the order was saved come in at their default place.
 * @param {Mode} view @returns {string[]}
 */
export function blockOrder(view) {
  const defaults = SHEET_BLOCKS[view].map(b => b.key);
  const saved = (store.state.sheetBlocks[view] || []).filter(k => defaults.includes(k));
  const order = [...saved];
  defaults.forEach((key, i) => {
    if (order.includes(key)) return;
    // After the default predecessor already placed, else first.
    const before = defaults.slice(0, i).reverse().find(k => order.includes(k));
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, key);
  });
  return order;
}

/** Has this view been reordered by hand? @param {Mode} view */
export const isCustomOrder = view => Boolean(store.state.sheetBlocks[view]);

/** @param {Partial<Record<Mode, string[]>>} sheetBlocks */
function save(sheetBlocks) {
  try {
    if (Object.keys(sheetBlocks).length) localStorage.setItem(config.storageKeys.sheetBlocks, JSON.stringify(sheetBlocks));
    else localStorage.removeItem(config.storageKeys.sheetBlocks);
  } catch { /* not persisted */ }
  store.set({ sheetBlocks });
}

/** @param {Mode} view @param {string[]} keys */
export function setBlockOrder(view, keys) {
  const defaults = SHEET_BLOCKS[view].map(b => b.key);
  const next = { ...store.state.sheetBlocks };
  if (keys.join() === defaults.join()) delete next[view];
  else next[view] = keys;
  save(next);
}

/** Back to the default order. @param {Mode} view */
export function resetBlockOrder(view) {
  const next = { ...store.state.sheetBlocks };
  delete next[view];
  save(next);
}
