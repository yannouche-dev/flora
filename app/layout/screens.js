// @ts-check
// « Mes écrans »: the last screens of one's own opened on this device in use (gf-layout.js records them), newest first,
// 10 at most — each its address in use (never edit=1), its title (as the address has it, already clean), a name for an
// untitled one (its cells'), when. One screen per layout and title: opened again, its record moves first, with its
// latest address. Shown on the home (#/layout) and in Réglages (screen-list.js); × takes one out. Followed across tabs
// (prefs.js). Kept on this device only: neither in the backup copy nor in the export.
import { config } from '../config.js';
import { definePref } from '../core/prefs.js';

/** @typedef {{ href: string, title: string | null, label: string, at: number }} Screen */

/** How many screens are kept. */
const MAX = 10;
/** A title or a name kept: the address' own limit (state.js#cleanText). */
const LONGEST = 80;

/** The address in use: edit=1 taken out. @param {string} href */
export const usageOf = href => href.replace(/([?&])edit=1(&|$)/, (_, a, b) => b ? a : '').replace(/\?$/, '');

/**
 * A layout's text without its maps' views (vue=: in use, the leading map's, rewritten as it is moved by hand — the same
 * screen wherever its map was left). @param {string} path
 */
const unviewed = path => path
  .replace(/([(,])vue=[^,;)]*(,?)/g, (_, open, comma) => open === '(' ? '(' : comma)
  .replace(/\(;/g, '(').replace(/\(\)/g, '');

/** A screen's identity: its layout (the path, its maps' views left out) and its title. @param {{ href: string, title: string | null }} s */
export const screenKey = s => unviewed(s.href.split('?')[0]) + '\n' + (s.title ?? '');

/**
 * An untitled screen's name: its cells' names, « · » between them — too long, cut after a whole one, « … » saying the
 * others are left out (never half a word: a screen reader reads it as it is). @param {string[]} names
 */
export function labelOf(names) {
  const all = names.join(' · ');
  if (all.length <= LONGEST) return all;
  let out = '';
  for (const n of names) {
    const next = out ? `${out} · ${n}` : n;
    if (next.length + 2 > LONGEST) break;
    out = next;
  }
  return out ? `${out} …` : `${names[0].slice(0, LONGEST - 1)}…`;
}

/**
 * What was stored, as screens: each an address of a screen (#/layout/<layout>, in use), a title or none, a name, a
 * date — anything else dropped; one per layout and title (the first: the newest); 10 at most.
 * @param {unknown} stored @returns {Screen[]}
 */
export function clean(stored) {
  if (!Array.isArray(stored)) return [];
  /** @type {Screen[]} */
  const out = [];
  const seen = new Set();
  for (const s of /** @type {any[]} */ (stored)) {
    if (!s || typeof s.href !== 'string' || !/^#\/layout\/[^?]/.test(s.href)) continue;
    const title = s.title ?? null;
    if (title !== null && (typeof title !== 'string' || !title || title.length > LONGEST)) continue;
    if (typeof s.label !== 'string' || s.label.length > LONGEST || !Number.isFinite(s.at)) continue;
    const screen = { href: usageOf(s.href), title, label: s.label, at: s.at };
    const key = screenKey(screen);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(screen);
    if (out.length === MAX) break;
  }
  return out;
}

const pref = definePref({ key: config.storageKeys.screens, fallback: [], clean, store: v => v.length ? v : null });

/** The screens kept, newest first. */
export const screens = () => pref.get();
/** Fires `change` when one is kept or taken out — here, or in another tab. */
export const screenEvents = pref.events;

/**
 * A screen opened in use: first in the list (its older record, by layout and title, gone). `replaces` (a screenKey):
 * the record it was before being modified, taken out too.
 * @param {Omit<Screen, 'at'>} s @param {string | null} [replaces]
 */
export function rememberScreen(s, replaces = null) {
  pref.set(clean([{ ...s, href: usageOf(s.href), at: Date.now() }, ...pref.fresh().filter(x => screenKey(x) !== replaces)]));
}

/** × : a screen taken out of the list. @param {string} href */
export function forgetScreen(href) {
  pref.set(pref.fresh().filter(s => s.href !== href));
}
