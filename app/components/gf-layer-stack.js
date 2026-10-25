// @ts-check
// « Couches affichées » in the maps' options (gf-map-options.js: each map's panel ▦, Réglages › Cartes): what a map
// draws over its background, read from the top —
//  - « Noms et réseaux, au-dessus de tout » (core/map-layers.js LANDMARKS, the places' names on top): those chosen,
//    each with « Masquer » — always opaque, never moved; one an overlay draws already (a cell's layers=hydro) is that
//    overlay's (core/ign.js landmarksShown). On the plan, which has its own: said, nothing listed;
//  - the overlays (`ul.active`, the top one first), each with its opacity, « Monter », « Descendre », « Masquer »;
//  - the background, last.
// The focus kept by the keyboard: on the button of a layer moved; a line hidden, on the « Masquer » of the line now in
// its place, else of the one above it, else of the other list, else on the background.
// Events (bubbling, composed; gf-map-options.js makes them changes of the look): overlay-toggle {key, on: false},
// overlay-opacity {key, opacity, commit}, overlay-order {keys} (bottom first), landmark-toggle {key, on: false}.

import { LitElement, html, css, nothing } from 'lit';
import { IGN_PREFIX, defaultOpacity, overlayDef } from '../core/ign-layers.js';
import { LANDMARKS } from '../core/map-layers.js';
import { baseLabel, takesLandmarks } from '../core/backgrounds.js';
import { icon } from '../core/icons.js';
import { ui } from '../styles/ui.js';

export class GfLayerStack extends LitElement {
  static properties = {
    /** The background shown (core/backgrounds.js key). */
    base: { type: String },
    /** « Noms et réseaux » chosen, bottom first (the look's `landmarks`). */
    landmarks: { attribute: false },
    /** The overlays shown, bottom first. */
    overlays: { attribute: false },
    /** The overlays' opacity (key → 0…1; its usual one when it says none: core/ign-layers.js defaultOpacity). */
    opacities: { attribute: false },
    _opacity: { state: true }
  };

  static styles = [ui, css`
    /* A grid item of the panel: never wider than it (a long name). */
    :host { display: grid; gap: 6px; min-width: 0; }
    .note { margin: 2px 4px 4px; font-size: 0.8rem; color: var(--gf-text-muted); }
    .band { margin: 0 4px; font-size: 0.78rem; font-weight: 600; color: var(--gf-text-muted); }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
    li { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 2px 6px; padding: 6px 4px; border-radius: var(--gf-radius-sm); background: var(--gf-surface-2); }
    .name { display: grid; min-width: 0; font-size: 0.9rem; overflow-wrap: anywhere; }
    .name small { color: var(--gf-text-muted); font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tools { display: flex; align-items: center; }
    .tools .icon-btn { width: 36px; height: 36px; font-size: 1rem; }
    .marks li { padding: 2px 4px 2px 8px; border-left: 3px solid var(--gf-text-muted); }
    .opacity { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; font-size: 0.8rem; color: var(--gf-text-muted); }
    .opacity input { flex: 1; min-width: 0; accent-color: var(--gf-accent); }
    .opacity output { min-width: 3.2em; text-align: right; font-variant-numeric: tabular-nums; }
    .base { margin: 0; padding: 6px 8px; border: 1px dashed var(--gf-border); border-radius: var(--gf-radius-sm); font-size: 0.85rem; overflow-wrap: anywhere; }
    .base b { font-weight: 600; }
  `];

  constructor() {
    super();
    this.base = 'photo';
    /** @type {string[]} */
    this.landmarks = [];
    /** @type {string[]} */
    this.overlays = [];
    /** @type {Record<string, number>} */
    this.opacities = {};
    /** Opacities while a slider moves (key → 0…1). @type {Map<string, number>} */
    this._opacity = new Map();
  }

  /** @param {string} name @param {any} detail */
  #emit(name, detail) { this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true })); }

  /** An overlay's name (its catalogue layer's, else the app's). @param {string} key */
  #name(key) { return overlayDef(key)?.label || key.replace(IGN_PREFIX, ''); }

  /** Moves a shown overlay up (toward the top) or down. @param {string} key @param {1 | -1} step */
  #move(key, step) {
    const keys = [...this.overlays];
    const i = keys.indexOf(key);
    const j = i + step;
    if (i < 0 || j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    // The focus follows the overlay moved, once the map has the new order and its row is drawn elsewhere (updated()).
    this.#refocus = { key, step };
    this.#emit('overlay-order', { keys });
  }

  /** The overlay just moved, whose button gets the focus back. @type {{ key: string, step: number } | null} */
  #refocus = null;

  /** A line just hidden: its list (« marks », « active ») and its place there, top first. @type {{ list: string, at: number } | null} */
  #hidden = null;

