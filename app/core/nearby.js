// @ts-check
// "Autour": plant species observed within a radius, from iNaturalist research-grade observations
// (identification confirmed by the community). All observations ever made in the circle, not per month.
// Species are matched to the local flora (TAXREF) by scientific name or synonym.

import * as db from './db.js';
import { ModuleOffError, moduleOn } from './modules.js';

const API = 'https://api.inaturalist.org/v1';
/** Results kept a day (offline: an older copy is better than nothing). */
const TTL = 24 * 3600 * 1000;

/** Radii offered, in metres. */
export const RADII = [500, 1000, 2000, 5000, 10000];
export const DEFAULT_RADIUS = 5000;

/**
 * @typedef {{ taxonId: number, name: string, common: string | null, count: number, photo: string | null, plantId: number | null, family: string | null, genus: string | null }} NearbySpecies
 * @typedef {{ species: NearbySpecies[], observations: number, sourceUrl: string, fetchedAt: number }} NearbyResult
 * @typedef {{ coordinates: [number, number], date: string | null, url: string }} NearbyObservation
 */

const area = ([lon, lat], radius) =>
  `lat=${lat.toFixed(5)}&lng=${lon.toFixed(5)}&radius=${(radius / 1000).toFixed(2)}`;

/** iNaturalist page listing what this query counts. */
export const exploreUrl = (/** @type {[number, number]} */ point, /** @type {number} */ radius, /** @type {number} */ taxonId = 0) =>
  `https://www.inaturalist.org/observations?${area(point, radius)}&quality_grade=research&${taxonId ? 'taxon_id=' + taxonId : 'iconic_taxa=Plantae'}`;

/** @param {string} url @param {AbortSignal} [signal] */
async function json(url, signal) {
  const response = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`iNaturalist ${response.status}`);
  return response.json();
}

/** @template T @param {string} key @param {() => Promise<T>} load @returns {Promise<T>} */
async function cached(key, load) {
  const hit = await db.get('plantDetails', key).catch(() => null);
  if (hit && Date.now() - hit.fetchedAt < TTL) return hit.value;
  try {
    const value = await load();
    await db.put('plantDetails', { key, fetchedAt: Date.now(), value }).catch(() => {});
    return value;
  } catch (error) {
    if (hit && /** @type {Error} */ (error).name !== 'AbortError') return hit.value;
    throw error;
  }
}

/** Lower-case "Genus species" (hybrids and infraspecific ranks reduced to the binomial). */
export const binomial = (/** @type {string} */ name) =>
  String(name || '').toLowerCase().replace(/\s+[×x]\s+/, ' x ').split(/\s+/).slice(0, 2).join(' ');

/** First word of a scientific name; an intergeneric hybrid keeps its sign ("× Anacamptorchis"). */
const genusOf = (/** @type {string} */ name) => {
  const [first, second] = String(name || '').split(/\s+/);
  return (first === 'x' || first === '×') && second ? '× ' + second : first || null;
};

/** @typedef {{ id: number, family: string, genus: string }} FloraMatch */

/** @type {Promise<Map<string, FloraMatch>> | null} */
let index = null;
/** Scientific names and synonyms of the local flora → TAXREF id, family, genus. */
function nameIndex() {
  index ??= db.getAll('plants').then(plants => {
    const map = new Map();
    const match = (/** @type {any} */ p) => ({ id: p.id, family: p.family, genus: p.genus });
    for (const p of plants) {
      for (const name of p.synonyms || []) if (!map.has(binomial(name))) map.set(binomial(name), match(p));
    }
    // Accepted names win over synonyms.
    for (const p of plants) map.set(binomial(p.scientificName), match(p));
    return map;
  });
  index.catch(() => { index = null; });
  return index;
}

/**
 * Plant species observed in the circle, most observed first.
 * @param {[number, number]} point [lon, lat]
 * @param {number} radius metres
 * @param {AbortSignal} [signal]
 * @returns {Promise<NearbyResult>}
 */
export async function speciesAround(point, radius, signal) {
  if (!moduleOn('inaturalist')) throw new ModuleOffError('inaturalist');
  const key = `around:${area(point, radius)}`;
  const raw = await cached(key, async () => {
    const data = await json(`${API}/observations/species_counts?${area(point, radius)}&iconic_taxa=Plantae&quality_grade=research&locale=fr&per_page=500`, signal);
    return (data.results || []).map(r => ({
      taxonId: r.taxon.id,
      name: r.taxon.name,
      common: r.taxon.preferred_common_name || null,
      count: r.count,
      photo: r.taxon.default_photo?.square_url || null
    }));
  });
  const names = await nameIndex().catch(() => new Map());
  const species = raw.map(s => {
    const local = names.get(binomial(s.name));
    return {
      ...s,
      plantId: local?.id ?? null,
      // Family only from the local flora (TAXREF); the genus is the first word of the name otherwise.
      family: local?.family || null,
      genus: local?.genus || genusOf(s.name)
    };
  });
  return {
    species,
    observations: species.reduce((sum, s) => sum + s.count, 0),
    sourceUrl: exploreUrl(point, radius),
    fetchedAt: Date.now()
  };
}

