// @ts-check
// The live state a free layout's cells share (« Disposition libre », gf-layout.js): one small store, an EventTarget,
// that every cell reads and writes — never one cell to another. What it holds, and the address beside the layout:
//   ?title=<words>                     the screen's own title (its heading, the page's title, the share's): plain
//                                      text, 80 characters at most, written first;
//   &p=<plant>                         the current plant: every plant cell (plant, plant.<block>, media) shows it, the
//                                      results and the deck light it, the map lights its observations in the scope;
//   &at=<lat>,<lon>&r=<500m|2km>&place=<name>   the scope: a circle; its observations (iNaturalist's latest, of the
//                                      period: the map's points) and their plants (matched to the flora: core/nearby.js),
//                                      which keep the search to them (core/search.js#setSearchScope) — the list is the
//                                      map's plants, the map those of the list;
//   &place=<words> without at=         a place to find: the IGN geocoder asked (core/geoservices.js#findPlace:
//                                      « mirabel, menetrol, 63 »), the scope set there and the address replaced by its
//                                      at= and the label found (r= kept, else the layout's); not found, offline or the
//                                      module off: no scope, the reason said where the scope is (cells.js#scopeWords),
//                                      place= left in the address so that a reload asks again;
//   &o=<observation>                   an observation lit on the map (a point touched);
//   &periode=<toujours|annee|mois>     the period every cell shows: the plants observed in the zone that year, or that
//                                      month of any year (what flowers now) — the results, the deck, the maps' points
//                                      (core/nearby.js periodQuery); not said, the layout's own (a map's when=);
//   &sources=inat,gbif&qualite=…&taxon=espece&photos=avec|libre&sauvages=1&jeux=…&sansjeux=<GBIF datasets>
//                                      the zone's observations: their sources and the filters every source applies
//                                      (core/observations.js); not said, the defaults — the sources a map says (src=),
//                                      else both, every observation (every quality, every dataset);
//   &q=…&family=…&sort=…               the search itself: Flore's (core/query.js — the same words as #/?q=…), kept in the
//                                      store, so the search cell is Flore's own bar, filters and list.
// A layout's other groups (a cell's groupe=b: its own zone, plant, period and search, apart from the others) have
// the same keys after their letter: &b.p=…&b.at=…&b.r=…&b.q=…&b.family=… (the first group, a, none: its links as before).
// A link with them gives the same screen; Back and Forward walk the plants and places chosen (a new entry each), while
// typing, a filter or the radius only replace the address (as Flore's search does).
//
// What it loads for the scope (the circle's latest observations — their plants the list —, the current plant's own
// observations there) is asked once the circle rests (250 ms), the request before cancelled, a late answer for another
// circle dropped. Pure functions (readLive, liveSearch) are tested under Node; the class needs the app.

import { getPlant, nameOf } from '../core/plants.js';
import { forgetFailures } from '../core/cache.js';
import { findPlace } from '../core/geoservices.js';
import { errorKind } from '../core/net.js';
import { observationsAround, plantCounts, plantsIn, speciesOf, taxonIdOf } from '../core/nearby.js';
import { boxHolds, circleBox } from '../core/around3d.js';
import { OBS_DEFAULTS, SOURCE_NAMES, failedText, inatQuery, obsKey, obsParams, readObsFilters, sourcesText, zoneObservations } from '../core/observations.js';
import { fromHash, toHash } from '../core/query.js';
import { searchWhole } from '../core/search.js';
import { APP } from '../core/search-channel.js';
import { whenReady } from '../core/store.js';
import { DISTANCE, distanceText, parseDistance } from './registry.js';

/**
 * @typedef {import('../core/observations.js').ObsFilters} ObsFilters
 * @typedef {{ title: string | null, plant: number | null, at: [number, number] | null, r: number | null, place: string | null, obs: string | null, periode: Period | null, filtres: Readonly<Partial<ObsFilters>> | null }} Live
 *   `at`: [lon, lat]; `r`: metres (null: not said — the layout's default); `periode`: null, not said — the layout's own;
 *   `filtres`: the zone's observations' sources and filters said (the others the layout's defaults)
 * @typedef {'toujours' | 'annee' | 'mois'} Period
 * @typedef {import('../core/nearby.js').NearbySpecies} NearbySpecies
 * @typedef {import('../core/nearby.js').AroundPoint} AroundPoint
 * @typedef {{ coordinates: [number, number], date: string | null, url: string }} Observation
 * @typedef {'push' | 'replace' | 'none'} How   how the address follows a change: a new entry, the same one, not at all
 */

