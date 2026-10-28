// @ts-check
import { LitElement, html, css, nothing, repeat } from 'lit';
import { config } from '../config.js';
import { MediaController, PHONE_QUERY } from '../core/media.js';
import { activeFilterCount, clearFilters, fromHash, lastSearchHash, toHash } from '../core/query.js';
import { href } from '../core/router.js';
import { closeTo, depth, entryValue, modalOpen, openModal, openView, renewBehind, replaceHash, replaceView, sheetMark } from '../core/history.js';
import { context, setContext } from '../core/context.js';
import { StoreController, arrangedMode, closeKing, store, whenReady } from '../core/store.js';
import { runSearch } from '../core/search.js';
import { PaneSizer, splitStyles } from '../core/panes.js';
import { ui } from '../styles/ui.js';
import { sheetStyles } from './ui-kit.js';
import './gf-results-bar.js';
import './gf-filter-panel.js';
import './gf-plant-list.js';
import './gf-pager.js';
import { icon } from '../core/icons.js';
import { blockTitle, hasColumns } from '../core/sheet-blocks.js';

/**
 * The plant sheet (gf-plant-detail, its maps and media viewer: more code than the rest of the start), loaded the
 * first time a sheet shows, else once the search is ready, when the page is idle (a tap on a result then finds it):
 * the search comes first. Its modules asked all at once when the deployed index.html lists them (tools/preload-modules.mjs),
 * not one level of imports at a time. @type {Promise<unknown> | null}
 */
let sheetModule = null;
const loadSheet = () => {
  if (!sheetModule) {
    const listed = document.querySelector('meta[name="geoflora-preload-sheet"]')?.getAttribute('content') || '';
    for (const path of listed.split(' ').filter(Boolean)) {
      document.head.append(Object.assign(document.createElement('link'), { rel: 'modulepreload', href: path }));
    }
  }
  sheetModule ??= import('./gf-plant-detail.js').catch(error => { sheetModule = null; console.error(error); });
  return sheetModule;
};
whenReady().then(() => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => loadSheet(), { timeout: 3000 });
  else setTimeout(loadSheet, 500);
});

/** Results pane narrower than this: cards instead of the grid. */
const GRID_MIN = 560;
const MIN = { filters: 220, results: 280, plant: 360 };
const MAX = { filters: 480 };
const TITLES = { filters: 'Filtres', results: 'Résultats', plant: 'Plante' };
/** The panes' default widths and minimums (core/panes.js); `plantPinned`: the plant's, its sheet with pinned blocks. */
const PANES = {
  filters: { width: 280, min: MIN.filters, title: TITLES.filters },
  results: { width: 0, min: MIN.results, title: TITLES.results },
  plant: { width: 480, min: MIN.plant, title: TITLES.plant },
  plantPinned: { width: 900, min: MIN.plant, title: TITLES.plant }
};

/** @typedef {'filters' | 'results' | 'plant'} Pane */

/**
 * The layout as Flore kept it before core/panes.js ({ filters, plant, plantPinned, folded }): its widths and folds.
 * @param {any} raw @returns {import('../core/panes.js').PaneState}
 */
function legacyLayout(raw) {
  /** @type {Record<string, number>} */
  const widths = {};
  for (const k of ['filters', 'plant', 'plantPinned']) if (Number.isFinite(raw[k]) && raw[k] !== /** @type {any} */ (PANES)[k].width) widths[k] = Math.round(raw[k]);
  /** @type {Record<string, boolean>} */
  const folded = {};
  for (const [k, v] of Object.entries(raw.folded || {})) if (v === true) folded[k] = true;
  return { widths, folded };
}

/**
 * The Flore tab. Desktop: Filtres ┃ Résultats ┃ Plante, each pane foldable (vertical rail) and resizable
 * (core/panes.js: drag the separators, or focus one and use ← →, Début / Fin; double-click or Entrée resets; widths
 * and folds kept under floraLayout). Tablet: filters in a bottom sheet,
 * Résultats ┃ Plante. Phone: results, the plant sliding over them full screen.
 * The list stays mounted while a plant is open, so its scroll position is kept.
 */
export class GfFlora extends LitElement {
  static properties = {
    route: { attribute: false },
    _grid: { state: true },
    _under: { state: true },
    _paneFull: { state: true }
  };

