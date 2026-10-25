// @ts-check
// How the app's maps look, in one place: Réglages › Cartes, the panel ▦ of every map (components/gf-map-options.js)
// and the maps themselves read and change these only.
//  - MapSettings: how they are drawn — 2D (Leaflet, the default) or 3D (MapLibre GL, loaded only once a map is shown
//    in 3D) — and, in 3D, what they show: the relief and its exaggeration, its shading, the tilt a map opens with, the
//    buildings, the sky and its haze, the globe from afar, the IGN plan as vector tiles or pictures, the light (fixed,
//    or the sun's at a time of day). One choice for every map (a map that always stays one way says why: gf-map-gl.js).
//      mapSettings() → the settings now (every field, valid); setMapSettings(patch); resetMapSettings();
//      mapSettingsEvents fires `change` (here, or in another tab: core/sync.js);
//      cleanMapSettings(value) → a valid whole from anything (a file imported, an old version), never throws.
//    Stored in localStorage (config.storageKeys.maps3d), only what differs from the defaults, and only when the user
//    changes something: a real setting, so the first steps (core/discover.js) count it as « used before » like the others.
//  - MapLook: what they show — the background (core/backgrounds.js: the plan, the photos — the most recent, of a year, of
//    a period, historical —, SPOT's images of a year), « Noms et réseaux » over the photos and SPOT's (core/map-layers.js
//    LANDMARKS: the places' names, the roads, the rivers by default; the railways, the buildings, the boundaries), the
//    IGN overlays (bottom first), each overlay's opacity. The common look
//    (« réglages communs à toutes les cartes »): every open map follows it, 2D and 3D, at once (mapLookEvents).
//      mapLook() → the look now; setMapLook(patch); resetMapLook(); mapLookEvents fires `change` (here or in another tab).
//    A map may have its own look, which its owner keeps (a free layout's cell: base=, annee=, noms=, layers=, opac= in its address; a
//    map block of the plant sheet: MapConfig.look): a Partial<MapLook>, each field given replacing the common one
//    (lookFor), the others following it; « Revenir aux réglages communs » lets it go (gf-map `look-change` null).
//    Stored under the keys of before (config.storageKeys.mapLayer: { base, overlays, distribution } — base the
//    background's key, a string: 'plan' and 'photo' as before, 'photo:2016-2020', 'spot:2020' —; « Noms et réseaux »
//    only when not the usual ones: none as before (names: false, which a version of before reads too), others as
//    landmarks: […]; overlayOpacity: key → 0…1, only those not at their usual one (core/ign-layers.js defaultOpacity:
//    DEFAULT_OPACITY, the shading's 40 %); the catalogue's layers added stay
//    core/ign-layers.js's, under ignLayers) — nothing written by merely reading them.

import { config } from '../config.js';
import { defaultOpacity, isOverlay } from './ign-layers.js';
import { isBaseKey } from './backgrounds.js';
import { LANDMARK_DEFAULTS, cleanLandmarks } from './map-layers.js';
import { definePref } from './prefs.js';

/**
 * @typedef {object} MapSettings
 * @property {'2d' | '3d'} renderer   Affichage des cartes
 * @property {boolean} relief         the ground's relief (module « Vue 3D (relief) » too)
 * @property {number} exaggeration    1 … 3
 * @property {boolean} hillshade      the relief's shading under the IGN layers
 * @property {number} pitch           the tilt a map opens with, 0 … 85° (MAX_PITCH: the horizon, the mountains ahead)
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
/**
 * How far a 3D map tilts (°): to the horizon, the mountains seen ahead as from a valley — MapLibre stops at 60° unless
 * told (beyond 90° the eye would go under the ground, its centre being on it).
 */
export const MAX_PITCH = 85;

export const LIMITS = Object.freeze({ exaggeration: [1, 3, 0.1], pitch: [0, MAX_PITCH, 5], hour: [0, 24, 0.5] });

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

// Kept: what differs from the defaults. Changed in another tab: this one follows (its maps redraw).
const pref = definePref({
  key: config.storageKeys.maps3d,
  fallback: {},
  clean: cleanMapSettings,
  store: s => { const diff = mapSettingsDiff(s); return Object.keys(diff).length ? diff : null; }
});

