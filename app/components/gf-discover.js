// @ts-check
// « Découvrir » : the plants around you, the dating-app way. A welcome with one action (« Autour de moi », or a
// commune); how far to look (200 m to 50 km, what iNaturalist's search allows), over a map of the observations
// in that circle; then the plants observed there (iNaturalist, matched to the flora), one card at a time — the
// most photographed first — each with what is said of it (Wikipédia: its names, its history) and a short « bio »
// from its real data. Swipe right: a match (kept in the favourites); left: passed; up (or ⓘ): its sheet.
// The first match opens the plant bare, and the app shows itself step by step, each step a question in a banner
// (discover.js): its photos, its encyclopedia, then a fork — picking (its uses, look-alikes and season beside it)
// or science (maps, distribution, climate, classification) —, the plants around, then the whole app that way.

import { LitElement, html, css, nothing, repeat } from 'lit';
import * as db from '../core/db.js';
import { icon } from '../core/icons.js';
import { speciesAround, observationPointsAround } from '../core/nearby.js';
import * as sources from '../core/sources.js';
import { searchPlaces, addressAt } from '../core/geoservices.js';
import { watchLocation } from '../core/geo.js';
import { alertsOf } from '../core/alerts.js';
import { setHarvestMode, setMode, StoreController, whenReady } from '../core/store.js';
import { chooseBranch, discoverEvents, discoverState, discovering, finishDiscover, firstMatchShown, plantSeen, resetPassed, setDiscoverPoint, setDiscoverRadius, setStep, swiped, unswipe, LAST_STEP, PLANTS_BEFORE_FLORE } from '../core/discover.js';
import { lookalikesOf } from '../core/lookalikes.js';
import { scenarioOf } from '../core/scenarios.js';
import { sheetSession } from '../core/sheet-session.js';
import { isFavorite, toggleFavorite } from '../core/collections.js';
import { href } from '../core/router.js';
import { depth, replaceHash } from '../core/history.js';
import { floweringMonths } from './gf-calendar.js';
import { hideImg, showImg } from '../core/img.js';
import { ui } from '../styles/ui.js';
import './gf-plant-detail.js';
import './gf-media-viewer.js';
import './gf-map.js';

