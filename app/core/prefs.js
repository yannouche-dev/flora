// @ts-check
// What the app keeps in localStorage — its settings and small states (modules, modes, the maps' look, a mini-app's
// state, the widths of the panes…) —, read and written here only: every key is one of config.storageKeys (or under
// its appPrefix), and nothing ever throws. A storage switched off, full or unreadable is the setting's fallback; a
// write refused for lack of room is reported (quota.js: the banner says what to do), never swallowed in silence.
//  - readText / writeText, readJSON / writeJSON: one key, as text or JSON (null: the key removed);
//  - storedKeys(prefix): the keys kept under a prefix (the first steps, a mini-app's keys);
//  - definePref({ key, clean, fallback, store }): a setting kept in memory, read again when another tab changes it,
//    and `change` fired on its events — here or there.
// The ESLint rule « storage » keeps localStorage out of every other file of app/ (sync.js aside: the channel between
// tabs it relies on).

import { noteStorageError } from './quota.js';
import { onStorage } from './sync.js';

/** A key's text; null: none, or no storage. @param {string} key @returns {string | null} */
export function readText(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

/**
 * localStorage.setItem (or removeItem, `value` null) that never throws: false when not written — the quota
 * reported, a storage switched off only skipped.
 * @param {string} key @param {string | null} value
 */
export function writeText(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch (error) {
    noteStorageError(error);
    return false;
  }
}

/**
 * A key's JSON; `fallback` when none, unreadable or null.
 * @template T @param {string} key @param {T} fallback @returns {any}
 */
export function readJSON(key, fallback) {
  const text = readText(key);
  if (text === null) return fallback;
  try { return JSON.parse(text) ?? fallback; } catch { return fallback; }
}

/** Writes a value as JSON (null or undefined: the key removed). @param {string} key @param {unknown} value */
export const writeJSON = (key, value) => writeText(key, value == null ? null : JSON.stringify(value));

/** The keys kept under a prefix (none: no storage). @param {string} prefix @returns {string[]} */
export function storedKeys(prefix) {
  /** @type {string[]} */ const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
  } catch { /* no storage: none */ }
  return keys;
}

/**
 * @template T
 * @typedef {object} Pref
 * @property {() => T} get the value now (in memory: read once, then again when another tab changes it)
 * @property {() => T} fresh the value stored now (another tab's choices since included): what a change starts from
 * @property {(value: T) => boolean} set kept, `change` fired; false when not written (it holds for this visit)
 * @property {() => void} reset back to the fallback: the key removed
 * @property {EventTarget} events fires `change` (detail: the value) — here, or when another tab changes it
 */

/**
 * A setting kept in localStorage.
 *  - `clean` makes whatever was stored a valid value (none or unreadable: `fallback`, default null, given to it);
 *  - `store` says what to write (default: the value as is; null: the key removed — only what differs from the
 *    defaults is kept, so a default changed later reaches everyone).
 * @template T
 * @param {{ key: string, clean: (stored: any) => T, fallback?: unknown, store?: (value: T) => unknown }} spec
 * @returns {Pref<T>}
 */
export function definePref({ key, clean, fallback = null, store = v => v }) {
  const fresh = () => clean(readJSON(key, fallback));
  let value = fresh();
  const events = new EventTarget();
  const changed = () => events.dispatchEvent(new CustomEvent('change', { detail: value }));
  onStorage(key, () => { value = fresh(); changed(); });
  return {
    get: () => value,
    fresh,
    set(next) {
      value = next;
      const written = writeJSON(key, store(next));
      changed();
      return written;
    },
    reset() {
      value = clean(fallback);
      writeText(key, null);
      changed();
    },
    events
  };
}
