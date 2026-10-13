// app/core/gl-style.js: the 3D maps' style made from what the 2D map shows — each IGN layer at the same zooms, the
// cache-only tiles with the module off, the relief, its shading, the buildings, the vector plan, the sky, the globe,
// the sun's light, and the 2D map's lines and areas styled as map.css styles them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASES, OVERLAYS, wmtsUrl } from '../../app/core/ign.js';
import { MAP_DEFAULTS } from '../../app/core/map-settings.js';
import {
  BUILDINGS_LAYER, BUILDING_HEIGHT, CACHE_PROTOCOL, DEM_TILES, IGN_VECTOR_TILES, buildStyle, circlePolygon, describeTileLayer,
  lightFor, mergeVectorStyle, pathStyle, skyFor, tileUrl
} from '../../app/core/gl-style.js';

/**
 * A Leaflet tile layer as core/ign.js makes it (its URL template, its options), for one WMTS layer of a definition.
 * @param {string} key @param {any} def @param {boolean} base @param {number} [minZoom]
 */
const leafletLike = (key, def, base, minZoom = 5) => ({
  _url: wmtsUrl(def),
  options: { minNativeZoom: def.minNative ?? 0, maxNativeZoom: def.maxNative ?? 19, minZoom: Math.max(minZoom, def.minNative ?? minZoom), maxZoom: 21,
    opacity: base ? 1 : 0.8, className: 'gf-tiles-' + key, attribution: '© IGN' }
});

const settings = (/** @type {any} */ o = {}) => ({ ...MAP_DEFAULTS, renderer: '3d', ...o });
/** @param {any[]} specs @param {any} [o] */
const style = (specs, o = {}) => buildStyle({ tiles: specs, settings: settings(o.settings), terrain: o.terrain ?? true, cacheOnly: o.cacheOnly ?? false, buildings: o.buildings ?? false, vector: o.vector ?? null, sun: o.sun ?? null, paths: o.paths });

test('chaque fond et chaque surcouche IGN : une source raster aux mêmes zooms que la carte 2D', () => {
  const all = [
    ...Object.entries(BASES).map(([k, d]) => [k, d, true]),
    ...Object.entries(OVERLAYS).map(([k, d]) => [k, d, false])
  ];
  let i = 0;
  for (const [key, def, base] of all) {
    for (const layer of /** @type {any} */ (def).layers) {
      const spec = describeTileLayer(leafletLike(/** @type {string} */ (key), layer, /** @type {boolean} */ (base)), i++);
      assert.ok(spec, key + ' décrit');
      assert.equal(spec.key, key);
      assert.equal(spec.base, base, key + ' : fond ou surcouche');
      assert.equal(spec.url, wmtsUrl(layer), 'la même adresse WMTS (TILEMATRIXSET=PM, {z}/{x}/{y})');
      assert.match(spec.url, /TILEMATRIX=\{z\}&TILEROW=\{y\}&TILECOL=\{x\}/);
      assert.equal(spec.nativeMin, layer.minNative ?? 0, key + ' : zoom natif minimal');
      assert.equal(spec.nativeMax, layer.maxNative ?? 19, key + ' : zoom natif maximal');
      // MapLibre's zoom is Leaflet's minus one (512 px world): the contours from Leaflet's 6 show from its 5.
      assert.equal(spec.minzoom, Math.max(5, layer.minNative ?? 5) - 1);
      assert.equal(spec.opacity, base ? 1 : 0.8);
    }
  }
  // A layer of IGN's catalogue (gf-tiles-ign:…) and GBIF's distribution (no class of a key) too.
  const catalog = describeTileLayer({ _url: wmtsUrl({ id: 'GEOLOGIE', format: 'image/png' }), options: { className: 'gf-tiles-ign:GEOLOGIE', opacity: 0.8 } }, 7);
  assert.equal(catalog?.key, 'ign:GEOLOGIE');
  const gbif = describeTileLayer({ _url: 'https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}@1x.png?taxonKey=1', options: { className: 'gf-tiles-gbif', opacity: 0.85, maxNativeZoom: 16 } }, 8);
  assert.equal(gbif?.key, 'gbif');
  assert.equal(gbif?.nativeMax, 16);
  // Not a web address (a layer of the tests, a data: URL): not drawn.
  assert.equal(describeTileLayer({ _url: 'data:image/png;base64,AAA', options: {} }, 9), null);
  assert.equal(describeTileLayer(/** @type {any} */ ({}), 9), null);
});

