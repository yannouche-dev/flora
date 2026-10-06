// @ts-check
// Harvest spots: GeoJSON Point Features kept in IndexedDB, never sent anywhere.

import { config } from '../config.js';
import * as db from './db.js';

/**
 * @typedef {{ date: string, quantity?: string, note?: string }} Harvest
 * @typedef {object} SpotProperties
 * @property {number | null} plantId
 * @property {string} scientificName
 * @property {string | null} vernacularName
 * @property {string} [label]
 * @property {string} [notes]
 * @property {'rare' | 'moyen' | 'abondant'} [abundance]
 * @property {number} [rating]          1–5
 * @property {number | null} [accuracy] GPS accuracy (m) when recorded
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {Harvest[]} harvests
 * @typedef {{ type: 'Feature', id: string, geometry: { type: 'Point', coordinates: [number, number] }, properties: SpotProperties }} Spot
 */

export const ABUNDANCE = [
  { value: 'rare', label: 'Rare' },
  { value: 'moyen', label: 'Moyen' },
  { value: 'abondant', label: 'Abondant' }
];

/** Fired on `spotEvents` whenever spots change, so maps and lists refresh. */
export const spotEvents = new EventTarget();
const changed = () => spotEvents.dispatchEvent(new Event('change'));

/** @returns {Promise<Spot[]>} */
export const listSpots = () => db.getAll('spots');

/** @param {number} plantId @returns {Promise<Spot[]>} */
export const spotsForPlant = plantId => db.getAllByIndex('spots', 'by_plant', plantId);

/** @param {string} id @returns {Promise<Spot | undefined>} */
export const getSpot = id => db.get('spots', id);

/** @param {string} id */
export async function deleteSpot(id) {
  await db.remove('spots', id);
  changed();
}

/**
 * Creates a spot for a plant at [lon, lat].
 * @param {any} plant
 * @param {[number, number]} coordinates
 * @param {Partial<SpotProperties>} [properties]
 * @returns {Spot}
 */
export function newSpot(plant, coordinates, properties = {}) {
  const now = new Date().toISOString();
  return {
    type: 'Feature',
    id: crypto.randomUUID(),
    geometry: { type: 'Point', coordinates: roundCoordinates(coordinates) },
    properties: {
      plantId: plant?.id ?? null,
      scientificName: plant?.scientificName || '',
      vernacularName: plant?.vernacularNames?.[0] || null,
      label: '',
      notes: '',
      abundance: 'moyen',
      rating: 0,
      accuracy: null,
      createdAt: now,
      updatedAt: now,
      harvests: [],
      ...properties
    }
  };
}

/** 7 decimals ≈ 1 cm: plenty, and keeps exports readable. @param {[number, number]} c @returns {[number, number]} */
const roundCoordinates = ([lon, lat]) => [Math.round(lon * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7];

/** @param {Spot} spot */
export async function saveSpot(spot) {
  const saved = {
    ...spot,
    geometry: { type: 'Point', coordinates: roundCoordinates(spot.geometry.coordinates) },
    properties: { ...spot.properties, updatedAt: new Date().toISOString() }
  };
  await db.put('spots', saved);
  requestPersistence();
  changed();
  return saved;
}

/** @param {Spot} spot @param {Harvest} harvest */
export function addHarvest(spot, harvest) {
  const harvests = [...spot.properties.harvests, harvest].sort((a, b) => b.date.localeCompare(a.date));
  return saveSpot({ ...spot, properties: { ...spot.properties, harvests } });
}

/** Asks the browser not to evict our storage under pressure (spots exist only on this device). */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* best effort */ }
}

// ── Season & distance ─────────────────────────────────────────────────────

const DAY = 86400000;

/**
 * In season = harvested, in any year, within ±15 days of today's day of the year.
 * @param {Spot} spot @param {Date} [today]
 */
export function inSeason(spot, today = new Date()) {
  const dayOfYear = (/** @type {Date} */ d) => Math.floor((Date.UTC(2001, d.getMonth(), d.getDate()) - Date.UTC(2001, 0, 1)) / DAY);
  const now = dayOfYear(today);
  return spot.properties.harvests.some(h => {
    const date = new Date(h.date + 'T12:00:00');
    if (Number.isNaN(date.getTime())) return false;
    const gap = Math.abs(dayOfYear(date) - now);
    return Math.min(gap, 365 - gap) <= 15;
  });
}

/** @param {Spot} spot */
export const lastHarvest = spot => spot.properties.harvests[0] || null;

/**
 * Great-circle distance in metres.
 * @param {[number, number]} a [lon, lat] @param {[number, number]} b [lon, lat]
 */
export function distance([lon1, lat1], [lon2, lat2]) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

/** @param {number} metres */
export const formatDistance = metres =>
  metres < 1000 ? Math.round(metres) + ' m' : (metres / 1000).toLocaleString('fr-FR', { maximumFractionDigits: metres < 10000 ? 1 : 0 }) + ' km';

/** @param {Spot} spot */
export const spotTitle = spot => spot.properties.vernacularName || spot.properties.scientificName || 'Lieu sans plante';

