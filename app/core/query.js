// @ts-check
// Search query state (text, multi-select filters, sort): store ↔ URL hash ↔ worker.
// URL form: #/?q=ortie&family=Urticaceae,Rosaceae&status=I,J&photo=avec&sort=sci

import { replaceHash } from './history.js';
import { config } from '../config.js';
import { readJSON, writeJSON } from './prefs.js';
import { parse } from './router.js';
import { genusFamily, runSearch } from './search.js';
import { store } from './store.js';
import { APP } from './search-channel.js';

/** @typedef {import('./search-channel.js').Channel} Channel */

/** @typedef {import('./store.js').Query} Query */
/** @typedef {keyof import('./store.js').Filters} Facet */

/** @type {Facet[]} */
export const FACETS = ['mine', 'status', 'legal', 'family', 'genus', 'photo', 'french'];

/** @returns {import('./store.js').Filters} */
const emptyFilters = () => ({ status: [], legal: [], family: [], genus: [], photo: [], french: [], mine: [] });

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

/** Each search's pending run (a keystroke's debounce). @type {WeakMap<Channel, number>} */
const timers = new WeakMap();

/**
 * Updates the query, mirrors it in the URL and re-runs the search — the app's, or another's (`channel`: a free
 * layout's second group; its layout writes its address).
 * @param {Partial<Query>} patch
 * @param {{ debounce?: number, channel?: Channel }} [options]
 */
export function setQuery(patch, { debounce = 0, channel = APP } = {}) {
  // Something typed: the suggestions kept from the text before give way to the new ones.
  if (patch.q && channel === APP) held = null;
  const query = { ...channel.query, ...patch };
  channel.setQuery(query);
  // replaceState (not push): the back button leaves the list instead of undoing filters one by one.
  if (channel === APP && parse(location.hash).name === 'search') replaceHash(toHash(query));
  clearTimeout(timers.get(channel));
  if (debounce) timers.set(channel, /** @type {any} */ (setTimeout(() => channel.run(), debounce)));
  else channel.run();
}

/**
 * The « Filtrer par » suggestions of the text typed, kept once one is chosen (the text gives way to the filter):
 * the others stay offered, the one chosen shown on; removing every filter they made gives the text back
 * (unless something else was typed since).
 * @type {{ q: string, list: { type: Facet, name: string, count: number }[] } | null}
 */
let held = null;

/**
 * The suggestions kept from the text (see `held`) while a filter they made is on: the search emptied or replaced
 * from elsewhere (« Tout effacer », an address), they are let go — never shown, nor their text given back, after.
 */
const kept = () => held?.list.some(x => store.state.query.filters[x.type]?.includes(x.name)) ? held : null;

/** The suggestions kept from the text (see `held`), or null. */
export const heldSuggestions = () => kept()?.list || null;

/**
 * Genera only make sense inside the selected families: those of other families let go (a family chosen in its
 * filter, or by « Filtrer par »). @param {import('./store.js').Filters} filters
 */
const inFamilies = filters => filters.family.length
  ? { ...filters, genus: filters.genus.filter(genus => filters.family.includes(genusFamily.get(genus) || '')) }
  : filters;

/**
 * « Filtrer par : Urtica · genre »: the typed text becomes a filter (again: another one, or off).
 * @param {Facet} facet @param {string} value @param {Channel} [channel]
 */
export function applySuggestion(facet, value, channel = APP) {
  const { q, filters } = channel.query;
  if (q && channel === APP) held = { q, list: /** @type {any} */ (store.state.results.suggestions) };
  if (filters[facet].includes(value)) return setFacet(facet, filters[facet].filter(v => v !== value), channel);
  setQuery({ q: '', filters: inFamilies({ ...filters, [facet]: [...filters[facet], value] }) }, { channel });
}

/**
 * @param {Facet} facet @param {string[]} values @param {Channel} [channel]
 * @param {{ erase?: boolean }} [options] `erase`: its « effacer » — emptied for good, the text a « Filtrer par »
 *   suggestion made it from not given back
 */
export function setFacet(facet, values, channel = APP, { erase = false } = {}) {
  const before = channel.query.filters[facet];
  const filters = facet === 'family' ? inFamilies({ ...channel.query.filters, family: values }) : { ...channel.query.filters, [facet]: values };
  // Every filter the « Filtrer par » suggestions made from the search text gone: they are let go. The text comes back
  // when the last of them was taken off by hand (unticked, its ✕, the suggestion touched again) — not when the facet
  // was erased, nor when a value chosen put it out (a family not its genus's), nor if something else was typed since.
  const made = channel === APP ? kept() : null;
  if (made && !made.list.some(x => filters[x.type]?.includes(x.name))) {
    held = null;
    const removed = made.list.some(x => x.type === facet && before.includes(x.name) && !values.includes(x.name));
    const added = values.some(v => !before.includes(v));
    if (removed && !added && !erase && !store.state.query.q) return setQuery({ q: made.q, filters });
  }
  setQuery({ filters }, { channel });
}

/** @param {Facet} facet @param {string} value @param {Channel} [channel] */
export function toggleValue(facet, value, channel = APP) {
  const current = channel.query.filters[facet];
  setFacet(facet, current.includes(value) ? current.filter(v => v !== value) : [...current, value], channel);
}

/**
 * « Tout effacer »: every filter, for good — the text the « Filtrer par » suggestions were made from not given back.
 * A click's handler calls it with no argument (its event is not a channel). @param {Channel} [channel]
 */
export function clearFilters(channel = APP) {
  if (channel === APP) held = null;
  setQuery({ filters: emptyFilters() }, { channel });
}

/** Keeps the store in sync when the URL changes from outside (back/forward, pasted link). */
export function startUrlSync() {
  const sync = () => {
    if (parse(location.hash).name !== 'search') return;
    const query = fromHash(location.hash);
    if (toHash(query) === toHash(store.state.query)) return;
    // Another search: the suggestions kept from the text of this one go with it.
    held = null;
    store.set({ query });
    if (store.state.status === 'ready') runSearch();
  };
  addEventListener('hashchange', sync);
  sync();
}

// ── Recent searches ────────────────────────────────────────────────────────

/** @returns {string[]} */
export function recentSearches() {
  const list = readJSON(config.storageKeys.recentSearches, []);
  return Array.isArray(list) ? list.filter(item => typeof item === 'string') : [];
}

/** @param {string} q */
export function rememberSearch(q) {
  const value = q.trim();
  if (value.length < 2) return;
  const list = [value, ...recentSearches().filter(item => item.toLowerCase() !== value.toLowerCase())].slice(0, 8);
  writeJSON(config.storageKeys.recentSearches, list);
}

export function clearRecentSearches() {
  writeJSON(config.storageKeys.recentSearches, null);
}
