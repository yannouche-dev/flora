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
//  - data/*.json and data/flora/ (the flora packed for a first launch): network only — the dataset lives in IndexedDB,
//    so it is not duplicated here
//    (except data/territories.json, data/lookalikes.json and data/safety.json: small and static, precached —
//    the look-alike and toxicity warnings must work offline, where the picking happens — and data/ign-catalog.json,
//    IGN's catalogue of map layers, written at each deploy: listed offline too, and part of the version)
//  - remote images (Wikimedia, iNaturalist…): stale-while-revalidate, in a cache kept across versions and capped
//    (not the originals of the media viewer). Fetched with CORS, so what is stored is a readable response of its
//    real size: an opaque one (a host without CORS) is shown but never stored, as each counts ~7 MB of quota.
//    One request per photo whoever asks, six at a time per host, the latest asked first (the map's points shown now
//    before those gone), a CORS error answered by asking as the page did.
//  - IGN map tiles: cache-first, capped — areas already viewed stay available offline (the 3D maps' vector tiles,
//    their style, fonts and symbols too); « Noms et réseaux » over the photos (a tile over each of theirs for each layer
//    drawn) counted apart, each layer to its own cap, so they never push the photos of an area out
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
// « Noms et réseaux » over the aerial photos and SPOT's (app/core/map-layers.js LANDMARKS: the places' names, the roads,
// the rivers on by default; the railways, the buildings, the boundaries), most of their tiles see-through, light: a
// tile over each photo's for each layer drawn. Each layer kept apart (its identifier, captured), as many as the others —
// as many places as before they came: a photo of an area seen before is never dropped for the names over another, and
// a layer never drawn takes nothing from them.
const LANDMARK_TILE = /[?&]LAYER=(LIMITES_ADMINISTRATIVES_EXPRESS\.LATEST|BUILDINGS\.BUILDINGS|TRANSPORTNETWORKS\.RAILWAYS|TRANSPORTNETWORKS\.ROADS|HYDROGRAPHY\.HYDROGRAPHY|GEOGRAPHICALNAMES\.NAMES)(?:&|$)/;
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
  'lib/ign-catalog.mjs',
  'lib/ign-classify.mjs',
  'data/territories.json',
  'data/lookalikes.json',
  'data/safety.json',
  'data/ign-catalog.json',
  'assets/icons/icon.svg',
  'assets/icons/bi.svg',
  'assets/icons/geoflora-192.png',
  'assets/icons/geoflora-512.png',
  'assets/icons/geoflora-maskable-192.png',
  'assets/icons/geoflora-maskable-512.png',
  'assets/icons/apple-touch-icon-180.png',
  'app/main.js',
  'app/layout/gf-layout.js',
  'app/layout/grammar.js',
  'app/layout/registry.js',
  'app/layout/map-options.js',
  'app/layout/state.js',
  'app/layout/cells.js',
  'app/layout/obs-filters.js',
  'app/layout/sizes.js',
  'app/layout/presets.js',
  'app/layout/gf-builder.js',
  'app/layout/gf-builder-grids.js',
  'app/layout/builder-grid.js',
  'app/layout/gf-block-picker.js',
  'app/layout/picker-model.js',
  'app/layout/summary.js',
  'app/core/split-grip.js',
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
  'app/core/danger.js',
  'app/core/discover.js',
  'app/core/scenes.js',
  'app/core/fr.js',
  'app/core/modes.js',
  'app/core/mode-admin.js',
  'app/core/dataset.js',
  'app/core/altitude.js',
  'app/core/geo.js',
  'app/core/distance.js',
  'app/core/hints.js',
  'app/core/toast.js',
  'app/core/highlight.js',
  'app/core/fold.js',
  'app/core/ign.js',
  'app/core/ign-layers.js',
  'app/core/backgrounds.js',
  'app/core/map-layers.js',
  'app/core/ign-catalog.js',
  'app/core/place-model.js',
  'app/core/portable.js',
  'app/core/territory.js',
  'app/core/regulation.js',
  'app/core/thumb.js',
  'app/core/plants.js',
  'app/core/bundled.js',
  'app/core/lookalikes.js',
  'app/core/poison.js',
  'app/core/safe-url.js',
  'app/core/sheet-blocks.js',
  'app/core/sheet-notes.js',
  'app/core/protected.js',
  'app/core/voice.js',
  'app/core/nearby.js',
  'app/core/geoservices.js',
  'app/core/place-find.js',
  'app/core/media.js',
  'app/styles/ui.js',
  'app/core/query.js',
  'app/core/history.js',
  'app/core/router.js',
  'app/core/search.js',
  'app/core/search-channel.js',
  'app/core/sources.js',
  'app/core/collections.js',
  'app/core/share.js',
  'app/core/store.js',
  'app/core/sync.js',
  'app/core/prefs.js',
  'app/core/quota.js',
  'app/workers/search-core.js',
  'app/workers/flora-pack.js',
  'app/workers/search.worker.js',
  'app/workers/ign-catalog.worker.js',
  'app/components/gf-app.js',
  'app/components/gf-lookalikes.js',
  'app/components/gf-media-viewer.js',
  'app/components/gf-map3d.js',
  'app/core/walk.js',
  'app/components/start-screen.js',
  'app/components/gf-place-search.js',
  'app/components/gf-scenarios.js',
  'app/components/gf-launcher.js',
  'app/components/ui-kit.js',
  'app/miniapp/define.js',
  'app/miniapp/context.js',
  'app/miniapp/layout.js',
  'app/miniapp/runtime.js',
  'app/miniapp/kit.js',
  'app/miniapp/quiet-links.js',
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
  'app/miniapp/kit/ma-meet-media.js',
  'app/miniapp/kit/ma-plant-sheet.js',
  'app/miniapp/kit/watch.js',
  'app/miniapp/kit/trail-store.js',
  'app/miniapp/kit/trail-recap.js',
  'app/miniapp/kit/trail-session.js',
  'app/miniapp/kit/trail-start.js',
  'app/miniapp/kit/ma-walk.js',
  'app/miniapp/kit/ma-walk-card.js',
  'app/miniapp/kit/ma-walk-list.js',
  'app/miniapp/kit/ma-walk-map.js',
  'app/miniapp/kit/ma-walk-search.js',
  'app/miniapp/kit/ma-trail-recap.js',
  'app/miniapp/kit/faux-amis.js',
  'app/miniapp/kit/faux-amis-store.js',
  'app/miniapp/kit/ma-faux-amis.js',
  'app/miniapp/kit/orchids.js',
  'app/miniapp/kit/ma-orchids.js',
  'app/miniapps/index.js',
  'app/miniapps/rencontres.js',
  'app/miniapps/parcours.js',
  'app/miniapps/cueillette.js',
  'app/miniapps/mosaique.js',
  'app/miniapps/faux-amis.js',
  'app/miniapps/orchidees.js',
  'app/components/gf-voice-button.js',
  'app/components/gf-active-filters.js',
  'app/components/gf-add-to.js',
  'app/components/gf-ask.js',
  'app/components/gf-attribution.js',
  'app/components/gf-calendar.js',
  'app/components/gf-capture.js',
  'app/components/gf-harvest-warning.js',
  'app/components/gf-nearby-places.js',
  'app/components/gf-collections.js',
  'app/components/gf-facet.js',
  'app/components/gf-filter-panel.js',
  'app/components/gf-map.js',
  'app/components/map-style.js',
  'app/components/gf-map-gl.js',
  'app/core/orbit.js',
  'app/components/gf-map-obs3d.js',
  'app/core/around3d.js',
  'app/core/observations.js',
  'app/components/map3d-options.js',
  'app/core/map-settings.js',
  'app/core/gl-style.js',
  'app/core/maplibre.js',
  'app/styles/map-gl.css',
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
  'app/components/gf-storage-error.js',
  'app/components/gf-status.js',
  'app/components/gf-thumb.js',
  'app/components/gf-map-panel.js',
  'app/components/gf-map-options.js',
  'app/components/gf-ign-layers.js',
  'app/components/gf-layer-stack.js',
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
  // Each file revalidated with the server ('no-cache': never a stale copy of the HTTP cache), not downloaded again
  // ('reload' did): on a first launch the page has just loaded most of them, and the server answers 304 for those.
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL.map(path => new Request(path, { cache: 'no-cache' }))))
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
    if (url.pathname.includes('/data/') && !/\/(territories|lookalikes|safety|ign-catalog)\.json$/.test(url.pathname)) return;
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
  // (Not the catalogue of layers, GetCapabilities: app/core/ign-catalog.js reads it as it streams, and keeps it.)
  if ((url.hostname === TILE_HOST && url.pathname.startsWith('/wmts') && !/getcapabilities/i.test(url.search)) || (url.hostname === 'api.gbif.org' && url.pathname.startsWith('/v2/map/'))) {
    event.respondWith(cacheFirstTile(event));
    return;
  }
  // The maps in 3D: the IGN's vector tiles (buildings, the vector plan) and their style, fonts and symbols — kept like
  // the other tiles (a tile neither cached nor reachable: empty, which MapLibre reads as « nothing here »).
  if (url.hostname === TILE_HOST && (url.pathname.startsWith('/tms/') || url.pathname.startsWith('/annexes/ressources/vectorTiles/'))) {
    event.respondWith(cacheFirstTile(event, url.pathname.endsWith('.pbf') ? new Uint8Array(0) : null));
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
 * A photo: the copy kept, refreshed in the background once while this worker runs (or the network's answer, kept for
 * next time). Only readable answers are kept; a failure to store one never fails the photo.
 * @param {FetchEvent} event
 */
async function cachedImage(event) {
  const { request } = event;
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request.url);
  if (cached) {
    // The refresh in the background: once, never ahead of the photos not kept yet (a host's few connections).
    if (!refreshed.has(request.url)) {
      refreshed.add(request.url);
      event.waitUntil(networkImage(event, cache, true).catch(() => {}));
    }
    return cached;
  }
  return networkImage(event, cache, false).catch(() => Response.error());
}

