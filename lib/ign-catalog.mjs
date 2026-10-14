// @ts-check
// IGN's WMTS catalogue (Géoplateforme GetCapabilities), read the same way by the app (app/core/ign-catalog.js, in a
// worker: app/workers/ign-catalog.worker.js) and by the script that ships a copy with it (scripts/build-ign-catalog.mjs,
// in Node): pure, no DOM, no dependency (but its classification, lib/ign-classify.mjs).
//
// The document is large (hundreds of layers, megabytes): no DOMParser (absent from workers and Node, heavy on a phone),
// but a scan for its <Layer> elements, each read by a tiny XML reader. A layer is kept when the app's maps can show it:
// a Web Mercator tile matrix set — « PM », or one of the bounded sets the Géoplateforme names « PM_6_16 », « PM_0_19 »
// … (min and max zoom), which is what it lists for nearly every layer — and PNG or JPEG tiles.
//
// Each layer keeps, besides what a map needs to ask its tiles (identifier, format, style, zooms): its title and
// description, its keywords (<ows:Keywords>), where it has data (<ows:WGS84BoundingBox>: a preview tile is asked
// there), its legend (the default style's <LegendURL>) and its metadata sheet (<ows:Metadata>) when the service gives
// them; then its place in a French taxonomy, its series and its interest for botany (lib/ign-classify.mjs).
//
// File format (data/ign-catalog.json): version 2 adds `version`, `taxonomy` (the rules' version), `groups` (series key →
// title) and, per layer, the fields above (`kw`, `bbox`, `legend`, `meta`, `cat`, `sub`, `label`, `source`, `botany`,
// `group`, `variant`); a version 1 file (no classification, descriptions cut at 240 characters) reads the same, its
// layers classified on reading. An older app reading a version 2 file keeps the fields it knows.

import { classifyLayers, knownPlace, TAXONOMY_VERSION } from './ign-classify.mjs';

/** The catalogue's address. */
export const CAPABILITIES_URL = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities';

/** A layer identifier the app puts in a tile address (same rule as app/core/ign.js). */
export const SAFE_ID = /^[A-Za-z0-9._:-]{1,160}$/;

/** The catalogue is asked again after a month. */
export const CATALOG_TTL = 30 * 24 * 3600 * 1000;

/** How much of a layer's description is kept (most are far shorter; the build cuts further if the file grows heavy). */
export const ABOUT_MAX = 600;

/** The catalogue file's format (see the head of this file). */
export const FORMAT_VERSION = 2;

/** Keywords kept per layer, and the length of each. */
const KW_MAX = 12;
const KW_LEN = 60;

/**
 * A layer of the catalogue, compact: what the maps need, what the list shows, its place (lib/ign-classify.mjs).
 * @typedef {{ id: string, title: string, about: string, format: string, style: string, minNative: number, maxNative: number,
 *   kw?: string[], bbox?: [number, number, number, number], legend?: string, meta?: string } & import('./ign-classify.mjs').Classified} CatalogLayer
 * The copy shipped with the app (data/ign-catalog.json), or kept on the device.
 * @typedef {{ version?: number, taxonomy?: number, fetchedAt: string, seed?: boolean, source?: { url: string, sha256?: string, bytes?: number, note?: string },
 *   count?: number, groups?: Record<string, string>, layers: CatalogLayer[] }} CatalogFile
 */

/** @typedef {{ name: string, attrs: string, children: XmlNode[], text: string }} XmlNode */

const ENTITIES = /** @type {Record<string, string>} */ ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" });

/** Text with its XML entities decoded. @param {string} s */
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] !== '#') return ENTITIES[e] ?? all;
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    try { return String.fromCodePoint(code); } catch { return ''; }
  });
}

const TOKEN = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!(?:[^>"']|"[^"]*"|'[^']*')*>|<(\/?)([A-Za-z_][\w.:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;

/**
 * A fragment of XML as a light tree (names without their prefix). Lenient: an unmatched closing tag closes up to its
 * opening one, or is ignored.
 * @param {string} xml @returns {XmlNode}
 */
export function readXml(xml) {
  /** @type {XmlNode} */
  const root = { name: '#root', attrs: '', children: [], text: '' };
  const stack = [root];
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) { top.text += m[1]; continue; }
    if (m[6] !== undefined) { top.text += decode(m[6]); continue; }
    if (m[3] === undefined) continue; // comment, declaration, doctype
    const name = m[3].slice(m[3].indexOf(':') + 1);
    if (m[2]) {
      const at = stack.map(n => n.name).lastIndexOf(name);
      if (at > 0) stack.length = at;
      continue;
    }
    /** @type {XmlNode} */
    const node = { name, attrs: m[4], children: [], text: '' };
    top.children.push(node);
    if (!m[5]) stack.push(node);
  }
  return root;
}