  static styles = [ui, sheetStyles, splitStyles, css`
    :host { display: flex; flex-direction: column; min-height: 0; flex: 1; }
    .panes { display: flex; flex: 1; min-height: 0; position: relative; }
    .pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--gf-surface); }
    .pane.results { flex: 1 1 0; background: var(--gf-bg); }
    .pane.results.fill-plant { flex: 0 0 auto; }
    .pane.plant.fill { flex: 1 1 0; }
    .pane.filters, .pane.plant { flex: none; }
    /* A block in a pane, in place of the results (kept mounted, hidden, so the list keeps its scroll). */
    .pane.block-pane { flex: 1 1 0; }
    .pane.results[hidden] { display: none; }
    .pane.block-pane.full { position: absolute; inset: 0; z-index: 6; }
    .block-pane gf-plant-detail, .sheet-pane gf-plant-detail { flex: 1; min-height: 0; }
    .pane-plant { font-family: var(--gf-font-serif); font-style: italic; font-weight: 500; color: var(--gf-text-muted); margin-left: 4px; }
    .sheet-pane { position: fixed; inset: 0 0 calc(61px + env(safe-area-inset-bottom)) 0; z-index: 901; display: flex; flex-direction: column; background: var(--gf-surface); }
    .sheet-pane .back { font-weight: 600; }
    .pane-head {
      display: flex;
      align-items: center;
      gap: 6px;
      min-height: 40px;
      padding: 2px 4px 2px 14px;
      border-bottom: 1px solid var(--gf-border);
      background: var(--gf-surface);
    }
    /* A pane's name: a heading under the view's h1 (Flore); a plant open, a label only (its name is the h1). */
    .pane-head :is(h2, .title) { margin: 0; font-weight: 700; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--gf-text-muted); flex: 1; display: flex; gap: 8px; align-items: center; min-width: 0; }
    .pane-head .icon-btn { width: 32px; height: 32px; font-size: 1rem; }
    .pane-head .link { flex: none; white-space: nowrap; }
    /* Each pane lays out on its own: resizing one does not re-lay out the content of the others. */
    .pane-body { flex: 1; min-height: 0; overflow-y: auto; contain: strict; }
    /* No bottom padding: the headers still to come sit right on the bottom edge (gf-facet); the room is the panel's. */
    .filters .pane-body { padding: 0 14px; }
    .results .pane-body { overflow: hidden; display: flex; flex-direction: column; }
    gf-plant-list { flex: 1; min-height: 0; }
    gf-plant-detail { flex: 1; min-height: 0; }
    .plant .pane-body { display: flex; flex-direction: column; overflow: hidden; background: var(--gf-surface-2); }

    /* Folded pane: a narrow rail with its title written vertically. */
    .rail {
      flex: none;
      width: 40px;
      min-height: 0;
      border: 0;
      border-radius: 0;
      border-right: 1px solid var(--gf-border);
      background: var(--gf-surface);
      writing-mode: vertical-rl;
      padding: 14px 0;
      justify-content: flex-start;
      gap: 8px;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--gf-text-muted);
    }
    .rail.right { border-right: 0; border-left: 1px solid var(--gf-border); }
    .rail:hover { color: var(--gf-text); background: var(--gf-surface-2); }
    .rail .badge { writing-mode: horizontal-tb; background: var(--gf-accent); color: var(--gf-accent-contrast); }

    /* Phone: the plant slides over the results, full screen. */
    .sheet-plant {
      position: fixed;
      /* Down to the tab bar (60px + its 1px border), which stays visible. */
      inset: 0 0 calc(61px + env(safe-area-inset-bottom)) 0;
      z-index: 900;
      display: flex;
      flex-direction: column;
      background: var(--gf-surface);
      animation: slide-in 0.2s ease-out;
    }
    .sheet-plant .pane-head { padding-left: 4px; }
    .sheet-plant:focus { outline: none; }
    @keyframes slide-in { from { transform: translateX(30%); opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .sheet-plant { animation: none; } }

    /* Previous / next plant of the results: the pager at the bottom of the pane, swipe on the sheet, ← →. */
    gf-pager { flex: none; }
    /* Phone: the plant sheet is a card (Tinder-like). It follows the finger and tilts, the plant that way already
       waits underneath, growing as the card moves away; let go past the threshold, the card carries on off the
       screen and the one underneath is the sheet; short of it, it springs back.
       Larger screens: no swipe, the next sheet fades in as the current one fades out. */
    .deck { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .swipe {
      position: relative;
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      background: var(--gf-surface);
      transform-origin: 50% 110%;
    }
    .deck.touch .swipe { touch-action: pan-y; }
    .swipe.dragging { transform: translateX(var(--dx, 0px)) rotate(var(--rot, 0deg)); transition: none; box-shadow: var(--gf-shadow-float); border-radius: var(--gf-radius-lg); }
    .swipe.settle { transition: transform 0.32s cubic-bezier(0.2, 1.4, 0.4, 1), box-shadow 0.32s; }
    /* Let go: the card keeps going from where the finger left it, until it is off the screen. */
    .swipe.fly-next, .swipe.fly-prev { transition: transform 0.3s cubic-bezier(0.3, 0.6, 0.5, 1); pointer-events: none; box-shadow: var(--gf-shadow-float); border-radius: var(--gf-radius-lg); }
    .swipe.fly-next { transform: translateX(-160%) rotate(-18deg); }
    .swipe.fly-prev { transform: translateX(160%) rotate(18deg); }
    .swipe:not(.under) { z-index: 1; }
    /* The next (or previous) plant, under the card: a little smaller, full size once the card is gone. */
    .swipe.under {
      position: absolute;
      inset: 0;
      z-index: 0;
      pointer-events: none;
      overflow: hidden;
      transform-origin: 50% 50%;
      transform: scale(calc(0.94 + 0.06 * var(--p, 0)));
      border-radius: var(--gf-radius-lg);
      box-shadow: var(--gf-shadow-float);
    }
    .deck.easing .swipe.under { transition: transform 0.3s ease-out; }
    /* Larger screens: the current sheet fades out, then the next one (on top, already loaded) fades in. */
    .deck.fade .swipe.under { transform: none; border-radius: 0; box-shadow: none; z-index: 2; opacity: 0; }
    .deck.fade.go .swipe.under { opacity: 1; transition: opacity 0.2s ease-out 0.13s; }
    .deck.fade.go .swipe:not(.under) { opacity: 0; transition: opacity 0.13s ease-in; }
    @media (prefers-reduced-motion: reduce) {
      .swipe.settle, .swipe.fly-next, .swipe.fly-prev, .deck.easing .swipe.under, .deck.fade .swipe { transition: none; }
    }

    /* Filters (tablet and phone): bottom sheet. */
    dialog.drawer { --drawer-w: 640px; --drawer-h: 88dvh; }
    .sheet-head { padding: 4px 16px 0; border-bottom: 1px solid var(--gf-border); }
    .sheet-head::before { content: ''; display: block; width: 36px; height: 4px; margin: 6px auto 0; border-radius: 2px; background: var(--gf-border); }
    /* « Tout effacer » beside the title, not in it (the heading's name would be « Filtres Tout effacer »). */
    .sheet-title { display: flex; align-items: center; gap: 8px; margin: 12px 0 8px; }
    .sheet-title h2 { font-size: 1rem; margin: 0; flex: 1; }
    .sheet-body { overflow-y: auto; padding: 0 16px; flex: 1; }
    .sheet-foot { padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); border-top: 1px solid var(--gf-border); }
    .sheet-foot button { width: 100%; }
  `];

