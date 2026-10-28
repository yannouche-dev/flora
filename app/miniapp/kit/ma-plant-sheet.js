// @ts-check
// A plant open over the cards of a mini-app around a place (the address's ?p=): its sheet, over the list on a phone,
// beside it on a wide screen (its width the user's: a separator, core/panes.js, kept in the mini-app's own storage,
// `layout-key`, which « Recommencer » forgets); « ‹ Préc. » and « Suivante › » through the cards it was opened from, a quick sideways
// swipe or ← → too; Échap or its × (« Fermer la fiche ») closes it. Over a start screen (a link with a plant), the sheet
// alone. It never navigates: the event `ma-plant` (detail.id: the plant to show, null: closed) goes up to the box,
// which keeps the address (another plant: a new entry, Back returns to it). It keeps no plant of its own: the one it
// shows is `open`, the pager's place is that plant's among the cards. Its « Médias » open at `mediaAt` (&m=), and say
// the image shown (the event media-index, for the address). `simple` (Orchidées de Mirabel): only its « Médias » (the
// viewer, a block of the sheet: it takes ← → once touched, never the focus by itself, and Échap still closes the sheet
// unless the viewer uses it — zoomed, its information shown) and its rubric « L'essentiel », each of its blocks alone,
// titled as the sheet titles it (gf-plant-detail `only` `titled`: no layout of the sheet read for its places, none
// written) — as the Épuré sheet orders them on this device, those folded there left out, and those it leaves out
// when they are empty. takeFocus(): the focus into the sheet (its plant touched: the screen that opened it).

import { LitElement, html, css, nothing } from 'lit';
import { getPlant } from '../../core/plants.js';
import { icon } from '../../core/icons.js';
import { blockOrder, blockStyle, blockTitle, isHidden } from '../../core/sheet-blocks.js';
import { blockCategory, categoryOf } from '../../core/categories.js';
import { moduleOn } from '../../core/modules.js';
import { fr } from '../../core/fr.js';
import { PaneSizer, splitStyles } from '../../core/panes.js';
import { whenReady } from '../../core/store.js';
import { modalOpen } from '../../core/history.js';
import { ui } from '../../styles/ui.js';
import { nameOf } from './cards.js';
import '../../components/gf-plant-detail.js';
import '../../components/gf-media-viewer.js';

