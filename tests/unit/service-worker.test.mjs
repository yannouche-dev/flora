// sw.js, the cap of its tile cache: the names over the aerial photos and SPOT's (core/backgrounds.js NAMES_LAYERS,
// three tiles over each photo's, on by default) counted apart, three for each of the others — the photos of an area
// seen before never pushed out for the names over another. The service worker read as it is (a classic script, in a
// context of its own: the little of a worker it touches while loading), its trim called on a cache made here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { NAMES_LAYERS, baseLayers } from '../../app/core/backgrounds.js';
import { OVERLAYS, wmtsUrl } from '../../app/core/ign.js';

const catalog = JSON.parse(readFileSync(new URL('../../data/ign-catalog.json', import.meta.url), 'utf8'));
const sw = vm.createContext({ self: { location: { href: 'https://example.org/sw.js' }, addEventListener() {} }, atob, URL, Uint8Array });
vm.runInContext(readFileSync(new URL('../../sw.js', import.meta.url), 'utf8'), sw, { filename: 'sw.js' });
const constant = (/** @type {string} */ name) => vm.runInContext(name, sw);

/** A tile's address at a place, as Leaflet asks it. @param {any} def @param {number} n */
const tile = (def, n) => wmtsUrl(def).replace('{z}', '16').replace('{y}', String(22000 + Math.floor(n / 100))).replace('{x}', String(33000 + (n % 100)));

/** A Cache with its entries in the order stored (the oldest first), as the browser keeps them. @param {string[]} urls */
function cacheOf(urls) {
  const entries = urls.map(url => ({ url }));
  return {
    entries,
    keys: async () => [...entries],
    delete: async (/** @type {{ url: string }} */ key) => { entries.splice(entries.indexOf(key), 1); return true; }
  };
}

test('les noms par-dessus, et eux seuls, reconnus à leur adresse (les trois couches, aucune autre du catalogue)', () => {
  const names = constant('NAMES_TILE');
  for (const l of NAMES_LAYERS) assert.ok(names.test(tile(l, 0)), l.id);
  for (const c of catalog.layers) assert.equal(names.test(tile(c, 0)), NAMES_LAYERS.some(l => l.id === c.id), c.id);
  for (const def of [...baseLayers('photo'), ...baseLayers('spot:2020'), ...Object.values(OVERLAYS).flatMap(o => o.layers)]) assert.equal(names.test(tile(def, 0)), false, def.id);
});

test('le cache des tuiles : les noms comptés à part, trois par tuile des autres — les photos d’autant d’endroits qu’avant eux', async () => {
  const limit = constant('TILE_LIMIT'), namesLimit = constant('NAMES_TILE_LIMIT');
  assert.equal(namesLimit, 3 * limit);
  // Each place seen: its photo, then the names over it; more places than the cap holds.
  const places = limit + 500;
  const [photo] = baseLayers('photo');
  const cache = cacheOf(Array.from({ length: places }, (_, n) => [tile(photo, n), ...NAMES_LAYERS.map(l => tile(l, n))]).flat());
  // Trimmed every 50 stores (sw.js trimSometimes): the 50th.
  for (let i = 0; i < 50; i++) await sw.trimSometimes(constant('TILE_CACHE'), cache, limit, { test: constant('NAMES_TILE'), limit: namesLimit });
  const kept = new Set(cache.entries.map(e => e.url));
  const shown = (/** @type {number} */ n) => kept.has(tile(photo, n)) && NAMES_LAYERS.every(l => kept.has(tile(l, n)));
  // The most recent places whole, their photos and their names; the oldest gone, both.
  assert.equal(cache.entries.length, limit + namesLimit);
  for (let n = places - limit; n < places; n++) assert.ok(shown(n), `endroit ${n}`);
  for (let n = 0; n < places - limit; n++) assert.ok(!kept.has(tile(photo, n)) && NAMES_LAYERS.every(l => !kept.has(tile(l, n))), `endroit ${n} parti`);
  // The other caches as before: one count (the photos of the plants).
  const images = cacheOf(Array.from({ length: 450 }, (_, n) => `https://upload.wikimedia.org/${n}.jpg`));
  for (let i = 0; i < 50; i++) await sw.trimSometimes(constant('IMAGE_CACHE'), images, constant('IMAGE_LIMIT'));
  assert.deepEqual(images.entries.map(e => e.url), Array.from({ length: 400 }, (_, n) => `https://upload.wikimedia.org/${n + 50}.jpg`));
});
