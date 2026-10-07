// @ts-check
// Leaflet map on IGN imagery. Rendered in light DOM so Leaflet's global CSS and events just work.

import { LitElement, html } from 'lit';
import * as L from 'leaflet';
import { config } from '../config.js';
import { watchLocation } from '../core/geo.js';
import { FRANCE_BOUNDS, LAYERS, tileLayer } from '../core/ign.js';
import { inSeason, placeAbundance, placeTitle } from '../core/collections.js';
import { store as appStore } from '../core/store.js';
import { cachedThumb, thumbUrl } from '../core/thumb.js';

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

/** @param {import('../core/collections.js').Place} spot @param {boolean} selected */
function pinIcon(spot, selected) {
  const color = PIN_COLORS[placeAbundance(spot)] || PIN_COLORS.moyen;
  const classes = [selected ? 'selected' : '', appStore.state.harvestMode && inSeason(spot) ? 'season' : ''].join(' ');
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
 */

const meIcon = L.divIcon({ className: 'gf-me', iconSize: [18, 18], iconAnchor: [9, 9] });

/** Draggable place pin of the editor (same shape as places, in green). */
const editIcon = placeIconOf('#16a34a', 0, 'selected editing');
/** The same place point when positions are locked (read-only map). */
const lockedIcon = placeIconOf('#16a34a', 0, 'selected');

const readStored = (/** @type {string} */ key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
};
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
 * Events: spot-select {id}, plant-select {placeId, plantId}, pin-move {coordinates},
 *         plant-move {placeId, plantId, coordinates}, map-longpress {coordinates}
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
    remember: { type: Boolean }
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
  }

  createRenderRoot() { return this; }

  // Lit owns this one wrapper; Leaflet and the map buttons live inside it, out of Lit's way
  // (anything appended straight to the host would be cleared by Lit's next render).
  render() { return html`<div class="gf-map-root"></div>`; }

  get #root() { return /** @type {HTMLElement} */ (this.querySelector('.gf-map-root')); }

  /** @type {L.Map | null} */ #map = null;
  /** @type {Record<string, L.TileLayer>} */ #layers = {};
  #base = /** @type {'photo' | 'plan'} */ (readStored(config.storageKeys.mapLayer, { base: 'photo' }).base);
  #cadastre = Boolean(readStored(config.storageKeys.mapLayer, { cadastre: false }).cadastre);
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
  /** @type {HTMLElement | null} */ #menu = null;

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

    this.#layers = { photo: tileLayer('photo'), plan: tileLayer('plan'), cadastre: tileLayer('cadastre') };
    this.#layers[this.#base]?.addTo(map);
    if (this.#cadastre) this.#layers.cadastre.addTo(map);

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
      if (this.pin && !this.pinDraggable) return;
      const { lat, lng } = /** @type {L.LeafletMouseEvent} */ (event).latlng;
      this.#emit('map-longpress', { coordinates: [lng, lat] });
    });

    this.#buildButtons();
    // The element may have been laid out after Leaflet measured it.
    new ResizeObserver(() => {
      map.invalidateSize();
      this.#applyFrame();
      if (this.fit && !this.#fitted) this.#fitToContent();
    }).observe(this);
    this.#syncAll();
  }

  /** @param {Map<string, any>} changed */
  updated(changed) {
    if (!this.#map) return;
    if (changed.has('spots') || changed.has('selectedId')) this.#syncSpots();
    // Switching position editing on or off: rebuild the markers rather than toggling Leaflet's drag handlers.
    if (changed.has('pinDraggable') && changed.get('pinDraggable') !== undefined) this.#clearPin();
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
    if (this.#map) this.#syncTracking();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
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
      const [lon, lat] = spot.geometry.coordinates;
      const selected = spot.id === this.selectedId;
      let marker = this.#markers.get(spot.id);
      if (!marker) {
        marker = L.marker([lat, lon], { icon: pinIcon(spot, selected), title: placeTitle(spot), keyboard: true, riseOnHover: true })
          .on('click', () => this.#emit('spot-select', { id: spot.id }));
        marker.addTo(layer);
        this.#markers.set(spot.id, marker);
      } else {
        marker.setLatLng([lat, lon]);
        marker.setIcon(pinIcon(spot, selected));
      }
      marker.setZIndexOffset(selected ? 1000 : 0);
    }
    for (const [id, marker] of this.#markers) {
      if (seen.has(id)) continue;
      marker.remove();
      this.#markers.delete(id);
    }
  }

  #syncPlants() {
    const layer = /** @type {L.LayerGroup} */ (this.#plantLayer);
    const seen = new Set();
    for (const plant of this.plants) {
      seen.add(plant.key);
      const [lon, lat] = plant.coordinates;
      const selected = plant.key === this.selectedPlant;
      let marker = this.#plantMarkers.get(plant.key);
      if (!marker) {
        marker = L.marker([lat, lon], {
          icon: plantIcon(plant, selected, this.draggablePlants),
          title: plant.label,
          keyboard: true,
          riseOnHover: true,
          draggable: this.draggablePlants,
          autoPan: this.draggablePlants
        });
        const current = plant;
        marker.on('click', () => this.#emit('plant-select', { placeId: current.placeId, plantId: current.plantId }));
        marker.on('dragend', () => {
          const { lat: y, lng: x } = /** @type {L.Marker} */ (this.#plantMarkers.get(current.key)).getLatLng();
          this.#emit('plant-move', { placeId: current.placeId, plantId: current.plantId, coordinates: [x, y] });
        });
        marker.addTo(layer);
        this.#plantMarkers.set(plant.key, marker);
      } else {
        marker.setLatLng([lat, lon]);
        marker.setIcon(plantIcon(plant, selected, this.draggablePlants));
      }
      marker.setZIndexOffset(selected ? 1200 : 500);
    }
    for (const [key, marker] of this.#plantMarkers) {
      if (seen.has(key)) continue;
      marker.remove();
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
      this.#plantMarkers.get(plant.key)?.setIcon(plantIcon(plant, plant.key === this.selectedPlant, this.draggablePlants));
    }
  }

  /** Plants only from `plantZoom` on: from afar the map shows places. */
  #syncPlantVisibility() {
    const map = this.#map;
    const layer = this.#plantLayer;
    if (!map || !layer) return;
    const visible = this.plants.length > 0 && map.getZoom() >= this.plantZoom;
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
    for (const marker of this.#plantMarkers.values()) marker.remove();
    this.#plantMarkers.clear();
  }

  #syncPin() {
    const map = /** @type {L.Map} */ (this.#map);
    if (!this.pin) {
      this.#editMarker?.remove();
      this.#editMarker = null;
      return;
    }
    const [lon, lat] = this.pin;
    if (!this.#editMarker) {
      this.#editMarker = L.marker([lat, lon], { icon: this.pinDraggable ? editIcon : lockedIcon, draggable: this.pinDraggable, autoPan: true, zIndexOffset: 100 })
        .on('dragend', () => {
          const { lat: y, lng: x } = /** @type {L.Marker} */ (this.#editMarker).getLatLng();
          this.#emit('pin-move', { coordinates: [x, y] });
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
    buttons.innerHTML = `
      <button type="button" class="layers" aria-label="Fonds de carte" title="Fonds de carte" aria-expanded="false">▦</button>
      <button type="button" class="locate" aria-label="Me localiser" title="Me localiser" aria-pressed="false">◎</button>`;
    buttons.querySelector('.locate')?.addEventListener('click', () => this.#locate());
    buttons.querySelector('.layers')?.addEventListener('click', () => this.#toggleMenu());
    L.DomEvent.disableClickPropagation(buttons);
    this.#root.append(buttons);
  }

  #toggleMenu() {
    const button = this.#buttons?.querySelector('.layers');
    if (this.#menu) {
      this.#menu.remove();
      this.#menu = null;
      button?.setAttribute('aria-expanded', 'false');
      return;
    }
    const menu = this.#menu = Object.assign(document.createElement('div'), { className: 'gf-layer-menu' });
    const radio = (/** @type {'photo' | 'plan'} */ key) => {
      const label = document.createElement('label');
      const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'gf-base', checked: this.#base === key });
      input.addEventListener('change', () => this.#setBase(key));
      label.append(input, LAYERS[key].label);
      return label;
    };
    const overlay = document.createElement('label');
    const check = Object.assign(document.createElement('input'), { type: 'checkbox', checked: this.#cadastre });
    check.addEventListener('change', () => this.#setCadastre(check.checked));
    overlay.append(check, LAYERS.cadastre.label);
    menu.append(radio('photo'), radio('plan'), document.createElement('hr'), overlay);
    L.DomEvent.disableClickPropagation(menu);
    this.#root.append(menu);
    button?.setAttribute('aria-expanded', 'true');
  }

  /** @param {'photo' | 'plan'} key */
  #setBase(key) {
    const map = /** @type {L.Map} */ (this.#map);
    this.#layers[this.#base].remove();
    this.#base = key;
    this.#layers[key].addTo(map);
    this.#layers[key].bringToBack();
    this.#saveLayers();
  }

  /** @param {boolean} on */
  #setCadastre(on) {
    const map = /** @type {L.Map} */ (this.#map);
    this.#cadastre = on;
    if (on) this.#layers.cadastre.addTo(map);
    else this.#layers.cadastre.remove();
    this.#saveLayers();
  }

  #saveLayers() {
    store(config.storageKeys.mapLayer, { base: this.#base, cadastre: this.#cadastre });
  }
}

customElements.define('gf-map', GfMap);
