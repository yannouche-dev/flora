// @ts-check
// Main-thread client for workers/search.worker.js (latest request wins).

import { getMembership } from './collections.js';
import { store } from './store.js';

const worker = new Worker(new URL('../workers/search.worker.js', import.meta.url), { type: 'module' });

let lastRequest = 0;
/** @type {Map<number, { resolve: (value: any) => void, progress?: (data: any) => void }>} */
const waiting = new Map();

worker.addEventListener('message', ({ data }) => {
  const request = waiting.get(data.requestId);
  if (!request) return;
  // A step of a long request (install): told, the request still waiting for its answer.
  if (data.progress) { request.progress?.(data); return; }
  waiting.delete(data.requestId);
  request.resolve(data);
});

/** @param {Record<string, any>} message @param {(data: any) => void} [progress] */
function call(message, progress) {
  const requestId = ++lastRequest;
  return new Promise((resolve, reject) => {
    waiting.set(requestId, {
      // The error's name kept (QuotaExceededError: core/dataset.js tells the lack of room apart).
      resolve: data => data.error ? reject(Object.assign(new Error(data.error), data.name ? { name: data.name } : {})) : resolve(data),
      progress
    });
    worker.postMessage({ ...message, requestId });
  });
}

/** Genus → family, to keep genus filters consistent with family filters. @type {Map<string, string>} */
export const genusFamily = new Map();

/** @param {Record<string, string>} pairs */
function setGenusFamily(pairs) {
  genusFamily.clear();
  for (const [genus, family] of Object.entries(pairs)) genusFamily.set(genus, family);
}

/** (Re)builds the search index from IndexedDB. */
export async function loadIndex() {
  setGenusFamily((await call({ type: 'load' })).genusFamily);
}

/**
 * The flora `meta` announces, downloaded, checked and stored by the worker (search.worker.js), off the main thread.
 * `early` (a first launch, no local copy): `searchable` resolves as soon as the search runs on it (its index come),
 * `stored` once every record is in IndexedDB; until then plantFromWorker() reads them. Otherwise (an update) the search
 * moves to the new flora only once it is stored, and both resolve then.
 * @param {any} meta @param {{ early?: boolean }} [options]
 * @returns {{ searchable: Promise<void>, stored: Promise<void> }}
 */
export function installFlora(meta, { early = false } = {}) {
  /** @type {() => void} */
  let searchableNow = () => {};
  const searchable = new Promise(resolve => { searchableNow = () => resolve(undefined); });
  const stored = call({ type: 'install', meta, early }, data => {
    if (data.progress !== 'searchable') return;
    setGenusFamily(data.genusFamily);
    searchableNow();
  }).then(data => { setGenusFamily(data.genusFamily); });
  const ready = Promise.race([searchable, stored]);
  // A failure is the caller's to handle, where it awaits (not unhandled when it awaits only one of the two).
  ready.catch(() => {});
  stored.catch(() => {});
  return { searchable: ready, stored };
}

/** One record of the flora, from the worker: an early install's, before it is stored (else IndexedDB's). @param {number} id */
export async function plantFromWorker(id) {
  return (await call({ type: 'plant', id })).plant ?? undefined;
}

let searchRun = 0;

/**
 * The plants the search is kept to: a free layout's scope (app/layout/state.js: the plants observed around its place),
 * set while it is on screen and taken off when it goes; null: the whole flora. @type {number[] | null}
 */
let scope = null;
/** What comes with the scope: each plant's observations in it (the sort « Plus observées »), those a map shows of it. @type {ScopeExtra} */
let scopeExtra = {};

/**
 * @typedef {{ observed?: Record<number, number> | null, within?: number[] | null }} ScopeExtra
 *   `observed`: each plant's observations in the zone, by id (workers/search-core.js: the sort `obs`); `within`: the
 *   plants of the part of the zone a map shows (the results kept to them, the zone's said apart: `inZone`)
 */

/**
 * Keeps the search to these plants (null: the whole flora), with what comes with them; the next runSearch() follows.
 * @param {Iterable<number> | null} ids @param {ScopeExtra} [extra]
 */
export function setSearchScope(ids, extra = {}) { scope = ids ? [...ids] : null; scopeExtra = ids ? extra : {}; }

/** Runs the search for the current store query and publishes results, facets and suggestions. */
export async function runSearch() {
  const { q, filters, sort } = store.state.query;
  const run = ++searchRun;
  let response;
  try {
    response = await call({ type: 'search', q, filters, sort, membership: mineValues(filters), only: scope, observed: scopeExtra.observed ?? null,
      within: scopeExtra.within ?? null });
  } catch (error) {
    console.error(error);
    if (run === searchRun) store.set({ status: 'error', statusText: 'Recherche impossible : ' + /** @type {Error} */ (error).message });
    return;
  }
  const { total, items, facets, suggestions, fuzzy, sort: effectiveSort, counted, inZone } = response;
  // Drop answers that a newer keystroke already superseded.
  if (run === searchRun) {
    store.set({ results: { total, items, facets, suggestions, fuzzy, sort: effectiveSort, counted, inZone } });
  }
}

/**
 * The search of a query over the whole flora, whatever scope the search on screen is kept to (setSearchScope): a free
 * layout's results cell that leaves the zone (results(zone=0)). The store is left alone.
 * @param {import('./store.js').Query} query @returns {Promise<{ total: number, items: any[] }>}
 */
export async function searchWhole({ q, filters, sort }) {
  const { total, items } = await call({ type: 'search', q, filters, sort, membership: mineValues(filters), only: null });
  return { total, items };
}

/**
 * The search of a query kept to these plants (null: the whole flora), with what comes with them (setSearchScope), its
 * whole answer — results, facets, suggestions —, the store left alone: a search of its own beside the app's
 * (core/search-channel.js: a free layout's second group).
 * @param {import('./store.js').Query} query @param {number[] | null} only @param {ScopeExtra} [extra]
 */
export async function searchIn({ q, filters, sort }, only, extra = {}) {
  const { total, items, facets, suggestions, fuzzy, sort: effectiveSort, counted, inZone } = await call({ type: 'search', q, filters, sort,
    membership: mineValues(filters), only, observed: only ? extra.observed ?? null : null, within: only ? extra.within ?? null : null });
  return { total, items, facets, suggestions, fuzzy, sort: effectiveSort, counted, inZone };
}

const NO_FILTERS = { status: [], family: [], genus: [], photo: [], french: [], mine: [] };

/**
 * The plants of the flora matching a text (French or scientific names, typos forgiven), the closest first —
 * apart from the search on screen (its filters are not used): the same plants as the main search, all of them
 * unless `limit`. For a quick pick (Parcours botanique).
 * @param {string} q @param {number} [limit]
 * @returns {Promise<{ id: number, scientificName: string, vernacularName: string | null, family: string, thumbnail: any }[]>}
 */
export async function findPlants(q, limit = Infinity) {
  if (!q.trim()) return [];
  const response = await call({ type: 'search', q, filters: NO_FILTERS, sort: 'relevance', membership: {} });
  return (response.items || []).slice(0, limit);
}

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
 * One-off search that leaves the app's search state alone (plant pickers: « Ajouter une plante », « Noter ici »).
 * Same engine, matching and order as the Flore search; `total` is the full count, as Flore shows it.
 * @param {string} q @param {{ limit?: number }} [options]
 * @returns {Promise<{ total: number, items: any[] }>}
 */
export async function searchPlants(q, { limit = 30 } = {}) {
  const { total, items } = await call({ type: 'search', q, filters: NO_FILTERS, sort: '' });
  return { total, items: items.slice(0, limit) };
}
