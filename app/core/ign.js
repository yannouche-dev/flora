// @ts-check
// IGN Géoplateforme (free, no API key): its WMTS layers as Leaflet tile layers. The layers themselves (overlays, the
// catalogue's added, opacities) are core/ign-layers.js's, without Leaflet: re-exported here; « Noms et réseaux » over
// the photos and SPOT's images core/map-layers.js's; the backgrounds core/backgrounds.js's.

import * as L from 'leaflet';
import { moduleOn } from './modules.js';
import { defaultOpacity, overlayDef, wmtsUrl } from './ign-layers.js';
import { parseBase, takesLandmarks } from './backgrounds.js';
import { LANDMARKS, LANDMARK_MAX_ZOOM } from './map-layers.js';

export { OVERLAYS, wmtsUrl, isOverlay, overlayDef, addCatalogLayer, defaultOpacity } from './ign-layers.js';

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
 *   when fixed (« Noms et réseaux »: over every overlay, not past LANDMARK_MAX_ZOOM — class gf-capped: the 3D map hides
 *   it past that zoom too, core/gl-style.js)
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
    className: 'gf-tiles-' + key + (def.grey ? ' gf-grey' : '') + (fixed.maxZoom ? ' gf-capped' : ''),
    ...fixed
  });
}

/**
 * The place of « Noms et réseaux » among the map's tile layers (Leaflet's z-index, the 3D map's order: gf-map-gl.js),
 * one above the other from it in core/map-layers.js LANDMARKS' order (the boundaries 14 … the places' names 19; the
 * roads, the rivers and the names where they were before the others came): over the background (1, or under) and every
 * overlay (2 … LANDMARK_Z - 1, gf-map.js), under GBIF's distribution (20, 21) and the observations' tiles (23 on).
 */
export const LANDMARK_Z = 14;

/**
 * « Noms et réseaux » drawn over this background and these overlays: those the look says (`landmarks`), bottom first —
 * none on the plan, which has its own (core/backgrounds.js takesLandmarks), nor one an overlay already shows (« Cours
 * d'eau » of a cell's layers=hydro, the catalogue's « Hydrographie », « Routes », « Noms »: the same WMTS layer), drawn
 * there only, at its place and its opacity, never twice. @param {readonly string[]} landmarks @param {readonly string[]} overlays
 * @param {unknown} base @returns {string[]} their keys
 */
export function landmarksShown(landmarks, overlays, base) {
  if (!takesLandmarks(base)) return [];
  const shown = new Set(overlays.flatMap(key => overlayDef(key)?.layers.map(l => l.id) ?? []));
  return LANDMARKS.filter(l => landmarks.includes(l.key) && !shown.has(l.layer.id)).map(l => l.key);
}

/**
 * A background map (core/backgrounds.js: one of a year, the greyed photos under it, is a group of both, bottom first),
 * one of « Noms et réseaux » (core/map-layers.js LANDMARKS: at its place from LANDMARK_Z) or an overlay as one Leaflet
 * layer. `minZoom`: from how far out it shows (the IGN plan and photos cover the whole world at small scales; 5 frames
 * France; a year's photos from one zoom before their own first, an overlay and « Noms et réseaux » from their own
 * first); `opacity`: an overlay's (the map's look), a background and « Noms et réseaux » always opaque.
 * @param {string} key @param {number} [minZoom] @param {number} [opacity]
 */
export function tileLayer(key, minZoom, opacity = defaultOpacity(key)) {
  const mark = LANDMARKS.findIndex(l => l.key === key);
  if (mark >= 0) return wmts(LANDMARKS[mark].layer, key, 1, minZoom, 0, { zIndex: LANDMARK_Z + mark, maxZoom: LANDMARK_MAX_ZOOM });
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
