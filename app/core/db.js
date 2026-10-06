// @ts-check
// Minimal promise wrapper around IndexedDB. Usable from the window and from workers.

import { config } from '../config.js';

/**
 * Stores:
 *  - plants:       the TAXREF dataset (keyPath id) with by_family / by_genus / by_taxon indexes
 *  - plantDetails: remote enrichment cache (keyPath key, e.g. "details:100225", "thumb:100225")
 *  - meta:         key/value (dataset version…)
 */
function upgrade(db) {
  if (!db.objectStoreNames.contains('plants')) {
    const plants = db.createObjectStore('plants', { keyPath: 'id' });
    plants.createIndex('by_family', 'family');
    plants.createIndex('by_genus', 'genus');
    plants.createIndex('by_taxon', ['genus', 'species']);
  }
  if (!db.objectStoreNames.contains('plantDetails')) {
    db.createObjectStore('plantDetails', { keyPath: 'key' });
  }
  if (!db.objectStoreNames.contains('meta')) {
    db.createObjectStore('meta');
  }
}

/** @template T @param {IDBRequest<T>} request @returns {Promise<T>} */
export const promisify = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

/** @param {IDBTransaction} tx @returns {Promise<void>} */
const done = tx => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
});

/** @type {Promise<IDBDatabase> | null} */
let opening = null;

/** @returns {Promise<IDBDatabase>} */
export function openDb() {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(config.db.name, config.db.version);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgraded the schema: close so it can proceed, reopen lazily.
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
  return opening;
}

/** @param {string} store @param {IDBValidKey} key */
export async function get(store, key) {
  const db = await openDb();
  return promisify(db.transaction(store).objectStore(store).get(key));
}

/** @param {string} store */
export async function getAll(store) {
  const db = await openDb();
  return promisify(db.transaction(store).objectStore(store).getAll());
}

/** @param {string} store */
export async function count(store) {
  const db = await openDb();
  return promisify(db.transaction(store).objectStore(store).count());
}

/** @param {string} store @param {any} value @param {IDBValidKey} [key] */
export async function put(store, value, key) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value, key);
  return done(tx);
}

/**
 * Replaces the whole plants store and records the dataset version atomically.
 * @param {any[]} plants
 * @param {any} meta
 */
export async function replacePlants(plants, meta) {
  const db = await openDb();
  const tx = db.transaction(['plants', 'meta'], 'readwrite');
  const store = tx.objectStore('plants');
  store.clear();
  for (const plant of plants) store.put(plant);
  tx.objectStore('meta').put(meta, 'dataset');
  return done(tx);
}