/** The photos refreshed while this worker runs. */
const refreshed = new Set();

/** Photos asked of one host at once, at most (HTTP/1.1: a browser opens 6 connections to a host). */
const PER_HOST = 6;
/** A photo's request given up after this (ms): a stalled connection never holds a place for good. */
const IMAGE_TIMEOUT = 20_000;

/**
 * A photo asked of the network: one request whoever asks for it at once (the page again, another page, a refresh),
 * waiting its turn among its host's (`start`), given up (`cancel`) when every page that asked has given up.
 * @typedef {{ url: string, host: string, low: boolean, started: boolean, waiting: number, controller: AbortController,
 *   start: () => void, cancel: (reason: any) => void, promise: Promise<Response>, stored: Promise<void> }} ImageJob
 */
/** @type {Map<string, ImageJob>} */
const inflight = new Map();
/**
 * Per host, the photos being fetched and those waiting. The worker's requests are never stopped by the page (a marker
 * taken away, cancelImages): with the browser's queue alone, the photos of the points shown would wait behind every
 * one asked before. So the latest asked go first (the points shown now), and those the page dropped (a message,
 * below) and the refreshes after every other. @type {Map<string, { active: number, queue: ImageJob[] }>}
 */
const hostQueues = new Map();

/**
 * The network's answer for the photo asked by `event`, stored when readable; each one asking gets its own copy.
 * `background`: a refresh (low, never given up by the page).
 * @param {FetchEvent} event @param {Cache} cache @param {boolean} background @returns {Promise<Response>}
 */
