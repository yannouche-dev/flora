// @ts-check
// « Parcours botanique » (a scenario of Découvrir): very simple, made for a walk. Start where you are (or in a
// commune): the parcours is a place of « Mes plantes ». Then name the plants you meet — typed or said — the flora
// suggests them, one touch adds each where you stand; the map of the parcours shows them as you go. A small card
// tells the parcours (its name, its plants, your position); « Terminer » closes it (it stays in Mes plantes).

import { LitElement, html, css, nothing, repeat, svg } from 'lit';
import { icon } from '../core/icons.js';
import { geoProblem, startScreen, startStyles } from './start-screen.js';
import { watchLocation, whenGranted } from '../core/geo.js';
import { photoOf } from '../core/thumb.js';
import { atPlace, placeNameAt } from '../core/geoservices.js';
import { findPlants } from '../core/search.js';
import { distance, entriesOf, getPlace, lastEntry, newPlace, plantMarkers, savePlace, spotEvents, updatePlace, withPlant, withoutPlant, refreshMembership } from '../core/collections.js';
import * as db from '../core/db.js';
import { href, parse } from '../core/router.js';
import { encodeCollection, share } from '../core/share.js';
import { ui } from '../styles/ui.js';
import { PaneSizer } from '../core/panes.js';
import { altitudeOf, fillAltitudes, formatAltitude, profileOf } from '../core/altitude.js';
import { walkOf } from '../core/walk.js';
import { config } from '../config.js';
import './gf-map.js';
import './gf-voice-button.js';
import './gf-thumb.js';
import { openMap3d } from './gf-map3d.js';

/** The parcours being walked (its place id), those walked before, and the one just ended (its recap, until left). */
const KEY = 'geoflora.trail', LIST = 'geoflora.trails', DONE = 'geoflora.trailDone';
// eslint-disable-next-line no-restricted-syntax -- a setting of this view only, read and written in a try (storage may be off)
const read = (/** @type {string} */ k, /** @type {any} */ d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
// eslint-disable-next-line no-restricted-syntax -- a setting of this view only, read and written in a try (storage may be off)
const write = (/** @type {string} */ k, /** @type {any} */ v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not kept */ } };

/** A new parcours' name, until the place where it starts is known (« Mon parcours botanique en forêt de … »). */
const NAMED = 'Mon parcours botanique';

/** The map of a parcours shows its plants, not its place. */
const NO_SPOTS = /** @type {any[]} */ ([]);

/** « Ajouter » (here): a + on a marker. */
const addPin = html`<span class="addpin" aria-hidden="true">${icon('geo-alt-fill')}<i>${icon('plus-lg')}</i></span>`;

/** « Commencer ici » takes a position at most this old (ms): the shared watch may still hold one from an hour ago. */
const FIX_MAX_AGE = 60_000;

/** Plants proposed at first, and added by each « Voir plus ». */
const STEP = 12;

/** Two plants further apart in time: a pause (taken up another day), not counted in the walk's time. */
const PAUSE_MS = 2 * 3600e3;

/**
 * While a parcours is walked, the keyboard shrinks the page (its search and the menu stay right above the keys):
 * `interactive-widget=resizes-content` (Chrome, Firefox), else gf-app fits itself to the visual viewport (Safari) —
 * told by `data-fit-keyboard`. Elsewhere, the browser's own way (the page under the keyboard, scrolled to the field).
 * @param {boolean} on
 */
function fitKeyboard(on) {
  const root = document.documentElement;
  if (root.hasAttribute('data-fit-keyboard') === on) return;
  root.toggleAttribute('data-fit-keyboard', on);
  // gf-app fits itself again at once (the keyboard may be up as the parcours is entered or left).
  window.dispatchEvent(new Event('fit-keyboard'));
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  const rest = (meta.getAttribute('content') || '').split(',').map(x => x.trim()).filter(x => x && !x.startsWith('interactive-widget'));
  meta.setAttribute('content', [...rest, ...(on ? ['interactive-widget=resizes-content'] : [])].join(', '));
}


export class GfTrail extends LitElement {
  static properties = {
    _trail: { state: true },
    _fix: { state: true },
    _geoError: { state: true },
    /** Why « Commencer ici » failed (the start screen's words, from geo.js's code). */
    _startError: { state: true },
    _q: { state: true },
    _hits: { state: true },
    _searching: { state: true },
    _fresh: { state: true },
    _listening: { state: true },
    _sel: { state: true },
    _selEntry: { state: true },
    _toast: { state: true },
    _past: { state: true },
    _locating: { state: true },
    _shown: { state: true },
    /** The search field touched by the hand (the keyboard up): the suggestions come over the parcours, even before a letter. */
    _peek: { state: true },
    /** The parcours just ended: its recap (« Terminer »). */
    _done: { state: true },
    /** Why its « Vue 3D » did not open (no WebGL2, the module off), said under its map. */
    _note3d: { state: true }
  };

