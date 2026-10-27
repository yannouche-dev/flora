// @ts-check
import { LitElement, html, css, nothing, repeat } from 'lit';
import { config } from '../config.js';
import * as db from '../core/db.js';
import { getPlant } from '../core/plants.js';
import { GeoController } from '../core/geo.js';
import { moduleOn } from '../core/modules.js';
import { href } from '../core/router.js';
import { back, openView, replaceHash, replaceView } from '../core/history.js';
import {
  ABUNDANCE, copyAsList, defaultPlantPosition, deletePlace, distance, entryInSeason, entryName, entryPosition, exportGeoJSON, findEntry,
  formatDistance, getPlace, lastHarvest, locationQuestion, matchCollections, plantMarkers, removeQuestion,
  newCollection, newPlace, placesNear, placeTitle, plantCount, savePatch, savePlace, shareCollection, spotEvents, updatePlace, withEntry, withLocation, withoutPlant, withPlant, entriesOf, lastEntry } from '../core/collections.js';
import { joinEntry } from '../core/place-model.js';
import { StoreController, whenReady } from '../core/store.js';
import { addressAt, altitudeAt, formatCoordinates } from '../core/geoservices.js';
import { BP } from '../core/media.js';
import { PaneSizer, splitStyles } from '../core/panes.js';
import { ui } from '../styles/ui.js';
import './gf-lookalikes.js';
import './gf-map.js';
import './gf-status.js';
import './gf-thumb.js';
import { icon, kindIcon } from '../core/icons.js';
import { askHarvest } from './gf-harvest-warning.js';
import { ask, confirmAsk } from './gf-ask.js';
import './gf-plant-pick-list.js';
import './gf-place-insights.js';
import './gf-nearby-places.js';
import { map3dProblem, openMap3d } from './gf-map3d.js';
import { briefToast } from '../core/toast.js';
import { hintView, takeHint } from '../core/hints.js';
import { continueWalk } from '../miniapp/kit/trail-store.js';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const formatDate = (/** @type {string} */ iso) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = (/** @type {string} */ iso) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * One page for every collection: favorites, lists and places.
 *  - edit (`spot-id`, optional `add-plant` / `pick`): changes are saved automatically;
 *  - create a list (`kind="list"`, optional `plant-id`): saved automatically from the first change;
 *  - create a place (`kind="place"`, optional `plant-id`): follows the GPS until "Enregistrer"
 *    (or until the pin is moved by hand: dragged, or placed by a long press — once « Déplacer le lieu ici ? » is
 *    confirmed on the map; meanwhile the GPS moves neither the pin dropped nor the point proposed).
 * Places show the IGN map; lists can be given a position, which turns them into places.
 *
 * A saved place lives on the Carte (`embedded`, in its panel): the Carte's map is the place's map. The editor
 * then asks it through events — map-fly {coordinates, zoom}, map-edit (✎ positions), plant-focus {plantId},
 * panel-close — and the Carte hands moves back with `savePositions()`. Opened on its own, a saved place
 * redirects to the Carte.
 *
 * On its own, from BP.phone wide (its own width, not the window's): the map ┃ the form, side by side, the form's
 * width the user's (a separator, core/panes.js, kept under placeLayout); narrower, the map above the form.
 */
export class GfSpotEditor extends LitElement {
  static properties = {
    spotId: { attribute: 'spot-id' },
    plantId: { attribute: 'plant-id', converter: v => (v ? Number(v) : null) },
    addPlant: { attribute: 'add-plant', converter: v => (v ? Number(v) : null) },
    pick: { type: Boolean },
    kind: {},
    at: { attribute: false },
    embedded: { type: Boolean, reflect: true },
    /** Embedded: the Carte's map is editing positions. */
    mapEditing: { attribute: false },
    /** Embedded: the plant tapped on the map (its entry opens). */
    focusEntry: { attribute: false },
    _saveState: { state: true },
    _place: { state: true },
    _manual: { state: true },
    _open: { state: true },
    _picker: { state: true },
    _pickerQuery: { state: true },
    _todayFor: { state: true },
    _nearby: { state: true },
    _error: { state: true },
    _note: { state: true },
    _where: { state: true },
    _editPos: { state: true },
    /** Its own width (px). */
    _w: { state: true }
  };

  static styles = [ui, splitStyles, css`
    details.insights { margin: 16px 0 4px; padding: 10px 12px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius); background: var(--gf-surface); }
    details.insights summary { cursor: pointer; font-weight: 600; font-size: 0.9rem; display: flex; gap: 6px; align-items: center; }
    details.insights[open] summary { margin-bottom: 10px; }
    :host {
      display: grid;
      grid-template-rows: minmax(200px, 38%) 1fr;
      min-height: 0;
    }
    :host([nogeo]) { grid-template-rows: 1fr; }
    /* Wide: the map ┃ the form (its width chosen, --w-form), the separator in a 1 px column between them. */
    :host([wide]) { grid-template-rows: minmax(0, 1fr); grid-template-columns: minmax(260px, 1fr) 1px var(--w-form, 480px); }
    :host([wide]) > .split { width: auto; }
    /* In the Carte's panel: the panel scrolls, the map is the Carte's. */
    :host([embedded]) { display: block; }
    :host([embedded]) form { overflow: visible; padding-top: 4px; }
    :host([embedded]) .footer { bottom: 0; }
    .title { display: flex; align-items: center; gap: 10px; }
    .title h1 { margin: 0; font-size: 1.35rem; }
    .title .kind { font-size: 1.4rem; }
    .title input { font-size: 1.2rem; font-weight: 600; }
    .save-state { font-size: 0.8rem; color: var(--gf-text-muted); margin-right: auto; }
    .save-state.error { color: var(--gf-danger); }
    .toolbar { display: flex; gap: 8px; flex-wrap: wrap; }
    /* Dashed "add" buttons: something new goes here. */
    .add { border-style: dashed; border-color: var(--gf-accent); color: var(--gf-accent); font-weight: 600; justify-self: start; }
    .map-area { position: relative; min-height: 0; }
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
    }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--gf-text-muted); flex: none; }
    .dot.good { background: #16a34a; }
    .dot.weak { background: #f59e0b; }
    .dot.none { background: var(--gf-danger); }
    .gps .hint { color: var(--gf-text-muted); flex-basis: 100%; font-size: 0.8rem; }
    .gps .hint-once { flex-basis: 100%; box-shadow: none; background: var(--gf-surface-2); }
    .gps .hint-once button { margin-left: 0; }
    .gps .where { flex-basis: 100%; font-size: 0.85rem; }
    .gps .coords { font-variant-numeric: tabular-nums; color: var(--gf-text-muted); }
    .gps button { margin-left: auto; }
    textarea { min-height: 64px; }
    .chips { display: flex; gap: 8px; flex-wrap: wrap; }
    .stars button {
      font-size: 1.5rem;
      line-height: 1;
      min-height: 0;
      background: none;
      border: 0;
      padding: 2px;
      color: var(--gf-border);
    }
    .stars button.on { color: var(--gf-star); }
    h2 { font-size: 1rem; margin: 6px 0 0; display: flex; align-items: center; gap: 8px; }
    h2 .count { color: var(--gf-text-muted); font-weight: 400; }
    .entries { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .entry { padding: 0; }
    .entry.open { border-color: var(--gf-accent); }
    .entry > button.head {
      width: 100%;
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 2px 10px;
      align-items: center;
      text-align: left;
      font-size: 1rem;
      font-weight: 400;
      background: none;
      border: 0;
      border-radius: var(--gf-radius);
      padding: 10px 12px;
    }
    .head .name { font-weight: 600; }
    .head .name .nth { font-weight: 500; font-size: 0.78em; color: var(--gf-text-muted); white-space: nowrap; }
    .head .sci { font-family: var(--gf-font-serif); font-style: italic; color: var(--gf-text-muted); font-size: 0.85rem; }
    .head gf-thumb { grid-row: 1 / span 2; grid-column: 1; }
    .head .name { grid-column: 2; }
    .head .summary { grid-column: 2 / -1; font-size: 0.8rem; color: var(--gf-text-muted); display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .head .chev { grid-row: 1; grid-column: 3; color: var(--gf-text-muted); transition: transform 0.15s; }
    .entry.open .chev { transform: rotate(180deg); }
    .entry .body { padding: 12px; display: grid; gap: 12px; border-top: 1px solid var(--gf-border); }
    .entry .body > .button, .entry .body > .link { justify-self: start; }
    .mini-stars { color: var(--gf-star); letter-spacing: 1px; }
    fieldset { border: 0; margin: 0; padding: 0; display: grid; gap: 6px; }
    legend { font-size: 0.85rem; color: var(--gf-text-muted); padding: 0; margin-bottom: 6px; }
    .harvests { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .harvests li {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 4px 4px 4px 10px;
      border-radius: var(--gf-radius-sm);
      background: var(--gf-bg);
      font-size: 0.9rem;
    }
    .harvests li .what { flex: 1; color: var(--gf-text-muted); }
    .harvests .icon-btn { width: 32px; height: 32px; font-size: 1.1rem; }
    .add-harvest { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .add-harvest input[name='note'] { grid-column: 1 / -1; }
    .add-harvest button { grid-column: 1 / -1; justify-self: start; }
    .today { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 0.95rem; }
    .today input[type='text'] { flex: 1; min-width: 140px; width: auto; }
    .name-suggest { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: -4px; font-size: 0.85rem; color: var(--gf-text-muted); }
    .name-suggest span { flex-basis: 100%; }
    .name-suggest small { color: var(--gf-text-muted); margin-left: 4px; }
    .name-hint { margin: -4px 0 0; color: var(--gf-text-muted); font-size: 0.85rem; }
    .plant-pos { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 0.85rem; }
    .plant-pos span { flex-basis: 100%; }
    .plant-pos small { color: var(--gf-text-muted); flex-basis: 100%; }
    p.muted { margin: 0; font-size: 0.9rem; }
    .footer { position: sticky; bottom: -24px; padding: 10px 0 14px; background: var(--gf-bg); gap: 10px; }
    .footer .danger { margin-left: auto; }
    .primary.weak { background: var(--gf-surface-2); color: var(--gf-text); border-color: var(--gf-border); }
    .error { color: var(--gf-danger); font-size: 0.9rem; margin: 0; }
  `];

  #geo = new GeoController(this);
  #store = new StoreController(this);
  /** Wide: the form's width beside the map (the map holds its frame while it changes). */
  #sizer = new PaneSizer(this, config.storageKeys.placeLayout, { form: { width: 480, min: 360, title: 'Lieu' } },
    { onChange: () => /** @type {any} */ (this.renderRoot.querySelector('.map-area gf-map'))?.holdFrame?.() });
  #size = new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w !== this._w) this._w = w; });
  /** The map ┃ the form, side by side (on its own, a place with its map, from BP.phone wide). */
  #wide = false;
  /** The widest the form may be: the map keeps 260 px. */
  get #formMax() { return this._w - 260 - 1; }
  /**
   * Harvest details (rating, log, "harvested today") only in harvest mode, and only for places. The confusion
   * reminder is not one: an opened plant always shows it, whatever the mode.
   */
  get #harvest() { return this.#store.state.harvestMode && this.#isPlace; }

  constructor() {
    super();
    this._w = 0;
    /** @type {string | null} */
    this.spotId = null;
    /** @type {number | null} */
    this.plantId = null;
    /** @type {number | null} */
    this.addPlant = null;
    /** Open the plant picker straight away (map sheet's "+ Plante"). */
    this.pick = false;
    /** Kind of collection to create when there is no `spot-id`. @type {'list' | 'place'} */
    this.kind = 'place';
    /** @type {[number, number] | null} point picked on the map for a new place */
    this.at = null;
    this.embedded = false;
    this.mapEditing = false;
    /** @type {string | number | null} an occurrence id, or a plant id (its first occurrence) */
    this.focusEntry = null;
    /** Address and altitude of the place point (IGN). @type {{ key: string, address?: string | null, alt?: number | null }} */
    this._where = { key: '' };
    /** @type {'' | 'saving' | 'saved' | 'error'} */
    this._saveState = '';
    /** @type {string | null} */
    this._note = null;
    /** @type {import('../core/collections.js').Place | null | undefined} */
    this._place = undefined;
    /** Pin placed by hand: stop following the GPS. */
    this._manual = false;
    /** Positions editing: off for a saved place (read-only map), on while creating one. */
    this._editPos = false;
    /** Plant entry (its occurrence id) whose details are expanded. @type {string | null} */
    this._open = null;
    this._picker = false;
    this._pickerQuery = '';
    /** Occurrences (ids) added during this edit → "harvested today" quantity ('' = yes, no quantity; null = no). @type {Map<string | null, string | null>} */
    this._todayFor = new Map();
    /** @type {{ place: import('../core/collections.js').Place, distance: number }[]} */
    this._nearby = [];
    /** @type {string | null} */
    this._error = null;
  }

  /** A new collection not saved yet. */
  #persisted = false;
  /** Opened as a new collection/place in this editor (an autosaved draft can then be dropped). */
  #createdHere = false;
  get #isNew() { return !this.spotId && !this.#persisted; }
  /** Only a new place waits for an explicit "Enregistrer" (its position may still be settling). */
  get #autosave() { return !(this.#isNew && this._place?.properties.kind === 'place'); }
  get #isPlace() { return this._place?.properties.kind === 'place' && Boolean(this._place?.geometry); }

  /** @type {number | undefined} */ #saveTimer;
  /** @type {Promise<unknown> | null} */ #saving = null;
  #dirty = false;

  /** Records an edit: autosaved shortly after, or kept for "Enregistrer" on a new place. */
  #changed() {
    this._error = null;
    if (!this.#autosave) return;
    this.#dirty = true;
    this._saveState = 'saving';
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.#flush(), 600);
  }

  async #flush() {
    clearTimeout(this.#saveTimer);
    if (!this.#dirty || !this._place) return;
    if (this.#saving) { await this.#saving; return this.#flush(); }
    this.#dirty = false;
    const wasNew = this.#isNew;
    const mine = this.#payload();
    // A new collection is created; an existing one gets only what was edited here since it was read (#base → mine),
    // applied to it as stored now — a plant, a harvest, a name changed meanwhile elsewhere (another tab, « Noter
    // ici », the altitudes) are kept; deleted meanwhile, it is not made again.
    this.#saving = (wasNew ? savePlace(mine) : savePatch(this.#base || mine, mine))
      .then(saved => {
        this.#base = mine;
        this.#savedAt = saved.properties.updatedAt;
        if (wasNew) {
          this.#persisted = true;
          replaceHash(href.spot(saved.id));
        }
        this._saveState = this.#dirty ? 'saving' : 'saved';
      })
      .catch(error => {
        console.error(error);
        this._saveState = 'error';
        if (/** @type {Error} */ (error).name === 'GoneError') {
          this._error = this.#goneText();
          return;
        }
        this.#dirty = true;
        this._error = 'Enregistrement impossible : ' + /** @type {Error} */ (error).message;
      })
      .finally(() => { this.#saving = null; });
    await this.#saving;
  }

  /** What gets stored: the edited collection plus "harvested today" on newly added plants of a place. */
  #payload() {
    let place = /** @type {import('../core/collections.js').Collection} */ (this._place);
    if (place.properties.kind !== 'place' || !this.#store.state.harvestMode) return place;
    for (const [key, quantity] of this._todayFor) {
      const entry = findEntry(place, key);
      if (quantity === null || !entry) continue;
      place = withEntry(place, entry.id, {
        harvests: [{ date: today(), quantity: quantity.trim(), note: '' }, ...entry.harvests].sort((a, b) => b.date.localeCompare(a.date))
      });
    }
    return place;
  }

  /** updatedAt of the version this editor last read or wrote: anything newer was changed elsewhere. */
  #savedAt = '';
  /**
   * The collection as this editor last read or wrote it (with today's harvests): what is saved is the difference
   * between it and the edited one, applied to the stored record (collections.js savePatch).
   * @type {import('../core/collections.js').Collection | null}
   */
  #base = null;

  #goneText() {
    return `${this.#isPlace ? 'Ce lieu a été supprimé' : 'Cette liste a été supprimée'} entre-temps (dans un autre onglet ?) : vos dernières modifications n’ont pas été enregistrées.`;
  }

  /**
   * « Noter ici », the map, another tab or window may change this collection meanwhile: read it again then (not while
   * an edit waits to be saved — that one is applied to the stored record, keeping those changes). Deleted elsewhere:
   * said, never made again.
   */
  #onSpotsChange = async () => {
    const id = this.spotId;
    if (!id || this.#dirty || this.#saving) return;
    const place = await getPlace(id).catch(() => null);
    if (this.#dirty || this.#saving || id !== this.spotId) return;
    if (!place) {
      if (this._place && this.#savedAt) { this._error = this.#goneText(); this._saveState = ''; }
      return;
    }
    if (place.properties.updatedAt === this.#savedAt) return;
    this.#savedAt = place.properties.updatedAt;
    this.#base = place;
    // Today's harvests of the added plants are saved in it already.
    this._todayFor = new Map();
    this._place = place;
  };

  connectedCallback() {
    super.connectedCallback();
    spotEvents.addEventListener('change', this.#onSpotsChange);
    this.#size.observe(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    spotEvents.removeEventListener('change', this.#onSpotsChange);
    this.#size.disconnect();
    // Leaving the page: save what is pending right away.
    this.#flush();
  }

  /** Positions editing: the Carte's map when embedded, else this page's. */
  get #editing() { return this.embedded ? Boolean(this.mapEditing) : this._editPos; }

  /** @param {string} type @param {any} [detail] */
  #emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true })); }

  /** @param {[number, number]} coordinates @param {number} zoom */
  #fly(coordinates, zoom) {
    if (this.embedded) this.#emit('map-fly', { coordinates, zoom });
    else /** @type {any} */ (this.renderRoot.querySelector('gf-map'))?.flyTo(coordinates, zoom);
  }

  /** @param {Map<string, any>} changed */
  updated(changed) {
    if (changed.has('_place')) this.toggleAttribute('nogeo', !this._place?.geometry);
  }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (changed.has('spotId') || changed.has('plantId') || changed.has('addPlant') || changed.has('kind') || changed.has('at')) this.#load();
    if (changed.has('focusEntry') && this.focusEntry != null) this._open = this.#entryKey(this.focusEntry);
    if (changed.has('_place')) this.#updateWhere();
    this.#wide = !this.embedded && Boolean(this._place?.geometry) && this._w >= BP.phone;
    this.toggleAttribute('wide', this.#wide);
    if (this.#wide) this.style.setProperty('--w-form', Math.max(360, Math.min(this.#sizer.width('form'), this.#formMax)) + 'px');
    else this.style.removeProperty('--w-form');

    // A new place follows the GPS until the user places it by hand.
    const fix = this.#geo.state.fix;
    if (this.#isNew && this._place?.geometry && fix && !this._manual) {
      const [lon, lat] = this._place.geometry.coordinates;
      if (lon !== fix.coordinates[0] || lat !== fix.coordinates[1] || this._place.properties.accuracy !== Math.round(fix.accuracy)) {
        this._place = this.#movePlace(fix.coordinates, Math.round(fix.accuracy));
        this.#findNearby();
      }
    }
  }

  /**
   * Moves the place's point. While a new place is being recorded, its plants that were not
   * placed individually (still on the place's point) move along with it.
   * @param {[number, number]} coordinates @param {number | null} accuracy
   */
  #movePlace(coordinates, accuracy) {
    const place = /** @type {import('../core/collections.js').Collection} */ (this._place);
    const old = place.geometry?.coordinates;
    const follow = (/** @type {import('../core/collections.js').PlantEntry} */ e) =>
      this.#isNew && old && e.coordinates && e.coordinates[0] === old[0] && e.coordinates[1] === old[1];
    return {
      ...place,
      geometry: { type: 'Point', coordinates },
      properties: {
        ...place.properties,
        accuracy,
        plants: place.properties.plants.map(e => follow(e) ? { ...e, coordinates, accuracy } : e)
      }
    };
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
    this.#createdHere = !this.spotId;
    this._editPos = !this.spotId && this.kind !== 'list';
    if (this.spotId) {
      let place = await getPlace(this.spotId);
      // A saved place is shown on the Carte, in its panel (same map, same page).
      if (place?.geometry && place.properties.kind === 'place' && !this.embedded) {
        replaceView(href.map({ spot: place.id, add: this.addPlant ?? undefined, pick: this.pick }));
        return;
      }
      this.#savedAt = place?.properties.updatedAt || '';
      this.#base = place || null;
      if (this.embedded && this.focusEntry != null && place) this._open = findEntry(place, this.focusEntry)?.id ?? null;
      if (place && this.addPlant && place.properties.kind === 'place') {
        if (!findEntry(place, this.addPlant)) {
          const plant = await db.get('plants', this.addPlant);
          if (plant) {
            place = withPlant(place, plant, defaultPlantPosition(place, this.#geo.state.fix));
            this._todayFor = new Map([[/** @type {any} */ (lastEntry(place)).id, null]]);
          }
        }
        this._open = findEntry(place, this.addPlant)?.id ?? null;
      }
      this._place = place || null;
      this._picker = this.pick;
      this._manual = true;
      // Arrived with a plant to add ("Y ajouter…", "Ajouter à…"): that is an edit to save.
      if (place && this.addPlant && this._todayFor.size) this.#changed();
      if (!this.embedded) document.title = (place ? placeTitle(place) : 'Lieu') + ' — GeoFlora';
    } else if (this.kind === 'list') {
      let list = newCollection('list');
      const plant = this.plantId ? await db.get('plants', this.plantId) : null;
      if (plant) list = withPlant(list, plant);
      else this._picker = true;
      this._place = list;
      this._manual = true;
      document.title = 'Nouvelle liste — GeoFlora';
    } else {
      // A point picked on the map (« Créer un lieu ici ») wins over the GPS. A new place noted here (« Noter
      // ici », « Nouveau lieu »: the user's gesture) asks for the position; any other place only shows it once granted.
      if (!this.at) this.#geo.start();
      const fix = this.at ? null : this.#geo.state.fix;
      // Without a fix yet, start at the centre of France; the pin jumps to the GPS position when it arrives.
      let place = newPlace(this.at || fix?.coordinates || [2.35, 46.6], { accuracy: fix ? Math.round(fix.accuracy) : null });
      const plant = this.plantId ? await db.get('plants', this.plantId) : null;
      if (plant) {
        place = withPlant(place, plant, fix ? { coordinates: fix.coordinates, accuracy: Math.round(fix.accuracy) } : undefined);
        const added = /** @type {any} */ (lastEntry(place)).id;
        this._todayFor = new Map([[added, null]]);
        this._open = added;
      } else {
        this._picker = true;
      }
      this._place = place;
      this._manual = Boolean(this.at);
      document.title = 'Nouveau lieu — GeoFlora';
      if (fix || this.at) this.#findNearby();
    }
  }

  async #findNearby() {
    if (!this.#isNew || !this._place) return;
    try {
      this._nearby = await placesNear(this._place.geometry.coordinates, this._place.id);
    } catch { this._nearby = []; }
  }

  /** @param {Partial<import('../core/collections.js').Place['properties']>} patch */
  #patch(patch) {
    if (!this._place) return;
    this._place = { ...this._place, properties: { ...this._place.properties, ...patch } };
    this.#changed();
  }

  /** One occurrence changed. @param {string} key its entry id @param {Partial<import('../core/collections.js').PlantEntry>} patch */
  #patchEntry(key, patch) {
    if (this._place) this._place = withEntry(this._place, key, patch);
    this.#changed();
  }

  /**
   * A move on the map (✎): the place point (« Déplacer le lieu ici ? » confirmed), or a plant dropped (a new place's
   * plants on its point follow it).
   * @param {{ pin: [number, number] | null, plants: { entryId?: string, plantId: number | null, coordinates: [number, number] }[] }} moves
   */
  savePositions({ pin, plants }) {
    if (!this._place) return;
    if (pin) {
      this._manual = true;
      this._place = this.#movePlace(pin, null);
      this.#findNearby();
    }
    for (const { entryId, plantId, coordinates } of plants) {
      this._place = withEntry(this._place, entryId ?? plantId, { coordinates: [Math.round(coordinates[0] * 1e7) / 1e7, Math.round(coordinates[1] * 1e7) / 1e7], accuracy: null });
    }
    this.#changed();
    // Validated on the map: saved right away, so the markers get their new positions back at once.
    if (this.#autosave) this.#flush();
  }

  /** "Déplacer" on a plant: switch to position editing and show it. @param {[number, number] | null} coordinates */
  #editPlantPosition(coordinates) {
    if (this.embedded) this.#emit('map-edit');
    else this._editPos = true;
    this.#showOnMap(coordinates);
  }

  /** "Ici (GPS)": the plant is where I stand. @param {string} key its entry id */
  #plantHere(key) {
    const fix = this.#geo.state.fix;
    if (!fix) return;
    this.#patchEntry(key, { coordinates: fix.coordinates, accuracy: Math.round(fix.accuracy) });
    this.#fly(fix.coordinates, 19);
  }

  /** @param {[number, number] | null} coordinates */
  #showOnMap(coordinates) {
    if (coordinates) this.#fly(coordinates, 19);
  }

  #useGps() {
    const fix = this.#geo.state.fix;
    if (!fix || !this._place) return;
    this._manual = false;
    this._place = this.#movePlace(fix.coordinates, Math.round(fix.accuracy));
    this.#fly(fix.coordinates, 18);
    this.#findNearby();
    this.#changed();
  }

  /** Gives a list a position (GPS, else the centre of France to adjust by hand): it becomes a place. */
  #addLocation() {
    if (!this._place) return;
    const fix = this.#geo.state.fix;
    this._place = withLocation(this._place, fix?.coordinates || [2.35, 46.6], fix ? Math.round(fix.accuracy) : null);
    this._manual = !fix;
    this._editPos = true;
    this.#changed();
  }

  /**
   * « Retirer la position »: asked of the lieu as stored (what was typed saved first; another tab, « Noter ici » may have
   * placed a plant since). When the list would lose something (collections.js locationQuestion: a plant's own position,
   * the other times a plant is noted, a parcours' walk), refused — « Copier en liste » offered: a new list of its
   * plants, opened, the lieu as it was. Otherwise confirmed first, then written as stored now, the rule checked again in
   * the same transaction (refused then: said). On the Carte, which shows only lieux, the list opens in its own page.
   */
  async #removeLocation() {
    if (!this._place) return;
    const id = this._place.id;
    await this.#flush();
    // Not saved (said): nothing is asked of a lieu that is not what the editor shows.
    if (this.#dirty) return;
    try {
      const stored = await getPlace(id);
      if (!stored) { this._error = this.#goneText(); return; }
      const q = locationQuestion(stored);
      // `=== true`: tsc tells the two questions apart so (jsconfig: no strictNullChecks).
      if (q.refused === true) {
        if (await ask({ title: q.title, text: q.text, choices: [{ value: 'copy', label: 'Copier en liste', primary: true }] }) === 'copy') this.#copyAsList(id);
        return;
      }
      if (!await confirmAsk(q)) return;
      let lossy = false;
      const saved = await updatePlace(id, current => {
        lossy = locationQuestion(current).refused;
        return lossy ? current : withLocation(current, null);
      });
      if (lossy) { await this.#removeLocation(); return; }
      this.#base = saved;
      this.#savedAt = saved.properties.updatedAt;
      this._todayFor = new Map();
      this._place = saved;
      this._editPos = false;
      this._error = null;
      if (this.embedded) openView(href.spot(id));
    } catch (error) {
      console.error(error);
      this._error = /** @type {Error} */ (error).name === 'GoneError' ? this.#goneText() : 'Enregistrement impossible : ' + /** @type {Error} */ (error).message;
    }
  }

  /** « Copier en liste »: the new list opened, said; the lieu as it was. @param {string} id the lieu */
  async #copyAsList(id) {
    try {
      const list = await copyAsList(id);
      openView(href.spot(list.id));
      briefToast(`Liste « ${list.properties.name} » créée. Le lieu garde ses positions.`);
    } catch (error) {
      console.error(error);
      this._error = /** @type {Error} */ (error).name === 'GoneError' ? this.#goneText() : 'Copie impossible : ' + /** @type {Error} */ (error).message;
    }
  }

  /**
   * « Partager »: what was typed saved, then a link (collections.js shareCollection: a lieu's position asked first; shared,
   * the user's own — « Recommencer » keeps it).
   */
  async #share() {
    if (!this._place) return;
    await this.#flush();
    if (await shareCollection(this.#payload(), confirmAsk) === 'copied') { this._saveState = ''; this._error = null; this._note = 'Lien copié.'; setTimeout(() => { this._note = null; }, 2500); }
  }

  /** « Exporter (GeoJSON) »: its own file — on a phone, what it says of you asked before the share sheet. */
  async #export() {
    if (!this._place) return;
    await this.#flush();
    await exportGeoJSON([this.#payload()], { ask: confirmAsk });
  }

  /** @param {Event} event */
  #pickerInput(event) {
    this._pickerQuery = /** @type {HTMLInputElement} */ (event.target).value;
  }

  /** @param {any} summary */
  async #pickPlant(summary) {
    // A place may hold the plant again (another occurrence, here); a list holds it once.
    if (!this._place || (!this.#isPlace && findEntry(this._place, summary.id))) return;
    const plant = await db.get('plants', summary.id);
    this._place = withPlant(this._place, plant, defaultPlantPosition(this._place, this.#geo.state.fix), { again: true });
    const added = /** @type {any} */ (lastEntry(this._place)).id;
    if (this.#isPlace) this._todayFor = new Map(this._todayFor).set(added, null);
    this._open = added;
    this._pickerQuery = '';
    this._picker = false;
    this.#changed();
  }

  /**
   * This noting out of the collection (the plant's others stay): asked first when its note or its harvest log would go
   * (collections.js removeQuestion — « Récolté aujourd’hui » counts), in a dialog, never confirm().
   * @param {string} key its entry id
   */
  async #removePlant(key) {
    if (!this._place) return;
    const q = removeQuestion(this.#payload(), key);
    if (q && !await confirmAsk(q)) return;
    if (!this._place) return;
    this._place = withoutPlant(this._place, key);
    const todayFor = new Map(this._todayFor);
    todayFor.delete(key);
    this._todayFor = todayFor;
    this.#changed();
  }

  /**
   * Before a harvest of this plant is noted: when our sources say it is toxic, cannot be read, or that it is protected
   * where it grows, the warning of « Noter ici » (gf-harvest-warning; the plant noted here already: « Annuler » first,
   * « J’ai lu cet avertissement » before the harvest) — never confirm(), whose OK would note it. True when there is
   * nothing to say, or once the user chose the harvest.
   * @param {any} entry
   */
  async #harvestAllowed(entry) {
    if (entry?.plantId == null) return true;
    const plant = await getPlant(entry.plantId);
    const at = this._place ? entryPosition(this._place, entry) : null;
    return await askHarvest(plant || { id: entry.plantId, scientificName: entry.scientificName, genus: entry.scientificName.split(' ')[0] }, { at, noted: true }) === 'harvest';
  }

  /** @param {string} key its entry id @param {Event} event */
  async #addHarvest(key, event) {
    const box = /** @type {HTMLElement} */ (event.target).closest('.add-harvest');
    const get = (/** @type {string} */ name) => /** @type {HTMLInputElement} */ (box?.querySelector(`[name="${name}"]`));
    const date = get('date').value;
    const entry = this._place && findEntry(this._place, key);
    if (!date || !entry || !await this.#harvestAllowed(entry)) return;
    const harvests = [...entry.harvests, { date, quantity: get('quantity').value.trim(), note: get('note').value.trim() }]
      .sort((a, b) => b.date.localeCompare(a.date));
    this.#patchEntry(key, { harvests });
    get('quantity').value = '';
    get('note').value = '';
  }

  /** @param {string} key its entry id @param {number} index */
  #removeHarvest(key, index) {
    const entry = this._place && findEntry(this._place, key);
    if (entry) this.#patchEntry(key, { harvests: entry.harvests.filter((_, i) => i !== index) });
  }

  /**
   * The name typed for a new collection is an existing one's: put this draft's plants (with their notes,
   * abundance, harvests and, place to place, their own positions) into it, drop the draft, open it. A plant already
   * there is joined to it (place-model.js joinEntry: its notes after the other's, the harvest logs of both). A new lieu
   * with plants put into a list (no position) asks first: its point and their positions are not kept. Notes that would
   * pass what a note holds once joined: nothing written, said, the draft kept.
   * @param {string} targetId
   */
  async #mergeInto(targetId) {
    if (!this._place) return;
    if (this._place.geometry && this._place.properties.plants.length) {
      const into = await getPlace(targetId).catch(() => undefined);
      if (into && !into.geometry && !await confirmAsk({ title: `Ajouter à la liste « ${placeTitle(into)} » ?`, yes: 'Ajouter à la liste',
        text: 'Une liste ne garde pas de position : le point de ce nouveau lieu et les positions de ses plantes ne seront pas gardés.' })) return;
    }
    clearTimeout(this.#saveTimer);
    this.#dirty = false;
    await this.#saving;
    const draft = this.#payload();
    try {
      // Into the target as stored now, in one transaction.
      await updatePlace(targetId, stored => {
        let target = stored;
        for (const e of draft.properties.plants) {
          if (e.plantId === null) continue;
          const own = draft.geometry && e.coordinates ? { coordinates: e.coordinates, accuracy: e.accuracy } : null;
          // Already there: in a list, the plant; in a place, this plant at this very spot (else another occurrence).
          const there = target.geometry && own
            ? entriesOf(target, e.plantId).find(t => t.coordinates && distance(t.coordinates, own.coordinates) < 1)
            : findEntry(target, e.plantId);
          if (there) {
            const one = joinEntry(there, e);
            // Thrown in the transaction: nothing written.
            if (!one) throw new Error(`Les notes de ${entryName(e)} dépasseraient 5 000 caractères une fois réunies.`);
            target = withEntry(target, there.id, one);
            continue;
          }
          const position = target.geometry ? own || defaultPlantPosition(target, this.#geo.state.fix) : undefined;
          target = withPlant(target, { id: e.plantId, scientificName: e.scientificName, vernacularName: e.vernacularName }, position, { again: true });
          target = withEntry(target, /** @type {any} */ (lastEntry(target)).id, { abundance: e.abundance, rating: e.rating, notes: e.notes, harvests: e.harvests });
        }
        return target;
      }).catch(error => { throw error.name === 'GoneError' ? new Error('Liste ou lieu introuvable.', { cause: error }) : error; });
      if (this.#persisted && this.#createdHere) await deletePlace(draft.id);
      this.#persisted = false;
      // In place of this draft: Back does not return to it.
      replaceView(href.spot(targetId));
    } catch (error) {
      // The draft kept: what it holds still to be saved (a new list's, as you go).
      if (this.#autosave) this.#dirty = true;
      this._error = 'Ajout impossible : ' + /** @type {Error} */ (error).message;
    }
  }

  /** Existing collections matching the name being typed (not this one). */
  #nameMatches() {
    const p = this._place?.properties;
    if (!p || p.kind === 'favorites') return { matches: [], exact: null };
    const others = this.#store.state.collections.filter(c => c.id !== this._place?.id && c.kind !== 'favorites');
    return matchCollections(others, p.name);
  }

  /**
   * A lieu offered nearby, chosen instead of a new one (gf-nearby-places): it opens, the plant being recorded added to
   * it. @param {string} id
   */
  #useExisting(id) {
    const first = this._place?.properties.plants[0];
    replaceView(href.spot(id, first?.plantId ?? undefined));
  }

  /** @param {SubmitEvent} event */
  async #save(event) {
    event.preventDefault();
    if (!this._place) return;
    if (!this._place.properties.plants.length && !this._place.properties.name.trim()) {
      this._error = 'Ajoutez au moins une plante, ou donnez un nom au lieu.';
      return;
    }
    if (this.#autosave) {
      // Lists and existing collections are saved as you go: "Terminé" just leaves, back to the previous view.
      await this.#flush();
      if (this.embedded) this.#emit('panel-close');
      else back(this.#doneHref());
      return;
    }
    try {
      const saved = await savePlace(this.#payload());
      this.#base = saved;
      this.#persisted = true;
      // The new place replaces its form in history.
      replaceView(href.map({ spot: saved.id }));
    } catch (error) {
      this._error = 'Enregistrement impossible : ' + /** @type {Error} */ (error).message;
    }
  }

  async #delete() {
    if (!this._place || this._place.properties.kind === 'favorites') return;
    const n = this._place.properties.plants.length;
    const what = this.#isPlace ? 'ce lieu' : 'cette liste';
    if (!confirm(`Supprimer ${what}${n ? ` (${plantCount(n)})` : ''}${this.#isPlace ? ', avec le journal de récolte' : ''} ?`)) return;
    clearTimeout(this.#saveTimer);
    this.#dirty = false;
    const wasPlace = this.#isPlace;
    if (!this.#isNew) await deletePlace(this._place.id);
    // Gone: Back must not lead to it.
    replaceView(wasPlace ? href.map() : href.collections());
  }

  #doneHref() {
    if (this.#isPlace && this._place) return href.map({ spot: this._place.id });
    return href.collections();
  }

  /** Looks up the address and altitude of the place point once it settles. */
  #updateWhere() {
    const point = this._place?.geometry?.coordinates;
    const key = point ? point.map(n => n.toFixed(5)).join(',') : '';
    if (this._where.key === key) return;
    this._where = { key };
    clearTimeout(this.#whereTimer);
    if (!point) return;
    this.#whereTimer = setTimeout(() => {
      const set = patch => { if (this._where.key === key) this._where = { ...this._where, ...patch }; };
      addressAt(point).then(a => set({ address: a?.label || null })).catch(() => set({ address: null }));
      altitudeAt(point).then(alt => set({ alt })).catch(() => set({ alt: null }));
    }, 600);
  }

  /** "📍 address · ⛰ altitude · coordinates" of the place point. */
  #whereLine() {
    const point = this._place?.geometry?.coordinates;
    if (!point) return nothing;
    const w = this._where;
    return html`<span class="where">${w.address ? html`${icon('geo-alt-fill')} ${w.address} · ` : nothing}${w.alt != null ? html`${icon('triangle')} ${w.alt} m · ` : nothing}<span class="coords">${formatCoordinates(point)}</span></span>`;
  }

  /** @type {number | undefined} */ #whereTimer;

  /** The map's gestures here: a first-use hint (core/hints.js: the first editor ever on this device), until its ✕. @type {boolean | undefined} */
  #gestureHint;

  /** A gesture of the map said once per device (its ✕), never again: the map's own controls say the rest. @param {unknown} words */
  #gesture(words) {
    this.#gestureHint ??= takeHint('editor-gestures');
    return this.#gestureHint ? hintView(words, () => { this.#gestureHint = false; this.requestUpdate(); }, 'gesture') : nothing;
  }

  #gpsStatus() {
    const { fix, error } = this.#geo.state;
    if (this._manual) {
      return html`<div class="gps card"><span class="dot good"></span> Point du lieu ${this.#isNew ? 'placé à la main' : 'enregistré'}
        ${fix && this.#editing ? html`<button type="button" @click=${this.#useGps}>Utiliser le GPS</button>` : nothing}
        ${this.#whereLine()}
        ${this.#gesture(this.#editing
          ? 'Le carré vert est le point du lieu, les ronds sont les plantes : faites-les glisser pour les ajuster.'
          : html`Le carré vert est le point du lieu, les ronds sont les plantes. ${icon('pencil')} sur la carte pour les déplacer.`)}</div>`;
    }
    if (!fix) {
      return html`<div class="gps card"><span class="dot ${error ? 'none' : ''}"></span>
        ${error || 'Recherche de la position GPS…'}
        ${this.#gesture('Appui long sur la carte, puis « Confirmer », pour placer le lieu à la main.')}</div>`;
    }
    const good = fix.accuracy <= config.goodAccuracy;
    return html`<div class="gps card" aria-live="polite">
      <span class="dot ${good ? 'good' : 'weak'}"></span>
      Position GPS <strong>± ${Math.round(fix.accuracy)} m</strong>
      <span class="hint">${good ? 'Précision suffisante.' : 'Précision faible : patientez à découvert, ou ajustez l’épingle.'}</span>
      ${this.#isNew && moduleOn('ignGeo') ? html`<span class="hint">Le point est envoyé à l’IGN pour son adresse et son altitude ; le lieu reste sur cet appareil.</span>` : nothing}
    </div>`;
  }

  /** The lieux nearby, offered before this new one is saved (gf-nearby-places: the same offer as « Noter ici »). */
  #nearbyBanner() {
    if (!this.#isNew || !this._nearby.length || !this._place) return nothing;
    const first = this._place.properties.plants[0];
    return html`<gf-nearby-places mode="open" .rows=${this._nearby} .plant=${first ? { id: first.plantId, name: entryName(first) } : null}
      @nearby-pick=${(/** @type {CustomEvent} */ e) => this.#useExisting(e.detail.id)}></gf-nearby-places>`;
  }

  /** Where this plant grows: distance from the place's point, GPS, show on map. */
  /** @param {import('../core/collections.js').PlantEntry} entry */
  #plantPosition(entry) {
    const place = /** @type {import('../core/collections.js').Collection} */ (this._place);
    const own = entryPosition(place, entry);
    const away = own && place.geometry ? distance(own, place.geometry.coordinates) : 0;
    const fix = this.#geo.state.fix;
    return html`<div class="plant-pos">
      <span>${icon('geo-alt-fill')} ${away < 3 ? 'Au point du lieu' : `À ${formatDistance(away)} du point du lieu`}${entry.accuracy ? ` · ± ${entry.accuracy} m` : ''}</span>
      <button type="button" @click=${() => this.#showOnMap(own)}>Voir sur la carte</button>
      ${this.#editing ? html`
        <button type="button" ?disabled=${!fix} @click=${() => this.#plantHere(entry.id)}>Ici (GPS)</button>
        <small>Ou faites glisser son rond sur la carte.</small>` : html`
        <button type="button" @click=${() => this.#editPlantPosition(own)}>Déplacer</button>`}
    </div>`;
  }

  /** Opens or closes an occurrence's details; on the Carte, its marker is highlighted. @param {string | null} key its entry id */
  #toggleEntry(key) {
    this._open = key;
    const entry = key && this._place ? findEntry(this._place, key) : null;
    if (this.embedded) this.#emit('plant-focus', { entryId: key, plantId: entry?.plantId ?? null });
  }

  /** The entry id for a focus from the Carte (an occurrence id, or a plant id: its first occurrence). @param {string | number} focus */
  #entryKey(focus) {
    return this._place ? findEntry(this._place, focus)?.id ?? null : null;
  }

  /** « n° 2 » for a plant noted several times in the place (in the order they were noted), else null. @param {import('../core/collections.js').PlantEntry} entry */
  #occurrence(entry) {
    const same = entriesOf(/** @type {any} */ (this._place), entry.plantId);
    return same.length > 1 ? same.indexOf(entry) + 1 : null;
  }

  /**
   * A place's map is framed on what it holds: its point and every plant noted in it — again whenever a plant
   * is added, removed or moved.
   * @param {import('../core/collections.js').Collection} place
   */
  #placeFrame(place) {
    const points = [place.geometry?.coordinates, ...place.properties.plants.map(e => e.coordinates)].filter(Boolean);
    const key = place.id + ':' + points.map(c => /** @type {any} */ (c).join(',')).join(';');
    return { key, points, ease: true, maxZoom: 19 };
  }

  /** @param {import('../core/collections.js').PlantEntry} entry */
  #entry(entry) {
    const id = entry.plantId;
    // The occurrence: what is opened, changed or removed (a place may hold the plant several times).
    const key = entry.id;
    const open = this._open === key;
    const last = lastHarvest(entry);
    const fresh = this._todayFor.has(key);
    const todayQuantity = this._todayFor.get(key);
    const nth = this.#isPlace ? this.#occurrence(entry) : null;

    return html`
      <li class="entry card ${open ? 'open' : ''}">
        <button class="head" type="button" aria-expanded=${open ? 'true' : 'false'} @click=${() => this.#toggleEntry(open ? null : key)}>
          <gf-thumb plant-id=${id ?? 0} size="44"></gf-thumb>
          <span class="name">${entryName(entry)}${nth ? html` <small class="nth" title="Plusieurs fois dans ce lieu">n° ${nth}</small>` : nothing}</span>
          <span class="chev" aria-hidden="true">${icon('chevron-down')}</span>
          <span class="summary">
            ${entry.vernacularName ? html`<span class="sci">${entry.scientificName}</span>` : nothing}
            ${this.#isPlace ? html`
              ${this.#harvest && entryInSeason(entry) ? html`<span class="badge">En saison</span>` : nothing}
              <span>${ABUNDANCE.find(a => a.value === entry.abundance)?.label}</span>
              ${this.#harvest && entry.rating ? html`<span class="mini-stars" aria-label="${entry.rating} sur 5">${Array.from({ length: entry.rating }, () => icon('star-fill'))}</span>` : nothing}
              ${this.#harvest ? html`<span>${last ? 'Récolté le ' + shortDate(last.date) : fresh ? 'Nouvelle plante' : 'Aucune récolte'}</span>` : nothing}`
            : entry.notes ? html`<span>${entry.notes.slice(0, 60)}</span>` : nothing}
          </span>
        </button>
        ${open ? html`
          <div class="body">
            ${id !== null ? html`<gf-status plant-id=${id} .point=${entryPosition(this._place, entry) || null}></gf-status>` : nothing}
            ${id !== null ? html`<gf-lookalikes compact
              .plant=${{ id, scientificName: entry.scientificName, genus: entry.scientificName.split(' ')[0] }}></gf-lookalikes>` : nothing}
            ${fresh && this.#harvest ? html`
              <div class="today">
                <input id="today-${key}" type="checkbox" .checked=${todayQuantity !== null}
                  @change=${async e => {
                    const box = /** @type {HTMLInputElement} */ (e.target);
                    const on = box.checked && await this.#harvestAllowed(entry);
                    box.checked = on;
                    this._todayFor = new Map(this._todayFor).set(key, on ? '' : null);
                  }} />
                <label for="today-${key}">Récolté aujourd’hui</label>
                ${todayQuantity !== null ? html`<input type="text" placeholder="Quantité (ex. 500 g)" .value=${todayQuantity || ''}
                  @input=${e => { this._todayFor = new Map(this._todayFor).set(key, e.target.value); }} />` : nothing}
              </div>` : nothing}

            ${this.#isPlace ? html`<fieldset>
              <legend>Abondance</legend>
              <div class="chips">
                ${ABUNDANCE.map(a => html`<button type="button" aria-pressed=${entry.abundance === a.value ? 'true' : 'false'}
                  @click=${() => this.#patchEntry(key, { abundance: /** @type {any} */ (a.value) })}>${a.label}</button>`)}
              </div>
            </fieldset>

            ${this.#harvest ? html`<fieldset>
              <legend>Qualité</legend>
              <div class="stars" role="radiogroup" aria-label="Qualité">
                ${[1, 2, 3, 4, 5].map(n => html`<button type="button" role="radio" aria-checked=${entry.rating === n ? 'true' : 'false'}
                  aria-label="${n} sur 5" class=${entry.rating >= n ? 'on' : ''}
                  @click=${() => this.#patchEntry(key, { rating: entry.rating === n ? 0 : n })}>${icon(entry.rating >= n ? 'star-fill' : 'star')}</button>`)}
              </div>
            </fieldset>` : nothing}` : nothing}

            <label class="field">Notes sur cette plante
              <textarea .value=${entry.notes} placeholder="Stade, partie récoltée, conseils…"
                @input=${e => this.#patchEntry(key, { notes: e.target.value })}></textarea>
            </label>

            ${this.#harvest ? html`<fieldset>
              <legend>Journal de récolte</legend>
              ${entry.harvests.length ? html`
                <ul class="harvests">
                  ${entry.harvests.map((h, i) => html`
                    <li>
                      <strong>${formatDate(h.date)}</strong>
                      <span class="what">${[h.quantity, h.note].filter(Boolean).join(' · ')}</span>
                      <button class="icon-btn" type="button" aria-label="Supprimer cette récolte" @click=${() => this.#removeHarvest(key, i)}>${icon('x-lg')}</button>
                    </li>`)}
                </ul>` : html`<p class="muted">Aucune récolte notée.</p>`}
              <div class="add-harvest">
                <input type="date" name="date" .value=${today()} max=${today()} aria-label="Date" />
                <input type="text" name="quantity" placeholder="Quantité" aria-label="Quantité" />
                <input type="text" name="note" placeholder="Remarque (facultatif)" aria-label="Remarque" />
                <button type="button" @click=${e => this.#addHarvest(key, e)}>${icon('plus-lg')} Ajouter une récolte</button>
              </div>
            </fieldset>` : nothing}

            ${this.#isPlace ? this.#plantPosition(entry) : nothing}
            ${id ? html`<a class="button" href=${href.plant(id)}>Fiche de la plante</a>` : nothing}
            <button class="link danger" type="button" @click=${() => this.#removePlant(key)}>${this.#isPlace ? (nth ? `Retirer le n° ${nth} du lieu` : 'Retirer cette plante du lieu') : 'Retirer de la liste'}</button>
          </div>` : nothing}
      </li>`;
  }

  #pickerView() {
    const place = this._place;
    if (!this._picker) {
      return html`<button class="add add-plant" type="button" @click=${() => { this._picker = true; }}>${icon('plus-lg')} Ajouter une plante</button>`;
    }
    return html`
      <div class="picker">
        <label class="field">Ajouter une plante
          <input type="search" placeholder="Nom de la plante…" autocomplete="off" .value=${this._pickerQuery} @input=${this.#pickerInput} />
        </label>
        <gf-plant-pick-list .query=${this._pickerQuery}
          .taken=${this.#isPlace ? new Set() : new Set((place?.properties.plants || []).map(e => e.plantId))}
          taken-label="déjà dans la liste"
          @plant-pick=${e => this.#pickPlant(e.detail.plant)}></gf-plant-pick-list>
      </div>`;
  }

  #saveStatus() {
    if (!this.#autosave) return nothing;
    const text = { saving: 'Enregistrement…', saved: html`${icon('check-lg')} Enregistré`, error: 'Non enregistré', '': '' }[this._saveState];
    return html`<span class="save-state ${this._saveState === 'error' ? 'error' : ''}" role="status">${this._note || text}</span>`;
  }

  #nameSuggestions() {
    const { matches, exact } = this.#nameMatches();
    if (!matches.length) return nothing;
    const plants = this._place?.properties.plants.length || 0;
    // An existing collection being renamed: only warn about a twin name, never merge on its behalf.
    if (!this.#createdHere) {
      return exact ? html`<p class="name-hint">Une autre liste ou un autre lieu s’appelle déjà « ${exact.name} ».</p>` : nothing;
    }
    return html`
      <div class="name-suggest" role="group" aria-label="Listes et lieux existants">
        <span>${plants ? 'Ajouter plutôt à une liste ou un lieu existant :' : 'Ouvrir une liste ou un lieu existant :'}</span>
        ${matches.map(c => html`
          <button class="chip" type="button" @click=${() => this.#mergeInto(c.id)}>${kindIcon(c.kind)} ${c.name}
            <small>${plantCount(c.count)}</small></button>`)}
      </div>`;
  }

  /**
   * « Continuer le parcours » (a parcours of Mes plantes, here or in the Carte's panel): what was typed saved, then the
   * Parcours, on this walk under way (its recap left).
   */
  async #continueWalk() {
    if (!this._place) return;
    await this.#flush();
    continueWalk(this._place.id);
    openView(href.app('parcours', 'walk'));
  }

  /**
   * « Vue 3D » of the place (a parcours: its walk and its start too; any other lieu: its plants on the relief); when it
   * cannot open here (no WebGL2, the module off), why: a brief toast above its button (the user asked), its own words
   * read out — and the button's title says it too.
   * @param {Event} e
   */
  #open3d = async (/** @type {Event} */ e) => {
    const opener = /** @type {HTMLElement} */ (e.currentTarget);
    const problem = this._place ? await openMap3d(this._place, opener) : null;
    if (problem) briefToast(problem, { near: opener, at: 'above', offset: 8 });
  };

  render() {
    const place = this._place;
    if (place === undefined) return html`<form><p>Chargement…</p></form>`;
    if (place === null) {
      return html`<form>
        <p>${this._error || 'Cette liste ou ce lieu n’existe plus.'}</p>
        ${this._error ? html`<button type="button" @click=${() => this.#load()}>Réessayer</button>` : nothing}
        <a href=${href.collections()}>Voir Mes plantes</a>
      </form>`;
    }

    const p = place.properties;
    const fix = this.#geo.state.fix;
    const isPlace = this.#isPlace;
    const isFavorites = p.kind === 'favorites';
    const weak = this.#isNew && isPlace && !this._manual && (!fix || fix.accuracy > config.goodAccuracy);

    return html`
      ${place.geometry && !this.embedded ? html`<div class="map-area">
        <gf-map
          .pin=${place.geometry.coordinates}
          .plants=${plantMarkers([place], () => true, this.#store.state.harvestMode)}
          .selectedPlant=${this._open !== null ? place.id + ':' + this._open : null}
          .frame=${this.#placeFrame(place)}
          plant-zoom="0"
          editable
          ?editing=${this._editPos}
          @edit-change=${e => { this._editPos = e.detail.editing; }}
          @positions-save=${e => this.savePositions(e.detail)}
          @plant-select=${e => { this._open = e.detail.entryId ?? findEntry(place, e.detail.plantId)?.id ?? null; }}
          track
          fit
          no-create
        ></gf-map>
      </div>` : nothing}
      ${this.#wide ? this.#sizer.split('form', 'right', () => this.#formMax, 'place-form') : nothing}

      <form id="place-form" @submit=${this.#save}>
        ${isPlace && !this.embedded ? this.#gpsStatus() : nothing}
        ${isPlace ? this.#nearbyBanner() : nothing}

        ${isFavorites
          ? html`<div class="title"><span class="kind" aria-hidden="true">${icon('heart-fill')}</span><h1>Favoris</h1></div>`
          : html`<label class="field">${isPlace ? 'Nom du lieu' : 'Nom de la liste'}
              <input type="text" .value=${p.name} placeholder=${isPlace ? 'ex. Lisière nord du bois' : 'ex. Plantes mellifères'}
                @input=${e => this.#patch({ name: e.target.value })} />
            </label>
            ${this.#nameSuggestions()}`}

        ${!place.geometry && !isFavorites ? html`
          <button class="add add-location" type="button" @click=${this.#addLocation}>${icon('geo-alt-fill')} Ajouter des coordonnées GPS (la liste devient un lieu)</button>` : nothing}

        <h2>Plantes <span class="count">${p.plants.length}</span></h2>
        ${p.plants.length ? html`<ul class="entries">${repeat(p.plants, e => e.id, entry => this.#entry(entry))}</ul>` : nothing}
        ${this.#pickerView()}

        ${isFavorites ? nothing : html`<label class="field">${isPlace ? 'Notes sur le lieu' : 'Notes'}
          <textarea .value=${p.notes} placeholder=${isPlace ? 'Accès, stationnement, propriétaire, exposition…' : 'À quoi sert cette liste…'}
            @input=${e => this.#patch({ notes: e.target.value })}></textarea>
        </label>`}

        ${isPlace && this.embedded ? this.#gpsStatus() : nothing}

        ${isPlace && !this.#isNew ? html`<details class="insights" ?open=${this.embedded}>
          <summary>${icon('globe-europe-africa')} Autour de ce lieu : zones naturelles, plantes vues, pollens, climat</summary>
          <gf-place-insights .point=${place.geometry?.coordinates} .plantIds=${p.plants.map(e => e.plantId)}></gf-place-insights>
        </details>` : nothing}

        ${this.#isNew ? nothing : html`
          <div class="toolbar">
            ${p.walk && place.geometry ? html`<button type="button" class="continue" @click=${this.#continueWalk}>${icon('flag-fill')} Continuer le parcours</button>` : nothing}
            ${p.plants.length && !this.#isNew ? html`<a class="button" href=${href.inFlore(/** @type {any} */ (this._place).id)}>${icon('leaf')} Voir dans Flore</a>` : nothing}
            ${p.plants.length ? html`<button type="button" @click=${this.#share}>Partager</button>` : nothing}
            <button type="button" @click=${this.#export}>Exporter (GeoJSON)</button>
            ${isPlace && !this.embedded ? html`<a class="button" href=${href.map({ spot: place.id })}>Voir sur la carte</a>` : nothing}
            ${isPlace && p.plants.length ? html`<button type="button" class="map3d" title=${map3dProblem() || 'Le lieu sur le relief'} @click=${this.#open3d}>${icon('map')} Vue 3D</button>` : nothing}
            ${isPlace ? html`<button type="button" @click=${this.#removeLocation}>Retirer la position</button>` : nothing}
          </div>`}

        ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}

        <div class="actions footer">
          ${this.#autosave
            ? html`${this.#saveStatus()}<button class="primary large" type="submit">Terminé</button>`
            : html`<button class="primary large ${weak ? 'weak' : ''}" type="submit">Enregistrer</button>
                <a class="link muted" href=${this.plantId ? href.plant(this.plantId) : href.map()}>Annuler</a>`}
          ${isFavorites || this.#isNew ? nothing : html`<button class="danger" type="button" @click=${this.#delete}>Supprimer</button>`}
        </div>
      </form>
    `;
  }
}

customElements.define('gf-spot-editor', GfSpotEditor);
