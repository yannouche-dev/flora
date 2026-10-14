// @ts-check
// IGN Géoplateforme (free, no API key): WMTS layers as Leaflet tile layers, plus geocoding and altimetry.
// Layer identifiers and styles checked against the service's GetCapabilities.

import * as L from 'leaflet';
import { moduleOn } from './modules.js';
import { config } from '../config.js';

const WMTS = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&TILEMATRIXSET=PM'
  + '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}';

export const ATTRIBUTION = '© <a href="https://geoservices.ign.fr/" target="_blank" rel="noopener">IGN – Géoplateforme</a>';

/**
 * @typedef {{ id: string, format: string, style?: string, minNative?: number, maxNative?: number }} WmtsLayer
 * @typedef {{ label: string, layers: WmtsLayer[], hint?: string, group?: string }} LayerDef
 */

/** Background maps (one at a time). @type {Record<'photo' | 'plan', LayerDef>} */
export const BASES = {
  photo: { label: 'Photos aériennes', layers: [{ id: 'ORTHOIMAGERY.ORTHOPHOTOS', format: 'image/jpeg', maxNative: 19 }] },
  plan: { label: 'Plan IGN', layers: [{ id: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', format: 'image/png', maxNative: 19 }] }
};

/** Overlays, toggled on top. Protected areas: INPN / PatriNat data served by the Géoplateforme. @type {Record<string, LayerDef>} */
export const OVERLAYS = {
  cadastre: { label: 'Parcelles cadastrales', group: 'terrain', layers: [{ id: 'CADASTRALPARCELS.PARCELLAIRE_EXPRESS', format: 'image/png', maxNative: 19 }] },
  contours: { label: 'Courbes de niveau', group: 'terrain', layers: [{ id: 'ELEVATION.CONTOUR.LINE', format: 'image/png', minNative: 6, maxNative: 18 }] },
  forets: {
    label: 'Forêts publiques', group: 'rules', hint: 'ONF : domaniales et communales',
    layers: [{ id: 'FORETS.PUBLIQUES', format: 'image/png', style: 'FORETS PUBLIQUES ONF', minNative: 3, maxNative: 16 }]
  },
  parcs: { label: 'Parcs nationaux', group: 'rules', layers: [{ id: 'Patrinat_PN', format: 'image/png', minNative: 6, maxNative: 16 }] },
  reserves: {
    label: 'Réserves naturelles', group: 'rules', hint: 'nationales et régionales',
    layers: [{ id: 'Patrinat_RNN', format: 'image/png', minNative: 6, maxNative: 16 }, { id: 'Patrinat_RNR', format: 'image/png', minNative: 6, maxNative: 16 }]
  },
  biotopes: { label: 'Protection de biotope', group: 'rules', hint: 'arrêtés préfectoraux (APPB)', layers: [{ id: 'Patrinat_APB', format: 'image/png', minNative: 6, maxNative: 16 }] }
};

/**
 * Tiles from the browser's tile cache only (module « IGN – fonds de carte » switched off): areas seen
 * before still show, the rest stays blank, and the network is never used.
 */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const CachedTileLayer = L.TileLayer.extend({
  createTile(/** @type {any} */ coords, /** @type {(error: any, tile: HTMLElement) => void} */ done) {
    const tile = document.createElement('img');
    tile.alt = '';
    const url = this.getTileUrl(coords);
    const show = (/** @type {Blob | null} */ blob) => {
      // Not seen before: a transparent pixel, so no broken-image outline.
      if (!blob) { tile.onload = () => done(null, tile); tile.src = BLANK; return; }
      const src = URL.createObjectURL(blob);
      tile.onload = () => { URL.revokeObjectURL(src); done(null, tile); };
      tile.onerror = () => { URL.revokeObjectURL(src); done(null, tile); };
      tile.src = src;
    };
    (typeof caches === 'undefined' ? Promise.resolve(undefined) : caches.match(url))
      .then(response => response ? response.blob() : null)
      .then(show, () => show(null));
    return tile;
  }
});

/** A WMTS layer's tile address ({z}/{x}/{y} to fill): the same for Leaflet and MapLibre (gl-style.js). @param {WmtsLayer} def */
export const wmtsUrl = def => `${WMTS}&LAYER=${def.id}&STYLE=${encodeURIComponent(def.style || 'normal')}&FORMAT=${encodeURIComponent(def.format)}`;

/** @param {WmtsLayer} def @param {boolean} base @param {string} key @param {number} [minZoom] how far out the map goes */
function wmts(def, base, key, minZoom = 5) {
  const Layer = moduleOn('ignMaps') ? L.TileLayer : CachedTileLayer;
  return new Layer(wmtsUrl(def), {
    attribution: ATTRIBUTION,
    minNativeZoom: def.minNative ?? 0,
    maxNativeZoom: def.maxNative ?? 19,
    minZoom: Math.max(minZoom, def.minNative ?? minZoom),
    maxZoom: 21,
    // CORS requests give the service worker readable responses (opaque ones cost ~7 MB of quota each).
    crossOrigin: 'anonymous',
    opacity: base ? 1 : overlayOpacity(key),
    className: 'gf-tiles-' + key
  });
}

/**
 * A background map or an overlay as one Leaflet layer. `minZoom`: from how far out it shows (the IGN plan and
 * photos cover the whole world at small scales; 5 frames France).
 * @param {string} key @param {number} [minZoom]
 */
export function tileLayer(key, minZoom) {
  const base = key in BASES;
  const def = base ? BASES[/** @type {'photo' | 'plan'} */ (key)] : /** @type {LayerDef} */ (overlayDef(key));
  const layers = def.layers.map(l => wmts(l, base, key, minZoom));
  return layers.length === 1 ? layers[0] : L.layerGroup(layers);
}

// ── Every IGN layer ──────────────────────────────────────────────────────────

/** A layer of IGN's whole WMTS catalogue (GetCapabilities), compact and classified. @typedef {import('../../lib/ign-catalog.mjs').CatalogLayer} CatalogLayer */

/** A layer of the catalogue, as an overlay key. */
export const IGN_PREFIX = 'ign:';
const SAFE_ID = /^[A-Za-z0-9._:-]{1,160}$/;

/** The catalogue's layers added to the maps (key → definition), kept so they show at once and offline. @type {Map<string, LayerDef>} */
const added = new Map();
try {
  const saved = JSON.parse(localStorage.getItem(config.storageKeys.ignLayers) || '{}');
  for (const [key, def] of Object.entries(saved)) if (key.startsWith(IGN_PREFIX) && SAFE_ID.test(def?.layers?.[0]?.id || '')) added.set(key, def);
} catch { /* none */ }

/** An overlay the maps know: one of the app's, or a layer of the catalogue added. @param {string} key */
export const isOverlay = key => key in OVERLAYS || added.has(key);

/** Its definition (null: unknown). @param {string} key @returns {LayerDef | null} */
export const overlayDef = key => OVERLAYS[key] || added.get(key) || null;

/** The catalogue's layers added, in the order they were. */
export const addedLayers = () => [...added.keys()];

/**
 * A layer of the catalogue made an overlay (kept for next time): its readable title, with its variant for one of a
 * series (« Photographies aériennes par année — 1950-1965 »). @param {CatalogLayer} l @returns {string} its key
 */
export function addCatalogLayer(l) {
  const key = IGN_PREFIX + l.id;
  if (!SAFE_ID.test(l.id) || !/^image\/(png|jpeg)$/.test(l.format)) return key;
  const label = l.group && l.gtitle ? `${l.gtitle} — ${l.variant || l.title}` : l.label || l.title || l.id;
  added.set(key, { label, hint: l.id, group: 'ign', layers: [{ id: l.id, format: l.format, style: l.style || 'normal', minNative: l.minNative, maxNative: l.maxNative }] });
  try { localStorage.setItem(config.storageKeys.ignLayers, JSON.stringify(Object.fromEntries(added))); } catch { /* not kept */ }
  return key;
}

/**
 * The catalogue layer that is one of the app's own overlays (« Forêts publiques », « Parcs nationaux »…): its key, so
 * the list toggles that one rather than a copy of it. @param {string} id @returns {string | null}
 */
export function builtinKeyOf(id) {
  for (const [key, def] of Object.entries(OVERLAYS)) if (def.layers.length === 1 && def.layers[0].id === id) return key;
  return null;
}

// ── Opacity of each overlay ──────────────────────────────────────────────────

/** An overlay's opacity unless chosen (the backgrounds are opaque). */
export const DEFAULT_OPACITY = 0.8;

/** The opacity chosen for each overlay (key → 0…1), kept on the device for every map. @type {Record<string, number>} */
let opacities = {};
try {
  const saved = JSON.parse(localStorage.getItem(config.storageKeys.overlayOpacity) || '{}');
  if (saved && typeof saved === 'object') for (const [k, v] of Object.entries(saved)) if (typeof v === 'number' && v >= 0 && v <= 1) opacities[k] = v;
} catch { /* none */ }

/** An overlay's opacity (0…1). @param {string} key */
export const overlayOpacity = key => opacities[key] ?? DEFAULT_OPACITY;

/** Sets an overlay's opacity (0…1, by 0.05), kept for next time. @param {string} key @param {number} value */
export function setOverlayOpacity(key, value) {
  const v = Math.round(Math.min(1, Math.max(0, Number(value) || 0)) * 20) / 20;
  opacities = { ...opacities, [key]: v };
  if (v === DEFAULT_OPACITY) delete opacities[key];
  try { localStorage.setItem(config.storageKeys.overlayOpacity, JSON.stringify(opacities)); } catch { /* not kept */ }
  return v;
}

// The catalogue itself (the copy shipped with the app, refreshed from GetCapabilities): app/core/ign-catalog.js.

/** The whole world (inhabited latitudes), for a map showing a worldwide distribution. */
export const WORLD_BOUNDS = L.latLngBounds([-56, -170], [75, 180]);

/** Metropolitan France, for the initial view when there is nothing else to show. */
export const FRANCE_BOUNDS = L.latLngBounds([41.3, -5.2], [51.1, 9.6]);
