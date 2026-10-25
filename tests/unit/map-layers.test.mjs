// app/core/map-layers.js: the IGN layers the maps offer over their background — the app's overlays, « Noms et
// réseaux », the catalogue's layers of the panel's themes (and those a free layout's layers= adds,
// layout/map-options.js) —, each as the Géoplateforme's catalogue gives it (data/ign-catalog.json: identifier, format,
// style, native zooms); « Noms et réseaux » PNG, never an overlay too; every key once; the tools' list, each once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATALOG_ROWS, LANDMARKS, LANDMARK_DEFAULTS, OVERLAYS, PANEL, cleanLandmarks, everyAppLayer } from '../../app/core/map-layers.js';
import { MAP_LAYERS } from '../../app/layout/map-options.js';
import { everyBaseLayer } from '../../app/core/backgrounds.js';

const catalog = JSON.parse(readFileSync(new URL('../../data/ign-catalog.json', import.meta.url), 'utf8'));
/** @type {Map<string, any>} */
const byId = new Map(catalog.layers.map((/** @type {any} */ l) => [l.id, l]));

/** A layer as the catalogue gives it (core/ign-layers.js wmtsUrl: no style is « normal »; core/ign.js wmts: no zooms are 0 and 19). @param {string} what @param {any} l */
function asCatalogued(what, l) {
  const c = byId.get(l.id);
  assert.ok(c, `${what} : ${l.id} au catalogue`);
  assert.equal(l.format, c.format, `${what} : format de ${l.id}`);
  assert.equal(l.style ?? 'normal', c.style, `${what} : style de ${l.id}`);
  assert.equal(l.minNative ?? 0, c.minNative, `${what} : premier zoom de ${l.id}`);
  assert.equal(l.maxNative ?? 19, c.maxNative, `${what} : dernier zoom de ${l.id}`);
}

test('chaque couche des cartes telle que le catalogue de l’IGN la donne : surcouches, noms et réseaux, couches des thèmes, celles de layers=', () => {
  for (const [key, def] of Object.entries(OVERLAYS)) for (const l of def.layers) asCatalogued(key, l);
  for (const m of LANDMARKS) asCatalogued(m.key, m.layer);
  for (const [key, row] of Object.entries(CATALOG_ROWS)) asCatalogued(key, row);
  for (const [name, l] of Object.entries(MAP_LAYERS)) for (const c of l.catalog ?? []) asCatalogued('layers=' + name, c);
  // What core/ign-layers.js addCatalogLayer reads of them: a name, a known format.
  for (const row of Object.values(CATALOG_ROWS)) {
    assert.ok(row.title.length > 2, row.id);
    assert.match(row.format, /^image\/(png|jpeg)$/);
  }
});

test('noms et réseaux : six couches PNG, du bas vers le haut, jamais aussi une surcouche ; par défaut routes, cours d’eau, noms de lieux', () => {
  assert.deepEqual(LANDMARKS.map(m => m.key), ['limites', 'bati', 'rail', 'routes', 'eau', 'lieux']);
  assert.deepEqual(LANDMARKS.map(m => m.layer.id), [
    'LIMITES_ADMINISTRATIVES_EXPRESS.LATEST', 'BUILDINGS.BUILDINGS', 'TRANSPORTNETWORKS.RAILWAYS',
    'TRANSPORTNETWORKS.ROADS', 'HYDROGRAPHY.HYDROGRAPHY', 'GEOGRAPHICALNAMES.NAMES'
  ]);
  for (const m of LANDMARKS) {
    // Laid over the pictures: see-through.
    assert.equal(m.layer.format, 'image/png', m.key);
    assert.ok(m.label, m.key);
    assert.ok(Object.isFrozen(m) && Object.isFrozen(m.layer), m.key);
  }
  assert.ok(Object.isFrozen(LANDMARKS) && Object.isFrozen(LANDMARK_DEFAULTS));
  // Never one of the overlays (the app's, the panel's), nor one's key: drawn apart, over all of them.
  const overlayIds = new Set([...Object.values(OVERLAYS).flatMap(o => o.layers.map(l => l.id)), ...Object.values(CATALOG_ROWS).map(r => r.id)]);
  for (const m of LANDMARKS) {
    assert.ok(!overlayIds.has(m.layer.id), m.layer.id);
    assert.ok(!Object.hasOwn(OVERLAYS, m.key) && !Object.hasOwn(CATALOG_ROWS, m.key), m.key);
  }
  // The usual ones: the look of before (the roads, the rivers, the names), in their order.
  assert.deepEqual(LANDMARK_DEFAULTS, ['routes', 'eau', 'lieux']);
  // Chosen: only theirs, each once, bottom first — from anything.
  assert.deepEqual(cleanLandmarks(['lieux', 'rail', 'lune', 'lieux', 'limites']), ['limites', 'rail', 'lieux']);
  for (const v of [null, undefined, 'routes', { routes: true }, 3]) assert.deepEqual(cleanLandmarks(v), [], String(v));
  assert.deepEqual(cleanLandmarks(['constructor', 'toString', 7]), []);
});