export class MaPlantSheet extends LitElement {
  static properties = {
    /** The plant shown. */
    open: { type: Number },
    /** The image its « Médias » open at: its place among the plant's media (the address's &m=). */
    mediaAt: { type: Number },
    /** The cards it steps through (none: no pager). */
    cards: { attribute: false },
    /** In an activity's box (always): the sheet keeps to it (gf-plant-detail `scoped`). */
    scoped: { type: Boolean },
    /** Where the sheet's width is kept (wide screens; none: not resizable). */
    layoutKey: { type: String, attribute: 'layout-key' },
    /** Only its « Médias » and its rubric « L'essentiel » (see above). */
    simple: { type: Boolean },
    /** The plant's name when it is not among the cards (a link; filtered out since): read from the flora. */
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
    .sheet-head h1 { flex: 1; min-width: 0; display: flex; margin: 0; font-size: inherit; line-height: inherit; }
    .sheet gf-plant-detail { flex: 1; min-height: 0; }
    .pager { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px calc(6px + env(safe-area-inset-bottom)); border-top: 1px solid var(--gf-border); background: var(--gf-surface); }
    .pager span { color: var(--gf-text-muted); font-size: 0.85rem; font-variant-numeric: tabular-nums; }
    .pager button { display: inline-flex; align-items: center; gap: 4px; }
    /* Simple: the media viewer a box of its own (it fills its host), then the rubric's blocks, all of it scrolling. */
    .simple { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
    .simple:focus-visible { outline: 2px solid var(--gf-accent); outline-offset: -2px; }
    .simple gf-media-viewer { height: min(52dvh, 460px); min-height: 240px; flex: none; border-bottom: 1px solid var(--gf-border); }
    .simple .off { margin: 0; padding: 12px 16px; color: var(--gf-text-muted); }
    .simple .rub { display: flex; align-items: center; gap: 8px; margin: 0; padding: 14px 16px 0; font-size: 0.8125rem; font-weight: 700;
      letter-spacing: 0.06em; text-transform: uppercase; color: var(--gf-accent); }
    .simple .essential gf-plant-detail { display: block; overflow: visible; padding: 0; }
  `];

  constructor() {
    super();
    /** @type {number | null} */
    this.open = null;
    this.mediaAt = 0;
    /** @type {import('./cards.js').Card[]} */
    this.cards = [];
    this.scoped = false;
    /** @type {string | null} */
    this.layoutKey = null;
    this.simple = false;
    /** @type {string | null} */
    this._name = null;
  }

  /** @type {PaneSizer | null} */ #sizer = null;
  /** The plant whose name is read (or being read) from the flora: its own name, never another's. @type {number | null} */
  #nameFor = null;

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
    // Not among the cards (opened from a link, or filtered out of them since): its name read from the flora for the
    // header — another plant's never kept.
    const id = this.open;
    if (changed.has('open')) { this._name = null; this.#nameFor = null; }
    if (id != null && this.#nameFor !== id && !this.cards.some(c => c.plant.id === id)) {
      this.#nameFor = id;
      whenReady().then(() => getPlant(id)).then(p => { if (p && this.open === id) this._name = nameOf(p); });
    }
  }

  /**
   * The focus into the sheet, once drawn: simple, its content (named after the plant); else its × — for a plant touched
   * (its row, its point), not one a link or a reload opened.
   */
  async takeFocus() {
    await this.updateComplete;
    /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.simple') ?? this.renderRoot.querySelector('.sheet-head button'))?.focus({ preventScroll: true });
  }

  #onKey = (/** @type {KeyboardEvent} */ e) => {
    // A dialog over the page (« Noter ici » from this sheet, a question): its keys, not the sheet's under it.
    if (e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented || this.open == null || modalOpen()) return;
    const t = /** @type {HTMLElement} */ (e.composedPath()[0]);
    if (t?.closest?.('input, textarea, select, [contenteditable]')) return;
    const arrow = e.key === 'ArrowRight' || e.key === 'ArrowLeft';
    // The media viewer's ← → are its own (its images); its Échap too when it uses it (it stops it then): any other closes.
    if (arrow && t?.closest?.('gf-media-viewer')) return;
    // Bare: → keeps the plant and goes on, ← passes it — as with the cards.
    if (arrow) { e.preventDefault(); this.#step(e.key === 'ArrowRight' ? 1 : -1); }
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
    // Simple, over the whole screen (a phone; what is under it out of reach): its plant's name is the screen's title.
    const title = html`<strong>${name || 'Plante'}</strong>`;
    return html`<section class="sheet" aria-label="Plante" @touchstart=${this.#touchStart} @touchend=${this.#touchEnd}>
      ${z ? z.split('sheet', 'right', () => this.#max, 'ma-sheet-body') : nothing}
      <div class="body" id="ma-sheet-body" style=${w != null && z ? `--w-sheet: ${Math.max(360, Math.min(w, this.#max))}px` : ''}>
      <div class="sheet-head">
        <button class="icon-btn" type="button" aria-label="Fermer la fiche" title="Fermer (Échap)" @click=${() => this.#show(null)}>${icon('x-lg')}</button>
        ${this.simple && !matchMedia('(min-width: 900px)').matches ? html`<h1 class="name">${title}</h1>` : title}
      </div>
      ${this.simple ? this.#simple(name) : html`<gf-plant-detail embedded subheading plant-id=${this.open} view="epure" ?scoped=${this.scoped} .mediaAt=${this.mediaAt}></gf-plant-detail>`}
      ${at >= 0 ? html`<nav class="pager" aria-label="Plantes autour">
        <button class="secondary prev" type="button" ?disabled=${at <= 0} @click=${() => this.#step(-1)}>${icon('chevron-left')} Préc.</button>
        <span>${at + 1} / ${list.length}</span>
        <button class="primary next" type="button" ?disabled=${at >= list.length - 1} @click=${() => this.#step(1)}>Suivante ${icon('chevron-right')}</button>
      </nav>` : nothing}
      </div>
    </section>`;
  }

  /**
   * Simple: its « Médias » (the viewer at `mediaAt`, as the Épuré sheet presents them; « Photos en ligne » off, said),
   * then the rubric « L'essentiel » — its title, and its blocks as the Épuré sheet orders and titles them here, those
   * folded there left out, those it leaves out when empty too (read, never written). @param {string} name
   */
  #simple(name) {
    const id = this.open, rubric = categoryOf('names');
    const keys = blockOrder('epure').filter(k => blockCategory(k) === 'names' && !isHidden('epure', k));
    // It scrolls: reachable by the keyboard (↑ ↓ scroll it), whatever its blocks hold; named after its plant (the
    // focus comes here when it is touched).
    return html`<div class="simple" tabindex="0" role="group" aria-label=${`${name || 'Plante'} : médias et l’essentiel`}>
      ${moduleOn('photos')
        ? html`<gf-media-viewer local plant-id=${id} presentation=${blockStyle('epure', 'media')} .label=${blockTitle('media')} .index=${this.mediaAt ?? 0}></gf-media-viewer>`
        : html`<p class="off">${fr(`${blockTitle('media')} : Photos en ligne désactivées (Réglages › Modules).`)}</p>`}
      <section class="essential" aria-labelledby="ma-sheet-essential">
        <h2 class="rub" id="ma-sheet-essential">${icon(rubric.icon)} ${rubric.label}</h2>
        ${keys.map(k => html`<gf-plant-detail embedded subheading titled only=${k} plant-id=${id} view="epure" ?scoped=${this.scoped}></gf-plant-detail>`)}
      </section>
    </div>`;
  }
}

customElements.define('ma-plant-sheet', MaPlantSheet);
