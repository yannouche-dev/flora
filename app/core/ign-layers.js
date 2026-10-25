// @ts-check
// The IGN Géoplateforme layers of the maps, without Leaflet (the start of the app needs them for the maps' look,
// core/map-settings.js; the tiles themselves are core/ign.js's): the overlays — the app's own (core/map-layers.js, pure,
// with « Noms et réseaux » and the panel's themes) and the catalogue's layers added (read again when another tab adds
// one) —, the tile address of any layer. The backgrounds — the plan, the photos of each year, SPOT's — are
// core/backgrounds.js's. Which of them a map shows, and how opaque: the maps' look (core/map-settings.js).
// Layer identifiers and styles checked against the service's GetCapabilities (tools/api-health.mjs,
// scripts/build-ign-catalog.mjs: core/map-layers.js everyAppLayer, core/backgrounds.js everyBaseLayer).

import { readJSON, writeJSON } from './prefs.js';
import { onStorage } from './sync.js';
import { config } from '../config.js';
import { OVERLAYS, catalogRowOf } from './map-layers.js';

export { OVERLAYS };

const WMTS = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&TILEMATRIXSET=PM'
  + '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}';

/** @typedef {import('./map-layers.js').WmtsLayer} WmtsLayer @typedef {import('./map-layers.js').LayerDef} LayerDef */

/** A WMTS layer's tile address ({z}/{x}/{y} to fill): the same for Leaflet and MapLibre (gl-style.js). @param {WmtsLayer} def */
export const wmtsUrl = def => `${WMTS}&LAYER=${def.id}&STYLE=${encodeURIComponent(def.style || 'normal')}&FORMAT=${encodeURIComponent(def.format)}`;

// ── Every IGN layer ──────────────────────────────────────────────────────────

/** A layer of IGN's whole WMTS catalogue (GetCapabilities), compact and classified. @typedef {import('../../lib/ign-catalog.mjs').CatalogLayer} CatalogLayer */

/** A layer of the catalogue, as an overlay key. */
export const IGN_PREFIX = 'ign:';
const SAFE_ID = /^[A-Za-z0-9._:-]{1,160}$/;

/** The catalogue's layers added to the maps (key → definition), kept so they show at once and offline. @type {Map<string, LayerDef>} */
const added = new Map();
function readAdded() {
  for (const [key, def] of Object.entries(readJSON(config.storageKeys.ignLayers, {}))) {
    if (key.startsWith(IGN_PREFIX) && SAFE_ID.test(def?.layers?.[0]?.id || '')) added.set(key, def);
  }
}
readAdded();
// One added in another tab (written before the look that shows it): known here too, so that look keeps it.
onStorage(config.storageKeys.ignLayers, readAdded);

/** An overlay the maps know: one of the app's, or a layer of the catalogue added. @param {string} key */
export const isOverlay = key => Object.hasOwn(OVERLAYS, key) || added.has(key);

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

/**
 * An overlay's opacity unless chosen (the backgrounds are opaque). Those chosen are the maps' look
 * (core/map-settings.js: the common one under overlayOpacity, a map's own with its owner).
 */
export const DEFAULT_OPACITY = 0.8;

/**
 * This overlay's opacity unless chosen: the usual one, or its own for a layer of the panel's themes that has one
 * (core/map-layers.js CATALOG_ROWS: the shading, the photos seen through it) — whichever adds it (the panel, the
 * catalogue, a free layout's layers=), on every map, 2D and 3D; never written down (a look, opac=). @param {string} key
 */
export const defaultOpacity = key => (key.startsWith(IGN_PREFIX) ? catalogRowOf(key.slice(IGN_PREFIX.length))?.opacity : undefined) ?? DEFAULT_OPACITY;
