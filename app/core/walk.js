// @ts-check
// A parcours (or a place) as a walk: its plants in the order they were added, and the line from one to the next.
// Shared by the parcours' recap (app/miniapp/kit/trail-store.js: distance, profile) and the « Vue 3D »
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
