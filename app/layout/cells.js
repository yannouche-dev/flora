// @ts-check
// What each cell of a free layout shows (« Disposition libre »): the app's own pieces, wired to the layout's shared
// state (state.js) rather than to the address — one adapter per component of the registry (registry.js):
//  - map: the mother map (gf-map; 3D as Réglages › Cartes says): the scope's circle, the latest observations of the
//    plants found in it (those the search keeps), the current plant's own observations lit, the observation chosen.
//    A point touched: its plant is the current one; a long press: the scope moves there. Over it, the scope: its place,
//    its radius (a slider), « Autour de moi », « Toute la France » (no scope). Its settings (registry.js, map-options.js)
//    change each of these: its own scope while the address has none (lieu, autour), its background and 3D, its IGN
//    layers, its points (sources, period, style, the current plant's grouped), how it follows the state (suit, plante,
//    toucher), its controls (ui: by its width, compact, none; ctl: exactly which — the zone and a handle on the circle's
//    edge that drags its radius, the address search, « Me localiser », the layers, 2D / 3D, the other background's
//    thumbnail, the current plant's chip, the period's chips, the count, the legend, the zoom: map-options.js);
//  - place: the scope alone — « Autour de moi », a commune (gf-place-search), the radius;
//  - search: Flore's search bar (gf-results-bar: text, sort, filters chosen, « Filtrer par »), its filters (gf-filter-
//    panel, opened by the funnel) and its list; filters and results: each part alone. They read and write the store's
//    query, as in Flore; the scope keeps the search to its plants (state.js);
//  - plant: the plant sheet (gf-plant-detail), whole or one block (plant.wikipedia: its `only`); media: the photos'
//    viewer (gf-media-viewer). Each shows the current plant;
//  - deck: Rencontres' cards (miniapp/kit/ma-deck.js) for the plants found in the scope, the one on top the current
//    plant; a heart: a favourite.
// What is done in a cell with its own controls is kept in the layout (`cell-param` {key: value…}, gf-layout.js: the
// address is the app, sent as it is): a map's 3D, background, layers (their order, IGN's catalogue, their opacity),
// period, « Seule », legend, binoculars (« Observations autour » in 3D), and, in « Créer une app », its view; the
// search's filters opened; the results as a list or a grid.
// A link to a plant's sheet anywhere in a cell (a result, a look-alike) makes it the current plant (gf-layout.js).
// The frame every cell shares (registry.js#FRAME: its head, its actions, its empty state) is gf-layout.js'; its links
// are honoured here: a plant of its own (plante=: renderCell), the whole flora instead of the zone (results zone=0:
// DlResults, state.js#wholeOf), a card touched and the swipes (toucher, ecrit=0: DlDeck); the deck tells the layout
// when it has no cards (`cell-empty`), for a deck that hides meanwhile (vide=masque).

import { LitElement, html, css, nothing } from 'lit';
import { icon } from '../core/icons.js';
import { moduleOn } from '../core/modules.js';
import { FIX_MAX_AGE, geoProblem, takeFix } from '../core/geo.js';
import { addressAt } from '../core/geoservices.js';
import { plantViewOf } from '../core/store.js';
import { SearchController } from '../core/search-channel.js';
import { blockStyle } from '../core/sheet-blocks.js';
import { href } from '../core/router.js';
import { floweringMonths, getPlant } from '../core/plants.js';
import { alertsOf } from '../core/alerts.js';
import { thumbCredit } from '../core/credit.js';
import { cachedThumb, thumbUrl } from '../core/thumb.js';
import { hintView, takeHint } from '../core/hints.js';
import { isFavorite, toggleFavorite } from '../core/collections.js';
import { ui } from '../styles/ui.js';
import { DISTANCES, distanceAt, distanceEvents, distanceKey } from '../miniapp/kit/cards.js';
import { pushHash } from '../core/history.js';
import { addCatalogLayer, DEFAULT_OPACITY, isOverlay } from '../core/ign.js';
import { loadCatalog } from '../core/ign-catalog.js';
import { RADII_3D } from '../core/around3d.js';
import { nearestStop } from '../core/distance.js';
import { cellIcon, distanceLabel } from './registry.js';
import { COMPACT_WIDTH, MAP_LAYERS, WIDE_FRAMES, catalogLayers, inatTiles, inWhen, layersOf, mapControls, opacitiesOf, opacText, overlaysOf, snapRadius, uiMode, viewOf, viewText } from './map-options.js';
import { periodQuery, plantOfPoint, taxonIdOf } from '../core/nearby.js';
import { SOURCE_NAMES, failedText, obsNotes, sourcesText } from '../core/observations.js';
import { obsId } from './state.js';
import { speciesKey } from '../components/map-style.js';
import '../components/gf-map.js';
import '../components/gf-place-search.js';
import '../components/gf-results-bar.js';
import '../components/gf-filter-panel.js';
import './obs-filters.js';
import '../components/gf-plant-list.js';
import '../components/gf-plant-detail.js';
import '../components/gf-media-viewer.js';
import '../miniapp/kit/ma-deck.js';

/**
 * @typedef {import('./state.js').LayoutState} LayoutState
 * @typedef {import('./registry.js').Resolved} Resolved
 * @typedef {import('../miniapp/kit/cards.js').Card} Card
 */

/**
 * « Autour de moi »: the position, once (a fix older than a minute is not taken: geo.js FIX_MAX_AGE). Rejects with the
 * reason, in French.
 * @returns {Promise<[number, number]>}
 */
export function locateOnce() {
  return new Promise((resolve, reject) => {
    takeFix({ maxAge: FIX_MAX_AGE }, r => {
      if (!r) return; // never: no timeout, no signal
      if ('error' in r) reject(new Error(geoProblem(r.code, { place: true }).text));
      else resolve(r.coordinates);
    });
  });
}

/** The scope's place, once found (IGN): written in the state without a new entry. @param {LayoutState} state @param {[number, number]} at */
async function nameScope(state, at) {
  const a = await addressAt(at).catch(() => null);
  if (a?.city && state.live.at === at) state.set({ place: a.city }, 'replace');
}

/**
 * Settings of the cell an element is in, changed by its own controls: kept in the layout (gf-layout.js, `cell-param`).
 * @param {Element} el @param {Record<string, unknown>} values
 */
const setCell = (el, values) => el.dispatchEvent(new CustomEvent('cell-param', { detail: values, bubbles: true, composed: true }));

/** Watches the state: the host drawn again on each change — and on its other events it names, as it says (`hover`). */
class StateController {
  /**
   * @param {LitElement & { state: LayoutState | null }} host
   * @param {Record<string, (e: Event) => void>} [also] other events of the state, and what each does
   */
  constructor(host, also = {}) {
    this.host = host;
    /** @type {LayoutState | null} */ this.watched = null;
    /** @type {[string, (e: Event) => void][]} */
    this.handlers = [['change', () => host.requestUpdate()], ...Object.entries(also)];
    host.addController(this);
  }

  /** @param {LayoutState | null} state */
  watch(state) {
    for (const [type, fn] of this.handlers) this.watched?.removeEventListener(type, fn);
    this.watched = state;
    for (const [type, fn] of this.handlers) state?.addEventListener(type, fn);
  }

  hostUpdate() { if (this.host.state !== this.watched) this.watch(this.host.state); }
  hostDisconnected() { this.watch(null); }
  hostConnected() { if (this.host.state) this.watch(this.host.state); }
}

/**
 * The scope in words: « 2 km autour de Paris », « Toute la France »; a place of the address still to find (place=
 * without at=, state.js): « Recherche du lieu : … », or why it was not found (« Lieu introuvable : … »).
 * @param {LayoutState} state
 */
export function scopeWords(state) {
  const { at, place } = state.live;
  if (!at && place && state.placeState === 'finding') return `Recherche du lieu : ${place}…`;
  if (!at && place && state.placeError) return state.placeError;
  return at ? `${distanceLabel(state.radius)} autour ${place ? 'de ' + place : 'du point choisi'}` : 'Toute la France';
}

/** What the scope says of the plants: their count, coming, or why it does not filter. @param {LayoutState} state */
function scopeNote(state) {
  if (!state.live.at) return '';
  if (state.speciesState === 'loading') return 'Observations de la zone : recherche…';
  if (state.speciesState === 'error') return state.speciesError ?? '';
  const n = state.species?.list.length ?? 0;
  // The layout's period (state.js): the plants of the zone that year, that month.
  const when = state.periode === 'annee' ? ' cette année' : state.periode === 'mois' ? ' ce mois-ci' : '';
  // The plants of the zone's latest observations (the map's: state.js), as the flora knows them — and from where.
  const from = sourcesText(state.filters.sources.filter(x => !state.failed.some(f => f.name === SOURCE_NAMES[x])));
  return n ? `${n.toLocaleString('fr-FR')} plante${n > 1 ? 's' : ''} dans les observations de la zone${when} (${from})` : `Aucune plante de la flore dans les observations de la zone${when} (${from}).`;
}

/** Shared by the scope's controls (map, place): the radius slider, « Autour de moi », the place's name. */
const scopeStyles = css`
  .radius { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 0.85rem; }
  .radius input { flex: 1; min-width: 0; margin: 0; accent-color: var(--gf-accent); }
  .radius b { flex: none; min-width: 48px; font-variant-numeric: tabular-nums; color: var(--gf-accent); }
  .note { margin: 0; font-size: 0.78rem; color: var(--gf-text-muted); }
  .note.error { color: var(--gf-danger); }
  .where { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 0.85rem; font-weight: 600; }
  .where span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .where .icon-btn { width: 32px; height: 32px; font-size: 1rem; flex: none; }
  .where.error { color: var(--gf-danger); }
`;

/**
 * The scope's line (map, place): its words — in the danger's colour, and read at once, when a place of the address
 * was not found — and ✕: no scope (nor a place to find).
 * @param {LayoutState} s
 */
const where = s => {
  const failed = Boolean(s.placeError && !s.live.at);
  const words = scopeWords(s);
  return html`<div class="where ${failed ? 'error' : ''}" data-place-state=${s.placeState}>${icon(failed ? 'exclamation-triangle-fill' : 'crosshair')}<span role=${failed ? 'alert' : nothing} title=${words}>${words}</span>
    ${s.live.at || s.live.place ? html`<button class="icon-btn" type="button" title="Toute la France (sans zone)" aria-label="Toute la France (sans zone)" @click=${() => s.setScope(null)}>${icon('x-lg')}</button>` : nothing}</div>`;
};

/**
 * The radius' slider (map, place): Rencontres' stops (kit/cards.js), the radius shown where it is — one the address
 * gives between two stops (r=3km) sits between them, never on a stop it is not; moved, it goes from stop to stop.
 * @param {LayoutState} state
 */
