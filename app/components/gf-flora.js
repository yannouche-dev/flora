// @ts-check
import { LitElement, html, css, nothing, repeat } from 'lit';
import { config } from '../config.js';
import { MediaController, PHONE_QUERY } from '../core/media.js';
import { activeFilterCount, clearFilters, lastSearchHash } from '../core/query.js';
import { href } from '../core/router.js';
import { backTo, depth, openModal } from '../core/history.js';
import { plantViewOf, setPlantView, StoreController } from '../core/store.js';
import { ui } from '../styles/ui.js';
import './gf-results-bar.js';
import './gf-filter-panel.js';
import './gf-plant-list.js';
import './gf-plant-detail.js';
import './gf-mode-switch.js';
import './gf-pager.js';
import './gf-media-viewer.js';
import { icon } from '../core/icons.js';
import { blockTitle, blocksAt, hasColumns } from '../core/sheet-blocks.js';

/** Results pane narrower than this: cards instead of the grid. */
const GRID_MIN = 560;
const MIN = { filters: 220, results: 280, plant: 360 };
const MAX = { filters: 480 };
const DEFAULTS = { filters: 280, plant: 480, plantPinned: 900, folded: { filters: false, results: false, plant: false } };
const TITLES = { filters: 'Filtres', results: 'Résultats', plant: 'Plante' };

/** @typedef {'filters' | 'results' | 'plant'} Pane */

function readLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(config.storageKeys.floraLayout) || 'null') || {};
    return { ...DEFAULTS, ...saved, folded: { ...DEFAULTS.folded, ...saved.folded } };
  } catch { return structuredClone(DEFAULTS); }
}

/**
 * The Flore tab. Desktop: Filtres ┃ Résultats ┃ Plante, each pane foldable (vertical rail) and resizable
 * (drag the separators, or focus one and use ←/→; double-click resets). Tablet: filters in a bottom sheet,
 * Résultats ┃ Plante. Phone: results, the plant sliding over them full screen.
 * The list stays mounted while a plant is open, so its scroll position is kept.
 */
export class GfFlora extends LitElement {
  static properties = {
    route: { attribute: false },
    _layout: { state: true },
    _grid: { state: true },
    _under: { state: true },
    _paneFull: { state: true }
  };