/** Link handing the spot to the phone's navigation app. @param {Spot} spot */
export function directionsUrl(spot) {
  const [lon, lat] = spot.geometry.coordinates;
  if (/android/i.test(navigator.userAgent)) return `geo:${lat},${lon}?q=${lat},${lon}`;
  if (/iphone|ipad|ipod|macintosh/i.test(navigator.userAgent)) return `https://maps.apple.com/?daddr=${lat},${lon}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}

// ── GeoJSON export / import ───────────────────────────────────────────────

export async function exportGeoJSON() {
  const features = (await listSpots()).sort((a, b) => a.properties.createdAt.localeCompare(b.properties.createdAt));
  const collection = {
    type: 'FeatureCollection',
    name: 'GeoFlora — lieux de récolte',
    generator: 'GeoFlora',
    exportedAt: new Date().toISOString(),
    features
  };
  const date = new Date().toISOString().slice(0, 10);
  const file = new File([JSON.stringify(collection, null, 2)], `geoflora-lieux-${date}.geojson`, { type: 'application/geo+json' });

  try {
    if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ files: [file], title: 'Lieux de récolte GeoFlora' });
    } else {
      download(file);
    }
  } catch (error) {
    if (/** @type {Error} */ (error).name === 'AbortError') return { count: features.length, cancelled: true };
    download(file);
  }
  try { localStorage.setItem(config.storageKeys.lastExport, new Date().toISOString()); } catch { /* not persisted */ }
  return { count: features.length, cancelled: false };
}

/** @param {File} file */
function download(file) {
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** @returns {string | null} */
export function lastExportDate() {
  try { return localStorage.getItem(config.storageKeys.lastExport); } catch { return null; }
}

const isNumber = (/** @type {unknown} */ n) => typeof n === 'number' && Number.isFinite(n);

/**
 * Validates and normalizes one imported Feature, or returns null.
 * @param {any} feature
 * @param {(scientificName: string) => Promise<any>} findPlant
 * @returns {Promise<Spot | null>}
 */
async function normalize(feature, findPlant) {
  if (feature?.type !== 'Feature' || feature.geometry?.type !== 'Point') return null;
  const [lon, lat] = feature.geometry.coordinates || [];
  if (!isNumber(lon) || !isNumber(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  const p = feature.properties || {};
  let plantId = isNumber(p.plantId) ? p.plantId : null;
  let { scientificName = '', vernacularName = null } = p;
  if (plantId === null && scientificName) {
    const plant = await findPlant(scientificName);
    if (plant) {
      plantId = plant.id;
      vernacularName ??= plant.vernacularNames?.[0] || null;
    }
  }

  const now = new Date().toISOString();
  const text = (/** @type {unknown} */ v) => typeof v === 'string' ? v.slice(0, 5000) : '';
  return {
    type: 'Feature',
    id: typeof feature.id === 'string' && feature.id ? feature.id : crypto.randomUUID(),
    geometry: { type: 'Point', coordinates: roundCoordinates([lon, lat]) },
    properties: {
      plantId,
      scientificName: text(scientificName),
      vernacularName: vernacularName ? text(vernacularName) : null,
      label: text(p.label ?? p.name),
      notes: text(p.notes ?? p.description),
      abundance: ['rare', 'moyen', 'abondant'].includes(p.abundance) ? p.abundance : 'moyen',
      rating: isNumber(p.rating) ? Math.max(0, Math.min(5, Math.round(p.rating))) : 0,
      accuracy: isNumber(p.accuracy) ? p.accuracy : null,
      createdAt: typeof p.createdAt === 'string' ? p.createdAt : now,
      updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : now,
      harvests: Array.isArray(p.harvests)
        ? p.harvests
          .filter(h => h && /^\d{4}-\d{2}-\d{2}/.test(h.date))
          .map(h => ({ date: String(h.date).slice(0, 10), quantity: text(h.quantity), note: text(h.note) }))
          .sort((a, b) => b.date.localeCompare(a.date))
        : []
    }
  };
}

/**
 * Merges a GeoJSON file into the local spots: same id → the most recently updated wins.
 * @param {File} file
 * @returns {Promise<{ added: number, updated: number, unchanged: number, skipped: number }>}
 */
export async function importGeoJSON(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('Ce fichier n’est pas un GeoJSON valide.');
  }
  const features = data?.type === 'FeatureCollection' ? data.features : data?.type === 'Feature' ? [data] : null;
  if (!Array.isArray(features)) throw new Error('Le fichier ne contient pas de FeatureCollection GeoJSON.');

  const plants = await db.getAll('plants');
  const byName = new Map(plants.map(plant => [plant.scientificName.toLowerCase(), plant]));
  const findPlant = async (/** @type {string} */ name) => byName.get(name.toLowerCase()) || null;

  const existing = new Map((await listSpots()).map(spot => [spot.id, spot]));
  const result = { added: 0, updated: 0, unchanged: 0, skipped: 0 };
  /** @type {Spot[]} */
  const toSave = [];

  for (const feature of features) {
    const spot = await normalize(feature, findPlant);
    if (!spot) { result.skipped++; continue; }
    const current = existing.get(spot.id);
    if (!current) {
      result.added++;
    } else if (spot.properties.updatedAt > current.properties.updatedAt) {
      result.updated++;
    } else {
      result.unchanged++;
      continue;
    }
    existing.set(spot.id, spot);
    toSave.push(spot);
  }

  if (toSave.length) {
    await db.putAll('spots', toSave);
    requestPersistence();
    changed();
  }
  return result;
}
