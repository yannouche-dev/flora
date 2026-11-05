// app/core/db.js: a base of version 2 (the first day: one plant per spot, by_plant on properties.plantId), opened by
// today's app — its index made again and its spots rewritten once as lieux, nothing lost. Against an IndexedDB in
// memory (fake-indexeddb); this file is its own process, so the base of version 2 is made before db.js opens it.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// db.js upgrades the schema only from a page (a worker opens whatever version exists).
/** @type {any} */ (globalThis).window ??= globalThis;

const { config } = await import('../../app/config.js');
const AT = '2026-10-06T22:00:00.000Z';

// The base as version 2 made it (e9d57b3), with one spot of that day.
await new Promise((resolve, reject) => {
  const request = indexedDB.open(config.db.name, 2);
  request.onupgradeneeded = () => {
    const base = request.result;
    const plants = base.createObjectStore('plants', { keyPath: 'id' });
    plants.createIndex('by_family', 'family');
    plants.createIndex('by_genus', 'genus');
    plants.createIndex('by_taxon', ['genus', 'species']);
    base.createObjectStore('plantDetails', { keyPath: 'key' });
    base.createObjectStore('meta');
    const spots = base.createObjectStore('spots', { keyPath: 'id' });
    spots.createIndex('by_plant', 'properties.plantId');
    spots.createIndex('by_updated', 'properties.updatedAt');
    spots.put({ type: 'Feature', id: 's1', geometry: { type: 'Point', coordinates: [2.35, 48.85] },
      properties: { plantId: 7, scientificName: 'Urtica dioica', label: 'Talus', notes: 'au bord du chemin', createdAt: AT, updatedAt: AT } });
  };
  request.onsuccess = () => { request.result.close(); resolve(undefined); };
  request.onerror = () => reject(request.error);
});

const db = await import('../../app/core/db.js');
const C = await import('../../app/core/collections.js');

test('une base de la version 2 : son index refait, ses lieux réécrits une fois — rien de perdu', async () => {
  const conn = await db.openDb();
  assert.equal(conn.version, config.db.version);
  assert.ok(conn.objectStoreNames.contains('sheetNotes'));
  const raw = await db.get('spots', 's1');
  assert.deepEqual(raw.properties.plantIds, [7]);
  assert.equal(raw.properties.kind, 'place');
  // Found by its plant (« Mes lieux » of the plant), with its name, its plant at its point and its note.
  const found = await C.collectionsForPlant(7);
  assert.deepEqual(found.map(c => c.id), ['s1']);
  const [lieu] = found;
  assert.equal(lieu.properties.name, 'Talus');
  assert.equal(lieu.properties.plants.length, 1);
  const [noting] = lieu.properties.plants;
  assert.equal(noting.plantId, 7);
  assert.deepEqual(noting.coordinates, [2.35, 48.85]);
  assert.equal(noting.notes, 'au bord du chemin');
});
