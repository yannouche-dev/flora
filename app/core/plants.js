// @ts-check
// A plant of the flora — a TAXREF record of the plants store (`vernacularNames: string[]`) —: its names, its reads
// and its flowering months, the same wherever it is shown (the sheet, the free layouts, the mini-apps, the collections).
//  - nameOf: its first common name, else its scientific one; commonOf: its first common name, or null. An empty first
//    name falls back as a missing one. A search summary or a collection entry (`vernacularName`) is another shape,
//    read where it is used;
//  - getPlant(id): the record, or null — not in the flora, or unreadable; getPlants(ids): those found, in order,
//    rejected if one read fails. Neither waits for the store nor keeps anything: on a first launch db.get reads the
//    worker until the flora is stored (core/dataset.js), and a miss then is not a miss for good. The reads whose
//    failure is said on screen call db.get themselves;
//  - floweringMonths(period): the months of a Baseflor flowering period (the calendar, the cards around a place).
// Its only import is db.js: usable in the worker and under Node (tests/unit/plants.test.mjs).

import * as db from './db.js';

/** Its first common name, else its scientific one. @param {any} plant @returns {string} */
export const nameOf = plant => plant?.vernacularNames?.[0] || plant?.scientificName;

/** Its first common name, or null. @param {any} plant @returns {string | null} */
export const commonOf = plant => plant?.vernacularNames?.[0] || null;

/**
 * A plant's record; null when it is not in the flora or cannot be read (never rejected).
 * @param {IDBValidKey} id @returns {Promise<any>}
 */
export const getPlant = id => db.get('plants', id).then(plant => plant ?? null, () => null);

/**
 * The records of these plants, in their order, those not in the flora left out; rejected if one cannot be read.
 * @param {IDBValidKey[]} ids @returns {Promise<any[]>}
 */
export const getPlants = ids => Promise.all(ids.map(id => db.get('plants', id))).then(plants => plants.filter(Boolean));

/**
 * Months (0–11) of a Baseflor flowering period [first, last] (1–12); last < first wraps over the year end.
 * @param {[number, number] | null | undefined} period
 * @returns {Set<number>}
 */
export function floweringMonths(period) {
  const months = new Set();
  if (!Array.isArray(period)) return months;
  const [first, last] = period;
  if (!(first >= 1 && first <= 12 && last >= 1 && last <= 12)) return months;
  for (let m = first; ; m = m % 12 + 1) {
    months.add(m - 1);
    if (m === last) break;
  }
  return months;
}
