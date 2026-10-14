// @ts-check
// What each cell of a free layout shows (« Disposition libre »): the app's own pieces, wired to the layout's shared
// state (state.js) rather than to the address — one adapter per component of the registry (registry.js):
//  - map: the mother map (gf-map; 3D as Réglages › Cartes says): the scope's circle, the latest observations of the
//    plants found in it (those the search keeps), the current plant's own observations lit, the observation chosen.
//    A point touched: its plant is the current one; a long press: the scope moves there. Over it, the scope: its place,
//    its radius (a slider), « Autour de moi », « Toute la France » (no scope);
//  - place: the scope alone — « Autour de moi », a commune (gf-place-search), the radius;
//  - search: Flore's search bar (gf-results-bar: text, sort, filters chosen, « Filtrer par »), its filters (gf-filter-
//    panel, opened by the funnel) and its list; filters and results: each part alone. They read and write the store's
//    query, as in Flore; the scope keeps the search to its plants (state.js);
//  - plant: the plant sheet (gf-plant-detail), whole or one block (plant.wikipedia: its `only`); media: the photos'
//    viewer (gf-media-viewer). Each shows the current plant;
//  - deck: Rencontres' cards (miniapp/kit/ma-deck.js) for the plants found in the scope, the one on top the current
//    plant; a heart: a favourite.
// A link to a plant's sheet anywhere in a cell (a result, a look-alike) makes it the current plant (gf-layout.js).

import { LitElement, html, css, nothing } from 'lit';
import { icon } from '../core/icons.js';
import { moduleOn } from '../core/modules.js';
import { watchLocation } from '../core/geo.js';
import { addressAt } from '../core/geoservices.js';
import { plantViewOf, StoreController } from '../core/store.js';
import { blockStyle } from '../core/sheet-blocks.js';
import { href } from '../core/router.js';
import * as db from '../core/db.js';
import { alertsOf } from '../core/alerts.js';
import { thumbCredit } from '../core/credit.js';
import { isFavorite, toggleFavorite } from '../core/collections.js';
import { ui } from '../styles/ui.js';
import { floweringMonths } from '../components/gf-calendar.js';
import { geoProblem } from '../components/start-screen.js';
import { DISTANCES, distanceAt, distanceEvents } from '../miniapp/kit/cards.js';
import { distanceLabel } from './registry.js';
import { obsId } from './state.js';
import '../components/gf-map.js';
import '../components/gf-place-search.js';
import '../components/gf-results-bar.js';
import '../components/gf-filter-panel.js';
import '../components/gf-plant-list.js';
import '../components/gf-plant-detail.js';
import '../components/gf-media-viewer.js';
import '../miniapp/kit/ma-deck.js';

/**
 * @typedef {import('./state.js').LayoutState} LayoutState
 * @typedef {import('./registry.js').Resolved} Resolved
 * @typedef {import('../miniapp/kit/cards.js').Card} Card
 */

/** A position fixed this long ago at most is taken for « Autour de moi » (ms). */
const FIX_MAX_AGE = 60_000;

/**
 * « Autour de moi »: the position, once (a fix older than a minute is not taken). Rejects with the reason, in French.
 * @returns {Promise<[number, number]>}
 */
export function locateOnce() {
  return new Promise((resolve, reject) => {
    const since = Date.now() - FIX_MAX_AGE;
    let live = true;
    /** @type {() => void} */
    let stop = () => {};
    stop = watchLocation(s => {
      if (!live) return;
      if (s.fix && s.fix.timestamp >= since) { live = false; queueMicrotask(() => stop()); resolve(s.fix.coordinates); }
      else if (s.error) { live = false; queueMicrotask(() => stop()); reject(new Error(geoProblem(s.code ?? null, { place: true }).text)); }
    });
  });
}

/** The scope's place, once found (IGN): written in the state without a new entry. @param {LayoutState} state @param {[number, number]} at */
async function nameScope(state, at) {
  const a = await addressAt(at).catch(() => null);
  if (a?.city && state.live.at === at) state.set({ place: a.city }, 'replace');
}

/** Watches the state: the host drawn again on each change. */
class StateController {
  /** @param {LitElement & { state: LayoutState | null }} host */
  constructor(host) {
    this.host = host;
    /** @type {LayoutState | null} */ this.watched = null;
    this.onChange = () => host.requestUpdate();
    host.addController(this);
  }

