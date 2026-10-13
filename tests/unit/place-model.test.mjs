// app/core/place-model.js (the shape of a collection, for the database, imports and links) and app/core/portable.js
// (its slim GeoJSON: export file, backup, transfer link). Round trip: what toPortable writes, normalizeCollection
// reads back as it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../app/core/place-model.js';
import { FORMAT_VERSION, hasPersonal, toPortable } from '../../app/core/portable.js';
import { random } from './support/random.mjs';

const DATE = '2026-05-01T10:00:00.000Z';

test('validCoordinates : bornes, 7 décimales', () => {
  assert.deepEqual(M.validCoordinates([2.123456789, 48.987654321]), [2.1234568, 48.9876543]);
  assert.equal(M.validCoordinates([200, 0]), null);
  assert.equal(M.validCoordinates([0, 91]), null);
  assert.equal(M.validCoordinates(['2', 48]), null);
  assert.equal(M.validCoordinates(null), null);
});

test('normalizeHarvests : dates valides seulement, la plus récente d’abord, textes bornés', () => {
  const h = M.normalizeHarvests([{ date: '2025-06-01' }, { date: 'hier' }, { date: '2026-04-02T08:00', quantity: 'q'.repeat(300), note: 1 }, null]);
  assert.deepEqual(h.map(x => x.date), ['2026-04-02', '2025-06-01']);
  assert.equal(h[0].quantity.length, 200);
  assert.equal(h[0].note, '');
  assert.deepEqual(M.normalizeHarvests('pas une liste'), []);
});

test('normalizeEntry : valeurs par défaut, abondance et note bornées, position du lieu à défaut de la sienne', () => {
  const e = M.normalizeEntry({ plantId: 128268, abundance: 'énorme', rating: 9.4 }, DATE, [2.35, 48.85]);
  assert.equal(e.id, 'p128268');
  assert.equal(e.abundance, 'moyen');
  assert.equal(e.rating, 5);
  assert.equal(e.addedAt, DATE);
  assert.deepEqual(e.coordinates, [2.35, 48.85]);
  assert.equal(e.accuracy, null);
  const inList = M.normalizeEntry({ plantId: 1, coordinates: [2, 48], accuracy: 5 }, DATE);
  assert.equal(inList.coordinates, null, 'une liste ne garde pas de position');
  const unknown = M.normalizeEntry({ plantId: 'x', scientificName: 'Rubus sp.' }, DATE);
  assert.equal(unknown.plantId, null);
  assert.equal(unknown.id, 'pRubus_sp_');
});

test('normalizeCollection : format 1 (une plante par point), liste, favoris, entrées invalides', () => {
  const v1 = M.normalizeCollection({ type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [2, 48] }, properties: { plantId: 5, notes: 'n', createdAt: DATE } });
  assert.equal(v1?.properties.kind, 'place');
  assert.deepEqual(v1?.properties.plantIds, [5]);
  assert.equal(v1?.properties.plants[0].notes, 'n', 'la note du format 1 passe à la plante');
  assert.equal(v1?.properties.notes, '');
  const fav = M.normalizeCollection({ type: 'Feature', id: M.FAVORITES_ID, geometry: null, properties: { kind: 'list', name: 'x', plants: [{ plantId: 1 }, { plantId: 1, id: 'p1' }] } });
  assert.equal(fav?.properties.kind, 'favorites');
  assert.equal(fav?.properties.name, 'Favoris');
  assert.deepEqual(fav?.properties.plants.map(e => e.id), ['p1', 'p1-2'], 'identifiants rendus uniques');
  assert.equal(M.normalizeCollection({ type: 'Feature', geometry: { type: 'Point', coordinates: [500, 0] }, properties: {} }), null);
  assert.equal(M.normalizeCollection({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} }), null);
  assert.equal(M.normalizeCollection({ type: 'Point' }), null);
  const placeWithoutPoint = M.normalizeCollection({ type: 'Feature', id: 'b', geometry: null, properties: { kind: 'place' } });
  assert.equal(placeWithoutPoint?.properties.kind, 'list');
});

