// @ts-check
// « Écran sur mesure » (#/layout/<layout>?<state>[&edit=1]): a screen made of the app's pieces, as its address says — the
// layout written in it (grammar.js: columns, a column split into rows, a row into columns…; registry.js: what each cell
// is), the live state beside it (state.js: the current plant, the scope, the search). Every cell is wired to the one
// state, never to another cell: a search or a filter changes the results, which the map's points follow; a result, a
// point or a card touched is the current plant, which every plant cell shows; the scope changed on the map or in a
// place cell keeps the search to its plants. A link reproduces the screen, Back and Forward walk it (state.js says
// which change is a new entry), a reload finds it again.
//  - Sizes: between two parts a grip (core/split-grip.js: drag, ← → / ↑ ↓, Début / Fin, Entrée or a double click: equal
//    shares); the shares given are written in the address (`@n`, so a link has them) and kept on this device for the
//    layout's shape (sizes.js: opened again without them, it has them).
//  - Narrow (a phone, or less room than the columns need): the columns become tabs, their rows one under the other —
//    the tabs a menu of icons on top, each column its cells' icons (registry.js: a block of the sheet its own; one alike
//    once, three at most, then « +n »; a presentation chosen, plant(epure), its mark: É), its whole name read and shown
//    on hover — on screen too, beside them, where each has the room (a window, a tablet: not a phone's); as wide as one
//    another while they fit, else the menu scrolls sideways, the tab shown kept in sight. A plant chosen in one tab
//    brings the tab of a plant cell (its icon lit a moment); a finger swiped sideways on a panel, where nothing moves
//    sideways itself, its neighbour.
//  - In use or being modified (edit=1, the bar's « Modifier ⇄ Terminé »): the same element, the same cells (never
//    rebuilt: maps stay loaded). Modified, each cell has its tools — its content (✎: the block picker,
//    gf-block-picker.js, docked on the right; a bottom sheet on a phone), its cross (builder-grid.js: cut in two towards
//    a side — a new « Emplacement », `slot` —, moved before or after, taken out — its room to its neighbour; 12 cells at
//    most, the grammar's depth) —, every head shown (tete=non too), no cell hidden; under the bar, the title, the preview
//    (computer / phone, 390 px: the layout's own tabs — never a scaled drawing, live maps break under transforms), what
//    is wrong; in ⋯, « Changer de modèle », « Tailles par défaut », « Avancé : texte ». Entering is one entry
//    (`gfEditFrom`: the depth it was entered from); every change then replaces the address and is given to that entry
//    (history.js#renewBehind: Back keeps the changes); « Terminé » goes back there (history.js#closeTo), or, opened being
//    modified, replaces this entry by the screen in use. Partager always gives the screen in use (no edit=1).
//  - The home (#/layout, no layout): « Partir d’une grille », « Ou d’un modèle » (models.js), each drawn small, each
//    opened being modified. It never touches the search (Flore's stays as it is).
//  - « Créer une app »'s old addresses (#/builder…, router.js): the screen they name (g=, else their grid), being
//    modified, in their place (the same entry; neither: the home).
//  - A title (?title=, state.js): the bar's heading (« Écran sur mesure » without one; on a phone too, cut by « … »), the
//    page's title (« <title> · GeoFlora », a plant's sheet in a cell not naming it then) and the share's. Typed in
//    « Titre » while modified: the address replaced as it is typed (no new entry).
//  - An « Emplacement » (slot), in use or modified: a place to build a component in — the block picker's first level
//    drawn in it (its tiles, then the intents of the one chosen), one tap and the place is that component.
//  - A link to a plant's sheet in a cell (a result, a look-alike in the sheet) makes it the current plant instead of
//    leaving (unless the cell says otherwise: toucher=fiche, ecrit=0, toucher=rien); a block opened from the sheet (⤢)
//    that a cell already shows: that cell, flashed.
//  - The frame every cell shares (registry.js#FRAME): its head whole, its title alone or none (tete), a title of its
//    own (titre), the actions of its head (agrandir: over the screen, Échap returns; replier: folded to its head, its
//    share to the others, never in the address; partager: a link to a layout of this cell alone, the same state), the
//    cell hidden while it has nothing to show (vide=masque: its share to the others), a plant of its own (plante=); set
//    in the block picker (« Cadre », « Liens »).

import { LitElement, html, css, nothing, repeat } from 'lit';
import { closeTo, depth, pushHash, renewBehind, replaceHash, replaceView, sheetMark } from '../core/history.js';
import { href } from '../core/router.js';
import { toHash } from '../core/query.js';
import { getPlant, nameOf } from '../core/plants.js';
import { runSearch } from '../core/search.js';
import { store, StoreController, whenReady } from '../core/store.js';
import { share } from '../core/share.js';
import { icon } from '../core/icons.js';
import { BP, MediaController } from '../core/media.js';
import { gripStyles, shareGrip } from '../core/split-grip.js';
import { ui } from '../styles/ui.js';
import { cell as makeCell, cells as cellsOf, dirAt, moveAt, nodeAt, parse, replaceAt, serialize, setShares, shapeKey, shares } from './grammar.js';
import { COMPONENTS, CURRENT, LINKS, cellIcon, cellMark, cellName, linksOf, menuLooks, resolveTree, touchOf, withParam } from './registry.js';
import { cleanText, groupPrefix, LayoutState, liveSearch, readLive, readQuery, sameLive } from './state.js';
import { APP, SearchChannel } from '../core/search-channel.js';
import { SOURCES, defaultSources } from '../core/observations.js';
import { forgetShares, savedShares, saveShares } from './sizes.js';
import { MODELS, modelSpec } from './models.js';
import { renderCell, revealFacet, scopeWords } from './cells.js';
import { cellOf, cellText } from './picker-model.js';
import { pickerBounds } from './gf-block-picker.js';
import { boxOf, canSplit, placesOf, remove as removeBox, SLOT, specOf, split } from './builder-grid.js';

/**
 * @typedef {import('./grammar.js').ListNode} ListNode
 * @typedef {import('./grammar.js').LayoutNode} LayoutNode
 * @typedef {import('./grammar.js').CellNode} CellNode
 * @typedef {import('./registry.js').Resolved} Resolved
 * @typedef {{ text: string, tree: ListNode, cells: Map<string, Resolved>, errors: { at: number, message: string }[], problems: { path: string, message: string }[], shape: string }} Shown
 */

/** Room a grip takes between two parts (px). */
const GRIP = 1;
/** Narrow, in a window or a tablet: the least room (px) left beside an item's icons for its name (a few letters, then …). */
const NAME_ROOM = 48;
/** An item of the menu of columns showing its name: its padding, and the gap between its icons and its name (px; .tabs.named .tab). */
const TAB_PAD = 22;
/** Narrow, the room (px) left beyond the tab shown when it is scrolled into sight: the menu's faded edge (.tabs[data-…]). */
const FADE = 32;
/** Components that show the current plant: the tab a plant chosen brings (narrow). */
const FOLLOWS_PLANT = new Set(['plant', 'media', 'deck']);
/** The state of a screen with nothing in its address (the home's). */
const EMPTY_LIVE = readLive('');
/** Being modified, in the address (router.js href.layout: last). */
const EDITING = /(?:^|&)edit=1(?:&|$)/;

/** A layout as text, read and resolved: what the screen shows. @param {string} text @returns {Shown} */
function show(text) {
  const parsed = parse(text);
  const res = resolveTree(parsed.tree);
  return { text: serialize(res.tree), tree: res.tree, cells: res.cells, errors: parsed.errors, problems: res.problems, shape: shapeKey(res.tree) };
}

/**
 * A layout drawn small (the home's cards): its lists as flex boxes, the direction turning at each level
 * (grammar.js#dirAt), its shares; its cells as tinted boxes. @param {LayoutNode} n @param {number} depth
 * @returns {import('lit').TemplateResult}
 */
function thumb(n, depth) {
  if (n.t === 'cell') return html`<i></i>`;
  const sh = shares(n);
  return html`<span class="g ${dirAt(depth)}">${n.kids.map((k, j) => html`<span class="g" style=${`flex: ${sh[j]} 1 0`}>${thumb(k, depth + 1)}</span>`)}</span>`;
}

/**
 * The least width (`w`) or height (`h`) a node needs, its parts side by side (`row`) or one under the other (`col`): a
 * cell its component's (registry.js `min`), a split the sum along it and the largest across it.
 * @param {LayoutNode} n @param {Map<string, Resolved>} cells @param {number[]} path @param {'row' | 'col'} dir @param {'w' | 'h'} [side] @param {boolean} [col] every split one under the other (narrow) @returns {number}
 */
function least(n, cells, path, dir, side = 'w', col = false) {
  if (n.t === 'cell') { const r = cells.get(path.join('.')); return r?.known ? r.spec.min[side] : side === 'w' ? 220 : 120; }
  const ws = n.kids.map((k, j) => least(k, cells, [...path, j], col ? 'col' : dir === 'row' ? 'col' : 'row', side, col));
  return (dir === 'row') === (side === 'w') ? ws.reduce((a, b) => a + b, 0) + GRIP * (ws.length - 1) : Math.max(...ws);
}

export class GfLayout extends LitElement {
  static properties = {
    /** { name: 'layout', spec, search } — or « Créer une app »'s old { name: 'builder', grid, spec, search } (router.js). */
    route: { attribute: false },
    _w: { state: true },
    /** The tab shown, narrow. */
    _tab: { state: true },
    /** Being modified (the route's edit=1; set by #follow, never by a host): each cell's tools, the edit strip (reflected). */
    editing: { type: Boolean, reflect: true },
    /** A cell flashed (a block opened from the sheet that it shows). */
    _flash: { state: true },
    /** Narrow: the tab brought by a plant chosen elsewhere (or a block opened), its icon lit a moment; -1: none. */
    _brought: { state: true },
    /** Narrow: the menu's items show their names beside their icons (#nameRoom). */
    _named: { state: true },
    /** The cell made large over the layout (actions=agrandir), by its path; null: none. */
    _max: { state: true },
    /** The cell whose link was just copied (actions=partager), by its path. */
    _cellCopied: { state: true },
    /** The cell whose block picker is open, by its path; null: none. */
    _pick: { state: true },
    /** The block picker open (reflected: its host leaves it its room). */
    picking: { type: Boolean, reflect: true },
    /** Being modified: the cell whose cross is open, by its path; null: none. */
    _cross: { state: true },
    /** The preview as on a phone (390 px wide), being modified. */
    _preview: { state: true },
    /** « Avancé »: the text as typed, and whether it is unfolded; « Titre » as typed. */
    _field: { state: true }, _advanced: { state: true }, _title: { state: true },
    /** The bar's link just copied (« Lien copié »). */
    _copied: { state: true }
  };

