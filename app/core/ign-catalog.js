// @ts-check
// IGN's whole WMTS catalogue, for « Toutes les couches de l'IGN » (Carte panel). Its source, the service's
// GetCapabilities, is megabytes of XML: too slow to ask on a phone each time, too heavy to parse on its main thread.
// So:
//  - the app ships a compact copy (data/ign-catalog.json, scripts/build-ign-catalog.mjs, regenerated monthly by
//    .github/workflows/ign-catalog.yml, precached by the service worker): shown at once, offline too; a newer copy read
//    on this device (IndexedDB) is shown instead;
//  - when the copy shown is over a month old (or a seed, not read from the service), the module « IGN – fonds de
//    carte » on and the device online, the service is asked in the background: no total time limit to speak of, only
//    a stall limit (no byte for STALL_MS), the document parsed in a worker (app/workers/ign-catalog.worker.js), the
//    list replaced when done and kept on the device;
//  - a failed refresh never replaces the list: it is noted (offline, or the service not answering), not asked again
//    by itself for a few minutes, and « Réessayer » asks at once.

import { moduleOn } from './modules.js';
import * as db from './db.js';
import { anySignal, errorKind, SourceError, timeoutSignal, unavailableReason } from './net.js';
import { CAPABILITIES_URL, fetchedAtOf, isStale, layersOf, parseCapabilities } from '../../lib/ign-catalog.mjs';

/** @typedef {import('../../lib/ign-catalog.mjs').CatalogLayer} CatalogLayer */

/**
 * What the panel shows.
 *  layers: the list (null: none yet — nothing shipped, nothing kept); date: when that copy was made (ms, 0: unknown);
 *  origin: 'bundled' (shipped with the app), 'device' (read from the service on this device), null;
 *  refreshing: the service is being asked; problem: why the list may be old — 'offline', 'down' (the service failed:
 *  `reason` says how), 'module-off' (the module is switched off: nothing is asked), or null.
 * @typedef {{ layers: CatalogLayer[] | null, date: number, origin: 'bundled' | 'device' | null, refreshing: boolean,
 *   problem: null | 'offline' | 'down' | 'module-off', reason: string }} CatalogState
 * @typedef {{ layers: CatalogLayer[], fetchedAt: number, date: number, origin: 'bundled' | 'device' }} Copy
 * @typedef {{ get(): Promise<any>, put(value: { fetchedAt: number, layers: CatalogLayer[] }): Promise<void> }} CopyStore
 */

/**
 * Time limits of the refresh (ms). stall: no byte for this long, and it gives up (a slow but steady download goes on);
 * total: a ceiling all the same; quiet: after a failure, how long a panel opened again shows it rather than asking
 * again (« Réessayer » asks at once). The end-to-end tests shorten them.
 */
export const catalogTuning = { stall: 20_000, total: 180_000, quiet: 5 * 60_000 };

const HOST = 'data.geopf.fr';
const KEY = 'ign:catalog';
const BUNDLED = new URL('../../data/ign-catalog.json', import.meta.url).href;

/** The copy kept on this device: a record of the remote answers' store (core/cache.js purges it like the others). @type {CopyStore} */
const idbCopy = {
  get: () => db.get('plantDetails', KEY),
  put: ({ fetchedAt, layers }) => db.put('plantDetails', { key: KEY, fetchedAt, ttl: 30 * 24 * 3600 * 1000, value: layers })
};

/**
 * The document, read as it comes: given up only when no byte arrives for `stall` ms (or past `total`).
 * @param {typeof fetch} fetchImpl @param {string} url @param {{ stall: number, total: number }} limits
 * @param {() => boolean} isOffline @returns {Promise<string>}
 */
