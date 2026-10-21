// @ts-check
// The recap of a Parcours botanique: how long, how far, how high (ma-trail-recap.js). Apart from trail-store.js, which
// the start of the app reads: the walk (core/walk.js) and the altitudes (core/altitude.js) come with the recap only.
// Tested under Node (tests/unit/trail.test.mjs).

import { metres as distance } from '../../core/distance.js';
import { altitudeOf, profileOf } from '../../core/altitude.js';
import { walkOf } from '../../core/walk.js';

/** Two plants further apart in time: a pause (taken up another day), not counted in the walk's time. */
const PAUSE_MS = 2 * 3600e3;

/**
 * The recap of a parcours: its walk in the order the plants were added, from one to the next (as the crow flies),
 * from the start when it was started here — only the plants with a place of their own (located, or moved by hand),
 * not those put on the parcours' point for want of a position, nor the commune it started from (core/walk.js: the
 * « Vue 3D » draws the same walk); its altitude profile (the IGN's, kept with each plant); its time, from the start to
 * the last plant, without the pauses (taken up again another day); how far. `walk`: « en 1 h 05, sur 1,2 km, 40 m
 * de montée ». @param {any} t
 */
export function recapOf(t) {
  const { steps, own, start, line: placed } = walkOf(t);
  const profile = profileOf([
    ...(start ? [{ at: start, m: altitudeOf(t.properties, start), label: 'Départ' }] : []),
    ...own.map(e => ({ at: e.coordinates, m: altitudeOf(e, e.coordinates), label: e.vernacularName || e.scientificName }))
  ], distance);
  let km = 0;
  for (let i = 1; i < placed.length; i++) km += distance(placed[i - 1], placed[i]) / 1000;
  const times = [Date.parse(t.properties.createdAt), ...steps.map(e => Date.parse(e.addedAt))].filter(Number.isFinite);
  let ms = 0;
  for (let i = 1; i < times.length; i++) { const gap = times[i] - times[i - 1]; if (gap > 0 && gap <= PAUSE_MS) ms += gap; }
  const min = Math.round(ms / 60000);
  const time = min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : min >= 1 ? `${min} min` : '';
  const m = Math.round(km * 100) * 10;
  const dist = m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : m >= 50 ? `${m} m` : '';
  return { profile, time, dist };
}
