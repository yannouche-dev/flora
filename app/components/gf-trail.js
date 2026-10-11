// @ts-check
// « Parcours botanique » (a scenario of Découvrir): very simple, made for a walk. Start where you are (or in a
// commune): the parcours is a place of « Mes plantes ». Then name the plants you meet — typed or said — the flora
// suggests them, one touch adds each where you stand; the map of the parcours shows them as you go. A small card
// tells the parcours (its name, its plants, your position); « Terminer » closes it (it stays in Mes plantes).

import { LitElement, html, svg, css, nothing, repeat } from 'lit';
import { icon } from '../core/icons.js';
import { watchLocation } from '../core/geo.js';
import { searchPlaces } from '../core/geoservices.js';
import { findPlants } from '../core/search.js';
import { entriesOf, getPlace, lastEntry, newPlace, plantMarkers, savePlace, spotEvents, withPlant, withoutPlant, refreshMembership } from '../core/collections.js';
import * as db from '../core/db.js';
import { href } from '../core/router.js';
import { ui } from '../styles/ui.js';
import './gf-map.js';
import './gf-voice-button.js';

/** The parcours being walked (its place id), and those walked before. */
const KEY = 'geoflora.trail', LIST = 'geoflora.trails';
const read = (/** @type {string} */ k, /** @type {any} */ d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const write = (/** @type {string} */ k, /** @type {any} */ v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not kept */ } };

