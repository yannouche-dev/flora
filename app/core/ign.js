// @ts-check
// IGN Géoplateforme (free, no API key): its WMTS layers as Leaflet tile layers. The layers themselves (backgrounds,
// overlays, the catalogue's added, opacities) are core/ign-layers.js's, without Leaflet: re-exported here.

import * as L from 'leaflet';
import { moduleOn } from './modules.js';
import { BASES, DEFAULT_OPACITY, overlayDef, wmtsUrl } from './ign-layers.js';

export { BASES, OVERLAYS, wmtsUrl, isOverlay, overlayDef, addCatalogLayer, DEFAULT_OPACITY } from './ign-layers.js';

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

/** @param {WmtsLayer} def @param {string} key @param {number} opacity @param {number} [minZoom] how far out the map goes */
function wmts(def, key, opacity, minZoom = 5) {
  const Layer = moduleOn('ignMaps') ? L.TileLayer : CachedTileLayer;
  return new Layer(wmtsUrl(def), {
    attribution: ATTRIBUTION,
    minNativeZoom: def.minNative ?? 0,
    maxNativeZoom: def.maxNative ?? 19,
    minZoom: Math.max(minZoom, def.minNative ?? minZoom),
    maxZoom: 21,
    // CORS requests give the service worker readable responses (opaque ones cost ~7 MB of quota each).
    crossOrigin: 'anonymous',
    opacity,
    className: 'gf-tiles-' + key
  });
}

/**
 * A background map or an overlay as one Leaflet layer. `minZoom`: from how far out it shows (the IGN plan and
 * photos cover the whole world at small scales; 5 frames France); `opacity`: an overlay's (the map's look), a
 * background always opaque.
 * @param {string} key @param {number} [minZoom] @param {number} [opacity]
 */
export function tileLayer(key, minZoom, opacity = DEFAULT_OPACITY) {
  const base = key in BASES;
  const def = base ? BASES[/** @type {'photo' | 'plan'} */ (key)] : /** @type {LayerDef} */ (overlayDef(key));
  const layers = def.layers.map(l => wmts(l, key, base ? 1 : opacity, minZoom));
  return layers.length === 1 ? layers[0] : L.layerGroup(layers);
}

// The catalogue itself (the copy shipped with the app, refreshed from GetCapabilities): app/core/ign-catalog.js.

/** The whole world (inhabited latitudes), for a map showing a worldwide distribution. */
export const WORLD_BOUNDS = L.latLngBounds([-56, -170], [75, 180]);

/** Metropolitan France, for the initial view when there is nothing else to show. */
export const FRANCE_BOUNDS = L.latLngBounds([41.3, -5.2], [51.1, 9.6]);
