// @ts-check
// The games around a place — Rencontres, Cueillette prudente, Mosaïque —, each its own: the place chosen, the
// distance, the cards swiped and the matches are kept by each mini-app with its state (geoflora.app.<id>.state, the
// `ctx` of runtime.js), so that « Rejouer » in one leaves the others as they were, and « Reprendre » is each one's.
// Before, the three shared one session, in geoflora.discover: core/discover.js hands it over once (migrate) to the one
// played last (else Rencontres) — nothing is lost, and from then on each goes its own way.
// Read here for what is not a mini-app: the launcher (« Reprendre »), the place the sheet's map starts from, the
// privacy page (« Oublier ma dernière position »), the first steps started again (Réglages).

import { config } from '../config.js';

/** The mini-apps around a place, Rencontres first (the one whose place is « the last one » for the rest of the app). */
export const AROUND_APPS = /** @type {const} */ (['rencontres', 'cueillette', 'mosaique']);
/** The version of their state (the manifests' `version`). */
const V = 1;

/**
 * @typedef {{ point?: [number, number] | null, place?: string | null, radius?: number, matches?: number[], passed?: number[] }} AroundCtx
 * @typedef {{ v: number, path: string[], ctx: AroundCtx & Record<string, unknown>, finished: boolean }} Saved
 */

/** @param {string} id */
const keyOf = id => config.storageKeys.appPrefix + id + '.state';

/** @param {string} id @returns {Saved | null} */
function read(id) {
  try {
    const saved = JSON.parse(localStorage.getItem(keyOf(id)) || 'null');
    return saved && typeof saved === 'object' && saved.v === V ? saved : null;
  } catch { return null; }
}

/** @param {string} id @param {Saved} saved */
function write(id, saved) {
  try { localStorage.setItem(keyOf(id), JSON.stringify(saved)); } catch { /* not kept */ }
}

/**
 * The step a mini-app was left at (its state's path, kept with it: « Continuer » goes back there), any mini-app;
 * null: none kept. @param {string} id @returns {string | null}
 */
export function leftAt(id) {
  try {
    const path = JSON.parse(localStorage.getItem(keyOf(id)) || 'null')?.path;
    return Array.isArray(path) && typeof path[path.length - 1] === 'string' ? path[path.length - 1] : null;
  } catch { return null; }
}

/** What a mini-app around a place keeps (nothing: {}). @param {string} id @returns {AroundCtx} */
export const aroundKept = id => read(id)?.ctx ?? {};

/** A game under way: a place chosen in that mini-app. @param {string} id */
export const aroundUnderWay = id => Array.isArray(aroundKept(id).point);

/** The last place chosen in one of them (Rencontres' first), with its name; null: none. @returns {{ point: [number, number], place: string | null } | null} */
export function keptPlace() {
  for (const id of AROUND_APPS) {
    const c = aroundKept(id);
    if (Array.isArray(c.point)) return { point: c.point, place: c.place ?? null };
  }
  return null;
}

/** The places kept forgotten (« Oublier ma dernière position »): in each one, the rest of its game kept. */
export function forgetPlaces() {
  for (const id of AROUND_APPS) {
    const saved = read(id);
    if (saved && (saved.ctx.point != null || saved.ctx.place != null)) write(id, { ...saved, ctx: { ...saved.ctx, point: null, place: null } });
  }
}

/** Every game around a place forgotten (the first steps started again, Réglages): their states removed. */
export function clearAroundGames() {
  for (const id of AROUND_APPS) {
    try { localStorage.removeItem(keyOf(id)); } catch { /* nothing kept */ }
  }
}

/**
 * The session the three shared before (geoflora.discover: the place, the distance, the cards swiped, the matches),
 * handed over once to the one played last — known when the app opens at its old address (#/discover?s=harvest or
 * ?s=mosaic: Cueillette prudente, Mosaïque), else Rencontres — under what it already keeps (a value it has wins).
 * Nothing to hand over (no place, no swipe): nothing written. @param {AroundCtx} old @param {string} [hash] the address
 */
export function migrateDiscover(old, hash = '') {
  const ctx = {
    point: Array.isArray(old.point) ? old.point : null,
    place: typeof old.place === 'string' ? old.place : null,
    radius: typeof old.radius === 'number' ? old.radius : 1000,
    matches: Array.isArray(old.matches) ? old.matches : [],
    passed: Array.isArray(old.passed) ? old.passed : []
  };
  if (!ctx.point && !ctx.matches.length && !ctx.passed.length) return;
  const s = /[?&]s=([a-z]+)/.exec(hash)?.[1];
  const id = s === 'harvest' ? 'cueillette' : s === 'mosaic' ? 'mosaique' : 'rencontres';
  const saved = read(id);
  write(id, { v: V, path: saved?.path ?? ['start'], finished: saved?.finished ?? false, ctx: { ...ctx, ...withoutEmpty(saved?.ctx ?? {}) } });
}

/** The values a state has (an absent or undefined key does not hide the one handed over). @param {Record<string, unknown>} ctx */
const withoutEmpty = ctx => Object.fromEntries(Object.entries(ctx).filter(([, v]) => v !== undefined));
