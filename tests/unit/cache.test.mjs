// app/core/cache.js: the one cache of the online services' answers. A failure is never stored (only remembered a few
// minutes in memory), a degraded answer is kept a few minutes and never replaces a complete copy, an expired copy
// stands in offline, and the purge bounds the store (audit STO-9, OPS-2, QUA-6, ARC-14, PERF-15, STO-17).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCache, GRACE, NEGATIVE_TTL } from '../../app/core/cache.js';
import { SourceError } from '../../app/core/net.js';
import { ModuleOffError } from '../../app/core/modules.js';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** An in-memory store and a clock the test moves. */
function setup() {
  /** @type {Map<string, any>} */
  const rows = new Map();
  const clock = { t: 1_700_000_000_000 };
  const store = {
    get: async (/** @type {string} */ key) => rows.get(key),
    put: async (/** @type {any} */ entry) => { rows.set(entry.key, structuredClone(entry)); },
    scan: async (/** @type {(e: any) => void} */ fn) => { for (const e of rows.values()) fn(e); },
    removeMany: async (/** @type {string[]} */ keys) => { for (const k of keys) rows.delete(k); }
  };
  const cache = createCache({ store, now: () => clock.t });
  return { rows, clock, cache };
}

const down = () => new SourceError('http', 'api.gbif.org', 'api.gbif.org 503', { status: 503 });

