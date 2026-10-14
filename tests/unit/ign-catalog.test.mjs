// IGN's catalogue of map layers: the parser shared by the app and the deploy (lib/ign-catalog.mjs), on a reduced
// GetCapabilities shaped like the service's (bounded « PM_<min>_<max> » sets, other grids, other formats); the copy
// shipped with the app; and the runtime (app/core/ign-catalog.js): the copy on hand at once, a background refresh
// given up only when the download stalls, a failure that never replaces the list, « Réessayer ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ABOUT_MAX, CATALOG_TTL, fetchedAtOf, fileLayers, isStale, layersOf, parseCapabilities, readXml } from '../../lib/ign-catalog.mjs';
import { TAXONOMY_VERSION } from '../../lib/ign-classify.mjs';
import { createCatalog, fetchTextStall } from '../../app/core/ign-catalog.js';

const XML = readFileSync(new URL('../fixtures/ign-capabilities.xml', import.meta.url), 'utf8');
const BUNDLED = JSON.parse(readFileSync(new URL('../../data/ign-catalog.json', import.meta.url), 'utf8'));
const DAY = 24 * 3600 * 1000;

test('parseCapabilities : les couches en Web Mercator (PM et PM_<min>_<max>), PNG ou JPEG, triées par titre', () => {
  const layers = parseCapabilities(XML);
  assert.deepEqual(layers.map(l => l.id), [
    'GEOLOGIE.CARTE', 'GEOGRAPHICALGRIDSYSTEMS.ETATMAJOR40', 'HYDROGRAPHY.BCAE.LATEST', 'FORETS.PUBLIQUES',
    'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW'
  ]);
  const byId = Object.fromEntries(layers.map(l => [l.id, l]));
  // Zooms from the set's limits, else from its name, else the whole grid.
  assert.deepEqual([byId['GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2'].minNative, byId['GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2'].maxNative], [0, 19]);
  assert.deepEqual([byId['FORETS.PUBLIQUES'].minNative, byId['FORETS.PUBLIQUES'].maxNative], [3, 16]);
  assert.deepEqual([byId['GEOGRAPHICALGRIDSYSTEMS.ETATMAJOR40'].minNative, byId['GEOGRAPHICALGRIDSYSTEMS.ETATMAJOR40'].maxNative], [6, 15]);
  assert.deepEqual([byId['GEOLOGIE.CARTE'].minNative, byId['GEOLOGIE.CARTE'].maxNative], [0, 19]);
  // A Lambert-93 set listed first: the Web Mercator one is read.
  assert.deepEqual([byId['HYDROGRAPHY.BCAE.LATEST'].minNative, byId['HYDROGRAPHY.BCAE.LATEST'].maxNative], [10, 18]);
  // Formats: PNG before JPEG; JPEG alone kept.
  assert.equal(byId['ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW'].format, 'image/png');
  assert.equal(byId['GEOGRAPHICALGRIDSYSTEMS.ETATMAJOR40'].format, 'image/jpeg');
  // Styles: the default one, not the first; none listed: « normal ».
  assert.equal(byId['FORETS.PUBLIQUES'].style, 'FORETS PUBLIQUES ONF');
  assert.equal(byId['ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW'].style, 'estompage_grayscale');
  assert.equal(byId['GEOLOGIE.CARTE'].style, 'normal');
  // Entities decoded; a description in CDATA without its markup, whole (up to ABOUT_MAX characters).
  assert.equal(byId['HYDROGRAPHY.BCAE.LATEST'].title, 'Cours d\'eau & plans d\'eau (BCAE)');
  const about = byId['ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW'].about;
  assert.ok(about.length > 240 && about.length <= ABOUT_MAX, `${about.length} caractères`);
  assert.ok(about.startsWith('Estompage multidirectionnel du relief'));
  assert.ok(about.endsWith('massifs montagneux de la France entière.'));
  // The first Plan IGN, not its double.
  assert.equal(byId['GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2'].title, 'Plan IGN');
});

