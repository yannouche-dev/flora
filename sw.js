// GeoFlora service worker — hand-written, no tooling.
//  - app shell: precached as one versioned whole, then served from the cache first. VERSION is written at deploy
//    (tools/assemble-site.sh, tools/stamp-sw.mjs): a fingerprint of the SHELL files and of this file, so any change
//    gives a new sw.js, which the browser notices on its own (at each launch, and when the app comes back to the
//    foreground: app/main.js), installs in the background, whole or not at all, and the app offers to reload. Until
//    then, the version running stays the one cached, never a mix of two deploys. In the repository VERSION is 'dev':
//    the shell is then served from the network first (an edit shows on a reload), the cache only offline.
//  - on demand (ON_DEMAND): files deployed but not precached — MapLibre (~1.6 MB, the « Vue 3D » only, which needs
//    the network for its relief anyway). Fetched the first time the 3D view opens, then kept in this version's cache:
//    served like the shell from then on (offline too), gone with the version.
//  - data/*.json: network only — the dataset lives in IndexedDB, so it is not duplicated here
//    (except data/territories.json, data/lookalikes.json and data/safety.json: small and static, precached —
//    the look-alike and toxicity warnings must work offline, where the picking happens)
//  - remote images (Wikimedia, iNaturalist…): stale-while-revalidate, in a cache kept across versions and capped
//    (not the originals of the media viewer). Fetched with CORS, so what is stored is a readable response of its
//    real size: an opaque one (a host without CORS) is shown but never stored, as each counts ~7 MB of quota.
//  - IGN map tiles: cache-first, capped — areas already viewed stay available offline
//  - remote API JSON: not cached here (app/core/sources.js caches it in IndexedDB)

// Written at deploy by tools/stamp-sw.mjs: never edited by hand.
const VERSION = 'dev';
const DEV = VERSION === 'dev';
const SHELL_CACHE = 'geoflora-shell-' + VERSION;
// Photos and tiles are kept across app versions (not tied to VERSION): they don't change when the app does.
// (app/components/gf-legal.js empties both.)
const IMAGE_CACHE = 'geoflora-images';
const IMAGE_LIMIT = 400;
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
  'data/safety.json',
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
  'app/core/net.js',
  'app/core/cache.js',
  'app/core/source-state.js',
  'app/core/context.js',
  'app/core/around-sessions.js',
  'app/core/credit.js',
  'app/core/map-focus.js',
  'app/core/panes.js',
  'app/core/open-data.js',
  'app/core/charts.js',
  'app/core/categories.js',
  'app/core/uses.js',
  'app/core/media-items.js',
  'app/core/sheet-session.js',
  'app/core/alerts.js',
  'app/core/discover.js',
  'app/core/scenarios.js',
  'app/core/scenes.js',
  'app/core/modes.js',
  'app/core/mode-admin.js',
  'app/core/dataset.js',
  'app/core/altitude.js',
  'app/core/geo.js',
  'app/core/highlight.js',
  'app/core/fold.js',
  'app/core/ign.js',
  'app/core/place-model.js',
  'app/core/portable.js',
  'app/core/territory.js',
  'app/core/regulation.js',
  'app/core/thumb.js',
  'app/core/lookalikes.js',
  'app/core/safe-url.js',
  'app/core/sheet-blocks.js',
  'app/core/sheet-notes.js',
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
  'app/core/sync.js',
  'app/core/quota.js',
  'app/workers/search-core.js',
  'app/workers/search.worker.js',
  'app/components/gf-app.js',
  'app/components/gf-lookalikes.js',
  'app/components/gf-media-viewer.js',
  'app/components/gf-trail.js',
  'app/components/gf-map3d.js',
  'app/core/walk.js',
  'app/components/start-screen.js',
  'app/components/gf-place-search.js',
  'app/components/gf-scenarios.js',
  'app/components/gf-launcher.js',
  'app/miniapp/define.js',
  'app/miniapp/context.js',
  'app/miniapp/layout.js',
  'app/miniapp/runtime.js',
  'app/miniapp/kit.js',
  'app/miniapp/gf-miniapp.js',
  'app/miniapp/ma-grid.js',
  'app/miniapp/ma-steps.js',
  'app/miniapp/kit/cards.js',
  'app/miniapp/kit/session.js',
  'app/miniapp/kit/around.js',
  'app/miniapp/kit/ma-deck.js',
  'app/miniapp/kit/ma-distance.js',
  'app/miniapp/kit/ma-around-list.js',
  'app/miniapp/kit/ma-around-map.js',
  'app/miniapp/kit/ma-guided.js',
  'app/miniapp/kit/ma-plant-sheet.js',
  'app/miniapps/index.js',
  'app/miniapps/rencontres.js',
  'app/miniapps/parcours.js',
  'app/miniapps/cueillette.js',
  'app/miniapps/mosaique.js',
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
  'app/components/gf-sheet-map.js',
  'app/components/gf-map-page.js',
  'app/components/gf-plant-card.js',
  'app/components/gf-pager.js',
  'app/components/gf-place-insights.js',
  'app/components/gf-plant-detail.js',
  'app/components/gf-plant-list.js',
  'app/components/gf-plant-pick-list.js',
  'app/components/gf-plant-spots.js',
  'app/components/gf-results-bar.js',
  'app/components/gf-plant-search.js',
  'app/components/gf-flora.js',
  'app/components/gf-mode-switch.js',
  'app/core/icons.js',
  'app/core/img.js',
  'app/core/pane-tree.js',
  'app/core/dock-drag.js',
  'app/core/web-pane.js',
  'app/core/regions.js',
  'app/components/gf-web-pane.js',
  'app/core/modules.js',
  'app/components/gf-settings.js',
  'app/components/gf-legal.js',
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

