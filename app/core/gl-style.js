// @ts-check
// The 3D maps' style (MapLibre GL, app/components/gf-map-gl.js), made from what the 2D map shows: pure functions, no
// DOM, no MapLibre — unit-tested (tests/unit/gl-style.test.mjs).
//  - each tile layer of the Leaflet map (IGN backgrounds and overlays, the catalogue's layers, GBIF's distribution) as
//    a raster source and layer, in the same order, at the same zooms (MapLibre's zoom is Leaflet's minus one: its
//    world is 512 px wide at zoom 0, Leaflet's 256); the most recent photos under a year's (core/backgrounds.js)
//    greyed and pale, as in 2D;
//  - the « IGN – fonds de carte » module off: tiles from the device's cache only (the gfcache:// protocol), never the
//    network;
//  - the relief (AWS Terrain Tiles, Terrarium) and its shading, the IGN buildings extruded (PLAN.IGN vector tiles), the
//    IGN plan as vector tiles (the Géoplateforme's own style, merged in), the sky, the globe, the sun's light;
//  - the lines and areas of the 2D map (the « Autour » circle, an outline, the threads of a group spread, the accuracy
//    of my position) as one GeoJSON source, styled like map.css styles them in 2D.

import { isBaseKey } from './backgrounds.js';

/** AWS Terrain Tiles (Mapzen), Terrarium encoding, keyless, CORS: z12 already holds EU-DEM (25 m) over France. */
export const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const DEM_MAX = 12;
export const DEM_ATTRIBUTION = 'Relief : <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain Tiles</a> (Mapzen · EU-DEM © Copernicus)';

/** The Géoplateforme's vector « Plan IGN »: its style (sources, layers, glyphs, sprite) and its tiles (TMS, PBF). */
export const IGN_VECTOR_STYLE = 'https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/standard.json';
export const IGN_VECTOR_TILES = 'https://data.geopf.fr/tms/1.0.0/PLAN.IGN/{z}/{x}/{y}.pbf';
/** The building footprints of PLAN.IGN (from the BD TOPO), with their height (m) when known. */
export const BUILDINGS_LAYER = 'bati_surf';

/** Tiles read from the device's cache only (module « IGN – fonds de carte » off): gfcache://https://… */
export const CACHE_PROTOCOL = 'gfcache';

/** Our own ids: never clash with the vector style's. */
const ID = 'gf-';

/**
 * The most recent photos under a year's, as map.css draws them in 2D (grayscale(1) contrast(0.36) brightness(1.25):
 * from black and white to 0.4 and 0.85): without their colours, their contrast lowered, lifted.
 */
const FILLER = { 'raster-saturation': -1, 'raster-contrast': -0.4, 'raster-brightness-min': 0.25 };

/**
 * A tile layer of the 2D map, as MapLibre needs it. `grey`: without its colours (the most recent photos under a year's).
 * @typedef {{ id: string, url: string, opacity: number, minzoom: number, maxzoom: number, nativeMin: number, nativeMax: number, base: boolean, grey: boolean, key: string, attribution?: string }} TileSpec
 */

/**
 * A Leaflet tile layer described (its URL template and options; a plain object in the tests).
 * @param {{ _url?: string, options?: Record<string, any> }} layer @param {number} index its place (bottom first)
 * @returns {TileSpec | null}
 */
export function describeTileLayer(layer, index) {
  const url = layer?._url;
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) return null;
  const o = layer.options || {};
  const cls = String(o.className || '');
  const key = /gf-tiles-([\w:.-]+)/.exec(cls)?.[1] || 'layer' + index;
  // A background (core/backgrounds.js: the plan, the photos of any year, SPOT's), or an overlay.
  const base = isBaseKey(key);
  return {
    id: ID + 'tiles-' + index,
    url,
    opacity: typeof o.opacity === 'number' ? o.opacity : 1,
    // Leaflet's zooms → MapLibre's (one less), the layer's own range; the tiles' native range stays as it is
    // (256 px tiles: the same tiles at the same scale).
    minzoom: Math.max(0, (o.minZoom ?? 0) - 1),
    maxzoom: Math.min(24, o.maxZoom ?? 22),
    nativeMin: o.minNativeZoom ?? 0,
    nativeMax: o.maxNativeZoom ?? 19,
    base,
    grey: /(?:^|\s)gf-grey(?:\s|$)/.test(cls),
    key,
    ...(o.attribution ? { attribution: String(o.attribution) } : {})
  };
}