test('toPortable : seulement ce que l’utilisateur a saisi ; sans le personnel sur demande', () => {
  const place = /** @type {M.Collection} */ (M.normalizeCollection({ type: 'Feature', id: 'p', geometry: { type: 'Point', coordinates: [2.35, 48.85] }, properties: {
    kind: 'place', name: 'Bois', notes: 'secret', createdAt: DATE, updatedAt: DATE,
    plants: [
      { plantId: 1, abundance: 'rare', notes: 'cueilli', harvests: [{ date: '2026-05-02', quantity: '1 kg' }], coordinates: [2.3501, 48.8501], accuracy: 4 },
      { plantId: 2, coordinates: [2.35, 48.85], accuracy: 30 }
    ] } }));
  const full = toPortable([place]);
  assert.equal(full.formatVersion, FORMAT_VERSION);
  const [f] = full.features;
  assert.equal(f.properties.notes, 'secret');
  assert.deepEqual(f.properties.plants[0], { plantId: 1, abundance: 'rare', coordinates: [2.3501, 48.8501], accuracy: 4, notes: 'cueilli', harvests: [{ date: '2026-05-02', quantity: '1 kg' }] });
  assert.deepEqual(f.properties.plants[1], { plantId: 2 }, 'au point du lieu, abondance par défaut : rien d’autre');
  assert.ok(hasPersonal(full));
  const shared = toPortable([place], { personal: false });
  assert.equal(shared.features[0].properties.notes, undefined);
  assert.equal(hasPersonal(shared), false);
});

test('propriété : normalizeCollection(toPortable(c)) rend la collection (300 collections tirées au hasard)', () => {
  const rnd = random(7);
  const pick = (/** @type {any[]} */ a) => a[rnd(a.length)];
  for (let run = 0; run < 300; run++) {
    const kind = pick(['place', 'place', 'list', 'favorites']);
    const at = /** @type {[number, number]} */ ([Math.round((-5 + rnd(14000) / 1000) * 1e6) / 1e6, Math.round((42 + rnd(9000) / 1000) * 1e6) / 1e6]);
    const plants = Array.from({ length: rnd(8) }, (_, i) => ({
      id: 'e' + run + '-' + i, plantId: rnd(5) ? 1000 + rnd(50) : null, scientificName: 'Planta ' + i,
      abundance: pick(['rare', 'moyen', 'abondant']), rating: rnd(6), notes: rnd(2) ? '' : 'note ' + i + ' « été » 🌿',
      harvests: rnd(3) ? [] : [{ date: '2026-0' + (1 + rnd(9)) + '-1' + rnd(10), quantity: '', note: 'x' }],
      coordinates: kind === 'place' && rnd(2) ? [at[0] + rnd(1000) / 1e6, at[1] - rnd(1000) / 1e6] : null,
      accuracy: rnd(2) ? 1 + rnd(50) : null
    }));
    const raw = { type: 'Feature', id: kind === 'favorites' ? M.FAVORITES_ID : 'c' + run, geometry: kind === 'place' ? { type: 'Point', coordinates: at } : null,
      properties: { kind, name: kind === 'favorites' ? '' : 'Collection ' + run, notes: rnd(2) ? 'n' : '', accuracy: kind === 'place' ? rnd(30) || null : null, createdAt: DATE, updatedAt: DATE, plants } };
    const original = /** @type {M.Collection} */ (M.normalizeCollection(raw));
    const back = M.normalizeCollection(toPortable([original]).features[0]);
    // What the file leaves out on purpose: the names (filled again from the flora), the dates the plants were added.
    const comparable = (/** @type {any} */ c) => ({ ...c, properties: { ...c.properties, plants: c.properties.plants.map((/** @type {any} */ e) => ({ ...e, scientificName: e.plantId === null ? e.scientificName : '', vernacularName: null, addedAt: '' })) } });
    assert.deepEqual(comparable(back), comparable(original), `run ${run}`);
  }
});
