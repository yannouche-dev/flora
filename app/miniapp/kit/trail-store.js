// @ts-check
// The Parcours botanique, what it keeps on the device and what is pure about it: the walk under way (its place id),
// the walks to take up again, the one just ended (its recap, until left); a walk's plants grouped (each plant once,
// its occurrences together), counted, and its recap's numbers (how long, how far, how high). Tested under Node
// (tests/unit/trail.test.mjs). A walk itself is a place of Mes plantes (core/collections.js).

import { config } from '../../config.js';
import { distance } from '../../core/collections.js';
import { readJSON } from '../../core/prefs.js';
import { altitudeOf, profileOf } from '../../core/altitude.js';
import { walkOf } from '../../core/walk.js';

/**
 * The parcours being walked (its place id), those walked before, and the one just ended (its recap, until left); none
 * (null): the key removed — a parcours never opened, or played again, leaves none behind.
 */
export const KEY = config.storageKeys.trail, LIST = config.storageKeys.trails, DONE = config.storageKeys.trailDone;

/** A parcours under way on this device (the list of the ways to play says « Continuer »). */
export const walkUnderWay = () => Boolean(readJSON(KEY, null));
/** The parcours under way (its place id), if any. @returns {string | null} */
export const walkOn = () => readJSON(KEY, null);
/** The parcours just ended, whose recap shows (its place id), if any. @returns {string | null} */
export const walkDone = () => readJSON(DONE, null);
/** The parcours this device kept (to take up again, just ended): theirs before origins were recorded. @returns {string[]} */
export const keptWalks = () => [...(/** @type {string[]} */ (readJSON(LIST, []))), readJSON(DONE, null)].filter(x => typeof x === 'string');

/** A new parcours' name, until the place where it starts is known (« Mon parcours botanique en forêt de … »). */
export const NAMED = 'Mon parcours botanique';

/** Two plants further apart in time: a pause (taken up another day), not counted in the walk's time. */
const PAUSE_MS = 2 * 3600e3;

/**
 * « 12 observations · 9 plantes » (a plant met several times counts once among the plants).
 * @param {{ properties: { plants: { plantId: number | null }[] } }} t
 */
export function countOf(t) {
  const n = t.properties.plants.length, species = new Set(t.properties.plants.map(e => e.plantId)).size;
  if (!n) return 'Aucune plante encore';
  return n > species ? `${n} observations · ${species} plante${species > 1 ? 's' : ''}` : `${n} plante${n > 1 ? 's' : ''}`;
}

/**
 * The plants of the parcours, each once — its occurrences together, in the order met — the last met first.
 * @param {any} t @returns {{ plantId: number, entries: any[], last: any }[]}
 */
export function groupsOf(t) {
  /** @type {Map<number, any[]>} */
  const by = new Map();
  for (const e of [...t.properties.plants].sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)))) {
    by.set(e.plantId, [...(by.get(e.plantId) || []), e]);
  }
  return [...by].map(([plantId, entries]) => ({ plantId, entries, last: entries[entries.length - 1] }))
    .sort((a, b) => String(b.last.addedAt).localeCompare(String(a.last.addedAt)));
}

/**
 * A parcours' name without « Mon parcours botanique » (the heading says it): « En forêt de Fontainebleau ».
 * @param {string} name
 */
export const shortName = name => { const rest = name.startsWith(NAMED + ' ') ? name.slice(NAMED.length + 1) : ''; return rest ? rest[0].toUpperCase() + rest.slice(1) : name; };

/**
 * The recap of a parcours: its walk in the order the plants were added, from one to the next (as the crow flies),
 * from the start when it was started here — only the plants with a place of their own (located, or moved by hand),
 * not those put on the parcours' point for want of a position, nor the commune it started from (core/walk.js: the
 * « Vue 3D » draws the same walk); its altitude profile (the IGN's, kept with each plant); its time, from the start to
 * the last plant, without the pauses (taken up again another day); how far. `walk`: « en 1 h 05, sur 1,2 km, 40 m
 * de montée ». @param {any} t
 */
export function recapOf(t) {
  const { steps, own, start, line: placed } = walkOf(t);
  const profile = profileOf([
    ...(start ? [{ at: start, m: altitudeOf(t.properties, start), label: 'Départ' }] : []),
    ...own.map(e => ({ at: e.coordinates, m: altitudeOf(e, e.coordinates), label: e.vernacularName || e.scientificName }))
  ], distance);
  let km = 0;
  for (let i = 1; i < placed.length; i++) km += distance(placed[i - 1], placed[i]) / 1000;
  const times = [Date.parse(t.properties.createdAt), ...steps.map(e => Date.parse(e.addedAt))].filter(Number.isFinite);
  let ms = 0;
  for (let i = 1; i < times.length; i++) { const gap = times[i] - times[i - 1]; if (gap > 0 && gap <= PAUSE_MS) ms += gap; }
  const min = Math.round(ms / 60000);
  const time = min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : min >= 1 ? `${min} min` : '';
  const m = Math.round(km * 100) * 10;
  const dist = m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : m >= 50 ? `${m} m` : '';
  return { profile, time, dist };
}
