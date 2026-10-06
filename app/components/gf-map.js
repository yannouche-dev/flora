// @ts-check
// Leaflet map on IGN imagery. Rendered in light DOM so Leaflet's global CSS and events just work.

import { LitElement, html } from 'lit';
import * as L from 'leaflet';
import { config } from '../config.js';
import { watchLocation } from '../core/geo.js';
import { FRANCE_BOUNDS, LAYERS, tileLayer } from '../core/ign.js';
import { inSeason, placeAbundance, placeTitle } from '../core/collections.js';

const STYLESHEETS = [
  new URL('../../vendor/leaflet.css', import.meta.url).href,
  new URL('../styles/map.css', import.meta.url).href
];

const PIN_COLORS = { rare: '#fb7185', moyen: '#fbbf24', abondant: '#38bdf8' };

/** @param {import('../core/collections.js').Place} spot @param {boolean} selected */
function pinIcon(spot, selected) {
  const color = PIN_COLORS[placeAbundance(spot)] || PIN_COLORS.moyen;
  const n = spot.properties.plants.length;
  // Several plants: show how many in the pin head.
  const head = n > 1
    ? `<circle cx="15" cy="14.5" r="7.5" fill="#fff"/><text x="15" y="18.5" text-anchor="middle" font-size="11" font-weight="700" font-family="system-ui,sans-serif" fill="#1d2419">${n > 99 ? '99+' : n}</text>`
    : '<circle cx="15" cy="14.5" r="5" fill="#fff"/>';
  const classes = ['gf-pin', selected ? 'selected' : '', inSeason(spot) ? 'season' : ''].join(' ');
  return L.divIcon({
    className: classes,
    iconSize: [30, 40],
    iconAnchor: [15, 39],
    html: `<svg width="30" height="40" viewBox="0 0 30 40" aria-hidden="true">
      <path class="ring" d="M15 39C15 39 2 23.5 2 14.5a13 13 0 0 1 26 0C28 23.5 15 39 15 39Z"
        fill="${color}" stroke="#fff" stroke-width="2"/>
      ${head}
    </svg>`
  });
}

const meIcon = L.divIcon({ className: 'gf-me', iconSize: [18, 18], iconAnchor: [9, 9] });

/** Draggable "new spot" pin. */
const editIcon = L.divIcon({
  className: 'gf-pin selected',
  iconSize: [30, 40],
  iconAnchor: [15, 39],
  html: `<svg width="30" height="40" viewBox="0 0 30 40" aria-hidden="true">
    <path d="M15 39C15 39 2 23.5 2 14.5a13 13 0 0 1 26 0C28 23.5 15 39 15 39Z" fill="#16a34a" stroke="#fff" stroke-width="2"/>
    <circle cx="15" cy="14.5" r="5" fill="#fff"/>
  </svg>`
});

const readStored = (/** @type {string} */ key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
};
const store = (/** @type {string} */ key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not persisted */ }
};

/**
 * Properties:
 *  - spots: GeoJSON spot features to show as pins
 *  - selectedId: highlighted spot
 *  - pin: [lon, lat] of an editable, draggable pin (spot editor), or null
 *  - track: show the live GPS position
 *  - fit: zoom to the spots (or the pin) on first data
 * Events: spot-select {id}, pin-move {coordinates}, map-longpress {coordinates}
 */
export class GfMap extends LitElement {
  static properties = {
    spots: { attribute: false },
    selectedId: { attribute: false },
    pin: { attribute: false },
    track: { type: Boolean },
    fit: { type: Boolean },
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
    this.track = false;
    this.fit = false;
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
  /** @type {L.Marker | null} */ #editMarker = null;
  /** @type {L.Marker | null} */ #me = null;
  /** @type {L.Circle | null} */ #meCircle = null;
  /** @type {(() => void) | null} */ #unwatch = null;
  /** @type {[number, number] | null} */ #fix = null;
  #follow = false;
  #fitted = false;
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

    this.#spotLayer = L.layerGroup().addTo(map);

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
      this.#emit('map-longpress', { coordinates: [lng, lat] });
    });

    this.#buildButtons();
    // The element may have been laid out after Leaflet measured it.
    new ResizeObserver(() => {
      map.invalidateSize();
      if (this.fit && !this.#fitted) this.#fitToContent();
    }).observe(this);
    this.#syncAll();
  }

  /** @param {Map<string, any>} changed */
  updated(changed) {
    if (!this.#map) return;
    if (changed.has('spots') || changed.has('selectedId')) this.#syncSpots();
    if (changed.has('pin')) this.#syncPin();
    if (changed.has('track')) this.#syncTracking();
    if (this.fit && !this.#fitted) this.#fitToContent();
    if (changed.has('selectedId') && this.selectedId) this.#reveal(this.selectedId);
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
    this.#syncTracking();
    if (this.fit) this.#fitToContent();
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

  #syncPin() {
    const map = /** @type {L.Map} */ (this.#map);
    if (!this.pin) {
      this.#editMarker?.remove();
      this.#editMarker = null;
      return;
    }
    const [lon, lat] = this.pin;
    if (!this.#editMarker) {
      this.#editMarker = L.marker([lat, lon], { icon: editIcon, draggable: true, autoPan: true, zIndexOffset: 2000 })
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

  #fitToContent() {
    const map = /** @type {L.Map} */ (this.#map);
    const points = this.pin ? [this.pin] : this.spots.map(s => s.geometry.coordinates);
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
