// sw.js, the cap of its tile cache: « Noms et réseaux » over the aerial photos and SPOT's (core/map-layers.js LANDMARKS:
// a tile over each photo's for each one drawn; three on by default) counted apart, each layer to the cap of the others —
// the photos of an area seen before never pushed out for the names over another, a layer never drawn taking nothing.
// The service worker read as it is (a classic script, in a context of its own: the little of a worker it touches while
// loading), its trim called on a cache made here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { baseLayers } from '../../app/core/backgrounds.js';
import { CATALOG_ROWS, LANDMARKS, LANDMARK_DEFAULTS } from '../../app/core/map-layers.js';
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

test('noms et réseaux, et eux seuls, reconnus à leur adresse (les six couches, aucune autre du catalogue), chacun par son identifiant', () => {
  /** @type {RegExp} */
  const marks = constant('LANDMARK_TILE');
  for (const m of LANDMARKS) assert.equal(marks.exec(tile(m.layer, 0))?.[1], m.layer.id, m.key);
  for (const c of catalog.layers) assert.equal(marks.test(tile(c, 0)), LANDMARKS.some(m => m.layer.id === c.id), c.id);
  for (const def of [...baseLayers('photo'), ...baseLayers('spot:2020'), ...Object.values(OVERLAYS).flatMap(o => o.layers), ...Object.values(CATALOG_ROWS)]) {
    assert.equal(marks.test(tile(def, 0)), false, def.id);
  }
});

test('le cache des tuiles : chaque couche de noms et réseaux comptée à part, autant que les autres — les photos d’autant d’endroits qu’avant eux ; une couche peu vue n’en prend rien', async () => {
  const limit = constant('TILE_LIMIT');
  const marks = LANDMARKS.filter(m => LANDMARK_DEFAULTS.includes(m.key)).map(m => m.layer);
  const [rail] = LANDMARKS.filter(m => m.key === 'rail').map(m => m.layer);
  // Each place seen: its photo, then the usual ones over it; more places than the cap holds — and the railways over the
  // last few only (ticked late).
  const places = limit + 500;
  const [photo] = baseLayers('photo');
  const cache = cacheOf(Array.from({ length: places }, (_, n) => [tile(photo, n), ...marks.map(l => tile(l, n)), ...n >= places - 100 ? [tile(rail, n)] : []]).flat());
  // Trimmed every 50 stores (sw.js trimSometimes): the 50th.
  for (let i = 0; i < 50; i++) await sw.trimSometimes(constant('TILE_CACHE'), cache, limit, constant('LANDMARK_TILE'));
  const kept = new Set(cache.entries.map(e => e.url));
  const shown = (/** @type {number} */ n) => kept.has(tile(photo, n)) && marks.every(l => kept.has(tile(l, n)));
  // The most recent places whole, their photos and their names; the oldest gone, both; the railways all kept.
  assert.equal(cache.entries.length, limit * (1 + marks.length) + 100);
  for (let n = places - limit; n < places; n++) assert.ok(shown(n), `endroit ${n}`);
  for (let n = 0; n < places - limit; n++) assert.ok(!kept.has(tile(photo, n)) && marks.every(l => !kept.has(tile(l, n))), `endroit ${n} parti`);
  for (let n = places - 100; n < places; n++) assert.ok(kept.has(tile(rail, n)), `voie ferrée ${n}`);
  // The other caches as before: one count (the photos of the plants).
  const images = cacheOf(Array.from({ length: 450 }, (_, n) => `https://upload.wikimedia.org/${n}.jpg`));
  for (let i = 0; i < 50; i++) await sw.trimSometimes(constant('IMAGE_CACHE'), images, constant('IMAGE_LIMIT'));
  assert.deepEqual(images.entries.map(e => e.url), Array.from({ length: 400 }, (_, n) => `https://upload.wikimedia.org/${n + 50}.jpg`));
});
