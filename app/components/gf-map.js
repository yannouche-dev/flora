// @ts-check
// Leaflet map on IGN imagery. Rendered in light DOM so Leaflet's global CSS and events just work.

import { LitElement, html, nothing, render } from 'lit';
import * as L from 'leaflet';
import { config } from '../config.js';
import { geoProblem, watchLocation, whenGranted } from '../core/geo.js';
import { DEFAULT_OPACITY, FRANCE_BOUNDS, isOverlay, overlayDef, tileLayer } from '../core/ign.js';
import { isBaseKey } from '../core/backgrounds.js';
import { lookFor, mapDistribution, mapLookEvents, setMapDistribution, setMapLook } from '../core/map-settings.js';
import { inSeason, placeAbundance, placeTitle } from '../core/collections.js';
import { store as appStore } from '../core/store.js';
import { cachedThumb, thumbUrl } from '../core/thumb.js';
import { moduleEvents, moduleOn } from '../core/modules.js';
import { protectedAreasIn } from '../core/protected.js';
import { href } from '../core/router.js';
import { briefToast, sayIn } from '../core/toast.js';
import { takeHint } from '../core/hints.js';
import { gbifTileUrl } from '../core/sources.js';
import { readJSON, writeJSON } from '../core/prefs.js';
import './gf-map-panel.js';
import './gf-map-search.js';
import './gf-point-card.js';
import { attachGl } from './gf-map-gl.js';
import { icon, iconHref, iconMarkup } from '../core/icons.js';
import { inMiniApp } from '../miniapp/quiet-links.js';
import { cancelImages, chosenGroupMarker, chosenMarker, elem, fadeImg, leafGlyph, leafMarker, markClasses, obsCard, photoMarker, resumeImages, ringElement, speciesKey } from './map-style.js';

/** @typedef {import('./map-style.js').MarkerSpec} MarkerSpec */

const STYLESHEETS = [
  new URL('../../vendor/leaflet.css', import.meta.url).href,
  new URL('../styles/map.css', import.meta.url).href
];

/** A plant's ring, by its abundance (gf-map3d.js too). */
export const PIN_COLORS = { rare: '#fb7185', moyen: '#fbbf24', abondant: '#38bdf8' };

/** Plants are drawn from this zoom level on (places are always drawn). */
export const PLANT_ZOOM = 16;
/** From this zoom on (a few km across), maps say which protected areas are in view. */
export const PROTECTED_ZOOM = 11;

/**
 * A background put under every other tile layer: each of its layers, the top one first (a year's photos, then the
 * most recent ones greyed under them). @param {L.Layer} layer
 */
function toBack(layer) {
  const layers = layer instanceof L.LayerGroup ? layer.getLayers() : [layer];
  for (const l of layers.reverse()) /** @type {L.GridLayer} */ (l).bringToBack();
}

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

/** A marker of the map style (map-style.js: renderer-agnostic) as a Leaflet icon, anchored at its middle. @param {MarkerSpec} d */
const divIcon = d => L.divIcon({ className: d.className, iconSize: d.size, iconAnchor: [d.size[0] / 2, d.size[1] / 2], html: d.html });
/** @param {number} delay */
const leafIcon = delay => divIcon(leafMarker(delay));
/** @param {string} photo @param {number} delay */
const photoIcon = (photo, delay) => divIcon(photoMarker(photo, delay));
/** @param {string | null | undefined} photo @param {number} delay @param {number} [size] @param {string} [extra] */
const chosenIcon = (photo, delay, size, extra) => divIcon(chosenMarker(photo, delay, size, extra));
/** @param {string | null} photo @param {number} n @param {number} size @param {boolean} [still] */
const chosenGroupIcon = (photo, n, size, still) => divIcon(chosenGroupMarker(photo, n, size, still));

/** The photos still loading in a layer group's markers stop (map-style.js#cancelImages). @param {L.LayerGroup} group */
const cancelLayerImages = group => { for (const l of group.getLayers()) { const el = /** @type {any} */ (l).getElement?.(); if (el) cancelImages(el); } };

/**
 * @typedef {{ center: string, latlng: L.LatLng, target: number, ring: { x: number, y: number, r: number } | null,
 *   points: any[] | null, dots: Map<string, L.Layer> }} SmoothArea
 */

/** Leaf glyph for plant markers. */
/** A plant without a photo: a flower (Bootstrap Icons) in its circle. */
const FLOWER = `<svg x="5" y="5" width="12" height="12" viewBox="0 0 16 16" fill="#fff"><use href="${iconHref('flower1')}"></use></svg>`;

/** Past this many points, a group touched is zoomed in on before its points are spread. */
const SPREAD_MAX = 24;
/** The 2D compass's words (MapLibre's own in 3D: core/maplibre.js). */
const NORTH = 'Revenir au nord';
/**
 * Up to this many points of the plant chosen alone in sight, each comes in with its bounce; past it, they are there at
 * once (hundreds of bounces weigh). Their photo either way.
 */
const PHOTO_SINGLES = 40;
/** Around the view, the share of it (each side) where a point alone is its photo marker; further, a dot until seen. */
const SIGHT_PAD = 0.5;

/**
 * A view as a page writes it down (layout/map-options.js viewText: 5 decimals, its zoom to 2, its tilt and turn in
 * whole degrees), as a key. @param {{ lat: number, lon: number, zoom: number, pitch?: number, bearing?: number }} v
 */
const viewKey = v => {
  const round = (/** @type {number} */ n, /** @type {number} */ d) => Math.round(n * 10 ** d) / 10 ** d;
  return [round(v.lat, 5), round(v.lon, 5), round(v.zoom, 2), Math.round(v.pitch || 0), Math.round(v.bearing || 0)].join(':');
};
/** The map's attribution while plant photos are on its points (#photoCredit). */
const PHOTO_CREDIT = 'Photos : <a href="https://www.inaturalist.org/" target="_blank" rel="noopener">iNaturalist</a> (CC0, CC BY, CC BY-SA), Wikimedia Commons — auteur et licence sur chaque point';

/**
 * A line of a map's state (setStatus): its key, its words, how much it matters, a link to act on it.
 * @typedef {{ key: string, text: string, level: 'info' | 'warn' | 'error', link: { href: string, label: string } | null }} MapStatus
 * A line of a map's legend (setLegend): its words, its swatch — 'obs' (a plant's points: its pink and gold ring),
 * 'outline' (an area's border), or a CSS colour.
 * @typedef {{ text: string, swatch?: string }} LegendLine
 */

/** A load said (a thin line at the map's top, its words in the live region) only past this long (ms). */
const BUSY_AFTER = 400;
/** The same words said by any map within this long (ms) are not said again. */
const SAID_FOR = 8000;
/** When each thing was said last, by any map. @type {Map<string, number>} */
const recentlySaid = new Map();
/** States said once a visit whatever the map (setStatus `once`: a device's, a setting's). @type {Set<string>} */
const saidOnce = new Set();

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
 *    each shows its photo; `smooth` with `ring` ({x, y, r}, px): the circle still on the screen, the map zooming under it
 *    to the distance, the points kept in place (`loading`: dimmed) — the games' step « map »
 *  Plants' points (observations, the plant chosen's, the plants of places), hovered or touched, light their kin: the
 *  other points of the same plant. A plant selected lights its other markers (in other places) too. The other points
 *  never change: only the plant aimed at and its occurrences are set off.
 *  - frame: {key, points, bottom?} — zoom once on these [lon, lat] points (again when the key changes);
 *    `bottom` is the share of the height kept free below them (e.g. for a sheet)
 *  - search (default on; `no-search` removes it): address search pill on top, with the ▦ "Carte" panel button;
 *    legend (default on): legend in the panel
 *  - look: its own look (a Partial<MapLook> of core/map-settings.js: background — core/backgrounds.js: the plan, the
 *    photos, those of a year or a period over the most recent ones greyed, SPOT's images of a year —, overlays, their
 *    opacity), kept by its owner; null (the default): the maps' common look, followed as it changes (here, on another
 *    map, in Réglages, in another tab). Each field given is its own, the others the common ones. Its panel ▦ changes the common look, or —
 *    the map having its own — its own, told by `look-change`.
 *  - no-create: the point card (long press) has no "Créer un endroit ici"
 *  - editable: the ✎ control (always shown) switches position editing on. While `editing`, every marker
 *    (places, plants, the pin) is dragged freely; each drop (or long press: place the pin / selected place)
 *    emits positions-save with that one move, for the caller to store at once. « Terminé » or ✎ ends it.
 * Events: spot-select {id}, plant-select {placeId, entryId, plantId}, pin-move {coordinates},
 *         plant-move {placeId, entryId, plantId, coordinates}, map-longpress {coordinates} (while the pin can be placed),
 *         point-info {coordinates, label?} (long press elsewhere, a place picked in its search: the point card opens), point-close,
 *         view-change {lat, lon, zoom, pitch, bearing, bounds} (the map moved by hand: its centre, zoom, in 3D its tilt and
 *         turn, and what it shows: bounds()), view-framed {bounds} (framed by itself: on its area — bounds null — or on
 *         the view given),
 *         point-hover {point | null} (a point of its area under the mouse, then none: never on a touch screen),
 *         edit-change {editing}, positions-save {pin, places: [{id, coordinates}], plants: [{placeId, entryId, plantId, coordinates}]},
 *         look-change {look} (its own look changed on it, its panel's or its opacity card's: for its owner to keep and give
 *         back; null: « Revenir aux réglages communs »), renderer-follow (« Suivre le réglage commun »: the 2D or 3D its
 *         owner fixed — own3d — let go), base-shown {base}
 *
 * What a map says — the quiet-map rule, for every map of the app (this one, its 3D mirror gf-map-gl.js and its
 * « Observations autour » gf-map-obs3d.js, and every page around a map): nothing persistent is written over the map
 * (no banner, note, pill or count over its canvas); what is worth knowing goes where the user looks for it, through
 * this one mechanism —
 *  - setStatus(key, text, { level, link, once }): a lasting state (« IGN – fonds de carte » off, the 3D back to 2D and
 *    why, flat for lack of relief, protected areas in view, a background source unreachable…): one line in the « État »
 *    of the panel « Carte » (its Affichage), said once in the map's live region — again only when its words change;
 *    '' lets it go;
 *  - announce(text): said once in the map's one live region (visually hidden, polite: a count that arrived, a point
 *    flown to, a save done); the same words said by any map a moment ago are not said again;
 *  - toast(text): an action the user has just taken on the map failed (« Me localiser » refused, a search without a
 *    result, a point whose plant is not there): one brief toast over the map's top (core/toast.js: under 3 s, the top
 *    layer, never two at once), said too. Never for a background failure (a tile source, iNaturalist, the relief);
 *  - busy(key, on, label): a load under way: past 400 ms, a thin line at the map's top (no text), its label said once;
 *  - setLegend(lines): what the colours of a page's own layers mean (a plant sheet's map), in the panel's « Légende ».
 * Its own parts (the search pill, the point card) say theirs by the events map-say {text}, map-toast {text} and
 * map-busy {key, on, label}. A gesture worth knowing is a first-use hint (core/hints.js: once per device,
 * dismissible), and stays in the controls' title and aria. Kept on the map: the credits (the attribution, small) and
 * the controls (zoom, compass, layers, Me localiser, ✎, the radius chip, « Observations autour »).
 */