test('le style : fond, surcouches dans l’ordre, tuiles de 256 px, ombrage juste au-dessus du fond', () => {
  const photo = describeTileLayer(leafletLike('photo', BASES.photo.layers[0], true), 0);
  const cad = describeTileLayer(leafletLike('cadastre', OVERLAYS.cadastre.layers[0], false), 1);
  const s = style([photo, cad]);
  assert.equal(s.version, 8);
  const ids = s.layers.map((/** @type {any} */ l) => l.id);
  assert.deepEqual(ids.slice(0, 4), ['gf-ground', photo?.id, 'gf-hillshade', cad?.id]);
  assert.equal(s.sources[/** @type {string} */ (photo?.id)].tileSize, 256);
  assert.equal(s.sources[/** @type {string} */ (cad?.id)].maxzoom, 19);
  const cadLayer = s.layers.find((/** @type {any} */ l) => l.id === cad?.id);
  assert.equal(cadLayer.paint['raster-opacity'], 0.8);
  assert.equal(cadLayer.metadata['gf:key'], 'cadastre');
  // The relief: two sources of the AWS Terrarium tiles, the terrain at the exaggeration chosen.
  assert.deepEqual(s.sources['gf-dem'].tiles, [DEM_TILES]);
  assert.equal(s.sources['gf-dem'].encoding, 'terrarium');
  assert.deepEqual(s.terrain, { source: 'gf-dem', exaggeration: MAP_DEFAULTS.exaggeration });
  assert.equal(s.sources['gf-shade'].type, 'raster-dem');
  // The lines and areas last, over everything.
  assert.deepEqual(ids.slice(-3), ['gf-paths-fill', 'gf-paths-line', 'gf-paths-dash']);
});

test('les modules et les options : relief, ombrage, ciel, globe, cache seul', () => {
  const photo = describeTileLayer(leafletLike('photo', BASES.photo.layers[0], true), 0);
  const flat = style([photo], { terrain: false });
  assert.equal(flat.terrain, undefined, 'pas de relief : aucune tuile de relief demandée');
  assert.ok(!('gf-dem' in flat.sources) && !('gf-shade' in flat.sources));
  assert.ok(!flat.layers.some((/** @type {any} */ l) => l.type === 'hillshade'));
  const noShade = style([photo], { settings: { hillshade: false } });
  assert.ok(noShade.terrain && !('gf-shade' in noShade.sources));
  assert.ok(style([photo]).sky, 'ciel et brume par défaut');
  assert.equal(style([photo], { settings: { sky: false } }).sky, undefined);
  assert.equal(style([photo]).projection, undefined);
  assert.deepEqual(style([photo], { settings: { globe: true } }).projection, { type: 'globe' });
  assert.equal(style([photo], { settings: { exaggeration: 2.5 } }).terrain.exaggeration, 2.5);
  // « IGN – fonds de carte » off: the IGN's tiles from the cache only (never the network); GBIF's as they are.
  const cached = style([photo], { cacheOnly: true });
  assert.equal(cached.sources[/** @type {string} */ (photo?.id)].tiles[0], `${CACHE_PROTOCOL}://${photo?.url}`);
  assert.equal(tileUrl('https://api.gbif.org/v2/map/x/{z}/{x}/{y}.png', true), 'https://api.gbif.org/v2/map/x/{z}/{x}/{y}.png');
  // Without a background (none on the map): the relief's shading alone, at full strength.
  const bare = style([]);
  const shade = bare.layers.find((/** @type {any} */ l) => l.type === 'hillshade');
  assert.equal(shade.paint['hillshade-exaggeration'], 0.55);
});

test('bâtiments 3D : les surfaces bâties du PLAN IGN, extrudées à leur hauteur', () => {
  const s = style([], { buildings: true });
  const b = s.layers.find((/** @type {any} */ l) => l.id === 'gf-buildings');
  assert.equal(b.type, 'fill-extrusion');
  assert.equal(b['source-layer'], BUILDINGS_LAYER);
  assert.equal(b.minzoom, 14);
  assert.deepEqual(s.sources['gf-bati'].tiles, [IGN_VECTOR_TILES]);
  assert.deepEqual(b.paint['fill-extrusion-height'], BUILDING_HEIGHT);
  assert.ok(!style([]).layers.some((/** @type {any} */ l) => l.id === 'gf-buildings'), 'option coupée : pas de bâtiments');
  // The style's own source of the plan, when known, for the buildings.
  const planSource = { type: 'vector', url: 'https://data.geopf.fr/tms/1.0.0/PLAN.IGN/metadata.json' };
  assert.deepEqual(buildStyle({ tiles: [], settings: settings(), terrain: false, cacheOnly: false, buildings: true, planSource }).sources['gf-bati'], planSource);
});

