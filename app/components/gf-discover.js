// @ts-check
// « Découvrir » : the plants around you, the dating-app way. A welcome with one action (« Autour de moi », or a
// commune); how far to look (200 m to 50 km, what iNaturalist's search allows); then the plants observed there
// (iNaturalist, matched to the flora), one card at a time — those in flower this month first — each with a
// short « bio » drawn from its real data (flowering, alerts, protection, how often it is seen here).
// Swipe right: a match (kept in the favourites); left: passed; up (or ⓘ): its sheet. « Matchs » lists them,
// « Toutes » shows every card. A tip at a time on the real element; the other tabs come as they become useful
// (discover.js).

import { LitElement, html, css, nothing, repeat } from 'lit';
import * as db from '../core/db.js';
import { icon } from '../core/icons.js';
import { speciesAround } from '../core/nearby.js';
import { searchPlaces, addressAt } from '../core/geoservices.js';
import { watchLocation } from '../core/geo.js';
import { alertsOf } from '../core/alerts.js';
import { setHarvestMode, StoreController, whenReady } from '../core/store.js';
import { discoverEvents, discoverState, finishDiscover, plantSeen, resetPassed, setDiscoverPoint, setDiscoverRadius, swiped, tipDone, tipSeen, unswipe, PLANTS_BEFORE_FLORE } from '../core/discover.js';
import { lookalikesOf } from '../core/lookalikes.js';
import { scenarioOf } from '../core/scenarios.js';
import { sheetSession } from '../core/sheet-session.js';
import { isFavorite, toggleFavorite } from '../core/collections.js';
import { href } from '../core/router.js';
import { depth, replaceHash } from '../core/history.js';
import { floweringMonths } from './gf-calendar.js';
import { ui } from '../styles/ui.js';
import './gf-plant-detail.js';

