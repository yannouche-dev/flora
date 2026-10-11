// @ts-check
// Where the user is in each part of the app — the Flore search and the plant open, the current collection or
// place, Mes plantes and the Carte as last seen — kept across tabs and reloads, so the parts link to each other:
// tabs come back to where they were, a plant goes to its places, a place to its plants in Flore.

import { config } from '../config.js';
import { parse } from './router.js';
import { store } from './store.js';

/**
 * @typedef {object} Context
 * @property {string | null} flore       last Flore view: a search ('#/?q=…') or a plant ('#/plant/123')
 * @property {string | null} query       last search (text, filters, sort), as a hash
 * @property {number | null} plant       current plant: the last one opened anywhere
 * @property {string | null} collection  current collection or place: the last one opened anywhere
 * @property {string | null} mine        Mes plantes as last seen ('#/collections…')
 * @property {string | null} map         the Carte as last seen ('#/map…')
 * @property {number[]} mapPlants        the Carte's plant filter
 */

/** @type {Context} */
const EMPTY = { flore: null, query: null, plant: null, collection: null, mine: null, map: null, mapPlants: [] };

/** @returns {Context} */
function read() {
  try {
    const saved = JSON.parse(localStorage.getItem(config.storageKeys.context) || 'null');
    if (!saved || typeof saved !== 'object') return { ...EMPTY };
    const str = (/** @type {any} */ v, /** @type {string} */ prefix) => typeof v === 'string' && v.startsWith(prefix) ? v : null;
    return {
      flore: str(saved.flore, '#/'),
      query: str(saved.query, '#/'),
      plant: Number.isInteger(saved.plant) ? saved.plant : null,
      collection: typeof saved.collection === 'string' ? saved.collection : null,
      mine: str(saved.mine, '#/collections'),
      map: str(saved.map, '#/map'),
      mapPlants: Array.isArray(saved.mapPlants) ? saved.mapPlants.filter(Number.isInteger) : []
    };
  } catch { return { ...EMPTY }; }
}

/** The current context. @returns {Context} */
export const context = () => store.state.context || EMPTY;

/** @param {Partial<Context>} patch */
export function setContext(patch) {
  const next = { ...context(), ...patch };
  if (JSON.stringify(next) === JSON.stringify(context())) return;
  try { localStorage.setItem(config.storageKeys.context, JSON.stringify(next)); } catch { /* kept for this visit only */ }
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

/** The current view, recorded as it is reached (links, Back, tabs). */
function follow() {
  const hash = location.hash || '#/';
  const route = parse(hash);
  switch (route.name) {
    case 'search': setContext({ flore: hash, query: hash }); break;
    case 'plant': setContext({ flore: hash, plant: route.id }); break;
    case 'collections': setContext({ mine: hash, ...(route.open ? { collection: route.open } : {}), ...(route.plant ? { plant: route.plant } : {}) }); break;
    case 'map': {
      const plant = route.focus || route.plant;
      setContext({ map: hash, ...(route.spot ? { collection: route.spot } : {}), ...(plant ? { plant } : {}) });
      break;
    }
    case 'spot': setContext({ collection: route.id }); break;
    default: break;
  }
}

store.set({ context: read() });
addEventListener('hashchange', follow);
addEventListener('popstate', follow);
addEventListener('gf-location', follow);
follow();
