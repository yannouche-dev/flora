// @ts-check
// Minimal promise wrapper around IndexedDB. Usable from the window and from workers.

import { config } from '../config.js';
import { normalizeCollection } from './place-model.js';
import { isQuotaError, noteStorageError } from './quota.js';

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

// ── Opening ──────────────────────────────────────────────────────────────
// IndexedDB may not open: the browser's own store refused (Chromium's « Internal error opening backing store for
// indexedDB.open. »: a store damaged by a crash or an update, a disk almost full, the profile held by a process that
// lingers), a newer version of the app already there, no room, storage blocked. What can pass is tried again, a
// moment later; then the failure is said in French (StorageError). Before any connection has opened in this page (the
// app could not start: its banner says so) it is kept: every later call gets it at once, until the page is reloaded (or
// reopenDb). Once one has opened, a later failure (the browser closed it, its store busy a moment) is not: the next
// call tries again.

/**
 * Why IndexedDB did not open, from what the browser said (its error's name; for Chromium's blocked site data, its words):
 *  - 'busy'    the browser's store did not open — UnknownError (Chromium's backing store, Firefox's profile, Safari's
 *              IndexedDB process gone), AbortError (the upgrade cut short), or a name not known here. Often over a
 *              moment later: UnknownError and AbortError are tried again (openDb). Erasing the base can mend it (deleteDb).
 *  - 'newer'   VersionError: a newer GeoFlora already upgraded it — this page is older; reloading loads the new one.
 *              Never erased: that would lose what the newer version keeps.
 *  - 'full'    no room left (quota.js isQuotaError): freeing space mends it.
 *  - 'blocked' the browser lets the site store nothing — SecurityError or Chromium's « The user denied permission… »
 *              (site data blocked), InvalidStateError (private browsing, Firefox before 115), no IndexedDB at all.
 * @typedef {'busy' | 'newer' | 'full' | 'blocked'} OpenProblem
 * @param {unknown} error
 * @returns {OpenProblem}
 */
export function openProblem(error) {
  const e = /** @type {any} */ (error);
  if (isQuotaError(e)) return 'full';
  if (e?.name === 'VersionError') return 'newer';
  if (['SecurityError', 'InvalidStateError', 'TypeError', 'ReferenceError'].includes(e?.name) || /denied permission/i.test(String(e?.message ?? ''))) return 'blocked';
  return 'busy';
}

/** What an open failure says, by its cause (the banner, components/gf-storage-error.js, says what to try). */
const OPEN_FAILED = {
  busy: 'Le stockage de GeoFlora ne s’ouvre pas sur cet appareil : le navigateur n’arrive pas à ouvrir sa base locale.',
  newer: 'Une version plus récente de GeoFlora a déjà ouvert vos données sur cet appareil : rechargez la page pour l’utiliser.',
  full: 'Plus assez d’espace sur cet appareil : le stockage de GeoFlora ne s’ouvre pas.',
  blocked: 'Le navigateur ne laisse pas GeoFlora enregistrer de données (navigation privée, ou données des sites bloquées).'
};

/**
 * IndexedDB did not open (openDb gave up): said in French, by its cause (`kind`); the browser's own error is its
 * `cause` (for support). Its name is the browser's (UnknownError, QuotaExceededError…): callers that tell a lack of
 * room apart (quota.js isQuotaError) still do.
 */
export class StorageError extends Error {
  /** @param {unknown} cause what the browser said (or its name and message, from the worker) @param {OpenProblem} [kind] */
  constructor(cause, kind = openProblem(cause)) {
    super(OPEN_FAILED[kind], { cause });
    this.name = /** @type {any} */ (cause)?.name || 'UnknownError';
    this.kind = kind;
  }
}

/**
 * The open failure behind an error: itself, or one of its causes (core/dataset.js wraps the errors it rethrows).
 * @param {unknown} error @returns {StorageError | null}
 */
