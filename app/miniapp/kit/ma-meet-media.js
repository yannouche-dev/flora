// @ts-check
// Rencontres: the photos of a plant beside the deck — the viewer of the plant sheet's « Médias » block
// (components/gf-media-viewer.js: its presentation, its zoom, its credits), photos first. The first match of a game
// brings it, once (kit/ma-around-list.js): on a wide screen a pane beside the cards (its width the user's, a
// separator), on a phone the viewer full screen over the deck (a modal dialog, a step in history: Back closes it);
// a short line says how it works, until dismissed. Its heading names the plant; × (and Échap) closes it. It decides
// nothing: `meet-media-close` goes up (the list keeps whether it is open, in the game: kit/session.js); the image
// shown, `index` (the address's &m=), and the viewer's media-index, to keep the address.
// hasPhotos(): a plant has images to show (the « Photos en ligne » module on): no empty pane.

import { LitElement, html, css, nothing } from 'lit';
import { icon } from '../../core/icons.js';
import { loadMedia } from '../../core/media-items.js';
import { moduleOn } from '../../core/modules.js';
import { blockStyle } from '../../core/sheet-blocks.js';
import { openModal } from '../../core/history.js';
import { ui } from '../../styles/ui.js';
import '../../components/gf-media-viewer.js';

/** @typedef {import('../../core/modules.js').Mode} Mode */

/**
 * Has this plant images to show in this mode (the « Photos en ligne » module on, an image found)? Answers at the first
 * image found (its thumbnail, at once), else once every source has answered.
 * @param {any} plant @param {Mode} mode @returns {Promise<boolean>}
 */
export async function hasPhotos(plant, mode) {
  if (!plant || !moduleOn('photos', mode)) return false;
  if (plant.thumbnail?.url) return true;
  const abort = new AbortController();
  return new Promise(resolve => {
    loadMedia(plant, mode, abort.signal, (items, done) => {
      if (items.length) { abort.abort(); resolve(true); } else if (done) resolve(false);
    }).catch(() => resolve(false));
  });
}

/** How the viewer works, said the first time (a finger, or a mouse and keys). */
const coachText = () => matchMedia('(pointer: coarse)').matches
  ? 'Touchez deux fois une photo pour zoomer, glissez pour passer à la suivante.'
  : 'Double-cliquez sur une photo pour zoomer ; ‹ › ou les flèches pour passer à la suivante.';

let ids = 0;

export class MaMeetMedia extends LitElement {
  static properties = {
    /** The plant shown. */
    plantId: { type: Number, attribute: 'plant-id' },
    /** Its name, in the heading. */
    name: {},
    /** The image shown: its place among the plant's media (the address's &m=). */
    index: { type: Number },
    /** The display mode (the modules, the media's presentation). */
    view: {},
    /** 'pane' (beside the deck) or 'dialog' (full screen, modal: a phone). */
    mode: {},
    /** The line saying how it works (the first time). */
    coach: { type: Boolean },
    /** Beside the deck: the next heart chooses the plant it shows, said after the line. */
    chooses: { type: Boolean }
  };

  static styles = [ui, css`
    :host { display: flex; flex-direction: column; min-height: 0; min-width: 0; background: var(--gf-surface); }
    .box { flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--gf-surface); animation: m-in 0.3s ease-out; }
    @keyframes m-in { from { opacity: 0; transform: translateX(24px); } }
    .m-head { flex: none; display: flex; align-items: center; gap: 6px; min-height: 44px; padding: 2px 4px 2px 12px; border-bottom: 1px solid var(--gf-border); }
    .m-head h2 { flex: 1; min-width: 0; margin: 0; font-size: 0.95rem; display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; outline: none; }
    .m-head h2 .bi { color: var(--gf-accent); }
    .m-head h2 span { overflow: hidden; text-overflow: ellipsis; }
    /* The viewer's controls (type, part, count), in this head (its bar left out) — as in the plant sheet's panes. */
    .media-ctl { flex: 0 1 auto; min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: 6px; overflow-x: auto; scrollbar-width: none; color: var(--gf-text); }
    .media-ctl:empty { display: none; }
    .media-ctl::-webkit-scrollbar { display: none; }
    .media-ctl select { font: inherit; font-size: 0.78rem; padding: 2px 4px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-sm); background: var(--gf-surface); color: var(--gf-text); max-width: 150px; min-height: 0; height: 28px; }
    .media-ctl .count { color: var(--gf-text-muted); font-variant-numeric: tabular-nums; font-size: 0.78rem; white-space: nowrap; }
    .media-ctl .parts { flex: none; display: flex; gap: 1px; padding: 2px; border-radius: var(--gf-radius-pill); background: var(--gf-surface-2); }
    .media-ctl .parts button { width: 26px; height: 24px; min-height: 0; padding: 0; border: 0; border-radius: var(--gf-radius-pill); background: none; color: var(--gf-text-muted); display: grid; place-items: center; cursor: pointer; font-size: 0.8rem; }
    .media-ctl .parts button[aria-checked='true'] { background: var(--gf-surface); color: var(--gf-accent); box-shadow: 0 1px 3px rgb(0 0 0 / 15%); }
    .media-ctl .parts button:disabled { opacity: 0.3; cursor: default; }
    .media-ctl .icon-btn { width: 28px; height: 28px; min-height: 0; }
    .media-ctl .back-mosaic { white-space: nowrap; font-size: 0.78rem; }
    .coach { flex: none; display: flex; align-items: flex-start; gap: 8px; margin: 8px 10px; padding: 8px 10px; border-radius: var(--gf-radius); background: var(--gf-accent-soft);
      color: var(--gf-text); font-size: 0.85rem; line-height: 1.35; }
    .coach > .bi { color: var(--gf-accent); font-size: 1.1rem; flex: none; }
    .coach p { margin: 0; flex: 1; }
    .coach button { flex: none; min-height: 30px; padding: 0 12px; font-size: 0.8rem; }
    gf-media-viewer { flex: 1; min-height: 0; }
    /* A phone: the viewer full screen over the deck. */
    dialog.full { position: fixed; inset: 0; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: var(--gf-surface); color: var(--gf-text); }
    dialog.full[open] { display: flex; flex-direction: column; }
    dialog.full::backdrop { background: rgb(0 0 0 / 50%); }
    dialog.full .m-head { padding-top: calc(2px + env(safe-area-inset-top)); }
    @media (prefers-reduced-motion: reduce) { .box { animation: none; } }
  `];

