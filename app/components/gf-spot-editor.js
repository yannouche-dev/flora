// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { config } from '../config.js';
import * as db from '../core/db.js';
import { GeoController } from '../core/geo.js';
import { href } from '../core/router.js';
import { searchPlants } from '../core/search.js';
import { ABUNDANCE, deleteSpot, getSpot, newSpot, saveSpot, spotTitle } from '../core/spots.js';
import { whenReady } from '../core/store.js';
import './gf-map.js';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const formatDate = (/** @type {string} */ iso) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Create (`plant-id`, optional) or edit (`spot-id`) a harvest spot.
 * New spots follow the GPS until the pin is dragged or placed by long press.
 */
export class GfSpotEditor extends LitElement {
  static properties = {
    spotId: { attribute: 'spot-id' },
    plantId: { attribute: 'plant-id', converter: v => (v ? Number(v) : null) },
    _spot: { state: true },
    _plant: { state: true },
    _manual: { state: true },
    _pickerQuery: { state: true },
    _pickerResults: { state: true },
    _harvestToday: { state: true },
    _todayQuantity: { state: true },
    _error: { state: true }
  };

  static styles = css`
    *, *::before, *::after { box-sizing: border-box; }
    :host {
      display: grid;
      grid-template-rows: minmax(220px, 42%) 1fr;
      min-height: 0;
    }
    gf-map { height: 100%; }
    form {
      overflow-y: auto;
      padding: 14px 16px 24px;
      background: var(--gf-bg);
      display: grid;
      gap: 14px;
      align-content: start;
    }
    .gps {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      font-size: 0.875rem;
      padding: 8px 12px;
      border-radius: var(--gf-radius);
      background: var(--gf-surface);
      border: 1px solid var(--gf-border);
    }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--gf-text-muted); flex: none; }
    .dot.good { background: #16a34a; }
    .dot.weak { background: #f59e0b; }
    .dot.none { background: var(--gf-danger); }
    .gps .hint { color: var(--gf-text-muted); flex-basis: 100%; font-size: 0.8rem; }
    .gps button { margin-left: auto; }
    h1 { font-size: 1.2rem; margin: 0; }
    h1 small { display: block; font-family: var(--gf-font-serif); font-style: italic; font-weight: 400; color: var(--gf-text-muted); font-size: 0.95rem; }
    label.field { display: grid; gap: 4px; font-size: 0.85rem; color: var(--gf-text-muted); }
    input[type='text'], input[type='search'], input[type='date'], textarea {
      font: inherit;
      font-size: 1rem;
      color: var(--gf-text);
      background: var(--gf-surface);
      border: 1px solid var(--gf-border);
      border-radius: 8px;
      padding: 9px 12px;
      width: 100%;
    }
    textarea { min-height: 80px; resize: vertical; }
    .chips { display: flex; gap: 8px; flex-wrap: wrap; }
    .chips button, button.secondary {
      font: inherit;
      font-size: 0.9rem;
      padding: 6px 14px;
      border-radius: 999px;
      border: 1px solid var(--gf-border);
      background: var(--gf-surface);
      color: var(--gf-text);
      cursor: pointer;
    }
    .chips button[aria-pressed='true'] { background: var(--gf-accent); border-color: var(--gf-accent); color: var(--gf-accent-contrast); }
    .stars button {
      font-size: 1.6rem;
      line-height: 1;
      background: none;
      border: 0;
      padding: 2px;
      cursor: pointer;
      color: var(--gf-border);
    }
    .stars button.on { color: #f59e0b; }
    fieldset { border: 0; margin: 0; padding: 0; display: grid; gap: 6px; }
    legend { font-size: 0.85rem; color: var(--gf-text-muted); padding: 0; margin-bottom: 6px; }
    .picker ul { list-style: none; margin: 6px 0 0; padding: 0; border: 1px solid var(--gf-border); border-radius: 8px; overflow: hidden; }
    .picker li button {
      width: 100%;
      text-align: left;
      font: inherit;
      padding: 8px 12px;
      border: 0;
      border-bottom: 1px solid var(--gf-border);
      background: var(--gf-surface);
      color: var(--gf-text);
      cursor: pointer;
    }
    .picker li:last-child button { border-bottom: 0; }
    .picker i { color: var(--gf-text-muted); font-family: var(--gf-font-serif); }
    .harvests { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .harvests li {
      display: flex;
      gap: 8px;
      align-items: baseline;
      padding: 8px 12px;
      border-radius: 8px;
      background: var(--gf-surface);
      border: 1px solid var(--gf-border);
      font-size: 0.9rem;
    }
    .harvests li .what { flex: 1; color: var(--gf-text-muted); }
    .harvests li button { background: none; border: 0; color: var(--gf-text-muted); cursor: pointer; font-size: 1.1rem; }
    .add-harvest { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .add-harvest input[name='note'] { grid-column: 1 / -1; }
    .add-harvest button { grid-column: 1 / -1; justify-self: start; }
    .today { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 0.95rem; }
    .today input[type='checkbox'] { width: 20px; height: 20px; accent-color: var(--gf-accent); }
    .today input[type='text'] { flex: 1; min-width: 140px; }
    .actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; position: sticky; bottom: -24px; padding: 10px 0 14px; background: var(--gf-bg); }
    .primary {
      font: inherit;
      font-weight: 600;
      padding: 12px 22px;
      border-radius: 999px;
      border: 0;
      background: var(--gf-accent);
      color: var(--gf-accent-contrast);
      cursor: pointer;
    }
    .primary.weak { background: var(--gf-surface-2); color: var(--gf-text); border: 1px solid var(--gf-border); }
    .danger { margin-left: auto; color: var(--gf-danger); background: none; border: 0; font: inherit; cursor: pointer; }
    a.cancel { color: var(--gf-text-muted); }
    .error { color: var(--gf-danger); font-size: 0.9rem; }
  `;