const radiusSlider = state => {
  const on = distanceEvents(() => state.radius, m => state.set({ r: m }, 'replace'));
  return html`<label class="radius"><span class="visually-hidden">Rayon de la zone</span>
    <input type="range" min="0" max=${DISTANCES.length - 1} step="any" .value=${String(distanceAt(state.radius))} aria-label="Rayon de la zone"
      aria-valuetext=${distanceLabel(state.radius)} @input=${on.input} @keydown=${on.keydown} />
    <b>${distanceLabel(state.radius)}</b></label>`;
};

// ── map ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The other background, as its thumbnail says it. */
const OTHER_BASE = { photo: { key: 'plan', label: 'Plan', words: 'le plan IGN' }, plan: { key: 'photo', label: 'Photo', words: 'les photos aériennes' } };

/** The period's chips (when=), in their order. */
const PERIODS = [['toujours', 'Toujours'], ['annee', 'Cette année'], ['mois', 'Ce mois-ci']];

/** « 214 observations », « 1 espèce ». @param {number} n @param {string} word */
const counted = (n, word) => `${n.toLocaleString('fr-FR')} ${word}${n > 1 ? 's' : ''}`;

/**
 * iNaturalist's taxa of names of the flora (families, genera, species), each found once (core/nearby.js#taxonIdOf,
 * cached), four at a time — never forty requests at once; those not found left out.
 * @param {string[]} names @returns {Promise<number[]>}
 */
async function namesToTaxa(names) {
  /** @type {(number | null)[]} */
  const ids = [];
  for (let i = 0; i < names.length; i += 4) ids.push(...await Promise.all(names.slice(i, i + 4).map(n => taxonIdOf(n).catch(() => null))));
  return /** @type {number[]} */ (ids.filter(Boolean));
}

export class DlMap extends LitElement {
  static properties = {
    state: { attribute: false }, params: { attribute: false },
    /** The search of its group (core/search-channel.js: a layout's group b, c); none: the app's. */
    channel: { attribute: false },
    /** In « Créer une app »: the map moved there is the view it starts on (vue=). */
    building: { attribute: false },
    _busy: { state: true }, _narrow: { state: true }, _zone: { state: true }, _thumb: { state: true }
  };

  static styles = [ui, scopeStyles, css`
    :host { display: flex; flex-direction: column; position: relative; min-height: 0; isolation: isolate; }
    /* The map and its zone panel; above them, in the cell's flow, the long press's first-use hint: never over the map
       (in the panel it made it taller, over the map's own controls). */
    .stage { flex: 1; min-height: 0; position: relative; }
    .stage > gf-map { position: absolute; inset: 0; display: block; }
    .press-hint { flex: none; margin: 6px 8px; box-shadow: none; background: var(--gf-surface-2); }
    /* Under the map's own address search (whose place picked moves the scope too: its point, below). */
    .panel { position: absolute; z-index: 500; left: 8px; top: 60px; width: min(300px, calc(100% - 64px)); display: grid; gap: 6px; padding: 8px 10px; border-radius: 12px;
      background: color-mix(in srgb, var(--gf-surface) 95%, transparent); box-shadow: var(--gf-shadow); }
    .row { display: flex; flex-wrap: wrap; gap: 6px; }
    .row button { min-height: 32px; padding: 4px 12px; font-size: 0.82rem; }
    /* Compact controls (ui=compacte, or a narrow cell): no address search, the zone at the top, smaller; « Autour de
       moi » its icon alone; the map's own buttons and zoom smaller. */
    .panel.compact { top: 8px; width: min(240px, calc(100% - 56px)); gap: 4px; padding: 6px 8px; }
    .panel.compact .where { font-size: 0.8rem; }
    .panel.compact .row button { min-height: 28px; padding: 2px 8px; }
    .panel.compact .row .words { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    :host([ui='compacte']) gf-map .gf-map-buttons button { width: 28px; height: 28px; font-size: 0.85rem; }
    :host([ui='compacte']) gf-map .leaflet-control-zoom a { width: 26px; height: 26px; line-height: 26px; font-size: 16px; }
    /* The controls as ctl= says (map-options.js mapControls): the zoom only when it is one of them; « Me localiser »
       large on the ground (terrain). None (ui=nue): the map alone (the cell's head says the zone). */
    :host(:not([ctl~='zoom'])) gf-map .leaflet-control-zoom { display: none; }
    :host([ui='nue']) gf-map .gf-compass-bar { display: none; }
    :host([big-gps]) gf-map .gf-map-buttons button.locate { width: 48px; height: 48px; font-size: 1.35rem; opacity: 1; }
    .panel.top { top: 8px; }
    /* Compact: the zone a pill (« 2 km ▾ »), its stops and « Autour de moi » under it once opened. */
    .zone { position: absolute; z-index: 501; left: 8px; top: 8px; max-width: calc(100% - 64px); }
    .zone.low { top: 60px; }
    .zone > button { min-height: 32px; padding: 4px 12px; border-radius: var(--gf-radius-pill); font-size: 0.85rem; font-weight: 600; box-shadow: var(--gf-shadow);
      background: color-mix(in srgb, var(--gf-surface) 95%, transparent); display: inline-flex; align-items: center; gap: 4px; }
    .zone > button.error { color: var(--gf-danger); }
    .zone .drop { margin-top: 6px; display: grid; gap: 6px; padding: 8px 10px; border-radius: 12px; width: 240px; max-width: 100%; box-sizing: border-box;
      background: color-mix(in srgb, var(--gf-surface) 97%, transparent); box-shadow: var(--gf-shadow); }
    .stops { display: flex; flex-wrap: wrap; gap: 4px; }
    .stops button { min-height: 32px; padding: 2px 8px; font-size: 0.8rem; }
    .stops button[aria-pressed='true'] { background: var(--gf-accent); color: var(--gf-accent-contrast); border-color: transparent; }
    /* The controls of ctl=, each in its fixed place: top right under the map's own buttons (3D, the other background),
       bottom left over the zoom (the current plant, the legend), bottom right over the credits (the period, the count). */
    .ctl { position: absolute; z-index: 500; display: flex; flex-direction: column; gap: 6px; pointer-events: none; }
    .ctl > * { pointer-events: auto; }
    .tr { right: 8px; top: var(--tr-top, 52px); align-items: flex-end; }
    /* Their heights over the map's own corners (zoom and scale, credits; MapLibre's in 3D) are measured (#placeControls). */
    .bl { left: 8px; bottom: var(--bl-bottom, 40px); align-items: flex-start; max-width: min(300px, calc(100% - 16px)); }
    .br { right: 8px; bottom: var(--br-bottom, 26px); align-items: flex-end; max-width: calc(100% - 16px); }
    /* In 3D, « Observations autour » (bottom middle) has the right corner lower. */
    .stage:has(gf-map[data-renderer='3d']) .br { bottom: max(64px, var(--br-bottom, 26px)); }
    .round { width: 32px; height: 32px; padding: 0; border-radius: 50%; display: grid; place-items: center; font-size: 0.72rem; font-weight: 700;
      background: color-mix(in srgb, var(--gf-surface) 85%, transparent); box-shadow: 0 1px 3px rgb(0 0 0 / 14%); }
    .round[aria-pressed='true'] { background: var(--gf-accent); color: var(--gf-accent-contrast); }
    /* The other background's thumbnail: its look drawn (no tile asked), its name under it. */
    .base { width: 48px; height: 48px; padding: 0; border-radius: 10px; overflow: hidden; display: grid; align-items: end; border: 2px solid #fff;
      box-shadow: 0 1px 4px rgb(0 0 0 / 30%); font-size: 0.68rem; font-weight: 700; color: #fff; text-shadow: 0 1px 2px rgb(0 0 0 / 70%); }
    .base.photo { background: radial-gradient(circle at 30% 30%, #7f9b55 0 18%, transparent 19%), radial-gradient(circle at 70% 65%, #4f6d33 0 22%, transparent 23%),
      linear-gradient(135deg, #5d7a3e, #8a8f5a 55%, #3e5a2c); }
    .base.plan { background: linear-gradient(90deg, transparent 45%, #f6d27a 45% 55%, transparent 55%), linear-gradient(0deg, transparent 62%, #fff 62% 68%, transparent 68%),
      linear-gradient(135deg, #eef0e6, #dfe7d4); color: #1d2419; text-shadow: 0 0 2px #fff; }
    .base span { display: block; padding: 1px 0 2px; text-align: center; background: rgb(0 0 0 / 28%); }
    .base.plan span { background: rgb(255 255 255 / 70%); }
    :host([ctl-compact]) .round { width: 28px; height: 28px; }
    :host([ctl-compact]) .base { width: 36px; height: 36px; }
    :host([ctl-compact]) .base span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    /* The current plant: its photo, its name (its sheet ↗), « Seule », ✕. */
    .chip { display: flex; align-items: center; gap: 2px; max-width: 100%; padding: 3px; border-radius: var(--gf-radius-pill); background: color-mix(in srgb, var(--gf-surface) 96%, transparent);
      box-shadow: var(--gf-shadow); font-size: 0.82rem; }
    .chip .open { display: flex; align-items: center; gap: 6px; min-width: 0; min-height: 32px; padding: 0 6px 0 0; color: inherit; text-decoration: none; border-radius: var(--gf-radius-pill); }
    .chip .open:focus-visible, .chip button:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .chip img, .chip .ph { flex: none; width: 32px; height: 32px; border-radius: 50%; object-fit: cover; background: var(--gf-surface-2); display: grid; place-items: center; }
    .chip .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .chip button { flex: none; min-height: 32px; min-width: 32px; padding: 0 8px; border-radius: var(--gf-radius-pill); font-size: 0.78rem; }
    .chip button[aria-pressed='true'] { background: var(--gf-accent); color: var(--gf-accent-contrast); border-color: transparent; }
    :host([ctl-compact]) .chip .name { max-width: 9em; }
    /* The legend (legende): its button, its lines once opened. */
    .legend > button { min-height: 32px; padding: 2px 12px; border-radius: var(--gf-radius-pill); font-size: 0.8rem; box-shadow: var(--gf-shadow); background: color-mix(in srgb, var(--gf-surface) 95%, transparent); }
    .legend ul { list-style: none; margin: 6px 0 0; padding: 8px 10px; display: grid; gap: 4px; border-radius: 12px; font-size: 0.8rem;
      background: color-mix(in srgb, var(--gf-surface) 97%, transparent); box-shadow: var(--gf-shadow); }
    .legend li { display: flex; align-items: center; gap: 8px; }
    .legend i { flex: none; width: 12px; height: 12px; border-radius: 50%; background: var(--c, #6b8f3a); border: 1px solid #fff; box-shadow: 0 0 0 1px rgb(0 0 0 / 20%); }
    .legend i.obs { border: 0; background: radial-gradient(circle at 35% 30%, #ff6f9c, var(--gf-kin) 75%); box-shadow: 0 0 0 1.5px var(--gf-highlight); }
    .legend i.outline { background: transparent; border: 2px solid #a3e68a; box-shadow: 0 1px 0 rgb(0 0 0 / 30%); }
    .legend i.area { border-radius: 3px; background: color-mix(in srgb, #7c3aed 35%, transparent); border-color: #7c3aed; }
    /* The period: three chips in one. */
    .period { display: flex; border-radius: var(--gf-radius-pill); overflow: hidden; box-shadow: var(--gf-shadow); background: color-mix(in srgb, var(--gf-surface) 95%, transparent); }
    .period button { min-height: 32px; padding: 2px 10px; border: 0; border-radius: 0; background: none; font-size: 0.78rem; white-space: nowrap; }
    .period button + button { border-left: 1px solid var(--gf-border); }
    .period button[aria-pressed='true'] { background: var(--gf-accent); color: var(--gf-accent-contrast); }
    /* The count: the points shown, the plants found; touched, the map's « État ». */
    .count { min-height: 28px; padding: 2px 10px; border-radius: var(--gf-radius-pill); font-size: 0.78rem; font-variant-numeric: tabular-nums; white-space: nowrap;
      background: color-mix(in srgb, var(--gf-surface) 90%, transparent); box-shadow: 0 1px 3px rgb(0 0 0 / 14%); }
  `];

