// @ts-check
// The one cache of the remote answers (IndexedDB store 'plantDetails', records { key, fetchedAt, ttl?, usedAt?,
// partial?, value }), used by every module that calls an online service (sources, geoservices, open-data, nearby,
// uses, protected, ign). One policy:
//  - a fresh copy is served; requests in flight for the same key are shared;
//  - a failure is not « no data »: it is never stored; it is remembered a few minutes, in memory only (the negative
//    cache), so a dead source is not asked again on every render — « Réessayer » forgets it (forgetFailures);
//  - a result the loader says is degraded (`partial`: some of its sources failed) is served a few minutes in this
//    session only (asked again on « Réessayer » or a reload), stored as a fallback, never over a complete copy;
//  - offline or the source down, an expired copy is better than nothing (not after a cancel by the caller);
//  - purge (once a day, after the start): entries expired for over a month, then the least recently used ones
//    beyond a ceiling of entries and of size.

import { config } from '../config.js';
import * as db from './db.js';
import { errorKind, SourceError } from './net.js';
import { readText, writeText } from './prefs.js';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/**
 * @typedef {{ key: string, fetchedAt: number, ttl?: number, usedAt?: number, partial?: boolean, value: any }} Entry
 * @typedef {{ get(key: string): Promise<Entry | undefined>, put(entry: Entry): Promise<void>,
 *   scan(fn: (entry: Entry) => void): Promise<void>, removeMany(keys: string[]): Promise<void> }} CacheStore
 * @typedef {{ ttl?: number, partial?: (value: any) => boolean, stale?: boolean, signal?: AbortSignal }} CachedOptions
 *   ttl: how long a complete answer stays fresh (default config.remoteTtl); partial: the answer is degraded;
 *   stale: an expired copy may stand in when the source fails (default true); signal: the caller's (a request in
 *   flight shared with a caller who cancelled is made again for this one)
 * @typedef {{ maxEntries?: number, maxBytes?: number, grace?: number }} PurgeOptions
 */

/** How long a failure, or a degraded answer, is remembered. */
export const NEGATIVE_TTL = 5 * MINUTE;
/** Purge: entries expired for longer than this go. */
export const GRACE = 30 * DAY;
/** Purge: at most this many entries… */
export const MAX_ENTRIES = 4000;
/** … and about this many bytes of answers (JSON length), the least recently used going first. */
export const MAX_BYTES = 40e6;

/** Entries written before each one carried its ttl: their module's. @param {string} key */
function legacyTtl(key) {
  if (key.startsWith('geo:')) return 365 * DAY;
  if (key.startsWith('protected:') || key.startsWith('wikibooks') || key.startsWith('ign:')) return 30 * DAY;
  if (key.startsWith('wd-uses:')) return 14 * DAY;
  return config.remoteTtl;
}

