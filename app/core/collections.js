// @ts-check
// Collections of plants, kept in IndexedDB as GeoJSON Features and never sent anywhere:
//  - favorites: the built-in ♥ collection (id 'favorites', no geometry)
//  - list:      a named list of plants (no geometry)
//  - place:     a list at a location (Point) — harvest places
// Each plant entry has its own abundance, rating, notes and harvest log.

import { config } from '../config.js';
import * as db from './db.js';
import { FAVORITES_ID, normalizeEntry, normalizeCollection, plantIdsOf } from './place-model.js';
import { store } from './store.js';

export { FAVORITES_ID };

/**
 * @typedef {import('./place-model.js').Place} Place
 * @typedef {import('./place-model.js').Collection} Collection
 * @typedef {import('./place-model.js').CollectionKind} CollectionKind
 * @typedef {import('./place-model.js').PlantEntry} PlantEntry
 * @typedef {import('./place-model.js').Harvest} Harvest
 */

export const ABUNDANCE = [
  { value: 'rare', label: 'Rare' },
  { value: 'moyen', label: 'Moyen' },
  { value: 'abondant', label: 'Abondant' }
];
const ABUNDANCE_RANK = { rare: 0, moyen: 1, abondant: 2 };

/** Fired on `spotEvents` whenever collections change, so maps and lists refresh. */
export const spotEvents = new EventTarget();
async function changed() {
  await refreshMembership().catch(error => console.error(error));
  spotEvents.dispatchEvent(new Event('change'));
}

/** Records are migrated on upgrade; normalizing on read also covers collections imported mid-upgrade. */
const read = (/** @type {any} */ record) => record ? normalizeCollection(record) : undefined;
const isPlace = (/** @type {Collection} */ c) => c.properties.kind === 'place' && c.geometry !== null;

/** Every collection (favorites, lists, places). @returns {Promise<Collection[]>} */
export const listCollections = async () => /** @type {Collection[]} */ ((await db.getAll('spots')).map(read).filter(Boolean));

/** Collections with a location. @returns {Promise<Place[]>} */
export const listPlaces = async () => (await listCollections()).filter(isPlace);

/** Every collection containing a plant. @param {number} plantId @returns {Promise<Collection[]>} */
export const collectionsForPlant = async plantId =>
  /** @type {Collection[]} */ ((await db.getAllByIndex('spots', 'by_plant', plantId)).map(read).filter(Boolean));

/** Places where a plant grows. @param {number} plantId @returns {Promise<Place[]>} */
export const placesForPlant = async plantId => (await collectionsForPlant(plantId)).filter(isPlace);

/** @param {string} id @returns {Promise<Collection | undefined>} */
export const getPlace = async id => read(await db.get('spots', id)) || undefined;
export const getCollection = getPlace;

/** @param {string} id */
export async function deletePlace(id) {
  if (id === FAVORITES_ID) throw new Error('Les favoris ne peuvent pas être supprimés.');
  await db.remove('spots', id);
  await changed();
}
export const deleteCollection = deletePlace;

