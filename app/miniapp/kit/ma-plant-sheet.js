// @ts-check
// A plant open over the cards of a mini-app around a place (the address's ?p=): its sheet, over the list on a phone,
// beside it on a wide screen (its width the user's: a separator, core/panes.js, kept in the mini-app's own storage,
// `layout-key`, which « Recommencer » forgets); « ‹ Préc. » and « Suivante › » through the cards it was opened from, a quick sideways
// swipe or ← → too; Échap or ← (the head's arrow) closes it. Over a start screen (a link with a plant), the sheet
// alone. It never navigates: the event `ma-plant` (detail.id: the plant to show, null: closed) goes up to the box,
// which keeps the address (Back closes a plant opened here).

import { LitElement, html, css, nothing } from 'lit';
import * as db from '../../core/db.js';
import { icon } from '../../core/icons.js';
import { PaneSizer, splitStyles } from '../../core/panes.js';
import { whenReady } from '../../core/store.js';
import { ui } from '../../styles/ui.js';
import { nameOf } from './cards.js';
import '../../components/gf-plant-detail.js';

export class MaPlantSheet extends LitElement {
  static properties = {
    /** The plant shown. */
    open: { type: Number },
    /** The cards it steps through (none: no pager). */
    cards: { attribute: false },
    /** In a mini-app's box (always): the sheet keeps to it (gf-plant-detail `scoped`). */
    scoped: { type: Boolean },
    /** Where the sheet's width is kept (wide screens; none: not resizable). */
    layoutKey: { type: String, attribute: 'layout-key' },
    /** The plant's name when it is not among the cards (a link): read from the flora. */
    _name: { state: true }
  };

  static styles = [ui, splitStyles, css`
    :host { display: contents; }
    /* The plant: over the list on a phone; beside it on a wide screen, its width the user's (the separator on its edge). */
    .sheet { position: fixed; inset: 0; z-index: 950; display: flex; background: var(--gf-surface); }
    .body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    @media (min-width: 900px) {
      .sheet { left: auto; top: var(--top, 56px); border-left: 1px solid var(--gf-border); box-shadow: var(--gf-shadow-float); }
      .body { flex: none; width: var(--w-sheet, calc(min(560px, 48vw) - 1px)); }
      .sheet > .split { position: absolute; top: 0; bottom: 0; left: -4px; margin: 0; }
    }
    @media (min-width: 900px) and (pointer: coarse) { .sheet > .split { left: -22px; } }
    .sheet-head { flex: none; display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--gf-border); }
    .sheet-head strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sheet gf-plant-detail { flex: 1; min-height: 0; }
    .pager { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px calc(6px + env(safe-area-inset-bottom)); border-top: 1px solid var(--gf-border); background: var(--gf-surface); }
    .pager span { color: var(--gf-text-muted); font-size: 0.85rem; font-variant-numeric: tabular-nums; }
    .pager button { display: inline-flex; align-items: center; gap: 4px; }
  `];

  constructor() {
    super();
    /** @type {number | null} */
    this.open = null;
    /** @type {import('./cards.js').Card[]} */
    this.cards = [];
    this.scoped = false;
    /** @type {string | null} */
    this.layoutKey = null;
    /** @type {string | null} */
    this._name = null;
  }

  /** @type {PaneSizer | null} */ #sizer = null;

  connectedCallback() {
    super.connectedCallback();
    addEventListener('keydown', this.#onKey);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    removeEventListener('keydown', this.#onKey);
  }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (changed.has('layoutKey') && this.layoutKey && !this.#sizer) {
      this.#sizer = new PaneSizer(this, this.layoutKey, { sheet: { width: 560, min: 360, title: 'Plante' } });
    }
    // Opened from a link, not among the cards: its name read from the flora for the header.
    const id = this.open;
    if (changed.has('open') && id != null && !this.cards.some(c => c.plant.id === id)) {
      whenReady().then(() => db.get('plants', id)).then(p => { if (p && this.open === id) this._name = nameOf(p); }, () => {});
    }
  }

  #onKey = (/** @type {KeyboardEvent} */ e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || this.open == null) return;
    const t = /** @type {HTMLElement} */ (e.composedPath()[0]);
    if (t?.closest?.('input, textarea, select, [contenteditable], gf-media-viewer')) return;
    // Bare: → keeps the plant and goes on, ← passes it — as with the cards.
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); this.#step(e.key === 'ArrowRight' ? 1 : -1); }
    else if (e.key === 'Escape') { e.preventDefault(); this.#show(null); }
  };

  /** @param {number | null} id */
  #show(id) { this.dispatchEvent(new CustomEvent('ma-plant', { detail: { id }, bubbles: true, composed: true })); }

  /** The next (or previous) plant of the cards. @param {number} dir */
  #step(dir) {
    const at = this.cards.findIndex(c => c.plant.id === this.open);
    const next = this.cards[at + dir];
    if (next) this.#show(next.plant.id);
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

  /** Wide: the sheet's width (the one chosen, else min(560 px, 48 %)), the list keeping 320 px. */
  get #wide() { return this.#sizer != null && matchMedia('(min-width: 900px)').matches; }
  get #max() { return Math.max(360, innerWidth - 320); }

  /** The width shown, and told to the list beside it (it keeps clear of the sheet). */
  updated() {
    const host = /** @type {HTMLElement | undefined} */ (/** @type {any} */ (this.getRootNode()).host);
    const w = this.#wide ? /** @type {PaneSizer} */ (this.#sizer).state.widths.sheet : undefined;
    if (w != null) host?.style.setProperty('--ma-sheet-w', Math.max(360, Math.min(w, this.#max)) + 1 + 'px');
    else host?.style.removeProperty('--ma-sheet-w');
  }

  render() {
    if (this.open == null) return nothing;
    const list = this.cards;
    const at = list.findIndex(c => c.plant.id === this.open);
    const name = at >= 0 ? nameOf(list[at].plant) : this._name || '';
    const z = this.#wide ? this.#sizer : null;
    if (z) z.panes.sheet.width = Math.round(Math.min(560, 0.48 * innerWidth) - 1);
    const w = z?.state.widths.sheet;
    return html`<section class="sheet" aria-label="Plante" @touchstart=${this.#touchStart} @touchend=${this.#touchEnd}>
      ${z ? z.split('sheet', 'right', () => this.#max, 'ma-sheet-body') : nothing}
      <div class="body" id="ma-sheet-body" style=${w != null && z ? `--w-sheet: ${Math.max(360, Math.min(w, this.#max))}px` : ''}>
      <div class="sheet-head">
        <button class="icon-btn" type="button" aria-label="Retour aux plantes autour" title="Retour (Échap)" @click=${() => this.#show(null)}>${icon('arrow-left')}</button>
        <strong>${name || 'Plante'}</strong>
      </div>
      <gf-plant-detail embedded plant-id=${this.open} view="epure" ?scoped=${this.scoped}></gf-plant-detail>
      ${at >= 0 ? html`<nav class="pager" aria-label="Plantes autour">
        <button class="secondary prev" type="button" ?disabled=${at <= 0} @click=${() => this.#step(-1)}>${icon('chevron-left')} Préc.</button>
        <span>${at + 1} / ${list.length}</span>
        <button class="primary next" type="button" ?disabled=${at >= list.length - 1} @click=${() => this.#step(1)}>Suivante ${icon('chevron-right')}</button>
      </nav>` : nothing}
      </div>
    </section>`;
  }
}

customElements.define('ma-plant-sheet', MaPlantSheet);
