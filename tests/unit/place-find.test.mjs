// A place typed as words, found among the IGN geocoder's answers (app/core/place-find.js): the words read (a name, a
// commune, a département at the end), the geocoder's features as candidates (its `poi` and `address` indexes), the
// best of them — a place of that name in the commune said, else the commune; a commune of exactly that name when none
// is said; never a far-away homonym when a département is said.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateOf, matchLevel, normalize, parsePlace, pickCommune, rankPlaces } from '../../app/core/place-find.js';

/** A feature of the `poi` index (lists for its communes, as the Géoplateforme answers). */
const poi = (/** @type {string} */ name, /** @type {string} */ city, /** @type {string} */ citycode, /** @type {[number, number]} */ at, score = 0.8) => candidateOf({
  type: 'Feature', geometry: { type: 'Point', coordinates: at },
  properties: { _type: 'poi', toponym: name, name: [name], category: ['sommet'], city: [city], citycode: [citycode], postcode: [citycode.slice(0, 2) + '000'], score }
});
/** A commune of the `address` index (type=municipality). */
const town = (/** @type {string} */ name, /** @type {string} */ citycode, /** @type {string} */ postcode, /** @type {[number, number]} */ at, score = 0.9) => candidateOf({
  type: 'Feature', geometry: { type: 'Point', coordinates: at },
  properties: { _type: 'address', type: 'municipality', label: name, name, city: name, citycode, id: citycode, postcode, score, context: `${citycode.slice(0, 2)}, …` }
});
const all = (/** @type {any[]} */ xs) => /** @type {import('../../app/core/place-find.js').Candidate[]} */ (xs);

const MENETROL = town('Ménétrol', '63224', '63200', [3.1244, 45.8711]);
const MIRABEL_PUY = poi('Puy de Mirabel', 'Ménétrol', '63224', [3.1093, 45.8732]);
// Homonyms far away: the communes of Mirabel (Ardèche, Tarn-et-Garonne), a « Mirabel » lieu-dit in the Drôme.
const MIRABEL_07 = town('Mirabel', '07158', '07170', [4.4970, 44.6060], 0.95);
const MIRABEL_82 = town('Mirabel', '82110', '82440', [1.4770, 44.1600], 0.94);
const MIRABEL_26 = poi('Mirabel', 'Mirabel-aux-Baronnies', '26187', [5.0990, 44.3110], 0.99);

test('les mots lus : un nom, une commune après une virgule, un département à la fin', () => {
  assert.deepEqual(parsePlace('mirabel, menetrol, 63'), { text: 'mirabel, menetrol, 63', name: 'mirabel', commune: 'menetrol', dept: '63' });
  assert.deepEqual(parsePlace('Ménétrol'), { text: 'Ménétrol', name: 'Ménétrol', commune: null, dept: null });
  assert.deepEqual(parsePlace('Fontainebleau 77'), { text: 'Fontainebleau 77', name: 'Fontainebleau', commune: null, dept: '77' });
  assert.deepEqual(parsePlace('  Paris  '), { text: 'Paris', name: 'Paris', commune: null, dept: null });
  // A postcode, Corsica, overseas.
  assert.equal(parsePlace('Ménétrol 63200')?.dept, '63');
  assert.equal(parsePlace('Ajaccio, 2a')?.dept, '2A');
  assert.equal(parsePlace('Saint-Denis, 974')?.dept, '974');
  assert.equal(parsePlace('Saint-Pierre 97410')?.dept, '974');
  // Nothing to look for.
  assert.equal(parsePlace(''), null);
  assert.equal(parsePlace(' , '), null);
  assert.equal(normalize('Saint-Étienne’s  ST-Jean'), 'saint etienne s saint jean');
  assert.deepEqual([matchLevel('menetrol', 'Ménétrol'), matchLevel('mirabel', 'Puy de Mirabel'), matchLevel('colline de mirabel', 'Puy de Mirabel'), matchLevel('mirabel', 'Mirebeau')], [3, 2, 1, 0]);
});