/** Fires `change` (detail: the settings) when they change, here or in another tab. */
export const mapSettingsEvents = pref.events;

/** The settings now. @returns {MapSettings} */
export const mapSettings = pref.get;

/** Changes some settings (from what is stored now: another tab's choices since are kept). @param {Partial<MapSettings>} patch */
export function setMapSettings(patch) {
  pref.set(cleanMapSettings({ ...pref.fresh(), ...patch }));
}

/** Back to the defaults (the key removed). */
export function resetMapSettings() { pref.reset(); }

// ── The look: background, « Noms et réseaux », overlays, opacities ─────────

/** @typedef {import('./backgrounds.js').BaseKey} BaseKey */

/**
 * @typedef {object} MapLook
 * @property {BaseKey} base                       the background (core/backgrounds.js: 'plan', 'photo', 'photo:2016-2020', 'spot:2020'…)
 * @property {string[]} landmarks                « Noms et réseaux » over the photos and SPOT's images, bottom first (core/map-layers.js LANDMARKS' keys; the plan has its own)
 * @property {string[]} overlays                  IGN overlays, bottom first: the app's own and the catalogue's added (core/ign-layers.js)
 * @property {Record<string, number>} opacities   each overlay's opacity (0…1, by 0.05) when not its usual one (core/ign-layers.js defaultOpacity)
 */

/** @type {Readonly<MapLook>} */
export const LOOK_DEFAULTS = Object.freeze({
  base: 'photo', landmarks: /** @type {string[]} */ (LANDMARK_DEFAULTS), overlays: /** @type {string[]} */ (Object.freeze([])), opacities: Object.freeze({})
});

/** @param {unknown} v @returns {Record<string, any>} */
const objectOf = v => /** @type {Record<string, any>} */ (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** Overlays the maps know (an unknown one dropped: a catalogue's layer never added here), each once. @param {unknown} list @returns {string[]} */
const cleanOverlays = list => Array.isArray(list) ? [...new Set(list.filter(k => typeof k === 'string' && isOverlay(k)))] : [];

/**
 * Opacities within 0…1 (another value dropped, as before), by 0.05; each overlay's usual one left out (it is what none
 * means: core/ign-layers.js defaultOpacity).
 * @param {unknown} value @returns {Record<string, number>}
 */
function cleanOpacities(value) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const [k, v] of Object.entries(objectOf(value))) {
    if (typeof v !== 'number' || !(v >= 0 && v <= 1)) continue;
    const r = Math.round(v * 20) / 20;
    if (r !== defaultOpacity(k)) out[k] = r;
  }
  return out;
}

/**
 * A map's own look, from anything (a stored MapConfig, a file): only the valid fields kept; null when none is.
 * @param {unknown} value @returns {Partial<MapLook> | null}
 */
export function cleanOwnLook(value) {
  const v = objectOf(value);
  /** @type {Partial<MapLook>} */
  const out = {};
  // A background exactly (core/backgrounds.js): never a key of another version, nor one an object inherits (« constructor »).
  if (isBaseKey(v.base)) out.base = v.base;
  // « Noms et réseaux »; a look of before, its names on or off (the usual ones, or none).
  if (Array.isArray(v.landmarks)) out.landmarks = cleanLandmarks(v.landmarks);
  else if (typeof v.names === 'boolean') out.landmarks = v.names ? [...LANDMARK_DEFAULTS] : [];
  if (Array.isArray(v.overlays)) out.overlays = cleanOverlays(v.overlays);
  if (v.opacities && typeof v.opacities === 'object' && !Array.isArray(v.opacities)) out.opacities = cleanOpacities(v.opacities);
  return Object.keys(out).length ? out : null;
}

/**
 * mapLayer as kept: the background, « Noms et réseaux », the overlays, and the GBIF distribution layer of the Carte's
 * panel (not a look: kept beside it, as before). `cadastre: true` from earlier versions becomes an overlay; `names:
 * false`, none of « Noms et réseaux » (anything else there, the usual ones).
 * @typedef {{ base: BaseKey, landmarks: string[], overlays: string[], distribution: boolean }} StoredLayers
 * @param {unknown} value @returns {StoredLayers}
 */
