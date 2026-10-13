// Map tiles made here, for the specs that draw maps with MapLibre (map3d.spec.mjs, maps3d.spec.mjs): PNG pictures
// (the IGN's photos, the relief in Terrarium encoding) and a Mapbox Vector Tile of buildings (PLAN.IGN's `bati_surf`
// layer, each with its `hauteur`) — no network, ever.
import { deflateSync } from 'node:zlib';

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
/** @param {Buffer} buf */
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** @param {string} type @param {Buffer} data */
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A 256 × 256 RGB PNG, each pixel from `rgb(x, y)`. @param {(x: number, y: number) => [number, number, number]} rgb */
export function png(rgb) {
  const raw = Buffer.alloc(256 * (1 + 256 * 3));
  for (let y = 0; y < 256; y++) {
    const row = y * (1 + 256 * 3);
    for (let x = 0; x < 256; x++) raw.set(rgb(x, y), row + 1 + x * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(256, 0); ihdr.writeUInt32BE(256, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Aerial photo: green fields, a darker grid. */
export const PHOTO = png((x, y) => (x % 64 < 3 || y % 64 < 3 ? [70, 110, 60] : [120 + (x >> 3), 160, 100 + (y >> 3)]));
/** Plan: pale, with blue-grey roads. */
export const PLAN = png((x, y) => (x % 85 < 4 || y % 85 < 4 ? [200, 205, 215] : [246, 243, 236]));
/** Terrarium: height = R × 256 + G + B / 256 − 32768; a slope from 1 500 m to some 2 300 m across each tile. */
export const TERRARIUM = png((x, y) => { const h = 1500 + x * 2 + y + 32768; return [h >> 8, h & 255, 0]; });

// ---------- Mapbox Vector Tile (protobuf), enough for polygons with one number each ----------

/** @param {number} n */
function varint(n) {
  const out = [];
  while (n > 127) { out.push((n & 127) | 128); n = Math.floor(n / 128); }
  out.push(n);
  return Buffer.from(out);
}
/** @param {number} field @param {number} type */
const key = (field, type) => varint((field << 3) | type);
/** @param {number} field @param {Buffer} bytes */
const bytesField = (field, bytes) => Buffer.concat([key(field, 2), varint(bytes.length), bytes]);
/** @param {number} field @param {number} n */
const varField = (field, n) => Buffer.concat([key(field, 0), varint(n)]);
/** @param {number} n */
const zigzag = n => (n << 1) ^ (n >> 31);
/** @param {number[]} ns */
const packed = ns => Buffer.concat(ns.map(varint));

/**
 * A vector tile with one layer of squares (buildings), each `{ x, y, size, height }` in tile units (extent 4096).
 * @param {string} layer @param {{ x: number, y: number, size: number, height: number }[]} squares
 */
export function mvt(layer, squares) {
  const heights = [...new Set(squares.map(s => s.height))];
  const features = squares.map((s, i) => {
    let cx = 0, cy = 0;
    const pts = [[s.x, s.y], [s.x + s.size, s.y], [s.x + s.size, s.y + s.size], [s.x, s.y + s.size]];
    const geom = [];
    pts.forEach(([x, y], k) => {
      if (k === 0) geom.push(9); else if (k === 1) geom.push((2 & 7) | (3 << 3));
      geom.push(zigzag(x - cx), zigzag(y - cy));
      cx = x; cy = y;
    });
    geom.push(15);
    return bytesField(2, Buffer.concat([varField(1, i + 1), bytesField(2, packed([0, heights.indexOf(s.height)])), varField(3, 3), bytesField(4, packed(geom))]));
  });
  const values = heights.map(h => bytesField(4, Buffer.concat([key(3, 1), (() => { const b = Buffer.alloc(8); b.writeDoubleLE(h); return b; })()])));
  const body = Buffer.concat([varField(15, 2), bytesField(1, Buffer.from(layer)), ...features, bytesField(3, Buffer.from('hauteur')), ...values, varField(5, 4096)]);
  return bytesField(3, body);
}

/** A town's block: a grid of buildings, 12 to 60 m high. */
export const BUILDINGS = mvt('bati_surf', Array.from({ length: 36 }, (_, i) => ({
  x: 200 + (i % 6) * 620, y: 200 + Math.floor(i / 6) * 620, size: 420, height: 12 + ((i * 7) % 5) * 12
})));

/** The Géoplateforme's vector style, reduced: the plan's source, a few layers, its fonts and symbols. */
export const VECTOR_STYLE = {
  version: 8,
  name: 'PLAN IGN (test)',
  glyphs: 'https://data.geopf.fr/annexes/ressources/vectorTiles/fonts/{fontstack}/{range}.pbf',
  sprite: 'https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/sprite/PlanIgn',
  sources: { plan_ign: { type: 'vector', tiles: ['https://data.geopf.fr/tms/1.0.0/PLAN.IGN/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 16, attribution: 'IGN' } },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#f2efe9' } },
    { id: 'bati_surf', type: 'fill', source: 'plan_ign', 'source-layer': 'bati_surf', paint: { 'fill-color': '#c9bfae' } }
  ]
};

/**
 * Every map tile of the IGN, the relief and the buildings answered from here.
 * @param {import('@playwright/test').Page | import('@playwright/test').BrowserContext} page
 * @param {{ dem?: 'ok' | 'fail', seen?: string[] }} [o] `seen`: the addresses asked, pushed as they come
 */
export async function answerTiles(page, { dem = 'ok', seen } = {}) {
  const cors = { 'access-control-allow-origin': '*' };
  await page.route(/^https:\/\/data\.geopf\.fr\/wmts\?.*REQUEST=GetTile/i, route => {
    seen?.push(route.request().url());
    const plan = /PLANIGNV2/.test(route.request().url());
    return route.fulfill({ contentType: plan ? 'image/png' : 'image/jpeg', body: plan ? PLAN : PHOTO, headers: cors });
  });
  await page.route(/^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\//, route => {
    seen?.push(route.request().url());
    return dem === 'ok' ? route.fulfill({ contentType: 'image/png', body: TERRARIUM, headers: cors }) : route.abort('internetdisconnected');
  });
  await page.route(/^https:\/\/data\.geopf\.fr\/tms\/1\.0\.0\/PLAN\.IGN\/\d+\/\d+\/\d+\.pbf/, route => {
    seen?.push(route.request().url());
    return route.fulfill({ contentType: 'application/x-protobuf', body: BUILDINGS, headers: cors });
  });
  await page.route(/^https:\/\/data\.geopf\.fr\/annexes\/ressources\/vectorTiles\/styles\/PLAN\.IGN\/standard\.json/, route => {
    seen?.push(route.request().url());
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(VECTOR_STYLE), headers: cors });
  });
  // Fonts and symbols: none here (the reduced style has no labels nor icons); asked, they fail quietly.
  await page.route(/^https:\/\/data\.geopf\.fr\/annexes\/ressources\/vectorTiles\/(fonts|styles\/PLAN\.IGN\/sprite)/, route => {
    seen?.push(route.request().url());
    return route.fulfill({ status: 404, body: '', headers: cors });
  });
}