  #geo = new GeoController(this);

  constructor() {
    super();
    /** @type {string | null} */
    this.spotId = null;
    /** @type {number | null} */
    this.plantId = null;
    /** @type {import('../core/spots.js').Spot | null | undefined} */
    this._spot = undefined;
    /** @type {any} */
    this._plant = null;
    /** Pin placed by hand: stop following the GPS. */
    this._manual = false;
    this._pickerQuery = '';
    /** @type {any[]} */
    this._pickerResults = [];
    this._harvestToday = true;
    this._todayQuantity = '';
    /** @type {string | null} */
    this._error = null;
  }

  get #isNew() { return !this.spotId; }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (changed.has('spotId') || changed.has('plantId')) this.#load();

    // A new spot follows the GPS until the user places it by hand.
    const fix = this.#geo.state.fix;
    if (this.#isNew && this._spot && fix && !this._manual) {
      const [lon, lat] = this._spot.geometry.coordinates;
      if (lon !== fix.coordinates[0] || lat !== fix.coordinates[1] || this._spot.properties.accuracy !== fix.accuracy) {
        this._spot = {
          ...this._spot,
          geometry: { type: 'Point', coordinates: fix.coordinates },
          properties: { ...this._spot.properties, accuracy: Math.round(fix.accuracy) }
        };
      }
    }
  }

  async #load() {
    try {
      await this.#read();
    } catch (error) {
      console.error(error);
      this._spot = null;
      this._error = 'Lecture impossible : ' + /** @type {Error} */ (error).message;
    }
  }

  async #read() {
    await whenReady();
    if (this.spotId) {
      const spot = await getSpot(this.spotId);
      this._spot = spot || null;
      this._manual = true;
      this._plant = spot?.properties.plantId ? await db.get('plants', spot.properties.plantId) : null;
      document.title = (spot ? spotTitle(spot) : 'Lieu') + ' — GeoFlora';
    } else {
      this._plant = this.plantId ? await db.get('plants', this.plantId) : null;
      const fix = this.#geo.state.fix;
      // Without a fix yet, start at the centre of France; the pin jumps to the GPS position when it arrives.
      this._spot = newSpot(this._plant, fix?.coordinates || [2.35, 46.6], { accuracy: fix ? Math.round(fix.accuracy) : null });
      this._manual = false;
      document.title = 'Nouveau lieu — GeoFlora';
    }
  }

  /** @param {Partial<import('../core/spots.js').SpotProperties>} patch */
  #patch(patch) {
    if (!this._spot) return;
    this._spot = { ...this._spot, properties: { ...this._spot.properties, ...patch } };
  }

  /** @param {[number, number]} coordinates */
  #place(coordinates) {
    if (!this._spot) return;
    this._manual = true;
    this._spot = {
      ...this._spot,
      geometry: { type: 'Point', coordinates },
      properties: { ...this._spot.properties, accuracy: null }
    };
  }

  #useGps() {
    const fix = this.#geo.state.fix;
    if (!fix || !this._spot) return;
    this._manual = false;
    this._spot = {
      ...this._spot,
      geometry: { type: 'Point', coordinates: fix.coordinates },
      properties: { ...this._spot.properties, accuracy: Math.round(fix.accuracy) }
    };
    /** @type {any} */ (this.renderRoot.querySelector('gf-map'))?.flyTo(fix.coordinates, 18);
  }

  /** @param {Event} event */
  async #pickerInput(event) {
    const q = /** @type {HTMLInputElement} */ (event.target).value;
    this._pickerQuery = q;
    this._pickerResults = q.trim().length >= 2 ? await searchPlants(q, 8) : [];
  }

  /** @param {any} summary */
  async #pickPlant(summary) {
    this._plant = await db.get('plants', summary.id);
    this.#patch({
      plantId: this._plant.id,
      scientificName: this._plant.scientificName,
      vernacularName: this._plant.vernacularNames?.[0] || null
    });
    this._pickerQuery = '';
    this._pickerResults = [];
  }

  /** @param {SubmitEvent} event */
  #addHarvest(event) {
    event.preventDefault();
    const form = /** @type {HTMLFormElement} */ (event.target).closest('.add-harvest');
    const get = (/** @type {string} */ name) => /** @type {HTMLInputElement} */ (form?.querySelector(`[name="${name}"]`));
    const date = get('date').value;
    if (!date || !this._spot) return;
    const harvests = [...this._spot.properties.harvests, { date, quantity: get('quantity').value.trim(), note: get('note').value.trim() }]
      .sort((a, b) => b.date.localeCompare(a.date));
    this.#patch({ harvests });
    get('quantity').value = '';
    get('note').value = '';
  }

  /** @param {number} index */
  #removeHarvest(index) {
    if (!this._spot) return;
    this.#patch({ harvests: this._spot.properties.harvests.filter((_, i) => i !== index) });
  }

  /** @param {SubmitEvent} event */
  async #save(event) {
    event.preventDefault();
    if (!this._spot) return;
    if (!this._spot.properties.scientificName) {
      this._error = 'Choisissez la plante de ce lieu.';
      return;
    }
    let spot = this._spot;
    if (this.#isNew && this._harvestToday) {
      spot = {
        ...spot,
        properties: { ...spot.properties, harvests: [{ date: today(), quantity: this._todayQuantity.trim(), note: '' }, ...spot.properties.harvests] }
      };
    }
    try {
      const saved = await saveSpot(spot);
      location.hash = href.map({ spot: saved.id });
    } catch (error) {
      this._error = 'Enregistrement impossible : ' + /** @type {Error} */ (error).message;
    }
  }

  async #delete() {
    if (!this._spot || !confirm('Supprimer ce lieu et son journal de récolte ?')) return;
    await deleteSpot(this._spot.id);
    location.hash = href.map();
  }

  #gpsStatus() {
    const { fix, error } = this.#geo.state;
    if (this._manual) {
      return html`<div class="gps"><span class="dot good"></span> Position placée à la main
        ${fix ? html`<button class="secondary" type="button" @click=${this.#useGps}>Utiliser le GPS</button>` : nothing}
        <span class="hint">Faites glisser l’épingle verte pour l’ajuster.</span></div>`;
    }
    if (!fix) {
      return html`<div class="gps"><span class="dot ${error ? 'none' : ''}"></span>
        ${error || 'Recherche de la position GPS…'}
        <span class="hint">Appui long sur la carte pour placer le lieu à la main.</span></div>`;
    }
    const good = fix.accuracy <= config.goodAccuracy;
    return html`<div class="gps" aria-live="polite">
      <span class="dot ${good ? 'good' : 'weak'}"></span>
      Position GPS <strong>± ${Math.round(fix.accuracy)} m</strong>
      <span class="hint">${good ? 'Précision suffisante.' : 'Précision faible : patientez à découvert, ou ajustez l’épingle.'}</span>
    </div>`;
  }

  render() {
    const spot = this._spot;
    if (spot === undefined) return html`<div></div><form><p>Chargement…</p></form>`;
    if (spot === null) {
      return html`<div></div><form>
        <p>${this._error || 'Ce lieu n’existe plus.'}</p>
        ${this._error ? html`<button class="secondary" type="button" @click=${() => this.#load()}>Réessayer</button>` : nothing}
        <a href=${href.map()}>Retour à la carte</a>
      </form>`;
    }

    const p = spot.properties;
    const fix = this.#geo.state.fix;
    const weak = this.#isNew && !this._manual && (!fix || fix.accuracy > config.goodAccuracy);

    return html`
      <gf-map
        .pin=${spot.geometry.coordinates}
        track
        fit
        @pin-move=${e => this.#place(e.detail.coordinates)}
        @map-longpress=${e => this.#place(e.detail.coordinates)}
      ></gf-map>

      <form @submit=${this.#save}>
        ${this.#gpsStatus()}

        ${p.scientificName
          ? html`<h1>${spotTitle(spot)} <small>${p.scientificName}</small>
              ${this.#isNew && !this.plantId ? html`<button class="secondary" type="button" @click=${() => this.#patch({ scientificName: '', plantId: null, vernacularName: null })}>Changer</button>` : nothing}
            </h1>`
          : html`
            <div class="picker">
              <label class="field">Plante
                <input type="search" placeholder="Nom de la plante…" autocomplete="off" .value=${this._pickerQuery} @input=${this.#pickerInput} />
              </label>
              ${this._pickerResults.length ? html`<ul>${this._pickerResults.map(r => html`
                <li><button type="button" @click=${() => this.#pickPlant(r)}>${r.vernacularName || r.scientificName} <i>${r.scientificName}</i></button></li>`)}</ul>` : nothing}
            </div>`}

        <label class="field">Nom du lieu (facultatif)
          <input type="text" .value=${p.label || ''} placeholder="ex. Lisière nord du bois" @input=${e => this.#patch({ label: e.target.value })} />
        </label>

        <fieldset>
          <legend>Abondance</legend>
          <div class="chips">
            ${ABUNDANCE.map(a => html`<button type="button" aria-pressed=${p.abundance === a.value ? 'true' : 'false'} @click=${() => this.#patch({ abundance: /** @type {any} */ (a.value) })}>${a.label}</button>`)}
          </div>
        </fieldset>

        <fieldset>
          <legend>Qualité</legend>
          <div class="stars" role="radiogroup" aria-label="Qualité">
            ${[1, 2, 3, 4, 5].map(n => html`<button type="button" role="radio" aria-checked=${p.rating === n ? 'true' : 'false'}
              aria-label="${n} sur 5" class=${(p.rating || 0) >= n ? 'on' : ''}
              @click=${() => this.#patch({ rating: p.rating === n ? 0 : n })}>★</button>`)}
          </div>
        </fieldset>

        <label class="field">Notes
          <textarea .value=${p.notes || ''} placeholder="Accès, exposition, cueillette…" @input=${e => this.#patch({ notes: e.target.value })}></textarea>
        </label>

        ${this.#isNew ? html`
          <div class="today">
            <input id="today" type="checkbox" .checked=${this._harvestToday} @change=${e => { this._harvestToday = e.target.checked; }} />
            <label for="today">Récolté aujourd’hui</label>
            ${this._harvestToday ? html`<input type="text" placeholder="Quantité (ex. 500 g)" .value=${this._todayQuantity} @input=${e => { this._todayQuantity = e.target.value; }} />` : nothing}
          </div>` : nothing}

        <fieldset>
          <legend>Journal de récolte</legend>
          ${p.harvests.length ? html`
            <ul class="harvests">
              ${p.harvests.map((h, i) => html`
                <li>
                  <strong>${formatDate(h.date)}</strong>
                  <span class="what">${[h.quantity, h.note].filter(Boolean).join(' · ')}</span>
                  <button type="button" aria-label="Supprimer cette récolte" @click=${() => this.#removeHarvest(i)}>×</button>
                </li>`)}
            </ul>` : html`<p style="margin:0;color:var(--gf-text-muted);font-size:.9rem">Aucune récolte notée.</p>`}
          <div class="add-harvest">
            <input type="date" name="date" .value=${today()} max=${today()} aria-label="Date" />
            <input type="text" name="quantity" placeholder="Quantité" aria-label="Quantité" />
            <input type="text" name="note" placeholder="Remarque (facultatif)" aria-label="Remarque" />
            <button class="secondary" type="button" @click=${this.#addHarvest}>+ Ajouter une récolte</button>
          </div>
        </fieldset>

        ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}

        <div class="actions">
          <button class="primary ${weak ? 'weak' : ''}" type="submit">Enregistrer</button>
          <a class="cancel" href=${this.#isNew ? (this.plantId ? href.plant(this.plantId) : href.map()) : href.map({ spot: spot.id })}>Annuler</a>
          ${this.#isNew ? nothing : html`<button class="danger" type="button" @click=${this.#delete}>Supprimer</button>`}
        </div>
      </form>
    `;
  }
}

customElements.define('gf-spot-editor', GfSpotEditor);
