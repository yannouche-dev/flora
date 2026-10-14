// @ts-check
// The observations around a centre, for the maps in 3D (components/gf-map-obs3d.js draws them): what each map keeps of
// it, where they come from, and the shapes the 3D map draws with them. No DOM here.
//   around3dPrefs(scope) / setAround3dPrefs(scope, patch): shown or not, the radius, the sources, the density view —
//     one record per map (its scope: the page or block it is in), stored as the Carte's own layers are;
//   observations3d(center, radius, { inat, gbif }, signal) → the points in the circle: iNaturalist's research-grade
//     observations (up to 400, each its plant's photo, core/nearby.js) and GBIF's plant occurrences (up to 300,
//     without iNaturalist's, which GBIF holds too), cached a day (offline: the copy kept) — each source on with its
//     module (« iNaturalist », « GBIF »). A GBIF occurrence is shown as an iNaturalist observation is, whichever
//     sources are on: its plant's photo and French name — its taxon's on iNaturalist under a free licence (the
//     circle's plants on iNaturalist, sharePhotos), else the flora's —, its date and place, its source on its card;
//   morePhotos(points) → the points again once the photos of the flora's plants without one in plants.json are found
//     online (their sheet's), or null: the map draws them first, then again with them;
//   sharePhotos, inCircle, hexBins (the density's columns), ringWall (the circle's wall, in short pieces: each stands
//     on the relief where it is), fitZoom: pure, tested under Node (tests/unit/around3d.test.mjs).

import { config } from '../config.js';
import * as cache from './cache.js';
import { moduleOn } from './modules.js';
import { fetchJson } from './net.js';
import { binomial, findPhotos, floraPhotos, fullName, isHybrid, observationPointsMany, speciesAround } from './nearby.js';
import { writeLocal } from './quota.js';