/** How far to look, in metres (iNaturalist searches a circle; beyond 50 km the list is a region's, not « around »). */
const DISTANCES = [200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
/** @param {number} m */
const distLabel = m => m >= 1000 ? (m / 1000).toLocaleString('fr-FR') + ' km' : m + ' m';
/** The view chosen (Rencontres, Matchs, Toutes) in each scenario, kept while the app is open. @type {Record<string, string>} */
const lastView = {};
/** A word for the distance, for fun. @param {number} m */
const distMood = m => m <= 200 ? 'Juste devant la porte' : m <= 1000 ? 'Le quartier' : m <= 5000 ? 'Une balade à pied' : m <= 20000 ? 'Un tour à vélo' : 'Toute la région';
const PAGE = 12;
/** The dashboards of the fork: the blocks of the sheet that join the plant, picking or science. */
const DASH_HARVEST = /** @type {const} */ ([['uses', 'Usages et cuisine sauvage'], ['lookalikes', 'À ne pas confondre'], ['calendar', 'Sa saison']]);
const DASH_SCIENCE = /** @type {const} */ ([['map', 'Carte'], ['occurrences', 'Occurrences et répartition'], ['climate', 'Climat'], ['taxonomy', 'Classification']]);
const MONTH = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/**
 * @typedef {{ plant: any, count: number, photo: string | null, blooming: boolean, alerts: { safety: any, edible: any } | null,
 *   confusions?: import('../core/lookalikes.js').Lookalike[] }} Card
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
    /** The rubrics of the plant open, in the sheet's header (as in Flore). */
    _rail: { state: true },
    /** The observations in the circle, on the map behind the distance. */
    _obs: { state: true },
    /** What is said of a plant (Wikipédia), by plant id: the text, null (nothing), or absent (not asked yet). */
    _ethno: { state: true },
    /** A heart flying off the deck (a match after the first). */
    _burst: { state: true },
    /** The step offered « Plus tard »: its banner waits for the next plant. */
    _later: { state: true },
    /** On the plant for a while: the next step can be offered. */
    _dwell: { state: true }
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
    .sheet-head gf-sheet-rail { flex: 1; min-width: 0; }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .sheet-head strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sheet gf-plant-detail { flex: 1; min-height: 0; }
    .pager { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px calc(6px + env(safe-area-inset-bottom)); border-top: 1px solid var(--gf-border); background: var(--gf-surface); }
    .pager span { color: var(--gf-text-muted); font-size: 0.85rem; font-variant-numeric: tabular-nums; }
    .pager button { display: inline-flex; align-items: center; gap: 4px; }

    /* How far, over the map of what was observed in the circle. */
    .distance-wrap { position: relative; min-height: 100%; display: grid; }
    .distance-wrap gf-map { position: absolute; inset: 0; display: block; }
    .distance-wrap .welcome { position: relative; z-index: 1; align-self: end; margin: auto auto 24px; width: min(560px, calc(100% - 24px)); padding: 18px 18px 16px;
      border-radius: 18px; background: color-mix(in srgb, var(--gf-surface) 92%, transparent); box-shadow: var(--gf-shadow-float); backdrop-filter: blur(6px); gap: 10px; }
    .distance-wrap .welcome .leaf { display: none; }
    .distance-wrap .welcome h1 { font-size: 1.35rem; }
    .dist .obs { font-size: 0.8rem; color: var(--gf-text-muted); min-height: 1.2em; }

    /* What is said of it (Wikipédia), on the card. */
    .ethno { margin: 0 0 6px; font-size: 0.86rem; line-height: 1.35; font-style: italic; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .ethno b { font-style: normal; }
    /* A match after the first: a heart flies off the deck. */
    .burst { position: absolute; z-index: 5; left: 50%; top: 45%; font-size: 4rem; color: #e0245e; pointer-events: none; animation: burst 0.9s ease-out forwards; }
    @keyframes burst { from { transform: translate(-50%, -50%) scale(0.4); opacity: 0; } 30% { opacity: 1; transform: translate(-50%, -50%) scale(1.15); } to { transform: translate(-50%, -120%) scale(1); opacity: 0; } }

    /* The plant bare: over everything (no header, no tabs), the plant only. */
    .nude { position: fixed; inset: 0; z-index: 1002; display: flex; flex-direction: column; background: var(--gf-surface); color: var(--gf-text); }
    .nude-bar { flex: none; display: flex; align-items: center; gap: 8px; padding: 6px 8px calc(6px); padding-top: calc(6px + env(safe-area-inset-top)); border-bottom: 1px solid var(--gf-border); }
    .nude-bar .who { flex: 1; min-width: 0; display: grid; line-height: 1.15; }
    .nude-bar .who b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .nude-bar .who i { font-size: 0.8rem; color: var(--gf-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .nude-bar .round { width: 42px; height: 42px; font-size: 1.1rem; box-shadow: none; border: 1px solid var(--gf-border); }
    .nude-body { flex: 1; min-height: 0; display: flex; }
    .nude-main { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
    .nude-media { flex: 1; min-height: 0; display: flex; flex-direction: column; background: #111; }
    .nude-media gf-media-viewer { flex: 1; min-height: 0; }
    .nude-media .bare-photo { flex: 1; min-height: 0; position: relative; display: grid; place-items: center; overflow: hidden; }
    .nude-media .bare-photo img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .nude-media .bare-photo .nophoto { font-size: 4rem; color: #fff; opacity: 0.4; }
    /* Step 2: the media stuck in the top half, the encyclopedia under it. */
    .nude.split .nude-media { flex: 0 0 50%; }
    .nude-wiki { flex: 1; min-height: 0; display: flex; flex-direction: column; border-top: 1px solid var(--gf-border); }
    .nude-wiki gf-plant-detail { flex: 1; min-height: 0; }
    /* The fork's dashboard: tiles of the sheet's blocks, over the article; the whole column scrolls. */
    .nude.dashed .nude-wiki { overflow-y: auto; }
    .nude.dashed .nude-wiki > gf-plant-detail { flex: none; min-height: 60vh; }
    .dash { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 10px; padding: 10px; background: var(--gf-surface-2); }
    .dash .tile { min-width: 0; display: flex; flex-direction: column; border-radius: var(--gf-radius); background: var(--gf-surface); box-shadow: var(--gf-shadow); overflow: hidden; }
    .dash .tile h3 { margin: 0; padding: 8px 12px 0; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--gf-text-muted); }
    .dash .tile gf-plant-detail { display: block; max-height: 420px; overflow: auto; }
    .dash.science .tile[data-key='map'] { grid-column: 1 / -1; }
    .dash.science .tile[data-key='map'] gf-plant-detail { height: 320px; max-height: none; }
    .step-banner .yes.fork { display: inline-flex; gap: 6px; align-items: center; }
    /* Step 3: the plants around — a column on a wide screen, a drawer from the bottom on a phone. */
    .around { flex: none; width: 270px; border-right: 1px solid var(--gf-border); display: flex; flex-direction: column; min-height: 0; background: var(--gf-surface); }
    .around h2 { margin: 0; padding: 10px 12px 6px; font-size: 0.95rem; display: flex; justify-content: space-between; align-items: center; gap: 6px; }
    .around ul { list-style: none; margin: 0; padding: 0 6px 10px; overflow-y: auto; flex: 1; min-height: 0; }
    .around li button { width: 100%; display: grid; grid-template-columns: 44px 1fr; gap: 8px; align-items: center; padding: 5px 6px; border: 0; border-radius: var(--gf-radius-sm); background: none; font: inherit; text-align: left; cursor: pointer; color: var(--gf-text); }
    .around li button:hover { background: var(--gf-surface-2); }
    .around li button[aria-current='true'] { background: var(--gf-accent-soft); }
    .around .th { width: 44px; height: 44px; border-radius: 8px; overflow: hidden; background: var(--gf-surface-2); }
    .around .th img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .around .t { display: grid; min-width: 0; line-height: 1.2; }
    .around .t b { font-size: 0.86rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .around .t small { font-size: 0.74rem; color: var(--gf-text-muted); }
    @media (max-width: 899px) {
      .around { position: absolute; z-index: 4; left: 0; right: 0; bottom: 0; width: auto; max-height: 46dvh; border-right: 0; border-top: 1px solid var(--gf-border);
        border-radius: 16px 16px 0 0; box-shadow: 0 -8px 24px rgb(0 0 0 / 18%); transform: translateY(calc(100% - 46px)); transition: transform 0.25s ease-out; }
      .around.up { transform: none; }
      .around h2 { cursor: pointer; min-height: 46px; box-sizing: border-box; }
      .nude.listed .nude-main { padding-bottom: 46px; }
    }
    .nude-body { position: relative; }
    /* The step offered: a banner with its question, Oui / Plus tard. */
    .step-banner { position: absolute; z-index: 6; left: 50%; bottom: calc(16px + env(safe-area-inset-bottom)); transform: translateX(-50%); width: min(520px, calc(100% - 24px));
      display: grid; gap: 10px; padding: 14px 16px; border-radius: 16px; background: #1f2a1f; color: #fff; box-shadow: 0 12px 34px rgb(0 0 0 / 35%); animation: rise 0.3s ease-out; }
    .nude.listed .step-banner { bottom: calc(58px + env(safe-area-inset-bottom)); }
    .step-banner p { margin: 0; font-size: 0.98rem; line-height: 1.4; }
    .step-banner .q { font-weight: 700; }
    .step-banner .row { justify-content: flex-end; margin: 0; }
    .step-banner button { min-height: 38px; padding: 6px 16px; border-radius: var(--gf-radius-pill); border: 0; font: inherit; font-weight: 600; cursor: pointer; }
    .step-banner .yes { background: #9be15d; color: #142014; }
    .step-banner .later { background: transparent; color: #cfd8cf; }
    @keyframes rise { from { opacity: 0; transform: translate(-50%, 12px); } }
    @media (prefers-reduced-motion: reduce) { .card, .burst, .step-banner, .around { transition: none; animation: none; } }  `];

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
    /** @type {{ coordinates: [number, number], title: string }[]} */
    this._obs = [];
    /** @type {Map<number, string | null>} */
    this._ethno = new Map();
    this._burst = 0;
    /** @type {number | null} */
    this._later = null;
    this._dwell = false;
  }

  #onChange = () => this.requestUpdate();
  /** Played again from the start: what this screen remembered goes too (the cards, ↺, the steps counted). */
  #onReset = () => {
    this.#abort?.abort();
    this._point = null; this._place = null; this._cards = null; this._radius = 1000; this._asking = false;
    this._history = []; this._match = null; this._ethno = new Map(); this._obs = []; this._later = null; this._error = null;
    this._view = 'swipe'; this._loading = false;
    this.#navs = 0; this.#navsAtStep = 0;
  };
  #onKey = (/** @type {KeyboardEvent} */ e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    // The first match waits for its one button: no key closes it.
    if (this._match) { if (e.key === 'Escape') e.preventDefault(); return; }
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
    // Bare: → keeps the plant and goes on, ← passes it — as with the cards.
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); if (this.#nude) this.#nudeNext(e.key === 'ArrowRight'); else this.#step(e.key === 'ArrowRight' ? 1 : -1); }
    else if (e.key === 'Escape') { e.preventDefault(); this.#close(); }
  };

  connectedCallback() {
    super.connectedCallback();
    discoverEvents.addEventListener('change', this.#onChange);
    discoverEvents.addEventListener('reset', this.#onReset);
    addEventListener('keydown', this.#onKey);
    if (this._point && !this._cards) this.#load();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    discoverEvents.removeEventListener('change', this.#onChange);
    discoverEvents.removeEventListener('reset', this.#onReset);
    removeEventListener('keydown', this.#onKey);
    clearTimeout(this.#dwellTimer);
    clearTimeout(this.#obsTimer);
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
    // Another plant (bare): a step put off comes back; the next one is offered after a while on it.
    if (changed.has('open')) {
      if (changed.get('open') != null && this.open != null) this.#navs++;
      this._later = null;
      this._dwell = false;
      clearTimeout(this.#dwellTimer);
      if (this.open != null) this.#dwellTimer = setTimeout(() => { this._dwell = true; }, 6000);
    }
    // The distance changed: the map's observations follow (a moment after the slider stops).
    if ((changed.has('_radius') || changed.has('_asking') || changed.has('_point')) && this._asking && this._point) {
      clearTimeout(this.#obsTimer);
      this.#obsTimer = setTimeout(() => this.#loadPoints(), 400);
    }
    this.toggleAttribute('opened', this.open != null);
  }
  /** @type {any} */ #dwellTimer = 0;
  /** @type {any} */ #obsTimer = 0;
  /** Plants stepped through bare (each step after the second waits for two of them). */
  #navs = 0;
  /** The number of plants stepped through when the current step began. */
  #navsAtStep = 0;

  /** The observations in the circle, for the map behind the distance. */
  async #loadPoints() {
    const point = this._point, radius = this._radius;
    if (!point) return;
    const pts = await observationPointsAround(point, radius).catch(() => []);
    if (this._point === point && this._radius === radius) this._obs = pts;
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
        // The most observed here first (the most photos: every observation has one), then those in flower.
        list.sort((a, b) => b.count - a.count || Number(b.blooming) - Number(a.blooming));
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

  get #sheet() { return /** @type {any} */ (this.renderRoot.querySelector('.sheet gf-plant-detail')); }

  // ── Render ────────────────────────────────────────────────────────────

  render() {
    return html`${!this._point ? this.#welcome() : this._asking || (!this._cards && !this._loading && !this._error) ? this.#distance() : this.#list()}
      ${this._match ? this.#matchView(this._match) : nothing}
      ${this.open != null ? (this.#nude ? this.#nudeView() : this.#plantSheet()) : nothing}`;
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
    const point = /** @type {[number, number]} */ (this._point);
    return html`<div class="distance-wrap">
      <gf-map no-search no-create no-locate .area=${{ center: point, radius: this._radius, fit: true, points: this._obs }}></gf-map>
      <section class="welcome distance">
      <div class="leaf" aria-hidden="true">${icon('geo-alt-fill')}</div>
      <h1>Jusqu’où cherchez-vous ?</h1>
      <p>Autour ${this._place ? 'de ' + this._place : 'de vous'}. Plus c’est loin, plus il y a de prétendantes — et moins elles sont à portée de pied.</p>
      <div class="dist">
        <output>${distLabel(this._radius)}</output>
        <span class="mood">${distMood(this._radius)}</span>
        <input type="range" min="0" max=${DISTANCES.length - 1} step="1" .value=${String(at)} aria-label="Distance de la recherche"
          aria-valuetext=${distLabel(this._radius)} @input=${(/** @type {any} */ e) => { this._radius = DISTANCES[Number(e.target.value)]; }} />
        <div class="ticks" aria-hidden="true"><span>200 m</span><span>50 km</span></div>
        <span class="obs" aria-live="polite">${this._obs.length ? `${this._obs.length >= 200 ? '200 dernières observations' : this._obs.length + ' observation' + (this._obs.length > 1 ? 's' : '')} de plantes sur la carte` : ''}</span>
      </div>
      <button class="primary go" type="button" @click=${() => { setDiscoverRadius(this._radius); this._asking = false; this._view = 'swipe'; this.#load(); }}>${icon('binoculars')} Voir qui est dans le coin</button>
      <button class="link skip" type="button" @click=${() => { this._point = null; this._asking = false; }}>Changer de lieu</button>
    </section></div>`;
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
        ${this._burst ? html`<span class="burst" aria-hidden="true">${icon('heart-fill')}</span>` : nothing}
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
      <div class="nophoto">${icon('leaf')}</div>
      ${c.photo ? html`<img src=${c.photo} alt="" loading=${top ? 'eager' : 'lazy'} decoding="async" referrerpolicy="no-referrer" draggable="false" @error=${hideImg} @load=${showImg} />` : nothing}
      <span class="stamp like">MATCH</span><span class="stamp nope">BOF</span>
      <div class="about">
        <h2>${name}<small>${p.scientificName}</small></h2>
        ${this.#ethnoLine(c)}
        <ul class="bio">${this.#bio(c).slice(0, this._ethno.get(p.id) ? 3 : 4).map(line => html`<li>${line}</li>`)}</ul>
      </div>
    </article>`;
  }

  /**
   * What is said of it: the first sentence of the article's names and etymology, else of its history, else its
   * short description (Wikipédia, CC BY-SA). Asked only for the cards in view (the top one and the next).
   * @param {Card} c
   */
  #ethnoLine(c) {
    const id = c.plant.id;
    if (!this._ethno.has(id)) this.#loadEthno(c);
    const text = this._ethno.get(id);
    return text ? html`<p class="ethno"><b>On dit de moi :</b> ${text}</p>` : nothing;
  }

  /** @param {Card} c */
  async #loadEthno(c) {
    const id = c.plant.id;
    this._ethno = new Map(this._ethno).set(id, null);
    const qid = c.plant.identifiers?.wikidata;
    const wiki = qid ? await sources.wikipedia(c.plant, qid).catch(() => null) : null;
    const first = (/** @type {string | undefined} */ t) => {
      const one = (t || '').replace(/\s+/g, ' ').trim().match(/^.{20,220}?[.!?](?=\s|$)/)?.[0] || (t || '').trim().slice(0, 180);
      return one.length > 20 ? one : '';
    };
    const pick = (/** @type {string} */ theme) => first(wiki?.sections?.find((/** @type {any} */ x) => x.theme === theme)?.text);
    const text = pick('names') || pick('history') || first(wiki?.description || '') || '';
    if (text) this._ethno = new Map(this._ethno).set(id, text);
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
        // The first match (while discovering): its screen, once. The next ones: a heart.
        if (discovering() && !discoverState().firstMatch) this._match = card;
        else { this._burst++; const n = this._burst; setTimeout(() => { if (this._burst === n) this._burst = 0; }, 900); }
      }
    };
    if (!node || matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return; }
    node.classList.add('fly');
    node.style.transform = `translate(${liked ? 140 : -140}vw, -40px) rotate(${liked ? 30 : -30}deg)`;
    setTimeout(done, 260);
  }

  /**
   * The first match: a screen of its own, with one way out — to the plant. Nothing else closes it (no click
   * outside, no key, no timer).
   * @param {Card} c
   */
  #matchView(c) {
    const name = c.plant.vernacularNames?.[0] || c.plant.scientificName;
    return html`<div class="match" role="alertdialog" aria-modal="true" aria-label="C’est un match" aria-describedby="match-text">
      <p class="title">C’est un match !</p>
      ${c.photo ? html`<img src=${c.photo} alt="" decoding="async" referrerpolicy="no-referrer" @error=${hideImg} />` : nothing}
      <p id="match-text">Vous et <b>${name}</b> vous plaisez mutuellement. Elle est gardée dans vos favoris (♥).</p>
      <div class="row">
        <button class="primary" type="button" autofocus @click=${() => { firstMatchShown(); this._match = null; this.#openPlant(c.plant.id, this.#deck.map(x => x.plant.id)); }}>Découvrir cette plante</button>
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
      <div class="ph">${c.photo ? html`<img src=${c.photo} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error=${hideImg} @load=${showImg} />` : nothing}</div>
      <div class="chips">${c.blooming ? html`<span class="chip bloom">En fleur</span>` : nothing}
        ${n ? html`<span class="chip ${danger ? 'danger' : 'warn'}">${danger ? 'Attention' : 'À savoir'} · ${n}</span>` : nothing}</div>
      ${discoverState().seen.includes(p.id) ? html`<span class="seen" title="Déjà découverte" aria-label="Déjà découverte">${icon('check-lg')}</span>` : nothing}
      <div class="txt"><b>${name}</b><i>${p.scientificName}</i></div>
    </button>`;
  }

  // ── Bare: the plant alone, the app shown step by step ─────────────────

  /** The plant opened bare: while discovering (the first steps), in Rencontres. */
  get #nude() { return this.open != null && discovering() && discoverState().firstMatch && scenarioOf(this.scenario).key === 'meet'; }

  /**
   * Bare, as with the cards: kept (→, a match) or passed (←), then the next plant of the deck. A plant already
   * matched stays a match when passed by.
   * @param {boolean} keep
   */
  #nudeNext(keep) {
    const card = (this._cards || []).find(c => c.plant.id === this.open);
    if (card) {
      const s = discoverState();
      if (keep && !s.matches.includes(card.plant.id)) {
        if (!isFavorite(card.plant.id)) toggleFavorite(card.plant).catch(() => {});
        swiped(card.plant.id, true);
      } else if (!keep && !s.matches.includes(card.plant.id)) swiped(card.plant.id, false);
    }
    const next = this.#deck.find(c => c.plant.id !== this.open);
    if (!next) { this.#close(); return; }
    replaceHash(href.discover(next.plant.id, this.scenario));
    this.open = next.plant.id;
  }

  /** A plant of the list around, opened bare. @param {number} id */
  #nudeGo(id) {
    if (id === this.open) return;
    replaceHash(href.discover(id, this.scenario));
    this.open = id;
    this._aroundUp = false;
  }
  /** Phone: the list of the plants around pulled up. */
  _aroundUp = false;

  /** A swipe on the bare plant (not on the photos, which have their own): right keeps, left passes. */
  #nudeTouchStart = (/** @type {TouchEvent} */ e) => {
    const t = /** @type {HTMLElement} */ (e.composedPath()[0]);
    this.#touch = t?.closest?.('gf-media-viewer, gf-plant-detail, .around, button') ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  };
  #nudeTouchEnd = (/** @type {TouchEvent} */ e) => {
    const s = this.#touch; this.#touch = null;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6 && Date.now() - s.t < 600) this.#nudeNext(dx > 0);
  };

  /**
   * The step to offer now, if any: its photos at once; its encyclopedia after a moment on it (or the next plant);
   * the plants around, then everything, each after two more plants.
   * @returns {{ step: number, text: string, question: string, fork?: boolean } | null}
   */
  #offer() {
    const step = discoverState().step, navs = this.#navs - this.#navsAtStep;
    if (this._later === step) return null;
    if (step === 0) return { step: 1, text: 'Cette plante a d’autres photos, prises près d’ici et ailleurs : fleurs, feuilles, fruits…', question: 'On les regarde ?' };
    if (step === 1 && (this._dwell || navs >= 1)) return { step: 2, text: 'Belle, mais qui est-elle vraiment ? Son nom, son histoire, ses usages, ce qu’en dit l’encyclopédie.', question: 'On en apprend plus ?' };
    if (step === 2 && (this._dwell || navs >= 1)) return { step: 3, fork: true, text: 'Et vous, qu’aimeriez-vous savoir des plantes ?', question: 'Ce qui se cueille, ou ce qu’en dit la science ?' };
    if (step === 3 && navs >= 2) return { step: 4, text: 'D’autres plantes poussent autour de vous, tout près de celle-ci.', question: 'On les voit toutes ?' };
    if (step === 4 && navs >= 2) return { step: LAST_STEP, text: discoverState().branch === 'science'
      ? 'Vous connaissez le coin ! La flore complète vous attend en mode Scientifique : toutes les données, toutes les cartes.'
      : 'Vous connaissez le coin ! La flore complète vous attend, en mode cueillette : la saison, les sosies, vos lieux de récolte.', question: 'Prêt·e pour la flore complète ?' };
    return null;
  }

  /** The step offered; at the fork, the two ways. @param {{ step: number, text: string, question: string, fork?: boolean }} o */
  #banner(o) {
    return html`<div class="step-banner" role="dialog" aria-label=${'Étape suivante : ' + o.question}>
      <p>${o.text} <span class="q">${o.question}</span></p>
      <div class="row">
        <button class="later" type="button" @click=${() => { this._later = discoverState().step; }}>Plus tard</button>
        ${o.fork ? html`<button class="yes fork" type="button" data-branch="harvest" @click=${() => this.#fork('harvest')}>${icon('basket')} La cueillette</button>
          <button class="yes fork" type="button" data-branch="science" @click=${() => this.#fork('science')}>${icon('diagram-3')} La science</button>`
        : html`<button class="yes" type="button" @click=${() => this.#accept(o.step)}>Oui</button>`}
      </div>
    </div>`;
  }

  /** The fork: picking or science; its dashboard joins the plant. @param {'harvest' | 'science'} branch */
  #fork(branch) {
    this.#navsAtStep = this.#navs;
    chooseBranch(branch);
    this.requestUpdate();
  }

  /**
   * The dashboard of the way chosen, under the photos: picking — its uses (prudence first), what it is mistaken
   * for, its season; science — its maps, where it is recorded, its climate, its classification. Then the article.
   * @param {'harvest' | 'science'} branch
   */
  #dashboard(branch) {
    const blocks = branch === 'harvest' ? DASH_HARVEST : DASH_SCIENCE;
    return html`<div class="dash ${branch}" aria-label=${branch === 'harvest' ? 'Tableau de bord cueillette' : 'Tableau de bord scientifique'}>
      ${blocks.map(([key, label]) => html`<section class="tile" data-key=${key}><h3>${label}</h3>
        <gf-plant-detail embedded only=${key} plant-id=${this.open} view=${branch === 'science' ? 'scientific' : 'standard'}></gf-plant-detail></section>`)}
    </div>`;
  }

  /** A step accepted; the last one leaves the bare view for the whole app, on this plant. @param {number} step */
  #accept(step) {
    this.#navsAtStep = this.#navs;
    this._dwell = false;
    clearTimeout(this.#dwellTimer);
    this.#dwellTimer = setTimeout(() => { this._dwell = true; }, 6000);
    const id = this.open;
    // The whole app, the way chosen at the fork.
    if (step >= LAST_STEP) { if (discoverState().branch === 'science') setMode('scientific'); else if (discoverState().branch === 'harvest') setHarvestMode(true); }
    setStep(step);
    if (step >= LAST_STEP && id != null) location.hash = href.plant(id);
    this.requestUpdate();
  }

  /** The plants around (step 3): their thumbnail, name and « en fleur »; a touch opens one bare. @param {Card[]} cards */
  #aroundList(cards) {
    return html`<aside class="around ${this._aroundUp ? 'up' : ''}" aria-label="Les plantes autour">
      <h2 @click=${() => { this._aroundUp = !this._aroundUp; this.requestUpdate(); }}>Les voisines <small class="muted">${cards.length}</small></h2>
      <ul>${repeat(cards, c => c.plant.id, c => html`<li><button type="button" aria-current=${String(c.plant.id === this.open)} @click=${() => this.#nudeGo(c.plant.id)}>
        <span class="th">${c.photo ? html`<img src=${c.photo.replace('/medium.', '/square.')} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error=${hideImg} @load=${showImg} />` : nothing}</span>
        <span class="t"><b>${c.plant.vernacularNames?.[0] || c.plant.scientificName}</b><small>${c.blooming ? 'En fleur · ' : ''}${c.count} obs.${discoverState().matches.includes(c.plant.id) ? ' · ♥' : ''}</small></span>
      </button></li>`)}</ul>
    </aside>`;
  }

  /** The plant bare: no header, no tabs — its photos, then its encyclopedia, then the plants around. */
  #nudeView() {
    const step = discoverState().step;
    const cards = this._cards || [];
    const card = cards.find(c => c.plant.id === this.open);
    const plant = card?.plant;
    const name = plant ? plant.vernacularNames?.[0] || plant.scientificName : '';
    const offer = this.#offer();
    const kept = this.open != null && discoverState().matches.includes(this.open);
    const branch = step >= 3 ? discoverState().branch : null;
    return html`<section class="nude ${step >= 2 ? 'split' : ''} ${step >= 4 ? 'listed' : ''} ${branch ? 'dashed' : ''}" role="dialog" aria-modal="true" aria-label=${name || 'Plante'}
        @touchstart=${this.#nudeTouchStart} @touchend=${this.#nudeTouchEnd}>
      <div class="nude-bar">
        <button class="icon-btn" type="button" aria-label="Retour aux rencontres" title="Retour aux rencontres (Échap)" @click=${() => this.#close()}>${icon('arrow-left')}</button>
        <div class="who"><b>${name}</b>${plant ? html`<i>${plant.scientificName}</i>` : nothing}</div>
        <button class="round pass" type="button" aria-label="Passer : plante suivante" title="Passer (←)" @click=${() => this.#nudeNext(false)}>${icon('x-lg')}</button>
        <button class="round like" type="button" aria-pressed=${String(kept)} aria-label="Garder : plante suivante" title="Garder ♥ et suivante (→)" @click=${() => this.#nudeNext(true)}>${icon('heart-fill')}</button>
      </div>
      <div class="nude-body">
        ${step >= 4 ? this.#aroundList(cards) : nothing}
        <div class="nude-main">
          <div class="nude-media">${step >= 1 ? html`<gf-media-viewer local plant-id=${this.open} .view=${'standard'}></gf-media-viewer>`
            : html`<div class="bare-photo"><span class="nophoto">${icon('leaf')}</span>${card?.photo ? html`<img src=${card.photo.replace('/medium.', '/large.')} alt=${name} decoding="async" referrerpolicy="no-referrer" style="position:absolute" @error=${hideImg} @load=${showImg} />` : nothing}</div>`}</div>
          ${step >= 2 ? html`<div class="nude-wiki">${branch ? this.#dashboard(branch) : nothing}<gf-plant-detail embedded only="wikipedia" plant-id=${this.open} view="standard"></gf-plant-detail></div>` : nothing}
        </div>
        ${offer ? this.#banner(offer) : nothing}
      </div>
    </section>`;
  }

  #plantSheet() {
    const list = this._cards || [];
    const at = list.findIndex(c => c.plant.id === this.open);
    const name = at >= 0 ? list[at].plant.vernacularNames?.[0] || list[at].plant.scientificName : '';
    return html`<section class="sheet" aria-label="Plante" @touchstart=${this.#touchStart} @touchend=${this.#touchEnd}>
      <div class="sheet-head">
        <button class="icon-btn" type="button" aria-label="Retour aux plantes autour" title="Retour (Échap)" @click=${() => this.#close()}>${icon('arrow-left')}</button>
        ${this._rail && this._rail.plantId === this.open && this._rail.items.length ? html`<span class="visually-hidden">${name}</span><gf-sheet-rail .items=${this._rail.items} .active=${this._rail.active} orientation="row"
          @rail-go=${(/** @type {CustomEvent} */ e) => this.#sheet?.goTo(e.detail.key)}></gf-sheet-rail>` : html`<strong>${name}</strong>`}
      </div>
      <gf-plant-detail embedded outer-rail plant-id=${this.open} view="epure" @sheet-rail=${(/** @type {CustomEvent} */ e) => { this._rail = e.detail; }}></gf-plant-detail>
      ${at >= 0 ? html`<nav class="pager" aria-label="Plantes autour">
        <button class="secondary prev" type="button" ?disabled=${at <= 0} @click=${() => this.#step(-1)}>${icon('chevron-left')} Préc.</button>
        <span>${at + 1} / ${list.length}</span>
        <button class="primary next" type="button" ?disabled=${at >= list.length - 1} @click=${() => this.#step(1)}>Suivante ${icon('chevron-right')}</button>
      </nav>` : nothing}
    </section>`;
  }
}

customElements.define('gf-discover', GfDiscover);
