// The little of Leaflet that app/core/ign.js uses while loading (a tile layer class it extends, bounds it builds).
class Layer {
  /** @param {object} proto */
  static extend(proto) { return class extends this {}; }
}
export class TileLayer extends Layer {}
/** @type {any} */ (TileLayer).WMS = class extends Layer {};
export const tileLayer = () => ({});
export const layerGroup = () => ({});
export const latLng = (/** @type {number} */ lat, /** @type {number} */ lng) => ({ lat, lng });
export const latLngBounds = (/** @type {any} */ a, /** @type {any} */ b) => ({ a, b });
export const Util = { template: (/** @type {string} */ s) => s };
