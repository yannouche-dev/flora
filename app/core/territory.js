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
