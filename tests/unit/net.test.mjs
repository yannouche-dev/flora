// app/core/net.js: every remote JSON call has a time limit, a minimal check of its shape, and a typed error — offline,
// timeout, HTTP error, bad shape, module off, cancelled — so a block says « Source indisponible — Réessayer » rather
// than « chargement… » for ever or « aucune donnée » (audit STO-7, STO-8, OPS-2).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { SchemaError, SourceError, anySignal, errorKind, fetchJson, isUnavailable, unavailableReason } from '../../app/core/net.js';
import { ModuleOffError } from '../../app/core/modules.js';

// Node's AbortSignal.timeout does not keep the process alive (a browser's page does): a timer that does, meanwhile.
const alive = setInterval(() => {}, 1000);
after(() => clearInterval(alive));

/** Replaces fetch for one test. @param {any} t @param {(url: string, init: any) => Promise<Response>} impl */
function stubFetch(t, impl) {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  /** @type {any} */ (globalThis).fetch = impl;
}

/** A fetch that never answers, but stops when its signal aborts (as a browser's does). */
const hanging = (/** @type {string} */ _url, /** @type {any} */ init) => new Promise((_, reject) => {
  init.signal.addEventListener('abort', () => reject(init.signal.reason ?? new DOMException('aborted', 'AbortError')), { once: true });
});

/** navigator.onLine set for one test. @param {any} t @param {boolean} value */
function setOnline(t, value) {
  const nav = /** @type {any} */ (globalThis).navigator;
  const had = Object.getOwnPropertyDescriptor(nav, 'onLine');
  Object.defineProperty(nav, 'onLine', { value, configurable: true });
  t.after(() => { if (had) Object.defineProperty(nav, 'onLine', had); else delete nav.onLine; });
}

test('une réponse JSON correcte est rendue, avec accept et les en-têtes donnés', async t => {
  /** @type {any} */ let seen;
  stubFetch(t, async (url, init) => { seen = { url, init }; return Response.json({ results: [1, 2] }); });
  const data = await fetchJson('https://api.gbif.org/v1/x', { headers: { 'Api-User-Agent': 'GeoFlora' }, expect: d => Array.isArray(d.results) });
  assert.deepEqual(data, { results: [1, 2] });
  assert.equal(seen.init.headers.accept, 'application/json');
  assert.equal(seen.init.headers['Api-User-Agent'], 'GeoFlora');
  assert.ok(seen.init.signal instanceof AbortSignal, 'toujours un signal : le délai');
});

test('délai dépassé : SourceError « timeout », jamais un « chargement… » sans fin', async t => {
  stubFetch(t, hanging);
  const started = Date.now();
  const error = await fetchJson('https://api.gbif.org/v1/x', { timeout: 60 }).catch(e => e);
  assert.ok(error instanceof SourceError);
  assert.equal(error.kind, 'timeout');
  assert.equal(errorKind(error), 'timeout');
  assert.equal(error.source, 'api.gbif.org');
  assert.ok(isUnavailable(error));
  assert.equal(unavailableReason(error), 'pas de réponse à temps');
  assert.ok(Date.now() - started < 2000);
});

test('le délai couvre aussi la lecture du corps', async t => {
  stubFetch(t, async (_url, init) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"a":'));
      init.signal.addEventListener('abort', () => controller.error(init.signal.reason), { once: true });
    }
  })));
  const error = await fetchJson('https://api.gbif.org/v1/x', { timeout: 60 }).catch(e => e);
  assert.equal(errorKind(error), 'timeout');
});

test('annulé par l’appelant : AbortError (rien à afficher), pas une panne', async t => {
  stubFetch(t, hanging);
  const controller = new AbortController();
  const task = fetchJson('https://api.gbif.org/v1/x', { signal: controller.signal, timeout: 5000 });
  controller.abort();
  const error = await task.catch(e => e);
  assert.equal(error.name, 'AbortError');
  assert.equal(errorKind(error), 'aborted');
  assert.equal(isUnavailable(error), false);
  // Already aborted: not even asked.
  let asked = false;
  stubFetch(t, async () => { asked = true; return Response.json({}); });
  await assert.rejects(fetchJson('https://x.org/', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(asked, false);
});

test('erreur HTTP : SourceError « http » avec son statut', async t => {
  stubFetch(t, async () => new Response('down', { status: 503, statusText: 'Service Unavailable' }));
  const error = await fetchJson('https://api.inaturalist.org/v1/taxa').catch(e => e);
  assert.equal(error.kind, 'http');
  assert.equal(error.status, 503);
  assert.equal(unavailableReason(error), 'erreur 503');
  stubFetch(t, async () => new Response('', { status: 429 }));
  assert.equal(unavailableReason(await fetchJson('https://x.org/').catch(e => e)), 'trop de demandes');
});

test('mauvaise forme : pas du JSON, pas un objet, ou pas la forme attendue → SchemaError', async t => {
  stubFetch(t, async () => new Response('<html>portail captif</html>', { status: 200 }));
  const notJson = await fetchJson('https://api.gbif.org/v1/x').catch(e => e);
  assert.ok(notJson instanceof SchemaError);
  assert.equal(errorKind(notJson), 'schema');
  stubFetch(t, async () => Response.json(42));
  assert.equal(errorKind(await fetchJson('https://x.org/').catch(e => e)), 'schema');
  stubFetch(t, async () => Response.json({ data: [] }));
  const shape = await fetchJson('https://api.gbif.org/v1/x', { expect: d => Array.isArray(d.results) }).catch(e => e);
  assert.equal(shape.kind, 'schema');
  assert.equal(unavailableReason(shape), 'réponse inattendue');
  // A check that throws is a failed check, not a crash.
  assert.equal(errorKind(await fetchJson('https://x.org/', { expect: d => d.a.b.c }).catch(e => e)), 'schema');
});

test('corps vide accepté sur demande (allowEmpty), sinon une erreur de forme', async t => {
  stubFetch(t, async () => new Response('', { status: 200 }));
  assert.equal(await fetchJson('https://x.org/', { allowEmpty: true }), null);
  assert.equal(errorKind(await fetchJson('https://x.org/').catch(e => e)), 'schema');
});

test('hors ligne et réseau en échec : « offline » ou « network »', async t => {
  stubFetch(t, async () => { throw new TypeError('Failed to fetch'); });
  const network = await fetchJson('https://api.gbif.org/v1/x').catch(e => e);
  assert.equal(errorKind(network), 'network');
  assert.equal(unavailableReason(network), 'injoignable');
  setOnline(t, false);
  const offline = await fetchJson('https://api.gbif.org/v1/x').catch(e => e);
  assert.equal(offline.kind, 'offline');
  assert.equal(unavailableReason(offline), 'hors ligne');
});

test('module désactivé : « module-off », distinct d’une source indisponible', () => {
  const error = new ModuleOffError('gbif');
  assert.equal(errorKind(error), 'module-off');
  assert.equal(isUnavailable(error), false);
  assert.equal(isUnavailable(null), false);
});

test('anySignal : interrompu dès que l’un des signaux l’est', () => {
  const a = new AbortController(), b = new AbortController();
  const both = anySignal([a.signal, undefined, b.signal]);
  assert.equal(both.aborted, false);
  b.abort();
  assert.equal(both.aborted, true);
  assert.equal(anySignal([a.signal]), a.signal);
});