  /**
   * A line hidden (its « Masquer »): the focus, lost with its line, goes on next door (updated()).
   * @param {string} list @param {number} at @param {string} name @param {any} detail
   */
  #hide(list, at, name, detail) {
    this.#hidden = { list, at };
    this.#emit(name, detail);
  }

  /** @param {Map<string, any>} changed */
  updated(changed) {
    if (!changed.has('overlays') && !changed.has('landmarks')) return;
    const root = /** @type {ShadowRoot} */ (this.renderRoot);
    if (this.#hidden) {
      const { list, at } = this.#hidden;
      this.#hidden = null;
      // Its line gone, the focus with it (the line's button kept, now the next one's: left there).
      if (!root.activeElement && document.activeElement === document.body) {
        const here = [...root.querySelectorAll(`ul.${list} [data-hide]`)];
        /** @type {HTMLElement | null | undefined} */ (here[Math.min(at, here.length - 1)] ?? root.querySelector('[data-hide]') ?? root.querySelector('.base'))?.focus();
      }
    }
    if (!changed.has('overlays') || !this.#refocus) return;
    const { key, step } = this.#refocus;
    this.#refocus = null;
    const button = /** @type {HTMLButtonElement | null} */ (this.renderRoot.querySelector(`[data-key="${CSS.escape(key)}"][data-step="${step}"]`));
    const other = /** @type {HTMLButtonElement | null} */ (this.renderRoot.querySelector(`[data-key="${CSS.escape(key)}"][data-step]:not([disabled])`));
    (button && !button.disabled ? button : other)?.focus();
  }

  /** @param {string} key @param {Event} e @param {boolean} commit */
  #opacityInput(key, e, commit) {
    const value = Number(/** @type {HTMLInputElement} */ (e.target).value) / 100;
    this._opacity = new Map(this._opacity).set(key, value);
    this.#emit('overlay-opacity', { key, opacity: value, commit });
    if (commit) { const next = new Map(this._opacity); next.delete(key); this._opacity = next; }
  }

  /**
   * « Noms et réseaux », above every layer: those chosen, the top one first — not one an overlay draws (listed with the
   * overlays, at its place); on the plan, its own said.
   */
  #marks() {
    if (!takesLandmarks(this.base)) return html`<p class="note">Noms et réseaux : ceux du plan IGN.</p>`;
    const drawn = new Set(this.overlays.flatMap(key => overlayDef(key)?.layers.map(l => l.id) ?? []));
    const marks = LANDMARKS.filter(l => this.landmarks.includes(l.key) && !drawn.has(l.layer.id)).reverse();
    if (!marks.length) return nothing;
    return html`<p class="band" id="marks-title">Noms et réseaux, au-dessus de tout</p>
      <ul class="marks" aria-labelledby="marks-title">${marks.map((m, i) => html`<li>
        <span class="name">${m.label}</span>
        <span class="tools"><button class="icon-btn" type="button" data-hide aria-label=${'Masquer ' + m.label}
          @click=${() => this.#hide('marks', i, 'landmark-toggle', { key: m.key, on: false })}>${icon('x-lg')}</button></span>
      </li>`)}</ul>`;
  }

  /** The overlays, the top one first: their place, their opacity, off. */
  #overlays() {
    // Top first: the order they are drawn in, read from above.
    const keys = [...this.overlays].reverse();
    if (!keys.length) return html`<p class="note">Aucune autre couche par-dessus le fond : cochez-en une ci-dessous.</p>`;
    return html`<ul class="active" aria-label="Couches par-dessus le fond, de la plus haute à la plus basse">${keys.map((key, i) => {
      const name = this.#name(key);
      const pct = Math.round((this._opacity.get(key) ?? this.opacities?.[key] ?? defaultOpacity(key)) * 100);
      return html`<li>
        <span class="name">${name}${keys.length > 1 ? html`<small>${i === 0 ? 'au-dessus' : i === keys.length - 1 ? 'au-dessous' : `${i + 1}ᵉ`}</small>` : nothing}</span>
        <span class="tools">
          ${keys.length > 1 ? html`
            <button class="icon-btn" type="button" data-key=${key} data-step="1" aria-label=${'Monter ' + name} ?disabled=${i === 0} @click=${() => this.#move(key, 1)}>${icon('caret-up-fill')}</button>
            <button class="icon-btn" type="button" data-key=${key} data-step="-1" aria-label=${'Descendre ' + name} ?disabled=${i === keys.length - 1} @click=${() => this.#move(key, -1)}>${icon('caret-down-fill')}</button>` : nothing}
          <button class="icon-btn" type="button" data-hide aria-label=${'Masquer ' + name} @click=${() => this.#hide('active', i, 'overlay-toggle', { key, on: false })}>${icon('x-lg')}</button>
        </span>
        <label class="opacity">Opacité
          <input type="range" min="0" max="100" step="5" .value=${String(pct)} aria-label=${'Opacité de ' + name} aria-valuetext=${pct + ' %'}
            @input=${(/** @type {Event} */ e) => this.#opacityInput(key, e, false)} @change=${(/** @type {Event} */ e) => this.#opacityInput(key, e, true)} />
          <output>${pct} %</output>
        </label>
      </li>`;
    })}</ul>`;
  }

  render() {
    return html`${this.#marks()}${this.#overlays()}<p class="base" tabindex="-1">Fond : <b>${baseLabel(this.base)}</b></p>`;
  }
}

customElements.define('gf-layer-stack', GfLayerStack);
