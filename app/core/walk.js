// @ts-check
// A parcours (or a place) as a walk: its plants in the order they were added, the line from one to the next, and
// the box a map frames it in. Shared by the parcours' recap (gf-trail.js: distance, profile) and the « Vue 3D »
// (gf-map3d.js), so both draw the same walk. Pure: no DOM, no storage.

/** @typedef {[number, number]} LngLat */

/** Older first (the order a walk met its plants). @param {{ addedAt?: string }} a @param {{ addedAt?: string }} b */
export const byAddedAt = (a, b) => String(a.addedAt).localeCompare(String(b.addedAt));

/**
 * The walk of a place: `steps`, its plants by the time they were added; `own`, those with a place of their own
 * (located, or moved by hand) — not one put on the parcours' point for want of a position (no accuracy, exactly on
 * the point), nor the commune it started from; `start`, the parcours' point when it was started there
 * (`startedHere`); `line`, the walk from the start (if any) through each plant of `own`, as the crow flies.
 * @param {{ geometry?: { coordinates: LngLat } | null, properties: { startedHere?: boolean, plants: any[] } }} place
 * @returns {{ steps: any[], own: any[], start: LngLat | null, line: LngLat[] }}
 */
export function walkOf(place) {
  const steps = [...place.properties.plants].sort(byAddedAt);
  const at = place.geometry?.coordinates ?? null;
  const onPoint = (/** @type {any} */ e) => e.accuracy == null && at && e.coordinates?.[0] === at[0] && e.coordinates?.[1] === at[1];
  const own = steps.filter(e => e.coordinates && !onPoint(e));
  const start = place.properties.startedHere && at ? at : null;
  const line = /** @type {LngLat[]} */ ([...(start ? [start] : []), ...own.map(e => e.coordinates)]);
  return { steps, own, start, line };
}

/**
 * The box around points, [[west, south], [east, north]], at least `minMetres` across each way (a single plant, or
 * plants a few steps apart, are not framed at the zoom of a doorstep); null without a point.
 * @param {LngLat[]} points @param {number} [minMetres]
 * @returns {[LngLat, LngLat] | null}
 */
export function boundsOf(points, minMetres = 300) {
  const ok = points.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!ok.length) return null;
  let w = Math.min(...ok.map(p => p[0])), e = Math.max(...ok.map(p => p[0]));
  let s = Math.min(...ok.map(p => p[1])), n = Math.max(...ok.map(p => p[1]));
  const mid = (s + n) / 2;
  const dLat = minMetres / 111_320;
  const dLon = minMetres / (111_320 * Math.max(0.05, Math.cos(mid * Math.PI / 180)));
  if (n - s < dLat) { const c = (s + n) / 2; s = c - dLat / 2; n = c + dLat / 2; }
  if (e - w < dLon) { const c = (w + e) / 2; w = c - dLon / 2; e = c + dLon / 2; }
  return [[w, s], [e, n]];
}

/**
 * Room around the walk when a map of `width` × `height` px frames it: an eighth of each side, between 24 and 80 px —
 * more at the top for a tilted view (its far side is drawn smaller), so the markers standing up there stay in sight.
 * @param {number} width @param {number} height @param {boolean} [tilted]
 * @returns {{ top: number, bottom: number, left: number, right: number }}
 */
export function fitPadding(width, height, tilted = false) {
  const clamp = (/** @type {number} */ v) => Math.round(Math.max(24, Math.min(80, v)));
  const x = clamp(width / 8), y = clamp(height / 8);
  return { top: tilted ? clamp(height / 5) : y, bottom: y, left: x, right: x };
}
