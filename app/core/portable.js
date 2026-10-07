// @ts-check
// Portable form of collections: a slim GeoJSON FeatureCollection holding only what the user entered.
// The flora itself (names, families…) is already in every copy of the app, so it is never written:
// plants are referenced by TAXREF id and their names are re-filled on import. Defaults, derived
// fields and app timestamps are left out. Used by the file export, the local backup and transfer links.
// No imports: usable anywhere (page, tests).

export const FORMAT_VERSION = 5;

const round6 = (/** @type {number} */ n) => Math.round(n * 1e6) / 1e6;
/** @param {[number, number]} c @returns {[number, number]} */
const point = c => [round6(c[0]), round6(c[1])];
const same = (/** @type {[number, number]} */ a, /** @type {[number, number]} */ b) => a[0] === b[0] && a[1] === b[1];

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
 */
function slimEntry(e, at, personal) {
  /** @type {Record<string, any>} */
  const out = {};
  if (e.plantId !== null) out.plantId = e.plantId;
  else out.scientificName = e.scientificName; // unknown to this flora: the name is all there is
  if (e.abundance && e.abundance !== 'moyen') out.abundance = e.abundance;
  if (e.rating > 0) out.rating = e.rating;
  if (at && e.coordinates) {
    const own = point(e.coordinates);
    if (!same(own, at)) out.coordinates = own;
    if (e.accuracy !== null && e.accuracy !== undefined && !same(own, at)) out.accuracy = e.accuracy;
  }
  if (personal) {
    if (e.notes) out.notes = e.notes;
    if (e.harvests?.length) out.harvests = e.harvests.map(slimHarvest);
  }
  return out;
}

/**
 * @param {import('./place-model.js').Collection[]} collections
 * @param {{ personal?: boolean, name?: string }} [options] personal: include notes and harvest logs
 */
export function toPortable(collections, { personal = true, name = 'GeoFlora — mes plantes' } = {}) {
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
      props.createdAt = p.createdAt;
      props.updatedAt = p.updatedAt;
      props.plants = p.plants.map(e => slimEntry(e, at, personal));
      return { type: 'Feature', id: c.id, geometry: at ? { type: 'Point', coordinates: at } : null, properties: props };
    })
  };
}

/** Whether a portable/GeoJSON payload carries personal notes or harvests. @param {any} fc */
export function hasPersonal(fc) {
  return (fc?.features || []).some((/** @type {any} */ f) =>
    f?.properties?.notes || (f?.properties?.plants || []).some((/** @type {any} */ e) => e?.notes || e?.harvests?.length));
}
