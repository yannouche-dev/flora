// app/core/gl-style.js: the 3D maps' style made from what the 2D map shows — each IGN layer at the same zooms (every
// background: the photos of a year over the most recent ones greyed, SPOT's), the cache-only tiles with the module off, the relief, its shading, the buildings, the vector plan, the sky, the globe,
// the sun's light, and the 2D map's lines and areas styled as map.css styles them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OVERLAYS, tileLayer, wmtsUrl } from '../../app/core/ign.js';
import { PHOTO_HISTORIC, PHOTO_PERIODS, PHOTO_YEARS, SPOT_YEARS, baseLayers } from '../../app/core/backgrounds.js';
import { MAP_DEFAULTS } from '../../app/core/map-settings.js';
import {
  BUILDINGS_LAYER, BUILDING_HEIGHT, CACHE_PROTOCOL, DEM_TILES, IGN_VECTOR_TILES, buildStyle, circlePolygon, describeTileLayer,
  lightFor, mergeVectorStyle, pathStyle, skyFor, tileUrl
} from '../../app/core/gl-style.js';

/**
 * A Leaflet tile layer as core/ign.js makes it (its URL template, its options), for one WMTS layer of a definition: a
 * background's from one zoom before its first native one, an overlay's from its first.
 * @param {string} key @param {any} def @param {boolean} base @param {number} [minZoom]
 */
const leafletLike = (key, def, base, minZoom = 5) => ({
  _url: wmtsUrl(def),
  options: { minNativeZoom: def.minNative ?? 0, maxNativeZoom: def.maxNative ?? 19, minZoom: Math.max(minZoom, (def.minNative ?? minZoom) - (base ? 1 : 0)), maxZoom: 21,
    opacity: base ? 1 : 0.8, className: 'gf-tiles-' + key + (def.grey ? ' gf-grey' : ''), attribution: '© IGN' }
});

/** The backgrounds' layers (core/backgrounds.js) by their key, as core/ign.js draws them. */
const BASES = Object.fromEntries(['plan', 'photo', ...[...PHOTO_YEARS, ...PHOTO_PERIODS, ...PHOTO_HISTORIC].map(w => 'photo:' + w), ...SPOT_YEARS.map(y => 'spot:' + y)]
  .map(k => [k, { layers: baseLayers(k) }]));

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
      assert.equal(spec.grey, Boolean(layer.grey), key + ' : en gris seulement les photos sous celles d’une année');
      assert.equal(spec.url, wmtsUrl(layer), 'la même adresse WMTS (TILEMATRIXSET=PM, {z}/{x}/{y})');
      assert.match(spec.url, /TILEMATRIX=\{z\}&TILEROW=\{y\}&TILECOL=\{x\}/);
      assert.equal(spec.nativeMin, layer.minNative ?? 0, key + ' : zoom natif minimal');
      assert.equal(spec.nativeMax, layer.maxNative ?? 19, key + ' : zoom natif maximal');
      // MapLibre's zoom is Leaflet's minus one (512 px world): the contours from Leaflet's 6 show from its 5; a background
      // from one zoom before its first native one.
      assert.equal(spec.minzoom, Math.max(5, (layer.minNative ?? 5) - (base ? 1 : 0)) - 1);
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

