// @ts-check
// Minimal promise wrapper around IndexedDB. Usable from the window and from workers.

import { config } from '../config.js';
import { normalizeCollection } from './place-model.js';
import { noteStorageError } from './quota.js';

/**
 * Stores:
 *  - plants:       the TAXREF dataset (keyPath id) with by_family / by_genus / by_taxon indexes
 *  - plantDetails: remote enrichment cache (keyPath key, e.g. "details:100225", "thumb:100225")
 *  - meta:         key/value (dataset version…)
 *  - spots:        harvest places, stored as GeoJSON Features (keyPath id), added in version 2.
 *                  Version 3: a place holds several plants; `by_plant` indexes properties.plantIds.
 *                  Version 4: collections — `properties.kind` (favorites | list | place); lists have no geometry.
 *                  Version 5: each plant of a place has its own `coordinates` (initially the place's point).
 *  - sheetNotes:   version 6 — the texts of the plant sheet's « Note » blocks (keyPath key, "<note id>|<plant id>"),
 *                  until then in localStorage (geoflora.plantNotes; moved over once by sheet-notes.js).
 * Every step only adds: a store that exists is never dropped or recreated.
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
  if (!db.objectStoreNames.contains('sheetNotes')) {
    db.createObjectStore('sheetNotes', { keyPath: 'key' });
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
    /** @type {Promise<T>} */
    let result;
    // A request can also throw at once (a value that cannot be stored, a full disk on some browsers).
    try { result = fn(tx); } catch (error) { result = Promise.reject(error); }
    // A write refused for lack of room is said once, on screen (quota.js); the caller still gets the error.
    return mode === 'readwrite' ? result.catch(error => { noteStorageError(error); throw error; }) : result;
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

/** Empties a store. @param {string} store */
export const clear = store =>
  run(store, 'readwrite', tx => {
    tx.objectStore(store).clear();
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

/** Returned by an `update` function: delete the record. */
export const DELETE = Symbol('delete');

/**
 * Reads and writes records in one transaction: nothing can be written in between (another tab, another call).
 * `fn(current, key)` gets each stored record (undefined when absent) and returns the one to store, `DELETE`, or
 * undefined to leave it as it is. It runs inside the transaction: synchronous, no await. Throwing in it aborts
 * the whole transaction (nothing written) and rejects with that error.
 * Resolves with what `fn` returned for each key, once the transaction is committed. `toRecord`, when given, picks
 * the record to store from what `fn` returned (so `fn` can return more: what it did).
 * @template T
 * @param {string} store a store with a keyPath
 * @param {IDBValidKey[]} keys
 * @param {(current: any, key: IDBValidKey) => T} fn
 * @param {(result: T) => any} [toRecord]
 * @returns {Promise<T[]>}
 */
export const updateMany = (store, keys, fn, toRecord = result => result) =>
  run(store, 'readwrite', tx => new Promise((resolve, reject) => {
    const objectStore = tx.objectStore(store);
    /** @type {T[]} */
    const results = [];
    /** @type {unknown} */
    let thrown = null;
    keys.forEach((key, i) => {
      const request = objectStore.get(key);
      request.onsuccess = () => {
        if (thrown) return;
        try {
          const result = fn(request.result, key);
          results[i] = result;
          const next = result === DELETE ? DELETE : toRecord(result);
          if (next === DELETE) objectStore.delete(key);
          else if (next !== undefined) objectStore.put(next);
        } catch (error) {
          thrown = error;
          tx.abort();
        }
      };
    });
    tx.oncomplete = () => resolve(results);
    tx.onabort = () => reject(thrown || tx.error || new Error('Transaction aborted'));
  }));

/**
 * One record read and written in the same transaction (see updateMany).
 * @template T @param {string} store @param {IDBValidKey} key @param {(current: any, key: IDBValidKey) => T} fn
 * @returns {Promise<T>}
 */
export const update = (store, key, fn) => updateMany(store, [key], fn).then(results => results[0]);

/**
 * Adds the records whose key is not in the store yet, leaving the others as they are, in one transaction
 * (running it again changes nothing). Resolves with how many were added.
 * @param {string} store a store with a keyPath @param {any[]} values
 * @returns {Promise<number>}
 */
export const addMissing = (store, values) =>
  run(store, 'readwrite', tx => new Promise((resolve, reject) => {
    const objectStore = tx.objectStore(store);
    let added = 0;
    for (const value of values) {
      const request = objectStore.add(value);
      request.onsuccess = () => { added++; };
      // Already there: not an error, and the transaction goes on.
      request.onerror = event => {
        if (request.error?.name === 'ConstraintError') { event.preventDefault(); event.stopPropagation(); }
      };
    }
    tx.oncomplete = () => resolve(added);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  }));
