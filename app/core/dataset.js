// @ts-check
// Keeps the local IndexedDB copy of data/plants.json in sync with the published dataset.

import { config } from '../config.js';
import * as db from './db.js';

/**
 * @typedef {{ phase: 'checking' | 'downloading' | 'storing' | 'ready', meta?: any, offline?: boolean }} SyncProgress
 */

/**
 * Downloads the dataset only when data/meta.json advertises a new generatedAt.
 * Works offline as long as a previous sync succeeded.
 * @param {(progress: SyncProgress) => void} [onProgress]
 * @returns {Promise<{ meta: any, updated: boolean, offline: boolean }>}
 */
export async function syncDataset(onProgress = () => {}) {
  onProgress({ phase: 'checking' });

  const [local, stored] = await Promise.all([
    db.get('meta', 'dataset'),
    db.count('plants')
  ]);

  let remote = null;
  try {
    const response = await fetch(config.metaUrl, { cache: 'no-cache' });
    if (!response.ok) throw new Error(response.status + ' ' + response.statusText);
    remote = await response.json();
  } catch (error) {
    if (local && stored) {
      onProgress({ phase: 'ready', meta: local, offline: true });
      return { meta: local, updated: false, offline: true };
    }
    throw new Error('Impossible de télécharger la flore (hors ligne ?) : ' + /** @type {Error} */ (error).message);
  }

  if (local && stored === local.plants && local.generatedAt === remote.generatedAt) {
    onProgress({ phase: 'ready', meta: local });
    return { meta: local, updated: false, offline: false };
  }

  onProgress({ phase: 'downloading', meta: remote });
  const response = await fetch(config.dataUrl, { cache: 'no-cache' });
  if (!response.ok) throw new Error('plants.json: ' + response.status + ' ' + response.statusText);
  const plants = await response.json();

  onProgress({ phase: 'storing', meta: remote });
  await db.replacePlants(plants, remote);

  onProgress({ phase: 'ready', meta: remote });
  return { meta: remote, updated: true, offline: false };
}
