// @ts-check
// « Disposition libre » (#/layout/<layout>?<state>): a screen made of the app's pieces, as its address says — the
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
//  - A title (?title=, state.js): a discreet line above the bar (the page's heading; narrow, above the menu of
//    columns), the page's title (« <title> · GeoFlora », a plant's sheet in a cell not naming it then) and the share's;
//    none: no line. Typed in the editor's « Titre »: the address replaced as it is typed (no new entry).
//  - « Modifier la disposition »: the layout as text (live preview, what is wrong said under it), each cell's tools
//    (its component, its parameters, a cell beside or under it, moved, removed), the ready-made ones (presets.js);
//    « Appliquer » makes it the address (a new entry: Back gives the one before).
//  - A link to a plant's sheet in a cell (a result, a look-alike in the sheet) makes it the current plant instead of
//    leaving; a block opened from the sheet (⤢) that a cell already shows: that cell, flashed.

import { LitElement, html, css, nothing, repeat } from 'lit';
import { pushHash, replaceHash } from '../core/history.js';
import { href } from '../core/router.js';
import { toHash } from '../core/query.js';
import { runSearch } from '../core/search.js';
import { plantViewOf, store, StoreController, whenReady } from '../core/store.js';
import { share } from '../core/share.js';
import { icon } from '../core/icons.js';
import { BP, MediaController } from '../core/media.js';
import { gripStyles, shareGrip } from '../core/split-grip.js';
import { ui } from '../styles/ui.js';
import { cell as makeCell, dirAt, moveAt, nodeAt, parse, removeAt, replaceAt, serialize, setShares, shapeKey, shares, splitAt } from './grammar.js';
import { cellIcon, cellMark, cellName, COMPONENTS, distanceLabel, menuLooks, resolveTree, valueText } from './registry.js';
import { cleanText, LayoutState, liveSearch, readLive, readQuery, sameLive } from './state.js';
import { forgetShares, savedShares, saveShares } from './sizes.js';
import { PRESETS } from './presets.js';
import { renderCell, revealFacet, scopeWords } from './cells.js';
import { DISTANCES } from '../miniapp/kit/cards.js';

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

