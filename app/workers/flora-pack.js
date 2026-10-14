// @ts-check
// The flora in two files for a fast first launch, written at deploy from data/plants.json (tools/pack-flora.mjs) and
// read by the search worker (search.worker.js): no DOM, no IndexedDB, so the build and the unit tests import it in Node.
//  - the index: what the search needs and the list shows (names, family, genus, status, thumbnail, legal facet), one
//    array per plant (no repeated keys, no pretty print): the search works as soon as it has come (~0.7 MB gzip);
//  - the details: the rest of each record (identifiers, links, flowering, INPN statuses), in the same order, with its id
//    (~0.2 MB gzip): with the index, the records of plants.json exactly (mergeFlora), stored in IndexedDB.
// No byte is duplicated between the two, and the pair weighs less than plants.json. data/meta.json says where they are
// and gives their sha256 (`files`, tools/pack-flora.mjs); its own `sha256` stays that of plants.json (the flora's
// fingerprint, compared by installed apps), which stays deployed: the app falls back to it whenever the pair fails.

/** Bumped when the shape changes: an app reads only the format it knows (else plants.json). */
export const PACK_FORMAT = 1;

/** The fields of a record in the index, in their order in each row (then `legal`, computed: not part of the record). */
export const INDEX_FIELDS = /** @type {const} */ (['id', 'family', 'genus', 'species', 'scientificName', 'author',
  'vernacularNames', 'synonyms', 'status', 'thumbnail']);

/** The key of a detail that lists the index fields a record does not have (absent, not null): kept exact. */
const ABSENT = '~absent';

/**
 * The two files of a flora. `legalOf(statuses)`: the « Protection et menace » facet values (search-core.js
 * legalValues), computed here so that the index needs no INPN statuses.
 * @param {any[]} plants @param {(statuses: any) => string[]} legalOf
 * @returns {{ index: { format: number, fields: string[], rows: any[][] }, details: { format: number, rows: [number, any][] } }}
 */
export function packFlora(plants, legalOf) {
  const rows = [], details = [];
  for (const plant of plants) {
    const row = INDEX_FIELDS.map(field => field in plant ? plant[field] : null);
    row.push(legalOf(plant.statuses));
    rows.push(row);
    /** @type {Record<string, any>} */
    const rest = {};
    for (const [key, value] of Object.entries(plant)) if (!INDEX_FIELDS.includes(/** @type {any} */ (key))) rest[key] = value;
    const absent = INDEX_FIELDS.filter(field => !(field in plant));
    if (absent.length) rest[ABSENT] = absent;
    details.push(/** @type {[number, any]} */ ([plant.id, rest]));
  }
  return { index: { format: PACK_FORMAT, fields: [...INDEX_FIELDS, 'legal'], rows }, details: { format: PACK_FORMAT, rows: details } };
}

/** @param {any} pack @param {string} what */
function checkFormat(pack, what) {
  if (!pack || pack.format !== PACK_FORMAT || !Array.isArray(pack.rows)) throw new Error(`${what} : format inconnu`);
}

/**
 * The plants of the index, as the search reads them (search-core.js buildIndex): the index fields, and `legal`.
 * Not records to store (no statuses, links…).
 * @param {any} index @returns {any[]}
 */
export function indexPlants(index) {
  checkFormat(index, 'index de la flore');
  const fields = /** @type {string[]} */ (index.fields);
  if (fields.length !== INDEX_FIELDS.length + 1 || INDEX_FIELDS.some((field, i) => fields[i] !== field)) throw new Error('index de la flore : champs inconnus');
  return index.rows.map((/** @type {any[]} */ row) => {
    /** @type {Record<string, any>} */
    const plant = {};
    INDEX_FIELDS.forEach((field, i) => { plant[field] = row[i]; });
    plant.legal = row[INDEX_FIELDS.length];
    return plant;
  });
}

/**
 * The records of plants.json again, from the two files (the details in the index's order, each with its plant's id:
 * a pair that does not match is refused).
 * @param {any} index @param {any} details @returns {any[]}
 */
export function mergeFlora(index, details) {
  checkFormat(index, 'index de la flore');
  checkFormat(details, 'détails de la flore');
  if (details.rows.length !== index.rows.length) throw new Error('détails de la flore : ' + details.rows.length + ' plantes, l’index en a ' + index.rows.length);
  return index.rows.map((/** @type {any[]} */ row, i) => {
    const [id, rest] = details.rows[i];
    if (id !== row[0]) throw new Error('détails de la flore : la plante ' + id + ' n’est pas celle de l’index (' + row[0] + ')');
    const absent = new Set(rest[ABSENT] || []);
    /** @type {Record<string, any>} */
    const plant = {};
    INDEX_FIELDS.forEach((field, j) => { if (!absent.has(field)) plant[field] = row[j]; });
    for (const [key, value] of Object.entries(rest)) if (key !== ABSENT) plant[key] = value;
    return plant;
  });
}