export class GfMap extends LitElement {
  static properties = {
    /** A point (observation, occurrence) clicked: 'open' its record (default), 'pick' (a `point-pick` event), 'none'. */
    pointClick: { attribute: 'point-click' },
    /**
     * The points of a plant lit from outside the map (a list's row hovered beside it, a free layout's): their kin keys
     * (map-style.js speciesKey), lit as the map's own hover lights them; null: none.
     */
    litKeys: { attribute: false },
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
    /**
     * One plant's points, grouped when they are close at the zoom shown ({ key, points: { coordinates, title, url?, date?,
     * place?, source? }[], photo?, credit?, common?, sci?, taxonId? }): its observations in a wider scope (Découvrir),
     * those of its sheet's map (iNaturalist's and GBIF's around me, GBIF's in an area touched) — each the plant chosen's
     * marker, its photo (a leaf without one), whatever its source.
     */
    cluster: { attribute: false },
    /** Over the area: where one plant was observed ({ key, points: { coordinates, title, date? }[], photo?, common?, sci?, taxonId? }), its photo in each, large (Découvrir). */
    highlight: { attribute: false },
    remember: { type: Boolean },
    /** Its address search (the `search` attribute only says whether it is shown: map.css). */
    search: { type: Boolean, attribute: false },
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
    /**
     * Its own look (core/map-settings.js: a Partial<MapLook>, each field given replacing the common one), kept by its
     * owner (`look-change`); null: the maps' common look, followed.
     */
    look: { attribute: false },
    /** Its map-3d (on or off) is its owner's choice (a free layout's 3d=): its panel offers to let it go (`renderer-follow`). */
    own3d: { type: Boolean, attribute: false },
    /**
     * Why its own look is its owner's to keep (a free layout's intent: map(protege), its layers): said in its panel in
     * place of « Revenir aux réglages communs ». '': none, the way back offered.
     */
    lookWhy: { type: String, attribute: false },
    /**
     * Its « Observations autour » in 3D (gf-map-obs3d.js: { on, radius, inat, gbif, density }), kept by its owner
     * (`around3d-change` with them) rather than on the device. null: the device's, for its page.
     */
    around3d: { attribute: false },
    /** The view it starts on ({ lat, lon, zoom, pitch?, bearing? }), rather than framed on its area; null: framed. */
    view: { attribute: false },
    /**
     * Observations drawn as tiles over everything but the markers ({ key, url, minZoom?, maxZoom?, opacity }[]: a free
     * layout's map of France or of the world, iNaturalist's squares and points); null: none.
     */
    tiles: { attribute: false },
    /** Points drawn as small circles: [{ coordinates, title, url?, kind? }] (kind 'start': a walk's start, dark). Never an observation: those are the plants' markers (area, highlight, cluster). */
    points: { attribute: false },
    /** The point card's « Créer un endroit ici » makes a place with this plant already in it. */
    createPlant: { type: Number, attribute: 'create-plant' },
    /** How far out the map can go (5: France; 1: the world). */
    minZoom: { type: Number, attribute: 'min-zoom' },
    /** No « Me localiser » button. */
    noLocate: { type: Boolean, attribute: 'no-locate' },
    /** No button for the panel « Carte » (round, or at the end of the search pill): a free layout's map without it (ctl=). */
    noLayers: { type: Boolean, attribute: false },
    /**
     * A handle on the area's circle (its east edge) that changes its radius: dragged (the circle follows, the distance
     * in a bubble, `radius-input` {radius} meanwhile), let go — or a key on it — `radius-change` {radius}. Given:
     * { snap(m): the radius a distance dragged gives, step(key, m): the one a key gives (null: not its key),
     * label(m): the distance in words }. null: none.
     */
    radiusHandle: { attribute: false },
    /** No « protected areas in view » notice (also under any element marked `no-areas`: Découvrir). */
    noAreas: { type: Boolean, attribute: 'no-areas' },
    /** A walk to draw ({ key, coordinates: [lon, lat][] }): a line on a white casing (the « Vue 3D » of a parcours). */
    line: { attribute: false },
    _moves: { state: true }
  };

  constructor() {
    super();
    /** @type {import('../core/collections.js').Place[]} */
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
    /** How a point clicked answers (none given: its record opened, nothing inside a mini-app). @type {'open' | 'pick' | 'none' | null} */
    this.pointClick = null;
    /** @type {Set<string> | null} */
    this.litKeys = null;
    /** @type {{ key: string, feature: any } | null} */
    this.zone = null;
    /** @type {{ key: string, points: { coordinates: [number, number], title: string, url?: string }[], photo?: string | null } | null} */
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
    /** @type {Partial<import('../core/map-settings.js').MapLook> | null} */
    this.look = null;
    this.own3d = false;
    this.lookWhy = '';
    /** @type {import('../core/around3d.js').Around3dPrefs | null} */
    this.around3d = null;
    /** @type {{ lat: number, lon: number, zoom: number, pitch?: number, bearing?: number } | null} */
    this.view = null;
    /** @type {{ key: string, url: string, minZoom?: number, maxZoom?: number, opacity: number }[] | null} */
    this.tiles = null;
    /** @type {{ coordinates: [number, number], title: string, url?: string, kind?: string }[]} */
    this.points = [];
    /** @type {number | null} */
    this.createPlant = null;
    this.noLocate = false;
    this.noLayers = false;
    /** @type {{ snap: (m: number) => number, step: (key: string, m: number) => number | null, label: (m: number) => string } | null} */
    this.radiusHandle = null;
    this.noAreas = false;
    /** @type {{ key: string, coordinates: [number, number][] } | null} */
    this.line = null;
    this.minZoom = 5;
    this.noSearch = false;
    this.editable = false;
    this.editing = false;
    /** Working copy while editing positions. */
    this._moves = emptyMoves();
    // Its own parts say what they have to say through the map (its search pill, its point card).
    this.addEventListener('map-say', e => { e.stopPropagation(); this.announce(/** @type {CustomEvent} */ (e).detail?.text); });
    this.addEventListener('map-toast', e => { e.stopPropagation(); this.toast(/** @type {CustomEvent} */ (e).detail?.text); });
    this.addEventListener('map-busy', e => {
      e.stopPropagation();
      const d = /** @type {CustomEvent} */ (e).detail || {};
      this.busy(d.key, Boolean(d.on), d.label);
    });
  }

  createRenderRoot() { return this; }

