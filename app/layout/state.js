// @ts-check
// The live state a free layout's cells share (« Disposition libre », gf-layout.js): one small store, an EventTarget,
// that every cell reads and writes — never one cell to another. What it holds, and the address beside the layout:
//   ?p=<plant>                         the current plant: every plant cell (plant, plant.<block>, media) shows it, the
//                                      results and the deck light it, the map lights its observations in the scope;
//   &at=<lat>,<lon>&r=<500m|2km>&place=<name>   the scope: a circle; the plants observed in it (iNaturalist, matched to
//                                      the flora: core/nearby.js) keep the search to them (core/search.js#setSearchScope),
//                                      the map shows its observations of the plants found;
//   &o=<observation>                   an observation lit on the map (a point touched);
//   &q=…&family=…&sort=…               the search itself: Flore's (core/query.js — the same words as #/?q=…), kept in the
//                                      store, so the search cell is Flore's own bar, filters and list.
// A link with them gives the same screen; Back and Forward walk the plants and places chosen (a new entry each), while
// typing, a filter or the radius only replace the address (as Flore's search does).
//
// What it loads for the scope (the plants observed in the circle, its latest observations, the current plant's own
// observations there) is asked once the circle rests (250 ms), the request before cancelled, a late answer for another
// circle dropped. Pure functions (readLive, liveSearch) are tested under Node; the class needs the app.

import * as db from '../core/db.js';
import { observationPointsAround, observationsAround, speciesAround } from '../core/nearby.js';
import { fromHash, toHash } from '../core/query.js';
import { runSearch, setSearchScope } from '../core/search.js';
import { whenReady } from '../core/store.js';
import { DISTANCE, distanceText, parseDistance } from './registry.js';

/**
 * @typedef {{ plant: number | null, at: [number, number] | null, r: number | null, place: string | null, obs: string | null }} Live
 *   `at`: [lon, lat]; `r`: metres (null: not said — the layout's default)
 * @typedef {import('../core/nearby.js').NearbySpecies} NearbySpecies
 * @typedef {import('../core/nearby.js').AroundPoint} AroundPoint
 * @typedef {{ coordinates: [number, number], date: string | null, url: string }} Observation
 * @typedef {'push' | 'replace' | 'none'} How   how the address follows a change: a new entry, the same one, not at all
 */

/** The radius of a scope when neither the address nor a cell says one. */
export const DEFAULT_RADIUS = 2000;

/** @type {Live} */
export const EMPTY = Object.freeze({ plant: null, at: null, r: null, place: null, obs: null });

/** An observation's id in the address: the end of its iNaturalist address. @param {string} url */
export const obsId = url => /(\d+)\/?$/.exec(url)?.[1] ?? url;

/**
 * The live state of an address' query (after « ? »): what is wrong or missing is left out.
 * @param {string} search @returns {Live}
 */
export function readLive(search) {
  const params = new URLSearchParams(search);
  const p = params.get('p') || '';
  const at = (params.get('at') || '').split(',').map(Number);
  const ok = at.length === 2 && at.every(Number.isFinite) && Math.abs(at[0]) <= 90 && Math.abs(at[1]) <= 180;
  const o = params.get('o') || '';
  return {
    plant: /^\d{1,9}$/.test(p) && Number(p) > 0 ? Number(p) : null,
    at: ok ? [at[1], at[0]] : null,
    r: parseDistance(params.get('r')),
    place: (params.get('place') || '').trim().slice(0, 80) || null,
    obs: /^[\w-]{1,40}$/.test(o) ? o : null
  };
}

/**
 * The query of an address for this state and this search: the plant, the scope (its radius always said: `radius` when
 * the state has none), the observation, then the search's own words (core/query.js).
 * @param {Live} live @param {import('../core/store.js').Query} query @param {number} [radius] @returns {string}
 */
