// @ts-check
// The live state a free layout's cells share (« Disposition libre », gf-layout.js): one small store, an EventTarget,
// that every cell reads and writes — never one cell to another. What it holds, and the address beside the layout:
//   ?title=<words>                     the screen's own title (its heading, the page's title, the share's): plain
//                                      text, 80 characters at most, written first;
//   &p=<plant>                         the current plant: every plant cell (plant, plant.<block>, media) shows it, the
//                                      results and the deck light it, the map lights its observations in the scope;
//   &at=<lat>,<lon>&r=<500m|2km>&place=<name>   the scope: a circle; the plants observed in it (iNaturalist, matched to
//                                      the flora: core/nearby.js) keep the search to them (core/search.js#setSearchScope),
//                                      the map shows its observations of the plants found;
//   &place=<words> without at=         a place to find: the IGN geocoder asked (core/geoservices.js#findPlace:
//                                      « mirabel, menetrol, 63 »), the scope set there and the address replaced by its
//                                      at= and the label found (r= kept, else the layout's); not found, offline or the
//                                      module off: no scope, the reason said where the scope is (cells.js#scopeWords),
//                                      place= left in the address so that a reload asks again;
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
import { forgetFailures } from '../core/cache.js';
import { findPlace } from '../core/geoservices.js';
import { errorKind } from '../core/net.js';
import { observationPointsAround, observationsAround, speciesAround } from '../core/nearby.js';
import { observations3d } from '../core/around3d.js';
import { fromHash, toHash } from '../core/query.js';
import { runSearch, setSearchScope } from '../core/search.js';
import { whenReady } from '../core/store.js';
import { DISTANCE, distanceText, parseDistance } from './registry.js';

/**
 * @typedef {{ title: string | null, plant: number | null, at: [number, number] | null, r: number | null, place: string | null, obs: string | null }} Live
 *   `at`: [lon, lat]; `r`: metres (null: not said — the layout's default)
 * @typedef {import('../core/nearby.js').NearbySpecies} NearbySpecies
 * @typedef {import('../core/nearby.js').AroundPoint} AroundPoint
 * @typedef {{ coordinates: [number, number], date: string | null, url: string }} Observation
 * @typedef {'push' | 'replace' | 'none'} How   how the address follows a change: a new entry, the same one, not at all
 */

/** The radius of a scope when neither the address nor a cell says one. */
export const DEFAULT_RADIUS = 2000;

/** @type {Live} */
export const EMPTY = Object.freeze({ title: null, plant: null, at: null, r: null, place: null, obs: null });

/** A title or a place as the address keeps it: plain text on one line, no control characters, 80 characters at most (shown as text, never as HTML). @param {string | null | undefined} text */
export const cleanText = text => String(text ?? '').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim() || null;

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
    title: cleanText(params.get('title')),
    plant: /^\d{1,9}$/.test(p) && Number(p) > 0 ? Number(p) : null,
    at: ok ? [at[1], at[0]] : null,
    r: parseDistance(params.get('r')),
    place: cleanText(params.get('place')),
    obs: /^[\w-]{1,40}$/.test(o) ? o : null
  };
}

/**
 * The query of an address for this state and this search: the title, the plant, the scope (its radius always said:
 * `radius` when the state has none), or a place still to find (with the radius said, if one is), the observation, then
 * the search's own words (core/query.js).
 * @param {Live} live @param {import('../core/store.js').Query} query @param {number} [radius] @returns {string}
 */
