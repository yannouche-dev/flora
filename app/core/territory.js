// @ts-check
// Where am I, administratively? Departments (bundled simplified outlines, data/territories.json) give the
// department, its current region and its former (pre-2016) region; protection orders name any of these. The
// outlines (departments, regions, France) are also a map's perimeter when IGN's are not there.
// Also sorts a plant's INPN statuses into national / here / elsewhere.

import { config } from '../config.js';
import { bundledJSON } from './bundled.js';
import { readText, writeText } from './prefs.js';

/**
 * @typedef {{ code: string, name: string, region: string, former: string, polygons: number[][][][] }} Department
 * @typedef {{ iso: string, name: string, formers: string[], polygons?: number[][][][] }} Region
 * @typedef {{ dept: string | null, deptName: string | null, region: string, regionName: string, formers: string[] }} Territory
 * @typedef {{ type: string, code: string, label: string, area: string, level: string, iso: string }} Status
 */

/**
 * The outlines and region table (bundled with the app, cached by the service worker); rejects (and is asked again
 * next time) when the file cannot be read.
 * @returns {Promise<{ regions: Region[], departments: Department[], country?: { name: string, polygons: number[][][][] } }>}
 */
export function territories() {
  return bundledJSON('territories.json');
}

/** Ray casting. @param {number[][]} ring @param {number} x @param {number} y */
function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** @param {number[][][]} polygon outer ring then holes */
const inPolygon = (polygon, x, y) => inRing(polygon[0], x, y) && !polygon.slice(1).some(hole => inRing(hole, x, y));

/** Distance from a point to a segment, in degrees (fine at this scale). */
function segment(x, y, [x1, y1], [x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = dx || dy ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

/** @param {Department[]} departments @param {number} max degrees */
function nearest(departments, x, y, max) {
  let best = null, dist = max;
  for (const d of departments) {
    for (const polygon of d.polygons) {
      const ring = polygon[0];
      for (let i = 1; i < ring.length; i++) {
        const e = segment(x, y, ring[i - 1], ring[i]);
        if (e < dist) { dist = e; best = d; }
      }
    }
  }
  return best;
}

/**
 * Department (and regions) containing a point; null outside metropolitan France.
 * @param {[number, number]} coordinates [lon, lat]
 * @returns {Promise<Territory | null>}
 */
export async function territoryAt([lon, lat]) {
  const { regions, departments } = await territories();
  // Simplified coastlines can leave a seaside place just outside: then the nearest department within ~5 km.
  const dept = departments.find(d => d.polygons.some(p => inPolygon(p, lon, lat))) || nearest(departments, lon, lat, 0.05);
  if (!dept) return null;
  const region = /** @type {Region} */ (regions.find(r => r.iso === dept.region));
  return { dept: dept.code, deptName: dept.name, region: region.iso, regionName: region.name, formers: [dept.former] };
}

/** A whole region (chosen in Réglages): no department, all its former regions. @param {string} iso */
export async function territoryOfRegion(iso) {
  const { regions } = await territories();
  const region = regions.find(r => r.iso === iso);
  return region ? { dept: null, deptName: null, region: region.iso, regionName: region.name, formers: region.formers } : null;
}

// ── Outlines (a map's perimeter) ─────────────────────────────────────────────

/**
 * An outline to draw: a GeoJSON FeatureCollection of its rings as lines (`properties.part: 'line'`: a border, no
 * fill), and its box [west, south, east, north].
 * @param {number[][][][]} polygons
 * @returns {{ feature: any, box: [number, number, number, number] } | null}
 */
function outlineOf(polygons) {
  if (!polygons.length) return null;
  const lines = polygons.flat();
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const ring of lines) for (const [x, y] of ring) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return {
    feature: { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { part: 'line' }, geometry: { type: 'MultiLineString', coordinates: lines } }
    ] },
    box: [w, s, e, n]
  };
}

/** @type {Map<string, ReturnType<typeof outlineOf>>} */
const outlines = new Map();

/**
 * The bundled outline of a département or a région (by name, compared without accents or punctuation), or of
 * metropolitan France: for a map, when IGN's is not there (offline, its module off) — and France's always. Regions
 * and France have their own outlines (departments simplified one by one do not share their borders exactly).
 * @param {'department' | 'region' | 'country'} kind @param {string} [name]
 * @returns {Promise<{ feature: any, box: [number, number, number, number] } | null>}
 */
export async function bundledOutline(kind, name = '') {
  const key = kind + ':' + fold(name);
  if (outlines.has(key)) return outlines.get(key) ?? null;
  const { regions, departments, country } = await territories();
  const polygons = kind === 'country' ? country?.polygons
    : kind === 'region' ? regions.find(r => fold(r.name) === fold(name))?.polygons
    : departments.find(d => fold(d.name) === fold(name))?.polygons;
  const outline = outlineOf(polygons || []);
  outlines.set(key, outline);
  return outline;
}

// ── "Ma région" (Réglages) ───────────────────────────────────────────────────

/** @returns {string | null} ISO code of the chosen region */
export function myRegion() {
  return readText(config.storageKeys.region) || null;
}

/** @param {string | null} iso */
export function setMyRegion(iso) {
  writeText(config.storageKeys.region, iso || null); // not written: not persisted
  dispatchEvent(new Event('geoflora-region'));
}

/** Territory of a place (its point), else the chosen region. @param {[number, number] | null | undefined} point */
export async function territoryFor(point) {
  const here = point ? await territoryAt(point).catch(() => null) : null;
  if (here) return here;
  const iso = myRegion();
  return iso ? territoryOfRegion(iso) : null;
}

// ── Statuses ─────────────────────────────────────────────────────────────────

const fold = (/** @type {string} */ s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The areas of a status that covers the whole country (BDC Statuts: « France », « France métropolitaine »). */
const NATIONAL_AREAS = new Set(['france', 'france metropolitaine']);

/**
 * Whether a status applies to the whole country: national protection or Red List, or a status of no region or
 * department (no ISO code « FR-… ») whose area is France itself — never « Ile-de-France » (FR-J), whose name holds
 * « France ».
 * @param {Status} s
 */
export const isNational = s => s.type === 'PN' || s.type === 'LRN' || (!/^FR-/i.test(s.iso || '') && NATIONAL_AREAS.has(fold(s.area)));

/**
 * Whether a regional/departmental status applies in the territory: ISO code, department, current or former
 * region name (names compared without accents or punctuation).
 * @param {Status} s @param {Territory} t
 */
export function appliesIn(s, t) {
  if (s.iso && (s.iso === t.region || (t.dept && s.iso === 'FR-' + t.dept))) return true;
  const area = fold(s.area);
  if (!area) return false;
  return [t.deptName, t.regionName, ...t.formers].some(name => name && fold(name) === area);
}

/**
 * Splits statuses for display.
 * @param {Status[] | undefined} statuses
 * @param {Territory | null} territory null when unknown: everything non-national is "elsewhere"
 */
export function sortStatuses(statuses, territory) {
  const national = [], here = [], elsewhere = [];
  for (const s of statuses || []) {
    if (isNational(s)) national.push(s);
    else if (territory && appliesIn(s, territory)) here.push(s);
    else elsewhere.push(s);
  }
  return { national, here, elsewhere };
}
