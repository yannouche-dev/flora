// @ts-check
// Shape of a collection of plants (favorites, list or place), shared by the database upgrade,
// the app and GeoJSON import. A place is a collection with a Point; lists have `geometry: null`.
// No imports: db.js uses it during schema upgrades.

/**
 * @typedef {{ date: string, quantity?: string, note?: string }} Harvest
 * @typedef {'rare' | 'moyen' | 'abondant'} Abundance
 * @typedef {object} PlantEntry          one plant growing at a place
 * @property {number | null} plantId
 * @property {string} scientificName
 * @property {string | null} vernacularName
 * @property {Abundance} abundance
 * @property {number} rating             0–5
 * @property {string} notes
 * @property {string} addedAt
 * @property {Harvest[]} harvests        newest first
 * @typedef {'favorites' | 'list' | 'place'} CollectionKind
 * @typedef {object} PlaceProperties
 * @property {CollectionKind} kind
 * @property {string} name
 * @property {string} notes
 * @property {number | null} accuracy    GPS accuracy (m) when recorded
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {PlantEntry[]} plants
 * @property {number[]} plantIds         derived from `plants`, indexed (multiEntry) for "places of a plant"
 * @typedef {{ type: 'Point', coordinates: [number, number] }} PointGeometry
 * @typedef {{ type: 'Feature', id: string, geometry: PointGeometry | null, properties: PlaceProperties }} Collection
 * @typedef {Collection} Place   a collection, usually with a location
 */

export const FAVORITES_ID = 'favorites';
const KINDS = ['favorites', 'list', 'place'];

const ABUNDANCES = ['rare', 'moyen', 'abondant'];

const isNumber = (/** @type {unknown} */ n) => typeof n === 'number' && Number.isFinite(n);
const text = (/** @type {unknown} */ v, max = 5000) => typeof v === 'string' ? v.slice(0, max) : '';

/** @param {any[]} list @returns {Harvest[]} */
export const normalizeHarvests = list => (Array.isArray(list) ? list : [])
  .filter(h => h && /^\d{4}-\d{2}-\d{2}/.test(h.date))
  .map(h => ({ date: String(h.date).slice(0, 10), quantity: text(h.quantity, 200), note: text(h.note, 1000) }))
  .sort((a, b) => b.date.localeCompare(a.date));

/** @param {any} e @param {string} fallbackDate @returns {PlantEntry} */
export function normalizeEntry(e, fallbackDate) {
  return {
    plantId: isNumber(e?.plantId) ? e.plantId : null,
    scientificName: text(e?.scientificName, 300),
    vernacularName: e?.vernacularName ? text(e.vernacularName, 300) : null,
    abundance: ABUNDANCES.includes(e?.abundance) ? e.abundance : 'moyen',
    rating: isNumber(e?.rating) ? Math.max(0, Math.min(5, Math.round(e.rating))) : 0,
    notes: text(e?.notes),
    addedAt: typeof e?.addedAt === 'string' ? e.addedAt : fallbackDate,
    harvests: normalizeHarvests(e?.harvests)
  };
}

/** @param {PlantEntry[]} plants */
export const plantIdsOf = plants => [...new Set(plants.map(p => p.plantId).filter(isNumber))];

/**
 * Brings any stored or imported collection to the current shape. Accepts the first format,
 * where a spot held a single plant directly in its properties (plantId, abundance, harvests…),
 * and features without geometry (lists). Returns null when the feature is unusable.
 * @param {any} feature
 * @returns {Collection | null}
 */
export function normalizeCollection(feature) {
  if (feature?.type !== 'Feature') return null;

  /** @type {PointGeometry | null} */
  let geometry = null;
  if (feature.geometry) {
    if (feature.geometry.type !== 'Point') return null;
    const [lon, lat] = feature.geometry.coordinates || [];
    if (!isNumber(lon) || !isNumber(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    geometry = { type: 'Point', coordinates: [lon, lat] };
  }

  const p = feature.properties || {};
  const now = new Date().toISOString();
  const createdAt = typeof p.createdAt === 'string' ? p.createdAt : now;

  /** @type {PlantEntry[]} */
  let plants;
  if (Array.isArray(p.plants)) {
    plants = p.plants.map(e => normalizeEntry(e, createdAt)).filter(e => e.plantId !== null || e.scientificName);
  } else if (isNumber(p.plantId) || p.scientificName) {
    // Format 1: one plant per spot, its fields at the top level.
    plants = [normalizeEntry({ ...p, addedAt: createdAt }, createdAt)];
  } else {
    plants = [];
  }
  // Without geometry, only lists (and favorites) make sense.
  const id = typeof feature.id === 'string' && feature.id ? feature.id : (globalThis.crypto?.randomUUID?.() ?? String(Date.now() + Math.random()));
  let kind = KINDS.includes(p.kind) ? p.kind : geometry ? 'place' : 'list';
  if (id === FAVORITES_ID) kind = 'favorites';
  else if (kind === 'favorites') kind = 'list';
  if (kind === 'place' && !geometry) kind = 'list';
  if (kind !== 'place') geometry = null;

  return {
    type: 'Feature',
    id,
    geometry,
    properties: {
      kind,
      name: kind === 'favorites' ? 'Favoris' : text(p.name ?? p.label, 300),
      // Format 1 notes belonged to the single plant; they now live on its entry.
      notes: Array.isArray(p.plants) ? text(p.notes) : '',
      accuracy: geometry && isNumber(p.accuracy) ? p.accuracy : null,
      createdAt,
      updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : now,
      plants,
      plantIds: plantIdsOf(plants)
    }
  };
}

/** Former name, kept for the version-3 upgrade path. */
export const normalizePlace = normalizeCollection;