function networkImage(event, cache, background) {
  const { request } = event;
  let job = inflight.get(request.url);
  if (!job) {
    job = imageJob(request, cache, background);
    const made = job;
    // The worker kept alive until the photo has come and been stored.
    event.waitUntil(made.promise.then(() => made.stored, () => {}));
  } else if (!background && job.low) {
    // Asked again by a page: in its turn again.
    job.low = false;
  }
  const shared = job;
  shared.waiting++;
  if (!background) request.signal?.addEventListener('abort', () => { if (--shared.waiting <= 0) giveUp(shared); }, { once: true });
  return shared.promise.then(response => response.clone());
}

/** @param {Request} request @param {Cache} cache @param {boolean} low @returns {ImageJob} */
function imageJob(request, cache, low) {
  const url = request.url, host = new URL(url).host, controller = new AbortController();
  /** @type {ImageJob} */
  const job = { url, host, low, started: false, waiting: 0, controller, start: () => {}, cancel: () => {}, promise: /** @type {any} */ (null), stored: Promise.resolve() };
  const turn = new Promise((resolve, reject) => { job.start = () => resolve(undefined); job.cancel = reject; });
  job.promise = turn.then(() => {
    const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT);
    return fetchImage(request, controller.signal, low).finally(() => { clearTimeout(timer); release(host); });
  }).then(response => {
    if (response.ok && (response.type === 'cors' || response.type === 'basic')) {
      job.stored = cache.put(url, response.clone()).then(() => trimSometimes(IMAGE_CACHE, cache, IMAGE_LIMIT)).catch(() => {});
    }
    return response;
  });
  const done = () => { if (inflight.get(url) === job) inflight.delete(url); };
  job.promise.then(done, done);
  inflight.set(url, job);
  const q = hostQueues.get(host) || { active: 0, queue: [] };
  hostQueues.set(host, q);
  q.queue.push(job);
  pump(host);
  return job;
}

/** The next photos of a host started, while it has room: the latest asked first, the low ones last. @param {string} host */
function pump(host) {
  const q = /** @type {{ active: number, queue: ImageJob[] }} */ (hostQueues.get(host));
  while (q.active < PER_HOST && q.queue.length) {
    let i = q.queue.length - 1;
    while (i >= 0 && q.queue[i].low) i--;
    if (i < 0) i = q.queue.length - 1;
    const [job] = q.queue.splice(i, 1);
    q.active++;
    job.started = true;
    job.start();
  }
}

