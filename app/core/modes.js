// @ts-check
// Display modes: the three of the app (Épuré, Standard, Scientifique) and the ones made from them.
// A mode made here starts as a copy of another (its blocks, layout, panes, modules, results grid) and keeps
// the way its model draws things (`base`: compact like Épuré, general like Standard, complete like
// Scientifique); then it is arranged on its own, in Mode King and Réglages. No dependency on the store.

import { config } from '../config.js';

/** The modes every installation has, which the others are made from. */
export const BASE_MODES = /** @type {const} */ (['epure', 'standard', 'scientific']);
/** @typedef {typeof BASE_MODES[number]} BaseMode */
/** A mode's key: one of BASE_MODES, or 'm…' for a mode made here. @typedef {string} Mode */

/** Icons a mode can have (Bootstrap Icons in the sprite). */
export const MODE_ICON_CHOICES = /** @type {const} */ (['image', 'list-ul', 'table', 'images', 'map', 'leaf', 'flower1', 'diagram-3', 'star', 'layers', 'search', 'crown']);

/** @typedef {{ key: Mode, label: string, base: BaseMode, icon: typeof MODE_ICON_CHOICES[number], builtIn: boolean }} ModeInfo */

/** @type {ModeInfo[]} */
const BUILT_IN = [
  { key: 'epure', label: 'Épuré', base: 'epure', icon: 'image', builtIn: true },
  { key: 'standard', label: 'Standard', base: 'standard', icon: 'list-ul', builtIn: true },
  { key: 'scientific', label: 'Scientifique', base: 'scientific', icon: 'table', builtIn: true }
];

/** A key of a mode made here. */
const OWN_KEY = /^m[a-z0-9]{2,12}$/;

/** @returns {ModeInfo[]} */
function read() {
  try {
    const saved = JSON.parse(localStorage.getItem(config.storageKeys.modes) || '[]');
    if (!Array.isArray(saved)) return [];
    return saved.filter(m => m && OWN_KEY.test(m.key) && typeof m.label === 'string' && BASE_MODES.includes(m.base))
      .map(m => ({ key: m.key, label: m.label.slice(0, 40), base: m.base, icon: MODE_ICON_CHOICES.includes(m.icon) ? m.icon : 'star', builtIn: false }));
  } catch { return []; }
}

let own = read();

/** Fires `change` when a mode is made, renamed or deleted. */
export const modeEvents = new EventTarget();

function save() {
  try {
    if (own.length) localStorage.setItem(config.storageKeys.modes, JSON.stringify(own.map(({ builtIn, ...m }) => m)));
    else localStorage.removeItem(config.storageKeys.modes);
  } catch { /* not persisted */ }
  modeEvents.dispatchEvent(new Event('change'));
}

/** Every mode, the app's first. */
export const modeList = () => [...BUILT_IN, ...own];
/** Every mode's key. */
export const modeKeys = () => modeList().map(m => m.key);
/** @param {unknown} key @returns {key is Mode} */
export const isMode = key => typeof key === 'string' && modeKeys().includes(key);
/** @param {Mode} key */
export const modeInfo = key => modeList().find(m => m.key === key) || BUILT_IN[1];
/** The model a mode draws like. @param {Mode} key @returns {BaseMode} */
export const baseOf = key => /** @type {BaseMode} */ (BASE_MODES.includes(/** @type {any} */ (key)) ? key : modeInfo(key).base);
/** @param {Mode} key */
export const modeLabel = key => modeInfo(key).label;

/** A new key, not taken. */
function newKey() {
  let key;
  do key = 'm' + Math.random().toString(36).slice(2, 8); while (modeKeys().includes(key));
  return key;
}

/**
 * Records a new mode drawn like `from` (its copy of the layout and modules is made by the caller, see
 * mode-admin.js). @param {string} label @param {Mode} from @returns {Mode}
 */
export function addMode(label, from) {
  const key = newKey();
  const model = modeInfo(from);
  own = [...own, { key, label: label.trim().slice(0, 40) || 'Nouveau mode', base: model.base, icon: from === model.key && model.builtIn ? 'star' : model.icon, builtIn: false }];
  save();
  return key;
}

/** @param {Mode} key @param {{ label?: string, icon?: typeof MODE_ICON_CHOICES[number] }} patch */
export function updateMode(key, patch) {
  own = own.map(m => m.key !== key ? m : {
    ...m,
    ...(patch.label !== undefined ? { label: patch.label.trim().slice(0, 40) || m.label } : {}),
    ...(patch.icon && MODE_ICON_CHOICES.includes(patch.icon) ? { icon: patch.icon } : {})
  });
  save();
}

/** @param {Mode} key */
export function removeMode(key) {
  own = own.filter(m => m.key !== key);
  save();
}

/** Modes of a layout file, added when missing (same key: kept as it is here). @param {any[]} list */
export function importModes(list) {
  if (!Array.isArray(list)) return;
  const known = modeKeys();
  const add = list.filter(m => m && OWN_KEY.test(m.key) && !known.includes(m.key) && typeof m.label === 'string' && BASE_MODES.includes(m.base))
    .map(m => ({ key: m.key, label: String(m.label).slice(0, 40), base: m.base, icon: MODE_ICON_CHOICES.includes(m.icon) ? m.icon : 'star', builtIn: false }));
  if (add.length) { own = [...own, ...add]; save(); }
}

/** The modes made here, for a layout file. */
export const ownModes = () => own.map(({ builtIn, ...m }) => m);
