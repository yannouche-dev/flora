// app/core/walk.js: a parcours as a walk (the recap's distance and profile, the « Vue 3D »'s line).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byAddedAt, walkOf } from '../../app/core/walk.js';

const at = /** @type {[number, number]} */ ([6.8925, 45.972]);
/** A parcours: its point, and plants given in another order than they were added. */
const trail = (/** @type {any} */ extra = {}) => /** @type {any} */ ({
  geometry: { type: 'Point', coordinates: at },
  properties: { name: 'Vers le lac Blanc', ...extra, plants: [
    { id: 'c', plantId: 3, coordinates: [6.9013, 45.9789], accuracy: 6, addedAt: '2026-09-12T09:20:00.000Z' },
    { id: 'a', plantId: 1, coordinates: [6.8952, 45.9741], accuracy: 4, addedAt: '2026-09-12T09:00:00.000Z' },
    // Noted without a position: on the parcours' point, no accuracy — not a step of the walk.
    { id: 'p', plantId: 9, coordinates: at, accuracy: null, addedAt: '2026-09-12T09:05:00.000Z' },
    { id: 'b', plantId: 2, coordinates: [6.8981, 45.9768], accuracy: null, addedAt: '2026-09-12T09:10:00.000Z' },
    // A list entry has no position at all.
    { id: 'n', plantId: 5, addedAt: '2026-09-12T09:15:00.000Z' }
  ] }
});

test('les plantes dans l’ordre où elles ont été notées', () => {
  const { steps } = walkOf(trail());
  assert.deepEqual(steps.map(e => e.id), ['a', 'p', 'b', 'n', 'c']);
  assert.ok(byAddedAt({ addedAt: '2026-01-01' }, { addedAt: '2026-01-02' }) < 0);
});

test('le trait : de plante en plante, celles qui ont leur propre place', () => {
  const { own, start, line } = walkOf(trail());
  assert.deepEqual(own.map(e => e.id), ['a', 'b', 'c'], 'ni la plante posée sur le point du parcours, ni celle sans position');
  assert.equal(start, null, 'parti d’une commune : pas de départ');
  assert.deepEqual(line, [[6.8952, 45.9741], [6.8981, 45.9768], [6.9013, 45.9789]]);
});

test('commencé ici : le point du parcours est la première étape', () => {
  const { start, line } = walkOf(trail({ startedHere: true }));
  assert.deepEqual(start, at);
  assert.deepEqual(line[0], at);
  assert.equal(line.length, 4);
});

test('une plante replacée à la main sur le point du parcours, avec sa précision, reste une étape', () => {
  const t = trail();
  t.properties.plants[2].accuracy = 3;
  assert.deepEqual(walkOf(t).own.map(e => e.id), ['a', 'p', 'b', 'c']);
});

test('un lieu sans point (une liste) : pas de départ, pas de trait sans positions', () => {
  const w = walkOf(/** @type {any} */ ({ geometry: null, properties: { startedHere: true, plants: [{ id: 'x', addedAt: '1' }] } }));
  assert.equal(w.start, null);
  assert.deepEqual(w.line, []);
});