test('parseCapabilities : mots-clés, emprise, légende, fiche de métadonnées, et la place de chaque couche', () => {
  const byId = Object.fromEntries(parseCapabilities(XML).map(l => [l.id, l]));
  const forets = byId['FORETS.PUBLIQUES'];
  // Keywords trimmed, each once; the box rounded to 0.001°; the default style's legend; an https metadata sheet, its
  // entities decoded; no « javascript: » address ever kept.
  assert.deepEqual(forets.kw, ['Forêt', 'ONF', 'Usage des sols']);
  assert.deepEqual(forets.bbox, [-5.141, 41.363, 9.56, 51.089]);
  assert.equal(forets.legend, 'https://data.geopf.fr/annexes/ressources/legendes/FORETS.PUBLIQUES-legend.png');
  assert.equal(forets.meta, 'https://data.geopf.fr/csw?REQUEST=GetRecordById&ID=IGNF_FORETS-PUBLIQUES');
  assert.equal(byId['GEOLOGIE.CARTE'].meta, undefined);
  assert.deepEqual(byId['GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2'].bbox, [-179.9, -85, 179.9, 85]);
  // Classified as it is read (the worker's result is the same as the deploy's).
  assert.deepEqual(Object.fromEntries(Object.values(byId).map(l => [l.id, `${l.cat}/${l.sub}`])), {
    'GEOLOGIE.CARTE': 'sols/geologie',
    'GEOGRAPHICALGRIDSYSTEMS.ETATMAJOR40': 'cartes/historiques',
    'HYDROGRAPHY.BCAE.LATEST': 'eau/cours',
    'FORETS.PUBLIQUES': 'vegetation/forets',
    'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2': 'cartes/plans',
    'ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW': 'relief/ombrages'
  });
  assert.equal(forets.botany, 1);
  assert.equal(forets.source, 'ONF');
});

test('fichier : le format 2 se relit tel quel, le format 1 (sans classement) est classé à la lecture', () => {
  const layers = parseCapabilities(XML);
  const { groups, layers: rows } = fileLayers(layers);
  const v2 = { version: 2, taxonomy: TAXONOMY_VERSION, fetchedAt: '2026-10-01T00:00:00Z', groups, layers: rows };
  assert.deepEqual(layersOf(JSON.parse(JSON.stringify(v2))), layers);
  // Format 1: the same layers without their place, read and classified.
  const v1 = { fetchedAt: '2026-10-01T00:00:00Z', layers: layers.map(({ id, title, about, format, style, minNative, maxNative }) => ({ id, title, about, format, style, minNative, maxNative })) };
  const read = layersOf(v1);
  assert.deepEqual(read.map(l => `${l.id} ${l.cat}/${l.sub}`), layers.map(l => `${l.id} ${l.cat}/${l.sub}`));
  // Another taxonomy, or a place this app does not know: classified again, never trusted.
  const odd = layersOf({ ...v2, layers: rows.map(l => ({ ...l, cat: 'inconnue', sub: 'x' })) });
  assert.ok(odd.every(l => l.cat !== 'inconnue'));
  // An unsafe address, a box out of range: dropped.
  const [bad] = layersOf({ layers: [{ ...rows[0], legend: 'javascript:alert(1)', meta: 'http://x/y', bbox: [0, 0, 200, 10] }] });
  assert.equal(bad.legend, undefined);
  assert.equal(bad.meta, undefined);
  assert.equal(bad.bbox, undefined);
});

test('parseCapabilities : ni autre grille (WGS84G, Lambert-93), ni autre format (BIL), ni identifiant douteux', () => {
  const ids = parseCapabilities(XML).map(l => l.id);
  for (const id of ['ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES', 'ORTHOIMAGERY.ORTHOPHOTOS.5CM.L93']) assert.ok(!ids.includes(id), id);
  assert.ok(ids.every(id => /^[A-Za-z0-9._:-]+$/.test(id)));
  assert.deepEqual(parseCapabilities('<Capabilities><Contents></Contents></Capabilities>'), []);
  assert.deepEqual(parseCapabilities('pas du XML'), []);
});

test('readXml : préfixes retirés, éléments vides, commentaires, CDATA', () => {
  const root = readXml('<a:x k="1"><!-- c --><y/><z><![CDATA[<b>t</b>]]> &amp; u</z></a:x>');
  const x = root.children[0];
  assert.equal(x.name, 'x');
  assert.deepEqual(x.children.map(c => c.name), ['y', 'z']);
  assert.equal(x.children[1].text, '<b>t</b> & u');
});

test('la copie livrée avec l’app se lit, et contient les couches de l’app', () => {
  const layers = layersOf(BUNDLED);
  assert.ok(layers.length >= 50, `${layers.length} couches`);
  assert.equal(layers.length, BUNDLED.layers.length, 'chaque couche est lisible');
  const ids = new Set(layers.map(l => l.id));
  for (const id of ['ORTHOIMAGERY.ORTHOPHOTOS', 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'FORETS.PUBLIQUES', 'Patrinat_PN']) assert.ok(ids.has(id), id);
  assert.ok(Number.isFinite(Date.parse(BUNDLED.fetchedAt)));
  assert.match(BUNDLED.source.sha256, /^[0-9a-f]{64}$/);
});

