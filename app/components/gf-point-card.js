// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { directionsUrl } from '../core/collections.js';
import { addressAt, altitudeAt, formatCoordinates } from '../core/geoservices.js';
import { href } from '../core/router.js';
import { ui } from '../styles/ui.js';
import './gf-place-insights.js';
import { icon } from '../core/icons.js';

/**
 * A point of the map (long press, search result): nearest address, altitude, coordinates (copy),
 * « Créer un lieu ici », directions. Event: close.
 * Asking (`ask`: gf-map's question for the point — « Poser un repère ici ? », « Déplacer le lieu ici ? », « Chercher
 * autour d'ici ? »): the question, where the point is, « Confirmer » and « Annuler » only (events confirm, cancel).
 * The map's reference (`removable`): « Retirer le repère » too (event remove). Its keys are the map's (gf-map: Entrée
 * confirms, Échap cancels or closes); focusAction() puts the focus on its first action.
 */
export class GfPointCard extends LitElement {
  static properties = {
    point: { attribute: false },
    label: { type: String },
    create: { type: Boolean },
    /** A plant to put in the place created here. */
    plant: { attribute: false },
    /** The question asked of the point (gf-map's proposal), or '': the point's card. */
    ask: { type: String },
    /** The point is the map's reference: « Retirer le repère ». */
    removable: { type: Boolean },
    _address: { state: true },
    _altitude: { state: true },
    _copied: { state: true },
    _insights: { state: true }
  };

  static styles = [ui, css`
    :host { display: block; }
    .card {
      position: relative;
      background: var(--gf-surface);
      color: var(--gf-text);
      border-radius: var(--gf-radius-lg);
      box-shadow: var(--gf-shadow-float);
      padding: 12px 14px;
      display: grid;
      gap: 6px;
    }
    .card:focus { outline: none; }
    .card:focus-visible { box-shadow: var(--gf-focus); }
    h2 { margin: 0; font-size: 1rem; padding-right: 40px; }
    .close { position: absolute; top: 2px; right: 2px; }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; font-size: 0.85rem; color: var(--gf-text-muted); }
    .coords { font-variant-numeric: tabular-nums; }
    .actions { margin-top: 4px; display: flex; flex-wrap: wrap; gap: 6px; }
    .ask h2 { padding-right: 0; }
    details.insights summary { cursor: pointer; font-size: 0.85rem; font-weight: 600; color: var(--gf-accent); }
    details.insights[open] summary { margin-bottom: 8px; }
    details.insights gf-place-insights { max-height: 42vh; overflow-y: auto; }
    /* Still coming (the address, the altitude): a placeholder, no text — seen only past 400 ms, a light sweeping it. */
    .ph { display: inline-block; vertical-align: middle; width: 14em; max-width: 70%; height: 0.95em; border-radius: 4px; opacity: 0;
      background: linear-gradient(100deg, var(--gf-surface-2) 30%, color-mix(in srgb, var(--gf-text-muted) 22%, var(--gf-surface-2)) 50%, var(--gf-surface-2) 70%) 0 0 / 250% 100%;
      animation: pc-show 0.01s linear 0.4s forwards, pc-sweep 1.2s linear 0.4s infinite; }
    .ph.short { width: 3.2em; }
    @keyframes pc-show { to { opacity: 1; } }
    @keyframes pc-sweep { from { background-position: 125% 0; } to { background-position: -125% 0; } }
    @media (prefers-reduced-motion: reduce) { .ph { animation: pc-show 0.01s linear 0.4s forwards; } }
  `];