const dayName = () => new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const timeOf = (/** @type {string} */ iso) => { try { return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

/** Plants proposed at first, and added by each « Voir plus ». */
const STEP = 12;


// ── The start's picture: a walk among flowers ────────────────────────────────
// Flat, outlined shapes drawn upright from their base (0, 0); each pops up in turn along the path, then sways.

/** @param {number} x @param {number} y @param {number} s scale @param {number} d delay (s) @param {any} body */
const plant = (x, y, s, d, body) => svg`<g transform="translate(${x} ${y}) scale(${s})"><g class="pop" style="--d:${d}s">${body}</g></g>`;

const daisy = svg`<path class="stem" d="M0 0 Q-2 -12 0 -22"/><path class="o" d="M0 -9 Q-10 -14 -11 -6 Q-5 -4 0 -9Z" fill="var(--leaf2)"/>
  ${[0, 45, 90, 135, 180, 225, 270, 315].map(a => svg`<ellipse class="o" cx="0" cy="-33" rx="3.2" ry="6.5" fill="var(--petal)" transform="rotate(${a} 0 -26)"/>`)}
  <circle class="o" cx="0" cy="-26" r="4.4" fill="var(--sun)"/>`;
const tulip = svg`<path class="stem" d="M0 0 Q3 -12 0 -24"/><path class="o" d="M0 -6 Q12 -10 12 -20 Q4 -16 0 -6Z" fill="var(--leaf)"/>
  <path class="o" d="M-8 -26 Q-9 -40 -4 -42 L0 -36 L4 -42 Q9 -40 8 -26 Q0 -20 -8 -26Z" fill="var(--red)"/>`;
const bell = svg`<path class="stem" d="M0 0 Q-1 -16 6 -26"/><path class="o" d="M0 -10 Q-9 -16 -10 -8 Q-4 -6 0 -10Z" fill="var(--leaf2)"/>
  <path class="o" d="M1 -24 Q2 -36 9 -35 Q15 -33 13 -22 L11 -20 L9 -23 L7 -20 L5 -23 L3 -20 Z" fill="var(--violet)"/>`;
const poppy = svg`<path class="stem" d="M0 0 Q-3 -14 0 -26"/>
  ${[[-6, -30], [6, -30], [-5, -38], [5, -38]].map(([cx, cy]) => svg`<circle class="o" cx=${cx} cy=${cy} r="6.4" fill="var(--pink)"/>`)}
  <circle class="o" cx="0" cy="-34" r="3.4" fill="var(--ink)"/>`;
const puff = svg`<path class="stem" d="M0 0 Q2 -14 0 -26"/>
  <g class="spin"><circle cx="0" cy="-35" r="9.5" fill="var(--petal)" stroke="var(--ink)" stroke-width="1.4" stroke-dasharray="1.6 3"/>
  ${[0, 60, 120, 180, 240, 300].map(a => svg`<path d="M0 -35 L0 -43" stroke="var(--ink)" stroke-width="1.2" stroke-linecap="round" transform="rotate(${a} 0 -35)"/>`)}</g>
  <circle cx="0" cy="-35" r="2" fill="var(--ink)"/>`;
const sprout = svg`<path class="stem" d="M0 0 Q-1 -7 0 -12"/>
  <path class="o" d="M0 -9 Q-13 -16 -15 -4 Q-6 -2 0 -9Z" fill="var(--leaf2)"/>
  <path class="o" d="M0 -11 Q12 -20 15 -8 Q6 -5 0 -11Z" fill="var(--leaf)"/>`;
const leaf = svg`<path class="o" d="M0 0 Q-9 -12 0 -22 Q9 -12 0 0Z" fill="var(--leaf)"/><path d="M0 -2 L0 -18" stroke="var(--ink)" stroke-width="1" stroke-linecap="round"/>`;

/** The walk: a start pin, a dotted path drawing itself, flowers and leaves along it, a flag, a butterfly. */
const trailArt = () => html`<svg class="art" viewBox="0 -6 320 196" role="img" aria-label="Un chemin parmi les fleurs">
  <defs><mask id="walk-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="320" height="190">
    <path class="walk" pathLength="1" d="M34 156 C 92 158 66 104 126 104 S 190 150 232 114 S 272 54 292 48" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round"/>
  </mask></defs>
  <path d="M8 168 Q 70 136 150 150 T 312 138 L 312 190 L 8 190 Z" fill="var(--ground)"/>
  <ellipse cx="250" cy="70" rx="56" ry="14" fill="var(--ground)" opacity="0.7"/>
  <path class="trail" mask="url(#walk-mask)" d="M34 156 C 92 158 66 104 126 104 S 190 150 232 114 S 272 54 292 48"/>
  ${plant(68, 138, 1.35, 0.25, daisy)}
  ${plant(100, 122, 1.1, 0.45, sprout)}
  ${plant(150, 98, 1.3, 0.6, tulip)}
  ${plant(172, 150, 1.25, 0.75, bell)}
  ${plant(206, 104, 1, 0.9, daisy)}
  ${plant(218, 168, 1.1, 1.0, sprout)}
  ${plant(250, 142, 1.2, 1.1, puff)}
  ${plant(262, 76, 1.15, 1.25, poppy)}
  ${plant(22, 184, 0.9, 0.15, leaf)}
  ${plant(120, 176, 0.8, 0.55, leaf)}
  ${plant(302, 172, 0.95, 1.35, leaf)}
  <g transform="translate(34 156) scale(1.25)"><g class="pop" style="--d:0s">
    <path class="o" d="M0 0 C -8 -10 -10 -14 -10 -20 A10 10 0 1 1 10 -20 C 10 -14 8 -10 0 0Z" fill="var(--path)"/>
    <circle cx="0" cy="-20" r="4" fill="var(--petal)"/></g></g>
  <g transform="translate(292 48) scale(1.25)"><g class="pop" style="--d:1.45s">
    <path d="M0 0 L0 -30" stroke="var(--ink)" stroke-width="2.2" stroke-linecap="round"/>
    <path class="o" d="M0 -30 Q10 -33 20 -27 Q10 -23 0 -19Z" fill="var(--sun)"/></g></g>
  <g transform="translate(104 36) scale(1.2)"><g class="fly">
    <ellipse class="o wing" cx="-6" cy="0" rx="7" ry="9" fill="var(--sun)"/>
    <ellipse class="o wing r" cx="6" cy="0" rx="7" ry="9" fill="var(--pink)"/>
    <path d="M0 -8 L0 8" stroke="var(--ink)" stroke-width="2.4" stroke-linecap="round"/></g></g>
</svg>`;

export class GfTrail extends LitElement {
  static properties = {
    _trail: { state: true },
    _fix: { state: true },
    _geoError: { state: true },
    _q: { state: true },
    _hits: { state: true },
    _searching: { state: true },
    _fresh: { state: true },
    _listening: { state: true },
    _focusAt: { state: true },
    _toast: { state: true },
    _past: { state: true },
    _places: { state: true },
    _locating: { state: true },
    _shown: { state: true }
  };

  static styles = [ui, css`
    :host { display: block; position: relative; height: 100%; background: var(--gf-bg, var(--gf-surface-2)); container-type: inline-size; }
    .wrap { display: grid; grid-template-columns: minmax(0, 1fr); min-height: 100%; }
    /*
     * Walking. A phone: the parcours' card, the map (always in sight), the plants noted, and the search at the
     * bottom, under the thumb — its suggestions open above it. Wider: the same column on the left, the map
     * on the right.
     */
    .wrap.on { position: relative; height: 100%; min-height: 0; grid-template-areas: "head" "map" "list" "dock"; grid-template-rows: auto minmax(180px, 1fr) auto auto; }
    .side { display: contents; }
    .head { grid-area: head; padding: 10px 12px 8px; }
    .mapcol { grid-area: map; position: relative; min-height: 0; }
    .mapcol gf-map { position: absolute; inset: 0; display: block; }
    .list { grid-area: list; min-height: 0; max-height: 30dvh; overflow-y: auto; padding: 8px 12px 4px; box-sizing: border-box; border-top: 1px solid var(--gf-border); background: var(--gf-bg, var(--gf-surface-2)); }
    .dock { grid-area: dock; position: relative; z-index: 5; padding: 8px 12px calc(8px + env(safe-area-inset-bottom, 0px)); background: var(--gf-surface); border-top: 1px solid var(--gf-border); box-shadow: 0 -6px 18px rgb(0 0 0 / 8%); }
    .sheet { position: absolute; left: 0; right: 0; bottom: 100%; max-height: min(62dvh, 560px); overflow-y: auto; display: grid; gap: 6px; align-content: start;
      padding: 10px 12px 12px; background: var(--gf-bg, var(--gf-surface-2)); border-top: 1px solid var(--gf-border); border-radius: 16px 16px 0 0; box-shadow: 0 -10px 28px rgb(0 0 0 / 16%); }
    @container (min-width: 900px) {
      .wrap.on { grid-template-columns: minmax(360px, 480px) minmax(0, 1fr); grid-template-areas: "side map"; grid-template-rows: minmax(0, 1fr); }
      .side { grid-area: side; display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--gf-border); }
      .head { padding: 14px 14px 10px; }
      .list { flex: 1; max-height: none; border-top: 0; padding: 4px 14px; }
      .dock { padding: 10px 14px 14px; }
    }
    .col { padding: 14px 14px 90px; display: grid; align-content: start; gap: 12px; max-width: 640px; width: 100%; margin: 0 auto; box-sizing: border-box; }
    /* Starting: one action. */
    .start { text-align: center; gap: 14px; padding-top: 40px; }
    /* The start: a walk drawn as a dotted path, flowers and leaves popping up along it (flat, outlined, a bit funky). */
    .art { justify-self: center; width: min(380px, 100%); height: auto; overflow: visible;
      --ink: var(--gf-text, #1f2a1f); --leaf: #4f9a5c; --leaf2: #7cc36b; --sun: #f5c518; --red: #e4572e; --pink: #f28ab2; --violet: #8e6cc8; --petal: #ffffff;
      --ground: var(--gf-accent-soft, #e2eedf); --path: var(--gf-accent, #2f6b3a); }
    .art .o { stroke: var(--ink); stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round; }
    .art .stem { fill: none; stroke: var(--leaf); stroke-width: 2.4; stroke-linecap: round; }
    .art .trail { fill: none; stroke: var(--path); stroke-width: 3.2; stroke-linecap: round; stroke-dasharray: 0.1 9; }
    .art .pop { transform-box: fill-box; transform-origin: 50% 100%; animation: pop 0.55s cubic-bezier(0.3, 1.7, 0.5, 1) both, sway 3.4s ease-in-out infinite; animation-delay: var(--d, 0s), calc(var(--d, 0s) + 0.6s); }
    .art .walk { stroke-dasharray: 1; stroke-dashoffset: 1; animation: walk 1.6s ease-out 0.1s forwards; }
    .art .fly { animation: fly 4.5s ease-in-out infinite; }
    .art .wing { transform-box: fill-box; transform-origin: 100% 50%; animation: flap 0.35s ease-in-out infinite alternate; }
    .art .wing.r { transform-origin: 0% 50%; }
    .art .spin { transform-box: fill-box; transform-origin: center; animation: spin 18s linear infinite; }
    @keyframes pop { from { transform: scale(0); } }
    @keyframes sway { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
    @keyframes walk { to { stroke-dashoffset: 0; } }
    @keyframes fly { 0%, 100% { transform: translate(0, 0); } 25% { transform: translate(10px, -8px); } 50% { transform: translate(22px, 2px); } 75% { transform: translate(8px, 8px); } }
    @keyframes flap { to { transform: scaleX(0.45); } }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .art .pop, .art .fly, .art .wing, .art .spin { animation: none; } .art .walk { animation: none; stroke-dashoffset: 0; } }
    .start h1 { margin: 0; font-size: 1.6rem; line-height: 1.2; }
    .start p { margin: 0; color: var(--gf-text-muted); }
    .start .go { justify-self: center; min-height: 52px; padding: 12px 28px; font-size: 1.08rem; display: inline-flex; gap: 8px; align-items: center; }
    .start .or { font-size: 0.85rem; color: var(--gf-text-muted); }
    .commune { position: relative; text-align: left; }
    .commune input, .search input { width: 100%; box-sizing: border-box; font: inherit; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-pill); background: var(--gf-surface); color: var(--gf-text); }
    .commune input { padding: 10px 16px; }
    .places { list-style: none; margin: 4px 0 0; padding: 4px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius); background: var(--gf-surface); box-shadow: var(--gf-shadow); }
    .places button { width: 100%; text-align: left; border: 0; background: none; padding: 8px 10px; border-radius: var(--gf-radius-sm); font: inherit; cursor: pointer; }
    .places button:hover { background: var(--gf-accent-soft); }
    .past { text-align: left; display: grid; gap: 6px; margin-top: 10px; }
    .past h2 { margin: 0; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--gf-text-muted); }
    .past button { display: flex; justify-content: space-between; gap: 8px; width: 100%; text-align: left; padding: 10px 12px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius); background: var(--gf-surface); font: inherit; cursor: pointer; }
    .past button small { color: var(--gf-text-muted); }
    /* Walking: the parcours' card, the search, the plants. */
    .card { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 4px 12px; align-items: center; padding: 12px 14px; border-radius: 16px; background: var(--gf-surface); box-shadow: var(--gf-shadow); }
    .card .pin { grid-row: span 2; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; background: var(--gf-accent); color: #fff; font-size: 1.1rem; }
    .card .title { display: flex; align-items: center; gap: 6px; min-width: 0; border-radius: 8px; padding: 2px 6px; margin-left: -6px; cursor: text; }
    .card .title:hover, .card .title:focus-within { background: var(--gf-surface-2); }
    .card .title:focus-within { box-shadow: inset 0 -2px 0 var(--gf-accent); }
    .card .name { flex: 1; min-width: 0; font: inherit; font-weight: 700; font-size: 1.05rem; border: 0; background: none; padding: 2px 0; color: var(--gf-text); outline: none; text-overflow: ellipsis; }
    .card .title .bi { color: var(--gf-text-muted); font-size: 0.85rem; flex: none; }
    .card .meta { grid-column: 2; font-size: 0.8rem; color: var(--gf-text-muted); display: flex; gap: 8px; flex-wrap: wrap; }
    .card .meta .gps.off { color: var(--gf-warn); }
    .card .end { grid-row: span 2; }
    .search { position: relative; }
    .search input { padding: 13px 48px 13px 46px; font-size: 1.08rem; }
    .bar { display: flex; align-items: center; gap: 10px; }
    .bar .search { flex: 1; min-width: 0; }
    .search.listening input { border-color: var(--gf-danger, #dc2626); box-shadow: 0 0 0 3px color-mix(in srgb, var(--gf-danger, #dc2626) 22%, transparent); }
    .search.listening input::placeholder { color: var(--gf-danger, #dc2626); }
    .search input:focus { border-color: var(--gf-accent); outline: none; box-shadow: var(--gf-focus); }
    .search input::-webkit-search-cancel-button { display: none; }
    .search .lens { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: var(--gf-text-muted); font-size: 1.1rem; pointer-events: none; }
    .search .tools { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); display: flex; gap: 2px; align-items: center; }
    .hits { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .hit { display: grid; grid-template-columns: 52px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 6px; border-radius: 14px; background: var(--gf-surface); box-shadow: var(--gf-shadow); }
    .th { width: 52px; height: 52px; border-radius: 10px; overflow: hidden; background: var(--gf-surface-2); display: grid; place-items: center; color: var(--gf-text-muted); }
    .th img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .hit .t { display: grid; min-width: 0; line-height: 1.25; }
    .hit .t b { font-size: 1rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hit .t i { font-size: 0.82rem; color: var(--gf-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .add { min-height: 44px; padding: 0 16px; border-radius: var(--gf-radius-pill); font-weight: 700; display: inline-flex; gap: 6px; align-items: center; font-size: 0.95rem; }
    .muted { color: var(--gf-text-muted); margin: 0; }
    .more { justify-self: center; }
    .list h2 { margin: 2px 2px 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--gf-text-muted); display: flex; justify-content: space-between; }
    .mine { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
    .mine li { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto auto; gap: 10px; align-items: center; padding: 6px 8px; border-radius: 12px; background: var(--gf-surface); }
    .mine li.fresh { box-shadow: inset 0 0 0 2px var(--gf-accent); }
    .mine .th { cursor: pointer; border: 0; padding: 0; color: var(--gf-accent); font-size: 1.05rem; }
    .nth, .times { font-size: 0.75rem; font-weight: 600; color: var(--gf-accent); white-space: nowrap; }
    .hint { margin: 0; padding: 6px 2px; color: var(--gf-text-muted); font-size: 0.92rem; }
    .mine .th { width: 40px; height: 40px; }
    .mine a { color: inherit; text-decoration: none; min-width: 0; display: grid; }
    .mine a b { font-size: 0.95rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mine a i { font-size: 0.78rem; color: var(--gf-text-muted); }
    .mine small { color: var(--gf-text-muted); font-size: 0.78rem; font-variant-numeric: tabular-nums; }
    .toast { position: absolute; z-index: 20; left: 12px; right: 12px; margin: 0 auto; width: fit-content; bottom: calc(84px + env(safe-area-inset-bottom, 0px)); display: flex; gap: 12px; align-items: center; padding: 10px 14px 10px 16px;
      border-radius: var(--gf-radius-pill); background: #1f2a1f; color: #fff; box-shadow: 0 10px 30px rgb(0 0 0 / 35%); font-size: 0.92rem; animation: up 0.25s ease-out; }
    .toast button { border: 0; background: none; color: #9be15d; font: inherit; font-weight: 700; cursor: pointer; padding: 4px; }
    @keyframes up { from { opacity: 0; transform: translateY(10px); } }
    @container (max-width: 899px) {
      .card { padding: 8px 10px; gap: 2px 10px; border-radius: 14px; }
      .card .pin { width: 32px; height: 32px; font-size: 0.95rem; }
      .card .name { font-size: 1rem; }
      .card .end { min-height: 36px; padding: 0 12px; }
    }
    @media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
  `];

  constructor() {
    super();
    /** @type {any} */
    this._trail = null;
    /** @type {{ coordinates: [number, number], accuracy: number } | null} */
    this._fix = null;
    /** @type {string | null} */
    this._geoError = null;
    this._q = '';
    /** @type {any[]} */
    this._hits = [];
    this._searching = false;
    /** The occurrence just added (lit in the list). @type {string | null} */
    this._fresh = null;
    /** The microphone is open (the field says « Parlez… »). */
    this._listening = false;
    /** A plant of the list touched: the map shows it. @type {[number, number] | null} */
    this._focusAt = null;
    /** @type {{ text: string, undo?: () => void } | null} */
    this._toast = null;
    /** @type {any[]} */
    this._past = [];
    /** @type {any[]} */
    this._places = [];
    this._locating = false;
    /** How many of the hits are shown (« Voir plus » adds STEP). */
    this._shown = STEP;
  }

  /** @type {(() => void) | null} */ #stopGeo = null;
  #onSpots = () => this.#reload();

  connectedCallback() {
    super.connectedCallback();
    spotEvents.addEventListener('change', this.#onSpots);
    this.#reload();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    spotEvents.removeEventListener('change', this.#onSpots);
    this.#stopGeo?.();
    this.#stopGeo = null;
  }

  /** The parcours walked (and those before), from Mes plantes. */
  async #reload() {
    const id = read(KEY, null);
    const trail = id ? await getPlace(id).catch(() => undefined) : undefined;
    this._trail = trail || null;
    if (!trail && id) write(KEY, null);
    const ids = /** @type {string[]} */ (read(LIST, []));
    this._past = (await Promise.all(ids.filter(x => x !== id).map(x => getPlace(x).catch(() => undefined)))).filter(Boolean).slice(0, 5);
    if (this._trail) this.#follow();
  }

  /** Where I am, followed while walking. */
  #follow() {
    if (this.#stopGeo) return;
    this.#stopGeo = watchLocation(s => {
      if (s.fix) { this._fix = { coordinates: s.fix.coordinates, accuracy: s.fix.accuracy }; this._geoError = null; }
      else if (s.error) this._geoError = s.error;
    });
  }

  /** « Commencer ici »: located, the parcours created there. */
  #startHere() {
    this._locating = true;
    this._geoError = null;
    const stop = watchLocation(s => {
      if (s.fix) { queueMicrotask(() => stop()); this._locating = false; this.#create(s.fix.coordinates, null); }
      else if (s.error) { queueMicrotask(() => stop()); this._locating = false; this._geoError = s.error + ' Choisissez plutôt une commune.'; }
    });
  }

  /** @param {[number, number]} at @param {string | null} where */
  async #create(at, where) {
    const place = newPlace(at, { name: 'Parcours du ' + dayName() + (where ? ' · ' + where : ''), notes: 'Parcours botanique' });
    await savePlace(place);
    write(KEY, place.id);
    write(LIST, [place.id, ...(/** @type {string[]} */ (read(LIST, []))).filter(x => x !== place.id)].slice(0, 20));
    await refreshMembership().catch(() => {});
    this._trail = place;
    this.#follow();
    await this.updateComplete;
    /** @type {HTMLInputElement | null} */ (this.renderRoot.querySelector('.search input'))?.focus();
  }

  /** @type {any} */ #placeTimer = 0;
  /** @param {string} text */
  #searchPlace(text) {
    clearTimeout(this.#placeTimer);
    this.#placeTimer = setTimeout(async () => { try { this._places = text.trim() ? await searchPlaces(text) : []; } catch { this._places = []; } }, 250);
  }

  /** @type {any} */ #findTimer = 0;
  /** The flora's plants for what is typed (or said), as it is typed. @param {string} text @param {boolean} [now] */
  #find(text, now = false) {
    this._q = text;
    clearTimeout(this.#findTimer);
    const run = async () => {
      const q = text.trim();
      if (!q) { this._hits = []; return; }
      this._searching = true;
      const hits = await findPlants(q).catch(() => []);
      if (this._q === text) { this._hits = hits; this.#hitsFor = text; this._shown = STEP; this._searching = false; }
      return hits;
    };
    if (now) return run();
    this.#findTimer = setTimeout(run, 160);
    return null;
  }

  /** @returns {HTMLInputElement | null} */
  get #input() { return this.renderRoot.querySelector('.dock .search input'); }

  /** Text put in the field by the app (dictation, clearing, after an add) — then searched. @param {string} text @param {boolean} [now] */
  #type(text, now = true) {
    const input = this.#input;
    if (input && input.value !== text) input.value = text;
    return this.#find(text, now);
  }

  /** The words the hits shown answer (Entrée never adds a plant found for fewer letters). */
  #hitsFor = '';

  /** Entrée: the first plant for what is typed now — searched at once when the hits are not yet for it. @param {string} text */
  async #addFirst(text) {
    const hits = this.#hitsFor === text ? this._hits : await this.#find(text, true);
    if (hits?.[0] && this._q === text) this.#add(hits[0]);
  }

  /**
   * A plant added to the parcours, where I stand (else at the parcours' point) — again if it is already there:
   * the same species met further on is another occurrence, at its own spot.
   * @param {any} hit
   */
  async #add(hit) {
    const trail = this._trail;
    if (!trail) return;
    const plant = await db.get('plants', hit.id).catch(() => null) || { id: hit.id, scientificName: hit.scientificName, vernacularName: hit.vernacularName };
    const position = this._fix ? { coordinates: this._fix.coordinates, accuracy: Math.round(this._fix.accuracy) } : undefined;
    const next = withPlant(trail, plant, position, { again: true });
    const added = /** @type {any} */ (lastEntry(next)).id;
    await savePlace(next);
    this._trail = next;
    this._fresh = added;
    this._focusAt = null;
    const name = hit.vernacularName || hit.scientificName;
    const n = entriesOf(next, plant.id).length;
    this.#say(`${name} ajoutée au parcours${n > 1 ? ` (${n}e fois)` : ''}${position ? ', ici' : ''}`, async () => { const back = withoutPlant(/** @type {any} */ (this._trail), added); await savePlace(back); this._trail = back; });
    // Ready for the next one.
    this.#type('');
    this.#input?.focus();
  }

  /** One occurrence out of the parcours (the plant's others stay). @param {string} entryId */
  async #remove(entryId) {
    const next = withoutPlant(this._trail, entryId);
    await savePlace(next);
    this._trail = next;
  }

  /** @type {any} */ #toastTimer = 0;
  /** @param {string} text @param {() => void} [undo] */
  #say(text, undo) {
    clearTimeout(this.#toastTimer);
    this._toast = { text, undo };
    this.#toastTimer = setTimeout(() => { this._toast = null; }, 4500);
  }

  /** « Terminer »: the parcours stays in Mes plantes; another one can start. */
  #end() {
    write(KEY, null);
    this.#stopGeo?.(); this.#stopGeo = null;
    this._trail = null; this._q = ''; this._hits = [];
    this.#reload();
  }

  /** @param {any} place */
  #resume(place) {
    write(KEY, place.id);
    this._trail = place;
    this.#follow();
    this.#reload();
  }

  /** @param {string} name */
  async #rename(name) {
    const n = name.trim();
    if (!n || !this._trail || n === this._trail.properties.name) return;
    const next = { ...this._trail, properties: { ...this._trail.properties, name: n.slice(0, 80) } };
    await savePlace(next);
    this._trail = next;
  }

  render() {
    const t = this._trail;
    if (!t) return this.#starting();
    const plants = [...t.properties.plants].sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
    return html`<div class="wrap on">
      <div class="side">
        <div class="head">${this.#card(t)}</div>
        <section class="list" aria-label="Les plantes du parcours">
          ${plants.length ? html`<h2><span>Le parcours</span><span>${this.#count(t)}</span></h2>
          <ul class="mine">${repeat(plants, e => e.id, e => this.#row(t, e))}</ul>`
          : html`<p class="hint">Tapez ou dites le nom d’une plante (« ortie », « pissenlit »…) : la flore la propose, un « Ajouter » la pose sur la carte, là où vous êtes.</p>`}
        </section>
        <div class="dock">
          ${this._q ? html`<div class="sheet" aria-label="Plantes proposées">${this.#hitsView(t)}</div>` : nothing}
          <div class="bar">
            <div class="search ${this._listening ? 'listening' : ''}" role="search">
              <span class="lens" aria-hidden="true">${icon('search')}</span>
              <!-- No value binding: the keyboard's own dictation (and its composition) is never disturbed. -->
              <input type="search" enterkeyhint="search" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"
                placeholder=${this._listening ? 'Parlez : « ortie », « pissenlit »…' : 'Quelle plante voyez-vous ?'} aria-label="Nommer une plante (la flore propose)"
                @input=${(/** @type {any} */ e) => this.#find(e.target.value)}
                @keydown=${(/** @type {KeyboardEvent} */ e) => {
                  if (e.isComposing) return;
                  if (e.key === 'Enter') { e.preventDefault(); this.#addFirst(/** @type {any} */ (e.target).value); }
                  if (e.key === 'Escape') this.#type(''); }} />
              ${this._q ? html`<span class="tools"><button class="icon-btn" type="button" aria-label="Effacer" @click=${() => this.#type('')}>${icon('x-lg')}</button></span>` : nothing}
            </div>
            <gf-voice-button size="large" fallback
              @voice-state=${(/** @type {CustomEvent} */ e) => { this._listening = e.detail.state !== 'idle'; }}
              @voice-text=${(/** @type {CustomEvent} */ e) => this.#type(e.detail.text, e.detail.final)}
              @voice-fallback=${() => this.#input?.focus()}></gf-voice-button>
          </div>
        </div>
      </div>
      <div class="mapcol">${this.#map(t)}</div>
      ${this._toast ? html`<div class="toast" role="status">${icon('check-lg')} <span>${this._toast.text}</span>
        ${this._toast.undo ? html`<button type="button" @click=${() => { this._toast?.undo?.(); this._toast = null; }}>Annuler</button>` : nothing}</div>` : nothing}
    </div>`;
  }

  /** « 12 observations · 9 plantes » (a plant met several times counts once among the plants). @param {any} t */
  #count(t) {
    const n = t.properties.plants.length, species = new Set(t.properties.plants.map((/** @type {any} */ e) => e.plantId)).size;
    if (!n) return 'Aucune plante encore';
    return n > species ? `${n} observations · ${species} plante${species > 1 ? 's' : ''}` : `${n} plante${n > 1 ? 's' : ''}`;
  }

  /** A plant noted on the way: touched, the map shows it; its name opens its sheet; ✕ takes this occurrence out. @param {any} t @param {any} e */
  #row(t, e) {
    const same = entriesOf(t, e.plantId);
    const nth = same.length > 1 ? same.indexOf(e) + 1 : 0;
    const name = e.vernacularName || e.scientificName;
    return html`<li class=${e.id === this._fresh ? 'fresh' : ''}>
      <button class="th" type="button" title="Voir sur la carte" aria-label=${'Voir ' + name + ' sur la carte'} @click=${() => { this._focusAt = e.coordinates; }}>${icon('geo-alt-fill')}</button>
      <a href=${href.plant(e.plantId)}><b>${name}${nth ? html` <span class="nth">n° ${nth}</span>` : nothing}</b>${e.vernacularName ? html`<i>${e.scientificName}</i>` : nothing}</a>
      <small>${timeOf(e.addedAt)}</small>
      <button class="icon-btn" type="button" aria-label=${'Retirer ' + name + (nth ? ' n° ' + nth : '') + ' du parcours'} title="Retirer du parcours" @click=${() => this.#remove(e.id)}>${icon('x-lg')}</button>
    </li>`;
  }

  /** The parcours, small: its name (always editable), its plants, my position; « Terminer ». @param {any} t */
  #card(t) {
    const gps = this._fix ? `Position ±${Math.round(this._fix.accuracy)} m` : this._geoError ? 'Position introuvable : les plantes vont au point du parcours' : 'Recherche de votre position…';
    return html`<div class="card" aria-label="Le parcours">
      <span class="pin" aria-hidden="true">${icon('geo-alt-fill')}</span>
      <label class="title" title="Renommer le parcours">
        <input class="name" .value=${t.properties.name} aria-label="Nom du parcours" maxlength="80" enterkeyhint="done" autocomplete="off"
          @keydown=${(/** @type {KeyboardEvent} */ e) => { const i = /** @type {HTMLInputElement} */ (e.target);
            if (e.key === 'Enter') i.blur();
            if (e.key === 'Escape') { i.value = t.properties.name; i.blur(); } }}
          @change=${(/** @type {any} */ e) => this.#rename(e.target.value)}
          @blur=${(/** @type {any} */ e) => { if (!e.target.value.trim()) e.target.value = t.properties.name; }} />
        ${icon('pencil')}
      </label>
      <button class="end secondary" type="button" @click=${() => this.#end()}>Terminer</button>
      <span class="meta"><span>${this.#count(t)}</span><span class="gps ${this._fix ? '' : 'off'}">${gps}</span></span>
    </div>`;
  }

  /** The flora's suggestions: each with its photo, its names and a large « Ajouter ». @param {any} t */
  #hitsView(t) {
    if (!this._hits.length) return html`<p class="muted">${this._searching ? 'Recherche dans la flore…' : `Aucune plante de la flore pour « ${this._q} ».`}</p>`;
    const shown = this._hits.slice(0, this._shown);
    const more = this._hits.length - shown.length;
    return html`<ul class="hits" aria-label="Plantes proposées">${repeat(shown, h => h.id, h => {
      // Already met: it can be added again (another occurrence, here).
      const times = entriesOf(t, h.id).length;
      return html`<li class="hit">
        <span class="th">${h.thumbnail?.url ? html`<img src=${h.thumbnail.url} alt="" loading="lazy" referrerpolicy="no-referrer" @error=${(/** @type {any} */ e) => e.target.remove()} />` : icon('flower1')}</span>
        <span class="t"><b>${h.vernacularName || h.scientificName}</b><i>${h.vernacularName ? h.scientificName + ' · ' : ''}${h.family || ''}</i>
          ${times ? html`<span class="times">${icon('check-lg')} Déjà ${times === 1 ? 'une fois' : times + ' fois'} dans le parcours</span>` : nothing}</span>
        <button class="primary add" type="button" @click=${() => this.#add(h)}
          aria-label=${(times ? 'Ajouter encore ' : 'Ajouter ') + (h.vernacularName || h.scientificName) + ' au parcours'}>${icon('plus-lg')} ${times ? 'Encore' : 'Ajouter'}</button>
      </li>`;
    })}</ul>
    ${more > 0 ? html`<button class="more secondary" type="button" @click=${() => { this._shown += STEP; }}>Voir ${Math.min(more, STEP)} plante${Math.min(more, STEP) > 1 ? 's' : ''} de plus (${this._hits.length} en tout)</button>` : nothing}`;
  }

  /** The map of the parcours: its point, each plant where it was added; me, followed. @param {any} t */
  #map(t) {
    const markers = plantMarkers([t]);
    // Framed on the whole parcours (its start and every plant), again as it grows; a plant of the list touched: on it.
    const points = this._focusAt ? [this._focusAt] : [t.geometry.coordinates, ...markers.map(m => m.coordinates)].filter(Boolean);
    const frame = { key: 'trail:' + t.id + ':' + points.map(c => c.join(',')).join(';'), maxZoom: this._focusAt ? 19 : 17, points, ease: true };
    return html`<gf-map no-search no-create .spots=${[t]} .plants=${markers} plant-zoom="0" .frame=${frame} track></gf-map>`;
  }

  /** No parcours yet: one action — start here (or in a commune); or take one up again. */
  #starting() {
    return html`<div class="wrap"><div class="col start">
      ${trailArt()}
      <h1>Votre parcours botanique</h1>
      <p>Marchez, nommez les plantes que vous croisez : chacune prend sa place sur la carte de votre parcours.</p>
      <button class="primary go" type="button" ?disabled=${this._locating} @click=${() => this.#startHere()}>${icon('geo-alt-fill')} ${this._locating ? 'Localisation…' : 'Commencer ici'}</button>
      ${this._geoError ? html`<p class="muted" role="alert">${this._geoError}</p>` : nothing}
      <span class="or">ou partir d’une commune</span>
      <div class="commune">
        <input type="search" placeholder="Une commune, un lieu-dit…" aria-label="Partir d’une commune" autocomplete="off" @input=${(/** @type {any} */ e) => this.#searchPlace(e.target.value)} />
        ${this._places.length ? html`<ul class="places" role="listbox" aria-label="Lieux">${this._places.map(p => html`<li><button type="button" role="option"
          @click=${() => { this._places = []; this.#create(p.coordinates, p.label); }}>${p.label} <small>${p.detail}</small></button></li>`)}</ul>` : nothing}
      </div>
      ${this._past.length ? html`<div class="past"><h2>Reprendre un parcours</h2>
        ${this._past.map(p => html`<button type="button" @click=${() => this.#resume(p)}><span>${p.properties.name}</span><small>${p.properties.plants.length} plante${p.properties.plants.length > 1 ? 's' : ''}</small></button>`)}</div>` : nothing}
    </div></div>`;
  }
}

customElements.define('gf-trail', GfTrail);
