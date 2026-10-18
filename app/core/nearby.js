// @ts-check
// "Autour": plant species observed within a radius, from iNaturalist research-grade observations
// (identification confirmed by the community). All observations ever made in the circle, not per month.
// Species are matched to the local flora (TAXREF) by scientific name or synonym.

import * as cache from './cache.js';
import * as db from './db.js';
import { ModuleOffError, moduleOn } from './modules.js';
import { fetchJson } from './net.js';
import { inatCredit, thumbCredit } from './credit.js';
import { cachedCredit, cachedThumb, thumbUrl } from './thumb.js';

const API = 'https://api.inaturalist.org/v1';
/** Results kept a day (offline: an older copy is better than nothing). */
const TTL = 24 * 3600 * 1000;

/** Radii offered, in metres. */
export const RADII = [500, 1000, 2000, 5000, 10000];
export const DEFAULT_RADIUS = 5000;

/**
 * @typedef {import('./credit.js').Credit} Credit
 * @typedef {{ taxonId: number | null, name: string, common: string | null, count: number, photo: string | null, credit: Credit | null, plantId: number | null, family: string | null, genus: string | null }} NearbySpecies
 *   `taxonId`: iNaturalist's (null: a plant known by another source only — GBIF's — speciesOf)
 * @typedef {{ species: NearbySpecies[], observations: number, sourceUrl: string, fetchedAt: number }} NearbyResult
 * @typedef {{ coordinates: [number, number], date: string | null, url: string, place?: string | null }} NearbyObservation
 */

const area = ([lon, lat], radius) =>
  `lat=${lat.toFixed(5)}&lng=${lon.toFixed(5)}&radius=${(radius / 1000).toFixed(2)}`;

/**
 * A period in iNaturalist's words: this year's observations (`annee`), this month's of any year — what flowers now
 * (`mois`); else every one ('' — `toujours`). @param {string | null | undefined} periode @param {Date} [now]
 */
export const periodQuery = (periode, now = new Date()) =>
  periode === 'annee' ? `&year=${now.getFullYear()}` : periode === 'mois' ? `&month=${now.getMonth() + 1}` : '';

/** iNaturalist page listing what this query counts. */
export const exploreUrl = (/** @type {[number, number]} */ point, /** @type {number} */ radius, /** @type {number} */ taxonId = 0) =>
  `https://www.inaturalist.org/observations?${area(point, radius)}&quality_grade=research&${taxonId ? 'taxon_id=' + taxonId : 'iconic_taxa=Plantae'}`;

/** An iNaturalist list: its `results` an array. @param {string} url @param {AbortSignal} [signal] */
const json = (url, signal) => fetchJson(url, { signal, expect: d => Array.isArray(d.results) });

/**
 * Cached a day (core/cache.js); `partial`: some pages failed (kept a few minutes only).
 * @template T @param {string} key @param {() => Promise<T>} load @param {() => boolean} [partial] @returns {Promise<T>}
 */
const cached = (key, load, partial) => cache.cached(key, load, { ttl: TTL, partial });

/** Lower-case "Genus species" (infraspecific ranks reduced to the binomial; a hybrid's is never looked up, see nameIndex). */
export const binomial = (/** @type {string} */ name) =>
  String(name || '').toLowerCase().replace(/\s+[×x]\s+/, ' x ').split(/\s+/).slice(0, 2).join(' ');

/** Lower-case scientific name, single-spaced, the hybrid sign as « x » (iNaturalist writes « × », TAXREF « x »). */
export const fullName = (/** @type {string} */ name) => String(name || '').toLowerCase().replace(/×/g, ' x ').trim().split(/\s+/).join(' ');

/** A hybrid: a formula (« A b x C d ») or a nothotaxon (« A x b », « x Genus b »). */
export const isHybrid = (/** @type {string} */ name) => /(^| )x( |$)/.test(fullName(name));

/** First word of a scientific name; an intergeneric hybrid keeps its sign ("× Anacamptorchis"). */
const genusOf = (/** @type {string} */ name) => {
  const [first, second] = String(name || '').split(/\s+/);
  return (first === 'x' || first === '×') && second ? '× ' + second : first || null;
};

