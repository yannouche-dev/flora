// @ts-check
// The verdict on a plant (core/danger.js), from the data the app carries — TAXREF statuses, the safety file, the
// look-alikes file, the outlines of the departments: all offline. Read here, decided there (pure), so the sheet, the
// cards of the games, « Noter ici » and the place editor give a plant one verdict.
// A data file that cannot be read is a reason of its own (danger.js UNREAD): the verdict never falls silently to none.

import { dangerLevel } from './danger.js';
import { lookalikesOf } from './lookalikes.js';
import { territoryAt } from './territory.js';
import { safetyOf } from './uses.js';

/** Where a point is, read once per point (the cards around a place share it). @type {Map<string, Promise<import('./territory.js').Territory | null | 'unread'>>} */
const places = new Map();

/** @param {[number, number]} at */
function territoryOf(at) {
  const key = at.map(n => n.toFixed(4)).join(',');
  let found = places.get(key);
  if (!found) {
    // Unreadable: 'unread' — a regional protection then counts here (fail closed), and the point is asked again next time.
    found = territoryAt(at).catch(() => { places.delete(key); return /** @type {'unread'} */ ('unread'); });
    places.set(key, found);
  }
  return found;
}

/**
 * The verdict on a plant (danger.js#dangerLevel): its toxicity, its confusions, its protection — at `at` when given
 * ([lon, lat]: where it is noted, the place around), else protection in France only.
 * @param {any} plant TAXREF record (with `statuses`)
 * @param {{ at?: [number, number] | null }} [o]
 * @returns {Promise<import('./danger.js').Verdict>}
 */
export async function verdictOf(plant, { at = null } = {}) {
  let unread = false;
  const [safety, confusions, territory] = await Promise.all([
    safetyOf(plant).catch(() => { unread = true; return null; }),
    lookalikesOf(plant).catch(() => { unread = true; return /** @type {import('./lookalikes.js').Lookalike[]} */ ([]); }),
    at ? territoryOf(at) : null
  ]);
  return dangerLevel({ statuses: plant?.statuses, safety, confusions, unread, territory });
}