/** A layout as text, read and resolved: what the screen shows. @param {string} text @returns {Shown} */
function show(text) {
  const parsed = parse(text);
  const res = resolveTree(parsed.tree);
  return { text: serialize(res.tree), tree: res.tree, cells: res.cells, errors: parsed.errors, problems: res.problems, shape: shapeKey(res.tree) };
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
    /** { name: 'layout', spec, search } (router.js). */
    route: { attribute: false },
    _w: { state: true },
    /** The tab shown, narrow. */
    _tab: { state: true },
    /** The editor open. */
    _editing: { state: true },
    /** The layout being edited (its text), previewed; null: the address'. */
    _draft: { state: true },
    /** The editor's field as typed (previewed a moment after the last key). */
    _field: { state: true },
    _copied: { state: true },
    /** The editor's « Titre » as typed (the screen's title: its clean text). */
    _titleField: { state: true },
    /** A cell flashed (a block opened from the sheet that it shows). */
    _flash: { state: true },
    /** Narrow: the tab brought by a plant chosen elsewhere (or a block opened), its icon lit a moment; -1: none. */
    _brought: { state: true },
    /** Narrow: the menu's items show their names beside their icons (#nameRoom). */
    _named: { state: true }
  };

  static styles = [ui, gripStyles, css`
    :host { display: flex; flex-direction: column; min-height: 0; min-width: 0; background: var(--gf-bg); container-type: inline-size; }
    .bar { flex: none; display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 4px 8px 4px 14px; background: var(--gf-surface); border-bottom: 1px solid var(--gf-border); min-width: 0; }
    .bar .app { margin: 0; display: flex; align-items: center; gap: 8px; font-size: 1rem; font-weight: 700; white-space: nowrap; }
    .bar .app .bi { color: var(--gf-accent); }
    /* The screen's own title (?title=): a discreet line above the bar, one line, cut by « … ». */
    .titlebar { flex: none; display: flex; align-items: center; min-height: 32px; padding: 4px 14px; min-width: 0; background: var(--gf-bg); border-bottom: 1px solid var(--gf-border); }
    .titlebar h1 { margin: 0; min-width: 0; font-size: 0.95rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar .spacer { flex: 1; }
    .bar button, .bar summary { min-height: 34px; padding: 4px 12px; font-size: 0.85rem; }
    .bar .icon-btn { width: 36px; height: 36px; padding: 0; font-size: 1rem; }
    .presets { position: relative; }
    .presets summary { list-style: none; display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-pill); cursor: pointer; background: var(--gf-surface); }
    .presets summary::-webkit-details-marker { display: none; }
    .presets ul { position: absolute; right: 0; top: calc(100% + 4px); z-index: 30; list-style: none; margin: 0; padding: 6px; width: min(360px, calc(100vw - 24px)); display: grid; gap: 2px;
      background: var(--gf-surface); border: 1px solid var(--gf-border); border-radius: 12px; box-shadow: var(--gf-shadow-float); }
    .presets a { display: grid; gap: 2px; padding: 8px 10px; border-radius: 8px; color: var(--gf-text); text-decoration: none; }
    .presets a:hover, .presets a:focus-visible { background: var(--gf-surface-2); }
    .presets a small { color: var(--gf-text-muted); }
    .remarks { flex: none; margin: 0; padding: 6px 14px; font-size: 0.85rem; background: color-mix(in srgb, var(--gf-warn, #b45309) 12%, var(--gf-surface)); }
    .body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    /* More rows than the height holds (their least heights): the page of cells scrolls, never squeezes them. */
    .grid { flex: 1; min-height: 0; display: flex; overflow-y: auto; }
    .split { flex: 1; min-width: 0; min-height: 0; display: flex; }
    .split.row { flex-direction: row; } .split.col { flex-direction: column; }
    .part { display: flex; min-width: 0; min-height: 0; }
    .part > * { flex: 1; min-width: 0; min-height: 0; }
    .cell { display: flex; flex-direction: column; background: var(--gf-surface); overflow: hidden; }
    .cell.flash { animation: flash 1.2s ease-out; }
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
    .placeholder .bi { font-size: 1.6rem; color: var(--gf-warn, #b45309); }
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
    /* The editor. */
    .editor { flex: none; display: grid; gap: 8px; padding: 10px 14px; max-height: 45%; overflow-y: auto; border-bottom: 1px solid var(--gf-border); background: var(--gf-surface-2); }
    .editor label { display: grid; gap: 4px; font-size: 0.85rem; font-weight: 600; }
    .editor textarea { min-height: 56px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9rem; }
    .editor ul.problems { margin: 0; padding-left: 18px; font-size: 0.82rem; color: var(--gf-danger); }
    .editor .ok { margin: 0; font-size: 0.82rem; color: var(--gf-text-muted); }
    .editor .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .editor .row button { min-height: 34px; padding: 4px 12px; font-size: 0.85rem; }
    .editor details { font-size: 0.82rem; color: var(--gf-text-muted); }
    .editor details code { color: var(--gf-text); }
    .editor .models { display: flex; flex-wrap: wrap; gap: 6px; }
    .editor .models button { min-height: 30px; padding: 2px 10px; font-size: 0.8rem; }
    .tools { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; width: 100%; padding: 2px 0 4px; }
    .tools select { min-height: 30px; padding: 2px 24px 2px 8px; font-size: 0.8rem; border-radius: 8px; }
    .tools button { min-height: 30px; min-width: 30px; padding: 2px 8px; font-size: 0.8rem; }
    .tools label { display: inline-flex; align-items: center; gap: 4px; font-size: 0.78rem; }
    .empty { padding: 20px 16px; overflow-y: auto; }
    .empty h2 { margin: 0 0 6px; }
    .empty ul { list-style: none; padding: 0; display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); }
    .empty li a { display: grid; gap: 4px; padding: 12px 14px; border: 1px solid var(--gf-border); border-radius: 12px; background: var(--gf-surface); color: var(--gf-text); text-decoration: none; height: 100%; }
    .empty li a:hover { border-color: var(--gf-accent); }
    .empty li code, .empty li small { font-size: 0.8rem; color: var(--gf-text-muted); word-break: break-all; }
    /* Narrow: the bar's words go (its buttons keep their names); the title is still read. */
    @container (max-width: 699px) {
      .bar .lbl { display: none; } .bar { padding-left: 10px; }
      .bar .app span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    }
  `];

  #store = new StoreController(this);
  /** A mouse (a window), not a finger: the menu of columns names its items wherever they have the room. */
  #fine = new MediaController(this, '(hover: hover) and (pointer: fine)');
  #state = new LayoutState();
  #size = new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w !== this._w) this._w = w; });

  constructor() {
    super();
    /** @type {{ name: 'layout', spec: string, search: string } | null} */
    this.route = null;
    this._w = 0;
    this._tab = 0;
    this._editing = false;
    /** @type {string | null} */
    this._draft = null;
    this._field = '';
    this._copied = false;
    this._titleField = '';
    /** @type {string | null} */
    this._flash = null;
    this._brought = -1;
    this._named = false;
    this.#state.addEventListener('change', this.#onState);
    // A link to a plant's sheet in a cell: that plant becomes the current one, the layout stays.
    this.addEventListener('click', e => {
      if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const a = /** @type {HTMLAnchorElement | undefined} */ (e.composedPath().find(n => n instanceof HTMLAnchorElement && n.hasAttribute('href')));
      const m = a && /^#\/plant\/(\d+)(?:\?|$)/.exec(a.getAttribute('href') || '');
      if (!m) return;
      e.preventDefault();
      this.#state.pick(Number(m[1]));
    });
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
    this.#size.observe(this);
    document.title = 'Disposition libre — GeoFlora';
    this.#ready = store.state.status === 'ready';
    // Back on the page (moved, not made anew): its state read again from the address.
    if (this.hasUpdated && this.route) { this.#layout = show(''); this.#follow(); }
    // Until the flora is ready the app may set the search itself (main.js: the last one): the address' comes back then.
    if (!this.#ready) {
      whenReady().then(() => {
        this.#ready = true;
        if (!this.isConnected || !this.route) return;
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
    this.#state.dispose();
    this.#state.removeEventListener('change', this.#onState);
    this.#state = new LayoutState();
    this.#state.addEventListener('change', this.#onState);
  }

  /** The flora is ready: the search's changes are the user's, the address follows them. */
  #ready = false;
  /** The search the address says (toHash), to know one changed by a cell. */
  #lastQuery = '';
  /** @type {Shown} */
  #layout = show('');
  /** The layout on screen: the draft being edited, else the address'. @type {Shown} */
  #shown = this.#layout;
  /** @type {{ text: string, value: Shown } | null} */
  #draftMemo = null;
  /** Narrow (tabs) at the last render. */
  #narrow = false;

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (changed.has('route') && this.route) this.#follow();
    if (this._draft !== null) {
      if (this.#draftMemo?.text !== this._draft) this.#draftMemo = { text: this._draft, value: show(this._draft) };
      this.#shown = this.#draftMemo.value;
    } else this.#shown = this.#layout;
  }

  /** The page's title the screen's own title gives (« Orchidées de Mirabel · GeoFlora »; null: none — a plant's sheet in a cell may name the page then). */
  get pageTitle() { const t = this.#state.live.title; return t ? t + ' · GeoFlora' : null; }

  /** The page's title last set from the screen's own title. @type {string | null} */
  #titled = null;

  updated() {
    if (this.#narrow) { this.#nameRoom(); this.#tabInSight(); }
    const page = this.pageTitle;
    if (page && document.title !== page) document.title = page;
    else if (!page && this.#titled) document.title = 'Disposition libre — GeoFlora';
    this.#titled = page;
    // The search changed by a cell (its text, a filter, the sort): the address follows, without a new entry.
    if (!this.#ready) return;
    const q = toHash(store.state.query);
    if (q !== this.#lastQuery) { this.#lastQuery = q; this.#write('replace'); }
  }

  /** The address followed (a link, Back, Forward, a reload): its layout, its state, its search. */
  #follow() {
    const route = /** @type {{ spec: string, search: string }} */ (this.route);
    const next = show(route.spec);
    const fresh = next.text !== this.#layout.text || next.errors.length !== this.#layout.errors.length;
    if (fresh) {
      this.#layout = next;
      // Another layout (a link, Back): the one being edited is left.
      if (this._editing) this.#cancel();
      // The radius a map or a place cell gives, until the address says one.
      const first = [...next.cells.values()].find(r => r.known && r.params.r != null);
      this.#state.defaultRadius = first?.known ? first.params.r : 2000;
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
    // Written as the app writes it (canonical names, its own order of words), unless it could not be read whole.
    if (!next.errors.length && fresh) queueMicrotask(() => this.#write('replace'));
  }

  /** The address of the screen now (a layout that could not be read whole: as it was typed, to be corrected). */
  #href() {
    const spec = this.#layout.errors.length && this.route ? decodeSpec(this.route.spec) : this.#layout.text;
    return href.layout(spec, liveSearch(this.#state.live, store.state.query, this.#state.radius));
  }

  /** The address follows the screen: a new entry, the same one, or not at all. @param {import('./state.js').How} how */
  #write(how) {
    if (how === 'none' || !this.route) return;
    const url = this.#href();
    if (location.hash === url) return;
    if (how === 'push') pushHash(url, {}, false); else replaceHash(url);
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
    const tabs = [...this.#shown.cells].filter(([, r]) => r.known && FOLLOWS_PLANT.has(r.spec.id)).map(([p]) => tabOf(p));
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
    if (this._draft !== null) { this.#editDraft(t => setShares(t, path, sizes)); return; }
    saveShares(this.#layout.shape, path.join('.'), sizes);
    this.#layout = show(serialize(setShares(this.#layout.tree, path, sizes)));
    this.#shown = this.#layout;
    this.#write('replace');
    this.requestUpdate();
  }

  /** Every share back to the default: the ones kept and the ones written. */
  #resetSizes() {
    forgetShares(this.#layout.shape);
    /** @param {LayoutNode} n @returns {LayoutNode} */
    const strip = n => n.t === 'cell' ? { ...n, size: null } : { ...n, size: null, kids: n.kids.map(strip) };
    this.#layout = show(serialize(/** @type {ListNode} */ (strip(this.#layout.tree))));
    if (this._draft !== null) this._draft = serialize(/** @type {ListNode} */ (strip(this.#shown.tree)));
    this.#write('replace');
    this.requestUpdate();
  }

  // ── Editing ──────────────────────────────────────────────────────────────────────────────────────────────

  #edit() {
    if (this._editing) { this.#cancel(); return; }
    this._editing = true;
    // A layout that could not be read whole: as it was typed (what is wrong said under it).
    this._field = this.#layout.errors.length ? decodeSpec(this.route?.spec ?? '') : this.#layout.text;
    this._draft = this._field;
    this._titleField = this.#state.live.title ?? '';
    this.#titleBefore = this.#state.live.title;
  }

  #cancel() { this._editing = false; this._draft = null; clearTimeout(this.#typing); }

  /** The screen's title when the editor opened: « Annuler » gives it back. @type {string | null} */
  #titleBefore = null;

  /**
   * « Titre » typed in: the screen's title at once, the address replaced (no new entry). The field keeps what is typed
   * (a space at the end, while a word is coming); the state, the address and the heading its clean text (state.js#cleanText).
   * @param {string} text
   */
  #typeTitle(text) {
    this._titleField = text;
    this.#state.set({ title: cleanText(text) }, 'replace');
  }

  /** The draft made the address: a new entry (Back gives the layout before). */
  #apply() {
    const text = this.#shown.text;
    this._editing = false;
    this._draft = null;
    clearTimeout(this.#typing);
    const url = href.layout(text, liveSearch(this.#state.live, store.state.query, this.#state.radius));
    if (location.hash !== url) pushHash(url);
  }

  /** The draft changed by a cell's tools: the field shows its text. @param {(t: ListNode) => ListNode} fn */
  #editDraft(fn) {
    const text = serialize(fn(this.#shown.tree));
    this._draft = text;
    this._field = text;
  }

  /** @type {any} */ #typing = 0;
  /** The field typed in: previewed once the keys rest. @param {string} text */
  #type(text) {
    this._field = text;
    clearTimeout(this.#typing);
    this.#typing = setTimeout(() => { this._draft = text; }, 300);
  }

  /** A cell's tools, editing: its component, its parameters, a cell beside / under it, moved, removed. @param {CellNode} n @param {number[]} path @param {Resolved} r */
  #tools(n, path, r) {
    const depth = path.length - 1;
    const dir = this.#narrow ? 'col' : dirAt(depth);
    const value = r.known ? r.spec.id + (r.view ? '.' + r.view.key : '') : '';
    const choose = (/** @type {string} */ name) => {
      const [id, view] = name.split('.');
      this.#editDraft(t => replaceAt(t, path, makeCell(id, view ?? null, [], n.size)));
    };
    const setParam = (/** @type {string} */ key, /** @type {unknown} */ v) => {
      if (!r.known) return;
      const ps = r.spec.params[key];
      const params = n.params.filter(p => p.key !== key && !(p.key === null && r.spec.main === key));
      if (v !== null && v !== '') params.push({ key, value: valueText(ps, v) });
      this.#editDraft(t => replaceAt(t, path, { ...n, params }));
    };
    const siblings = /** @type {ListNode} */ (nodeAt(this.#shown.tree, path.slice(0, -1))).kids.length;
    const at = path[path.length - 1];
    return html`<div class="tools" role="group" aria-label=${'Modifier la cellule ' + r.title}>
      <select aria-label="Composant" .value=${value} @change=${(/** @type {any} */ e) => choose(e.target.value)}>
        ${r.known ? nothing : html`<option value="" selected>${r.title} (inconnu)</option>`}
        ${COMPONENTS.map(c => html`<option value=${c.id} ?selected=${value === c.id}>${c.title}</option>
          ${(c.views?.() ?? []).map(v => html`<option value=${c.id + '.' + v.key} ?selected=${value === c.id + '.' + v.key}>${c.title} › ${v.title}</option>`)}`)}
      </select>
      ${r.known ? Object.entries(r.spec.params).map(([key, ps]) => ps.kind === 'bool'
        ? html`<label><input type="checkbox" .checked=${Boolean(r.params[key])} @change=${(/** @type {any} */ e) => setParam(key, e.target.checked)} /> ${ps.label}</label>`
        : html`<select aria-label=${ps.label} title=${ps.label} @change=${(/** @type {any} */ e) => setParam(key, e.target.value === '' ? null : ps.kind === 'distance' ? Number(e.target.value) : e.target.value)}>
            <option value="" ?selected=${!r.given.has(key)}>${ps.label} : par défaut</option>
            ${(ps.kind === 'distance' ? distanceChoices(r.given.has(key) ? r.params[key] : null).map(d => [String(d), distanceLabel(d)]) : Object.entries(ps.values ?? {})).map(([v, label]) => html`<option value=${v} ?selected=${r.given.has(key) && String(r.params[key]) === v}>${label}</option>`)}
          </select>`) : nothing}
      <button type="button" title="Une cellule à droite" aria-label="Ajouter une cellule à droite" @click=${() => this.#editDraft(t => splitAt(t, path, 'row', makeCell('plant')))}>${icon('chevron-bar-right')}</button>
      <button type="button" title="Une cellule en dessous" aria-label="Ajouter une cellule en dessous" @click=${() => this.#editDraft(t => splitAt(t, path, 'col', makeCell('plant')))}>${icon('chevron-down')}</button>
      <button type="button" title=${dir === 'row' ? 'Vers la gauche' : 'Vers le haut'} aria-label="Déplacer avant" ?disabled=${at === 0} @click=${() => this.#editDraft(t => moveAt(t, path, -1))}>${icon(dir === 'row' ? 'chevron-left' : 'chevron-up')}</button>
      <button type="button" title=${dir === 'row' ? 'Vers la droite' : 'Vers le bas'} aria-label="Déplacer après" ?disabled=${at >= siblings - 1} @click=${() => this.#editDraft(t => moveAt(t, path, 1))}>${icon(dir === 'row' ? 'chevron-right' : 'chevron-down')}</button>
      <button class="danger" type="button" title="Retirer cette cellule" aria-label="Retirer cette cellule" @click=${() => this.#editDraft(t => removeAt(t, path))}>${icon('trash3')}</button>
    </div>`;
  }

  /** The editor: the layout as text, what is wrong, the ready-made ones, how it is written. */
  #editor() {
    const s = this.#shown;
    const problems = [...s.errors.map(e => `${e.message} (caractère ${e.at + 1})`), ...s.problems.map(p => p.message)];
    return html`<section class="editor" aria-label="Modifier la disposition">
      <label for="layout-title">Titre</label>
      <input id="layout-title" type="text" maxlength="80" autocomplete="off" placeholder="Sans titre (par exemple : Orchidées de la colline de Mirabel)"
        .value=${this._titleField} @input=${(/** @type {any} */ e) => this.#typeTitle(e.target.value)} />
      <label for="layout-text">La disposition (texte, comme dans l’adresse)</label>
      <textarea id="layout-text" spellcheck="false" autocomplete="off" .value=${this._field} @input=${(/** @type {any} */ e) => this.#type(e.target.value)}
        @keydown=${(/** @type {KeyboardEvent} */ e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this._draft = this._field; this.updateComplete.then(() => this.#apply()); } }}></textarea>
      ${problems.length ? html`<ul class="problems" role="alert">${problems.map(p => html`<li>${p}</li>`)}</ul>`
        : html`<p class="ok" role="status">Aperçu en direct. Lue ainsi : <code>${s.text}</code></p>`}
      <div class="row">
        <button class="primary" type="button" ?disabled=${!s.tree.kids.length} @click=${() => { this._draft = this._field; this.updateComplete.then(() => this.#apply()); }}>${icon('check-lg')} Appliquer</button>
        <button type="button" @click=${() => { this.#cancel(); this.#state.set({ title: this.#titleBefore }, 'replace'); }}>Annuler</button>
        <button type="button" @click=${() => this.#resetSizes()}>${icon('arrows-collapse')} Tailles par défaut</button>
      </div>
      <div class="models" role="group" aria-label="Modèles">${PRESETS.map(p => html`<button type="button" title=${p.about} @click=${() => { this._field = p.spec; this._draft = p.spec; }}>${p.title}</button>`)}</div>
      <details><summary>Comment l’écrire</summary>
        <p><code>[a,b,c]</code> : trois colonnes ; <code>[a,[b,c]]</code> : la 2<sup>e</sup> colonne coupée en deux lignes ; un niveau de plus coupe une ligne en colonnes.
          <code>@30</code> après une cellule ou une liste : sa part en %. Paramètres entre parenthèses : <code>map(r=2km,base=plan)</code>, <code>results(grid)</code>, <code>search(filters=1)</code>,
          <code>media(mosaic)</code>, <code>plant(scientific)</code>. Une rubrique de la fiche seule : <code>plant.wikipedia</code>, <code>plant.calendar</code>, <code>plant.uses</code>…
          Composants : ${COMPONENTS.map((c, i) => html`${i ? ', ' : ''}<code>${c.id}</code> (${c.title})`)}.</p>
      </details>
    </section>`;
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
    return html`<div class="split ${dir}" data-split=${key}>${repeat(n.kids, (k, j) => (k.t === 'list' ? 'l:' : 'c:') + [...path, j].join('.') + (k.t === 'cell' ? ':' + k.name + '.' + (k.view ?? '') : ''), (k, j) => html`
      ${j ? shareGrip({ dir, sizes: sh, i: j, part: 'part', label: `Redimensionner ${this.#name(n.kids[j - 1], [...path, j - 1])} et ${this.#name(k, [...path, j])}`,
        set: s => this.#setShares(path, s) }) : nothing}
      <div class="part" style=${`flex: ${sh[j]} 1 0; ` + (dir === 'row' ? `min-width: ${least(k, cells, [...path, j], 'col')}px` : `min-height: ${least(k, cells, [...path, j], col ? 'col' : 'row', 'h', col)}px`)}>${k.t === 'list' ? this.#split(k, [...path, j], depth + 1, col) : this.#cell(k, [...path, j])}</div>`)}</div>`;
  }

  /**
   * A cell: its head (the icon and mark of its tab in the menu of columns — registry.js#cellIcon, #cellMark: a block of
   * the sheet its own, an unknown component a question —, its title, what it shows now, its tools while editing) and its
   * component. @param {CellNode} n @param {number[]} path
   */
  #cell(n, path) {
    const key = path.join('.');
    const r = /** @type {Resolved} */ (this.#shown.cells.get(key));
    const s = this.#state;
    const results = this.#store.state.results;
    const first = results.items[0] ? { id: results.items[0].id, name: results.items[0].vernacularName || results.items[0].scientificName } : null;
    const id = r.known ? r.spec.id : null;
    const mark = cellMark(r);
    const sub = !r.known ? 'à corriger'
      : id === 'map' || id === 'place' ? scopeWords(s)
      : id === 'search' || id === 'results' || id === 'filters' ? (this.#store.state.status === 'ready' ? `${results.total.toLocaleString('fr-FR')} espèce${results.total > 1 ? 's' : ''}` : '')
      : s.plantInfo && s.plantInfo.id === s.live.plant ? html`${s.plantInfo.name}${s.plantInfo.name !== s.plantInfo.sci ? html` · <i>${s.plantInfo.sci}</i>` : nothing}` : '';
    return html`<section class="cell ${this._flash === key ? 'flash' : ''}" data-cell=${key} data-comp=${r.known ? r.spec.id + (r.view ? '.' + r.view.key : '') : 'unknown'} aria-label=${r.title}>
      <header class="cell-head"><h2>${icon(cellIcon(r))} ${r.title}${mark ? html`<b class="cell-mark" aria-hidden="true" title=${mark.label} data-mark=${mark.short}></b>` : nothing}</h2><span class="sub">${sub}</span>
        ${this._editing ? this.#tools(n, path, r) : nothing}</header>
      <div class="cell-body">${renderCell(r, { state: s, view: plantViewOf(this.#store.state), plant: s.live.plant, first })}</div>
    </section>`;
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

  /** No layout (or nothing readable in it): what it is, and the ready-made ones. */
  #empty() {
    return html`<div class="empty">
      <h2>Composez votre écran</h2>
      <p>Une disposition met côte à côte les outils de GeoFlora — la carte, la recherche, la fiche ou une seule de ses rubriques, les photos, les cartes à swiper —,
        tous reliés : une plante choisie dans l’un s’affiche dans tous les autres. Elle s’écrit dans l’adresse : un lien la partage.
        « Modifier la disposition » pour l’écrire, ou partez d’un modèle :</p>
      <ul>${PRESETS.map(p => html`<li><a href=${href.layout(p.spec)}><b>${p.title}</b><small>${p.about}</small><code>${p.spec}</code></a></li>`)}</ul>
    </div>`;
  }

  async #share() {
    const r = await share({ title: this.pageTitle ?? 'Disposition libre — GeoFlora', url: this.#href() });
    if (r === 'copied') { this._copied = true; setTimeout(() => { this._copied = false; }, 2000); }
  }

  render() {
    const s = this.#shown;
    const tree = s.tree;
    const w = this._w;
    const narrow = this.#narrow = w > 0 && tree.kids.length > 1 && (w < BP.phone || w < least(tree, s.cells, [], 'row'));
    const remarks = s.errors.length + s.problems.length;
    // The screen's own title (?title=): the page's heading, above the bar (and, narrow, above the menu of columns);
    // the bar's name is then no heading.
    const title = this.#state.live.title;
    return html`${title ? html`<header class="titlebar"><h1 title=${title}>${title}</h1></header>` : nothing}<div class="bar">
        ${title ? html`<p class="app">${icon('layers')} <span>Disposition libre</span></p>` : html`<h1 class="app">${icon('layers')} <span>Disposition libre</span></h1>`}
        <span class="spacer"></span>
        <details class="presets" @keydown=${(/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') /** @type {HTMLDetailsElement} */ (e.currentTarget).removeAttribute('open'); }}>
          <summary title="Dispositions toutes prêtes" aria-label="Modèles de disposition">${icon('list-ul')} <span class="lbl">Modèles</span></summary>
          <ul>${PRESETS.map(p => html`<li><a href=${href.layout(p.spec)} @click=${(/** @type {Event} */ e) => /** @type {HTMLElement} */ (e.currentTarget).closest('details')?.removeAttribute('open')}><b>${p.title}</b><small>${p.about}</small></a></li>`)}</ul>
        </details>
        <button type="button" aria-pressed=${this._editing ? 'true' : 'false'} aria-label="Modifier la disposition" title="Modifier la disposition" @click=${() => this.#edit()}>${icon('pencil')} <span class="lbl">Modifier la disposition</span></button>
        <button class="icon-btn" type="button" title=${this._copied ? 'Lien copié' : 'Partager ce lien (la disposition, la plante, la zone, la recherche)'}
          aria-label=${this._copied ? 'Lien copié' : 'Partager ce lien'} @click=${() => this.#share()}>${icon(this._copied ? 'check-lg' : 'share')}</button>
      </div>
      ${remarks && !this._editing && tree.kids.length ? html`<p class="remarks" role="status">${icon('exclamation-triangle-fill')} ${remarks} remarque${remarks > 1 ? 's' : ''} sur cette disposition.
        <button class="link" type="button" @click=${() => this.#edit()}>Voir et corriger</button></p>` : nothing}
      ${this._editing ? this.#editor() : nothing}
      <div class="body">${!w ? nothing : !tree.kids.length ? this.#empty()
        : narrow ? this.#tabs(tree) : html`<div class="grid">${this.#split(tree, [], 0, false)}</div>`}</div>`;
  }
}

/**
 * The radii a cell's tools offer: the slider's stops, and the one the cell gives when it is none of them (r=3km: kept,
 * in its place, never shown as « par défaut »). @param {number | null} given @returns {number[]}
 */
const distanceChoices = given => given == null || DISTANCES.includes(given) ? DISTANCES : [...DISTANCES, given].sort((a, b) => a - b);

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