/** A cache over `store` (tests give an in-memory one). @param {{ store: CacheStore, now?: () => number, negativeTtl?: number }} options */
export function createCache({ store, now = Date.now, negativeTtl = NEGATIVE_TTL }) {
  /** Requests in flight, by key. @type {Map<string, Promise<any>>} */
  const pending = new Map();
  /** The negative cache, in memory only: key → when it failed and why. @type {Map<string, { at: number, error: unknown }>} */
  const failures = new Map();

  /**
   * The value of `key`: fresh from the store, else from `load` (see the head of this file).
   * @template T @param {string} key @param {() => Promise<T>} load @param {CachedOptions} [options] @returns {Promise<T>}
   */
  async function cached(key, load, { ttl = config.remoteTtl, partial, stale = true, signal } = {}) {
    const hit = await store.get(key).catch(() => undefined);
    const t = now();
    // A degraded copy is never fresh: served only while its failure is remembered (this session, a few minutes), or
    // as a fallback; « Réessayer » and a reload ask again.
    if (hit && !hit.partial && t - hit.fetchedAt < (hit.ttl ?? ttl)) {
      // Least recently used: noted at most once a day per entry.
      if (t - (hit.usedAt ?? hit.fetchedAt) > DAY) store.put({ ...hit, usedAt: t }).catch(() => {});
      return hit.value;
    }
    const failed = failures.get(key);
    if (failed && t - failed.at < negativeTtl) {
      if (hit && stale) return hit.value;
      throw failed.error;
    }
    const inFlight = pending.get(key);
    if (inFlight) {
      return inFlight.catch(error => {
        // Shared with a caller who cancelled: asked again for this one, who did not.
        if (errorKind(error) === 'aborted' && !signal?.aborted) return cached(key, load, { ttl, partial, stale, signal });
        throw error;
      });
    }
    const task = load().then(async value => {
      failures.delete(key);
      const degraded = Boolean(partial?.(value));
      if (degraded) {
        failures.set(key, { at: now(), error: new SourceError('network', key, 'Réponse partielle') });
        // A complete copy, even expired, is better than a degraded answer.
        if (hit && !hit.partial && stale) return hit.value;
      }
      /** @type {Entry} */
      const entry = { key, fetchedAt: now(), ttl: degraded ? negativeTtl : ttl, value };
      if (degraded) entry.partial = true;
      await store.put(entry).catch(() => {});
      return value;
    }, error => {
      const kind = errorKind(error);
      if (kind === 'aborted') throw error;
      if (kind !== 'module-off') failures.set(key, { at: now(), error });
      // Offline or the source down: an expired copy stands in.
      if (hit && stale && kind !== 'module-off') return hit.value;
      throw error;
    }).finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  }

  /** « Réessayer »: the failures remembered are forgotten (all, or those whose key starts with `prefix`). @param {string} [prefix] */
  function forgetFailures(prefix = '') {
    for (const key of [...failures.keys()]) if (key.startsWith(prefix)) failures.delete(key);
  }

  /**
   * Removes the entries expired for over `grace`, the degraded ones expired, then the least recently used ones
   * beyond `maxEntries` or `maxBytes`. @param {PurgeOptions} [options] @returns {Promise<{ removed: number, kept: number }>}
   */
  async function purge({ maxEntries = MAX_ENTRIES, maxBytes = MAX_BYTES, grace = GRACE } = {}) {
    const t = now();
    /** @type {{ key: string, used: number, size: number }[]} */
    const live = [];
    /** @type {string[]} */
    const gone = [];
    await store.scan(entry => {
      const expires = entry.fetchedAt + (entry.ttl ?? legacyTtl(String(entry.key)));
      if (!Number.isFinite(expires) || t > expires + (entry.partial ? 0 : grace)) { gone.push(entry.key); return; }
      let size;
      try { size = JSON.stringify(entry.value ?? null).length; } catch { size = 0; }
      live.push({ key: entry.key, used: entry.usedAt ?? entry.fetchedAt, size });
    });
    let bytes = live.reduce((sum, e) => sum + e.size, 0);
    if (live.length > maxEntries || bytes > maxBytes) {
      live.sort((a, b) => a.used - b.used);
      while (live.length && (live.length > maxEntries || bytes > maxBytes)) {
        const oldest = /** @type {{ key: string, size: number }} */ (live.shift());
        bytes -= oldest.size;
        gone.push(oldest.key);
      }
    }
    if (gone.length) await store.removeMany(gone);
    return { removed: gone.length, kept: live.length };
  }

  return { cached, forgetFailures, purge, failures, pending };
}

/** The app's store: IndexedDB 'plantDetails'. @type {CacheStore} */
const idbStore = {
  get: key => db.get('plantDetails', key),
  put: entry => db.put('plantDetails', entry),
  scan: fn => db.scan('plantDetails', fn),
  removeMany: keys => db.removeMany('plantDetails', keys)
};

const shared = createCache({ store: idbStore });
export const { cached, forgetFailures, purge } = shared;

const PURGED_KEY = config.storageKeys.cachePurgedAt;

/**
 * The purge, once a day, well after the start (the local flora and the search come first) and when the page is idle;
 * a failure only waits for the next day.
 * @param {number} [delay] ms
 */
export function schedulePurge(delay = 30000) {
  // No storage: purged each visit.
  const last = Number(readText(PURGED_KEY)) || 0;
  if (Date.now() - last < DAY) return;
  setTimeout(() => {
    const go = () => purge()
      .then(() => { writeText(PURGED_KEY, String(Date.now())); })
      .catch(error => console.warn('Purge du cache des sources :', error));
    if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 10000 }); else go();
  }, delay);
}