  /** How positions are moved here, by what the map holds: the editing bar's first-use hint, said as editing starts. */
  get #editWords() {
    return (this.pin || this.selectedId ? 'Glissez le lieu ou ses plantes · appui long : placer le lieu'
      : this.spots.length ? 'Glissez les lieux et les plantes (en zoomant)' : 'Glissez les plantes')
      + ' — enregistré dès que vous lâchez';
  }

  /** The editing bar's hint shows: the first time ever positions are edited on this device (core/hints.js), until its ✕. */
  #editHint = false;

  // Lit owns this one wrapper; Leaflet and the map buttons live inside it, out of Lit's way
  // (anything appended straight to the host would be cleared by Lit's next render).
  render() {
    // The frame goes full screen while editing positions: in the browser's top layer (popover), so no
    // ancestor (a pane with `contain`, the header, the tab bar) can clip or cover it. Over the map, besides its
    // controls: its thin loading line (no text) and, unseen, its one live region.
    return html`<div class="gf-map-frame" popover="manual"><div class="gf-map-root"></div>
      <div class="gf-map-busy" aria-hidden="true"></div>
      <div class="gf-map-live" aria-live="polite" aria-relevant="additions"></div>
      ${this.editing ? html`<div class="gf-map-editbar" role="group" aria-label="Modifier les positions">
        ${this.#editHint ? html`<span class="hint">${this.#editWords}<button type="button" class="hint-x" aria-label="Masquer l’astuce"
          title="Masquer l’astuce" @click=${() => { this.#editHint = false; this.requestUpdate(); }}>${icon('x-lg')}</button></span>` : nothing}
        <span class="actions">
          <button type="button" class="primary" title=${this.#editWords} @click=${() => this.#setEditing(false)}>Terminé</button>
        </span>
      </div>` : nothing}</div>`;
  }

  // ── What the map says (the quiet-map rule: see the class's comment) ────────────────────────────

  /** @type {Map<string, MapStatus>} */ #status = new Map();

  /**
   * A lasting state of the map (one line per key): in the panel's « État », said once in the live region — again
   * only when its words change (`once`: once a visit, whatever the map — a device's or a setting's state, else said
   * at each map's birth; `quiet`: never said). '' or null lets it go.
   * @param {string} key @param {string | null | undefined} text
   * @param {{ level?: 'info' | 'warn' | 'error', link?: { href: string, label: string } | null, once?: boolean, quiet?: boolean }} [o]
   */
  setStatus(key, text, o = {}) {
    const was = this.#status.get(key);
    if (!text) {
      if (!was) return;
      this.#status.delete(key);
      this.#syncState();
      return;
    }
    const level = o.level || 'info';
    if (was && was.text === text && was.level === level) return;
    this.#status.set(key, { key, text, level, link: o.link || null });
    this.#syncState();
    if (o.quiet || (o.once && saidOnce.has(text))) return;
    saidOnce.add(text);
    this.announce(text);
  }

  /** The map's state now: its panel's « État » (and the tests). @returns {MapStatus[]} */
  get statusLines() { return [...this.#status.values()]; }

  /** Said before the live region was drawn. @type {string[]} */
  #unsaid = [];

  /**
   * Said once in the map's live region (polite, visually hidden: a line added, gone after a while); the same words
   * said by any map a moment ago are not said again (a page of four maps, a restyle, a render) — unless `force` (an
   * action the user just took that failed again: they must hear it each time, #toast). While the map's panel is open
   * (a modal dialog: the rest of the page, this region too, is inert), said by the panel's own region instead.
   * @param {string | null | undefined} text @param {{ force?: boolean }} [o]
   */
  announce(text, { force = false } = {}) {
    if (!text) return;
    const live = /** @type {HTMLElement | null} */ (this.querySelector('.gf-map-live'));
    if (!live) { this.#unsaid.push(text); return; }
    const now = performance.now();
    if (!force && (recentlySaid.get(text) ?? -Infinity) > now - SAID_FOR) return;
    recentlySaid.set(text, now);
    if (this.#panel?.say?.(text)) return;
    sayIn(live, text);
  }

  /**
   * An action the user has just taken on the map failed: one brief toast over its top (under the search pill), said
   * too (core/toast.js) — each time it shows (the same failure again: said again). Never for a background failure:
   * setStatus.
   * @param {string | null | undefined} text
   */
  toast(text) {
    if (!text) return;
    const shown = briefToast(text, { near: this.querySelector('.gf-map-frame') || this, at: 'top', offset: this.#hasSearch && !this.editing ? 62 : 10, live: false });
    this.announce(text, { force: Boolean(shown) });
  }

  /** The loads under way, each with what it says once it lasts. @type {Map<string, string>} */ #busy = new Map();
  /** @type {ReturnType<typeof setTimeout> | undefined} */ #busyTimer;

  /**
   * A load under way (`key`), or done: past 400 ms, a thin line at the map's top (no text), its `label` said once;
   * aria-busy on the map meanwhile. Nothing at all for a quicker one.
   * @param {string} key @param {boolean} on @param {string} [label]
   */
  busy(key, on, label = '') {
    if (!key || on === this.#busy.has(key)) return;
    if (on) this.#busy.set(key, label); else this.#busy.delete(key);
    const frame = this.querySelector('.gf-map-frame');
    if (!this.#busy.size) {
      clearTimeout(this.#busyTimer);
      this.#busyTimer = undefined;
      this.removeAttribute('busy');
      frame?.removeAttribute('aria-busy');
      return;
    }
    frame?.setAttribute('aria-busy', 'true');
    if (this.hasAttribute('busy')) { if (on && label) this.announce(label); return; }
    if (this.#busyTimer !== undefined) return;
    this.#busyTimer = setTimeout(() => {
      this.#busyTimer = undefined;
      if (!this.#busy.size) return;
      this.setAttribute('busy', '');
      for (const said of new Set(this.#busy.values())) if (said) this.announce(said);
    }, BUSY_AFTER);
  }

  /** What the colours of a page's own layers mean (a plant sheet's map: its sources, their counts). @type {LegendLine[]} */
  #legendLines = [];

  /** The panel's « Légende » for this page's layers (its colour, its words). @param {LegendLine[]} lines */
  setLegend(lines) {
    const next = lines || [];
    if (JSON.stringify(next) === JSON.stringify(this.#legendLines)) return;
    this.#legendLines = next;
    if (this.#panel) this.#panel.legendLines = next;
  }

  /** The panel (once opened) and the layers button follow the state and the protected areas in view. */
  #syncState() {
    const areas = this.editing ? [] : this.#areas;
    if (this.#panel) Object.assign(this.#panel, { state: this.statusLines, areas });
    // The layers button: a discreet dot while protected areas are in view (their rules in the panel), said in its name.
    const flag = areas.length ? `${areas.length > 1 ? 'espaces protégés' : 'espace protégé'} en vue` : '';
    const layers = this.#buttons?.querySelector('.layers');
    if (layers) {
      const label = 'Carte : fond, couches, légende' + (flag ? ' — ' + flag : '');
      layers.classList.toggle('flag', Boolean(flag));
      layers.setAttribute('aria-label', label);
      layers.setAttribute('title', label);
    }
    const search = /** @type {any} */ (this.querySelector('gf-map-search'));
    if (search) search.flag = flag;
  }

  // ── Protected areas ────────────────────────────────────────────────────────────────────────────

  /** Protected areas in view (« IGN – espaces protégés »): listed in the panel (« Règles de cueillette »). @type {import('../core/protected.js').ProtectedArea[]} */
  #areas = [];

  /** @param {import('../core/protected.js').ProtectedArea[]} areas */
  #setAreas(areas) {
    const key = (/** @type {import('../core/protected.js').ProtectedArea[]} */ list) => list.map(a => a.id).sort().join(',');
    if (key(areas) === key(this.#areas)) return;
    this.#areas = areas;
    // One État line, said once per new set (none while positions are edited: #checkAreas).
    const names = areas.slice(0, 2).map(a => a.name).join(', ') + (areas.length > 2 ? ` et ${areas.length - 2} autre${areas.length > 3 ? 's' : ''}` : '');
    this.setStatus('areas', areas.length
      ? `${areas.length > 1 ? 'Espaces protégés' : 'Espace protégé'} en vue : ${names} — la cueillette y est souvent interdite ou réglementée (voir Règles de cueillette).`
      : '', { level: 'warn' });
    this.#syncState();
  }

  /** « IGN – fonds de carte » off: the backgrounds from the cache only — said in the panel, never over the map. @param {boolean} [birth] */
  #syncIgn(birth = false) {
    this.setStatus('ign', moduleOn('ignMaps') ? '' : 'Fonds IGN désactivés : seules les zones déjà vues s’affichent.',
      { link: { href: href.settings(), label: 'Réglages › Modules' }, once: birth });
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
    // (Not while positions are edited: said again once it ends.)
    if (!map || !map.getSize().x || map.getZoom() < PROTECTED_ZOOM || !moduleOn('ignProtected') || this.#quietAreas() || this.editing) {
      this.#setAreas([]);
      return;
    }
    const abort = this.#areasAbort = new AbortController();
    const b = map.getBounds();
    try {
      const areas = await protectedAreasIn({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, abort.signal);
      if (abort.signal.aborted) return;
      this.#setAreas(this.editing ? [] : areas);
    } catch (error) {
      if (!abort.signal.aborted) this.#setAreas([]);
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
    this.#syncIgn();
    this.#scheduleAreas();
    const map = this.#map;
    if (!map) return;
    for (const layer of Object.values(this.#layers)) layer.remove();
    this.#layers = {};
    toBack(this.#layer(this.#base).addTo(map));
    for (const key of this.#overlays) this.#layer(key).addTo(map);
    this.#restack();
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

  /** The tile layers given (`tiles`), each by its key: one whose address changed made again, those gone taken off. @type {Map<string, L.TileLayer>} */
  #tileLayers = new Map();

  #syncTiles() {
    const map = this.#map;
    if (!map) return;
    const want = new Map((this.tiles ?? []).map(t => [t.key, t]));
    for (const [key, layer] of this.#tileLayers) {
      if (/** @type {any} */ (layer).gfUrl === want.get(key)?.url) continue;
      layer.remove();
      this.#tileLayers.delete(key);
    }
    let z = 22;
    for (const [key, t] of want) {
      z++;
      if (this.#tileLayers.has(key)) continue;
      const layer = L.tileLayer(t.url, {
        attribution: 'Observations : <a href="https://www.inaturalist.org/" target="_blank" rel="noopener">iNaturalist</a>',
        opacity: t.opacity, crossOrigin: 'anonymous', minZoom: t.minZoom ?? 0, maxZoom: t.maxZoom ?? 21, maxNativeZoom: 18, zIndex: z, className: 'gf-tiles-obs gf-tiles-obs-' + key
      });
      /** @type {any} */ (layer).gfUrl = t.url;
      this.#tileLayers.set(key, layer.addTo(map));
    }
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

  /**
   * The point touched in the sheet: the plant's photo, large (a ringed dot without one); the map flies to it, its name
   * said once. Its name on hover, focus or a touch (its card), never a label left over the map: the chip that set it
   * (the sheet's, the cell's) names it already.
   */
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
    // Its name: the marker's title (a photo) and its card on hover, focus or touch (#tip: text, never HTML — the
    // title comes from the user's places, a shared link's names, or GBIF records).
    const dot = p.photo
      ? L.marker([y, x], { icon: chosenIcon(p.photo, 0, 46, 'focus'), keyboard: false, bubblingMouseEvents: false, zIndexOffset: 2000, title: p.title }).addTo(layer)
      : L.circleMarker([y, x], { radius: 9, className: 'gf-focus-point', bubblingMouseEvents: false }).addTo(layer);
    this.#tip(dot, p.title, { gap: 6 });
    this.#onPoint(dot, p);
    if (this.#map.getSize().x) { this.#selfMove(); this.#map.flyTo([y, x], Math.max(this.#map.getZoom(), 11), { duration: 0.6 }); }
    this.announce(`Sur la carte : ${p.title}`);
  }

  #focusKey = '';

  get #root() { return /** @type {HTMLElement} */ (this.querySelector('.gf-map-root')); }

  /** @type {L.Map | null} */ #map = null;
  /** @type {Record<string, L.Layer>} */ #layers = {};
  /** Its own look as it shows it: its owner's (`look`), with the changes made on it since (told by `look-change`). @type {Partial<import('../core/map-settings.js').MapLook> | null} */
  #own = null;
  /** What it shows: the background, the overlays (in their order), their opacity — its own look over the common one. */
  #base = /** @type {import('../core/backgrounds.js').BaseKey} */ ('photo');
  /** @type {string[]} */ #overlays = [];
  /** @type {Record<string, number>} */ #opacities = {};
  #distributionOn = mapDistribution();
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
    // The compass under + −, as MapLibre draws them in 3D (its own there): in 2D the north is always up — the needle
    // still, touched, the map already to the north. First: the lowest of the corner.
    const compass = new L.Control({ position: 'bottomleft' });
    compass.onAdd = () => {
      const bar = L.DomUtil.create('div', 'leaflet-bar gf-compass-bar');
      const a = L.DomUtil.create('a', 'gf-compass', bar);
      Object.assign(a, { href: '#', title: NORTH });
      a.setAttribute('role', 'button');
      a.setAttribute('aria-label', NORTH);
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(a, 'click', L.DomEvent.preventDefault);
      return bar;
    };
    compass.addTo(map);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

    this.#own = this.look;
    const look = lookFor(this.#own);
    this.#base = look.base;
    this.#overlays = look.overlays.filter(isOverlay);
    this.#opacities = look.opacities;
    this.#layer(this.#base).addTo(map);
    for (const key of this.#overlays) this.#layer(key).addTo(map);
    this.#restack();

    this.#areaLayer = L.layerGroup().addTo(map);
    this.#pointsLayer = L.layerGroup().addTo(map);
    this.#focusLayer = L.layerGroup().addTo(map);
    this.#hlLayer = L.layerGroup().addTo(map);
    this.#zoneLayer = L.layerGroup().addTo(map);
    this.#clusterLayer = L.layerGroup().addTo(map);
    this.#spotLayer = L.layerGroup().addTo(map);
    this.#plantLayer = L.layerGroup();
    // A zoom under way (a flight to a zone): the groups wait for its end, made once at the zoom reached. (The 3D map's
    // view given to this one — gf-map-gl.js: any fraction of a zoom — is no flight: its groups stay while the zoom,
    // rounded, is the same.)
    map.on('zoomstart', () => { if (!this.#gl?.mirroring) this.#zooming = true; });
    map.on('zoomend', () => { this.#zooming = false; this.#syncPlantVisibility(); this.#syncCluster(true); });
    // A flight stopped short (a drag) ends without a zoomend.
    // A move ended: the points alone it brings in sight become their photo marker (#nearCluster).
    map.on('moveend', () => { if (this.#zooming) { this.#zooming = false; this.#syncCluster(true); } else this.#nearCluster(); });
    // The plants' little cards float above everything (the map's buttons and panels, the page's around it).
    const tip = this.#floatTip = Object.assign(document.createElement('div'), { className: 'gf-float-tip', role: 'tooltip' });
    if ('popover' in tip) tip.popover = 'manual';
    root.append(tip);
    map.on('movestart zoomstart click', () => this.#hideTip());
    // A touch on the map lets go of the plant lit (a touch screen has no « mouse out »); with a mouse, leaving the map.
    map.on('click zoomstart', () => this.#light(null));
    map.getContainer().addEventListener('mouseleave', () => { if (!matchMedia('(hover: none)').matches) this.#light(null); });

    const view = this.remember ? readJSON(config.storageKeys.mapView, null) : null;
    if (this.view) this.#applyView();
    else if (view) map.setView([view.lat, view.lng], view.zoom);
    else map.fitBounds(FRANCE_BOUNDS);

    // Moved by hand (a drag, the wheel, a pinch, the keys, the zoom's buttons — not a control of its own over it): once
    // it rests, its view told (view-change). What the map moves itself (framing its area, a flight) is never told.
    const byHand = (/** @type {Event} */ e) => {
      const t = /** @type {Element | null} */ (e.target instanceof Element ? e.target : null);
      if (t?.closest('.gf-map-buttons, .gf-map-search, gf-map-panel, gf-point-card, .gf-o3-bar, .gf-handle, input, textarea, select')) return;
      this.#handAt = performance.now();
    };
    for (const type of ['pointerdown', 'wheel', 'keydown', 'touchstart']) root.addEventListener(type, byHand, { passive: true, capture: true });
    root.addEventListener('gl-moveend', () => this.#movedByHand());
    map.on('moveend', () => this.#movedByHand());
    // A plant lit from outside (litKeys): its points come into sight as the map moves, lit too.
    map.on('moveend', () => { if (this.litKeys?.size) this.#lightFrom(); });

    map.on('moveend', () => {
      this.#scheduleAreas();
      if (!this.remember) return;
      const center = map.getCenter();
      writeJSON(config.storageKeys.mapView, { lat: center.lat, lng: center.lng, zoom: map.getZoom() });
    });
    map.on('dragstart', () => { this.#setFollow(false); cancelAnimationFrame(this.#tween); this.#tween = 0; });
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
      if (this.#lastFit === 'frame' && this.#framedBounds) {
        this.#selfMove();
        map.fitBounds(this.#framedBounds, { paddingTopLeft: [40, 56], paddingBottomRight: [40, 40], maxZoom: this.#framedMax, animate: false });
      // On the view it was given (vue=): it stays there — showing more of it, or less.
      } else if (this.#lastFit === 'view') { if (map.getSize().x) this.#emit('view-framed', { bounds: this.bounds() }); }
      else this.#fitArea();
      if (this.fit && !this.#fitted) this.#fitToContent();
    });
    this.#resized.observe(this.#root);
    this.#syncAll();
    if (this.line) this.#syncLine();
    // What it had to say before its live region was there; « IGN – fonds de carte » off, said once a visit.
    for (const text of this.#unsaid.splice(0)) this.announce(text);
    this.#syncIgn(true);
    // 3D (Réglages › Cartes): MapLibre over this map, which it mirrors (gf-map-gl.js).
    this.#gl = attachGl(this, map);
  }

  /** @type {L.LayerGroup | null} */ #lineLayer = null;
  #lineKey = '';

  /** The walk: a pink line on a white casing (by their options: the same in 2D and, mirrored, in 3D). */
  #syncLine() {
    const map = this.#map, l = /** @type {any} */ (this.line);
    if (!map) return;
    const key = l ? l.key + ':' + l.coordinates.length : '';
    if (key === this.#lineKey) return;
    this.#lineKey = key;
    this.#lineLayer ??= L.layerGroup().addTo(map);
    this.#lineLayer.clearLayers();
    if (!l || l.coordinates.length < 2) return;
    const at = l.coordinates.map((/** @type {[number, number]} */ [x, y]) => [y, x]);
    L.polyline(at, { color: '#ffffff', weight: 7, opacity: 0.9, interactive: false, className: 'gf-walk-casing' }).addTo(this.#lineLayer);
    L.polyline(at, { color: '#e0245e', weight: 3.5, opacity: 1, interactive: false, className: 'gf-walk' }).addTo(this.#lineLayer);
  }

  /** The 3D adapter of this map (gf-map-gl.js): null before the map exists. @type {import('./gf-map-gl.js').GlView | null} */
  #gl = null;
  get gl() { return this.#gl; }

  /** The user's plants drawn by the map itself now (from plantZoom on): the 3D map's observations around leave them out then. */
  get plantsShown() { return Boolean(this.#plantLayer && this.#map?.hasLayer(this.#plantLayer)); }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    // Editing starts: its hint the first time ever (core/hints.js); it ends: the hint goes.
    if (changed.has('editing') && this.editing !== Boolean(changed.get('editing'))) this.#editHint = this.editing && takeHint('map-edit');
  }

  /** @param {Map<string, any>} changed */
  updated(changed) {
    if (changed.has('editing') && this.editing !== Boolean(changed.get('editing'))) {
      // Said as it starts (its words also on « Terminé »'s title); the protected areas wait for its end.
      if (this.editing) this.announce(`Modification des positions : ${this.#editWords}. « Terminé » pour finir.`);
      if (this.editing) this.#setAreas([]);
      else this.#scheduleAreas();
      this.#syncState();
    }
    if (!this.#map) return;
    this.#gl?.changed(changed);
    // Its address search given or taken back (a free layout's map, by its width): its buttons made again with it.
    if ((['search', 'noSearch'].some(k => changed.has(k) && changed.get(k) !== undefined) && this.hasAttribute('search') !== this.#hasSearch)
      || (changed.has('noLayers') && changed.get('noLayers') !== undefined)) this.#rebuildControls();
    if (changed.has('radiusHandle')) this.#syncHandle();
    if (changed.has('litKeys')) this.#lightFrom();
    if (changed.has('line')) this.#syncLine();
    // Its owner's look given (or let go): shown, not told back (it is its owner's).
    if (changed.has('look') && changed.get('look') !== undefined) { this.#own = this.look; this.#showLook(); }
    if (changed.has('own3d') && this.#panel) this.#panel.own3d = this.own3d;
    if (changed.has('lookWhy') && this.#panel) this.#panel.lookWhy = this.lookWhy;
    if (changed.has('view') && changed.get('view') !== undefined) {
      if (this.view) this.#applyView(true);
      // Its view let go (« Recadrer sur la zone »): framed on its area again.
      else if (this.#lastFit === 'view') this.#fitArea(true);
      if (!this.view) this.#told = [];
    }
    if (changed.has('points')) this.#syncPoints();
    if (changed.has('minZoom') && changed.get('minZoom') !== undefined) {
      // Tile layers are made for a zoom range: rebuild them for the new one. The limit is set without
      // setMinZoom, whose animated zoom would land after (and undo) the framing done just below.
      this.#map.options.minZoom = this.minZoom;
      this.#onModules();
    }
    if (changed.has('focusPoint')) this.#syncFocusPoint();
    if (changed.has('tiles')) this.#syncTiles();
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
    if (!map.getBounds().pad(-0.15).contains(latLng)) { this.#selfMove(); map.setView(latLng, Math.max(map.getZoom(), 16)); }
  }

  connectedCallback() {
    super.connectedCallback();
    moduleEvents.addEventListener('change', this.#onModules);
    mapLookEvents.addEventListener('change', this.#onCommonLook);
    // Back in the page: the common look may have changed meanwhile.
    if (this.#map) this.#showLook();
    if (this.#map) { this.#resized?.observe(this.#root); this.#syncTracking(); }
    this.#gl?.connect();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    moduleEvents.removeEventListener('change', this.#onModules);
    mapLookEvents.removeEventListener('change', this.#onCommonLook);
    this.#resized?.disconnect();
    clearTimeout(this.#areasTimer);
    clearTimeout(this.#busyTimer);
    this.#busyTimer = undefined;
    this.#areasAbort?.abort();
    this.#unwatch?.();
    this.#unwatch = null;
    this.#unwait?.();
    this.#unwait = null;
    this.#gl?.disconnect();
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
    this.#syncTiles();
    this.#photoCredit();
    if (!this.#applyFrame() && this.fit) this.#fitToContent();
    if (this.focusPoint && !this.#focusLayer?.getLayers().length) this.#syncFocusPoint();
  }

  /** Small circles (a walk's start, gf-map3d.js), each named, linking to its page when it has one. */
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
    // From plantZoom on; shown, until half a zoom under it (in 3D, any fraction of a zoom: no plants coming and going
    // at its edge). Moving a selected place's plants: they show at any zoom.
    const near = map.getZoom() >= this.plantZoom - (map.hasLayer(layer) ? 0.5 : 0);
    const visible = this.plants.length > 0 && (near || (this.editing && Boolean(this.selectedId || this.pin || !this.spots.length)));
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

  /** « Me localiser » touched, its answer awaited: a refusal or no position said once (a brief toast). */
  #locating = false;
  /** The last answer was a failure: « Me localiser » touched again asks anew. */
  #geoFailed = false;

  /** `track` shows my position once the permission is granted (or after « Me localiser »): never asked on its own. */
  #syncTracking() {
    if (this.track && !this.#unwatch) {
      if (this.#asked) { this.#unwait?.(); this.#unwait = null; this.#unwatch = watchLocation(s => this.#onGeo(s)); }
      else this.#unwait ??= whenGranted(() => { this.#unwait = null; this.#asked = true; if (this.isConnected) this.#syncTracking(); });
    } else if (!this.track && (this.#unwatch || this.#unwait)) {
      this.#unwatch?.();
      this.#unwatch = null;
      this.#unwait?.();
      this.#unwait = null;
    }
  }

  /**
   * The position's news: a fix shown; a failure right after « Me localiser » was touched said in a brief toast (the
   * user asked) — never for the quiet watch of a map that follows me (`track`).
   * @param {import('../core/geo.js').GeoState} s
   */
  #onGeo(s) {
    this.#geoFailed = Boolean(s.error);
    if (s.fix) { this.#locating = false; this.#showFix(s.fix); return; }
    if (!s.error || !this.#locating) return;
    this.#locating = false;
    this.toast(geoProblem(s.code ?? null).text);
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
    this.#syncMeCircle();
    if (this.#follow) { this.#selfMove(); map.panTo([lat, lon], { animate: true }); }
  }

  /**
   * My position's accuracy circle: never a second circle beside a page's zone (taken for it) — with one shown, only
   * while it is small against it (under a quarter of its radius).
   */
  #syncMeCircle() {
    const map = this.#map, c = this.#meCircle, r = Number(/** @type {any} */ (this.area)?.radius) || 0;
    if (!map || !c) return;
    const wanted = !r || c.getRadius() < r / 4;
    if (wanted && !map.hasLayer(c)) c.addTo(map);
    else if (!wanted && map.hasLayer(c)) c.remove();
  }

  /** "Autour": the searched circle and the observations of the chosen species. */
  /** The room kept free last framed (area.inset). */
  #areaInset = 'null';

  #syncArea() {
    const layer = /** @type {L.LayerGroup} */ (this.#areaLayer);
    const area = /** @type {any} */ (this.area);
    this.#syncMeCircle();
    // `smooth` (the step « map » of the games around a place): the circle and its points kept and changed in place.
    if (area?.smooth) { this.#syncSmoothArea(area); return; }
    if (this.#smooth) {
      this.#smooth = null;
      const map = /** @type {L.Map} */ (this.#map);
      map.getContainer().classList.remove('gf-area-loading', 'gf-area-smooth');
      map.getPane('gfRing')?.replaceChildren();
      map.options.zoomSnap = 1;
      for (const h of ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom', 'boxZoom', 'keyboard']) /** @type {any} */ (map)[h]?.enable();
    }
    // The points drawn the same way as before are kept (by what they show): a new `area` object (another render, the
    // same points; a few points more or less) never draws them again, nor stops or asks again for their photos.
    const fancy = Boolean(area?.leaves);
    const sig = area ? JSON.stringify([fancy, area.photo || null, area.credit || null, /** @type {any} */ (this).pointClick || null, moduleOn('photos')]) : '';
    const was = this.#areaDots?.sig === sig ? this.#areaDots.dots : new Map();
    /** @type {Map<string, L.Layer>} */
    const dots = new Map();
    /** @type {{ point: any, key: string }[]} */
    const fresh = [];
    for (const point of area?.points || []) {
      const p = point, key = JSON.stringify([p.url, p.coordinates, p.title, p.photo, p.common, p.sci, p.date]);
      if (dots.has(key)) continue;
      const dot = was.get(key);
      if (dot) { was.delete(key); dots.set(key, dot); } else { fresh.push({ point, key }); dots.set(key, /** @type {any} */ (null)); }
    }
    const kept = new Set(dots.values());
    kept.delete(/** @type {any} */ (null));
    for (const l of layer.getLayers()) {
      if (kept.has(l)) continue;
      const el = /** @type {any} */ (l).getElement?.();
      if (el) cancelImages(el);
      layer.removeLayer(l);
    }
    for (const dot of kept) { const el = /** @type {any} */ (dot).getElement?.(); if (el) resumeImages(el); }
    this.#areaDots = area ? { sig, dots } : null;
    // No area: no handle left on the map (its circle gone).
    if (!area) { this.#areaCircles = []; this.#syncHandle(); return; }
    const [lon, lat] = area.center;
    // `leaves`: the observations as small leaves popping in one after the other, the circle glowing (Découvrir).
    // Its shadow: the same circle, darker, a little lower (a still line — no filter to redraw at each move).
    const shadow = L.circle([lat, lon], { radius: area.radius, className: 'gf-perim-shadow', interactive: false }).addTo(layer);
    const circle = L.circle([lat, lon], { radius: area.radius, className: fancy ? 'gf-area gf-area-glow' : 'gf-area', interactive: false }).addTo(layer);
    this.#areaCircles = [shadow, circle];
    const bounds = area.fit ? circle.getBounds() : null;
    // The same circle again (the points arrived): no move; another one: the view eases to it (the old tiles
    // glide while the new ones come; the page gives the map a background of its colour, no pale flash).
    const inset = JSON.stringify(/** @type {any} */ (area).inset || null);
    const moved = bounds && (!(this.#areaBounds && this.#areaBounds.equals(bounds, 1e-9)) || inset !== this.#areaInset);
    const first = !this.#areaBounds;
    this.#areaBounds = bounds;
    this.#areaInset = inset;
    // A view given (vue=) frames the map instead, the first time; a circle moved afterwards is framed again.
    if (moved && first && this.#lastFit === 'view') { /* on its view */ } else if (moved) this.#fitArea(!first);
    // All new: one after the other as before; a few more among those kept: quicker.
    const all = fresh.length === dots.size;
    for (const [i, { point, key }] of fresh.entries()) dots.set(key, this.#areaDot(area, point, all ? Math.min(i, 40) * 25 : Math.min(i, 30) * 14).addTo(layer));
    this.#relight();
    this.#syncHandle();
  }

  // ── The radius' handle (radiusHandle: a free layout's map) ─────────────────────────────────────────

  /** The area's circle and its shadow, as last drawn (not a smooth area's). @type {L.Circle[]} */
  #areaCircles = [];
  /** @type {L.Marker | null} */ #handle = null;
  /** The radius while the handle is held or stepped, until the area says it (null: the area's). @type {number | null} */ #held = null;

  /** The radius the circle shows now: the one held, else the area's. */
  get #radiusNow() { return this.#held ?? /** @type {any} */ (this.area)?.radius ?? 0; }

  /**
   * The handle on the circle's east edge (where the circle is drawn: its bounds), its words for screen readers; none
   * without an area (or a smooth one: a ring held on the screen), or without radiusHandle.
   */
  #syncHandle() {
    const map = this.#map, area = /** @type {any} */ (this.area), h = this.radiusHandle;
    const circle = this.#areaCircles[1];
    if (!map || !h || !area || area.smooth || !circle || !this.#areaLayer?.hasLayer(circle)) {
      this.#handle?.remove();
      this.#handle = null;
      return;
    }
    // The area drawn again: its radius is the one shown (a held radius given back by the area: let go).
    if (!this.#handle?.getElement()?.querySelector('.held')) this.#held = null;
    const at = L.latLng(circle.getLatLng().lat, circle.getBounds().getEast());
    if (!this.#handle) {
      const el = elem('span', 'gf-radius-handle');
      el.tabIndex = 0;
      el.setAttribute('role', 'slider');
      el.setAttribute('aria-label', 'Poignée du rayon de la zone');
      el.setAttribute('aria-valuemin', '100');
      el.setAttribute('aria-valuemax', '50000');
      el.title = 'Glisser pour changer le rayon (← → : de cran en cran)';
      const bubble = elem('span', 'bubble');
      bubble.hidden = true;
      el.append(elem('span', 'knob'), bubble);
      this.#handle = L.marker(at, { icon: L.divIcon({ className: 'gf-radius-mk', iconSize: [36, 36], iconAnchor: [18, 18], html: el }), keyboard: false, zIndexOffset: 2500 }).addTo(map);
      this.#holdHandle(el);
    } else this.#handle.setLatLng(at);
    this.#sayRadius();
  }

  /** The handle's value, in words (aria) and in its bubble. */
  #sayRadius() {
    const el = /** @type {HTMLElement | null | undefined} */ (this.#handle?.getElement()?.querySelector('.gf-radius-handle'));
    const h = this.radiusHandle;
    if (!el || !h) return;
    const m = this.#radiusNow;
    el.setAttribute('aria-valuenow', String(Math.round(m)));
    el.setAttribute('aria-valuetext', h.label(m));
    /** @type {HTMLElement} */ (el.querySelector('.bubble')).textContent = h.label(m);
  }

  /** The circle (and the handle) at a radius, while it is held: nothing asked yet. @param {number} m */
  #showRadius(m) {
    this.#held = m;
    for (const c of this.#areaCircles) c.setRadius(m);
    const circle = this.#areaCircles[1];
    if (circle && this.#handle) this.#handle.setLatLng(L.latLng(circle.getLatLng().lat, circle.getBounds().getEast()));
    this.#sayRadius();
  }

  /**
   * The handle's gestures: held and dragged (a mouse, a finger, a pen: its pointer captured, the map never panned
   * meanwhile), the radius the distance from the centre gives (snapped to the stops near it); let go, the radius
   * changed (`radius-change`). A key: the next stop, or the one before. @param {HTMLElement} el
   */
  #holdHandle(el) {
    const map = /** @type {L.Map} */ (this.#map);
    const bubble = /** @type {HTMLElement} */ (el.querySelector('.bubble'));
    /** @type {number | null} */ let pointer = null;
    let from = 0;
    const end = (/** @type {PointerEvent} */ e) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      el.classList.remove('held');
      bubble.hidden = true;
      map.dragging.enable();
      const m = this.#held ?? from;
      if (m !== from) this.#emit('radius-change', { radius: m });
      else this.#showRadius(from);
    };
    el.addEventListener('pointerdown', e => {
      if (pointer !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      e.stopPropagation();
      pointer = e.pointerId;
      try { el.setPointerCapture(e.pointerId); } catch { /* a pointer already gone */ }
      from = this.#radiusNow;
      map.dragging.disable();
      el.classList.add('held');
      bubble.hidden = false;
      el.focus({ preventScroll: true });
      this.#sayRadius();
    });
    el.addEventListener('pointermove', e => {
      const circle = this.#areaCircles[1];
      if (e.pointerId !== pointer || !this.radiusHandle || !circle) return;
      e.preventDefault();
      e.stopPropagation();
      const box = map.getContainer().getBoundingClientRect();
      const ll = map.containerPointToLatLng([e.clientX - box.left, e.clientY - box.top]);
      const m = this.radiusHandle.snap(map.distance(circle.getLatLng(), ll));
      if (m === this.#radiusNow) return;
      this.#showRadius(m);
      this.#emit('radius-input', { radius: m });
    });
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
    el.addEventListener('keydown', e => {
      const m = this.radiusHandle?.step(e.key, this.#radiusNow) ?? null;
      if (m === null) return;
      e.preventDefault();
      e.stopPropagation();
      if (m === this.#radiusNow) return;
      this.#showRadius(m);
      this.#emit('radius-change', { radius: m });
    });
    // Never a click, a long press nor a pan of the map from it.
    L.DomEvent.disableClickPropagation(el);
    for (const type of ['mousedown', 'touchstart', 'contextmenu']) {
      el.addEventListener(type, ev => { ev.stopPropagation(); if (type !== 'mousedown') ev.preventDefault(); });
    }
  }

  /** The points of a (not smooth) area drawn, by what they show, and how they were drawn. @type {{ sig: string, dots: Map<string, L.Layer> } | null} */
  #areaDots = null;

  /**
   * One observation of the area: a leaf, or its plant's photo (`leaves`), the photo of the plant chosen (`photo`), else
   * a dot; popping in after `delay` ms. Its card (or name) on hover, its click, its kin lit with it.
   * @param {any} area @param {any} point @param {number} delay @returns {L.Layer}
   */
  #areaDot(area, point, delay) {
    const [x, y] = point.coordinates;
    const p = point, fancy = Boolean(area.leaves), chosen = area.photo;
    const dot = fancy
      ? L.marker([y, x], { icon: p.photo ? photoIcon(p.photo, delay) : leafIcon(delay), keyboard: Boolean(area.smooth), bubblingMouseEvents: false })
      : chosen ? L.marker([y, x], { icon: chosenIcon(chosen, Math.min(delay, 750), this.#chosenSize(40)), keyboard: false, bubblingMouseEvents: false, riseOnHover: true })
      : L.circleMarker([y, x], { radius: 6, className: 'gf-obs', bubblingMouseEvents: false });
    /** @type {any} */ (dot).gfName = [p.common || p.title, p.sci].filter(Boolean).join(', ');
    /** @type {any} */ (dot).gfPoint = p;
    // With a photo: a small card of the plant on hover (a first touch, on a touch screen); else its name.
    if (fancy && (p.photo || p.sci)) this.#tip(dot, () => obsCard(p), { card: true, gap: 6 });
    else if (chosen) this.#tip(dot, () => obsCard({ ...p, photo: chosen, credit: area.credit }), { card: true, gap: 6 });
    else this.#tip(dot, point.title);
    this.#onPoint(dot, point);
    // Hovered (touched): the other points of the same plant are lit with it.
    this.#kin(dot, speciesKey(p) || (fancy ? null : 'area'));
    // Under the mouse (never a touch: it picks): told — a list beside the map lights its plant's row (point-hover).
    if (!matchMedia('(hover: none)').matches) {
      const leave = () => { if (this.#hovered === dot) { this.#hovered = null; this.#emit('point-hover', { point: null }); } };
      dot.on('mouseover', () => { this.#hovered = dot; this.#emit('point-hover', { point: p }); });
      dot.on('mouseout', leave);
      dot.on('remove', leave);
    }
    return dot;
  }

  /**
   * The area seen through a ring (area.smooth, area.ring: the games' step « map »): the circle is still on the screen —
   * its centre and size in pixels given (`ring`: { x, y, r }, from the map's top left corner) — and the map zooms
   * under it so that the distance chosen fills it exactly, the place held under its centre (~380 ms, eased; at once
   * with reduced motion). The view is the ring's: no dragging or zooming by hand. Its points stay while others are on
   * their way (area.loading: dimmed, the ring breathing), then those gone fade out and the new ones pop in — a photo
   * kept is never loaded again, and one that leaves stops loading (the next ones are not queued behind it).
   * @type {SmoothArea | null}
   */
  #smooth = null;
  #tween = 0;
  #ringHeld = () => { if (this.#smooth) this.#drawRing(); };

  /** @param {any} area */
  #syncSmoothArea(area) {
    const map = /** @type {L.Map} */ (this.#map), layer = /** @type {L.LayerGroup} */ (this.#areaLayer);
    const [lon, lat] = area.center;
    let s = this.#smooth;
    const first = !s || s.center !== lon + ',' + lat;
    if (!s || first) {
      cancelLayerImages(layer);
      layer.clearLayers();
      this.#areaDots = null;
      s = this.#smooth = { center: lon + ',' + lat, latlng: L.latLng(lat, lon), target: area.radius, ring: area.ring, points: null, dots: new Map() };
      // Any zoom (the distance fills the ring exactly); the view is the ring's.
      map.options.zoomSnap = 0;
      for (const h of ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom', 'boxZoom', 'keyboard']) /** @type {any} */ (map)[h]?.disable();
      map.getContainer().classList.add('gf-area-smooth');
      map.off('viewreset moveend', this.#ringHeld).on('viewreset moveend', this.#ringHeld);
    }
    map.getContainer().classList.toggle('gf-area-loading', Boolean(area.loading));
    const ring = JSON.stringify(area.ring || null);
    if (first || area.radius !== s.target || ring !== this.#areaInset) {
      const eased = !first && ring === this.#areaInset && !matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.#areaInset = ring;
      s.target = area.radius;
      s.ring = area.ring;
      this.#areaBounds = s.latlng.toBounds(2 * area.radius);
      this.#lastFit = 'area';
      this.#drawRing();
      this.#tweenArea(s, eased);
    }
    if (area.points !== s.points) {
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const fresh = !s.points;
      s.points = area.points;
      /** @type {Map<string, L.Layer>} */
      const keep = new Map();
      let n = 0;
      for (const [i, p] of (area.points || []).entries()) {
        const key = p.url || p.coordinates.join(',') + ':' + p.title;
        if (keep.has(key)) continue;
        let dot = s.dots.get(key);
        if (dot) { s.dots.delete(key); const el = /** @type {any} */ (dot).getElement?.(); if (el) resumeImages(el); }
        else dot = this.#areaDot(area, p, fresh ? Math.min(i, 40) * 25 : Math.min(n++, 30) * 14).addTo(layer);
        keep.set(key, dot);
      }
      // Those gone: they fade out (shrinking), their photo no longer loading.
      for (const dot of s.dots.values()) {
        const el = /** @type {any} */ (dot).getElement?.();
        if (el) cancelImages(el);
        if (still || !el) { layer.removeLayer(dot); continue; }
        el.classList.add('gf-leave');
        setTimeout(() => layer.removeLayer(dot), 300);
      }
      s.dots = keep;
      this.#relight();
    }
    this.#markDots(area.marks);
  }

  /**
   * The points lit (area.marks, by iNaturalist taxon): the card on top (gf-top), the matches (gf-matched), the plants
   * passed (gf-passed) — the page styles them. @param {{ top?: number | null, matched?: number[], passed?: number[] } | null | undefined} marks
   */
  #markDots(marks) {
    const s = this.#smooth;
    if (!s) return;
    const m = marks || {};
    for (const dot of s.dots.values()) {
      const el = /** @type {any} */ (dot).getElement?.();
      if (!el) continue;
      for (const [cls, on] of Object.entries(markClasses(/** @type {any} */ (dot).gfPoint, m))) el.classList.toggle(cls, on);
    }
  }

  /** The ring (map-style.js#ringElement) in a pane of its own, over the map and under the points; held in place. */
  #drawRing() {
    const map = /** @type {L.Map} */ (this.#map), ring = this.#smooth?.ring;
    const pane = map.getPane('gfRing') || map.createPane('gfRing');
    pane.style.zIndex = '450';
    pane.style.pointerEvents = 'none';
    if (!ring) { pane.replaceChildren(); return; }
    const svg = ringElement(ring, /** @type {SVGSVGElement | null} */ (pane.querySelector('svg.gf-ring')));
    if (!svg.isConnected) pane.append(svg);
    // The map's panes move as a whole only when the view is reset (never dragged here): the ring held in place.
    const at = L.DomUtil.getPosition(/** @type {HTMLElement} */ (map.getPane('mapPane')));
    svg.style.translate = `${-at.x}px ${-at.y}px`;
  }

  /**
   * The zoom at which `metres` fill the ring's radius at the place, and the map's centre that puts the place under
   * the ring's centre at that zoom.
   * @param {SmoothArea} s @param {number} metres @param {number} [zoom] the zoom for the centre (else the one found)
   */
  #ringView(s, metres, zoom) {
    const map = /** @type {L.Map} */ (this.#map), ring = /** @type {{ x: number, y: number, r: number }} */ (s.ring);
    const z0 = map.getZoom() || 10, at = s.latlng;
    // Pixels per metre eastward at the place (the haversine distance of a small step: as the map measures).
    const step = L.latLng(at.lat, at.lng + 0.01);
    const perMetre = (map.project(step, z0).x - map.project(at, z0).x) / map.distance(at, step);
    const z = zoom ?? Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), z0 + Math.log2(ring.r / (metres * perMetre))));
    const shift = map.getSize().divideBy(2).subtract(L.point(ring.x, ring.y));
    return { zoom: z, center: map.unproject(map.project(at, z).add(shift), z) };
  }

  /**
   * The map zoomed under the ring to the distance chosen, the place held under its centre each frame (eased out).
   * Another distance meanwhile: from where it is.
   * @param {SmoothArea} s @param {boolean} ease
   */
  #tweenArea(s, ease) {
    const map = /** @type {L.Map} */ (this.#map), m = /** @type {any} */ (map);
    const moving = this.#tween !== 0;
    cancelAnimationFrame(this.#tween);
    this.#tween = 0;
    if (!map.getSize().x || !s.ring) return;
    const to = this.#ringView(s, s.target);
    if (!ease) {
      if (moving) m._moveEnd(true);
      map.setView(to.center, to.zoom, { animate: false });
      this.#drawRing();
      return;
    }
    const z0 = map.getZoom(), start = performance.now(), duration = 380;
    if (!moving) { m._stop(); m._moveStart(true, false); }
    const frame = () => {
      const t = Math.min(1, (performance.now() - start) / duration), e = 1 - (1 - t) ** 3;
      const z = z0 + (to.zoom - z0) * e;
      m._move(this.#ringView(s, s.target, z).center, z);
      if (t < 1) this.#tween = requestAnimationFrame(frame);
      else { this.#tween = 0; m._moveEnd(true); }
    };
    this.#tween = requestAnimationFrame(frame);
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
    // Left: hidden a moment later (going from a point to its neighbour, the card does not flicker).
    else { dot.on('mouseover', () => { clearTimeout(this.#tipLeave); show(); }); dot.on('mouseout', () => { clearTimeout(this.#tipLeave); this.#tipLeave = setTimeout(() => this.#hideTip(dot), 140); }); }
    dot.on('remove', () => this.#hideTip(dot));
    // Reached with the keyboard (a point made focusable: the games' step « map »): its card while it has the focus,
    // Échap hides it.
    if (/** @type {any} */ (dot).options?.keyboard) {
      dot.on('add', () => {
        const el = /** @type {any} */ (dot).getElement?.();
        if (!el) return;
        el.setAttribute('role', 'img');
        el.setAttribute('aria-label', typeof content === 'string' ? content : /** @type {any} */ (dot).gfName || 'Observation');
        el.addEventListener('focus', show);
        el.addEventListener('blur', () => this.#hideTip(dot));
        el.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape' && this.#tipOwner === dot) { e.stopPropagation(); this.#hideTip(dot); } });
      });
    }
  }
  #tipLeave = 0;

  /** @param {L.Layer} dot @param {string | (() => Node)} content @param {{ card?: boolean, gap?: number }} o */
  #showTip(dot, content, o) {
    const tip = this.#floatTip;
    const el = /** @type {any} */ (dot).getElement?.();
    if (!tip || !el) return;
    this.#tipOwner = dot;
    tip.className = 'gf-float-tip' + (o.card ? ' card' : '');
    if (typeof content === 'function') tip.replaceChildren(content()); else tip.textContent = content;
    // A second touch opens the record: said on the card the first time ever (a first-use hint, gone with the card),
    // afterwards to screen readers only.
    if (/** @type {any} */ (dot).gfAgain) {
      (tip.querySelector('.gf-obs-card .t') || tip).append(elem('small', takeHint('map-touch-again') ? 'again' : 'again gf-map-sr', 'Touchez encore pour ouvrir l’observation'));
    }
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
  /** The elements lit from outside (litKeys). @type {Element[]} */ #litFrom = [];
  /** The area's point under the mouse (point-hover). @type {L.Layer | null} */ #hovered = null;

  /** Every layer of a plant's points (its kin): the area's, the plant chosen's, the groups', the plants of places. @returns {any[]} */
  #kinLayers() {
    const map = /** @type {L.Map} */ (this.#map);
    const groups = [this.#areaLayer, this.#hlLayer, this.#clusterLayer, this.#spreadLayer];
    /** @type {any[]} */
    const layers = groups.flatMap(g => g ? g.getLayers() : []);
    if (this.#plantLayer && map.hasLayer(this.#plantLayer)) layers.push(...this.#plantMarkers.values());
    return layers;
  }

  /** Lights one plant's points (null: none), `origin` the most. @param {string | null} key @param {L.Layer} [origin] */
  #light(key, origin) {
    for (const el of this.#lit) el.classList.remove('gf-kin', 'gf-kin-self');
    this.#lit = [];
    this.#litKey = key;
    this.#litBy = key && origin ? origin : null;
    const map = this.#map;
    if (!map) return;
    if (key) {
      const layers = this.#kinLayers();
      // Only those in sight (a wide scope has hundreds out of it): fewer elements restyled.
      const view = this.#sight(0.2);
      for (const l of layers) {
        if (l.gfKin !== key || (l.getLatLng && !view.contains(l.getLatLng()))) continue;
        const el = l.getElement?.();
        if (el) { el.classList.add('gf-kin'); this.#lit.push(el); }
      }
      const self = /** @type {any} */ (origin)?.getElement?.();
      if (self) { self.classList.add('gf-kin-self'); if (!this.#lit.includes(self)) this.#lit.push(self); }
    }
  }

  /**
   * The points of the plant lit from outside (litKeys: a list's row hovered) — those in sight, as the map's own hover
   * lights them —; none: let go.
   */
  #lightFrom() {
    for (const el of this.#litFrom) el.classList.remove('gf-lit');
    this.#litFrom = [];
    const keys = this.litKeys;
    if (!keys?.size || !this.#map) return;
    const view = this.#sight(0.2);
    for (const l of this.#kinLayers()) {
      if (!keys.has(l.gfKin) || (l.getLatLng && !view.contains(l.getLatLng()))) continue;
      const el = l.getElement?.();
      if (el) { el.classList.add('gf-lit'); this.#litFrom.push(el); }
    }
  }

  /** Points drawn again (a new icon has its own classes): the plant lit stays lit, its new points with it. */
  #relight() {
    if (this.#litKey) this.#light(this.#litKey, this.#litBy ?? undefined);
    if (this.litKeys?.size) this.#lightFrom();
  }

  /**
   * The view and around it (`pad`: a share of its size on each side). In 3D, what the 3D map shows — tilted, turned
   * (gf-map-gl.js bounds), not this map's box, north up, seen from above —, within a few views of its centre (a view
   * up to the horizon would hold a whole region).
   * @param {number} pad
   */
  #sight(pad) {
    const flat = /** @type {L.Map} */ (this.#map).getBounds();
    const b = this.#gl?.on ? this.#gl.bounds : null;
    if (!b) return flat.pad(pad);
    const s = b.pad(pad), far = flat.pad(2 + pad);
    return L.latLngBounds([Math.max(s.getSouth(), far.getSouth()), Math.max(s.getWest(), far.getWest())],
      [Math.min(s.getNorth(), far.getNorth()), Math.min(s.getEast(), far.getEast())]);
  }

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
    // Inside a mini-app, no record opened on another site: the point's card only.
    const how = this.pointClick || (inMiniApp(this) ? 'none' : 'open');
    // 'pick' is read at the click: points kept from one step to the next (area.smooth: the games' map, 'none' on the
    // step « map », 'pick' beside the cards) answer as the map says now — not as it said when they were drawn.
    if (how === 'none' || how === 'pick') {
      dot.on('click', () => { if (this.pointClick === 'pick') this.dispatchEvent(new CustomEvent('point-pick', { detail: { point: p }, bubbles: true, composed: true })); });
      return;
    }
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
  /** The cluster's points alone out of sight, each a dot until the view comes to it (#nearCluster). @type {{ p: any, dot: L.CircleMarker }[]} */
  #farSingles = [];

  /** @type {L.LayerGroup | null} */ #spreadLayer = null;
  /** A zoom under way (zoomstart → zoomend): groups wait for its end. */
  #zooming = false;

  /**
   * A group's points spread around it, each on a thread to its place: the plant's photo in its ring (its leaf without
   * one), its card on hover, its record on a touch. A touch on the map, or a zoom, gathers them back.
   * @param {L.LatLng} at @param {{ coordinates: [number, number], title: string, url?: string }[]} pts
   * @param {{ photo?: string | null, credit?: any, common?: string, sci?: string, taxonId?: number }} who the plant
   *   (its photo, its card's names, its kin)
   */
  #spread(at, pts, who) {
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
      const photo = who.photo || null;
      const dot = L.marker(spot, { icon: chosenIcon(photo, Math.min(i, 30) * 15, 30), keyboard: false, bubblingMouseEvents: false, riseOnHover: true, zIndexOffset: 1000 }).addTo(layer);
      this.#tip(dot, () => obsCard({ .../** @type {any} */ (p), photo, common: who.common, sci: who.sci, credit: photo ? who.credit : null }), { card: true, gap: 6 });
      this.#onPoint(dot, p);
      this.#kin(dot, speciesKey(who) || 'hl');
    });
    L.circleMarker(at, { radius: 5, className: 'gf-spread-center', interactive: false }).addTo(layer);
    // Gathered by a touch on the map or a zoom — not by the 3D map's view given to this one (gf-map-gl.js: its
    // fractions of a zoom as the user turns or tilts it).
    const gather = this.#gatherOn = (/** @type {L.LeafletEvent} */ e) => { if (e.type !== 'zoomstart' || !this.#gl?.mirroring) this.#gather(); };
    map.on('click zoomstart', gather);
    this.#relight();
  }
  /** @type {L.LeafletEventHandlerFn | null} */ #gatherOn = null;

  /** The points spread gathered back into their group. */
  #gather() {
    this.#spreadLayer?.remove();
    this.#spreadLayer = null;
    if (this.#gatherOn) this.#map?.off('click zoomstart', this.#gatherOn);
    this.#gatherOn = null;
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
   * One plant's points (`cluster`), grouped by the screen cell they fall in at this zoom, whatever their source
   * (iNaturalist, GBIF): alone, the plant chosen's marker — its photo in its pink and gold ring, its leaf without one;
   * coming in with a bounce while few are in sight (PHOTO_SINGLES), at once past that; far out of sight, a small dot of
   * its colours until a move brings it in sight (#nearCluster: hundreds of photo markers weigh, more so mirrored in
   * 3D) —, its card on hover, its record on a touch; together, a stack: its photo in a disc sized by their number,
   * their count on a badge (a touch spreads them; a large group is zoomed in on first). Never a source's colour.
   * Grouped again at each zoom.
   * @param {boolean} [rezoom]
   */
  #syncCluster(rezoom = false) {
    const map = this.#map, layer = this.#clusterLayer, c = this.cluster;
    if (!map || !layer) return;
    // A zoom under way (a flight to the zone chosen): grouped once, at its end (zoomend), at the zoom reached — not
    // here, at the zoom it leaves (hundreds of points alone there, each drawn and bouncing for nothing).
    if (this.#zooming && !rezoom) { layer.clearLayers(); this.#gather(); this.#clusterKey = ''; return; }
    // At a whole zoom: in 3D, the view's fractions of a zoom given to this map (gf-map-gl.js) change no group — the
    // same points at the same zoom are kept as they are, none made again.
    const zoom = Math.round(map.getZoom());
    const key = (c?.key || '') + ':' + zoom;
    if (key === this.#clusterKey) return;
    // The same points again at another zoom: drawn at once, without their entrance (it played when they came).
    const still = c?.key && this.#clusterKey.startsWith(c.key + ':') ? ' still' : '';
    this.#clusterKey = key;
    layer.clearLayers();
    this.#farSingles = [];
    this.#gather();
    if (!c?.points.length || !map.getSize().x) return;
    // Cells of ~70 px: a few clear groups rather than many small ones.
    const CELL = 72;
    /** @type {Map<string, { pts: typeof c.points, x: number, y: number }>} */
    const cells = new Map();
    for (const p of c.points) {
      const px = map.project([p.coordinates[1], p.coordinates[0]], zoom);
      // Every source in the same groups: a GBIF occurrence is one more observation of the plant.
      const id = Math.floor(px.x / CELL) + ':' + Math.floor(px.y / CELL);
      const cell = cells.get(id) || { pts: [], x: 0, y: 0 };
      cell.pts.push(p); cell.x += px.x; cell.y += px.y;
      cells.set(id, cell);
    }
    // The plant (Découvrir's in a wider scope, a sheet's): its photo and its names on its points' cards; its kin key,
    // the same as its points in the circle (they light together).
    const who = /** @type {any} */ (c);
    const kin = speciesKey(who) || 'hl';
    const photo = who.photo || null;
    // Its points alone in sight (and near it): each its photo marker, coming in with a bounce while they are few; the
    // others a dot until seen.
    const sight = this.#sight(SIGHT_PAD);
    const at1 = (/** @type {any} */ p) => L.latLng(p.coordinates[1], p.coordinates[0]);
    const seen = [...cells.values()].filter(cell => cell.pts.length === 1 && sight.contains(at1(cell.pts[0]))).length;
    const entrance = seen <= PHOTO_SINGLES ? still : ' still';
    for (const cell of cells.values()) {
      const n = cell.pts.length;
      const at = map.unproject([cell.x / n, cell.y / n], zoom);
      if (n === 1) {
        const p = cell.pts[0];
        if (sight.contains(at1(p))) this.#single(p, entrance);
        else {
          const dot = L.circleMarker(at1(p), { radius: 6, className: 'gf-occ', bubblingMouseEvents: false }).addTo(layer);
          this.#clusterPoint(dot, p);
          this.#farSingles.push({ p, dot });
        }
        continue;
      }
      const size = Math.round(Math.min(54, 26 + Math.log2(n) * 6));
      const m = L.marker(at, {
        icon: chosenGroupIcon(photo, n, size, Boolean(still)),
        keyboard: true, bubblingMouseEvents: false, title: `${n} points — toucher pour zoomer`, riseOnHover: true,
        // Above the other markers (and the larger above the smaller: their number stays seen).
        zIndexOffset: 1000 + Math.min(n, 999)
      }).addTo(layer);
      this.#kin(m, kin);
      // A touch: its points, spread around it (a large group: zoomed in on first).
      m.on('click', () => {
        const b = L.latLngBounds(cell.pts.map(p => [p.coordinates[1], p.coordinates[0]]));
        if (n > SPREAD_MAX && !b.getNorthEast().equals(b.getSouthWest()) && map.getZoom() < 17) { map.flyToBounds(b, { padding: [40, 40], duration: 0.5, maxZoom: 17 }); return; }
        this.#spread(at, cell.pts, who);
      });
    }
    this.#relight();
  }
  #hlKey = '';

  /** A point of the cluster alone: the plant chosen's marker, its photo (its leaf without one). @param {any} p @param {string} extra its entrance or ' still' */
  #single(p, extra) {
    const photo = /** @type {any} */ (this.cluster)?.photo || null;
    const dot = L.marker([p.coordinates[1], p.coordinates[0]], { icon: chosenIcon(photo, 0, 34, extra), keyboard: false, bubblingMouseEvents: false, riseOnHover: true, zIndexOffset: 1000 })
      .addTo(/** @type {L.LayerGroup} */ (this.#clusterLayer));
    this.#clusterPoint(dot, p);
  }

  /** A cluster point's card (the plant's photo and credit, its names; the record's date, place and source), its touch, its kin. @param {L.Layer} dot @param {any} p */
  #clusterPoint(dot, p) {
    const who = /** @type {any} */ (this.cluster), photo = who?.photo || null;
    this.#tip(dot, () => obsCard({ ...p, photo, common: who?.common, sci: who?.sci, credit: photo ? who?.credit : null }), { card: true, gap: 6 });
    this.#onPoint(dot, p);
    this.#kin(dot, speciesKey(who) || 'hl');
  }

  /** A move ended: the cluster's points alone now in sight, dots until then, become their photo marker (no bounce). */
  #nearCluster() {
    const map = this.#map;
    if (!map || !this.#farSingles.length || !this.#clusterLayer) return;
    const sight = this.#sight(SIGHT_PAD);
    const before = this.#farSingles.length;
    this.#farSingles = this.#farSingles.filter(({ p, dot }) => {
      if (!sight.contains(dot.getLatLng())) return true;
      dot.remove();
      this.#single(p, ' still');
      return false;
    });
    if (this.#farSingles.length !== before) this.#relight();
  }

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
  /** @type {'area' | 'frame' | 'view' | null} */ #lastFit = null;
  /** @type {L.LatLngBounds | null} */ #framedBounds = null;
  /** The zoom the last frame may not exceed (kept for refits on resize: a single point never zooms to the max). */
  #framedMax = 18;

  /** The circle framed (area.fit), with a margin; `ease`: a short zoom animation. Told: `view-framed` (bounds null). @param {boolean} [ease] */
  #fitArea(ease = false) {
    const map = this.#map, b = this.#areaBounds;
    if (!map || !b || !map.getSize().x) return;
    this.#lastFit = 'area';
    this.#selfMove();
    // The area seen through its ring: the distance under it again at once (a resize).
    if (this.#smooth) { this.#tweenArea(this.#smooth, false); return; }
    // area.inset: room kept free of the circle (a panel over the map: its height below, its width on the right).
    const inset = /** @type {any} */ (this.area)?.inset || {};
    map.fitBounds(b, { paddingTopLeft: [16, 16], paddingBottomRight: [16 + (inset.right || 0), 16 + (inset.bottom || 0)], animate: ease });
    this.#emit('view-framed', { bounds: null });
  }

  /** Framed on its area again (« Toute la zone » beside it). */
  refit() { this.#fitArea(true); }

  /**
   * What the map shows, as [west, south, east, north] — in 3D, what the 3D map shows (#sight) —; null before it has a
   * size. @returns {number[] | null}
   */
  bounds() {
    const map = this.#map;
    if (!map || !map.getSize().x) return null;
    const b = this.#sight(0);
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  }

  /**
   * A move the map makes itself (a flight to a point, a frame, the position followed, a place found): never told as
   * one by hand, even just after a touch (a point touched: the map flies to it).
   */
  #selfMove() { this.#handAt = 0; clearTimeout(this.#viewTimer); this.#toldView = ''; }

  /** When the map was last touched by hand (performance.now(); 0: never, or since moved by the map itself). */
  #handAt = 0;
  /** The view told last (view-change), as its text: not told again. */
  #toldView = '';
  /** @type {ReturnType<typeof setTimeout> | undefined} */ #viewTimer;

  /** A move ended: one by hand (a gesture in the last 4 s) has its view told once the map rests a moment. */
  #movedByHand() {
    if (!this.#handAt || performance.now() - this.#handAt > 4000) return;
    clearTimeout(this.#viewTimer);
    this.#viewTimer = setTimeout(() => {
      const map = this.#map;
      if (!map || !this.isConnected) return;
      const c = map.getCenter(), gl = this.#gl?.on ? /** @type {any} */ (this.#gl).glMap : null;
      const view = { lat: c.lat, lon: c.lng, zoom: map.getZoom(), pitch: gl ? gl.getPitch() : 0, bearing: gl ? gl.getBearing() : 0 };
      const text = JSON.stringify([view.lat.toFixed(5), view.lon.toFixed(5), view.zoom.toFixed(2), Math.round(view.pitch), Math.round(view.bearing)]);
      if (text === this.#toldView) return;
      this.#toldView = text;
      this.#told = [viewKey(view), ...this.#told].slice(0, 2);
      this.#emit('view-change', { ...view, bounds: this.bounds() });
    }, 300);
  }

  /**
   * The view given (`view`) shown: its centre and zoom (in 3D, its tilt and turn too); kept there on a resize. Given
   * again (`given`): not a view this map told (view-change) and its page wrote down (vue=) — it is where the map is,
   * or was a moment ago —, nor while a hand moves the map: a jump would stop the gesture, or the turn under way.
   * @param {boolean} [given]
   */
  #applyView(given = false) {
    const map = this.#map, v = this.view;
    if (!map || !v) return;
    this.#lastFit = 'view';
    if (given && (this.#told.includes(viewKey(v)) || this.#inGesture())) return;
    this.#selfMove();
    map.setView([v.lat, v.lon], v.zoom, { animate: false });
    this.#gl?.viewChanged?.();
    if (map.getSize().x) this.#emit('view-framed', { bounds: this.bounds() });
  }

  /**
   * The views told last (view-change), as vue= rounds them (viewKey): given back (the page writing them down), not
   * applied — the map is there, or was a moment ago. @type {string[]}
   */
  #told = [];

  /** A hand on the map now: a drag, or the 3D map moving under a gesture (a pan, a pinch, a turn, a tilt). */
  #inGesture() {
    const gl = this.#gl?.on ? /** @type {any} */ (this.#gl).glMap : null;
    const recent = this.#handAt && performance.now() - this.#handAt < 4000;
    return Boolean((recent && gl?.isMoving?.()) || /** @type {any} */ (this.#map)?.dragging?.moving?.());
  }

  /** For a moment, a change of size keeps the view as it is (no framing again): a pane beside it resized by hand. */
  holdFrame() { this.#holdUntil = performance.now() + 1500; }
  #holdUntil = 0;

  /** Current zoom level (null before the map exists). */
  zoom() { return this.#map ? this.#map.getZoom() : null; }

  /** Where [lon, lat] is in the map's box (px from its top left corner); null before the map exists. @param {[number, number]} lonLat */
  pointOf([lon, lat]) {
    const p = this.#map?.latLngToContainerPoint([lat, lon]);
    return p ? { x: p.x, y: p.y } : null;
  }

  /** The place [lon, lat] at a point of the map's box (px from its top left corner). @param {number} x @param {number} y @returns {[number, number] | null} */
  placeAt(x, y) {
    const c = this.#map?.containerPointToLatLng([x, y]);
    return c ? [c.lng, c.lat] : null;
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
    this.#lastFit = 'frame';
    this.#framedBounds = bounds;
    const opts = { paddingTopLeft: /** @type {[number, number]} */ ([40, 56]), paddingBottomRight: /** @type {[number, number]} */ ([40, 40 + bottom]), maxZoom: /** @type {any} */ (frame).maxZoom || (single ? 18 : 19) };
    this.#framedMax = opts.maxZoom;
    this.#selfMove();
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
    this.#selfMove();
    if (points.length === 1) {
      const [lon, lat] = points[0];
      map.setView([lat, lon], 17);
    } else {
      map.fitBounds(L.latLngBounds(points.map(([lon, lat]) => [lat, lon])), { padding: [40, 40], maxZoom: 17 });
    }
  }

  /** Centers the map on a spot or point. @param {[number, number]} coordinates @param {number} [zoom] */
  flyTo([lon, lat], zoom) {
    this.#selfMove();
    this.#map?.flyTo([lat, lon], zoom ?? Math.max(this.#map.getZoom(), 16), { duration: 0.6 });
  }

  /** @param {boolean} follow */
  #setFollow(follow) {
    this.#follow = follow;
    this.#buttons?.querySelector('.locate')?.setAttribute('aria-pressed', String(follow));
  }

  #locate() {
    this.#asked = true;
    this.#locating = !this.#fix;
    // Refused or unavailable before: asked anew (the shared watch starts again for a newcomer after a failure).
    if (this.#geoFailed && this.#unwatch) { this.#unwatch(); this.#unwatch = null; }
    if (!this.track) {
      this.track = true;
    } else this.#syncTracking();
    this.#setFollow(true);
    if (this.#fix) {
      const [lon, lat] = this.#fix;
      this.#selfMove();
      this.#map?.flyTo([lat, lon], Math.max(this.#map.getZoom(), 17), { duration: 0.6 });
    }
  }

  #buildButtons() {
    const buttons = this.#buttons = Object.assign(document.createElement('div'), { className: 'gf-map-buttons' });
    // With the search pill, the layers button lives at its end; otherwise it is a round button like "locate".
    // eslint-disable-next-line no-unsanitized/property -- fixed markup and bundled icons, no data in it
    buttons.innerHTML = `
      ${this.#hasSearch || this.noLayers ? '' : `<button type="button" class="layers" aria-label="Carte : fond, couches, légende" title="Carte : fond, couches, légende">${iconMarkup('layers')}</button>`}
      ${this.noLayers ? '' : `<button type="button" class="opacity" aria-label="Opacité des couches" title="Opacité des couches" aria-expanded="false" hidden>${iconMarkup('sliders')}</button>`}
      <button type="button" class="locate" aria-label="Me localiser" title="Me localiser" aria-pressed="false">${iconMarkup('crosshair')}</button>
      <button type="button" class="edit" aria-label="Modifier les positions" title="Modifier les positions" aria-pressed="false" hidden>${iconMarkup('pencil')}</button>`;
    buttons.querySelector('.locate')?.addEventListener('click', () => this.#locate());
    buttons.querySelector('.layers')?.addEventListener('click', () => this.openPanel());
    buttons.querySelector('.opacity')?.addEventListener('click', () => this.#toggleOpacity());
    buttons.querySelector('.edit')?.addEventListener('click', () => {
      this.#setEditing(!this.editing);
    });
    L.DomEvent.disableClickPropagation(buttons);
    this.#root.append(buttons);
    this.#syncButtons();
    this.#syncOpacity();
  }

  // ── The overlays' opacity, at hand: a button among the map's (when overlays are shown), a card with a slider each ──

  /** The card of the overlays' opacity, open or not; the opacity while a slider moves (key → 0…1). */
  #opacityOpen = false;
  /** @type {Map<string, number>} */ #opacityLive = new Map();
  /** @type {HTMLElement | null} */ #opacityCard = null;

  /** Its card opened (its first slider focused) or closed (its button focused again). */
  #toggleOpacity() {
    this.#opacityOpen = !this.#opacityOpen;
    this.#syncOpacity();
    const at = this.#opacityOpen ? this.#opacityCard?.querySelector('input') : this.#buttons?.querySelector('.opacity');
    /** @type {HTMLElement | null | undefined} */ (at)?.focus();
  }

  /** The button shown when overlays are, the card drawn with one slider each (the top one first), or closed. */
  #syncOpacity() {
    const button = /** @type {HTMLButtonElement | null | undefined} */ (this.#buttons?.querySelector('.opacity'));
    const keys = [...this.#overlays].reverse();
    if (button) { button.hidden = !keys.length; button.setAttribute('aria-expanded', String(this.#opacityOpen && keys.length > 0)); }
    if (!keys.length || !button) this.#opacityOpen = false;
    if (!this.#opacityOpen) { if (this.#opacityCard) this.#opacityCard.hidden = true; return; }
    if (!this.#opacityCard) {
      const card = this.#opacityCard = Object.assign(document.createElement('section'), { className: 'gf-opacity' });
      card.setAttribute('aria-label', 'Opacité des couches');
      for (const type of ['mousedown', 'touchstart', 'wheel', 'dblclick', 'contextmenu', 'pointerdown']) card.addEventListener(type, e => e.stopPropagation());
      card.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); this.#toggleOpacity(); } });
      this.#root.append(card);
    }
    this.#opacityCard.hidden = false;
    const slide = (/** @type {string} */ key, /** @type {Event} */ e, /** @type {boolean} */ commit) => {
      const v = Number(/** @type {HTMLInputElement} */ (e.target).value) / 100;
      if (commit) this.#opacityLive.delete(key); else this.#opacityLive.set(key, v);
      this.#setOpacity(key, v, commit);
      this.#syncOpacity();
    };
    render(html`<div class="gf-opacity-head"><b>Opacité des couches</b>
        <button type="button" aria-label="Fermer" title="Fermer" @click=${() => this.#toggleOpacity()}>${icon('x-lg')}</button></div>
      <ul>${keys.map(key => {
        const name = overlayDef(key)?.label ?? key;
        const pct = Math.round((this.#opacityLive.get(key) ?? this.#opacityOf(key)) * 100);
        return html`<li><span class="name" title=${name}>${name}</span>
          <input type="range" min="0" max="100" step="5" .value=${String(pct)} aria-label=${'Opacité de ' + name} aria-valuetext=${pct + ' %'}
            @input=${(/** @type {Event} */ e) => slide(key, e, false)} @change=${(/** @type {Event} */ e) => slide(key, e, true)} /><output>${pct} %</output></li>`;
      })}</ul>`, this.#opacityCard);
  }

  get #hasSearch() { return this.search && !this.noSearch; }

  /** The search pill and the round buttons made again (the search given or taken back): the layers button goes in the pill, or out of it. */
  #rebuildControls() {
    this.#buttons?.remove();
    this.querySelector('gf-map-search')?.remove();
    this.#buildButtons();
    this.toggleAttribute('search', this.#hasSearch);
    if (this.#hasSearch) this.#buildSearch();
    this.#syncState();
  }

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
    const search = Object.assign(document.createElement('gf-map-search'), { className: 'gf-map-search', noPanel: this.noLayers });
    search.addEventListener('open-panel', () => this.openPanel());
    search.addEventListener('place-pick', (/** @type {any} */ e) => {
      const [lon, lat] = e.detail.coordinates;
      this.#setFollow(false);
      this.#selfMove();
      this.#map?.flyTo([lat, lon], Math.max(this.#map.getZoom(), 15), { duration: 0.6 });
      this.showPoint(e.detail.coordinates, e.detail.label);
    });
    L.DomEvent.disableClickPropagation(search);
    L.DomEvent.disableScrollPropagation(search);
    this.#root.append(search);
    this.#syncState();
  }

  /**
   * The panel ▦ « Carte » (gf-map-panel.js), the home of the maps' look: its options (gf-map-options.js: 2D / 3D and the
   * 3D options — gf-map-gl.js tells the panel how this map is drawn —, the background, IGN's layers: the common look,
   * or this map's own), its state, legend, sources. Every map has its button: round among the map's buttons, or at
   * the end of the search pill.
   */
  openPanel() {
    if (!this.#panel) {
      const panel = this.#panel = document.createElement('gf-map-panel');
      // Its options (gf-map-options.js): kept inside the map — it decides where each change goes.
      const on = (/** @type {string} */ type, /** @type {(d: any) => void} */ fn) => panel.addEventListener(type, (/** @type {any} */ e) => { e.stopPropagation(); fn(e.detail); });
      on('look-edit', d => this.#editLook(d.patch));
      on('look-preview', d => this.#setOpacity(d.key, d.opacity, false));
      on('look-common', () => this.#commonLook());
      on('renderer-follow', () => this.#emit('renderer-follow', {}));
      on('distribution-toggle', d => {
        this.#distributionOn = d.on;
        setMapDistribution(d.on);
        this.#syncDistribution();
        if (this.#panel) Object.assign(this.#panel, this.#distributionInfo());
      });
      this.#root.append(panel);
    }
    Object.assign(this.#panel, { ...this.#lookInfo(), own3d: this.own3d, legend: this.legend, legendLines: this.#legendLines, ...this.#distributionInfo() });
    this.#syncState();
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
    this.#emit('point-info', { coordinates: point, label });
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
    this.#layers[key] ??= tileLayer(key, this.minZoom, this.#opacityOf(key));
    return this.#layers[key];
  }

  /** An overlay's opacity on this map (its look's; the usual one when it says none). @param {string} key */
  #opacityOf(key) { return this.#opacities[key] ?? DEFAULT_OPACITY; }

  /** The look it shows: its own over the common one (core/map-settings.js lookFor). */
  get lookShown() { return lookFor(this.#own); }

  /** What its panel shows of its look: the look, what of it is its own, why that is kept (its owner's). */
  #lookInfo() { return { look: this.lookShown, own: this.#own, lookWhy: this.lookWhy }; }

  /** The common look changed (here, on another map, in Réglages, in another tab): followed for what is not its own. */
  #onCommonLook = () => { if (this.#map) this.#showLook(); };

  /**
   * Shows its look now (its own over the common one): the background, the overlays in their order, their opacity —
   * only what differs. Never told back.
   */
  #showLook() {
    const map = this.#map;
    if (!map) return;
    const look = this.lookShown;
    if (look.base !== this.#base) this.#setBase(look.base);
    const before = this.#opacities;
    this.#opacities = look.opacities;
    this.#showOverlays(look.overlays.filter(isOverlay));
    for (const key of this.#overlays) {
      // A layer of several (reserves: a group) has its opacity on each of them. Its look's changed: set, and in 3D
      // drawn again — even when its slider here already gave it to the 2D layer (the 3D map draws only what is added).
      const layer = /** @type {any} */ (this.#layers[key]);
      const at = (layer?.getLayers?.()[0] ?? layer)?.options?.opacity;
      const now = this.#opacityOf(key);
      if (Math.abs((at ?? -1) - now) > 0.001 || Math.abs((before[key] ?? DEFAULT_OPACITY) - now) > 0.001) this.#setOpacity(key, now, true, true);
    }
    if (this.#panel) Object.assign(this.#panel, this.#lookInfo());
    this.#syncOpacity();
  }

  /**
   * A change of its look made on it (its panel, its opacity card, setBase): the common look's when it follows it (every
   * map then follows, this one too); else its own — shown, and told to its owner (`look-change`). Its overlays and
   * their opacity go together: changing one makes both its own.
   * @param {Partial<import('../core/map-settings.js').MapLook>} patch
   */
  #editLook(patch) {
    if (!this.#own) { setMapLook(patch); return; }
    const now = this.lookShown;
    /** @type {Partial<import('../core/map-settings.js').MapLook>} */
    const own = { ...this.#own };
    if (patch.base) own.base = patch.base;
    if (typeof patch.names === 'boolean') own.names = patch.names;
    if (patch.overlays || patch.opacities) {
      own.overlays = [...(patch.overlays ?? now.overlays)];
      own.opacities = { ...(patch.opacities ?? now.opacities) };
    }
    this.#own = own;
    this.#showLook();
    this.#emit('look-change', { look: own });
  }

  /** « Revenir aux réglages communs »: its own look let go, the common one shown; told to its owner. */
  #commonLook() {
    this.#own = null;
    this.#showLook();
    this.#emit('look-change', { look: null });
  }

  /** The background shown (its look's). `base-shown` {base} after. @param {import('../core/backgrounds.js').BaseKey} key */
  #setBase(key) {
    const map = /** @type {L.Map} */ (this.#map);
    if (key === this.#base || !isBaseKey(key)) return;
    this.#layer(this.#base).remove();
    this.#base = key;
    toBack(this.#layer(key).addTo(map));
    this.#emit('base-shown', { base: key });
  }

  /**
   * The overlays of its look, in their order (the last on top): those not among them taken off, the others put on,
   * restacked. @param {string[]} keys
   */
  #showOverlays(keys) {
    const map = /** @type {L.Map} */ (this.#map);
    if (keys.join('\n') === this.#overlays.join('\n')) return;
    for (const k of this.#overlays) if (!keys.includes(k)) this.#layer(k).remove();
    const was = new Set(this.#overlays);
    this.#overlays = [...keys];
    for (const k of keys) {
      const l = this.#layer(k);
      // In 3D, put back in order: the 3D map draws them anew.
      if (was.has(k) && this.#gl?.on) l.remove();
      if (!map.hasLayer(l)) l.addTo(map);
    }
    this.#restack();
    this.#syncOpacity();
  }

  /** The background shown now (core/backgrounds.js: 'plan', 'photo', 'photo:2016-2020', 'spot:2020'…). */
  get baseShown() { return this.#base; }

  /**
   * Another background shown, as its panel's choice is: the common look's when it follows it, else its own
   * (`look-change`). `base-shown` {base} after. @param {import('../core/backgrounds.js').BaseKey} key
   */
  setBase(key) { if (this.#map && isBaseKey(key) && key !== this.#base) this.#editLook({ base: key }); }

  /** The overlays drawn in their order (the last on top), over the background and under GBIF's layers (20, 21). */
  #restack() {
    this.#overlays.forEach((key, i) => {
      const layer = /** @type {any} */ (this.#layers[key]);
      if (!layer) return;
      for (const l of layer.eachLayer ? layer.getLayers() : [layer]) l.setZIndex?.(Math.min(19, 2 + i));
    });
  }

  /**
   * An overlay's opacity on the map: shown at once (a slider moving), kept when let go (`commit`: a change of its look,
   * #editLook — unless `shown`, its look's already). In 3D the overlay is put back on the map once committed, so the
   * 3D map (which mirrors the 2D one's layers as they are added) draws it again.
   * @param {string} key @param {number} opacity @param {boolean} commit @param {boolean} [shown] its look's already (not a change)
   */
  #setOpacity(key, opacity, commit, shown = false) {
    const value = Math.round(Math.min(1, Math.max(0, Number(opacity) || 0)) * (commit ? 20 : 100)) / (commit ? 20 : 100);
    if (commit && !shown) { this.#editLook({ opacities: { ...this.#opacities, [key]: value } }); return; }
    const layer = /** @type {any} */ (this.#layers[key]);
    if (!layer) return;
    for (const l of layer.eachLayer ? layer.getLayers() : [layer]) l.setOpacity?.(value);
    if (commit && this.#gl?.on && this.#overlays.includes(key)) {
      const map = /** @type {L.Map} */ (this.#map);
      layer.remove();
      layer.addTo(map);
    }
  }

  /** What the panel says of the GBIF layer: nothing without a plant (or with GBIF off). */
  #distributionInfo() {
    // Set by its owner (map block): not a panel choice.
    if (this.distributionOn) return { distribution: null, distributionOn: false };
    return { distribution: this.distribution && moduleOn('gbif') ? this.distribution.label : null, distributionOn: this.#distributionOn };
  }
}

customElements.define('gf-map', GfMap);
