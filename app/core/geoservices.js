// @ts-check
// IGN Géoplateforme services (free, no key): address search, nearest address, altitude.
// Point lookups are cached in IndexedDB so places already seen keep their address and altitude offline.

import * as db from './db.js';
import { ModuleOffError, moduleOn } from './modules.js';

const GEOCODING = 'https://data.geopf.fr/geocodage';
const ALTIMETRY = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json';
/** Addresses and altitudes hardly change: keep them a year. */
const TTL = 365 * 24 * 3600 * 1000;

/** @typedef {{ label: string, detail: string, coordinates: [number, number], kind: string }} GeoResult */

/** @param {string} url @param {AbortSignal} [signal] */
async function json(url, signal) {
  const response = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('Géoplateforme ' + response.status);
  return response.json();
}

const key5 = (/** @type {[number, number]} */ [lon, lat]) => `${lat.toFixed(5)},${lon.toFixed(5)}`;

/** @template T @param {string} key @param {() => Promise<T>} load @returns {Promise<T>} */
async function cached(key, load) {
  const hit = await db.get('plantDetails', key).catch(() => null);
  if (hit && Date.now() - hit.fetchedAt < TTL) return hit.value;
  try {
    const value = await load();
    await db.put('plantDetails', { key, fetchedAt: Date.now(), value }).catch(() => {});
    return value;
  } catch (error) {
    if (hit) return hit.value;
    throw error;
  }
}

const KINDS = { municipality: 'Commune', locality: 'Lieu-dit', street: 'Voie', housenumber: 'Adresse', administratif: 'Commune' };

/**
 * Suggestions while typing: addresses, localities (lieux-dits), communes, points of interest.
 * @param {string} text
 * @param {AbortSignal} [signal]
 * @returns {Promise<GeoResult[]>}
 */
export async function searchPlaces(text, signal) {
  const q = text.trim();
  if (q.length < 3) return [];
  if (!moduleOn('ignGeo')) throw new ModuleOffError('ignGeo');
  const data = await json(`${GEOCODING}/completion?text=${encodeURIComponent(q)}&maximumResponses=6`, signal);
  return (data.results || [])
    .filter(r => Number.isFinite(r.x) && Number.isFinite(r.y))
    .map(r => {
      const [label, ...rest] = String(r.fulltext || '').split(', ');
      return {
        label: label || r.fulltext,
        detail: rest.join(', ') || r.zipcode || '',
        coordinates: /** @type {[number, number]} */ ([r.x, r.y]),
        kind: KINDS[r.kind] || (r.country === 'PositionOfInterest' ? 'Lieu' : 'Adresse')
      };
    });
}

/**
 * Nearest address (within ~500 m) and commune of a point.
 * @param {[number, number]} point [lon, lat]
 * @returns {Promise<{ label: string, city: string, distance: number } | null>}
 */
export function addressAt(point) {
  if (!moduleOn('ignGeo')) return Promise.resolve(null);
  return cached('geo:rev:' + key5(point), async () => {
    const data = await json(`${GEOCODING}/reverse?lon=${point[0]}&lat=${point[1]}&limit=1`);
    const p = data.features?.[0]?.properties;
    if (!p) return null;
    const far = Number(p.distance) > 500;
    return { label: far ? p.city : p.label, city: p.city || '', distance: Number(p.distance) || 0 };
  });
}

/**
 * Ground altitude (RGE ALTI®), metres, or null where there is no data.
 * @param {[number, number]} point [lon, lat]
 * @returns {Promise<number | null>}
 */
export function altitudeAt(point) {
  if (!moduleOn('ignGeo')) return Promise.resolve(null);
  return cached('geo:alt:' + key5(point), async () => {
    const data = await json(`${ALTIMETRY}?lon=${point[0]}&lat=${point[1]}&resource=ign_rge_alti_wld&zonly=true`);
    const z = data.elevations?.[0];
    const value = typeof z === 'object' ? z?.z : z;
    return Number.isFinite(value) && value > -1000 ? Math.round(value) : null;
  });
}

/** "45.76410, 4.83570" (lat, lon: the order GPS apps and search engines accept). @param {[number, number]} point */
export const formatCoordinates = ([lon, lat]) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