  static styles = [ui, css`
    :host { display: flex; flex-direction: column; min-height: 0; flex: 1; }
    .panes { display: flex; flex: 1; min-height: 0; position: relative; }
    /* Resize guide: follows the pointer while a separator is dragged. */
    .guide {
      position: absolute;
      top: 0;
      bottom: 0;
      left: -1px;
      width: 3px;
      background: var(--gf-accent);
      z-index: 5;
      pointer-events: none;
      will-change: transform;
    }
    .guide span {
      position: absolute;
      top: 50%;
      left: 8px;
      padding: 2px 8px;
      border-radius: var(--gf-radius-pill);
      background: var(--gf-accent);
      color: var(--gf-accent-contrast);
      font-size: 0.75rem;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
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
    .pane-head h2 { margin: 0; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--gf-text-muted); flex: 1; display: flex; gap: 8px; align-items: center; }
    .pane-head .icon-btn { width: 32px; height: 32px; font-size: 1rem; }
    /* Each pane lays out on its own: resizing one does not re-lay out the content of the others. */
    .pane-body { flex: 1; min-height: 0; overflow-y: auto; contain: strict; }
    .filters .pane-body { padding: 0 14px 24px; }
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

    /* Separators between panes: drag to resize. */
    .split {
      flex: none;
      width: 7px;
      margin: 0 -3px;
      z-index: 3;
      cursor: col-resize;
      position: relative;
      touch-action: none;
    }
    .split::after {
      content: '';
      position: absolute;
      inset: 0 3px;
      background: var(--gf-border);
      transition: background 0.12s;
    }
    .split:hover::after, .split:focus-visible::after, .split.dragging::after { background: var(--gf-accent); inset: 0 2px; }
    .split:focus-visible { outline: none; }
    :host(.resizing) { cursor: col-resize; user-select: none; }

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
    .sheet-plant .back { font-weight: 600; }
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
    dialog {
      position: fixed;
      inset: auto 0 0 0;
      width: 100%;
      max-width: 640px;
      max-height: 88dvh;
      margin: 0 auto;
      padding: 0;
      border: 0;
      border-radius: var(--gf-radius-lg) var(--gf-radius-lg) 0 0;
      background: var(--gf-surface);
      color: var(--gf-text);
      display: none;
      flex-direction: column;
    }
    dialog[open] { display: flex; animation: slide-up 0.2s ease-out; }
    dialog::backdrop { background: rgb(0 0 0 / 40%); }
    @keyframes slide-up { from { transform: translateY(40px); opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { dialog[open] { animation: none; } }
    .sheet-head { padding: 4px 16px 0; border-bottom: 1px solid var(--gf-border); }
    .sheet-head::before { content: ''; display: block; width: 36px; height: 4px; margin: 6px auto 0; border-radius: 2px; background: var(--gf-border); }
    .sheet-head h2 { font-size: 1rem; margin: 12px 0 8px; display: flex; align-items: center; }
    .sheet-head h2 .link { margin-left: auto; }
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
  /** Depth in history of the list the plant was opened from (null: opened from elsewhere). @type {number | null} */
  #listDepth = null;

  constructor() {
    super();
    /** @type {any} */
    this.route = { name: 'search' };
    this._layout = readLayout();
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
    // Each plant is a view: Back returns to the one before (« Résultats » goes straight to the list).
    // The pane stays open (the next plant's map, media…).
    const go = () => { location.hash = this.#paneInUrl ? href.plantPane(id, /** @type {string} */ (/** @type {any} */ (this.route).pane)) : href.plant(id); };
    if (!card || this.#reducedMotion.matches) { this._under = null; go(); return; }
    if (this.#moving) return;
    this.#moving = true;
    this._under = id;
    const deck = /** @type {HTMLElement | null} */ (card.parentElement);
    if (deck?.classList.contains('fade')) {
      // Fade in only once the next sheet has its plant (it reads it from the local database).
      await this.updateComplete;
      const next = /** @type {any} */ (deck.querySelector('.swipe.under gf-plant-detail'));
      for (let i = 0; i < 20 && next && next._plant === undefined; i++) await new Promise(r => setTimeout(r, 15));
      deck.classList.add('go');
      setTimeout(() => { this.#moving = false; go(); }, 340);
      return;
    }
    deck?.classList.add('easing');
    deck?.style.setProperty('--p', '1');
    card.classList.remove('dragging', 'settle');
    card.classList.add('fly-' + dir);
    // The card underneath (same element, its sheet loaded) becomes the sheet; the deck is reset as it does.
    setTimeout(() => { this.#moving = false; go(); }, 300);
  }

  /** A move to the previous / next plant is playing. */
  #moving = false;

  /** ← → on the keyboard, when not typing. @param {KeyboardEvent} e */
  #onKey = e => {
    // The media viewer browses its own images with ← →.
    if (this.#pane === 'media') return;
    if (this.#plantId === null || e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const target = /** @type {HTMLElement} */ (e.composedPath()[0]);
    if (target?.closest?.('input, textarea, select, [contenteditable], gf-map') || target?.isContentEditable) return;
    e.preventDefault();
    this.#step(e.key === 'ArrowLeft' ? 'prev' : 'next');
  };

  /** Swipe: a mostly horizontal stroke on the sheet, not started on a map, a field or something that scrolls sideways. */
  #touch = /** @type {{ x: number, y: number, t: number, el: HTMLElement } | null} */ (null);

  /** @param {TouchEvent} e */
  #onTouchStart(e) {
    if (e.touches.length !== 1) { this.#touch = null; return; }
    const path = /** @type {HTMLElement[]} */ (e.composedPath());
    const blocked = path.some(el => el instanceof HTMLElement && (el.matches('input, textarea, select, gf-map, .gallery, .leaflet-container')
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
      ><gf-plant-detail embedded ?preview=${id === under} plant-id=${id} view=${view} .inPane=${id === this.#plantId ? this.#pane : null}></gf-plant-detail></div>`)}</div>`;
  }


  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (changed.has('route')) {
      const before = changed.get('route');
      // The list's place in history: from the search to a plant, kept while stepping plant to plant.
      if (this.route.name === 'plant') this.#listDepth = before?.name === 'search' ? depth() - 1 : before?.name === 'plant' ? this.#listDepth : null;
      // Another plant (the card underneath came up, or Back): nothing waits under it any more.
      if ((before?.name === 'plant' ? before.id : null) !== this.#plantId) {
        this._under = null;
        // In the same update as the swap, so no frame shows the card underneath shrunk back or faded.
        const deck = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.deck'));
        deck?.classList.remove('easing', 'go');
        deck?.style.removeProperty('--p');
      }
      if (this.route.name === 'search') document.title = 'GeoFlora — flore de France';
      // Pane closed (Back): not full screen any more; a pane opened by a link is not ours to go back from.
      if (!this.#paneInUrl) { this.#panePushed = false; this.#paneStart = null; }
      if (this.#pane === null) this._paneFull = false;
    }
  }

  updated() {
    const results = this.renderRoot.querySelector('.pane.results');
    if (results && results !== this.#observed) {
      this.#resultsObserver.disconnect();
      this.#resultsObserver.observe(results);
      this.#observed = results;
    }
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
  // ?pane=<block> in the address (⤢ on a block, a photo touched for « Médias »), or the first block placed
  // « en volet » for this mode (Mode King), opened with the plant on a wide screen.

  /** The block in the pane, null when there is none. */
  get #pane() {
    if (this.route.name !== 'plant') return null;
    if (this.route.pane) return this.route.pane;
    if (this.#phone.matches || this.#dismissed === this.route.id) return null;
    return blocksAt(plantViewOf(this.#store.state), 'beside')[0] ?? null;
  }

  /** The pane comes from the address (else from the layout, and closing it only puts it away for this plant). */
  get #paneInUrl() { return this.route.name === 'plant' && Boolean(this.route.pane); }

  /** A placed pane closed for this plant. @type {number | null} */
  #dismissed = null;
  /** The image touched on the sheet, for the media viewer to open at. @type {string | null} */
  #paneStart = null;
  /** The pane was opened from the sheet (a step in history: closing it goes back). */
  #panePushed = false;

  /** ⤢ on a block, or a photo touched. @param {CustomEvent} e */
  #openPane = e => {
    const id = this.#plantId;
    if (id === null || e.detail?.plantId !== id) return;
    e.preventDefault();
    const key = e.detail.key;
    this.#paneStart = e.detail.url || null;
    if (this.#pane === key && this.#paneInUrl) { this.requestUpdate(); return; }
    if (this.#paneInUrl) { location.replace(href.plantPane(id, key)); return; }
    this.#panePushed = true;
    location.hash = href.plantPane(id, key);
  };

  /** The media viewer moved to another image: the address follows (no new step in history). @param {CustomEvent} e */
  #mediaIndex = e => {
    const id = this.#plantId;
    if (id === null || !this.#paneInUrl || this.#pane !== 'media') return;
    const url = href.plantPane(id, 'media', e.detail.index);
    if (location.hash !== url) history.replaceState(history.state, '', url);
  };

  #closePane = () => {
    const id = this.#plantId;
    this._paneFull = false;
    this.#paneStart = null;
    if (!this.#paneInUrl) { this.#dismissed = id; this.requestUpdate(); return; }
    if (this.#panePushed) { this.#panePushed = false; history.back(); }
    else if (id !== null) location.replace(href.plant(id));
  };

  /** The pane: its bar (block, plant, full screen, close) and the block alone. @param {boolean} phone */
  #paneSection(phone) {
    const id = this.#plantId, key = /** @type {string} */ (this.#pane);
    const view = plantViewOf(this.#store.state);
    const route = /** @type {any} */ (this.route);
    return html`<section class=${phone ? 'sheet-pane' : `pane block-pane ${this._paneFull ? 'full' : ''}`} aria-label=${blockTitle(key)}
        @media-index=${this.#mediaIndex} @media-close=${this.#closePane}>
      <div class="pane-head">
        ${phone ? html`<button class="link back" type="button" @click=${this.#closePane}>${icon('arrow-left')} Fiche</button>` : nothing}
        <h2>${blockTitle(key)} <span class="pane-plant">${this.#paneName}</span></h2>
        ${phone ? nothing : html`<button class="icon-btn" type="button" aria-pressed=${String(this._paneFull)} title=${this._paneFull ? 'Quitter le plein écran' : 'Plein écran'}
          aria-label="Plein écran" @click=${() => { this._paneFull = !this._paneFull; }}>${icon(this._paneFull ? 'fullscreen-exit' : 'arrows-fullscreen')}</button>`}
        <button class="icon-btn" type="button" title="Fermer le volet" aria-label="Fermer le volet" @click=${this.#closePane}>${icon('x-lg')}</button>
      </div>
      <gf-plant-detail embedded only=${key} plant-id=${id} view=${view} .paneAt=${route.at ?? null} .paneStart=${this.#paneStart}></gf-plant-detail>
    </section>`;
  }

  /** The plant's scientific name, for the pane's title (from the results, when it is among them). */
  get #paneName() {
    const id = this.#plantId;
    return this.#store.state.results.items.find(p => p.id === id)?.scientificName || '';
  }

  #save() {
    try { localStorage.setItem(config.storageKeys.floraLayout, JSON.stringify(this._layout)); } catch { /* not persisted */ }
  }

  /** @param {Pane} pane @param {boolean} folded */
  #fold(pane, folded) {
    this._layout = { ...this._layout, folded: { ...this._layout.folded, [pane]: folded } };
    this.#save();
  }

  #closePlant() {
    // Back to the list (past the plants browsed with ‹ ›), else to the search as a new view.
    backTo(this.#listDepth, lastSearchHash());
  }

  // ── Resizing ───────────────────────────────────────────────────────────────

  /**
   * Where a pane's width is kept: the plant pane has a second one, wider, for a sheet with pinned blocks
   * (the sheet and its pinned map side by side). @param {'filters' | 'plant'} pane @returns {'filters' | 'plant' | 'plantPinned'}
   */
  #key(pane) {
    return pane === 'plant' && hasColumns(plantViewOf(this.#store.state)) ? 'plantPinned' : pane;
  }

  /** @param {'filters' | 'plant'} pane */
  #width(pane) { return this._layout[this.#key(pane)] ?? DEFAULTS[this.#key(pane)]; }

  /** Largest width a side pane may take, leaving the other panes their minimum. @param {'filters' | 'plant'} pane */
  #max(pane) {
    const total = this.renderRoot.querySelector('.panes')?.getBoundingClientRect().width || innerWidth;
    const { folded } = this._layout;
    const others = pane === 'filters'
      ? (folded.results ? 0 : MIN.results) + (this.#plantId && !folded.plant ? this.#width('plant') : 0)
      : (folded.results ? 0 : MIN.results) + (this.#wide.matches ? (folded.filters ? 40 : this._layout.filters) : 0);
    return Math.max(MIN[pane], Math.min(MAX[pane] || Infinity, total - others - 16));
  }

  /** @param {'filters' | 'plant'} pane @param {number} width */
  #resize(pane, width) {
    const w = Math.round(Math.min(this.#max(pane), Math.max(MIN[pane], width)));
    if (w !== this.#width(pane)) this._layout = { ...this._layout, [this.#key(pane)]: w };
  }

  /**
   * Dragging moves a guide line only; the panes take the new width once, on release. Reflowing the results and
   * the plant sheet (photos, map) on every frame froze the page.
   * @param {PointerEvent} e @param {'filters' | 'plant'} pane
   */
  #startDrag(e, pane) {
    if (e.button !== 0) return;
    const handle = /** @type {HTMLElement} */ (e.currentTarget);
    const el = this.renderRoot.querySelector(`.pane.${pane}`);
    const panes = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.panes'));
    if (!el || !panes) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    this.classList.add('resizing');
    const box = panes.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const x0 = e.clientX;
    const w0 = Math.min(this.#width(pane), this.#max(pane));
    const max = this.#max(pane);
    const guide = document.createElement('div');
    guide.className = 'guide';
    const label = guide.appendChild(document.createElement('span'));
    panes.append(guide);
    let width = w0;
    let frame = 0;
    const paint = () => {
      frame = 0;
      const edge = pane === 'filters' ? rect.left + width : rect.right - width;
      guide.style.transform = `translateX(${Math.round(edge - box.left)}px)`;
      label.textContent = width + ' px';
    };
    paint();
    const move = (/** @type {PointerEvent} */ ev) => {
      const dx = ev.clientX - x0;
      width = Math.round(Math.min(max, Math.max(MIN[pane], pane === 'filters' ? w0 + dx : w0 - dx)));
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const end = () => {
      cancelAnimationFrame(frame);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      handle.classList.remove('dragging');
      this.classList.remove('resizing');
      guide.remove();
      if (width !== this.#width(pane)) this._layout = { ...this._layout, [this.#key(pane)]: width };
      this.#save();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  /** @param {KeyboardEvent} e @param {'filters' | 'plant'} pane */
  #keyResize(e, pane) {
    const step = e.shiftKey ? 64 : 16;
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    this.#resize(pane, Math.min(this.#width(pane), this.#max(pane)) + (pane === 'filters' ? dir : -dir) * step);
    this.#save();
  }

  /** @param {'filters' | 'plant'} pane */
  #split(pane) {
    return html`<div class="split" role="separator" aria-orientation="vertical" tabindex="0"
      aria-label=${'Largeur du panneau ' + TITLES[pane].toLowerCase()} aria-valuenow=${this.#width(pane)}
      aria-valuemin=${MIN[pane]} title="Glisser pour redimensionner · double-clic : largeur par défaut"
      @pointerdown=${e => this.#startDrag(e, pane)}
      @keydown=${e => this.#keyResize(e, pane)}
      @dblclick=${() => { this._layout = { ...this._layout, [this.#key(pane)]: DEFAULTS[this.#key(pane)] }; this.#save(); }}></div>`;
  }

  // ── Filters ────────────────────────────────────────────────────────────────

  get #dialog() { return /** @type {HTMLDialogElement | null} */ (this.renderRoot.querySelector('dialog')); }

  /** A column's funnel: bring its filter into view (unfolding the pane or opening the sheet). @param {CustomEvent} e */
  async #focusFacet(e) {
    const facet = e.detail.facet;
    if (this.#wide.matches) {
      if (this._layout.folded.filters) this.#fold('filters', false);
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

  #filtersTitle() {
    const active = activeFilterCount(this.#store.state.query);
    return html`Filtres ${active ? html`<button class="link" type="button" @click=${clearFilters}>Tout effacer</button>` : nothing}`;
  }

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

  /** @param {Pane} pane @param {any} title @param {any} [extra] */
  #head(pane, title, extra = nothing) {
    const right = pane === 'plant';
    return html`<div class="pane-head">
      <h2>${title}</h2>
      ${extra}
      <button class="icon-btn" type="button" aria-expanded="true" title=${'Replier : ' + TITLES[pane]}
        aria-label=${'Replier le panneau ' + TITLES[pane].toLowerCase()} @click=${() => this.#fold(pane, true)}>${right ? '»' : '«'}</button>
    </div>`;
  }

  render() {
    const wide = this.#wide.matches;
    const phone = this.#phone.matches;
    const plantId = this.#plantId;
    const { folded } = this._layout;
    const total = this.#store.state.results.total;
    const showPlant = plantId !== null && !phone;
    const media = showPlant && this.#pane !== null;
    // Folding results while a plant is open gives the plant the room.
    const resultsFolded = folded.results && showPlant && !folded.plant;
    const plantFolded = showPlant && folded.plant;

    const plantView = plantViewOf(this.#store.state);
    const plantSwitch = html`<gf-mode-switch scope="la fiche" value=${plantView} ?overridden=${this.#store.state.plantView !== null}
      @mode-change=${e => setPlantView(e.detail.mode)}></gf-mode-switch>`;

    return html`
      <div class="panes">
        ${wide ? (folded.filters || media ? this.#rail('filters') : html`
          <section class="pane filters" aria-label="Filtres" style="width:${this._layout.filters}px">
            ${this.#head('filters', this.#filtersTitle())}
            <div class="pane-body"><gf-filter-panel></gf-filter-panel></div>
          </section>
          ${this.#split('filters')}`) : nothing}

        ${media ? this.#paneSection(false) : nothing}
        ${resultsFolded ? (media ? nothing : this.#rail('results')) : html`
          <section class="pane results" aria-label="Résultats" ?hidden=${media} @focus-facet=${this.#focusFacet}>
            ${showPlant ? this.#head('results', 'Résultats') : nothing}
            <div class="pane-body">
              <gf-results-bar .wide=${wide} ?grid=${this._grid} @open-filters=${() => openModal(this.#dialog)}></gf-results-bar>
              <gf-plant-list ?grid=${this._grid} .current=${plantId}></gf-plant-list>
            </div>
          </section>`}

        ${showPlant ? (plantFolded ? this.#rail('plant', true) : html`
          ${resultsFolded && !media ? nothing : this.#split('plant')}
          <section class="pane plant ${resultsFolded && !media ? 'fill' : ''}" aria-label="Plante" @open-pane=${this.#openPane}
            style=${resultsFolded && !media ? '' : `width:${Math.min(this.#width('plant'), this.#max('plant'))}px`}>
            ${this.#head('plant', 'Plante', html`
              ${plantSwitch}
              <a class="icon-btn" href=${'#/plant/' + plantId} title="Ouvrir la fiche seule" aria-label="Ouvrir la fiche seule"
                @click=${e => { e.preventDefault(); this.#fold('results', true); }}>${icon('arrows-angle-expand')}</a>
              <button class="icon-btn" type="button" title="Fermer la fiche" aria-label="Fermer la fiche" @click=${() => this.#closePlant()}>${icon('x-lg')}</button>`)}
            <div class="pane-body">${this.#swipe(plantId, plantView)}${this.#pager(false)}</div>
          </section>`) : nothing}
      </div>

      ${phone && plantId !== null ? html`
        <section class="sheet-plant" aria-label="Plante" @open-pane=${this.#openPane}>
          <div class="pane-head">
            <button class="link back" type="button" @click=${() => this.#closePlant()}>${icon('arrow-left')} Résultats</button>
            <h2></h2>
            ${plantSwitch}
          </div>
          <div class="pane-body" style="display:flex;flex-direction:column;overflow:hidden;background:var(--gf-surface-2)">${this.#swipe(plantId, plantView, true)}${this.#pager(true)}</div>
        </section>` : nothing}

      ${phone && plantId !== null && this.#pane !== null ? this.#paneSection(true) : nothing}

      ${wide ? nothing : html`
        <dialog aria-label="Filtres" @click=${e => { if (e.target === e.currentTarget) this.#dialog?.close(); }}>
          <div class="sheet-head"><h2>${this.#filtersTitle()}</h2></div>
          <div class="sheet-body"><gf-filter-panel></gf-filter-panel></div>
          <div class="sheet-foot">
            <button class="primary large" type="button" @click=${() => this.#dialog?.close()}>
              Voir ${total.toLocaleString('fr-FR')} espèce${total > 1 ? 's' : ''}
            </button>
          </div>
        </dialog>`}
    `;
  }
}

customElements.define('gf-flora', GfFlora);
