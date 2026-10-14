// @ts-check
// Entry point: sync the dataset into IndexedDB, build the search index, register the service worker (once the flora is
// stored, on a first launch: its precache never competes with the download the search waits for).

import './components/gf-app.js';
import { syncDataset } from './core/dataset.js';
import { schedulePurge } from './core/cache.js';
import { fromHash, startUrlSync } from './core/query.js';
import { context } from './core/context.js';
import { parse } from './core/router.js';
import { loadIndex, runSearch } from './core/search.js';
import { anyHarvest, hasSpots, refreshMembership, requestPersistence, spotEvents, tagLegacyOrigins, writeBackup } from './core/collections.js';
import { keptWalks, walkOn } from './miniapp/kit/trail-store.js';
import { initHarvestMode, store } from './core/store.js';
import { loadNotes } from './core/sheet-notes.js';

const PHASES = {
  checking: 'Vérification de la flore…',
  downloading: 'Téléchargement de la flore (première visite ou mise à jour)…',
  storing: 'Enregistrement local de la flore…',
  ready: ''
};

async function start() {
  try {
    // Before any IndexedDB connection exists: granting persistence may close open connections.
    if (hasSpots()) await requestPersistence();
    // The plant sheet's notes (moved from localStorage on the first launch of version 6 of the database).
    const notes = loadNotes().catch(error => console.error(error));
    const { meta, offline, update, stored } = await syncDataset(({ phase }) => store.set({ statusText: PHASES[phase] }));
    store.set({ meta, offline, statusText: 'Préparation de la recherche…' });
    // A first launch: the worker already searches on the flora it is storing; a local copy: its index built from it.
    if (!stored) await loadIndex();
    await refreshMembership().catch(error => console.error(error));
    // What the mini-apps made before its origin was recorded, tagged once (their « Recommencer » takes it away).
    tagLegacyOrigins({ walks: keptWalks(), walk: walkOn() }).catch(error => console.error(error));
    // Collections saved before the backup existed get one now (an empty database never erases it), with the notes.
    notes.then(() => writeBackup()).catch(error => console.error(error));
    initHarvestMode(await anyHarvest().catch(() => false));
    // Opened elsewhere than the list (a plant, the Carte, after a reload): the search left last comes back, so
    // the Flore tab and a plant's ‹ › find the same results.
    const saved = context().query;
    if (parse(location.hash).name !== 'search' && saved) store.set({ query: fromHash(saved) });
    await runSearch();
    store.set({ status: 'ready', statusText: '', floraStoring: Boolean(stored) });
    if (stored) followStorage(stored);
    else registerWorker();
    if (update) followUpdate(update);
    // The cache of the online services' answers, bounded: once a day, well after the start (core/cache.js).
    schedulePurge();
  } catch (error) {
    console.error(error);
    // Never an empty banner (an IndexedDB error may have no message).
    const e = /** @type {Error} */ (error);
    const fallback = e.name === 'QuotaExceededError' ? 'Espace de stockage insuffisant sur cet appareil : libérez de l’espace, puis rechargez la page.'
      : `Démarrage impossible (${e.name || 'erreur inconnue'}).`;
    store.set({ status: 'error', statusText: e.message || fallback });
    registerWorker();
  }
}

/**
 * A first launch searches before the flora is stored: once it is, offline works, and the service worker may take its
 * share of the network (registerWorker). Failing (no room, the records not downloaded), the launch fails as it did
 * when it waited for them.
 * @param {Promise<void>} stored
 */
async function followStorage(stored) {
  try {
    await stored;
    store.set({ floraStoring: false });
  } catch (error) {
    console.error(error);
    store.set({ status: 'error', statusText: /** @type {Error} */ (error).message, floraStoring: false });
  }
  registerWorker();
}

/**
 * The app runs on the local flora while data/meta.json is checked: a new dataset, once stored, replaces the index
 * the search runs on (the results on screen are found again in it); none, or its download failing, changes nothing
 * but a word on the list.
 * @param {Promise<import('./core/dataset.js').UpdateOutcome>} update
 */
async function followUpdate(update) {
  try {
    const { meta, offline, deferred } = await update;
    if (offline) store.set({ offline: true });
    if (deferred) store.set({ datasetDeferred: true });
    if (!meta) return;
    // The worker already searches on it (core/search.js installFlora).
    store.set({ meta });
    await runSearch();
  } catch (error) {
    console.error(error);
  }
}

addEventListener('geoflora-outdated', () => store.set({
  status: 'error',
  statusText: 'GeoFlora vient d’être mis à jour : rechargez la page pour continuer.'
}));

// Favorites/collections changed: the "Mes plantes" facet and its counts must follow.
spotEvents.addEventListener('change', () => { if (store.state.status === 'ready') runSearch(); });

addEventListener('online', () => store.set({ offline: false }));
addEventListener('offline', () => store.set({ offline: true }));

/**
 * The service worker, registered once the launch is done: on a first launch its precache (the whole app, ~200 files)
 * would share the network with the flora the search waits for. Registered once whatever happens (also on an error:
 * the app as it is then works offline next time).
 */
let registered = false;
function registerWorker() {
  if (registered || !('serviceWorker' in navigator) || location.protocol === 'file:') return;
  registered = true;
  const register = () => navigator.serviceWorker.register('sw.js').then(registration => {
    // An installed app resumed from the background does not reload: check for a deploy then too.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') registration.update().catch(() => {}); });
  }).catch(error => console.warn('Service worker:', error));
  if (document.readyState === 'complete') register();
  else addEventListener('load', register, { once: true });
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // A deploy is installed in the background while the cached version runs: offer to reload once the new
  // worker takes over (not when the very first install takes the page over, when there is nothing to update — but
  // a deploy after it, the same page still open, is one).
  let controlled = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (controlled) store.set({ updateReady: true });
    controlled = true;
  });
  // Already installed (a later launch): checked for a deploy at once, as before; the launch never waits for it.
  if (controlled) registerWorker();
}

startUrlSync();
start();
