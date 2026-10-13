// @ts-check
// Keeps the local IndexedDB copy of data/plants.json in sync with the published dataset.

import { config } from '../config.js';
import * as db from './db.js';

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

/** AbortSignal.timeout, where the browser has it. @param {number} ms */
function timeoutSignal(ms) {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException('Délai dépassé', 'TimeoutError')), ms);
  return controller.signal;
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

/** @param {ArrayBuffer} bytes */
async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * data/plants.json, checked against the meta.json that announced it before anything local is replaced: a list of
 * as many plants, whose fingerprint is the one announced (a truncated file, an empty list served as 200, or the
 * plants.json of the next deploy fetched between the two requests never erase the flora).
 * @param {any} meta
 * @returns {Promise<any[]>}
 */
async function downloadPlants(meta) {
  const response = await fetch(config.dataUrl, { cache: 'no-cache' });
  if (!response.ok) throw new Error('plants.json : ' + response.status + ' ' + response.statusText);
  const bytes = await response.arrayBuffer();
  if (meta.sha256 && globalThis.crypto?.subtle && await sha256(bytes) !== meta.sha256) {
    throw new Error('plants.json ne correspond pas à la version annoncée');
  }
  let plants;
  try { plants = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('plants.json illisible (téléchargement interrompu ?)'); }
  if (!Array.isArray(plants) || !plants.length || (meta.plants && plants.length !== meta.plants)) {
    throw new Error('plants.json incomplet : ' + (Array.isArray(plants) ? plants.length : 0) + ' plantes sur ' + meta.plants);
  }
  return plants;
}

/**
 * In the background, the app already running on the local copy: is there a new dataset? If so it is downloaded,
 * checked and stored over the local copy in one go; the caller then rebuilds its index on it.
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
    await db.replacePlants(await downloadPlants(remote), remote);
  } catch (error) {
    console.warn('Flore : mise à jour reportée, copie locale gardée :', error);
    return { meta: null, offline: false, deferred: true };
  }
  return { meta: remote, offline: false, deferred: false };
}

/**
 * The flora to start on. With a complete local copy, at once: data/meta.json is checked in the background
 * (`update`), so a slow or silent network never holds the search back. On a first visit (or an incomplete copy),
 * downloaded first. Works offline as long as a previous sync succeeded.
 * @param {(progress: SyncProgress) => void} [onProgress]
 * @returns {Promise<{ meta: any, updated: boolean, offline: boolean, update: Promise<UpdateOutcome> | null }>}
 */
export async function syncDataset(onProgress = () => {}) {
  onProgress({ phase: 'checking' });

  const [local, stored] = await Promise.all([
    db.get('meta', 'dataset'),
    db.count('plants')
  ]);

  if (local && stored && stored === local.plants) {
    onProgress({ phase: 'ready', meta: local });
    return { meta: local, updated: false, offline: false, update: checkForUpdate(local) };
  }

  let remote;
  try {
    remote = await fetchMeta();
  } catch (error) {
    if (local && stored) {
      onProgress({ phase: 'ready', meta: local, offline: true });
      return { meta: local, updated: false, offline: true, update: null };
    }
    throw new Error('Impossible de télécharger la flore (hors ligne ?) : ' + /** @type {Error} */ (error).message, { cause: error });
  }

  onProgress({ phase: 'downloading', meta: remote });
  let plants;
  try {
    plants = await downloadPlants(remote);
  } catch (error) {
    if (local && stored) {
      onProgress({ phase: 'ready', meta: local, offline: true });
      return { meta: local, updated: false, offline: true, update: null };
    }
    throw new Error('Impossible de télécharger la flore : ' + /** @type {Error} */ (error).message, { cause: error });
  }

  onProgress({ phase: 'storing', meta: remote });
  await db.replacePlants(plants, remote);

  onProgress({ phase: 'ready', meta: remote });
  return { meta: remote, updated: true, offline: false, update: null };
}