/** A photo of `host` done: the next one's turn. @param {string} host */
function release(host) {
  const q = hostQueues.get(host);
  if (!q) return;
  q.active--;
  pump(host);
}

/** No page waits for this photo any more: not asked (still waiting), or stopped. @param {ImageJob} job */
function giveUp(job) {
  if (inflight.get(job.url) === job) inflight.delete(job.url);
  const q = hostQueues.get(job.host);
  const i = q ? q.queue.indexOf(job) : -1;
  if (q && i >= 0) q.queue.splice(i, 1);
  job.controller.abort();
  if (!job.started) job.cancel(new DOMException('Photo no longer asked', 'AbortError'));
}

// The page's markers taken away (map-style.js#cancelImages): the photos they asked for, still waiting, go last (not
// given up: another image of the page may show the same photo, one request for both).
self.addEventListener('message', event => {
  const { type, urls } = event.data || {};
  if (type !== 'photos-dropped' || !Array.isArray(urls)) return;
  for (const url of urls) {
    const job = inflight.get(url);
    if (job && !job.started) job.low = true;
  }
});

/** Hosts that refused a CORS request while this worker runs: asked for their photos as the page did, at once. */
const noCorsHosts = new Set();

/**
 * The photo as a CORS response when its host allows it (Wikimedia, iNaturalist…: readable, stored at its real size),
 * so the app's plain <img> need no crossorigin attribute. A host without CORS (a refused CORS request), or one that
 * answers the CORS request with an error (403…), still gets its photos shown: asked as the page did (opaque), not
 * stored. @param {Request} request @param {AbortSignal} signal @param {boolean} background
 */
async function fetchImage(request, signal, background) {
  if (request.mode !== 'no-cors') return fetch(request);
  const { host } = new URL(request.url);
  /** @type {RequestInit} */
  const options = { credentials: 'omit', referrerPolicy: request.referrerPolicy || 'no-referrer', signal, ...(background ? { priority: 'low' } : {}) };
  let refused = false;
  if (!noCorsHosts.has(host)) {
    try {
      const response = await fetch(request.url, { ...options, mode: 'cors' });
      if (response.ok) return response;
      // An error in CORS (a host refusing it, a moment's failure): asked once more, as the page did.
    } catch (error) {
      if (signal.aborted) throw error;
      // No CORS on that host (or no network): asked as the page did.
      refused = true;
    }
  }
  const response = await fetch(request.url, { ...options, mode: 'no-cors', credentials: request.credentials });
  // It answers, without CORS: its next photos asked that way at once.
  if (refused && response.type === 'opaque') noCorsHosts.add(host);
  return response;
}

/** @param {any} event @param {Uint8Array | null} [empty] what a tile out of reach is (a transparent PNG; null: an error) */
async function cacheFirstTile(event, empty = EMPTY_TILE) {
  const { request } = event;
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    // Readable answers only (the layers ask in CORS): an opaque one has no status, and weighs ~7 MB of quota.
    if (response.ok) {
      event.waitUntil(cache.put(request, response.clone()).then(() => trimSometimes(TILE_CACHE, cache, TILE_LIMIT, LANDMARK_TILE)).catch(() => {}));
    }
    return response;
  } catch {
    if (!empty) return Response.error();
    return new Response(empty, { headers: { 'Content-Type': empty.length ? 'image/png' : 'application/x-protobuf' } });
  }
}

// Counting thousands of keys on every stored response is wasteful: trim roughly every 50 (per cache).
/** @type {Map<string, number>} */
const storedSinceTrim = new Map();
/**
 * @param {string} name @param {Cache} cache @param {number} limit
 * @param {RegExp} [apart] the entries whose address it matches counted apart, by what it captures (a layer), each such
 *   group to `limit` too
 */
async function trimSometimes(name, cache, limit, apart) {
  const count = (storedSinceTrim.get(name) || 0) + 1;
  storedSinceTrim.set(name, count < 50 ? count : 0);
  if (count < 50) return;
  // Oldest first: an entry refreshed (a photo seen again) moves to the end.
  const keys = await cache.keys();
  /** @type {Map<string, Request[]>} */
  const groups = new Map();
  for (const key of keys) {
    const group = apart?.exec(key.url)?.[1] ?? '';
    const some = groups.get(group);
    if (some) some.push(key);
    else groups.set(group, [key]);
  }
  for (const some of groups.values()) {
    for (const key of some.slice(0, Math.max(0, some.length - limit))) await cache.delete(key);
  }
}
