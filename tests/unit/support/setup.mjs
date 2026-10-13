// Loaded before the unit tests (node --import, package.json « test:unit »): the app's modules are browser modules,
// so Node gets the little of a browser they touch while loading — history and location (core/history.js), a Worker
// (core/search.js), localStorage (core/store.js), and a 'leaflet' resolved to a stub (core/ign.js extends
// L.TileLayer when loaded) — and a fetch that reads the repository's files for file: URLs (core/lookalikes.js fetches
// data/lookalikes.json next to the module). Nothing here is under test: the tests only import modules through it.

import { register } from 'node:module';
import { readFile } from 'node:fs/promises';

register('./hooks.mjs', import.meta.url);

const events = new EventTarget();
globalThis.addEventListener ??= events.addEventListener.bind(events);
globalThis.removeEventListener ??= events.removeEventListener.bind(events);
globalThis.dispatchEvent ??= events.dispatchEvent.bind(events);

const location = { hash: '#/', href: 'http://localhost/#/', origin: 'http://localhost', pathname: '/', search: '' };
/** @type {any} */ (globalThis).location ??= location;
let state = null;
const go = (/** @type {any} */ s, /** @type {string | URL | undefined} */ url) => {
  state = s;
  if (url !== undefined) { const u = String(url); location.hash = u.slice(u.indexOf('#')) || '#/'; location.href = 'http://localhost/' + location.hash; }
};
/** @type {any} */ (globalThis).history ??= {
  get state() { return state; },
  replaceState: (/** @type {any} */ s, /** @type {string} */ _t, /** @type {string} */ url) => go(s, url),
  pushState: (/** @type {any} */ s, /** @type {string} */ _t, /** @type {string} */ url) => go(s, url),
  back() {}, forward() {}, go() {}
};

/** @type {any} */ (globalThis).Worker ??= class { postMessage() {} addEventListener() {} removeEventListener() {} terminate() {} };

if (typeof globalThis.localStorage === 'undefined') {
  const items = new Map();
  /** @type {any} */ (globalThis).localStorage = {
    getItem: (/** @type {string} */ k) => items.has(k) ? items.get(k) : null,
    setItem: (/** @type {string} */ k, /** @type {unknown} */ v) => { items.set(k, String(v)); },
    removeItem: (/** @type {string} */ k) => { items.delete(k); },
    clear: () => items.clear(),
    key: (/** @type {number} */ i) => [...items.keys()][i] ?? null,
    get length() { return items.size; }
  };
}

const nodeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== 'file:') return nodeFetch(input, init);
  try {
    return new Response(await readFile(url), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch {
    return new Response('', { status: 404, statusText: 'Not Found' });
  }
};
