// @ts-check
// Remote enrichment: lib/plant-sources.mjs behind a persistent IndexedDB cache.

import { PlantSources } from '../../lib/plant-sources.mjs';
import { config } from '../config.js';
import * as db from './db.js';
import { appMode, moduleEvents, moduleOn, modulesSignature } from './modules.js';

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
  instances.clear();
}

/** @typedef {import('./modules.js').Mode} Mode */

/** One PlantSources per mode, each calling only the modules that mode uses. @type {Map<string, PlantSources>} */
const instances = new Map();
/** @param {Mode} [mode] the surface's mode (plant sheet, grid); the app mode when omitted */
const sourcesFor = mode => {
  const m = mode || appMode();
  let instance = instances.get(m);
  if (!instance) {
    instance = new PlantSources({ trefleToken: getTrefleToken(), enabled: (/** @type {any} */ k) => moduleOn(k, m) });
    instances.set(m, instance);
  }
  return instance;
};
// A module switched on again must not get an empty answer from the in-memory cache of an old instance.
moduleEvents.addEventListener('change', () => instances.clear());

/** Cache key of a plant's remote data: it changes with the modules off in that mode, so their data never shows. */
const key = (/** @type {string} */ kind, /** @type {number} */ id, /** @type {Mode | undefined} */ mode) => {
  const off = modulesSignature(mode);
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
 * @param {Mode} [mode]
 */
export function thumbnail(plant, signal, mode) {
  if (plant.thumbnail?.url) return Promise.resolve(plant.thumbnail);
  return cached(key('thumb', plant.id, mode), () => sourcesFor(mode).thumbnail(plant, { signal }));
}

/**
 * Everything the detail page needs (identifiers, GBIF, Commons, Trefle, links).
 * @param {any} plant
 * @param {AbortSignal} [signal]
 * @param {Mode} [mode]
 */
export function details(plant, signal, mode) {
  // 'details2': GBIF data is no longer in it (it comes part by part, below).
  return cached(key('details2', plant.id, mode), () => sourcesFor(mode).details(plant, { signal }));
}

/**
 * Flowering / fruiting observations per month in France (iNaturalist), cached like the details.
 * @param {any} plant
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ all: number[], flowering: number[], fruiting: number[], taxonId: number, sourceUrl: string } | null>}
 */
export function phenology(plant, signal, /** @type {Mode | undefined} */ mode) {
  return cached(key('phenology', plant.id, mode), () => sourcesFor(mode).phenology(plant, { signal }));
}

/** @param {any} plant */
export const links = plant => sourcesFor().links(plant);

/**
 * French Wikipedia lead paragraph, through the plant's Wikidata item.
 * @param {any} plant
 * @param {string | null | undefined} qid
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ title: string, extract: string, url: string } | null>}
 */
export function wikipedia(plant, qid, signal, /** @type {Mode | undefined} */ mode) {
  if (!qid) return Promise.resolve(null);
  return cached(key('wikipedia', plant.id, mode), async () => {
    const claims = await sourcesFor(mode).wikidataClaims(qid, { signal });
    return claims?.frwiki ? sourcesFor(mode).wikipediaSummary(claims.frwiki, { signal }) : null;
  });
}

/**
 * Scientific view: Wikidata classification (P171 chain), IUCN status and identifiers.
 * @param {any} plant
 * @param {string | null | undefined} qid
 * @param {AbortSignal} [signal]
 */
export function wikidataScience(plant, qid, signal, /** @type {Mode | undefined} */ mode) {
  if (!qid) return Promise.resolve(null);
  return cached(key('wikidata-science', plant.id, mode), () => sourcesFor(mode).wikidataScience(qid, { signal }));
}

/**
 * GBIF occurrences recorded in France (presences, coordinates without known issue).
 * @param {any} plant
 * @param {number | null | undefined} gbifKey
 * @param {AbortSignal} [signal]
 * @returns {Promise<number | null>}
 */
export function occurrencesFR(plant, gbifKey, signal, /** @type {Mode | undefined} */ mode) {
  return gbifStats(plant, gbifKey, signal, mode).then(stats => stats?.count ?? null);
}

// ── GBIF, part by part: each block asks only for what it shows ────────────────────────────────────────

/**
 * The plant's GBIF Backbone taxon (key and match), for pages that need it without the whole sheet (Carte).
 * @param {any} plant @param {AbortSignal} [signal] @param {Mode} [mode]
 */
export function gbifTaxon(plant, signal, mode) {
  return cached(key('gbif-taxon', plant.id, mode), () => sourcesFor(mode).gbifTaxon(plant, { signal }));
}

/**
 * One kind of species data: 'vernacularNames' | 'descriptions' | 'distributions' | 'speciesProfiles' | 'synonyms' | 'iucnRedListCategory'.
 * @param {any} plant @param {number | null | undefined} gbifKey @param {string} part @param {AbortSignal} [signal] @param {Mode} [mode]
 */
export function gbifSpecies(plant, gbifKey, part, signal, mode) {
  if (!gbifKey) return Promise.resolve(null);
  return cached(key('gbif-' + part, plant.id, mode), () => sourcesFor(mode).gbifSpecies(gbifKey, part, { signal }));
}

/**
 * Occurrences in France: count, by month, year, kind of record, dataset, region and département.
 * @param {any} plant @param {number | null | undefined} gbifKey @param {AbortSignal} [signal] @param {Mode} [mode]
 */
export function gbifStats(plant, gbifKey, signal, mode) {
  if (!gbifKey) return Promise.resolve(null);
  return cached(key('gbif-stats', plant.id, mode), () => sourcesFor(mode).gbifOccurrenceStats(gbifKey, { signal }));
}

/**
 * Images of occurrences: 'herbarium' (preserved specimens) or 'photos' (field observations in France).
 * @param {any} plant @param {number | null | undefined} gbifKey @param {'herbarium' | 'photos'} kind @param {AbortSignal} [signal] @param {Mode} [mode]
 */
export function gbifMedia(plant, gbifKey, kind, signal, mode) {
  if (!gbifKey) return Promise.resolve([]);
  return cached(key('gbif-media2-' + kind, plant.id, mode), () => sourcesFor(mode).gbifOccurrenceMedia(gbifKey, kind, { signal }));
}

/** @param {any} plant @param {number | null | undefined} gbifKey @param {AbortSignal} [signal] @param {Mode} [mode] */
export function gbifLiterature(plant, gbifKey, signal, mode) {
  if (!gbifKey) return Promise.resolve(null);
  return cached(key('gbif-literature', plant.id, mode), () => sourcesFor(mode).gbifLiterature(gbifKey, { signal }));
}

/** Title of a GBIF dataset (cached for every plant). @param {string} datasetKey @param {AbortSignal} [signal] @param {Mode} [mode] */
export function gbifDatasetTitle(datasetKey, signal, mode) {
  if (!moduleOn('gbif', mode || appMode())) return Promise.resolve(null);
  return cached('gbif-dataset:' + datasetKey, () => sourcesFor(mode).gbifDatasetTitle(datasetKey, { signal }));
}

/** Name of a region or département (GADM id). @param {string} gid @param {AbortSignal} [signal] @param {Mode} [mode] */
export function gadmName(gid, signal, mode) {
  if (!moduleOn('gbif', mode || appMode())) return Promise.resolve(null);
  return cached('gadm:' + gid, () => sourcesFor(mode).gadmName(gid, { signal }));
}

/**
 * GBIF occurrences around a point (never cached: the position changes).
 * @param {number | null | undefined} gbifKey @param {[number, number]} point [lon, lat] @param {number} radius metres
 * @param {AbortSignal} [signal] @param {Mode} [mode] @param {number} [limit] how many of the nearest
 */
export function gbifNear(gbifKey, point, radius, signal, mode, limit = 5) {
  if (!gbifKey) return Promise.resolve(null);
  return sourcesFor(mode).gbifNear(gbifKey, point, radius, { signal, limit });
}

/**
 * The extent of a taxon's occurrences matching a filter (see PlantSources.gbifOccurrenceBounds).
 * @param {number | null | undefined} gbifKey @param {Record<string, string>} filter @param {AbortSignal} [signal] @param {Mode} [mode]
 */
export function gbifBounds(gbifKey, filter, signal, mode) {
  if (!gbifKey) return Promise.resolve(null);
  const id = Object.entries(filter).sort().map(([k, v]) => k + '=' + v).join('&');
  return cached('gbif-bounds:' + gbifKey + ':' + id, () => sourcesFor(mode).gbifOccurrenceBounds(gbifKey, filter, { signal }));
}

/**
 * GBIF map tiles of a taxon (v2 maps API), optionally in one country: the precomputed density, or, with a
 * filter (GADM area, month, year, kind of record, dataset, country), tiles drawn for it (presences with
 * clean coordinates). `style`: GBIF's palette (another one tells a compared plant apart).
 * @param {number} gbifKey @param {string} [country] @param {Record<string, string> | null} [filter] @param {string} [style]
 */
export function gbifTileUrl(gbifKey, country, filter, style = 'classic.point') {
  const base = `{z}/{x}/{y}@1x.png?srs=EPSG:3857&style=${style}&taxonKey=${gbifKey}`;
  if (!filter || !Object.keys(filter).length) return `https://api.gbif.org/v2/map/occurrence/density/${base}${country ? '&country=' + country : ''}`;
  const all = { ...(country && !filter.gadmGid && !filter.country ? { country } : {}), ...filter, occurrenceStatus: 'PRESENT', hasGeospatialIssue: 'false' };
  return `https://api.gbif.org/v2/map/occurrence/adhoc/${base}&` + Object.entries(all).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
}