export async function fetchTextStall(fetchImpl, url, { stall, total }, isOffline) {
  const stalled = new AbortController();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => stalled.abort(new DOMException(`Pas de données depuis ${Math.round(stall / 1000)} s`, 'TimeoutError')), stall);
  };
  const signal = anySignal([stalled.signal, timeoutSignal(total)]);
  // Whatever the body's stream does with the signal, a read waits no longer than it.
  const aborted = new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  aborted.catch(() => {});
  arm();
  try {
    const response = await Promise.race([fetchImpl(url, { signal }), aborted]);
    if (!response.ok) {
      throw new SourceError('http', HOST, `${HOST} ${response.status}${response.statusText ? ' ' + response.statusText : ''}`, { status: response.status });
    }
    const reader = response.body?.getReader?.();
    if (!reader) { arm(); return await Promise.race([response.text(), aborted]); }
    const decoder = new TextDecoder();
    const parts = [];
    try {
      for (;;) {
        arm();
        const { done, value } = await Promise.race([reader.read(), aborted]);
        if (done) break;
        parts.push(decoder.decode(value, { stream: true }));
      }
    } catch (error) {
      reader.cancel().catch(() => {});
      throw error;
    }
    parts.push(decoder.decode());
    return parts.join('');
  } catch (error) {
    if (error instanceof SourceError) throw error;
    if (signal.aborted || /** @type {Error} */ (error)?.name === 'TimeoutError') {
      throw new SourceError('timeout', HOST, `${HOST} ne répond pas`, { cause: error });
    }
    if (isOffline()) throw new SourceError('offline', HOST, 'Hors ligne', { cause: error });
    throw new SourceError('network', HOST, `${HOST} injoignable`, { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The document parsed off the main thread (on it where workers are missing or fail).
 * @param {string} xml @returns {Promise<CatalogLayer[]>}
 */
function parseOffThread(xml) {
  /** @type {Worker} */
  let worker;
  try {
    worker = new Worker(new URL('../workers/ign-catalog.worker.js', import.meta.url), { type: 'module' });
  } catch {
    return Promise.resolve(parseCapabilities(xml));
  }
  return new Promise((resolve, reject) => {
    worker.addEventListener('message', ({ data }) => {
      worker.terminate();
      if (data?.error) reject(new SourceError('schema', HOST, `Catalogue IGN illisible : ${data.error}`));
      else resolve(data.layers);
    });
    worker.addEventListener('error', event => {
      event.preventDefault();
      worker.terminate();
      try { resolve(parseCapabilities(xml)); } catch (error) { reject(error); }
    });
    worker.postMessage({ xml });
  });
}

/**
 * A catalogue over its sources (tests give their own; the app has one, below).
 * @param {{ fetchImpl?: typeof fetch, parse?: (xml: string) => Promise<CatalogLayer[]> | CatalogLayer[], store?: CopyStore,
 *   bundled?: string, now?: () => number, isOn?: () => boolean, isOffline?: () => boolean, tuning?: typeof catalogTuning }} [options]
 */
export function createCatalog({
  fetchImpl = (input, init) => fetch(input, init), parse = parseOffThread, store = idbCopy, bundled = BUNDLED,
  now = Date.now, isOn = () => moduleOn('ignMaps'), isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false,
  tuning = catalogTuning
} = {}) {
  /** @type {CatalogState} */
  let state = { layers: null, date: 0, origin: null, refreshing: false, problem: null, reason: '' };
  /** When the copy shown was read from the service (0: unknown, or a seed). */
  let fetchedAt = 0;
  /** @type {Set<(state: CatalogState) => void>} */
  const listeners = new Set();
  /** @type {Promise<void> | null} */
  let local = null;
  /** @type {Promise<void> | null} */
  let refreshing = null;
  let failedAt = 0;

  /** @param {Partial<CatalogState>} patch */
  const set = patch => {
    state = { ...state, ...patch };
    for (const fn of listeners) fn(state);
  };

  /** The copy shipped with the app. @returns {Promise<Copy | null>} */
  async function readBundled() {
    try {
      const response = await fetchImpl(bundled, { signal: timeoutSignal(15_000) });
      if (!response.ok) return null;
      const file = await response.json();
      const layers = layersOf(file);
      return layers.length ? { layers, fetchedAt: fetchedAtOf(file), date: Date.parse(file.fetchedAt) || 0, origin: 'bundled' } : null;
    } catch {
      return null;
    }
  }

  /** The copy read on this device before. @returns {Promise<Copy | null>} */
  async function readDevice() {
    try {
      const entry = await store.get();
      const layers = layersOf(entry?.value);
      const at = Number(entry?.fetchedAt) || 0;
      return layers.length && at ? { layers, fetchedAt: at, date: at, origin: 'device' } : null;
    } catch {
      return null;
    }
  }

  /**
   * The two copies, each shown as soon as it is read unless a newer one already is (IndexedDB can be slow while the
   * flora is first stored: the copy shipped need not wait for it).
   */
  async function loadLocal() {
    const show = (/** @type {Copy | null} */ copy) => {
      if (!copy || (state.layers && copy.fetchedAt <= fetchedAt)) return;
      fetchedAt = copy.fetchedAt;
      set({ layers: copy.layers, date: copy.date, origin: copy.origin });
    };
    await Promise.all([readBundled().then(show), readDevice().then(show)]);
  }

  /** Asks the service, in the background (one request at a time). */
  function refresh() {
    refreshing ??= (async () => {
      set({ refreshing: true, problem: null, reason: '' });
      try {
        const xml = await fetchTextStall(fetchImpl, CAPABILITIES_URL, tuning, isOffline);
        const layers = await parse(xml);
        // A document cut short or of another shape: never in place of a fuller list.
        const before = state.layers?.length || 0;
        if (!layers.length || layers.length < before / 2) {
          throw new SourceError('schema', HOST, `Catalogue IGN : ${layers.length} couches lues (${before} avant)`);
        }
        const t = now();
        fetchedAt = t;
        failedAt = 0;
        set({ layers, date: t, origin: 'device', refreshing: false, problem: null, reason: '' });
        await store.put({ fetchedAt: t, layers }).catch(() => {});
      } catch (error) {
        failedAt = now();
        const kind = errorKind(error);
        set({ refreshing: false, problem: kind === 'offline' ? 'offline' : 'down', reason: unavailableReason(error) });
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  /**
   * The catalogue: the copy on hand at once, then (see the head of this file) the service asked in the background
   * when that copy is old. `retry`: « Réessayer » — asks now, even after a recent failure or with a fresh copy.
   * @param {{ retry?: boolean }} [options] @returns {Promise<CatalogState>}
   */
  async function load({ retry = false } = {}) {
    local ??= loadLocal();
    await local;
    if (!isOn()) { set({ problem: 'module-off', reason: '' }); return state; }
    if (state.refreshing) return state;
    if (isOffline()) { set({ problem: 'offline', reason: 'hors ligne' }); return state; }
    if (state.problem === 'offline' || state.problem === 'module-off') set({ problem: null, reason: '' });
    const due = retry || !state.layers || isStale(fetchedAt, now());
    if (!due) return state;
    if (!retry && failedAt && now() - failedAt < tuning.quiet) return state;
    void refresh();
    return state;
  }

  /** Called with each new state (and at once with the current one). @param {(state: CatalogState) => void} fn */
  function subscribe(fn) {
    listeners.add(fn);
    fn(state);
    return () => { listeners.delete(fn); };
  }

  return { load, subscribe, state: () => state, whenRefreshed: () => refreshing || Promise.resolve() };
}

const shared = createCatalog();
export const { load: loadCatalog, subscribe: onCatalog } = shared;
