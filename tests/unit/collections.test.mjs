// What the activities made in Mes plantes, and whose it is (app/core/collections.js), against an IndexedDB in memory
// (fake-indexeddb): one rule makes it the user's — anything the user changes, not the activity itself nor the
// altitudes the app asks for (updatePlace: the collection, an entry changed, a plant filed in a list or noted in a
// lieu; savePlace: a list or a lieu of the user's; promotePlace: the favourites shared or exported alone).
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// db.js upgrades the schema only from a page (a worker opens whatever version exists).
/** @type {any} */ (globalThis).window ??= globalThis;
// No service answers here (the altitudes of a lieu are asked in the background): refused at once.
const nodeFetch = globalThis.fetch;
globalThis.fetch = /** @type {any} */ (async (/** @type {any} */ input, /** @type {any} */ init) =>
  String(input instanceof Request ? input.url : input).startsWith('file:') ? nodeFetch(input, init) : new Response('', { status: 503 }));

const db = await import('../../app/core/db.js');
const C = await import('../../app/core/collections.js');

const plant = (/** @type {number} */ id) => ({ id, scientificName: 'Planta ' + id, vernacularNames: ['Plante ' + id] });
/** The favourites: plant id → [origin, from] (none: null). */
const favourites = async () => Object.fromEntries(((await C.getPlace(C.FAVORITES_ID))?.properties.plants ?? [])
  .map(e => [e.plantId, [e.origin?.app ?? null, e.from?.app ?? null]]));
/** The favourites made anew, those of a game (`origin`) and the user's. @param {[number, string | null][]} list */
async function favouritesOf(list) {
  await db.remove('spots', C.FAVORITES_ID).catch(() => {});
  for (const [id, app] of list) await C.toggleFavorite(plant(id), app ? { app } : undefined);
}

test('rien à promouvoir sans favoris : aucun favori créé pour rien', async () => {
  await C.promoteFavorites([1, 2]);
  await C.promotePlace(C.FAVORITES_ID);
  assert.equal(await C.getPlace(C.FAVORITES_ID), undefined);
  // A list of the user's with plants, the favourites never made: still none.
  await C.savePlace(C.withPlant(C.newCollection('list', { name: 'Vide de favoris' }), plant(1)));
  assert.equal(await C.getPlace(C.FAVORITES_ID), undefined);
});

test('un favori de partie rangé dans une liste, ou noté de nouveau dans un lieu, est à vous ; une altitude ne change rien', async () => {
  await favouritesOf([[1, 'rencontres'], [2, 'rencontres'], [3, 'cueillette'], [4, null]]);
  const list = await C.savePlace(C.newCollection('list', { name: 'Cuisine' }));
  await C.setInCollection(list.id, plant(1), true);
  assert.deepEqual(await favourites(), { 1: [null, 'rencontres'], 2: ['rencontres', null], 3: ['cueillette', null], 4: [null, null] });
  // A lieu holding the plant already: noted there again (another occurrence) makes its favourite the user's too.
  const place = await C.savePlace(C.withPlant(C.newPlace([2.35, 48.85], { name: 'Bois', origin: { app: 'parcours' } }), plant(2)));
  assert.deepEqual((await favourites())[2], ['rencontres', null], 'un lieu fait par une activité : rien n’est à vous');
  await C.updatePlace(place.id, c => C.withPlant(c, plant(2), undefined, { again: true }), { by: 'parcours' });
  assert.deepEqual((await favourites())[2], ['rencontres', null], 'ajouté par l’activité elle-même : rien n’est à vous');
  // The altitudes the app asks for: no change by the user — the lieu stays the activity's, nothing promoted.
  const high = await C.updatePlace(place.id, c => ({ ...c, properties: { ...c.properties,
    plants: c.properties.plants.map(e => ({ ...e, altitude: { m: 120, at: /** @type {[number, number]} */ (e.coordinates) } })) } }));
  assert.deepEqual(high.properties.origin, { app: 'parcours' });
  assert.deepEqual((await favourites())[2], ['rencontres', null]);
  // Noted again by the user: the lieu and the favourite are theirs.
  await C.updatePlace(place.id, c => C.withPlant(c, plant(2), undefined, { again: true }));
  assert.deepEqual((await C.getPlace(place.id))?.properties.from, { app: 'parcours' });
  assert.deepEqual((await favourites())[2], [null, 'rencontres']);
  // A new list of the user's (« Ajouter à… », « Noter ici », a link saved) with the plant: its favourite is theirs.
  await C.savePlace(C.withPlant(C.newCollection('list', { name: 'Tisanes' }), plant(3)));
  assert.deepEqual(await favourites(), { 1: [null, 'rencontres'], 2: [null, 'rencontres'], 3: [null, 'cueillette'], 4: [null, null] });
});

test('un favori de partie annoté, noté ou récolté dans les Favoris est à vous ; les Favoris partagés ou exportés seuls aussi', async () => {
  await favouritesOf([[1, 'rencontres'], [2, 'rencontres'], [3, 'mosaique']]);
  const entry = /** @type {any} */ (C.findEntry(/** @type {any} */ (await C.getPlace(C.FAVORITES_ID)), 1));
  await C.updatePlace(C.FAVORITES_ID, c => C.withEntry(c, entry.id, { notes: 'Près du lavoir' }));
  assert.deepEqual(await favourites(), { 1: [null, 'rencontres'], 2: ['rencontres', null], 3: ['mosaique', null] });
  // The editor's way (place-model.js rebase): a rating given.
  const base = /** @type {any} */ (await C.getPlace(C.FAVORITES_ID));
  await C.savePatch(base, C.withEntry(base, 2, { rating: 4 }));
  assert.deepEqual(await favourites(), { 1: [null, 'rencontres'], 2: [null, 'rencontres'], 3: ['mosaique', null] });
  // Shared or exported alone: every favourite of a match in them.
  await C.promotePlace(C.FAVORITES_ID);
  assert.deepEqual(await favourites(), { 1: [null, 'rencontres'], 2: [null, 'rencontres'], 3: [null, 'mosaique'] });
  // Nothing left to promote: nothing written.
  const before = (await C.getPlace(C.FAVORITES_ID))?.properties.updatedAt;
  await C.promotePlace(C.FAVORITES_ID);
  await C.promoteFavorites([1, 2, 3]);
  assert.equal((await C.getPlace(C.FAVORITES_ID))?.properties.updatedAt, before);
});