  static styles = [ui, gripStyles, css`
    :host { display: flex; flex-direction: column; min-height: 0; min-width: 0; background: var(--gf-bg); container-type: inline-size; }
    /* « Choisir le contenu »: in the head; with a mouse, shown on hover or focus (always on a touch screen). */
    .cell-head .pick { flex: none; width: 30px; height: 30px; min-height: 0; padding: 0; font-size: 0.9rem; }
    .cell-head .pick[aria-expanded='true'] { color: var(--gf-accent); background: var(--gf-accent-soft); }
    .cell.picked { box-shadow: inset 0 0 0 2px var(--gf-accent); }
    .bar { flex: none; display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 4px 8px 4px 14px; background: var(--gf-surface); border-bottom: 1px solid var(--gf-border); min-width: 0; }
    /* The screen's heading: its own title (?title=), else « Écran sur mesure » — one line, cut by « … », on a phone too. */
    .bar .app { flex: 0 1 auto; min-width: 0; margin: 0; display: flex; align-items: center; gap: 8px; font-size: 1rem; font-weight: 700; white-space: nowrap; }
    .bar .app > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .bar .app .bi { color: var(--gf-accent); }
    .bar > :not(.app, .spacer) { flex: none; }
    .bar .spacer { flex: 1; }
    .bar button, .bar summary { min-height: 34px; padding: 4px 12px; font-size: 0.85rem; }
    .bar .icon-btn { width: 36px; height: 36px; padding: 0; font-size: 1rem; }
    .bar a.btn { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; box-sizing: border-box; padding: 4px 12px; font-size: 0.85rem; color: var(--gf-text); text-decoration: none;
      border: 1px solid var(--gf-border); border-radius: var(--gf-radius-pill); background: var(--gf-surface); }
    .bar a.btn:hover { border-color: var(--gf-accent); }
    /* « Modifier ⇄ Terminé »: one button, pressed while modified; its word always shown. */
    .bar .toggle { gap: 6px; }
    /* ⋯: the screen's options (« Composer un écran »; modified: « Changer de modèle », « Tailles par défaut », « Avancé »). */
    .more-menu { position: relative; }
    .more-menu summary { list-style: none; display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border-radius: 50%; cursor: pointer; color: var(--gf-text-muted); font-size: 1.1rem; }
    .more-menu summary::-webkit-details-marker { display: none; }
    .more-menu summary:hover { background: var(--gf-surface-2); color: var(--gf-text); }
    .more-menu .menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 30; display: grid; min-width: 240px; padding: 6px; border-radius: 12px;
      background: var(--gf-surface); border: 1px solid var(--gf-border); box-shadow: var(--gf-shadow-float); }
    .more-menu .menu > a, .more-menu .menu > button { justify-content: flex-start; gap: 10px; min-height: 40px; padding: 4px 12px; border: 0; border-radius: 8px; background: none; box-shadow: none;
      font-size: 0.9rem; font-weight: 500; text-align: left; color: var(--gf-text); text-decoration: none; display: flex; align-items: center; }
    .more-menu .menu > a:hover, .more-menu .menu > button:hover { background: var(--gf-surface-2); }
    .more-menu .menu > button[aria-pressed='true'] { color: var(--gf-accent); }
    .remarks { flex: none; margin: 0; padding: 6px 14px; font-size: 0.85rem; background: var(--gf-warn-bg); }
    /* Being modified, under the bar: the title, the preview, what is wrong, « Avancé »; never more than part of the height. */
    .edit { flex: none; display: grid; gap: 8px; max-height: 45dvh; overflow-y: auto; padding: 8px 14px; background: var(--gf-bg); border-bottom: 1px solid var(--gf-border); }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; }
    .meta label { display: flex; align-items: center; gap: 8px; font-size: 0.88rem; font-weight: 600; flex: 1 1 320px; }
    .meta input { flex: 1; min-width: 0; min-height: 36px; padding: 6px 10px; font-size: 0.9rem; }
    .segmented button { display: inline-flex; align-items: center; gap: 6px; }
    .hint { margin: 0; font-size: 0.85rem; color: var(--gf-text-muted); display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
    .problems { margin: 0; padding: 8px 12px; font-size: 0.85rem; color: var(--gf-danger); border-radius: 10px; background: color-mix(in srgb, var(--gf-danger) 8%, var(--gf-surface)); }
    ul.problems { padding-left: 30px; }
    .problems code { color: var(--gf-text); }
    .advanced { display: grid; gap: 8px; padding: 10px 12px; border: 1px solid var(--gf-border); border-radius: 10px; background: var(--gf-surface); }
    .advanced .head { display: flex; align-items: center; gap: 8px; }
    .advanced h2 { flex: 1; margin: 0; font-size: 0.95rem; }
    .advanced .icon-btn { width: 32px; height: 32px; font-size: 0.95rem; }
    .advanced label { font-size: 0.85rem; font-weight: 600; }
    .advanced textarea { min-height: 72px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9rem; }
    .advanced .ok { margin: 0; font-size: 0.82rem; color: var(--gf-text-muted); }
    .advanced details { font-size: 0.82rem; color: var(--gf-text-muted); }
    .advanced details summary { cursor: pointer; min-height: 28px; }
    .advanced details code { color: var(--gf-text); }
    /* The screen's cells (in use or modified: the same ones); modified, outlined; previewed as a phone, 390 px wide. */
    .stage { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .stage > .body { flex: 1; }
    .stage.phone { width: 390px; max-width: 100%; align-self: center; box-sizing: border-box; border: 6px solid var(--gf-border); border-radius: 22px; overflow: hidden; }
    :host([editing]) .stage:not(.phone) { outline: 2px dashed color-mix(in srgb, var(--gf-accent) 45%, transparent); outline-offset: -2px; }
    /* The block picker open, docked on the right (wide): the screen beside it. */
    @media (min-width: 700px) { :host([picking]) { padding-right: calc(min(380px, 40%) + 16px); } }
    .body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    /* More rows than the height holds (their least heights): the page of cells scrolls, never squeezes them. */
    .grid { flex: 1; min-height: 0; display: flex; overflow-y: auto; }
    .split { flex: 1; min-width: 0; min-height: 0; display: flex; }
    .split.row { flex-direction: row; } .split.col { flex-direction: column; }
    .part { display: flex; min-width: 0; min-height: 0; }
    .part > * { flex: 1; min-width: 0; min-height: 0; }
    .cell { display: flex; flex-direction: column; background: var(--gf-surface); overflow: hidden; }
    .cell.flash { animation: flash 1.2s ease-out; }
    /* The frame (registry.js#FRAME). A cell hidden while it has nothing to show (vide=masque), its body folded
       (replier): gone, their share to the others. A cell made large (agrandir): over the whole layout, until Échap or
       its button. */
    .part[hidden], .cell-body[hidden] { display: none; }
    .body { position: relative; }
    .cell.maxed { position: absolute; inset: 0; z-index: 20; box-shadow: var(--gf-shadow-float); }
    .split.row > .part.folded .cell-head { writing-mode: vertical-rl; flex-wrap: nowrap; padding: 10px 2px; border-bottom: 0; border-right: 1px solid var(--gf-border); }
    .cell-head .spacer { flex: 1; }
    .cell-head .cell-acts { flex: none; display: inline-flex; align-items: center; gap: 2px; }
    .cell-head .cell-acts .icon-btn { width: 30px; height: 30px; min-height: 0; padding: 0; font-size: 0.85rem; }
    /* Its group (several in the layout): its letter in its colour. */
    .cell-head .cell-group { flex: none; min-width: 20px; height: 20px; padding: 0 5px; box-sizing: border-box; display: inline-grid; place-items: center;
      border-radius: var(--gf-radius-pill); font-size: 0.7rem; font-weight: 700; color: var(--gf-accent-contrast); background: var(--gf-accent); }
    .cell-head .cell-group[data-group='b'] { color: #fff; background: #1d4ed8; }
    .cell-head .cell-group[data-group='c'] { color: #fff; background: #6d28d9; }
    /* How a cell is wired (being modified): a chip a link, lit when it follows the others. */
    .cell-head .cell-links { flex: none; display: inline-flex; gap: 2px; }
    .cell-head .link-chip { width: 24px; height: 24px; min-height: 0; padding: 0; display: inline-grid; place-items: center; border-radius: 50%; font-size: 0.72rem;
      border: 1px dashed var(--gf-border); background: none; color: var(--gf-text-muted); }
    .cell-head .link-chip[aria-pressed='true'], .cell-head .link-chip[data-on='true'] { border-style: solid; border-color: transparent;
      background: color-mix(in srgb, var(--gf-accent) 18%, transparent); color: var(--gf-accent); }
    .cell-head button.link-chip:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    /* A results cell's list / grid switch (view=). */
    .cell-head .cell-views { flex: none; display: inline-flex; gap: 2px; padding: 2px; border-radius: 8px; background: var(--gf-surface-2, var(--gf-bg)); }
    .cell-head .cell-views .icon-btn { width: 28px; height: 26px; min-height: 0; padding: 0; font-size: 0.85rem; border-radius: 6px; }
    .cell-head .cell-views .icon-btn[aria-pressed='true'] { background: var(--gf-surface); color: var(--gf-accent); box-shadow: 0 1px 2px rgb(0 0 0 / 15%); }
    .cell-head .pin { color: var(--gf-accent); }
    @keyframes flash { from { box-shadow: inset 0 0 0 3px var(--gf-accent); } to { box-shadow: inset 0 0 0 3px transparent; } }
    @media (prefers-reduced-motion: reduce) { .cell.flash { animation: none; } }
    .cell-head { flex: none; display: flex; align-items: center; gap: 6px; min-height: 30px; padding: 2px 6px 2px 10px; border-bottom: 1px solid var(--gf-border); background: var(--gf-surface); min-width: 0; flex-wrap: wrap; }
    .cell-head h2 { margin: 0; display: flex; align-items: center; gap: 6px; font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--gf-text-muted); white-space: nowrap; }
    /* How the cell is shown, when not as by default (plant(epure): É): the menu's mark, quiet, after the title (said by the menu's name, not here). */
    .cell-head .cell-mark { padding: 1px 4px; border-radius: 5px; font: 700 0.66rem/1 var(--gf-font); letter-spacing: 0; text-transform: none; color: var(--gf-text-muted); box-shadow: inset 0 0 0 1px var(--gf-border); }
    .cell-head .cell-mark::before { content: attr(data-mark); }
    .cell-head .sub { flex: 1; min-width: 0; font-size: 0.8rem; color: var(--gf-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cell-head .sub i { font-family: var(--gf-font-serif); }
    .cell-body { flex: 1; min-height: 0; display: flex; flex-direction: column; position: relative; }
    .cell-body > * { flex: 1; min-height: 0; }
    .cell-body gf-plant-detail { overflow-y: auto; }
    .cell-body .scroll { overflow-y: auto; }
    .cell-body .pad { padding: 0 12px; }
    .placeholder { display: grid; align-content: center; justify-items: center; gap: 6px; padding: 16px; text-align: center; font-size: 0.9rem; overflow-y: auto; }
    .placeholder > .bi { font-size: 1.6rem; color: var(--gf-warn, #b45309); }
    .placeholder.quiet { color: var(--gf-text-muted); }
    .placeholder.quiet .bi { color: var(--gf-accent); }
    .placeholder p { margin: 0; max-width: 34em; }
    .placeholder code { font-size: 0.85em; background: var(--gf-surface-2); padding: 0 4px; border-radius: 4px; }
    /* Narrow: the columns as a menu of icons, on top. Its items as wide as one another while they all fit (equal
       tracks, none narrower than its icons nor than a finger: 52 × 48 px), else it scrolls sideways — no bar drawn, its
       edge faded on the side where more items wait (data-before / data-after, set as it scrolls; 32 px: FADE). */
    .tabs { flex: none; position: sticky; top: 0; z-index: 2; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(max-content, 1fr);
      overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: none; border-bottom: 1px solid var(--gf-border); background: var(--gf-surface); }
    .tabs::-webkit-scrollbar { display: none; }
    .tabs[data-before] { mask-image: linear-gradient(to right, transparent, #000 32px); }
    .tabs[data-after] { mask-image: linear-gradient(to left, transparent, #000 32px); }
    .tabs[data-before][data-after] { mask-image: linear-gradient(to right, transparent, #000 32px, #000 calc(100% - 32px), transparent); }
    .tab { --ink: var(--gf-text-muted); --under: var(--gf-surface); position: relative; min-width: 52px; min-height: 48px; padding: 0 10px; border: 0; border-radius: 0;
      background: var(--under); box-shadow: none; color: var(--ink); }
    /* Room for each name beside its icons (a window, a tablet): the items share the menu whatever their names, which
       are cut short (…), whole on hover. */
    .tabs.named { grid-auto-columns: minmax(0, 1fr); }
    .tabs.named .tab { padding: 0 8px; gap: 6px; }
    .tabs.named .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.85rem; }
    .tabs.named .tab[aria-selected='true'] .name { font-weight: 700; }
    @media (hover: hover) { .tab:hover { --ink: var(--gf-text); --under: var(--gf-surface-2); } }
    /* The tab shown: on the accent's tint, its icons in the accent, underlined. */
    .tab[aria-selected='true'] { --ink: var(--gf-accent); --under: var(--gf-accent-soft); }
    .tab[aria-selected='true']::after { content: ''; position: absolute; left: 8px; right: 8px; bottom: 0; height: 3px; border-radius: 3px 3px 0 0; background: var(--gf-accent); }
    /* A hairline between two columns' icons: where one column ends, the next begins. */
    .tab + .tab::before { content: ''; position: absolute; left: 0; top: 14px; bottom: 14px; width: 1px; background: var(--gf-border); }
    .tab[aria-selected='true']::before, .tab[aria-selected='true'] + .tab::before { display: none; }
    /* The ring inside: the menu clips what passes its edges. */
    .tab:focus-visible { box-shadow: inset 0 0 0 2px var(--gf-accent); }
    .glyphs { flex: none; display: inline-flex; align-items: center; gap: 4px; font-size: 1.3rem; line-height: 1; pointer-events: none; }
    .glyphs.many { gap: 5px; font-size: 1.05rem; }
    .glyph { position: relative; display: inline-grid; }
    .glyph.marked { margin-right: calc(4px + 4px * var(--chars)); }
    /* A presentation chosen (plant(epure): É; search(filters=1,list=0): F−L): a letter or two on the icon's corner,
       ringed by the tab's ground, the room it passes the icon by kept beside it. */
    .mark { position: absolute; left: calc(100% - 7px); bottom: -5px; min-width: 13px; padding: 2px 3px; border-radius: 6px; font: 700 9px/1 var(--gf-font);
      text-align: center; letter-spacing: 0; background: var(--ink); color: var(--gf-surface); box-shadow: 0 0 0 1.5px var(--under); }
    .mark::before { content: attr(data-mark); }
    /* The magnifier's handle is at its lower corner: its mark on the upper one. */
    .glyph[data-icon='search'] .mark { bottom: auto; top: -5px; left: calc(100% - 5px); }
    .more { font-size: 0.72rem; font-weight: 700; }
    .more::before { content: '+' attr(data-more); }
    /* Two columns that would still look alike (what differs hidden past their three icons): numbered, on the corner. */
    .nth { position: absolute; top: 5px; right: 6px; font: 700 10px/1 var(--gf-font); color: var(--ink); }
    .nth::before { content: attr(data-nth); }
    /* Brought by a plant chosen in another tab: lit a moment. */
    .tab.brought { animation: brought 1.2s ease-out; }
    .tab.brought .glyphs { animation: nudge 0.5s ease-out; }
    @keyframes brought { from { box-shadow: inset 0 0 0 3px var(--gf-accent); background: color-mix(in srgb, var(--gf-accent) 30%, var(--gf-surface)); } }
    @keyframes nudge { 40% { transform: scale(1.18); } }
    @media (prefers-reduced-motion: reduce) { .tab.brought, .tab.brought .glyphs { animation: none; } .tab.brought { box-shadow: inset 0 0 0 3px var(--gf-accent); } }
    .tabpanel { flex: 1; min-height: 0; display: flex; overflow-y: auto; }
    .tabpanel[hidden] { display: none; }
    /* Being modified: each cell's build button opens its cross over the cell — an arm towards each side cuts it in two
       that way, the middle moves it or takes it out. */
    .cell-head .build { flex: none; width: 30px; height: 30px; min-height: 0; padding: 0; font-size: 0.9rem; }
    .cell-head .build[aria-expanded='true'] { color: var(--gf-accent); background: var(--gf-accent-soft); }
    .cross { position: absolute; inset: 6px; z-index: 6; display: grid; grid-template: 1fr 1.3fr 1fr / 1fr 1.3fr 1fr; gap: 6px; container-type: size; }
    .cross button { min-width: 0; min-height: 0; padding: 2px; font-size: 0.85rem; border-radius: 10px; display: flex; align-items: center; justify-content: center; gap: 6px; }
    .cross .arm { background: color-mix(in srgb, var(--gf-accent) 14%, var(--gf-surface)); border: 2px dashed var(--gf-accent); color: var(--gf-text); }
    .cross .arm:hover:not(:disabled), .cross .arm:focus-visible { background: color-mix(in srgb, var(--gf-accent) 30%, var(--gf-surface)); border-style: solid; }
    .cross .arm:disabled { opacity: .45; cursor: not-allowed; }
    .cross .top { grid-area: 1 / 2; } .cross .bottom { grid-area: 3 / 2; } .cross .left { grid-area: 2 / 1; } .cross .right { grid-area: 2 / 3; }
    .cross .mid { grid-area: 2 / 2; display: flex; align-items: center; justify-content: center; gap: 4px; flex-wrap: wrap; padding: 2px; border-radius: 10px; background: var(--gf-surface); border: 2px solid var(--gf-accent); }
    .cross .mid button { width: 32px; height: 32px; padding: 0; font-size: 0.95rem; }
    .cross .mid .del { color: var(--gf-danger); }
    @container (max-width: 300px) { .cross .lbl { display: none; } }
    /* An « Emplacement »: the block picker's first level in it. */
    .cell-body > gf-block-picker[inline] { flex: 1; min-height: 0; }
    /* The home (#/layout): a grid or a model, each drawn small. */
    .home { flex: 1; min-height: 0; overflow-y: auto; }
    .home > div { width: 100%; max-width: 1180px; margin: 0 auto; padding: 16px 16px 32px; box-sizing: border-box; display: flex; flex-direction: column; gap: 14px; }
    .home header h1 { margin: 0; font-size: 1.35rem; display: flex; align-items: center; gap: 8px; }
    .home header h1 .bi { color: var(--gf-accent); }
    .home header p { margin: 4px 0 0; color: var(--gf-text-muted); }
    .home h2 { margin: 0 0 8px; font-size: 1rem; }
    .choices { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
    .choice { box-sizing: border-box; display: flex; flex-direction: column; gap: 8px; padding: 12px; text-decoration: none; color: var(--gf-text);
      border: 1px solid var(--gf-border); border-radius: var(--gf-radius-lg); background: var(--gf-surface); transition: border-color .15s; }
    .choice:hover { border-color: var(--gf-accent); }
    .choice:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .choice .thumb { aspect-ratio: 16 / 10; border-radius: var(--gf-radius-sm); background: var(--gf-bg); padding: 6px; box-sizing: border-box; display: flex; }
    .choice b { display: flex; align-items: center; gap: 6px; }
    .choice small { color: var(--gf-text-muted); line-height: 1.35; }
    .g { display: flex; flex: 1; min-width: 0; min-height: 0; gap: 4px; }
    .g.row { flex-direction: row; } .g.col { flex-direction: column; }
    .g i { flex: 1; min-width: 0; min-height: 0; border-radius: 3px; background: color-mix(in srgb, var(--gf-accent) 22%, transparent); }
    /* Narrow: the bar's other words go (its buttons keep their names); the heading and the toggle's word stay. The
       preview goes too: on a phone, it is the screen itself. */
    @container (max-width: 699px) {
      .bar .lbl, .edit .preview { display: none; } .bar { padding-left: 10px; gap: 6px; }
      .stage.phone { width: auto; border: 0; border-radius: 0; }
    }
  `];