/** The radii offered (metres): the mini-apps' distances, 200 m to 50 km (what iNaturalist's circle search allows). */
export const RADII_3D = [200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
export const DEFAULT_RADIUS_3D = 2000;
/** Up to this many observations of iNaturalist, and of GBIF, in a circle. */
export const INAT_MAX = 400;
export const GBIF_MAX = 300;
/** GBIF's copy of iNaturalist's research-grade observations: left out (they come from iNaturalist itself). */
export const INAT_DATASET = '50c9509d-22c7-4a22-a47d-8c48425ef4a7';
const DAY = 24 * 3600 * 1000;

/** @param {number} m */
export const radiusLabel = m => m >= 1000 ? (m / 1000).toLocaleString('fr-FR') + ' km' : m + ' m';
/** The radius as a screen reader says it. @param {number} m */
export const radiusWords = m => {
  const n = m >= 1000 ? m / 1000 : m, unit = m >= 1000 ? 'kilomètre' : 'mètre';
  return `${n.toLocaleString('fr-FR')} ${unit}${n >= 2 ? 's' : ''}`;
};

// ── What each map keeps ─────────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ on: boolean, radius: number, inat: boolean, gbif: boolean, density: boolean }} Around3dPrefs
 */

/** @type {Readonly<Around3dPrefs>} */
export const AROUND3D_DEFAULTS = Object.freeze({ on: false, radius: DEFAULT_RADIUS_3D, inat: true, gbif: true, density: false });

/** Every field valid, from anything. @param {unknown} v @returns {Around3dPrefs} */
export function cleanAround3d(v) {
  const o = /** @type {Record<string, unknown>} */ (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const d = AROUND3D_DEFAULTS, bool = (/** @type {unknown} */ x, /** @type {boolean} */ f) => typeof x === 'boolean' ? x : f;
  return {
    on: bool(o.on, d.on),
    radius: RADII_3D.includes(/** @type {number} */ (o.radius)) ? /** @type {number} */ (o.radius) : d.radius,
    inat: bool(o.inat, d.inat), gbif: bool(o.gbif, d.gbif), density: bool(o.density, d.density)
  };
}

function readAll() {
  try {
    const v = JSON.parse(localStorage.getItem(config.storageKeys.around3d) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : {};
  } catch { return {}; }
}

/** What a map keeps (`radius`: a page's own circle, when the map has never been given one). @param {string} scope @param {number} [radius] */
export function around3dPrefs(scope, radius) {
  const all = readAll();
  const kept = all[scope];
  const nearest = radius ? RADII_3D.reduce((a, b) => Math.abs(b - radius) < Math.abs(a - radius) ? b : a) : DEFAULT_RADIUS_3D;
  return cleanAround3d(kept ?? { radius: nearest });
}

/** @param {string} scope @param {Partial<Around3dPrefs>} patch @returns {Around3dPrefs} */
export function setAround3dPrefs(scope, patch) {
  const all = readAll();
  const next = cleanAround3d({ ...cleanAround3d(all[scope]), ...patch });
  all[scope] = next;
  writeLocal(config.storageKeys.around3d, JSON.stringify(all));
  return next;
}

// ── Where they come from ────────────────────────────────────────────────────────────────────────

/**
 * A point of the 3D map: an observation (iNaturalist), an occurrence (GBIF), or a plant of the user's places. `source`:
 * where the record comes from, as its card says it (« iNaturalist », « GBIF · <its dataset> »).
 * @typedef {{ id: string, kind: 'inat' | 'gbif' | 'mine', coordinates: [number, number], title: string, common: string | null,
 *   sci: string, taxonId: number | null, photo: string | null, credit: import('./credit.js').Credit | null, date: string | null,
 *   place: string | null, source?: string | null, url: string | null, plant?: { placeId: string, entryId?: string, plantId: number | null } }} Obs3d
 * @typedef {{ points: Obs3d[], totals: { inat: number | null, gbif: number | null }, failed: string[] }} Obs3dResult
 */

/** A record's free text, shown as text on a card: one line, `max` characters at most. @param {unknown} v @param {number} max */
const clip = (v, max) => {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
};

/** Where a GBIF record comes from, as its card says it: « GBIF · <its dataset> ». @param {unknown} dataset */
export const gbifSource = dataset => {
  const name = clip(dataset, 60);
  return name ? 'GBIF · ' + name : 'GBIF';
};

/**
 * GBIF's plant occurrences in the circle (iNaturalist's copy left out), cached a day: where (its locality, else its
 * commune or its county), when, its dataset — as an iNaturalist observation is shown (observations3d gives it its
 * plant's photo and name, after the cache).
 * @param {[number, number]} center @param {number} radius @param {AbortSignal} [signal]
 * @returns {Promise<{ points: Obs3d[], total: number }>}
 */
function gbifAround([lon, lat], radius, signal) {
  const where = `${lat.toFixed(4)},${lon.toFixed(4)},${(radius / 1000).toFixed(2)}km`;
  // « gbif2 »: the points cached with their dataset as their place are not used again.
  return cache.cached(`around3d-gbif2:${where}`, async () => {
    const url = 'https://api.gbif.org/v1/occurrence/search?taxonKey=6&hasCoordinate=true&hasGeospatialIssue=false&occurrenceStatus=PRESENT'
      + `&geoDistance=${encodeURIComponent(where)}&limit=${GBIF_MAX}`;
    const data = await fetchJson(url, { signal, expect: d => Array.isArray(d.results) });
    /** @type {Obs3d[]} */
    const points = [];
    for (const o of data.results) {
      if (typeof o.decimalLatitude !== 'number' || typeof o.decimalLongitude !== 'number' || o.datasetKey === INAT_DATASET) continue;
      const sci = clip(o.species || o.scientificName, 120);
      const common = clip(o.vernacularName, 80) || null;
      points.push({
        id: 'g' + o.key, kind: 'gbif', coordinates: [o.decimalLongitude, o.decimalLatitude],
        title: common || sci || 'Plante', common, sci, taxonId: null, photo: null, credit: null,
        date: o.eventDate ? String(o.eventDate).slice(0, 10) : null,
        place: clip(o.locality || o.municipality || o.county, 80) || null,
        source: gbifSource(o.datasetName || o.institutionCode),
        url: o.key ? `https://www.gbif.org/occurrence/${o.key}` : null
      });
    }
    return { points, total: typeof data.count === 'number' ? data.count : points.length };
  }, { ttl: DAY, signal });
}

/**
 * Points of another source (GBIF's) given what iNaturalist shows of the same plant among `from` (its taxa in the
 * circle, its observations): its photo and its credit (the same photo for the same plant, whatever its source), its
 * French name, its taxon (the plant a page lights, markClasses) — a twin without a free photo gives its name and taxon
 * only (an iNaturalist observation of it shows that name, and the flora's photo). The plant by its whole name first,
 * else by its binomial (a subspecies is its species' plant) — never for a hybrid, on either side, as core/nearby.js
 * matches the flora: « Heracleum mantegazzianum × sphondylium » is not the giant hogweed, nor « Mentha × villosa »
 * « Mentha × piperita ». One twin a plant: one with a photo over one without, then a species' own over a
 * subspecies', then the first. Those without a twin keep theirs (the flora's comes next: core/nearby.js floraPhotos).
 * Pure: new objects, the points given unchanged.
 * @template {{ sci: string, photo: string | null, credit: import('./credit.js').Credit | null, common: string | null, title: string, taxonId: number | null }} T
 * @param {T[]} points @param {{ sci: string, photo: string | null, credit: import('./credit.js').Credit | null, common: string | null, taxonId: number | null }[]} from
 * @returns {T[]}
 */
export function sharePhotos(points, from) {
  /** @typedef {(typeof from)[number]} Twin */
  /** @type {Map<string, Twin>} */ const whole = new Map();
  /** @type {Map<string, Twin>} */ const loose = new Map();
  const species = (/** @type {string} */ sci) => fullName(sci) === binomial(sci);
  const better = (/** @type {Twin | undefined} */ kept, /** @type {Twin} */ p) =>
    !kept || (Boolean(p.photo) !== Boolean(kept.photo) ? Boolean(p.photo) : species(p.sci) && !species(kept.sci));
  for (const p of from) {
    if (!p.sci || !(p.photo || p.common)) continue;
    if (better(whole.get(fullName(p.sci)), p)) whole.set(fullName(p.sci), p);
    if (!isHybrid(p.sci) && better(loose.get(binomial(p.sci)), p)) loose.set(binomial(p.sci), p);
  }
  return points.map(p => {
    if (!p.sci || (p.photo && p.common)) return p;
    const twin = whole.get(fullName(p.sci)) ?? (isHybrid(p.sci) ? undefined : loose.get(binomial(p.sci)));
    const photo = !p.photo && twin?.photo ? twin : null;
    const common = p.common || twin?.common || null;
    if (!twin || (!photo && common === p.common)) return p;
    return {
      ...p, ...(photo ? { photo: photo.photo, credit: photo.credit } : {}),
      common, title: common && (!p.title || p.title === p.sci) ? common : p.title, taxonId: p.taxonId ?? twin.taxonId
    };
  });
}

/**
 * The observations in the circle, from the sources asked (each with its module on). A source that fails is said
 * (`failed`), the others shown.
 * @param {[number, number]} center @param {number} radius @param {{ inat: boolean, gbif: boolean }} sources @param {AbortSignal} [signal]
 * @returns {Promise<Obs3dResult>}
 */
export async function observations3d(center, radius, sources, signal) {
  const useInat = sources.inat && moduleOn('inaturalist'), useGbif = sources.gbif && moduleOn('gbif');
  /** @type {string[]} */ const failed = [];
  const fail = (/** @type {string} */ name) => (/** @type {any} */ error) => { if (error?.name === 'AbortError') throw error; failed.push(name); return null; };
  const [inat, gbif, taxa] = await Promise.all([
    useInat ? observationPointsMany(center, radius, INAT_MAX, signal).catch(fail('iNaturalist')) : null,
    useGbif ? gbifAround(center, radius, signal).catch(fail('GBIF')) : null,
    // The plants iNaturalist knows in the circle (one call, cached a day, shared with « Autour »): each its taxon's
    // photo under a free licence and its French name — what an iNaturalist observation of it shows —, for GBIF's
    // points whether iNaturalist's are shown or not (its module on: its photos are the plants' photos).
    useGbif && moduleOn('inaturalist') ? speciesAround(center, radius, signal).catch(error => { if (error?.name === 'AbortError') throw error; return null; }) : null
  ]);
  /** @type {Obs3d[]} */
  const points = [];
  for (const [i, p] of (inat?.points || []).entries()) {
    points.push({ ...p, id: 'i' + (p.url?.match(/(\d+)$/)?.[1] ?? i), kind: 'inat', url: p.url || null, source: 'iNaturalist' });
  }
  // GBIF's as iNaturalist's: the photo and name its plant has on iNaturalist here, else the flora's.
  if (gbif) {
    const known = (taxa?.species || []).map(s => ({ sci: s.name, photo: s.photo, credit: s.credit, common: s.common, taxonId: s.taxonId }));
    /** @type {Obs3d[]} */
    const shared = sharePhotos(gbif.points, [...known, ...points]);
    points.push(...await floraPhotos(shared, { names: true }));
  }
  return { points: inCircle(points, center, radius), totals: { inat: inat ? inat.total : null, gbif: gbif ? gbif.total : null }, failed };
}

/**
 * The points again with the photos of the flora's plants that have none in plants.json — found online, as their
 * sheet shows them (core/nearby.js findPhotos: iNaturalist's taxon photo, else Commons') —, whatever their source; null
 * when none was found (nothing to draw again). Never changes the points given.
 * @param {Obs3d[]} points @returns {Promise<Obs3d[] | null>}
 */
export async function morePhotos(points) {
  if (!(await findPhotos(points).catch(() => false))) return null;
  return floraPhotos(points, { names: true });
}

// ── Shapes ──────────────────────────────────────────────────────────────────────────────────────

const R_EARTH = 6371008.8;
const RAD = Math.PI / 180;

/** Great-circle distance in metres. @param {[number, number]} a @param {[number, number]} b */
export function metres([lon1, lat1], [lon2, lat2]) {
  const h = Math.sin((lat2 - lat1) * RAD / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin((lon2 - lon1) * RAD / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

/** Only the points in the circle (a source's search may reach a little past it). @template {{ coordinates: [number, number] }} T @param {T[]} points @param {[number, number]} center @param {number} radius @returns {T[]} */
export const inCircle = (points, center, radius) => points.filter(p => metres(center, p.coordinates) <= radius * 1.001);

/** Metres east and north of `c` ⇄ lon, lat (flat around the centre: enough within 50 km). @param {[number, number]} c */
function local([lon0, lat0]) {
  const kx = Math.cos(lat0 * RAD) * R_EARTH * RAD, ky = R_EARTH * RAD;
  return {
    to: (/** @type {[number, number]} */ [lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky],
    from: (/** @type {number} */ x, /** @type {number} */ y) => /** @type {[number, number]} */ ([Number((lon0 + x / kx).toFixed(7)), Number((lat0 + y / ky).toFixed(7))])
  };
}

/**
 * The density view: the circle cut in hexagons (about seven across its radius), each with how many points fall in it
 * and its three most seen plants — a column per hexagon, as tall as its share of the busiest one.
 * @param {{ coordinates: [number, number], title?: string }[]} points @param {[number, number]} center @param {number} radius
 * @returns {{ type: 'FeatureCollection', features: any[], max: number, size: number }}
 */
export function hexBins(points, center, radius) {
  const size = radius / 7, { to, from } = local(center), sq3 = Math.sqrt(3);
  /** @type {Map<string, { q: number, r: number, n: number, names: Map<string, number> }>} */
  const bins = new Map();
  for (const p of points) {
    const [x, y] = to(p.coordinates);
    // Pointy-top axial coordinates, rounded in cube coordinates.
    const fq = (sq3 / 3 * x - y / 3) / size, fr = (2 / 3 * y) / size, fs = -fq - fr;
    let q = Math.round(fq), r = Math.round(fr);
    const s = Math.round(fs), dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(s - fs);
    if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
    const key = q + ',' + r;
    const bin = bins.get(key) || { q, r, n: 0, names: new Map() };
    bin.n++;
    if (p.title) bin.names.set(p.title, (bin.names.get(p.title) || 0) + 1);
    bins.set(key, bin);
  }
  const max = Math.max(1, ...[...bins.values()].map(b => b.n));
  const features = [...bins.values()].map(b => {
    const cx = size * sq3 * (b.q + b.r / 2), cy = size * 1.5 * b.r;
    // A little inside its cell: the columns stand apart.
    const ring = Array.from({ length: 7 }, (_, i) => {
      const a = (60 * (i % 6) - 30) * RAD;
      return from(cx + 0.9 * size * Math.cos(a), cy + 0.9 * size * Math.sin(a));
    });
    const top = [...b.names.entries()].sort((a, c) => c[1] - a[1]).slice(0, 3).map(([name]) => name);
    return { type: 'Feature', properties: { n: b.n, t: b.n / max, top: top.join(' · ') }, geometry: { type: 'Polygon', coordinates: [ring] } };
  });
  return { type: 'FeatureCollection', features, max, size };
}

/**
 * The circle's wall: a thin band along its edge, in `steps` short pieces (a fill-extrusion stands on the relief by
 * each piece's own centre — one piece for the whole circle would float or sink on a slope).
 * @param {[number, number]} center @param {number} radius @param {number} [steps]
 */
export function ringWall(center, radius, steps = 96) {
  const { from } = local(center), w = Math.max(3, radius * 0.006);
  const at = (/** @type {number} */ i, /** @type {number} */ r) => { const a = (i / steps) * 2 * Math.PI; return from(r * Math.sin(a), r * Math.cos(a)); };
  const features = Array.from({ length: steps }, (_, i) => ({
    type: 'Feature', properties: {},
    geometry: { type: 'Polygon', coordinates: [[at(i, radius), at(i + 1, radius), at(i + 1, radius - w), at(i, radius - w), at(i, radius)]] }
  }));
  return { type: 'FeatureCollection', features };
}

/** How tall the circle's wall stands (metres): 8 % of its radius, 20 m to 1 500 m. @param {number} radius */
export const wallHeight = radius => Math.round(Math.min(1500, Math.max(20, radius * 0.08)));

/**
 * The zoom (MapLibre's: 512 px tiles) at which a circle of `radius` metres fills `px` pixels across, at `lat`.
 * @param {number} radius @param {number} lat @param {number} px
 */
export function fitZoom(radius, lat, px) {
  const metresPerPx0 = 2 * Math.PI * 6378137 * Math.cos(lat * RAD) / 512;
  return Math.log2(metresPerPx0 * px / (2 * radius));
}
