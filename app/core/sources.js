// @ts-check
// Remote enrichment: lib/plant-sources.mjs behind a persistent IndexedDB cache.

import { PlantSources } from '../../lib/plant-sources.mjs';
import { config } from '../config.js';
import * as cache from './cache.js';
import { moduleEvents, moduleOn, modulesSignature } from './modules.js';
import { fetchJson } from './net.js';
import { readText, writeText } from './prefs.js';

/** @returns {string | null} */
export function getTrefleToken() {
  return readText(config.storageKeys.trefleToken) || null;
}

/** @param {string | null} token */
export function setTrefleToken(token) {
  // Storage unavailable: the token simply won't persist.
  writeText(config.storageKeys.trefleToken, token || null);
  instance = null;
}

/** The PlantSources calling only the modules on (made again when a module or the Trefle token changes). @type {PlantSources | null} */
let instance = null;
const sourcesFor = () => instance ??= new PlantSources({ trefleToken: getTrefleToken(), enabled: (/** @type {any} */ k) => moduleOn(k), fetchJson });
// A module switched on again must not get an empty answer from the in-memory cache of an old instance.
moduleEvents.addEventListener('change', () => { instance = null; });

/** Cache key of a plant's remote data: it changes with the modules off, so their data never shows. */
const key = (/** @type {string} */ kind, /** @type {number} */ id) => {
  const off = modulesSignature();
  return kind + ':' + id + (off ? '|off:' + off : '');
};

/** A result gathering several services, some of which failed (lib/plant-sources.mjs `unavailable`). @param {any} value */
const degraded = value => Boolean(value?.unavailable?.length);

/**
 * A plant's remote data, cached for config.remoteTtl (core/cache.js: shared requests in flight, failures never stored,
 * a degraded result kept a few minutes, an expired copy offline).
 * @template T @param {string} key @param {() => Promise<T>} loader @param {AbortSignal} [signal] @returns {Promise<T>}
 */
const cached = (key, loader, signal) => cache.cached(key, loader, { ttl: config.remoteTtl, partial: degraded, signal });

/**
 * Thumbnail for a list row: the one embedded in plants.json, otherwise a remote lookup.
 * @param {any} plant
 * @param {AbortSignal} [signal]
 */
export function thumbnail(plant, signal) {
  if (plant.thumbnail?.url) return Promise.resolve(plant.thumbnail);
  // 'thumb2': 'thumb' kept null for a week when the services failed (audit STO-9); a failure is now thrown, not stored.
  return cached(key('thumb2', plant.id), () => sourcesFor().thumbnail(plant, { signal }), signal);
}

/**
 * Everything the detail page needs (identifiers, GBIF, Commons, Trefle, links).
 * @param {any} plant
 * @param {AbortSignal} [signal]
 */
export function details(plant, signal) {
  // 'details3': 'details2' held results of failed calls as « nothing found » for a week (audit STO-9, OPS-2); a
  // degraded result (some services failed: `unavailable`) is now kept a few minutes only.
  return cached(key('details3', plant.id), () => sourcesFor().details(plant, { signal }), signal);
}

/**
 * Flowering / fruiting observations per month in France (iNaturalist), cached like the details.
 * @param {any} plant
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ all: number[], flowering: number[], fruiting: number[], taxonId: number, sourceUrl: string } | null>}
 */
export function phenology(plant, signal) {
  return cached(key('phenology', plant.id), () => sourcesFor().phenology(plant, { signal }), signal);
}

/** @param {any} plant */
export const links = plant => sourcesFor().links(plant);

/**
 * The plant's French Wikipedia article (lead, description, sections by theme), through its Wikidata item —
 * with the item's other French names; no French article: the English one's address only.
 * @param {any} plant
 * @param {string | null | undefined} qid
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ title?: string, extract?: string, url: string | null, description?: string | null, touched?: string | null,
 *   sections: { theme: string, title: string, text: string }[], aliases: string[], english?: string | null } | null>}
 */
export function wikipedia(plant, qid, signal) {
  if (!qid) return Promise.resolve(null);
  return cached(key('wikipedia2', plant.id), async () => {
    const claims = await sourcesFor().wikidataClaims(qid, { signal });
    if (!claims) return null;
    const aliases = claims.aliases || [];
    const english = claims.enwiki ? 'https://en.wikipedia.org/wiki/' + encodeURIComponent(claims.enwiki.replace(/ /g, '_')) : null;
    const article = claims.frwiki ? await sourcesFor().wikipediaArticle(claims.frwiki, { signal }) : null;
    if (article) return { ...article, aliases, english };
    return aliases.length || english ? { url: null, extract: '', sections: [], aliases, english } : null;
  }, signal);
}

/**
 * Scientific view: Wikidata classification (P171 chain), IUCN status and identifiers.
 * @param {any} plant
 * @param {string | null | undefined} qid
 * @param {AbortSignal} [signal]
 */
