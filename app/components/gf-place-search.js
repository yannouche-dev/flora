// @ts-check
// <gf-place-search>: a commune, a lieu-dit, a park (IGN), typed, proposed, picked. One copy for every start
// screen (there were two, with no states). The request before is cancelled; « Recherche… », no answer, the IGN
// off and offline are said; ↑ ↓ move in the list (or open it again), Entrée picks (the first one when none is
// chosen — always one found for all that is typed: typed faster than the answers, it asks at once and picks then),
// Échap closes it.
// A place is picked once (a double touch does not pick twice). Event: place-pick { coordinates: [lon, lat], label }.
// The same contract as gf-map-search's place-pick, and as the mini-app kit's <ma-place-search>.

import { LitElement, html, css, nothing } from 'lit';
import { searchPlaces } from '../core/geoservices.js';
import { ui } from '../styles/ui.js';

export class GfPlaceSearch extends LitElement {
  static properties = {
    placeholder: {},
    label: {},
    disabled: { type: Boolean, reflect: true },
    _places: { state: true },
    _note: { state: true },
    _active: { state: true },
    /** The list shown (closed when the focus leaves, on Échap, after a pick). */
    _open: { state: true },
    /** Not enough room under the field (the keyboard up, the field low): the list opens above it. */
    _up: { state: true }
  };

  static styles = [ui, css`
    :host { display: block; position: relative; text-align: left; }
    /* Smaller than the action above it, but 16 px of text on a phone (iOS zooms into a smaller field). */
    input[type='search'] { min-height: 44px; padding: 8px 16px; font-size: 1rem; border-radius: var(--gf-radius-pill); background: var(--gf-surface); }
    @media (pointer: fine) { input[type='search'] { min-height: 40px; font-size: 0.9375rem; } }
    ul { position: absolute; z-index: 5; left: 0; right: 0; top: calc(100% + 4px); box-sizing: border-box; list-style: none; margin: 0; padding: 4px; max-height: 260px; overflow-y: auto;
      border: 1px solid var(--gf-border); border-radius: var(--gf-radius); background: var(--gf-surface); box-shadow: var(--gf-shadow-float, var(--gf-shadow)); }
    ul.up { top: auto; bottom: calc(100% + 4px); }
    li button { width: 100%; min-height: 44px; justify-content: flex-start; text-align: left; gap: 8px; border: 0; border-radius: var(--gf-radius-sm); background: none;
      padding: 8px 10px; font-size: 0.95rem; font-weight: 400; }
    li button:hover, li button[aria-selected='true'] { background: var(--gf-accent-soft); }
    @media (pointer: fine) { li button { min-height: 40px; } }
    li small { color: var(--gf-text-muted); font-size: 0.8rem; }
    input::placeholder { color: var(--gf-text-muted); opacity: 1; }
    .note { margin: 6px 4px 0; font-size: 0.8125rem; color: var(--gf-text-muted); text-align: center; }
  `];

  constructor() {
    super();
    this.placeholder = 'Une commune, un lieu-dit…';
    /** The field's accessible name (the visible line above it says the same). */
    this.label = 'Choisir une commune';
    this.disabled = false;
    /** @type {{ label: string, detail: string, coordinates: [number, number] }[]} */
    this._places = [];
    /** @type {string | null} */
    this._note = null;
    this._active = -1;
    this._open = false;
    this._up = false;
  }

  /** @type {any} */ #timer = 0;
  /** @type {AbortController | null} */ #abort = null;
  #picked = false;
  /** What the places shown answer (Entrée never picks one found for fewer letters). */
  #for = '';
  /** Entrée pressed before the answer for all that is typed: its first place is picked when it comes. */
  #enter = false;

