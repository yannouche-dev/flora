// @ts-check
// Leaflet map on IGN imagery. Rendered in light DOM so Leaflet's global CSS and events just work.

import { LitElement, html, nothing } from 'lit';
import * as L from 'leaflet';
import { config } from '../config.js';
import { watchLocation } from '../core/geo.js';
import { BASES, FRANCE_BOUNDS, OVERLAYS, tileLayer } from '../core/ign.js';
import { inSeason, placeAbundance, placeTitle } from '../core/collections.js';
import { store as appStore } from '../core/store.js';
import { cachedThumb, thumbUrl } from '../core/thumb.js';
import { moduleEvents, moduleOn } from '../core/modules.js';
import { href } from '../core/router.js';
import './gf-map-panel.js';
import './gf-map-search.js';
import './gf-point-card.js';

const STYLESHEETS = [
  new URL('../../vendor/leaflet.css', import.meta.url).href,
  new URL('../styles/map.css', import.meta.url).href
];

const PIN_COLORS = { rare: '#fb7185', moyen: '#fbbf24', abondant: '#38bdf8' };

/** Plants are drawn from this zoom level on (places are always drawn). */
export const PLANT_ZOOM = 16;

/**
 * Place: a rounded-square marker on a stem, with the number of plants — unlike plants (small circles).
 * @param {string} color @param {number} count @param {string} className
 */
function placeIconOf(color, count, className) {
  const label = count > 99 ? '99+' : String(count);
  return L.divIcon({
    className: 'gf-place ' + className,
    iconSize: [34, 44],
    iconAnchor: [17, 43],
    html: `<svg width="34" height="44" viewBox="0 0 34 44" aria-hidden="true">
      <path d="M17 43 L12 33 H22 Z" fill="#fff"/>
      <rect class="ring" x="2" y="2" width="30" height="30" rx="8" fill="${color}" stroke="#fff" stroke-width="2.5"/>
      ${count > 0
        ? `<text x="17" y="22" text-anchor="middle" font-size="${label.length > 2 ? 11 : 14}" font-weight="800" font-family="system-ui,sans-serif" fill="#1d2419">${label}</text>`
        : '<rect x="12" y="12" width="10" height="10" rx="2" fill="#fff"/>'}
    </svg>`
  });
}

/** @param {import('../core/collections.js').Place} spot @param {boolean} selected @param {boolean} [movable] */
function pinIcon(spot, selected, movable = false) {
  const color = PIN_COLORS[placeAbundance(spot)] || PIN_COLORS.moyen;
  const classes = [selected ? 'selected' : '', appStore.state.harvestMode && inSeason(spot) ? 'season' : '', movable ? 'editing' : ''].join(' ');
  return placeIconOf(color, spot.properties.plants.length, classes);
}

/** Leaf glyph for plant markers. */
const LEAF = '<path d="M7 15c0-5 3-8 8-8 0 5-3 8-8 8Zm0 0 4-4" fill="#fff" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/>';

const escapeAttr = (/** @type {string} */ s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * Plant: its photo in a circle ringed with its abundance colour (a leaf until / unless a photo is known).
 * @param {PlantMarker} plant @param {boolean} selected @param {boolean} draggable
 */
function plantIcon(plant, selected, draggable) {
  const color = PIN_COLORS[plant.abundance] || PIN_COLORS.moyen;
  const url = plant.plantId ? cachedThumb(plant.plantId) : null;
  const classes = ['gf-plant', url ? 'photo' : '', selected ? 'selected' : '', plant.season ? 'season' : '', draggable ? 'draggable' : ''].join(' ');
  if (url) {
    return L.divIcon({
      className: classes,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      html: `<span class="ring" style="--c:${color}"><img src="${escapeAttr(url)}" alt="" referrerpolicy="no-referrer" decoding="async"
        onerror="this.remove()" /></span>`
    });
  }
  return L.divIcon({
    className: classes,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    html: `<svg width="24" height="24" viewBox="0 0 22 22" aria-hidden="true">
      <circle class="ring" cx="11" cy="11" r="9.5" fill="${color}" stroke="#fff" stroke-width="2"/>
      <g transform="translate(0 0)">${LEAF}</g>
    </svg>`
  });
}

/**
 * @typedef {object} PlantMarker
 * @property {string} key          unique: placeId + ':' + plantId
 * @property {string} placeId
 * @property {number | null} plantId
 * @property {[number, number]} coordinates
 * @property {string} abundance
 * @property {string} label
 * @property {boolean} season
 * @property {boolean} [own]       has its own position (otherwise it sits on the place point and follows it)
 */

const meIcon = L.divIcon({ className: 'gf-me', iconSize: [18, 18], iconAnchor: [9, 9] });

/** Draggable place pin of the editor (same shape as places, in green). */
const editIcon = placeIconOf('#16a34a', 0, 'selected editing');
/** The same place point when positions are locked (read-only map). */
const lockedIcon = placeIconOf('#16a34a', 0, 'selected');

const readStored = (/** @type {string} */ key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
};
/** Map look chosen last; `cadastre: true` from earlier versions becomes an overlay. */
function readLayers() {
  const saved = readStored(config.storageKeys.mapLayer, {});
  const overlays = Array.isArray(saved.overlays) ? saved.overlays : saved.cadastre ? ['cadastre'] : [];
  return {
    base: saved.base in BASES ? saved.base : 'photo',
    overlays: overlays.filter(k => k in OVERLAYS)
  };
}

/** A point picked on the map (long press, search result). */
const pointIcon = L.divIcon({
  className: 'gf-point',
  iconSize: [26, 36],
  iconAnchor: [13, 35],
  html: '<svg width="26" height="36" viewBox="0 0 26 36" aria-hidden="true"><path d="M13 35C13 35 2 21 2 13a11 11 0 0 1 22 0c0 8-11 22-11 22Z" fill="#dc2626" stroke="#fff" stroke-width="2"/><circle cx="13" cy="13" r="4" fill="#fff"/></svg>'
});

/**
 * @typedef {{ pin: [number, number] | null, places: Map<string, [number, number]>, plants: Map<string, [number, number]> }} Moves
 * @returns {Moves}
 */
const emptyMoves = () => ({ pin: null, places: new Map(), plants: new Map() });
const movesCount = (/** @type {Moves} */ m) => (m.pin ? 1 : 0) + m.places.size + m.plants.size;

const store = (/** @type {string} */ key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not persisted */ }
};

