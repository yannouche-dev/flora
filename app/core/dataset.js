// @ts-check
// Keeps the local IndexedDB copy of the flora in sync with the published dataset. The download, its check against
// data/meta.json, the parse and the storage run in the search worker (core/search.js installFlora): never a long task
// of the page. A first launch searches as soon as the flora's index has come (data/flora/, tools/pack-flora.mjs), its
// records stored behind (`stored`); plants.json when meta.json lists no such index (the repository, an older deploy).

import { config } from '../config.js';
import * as db from './db.js';
import { isQuotaError, writeLocal } from './quota.js';
import { timeoutSignal } from './net.js';
import { installFlora, plantFromWorker } from './search.js';

/**
 * @typedef {{ phase: 'checking' | 'downloading' | 'storing' | 'ready', meta?: any, offline?: boolean }} SyncProgress
 * @typedef {{ meta: any | null, offline: boolean, deferred: boolean }} UpdateOutcome
 *   meta: the new dataset, once stored (null: the local copy stays); offline: data/meta.json did not answer;
 *   deferred: a new dataset was announced but its download failed (or was not the one announced)
 */

/** How long a launch with a local copy waits for data/meta.json, in the background, before giving up until the next one. */
const META_TIMEOUT = 8000;

/** data/meta.json, fresh (revalidated with the server). @param {number} [timeout] ms */
async function fetchMeta(timeout) {
  const response = await fetch(config.metaUrl, { cache: 'no-cache', signal: timeout ? timeoutSignal(timeout) : undefined });
  if (!response.ok) throw new Error(response.status + ' ' + response.statusText);
  return response.json();
}

/**
 * The local copy is the published one: same content fingerprint (sha256 of plants.json, set by the dataset build),
 * or, while either has none (a copy stored before fingerprints, a meta.json without one), the same build date.
 * A new build of the same flora changes the date, not the fingerprint: nothing is downloaded again.
 * @param {any} local @param {any} remote
 */
const sameDataset = (local, remote) => local.sha256 && remote.sha256
  ? local.sha256 === remote.sha256
  : local.generatedAt === remote.generatedAt;

/**
 * In the background, the app already running on the local copy: is there a new dataset? If so the worker downloads
 * it, checks it (a truncated file, an empty list served as 200, or the file of the next deploy fetched between the two
 * requests never erase the flora) and stores it over the local copy in one go, then searches on it.
 * A failure leaves the local copy as it is (tried again on the next launch).
 * @param {any} local
 * @returns {Promise<UpdateOutcome>}
 */
async function checkForUpdate(local) {
  let remote;
  try {
    remote = await fetchMeta(META_TIMEOUT);
  } catch (error) {
    console.warn('Flore : pas de réponse de meta.json, copie locale gardée :', error);
    return { meta: null, offline: true, deferred: false };
  }
  if (sameDataset(local, remote)) {
    // Same flora, built again: the new build's description (counts, dates) is kept, without the plants.
    if (remote.generatedAt !== local.generatedAt) await db.put('meta', remote, 'dataset').catch(() => {});
    return { meta: null, offline: false, deferred: false };
  }
  try {
    await installFlora(remote).stored;
  } catch (error) {
    console.warn('Flore : mise à jour reportée, copie locale gardée :', error);
    return { meta: null, offline: false, deferred: true };
  }
  return { meta: remote, offline: false, deferred: false };
}

/** More room than when storing failed, by this much (bytes): worth trying again. */
const MARGIN = 5 * 1024 * 1024;

/** Free room for this site (bytes), when the browser says. @returns {Promise<number | null>} */
async function freeSpace() {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return typeof estimate?.quota === 'number' && typeof estimate.usage === 'number' ? Math.max(0, estimate.quota - estimate.usage) : null;
  } catch { return null; }
}

/** The free room when storing the flora last failed for lack of it, else null. @returns {number | null} */
function readQuotaFailure() {
  try {
    const value = localStorage.getItem(config.storageKeys.datasetQuota);
    return value === null ? null : Number(value) || 0;
  } catch { return null; }
}