/** The radius of a scope when neither the address nor a cell says one. */
export const DEFAULT_RADIUS = 2000;

/** The zone's observations a layout loads (the most recent of the period): its map's points, whose plants make its list. */
const ZONE_MAX = 1000;

/** @type {Live} */
export const EMPTY = Object.freeze({ title: null, plant: null, at: null, r: null, place: null, obs: null, periode: null, filtres: null });

/** The periods, in their order. @type {Period[]} */
export const PERIODS = ['toujours', 'annee', 'mois'];

/** A title or a place as the address keeps it: plain text on one line, no control characters, 80 characters at most (shown as text, never as HTML). @param {string | null | undefined} text */
export const cleanText = text => String(text ?? '').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim() || null;

/** An observation's id in the address: the end of its iNaturalist address. @param {string} url */
export const obsId = url => /(\d+)\/?$/.exec(url)?.[1] ?? url;

/**
 * The keys of an address' query that start with a group's letter (« b. »), without it; none: as it is (the first
 * group's). @param {string} search @param {string} [prefix] @returns {URLSearchParams}
 */
export function groupParams(search, prefix = '') {
  const all = new URLSearchParams(search);
  if (!prefix) return all;
  const own = new URLSearchParams();
  for (const [k, v] of all) if (k.startsWith(prefix)) own.append(k.slice(prefix.length), v);
  return own;
}

/** A group's letter as its keys start in the address: '' for the first one (a), « b. » for b. @param {string} group */
export const groupPrefix = group => !group || group === 'a' ? '' : group + '.';

/**
 * The live state of an address' query (after « ? »): what is wrong or missing is left out — a group's (its keys
 * after its letter, `prefix`: « b. »), its title the first group's only.
 * @param {string} search @param {string} [prefix] @returns {Live}
 */
export function readLive(search, prefix = '') {
  const params = groupParams(search, prefix);
  const p = params.get('p') || '';
  const at = (params.get('at') || '').split(',').map(Number);
  const ok = at.length === 2 && at.every(Number.isFinite) && Math.abs(at[0]) <= 90 && Math.abs(at[1]) <= 180;
  const o = params.get('o') || '';
  const per = /** @type {Period} */ (params.get('periode') || '');
  return {
    title: prefix ? null : cleanText(params.get('title')),
    plant: /^\d{1,9}$/.test(p) && Number(p) > 0 ? Number(p) : null,
    at: ok ? [at[1], at[0]] : null,
    r: parseDistance(params.get('r')),
    place: cleanText(params.get('place')),
    obs: /^[\w-]{1,40}$/.test(o) ? o : null,
    periode: PERIODS.includes(per) ? per : null,
    filtres: readObsFilters(params)
  };
}

/**
 * The query of an address for this state and this search: the title, the plant, the scope (its radius always said:
 * `radius` when the state has none), or a place still to find (with the radius said, if one is), the observation, then
 * the search's own words (core/query.js) — a group's, each key after its letter (`prefix`: « b. »).
 * @param {Live} live @param {import('../core/store.js').Query} query @param {number} [radius] @param {string} [prefix] @returns {string}
 */
export function liveSearch(live, query, radius = DEFAULT_RADIUS, prefix = '') {
  const text = ownSearch(live, query, radius);
  if (!prefix || !text) return text;
  return text.split('&').map(kv => prefix + kv).join('&');
}

