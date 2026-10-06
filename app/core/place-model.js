// @ts-check
// Shape of a harvest place, shared by the database upgrade, the app and GeoJSON import.
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
 * @typedef {object} PlaceProperties
 * @property {string} name
 * @property {string} notes
 * @property {number | null} accuracy    GPS accuracy (m) when recorded
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {PlantEntry[]} plants
 * @property {number[]} plantIds         derived from `plants`, indexed (multiEntry) for "places of a plant"
 * @typedef {{ type: 'Feature', id: string, geometry: { type: 'Point', coordinates: [number, number] }, properties: PlaceProperties }} Place
 */

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
 * Brings any stored or imported place to the current shape. Accepts the first format,
 * where a spot held a single plant directly in its properties (plantId, abundance, harvests…).
 * Returns null when the feature is not a usable point.
 * @param {any} feature
 * @returns {Place | null}
 */
export function normalizePlace(feature) {
  if (feature?.type !== 'Feature' || feature.geometry?.type !== 'Point') return null;
  const [lon, lat] = feature.geometry.coordinates || [];
  if (!isNumber(lon) || !isNumber(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

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

  return {
    type: 'Feature',
    id: typeof feature.id === 'string' && feature.id ? feature.id : (globalThis.crypto?.randomUUID?.() ?? String(Date.now() + Math.random())),
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
      name: text(p.name ?? p.label, 300),
      // Format 1 notes belonged to the single plant; they now live on its entry.
      notes: Array.isArray(p.plants) ? text(p.notes) : '',
      accuracy: isNumber(p.accuracy) ? p.accuracy : null,
      createdAt,
      updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : now,
      plants,
      plantIds: plantIdsOf(plants)
    }
  };
}