test('le fond d’une année : ses photos sur les plus récentes en gris, l’ombrage une seule fois au-dessus ; les historiques ; SPOT', () => {
  const key = 'photo:2016-2020';
  const [grey, year] = baseLayers(key).map((l, i) => /** @type {any} */ (describeTileLayer(leafletLike(key, l, true), i)));
  const cad = /** @type {any} */ (describeTileLayer(leafletLike('cadastre', OVERLAYS.cadastre.layers[0], false), 2));
  assert.deepEqual([grey.base, grey.grey, year.base, year.grey], [true, true, true, false]);
  const s = style([grey, year, cad]);
  const ids = s.layers.map((/** @type {any} */ l) => l.id);
  assert.deepEqual(ids.slice(0, 5), ['gf-ground', grey.id, year.id, 'gf-hillshade', cad.id], 'l’ombrage après la dernière couche du fond, sous les surcouches');
  assert.equal(ids.filter((/** @type {string} */ id) => id === 'gf-hillshade').length, 1, 'un seul ombrage (MapLibre refuse deux couches du même nom)');
  const layer = (/** @type {string} */ id) => s.layers.find((/** @type {any} */ l) => l.id === id);
  // The most recent photos without their colours, pale (never mistaken for black and white historical photos): as map.css.
  const paint = layer(grey.id).paint;
  assert.deepEqual([paint['raster-saturation'], paint['raster-contrast'], paint['raster-brightness-min']], [-1, -0.4, 0.25], 'les photos les plus récentes en gris pâle');
  assert.ok(!('raster-saturation' in layer(year.id).paint) && !('raster-contrast' in layer(year.id).paint) && !('raster-brightness-min' in layer(year.id).paint));
  const css = readFileSync(new URL('../../app/styles/map.css', import.meta.url), 'utf8');
  assert.match(css, /gf-map \.gf-grey \{ filter: grayscale\(1\) contrast\(0\.36\) brightness\(1\.25\); \}/, 'en 2D : 0,4 à 0,85, comme en 3D');
  assert.equal(layer(year.id).metadata['gf:key'], key);
  assert.match(s.sources[year.id].tiles[0], /LAYER=ORTHOIMAGERY\.ORTHOPHOTOS2016-2020&STYLE=normal&FORMAT=image%2Fjpeg$/);
  assert.match(s.sources[grey.id].tiles[0], /LAYER=ORTHOIMAGERY\.ORTHOPHOTOS&/);
  assert.deepEqual([s.sources[year.id].minzoom, s.sources[year.id].maxzoom, layer(year.id).minzoom], [6, 19, 4]);
  // The night dims both.
  const night = style([grey, year], { sun: { azimuth: 0, altitude: -20 } });
  for (const id of [grey.id, year.id]) assert.equal(night.layers.find((/** @type {any} */ l) => l.id === id).paint['raster-brightness-max'], 0.55);
  // Historical photos: PNG, their own style.
  const old = /** @type {any} */ (describeTileLayer(leafletLike('photo:1950-1965', baseLayers('photo:1950-1965')[1], true), 1));
  assert.match(old.url, /LAYER=ORTHOIMAGERY\.ORTHOPHOTOS\.1950-1965&STYLE=BDORTHOHISTORIQUE&FORMAT=image%2Fpng$/);
  // SPOT: one layer, to its zoom 17, no grey under it.
  const spot = baseLayers('spot:2020').map((l, i) => /** @type {any} */ (describeTileLayer(leafletLike('spot:2020', l, true), i)));
  assert.equal(spot.length, 1);
  const sp = style(spot);
  assert.match(sp.sources[spot[0].id].tiles[0], /LAYER=ORTHOIMAGERY\.ORTHO-SAT\.SPOT\.2020&/);
  assert.deepEqual([spot[0].base, spot[0].grey, sp.sources[spot[0].id].maxzoom], [true, false, 17]);
  assert.deepEqual(sp.layers.map((/** @type {any} */ l) => l.id).slice(0, 3), ['gf-ground', spot[0].id, 'gf-hillshade']);
  // Not a background (a key no version has): an overlay.
  assert.equal(describeTileLayer({ _url: wmtsUrl({ id: 'X', format: 'image/png' }), options: { className: 'gf-tiles-photo:1999' } }, 0)?.base, false);
});

test('core/ign.js : les photos d’une année dès un zoom avant leur premier (la France entière au zoom 5, leurs tuiles réduites) ; une surcouche dès le sien', () => {
  const group = /** @type {any} */ (tileLayer('photo:2016-2020', 5));
  const [grey, year] = group.getLayers();
  assert.deepEqual([grey.options.minZoom, grey.options.className], [5, 'gf-tiles-photo:2016-2020 gf-grey']);
  assert.deepEqual([year.options.minZoom, year.options.minNativeZoom, year.options.maxNativeZoom], [5, 6, 19], 'au zoom 5, ses tuiles du zoom 6');
  assert.match(year._url, /LAYER=ORTHOIMAGERY\.ORTHOPHOTOS2016-2020&/);
  // In 3D: from MapLibre's zoom 4 (Leaflet's 5), its source from its first native zoom.
  const spec = /** @type {any} */ (describeTileLayer(year, 1));
  assert.deepEqual([spec.minzoom, spec.nativeMin], [4, 6]);
  // One zoom only: a map going further out (min-zoom 1) shows them from 5 too; those from zoom 0 or 3, from the map's or 2.
  assert.equal(/** @type {any} */ (tileLayer('photo:2020', 1)).getLayers()[1].options.minZoom, 5);
  assert.equal(/** @type {any} */ (tileLayer('photo:2015', 1)).getLayers()[1].options.minZoom, 1);
  assert.equal(/** @type {any} */ (tileLayer('photo:1965-1980', 1)).getLayers()[1].options.minZoom, 2);
  assert.equal(/** @type {any} */ (tileLayer('spot:2020', 5)).options.minZoom, 5);
  // An overlay from its own first zoom (an underzoomed one would ask too many tiles): the contours from 6.
  assert.equal(OVERLAYS.contours.layers[0].minNative, 6);
  assert.equal(/** @type {any} */ (tileLayer('contours', 5)).options.minZoom, 6);
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
