// @ts-check
// Réglages › Cartes: how the app's maps are drawn — 2D (Leaflet, the default) or 3D (MapLibre GL, loaded only once a
// map is shown in 3D) — and, in 3D, what they show: the relief and its exaggeration, its shading, the tilt a map opens
// with, the buildings, the sky and its haze, the globe from afar, the IGN plan as vector tiles or pictures, the light
// (fixed, or the sun's at a time of day).
//   mapSettings() → the settings now (every field, valid); setMapSettings(patch); resetMapSettings();
//   mapSettingsEvents fires `change` (here, or in another tab: core/sync.js);
//   cleanMapSettings(value) → a valid whole from anything (a file imported, an old version), never throws.
// Stored in localStorage (config.storageKeys.maps3d), only what differs from the defaults, and only when the user
// changes something: a real setting, so the first steps (core/discover.js) count it as « used before » like the
// others. One choice for every map: Réglages › Cartes, the « Carte » panel of any map (« Affichage ») and the plant
// sheet's map blocks change these same settings, and every map shown follows at once (no map has a choice of its own).

import { config } from '../config.js';
import { writeLocal } from './quota.js';
import { onStorage } from './sync.js';

/**
 * @typedef {object} MapSettings
 * @property {'2d' | '3d'} renderer   Affichage des cartes
 * @property {boolean} relief         the ground's relief (module « Vue 3D (relief) » too)
 * @property {number} exaggeration    1 … 3
 * @property {boolean} hillshade      the relief's shading under the IGN layers
 * @property {number} pitch           the tilt a map opens with, 0 … 60° (MapLibre's own limit)
 * @property {boolean} buildings      IGN buildings, extruded (from zoom 15)
 * @property {boolean} sky            sky, horizon haze, atmosphere
 * @property {boolean} globe          the Earth as a globe when zoomed out
 * @property {'raster' | 'vector'} plan  the « Plan IGN » background: pictures (WMTS) or vector tiles (crisper labels)
 * @property {'fixed' | 'now' | 'hour'} light  the light: fixed (north-west), the sun now, or the sun at `hour`
 * @property {number} hour            0 … 24 (half hours), with light 'hour'
 */

/** @type {Readonly<MapSettings>} */
export const MAP_DEFAULTS = Object.freeze({
  renderer: '2d', relief: true, exaggeration: 1.3, hillshade: true, pitch: 50, buildings: true, sky: true, globe: false,
  plan: 'raster', light: 'fixed', hour: 15
});

/** The bounds of the sliders (Réglages, the maps' panel and the map blocks' form use the same). */
export const LIMITS = Object.freeze({ exaggeration: [1, 3, 0.1], pitch: [0, 60, 5], hour: [0, 24, 0.5] });

/** @param {unknown} v @param {[number, number, number]} range @param {number} fallback */
function num(v, [min, max, step], fallback) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const snapped = Math.round(n / step) * step;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(2))));
}

/** @param {unknown} v @param {boolean} fallback */
const bool = (v, fallback) => typeof v === 'boolean' ? v : fallback;
/** @template {string} T @param {unknown} v @param {readonly T[]} values @param {T} fallback @returns {T} */
const pick = (v, values, fallback) => values.includes(/** @type {T} */ (v)) ? /** @type {T} */ (v) : fallback;

/**
 * Every field valid, from anything: unknown keys dropped, wrong types and out-of-range numbers back to the default
 * (or within the bounds).
 * @param {unknown} value @returns {MapSettings}
 */
