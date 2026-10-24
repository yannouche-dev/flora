// app/core/orbit.js: a 3D view turned around the map's reference (gf-map-gl.js) — the camera's new centre for a change
// of bearing, the reference keeping its point on the screen. The screen here is MapLibre's model of it: the world in
// Web Mercator, turned by −bearing about the centre, 512 px a world at zoom 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LAT, fromMercator, rotateAround, toMercator } from '../../app/core/orbit.js';
import { metres } from '../../app/core/distance.js';

/** @typedef {[number, number]} LonLat */

/** Where `p` is on the screen (px from the centre, y down) for a camera at `center`, turned by `bearing`, at `zoom`. @param {LonLat} p @param {LonLat} center @param {number} bearing @param {number} zoom */
function screen(p, center, bearing, zoom) {
  const [px, py] = toMercator(p), [cx, cy] = toMercator(center);
  let dx = px - cx;
  dx -= Math.round(dx);
  const dy = py - cy, a = -bearing * Math.PI / 180, size = 512 * 2 ** zoom;
  return [(dx * Math.cos(a) - dy * Math.sin(a)) * size, (dx * Math.sin(a) + dy * Math.cos(a)) * size];
}

/** @param {number[]} a @param {number[]} b */
const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const CLERMONT = /** @type {LonLat} */ ([3.087, 45.7772]);
const PUY = /** @type {LonLat} */ ([2.9645, 45.7724]);

test('rotateAround : le repère garde son point sur l’écran, à la même distance du centre', () => {
  const refs = [CLERMONT, [3.0952, 45.7801], [3.08, 45.77]];
  const centers = [[3.0901, 45.7790], PUY, [3.087, 45.7772]];
  for (const ref of /** @type {LonLat[]} */ (refs)) {
    for (const c0 of /** @type {LonLat[]} */ (centers)) {
      for (const bearing of [0, 30, -120, 179]) {
        for (const delta of [15, -45, 90, 200, 720.5, -0.25]) {
          const c1 = rotateAround(c0, ref, delta);
          const before = screen(ref, c0, bearing, 16), after = screen(ref, c1, bearing + delta, 16);
          assert.ok(gap(before, after) < 1e-6, `${JSON.stringify({ ref, c0, bearing, delta })}: ${gap(before, after)} px`);
          // The same distance on the ground plane (Web Mercator), and on the ground (a few hundred metres here).
          const m0 = toMercator(c0), m1 = toMercator(c1), r = toMercator(ref);
          assert.ok(Math.abs(gap(m0, r) - gap(m1, r)) < 1e-15);
          const d0 = metres(c0, ref), d1 = metres(c1, ref);
          assert.ok(Math.abs(d1 - d0) <= Math.max(0.01, d0 * 0.005), `${d0} m → ${d1} m`);
        }
      }
    }
  }
});

test('rotateAround : 0° et les tours entiers rendent le centre tel quel ; quatre quarts de tour, le départ ; δ et δ − 360° le même', () => {
  const c = /** @type {LonLat} */ ([3.0901, 45.779]);
  assert.deepEqual(rotateAround(c, CLERMONT, 0), c);
  assert.notEqual(rotateAround(c, CLERMONT, 0), c, 'a copy');
  assert.deepEqual(rotateAround(c, CLERMONT, 360), c);
  assert.deepEqual(rotateAround(c, CLERMONT, -720), c);
  let turned = c;
  for (let i = 0; i < 4; i++) turned = rotateAround(turned, CLERMONT, 90);
  assert.ok(gap(turned, c) < 1e-9, String(gap(turned, c)));
  for (const d of [30, 135, 271]) assert.ok(gap(rotateAround(c, CLERMONT, d), rotateAround(c, CLERMONT, d - 360)) < 1e-9);
  // Turned there and back.
  assert.ok(gap(rotateAround(rotateAround(c, CLERMONT, 37), CLERMONT, -37), c) < 1e-9);
});

test('rotateAround : le sens de MapLibre (le cap croît) ; le repère au centre, le centre ne bouge pas', () => {
  // The centre north of the reference, the view turned to the east (+90°): the centre goes east of the reference (the
  // reference, under the middle of the screen, stays there — the view now looking east).
  const ref = /** @type {LonLat} */ ([3, 45]);
  const east = rotateAround([3, 45.01], ref, 90);
  assert.ok(east[0] > ref[0] + 0.005, JSON.stringify(east));
  assert.ok(Math.abs(east[1] - ref[1]) < 1e-9, 'the same Mercator row: the same latitude');
  const west = rotateAround([3, 45.01], ref, -90);
  assert.ok(west[0] < ref[0] - 0.005);
  assert.deepEqual(rotateAround(CLERMONT, CLERMONT, 75), CLERMONT);
});

test('rotateAround : par-dessus l’antiméridien, le court chemin ; près du pôle, une latitude dans le carré', () => {
  const across = rotateAround([179.99, 10], [-179.99, 10], 180);
  assert.ok(Math.abs(across[0] - -179.97) < 1e-9, JSON.stringify(across));
  assert.ok(Math.abs(across[1] - 10) < 1e-9);
  assert.ok(across[0] >= -180 && across[0] < 180);
  const back = rotateAround([-179.99, 10], [179.99, 10], 180);
  assert.ok(Math.abs(back[0] - 179.97) < 1e-9, JSON.stringify(back));
  const polar = rotateAround([0, 89], [0, 80], 180);
  assert.ok(polar.every(Number.isFinite), JSON.stringify(polar));
  assert.ok(polar[1] <= MAX_LAT && polar[1] > 0);
  const south = rotateAround([10, -84], [12, -85.04], 123);
  assert.ok(south.every(Number.isFinite) && south[1] >= -MAX_LAT);
});

test('rotateAround : une entrée qui n’est pas un nombre rend le centre', () => {
  const c = /** @type {LonLat} */ ([3, 45]);
  assert.deepEqual(rotateAround(c, [NaN, 45], 30), c);
  assert.deepEqual(rotateAround(c, [3.1, 45], Infinity), c);
  assert.deepEqual(rotateAround(c, [3.1, 45], NaN), c);
});

test('toMercator et fromMercator : les coordonnées Mercator de MapLibre, aller et retour', () => {
  assert.deepEqual(toMercator([0, 0]), [0.5, 0.5]);
  assert.deepEqual(toMercator([-180, 0]), [0, 0.5]);
  assert.ok(Math.abs(toMercator([0, MAX_LAT])[1]) < 1e-12);
  assert.ok(Math.abs(toMercator([0, -MAX_LAT])[1] - 1) < 1e-12);
  assert.deepEqual(toMercator([0, 89]), toMercator([0, MAX_LAT]), 'clamped');
  for (const p of /** @type {LonLat[]} */ ([CLERMONT, PUY, [-73.98, 40.75], [151.2, -33.87], [179.999, 60]])) {
    const q = fromMercator(toMercator(p));
    assert.ok(gap(p, q) < 1e-9, JSON.stringify([p, q]));
  }
  assert.equal(fromMercator([1.25, 0.5])[0], -90, 'wrapped');
});
