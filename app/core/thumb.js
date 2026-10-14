// @ts-check
// Photo URL of a plant for thumbnails (lists, map markers): the one bundled in plants.json, else a remote
// lookup cached in IndexedDB (sources.thumbnail). Results are kept in memory for the session, each with its credit
// (its author and licence: a map's card shows them with the photo).

import * as db from './db.js';
import * as sources from './sources.js';
import { moduleEvents, moduleOn } from './modules.js';
import { foundCredit, thumbCredit } from './credit.js';

/** @typedef {import('./credit.js').Credit} Credit */

/** @type {Map<number, string | null>} */
const known = new Map();
/** The credit of each photo in `known` (null: none found, or none owed). @type {Map<number, Credit | null>} */
const credits = new Map();
/** @type {Map<number, Promise<string | null>>} */
const pending = new Map();
// Lookups made with other modules on or off are stale: forget them.
moduleEvents.addEventListener('change', () => { known.clear(); credits.clear(); pending.clear(); });

/** Remote lookups at once (plants without a bundled photo). */
const PARALLEL = 4;
let running = 0;
/** @type {(() => void)[]} */
const queue = [];

/** @template T @param {() => Promise<T>} task @returns {Promise<T>} */
async function limited(task) {
  if (running >= PARALLEL) await new Promise(resolve => queue.push(/** @type {() => void} */ (resolve)));
  running++;
  try { return await task(); } finally {
    running--;
    queue.shift()?.();
  }
}

/**
 * URL already at hand: a plant record or search result with its photo, or one resolved earlier.
 * @param {any} plant
 * @returns {string | null | undefined} undefined when not known yet
 */
export function knownThumb(plant) {
  if (!plant || !moduleOn('photos')) return null;
  if (plant.thumbnail?.url) return plant.thumbnail.url;
  return plant.id != null ? known.get(Number(plant.id)) : undefined;
}

/**
 * A plant photo at hand (a dataset thumbnail, an iNaturalist photo…), or null when the « Photos en ligne » module is
 * off in that mode: every <img> of a plant photo goes through here or the functions above.
 * @param {string | null | undefined} url @param {import('./modes.js').Mode} [mode] the app mode when not given
 */
export const photoOf = (url, mode) => url && moduleOn('photos', mode) ? url : null;

/** @param {number} id @returns {string | null | undefined} */
export const cachedThumb = id => moduleOn('photos') ? known.get(Number(id)) : null;

/**
 * The credit of the photo knownThumb gives (its author, licence and source): the bundled thumbnail's, else the one
 * found online's (sources.thumbnail: iNaturalist's taxon photo, Commons'…); null when none is known yet.
 * @param {any} plant @returns {Credit | null}
 */
export function knownCredit(plant) {
  if (!plant || !moduleOn('photos')) return null;
  if (plant.thumbnail?.url) return thumbCredit(plant.thumbnail);
  return plant.id != null ? credits.get(Number(plant.id)) ?? null : null;
}

/** The credit of the photo cachedThumb gives. @param {number} id @returns {Credit | null} */
export const cachedCredit = id => moduleOn('photos') ? credits.get(Number(id)) ?? null : null;

/**
 * @param {number | null | undefined} plantId
 * @param {any} [record] the plant when already loaded
 * @returns {Promise<string | null>}
 */
export function thumbUrl(plantId, record) {
  const id = Number(plantId);
  if (!plantId || !Number.isFinite(id) || !moduleOn('photos')) return Promise.resolve(null);
  if (known.has(id)) return Promise.resolve(/** @type {string | null} */ (known.get(id)));
  if (pending.has(id)) return /** @type {Promise<string | null>} */ (pending.get(id));
  const task = (async () => {
    const plant = record?.id === id && 'thumbnail' in record ? record : await db.get('plants', id).catch(() => null);
    if (!plant) return null;
    if (plant.thumbnail?.url) return { url: /** @type {string} */ (plant.thumbnail.url), credit: thumbCredit(plant.thumbnail) };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
    const found = await limited(() => sources.thumbnail(plant)).catch(() => null);
    // Its credit kept with it: the photo is shown with its author and licence wherever a card shows it.
    return found?.url ? { url: /** @type {string} */ (found.url), credit: foundCredit(found) } : null;
  })().then(hit => {
    const url = hit?.url || null;
    // An offline miss is not remembered: the photo may come once back online.
    if (url || navigator.onLine !== false) { known.set(id, url); credits.set(id, hit?.credit ?? null); }
    pending.delete(id);
    return url;
  });
  pending.set(id, task);
  return task;
}