export function storageError(error) {
  for (let e = /** @type {any} */ (error), depth = 0; e && depth < 5; e = e.cause, depth++) if (e instanceof StorageError) return e;
  return null;
}

/** An open that failed this way may work a moment later: tried again after each of these delays (ms). */
const RETRY_DELAYS = [250, 1000];
/** @param {unknown} error */
const passing = error => openProblem(error) === 'busy' && ['UnknownError', 'AbortError'].includes(/** @type {any} */ (error)?.name);

/** @type {Promise<IDBDatabase> | null} */
let opening = null;
/** @type {IDBDatabase | null} */
let current = null;
/** Given up on at the start (or the base being erased: deleteDb): every call rejects with it at once. @type {Error | null} */
let failure = null;
/** A connection opened in this page (since it loaded, or since deleteDb): a failure after it is not kept. */
let opened = false;
/** The base was made at an open of this page: it had no store (see baseMade). */
let made = false;

/**
 * Whether this page made the base: there was none — a first launch, or a base the browser emptied (its IndexedDB
 * cleared, a damaged store made again, empty) or the app's repair erased. collections.js holdIfEmptied tells them apart
 * by the backup copy. Under a page that had it open, the base made again is said at once (`geoflora-emptied`), before
 * anything is written into it.
 */
export const baseMade = () => made;

/** Forgets the connection so the next call opens a fresh one. @param {IDBDatabase} [db] */
function drop(db) {
  if (db && db !== current) return;
  current = null;
  opening = null;
}

/** One indexedDB.open, the schema upgraded on the way. @returns {Promise<IDBDatabase>} */
function openOnce() {
  return new Promise((resolve, reject) => {
    // Only the page upgrades the schema. The search worker opens whatever version exists: during an app
    // update the page and the worker can briefly run different versions, and a worker-triggered upgrade
    // would break the page still running the previous one.
    const inWorker = typeof window === 'undefined';
    /** @type {IDBOpenDBRequest} */
    let request;
    // Thrown at once (storage blocked: SecurityError; no IndexedDB at all): failed, as a request that fails.
    try {
      request = inWorker ? indexedDB.open(config.db.name) : indexedDB.open(config.db.name, config.db.version);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = event => {
      const db = request.result;
      // No store: a new base. Once this page has had it open (at its version), any upgrade is one too: made again
      // meanwhile — by the search worker perhaps, which creates a missing base as it opens it.
      if (!db.objectStoreNames.length || opened) {
        made = true;
        if (opened) globalThis.dispatchEvent?.(new CustomEvent('geoflora-emptied'));
      }
      upgrade(db, /** @type {IDBTransaction} */ (request.transaction), event.oldVersion);
    };
    request.onsuccess = () => {
      const db = current = request.result;
      // A newer version of the app (another tab, or after an update) upgrades the schema, or « Réparer le stockage »
      // erases it (in another tab: newVersion null): close so it can proceed, and tell the page — this code, or this
      // connection, is now outdated.
      db.onversionchange = event => {
        db.close();
        drop(db);
        globalThis.dispatchEvent?.(new CustomEvent('geoflora-outdated', { detail: { deleted: event.newVersion === null } }));
      };
      // The browser can also close a connection on its own (storage switched to persistent,
      // page frozen in the background, site data cleared…): only a `close` event tells us.
      db.onclose = () => drop(db);
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => console.warn('IndexedDB upgrade waiting for another GeoFlora tab to close.');
  });
}

/**
 * The connection, opened once and shared by every caller (those that ask while it opens wait for the same one). An
 * open that may pass is tried again, twice, a moment later; failing still, it rejects with a StorageError — kept until
 * the reload when no connection has opened in this page yet, else the next call tries again. @returns {Promise<IDBDatabase>}
 */
export function openDb() {
  if (failure) return Promise.reject(failure);
  opening ??= (async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const db = await openOnce();
        opened = true;
        return db;
      } catch (error) {
        if (!passing(error) || attempt >= RETRY_DELAYS.length) {
          opening = null;
          const given = new StorageError(error);
          if (!opened) failure = given;
          throw given;
        }
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
      }
    }
  })();
  return opening;
}