/** @param {Live} live @param {import('../core/store.js').Query} query @param {number} radius @returns {string} */
function ownSearch(live, query, radius) {
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
  if (live.periode) params.set('periode', live.periode);
  for (const [k, v] of obsParams(live.filtres)) params.set(k, v);
  const own = params.toString().replace(/%2C/g, ',');
  const words = toHash(query).replace(/^#\/\??/, '');
  return [own, words].filter(Boolean).join('&');
}

/** The search an address' query says (core/query.js) — a group's (its keys after its letter, `prefix`). @param {string} search @param {string} [prefix] */
export const readQuery = (search, prefix = '') => fromHash('#/?' + (prefix ? groupParams(search, prefix).toString() : search));

/** Two states the same? @param {Live} a @param {Live} b */
export const sameLive = (a, b) => a.title === b.title && a.plant === b.plant && a.r === b.r && a.place === b.place && a.obs === b.obs && a.periode === b.periode
  && obsKey(a.filtres) === obsKey(b.filtres) && (a.at === b.at || (a.at !== null && b.at !== null && a.at[0] === b.at[0] && a.at[1] === b.at[1]));

/** The live state of a layout on screen, and what it loads for it. Fires `change` (detail: { how, keys }), and `hover` when the plant hovered changes. */
export class LayoutState extends EventTarget {
  /**
   * @param {{ radius?: number | null, find?: typeof findPlace, channel?: import('../core/search-channel.js').Channel }} [defaults] the
   *   layout's own default radius (a map or a place cell's r=); `find`: how a place typed is found (the IGN geocoder;
   *   tests give their own); `channel`: the search its zone keeps to its plants (core/search-channel.js; the app's)
   */
  constructor(defaults = {}) {
    super();
    this.channel = defaults.channel ?? APP;
    /** @type {Live} */
    this.live = EMPTY;
    this.defaultRadius = defaults.radius ?? DEFAULT_RADIUS;
    /** The layout's own period (a map's when=), until the address says one. @type {Period} */
    this.defaultPeriode = 'toujours';
    /** The layout's own sources of observations (its maps' src=), until the address says them. @type {ObsFilters['sources']} */
    this.defaultSources = OBS_DEFAULTS.sources;
    this.find = defaults.find ?? findPlace;
    /** A place to find (place= without at=): being found, or why it was not (in French; null: none to find, or found). */
    /** @type {'idle' | 'finding' | 'failed'} */
    this.placeState = 'idle';
    /** @type {string | null} */
    this.placeError = null;
    /** The place being found (its words), and its request. */
    this.findFor = '';
    /** @type {AbortController | null} */ this.findAbort = null;
    /** The plants of the scope's observations, the flora's (null: no scope, or not yet), and whether they are coming or failed. */
    /** `plantOf`: each record's plant, by its taxon and its name (core/nearby.js plantOfPoint). */
    /** @type {{ key: string, list: NearbySpecies[], byPlant: Map<number, NearbySpecies>, plantOf: Map<string, number> } | null} */
    this.species = null;
    /** @type {'idle' | 'loading' | 'ready' | 'error'} */
    this.speciesState = 'idle';
    /** @type {string | null} */
    this.speciesError = null;
    /** Why they failed (the cells word it their own way: the deck has no cards without them). @type {'off' | 'offline' | 'unreachable' | null} */
    this.speciesFailure = null;
    /**
     * The scope's observations (the map's points: the latest of the period, from the sources the filters keep, merged:
     * core/observations.js), how many there are in all, each source's count, the sources that failed, GBIF's datasets
     * in the zone (counted). @type {import('../core/observations.js').Obs[]}
     */
    this.points = [];
    this.pointsTotal = 0;
    /** @type {{ inat: number | null, gbif: number | null }} */ this.totals = { inat: null, gbif: null };
    /**
     * Each plant's observations in the zone, its sources apart (the list's rows: core/observations.js obsNotes), and the
     * sources that answered; null: no zone, or not yet. @type {{ counts: Map<number, { inat: number, gbif: number }>, sources: import('../core/observations.js').ObsSource[] } | null}
     */
    this.obsCounts = null;
    /** @type {import('../core/observations.js').ObsFailure[]} */ this.failed = [];
    /** @type {{ key: string, count: number }[]} */ this.datasets = [];
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
    /** The map's own scope (its lieu=, its autour), applied once for each (dl-map), the address having none. */
    this.defaultedFor = '';
    /** The search over the whole flora (wholeOf: a results cell with zone=0), and the search it answers. */
    /** @type {{ key: string, total: number, items: any[] } | null} */
    this.whole = null;
    /** @type {string} */ this.wholeFor = '';
    /**
     * The plant hovered — a list's row (under the mouse, or the keyboard's focus), a map's point (under the mouse) —,
     * lit by the other cells; null: none. Never in the address. @type {{ plant: number, from: 'list' | 'map' } | null}
     */
    this.hover = null;
    /**
     * What a map shows of the zone (moved by hand: its box [west, south, east, north], the sources of its points, the
     * map), the list kept to it; null: the whole zone (a map that shows all of the circle too). Never in the address.
     * @type {{ box: number[], kinds: string[] | null, by: object | null } | null}
     */
    this.view = null;
    /** The plants observed in that view (the search kept to them: workers/search-core.js within); null: the zone's all. @type {number[] | null} */
    this.within = null;
  }

  /** The radius in use: the address', else the layout's default. */
  get radius() { return this.live.r ?? this.defaultRadius; }

  /** The period every cell shows: the address', else the layout's own. @returns {Period} */
  get periode() { return this.live.periode ?? this.defaultPeriode; }

  /** The zone's observations' sources and filters: the address', else the layout's (core/observations.js). @returns {Readonly<ObsFilters>} */
  get filters() {
    const key = obsKey(this.live.filtres) + '|' + this.defaultSources.join();
    if (this.#filtersFor !== key) {
      this.#filtersFor = key;
      this.#filters = Object.freeze({ ...OBS_DEFAULTS, sources: this.defaultSources, ...(this.live.filtres ?? {}) });
    }
    return this.#filters;
  }
  #filtersFor = '';
  /** @type {Readonly<ObsFilters>} */ #filters = OBS_DEFAULTS;
  /** The zone (radius, centre, period) GBIF's datasets were counted in. */
  #datasetsZone = '';
  /** Each plant's observations in the zone, by id (the search's sort « Plus observées »); null: none. @type {Record<number, number> | null} */
  #observed = null;
  /** The circle a view was taken in (its radius and centre; '' without a zone). */
  #circle = '';

  /** The scope's key ('' without one): its circle, its period, its observations' sources and filters. */
  get scopeKey() { return this.live.at ? this.radius + ':' + this.live.at.join(',') + ':' + this.periode + ':' + obsKey(this.filters) : ''; }

  /**
   * A change: the address follows as `how` says (gf-layout.js listens), and what it needs is loaded.
   * @param {Partial<Live>} patch @param {How} [how] @returns {boolean} whether anything changed
   */
  set(patch, how = 'replace') {
    const next = { ...this.live, ...patch };
    if (next.r != null) next.r = Math.min(DISTANCE.max, Math.max(DISTANCE.min, next.r));
    const keys = /** @type {(keyof Live)[]} */ (Object.keys(patch)).filter(k => k === 'at' ? !sameLive({ ...EMPTY, at: next.at }, { ...EMPTY, at: this.live.at })
      : k === 'filtres' ? obsKey(next.filtres) !== obsKey(this.live.filtres) : next[k] !== this.live[k]);
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
   * A plant hovered (a list's row, a map's point): the other cells light it. Its own event, `hover` — never `change`:
   * nothing written in the address, only the cells that light it drawn again. @param {number} plant @param {'list' | 'map'} from
   */
  hoverOn(plant, from) {
    if (this.hover?.plant === plant && this.hover.from === from) return;
    this.hover = { plant, from };
    this.dispatchEvent(new CustomEvent('hover'));
  }

  /**
   * Hovered no more: `plant` (null: whichever `from` lit) — another plant hovered meanwhile, or from elsewhere, stays.
   * @param {number | null} plant @param {'list' | 'map'} from
   */
  hoverOff(plant, from) {
    const h = this.hover;
    if (!h || h.from !== from || (plant != null && h.plant !== plant)) return;
    this.hover = null;
    this.dispatchEvent(new CustomEvent('hover'));
  }

  /**
   * What a map shows of the zone (`box` [west, south, east, north]; null: let go), the sources of its points
   * (`kinds`), the map (`by`): the list kept to the plants observed there — the whole zone when it shows all of the
   * circle. The search runs again only when those plants change.
   * @param {number[] | null} box @param {{ kinds?: string[] | null, by?: object | null }} [o]
   */
  setView(box, { kinds = null, by = null } = {}) {
    const at = this.live.at;
    const view = box && at && !boxHolds(box, circleBox(at, this.radius)) ? { box, kinds, by } : null;
    if (!view && !this.view) return;
    this.view = view;
    this.#narrow();
  }

  /** « Toute la zone »: the list back to the whole zone, and the map that led it framed on it again (`refit`, detail: { by }). */
  wholeZone() {
    const by = this.view?.by ?? null;
    this.setView(null);
    this.dispatchEvent(new CustomEvent('refit', { detail: { by } }));
  }

  /** The plants of the view, now (none without one, or before the zone's plants are known). @returns {number[] | null} */
  #withinNow() {
    const v = this.view, s = this.species;
    return v && s ? plantsIn(this.points, s.plantOf, v.box, v.kinds) : null;
  }

  /**
   * The list kept to the view's plants: the search run again when they changed, the cells told. The zone's points
   * still coming (another period, other filters): found among them once there (#loadScope).
   */
  #narrow() {
    if (this.speciesState === 'loading') return;
    const within = this.#withinNow();
    if (String(within) === String(this.within)) return;
    this.within = within;
    if (this.species) this.#rescope(this.species.list.map(s => /** @type {number} */ (s.plantId)));
    this.#changed();
  }

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
    // Another circle: a view of the old one is let go (the list the whole of the new zone); another period, other
    // filters keep it (its plants found again among the new points).
    const circle = this.live.at ? this.radius + ':' + this.live.at.join(',') : '';
    if (circle !== this.#circle) { this.#circle = circle; this.view = null; this.within = null; }
    const key = this.scopeKey;
    if (key !== this.scopeFor) {
      this.scopeFor = key;
      clearTimeout(this.timer);
      this.abort?.abort();
      this.abort = null;
      // Another zone: what was loaded for the old one goes at once (never its points under the new circle) — GBIF's
      // datasets kept while only the filters changed (counted as if none were chosen: one being ticked stays in view).
      this.points = []; this.pointsTotal = 0; this.totals = { inat: null, gbif: null }; this.failed = []; this.obsCounts = null; this.#observed = null;
      const zone = key.split(':').slice(0, 3).join(':');
      if (zone !== this.#datasetsZone) { this.datasets = []; this.#datasetsZone = zone; }
      if (!key) {
        this.species = null; this.speciesState = 'idle'; this.speciesError = null; this.speciesFailure = null;
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

  /**
   * The scope's observations (the latest of the period, from the sources the filters keep, merged: the map's points)
   * and their plants (the list: the search kept to them). @param {string} key
   */
  async #loadScope(key) {
    const at = /** @type {[number, number]} */ (this.live.at), r = this.radius;
    const abort = this.abort = new AbortController();
    // The flora in the database first: iNaturalist's names are matched to it (core/nearby.js reads it once).
    await whenReady();
    if (abort.signal.aborted || key !== this.scopeKey) return;
    try {
      const found = await zoneObservations(at, r, { filters: this.filters, periode: this.periode, max: ZONE_MAX, signal: abort.signal });
      const plants = await speciesOf(found.points);
      if (abort.signal.aborted || key !== this.scopeKey) return;
      const list = plants.list.filter(s => s.plantId);
      this.points = found.points;
      this.pointsTotal = (found.totals.inat ?? 0) + (found.totals.gbif ?? 0);
      this.totals = found.totals;
      this.failed = found.failed;
      this.datasets = found.datasets;
      this.species = { key, list, byPlant: new Map(list.map(s => [/** @type {number} */ (s.plantId), s])), plantOf: plants.plantOf };
      const counts = plantCounts(found.points, plants.plantOf);
      this.obsCounts = { counts, sources: this.filters.sources.filter(x => !found.failed.some(f => f.name === SOURCE_NAMES[x])) };
      // The search's sort « Plus observées » (workers/search-core.js `observed`): each plant's total, cloned to the worker.
      this.#observed = Object.fromEntries([...counts].map(([id, c]) => [id, c.inat + c.gbif]));
      // A map's view kept (another period, other filters): its plants among the new points.
      this.within = this.#withinNow();
      this.speciesState = 'ready';
      this.speciesError = null;
      this.speciesFailure = null;
      this.#rescope(list.map(s => /** @type {number} */ (s.plantId)));
    } catch (error) {
      if (abort.signal.aborted || key !== this.scopeKey) return;
      // Each source's failure (core/observations.js ObsError); else every source asked, not answering.
      const sources = this.filters.sources;
      const said = /** @type {{ failed?: import('../core/observations.js').ObsFailure[] }} */ (error).failed;
      const failed = said?.length ? said : sources.map(x => ({ name: SOURCE_NAMES[x], off: false }));
      this.points = []; this.pointsTotal = 0; this.totals = { inat: null, gbif: null }; this.failed = failed; this.datasets = []; this.obsCounts = null; this.#observed = null;
      this.species = null;
      this.within = null;
      this.speciesState = 'error';
      this.speciesFailure = failed.every(f => f.off) ? 'off' : navigator.onLine ? 'unreachable' : 'offline';
      this.speciesError = this.speciesFailure === 'off' ? `${failedText(failed)} (Réglages › Modules) : la zone ne filtre pas les plantes.`
        : this.speciesFailure === 'unreachable' ? `${failedText(failed)} : la zone ne filtre pas les plantes pour l’instant.`
        : `Hors ligne : la zone ne filtre pas les plantes (${sourcesText(sources)} ${sources.length > 1 ? 'sont' : 'est'} en ligne).`;
      this.#rescope(null);
    }
    this.#changed();
    this.#loadPlant();
  }

  /**
   * The search on screen over the whole flora, whatever the zone (a results cell that leaves it: results(zone=0)), for
   * a layout that has one (`want`): loaded once for each search (its text, filters, sort), `whole` then.
   * @param {boolean} want
   */
  wholeOf(want) {
    const query = this.channel.query;
    const key = want ? 'q:' + toHash(query) : '';
    if (key === this.wholeFor) return;
    this.wholeFor = key;
    if (!key) { if (this.whole) { this.whole = null; queueMicrotask(() => this.#changed()); } return; }
    whenReady().then(() => this.wholeFor === key ? searchWhole(query) : null).then(found => {
      if (!found || this.wholeFor !== key) return;
      this.whole = { key, total: found.total, items: found.items };
      this.#changed();
    }, () => {});
  }

  /** The search kept to these plants (null: the whole flora) — and to a map's view of them —, and run again. @param {number[] | null} ids */
  async #rescope(ids) {
    if (!ids && !this.scoped) return;
    this.scoped = Boolean(ids);
    this.channel.setScope(ids, { observed: ids ? this.#observed : null, within: ids ? this.within : null });
    await whenReady();
    this.channel.run();
  }

  /**
   * The current plant: its names (the cells' heads), its observations in the scope (the map: iNaturalist's, as the
   * zone's filters say — the same grades as its points, inatQuery). Its names are read once
   * the flora is in the database: on a first visit the layout is drawn while it downloads, and a plant read then (?p=
   * in the address) would be none — its heads empty for good, since the same plant is never read twice.
   */
  async #loadPlant() {
    const id = this.live.plant;
    if (id && this.infoFor !== id) {
      this.infoFor = id;
      await whenReady();
      const plant = this.live.plant === id ? await getPlant(id) : null;
      if (this.live.plant !== id) return;
      this.plantInfo = plant ? { id, name: nameOf(plant), sci: plant.scientificName } : null;
      this.#changed();
    } else if (!id) {
      // None now (Back) while one was still being read: chosen again, it is read again.
      this.infoFor = 0;
      if (this.plantInfo) { this.plantInfo = null; this.#changed(); }
    }
    const s = this.species;
    const key = id && s ? id + '@' + s.key : '';
    if (key === this.obsFor) return;
    this.obsFor = key;
    if (!key || !this.live.at) { if (this.plantObs) { this.plantObs = null; this.#changed(); } return; }
    // A plant not among the zone's (chosen elsewhere: the whole flora's results, a fixed plant): its taxon found by its
    // name — its observations in the zone, if any, shown all the same (never an empty map without a word).
    const taxon = s?.byPlant.get(id)?.taxonId ?? (this.plantInfo?.id === id ? await taxonIdOf(this.plantInfo.sci).catch(() => null) : null);
    if (this.obsFor !== key) return;
    if (!taxon) { this.plantObs = { key, points: [] }; this.#changed(); return; }
    const pts = await observationsAround(taxon, /** @type {[number, number]} */ (this.live.at), this.radius, undefined, inatQuery(this.filters)).catch(() => []);
    if (this.obsFor !== key) return;
    this.plantObs = { key, points: pts };
    this.#changed();
  }

  /** The layout gone: its loads stopped, nothing hovered, the search back to the whole flora. */
  dispose() {
    this.hover = null;
    clearTimeout(this.timer);
    this.abort?.abort();
    this.findAbort?.abort();
    if (this.scoped) { this.scoped = false; this.channel.setScope(null); whenReady().then(() => this.channel.run()); }
  }
}