  constructor() {
    super();
    /** @type {number | null} */
    this.plantId = null;
    this.name = '';
    this.index = 0;
    /** @type {Mode} */
    this.view = 'standard';
    /** @type {'pane' | 'dialog'} */
    this.mode = 'pane';
    this.coach = false;
    this.chooses = false;
  }

  #id = `meet-media-${++ids}`;

  updated() {
    // A phone: modal, a step in history (Back closes it, as × does); the focus goes into it.
    if (this.mode === 'dialog') openModal(/** @type {HTMLDialogElement | null} */ (this.renderRoot.querySelector('dialog')));
  }

  /** The heading takes the focus (reopened from « Photos »). */
  focusHeading() { /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('h2'))?.focus(); }

  /** Closed (×, Échap, Back): the dialog shut, and said to the list. */
  close() {
    const dialog = /** @type {HTMLDialogElement | null} */ (this.renderRoot.querySelector('dialog'));
    if (dialog?.open) { dialog.close(); return; }
    this.dispatchEvent(new CustomEvent('meet-media-close', { bubbles: true, composed: true }));
  }

  /** Échap closes it, wherever the focus is in it (zoomed or not: the viewer's own Échap comes after). @param {KeyboardEvent} e */
  #onKey = e => {
    if (e.key !== 'Escape' || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    this.close();
  };

  #content() {
    const head = `${this.#id}-h`;
    // Its head hovered: the plant's points lit on the map (the list passes it on: kit/session.js#glowChosen).
    const glow = (/** @type {boolean} */ on) => this.dispatchEvent(new CustomEvent('meet-media-hover', { detail: { on }, bubbles: true, composed: true }));
    return html`<div class="m-head" @mouseenter=${() => glow(true)} @mouseleave=${() => glow(false)}>
        <h2 id=${head} tabindex="-1">${icon('images')}<span>Photos · ${this.name}</span></h2>
        <span class="media-ctl">${/** @type {any} */ (this.renderRoot?.querySelector?.('gf-media-viewer'))?.controls?.() ?? nothing}</span>
        <button class="icon-btn close" type="button" aria-label=${'Fermer les photos de ' + this.name} title="Fermer (Échap)" @click=${() => this.close()}>${icon('x-lg')}</button>
      </div>
      ${this.coach ? html`<div class="coach" role="note">${icon('lightbulb')}<p><b>Voici ses photos.</b> ${coachText()}${this.chooses ? ' Chaque nouveau coup de cœur la remplace ici.' : ''}</p>
        <button class="secondary" type="button" @click=${() => this.dispatchEvent(new CustomEvent('meet-media-coached', { bubbles: true, composed: true }))}>Compris</button></div>` : nothing}
      <gf-media-viewer prefer-photos bar-out ?local=${this.mode === 'pane'} @media-bar=${() => this.requestUpdate()} plant-id=${this.plantId} .view=${this.view} .index=${this.index} presentation=${blockStyle(/** @type {any} */ (this.view), 'media')}
        @media-close=${(/** @type {Event} */ e) => { e.stopPropagation(); this.close(); }}></gf-media-viewer>`;
  }

  render() {
    if (this.plantId == null) return nothing;
    const head = `${this.#id}-h`;
    if (this.mode === 'dialog') {
      return html`<dialog class="full" aria-labelledby=${head} @keydown=${{ handleEvent: this.#onKey, capture: true }}
        @close=${() => this.dispatchEvent(new CustomEvent('meet-media-close', { bubbles: true, composed: true }))}>${this.#content()}</dialog>`;
    }
    return html`<section class="box" role="region" aria-labelledby=${head} @keydown=${{ handleEvent: this.#onKey, capture: true }}>${this.#content()}</section>`;
  }
}

customElements.define('ma-meet-media', MaMeetMedia);