  hostUpdate() {
    if (this.host.state === this.watched) return;
    this.watched?.removeEventListener('change', this.onChange);
    this.watched = this.host.state;
    this.watched?.addEventListener('change', this.onChange);
  }

  hostDisconnected() { this.watched?.removeEventListener('change', this.onChange); this.watched = null; }
  hostConnected() { if (this.host.state) { this.watched = this.host.state; this.watched.addEventListener('change', this.onChange); } }
}

/** The scope in words: « 2 km autour de Paris », « Toute la France ». @param {LayoutState} state */
export function scopeWords(state) {
  const { at, place } = state.live;
  return at ? `${distanceLabel(state.radius)} autour ${place ? 'de ' + place : 'du point choisi'}` : 'Toute la France';
}

/** What the scope says of the plants: their count, coming, or why it does not filter. @param {LayoutState} state */
function scopeNote(state) {
  if (!state.live.at) return '';
  if (state.speciesState === 'loading') return 'Plantes de la zone : recherche…';
  if (state.speciesState === 'error') return state.speciesError ?? '';
  const n = state.species?.list.length ?? 0;
  return n ? `${n.toLocaleString('fr-FR')} plante${n > 1 ? 's' : ''} observée${n > 1 ? 's' : ''} dans la zone (iNaturalist)` : 'Aucune plante observée dans la zone (iNaturalist).';
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
`;

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

export class DlMap extends LitElement {
  static properties = { state: { attribute: false }, params: { attribute: false }, _busy: { state: true }, _error: { state: true } };

  static styles = [ui, scopeStyles, css`
    :host { display: block; position: relative; min-height: 0; isolation: isolate; }
    gf-map { position: absolute; inset: 0; display: block; }
    /* Under the map's own address search (whose place picked moves the scope too: its point, below). */
    .panel { position: absolute; z-index: 500; left: 8px; top: 60px; width: min(300px, calc(100% - 64px)); display: grid; gap: 6px; padding: 8px 10px; border-radius: 12px;
      background: color-mix(in srgb, var(--gf-surface) 95%, transparent); box-shadow: var(--gf-shadow); }
    .row { display: flex; flex-wrap: wrap; gap: 6px; }
    .row button { min-height: 32px; padding: 4px 12px; font-size: 0.82rem; }
  `];

  #store = new StoreController(this);

  constructor() {
    super();
    new StateController(this);
    /** @type {LayoutState | null} */ this.state = null;
    /** @type {Record<string, any>} */ this.params = {};
    this._busy = false;
    /** @type {string | null} */ this._error = null;
  }

  /** The map's view held while its cell changes size (a separator dragged beside it). */
  holdFrame() { /** @type {any} */ (this.renderRoot.querySelector('gf-map'))?.holdFrame?.(); }

  /** The plants found (the search, in the scope), as a set of ids: the same set while the results are the same. */
  get #found() {
    const items = this.#store.state.results.items;
    if (this.#foundFor !== items) { this.#foundFor = items; this.#foundSet = new Set(items.map(p => p.id)); }
    return this.#foundSet;
  }
  /** @type {any[] | null} */ #foundFor = null;
  /** @type {Set<number>} */ #foundSet = new Set();

  /** The circle and the observations of the plants found in it: the same object while nothing changed (the map keeps its points). */
  get #area() {
    const s = /** @type {LayoutState} */ (this.state);
    const at = s.live.at;
    if (!at) return null;
    const found = this.#found, plantOf = s.species?.plantOf;
    const memo = this.#areaMemo;
    if (memo && memo.at === at && memo.r === s.radius && memo.pts === s.points && memo.found === found && memo.plantOf === plantOf) return memo.value;
    // The plants the search keeps: their points only (all of them while the plants of the scope are unknown).
    const points = plantOf ? s.points.filter(p => { const id = p.taxonId != null ? plantOf.get(p.taxonId) : undefined; return id !== undefined && found.has(id); }) : s.points;
    const value = { center: at, radius: s.radius, fit: true, leaves: true, points };
    this.#areaMemo = { at, r: s.radius, pts: s.points, found, plantOf, value };
    return value;
  }
  /** @type {any} */ #areaMemo = null;

  /** The current plant's observations in the scope, large, its photo in each. */
  get #highlight() {
    const s = /** @type {LayoutState} */ (this.state);
    const obs = s.plantObs, info = s.plantInfo;
    if (!obs || !info || !obs.points.length) return null;
    if (this.#hlMemo?.key === obs.key + ':' + info.name) return this.#hlMemo.value;
    const sp = s.species?.byPlant.get(info.id);
    const photo = sp?.photo && moduleOn('photos', plantViewOf(this.#store.state)) ? sp.photo.replace(/\/square\./, '/small.') : null;
    const value = { key: obs.key, photo, credit: photo ? sp?.credit ?? null : null, common: info.name, sci: info.sci, taxonId: sp?.taxonId ?? null,
      points: obs.points.map(p => ({ coordinates: p.coordinates, title: info.name, url: p.url, date: p.date, taxonId: sp?.taxonId ?? null, sci: info.sci, plantId: info.id })) };
    this.#hlMemo = { key: obs.key + ':' + info.name, value };
    return value;
  }
  /** @type {{ key: string, value: any } | null} */ #hlMemo = null;

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

  /** A point touched: its plant, the current one (with this observation); one not in the flora: said. @param {CustomEvent} e */
  #onPick(e) {
    const s = /** @type {LayoutState} */ (this.state);
    const p = e.detail.point;
    // Its plant: by its taxon (iNaturalist's), else its name, else the plant it was drawn for (the current one's points).
    const id = (p.taxonId != null ? s.species?.plantOf.get(p.taxonId) : undefined)
      ?? s.species?.list.find(x => p.sci && x.name === p.sci)?.plantId ?? p.plantId ?? undefined;
    if (id == null) { this._error = `${p.common || p.sci || p.title || 'Cette plante'} : pas dans la flore de France de GeoFlora.`; return; }
    this._error = null;
    s.pick(id, { obs: p.url ? obsId(p.url) : null });
  }

  /** A long press on the map: the scope moves there (its place's name found after). @param {CustomEvent} e */
  #onPress(e) {
    const s = /** @type {LayoutState} */ (this.state);
    const at = /** @type {[number, number]} */ (e.detail.coordinates);
    s.setScope(at, null);
    nameScope(s, /** @type {[number, number]} */ (s.live.at));
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
    return html`<gf-map no-create point-click="pick" .base=${this.params.base ?? null} .area=${this.#area} .highlight=${this.#highlight} .focusPoint=${this.#focus}
        @point-pick=${(/** @type {CustomEvent} */ e) => this.#onPick(e)} @point-info=${(/** @type {CustomEvent} */ e) => this.#onPress(e)}></gf-map>
      <div class="panel" role="group" aria-label="Zone de la disposition">
        <div class="where">${icon('crosshair')}<span>${scopeWords(s)}</span>
          ${s.live.at ? html`<button class="icon-btn" type="button" title="Toute la France (sans zone)" aria-label="Toute la France (sans zone)" @click=${() => s.setScope(null)}>${icon('x-lg')}</button>` : nothing}</div>
        ${s.live.at ? radiusSlider(s) : nothing}
        <div class="row"><button type="button" ?disabled=${this._busy} @click=${() => this.#locate()}>${icon('geo-alt')} ${this._busy ? 'Localisation…' : 'Autour de moi'}</button></div>
        <p class="note ${this._error || s.speciesState === 'error' ? 'error' : ''}" role="status">${note || (s.live.at ? '' : 'Appui long sur la carte : la zone s’y centre.')}</p>
      </div>`;
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
      <div class="where">${icon('crosshair')}<span>${scopeWords(s)}</span>
        ${s.live.at ? html`<button class="icon-btn" type="button" title="Toute la France (sans zone)" aria-label="Toute la France (sans zone)" @click=${() => s.setScope(null)}>${icon('x-lg')}</button>` : nothing}</div>
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
  static properties = { state: { attribute: false }, params: { attribute: false }, _wide: { state: true } };

  static styles = [ui, css`
    :host { display: flex; flex-direction: column; min-height: 0; }
    gf-plant-list { flex: 1; min-height: 0; }
    .scope { flex: none; display: flex; align-items: center; gap: 6px; padding: 4px 12px; font-size: 0.78rem; color: var(--gf-text-muted); border-bottom: 1px solid var(--gf-border); background: var(--gf-bg); }
    .scope span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .scope.error { color: var(--gf-danger); }
    .scope button { min-height: 0; padding: 0; }
  `];

  #size = new ResizeObserver(([e]) => { const wide = e.contentRect.width >= GRID_MIN; if (wide !== this._wide) this._wide = wide; });

  constructor() {
    super();
    new StateController(this);
    /** @type {LayoutState | null} */ this.state = null;
    /** @type {Record<string, any>} */ this.params = {};
    this._wide = false;
  }

  connectedCallback() { super.connectedCallback(); this.#size.observe(this); }
  disconnectedCallback() { super.disconnectedCallback(); this.#size.disconnect(); }

  render() {
    const s = this.state;
    if (!s) return nothing;
    const view = this.params.view ?? 'auto';
    const grid = view === 'grid' || (view === 'auto' && this._wide);
    const note = s.live.at ? scopeNote(s) : '';
    return html`${s.live.at ? html`<div class="scope ${s.speciesState === 'error' ? 'error' : ''}" role="status">${icon('crosshair')}<span title=${note}>${scopeWords(s)} · ${note}</span>
        <button class="link" type="button" @click=${() => s.setScope(null)}>Toute la France</button></div>` : nothing}
      <gf-plant-list ?grid=${grid} .current=${s.live.plant}></gf-plant-list>`;
  }
}
customElements.define('dl-results', DlResults);

// ── search ───────────────────────────────────────────────────────────────────────────────────────────────────

export class DlSearch extends LitElement {
  static properties = { state: { attribute: false }, params: { attribute: false }, _filters: { state: true } };

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
    /** @type {Record<string, any>} */ this.params = {};
    /** @type {boolean | null} the filters shown (null: as the cell's parameter says) */
    this._filters = null;
  }

  /** A facet brought into view (a column's funnel in a list): the filters opened on it. @param {string} facet */
  async revealFacet(facet) {
    this._filters = true;
    await this.updateComplete;
    return revealFacet(this.renderRoot.querySelector('gf-filter-panel'), facet);
  }

  updated() { this.toggleAttribute('no-list', this.params.list === false); }

  render() {
    const open = this._filters ?? Boolean(this.params.filters);
    const list = this.params.list !== false;
    return html`<gf-results-bar .wide=${false} count-above @open-filters=${(/** @type {Event} */ e) => { e.stopPropagation(); this._filters = !open; }}></gf-results-bar>
      ${open ? html`<div class="filters" role="region" aria-label="Filtres"><gf-filter-panel></gf-filter-panel></div>` : nothing}
      ${list ? html`<dl-results .state=${this.state} .params=${{ view: 'auto' }}></dl-results>` : nothing}`;
  }
}
customElements.define('dl-search', DlSearch);

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
  static properties = { state: { attribute: false }, _loading: { state: true } };

  static styles = [ui, css`
    :host { display: block; overflow-y: auto; padding: 12px 8px; container-type: size; --deck-max: calc(100cqh - 150px); --deck-min: 220px; }
    .empty { display: grid; gap: 10px; justify-items: center; padding: 24px 12px; text-align: center; color: var(--gf-text-muted); }
    .empty .big { font-size: 2rem; color: var(--gf-accent); margin: 0; }
    .empty .big.warn { color: var(--gf-warn, #b45309); }
  `];

  #store = new StoreController(this);
  #session = new DeckSession();
  /** Plant records read for the cards, by id. @type {Map<number, any>} */
  #plants = new Map();
  #cardsFor = '';

  constructor() {
    super();
    new StateController(this);
    /** @type {LayoutState | null} */ this.state = null;
    this._loading = false;
    this.#session.widen = m => this.state?.set({ r: m }, 'replace');
    this.#session.addEventListener('change', () => this.requestUpdate());
    this.addEventListener('deck-decide', e => this.#decide(/** @type {CustomEvent} */ (e).detail));
    this.addEventListener('deck-open', e => { e.stopPropagation(); this.state?.pick(/** @type {CustomEvent} */ (e).detail.id); });
    this.addEventListener('deck-undo', e => { e.stopPropagation(); this.#undo(); });
  }

  /**
   * The cards: the plants found in the scope (the first DECK_MAX, in the search's order), and the current plant when
   * it is not among them (on top: the deck always shows it); made again when they change. Not before the scope's
   * plants are known (the search is not kept to them yet): « Les cartes arrivent… » while they come — and only then:
   * iNaturalist failing, the deck says so (render), never waits for cards that will not come.
   */
  async #cards() {
    const s = /** @type {LayoutState} */ (this.state);
    const species = s.species;
    if (!species) { this._loading = s.speciesState === 'loading'; return; }
    const ids = this.#store.state.results.items.map(p => p.id).filter(id => species.byPlant.has(id)).slice(0, DECK_MAX);
    const current = s.live.plant;
    if (current != null && !ids.includes(current)) ids.unshift(current);
    const key = species.key + '|' + ids.join(',');
    if (key === this.#cardsFor) return;
    this.#cardsFor = key;
    this._loading = true;
    const month = new Date().getMonth();
    const cards = (await Promise.all(ids.map(async id => {
      const plant = this.#plants.get(id) ?? await db.get('plants', id).catch(() => null);
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
    if (first && s.live.plant == null) s.pick(first.plant.id, { how: 'replace' });
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
    if (next) this.state?.pick(next.plant.id, { how: 'replace' });
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
    this.state?.pick(last.id, { how: 'replace' });
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
   * The scope's plants could not be had (iNaturalist down, offline, its module off): no cards — said, with what to
   * do (« Réessayer », or the module turned on), instead of cards of another scope or a wait without end.
   * @param {LayoutState} s
   */
  #failed(s) {
    const off = s.speciesFailure === 'off';
    const why = off ? 'Le module iNaturalist est désactivé.' : s.speciesFailure === 'offline' ? 'Hors ligne : iNaturalist est injoignable.' : 'iNaturalist ne répond pas.';
    return html`<div class="empty" role="status"><p class="big warn">${icon('exclamation-triangle-fill')}</p><p><b>${why}</b></p>
      <p>Les cartes sont les plantes qu’iNaturalist a vues dans la zone : sans lui, pas de cartes${off ? '' : ' pour l’instant'}.</p>
      ${off ? html`<p><a href=${href.settings()}>Réglages › Modules</a></p>`
        : html`<button class="primary" type="button" @click=${() => s.retryScope()}>${icon('arrow-counterclockwise')} Réessayer</button>`}</div>`;
  }
}
customElements.define('dl-deck', DlDeck);

// ── a cell ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * What a cell shows: its component's piece, given the state; an unknown component: what is wrong and how to fix it.
 * @param {Resolved} r @param {{ state: LayoutState, view: string, plant: number | null, first: { id: number, name: string } | null }} ctx
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
  if (id === 'map') return html`<dl-map .state=${state} .params=${r.params}></dl-map>`;
  if (id === 'place') return html`<dl-place .state=${state}></dl-place>`;
  if (id === 'search') return html`<dl-search .state=${state} .params=${r.params}></dl-search>`;
  if (id === 'results') return html`<dl-results .state=${state} .params=${r.params}></dl-results>`;
  if (id === 'filters') return html`<div class="scroll pad"><gf-filter-panel></gf-filter-panel></div>`;
  if (id === 'deck') return html`<dl-deck .state=${state}></dl-deck>`;
  // A plant cell: the current plant, or how to choose one.
  const plant = ctx.plant;
  if (plant == null) {
    return html`<div class="placeholder quiet" role="note">${icon(r.spec.icon)}<p>Aucune plante choisie : touchez un résultat, un point de la carte ou une carte.</p>
      ${ctx.first ? html`<button type="button" @click=${() => state.pick(/** @type {any} */ (ctx.first).id)}>Voir ${ctx.first.name}</button>` : nothing}</div>`;
  }
  const view = r.params.mode ?? ctx.view;
  if (id === 'media') {
    return moduleOn('photos', /** @type {any} */ (view))
      ? html`<gf-media-viewer plant-id=${plant} .view=${view} presentation=${r.params.style ?? blockStyle(/** @type {any} */ (view), 'media')}></gf-media-viewer>`
      : html`<p class="placeholder quiet">Photos en ligne désactivées (<a href=${href.settings()}>Réglages › Modules</a>).</p>`;
  }
  return r.view
    ? html`<gf-plant-detail embedded only=${r.view.key} plant-id=${plant} view=${view}></gf-plant-detail>`
    : html`<gf-plant-detail embedded plant-id=${plant} view=${view}></gf-plant-detail>`;
}
