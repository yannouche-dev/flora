// @ts-check
// The live state a free layout's cells share (« Écran sur mesure », gf-layout.js): one small store, an EventTarget,
// that every cell reads and writes — never one cell to another. What it holds, and the address beside the layout:
//   ?title=<words>                     the screen's own title (its heading, the page's title, the share's): plain
//                                      text, 80 characters at most, written first;
//   &p=<plant>                         the current plant: every plant cell (plant, plant.<block>, media) shows it, the
//                                      results and the deck light it, the map lights its observations in the scope;
//   &at=<lat>,<lon>&r=<500m|2km>&place=<name>   the scope: a circle; its observations (iNaturalist's latest, of the
//                                      period: the map's points) and their plants (matched to the flora: core/nearby.js),
//                                      which keep its search to them (its channel's setScope: core/search-channel.js)
//                                      — the list is the map's plants, the map those of the list;
//   &place=<words> without at=         a place to find: the IGN geocoder asked (core/geoservices.js#findPlace:
//                                      « mirabel, menetrol, 63 »), the scope set there and the address replaced by its
//                                      at= and the label found (r= kept, else the layout's); not found, offline or the
//                                      module off: no scope, the reason said where the scope is (cell-kit.js#scopeWords),
//                                      place= left in the address so that a reload asks again;
//   &o=<observation>                   an observation lit on the map (a point touched);
//   &periode=<toujours|annee|mois>     the period every cell shows: the plants observed in the zone that year, or that
//                                      month of any year (what flowers now) — the results, the deck, the maps' points
//                                      (core/nearby.js periodQuery); not said, the layout's own (a map's when=);
//   &sources=inat,gbif&qualite=…&taxon=espece&photos=avec|libre&sauvages=1&jeux=…&sansjeux=<GBIF datasets>
//                                      the zone's observations: their sources and the filters every source applies
//                                      (core/observations.js); not said, the defaults — both sources (but one switched
//                                      off in Réglages › Modules: defaultSources; a map's src= is its own, never the
//                                      group's: cells.js), every observation (every quality, every dataset);
//   &q=…&family=…&sort=…               the search itself: the screen's own (core/query.js — the same words as #/?q=…),
//                                      never Flore's.
// A layout's other groups (a cell's groupe=b: its own zone, plant, period and search, apart from the others) have
// the same keys after their letter: &b.p=…&b.at=…&b.r=…&b.q=…&b.family=… (the first group, a, none: its links as before).
// A link with them gives the same screen; Back and Forward walk the plants and places chosen (a new entry each), while
// typing, a filter or the radius only replace the address (as Flore's search does).
//
// What it loads for the scope (the circle's latest observations — their plants the list —, the current plant's own
// observations there) is asked once the circle rests (250 ms), the request before cancelled, a late answer for another
// circle dropped. One answer, one publication: the zone's points, its plants, their counts and its search's answer are
// computed first, then given together in one task — the cells (map, list, deck, counts) drawn once, never one before
// the others; meanwhile what was shown stays, dimmed (`updating`: « Mise à jour… »), but a new circle's map never shows
// the old one's points. Pure functions (readLive, liveSearch) are tested under Node; the class needs the app.