  #store = new SearchController(this);

  constructor() {
    super();
    // A plant hovered in a list: its points lit on the map itself (the cell not drawn again). « Toute la zone » beside
    // the list it led: framed on the zone again.
    new StateController(this, {
      hover: () => this.#lightHovered(),
      refit: e => { if (/** @type {CustomEvent} */ (e).detail?.by === this) this.#map?.refit(); }
    });
    /** @type {LayoutState | null} */ this.state = null;
    /** The search of its group (core/search-channel.js); none: the app's. @type {import('../core/search-channel.js').Channel | null} */ this.channel = null;
    /** @type {Record<string, any>} */ this.params = {};
    this._busy = false;
    /** Narrower than COMPACT_WIDTH (ui=auto: compact controls). */
    this._narrow = false;
    this.building = false;
    /** The compact zone's pill opened. */
    this._zone = false;
    /** The current plant's photo, once found (core/thumb.js): its id and address. @type {{ id: number, url: string | null } | null} */ this._thumb = null;
  }

  /** The cell's width followed: under 360 px, compact controls (ui=auto). */
  #resize = new ResizeObserver(entries => {
    const w = entries[entries.length - 1]?.contentRect.width ?? 0;
    if (w > 0) this._narrow = uiMode('auto', w) === 'compacte';
    this.#placeControls();
  });

  connectedCallback() { super.connectedCallback(); this.#resize.observe(this); }
  disconnectedCallback() { super.disconnectedCallback(); this.#resize.disconnect(); }

  /** The map's settings (registry.js), their defaults when none were given. */
  get #p() {
    const p = this.params ?? {};
    return {
      // The period: the layout's, shared by every cell (the address' periode=, else a map's when=: state.js). The
      // sources of its points: those it says among its group's (core/observations.js), else all of them.
      src: /** @type {string[]} */ (p.src ?? this.state?.filters.sources ?? ['inat']), when: /** @type {string} */ (this.state?.periode ?? p.when ?? 'toujours'), suit: p.suit !== false,
      plante: /** @type {string} */ (p.plante ?? 'grand'),
      toucher: /** @type {string} */ (p.toucher ?? 'plante'), pts: /** @type {string} */ (p.pts ?? 'photo'),
      portee: /** @type {'zone' | 'france' | 'monde'} */ (p.portee ?? 'zone'),
      ui: uiMode(p.ui, this._narrow ? COMPACT_WIDTH - 1 : COMPACT_WIDTH)
    };
  }

  /** The controls drawn over the map (ctl=, else by ui and the intent: map-options.js) and whether they are compact. */
  get #ctl() {
    const p = this.params ?? {};
    return mapControls({ ctl: p.ctl ?? null, ui: p.ui, intent: p.intent }, this._narrow ? COMPACT_WIDTH - 1 : COMPACT_WIDTH);
  }

  /** The map's 3D as 3d= says (its switch writes it; null: as Réglages › Cartes say). @returns {boolean | null} */
  get #d3() { return this.params?.['3d'] ?? null; }

  /** Settings of this cell changed by its controls: kept in the layout. @param {Record<string, unknown>} values */
  #set(values) { setCell(this, values); }

  /** The radius' handle on the circle (gf-map radiusHandle): the slider's stops, its keys, its words. */
  #radiusHandle = { snap: (/** @type {number} */ m) => snapRadius(m, DISTANCES), step: distanceKey, label: distanceLabel };

  /** The map's view held while its cell changes size (a separator dragged beside it). */
  holdFrame() { /** @type {any} */ (this.renderRoot.querySelector('gf-map'))?.holdFrame?.(); }

  /**
   * The plants found (the search, in the scope) — the zone's, even while the list keeps to what a map shows of it: the
   * points never depend on the view —, as a set of ids: the same set while the results are the same.
   */
  get #found() {
    const results = this.#store.state.results;
    if (this.#foundFor !== results) { this.#foundFor = results; this.#foundSet = new Set(results.inZone ?? results.items.map(p => p.id)); }
    return this.#foundSet;
  }
  /** @type {any} */ #foundFor = null;
  /** @type {Set<number>} */ #foundSet = new Set();

  /** The plant of a point: by its iNaturalist taxon, else its name (GBIF's: core/nearby.js plantOfPoint). @param {any} p @returns {number | undefined} */
  #plantOf(p) {
    const plantOf = /** @type {LayoutState} */ (this.state).species?.plantOf;
    return plantOf ? plantOfPoint(plantOf, p) : undefined;
  }

  /**
   * The circle and its observations, as the settings say: their sources (src: those it shows of the zone's — the
   * latest of the layout's period, from its group's sources, merged: state.js, core/observations.js —, whose plants
   * are the list), those of the plants the search keeps (suit: the list's — a filter, its plants alone; else every
   * observation of the zone), of the current plant alone (plante=seule), as photos or dots (pts) — the same object
   * while nothing changed (the map keeps its points).
   */
  get #area() {
    const s = /** @type {LayoutState} */ (this.state);
    const at = s.live.at;
    if (!at) return null;
    const P = this.#p;
    const found = this.#found, plantOf = s.species?.plantOf;
    const current = P.plante === 'seule' ? s.live.plant : null;
    const sig = JSON.stringify([P.src, P.when, P.suit, P.plante, P.pts, current]);
    const memo = this.#areaMemo;
    if (memo && memo.at === at && memo.r === s.radius && memo.pts === s.points && memo.found === found && memo.plantOf === plantOf
      && memo.sig === sig) return memo.value;
    /** @type {any[]} */
    const all = s.points.filter(p => P.src.includes(p.kind));
    // The current plant's alone (none chosen: none); else the plants the search keeps (all of them while the plants of
    // the scope are unknown), or every plant observed (suit=0).
    let points = P.plante === 'seule' ? (current ? all.filter(p => this.#plantOf(p) === current) : [])
      : P.suit && plantOf ? all.filter(p => { const id = this.#plantOf(p); return id !== undefined && found.has(id); }) : all;
    if (P.when !== 'toujours') points = points.filter(p => inWhen(p.date, P.when));
    const value = { center: at, radius: s.radius, fit: true, leaves: P.pts !== 'pastille', points };
    this.#areaMemo = { at, r: s.radius, pts: s.points, found, plantOf, sig, value };
    return value;
  }
  /** @type {any} */ #areaMemo = null;

  /** The current plant's observations in the scope, large, its photo in each (those of the period: when). */
  get #highlight() {
    const s = /** @type {LayoutState} */ (this.state);
    const obs = s.plantObs, info = s.plantInfo, when = this.#p.when;
    // Its own observations are iNaturalist's (state.js): a map that shows only GBIF's has none of them.
    if (!obs || !info || !obs.points.length || !this.#p.src.includes('inat') || !s.filters.sources.includes('inat')) return null;
    if (this.#hlMemo?.key === obs.key + ':' + info.name + ':' + when) return this.#hlMemo.value;
    const sp = s.species?.byPlant.get(info.id);
    const photo = sp?.photo && moduleOn('photos', plantViewOf(this.#store.state)) ? sp.photo.replace(/\/square\./, '/small.') : null;
    const points = obs.points.filter(p => inWhen(p.date, when));
    const value = !points.length ? null : { key: obs.key + ':' + when, photo, credit: photo ? sp?.credit ?? null : null, common: info.name, sci: info.sci, taxonId: sp?.taxonId ?? null,
      points: points.map(p => ({ coordinates: p.coordinates, title: info.name, url: p.url, date: p.date, taxonId: sp?.taxonId ?? null, sci: info.sci, plantId: info.id })) };
    this.#hlMemo = { key: obs.key + ':' + info.name + ':' + when, value };
    return value;
  }
  /** @type {{ key: string, value: any } | null} */ #hlMemo = null;

  /**
   * A map of France or of the world (portee=): the iNaturalist taxa of the plants it shows — the plants found in the
   * zone (the zone's list, as the search keeps it); without a zone, those the search keeps: its families and genera
   * when it filters by them, else its plants when they are few (40 at most), each name found once on iNaturalist
   * (core/nearby.js#taxonIdOf); else every plant (null). undefined: still being found; []: none found.
   * @returns {number[] | null | undefined}
   */
  #wideTaxa() {
    const s = /** @type {LayoutState} */ (this.state), P = this.#p;
    const list = s.species?.list;
    if (s.live.at && list) {
      const found = this.#found;
      // iNaturalist's tiles: the plants it knows here (a plant seen by GBIF alone has no taxon of it).
      return /** @type {number[]} */ ((P.suit ? list.filter(x => found.has(/** @type {number} */ (x.plantId))) : list).map(x => x.taxonId).filter(t => t != null).slice(0, 400));
    }
    if (!P.suit) return null;
    const st = this.#store.state;
    const facets = [...st.query.filters.family, ...st.query.filters.genus];
    const few = st.results.total > 0 && st.results.total <= 40 && st.results.items.length === st.results.total;
    const names = facets.length ? facets : few ? st.results.items.map(i => i.scientificName) : [];
    if (!names.length) return st.results.total === 0 && st.status === 'ready' && (st.query.q || facets.length) ? [] : null;
    const key = names.join('|');
    if (this.#named?.key !== key) {
      const named = this.#named = { key, ids: /** @type {number[] | undefined} */ (undefined) };
      namesToTaxa(names).then(ids => { if (this.#named === named) { named.ids = ids; this.requestUpdate(); } });
    }
    return this.#named.ids;
  }
  /** @type {{ key: string, ids: number[] | undefined } | null} */ #named = null;

  /** The current plant's iNaturalist taxon (its points over a map of France or the world), found once by its name. */
  get #plantTaxon() {
    const s = /** @type {LayoutState} */ (this.state), id = s.live.plant;
    if (id == null || this.#p.plante === 'non') return null;
    const known = s.species?.byPlant.get(id)?.taxonId;
    if (known) return known;
    const sci = s.plantInfo?.id === id ? s.plantInfo.sci : null;
    if (!sci) return null;
    if (this.#plantNamed?.sci !== sci) {
      const named = this.#plantNamed = { sci, id: /** @type {number | null} */ (null) };
      taxonIdOf(sci).then(t => { if (this.#plantNamed === named) { named.id = t; this.requestUpdate(); } }, () => {});
    }
    return this.#plantNamed.id;
  }
  /** @type {{ sci: string, id: number | null } | null} */ #plantNamed = null;

  /** The tiles of a map of France or the world: its plants' observations, the current plant's on top (the same array while the same). */
  get #wideTiles() {
    const taxa = this.#wideTaxa();
    const when = periodQuery(this.state?.periode);
    const plant = this.#plantTaxon;
    const key = JSON.stringify([taxa, when, plant]);
    if (this.#tilesMemo?.key !== key) {
      // Still finding their taxa: none yet (never all plants for a moment); none found: the current plant's alone.
      const value = taxa === undefined ? [] : taxa !== null && !taxa.length ? inatTiles([], when, plant).filter(t => t.key === 'plant') : inatTiles(taxa, when, plant);
      this.#tilesMemo = { key, value };
    }
    return this.#tilesMemo.value;
  }
  /** @type {{ key: string, value: any[] } | null} */ #tilesMemo = null;

  /** The observation chosen (?o=), shown and flown to. */
  get #focus() {
    const s = /** @type {LayoutState} */ (this.state);
    const id = s.live.obs;
    if (!id) return null;
    if (this.#focusMemo?.id === id) return this.#focusMemo.value;
    const p = s.points.find(x => obsId(x.url) === id) ?? s.plantObs?.points.find(x => obsId(x.url) === id);
    if (!p) return null;
    const value = { coordinates: p.coordinates, title: /** @type {any} */ (p).title ?? s.plantInfo?.name ?? 'Observation', url: p.url, photo: /** @type {any} */ (p).photo ?? null };
    this.#focusMemo = { id, value };
    return value;
  }
  /** @type {{ id: string, value: any } | null} */ #focusMemo = null;

  /**
   * The cell's own layers (layers=znieff+n2000+ign:<id>), in their order: the overlays of gf-map, those of the
   * catalogue added to the maps first (core/ign.js) — one of IGN's whole catalogue not known on this device found in
   * it (core/ign-catalog.js), then shown. Never the Carte's shared choice: the layout is the same for everyone who
   * opens it. The same array while they are the same.
   */
  get #overlays() {
    const names = /** @type {string[]} */ (this.params?.layers ?? []);
    const k = names.join('+');
    if (this.#overlaysMemo?.k === k) return this.#overlaysMemo.value;
    for (const l of catalogLayers(names)) addCatalogLayer(/** @type {any} */ (l));
    const value = overlaysOf(names);
    const unknown = value.filter(key => !isOverlay(key)).map(key => key.slice('ign:'.length));
    if (unknown.length) {
      loadCatalog().then(c => {
        const found = (c.layers ?? []).filter(l => unknown.includes(l.id));
        for (const l of found) addCatalogLayer(l);
        if (found.length) { this.#overlaysMemo = null; this.requestUpdate(); }
      }, () => {});
    }
    this.#overlaysMemo = { k, value };
    return value;
  }
  /** @type {{ k: string, value: string[] } | null} */ #overlaysMemo = null;

  /** The overlays' opacity (opac=), by overlay; the same object while it is the same. */
  get #opacities() {
    const text = this.params?.opac ?? '';
    if (this.#opacMemo?.text !== text) this.#opacMemo = { text, value: opacitiesOf(text) };
    return this.#opacMemo.value;
  }
  /** @type {{ text: string, value: Record<string, number> } | null} */ #opacMemo = null;

  /**
   * The map's background, layers and their opacity changed on it (its panel « Carte »: gf-map `layers-change`): kept
   * in the layout (base=, layers= in their order, opac=). @param {CustomEvent} e
   */
  #onLayers(e) {
    const { base, overlays, opacities } = e.detail;
    this.#set({ base, layers: layersOf(overlays), opac: opacText(opacities ?? {}, overlays, DEFAULT_OPACITY) });
  }

  /**
   * « Observations autour » (the binoculars, in 3D: gf-map-obs3d.js) as the cell keeps them (jumelles=, jrayon=):
   * off when not written; their radius, else the nearest to the zone's. The same object while they are the same.
   */
  get #around3d() {
    const j = /** @type {string[] | null} */ (this.params?.jumelles ?? null);
    const radius = nearestStop(this.params?.jrayon ?? this.state?.radius ?? 2000, RADII_3D);
    const value = { on: j !== null, inat: j ? j.includes('inat') : true, gbif: j ? j.includes('gbif') : true, density: j ? j.includes('densite') : false, radius };
    const k = JSON.stringify(value);
    if (this.#aroundMemo?.k !== k) this.#aroundMemo = { k, value };
    return this.#aroundMemo.value;
  }
  /** @type {{ k: string, value: any } | null} */ #aroundMemo = null;

  /**
   * « Observations autour » changed on the map: kept in the layout — their radius only without a zone (with one, the
   * binoculars follow it: its circle, its radius). @param {CustomEvent} e
   */
  #onAround(e) {
    const p = e.detail;
    const zone = nearestStop(this.state?.radius ?? 2000, RADII_3D);
    this.#set({
      jumelles: p.on ? [p.inat && 'inat', p.gbif && 'gbif', p.density && 'densite'].filter(Boolean) : null,
      jrayon: p.on && !this.state?.live.at && p.radius !== zone ? p.radius : null
    });
  }

  /** The view it starts on (vue=), read; the same object while it is the same. */
  get #view() {
    const text = this.params?.vue ?? '';
    if (this.#viewMemo?.text !== text) this.#viewMemo = { text, value: viewOf(text) };
    return this.#viewMemo.value;
  }
  /** @type {{ text: string, value: import('./map-options.js').MapView | null } | null} */ #viewMemo = null;

  /**
   * The map moved by hand: the list kept to what it shows (liste=vue: state.js setView) — in « Créer une app », the
   * view it starts on too (vue=). @param {CustomEvent} e
   */
  #onView(e) {
    if (this.building) this.#set({ vue: viewText(e.detail) });
    if (this.#leads && e.detail.bounds) this.state?.setView(e.detail.bounds, { kinds: this.#p.src, by: this });
  }

  /**
   * The map framed by itself: on the zone (bounds null) — the list it led back to the whole zone —, or on the view it
   * was given (vue=): the list kept to it, unless another map leads it. @param {CustomEvent} e
   */
  #onFramed(e) {
    const s = this.state, bounds = e.detail.bounds;
    if (!s) return;
    if (!bounds) { if (s.view?.by === this) s.setView(null); }
    else if (this.#leads && (!s.view || s.view.by === this)) s.setView(bounds, { kinds: this.#p.src, by: this });
  }

  /** It leads the list (what it shows of the zone, once moved): a map of the zone (portee=zone), liste=vue, a zone. */
  get #leads() { return this.#p.portee === 'zone' && this.params?.liste !== 'zone' && Boolean(this.state?.live.at); }

  /** The cell's map (gf-map: what the cell says goes through it — the quiet-map rule). @returns {any} */
  get #map() { return this.renderRoot.querySelector('gf-map'); }

  /**
   * A point touched: its plant, the current one (with this observation) — or its sheet opened (toucher=fiche); one not
   * in the flora: a brief toast. @param {CustomEvent} e
   */
  #onPick(e) {
    const s = /** @type {LayoutState} */ (this.state);
    const p = e.detail.point;
    // Its plant: by its taxon (iNaturalist's), else its name, else the plant it was drawn for (the current one's points).
    const id = (s.species ? plantOfPoint(s.species.plantOf, p) : undefined) ?? p.plantId ?? undefined;
    if (id == null) { this.#map?.toast(`${p.common || p.sci || p.title || 'Cette plante'} : pas dans la flore de France de GeoFlora.`); return; }
    if (this.#p.toucher === 'fiche') { pushHash(href.plant(id)); return; }
    s.pick(id, { obs: p.url ? obsId(p.url) : null });
  }

  /** A point under the mouse, or none (gf-map `point-hover`): its plant's row lit in the lists (state.js hover). @param {CustomEvent} e */
  #onHover(e) {
    const s = /** @type {LayoutState} */ (this.state);
    const p = e.detail.point;
    const id = p ? this.#plantOf(p) ?? p.plantId ?? null : null;
    if (id == null) s.hoverOff(null, 'map');
    else s.hoverOn(id, 'map');
  }

  /**
   * A plant hovered in a list (state.js hover): its points lit as the map's own hover lights them — set on the map,
   * the cell not drawn again. Hovered on a map: that map lights it itself.
   */
  #lightHovered() {
    const map = this.#map, h = this.state?.hover;
    if (!map) return;
    const keys = h?.from === 'list' ? this.#keysOf(h.plant) : null;
    map.litKeys = keys?.size ? keys : null;
  }

  /**
   * A plant's points on the map, by their kin keys (map-style.js speciesKey: a plant's points may carry more than one
   * name): its observations in the zone, and the current plant's own. @param {number} plant @returns {Set<string>}
   */
  #keysOf(plant) {
    const s = /** @type {LayoutState} */ (this.state);
    /** @type {Set<string>} */
    const keys = new Set();
    for (const p of this.#area?.points ?? []) {
      const key = this.#plantOf(p) === plant ? speciesKey(p) : null;
      if (key) keys.add(key);
    }
    const hl = this.#highlight;
    if (hl && s.plantInfo?.id === plant) keys.add(speciesKey(hl) || 'hl');
    return keys;
  }

  /**
   * A long press on the map, a place picked in its address search: the scope moves there — named as the search named
   * it, else its place's name found after. @param {CustomEvent} e
   */
  #onPress(e) {
    const s = /** @type {LayoutState} */ (this.state);
    const at = /** @type {[number, number]} */ (e.detail.coordinates);
    const label = typeof e.detail.label === 'string' && e.detail.label.trim() ? e.detail.label.trim() : null;
    s.setScope(at, label);
    if (!label) nameScope(s, /** @type {[number, number]} */ (s.live.at));
  }

  /** « Autour de moi »: the scope around the position. @param {import('./state.js').How} [how] */
  async #locate(how = 'push') {
    const s = /** @type {LayoutState} */ (this.state);
    this._busy = true;
    try { const at = await locateOnce(); s.setScope(at, null, how); nameScope(s, /** @type {[number, number]} */ (s.live.at)); }
    // Asked, no position: one brief toast over the map.
    catch (error) { this.#map?.toast(/** @type {Error} */ (error).message); }
    finally { this._busy = false; }
  }

  /**
   * The map's own scope (lieu=, autour), when the address has none: the place found as ?place= is (state.js), or
   * « Autour de moi » — once for each (a scope taken off afterwards, ✕, stays off). The address' always wins.
   */
  #defaultScope() {
    const s = /** @type {LayoutState} */ (this.state);
    const lieu = this.params?.lieu ?? null, autour = Boolean(this.params?.autour);
    const want = lieu ? 'lieu:' + lieu : autour ? 'autour' : '';
    if (!want || s.defaultedFor === want) return;
    s.defaultedFor = want;
    if (s.live.at || s.live.place) return;
    if (lieu) s.set({ place: lieu, obs: null }, 'replace');
    else this.#locate('replace');
  }

  /** The long press's first-use hint (core/hints.js: the first layout map without a zone ever), until its ✕. @type {boolean | undefined} */
  #pressHint;

  /** The map's 3D as written (3d=1, 3d=0) or switched, last told to its 3D adapter. @type {boolean | null | undefined} */
  #was3d;

  /**
   * What the scope says, through the map (the quiet-map rule): its plants coming — the map's thin line past 400 ms;
   * counted — said once (the results' header writes it); unreachable or off — the map's state (its panel's « État »).
   */
  updated() {
    const s = this.state, map = this.#map;
    const ctl = this.#ctl;
    this.setAttribute('ui', this.#p.ui);
    this.setAttribute('ctl', [...ctl.on].join(' '));
    this.toggleAttribute('ctl-compact', ctl.compact);
    this.toggleAttribute('big-gps', this.params?.intent === 'terrain' && ctl.on.has('gps'));
    if (!s || !map) return;
    this.#defaultScope();
    // No longer leading the list (liste=zone, France or the world now): it shows the whole zone again.
    if (s.view?.by === this && !this.#leads) s.setView(null);
    // The zone moved while building: the view kept was the old zone's — framed on the new one.
    const zone = s.live.at ? s.live.at.join(',') + ':' + s.radius : '';
    if (this.building && this.params?.vue && this.#zoneWas !== undefined && zone !== this.#zoneWas) this.#set({ vue: null });
    this.#zoneWas = zone;
    const d3 = this.#d3;
    if (d3 !== this.#was3d) { if (this.#was3d !== undefined) map.gl?.recheck(); this.#was3d = d3; }
    map.busy('scope', Boolean(s.live.at) && s.speciesState === 'loading', 'Plantes de la zone : recherche');
    map.setStatus('scope', s.live.at && s.speciesState === 'error' ? s.speciesError : '', { level: 'warn' });
    // A source of the zone that failed, the others shown (core/observations.js): said on the map — every one failing
    // is the scope's error above.
    const partial = s.live.at && s.speciesState === 'ready' && s.failed.length ? s.failed : [];
    map.setStatus('sources', partial.length ? `${failedText(partial)} : ${partial.length > 1 ? 'leurs' : 'ses'} observations manquent sur la carte et dans la liste.` : '', { level: 'warn' });
    const said = s.live.at && s.speciesState !== 'loading' && s.speciesState !== 'error' ? scopeNote(s) : '';
    if (said && said !== this.#said) map.announce(said);
    this.#said = said;
    this.#placeControls();
    // Once the map's own controls are drawn (a frame later: a rebuilt search pill, the 3D map's controls).
    requestAnimationFrame(() => this.#placeControls());
  }
  #said = '';
  /** The zone at the last update (undefined: none yet). @type {string | undefined} */ #zoneWas;

  /**
   * The controls placed around the map's own, whose number and size vary (measured): top right under its buttons;
   * bottom left over its zoom and scale, bottom right over its credits (MapLibre's controls in 3D); on a narrow map,
   * bottom left over bottom right, never on it.
   */
  #placeControls() {
    const stage = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.stage')), map = this.#map;
    const buttons = map?.querySelector('.gf-map-buttons');
    if (!stage || !buttons) return;
    const box = stage.getBoundingClientRect();
    if (!box.height) return;
    const set = (/** @type {string} */ name, /** @type {number} */ px) => { if (stage.style.getPropertyValue(name) !== px + 'px') stage.style.setProperty(name, px + 'px'); };
    const shown = [...buttons.children].filter(b => !(/** @type {HTMLElement} */ (b).hidden) && b.getBoundingClientRect().height > 0);
    set('--tr-top', shown.length ? Math.round(shown[shown.length - 1].getBoundingClientRect().bottom - box.top + 8) : map.hasAttribute('search') ? 66 : 8);
    const in3d = map.dataset.renderer === '3d';
    /** The height a corner of the map's own controls takes from the bottom. @param {string} sel */
    const corner = sel => {
      const kids = [...(map.querySelector(sel)?.children ?? [])].map(k => k.getBoundingClientRect()).filter(r => r.height > 0);
      return kids.length ? Math.max(0, Math.round(box.bottom - Math.min(...kids.map(r => r.top)))) : 0;
    };
    let right = Math.max(20, corner(in3d ? '.maplibregl-ctrl-bottom-right' : '.leaflet-bottom.leaflet-right')) + 6;
    let left = Math.max(30, corner(in3d ? '.maplibregl-ctrl-bottom-left' : '.leaflet-bottom.leaflet-left')) + 8;
    const br = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.br'));
    const bl = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.bl'));
    // In 3D, « Observations autour » (bottom middle, over the credits — taller on a narrow phone): the right corner's
    // controls above its chip when they would reach over it, never covering it.
    const o3 = in3d ? map.querySelector('.gf-o3-bar:not([hidden])')?.getBoundingClientRect() : null;
    if (o3?.height && br && o3.right > box.right - 8 - br.offsetWidth) right = Math.max(right, Math.round(box.bottom - o3.top) + 6);
    // Too narrow for both side by side: the bottom left's over the bottom right's.
    if (br && bl && bl.offsetWidth + br.offsetWidth + 24 > box.width) left = Math.max(left, right + br.offsetHeight + 8);
    set('--br-bottom', right);
    set('--bl-bottom', left);
  }

  /** The current plant: none (✕). */
  #unpick() { /** @type {LayoutState} */ (this.state).set({ plant: null, obs: null }, 'push'); }

  /** The other background shown (its thumbnail touched): kept in the layout (base=). */
  #switchBase() {
    const shown = /** @type {'photo' | 'plan'} */ (this.#map?.baseShown ?? this.params?.base ?? 'photo');
    this.#set({ base: OTHER_BASE[shown]?.key ?? 'plan' });
  }

  /** The current plant's photo: the scope's (iNaturalist), else the one at hand, else found (once) — null: a flower. @param {number} id */
  #thumbOf(id) {
    const sp = /** @type {LayoutState} */ (this.state).species?.byPlant.get(id);
    if (sp?.photo && !this.#badThumbs.has(sp.photo)) return sp.photo;
    const known = cachedThumb(id);
    if (known !== undefined) return known && !this.#badThumbs.has(known) ? known : null;
    if (this._thumb?.id === id) return this._thumb.url && !this.#badThumbs.has(this._thumb.url) ? this._thumb.url : null;
    if (this.#thumbAsked !== id) {
      this.#thumbAsked = id;
      thumbUrl(id).then(url => { if (this.state?.live.plant === id) this._thumb = { id, url }; });
    }
    return null;
  }
  /** @type {number | null} */ #thumbAsked = null;
  /** Photos that did not load (offline, gone): the flower instead. @type {Set<string>} */ #badThumbs = new Set();

  /** The zone: its panel (complete), or its pill « 2 km ▾ » (compact) — its words, its radius, « Autour de moi » (gps). @param {LayoutState} s @param {{ on: Set<string>, compact: boolean }} ctl */
  #zoneView(s, ctl) {
    const low = ctl.on.has('lieu');
    const around = ctl.on.has('gps') ? html`<div class="row"><button type="button" class=${this._busy ? 'busy' : ''} ?disabled=${this._busy} aria-busy=${String(this._busy)}
      title="Autour de moi" @click=${() => this.#locate()}>${icon('geo-alt')} <span class="words">Autour de moi</span></button></div>` : nothing;
    if (!ctl.compact) {
      return html`<div class="panel ${low ? '' : 'top'}" role="group" aria-label="Zone de la disposition">
        ${where(s)}
        ${s.live.at ? radiusSlider(s) : nothing}
        ${around}
      </div>`;
    }
    const failed = Boolean(s.placeError && !s.live.at);
    const label = s.live.at ? distanceLabel(s.radius) : failed ? 'Lieu introuvable' : 'Zone';
    return html`<div class="zone ${low ? 'low' : ''}" role="group" aria-label="Zone de la disposition">
      <button type="button" class=${failed ? 'error' : ''} aria-expanded=${String(this._zone)} aria-controls="zone-drop" title=${scopeWords(s)}
        @click=${() => { this._zone = !this._zone; }}>${failed ? icon('exclamation-triangle-fill') : nothing}${label} ${icon('caret-down-fill')}</button>
      ${failed && !this._zone ? html`<span class="visually-hidden" role="alert">${scopeWords(s)}</span>` : nothing}
      ${this._zone ? html`<div class="drop" id="zone-drop">
        ${where(s)}
        ${s.live.at ? html`<div class="stops" role="group" aria-label="Rayon de la zone">${DISTANCES.map(m => html`<button type="button" aria-pressed=${String(m === s.radius)}
          @click=${() => { s.set({ r: m }, 'replace'); this._zone = false; }}>${distanceLabel(m)}</button>`)}</div>` : nothing}
        ${around}
      </div>` : nothing}
    </div>`;
  }

  /**
   * Top right, under the map's own buttons: the 2D / 3D switch, the other background's thumbnail — and, in « Créer une
   * app » once the map was moved (vue=), « Recadrer sur la zone ». @param {Set<string>} on
   */
  #topRight(on) {
    const reframe = this.building && Boolean(this.params?.vue);
    if (!on.has('3d') && !on.has('fond') && !reframe) return nothing;
    const map = this.#map;
    const in3d = this.#d3 ?? Boolean(map?.gl?.wanted);
    const other = OTHER_BASE[/** @type {'photo' | 'plan'} */ (map?.baseShown ?? this.params?.base ?? 'photo')] ?? OTHER_BASE.photo;
    return html`<div class="ctl tr">
      ${on.has('3d') ? html`<button type="button" class="round" aria-pressed=${String(in3d)} aria-label="Vue 3D" title=${in3d ? 'Vue 3D (repasser en 2D)' : 'Vue 3D'}
        @click=${() => this.#set({ '3d': !in3d })}>3D</button>` : nothing}
      ${reframe ? html`<button type="button" class="round" data-act="reframe" aria-label="Recadrer sur la zone" title="Recadrer sur la zone (la carte part alors de la zone)"
        @click=${() => this.#set({ vue: null })}>${icon('crosshair')}</button>` : nothing}
      ${on.has('fond') ? html`<button type="button" class="base ${other.key}" aria-label=${'Fond : ' + other.words} title=${'Passer à ' + other.words}
        @click=${() => this.#switchBase()}><span>${other.label}</span></button>` : nothing}
    </div>`;
  }

  /** Bottom left, over the zoom: the current plant's chip, the legend. @param {LayoutState} s @param {Set<string>} on */
  #bottomLeft(s, on) {
    const id = s.live.plant, info = s.plantInfo;
    const chip = on.has('plante') && id != null && info?.id === id;
    if (!chip && !on.has('legende')) return nothing;
    return html`<div class="ctl bl">
      ${chip ? this.#chip(id, /** @type {{ name: string }} */ (info).name) : nothing}
      ${on.has('legende') ? this.#legendView(s) : nothing}
    </div>`;
  }

  /** The current plant on the map: its photo and name (its sheet ↗), « Seule » (its points alone), ✕. @param {number} id @param {string} name */
  #chip(id, name) {
    const photo = this.#thumbOf(id);
    const only = this.#p.plante === 'seule';
    return html`<div class="chip" role="group" aria-label=${'Plante courante : ' + name}>
      <a class="open" href=${href.plant(id)} data-open aria-label=${'Ouvrir la fiche : ' + name} title=${'Ouvrir la fiche : ' + name}>${photo
        ? html`<img src=${photo} alt="" decoding="async" @error=${() => { this.#badThumbs.add(photo); this.requestUpdate(); }} />` : html`<span class="ph" aria-hidden="true">${icon('flower1')}</span>`}<span class="name">${name}</span>${icon('box-arrow-up-right')}</a>
      <button type="button" aria-pressed=${String(only)} title="Seulement ses observations sur cette carte" @click=${() => this.#set({ plante: only ? 'grand' : 'seule' })}>Seule</button>
      <button type="button" aria-label="Aucune plante courante" title="Aucune plante courante" @click=${() => this.#unpick()}>${icon('x-lg')}</button>
    </div>`;
  }

  /** The legend: what the map's marks and the cell's layers are, its lines once opened. @param {LayoutState} s */
  #legendView(s) {
    const layers = /** @type {string[]} */ (this.params?.layers ?? []);
    const plant = s.live.plant != null && s.plantInfo?.id === s.live.plant && this.#p.plante !== 'non' ? s.plantInfo.name : null;
    const open = this.params?.legende === true;
    return html`<div class="legend">
      <button type="button" aria-expanded=${String(open)} aria-controls="map-legend" @click=${() => this.#set({ legende: !open })}>Légende</button>
      ${open ? html`<ul id="map-legend" aria-label="Légende de la carte">
        ${s.live.at ? html`<li><i class="outline"></i>La zone (${distanceLabel(s.radius)})</li>` : nothing}
        <li><i></i>Observations des plantes trouvées</li>
        ${plant ? html`<li><i class="obs"></i>${plant} : ses observations</li>` : nothing}
        ${layers.map(l => html`<li><i class="area"></i>${MAP_LAYERS[l]?.label ?? l}</li>`)}
      </ul>` : nothing}
    </div>`;
  }

  /**
   * Bottom right, over the credits: the period's chips (when=), the count — the points shown, the plants found in the
   * scope —, which opens the map's « État ». @param {LayoutState} s @param {{ on: Set<string>, compact: boolean }} ctl
   * @param {{ points: any[] } | null} area
   */
  #bottomRight(s, ctl, area) {
    const period = ctl.on.has('periode'), count = ctl.on.has('compte') && (Boolean(s.live.at) || this.#p.portee !== 'zone');
    if (!period && !count) return nothing;
    const when = this.#p.when;
    // The plants of the zone, even while the list keeps to what a map shows of it.
    const results = this.#store.state.results;
    const n = area?.points.length ?? 0, k = results.inZone?.length ?? results.total;
    const wide = this.#p.portee !== 'zone';
    const words = wide ? counted(k, 'espèce') : `${counted(n, 'observation')} · ${counted(k, 'espèce')}`;
    return html`<div class="ctl br">
      ${period ? html`<div class="period" role="group" aria-label="Période des observations">${PERIODS.map(([v, label]) => html`<button type="button"
        aria-pressed=${String(when === v)} @click=${() => s.set({ periode: v === s.defaultPeriode ? null : /** @type {any} */ (v) }, 'replace')}>${label}</button>`)}</div>` : nothing}
      ${count ? html`<button type="button" class="count" aria-label=${words + ' — état de la carte'} title="État de la carte"
        @click=${() => this.#map?.openPanel()}>${ctl.compact ? (wide ? k : n).toLocaleString('fr-FR') : words}</button>` : nothing}
    </div>`;
  }

  render() {
    const s = this.state;
    if (!s) return nothing;
    if (!s.live.at && this.#pressHint === undefined) this.#pressHint = takeHint('layout-map-press');
    const P = this.#p, d3 = this.#d3, ctl = this.#ctl, on = ctl.on;
    // France, the world (portee=): their plants' observations in tiles; the zone's circle (where it is), never framed.
    const wide = P.portee !== 'zone';
    const press = 'Appui long sur la carte : la zone s’y centre.';
    const hl = P.plante === 'non' ? null : this.#highlight;
    // regroupe: the current plant's observations grouped by where they fall at the zoom shown (gf-map `cluster`).
    const grouped = Boolean(this.params?.regroupe);
    const zoneArea = this.#area;
    const area = wide ? (zoneArea ? { center: zoneArea.center, radius: zoneArea.radius, fit: false, points: [] } : null) : zoneArea;
    const why2d = d3 !== false ? nothing : 'Cette carte de la disposition reste en 2D (3d=0 dans son adresse, ou sa bascule 2D / 3D ; le choix vaut pour elle seule).';
    return html`${!s.live.at && this.#pressHint ? hintView(press, () => { this.#pressHint = false; this.requestUpdate(); }, 'press-hint') : nothing}
      <div class="stage"><gf-map no-create point-click=${P.toucher === 'rien' ? 'none' : 'pick'} map-3d=${d3 === null ? nothing : d3 ? 'on' : 'off'}
        map-3d-why=${why2d}
        .base=${this.params?.base ?? 'photo'} .overlays=${this.#overlays} .opacities=${this.#opacities} .around3d=${this.#around3d} .view=${this.#view}
        .area=${area} .highlight=${wide || grouped ? null : hl} .cluster=${!wide && grouped ? hl : null}
        .tiles=${wide ? this.#wideTiles : null} .frame=${wide && !this.#view ? { key: P.portee, points: WIDE_FRAMES[P.portee] } : null}
        min-zoom=${P.portee === 'monde' ? 1 : nothing}
        .focusPoint=${this.#focus} .noSearch=${!on.has('lieu')} .noLocate=${!on.has('gps')} .noLayers=${!on.has('couches')} .track=${Boolean(this.params?.autour)}
        .radiusHandle=${!wide && on.has('rayon') ? this.#radiusHandle : null}
        aria-description=${press}
        @point-pick=${(/** @type {CustomEvent} */ e) => this.#onPick(e)} @point-info=${(/** @type {CustomEvent} */ e) => this.#onPress(e)}
        @point-hover=${(/** @type {CustomEvent} */ e) => this.#onHover(e)}
        @radius-change=${(/** @type {CustomEvent} */ e) => s.set({ r: e.detail.radius }, 'replace')}
        @layers-change=${(/** @type {CustomEvent} */ e) => this.#onLayers(e)} @around3d-change=${(/** @type {CustomEvent} */ e) => this.#onAround(e)}
        @view-change=${(/** @type {CustomEvent} */ e) => this.#onView(e)} @view-framed=${(/** @type {CustomEvent} */ e) => this.#onFramed(e)}
        @base-shown=${() => this.requestUpdate()}></gf-map>
      ${!wide && on.has('rayon') ? this.#zoneView(s, ctl) : nothing}
      ${this.#topRight(on)}
      ${this.#bottomLeft(s, on)}
      ${this.#bottomRight(s, ctl, area)}</div>`;
  }
}
customElements.define('dl-map', DlMap);

// ── place ────────────────────────────────────────────────────────────────────────────────────────────────────

export class DlPlace extends LitElement {
  static properties = { state: { attribute: false }, _busy: { state: true }, _error: { state: true } };

  // Positioned: what it places absolutely (the slider's hidden label) scrolls with it — placed by the cell instead, it
  // stood below the cell's edge when the zone holds more than the cell's height, and the cell (which clips) overflowed.
  static styles = [ui, scopeStyles, css`
    :host { display: block; position: relative; overflow-y: auto; padding: 10px 12px; }
    .box { display: grid; gap: 10px; }
    .primary { justify-self: start; }
  `];


  constructor() {
    super();
    new StateController(this);
    /** @type {LayoutState | null} */ this.state = null;
    this._busy = false;
    /** @type {string | null} */ this._error = null;
  }

  async #locate() {
    const s = /** @type {LayoutState} */ (this.state);
    this._busy = true; this._error = null;
    try { const at = await locateOnce(); s.setScope(at, null); nameScope(s, /** @type {[number, number]} */ (s.live.at)); }
    catch (error) { this._error = /** @type {Error} */ (error).message; }
    finally { this._busy = false; }
  }

  render() {
    const s = this.state;
    if (!s) return nothing;
    const note = this._error || scopeNote(s);
    return html`<div class="box">
      ${where(s)}
      <button class="primary" type="button" ?disabled=${this._busy} @click=${() => this.#locate()}>${icon('geo-alt-fill')} ${this._busy ? 'Localisation…' : 'Autour de moi'}</button>
      <gf-place-search label="Choisir une commune pour la zone" @place-pick=${(/** @type {CustomEvent} */ e) => s.setScope(e.detail.coordinates, e.detail.label || null)}></gf-place-search>
      ${s.live.at ? radiusSlider(s) : nothing}
      ${note ? html`<p class="note ${this._error || s.speciesState === 'error' ? 'error' : ''}" role="status">${note}</p>` : nothing}
    </div>`;
  }
}
customElements.define('dl-place', DlPlace);

// ── results ──────────────────────────────────────────────────────────────────────────────────────────────────

/** A results pane narrower than this: cards instead of the grid (as Flore). */
const GRID_MIN = 560;

export class DlResults extends LitElement {
  static properties = { state: { attribute: false }, params: { attribute: false }, channel: { attribute: false }, _wide: { state: true } };

  static styles = [ui, css`
    :host { display: flex; flex-direction: column; min-height: 0; }
    gf-plant-list { flex: 1; min-height: 0; }
    .scope { flex: none; display: flex; align-items: center; gap: 6px; padding: 4px 12px; font-size: 0.78rem; color: var(--gf-text-muted); border-bottom: 1px solid var(--gf-border); background: var(--gf-bg); }
    .scope span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .scope.error { color: var(--gf-danger); }
    .scope button { min-height: 0; padding: 0; }
  `];

  #size = new ResizeObserver(([e]) => { const wide = e.contentRect.width >= GRID_MIN; if (wide !== this._wide) this._wide = wide; });
  /** Its group's search: its results kept to what a map shows of the zone, said (inZone). */
  #store = new SearchController(this);

  constructor() {
    super();
    // A plant hovered (a map's point, a row): its row lit.
    new StateController(this, { hover: () => this.requestUpdate() });
    /** @type {LayoutState | null} */ this.state = null;
    /** The search of its group (core/search-channel.js); none: the app's. @type {import('../core/search-channel.js').Channel | null} */ this.channel = null;
    /** @type {Record<string, any>} */ this.params = {};
    this._wide = false;
  }

  connectedCallback() { super.connectedCallback(); this.#size.observe(this); }

  /** Shown as a grid now (view=grid, or auto and wide): its cell's head says so (gf-layout.js, its list / grid switch). */
  get grid() { const v = this.params?.view ?? 'auto'; return v === 'grid' || (v === 'auto' && this._wide); }

  /** @param {Map<string, any>} changed */
  updated(changed) { if (changed.has('_wide')) this.dispatchEvent(new CustomEvent('results-shown', { bubbles: true, composed: true })); }
  disconnectedCallback() { super.disconnectedCallback(); this.#size.disconnect(); }

  render() {
    const s = this.state;
    if (!s) return nothing;
    const grid = this.grid;
    // zone=0: the search over the whole flora, whatever the zone (state.js#wholeOf, asked by the layout), said so.
    if (this.params.zone === false) {
      const whole = s.whole;
      return html`${s.live.at ? html`<div class="scope" role="note">${icon('globe-europe-africa')}<span>Toute la France : cette case ne suit pas la zone.</span></div>` : nothing}
        <gf-plant-list ?grid=${grid} .current=${s.live.plant} .items=${whole?.items ?? []} .channel=${this.channel}
          .lit=${s.hover?.plant ?? null} @plant-hover=${(/** @type {CustomEvent} */ e) => this.#onHover(e)}></gf-plant-list>`;
    }
    const note = s.live.at ? scopeNote(s) : '';
    // Kept to what a map shows of the zone (moved by hand: state.js setView): said, with the way back.
    const results = this.#store.state.results;
    const zoneOf = s.live.at && results.inZone ? results.inZone.length : null;
    return html`${s.live.at ? html`<div class="scope ${s.speciesState === 'error' ? 'error' : ''}" role="status">${icon('crosshair')}<span title=${note}>${scopeWords(s)} · ${note}</span>
        <button class="link" type="button" @click=${() => s.setScope(null)}>Toute la France</button></div>` : nothing}
      ${zoneOf !== null ? html`<div class="scope view" role="status">${icon('map')}<span>Dans la vue de la carte : ${counted(results.total, 'plante')} sur ${zoneOf.toLocaleString('fr-FR')}</span>
        <button class="link" type="button" @click=${() => s.wholeZone()}>Toute la zone</button></div>` : nothing}
      <gf-plant-list ?grid=${grid} .current=${s.live.plant} .channel=${this.channel} .obs=${this.#obs(s)}
        .empty=${zoneOf !== null ? 'Rien d’observé dans ce que montre la carte : déplacez-la, ou voyez toute la zone.' : null}
        .lit=${s.hover?.plant ?? null} @plant-hover=${(/** @type {CustomEvent} */ e) => this.#onHover(e)}></gf-plant-list>`;
  }

  /** A row hovered, or no more (gf-plant-card `plant-hover`): the maps beside light its plant's points (state.js hover). @param {CustomEvent} e */
  #onHover(e) {
    const { id, on } = e.detail;
    if (on) this.state?.hoverOn(id, 'list');
    else this.state?.hoverOff(id, 'list');
  }

  /**
   * Each plant's observations in the zone, in words (core/observations.js obsNotes: its rows say them, its grid has their
   * column): the same Map while they are the same; none without a zone. @param {LayoutState} s
   */
  #obs(s) {
    const c = s.live.at ? s.obsCounts : null;
    if (this.#obsFor !== c) { this.#obsFor = c; this.#obsMemo = c ? obsNotes(c.counts, c.sources) : null; }
    return this.#obsMemo;
  }
  /** @type {LayoutState['obsCounts']} */ #obsFor = null;
  /** @type {ReturnType<typeof obsNotes> | null} */ #obsMemo = null;
}
customElements.define('dl-results', DlResults);

// ── search ───────────────────────────────────────────────────────────────────────────────────────────────────

export class DlSearch extends LitElement {
  static properties = { state: { attribute: false }, params: { attribute: false }, channel: { attribute: false }, _filters: { state: true } };

  /* A cell lower than its bar (a narrow one, where the bar folds onto more lines; a short row: « Étude », « Grille et
     photos » at 720 px, or on a phone): the cell scrolls, never cuts the bar's last lines (the chips, « Filtrer par »)
     out of reach — the cell around it clips. Below the bar, the filters opened and the list keep a little room of
     their own (reached by scrolling the cell), never squeezed to nothing under a tall bar. */
  static styles = [ui, css`
    :host { display: flex; flex-direction: column; min-height: 0; overflow-y: auto; }
    gf-results-bar { flex: none; }
    .filters { flex: none; max-height: 45%; overflow-y: auto; padding: 0 12px; border-bottom: 1px solid var(--gf-border); background: var(--gf-surface); }
    :host([no-list]) .filters { flex: 1; max-height: none; min-height: 8rem; }
    dl-results { flex: 1; min-height: 8rem; }
  `];

  constructor() {
    super();
    new StateController(this);
    /** @type {LayoutState | null} */ this.state = null;
    /** The search of its group (core/search-channel.js); none: the app's. @type {import('../core/search-channel.js').Channel | null} */ this.channel = null;
    /** @type {Record<string, any>} */ this.params = {};
    /** @type {boolean | null} the filters brought into view by a column's funnel, until the cell's parameter says it (null: as it says) */
    this._filters = null;
  }

  /** A facet brought into view (a column's funnel in a list): the filters opened on it. @param {string} facet */
  async revealFacet(facet) {
    this._filters = true;
    if (!this.params.filters) setCell(this, { filters: true });
    await this.updateComplete;
    return revealFacet(this.renderRoot.querySelector('gf-filter-panel'), facet);
  }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) { if (changed.has('params')) this._filters = null; }

  updated() { this.toggleAttribute('no-list', this.params.list === false); }

  render() {
    const open = this._filters ?? Boolean(this.params.filters);
    const list = this.params.list !== false;
    return html`<gf-results-bar .wide=${false} count-above .channel=${this.channel} @open-filters=${(/** @type {Event} */ e) => { e.stopPropagation(); this._filters = !open; setCell(this, { filters: !open }); }}></gf-results-bar>
      ${open ? html`<div class="filters" role="region" aria-label="Filtres">${filterPanel(this.state, this.channel)}</div>` : nothing}
      ${list ? html`<dl-results .state=${this.state} .params=${{ view: 'auto' }} .channel=${this.channel}></dl-results>` : nothing}`;
  }
}
customElements.define('dl-search', DlSearch);

/**
 * The filters of a layout's search: Flore's (gf-filter-panel), « Observations de la zone » first when its group has a
 * zone (obs-filters.js: where its observations come from, which of them count). @param {LayoutState | null} state
 * @param {import('../core/search-channel.js').Channel | null} channel
 */
const filterPanel = (state, channel) => {
  const zone = Boolean(state?.live.at);
  return html`<gf-filter-panel .channel=${channel} .lead=${zone ? 1 : 0}>${zone ? html`<dl-obs-filters slot="lead" .state=${state}></dl-obs-filters>` : nothing}</gf-filter-panel>`;
};

/** A filter of a filters panel opened and scrolled to, flashing a moment. @param {Element | null} panel @param {string} facet */
export async function revealFacet(panel, facet) {
  await /** @type {any} */ (panel)?.updateComplete;
  const el = /** @type {any} */ (panel?.shadowRoot?.querySelector(`gf-facet[name="${facet}"]`));
  if (!el) return false;
  await el.reveal();
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1200);
  return true;
}

// ── deck ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Rencontres' deck (ma-deck) asks a « session » for its cards and a few things more (kit/session.js): this one gives
 * the plants found in the scope, the current plant on top; a heart puts it in the favourites; the swipes are this
 * screen's (forgotten when it goes).
 */
class DeckSession extends EventTarget {
  constructor() {
    super();
    /** @type {Card[]} */ this.cards = [];
    /** @type {number | null} */ this.top = null;
    /** @type {{ matches: number[], passed: number[], radius: number }} */ this.c = { matches: [], passed: [], radius: 0 };
    /** @type {{ id: number, liked: boolean, fav: boolean }[]} */ this.history = [];
    this.burst = 0;
    this.hinted = false;
  }

  changed() { this.dispatchEvent(new Event('change')); }
  /** The cards not swiped, the current plant first. */
  get deck() {
    const left = this.cards.filter(c => !this.c.passed.includes(c.plant.id) && !this.c.matches.includes(c.plant.id));
    const i = left.findIndex(c => c.plant.id === this.top);
    return i > 0 ? [left[i], ...left.slice(0, i), ...left.slice(i + 1)] : left;
  }
  get matchCards() { return this.cards.filter(c => this.c.matches.includes(c.plant.id)); }
  hintOnce() { if (this.hinted) return false; this.hinted = true; return true; }
  /** No Wikipédia sentence on these cards (their sheet is beside). @returns {null} */
  ethnoOf() { return null; }
  /** @type {(m: number) => void} */ widen = () => {};
  resetPassed() { this.c = { ...this.c, passed: [] }; this.changed(); }
}

/** Cards past this many results are not made (the deck is a walk through the first ones). */
const DECK_MAX = 60;

export class DlDeck extends LitElement {
  static properties = { state: { attribute: false }, params: { attribute: false }, channel: { attribute: false }, _loading: { state: true } };

  static styles = [ui, css`
    :host { display: block; overflow-y: auto; padding: 12px 8px; container-type: size; --deck-max: calc(100cqh - 150px); --deck-min: 220px; }
    .empty { display: grid; gap: 10px; justify-items: center; padding: 24px 12px; text-align: center; color: var(--gf-text-muted); }
    .empty .big { font-size: 2rem; color: var(--gf-accent); margin: 0; }
    .empty .big.warn { color: var(--gf-warn, #b45309); }
  `];

  #store = new SearchController(this);
  #session = new DeckSession();
  /** Plant records read for the cards, by id. @type {Map<number, any>} */
  #plants = new Map();
  #cardsFor = '';

  constructor() {
    super();
    new StateController(this);
    /** @type {LayoutState | null} */ this.state = null;
    /** The search of its group (core/search-channel.js); none: the app's. @type {import('../core/search-channel.js').Channel | null} */ this.channel = null;
    /** @type {Record<string, any>} */ this.params = {};
    this._loading = false;
    this.#session.widen = m => this.state?.set({ r: m }, 'replace');
    this.#session.addEventListener('change', () => this.requestUpdate());
    this.addEventListener('deck-decide', e => this.#decide(/** @type {CustomEvent} */ (e).detail));
    // A card touched, as the cell says (toucher, ecrit: registry.js#touchOf): the current plant, its sheet, or nothing.
    this.addEventListener('deck-open', e => {
      e.stopPropagation();
      const id = /** @type {CustomEvent} */ (e).detail.id;
      const touch = this.params?.toucher === 'rien' ? 'rien' : this.params?.toucher === 'fiche' || !this.#writes ? 'fiche' : 'plante';
      if (touch === 'plante') this.state?.pick(id);
      else if (touch === 'fiche') pushHash(href.plant(id));
    });
    this.addEventListener('deck-undo', e => { e.stopPropagation(); this.#undo(); });
  }

  /** The deck changes the current plant (its swipes, its first card): not with ecrit=0 — its cards then go their own way. */
  get #writes() { return this.params?.ecrit !== false; }

  /** Nothing to show (registry.js#FRAME, vide): told to the layout (gf-layout.js: a cell vide=masque hidden meanwhile). */
  #empty = /** @type {boolean | null} */ (null);

  /**
   * Whether the deck has cards to show: none without a zone, nor when the zone's plants could not be had, nor when the
   * zone has none; while they come, not empty. The cards swiped do not count: the deck's end is something to show.
   */
  updated() {
    const s = this.state;
    if (!s) return;
    const empty = !s.live.at || s.speciesState === 'error' || (s.speciesState === 'ready' && !this._loading && !this.#session.cards.length);
    if (empty === this.#empty) return;
    this.#empty = empty;
    this.dispatchEvent(new CustomEvent('cell-empty', { detail: { empty }, bubbles: true, composed: true }));
  }

  /**
   * The cards: the plants found in the scope (the first DECK_MAX, in the search's order), and the current plant when
   * it is not among them (on top: the deck always shows it); made again when they change. Not before the scope's
   * plants are known (the search is not kept to them yet): « Les cartes arrivent… » while they come — and only then:
   * the zone's sources failing, the deck says so (render), never waits for cards that will not come.
   */
  async #cards() {
    const s = /** @type {LayoutState} */ (this.state);
    const species = s.species;
    if (!species) { this._loading = s.speciesState === 'loading'; return; }
    // The zone's plants, even while the list keeps to what a map shows of it.
    const results = this.#store.state.results;
    const ids = (results.inZone ?? results.items.map(p => p.id)).filter(id => species.byPlant.has(id)).slice(0, DECK_MAX);
    const current = s.live.plant;
    if (current != null && !ids.includes(current)) ids.unshift(current);
    const key = species.key + '|' + ids.join(',');
    if (key === this.#cardsFor) return;
    this.#cardsFor = key;
    this._loading = true;
    const month = new Date().getMonth();
    const cards = (await Promise.all(ids.map(async id => {
      const plant = this.#plants.get(id) ?? await getPlant(id);
      if (!plant) return null;
      this.#plants.set(id, plant);
      const sp = species.byPlant.get(id);
      /** @type {Card} */
      const card = { plant, taxonId: sp?.taxonId, count: sp?.count ?? 0, photo: sp?.photo ? sp.photo.replace(/\/square\./, '/medium.') : plant.thumbnail?.url || null,
        credit: sp?.photo ? sp.credit : thumbCredit(plant.thumbnail), blooming: floweringMonths(plant.flowering).has(month), alerts: null };
      return card;
    }))).filter(c => c !== null);
    if (key !== this.#cardsFor) return;
    this.#session.cards = /** @type {Card[]} */ (cards);
    this._loading = false;
    // Their safety (local data), as it comes: never a card without it once known.
    for (const c of this.#session.cards) alertsOf(c.plant).then(a => { c.alerts = a; this.#session.changed(); }, () => {});
    // No plant chosen yet: the card on top is the current plant.
    const first = this.#session.deck[0];
    if (first && s.live.plant == null && this.#writes) s.pick(first.plant.id, { how: 'replace' });
    this.#session.changed();
  }

  /** A card swiped: a heart (a favourite), or passed; the next one on top is the current plant. @param {{ card: Card, liked: boolean }} d */
  #decide({ card, liked }) {
    const ses = this.#session, id = card.plant.id;
    const fav = liked && !isFavorite(id);
    ses.history = [...ses.history, { id, liked, fav }].slice(-30);
    ses.c = liked ? { ...ses.c, matches: [...ses.c.matches, id] } : { ...ses.c, passed: [...ses.c.passed, id] };
    if (fav) toggleFavorite(card.plant).catch(() => {});
    if (liked) { ses.burst++; setTimeout(() => { ses.burst = 0; ses.changed(); }, 900); }
    ses.top = null;
    const next = ses.deck[0];
    if (next && this.#writes) this.state?.pick(next.plant.id, { how: 'replace' });
    ses.changed();
  }

  /** ↺: the last card swiped back on top (a heart that made a favourite: out of the favourites again). */
  #undo() {
    const ses = this.#session, last = ses.history[ses.history.length - 1];
    if (!last) return;
    ses.history = ses.history.slice(0, -1);
    ses.c = { ...ses.c, matches: ses.c.matches.filter(x => x !== last.id), passed: ses.c.passed.filter(x => x !== last.id) };
    const card = ses.cards.find(c => c.plant.id === last.id);
    if (last.fav && card && isFavorite(last.id)) toggleFavorite(card.plant).catch(() => {});
    if (this.#writes) this.state?.pick(last.id, { how: 'replace' });
    ses.changed();
  }

  willUpdate() {
    const s = this.state;
    if (!s?.live.at) return;
    this.#cards();
    this.#session.top = s.live.plant;
    this.#session.c = { ...this.#session.c, radius: s.radius };
  }

  render() {
    const s = this.state;
    if (!s) return nothing;
    if (!s.live.at) {
      return html`<div class="empty"><p class="big">${icon('heart-fill')}</p><p><b>Rencontrez les plantes d’un lieu.</b></p>
        <p>Choisissez une zone (sur la carte, ou « Autour de moi ») : ses plantes arrivent ici, une carte à la fois.</p>
        <button class="primary" type="button" @click=${() => locateOnce().then(at => { s.setScope(at, null); nameScope(s, /** @type {[number, number]} */ (s.live.at)); }, () => {})}>${icon('geo-alt')} Autour de moi</button></div>`;
    }
    const ses = this.#session;
    if (s.speciesState === 'error') return this.#failed(s);
    if (this._loading && !ses.cards.length) return html`<p class="empty" role="status">Les cartes arrivent…</p>`;
    return html`<ma-deck active .session=${ses} .cards=${ses.deck} .c=${ses.c}></ma-deck>`;
  }

  /**
   * The scope's plants could not be had (its sources down, offline, their modules off): no cards — said, with what to
   * do (« Réessayer », or the module turned on), instead of cards of another scope or a wait without end.
   * @param {LayoutState} s
   */
  #failed(s) {
    const off = s.speciesFailure === 'off';
    // The zone's sources (core/observations.js): « iNaturalist », « iNaturalist et GBIF ».
    const names = sourcesText(s.filters.sources), many = s.filters.sources.length > 1;
    const why = s.speciesFailure === 'offline' ? `Hors ligne : ${names} ${many ? 'sont injoignables' : 'est injoignable'}.` : `${failedText(s.failed)}.`;
    const seen = `${/^[aeiouy]/i.test(names) ? 'qu’' : 'que '}${names} ${many ? 'ont vues dans la zone : sans eux' : 'a vues dans la zone : sans lui'}`;
    return html`<div class="empty" role="status"><p class="big warn">${icon('exclamation-triangle-fill')}</p><p><b>${why}</b></p>
      <p>Les cartes sont les plantes ${seen}, pas de cartes${off ? '' : ' pour l’instant'}.</p>
      ${off ? html`<p><a href=${href.settings()}>Réglages › Modules</a></p>`
        : html`<button class="primary" type="button" @click=${() => s.retryScope()}>${icon('arrow-counterclockwise')} Réessayer</button>`}</div>`;
  }
}
customElements.define('dl-deck', DlDeck);

// ── a cell ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * What a cell shows: its component's piece, given the state; an unknown component: what is wrong and how to fix it.
 * @param {Resolved} r @param {{ state: LayoutState, view: string, plant: number | null, first: { id: number, name: string } | null,
 *   building?: boolean, channel?: import('../core/search-channel.js').Channel | null }} ctx  `building`: in « Créer une app »; `channel`:
 *   the search of the cell's group (none: the app's)
 */
export function renderCell(r, ctx) {
  if (!r.known) {
    const u = /** @type {{ name: string, suggestion: string | null }} */ (/** @type {unknown} */ (r));
    return html`<div class="placeholder" role="note">${icon('exclamation-triangle-fill')}
      <p><b>Composant inconnu : « ${u.name} »</b></p>
      <p>${u.suggestion ? html`Vouliez-vous dire <code>${u.suggestion}</code> ? ` : nothing}Les composants : <code>map</code>, <code>search</code>, <code>filters</code>,
        <code>results</code>, <code>plant</code> (ou <code>plant.wikipedia</code>, <code>plant.calendar</code>…), <code>media</code>, <code>deck</code>, <code>place</code>.</p>
      <p>« Modifier la disposition » pour le corriger.</p></div>`;
  }
  const { state } = ctx;
  const id = r.spec.id;
  const channel = ctx.channel ?? null;
  if (id === 'map') return html`<dl-map .state=${state} .params=${r.params} .channel=${channel} .building=${Boolean(ctx.building)}></dl-map>`;
  if (id === 'place') return html`<dl-place .state=${state}></dl-place>`;
  if (id === 'search') return html`<dl-search .state=${state} .params=${r.params} .channel=${channel}></dl-search>`;
  if (id === 'results') return html`<dl-results .state=${state} .params=${r.params} .channel=${channel}></dl-results>`;
  if (id === 'filters') return html`<div class="scroll pad">${filterPanel(state, channel)}</div>`;
  if (id === 'deck') return html`<dl-deck .state=${state} .params=${r.params} .channel=${channel}></dl-deck>`;
  // A plant cell: its own plant (plante=: fixed, whatever the current one), else the current plant, or how to choose one.
  const plant = r.params.plante ?? ctx.plant;
  if (plant == null) {
    return html`<div class="placeholder quiet" role="note">${icon(cellIcon(r))}<p>Aucune plante choisie : touchez un résultat, un point de la carte ou une carte.</p>
      ${ctx.first ? html`<button type="button" @click=${() => state.pick(/** @type {any} */ (ctx.first).id)}>Voir ${ctx.first.name}</button>` : nothing}</div>`;
  }
  const view = r.params.mode ?? ctx.view;
  if (id === 'media') {
    return moduleOn('photos', /** @type {any} */ (view))
      ? html`<gf-media-viewer plant-id=${plant} .view=${view} presentation=${r.params.style ?? blockStyle(/** @type {any} */ (view), 'media')}></gf-media-viewer>`
      : html`<p class="placeholder quiet">Photos en ligne désactivées (<a href=${href.settings()}>Réglages › Modules</a>).</p>`;
  }
  return r.view
    ? html`<gf-plant-detail embedded subheading only=${r.view.key} plant-id=${plant} view=${view}></gf-plant-detail>`
    : html`<gf-plant-detail embedded subheading plant-id=${plant} view=${view}></gf-plant-detail>`;
}
