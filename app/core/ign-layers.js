// @ts-check
// The IGN Géoplateforme layers of the maps, without Leaflet (the start of the app needs isOverlay only, through
// core/sheet-blocks.js; the tiles themselves are core/ign.js's): the backgrounds and overlays, their tile address, the
// layers of the catalogue added to the maps, and the opacity chosen for each overlay — all read once, kept here only.
// Layer identifiers and styles checked against the service's GetCapabilities (tools/api-health.mjs,
// scripts/build-ign-catalog.mjs read them from this file).

import { readJSON, writeJSON } from './prefs.js';
import { config } from '../config.js';

const WMTS = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&TILEMATRIXSET=PM'
  + '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}';

/**
 * @typedef {{ id: string, format: string, style?: string, minNative?: number, maxNative?: number }} WmtsLayer
 * @typedef {{ label: string, layers: WmtsLayer[], hint?: string, group?: string }} LayerDef
 */

/** Background maps (one at a time). @type {Record<'photo' | 'plan', LayerDef>} */
export const BASES = {
  photo: { label: 'Photos aériennes', layers: [{ id: 'ORTHOIMAGERY.ORTHOPHOTOS', format: 'image/jpeg', maxNative: 19 }] },
  plan: { label: 'Plan IGN', layers: [{ id: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', format: 'image/png', maxNative: 19 }] }
};

/** Overlays, toggled on top. Protected areas: INPN / PatriNat data served by the Géoplateforme. @type {Record<string, LayerDef>} */
export const OVERLAYS = {
  cadastre: { label: 'Parcelles cadastrales', group: 'terrain', layers: [{ id: 'CADASTRALPARCELS.PARCELLAIRE_EXPRESS', format: 'image/png', maxNative: 19 }] },
  contours: { label: 'Courbes de niveau', group: 'terrain', layers: [{ id: 'ELEVATION.CONTOUR.LINE', format: 'image/png', minNative: 6, maxNative: 18 }] },
  forets: {
    label: 'Forêts publiques', group: 'rules', hint: 'ONF : domaniales et communales',
    layers: [{ id: 'FORETS.PUBLIQUES', format: 'image/png', style: 'FORETS PUBLIQUES ONF', minNative: 3, maxNative: 16 }]
  },
  parcs: { label: 'Parcs nationaux', group: 'rules', layers: [{ id: 'Patrinat_PN', format: 'image/png', minNative: 6, maxNative: 16 }] },
  reserves: {
    label: 'Réserves naturelles', group: 'rules', hint: 'nationales et régionales',
    layers: [{ id: 'Patrinat_RNN', format: 'image/png', minNative: 6, maxNative: 16 }, { id: 'Patrinat_RNR', format: 'image/png', minNative: 6, maxNative: 16 }]
  },
  biotopes: { label: 'Protection de biotope', group: 'rules', hint: 'arrêtés préfectoraux (APPB)', layers: [{ id: 'Patrinat_APB', format: 'image/png', minNative: 6, maxNative: 16 }] }
};

/** A WMTS layer's tile address ({z}/{x}/{y} to fill): the same for Leaflet and MapLibre (gl-style.js). @param {WmtsLayer} def */
export const wmtsUrl = def => `${WMTS}&LAYER=${def.id}&STYLE=${encodeURIComponent(def.style || 'normal')}&FORMAT=${encodeURIComponent(def.format)}`;

// ── Every IGN layer ──────────────────────────────────────────────────────────

/** A layer of IGN's whole WMTS catalogue (GetCapabilities), compact and classified. @typedef {import('../../lib/ign-catalog.mjs').CatalogLayer} CatalogLayer */

/** A layer of the catalogue, as an overlay key. */
export const IGN_PREFIX = 'ign:';
const SAFE_ID = /^[A-Za-z0-9._:-]{1,160}$/;

/** The catalogue's layers added to the maps (key → definition), kept so they show at once and offline. @type {Map<string, LayerDef>} */
const added = new Map();
for (const [key, def] of Object.entries(readJSON(config.storageKeys.ignLayers, {}))) {
  if (key.startsWith(IGN_PREFIX) && SAFE_ID.test(def?.layers?.[0]?.id || '')) added.set(key, def);
}

/** An overlay the maps know: one of the app's, or a layer of the catalogue added. @param {string} key */
export const isOverlay = key => key in OVERLAYS || added.has(key);

/** Its definition (null: unknown). @param {string} key @returns {LayerDef | null} */
export const overlayDef = key => OVERLAYS[key] || added.get(key) || null;

/**
 * A layer of the catalogue made an overlay (kept for next time): its readable title, with its variant for one of a
 * series (« Photographies aériennes par année — 1950-1965 »). @param {CatalogLayer} l @returns {string} its key
 */
export function addCatalogLayer(l) {
  const key = IGN_PREFIX + l.id;
  if (!SAFE_ID.test(l.id) || !/^image\/(png|jpeg)$/.test(l.format)) return key;
  const label = l.group && l.gtitle ? `${l.gtitle} — ${l.variant || l.title}` : l.label || l.title || l.id;
  added.set(key, { label, hint: l.id, group: 'ign', layers: [{ id: l.id, format: l.format, style: l.style || 'normal', minNative: l.minNative, maxNative: l.maxNative }] });
  writeJSON(config.storageKeys.ignLayers, Object.fromEntries(added));
  return key;
}

/**
 * The catalogue layer that is one of the app's own overlays (« Forêts publiques », « Parcs nationaux »…): its key, so
 * the list toggles that one rather than a copy of it. @param {string} id @returns {string | null}
 */
export function builtinKeyOf(id) {
  for (const [key, def] of Object.entries(OVERLAYS)) if (def.layers.length === 1 && def.layers[0].id === id) return key;
  return null;
}

// ── Opacity of each overlay ──────────────────────────────────────────────────

/** An overlay's opacity unless chosen (the backgrounds are opaque). */
export const DEFAULT_OPACITY = 0.8;

/** The opacity chosen for each overlay (key → 0…1), kept on the device for every map. @type {Record<string, number>} */
let opacities = {};
for (const [k, v] of Object.entries(readJSON(config.storageKeys.overlayOpacity, {}))) if (typeof v === 'number' && v >= 0 && v <= 1) opacities[k] = v;

/** An overlay's opacity (0…1). @param {string} key */
export const overlayOpacity = key => opacities[key] ?? DEFAULT_OPACITY;

/** Sets an overlay's opacity (0…1, by 0.05), kept for next time. @param {string} key @param {number} value */
export function setOverlayOpacity(key, value) {
  const v = Math.round(Math.min(1, Math.max(0, Number(value) || 0)) * 20) / 20;
  opacities = { ...opacities, [key]: v };
  if (v === DEFAULT_OPACITY) delete opacities[key];
  writeJSON(config.storageKeys.overlayOpacity, opacities);
  return v;
}
