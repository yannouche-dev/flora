// @ts-check
// Minimal promise wrapper around IndexedDB. Usable from the window and from workers.

import { config } from '../config.js';
import { normalizeCollection } from './place-model.js';

/**
 * Stores:
 *  - plants:       the TAXREF dataset (keyPath id) with by_family / by_genus / by_taxon indexes
 *  - plantDetails: remote enrichment cache (keyPath key, e.g. "details:100225", "thumb:100225")
 *  - meta:         key/value (dataset version…)
 *  - spots:        harvest places, stored as GeoJSON Features (keyPath id), added in version 2.
 *                  Version 3: a place holds several plants; `by_plant` indexes properties.plantIds.
 *                  Version 4: collections — `properties.kind` (favorites | list | place); lists have no geometry.
 *                  Version 5: each plant of a place has its own `coordinates` (initially the place's point).
 * @param {IDBDatabase} db @param {IDBTransaction} tx @param {number} oldVersion
 */
function upgrade(db, tx, oldVersion) {
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
  if (!db.objectStoreNames.contains('spots')) {
    const spots = db.createObjectStore('spots', { keyPath: 'id' });
    spots.createIndex('by_plant', 'properties.plantIds', { multiEntry: true });
    spots.createIndex('by_updated', 'properties.updatedAt');
  } else if (oldVersion < 5) {
    const spots = tx.objectStore('spots');
    if (oldVersion < 3) {
      // One plant per spot → places with a list of plants.
      spots.deleteIndex('by_plant');
      spots.createIndex('by_plant', 'properties.plantIds', { multiEntry: true });
    }
    // → v4: every stored record becomes a collection of kind 'place'; → v5: plants get their own position.
    spots.openCursor().onsuccess = event => {
      const cursor = /** @type {IDBCursorWithValue | null} */ (/** @type {IDBRequest} */ (event.target).result);
      if (!cursor) return;
      const place = normalizeCollection(cursor.value);
      if (place) cursor.update(place);
      cursor.continue();
    };
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
/** @type {IDBDatabase | null} */
let current = null;

/** Forgets the connection so the next call opens a fresh one. @param {IDBDatabase} [db] */
function drop(db) {
  if (db && db !== current) return;
  current = null;
  opening = null;
}

/** @returns {Promise<IDBDatabase>} */
export function openDb() {
  opening ??= new Promise((resolve, reject) => {
    // Only the page upgrades the schema. The search worker opens whatever version exists: during an app
    // update the page and the worker can briefly run different versions, and a worker-triggered upgrade
    // would break the page still running the previous one.
    const inWorker = typeof window === 'undefined';
    const request = inWorker ? indexedDB.open(config.db.name) : indexedDB.open(config.db.name, config.db.version);
    request.onupgradeneeded = event => upgrade(request.result, /** @type {IDBTransaction} */ (request.transaction), event.oldVersion);
    request.onsuccess = () => {
      const db = current = request.result;
      // A newer version of the app (another tab, or after an update) upgrades the schema:
      // close so it can proceed, and tell the page — this code is now outdated.
      db.onversionchange = () => {
        db.close();
        drop(db);
        globalThis.dispatchEvent?.(new Event('geoflora-outdated'));
      };
      // The browser can also close a connection on its own (storage switched to persistent,
      // page frozen in the background, site data cleared…): only a `close` event tells us.
      db.onclose = () => drop(db);
      resolve(db);
    };
    request.onerror = () => { opening = null; reject(request.error); };
    request.onblocked = () => console.warn('IndexedDB upgrade waiting for another GeoFlora tab to close.');
  });
  return opening;
}

/**
 * Runs `fn` in a transaction. If the connection turns out to be closing (closed by the
 * browser without notice), reconnects once and retries, so callers never see a dead connection.
 * @template T
 * @param {string | string[]} stores
 * @param {IDBTransactionMode} mode
 * @param {(tx: IDBTransaction) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function run(stores, mode, fn) {
  for (let attempt = 0; ; attempt++) {
    const db = await openDb();
    let tx;
    try {
      tx = db.transaction(stores, mode);
    } catch (error) {
      if (attempt === 0 && /** @type {DOMException} */ (error).name === 'InvalidStateError') {
        drop(db);
        continue;
      }
      throw error;
    }
    return fn(tx);
  }
}

/** @param {string} store @param {IDBValidKey} key */
export const get = (store, key) =>
  run(store, 'readonly', tx => promisify(tx.objectStore(store).get(key)));

/** @param {string} store */
export const getAll = store =>
  run(store, 'readonly', tx => promisify(tx.objectStore(store).getAll()));

/** @param {string} store */
export const count = store =>
  run(store, 'readonly', tx => promisify(tx.objectStore(store).count()));

/** @param {string} store @param {string} index @param {IDBValidKey} key */
export const getAllByIndex = (store, index, key) =>
  run(store, 'readonly', tx => promisify(tx.objectStore(store).index(index).getAll(key)));

/** @param {string} store @param {IDBValidKey} key */
export const remove = (store, key) =>
  run(store, 'readwrite', tx => {
    tx.objectStore(store).delete(key);
    return done(tx);
  });

/** @param {string} store @param {any[]} values */
export const putAll = (store, values) =>
  run(store, 'readwrite', tx => {
    const objectStore = tx.objectStore(store);
    for (const value of values) objectStore.put(value);
    return done(tx);
  });

/** @param {string} store @param {any} value @param {IDBValidKey} [key] */
export const put = (store, value, key) =>
  run(store, 'readwrite', tx => {
    tx.objectStore(store).put(value, key);
    return done(tx);
  });

/**
 * Replaces the whole plants store and records the dataset version atomically.
 * @param {any[]} plants
 * @param {any} meta
 */
export const replacePlants = (plants, meta) =>
  run(['plants', 'meta'], 'readwrite', tx => {
    const store = tx.objectStore('plants');
    store.clear();
    for (const plant of plants) store.put(plant);
    tx.objectStore('meta').put(meta, 'dataset');
    return done(tx);
  });
