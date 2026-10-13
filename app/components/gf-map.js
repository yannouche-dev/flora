// @ts-check
// Leaflet map on IGN imagery. Rendered in light DOM so Leaflet's global CSS and events just work.

import { LitElement, html, nothing } from 'lit';
import * as L from 'leaflet';
import { config } from '../config.js';
import { watchLocation, whenGranted } from '../core/geo.js';
import { BASES, FRANCE_BOUNDS, OVERLAYS, addCatalogLayer, addedLayers, isOverlay, tileLayer } from '../core/ign.js';
import { inSeason, placeAbundance, placeTitle } from '../core/collections.js';
import { store as appStore } from '../core/store.js';
import { cachedThumb, thumbUrl } from '../core/thumb.js';
import { moduleEvents, moduleOn } from '../core/modules.js';
import { protectedAreasIn } from '../core/protected.js';
import { href } from '../core/router.js';
import { safeUrl } from '../core/safe-url.js';
import { gbifTileUrl } from '../core/sources.js';
import { creditText } from '../core/credit.js';
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

/**
 * An observation around (Découvrir) without a photo: a small leaf in a disc, popping in after `delay` ms.
 * @param {number} delay
 */
function leafIcon(delay) {
  return L.divIcon({
    className: 'gf-obs-leaf',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<span class="pop" style="animation-delay:${delay}ms">${iconMarkup('leaf-fill')}</span>`
  });
}

/**
 * An observation around with its photo (Découvrir): popping in after `delay` ms, its leaf first, then the plant's
 * thumbnail in a ring once it has loaded.
 * @param {string} photo @param {number} delay
 */
function photoIcon(photo, delay) {
  const pop = elem('span', 'pop');
  pop.style.animationDelay = delay + 'ms';
  pop.append(leafGlyph(), fadeImg(photo, { loading: 'lazy' }));
  return L.divIcon({ className: 'gf-obs-leaf gf-obs-photo', iconSize: [30, 30], iconAnchor: [15, 15], html: pop });
}

/** The leaf a plant's badge shows until its photo has loaded (and for good without one). */
function leafGlyph() {
  const glyph = elem('span', 'glyph');
  glyph.innerHTML = iconMarkup('leaf-fill');
  return glyph;
}

/**
 * A badge's photo: shown once it has loaded (a fade), over the leaf; gone if it fails (the leaf stays). Every plant
 * photo of the map comes through here: with the « Photos en ligne » module off, none is loaded (the leaf stays).
 * @param {string} src @param {{ loading?: 'lazy' | 'eager', decoding?: 'async' | 'sync' | 'auto' }} [props]
 * @returns {Node}
 */
function fadeImg(src, props = {}) {
  if (!moduleOn('photos')) return document.createTextNode('');
  const img = dropImg(src, props);
  img.classList.add('gf-fade');
  // Already there (cached): no fade, at once.
  if (img.complete && img.naturalWidth) img.classList.add('in');
  else img.addEventListener('load', () => img.classList.add('in'), { once: true });
  return img;
}

/**
 * The plant chosen (Découvrir's plant in view, the species picked « Autour », a value touched in a plant's sheet):
 * its photo, large, in a pink and gold ring, bouncing in after `delay` ms with a ripple as it lands. Its leaf
 * shows under the photo until it comes, and stays when there is none (or it fails).
 * @param {string | null | undefined} photo @param {number} delay @param {number} [size] @param {string} [extra] more classes
 */
function chosenIcon(photo, delay, size = 44, extra = '') {
  const pop = elem('span', 'pop');
  pop.style.setProperty('--d', delay + 'ms');
  pop.append(leafGlyph());
  if (photo) pop.append(fadeImg(photo, { decoding: 'async' }));
  return L.divIcon({ className: `gf-obs-leaf hl chosen ${extra}`.trim(), iconSize: [size, size], iconAnchor: [size / 2, size / 2], html: pop });
}

/**
 * Many observations of the plant chosen, together (a wider scope): its photo in a disc sized by their number, the
 * count on a badge. `still`: drawn again at another zoom, no entrance.
 * @param {string} photo @param {number} n @param {number} size @param {boolean} [still]
 */
function chosenGroupIcon(photo, n, size, still = false) {
  const g = elem('span', 'g');
  const ph = elem('span', 'ph');
  ph.append(leafGlyph(), fadeImg(photo, { decoding: 'async' }));
  g.append(ph, elem('b', 'n', n > 999 ? Math.round(n / 1000) + 'k' : String(n)));
  return L.divIcon({ className: 'gf-occ-group gf-occ-group-hl photo' + (still ? ' still' : ''), iconSize: [size, size], iconAnchor: [size / 2, size / 2], html: g });
}

/**
 * Which plant a point is, to light its kin (the other points of the same species): its binomial first — the same
 * key whatever the source (iNaturalist, GBIF, the plants of places) —, else its taxon.
 * @param {any} p @returns {string | null}
 */
const speciesKey = p => {
  const binomial = String(p?.sci || '').trim().split(/\s+/).slice(0, 2).join(' ').toLowerCase();
  return binomial ? 's:' + binomial : p?.taxonId != null ? 't:' + p.taxonId : null;
};

/**
 * The small plant card shown over an observation: its photo and its credit (author, licence, source), its names,
 * when and where. Built as nodes, the texts as text: names and places come from iNaturalist / GBIF, never parsed
 * as HTML.
 * @param {{ title: string, common?: string | null, sci?: string, photo?: string | null, credit?: import('../core/credit.js').Credit | null,
 *   date?: string | null, place?: string | null }} p
 */
function obsCard(p) {
  const big = p.photo ? p.photo.replace('/square.', '/small.') : null;
  const when = p.date ? new Date(p.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const card = elem('div', 'gf-obs-card'), t = elem('div', 't');
  if (big) card.append(fadeImg(big));
  t.append(elem('b', '', p.common || p.sci || p.title));
  if (p.common && p.sci) t.append(elem('i', '', p.sci));
  if (when || p.place) t.append(elem('small', '', [when, p.place].filter(Boolean).join(' · ')));
  if (big && p.credit && moduleOn('photos')) t.append(elem('small', 'credit', 'Photo : ' + creditText(p.credit)));
  card.append(t);
  return card;
}

/** An element, its text set as text (never HTML). @param {string} tag @param {string} [className] @param {string} [text] */
function elem(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/**
 * An image that leaves when it fails (offline, gone): a listener, not an inline `onerror`, which the CSP of
 * index.html forbids. `loading` is set before `src`, so a lazy image waits until it is near the view.
 * @param {string} src @param {{ loading?: 'lazy' | 'eager', decoding?: 'async' | 'sync' | 'auto' }} [props]
 */
function dropImg(src, props = {}) {
  const img = Object.assign(document.createElement('img'), { alt: '', referrerPolicy: 'no-referrer', ...props });
  img.addEventListener('error', () => img.remove(), { once: true });
  img.src = src;
  return img;
}

/** Leaf glyph for plant markers. */
/** A plant without a photo: a flower (Bootstrap Icons) in its circle. */
const FLOWER = `<svg x="5" y="5" width="12" height="12" viewBox="0 0 16 16" fill="#fff"><use href="${iconHref('flower1')}"></use></svg>`;

/** Past this many points, a group touched is zoomed in on before its points are spread. */
const SPREAD_MAX = 24;
/** Up to this many points of the plant chosen alone (a wider scope), each shows its photo; past it, dots. */
const PHOTO_SINGLES = 40;
/** The map's attribution while plant photos are on its points (#photoCredit). */
const PHOTO_CREDIT = 'Photos : <a href="https://www.inaturalist.org/" target="_blank" rel="noopener">iNaturalist</a> (CC0, CC BY, CC BY-SA), Wikimedia Commons — auteur et licence sur chaque point';

/** Room between a point and its card. @param {{ gap?: number }} o */
const gap = o => o.gap ?? 8;

/**
 * Plant: its photo in a circle ringed with its abundance colour (a leaf until / unless a photo is known). Selected,
 * larger (it bounces in); `kin`: the same plant as the one selected, elsewhere — lit too.
 * @param {PlantMarker} plant @param {boolean} selected @param {boolean} draggable @param {boolean} [kin]
 */
function plantIcon(plant, selected, draggable, kin = false) {
  const color = PIN_COLORS[plant.abundance] || PIN_COLORS.moyen;
  const url = plant.plantId ? cachedThumb(plant.plantId) : null;
  const classes = ['gf-plant', url ? 'photo' : '', selected ? 'selected' : '', kin && !selected ? 'kin' : '', plant.season ? 'season' : '', draggable ? 'draggable' : ''].join(' ');
  if (url) {
    const ring = elem('span', 'ring');
    ring.style.setProperty('--c', color);
    // Its leaf first, the photo once it has loaded.
    ring.append(leafGlyph(), fadeImg(url, { decoding: 'async' }));
    const size = selected ? 50 : 34;
    return L.divIcon({ className: classes, iconSize: [size, size], iconAnchor: [size / 2, size / 2], html: ring });
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

/** What a plant marker looks like: drawn again only when this changes (a selection then bounces once, not at every render). @param {PlantMarker} plant @param {boolean} selected @param {boolean} draggable @param {boolean} kin */
const plantLook = (plant, selected, draggable, kin) =>
  [plant.plantId ? cachedThumb(plant.plantId) || '' : '', selected, draggable, kin && !selected, plant.season, plant.abundance].join('|');

/**
 * @typedef {object} PlantMarker
 * @property {string} key          unique: placeId + ':' + entryId
 * @property {string} placeId
 * @property {string} [entryId]    the occurrence (a place may hold the same plant several times)
 * @property {number | null} plantId
 * @property {string} [sci]        its scientific name: lit with the observations of the same species
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
    overlays: overlays.filter(isOverlay),
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
 *  - selectedPlant: highlighted plant marker key — or keys (an array: a plant's occurrences; the other plants unchanged)
 *  - draggablePlants: plant markers can be dragged (place editor)
 *  - pinDraggable: the place pin can be dragged and long-press emits map-longpress (default true)
 *  - track: show the live GPS position
 *  - fit: zoom to the content on first data
 *  - area: {center, radius, points?, fit?, photo?} — a circle (metres) and observation dots inside it ("Autour"); `fit`: the
 *    view frames the circle, whatever the map's size (again when it is resized); `photo`: the points are one plant's,
 *    each shows its photo
 *  Plants' points (observations, the plant chosen's, the plants of places), hovered or touched, light their kin: the
 *  other points of the same plant. A plant selected lights its other markers (in other places) too. The other points
 *  never change: only the plant aimed at and its occurrences are set off.
 *  - frame: {key, points, bottom?} — zoom once on these [lon, lat] points (again when the key changes);
 *    `bottom` is the share of the height kept free below them (e.g. for a sheet)
 *  - search (default on; `no-search` removes it): address search pill on top, with the ▦ "Carte" panel button;
 *    legend (default on): legend in the panel
 *  - no-create: the point card (long press) has no "Créer un endroit ici"
 *  - editable: the ✎ control (always shown) switches position editing on. While `editing`, every marker
 *    (places, plants, the pin) is dragged freely; each drop (or long press: place the pin / selected place)
 *    emits positions-save with that one move, for the caller to store at once. « Terminé » or ✎ ends it.
 * Events: spot-select {id}, plant-select {placeId, entryId, plantId}, pin-move {coordinates},
 *         plant-move {placeId, entryId, plantId, coordinates}, map-longpress {coordinates} (while the pin can be placed),
 *         point-info {coordinates} (long press elsewhere: the point card opens), point-close,
 *         edit-change {editing}, positions-save {pin, places: [{id, coordinates}], plants: [{placeId, entryId, plantId, coordinates}]}
 */
export class GfMap extends LitElement {
  static properties = {
    /** A point (observation, occurrence) clicked: 'open' its record (default), 'pick' (a `point-pick` event), 'none'. */
    pointClick: { attribute: 'point-click' },
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
    /** An area's outline to draw ({ key, feature }: a GeoJSON Feature), dashed, lightly filled. */
    zone: { attribute: false },
    /** Points grouped when they are close at the zoom shown ({ key, points: { coordinates, title, url? }[], photo? }): `photo` shows on the plant chosen's (kind 'hl'). */
    cluster: { attribute: false },
    /** Over the area: where one plant was observed ({ key, points: { coordinates, title, date? }[], photo?, common?, sci?, taxonId? }), its photo in each, large (Découvrir). */
    highlight: { attribute: false },
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
    /** A point to show and fly to (a value touched in the plant sheet): { coordinates, title, url?, photo? } (the plant's photo on it). */
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
    /** No « protected areas in view » notice (also under any element marked `no-areas`: Découvrir). */
    noAreas: { type: Boolean, attribute: 'no-areas' },
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
    /** @type {{ key: string, points: { coordinates: [number, number], title: string }[] } | null} */
    this.highlight = null;
    /** @type {{ key: string, feature: any } | null} */
    this.zone = null;
    /** @type {{ key: string, points: { coordinates: [number, number], title: string, url?: string }[] } | null} */
    this.cluster = null;
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
    this.noAreas = false;
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
      <span class="what">${icon('shield-check')} ${shown.map((a, i) => html`${i ? ' · ' : ''}${safeUrl(a.url)
        ? html`<a href=${safeUrl(a.url)} target="_blank" rel="noopener" title=${a.kind}>${a.name}</a>` : html`<b title=${a.kind}>${a.name}</b>`}
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

  /** Marked (or inside something marked) `no-areas`: the discovery screens show no zone alerts. */
  #quietAreas() {
    /** @type {Node | null} */ let n = this;
    while (n) {
      if (n instanceof Element && n.hasAttribute('no-areas')) return true;
      n = n.parentNode || (n instanceof ShadowRoot ? n.host : null);
    }
    return false;
  }

  async #checkAreas() {
    const map = this.#map;
    this.#areasAbort?.abort();
    this.#areasAbort = null;
    if (!map || !map.getSize().x || map.getZoom() < PROTECTED_ZOOM || !moduleOn('ignProtected') || this.#quietAreas()) {
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
      plants: what.plant ? [{ placeId: plant?.placeId, entryId: plant?.entryId, plantId: plant?.plantId ?? null, coordinates: what.plant.coordinates }] : []
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

  /** The point touched in the sheet: the plant's photo, large (a ringed dot without one), named; the map flies to it. */
  #syncFocusPoint() {
    const layer = this.#focusLayer;
    if (!layer || !this.#map) return;
    const p = /** @type {any} */ (this.focusPoint);
    // The same point again (a caller's new object, at each render): left as it is — no bounce, no flight back to it.
    const key = p ? [p.coordinates.join(), p.title, p.photo || ''].join('|') : '';
    if (key === this.#focusKey && layer.getLayers().length) return;
    this.#focusKey = key;
    layer.clearLayers();
    if (!p) return;
    const [x, y] = p.coordinates;
    const dot = p.photo
      ? L.marker([y, x], { icon: chosenIcon(p.photo, 0, 46, 'focus'), keyboard: false, bubblingMouseEvents: false, zIndexOffset: 2000 }).addTo(layer)
      : L.circleMarker([y, x], { radius: 9, className: 'gf-focus-point', bubblingMouseEvents: false }).addTo(layer);
    // A node, not a string: Leaflet sets a string as innerHTML, and the title comes from the user's places (a
    // shared link's names) or from GBIF records.
    // Above the point; on a low map (a pinned block), below it — the filter's chip is over the map's top.
    const low = this.#map.getSize().y < 260;
    dot.bindTooltip(elem('span', '', p.title), { direction: low ? 'bottom' : 'top', permanent: true, className: 'gf-focus-tip', offset: p.photo ? [0, low ? 22 : -22] : [0, 0] });
    this.#onPoint(dot, p);
    if (this.#map.getSize().x) this.#map.flyTo([y, x], Math.max(this.#map.getZoom(), 11), { duration: 0.6 });
  }

  #focusKey = '';

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
  /** @type {ResizeObserver | null} */ #resized = null;

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
      // Its size is followed by the ResizeObserver below (a window listener per map would outlive the element).
      trackResize: false,
      attributionControl: true,
      tapHold: true,
      maxZoom: 21,
      minZoom: this.minZoom
    });
    map.attributionControl.setPrefix(false);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

    if (this.base && this.base in BASES) this.#base = /** @type {'photo' | 'plan'} */ (this.base);
    if (this.overlays) this.#overlays = this.overlays.filter(isOverlay);
    this.#layer(this.#base).addTo(map);
    for (const key of this.#overlays) this.#layer(key).addTo(map);

    this.#areaLayer = L.layerGroup().addTo(map);
    this.#pointsLayer = L.layerGroup().addTo(map);
    this.#focusLayer = L.layerGroup().addTo(map);
    this.#hlLayer = L.layerGroup().addTo(map);
    this.#zoneLayer = L.layerGroup().addTo(map);
    this.#clusterLayer = L.layerGroup().addTo(map);
    this.#spotLayer = L.layerGroup().addTo(map);
    this.#plantLayer = L.layerGroup();
    // A zoom under way (a flight to a zone): the groups wait for its end, made once at the zoom reached.
    map.on('zoomstart', () => { this.#zooming = true; });
    map.on('zoomend', () => { this.#zooming = false; this.#syncPlantVisibility(); this.#syncCluster(true); });
    // A flight stopped short (a drag) ends without a zoomend.
    map.on('moveend', () => { if (this.#zooming) { this.#zooming = false; this.#syncCluster(true); } });
    // The plants' little cards float above everything (the map's buttons and panels, the page's around it).
    const tip = this.#floatTip = Object.assign(document.createElement('div'), { className: 'gf-float-tip', role: 'tooltip' });
    if ('popover' in tip) tip.popover = 'manual';
    root.append(tip);
    map.on('movestart zoomstart click', () => this.#hideTip());
    // A touch on the map lets go of the plant lit (a touch screen has no « mouse out »); with a mouse, leaving the map.
    map.on('click zoomstart', () => this.#light(null));
    map.getContainer().addEventListener('mouseleave', () => { if (!matchMedia('(hover: none)').matches) this.#light(null); });

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
    // The element may have been laid out after Leaflet measured it. Let go while the element is out of the page.
    this.#resized = new ResizeObserver(() => {
      map.invalidateSize();
      // Resized by hand (a pane's separator dragged): the view stays as the user left it.
      if (performance.now() < this.#holdUntil) return;
      this.#applyFrame();
      // Resized (a column coming beside it): framed again on what it was last framed on — the area's circle, or
      // the frame given.
      if (this.#lastFit === 'frame' && this.#framedBounds) map.fitBounds(this.#framedBounds, { paddingTopLeft: [40, 56], paddingBottomRight: [40, 40], maxZoom: this.#framedMax, animate: false });
      else this.#fitArea();
      if (this.fit && !this.#fitted) this.#fitToContent();
    });
    this.#resized.observe(this.#root);
    this.#syncAll();
  }

  /** @param {Map<string, any>} changed */
  updated(changed) {
    if (!this.#map) return;
    if (changed.has('base') && this.base && this.base !== this.#base) this.#setBase(/** @type {any} */ (this.base));
    if (changed.has('overlays') && this.overlays) {
      for (const key of new Set([...Object.keys(OVERLAYS), ...addedLayers(), ...this.#overlays])) {
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
    // Another way to answer a click: the points drawn again with it.
    else if (changed.has('pointClick') && changed.get('pointClick') !== undefined) this.#syncArea();
    if (changed.has('pointClick') && changed.get('pointClick') !== undefined && !changed.has('cluster')) { this.#clusterKey = ''; this.#syncCluster(); }
    if (changed.has('highlight')) this.#syncHighlight();
    if (changed.has('zone')) this.#syncZone();
    // Framed first: a flight starting, the groups are made at its end (at the zoom reached), not here.
    const framed = changed.has('frame') && this.#applyFrame();
    if (changed.has('cluster')) this.#syncCluster();
    if (changed.has('area') || changed.has('highlight') || changed.has('cluster')) this.#photoCredit();
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
    if (this.#map) { this.#resized?.observe(this.#root); this.#syncTracking(); }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    moduleEvents.removeEventListener('change', this.#onModules);
    this.#resized?.disconnect();
    clearTimeout(this.#areasTimer);
    this.#areasAbort?.abort();
    this.#unwatch?.();
    this.#unwatch = null;
    this.#unwait?.();
    this.#unwait = null;
  }

  #syncAll() {
    this.#syncSpots();
    this.#syncPin();
    this.#syncPlants();
    this.#syncTracking();
    this.#syncArea();
    this.#syncHighlight();
    this.#syncZone();
    this.#syncCluster();
    this.#syncPoints();
    this.#photoCredit();
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
      this.#tip(dot, point.title);
      this.#onPoint(dot, point);
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
      // Drawn again only when its look changes: a place selected bounces once, not at every render.
      const look = [selected, movable, spot.properties.plants.length, placeAbundance(spot), appStore.state.harvestMode && inSeason(spot)].join('|');
      let marker = this.#markers.get(spot.id);
      if (!marker) {
        marker = L.marker([lat, lon], { icon: pinIcon(spot, selected, movable), title: placeTitle(spot), keyboard: true, riseOnHover: true, draggable: movable, autoPan: movable })
          .on('click', () => { if (!this.editing) this.#emit('spot-select', { id: spot.id }); });
        /** @type {any} */ (marker).gfLook = look;
        const id = spot.id;
        marker.on('dragend', () => {
          const { lat: y, lng: x } = /** @type {L.Marker} */ (this.#markers.get(id)).getLatLng();
          this.#drop(m => m.places.set(id, [x, y]), { place: { id, coordinates: [x, y] } });
        });
        this.#trackDrag(marker).addTo(layer);
        this.#markers.set(spot.id, marker);
      } else if (!this.#dragging.has(marker)) {
        marker.setLatLng([lat, lon]);
        if (/** @type {any} */ (marker).gfLook !== look) marker.setIcon(pinIcon(spot, selected, movable));
        /** @type {any} */ (marker).gfLook = look;
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

  /** @param {string} key */
  #isSelected(key) { return Array.isArray(this.selectedPlant) ? this.selectedPlant.includes(key) : key === this.selectedPlant; }

  #syncPlants() {
    const layer = /** @type {L.LayerGroup} */ (this.#plantLayer);
    // The plants selected: the other markers of the same plants (elsewhere, in other places) are lit too.
    const chosen = new Set(this.plants.filter(p => p.plantId != null && this.#isSelected(p.key)).map(p => p.plantId));
    const seen = new Set();
    for (const plant of this.plants) {
      seen.add(plant.key);
      const [lon, lat] = this.#plantAt(plant);
      const selected = this.#isSelected(plant.key);
      const movable = this.#plantMovable(plant);
      const kin = plant.plantId != null && chosen.has(plant.plantId);
      const look = plantLook(plant, selected, movable, kin);
      let marker = this.#plantMarkers.get(plant.key);
      if (!marker) {
        marker = L.marker([lat, lon], {
          icon: plantIcon(plant, selected, movable, kin),
          title: plant.label,
          keyboard: true,
          riseOnHover: true,
          draggable: movable,
          autoPan: movable
        });
        const current = plant;
        marker.on('click', () => { if (!this.editing) this.#emit('plant-select', { placeId: current.placeId, entryId: current.entryId, plantId: current.plantId }); });
        marker.on('dragend', () => {
          const { lat: y, lng: x } = /** @type {L.Marker} */ (this.#plantMarkers.get(current.key)).getLatLng();
          if (this.editable) this.#drop(m => m.plants.set(current.key, [x, y]), { plant: { key: current.key, coordinates: [x, y] } });
          else this.#emit('plant-move', { placeId: current.placeId, entryId: current.entryId, plantId: current.plantId, coordinates: [x, y] });
        });
        // Hovered (touched): the other markers of the same plant are lit with it (and its observations around).
        this.#kin(marker, speciesKey(plant) || (plant.plantId != null ? 'p:' + plant.plantId : null));
        this.#trackDrag(marker).addTo(layer);
        this.#plantMarkers.set(plant.key, marker);
        /** @type {any} */ (marker).gfLook = look;
      } else if (!this.#dragging.has(marker)) {
        marker.setLatLng([lat, lon]);
        if (/** @type {any} */ (marker).gfLook !== look) marker.setIcon(plantIcon(plant, selected, movable, kin));
        /** @type {any} */ (marker).gfLook = look;
      }
      marker.setZIndexOffset(selected ? 1200 : kin ? 900 : 500);
    }
    for (const [key, marker] of this.#plantMarkers) {
      if (seen.has(key)) continue;
      // Out of the group too, or it would come back when the plant layer is shown again.
      layer.removeLayer(marker);
      this.#plantMarkers.delete(key);
    }
    this.#syncPlantVisibility();
    this.#relight();
  }

  /** Once a plant's photo URL is known, its markers are redrawn with it. @param {number} plantId */
  async #loadThumb(plantId) {
    const url = await thumbUrl(plantId);
    if (!url || !this.isConnected) return;
    const chosen = new Set(this.plants.filter(p => p.plantId != null && this.#isSelected(p.key)).map(p => p.plantId));
    for (const plant of this.plants) {
      if (plant.plantId !== plantId) continue;
      const marker = this.#plantMarkers.get(plant.key);
      if (!marker || this.#dragging.has(marker)) continue;
      const selected = this.#isSelected(plant.key), movable = this.#plantMovable(plant), kin = chosen.has(plantId);
      marker.setIcon(plantIcon(plant, selected, movable, kin));
      /** @type {any} */ (marker).gfLook = plantLook(plant, selected, movable, kin);
    }
    this.#relight();
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

  /** « Me localiser » was touched: the position may be asked for. */
  #asked = false;
  /** @type {(() => void) | null} */ #unwait = null;

  /** `track` shows my position once the permission is granted (or after « Me localiser »): never asked on its own. */
  #syncTracking() {
    if (this.track && !this.#unwatch) {
      if (this.#asked) { this.#unwait?.(); this.#unwait = null; this.#unwatch = watchLocation(({ fix }) => this.#showFix(fix)); }
      else this.#unwait ??= whenGranted(() => { this.#unwait = null; this.#asked = true; if (this.isConnected) this.#syncTracking(); });
    } else if (!this.track && (this.#unwatch || this.#unwait)) {
      this.#unwatch?.();
      this.#unwatch = null;
      this.#unwait?.();
      this.#unwait = null;
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
  /** The room kept free last framed (area.inset). */
  #areaInset = 'null';

  #syncArea() {
    const layer = /** @type {L.LayerGroup} */ (this.#areaLayer);
    layer.clearLayers();
    const area = this.area;
    if (!area) return;
    const [lon, lat] = area.center;
    // `leaves`: the observations as small leaves popping in one after the other, the circle glowing (Découvrir).
    const fancy = Boolean(area.leaves);
    // Its shadow: the same circle, darker, a little lower (a still line — no filter to redraw at each move).
    L.circle([lat, lon], { radius: area.radius, className: 'gf-perim-shadow', interactive: false }).addTo(layer);
    const circle = L.circle([lat, lon], { radius: area.radius, className: fancy ? 'gf-area gf-area-glow' : 'gf-area', interactive: false }).addTo(layer);
    const bounds = area.fit ? circle.getBounds() : null;
    // The same circle again (the points arrived): no move; another one: the view eases to it (the old tiles
    // glide while the new ones come; the page gives the map a background of its colour, no pale flash).
    const inset = JSON.stringify(/** @type {any} */ (area).inset || null);
    const moved = bounds && (!(this.#areaBounds && this.#areaBounds.equals(bounds, 1e-9)) || inset !== this.#areaInset);
    const first = !this.#areaBounds;
    this.#areaBounds = bounds;
    this.#areaInset = inset;
    if (moved) this.#fitArea(!first);
    // `photo`: the observations are of one plant chosen (the species picked « Autour »): each shows its photo, large.
    const chosen = /** @type {any} */ (area).photo;
    for (const [i, point] of (area.points || []).entries()) {
      const [x, y] = point.coordinates;
      const p = /** @type {any} */ (point);
      const dot = fancy
        ? L.marker([y, x], { icon: p.photo ? photoIcon(p.photo, Math.min(i, 40) * 25) : leafIcon(Math.min(i, 40) * 25), keyboard: false, bubblingMouseEvents: false }).addTo(layer)
        : chosen ? L.marker([y, x], { icon: chosenIcon(chosen, Math.min(i, 30) * 25, this.#chosenSize(40)), keyboard: false, bubblingMouseEvents: false, riseOnHover: true }).addTo(layer)
        : L.circleMarker([y, x], { radius: 6, className: 'gf-obs', bubblingMouseEvents: false }).addTo(layer);
      // With a photo: a small card of the plant on hover (a first touch, on a touch screen); else its name.
      if (fancy && (p.photo || p.sci)) this.#tip(dot, () => obsCard(p), { card: true, gap: 6 });
      else if (chosen) this.#tip(dot, () => obsCard({ ...p, photo: chosen, credit: /** @type {any} */ (area).credit }), { card: true, gap: 6 });
      else this.#tip(dot, point.title);
      this.#onPoint(dot, point);
      // Hovered (touched): the other points of the same plant are lit with it.
      this.#kin(dot, speciesKey(p) || (fancy ? null : 'area'));
    }
    this.#relight();
  }

  /** @type {HTMLElement | null} */ #floatTip = null;
  /** @type {L.Layer | null} */ #tipOwner = null;

  /**
   * A point's little card (or its name), floating above all the rest — the top layer where the browser has it, so no
   * button, panel or bar of the map (or of the page) covers it. Hover shows it; on a touch screen, a touch (another
   * touch on the map hides it).
   * @param {L.Layer} dot @param {string | (() => Node)} content plain text, or the card's builder (called at each show: its
   *   photo is fetched when the card shows) @param {{ card?: boolean, gap?: number }} [o]
   */
  #tip(dot, content, o = {}) {
    const show = () => this.#showTip(dot, content, o);
    /** @type {any} */ (dot).gfTip = true;
    // A touch shows the card; a second one, while it shows, does what a click does (#onPoint: 'gf-again').
    if (matchMedia('(hover: none)').matches) dot.on('click', () => { const again = this.#tipOwner === dot; show(); if (again) dot.fire('gf-again'); });
    else { dot.on('mouseover', show); dot.on('mouseout', () => this.#hideTip(dot)); }
    dot.on('remove', () => this.#hideTip(dot));
  }

  /** @param {L.Layer} dot @param {string | (() => Node)} content @param {{ card?: boolean, gap?: number }} o */
  #showTip(dot, content, o) {
    const tip = this.#floatTip;
    const el = /** @type {any} */ (dot).getElement?.();
    if (!tip || !el) return;
    this.#tipOwner = dot;
    tip.className = 'gf-float-tip' + (o.card ? ' card' : '');
    if (typeof content === 'function') tip.replaceChildren(content()); else tip.textContent = content;
    if (/** @type {any} */ (dot).gfAgain) (tip.querySelector('.gf-obs-card .t') || tip).append(elem('small', 'again', 'Touchez encore pour ouvrir l’observation'));
    // Its photo arriving changes nothing (fixed size), but placed again once there, to be sure.
    tip.querySelector('img')?.addEventListener('load', () => { if (this.#tipOwner === dot) this.#placeTip(el, gap(o)); }, { once: true });
    try { if (tip.popover && !tip.matches(':popover-open')) tip.showPopover(); } catch { /* not connected */ }
    tip.classList.add('on');
    this.#placeTip(el, gap(o));
  }

  /** Above its point (below it when there is no room), within the window. @param {Element} el @param {number} g */
  #placeTip(el, g) {
    const tip = /** @type {HTMLElement} */ (this.#floatTip);
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    const left = Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2));
    let top = r.top - h - g;
    if (top < 6) top = r.bottom + g;
    tip.style.left = left + 'px';
    tip.style.top = Math.max(6, Math.min(innerHeight - h - 6, top)) + 'px';
  }

  /** @param {L.Layer} [dot] only if it is that point's */
  #hideTip(dot) {
    const tip = this.#floatTip;
    if (!tip || (dot && this.#tipOwner !== dot)) return;
    this.#tipOwner = null;
    tip.classList.remove('on');
    try { if (tip.popover && tip.matches(':popover-open')) tip.hidePopover(); } catch { /* closed */ }
  }

  /**
   * A plant's point: hovered (touched, on a touch screen), it is lit and so are the other points of the same plant
   * — its kin, wherever they are on the map: observations, the plant chosen's, the plants of places —; the other
   * points stay as they are. A touch elsewhere on the map, or leaving it, lets go.
   * @param {L.Layer} layer @param {string | null} key the plant (speciesKey, 'p:' + plant id, 'hl', 'area')
   */
  #kin(layer, key) {
    if (!key) return;
    /** @type {any} */ (layer).gfKin = key;
    if (matchMedia('(hover: none)').matches) layer.on('click', () => this.#light(key, layer));
    else { layer.on('mouseover', () => this.#light(key, layer)); layer.on('mouseout', () => this.#light(null)); }
    layer.on('remove', () => { if (this.#litBy === layer) this.#light(null); });
  }

  /** The elements lit now. @type {Element[]} */ #lit = [];
  /** @type {L.Layer | null} */ #litBy = null;
  /** The plant lit now (its kin key). @type {string | null} */ #litKey = null;

  /** Lights one plant's points (null: none), `origin` the most. @param {string | null} key @param {L.Layer} [origin] */
  #light(key, origin) {
    for (const el of this.#lit) el.classList.remove('gf-kin', 'gf-kin-self');
    this.#lit = [];
    this.#litKey = key;
    this.#litBy = key && origin ? origin : null;
    const map = this.#map;
    if (!map) return;
    if (key) {
      const groups = [this.#areaLayer, this.#hlLayer, this.#clusterLayer, this.#spreadLayer];
      /** @type {any[]} */
      const layers = groups.flatMap(g => g ? g.getLayers() : []);
      if (this.#plantLayer && map.hasLayer(this.#plantLayer)) layers.push(...this.#plantMarkers.values());
      // Only those in sight (a wide scope has hundreds out of it): fewer elements restyled.
      const view = map.getBounds().pad(0.2);
      for (const l of layers) {
        if (l.gfKin !== key || (l.getLatLng && !view.contains(l.getLatLng()))) continue;
        const el = l.getElement?.();
        if (el) { el.classList.add('gf-kin'); this.#lit.push(el); }
      }
      const self = /** @type {any} */ (origin)?.getElement?.();
      if (self) { self.classList.add('gf-kin-self'); if (!this.#lit.includes(self)) this.#lit.push(self); }
    }
  }

  /** Points drawn again (a new icon has its own classes): the plant lit stays lit, its new points with it. */
  #relight() { if (this.#litKey) this.#light(this.#litKey, this.#litBy ?? undefined); }

  /**
   * Plant photos on the points (iNaturalist's under a free licence, the flora's thumbnails): their sources named in
   * the map's attribution while they are shown; each point's card gives its author and licence.
   */
  #photoCredit() {
    const map = this.#map;
    if (!map) return;
    const a = /** @type {any} */ (this.area), h = /** @type {any} */ (this.highlight), c = /** @type {any} */ (this.cluster);
    const shown = moduleOn('photos') && Boolean(a?.photo || h?.photo || c?.photo
      || a?.points?.some((/** @type {any} */ p) => p.photo) || h?.points?.some((/** @type {any} */ p) => p.photo));
    if (shown === this.#photoCredited) return;
    this.#photoCredited = shown;
    if (shown) map.attributionControl.addAttribution(PHOTO_CREDIT);
    else map.attributionControl.removeAttribution(PHOTO_CREDIT);
  }
  #photoCredited = false;

  /**
   * A point clicked, as `point-click` says: its record opened in a new tab (on a touch screen, at a second touch
   * when the point has a card), a `point-pick` event (the page shows that plant: Découvrir), or nothing (its tooltip
   * only).
   * @param {L.Layer} dot @param {any} p
   */
  #onPoint(dot, p) {
    const how = this.pointClick || 'open';
    if (how === 'none') return;
    if (how === 'pick') { dot.on('click', () => this.dispatchEvent(new CustomEvent('point-pick', { detail: { point: p }, bubbles: true, composed: true }))); return; }
    if (!p.url) return;
    // On a touch screen, a point with a card: the first touch shows it (and lights its kin), the second opens the
    // record — not the app left at once.
    const again = /** @type {any} */ (dot).gfTip && matchMedia('(hover: none)').matches;
    /** @type {any} */ (dot).gfAgain = again;
    dot.on(again ? 'gf-again' : 'click', () => open(p.url, '_blank', 'noopener'));
  }

  /** @type {L.LatLngBounds | null} */ #areaBounds = null;
  /** @type {L.LayerGroup | null} */ #hlLayer = null;
  /** @type {L.LayerGroup | null} */ #zoneLayer = null;
  /** @type {L.LayerGroup | null} */ #clusterLayer = null;
  #zoneKey = '';
  #clusterKey = '';

  /** @type {L.LayerGroup | null} */ #spreadLayer = null;
  /** A zoom under way (zoomstart → zoomend): groups wait for its end. */
  #zooming = false;

  /**
   * A group's points spread around it, each on a thread to its place: a dot of its source's colour, its card on
   * hover, its record on a touch. A touch on the map, or a zoom, gathers them back.
   * @param {L.LatLng} at @param {{ coordinates: [number, number], title: string, url?: string }[]} pts @param {string} kind
   * @param {string | null} [photo] the plant chosen's: each of its points shows it
   * @param {{ common?: string, sci?: string, taxonId?: number } | null} [who] the plant chosen (its card's names, its kin)
   */
  #spread(at, pts, kind, photo = null, who = null) {
    const map = /** @type {L.Map} */ (this.#map);
    this.#gather();
    const layer = this.#spreadLayer = L.layerGroup().addTo(map);
    const c = map.latLngToLayerPoint(at);
    const list = pts.slice(0, 60);
    // A circle for a few, a spiral for more.
    list.forEach((p, i) => {
      const n = list.length;
      const angle = n <= 10 ? (i / n) * Math.PI * 2 - Math.PI / 2 : i * 0.75;
      const r = n <= 10 ? 34 + n * 3 : 26 + i * 4.2;
      const spot = map.layerPointToLatLng(L.point(c.x + r * Math.cos(angle), c.y + r * Math.sin(angle)));
      L.polyline([at, spot], { className: 'gf-spread-thread', interactive: false }).addTo(layer);
      const dot = photo
        ? L.marker(spot, { icon: chosenIcon(photo, Math.min(i, 30) * 15, 30), keyboard: false, bubblingMouseEvents: false, riseOnHover: true, zIndexOffset: 1000 }).addTo(layer)
        : L.circleMarker(spot, { radius: 7, className: 'gf-occ gf-occ-' + (/** @type {any} */ (p).kind || kind), bubblingMouseEvents: false }).addTo(layer);
      const q = /** @type {any} */ (p);
      if (photo) this.#tip(dot, () => obsCard({ ...q, photo, common: who?.common, sci: who?.sci, credit: /** @type {any} */ (who)?.credit }), { card: true, gap: 6 });
      else if (q.photo || q.sci) this.#tip(dot, () => obsCard(q), { card: true });
      else this.#tip(dot, p.title);
      this.#onPoint(dot, p);
      this.#kin(dot, photo ? speciesKey(who) || 'hl' : null);
    });
    L.circleMarker(at, { radius: 5, className: 'gf-spread-center', interactive: false }).addTo(layer);
    map.once('click zoomstart', () => this.#gather());
    this.#relight();
  }

  /** The points spread gathered back into their group. */
  #gather() {
    this.#spreadLayer?.remove();
    this.#spreadLayer = null;
  }

  /**
   * The outline of the area touched (a département, a région, France): a perimeter, like the circle — its border
   * only, light green, under the points. A FeatureCollection may give its border as lines (`properties.part: 'line'`:
   * several shapes as one, their shared borders not drawn; a 'fill' part is not shown).
   */
  #syncZone() {
    const layer = this.#zoneLayer, z = this.zone;
    if (!layer) return;
    const key = z?.key || '';
    if (key === this.#zoneKey) return;
    this.#zoneKey = key;
    layer.clearLayers();
    if (!z?.feature) return;
    const part = (/** @type {any} */ f) => f?.properties?.part;
    // Its shadow first (the border only, darker, a little lower), then the zone.
    L.geoJSON(z.feature, { interactive: false, filter: f => part(f) !== 'fill', style: { className: 'gf-perim-shadow' } }).addTo(layer);
    L.geoJSON(z.feature, { interactive: false, style: f => ({ className: 'gf-zone' + (part(f) === 'fill' ? ' gf-zone-fill' : part(f) === 'line' ? ' gf-zone-line' : '') }) }).addTo(layer);
  }

  /**
   * The points given, grouped by the screen cell they fall in at this zoom: alone, a dot (its record on a touch);
   * together, a disc with their number, larger for more (a touch zooms in on them). Grouped again at each zoom.
   * @param {boolean} [rezoom]
   */
  #syncCluster(rezoom = false) {
    const map = this.#map, layer = this.#clusterLayer, c = this.cluster;
    if (!map || !layer) return;
    // A zoom under way (a flight to the zone chosen): grouped once, at its end (zoomend), at the zoom reached — not
    // here, at the zoom it leaves (hundreds of points alone there, each drawn and bouncing for nothing).
    if (this.#zooming && !rezoom) { layer.clearLayers(); this.#gather(); this.#clusterKey = ''; return; }
    const key = (c?.key || '') + ':' + map.getZoom();
    if (key === this.#clusterKey && !rezoom) return;
    // The same points again at another zoom: drawn at once, without their entrance (it played when they came).
    const still = c?.key && this.#clusterKey.startsWith(c.key + ':') ? ' still' : '';
    this.#clusterKey = key;
    layer.clearLayers();
    this.#gather();
    if (!c?.points.length || !map.getSize().x) return;
    // Cells of ~70 px: a few clear groups rather than many small ones.
    const CELL = 72, zoom = map.getZoom();
    /** @type {Map<string, { pts: typeof c.points, x: number, y: number }>} */
    const cells = new Map();
    for (const p of c.points) {
      const px = map.project([p.coordinates[1], p.coordinates[0]], zoom);
      // Each source grouped apart: its colour stays seen beside the others.
      const id = (/** @type {any} */ (p).kind || 'occ') + ':' + Math.floor(px.x / CELL) + ':' + Math.floor(px.y / CELL);
      const cell = cells.get(id) || { pts: [], x: 0, y: 0 };
      cell.pts.push(p); cell.x += px.x; cell.y += px.y;
      cells.set(id, cell);
    }
    // The plant chosen (Découvrir, a wider scope): its names on its points' cards; its kin key, the same as its
    // points in the circle (they light together).
    const who = /** @type {any} */ (c);
    const hlKin = speciesKey(who) || 'hl';
    // Its points alone get its photo while they are few; past that, dots (hundreds of images and bounces weigh).
    const singles = [...cells.values()].filter(cell => cell.pts.length === 1 && /** @type {any} */ (cell.pts[0]).kind === 'hl').length;
    for (const cell of cells.values()) {
      const n = cell.pts.length;
      const at = map.unproject([cell.x / n, cell.y / n], zoom);
      // The plant chosen's points: its photo, alone or on the group with their number.
      const photo = /** @type {any} */ (cell.pts[0]).kind === 'hl' ? who.photo || null : null;
      if (n === 1) {
        const p = cell.pts[0];
        const kind = /** @type {any} */ (p).kind || 'occ';
        const dot = photo && singles <= PHOTO_SINGLES
          ? L.marker([p.coordinates[1], p.coordinates[0]], { icon: chosenIcon(photo, 0, 34, still), keyboard: false, bubblingMouseEvents: false, riseOnHover: true, zIndexOffset: 1000 }).addTo(layer)
          : L.circleMarker([p.coordinates[1], p.coordinates[0]], { radius: 6, className: 'gf-occ gf-occ-' + kind, bubblingMouseEvents: false }).addTo(layer);
        if (photo) this.#tip(dot, () => obsCard({ .../** @type {any} */ (p), photo, common: who.common, sci: who.sci, credit: who.credit }), { card: true, gap: 6 });
        else this.#tip(dot, p.title);
        this.#onPoint(dot, p);
        this.#kin(dot, kind === 'hl' ? hlKin : null);
        continue;
      }
      const size = Math.round(Math.min(54, 26 + Math.log2(n) * 6));
      const kind = /** @type {any} */ (cell.pts[0]).kind || 'occ';
      const m = L.marker(at, {
        icon: photo ? chosenGroupIcon(photo, n, size, Boolean(still))
          : L.divIcon({ className: 'gf-occ-group gf-occ-group-' + kind + still, iconSize: [size, size], iconAnchor: [size / 2, size / 2], html: `<span>${n > 999 ? Math.round(n / 1000) + 'k' : n}</span>` }),
        keyboard: true, bubblingMouseEvents: false, title: `${n} points — toucher pour zoomer`, riseOnHover: true,
        // The plant chosen's groups above the others' (and the larger above the smaller: their number stays seen).
        zIndexOffset: photo ? 1000 + Math.min(n, 999) : 0
      }).addTo(layer);
      this.#kin(m, kind === 'hl' ? hlKin : null);
      // A touch: its points, spread around it (a large group: zoomed in on first).
      m.on('click', () => {
        const b = L.latLngBounds(cell.pts.map(p => [p.coordinates[1], p.coordinates[0]]));
        if (n > SPREAD_MAX && !b.getNorthEast().equals(b.getSouthWest()) && map.getZoom() < 17) { map.flyToBounds(b, { padding: [40, 40], duration: 0.5, maxZoom: 17 }); return; }
        this.#spread(at, cell.pts, kind, photo, photo ? who : null);
      });
    }
    this.#relight();
  }
  #hlKey = '';

  /**
   * The size of the plant chosen's photos: a little smaller on a small map (a phone's band), large elsewhere — still
   * well above the other points (30 px). @param {number} large
   */
  #chosenSize(large) { const w = this.#map?.getSize().x || 0; return w && w < 520 ? Math.max(40, Math.round(large * 0.9)) : large; }

  /**
   * One plant's observations over the area: its photo in each, large, bouncing in one after the other (its leaf
   * without a photo); the other points stay as they are. Hovered, a small card of it (its date); its kin lit with it.
   */
  #syncHighlight() {
    const layer = this.#hlLayer, hl = /** @type {any} */ (this.highlight);
    if (!layer) return;
    const key = hl ? hl.key + ':' + hl.points.length + ':' + (hl.photo || '') : '';
    if (key === this.#hlKey) return;
    this.#hlKey = key;
    layer.clearLayers();
    const kin = speciesKey(hl) || 'hl';
    for (const [i, point] of (hl?.points || []).entries()) {
      const [x, y] = point.coordinates;
      const p = /** @type {any} */ (point);
      const photo = p.photo || hl.photo || null;
      const dot = L.marker([y, x], { icon: chosenIcon(photo, Math.min(i, 30) * 30, this.#chosenSize(44)), keyboard: false, bubblingMouseEvents: false, zIndexOffset: 1000, riseOnHover: true }).addTo(layer);
      if (photo || hl.sci) this.#tip(dot, () => obsCard({ title: point.title, common: hl.common, sci: hl.sci, photo, credit: p.photo ? p.credit : hl.credit, date: p.date }), { card: true, gap: 6 });
      else this.#tip(dot, point.title, { gap: 4 });
      this.#kin(dot, kin);
    }
    this.#relight();
  }

  /** What the map was framed on last: the area's circle, or the frame given (framed again on a resize). */
  /** @type {'area' | 'frame' | null} */ #lastFit = null;
  /** @type {L.LatLngBounds | null} */ #framedBounds = null;
  /** The zoom the last frame may not exceed (kept for refits on resize: a single point never zooms to the max). */
  #framedMax = 18;

  /** The circle framed (area.fit), with a margin; `ease`: a short zoom animation. @param {boolean} [ease] */
  #fitArea(ease = false) {
    const map = this.#map, b = this.#areaBounds;
    if (!map || !b || !map.getSize().x) return;
    this.#lastFit = 'area';
    // area.inset: room kept free of the circle (a panel over the map: its height below, its width on the right).
    const inset = /** @type {any} */ (this.area)?.inset || {};
    map.fitBounds(b, { paddingTopLeft: [16, 16], paddingBottomRight: [16 + (inset.right || 0), 16 + (inset.bottom || 0)], animate: ease });
  }

  /** For a moment, a change of size keeps the view as it is (no framing again): a pane beside it resized by hand. */
  holdFrame() { this.#holdUntil = performance.now() + 1500; }
  #holdUntil = 0;

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
    this.#lastFit = 'frame';
    this.#framedBounds = bounds;
    const opts = { paddingTopLeft: /** @type {[number, number]} */ ([40, 56]), paddingBottomRight: /** @type {[number, number]} */ ([40, 40 + bottom]), maxZoom: /** @type {any} */ (frame).maxZoom || (single ? 18 : 19) };
    this.#framedMax = opts.maxZoom;
    // Eased: from the view shown to the next one, smoothly (an area touched in the sheet, and back).
    if (/** @type {any} */ (frame).ease && !matchMedia('(prefers-reduced-motion: reduce)').matches) { map.flyToBounds(bounds, { ...opts, duration: 0.8 }); return true; }
    map.fitBounds(bounds, { ...opts, animate: false });
    if (!/** @type {any} */ (frame).maxZoom && map.getZoom() < PLANT_ZOOM && bounds.getNorthEast().distanceTo(bounds.getSouthWest()) < 300) {
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
    this.#asked = true;
    if (!this.track) {
      this.track = true;
    } else this.#syncTracking();
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
      panel.addEventListener('overlay-toggle', (/** @type {any} */ e) => {
        // A layer of IGN's whole catalogue: known from now on (kept, for this map and the next ones).
        const key = e.detail.layer ? addCatalogLayer(e.detail.layer) : e.detail.key;
        this.#setOverlay(key, e.detail.on);
      });
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
    if (!isOverlay(key)) return;
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