const kids = (/** @type {XmlNode} */ n, /** @type {string} */ name) => n.children.filter(c => c.name === name);
const text = (/** @type {XmlNode | undefined} */ n, /** @type {string} */ name) =>
  (n && kids(n, name)[0]?.text.replace(/\s+/g, ' ').trim()) || '';
/** An attribute's value, its entities decoded (null: none). */
const attr = (/** @type {XmlNode} */ n, /** @type {string} */ name) => {
  const v = new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(n.attrs)?.slice(2).find(x => x !== undefined);
  return v === undefined ? null : decode(v);
};

/** An address the app may show or ask (a legend picture, a metadata sheet): https, no space, no quote. */
const SAFE_URL = /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?\/[^\s"'<>\\]{0,300}$/;

/** A bounding box [west, south, east, north] in degrees, rounded to 0.001°, or null. @param {any} b */
function boxOf(b) {
  if (!Array.isArray(b) || b.length !== 4) return null;
  const [w, s, e, n] = b.map(Number);
  if (![w, s, e, n].every(Number.isFinite) || w > e || s > n || w < -180 || e > 180 || s < -90 || n > 90) return null;
  return /** @type {[number, number, number, number]} */ ([w, s, e, n].map(v => Math.round(v * 1000) / 1000));
}

/** A Web Mercator set the maps can ask with TILEMATRIXSET=PM: « PM », or « PM_<min>_<max> ». */
const PM_SET = /^PM(?:_(\d{1,2})_(\d{1,2}))?$/;

/** The zoom of a TileMatrix identifier (« 12 », or « PM:12 »…). @param {string} id */
const zoomOf = id => { const m = /(\d{1,2})$/.exec(id.trim()); return m ? Number(m[1]) : NaN; };

/**
 * One <Layer> element read (null: not one the maps can show).
 * @param {XmlNode} layer @returns {CatalogLayer | null}
 */
function readLayer(layer) {
  const id = text(layer, 'Identifier');
  if (!id || !SAFE_ID.test(id)) return null;
  const formats = kids(layer, 'Format').map(f => f.text.trim());
  const format = formats.find(f => f === 'image/png') || formats.find(f => f === 'image/jpeg');
  if (!format) return null;
  let link = null;
  let set = null;
  for (const l of kids(layer, 'TileMatrixSetLink')) {
    const m = PM_SET.exec(text(l, 'TileMatrixSet'));
    if (m) { link = l; set = m; break; }
  }
  if (!link || !set) return null;
  const styles = kids(layer, 'Style');
  const style = text(styles.find(s => attr(s, 'isDefault') === 'true') || styles[0], 'Identifier') || 'normal';
  const zooms = kids(link, 'TileMatrixSetLimits').flatMap(s => kids(s, 'TileMatrixLimits'))
    .map(l => zoomOf(text(l, 'TileMatrix'))).filter(z => Number.isFinite(z) && z >= 0 && z <= 24);
  const [min, max] = zooms.length ? [Math.min(...zooms), Math.max(...zooms)]
    : set[1] !== undefined ? [Number(set[1]), Number(set[2])] : [0, 19];
  // Shown as plain text: markup some descriptions carry (in CDATA) left out.
  const about = text(layer, 'Abstract').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, ABOUT_MAX);
  /** @type {CatalogLayer} */
  const out = { id, title: text(layer, 'Title') || id, about, format, style, minNative: min, maxNative: max, cat: 'autres', sub: 'divers' };
  const kw = [...new Set(kids(layer, 'Keywords').flatMap(k => kids(k, 'Keyword')).map(k => k.text.replace(/\s+/g, ' ').trim().slice(0, KW_LEN)).filter(Boolean))].slice(0, KW_MAX);
  if (kw.length) out.kw = kw;
  const box = kids(layer, 'WGS84BoundingBox')[0];
  const corner = (/** @type {string} */ name) => text(box, name).split(/\s+/).map(Number);
  const bbox = box ? boxOf([...corner('LowerCorner'), ...corner('UpperCorner')]) : null;
  if (bbox) out.bbox = bbox;
  const defaultStyle = styles.find(s => attr(s, 'isDefault') === 'true') || styles[0];
  const legend = defaultStyle ? kids(defaultStyle, 'LegendURL').map(l => attr(l, 'href') || '').find(u => SAFE_URL.test(u)) : null;
  if (legend) out.legend = legend;
  const meta = kids(layer, 'Metadata').map(m => attr(m, 'href') || '').find(u => SAFE_URL.test(u));
  if (meta) out.meta = meta;
  return out;
}

const LAYER = /<((?:[\w.-]+:)?Layer)\b[^>]*>([\s\S]*?)<\/\1\s*>/g;

