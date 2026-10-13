// @ts-check
// "Autour": plant species observed within a radius, from iNaturalist research-grade observations
// (identification confirmed by the community). All observations ever made in the circle, not per month.
// Species are matched to the local flora (TAXREF) by scientific name or synonym.

import * as db from './db.js';
import { ModuleOffError, moduleOn } from './modules.js';
import { inatCredit } from './credit.js';

const API = 'https://api.inaturalist.org/v1';
/** Results kept a day (offline: an older copy is better than nothing). */
const TTL = 24 * 3600 * 1000;

/** Radii offered, in metres. */
export const RADII = [500, 1000, 2000, 5000, 10000];
export const DEFAULT_RADIUS = 5000;

/**
 * @typedef {import('./credit.js').Credit} Credit
 * @typedef {{ taxonId: number, name: string, common: string | null, count: number, photo: string | null, credit: Credit | null, plantId: number | null, family: string | null, genus: string | null }} NearbySpecies
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

/** Lower-case "Genus species" (infraspecific ranks reduced to the binomial; a hybrid's is never looked up, see nameIndex). */
export const binomial = (/** @type {string} */ name) =>
  String(name || '').toLowerCase().replace(/\s+[×x]\s+/, ' x ').split(/\s+/).slice(0, 2).join(' ');

/** Lower-case scientific name, single-spaced, the hybrid sign as « x » (iNaturalist writes « × », TAXREF « x »). */
const fullName = (/** @type {string} */ name) => String(name || '').toLowerCase().replace(/×/g, ' x ').trim().split(/\s+/).join(' ');

/** A hybrid: a formula (« A b x C d ») or a nothotaxon (« A x b », « x Genus b »). */
const isHybrid = (/** @type {string} */ name) => /(^| )x( |$)/.test(fullName(name));

/** First word of a scientific name; an intergeneric hybrid keeps its sign ("× Anacamptorchis"). */
const genusOf = (/** @type {string} */ name) => {
  const [first, second] = String(name || '').split(/\s+/);
  return (first === 'x' || first === '×') && second ? '× ' + second : first || null;
};

/** @typedef {{ id: number, family: string, genus: string }} FloraMatch */

/** @type {Promise<{ exact: Map<string, FloraMatch>, loose: Map<string, FloraMatch> }> | null} */
let index = null;
/**
 * Scientific names and synonyms of the local flora → TAXREF id, family, genus. `exact`: whole names, accepted names
 * winning over synonyms. `loose`: their binomials, for an infraspecific name (iNaturalist's « Daucus carota sativus »),
 * never from a hybrid: « Heracleum mantegazzianum x Heracleum sphondylium » would take the place of the species,
 * and lose its alerts; a species' own name wins over its subspecies', an accepted name over a synonym.
 */
function nameIndex() {
  index ??= db.getAll('plants').then(plants => {
    const match = (/** @type {any} */ p) => ({ id: p.id, family: p.family, genus: p.genus });
    /** @type {Map<string, FloraMatch>} */ const exact = new Map();
    /** @type {Map<string, FloraMatch>} */ const loose = new Map();
    /** @type {Map<string, number>} */ const rank = new Map();
    const put = (/** @type {string} */ name, /** @type {any} */ p, /** @type {number} */ r) => {
      if (isHybrid(name)) return;
      const key = binomial(name);
      if ((rank.get(key) ?? -1) < r) { rank.set(key, r); loose.set(key, match(p)); }
    };
    for (const p of plants) {
      for (const name of p.synonyms || []) { if (!exact.has(fullName(name))) exact.set(fullName(name), match(p)); put(name, p, 0); }
    }
    for (const p of plants) {
      exact.set(fullName(p.scientificName), match(p));
      put(p.scientificName, p, fullName(p.scientificName) === binomial(p.scientificName) ? 2 : 1);
    }
    return { exact, loose };
  });
  index.catch(() => { index = null; });
  return index;
}

/** The plant of the flora an iNaturalist name is: the whole name first, the binomial only for a non-hybrid. */
const lookup = (/** @type {{ exact: Map<string, FloraMatch>, loose: Map<string, FloraMatch> }} */ names, /** @type {string} */ name) =>
  names.exact.get(fullName(name)) ?? (isHybrid(name) ? undefined : names.loose.get(binomial(name)));

/**
 * Plant species observed in the circle, most observed first.
 * @param {[number, number]} point [lon, lat]
 * @param {number} radius metres
 * @param {AbortSignal} [signal]
 * @returns {Promise<NearbyResult>}
 */
export async function speciesAround(point, radius, signal) {
  if (!moduleOn('inaturalist')) throw new ModuleOffError('inaturalist');
  // « around2 »: the results cached before the licences were read (every photo kept) are not used again.
  const key = `around2:${area(point, radius)}`;
  const raw = await cached(key, async () => {
    const data = await json(`${API}/observations/species_counts?${area(point, radius)}&iconic_taxa=Plantae&quality_grade=research&locale=fr&per_page=500`, signal);
    return (data.results || []).map(r => {
      // The taxon's photo only under a free licence, with its credit; else none (the flora's thumbnail, if any).
      const photo = r.taxon.default_photo?.square_url || null;
      const credit = photo ? inatCredit(r.taxon.default_photo) : null;
      return {
        taxonId: r.taxon.id,
        name: r.taxon.name,
        common: r.taxon.preferred_common_name || null,
        count: r.count,
        photo: credit ? photo : null,
        credit
      };
    });
  });
  const names = await nameIndex().catch(() => ({ exact: new Map(), loose: new Map() }));
  const species = raw.map(s => {
    const local = lookup(names, s.name);
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
  // « around-points5 »: the points cached before the licences were read are not used again.
  return cached(`around-points5:${area(point, radius)}`, async () => {
    const data = await json(`${API}/observations?${area(point, radius)}&iconic_taxa=Plantae&quality_grade=research&locale=fr&per_page=100&order_by=observed_on`, signal);
    const points = (data.results || []).filter(o => Array.isArray(o.geojson?.coordinates)).map(o => {
      const url = o.uri || `https://www.inaturalist.org/observations/${o.id}`;
      // The observation's first photo under a free licence, else the taxon's (free too), else none: a leaf.
      const own = (o.photos || []).find((/** @type {any} */ p) => p?.url && inatCredit(p));
      const taxon = !own && o.taxon?.default_photo?.square_url && inatCredit(o.taxon.default_photo) ? o.taxon.default_photo : null;
      const photo = own?.url || taxon?.square_url || null;
      const common = o.taxon?.preferred_common_name || null, sci = o.taxon?.name || '';
      return {
        coordinates: /** @type {[number, number]} */ (o.geojson.coordinates),
        title: common || sci || 'Plante', common, sci, taxonId: o.taxon?.id ?? null,
        photo: photo ? photo.replace(/\/(square|thumb|small|medium)\./, '/square.') : null,
        credit: own ? inatCredit(own, url) : taxon ? inatCredit(taxon) : null,
        date: o.observed_on || null, place: o.place_guess || null,
        url
      };
    });
    return { points, total: Number(data.total_results) || points.length };
  });
}

/**
 * @typedef {{ coordinates: [number, number], title: string, common: string | null, sci: string, taxonId: number | null, photo: string | null,
 *   credit: Credit | null, date: string | null, place: string | null, url: string }} AroundPoint
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
