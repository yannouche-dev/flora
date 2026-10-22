// The little of Leaflet that app/core/ign.js uses while loading (a tile layer class it extends, bounds it builds), and
// what its tile layers are made of (their address, their options; a group's layers: tests/unit/gl-style.test.mjs).
class Layer {
  /** @param {string} [url] @param {Record<string, any>} [options] */
  constructor(url, options) { this._url = url; this.options = options ?? {}; }
  /** @param {object} proto */
  static extend(proto) { return class extends this {}; }
}
export class TileLayer extends Layer {}
/** @type {any} */ (TileLayer).WMS = class extends Layer {};
export const tileLayer = () => ({});
export const layerGroup = (/** @type {any[]} */ layers = []) => ({ getLayers: () => [...layers] });
export const latLng = (/** @type {number} */ lat, /** @type {number} */ lng) => ({ lat, lng });
export const latLngBounds = (/** @type {any} */ a, /** @type {any} */ b) => ({ a, b });
export const Util = { template: (/** @type {string} */ s) => s };
