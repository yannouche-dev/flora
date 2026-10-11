// @ts-check
// « Découvrir » : the plants around you, the dating-app way. A welcome with one action (« Autour de moi », or a
// commune); how far to look (200 m to 50 km, what iNaturalist's search allows), over a map of the observations
// in that circle; then the plants observed there (iNaturalist, matched to the flora), one card at a time — the
// most photographed first — each with what is said of it (Wikipédia: its names, its history) and a short « bio »
// from its real data. Swipe right: a match (kept in the favourites); left: passed; up (or ⓘ): its sheet.
// Rencontres, while discovering: from simple to complex, one block at a time. Two blocks first — the map of the
// circle (its distance still at hand) and the cards, the plant on top lit on the map —; the first match offers its
// photos (a third block, the zoom shown), then each step a question in a banner (discover.js) adds its pane to the
// layout: its encyclopedia, then a fork — picking (its uses, look-alikes and season) or science (maps,
// distribution, climate, classification) —, the plants around, then the whole app that way.

import { LitElement, html, css, nothing, repeat } from 'lit';
import * as db from '../core/db.js';
import { icon } from '../core/icons.js';
import { speciesAround, observationPointsAround, observationsAround, observationsInBox } from '../core/nearby.js';
import { adminShape } from '../core/geoservices.js';
import { FRANCE_BOUNDS, WORLD_BOUNDS } from '../core/ign.js';
import * as sources from '../core/sources.js';
import { searchPlaces, addressAt } from '../core/geoservices.js';
import { REGION_BOUNDS, regionOf } from '../core/regions.js';
import { watchLocation } from '../core/geo.js';
import { alertsOf } from '../core/alerts.js';
import { plantViewOf, setHarvestMode, setMode, StoreController, whenReady } from '../core/store.js';
import { dockBlock, paneOf, setStackState } from '../core/sheet-blocks.js';
import { stepBack, chooseBranch, discoverEvents, discoverState, discovering, finishDiscover, firstMatchShown, plantSeen, resetPassed, setDiscoverPoint, setDiscoverRadius, setStep, swiped, unswipe, LAST_STEP, PLANTS_BEFORE_FLORE } from '../core/discover.js';
import { lookalikesOf } from '../core/lookalikes.js';
import { scenarioOf } from '../core/scenarios.js';
import { scene, sceneStyles } from '../core/scenes.js';
import { sheetSession } from '../core/sheet-session.js';
import { isFavorite, toggleFavorite } from '../core/collections.js';
import { href, parse } from '../core/router.js';
import { depth, replaceHash } from '../core/history.js';
import { floweringMonths } from './gf-calendar.js';
import { hideImg, showImg } from '../core/img.js';
import { ui } from '../styles/ui.js';
import './gf-plant-detail.js';
import './gf-media-viewer.js';
import './gf-map.js';
import './gf-trail.js';

