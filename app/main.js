// @ts-check
// Entry point: sync the dataset into IndexedDB, build the search index, register the service worker.

import './components/gf-app.js';
import { syncDataset } from './core/dataset.js';
import { loadIndex, runSearch } from './core/search.js';
import { store } from './core/store.js';

const PHASES = {
  checking: 'Vérification de la flore…',
  downloading: 'Téléchargement de la flore (première visite ou mise à jour)…',
  storing: 'Enregistrement local de la flore…',
  ready: ''
};

async function start() {
  try {
    const { meta, offline } = await syncDataset(({ phase }) => store.set({ statusText: PHASES[phase] }));
    store.set({ meta, offline, statusText: 'Préparation de la recherche…' });
    await loadIndex();
    await runSearch();
    store.set({ status: 'ready', statusText: '' });
  } catch (error) {
    console.error(error);
    store.set({ status: 'error', statusText: /** @type {Error} */ (error).message });
  }
}

addEventListener('online', () => store.set({ offline: false }));
addEventListener('offline', () => store.set({ offline: true }));

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(error => console.warn('Service worker:', error));
  });
}

start();
