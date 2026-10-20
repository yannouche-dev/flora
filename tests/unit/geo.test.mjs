// app/core/geo.js: one position, once, from the shared watch (takeFix, oneFix) — a fix young enough (maxAge: from the
// call), why there is none (the watch's words and code), null past the timeout or once dropped (signal); told at once
// when the watch already holds such a fix (within the call, as the screens' own copies did), told once only, and the
// watch stopped after. The browser's geolocation is a fake one here, which hands out positions when told to; the
// module keeps its state from one test to the next (as in a page), so the tests run in order.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const geo = {
  /** @type {Map<number, { ok: (p: any) => void, fail: (e: any) => void, options: any }>} */
  watches: new Map(),
  next: 1,
  started: 0,
  cleared: 0,
  /** @param {(p: any) => void} ok @param {(e: any) => void} fail @param {any} options */
  watchPosition(ok, fail, options) { const id = this.next++; this.watches.set(id, { ok, fail, options }); this.started++; return id; },
  /** @param {number} id */
  clearWatch(id) { this.watches.delete(id); this.cleared++; }
};
Object.defineProperty(globalThis.navigator, 'geolocation', { value: geo, configurable: true });

const { FIX_MAX_AGE, oneFix, takeFix, watchLocation } = await import('../../app/core/geo.js');

/** The device finds itself at [lon, lat] (`ago` ms ago). @param {number} lon @param {number} lat @param {number} [ago] */
const found = (lon, lat, ago = 0) => {
  const timestamp = Date.now() - ago;
  for (const w of [...geo.watches.values()]) w.ok({ coords: { longitude: lon, latitude: lat, accuracy: 8 }, timestamp });
  return timestamp;
};
/** The device refuses (1), times out (3) or has no position (2). @param {number} code */
const refused = code => { for (const w of [...geo.watches.values()]) w.fail({ code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }); };
/** Past the microtasks queued so far (the watch is stopped on one). */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
/** The watch holds a fix taken `ago` ms ago, and nobody listens any more. @param {number} lon @param {number} lat @param {number} ago */
const holding = async (lon, lat, ago) => { const stop = watchLocation(() => {}); found(lon, lat, ago); stop(); await settle(); };

test('la première position venue, puis plus de suivi', async () => {
  assert.equal(FIX_MAX_AGE, 60_000);
  const asked = oneFix({ maxAge: FIX_MAX_AGE });
  assert.equal(geo.watches.size, 1, 'le suivi partagé démarre');
  assert.deepEqual([...geo.watches.values()][0].options, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  const at = found(2.35, 48.85);
  assert.deepEqual(await asked, { coordinates: [2.35, 48.85], accuracy: 8, timestamp: at });
  await settle();
  assert.equal(geo.watches.size, 0, 'arrêté une fois la position donnée');
});

test('une position déjà tenue et assez récente : donnée tout de suite, dans l’appel même', async () => {
  const cleared = geo.cleared;
  /** @type {any[]} */ const told = [];
  takeFix({ maxAge: FIX_MAX_AGE }, r => told.push(r));
  assert.equal(told.length, 1, 'avant même le retour de takeFix');
  assert.deepEqual(told[0].coordinates, [2.35, 48.85]);
  found(1, 1);
  assert.equal(told.length, 1, 'une fois seulement');
  await settle();
  assert.equal(geo.watches.size, 0);
  assert.equal(geo.cleared, cleared + 1, 'le suivi démarré pour elle est arrêté juste après');
  // The promise is resolved within the call too: its reaction comes before a microtask queued right after it.
  /** @type {string[]} */ const order = [];
  oneFix({ maxAge: FIX_MAX_AGE }).then(() => order.push('position'));
  queueMicrotask(() => order.push('après'));
  await settle();
  assert.deepEqual(order, ['position', 'après']);
});

test('maxAge : une position trop vieille n’est pas prise (sans maxAge, si)', async () => {
  const old = Date.now() - 2 * 60_000;
  await holding(3, 45, 2 * 60_000);
  /** @type {any[]} */ const told = [];
  takeFix({ maxAge: FIX_MAX_AGE }, r => told.push(r));
  assert.equal(told.length, 0, 'celle d’il y a deux minutes attend une nouvelle');
  found(3.1, 45.1);
  assert.deepEqual(told.map(r => r.coordinates), [[3.1, 45.1]]);
  await settle();
  await holding(3, 45, 2 * 60_000);
  const any = await oneFix({ timeout: 20000 });
  assert.ok(any && !('error' in any));
  assert.deepEqual(any.coordinates, [3, 45], 'sans maxAge : celle que le suivi tient, si vieille soit-elle');
  assert.ok(Math.abs(any.timestamp - old) < 1000);
  await settle();
  assert.equal(geo.watches.size, 0);
});

test('pas de position : pourquoi, dans les mots du suivi, avec son code', async () => {
  const asked = oneFix({ maxAge: FIX_MAX_AGE });
  refused(1);
  assert.deepEqual(await asked, { error: 'Localisation refusée. Autorisez-la dans les réglages du navigateur pour enregistrer votre position.', code: 'denied' });
  await settle();
  assert.equal(geo.watches.size, 0);
  // Asked again after the failure: the browser is asked anew (watchLocation), and its new answer is the one told.
  const started = geo.started;
  const again = oneFix({ maxAge: FIX_MAX_AGE });
  assert.equal(geo.started, started + 1);
  refused(3);
  assert.deepEqual(await again, { error: 'Position GPS introuvable pour le moment. Restez à découvert quelques secondes.', code: 'timeout' });
  const third = oneFix({ maxAge: FIX_MAX_AGE });
  refused(2);
  assert.deepEqual(await third, { error: 'Position indisponible. Vous pouvez placer le point à la main sur la carte.', code: 'unavailable' });
  await settle();
});

test('timeout : null, puis plus de suivi ; une position plus tardive n’y change rien', async () => {
  await holding(3, 45, 2 * 60_000);
  /** @type {any[]} */ const told = [];
  takeFix({ maxAge: FIX_MAX_AGE, timeout: 20 }, r => told.push(r));
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.deepEqual(told, [null]);
  assert.equal(geo.watches.size, 0);
  found(4, 46);
  assert.deepEqual(told, [null]);
});

test('signal : abandonné, null ; ni la position ni le délai ne parlent après', async () => {
  await holding(3, 45, 2 * 60_000);
  const drop = new AbortController();
  /** @type {any[]} */ const told = [];
  takeFix({ maxAge: FIX_MAX_AGE, timeout: 20, signal: drop.signal }, r => told.push(r));
  assert.deepEqual(told, []);
  drop.abort();
  assert.deepEqual(told, [null]);
  found(5, 47);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.deepEqual(told, [null], 'une fois seulement');
  assert.equal(geo.watches.size, 0);
});

test('un navigateur sans géolocalisation : dit tout de suite', async () => {
  delete (/** @type {any} */ (globalThis.navigator)).geolocation;
  assert.deepEqual(await oneFix({ maxAge: 0 }), { error: 'Ce navigateur ne permet pas la géolocalisation.', code: 'unsupported' });
});
