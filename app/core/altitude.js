// @ts-check
// Altitude of the plants noted and of the places (RGE ALTI® of the IGN, never the GPS's: a phone's altitude is above
// the WGS84 ellipsoid, some 50 m off in France, and poor). Asked in batches when a place is saved, kept with each
// position (see place-model.js): offline, a position without one simply waits for the next save online.
// The species' altitudes, from GBIF's occurrences, are in open-data.js.

import * as db from './db.js';
import { moduleOn } from './modules.js';
import { validAltitude } from './place-model.js';

const ALTIMETRY = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json';
/** Points per request: the service takes thousands, a URL much fewer. */
const BATCH = 100;
/** The service allows 5 requests a second. */
const GAP = 250;
/** Altitudes hardly change: the same cache as altitudeAt (geoservices.js), a year. */
const TTL = 365 * 24 * 3600 * 1000;
/** After a failure (offline, the service down), a place is not asked again for this long. */
const RETRY = 10 * 60 * 1000;

/** @typedef {import('./place-model.js').Place} Place @typedef {import('./place-model.js').Altitude} Altitude */

const key5 = (/** @type {[number, number]} */ [lon, lat]) => `${lat.toFixed(5)},${lon.toFixed(5)}`;

/** The altitude (m) of something with a position, while it is that position's; else null. @param {{ altitude?: Altitude | null }} item @param {[number, number] | null | undefined} at */
export const altitudeOf = (item, at) => (at && validAltitude(item.altitude, at)?.m) ?? null;

/** "1 240 m". @param {number} m */
export const formatAltitude = m => `${new Intl.NumberFormat('fr-FR').format(Math.round(m))} m`;

/**
 * Altitudes of many points: from the cache, the rest asked of the IGN in batches (in order, never more than the
 * service allows). A point without data (the sea, abroad) is null. Throws when the service cannot be reached.
 * @param {[number, number][]} points @returns {Promise<Map<string, number | null>>} by key5
 */
export async function altitudesAt(points) {
  /** @type {Map<string, number | null>} */
  const out = new Map();
  /** @type {[number, number][]} */
  const ask = [];
  for (const p of points) {
    const k = key5(p);
    if (out.has(k) || ask.some(q => key5(q) === k)) continue;
    const hit = await db.get('plantDetails', 'geo:alt:' + k).catch(() => null);
    if (hit && Date.now() - hit.fetchedAt < TTL) out.set(k, hit.value);
    else ask.push(p);
  }
  for (let i = 0; i < ask.length; i += BATCH) {
    if (i) await new Promise(r => setTimeout(r, GAP));
    const part = ask.slice(i, i + BATCH);
    const url = `${ALTIMETRY}?lon=${part.map(p => p[0]).join('|')}&lat=${part.map(p => p[1]).join('|')}&resource=ign_rge_alti_wld&zonly=true`;
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('Géoplateforme ' + response.status);
    const data = await response.json();
    const list = Array.isArray(data?.elevations) ? data.elevations : [];
    if (list.length !== part.length) throw new Error('Géoplateforme : réponse incomplète');
    part.forEach((p, j) => {
      const z = typeof list[j] === 'object' ? list[j]?.z : list[j];
      // -99999: no data at that point.
      const value = Number.isFinite(z) && z > -1000 ? Math.round(z) : null;
      out.set(key5(p), value);
      db.put('plantDetails', { key: 'geo:alt:' + key5(p), fetchedAt: Date.now(), value }).catch(() => {});
    });
  }
  return out;
}

/** The positions of a place still without their altitude. @param {Place} place @returns {[number, number][]} */
export function missingAltitudes(place) {
  if (!place.geometry) return [];
  /** @type {[number, number][]} */
  const points = [];
  if (!validAltitude(place.properties.altitude, place.geometry.coordinates)) points.push(place.geometry.coordinates);
  for (const e of place.properties.plants) if (e.coordinates && !validAltitude(e.altitude, e.coordinates)) points.push(e.coordinates);
  return points;
}

/**
 * A place with the altitudes found (`found` by key5): each position missing one gets it — only a position whose
 * altitude is known, and still where it was asked. @param {Place} place @param {Map<string, number | null>} found @returns {Place}
 */
export function withAltitudes(place, found) {
  if (!place.geometry) return place;
  const of = (/** @type {[number, number]} */ at, /** @type {any} */ had) => {
    if (validAltitude(had, at)) return had;
    const k = key5(at);
    return found.has(k) ? { m: found.get(k) ?? null, at: [at[0], at[1]] } : null;
  };
  const plants = place.properties.plants.map(e => e.coordinates ? { ...e, altitude: of(e.coordinates, e.altitude) } : e);
  return { ...place, properties: { ...place.properties, altitude: of(place.geometry.coordinates, place.properties.altitude), plants } };
}

/** @type {Map<string, number>} place id → when asking last failed */
const failedAt = new Map();
/** @type {Set<string>} */
const asking = new Set();

/**
 * Fills a saved place's missing altitudes (in the background): asked of the IGN, then written into the place as it
 * is now — read again, so nothing changed meanwhile is lost; a plant moved meanwhile waits for the next time.
 * `read` and `write` are the collections' own (no import cycle). Quiet when offline or the module is off.
 * @param {string} id @param {(id: string) => Promise<Place | undefined>} read @param {(place: Place) => Promise<unknown>} write
 */
export async function fillAltitudes(id, read, write) {
  if (asking.has(id) || !moduleOn('ignGeo') || !navigator.onLine || Date.now() - (failedAt.get(id) ?? 0) < RETRY) return;
  asking.add(id);
  try {
    const before = await read(id);
    const points = before ? missingAltitudes(before) : [];
    if (!points.length) return;
    const found = await altitudesAt(points);
    const now = await read(id);
    if (!now) return;
    const next = withAltitudes(now, found);
    if (missingAltitudes(next).length < missingAltitudes(now).length) await write(next);
  } catch {
    failedAt.set(id, Date.now());
  } finally {
    asking.delete(id);
  }
}

/**
 * A walk's altitude profile: its steps (positions in order) that have an altitude, at their distance from the first
 * (as the crow flies, from one to the next); the climb (D+), the lowest and highest. Fewer than two: null.
 * @param {{ at: [number, number], m: number | null, label?: string }[]} steps
 * @param {(a: [number, number], b: [number, number]) => number} metres distance between two positions
 * @returns {{ points: { d: number, m: number, label?: string }[], length: number, climb: number, low: number, high: number } | null}
 */
export function profileOf(steps, metres) {
  /** @type {{ d: number, m: number, label?: string }[]} */
  const points = [];
  let d = 0;
  steps.forEach((s, i) => {
    if (i) d += metres(steps[i - 1].at, s.at);
    if (typeof s.m === 'number') points.push({ d, m: s.m, label: s.label });
  });
  if (points.length < 2) return null;
  let climb = 0;
  for (let i = 1; i < points.length; i++) climb += Math.max(0, points[i].m - points[i - 1].m);
  const ms = points.map(p => p.m);
  return { points, length: d, climb: Math.round(climb), low: Math.min(...ms), high: Math.max(...ms) };
}