  constructor() {
    super();
    /** @type {[number, number] | null} */
    this.point = null;
    this.label = '';
    this.create = true;
    /** @type {number | null} */
    this.plant = null;
    this.ask = '';
    this.removable = false;
    /** @type {string | null | undefined} undefined while loading */
    this._address = undefined;
    /** @type {number | null | undefined} */
    this._altitude = undefined;
    this._copied = false;
    this._insights = false;
  }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (!changed.has('point') || !this.point) return;
    const point = this.point;
    this._address = undefined;
    this._altitude = undefined;
    this._copied = false;
    this._insights = false;
    addressAt(point).then(a => { if (this.point === point) this._address = a?.label || null; }).catch(() => { if (this.point === point) this._address = null; });
    altitudeAt(point).then(z => { if (this.point === point) this._altitude = z; }).catch(() => { if (this.point === point) this._altitude = null; });
  }

  async #copy() {
    if (!this.point) return;
    try {
      await navigator.clipboard.writeText(formatCoordinates(this.point));
      this._copied = true;
      setTimeout(() => { this._copied = false; }, 2000);
    } catch { /* clipboard unavailable: the coordinates stay readable */ }
  }

  /** @param {string} type */
  #say(type) { this.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true })); }

  /**
   * The focus on its first action: « Confirmer » while it asks, else « Créer un lieu ici » — else (no-create) the
   * card itself, read whole: never « Retirer le repère », which a second Entrée would take.
   */
  async focusAction() {
    await this.updateComplete;
    /** @type {HTMLElement | null | undefined} */ (this.renderRoot.querySelector('.actions .primary') || this.renderRoot.querySelector('.card'))?.focus({ preventScroll: true });
  }

  render() {
    const p = this.point;
    if (!p) return nothing;
    // Still coming: a text-free placeholder (past 400 ms), its words for screen readers only.
    const coming = (/** @type {string} */ words, /** @type {string} */ cls = '') => html`<span class="ph ${cls}" aria-hidden="true"></span><span class="visually-hidden">${words}</span>`;
    const title = this.label || (this._address === undefined ? coming('Recherche de l’adresse') : this._address || 'Point sur la carte');
    const loading = !this.label && this._address === undefined || this._altitude === undefined;
    const altitude = html`<span>${icon('triangle')} ${this._altitude === undefined ? coming('Altitude', 'short') : this._altitude === null ? 'altitude inconnue' : this._altitude + ' m'}</span>`;
    // Asking: the question, where the point is, its two answers — nothing else to do with it before it is confirmed.
    if (this.ask) {
      return html`<section class="card ask" aria-label=${this.ask} aria-busy=${loading ? 'true' : 'false'}>
        <h2>${this.ask}</h2>
        <div class="meta">${this.label || (this._address === undefined ? coming('Recherche de l’adresse') : this._address || 'Point sur la carte')}</div>
        <div class="meta">${altitude}<span class="coords">${formatCoordinates(p)}</span></div>
        <div class="actions">
          <button type="button" class="primary small confirm" @click=${() => this.#say('confirm')}>${icon('check-lg')} Confirmer</button>
          <button type="button" class="small cancel" @click=${() => this.#say('cancel')}>Annuler</button>
        </div>
      </section>`;
    }
    return html`<section class="card" tabindex="-1" aria-label=${this.removable ? 'Repère sur la carte' : 'Point sur la carte'} aria-busy=${loading ? 'true' : 'false'}>
      <button class="close icon-btn" type="button" aria-label="Fermer" @click=${() => this.#say('close')}>${icon('x-lg')}</button>
      <h2>${title}</h2>
      ${this.label && this._address ? html`<div class="meta">${this._address}</div>` : nothing}
      <div class="meta">
        ${altitude}
        <span class="coords">${formatCoordinates(p)}</span>
        <button class="link" type="button" @click=${this.#copy}>${this._copied ? html`Copié ${icon('check-lg')}` : 'Copier'}</button>
      </div>
      <div class="actions">
        ${this.create ? html`<a class="primary small" href=${href.newSpot(this.plant ?? null, p)}>${icon('geo-alt-fill')} Créer un lieu ici</a>` : nothing}
        <a class="button small" href=${directionsUrl({ geometry: { type: 'Point', coordinates: p } })} target="_blank" rel="noopener">Itinéraire</a>
        ${this.removable ? html`<button type="button" class="small remove" @click=${() => this.#say('remove')}>Retirer le repère</button>` : nothing}
      </div>
      <details class="insights" ?open=${this._insights} @toggle=${(/** @type {Event} */ e) => { this._insights = /** @type {HTMLDetailsElement} */ (e.target).open; }}>
        <summary>Ici : zones naturelles, plantes vues, pollens</summary>
        ${this._insights ? html`<gf-place-insights compact .point=${p}></gf-place-insights>` : nothing}
      </details>
    </section>`;
  }
}

customElements.define('gf-point-card', GfPointCard);
