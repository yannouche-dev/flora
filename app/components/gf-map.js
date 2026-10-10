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
import { protectedAreasIn } from '../core/protected.js';
import { href } from '../core/router.js';
import { gbifTileUrl } from '../core/sources.js';
import './gf-map-panel.js';
import './gf-map-search.js';
import './gf-point-card.js';
import { icon, iconHref, iconMarkup } from '../core/icons.js';

const STYLESHEETS = [
  new URL('../../vendor/leaflet.css', import.meta.url).href,
  new URL('../styles/map.css', import.meta.url).href
];

const PIN_COLORS = { rare: '#fb7185', moyen: '#fbbf24', abondant: '#38bdf8' };

/** Plants are drawn from this zoom level on (places are always drawn). */
export const PLANT_ZOOM = 16;
/** From this zoom on (a few km across), maps say which protected areas are in view. */
export const PROTECTED_ZOOM = 11;

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
/** A plant without a photo: a flower (Bootstrap Icons) in its circle. */
const FLOWER = `<svg x="5" y="5" width="12" height="12" viewBox="0 0 16 16" fill="#fff"><use href="${iconHref('flower1')}"></use></svg>`;

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
      ${FLOWER}
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
    overlays: overlays.filter(k => k in OVERLAYS),
    distribution: saved.distribution === true
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
 *  - editable: the ✎ control (always shown) switches position editing on. While `editing`, every marker
 *    (places, plants, the pin) is dragged freely; each drop (or long press: place the pin / selected place)
 *    emits positions-save with that one move, for the caller to store at once. « Terminé » or ✎ ends it.
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
    /** A plant whose GBIF distribution the Carte panel offers as a layer: { key (GBIF taxon), label }. */
    distribution: { attribute: false },
    /** Shows the `distribution` layer without the panel (a map block configured to). `distribution.filter`: GBIF filter params. */
    distributionOn: { type: Boolean, attribute: 'distribution-on' },
    /** A second plant's GBIF occurrences, in another colour: { key, label, country? }. */
    compare: { attribute: false },
    /** A point to show and fly to (a value touched in the plant sheet): { coordinates, title, url? }. */
    focusPoint: { attribute: false },
    /** This map's own background and overlays (not the shared choice of the Carte); changes emit `layers-change`. */
    base: { attribute: false },
    overlays: { attribute: false },
    /** Points drawn as small circles: [{ coordinates, title, url?, kind? }] (kind: 'gbif' | 'inat', its colour). */
    points: { attribute: false },
    /** The point card's « Créer un endroit ici » makes a place with this plant already in it. */
    createPlant: { type: Number, attribute: 'create-plant' },
    /** How far out the map can go (5: France; 1: the world). */
    minZoom: { type: Number, attribute: 'min-zoom' },
    /** No « Me localiser » button. */
    noLocate: { type: Boolean, attribute: 'no-locate' },
    _moves: { state: true },
    _areas: { state: true },
    _areasClosed: { state: true },
    _areasOpen: { state: true }
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
    this.distributionOn = false;
    /** @type {{ key: number, label: string, country?: string } | null} */
    this.compare = null;
    /** @type {{ coordinates: [number, number], title: string, url?: string } | null} */
    this.focusPoint = null;
    /** @type {string | null} */
    this.base = null;
    /** @type {string[] | null} */
    this.overlays = null;
    /** @type {{ coordinates: [number, number], title: string, url?: string, kind?: string }[]} */
    this.points = [];
    /** @type {number | null} */
    this.createPlant = null;
    this.noLocate = false;
    this.minZoom = 5;
    this.noSearch = false;
    this.editable = false;
    this.editing = false;
    /** Working copy while editing positions. */
    this._moves = emptyMoves();
    /** Protected areas in view (« IGN – espaces protégés »). @type {import('../core/protected.js').ProtectedArea[]} */
    this._areas = [];
    /** The set of areas whose banner was closed (it comes back for other areas). */
    this._areasClosed = '';
    this._areasOpen = false;
  }

  createRenderRoot() { return this; }

  // Lit owns this one wrapper; Leaflet and the map buttons live inside it, out of Lit's way
  // (anything appended straight to the host would be cleared by Lit's next render).
  render() {
    const hint = (this.pin || this.selectedId ? 'Glissez le lieu ou ses plantes · appui long : placer le lieu'
      : this.spots.length ? 'Glissez les lieux et les plantes (en zoomant)' : 'Glissez les plantes')
      + ' — enregistré dès que vous lâchez';
    // The frame goes full screen while editing positions: in the browser's top layer (popover), so no
    // ancestor (a pane with `contain`, the header, the tab bar) can clip or cover it.
    return html`<div class="gf-map-frame" popover="manual"><div class="gf-map-root"></div>
      <div class="gf-map-notes">
        ${moduleOn('ignMaps') ? nothing : html`<div class="gf-map-off" role="status">Fonds IGN désactivés : seules les zones déjà vues s’affichent.
          <a href=${href.settings()}>Réglages › Modules</a></div>`}
        ${this.#protectedBanner()}
      </div>
      ${this.editing ? html`<div class="gf-map-editbar" role="group" aria-label="Modifier les positions">
        <span class="hint">${hint}</span>
        <span class="actions">
          <button type="button" class="primary" @click=${() => this.#setEditing(false)}>Terminé</button>
        </span>
      </div>` : nothing}</div>`;
  }

  // ── Protected areas ────────────────────────────────────────────────────────────────────────────

  get #areasKey() { return this._areas.map(a => a.id).sort().join(','); }

  /** « Réserve naturelle de … — la cueillette y est souvent interdite ou réglementée » (not while editing). */
  #protectedBanner() {
    const areas = this._areas;
    if (!areas.length || this.editing || this.#areasKey === this._areasClosed) return nothing;
    const shown = this._areasOpen ? areas : areas.slice(0, 2);
    const more = areas.length - shown.length;
    return html`<div class="gf-map-protected" role="status">
      <span class="what">${icon('shield-check')} ${shown.map((a, i) => html`${i ? ' · ' : ''}${a.url
        ? html`<a href=${a.url} target="_blank" rel="noopener" title=${a.kind}>${a.name}</a>` : html`<b title=${a.kind}>${a.name}</b>`}
        <span class="kind">(${a.kind})</span>`)}${more > 0
        ? html` · <button type="button" class="more" @click=${() => { this._areasOpen = true; }}>${icon('plus-lg')} ${more} autre${more > 1 ? 's' : ''}</button>` : nothing}
        — la cueillette y est souvent interdite ou réglementée : vérifiez les règles du site.</span>
      <button type="button" class="close" aria-label="Masquer" title="Masquer"
        @click=${() => { this._areasClosed = this.#areasKey; }}>${icon('x-lg')}</button>
    </div>`;
  }

  /** @type {ReturnType<typeof setTimeout> | undefined} */ #areasTimer;
  /** @type {AbortController | null} */ #areasAbort = null;

  /** The view moved: look for protected areas in it, once it settles. */
  #scheduleAreas() {
    clearTimeout(this.#areasTimer);
    this.#areasTimer = setTimeout(() => this.#checkAreas(), 600);
  }

  async #checkAreas() {
    const map = this.#map;
    this.#areasAbort?.abort();
    this.#areasAbort = null;
    if (!map || !map.getSize().x || map.getZoom() < PROTECTED_ZOOM || !moduleOn('ignProtected')) {
      this._areas = [];
      return;
    }
    const abort = this.#areasAbort = new AbortController();
    const b = map.getBounds();
    try {
      const areas = await protectedAreasIn({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, abort.signal);
      if (abort.signal.aborted) return;
      this._areas = areas;
      this._areasOpen = false;
    } catch (error) {
      if (!abort.signal.aborted) this._areas = [];
    }
  }

  // ── Position editing ───────────────────────────────────────────────────────────────────────────

  /** The pin moves: while editing (editable maps), else when the caller says so. */
  get #pinMovable() { return this.editable ? this.editing : this.pinDraggable; }

  /** While editing, every marker moves freely. @param {string} id */
  #placeMovable(id) { return this.editing && !this.pin && Boolean(id); }

  /** @param {PlantMarker} plant */
  #plantMovable(plant) {
    if (!this.editable) return this.draggablePlants;
    return this.editing && Boolean(plant);
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

  /**
   * A marker was dropped (or placed by long press): shown there at once, and saved right away by the
   * caller (positions-save with that one move). The working copy keeps it until the data passed back
   * has it, so a re-render with the old positions (GPS, a toast…) never sends it back.
   * @param {(m: Moves) => void} change
   * @param {{ pin?: [number, number], place?: { id: string, coordinates: [number, number] }, plant?: { key: string, coordinates: [number, number] } }} what
   */
  #drop(change, what) {
    this.#move(change);
    const plant = what.plant && this.plants.find(p => p.key === what.plant?.key);
    this.#emit('positions-save', {
      pin: what.pin || null,
      places: what.place ? [what.place] : [],
      plants: what.plant ? [{ placeId: plant?.placeId, plantId: plant?.plantId ?? null, coordinates: what.plant.coordinates }] : []
    });
    // A save that never comes back (error) must not pin the marker forever.
    const snapshot = this._moves;
    setTimeout(() => { if (this._moves === snapshot && !this.editing) this._moves = emptyMoves(); }, 10000);
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

  /** Forgets the moves the data passed in now has. */
  #pruneMoves() {
    const same = (/** @type {[number, number] | null | undefined} */ a, /** @type {[number, number]} */ b) =>
      Boolean(a) && Math.abs(a[0] - b[0]) < 2e-6 && Math.abs(a[1] - b[1]) < 2e-6;
    const { pin, places, plants } = this._moves;
    const keep = {
      pin: pin && !same(this.pin, pin) ? pin : null,
      places: new Map([...places].filter(([id, at]) => !same(this.spots.find(s => s.id === id)?.geometry.coordinates, at))),
      plants: new Map([...plants].filter(([key, at]) => !same(this.plants.find(p => p.key === key)?.coordinates, at)))
    };
    if (movesCount(keep) !== movesCount(this._moves)) this._moves = keep;
  }

  /** Markers being dragged right now: never moved or redrawn under the finger. @type {Set<L.Marker>} */
  #dragging = new Set();

  /** @param {L.Marker} marker */
  #trackDrag(marker) {
    marker.on('dragstart', () => this.#dragging.add(marker));
    marker.on('dragend', () => this.#dragging.delete(marker));
    return marker;
  }

  /** @param {(m: Moves) => void} change */
  #move(change) {
    const next = { pin: this._moves.pin, places: new Map(this._moves.places), plants: new Map(this._moves.plants) };
    change(next);
    this._moves = next;
  }

  /** « IGN – fonds de carte » switched on or off: rebuild the tile layers (network or cache only). */
  #onModules = () => {
    this.requestUpdate();
    this.#scheduleAreas();
    const map = this.#map;
    if (!map) return;
    for (const layer of Object.values(this.#layers)) layer.remove();
    this.#layers = {};
    /** @type {L.TileLayer} */ (this.#layer(this.#base).addTo(map)).bringToBack();
    for (const key of this.#overlays) this.#layer(key).addTo(map);
    this.#syncDistribution();
  };

  /**
   * The GBIF distribution layer of the plant given, when switched on in the panel (and GBIF is on), filtered
   * when asked; and the compared plant's, in purple.
   */
  #syncDistribution() {
    const d = this.distribution;
    const on = d && (this.#distributionOn || this.distributionOn) && moduleOn('gbif');
    this.#distributionLayer = this.#syncGbifLayer(this.#distributionLayer, on ? /** @type {any} */ (d) : null, 'classic.point', 20);
    const c = this.compare;
    this.#compareLayer = this.#syncGbifLayer(this.#compareLayer, c && moduleOn('gbif') ? { key: c.key, country: c.country, filter: null } : null, 'purpleYellow.point', 21);
  }

  /** @param {L.TileLayer | null} layer @param {{ key: number, country?: string, filter?: Record<string, string> | null } | null} d @param {string} style @param {number} zIndex */
  #syncGbifLayer(layer, d, style, zIndex) {
    const map = this.#map;
    const url = d ? gbifTileUrl(d.key, d.country, d.filter, style) : null;
    if (layer && /** @type {any} */ (layer).gfUrl !== url) { layer.remove(); layer = null; }
    if (!map || !url || layer) return layer;
    layer = L.tileLayer(url, {
      attribution: 'Occurrences : <a href="https://www.gbif.org/" target="_blank" rel="noopener">GBIF.org</a>',
      opacity: 0.85, crossOrigin: 'anonymous', maxNativeZoom: 16, maxZoom: 21, zIndex, className: 'gf-tiles-gbif'
    });
    /** @type {any} */ (layer).gfUrl = url;
    return layer.addTo(map);
  }

  /** The point touched in the sheet: a ringed marker, the map flies to it. */
  #syncFocusPoint() {
    const layer = this.#focusLayer;
    if (!layer || !this.#map) return;
    layer.clearLayers();
    const p = this.focusPoint;
    if (!p) return;
    const [x, y] = p.coordinates;
    const dot = L.circleMarker([y, x], { radius: 9, className: 'gf-focus-point', bubblingMouseEvents: false }).addTo(layer);
    dot.bindTooltip(p.title, { direction: 'top', permanent: true, className: 'gf-focus-tip' });
    if (p.url) dot.on('click', () => open(p.url, '_blank', 'noopener'));
    if (this.#map.getSize().x) this.#map.flyTo([y, x], Math.max(this.#map.getZoom(), 11), { duration: 0.6 });
  }

  get #root() { return /** @type {HTMLElement} */ (this.querySelector('.gf-map-root')); }

  /** @type {L.Map | null} */ #map = null;
  /** @type {Record<string, L.Layer>} */ #layers = {};
  #base = /** @type {'photo' | 'plan'} */ (readLayers().base);
  /** @type {string[]} */ #overlays = readLayers().overlays;
  #distributionOn = readLayers().distribution;
  /** @type {L.TileLayer | null} */ #distributionLayer = null;
  /** @type {L.TileLayer | null} */ #compareLayer = null;
  /** @type {L.LayerGroup | null} */ #focusLayer = null;
  /** @type {any} */ #panel = null;
  /** @type {L.Marker | null} */ #pointMarker = null;
  /** @type {any} */ #pointCard = null;
  /** @type {L.LayerGroup | null} */ #spotLayer = null;
  /** @type {Map<string, L.Marker>} */ #markers = new Map();
  /** @type {L.LayerGroup | null} */ #plantLayer = null;
  /** @type {Map<string, L.Marker>} */ #plantMarkers = new Map();
  /** @type {L.Marker | null} */ #editMarker = null;
  /** @type {L.LayerGroup | null} */ #areaLayer = null;
  /** @type {L.LayerGroup | null} */ #pointsLayer = null;
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
      minZoom: this.minZoom
    });
    map.attributionControl.setPrefix(false);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

    if (this.base && this.base in BASES) this.#base = /** @type {'photo' | 'plan'} */ (this.base);
    if (this.overlays) this.#overlays = this.overlays.filter(k => k in OVERLAYS);
    this.#layer(this.#base).addTo(map);
    for (const key of this.#overlays) this.#layer(key).addTo(map);

    this.#areaLayer = L.layerGroup().addTo(map);
    this.#pointsLayer = L.layerGroup().addTo(map);
    this.#focusLayer = L.layerGroup().addTo(map);
    this.#spotLayer = L.layerGroup().addTo(map);
    this.#plantLayer = L.layerGroup();
    map.on('zoomend', () => this.#syncPlantVisibility());

    const view = this.remember ? readStored(config.storageKeys.mapView, null) : null;
    if (view) map.setView([view.lat, view.lng], view.zoom);
    else map.fitBounds(FRANCE_BOUNDS);

    map.on('moveend', () => {
      this.#scheduleAreas();
      if (!this.remember) return;
      const center = map.getCenter();
      store(config.storageKeys.mapView, { lat: center.lat, lng: center.lng, zoom: map.getZoom() });
    });
    map.on('dragstart', () => this.#setFollow(false));
    map.on('contextmenu', event => {
      const { lat, lng } = /** @type {L.LeafletMouseEvent} */ (event).latlng;
      // Editing: the long press places the pin, or the selected place.
      if (this.editing) {
        if (this.pin) this.#drop(m => { m.pin = [lng, lat]; }, { pin: [lng, lat] });
        else if (this.selectedId) {
          const id = this.selectedId;
          this.#drop(m => m.places.set(id, [lng, lat]), { place: { id, coordinates: [lng, lat] } });
        }
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
    if (changed.has('base') && this.base && this.base !== this.#base) this.#setBase(/** @type {any} */ (this.base));
    if (changed.has('overlays') && this.overlays) {
      for (const key of Object.keys(OVERLAYS)) {
        const on = this.overlays.includes(key);
        if (on !== this.#overlays.includes(key)) this.#setOverlay(key, on);
      }
    }
    if (changed.has('points')) this.#syncPoints();
    if (changed.has('minZoom') && changed.get('minZoom') !== undefined) {
      // Tile layers are made for a zoom range: rebuild them for the new one. The limit is set without
      // setMinZoom, whose animated zoom would land after (and undo) the framing done just below.
      this.#map.options.minZoom = this.minZoom;
      this.#onModules();
    }
    if (changed.has('focusPoint')) this.#syncFocusPoint();
    if (changed.has('distribution') || changed.has('distributionOn') || changed.has('compare')) {
      this.#syncDistribution();
      if (this.#panel) Object.assign(this.#panel, this.#distributionInfo());
    }
    // Dropped markers stay where they were dropped until the caller passes back data that has them.
    if (movesCount(this._moves) && (changed.has('spots') || changed.has('plants') || changed.has('pin'))) this.#pruneMoves();
    if (changed.has('editing') && changed.get('editing') !== undefined) {
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
    if (changed.has('spots') || changed.has('plants') || changed.has('pin') || changed.has('editable') || changed.has('noLocate')) this.#syncButtons();
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
    clearTimeout(this.#areasTimer);
    this.#areasAbort?.abort();
    this.#unwatch?.();
    this.#unwatch = null;
  }

  #syncAll() {
    this.#syncSpots();
    this.#syncPin();
    this.#syncPlants();
    this.#syncTracking();
    this.#syncArea();
    this.#syncPoints();
    if (!this.#applyFrame() && this.fit) this.#fitToContent();
    if (this.focusPoint && !this.#focusLayer?.getLayers().length) this.#syncFocusPoint();
  }

  /** Observations around (iNaturalist, GBIF): small circles in their source's colour, each linking to its record. */
  #syncPoints() {
    const layer = this.#pointsLayer;
    if (!layer) return;
    layer.clearLayers();
    for (const point of this.points || []) {
      const [x, y] = point.coordinates;
      const dot = L.circleMarker([y, x], { radius: 6, className: 'gf-obs' + (point.kind ? ' gf-obs-' + point.kind : ''), bubblingMouseEvents: false }).addTo(layer);
      dot.bindTooltip(point.title, { direction: 'top' });
      if (point.url) dot.on('click', () => open(point.url, '_blank', 'noopener'));
    }
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
          this.#drop(m => m.places.set(id, [x, y]), { place: { id, coordinates: [x, y] } });
        });
        this.#trackDrag(marker).addTo(layer);
        this.#markers.set(spot.id, marker);
      } else if (!this.#dragging.has(marker)) {
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
          if (this.editable) this.#drop(m => m.plants.set(current.key, [x, y]), { plant: { key: current.key, coordinates: [x, y] } });
          else this.#emit('plant-move', { placeId: current.placeId, plantId: current.plantId, coordinates: [x, y] });
        });
        this.#trackDrag(marker).addTo(layer);
        this.#plantMarkers.set(plant.key, marker);
      } else if (!this.#dragging.has(marker)) {
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
      this.#editMarker = this.#trackDrag(L.marker([lat, lon], { icon: movable ? editIcon : lockedIcon, draggable: movable, autoPan: true, zIndexOffset: 100 }))
        .on('dragend', () => {
          const { lat: y, lng: x } = /** @type {L.Marker} */ (this.#editMarker).getLatLng();
          if (this.editable) this.#drop(m => { m.pin = [x, y]; }, { pin: [x, y] });
          else this.#emit('pin-move', { coordinates: [x, y] });
        })
        .addTo(map);
    } else if (!this.#dragging.has(this.#editMarker)) {
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

  /** Current zoom level (null before the map exists). */
  zoom() { return this.#map ? this.#map.getZoom() : null; }

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
      ...(this.pin || !this.spots.length ? this.plants.map(p => p.coordinates) : []),
      ...(this.points || []).map(p => p.coordinates)
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
    // With the search pill, the layers button lives at its end; otherwise it is a round button like "locate".
    buttons.innerHTML = `
      ${this.#hasSearch ? '' : `<button type="button" class="layers" aria-label="Carte : fond, couches, légende" title="Carte : fond, couches, légende">${iconMarkup('layers')}</button>`}
      <button type="button" class="locate" aria-label="Me localiser" title="Me localiser" aria-pressed="false">${iconMarkup('crosshair')}</button>
      <button type="button" class="edit" aria-label="Modifier les positions" title="Modifier les positions" aria-pressed="false" hidden>${iconMarkup('pencil')}</button>`;
    buttons.querySelector('.locate')?.addEventListener('click', () => this.#locate());
    buttons.querySelector('.layers')?.addEventListener('click', () => this.openPanel());
    buttons.querySelector('.edit')?.addEventListener('click', () => {
      this.#setEditing(!this.editing);
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
    const locate = /** @type {HTMLButtonElement | null | undefined} */ (this.#buttons?.querySelector('.locate'));
    if (locate) locate.hidden = this.noLocate;
    const nothing = !this.pin && !this.spots.length && !this.plants.length;
    edit.disabled = nothing && !this.editing;
    edit.title = nothing ? 'Aucun lieu à déplacer' : this.editing ? 'Terminer la modification' : 'Modifier les positions';
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
      panel.addEventListener('distribution-toggle', (/** @type {any} */ e) => {
        this.#distributionOn = e.detail.on;
        this.#saveLayers();
        this.#syncDistribution();
      });
      this.#root.append(panel);
    }
    Object.assign(this.#panel, { base: this.#base, overlays: [...this.#overlays], legend: this.legend, ...this.#distributionInfo() });
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
    Object.assign(this.#pointCard, { point, label, create: !this.noCreate, plant: this.createPlant });
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
    this.#layers[key] ??= tileLayer(key, this.minZoom);
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
    // A map with its own layers (map block): tell its owner, leave the Carte's choice alone.
    if (this.base) this.#emit('layers-change', { base: this.#base, overlays: [...this.#overlays] });
    else store(config.storageKeys.mapLayer, { base: this.#base, overlays: this.#overlays, distribution: this.#distributionOn });
    if (this.#panel) Object.assign(this.#panel, { base: this.#base, overlays: [...this.#overlays], ...this.#distributionInfo() });
  }

  /** What the panel says of the GBIF layer: nothing without a plant (or with GBIF off). */
  #distributionInfo() {
    // Set by its owner (map block): not a panel choice.
    if (this.distributionOn) return { distribution: null, distributionOn: false };
    return { distribution: this.distribution && moduleOn('gbif') ? this.distribution.label : null, distributionOn: this.#distributionOn };
  }
}

customElements.define('gf-map', GfMap);
