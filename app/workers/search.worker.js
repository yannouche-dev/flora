// @ts-check
// Search, faceted filtering and sorting over the local flora, off the main thread — and the flora's download, check,
// parse and storage too (core/dataset.js asks), so that none of it blocks the page: ~11 MB of JSON parsed, 7.7k records
// written to IndexedDB, here, never as a long task of the page.
// ~7.7k species: a ranked linear scan answers in a few milliseconds, no library needed.
// Messages (core/search.js, each with its requestId, answered once; `install` also sends progress before its answer):
//  - load: the index rebuilt from IndexedDB (a launch on the local copy);
//  - search: a search on the index;
//  - install {meta, early}: the flora meta.json announces, downloaded and checked (flora-pack.js's pair when meta.json
//    lists it, else plants.json), then stored over the local copy in one transaction. `early` (a first launch, no local
//    copy): the search moves to the new flora as soon as its index has come (progress `searchable`), and its records
//    are served from memory (`plant`) until stored; otherwise (an update) only once stored, the copy on screen and the
//    one stored never two floras;
//  - plant {id}: one record, while an early install is under way (from memory, once the details have come), else
//    from IndexedDB.

import { config } from '../config.js';
import { get, getAll, replacePlants, StorageError } from '../core/db.js';
import { indexPlants, mergeFlora, PACK_FORMAT } from './flora-pack.js';
import { buildIndex, search, vocabularyOf } from './search-core.js';

/** The index of the plants last loaded (core/search.js asks for a load first). */
let index = buildIndex([]);

/**
 * The search on these plants from now on. Its words for the typo-tolerant search (a third of the cost) are built a
 * moment later, not before the first results (a search needing them first builds them itself).
 * @param {any[]} plants
 */
function useIndex(plants) {
  const next = index = buildIndex(plants);
  setTimeout(() => { if (index === next) vocabularyOf(next); }, 1500);
}

/** An early install's records, by id, until stored: a promise (they come after the index). @type {Promise<Map<number, any>> | null} */
let memory = null;

/** genus → family, for the page's filters (core/search.js genusFamily). */
const genusFamilyOf = () => Object.fromEntries(index.entries.map(e => [e.values.genus, e.values.family]));

/** @param {ArrayBuffer} bytes */
async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A file of the flora, as JSON, checked against the fingerprint meta.json gives it before it is read (a truncated
 * file, an empty list served as 200, or the file of the next deploy fetched between the two requests never pass).
 * @param {string} url @param {string | undefined} fingerprint @param {string} name for the messages
 */
async function download(url, fingerprint, name) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(name + ' : ' + response.status + ' ' + response.statusText);
  const bytes = await response.arrayBuffer();
  if (fingerprint && globalThis.crypto?.subtle && await sha256(bytes) !== fingerprint) {
    throw new Error(name + ' ne correspond pas à la version annoncée');
  }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error(name + ' illisible (téléchargement interrompu ?)'); }
}

/** As many plants as meta.json announces. @param {any} meta @param {any[]} plants @param {string} name */
function checkCount(meta, plants, name) {
  if (!Array.isArray(plants) || !plants.length || (meta.plants && plants.length !== meta.plants)) {
    throw new Error(name + ' incomplet : ' + (Array.isArray(plants) ? plants.length : 0) + ' plantes sur ' + meta.plants);
  }
}

/** data/plants.json, checked against meta.json (its fingerprint, its count). @param {any} meta @returns {Promise<any[]>} */
async function downloadPlants(meta) {
  const plants = await download(config.dataUrl, meta.sha256, 'plants.json');
  checkCount(meta, plants, 'plants.json');
  return plants;
}

/** The pack meta.json lists (flora-pack.js), when this app reads its format. @param {any} meta */
const packOf = meta => meta?.files?.format === PACK_FORMAT && meta.files.index?.path && meta.files.details?.path ? meta.files : null;

/** @param {string} path a path of the site (meta.json's) */
const siteUrl = path => new URL(path, new URL('../', config.dataUrl)).href;

/**
 * The flora meta.json announces: its index as soon as it has come (`onIndex`, the pack's: the search can start), then
 * every record. The pack failing at any step, plants.json instead (checked the same way), which gives both.
 * @param {any} meta @param {(plants: any[]) => void} onIndex
 * @returns {Promise<any[]>} the records
 */
async function fetchFlora(meta, onIndex) {
  const pack = packOf(meta);
  if (pack) {
    let indexed = false;
    try {
      const packIndex = await download(siteUrl(pack.index.path), pack.index.sha256, 'index de la flore');
      const light = indexPlants(packIndex);
      checkCount(meta, light, 'index de la flore');
      onIndex(light);
      indexed = true;
      const details = await download(siteUrl(pack.details.path), pack.details.sha256, 'détails de la flore');
      return mergeFlora(packIndex, details);
    } catch (error) {
      console.warn('Flore : fichiers rapides indisponibles, plants.json à la place :', error);
      const plants = await downloadPlants(meta);
      if (!indexed) onIndex(plants);
      return plants;
    }
  }
  const plants = await downloadPlants(meta);
  onIndex(plants);
  return plants;
}

/**
 * @param {any} meta @param {boolean} early @param {(progress: Record<string, any>) => void} progress
 * @returns {Promise<{ stored: true }>}
 */
async function install(meta, early, progress) {
  /** @type {(plants: Map<number, any>) => void} */
  let detailed = () => {};
  /** @type {(error: any) => void} */
  let failed = () => {};
  if (early) {
    memory = new Promise((resolve, reject) => { detailed = resolve; failed = reject; });
    memory.catch(() => {});
  }
  try {
    const plants = await fetchFlora(meta, light => {
      if (!early) return;
      useIndex(light);
      progress({ progress: 'searchable', count: index.entries.length, genusFamily: genusFamilyOf() });
    });
    if (early) {
      detailed(new Map(plants.map(plant => [plant.id, plant])));
      progress({ progress: 'detailed' });
    }
    await replacePlants(plants, meta);
    if (!early) useIndex(plants);
    return { stored: true };
  } catch (error) {
    failed(error);
    throw error;
  }
}

self.addEventListener('message', async ({ data }) => {
  const { requestId } = data;
  try {
    if (data.type === 'load') {
      useIndex(await getAll('plants'));
      self.postMessage({ requestId, count: index.entries.length, genusFamily: genusFamilyOf() });
    } else if (data.type === 'search') {
      self.postMessage({ requestId, ...search(index, data) });
    } else if (data.type === 'install') {
      const result = await install(data.meta, Boolean(data.early), progress => self.postMessage({ requestId, ...progress }));
      // Stored: the records are read from IndexedDB again, the memory let go.
      memory = null;
      self.postMessage({ requestId, ...result, count: index.entries.length, genusFamily: genusFamilyOf() });
    } else if (data.type === 'plant') {
      const plant = memory ? (await memory).get(data.id) : await get('plants', data.id);
      self.postMessage({ requestId, plant: plant ?? null });
    }
  } catch (error) {
    const e = /** @type {Error} */ (error);
    // IndexedDB that does not open: its cause too (what the browser said), so the page says it as its own (core/search.js).
    const cause = /** @type {any} */ (e instanceof StorageError ? e.cause : null);
    self.postMessage({ requestId, error: e.message || e.name || 'erreur inconnue', name: e.name,
      ...(e instanceof StorageError ? { kind: e.kind, cause: { name: cause?.name, message: cause?.message } } : {}) });
  }
});
