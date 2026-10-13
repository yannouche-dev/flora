// The user's data on this device (audit, chantier « Données utilisateur »), against an IndexedDB in memory
// (fake-indexeddb): app/core/db.js update (read and write in one transaction), collections.js updatePlace (never
// remakes a deleted collection) and the import's merge, sheet-notes.js (the plant sheet's notes moved from
// localStorage to IndexedDB, once, without loss), sync.js (BroadcastChannel between tabs), quota.js.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// db.js upgrades the schema only from a page (a worker opens whatever version exists).
/** @type {any} */ (globalThis).window ??= globalThis;

const { config } = await import('../../app/config.js');
const db = await import('../../app/core/db.js');
const C = await import('../../app/core/collections.js');
const notes = await import('../../app/core/sheet-notes.js');
const sync = await import('../../app/core/sync.js');
const quota = await import('../../app/core/quota.js');
const { toPortable } = await import('../../app/core/portable.js');

const plant = (/** @type {number} */ id) => ({ id, scientificName: 'Planta ' + id, vernacularNames: ['Plante ' + id] });

test('db : la base est à la version 6, avec le magasin des notes de fiche et sans perdre les autres', async () => {
  const conn = await db.openDb();
  assert.equal(conn.version, config.db.version);
  assert.deepEqual([...conn.objectStoreNames].sort(), ['meta', 'plantDetails', 'plants', 'sheetNotes', 'spots']);
});

test('db.update : lecture et écriture dans la même transaction — 20 ajouts simultanés, aucun perdu', async () => {
  const list = C.newCollection('list', { name: 'Course' });
  await C.savePlace(list);
  await Promise.all(Array.from({ length: 20 }, (_, i) => C.updatePlace(list.id, current => C.withPlant(current, plant(1000 + i)))));
  const stored = await C.getPlace(list.id);
  assert.equal(stored?.properties.plants.length, 20);
});

test('db.update : une exception dans la fonction annule tout (rien d’écrit)', async () => {
  await db.put('meta', 'avant', 'k');
  await assert.rejects(db.updateMany('plantDetails', ['x', 'y'], (current, key) => {
    if (key === 'y') throw new Error('non');
    return { key, value: 1 };
  }), /non/);
  assert.equal(await db.get('plantDetails', 'x'), undefined);
});

test('updatePlace : une collection supprimée entre-temps n’est pas recréée (GAP1-2)', async () => {
  const p = C.newPlace([2.35, 48.85], { name: 'Friche' });
  await C.savePlace(p);
  await C.deletePlace(p.id);
  await assert.rejects(C.updatePlace(p.id, current => ({ ...current, properties: { ...current.properties, name: 'Friche (corrigé)' } })), { name: 'GoneError' });
  assert.equal(await C.getPlace(p.id), undefined);
});

test('savePatch : l’éditeur périmé garde la plante ajoutée ailleurs (GAP1-1)', async () => {
  const p = C.newPlace([2.35, 48.85], { name: 'Bois' });
  const base = await C.savePlace(p);
  // Elsewhere: a plant added.
  await C.setInCollection(p.id, plant(128268), true);
  // Here: the stale copy renamed.
  const mine = { ...base, properties: { ...base.properties, name: 'Bois du haut' } };
  const saved = await C.savePatch(base, mine);
  assert.equal(saved.properties.name, 'Bois du haut');
  assert.deepEqual(saved.properties.plantIds, [128268]);
});

test('favoris : créés au premier usage, ajout et retrait atomiques', async () => {
  assert.equal(await C.toggleFavorite(plant(5)), true);
  assert.equal(await C.toggleFavorite(plant(6)), true);
  assert.equal(await C.toggleFavorite(plant(5)), false);
  assert.deepEqual((await C.getPlace(C.FAVORITES_ID))?.properties.plantIds, [6]);
});

test('notes de fiche : déplacées de localStorage dans IndexedDB une seule fois, sans perte', async () => {
  localStorage.setItem(config.storageKeys.plantNotes, JSON.stringify({ abc: { 100225: 'Station de 30 pieds', 128268: 'Au bord du ruisseau' }, vide: { 1: '  ' } }));
  await notes.loadNotes();
  assert.equal(notes.noteText('abc', 100225), 'Station de 30 pieds');
  assert.equal(notes.noteText('abc', 128268), 'Au bord du ruisseau');
  assert.equal(localStorage.getItem(config.storageKeys.plantNotes), null);
  assert.equal((await db.getAll('sheetNotes')).length, 2);
  // Edited since; an older tab writes the old key again: the move adds nothing over the newer text.
  assert.equal(await notes.setNoteText('abc', 100225, 'Station de 40 pieds'), true);
  localStorage.setItem(config.storageKeys.plantNotes, JSON.stringify({ abc: { 100225: 'Station de 30 pieds', 999: 'nouvelle' } }));
  await notes.loadNotes();
  assert.equal(notes.noteText('abc', 100225), 'Station de 40 pieds');
  assert.equal(notes.noteText('abc', 999), 'nouvelle');
  // Again: nothing changes.
  await notes.loadNotes();
  assert.equal((await db.getAll('sheetNotes')).length, 3);
});

