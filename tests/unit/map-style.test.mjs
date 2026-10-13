// The map style's pure parts (app/components/map-style.js): where the circle of the games' step « map » stands, and the
// classes a point takes for what a page lights.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markClasses, ringAt } from '../../app/components/map-style.js';

test('le cercle : au milieu, un cinquième de la hauteur au-dessus de la carte, 54 % de la hauteur (42 % de la largeur au plus)', () => {
  // A wide map: limited by its height.
  assert.deepEqual(ringAt({ width: 1920, height: 1000, top: 640 }), { x: 960, y: 440, r: 540 });
  // A phone: limited by its width; never closer than a quarter of the height to the top.
  assert.deepEqual(ringAt({ width: 390, height: 770, top: 360 }), { x: 195, y: 206, r: 164 });
  assert.deepEqual(ringAt({ width: 390, height: 770, top: 300 }), { x: 195, y: 193, r: 164 });
  // The chip (step « cards »): in the middle of the room above it.
  assert.deepEqual(ringAt({ width: 480, height: 750, top: 690, chip: true }), { x: 240, y: 345, r: 202 });
});

test('les points éclairés : la carte du dessus, les matchs, les passées (par taxon)', () => {
  const marks = { top: 3, matched: [5], passed: [7, 3] };
  assert.deepEqual(markClasses({ taxonId: 3 }, marks), { 'gf-top': true, 'gf-matched': false, 'gf-passed': true });
  assert.deepEqual(markClasses({ taxonId: 5 }, marks), { 'gf-top': false, 'gf-matched': true, 'gf-passed': false });
  assert.deepEqual(markClasses({ taxonId: null }, marks), { 'gf-top': false, 'gf-matched': false, 'gf-passed': false });
  assert.deepEqual(markClasses(undefined, {}), { 'gf-top': false, 'gf-matched': false, 'gf-passed': false });
});
