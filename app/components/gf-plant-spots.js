// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { href } from '../core/router.js';
import { collectionsForPlant, collectionTitle, entryInSeason, findEntry, lastHarvest, plantCount, spotEvents } from '../core/collections.js';
import './gf-map.js';

const shortDate = (/** @type {string} */ iso) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

/** "Dans mes collections" on a plant page: places (mini map + list) and lists (chips). */
export class GfPlantSpots extends LitElement {
  static properties = {
    plantId: { type: Number, attribute: 'plant-id' },
    _spots: { state: true },
    _lists: { state: true },
    _error: { state: true }
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
    li small { color: var(--gf-text-muted); }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .chip {
      padding: 4px 12px;
      border-radius: 999px;
      border: 1px solid var(--gf-border);
      background: var(--gf-surface);
      color: inherit;
      text-decoration: none;
      font-size: 0.85rem;
    }
    .badge { background: #fde047; color: #422006; border-radius: 999px; padding: 0 8px; font-size: 0.75rem; font-weight: 600; }
    p { color: var(--gf-text-muted); font-size: 0.9rem; margin: 8px 0 0; }
  `;

  #onChange = () => this.#load();

  constructor() {
    super();
    this.plantId = 0;
    /** @type {import('../core/collections.js').Spot[]} */
    this._spots = [];
    /** @type {import('../core/collections.js').Collection[]} */
    this._lists = [];
    /** @type {string | null} */
    this._error = null;
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
    try {
      const all = await collectionsForPlant(this.plantId);
      this._spots = all.filter(c => c.properties.kind === 'place' && c.geometry);
      this._lists = all.filter(c => c.properties.kind !== 'place');
      this._error = null;
    } catch (error) {
      console.error(error);
      this._error = 'Lieux illisibles pour le moment : ' + /** @type {Error} */ (error).message;
    }
  }

  render() {
    const spots = this._spots;
    const lists = this._lists;
    return html`
      <div class="head">
        <h2>Dans mes collections${spots.length + lists.length ? ` (${spots.length + lists.length})` : ''}</h2>
        <a class="add" href=${href.newSpot(this.plantId)}>📍 Ajouter un lieu</a>
      </div>
      ${lists.length ? html`<div class="chips">${lists.map(c => html`
        <a class="chip" href=${href.spot(c.id)}>${c.properties.kind === 'favorites' ? '♥' : '☰'} ${collectionTitle(c)}</a>`)}</div>` : nothing}
      ${this._error ? html`<p role="alert">${this._error} <button type="button" @click=${() => this.#load()}>Réessayer</button></p>` : nothing}
      ${spots.length ? html`
        <gf-map .spots=${spots} fit @spot-select=${e => { location.hash = href.map({ spot: e.detail.id }); }}></gf-map>
        <ul>
          ${spots.map((place, i) => {
            // This plant's own record at the place (season, last harvest), not the place's other plants.
            const entry = findEntry(place, this.plantId);
            const last = entry && lastHarvest(entry);
            const others = place.properties.plants.length - 1;
            return html`<li><a href=${href.map({ spot: place.id })}>
              <span>${place.properties.name || 'Lieu ' + (i + 1)}${others > 0 ? html` <small>· ${plantCount(others + 1)}</small>` : nothing}</span>
              ${entry && entryInSeason(entry) ? html`<span class="badge">En saison</span>` : nothing}
              <span class="when">${last ? 'Récolté le ' + shortDate(last.date) : 'Aucune récolte'}</span>
            </a></li>`;
          })}
        </ul>` : lists.length ? nothing : html`<p>Ajoutez cette plante à vos favoris ou à une liste, ou notez où vous la trouvez : un lieu peut réunir plusieurs plantes. Tout reste sur cet appareil.</p>`}
    `;
  }
}

customElements.define('gf-plant-spots', GfPlantSpots);
