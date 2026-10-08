// @ts-check
// "Autour": plant species observed within a radius, from iNaturalist research-grade observations
// (identification confirmed by the community). All observations ever made in the circle, not per month.
// Species are matched to the local flora (TAXREF) by scientific name or synonym.

import * as db from './db.js';

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
  return cached(`around-obs:${taxonId}:${area(point, radius)}`, async () => {
    const data = await json(`${API}/observations?taxon_id=${taxonId}&${area(point, radius)}&quality_grade=research&per_page=200&order_by=observed_on`, signal);
    return (data.results || [])
      .filter(o => Array.isArray(o.geojson?.coordinates))
      .map(o => ({ coordinates: /** @type {[number, number]} */ (o.geojson.coordinates), date: o.observed_on || null, url: o.uri || `https://www.inaturalist.org/observations/${o.id}` }));
  });
}

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