test('plan IGN vectoriel : le style de la Géoplateforme fusionné, ses identifiants renommés, à la place du plan raster', () => {
  const ign = {
    version: 8, glyphs: 'https://data.geopf.fr/annexes/ressources/vectorTiles/fonts/{fontstack}/{range}.pbf', sprite: 'https://data.geopf.fr/x/sprite',
    sources: { plan_ign: { type: 'vector', tiles: [IGN_VECTOR_TILES] } },
    layers: [{ id: 'background', type: 'background' }, { id: 'routes', type: 'line', source: 'plan_ign', 'source-layer': 'routier_route' }, { id: 'orphan', type: 'line', source: 'nowhere' }]
  };
  const v = mergeVectorStyle(ign);
  assert.ok(v);
  assert.deepEqual(Object.keys(v.sources), ['ign-v:plan_ign']);
  assert.deepEqual(v.layers.map((/** @type {any} */ l) => l.id), ['ign-v:routes'], 'ni son fond, ni une couche sans source');
  assert.equal(v.layers[0].source, 'ign-v:plan_ign');
  assert.deepEqual(v.planSource, ign.sources.plan_ign);
  const plan = describeTileLayer(leafletLike('plan', BASES.plan.layers[0], true), 0);
  const s = style([plan], { vector: v });
  assert.ok(!(/** @type {string} */ (plan?.id) in s.sources), 'le plan raster remplacé');
  assert.ok(s.layers.some((/** @type {any} */ l) => l.id === 'ign-v:routes'));
  assert.equal(s.glyphs, ign.glyphs);
  assert.equal(s.sprite, ign.sprite);
  // With the photos as background, the vector style is not used.
  const photo = describeTileLayer(leafletLike('photo', BASES.photo.layers[0], true), 0);
  const p = style([photo], { vector: v });
  assert.equal(p.glyphs, undefined);
  assert.ok(!p.layers.some((/** @type {any} */ l) => l.id.startsWith('ign-v:')));
  assert.equal(mergeVectorStyle(null), null);
  assert.equal(mergeVectorStyle({ sources: {} }), null);
});

test('la lumière et le ciel suivent le soleil ; la nuit, le fond s’assombrit', () => {
  assert.deepEqual(lightFor(null).position, [1.15, 315, 45]);
  const evening = lightFor({ azimuth: 290, altitude: 5 });
  assert.deepEqual(evening.position, [1.15, 290, 85]);
  assert.equal(evening.color, '#ffd1a1');
  assert.equal(skyFor({ altitude: 40 })['sky-color'], '#79aee0');
  assert.equal(skyFor({ altitude: 2 })['horizon-color'], '#f6b67a');
  assert.equal(skyFor({ altitude: -10 })['sky-color'], '#0e1a33');
  const photo = describeTileLayer(leafletLike('photo', BASES.photo.layers[0], true), 0);
  const night = style([photo], { sun: { azimuth: 0, altitude: -20 } });
  assert.equal(night.layers.find((/** @type {any} */ l) => l.id === photo?.id).paint['raster-brightness-max'], 0.55);
  assert.equal(night.layers.find((/** @type {any} */ l) => l.type === 'hillshade').paint['hillshade-illumination-direction'], 0);
});

test('les traits et surfaces de la carte 2D, comme map.css les dessine', () => {
  assert.deepEqual(pathStyle('gf-area', {}), { color: '#a3e68a', weight: 3, opacity: 1, blur: 0, fill: false, fillColor: '#3388ff', fillOpacity: 0.2, dashed: false, hidden: false });
  assert.equal(pathStyle('gf-area gf-area-glow', {}).weight, 3.5);
  assert.equal(pathStyle('gf-zone gf-zone-line', {}).weight, 2.5);
  assert.equal(pathStyle('gf-zone gf-zone-fill', {}).hidden, true, 'la surface d’un contour n’est pas montrée, en 2D non plus');
  assert.equal(pathStyle('gf-perim-shadow', {}).color, '#000000');
  assert.equal(pathStyle('gf-spread-thread', {}).opacity, 0.55);
  // No class: the options (my position's accuracy).
  const me = pathStyle('', { color: '#2563eb', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.15, fill: true });
  assert.deepEqual([me.color, me.weight, me.fill, me.fillColor, me.fillOpacity], ['#2563eb', 1, true, '#3b82f6', 0.15]);
  // A circle of 1 km: closed, every vertex about 1 km from its centre.
  const ring = circlePolygon([3.08, 45.78], 1000, 48);
  assert.equal(ring.length, 49);
  assert.deepEqual(ring[0], ring[48]);
  for (const [lon, lat] of ring) {
    const dx = (lon - 3.08) * 111320 * Math.cos(45.78 * Math.PI / 180), dy = (lat - 45.78) * 110570;
    assert.ok(Math.abs(Math.hypot(dx, dy) - 1000) < 15, 'à 1 km du centre');
  }
  const paths = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: pathStyle('gf-area', {}), geometry: { type: 'Polygon', coordinates: [ring] } }] };
  assert.equal(style([], { paths }).sources['gf-paths'].data, paths);
});