/** @param {number} bytes */
const mb = bytes => `${Math.max(1, Math.round(bytes / 1048576)).toLocaleString('fr-FR')} Mo`;

/** The flora could not be stored for lack of room: what to do, in French. @param {number | null} free */
function storageFull(free) {
  const error = new Error('Espace de stockage insuffisant : la flore (environ 25 Mo une fois enregistrée) ne tient pas sur cet appareil'
    + (free !== null ? ` (${mb(free)} disponibles pour GeoFlora)` : '')
    + '. Libérez de l’espace (fichiers, applications, données d’autres sites), puis rechargez la page.');
  error.name = 'QuotaExceededError';
  return error;
}

/** @param {unknown} error */
const downloadFailed = error => new Error('Impossible de télécharger la flore : ' + /** @type {Error} */ (error).message, { cause: error });

/**
 * The flora to start on. With a complete local copy, at once: data/meta.json is checked in the background
 * (`update`), so a slow or silent network never holds the search back. On a first visit (or an incomplete copy),
 * downloaded first — the search starts on the flora's index, `stored` resolves once every record is in IndexedDB (the
 * plant sheets read them from the worker meanwhile: db.js readPlantsFrom), and rejects when they could not be (the
 * download failed after the index, or no room). Works offline as long as a previous sync succeeded.
 * @param {(progress: SyncProgress) => void} [onProgress]
 * @returns {Promise<{ meta: any, updated: boolean, offline: boolean, update: Promise<UpdateOutcome> | null, stored: Promise<void> | null }>}
 */
export async function syncDataset(onProgress = () => {}) {
  onProgress({ phase: 'checking' });

  const [local, stored] = await Promise.all([
    db.get('meta', 'dataset'),
    db.count('plants')
  ]);

  if (local && stored && stored === local.plants) {
    onProgress({ phase: 'ready', meta: local });
    return { meta: local, updated: false, offline: false, update: checkForUpdate(local), stored: null };
  }

  let remote;
  try {
    remote = await fetchMeta();
  } catch (error) {
    if (local && stored) {
      onProgress({ phase: 'ready', meta: local, offline: true });
      return { meta: local, updated: false, offline: true, update: null, stored: null };
    }
    throw new Error('Impossible de télécharger la flore (hors ligne ?) : ' + /** @type {Error} */ (error).message, { cause: error });
  }

  // The last try ran out of room, and there is no more room now: the flora is not downloaded again for nothing.
  const free = await freeSpace();
  const failedWith = readQuotaFailure();
  if (failedWith !== null && free !== null && free < failedWith + MARGIN) throw storageFull(free);

  onProgress({ phase: 'downloading', meta: remote });
  const install = installFlora(remote, { early: true });
  db.readPlantsFrom({ get: plantFromWorker, stored: install.stored });
  try {
    await install.searchable;
  } catch (error) {
    db.readPlantsFrom(null);
    if (local && stored) {
      onProgress({ phase: 'ready', meta: local, offline: true });
      return { meta: local, updated: false, offline: true, update: null, stored: null };
    }
    throw isQuotaError(error) ? await noRoom() : downloadFailed(error);
  }

  const storedNow = install.stored.then(() => {
    writeLocal(config.storageKeys.datasetQuota, null);
    db.readPlantsFrom(null);
  }, async error => {
    // The records stay in the worker: this session's sheets still open; the next launch downloads again.
    throw isQuotaError(error) ? await noRoom() : downloadFailed(error);
  });
  onProgress({ phase: 'ready', meta: remote });
  return { meta: remote, updated: true, offline: false, update: null, stored: storedNow };
}

/** No room to store the flora: noted (the next launch does not download it in vain), and said. */
async function noRoom() {
  const left = await freeSpace();
  writeLocal(config.storageKeys.datasetQuota, String(left ?? 0));
  return storageFull(left);
}
