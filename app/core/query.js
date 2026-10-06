// @ts-check
// Search query state (text, multi-select filters, sort): store ↔ URL hash ↔ worker.
// URL form: #/?q=ortie&family=Urticaceae,Rosaceae&status=I,J&photo=avec&sort=sci

import { config } from '../config.js';
import { parse } from './router.js';
import { genusFamily, runSearch } from './search.js';
import { store } from './store.js';

/** @typedef {import('./store.js').Query} Query */
/** @typedef {keyof import('./store.js').Filters} Facet */

/** @type {Facet[]} */
export const FACETS = ['mine', 'status', 'family', 'genus', 'photo', 'french'];

/** @returns {import('./store.js').Filters} */
const emptyFilters = () => ({ status: [], family: [], genus: [], photo: [], french: [], mine: [] });

/** @param {string} hash @returns {Query} */
export function fromHash(hash) {
  const params = new URLSearchParams(hash.split('?')[1] || '');
  const filters = emptyFilters();
  for (const facet of FACETS) {
    filters[facet] = (params.get(facet) || '').split(',').map(v => v.trim()).filter(Boolean);
  }
  return { q: params.get('q') || '', filters, sort: params.get('sort') || '' };
}

/** @param {Query} query */
export function toHash(query) {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  for (const facet of FACETS) if (query.filters[facet].length) params.set(facet, query.filters[facet].join(','));
  if (query.sort) params.set('sort', query.sort);
  const search = params.toString().replace(/%2C/g, ',');
  return '#/' + (search ? '?' + search : '');
}

/** @param {Query} query */
export const activeFilterCount = query => FACETS.reduce((n, facet) => n + query.filters[facet].length, 0);

/** Link back to the list exactly as it was (filters, sort, text). */
export const lastSearchHash = () => toHash(store.state.query);

/** @type {number | undefined} */
let timer;

/**
 * Updates the query, mirrors it in the URL and re-runs the search.
 * @param {Partial<Query>} patch
 * @param {{ debounce?: number }} [options]
 */
export function setQuery(patch, { debounce = 0 } = {}) {
  const query = { ...store.state.query, ...patch };
  store.set({ query });
  // replaceState (not push): the back button leaves the list instead of undoing filters one by one.
  if (parse(location.hash).name === 'search') history.replaceState(null, '', toHash(query));
  clearTimeout(timer);
  if (debounce) timer = setTimeout(runSearch, debounce);
  else runSearch();
}

/** @param {Facet} facet @param {string[]} values */
export function setFacet(facet, values) {
  const filters = { ...store.state.query.filters, [facet]: values };
  // Genera only make sense inside the selected families.
  if (facet === 'family' && values.length) {
    filters.genus = filters.genus.filter(genus => values.includes(genusFamily.get(genus) || ''));
  }
  setQuery({ filters });
}

/** @param {Facet} facet @param {string} value */
export function toggleValue(facet, value) {
  const current = store.state.query.filters[facet];
  setFacet(facet, current.includes(value) ? current.filter(v => v !== value) : [...current, value]);
}

export function clearFilters() {
  setQuery({ filters: emptyFilters() });
}

/** Keeps the store in sync when the URL changes from outside (back/forward, pasted link). */
export function startUrlSync() {
  const sync = () => {
    if (parse(location.hash).name !== 'search') return;
    const query = fromHash(location.hash);
    if (toHash(query) === toHash(store.state.query)) return;
    store.set({ query });
    if (store.state.status === 'ready') runSearch();
  };
  addEventListener('hashchange', sync);
  sync();
}

// ── Recent searches ────────────────────────────────────────────────────────

/** @returns {string[]} */
export function recentSearches() {
  try { return JSON.parse(localStorage.getItem(config.storageKeys.recentSearches) || '[]'); } catch { return []; }
}

/** @param {string} q */
export function rememberSearch(q) {
  const value = q.trim();
  if (value.length < 2) return;
  const list = [value, ...recentSearches().filter(item => item.toLowerCase() !== value.toLowerCase())].slice(0, 8);
  try { localStorage.setItem(config.storageKeys.recentSearches, JSON.stringify(list)); } catch { /* not persisted */ }
}

export function clearRecentSearches() {
  try { localStorage.removeItem(config.storageKeys.recentSearches); } catch { /* nothing to clear */ }
}