/** Whether a tile address is the IGN's (cached-only when the module is off). @param {string} url */
export const isIgn = url => /^https:\/\/data\.geopf\.fr\//.test(url);

/** The address MapLibre asks: through the cache-only protocol for the IGN's while its module is off. @param {string} url @param {boolean} cacheOnly */
export const tileUrl = (url, cacheOnly) => cacheOnly && isIgn(url) ? `${CACHE_PROTOCOL}://${url}` : url;

/**
 * The look of the 2D map's lines and areas (map.css, for SVG), for MapLibre: by their classes, else their options.
 * @param {string} className @param {Record<string, any>} o Leaflet path options
 * @returns {{ color: string, weight: number, opacity: number, blur: number, fill: boolean, fillColor: string, fillOpacity: number, dashed: boolean, hidden: boolean }}
 */
export function pathStyle(className, o = {}) {
  const cls = new Set(String(className || '').split(/\s+/).filter(Boolean));
  const style = {
    color: o.color || '#3388ff', weight: o.weight ?? 3, opacity: o.opacity ?? 1, blur: 0,
    fill: Boolean(o.fill), fillColor: o.fillColor || o.color || '#3388ff', fillOpacity: o.fillOpacity ?? 0.2,
    dashed: Boolean(o.dashArray), hidden: false
  };
  if (cls.has('gf-perim-shadow')) Object.assign(style, { color: '#000000', weight: 5, opacity: 0.3, blur: 2, fill: false });
  if (cls.has('gf-area') || cls.has('gf-zone')) Object.assign(style, { color: '#a3e68a', weight: cls.has('gf-zone') ? 2.5 : 3, opacity: 1, fill: false, dashed: false });
  if (cls.has('gf-area-glow')) Object.assign(style, { weight: 3.5 });
  // An outline's fill part is not shown in 2D either.
  if (cls.has('gf-zone-fill')) style.hidden = true;
  if (cls.has('gf-spread-thread')) Object.assign(style, { color: '#3d4a3d', weight: 1.2, opacity: 0.55, fill: false });
  return style;
}

/**
 * A circle of `radius` metres as a polygon (draped on the relief like any area).
 * @param {[number, number]} center [lon, lat] @param {number} radius metres @param {number} [steps]
 * @returns {[number, number][]}
 */
export function circlePolygon([lon, lat], radius, steps = 96) {
  const R = 6378137, d = radius / R, phi = lat * Math.PI / 180, lambda = lon * Math.PI / 180;
  /** @type {[number, number][]} */
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const brg = (i % steps) / steps * 2 * Math.PI;
    const phi2 = Math.asin(Math.sin(phi) * Math.cos(d) + Math.cos(phi) * Math.sin(d) * Math.cos(brg));
    const lambda2 = lambda + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(phi), Math.cos(d) - Math.sin(phi) * Math.sin(phi2));
    ring.push([Number((lambda2 * 180 / Math.PI).toFixed(7)), Number((phi2 * 180 / Math.PI).toFixed(7))]);
  }
  return ring;
}

/** The sky by the sun's height (null: a fixed light, the day's sky). @param {{ altitude: number } | null} sun */
export function skyFor(sun) {
  const day = { 'sky-color': '#79aee0', 'horizon-color': '#dbe9f4', 'fog-color': '#e6edf1', 'sky-horizon-blend': 0.55, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.35, 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 8, 0.6, 12, 0] };
  if (!sun || sun.altitude > 12) return day;
  if (sun.altitude > -3) return { ...day, 'sky-color': '#6d8fc9', 'horizon-color': '#f6b67a', 'fog-color': '#efc9a4' };
  return { ...day, 'sky-color': '#0e1a33', 'horizon-color': '#2b3a5c', 'fog-color': '#1d2840', 'fog-ground-blend': 0.6 };
}

/**
 * The light on the buildings: the sun's direction and height (from the north, clockwise), or a fixed light from the
 * north-west, high.
 * @param {{ azimuth: number, altitude: number } | null} sun
 */
