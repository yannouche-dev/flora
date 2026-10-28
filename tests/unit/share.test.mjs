// app/core/share.js: the links that share a collection (#/shared/z…) or carry several (transfer, g…).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeCollection, decodePortable, encodeCollection, encodePortable, isPortableLink } from '../../app/core/share.js';

const place = /** @type {any} */ ({
  type: 'Feature', id: 'x', geometry: { type: 'Point', coordinates: [2.35, 48.85] },
  properties: { kind: 'place', name: 'Bord du canal', plants: [
    { plantId: 81541, abundance: 'abondant', coordinates: [2.3501, 48.8502] },
    { plantId: 100225, abundance: 'moyen', coordinates: [2.35, 48.85] },
    { plantId: 128268, abundance: 'rare', coordinates: [2.3499, 48.8498] },
    { plantId: null, scientificName: 'Planta ignota', abundance: 'rare' }
  ] }
});

test('lieu : nom, point, abondances et positions (≈ 0,1 m) survivent au lien', async () => {
  const link = await encodeCollection(place);
  assert.match(link, /^z[A-Za-z0-9_-]+$/, 'compressé quand le navigateur sait le faire');
  assert.equal(isPortableLink(link), false);
  const back = await decodeCollection(link);
  assert.equal(back.kind, 'place');
  assert.equal(back.name, 'Bord du canal');
  assert.deepEqual(back.coordinates, [2.35, 48.85]);
  assert.deepEqual(back.plants.map(p => p.plantId), [81541, 100225, 128268], 'une plante hors flore ne part pas');
  assert.deepEqual(back.plants.map(p => p.abundance), ['abondant', undefined, 'rare']);
  assert.deepEqual(back.plants[0].coordinates, [2.3501, 48.8502]);
  assert.equal(back.plants[1].coordinates, undefined, 'au point du lieu : pas de décalage');
});

test('parcours : il le reste (son départ « ici » aussi), ses plantes dans l’ordre rencontré ; un lieu, non', async () => {
  const at = (/** @type {number} */ m) => `2026-10-13T09:${String(m).padStart(2, '0')}:00.000Z`;
  const walk = { ...place, properties: { ...place.properties, name: 'Chemin du lavoir', walk: true, startedHere: true, plants: [
    { plantId: 128268, abundance: 'rare', coordinates: [2.3502, 48.8503], addedAt: at(30) },
    { plantId: 81541, abundance: 'moyen', coordinates: [2.3501, 48.8501], addedAt: at(10) },
    { plantId: 100225, abundance: 'moyen', coordinates: [2.35, 48.85], addedAt: at(20) }
  ] } };
  const back = await decodeCollection(await encodeCollection(/** @type {any} */ (walk)));
  assert.deepEqual([back.kind, back.walk, back.startedHere], ['place', true, true]);
  assert.deepEqual(back.plants.map(p => p.plantId), [81541, 100225, 128268], 'dans l’ordre rencontré');
  // A lieu (or a list) is neither — not even one given the marks by hand.
  const plain = await decodeCollection(await encodeCollection(place));
  assert.deepEqual([plain.walk, plain.startedHere], [undefined, undefined]);
  assert.deepEqual(plain.plants.map(p => p.plantId), [81541, 100225, 128268], 'un lieu : dans son ordre');
  const list = { ...walk, geometry: null, properties: { ...walk.properties, kind: 'list' } };
  const asList = await decodeCollection(await encodeCollection(/** @type {any} */ (list)));
  assert.deepEqual([asList.kind, asList.walk, asList.startedHere], ['list', undefined, undefined]);
  // A list's link that says it is a walk is read as a list.
  const forged = { v: 1, n: 'x', k: 'list', w: 1, s: 1, p: [[1]] };
  const read = await decodeCollection('j' + Buffer.from(JSON.stringify(forged)).toString('base64url'));
  assert.deepEqual([read.kind, read.walk, read.startedHere], ['list', undefined, undefined]);
});

test('liste et favoris : sans point, les favoris partagés sous un nom à eux', async () => {
  const fav = { type: 'Feature', id: 'favorites', geometry: null, properties: { kind: 'favorites', name: 'Favoris', plants: [{ plantId: 1 }, { plantId: 2 }] } };
  const back = await decodeCollection(await encodeCollection(/** @type {any} */ (fav)));
  assert.equal(back.kind, 'list');
  assert.equal(back.coordinates, null);
  assert.equal(back.name, 'Favoris partagés');
  assert.deepEqual(back.plants, [{ plantId: 1 }, { plantId: 2 }]);
});

test('lien non compressé (j…) : lu aussi ; valeurs hors bornes écartées', async () => {
  const json = { v: 1, n: 'x'.repeat(400), k: 'place', c: [500, 48], p: [[1, 'a', 5, 5], [1, 'a', 5, 5], ['2'], [3, 'z']] };
  const back = await decodeCollection('j' + Buffer.from(JSON.stringify(json)).toString('base64url'));
  assert.equal(back.name.length, 300);
  assert.equal(back.kind, 'list', 'point invalide : plus un lieu');
  assert.deepEqual(back.plants, [{ plantId: 1, abundance: 'abondant' }, { plantId: 3 }], 'doublon exact et identifiant non entier retirés');
});

test('lien abîmé : un message en français, jamais une exception brute', async () => {
  await assert.rejects(decodeCollection('zAAAA'), /incomplet ou abîmé/);
  await assert.rejects(decodeCollection('q' + 'abc'), /incomplet ou abîmé/);
  await assert.rejects(decodeCollection('j' + Buffer.from('{"v":2}').toString('base64url')), /pas reconnu/);
  await assert.rejects(decodePortable('gAAAA'), /incomplet ou abîmé/);
  await assert.rejects(decodePortable('k' + Buffer.from('{"type":"Feature"}').toString('base64url')), /pas reconnu/);
});

test('transfert (g…) : la FeatureCollection revient telle quelle', async () => {
  const fc = { type: 'FeatureCollection', name: 'GeoFlora — mes plantes', features: [place] };
  const link = await encodePortable(fc);
  assert.ok(isPortableLink(link));
  assert.deepEqual(await decodePortable(link), fc);
});
