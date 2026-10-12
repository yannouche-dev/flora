// @ts-check
// Where am I, administratively? Departments (bundled simplified outlines, data/territories.json) give the
// department, its current region and its former (pre-2016) region; protection orders name any of these.
// Also sorts a plant's INPN statuses into national / here / elsewhere.

import { config } from '../config.js';

/**
 * @typedef {{ code: string, name: string, region: string, former: string, polygons: number[][][][] }} Department
 * @typedef {{ iso: string, name: string, formers: string[] }} Region
 * @typedef {{ dept: string | null, deptName: string | null, region: string, regionName: string, formers: string[] }} Territory
 * @typedef {{ type: string, code: string, label: string, area: string, level: string, iso: string }} Status
 */

/** @type {Promise<{ regions: Region[], departments: Department[] }> | null} */
let loading = null;

/** The outlines and region table (bundled with the app, cached by the service worker). */
export function territories() {
  loading ??= fetch(new URL('../../data/territories.json', import.meta.url)).then(r => {
    if (!r.ok) throw new Error('territories ' + r.status);
    return r.json();
  });
  loading.catch(() => { loading = null; });
  return loading;
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
 * The outline of departments taken together, from the bundled simplified outlines (offline): a GeoJSON
 * FeatureCollection — their fill (`properties.part: 'fill'`), and their border (`'line'`) without the borders they
 * share (the outlines share their vertices: an edge drawn twice is inside) —, and its box [west, south, east, north].
 * @param {Department[]} departments
 * @returns {{ feature: any, box: [number, number, number, number] } | null}
 */
function outlineOf(departments) {
  const polygons = departments.flatMap(d => d.polygons);
  if (!polygons.length) return null;
  const edge = (/** @type {number[]} */ a, /** @type {number[]} */ b) => { const s = a.join(), e = b.join(); return s < e ? s + '|' + e : e + '|' + s; };
  /** @type {Map<string, number>} */
  const count = new Map();
  for (const polygon of polygons) for (const ring of polygon) for (let i = 1; i < ring.length; i++) {
    const k = edge(ring[i - 1], ring[i]);
    count.set(k, (count.get(k) || 0) + 1);
  }
  // Each ring walked, its runs of unshared edges kept as lines.
  /** @type {number[][][]} */
  const lines = [];
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const polygon of polygons) for (const ring of polygon) {
    /** @type {number[][] | null} */ let run = null;
    for (let i = 1; i < ring.length; i++) {
      const [x, y] = ring[i];
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
      if (count.get(edge(ring[i - 1], ring[i])) !== 1) { run = null; continue; }
      if (!run) lines.push(run = [ring[i - 1]]);
      run.push(ring[i]);
    }
  }
  return {
    feature: { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { part: 'fill' }, geometry: { type: 'MultiPolygon', coordinates: polygons } },
      { type: 'Feature', properties: { part: 'line' }, geometry: { type: 'MultiLineString', coordinates: lines } }
    ] },
    box: [w, s, e, n]
  };
}

/** @type {Map<string, ReturnType<typeof outlineOf>>} */
const outlines = new Map();

/**
 * The bundled outline of a département or a région (by name, compared without accents or punctuation), or of
 * metropolitan France: for a map, when IGN's is not there (offline, its module off) — and France's always.
 * @param {'department' | 'region' | 'country'} kind @param {string} [name]
 * @returns {Promise<{ feature: any, box: [number, number, number, number] } | null>}
 */
export async function bundledOutline(kind, name = '') {
  const key = kind + ':' + fold(name);
  if (outlines.has(key)) return outlines.get(key) ?? null;
  const { regions, departments } = await territories();
  const region = kind === 'region' ? regions.find(r => fold(r.name) === fold(name)) : null;
  const keep = kind === 'country' ? departments
    : kind === 'region' ? (region ? departments.filter(d => d.region === region.iso) : [])
    : departments.filter(d => fold(d.name) === fold(name));
  const outline = outlineOf(keep);
  outlines.set(key, outline);
  return outline;
}

// ── "Ma région" (Réglages) ───────────────────────────────────────────────────

/** @returns {string | null} ISO code of the chosen region */
export function myRegion() {
  try { return localStorage.getItem(config.storageKeys.region) || null; } catch { return null; }
}

/** @param {string | null} iso */
export function setMyRegion(iso) {
  try {
    if (iso) localStorage.setItem(config.storageKeys.region, iso);
    else localStorage.removeItem(config.storageKeys.region);
  } catch { /* not persisted */ }
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

/** Whether a status applies to the whole country. @param {Status} s */
export const isNational = s => s.type === 'PN' || s.type === 'LRN' || /etat|national|france/i.test(fold(s.level) + ' ' + fold(s.area)) && !/^FR-..+/.test(s.iso || '');

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