test('une copie fraîche est servie sans appel ; deux demandes simultanées font un seul appel', async () => {
  const { cache, rows, clock } = setup();
  let calls = 0;
  const load = async () => { calls++; await new Promise(r => setTimeout(r, 10)); return { n: calls }; };
  const [a, b] = await Promise.all([cache.cached('k', load, { ttl: DAY }), cache.cached('k', load, { ttl: DAY })]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  assert.equal(rows.get('k').ttl, DAY, 'chaque entrée garde sa durée de vie');
  clock.t += DAY / 2;
  assert.deepEqual(await cache.cached('k', load, { ttl: DAY }), { n: 1 });
  assert.equal(calls, 1);
  clock.t += DAY;
  assert.deepEqual(await cache.cached('k', load, { ttl: DAY }), { n: 2 }, 'expirée : demandée à nouveau');
});

test('une panne n’est jamais enregistrée : cache négatif court, en mémoire, puis nouvel essai', async () => {
  const { cache, rows, clock } = setup();
  let calls = 0;
  const failing = async () => { calls++; throw down(); };
  await assert.rejects(cache.cached('k', failing), { kind: 'http' });
  assert.equal(rows.has('k'), false, 'rien dans IndexedDB');
  // Within the negative window: the same error, the source not asked again.
  await assert.rejects(cache.cached('k', failing), { kind: 'http' });
  assert.equal(calls, 1);
  clock.t += NEGATIVE_TTL + 1;
  await assert.rejects(cache.cached('k', failing));
  assert.equal(calls, 2, 'après quelques minutes : demandée à nouveau');
  // « Réessayer » forgets it at once; the source back, the answer is kept.
  cache.forgetFailures();
  assert.deepEqual(await cache.cached('k', async () => ({ ok: true })), { ok: true });
  assert.deepEqual(rows.get('k').value, { ok: true });
});

test('forgetFailures(prefix) n’oublie que les clés de ce préfixe', async () => {
  const { cache } = setup();
  await assert.rejects(cache.cached('a:1', async () => { throw down(); }));
  await assert.rejects(cache.cached('b:1', async () => { throw down(); }));
  cache.forgetFailures('a:');
  assert.deepEqual([...cache.failures.keys()], ['b:1']);
});

test('hors ligne ou source en panne : la copie expirée sert de repli ; pas après une annulation', async () => {
  const { cache, clock } = setup();
  await cache.cached('k', async () => 'old', { ttl: DAY });
  clock.t += 2 * DAY;
  assert.equal(await cache.cached('k', async () => { throw down(); }, { ttl: DAY }), 'old');
  cache.forgetFailures();
  const abort = async () => { throw new DOMException('cancelled', 'AbortError'); };
  await assert.rejects(cache.cached('k', abort, { ttl: DAY }), { name: 'AbortError' });
  assert.equal(cache.failures.has('k'), false, 'une annulation n’est pas une panne');
  await assert.rejects(cache.cached('k', async () => { throw new ModuleOffError('gbif'); }, { ttl: DAY }), { name: 'ModuleOffError' });
  assert.equal(cache.failures.has('k'), false, 'un module coupé non plus');
});

test('une demande partagée annulée par un appelant est refaite pour l’autre', async () => {
  const { cache } = setup();
  const first = cache.cached('k', async () => { await new Promise(r => setTimeout(r, 5)); throw new DOMException('x', 'AbortError'); });
  const second = cache.cached('k', async () => 'fresh', { signal: new AbortController().signal });
  await assert.rejects(first, { name: 'AbortError' });
  assert.equal(await second, 'fresh');
});

test('réponse dégradée : gardée quelques minutes seulement, jamais à la place d’une copie complète', async () => {
  const { cache, rows, clock } = setup();
  const partial = (/** @type {any} */ v) => Boolean(v?.unavailable?.length);
  const degraded = { identifiers: { gbif: null }, unavailable: ['gbif'] };
  await cache.cached('d', async () => degraded, { ttl: 7 * DAY, partial });
  assert.equal(rows.get('d').ttl, NEGATIVE_TTL);
  assert.equal(rows.get('d').partial, true);
  let calls = 0;
  const again = async () => { calls++; return degraded; };
  assert.deepEqual(await cache.cached('d', again, { ttl: 7 * DAY, partial }), degraded, 'servie quelques minutes dans la session');
  assert.equal(calls, 0);
  cache.forgetFailures();
  await cache.cached('d', again, { ttl: 7 * DAY, partial });
  assert.equal(calls, 1, '« Réessayer » (ou un rechargement : mémoire vide) redemande');
  clock.t += NEGATIVE_TTL + 1;
  const full = { identifiers: { gbif: { id: 1 } } };
  assert.deepEqual(await cache.cached('d', async () => full, { ttl: 7 * DAY, partial }), full, 'redemandée après quelques minutes');
  assert.equal(rows.get('d').ttl, 7 * DAY);
  // Expired complete copy, degraded new answer: the complete copy stays and is served.
  clock.t += 8 * DAY;
  assert.deepEqual(await cache.cached('d', async () => degraded, { ttl: 7 * DAY, partial }), full);
  assert.deepEqual(rows.get('d').value, full);
});

test('purge : expirées depuis plus d’un mois et dégradées expirées supprimées ; LRU au-delà du plafond', async () => {
  const { cache, rows, clock } = setup();
  const t0 = clock.t;
  rows.set('old', { key: 'old', fetchedAt: t0 - 7 * DAY - GRACE - 1, ttl: 7 * DAY, value: 1 });
  rows.set('recent-expired', { key: 'recent-expired', fetchedAt: t0 - 8 * DAY, ttl: 7 * DAY, value: 2 });
  rows.set('partial', { key: 'partial', fetchedAt: t0 - NEGATIVE_TTL - 1, ttl: NEGATIVE_TTL, partial: true, value: 3 });
  // Written before entries carried their ttl: their module's (geo: a year).
  rows.set('geo:alt:1,2', { key: 'geo:alt:1,2', fetchedAt: t0 - 200 * DAY, value: 120 });
  rows.set('details2:1', { key: 'details2:1', fetchedAt: t0 - 40 * DAY, value: {} });
  rows.set('fresh', { key: 'fresh', fetchedAt: t0, ttl: DAY, value: 4 });
  const result = await cache.purge();
  assert.deepEqual([...rows.keys()].sort(), ['fresh', 'geo:alt:1,2', 'recent-expired']);
  assert.deepEqual(result, { removed: 3, kept: 3 });

  // Ceiling: the least recently used go first (usedAt, else fetchedAt).
  rows.clear();
  for (let i = 0; i < 6; i++) rows.set('k' + i, { key: 'k' + i, fetchedAt: t0 - i * MINUTE, ttl: DAY, value: i });
  rows.get('k5').usedAt = t0;
  await cache.purge({ maxEntries: 3 });
  assert.deepEqual([...rows.keys()].sort(), ['k0', 'k1', 'k5']);

  // Size: about maxBytes of answers.
  rows.clear();
  for (let i = 0; i < 4; i++) rows.set('b' + i, { key: 'b' + i, fetchedAt: t0 - i * MINUTE, ttl: DAY, value: 'x'.repeat(1000) });
  await cache.purge({ maxBytes: 2100 });
  assert.deepEqual([...rows.keys()].sort(), ['b0', 'b1']);
});

test('une copie servie est notée utilisée (au plus une fois par jour)', async () => {
  const { cache, rows, clock } = setup();
  await cache.cached('k', async () => 1, { ttl: 30 * DAY });
  clock.t += 2 * DAY;
  await cache.cached('k', async () => 2, { ttl: 30 * DAY });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(rows.get('k').usedAt, clock.t);
});
