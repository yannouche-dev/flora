// @ts-check
// A screen's map cell (« Écran sur mesure »: cells.js says what each cell shows, renderCell draws it): dl-map, the mother
// map (gf-map) wired to the layout's shared state (state.js) — its zone and observations, the current plant's, the
// observation chosen, a point touched or pressed long; over it the scope (cell-kit.js) and the controls of ctl=; what
// it does with its own controls kept in the layout (`cell-param`). Its settings: registry.js, map-options.js.

import { LitElement, html, css, nothing } from 'lit';
import { icon } from '../core/icons.js';
import { SearchController } from '../core/search-channel.js';
import { href } from '../core/router.js';
import { counted } from '../core/fr.js';
import { cachedThumb, photoOf, thumbUrl } from '../core/thumb.js';
import { hintView, takeHint } from '../core/hints.js';
import { ui } from '../styles/ui.js';
import { distanceKey } from '../miniapp/kit/cards.js';
import { pushHash } from '../core/history.js';
import { addCatalogLayer, defaultOpacity, isOverlay } from '../core/ign-layers.js';
import { mapLook } from '../core/map-settings.js';
import { addressOf, baseKeyOf, baseKind, takesLandmarks } from '../core/backgrounds.js';
import { cleanLandmarks } from '../core/map-layers.js';
import { loadCatalog } from '../core/ign-catalog.js';
import { STOPS, nearestStop } from '../core/distance.js';
import { distanceLabel } from './registry.js';
import { COMPACT_WIDTH, MAP_INTENTS, MAP_LANDMARKS, MAP_LAYERS, WIDE_FEW, WIDE_FRAMES, catalogLayers, inatTiles, inWhen, layersOf, mapControls, mapPin, opacitiesOf, opacText, overlaysOf, snapRadius, uiMode, viewOf, viewText, wideWords, zoneTaxa } from './map-options.js';
import { AROUND_MAX, periodQuery, plantOfPoint, taxonIdOf } from '../core/nearby.js';
import { OBS_DEFAULTS, SOURCES, SOURCE_NAMES, defaultSources, failedText, inatQuery, obsChanges } from '../core/observations.js';
import { obsId } from './state.js';
import { StateController, locateOnce, nameScope, radiusSlider, scopeNote, scopeStyles, scopeWords, setCell, where } from './cell-kit.js';
import { speciesKey } from '../components/map-style.js';
import '../components/gf-map.js';

/**
 * @typedef {import('./state.js').LayoutState} LayoutState
 * @typedef {import('./map-options.js').MapPin} MapPin
 */

/** A background's thumbnail, by its kind (core/backgrounds.js): its key in the address (base=), its name, its words. */
const THUMBS = {
  plan: { key: 'plan', label: 'Plan', words: 'le plan IGN' },
  photo: { key: 'photo', label: 'Photo', words: 'les photos aériennes' },
  spot: { key: 'spot', label: 'SPOT', words: 'les images satellite (SPOT)' }
};
/** The other background, by the kind shown: the plan beside the photos of any year and SPOT's images, the photos beside the plan. */
const OTHER_BASE = { photo: THUMBS.plan, spot: THUMBS.plan, plan: THUMBS.photo };

/** The period's chips (when=), in their order. */
const PERIODS = [['toujours', 'Toujours'], ['annee', 'Cette année'], ['mois', 'Ce mois-ci']];

/**
 * iNaturalist's taxa of names of the flora (families, genera, species), each found once (core/nearby.js#taxonIdOf,
 * cached), four at a time — never forty requests at once; those not found left out, and counted (`missing`) — those
 * not answered for (offline, iNaturalist down, its module off) left out too, never counted as names it has not.
 * @param {string[]} names @returns {Promise<{ ids: number[], missing: number }>}
 */
async function namesToTaxa(names) {
  /** @type {(number | null | undefined)[]} */
  const ids = [];
  for (let i = 0; i < names.length; i += 4) ids.push(...await Promise.all(names.slice(i, i + 4).map(n => taxonIdOf(n).catch(() => undefined))));
  return { ids: /** @type {number[]} */ (ids.filter(Boolean)), missing: ids.filter(t => t === null).length };
}

export class DlMap extends LitElement {
  static properties = {
    state: { attribute: false }, params: { attribute: false },
    /** The search of its group (core/search-channel.js: the screen's own); none: the app's. */
    channel: { attribute: false },
    /** While modified: the map moved there is the view it starts on (vue=) — in use, only the one leading the list. */
    editing: { attribute: false },
    _busy: { state: true }, _narrow: { state: true }, _zone: { state: true }, _thumb: { state: true }
  };

