// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { href } from '../core/router.js';
import { inSeason, lastHarvest, spotEvents, spotsForPlant } from '../core/spots.js';
import './gf-map.js';

const shortDate = (/** @type {string} */ iso) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

/** "Mes lieux de récolte" on a plant page: add button, mini map and list. */
export class GfPlantSpots extends LitElement {
  static properties = {
    plantId: { type: Number, attribute: 'plant-id' },
    _spots: { state: true }
  };

  static styles = css`
    *, *::before, *::after { box-sizing: border-box; }
    :host { display: block; }
    .head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    h2 {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--gf-text-muted);
      margin: 0;
    }
    a.add {
      margin-left: auto;
      font-weight: 600;
      text-decoration: none;
      background: var(--gf-accent);
      color: var(--gf-accent-contrast);
      border-radius: 999px;
      padding: 8px 16px;
    }
    gf-map { height: 220px; margin-top: 10px; border-radius: var(--gf-radius); overflow: hidden; }
    ul { list-style: none; padding: 0; margin: 8px 0 0; display: grid; gap: 6px; }
    li a {
      display: flex;
      gap: 10px;
      align-items: baseline;
      padding: 8px 12px;
      border-radius: 8px;
      background: var(--gf-surface);
      border: 1px solid var(--gf-border);
      color: inherit;
      text-decoration: none;
      font-size: 0.9rem;
    }
    li .when { margin-left: auto; color: var(--gf-text-muted); font-size: 0.8rem; }
    .badge { background: #fde047; color: #422006; border-radius: 999px; padding: 0 8px; font-size: 0.75rem; font-weight: 600; }
    p { color: var(--gf-text-muted); font-size: 0.9rem; margin: 8px 0 0; }
  `;

  #onChange = () => this.#load();

  constructor() {
    super();
    this.plantId = 0;
    /** @type {import('../core/spots.js').Spot[]} */
    this._spots = [];
  }

  connectedCallback() {
    super.connectedCallback();
    spotEvents.addEventListener('change', this.#onChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    spotEvents.removeEventListener('change', this.#onChange);
  }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (changed.has('plantId')) this.#load();
  }

  async #load() {
    if (!this.plantId) return;
    this._spots = await spotsForPlant(this.plantId);
  }

  render() {
    const spots = this._spots;
    return html`
      <div class="head">
        <h2>Mes lieux de récolte${spots.length ? ` (${spots.length})` : ''}</h2>
        <a class="add" href=${href.newSpot(this.plantId)}>📍 Ajouter un lieu</a>
      </div>
      ${spots.length ? html`
        <gf-map .spots=${spots} fit @spot-select=${e => { location.hash = href.map({ spot: e.detail.id }); }}></gf-map>
        <ul>
          ${spots.map((spot, i) => {
            const last = lastHarvest(spot);
            return html`<li><a href=${href.map({ spot: spot.id })}>
              <span>${spot.properties.label || 'Lieu ' + (i + 1)}</span>
              ${inSeason(spot) ? html`<span class="badge">En saison</span>` : nothing}
              <span class="when">${last ? 'Récolté le ' + shortDate(last.date) : 'Aucune récolte'}</span>
            </a></li>`;
          })}
        </ul>` : html`<p>Notez ici où vous trouvez cette plante : position GPS, journal de récolte, notes. Tout reste sur cet appareil.</p>`}
    `;
  }
}

customElements.define('gf-plant-spots', GfPlantSpots);
