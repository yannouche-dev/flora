// @ts-check
// The shares a free layout's columns and rows were given on this device (a separator dragged), kept per layout — by its
// shape (grammar.js#shapeKey: its components and views, not their parameters nor the shares written in it), and in it
// per split (its path: '' the columns, '1' the rows of the second column…). A layout opened again without shares in
// its address finds them; one with shares (a link) shows those. The 40 layouts used last are kept.

import { config } from '../config.js';
import { readText, writeJSON } from '../core/prefs.js';

const KEY = config.storageKeys.freeLayout;
const KEEP = 40;

/** The text last read, and what it says (read at each drawing of a layout: parsed again only when it changed). */
let last = { raw: /** @type {string | null} */ (null), value: /** @type {Record<string, Record<string, number[]>>} */ ({}) };

/** @returns {Record<string, Record<string, number[]>>} a copy, to change */
function read() {
  const raw = readText(KEY);
  if (raw !== last.raw) {
    let v = null;
    try { v = JSON.parse(raw || 'null'); } catch { /* unreadable: none */ }
    last = { raw, value: v && typeof v === 'object' && !Array.isArray(v) ? v : {} };
  }
  return { ...last.value };
}

/** @param {Record<string, Record<string, number[]>>} all */
function write(all) {
  writeJSON(KEY, all); // not written: kept for this visit only
}

/** The shares kept for a split of a layout (null: none). @param {string} shape @param {string} path @returns {number[] | null} */
export function savedShares(shape, path) {
  const v = read()[shape]?.[path];
  return Array.isArray(v) && v.length > 1 && v.every(x => typeof x === 'number' && x > 0) ? v : null;
}

/** Shares kept for a split (null: forgotten). The layout becomes the last used. @param {string} shape @param {string} path @param {number[] | null} shares */
export function saveShares(shape, path, shares) {
  const all = read();
  const mine = { ...(all[shape] ?? {}) };
  if (shares) mine[path] = shares.map(x => Math.round(x * 1000) / 1000);
  else delete mine[path];
  delete all[shape];
  if (Object.keys(mine).length) all[shape] = mine;
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP))) delete all[k];
  write(all);
}

/** Every share kept for a layout forgotten (« Tailles par défaut »). @param {string} shape */
export function forgetShares(shape) {
  const all = read();
  if (!(shape in all)) return;
  delete all[shape];
  write(all);
}