  static styles = [ui, scopeStyles, css`
    :host { display: flex; flex-direction: column; position: relative; min-height: 0; isolation: isolate; }
    /* The map and its zone panel; above them, in the cell's flow, the long press's first-use hint: never over the map
       (in the panel it made it taller, over the map's own controls). */
    .stage { flex: 1; min-height: 0; position: relative; }
    .stage > gf-map { position: absolute; inset: 0; display: block; }
    /* A new answer of the zone coming (state.js updating): what the map draws (its tiles, its points: Leaflet's panes,
       MapLibre's canvas) dimmed until it is replaced (after a moment: a quick one never flashes) — never the controls
       over it, in use (its zoom, its buttons, its address search, the radius being dragged). */
    gf-map .leaflet-map-pane, gf-map .maplibregl-canvas { transition: opacity 0.2s; }
    :host([updating]) gf-map .leaflet-map-pane, :host([updating]) gf-map .maplibregl-canvas { opacity: 0.55; transition: opacity 0.2s 0.15s; }
    /* Its count too (« n observations · k espèces »): the old answer's, replaced with it. */
    .ctl .count { transition: opacity 0.2s; }
    :host([updating]) .ctl .count { opacity: 0.55; transition: opacity 0.2s 0.15s; }
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
    .base { width: 48px; height: 48px; padding: 0; border-radius: var(--gf-radius); overflow: hidden; display: grid; align-items: end; border: 2px solid #fff;
      box-shadow: 0 1px 4px rgb(0 0 0 / 30%); font-size: 0.68rem; font-weight: 700; color: #fff; text-shadow: 0 1px 2px rgb(0 0 0 / 70%); }
    .base.photo { background: radial-gradient(circle at 30% 30%, #7f9b55 0 18%, transparent 19%), radial-gradient(circle at 70% 65%, #4f6d33 0 22%, transparent 23%),
      linear-gradient(135deg, #5d7a3e, #8a8f5a 55%, #3e5a2c); }
    .base.plan { background: linear-gradient(90deg, transparent 45%, #f6d27a 45% 55%, transparent 55%), linear-gradient(0deg, transparent 62%, #fff 62% 68%, transparent 68%),
      linear-gradient(135deg, #eef0e6, #dfe7d4); color: #1d2419; text-shadow: 0 0 2px #fff; }
    .base.spot { background: radial-gradient(circle at 65% 35%, #6f7d52 0 20%, transparent 21%), radial-gradient(circle at 28% 68%, #8b7f60 0 17%, transparent 18%),
      linear-gradient(135deg, #2e4536, #4f6447 50%, #34495a); }
    .base span { display: block; padding: 1px 0 2px; text-align: center; background: rgb(0 0 0 / 28%); }
    .base.plan span { background: rgb(255 255 255 / 70%); }
    :host([ctl-compact]) .round { width: 28px; height: 28px; }
    :host([ctl-compact]) .base { width: 36px; height: 36px; }
    :host([ctl-compact]) .base span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
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
    /* The current plant no longer found by the search (state.js outside): still chosen, said above its chip. */
    .outside { max-width: 100%; box-sizing: border-box; padding: 3px 10px; border-radius: var(--gf-radius-pill); font-size: 0.78rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      background: color-mix(in srgb, var(--gf-warn-bg) 96%, transparent); box-shadow: 0 1px 3px rgb(0 0 0 / 14%); }
    /* Its pin (an axis of its group it is detached from: its sources): what it shows, what it leaves out, the way back. */
    .pin { display: grid; gap: 2px; max-width: 100%; box-sizing: border-box; padding: 4px 10px; border-radius: 12px; font-size: 0.78rem;
      background: color-mix(in srgb, var(--gf-surface) 96%, transparent); box-shadow: 0 1px 3px rgb(0 0 0 / 14%); }
    .pin .tag { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: var(--gf-accent); }
    .pin .line { color: var(--gf-text-muted); }
    /* Its way back as its neighbours' (32 px; a finger: 44 px, its area past it — a tap missed would move the map). */
    .pin button.link { min-height: 32px; padding: 0 6px; font-size: inherit; }
    @media (pointer: coarse) {
      .pin button.link { position: relative; }
      .pin button.link::before { content: ''; position: absolute; inset: -6px -4px; }
    }
    /* The legend (legende): its button, its lines once opened. */
    .legend > button { min-height: 32px; padding: 2px 12px; border-radius: var(--gf-radius-pill); font-size: 0.8rem; box-shadow: var(--gf-shadow); background: color-mix(in srgb, var(--gf-surface) 95%, transparent); }
    .legend ul { list-style: none; margin: 6px 0 0; padding: 8px 10px; display: grid; gap: 4px; border-radius: 12px; font-size: 0.8rem;
      background: color-mix(in srgb, var(--gf-surface) 97%, transparent); box-shadow: var(--gf-shadow); }
    .legend li { display: flex; align-items: center; gap: 8px; }
    .legend i { flex: none; width: 12px; height: 12px; border-radius: 50%; background: var(--c, #6b8f3a); border: 1px solid #fff; box-shadow: 0 0 0 1px rgb(0 0 0 / 20%); }
    .legend i.obs { border: 0; background: radial-gradient(circle at 35% 30%, #ff6f9c, var(--gf-kin) 75%); box-shadow: 0 0 0 1.5px var(--gf-highlight); }
    .legend i.outline { background: transparent; border: 2px solid #a3e68a; box-shadow: 0 1px 0 rgb(0 0 0 / 30%); }
    .legend i.area { border-radius: 3px; background: color-mix(in srgb, #7c3aed 35%, transparent); border-color: #7c3aed; }
    .legend i.lines { height: 4px; border-radius: 2px; background: #fff; border: 0; box-shadow: 0 0 0 1px rgb(0 0 0 / 45%); }
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
    // the list it led: framed on the zone again, its view (vue=) gone from the address — in use, every map of the
    // group that leads it lets its own go too (framed on the zone: a reload gives the whole zone). Another map of the
    // group moved by hand in use, leading the list now: this one, if it leads it too, lets its view go from the address
    // (one author), the map left where it is.
    new StateController(this, {
      hover: () => this.#lightHovered(),
      refit: e => {
        const by = /** @type {CustomEvent} */ (e).detail?.by;
        if (by === this) this.#map?.refit();
        if (this.params?.vue && (by === this || (!this.editing && this.#leads))) this.#set({ vue: null });
      },
      lead: e => { if (/** @type {CustomEvent} */ (e).detail?.by !== this && !this.editing && this.#leads && this.params?.vue) this.#letGo(); }
    });
    /** @type {LayoutState | null} */ this.state = null;
    /** The search of its group (core/search-channel.js); none: the app's. @type {import('../core/search-channel.js').Channel | null} */ this.channel = null;
    /** @type {Record<string, any>} */ this.params = {};
    this._busy = false;
    /** Narrower than COMPACT_WIDTH (ui=auto: compact controls). */
    this._narrow = false;
    this.editing = false;
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

  /** The map's own buttons, watched: one coming or going (the binoculars when the map turns 3D, a stack rebuilt) moves the controls under them. */
  #stack = new ResizeObserver(() => this.#placeControls());
  /** @type {Element | null} */ #stackSeen = null;

  connectedCallback() { super.connectedCallback(); this.#resize.observe(this); }
  disconnectedCallback() { super.disconnectedCallback(); this.#resize.disconnect(); this.#stack.disconnect(); this.#stackSeen = null; }

  /** The map's settings (registry.js), their defaults when none were given. */
  get #p() {
    const p = this.params ?? {};
    return {
      // The period: the layout's, shared by every cell (the address' periode=, else a map's when=: state.js). The
      // sources of its points: those it says among its group's (core/observations.js), else all of them.
      src: /** @type {string[]} */ (p.src ?? this.state?.filters.sources ?? defaultSources()), when: /** @type {string} */ (this.state?.periode ?? p.when ?? 'toujours'), suit: p.suit !== false,
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
  #radiusHandle = { snap: (/** @type {number} */ m) => snapRadius(m, STOPS), step: distanceKey, label: distanceLabel };

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

  /**
   * The current plant's observations in the scope, large, its photo in each (state.js plantObs: its own among the
   * zone's points — the same as its row counts —, or iNaturalist's for a plant outside the zone): those of the sources
   * this map shows (src), of the period (when).
   */
  get #highlight() {
    const s = /** @type {LayoutState} */ (this.state);
    const obs = s.plantObs, info = s.plantInfo, P = this.#p;
    if (!obs || !info || !obs.points.length) return null;
    const key = obs.key + ':' + info.name + ':' + P.when + ':' + P.src.join('+');
    if (this.#hlMemo?.key === key && this.#hlMemo.obs === obs) return this.#hlMemo.value;
    const sp = s.species?.byPlant.get(info.id);
    const photo = photoOf(sp?.photo)?.replace(/\/square\./, '/small.') ?? null;
    const points = obs.points.filter(p => P.src.includes(p.kind) && inWhen(p.date, P.when));
    const value = !points.length ? null : { key: obs.key + ':' + P.when + ':' + P.src.join('+'), photo, credit: photo ? sp?.credit ?? null : null, common: info.name, sci: info.sci, taxonId: sp?.taxonId ?? null,
      points: points.map(p => ({ coordinates: p.coordinates, title: info.name, url: p.url, date: p.date, taxonId: sp?.taxonId ?? null, sci: info.sci, plantId: info.id })) };
    this.#hlMemo = { key, obs, value };
    return value;
  }
  /** @type {{ key: string, obs: import('./state.js').PlantObs, value: any } | null} */ #hlMemo = null;

  /**
   * A map of France or of the world (portee=): the iNaturalist taxa of the plants it shows — the plants found in the
   * zone (the zone's list, as the search keeps it: its first WIDE_MAX); without a zone, those the search keeps: its
   * families and genera when it filters by them, else its plants when they are few (WIDE_FEW at most), each name found
   * once on iNaturalist (core/nearby.js#taxonIdOf); else every plant (null). undefined: still being found; []: none
   * found. What it leaves out is counted for its « État » (#wideSaid, map-options.js wideWords).
   * @returns {number[] | null | undefined}
   */
  #wideTaxa() {
    const s = /** @type {LayoutState} */ (this.state), P = this.#p;
    const list = s.species?.list;
    this.#wideSaid = {};
    if (s.live.at && list) {
      const found = this.#found;
      // iNaturalist's tiles: the plants it knows here (a plant seen by GBIF alone has no taxon of it).
      const kept = P.suit ? list.filter(x => found.has(/** @type {number} */ (x.plantId))) : list;
      const { taxa, said } = zoneTaxa(kept);
      this.#wideSaid = said;
      return taxa;
    }
    if (!P.suit) return null;
    const st = this.#store.state;
    const facets = [...st.query.filters.family, ...st.query.filters.genus];
    const few = st.results.total > 0 && st.results.total <= WIDE_FEW && st.results.items.length === st.results.total;
    const names = facets.length ? facets : few ? st.results.items.map(i => i.scientificName) : [];
    if (!names.length) {
      // Every plant: more than a few kept, none by family or genus — said, without a zone (its plants still coming: not yet).
      if (!s.live.at && st.status === 'ready' && this.#store.answered) this.#wideSaid = { many: st.results.total };
      return st.results.total === 0 && st.status === 'ready' && (st.query.q || facets.length) ? [] : null;
    }
    const key = names.join('|');
    if (this.#named?.key !== key) {
      const named = this.#named = { key, ids: /** @type {number[] | undefined} */ (undefined), missing: 0 };
      // The plants' names not found on iNaturalist: absent from its tiles, said (a family or a genus not found: not).
      namesToTaxa(names).then(({ ids, missing }) => { if (this.#named === named) { named.ids = ids; named.missing = facets.length ? 0 : missing; this.requestUpdate(); } });
    }
    this.#wideSaid = { missing: this.#named.missing };
    return this.#named.ids;
  }
  /** @type {{ key: string, ids: number[] | undefined, missing: number } | null} */ #named = null;
  /** What a map of France or of the world leaves out, as last drawn (map-options.js wideWords). @type {{ many?: number, listed?: number, missing?: number, gbif?: number }} */
  #wideSaid = {};

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

  /**
   * The tiles of a map of France or the world: its plants' observations, as its group's filters say (the quality
   * grades, the cultivated plants left out or not…: inatQuery, as the zone's points), the current plant's on top (the
   * same array while the same).
   */
  get #wideTiles() {
    const taxa = this.#wideTaxa();
    const when = periodQuery(this.state?.periode);
    const plant = this.#plantTaxon;
    const filters = inatQuery(this.state?.filters ?? OBS_DEFAULTS);
    const key = JSON.stringify([taxa, when, plant, filters]);
    if (this.#tilesMemo?.key !== key) {
      // Still finding their taxa: none yet (never all plants for a moment); none found: the current plant's alone.
      const value = taxa === undefined ? [] : taxa !== null && !taxa.length ? inatTiles([], when, plant, filters).filter(t => t.key === 'plant') : inatTiles(taxa, when, plant, filters);
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
    // Found again among other points (another answer of the zone, the current plant's): the same while they are.
    const pts = s.points, own = s.plantObs?.points ?? null;
    if (this.#focusMemo?.id === id && this.#focusMemo.pts === pts && this.#focusMemo.own === own) return this.#focusMemo.value;
    const p = pts.find(x => x.url && obsId(x.url) === id) ?? own?.find(x => x.url && obsId(x.url) === id);
    const value = p ? { coordinates: p.coordinates, title: /** @type {any} */ (p).title ?? s.plantInfo?.name ?? 'Observation', url: p.url, photo: /** @type {any} */ (p).photo ?? null } : null;
    this.#focusMemo = { id, pts, own, value };
    return value;
  }
  /** @type {{ id: string, pts: any[], own: any[] | null, value: any } | null} */ #focusMemo = null;

  /**
   * The cell's own look (core/map-settings.js), as its address says it: its background (base=, and annee= the year or
   * period of its photos, SPOT's year: core/backgrounds.js baseKeyOf; without it the most recent), its « Noms et
   * réseaux » over it (noms=lieux+rail: those, core/map-layers.js LANDMARKS; noms=1 the usual ones, noms=0 none — on
   * the photos and SPOT's; the plan has its own, noms= kept there, of no effect), its layers in their order
   * (layers=znieff+n2000+ign:<id>: the catalogue's added to the maps first, core/ign.js — one of IGN's whole catalogue
   * not known on this device found in it, core/ign-catalog.js, then shown) and their opacity (opac=); what it does not
   * say follows the maps' common look (gf-map `look`) — layers=aucune says none of its own, not the common ones. null:
   * it says none. The same object while the same.
   * @returns {Partial<import('../core/map-settings.js').MapLook> | null}
   */
  get #look() {
    const p = this.params ?? {};
    const names = /** @type {string[]} */ (p.layers ?? []);
    const k = JSON.stringify([p.base ?? null, p.annee ?? null, p.noms ?? null, p.layers ?? null, p.opac ?? null]);
    if (this.#lookMemo?.k === k) return this.#lookMemo.value;
    for (const l of catalogLayers(names)) addCatalogLayer(/** @type {any} */ (l));
    const overlays = overlaysOf(names);
    const unknown = overlays.filter(key => !isOverlay(key)).map(key => key.slice('ign:'.length));
    if (unknown.length) {
      loadCatalog().then(c => {
        const found = (c.layers ?? []).filter(l => unknown.includes(l.id));
        for (const l of found) addCatalogLayer(l);
        if (found.length) { this.#lookMemo = null; this.requestUpdate(); }
      }, () => {});
    }
    /** @type {Partial<import('../core/map-settings.js').MapLook>} */
    const own = {};
    // A year its kind has not (the registry says it, and leaves it out): the kind's most recent.
    const base = p.base || p.annee ? baseKeyOf(p.base, p.annee) ?? baseKeyOf(p.base, null) : null;
    if (base) own.base = base;
    if (Array.isArray(p.noms)) own.landmarks = cleanLandmarks(p.noms);
    // Its layers and their opacity go together (gf-map#editLook): either written, both its own.
    if (p.layers != null || p.opac) Object.assign(own, { overlays, opacities: opacitiesOf(p.opac) });
    const value = Object.keys(own).length ? own : null;
    this.#lookMemo = { k, value };
    return value;
  }
  /** @type {{ k: string, value: Partial<import('../core/map-settings.js').MapLook> | null } | null} */ #lookMemo = null;

  /**
   * Its own look changed on the map (its panel ▦, its opacity card: gf-map `look-change`): kept in the layout (base=
   * and annee=, noms=, layers= in their order, opac=); null — « Revenir aux réglages communs » —: all of them left out.
   * @param {CustomEvent} e
   */
  #onLook(e) {
    const look = e.detail.look;
    /** @type {Record<string, unknown>} */
    const values = look ? {} : { base: null, annee: null, noms: null, layers: null, opac: null };
    if (look?.base) Object.assign(values, addressOf(look.base));
    // Those ticked (noms=1 when the usual ones, noms=0 none: registry.js).
    if (Array.isArray(look?.landmarks)) values.noms = cleanLandmarks(look.landmarks);
    if (look?.overlays) Object.assign(values, { layers: layersOf(look.overlays), opac: opacText(look.opacities ?? {}, look.overlays, defaultOpacity) });
    this.#set(values);
    // What the address says now, given back (an intent's background is not one to leave out: the map shows it again).
    this.#lookMemo = null;
    this.requestUpdate();
  }

  /**
   * « Observations autour » (the binoculars, in 3D: gf-map-obs3d.js) as the cell keeps them (jumelles=, jrayon=):
   * off when not written; their radius, else the nearest to the zone's. The same object while they are the same.
   */
  get #around3d() {
    const j = /** @type {string[] | null} */ (this.params?.jumelles ?? null);
    const radius = nearestStop(this.params?.jrayon ?? this.state?.radius ?? 2000, STOPS);
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
    const zone = nearestStop(this.state?.radius ?? 2000, STOPS);
    this.#set({
      jumelles: p.on ? [p.inat && 'inat', p.gbif && 'gbif', p.density && 'densite'].filter(Boolean) : null,
      jrayon: p.on && !this.state?.live.at && p.radius !== zone ? p.radius : null
    });
  }

  /**
   * « Sur cette carte » of its panel ▦: its points, as its address says them (its settings' form says the same) — their
   * sources (src=: those of the zone's observations it draws, its own — never its group's, which asks its own; one the
   * address' sources= leaves out, disabled, why said), the current plant's points (plante=: in large, alone, or not
   * shown). A map of France or of the world: the current plant's alone (the others are iNaturalist's tiles: GBIF has
   * none here). The same array while the same.
   * @param {LayoutState} s @returns {import('../components/gf-map-options.js').DataRow[]}
   */
  #dataRows(s) {
    const P = this.#p;
    /** @type {import('../components/gf-map-options.js').DataRow[]} */
    const rows = [];
    // The group's sources the address says (sources=): the only ones asked, whatever its maps draw.
    const said = s.live.filtres?.sources ?? null;
    if (P.portee === 'zone') {
      for (const x of SOURCES) {
        const name = SOURCE_NAMES[x];
        rows.push({ key: 'src:' + x, kind: 'check', label: name, value: P.src.includes(x),
          hint: x === 'inat' ? 'ses observations dans la zone' : 'ses occurrences dans la zone : herbiers, inventaires, Pl@ntNet…',
          ...(!said || said.includes(x) ? {} : { disabled: true, why: `Les observations de la zone ne viennent pas de ${name} : à cocher dans les filtres, « Observations de la zone ».` }) });
      }
    }
    const plant = s.live.plant != null && s.plantInfo?.id === s.live.plant ? s.plantInfo.name : null;
    rows.push({ key: 'plante', kind: 'check', label: 'Points de la plante choisie', value: P.plante !== 'non',
      hint: plant ? `${plant} : ${P.plante === 'seule' ? 'seule sur la carte' : 'en grand'}` : 'aucune choisie pour l’instant' });
    const key = JSON.stringify(rows);
    if (this.#rowsMemo?.key !== key) this.#rowsMemo = { key, rows };
    return this.#rowsMemo.rows;
  }
  /** @type {{ key: string, rows: import('../components/gf-map-options.js').DataRow[] } | null} */ #rowsMemo = null;

  /**
   * A row of « Sur cette carte » changed (its panel ▦): kept in the layout, as its settings' form writes it — src= the
   * sources ticked (this map's own: what it draws; its group asks its own), plante=non or not written.
   * @param {{ key: string, value: unknown }} d
   */
  #onData({ key, value }) {
    const P = this.#p;
    if (key.startsWith('src:')) this.#set({ src: SOURCES.filter(x => 'src:' + x === key ? Boolean(value) : P.src.includes(x)) });
    else if (key === 'plante') this.#set({ plante: !value ? 'non' : P.plante === 'non' ? null : P.plante });
  }

  /** The view it starts on (vue=), read; the same object while it is the same. */
  get #view() {
    const text = this.params?.vue ?? '';
    if (this.#viewMemo?.text !== text) this.#viewMemo = { text, value: viewOf(text) };
    return this.#viewMemo.value;
  }
  /** @type {{ text: string, value: import('./map-options.js').MapView | null } | null} */ #viewMemo = null;

  /**
   * The map moved by hand: the list kept to what it shows (liste=vue: state.js setView), its view written in the
   * address (vue=, replaced: no new entry) — while the screen is modified, any map's (the view it starts on); in use,
   * only the one leading the list, the others of its group letting theirs go (state.js lead). @param {CustomEvent} e
   */
  #onView(e) {
    const s = this.state, leads = this.#leads;
    if (this.editing || leads) this.#set({ vue: viewText(e.detail) });
    if (!leads || !s) return;
    if (e.detail.bounds) s.setView(e.detail.bounds, { kinds: this.#own, by: this });
    if (!this.editing) s.lead(this);
  }

  /**
   * The map framed by itself: on the zone (bounds null) — the list it led back to the whole zone —, or on the view it
   * was given (vue=): the list kept to it, unless another map leads it. @param {CustomEvent} e
   */
  #onFramed(e) {
    const s = this.state, bounds = e.detail.bounds;
    if (!s) return;
    if (!bounds) { if (s.view?.by === this) s.setView(null); }
    else if (this.#leads && (!s.view || s.view.by === this)) s.setView(bounds, { kinds: this.#own, by: this });
  }

  /**
   * It leads the list (what it shows of the zone, once moved): a map of the zone (portee=zone), liste=vue, a zone — not
   * one that shows the current plant alone (plante=seule: its points are not the list's).
   */
  get #leads() { return this.#p.portee === 'zone' && this.params?.liste !== 'zone' && this.#p.plante !== 'seule' && Boolean(this.state?.live.at); }

  /** In use, its view (vue=) let go from the address — no longer the list's: the map left where it is (gf-map letGoView). */
  #letGo() {
    this.#map?.letGoView();
    this.#set({ vue: null });
  }

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

  /**
   * A point under the mouse, or none (gf-map `point-hover`): its plant's row lit in the lists, its points on the other
   * maps (state.js hover, by this map). @param {CustomEvent} e
   */
  #onHover(e) {
    const s = /** @type {LayoutState} */ (this.state);
    const p = e.detail.point;
    const id = p ? this.#plantOf(p) ?? p.plantId ?? null : null;
    if (id == null) s.hoverOff(null, 'map', this);
    else s.hoverOn(id, 'map', this);
  }

  /**
   * A plant hovered in a list or on another map of the group (state.js hover): its points lit as the map's own hover
   * lights them — set on the map, the cell not drawn again. Hovered on this map: it lights it itself (gf-kin).
   */
  #lightHovered() {
    const map = this.#map, h = this.state?.hover;
    if (!map) return;
    const keys = h && h.by !== this ? this.#keysOf(h.plant) : null;
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
   * A long press on the map once « Chercher autour d’ici ? » is confirmed (gf-map press="zone"), a place picked in its
   * address search: the scope moves there — named as the search named it, else its place's name found after. Its
   * reference's card opened again (the reference is the zone's centre): the zone there already, kept — its name too.
   * @param {CustomEvent} e
   */
  #onPress(e) {
    const s = /** @type {LayoutState} */ (this.state);
    const at = /** @type {[number, number]} */ (e.detail.coordinates);
    // (Within the 5 decimals of its address.)
    const was = s.live.at;
    if (was && Math.abs(was[0] - at[0]) < 1e-5 && Math.abs(was[1] - at[1]) < 1e-5) return;
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
    // (Its view, written for the zone it was to open on: a zone given by hand afterwards is not that one.)
    catch (error) { this.#openedOn = null; this.#map?.toast(/** @type {Error} */ (error).message); }
    finally { this._busy = false; }
  }

  /**
   * The group's starting place (state.js defaultStart: its first map's lieu=, else its autour — group-defaults.js), when
   * the address has no zone: the place found as ?place= is (state.js), or « Autour de moi » — once for each (applyOnce:
   * every map of the group asks, one applies it; a zone taken off afterwards, ✕, stays off). The address' always wins.
   */
  #defaultScope() {
    const s = /** @type {LayoutState} */ (this.state);
    const want = s.defaultStart;
    if (!want || !s.applyOnce(want)) return;
    if (s.live.at || s.live.place) return;
    if (want.startsWith('lieu:')) s.set({ place: want.slice('lieu:'.length), obs: null }, 'replace');
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
    this.toggleAttribute('updating', Boolean(s?.updating));
    if (!s || !map) return;
    this.#defaultScope();
    // No longer leading the list (liste=zone, plante=seule, France or the world now): it shows the whole zone again —
    // in use, its view gone from the address (written there only while it led), the map left where it is.
    if (s.view?.by === this && !this.#leads) {
      s.setView(null);
      if (!this.editing && this.params?.vue) this.#letGo();
    } else if (s.view?.by === this && String(s.view.kinds) !== String(this.#own)) {
      // Its own sources changed (src=: « Afficher » on its pin, « Sur cette carte »): the list kept to the plants of
      // what it now draws there, its banner saying it (none said: its group's, whichever they become).
      s.setView(s.view.box, { kinds: this.#own, by: this });
    }
    // The zone moved (another place, another radius, none): the view kept was the old zone's — framed on the new one.
    // Not the zone it opens on (its group's starting place, lieu=, autour: found after it is drawn), its view the
    // address' still: that view frames it (gf-map, the first time). In use, a map of the zone's alone: a map of France
    // or of the world keeps its own (never framed on the zone).
    const zone = s.live.at ? s.live.at.join(',') + ':' + s.radius : '';
    if (this.#zoneWas === undefined) this.#openedOn = this.params?.vue ?? null;
    // Its place not found (lieu=): a zone given by hand afterwards is not the one its view was written for.
    if (s.placeState === 'failed') this.#openedOn = null;
    const opens = this.#zoneWas === '' && Boolean(s.defaultStart) && this.params?.vue === this.#openedOn;
    if (this.params?.vue && (this.editing || this.#p.portee === 'zone') && this.#zoneWas !== undefined && zone !== this.#zoneWas && !opens) this.#set({ vue: null });
    if (zone) this.#openedOn = null;
    this.#zoneWas = zone;
    const d3 = this.#d3;
    if (d3 !== this.#was3d) { if (this.#was3d !== undefined) map.gl?.recheck(); this.#was3d = d3; }
    map.busy('scope', Boolean(s.live.at) && s.speciesState === 'loading', 'Plantes de la zone : recherche');
    // A map of the zone without one (nor a place being found, nor « Autour de moi » under way): said in its state —
    // bare too (ui=nue), whose head may say nothing.
    const none = !s.live.at && !s.live.place && !this._busy && this.#p.portee === 'zone';
    map.setStatus('scope', s.live.at && s.speciesState === 'error' ? s.speciesError : none ? 'Sans zone : appui long sur la carte, ou « Autour de moi », pour choisir un lieu.' : '',
      { level: s.live.at ? 'warn' : 'info' });
    // A source of the zone that failed, the others shown (core/observations.js): said on the map — every one failing
    // is the scope's error above. One whose module is off fails only when a map or the address asks it: the layout's
    // own sources leave it out (state.js defaultSources).
    const partial = s.live.at && s.speciesState === 'ready' && s.failed.length ? s.failed : [];
    map.setStatus('sources', partial.length ? `${failedText(partial)} : ${partial.length > 1 ? 'leurs' : 'ses'} observations manquent sur la carte et dans la liste.` : '', { level: 'warn' });
    const said = s.live.at && s.speciesState !== 'loading' && s.speciesState !== 'error' ? scopeNote(s) : '';
    if (said && said !== this.#said) map.announce(said);
    this.#said = said;
    // The current plant's own observations (its big points, state.js plantObs): none in the zone, or — a plant not
    // among the zone's — iNaturalist's alone, said in the map's « État ».
    // « (iNaturalist seul) » only when this map draws them (its sources, src=, may leave iNaturalist's out).
    const P = this.#p;
    const obs = P.portee === 'zone' && P.plante !== 'non' && s.live.at ? s.plantObs : null;
    const name = obs && s.plantInfo?.id === s.live.plant ? s.plantInfo.name : null;
    const drawn = obs ? obs.points.some(p => P.src.includes(p.kind) && inWhen(p.date, P.when)) : false;
    map.setStatus('plant', !obs || !name ? '' : !obs.points.length ? `${name} : aucune observation dans la zone`
      : obs.outside ? `${name} : hors des observations de la zone${drawn ? ' (iNaturalist seul)' : ''}` : '');
    // Asked apart (outside the zone's), as many as iNaturalist gives at most: the most recent, said.
    map.setStatus('plantMax', obs?.outside && obs.capped && name && drawn ? `${name} : les ${AROUND_MAX} observations les plus récentes seulement` : '');
    // A map of France or of the world: what it shows of the plants, when not those of the list one by one — every plant
    // (too many to find by name), the zone's list cut, its plants GBIF alone saw, the names iNaturalist has not
    // (#wideTaxa). In its « État »; spoken once when a line comes — never again for each new count (a word typed).
    const wide = wideWords(P.portee === 'zone' ? {} : this.#wideSaid);
    for (const key of /** @type {const} */ (['wide', 'cut', 'gbif', 'names'])) {
      map.setStatus(key, wide[key], { quiet: true });
      if (wide[key] && !this.#wideHad.has(key)) map.announce(wide[key]);
      if (wide[key]) this.#wideHad.add(key); else this.#wideHad.delete(key);
    }
    this.#placeControls();
    // Once the map's own controls are drawn (a frame later: a rebuilt search pill, the 3D map's controls).
    requestAnimationFrame(() => this.#placeControls());
  }
  #said = '';
  /** The lines a map of France or of the world says (wideWords' keys), as last drawn: spoken when they come. @type {Set<string>} */ #wideHad = new Set();
  /** The zone at the last update (undefined: none yet). @type {string | undefined} */ #zoneWas;
  /** The view it opened on (vue=, the address'), until it has a zone: kept when its first one comes. @type {string | null} */ #openedOn = null;

  /**
   * The controls placed around the map's own, whose number and size vary (measured): top right under its buttons;
   * bottom left over its zoom and scale, bottom right over its credits (MapLibre's controls in 3D); on a narrow map,
   * bottom left over bottom right, never on it.
   */
  #placeControls() {
    const stage = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.stage')), map = this.#map;
    const buttons = map?.querySelector('.gf-map-buttons');
    if (!stage || !buttons) return;
    if (buttons !== this.#stackSeen) { this.#stack.disconnect(); this.#stack.observe(buttons); this.#stackSeen = buttons; }
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

  /**
   * The other background shown (its thumbnail touched): kept in the layout as its own (base=, the most recent: no
   * annee=) — or, the thumbnail offering the one it would follow again, none written: the cell follows the maps' common
   * background again (its intent's: map(terrain) says the photos).
   */
  #switchBase() {
    const other = this.#otherBase;
    this.#set({ base: other.back ? null : other.key, annee: null });
  }

  /**
   * The other background, as its thumbnail says it. The one shown (its own, else the common one) of another kind than
   * the one it would follow without it (the maps' common one, its intent's): that one (`back`: base= let go) — SPOT's
   * too, so that two touches always give the common one back; else the other kind's (OTHER_BASE).
   * @returns {{ key: string, label: string, words: string, back: boolean }}
   */
  get #otherBase() {
    const shown = baseKind(this.#map?.baseShown ?? this.#look?.base ?? mapLook().base) ?? 'photo';
    const back = baseKind(this.#intended.base ?? mapLook().base) ?? 'photo';
    return shown !== back ? { ...THUMBS[back], back: true } : { ...OTHER_BASE[shown], back: false };
  }

  /**
   * What its intent gives, as the address writes it (map(relief): 3d=1; map(protege): its layers): what its own controls
   * cannot let go — without it written, the intent's again, never the maps' common choice. @returns {Record<string, string>}
   */
  get #intended() { return /** @type {Record<string, string>} */ (MAP_INTENTS[this.params?.intent ?? '']?.set ?? {}); }

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
      return html`<div class="panel ${low ? '' : 'top'}" role="group" aria-label="Zone de l’écran">
        ${where(s)}
        ${s.live.at ? radiusSlider(s) : nothing}
        ${around}
      </div>`;
    }
    const failed = Boolean(s.placeError && !s.live.at);
    const label = s.live.at ? distanceLabel(s.radius) : failed ? 'Lieu introuvable' : 'Zone';
    return html`<div class="zone ${low ? 'low' : ''}" role="group" aria-label="Zone de l’écran">
      <button type="button" class=${failed ? 'error' : ''} aria-expanded=${String(this._zone)} aria-controls="zone-drop" title=${scopeWords(s, { zone: true })}
        @click=${() => { this._zone = !this._zone; }}>${failed ? icon('exclamation-triangle-fill') : nothing}${label} ${icon('caret-down-fill')}</button>
      ${failed && !this._zone ? html`<span class="visually-hidden" role="alert">${scopeWords(s, { zone: true })}</span>` : nothing}
      ${this._zone ? html`<div class="drop" id="zone-drop">
        ${where(s)}
        ${s.live.at ? html`<div class="stops" role="group" aria-label="Rayon de la zone">${STOPS.map(m => html`<button type="button" aria-pressed=${String(m === s.radius)}
          @click=${() => { s.set({ r: m }, 'replace'); this._zone = false; }}>${distanceLabel(m)}</button>`)}</div>` : nothing}
        ${around}
      </div>` : nothing}
    </div>`;
  }

  /**
   * Top right, under the map's own buttons: the 2D / 3D switch, the other background's thumbnail — and, while the screen
   * is modified once the map was moved (vue=), « Recadrer sur la zone ». @param {Set<string>} on
   */
  #topRight(on) {
    const reframe = this.editing && Boolean(this.params?.vue);
    if (!on.has('3d') && !on.has('fond') && !reframe) return nothing;
    const map = this.#map;
    const in3d = this.#d3 ?? Boolean(map?.gl?.wanted);
    const other = this.#otherBase;
    return html`<div class="ctl tr">
      ${on.has('3d') ? html`<button type="button" class="round" aria-pressed=${String(in3d)} aria-label="Vue 3D" title=${in3d ? 'Vue 3D (repasser en 2D)' : 'Vue 3D'}
        @click=${() => this.#set({ '3d': !in3d })}>3D</button>` : nothing}
      ${reframe ? html`<button type="button" class="round" data-act="reframe" aria-label="Recadrer sur la zone" title="Recadrer sur la zone (la carte part alors de la zone)"
        @click=${() => this.#set({ vue: null })}>${icon('crosshair')}</button>` : nothing}
      ${on.has('fond') ? html`<button type="button" class="base ${other.key}" aria-label=${'Fond : ' + other.words} title=${'Passer à ' + other.words}
        @click=${() => this.#switchBase()}><span>${other.label}</span></button>` : nothing}
    </div>`;
  }

  /**
   * Its pin (an axis of its group it is detached from, said on the map itself, in use too — whatever its controls:
   * map-options.js mapPin): its own sources fewer than its group's, or only those its group has unticked; a map of
   * France or of the world, iNaturalist's tiles alone. null: none. @param {LayoutState} s @returns {MapPin | null}
   */
  #pin(s) { return mapPin({ portee: this.#p.portee, src: this.#own, group: s.filters.sources }); }

  /** Its own sources (src=; null: none said — its group's all). @returns {string[] | null} */
  get #own() { return Array.isArray(this.params?.src) ? this.params.src : null; }

  /**
   * The pin drawn (#pin): its way back — « Afficher » lets src= go (the cell's own setting, in use too), « Cocher » ticks
   * for the group the sources it shows (its address replaced). @param {LayoutState} s @param {MapPin} pin
   */
  #pinView(s, pin) {
    const act = pin.act, sources = act?.sources;
    const run = !act ? null : sources ? () => s.set({ filtres: obsChanges({ ...s.filters, sources }, { ...OBS_DEFAULTS, sources: s.defaultSources }) }, 'replace')
      : () => this.#set({ src: null });
    return html`<div class="pin" role="group" aria-label="Sources de cette carte" title=${pin.why ?? nothing}>
      <span class="tag">${icon('pin-angle-fill')} ${pin.tag}</span>
      ${pin.line ? html`<span class="line">${pin.line}${act && run ? html` · <button class="link" type="button" @click=${run}>${act.label}</button>` : nothing}</span>` : nothing}
    </div>`;
  }

  /**
   * Bottom left, over the zoom: its pin (#pin), the current plant's chip — and, above it, « hors du résultat » when its
   * group's search no longer finds it (state.js outside: it stays chosen) —, the legend. @param {LayoutState} s @param {Set<string>} on
   */
  #bottomLeft(s, on) {
    const id = s.live.plant, info = s.plantInfo;
    const chip = on.has('plante') && id != null && info?.id === id;
    const pin = this.#pin(s);
    if (!chip && !on.has('legende') && !pin) return nothing;
    const name = chip ? /** @type {{ name: string }} */ (info).name : '';
    return html`<div class="ctl bl">
      ${pin ? this.#pinView(s, pin) : nothing}
      ${chip && s.outside ? html`<span class="outside" role="note" title="La plante choisie n’est pas parmi les plantes trouvées : elle reste choisie (Retour l’enlève)">${name} : hors du résultat</span>` : nothing}
      ${chip ? this.#chip(id, name) : nothing}
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

  /**
   * The legend: what the map's marks and the cell's layers are — its « Noms et réseaux » too when it says its own
   * (noms=), where they show (not on the plan) —, its lines once opened. @param {LayoutState} s
   */
  #legendView(s) {
    const layers = /** @type {string[]} */ (this.params?.layers ?? []);
    const marks = /** @type {string[] | null} */ (this.params?.noms ?? null);
    const landmarks = marks?.length && takesLandmarks(this.#map?.baseShown ?? this.#look?.base ?? mapLook().base)
      ? 'Noms et réseaux : ' + marks.map(k => MAP_LANDMARKS[k] ?? k).join(', ') : null;
    const plant = s.live.plant != null && s.plantInfo?.id === s.live.plant && this.#p.plante !== 'non' ? s.plantInfo.name : null;
    const open = this.params?.legende === true;
    return html`<div class="legend">
      <button type="button" aria-expanded=${String(open)} aria-controls="map-legend" @click=${() => this.#set({ legende: !open })}>Légende</button>
      ${open ? html`<ul id="map-legend" aria-label="Légende de la carte">
        ${s.live.at ? html`<li><i class="outline"></i>La zone (${distanceLabel(s.radius)})</li>` : nothing}
        <li><i></i>Observations des plantes trouvées</li>
        ${plant ? html`<li><i class="obs"></i>${plant} : ses observations</li>` : nothing}
        ${layers.map(l => html`<li><i class="area"></i>${MAP_LAYERS[l]?.label ?? l}</li>`)}
        ${landmarks ? html`<li><i class="lines"></i>${landmarks}</li>` : nothing}
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
    const press = 'Appui long sur la carte, puis « Confirmer » : la zone s’y centre.';
    const hl = P.plante === 'non' ? null : this.#highlight;
    // regroupe: the current plant's observations grouped by where they fall at the zoom shown (gf-map `cluster`).
    const grouped = Boolean(this.params?.regroupe);
    const zoneArea = this.#area;
    const area = wide ? (zoneArea ? { center: zoneArea.center, radius: zoneArea.radius, fit: false, points: [] } : null) : zoneArea;
    // 3d= written: its 2D or 3D fixed, why said in its panel ▦, which offers the common choice back (renderer-follow) —
    // not when its intent says one (map(relief)): then said so, and no way back (without 3d=, the intent's).
    const intended = this.#intended, intent = `son intention « ${MAP_INTENTS[this.params?.intent ?? '']?.label} »`;
    const own3d = d3 !== null && !('3d' in intended);
    const why3d = d3 === null ? nothing : !own3d && d3 === (intended['3d'] === '1')
      ? `Cette carte de l’écran ${d3 ? 'est en 3D' : 'reste en 2D'} (${intent} ; le choix vaut pour elle seule).`
      : `Cette carte de l’écran ${d3 ? 'est en 3D (3d=1' : 'reste en 2D (3d=0'} dans son adresse, ou sa bascule 2D / 3D ; le choix vaut pour elle seule).`;
    // Its own look given by its intent alone (map(protege): its layers; map(terrain): the photos): said so, no way back
    // either. A part written by its address too (map(terrain,layers=parcs)): « Revenir » takes that part back.
    const p = this.params ?? {};
    const written = Boolean(p.opac) || (p.base ?? null) !== (intended.base ?? null) || p.annee != null || p.noms != null
      || (p.layers != null && p.layers.join('+') !== intended.layers);
    const lookWhy = ('base' in intended || 'layers' in intended) && !written ? intent + ' dans l’écran' : '';
    return html`${!s.live.at && this.#pressHint ? hintView(press, () => { this.#pressHint = false; this.requestUpdate(); }, 'press-hint') : nothing}
      <div class="stage"><gf-map no-create press="zone" point-click=${P.toucher === 'rien' ? 'none' : 'pick'} map-3d=${d3 === null ? nothing : d3 ? 'on' : 'off'}
        map-3d-why=${why3d} .own3d=${own3d}
        .look=${this.#look} .lookWhy=${lookWhy} .around3d=${this.#around3d} .view=${this.#view}
        .area=${area} .highlight=${wide || grouped ? null : hl} .cluster=${!wide && grouped ? hl : null}
        .tiles=${wide ? this.#wideTiles : null} .frame=${wide && !this.#view ? { key: P.portee, points: WIDE_FRAMES[P.portee] } : null}
        min-zoom=${P.portee === 'monde' ? 1 : nothing}
        .focusPoint=${this.#focus} .noSearch=${!on.has('lieu')} .noLocate=${!on.has('gps')} .noLayers=${!on.has('couches')} .track=${Boolean(this.params?.autour)}
        .radiusHandle=${!wide && on.has('rayon') ? this.#radiusHandle : null}
        aria-description=${press}
        @point-pick=${(/** @type {CustomEvent} */ e) => this.#onPick(e)} @point-info=${(/** @type {CustomEvent} */ e) => this.#onPress(e)}
        @point-hover=${(/** @type {CustomEvent} */ e) => this.#onHover(e)}
        @radius-change=${(/** @type {CustomEvent} */ e) => s.set({ r: e.detail.radius }, 'replace')}
        @look-change=${(/** @type {CustomEvent} */ e) => this.#onLook(e)} @renderer-follow=${() => this.#set({ '3d': null })}
        @around3d-change=${(/** @type {CustomEvent} */ e) => this.#onAround(e)}
        .data=${this.#dataRows(s)} @data-change=${(/** @type {CustomEvent} */ e) => this.#onData(e.detail)}
        @view-change=${(/** @type {CustomEvent} */ e) => this.#onView(e)} @view-framed=${(/** @type {CustomEvent} */ e) => this.#onFramed(e)}
        @base-shown=${() => this.requestUpdate()}></gf-map>
      ${!wide && on.has('rayon') ? this.#zoneView(s, ctl) : nothing}
      ${this.#topRight(on)}
      ${this.#bottomLeft(s, on)}
      ${this.#bottomRight(s, ctl, area)}</div>`;
  }
}
customElements.define('dl-map', DlMap);
