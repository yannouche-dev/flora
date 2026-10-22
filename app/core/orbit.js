// @ts-check
// A 3D view turned around a point rather than around the middle of the screen (gf-map-gl.js: the map's reference, its
// « repère »): where the camera's centre goes when the bearing changes by some degrees, the point staying where it is
// on the screen. Pure, no imports (tested under Node: tests/unit/orbit.test.mjs).
// In Web Mercator, MapLibre's ground plane: conformal, a turn there is the same turn on the screen, at any zoom and any
// tilt — only the centre moves (the camera's height kept, and the height of the point it looks at: a rigid turn about
// the vertical through the point, exact over the relief too — gf-map-gl.js keeps that height while it turns, which
// MapLibre would set on the ground under each new centre, then sets the centre back on the ground with the camera
// held). Under the globe (MapLibre's, below zoom 12) only close.

/** Web Mercator's last latitude (MapLibre's, Leaflet's): the world a square. */
export const MAX_LAT = 85.0511287798066;
const RAD = Math.PI / 180;

/** A longitude in [-180, 180). @param {number} lon */
const wrap = lon => ((lon + 180) % 360 + 360) % 360 - 180;
/** @param {number} lat */
const clampLat = lat => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));

/**
 * [lon, lat] (degrees) in Web Mercator, in world units: 0…1 across, y down (MapLibre's MercatorCoordinate); the
 * latitude kept within the square. @param {[number, number]} lonLat @returns {[number, number]}
 */
export function toMercator([lon, lat]) {
  const phi = clampLat(lat) * RAD;
  return [(180 + lon) / 360, (180 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / RAD) / 360];
}

/** Web Mercator (world units, y down) back to [lon, lat]: the longitude wrapped, the latitude kept within the square. @param {[number, number]} xy @returns {[number, number]} */
export function fromMercator([x, y]) {
  return [wrap(x * 360 - 180), clampLat(2 * Math.atan(Math.exp((180 - y * 360) * RAD)) / RAD - 90)];
}

/**
 * The camera's new centre when its bearing changes by `deltaBearing` degrees (MapLibre's sign: + the bearing grows,
 * the view turning clockwise) around `ref` instead of around the centre: `ref` keeps its point on the screen, at the
 * same distance from the centre. The short way over the antimeridian; 0° (and whole turns) the centre as it was.
 * MapLibre draws the world turned by −bearing about the centre, so the centre C goes to R + Rz(δ)(C − R).
 * @param {[number, number]} center [lon, lat] @param {[number, number]} ref [lon, lat] @param {number} deltaBearing degrees
 * @returns {[number, number]} [lon, lat]
 */
export function rotateAround(center, ref, deltaBearing) {
  const same = /** @type {[number, number]} */ ([center[0], center[1]]);
  if (![...center, ...ref, deltaBearing].every(Number.isFinite) || deltaBearing % 360 === 0) return same;
  const [cx, cy] = toMercator(center), [rx, ry] = toMercator(ref);
  let dx = cx - rx;
  dx -= Math.round(dx);
  const dy = cy - ry;
  if (!dx && !dy) return same;
  const a = deltaBearing * RAD, c = Math.cos(a), s = Math.sin(a);
  return fromMercator([rx + dx * c - dy * s, ry + dx * s + dy * c]);
}