export function wikidataScience(plant, qid, signal) {
  if (!qid) return Promise.resolve(null);
  return cached(key('wikidata-science', plant.id), () => sourcesFor().wikidataScience(qid, { signal }), signal);
}

// ── GBIF, part by part: each block asks only for what it shows ────────────────────────────────────────

/**
 * The plant's GBIF Backbone taxon (key and match), for pages that need it without the whole sheet (Carte).
 * @param {any} plant @param {AbortSignal} [signal]
 */
export function gbifTaxon(plant, signal) {
  return cached(key('gbif-taxon', plant.id), () => sourcesFor().gbifTaxon(plant, { signal }), signal);
}

/**
 * One kind of species data: 'vernacularNames' | 'descriptions' | 'distributions' | 'speciesProfiles' | 'synonyms' | 'iucnRedListCategory'.
 * @param {any} plant @param {number | null | undefined} gbifKey @param {string} part @param {AbortSignal} [signal]
 */
export function gbifSpecies(plant, gbifKey, part, signal) {
  if (!gbifKey) return Promise.resolve(null);
  return cached(key('gbif-' + part, plant.id), () => sourcesFor().gbifSpecies(gbifKey, part, { signal }), signal);
}

/**
 * Occurrences in France: count, by month, year, kind of record, dataset, region and département.
 * @param {any} plant @param {number | null | undefined} gbifKey @param {AbortSignal} [signal]
 */
export function gbifStats(plant, gbifKey, signal) {
  if (!gbifKey) return Promise.resolve(null);
  return cached(key('gbif-stats', plant.id), () => sourcesFor().gbifOccurrenceStats(gbifKey, { signal }), signal);
}

/**
 * Images of occurrences: 'herbarium' (preserved specimens) or 'photos' (field observations in France).
 * @param {any} plant @param {number | null | undefined} gbifKey @param {'herbarium' | 'photos'} kind @param {AbortSignal} [signal]
 */
export function gbifMedia(plant, gbifKey, kind, signal) {
  if (!gbifKey) return Promise.resolve([]);
  // media3: records read again since their free-text fields are plain text (lib/plant-sources.mjs, audit SEC-2).
  return cached(key('gbif-media3-' + kind, plant.id), () => sourcesFor().gbifOccurrenceMedia(gbifKey, kind, { signal }), signal);
}

/**
 * The photos chosen for the taxon on iNaturalist (free licences, every size), for the media viewer.
 * @param {any} plant @param {number | null | undefined} taxonId @param {AbortSignal} [signal]
 */
export function inaturalistPhotos(plant, taxonId, signal) {
  if (!taxonId) return Promise.resolve([]);
  return cached(key('inat-photos', plant.id), () => sourcesFor().inaturalistPhotos(taxonId, { signal }), signal);
}

/** @param {any} plant @param {number | null | undefined} gbifKey @param {AbortSignal} [signal] */
export function gbifLiterature(plant, gbifKey, signal) {
  if (!gbifKey) return Promise.resolve(null);
  return cached(key('gbif-literature', plant.id), () => sourcesFor().gbifLiterature(gbifKey, { signal }), signal);
}

/** Title of a GBIF dataset (cached for every plant). @param {string} datasetKey @param {AbortSignal} [signal] */
export function gbifDatasetTitle(datasetKey, signal) {
  if (!moduleOn('gbif')) return Promise.resolve(null);
  return cached('gbif-dataset:' + datasetKey, () => sourcesFor().gbifDatasetTitle(datasetKey, { signal }), signal);
}

/** Name of a region or département (GADM id). @param {string} gid @param {AbortSignal} [signal] */
export function gadmName(gid, signal) {
  if (!moduleOn('gbif')) return Promise.resolve(null);
  return cached('gadm:' + gid, () => sourcesFor().gadmName(gid, { signal }), signal);
}

/**
 * GBIF occurrences around a point (never cached: the position changes).
 * @param {number | null | undefined} gbifKey @param {[number, number]} point [lon, lat] @param {number} radius metres
 * @param {AbortSignal} [signal] @param {number} [limit] how many of the nearest
 */
export function gbifNear(gbifKey, point, radius, signal, limit = 5) {
  if (!gbifKey) return Promise.resolve(null);
  return sourcesFor().gbifNear(gbifKey, point, radius, { signal, limit });
}

/**
 * The extent of a taxon's occurrences matching a filter (see PlantSources.gbifOccurrenceBounds).
 * @param {number | null | undefined} gbifKey @param {Record<string, string>} filter @param {AbortSignal} [signal]
 */
export function gbifBounds(gbifKey, filter, signal) {
  if (!gbifKey) return Promise.resolve(null);
  const id = Object.entries(filter).sort().map(([k, v]) => k + '=' + v).join('&');
  // « gbif-bounds3 »: the occurrences cached without their place, dataset and record number are not used again.
  return cached('gbif-bounds3:' + gbifKey + ':' + id, () => sourcesFor().gbifOccurrenceBounds(gbifKey, filter, { signal }), signal);
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