/** Opens again, the failure given up on forgotten: « Réparer le stockage » tries it first (opening now, nothing is erased). */
export function reopenDb() {
  failure = null;
  return openDb();
}

/**
 * Erases the database — « Réparer le stockage » (components/gf-storage-error.js), the page reloaded after it. This
 * page's connection is closed first, and none opens after it: every call rejects until the reload, so nothing is
 * written into the new, empty base meanwhile. The other connections are asked to close (versionchange: every GeoFlora
 * tab does, and says so); one that does not holds the deletion back — `onBlocked` is told, and the deletion goes on by
 * itself once it closes. Rejects when the browser cannot erase it either (Chromium opens the same store first): the
 * base is then as it was. localStorage is never touched.
 * @param {() => void} [onBlocked]
 * @returns {Promise<void>}
 */
export function deleteDb(onBlocked) {
  const before = failure;
  failure = new Error('Stockage de GeoFlora en cours de réparation : la page va être rechargée.');
  current?.close();
  current = null;
  opening = null;
  return new Promise((resolve, reject) => {
    const failed = (/** @type {unknown} */ error) => { failure = before; reject(error); };
    try {
      const request = indexedDB.deleteDatabase(config.db.name);
      // The reload comes next: as at a launch, no connection opened yet.
      request.onsuccess = () => { opened = false; resolve(); };
      request.onerror = () => failed(request.error);
      request.onblocked = () => onBlocked?.();
    } catch (error) {
      failed(error);
    }
  });
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

/**
 * A first launch: the search runs on the flora before it is stored (core/dataset.js), so the plants are read
 * elsewhere meanwhile — one record from the worker that holds them (`get`), every other read of the store once it is
 * filled (`stored`). Set and taken away by core/dataset.js, in the page; never in the worker.
 * @type {{ get: (id: any) => Promise<any>, stored: Promise<unknown> } | null}
 */
let plantsSource = null;

/** @param {{ get: (id: any) => Promise<any>, stored: Promise<unknown> } | null} source */
export function readPlantsFrom(source) { plantsSource = source; }

/** A read of the whole plants store waits for it to be filled. @param {string} store */
const filled = async store => { if (store === 'plants' && plantsSource) await plantsSource.stored.catch(() => {}); };

/** @param {string} store @param {IDBValidKey} key */
export const get = (store, key) => store === 'plants' && plantsSource ? plantsSource.get(key)
  : run(store, 'readonly', tx => promisify(tx.objectStore(store).get(key)));

/** @param {string} store */
export const getAll = async store => {
  await filled(store);
  return run(store, 'readonly', tx => promisify(tx.objectStore(store).getAll()));
};

/** @param {string} store */
export const count = async store => {
  await filled(store);
  return run(store, 'readonly', tx => promisify(tx.objectStore(store).count()));
};

/** @param {string} store @param {string} index @param {IDBValidKey} key */
export const getAllByIndex = async (store, index, key) => {
  await filled(store);
  return run(store, 'readonly', tx => promisify(tx.objectStore(store).index(index).getAll(key)));
};

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

/**
 * Reads every record of a store, one by one (a cursor: never the whole store in one array).
 * @param {string} store @param {(value: any) => void} fn
 */
export const scan = async (store, fn) => {
  await filled(store);
  return run(store, 'readonly', tx => new Promise((resolve, reject) => {
    const request = tx.objectStore(store).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(undefined); return; }
      fn(cursor.value);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  }));
};

/** Deletes these keys of a store, in one transaction. @param {string} store @param {IDBValidKey[]} keys */
export const removeMany = (store, keys) =>
  run(store, 'readwrite', tx => {
    const objectStore = tx.objectStore(store);
    for (const key of keys) objectStore.delete(key);
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