/** How far to look, in metres (iNaturalist searches a circle; beyond 50 km the list is a region's, not « around »). */
const DISTANCES = [200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
/** @param {number} m */
const distLabel = m => m >= 1000 ? (m / 1000).toLocaleString('fr-FR') + ' km' : m + ' m';
/** The view chosen (Rencontres, Matchs, Toutes) in each scenario, kept while the app is open. @type {Record<string, string>} */
const lastView = {};
/** A word for the distance, for fun. @param {number} m */
const distMood = m => m <= 200 ? 'Juste devant la porte' : m <= 1000 ? 'Le quartier' : m <= 5000 ? 'Une balade à pied' : m <= 20000 ? 'Un tour à vélo' : 'Toute la région';
const PAGE = 12;
/** Past this many points, a map groups them. */
const MANY = 250;
/** The scopes offered after a match: where else the plant grows. */
/** The steps of the discovery, as the bar shows them. */
const STAGES = ['Carte', 'Rencontres', 'Photos', 'Encyclopédie', 'Cueillette ou science', 'Voisines'];
/** What each step brings, said on its button in the bar. */
const STAGE_ABOUT = ['La carte : jusqu’où chercher', 'Les cartes des plantes d’ici, à côté de la carte', 'Les photos de la plante aimée',
  'Ce qu’en dit l’encyclopédie', 'La cueillette ou la science : à vous de choisir', 'Les plantes voisines, sous la carte'];
const SCOPES = /** @type {const} */ (['around', 'department', 'region', 'country', 'world']);
/** The deck has shown it can be swiped (once while the app is open). */
let hinted = false;
/** The fork's pane: the blocks of the sheet that join the layout, picking or science (the first one shown). */
const FORK_BLOCKS = { harvest: ['uses', 'lookalikes', 'calendar'], science: ['map', 'occurrences', 'climate', 'taxonomy'] };
const MONTH = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/**
 * @typedef {{ plant: any, taxonId?: number, count: number, photo: string | null, blooming: boolean, alerts: { safety: any, edible: any } | null,
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
    /** How many observations there are in the circle in all (the map shows up to 1000). */
    _obsTotal: { state: true },
    /** Where else the plant in view grows, after a match: 'around' (the circle), 'department', 'region', 'country', 'world'. */
    _scope: { state: true },
    /** The département and région of the place (their names and outlines). */
    _admin: { state: true },
    /** What is said of a plant (Wikipédia), by plant id: the text, null (nothing), or absent (not asked yet). */
    _ethno: { state: true },
    /** A heart flying off the deck (a match after the first). */
    _burst: { state: true },
    /** The step offered « Plus tard »: its banner waits for the next plant. */
    _later: { state: true },
    /** On the plant for a while: the next step can be offered. */
    _dwell: { state: true },
    /** The plant the panes show while discovering (the one matched, or chosen among the plants around); else the top card. */
    _focus: { state: true },
    _note: { state: true },
    /** On the map: where the plant in view was observed in the circle. */
    _hl: { state: true }
  };

  static styles = [ui, sceneStyles, css`
    :host { display: block; position: relative; min-height: 0; overflow-y: auto; background: var(--gf-bg, var(--gf-surface-2)); container-type: inline-size; }
    .welcome { max-width: 560px; margin: 0 auto; padding: 28px 20px 32px; display: grid; gap: 18px; text-align: center; }
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
    /* The first time: a little swipe right, then left (its stamps showing a moment), and back. */
    .swipe-card.hint { animation: swipe-hint 1.6s ease-in-out; }
    .swipe-card.hint .stamp.like { animation: hint-like 1.6s ease-in-out; }
    .swipe-card.hint .stamp.nope { animation: hint-nope 1.6s ease-in-out; }
    @keyframes swipe-hint { 25% { transform: translateX(46px) rotate(5deg); } 40% { transform: none; } 65% { transform: translateX(-46px) rotate(-5deg); } 80%, to { transform: none; } }
    @keyframes hint-like { 25% { opacity: 0.7; } 40%, to { opacity: 0; } }
    @keyframes hint-nope { 0%, 40% { opacity: 0; } 65% { opacity: 0.7; } 80%, to { opacity: 0; } }
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
    /* Under the tiles, the colour of the aerial photo: a zoom out (a larger circle) shows no pale flash. */
    .distance-wrap gf-map .leaflet-container { background: #2f4a2c; }
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

    /* Discovering: blocks side by side — the map, the cards, then the panes the steps add. */
    .guided { position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--gf-bg, var(--gf-surface-2)); }
    .g-scroll { position: relative; flex: 1; min-height: 0; display: flex; }
    /* The steps: a bar above the blocks, always in sight — done, the one shown, to come; back and next. */
    .g-steps { flex: none; display: flex; align-items: center; gap: 10px; padding: 6px 10px; background: var(--gf-surface); border-bottom: 1px solid var(--gf-border); z-index: 2; }
    .g-steps .mid { flex: 1; min-width: 0; display: grid; gap: 2px; }
    .g-steps ol { list-style: none; margin: 0; padding: 0; display: flex; align-items: center; gap: 4px; overflow-x: auto; scrollbar-width: none; }
    .g-steps ol::-webkit-scrollbar { display: none; }
    .g-steps li { flex: none; display: inline-flex; align-items: center; gap: 5px; font-size: 0.8rem; color: var(--gf-text-muted); white-space: nowrap; }
    .g-steps li + li::before { content: ''; width: 14px; height: 1px; background: var(--gf-border); margin-right: 2px; }
    .g-steps .n { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 0.7rem; font-weight: 700; border: 1px solid var(--gf-border); background: var(--gf-surface); }
    .g-steps li.done .n { background: var(--gf-accent-soft); border-color: var(--gf-accent); color: var(--gf-accent); }
    .g-steps li.on { color: var(--gf-text); font-weight: 700; }
    .g-steps li button { display: inline-flex; align-items: center; gap: 5px; border: 0; background: none; padding: 2px 4px; margin: -2px -4px; border-radius: var(--gf-radius-pill);
      font: inherit; color: inherit; cursor: pointer; min-height: 0; }
    .g-steps li button:not(:disabled):hover { background: var(--gf-accent-soft); color: var(--gf-text); }
    .g-steps li button:disabled { cursor: default; opacity: 1; }
    .g-steps li:not(.done):not(.on) button:disabled { opacity: 0.6; }
    .g-steps li.on .n { background: var(--gf-accent); border-color: var(--gf-accent); color: var(--gf-accent-contrast, #fff); }
    .g-steps .hint { margin: 0; font-size: 0.78rem; color: var(--gf-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .g-steps .prev { flex: none; display: inline-flex; align-items: center; gap: 2px; min-height: 34px; padding: 0 10px 0 6px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-pill);
      background: var(--gf-surface); color: var(--gf-text); font: inherit; font-size: 0.85rem; cursor: pointer; }
    .g-steps .prev:disabled { opacity: 0.35; cursor: default; }
    .g-steps .next { flex: none; display: flex; gap: 6px; }
    .g-steps .next button { min-height: 34px; padding: 0 14px; display: inline-flex; align-items: center; gap: 4px; font-size: 0.88rem; white-space: nowrap; }
    @media (max-width: 899px) {
      .g-steps { flex-wrap: wrap; gap: 6px 8px; padding: 6px 8px; }
      .g-steps .mid { order: -1; flex-basis: 100%; }
      .g-steps li:not(.on) .l { display: none; }
      .g-steps .prev span { display: none; }
      .g-steps .prev { padding: 0 8px; }
      .g-steps .next { flex: 1; justify-content: flex-end; }
    }
    /* The map alone first (its distance): the cards' column slides in next. */
    .g-deck, .g-map { transition: flex-basis 0.4s ease, padding 0.4s ease; }
    .guided.asking .g-deck { flex: 0 0 0 !important; padding: 0 !important; overflow: hidden; border: 0 !important; }
    .guided.asking .g-map { flex: 1 1 auto; border-right: 0; }
    .g-map { flex: 1 1 0; min-width: 260px; min-height: 0; display: flex; flex-direction: column; border-right: 1px solid var(--gf-border); background: var(--gf-surface); }
    .guided.with-panes .g-map { flex: 0 0 min(30%, 380px); }
    .g-mapbox { position: relative; flex: 1; min-height: 0; isolation: isolate; }
    .g-mapbox gf-map { position: absolute; inset: 0; display: block; }
    .g-mapbox gf-map .leaflet-container { background: #2f4a2c; }
    .g-radius { position: absolute; z-index: 500; left: 10px; right: 50px; top: 10px; display: flex; align-items: center; gap: 6px; padding: 6px 6px 6px 12px; border-radius: 14px;
      background: color-mix(in srgb, var(--gf-surface) 92%, transparent); box-shadow: var(--gf-shadow); backdrop-filter: blur(6px); }
    .g-radius label { flex: 1; min-width: 0; display: grid; grid-template-columns: auto 1fr; align-items: baseline; gap: 0 8px; }
    .g-radius .d { font-weight: 800; color: var(--gf-accent); font-variant-numeric: tabular-nums; }
    .g-radius .mood { font-size: 0.78rem; color: var(--gf-text-muted); font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .g-radius input { grid-column: 1 / -1; width: 100%; margin: 2px 0 0; accent-color: var(--gf-accent); }
    .g-legend { position: absolute; z-index: 500; left: 10px; top: 76px; max-width: calc(100% - 20px); margin: 0; padding: 4px 10px; border-radius: var(--gf-radius-pill);
      background: rgb(0 0 0 / 62%); color: #fff; font-size: 0.78rem; display: flex; align-items: center; gap: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* The first map: its panel, the way to the cards. */
    .g-launch { position: absolute; z-index: 500; right: 16px; bottom: 28px; width: min(400px, calc(100% - 32px)); box-sizing: border-box; display: grid; gap: 10px; padding: 16px 18px;
      border-radius: 18px; background: color-mix(in srgb, var(--gf-surface) 95%, transparent); box-shadow: 0 12px 36px rgb(0 0 0 / 28%); backdrop-filter: blur(8px); animation: g-up 0.35s ease-out; }
    @keyframes g-up { from { opacity: 0; transform: translateY(16px); } }
    .g-launch h2 { margin: 0; font-size: 1.15rem; display: flex; align-items: center; gap: 8px; }
    .g-launch h2 .bi { color: var(--gf-accent); }
    .g-launch .where { margin: -4px 0 0; font-size: 0.85rem; color: var(--gf-text-muted); }
    .g-launch .where .link { font-size: inherit; padding: 0; min-height: 0; }
    .g-launch .g-dist { display: grid; grid-template-columns: auto 1fr; align-items: baseline; gap: 0 10px; }
    .g-launch .d { font-size: 1.5rem; font-weight: 800; color: var(--gf-accent); font-variant-numeric: tabular-nums; }
    .g-launch .mood { justify-self: start; font-size: 0.85rem; color: var(--gf-text-muted); font-style: italic; }
    .g-launch input { grid-column: 1 / -1; width: 100%; margin: 4px 0 0; accent-color: var(--gf-accent); }
    .g-launch .g-seen { display: flex; align-items: center; gap: 10px; font-size: 0.86rem; color: var(--gf-text); min-height: 34px; }
    .g-launch .faces { display: flex; flex: none; }
    .g-launch .faces img { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; border: 2px solid var(--gf-surface); margin-left: -8px; background: var(--gf-surface-2); }
    .g-launch .faces img:first-child { margin-left: 0; }
    .g-launch .go { min-height: 54px; display: grid; justify-items: center; gap: 0; font-size: 1.08rem; padding: 8px 16px; border-radius: 16px; }
    .g-launch .go .bi { display: none; }
    .g-launch .go small { font-size: 0.75rem; font-weight: 400; opacity: 0.85; }
    @media (max-width: 899px) { .g-launch { left: 10px; right: 10px; bottom: 12px; bottom: 12px; width: auto; padding: 12px 14px; gap: 8px; } .g-launch h2 { font-size: 1.02rem; } }
    /* After a match: where else it grows. */
    .g-scope { position: absolute; z-index: 500; left: 10px; right: 10px; top: 112px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 6px 8px; border-radius: 14px;
      background: color-mix(in srgb, var(--gf-surface) 94%, transparent); box-shadow: var(--gf-shadow); backdrop-filter: blur(6px); font-size: 0.78rem; animation: g-in 0.35s ease-out; }
    .g-scope > span { display: inline-flex; align-items: center; gap: 4px; font-weight: 700; margin-right: 4px; color: var(--gf-text); }
    .g-scope button { min-height: 0; height: 26px; padding: 0 10px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-pill); background: var(--gf-surface); color: var(--gf-text);
      font: inherit; font-size: 0.78rem; cursor: pointer; white-space: nowrap; }
    .g-scope button[aria-pressed='true'] { background: #e0245e; border-color: #e0245e; color: #fff; font-weight: 600; }
    .g-legend .dot { flex: none; width: 12px; height: 12px; border-radius: 50%; background: #e0245e; box-shadow: 0 0 0 2px #ffd166; }
    .g-deck { flex: 0 0 min(400px, 42%); min-width: 0; overflow-y: auto; padding: 14px 12px 90px; }
    .guided:not(.with-panes) .g-deck { flex: 1 1 0; }
    .guided.with-panes .g-deck { flex-basis: min(360px, 32%); border-right: 1px solid var(--gf-border); }
    .g-deck .deck { max-height: calc(100dvh - 320px); min-height: 300px; }
    .g-wait { text-align: center; padding: 40px 10px; }
    .g-plant { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--gf-surface); isolation: isolate; animation: g-in 0.35s ease-out; }
    @keyframes g-in { from { opacity: 0; transform: translateX(24px); } }
    .g-plant gf-plant-detail { flex: 1; min-height: 0; }
    .g-empty { height: 100%; display: grid; place-content: center; justify-items: center; gap: 8px; padding: 24px; text-align: center; color: var(--gf-text-muted); font-size: 0.95rem; }
    .g-empty .bi { font-size: 2.4rem; opacity: 0.5; }
    .g-empty p { margin: 0; max-width: 300px; }
    /* Step 4: the plants around, under the map. */
    .g-map .around { flex: 0 0 45%; width: auto; border-right: 0; border-top: 1px solid var(--gf-border); }
    @media (max-width: 899px) {
      /* A phone: the blocks one under the other, scrolled. */
      .g-scroll { flex-direction: column; overflow-y: auto; }
      .g-map, .guided.with-panes .g-map { flex: none; min-width: 0; border-right: 0; border-bottom: 1px solid var(--gf-border); }
      .g-mapbox { flex: none; height: 26dvh; min-height: 180px; }
      .g-map .around { flex: none; max-height: 40dvh; }
      .g-deck, .guided:not(.with-panes) .g-deck, .guided.with-panes .g-deck { flex: none; border-right: 0; border-bottom: 1px solid var(--gf-border); padding: 8px 10px 12px; overflow: visible; }
      .g-deck .deck { max-height: 42dvh; min-height: 240px; aspect-ratio: 3 / 3.6; }
      .g-deck .left { display: none; }
      .g-deck .actions { gap: 14px; }
      .g-deck .round { width: 50px; height: 50px; font-size: 1.3rem; }
      .g-plant { flex: none; height: 85dvh; }
      .guided.asking .g-mapbox { flex: 1; height: auto; }
      .guided.asking .g-scroll { overflow: hidden; }
    }
    /* The plants around (step 4): their thumbnails, a touch shows one in the panes. */
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

    @media (prefers-reduced-motion: reduce) { .card, .burst, .around, .g-deck, .g-map { transition: none; animation: none; } }  `];

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
    this._obsTotal = 0;
    this._scope = 'around';
    /** @type {{ department: string | null, region: string | null, shapes: Record<string, any> } | null} */
    this._admin = null;
    /** @type {Map<number, string | null>} */
    this._ethno = new Map();
    this._burst = 0;
    /** @type {number | null} */
    this._later = null;
    this._dwell = false;
    /** @type {number | null} */
    this._focus = null;
    /** @type {string | null} */
    this._note = null;
    /** @type {{ key: string, points: { coordinates: [number, number], title: string }[] } | null} */
    this._hl = null;
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
      else if (e.key === 'ArrowUp' && !this.#guided) { e.preventDefault(); this.#openPlant(top.plant.id, this.#deck.map(c => c.plant.id)); }
      return;
    }
    const t = /** @type {HTMLElement} */ (e.composedPath()[0]);
    if (t?.closest?.('input, textarea, select, [contenteditable], gf-media-viewer')) return;
    // Bare: → keeps the plant and goes on, ← passes it — as with the cards.
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); this.#step(e.key === 'ArrowRight' ? 1 : -1); }
    else if (e.key === 'Escape') { e.preventDefault(); this.#close(); }
  };

  connectedCallback() {
    super.connectedCallback();
    discoverEvents.addEventListener('change', this.#onChange);
    discoverEvents.addEventListener('reset', this.#onReset);
    // The discovery screens: no zone alerts on their maps (gf-map).
    this.setAttribute('no-areas', '');
    addEventListener('keydown', this.#onKey);
    if (this._point && !this._cards) this.#load();
    if (this._point && !this._obs.length) this.#loadPoints();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    discoverEvents.removeEventListener('change', this.#onChange);
    discoverEvents.removeEventListener('reset', this.#onReset);
    removeEventListener('keydown', this.#onKey);
    clearTimeout(this.#dwellTimer);
    clearTimeout(this.#obsTimer);
    clearTimeout(this.#radiusTimer);
    this.#stopGeo?.();
    this.#abort?.abort();
  }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    const sc = scenarioOf(this.scenario).key;
    // Another scenario: its own view (Mosaïque: the grid), the cards filtered for it.
    if (changed.has('scenario')) {
      this._view = lastView[sc] || (sc === 'mosaic' ? 'all' : 'swipe');
      if (changed.get('scenario') !== undefined && sc !== 'trail' && this._point && !this._asking) this.#load();
    } else if (changed.has('_view')) lastView[sc] = this._view;
    if (changed.has('open') && this.open != null) plantSeen(this.open);
    // Another plant in the panes (a card decided, one chosen around): a step put off comes back; the next one
    // is offered after a while on it.
    if (changed.has('_focus') && this.#guided) this.#restartDwell();
    // The distance changed: the map's observations follow (a moment after the slider stops).
    if ((changed.has('_radius') || changed.has('_asking') || changed.has('_point')) && this._point) {
      clearTimeout(this.#obsTimer);
      this.#obsTimer = setTimeout(() => this.#loadPoints(), 400);
    }
    this.toggleAttribute('opened', this.open != null);
  }
  updated() {
    this.#hintSwipe();
    // Discovering: the plant in view lit on the map (where it was seen in the circle).
    const id = this.#guided ? this.#focusId : null;
    if (id != null) this.#findAdmin();
    const scope = this.#scopeNow;
    const key = id == null || !this._point ? '' : `${id}:${this._radius}:${this._point}:${scope}`;
    if (key === this.#hlFor) return;
    this.#hlFor = key;
    // Another plant: its leaves come (the old ones go); another scope of the same plant: the map stays until its
    // observations are in (no empty map in between).
    if (!this._hl || !key || !this._hl.key.startsWith(id + ':')) this._hl = null;
    const card = key ? (this._cards || []).find(c => c.plant.id === id) : null;
    if (!card?.taxonId) { this._hl = null; return; }
    this.#loadHighlight(key, card, scope);
  }
  #hlFor = '';

  /** The cards just there: the one on top leans a little right, then left — they can be swiped (once). */
  #hintSwipe() {
    if (hinted || this._view !== 'swipe' || this.open != null || this._match) return;
    const el = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.swipe-card.top'));
    if (!el) return;
    hinted = true;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setTimeout(() => {
      if (!el.isConnected || el.classList.contains('dragging')) return;
      el.classList.add('hint');
      el.addEventListener('animationend', () => el.classList.remove('hint'), { once: true });
    }, 700);
  }

  /** @type {any} */ #dwellTimer = 0;
  /** @type {any} */ #obsTimer = 0;
  #restartDwell() {
    this._later = null;
    this._dwell = false;
    clearTimeout(this.#dwellTimer);
    this.#dwellTimer = setTimeout(() => { this._dwell = true; }, 6000);
  }
  /** Plants stepped through while discovering (each step after the second waits for two of them). */
  #navs = 0;
  /** The number of plants stepped through when the current step began. */
  #navsAtStep = 0;

  /** The observations in the circle, for the map behind the distance. */
  async #loadPoints() {
    const point = this._point, radius = this._radius;
    if (!point) return;
    const found = await observationPointsAround(point, radius).catch(() => ({ points: [], total: 0 }));
    if (this._point === point && this._radius === radius) { this._obs = found.points; this._obsTotal = found.total; }
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
    // The start page (#/) shows Découvrir only until Flore comes: the discovery gets its own address, so a tab
    // arriving midway does not take the screen away.
    if (parse(location.hash).name !== 'discover') { replaceHash(href.discover(null, this.scenario)); dispatchEvent(new HashChangeEvent('hashchange')); }
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
    this.#loadedFor = this._radius + ':' + point;
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
        const card = { plant, taxonId: s.taxonId, count: s.count, photo: s.photo ? s.photo.replace(/\/square\./, '/medium.') : plant.thumbnail?.url || null,
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
    // Parcours botanique: its own little app (the place, the search, the plants added, their map).
    if (scenarioOf(this.scenario).key === 'trail') return html`<gf-trail></gf-trail>`;
    const guided = this.#guided;
    return html`${!this._point ? this.#welcome() : guided ? this.#guidedView() : this._asking || (!this._cards && !this._loading && !this._error) ? this.#distance() : this.#list()}
      ${this._match ? this.#matchView(this._match) : nothing}
      ${this.open != null && !guided ? this.#plantSheet() : nothing}`;
  }

  #welcome() {
    const sc = scenarioOf(this.scenario).key;
    // Each scenario its picture and its words (Rencontres: the cards; Cueillette: the basket; Mosaïque: the photos).
    const [title, words] = sc === 'harvest'
      ? ['Cueillette prudente', 'Ce qui se cueille autour de vous… et ses sosies dangereux, les mortels d’abord. Ne cueillez jamais sans être sûr de vous.']
      : sc === 'mosaic'
        ? ['La mosaïque du coin', 'Toutes les photos des plantes observées près d’ici, en grand. Une image touchée : toutes celles de la plante.']
        : ['Découvrez les plantes autour de vous !', 'Orties farceuses, pissenlits voyageurs, chênes centenaires : tout un petit monde vert pousse près d’ici. Un coup de cœur à droite, au suivant à gauche.'];
    return html`<section class="welcome">
      ${scene(sc)}
      <h1>${title}</h1>
      <p>${words} Votre position ne sert qu’à cette recherche.</p>
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
      <gf-map no-search no-create no-locate .area=${this.#area}></gf-map>
      <section class="welcome distance">
      <div class="leaf" aria-hidden="true">${icon('geo-alt-fill')}</div>
      <h1>Jusqu’où part l’expédition ?</h1>
      <p>Autour ${this._place ? 'de ' + this._place : 'de vous'}. Plus le cercle est grand, plus la récolte de rencontres est riche — et plus il faudra marcher pour aller les saluer.</p>
      <div class="dist">
        <output>${distLabel(this._radius)}</output>
        <span class="mood">${distMood(this._radius)}</span>
        <input type="range" min="0" max=${DISTANCES.length - 1} step="1" .value=${String(at)} aria-label="Distance de la recherche"
          aria-valuetext=${distLabel(this._radius)} @input=${(/** @type {any} */ e) => { this._radius = DISTANCES[Number(e.target.value)]; }} />
        <div class="ticks" aria-hidden="true"><span>200 m</span><span>50 km</span></div>
        <span class="obs" aria-live="polite">${this.#obsLine()}</span>
      </div>
      <button class="primary go" type="button" @click=${() => { setDiscoverRadius(this._radius); this._asking = false; this._view = 'swipe'; this.#load(); }}>${icon('binoculars')} Qui pousse par ici ?</button>
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
        <p class="muted">${this.#matchCards.length ? `${this.#matchCards.length} match${this.#matchCards.length > 1 ? 's' : ''} dans votre herbier — à retrouver dans « Matchs ».` : 'Aucun coup de cœur ? Le prochain se cache peut-être un peu plus loin, derrière la haie.'}</p>
        <div class="row">${next ? html`<button class="primary" type="button" @click=${() => { this._radius = next; setDiscoverRadius(next); this.#load(); }}>Chercher jusqu’à ${distLabel(next)}</button>` : nothing}
          ${discoverState().passed.length ? html`<button class="secondary" type="button" @click=${() => resetPassed()}>Revoir les plantes passées</button>` : nothing}</div>
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
        ${this.#guided ? nothing : html`<button class="round info" type="button" aria-label="Voir sa fiche" title="Sa fiche (↑)" @click=${() => this.#openPlant(top.plant.id, this.#deck.map(c => c.plant.id))}>${icon('three-dots')}</button>`}
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
    if (c.blooming) out.push('🌼 En fleur en ce moment : c’est le jour de la photo.');
    else if (months.size) out.push(`🗓️ Je fleuris de ${MONTH[[...months][0]]} à ${MONTH[[...months][months.size - 1]]}. Repassez me voir.`);
    if (a?.safety?.tone === 'danger') out.push('☠️ ' + (a.safety.text.find(t => /toxi|mortel|ANSM/i.test(t)) || a.safety.text[0]) + '. On regarde, on ne goûte pas.');
    else if (a?.safety?.text.some(t => /Protégée/.test(t))) out.push('🛡️ Espèce protégée : on m’admire, on ne me cueille pas.');
    if (a?.edible) out.push(`🍽️ Comestible, mais j’ai des sosies dangereux (${a.edible.text.length}). Lisez ma fiche avant de passer à table.`);
    out.push(c.count >= 50 ? `📸 Très populaire ici : ${c.count} observations.` : c.count <= 3 ? `🤫 Rare par ici : ${c.count} observation${c.count > 1 ? 's' : ''}.` : `👀 ${c.count} observations dans le coin.`);
    if (p.family) out.push(`👪 De la famille des ${p.family}.`);
    return out.slice(0, 4);
  }

  /** @type {{ id: number, x: number, y: number, dx: number, dy: number, el: HTMLElement, t: number, vx: number, lx: number, lt: number } | null} */ #drag = null;

  #dragStart = (/** @type {PointerEvent} */ e) => {
    const el = /** @type {HTMLElement} */ (e.currentTarget);
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    this.#drag = { id: Number(el.dataset.id), x: e.clientX, y: e.clientY, dx: 0, dy: 0, el, t: performance.now(), vx: 0, lx: e.clientX, lt: performance.now() };
    el.classList.remove('hint');
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
      // Discovering: a match is shown in the panes (its photos — the plant just loved, not the next card); a card
      // passed: the panes go on with the one now on top.
      if (this.#guided) { this._focus = liked ? card.plant.id : null; this.#navs++; this.#restartDwell(); }
      if (liked) {
        if (fav) toggleFavorite(card.plant).catch(() => {});
        if (matchMedia('(pointer: coarse)').matches) navigator.vibrate?.(30);
        // The first match (while discovering): its screen, once — Rencontres: a heart, and its photos offered (the
        // panes show it until the next card). The next ones: a heart.
        const first = discovering() && !discoverState().firstMatch;
        // Rencontres: the first match brings its photos at once (the third block, zoomed), of the plant matched.
        if (first && this.#guided) { firstMatchShown(); this.#restartDwell(); if (discoverState().step === 0) this.#accept(1); }
        if (first && !this.#guided) this._match = card;
        else { this._burst++; const n = this._burst; setTimeout(() => { if (this._burst === n) this._burst = 0; }, 900); }
      }
    };
    node?.classList.remove('hint');
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
      <p id="match-text">Coup de cœur pour <b>${name}</b> ! Direction votre herbier (♥ favoris) — et ce n’est que le début de l’exploration.</p>
      <div class="row">
        <button class="primary" type="button" autofocus @click=${() => { firstMatchShown(); this._match = null; this._focus = c.plant.id; this.#restartDwell(); }}>Découvrir cette plante</button>
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

  // ── Discovering: the cards, and beside them the panes the steps add to the layout ──

  /** Discovering (Rencontres, after the first match): the guided view — the cards stay, panes come beside them. */
  get #guided() { return discovering() && scenarioOf(this.scenario).key === 'meet' && Boolean(this._point) && (this._asking || Boolean(this._cards || this._loading)); }

  /** The mode whose layout the steps build (the one the plant sheet shows in Flore). */
  get #view() { return plantViewOf(this.#store.state); }

  /** The plant shown in the panes. */
  get #focusId() { return this._focus ?? this.#deck[0]?.plant.id ?? null; }

  /** A plant of the list around, shown in the panes. @param {number} id */
  #aroundGo(id) {
    if (id === this.#focusId) return;
    this._focus = id;
    this.#navs++;
  }

  /**
   * A block into the layout (once): a new pane beside another block's pane (or, if that one is in no pane,
   * on the right of the sheet; `root`: across the whole plant pane).
   * @param {string} key @param {string | null} near @param {'left' | 'right' | 'top' | 'bottom'} side @param {boolean} [root]
   */
  #dockAt(key, near, side, root = false) {
    const v = this.#view;
    if (paneOf(v, key)) return;
    const p = near ? paneOf(v, near) : null;
    dockBlock(v, key, root ? 'root' : p ? p.id : 'sheet', root || p ? side : 'right');
  }

  /** Several blocks as the tabs of one new pane (the first one shown). @param {string[]} keys @param {'left' | 'right' | 'top' | 'bottom'} side */
  #dockTabs(keys, side) {
    const v = this.#view;
    this.#dockAt(keys[0], null, side, true);
    const pane = paneOf(v, keys[0]);
    if (!pane) return;
    for (const k of keys.slice(1)) if (!paneOf(v, k)) dockBlock(v, k, pane.id, 'center');
    const after = paneOf(v, keys[0]);
    if (after) setStackState(v, after.id, { active: keys[0] });
  }

  /** The fork: picking or science; its dashboard joins the plant. @param {'harvest' | 'science'} branch */
  #fork(branch) {
    this.#navsAtStep = this.#navs;
    this.#dockTabs(FORK_BLOCKS[branch], 'right');
    chooseBranch(branch);
    this.requestUpdate();
    this.#showNewBlock();
  }

  /** A step accepted: its pane joins the layout; the last one leaves for the whole app, on this plant. @param {number} step */
  #accept(step) {
    this.#navsAtStep = this.#navs;
    this._dwell = false;
    clearTimeout(this.#dwellTimer);
    this.#dwellTimer = setTimeout(() => { this._dwell = true; }, 6000);
    const id = this.#focusId;
    // Each step adds its pane to the layout of the mode (Flore will show the same): the photos beside the sheet,
    // the encyclopedia under them.
    if (step === 1) this.#dockAt('media', null, 'right');
    if (step === 2) this.#dockAt('wikipedia', 'media', 'bottom');
    // The whole app, the way chosen at the fork.
    if (step >= LAST_STEP) { if (discoverState().branch === 'science') setMode('scientific'); else if (discoverState().branch === 'harvest') setHarvestMode(true); }
    setStep(step);
    if (step >= LAST_STEP && id != null) location.hash = href.plant(id);
    this.requestUpdate();
    this.#showNewBlock();
  }

  /** A phone: the blocks one under the other — the new one scrolled into view. */
  async #showNewBlock() {
    if (!matchMedia('(max-width: 899px)').matches) return;
    await this.updateComplete;
    requestAnimationFrame(() => this.renderRoot.querySelector('.g-plant')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
  }

  /** The plants around (step 3): their thumbnail, name and « en fleur »; a touch opens one bare. @param {Card[]} cards */
  #aroundList(cards) {
    return html`<aside class="around" aria-label="Les plantes autour">
      <h2>Les voisines <small class="muted">${cards.length}</small></h2>
      <ul>${repeat(cards, c => c.plant.id, c => html`<li><button type="button" aria-current=${String(c.plant.id === this.#focusId)} @click=${() => this.#aroundGo(c.plant.id)}>
        <span class="th">${c.photo ? html`<img src=${c.photo.replace('/medium.', '/square.')} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error=${hideImg} @load=${showImg} />` : nothing}</span>
        <span class="t"><b>${c.plant.vernacularNames?.[0] || c.plant.scientificName}</b><small>${c.blooming ? 'En fleur · ' : ''}${c.count} obs.${discoverState().matches.includes(c.plant.id) ? ' · ♥' : ''}</small></span>
      </button></li>`)}</ul>
    </aside>`;
  }

  /** The scope shown for the plant in view: chosen after a match (its scope bar), else the circle. */
  get #scopeNow() {
    const id = this.#focusId;
    // From the first match on: the scope chosen, for the card in view.
    return id != null && discoverState().firstMatch ? this._scope : 'around';
  }

  /** The département and région of the place chosen (from its IGN address), once. */
  async #findAdmin() {
    const point = this._point;
    if (!point || this.#adminFor === point.join()) return;
    this.#adminFor = point.join();
    const a = await addressAt(point).catch(() => null);
    const parts = String(a?.context || '').split(',').map(x => x.trim()).filter(Boolean);
    if (this._point !== point) return;
    this._admin = { department: parts.length >= 3 ? parts[1] : null, region: regionOf(a?.context || '')?.name || null, shapes: {} };
  }
  #adminFor = '';

  /** The outline of the département or région (IGN), kept once asked. @param {'department' | 'region'} scope */
  async #adminOutline(scope) {
    const admin = this._admin;
    const name = admin?.[scope];
    if (!admin || !name) return null;
    if (!(scope in admin.shapes)) admin.shapes[scope] = await adminShape(scope === 'department' ? 'departement' : 'region', name).catch(() => null);
    return admin.shapes[scope];
  }

  /** The box of a scope [west, south, east, north]. @param {string} scope */
  async #scopeBox(scope) {
    if (scope === 'country') return /** @type {[number, number, number, number]} */ ([FRANCE_BOUNDS.getWest(), FRANCE_BOUNDS.getSouth(), FRANCE_BOUNDS.getEast(), FRANCE_BOUNDS.getNorth()]);
    if (scope === 'world') return /** @type {[number, number, number, number]} */ ([WORLD_BOUNDS.getWest(), WORLD_BOUNDS.getSouth(), WORLD_BOUNDS.getEast(), WORLD_BOUNDS.getNorth()]);
    const shape = await this.#adminOutline(/** @type {any} */ (scope));
    if (shape) { const pts = shape.geometry.coordinates.flat(shape.geometry.type === 'MultiPolygon' ? 2 : 1); const lons = pts.map((/** @type {number[]} */ p) => p[0]), lats = pts.map((/** @type {number[]} */ p) => p[1]); return /** @type {[number, number, number, number]} */ ([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)]); }
    // No outline (IGN unreachable): the région's box, if known.
    return scope === 'region' && this._admin?.region ? REGION_BOUNDS[this._admin.region] || null : null;
  }

  /** Where the plant in view was seen, in its scope: the circle (leaves), or a département, a région, France, the world. */
  async #loadHighlight(key, card, scope) {
    const title = card.plant.vernacularNames?.[0] || card.plant.scientificName;
    if (scope === 'around') {
      const pts = await observationsAround(card.taxonId, /** @type {[number, number]} */ (this._point), this._radius).catch(() => null);
      if (pts && this.#hlFor === key) this._hl = { key, scope, points: pts.map(p => ({ coordinates: p.coordinates, title, url: p.url })), total: pts.length };
      return;
    }
    const box = await this.#scopeBox(scope);
    if (!box || this.#hlFor !== key) { if (this.#hlFor === key) this._hl = { key, scope, points: [], total: 0 }; return; }
    const found = await observationsInBox(card.taxonId, box).catch(() => null);
    if (found && this.#hlFor === key) this._hl = { key, scope, box, points: found.points.map(p => ({ coordinates: p.coordinates, title, url: p.url })), total: found.total };
  }

  /** The plant's observations in a wider scope, many: grouped (pink and gold). */
  get #guidedCluster() {
    const hl = this._hl;
    const many = hl && hl.points.length > MANY ? hl : null;
    if (!many) return null;
    const key = many.key;
    if (this.#gcMemo?.key === key) return this.#gcMemo.value;
    const value = { key, points: many.points.map((/** @type {any} */ p) => ({ ...p, kind: 'hl' })) };
    this.#gcMemo = { key, value };
    return value;
  }
  /** @type {any} */ #gcMemo = null;

  /** The map framed on the scope chosen (eased), once its box is known; back to the circle after. */
  get #scopeFrame() {
    const hl = this._hl, scope = this.#scopeNow;
    if (scope === 'around') {
      if (!this.#leftAround || !this._point) return null;
      const [lon, lat] = this._point, r = this._radius / 111320, dLon = r / Math.cos(lat * Math.PI / 180);
      return this.#frameMemo('around:' + this._point + ':' + this._radius, [[lon - dLon, lat - r], [lon + dLon, lat + r]]);
    }
    if (!hl?.box || hl.scope !== scope) return this.#lastFrame;
    this.#leftAround = true;
    const [w, s, e, n] = hl.box;
    return this.#frameMemo('scope:' + scope + ':' + hl.box.join(), [[w, s], [e, n]]);
  }
  #leftAround = false;
  /** @type {any} */ #lastFrame = null;
  /** @param {string} key @param {[number, number][]} points */
  #frameMemo(key, points) {
    if (this.#lastFrame?.key !== key) this.#lastFrame = { key, points, ease: true };
    return this.#lastFrame;
  }

  /** The outline of the département or région shown. */
  get #scopeZone() {
    const scope = this.#scopeNow;
    const shape = (scope === 'department' || scope === 'region') ? this._admin?.shapes?.[scope] : null;
    return shape ? (this.#zoneMemo?.feature === shape ? this.#zoneMemo : (this.#zoneMemo = { key: scope + ':' + this._admin?.[scope], feature: shape })) : null;
  }
  /** @type {any} */ #zoneMemo = null;

  /** « 23 observations ici », « 1 204 en Nouvelle-Aquitaine »… */
  #hlLine() {
    const hl = this._hl;
    if (!hl) return '…';
    const where = { around: 'ici', department: 'en ' + (this._admin?.department || 'ce département'), region: 'en ' + (this._admin?.region || 'cette région'), country: 'en France', world: 'dans le monde' }[/** @type {string} */ (hl.scope)] || 'ici';
    const n = hl.total ?? hl.points.length;
    return `${n.toLocaleString('fr-FR')} observation${n > 1 ? 's' : ''} ${where}${n > hl.points.length ? ` (${hl.points.length.toLocaleString('fr-FR')} sur la carte)` : ''}`;
  }

  /**
   * After a match: where else it grows — its département, its région, France, the world — each a touch away; the
   * map eases there, its observations grouped, the outline drawn.
   * @param {Card | undefined} card
   */
  #scopeBar(card) {
    if (!card || !discoverState().firstMatch) return nothing;
    const scope = this._scope;
    const a = this._admin;
    /** @type {[string, unknown][]} */
    const chips = [['around', `Autour · ${distLabel(this._radius)}`], ...(a?.department ? [['department', a.department]] : []), ...(a?.region ? [['region', a.region]] : []), ['country', 'France'], ['world', 'Monde']];
    return html`<div class="g-scope" role="group" aria-label="Où pousse-t-elle encore ?">
      <span>${icon('globe-europe-africa')} Où pousse-t-elle encore ?</span>
      ${chips.map(([k, label]) => html`<button type="button" data-scope=${k} aria-pressed=${String(scope === k)} @click=${() => { this._scope = k; }}>${label}</button>`)}
    </div>`;
  }

  /** The circle and its observations, the same object while they do not change (the map does not redraw them). */
  get #area() {
    const point = /** @type {[number, number]} */ (this._point), radius = this._radius, obs = this._obs, asking = this._asking;
    const a = this.#areaMemo;
    if (a && a.center === point && a.radius === radius && a.obs === obs && a.asking === asking) return a;
    // The first map's panel (#launch) is over it: the circle framed beside it (above it on a phone).
    const inset = !asking ? undefined : matchMedia('(max-width: 899px)').matches ? { bottom: 250 } : { right: 430 };
    // The 100 latest, each its plant's photo popping in (a small card of the plant on hover).
    return (this.#areaMemo = { center: point, radius, fit: true, leaves: true, points: obs, obs, asking, inset });
  }

  /** How many observations: all of them, and how many are on the map. */
  #obsLine() {
    const n = this._obs.length, total = Math.max(this._obsTotal || 0, n);
    if (!n) return '';
    const fr = (/** @type {number} */ x) => x.toLocaleString('fr-FR');
    return `${fr(total)} observation${total > 1 ? 's' : ''} de plantes${total > n ? ` — les ${fr(n)} plus récentes sur la carte` : ' sur la carte'}`;
  }
  /** @type {any} */ #areaMemo = null;
  /** @type {any} */ #radiusTimer = 0;

  /** The distance, on the map: the circle follows the slider; the cards come again once it rests. @param {number} m */
  #setRadius(m) {
    this._radius = m;
    clearTimeout(this.#radiusTimer);
    this.#radiusTimer = setTimeout(() => { setDiscoverRadius(m); this.#load(); }, 700);
  }

  /** Over the map: how far (the slider), and where. */
  #radiusBar() {
    const at = Math.max(0, DISTANCES.indexOf(this._radius));
    return html`<div class="g-radius">
      <label><span class="d">${distLabel(this._radius)}</span><span class="mood">${distMood(this._radius)}</span>
        <input type="range" min="0" max=${DISTANCES.length - 1} step="1" .value=${String(at)} aria-label="Distance de la recherche"
          aria-valuetext=${distLabel(this._radius)} @input=${(/** @type {any} */ e) => this.#setRadius(DISTANCES[Number(e.target.value)])} /></label>
      <button class="icon-btn" type="button" title="Changer de lieu" aria-label="Changer de lieu" @click=${() => { this._point = null; this._cards = null; }}>${icon('geo-alt')}</button>
    </div>`;
  }

  /**
   * The first map's panel: how far, what was seen around (its count, a few faces), and the way on — « Qui pousse
   * par ici ? » brings the cards next to the map.
   */
  #launch() {
    const at = Math.max(0, DISTANCES.indexOf(this._radius));
    const species = new Map();
    for (const o of this._obs) if (o.sci && !species.has(o.sci)) species.set(o.sci, o);
    const faces = [...species.values()].filter(o => o.photo).slice(0, 6);
    const fr = (/** @type {number} */ x) => x.toLocaleString('fr-FR');
    const total = Math.max(this._obsTotal || 0, this._obs.length);
    return html`<section class="g-launch" aria-label="Lancer la découverte">
      <h2>${icon('binoculars')} Jusqu’où part l’expédition ?</h2>
      <p class="where">Autour ${this._place ? 'de ' + this._place : 'de vous'} · <button class="link" type="button" @click=${() => { this._point = null; this._cards = null; }}>changer de lieu</button></p>
      <label class="g-dist"><span class="d">${distLabel(this._radius)}</span><span class="mood">${distMood(this._radius)}</span>
        <input type="range" min="0" max=${DISTANCES.length - 1} step="1" .value=${String(at)} aria-label="Distance de la recherche"
          aria-valuetext=${distLabel(this._radius)} @input=${(/** @type {any} */ e) => { this._radius = DISTANCES[Number(e.target.value)]; }} /></label>
      <div class="g-seen" aria-live="polite">
        ${faces.length ? html`<span class="faces" aria-hidden="true">${faces.map(o => html`<img src=${o.photo} alt="" loading="lazy" referrerpolicy="no-referrer" @error=${(/** @type {any} */ e) => e.target.remove()} />`)}</span>` : nothing}
        <span>${this._obs.length ? html`<b>${fr(total)}</b> observation${total > 1 ? 's' : ''} de plantes, <b>${fr(species.size)}</b> espèce${species.size > 1 ? 's' : ''} différente${species.size > 1 ? 's' : ''}${total > this._obs.length ? ` — les ${fr(this._obs.length)} plus récentes sur la carte` : ' sur la carte'}` : 'Les observations arrivent…'}</span>
      </div>
      <button class="primary go" type="button" @click=${() => this.#toCards()}>${icon('heart-fill')} Qui pousse par ici ? <small>Les rencontres arrivent à côté de la carte</small></button>
    </section>`;
  }

  /** The blocks the steps reached have added to the panes (only those are shown while discovering). */
  get #paneKeys() {
    const { step, branch } = discoverState();
    return [...(step >= 1 ? ['media'] : []), ...(step >= 2 ? ['wikipedia'] : []), ...(step >= 3 && branch ? FORK_BLOCKS[branch] : [])];
  }

  /** Where the discovery is: 0 the map, 1 the cards, 2 the photos, 3 the encyclopedia, 4 the fork, 5 the plants around. */
  get #stage() { return this._asking ? 0 : Math.min(discoverState().step + 1, STAGES.length - 1); }

  /** « Précédent »: one step back (the cards: back to the map and its distance). */
  #prev() {
    const stage = this.#stage;
    if (stage === 0) return;
    if (stage === 1) { this._asking = true; return; }
    stepBack(stage - 2);
    this.requestUpdate();
  }

  /** « Qui pousse par ici ? »: from the map to the map and the cards. */
  #toCards() { setDiscoverRadius(this._radius); this._asking = false; this._view = 'swipe'; if (!this._cards || this.#loadedFor !== this._radius + ':' + this._point) this.#load(); }

  /**
   * The steps, always in sight above the blocks (never over them): each one done, the one shown, those to come;
   * « Précédent » and the next one — what it adds said on its button (at the fork, the two ways).
   */
  #steps() {
    const stage = this.#stage;
    const { branch } = discoverState();
    const focus = this.#focusId != null;
    /** @type {[string, unknown, () => void, boolean?][]} */
    const next = stage === 0 ? [['go', html`${icon('binoculars')} Qui pousse par ici ?`, () => this.#toCards()]]
      : stage === 1 ? [['photos', html`Ses photos ${icon('chevron-right')}`, () => this.#accept(1), !focus]]
      : stage === 2 ? [['wiki', html`L’encyclopédie ${icon('chevron-right')}`, () => this.#accept(2)]]
      : stage === 3 ? [['harvest', html`${icon('basket')} La cueillette`, () => this.#fork('harvest')], ['science', html`${icon('diagram-3')} La science`, () => this.#fork('science')]]
      : stage === 4 ? [['around', html`Les voisines ${icon('chevron-right')}`, () => this.#accept(4)]]
      : [['flore', html`La flore complète ${icon('chevron-right')}`, () => this.#accept(LAST_STEP)]];
    const hint = ['Choisissez jusqu’où chercher, sur la carte.', 'Glissez les cartes : à droite un coup de cœur — ses photos arrivent.',
      'Ses photos, zoomables. Ensuite : ce qu’en dit l’encyclopédie.', 'Et vous, qu’aimeriez-vous savoir des plantes ?',
      branch === 'science' ? 'Cartes et données de la science. Ensuite : les plantes autour.' : 'Ce qui se cueille, et ce qu’il ne faut pas confondre. Ensuite : les plantes autour.',
      'Les voisines, sous la carte. Ensuite : toute la flore.'][stage];
    return html`<nav class="g-steps" aria-label="Étapes de la découverte">
      <button type="button" class="prev" data-step="prev" ?disabled=${stage === 0} @click=${() => this.#prev()} aria-label="Étape précédente">${icon('chevron-left')}<span>Précédent</span></button>
      <div class="mid">
        <ol>${STAGES.map((label, i) => {
          const can = this.#canGo(i, stage, next);
          return html`<li class=${i < stage ? 'done' : i === stage ? 'on' : ''} aria-current=${i === stage ? 'step' : 'false'}>
            <button type="button" data-stage=${i} ?disabled=${!can} title=${STAGE_ABOUT[i]} @click=${() => this.#goStage(i, stage, next)}>
              <span class="n">${i < stage ? icon('check-lg') : i + 1}</span><span class="l">${i === 4 && branch ? (branch === 'science' ? 'Science' : 'Cueillette') : label}</span></button></li>`;
        })}</ol>
        <p class="hint">${hint}</p>
      </div>
      <div class="next">${next.map(([k, label, act, off]) => html`<button type="button" class="primary" data-step=${k} ?disabled=${Boolean(off)} @click=${act}>${label}</button>`)}</div>
    </nav>`;
  }
  #loadedFor = '';

  /**
   * A step of the bar touched: one reached goes back (or forth) to it — the layout of that step; the next one is the
   * « Suivant » (one way only: the fork asks its button); further ones wait.
   * @param {number} i @param {number} stage @param {any[]} next
   */
  #canGo(i, stage, next) {
    if (i === stage) return false;
    if (i <= this.#reached) return i === 0 || Boolean(this._cards || this._loading);
    return i === stage + 1 && next.length === 1 && !next[0][3];
  }

  /** @param {number} i @param {number} stage @param {any[]} next */
  #goStage(i, stage, next) {
    if (!this.#canGo(i, stage, next)) return;
    if (i === 0) { this._asking = true; return; }
    if (i <= this.#reached) {
      if (this._asking) this.#toCards();
      if (i - 1 < discoverState().step) stepBack(i - 1);
      this.requestUpdate();
      return;
    }
    next[0][2]();
  }

  /** The furthest step reached (in the bar's numbering: 0 the map, 1 the cards…). */
  get #reached() { return Math.min(discoverState().step + 1, STAGES.length - 1); }

  /**
   * A point of the map touched (the cards shown): its plant comes on top of the deck — the cards, the media and the
   * map follow it. One already loved: shown in the panes; one passed: back in the deck, on top.
   * @param {CustomEvent} e
   */
  #pick(e) {
    const p = e.detail.point;
    const cards = this._cards || [];
    const card = cards.find(c => (p.taxonId != null && c.taxonId === p.taxonId) || c.plant.scientificName === p.sci);
    if (!card) { this.#note(`${p.common || p.sci || 'Cette plante'} n’est pas parmi les rencontres d’ici.`); return; }
    const id = card.plant.id;
    if (discoverState().matches.includes(id)) { this.#aroundGo(id); return; }
    if (discoverState().passed.includes(id)) unswipe(id);
    this._cards = [card, ...cards.filter(c => c !== card)];
    this._focus = null;
    this.#navs++;
    this.#restartDwell();
  }

  /** A word on the map for a moment. @param {string} text */
  #note(text) {
    this._note = text;
    clearTimeout(this.#noteTimer);
    this.#noteTimer = setTimeout(() => { this._note = null; }, 3500);
  }
  /** @type {any} */ #noteTimer = 0;

  /**
   * Discovering (Rencontres): from simple to complex, one layout transformed at each step. The map alone (its
   * distance); the map and the cards (the plant on top lit on it); on a match, its photos beside them (zoomed);
   * then each step adds its pane — only those reached are shown —; at step 4 the plants around, under the map.
   * The steps: a bar above, always in sight.
   */
  #guidedView() {
    const step = discoverState().step;
    const asking = this._asking;
    const cards = this._cards || [];
    const id = this.#focusId;
    const card = asking ? undefined : cards.find(c => c.plant.id === id);
    const panes = !asking && step >= 1;
    return html`<section class="guided ${asking ? 'asking' : ''} ${panes ? 'with-panes' : ''} ${step >= 4 && !asking ? 'listed' : ''}" aria-label="Découverte">
      ${this.#steps()}
      <div class="g-scroll">
        <div class="g-map">
          <div class="g-mapbox"><gf-map no-search no-create no-locate point-click=${asking ? 'none' : 'pick'} @point-pick=${(/** @type {CustomEvent} */ e) => this.#pick(e)} .area=${this.#area} .highlight=${!asking && this._hl && this._hl.points.length <= MANY ? this._hl : null}
              .cluster=${asking ? null : this.#guidedCluster} .frame=${asking ? null : this.#scopeFrame} .zone=${asking ? null : this.#scopeZone}></gf-map>${asking ? this.#launch() : this.#radiusBar()}
            ${asking ? nothing
              : this._note ? html`<p class="g-legend" role="status">${this._note}</p>`
              : card ? html`<p class="g-legend" aria-live="polite"><span class="dot"></span>${card.plant.vernacularNames?.[0] || card.plant.scientificName} · ${this.#hlLine()}</p>` : nothing}
            ${asking ? nothing : this.#scopeBar(card)}</div>
          ${step >= 4 && !asking ? this.#aroundList(cards) : nothing}
        </div>
        <div class="g-deck">${asking ? nothing : this._cards ? this.#deckView() : html`<p class="muted g-wait">Recherche des plantes observées autour…</p>`}</div>
        ${panes ? html`<div class="g-plant" aria-label=${card ? 'Volets : ' + (card.plant.vernacularNames?.[0] || card.plant.scientificName) : 'Volets'}>
          ${id != null ? html`<gf-plant-detail embedded panes-only plant-id=${id} view=${this.#view} .paneKeys=${this.#paneKeys}>
            <div class="g-empty">${icon('binoculars')}<p>Ses photos, son histoire, ses secrets viendront s’installer ici.</p></div>
          </gf-plant-detail>` : nothing}
        </div>` : nothing}
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
        ${this._rail && this._rail.plantId === this.open && this._rail.items.length ? html`<span class="visually-hidden">${name}</span><gf-sheet-rail .items=${this._rail.items} .active=${this._rail.active} .at=${this._rail.at} .entity=${this._rail.entity} orientation="row"
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
