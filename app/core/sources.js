// @ts-check
// Remote enrichment: lib/plant-sources.mjs behind a persistent IndexedDB cache.

import { PlantSources } from '../../lib/plant-sources.mjs';
import { config } from '../config.js';
import * as db from './db.js';
import { moduleEvents, moduleOn, modulesSignature } from './modules.js';

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

const createSources = () => new PlantSources({ trefleToken: getTrefleToken(), enabled: (/** @type {any} */ key) => moduleOn(key) });
let sources = createSources();
// A module switched on again must not get an empty answer from the in-memory cache of the old instance.
moduleEvents.addEventListener('change', () => { sources = createSources(); });

/** Cache key of a plant's remote data: it changes with the modules switched off, so their data never shows. */
const key = (/** @type {string} */ kind, /** @type {number} */ id) => {
  const off = modulesSignature();
  return kind + ':' + id + (off ? '|off:' + off : '');
};

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
  return cached(key('thumb', plant.id), () => sources.thumbnail(plant, { signal }));
}

/**
 * Everything the detail page needs (identifiers, GBIF, Commons, Trefle, links).
 * @param {any} plant
 * @param {AbortSignal} [signal]
 */
export function details(plant, signal) {
  return cached(key('details', plant.id), () => sources.details(plant, { signal }));
}

/**
 * Flowering / fruiting observations per month in France (iNaturalist), cached like the details.
 * @param {any} plant
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ all: number[], flowering: number[], fruiting: number[], taxonId: number, sourceUrl: string } | null>}
 */
export function phenology(plant, signal) {
  return cached(key('phenology', plant.id), () => sources.phenology(plant, { signal }));
}

/** @param {any} plant */
export const links = plant => sources.links(plant);

/**
 * French Wikipedia lead paragraph, through the plant's Wikidata item.
 * @param {any} plant
 * @param {string | null | undefined} qid
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ title: string, extract: string, url: string } | null>}
 */
export function wikipedia(plant, qid, signal) {
  if (!qid) return Promise.resolve(null);
  return cached(key('wikipedia', plant.id), async () => {
    const claims = await sources.wikidataClaims(qid, { signal });
    return claims?.frwiki ? sources.wikipediaSummary(claims.frwiki, { signal }) : null;
  });
}

/**
 * Scientific view: Wikidata classification (P171 chain), IUCN status and identifiers.
 * @param {any} plant
 * @param {string | null | undefined} qid
 * @param {AbortSignal} [signal]
 */
export function wikidataScience(plant, qid, signal) {
  if (!qid) return Promise.resolve(null);
  return cached(key('wikidata-science', plant.id), () => sources.wikidataScience(qid, { signal }));
}

/**
 * GBIF occurrences recorded in France.
 * @param {any} plant
 * @param {number | null | undefined} gbifKey
 * @param {AbortSignal} [signal]
 * @returns {Promise<number | null>}
 */
export function occurrencesFR(plant, gbifKey, signal) {
  if (!gbifKey) return Promise.resolve(null);
  return cached(key('gbif-fr', plant.id), () => sources.gbifOccurrencesFR(gbifKey, { signal }));
}