function cleanLayers(value) {
  const v = objectOf(value);
  return {
    base: isBaseKey(v.base) ? v.base : LOOK_DEFAULTS.base,
    landmarks: Array.isArray(v.landmarks) ? cleanLandmarks(v.landmarks) : v.names === false ? [] : [...LANDMARK_DEFAULTS],
    overlays: cleanOverlays(Array.isArray(v.overlays) ? v.overlays : v.cadastre === true ? ['cadastre'] : []),
    distribution: v.distribution === true
  };
}

/**
 * « Noms et réseaux » as mapLayer keeps them: nothing for the usual ones, `names: false` for none (as before: a version
 * of before reads it), else the list. @param {string[]} landmarks
 */
const landmarksKept = landmarks => !landmarks.length ? { names: false }
  : landmarks.join() === LANDMARK_DEFAULTS.join() ? {} : { landmarks };

// Their keys of before, their shapes of before; followed when another tab changes them.
const layersPref = definePref({
  key: config.storageKeys.mapLayer,
  fallback: {},
  clean: cleanLayers,
  store: s => ({ base: s.base, overlays: s.overlays, distribution: s.distribution, ...landmarksKept(s.landmarks) })
});
const opacityPref = definePref({
  key: config.storageKeys.overlayOpacity,
  fallback: {},
  clean: cleanOpacities,
  store: o => Object.keys(o).length ? o : null
});

/** @returns {Readonly<MapLook>} */
function buildLook() {
  const l = layersPref.get();
  // Frozen: one object shared by every map until it changes (never written to by one of them).
  return Object.freeze({
    base: l.base, landmarks: /** @type {string[]} */ (Object.freeze([...l.landmarks])), overlays: /** @type {string[]} */ (Object.freeze([...l.overlays])),
    opacities: Object.freeze({ ...opacityPref.get() })
  });
}

let look = buildLook();
let lookText = JSON.stringify(look);
/** A change under way (setMapLook writes two keys): said once, at its end. */
let holding = false;

/** Fires `change` (detail: the look) when the common look changes, here or in another tab. */
export const mapLookEvents = new EventTarget();

function relook() {
  if (holding) return;
  const next = buildLook();
  const text = JSON.stringify(next);
  if (text === lookText) return;
  look = next;
  lookText = text;
  mapLookEvents.dispatchEvent(new CustomEvent('change', { detail: look }));
}
layersPref.events.addEventListener('change', relook);
opacityPref.events.addEventListener('change', relook);

/** The common look now (frozen: the same object until it changes). @returns {Readonly<MapLook>} */
export const mapLook = () => look;

/**
 * Changes the common look (every open map follows): the fields given, from what is stored now (another tab's choices
 * since are kept). `opacities`: the whole set (the overlays' not given back to the usual one). @param {Partial<MapLook>} patch
 */
export function setMapLook(patch) {
  const own = cleanOwnLook(patch);
  if (!own) return;
  holding = true;
  try {
    if ('base' in own || 'landmarks' in own || 'overlays' in own) layersPref.set(cleanLayers({ ...layersPref.fresh(), ...own }));
    if (own.opacities) opacityPref.set(own.opacities);
  } finally { holding = false; }
  relook();
}

/** The common look back to the defaults (the photos, the usual « Noms et réseaux », no overlay, the usual opacities). */
export const resetMapLook = () => setMapLook(LOOK_DEFAULTS);

/**
 * The look a map shows: its own fields (`own`: its owner's, null: none), the common look's for the others.
 * @param {Partial<MapLook> | null | undefined} own @param {Readonly<MapLook>} [common] @returns {MapLook}
 */
export function lookFor(own, common = look) {
  return {
    base: own?.base ?? common.base,
    landmarks: [...(own?.landmarks ?? common.landmarks)],
    overlays: [...(own?.overlays ?? common.overlays)],
    opacities: { ...(own?.opacities ?? common.opacities) }
  };
}

/** The Carte's GBIF distribution layer, shown (« Sur cette carte » of its panel ▦; kept with the look, not a part of it). */
export const mapDistribution = () => layersPref.get().distribution;

/** @param {boolean} on */
export function setMapDistribution(on) {
  const now = layersPref.fresh();
  if (now.distribution !== on) layersPref.set({ ...now, distribution: on });
}

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
