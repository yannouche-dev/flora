// @ts-check
// Remote enrichment: lib/plant-sources.mjs behind a persistent IndexedDB cache.

import { PlantSources } from '../../lib/plant-sources.mjs';
import { config } from '../config.js';
import * as db from './db.js';

/** @returns {string | null} */
export function getTrefleToken() {
  try { return localStorage.getItem(config.storageKeys.trefleToken) || null; } catch { return null; }
}

/** @param {string | null} token */
export function setTrefleToken(token) {
  try {
    if (token) localStorage.setItem(config.storageKeys.trefleToken, token);
    else localStorage.removeItem(config.storageKeys.trefleToken);
  } catch { /* storage unavailable: the token simply won't persist */ }
  sources = createSources();
}

const createSources = () => new PlantSources({ trefleToken: getTrefleToken() });
let sources = createSources();

/** Requests in flight, shared so two components asking for the same plant hit the network once. */
const pending = new Map();

/**
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} loader
 * @returns {Promise<T>}
 */
async function cached(key, loader) {
  const hit = await db.get('plantDetails', key).catch(() => null);
  if (hit && Date.now() - hit.fetchedAt < config.remoteTtl) return hit.value;

  if (pending.has(key)) return pending.get(key);

  const task = loader()
    .then(async value => {
      await db.put('plantDetails', { key, fetchedAt: Date.now(), value }).catch(() => {});
      return value;
    })
    .catch(error => {
      // Offline or API down: an expired cache entry is better than nothing.
      if (hit) return hit.value;
      throw error;
    })
    .finally(() => pending.delete(key));

  pending.set(key, task);
  return task;
}

/**
 * Thumbnail for a list row: the one embedded in plants.json, otherwise a remote lookup.
 * @param {any} plant
 * @param {AbortSignal} [signal]
 */
export function thumbnail(plant, signal) {
  if (plant.thumbnail?.url) return Promise.resolve(plant.thumbnail);
  return cached('thumb:' + plant.id, () => sources.thumbnail(plant, { signal }));
}

/**
 * Everything the detail page needs (identifiers, GBIF, Commons, Trefle, links).
 * @param {any} plant
 * @param {AbortSignal} [signal]
 */
export function details(plant, signal) {
  return cached('details:' + plant.id, () => sources.details(plant, { signal }));
}

/** @param {any} plant */
export const links = plant => sources.links(plant);