test('les réponses du géocodeur : un lieu (poi, ses communes en listes), une commune ; sans point ni nom, rien', () => {
  assert.deepEqual(MIRABEL_PUY, { kind: 'poi', name: 'Puy de Mirabel', citycodes: ['63224'], postcodes: ['63000'], cities: ['Ménétrol'], coordinates: [3.1093, 45.8732], score: 0.8 });
  assert.deepEqual(MENETROL, { kind: 'municipality', name: 'Ménétrol', citycodes: ['63224'], postcodes: ['63200'], cities: ['Ménétrol'], coordinates: [3.1244, 45.8711], score: 0.9 });
  assert.equal(candidateOf({ properties: { _type: 'poi', toponym: 'X' } }), null);
  assert.equal(candidateOf({ geometry: { coordinates: [3, 45] }, properties: { _type: 'poi' } }), null);
});

test('« mirabel, menetrol, 63 » : le puy de Mirabel à Ménétrol, jamais un Mirabel lointain', () => {
  const q = /** @type {import('../../app/core/place-find.js').PlaceQuery} */ (parsePlace('mirabel, menetrol, 63'));
  const commune = pickCommune('menetrol', all([MIRABEL_07, MENETROL]), '63');
  assert.equal(commune, MENETROL);
  const found = rankPlaces(q, { pois: all([MIRABEL_26, MIRABEL_PUY]), commune });
  assert.deepEqual(found, { label: 'Puy de Mirabel (Ménétrol)', coordinates: [3.1093, 45.8732], kind: 'poi' });
  // No place of that name near the commune: the commune itself.
  assert.deepEqual(rankPlaces(q, { pois: all([MIRABEL_26]), commune }), { label: 'Ménétrol (63)', coordinates: [3.1244, 45.8711], kind: 'municipality' });
  // A place near the commune but listed under its neighbour (within 10 km): taken.
  const next = poi('Colline de Mirabel', 'Riom', '63300', [3.10, 45.88]);
  assert.equal(rankPlaces(q, { pois: all([next]), commune })?.label, 'Colline de Mirabel (Riom)');
  // The commune not found: a place of that name in the département, never one elsewhere.
  assert.equal(rankPlaces(q, { pois: all([MIRABEL_26, MIRABEL_PUY]), commune: null })?.label, 'Puy de Mirabel (Ménétrol)');
  assert.equal(rankPlaces(q, { pois: all([MIRABEL_26]), commune: null }), null);
});

test('« Ménétrol », « Paris », « Fontainebleau 77 » : la commune de ce nom ; « mirabel, 63 » : rien hors du Puy-de-Dôme ; un nom inconnu : rien', () => {
  const find = (/** @type {string} */ text, /** @type {any} */ found) => rankPlaces(/** @type {any} */ (parsePlace(text)), found);
  assert.equal(find('Ménétrol', { pois: all([MIRABEL_PUY]), communes: all([MENETROL]) })?.label, 'Ménétrol (63)');
  const paris = town('Paris', '75056', '75001', [2.3488, 48.8534]);
  const parisPoi = poi('Gare de Paris-Bercy', 'Paris', '75056', [2.38, 48.84]);
  assert.deepEqual(find('Paris', { pois: all([parisPoi]), communes: all([paris]) }), { label: 'Paris (75)', coordinates: [2.3488, 48.8534], kind: 'municipality' });
  // Fontainebleau: the commune in Seine-et-Marne, not a homonym elsewhere (even ranked first by the geocoder).
  const fbOther = town('Fontainebleau', '41999', '41000', [1.3, 47.6], 0.99);
  const fb = town('Fontainebleau', '77186', '77300', [2.7011, 48.4047], 0.9);
  assert.equal(find('Fontainebleau 77', { pois: [], communes: all([fbOther, fb]) })?.label, 'Fontainebleau (77)');
  // No commune of that name: a place of it (a summit), the best match first.
  assert.equal(find('puy de mirabel', { pois: all([MIRABEL_26, MIRABEL_PUY]), communes: all([MIRABEL_07]) })?.label, 'Puy de Mirabel (Ménétrol)');
  // A département said: no homonym from elsewhere.
  assert.equal(find('mirabel, 63', { pois: all([MIRABEL_26]), communes: all([MIRABEL_07, MIRABEL_82]) }), null);
  assert.equal(find('mirabel, 82', { pois: all([MIRABEL_26]), communes: all([MIRABEL_07, MIRABEL_82]) })?.label, 'Mirabel (82)');
  // Nothing that matches.
  assert.equal(find('Zzyzx', { pois: all([MIRABEL_PUY]), communes: all([MENETROL]) }), null);
  assert.equal(find('Zzyzx', { pois: [], communes: [] }), null);
});
