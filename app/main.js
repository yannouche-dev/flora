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
import { anyHarvest, hasSpots, holdIfEmptied, markWalks, refreshMembership, requestPersistence, restoreAfterRepair, restoreReason, spotEvents,
  tagLegacyOrigins, writeBackup } from './core/collections.js';
import { openDb, storageError } from './core/db.js';
import { keptWalks, walkOn } from './miniapp/kit/trail-store.js';
import { followHarvests, harvestModeChosen, store } from './core/store.js';
import { loadNotes } from './core/sheet-notes.js';
import { forgetObsolete } from './core/prefs.js';
import { config } from './config.js';

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
    // « Réparer le stockage » erased the database, or the browser emptied it (made at this open while the backup copy
    // holds something): the copy held before anything is written into the new base, and put back (restoreAfter, below).
    await openDb();
    const restoring = holdIfEmptied();
    // The plant sheet's notes (moved from localStorage on the first launch of version 6 of the database).
    const notes = loadNotes().catch(error => console.error(error));
    const { meta, offline, update, stored } = await syncDataset(({ phase }) => store.set({ statusText: PHASES[phase] }));
    store.set({ meta, offline, statusText: 'Préparation de la recherche…' });
    // A first launch: the worker already searches on the flora it is storing; a local copy: its index built from it.
    if (!stored) await loadIndex();
    await refreshMembership().catch(error => console.error(error));
    // What the mini-apps made before its origin was recorded, tagged once (their « Recommencer » takes it away); then the
    // parcours of before their mark, marked once — not while a restore waits (the base is empty: the next start does it,
    // the copy put back) — and only then the list of them this device kept forgotten (failed or not run: kept for the
    // next start, nothing lost).
    tagLegacyOrigins(knownWalks)
      .then(() => restoring ? undefined : markWalks(knownWalks).then(() => forgetObsolete([config.storageKeys.trails])))
      .catch(error => console.error(error));
    // Collections saved before the backup existed get one now (an empty database never erases it), with the notes.
    notes.then(() => writeBackup()).catch(error => console.error(error));
    // The harvest mode never chosen (« auto »): on with the harvests the device holds — and those that arrive (below:
    // an import, a transfer link, the collections put back after a repair), never written.
    followHarvests(await anyHarvest().catch(() => false));
    // Opened elsewhere than the list (a plant, the Carte, after a reload): the search left last comes back, so
    // the Flore tab and a plant's ‹ › find the same results.
    const saved = context().query;
    if (parse(location.hash).name !== 'search' && saved) store.set({ query: fromHash(saved) });
    await runSearch();
    store.set({ status: 'ready', statusText: '', floraStoring: Boolean(stored) });
    if (stored) followStorage(stored);
    else registerWorker();
    if (update) followUpdate(update);
    if (restoring) restoreAfter(stored);
    // The cache of the online services' answers, bounded: once a day, well after the start (core/cache.js).
    schedulePurge();
  } catch (error) {
    failed(error);
    registerWorker();
  }
}

/**
 * The launch failed: said on the banner, in French. IndexedDB that did not open (core/db.js StorageError, once tried
 * again) says why, and the browser's own words stay at hand for support: gf-app shows what to try, and « Réparer le
 * stockage » where erasing the base can help (components/gf-storage-error.js).
 * @param {unknown} error
 */
function failed(error) {
  console.error(error);
  const storage = storageError(error);
  if (storage) {
    const cause = /** @type {any} */ (storage.cause);
    store.set({ status: 'error', statusText: storage.message, floraStoring: false,
      storageError: { kind: storage.kind, name: cause?.name || storage.name, message: cause?.message || '' } });
    return;
  }
  // Never an empty banner (an IndexedDB error may have no message).
  const e = /** @type {Error} */ (error);
  const fallback = e.name === 'QuotaExceededError' ? 'Espace de stockage insuffisant sur cet appareil : libérez de l’espace, puis rechargez la page.'
    : `Démarrage impossible (${e.name || 'erreur inconnue'}).`;
  store.set({ status: 'error', statusText: e.message || fallback, floraStoring: false });
}

/**
 * « Réparer le stockage » erased the database before this launch (or the browser emptied it): the collections and the
 * plant sheet's notes come back from the backup copy of this device by themselves (core/collections.js
 * restoreAfterRepair), once the flora is stored again — in the background, the search never waits for it. The flora not
 * stored (no network), or the restore failing: the copy stays held, and the next launch tries again.
 * @param {Promise<void> | null} stored
 */
async function restoreAfter(stored) {
  try {
    await stored;
  } catch {
    return;
  }
  const reason = restoreReason();
  try {
    store.set({ restore: { done: true, reason, contents: await restoreAfterRepair() } });
  } catch (error) {
    console.error(error);
    const e = /** @type {Error} */ (error);
    store.set({ restore: { done: false, reason, error: { name: e?.name || 'Erreur', message: e?.message || '' } } });
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
    failed(error);
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

// The browser made the base again under this page (a damaged store, emptied; db.js): the backup copy was held at once
// (nothing written into the new base replaces it), and comes back after the reload, with the flora.
addEventListener('geoflora-emptied', () => {
  holdIfEmptied();
  if (store.state.status === 'error') return;
  store.set({ status: 'error', statusText: 'Le stockage de GeoFlora a été vidé par le navigateur : rechargez la page pour retrouver la flore.' });
});

addEventListener('geoflora-outdated', event => store.set({
  status: 'error',
  statusText: /** @type {CustomEvent} */ (event).detail?.deleted
    ? 'Le stockage de GeoFlora a été réparé dans un autre onglet : rechargez la page pour continuer.'
    : 'GeoFlora vient d’être mis à jour : rechargez la page pour continuer.'
}));

// Favorites/collections changed: the "Mes plantes" facet and its counts must follow; the harvest mode, while the user
// never chose it, comes on with the harvests that arrive (core/store.js#followHarvests: never off during a visit).
spotEvents.addEventListener('change', () => {
  if (store.state.status === 'ready') runSearch();
  if (!harvestModeChosen() && !store.state.harvestMode) anyHarvest().then(followHarvests, () => {});
});

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

// The parcours this device kept (to continue, the recap, the one under way), read once: they are marked in Mes plantes
// (start, above), then the list is forgotten.
const knownWalks = { walks: keptWalks(), walk: walkOn() };
forgetObsolete(config.obsoleteKeys);
startUrlSync();
start();
