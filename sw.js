// GeoFlora service worker — hand-written, no tooling.
//  - app shell: precached, then stale-while-revalidate (a deploy is picked up on the next launch)
//  - data/*.json: network only — the dataset lives in IndexedDB, so it is not duplicated here
//    (except data/territories.json and data/lookalikes.json: small and static, precached — the look-alike
//    warnings must work offline, where the picking happens)
//  - remote images (Wikimedia, iNaturalist): stale-while-revalidate, capped
//  - IGN map tiles: cache-first, capped — areas already viewed stay available offline
//  - remote API JSON: not cached here (app/core/sources.js caches it in IndexedDB)

const VERSION = 'v57';
const SHELL_CACHE = 'geoflora-shell-' + VERSION;
const IMAGE_CACHE = 'geoflora-images-' + VERSION;
const IMAGE_LIMIT = 400;
// Tiles are kept across app versions (not tied to VERSION): they don't change when the app does.
const TILE_CACHE = 'geoflora-tiles';
const TILE_LIMIT = 3000;
const TILE_HOST = 'data.geopf.fr';
// 1×1 transparent PNG for tiles that are neither cached nor reachable.
const EMPTY_TILE = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), c => c.charCodeAt(0));

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'vendor/lit.js',
  'vendor/leaflet.js',
  'vendor/leaflet.css',
  'lib/plant-sources.mjs',
  'data/territories.json',
  'data/lookalikes.json',
  'assets/icons/icon.svg',
  'assets/icons/bi.svg',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'app/main.js',
  'app/config.js',
  'app/styles/tokens.css',
  'app/styles/app.css',
  'app/styles/map.css',
  'app/core/db.js',
  'app/core/dataset.js',
  'app/core/geo.js',
  'app/core/highlight.js',
  'app/core/ign.js',
  'app/core/place-model.js',
  'app/core/portable.js',
  'app/core/territory.js',
  'app/core/thumb.js',
  'app/core/lookalikes.js',
  'app/core/sheet-blocks.js',
  'app/core/protected.js',
  'app/core/voice.js',
  'app/core/nearby.js',
  'app/core/geoservices.js',
  'app/core/media.js',
  'app/styles/ui.js',
  'app/core/query.js',
  'app/core/history.js',
  'app/core/router.js',
  'app/core/search.js',
  'app/core/sources.js',
  'app/core/collections.js',
  'app/core/share.js',
  'app/core/store.js',
  'app/workers/search.worker.js',
  'app/components/gf-app.js',
  'app/components/gf-lookalikes.js',
  'app/components/gf-voice-button.js',
  'app/components/gf-active-filters.js',
  'app/components/gf-add-to.js',
  'app/components/gf-attribution.js',
  'app/components/gf-calendar.js',
  'app/components/gf-capture.js',
  'app/components/gf-collections.js',
  'app/components/gf-facet.js',
  'app/components/gf-filter-panel.js',
  'app/components/gf-map.js',
  'app/components/gf-map-page.js',
  'app/components/gf-plant-card.js',
  'app/components/gf-plant-detail.js',
  'app/components/gf-plant-list.js',
  'app/components/gf-plant-pick-list.js',
  'app/components/gf-plant-spots.js',
  'app/components/gf-results-bar.js',
  'app/components/gf-plant-search.js',
  'app/components/gf-flora.js',
  'app/components/gf-mode-switch.js',
  'app/core/icons.js',
  'app/core/modules.js',
  'app/components/gf-settings.js',
  'app/components/gf-sortable-list.js',
  'app/components/gf-shared.js',
  'app/components/gf-spot-editor.js',
  'app/components/gf-status.js',
  'app/components/gf-thumb.js',
  'app/components/gf-map-panel.js',
  'app/components/gf-map-search.js',
  'app/components/gf-point-card.js',
  'app/components/gf-tabbar.js'
];


self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL.map(path => new Request(path, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('geoflora-') && ![SHELL_CACHE, IMAGE_CACHE, TILE_CACHE].includes(key))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    // The flora lives in IndexedDB; only the small, static department outlines are part of the shell.
    if (url.pathname.includes('/data/') && !/\/(territories|lookalikes)\.json$/.test(url.pathname)) return;
    // SPA navigations (any hash route) are served by the cached index.html.
    const key = request.mode === 'navigate' ? 'index.html' : request;
    event.respondWith(staleWhileRevalidate(event, SHELL_CACHE, key));
    return;
  }

  if (url.hostname === TILE_HOST && url.pathname.startsWith('/wmts')) {
    event.respondWith(cacheFirstTile(event));
    return;
  }

  // Plant photos (Wikimedia, iNaturalist, herbaria…): whatever host the dataset points to.
  if (request.destination === 'image') {
    event.respondWith(staleWhileRevalidate(event, IMAGE_CACHE, request, IMAGE_LIMIT));
  }
});

async function staleWhileRevalidate(event, cacheName, key, limit) {
  const { request } = event;
  const cache = await caches.open(cacheName);
  const cached = await cache.match(key, { ignoreSearch: request.mode === 'navigate' });

  const network = fetch(request)
    .then(async response => {
      // Opaque (no-cors) image responses have status 0 but are still worth caching.
      if (response.ok || response.type === 'opaque') {
        await cache.put(key, response.clone());
        if (limit) await trim(cache, limit);
      }
      return response;
    })
    .catch(() => cached || Response.error());

  // Keep the worker alive until the background refresh has been stored.
  event.waitUntil(network.catch(() => {}));
  return cached || network;
}

async function cacheFirstTile(event) {
  const { request } = event;
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      event.waitUntil(cache.put(request, response.clone()).then(() => trimSometimes(cache)));
    }
    return response;
  } catch {
    return new Response(EMPTY_TILE, { headers: { 'Content-Type': 'image/png' } });
  }
}

// Counting thousands of keys on every tile is wasteful: trim roughly every 50 stored tiles.
let tilesSinceTrim = 0;
async function trimSometimes(cache) {
  if (++tilesSinceTrim < 50) return;
  tilesSinceTrim = 0;
  await trim(cache, TILE_LIMIT);
}

async function trim(cache, limit) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(key);
}