export function lightFor(sun) {
  if (!sun) return { anchor: 'map', position: [1.15, 315, 45], color: '#ffffff', intensity: 0.4 };
  const polar = Math.min(89, Math.max(5, 90 - sun.altitude));
  const low = sun.altitude < 12;
  return { anchor: 'map', position: [1.15, Math.round(sun.azimuth), Math.round(polar)], color: sun.altitude < 0 ? '#8aa0d6' : low ? '#ffd1a1' : '#ffffff', intensity: sun.altitude < 0 ? 0.15 : low ? 0.35 : 0.5 };
}

/** A building's height: its own (`hauteur`), else a few metres (a house) so it still stands. */
export const BUILDING_HEIGHT = ['let', 'h', ['to-number', ['coalesce', ['get', 'hauteur'], ['get', 'HAUTEUR'], ['get', 'height'], 0], 0],
  ['case', ['>', ['var', 'h'], 0], ['var', 'h'], 7]];

/**
 * The IGN's vector style merged in: its sources and layers renamed (`ign-v:` before each id), its glyphs and sprite.
 * Its background layer dropped (ours is under it), every layer drawn under our overlays.
 * @param {any} style the Géoplateforme's style JSON
 * @returns {{ sources: Record<string, any>, layers: any[], glyphs?: string, sprite?: any, planSource: any } | null}
 */
export function mergeVectorStyle(style) {
  if (!style || typeof style !== 'object' || !style.sources || !Array.isArray(style.layers)) return null;
  /** @type {Record<string, any>} */
  const sources = {};
  for (const [id, s] of Object.entries(style.sources)) sources['ign-v:' + id] = s;
  const layers = style.layers.filter((/** @type {any} */ l) => l && l.type !== 'background' && (!l.source || ('ign-v:' + l.source) in sources))
    .map((/** @type {any} */ l) => ({ ...l, id: 'ign-v:' + l.id, ...(l.source ? { source: 'ign-v:' + l.source } : {}) }));
  // The vector source of the plan (the buildings come from it too).
  const planSource = Object.values(style.sources).find((/** @type {any} */ s) => s?.type === 'vector') || null;
  return { sources, layers, ...(style.glyphs ? { glyphs: style.glyphs } : {}), ...(style.sprite ? { sprite: style.sprite } : {}), planSource };
}

/**
 * @typedef {object} StyleInput
 * @property {TileSpec[]} tiles          the 2D map's tile layers, bottom first
 * @property {import('./map-settings.js').MapSettings} settings
 * @property {boolean} terrain           the relief can be used (setting, module, online, its tiles answering)
 * @property {boolean} cacheOnly         « IGN – fonds de carte » off: IGN tiles from the cache only
 * @property {boolean} buildings         the buildings can be shown (setting, module, online)
 * @property {ReturnType<typeof mergeVectorStyle>} [vector]  the IGN's vector style, when the plan is drawn from it
 * @property {any} [planSource]         the vector source of PLAN.IGN as its style gives it (the buildings come from it)
 * @property {{ azimuth: number, altitude: number } | null} [sun]
 * @property {any} [paths]               GeoJSON FeatureCollection of the lines and areas
 */

/**
 * The whole style.
 * @param {StyleInput} o
 */
