// @ts-check
// Main-thread client for workers/search.worker.js (latest request wins).

import { getMembership } from './collections.js';
import { store } from './store.js';

const worker = new Worker(new URL('../workers/search.worker.js', import.meta.url), { type: 'module' });

let lastRequest = 0;
/** @type {Map<number, (value: any) => void>} */
const waiting = new Map();

worker.addEventListener('message', ({ data }) => {
  const resolve = waiting.get(data.requestId);
  if (!resolve) return;
  waiting.delete(data.requestId);
  resolve(data);
});

/** @param {Record<string, any>} message */
function call(message) {
  const requestId = ++lastRequest;
  return new Promise((resolve, reject) => {
    waiting.set(requestId, data => data.error ? reject(new Error(data.error)) : resolve(data));
    worker.postMessage({ ...message, requestId });
  });
}

/** Genus → family, to keep genus filters consistent with family filters. @type {Map<string, string>} */
export const genusFamily = new Map();

/** (Re)builds the search index from IndexedDB. */
export async function loadIndex() {
  const data = await call({ type: 'load' });
  genusFamily.clear();
  for (const [genus, family] of Object.entries(data.genusFamily)) genusFamily.set(genus, family);
}

let searchRun = 0;

/** Runs the search for the current store query and publishes results, facets and suggestions. */
export async function runSearch() {
  const { q, filters, sort } = store.state.query;
  const run = ++searchRun;
  let response;
  try {
    response = await call({ type: 'search', q, filters, sort, membership: mineValues(filters) });
  } catch (error) {
    console.error(error);
    if (run === searchRun) store.set({ status: 'error', statusText: 'Recherche impossible : ' + /** @type {Error} */ (error).message });
    return;
  }
  const { total, items, facets, suggestions, fuzzy, sort: effectiveSort } = response;
  // Drop answers that a newer keystroke already superseded.
  if (run === searchRun) {
    store.set({ results: { total, items, facets, suggestions, fuzzy, sort: effectiveSort } });
  }
}

const NO_FILTERS = { status: [], family: [], genus: [], photo: [], french: [], mine: [] };

/**
 * "Mes plantes" facet values per plant: the collection ids containing it, plus 'place' when
 * it is in at least one place. Only sent when useful (facet active or counts needed).
 * @param {Record<string, string[]>} filters
 * @returns {Record<number, string[]>}
 */
function mineValues(filters) {
  const { byPlant, collections } = getMembership();
  if (!collections.length && !filters.mine?.length) return {};
  const places = new Set(collections.filter(c => c.kind === 'place').map(c => c.id));
  /** @type {Record<number, string[]>} */
  const out = {};
  for (const [plantId, ids] of byPlant) out[plantId] = ids.some(id => places.has(id)) ? [...ids, 'place'] : ids;
  return out;
}

/**
 * One-off search that leaves the app's search state alone (plant picker of the spot editor).
 * @param {string} q @param {number} [limit]
 */
export async function searchPlants(q, limit = 20) {
  const { items } = await call({ type: 'search', q, filters: NO_FILTERS, sort: '' });
  return items.slice(0, limit);
}
