// @ts-check
// Harvest places: GeoJSON Point Features kept in IndexedDB, never sent anywhere.
// A place is a collection of plants, each with its own abundance, rating, notes and harvest log.

import { config } from '../config.js';
import * as db from './db.js';
import { normalizeEntry, normalizePlace, plantIdsOf } from './place-model.js';

/**
 * @typedef {import('./place-model.js').Place} Place
 * @typedef {import('./place-model.js').PlantEntry} PlantEntry
 * @typedef {import('./place-model.js').Harvest} Harvest
 */

export const ABUNDANCE = [
  { value: 'rare', label: 'Rare' },
  { value: 'moyen', label: 'Moyen' },
  { value: 'abondant', label: 'Abondant' }
];
const ABUNDANCE_RANK = { rare: 0, moyen: 1, abondant: 2 };

/** Fired on `spotEvents` whenever places change, so maps and lists refresh. */
export const spotEvents = new EventTarget();
const changed = () => spotEvents.dispatchEvent(new Event('change'));

/** Records are migrated on upgrade; normalizing on read also covers places imported mid-upgrade. */
const read = (/** @type {any} */ record) => record ? normalizePlace(record) : undefined;

/** @returns {Promise<Place[]>} */
export const listPlaces = async () => /** @type {Place[]} */ ((await db.getAll('spots')).map(read).filter(Boolean));

/** Places where a plant grows. @param {number} plantId @returns {Promise<Place[]>} */
export const placesForPlant = async plantId =>
  /** @type {Place[]} */ ((await db.getAllByIndex('spots', 'by_plant', plantId)).map(read).filter(Boolean));

/** @param {string} id @returns {Promise<Place | undefined>} */
export const getPlace = async id => read(await db.get('spots', id)) || undefined;

/** @param {string} id */
export async function deletePlace(id) {
  await db.remove('spots', id);
  changed();
}

/** 7 decimals ≈ 1 cm: plenty, and keeps exports readable. @param {[number, number]} c @returns {[number, number]} */
const roundCoordinates = ([lon, lat]) => [Math.round(lon * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7];

/**
 * @param {[number, number]} coordinates [lon, lat]
 * @param {Partial<import('./place-model.js').PlaceProperties>} [properties]
 * @returns {Place}
 */
export function newPlace(coordinates, properties = {}) {
  const now = new Date().toISOString();
  return {
    type: 'Feature',
    id: crypto.randomUUID(),
    geometry: { type: 'Point', coordinates: roundCoordinates(coordinates) },
    properties: { name: '', notes: '', accuracy: null, createdAt: now, updatedAt: now, plants: [], plantIds: [], ...properties }
  };
}

/** A new plant entry from a TAXREF plant record (or search summary). @param {any} plant @returns {PlantEntry} */
export const newEntry = plant => normalizeEntry({
  plantId: plant.id,
  scientificName: plant.scientificName,
  vernacularName: plant.vernacularNames?.[0] ?? plant.vernacularName ?? null,
  addedAt: new Date().toISOString()
}, new Date().toISOString());

/** @param {Place} place @param {number | null} plantId */
export const findEntry = (place, plantId) => place.properties.plants.find(e => e.plantId === plantId) || null;

/** Returns a copy of the place with the plant added (no-op if already there). @param {Place} place @param {any} plant */
export function withPlant(place, plant) {
  if (findEntry(place, plant.id)) return place;
  return withPlants(place, [...place.properties.plants, newEntry(plant)]);
}

/** @param {Place} place @param {number | null} plantId */
export const withoutPlant = (place, plantId) => withPlants(place, place.properties.plants.filter(e => e.plantId !== plantId));

/** @param {Place} place @param {number | null} plantId @param {Partial<PlantEntry>} patch */
export const withEntry = (place, plantId, patch) =>
  withPlants(place, place.properties.plants.map(e => e.plantId === plantId ? { ...e, ...patch } : e));

/** @param {Place} place @param {PlantEntry[]} plants @returns {Place} */
const withPlants = (place, plants) => ({ ...place, properties: { ...place.properties, plants, plantIds: plantIdsOf(plants) } });

/** @param {Place} place */
export async function savePlace(place) {
  const saved = {
    ...place,
    geometry: { type: 'Point', coordinates: roundCoordinates(place.geometry.coordinates) },
    properties: { ...place.properties, plantIds: plantIdsOf(place.properties.plants), updatedAt: new Date().toISOString() }
  };
  await db.put('spots', saved);
  markHasSpots();
  changed();
  return /** @type {Place} */ (saved);
}

/** Adds a harvest to one plant of a place and saves. @param {Place} place @param {number | null} plantId @param {Harvest} harvest */
export function addHarvest(place, plantId, harvest) {
  const entry = findEntry(place, plantId);
  if (!entry) throw new Error('Plante absente de ce lieu.');
  const harvests = [...entry.harvests, harvest].sort((a, b) => b.date.localeCompare(a.date));
  return savePlace(withEntry(place, plantId, { harvests }));
}

/**
 * Asks the browser not to evict our storage under pressure (places exist only on this device).
 * Granting it can make Chrome close open IndexedDB connections (db.js reconnects), so it is
 * asked at startup, before the database is opened — and only once places exist.
 */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* best effort */ }
}

/** Remembers, without opening the database, that this device holds places worth protecting. */
function markHasSpots() {
  try {
    if (localStorage.getItem(config.storageKeys.hasSpots)) return;
    localStorage.setItem(config.storageKeys.hasSpots, '1');
  } catch { /* storage unavailable */ }
  // First place ever: ask now (later sessions ask at startup).
  requestPersistence();
}