/** 7 decimals ≈ 1 cm: plenty, and keeps exports readable. @param {[number, number]} c @returns {[number, number]} */
const roundCoordinates = ([lon, lat]) => [Math.round(lon * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7];

/**
 * @param {[number, number]} coordinates [lon, lat]
 * @param {Partial<import('./place-model.js').PlaceProperties>} [properties]
 * @returns {Place}
 */
export function newPlace(coordinates, properties = {}) {
  return { ...newCollection('place', properties), geometry: { type: 'Point', coordinates: roundCoordinates(coordinates) } };
}

/**
 * @param {CollectionKind} kind
 * @param {Partial<import('./place-model.js').PlaceProperties>} [properties]
 * @returns {Collection}
 */
export function newCollection(kind, properties = {}) {
  const now = new Date().toISOString();
  return {
    type: 'Feature',
    id: kind === 'favorites' ? FAVORITES_ID : crypto.randomUUID(),
    geometry: null,
    properties: {
      kind, name: kind === 'favorites' ? 'Favoris' : '', notes: '', accuracy: null,
      createdAt: now, updatedAt: now, plants: [], plantIds: [], ...properties
    }
  };
}

/**
 * Gives a list a location (it becomes a place), or removes it (it becomes a list).
 * @param {Collection} collection @param {[number, number] | null} coordinates @param {number | null} [accuracy]
 * @returns {Collection}
 */
export function withLocation(collection, coordinates, accuracy = null) {
  if (collection.properties.kind === 'favorites') return collection;
  if (!coordinates) {
    // A list's plants have no position.
    const plants = collection.properties.plants.map(e => ({ ...e, coordinates: null, accuracy: null }));
    return { ...collection, geometry: null, properties: { ...collection.properties, kind: 'list', accuracy: null, plants } };
  }
  const point = roundCoordinates(coordinates);
  // Plants without their own position start at the place's point.
  const plants = collection.properties.plants.map(e => e.coordinates ? e : { ...e, coordinates: point, accuracy: null });
  return { ...collection, geometry: { type: 'Point', coordinates: point }, properties: { ...collection.properties, kind: 'place', accuracy, plants } };
}

/** Plants are offered the GPS position only when standing near the place (else: the place's point). */
const NEAR_PLACE = 100;

/**
 * Default position of a plant added to a place: the current GPS fix if within 100 m of the place,
 * otherwise the place's point (e.g. when adding from home).
 * @param {Collection} place @param {{ coordinates: [number, number], accuracy: number } | null | undefined} fix
 * @returns {{ coordinates: [number, number] | null, accuracy: number | null }}
 */
export function defaultPlantPosition(place, fix) {
  if (!place.geometry) return { coordinates: null, accuracy: null };
  if (fix && distance(fix.coordinates, place.geometry.coordinates) <= NEAR_PLACE) {
    return { coordinates: roundCoordinates(fix.coordinates), accuracy: Math.round(fix.accuracy) };
  }
  return { coordinates: place.geometry.coordinates, accuracy: null };
}

/**
 * Map markers for the plants of places (each at its own position).
 * @param {Collection[]} places @param {(entry: PlantEntry) => boolean} [keep] @param {boolean} [harvestMode]
 */
export function plantMarkers(places, keep = () => true, harvestMode = false) {
  const out = [];
  for (const place of places) {
    if (!place.geometry) continue;
    for (const entry of place.properties.plants) {
      if (!keep(entry)) continue;
      out.push({
        key: place.id + ':' + entry.plantId,
        placeId: place.id,
        plantId: entry.plantId,
        coordinates: entryPosition(place, entry),
        abundance: entry.abundance,
        label: entryName(entry) + (place.properties.name ? ' · ' + place.properties.name : ''),
        season: harvestMode && entryInSeason(entry)
      });
    }
  }
  return out;
}

/** Where a plant of a place grows (its own position, else the place's). @param {Collection} place @param {PlantEntry} entry */
export const entryPosition = (place, entry) => entry.coordinates || place.geometry?.coordinates || null;

/** A new plant entry from a TAXREF plant record (or search summary). @param {any} plant @returns {PlantEntry} */
export const newEntry = plant => normalizeEntry({
  plantId: plant.id,
  scientificName: plant.scientificName,
  vernacularName: plant.vernacularNames?.[0] ?? plant.vernacularName ?? null,
  addedAt: new Date().toISOString()
}, new Date().toISOString());

/** @param {Place} place @param {number | null} plantId */
export const findEntry = (place, plantId) => place.properties.plants.find(e => e.plantId === plantId) || null;

/**
 * Returns a copy of the collection with the plant added (no-op if already there). In a place, the plant
 * gets `position` (default: the place's point); in a list, no position.
 * @param {Collection} place @param {any} plant
 * @param {{ coordinates: [number, number] | null, accuracy: number | null }} [position]
 */
export function withPlant(place, plant, position) {
  if (findEntry(place, plant.id)) return place;
  const entry = newEntry(plant);
  if (place.geometry) {
    entry.coordinates = position?.coordinates ? roundCoordinates(position.coordinates) : place.geometry.coordinates;
    entry.accuracy = position?.coordinates ? position.accuracy ?? null : null;
  }
  return withPlants(place, [...place.properties.plants, entry]);
}

/** @param {Place} place @param {number | null} plantId */
export const withoutPlant = (place, plantId) => withPlants(place, place.properties.plants.filter(e => e.plantId !== plantId));

/** @param {Place} place @param {number | null} plantId @param {Partial<PlantEntry>} patch */
export const withEntry = (place, plantId, patch) =>
  withPlants(place, place.properties.plants.map(e => e.plantId === plantId ? { ...e, ...patch } : e));

/** @param {Place} place @param {PlantEntry[]} plants @returns {Place} */
const withPlants = (place, plants) => ({ ...place, properties: { ...place.properties, plants, plantIds: plantIdsOf(plants) } });

/** @param {Collection} place */
export async function savePlace(place) {
  const saved = {
    ...place,
    geometry: place.geometry ? { type: 'Point', coordinates: roundCoordinates(place.geometry.coordinates) } : null,
    properties: { ...place.properties, plantIds: plantIdsOf(place.properties.plants), updatedAt: new Date().toISOString() }
  };
  await db.put('spots', saved);
  markHasSpots();
  await changed();
  return /** @type {Collection} */ (saved);
}
export const saveCollection = savePlace;

// ── Favorites & membership ────────────────────────────────────────────────

/**
 * In-memory view of what is in which collection, for cheap lookups in list rows and the search worker.
 * @typedef {{ id: string, name: string, kind: CollectionKind, count: number }} CollectionSummary
 * @type {{ favorites: Set<number>, byPlant: Map<number, string[]>, collections: CollectionSummary[] }}
 */
let membership = { favorites: new Set(), byPlant: new Map(), collections: [] };

export const getMembership = () => membership;

/** Rebuilds the membership view and publishes it in the store (favorites ♥, "Mes plantes" facet). */
export async function refreshMembership() {
  const all = await listCollections();
  const byPlant = new Map();
  for (const c of all) {
    for (const id of c.properties.plantIds) {
      const list = byPlant.get(id) || [];
      list.push(c.id);
      byPlant.set(id, list);
    }
  }
  const favorites = new Set(all.find(c => c.id === FAVORITES_ID)?.properties.plantIds || []);
  const collections = all
    .map(c => ({ id: c.id, name: collectionTitle(c), kind: c.properties.kind, count: c.properties.plants.length }))
    .sort((a, b) => (a.kind === 'favorites' ? -1 : b.kind === 'favorites' ? 1 : 0) || a.name.localeCompare(b.name, 'fr'));
  membership = { favorites, byPlant, collections };
  store.set({ favorites, collections });
}

/** @param {string} text */
const foldName = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Existing collections whose name contains the typed text (accents and case ignored): suggestions for
 * every "collection name" field, so typing "mell" offers « Mellifères » rather than creating a twin.
 * @param {CollectionSummary[]} collections
 * @param {string} text
 * @param {number} [limit]
 * @returns {{ matches: CollectionSummary[], exact: CollectionSummary | null }}
 */
export function matchCollections(collections, text, limit = 6) {
  const query = foldName(text);
  if (!query) return { matches: [], exact: null };
  const scored = collections
    .map(c => ({ c, at: foldName(c.name).indexOf(query) }))
    .filter(m => m.at >= 0)
    .sort((a, b) => (a.c.kind === 'favorites' ? -1 : b.c.kind === 'favorites' ? 1 : 0) || a.at - b.at || a.c.name.localeCompare(b.c.name, 'fr'));
  return {
    matches: scored.slice(0, limit).map(m => m.c),
    exact: collections.find(c => foldName(c.name) === query) || null
  };
}

/** @param {number} plantId */
export const isFavorite = plantId => membership.favorites.has(plantId);

/**
 * Adds or removes a plant from the favorites (created on first use).
 * @param {any} plant TAXREF record or search summary
 * @returns {Promise<boolean>} new state
 */
export async function toggleFavorite(plant) {
  const current = (await getPlace(FAVORITES_ID)) || newCollection('favorites');
  const on = !findEntry(current, plant.id);
  await savePlace(on ? withPlant(current, plant) : withoutPlant(current, plant.id));
  return on;
}

/**
 * Adds or removes a plant from a collection.
 * @param {string} collectionId @param {any} plant @param {boolean} on
 */
export async function setInCollection(collectionId, plant, on) {
  const current = await getPlace(collectionId) || (collectionId === FAVORITES_ID ? newCollection('favorites') : null);
  if (!current) throw new Error('Collection introuvable.');
  if (Boolean(findEntry(current, plant.id)) === on) return current;
  return savePlace(on ? withPlant(current, plant) : withoutPlant(current, plant.id));
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

/**
 * "Bientôt": harvested, in any year, within the next 30 days of the calendar (and not in season now).
 * @param {PlantEntry} entry @param {Date} [today]
 */
export function entrySoon(entry, today = new Date()) {
  if (entryInSeason(entry, today)) return false;
  const now = dayOfYear(today);
  return entry.harvests.some(h => {
    const date = new Date(h.date + 'T12:00:00');
    if (Number.isNaN(date.getTime())) return false;
    const ahead = (dayOfYear(date) - now + 365) % 365;
    return ahead > 15 && ahead <= 30;
  });
}

/** @param {Place} place @param {Date} [today] */
export const soon = (place, today = new Date()) => !inSeason(place, today) && place.properties.plants.some(e => entrySoon(e, today));

/** Does any collection hold a harvest? (decides the default of harvest mode) */
export async function anyHarvest() {
  return (await listCollections()).some(c => c.properties.plants.some(e => e.harvests.length));
}

/** Recently used plants (quick capture suggestions). @returns {number[]} */
export function recentPlants() {
  try { return JSON.parse(localStorage.getItem(config.storageKeys.recentPlants) || '[]'); } catch { return []; }
}

/** @param {number} plantId */
export function rememberPlant(plantId) {
  const list = [plantId, ...recentPlants().filter(id => id !== plantId)].slice(0, 12);
  try { localStorage.setItem(config.storageKeys.recentPlants, JSON.stringify(list)); } catch { /* not persisted */ }
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

/** Collection name, else (places) its single plant, else "Benoîte + 2 autres". @param {Collection} place */
export function placeTitle(place) {
  if (place.properties.kind === 'favorites') return 'Favoris';
  if (place.properties.name) return place.properties.name;
  if (place.properties.kind === 'list') return 'Liste sans nom';
  const plants = place.properties.plants;
  if (plants.length === 1) return entryName(plants[0]);
  if (!plants.length) return 'Lieu sans plante';
  return `${entryName(plants[0])} + ${plants.length - 1} autre${plants.length > 2 ? 's' : ''}`;
}

export const collectionTitle = placeTitle;

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
  if (!place.geometry) return '#';
  const [lon, lat] = place.geometry.coordinates;
  if (/android/i.test(navigator.userAgent)) return `geo:${lat},${lon}?q=${lat},${lon}`;
  if (/iphone|ipad|ipod|macintosh/i.test(navigator.userAgent)) return `https://maps.apple.com/?daddr=${lat},${lon}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}

// ── GeoJSON export / import ───────────────────────────────────────────────

/**
 * Exports every collection (or only `only`) as a GeoJSON FeatureCollection file.
 * @param {Collection[]} [only]
 */
export async function exportGeoJSON(only) {
  const features = (only || await listCollections()).sort((a, b) => a.properties.createdAt.localeCompare(b.properties.createdAt));
  const collection = {
    type: 'FeatureCollection',
    name: only?.length === 1 ? 'GeoFlora — ' + collectionTitle(only[0]) : 'GeoFlora — mes plantes',
    generator: 'GeoFlora',
    formatVersion: 4,
    exportedAt: new Date().toISOString(),
    features
  };
  const date = new Date().toISOString().slice(0, 10);
  const slug = only?.length === 1
    ? collectionTitle(only[0]).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'collection'
    : 'mes-plantes';
  const file = new File([JSON.stringify(collection, null, 2)], `geoflora-${slug}-${date}.geojson`, { type: 'application/geo+json' });

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
  if (!only) {
    try { localStorage.setItem(config.storageKeys.lastExport, new Date().toISOString()); } catch { /* not persisted */ }
  }
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

  const existing = new Map((await listCollections()).map(place => [place.id, place]));
  const result = { added: 0, updated: 0, unchanged: 0, skipped: 0 };
  /** @type {Place[]} */
  const toSave = [];

  for (const feature of features) {
    let place = normalizeCollection(feature);
    if (!place) { result.skipped++; continue; }
    if (place.geometry) place.geometry.coordinates = roundCoordinates(place.geometry.coordinates);
    for (const entry of place.properties.plants) {
      if (entry.plantId !== null || !entry.scientificName) continue;
      const plant = byName.get(entry.scientificName.toLowerCase());
      if (!plant) continue;
      entry.plantId = plant.id;
      entry.vernacularName ??= plant.vernacularNames?.[0] || null;
    }
    place.properties.plantIds = plantIdsOf(place.properties.plants);

    const current = existing.get(place.id);
    if (current && place.id === FAVORITES_ID) {
      // Favorites from two devices: keep the union rather than one side.
      const merged = place.properties.plants.reduce((acc, entry) => findEntry(acc, entry.plantId) ? acc : withPlants(acc, [...acc.properties.plants, entry]), current);
      if (merged === current) { result.unchanged++; continue; }
      place = { ...merged, properties: { ...merged.properties, updatedAt: new Date().toISOString() } };
      result.updated++;
    } else if (!current) {
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
    await changed();
  }
  return result;
}
