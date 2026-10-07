// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { config } from '../config.js';
import { MediaController, PHONE_QUERY } from '../core/media.js';
import { activeFilterCount, clearFilters, lastSearchHash } from '../core/query.js';
import { StoreController } from '../core/store.js';
import { ui } from '../styles/ui.js';
import './gf-results-bar.js';
import './gf-filter-panel.js';
import './gf-plant-list.js';
import './gf-plant-detail.js';

/** Results pane narrower than this: cards instead of the grid. */
const GRID_MIN = 560;
const MIN = { filters: 220, results: 280, plant: 360 };
const MAX = { filters: 480 };
const DEFAULTS = { filters: 280, plant: 480, folded: { filters: false, results: false, plant: false } };
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
    _grid: { state: true }
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
    .plant .pane-body { display: flex; flex-direction: column; overflow: hidden; }

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
      inset: 0 0 calc(64px + env(safe-area-inset-bottom)) 0;
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
  /** The plant was opened from the list in this session: "← Résultats" can simply go back. */
  #fromList = false;

  constructor() {
    super();
    /** @type {any} */
    this.route = { name: 'search' };
    this._layout = readLayout();
    this._grid = false;
  }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (changed.has('route')) {
      const before = changed.get('route');
      if (this.route.name === 'plant') this.#fromList = before?.name === 'search' || (before?.name === 'plant' && this.#fromList);
      if (this.route.name === 'search') document.title = 'GeoFlora — flore de France';
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
    this.#resultsObserver.disconnect();
    this.#observed = null;
  }

  get #plantId() { return this.route.name === 'plant' ? this.route.id : null; }

  #save() {
    try { localStorage.setItem(config.storageKeys.floraLayout, JSON.stringify(this._layout)); } catch { /* not persisted */ }
  }

  /** @param {Pane} pane @param {boolean} folded */
  #fold(pane, folded) {
    this._layout = { ...this._layout, folded: { ...this._layout.folded, [pane]: folded } };
    this.#save();
  }

  #closePlant() {
    if (this.#phone.matches && this.#fromList) history.back();
    else location.hash = lastSearchHash();
  }

  // ── Resizing ───────────────────────────────────────────────────────────────

  /** Largest width a side pane may take, leaving the other panes their minimum. @param {'filters' | 'plant'} pane */
  #max(pane) {
    const total = this.renderRoot.querySelector('.panes')?.getBoundingClientRect().width || innerWidth;
    const { folded } = this._layout;
    const others = pane === 'filters'
      ? (folded.results ? 0 : MIN.results) + (this.#plantId && !folded.plant ? this._layout.plant : 0)
      : (folded.results ? 0 : MIN.results) + (this.#wide.matches ? (folded.filters ? 40 : this._layout.filters) : 0);
    return Math.max(MIN[pane], Math.min(MAX[pane] || Infinity, total - others - 16));
  }

  /** @param {'filters' | 'plant'} pane @param {number} width */
  #resize(pane, width) {
    const w = Math.round(Math.min(this.#max(pane), Math.max(MIN[pane], width)));
    if (w !== this._layout[pane]) this._layout = { ...this._layout, [pane]: w };
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
    const w0 = this._layout[pane];
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
      if (width !== this._layout[pane]) this._layout = { ...this._layout, [pane]: width };
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
    this.#resize(pane, this._layout[pane] + (pane === 'filters' ? dir : -dir) * step);
    this.#save();
  }

  /** @param {'filters' | 'plant'} pane */
  #split(pane) {
    return html`<div class="split" role="separator" aria-orientation="vertical" tabindex="0"
      aria-label=${'Largeur du panneau ' + TITLES[pane].toLowerCase()} aria-valuenow=${this._layout[pane]}
      aria-valuemin=${MIN[pane]} title="Glisser pour redimensionner · double-clic : largeur par défaut"
      @pointerdown=${e => this.#startDrag(e, pane)}
      @keydown=${e => this.#keyResize(e, pane)}
      @dblclick=${() => { this._layout = { ...this._layout, [pane]: DEFAULTS[pane] }; this.#save(); }}></div>`;
  }

  // ── Filters ────────────────────────────────────────────────────────────────

  get #dialog() { return /** @type {HTMLDialogElement | null} */ (this.renderRoot.querySelector('dialog')); }

  /** A column's funnel: bring its filter into view (unfolding the pane or opening the sheet). @param {CustomEvent} e */
  async #focusFacet(e) {
    const facet = e.detail.facet;
    if (this.#wide.matches) {
      if (this._layout.folded.filters) this.#fold('filters', false);
    } else {
      this.#dialog?.showModal();
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
      title=${'Déplier : ' + TITLES[pane]} @click=${() => this.#fold(pane, false)}>
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
    // Folding results while a plant is open gives the plant the room.
    const resultsFolded = folded.results && showPlant && !folded.plant;
    const plantFolded = showPlant && folded.plant;

    const plantDetail = html`<gf-plant-detail embedded plant-id=${plantId}></gf-plant-detail>`;

    return html`
      <div class="panes">
        ${wide ? (folded.filters ? this.#rail('filters') : html`
          <section class="pane filters" aria-label="Filtres" style="width:${this._layout.filters}px">
            ${this.#head('filters', this.#filtersTitle())}
            <div class="pane-body"><gf-filter-panel></gf-filter-panel></div>
          </section>
          ${this.#split('filters')}`) : nothing}

        ${resultsFolded ? this.#rail('results') : html`
          <section class="pane results" aria-label="Résultats" @focus-facet=${this.#focusFacet}>
            ${showPlant ? this.#head('results', 'Résultats') : nothing}
            <div class="pane-body">
              <gf-results-bar .wide=${wide} ?grid=${this._grid} @open-filters=${() => this.#dialog?.showModal()}></gf-results-bar>
              <gf-plant-list ?grid=${this._grid} .current=${plantId}></gf-plant-list>
            </div>
          </section>`}

        ${showPlant ? (plantFolded ? this.#rail('plant', true) : html`
          ${resultsFolded ? nothing : this.#split('plant')}
          <section class="pane plant ${resultsFolded ? 'fill' : ''}" aria-label="Plante" style=${resultsFolded ? '' : `width:${this._layout.plant}px`}>
            ${this.#head('plant', 'Plante', html`
              <a class="icon-btn" href=${'#/plant/' + plantId} title="Ouvrir la fiche seule" aria-label="Ouvrir la fiche seule"
                @click=${e => { e.preventDefault(); this.#fold('results', true); }}>⤢</a>
              <button class="icon-btn" type="button" title="Fermer la fiche" aria-label="Fermer la fiche" @click=${() => this.#closePlant()}>×</button>`)}
            <div class="pane-body">${plantDetail}</div>
          </section>`) : nothing}
      </div>

      ${phone && plantId !== null ? html`
        <section class="sheet-plant" aria-label="Plante">
          <div class="pane-head">
            <button class="link back" type="button" @click=${() => this.#closePlant()}>← Résultats</button>
            <h2></h2>
          </div>
          <div class="pane-body" style="display:flex;flex-direction:column;overflow:hidden">${plantDetail}</div>
        </section>` : nothing}

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