export function liveSearch(live, query, radius = DEFAULT_RADIUS) {
  const params = new URLSearchParams();
  if (live.plant) params.set('p', String(live.plant));
  if (live.at) {
    params.set('at', `${live.at[1].toFixed(5)},${live.at[0].toFixed(5)}`);
    params.set('r', distanceText(live.r ?? radius));
    if (live.place) params.set('place', live.place);
  }
  if (live.obs) params.set('o', live.obs);
  const own = params.toString().replace(/%2C/g, ',');
  const words = toHash(query).replace(/^#\/\??/, '');
  return [own, words].filter(Boolean).join('&');
}

/** The search an address' query says (core/query.js). @param {string} search */
export const readQuery = search => fromHash('#/?' + search);

/** Two states the same? @param {Live} a @param {Live} b */
export const sameLive = (a, b) => a.plant === b.plant && a.r === b.r && a.place === b.place && a.obs === b.obs
  && (a.at === b.at || (a.at !== null && b.at !== null && a.at[0] === b.at[0] && a.at[1] === b.at[1]));

/** The live state of a layout on screen, and what it loads for it. Fires `change` (detail: { how, keys }). */
export class LayoutState extends EventTarget {
  /** @param {{ radius?: number | null }} [defaults] the layout's own default radius (a map or a place cell's r=) */
  constructor(defaults = {}) {
    super();
    /** @type {Live} */
    this.live = EMPTY;
    this.defaultRadius = defaults.radius ?? DEFAULT_RADIUS;
    /** The plants observed in the scope (null: no scope, or not yet), and whether they are coming or failed. */
    /** @type {{ key: string, list: NearbySpecies[], byPlant: Map<number, NearbySpecies>, plantOf: Map<number, number> } | null} */
    this.species = null;
    /** @type {'idle' | 'loading' | 'ready' | 'error'} */
    this.speciesState = 'idle';
    /** @type {string | null} */
    this.speciesError = null;
    /** The latest observations in the scope (the map), and how many there are in all. @type {AroundPoint[]} */
    this.points = [];
    this.pointsTotal = 0;
    /** The current plant's own observations in the scope. @type {{ key: string, points: Observation[] } | null} */
    this.plantObs = null;
    /** The current plant's names (the cells' heads). @type {{ id: number, name: string, sci: string } | null} */
    this.plantInfo = null;
    /** The search is kept to the scope's plants (core/search.js): taken off when the layout goes. */
    this.scoped = false;
    /** @type {AbortController | null} */ this.abort = null;
    /** @type {any} */ this.timer = 0;
    this.scopeFor = '';
    this.obsFor = '';
    this.infoFor = 0;
  }

  /** The radius in use: the address', else the layout's default. */
  get radius() { return this.live.r ?? this.defaultRadius; }

  /** The scope's key ('' without one). */
  get scopeKey() { return this.live.at ? this.radius + ':' + this.live.at.join(',') : ''; }

  /**
   * A change: the address follows as `how` says (gf-layout.js listens), and what it needs is loaded.
   * @param {Partial<Live>} patch @param {How} [how] @returns {boolean} whether anything changed
   */
  set(patch, how = 'replace') {
    const next = { ...this.live, ...patch };
    if (next.r != null) next.r = Math.min(DISTANCE.max, Math.max(DISTANCE.min, next.r));
    const keys = /** @type {(keyof Live)[]} */ (Object.keys(patch)).filter(k => k === 'at' ? !sameLive({ ...EMPTY, at: next.at }, { ...EMPTY, at: this.live.at }) : next[k] !== this.live[k]);
    if (!keys.length) return false;
    this.live = Object.freeze(next);
    this.dispatchEvent(new CustomEvent('change', { detail: { how, keys } }));
    this.follow();
    return true;
  }

  /** The current plant (a result, a point, a card touched), with the observation lit (none: off). @param {number | null} id @param {{ obs?: string | null, how?: How }} [o] */
  pick(id, { obs = null, how = 'push' } = {}) { this.set({ plant: id, obs }, how); }

  /** The scope: a circle around `at` (null: none — the whole flora). @param {[number, number] | null} at @param {string | null} [place] @param {How} [how] */
  setScope(at, place = null, how = 'push') { this.set({ at, place: at ? place : null, obs: null }, how); }

  /** A changed state: its loads started (the scope's, after a rest; the plant's names and observations). */
  follow() {
    const key = this.scopeKey;
    if (key !== this.scopeFor) {
      this.scopeFor = key;
      clearTimeout(this.timer);
      this.abort?.abort();
      this.abort = null;
      if (!key) {
        this.species = null; this.speciesState = 'idle'; this.speciesError = null; this.points = []; this.pointsTotal = 0;
        this.#rescope(null);
        this.#changed();
      } else {
        this.speciesState = 'loading';
        this.#changed();
        this.timer = setTimeout(() => this.#loadScope(key), 250);
      }
    }
    this.#loadPlant();
  }

  /** Something loaded: the cells draw again (the address does not change). */
  #changed() { this.dispatchEvent(new CustomEvent('change', { detail: { how: 'none', keys: [] } })); }

  /** @param {string} key */
  async #loadScope(key) {
    const at = /** @type {[number, number]} */ (this.live.at), r = this.radius;
    const abort = this.abort = new AbortController();
    // The flora in the database first: iNaturalist's names are matched to it (core/nearby.js reads it once).
    await whenReady();
    if (abort.signal.aborted || key !== this.scopeKey) return;
    const points = observationPointsAround(at, r, abort.signal).catch(() => null);
    try {
      const found = await speciesAround(at, r, abort.signal);
      if (abort.signal.aborted || key !== this.scopeKey) return;
      const list = found.species.filter(s => s.plantId);
      this.species = { key, list, byPlant: new Map(list.map(s => [/** @type {number} */ (s.plantId), s])), plantOf: new Map(list.map(s => [s.taxonId, /** @type {number} */ (s.plantId)])) };
      this.speciesState = 'ready';
      this.speciesError = null;
      this.#rescope(list.map(s => /** @type {number} */ (s.plantId)));
    } catch (error) {
      if (abort.signal.aborted || key !== this.scopeKey) return;
      const e = /** @type {Error} */ (error);
      this.species = null;
      this.speciesState = 'error';
      this.speciesError = e.name === 'ModuleOffError' ? 'Le module iNaturalist est désactivé (Réglages › Modules) : la zone ne filtre pas les plantes.'
        : navigator.onLine ? 'iNaturalist ne répond pas : la zone ne filtre pas les plantes pour l’instant.' : 'Hors ligne : la zone ne filtre pas les plantes (iNaturalist est en ligne).';
      this.#rescope(null);
    }
    this.#changed();
    this.#loadPlant();
    const found = await points;
    if (abort.signal.aborted || key !== this.scopeKey) return;
    this.points = found?.points ?? [];
    this.pointsTotal = found?.total ?? 0;
    this.#changed();
  }

  /** The search kept to these plants (null: the whole flora), and run again. @param {number[] | null} ids */
  async #rescope(ids) {
    if (!ids && !this.scoped) return;
    this.scoped = Boolean(ids);
    setSearchScope(ids);
    await whenReady();
    runSearch();
  }

  /** The current plant: its names (the cells' heads), its observations in the scope (the map). */
  async #loadPlant() {
    const id = this.live.plant;
    if (id && this.infoFor !== id) {
      this.infoFor = id;
      const plant = await db.get('plants', id).catch(() => null);
      if (this.live.plant !== id) return;
      this.plantInfo = plant ? { id, name: plant.vernacularNames?.[0] || plant.scientificName, sci: plant.scientificName } : null;
      this.#changed();
    } else if (!id && this.plantInfo) { this.infoFor = 0; this.plantInfo = null; this.#changed(); }
    const s = this.species;
    const taxon = id && s ? s.byPlant.get(id)?.taxonId ?? null : null;
    const key = id && s ? id + '@' + s.key : '';
    if (key === this.obsFor) return;
    this.obsFor = key;
    if (!key || !this.live.at) { if (this.plantObs) { this.plantObs = null; this.#changed(); } return; }
    if (!taxon) { this.plantObs = { key, points: [] }; this.#changed(); return; }
    const pts = await observationsAround(taxon, this.live.at, this.radius).catch(() => []);
    if (this.obsFor !== key) return;
    this.plantObs = { key, points: pts };
    this.#changed();
  }

  /** The layout gone: its loads stopped, the search back to the whole flora. */
  dispose() {
    clearTimeout(this.timer);
    this.abort?.abort();
    if (this.scoped) { this.scoped = false; setSearchScope(null); whenReady().then(() => runSearch()); }
  }
}