import { getPlant, nameOf } from '../core/plants.js';
import { forgetFailures } from '../core/cache.js';
import { findPlace } from '../core/geoservices.js';
import { errorKind } from '../core/net.js';
import { AROUND_MAX, observationsAround, plantCounts, plantOfPoint, plantsIn, speciesOf, taxonIdOf } from '../core/nearby.js';
import { GBIF_MAX, boxHolds, circleBox } from '../core/around3d.js';
import { OBS_DEFAULTS, SOURCE_NAMES, defaultSources, failedText, inatQuery, obsKey, obsParams, readObsFilters, sourcesText, zoneObservations } from '../core/observations.js';
import { fromHash, toHash } from '../core/query.js';
import { searchWhole } from '../core/search.js';
import { SearchChannel } from '../core/search-channel.js';
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
 * @typedef {{ coordinates: [number, number], date: string | null, url: string | null, kind: string }} Observation  `kind`:
 *   its source (core/observations.js: 'inat', 'gbif')
 * @typedef {{ key: string, points: Observation[], outside: boolean, capped?: boolean }} PlantObs  the current plant's observations in the
 *   zone (`key`: its id and the scope they are of); `outside`: a plant not among the zone's — iNaturalist's alone, asked
 *   (`capped`: as many as it gives at most, core/nearby.js AROUND_MAX — the most recent)
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
   * @param {{ radius?: number | null, find?: typeof findPlace, channel?: SearchChannel }} [defaults] the
   *   group's own default radius (a map or a zone cell's r=: group-defaults.js); `find`: how a place typed is found (the IGN geocoder;
   *   tests give their own); `channel`: the search its zone keeps to its plants (core/search-channel.js; none: one of
   *   its own — never Flore's)
   */
  constructor(defaults = {}) {
    super();
    this.channel = defaults.channel ?? new SearchChannel();
    /** @type {Live} */
    this.live = EMPTY;
    this.defaultRadius = defaults.radius ?? DEFAULT_RADIUS;
    /** The group's own period (a map's when=: group-defaults.js), until the address says one. @type {Period} */
    this.defaultPeriode = 'toujours';
    /**
     * The group's own sources of observations — both, but one whose module is off (core/observations.js
     * defaultSources) —, until the address says them: never a map's (its src= is its own: what it draws among
     * them). @type {ObsFilters['sources']}
     */
    this.defaultSources = defaultSources();
    /**
     * The place the group starts on (its first map's lieu=: 'lieu:<words>', else its « Autour de moi au départ »:
     * 'autour'; null: none — group-defaults.js), applied once (applyOnce), the address having no zone.
     * @type {string | null}
     */
    this.defaultStart = null;
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
    /**
     * The current plant's own observations in the scope (the maps' big points): a plant of the zone's, its own among
     * the zone's points; another, iNaturalist's (#plantObs). @type {PlantObs | null}
     */
    this.plantObs = null;
    /** Their request (a plant outside the zone's), cancelled by the next change. @type {AbortController | null} */
    this.plantAbort = null;
    /**
     * What the cells show is the zone's last answer, a new one coming (another period, other filters, another circle,
     * none): dimmed, « Mise à jour… », until it replaces all of it at once (#loadScope).
     */
    this.updating = false;
    /** The current plant's names (the cells' heads). @type {{ id: number, name: string, sci: string } | null} */
    this.plantInfo = null;
    /** Its search is kept to the scope's plants (its channel's setScope): taken off when the layout goes. */
    this.scoped = false;
    /** @type {AbortController | null} */ this.abort = null;
    /** @type {any} */ this.timer = 0;
    this.scopeFor = '';
    this.obsFor = '';
    this.infoFor = 0;
    /**
     * The starting places already applied (or not, the address having a zone then): each once (applyOnce) — a zone
     * taken off (✕) stays off, whichever map of the group draws again.
     * @type {Set<string>}
     */
    this.applied = new Set();
    /** The search over the whole flora (wholeOf: a results cell with zone=0), and the search it answers. */
    /** @type {{ key: string, total: number, items: any[] } | null} */
    this.whole = null;
    /** @type {string} */ this.wholeFor = '';
    /**
     * The plant hovered — a list's row (under the mouse, or the keyboard's focus), a map's point (under the mouse) —,
     * lit by the other cells (`by`: the map hovered, which lights it itself; null: a list's); null: none. Never in the
     * address. @type {{ plant: number, from: 'list' | 'map', by: object | null } | null}
     */
    this.hover = null;
    /**
     * What a map shows of the zone (moved by hand: its box [west, south, east, north], the sources of its points, the
     * map), the list kept to it; null: the whole zone (a map that shows all of the circle too). In the address as the
     * leading map's vue= (cells.js; replaced, never a new entry).
     * @type {{ box: number[], kinds: string[] | null, by: object | null } | null}
     */
    this.view = null;
    /** The plants observed in that view (the search kept to them: workers/search-core.js within); null: the zone's all. @type {number[] | null} */
    this.within = null;
  }

  /**
   * A starting place (defaultStart) comes: true the first time only — every map of the group asks, one applies it.
   * @param {string | null} want
   */
  applyOnce(want) {
    if (!want || this.applied.has(want)) return false;
    this.applied.add(want);
    return true;
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

  /**
   * The zone's observations loaded, when a source has more, each apart (core/observations.js): iNaturalist's past
   * ZONE_MAX — its most recent —, GBIF's past its page of GBIF_MAX — one page, asked in no order —: how many of its
   * points are shown, of how many it counts (null: all of them); null: every source's all (cell-kit.js scopeNote says it).
   * @returns {{ inat: { shown: number, total: number } | null, gbif: { shown: number, total: number } | null } | null}
   */
  get sample() {
    const t = this.totals;
    const part = (/** @type {'inat' | 'gbif'} */ kind, /** @type {number} */ max) => (t[kind] ?? 0) > max
      ? { shown: this.points.filter(p => p.kind === kind).length, total: /** @type {number} */ (t[kind]) } : null;
    const inat = part('inat', ZONE_MAX), gbif = part('gbif', GBIF_MAX);
    return inat || gbif ? { inat, gbif } : null;
  }

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
   * A plant hovered (a list's row, a map's point): the other cells light it — every list, and every map but the one
   * hovered (`by`), which lights it itself. Its own event, `hover` — never `change`: nothing written in the address,
   * only the cells that light it drawn again. @param {number} plant @param {'list' | 'map'} from @param {object | null} [by]
   */
  hoverOn(plant, from, by = null) {
    if (this.hover?.plant === plant && this.hover.from === from && this.hover.by === by) return;
    this.hover = { plant, from, by };
    this.dispatchEvent(new CustomEvent('hover'));
  }

  /**
   * Hovered no more: `plant` (null: whichever `from` lit — the map `by`, when said) — another plant hovered meanwhile,
   * or from elsewhere (another map), stays. @param {number | null} plant @param {'list' | 'map'} from @param {object | null} [by]
   */
  hoverOff(plant, from, by = null) {
    const h = this.hover;
    if (!h || h.from !== from || (plant != null && h.plant !== plant) || (by !== null && h.by !== by)) return;
    this.hover = null;
    this.dispatchEvent(new CustomEvent('hover'));
  }

  /**
   * The current plant is a choice, never a filter: chosen, it stays chosen when its group's search no longer finds it
   * (another text, other filters, another zone) — said « hors du résultat » (the map's chip, the plant cells' heads).
   * Not before the search has answered; the zone's plants (inZone), not only what a map's view keeps — nor when the
   * group's search over the whole flora (a results(zone=0) cell: wholeOf) lists it, the rows shown.
   */
  get outside() {
    const id = this.live.plant, ch = this.channel;
    if (id == null || !ch.answered) return false;
    if (this.whole?.items.some((/** @type {{ id: number }} */ p) => p.id === id)) return false;
    const results = ch.results;
    return results.inZone ? !results.inZone.includes(id) : !results.items.some((/** @type {{ id: number }} */ p) => p.id === id);
  }

  /**
   * What a map shows of the zone (`box` [west, south, east, north]; null: let go), the sources of its points
   * (`kinds`), the map (`by`): the list kept to the plants observed there — the whole zone when it shows all of the
   * circle. The search runs again only when those plants change — other sources, the same plants: the cells told all
   * the same (the list's banner says them).
   * @param {number[] | null} box @param {{ kinds?: string[] | null, by?: object | null }} [o]
   */
  setView(box, { kinds = null, by = null } = {}) {
    const at = this.live.at;
    const view = box && at && !boxHolds(box, circleBox(at, this.radius)) ? { box, kinds, by } : null;
    if (!view && !this.view) return;
    const other = Boolean(view && this.view) && String(view?.kinds) !== String(this.view?.kinds);
    this.view = view;
    this.#narrow(other);
  }

  /** « Toute la zone »: the list back to the whole zone, and the map that led it framed on it again (`refit`, detail: { by }). */
  wholeZone() {
    const by = this.view?.by ?? null;
    this.setView(null);
    this.dispatchEvent(new CustomEvent('refit', { detail: { by } }));
  }

  /**
   * A map moved by hand in use takes the lead of the list (`lead`, detail: { by }): its view is the one the address
   * keeps (its vue=, cells.js) — the group's other maps that lead it let theirs go. One author.
   * @param {object} by
   */
  lead(by) { this.dispatchEvent(new CustomEvent('lead', { detail: { by } })); }

  /** The plants of the view, now (none without one, or before the zone's plants are known). @returns {number[] | null} */
  #withinNow() {
    const v = this.view, s = this.species;
    return v && s ? plantsIn(this.points, s.plantOf, v.box, v.kinds) : null;
  }

  /**
   * The list kept to the view's plants: its search run again when they changed, its answer published with the cells
   * told — unless another view, or other plants of the zone, came meanwhile (theirs publish). The zone's points still
   * coming (another period, other filters): found among them once there (#loadScope). `told`: the cells told even when
   * the plants are the same (the view's sources changed).
   */
  async #narrow(told = false) {
    if (this.speciesState === 'loading') return;
    const within = this.#withinNow();
    if (String(within) === String(this.within)) { if (told) this.#changed(); return; }
    this.within = within;
    const s = this.species;
    if (!s) { this.#changed(); return; }
    this.channel.setScope(s.list.map(x => /** @type {number} */ (x.plantId)), { observed: this.#observed, within });
    const results = await this.channel.fetch();
    if (!results || this.within !== within || this.species !== s) return;
    this.channel.publish(results);
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
    const moved = circle !== this.#circle;
    if (moved) { this.#circle = circle; this.view = null; this.within = null; }
    const key = this.scopeKey;
    if (key !== this.scopeFor) {
      this.scopeFor = key;
      clearTimeout(this.timer);
      this.abort?.abort();
      this.abort = null;
      // Another circle (or none): what was loaded for the old one goes at once — never its points, nor the current
      // plant's, under the new circle. Another period, other filters: what is shown stays, dimmed (`updating`), until
      // the new answer replaces all of it at once (#loadScope). GBIF's datasets kept while only the filters changed
      // (counted as if none were chosen: one being ticked stays in view).
      if (moved) {
        this.points = []; this.pointsTotal = 0; this.totals = { inat: null, gbif: null }; this.failed = []; this.obsCounts = null; this.#observed = null;
        this.plantAbort?.abort(); this.plantAbort = null; this.plantObs = null; this.obsFor = '';
      }
      const zone = key.split(':').slice(0, 3).join(':');
      if (zone !== this.#datasetsZone) { this.datasets = []; this.#datasetsZone = zone; }
      if (!key) {
        this.species = null; this.speciesState = 'idle'; this.speciesError = null; this.speciesFailure = null;
        this.updating = false;
        this.#unscope();
        this.#changed();
      } else {
        this.speciesState = 'loading';
        this.updating = true;
        this.#changed();
        this.timer = setTimeout(() => this.#loadScope(key), 250);
      }
    }
    this.#loadPlant();
  }

  /**
   * No zone any more: its search over the whole flora again, its answer published with the cells told (the list
   * dimmed meanwhile) — a zone again meanwhile publishes its own (or, failing, asks the whole flora's again:
   * #loadScope). One never kept to a zone, and no answer owed (pending: one dropped for a zone gone again before its
   * own came): nothing to do.
   */
  async #unscope() {
    if (!this.scoped && !this.channel.pending) return;
    this.scoped = false;
    this.channel.setScope(null);
    this.updating = true;
    const results = await this.channel.fetch();
    if (this.scopeKey) return;
    this.updating = false;
    if (results) this.channel.publish(results);
    this.#changed();
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
   * and their plants (the list: the search kept to them) — everything computed first, the search's answer too (fetched,
   * not published), then given at once: one task, the cells drawn once. Its search answering late because something
   * was typed meanwhile (fetch: null), that run publishes its own answer; the rest is given all the same. Every source
   * failing: the search over the whole flora again, given the same way. @param {string} key
   */
  async #loadScope(key) {
    const at = /** @type {[number, number]} */ (this.live.at), r = this.radius;
    const abort = this.abort = new AbortController();
    const gone = () => abort.signal.aborted || key !== this.scopeKey;
    // The flora in the database first: iNaturalist's names are matched to it (core/nearby.js reads it once).
    await whenReady();
    if (gone()) return;
    /** @type {any} */
    let results = null;
    try {
      const found = await zoneObservations(at, r, { filters: this.filters, periode: this.periode, max: ZONE_MAX, signal: abort.signal });
      const plants = await speciesOf(found.points);
      if (gone()) return;
      const list = plants.list.filter(s => s.plantId);
      const counts = plantCounts(found.points, plants.plantOf);
      // The search's sort « Plus observées » (workers/search-core.js `observed`): each plant's total, cloned to the worker.
      const observed = Object.fromEntries([...counts].map(([id, c]) => [id, c.inat + c.gbif]));
      // A map's view kept (another period, other filters): its plants among the new points.
      const view = this.view;
      const within = view ? plantsIn(found.points, plants.plantOf, view.box, view.kinds) : null;
      this.scoped = true;
      this.channel.setScope(list.map(s => /** @type {number} */ (s.plantId)), { observed, within });
      results = await this.channel.fetch();
      if (gone()) return;
      this.points = found.points;
      this.pointsTotal = (found.totals.inat ?? 0) + (found.totals.gbif ?? 0);
      this.totals = found.totals;
      this.failed = found.failed;
      this.datasets = found.datasets;
      this.species = { key, list, byPlant: new Map(list.map(s => [/** @type {number} */ (s.plantId), s])), plantOf: plants.plantOf };
      this.obsCounts = { counts, sources: this.filters.sources.filter(x => !found.failed.some(f => f.name === SOURCE_NAMES[x])) };
      this.#observed = observed;
      this.within = within;
      this.speciesState = 'ready';
      this.speciesError = null;
      this.speciesFailure = null;
    } catch (error) {
      if (gone()) return;
      // Each source's failure (core/observations.js ObsError); else every source asked, not answering.
      const sources = this.filters.sources;
      const said = /** @type {{ failed?: import('../core/observations.js').ObsFailure[] }} */ (error).failed;
      const failed = said?.length ? said : sources.map(x => ({ name: SOURCE_NAMES[x], off: false }));
      const failure = failed.every(f => f.off) ? 'off' : navigator.onLine ? 'unreachable' : 'offline';
      // Kept to a zone — or the whole flora's answer still owed (pending: the zone let go, its answer dropped for this
      // one, #unscope): the whole flora's asked, never the old zone's plants left under « la zone ne filtre pas ».
      if (this.scoped || this.channel.pending) {
        this.scoped = false;
        this.channel.setScope(null);
        results = await this.channel.fetch();
        if (gone()) return;
      }
      this.points = []; this.pointsTotal = 0; this.totals = { inat: null, gbif: null }; this.failed = failed; this.datasets = []; this.obsCounts = null; this.#observed = null;
      this.species = null;
      this.within = null;
      this.speciesState = 'error';
      this.speciesFailure = failure;
      this.speciesError = failure === 'off' ? `${failedText(failed)} (Réglages › Modules) : la zone ne filtre pas les plantes.`
        : failure === 'unreachable' ? `${failedText(failed)} : la zone ne filtre pas les plantes pour l’instant.`
        : `Hors ligne : la zone ne filtre pas les plantes (${sourcesText(sources)} ${sources.length > 1 ? 'sont' : 'est'} en ligne).`;
    }
    this.updating = false;
    // The current plant's big points: its own among these points, given with them (another plant's: asked) — found
    // again even for the same key (« Réessayer »: the same zone, its points anew).
    this.obsFor = '';
    this.#plantObs(false);
    if (results) this.channel.publish(results);
    this.#changed();
    // A map moved meanwhile (the search was asked for the view before): the list kept to what it shows now.
    this.#narrow();
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

  /**
   * Another screen (another layout followed): its search over the whole flora forgotten — never its rows shown for
   * this one's, which a new answer of the same screen keeps until it comes — and asked again (wholeOf).
   */
  forgetWhole() {
    this.whole = null;
    this.wholeFor = '';
  }

  /**
   * The search over the whole flora asked again for the same search, as every search of the screen runs again
   * (gf-layout.js#rerun: « Mes plantes » changed — its facet, its counts —, a new flora): what it lists kept until it
   * answers. None asked (no results(zone=0) cell): nothing.
   */
  rewhole() {
    if (!this.wholeFor) return;
    this.wholeFor = '';
    this.wholeOf(true);
  }

  /**
   * The current plant: its observations in the scope (#plantObs), its names (the cells' heads). Its names are read
   * once the flora is in the database: on a first visit the layout is drawn while it downloads, and a plant read then
   * (?p= in the address) would be none — its heads empty for good, since the same plant is never read twice.
   */
  async #loadPlant() {
    this.#plantObs();
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
  }

  /**
   * The current plant's observations in the scope (the maps' big points), for the zone's plants as they are (`key`:
   * its id and their scope; another key, they go at once). A plant of the zone's: its own among the zone's points —
   * the same sources, period, filters and datasets, as many as its row's « n obs. » —, nothing asked. Another (chosen
   * elsewhere: the whole flora's results, a fixed plant): iNaturalist's alone (#plantAround), said so on the map
   * (`outside`) — none, nothing asked, when its group's sources leave iNaturalist out. None without a zone, or before
   * its plants are known (every source failing: those shown go). Drawn at once, unless `draw` is false
   * (#loadScope gives them with the rest). @param {boolean} [draw]
   */
  #plantObs(draw = true) {
    // The zone's plants of this circle: another circle's, still shown while its own come, give it none.
    const id = this.live.plant, s = this.species?.key.startsWith(this.#circle + ':') ? this.species : null;
    const key = id && s && this.live.at ? id + '@' + s.key : '';
    // The same key: kept (another period, other filters still coming) — but never under none (no plant, no zone's
    // plants: every source failed), whose big points would be another plant's, or another answer's.
    if (key === this.obsFor && (key || !this.plantObs)) return;
    this.obsFor = key;
    this.plantAbort?.abort();
    this.plantAbort = null;
    const had = this.plantObs !== null;
    if (key && id && s?.byPlant.has(id)) {
      this.plantObs = { key, points: this.points.filter(p => plantOfPoint(s.plantOf, p) === id), outside: false };
    } else if (id && key && !this.filters.sources.includes('inat')) {
      // iNaturalist not among the group's sources (GBIF's alone): never asked — none of its observations in the zone.
      this.plantObs = { key, points: [], outside: true };
    } else {
      // The same plant outside the same circle's plants (another period, other filters): its points kept, dimmed with
      // the rest, until iNaturalist's answer replaces them — never a map without them meanwhile.
      const same = key && this.plantObs?.outside && this.plantObs.key.startsWith(id + '@' + this.#circle + ':');
      if (!same) this.plantObs = null;
      if (id && key) this.#plantAround(id, key);
    }
    if (draw && (had || this.plantObs)) this.#changed();
  }

  /**
   * A plant not among the zone's: its taxon found by its name, its iNaturalist observations in the circle asked — as
   * the zone's filters (inatQuery: its quality grades, never research grade alone unless they say so) and its period
   * say —, shown all the same (never an empty map without a word); one request, cancelled by the next change. Not
   * answering: none, nothing said. @param {number} id @param {string} key
   */
  async #plantAround(id, key) {
    const abort = this.plantAbort = new AbortController();
    const at = /** @type {[number, number]} */ (this.live.at), r = this.radius, filters = inatQuery(this.filters), periode = this.periode;
    const live = () => !abort.signal.aborted && this.obsFor === key;
    await whenReady();
    const sci = this.plantInfo?.id === id ? this.plantInfo.sci : (await getPlant(id))?.scientificName;
    const taxon = sci ? await taxonIdOf(sci).catch(() => undefined) : null;
    if (!live() || taxon === undefined) return;
    const pts = taxon ? await observationsAround(taxon, at, r, abort.signal, filters, periode).catch(() => null) : [];
    if (!live() || !pts) return;
    this.plantObs = { key, points: pts.map(p => ({ coordinates: p.coordinates, date: p.date, url: p.url, kind: 'inat' })), outside: true, capped: pts.length >= AROUND_MAX };
    this.#changed();
  }

  /**
   * The layout gone: its loads stopped, nothing hovered, its search kept to no zone — never run again: it goes with the
   * screen (Flore's was never touched).
   */
  dispose() {
    this.hover = null;
    clearTimeout(this.timer);
    this.abort?.abort();
    this.findAbort?.abort();
    this.plantAbort?.abort();
    if (this.scoped) { this.scoped = false; this.channel.setScope(null); }
  }
}