/**
 * Where one species was observed in the circle (up to 200 most recent observations).
 * @param {number} taxonId
 * @param {[number, number]} point
 * @param {number} radius
 * @param {AbortSignal} [signal]
 * @returns {Promise<NearbyObservation[]>}
 */
export function observationsAround(taxonId, point, radius, signal) {
  if (!moduleOn('inaturalist')) return Promise.reject(new ModuleOffError('inaturalist'));
  return cached(`around-obs2:${taxonId}:${area(point, radius)}`, async () => {
    const { results } = await paged(`taxon_id=${taxonId}&${area(point, radius)}&quality_grade=research&order_by=observed_on`, 600, signal);
    return results.map(toObservation);
  });
}

/** An iNaturalist observation, for a map. @param {any} o @returns {NearbyObservation} */
const toObservation = o => ({ coordinates: /** @type {[number, number]} */ (o.geojson.coordinates), date: o.observed_on || null, url: o.uri || `https://www.inaturalist.org/observations/${o.id}` });

/**
 * Up to `max` observations of a query (200 a page, iNaturalist's most: the first page tells how many there are,
 * the next ones are asked together), with their true total.
 * @param {string} query @param {number} max @param {AbortSignal} [signal]
 * @returns {Promise<{ results: any[], total: number }>}
 */
async function paged(query, max, signal) {
  const PER = 200;
  const first = await json(`${API}/observations?${query}&per_page=${PER}&page=1`, signal);
  const total = Number(first.total_results) || (first.results || []).length;
  const pages = Math.min(Math.ceil(Math.min(total, max) / PER), Math.ceil(max / PER));
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) =>
    json(`${API}/observations?${query}&per_page=${PER}&page=${i + 2}`, signal).catch(() => ({ results: [] }))));
  const results = [first, ...rest].flatMap(d => d.results || []).filter(o => Array.isArray(o.geojson?.coordinates));
  return { results, total };
}

/**
 * Where one species was observed in a box (a région, a country, the world): up to 1000 of the latest
 * research-grade observations, and how many there are in all. Cached a day.
 * @param {number} taxonId @param {[number, number, number, number]} box [west, south, east, north]
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ points: NearbyObservation[], total: number }>}
 */
export function observationsInBox(taxonId, [w, s, e, n], signal) {
  if (!moduleOn('inaturalist')) return Promise.reject(new ModuleOffError('inaturalist'));
  const box = `swlat=${s.toFixed(3)}&swlng=${w.toFixed(3)}&nelat=${n.toFixed(3)}&nelng=${e.toFixed(3)}`;
  return cached(`box-obs:${taxonId}:${box}`, async () => {
    const { results, total } = await paged(`taxon_id=${taxonId}&${box}&quality_grade=research&order_by=observed_on`, 1000, signal);
    return { points: results.map(toObservation), total };
  });
}

/**
 * Where plants were observed in the circle: the 100 most recent research-grade observations (every species), each
 * with its photo, names, date and place — for a map behind the distance chosen —, and how many there are in all.
 * Cached for a day like the rest.
 * @param {[number, number]} point @param {number} radius @param {AbortSignal} [signal]
 * @returns {Promise<{ points: AroundPoint[], total: number }>}
 */
export function observationPointsAround(point, radius, signal) {
  if (!moduleOn('inaturalist')) return Promise.reject(new ModuleOffError('inaturalist'));
  return cached(`around-points3:${area(point, radius)}`, async () => {
    const data = await json(`${API}/observations?${area(point, radius)}&iconic_taxa=Plantae&quality_grade=research&locale=fr&per_page=100&order_by=observed_on`, signal);
    const points = (data.results || []).filter(o => Array.isArray(o.geojson?.coordinates)).map(o => {
      const photo = o.photos?.[0]?.url || o.taxon?.default_photo?.square_url || null;
      const common = o.taxon?.preferred_common_name || null, sci = o.taxon?.name || '';
      return {
        coordinates: /** @type {[number, number]} */ (o.geojson.coordinates),
        title: common || sci || 'Plante', common, sci,
        photo: photo ? photo.replace(/\/(square|thumb|small|medium)\./, '/square.') : null,
        date: o.observed_on || null, place: o.place_guess || null,
        url: o.uri || `https://www.inaturalist.org/observations/${o.id}`
      };
    });
    return { points, total: Number(data.total_results) || points.length };
  });
}

/**
 * @typedef {{ coordinates: [number, number], title: string, common: string | null, sci: string, photo: string | null,
 *   date: string | null, place: string | null, url: string }} AroundPoint
 */

/** The radius chosen last (Carte → Autour). */
export function savedRadius() {
  try {
    const value = Number(localStorage.getItem('geoflora.aroundRadius'));
    return RADII.includes(value) ? value : DEFAULT_RADIUS;
  } catch { return DEFAULT_RADIUS; }
}

/** @param {number} radius */
export function saveRadius(radius) {
  try { localStorage.setItem('geoflora.aroundRadius', String(radius)); } catch { /* not persisted */ }
}
