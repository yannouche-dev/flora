// @ts-check
// Photo URL of a plant for thumbnails (lists, map markers): the one bundled in plants.json, else a remote
// lookup cached in IndexedDB (sources.thumbnail). Results are kept in memory for the session.

import * as db from './db.js';
import * as sources from './sources.js';
import { moduleEvents, moduleOn } from './modules.js';

/** @type {Map<number, string | null>} */
const known = new Map();
/** @type {Map<number, Promise<string | null>>} */
const pending = new Map();
// Lookups made with other modules on or off are stale: forget them.
moduleEvents.addEventListener('change', () => { known.clear(); pending.clear(); });

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

/** @param {number} id @returns {string | null | undefined} */
export const cachedThumb = id => moduleOn('photos') ? known.get(Number(id)) : null;

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
    if (plant.thumbnail?.url) return plant.thumbnail.url;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
    const found = await limited(() => sources.thumbnail(plant)).catch(() => null);
    return found?.url || null;
  })().then(url => {
    // An offline miss is not remembered: the photo may come once back online.
    if (url || navigator.onLine !== false) known.set(id, url);
    pending.delete(id);
    return url;
  });
  pending.set(id, task);
  return task;
}
