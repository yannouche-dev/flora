// @ts-check
// Where the user is in each part of the app — the Flore search and the plant open, the current collection or
// place, Mes plantes and the Carte as last seen — kept across tabs and reloads, so the parts link to each other:
// tabs come back to where they were, a plant goes to its places, a place to its plants in Flore. The current
// collection: the last one opened, or the last one a plant was put in (gf-add-to.js) — never a parcours under way
// (its walk adds its plants itself).

import { config } from '../config.js';
import { readJSON, writeJSON } from './prefs.js';
import { href, parse } from './router.js';
import { store } from './store.js';
import { tabShown } from './discover.js';
import { walkOn } from '../miniapp/kit/trail-store.js';

/**
 * @typedef {object} Context
 * @property {string | null} flore       last Flore view: a search ('#/?q=…') or a plant ('#/plant/123')
 * @property {string | null} query       last search (text, filters, sort), as a hash
 * @property {string | null} collection  current collection or place: the last one opened, or a plant put in
 * @property {string | null} mine        Mes plantes as last seen ('#/collections…')
 * @property {string | null} map         the Carte as last seen ('#/map…')
 * @property {number[]} mapPlants        the Carte's plant filter
 */

/** @type {Context} */
const EMPTY = { flore: null, query: null, collection: null, mine: null, map: null, mapPlants: [] };

/** @returns {Context} */
function read() {
  const saved = readJSON(config.storageKeys.context, null);
  if (!saved || typeof saved !== 'object') return { ...EMPTY };
  const str = (/** @type {any} */ v, /** @type {string} */ prefix) => typeof v === 'string' && v.startsWith(prefix) ? v : null;
  return {
    flore: str(saved.flore, '#/'),
    query: str(saved.query, '#/'),
    collection: typeof saved.collection === 'string' ? saved.collection : null,
    mine: str(saved.mine, '#/collections'),
    map: str(saved.map, '#/map'),
    mapPlants: Array.isArray(saved.mapPlants) ? saved.mapPlants.filter(Number.isInteger) : []
  };
}

/** The current context. @returns {Context} */
export const context = () => store.state.context || EMPTY;

/** @param {Partial<Context>} patch */
export function setContext(patch) {
  // A parcours under way is not a current collection: the plants its walk meets go to it already.
  if (patch.collection && patch.collection === walkOn()) patch = { ...patch, collection: context().collection };
  const next = { ...context(), ...patch };
  if (JSON.stringify(next) === JSON.stringify(context())) return;
  writeJSON(config.storageKeys.context, next); // not written: kept for this visit only
  store.set({ context: next });
}

/**
 * Where a tab goes: back to where it was left; when it is the tab already shown, to its start (the search list,
 * Mes plantes, the whole Carte), so there is always a way back.
 * @param {'flore' | 'mine' | 'map'} tab @param {boolean} [current]
 */
export function tabHref(tab, current = false) {
  const c = context();
  if (tab === 'flore') return (current ? c.query : c.flore || c.query) || '#/';
  if (tab === 'mine') return (current ? null : c.mine) || '#/collections';
  return (current ? null : c.map) || '#/map';
}

/** Flore as it was left — its search, the plant open: the Flore tab, the logo, the ways back into the app. Découvrir until Flore has come. */
export const floreHref = () => tabShown('flore') ? tabHref('flore') : href.discover();
/** Its name, for the links that lead there (« Aller à Flore »). */
export const floreName = () => tabShown('flore') ? 'Flore' : 'Découvrir';

/** The current view, recorded as it is reached (links, Back, tabs). */
function follow() {
  const hash = location.hash || '#/';
  const route = parse(hash);
  switch (route.name) {
    case 'search': setContext({ flore: hash, query: hash }); break;
    case 'plant': setContext({ flore: hash }); break;
    case 'collections': setContext({ mine: hash, ...(route.open ? { collection: route.open } : {}) }); break;
    case 'map': setContext({ map: hash, ...(route.spot ? { collection: route.spot } : {}) }); break;
    case 'spot': setContext({ collection: route.id }); break;
    default: break;
  }
}

store.set({ context: read() });
addEventListener('hashchange', follow);
addEventListener('popstate', follow);
addEventListener('gf-location', follow);
follow();
