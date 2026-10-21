// @ts-check
// The Parcours botanique, what it keeps on the device and what is pure about it: the walk under way (its place id),
// the walks to take up again, the one just ended (its recap, until left); a walk's plants grouped (each plant once,
// its occurrences together), counted; its recap's numbers are trail-recap.js's (with the walk and the altitudes: not
// at the start of the app). Tested under Node (tests/unit/trail.test.mjs). A walk itself is a place of Mes plantes
// (core/collections.js).

import { config } from '../../config.js';
import { readJSON } from '../../core/prefs.js';

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

