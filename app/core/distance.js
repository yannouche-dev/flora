// @ts-check
// Distances on the ground, and how the app says them. Pure, no imports (tested under Node: tests/unit/distance.test.mjs):
//  - metres(a, b): the great-circle distance between two [lon, lat], in metres (on R_EARTH, the Earth's mean radius) —
//    collections.js offers it as `distance`, around3d.js as `metres`;
//  - formatDistance(m): a distance measured, rounded as it is said (« 350 m », « 1,5 km », « 12 km ») — offered by
//    collections.js too;
//  - radiusLabel(m) / radiusWords(m): a radius chosen, shown as it is (« 500 m », « 2 km », « 2,5 km » between two
//    stops) and as a screen reader says it (« 2 kilomètres ») — offered by around3d.js, and by the mini-apps' cards.js
//    as distLabel / distWords;
//  - STOPS (the radii offered, 200 m to 50 km), MAJOR_STOPS (those a slider names), AROUND_STOPS (the Carte's
//    « Autour »), and nearestStop(m): the stop closest to a distance.
// Not here, on purpose (each says its own thing its own way): the free layout's distanceLabel (layout/registry.js), the
// Parcours' recap (kit/trail-store.js), the flat-Earth sums of geoservices.js and the framings (111 320 m a degree).

/** The Earth's mean radius, in metres: the sphere of metres(), and of around3d.js circleBox. */
export const R_EARTH = 6371008.8;
const RAD = Math.PI / 180;

/**
 * Great-circle distance in metres (haversine).
 * @param {[number, number]} a [lon, lat] @param {[number, number]} b [lon, lat]
 */
export function metres([lon1, lat1], [lon2, lat2]) {
  const h = Math.sin((lat2 - lat1) * RAD / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin((lon2 - lon1) * RAD / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

/** A distance measured: metres under 1 km, then km, one decimal under 10 km. @param {number} m */
export const formatDistance = m =>
  m < 1000 ? Math.round(m) + ' m' : (m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: m < 10000 ? 1 : 0 }) + ' km';

/** A radius, as it is (never rounded: a free layout's may lie between two stops). @param {number} m */
export const radiusLabel = m => m >= 1000 ? (m / 1000).toLocaleString('fr-FR') + ' km' : m + ' m';

/** A radius as a screen reader says it (« 2 kilomètres », « 500 mètres »). @param {number} m */
export const radiusWords = m => {
  const n = m >= 1000 ? m / 1000 : m, unit = m >= 1000 ? 'kilomètre' : 'mètre';
  return `${n.toLocaleString('fr-FR')} ${unit}${n >= 2 ? 's' : ''}`;
};

/**
 * The radii offered, in metres: 200 m to 50 km (what iNaturalist's circle search allows; beyond 50 km the list is a
 * region's, not « around »). The mini-apps' distances (cards.js DISTANCES) and the 3D maps' radii (around3d.js
 * RADII_3D): the same array, frozen, since both read it.
 */
export const STOPS = /** @type {number[]} */ (Object.freeze([200, 500, 1000, 2000, 5000, 10000, 20000, 50000]));

/** The stops a distance slider names (the others are its minor marks). */
export const MAJOR_STOPS = /** @type {number[]} */ (Object.freeze([200, 1000, 5000, 50000]));

/** The radii of the Carte's « Autour » (nearby.js RADII): a radius kept must be one of them (savedRadius), so they stay as they are. */
export const AROUND_STOPS = /** @type {number[]} */ (Object.freeze([500, 1000, 2000, 5000, 10000]));

/**
 * The stop closest to a distance: of two as close, the first listed (the smaller); not a number, the first.
 * @param {number} m @param {number[]} [stops] @returns {number}
 */
export const nearestStop = (m, stops = STOPS) => stops.reduce((a, b) => Math.abs(b - m) < Math.abs(a - m) ? b : a);