// Deployed, not precached: kept once asked (see above). tools/check.sh allows a file of vendor/ here instead of in
// SHELL; tools/stamp-sw.mjs counts them in the version all the same.
const ON_DEMAND = [
  'vendor/maplibre/maplibre-gl.mjs',
  'vendor/maplibre/maplibre-gl-worker.mjs',
  'vendor/maplibre/maplibre-gl.css',
  'vendor/maplibre/LICENSE.txt'
];

/** The address of each precached file, to tell them from the other files of the site. */
const PRECACHED = new Set(SHELL.map(path => new URL(path, self.location.href).href));
/** The address of each file kept on demand (its query left out: MapLibre asks for its worker with ?v=…). */
const KEPT = new Set(ON_DEMAND.map(path => new URL(path, self.location.href).href));

self.addEventListener('install', event => {
  // All or nothing: one file missing and this version never installs (its partial cache goes; not in the repository,
  // where every worker shares the 'dev' cache), the one running keeps its own cache.
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL.map(path => new Request(path, { cache: 'reload' }))))
      .catch(error => (DEV ? Promise.resolve() : caches.delete(SHELL_CACHE)).then(() => { throw error; }))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  // The previous versions' shells go, and the photo caches named after a version (before the cache kept across them).
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
    if (url.pathname.includes('/data/') && !/\/(territories|lookalikes|safety)\.json$/.test(url.pathname)) return;
    // The app's navigations (any hash route, to the root or to index.html) are served by the cached index.html.
    // A file of the site opened in a tab (an icon, the manifest) is no launch of the app: straight from the network,
    // and never stored as the app's page.
    if (request.mode === 'navigate') {
      if (!isAppPage(url)) return;
      event.respondWith(fromShell(event, 'index.html', isHtml));
      return;
    }
    // A file kept on demand: under its address without the query (one copy, whatever the version asked).
    const bare = url.origin + url.pathname;
    event.respondWith(fromShell(event, KEPT.has(bare) ? bare : request));
    return;
  }

  // IGN map tiles, and GBIF distribution tiles (plant sheet, Carte).
  // (Not the catalogue of layers, GetCapabilities: the app keeps it a month itself.)
  if ((url.hostname === TILE_HOST && url.pathname.startsWith('/wmts') && !/getcapabilities/i.test(url.search)) || (url.hostname === 'api.gbif.org' && url.pathname.startsWith('/v2/map/'))) {
    event.respondWith(cacheFirstTile(event));
    return;
  }

  // Plant photos (Wikimedia, iNaturalist, herbaria…): whatever host the dataset points to.
  // Not the originals the media viewer zooms on (megabytes each): straight from the network.
  if (request.destination === 'image' && !isOriginal(url)) {
    event.respondWith(cachedImage(event));
  }
});

/** The app's page: the root of the worker's scope, or its index.html. */
function isAppPage(url) {
  const root = new URL('./', self.registration.scope).pathname;
  return url.pathname === root || url.pathname === root + 'index.html';
}