  disconnectedCallback() { super.disconnectedCallback(); clearTimeout(this.#timer); this.#abort?.abort(); window.visualViewport?.removeEventListener('resize', this.#place); }

  /** @param {string} text @param {boolean} [now] asked at once (Entrée), not after the typing pause */
  #search(text, now = false) {
    clearTimeout(this.#timer);
    this.#abort?.abort();
    this.#picked = false;
    if (!now) this.#enter = false;
    if (text.trim().length < 3) { this._places = []; this._note = null; this._active = -1; this.#for = ''; this.#enter = false; return; }
    const run = async () => {
      const abort = this.#abort = new AbortController();
      this._note = 'Recherche…';
      try {
        const places = await searchPlaces(text, abort.signal);
        if (abort.signal.aborted) return;
        this._places = places;
        this.#for = text.trim();
        this._active = -1;
        this._open = true;
        this._note = places.length ? null : 'Aucun lieu de ce nom. Essayez une commune voisine.';
        if (this.#enter && places.length) this.#pick(places[0]);
      } catch (e) {
        if (abort.signal.aborted) return;
        this._places = [];
        this.#for = '';
        this._note = /** @type {any} */ (e)?.name === 'ModuleOffError' ? 'La recherche de lieux (IGN) est coupée dans les Réglages.'
          : navigator.onLine ? 'La recherche de lieux ne répond pas. Réessayez dans un instant.' : 'Hors ligne\u202f: la recherche de lieux revient avec le réseau.';
      } finally {
        if (!abort.signal.aborted) this.#enter = false;
      }
    };
    if (now) run(); else this.#timer = setTimeout(run, 250);
  }

  /** @param {{ label: string, coordinates: [number, number] }} p */
  #pick(p) {
    if (this.disabled || this.#picked) return;
    this.#picked = true;
    this.#enter = false;
    this._places = []; this._note = null; this._active = -1; this._open = false;
    const input = /** @type {HTMLInputElement | null} */ (this.renderRoot.querySelector('input'));
    if (input) input.value = p.label;
    this.dispatchEvent(new CustomEvent('place-pick', { detail: { coordinates: p.coordinates, label: p.label } }));
  }

  /** @param {KeyboardEvent} e */
  #key(e) {
    const n = this._places.length, text = /** @type {HTMLInputElement} */ (e.target).value.trim();
    // Closed (Échap): ↑ ↓ open the list again, nothing chosen yet.
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n && !this._open) { e.preventDefault(); this._open = true; }
    else if (e.key === 'ArrowDown' && n) { e.preventDefault(); this._active = (this._active + 1) % n; }
    else if (e.key === 'ArrowUp' && n) { e.preventDefault(); this._active = (this._active - 1 + n) % n; }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (n && this._open && this.#for === text) this.#pick(this._places[Math.max(0, this._active)]);
      // Typed faster than the answers: asked now, its first place picked when it comes.
      else if (text.length >= 3) { this.#enter = true; this.#search(text, true); }
    }
    else if (e.key === 'Escape' && this._open) { e.preventDefault(); this._open = false; this._active = -1; }
  }

  /** The box that scrolls this field (its edges: what is seen of the page, under the app's header). @returns {Element | null} */
  #scroller() {
    /** @type {any} */ let n = this;
    while (n) {
      n = n.parentNode instanceof ShadowRoot ? n.parentNode.host : n.parentElement;
      if (n && /auto|scroll/.test(getComputedStyle(n).overflowY)) return n;
    }
    return null;
  }

  /**
   * Room under the field, in what is seen (the visible viewport — the keyboard shrinks it — and the scrolling box):
   * else the list opens above. Either way it is never taller than the room it has (it scrolls).
   */
  #place = () => {
    const input = this.renderRoot.querySelector('input'), ul = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('ul'));
    if (!input || !ul) return;
    const vv = window.visualViewport, r = input.getBoundingClientRect(), box = this.#scroller()?.getBoundingClientRect();
    const bottom = Math.min(vv ? vv.offsetTop + vv.height : innerHeight, box?.bottom ?? Infinity);
    const top = Math.max(vv ? vv.offsetTop : 0, box?.top ?? -Infinity);
    ul.style.maxHeight = '';
    const need = Math.min(ul.scrollHeight, 260) + 8, below = bottom - r.bottom, above = r.top - top;
    const up = below < need && above > below;
    if (up !== this._up) this._up = up;
    ul.style.maxHeight = Math.max(88, Math.min(260, (up ? above : below) - 8)) + 'px';
  };

  /** @param {Map<string, unknown>} changed */
  updated(changed) {
    if ((changed.has('_open') || changed.has('_places')) && this._open && this._places.length) {
      this.#place();
      window.visualViewport?.addEventListener('resize', this.#place);
    } else if (changed.has('_open') && !this._open) window.visualViewport?.removeEventListener('resize', this.#place);
  }

  render() {
    const open = this._open && this._places.length > 0;
    return html`<input type="search" placeholder=${this.placeholder} aria-label=${this.label} autocomplete="off" enterkeyhint="search"
        role="combobox" aria-autocomplete="list" aria-expanded=${open ? 'true' : 'false'} aria-controls=${open ? 'places' : nothing}
        aria-activedescendant=${this._active >= 0 ? 'place-' + this._active : nothing} ?disabled=${this.disabled}
        @input=${(/** @type {any} */ e) => this.#search(e.target.value)} @keydown=${(/** @type {KeyboardEvent} */ e) => this.#key(e)}
        @focus=${() => { this._open = true; }} @blur=${() => { this._open = false; this._active = -1; }} />
      ${open ? html`<ul id="places" class=${this._up ? 'up' : ''} role="listbox" aria-label="Lieux" @pointerdown=${(/** @type {Event} */ e) => e.preventDefault()}>${this._places.map((p, i) => html`<li role="none"><button type="button" role="option" id=${'place-' + i}
        tabindex="-1" aria-selected=${i === this._active ? 'true' : 'false'} ?disabled=${this.disabled} @click=${() => this.#pick(p)}>${p.label} <small>${p.detail}</small></button></li>`)}</ul>` : nothing}
      ${this._note ? html`<p class="note" role="status">${this._note}</p>` : nothing}`;
  }
}

customElements.define('gf-place-search', GfPlaceSearch);
