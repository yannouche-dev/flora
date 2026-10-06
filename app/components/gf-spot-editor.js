// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { config } from '../config.js';
import * as db from '../core/db.js';
import { GeoController } from '../core/geo.js';
import { href } from '../core/router.js';
import { searchPlants } from '../core/search.js';
import {
  ABUNDANCE, deletePlace, entryInSeason, entryName, findEntry, formatDistance, getPlace, lastHarvest, nearbyPlaces,
  newPlace, placeTitle, plantCount, savePlace, withEntry, withoutPlant, withPlant
} from '../core/spots.js';
import { whenReady } from '../core/store.js';
import './gf-map.js';

/** Existing places closer than this are offered instead of creating a duplicate. */
const NEARBY_RADIUS = 100;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const formatDate = (/** @type {string} */ iso) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = (/** @type {string} */ iso) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Create (`plant-id` optional) or edit (`spot-id`, optional `add-plant`) a harvest place:
 * a location plus a collection of plants, each with abundance, rating, notes and harvest log.
 * New places follow the GPS until the pin is dragged or placed by long press.
 */
export class GfSpotEditor extends LitElement {
  static properties = {
    spotId: { attribute: 'spot-id' },
    plantId: { attribute: 'plant-id', converter: v => (v ? Number(v) : null) },
    addPlant: { attribute: 'add-plant', converter: v => (v ? Number(v) : null) },
    pick: { type: Boolean },
    _place: { state: true },
    _manual: { state: true },
    _open: { state: true },
    _picker: { state: true },
    _pickerQuery: { state: true },
    _pickerResults: { state: true },
    _todayFor: { state: true },
    _nearby: { state: true },
    _error: { state: true }
  };

  static styles = css`
    *, *::before, *::after { box-sizing: border-box; }
    :host {
      display: grid;
      grid-template-rows: minmax(200px, 38%) 1fr;
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
    .nearby {
      border: 1px solid var(--gf-accent);
      background: var(--gf-accent-soft);
      border-radius: var(--gf-radius);
      padding: 10px 12px;
      font-size: 0.9rem;
      display: grid;
      gap: 8px;
    }
    .nearby ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .nearby li { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .nearby li span { flex: 1; min-width: 140px; }
    .nearby small { color: var(--gf-text-muted); }
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
    textarea { min-height: 64px; resize: vertical; }
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
      font-size: 1.5rem;
      line-height: 1;
      background: none;
      border: 0;
      padding: 2px;
      cursor: pointer;
      color: var(--gf-border);
    }
    .stars button.on { color: #f59e0b; }
    h2 { font-size: 1rem; margin: 6px 0 0; display: flex; align-items: center; gap: 8px; }
    h2 .count { color: var(--gf-text-muted); font-weight: 400; }
    .entries { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .entry {
      border: 1px solid var(--gf-border);
      border-radius: var(--gf-radius);
      background: var(--gf-surface);
    }
    .entry.open { border-color: var(--gf-accent); }
    .entry > button.head {
      width: 100%;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 2px 10px;
      align-items: center;
      text-align: left;
      font: inherit;
      color: inherit;
      background: none;
      border: 0;
      padding: 10px 12px;
      cursor: pointer;
    }
    .head .name { font-weight: 600; }
    .head .sci { font-family: var(--gf-font-serif); font-style: italic; color: var(--gf-text-muted); font-size: 0.85rem; }
    .head .summary { grid-column: 1 / -1; font-size: 0.8rem; color: var(--gf-text-muted); display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .head .chev { grid-row: 1; grid-column: 2; color: var(--gf-text-muted); transition: transform 0.15s; }
    .entry.open .chev { transform: rotate(180deg); }
    .entry .body { padding: 12px; display: grid; gap: 12px; border-top: 1px solid var(--gf-border); }
    .badge { background: #fde047; color: #422006; border-radius: 999px; padding: 0 8px; font-size: 0.75rem; font-weight: 600; }
    .mini-stars { color: #f59e0b; letter-spacing: 1px; }
    fieldset { border: 0; margin: 0; padding: 0; display: grid; gap: 6px; }
    legend { font-size: 0.85rem; color: var(--gf-text-muted); padding: 0; margin-bottom: 6px; }
    .picker ul { list-style: none; margin: 6px 0 0; padding: 0; border: 1px solid var(--gf-border); border-radius: 8px; overflow: hidden; }
    .picker li button {
      width: 100%;
      text-align: left;
      font: inherit;
      padding: 9px 12px;
      border: 0;
      border-bottom: 1px solid var(--gf-border);
      background: var(--gf-surface);
      color: var(--gf-text);
      cursor: pointer;
    }
    .picker li:last-child button { border-bottom: 0; }
    .picker li button[disabled] { opacity: 0.5; cursor: default; }
    .picker i { color: var(--gf-text-muted); font-family: var(--gf-font-serif); }
    .add-plant {
      font: inherit;
      font-weight: 600;
      padding: 10px 14px;
      border-radius: var(--gf-radius);
      border: 1px dashed var(--gf-accent);
      background: none;
      color: var(--gf-accent);
      cursor: pointer;
      justify-self: start;
    }
    .harvests { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .harvests li {
      display: flex;
      gap: 8px;
      align-items: baseline;
      padding: 6px 10px;
      border-radius: 8px;
      background: var(--gf-bg);
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
    .remove { justify-self: start; color: var(--gf-danger); background: none; border: 0; font: inherit; font-size: 0.85rem; cursor: pointer; padding: 0; }
    .muted { margin: 0; color: var(--gf-text-muted); font-size: 0.9rem; }
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
    .error { color: var(--gf-danger); font-size: 0.9rem; margin: 0; }
  `;