/**
 * Properties:
 *  - spots: places (GeoJSON features) to show as place markers
 *  - selectedId: highlighted place
 *  - pin: [lon, lat] of an editable, draggable place pin (place editor), or null
 *  - plants: plant markers (each plant of a place has its own position)
 *  - plantZoom: minimum zoom to show plant markers (0 = always)
 *  - selectedPlant: highlighted plant marker key
 *  - draggablePlants: plant markers can be dragged (place editor)
 *  - pinDraggable: the place pin can be dragged and long-press emits map-longpress (default true)
 *  - track: show the live GPS position
 *  - fit: zoom to the content on first data
 *  - area: {center, radius, points?} — a circle (metres) and observation dots inside it ("Autour")
 *  - frame: {key, points, bottom?} — zoom once on these [lon, lat] points (again when the key changes);
 *    `bottom` is the share of the height kept free below them (e.g. for a sheet)
 *  - search (default on; `no-search` removes it): address search pill on top, with the ▦ "Carte" panel button;
 *    legend (default on): legend in the panel
 *  - no-create: the point card (long press) has no "Créer un endroit ici"
 *  - editable: the ✎ control (always shown) switches position editing on. While `editing`: with a `pin` (place
 *    editor), the pin and the plants move; with a selected place, that place and its plants; otherwise every
 *    place. Moves stay a working copy until ✓ Valider, which emits positions-save; Annuler drops them.
 * Events: spot-select {id}, plant-select {placeId, plantId}, pin-move {coordinates},
 *         plant-move {placeId, plantId, coordinates}, map-longpress {coordinates} (while the pin can be placed),
 *         point-info {coordinates} (long press elsewhere: the point card opens), point-close,
 *         edit-change {editing}, positions-save {pin, places: [{id, coordinates}], plants: [{placeId, plantId, coordinates}]}
 */
export class GfMap extends LitElement {
  static properties = {
    spots: { attribute: false },
    selectedId: { attribute: false },
    pin: { attribute: false },
    plants: { attribute: false },
    plantZoom: { type: Number, attribute: 'plant-zoom' },
    selectedPlant: { attribute: false },
    draggablePlants: { type: Boolean, attribute: 'draggable-plants' },
    pinDraggable: { attribute: false },
    track: { type: Boolean },
    fit: { type: Boolean },
    frame: { attribute: false },
    area: { attribute: false },
    remember: { type: Boolean },
    search: { type: Boolean },
    legend: { type: Boolean },
    noCreate: { type: Boolean, attribute: 'no-create' },
    noSearch: { type: Boolean, attribute: 'no-search' },
    editable: { type: Boolean },
    editing: { type: Boolean, reflect: true },
    _moves: { state: true }
  };

