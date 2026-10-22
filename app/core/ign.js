// @ts-check
// IGN Géoplateforme (free, no API key): its WMTS layers as Leaflet tile layers. The layers themselves (overlays, the
// catalogue's added, opacities) are core/ign-layers.js's, without Leaflet: re-exported here; the backgrounds, and the
// names over the photos and SPOT's images, are core/backgrounds.js's.

import * as L from 'leaflet';
import { moduleOn } from './modules.js';
import { DEFAULT_OPACITY, overlayDef, wmtsUrl } from './ign-layers.js';
import { NAMES, NAMES_LAYERS, parseBase } from './backgrounds.js';

export { OVERLAYS, wmtsUrl, isOverlay, overlayDef, addCatalogLayer, DEFAULT_OPACITY } from './ign-layers.js';

/** @typedef {import('./ign-layers.js').WmtsLayer} WmtsLayer @typedef {import('./ign-layers.js').LayerDef} LayerDef */

const ATTRIBUTION = '© <a href="https://geoservices.ign.fr/" target="_blank" rel="noopener">IGN – Géoplateforme</a>';

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

/**
 * @param {WmtsLayer & { grey?: boolean }} def `grey`: without its colours (the most recent photos under a year's: map.css)
 * @param {string} key @param {number} opacity @param {number} [minZoom] how far out the map goes
 * @param {number} [under] zooms before its first native one it still shows, its tiles made smaller (a background's: 1 —
 *   the photos of a year from zoom 5, France whole on a phone; an overlay's never, a far one would ask too many tiles)
 * @param {{ zIndex?: number, maxZoom?: number }} [fixed] its place among the map's tile layers, how far in it shows,
 *   when fixed (the names: over every overlay, not past one zoom after their last native one)
 */
function wmts(def, key, opacity, minZoom = 5, under = 0, fixed = {}) {
  const Layer = moduleOn('ignMaps') ? L.TileLayer : CachedTileLayer;
  return new Layer(wmtsUrl(def), {
    attribution: ATTRIBUTION,
    minNativeZoom: def.minNative ?? 0,
    maxNativeZoom: def.maxNative ?? 19,
    minZoom: Math.max(minZoom, (def.minNative ?? minZoom) - under),
    maxZoom: 21,
    // CORS requests give the service worker readable responses (opaque ones cost ~7 MB of quota each).
    crossOrigin: 'anonymous',
    opacity,
    className: 'gf-tiles-' + key + (def.grey ? ' gf-grey' : ''),
    ...fixed
  });
}

/**
 * The names' place among the map's tile layers (Leaflet's z-index, the 3D map's order: gf-map-gl.js), their roads,
 * rivers and names one above the other from it: over the background (1, or under) and every overlay (2 … NAMES_Z - 1,
 * gf-map.js), under GBIF's distribution (20, 21) and the observations' tiles (23 on).
 */
export const NAMES_Z = 17;

/**
 * The names' layers drawn over these overlays (core/backgrounds.js NAMES_LAYERS' identifiers, bottom first): all but
 * one an overlay already shows (« Cours d'eau », the catalogue's « Hydrographie », « Routes », « Noms »: the same WMTS
 * layer) — drawn there only, at its place and its opacity, never twice. @param {string[]} overlays @returns {string[]}
 */
export function namesOver(overlays) {
  const shown = new Set(overlays.flatMap(key => overlayDef(key)?.layers.map(l => l.id) ?? []));
  return NAMES_LAYERS.map(l => l.id).filter(id => !shown.has(id));
}

/**
 * A background map (core/backgrounds.js: one of a year, the greyed photos under it, is a group of both, bottom first),
 * the names over it (NAMES: a group of three, at NAMES_Z and above, in NAMES_LAYERS' order) or an overlay as one
 * Leaflet layer. `minZoom`: from how far out it shows (the IGN plan and photos cover the whole world at small scales; 5
 * frames France; a year's photos from one zoom before their own first, an overlay and the names from their own first);
 * `opacity`: an overlay's (the map's look), a background and the names always opaque.
 * @param {string} key @param {number} [minZoom] @param {number} [opacity]
 */
export function tileLayer(key, minZoom, opacity = DEFAULT_OPACITY) {
  // The names one zoom past their last native one, not further: their words twice as big there, never eight times
  // (zoom 21, a plant's).
  if (key === NAMES) return L.layerGroup(NAMES_LAYERS.map((l, i) => wmts(l, key, 1, minZoom, 0, { zIndex: NAMES_Z + i, maxZoom: (l.maxNative ?? 19) + 1 })));
  const background = parseBase(key);
  const layers = background ? background.layers.map(l => wmts(l, key, 1, minZoom, 1))
    : /** @type {LayerDef} */ (overlayDef(key)).layers.map(l => wmts(l, key, opacity, minZoom));
  return layers.length === 1 ? layers[0] : L.layerGroup(layers);
}

// The catalogue itself (the copy shipped with the app, refreshed from GetCapabilities): app/core/ign-catalog.js.

/** The whole world (inhabited latitudes), for a map showing a worldwide distribution. */
export const WORLD_BOUNDS = L.latLngBounds([-56, -170], [75, 180]);

/** Metropolitan France, for the initial view when there is nothing else to show. */
export const FRANCE_BOUNDS = L.latLngBounds([41.3, -5.2], [51.1, 9.6]);