/** An HTML page (not an error page of a proxy or captive portal served as something else). */
const isHtml = response => (response.headers.get('content-type') || '').startsWith('text/html');

/** An original file: iNaturalist « original », a Commons file outside /thumb/. */
function isOriginal(url) {
  return /\/photos\/\d+\/original\./.test(url.pathname) || (url.hostname === 'upload.wikimedia.org' && !url.pathname.includes('/thumb/'));
}

/**
 * A file of the site. Deployed: from the cache of this version first (installed whole), the network only for a file
 * that is not there (outside SHELL, or the cache evicted), a file of the shell then stored again. In the repository
 * (VERSION 'dev'): from the network first, the cache offline.
 * @param {FetchEvent} event @param {Request | string} key @param {(response: Response) => boolean} [storable]
 */
async function fromShell(event, key, storable = () => true) {
  const { request } = event;
  const cache = await caches.open(SHELL_CACHE);
  const options = { ignoreSearch: request.mode === 'navigate' };
  const store = (/** @type {Response} */ response) => {
    const address = new URL(typeof key === 'string' ? key : key.url, self.location.href).href;
    const precached = PRECACHED.has(address) || KEPT.has(address);
    if (precached && response.ok && response.type === 'basic' && storable(response)) {
      event.waitUntil(cache.put(key, response.clone()).catch(() => {}));
    }
    return response;
  };
  if (DEV) {
    try {
      return store(await fetch(request));
    } catch {
      return (await cache.match(key, options)) || Response.error();
    }
  }
  const cached = await cache.match(key, options);
  if (cached) return cached;
  return store(await fetch(request));
}

/**
 * A photo: the copy kept, refreshed in the background (or the network's answer, kept for next time). Only readable
 * answers are kept; a failure to store one never fails the photo.
 * @param {FetchEvent} event
 */
async function cachedImage(event) {
  const { request } = event;
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request.url);
  const network = fetchImage(request).then(response => {
    if (response.ok && (response.type === 'cors' || response.type === 'basic')) {
      event.waitUntil(cache.put(request.url, response.clone()).then(() => trimSometimes(IMAGE_CACHE, cache, IMAGE_LIMIT)).catch(() => {}));
    }
    return response;
  });
  // Keep the worker alive until the background refresh has been stored.
  event.waitUntil(network.catch(() => {}));
  return cached || network.catch(() => Response.error());
}

/** Hosts that answered without CORS while this worker runs: asked for the photo as the page did, once. */
const noCorsHosts = new Set();

/**
 * The photo as a CORS response when its host allows it (Wikimedia, iNaturalist…: readable, stored at its real size),
 * so the app's plain <img> need no crossorigin attribute. A host without CORS (a refused CORS request, then an opaque
 * answer) still gets its photos shown: asked as the page did, not stored.
 * @param {Request} request
 */
async function fetchImage(request) {
  if (request.mode !== 'no-cors') return fetch(request);
  const { host } = new URL(request.url);
  if (!noCorsHosts.has(host)) {
    try {
      return await fetch(request.url, { mode: 'cors', credentials: 'omit', referrerPolicy: request.referrerPolicy || 'no-referrer' });
    } catch { /* no CORS on that host, or no network: asked below as the page did */ }
  }
  const response = await fetch(request);
  if (response.type === 'opaque') noCorsHosts.add(host);
  return response;
}

async function cacheFirstTile(event) {
  const { request } = event;
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    // Readable answers only (the layers ask in CORS): an opaque one has no status, and weighs ~7 MB of quota.
    if (response.ok) {
      event.waitUntil(cache.put(request, response.clone()).then(() => trimSometimes(TILE_CACHE, cache, TILE_LIMIT)).catch(() => {}));
    }
    return response;
  } catch {
    return new Response(EMPTY_TILE, { headers: { 'Content-Type': 'image/png' } });
  }
}

// Counting thousands of keys on every stored response is wasteful: trim roughly every 50 (per cache).
/** @type {Map<string, number>} */
const storedSinceTrim = new Map();
/** @param {string} name @param {Cache} cache @param {number} limit */
async function trimSometimes(name, cache, limit) {
  const count = (storedSinceTrim.get(name) || 0) + 1;
  storedSinceTrim.set(name, count < 50 ? count : 0);
  if (count < 50) return;
  // Oldest first: an entry refreshed (a photo seen again) moves to the end.
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(key);
}