/** @typedef {{ id: number, family: string, genus: string, common: string | null, thumbnail: any }} FloraMatch */

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
    // Its bundled thumbnail (plants.json) too: the photo of an observation iNaturalist gives none under a free licence;
    // and its French name, for a record that has none (GBIF's seldom do).
    const match = (/** @type {any} */ p) => ({ id: p.id, family: p.family, genus: p.genus, common: p.vernacularNames?.[0] || null, thumbnail: p.thumbnail?.url ? p.thumbnail : null });
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
 * Plant species observed in the circle, most observed first — of a period (periodQuery: this year, this month).
 * @param {[number, number]} point [lon, lat]
 * @param {number} radius metres
 * @param {AbortSignal} [signal]
 * @param {string | null} [periode]
 * @returns {Promise<NearbyResult>}
 */
export async function speciesAround(point, radius, signal, periode = null) {
  if (!moduleOn('inaturalist')) throw new ModuleOffError('inaturalist');
  const when = periodQuery(periode);
  // « around2 »: the results cached before the licences were read (every photo kept) are not used again.
  const key = `around2:${area(point, radius)}${when}`;
  const raw = await cached(key, async () => {
    const data = await json(`${API}/observations/species_counts?${area(point, radius)}&iconic_taxa=Plantae&quality_grade=research&locale=fr&per_page=500${when}`, signal);
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
  let partial = false;
  return cached(`around-obs2:${taxonId}:${area(point, radius)}`, async () => {
    const page = await paged(`taxon_id=${taxonId}&${area(point, radius)}&quality_grade=research&order_by=observed_on`, 600, signal);
    partial = page.partial;
    return page.results.map(toObservation);
  }, () => partial);
}

/** An iNaturalist observation, for a map: where, when, its page, the place it names (its card says it). @param {any} o @returns {NearbyObservation} */
const toObservation = o => ({
  coordinates: /** @type {[number, number]} */ (o.geojson.coordinates), date: o.observed_on || null, url: o.uri || `https://www.inaturalist.org/observations/${o.id}`,
  place: o.place_guess || null
});

/**
 * Up to `max` observations of a query (200 a page, iNaturalist's most: the first page tells how many there are,
 * the next ones are asked together), with their true total.
 * @param {string} query @param {number} max @param {AbortSignal} [signal]
 * `partial`: a page after the first failed (its observations are missing).
 * @returns {Promise<{ results: any[], total: number, partial: boolean }>}
 */
async function paged(query, max, signal) {
  const PER = 200;
  const first = await json(`${API}/observations?${query}&per_page=${PER}&page=1`, signal);
  const total = Number(first.total_results) || first.results.length;
  const pages = Math.min(Math.ceil(Math.min(total, max) / PER), Math.ceil(max / PER));
  let partial = false;
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) =>
    json(`${API}/observations?${query}&per_page=${PER}&page=${i + 2}`, signal)
      .catch(error => { if (error?.name === 'AbortError') throw error; partial = true; return { results: [] }; })));
  const results = [first, ...rest].flatMap(d => d.results).filter(o => Array.isArray(o.geojson?.coordinates));
  return { results, total, partial };
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
  let partial = false;
  return cached(`box-obs:${taxonId}:${box}`, async () => {
    const page = await paged(`taxon_id=${taxonId}&${box}&quality_grade=research&order_by=observed_on`, 1000, signal);
    partial = page.partial;
    return { points: page.results.map(toObservation), total: page.total };
  }, () => partial);
}

/**
 * Where plants were observed in the circle: the 100 most recent research-grade observations (every species), each
 * with its plant's photo, names, date and place — for a map behind the distance chosen —, and how many there are in
 * all. `taxa`: those of these iNaturalist taxa only (the 200 most recent) — a search narrowed to a few plants (a
 * family: orchids) whose observations are seldom among the 100 most recent of all. Cached for a day like the rest.
 * @param {[number, number]} point @param {number} radius @param {AbortSignal} [signal] @param {number[]} [taxa]
 * @returns {Promise<{ points: AroundPoint[], total: number }>}
 */
