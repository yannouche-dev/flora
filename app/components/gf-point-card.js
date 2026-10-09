// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { directionsUrl } from '../core/collections.js';
import { addressAt, altitudeAt, formatCoordinates } from '../core/geoservices.js';
import { href } from '../core/router.js';
import { ui } from '../styles/ui.js';
import { icon } from '../core/icons.js';

/**
 * A point of the map (long press, search result): nearest address, altitude, coordinates (copy),
 * "Créer un endroit ici", directions. Event: close.
 */
export class GfPointCard extends LitElement {
  static properties = {
    point: { attribute: false },
    label: { type: String },
    create: { type: Boolean },
    /** A plant to put in the place created here. */
    plant: { attribute: false },
    _address: { state: true },
    _altitude: { state: true },
    _copied: { state: true }
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
    h2 { margin: 0; font-size: 1rem; padding-right: 40px; }
    .close { position: absolute; top: 2px; right: 2px; }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; font-size: 0.85rem; color: var(--gf-text-muted); }
    .coords { font-variant-numeric: tabular-nums; }
    .actions { margin-top: 4px; }
  `];

  constructor() {
    super();
    /** @type {[number, number] | null} */
    this.point = null;
    this.label = '';
    this.create = true;
    /** @type {number | null} */
    this.plant = null;
    /** @type {string | null | undefined} undefined while loading */
    this._address = undefined;
    /** @type {number | null | undefined} */
    this._altitude = undefined;
    this._copied = false;
  }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (!changed.has('point') || !this.point) return;
    const point = this.point;
    this._address = undefined;
    this._altitude = undefined;
    this._copied = false;
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

  render() {
    const p = this.point;
    if (!p) return nothing;
    const title = this.label || (this._address === undefined ? 'Recherche de l’adresse…' : this._address || 'Point sur la carte');
    return html`<section class="card" aria-label="Point sur la carte">
      <button class="close icon-btn" type="button" aria-label="Fermer"
        @click=${() => this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))}>${icon('x-lg')}</button>
      <h2>${title}</h2>
      ${this.label && this._address ? html`<div class="meta">${this._address}</div>` : nothing}
      <div class="meta">
        <span>${icon('triangle')} ${this._altitude === undefined ? '…' : this._altitude === null ? 'altitude inconnue' : this._altitude + ' m'}</span>
        <span class="coords">${formatCoordinates(p)}</span>
        <button class="link" type="button" @click=${this.#copy}>${this._copied ? html`Copié ${icon('check-lg')}` : 'Copier'}</button>
      </div>
      <div class="actions">
        ${this.create ? html`<a class="primary small" href=${href.newSpot(this.plant ?? null, p)}>${icon('geo-alt-fill')} Créer un endroit ici</a>` : nothing}
        <a class="button small" href=${directionsUrl({ geometry: { type: 'Point', coordinates: p } })} target="_blank" rel="noopener">Itinéraire</a>
      </div>
    </section>`;
  }
}

customElements.define('gf-point-card', GfPointCard);