  constructor() {
    super();
    /** @type {import('../core/collections.js').Spot[]} */
    this.spots = [];
    /** @type {string | null} */
    this.selectedId = null;
    /** @type {[number, number] | null} */
    this.pin = null;
    /** @type {PlantMarker[]} */
    this.plants = [];
    this.plantZoom = PLANT_ZOOM;
    /** @type {string | null} */
    this.selectedPlant = null;
    this.draggablePlants = false;
    this.pinDraggable = true;
    this.track = false;
    this.fit = false;
    /** @type {{ key: string, points: [number, number][], bottom?: number } | null} */
    this.frame = null;
    /** @type {{ center: [number, number], radius: number, points?: { coordinates: [number, number], title: string, url?: string }[] } | null} */
    this.area = null;
    /** Persist the last viewed area (main map only). */
    this.remember = false;
    // The same controls on every map: address search, layers and legend.
    this.search = true;
    this.legend = true;
    this.noCreate = false;
    this.noSearch = false;
    this.editable = false;
    this.editing = false;
    /** Working copy while editing positions. */
    this._moves = emptyMoves();
  }

  createRenderRoot() { return this; }

  // Lit owns this one wrapper; Leaflet and the map buttons live inside it, out of Lit's way
  // (anything appended straight to the host would be cleared by Lit's next render).
  render() {
    const n = movesCount(this._moves);
    const hint = this.pin ? 'Glissez le lieu et ses plantes · appui long : placer le lieu'
      : this.selectedId ? 'Glissez le lieu ou ses plantes · appui long : placer le lieu'
      : this.spots.length ? 'Glissez les lieux pour les déplacer' : 'Glissez les plantes pour les déplacer';
    // The frame goes full screen while editing positions: in the browser's top layer (popover), so no
    // ancestor (a pane with `contain`, the header, the tab bar) can clip or cover it.
    return html`<div class="gf-map-frame" popover="manual"><div class="gf-map-root"></div>
      ${moduleOn('ignMaps') ? nothing : html`<div class="gf-map-off" role="status">Fonds IGN désactivés : seules les zones déjà vues s’affichent.
        <a href=${href.settings()}>Réglages › Modules</a></div>`}
      ${this.editing ? html`<div class="gf-map-editbar" role="group" aria-label="Modifier les positions">
        <span class="hint">${n ? `${n} déplacement${n > 1 ? 's' : ''} · ` : ''}${hint}</span>
        <span class="actions">
          <button type="button" @click=${() => this.#endEdit(false)}>Annuler</button>
          <button type="button" class="primary" @click=${() => this.#endEdit(true)}>✓ Valider</button>
        </span>
      </div>` : nothing}</div>`;
  }

  // ── Position editing ───────────────────────────────────────────────────────────────────────────

  /** The pin moves: while editing (editable maps), else when the caller says so. */
  get #pinMovable() { return this.editable ? this.editing : this.pinDraggable; }

  /** @param {string} id */
  #placeMovable(id) { return this.editing && !this.pin && (!this.selectedId || id === this.selectedId); }

  /** @param {PlantMarker} plant */
  #plantMovable(plant) {
    if (!this.editable) return this.draggablePlants;
    // The pin's plants (editor), the selected place's, or — on a map of plants only — every plant.
    return this.editing && Boolean(this.pin || (this.selectedId ? plant.placeId === this.selectedId : !this.spots.length));
  }

  /** Where a place is drawn: moved in the working copy, else its saved point. @param {any} spot @returns {[number, number]} */
  #spotAt(spot) { return this._moves.places.get(spot.id) || spot.geometry.coordinates; }

  /** A plant without its own position follows its place (or the pin) while it is being moved. @param {PlantMarker} plant @returns {[number, number]} */
  #plantAt(plant) {
    const moved = this._moves.plants.get(plant.key);
    if (moved) return moved;
    if (!plant.own) {
      const place = this._moves.places.get(plant.placeId) || (this.pin ? this._moves.pin : null);
      if (place) return place;
    }
    return plant.coordinates;
  }

