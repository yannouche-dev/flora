// app/core/distance.js: the great-circle distance (metres), a distance measured said (formatDistance), a radius shown
// and said (radiusLabel, radiusWords), the radii offered (STOPS and their subsets) and the stop nearest a distance;
// and the modules that offered them first offering the same functions and arrays under their old names (collections.js,
// around3d.js, cards.js, nearby.js). The strings expected are those the code printed before it moved here.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AROUND_STOPS, MAJOR_STOPS, R_EARTH, STOPS, formatDistance, metres, nearestStop, radiusLabel, radiusWords } from '../../app/core/distance.js';

const collections = await import('../../app/core/collections.js');
const around3d = await import('../../app/core/around3d.js');
const cards = await import('../../app/miniapp/kit/cards.js');
const nearby = await import('../../app/core/nearby.js');

const PARIS = /** @type {[number, number]} */ ([2.3522, 48.8566]);
const MARSEILLE = /** @type {[number, number]} */ ([5.3698, 43.2965]);

test('metres : la distance à vol d’oiseau, sur la sphère de rayon moyen', () => {
  assert.equal(R_EARTH, 6371008.8);
  // The value collections.js#distance and around3d.js#metres both gave (the same haversine, bit for bit).
  assert.equal(metres(PARIS, MARSEILLE), 660479.2919652576);
  assert.equal(metres(MARSEILLE, PARIS), metres(PARIS, MARSEILLE));
  assert.equal(metres(PARIS, PARIS), 0);
  assert.equal(metres([0, 0], [1, 0]), 111195.0802335329, 'un degré à l’équateur');
  assert.ok(Math.abs(metres([0, 0], [1, 0]) - R_EARTH * Math.PI / 180) < 1e-6);
});

test('les anciens noms donnent les mêmes fonctions et les mêmes listes', () => {
  assert.equal(collections.distance, metres);
  assert.equal(collections.formatDistance, formatDistance);
  assert.equal(around3d.metres, metres);
  assert.equal(around3d.radiusLabel, radiusLabel);
  assert.equal(around3d.radiusWords, radiusWords);
  assert.equal(cards.distLabel, radiusLabel);
  assert.equal(cards.distWords, radiusWords);
  assert.equal(cards.DISTANCES, STOPS);
  assert.equal(around3d.RADII_3D, STOPS);
  assert.equal(nearby.RADII, AROUND_STOPS);
  assert.deepEqual(STOPS, [200, 500, 1000, 2000, 5000, 10000, 20000, 50000]);
  assert.deepEqual(MAJOR_STOPS, [200, 1000, 5000, 50000]);
  // A radius kept (Carte → Autour) must still be one of these (nearby.js savedRadius).
  assert.deepEqual(AROUND_STOPS, [500, 1000, 2000, 5000, 10000]);
  assert.ok(MAJOR_STOPS.every(m => STOPS.includes(m)) && AROUND_STOPS.every(m => STOPS.includes(m)));
  // Shared by the mini-apps and the 3D maps: never changed in place.
  for (const list of [STOPS, MAJOR_STOPS, AROUND_STOPS]) {
    assert.ok(Object.isFrozen(list));
    assert.throws(() => { list.push(1); }, TypeError);
  }
});

test('chaque cran dit comme avant : formatDistance, radiusLabel, radiusWords (et le « km » de la Carte)', () => {
  /** @type {Record<number, [string, string, string]>} */
  const before = {
    200: ['200 m', '200 m', '200 mètres'],
    500: ['500 m', '500 m', '500 mètres'],
    1000: ['1 km', '1 km', '1 kilomètre'],
    2000: ['2 km', '2 km', '2 kilomètres'],
    5000: ['5 km', '5 km', '5 kilomètres'],
    10000: ['10 km', '10 km', '10 kilomètres'],
    20000: ['20 km', '20 km', '20 kilomètres'],
    50000: ['50 km', '50 km', '50 kilomètres']
  };
  for (const m of STOPS) assert.deepEqual([formatDistance(m), radiusLabel(m), radiusWords(m)], before[m], `${m} m`);
  // gf-map-page.js's own words for its radii (all of AROUND_STOPS), before radiusLabel took their place.
  const km = (/** @type {number} */ r) => r < 1000 ? r + ' m' : r / 1000 + ' km';
  for (const r of AROUND_STOPS) assert.equal(radiusLabel(r), km(r), `${r} m`);
});

test('hors des crans : chacun garde sa façon (mesurée arrondie, rayon tel quel)', () => {
  assert.equal(formatDistance(0), '0 m');
  assert.equal(formatDistance(999.4), '999 m');
  assert.equal(formatDistance(999.6), '1000 m');
  assert.equal(formatDistance(1234), '1,2 km');
  assert.equal(formatDistance(9949), '9,9 km');
  assert.equal(formatDistance(9951), '10 km');
  assert.equal(formatDistance(12345), '12 km');
  assert.equal(formatDistance(1234567), '1 235 km');
  assert.equal(radiusLabel(2500), '2,5 km', 'un écran sur mesure entre deux crans (r=2.5km)');
  assert.equal(radiusLabel(1234), '1,234 km');
  assert.equal(radiusLabel(150), '150 m');
  assert.equal(radiusWords(2500), '2,5 kilomètres');
  assert.equal(radiusWords(1050), '1,05 kilomètre');
  assert.equal(radiusWords(0), '0 mètre');
});

test('nearestStop : le cran le plus proche ; à égalité le premier ; pas un nombre, le premier', () => {
  for (const m of STOPS) assert.equal(nearestStop(m), m);
  assert.equal(nearestStop(3000), 2000);
  assert.equal(nearestStop(4000), 5000);
  assert.equal(nearestStop(350), 200, 'à mi-chemin de 200 et 500 : le premier');
  assert.equal(nearestStop(750), 500, 'à mi-chemin de 500 et 1000 : le premier');
  assert.equal(nearestStop(35000), 20000, 'à mi-chemin de 20 et 50 km : le premier');
  assert.equal(nearestStop(NaN), 200);
  assert.equal(nearestStop(/** @type {any} */ (undefined)), 200);
  assert.equal(nearestStop(-10), 200);
  assert.equal(nearestStop(1e9), 50000);
  assert.equal(nearestStop(100, AROUND_STOPS), 500, 'une autre liste');
  assert.equal(nearestStop(NaN, AROUND_STOPS), 500);
  // What the three copies it replaces gave: around3d.js and cells.js (the stop), gf-map-obs3d.js (its index).
  const stop = (/** @type {number} */ m) => STOPS.reduce((a, b) => Math.abs(b - m) < Math.abs(a - m) ? b : a);
  const index = (/** @type {number} */ r) => STOPS.reduce((best, d, i) => Math.abs(d - r) < Math.abs(STOPS[best] - r) ? i : best, 0);
  const values = [NaN, -1, 0, 1, 199, 200, 349, 350, 351, 749, 750, 751, 1500, 3500, 7500, 15000, 35000, 49999, 50000, 1e6];
  for (let m = 0; m <= 60000; m += 37) values.push(m);
  for (const m of values) {
    assert.equal(nearestStop(m), stop(m), `${m}`);
    assert.equal(STOPS.indexOf(nearestStop(m, STOPS)), index(m), `${m}`);
  }
});