  #store = new StoreController(this);
  /** A mouse (a window), not a finger: the menu of columns names its items wherever they have the room. */
  #fine = new MediaController(this, '(hover: hover) and (pointer: fine)');
  #state = new LayoutState();
  /** The room the cells have: the stage's width (the phone preview's 390 px gives the tabs). */
  #size = new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w !== this._w) this._w = w; });
  /** The stage the size is observed on (drawn anew: observed again). @type {Element | null} */
  #observed = null;

  constructor() {
    super();
    /** @type {{ name: string, spec: string | null, search: string, grid?: string | null } | null} */
    this.route = null;
    this._w = 0;
    this._tab = 0;
    this.editing = false;
    /** @type {string | null} */
    this._flash = null;
    this._brought = -1;
    this._named = false;
    /** @type {string | null} */
    this._max = null;
    /** @type {string | null} */
    this._cellCopied = null;
    /** @type {string | null} */
    this._pick = null;
    this.picking = false;
    /** @type {string | null} */
    this._cross = null;
    this._preview = false;
    this._field = '';
    this._advanced = false;
    this._title = '';
    this._copied = false;
    this.#state.addEventListener('change', this.#onState);
    // A link to a plant's sheet in a cell: that plant becomes the current one, the layout stays — unless the cell says
    // otherwise (toucher=fiche, ecrit=0: the sheet opens, as a link; toucher=rien: nothing).
    this.addEventListener('click', e => {
      if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const path = e.composedPath();
      const a = /** @type {HTMLAnchorElement | undefined} */ (path.find(n => n instanceof HTMLAnchorElement && n.hasAttribute('href')));
      // One marked data-open (the map's current plant ↗): its sheet opened, as any link.
      const m = a && !a.hasAttribute('data-open') && /^#\/plant\/(\d+)(?:\?|$)/.exec(a.getAttribute('href') || '');
      if (!m) return;
      const at = /** @type {HTMLElement | undefined} */ (path.find(n => n instanceof HTMLElement && n.matches('section.cell[data-cell]')));
      const r = at ? this.#shown.cells.get(/** @type {string} */ (at.dataset.cell)) : undefined;
      const touch = r ? touchOf(r) : null;
      if (touch === 'fiche') return;
      e.preventDefault();
      if (touch !== 'rien') (r ? this.#stateOf(r) : this.#state).pick(Number(m[1]));
    });
    // A cell that has nothing to show, or something again (the deck: its cards), for a cell hidden meanwhile (vide=masque).
    this.addEventListener('cell-empty', e => {
      const at = /** @type {HTMLElement | undefined} */ (e.composedPath().find(n => n instanceof HTMLElement && n.matches('section.cell[data-cell]')));
      if (!at) return;
      const key = /** @type {string} */ (at.dataset.cell), empty = Boolean(/** @type {CustomEvent} */ (e).detail?.empty);
      if (this.#said.get(key) !== empty) { this.#said.set(key, empty); this.requestUpdate(); }
    });
    // A results cell shown otherwise (a list grown into a grid): its head's switch says it.
    this.addEventListener('results-shown', () => this.requestUpdate());
    // A cell's own control (a map's 3D, its background, its layers, its binoculars; the filters opened…): kept in the
    // layout, as the editor writes it — the address is the app, sent as it is.
    this.addEventListener('cell-param', e => {
      const at = /** @type {HTMLElement | undefined} */ (e.composedPath().find(n => n instanceof HTMLElement && n.matches('section.cell[data-cell]')));
      if (!at) return;
      e.stopPropagation();
      this.#setCellParam(/** @type {string} */ (at.dataset.cell), /** @type {CustomEvent} */ (e).detail);
    });
    // Échap: the cell made large (agrandir) back in its place.
    this.addEventListener('keydown', e => { if (e.key === 'Escape' && this._max !== null && !e.defaultPrevented) { e.preventDefault(); this.#maximize(null); } });
    // A column's funnel (a results grid): its filter shown, in a search's filters or a filters cell.
    this.addEventListener('focus-facet', e => { e.stopPropagation(); this.#revealFacet(/** @type {CustomEvent} */ (e).detail.facet); });
    // ⤢ on a block of a sheet, a photo touched: a cell that shows that block flashes instead of a dialog.
    this.addEventListener('open-pane', e => {
      const key = /** @type {CustomEvent} */ (e).detail?.key;
      const shown = [...this.#shown.cells].find(([, r]) => r.known && ((r.spec.id === 'plant' && r.view?.key === key) || (key === 'media' && r.spec.id === 'media')));
      if (!shown) return;
      e.preventDefault();
      this.#bring(shown[0]);
    });
  }

  connectedCallback() {
    super.connectedCallback();
    // The stage observed again once drawn (updated()), the page named again once the address is followed.
    this.#observed = null;
    this.#named = null;
    this.#ready = store.state.status === 'ready';
    // Back on the page (moved, not made anew): its state read again from the address.
    if (this.hasUpdated && this.route) { this.#layout = show(''); this.#follow(); }
    // Until the flora is ready the app may set the search itself (main.js: the last one): the address' comes back then.
    if (!this.#ready) {
      whenReady().then(() => {
        this.#ready = true;
        // The home and an old address in its replacing: no search of their own.
        if (!this.isConnected || !this.route || this.#home || this.#aliasing) return;
        const q = readQuery(this.route.search);
        if (toHash(q) !== toHash(store.state.query)) store.set({ query: q });
        this.#lastQuery = toHash(q);
        runSearch();
      });
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#size.disconnect();
    this.#observed = null;
    this.#state.dispose();
    this.#state.removeEventListener('change', this.#onState);
    this.#state = new LayoutState();
    this.#state.addEventListener('change', this.#onState);
    for (const g of [...this.#others.keys()]) this.#dropGroup(g);
  }

  // ── Groups (registry.js#FRAME groupe): each its own zone, plant, period and search ─────────────────────

  /** The other groups' (b, c): their state and their search, made when a cell of theirs is there. @type {Map<string, { state: LayoutState, channel: SearchChannel }>} */
  #others = new Map();

  /** A cell's group ('a': the first, the app's search). @param {Resolved} r */
  #groupOf(r) { return r.known ? /** @type {string} */ (r.params.groupe ?? 'a') : 'a'; }

  /** A group's state and search; another than the first made the first time. @param {string} g */
  #group(g) {
    if (g === 'a') return { state: this.#state, channel: /** @type {import('../core/search-channel.js').Channel} */ (APP) };
    let had = this.#others.get(g);
    if (!had) {
      const channel = new SearchChannel();
      const state = new LayoutState({ channel });
      state.addEventListener('change', this.#onState);
      channel.addEventListener('change', this.#onChannel);
      had = { state, channel };
      this.#others.set(g, had);
    }
    return had;
  }

  /** A group no cell has any more: its loads stopped. @param {string} g */
  #dropGroup(g) {
    const had = this.#others.get(g);
    if (!had) return;
    had.state.dispose();
    had.state.removeEventListener('change', this.#onState);
    had.channel.removeEventListener('change', this.#onChannel);
    this.#others.delete(g);
  }

  /** A cell's state (its group's). @param {Resolved} r */
  #stateOf(r) { return this.#group(this.#groupOf(r)).state; }

  /** The groups the layout's cells are in, the first always. @param {Shown} [l] @returns {string[]} */
  #groups(l = this.#layout) {
    return ['a', ...new Set([...l.cells.values()].map(r => this.#groupOf(r)).filter(g => g !== 'a'))].sort();
  }

  /** Another group's search changed (typed, filtered, its results come): the address follows, drawn again. */
  #onChannel = () => { this.#write('replace'); this.requestUpdate(); };

  /** The flora is ready: the search's changes are the user's, the address follows them. */
  #ready = false;
  /** The search the address says (toHash), to know one changed by a cell. */
  #lastQuery = '';
  /** @type {Shown} */
  #layout = show('');
  /** The layout on screen (the address'). @type {Shown} */
  #shown = this.#layout;
  /** Narrow (tabs) at the last render. */
  #narrow = false;

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (changed.has('route') && this.route) this.#follow();
    this.#shown = this.#layout;
    // Being modified: « Avancé » and « Titre » follow the screen, unless being typed in (the caret would move as the
    // text is cleaned).
    if (this.editing) {
      const active = this.renderRoot instanceof ShadowRoot ? this.renderRoot.activeElement : null;
      if (active?.id !== 'layout-text') this._field = this.#written;
      if (active?.id !== 'layout-title') this._title = this.#state.live.title ?? '';
    }
    // A results cell over the whole flora (zone=0): the search asked again without the zone (state.js#wholeOf).
    for (const g of this.#groups(this.#shown)) {
      this.#group(g).state.wholeOf([...this.#shown.cells.values()].some(r => r.known && r.spec.id === 'results' && r.params.zone === false && this.#groupOf(r) === g));
    }
  }

  // ── The frame of each cell (registry.js#FRAME) ─────────────────────────────────────────────────────────

  /** What a cell said of itself: nothing to show (true) or something (false) — the deck's cards (`cell-empty`). @type {Map<string, boolean>} */
  #said = new Map();
  /** The cells hidden now (vide=masque, nothing to show), by their paths. @type {Set<string>} */
  #hidden = new Set();

  /** The plant a cell shows: its own (plante=), else the current one. @param {Resolved} r @returns {number | null} */
  #plantOf(r) { return (r.known && r.params.plante) || this.#stateOf(r).live.plant; }

  /**
   * Whether a cell has nothing to show (registry.js#FRAME_OF: those that take vide): a plant's (the sheet, a block, the
   * photos), no plant; the results, none found in the zone (over the whole flora with zone=0) — kept to what a map
   * shows, the zone's all the same: a cell hidden there would resize the map, framed again on the zone —; the deck,
   * no cards (it says so). Never while it is still coming. @param {string} path @param {Resolved} r
   */
  #isEmpty(path, r) {
    if (!r.known) return false;
    const id = r.spec.id;
    if (id === 'plant' || id === 'media') return this.#plantOf(r) == null;
    if (id === 'results') {
      const { state: s, channel } = this.#group(this.#groupOf(r));
      if (r.params.zone === false) return s.whole?.key === s.wholeFor && s.whole.total === 0;
      return this.#store.state.status === 'ready' && (channel.results.inZone?.length ?? channel.results.total) === 0;
    }
    if (id === 'deck') return this.#said.get(path) === true;
    return false;
  }

  /**
   * The cells hidden now: those that say so (vide=masque) and have nothing to show — never while the layout is being
   * edited (each cell's tools are in its head), never all of the screen nor, narrow, all of a tab (their messages then).
   * @param {boolean} narrow @returns {Set<string>}
   */
  #hiddenCells(narrow) {
    if (this.editing) return new Set();
    const cells = this.#shown.cells;
    const hidden = new Set([...cells].filter(([p, r]) => r.known && r.params.vide === 'masque' && this.#isEmpty(p, r)).map(([p]) => p));
    if (!hidden.size) return hidden;
    const under = (/** @type {string} */ prefix) => [...cells.keys()].filter(p => prefix === '' || p === prefix || p.startsWith(prefix + '.'));
    if (under('').every(p => hidden.has(p))) return new Set();
    if (narrow) {
      for (const j of this.#shown.tree.kids.keys()) {
        const tab = under(String(j));
        if (tab.every(p => hidden.has(p))) for (const p of tab) hidden.delete(p);
      }
    }
    return hidden;
  }

  /** Whether a node is hidden: a cell hidden, or a list all of whose cells are. @param {LayoutNode} n @param {number[]} path @returns {boolean} */
  #nodeHidden(n, path) {
    return n.t === 'cell' ? this.#hidden.has(path.join('.')) : n.kids.every((k, j) => this.#nodeHidden(k, [...path, j]));
  }

  /** A cell made large over the layout (agrandir), or back in its place (null): the focus on its button. @param {string | null} path */
  async #maximize(path) {
    const was = this._max;
    this._max = path;
    await this.updateComplete;
    const at = path ?? was;
    /** @type {HTMLElement | null} */ (this.renderRoot.querySelector(`section.cell[data-cell="${at}"] .cell-acts [data-act="agrandir"]`))?.focus();
  }

  /** An action of a cell's head, shown (registry.js#FRAME: actions, and a head to put it in). @param {string} path @param {string} act */
  #acts(path, act) {
    const r = this.#shown.cells.get(path);
    return Boolean(r?.known && (this.editing || r.params.tete !== 'non') && /** @type {string[]} */ (r.params.actions).includes(act));
  }

  /** Whether a cell is folded to its head now (etat=replie, written by « Replier »). @param {string} path */
  #isFolded(path) {
    const r = this.#shown.cells.get(path);
    return Boolean(r?.known && r.params.etat === 'replie') && this._max !== path && this.#acts(path, 'replier');
  }

  /** Whether a cell is large over the layout now. @param {string} path */
  #isMax(path) { return this._max === path && this.#acts(path, 'agrandir'); }

  /** A cell folded to its head, or unfolded (replier): kept in the address (etat=replie). @param {string} path */
  #fold(path) { this.#setCellParam(path, { etat: this.#isFolded(path) ? null : 'replie' }); }

  /** A link to a layout of this cell alone, with the same state (partager): shared, or copied. @param {CellNode} n @param {string} path @param {Resolved} r */
  async #shareCell(n, path, r) {
    const text = serialize({ t: 'list', kids: [{ ...n, size: null }], size: null });
    const g = this.#group(this.#groupOf(r));
    const url = href.layout(text, liveSearch(g.state.live, g.channel.query, g.state.radius, groupPrefix(this.#groupOf(r))));
    const res = await share({ title: r.title + ' — GeoFlora', url });
    if (res === 'copied') { this._cellCopied = path; setTimeout(() => { if (this._cellCopied === path) this._cellCopied = null; }, 2000); }
  }

  /** The names of a plant a cell keeps (plante=), read once from the flora (its head). @type {Map<number, { name: string, sci: string } | null>} */
  #names = new Map();

  /** A fixed plant's names, read once the flora is there (null: not yet, or none). @param {number} id */
  #namesOf(id) {
    if (!this.#names.has(id)) {
      this.#names.set(id, null);
      whenReady().then(() => getPlant(id)).then(p => {
        if (p) { this.#names.set(id, { name: nameOf(p), sci: p.scientificName }); this.requestUpdate(); }
      });
    }
    return this.#names.get(id) ?? null;
  }

  /** The page's name when the screen has no title of its own. */
  get #pageName() { return this.#home ? 'Composer un écran — GeoFlora' : 'Écran sur mesure — GeoFlora'; }

  /** The page's title the screen's own title gives (« Orchidées de Mirabel · GeoFlora »; null: none — a plant's sheet in a cell may name the page then). */
  get pageTitle() { const t = this.#state.live.title; return t ? t + ' · GeoFlora' : null; }

  /** The page's title last set from the screen's own title. @type {string | null} */
  #titled = null;
  /** Whether the page was last named as the home (true) or a screen (false); null: not yet. @type {boolean | null} */
  #named = null;

  updated() {
    if (this.#narrow) { this.#nameRoom(); this.#tabInSight(); }
    // The room the cells have: the stage's (drawn anew with the home and back: observed again).
    const stage = this.renderRoot.querySelector('.stage');
    if (stage !== this.#observed) { this.#size.disconnect(); if (stage) this.#size.observe(stage); this.#observed = stage; }
    const page = this.pageTitle;
    if (page && document.title !== page) document.title = page;
    else if (!page && this.#titled) document.title = this.#pageName;
    this.#titled = page;
    // The search changed by a cell (its text, a filter, the sort): the address follows, without a new entry.
    if (!this.#ready) return;
    const q = toHash(store.state.query);
    if (q !== this.#lastQuery) { this.#lastQuery = q; this.#write('replace'); }
  }

  /** The home (#/layout): no layout, no state, no search, no address written. */
  #home = false;
  /** An old address of « Créer une app » (or a stray edit=1 on the home) being replaced: nothing drawn nor written meanwhile. */
  #aliasing = false;
  /** Being modified: where « Terminé » goes back to (history.js#sheetMark, `gfEditFrom` in the entry). @type {import('../core/history.js').SheetMark | null} */
  #editMark = null;

  /** The address followed (a link, Back, Forward, a reload): the home, or a screen — its layout, its state, its search. */
  #follow() {
    const route = /** @type {any} */ (this.route);
    // « Créer une app »'s old address: the screen it names (g=, else its grid), being modified, in its place (the same
    // depth); nothing of it read here — its spec may be null. Neither: the home.
    if (route.name === 'builder') {
      this.#aliasing = true;
      const spec = route.spec || modelSpec(route.grid);
      replaceView(spec ? href.layout(spec, route.search, true) : href.layout(''));
      return;
    }
    const editing = EDITING.test(route.search);
    // The home (#/layout, no text): no state, no search, no address written (a stray edit=1 taken off).
    if (!route.spec) {
      if (editing) { this.#aliasing = true; replaceView(href.layout('')); return; }
      this.#aliasing = false;
      if (this.editing) this.#leaveEditing();
      this.editing = false;
      this.#editMark = null;
      this.#home = true;
      this.#layout = show(''); this.#raw = ''; this._max = null; this.#said.clear();
      if (!sameLive(EMPTY_LIVE, this.#state.live)) this.#state.set(EMPTY_LIVE, 'none');
      for (const g of [...this.#others.keys()]) this.#dropGroup(g);
      this.#namePage();
      return;
    }
    this.#aliasing = false;
    this.#home = false;
    if (this.editing && !editing) this.#leaveEditing();
    this.editing = editing;
    // Being modified: where « Terminé » goes back to — kept in the entry (a reload, Back, Forward read it back).
    this.#editMark = editing ? sheetMark('gfEditFrom', () => null) : null;
    const next = show(route.spec);
    const fresh = next.text !== this.#layout.text || next.errors.length !== this.#layout.errors.length;
    if (fresh) {
      this.#layout = next;
      this.#raw = decodeSpec(route.spec);
      // Another layout (a link, Back): the one being modified is left; no cell large or folded, nothing said empty, no
      // cell's picker open. Modified, a text that cannot be read whole: « Avancé » unfolded, to correct it.
      this._cross = null;
      this.#closePick(false);
      this._max = null;
      this.#said.clear();
      this.#defaults(next);
      if (this.editing && next.errors.length) this._advanced = true;
    }
    const live = readLive(route.search);
    if (!sameLive(live, this.#state.live)) this.#state.set(live, 'none');
    else if (fresh) this.#state.follow();
    const q = readQuery(route.search);
    this.#lastQuery = toHash(q);
    if (toHash(q) !== toHash(store.state.query)) {
      store.set({ query: q });
      if (this.#ready) runSearch();
    }
    // The other groups: each its state and its search, its keys after its letter (b.p=, b.q=…).
    const groups = this.#groups(next);
    for (const g of [...this.#others.keys()]) if (!groups.includes(g)) this.#dropGroup(g);
    for (const g of groups.filter(x => x !== 'a')) {
      const had = this.#others.has(g), { state, channel } = this.#group(g);
      const glive = readLive(route.search, groupPrefix(g));
      if (!sameLive(glive, state.live)) state.set(glive, 'none');
      else if (fresh || !had) state.follow();
      const gq = readQuery(route.search, groupPrefix(g));
      if (toHash(gq) !== toHash(channel.query) || !had) { /** @type {SearchChannel} */ (channel).query = gq; channel.run(); }
    }
    this.#namePage();
    // Written as the app writes it (canonical names, its own order of words), unless it could not be read whole.
    if (!next.errors.length && fresh) queueMicrotask(() => this.#write('replace'));
  }

  /** The page named again when the home gives way to a screen, or a screen to the home (a sheet in a cell may name it meanwhile). */
  #namePage() {
    if (this.#named === this.#home) return;
    this.#named = this.#home;
    document.title = this.pageTitle ?? this.#pageName;
  }

  /** Modified no more: its tools put away — the picker and the cross closed, « Avancé » folded, a text still resting dropped. */
  #leaveEditing() {
    clearTimeout(this.#typing); this.#typing = 0;
    this._cross = null; this.#closePick(false); this.#pickRoom = null; this._advanced = false; this._preview = false;
  }

  /** The layout's text as it was given (the address', or « Avancé »'s). */
  #raw = '';

  /** The layout as the address writes it: canonical, or as it was given when it cannot be read whole (to be corrected). */
  get #written() { return this.#layout.errors.length ? this.#raw : this.#layout.text; }

  /** The layout's state as the address writes it (state.js): the first group's, then each other's after its letter. */
  #search() {
    const parts = [liveSearch(this.#state.live, store.state.query, this.#state.radius)];
    for (const g of this.#groups().filter(x => x !== 'a')) {
      const { state, channel } = this.#group(g);
      parts.push(liveSearch(state.live, channel.query, state.radius, groupPrefix(g)));
    }
    return parts.filter(Boolean).join('&');
  }

  /**
   * The address of the screen in use: what Partager gives, what « Terminé » and Back land on — a layout that could not
   * be read whole, as it was typed (to be corrected).
   */
  #usageHref() { return href.layout(this.#written, this.#search()); }

  /** The address of the screen now: being modified, edit=1 last. */
  #href() { return href.layout(this.#written, this.#search(), this.editing); }

  /** The layout's text set (the edit strip's « Avancé », a cell's cross, the picker): shown, and written in the address (no new entry). @param {string} text */
  #setText(text) {
    this.#raw = text;
    this.#layout = show(text);
    this.#shown = this.#layout;
    if (this.editing && this.#layout.errors.length) this._advanced = true;
    this.#afterChange();
  }

  /** The layout changed here (modified: the cross, the picker, « Avancé »): the radius it gives, the address replaced, drawn. */
  #afterChange() {
    if (this.#defaults(this.#layout)) this.#state.follow();
    this.#write('replace');
    this.requestUpdate();
  }

  /**
   * What the layout gives until the address says otherwise: the radius of a map or a place cell (r=), the period of a
   * map (when=: this year, this month). Returns whether it changed. @param {Shown} l
   */
  #defaults(l) {
    let changed = false;
    for (const g of this.#groups(l)) {
      const cells = [...l.cells.values()].filter(r => this.#groupOf(r) === g);
      const first = cells.find(r => r.known && r.params.r != null);
      const when = cells.find(r => r.known && r.spec.id === 'map' && r.params.when && r.params.when !== 'toujours');
      const radius = first?.known ? first.params.r : 2000, periode = when?.known ? when.params.when : 'toujours';
      // The sources its maps say (src=, or their intent: répartition), all of them; none says: iNaturalist and GBIF,
      // but one whose module is off (core/observations.js defaultSources: never said missing on every map).
      const said = cells.flatMap(r => r.known && r.spec.id === 'map' && Array.isArray(r.params.src) ? /** @type {string[]} */ (r.params.src) : []);
      const sources = /** @type {('inat' | 'gbif')[]} */ (SOURCES.filter(x => said.includes(x)));
      const state = this.#group(g).state;
      const own = sources.length ? sources : defaultSources();
      if (radius !== state.defaultRadius || periode !== state.defaultPeriode || own.join() !== state.defaultSources.join()) {
        changed = true;
        state.defaultRadius = radius;
        state.defaultPeriode = periode;
        state.defaultSources = own;
        // Another group's: followed at once (the first's by its caller).
        if (g !== 'a') state.follow();
      }
    }
    return changed;
  }

  /** The address follows the screen: a new entry, the same one, or not at all. @param {import('./state.js').How} how */
  #write(how) {
    if (how === 'none' || !this.route || this.#home || this.#aliasing) return;
    // Being modified, a layout left with no cell (« Avancé » emptied) is not written: the address keeps the last one.
    if (this.editing && !this.#layout.tree.kids.length) return;
    const url = this.#href();
    // Being modified, nothing is a new entry: a plant or a zone chosen replaces the address too.
    if (location.hash !== url) { if (how === 'push' && !this.editing) pushHash(url, {}, false); else replaceHash(url); }
    // Being modified: the entry it was entered from gets the screen as it is now (Back, « Terminé »).
    if (this.editing && this.#editMark?.from != null) renewBehind(this.#editMark.from, this.#usageHref());
  }

  /** The state changed: the address follows; narrow, a plant chosen brings a tab that shows it. @param {Event} e */
  #onState = e => {
    const { how, keys } = /** @type {CustomEvent} */ (e).detail;
    this.#write(how);
    if (this.#narrow && how === 'push' && keys.includes('plant')) this.#toPlantTab();
    this.requestUpdate();
  };

  /** Narrow: the first tab with a cell showing the plant, unless the one shown has one. */
  #toPlantTab() {
    const tabOf = (/** @type {string} */ p) => Number(p.split('.')[0]);
    // Not a cell with a plant of its own (plante=): it does not show the plant chosen.
    const tabs = [...this.#shown.cells].filter(([, r]) => r.known && FOLLOWS_PLANT.has(r.spec.id) && !r.params.plante).map(([p]) => tabOf(p));
    if (tabs.length && !tabs.includes(this.#active)) this.#broughtTo(tabs[0]);
  }

  /** @type {any} */ #broughtTimer = 0;
  /** Narrow: a tab shown for what happened in another (not by the hand on the menu): its icon lit a moment. @param {number} j */
  #broughtTo(j) {
    if (j === this.#active) return;
    this._tab = j;
    this._brought = j;
    clearTimeout(this.#broughtTimer);
    this.#broughtTimer = setTimeout(() => { this._brought = -1; }, 1300);
  }

  /** A cell brought into view and flashed (narrow: its tab). @param {string} path */
  async #bring(path) {
    if (this.#narrow) this.#broughtTo(Number(path.split('.')[0]));
    this._flash = path;
    await this.updateComplete;
    this.renderRoot.querySelector(`[data-cell="${path}"]`)?.scrollIntoView({ block: 'nearest' });
    setTimeout(() => { if (this._flash === path) this._flash = null; }, 1300);
  }

  /** @param {string} facet */
  async #revealFacet(facet) {
    for (const s of /** @type {NodeListOf<any>} */ (this.renderRoot.querySelectorAll('dl-search'))) if (await s.revealFacet(facet)) return;
    for (const p of this.renderRoot.querySelectorAll('gf-filter-panel')) if (await revealFacet(p, facet)) return;
  }

  // ── Sizes ────────────────────────────────────────────────────────────────────────────────────────────────

  /** A split given new shares: kept for the layout's shape, and written in the address (a link has them). @param {number[]} path @param {number[]} sizes */
  #setShares(path, sizes) {
    saveShares(this.#layout.shape, path.join('.'), sizes);
    this.#layout = show(serialize(setShares(this.#layout.tree, path, sizes)));
    this.#shown = this.#layout;
    this.#write('replace');
    this.requestUpdate();
  }

  /**
   * Settings of a cell changed by the cell itself (`cell-param` {key: value…}: a map's 3D, background, layers, period,
   * binoculars, view; the filters opened; « Replier »): written in the layout as the editor writes them
   * (registry.js#withParam: left out when the cell gives that value without it — its default, its intent's; null: back
   * to it), the address replaced (no new entry). A layout that cannot be read whole is left as typed (to be corrected).
   * @param {string} at the cell's path ('0', '2.1') @param {Record<string, unknown>} values
   */
  #setCellParam(at, values) {
    if (this.#layout.errors.length) return;
    const tree = this.#layout.tree;
    const path = at.split('.').map(Number);
    let n = nodeAt(tree, path);
    if (!n || n.t !== 'cell') return;
    for (const [key, v] of Object.entries(values ?? {})) n = withParam(/** @type {CellNode} */ (n), key, v);
    const text = serialize(replaceAt(tree, path, n));
    if (text === this.#layout.text) return;
    this.#layout = show(text);
    this.#shown = this.#layout;
    if (this.#defaults(this.#layout)) this.#state.follow();
    this.#write('replace');
    this.requestUpdate();
  }

  /** Every share back to the default: the ones kept and the ones written (⋯ › « Tailles par défaut », being modified). */
  #resetSizes() {
    forgetShares(this.#layout.shape);
    /** @param {LayoutNode} n @returns {LayoutNode} */
    const strip = n => n.t === 'cell' ? { ...n, size: null } : { ...n, size: null, kids: n.kids.map(strip) };
    this.#layout = show(serialize(/** @type {ListNode} */ (strip(this.#layout.tree))));
    this.#shown = this.#layout;
    this.#write('replace');
    this.requestUpdate();
  }

  // ── Being modified: each cell's cross ─────────────────────────────────────────────────────────────────────────────

  /** The arms of a cell's cross: their side, their words, their arrow. @type {{ side: import('./builder-grid.js').Side, label: string, icon: import('../core/icons.js').IconName }[]} */
  static ARMS = [
    { side: 'top', label: 'Au-dessus', icon: 'arrow-up' },
    { side: 'left', label: 'À gauche', icon: 'arrow-left' },
    { side: 'right', label: 'À droite', icon: 'arrow-right' },
    { side: 'bottom', label: 'En dessous', icon: 'arrow-down' }
  ];

  /** The layout as boxes (builder-grid.js), or null when its text cannot be read whole (the edit strip says why). */
  get #box() { return this.#layout.errors.length ? null : boxOf(this.#layout.text); }

  /** A cell's cross, open or closed (its build button focused again when closed). @param {string} key */
  async #toggleCross(key) {
    const open = this._cross !== key;
    this._cross = open ? key : null;
    await this.updateComplete;
    /** @type {HTMLElement | null} */ (this.renderRoot.querySelector(open ? `section.cell[data-cell="${key}"] .cross .arm:not(:disabled)` : `section.cell[data-cell="${key}"] .build`))?.focus();
  }

  /**
   * The layout changed by a cell's cross: its boxes made anew (builder-grid.js), written in the address; then the
   * build button of `focus` (a path) focused. @param {(b: import('./builder-grid.js').Box) => import('./builder-grid.js').Box} fn @param {number[] | null} focus
   */
  async #crossEdit(fn, focus) {
    const box = this.#box;
    if (!box) return;
    this.#setText(specOf(fn(box)));
    this._cross = null;
    await this.updateComplete;
    /** @type {HTMLElement | null} */ (this.renderRoot.querySelector(focus ? `section.cell[data-cell="${focus.join('.')}"] .build` : '.cell-head .build'))?.focus();
  }

  /**
   * A cell's cross, over it (editing): an arm towards each side cuts it in two that way (a new « Emplacement » there; not
   * past 12 cells nor the grammar's depth: said why), the middle moves it before or after among its neighbours, takes
   * it out (its room to its neighbour; never the last), closes. Échap closes too.
   * @param {number[]} path @param {string} title
   */
  #cross(path, title) {
    const key = path.join('.');
    const box = this.#box;
    const siblings = /** @type {ListNode} */ (nodeAt(this.#shown.tree, path.slice(0, -1))).kids.length;
    const at = path[path.length - 1];
    const dir = this.#narrow ? 'col' : dirAt(path.length - 1);
    const places = box ? placesOf(box) : 0;
    return html`<div class="cross" role="group" aria-label=${`« ${title} » : la diviser, la déplacer ou la retirer`}
        @keydown=${(/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.#toggleCross(key); } }}>
      ${GfLayout.ARMS.map(a => {
        const ok = Boolean(box && canSplit(box, path, a.side));
        return html`<button type="button" class="arm ${a.side}" data-side=${a.side} ?disabled=${!ok}
          aria-label=${`Ajouter un emplacement ${a.label.toLowerCase()} de « ${title} »`}
          title=${ok ? `Ajouter un emplacement ${a.label.toLowerCase()}` : !box ? 'Corrigez d’abord le texte de la disposition' : places >= 12 ? '12 cases au plus' : 'Pas plus de découpes dans ce sens ici'}
          @click=${() => this.#crossEdit(b => { const r = split(b, path, a.side); this.#added = r.added; return r.root; }, null).then(() => this.#focusAdded())}>${icon(a.icon)}<span class="lbl">${a.label}</span></button>`;
      })}
      <div class="mid">
        <button type="button" data-act="before" title=${dir === 'row' ? 'Vers la gauche' : 'Vers le haut'} aria-label=${`Déplacer « ${title} » avant`} ?disabled=${at === 0}
          @click=${() => this.#move(path, -1)}>${icon(dir === 'row' ? 'chevron-left' : 'chevron-up')}</button>
        <button type="button" class="del" data-act="remove" ?disabled=${!box || places <= 1} title="Retirer cette case (sa place revient à sa voisine)"
          aria-label=${`Retirer « ${title} »`} @click=${() => this.#crossEdit(b => removeBox(b, path), null)}>${icon('trash3')}</button>
        <button type="button" data-act="after" title=${dir === 'row' ? 'Vers la droite' : 'Vers le bas'} aria-label=${`Déplacer « ${title} » après`} ?disabled=${at >= siblings - 1}
          @click=${() => this.#move(path, 1)}>${icon(dir === 'row' ? 'chevron-right' : 'chevron-down')}</button>
        <button type="button" class="close" title="Fermer" aria-label="Fermer" @click=${() => this.#toggleCross(key)}>${icon('x-lg')}</button>
      </div>
    </div>`;
  }

  /** A cell moved among its neighbours (−1: before, +1: after), its build button focused. @param {number[]} path @param {number} by */
  async #move(path, by) {
    this.#setText(serialize(moveAt(this.#layout.tree, path, by)));
    this._cross = null;
    await this.updateComplete;
    const to = [...path.slice(0, -1), path[path.length - 1] + by].join('.');
    /** @type {HTMLElement | null} */ (this.renderRoot.querySelector(`section.cell[data-cell="${to}"] .build`))?.focus();
  }

  /** The place a cross just added (its path). @type {number[] | null} */
  #added = null;

  /** The place just added: its first tile focused. */
  async #focusAdded() {
    const added = this.#added;
    this.#added = null;
    if (added) this.#focusTiles(added.join('.'));
  }

  /** A place's tiles: the first focused, once drawn. @param {string} key */
  async #focusTiles(key) {
    await this.updateComplete;
    const picker = /** @type {any} */ (this.renderRoot.querySelector(`section.cell[data-cell="${key}"] gf-block-picker[inline]`));
    await picker?.updateComplete;
    picker?.focusFirst();
  }

  // ── The block picker ─────────────────────────────────────────────────────────────────────────────────────

  /** The room of the cell picked (px), measured when its picker opened. @type {{ w: number, h: number } | null} */
  #pickRoom = null;

  /** A cell's picker opened, or closed when it is open. @param {string} key */
  #openPick(key) {
    if (this._pick === key) { this.#closePick(); return; }
    const rect = this.renderRoot.querySelector(`section.cell[data-cell="${key}"]`)?.getBoundingClientRect();
    this.#pickRoom = rect ? { w: rect.width, h: rect.height } : null;
    this._pick = key;
    this._cross = null;
    this.picking = true;
  }

  /** The picker closed: its button focused again (`focus`). @param {boolean} [focus] */
  async #closePick(focus = true) {
    const key = this._pick;
    if (key === null) return;
    this._pick = null;
    this.picking = false;
    if (!focus) return;
    await this.updateComplete;
    /** @type {HTMLElement | null} */ (this.renderRoot.querySelector(`section.cell[data-cell="${key}"] .cell-head .pick`) ?? this.renderRoot.querySelector('.cell-head .pick'))?.focus();
  }

  /** The layout changed by the picker: written at once (no new entry). @param {(t: ListNode) => ListNode} fn */
  #pickEdit(fn) { this.#setText(serialize(fn(this.#layout.tree))); }

  /** The picker of the cell open: its changes written at once, the cell keeping its share. */
  #picker() {
    const key = this._pick;
    if (key === null) return nothing;
    const tree = this.#shown.tree;
    const path = key.split('.').map(Number);
    const n = nodeAt(tree, path);
    if (!n || n.t !== 'cell') return nothing;
    const all = cellsOf(tree);
    const index = all.findIndex(c => c.path.join('.') === key);
    // Docked to the screen's height (under the app's header; a phone: above its bottom bar).
    return html`<gf-block-picker style=${pickerBounds(this)} .cell=${cellText(n)} .label=${'Case ' + (index + 1)} .room=${this.#pickRoom}
      .others=${all.filter(c => c.path.join('.') !== key).map(c => cellText(c.cell))} .plant=${this.#state.live.plant}
      clear-label="Changer de bloc"
      @change=${(/** @type {CustomEvent} */ e) => {
        const next = cellOf(e.detail.text);
        if (next) this.#pickEdit(t => replaceAt(t, path, { ...next, size: n.size }));
      }}
      @clear=${() => { this.#pickEdit(t => replaceAt(t, path, makeCell(SLOT, null, [], n.size))); this.#closePick(false); this.#focusTiles(key); }}
      @close=${() => this.#closePick()}></gf-block-picker>`;
  }

  // ── Rendering ────────────────────────────────────────────────────────────────────────────────────────────

  /** A node's name, for a grip's label: a cell's title, a list's first cell's. @param {LayoutNode} n @param {number[]} path @returns {string} */
  #name(n, path) {
    if (n.t === 'list') return this.#name(n.kids[0], [...path, 0]);
    const r = this.#shown.cells.get(path.join('.'));
    return '« ' + (r?.title ?? n.name) + ' »';
  }

  /**
   * A list: its parts side by side or one under the other, a grip between two. `col`: every list one under the other (narrow).
   * @param {ListNode} n @param {number[]} path @param {number} depth @param {boolean} col
   */
  #split(n, path, depth, col) {
    const dir = col ? 'col' : dirAt(depth);
    const key = path.join('.');
    const sh = shares(n, savedShares(this.#shown.shape, key));
    const cells = this.#shown.cells;
    // A part hidden (vide=masque, nothing to show) or folded (replier): its share to the others; the grips beside it
    // wait for it to come back (a grip moves the shares of the two parts it lies between).
    const hidden = n.kids.map((k, j) => this.#nodeHidden(k, [...path, j]));
    const folded = n.kids.map((k, j) => k.t === 'cell' && this.#isFolded([...path, j].join('.')));
    // The shares of the parts in sight, as they would be alone (growing by less than the whole, they would leave room unused).
    const inSight = sh.reduce((a, x, j) => a + (hidden[j] || folded[j] ? 0 : x), 0) || 1;
    const grow = hidden.some(Boolean) || folded.some(Boolean) ? sh.map(x => x / inSight) : sh;
    return html`<div class="split ${dir}" data-split=${key}>${repeat(n.kids, (k, j) => (k.t === 'list' ? 'l:' : 'c:') + [...path, j].join('.') + (k.t === 'cell' ? ':' + k.name + '.' + (k.view ?? '') : ''), (k, j) => html`
      ${j && !hidden[j] && !hidden[j - 1] && !folded[j] && !folded[j - 1] ? shareGrip({ dir, sizes: sh, i: j, part: 'part', label: `Redimensionner ${this.#name(n.kids[j - 1], [...path, j - 1])} et ${this.#name(k, [...path, j])}`,
        set: s => this.#setShares(path, s) }) : nothing}
      <div class="part ${folded[j] ? 'folded' : ''}" ?hidden=${hidden[j]} style=${folded[j] ? 'flex: 0 0 auto' : `flex: ${grow[j]} 1 0; ` + (dir === 'row' ? `min-width: ${least(k, cells, [...path, j], 'col')}px` : `min-height: ${least(k, cells, [...path, j], col ? 'col' : 'row', 'h', col)}px`)}>${k.t === 'list' ? this.#split(k, [...path, j], depth + 1, col) : this.#cell(k, [...path, j])}</div>`)}</div>`;
  }

  /**
   * A cell: its head (the icon and mark of its tab in the menu of columns — registry.js#cellIcon, #cellMark: a block of
   * the sheet its own, an unknown component a question —, its title, what it shows now, its tools while editing) and its
   * component. @param {CellNode} n @param {number[]} path
   */
  #cell(n, path) {
    const key = path.join('.');
    const r = /** @type {Resolved} */ (this.#shown.cells.get(key));
    const group = this.#groupOf(r);
    const { state: s, channel } = this.#group(group);
    const results = channel.results;
    const first = results.items[0] ? { id: results.items[0].id, name: results.items[0].vernacularName || results.items[0].scientificName } : null;
    const id = r.known ? r.spec.id : null;
    const mark = cellMark(r);
    // Its plant: its own (plante=, a pin before its names), else the current one.
    const fixed = r.known && r.params.plante ? /** @type {number} */ (r.params.plante) : null;
    const info = fixed ? this.#namesOf(fixed) : s.plantInfo && s.plantInfo.id === s.live.plant ? s.plantInfo : null;
    const count = (/** @type {number} */ n) => `${n.toLocaleString('fr-FR')} espèce${n > 1 ? 's' : ''}`;
    const whole = id === 'results' && r.known && r.params.zone === false;
    const sub = !r.known ? 'à corriger'
      : id === 'map' || id === 'place' ? scopeWords(s)
      : whole ? (s.whole?.key === s.wholeFor && s.whole ? count(s.whole.total) + ' · toute la France' : '')
      : id === 'search' || id === 'results' || id === 'filters' ? (this.#store.state.status === 'ready' ? count(results.total) + (results.inZone ? ' · dans la vue' : '') : '')
      : info ? html`${fixed ? html`<span class="pin" title=${`Plante fixée (plante=${fixed}) : cette case ne suit pas la plante courante`}>${icon('pin-angle-fill')}<span class="visually-hidden">Plante fixée :</span></span> ` : nothing}${info.name}${info.name !== info.sci ? html` · <i>${info.sci}</i>` : nothing}` : '';
    // The frame (registry.js#FRAME): its head whole, its title alone, or none (but while editing: the tools are there);
    // the actions of its head; large over the layout, folded to its head, hidden while it has nothing to show.
    const editing = this.editing;
    const head = !r.known || editing ? 'oui' : /** @type {string} */ (r.params.tete);
    const acts = r.known && head !== 'non' ? /** @type {string[]} */ (r.params.actions) : [];
    const max = this.#isMax(key), folded = this.#isFolded(key);
    // An « Emplacement » numbered in reading order (its name told apart from the others').
    const title = r.known && r.spec.empty && !r.params.titre ? `${r.title} ${cellsOf(this.#shown.tree).findIndex(c => c.path.join('.') === key) + 1}` : r.title;
    const picking = this._pick === key;
    const crossed = editing && this._cross === key;
    // Being modified: its content (the picker) and its cross.
    const pick = !editing ? nothing : html`<button class="icon-btn pick" type="button" data-act="choisir" aria-expanded=${picking ? 'true' : 'false'} title="Choisir le contenu"
      aria-label=${'Choisir le contenu de « ' + title + ' »'} @click=${() => this.#openPick(key)}>${icon('sliders')}</button><button class="icon-btn build" type="button" data-act="construire" aria-expanded=${crossed ? 'true' : 'false'} title="Diviser, déplacer ou retirer cette case"
        aria-label=${'Construire : diviser, déplacer ou retirer « ' + title + ' »'} @click=${() => this.#toggleCross(key)}>${icon('tools')}</button>`;
    const empty = r.known && r.spec.empty;
    const views = r.known && r.spec.id === 'results' && head === 'oui' ? this.#viewSwitch(key, r, title) : nothing;
    const links = editing ? this.#links(key, r, title) : nothing;
    // Its group, when the layout has several: a letter in its colour (the cells of one group share zone, plant, search).
    const badge = r.known && !r.spec.empty && this.#groups().length > 1
      ? html`<span class="cell-group" data-group=${group} title=${`Groupe ${group.toUpperCase()} : sa zone, sa plante, sa période et sa recherche`}
          aria-label=${'Groupe ' + group.toUpperCase()}>${group.toUpperCase()}</span>` : nothing;
    const actions = acts.length ? html`<span class="cell-acts" role="group" aria-label=${'Actions de « ' + title + ' »'}>
        ${acts.includes('partager') ? html`<button class="icon-btn" type="button" data-act="partager" title=${this._cellCopied === key ? 'Lien copié' : 'Partager cette case seule (le même état)'}
          aria-label=${this._cellCopied === key ? 'Lien copié' : `Partager « ${title} » seule`} @click=${() => this.#shareCell(n, key, r)}>${icon(this._cellCopied === key ? 'check-lg' : 'share')}</button>` : nothing}
        ${acts.includes('replier') && !max ? html`<button class="icon-btn" type="button" data-act="replier" aria-expanded=${folded ? 'false' : 'true'} title=${folded ? 'Déplier' : 'Replier'}
          aria-label=${(folded ? 'Déplier « ' : 'Replier « ') + title + ' »'} @click=${() => this.#fold(key)}>${icon(folded ? 'chevron-down' : 'chevron-up')}</button>` : nothing}
        ${acts.includes('agrandir') ? html`<button class="icon-btn" type="button" data-act="agrandir" aria-pressed=${max ? 'true' : 'false'} title=${max ? 'Revenir à l’écran (Échap)' : 'Agrandir'}
          aria-label=${(max ? 'Revenir à l’écran depuis « ' : 'Agrandir « ') + title + ' »'} @click=${() => this.#maximize(max ? null : key)}>${icon(max ? 'fullscreen-exit' : 'arrows-fullscreen')}</button>` : nothing}
      </span>` : nothing;
    return html`<section class="cell ${this._flash === key ? 'flash' : ''} ${max ? 'maxed' : ''} ${folded ? 'folded' : ''} ${picking ? 'picked' : ''}" data-cell=${key} data-comp=${r.known ? r.spec.id + (r.view ? '.' + r.view.key : '') : 'unknown'}
      data-head=${head} aria-label=${title}>
      ${head === 'non' ? nothing : head === 'simple' ? html`<header class="cell-head"><h2>${title}</h2><span class="spacer"></span>${pick}${actions}</header>`
        : html`<header class="cell-head"><h2>${icon(cellIcon(r))} ${title}${mark ? html`<b class="cell-mark" aria-hidden="true" title=${mark.label} data-mark=${mark.short}></b>` : nothing}</h2><span class="sub">${sub}</span>
        ${badge}${links}${views}${pick}${actions}</header>`}
      <div class="cell-body" ?hidden=${folded}>${empty ? this.#slot(key) : renderCell(r, { state: s, channel: group === 'a' ? null : channel, view: this.#store.state.mode, plant: s.live.plant, first, editing })}
        ${crossed ? this.#cross(path, title) : nothing}</div>
    </section>`;
  }

  /**
   * How a cell is wired to the others (registry.js#linksOf), in its head being modified: a chip each — the zone, the
   * search, the period, the current plant —, lit when it follows (and changes) it; touched, it detaches the cell or
   * attaches it again (the setting that does it, written). One that cannot be changed is said, never a switch.
   * @param {string} key @param {Resolved} r @param {string} title
   */
  #links(key, r, title) {
    const all = linksOf(r);
    if (!all.length) return nothing;
    const ICONS = /** @type {const} */ ({ zone: 'geo-alt', recherche: 'search', periode: 'sun-fill', plante: 'flower1', liste: 'list-ul' });
    const plant = this.#state.live.plant;
    return html`<span class="cell-links" role="group" aria-label=${'Liens de « ' + title + ' »'}>${all.map(l => {
      const words = `${LINKS[l.link]} : ${l.on ? 'reliée' : 'détachée'} — ${l.why}`;
      if (!l.toggle) return html`<span class="link-chip" data-link=${l.link} data-on=${String(l.on)} role="img" aria-label=${words} title=${words}>${icon(ICONS[l.link])}</span>`;
      const values = Object.fromEntries(Object.entries(l.toggle).map(([k, v]) => [k, v === CURRENT ? plant : v]));
      const can = !Object.values(values).some(v => v === null && Object.values(l.toggle ?? {}).includes(CURRENT));
      return html`<button type="button" class="link-chip" data-link=${l.link} aria-pressed=${String(l.on)} ?disabled=${!can} aria-label=${words}
        title=${can ? words + (l.on ? ' (toucher : la détacher)' : ' (toucher : la relier)') : words + ' — choisissez d’abord une plante'}
        @click=${() => this.#setCellParam(key, values)}>${icon(ICONS[l.link])}</button>`;
    })}</span>`;
  }

  /**
   * A results cell's list / grid switch, in its head: the presentation shown (by its width when it says none), kept in
   * the layout (view=). @param {string} key @param {Resolved} r @param {string} title
   */
  #viewSwitch(key, r, title) {
    const view = r.known ? r.params.view : 'auto';
    const el = /** @type {any} */ (this.renderRoot.querySelector?.(`section.cell[data-cell="${key}"] dl-results`));
    const grid = view === 'grid' || (view !== 'list' && Boolean(el?.grid));
    const set = (/** @type {'list' | 'grid'} */ v) => this.#setCellParam(key, { view: v });
    return html`<span class="cell-views" role="group" aria-label=${'Présentation de « ' + title + ' »'}>
      <button class="icon-btn" type="button" data-view="list" aria-pressed=${String(!grid)} title="En liste" aria-label="En liste" @click=${() => set('list')}>${icon('list-ul')}</button>
      <button class="icon-btn" type="button" data-view="grid" aria-pressed=${String(grid)} title="En grille (colonnes triables)" aria-label="En grille" @click=${() => set('grid')}>${icon('table')}</button>
    </span>`;
  }

  /**
   * An « Emplacement »: a place to build a component in — the block picker's first level in it (its tiles, sized to
   * the place; then the intents of the one chosen); chosen, the place is that component. @param {string} key
   */
  #slot(key) {
    const tree = this.#layout.tree;
    const all = cellsOf(tree);
    const path = key.split('.').map(Number);
    const index = all.findIndex(c => c.path.join('.') === key);
    return html`<gf-block-picker inline .cell=${SLOT} .label=${'Case ' + (index + 1)} .others=${all.filter(c => c.path.join('.') !== key).map(c => cellText(c.cell))}
      @change=${(/** @type {CustomEvent} */ e) => {
        const next = cellOf(e.detail.text), n = nodeAt(this.#layout.tree, path);
        if (next && n) this.#setText(serialize(replaceAt(this.#layout.tree, path, { ...next, size: n.size })));
      }}></gf-block-picker>`;
  }

  /**
   * A column's cells in reading order (left to right, top to bottom), each with its whole name, its icon and its mark
   * (registry.js: « Fiche (Épuré) », card-text, É; « Fiche › Carte », pin-map).
   * @param {LayoutNode} n @param {number[]} path @returns {import('./registry.js').MenuCell[]}
   */
  #cellsOf(n, path) {
    if (n.t === 'list') return n.kids.flatMap((k, j) => this.#cellsOf(k, [...path, j]));
    const r = /** @type {Resolved} */ (this.#shown.cells.get(path.join('.')));
    return [{ name: cellName(r), icon: cellIcon(r), mark: cellMark(r)?.short ?? null }];
  }

  /** The tab shown (narrow), as last drawn: the one asked, within the columns there are. */
  #active = 0;

  /**
   * Narrow: the columns as a menu of icons on top — each its cells' icons (registry.js#menuLooks), its whole name read
   * (the text of the tab, hidden on a phone's menu, beside the icons where there is room) and shown on hover (title) —
   * and as tab panels, each one's rows one under the other. The tab's only text is its name: the marks, « +n » and a
   * number are drawn by the style (data-…), so the title, the same words, is never read again as a description.
   * @param {ListNode} tree
   */
  #tabs(tree) {
    const n = tree.kids.length;
    const active = this.#active = Math.min(this._tab, n - 1);
    const swipe = { handleEvent: (/** @type {TouchEvent} */ e) => this.#swipe(e), passive: true };
    const columns = tree.kids.map((k, j) => this.#cellsOf(k, [j]));
    const items = menuLooks(columns);
    const named = this._named;
    return html`<div class="tabs ${named ? 'named' : ''}" role="tablist" aria-label="Colonnes" @scroll=${(/** @type {Event} */ e) => edges(/** @type {HTMLElement} */ (e.currentTarget))}>${items.map((m, j) => {
      return html`<button type="button" role="tab" class="tab ${this._brought === j ? 'brought' : ''}" id=${'tab-' + j} aria-controls=${'panel-' + j}
        aria-selected=${j === active ? 'true' : 'false'} tabindex=${j === active ? '0' : '-1'} title=${m.label} data-icons=${columns[j].map(c => c.icon).join(' ')}
        @click=${() => { this._tab = j; }} @keydown=${(/** @type {KeyboardEvent} */ e) => this.#tabKey(e, j, n)}><span class="glyphs ${m.glyphs.length + (m.more ? 1 : 0) > 1 ? 'many' : ''}" aria-hidden="true">${m.glyphs.map(g => html`<span class="glyph ${g.mark ? 'marked' : ''}" style=${g.mark ? `--chars: ${g.mark.length}` : nothing} data-icon=${g.icon}>${icon(g.icon)}${g.mark ? html`<b class="mark" data-mark=${g.mark}></b>` : nothing}</span>`)}${m.more ? html`<span class="more" data-more=${m.more}></span>` : nothing}</span><span class="name ${named ? '' : 'visually-hidden'}">${m.label}</span>${m.nth ? html`<b class="nth" aria-hidden="true" data-nth=${m.nth}></b>` : nothing}</button>`;
    })}</div>
      ${repeat(tree.kids, (k, j) => (k.t === 'list' ? 'l:' : 'c:') + j + (k.t === 'cell' ? ':' + k.name + '.' + (k.view ?? '') : ''), (k, j) => html`<div class="tabpanel" role="tabpanel" id=${'panel-' + j} aria-labelledby=${'tab-' + j} ?hidden=${j !== active}
          @touchstart=${swipe} @touchend=${swipe} @touchcancel=${swipe}>
        ${k.t === 'list' ? this.#split(k, [j], 1, true) : html`<div class="split col"><div class="part" style="flex: 1 1 0">${this.#cell(k, [j])}</div></div>`}</div>`)}`;
  }

  /**
   * ← → between the tabs. The focus follows without scrolling the menu itself: the browser's jump to it would stop the
   * smooth scroll that brings the tab into sight (updated() → #tabInSight), and leave it at the edge, or past it.
   * @param {KeyboardEvent} e @param {number} j @param {number} n
   */
  #tabKey(e, j, n) {
    const to = e.key === 'ArrowRight' ? (j + 1) % n : e.key === 'ArrowLeft' ? (j - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    this._tab = to;
    this.updateComplete.then(() => /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('#tab-' + to))?.focus({ preventScroll: true }));
  }

  /**
   * Narrow: each name on screen beside its icons when every item has the room for its icons and a few letters, in a
   * window or a tablet (the names the text tabs used to show); a phone's menu, icons only — a finger has no hover: the
   * names are read, and said in the cells' heads. Measured once drawn (the icons are as wide either way).
   */
  #nameRoom() {
    const bar = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.tabs'));
    if (!bar) return;
    const icons = Math.max(0, ...[...bar.querySelectorAll('.glyphs')].map(g => g.getBoundingClientRect().width));
    const named = (this._w >= BP.phone || this.#fine.matches) && bar.clientWidth / bar.childElementCount - icons - TAB_PAD >= NAME_ROOM;
    if (named !== this._named) this._named = named;
  }

  /** The menu and the tab last brought into its sight, and the width (and names) then: not again while they stay (the hand may scroll the menu). */
  #inSight = { bar: /** @type {Element | null} */ (null), key: '' };

  /** Narrow: the tab shown in sight in the menu (scrolled to, smoothly once the menu is there), its edges faded where more waits. */
  #tabInSight() {
    const bar = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.tabs'));
    const tab = /** @type {HTMLElement | null} */ (bar?.querySelector('[aria-selected="true"]'));
    if (!bar || !tab) return;
    const key = this.#active + ':' + bar.clientWidth + ':' + bar.childElementCount + ':' + this._named;
    if (this.#inSight.bar === bar && this.#inSight.key === key) { edges(bar); return; }
    const fresh = this.#inSight.bar !== bar;
    this.#inSight = { bar, key };
    // A neighbour's edge left in sight on the side scrolled toward, under the faded edge: the menu says it goes on, the
    // tab shown is whole and clear.
    const room = Math.min(FADE, Math.max(0, (bar.clientWidth - tab.offsetWidth) / 2));
    const left = tab.offsetLeft < bar.scrollLeft + room ? tab.offsetLeft - room
      : tab.offsetLeft + tab.offsetWidth > bar.scrollLeft + bar.clientWidth - room ? tab.offsetLeft + tab.offsetWidth - bar.clientWidth + room : null;
    if (left !== null) bar.scrollTo({ left, behavior: fresh || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    edges(bar);
  }

  /** A finger on a tab panel: where and when it touched, unless on what moves sideways itself. @type {{ x: number, y: number, t: number } | null} */
  #touch = null;

  /**
   * Narrow: a finger swiped sideways on a tab panel, quickly and mostly sideways, shows the neighbour tab (to the left:
   * the next one). Not from what moves sideways itself — a map, photos, the cards, a slider, a field, a grip, anything
   * that scrolls sideways or takes the finger (touch-action) — nor from a screen's edge (the system's « back »).
   * @param {TouchEvent} e
   */
  #swipe(e) {
    if (e.type === 'touchstart') {
      const panel = /** @type {HTMLElement} */ (e.currentTarget);
      const t = e.touches[0];
      const path = e.composedPath();
      const own = path.slice(0, Math.max(0, path.indexOf(panel))).some(el => el instanceof HTMLElement && (el.matches(SWIPE_OWN)
        || (el.scrollWidth > el.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(el).overflowX)) || takesFinger(getComputedStyle(el).touchAction)));
      this.#touch = e.touches.length === 1 && !own && t.clientX > 24 && t.clientX < innerWidth - 24 ? { x: t.clientX, y: t.clientY, t: e.timeStamp } : null;
      return;
    }
    const s = this.#touch;
    this.#touch = null;
    if (!s || e.type !== 'touchend' || e.touches.length) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (e.timeStamp - s.t > 700 || Math.abs(dx) < 64 || Math.abs(dx) < 2 * Math.abs(dy) || String(getSelection() ?? '')) return;
    const to = this.#active + (dx < 0 ? 1 : -1);
    if (to >= 0 && to < this.#shown.tree.kids.length) this._tab = to;
  }

  // ── In use or being modified: the bar, the edit strip; the home ─────────────────────────────────────────────

  /** « Modifier »: this screen, being modified — one entry (Back leaves it), marked with the depth it was entered from. @param {{ advanced?: boolean }} [o] */
  #modify({ advanced = false } = {}) {
    if (advanced && this.#layout.errors.length) this._advanced = true;
    pushHash(href.layout(this.#written, this.#search(), true), { gfEditFrom: { from: depth(), start: depth() + 1 } });
  }

  /** « Terminé »: a text still resting applied, then back to where « Modifier » was touched; opened modified: replaced in place. */
  #done() {
    if (this.#typing) { clearTimeout(this.#typing); this.#typing = 0; this.#setText(this._field); }
    // No cell left: still modified (the strip says why).
    if (!this.#layout.tree.kids.length) return;
    closeTo(this.#editMark ?? { from: null, start: depth() }, this.#usageHref());
  }

  /** « Avancé » typed in, its keys not at rest yet. @type {any} */
  #typing = 0;

  /** « Avancé » typed in: the layout follows once the keys rest. @param {string} text */
  #type(text) {
    this._field = text;
    clearTimeout(this.#typing);
    this.#typing = setTimeout(() => { this.#typing = 0; this.#setText(text); }, 300);
  }

  /** « Avancé : texte » unfolded (its field focused, once drawn) or folded (⋯ focused again). */
  async #toggleAdvanced() {
    this._advanced = !this._advanced;
    await this.updateComplete;
    /** @type {HTMLElement | null} */ (this.renderRoot.querySelector(this._advanced ? '#layout-text' : '.more-menu summary'))?.focus();
  }

  /** Partager: the screen in use (no edit=1, even being modified). */
  async #share() {
    const r = await share({ title: this.pageTitle ?? 'Écran sur mesure — GeoFlora', url: this.#usageHref() });
    if (r === 'copied') { this._copied = true; setTimeout(() => { this._copied = false; }, 2000); }
  }

  /** What is wrong, said: the text's errors (where), then the cells' — but a layout with no cell, which the strip says its own way. */
  #problems() {
    const l = this.#shown, none = !l.tree.kids.length;
    return [...l.errors.filter(e => !none || !e.message.startsWith('Disposition vide')).map(e => `${e.message} (caractère ${e.at + 1})`), ...l.problems.map(p => p.message)];
  }

  /**
   * The bar: the screen's heading (its title, else « Écran sur mesure »), « Modifier ⇄ Terminé » (one button, pressed
   * while modified, its word always shown; no « Terminé » for a layout with no cell), Partager, ⋯.
   */
  #bar() {
    const editing = this.editing, title = this.#state.live.title ?? 'Écran sur mesure';
    const empty = !this.#shown.tree.kids.length;
    return html`<div class="bar">
      <h1 class="app" title=${title}>${icon('window-desktop')} <span>${title}</span></h1>
      <span class="spacer"></span>
      <button type="button" class="toggle" data-act="modifier" aria-pressed=${String(editing)} ?disabled=${editing && empty}
        title=${!editing ? 'Modifier cet écran : ses cases, leur contenu, son titre' : empty ? 'Écrivez d’abord au moins une case' : 'Terminer la modification (Retour aussi)'}
        @click=${() => editing ? this.#done() : this.#modify()}>${icon(editing ? 'check-lg' : 'pencil')} <span>${editing ? 'Terminé' : 'Modifier'}</span></button>
      <button class="icon-btn" type="button" data-act="share" aria-label=${this._copied ? 'Lien copié' : 'Partager ce lien'}
        title=${this._copied ? 'Lien copié' : 'Partager ce lien (l’écran tel quel : sa plante, sa zone, sa recherche)'} @click=${() => this.#share()}>${icon(this._copied ? 'check-lg' : 'share')}</button>
      ${this.#more()}
    </div>`;
  }

  /**
   * ⋯, the screen's options: in use, « Composer un écran » (the home); being modified, « Changer de modèle » (the home:
   * Back gives this screen back), « Tailles par défaut », « Avancé : texte ». Échap closes it, its button focused again;
   * an item closes it.
   */
  #more() {
    const close = (/** @type {Event} */ e) => /** @type {HTMLElement} */ (e.currentTarget).closest('details')?.removeAttribute('open');
    const esc = (/** @type {KeyboardEvent} */ e) => {
      const d = /** @type {HTMLDetailsElement} */ (e.currentTarget);
      if (e.key !== 'Escape' || !d.open) return;
      e.preventDefault();
      d.removeAttribute('open');
      d.querySelector('summary')?.focus();
    };
    return html`<details class="more-menu" @keydown=${esc}><summary aria-label="Plus d’options" title="Plus d’options">${icon('three-dots')}</summary>
      <div class="menu" role="group" aria-label="Options de l’écran">${!this.editing
        ? html`<a href=${href.layout('')} @click=${close}>${icon('plus-lg')} Composer un écran</a>`
        : html`<a href=${href.layout('')} title="Partir d’une autre grille ou d’un autre modèle" @click=${close}>${icon('arrow-counterclockwise')} Changer de modèle</a>
          <button type="button" data-act="sizes" @click=${(/** @type {Event} */ e) => { close(e); this.#resetSizes(); }}>${icon('arrows-collapse')} Tailles par défaut</button>
          <button type="button" data-act="text" aria-pressed=${String(this._advanced)} @click=${(/** @type {Event} */ e) => { close(e); this.#toggleAdvanced(); }}>${icon('list-nested')} Avancé : texte</button>`}</div>
    </details>`;
  }

  /** In use, what is wrong with the screen (its text, its cells), counted; « Voir et corriger »: modified, the text unfolded when it is the text. */
  #remarksLine() {
    const l = this.#shown, n = l.errors.length + l.problems.length;
    if (!n || (!l.tree.kids.length && !l.errors.length)) return nothing;
    return html`<p class="remarks" role="status">${icon('exclamation-triangle-fill')} ${n} remarque${n > 1 ? 's' : ''} sur cet écran.
      <button class="link" type="button" @click=${() => this.#modify({ advanced: true })}>Voir et corriger</button></p>`;
  }

  /** Being modified, under the bar: the title (the address replaced as it is typed), the preview, how to build, what is wrong, « Avancé ». */
  #editStrip() {
    const l = this.#shown, problems = this.#problems(), phone = this._preview;
    const empty = !l.tree.kids.length;
    return html`<div class="edit" role="region" aria-label="Modifier l’écran">
      <div class="meta">
        <label for="layout-title">Titre <input id="layout-title" type="text" maxlength="80" autocomplete="off"
          placeholder="Sans titre (par exemple : Orchidées de la colline de Mirabel)" .value=${this._title}
          @input=${(/** @type {any} */ e) => { this._title = e.target.value; this.#state.set({ title: cleanText(e.target.value) }, 'replace'); }} /></label>
        <div class="segmented preview" role="group" aria-label="Aperçu">
          <button type="button" data-preview="computer" aria-pressed=${String(!phone)} @click=${() => { this._preview = false; }}>${icon('window-desktop')} Ordinateur</button>
          <button type="button" data-preview="phone" aria-pressed=${String(phone)} @click=${() => { this._preview = true; }}>${icon('phone')} Téléphone</button>
        </div>
      </div>
      <p class="hint">${icon('sliders')} choisit le bloc d’une case et le règle ; ${icon('tools')} la divise, la déplace ou la retire ; les poignées règlent les tailles.</p>
      ${empty ? html`<p class="problems" role="alert">Disposition vide : écrivez au moins une case (par exemple <code>[map,search]</code>), ou partez d’un modèle (⋯ › « Changer de modèle »).</p>` : nothing}
      ${problems.length ? html`<ul class="problems" role="alert">${problems.map(p => html`<li>${p}</li>`)}</ul>` : nothing}
      ${this._advanced ? this.#advanced() : nothing}
    </div>`;
  }

  /** « Avancé : le texte de la disposition »: typed (read once the keys rest), read live as the address will write it; how to write it. */
  #advanced() {
    const l = this.#shown;
    return html`<section class="advanced" aria-labelledby="advanced-h">
      <div class="head"><h2 id="advanced-h">Avancé : le texte de la disposition</h2>
        <button class="icon-btn" type="button" aria-label="Fermer le texte" title="Fermer" @click=${() => this.#toggleAdvanced()}>${icon('x-lg')}</button></div>
      <label for="layout-text">La disposition (texte, comme dans l’adresse)</label>
      <textarea id="layout-text" spellcheck="false" autocomplete="off" .value=${this._field} @input=${(/** @type {any} */ e) => this.#type(e.target.value)}></textarea>
      ${l.errors.length ? nothing : html`<p class="ok" role="status">Aperçu en direct. Lue ainsi : <code>${l.text}</code></p>`}
      <details><summary>Comment l’écrire</summary>
        <p><code>[a,b,c]</code> : trois colonnes ; <code>[a,[b,c]]</code> : la 2<sup>e</sup> colonne coupée en deux lignes ; un niveau de plus coupe une ligne en colonnes.
          <code>@30</code> après une cellule ou une liste : sa part en %. Paramètres entre parenthèses : <code>map(r=2km,base=plan)</code>, <code>results(grid)</code>, <code>search(filters=1)</code>,
          <code>media(mosaic)</code>, <code>plant(scientific)</code>. Un bloc de la fiche seul : <code>plant.wikipedia</code>, <code>plant.calendar</code>, <code>plant.uses</code>…
          Composants : ${COMPONENTS.map((c, i) => html`${i ? ', ' : ''}<code>${c.id}</code> (${c.title})`)}.</p>
      </details>
    </section>`;
  }

  /** No cell to draw: said in use; being modified, the strip says it. */
  #noCell() {
    return this.editing ? nothing : html`<div class="placeholder quiet" role="note"><p>Aucune case lisible dans cet écran.</p></div>`;
  }

  /** The home (#/layout): what a screen of one's own is, then a grid or a model to start from, each drawn small, each opened being modified. */
  #homeView() {
    const card = (/** @type {import('./models.js').Model} */ m) => html`<a class="choice" href=${href.layout(m.spec, '', true)}
      data-grid=${m.kind === 'grille' ? m.id : nothing} data-model=${m.kind === 'modele' ? m.id : nothing}><span class="thumb" aria-hidden="true">${thumb(parse(m.spec).tree, 0)}</span><b>${m.icon ? icon(m.icon) : nothing} ${m.title}</b><small>${m.about}</small></a>`;
    return html`<div class="home"><div>
      <header><h1>${icon('window-desktop')} Composer un écran</h1>
        <p>Les outils de GeoFlora côte à côte — la carte, la recherche, la fiche ou un seul de ses blocs, les photos, les cartes à swiper —, tous reliés : une plante choisie dans l’un s’affiche dans les autres. Chaque écran s’écrit dans son adresse : un lien le partage tel quel.</p></header>
      <section aria-labelledby="grids"><h2 id="grids">Partir d’une grille</h2><div class="choices">${MODELS.filter(m => m.kind === 'grille').map(card)}</div></section>
      <section aria-labelledby="models"><h2 id="models">Ou d’un modèle</h2><div class="choices">${MODELS.filter(m => m.kind === 'modele').map(card)}</div></section>
    </div></div>`;
  }

  /**
   * The home, or a screen — one skeleton in use and being modified: the bar, the edit strip (or the remarks), the stage
   * and its cells (the same template either way: Lit keeps them, maps stay loaded), the picker.
   */
  render() {
    if (this.#aliasing) return nothing;
    if (this.#home) { this.#narrow = false; return this.#homeView(); }
    const s = this.#shown, tree = s.tree, w = this._w, editing = this.editing;
    const narrow = this.#narrow = w > 0 && tree.kids.length > 1 && (w < BP.phone || w < least(tree, s.cells, [], 'row'));
    this.#hidden = this.#hiddenCells(narrow);
    return html`${this.#bar()}
      ${editing ? this.#editStrip() : this.#remarksLine()}
      <div class="stage ${editing && this._preview ? 'phone' : ''}"><div class="body">${!w ? nothing : !tree.kids.length ? this.#noCell()
        : narrow ? this.#tabs(tree) : html`<div class="grid">${this.#split(tree, [], 0, false)}</div>`}</div></div>
      ${this.#picker()}`;
  }
}

/** What moves sideways itself, in a tab panel: a finger swiped there is its own, never a change of tab. */
const SWIPE_OWN = 'input, textarea, select, [role="slider"], [role="separator"], [draggable="true"], gf-map, dl-map, .leaflet-container, gf-media-viewer, dl-deck, ma-deck';

/** An element that takes a finger's sideways moves (touch-action: none, or vertical panning only). @param {string} action */
const takesFinger = action => action === 'none' || (/pan-y/.test(action) && !/pan-x/.test(action));

/** The menu of tabs faded on the side where more items wait, scrolled out of sight. @param {HTMLElement} bar */
function edges(bar) {
  bar.toggleAttribute('data-before', bar.scrollLeft > 1);
  bar.toggleAttribute('data-after', bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 1);
}

/** The layout of an address as text (its percent-encoding undone). @param {string} spec */
function decodeSpec(spec) {
  try { return decodeURIComponent(spec); } catch { return spec; }
}

customElements.define('gf-layout', GfLayout);