export async function observationPointsAround(point, radius, signal, taxa) {
  if (!moduleOn('inaturalist')) throw new ModuleOffError('inaturalist');
  const only = taxa?.length ? `&taxon_id=${[...taxa].sort((a, b) => a - b).join(',')}` : '';
  // « around-points6 »: the points cached with the observations' own photos are not used again.
  const found = await cached(`around-points6:${area(point, radius)}${only}`, async () => {
    const data = await json(`${API}/observations?${area(point, radius)}${only || '&iconic_taxa=Plantae'}&quality_grade=research&locale=fr&per_page=${only ? 200 : 100}&order_by=observed_on`, signal);
    const points = (data.results || []).filter(o => Array.isArray(o.geojson?.coordinates)).map(aroundPoint);
    return { points, total: Number(data.total_results) || points.length };
  });
  return withThumbs(found);
}

/** A record's key among the plants of observations (speciesOf): its iNaturalist taxon, else its name. @param {{ taxonId: number | null, sci: string }} p */
const recordKey = p => p.taxonId != null ? 't' + p.taxonId : 'n' + fullName(p.sci);

/**
 * A point's plant among those speciesOf found (its `plantOf`): by its iNaturalist taxon, else its name — GBIF's
 * records, and points drawn elsewhere (« Observations autour »), have no taxon of these.
 * @param {Map<string, number>} plantOf @param {{ taxonId?: number | null, sci?: string | null }} p @returns {number | undefined}
 */
export const plantOfPoint = (plantOf, p) => (p.taxonId != null ? plantOf.get('t' + p.taxonId) : undefined) ?? (p.sci ? plantOf.get('n' + fullName(p.sci)) : undefined);

/**
 * The plants of observations (a layout's map: its points make its list), most observed first: each iNaturalist
 * taxon once — a record without one (GBIF's) by its name —, its observations counted, its names and photo (its
 * points'), the flora's plant it is (matched as speciesAround does: one plant once, its records counted together) —
 * one the flora does not know kept, without a plant. And each record's plant (`plantOf`, by its taxon and by its
 * name: plantOfPoint), the map's points kept to the list's plants by it.
 * @param {{ taxonId: number | null, sci: string, common: string | null, photo: string | null, credit: Credit | null }[]} points
 * @returns {Promise<{ list: NearbySpecies[], plantOf: Map<string, number> }>}
 */
export async function speciesOf(points) {
  /** @type {Map<string, NearbySpecies>} */
  const by = new Map();
  for (const p of points) {
    if (!p.sci) continue;
    const key = recordKey(p);
    const had = by.get(key);
    if (had) { had.count++; if (!had.photo && p.photo) { had.photo = p.photo; had.credit = p.credit; } continue; }
    by.set(key, { taxonId: p.taxonId, name: p.sci, common: p.common, count: 1, photo: p.photo, credit: p.credit, plantId: null, family: null, genus: null });
  }
  const names = await nameIndex().catch(() => ({ exact: new Map(), loose: new Map() }));
  /** @type {Map<number, NearbySpecies>} */
  const plants = new Map();
  /** @type {Map<string, number>} */
  const plantOf = new Map();
  /** @type {NearbySpecies[]} */
  const list = [];
  for (const [key, s] of by) {
    const local = lookup(names, s.name);
    const one = { ...s, plantId: local?.id ?? null, family: local?.family || null, genus: local?.genus || genusOf(s.name) };
    if (one.plantId != null) { plantOf.set(key, one.plantId); plantOf.set('n' + fullName(s.name), one.plantId); }
    const had = one.plantId != null ? plants.get(one.plantId) : undefined;
    // The same plant again (iNaturalist's taxon and GBIF's name): one, its records together, iNaturalist's taxon kept.
    if (had) { had.count += one.count; had.taxonId ??= one.taxonId; had.photo ??= one.photo; had.credit ??= one.credit; had.common ??= one.common; continue; }
    if (one.plantId != null) plants.set(one.plantId, one);
    list.push(one);
  }
  return { list: list.sort((a, b) => b.count - a.count), plantOf };
}

/**
 * Each plant's observations among points (a layout's zone), its sources apart, by its id: a point's plant as speciesOf
 * found it (plantOfPoint: by its taxon, else its name); a point of no plant of the flora not counted.
 * @param {{ kind?: string, taxonId?: number | null, sci?: string | null }[]} points @param {Map<string, number>} plantOf
 * @returns {Map<number, { inat: number, gbif: number }>}
 */
export function plantCounts(points, plantOf) {
  /** @type {Map<number, { inat: number, gbif: number }>} */
  const out = new Map();
  for (const p of points) {
    const id = plantOfPoint(plantOf, p);
    if (id === undefined) continue;
    const c = out.get(id) ?? { inat: 0, gbif: 0 };
    if (p.kind === 'gbif') c.gbif++; else c.inat++;
    out.set(id, c);
  }
  return out;
}