  #store = new StoreController(this);
  #wide = new MediaController(this, config.wideQuery);
  #phone = new MediaController(this, PHONE_QUERY);
  #resultsObserver = new ResizeObserver(([entry]) => {
    const grid = entry.contentRect.width >= GRID_MIN && !this.#phone.matches;
    if (grid !== this._grid) this._grid = grid;
  });
  /** Where the open plant's sheet closes to (core/history.js sheetMark). @type {import('../core/history.js').SheetMark | null} */ #sheet = null;
  /** Where the block's pane closes to: the plant without it, it was opened from; else in place. @type {import('../core/history.js').SheetMark | null} */ #paneMark = null;
  /** The list's address as the plant found it, then as its filters and sort change beside the plant. */
  #listHash = '';

  constructor() {
    super();
    /** @type {any} */
    this.route = { name: 'search' };
    this._grid = false;
    /** The plant waiting under the card while it is swiped (its sheet is ready when the card flies off). @type {number | null} */
    this._under = null;
    /** The pane over all the panes. */
    this._paneFull = false;
  }

  connectedCallback() {
    super.connectedCallback();
    addEventListener('keydown', this.#onKey);
  }

  // ── Previous / next plant of the results ─────────────────────────────────

  /** Where the open plant sits in the results (null when it is not among them, e.g. opened from a link). */
  #position() {
    const id = this.#plantId;
    const items = this.#store.state.results.items;
    const i = id === null ? -1 : items.findIndex(p => p.id === id);
    return i < 0 ? null : { i, n: items.length, prev: items[i - 1]?.id ?? null, next: items[i + 1]?.id ?? null };
  }

  /** The card on top (the open plant's sheet), not the one waiting underneath. */
  get #card() { return /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.swipe:not(.under)')); }

  #reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  /**
   * To the previous / next plant of the results. Phone: the card flies off that way, uncovering it. Larger
   * screens: its sheet fades in over the current one. Either way that sheet, already loaded, becomes the open one.
   * A jump further away goes the same way, to that plant.
   * @param {'prev' | 'next'} dir @param {number | null} [to]
   */
  async #step(dir, to) {
    const id = to ?? this.#position()?.[dir];
    if (!id) return;
    const card = this.#card;
    // Each plant is a view: Back returns to the one before (« Fermer la fiche » goes straight to the list).
    // The pane stays open (the next plant's map, media…). The sheet or its pane closed while the move plays (Échap, ×
    // right after): it goes nowhere (#cancelStep).
    const run = this.#steps;
    const go = () => {
      if (run !== this.#steps) return;
      this.#moving = false;
      openView(this.#paneInUrl ? href.plantPane(id, /** @type {string} */ (/** @type {any} */ (this.route).pane)) : href.plant(id));
    };
    if (!card || this.#reducedMotion.matches) { this._under = null; go(); return; }
    if (this.#moving) return;
    this.#moving = true;
    this._under = id;
    const deck = /** @type {HTMLElement | null} */ (card.parentElement);
    if (deck?.classList.contains('fade')) {
      // Fade in only once the next sheet has its plant (it reads it from the local database).
      await this.updateComplete;
      const next = /** @type {any} */ (deck.querySelector('.swipe.under gf-plant-detail'));
      for (let i = 0; i < 20 && next && next._plant === undefined && run === this.#steps; i++) await new Promise(r => setTimeout(r, 15));
      if (run !== this.#steps) return;
      deck.classList.add('go');
      setTimeout(go, 340);
      return;
    }
    deck?.classList.add('easing');
    deck?.style.setProperty('--p', '1');
    card.classList.remove('dragging', 'settle');
    card.classList.add('fly-' + dir);
    // The card underneath (same element, its sheet loaded) becomes the sheet; the deck is reset as it does.
    setTimeout(go, 300);
  }

  /** A move to the previous / next plant is playing. */
  #moving = false;
  /** The moves let go (#cancelStep): one still playing from before goes nowhere. */
  #steps = 0;

  /** The sheet or its pane closed while a move plays: the move let go, the card back in place, nothing waiting under it. */
  #cancelStep() {
    if (!this.#moving) return;
    this.#steps++;
    this.#moving = false;
    this._under = null;
    const deck = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.deck'));
    deck?.classList.remove('easing', 'go');
    deck?.style.removeProperty('--p');
    this.#card?.classList.remove('fly-next', 'fly-prev');
  }

  /** ← → on the keyboard, when not typing; Échap. @param {KeyboardEvent} e */
  #onKey = e => {
    if (e.key === 'Escape') { this.#onEscape(e); return; }
    // The media viewer takes ← → while it has the focus (it stops them there); elsewhere they go to the plants.
    // A dialog over the page (« Noter ici », the filters, a question): its keys, never the plant behind it changed.
    if (this.#plantId === null || e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || modalOpen()) return;
    const target = /** @type {HTMLElement} */ (e.composedPath()[0]);
    if (target?.closest?.('input, textarea, select, [contenteditable], gf-map') || target?.isContentEditable) return;
    e.preventDefault();
    this.#step(e.key === 'ArrowLeft' ? 'prev' : 'next');
  };

  /**
   * Échap: the pane closed; else « Personnaliser la fiche » ended (its « Terminé »: the sheet stays); else the plant's
   * sheet — not while typing, nor under a dialog (its step: its own Échap). @param {KeyboardEvent} e
   */
  #onEscape(e) {
    if (this.#plantId === null || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || entryValue('gfModal') || modalOpen()) return;
    const t = /** @type {HTMLElement} */ (e.composedPath()[0]);
    if (t?.closest?.('input, textarea, select, [contenteditable]') || t?.isContentEditable) return;
    e.preventDefault();
    if (this.#pane !== null) this.#closePane();
    else if (this.#store.state.king?.sheet === 'flore') this.#endKing();
    else this.#closePlant();
  }

  /** « Personnaliser la fiche » ended by Échap: its sheet's « Terminé » (the focus back on its crown). */
  #endKing() {
    const sheet = /** @type {any} */ (this.renderRoot.querySelector('.swipe:not(.under) gf-plant-detail'));
    if (sheet?.endKing) sheet.endKing(); else closeKing();
  }

  /** Swipe: a mostly horizontal stroke on the sheet, not started on a map, a field or something that scrolls sideways. */
  #touch = /** @type {{ x: number, y: number, t: number, el: HTMLElement } | null} */ (null);

  /** @param {TouchEvent} e */
  #onTouchStart(e) {
    if (e.touches.length !== 1) { this.#touch = null; return; }
    const path = /** @type {HTMLElement[]} */ (e.composedPath());
    const blocked = path.some(el => el instanceof HTMLElement && (el.matches('input, textarea, select, gf-map, gf-media-viewer, .gallery, .leaflet-container')
      || (el.scrollWidth > el.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(el).overflowX))));
    const t = e.touches[0];
    this.#touch = blocked ? null : { x: t.clientX, y: t.clientY, t: Date.now(), el: /** @type {HTMLElement} */ (e.currentTarget) };
  }

  /** The card follows the finger, tilting, over the plant that way; no plant that way: it resists. @param {TouchEvent} e */
  #onTouchMove(e) {
    const s = this.#touch;
    if (!s) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (!s.el.classList.contains('dragging') && !(Math.abs(dx) > 12 && Math.abs(dx) > 1.5 * Math.abs(dy))) return;
    const id = this.#position()?.[dx < 0 ? 'next' : 'prev'] ?? null;
    const x = id ? dx : dx * 0.25;
    if (this._under !== id) this._under = id;
    s.el.classList.remove('settle');
    s.el.classList.add('dragging');
    s.el.style.setProperty('--dx', x + 'px');
    s.el.style.setProperty('--rot', Math.max(-20, Math.min(20, x / 18)) + 'deg');
    s.el.parentElement?.classList.remove('easing');
    s.el.parentElement?.style.setProperty('--p', String(id ? Math.min(1, Math.abs(dx) / 120) : 0));
  }

  /** Let go: far or fast enough, the card flies off to that plant; else it springs back. @param {TouchEvent} e */
  #onTouchEnd(e) {
    const s = this.#touch;
    this.#touch = null;
    if (!s || !s.el.classList.contains('dragging')) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const fast = Math.abs(dx) / Math.max(1, Date.now() - s.t) > 0.6;
    const dir = dx < 0 ? 'next' : 'prev';
    if ((Math.abs(dx) >= 90 || (fast && Math.abs(dx) >= 40)) && this.#position()?.[dir]) { this.#step(dir); return; }
    this.#settle(s.el);
  }

  /** Back to its place, with a little bounce; the plant underneath shrinks back, then goes. @param {HTMLElement} el */
  #settle(el) {
    const deck = el.parentElement;
    el.classList.remove('dragging');
    el.classList.add('settle');
    el.style.removeProperty('--dx');
    el.style.removeProperty('--rot');
    deck?.classList.add('easing');
    deck?.style.setProperty('--p', '0');
    el.addEventListener('transitionend', () => {
      el.classList.remove('settle');
      if (el.classList.contains('dragging')) return;
      deck?.classList.remove('easing');
      deck?.style.removeProperty('--p');
      this._under = null;
    }, { once: true });
  }

  /**
   * Previous / next plant of the results, at the bottom of the plant pane (above the menu on a phone):
   * simple on a phone, complete on larger screens. @param {boolean} simple
   */
  #pager(simple) {
    const pos = this.#position();
    if (!pos || pos.n < 2) return nothing;
    const items = this.#store.state.results.items;
    const plant = (/** @type {any} */ p) => p ? { name: p.vernacularName || p.scientificName } : null;
    const q = this.#store.state.query.q?.trim();
    return html`<gf-pager ?simple=${simple} .index=${pos.i} .total=${pos.n} source=${q ? `Résultats « ${q} »` : 'Résultats'}
      .prev=${plant(items[pos.i - 1])} .next=${plant(items[pos.i + 1])}
      @page=${(/** @type {CustomEvent} */ e) => this.#step(e.detail.dir || (e.detail.index < pos.i ? 'prev' : 'next'), items[e.detail.index]?.id ?? null)}></gf-pager>`;
  }

  /**
   * The plant sheet as a card, over the plant it would swipe to (when swiping). Keyed by plant: once the card
   * flies off, the one underneath, already loaded, is the sheet. @param {number} plantId @param {string} view
   */
  #swipe(plantId, view, touch = false) {
    const under = this._under !== null && this._under !== plantId ? this._under : null;
    const cards = under === null ? [plantId] : [under, plantId];
    // One template for both, so the card underneath keeps its element (and its loaded sheet) when it comes up.
    return html`<div class=${touch ? 'deck touch' : 'deck fade'}>${repeat(cards, id => id, id => html`<div class=${id === under ? 'swipe under' : 'swipe'}
      ?inert=${id === under} aria-hidden=${id === under ? 'true' : 'false'}
      @touchstart=${touch ? this.#onTouchStart : null} @touchmove=${touch ? this.#onTouchMove : null} @touchend=${touch ? this.#onTouchEnd : null}
      @touchcancel=${touch ? () => { const s = this.#touch; this.#touch = null; if (s?.el.classList.contains('dragging')) this.#settle(s.el); } : null}
      ><gf-plant-detail embedded sheet="flore" ?preview=${id === under} plant-id=${id} view=${view} .inPane=${id === this.#plantId ? this.#pane : null}></gf-plant-detail></div>`)}</div>`;
  }


  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (changed.has('route')) {
      const before = changed.get('route');
      if (this.route.name === 'plant') {
        if (!before) this.#restoreSearch();
        // Where the sheet closes to, kept in its entry: the list just left; the sheet stepped from (‹ ›); a plant entry of an
        // earlier version (gfList: its list's depth); else opened from elsewhere (a link, a tab, the start).
        const legacy = entryValue('gfList');
        this.#sheet = sheetMark('gfSheetFrom', () => before?.name === 'search' ? depth() - 1 : before?.name === 'plant' ? this.#sheet
          : !before && Number.isInteger(legacy) ? /** @type {number} */ (legacy) : null);
        const same = before?.name === 'plant' && before.id === this.route.id;
        this.#paneMark = this.route.pane ? sheetMark('gfPaneFrom', () => same && !before.pane ? depth() - 1 : same ? this.#paneMark : null) : null;
      } else { this.#sheet = null; this.#paneMark = null; }
      if (this.route.name === 'plant' && before?.name !== 'plant') this.#listHash = lastSearchHash();
      // A plant opened from the list: the search field lets go of the keys (← → then go from plant to plant).
      if (this.route.name === 'plant' && before?.name !== 'plant') {
        let el = document.activeElement;
        while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
        /** @type {Node | null} */ let n = el;
        while (n && n !== this) n = n.parentNode || (n instanceof ShadowRoot ? n.host : null);
        if (n && el instanceof HTMLInputElement && el.type === 'search') el.blur();
      }
      // Another plant (the card underneath came up, or Back): nothing waits under it any more.
      if ((before?.name === 'plant' ? before.id : null) !== this.#plantId) {
        this._under = null;
        // In the same update as the swap, so no frame shows the card underneath shrunk back or faded.
        const deck = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.deck'));
        deck?.classList.remove('easing', 'go');
        deck?.style.removeProperty('--p');
      }
      if (this.route.name === 'search') document.title = 'GeoFlora — flore de France';
      // Pane closed: no image to open at.
      if (!this.#paneInUrl) this.#paneStart = null;
      if (this.#pane === null) this._paneFull = false;
      // Phone: the sheet that opens over the list takes the focus. Closed, the focus goes back to the plant's row, when it
      // went with the sheet (#backToRow).
      if (this.#phone.matches && this.route.name === 'plant' && before?.name !== 'plant') this.#focusSheet = true;
      if (before?.name === 'plant' && this.route.name !== 'plant') this.#focusRow = before.id;
    }
    // A plant open beside the list (desktop, tablet): the filters and the sort changed there (the Filtres pane, the
    // drawer) are the list's, not written in the plant's address — closing the plant, Back, the Flore tab or a reload
    // come back to them, not to the list as the plant found it.
    const list = this.route.name === 'plant' ? lastSearchHash() : this.#listHash;
    if (list !== this.#listHash) {
      this.#listHash = list;
      setContext({ query: list });
      if (this.#sheet?.from != null) renewBehind(this.#sheet.from, list);
    }
  }

  /**
   * Mounted on a plant (another tab, a link, a reload, Back): the search under the sheet is Flore's own, kept in the
   * context — not the one the store may hold from elsewhere (a free layout's first group). Before anything reads it
   * (#listHash, the pager); run once the flora is ready (main.js runs the start's).
   */
  #restoreSearch() {
    const saved = fromHash(context().query || '#/');
    if (toHash(saved) === toHash(this.#store.state.query)) return;
    store.set({ query: saved });
    if (store.state.status === 'ready') runSearch();
  }

  updated() {
    const results = this.renderRoot.querySelector('.pane.results');
    if (results && results !== this.#observed) {
      this.#resultsObserver.disconnect();
      this.#resultsObserver.observe(results);
      this.#observed = results;
    }
    if (this.#focusSheet) { this.#focusSheet = false; this.#enterSheet(); }
    if (this.#focusRow !== null) { const id = this.#focusRow; this.#focusRow = null; this.#backToRow(id); }
  }

  /** Phone: a plant just opened (its sheet takes the focus). */
  #focusSheet = false;
  /** The plant whose sheet just closed (its row takes the focus back). @type {number | null} */
  #focusRow = null;

  /**
   * Phone: the focus into the sheet over the list (the list under it is inert): the sheet at once, then the
   * plant's name (its h1) once drawn — unless the focus went elsewhere meanwhile.
   */
  async #enterSheet() {
    const sheet = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.sheet-plant'));
    if (!sheet) return;
    sheet.focus({ preventScroll: true });
    for (let i = 0; i < 30 && sheet.isConnected; i++) {
      const detail = sheet.querySelector('.swipe:not(.under) gf-plant-detail');
      const h1 = /** @type {HTMLElement | null | undefined} */ (detail?.shadowRoot?.querySelector('h1'));
      if (h1) {
        if (/** @type {ShadowRoot} */ (this.renderRoot).activeElement !== sheet) return;
        h1.tabIndex = -1;
        h1.focus({ preventScroll: true });
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * The sheet closed, the focus back on the plant's row in the list (when it is drawn) — when the focus went with the
   * sheet (its ×, Échap or Back from inside it; a phone: the list was under it, inert), never taken from where it is
   * (the search field, a filter). Once the list has its room back: beside the sheet, the results come back as a grid,
   * their rows made anew. @param {number} id
   */
  async #backToRow(id) {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await this.updateComplete;
    const list = /** @type {any} */ (this.renderRoot.querySelector('gf-plant-list'));
    await list?.updateComplete;
    const card = /** @type {any} */ ([...(list?.renderRoot?.querySelectorAll('gf-plant-card') || [])].find(c => /** @type {any} */ (c).plant?.id === id));
    await card?.updateComplete;
    if (document.activeElement && document.activeElement !== document.body) return;
    /** @type {HTMLElement | null | undefined} */ (card?.renderRoot?.querySelector('a.row'))?.focus({ preventScroll: true });
  }

  /** @type {Element | null} */ #observed = null;

  disconnectedCallback() {
    super.disconnectedCallback();
    removeEventListener('keydown', this.#onKey);
    this.#resultsObserver.disconnect();
    this.#observed = null;
  }

  get #plantId() { return this.route.name === 'plant' ? this.route.id : null; }

  // ── A block in a pane: beside the sheet, in place of the results (phone: over the sheet) ──────────────
  // ?pane=<block> in the address: ⤢ on a block, a photo touched for « Médias », a block placed « À côté ».

  /** The block in the pane, null when there is none. */
  get #pane() {
    // Only when asked (⤢, a photo touched, « À côté : … »): opening a plant keeps Filtres ┃ Résultats ┃ Plante.
    return this.route.name === 'plant' ? this.route.pane : null;
  }

  /** The pane is in the address (always: it opens only when asked). */
  get #paneInUrl() { return this.route.name === 'plant' && Boolean(this.route.pane); }

  /** The image touched on the sheet, for the media viewer to open at. @type {string | null} */
  #paneStart = null;

  /** ⤢ on a block, or a photo touched. @param {CustomEvent} e */
  #openPane = e => {
    const id = this.#plantId;
    if (id === null || e.detail?.plantId !== id) return;
    e.preventDefault();
    const key = e.detail.key;
    this.#paneStart = e.detail.url || null;
    if (this.#pane === key && this.#paneInUrl) { this.requestUpdate(); return; }
    // Another block in the pane: the same pane (its marks kept); else a new view (Back closes it).
    if (this.#paneInUrl) { replaceView(href.plantPane(id, key), ['gfSheetFrom', 'gfPaneFrom']); return; }
    openView(href.plantPane(id, key));
  };

  /** The media viewer moved to another image: the address follows (no new step in history). @param {CustomEvent} e */
  #mediaIndex = e => {
    const id = this.#plantId;
    if (id === null || !this.#paneInUrl || this.#pane !== 'media') return;
    const url = href.plantPane(id, 'media', e.detail.index);
    if (location.hash !== url) replaceHash(url);
  };

  /**
   * « Fermer le panneau »: back to the plant it was opened from, without it; opened by a link, or the plant changed
   * since (‹ ›): the plant shown, without it, in place.
   */
  #closePane = () => {
    const id = this.#plantId;
    this._paneFull = false;
    this.#paneStart = null;
    this.#cancelStep();
    if (id !== null && this.#paneMark) closeTo(this.#paneMark, href.plant(id), { keep: ['gfSheetFrom'] });
  };

  /** The pane: its bar (block, plant, full screen, close) and the block alone. @param {boolean} phone */
  #paneSection(phone) {
    const id = this.#plantId, key = /** @type {string} */ (this.#pane);
    // The block as the sheet beside shows it: in the mode arranged there while it is personalised.
    const view = arrangedMode('flore', this.#store.state.mode);
    const route = /** @type {any} */ (this.route);
    return html`<section class=${phone ? 'sheet-pane' : `pane block-pane ${this._paneFull ? 'full' : ''}`} aria-label=${blockTitle(key)}
        @media-index=${this.#mediaIndex} @media-close=${this.#closePane}>
      <div class="pane-head">
        ${phone ? html`<button class="link back" type="button" @click=${this.#closePane}>${icon('arrow-left')} Fiche</button>` : nothing}
        <div class="title">${blockTitle(key)} <span class="pane-plant">${this.#paneName}</span></div>
        ${phone ? nothing : html`<button class="icon-btn" type="button" aria-pressed=${String(this._paneFull)} title=${this._paneFull ? 'Sortir du plein écran' : 'Plein écran'}
          aria-label="Plein écran" @click=${() => { this._paneFull = !this._paneFull; }}>${icon(this._paneFull ? 'fullscreen-exit' : 'arrows-fullscreen')}</button>`}
        <button class="icon-btn" type="button" title="Fermer le panneau" aria-label="Fermer le panneau" @click=${this.#closePane}>${icon('x-lg')}</button>
      </div>
      <gf-plant-detail embedded only=${key} plant-id=${id} view=${view} .paneAt=${route.at ?? null} .paneStart=${this.#paneStart}></gf-plant-detail>
    </section>`;
  }

  /** The plant's scientific name, for the pane's title (from the results, when it is among them). */
  get #paneName() {
    const id = this.#plantId;
    return this.#store.state.results.items.find(p => p.id === id)?.scientificName || '';
  }

  /** The panes' widths and folds, kept (floraLayout; the separators: core/panes.js). */
  #sizer = new PaneSizer(this, config.storageKeys.floraLayout, PANES, { legacy: legacyLayout });

  /** @param {Pane} pane @param {boolean} folded */
  #fold(pane, folded) { this.#sizer.fold(pane, folded); }

  #closePlant() {
    // Back to the list it was opened from (past the plants browsed with ‹ ›); opened elsewhere: the list in the sheet's place.
    this.#cancelStep();
    if (this.#sheet) closeTo(this.#sheet, this.#listHash);
  }

  // ── Resizing ───────────────────────────────────────────────────────────────

  /**
   * Where a pane's width is kept: the plant pane has a second one, wider, for a sheet with pinned blocks
   * (the sheet and its pinned map side by side). @param {'filters' | 'plant'} pane @returns {'filters' | 'plant' | 'plantPinned'}
   */
  #key(pane) {
    return pane === 'plant' && hasColumns(arrangedMode('flore', this.#store.state.mode)) ? 'plantPinned' : pane;
  }

  /** @param {'filters' | 'plant'} pane */
  #width(pane) { return this.#sizer.width(this.#key(pane)); }

  /** Largest width a side pane may take, leaving the other panes their minimum. @param {'filters' | 'plant'} pane */
  #max(pane) {
    const total = this.renderRoot.querySelector('.panes')?.getBoundingClientRect().width || innerWidth;
    const folded = (/** @type {Pane} */ p) => this.#sizer.folded(p);
    const others = pane === 'filters'
      ? (folded('results') ? 0 : MIN.results) + (this.#plantId && !folded('plant') ? Math.min(this.#width('plant'), this.#max('plant')) : 0)
      : (folded('results') ? 0 : MIN.results) + (this.#wide.matches ? (folded('filters') ? 40 : Math.min(this.#width('filters'), MAX.filters)) : 0);
    return Math.max(MIN[pane], Math.min(/** @type {any} */ (MAX)[pane] || Infinity, total - others - 16));
  }

  /** The separator of a side pane (core/panes.js). @param {'filters' | 'plant'} pane */
  #split(pane) {
    return this.#sizer.split(this.#key(pane), pane === 'filters' ? 'left' : 'right', () => this.#max(pane), 'flore-' + pane);
  }

  // ── Filters ────────────────────────────────────────────────────────────────

  get #dialog() { return /** @type {HTMLDialogElement | null} */ (this.renderRoot.querySelector('dialog')); }

  /** A column's funnel: bring its filter into view (unfolding the pane or opening the sheet). @param {CustomEvent} e */
  async #focusFacet(e) {
    const facet = e.detail.facet;
    if (this.#wide.matches) {
      if (this.#sizer.folded('filters')) this.#fold('filters', false);
    } else {
      openModal(this.#dialog);
    }
    await this.updateComplete;
    const panel = /** @type {any} */ (this.renderRoot.querySelector(this.#wide.matches ? '.pane.filters gf-filter-panel' : 'dialog gf-filter-panel'));
    await panel?.updateComplete;
    const el = /** @type {any} */ (panel?.renderRoot?.querySelector(`gf-facet[name="${facet}"]`));
    if (!el) return;
    await el.reveal();
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1200);
  }

  /** « Tout effacer » beside the Filtres title (the pane's, the sheet's), with a filter on: outside the heading. */
  #clearAll() {
    if (!activeFilterCount(this.#store.state.query)) return nothing;
    return html`<button class="link" type="button" @click=${this.#onClearAll}>Tout effacer</button>`;
  }

  /**
   * Every filter off: clearFilters called with nothing (given the click as its argument, it would take the event for
   * the search to clear). Its button goes with them: the focus it had to the sheet's « Voir N espèces » (said again
   * as its count changes), or the pane's first filter — not to the page. @param {Event} e
   */
  #onClearAll = (/** @type {Event} */ e) => {
    const button = /** @type {HTMLElement} */ (e.currentTarget);
    const focused = /** @type {ShadowRoot} */ (this.renderRoot).activeElement === button;
    const sheet = button.closest('dialog');
    clearFilters();
    if (!focused) return;
    if (sheet) /** @type {HTMLElement | null} */ (sheet.querySelector('.sheet-foot button'))?.focus();
    else /** @type {any} */ (this.renderRoot.querySelector('.pane.filters gf-filter-panel'))?.renderRoot.querySelector('gf-facet')?.focusHead();
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  /** @param {Pane} pane @param {boolean} right rail on the right edge */
  #rail(pane, right = false) {
    const active = pane === 'filters' ? activeFilterCount(this.#store.state.query) : 0;
    return html`<button class="rail ${right ? 'right' : ''}" type="button" aria-expanded="false"
      title=${'Déplier : ' + TITLES[pane]} @click=${() => {
        // The media viewer takes the filters' room: unfolding them closes it.
        if (pane === 'filters' && this.#pane !== null) this.#closePane();
        this.#fold(pane, false);
      }}>
      ${right ? '‹' : '›'} ${TITLES[pane]} ${active ? html`<span class="badge">${active}</span>` : nothing}</button>`;
  }

  /**
   * The head stays when there is nothing to fold (the list alone): the list does not move down when a plant opens.
   * @param {Pane} pane @param {any} title @param {any} [extra] @param {boolean} [fixed]
   */
  #head(pane, title, extra = nothing, fixed = false) {
    const right = pane === 'plant';
    // A plant open: its name is the view's h1, so the panes' names come before it as labels, not headings.
    return html`<div class="pane-head">
      ${this.#plantId === null ? html`<h2>${title}</h2>` : html`<div class="title">${title}</div>`}
      ${extra}
      <button class="icon-btn" type="button" aria-expanded="true" ?hidden=${fixed} title=${'Replier : ' + TITLES[pane]}
        aria-label=${'Replier le panneau ' + TITLES[pane].toLowerCase()} @click=${() => this.#fold(pane, true)}>${right ? '»' : '«'}</button>
    </div>`;
  }

  render() {
    const wide = this.#wide.matches;
    const phone = this.#phone.matches;
    const plantId = this.#plantId;
    if (plantId !== null) loadSheet();
    const folded = { filters: this.#sizer.folded('filters'), results: this.#sizer.folded('results'), plant: this.#sizer.folded('plant') };
    const total = this.#store.state.results.total;
    const showPlant = plantId !== null && !phone;
    const media = showPlant && this.#pane !== null;
    // Folding results while a plant is open gives the plant the room.
    const resultsFolded = folded.results && showPlant && !folded.plant;
    const plantFolded = showPlant && folded.plant;

    const plantView = this.#store.state.mode;

    // Phone, a plant open: its sheet covers the results (and the app's header, gf-app): out of reach (inert) until
    // it closes; above it, a block's pane covers the sheet in turn.
    const covered = phone && plantId !== null;

    return html`
      ${plantId === null ? html`<h1 class="visually-hidden">Flore : recherche</h1>` : nothing}
      <div class="panes">
        ${wide ? (folded.filters || media ? this.#rail('filters') : html`
          <section class="pane filters" id="flore-filters" aria-label="Filtres" style="width:${Math.min(this.#width('filters'), this.#max('filters'))}px">
            ${this.#head('filters', 'Filtres', this.#clearAll())}
            <div class="pane-body"><gf-filter-panel></gf-filter-panel></div>
          </section>
          ${this.#split('filters')}`) : nothing}

        ${media ? this.#paneSection(false) : nothing}
        ${resultsFolded ? (media ? nothing : this.#rail('results')) : html`
          <section class="pane results" aria-label="Résultats" ?hidden=${media} ?inert=${covered} @focus-facet=${this.#focusFacet}>
            ${phone ? nothing : this.#head('results', 'Résultats', nothing, !showPlant)}
            <div class="pane-body">
              <gf-results-bar .wide=${wide} ?grid=${this._grid} @open-filters=${() => openModal(this.#dialog)}></gf-results-bar>
              <gf-plant-list ?grid=${this._grid} .current=${plantId}></gf-plant-list>
            </div>
          </section>`}

        ${showPlant ? (plantFolded ? this.#rail('plant', true) : html`
          ${resultsFolded && !media ? nothing : this.#split('plant')}
          <section class="pane plant ${resultsFolded && !media ? 'fill' : ''}" id="flore-plant" aria-label="Plante" @open-pane=${this.#openPane}
            style=${resultsFolded && !media ? '' : `width:${Math.min(this.#width('plant'), this.#max('plant'))}px`}>
            ${this.#head('plant', 'Plante', html`
              <a class="icon-btn" href=${'#/plant/' + plantId} title="Ouvrir la fiche seule" aria-label="Ouvrir la fiche seule"
                @click=${e => { e.preventDefault(); this.#fold('results', true); }}>${icon('arrows-angle-expand')}</a>
              <button class="icon-btn" type="button" title="Fermer la fiche (Échap)" aria-label="Fermer la fiche" @click=${() => this.#closePlant()}>${icon('x-lg')}</button>`)}
            <div class="pane-body">${this.#swipe(plantId, plantView)}${this.#pager(false)}</div>
          </section>`) : nothing}
      </div>

      ${phone && plantId !== null ? html`
        <section class="sheet-plant" aria-label="Plante" tabindex="-1" ?inert=${this.#pane !== null} @open-pane=${this.#openPane}>
          <div class="pane-head">
            <button class="icon-btn" type="button" aria-label="Fermer la fiche" title="Fermer (Échap)" @click=${() => this.#closePlant()}>${icon('x-lg')}</button>
            <div class="title">Plante</div>
          </div>
          <div class="pane-body" style="display:flex;flex-direction:column;overflow:hidden;background:var(--gf-surface-2)">${this.#swipe(plantId, plantView, true)}${this.#pager(true)}</div>
        </section>` : nothing}

      ${phone && plantId !== null && this.#pane !== null ? this.#paneSection(true) : nothing}

      ${wide ? nothing : html`
        <dialog class="drawer rises" aria-label="Filtres" @click=${e => { if (e.target === e.currentTarget) this.#dialog?.close(); }}>
          <div class="sheet-head"><div class="sheet-title"><h2>Filtres</h2>${this.#clearAll()}</div></div>
          <div class="sheet-body"><gf-filter-panel></gf-filter-panel></div>
          <!-- « Voir N espèces » said as a filter changes: the results bar's count is out of reach while the sheet is open. -->
          <div class="sheet-foot" aria-live="polite" aria-atomic="true">
            <button class="primary large" type="button" @click=${() => this.#dialog?.close()}>
              Voir ${total.toLocaleString('fr-FR')} espèce${total > 1 ? 's' : ''}
            </button>
          </div>
        </dialog>`}
    `;
  }
}

customElements.define('gf-flora', GfFlora);