/**
 * The layers of a WMTS GetCapabilities document the maps can show, sorted by title (French order), one per identifier.
 * @param {string} xml @returns {CatalogLayer[]}
 */
export function parseCapabilities(xml) {
  /** @type {Map<string, CatalogLayer>} */
  const byId = new Map();
  LAYER.lastIndex = 0;
  let m;
  while ((m = LAYER.exec(xml))) {
    const layer = readLayer({ name: 'Layer', attrs: '', children: readXml(m[2]).children, text: '' });
    if (layer && !byId.has(layer.id)) byId.set(layer.id, layer);
  }
  return classifyLayers(sortLayers([...byId.values()]));
}

/** @param {CatalogLayer[]} layers */
export const sortLayers = layers => layers.sort((a, b) => a.title.localeCompare(b.title, 'fr', { ignorePunctuation: true }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const str = (/** @type {any} */ v, max = 200) => typeof v === 'string' && v ? v.slice(0, max) : '';

/**
 * A catalogue file's layers, each checked (a file of another shape, or a layer the maps could not ask, is left out),
 * classified: as the file says when it was classified with the rules of this app (version 2, same taxonomy, every
 * place known), else again here (a version 1 file, a copy kept on the device, other rules).
 * @param {any} file @returns {CatalogLayer[]}
 */
export function layersOf(file) {
  const list = Array.isArray(file) ? file : Array.isArray(file?.layers) ? file.layers : [];
  const groups = !Array.isArray(file) && file?.groups && typeof file.groups === 'object' ? file.groups : {};
  /** @type {CatalogLayer[]} */
  const layers = list.filter((/** @type {any} */ l) => l && typeof l.id === 'string' && SAFE_ID.test(l.id)
    && /^image\/(png|jpeg)$/.test(l.format) && typeof l.title === 'string'
    && Number.isFinite(l.minNative) && Number.isFinite(l.maxNative))
    .map((/** @type {any} */ l) => {
      /** @type {CatalogLayer} */
      const out = { id: l.id, title: l.title, about: str(l.about, ABOUT_MAX), format: l.format, style: str(l.style) || 'normal',
        minNative: l.minNative, maxNative: l.maxNative, cat: str(l.cat, 40), sub: str(l.sub, 40) };
      const kw = Array.isArray(l.kw) ? l.kw.filter((/** @type {any} */ k) => typeof k === 'string' && k).map((/** @type {string} */ k) => k.slice(0, KW_LEN)).slice(0, KW_MAX) : [];
      if (kw.length) out.kw = kw;
      const bbox = boxOf(l.bbox);
      if (bbox) out.bbox = bbox;
      if (typeof l.legend === 'string' && SAFE_URL.test(l.legend)) out.legend = l.legend;
      if (typeof l.meta === 'string' && SAFE_URL.test(l.meta)) out.meta = l.meta;
      if (str(l.label)) out.label = str(l.label);
      if (str(l.source)) out.source = str(l.source);
      if (l.botany === 1 || l.botany === 2) out.botany = l.botany;
      if (str(l.group, 80)) {
        out.group = str(l.group, 80);
        out.gtitle = str(groups[out.group]) || str(l.gtitle) || l.title;
        out.variant = str(l.variant) || l.id;
      }
      return out;
    });
  const classified = !Array.isArray(file) && file?.taxonomy === TAXONOMY_VERSION && layers.every(l => knownPlace(l.cat, l.sub));
  return classified ? layers : classifyLayers(layers);
}

/**
 * A catalogue as written to a file (version 2): the series' titles once, in `groups`, not on each of their layers.
 * @param {CatalogLayer[]} layers @returns {{ groups: Record<string, string>, layers: CatalogLayer[] }}
 */
export function fileLayers(layers) {
  /** @type {Record<string, string>} */
  const groups = {};
  const out = layers.map(l => {
    if (!l.group) return l;
    groups[l.group] = l.gtitle || l.title;
    const { gtitle, ...rest } = l;
    return rest;
  });
  return { groups, layers: out };
}

/**
 * When a copy was read from the service (ms; 0: unknown, or a seed — a starting copy not read from the service, always
 * asked again).
 * @param {any} file @returns {number}
 */
export function fetchedAtOf(file) {
  if (!file || file.seed) return 0;
  const t = typeof file.fetchedAt === 'number' ? file.fetchedAt : Date.parse(file.fetchedAt);
  return Number.isFinite(t) ? t : 0;
}

/**
 * A copy read at `fetchedAt` is to be asked again (unknown date, past the month, or from the future: a clock that was
 * wrong). @param {number} fetchedAt @param {number} [now] @param {number} [ttl]
 */
export const isStale = (fetchedAt, now = Date.now(), ttl = CATALOG_TTL) => !fetchedAt || now - fetchedAt >= ttl || fetchedAt - now > 24 * 3600 * 1000;