export function cleanMapSettings(value) {
  const v = /** @type {Record<string, unknown>} */ (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
  const d = MAP_DEFAULTS;
  return {
    renderer: pick(v.renderer, /** @type {const} */ (['2d', '3d']), d.renderer),
    relief: bool(v.relief, d.relief),
    exaggeration: num(v.exaggeration, /** @type {any} */ (LIMITS.exaggeration), d.exaggeration),
    hillshade: bool(v.hillshade, d.hillshade),
    pitch: num(v.pitch, /** @type {any} */ (LIMITS.pitch), d.pitch),
    buildings: bool(v.buildings, d.buildings),
    sky: bool(v.sky, d.sky),
    globe: bool(v.globe, d.globe),
    plan: pick(v.plan, /** @type {const} */ (['raster', 'vector']), d.plan),
    light: pick(v.light, /** @type {const} */ (['fixed', 'now', 'hour']), d.light),
    hour: num(v.hour, /** @type {any} */ (LIMITS.hour), d.hour)
  };
}

/** What differs from the defaults (what is stored, and exported). @param {MapSettings} s @returns {Partial<MapSettings>} */
export function mapSettingsDiff(s) {
  const clean = cleanMapSettings(s);
  return /** @type {any} */ (Object.fromEntries(Object.entries(clean).filter(([k, v]) => /** @type {any} */ (MAP_DEFAULTS)[k] !== v)));
}

function read() {
  try { return cleanMapSettings(JSON.parse(localStorage.getItem(config.storageKeys.maps3d) || '{}')); } catch { return cleanMapSettings({}); }
}

let state = read();

/** Fires `change` (detail: the settings) when they change, here or in another tab. */
export const mapSettingsEvents = new EventTarget();
const changed = () => mapSettingsEvents.dispatchEvent(new CustomEvent('change', { detail: state }));

/** The settings now. @returns {MapSettings} */
export const mapSettings = () => state;

/** @param {MapSettings} next */
function write(next) {
  state = next;
  const diff = mapSettingsDiff(next);
  writeLocal(config.storageKeys.maps3d, Object.keys(diff).length ? JSON.stringify(diff) : null);
  changed();
}

/** Changes some settings (from what is stored now: another tab's choices since are kept). @param {Partial<MapSettings>} patch */
export function setMapSettings(patch) {
  write(cleanMapSettings({ ...read(), ...patch }));
}

/** Back to the defaults (the key removed). */
export function resetMapSettings() { write(cleanMapSettings({})); }

// Changed in another tab: this one follows (its maps redraw).
onStorage(config.storageKeys.maps3d, () => { state = read(); changed(); });

// ── The sun ─────────────────────────────────────────────────────────────────

const RAD = Math.PI / 180;

/**
 * Where the sun is, seen from a point at a moment (NOAA's simplified formulas, to a degree or so: enough for light).
 * @param {Date} date @param {number} lat @param {number} lon
 * @returns {{ azimuth: number, altitude: number }} degrees: azimuth from the north, clockwise; altitude above the horizon
 */
export function sunPosition(date, lat, lon) {
  const day = (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 0)) / 864e5;
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const g = (2 * Math.PI / 365) * (day - 1 + (hours - 12) / 24);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const solarMinutes = hours * 60 + eqtime + 4 * lon;
  const ha = (solarMinutes / 4 - 180) * RAD;
  const phi = lat * RAD;
  const cosZenith = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  const altitude = 90 - zenith / RAD;
  // Azimuth from the north, clockwise.
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) / RAD + 180;
  return { azimuth: (az + 360) % 360, altitude };
}

/**
 * The moment the light is for: now, or today at `hour` (Paris time, whatever the device's zone: the maps are of
 * France), null for a fixed light.
 * @param {MapSettings} s @param {Date} [now] @returns {Date | null}
 */
export function lightMoment(s, now = new Date()) {
  if (s.light === 'now') return now;
  if (s.light !== 'hour') return null;
  // Paris is UTC+1 in winter, UTC+2 in summer (last Sunday of March → last Sunday of October).
  const y = now.getUTCFullYear();
  const lastSunday = (/** @type {number} */ month) => { const d = new Date(Date.UTC(y, month + 1, 0)); return d.getUTCDate() - d.getUTCDay(); };
  const summer = now >= new Date(Date.UTC(y, 2, lastSunday(2), 1)) && now < new Date(Date.UTC(y, 9, lastSunday(9), 1));
  const h = Math.floor(s.hour), m = Math.round((s.hour - h) * 60);
  return new Date(Date.UTC(y, now.getUTCMonth(), now.getUTCDate(), h - (summer ? 2 : 1), m));
}

/** « 15 h 30 » @param {number} hour */
export const formatHour = hour => `${Math.floor(hour) % 24} h${hour % 1 ? ' ' + String(Math.round((hour % 1) * 60)).padStart(2, '0') : ''}`;