export function hasSpots() {
  try { return localStorage.getItem(config.storageKeys.hasSpots) === '1'; } catch { return false; }
}

// ── Season, labels & distance ─────────────────────────────────────────────

const DAY = 86400000;
const dayOfYear = (/** @type {Date} */ d) => Math.floor((Date.UTC(2001, d.getMonth(), d.getDate()) - Date.UTC(2001, 0, 1)) / DAY);

/**
 * A plant is in season at a place when it was harvested there, in any year,
 * within ±15 days of today's day of the year.
 * @param {PlantEntry} entry @param {Date} [today]
 */
export function entryInSeason(entry, today = new Date()) {
  const now = dayOfYear(today);
  return entry.harvests.some(h => {
    const date = new Date(h.date + 'T12:00:00');
    if (Number.isNaN(date.getTime())) return false;
    const gap = Math.abs(dayOfYear(date) - now);
    return Math.min(gap, 365 - gap) <= 15;
  });
}

/** @param {Place} place @param {Date} [today] */
export const inSeason = (place, today = new Date()) => place.properties.plants.some(e => entryInSeason(e, today));

/** @param {PlantEntry} entry */
export const lastHarvest = entry => entry.harvests[0] || null;

/** Most recent harvest at the place, any plant. @param {Place} place @returns {{ entry: PlantEntry, harvest: Harvest } | null} */
export function placeLastHarvest(place) {
  let best = null;
  for (const entry of place.properties.plants) {
    const harvest = entry.harvests[0];
    if (harvest && (!best || harvest.date > best.harvest.date)) best = { entry, harvest };
  }
  return best;
}

/** Highest abundance among the plants (pin colour). @param {Place} place @returns {import('./place-model.js').Abundance} */
export function placeAbundance(place) {
  let best = /** @type {import('./place-model.js').Abundance} */ ('moyen');
  let rank = -1;
  for (const e of place.properties.plants) {
    if (ABUNDANCE_RANK[e.abundance] > rank) { rank = ABUNDANCE_RANK[e.abundance]; best = e.abundance; }
  }
  return best;
}

/** @param {PlantEntry} entry */
export const entryName = entry => entry.vernacularName || entry.scientificName || 'Plante';

/** Place name, else its single plant, else "3 plantes". @param {Place} place */
export function placeTitle(place) {
  if (place.properties.name) return place.properties.name;
  const plants = place.properties.plants;
  if (plants.length === 1) return entryName(plants[0]);
  if (!plants.length) return 'Lieu sans plante';
  return `${entryName(plants[0])} + ${plants.length - 1} autre${plants.length > 2 ? 's' : ''}`;
}

/** @param {number} n */
export const plantCount = n => `${n} plante${n > 1 ? 's' : ''}`;

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

/**
 * Existing places within `radius` metres, nearest first.
 * @param {[number, number]} coordinates @param {number} radius @param {string} [excludeId]
 */
export async function nearbyPlaces(coordinates, radius, excludeId) {
  return (await listPlaces())
    .filter(place => place.id !== excludeId)
    .map(place => ({ place, distance: distance(coordinates, place.geometry.coordinates) }))
    .filter(row => row.distance <= radius)
    .sort((a, b) => a.distance - b.distance);
}

/** Link handing the place to the phone's navigation app. @param {Place} place */
export function directionsUrl(place) {
  const [lon, lat] = place.geometry.coordinates;
  if (/android/i.test(navigator.userAgent)) return `geo:${lat},${lon}?q=${lat},${lon}`;
  if (/iphone|ipad|ipod|macintosh/i.test(navigator.userAgent)) return `https://maps.apple.com/?daddr=${lat},${lon}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}

// ── GeoJSON export / import ───────────────────────────────────────────────

export async function exportGeoJSON() {
  const features = (await listPlaces()).sort((a, b) => a.properties.createdAt.localeCompare(b.properties.createdAt));
  const collection = {
    type: 'FeatureCollection',
    name: 'GeoFlora — lieux de récolte',
    generator: 'GeoFlora',
    formatVersion: 2,
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

/**
 * Merges a GeoJSON file into the local places: same id → the most recently updated wins.
 * Accepts both the current format (properties.plants) and the first one (one plant per feature).
 * Plants without a TAXREF id are matched by scientific name.
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

  const existing = new Map((await listPlaces()).map(place => [place.id, place]));
  const result = { added: 0, updated: 0, unchanged: 0, skipped: 0 };
  /** @type {Place[]} */
  const toSave = [];

  for (const feature of features) {
    const place = normalizePlace(feature);
    if (!place) { result.skipped++; continue; }
    place.geometry.coordinates = roundCoordinates(place.geometry.coordinates);
    for (const entry of place.properties.plants) {
      if (entry.plantId !== null || !entry.scientificName) continue;
      const plant = byName.get(entry.scientificName.toLowerCase());
      if (!plant) continue;
      entry.plantId = plant.id;
      entry.vernacularName ??= plant.vernacularNames?.[0] || null;
    }
    place.properties.plantIds = plantIdsOf(place.properties.plants);

    const current = existing.get(place.id);
    if (!current) {
      result.added++;
    } else if (place.properties.updatedAt > current.properties.updatedAt) {
      result.updated++;
    } else {
      result.unchanged++;
      continue;
    }
    existing.set(place.id, place);
    toSave.push(place);
  }

  if (toSave.length) {
    await db.putAll('spots', toSave);
    markHasSpots();
    changed();
  }
  return result;
}