  static styles = [ui, startStyles, css`
    :host { display: block; position: relative; height: 100%; background: var(--gf-bg, var(--gf-surface-2)); container-type: inline-size; }
    .wrap { display: grid; grid-template-columns: minmax(0, 1fr); min-height: 100%; }
    /*
     * Walking. A phone: the parcours' card, the map (always in sight), the plants noted, and the search at the
     * bottom, under the thumb — its suggestions open above it. Wider: the same column on the left, the map
     * on the right.
     */
    .wrap.on { position: relative; height: 100%; min-height: 0; overflow: clip; grid-template-areas: "head" "map" "list" "dock"; grid-template-rows: minmax(0, auto) minmax(0, 1fr) minmax(0, auto) auto; }
    .side { display: contents; }
    .head { grid-area: head; padding: 10px 12px 8px; min-height: 0; overflow: hidden; }
    .mapcol { grid-area: map; position: relative; min-height: 0; overflow: hidden; }
    /* Its row may be small (landscape, the keyboard up): the map keeps to it, never over the plants. */
    .mapcol gf-map { position: absolute; inset: 0; display: block; min-height: 0; }
    .list { grid-area: list; min-height: 0; max-height: 30dvh; overflow-y: auto; padding: 8px 12px 4px; box-sizing: border-box; border-top: 1px solid var(--gf-border); background: var(--gf-bg, var(--gf-surface-2)); }
    .dock { grid-area: dock; position: relative; z-index: 5; padding: 8px 12px calc(8px + env(safe-area-inset-bottom, 0px)); background: var(--gf-surface); border-top: 1px solid var(--gf-border); box-shadow: 0 -6px 18px rgb(0 0 0 / 8%); }
    /*
     * Searching: the suggestions rise from the search over the parcours (its card, its map, its plants), which
     * stay where they are underneath — nothing is laid out again, the map is not redrawn. Only the suggestions,
     * the search and the menu are seen; an « Ajouter », and they go down again: the card and the map are back.
     */
    /* Under the thumb: the suggestions hold on to the search — the best one right above the field, the others
       upwards, « Voir plus » at the top (in that order for the keyboard and the screen readers too); it is
       scrolled from the bottom, and stays so when it grows or shrinks (the keyboard). */
    .sheet { grid-area: 1 / 1 / 4 / 2; z-index: 4; min-height: 0; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 6px;
      padding: 10px 12px 12px; background: var(--gf-bg, var(--gf-surface-2)); border-radius: 16px 16px 0 0; box-shadow: 0 -10px 28px rgb(0 0 0 / 16%);
      transform: translateY(calc(100% + 24px)); visibility: hidden; transition: transform 0.26s cubic-bezier(0.3, 0.7, 0.4, 1), visibility 0s linear 0.26s; }
    .sheet.open { transform: none; visibility: visible; transition: transform 0.26s cubic-bezier(0.2, 0.8, 0.3, 1), visibility 0s; }
    .head, .mapcol, .list { transition: opacity 0.2s ease; }
    .seeking .head, .seeking .mapcol, .seeking .list { opacity: 0; }
    .sheet > :first-child { margin-top: auto; }
    /* The separator between the parcours and the map (wide screens). */
    .wrap > .split { display: none; width: 9px; margin-left: -4px; z-index: 6; cursor: col-resize; position: relative; touch-action: none; }
    .wrap > .split::after { content: ''; position: absolute; inset: 0 4px; transition: background 0.12s; }
    .wrap > .split:hover::after, .wrap > .split:focus-visible::after, .wrap > .split.dragging::after { background: var(--gf-accent); inset: 0 3px; }
    .wrap > .split:focus-visible { outline: none; }
    .wrap > .guide { position: absolute; top: 0; bottom: 0; left: -1px; width: 3px; background: var(--gf-accent); z-index: 7; pointer-events: none; }
    .wrap > .guide span { position: absolute; top: 50%; left: 8px; padding: 2px 8px; border-radius: var(--gf-radius-pill); background: var(--gf-accent); color: var(--gf-accent-contrast); font-size: 0.75rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
    @media (pointer: coarse) {
      .wrap > .split { width: 24px; margin-left: -12px; }
      .wrap > .split::before { content: ''; position: absolute; top: 50%; left: 50%; width: 10px; height: 44px; translate: -50% -50%; border-radius: 5px;
        background: var(--gf-surface); border: 1px solid var(--gf-border); box-shadow: 0 1px 4px rgb(0 0 0 / 18%); z-index: 1; }
    }
    :host(.resizing) { cursor: col-resize; user-select: none; }
    .sheet .hint { padding: 4px 4px 0; }
    @container (min-width: 900px) {
      .wrap.on { grid-template-columns: minmax(360px, 480px) 0 minmax(0, 1fr); grid-template-areas: "side split map"; grid-template-rows: minmax(0, 1fr); }
      /* A width chosen (the separator): kept while the map keeps 360 px. */
      .wrap.on.sized { grid-template-columns: max(320px, min(var(--w-side), calc(100% - 360px))) 0 minmax(0, 1fr); }
      .wrap > .split { display: block; grid-area: split; }
      .side { grid-area: side; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; min-height: 0; overflow: hidden; border-right: 1px solid var(--gf-border); }
      .head { grid-area: 1 / 1; padding: 14px 14px 10px; }
      .list { grid-area: 2 / 1; max-height: none; border-top: 0; padding: 4px 14px; }
      .dock { grid-area: 3 / 1; padding: 10px 14px 14px; }
      .sheet { grid-area: 1 / 1 / 3 / 2; border-radius: 0; box-shadow: none; padding: 12px 14px; }
      /* Wide: the map stays in sight beside the suggestions. */
      .seeking .mapcol { opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      .sheet, .sheet.open { transform: none; transition: opacity 0.12s, visibility 0s linear 0.12s; opacity: 0; }
      .sheet.open { opacity: 1; transition: opacity 0.12s, visibility 0s; }
      .head, .mapcol, .list { transition: none; }
    }
    /* The parcours ended: its map, its numbers, its plants; « Partager » big, the other ways smaller. */
    /* The parcours ended: the start screen's template, its picture the map of the parcours and the plants met. */
    .wrap.done { align-content: start; }
    .start .art > .recap { display: grid; gap: 10px; }
    .start .art:has(> .recap) { width: min(100%, 420px); }
    @media (max-height: 500px) and (min-aspect-ratio: 3/2) { .start .art > .recap .recap-map { height: 160px; } }
    .recap-map { position: relative; height: clamp(140px, 26dvh, 240px); border-radius: 16px; overflow: hidden; box-shadow: var(--gf-shadow); }
    .recap-map gf-map { position: absolute; inset: 0; display: block; }
    /* « Vue 3D », over the recap's map (above Leaflet's panes and controls). */
    .recap-map .map3d { position: absolute; top: 8px; left: 8px; z-index: 1000; min-height: 44px; padding: 0 14px; gap: 6px; border-radius: 999px;
      background: var(--gf-surface); color: var(--gf-text); border: 1px solid var(--gf-border); box-shadow: var(--gf-shadow); font-weight: 600; }
    .note3d { margin: 0; font-size: 0.8rem; color: var(--gf-text-muted); text-align: center; }
    .note3d:empty { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    .met { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
    .met .more-n { align-self: center; font-size: 0.8rem; font-weight: 700; color: var(--gf-text-muted); padding: 0 4px; }
    /* The walk's altitude profile, under the plants met. */
    .profile { margin: 0; }
    .profile svg { display: block; width: 100%; height: auto; }
    .profile .area { fill: color-mix(in srgb, var(--gf-accent) 18%, transparent); }
    .profile .line { fill: none; stroke: var(--gf-accent); stroke-width: 2; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
    .profile circle { fill: var(--gf-surface); stroke: var(--gf-accent); stroke-width: 1.5; }
    .profile figcaption { text-align: center; font-size: 0.75rem; color: var(--gf-text-muted); font-variant-numeric: tabular-nums; }
    .recap-of { display: block; color: var(--gf-text); font-weight: 600; }
    .search input { width: 100%; box-sizing: border-box; font: inherit; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-pill); background: var(--gf-surface); color: var(--gf-text); }
    /* Walking: the parcours' card, the search, the plants. */
    /* The parcours, compact: its name and its two actions on one line, what it counts and the position under it. */
    .card { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 0 8px; align-items: center; padding: 6px 6px 6px 10px; border-radius: 14px; background: var(--gf-surface); box-shadow: var(--gf-shadow); }
    .card .pin { grid-row: 1 / 3; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--gf-accent); color: #fff; font-size: 0.85rem; }
    /* The name, whole (the card's width, on two lines at most); a touch on it or on the pencil edits it, in the field laid over it. */
    .card .title { grid-column: 2; grid-row: 1; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 3px; min-width: 0; border-radius: 8px; padding: 2px 3px 2px 6px; margin-left: -6px; cursor: text; }
    .card .title:hover, .card .title:focus-within { background: var(--gf-surface-2); }
    .card .title:focus-within { box-shadow: inset 0 -2px 0 var(--gf-accent); }
    .card .shown, .card .name { grid-area: 1 / 1; font: inherit; font-weight: 700; font-size: 0.98rem; line-height: 1.25; color: var(--gf-text); }
    .card .shown { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; padding: 2px 0; }
    .card .name { min-width: 0; border: 0; background: none; padding: 2px 0; outline: none; text-overflow: ellipsis; opacity: 0; }
    .card .title:focus-within .shown { visibility: hidden; }
    .card .title:focus-within .name { opacity: 1; }
    .card .name:focus, .card .name:focus-visible { box-shadow: none; }
    .card .title .bi { color: var(--gf-text-muted); font-size: 0.85rem; flex: none; }
    .card .meta { grid-column: 2 / 4; grid-row: 2; font-size: 0.76rem; line-height: 1.3; color: var(--gf-text-muted); display: flex; gap: 0 8px; flex-wrap: wrap; padding-bottom: 2px; }
    .card .meta .gps.off { color: var(--gf-warn); }
    /* On the line under the name, two discreet icons: Partager, Terminer (a walk is not ended by mistake). */
    .card .acts { grid-column: 3; grid-row: 1; justify-self: end; position: relative; z-index: 1; display: flex; align-items: center; gap: 0; margin: 0 -6px 0 -8px; }
    /* 44 px under the finger, yet the line kept low and the name its room: the buttons reach into the gap and the
       card's edge. */
    .card .acts button { width: 44px; height: 44px; margin: -6px 0; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; background: none;
      color: var(--gf-text-muted); font-size: 0.9rem; cursor: pointer; }
    .card .acts button:hover { color: var(--gf-text); background: var(--gf-surface-2); }
    .card .acts button:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    /* The plant touched, in the header: « Ajouter ici » under the thumb, ✕ beside it. */
    .card .picked { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; margin-top: 4px; padding-top: 6px; border-top: 1px solid var(--gf-border); }
    .card .picked b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.92rem; }
    .card .picked .n { font-size: 0.75rem; font-weight: 700; color: var(--gf-accent); }
    .card .picked .here { flex: none; width: 44px; height: 44px; min-height: 0; padding: 0; border-radius: 50%; display: grid; place-items: center; }
    .card .picked .drop { flex: none; }
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
    .hits { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .hit { display: grid; grid-template-columns: 52px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 6px; border-radius: 14px; background: var(--gf-surface); box-shadow: var(--gf-shadow); }
    .th { width: 52px; height: 52px; border-radius: 10px; overflow: hidden; background: var(--gf-surface-2); display: grid; place-items: center; color: var(--gf-text-muted); }
    .th img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .hit .t { display: grid; min-width: 0; line-height: 1.25; }
    .hit .t b { font-size: 1rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hit .t i { font-size: 0.82rem; color: var(--gf-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* « Ajouter » (here): a marker with a +, round, under the thumb. */
    .add { width: 46px; height: 46px; min-height: 0; padding: 0; border-radius: 50%; display: grid; place-items: center; }
    .addpin { position: relative; display: inline-grid; place-items: center; font-size: 1.2rem; line-height: 1; }
    .addpin > i { position: absolute; right: -8px; top: -7px; width: 15px; height: 15px; border-radius: 50%; display: grid; place-items: center; font-size: 0.6rem; font-style: normal;
      background: var(--gf-accent-contrast, #fff); color: var(--gf-accent); box-shadow: 0 0 0 1.5px var(--gf-accent); }
    .here .addpin { font-size: 1.05rem; }
    .muted { color: var(--gf-text-muted); margin: 0; }
    .more { align-self: center; min-height: 44px; }
    .list h2 { margin: 2px 2px 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--gf-text-muted); display: flex; justify-content: space-between; }
    /* The plants met: one line each (its photo, its names, × how many times), the list scrolling. */
    .mine { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
    .mine > li { border-radius: 12px; background: var(--gf-surface); }
    .mine > li.fresh { box-shadow: inset 0 0 0 2px var(--gf-accent); }
    .mine > li.sel { background: color-mix(in srgb, var(--gf-accent-soft) 55%, var(--gf-surface)); box-shadow: inset 0 0 0 2px var(--gf-accent), var(--gf-shadow); }
    .mine .pick { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 10px; align-items: center; width: 100%; padding: 6px 8px; border: 0; border-radius: 12px;
      background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .mine .pick:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .mine .pick .t { min-width: 0; display: grid; }
    .mine .pick b { font-size: 0.95rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mine .pick i { font-size: 0.78rem; color: var(--gf-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mine .n { font-size: 0.78rem; font-weight: 700; color: var(--gf-accent); background: var(--gf-accent-soft); border-radius: var(--gf-radius-pill); padding: 2px 8px; white-space: nowrap; }
    .times { font-size: 0.75rem; font-weight: 600; color: var(--gf-accent); white-space: nowrap; }
    .hint { margin: 0; padding: 6px 2px; color: var(--gf-text-muted); font-size: 0.92rem; }
    .toast { position: absolute; z-index: 20; left: 12px; right: 12px; margin: 0 auto; width: fit-content; bottom: calc(84px + env(safe-area-inset-bottom, 0px)); display: flex; gap: 12px; align-items: center; padding: 10px 14px 10px 16px;
      border-radius: var(--gf-radius-pill); background: #1f2a1f; color: #fff; box-shadow: 0 10px 30px rgb(0 0 0 / 35%); font-size: 0.92rem; animation: up 0.25s ease-out; }
    .toast button { border: 0; background: none; color: #9be15d; font: inherit; font-weight: 700; cursor: pointer; padding: 4px; }
    /* The recap scrolls: its toast stays in sight, at the bottom. */
    /* The recap's toast: over the bottom of the screen, out of the flow (nothing moves as it comes and goes), never in
       the way of a touch (it has no action). */
    .toast-dock { position: sticky; bottom: 0; height: 0; z-index: 20; pointer-events: none; }
    .toast-dock .toast { bottom: 12px; }
    @keyframes up { from { opacity: 0; transform: translateY(10px); } }
    @container (max-width: 899px) {
      .head { padding: 8px 10px 4px; }
      /* A phone, searching: the map under the sheet is out of reach too (Tab, screen readers), once faded. */
      .seeking .mapcol { visibility: hidden; transition: opacity 0.2s ease, visibility 0s linear 0.2s; }
    }
    @media (max-height: 480px) { .list { max-height: 22dvh; } }
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
    /** @type {import('./start-screen.js').StartError | null} */
    this._startError = null;
    this._q = '';
    /** @type {any[]} */
    this._hits = [];
    this._searching = false;
    /** The occurrence just added (lit in the list). @type {string | null} */
    this._fresh = null;
    /** The microphone is open (the field says « Parlez… »). */
    this._listening = false;
    /** The plant touched (its id), in the list or on the map: its occurrences lit, « Ajouter ici » in the header. @type {number | null} */
    this._sel = null;
    /** The occurrence of it touched on the map (the one the header's ✕ takes out; else its last). @type {string | null} */
    this._selEntry = null;
    /** @type {{ text: string, undo?: () => void } | null} */
    this._toast = null;
    /** @type {any[]} */
    this._past = [];
    this._locating = false;
    /** How many of the hits are shown (« Voir plus » adds STEP). */
    this._shown = STEP;
  }

  /** @type {(() => void) | null} */ #stopGeo = null;
  /** Waiting for the geolocation permission before following (a parcours found again on opening). @type {(() => void) | null} */ #waitGeo = null;
  #onSpots = () => this.#reload();

  connectedCallback() {
    super.connectedCallback();
    spotEvents.addEventListener('change', this.#onSpots);
    (window.visualViewport || window).addEventListener('resize', this.#onViewport);
    const { w, h } = this.#viewport();
    this.#vw = w; this.#tallest = this.#low = h;
    this.#reload();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    spotEvents.removeEventListener('change', this.#onSpots);
    (window.visualViewport || window).removeEventListener('resize', this.#onViewport);
    this.#sheetSize.disconnect();
    this.#sheetEl = null; this.#sheetH = -1; this.#bottomFor = '';
    for (const t of [this.#toastTimer, this.#gone, this.#findTimer]) clearTimeout(t);
    fitKeyboard(false);
    this.#stopGeo?.();
    this.#stopGeo = null;
    this.#waitGeo?.();
    this.#waitGeo = null;
    this.#cancelStart();
    // The recap left for another scenario (not for « Le voir dans Mes plantes », whose Back comes to it again).
    if (this._done && parse(location.hash).name !== 'collections') write(DONE, null);
  }

  /** @param {Map<string, any>} changed */
  updated(changed) {
    // The mini-app's box (app/miniapps/parcours.js) follows its steps: the start, the walk, the recap — once known.
    const step = !this.#known ? '' : this._trail ? 'walk' : this._done ? 'done' : 'start';
    if (step && step !== this.#stepSaid) {
      this.#stepSaid = step;
      this.dispatchEvent(new CustomEvent('ma-step', { detail: { step }, bubbles: true, composed: true }));
    }
    // Only while on screen: a late update (a toast's end, a GPS fix, the IGN's name) never sets it elsewhere.
    fitKeyboard(this.isConnected && Boolean(this._trail));
    const sheet = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.sheet'));
    if (sheet !== this.#sheetEl) {
      if (this.#sheetEl) this.#sheetSize.unobserve(this.#sheetEl);
      // A scroll the hand (or the content) made — not the browser's, as the sheet changes height.
      if (sheet) { this.#sheetSize.observe(sheet); sheet.addEventListener('scroll', () => { if (sheet.clientHeight === this.#sheetH) this.#keepFrom(sheet); }, { passive: true }); }
      this.#sheetEl = sheet;
    }
    // New suggestions (another word, the sheet opening): the best one, right above the field, in sight.
    const what = !sheet?.classList.contains('open') ? '' : this._q ? 'q:' + this.#hitsFor + ':' + this._hits.length : 'hint:' + this._listening;
    if (sheet && what && what !== this.#bottomFor) { sheet.scrollTop = sheet.scrollHeight; this.#fromBottom = 0; }
    else if (sheet && sheet.clientHeight === this.#sheetH) this.#keepFrom(sheet);
    this.#bottomFor = what;
    // The toast waits under the sheet (it would cover a suggestion): its time runs again once the search is left.
    if (this.#open !== this.#toastOpen) {
      this.#toastOpen = this.#open;
      clearTimeout(this.#toastTimer);
      if (!this.#open && this._toast) this.#toastTimer = setTimeout(() => { this._toast = null; }, 4500);
    }
  }

  /** The sheet is open (searching), as last rendered; and as the toast last knew it. */
  /** The parcours' column (wide screens): its width, remembered; the map takes the rest. */
  #sizer = new PaneSizer(this, config.storageKeys.trailLayout, { side: { width: 480, min: 320, title: 'Parcours' } },
    { onChange: () => /** @type {any} */ (this.renderRoot.querySelector('.mapcol gf-map'))?.holdFrame?.() });
  #open = false;
  #toastOpen = false;

  /** The sheet of suggestions, watched: it is held from the bottom (the field), as it grows or shrinks. @type {HTMLElement | null} */
  #sheetEl = null;
  /** What the sheet showed when brought to its bottom (a new word: brought again). */
  #bottomFor = '';
  /** How far the sheet is scrolled up from its bottom. */
  #fromBottom = 0;
  /** @param {HTMLElement} sheet */
  #keepFrom(sheet) { this.#fromBottom = sheet.scrollHeight - sheet.clientHeight - sheet.scrollTop; }
  /** The sheet's height when last held (a scroll at another height is the browser's, as it resizes). */
  #sheetH = -1;
  /** The keyboard comes or goes, the sheet changes height: what was above the field stays above it. */
  #sheetSize = new ResizeObserver(() => {
    const sheet = this.#sheetEl;
    if (!sheet) return;
    this.#sheetH = sheet.clientHeight;
    sheet.scrollTop = sheet.scrollHeight - sheet.clientHeight - this.#fromBottom;
  });

  /** The visible viewport's width, its tallest height at that width (no keyboard), its lowest since it last grew. */
  #vw = 0;
  #tallest = 0;
  #low = 0;
  /** The keyboard up, as last seen (kept through a rotation or a pinch, which only set the heights again). */
  #kbUp = false;
  /** On which side of 900 px the host was (the sheet's state follows a crossing at once). */
  #phone = false;
  #viewport() {
    const vv = window.visualViewport;
    return { w: Math.round(vv?.width ?? innerWidth), h: Math.round(vv?.height ?? innerHeight) };
  }
  /** The keyboard is up: the viewport went much shorter than it had been at this width. */
  #keyboardUp() { return this.#kbUp; }
  /**
   * The keyboard put away without leaving the field (Android's « Retour », the ⌄ key) — the viewport much taller at
   * the same width (a rotation, a pinch change the width: they only set the heights again): nothing typed, the
   * suggestions' sheet goes down, the parcours, its map and its plants are back.
   */
  #onViewport = () => {
    const phone = this.clientWidth < 900;
    if (phone !== this.#phone) { this.#phone = phone; this.requestUpdate(); }
    const { w, h } = this.#viewport();
    if (w !== this.#vw) { this.#vw = w; this.#tallest = this.#low = h; return; }
    if (h < this.#tallest - 80) this.#kbUp = true;
    // Grown from its lowest (an animated keyboard is told in several steps, each under 80 px).
    const grew = h > this.#low + 80;
    if (grew) { this.#kbUp = false; this.#tallest = this.#low = h; }
    else { this.#tallest = Math.max(this.#tallest, h); this.#low = Math.min(this.#low, h); }
    // Only a phone's sheet: on a computer, a window made taller leaves the field as it is.
    if (grew && this._peek && !this._q && phone) { this._peek = false; this.#input?.blur(); }
  };
  /** How the ✕ was touched (a finger, the keyboard away: the search is left). */
  #clearBy = '';

  /** The walk under way and the recap read once (the step said from then on), and the step last said. */
  #known = false;
  #stepSaid = '';

  /** The parcours walked (and those before), from Mes plantes. */
  async #reload() {
    const id = read(KEY, null);
    const trail = id ? await getPlace(id).catch(() => undefined) : undefined;
    this._trail = trail || null;
    if (!trail && id) write(KEY, null);
    // The parcours just ended: its recap again (back from Mes plantes, the page reloaded), as it is now.
    const done = !trail && read(DONE, null);
    if (done) {
      this._done = await getPlace(done).catch(() => undefined) || null;
      if (!this._done) write(DONE, null);
      // Its altitudes, for its profile (a parcours noted offline, or before they were kept): saved again once found.
      else fillAltitudes(this._done.id, getPlace, updatePlace);
    }
    const ids = /** @type {string[]} */ (read(LIST, []));
    this._past = (await Promise.all(ids.filter(x => x !== id).map(x => getPlace(x).catch(() => undefined)))).filter(Boolean);
    this.#known = true;
    // A parcours under way, found again on opening: followed once the permission is granted (no gesture here);
    // « Commencer ici » and « Reprendre » ask for the position themselves.
    if (this._trail && this.isConnected && !this.#stopGeo) {
      this.#waitGeo?.();
      const cancel = whenGranted(() => { this.#waitGeo = null; if (this._trail && this.isConnected) this.#follow(); });
      this.#waitGeo = this.#stopGeo ? null : cancel;
    }
  }

  /** Where I am, followed while walking. */
  #follow() {
    if (this.#stopGeo) return;
    this.#stopGeo = watchLocation(s => {
      if (s.fix) { this._fix = { coordinates: s.fix.coordinates, accuracy: s.fix.accuracy }; this._geoError = null; }
      else if (s.error) this._geoError = s.error;
    });
  }

  /** The pending « Commencer ici » (its GPS subscription), if any. @type {(() => void) | null} */ #starting_ = null;

  /** « Commencer ici »: located, the parcours created there. Once: a second touch, a late or repeated answer, an old fix do nothing. */
  #startHere() {
    if (this.#starting_ || this.#creating) return;
    this._locating = true;
    this._startError = null;
    const since = Date.now() - FIX_MAX_AGE;
    let live = true;
    /** @type {(() => void) | null} */ let stop = null;
    const end = () => { live = false; this.#starting_ = null; this._locating = false; const s = stop; stop = null; if (s) queueMicrotask(s); };
    this.#starting_ = end;
    const unsubscribe = watchLocation(s => {
      if (!live) return;
      if (s.fix && s.fix.timestamp >= since) { end(); this.#create(s.fix.coordinates, null, s.fix.accuracy); }
      else if (s.error) { end(); this._startError = geoProblem(s.code, { place: true, retry: () => this.#startHere() }); }
    });
    if (live) stop = unsubscribe; else queueMicrotask(unsubscribe);
  }

  /** « Annuler », a commune chosen, a parcours taken up again, the screen left: the locating stops, its answer is dropped. */
  #cancelStart() { this.#starting_?.(); this._startError = null; }

  /** A parcours being created (saved, then shown): no second one meanwhile (a second touch, a commune picked). */
  #creating = false;

  /**
   * A new parcours at `at`: named after the commune chosen (`where`), or — started here — after the finest place the
   * IGN knows there (a park, a forest, a wood, a summit, a lieu-dit, a hamlet, the commune), as soon as it answers —
   * the commune only when the position is rough (over 250 m).
   * @param {[number, number]} at @param {string | null} where @param {number} [accuracy] metres
   */
  async #create(at, where, accuracy = 0) {
    if (this.#creating) return;
    this.#creating = true;
    this.#cancelStart();
    this._locating = true;
    try {
      const name = where ? `${NAMED} ${atPlace({ name: where, kind: 'commune', commune: '' })}` : NAMED;
      const place = newPlace(at, { name: name.slice(0, 80), notes: 'Parcours botanique' });
      // Started where I stand: its point is the walk's first step (the recap's distance counts from it).
      if (!where) /** @type {any} */ (place.properties).startedHere = true;
      // Asked at once; given once the parcours is saved (it may answer first: from the cache).
      const found = where ? null : this.#placeName(at, accuracy > 250);
      await savePlace(place);
      this.#leaveRecap();
      write(KEY, place.id);
      write(LIST, [place.id, ...(/** @type {string[]} */ (read(LIST, []))).filter(x => x !== place.id)].slice(0, 20));
      await refreshMembership().catch(() => {});
      this._trail = place;
      if (found) this.#nameAfter(place.id, found);
      // Left meanwhile: the parcours is kept (found again on return), nothing followed here.
      if (!this.isConnected) return;
      this.#follow();
      await this.updateComplete;
      // Ready for the first plant: the field on a wide screen; on a phone, no keyboard yet (the mic is there too).
      if (this.clientWidth >= 900) /** @type {HTMLInputElement | null} */ (this.renderRoot.querySelector('.search input'))?.focus();
    } finally {
      this.#creating = false;
      this._locating = false;
    }
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
   * the same species met further on is another occurrence, at its own spot. `here`: « Ajouter ici » of the
   * header (the plant touched): it stays lit, the search left alone.
   * @param {any} hit @param {boolean} [here]
   */
  async #add(hit, here = false) {
    const trail = this._trail;
    if (!trail) return;
    const plant = await db.get('plants', hit.id).catch(() => null) || { id: hit.id, scientificName: hit.scientificName, vernacularName: hit.vernacularName };
    const position = this._fix ? { coordinates: this._fix.coordinates, accuracy: Math.round(this._fix.accuracy) } : undefined;
    // Added to the parcours as stored now (another add, another tab, the altitudes may have written meanwhile).
    const next = await this.#update(trail.id, current => withPlant(current, plant, position, { again: true }));
    if (!next) return;
    const added = /** @type {any} */ (lastEntry(next)).id;
    this._fresh = added;
    const name = hit.vernacularName || hit.scientificName;
    const n = entriesOf(next, plant.id).length;
    this.#say(`${name} ajoutée au parcours${n > 1 ? ` (${n}e fois)` : ''}${position ? ', ici' : ''}`, () => { this.#update(trail.id, current => withoutPlant(current, added)); });
    if (here) return;
    // Added: the search goes down — on a phone the keyboard too — and the card and the map are back, the plant on
    // it. Wide (no keyboard): the field stays ready for the next one.
    this._sel = null;
    this.#type('');
    this._peek = false;
    if (this.clientWidth < 900) this.#input?.blur(); else this.#input?.focus();
  }

  /**
   * A plant touched, in the list or on the map (again in the list: let go): its occurrences lit on the map, its
   * row lit and brought into view, « Ajouter ici » in the header. @param {number | null} plantId @param {string | null} [entryId] the occurrence touched on the map
   */
  async #select(plantId, entryId = null) {
    this._sel = plantId;
    this._selEntry = entryId;
    if (plantId == null) return;
    await this.updateComplete;
    this.renderRoot.querySelector(`.mine li[data-plant="${plantId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /**
   * The parcours shared: a link carrying it (its plants and their places), by the system's sheet or copied.
   * @param {any} [place] the parcours ended (its recap), else the one walked
   */
  async #share(place) {
    await this.#flushName();
    const t = place || this._trail;
    if (!t) return;
    const url = href.shared(await encodeCollection(t));
    const result = await share({ title: t.properties.name + ' — GeoFlora', text: `${t.properties.name} · ${this.#count(t)}`, url });
    if (result === 'copied') this.#say('Lien du parcours copié : collez-le où vous voulez');
  }

  /** One occurrence out of the parcours (the plant's others stay) — « Annuler » puts it back. @param {string} entryId */
  async #remove(entryId) {
    const t = this._trail;
    const entry = t?.properties.plants.find((/** @type {any} */ e) => e.id === entryId);
    if (!t || !entry) return;
    const next = await this.#update(t.id, current => withoutPlant(current, entryId));
    if (!next) return;
    this._selEntry = null;
    if (this._sel != null && !entriesOf(next, this._sel).length) this._sel = null;
    this.#say(`${entry.vernacularName || entry.scientificName} retirée du parcours`, () => {
      this.#update(t.id, current => current.properties.plants.some(e => e.id === entryId) ? current
        : { ...current, properties: { ...current.properties, plants: [...current.properties.plants, entry] } });
    });
  }

  /** @type {any} */ #toastTimer = 0;
  /** @param {string} text @param {() => void} [undo] */
  #say(text, undo) {
    clearTimeout(this.#toastTimer);
    this._toast = { text, undo };
    // Under the sheet (the mic still listening), its time waits: updated() starts it once the search is left.
    if (!this.#toastOpen) this.#toastTimer = setTimeout(() => { this._toast = null; }, 4500);
  }

  /** « Terminer »: the parcours stays in Mes plantes; its recap shows; another one can start. */
  async #end() {
    await this.#flushName();
    write(KEY, null);
    write(DONE, this._trail?.id ?? null);
    this.#stopGeo?.(); this.#stopGeo = null; this.#waitGeo?.(); this.#waitGeo = null;
    this._done = this._trail;
    this._trail = null; this._q = ''; this._hits = []; this._sel = null; this._selEntry = null; this._peek = false; this._toast = null;
    this.#reload();
  }

  /** @param {any} place */
  #resume(place) {
    this.#leaveRecap();
    write(KEY, place.id);
    this._trail = place;
    this._sel = null; this._selEntry = null;
    this.#follow();
    this.#reload();
  }

  /** The recap left (another parcours, the scenarios): it is not shown again. */
  #leaveRecap() {
    this._done = null;
    write(DONE, null);
  }

  /**
   * The finest place name at `at` (its commune only, `rough`), or null (the IGN silent 8 s, off, out of reach).
   * @param {[number, number]} at @param {boolean} rough @returns {Promise<{ name: string, kind: string, commune: string } | null>}
   */
  async #placeName(at, rough) {
    const found = await Promise.race([placeNameAt(at).catch(() => null), new Promise(done => setTimeout(() => done(null), 8000))]);
    if (!found || !rough || found.kind === 'commune') return found;
    return found.commune ? { name: found.commune, kind: 'commune', commune: found.commune } : null;
  }

  /**
   * The parcours `id` named after the place where it starts, when the IGN answers — unless it was renamed
   * meanwhile, or its name is being edited.
   * @param {string} id @param {Promise<{ name: string, kind: string, commune: string } | null>} pending
   */
  async #nameAfter(id, pending) {
    const found = await pending;
    const t = this._trail;
    if (!found || t?.id !== id || t.properties.name !== NAMED) return;
    if (this.renderRoot.querySelector('input.name:focus')) return;
    await this.#rename(`${NAMED} ${atPlace(found)}`);
  }

  /** The name as typed, kept at once (rendered first: never behind the field), then stored. @param {string} name */
  async #rename(name) {
    clearTimeout(this.#nameTimer);
    const n = name.trim();
    if (!n || !this._trail || n === this._trail.properties.name) return;
    const kept = n.slice(0, 80);
    this._trail = { ...this._trail, properties: { ...this._trail.properties, name: kept } };
    await this.#update(this._trail.id, current => ({ ...current, properties: { ...current.properties, name: kept } }));
  }

  /**
   * A change to the parcours, applied to it as stored now, in one transaction (collections.js updatePlace): two
   * quick adds, or the same parcours open in two tabs, never lose one another's plants. Deleted meanwhile (in another
   * tab): said, and the parcours left. Resolves with the parcours as stored, or null.
   * @param {string} id @param {(current: import('../core/collections.js').Place) => import('../core/collections.js').Place} change
   */
  async #update(id, change) {
    try {
      const saved = await updatePlace(id, change);
      if (this._trail?.id === id) this._trail = saved;
      return saved;
    } catch (error) {
      this.#say(/** @type {Error} */ (error).name === 'GoneError' ? 'Ce parcours a été supprimé (dans un autre onglet ?) : rien n’a été enregistré.'
        : 'Enregistrement impossible : ' + /** @type {Error} */ (error).message);
      this.#reload();
      return null;
    }
  }

  /** @type {any} */ #nameTimer = 0;
  /** The name before this edit (Échap brings it back). */
  #nameBefore = '';
  /** The name being typed, stored now (before sharing, leaving…). */
  async #flushName() {
    const input = /** @type {HTMLInputElement | null} */ (this.renderRoot.querySelector('input.name'));
    if (input && this.#nameTimer) await this.#rename(input.value);
  }

  render() {
    const t = this._trail;
    if (!t) return this._done ? this.#finished(this._done) : this.#starting();
    const plants = this.#groups(t);
    // Searching: something typed or said — or, on a phone, the field touched (the keyboard takes the room). The
    // microphone never brings the keyboard: the field is let go while it listens.
    const phone = this.clientWidth < 900;
    const open = Boolean(this._q) || this._listening || (this._peek && phone);
    this.#open = open;
    // Under the suggestions, the parcours is out of reach (the keyboard's Tab, the screen readers): only what is seen.
    const sized = 'side' in this.#sizer.state.widths;
    return html`<div class="wrap on ${open ? 'seeking' : ''} ${sized ? 'sized' : ''}" style=${sized ? `--w-side: ${this.#sizer.width('side')}px` : ''}>
      <h1 class="visually-hidden">Parcours botanique : ${t.properties.name}</h1>
      <div class="side">
        <div class="head" ?inert=${open}>${this.#card(t)}</div>
        <section class="list" aria-label="Les plantes du parcours" ?inert=${open}>
          ${plants.length ? html`<h2><span>Le parcours</span><span>${this.#count(t)}</span></h2>
          <ul class="mine">${repeat(plants, g => g.plantId, g => this.#row(g))}</ul>`
          : html`<p class="hint">Tapez ou dites le nom d’une plante (« ortie », « pissenlit »…) : la flore la propose, son marqueur + la pose sur la carte, là où vous êtes.</p>`}
        </section>
        ${this.#sheet(t, open)}
        <div class="dock">
          <div class="bar">
            <div class="search ${this._listening ? 'listening' : ''}" role="search">
              <span class="lens" aria-hidden="true">${icon('search')}</span>
              <!-- No value binding: the keyboard's own dictation (and its composition) is never disturbed. -->
              <input type="search" enterkeyhint="search" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"
                placeholder=${this._listening ? 'Parlez : « ortie », « pissenlit »…' : 'Quelle plante voyez-vous ?'} aria-label="Nommer une plante (la flore propose)"
                @pointerdown=${() => { this.#touchedAt = performance.now(); }}
                @focus=${() => { if (performance.now() - this.#touchedAt < 1000) this._peek = true; }}
                @blur=${() => { this._peek = false; }}
                @input=${(/** @type {any} */ e) => this.#find(e.target.value)}
                @keydown=${(/** @type {KeyboardEvent} */ e) => {
                  if (e.isComposing) return;
                  if (e.key === 'Enter') { e.preventDefault(); this.#addFirst(/** @type {any} */ (e.target).value); }
                  if (e.key === 'Escape') this.#type(''); }} />
              <!-- ✕ as Échap: the field kept (and the keyboard, and the sheet with its hint) — but touched with the
                   keyboard put away, the search is left (no empty sheet over the parcours). -->
              ${this._q ? html`<span class="tools"><button class="icon-btn" type="button" aria-label="Effacer"
                @pointerdown=${(/** @type {PointerEvent} */ e) => { this.#clearBy = e.pointerType; }}
                @mousedown=${(/** @type {Event} */ e) => e.preventDefault()}
                @click=${() => {
                  this.#type('');
                  if (this.#clearBy === 'touch' && !this.#keyboardUp()) { this._peek = false; this.#input?.blur(); }
                  this.#clearBy = ''; }}>${icon('x-lg')}</button></span>` : nothing}
            </div>
            <gf-voice-button size="large" fallback
              @voice-state=${(/** @type {CustomEvent} */ e) => { this._listening = e.detail.state !== 'idle'; if (this._listening) this.#input?.blur(); }}
              @voice-text=${(/** @type {CustomEvent} */ e) => this.#type(e.detail.text, e.detail.final)}></gf-voice-button>
          </div>
        </div>
      </div>
      ${this.#sizer.split('side', 'left', () => this.clientWidth - 360)}
      <div class="mapcol">${this.#map(t)}</div>
      ${this._toast && !open ? html`<div class="toast" role="status">${icon('check-lg')} <span>${this._toast.text}</span>
        ${this._toast.undo ? html`<button type="button" @click=${() => { this._toast?.undo?.(); this._toast = null; }}>Annuler</button>` : nothing}</div>` : nothing}
    </div>`;
  }

  /**
   * The suggestions, rising over the parcours while searching: the flora's plants for what is typed — before a
   * letter, how to name one. Going down, they keep what they showed until they are gone.
   * @param {any} t @param {boolean} open
   */
  #sheet(t, open) {
    if (open) {
      this.#shown = this._q ? this.#hitsView(t)
        : this._listening ? html`<p class="hint">Parlez : « ortie », « pissenlit »… La flore propose la plante, son marqueur + la pose sur la carte, là où vous êtes.</p>`
        : html`<p class="hint">Tapez ou dites le nom d’une plante (« ortie », « pissenlit »…) : la flore la propose, son marqueur + la pose sur la carte, là où vous êtes.</p>`;
      clearTimeout(this.#gone);
    } else if (this.#shown !== nothing) {
      clearTimeout(this.#gone);
      this.#gone = setTimeout(() => { this.#shown = nothing; this.requestUpdate(); }, 320);
    }
    return html`<section class="sheet ${open ? 'open' : ''}" aria-label="Plantes proposées" ?inert=${!open} aria-hidden=${String(!open)}>${this.#shown}</section>`;
  }
  /** @type {unknown} */ #shown = nothing;
  /** @type {any} */ #gone = 0;
  /** When the hand last touched the search field (a focus right after it is the hand's, not the app's). */
  #touchedAt = 0;

  /** « 12 observations · 9 plantes » (a plant met several times counts once among the plants). @param {any} t */
  #count(t) {
    const n = t.properties.plants.length, species = new Set(t.properties.plants.map((/** @type {any} */ e) => e.plantId)).size;
    if (!n) return 'Aucune plante encore';
    return n > species ? `${n} observations · ${species} plante${species > 1 ? 's' : ''}` : `${n} plante${n > 1 ? 's' : ''}`;
  }

  /**
   * The plants of the parcours, each once — its occurrences together, in the order met — the last met first.
   * @param {any} t @returns {{ plantId: number, entries: any[], last: any }[]}
   */
  #groups(t) {
    /** @type {Map<number, any[]>} */
    const by = new Map();
    for (const e of [...t.properties.plants].sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)))) {
      by.set(e.plantId, [...(by.get(e.plantId) || []), e]);
    }
    return [...by].map(([plantId, entries]) => ({ plantId, entries, last: entries[entries.length - 1] }))
      .sort((a, b) => String(b.last.addedAt).localeCompare(String(a.last.addedAt)));
  }

  /**
   * A plant met on the way, one line: its photo, its names, how many times. Touched: its occurrences
   * lit on the map, « Ajouter ici » in the header (again: let go).
   * @param {{ plantId: number, entries: any[], last: any }} g
   */
  #row(g) {
    const e = g.last, n = g.entries.length, sel = this._sel === g.plantId;
    const name = e.vernacularName || e.scientificName;
    const fresh = g.entries.some(x => x.id === this._fresh);
    return html`<li class="${sel ? 'sel' : ''} ${fresh ? 'fresh' : ''}" data-plant=${g.plantId}>
      <button class="pick" type="button" aria-pressed=${sel ? 'true' : 'false'}
        aria-label=${`${name}${n > 1 ? `, ${n} fois` : ''} : ${sel ? 'ne plus la montrer' : 'la montrer sur la carte'}`} @click=${() => this.#select(sel ? null : g.plantId)}>
        <gf-thumb plant-id=${g.plantId} size="44"></gf-thumb>
        <span class="t"><b>${name}</b>${e.vernacularName ? html`<i>${e.scientificName}</i>` : nothing}</span>
        ${n > 1 ? html`<span class="n" title=${n + ' occurrences dans le parcours'}>× ${n}</span>` : nothing}
      </button>
    </li>`;
  }

  /**
   * In the header, the plant touched: « Ajouter ici » (once more, where I stand), and ✕ (the occurrence touched on
   * the map, else its last). @param {any} t
   */
  #picked(t) {
    const entries = this._sel != null ? entriesOf(t, this._sel) : [];
    if (!entries.length) return nothing;
    const e = entries.find((/** @type {any} */ x) => x.id === this._selEntry) || entries[entries.length - 1];
    const name = e.vernacularName || e.scientificName;
    const which = entries.length > 1 ? (e.id === this._selEntry ? ' (celle touchée sur la carte)' : ' (la dernière)') : '';
    return html`<div class="picked">
      <gf-thumb plant-id=${e.plantId} size="30" round></gf-thumb>
      <b>${name}${entries.length > 1 ? html` <span class="n">× ${entries.length}</span>` : nothing}</b>
      <button class="primary here" type="button" ?disabled=${!this._fix} title=${this._fix ? 'Une occurrence de plus, là où vous êtes' : 'Position introuvable'}
        aria-label=${'Ajouter ' + name + ' ici'} @click=${() => this.#add({ id: e.plantId, scientificName: e.scientificName, vernacularName: e.vernacularName }, true)}>${addPin}</button>
      <button class="icon-btn drop" type="button" aria-label=${'Retirer ' + name + which + ' du parcours'} title=${'Retirer du parcours' + which} @click=${() => this.#remove(e.id)}>${icon('x-lg')}</button>
    </div>`;
  }

  /** The parcours, small: its name (always editable), its plants, my position; « Terminer ». @param {any} t */
  #card(t) {
    const gps = this._fix ? `Position ±${Math.round(this._fix.accuracy)} m` : this._geoError ? 'Position introuvable : les plantes vont au point du parcours' : 'Recherche de votre position…';
    return html`<div class="card" aria-label="Le parcours">
      <span class="pin" aria-hidden="true">${icon('geo-alt-fill')}</span>
      <label class="title" title="Renommer le parcours">
        <span class="shown" aria-hidden="true">${t.properties.name}</span>
        <input class="name" .value=${t.properties.name} aria-label="Nom du parcours" maxlength="80" enterkeyhint="done" autocomplete="off"
          @focus=${() => { this.#nameBefore = t.properties.name; }}
          @input=${(/** @type {any} */ e) => { clearTimeout(this.#nameTimer); const v = e.target.value; this.#nameTimer = setTimeout(() => this.#rename(v), 500); }}
          @keydown=${(/** @type {KeyboardEvent} */ e) => { const i = /** @type {HTMLInputElement} */ (e.target);
            if (e.key === 'Enter') i.blur();
            if (e.key === 'Escape') { i.value = this.#nameBefore || t.properties.name; this.#rename(i.value); i.blur(); } }}
          @change=${(/** @type {any} */ e) => this.#rename(e.target.value)}
          @blur=${(/** @type {any} */ e) => { if (!e.target.value.trim()) e.target.value = this._trail?.properties.name || ''; }} />
        ${icon('pencil')}
      </label>
      <span class="acts">
        <button class="share" type="button" aria-label="Partager le parcours" title="Partager le parcours : un lien avec sa carte et ses plantes" @click=${() => this.#share()}>${icon('share')}</button>
        <button class="end" type="button" aria-label="Terminer le parcours" title="Terminer le parcours (il reste dans Mes plantes)" @click=${() => this.#end()}>${icon('flag-fill')}</button>
      </span>
      <span class="meta"><span>${this.#count(t)}</span><span class="gps ${this._fix ? '' : 'off'}">${gps}</span></span>
      ${this.#picked(t)}
    </div>`;
  }

  /**
   * The flora's suggestions: each with its photo, its names and a large « Ajouter » — in the order seen, from the
   * top: « Voir plus », then the last shown, down to the best, right above the field. @param {any} t
   */
  #hitsView(t) {
    if (!this._hits.length) return html`<p class="muted">${this._searching ? 'Recherche dans la flore…' : `Aucune plante de la flore pour « ${this._q} ».`}</p>`;
    const shown = this._hits.slice(0, this._shown);
    const more = this._hits.length - shown.length;
    return html`${more > 0 ? html`<button class="more secondary" type="button" @click=${() => { this._shown += STEP; }}>Voir ${Math.min(more, STEP)} plante${Math.min(more, STEP) > 1 ? 's' : ''} de plus (${this._hits.length} en tout)</button>` : nothing}
    <ul class="hits" aria-label="Plantes proposées">${repeat([...shown].reverse(), h => h.id, h => {
      // Already met: it can be added again (another occurrence, here).
      const times = entriesOf(t, h.id).length;
      return html`<li class="hit">
        <span class="th">${photoOf(h.thumbnail?.url) ? html`<img src=${h.thumbnail.url} alt="" loading="lazy" referrerpolicy="no-referrer" @error=${(/** @type {any} */ e) => e.target.remove()} />` : icon('flower1')}</span>
        <span class="t"><b>${h.vernacularName || h.scientificName}</b><i>${h.vernacularName ? h.scientificName + ' · ' : ''}${h.family || ''}</i>
          ${times ? html`<span class="times">${icon('check-lg')} Déjà ${times === 1 ? 'une fois' : times + ' fois'} dans le parcours</span>` : nothing}</span>
        <button class="primary add" type="button" @click=${() => this.#add(h)} title=${times ? 'L’ajouter encore, ici' : 'L’ajouter au parcours, ici'}
          aria-label=${(times ? 'Ajouter encore ' : 'Ajouter ') + (h.vernacularName || h.scientificName) + ' au parcours'}>${addPin}</button>
      </li>`;
    })}</ul>`;
  }

  /** The map of the parcours: its point, each plant where it was added; me, followed. @param {any} t */
  #map(t) {
    const markers = plantMarkers([t]);
    // Framed on the whole parcours (its start and every plant), again as it grows; a plant touched: on its
    // occurrences, and me (« Ajouter ici »).
    const lit = this._sel != null ? markers.filter(m => m.plantId === this._sel) : [];
    const shown = lit.length ? lit.map(m => m.coordinates) : [t.geometry.coordinates, ...markers.map(m => m.coordinates)].filter(Boolean);
    // Me: where I was when it was touched, not followed (the map stays put as I walk).
    const points = lit.length && this._fix ? [...shown, this._fix.coordinates] : shown;
    const frame = { key: 'trail:' + t.id + ':' + (this._sel ?? '') + ':' + shown.map(c => c.join(',')).join(';'), maxZoom: lit.length ? 19 : 17, points, ease: true };
    // Every plant's own marker — not the parcours' pin (it would gather them under a count).
    return html`<gf-map no-search no-create .spots=${NO_SPOTS} .plants=${markers} plant-zoom="0" .frame=${frame} track
      .selectedPlant=${lit.length ? lit.map(m => m.key) : null}
      @plant-select=${(/** @type {CustomEvent} */ e) => this.#select(e.detail.plantId, e.detail.entryId)}></gf-map>`;
  }

  /**
   * The parcours ended, on the start screens' template: its map with every plant and the plants met (the picture),
   * what it holds, how long and how far — then share it (the big action); smaller: see it in Mes plantes, take it up
   * again, start another; the way out.
   * @param {any} t
   */
  #finished(t) {
    const plants = t.properties.plants, groups = this.#groups(t);
    const markers = plantMarkers([t]);
    const points = [t.geometry.coordinates, ...markers.map(m => m.coordinates)].filter(Boolean);
    const frame = { key: 'done:' + t.id, points, maxZoom: 17 };
    // The walk, in the order the plants were added, from one to the next (as the crow flies), from the start when
    // it was started here — only the plants with a place of their own (located, or moved by hand), not those put on
    // the parcours' point for want of a position, nor the commune it started from.
    // (core/walk.js: the « Vue 3D » draws the same walk.)
    const { steps, own, start, line: placed } = walkOf(t);
    // Its altitudes (the IGN's, kept with each plant): the profile of the walk, from plant to plant.
    const profile = profileOf([
      ...(start ? [{ at: start, m: altitudeOf(t.properties, start), label: 'Départ' }] : []),
      ...own.map(e => ({ at: e.coordinates, m: altitudeOf(e, e.coordinates), label: e.vernacularName || e.scientificName }))
    ], distance);
    let km = 0;
    for (let i = 1; i < placed.length; i++) km += distance(placed[i - 1], placed[i]) / 1000;
    // Its time: from the start to the last plant, without the pauses (taken up again another day).
    const times = [Date.parse(t.properties.createdAt), ...steps.map(e => Date.parse(e.addedAt))].filter(Number.isFinite);
    let ms = 0;
    for (let i = 1; i < times.length; i++) { const gap = times[i] - times[i - 1]; if (gap > 0 && gap <= PAUSE_MS) ms += gap; }
    const min = Math.round(ms / 60000);
    const time = min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : min >= 1 ? `${min} min` : '';
    const m = Math.round(km * 100) * 10;
    const dist = m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : m >= 50 ? `${m} m` : '';
    const walk = [time && 'en ' + time, dist && 'sur ' + dist, profile && profile.climb >= 10 && `${formatAltitude(profile.climb)} de montée`].filter(Boolean).join(', ');
    const art = html`<div class="recap">
      <div class="recap-map"><gf-map no-search no-create .spots=${NO_SPOTS} .plants=${markers} plant-zoom="0" .frame=${frame}></gf-map>
        ${markers.length ? html`<button type="button" class="map3d" aria-describedby="note3d" @click=${(/** @type {Event} */ e) => this.#open3d(t, e)}>${icon('map')} Vue 3D</button>` : nothing}</div>
      <p class="note3d" id="note3d" role="status">${this._note3d || ''}</p>
      ${groups.length ? html`<ul class="met" aria-label="Les plantes du parcours">${groups.slice(0, 8).map(g => html`<li title=${g.last.vernacularName || g.last.scientificName}><gf-thumb plant-id=${g.plantId} size="44" round></gf-thumb></li>`)}
        ${groups.length > 8 ? html`<li class="more-n">+${groups.length - 8}</li>` : nothing}</ul>` : nothing}
      ${profile ? this.#profile(profile) : nothing}
    </div>`;
    const another = () => this.#leaveRecap();
    return html`<div class="wrap done">${startScreen({
      id: 'trail-done',
      art,
      title: 'Parcours terminé',
      lead: html`<span class="recap-of">${t.properties.name}</span>${plants.length ? `${this.#count(t)}${walk ? ', ' + walk : ''}.` : 'Aucune plante notée.'}`,
      primary: plants.length
        ? { icon: 'share', label: 'Partager le parcours', run: () => this.#share(t) }
        : { icon: 'geo-alt-fill', label: 'Un nouveau parcours', run: another },
      note: 'Il reste dans Mes plantes.',
      alternatives: [
        { kind: 'link', icon: 'collection', label: 'Le voir dans Mes plantes', href: href.collections({ open: t.id }) },
        { kind: 'link', icon: 'arrow-counterclockwise', label: 'Le reprendre', run: () => this.#resume(t) },
        plants.length > 0 && { kind: 'link', icon: 'geo-alt-fill', label: 'Un nouveau parcours', run: another }
      ],
      // The recap stays until another scenario is chosen (the list closed without a choice: still here).
      exit: { icon: 'camera-reels', label: 'Quitter le parcours : autres scénarios', run: () => this.dispatchEvent(new CustomEvent('open-scenarios', { bubbles: true, composed: true })) }
    })}
    <div class="toast-dock">${this._toast ? html`<div class="toast" role="status">${icon('check-lg')} <span>${this._toast.text}</span></div>` : nothing}</div></div>`;
  }

  /** « Vue 3D » of the parcours; when it cannot open here, why (under the map). @param {any} t @param {Event} e */
  async #open3d(t, e) {
    this._note3d = '';
    this._note3d = await openMap3d(t, /** @type {HTMLElement} */ (e.currentTarget)) || '';
  }

  /**
   * The walk's altitude profile: the ground's altitude at each plant, by distance from the start; its lowest and
   * highest. @param {NonNullable<ReturnType<typeof profileOf>>} p
   */
  #profile(p) {
    const W = 320, H = 84, pad = 6;
    const span = Math.max(20, p.high - p.low), len = Math.max(1, p.length);
    const x = (/** @type {number} */ d) => pad + d / len * (W - 2 * pad);
    const y = (/** @type {number} */ m) => H - pad - (m - p.low) / span * (H - 2 * pad);
    const line = p.points.map((q, i) => `${i ? 'L' : 'M'}${x(q.d).toFixed(1)} ${y(q.m).toFixed(1)}`).join(' ');
    const area = `${line} L${x(p.points[p.points.length - 1].d).toFixed(1)} ${H} L${x(p.points[0].d).toFixed(1)} ${H} Z`;
    return html`<figure class="profile">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label=${`Profil d’altitude du parcours : de ${formatAltitude(p.low)} à ${formatAltitude(p.high)}, ${formatAltitude(p.climb)} de montée`}>
        ${svg`<path class="area" d=${area}></path><path class="line" d=${line}></path>
        ${p.points.map(q => svg`<circle cx=${x(q.d)} cy=${y(q.m)} r="3"><title>${q.label ? q.label + ' — ' : ''}${formatAltitude(q.m)}</title></circle>`)}`}
      </svg>
      <figcaption>Altitude au fil des plantes : de ${formatAltitude(p.low)} à ${formatAltitude(p.high)} (IGN)</figcaption>
    </figure>`;
  }

  /** No parcours yet: the shared start screen. One action, start here; smaller, a commune, a parcours to take up again; the way out. */
  #starting() {
    // « 12 plantes · 3 oct. »: two parcours of the same name told apart by their last day.
    // « Mon parcours botanique en forêt de Fontainebleau » → « En forêt de Fontainebleau » (the heading says the rest).
    const short = (/** @type {string} */ name) => { const rest = name.startsWith(NAMED + ' ') ? name.slice(NAMED.length + 1) : ''; return rest ? rest[0].toUpperCase() + rest.slice(1) : name; };
    const day = (/** @type {any} */ p) => new Date(p.properties.updatedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    // Two of the same name the same day: told apart by the hour too.
    const twin = (/** @type {any} */ p) => this._past.some(q => q !== p && short(q.properties.name) === short(p.properties.name) && day(q) === day(p));
    const plants = (/** @type {any} */ p) => { const n = p.properties.plants.length;
      const when = twin(p) ? `${day(p)}, ${new Date(p.properties.updatedAt).toLocaleTimeString('fr-FR', { hour: 'numeric', minute: '2-digit' }).replace(':', ' h ')}` : day(p);
      return `${n ? `${n} plante${n > 1 ? 's' : ''}` : 'aucune plante'} · ${when}`; };
    return html`<div class="wrap">${startScreen({
      id: 'trail',
      art: 'trail',
      title: 'Votre parcours botanique',
      lead: 'Marchez et nommez les plantes que vous croisez. Chacune prend sa place sur la carte de votre parcours.',
      primary: { icon: 'geo-alt-fill', label: 'Commencer ici', busyLabel: 'Localisation…', busy: this._locating, cancel: () => this.#cancelStart(), run: () => this.#startHere() },
      error: this._startError,
      note: 'Votre position est envoyée à l’IGN pour nommer le lieu ; le parcours reste sur cet appareil, dans Mes plantes.',
      alternatives: [
        { kind: 'place', label: 'ou partir d’une commune', field: 'Partir d’une commune', pick: p => { this.#cancelStart(); this._startError = null; this.#create(p.coordinates, p.label); } },
        { kind: 'choices', label: 'Reprendre un parcours', items: this._past.map(p => ({ key: p.id, icon: 'flag-fill', label: short(p.properties.name), meta: plants(p), run: () => { this.#cancelStart(); this.#resume(p); } })) }
      ],
      exit: { icon: 'camera-reels', label: 'Quitter le parcours : autres scénarios', run: () => { this.#cancelStart(); this.dispatchEvent(new CustomEvent('open-scenarios', { bubbles: true, composed: true })); } }
    })}</div>`;
  }
}

customElements.define('gf-trail', GfTrail);
