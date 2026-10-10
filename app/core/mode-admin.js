// @ts-check
// Making, renaming and deleting display modes: the mode itself (modes.js), its blocks and layout
// (sheet-blocks.js) and its services (modules.js) go together.

import { addMode, modeInfo, removeMode, updateMode } from './modes.js';
import { copyModules, dropModules } from './modules.js';
import { copyLayout, dropLayout } from './sheet-blocks.js';

/** @typedef {import('./modes.js').Mode} Mode */

/**
 * A new mode, a copy of `from` (layout, panes, modules); it draws like `from`'s model.
 * @param {string} label @param {Mode} from @returns {Mode}
 */
export function createMode(label, from) {
  const key = addMode(label, from);
  copyLayout(from, key);
  copyModules(from, key);
  return key;
}

/** @param {Mode} key @param {Parameters<typeof updateMode>[1]} patch */
export const editMode = (key, patch) => updateMode(key, patch);

/** Deletes a mode made here (the app's three stay), its layout and its module choices. @param {Mode} key */
export function deleteMode(key) {
  if (modeInfo(key).builtIn) return;
  dropLayout(key);
  dropModules(key);
  removeMode(key);
}