test('fraîcheur : un mois, une date inconnue, une graine, une horloge en avance', () => {
  const now = Date.parse('2026-10-13T12:00:00Z');
  assert.equal(isStale(now - 10 * DAY, now), false);
  assert.equal(isStale(now - CATALOG_TTL, now), true);
  assert.equal(isStale(0, now), true);
  assert.equal(isStale(now + 3 * DAY, now), true);
  assert.equal(fetchedAtOf({ fetchedAt: '2026-10-01T00:00:00Z' }), Date.parse('2026-10-01T00:00:00Z'));
  assert.equal(fetchedAtOf({ fetchedAt: '2026-10-01T00:00:00Z', seed: true }), 0);
  assert.equal(fetchedAtOf({ fetchedAt: 'n’importe' }), 0);
  assert.deepEqual(layersOf({ layers: [{ id: 'A B', format: 'image/png', title: 't', minNative: 0, maxNative: 1 }, { id: 'OK', format: 'image/x-bil', title: 't', minNative: 0, maxNative: 1 }] }), []);
});

// ── Runtime ──────────────────────────────────────────────────────────────────

/** A body that sends `chunks` one every `gap` ms (then, `hang`: never ends). */
function streamed(text, { chunks = 4, gap = 0, hang = false } = {}) {
  const size = Math.ceil(text.length / chunks);
  let i = 0;
  const encoder = new TextEncoder();
  return new ReadableStream({
    async pull(controller) {
      if (gap) await new Promise(r => setTimeout(r, gap));
      if (i < chunks) { controller.enqueue(encoder.encode(text.slice(i * size, (i + 1) * size))); i++; return; }
      if (hang) return new Promise(() => {});
      controller.close();
    }
  });
}

const bundledFile = (layers, extra = {}) => ({ fetchedAt: '2026-01-01T00:00:00Z', layers, ...extra });
const ONE = { id: 'ONE.LAYER', title: 'Une couche', about: '', format: 'image/png', style: 'normal', minNative: 0, maxNative: 19 };

/** A catalogue over fakes: the bundled file, the service's answer, an in-memory device copy. */
function setup({ bundled = bundledFile([ONE]), answer = () => new Response(XML), on = true, offline = false, now = Date.parse('2026-10-13T12:00:00Z'), tuning } = {}) {
  const kept = { entry: /** @type {any} */ (null) };
  const calls = [];
  const env = { on, offline };
  const catalog = createCatalog({
    bundled: 'bundled.json',
    fetchImpl: /** @type {any} */ (async (url, init) => {
      calls.push(String(url));
      if (url === 'bundled.json') return bundled ? new Response(JSON.stringify(bundled)) : new Response('', { status: 404 });
      return answer(init);
    }),
    parse: parseCapabilities,
    store: { get: async () => kept.entry, put: async ({ fetchedAt, layers }) => { kept.entry = { fetchedAt, value: layers }; } },
    now: () => now, isOn: () => env.on, isOffline: () => env.offline,
    tuning: { stall: 200, total: 10_000, quiet: 60_000, ...tuning }
  });
  return { catalog, kept, calls, env };
}

test('la copie livrée est montrée tout de suite ; vieille, le service est demandé en fond et la liste remplacée', async () => {
  const { catalog, kept } = setup();
  const first = await catalog.load();
  assert.deepEqual(first.layers?.map(l => l.id), ['ONE.LAYER']);
  assert.equal(first.origin, 'bundled');
  assert.equal(first.refreshing, true);
  await catalog.whenRefreshed();
  const after = catalog.state();
  assert.equal(after.layers?.length, 6);
  assert.equal(after.origin, 'device');
  assert.equal(after.problem, null);
  assert.equal(kept.entry.value.length, 6, 'gardée sur l’appareil');
});

test('une copie fraîche n’est pas redemandée ; « Réessayer » la redemande', async () => {
  const now = Date.parse('2026-10-13T12:00:00Z');
  const { catalog, calls } = setup({ bundled: bundledFile([ONE], { fetchedAt: new Date(now - 5 * DAY).toISOString() }), now });
  const s = await catalog.load();
  assert.equal(s.refreshing, false);
  assert.equal(calls.filter(u => u.includes('GetCapabilities')).length, 0);
  await catalog.load({ retry: true });
  await catalog.whenRefreshed();
  assert.equal(calls.filter(u => u.includes('GetCapabilities')).length, 1);
});