/** How far to look, in metres (iNaturalist searches a circle; beyond 50 km the list is a region's, not « around »). */
const DISTANCES = [200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
/** @param {number} m */
const distLabel = m => m >= 1000 ? (m / 1000).toLocaleString('fr-FR') + ' km' : m + ' m';
/** The view chosen (Rencontres, Matchs, Toutes) in each scenario, kept while the app is open. @type {Record<string, string>} */
const lastView = {};
/** A word for the distance, for fun. @param {number} m */
const distMood = m => m <= 200 ? 'Juste devant la porte' : m <= 1000 ? 'Le quartier' : m <= 5000 ? 'Une balade à pied' : m <= 20000 ? 'Un tour à vélo' : 'Toute la région';
const PAGE = 12;
const MONTH = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/**
 * @typedef {{ plant: any, count: number, photo: string | null, blooming: boolean, alerts: { safety: any, edible: any } | null,
 *   confusions?: import('../core/lookalikes.js').Lookalike[] }} Card
 * @typedef {{ id: string, anchor: () => Element | null | undefined, text: string }} Tip
 */

export class GfDiscover extends LitElement {
  static properties = {
    /** The plant open (the address's ?p=). */
    open: { type: Number },
    /** The scenario (the address's ?s=): 'meet' (Rencontres), 'harvest' (Cueillette prudente), 'mosaic'. */
    scenario: {},
    /** Mosaïque: only the plants in flower now. */
    _bloomOnly: { state: true },
    /** ↺: the last swipes, to undo. */
    _history: { state: true },
    _point: { state: true },
    _place: { state: true },
    _cards: { state: true },
    _radius: { state: true },
    /** Choosing how far to look. */
    _asking: { state: true },
    /** 'swipe' (one card at a time), 'matches', 'all'. */
    _view: { state: true },
    /** The match just made (its card), celebrated. */
    _match: { state: true },
    /** The cards the sheet steps through. */
    _sheetIds: { state: true },
    _shown: { state: true },
    _loading: { state: true },
    _error: { state: true },
    _locating: { state: true },
    _query: { state: true },
    _places: { state: true },
    _tip: { state: true },
    _tipBox: { state: true }
  };

  static styles = [ui, css`
    :host { display: block; position: relative; min-height: 0; overflow-y: auto; background: var(--gf-bg, var(--gf-surface-2)); container-type: inline-size; }
    .welcome { max-width: 560px; margin: 0 auto; padding: 48px 20px 32px; display: grid; gap: 18px; text-align: center; }
    .welcome .leaf { font-size: 3rem; color: var(--gf-accent); }
    .welcome h1 { margin: 0; font-size: 1.7rem; line-height: 1.2; }
    .welcome p { margin: 0; color: var(--gf-text-muted); }
    .welcome .go { justify-self: center; font-size: 1.05rem; padding: 12px 26px; min-height: 48px; display: inline-flex; gap: 8px; align-items: center; }
    .or { color: var(--gf-text-muted); font-size: 0.85rem; }
    .commune { position: relative; text-align: left; }
    .commune ul { list-style: none; margin: 4px 0 0; padding: 4px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius); background: var(--gf-surface); box-shadow: var(--gf-shadow); }
    .commune li button { width: 100%; text-align: left; border: 0; background: none; padding: 8px 10px; border-radius: var(--gf-radius-sm); font: inherit; cursor: pointer; }
    .commune li button:hover, .commune li button:focus-visible { background: var(--gf-accent-soft); outline: none; }
    .commune small { color: var(--gf-text-muted); }
    .skip { font-size: 0.85rem; }
    .error { color: var(--gf-danger); font-size: 0.9rem; }

    .list { padding: 14px 16px 90px; max-width: 1100px; margin: 0 auto; }
    .head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin-bottom: 12px; }
    .head h1 { margin: 0; font-size: 1.25rem; }
    .head .where { color: var(--gf-text-muted); font-size: 0.9rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
    @container (min-width: 700px) { .grid { grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 12px; } }
    .card { position: relative; display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start; min-height: 0; border: 0; padding: 0; border-radius: var(--gf-radius); overflow: hidden; background: var(--gf-surface);
      box-shadow: var(--gf-shadow); text-align: left; font: inherit; color: var(--gf-text); cursor: pointer; transition: transform 0.15s; }
    .card:hover { transform: translateY(-2px); }
    .card:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .card[aria-current='true'] { box-shadow: 0 0 0 3px var(--gf-accent); }
    .card .ph { width: 100%; aspect-ratio: 4 / 3; background: var(--gf-surface-2); overflow: hidden; }
    .card img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .card .txt { padding: 8px 10px 10px; display: grid; gap: 2px; }
    .card b { font-size: 1rem; }
    .card i { color: var(--gf-text-muted); font-size: 0.82rem; }
    .chips { position: absolute; top: 8px; left: 8px; right: 8px; display: flex; gap: 4px; flex-wrap: wrap; pointer-events: none; }
    .chip { padding: 2px 8px; border-radius: var(--gf-radius-pill); font-size: 0.72rem; font-weight: 600; background: rgb(255 255 255 / 92%); color: #1f3d1f; }
    .chip.bloom { background: #fdf3c4; color: #6b4e00; }
    .chip.warn { background: #fff1d6; color: var(--gf-warn); }
    .chip.danger { background: #fde2df; color: var(--gf-danger); }
    .seen { position: absolute; right: 8px; bottom: 54px; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--gf-accent); color: #fff; font-size: 0.75rem; }
    .more { display: block; margin: 16px auto 0; }
    .ask { margin-top: 16px; padding: 14px 16px; border-radius: var(--gf-radius); background: var(--gf-surface); box-shadow: var(--gf-shadow); display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .ask p { margin: 0; flex: 1 1 240px; }
    .src { margin-top: 18px; font-size: 0.75rem; color: var(--gf-text-muted); text-align: center; }

    /* Scenarios. */
    .banner-warn { margin: 0 0 12px; padding: 10px 12px; border-radius: var(--gf-radius); background: #fde2df; color: #7a1d16; font-size: 0.88rem; display: flex; gap: 8px; align-items: flex-start; }
    .bloom-only { display: flex; gap: 6px; align-items: center; justify-content: center; margin: 0 0 10px; font-size: 0.9rem; }
    .grid.mosaic { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); grid-auto-flow: dense; gap: 6px; }
    .grid.mosaic .card { border-radius: 10px; }
    .grid.mosaic .card:nth-child(5n + 1) { grid-column: span 2; grid-row: span 2; }
    .grid.mosaic .card .ph { aspect-ratio: 1; height: 100%; }
    .grid.mosaic .card .txt { position: absolute; left: 0; right: 0; bottom: 0; padding: 18px 8px 6px; background: linear-gradient(transparent, rgb(0 0 0 / 70%)); color: #fff; }
    .grid.mosaic .card i { color: #e6e6e6; }
    .mwrap { position: relative; display: grid; }
    .unmatch { position: absolute; z-index: 3; right: 6px; bottom: 6px; min-height: 28px; padding: 2px 10px; border-radius: var(--gf-radius-pill); border: 1px solid var(--gf-border); background: var(--gf-surface); font: inherit; font-size: 0.75rem; display: inline-flex; gap: 4px; align-items: center; cursor: pointer; }
    .round.undo { width: 46px; height: 46px; font-size: 1.05rem; color: #d4a017; }
    .round:disabled { opacity: 0.35; cursor: default; }

    /* How far. */
    .dist { display: grid; gap: 4px; justify-items: center; }
    .dist output { font-size: 2.4rem; font-weight: 800; color: var(--gf-accent); font-variant-numeric: tabular-nums; }
    .dist .mood { color: var(--gf-text-muted); font-style: italic; }
    .dist input { width: min(100%, 420px); accent-color: var(--gf-accent); margin-top: 6px; }
    .dist .ticks { width: min(100%, 420px); display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--gf-text-muted); }
    .views { display: flex; margin: 0 auto 14px; width: fit-content; }
    .views button[aria-selected='true'] { background: var(--gf-accent); color: var(--gf-accent-contrast); }
    .card .heart { position: absolute; z-index: 2; right: 8px; top: 8px; color: #e0245e; font-size: 1.2rem; filter: drop-shadow(0 1px 2px rgb(0 0 0 / 40%)); }
    .empty { text-align: center; padding: 30px 10px; }

    /* The deck: one card, the next under it; dragged, it leans and shows its stamp. */
    .deck-wrap { display: grid; justify-items: center; gap: 14px; }
    .deck { position: relative; width: min(100%, 380px); aspect-ratio: 3 / 4.3; max-height: calc(100dvh - 300px); min-height: 360px; }
    .swipe-card { position: absolute; inset: 0; border-radius: 18px; overflow: hidden; background: #2a3a2a; color: #fff; box-shadow: 0 12px 30px rgb(0 0 0 / 25%);
      touch-action: none; user-select: none; -webkit-user-select: none; cursor: grab; transition: transform 0.25s ease-out; }
    .swipe-card.dragging { transition: none; cursor: grabbing; }
    .swipe-card.fly { transition: transform 0.26s ease-in; }
    .swipe-card.under { transform: scale(0.94) translateY(10px); filter: brightness(0.9); pointer-events: none; }
    .swipe-card img, .swipe-card .nophoto { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
    .swipe-card .nophoto { display: grid; place-items: center; font-size: 4rem; opacity: 0.4; }
    .swipe-card .about { position: absolute; left: 0; right: 0; bottom: 0; padding: 60px 16px 14px; background: linear-gradient(transparent, rgb(0 0 0 / 82%) 45%); }
    .swipe-card h2 { margin: 0 0 6px; font-size: 1.5rem; line-height: 1.15; display: grid; }
    .swipe-card h2 small { font-size: 0.85rem; font-weight: 400; font-style: italic; opacity: 0.85; }
    .bio { margin: 0; padding: 0; list-style: none; display: grid; gap: 3px; font-size: 0.86rem; line-height: 1.35; }
    .stamp { position: absolute; top: 26px; padding: 4px 12px; border: 4px solid; border-radius: 10px; font-size: 1.8rem; font-weight: 900; letter-spacing: 0.08em; opacity: 0; pointer-events: none; }
    .stamp.like { left: 18px; color: #4ade80; transform: rotate(-14deg); opacity: var(--like, 0); }
    .stamp.nope { right: 18px; color: #f87171; transform: rotate(14deg); opacity: var(--nope, 0); }
    .actions { display: flex; gap: 22px; align-items: center; }
    .round { width: 62px; height: 62px; border-radius: 50%; border: 0; display: grid; place-items: center; font-size: 1.6rem; cursor: pointer; background: var(--gf-surface);
      box-shadow: 0 6px 16px rgb(0 0 0 / 18%); transition: transform 0.12s; }
    .round:active { transform: scale(0.92); }
    .round.pass { color: #ef4444; } .round.like { color: #e0245e; } .round.info { width: 46px; height: 46px; font-size: 1.1rem; color: var(--gf-text-muted); }
    .round:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .left { margin: 0; color: var(--gf-text-muted); font-size: 0.85rem; }
    .deck-end { text-align: center; padding: 30px 10px; display: grid; gap: 6px; justify-items: center; }
    .deck-end .big { font-size: 3rem; color: var(--gf-accent); margin: 0; }
    .deck-end p { margin: 0; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; margin-top: 8px; }
    /* The match. */
    .match { position: fixed; inset: 0; z-index: 1004; display: grid; place-content: center; justify-items: center; gap: 12px; padding: 24px; text-align: center;
      background: linear-gradient(160deg, rgb(224 36 94 / 92%), rgb(46 125 50 / 92%)); color: #fff; animation: pop 0.3s ease-out; }
    .match .title { margin: 0; font-size: 2.4rem; font-weight: 900; font-style: italic; transform: rotate(-4deg); text-shadow: 0 3px 0 rgb(0 0 0 / 20%); }
    .match img { width: 180px; height: 180px; border-radius: 50%; object-fit: cover; border: 5px solid #fff; box-shadow: 0 10px 30px rgb(0 0 0 / 30%); }
    .match p { margin: 0; max-width: 340px; }
    .match .secondary { background: transparent; color: #fff; border-color: rgb(255 255 255 / 70%); }
    @keyframes pop { from { opacity: 0; transform: scale(1.06); } }
    @media (prefers-reduced-motion: reduce) { .swipe-card, .swipe-card.fly, .match { transition: none; animation: none; } }

    /* The plant: over the list on a phone; beside it on a wide screen. */
    .sheet { position: fixed; inset: 0; z-index: 950; display: flex; flex-direction: column; background: var(--gf-surface); }
    @media (min-width: 900px) {
      .sheet { left: auto; top: var(--top, 56px); width: min(560px, 48vw); border-left: 1px solid var(--gf-border); box-shadow: var(--gf-shadow-float); }
      :host([opened]) .list { margin-right: min(560px, 48vw); }
    }
    .sheet-head { flex: none; display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--gf-border); }
    .sheet-head strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sheet gf-plant-detail { flex: 1; min-height: 0; }
    .pager { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px calc(6px + env(safe-area-inset-bottom)); border-top: 1px solid var(--gf-border); background: var(--gf-surface); }
    .pager span { color: var(--gf-text-muted); font-size: 0.85rem; font-variant-numeric: tabular-nums; }
    .pager button { display: inline-flex; align-items: center; gap: 4px; }

    /* The tip: a bubble by the element it speaks of, the element ringed. */
    .ring { position: fixed; z-index: 1001; border-radius: 10px; box-shadow: 0 0 0 3px #f5c518, 0 0 0 9px rgb(245 197 24 / 25%); pointer-events: none; transition: all 0.2s; }
    .tip { position: fixed; z-index: 1002; width: min(300px, calc(100vw - 24px)); padding: 12px 14px; border-radius: 12px; background: #1f2a1f; color: #fff;
      box-shadow: 0 10px 30px rgb(0 0 0 / 35%); font-size: 0.92rem; line-height: 1.4; display: grid; gap: 8px; }
    .tip .row { display: flex; justify-content: flex-end; gap: 8px; }
    .tip button { min-height: 32px; padding: 4px 12px; border-radius: var(--gf-radius-pill); border: 0; font: inherit; font-size: 0.85rem; cursor: pointer; }
    .tip .ok { background: #f5c518; color: #1f2a1f; font-weight: 700; }
    .tip .later { background: none; color: #cfd8cf; }
    @media (prefers-reduced-motion: reduce) { .card, .ring { transition: none; } }
  `];

  #store = new StoreController(this);

  constructor() {
    super();
    /** @type {number | null} */
    this.open = null;
    const s = discoverState();
    /** @type {[number, number] | null} */
    this._point = s.point;
    /** @type {string | null} */
    this._place = s.place;
    /** @type {Card[] | null} */
    this._cards = null;
    this._radius = s.radius || 1000;
    this._asking = false;
    /** @type {string | null} */
    this.scenario = null;
    this._view = 'swipe';
    this._bloomOnly = false;
    /** @type {{ id: number, liked: boolean, fav: boolean }[]} */
    this._history = [];
    /** @type {Card | null} */
    this._match = null;
    /** @type {number[]} */
    this._sheetIds = [];
    this._shown = PAGE;
    this._loading = false;
    /** @type {string | null} */
    this._error = null;
    this._locating = false;
    this._query = '';
    /** @type {any[]} */
    this._places = [];
    /** @type {Tip | null} */
    this._tip = null;
    /** @type {{ ring: DOMRect, x: number, y: number } | null} */
    this._tipBox = null;
  }

  #onChange = () => this.requestUpdate();
  #onKey = (/** @type {KeyboardEvent} */ e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (this.open == null) {
      // The deck: ← passes, → matches, ↑ its sheet.
      const t0 = /** @type {HTMLElement} */ (e.composedPath()[0]);
      if (this._view !== 'swipe' || this._match || t0?.closest?.('input, textarea, select')) return;
      const top = this.#deck[0];
      if (!top) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); this.#decide(top, e.key === 'ArrowRight'); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.#openPlant(top.plant.id, this.#deck.map(c => c.plant.id)); }
      return;
    }
    const t = /** @type {HTMLElement} */ (e.composedPath()[0]);
    if (t?.closest?.('input, textarea, select, [contenteditable], gf-media-viewer')) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); this.#step(e.key === 'ArrowRight' ? 1 : -1); }
    else if (e.key === 'Escape') { e.preventDefault(); this.#close(); }
  };
  /** @type {any} */ #tipTimer = 0;

  connectedCallback() {
    super.connectedCallback();
    discoverEvents.addEventListener('change', this.#onChange);
    addEventListener('keydown', this.#onKey);
    // The tip follows its element (scrolling, a sheet loading).
    this.#tipTimer = setInterval(() => this.#placeTip(), 250);
    if (this._point && !this._cards) this.#load();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    discoverEvents.removeEventListener('change', this.#onChange);
    removeEventListener('keydown', this.#onKey);
    clearInterval(this.#tipTimer);
    this.#stopGeo?.();
    this.#abort?.abort();
  }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    const sc = scenarioOf(this.scenario).key;
    // Another scenario: its own view (Mosaïque: the grid), the cards filtered for it.
    if (changed.has('scenario')) {
      this._view = lastView[sc] || (sc === 'mosaic' ? 'all' : 'swipe');
      if (changed.get('scenario') !== undefined && this._point && !this._asking) this.#load();
    } else if (changed.has('_view')) lastView[sc] = this._view;
    if (changed.has('open') && this.open != null) plantSeen(this.open);
    this.toggleAttribute('opened', this.open != null);
  }

  // ── Where ─────────────────────────────────────────────────────────────

  /** @type {(() => void) | null} */ #stopGeo = null;

  #locate() {
    this._error = null;
    this._locating = true;
    this.#stopGeo?.();
    this.#stopGeo = watchLocation(s => {
      if (s.fix) {
        this.#stopGeo?.(); this.#stopGeo = null;
        this._locating = false;
        this.#setPoint(s.fix.coordinates, null);
      } else if (s.error) {
        this.#stopGeo?.(); this.#stopGeo = null;
        this._locating = false;
        this._error = s.error + ' Choisissez plutôt une commune.';
      }
    });
  }

  /** @param {[number, number]} point @param {string | null} place */
  async #setPoint(point, place) {
    this._point = point; this._place = place; this._query = ''; this._places = [];
    setDiscoverPoint(point, place);
    this._cards = null;
    this._asking = true;
    if (!place) {
      const a = await addressAt(point).catch(() => null);
      if (a?.city && this._point === point) { this._place = a.city; setDiscoverPoint(point, a.city); }
    }
  }

  /** @type {any} */ #searchTimer = 0;
  /** @param {string} text */
  #search(text) {
    this._query = text;
    clearTimeout(this.#searchTimer);
    this.#searchTimer = setTimeout(async () => {
      try { this._places = await searchPlaces(text); } catch { this._places = []; }
    }, 250);
  }

  // ── What grows around ────────────────────────────────────────────────

  /** @type {AbortController | null} */ #abort = null;

  async #load() {
    const point = this._point;
    if (!point) return;
    this.#abort?.abort();
    const abort = this.#abort = new AbortController();
    this._loading = true; this._error = null; this._cards = null; this._shown = PAGE;
    try {
      await whenReady();
      const radius = this._radius;
      const found = await speciesAround(point, radius, abort.signal);
      if (abort.signal.aborted) return;
      const month = new Date().getMonth();
      const species = (found?.species || []).filter(s => s.plantId).slice(0, 120);
      const cards = (await Promise.all(species.map(async s => {
        const plant = await db.get('plants', /** @type {number} */ (s.plantId)).catch(() => null);
        if (!plant) return null;
        /** @type {Card} */
        const card = { plant, count: s.count, photo: s.photo ? s.photo.replace(/\/square\./, '/medium.') : plant.thumbnail?.url || null,
          blooming: floweringMonths(plant.flowering).has(month), alerts: null };
        return card;
      }))).filter(Boolean);
      if (abort.signal.aborted) return;
      /** @type {Card[]} */
      let list = /** @type {Card[]} */ (cards);
      if (scenarioOf(this.scenario).key === 'harvest') {
        // Cueillette prudente: only the plants of the Anses / Centres antipoison confusions, the deadly first.
        for (const c of list) c.confusions = await lookalikesOf(c.plant).catch(() => []);
        if (abort.signal.aborted) return;
        const deadly = (/** @type {Card} */ c) => Number((c.confusions || []).some(l => l.pair.severity === 'mortel'));
        list = list.filter(c => c.confusions?.length)
          .sort((a, b) => deadly(b) - deadly(a) || Number(b.confusions?.some(l => l.side === 'edible')) - Number(a.confusions?.some(l => l.side === 'edible')) || b.count - a.count);
      } else {
        // In flower now first, then the most observed.
        list.sort((a, b) => Number(b.blooming) - Number(a.blooming) || b.count - a.count);
      }
      this._cards = list;
      // The alerts of each plant (local data), as they come.
      for (const c of this._cards) alertsOf(c.plant).then(a => { c.alerts = a; this.requestUpdate(); }, () => {});
    } catch (error) {
      if (abort.signal.aborted) return;
      const e = /** @type {Error} */ (error);
      this._error = e.name === 'ModuleOffError' ? 'Le module iNaturalist est désactivé (Réglages › Modules) : il dit ce qui a été observé autour.'
        : navigator.onLine ? 'iNaturalist ne répond pas pour le moment. Réessayez dans un instant.' : 'Hors ligne : la liste des plantes autour a besoin du réseau la première fois.';
    } finally {
      if (!abort.signal.aborted) this._loading = false;
    }
  }

  // ── A plant ───────────────────────────────────────────────────────────

  /** @param {number} id */
  /** @param {number} id @param {number[]} [ids] the cards the sheet steps through */
  #openPlant(id, ids) {
    this._sheetIds = ids || (this._cards || []).map(c => c.plant.id);
    this.#openedHere = true;
    location.hash = href.discover(id, this.scenario);
  }
  /** The plant was opened from the list (Back returns to it), not by a link. */
  #openedHere = false;

  #close() {
    if (depth() > 0 && this.#openedHere) history.back();
    else location.hash = href.discover(null, this.scenario);
  }

  /** @param {number} dir */
  #step(dir) {
    const list = this.#sheetCards;
    const at = list.findIndex(c => c.plant.id === this.open);
    const next = list[at + dir];
    if (!next) return;
    if (this._view === 'all' && at + dir >= this._shown) this._shown = at + dir + 1;
    replaceHash(href.discover(next.plant.id, this.scenario));
    this.open = next.plant.id;
  }

  /** @type {{ x: number, y: number, t: number } | null} */ #touch = null;
  /** A quick sideways swipe on the sheet: the next (or previous) plant — not on a photo, a map or a list that scrolls sideways. */
  #touchStart = (/** @type {TouchEvent} */ e) => {
    const t = /** @type {HTMLElement} */ (e.composedPath()[0]);
    this.#touch = t?.closest?.('gf-media-viewer, gf-sheet-map, .leaflet-container, .thumbs, nav, figure') ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  };
  #touchEnd = (/** @type {TouchEvent} */ e) => {
    const s = this.#touch; this.#touch = null;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6 && Date.now() - s.t < 600) this.#step(dx < 0 ? 1 : -1);
  };

  // ── Tips ──────────────────────────────────────────────────────────────

  get #sheet() { return /** @type {any} */ (this.renderRoot.querySelector('.sheet gf-plant-detail')); }

  /** The tip to show now: the first one not yet understood whose element is on screen. @returns {Tip | null} */
  #nextTip() {
    const seen = discoverState().seen.length;
    const d = this.#sheet?.shadowRoot;
    const rail = () => d?.querySelector('gf-sheet-rail')?.shadowRoot;
    /** @type {Tip[]} */
    const tips = this.open == null ? [
      { id: 'cards', anchor: () => this.renderRoot.querySelector('.swipe-card.top, .card'), text: 'Glissez à droite si elle vous plaît (c’est un match, gardé dans vos favoris), à gauche pour passer, vers le haut — ou touchez — pour sa fiche.' }
    ] : [
      { id: 'alerts', anchor: () => rail()?.querySelector('button.danger, button.warn'), text: 'Une pastille compte les alertes de la plante : protégée, toxique, à ne pas confondre. Touchez-la pour les lire.' },
      { id: 'next', anchor: () => this.renderRoot.querySelector('.pager .next'), text: 'Plante suivante : ce bouton, les flèches ← →, ou balayez la fiche du doigt.' },
      ...seen >= 2 ? [{ id: 'photo', anchor: () => d?.querySelector('figure.hero img'), text: 'Touchez la photo : toutes les images s’ouvrent en grand. Double-tap pour zoomer, et le menu Fleur, Feuille, Fruit quand il y en a.' }] : [],
      ...seen >= 3 ? [{ id: 'fav', anchor: () => d?.querySelector('.action-bar button.fav'), text: 'Gardez celles qui vous plaisent : ♥ les range dans Mes plantes.' }] : [],
      ...tipSeen('fav') ? [{ id: 'spot', anchor: () => d?.querySelector('.action-bar a[href^="#/collection/new"]'), text: 'Vous l’avez devant vous ? « Noter ici » la pose sur votre carte, avec la date.' }] : []
    ];
    return tips.find(t => !tipSeen(t.id) && this.#visible(t.anchor())) || null;
  }

  /** @param {Element | null | undefined} el */
  #visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  }

  #placeTip() {
    if (this._match || this.#drag) { if (this._tip) { this._tip = null; this._tipBox = null; } return; }
    if (discoverState().done && !this._tip) return;
    const tip = this._tip && !tipSeen(this._tip.id) && this.#visible(this._tip.anchor()) ? this._tip : this.#nextTip();
    if (!tip) { if (this._tip) { this._tip = null; this._tipBox = null; } return; }
    const r = /** @type {Element} */ (tip.anchor()).getBoundingClientRect();
    const w = Math.min(300, innerWidth - 24), below = r.bottom + 170 < innerHeight;
    const x = Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2));
    // A large element (the card): the bubble inside its top, never over the buttons under it.
    const big = r.height > innerHeight * 0.4;
    const y = big ? Math.max(12, r.top + 16) : below ? r.bottom + 14 : Math.max(12, r.top - 14 - 150);
    const box = this._tipBox;
    if (tip !== this._tip || !box || Math.abs(box.ring.top - r.top) > 1 || Math.abs(box.ring.left - r.left) > 1 || Math.abs(box.ring.width - r.width) > 1) {
      this._tip = tip;
      this._tipBox = { ring: r, x, y };
    }
  }

  /** @param {string} id */
  #tipOk(id) { tipDone(id); this._tip = null; this._tipBox = null; }

  // ── Render ────────────────────────────────────────────────────────────

  render() {
    return html`${!this._point ? this.#welcome() : this._asking || (!this._cards && !this._loading && !this._error) ? this.#distance() : this.#list()}
      ${this._match ? this.#matchView(this._match) : nothing}
      ${this.open != null ? this.#plantSheet() : nothing}
      ${this._tip && this._tipBox ? this.#tipView(this._tip, this._tipBox) : nothing}`;
  }

  #welcome() {
    return html`<section class="welcome">
      <div class="leaf" aria-hidden="true">${icon('binoculars')}</div>
      <h1>Découvrez les plantes autour de vous !</h1>
      <p>Des célibataires à feuilles vous attendent près d’ici. Glissez à droite celles qui vous plaisent, à gauche les autres.
        Votre position ne sert qu’à cette recherche.</p>
      <button class="primary go" type="button" ?disabled=${this._locating} @click=${() => this.#locate()}>${icon('geo-alt-fill')} ${this._locating ? 'Localisation…' : 'Autour de moi'}</button>
      ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
      <span class="or">ou</span>
      <div class="commune">
        <input type="search" placeholder="Une commune, un lieu-dit…" aria-label="Choisir une commune" autocomplete="off" .value=${this._query}
          @input=${(/** @type {any} */ e) => this.#search(e.target.value)} />
        ${this._places.length ? html`<ul role="listbox" aria-label="Lieux">${this._places.map(p => html`<li><button type="button" role="option"
          @click=${() => this.#setPoint(p.coordinates, p.label)}>${p.label} <small>${p.detail}</small></button></li>`)}</ul>` : nothing}
      </div>
      <a class="link skip" href=${href.search()} @click=${() => finishDiscover()}>Passer : montrer toute l’application</a>
    </section>`;
  }

  /** How far to look: a slider of distances, then the search. */
  #distance() {
    const at = Math.max(0, DISTANCES.indexOf(this._radius));
    return html`<section class="welcome distance">
      <div class="leaf" aria-hidden="true">${icon('geo-alt-fill')}</div>
      <h1>Jusqu’où cherchez-vous ?</h1>
      <p>Autour ${this._place ? 'de ' + this._place : 'de vous'}. Plus c’est loin, plus il y a de prétendantes — et moins elles sont à portée de pied.</p>
      <div class="dist">
        <output>${distLabel(this._radius)}</output>
        <span class="mood">${distMood(this._radius)}</span>
        <input type="range" min="0" max=${DISTANCES.length - 1} step="1" .value=${String(at)} aria-label="Distance de la recherche"
          aria-valuetext=${distLabel(this._radius)} @input=${(/** @type {any} */ e) => { this._radius = DISTANCES[Number(e.target.value)]; }} />
        <div class="ticks" aria-hidden="true"><span>200 m</span><span>50 km</span></div>
      </div>
      <button class="primary go" type="button" @click=${() => { setDiscoverRadius(this._radius); this._asking = false; this._view = 'swipe'; this.#load(); }}>${icon('binoculars')} Voir qui est dans le coin</button>
      <button class="link skip" type="button" @click=${() => { this._point = null; this._asking = false; }}>Changer de lieu</button>
    </section>`;
  }

  /** The cards not yet swiped (passed ones are not shown again; matches neither). */
  get #deck() {
    const s = discoverState();
    return (this._cards || []).filter(c => !s.passed.includes(c.plant.id) && !s.matches.includes(c.plant.id));
  }

  get #matchCards() {
    const ids = discoverState().matches;
    return (this._cards || []).filter(c => ids.includes(c.plant.id));
  }

  /** The cards the open sheet steps through. */
  get #sheetCards() {
    const by = new Map((this._cards || []).map(c => [c.plant.id, c]));
    const list = this._sheetIds.map(id => by.get(id)).filter(Boolean);
    return /** @type {Card[]} */ (list.length ? list : this._cards || []);
  }

  #list() {
    const cards = this._cards;
    const month = MONTH[new Date().getMonth()];
    const km = distLabel(this._radius);
    const s = discoverState();
    const matches = this.#matchCards.length;
    const sc = scenarioOf(this.scenario);
    return html`<section class="list ${sc.key}">
      <div class="head">
        <h1>${sc.key === 'meet' ? '' : sc.title + ' · '}Autour ${this._place ? 'de ' + this._place : 'de vous'}</h1>
        <span class="where">${cards ? `${cards.length} plantes à moins de ${km}${cards.some(c => c.blooming) ? ` · ${cards.filter(c => c.blooming).length} en fleur en ${month}` : ''}` : ''}</span>
        <button class="link" type="button" @click=${() => { this._asking = true; }}>Distance : ${km}</button>
        <button class="link" type="button" @click=${() => { this._point = null; this._cards = null; }}>Changer de lieu</button>
      </div>
      ${sc.key === 'harvest' ? html`<p class="banner-warn" role="note">${icon('exclamation-triangle-fill')} Ne cueillez jamais une plante sans identification certaine :
        chacune de ces plantes a un sosie dangereux (liste de l’Anses et des Centres antipoison).</p>` : nothing}
      ${sc.key === 'harvest' && cards && !cards.length && !this._loading ? html`<div class="deck-end"><p><b>Aucune plante de cueillette observée à moins de ${km}.</b></p>
        ${DISTANCES.find(d => d > this._radius) ? html`<button class="primary" type="button" @click=${() => { const n = /** @type {number} */ (DISTANCES.find(d => d > this._radius)); this._radius = n; setDiscoverRadius(n); this.#load(); }}>Chercher jusqu’à ${distLabel(/** @type {number} */ (DISTANCES.find(d => d > this._radius)))}</button>` : nothing}</div>` : nothing}
      ${sc.key === 'mosaic' && cards?.length ? html`<label class="bloom-only"><input type="checkbox" .checked=${this._bloomOnly} @change=${(/** @type {any} */ e) => { this._bloomOnly = e.target.checked; }} /> En fleur maintenant (${cards.filter(c => c.blooming).length})</label>` : nothing}
      ${cards && cards.length ? html`<div class="views segmented" role="tablist" aria-label="Affichage">
        ${[['swipe', 'Rencontres'], ['matches', `Matchs${matches ? ' · ' + matches : ''}`], ['all', 'Toutes']].map(([k, l]) => html`<button type="button" role="tab"
          aria-selected=${String(this._view === k)} @click=${() => { this._view = k; }}>${l}</button>`)}
      </div>` : nothing}
      ${this._loading ? html`<p class="muted">Recherche des plantes observées autour…</p>` : nothing}
      ${this._error ? html`<p class="error" role="alert">${this._error} <button class="link" type="button" @click=${() => this.#load()}>Réessayer</button></p>` : nothing}
      ${cards && !cards.length && !this._loading ? html`<p class="muted">Aucune plante observée ici pour le moment. Essayez une autre commune.</p>` : nothing}
      ${cards && this._view === 'swipe' ? this.#deckView() : nothing}
      ${cards && this._view === 'matches' ? (matches ? html`<div class="grid">${this.#matchCards.map(c => html`<div class="mwrap">${this.#card(c, this.#matchCards.map(x => x.plant.id))}
          <button class="unmatch" type="button" title="Retirer ce match (et des favoris)" aria-label=${'Retirer ' + (c.plant.vernacularNames?.[0] || c.plant.scientificName) + ' des matchs'}
            @click=${() => this.#unmatch(c)}>${icon('x-lg')} Retirer</button></div>`)}</div>`
        : html`<p class="muted empty">Pas encore de match. Glissez à droite une plante qui vous plaît dans « Rencontres ».</p>`) : nothing}
      ${cards && this._view === 'all' ? this.#allView(cards, sc.key === 'mosaic') : nothing}
      ${cards ? html`
        ${s.seen.length >= 3 && !tipSeen('harvest') ? html`<div class="ask"><p>${icon('lightbulb')} Vous cueillez des plantes sauvages ? Le mode cueillette met les confusions dangereuses en premier, avec la saison et les recettes.</p>
          <button class="primary" type="button" @click=${() => { setHarvestMode(true); tipDone('harvest'); }}>Oui, l’activer</button>
          <button class="secondary" type="button" @click=${() => tipDone('harvest')}>Non merci</button></div>` : nothing}
        <p class="src">Observations confirmées d’iNaturalist ; noms, floraison et alertes de la flore embarquée (TAXREF, Baseflor, INPN, ANSM, Anses).
          ${s.done ? nothing : html`<br />Encore ${Math.max(0, PLANTS_BEFORE_FLORE - s.seen.length)} plante${PLANTS_BEFORE_FLORE - s.seen.length > 1 ? 's' : ''} à rencontrer avant la flore complète.`}</p>` : nothing}
    </section>`;
  }

  // ── Swiping ───────────────────────────────────────────────────────────

  /** « Toutes »: the grid (Mosaïque: large photos, the names over them; « En fleur » filters). @param {Card[]} all @param {boolean} mosaic */
  #allView(all, mosaic) {
    const cards = mosaic && this._bloomOnly ? all.filter(c => c.blooming) : all;
    const ids = cards.map(c => c.plant.id);
    return html`<div class="grid ${mosaic ? 'mosaic' : ''}">${cards.slice(0, this._shown).map(c => this.#card(c, ids, mosaic))}</div>
      ${cards.length > this._shown ? html`<button class="secondary more" type="button" @click=${() => { this._shown += PAGE; }}>Voir plus (${cards.length - this._shown})</button>` : nothing}`;
  }

  /** A match taken back: out of the matches and the favourites. @param {Card} c */
  #unmatch(c) {
    unswipe(c.plant.id);
    if (isFavorite(c.plant.id)) toggleFavorite(c.plant).catch(() => {});
  }

  /** ↺: the last card swiped comes back on top (a match undone: out of the favourites too, if it put it there). */
  #rewind() {
    const last = this._history[this._history.length - 1];
    if (!last) return;
    this._history = this._history.slice(0, -1);
    unswipe(last.id);
    const card = (this._cards || []).find(c => c.plant.id === last.id);
    if (last.fav && card && isFavorite(last.id)) toggleFavorite(card.plant).catch(() => {});
    this._match = null;
  }

  /** The deck: the card on top (dragged), the next one under it, and the three buttons. */
  #deckView() {
    const deck = this.#deck;
    if (!deck.length) {
      const next = DISTANCES.find(d => d > this._radius);
      return html`<div class="deck-end">
        <p class="big">${icon('flower3')}</p>
        <p><b>Vous avez rencontré toutes les plantes du coin !</b></p>
        <p class="muted">${this.#matchCards.length ? `${this.#matchCards.length} match${this.#matchCards.length > 1 ? 's' : ''} — elles vous attendent dans « Matchs ».` : 'Aucun match ? Exigeant·e. Les autres sont peut-être un peu plus loin.'}</p>
        <div class="row">${next ? html`<button class="primary" type="button" @click=${() => { this._radius = next; setDiscoverRadius(next); this.#load(); }}>Chercher jusqu’à ${distLabel(next)}</button>` : nothing}
          ${discoverState().passed.length ? html`<button class="secondary" type="button" @click=${() => resetPassed()}>Revoir celles passées</button>` : nothing}</div>
      </div>`;
    }
    const [top, under] = deck;
    return html`<div class="deck-wrap">
      <div class="deck">
        ${repeat(under ? [under, top] : [top], c => c.plant.id, c => this.#swipeCard(c, c === top))}
      </div>
      <div class="actions" role="group" aria-label="Votre réponse">
        <button class="round undo" type="button" aria-label="Revenir à la carte précédente" title="Revenir à la carte précédente" ?disabled=${!this._history.length} @click=${() => this.#rewind()}>${icon('arrow-counterclockwise')}</button>
        <button class="round pass" type="button" aria-label="Passer" title="Passer (←)" @click=${() => this.#decide(top, false)}>${icon('x-lg')}</button>
        <button class="round info" type="button" aria-label="Voir sa fiche" title="Sa fiche (↑)" @click=${() => this.#openPlant(top.plant.id, this.#deck.map(c => c.plant.id))}>${icon('three-dots')}</button>
        <button class="round like" type="button" aria-label="J’aime : c’est un match" title="Match (→)" @click=${() => this.#decide(top, true)}>${icon('heart-fill')}</button>
      </div>
      <p class="left">${deck.length} plante${deck.length > 1 ? 's' : ''} à rencontrer</p>
    </div>`;
  }

  /** @param {Card} c @param {boolean} top */
  #swipeCard(c, top) {
    const p = c.plant, name = p.vernacularNames?.[0] || p.scientificName;
    return html`<article class="swipe-card ${top ? 'top' : 'under'}" aria-label=${name} data-id=${p.id}
        @pointerdown=${top ? this.#dragStart : null} @pointermove=${top ? this.#dragMove : null} @pointerup=${top ? this.#dragEnd : null} @pointercancel=${top ? this.#dragEnd : null}>
      ${c.photo ? html`<img src=${c.photo} alt="" decoding="async" referrerpolicy="no-referrer" draggable="false" />` : html`<div class="nophoto">${icon('leaf')}</div>`}
      <span class="stamp like">MATCH</span><span class="stamp nope">BOF</span>
      <div class="about">
        <h2>${name}<small>${p.scientificName}</small></h2>
        <ul class="bio">${this.#bio(c).map(line => html`<li>${line}</li>`)}</ul>
      </div>
    </article>`;
  }

  /** A short bio, from the plant's real data — with a wink. @param {Card} c @returns {string[]} */
  #bio(c) {
    const p = c.plant, a = c.alerts, out = [];
    // Cueillette prudente: the confusion first.
    for (const l of (c.confusions || []).slice(0, 2)) {
      const others = l.others.map(o => o.label).join(', ');
      out.push(l.side === 'edible' ? `⚠️ Ne me confondez pas avec ${others}${l.pair.severity === 'mortel' ? ' (mortel)' : ' (toxique)'}. Partie : ${l.pair.part}.`
        : `☠️ Je suis le sosie ${l.pair.severity === 'mortel' ? 'mortel' : 'toxique'} de ${others}.`);
    }
    const months = floweringMonths(p.flowering);
    if (c.blooming) out.push('🌼 En fleur en ce moment : je suis à mon avantage.');
    else if (months.size) out.push(`🗓️ Je fleuris de ${MONTH[[...months][0]]} à ${MONTH[[...months][months.size - 1]]}. Repassez me voir.`);
    if (a?.safety?.tone === 'danger') out.push('☠️ ' + (a.safety.text.find(t => /toxi|mortel|ANSM/i.test(t)) || a.safety.text[0]) + '. On regarde, on ne goûte pas.');
    else if (a?.safety?.text.some(t => /Protégée/.test(t))) out.push('🛡️ Espèce protégée : on se plaît, mais on ne me cueille pas.');
    if (a?.edible) out.push(`🍽️ Comestible, mais j’ai des sosies dangereux (${a.edible.text.length}). Lisez ma fiche avant de m’emmener dîner.`);
    out.push(c.count >= 50 ? `📸 Très populaire ici : ${c.count} observations.` : c.count <= 3 ? `🤫 Discrète : vue ${c.count} fois dans le coin.` : `👀 Vue ${c.count} fois dans le coin.`);
    if (p.family) out.push(`👪 De la famille des ${p.family}.`);
    return out.slice(0, 4);
  }

  /** @type {{ id: number, x: number, y: number, dx: number, dy: number, el: HTMLElement, t: number, vx: number, lx: number, lt: number } | null} */ #drag = null;

  #dragStart = (/** @type {PointerEvent} */ e) => {
    const el = /** @type {HTMLElement} */ (e.currentTarget);
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    this.#drag = { id: Number(el.dataset.id), x: e.clientX, y: e.clientY, dx: 0, dy: 0, el, t: performance.now(), vx: 0, lx: e.clientX, lt: performance.now() };
    el.classList.add('dragging');
  };

  #dragMove = (/** @type {PointerEvent} */ e) => {
    const d = this.#drag;
    if (!d) return;
    d.dx = e.clientX - d.x; d.dy = e.clientY - d.y;
    // The speed of the throw (px / ms), smoothed.
    const now = performance.now();
    if (now > d.lt) { d.vx = 0.7 * d.vx + 0.3 * (e.clientX - d.lx) / (now - d.lt); d.lx = e.clientX; d.lt = now; }
    d.el.style.transform = `translate(${d.dx}px, ${d.dy}px) rotate(${d.dx / 18}deg)`;
    const reach = (d.el.offsetWidth || 300) * 0.3;
    d.el.style.setProperty('--like', String(Math.max(0, Math.min(1, d.dx / reach))));
    d.el.style.setProperty('--nope', String(Math.max(0, Math.min(1, -d.dx / reach))));
  };

  #dragEnd = () => {
    const d = this.#drag;
    this.#drag = null;
    if (!d) return;
    d.el.classList.remove('dragging');
    const card = (this._cards || []).find(c => c.plant.id === d.id);
    // Far enough (30 % of the card's width), or thrown (fast enough, the same way).
    const w = d.el.offsetWidth || 300, h = d.el.offsetHeight || 400;
    const thrown = Math.abs(d.dx) > 40 && Math.abs(d.vx) > 0.6 && Math.sign(d.vx) === Math.sign(d.dx);
    if (card && (Math.abs(d.dx) > w * 0.3 || thrown)) { this.#decide(card, d.dx > 0, d.el); return; }
    if (card && d.dy < -h * 0.18 && Math.abs(d.dx) < w * 0.25) { this.#reset(d.el); this.#openPlant(card.plant.id, this.#deck.map(c => c.plant.id)); return; }
    // A touch without moving: its sheet.
    if (card && Math.hypot(d.dx, d.dy) < 6) { this.#reset(d.el); this.#openPlant(card.plant.id, this.#deck.map(c => c.plant.id)); return; }
    this.#reset(d.el);
  };

  /** @param {HTMLElement} el */
  #reset(el) { el.style.transform = ''; el.style.removeProperty('--like'); el.style.removeProperty('--nope'); }

  /**
   * Right: a match (the favourites, celebrated); left: passed. The card flies off first.
   * @param {Card} card @param {boolean} liked @param {HTMLElement} [el]
   */
  #decide(card, liked, el) {
    const node = el || /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.swipe-card.top'));
    const done = () => {
      if (node) { node.style.transition = 'none'; this.#reset(node); node.classList.remove('fly'); requestAnimationFrame(() => { node.style.transition = ''; }); }
      const fav = liked && !isFavorite(card.plant.id);
      this._history = [...this._history, { id: card.plant.id, liked, fav }].slice(-30);
      swiped(card.plant.id, liked);
      if (liked) {
        if (fav) toggleFavorite(card.plant).catch(() => {});
        if (matchMedia('(pointer: coarse)').matches) navigator.vibrate?.(30);
        this._match = card;
        clearTimeout(this.#matchTimer);
        // The first match waits for the user; the next ones pass by themselves.
        if (discoverState().matches.length > 1) this.#matchTimer = setTimeout(() => { this._match = null; }, 1600);
      }
    };
    if (!node || matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return; }
    node.classList.add('fly');
    node.style.transform = `translate(${liked ? 140 : -140}vw, -40px) rotate(${liked ? 30 : -30}deg)`;
    setTimeout(done, 260);
  }
  /** @type {any} */ #matchTimer = 0;

  /** @param {Card} c */
  #matchView(c) {
    const name = c.plant.vernacularNames?.[0] || c.plant.scientificName;
    return html`<div class="match" role="dialog" aria-label="C’est un match" @click=${(/** @type {Event} */ e) => { if (e.target === e.currentTarget) this._match = null; }}>
      <p class="title">C’est un match !</p>
      ${c.photo ? html`<img src=${c.photo} alt="" referrerpolicy="no-referrer" />` : nothing}
      <p>Vous et <b>${name}</b> vous plaisez mutuellement. Elle vous attend dans « Matchs » et dans Mes plantes (♥).</p>
      <div class="row">
        <button class="primary" type="button" @click=${() => { this._match = null; this.#openPlant(c.plant.id, this.#matchCards.map(x => x.plant.id)); }}>Voir sa fiche</button>
        <button class="secondary" type="button" @click=${() => { this._match = null; }}>Continuer à swiper</button>
      </div>
    </div>`;
  }

  /** @param {Card} c @param {number[]} [ids] @param {boolean} [mosaic] Mosaïque: a touch opens the plant at its images */
  #card(c, ids, mosaic = false) {
    const p = c.plant, name = p.vernacularNames?.[0] || p.scientificName;
    const a = c.alerts, danger = a?.safety?.tone === 'danger' || a?.edible?.tone === 'danger';
    const n = (a?.safety?.count || 0) + (a?.edible?.count || 0);
    return html`<button class="card" type="button" aria-current=${String(this.open === p.id)} @click=${() => { if (mosaic) { sheetSession.anchor = 'images'; sheetSession.anchorBlock = 'media'; sheetSession.anchorOffset = 0; } this.#openPlant(p.id, ids); }}>
      ${discoverState().matches.includes(p.id) ? html`<span class="heart" aria-label="Match">${icon('heart-fill')}</span>` : nothing}
      <div class="ph">${c.photo ? html`<img src=${c.photo} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />` : nothing}</div>
      <div class="chips">${c.blooming ? html`<span class="chip bloom">En fleur</span>` : nothing}
        ${n ? html`<span class="chip ${danger ? 'danger' : 'warn'}">${danger ? 'Attention' : 'À savoir'} · ${n}</span>` : nothing}</div>
      ${discoverState().seen.includes(p.id) ? html`<span class="seen" title="Déjà découverte" aria-label="Déjà découverte">${icon('check-lg')}</span>` : nothing}
      <div class="txt"><b>${name}</b><i>${p.scientificName}</i></div>
    </button>`;
  }

  #plantSheet() {
    const list = this._cards || [];
    const at = list.findIndex(c => c.plant.id === this.open);
    const name = at >= 0 ? list[at].plant.vernacularNames?.[0] || list[at].plant.scientificName : '';
    return html`<section class="sheet" aria-label="Plante" @touchstart=${this.#touchStart} @touchend=${this.#touchEnd}>
      <div class="sheet-head">
        <button class="icon-btn" type="button" aria-label="Retour aux plantes autour" title="Retour (Échap)" @click=${() => this.#close()}>${icon('arrow-left')}</button>
        <strong>${name}</strong>
      </div>
      <gf-plant-detail embedded plant-id=${this.open} view="epure"></gf-plant-detail>
      ${at >= 0 ? html`<nav class="pager" aria-label="Plantes autour">
        <button class="secondary prev" type="button" ?disabled=${at <= 0} @click=${() => this.#step(-1)}>${icon('chevron-left')} Préc.</button>
        <span>${at + 1} / ${list.length}</span>
        <button class="primary next" type="button" ?disabled=${at >= list.length - 1} @click=${() => this.#step(1)}>Suivante ${icon('chevron-right')}</button>
      </nav>` : nothing}
    </section>`;
  }

  /** @param {Tip} tip @param {{ ring: DOMRect, x: number, y: number }} box */
  #tipView(tip, box) {
    const r = box.ring;
    return html`<div class="ring" style=${`left:${r.left - 4}px;top:${r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px`}></div>
      <div class="tip" role="status" style=${`left:${box.x}px;top:${box.y}px`}>
        <span>${tip.text}</span>
        <div class="row"><button class="later" type="button" title="Tous les onglets tout de suite, sans autre astuce" @click=${() => { finishDiscover(); this.#tipOk(tip.id); }}>Tout montrer</button>
          <button class="ok" type="button" @click=${() => this.#tipOk(tip.id)}>Compris</button></div>
      </div>`;
  }
}

customElements.define('gf-discover', GfDiscover);
