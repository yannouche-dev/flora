// @ts-check
// Making, renaming and deleting display modes: the mode itself (modes.js) and its blocks and layout
// (sheet-blocks.js) go together. Online services are not the mode's: they are chosen for the device (modules.js).

import { addMode, modeInfo, removeMode, updateMode } from './modes.js';
import { copyLayout, dropLayout } from './sheet-blocks.js';

/** @typedef {import('./modes.js').Mode} Mode */

/**
 * A new mode, a copy of `from` (layout, panes); it draws like `from`'s model.
 * @param {string} label @param {Mode} from @returns {Mode}
 */
export function createMode(label, from) {
  const key = addMode(label, from);
  copyLayout(from, key);
  return key;
}

/** @param {Mode} key @param {Parameters<typeof updateMode>[1]} patch */
export const editMode = (key, patch) => updateMode(key, patch);

/** Deletes a mode made here (the app's three stay) and its layout. @param {Mode} key */
export function deleteMode(key) {
  if (modeInfo(key).builtIn) return;
  dropLayout(key);
  removeMode(key);
}
