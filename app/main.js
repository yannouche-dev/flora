// @ts-check
// Entry point: sync the dataset into IndexedDB, build the search index, register the service worker.

import './components/gf-app.js';
import { syncDataset } from './core/dataset.js';
import { startUrlSync } from './core/query.js';
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
  addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(error => console.warn('Service worker:', error));
  });
}

startUrlSync();
start();
