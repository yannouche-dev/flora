// app/core/plants.js: a plant's names (nameOf, commonOf), its reads (getPlant, getPlants) against an IndexedDB in
// memory (fake-indexeddb) and through a first launch's worker (db.js readPlantsFrom), and its flowering months.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../app/core/db.js';
import { commonOf, floweringMonths, getPlant, getPlants, nameOf } from '../../app/core/plants.js';

// db.js upgrades the schema only from a page (a worker opens whatever version exists).
/** @type {any} */ (globalThis).window ??= globalThis;

const ortie = { id: 1, scientificName: 'Urtica dioica', vernacularNames: ['Grande ortie', 'Ortie dioïque'] };
const carex = { id: 2, scientificName: 'Carex remota', vernacularNames: [] };
const mousse = { id: 3, scientificName: 'Bryum argenteum' };

test('nameOf : le premier nom commun, sinon le nom scientifique', () => {
  assert.equal(nameOf(ortie), 'Grande ortie');
  assert.equal(nameOf(carex), 'Carex remota', 'liste vide');
  assert.equal(nameOf(mousse), 'Bryum argenteum', 'pas de liste');
  assert.equal(nameOf({ scientificName: 'Poa annua', vernacularNames: [''] }), 'Poa annua', 'premier nom vide');
  assert.equal(nameOf(null), undefined);
  assert.equal(nameOf(undefined), undefined);
  // A search summary or a collection entry (`vernacularName`) is another shape: not read here.
  assert.equal(nameOf({ scientificName: 'Poa annua', vernacularName: 'Pâturin annuel' }), 'Poa annua');
});

test('commonOf : le premier nom commun, ou null', () => {
  assert.equal(commonOf(ortie), 'Grande ortie');
  assert.equal(commonOf(carex), null, 'liste vide');
  assert.equal(commonOf(mousse), null, 'pas de liste');
  assert.equal(commonOf({ scientificName: 'Poa annua', vernacularNames: [''] }), null, 'premier nom vide');
  assert.equal(commonOf(null), null);
  assert.equal(commonOf(undefined), null);
  assert.equal(commonOf({ scientificName: 'Poa annua', vernacularName: 'Pâturin annuel' }), null);
});

test('getPlant / getPlants : lus dans IndexedDB, une plante absente donne null ou est laissée de côté, l’ordre gardé', async () => {
  await db.replacePlants([ortie, carex, mousse], { plants: 3 });
  assert.deepEqual(await getPlant(1), ortie);
  assert.equal(await getPlant(99), null, 'null, jamais undefined');
  assert.deepEqual(await getPlants([3, 99, 1, 3]), [mousse, ortie, mousse], 'dans l’ordre demandé, doublons compris');
  assert.deepEqual(await getPlants([]), []);
  assert.deepEqual(await getPlants([98, 99]), []);
});

test('premier lancement : lus depuis le worker sans attendre le remplissage du magasin, rien de gardé', async () => {
  await db.replacePlants([ortie], { plants: 1 });
  /** @type {unknown[]} */
  const asked = [];
  const worker = new Map([[5, { id: 5, from: 'worker' }]]);
  // The store is never filled here: a read that waited for it would never end.
  db.readPlantsFrom({ get: async id => { asked.push(id); return worker.get(id); }, stored: new Promise(() => {}) });
  try {
    assert.deepEqual(await getPlant(5), { id: 5, from: 'worker' });
    assert.equal(await getPlant(1), null, 'pas encore chez le worker');
    assert.deepEqual(await getPlants([1, 5]), [{ id: 5, from: 'worker' }]);
    assert.deepEqual(asked, [5, 1, 1, 5]);
  } finally {
    db.readPlantsFrom(null);
  }
  // The miss above was not remembered: once the flora is stored, the plant is there.
  assert.deepEqual(await getPlant(1), ortie);
});

test('une lecture en échec : getPlant donne null, getPlants est rejeté', async () => {
  const broken = new Error('lecture impossible');
  db.readPlantsFrom({ get: async id => { if (id === 2) throw broken; return { id }; }, stored: Promise.resolve() });
  try {
    assert.equal(await getPlant(2), null);
    assert.deepEqual(await getPlant(1), { id: 1 });
    await assert.rejects(getPlants([1, 2, 3]), broken);
    assert.deepEqual(await getPlants([1, 3]), [{ id: 1 }, { id: 3 }]);
  } finally {
    db.readPlantsFrom(null);
  }
});

test('floweringMonths : les mois (0–11) d’une période Baseflor, à cheval sur la fin de l’année aussi', () => {
  assert.deepEqual([...floweringMonths([4, 6])], [3, 4, 5]);
  assert.deepEqual([...floweringMonths([11, 2])], [10, 11, 0, 1]);
  assert.deepEqual([...floweringMonths([7, 7])], [6]);
  assert.equal(floweringMonths([1, 12]).size, 12);
  assert.equal(floweringMonths(null).size, 0);
  assert.equal(floweringMonths(undefined).size, 0);
  assert.equal(floweringMonths(/** @type {any} */ ([0, 13])).size, 0);
});
