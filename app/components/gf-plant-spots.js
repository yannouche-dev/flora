// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { href } from '../core/router.js';
import { collectionsForPlant, collectionTitle, plantMarkers, entryInSeason, findEntry, lastHarvest, plantCount, savePlace, spotEvents, withEntry } from '../core/collections.js';
import { StoreController } from '../core/store.js';
import './gf-map.js';
import { ui } from '../styles/ui.js';
import { icon, kindIcon } from '../core/icons.js';
import { isFocused, sendFocus } from '../core/map-focus.js';

const shortDate = (/** @type {string} */ iso) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

/** "Dans mes collections" on a plant page: places (mini map + list) and lists (chips). */
export class GfPlantSpots extends LitElement {
  static properties = {
    plantId: { type: Number, attribute: 'plant-id' },
    /** Inside a titled block (plant sheet): no heading of its own. */
    notitle: { type: Boolean },
    /** The sheet has a map: each place gets a « show on the map » button (map-focus.js). */
    mapLinked: { type: Boolean, attribute: 'map-linked' },
    /** The sheet's map focus, to show which place is on the map. */
    focus: { attribute: false },
    _spots: { state: true },
    _lists: { state: true },
    _error: { state: true }
  };

  static styles = [ui, css`
    :host { display: block; }
    .head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .head .primary { margin-left: auto; }
    gf-map { height: 220px; margin-top: 10px; border-radius: var(--gf-radius); overflow: hidden; }
    ul { list-style: none; padding: 0; margin: 8px 0 0; display: grid; gap: 6px; }
    li a {
      display: flex;
      gap: 10px;
      align-items: baseline;
      padding: 8px 12px;
      border-radius: var(--gf-radius);
      background: var(--gf-surface);
      border: 1px solid var(--gf-border);
      color: inherit;
      text-decoration: none;
      font-size: 0.9rem;
    }
    li a:hover { border-color: var(--gf-accent); }
    li.linked { display: flex; gap: 6px; }
    li.linked a { flex: 1; min-width: 0; }
    .on-map { flex: none; min-height: 0; padding: 0 10px; border-radius: var(--gf-radius); font-size: 1rem; }
    .on-map[aria-pressed='true'] { color: #e11d48; border-color: #e11d48; }
    li .when { margin-left: auto; color: var(--gf-text-muted); font-size: 0.8rem; }
    li small { color: var(--gf-text-muted); }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    p { color: var(--gf-text-muted); font-size: 0.9rem; margin: 8px 0 0; }
  `];

  #onChange = () => this.#load();
  #store = new StoreController(this);

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

  /** ✓ Valider on the map (✎): this plant's new position in each place it was moved in. @param {{ placeId: string, plantId: number | null, coordinates: [number, number] }[]} moves */
  async #savePositions(moves) {
    for (const { placeId, plantId, coordinates } of moves) {
      const place = this._spots.find(p => p.id === placeId);
      if (!place) continue;
      const rounded = /** @type {[number, number]} */ (coordinates.map(v => Math.round(v * 1e7) / 1e7));
      await savePlace(withEntry(place, plantId, { coordinates: rounded, accuracy: null })).catch(error => { this._error = 'Enregistrement impossible : ' + error.message; });
    }
  }

  render() {
    const spots = this._spots;
    const lists = this._lists;
    return html`
      <div class="head">
        ${this.notitle ? nothing : html`<h2 class="kicker" style="margin:0">Dans mes collections${spots.length + lists.length ? ` (${spots.length + lists.length})` : ''}</h2>`}
        <a class="primary add" href=${href.newSpot(this.plantId)}>${icon('geo-alt-fill')} Ajouter un lieu</a>
      </div>
      ${lists.length ? html`<div class="chips">${lists.map(c => html`
        <a class="button chip" href=${href.spot(c.id)}>${kindIcon(c.properties.kind)} ${collectionTitle(c)}</a>`)}</div>` : nothing}
      ${this._error ? html`<p role="alert">${this._error} <button type="button" @click=${() => this.#load()}>Réessayer</button></p>` : nothing}
      ${spots.length ? html`
        <gf-map
          .plants=${plantMarkers(spots, e => e.plantId === this.plantId)}
          plant-zoom="0"
          fit
          editable
          @positions-save=${e => this.#savePositions(e.detail.plants)}
          @plant-select=${e => { location.hash = href.map({ spot: e.detail.placeId, focus: e.detail.plantId }); }}
        ></gf-map>
        <ul>
          ${spots.map((place, i) => {
            // This plant's own record at the place (season, last harvest), not the place's other plants.
            const entry = findEntry(place, this.plantId);
            const last = entry && lastHarvest(entry);
            const others = place.properties.plants.length - 1;
            const name = place.properties.name || 'Lieu ' + (i + 1);
            const at = /** @type {[number, number]} */ (entry?.coordinates || place.geometry.coordinates);
            /** @type {import('../core/map-focus.js').PointFocus} */
            const point = { kind: 'point', label: name, coordinates: at };
            const on = isFocused(this.focus, point);
            return html`<li class=${this.mapLinked ? 'linked' : ''}><a href=${href.map({ spot: place.id, focus: this.plantId })}>
              <span>${place.properties.name || 'Lieu ' + (i + 1)}${others > 0 ? html` <small>· ${plantCount(others + 1)}</small>` : nothing}</span>
              ${this.#store.state.harvestMode ? html`
                ${entry && entryInSeason(entry) ? html`<span class="badge">En saison</span>` : nothing}
                <span class="when">${last ? 'Récolté le ' + shortDate(last.date) : 'Aucune récolte'}</span>` : nothing}
            </a>${this.mapLinked ? html`<button class="on-map" type="button" aria-pressed=${on ? 'true' : 'false'}
              aria-label=${`« ${name} » sur la carte de la fiche`} title=${on ? 'Retirer de la carte' : 'Voir sur la carte de la fiche'}
              @click=${() => sendFocus(this, point)}>${icon('geo-alt-fill')}</button>` : nothing}</li>`;
          })}
        </ul>` : lists.length ? nothing : html`<p>Ajoutez cette plante à vos favoris ou à une liste, ou notez où vous la trouvez : un lieu peut réunir plusieurs plantes. Tout reste sur cet appareil.</p>`}
    `;
  }
}

customElements.define('gf-plant-spots', GfPlantSpots);