/**
 * The plants of the points in a box [west, south, east, north] — what a map shows of a layout's zone: its list kept to
 * them (app/layout/state.js) —, of the sources it shows (`kinds`; null: all): their ids, in order.
 * @param {{ coordinates: [number, number], kind?: string, taxonId?: number | null, sci?: string | null }[]} points
 * @param {Map<string, number>} plantOf @param {number[]} box @param {string[] | null} [kinds] @returns {number[]}
 */
export function plantsIn(points, plantOf, [w, s, e, n], kinds = null) {
  /** @type {Set<number>} */
  const ids = new Set();
  for (const p of points) {
    const [x, y] = p.coordinates;
    if (x < w || x > e || y < s || y > n || (kinds && !kinds.includes(p.kind ?? 'inat'))) continue;
    const id = plantOfPoint(plantOf, p);
    if (id !== undefined) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

/**
 * iNaturalist's taxon for a name of the flora (a species, a genus, a family: « Orchidaceae »), or null: none. Cached
 * a day (a name found once is not asked again). @param {string} name @param {AbortSignal} [signal] @returns {Promise<number | null>}
 */
export function taxonIdOf(name, signal) {
  if (!moduleOn('inaturalist')) return Promise.reject(new ModuleOffError('inaturalist'));
  const q = String(name).trim();
  return cached(`inat-taxon1:${q.toLowerCase()}`, async () => {
    const data = await json(`${API}/taxa?q=${encodeURIComponent(q)}&is_active=true&per_page=5&locale=fr`, signal);
    const want = fullName(q);
    const hit = (data.results || []).find((/** @type {any} */ t) => fullName(t.name) === want) ?? null;
    return hit ? Number(hit.id) : null;
  });
}

/**
 * The points whose plant iNaturalist gives no photo for under a free licence get its thumbnail from the flora
 * (plants.json, with its credit) — one address a plant, the one its card and the plant chosen show —, matched by name;
 * a plant the flora does not know, or without a thumbnail, stays a leaf. Done after the cache (the cached points are iNaturalist's alone; the flora may change meanwhile),
 * never changing them (a new object for each point given a photo).
 * @param {{ points: AroundPoint[], total: number }} found @returns {Promise<{ points: AroundPoint[], total: number }>}
 */
async function withThumbs(found) {
  if (found.points.every(p => p.photo)) return found;
  return { ...found, points: await floraPhotos(found.points) };
}

/**
 * Points of any source (iNaturalist's observations, GBIF's occurrences) completed from the flora, matched by their
 * scientific name: the plant's photo on those without one — its thumbnail (plants.json), else the one found online
 * for it this session (core/thumb.js: the photo its sheet shows; findPhotos looks them up), each with its credit; one
 * address a plant, the one its card and the plant chosen show —, and with `names`, its French name on those without
 * one (GBIF's records seldom have one: their card then reads as an iNaturalist observation's). A plant the flora does
 * not know, or without a photo, stays as it was (a leaf). Never changes the points given (a cache may hold them): a
 * new object for each one completed.
 * @template {{ sci: string, photo: string | null, credit?: Credit | null, common?: string | null, title?: string }} T
 * @param {T[]} points @param {{ names?: boolean }} [o] @returns {Promise<T[]>}
 */
export async function floraPhotos(points, { names = false } = {}) {
  if (points.every(p => p.photo && (!names || p.common))) return points;
  const index = await nameIndex().catch(() => null);
  if (!index) return points;
  /** @type {Map<string, FloraMatch | undefined>} */
  const seen = new Map();
  return points.map(p => {
    if (!p.sci || (p.photo && (!names || p.common))) return p;
    if (!seen.has(p.sci)) seen.set(p.sci, lookup(index, p.sci));
    const local = seen.get(p.sci);
    const thumb = p.photo || !local ? null
      : local.thumbnail ? { url: /** @type {string} */ (local.thumbnail.url), credit: thumbCredit(local.thumbnail) }
      : cachedThumb(local.id) ? { url: /** @type {string} */ (cachedThumb(local.id)), credit: cachedCredit(local.id) } : null;
    const common = names && !p.common ? local?.common : null;
    if (!thumb && !common) return p;
    return {
      ...p,
      ...(thumb ? { photo: thumb.url, credit: thumb.credit } : {}),
      // Named by its scientific name until now: its French name instead.
      ...(common ? { common, title: !p.title || p.title === p.sci ? common : p.title } : {})
    };
  });
}

/**
 * The photos of the flora's plants among `points` still without one that are not known yet (no thumbnail in
 * plants.json, not looked up this session): looked up (core/thumb.js thumbUrl — iNaturalist's taxon photo under a
 * free licence, else Commons', as their sheet shows; a few at a time, cached), `max` plants at most. True when one
 * was found: floraPhotos then gives it to their points.
 * @param {{ sci: string, photo: string | null }[]} points @param {{ max?: number }} [o] @returns {Promise<boolean>}
 */
export async function findPhotos(points, { max = 40 } = {}) {
  const index = await nameIndex().catch(() => null);
  if (!index) return false;
  /** @type {Set<number>} */ const ids = new Set();
  /** @type {Set<string>} */ const seen = new Set();
  for (const p of points) {
    if (p.photo || !p.sci || seen.has(p.sci)) continue;
    seen.add(p.sci);
    const local = lookup(index, p.sci);
    if (local && !local.thumbnail && cachedThumb(local.id) === undefined) ids.add(local.id);
    if (ids.size >= max) break;
  }
  if (!ids.size) return false;
  const found = await Promise.all([...ids].map(id => thumbUrl(id).catch(() => null)));
  return found.some(Boolean);
}

/** iNaturalist's observations as the app shows them unless told otherwise: research grade (core/observations.js inatQuery). */
const RESEARCH = '&quality_grade=research';

/**
 * More of them, for a map that draws hundreds (the 3D view of the observations around, components/gf-map-obs3d.js; a
 * layout's map, whose plants make its list: core/observations.js): up to `max` of the most recent (200 a page), the
 * same points — of a period (periodQuery: this year, this month), as the filters say (`filters`: iNaturalist's own
 * words, core/observations.js inatQuery; research grade by default). Cached a day; a page missing, a few minutes.
 * @param {[number, number]} point @param {number} radius @param {number} max @param {AbortSignal} [signal]
 * @param {string | null} [periode] @param {string} [filters]
 * @returns {Promise<{ points: AroundPoint[], total: number }>}
 */
export function observationPointsMany(point, radius, max, signal, periode = null, filters = RESEARCH) {
  if (!moduleOn('inaturalist')) return Promise.reject(new ModuleOffError('inaturalist'));
  const when = periodQuery(periode);
  let partial = false;
  return cached(`around-many2:${max}:${area(point, radius)}${when}${filters === RESEARCH ? '' : '|' + (filters || 'toutes')}`, async () => {
    const page = await paged(`${area(point, radius)}&iconic_taxa=Plantae${filters}&locale=fr&order_by=observed_on${when}`, max, signal);
    partial = page.partial;
    return { points: page.results.map(aroundPoint), total: page.total };
  }, () => partial).then(withThumbs);
}

/**
 * An iNaturalist observation as a point of the map: its plant's photo, never the observation's own (most are under
 * iNaturalist's default licence, CC BY-NC, never shown: the points were leaves but for the plant chosen's) — its
 * taxon's under a free licence, the one its card shows (speciesAround), else the flora's (withThumbs, after the cache).
 * One address a plant, shared by all its points. Its names, date, place and page.
 * @param {any} o @returns {AroundPoint}
 */
function aroundPoint(o) {
  const url = o.uri || `https://www.inaturalist.org/observations/${o.id}`;
  const taxon = o.taxon?.default_photo?.square_url && inatCredit(o.taxon.default_photo) ? o.taxon.default_photo : null;
  const common = o.taxon?.preferred_common_name || null, sci = o.taxon?.name || '';
  return {
    coordinates: /** @type {[number, number]} */ (o.geojson.coordinates),
    title: common || sci || 'Plante', common, sci, taxonId: o.taxon?.id ?? null,
    photo: taxon ? String(taxon.square_url).replace(/\/(square|thumb|small|medium)\./, '/square.') : null,
    credit: taxon ? inatCredit(taxon) : null,
    date: o.observed_on || null, place: o.place_guess || null,
    url
  };
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