test('les thèmes du panneau ▦ : chaque ligne une surcouche ou une couche du catalogue, une seule fois ; les clés jamais deux fois', () => {
  assert.deepEqual(PANEL.map(g => g.title), ['Relief', 'Forêts, haies et zones humides', 'Espaces protégés et propriété']);
  const rows = PANEL.flatMap(g => g.parts.flatMap(p => p.rows));
  assert.equal(new Set(rows).size, rows.length, 'une ligne une fois');
  for (const key of rows) assert.ok(Object.hasOwn(OVERLAYS, key) !== Object.hasOwn(CATALOG_ROWS, key), key);
  // Every overlay and every catalogue row offered somewhere.
  assert.deepEqual([...rows].sort(), [...Object.keys(OVERLAYS), ...Object.keys(CATALOG_ROWS)].sort());
  // Keys of different kinds never the same (a group's, a row's, a landmark's).
  const keys = [...PANEL.map(g => g.key), ...Object.keys(OVERLAYS), ...Object.keys(CATALOG_ROWS), ...LANDMARKS.map(m => m.key)];
  assert.equal(new Set(keys).size, keys.length);
  // A catalogue row's layer never the app's overlay too (the catalogue's list toggles that one: core/ign-layers.js builtinKeyOf).
  const own = new Set(Object.values(OVERLAYS).flatMap(o => o.layers.map(l => l.id)));
  for (const row of Object.values(CATALOG_ROWS)) assert.ok(!own.has(row.id), row.id);
  assert.deepEqual(PANEL.at(-1)?.parts.map(p => p.title), ['Protection réglementaire', 'Gestion contractuelle', 'Inventaires', 'Propriété']);
  // The shading: see-through when first ticked.
  assert.equal(CATALOG_ROWS.ombrage.opacity, 0.4);
});

test('les couches que vérifient les outils (tools/api-health.mjs, scripts/build-ign-catalog.mjs) : toutes, une fois chacune, au catalogue', () => {
  const ids = everyAppLayer().map(l => l.id);
  assert.equal(new Set(ids).size, ids.length);
  const wanted = new Set([
    ...Object.values(OVERLAYS).flatMap(o => o.layers.map(l => l.id)), ...LANDMARKS.map(m => m.layer.id), ...Object.values(CATALOG_ROWS).map(r => r.id),
    ...Object.values(MAP_LAYERS).flatMap(l => (l.catalog ?? []).map(c => c.id))
  ]);
  assert.deepEqual([...ids].sort(), [...wanted].sort());
  // With the backgrounds': never one twice.
  const all = [...ids, ...everyBaseLayer().map(l => l.id)];
  assert.equal(new Set(all).size, all.length);
  assert.ok(all.every(id => byId.has(id)));
});