  #geo = new GeoController(this);

  constructor() {
    super();
    /** @type {string | null} */
    this.spotId = null;
    /** @type {number | null} */
    this.plantId = null;
    /** @type {number | null} */
    this.addPlant = null;
    /** Open the plant picker straight away (map sheet's "+ Plante"). */
    this.pick = false;
    /** @type {import('../core/spots.js').Place | null | undefined} */
    this._place = undefined;
    /** Pin placed by hand: stop following the GPS. */
    this._manual = false;
    /** Plant entry whose details are expanded. @type {number | null} */
    this._open = null;
    this._picker = false;
    this._pickerQuery = '';
    /** @type {any[]} */
    this._pickerResults = [];
    /** Plants added during this edit → "harvested today" quantity ('' = yes, no quantity; null = no). @type {Map<number | null, string | null>} */
    this._todayFor = new Map();
    /** @type {{ place: import('../core/spots.js').Place, distance: number }[]} */
    this._nearby = [];
    /** @type {string | null} */
    this._error = null;
  }

  get #isNew() { return !this.spotId; }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (changed.has('spotId') || changed.has('plantId') || changed.has('addPlant')) this.#load();

    // A new place follows the GPS until the user places it by hand.
    const fix = this.#geo.state.fix;
    if (this.#isNew && this._place && fix && !this._manual) {
      const [lon, lat] = this._place.geometry.coordinates;
      if (lon !== fix.coordinates[0] || lat !== fix.coordinates[1] || this._place.properties.accuracy !== Math.round(fix.accuracy)) {
        this._place = {
          ...this._place,
          geometry: { type: 'Point', coordinates: fix.coordinates },
          properties: { ...this._place.properties, accuracy: Math.round(fix.accuracy) }
        };
        this.#findNearby();
      }
    }
  }

  async #load() {
    try {
      await this.#read();
    } catch (error) {
      console.error(error);
      this._place = null;
      this._error = 'Lecture impossible : ' + /** @type {Error} */ (error).message;
    }
  }

  async #read() {
    await whenReady();
    this._todayFor = new Map();
    this._nearby = [];
    if (this.spotId) {
      let place = await getPlace(this.spotId);
      if (place && this.addPlant) {
        if (!findEntry(place, this.addPlant)) {
          const plant = await db.get('plants', this.addPlant);
          if (plant) {
            place = withPlant(place, plant);
            this._todayFor = new Map([[plant.id, '']]);
          }
        }
        this._open = this.addPlant;
      }
      this._place = place || null;
      this._picker = this.pick;
      this._manual = true;
      document.title = (place ? placeTitle(place) : 'Lieu') + ' — GeoFlora';
    } else {
      const fix = this.#geo.state.fix;
      // Without a fix yet, start at the centre of France; the pin jumps to the GPS position when it arrives.
      let place = newPlace(fix?.coordinates || [2.35, 46.6], { accuracy: fix ? Math.round(fix.accuracy) : null });
      const plant = this.plantId ? await db.get('plants', this.plantId) : null;
      if (plant) {
        place = withPlant(place, plant);
        this._todayFor = new Map([[plant.id, '']]);
        this._open = plant.id;
      } else {
        this._picker = true;
      }
      this._place = place;
      this._manual = false;
      document.title = 'Nouveau lieu — GeoFlora';
      if (fix) this.#findNearby();
    }
  }

  async #findNearby() {
    if (!this.#isNew || !this._place) return;
    try {
      this._nearby = await nearbyPlaces(this._place.geometry.coordinates, NEARBY_RADIUS);
    } catch { this._nearby = []; }
  }

  /** @param {Partial<import('../core/spots.js').Place['properties']>} patch */
  #patch(patch) {
    if (!this._place) return;
    this._place = { ...this._place, properties: { ...this._place.properties, ...patch } };
  }

  /** @param {number | null} plantId @param {Partial<import('../core/spots.js').PlantEntry>} patch */
  #patchEntry(plantId, patch) {
    if (this._place) this._place = withEntry(this._place, plantId, patch);
  }

  /** @param {[number, number]} coordinates */
  #place(coordinates) {
    if (!this._place) return;
    this._manual = true;
    this._place = {
      ...this._place,
      geometry: { type: 'Point', coordinates },
      properties: { ...this._place.properties, accuracy: null }
    };
    this.#findNearby();
  }

  #useGps() {
    const fix = this.#geo.state.fix;
    if (!fix || !this._place) return;
    this._manual = false;
    this._place = {
      ...this._place,
      geometry: { type: 'Point', coordinates: fix.coordinates },
      properties: { ...this._place.properties, accuracy: Math.round(fix.accuracy) }
    };
    /** @type {any} */ (this.renderRoot.querySelector('gf-map'))?.flyTo(fix.coordinates, 18);
    this.#findNearby();
  }

  /** @param {Event} event */
  async #pickerInput(event) {
    const q = /** @type {HTMLInputElement} */ (event.target).value;
    this._pickerQuery = q;
    this._pickerResults = q.trim().length >= 2 ? await searchPlants(q, 8) : [];
  }

  /** @param {any} summary */
  async #pickPlant(summary) {
    if (!this._place || findEntry(this._place, summary.id)) return;
    const plant = await db.get('plants', summary.id);
    this._place = withPlant(this._place, plant);
    this._todayFor = new Map(this._todayFor).set(plant.id, '');
    this._open = plant.id;
    this._pickerQuery = '';
    this._pickerResults = [];
    this._picker = false;
    this._error = null;
  }

  /** @param {number | null} plantId */
  #removePlant(plantId) {
    if (!this._place) return;
    const entry = findEntry(this._place, plantId);
    if (entry?.harvests.length && !confirm(`Retirer ${entryName(entry)} de ce lieu, avec son journal de récolte ?`)) return;
    this._place = withoutPlant(this._place, plantId);
    const todayFor = new Map(this._todayFor);
    todayFor.delete(plantId);
    this._todayFor = todayFor;
  }

  /** @param {number | null} plantId @param {Event} event */
  #addHarvest(plantId, event) {
    const box = /** @type {HTMLElement} */ (event.target).closest('.add-harvest');
    const get = (/** @type {string} */ name) => /** @type {HTMLInputElement} */ (box?.querySelector(`[name="${name}"]`));
    const date = get('date').value;
    const entry = this._place && findEntry(this._place, plantId);
    if (!date || !entry) return;
    const harvests = [...entry.harvests, { date, quantity: get('quantity').value.trim(), note: get('note').value.trim() }]
      .sort((a, b) => b.date.localeCompare(a.date));
    this.#patchEntry(plantId, { harvests });
    get('quantity').value = '';
    get('note').value = '';
  }

  /** @param {number | null} plantId @param {number} index */
  #removeHarvest(plantId, index) {
    const entry = this._place && findEntry(this._place, plantId);
    if (entry) this.#patchEntry(plantId, { harvests: entry.harvests.filter((_, i) => i !== index) });
  }

  /** Adds the plant being recorded to an existing nearby place instead of creating a new one. */
  /** @param {import('../core/spots.js').Place} target */
  #useExisting(target) {
    const first = this._place?.properties.plants[0];
    location.hash = href.spot(target.id, first?.plantId ?? undefined);
  }

  /** @param {SubmitEvent} event */
  async #save(event) {
    event.preventDefault();
    if (!this._place) return;
    if (!this._place.properties.plants.length && !this._place.properties.name.trim()) {
      this._error = 'Ajoutez au moins une plante, ou donnez un nom au lieu.';
      return;
    }
    let place = this._place;
    // "Harvested today" on plants added during this edit.
    for (const [plantId, quantity] of this._todayFor) {
      const entry = findEntry(place, plantId);
      if (quantity === null || !entry) continue;
      place = withEntry(place, plantId, {
        harvests: [{ date: today(), quantity: quantity.trim(), note: '' }, ...entry.harvests].sort((a, b) => b.date.localeCompare(a.date))
      });
    }
    try {
      const saved = await savePlace(place);
      location.hash = href.map({ spot: saved.id });
    } catch (error) {
      this._error = 'Enregistrement impossible : ' + /** @type {Error} */ (error).message;
    }
  }

  async #delete() {
    if (!this._place) return;
    const n = this._place.properties.plants.length;
    if (!confirm(`Supprimer ce lieu${n ? ` et ses ${plantCount(n)}` : ''}, avec leur journal de récolte ?`)) return;
    await deletePlace(this._place.id);
    location.hash = href.map();
  }

  #gpsStatus() {
    const { fix, error } = this.#geo.state;
    if (this._manual) {
      return html`<div class="gps"><span class="dot good"></span> Position ${this.#isNew ? 'placée à la main' : 'enregistrée'}
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

  #nearbyBanner() {
    if (!this.#isNew || !this._nearby.length || !this._place) return nothing;
    const first = this._place.properties.plants[0];
    return html`
      <div class="nearby" role="region" aria-label="Lieux à proximité">
        <strong>Vous êtes près d’un lieu déjà enregistré</strong>
        <ul>
          ${this._nearby.slice(0, 3).map(({ place, distance }) => html`
            <li>
              <span>${placeTitle(place)} <small>· ${formatDistance(distance)} · ${plantCount(place.properties.plants.length)}</small></span>
              <button class="secondary" type="button" @click=${() => this.#useExisting(place)}>
                ${first && !findEntry(place, first.plantId) ? `Y ajouter ${entryName(first)}` : 'Ouvrir ce lieu'}
              </button>
            </li>`)}
        </ul>
      </div>`;
  }

  /** @param {import('../core/spots.js').PlantEntry} entry */
  #entry(entry) {
    const id = entry.plantId;
    const open = this._open === id;
    const last = lastHarvest(entry);
    const fresh = this._todayFor.has(id);
    const todayQuantity = this._todayFor.get(id);

    return html`
      <li class="entry ${open ? 'open' : ''}">
        <button class="head" type="button" aria-expanded=${open ? 'true' : 'false'} @click=${() => { this._open = open ? null : id; }}>
          <span class="name">${entryName(entry)}</span>
          <span class="chev" aria-hidden="true">▾</span>
          <span class="summary">
            ${entry.vernacularName ? html`<span class="sci">${entry.scientificName}</span>` : nothing}
            ${entryInSeason(entry) ? html`<span class="badge">En saison</span>` : nothing}
            <span>${ABUNDANCE.find(a => a.value === entry.abundance)?.label}</span>
            ${entry.rating ? html`<span class="mini-stars">${'★'.repeat(entry.rating)}</span>` : nothing}
            <span>${last ? 'Récolté le ' + shortDate(last.date) : fresh ? 'Nouvelle plante' : 'Aucune récolte'}</span>
          </span>
        </button>
        ${open ? html`
          <div class="body">
            ${fresh ? html`
              <div class="today">
                <input id="today-${id}" type="checkbox" .checked=${todayQuantity !== null}
                  @change=${e => { this._todayFor = new Map(this._todayFor).set(id, e.target.checked ? '' : null); }} />
                <label for="today-${id}">Récolté aujourd’hui</label>
                ${todayQuantity !== null ? html`<input type="text" placeholder="Quantité (ex. 500 g)" .value=${todayQuantity || ''}
                  @input=${e => { this._todayFor = new Map(this._todayFor).set(id, e.target.value); }} />` : nothing}
              </div>` : nothing}

            <fieldset>
              <legend>Abondance</legend>
              <div class="chips">
                ${ABUNDANCE.map(a => html`<button type="button" aria-pressed=${entry.abundance === a.value ? 'true' : 'false'}
                  @click=${() => this.#patchEntry(id, { abundance: /** @type {any} */ (a.value) })}>${a.label}</button>`)}
              </div>
            </fieldset>

            <fieldset>
              <legend>Qualité</legend>
              <div class="stars" role="radiogroup" aria-label="Qualité">
                ${[1, 2, 3, 4, 5].map(n => html`<button type="button" role="radio" aria-checked=${entry.rating === n ? 'true' : 'false'}
                  aria-label="${n} sur 5" class=${entry.rating >= n ? 'on' : ''}
                  @click=${() => this.#patchEntry(id, { rating: entry.rating === n ? 0 : n })}>★</button>`)}
              </div>
            </fieldset>

            <label class="field">Notes sur cette plante
              <textarea .value=${entry.notes} placeholder="Stade, partie récoltée, conseils…"
                @input=${e => this.#patchEntry(id, { notes: e.target.value })}></textarea>
            </label>

            <fieldset>
              <legend>Journal de récolte</legend>
              ${entry.harvests.length ? html`
                <ul class="harvests">
                  ${entry.harvests.map((h, i) => html`
                    <li>
                      <strong>${formatDate(h.date)}</strong>
                      <span class="what">${[h.quantity, h.note].filter(Boolean).join(' · ')}</span>
                      <button type="button" aria-label="Supprimer cette récolte" @click=${() => this.#removeHarvest(id, i)}>×</button>
                    </li>`)}
                </ul>` : html`<p class="muted">Aucune récolte notée.</p>`}
              <div class="add-harvest">
                <input type="date" name="date" .value=${today()} max=${today()} aria-label="Date" />
                <input type="text" name="quantity" placeholder="Quantité" aria-label="Quantité" />
                <input type="text" name="note" placeholder="Remarque (facultatif)" aria-label="Remarque" />
                <button class="secondary" type="button" @click=${e => this.#addHarvest(id, e)}>+ Ajouter une récolte</button>
              </div>
            </fieldset>

            <button class="remove" type="button" @click=${() => this.#removePlant(id)}>Retirer cette plante du lieu</button>
          </div>` : nothing}
      </li>`;
  }

  #pickerView() {
    const place = this._place;
    if (!this._picker) {
      return html`<button class="add-plant" type="button" @click=${() => { this._picker = true; }}>+ Ajouter une plante</button>`;
    }
    return html`
      <div class="picker">
        <label class="field">Ajouter une plante
          <input type="search" placeholder="Nom de la plante…" autocomplete="off" .value=${this._pickerQuery} @input=${this.#pickerInput} />
        </label>
        ${this._pickerResults.length ? html`<ul>${this._pickerResults.map(r => {
          const already = Boolean(place && findEntry(place, r.id));
          return html`<li><button type="button" ?disabled=${already} @click=${() => this.#pickPlant(r)}>
            ${r.vernacularName || r.scientificName} <i>${r.scientificName}</i>${already ? ' · déjà dans ce lieu' : ''}</button></li>`;
        })}</ul>` : nothing}
      </div>`;
  }

  render() {
    const place = this._place;
    if (place === undefined) return html`<div></div><form><p>Chargement…</p></form>`;
    if (place === null) {
      return html`<div></div><form>
        <p>${this._error || 'Ce lieu n’existe plus.'}</p>
        ${this._error ? html`<button class="secondary" type="button" @click=${() => this.#load()}>Réessayer</button>` : nothing}
        <a href=${href.map()}>Retour à la carte</a>
      </form>`;
    }

    const p = place.properties;
    const fix = this.#geo.state.fix;
    const weak = this.#isNew && !this._manual && (!fix || fix.accuracy > config.goodAccuracy);

    return html`
      <gf-map
        .pin=${place.geometry.coordinates}
        track
        fit
        @pin-move=${e => this.#place(e.detail.coordinates)}
        @map-longpress=${e => this.#place(e.detail.coordinates)}
      ></gf-map>

      <form @submit=${this.#save}>
        ${this.#gpsStatus()}
        ${this.#nearbyBanner()}

        <label class="field">Nom du lieu
          <input type="text" .value=${p.name} placeholder="ex. Lisière nord du bois" @input=${e => this.#patch({ name: e.target.value })} />
        </label>

        <h2>Plantes <span class="count">${p.plants.length}</span></h2>
        ${p.plants.length ? html`<ul class="entries">${p.plants.map(entry => this.#entry(entry))}</ul>` : nothing}
        ${this.#pickerView()}

        <label class="field">Notes sur le lieu
          <textarea .value=${p.notes} placeholder="Accès, stationnement, propriétaire, exposition…" @input=${e => this.#patch({ notes: e.target.value })}></textarea>
        </label>

        ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}

        <div class="actions">
          <button class="primary ${weak ? 'weak' : ''}" type="submit">Enregistrer</button>
          <a class="cancel" href=${this.#isNew ? (this.plantId ? href.plant(this.plantId) : href.map()) : href.map({ spot: place.id })}>Annuler</a>
          ${this.#isNew ? nothing : html`<button class="danger" type="button" @click=${this.#delete}>Supprimer le lieu</button>`}
        </div>
      </form>
    `;
  }
}

customElements.define('gf-spot-editor', GfSpotEditor);