test('notes de fiche : effacer un texte le retire ; fusion d’un import — le plus récent gagne, rien n’est supprimé', async () => {
  await notes.setNoteText('abc', 999, '');
  assert.equal(notes.noteText('abc', 999), '');
  const written = await notes.mergeNoteTexts(notes.fromPortable([
    { id: 'abc', title: 'Terrain', texts: { 100225: { text: 'ancien', updatedAt: '2000-01-01T00:00:00.000Z' }, 7: { text: 'venu d’ailleurs', updatedAt: '2000-01-01T00:00:00.000Z' } } },
    { id: 'BAD!', texts: { 1: 'ignoré' } }
  ]));
  assert.equal(written, 1);
  assert.equal(notes.noteText('abc', 100225), 'Station de 40 pieds');
  assert.equal(notes.noteText('abc', 7), 'venu d’ailleurs');
});

test('copie de secours et export : les notes de fiche y sont, et reviennent (STO-6)', async () => {
  assert.equal(await C.writeBackup(), 'saved');
  const backup = C.readBackup();
  assert.ok(backup?.sheetNotes?.some(n => n.id === 'abc' && n.texts[100225].text === 'Station de 40 pieds'));
  // Lost from the database: the backup brings them back.
  await db.clear('sheetNotes');
  await notes.loadNotes();
  assert.equal(notes.noteText('abc', 100225), '');
  await C.restoreBackup();
  assert.equal(notes.noteText('abc', 100225), 'Station de 40 pieds');
  // The portable form (file, link) carries them only with personal data.
  assert.equal(toPortable([], { personal: false, sheetNotes: [{ id: 'abc', title: 'x', texts: {} }] }).sheetNotes, undefined);
  assert.equal(toPortable([], { sheetNotes: [{ id: 'abc', title: 'x', texts: {} }] }).sheetNotes?.length, 1);
});

test('import : fusion par collection, plantes des deux côtés gardées (STO-13), notes de fiche importées', async () => {
  const local = C.newCollection('list', { name: 'Comestibles', updatedAt: '2026-01-01T00:00:00.000Z' });
  await C.savePlace(C.withPlant(C.withPlant(local, plant(81541)), plant(92127)));
  const incoming = toPortable([C.withPlant(C.withPlant({ ...local, properties: { ...local.properties, updatedAt: '2099-01-01T00:00:00.000Z' } }, plant(81541)), plant(92237))],
    { sheetNotes: [{ id: 'nouv', title: 'Cuisine', texts: { 81541: { text: 'en soupe', updatedAt: '2026-01-01T00:00:00.000Z' } } }] });
  const r = await C.importPortable(incoming);
  assert.equal(r.updated, 1);
  assert.equal(r.notes, 1);
  assert.deepEqual((await C.getPlace(local.id))?.properties.plantIds.sort(), [81541, 92127, 92237]);
  assert.equal(notes.noteText('nouv', 81541), 'en soupe');
  // The note block was made, so the text shows on the sheet.
  const { store } = await import('../../app/core/store.js');
  assert.ok(store.state.sheetLayout.notes.some(n => n.id === 'nouv' && n.title === 'Cuisine'));
  // Imported again: nothing changes.
  assert.equal((await C.importPortable(incoming)).unchanged, 1);
});

test('sync : un message d’un autre onglet est relayé, ceux de cet onglet partent sur le canal', async () => {
  const other = new BroadcastChannel('geoflora');
  try {
    const got = new Promise(resolve => { const off = sync.subscribe('essai', detail => { off(); resolve(detail); }); });
    other.postMessage({ type: 'essai', detail: { ids: ['a'] } });
    assert.deepEqual(await got, { ids: ['a'] });
    const heard = new Promise(resolve => { other.onmessage = event => resolve(event.data); });
    sync.publish('spots', { n: 1 });
    assert.deepEqual(await heard, { type: 'spots', detail: { n: 1 } });
  } finally {
    other.close();
  }
});

test('quota : une écriture refusée faute de place est dite une fois, jamais avalée', () => {
  let told = 0;
  quota.quotaEvents.addEventListener('full', () => told++);
  const full = new DOMException('plein', 'QuotaExceededError');
  const setItem = localStorage.setItem;
  localStorage.setItem = () => { throw full; };
  try {
    assert.equal(quota.writeLocal('k', 'v'), false);
    assert.equal(quota.writeLocal('k', 'v'), false);
  } finally {
    localStorage.setItem = setItem;
  }
  assert.equal(told, 1);
  assert.equal(quota.isQuotaError(new Error('autre')), false);
  assert.equal(quota.noteStorageError(new Error('autre')), false);
});

test('les largeurs des volets : chaque clé de mise en page est dans config.paneLayouts, que les premiers pas ignorent', () => {
  const keys = Object.values(config.storageKeys);
  // sheetLayout is the plant sheet's whole layout (its blocks, its panes), the user's own: not widths only.
  const layouts = keys.filter(k => /Layout$/.test(k) && k !== config.storageKeys.sheetLayout);
  assert.deepEqual([...layouts].sort(), [...config.paneLayouts].sort());
});