export function liveSearch(live, query, radius = DEFAULT_RADIUS) {
  const params = new URLSearchParams();
  if (live.title) params.set('title', live.title);
  if (live.plant) params.set('p', String(live.plant));
  if (live.at) {
    params.set('at', `${live.at[1].toFixed(5)},${live.at[0].toFixed(5)}`);
    params.set('r', distanceText(live.r ?? radius));
    if (live.place) params.set('place', live.place);
  } else if (live.place) {
    if (live.r != null) params.set('r', distanceText(live.r));
    params.set('place', live.place);
  }
  if (live.obs) params.set('o', live.obs);
  const own = params.toString().replace(/%2C/g, ',');
  const words = toHash(query).replace(/^#\/\??/, '');
  return [own, words].filter(Boolean).join('&');
}

/** The search an address' query says (core/query.js). @param {string} search */
export const readQuery = search => fromHash('#/?' + search);

/** Two states the same? @param {Live} a @param {Live} b */
export const sameLive = (a, b) => a.title === b.title && a.plant === b.plant && a.r === b.r && a.place === b.place && a.obs === b.obs
  && (a.at === b.at || (a.at !== null && b.at !== null && a.at[0] === b.at[0] && a.at[1] === b.at[1]));

/** The live state of a layout on screen, and what it loads for it. Fires `change` (detail: { how, keys }). */
export class LayoutState extends EventTarget {
  /**
   * @param {{ radius?: number | null, find?: typeof findPlace }} [defaults] the layout's own default radius (a map or a
   *   place cell's r=); `find`: how a place typed is found (the IGN geocoder; tests give their own)
   */
  constructor(defaults = {}) {
    super();
    /** @type {Live} */
    this.live = EMPTY;
    this.defaultRadius = defaults.radius ?? DEFAULT_RADIUS;
    this.find = defaults.find ?? findPlace;
    /** A place to find (place= without at=): being found, or why it was not (in French; null: none to find, or found). */
    /** @type {'idle' | 'finding' | 'failed'} */
    this.placeState = 'idle';
    /** @type {string | null} */
    this.placeError = null;
    /** The place being found (its words), and its request. */
    this.findFor = '';
    /** @type {AbortController | null} */ this.findAbort = null;
    /** The plants observed in the scope (null: no scope, or not yet), and whether they are coming or failed. */
    /** @type {{ key: string, list: NearbySpecies[], byPlant: Map<number, NearbySpecies>, plantOf: Map<number, number> } | null} */
    this.species = null;
    /** @type {'idle' | 'loading' | 'ready' | 'error'} */
    this.speciesState = 'idle';
    /** @type {string | null} */
    this.speciesError = null;
    /** Why they failed (the cells word it their own way: the deck has no cards without them). @type {'off' | 'offline' | 'unreachable' | null} */
    this.speciesFailure = null;
    /** The latest observations in the scope (the map), and how many there are in all. @type {AroundPoint[]} */
    this.points = [];
    this.pointsTotal = 0;
    /** @type {{ key: string, points: import('../core/nearby.js').AroundPoint[] } | null} the observations of the plants the search keeps (pointsOf) */
    this.subset = null;
    /** @type {string} */ this.subsetFor = '';
    /** @type {AbortController | null} */ this.subsetAbort = null;
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
    /** GBIF's occurrences in the scope (a map cell whose points include GBIF's: src=inat+gbif), and why they failed. */
    /** @type {{ key: string, points: import('../core/around3d.js').Obs3d[] } | null} */
    this.gbif = null;
    /** @type {string | null} */ this.gbifError = null;
    /** @type {string} */ this.gbifFor = '';
    /** @type {AbortController | null} */ this.gbifAbort = null;
    /** The map's own scope (its lieu=, its autour), applied once for each (dl-map), the address having none. */
    this.defaultedFor = '';
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

  /**
   * « Réessayer »: the scope's plants asked again, iNaturalist having failed. The failure the cache remembers a few
   * minutes (core/cache.js) is forgotten first, or it would only come back.
   */
  retryScope() {
    if (!this.live.at) return;
    forgetFailures('around');
    this.scopeFor = '';
    this.follow();
  }

  /** A changed state: its loads started (a place to find; the scope's, after a rest; the plant's names and observations). */
  follow() {
    const want = !this.live.at && this.live.place ? this.live.place : '';
    if (want !== this.findFor) {
      this.findFor = want;
      this.findAbort?.abort();
      this.findAbort = null;
      if (want) this.#findPlace(want);
      else if (this.placeState !== 'idle') { this.placeState = 'idle'; this.placeError = null; this.#changed(); }
    }
    const key = this.scopeKey;
    if (key !== this.scopeFor) {
      this.scopeFor = key;
      clearTimeout(this.timer);
      this.abort?.abort();
      this.abort = null;
      if (!key) {
        this.species = null; this.speciesState = 'idle'; this.speciesError = null; this.speciesFailure = null; this.points = []; this.pointsTotal = 0;
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

  /**
   * A place typed in the address (place= without at=): found, it is the scope, the address replaced (at=, the label
   * found; no new entry: Back does not come back to the words); not, the reason said and the address left as it is.
   * @param {string} text
   */
  async #findPlace(text) {
    const abort = this.findAbort = new AbortController();
    this.placeState = 'finding';
    this.placeError = null;
    this.#changed();
    /** @type {string} */
    let error;
    try {
      const found = await this.find(text, abort.signal);
      if (abort.signal.aborted || this.findFor !== text) return;
      if (found) {
        this.placeState = 'idle';
        this.findFor = '';
        this.findAbort = null;
        this.set({ at: found.coordinates, place: found.label, obs: null }, 'replace');
        return;
      }
      error = `Lieu introuvable : ${text}`;
    } catch (e) {
      if (abort.signal.aborted || this.findFor !== text) return;
      const kind = errorKind(e);
      error = kind === 'module-off' ? `Lieu non cherché : ${text} (le module « IGN – adresses et altitudes » est désactivé, Réglages › Modules)`
        : kind === 'offline' ? `Hors ligne : lieu non cherché (${text})`
        : `Lieu introuvable : ${text} (le géocodeur de l’IGN ne répond pas)`;
    }
    this.placeState = 'failed';
    this.placeError = error;
    this.#changed();
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
      this.speciesFailure = null;
      this.#rescope(list.map(s => /** @type {number} */ (s.plantId)));
    } catch (error) {
      if (abort.signal.aborted || key !== this.scopeKey) return;
      const e = /** @type {Error} */ (error);
      this.species = null;
      this.speciesState = 'error';
      this.speciesFailure = e.name === 'ModuleOffError' ? 'off' : navigator.onLine ? 'unreachable' : 'offline';
      this.speciesError = this.speciesFailure === 'off' ? 'Le module iNaturalist est désactivé (Réglages › Modules) : la zone ne filtre pas les plantes.'
        : this.speciesFailure === 'unreachable' ? 'iNaturalist ne répond pas : la zone ne filtre pas les plantes pour l’instant.' : 'Hors ligne : la zone ne filtre pas les plantes (iNaturalist est en ligne).';
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

  /**
   * The observations of these iNaturalist taxa only, in the scope (the map's, when the search keeps a few of the
   * plants of the scope: theirs are seldom among the most recent of all): loaded once for each set, `subset` then.
   * None (an empty list): no subset.
   * @param {number[]} taxa
   */
  pointsOf(taxa) {
    const at = this.live.at, r = this.radius;
    const key = at && taxa.length ? `${this.scopeKey}|${taxa.join(',')}` : '';
    if (key === this.subsetFor) return;
    this.subsetFor = key;
    this.subsetAbort?.abort();
    this.subsetAbort = null;
    if (!key || !at) { if (this.subset) { this.subset = null; this.#changed(); } return; }
    const abort = this.subsetAbort = new AbortController();
    observationPointsAround(at, r, abort.signal, taxa).then(found => {
      if (abort.signal.aborted || this.subsetFor !== key) return;
      this.subset = { key, points: found.points };
      this.#changed();
    }, () => {});
  }

  /**
   * GBIF's plant occurrences in the scope (core/around3d.js: iNaturalist's copy left out, each its plant's photo and
   * French name), for a map that shows them (`want`): loaded once for each scope, `gbif` then; failed, `gbifError`.
   * @param {boolean} want
   */
  gbifOf(want) {
    const at = this.live.at, r = this.radius;
    const key = want && at ? this.scopeKey : '';
    if (key === this.gbifFor) return;
    this.gbifFor = key;
    this.gbifAbort?.abort();
    this.gbifAbort = null;
    if (!key || !at) { if (this.gbif || this.gbifError) { this.gbif = null; this.gbifError = null; this.#changed(); } return; }
    const abort = this.gbifAbort = new AbortController();
    observations3d(at, r, { inat: false, gbif: true }, abort.signal).then(found => {
      if (abort.signal.aborted || this.gbifFor !== key) return;
      this.gbif = { key, points: found.points };
      this.gbifError = found.failed.length ? 'GBIF ne répond pas : ses occurrences manquent sur la carte.' : null;
      this.#changed();
    }, () => {});
  }

  /** The search kept to these plants (null: the whole flora), and run again. @param {number[] | null} ids */
  async #rescope(ids) {
    if (!ids && !this.scoped) return;
    this.scoped = Boolean(ids);
    setSearchScope(ids);
    await whenReady();
    runSearch();
  }

  /**
   * The current plant: its names (the cells' heads), its observations in the scope (the map). Its names are read once
   * the flora is in the database: on a first visit the layout is drawn while it downloads, and a plant read then (?p=
   * in the address) would be none — its heads empty for good, since the same plant is never read twice.
   */
  async #loadPlant() {
    const id = this.live.plant;
    if (id && this.infoFor !== id) {
      this.infoFor = id;
      await whenReady();
      const plant = this.live.plant === id ? await db.get('plants', id).catch(() => null) : null;
      if (this.live.plant !== id) return;
      this.plantInfo = plant ? { id, name: plant.vernacularNames?.[0] || plant.scientificName, sci: plant.scientificName } : null;
      this.#changed();
    } else if (!id) {
      // None now (Back) while one was still being read: chosen again, it is read again.
      this.infoFor = 0;
      if (this.plantInfo) { this.plantInfo = null; this.#changed(); }
    }
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
    this.findAbort?.abort();
    this.gbifAbort?.abort();
    if (this.scoped) { this.scoped = false; setSearchScope(null); whenReady().then(() => runSearch()); }
  }
}
