// app/core/place-model.js: two copies of a collection put together — rebase (an editor's edits applied to the record
// as stored now, audit GAP1-1 / GAP1-4) and mergeCollections (an import or a transfer link, audit STO-13).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCollections, normalizeCollection, rebase, sameContent } from '../../app/core/place-model.js';

const T0 = '2026-05-01T10:00:00.000Z', T1 = '2026-05-02T10:00:00.000Z', T2 = '2026-05-03T10:00:00.000Z';

/** @param {any} properties @param {[number, number] | null} [at] */
const place = (properties, at = [2.35, 48.85]) => /** @type {import('../../app/core/place-model.js').Collection} */ (normalizeCollection({
  type: 'Feature', id: 'bois', geometry: at ? { type: 'Point', coordinates: at } : null,
  properties: { name: 'Bois', createdAt: T0, updatedAt: T0, plants: [], ...properties }
}));
const entry = (/** @type {string} */ id, /** @type {number} */ plantId, /** @type {any} */ more = {}) => ({ id, plantId, scientificName: 'P' + plantId, ...more });
const ids = (/** @type {any} */ c) => c.properties.plants.map((/** @type {any} */ e) => e.id);

test('rebase : le renommage fait ici garde la plante et la récolte ajoutées ailleurs (GAP1-1)', () => {
  const base = place({ plants: [entry('a', 1)] });
  const mine = { ...base, properties: { ...base.properties, name: 'Bois du haut' } };
  const theirs = place({ updatedAt: T1, plants: [entry('a', 1, { harvests: [{ date: '2026-05-02' }] }), entry('b', 2)] });
  const out = rebase(base, mine, theirs);
  assert.equal(out.properties.name, 'Bois du haut');
  assert.deepEqual(ids(out), ['a', 'b']);
  assert.deepEqual(out.properties.plants[0].harvests.map(h => h.date), ['2026-05-02']);
  assert.deepEqual(out.properties.plantIds, [1, 2]);
});

test('rebase : une plante ajoutée ici et une autre ailleurs, toutes deux gardées (GAP1-4)', () => {
  const base = place({ plants: [entry('a', 1)] });
  const mine = place({ plants: [entry('a', 1), entry('c', 3)] });
  const theirs = place({ updatedAt: T1, plants: [entry('a', 1), entry('b', 2)] });
  assert.deepEqual(ids(rebase(base, mine, theirs)), ['a', 'b', 'c']);
});

test('rebase : une plante retirée ici part, les champs non touchés ici restent ceux d’ailleurs', () => {
  const base = place({ notes: 'n', plants: [entry('a', 1), entry('b', 2, { abundance: 'rare' })] });
  const mine = place({ notes: 'n', plants: [entry('b', 2, { abundance: 'rare', rating: 4 })] });
  const theirs = place({ notes: 'note d’ailleurs', updatedAt: T1, plants: [entry('a', 1), entry('b', 2, { abundance: 'abondant' })] });
  const out = rebase(base, mine, theirs);
  assert.deepEqual(ids(out), ['b']);
  assert.equal(out.properties.notes, 'note d’ailleurs');
  // Rating changed here, abundance changed there: both kept.
  assert.equal(out.properties.plants[0].rating, 4);
  assert.equal(out.properties.plants[0].abundance, 'abondant');
});

test('rebase : récoltes ajoutées et retirées des deux côtés, sans doublon', () => {
  const h = (/** @type {string} */ date) => ({ date });
  const base = place({ plants: [entry('a', 1, { harvests: [h('2026-01-01'), h('2026-02-01')] })] });
  const mine = place({ plants: [entry('a', 1, { harvests: [h('2026-02-01'), h('2026-03-01')] })] });
  const theirs = place({ updatedAt: T1, plants: [entry('a', 1, { harvests: [h('2026-01-01'), h('2026-02-01'), h('2026-04-01'), h('2026-03-01')] })] });
  assert.deepEqual(rebase(base, mine, theirs).properties.plants[0].harvests.map(x => x.date), ['2026-04-01', '2026-03-01', '2026-02-01']);
});

test('rebase : rien d’édité ici, l’enregistrement reste tel quel', () => {
  const base = place({ plants: [entry('a', 1)] });
  const theirs = place({ updatedAt: T1, plants: [entry('a', 1), entry('b', 2)] });
  assert.equal(rebase(base, structuredClone(base), theirs), theirs);
});

test('rebase : point déplacé ici, devenu liste ailleurs → cohérent (liste sans point)', () => {
  const base = place({});
  const mine = place({}, [3, 45]);
  const theirs = place({ kind: 'list', updatedAt: T1 }, null);
  const out = rebase(base, mine, theirs);
  assert.equal(out.properties.kind, 'list');
  assert.equal(out.geometry, null);
});

test('mergeCollections : un fichier plus récent n’efface pas la plante ni la note propres à cet appareil (STO-13)', () => {
  const local = place({ updatedAt: T1, plants: [entry('p81541', 81541), entry('p92127', 92127, { notes: 'note locale importante' })] });
  const incoming = place({ name: 'Bois (autre appareil)', updatedAt: T2, plants: [entry('p81541', 81541), entry('p92237', 92237)] });
  const out = mergeCollections(local, incoming);
  assert.equal(out.properties.name, 'Bois (autre appareil)');
  assert.deepEqual(out.properties.plantIds.sort(), [81541, 92127, 92237]);
  assert.equal(out.properties.plants.find(e => e.plantId === 92127)?.notes, 'note locale importante');
});

test('mergeCollections : notes et récoltes gardées quand la copie la plus récente n’en a pas (lien sans données personnelles)', () => {
  const local = place({ notes: 'à moi', plants: [entry('a', 1, { notes: 'ici', harvests: [{ date: '2026-04-01' }] })] });
  const incoming = place({ updatedAt: T2, plants: [entry('a', 1, { abundance: 'rare', harvests: [{ date: '2026-04-20' }] })] });
  const out = mergeCollections(local, incoming);
  const e = out.properties.plants[0];
  assert.equal(out.properties.notes, 'à moi');
  assert.equal(e.notes, 'ici');
  assert.equal(e.abundance, 'rare');
  assert.deepEqual(e.harvests.map(h => h.date), ['2026-04-20', '2026-04-01']);
});

test('mergeCollections : listes et favoris réunis par plante (ids d’entrée différents d’un appareil à l’autre)', () => {
  const local = place({ kind: 'list', plants: [entry('e1', 1), entry('e2', 2)] }, null);
  const incoming = place({ kind: 'list', updatedAt: T2, plants: [entry('x1', 1), entry('x3', 3)] }, null);
  const out = mergeCollections(local, incoming);
  assert.deepEqual(out.properties.plantIds, [1, 3, 2]);
  assert.equal(out.properties.plants.length, 3);
});

test('mergeCollections : une copie plus ancienne n’apporte que ce qui manque', () => {
  const local = place({ name: 'Nouveau nom', updatedAt: T2, plants: [entry('a', 1)] });
  const old = place({ name: 'Ancien', updatedAt: T0, plants: [entry('a', 1)] });
  const out = mergeCollections(local, old);
  assert.ok(sameContent(out, local));
  assert.deepEqual(ids(mergeCollections(local, place({ updatedAt: T0, plants: [entry('a', 1), entry('b', 2)] }))), ['a', 'b']);
});
