// @ts-check
// Entry point: sync the dataset into IndexedDB, build the search index, register the service worker.

import './components/gf-app.js';
import { syncDataset } from './core/dataset.js';
import { fromHash, startUrlSync } from './core/query.js';
import { context } from './core/context.js';
import { parse } from './core/router.js';
import { loadIndex, runSearch } from './core/search.js';
import { anyHarvest, hasSpots, refreshMembership, requestPersistence, spotEvents, writeBackup } from './core/collections.js';
import { initHarvestMode, store } from './core/store.js';

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
    const { meta, offline } = await syncDataset(({ phase }) => store.set({ statusText: PHASES[phase] }));
    store.set({ meta, offline, statusText: 'Préparation de la recherche…' });
    await loadIndex();
    await refreshMembership().catch(error => console.error(error));
    // Collections saved before the backup existed get one now (an empty database never erases it).
    writeBackup().catch(error => console.error(error));
    initHarvestMode(await anyHarvest().catch(() => false));
    // Opened elsewhere than the list (a plant, the Carte, after a reload): the search left last comes back, so
    // the Flore tab and a plant's ‹ › find the same results.
    const saved = context().query;
    if (parse(location.hash).name !== 'search' && saved) store.set({ query: fromHash(saved) });
    await runSearch();
    store.set({ status: 'ready', statusText: '' });
  } catch (error) {
    console.error(error);
    store.set({ status: 'error', statusText: /** @type {Error} */ (error).message });
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

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // A deploy is installed in the background while the cached version runs: offer to reload once the new
  // worker takes over (not on the very first install, when there is nothing to update).
  const updating = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (updating) store.set({ updateReady: true }); });
  addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(registration => {
      // An installed app resumed from the background does not reload: check for a deploy then too.
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') registration.update().catch(() => {}); });
    }).catch(error => console.warn('Service worker:', error));
  });
}

startUrlSync();
start();