  /** @param {boolean} on */
  #setEditing(on) {
    if (on === this.editing) return;
    this.editing = on;
    if (on) this.hidePoint();
    this.#emit('edit-change', { editing: on });
  }

  /** ✓ Valider (save) or Annuler. @param {boolean} save */
  #endEdit(save) {
    const moves = this._moves;
    if (save && movesCount(moves)) {
      this.#emit('positions-save', {
        pin: moves.pin,
        places: [...moves.places].map(([id, coordinates]) => ({ id, coordinates })),
        plants: [...moves.plants].map(([key, coordinates]) => {
          const plant = this.plants.find(p => p.key === key);
          return { placeId: plant?.placeId, plantId: plant?.plantId ?? null, coordinates };
        })
      });
      // Shown where they were dropped until the caller passes the saved data back.
      this.#keepMoves = true;
    } else {
      this._moves = emptyMoves();
    }
    this.#setEditing(false);
  }

  /** Full screen while editing, back in place afterwards. @param {boolean} on */
  #fullScreen(on) {
    const frame = /** @type {any} */ (this.querySelector('.gf-map-frame'));
    if (!frame) return;
    try {
      if (on) frame.showPopover(); else frame.hidePopover();
    } catch {
      // No popover support: fixed position (enough outside contained panes).
      frame.classList.toggle('fullscreen', on);
    }
  }

  /** The moves were saved: forget them once the new data arrives. */
  #keepMoves = false;

  /** @param {(m: Moves) => void} change */
  #move(change) {
    const next = { pin: this._moves.pin, places: new Map(this._moves.places), plants: new Map(this._moves.plants) };
    change(next);
    this._moves = next;
  }

  /** « IGN – fonds de carte » switched on or off: rebuild the tile layers (network or cache only). */
  #onModules = () => {
    this.requestUpdate();
    const map = this.#map;
    if (!map) return;
    for (const layer of Object.values(this.#layers)) layer.remove();
    this.#layers = {};
    /** @type {L.TileLayer} */ (this.#layer(this.#base).addTo(map)).bringToBack();
    for (const key of this.#overlays) this.#layer(key).addTo(map);
  };

  get #root() { return /** @type {HTMLElement} */ (this.querySelector('.gf-map-root')); }

  /** @type {L.Map | null} */ #map = null;
  /** @type {Record<string, L.Layer>} */ #layers = {};
  #base = /** @type {'photo' | 'plan'} */ (readLayers().base);
  /** @type {string[]} */ #overlays = readLayers().overlays;
  /** @type {any} */ #panel = null;
  /** @type {L.Marker | null} */ #pointMarker = null;
  /** @type {any} */ #pointCard = null;
  /** @type {L.LayerGroup | null} */ #spotLayer = null;
  /** @type {Map<string, L.Marker>} */ #markers = new Map();
  /** @type {L.LayerGroup | null} */ #plantLayer = null;
  /** @type {Map<string, L.Marker>} */ #plantMarkers = new Map();
  /** @type {L.Marker | null} */ #editMarker = null;
  /** @type {L.LayerGroup | null} */ #areaLayer = null;
  /** @type {L.Marker | null} */ #me = null;
  /** @type {L.Circle | null} */ #meCircle = null;
  /** @type {(() => void) | null} */ #unwatch = null;
  /** @type {[number, number] | null} */ #fix = null;
  #follow = false;
  #fitted = false;
  /** @type {string | null} */ #framedKey = null;
  /** @type {HTMLElement | null} */ #buttons = null;

  firstUpdated() {
    // Light DOM, but possibly inside another component's shadow root: bring the map CSS along.
    const root = this.#root;
    for (const href of STYLESHEETS) root.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href }));

    const canvas = Object.assign(document.createElement('div'), { className: 'gf-map-canvas' });
    // Inline, not only in map.css: Leaflet forces `position: relative` on a container it sees as static,
    // which happens when the stylesheet links above haven't loaded yet.
    canvas.style.cssText = 'position:absolute;inset:0';
    root.append(canvas);

    const map = this.#map = L.map(canvas, {
      zoomControl: false,
      attributionControl: true,
      tapHold: true,
      maxZoom: 21,
      minZoom: 5
    });
    map.attributionControl.setPrefix(false);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

    this.#layer(this.#base).addTo(map);
    for (const key of this.#overlays) this.#layer(key).addTo(map);

    this.#areaLayer = L.layerGroup().addTo(map);
    this.#spotLayer = L.layerGroup().addTo(map);
    this.#plantLayer = L.layerGroup();
    map.on('zoomend', () => this.#syncPlantVisibility());

    const view = this.remember ? readStored(config.storageKeys.mapView, null) : null;
    if (view) map.setView([view.lat, view.lng], view.zoom);
    else map.fitBounds(FRANCE_BOUNDS);

    map.on('moveend', () => {
      if (!this.remember) return;
      const center = map.getCenter();
      store(config.storageKeys.mapView, { lat: center.lat, lng: center.lng, zoom: map.getZoom() });
    });
    map.on('dragstart', () => this.#setFollow(false));
    map.on('contextmenu', event => {
      const { lat, lng } = /** @type {L.LeafletMouseEvent} */ (event).latlng;
      // Editing: the long press places the pin, or the selected place.
      if (this.editing) {
        if (this.pin) this.#move(m => { m.pin = [lng, lat]; });
        else if (this.selectedId) { const id = this.selectedId; this.#move(m => m.places.set(id, [lng, lat])); }
        return;
      }
      if (this.pin && this.pinDraggable && !this.editable) this.#emit('map-longpress', { coordinates: [lng, lat] });
      else this.showPoint([lng, lat]);
    });

    this.#buildButtons();
    this.toggleAttribute('search', this.#hasSearch);
    if (this.#hasSearch) this.#buildSearch();
    // The element may have been laid out after Leaflet measured it.
    new ResizeObserver(() => {
      map.invalidateSize();
      this.#applyFrame();
      if (this.fit && !this.#fitted) this.#fitToContent();
    }).observe(this.#root);
    this.#syncAll();
  }

  /** @param {Map<string, any>} changed */
  updated(changed) {
    if (!this.#map) return;
    // Saved moves are dropped once the caller passes the saved data back.
    if (this.#keepMoves && (changed.has('spots') || changed.has('plants') || changed.has('pin'))) {
      this.#keepMoves = false;
      this._moves = emptyMoves();
    }
    if (changed.has('editing') && changed.get('editing') !== undefined) {
      // Editing turned off by the caller: drop the working copy (unless just saved).
      if (!this.editing && !this.#keepMoves) this._moves = emptyMoves();
      // Draggability is set when a marker is created: rebuild them.
      this.#spotLayer?.clearLayers();
      this.#markers.clear();
      this.#clearPin();
      this.#clearPlants();
      this.#syncButtons();
      this.#fullScreen(this.editing);
    }
    if (changed.has('_moves') || (changed.has('editing') && changed.get('editing') !== undefined) || (changed.has('selectedId') && this.editing)) {
      this.#syncSpots();
      this.#syncPin();
      this.#syncPlants();
    }
    if (changed.has('spots') || changed.has('selectedId')) this.#syncSpots();
    // Switching position editing on or off: rebuild the markers rather than toggling Leaflet's drag handlers.
    if (changed.has('pinDraggable') && changed.get('pinDraggable') !== undefined) this.#clearPin();
    if (changed.has('spots') || changed.has('plants') || changed.has('pin') || changed.has('editable')) this.#syncButtons();
    if (changed.has('draggablePlants') && changed.get('draggablePlants') !== undefined) this.#clearPlants();
    if (changed.has('pin') || changed.has('pinDraggable')) this.#syncPin();
    if (changed.has('plants') || changed.has('selectedPlant') || changed.has('draggablePlants')) this.#syncPlants();
    if (changed.has('plantZoom')) this.#syncPlantVisibility();
    if (changed.has('track')) this.#syncTracking();
    if (changed.has('area')) this.#syncArea();
    const framed = changed.has('frame') && this.#applyFrame();
    if (this.fit && !this.#fitted) this.#fitToContent();
    if (changed.has('selectedId') && this.selectedId && !framed) this.#reveal(this.selectedId);
  }

  /** Brings a selected spot into view if it is off-screen. @param {string} id */
  #reveal(id) {
    const map = /** @type {L.Map} */ (this.#map);
    const marker = this.#markers.get(id);
    if (!marker || !map.getSize().x) return;
    const latLng = marker.getLatLng();
    if (!map.getBounds().pad(-0.15).contains(latLng)) map.setView(latLng, Math.max(map.getZoom(), 16));
  }

  connectedCallback() {
    super.connectedCallback();
    moduleEvents.addEventListener('change', this.#onModules);
    if (this.#map) this.#syncTracking();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    moduleEvents.removeEventListener('change', this.#onModules);
    this.#unwatch?.();
    this.#unwatch = null;
  }

  #syncAll() {
    this.#syncSpots();
    this.#syncPin();
    this.#syncPlants();
    this.#syncTracking();
    this.#syncArea();
    if (!this.#applyFrame() && this.fit) this.#fitToContent();
  }

  /** @param {string} name @param {any} detail */
  #emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  #syncSpots() {
    const layer = /** @type {L.LayerGroup} */ (this.#spotLayer);
    const seen = new Set();
    for (const spot of this.spots) {
      seen.add(spot.id);
      const [lon, lat] = this.#spotAt(spot);
      const selected = spot.id === this.selectedId;
      const movable = this.#placeMovable(spot.id);
      let marker = this.#markers.get(spot.id);
      if (!marker) {
        marker = L.marker([lat, lon], { icon: pinIcon(spot, selected, movable), title: placeTitle(spot), keyboard: true, riseOnHover: true, draggable: movable, autoPan: movable })
          .on('click', () => { if (!this.editing) this.#emit('spot-select', { id: spot.id }); });
        const id = spot.id;
        marker.on('dragend', () => {
          const { lat: y, lng: x } = /** @type {L.Marker} */ (this.#markers.get(id)).getLatLng();
          this.#move(m => m.places.set(id, [x, y]));
        });
        marker.addTo(layer);
        this.#markers.set(spot.id, marker);
      } else {
        marker.setLatLng([lat, lon]);
        marker.setIcon(pinIcon(spot, selected, movable));
      }
      // While editing, places stay below plants (z 500+): a plant on its place point remains grabbable.
      marker.setZIndexOffset(selected && !this.editing ? 1000 : 0);
    }
    for (const [id, marker] of this.#markers) {
      if (seen.has(id)) continue;
      layer.removeLayer(marker);
      this.#markers.delete(id);
    }
  }

  #syncPlants() {
    const layer = /** @type {L.LayerGroup} */ (this.#plantLayer);
    const seen = new Set();
    for (const plant of this.plants) {
      seen.add(plant.key);
      const [lon, lat] = this.#plantAt(plant);
      const selected = plant.key === this.selectedPlant;
      const movable = this.#plantMovable(plant);
      let marker = this.#plantMarkers.get(plant.key);
      if (!marker) {
        marker = L.marker([lat, lon], {
          icon: plantIcon(plant, selected, movable),
          title: plant.label,
          keyboard: true,
          riseOnHover: true,
          draggable: movable,
          autoPan: movable
        });
        const current = plant;
        marker.on('click', () => { if (!this.editing) this.#emit('plant-select', { placeId: current.placeId, plantId: current.plantId }); });
        marker.on('dragend', () => {
          const { lat: y, lng: x } = /** @type {L.Marker} */ (this.#plantMarkers.get(current.key)).getLatLng();
          if (this.editable) this.#move(m => m.plants.set(current.key, [x, y]));
          else this.#emit('plant-move', { placeId: current.placeId, plantId: current.plantId, coordinates: [x, y] });
        });
        marker.addTo(layer);
        this.#plantMarkers.set(plant.key, marker);
      } else {
        marker.setLatLng([lat, lon]);
        marker.setIcon(plantIcon(plant, selected, movable));
      }
      marker.setZIndexOffset(selected ? 1200 : 500);
    }
    for (const [key, marker] of this.#plantMarkers) {
      if (seen.has(key)) continue;
      // Out of the group too, or it would come back when the plant layer is shown again.
      layer.removeLayer(marker);
      this.#plantMarkers.delete(key);
    }
    this.#syncPlantVisibility();
  }

  /** Once a plant's photo URL is known, its markers are redrawn with it. @param {number} plantId */
  async #loadThumb(plantId) {
    const url = await thumbUrl(plantId);
    if (!url || !this.isConnected) return;
    for (const plant of this.plants) {
      if (plant.plantId !== plantId) continue;
      this.#plantMarkers.get(plant.key)?.setIcon(plantIcon(plant, plant.key === this.selectedPlant, this.#plantMovable(plant)));
    }
  }

  /** Plants only from `plantZoom` on: from afar the map shows places. */
  #syncPlantVisibility() {
    const map = this.#map;
    const layer = this.#plantLayer;
    if (!map || !layer) return;
    // Moving a selected place's plants: they show at any zoom.
    const visible = this.plants.length > 0 && (map.getZoom() >= this.plantZoom || (this.editing && Boolean(this.selectedId || this.pin || !this.spots.length)));
    if (visible && !map.hasLayer(layer)) layer.addTo(map);
    else if (!visible && map.hasLayer(layer)) layer.remove();
    // Photos are looked up only for plants actually drawn.
    if (visible) {
      for (const id of new Set(this.plants.map(p => p.plantId))) if (id && cachedThumb(id) === undefined) this.#loadThumb(id);
    }
  }

  // The place pin stays below plant markers (z 500+): a plant on the place point covers only the tip of
  // the pin's stem, so both remain grabbable (the pin by its square).
  #clearPin() {
    this.#editMarker?.remove();
    this.#editMarker = null;
  }

  #clearPlants() {
    this.#plantLayer?.clearLayers();
    this.#plantMarkers.clear();
  }

  #syncPin() {
    const map = /** @type {L.Map} */ (this.#map);
    if (!this.pin) {
      this.#editMarker?.remove();
      this.#editMarker = null;
      return;
    }
    const [lon, lat] = this._moves.pin || this.pin;
    if (!this.#editMarker) {
      const movable = this.#pinMovable;
      this.#editMarker = L.marker([lat, lon], { icon: movable ? editIcon : lockedIcon, draggable: movable, autoPan: true, zIndexOffset: 100 })
        .on('dragend', () => {
          const { lat: y, lng: x } = /** @type {L.Marker} */ (this.#editMarker).getLatLng();
          if (this.editable) this.#move(m => { m.pin = [x, y]; });
          else this.#emit('pin-move', { coordinates: [x, y] });
        })
        .addTo(map);
    } else {
      this.#editMarker.setLatLng([lat, lon]);
    }
  }

  #syncTracking() {
    if (this.track && !this.#unwatch) {
      this.#unwatch = watchLocation(({ fix }) => this.#showFix(fix));
    } else if (!this.track && this.#unwatch) {
      this.#unwatch();
      this.#unwatch = null;
    }
  }

  /** @param {import('../core/geo.js').Fix | null} fix */
  #showFix(fix) {
    const map = this.#map;
    if (!map || !fix) return;
    const [lon, lat] = fix.coordinates;
    this.#fix = fix.coordinates;
    if (!this.#me) {
      this.#meCircle = L.circle([lat, lon], {
        radius: fix.accuracy,
        color: '#2563eb',
        weight: 1,
        fillColor: '#3b82f6',
        fillOpacity: 0.15,
        interactive: false
      }).addTo(map);
      this.#me = L.marker([lat, lon], { icon: meIcon, interactive: false, keyboard: false, zIndexOffset: 1500 }).addTo(map);
    } else {
      this.#me.setLatLng([lat, lon]);
      this.#meCircle?.setLatLng([lat, lon]).setRadius(fix.accuracy);
    }
    if (this.#follow) map.panTo([lat, lon], { animate: true });
  }

  /** "Autour": the searched circle and the observations of the chosen species. */
  #syncArea() {
    const layer = /** @type {L.LayerGroup} */ (this.#areaLayer);
    layer.clearLayers();
    const area = this.area;
    if (!area) return;
    const [lon, lat] = area.center;
    L.circle([lat, lon], { radius: area.radius, className: 'gf-area', interactive: false }).addTo(layer);
    for (const point of area.points || []) {
      const [x, y] = point.coordinates;
      const dot = L.circleMarker([y, x], { radius: 6, className: 'gf-obs', bubblingMouseEvents: false }).addTo(layer);
      dot.bindTooltip(point.title, { direction: 'top' });
      if (point.url) dot.on('click', () => open(point.url, '_blank', 'noopener'));
    }
  }

  /** Map centre as [lon, lat]. @returns {[number, number] | null} */
  center() {
    const c = this.#map?.getCenter();
    return c ? [c.lng, c.lat] : null;
  }

  /** Zooms on `frame` once per key; true when it did. */
  #applyFrame() {
    const map = /** @type {L.Map} */ (this.#map);
    const frame = this.frame;
    const size = map.getSize();
    if (!frame || frame.key === this.#framedKey || !frame.points.length || !size.x) return false;
    this.#framedKey = frame.key;
    this.#fitted = true;
    const bottom = Math.round(size.y * (frame.bottom || 0));
    const bounds = L.latLngBounds(frame.points.map(([lon, lat]) => [lat, lon]));
    // A single point (or plants all on it) has no extent: fitBounds then uses maxZoom.
    const single = bounds.getNorthEast().equals(bounds.getSouthWest());
    map.fitBounds(bounds, { paddingTopLeft: [40, 56], paddingBottomRight: [40, 40 + bottom], maxZoom: single ? 18 : 19, animate: false });
    if (map.getZoom() < PLANT_ZOOM && bounds.getNorthEast().distanceTo(bounds.getSouthWest()) < 300) {
      map.setZoom(PLANT_ZOOM, { animate: false });
    }
    return true;
  }

  #fitToContent() {
    const map = /** @type {L.Map} */ (this.#map);
    const points = [
      ...(this.pin ? [this.pin] : this.spots.map(s => s.geometry.coordinates)),
      ...(this.pin || !this.spots.length ? this.plants.map(p => p.coordinates) : [])
    ];
    // Not laid out yet: fitting now would compute a view for a 0×0 map.
    if (!points.length || !map.getSize().x) return;
    this.#fitted = true;
    if (points.length === 1) {
      const [lon, lat] = points[0];
      map.setView([lat, lon], 17);
    } else {
      map.fitBounds(L.latLngBounds(points.map(([lon, lat]) => [lat, lon])), { padding: [40, 40], maxZoom: 17 });
    }
  }

  /** Centers the map on a spot or point. @param {[number, number]} coordinates @param {number} [zoom] */
  flyTo([lon, lat], zoom) {
    this.#map?.flyTo([lat, lon], zoom ?? Math.max(this.#map.getZoom(), 16), { duration: 0.6 });
  }

  /** @param {boolean} follow */
  #setFollow(follow) {
    this.#follow = follow;
    this.#buttons?.querySelector('.locate')?.setAttribute('aria-pressed', String(follow));
  }

  #locate() {
    if (!this.track) {
      this.track = true;
    }
    this.#setFollow(true);
    if (this.#fix) {
      const [lon, lat] = this.#fix;
      this.#map?.flyTo([lat, lon], Math.max(this.#map.getZoom(), 17), { duration: 0.6 });
    }
  }

  #buildButtons() {
    const buttons = this.#buttons = Object.assign(document.createElement('div'), { className: 'gf-map-buttons' });
    // With the search pill, ▦ lives at its end; otherwise it is a round button like "locate".
    buttons.innerHTML = `
      ${this.#hasSearch ? '' : '<button type="button" class="layers" aria-label="Carte : fond, couches, légende" title="Carte : fond, couches, légende">▦</button>'}
      <button type="button" class="locate" aria-label="Me localiser" title="Me localiser" aria-pressed="false">◎</button>
      <button type="button" class="edit" aria-label="Modifier les positions" title="Modifier les positions" aria-pressed="false" hidden>✎</button>`;
    buttons.querySelector('.locate')?.addEventListener('click', () => this.#locate());
    buttons.querySelector('.layers')?.addEventListener('click', () => this.openPanel());
    buttons.querySelector('.edit')?.addEventListener('click', () => {
      if (this.editing) this.#endEdit(true);
      else this.#setEditing(true);
    });
    L.DomEvent.disableClickPropagation(buttons);
    this.#root.append(buttons);
    this.#syncButtons();
  }

  get #hasSearch() { return this.search && !this.noSearch; }

  /** ✎: shown on editable maps, disabled when there is nothing to move. */
  #syncButtons() {
    const edit = /** @type {HTMLButtonElement | null | undefined} */ (this.#buttons?.querySelector('.edit'));
    if (!edit) return;
    edit.hidden = !this.editable;
    const nothing = !this.pin && !this.spots.length && !this.plants.length;
    edit.disabled = nothing && !this.editing;
    edit.title = nothing ? 'Aucun lieu à déplacer' : this.editing ? 'Valider les positions' : 'Modifier les positions';
    edit.setAttribute('aria-pressed', String(this.editing));
  }

  #buildSearch() {
    const search = Object.assign(document.createElement('gf-map-search'), { className: 'gf-map-search' });
    search.addEventListener('open-panel', () => this.openPanel());
    search.addEventListener('place-pick', (/** @type {any} */ e) => {
      const [lon, lat] = e.detail.coordinates;
      this.#setFollow(false);
      this.#map?.flyTo([lat, lon], Math.max(this.#map.getZoom(), 15), { duration: 0.6 });
      this.showPoint(e.detail.coordinates, e.detail.label);
    });
    L.DomEvent.disableClickPropagation(search);
    L.DomEvent.disableScrollPropagation(search);
    this.#root.append(search);
  }

  /** The "Carte" panel: background, overlays, legend, sources. */
  openPanel() {
    if (!this.#panel) {
      const panel = this.#panel = document.createElement('gf-map-panel');
      panel.addEventListener('base-change', (/** @type {any} */ e) => this.#setBase(e.detail.key));
      panel.addEventListener('overlay-toggle', (/** @type {any} */ e) => this.#setOverlay(e.detail.key, e.detail.on));
      this.#root.append(panel);
    }
    Object.assign(this.#panel, { base: this.#base, overlays: [...this.#overlays], legend: this.legend });
    this.#panel.updateComplete.then(() => this.#panel.open());
  }

  /** Point card (long press or search result): address, altitude, coordinates. @param {[number, number]} point @param {string} [label] */
  showPoint(point, label = '') {
    const map = /** @type {L.Map} */ (this.#map);
    const [lon, lat] = point;
    if (!this.#pointMarker) {
      this.#pointMarker = L.marker([lat, lon], { icon: pointIcon, interactive: false, keyboard: false, zIndexOffset: 1400 }).addTo(map);
    } else {
      this.#pointMarker.setLatLng([lat, lon]);
    }
    if (!this.#pointCard) {
      const card = this.#pointCard = Object.assign(document.createElement('gf-point-card'), { className: 'gf-point-card' });
      card.addEventListener('close', () => this.hidePoint());
      L.DomEvent.disableClickPropagation(card);
      this.#root.append(card);
    }
    Object.assign(this.#pointCard, { point, label, create: !this.noCreate });
    this.#emit('point-info', { coordinates: point });
  }

  hidePoint() {
    if (!this.#pointCard) return;
    this.#pointMarker?.remove();
    this.#pointMarker = null;
    this.#pointCard.remove();
    this.#pointCard = null;
    this.#emit('point-close', {});
  }

  /** @param {string} key */
  #layer(key) {
    this.#layers[key] ??= tileLayer(key);
    return this.#layers[key];
  }

  /** @param {'photo' | 'plan'} key */
  #setBase(key) {
    const map = /** @type {L.Map} */ (this.#map);
    if (key === this.#base || !(key in BASES)) return;
    this.#layer(this.#base).remove();
    this.#base = key;
    /** @type {L.TileLayer} */ (this.#layer(key).addTo(map)).bringToBack();
    this.#saveLayers();
  }

  /** @param {string} key @param {boolean} on */
  #setOverlay(key, on) {
    const map = /** @type {L.Map} */ (this.#map);
    if (!(key in OVERLAYS)) return;
    this.#overlays = this.#overlays.filter(k => k !== key);
    if (on) {
      this.#overlays.push(key);
      this.#layer(key).addTo(map);
    } else {
      this.#layer(key).remove();
    }
    this.#saveLayers();
  }

  #saveLayers() {
    store(config.storageKeys.mapLayer, { base: this.#base, overlays: this.#overlays });
    if (this.#panel) Object.assign(this.#panel, { base: this.#base, overlays: [...this.#overlays] });
  }
}

customElements.define('gf-map', GfMap);