export function buildStyle(o) {
  const s = o.settings;
  /** @type {Record<string, any>} */
  const sources = {};
  /** @type {any[]} */
  const layers = [{ id: ID + 'ground', type: 'background', paint: { 'background-color': '#dfe6d8' } }];
  const night = o.sun ? o.sun.altitude < -3 : false;
  const vector = o.vector && o.tiles.some(t => t.key === 'plan') ? o.vector : null;
  const shadeOn = o.terrain && s.hillshade;
  // The background's last layer (a year's photos over the greyed ones): the shading right over it.
  const lastBase = o.tiles.map(t => t.base).lastIndexOf(true);
  for (const [i, t] of o.tiles.entries()) {
    // The plan as vector tiles: its layers in place of its pictures.
    if (vector && t.key === 'plan') {
      Object.assign(sources, vector.sources);
      layers.push(...vector.layers);
    } else {
      sources[t.id] = { type: 'raster', tiles: [tileUrl(t.url, o.cacheOnly)], tileSize: 256, minzoom: t.nativeMin, maxzoom: t.nativeMax };
      // The globe: the backgrounds from the furthest zoom (the IGN's cover the world at small scales).
      layers.push({ id: t.id, type: 'raster', source: t.id, minzoom: t.base && s.globe ? 0 : t.minzoom, metadata: { 'gf:key': t.key },
        paint: { 'raster-opacity': t.opacity, 'raster-fade-duration': 150, ...(night && t.base ? { 'raster-brightness-max': 0.55 } : {}), ...(t.grey ? FILLER : {}) } });
    }
    // The relief's shading right over the background (under the overlays).
    if (i === lastBase && shadeOn) layers.push(hillshade(o));
  }
  if (shadeOn && !o.tiles.some(t => t.base)) layers.splice(1, 0, hillshade(o));
  if (o.terrain) {
    // Two sources of the same tiles: one for the ground's shape, one for its shading (MapLibre wants them apart).
    sources[ID + 'dem'] = { type: 'raster-dem', tiles: [DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: DEM_MAX };
    if (shadeOn) sources[ID + 'shade'] = { type: 'raster-dem', tiles: [DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: DEM_MAX };
  }
  if (o.buildings) {
    const plan = o.planSource ?? o.vector?.planSource;
    sources[ID + 'bati'] = plan ? { ...plan } : { type: 'vector', tiles: [IGN_VECTOR_TILES], maxzoom: 16 };
    layers.push({
      id: ID + 'buildings', type: 'fill-extrusion', source: ID + 'bati', 'source-layer': BUILDINGS_LAYER, minzoom: 14,
      paint: {
        'fill-extrusion-color': night ? '#9aa3b5' : '#e3ddd0',
        'fill-extrusion-height': BUILDING_HEIGHT,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 0.88],
        'fill-extrusion-vertical-gradient': true
      }
    });
  }
  // The 2D map's lines and areas, over everything (draped on the relief).
  sources[ID + 'paths'] = { type: 'geojson', data: o.paths || { type: 'FeatureCollection', features: [] } };
  const visible = ['!', ['get', 'hidden']];
  layers.push(
    { id: ID + 'paths-fill', type: 'fill', source: ID + 'paths', filter: ['all', visible, ['get', 'fill'], ['==', ['geometry-type'], 'Polygon']],
      paint: { 'fill-color': ['get', 'fillColor'], 'fill-opacity': ['get', 'fillOpacity'] } },
    { id: ID + 'paths-line', type: 'line', source: ID + 'paths', filter: ['all', visible, ['!', ['get', 'dashed']], ['>', ['get', 'weight'], 0]],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'weight'], 'line-opacity': ['get', 'opacity'], 'line-blur': ['get', 'blur'] } },
    { id: ID + 'paths-dash', type: 'line', source: ID + 'paths', filter: ['all', visible, ['get', 'dashed']],
      paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'weight'], 'line-opacity': ['get', 'opacity'], 'line-dasharray': [2, 2] } }
  );
  /** @type {Record<string, any>} */
  const style = { version: 8, sources, layers, light: lightFor(o.sun ?? null) };
  if (vector?.glyphs) style.glyphs = vector.glyphs;
  if (vector?.sprite) style.sprite = vector.sprite;
  if (s.sky) style.sky = skyFor(o.sun ?? null);
  if (s.globe) style.projection = { type: 'globe' };
  if (o.terrain) style.terrain = { source: ID + 'dem', exaggeration: s.exaggeration };
  return style;
}

/** @param {StyleInput} o */
function hillshade(o) {
  const over = o.tiles.some(t => t.base);
  return {
    id: ID + 'hillshade', type: 'hillshade', source: ID + 'shade',
    paint: {
      // Over the photos or the plan: a light touch; alone (no background): the relief's whole shading.
      'hillshade-exaggeration': over ? 0.3 : 0.55,
      'hillshade-shadow-color': '#24352a',
      'hillshade-illumination-anchor': 'map',
      'hillshade-illumination-direction': o.sun ? Math.round(o.sun.azimuth) % 360 : 315
    }
  };
}