test('un téléchargement lent mais continu va au bout ; un téléchargement arrêté échoue sans perdre la liste', async () => {
  // 12 chunks, 60 ms apart (720 ms in all), the stall limit at 200 ms: no total limit cuts it.
  const slow = setup({ answer: () => new Response(streamed(XML, { chunks: 12, gap: 60 })) });
  await slow.catalog.load();
  await slow.catalog.whenRefreshed();
  assert.equal(slow.catalog.state().layers?.length, 6);

  const stuck = setup({ answer: () => new Response(streamed(XML, { chunks: 2, hang: true })) });
  await stuck.catalog.load();
  await stuck.catalog.whenRefreshed();
  const s = stuck.catalog.state();
  assert.equal(s.problem, 'down');
  assert.equal(s.reason, 'pas de réponse à temps');
  assert.deepEqual(s.layers?.map(l => l.id), ['ONE.LAYER'], 'la liste reste');
});

test('après un échec : pas redemandé à chaque ouverture, mais « Réessayer » redemande et réussit', async () => {
  let fail = true;
  const { catalog, calls } = setup({ answer: () => fail ? new Response('', { status: 503 }) : new Response(XML) });
  await catalog.load();
  await catalog.whenRefreshed();
  assert.equal(catalog.state().problem, 'down');
  assert.equal(catalog.state().reason, 'erreur 503');
  await catalog.load();
  assert.equal(calls.filter(u => u.includes('GetCapabilities')).length, 1, 'pas de nouvel appel tout de suite');
  fail = false;
  await catalog.load({ retry: true });
  await catalog.whenRefreshed();
  assert.equal(catalog.state().problem, null);
  assert.equal(catalog.state().layers?.length, 6);
});

test('une réponse sans couche lisible, ou bien plus courte, ne remplace pas la liste', async () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ ...ONE, id: 'L' + i, title: 'Couche ' + i }));
  const { catalog } = setup({ bundled: bundledFile(many), answer: () => new Response(XML) });
  await catalog.load();
  await catalog.whenRefreshed();
  assert.equal(catalog.state().layers?.length, 20);
  assert.equal(catalog.state().problem, 'down');
  assert.equal(catalog.state().reason, 'réponse inattendue');
});

test('hors ligne : la copie livrée, sans appel ; module coupé : la copie, sans appel', async () => {
  const off = setup({ offline: true });
  const s = await off.catalog.load();
  assert.equal(s.problem, 'offline');
  assert.equal(s.layers?.length, 1);
  assert.equal(off.calls.filter(u => u.includes('GetCapabilities')).length, 0);

  const moduleOff = setup({ on: false });
  const m = await moduleOff.catalog.load({ retry: true });
  assert.equal(m.problem, 'module-off');
  assert.equal(m.layers?.length, 1);
  assert.equal(moduleOff.calls.filter(u => u.includes('GetCapabilities')).length, 0);
});

test('sans copie livrée (fichier absent) : la copie de l’appareil, ou le service', async () => {
  const { catalog, kept } = setup({ bundled: null });
  kept.entry = { fetchedAt: Date.parse('2026-10-10T00:00:00Z'), value: [ONE] };
  const s = await catalog.load();
  assert.equal(s.origin, 'device');
  assert.equal(s.layers?.length, 1);
  assert.equal(s.refreshing, false, 'fraîche : pas redemandée');

  const none = setup({ bundled: null });
  const n = await none.catalog.load();
  assert.equal(n.layers, null);
  assert.equal(n.refreshing, true);
  await none.catalog.whenRefreshed();
  assert.equal(none.catalog.state().layers?.length, 6);
});

test('fetchTextStall : statut HTTP, coupure réseau, hors ligne', async () => {
  const limits = { stall: 200, total: 5000 };
  await assert.rejects(fetchTextStall(/** @type {any} */ (async () => new Response('', { status: 502 })), 'u', limits, () => false), e => e.kind === 'http' && e.status === 502);
  await assert.rejects(fetchTextStall(/** @type {any} */ (async () => { throw new TypeError('Failed to fetch'); }), 'u', limits, () => false), e => e.kind === 'network');
  await assert.rejects(fetchTextStall(/** @type {any} */ (async () => { throw new TypeError('Failed to fetch'); }), 'u', limits, () => true), e => e.kind === 'offline');
  // No answer at all (headers never come): the stall limit too.
  await assert.rejects(fetchTextStall(/** @type {any} */ (() => new Promise(() => {})), 'u', limits, () => false), e => e.kind === 'timeout');
  assert.equal(await fetchTextStall(/** @type {any} */ (async () => new Response(streamed('abcdef', { chunks: 3 }))), 'u', limits, () => false), 'abcdef');
});
