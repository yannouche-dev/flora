// A free layout's live state (app/layout/state.js, LayoutState) against an IndexedDB in memory (fake-indexeddb): what it
// reads of the flora waits for the flora. On a first visit the layout is drawn while the flora downloads; a plant in the
// address (?p=) read then was « none » for good — its names never read again (the cells' heads empty) — and a plant
// left before its names came was never read when chosen again.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// db.js upgrades the schema only from a page (a worker opens whatever version exists).
/** @type {any} */ (globalThis).window ??= globalThis;

const db = await import('../../app/core/db.js');
const { store } = await import('../../app/core/store.js');
const { LayoutState } = await import('../../app/layout/state.js');

const AIL = { id: 81541, scientificName: 'Allium ursinum', vernacularNames: ['Ail des ours'] };
const ORTIE = { id: 128268, scientificName: 'Urtica dioica', vernacularNames: ['Ortie dioïque'] };

/** The state's next drawing whose plant names are there. @param {InstanceType<typeof LayoutState>} s */
const named = s => new Promise(resolve => {
  const check = () => { if (s.plantInfo) { s.removeEventListener('change', check); resolve(s.plantInfo); } };
  s.addEventListener('change', check);
  check();
});
const tick = () => new Promise(resolve => setTimeout(resolve, 20));

test('une plante dans l’adresse avant que la flore soit là : ses noms lus une fois la flore enregistrée, jamais « aucune »', async () => {
  assert.equal(store.state.status, 'loading');
  const s = new LayoutState();
  s.set({ plant: AIL.id }, 'none');
  await tick();
  // The flora not stored yet: no names, and none taken for « no such plant ».
  assert.equal(s.plantInfo, null);
  // Left (Back) and chosen again while it waits: read when the flora comes, all the same.
  s.set({ plant: null }, 'none');
  s.set({ plant: ORTIE.id }, 'none');
  s.set({ plant: AIL.id }, 'none');
  await db.replacePlants([AIL, ORTIE], { plants: 2 });
  store.set({ status: 'ready' });
  assert.deepEqual(await named(s), { id: AIL.id, name: 'Ail des ours', sci: 'Allium ursinum' });
  // The flora there: another plant read at once.
  s.set({ plant: ORTIE.id }, 'none');
  await tick();
  assert.deepEqual(s.plantInfo, { id: ORTIE.id, name: 'Ortie dioïque', sci: 'Urtica dioica' });
  s.dispose();
});

test('un lieu en mots dans l’adresse (place= sans at=) : trouvé, il devient la zone et l’adresse le remplace ; introuvable ou hors ligne : dit, place= gardé', async () => {
  /** @type {string[]} */
  const asked = [];
  const found = { label: 'Puy de Mirabel (Ménétrol)', coordinates: /** @type {[number, number]} */ ([3.1093, 45.8732]), kind: /** @type {'poi'} */ ('poi') };
  /** @param {string} text */
  const find = async text => {
    asked.push(text);
    if (text === 'hors ligne') throw Object.assign(new Error('offline'), { name: 'SourceError', kind: 'offline' });
    return text.startsWith('mirabel') ? found : null;
  };
  const s = new LayoutState({ radius: 1000, find });
  /** @type {{ how: string, keys: string[] }[]} */
  const changes = [];
  s.addEventListener('change', e => { const d = /** @type {CustomEvent} */ (e).detail; if (d.keys.length) changes.push(d); });
  s.set({ place: 'mirabel, menetrol, 63' }, 'none');
  assert.equal(s.placeState, 'finding');
  await tick();
  assert.deepEqual(s.live.at, [3.1093, 45.8732]);
  assert.equal(s.live.place, 'Puy de Mirabel (Ménétrol)');
  assert.deepEqual([s.placeState, s.placeError], ['idle', null]);
  // The address replaced, not a new entry.
  assert.deepEqual(changes.at(-1), { how: 'replace', keys: ['at', 'place'] });
  assert.deepEqual(asked, ['mirabel, menetrol, 63']);
  // Not found: no scope, why said, the words kept (a reload asks again).
  s.setScope(null);
  s.set({ place: 'Zzyzx' }, 'none');
  await tick();
  assert.deepEqual([s.live.at, s.live.place, s.placeState, s.placeError], [null, 'Zzyzx', 'failed', 'Lieu introuvable : Zzyzx']);
  s.set({ place: 'hors ligne' }, 'none');
  await tick();
  assert.equal(s.placeError, 'Hors ligne : lieu non cherché (hors ligne)');
  // No scope asked: nothing said any more.
  s.setScope(null);
  assert.deepEqual([s.placeState, s.placeError], ['idle', null]);
  s.dispose();
});
