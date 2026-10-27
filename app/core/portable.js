// @ts-check
// Portable form of collections: a slim GeoJSON FeatureCollection holding only what the user entered.
// The flora itself (names, families…) is already in every copy of the app, so it is never written:
// plants are referenced by TAXREF id and their names are re-filled on import. Defaults and derived fields are left
// out; an entry's date is kept (the order a parcours met its plants: format 6), unless it is its collection's creation,
// which is what a reader falls back on. Used by the file export, the local backup and transfer links.
// With personal data, the texts of the plant sheet's « Note » blocks go along (`sheetNotes`, a foreign member of the
// FeatureCollection, ignored by other GeoJSON readers): see sheet-notes.js portableNotes.
// No imports: usable anywhere (page, tests).

export const FORMAT_VERSION = 6;

const round6 = (/** @type {number} */ n) => Math.round(n * 1e6) / 1e6;
/** @param {[number, number]} c @returns {[number, number]} */
const point = c => [round6(c[0]), round6(c[1])];
const same = (/** @type {[number, number]} */ a, /** @type {[number, number]} */ b) => a[0] === b[0] && a[1] === b[1];

/** The altitude (m) kept for exactly this position, else null. @param {any} a @param {[number, number]} c */
const altitudeAt = (a, c) => a && typeof a.m === 'number' && Array.isArray(a.at) && a.at[0] === c[0] && a.at[1] === c[1] ? a.m : null;

/**
 * @param {any} h harvest
 */
function slimHarvest(h) {
  /** @type {Record<string, string>} */
  const out = { date: h.date };
  if (h.quantity) out.quantity = h.quantity;
  if (h.note) out.note = h.note;
  return out;
}

/**
 * @param {import('./place-model.js').PlantEntry} e
 * @param {[number, number] | null} at the place's point (rounded), null for lists
 * @param {boolean} personal
 * @param {string} createdAt its collection's creation (the date an entry without one is read with)
 */
function slimEntry(e, at, personal, createdAt) {
  /** @type {Record<string, any>} */
  const out = {};
  // An occurrence's own id (a plant noted several times in a place): kept, so devices agree on which is which.
  if (e.id && e.id !== 'p' + e.plantId) out.id = e.id;
  if (e.plantId !== null) out.plantId = e.plantId;
  else out.scientificName = e.scientificName; // unknown to this flora: the name is all there is
  if (e.abundance && e.abundance !== 'moyen') out.abundance = e.abundance;
  if (e.rating > 0) out.rating = e.rating;
  // When it was noted (a parcours: the order it met its plants), unless that is the collection's creation.
  if (e.addedAt && e.addedAt !== createdAt) out.addedAt = e.addedAt;
  if (at && e.coordinates) {
    const own = point(e.coordinates);
    if (!same(own, at)) out.coordinates = own;
    if (e.accuracy !== null && e.accuracy !== undefined && !same(own, at)) out.accuracy = e.accuracy;
    // Its ground altitude (metres), that of its position: not asked again where the file is opened.
    const m = altitudeAt(e.altitude, e.coordinates);
    if (m !== null) out.altitude = m;
  }
  // Made by a mini-app (a match's favourite): « Recommencer » it on the device that reads the file, and it goes too.
  if (e.origin) out.origin = e.origin;
  if (e.from) out.from = e.from;
  if (personal) {
    if (e.notes) out.notes = e.notes;
    if (e.harvests?.length) out.harvests = e.harvests.map(slimHarvest);
  }
  return out;
}

/**
 * @param {import('./place-model.js').Collection[]} collections
 * @param {{ personal?: boolean, name?: string, sheetNotes?: any[] }} [options] personal: include notes and harvest logs
 *   (and `sheetNotes`, the plant sheet's notes, when given)
 */
export function toPortable(collections, { personal = true, name = 'GeoFlora — mes plantes', sheetNotes } = {}) {
  return {
    type: 'FeatureCollection',
    name,
    generator: 'GeoFlora',
    formatVersion: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    features: collections.map(c => {
      const p = c.properties;
      const at = c.geometry ? point(c.geometry.coordinates) : null;
      /** @type {Record<string, any>} */
      const props = {};
      // Lists and favorites have no geometry; a list is named, favorites are known by their id.
      if (p.name) props.name = p.name;
      if (personal && p.notes) props.notes = p.notes;
      if (at && p.accuracy !== null && p.accuracy !== undefined) props.accuracy = p.accuracy;
      const m = c.geometry ? altitudeAt(p.altitude, c.geometry.coordinates) : null;
      if (m !== null) props.altitude = m;
      if (p.origin) props.origin = p.origin;
      if (p.from) props.from = p.from;
      // A parcours (its line, « Continuer »), and its start where the walker stood: a place's only.
      if (at && p.walk) props.walk = true;
      if (at && p.startedHere) props.startedHere = true;
      props.createdAt = p.createdAt;
      props.updatedAt = p.updatedAt;
      props.plants = p.plants.map(e => slimEntry(e, at, personal, p.createdAt));
      return { type: 'Feature', id: c.id, geometry: at ? { type: 'Point', coordinates: at } : null, properties: props };
    }),
    ...(personal && sheetNotes?.length ? { sheetNotes } : {})
  };
}

/** Whether a portable/GeoJSON payload carries personal notes or harvests. @param {any} fc */
export function hasPersonal(fc) {
  return Boolean(fc?.sheetNotes?.length) || (fc?.features || []).some((/** @type {any} */ f) =>
    f?.properties?.notes || (f?.properties?.plants || []).some((/** @type {any} */ e) => e?.notes || e?.harvests?.length));
}
