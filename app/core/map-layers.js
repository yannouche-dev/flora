// @ts-check
// The IGN Géoplateforme layers the maps offer over their background, by theme: pure, without import (the start of the
// app knows them for the maps' look, core/map-settings.js; the tools check each is still served: everyAppLayer(),
// tools/api-health.mjs, scripts/build-ign-catalog.mjs).
//  - OVERLAYS: the app's own overlays (core/ign-layers.js gives them with the catalogue's layers added, their tiles
//    core/ign.js's);
//  - LANDMARKS: « Noms et réseaux » — the places' names, the roads, the rivers (on by default), the railways, the
//    buildings, the administrative boundaries —, drawn over the aerial photos and SPOT's images, above every overlay,
//    opaque (the look's `landmarks`, core/map-settings.js; the plan has its own: core/backgrounds.js takesLandmarks);
//  - CATALOG_ROWS: layers of IGN's catalogue the panel ▦ offers by theme, made overlays when first ticked (core/ign-layers.js
//    addCatalogLayer: « ign:<id> », the same as the catalogue's list ticks);
//  - PANEL: those themes, in their order, each its rows.
// Each layer's identifier, format, style and native zooms are the Géoplateforme catalogue's (data/ign-catalog.json:
// tests/unit/map-layers.test.mjs). The backgrounds — the plan, the photos of each year, SPOT's — are
// core/backgrounds.js's.

/**
 * A WMTS layer of the Géoplateforme: its identifier, format, style (none: « normal »), native zooms (none: 0 and 19).
 * @typedef {{ id: string, format: string, style?: string, minNative?: number, maxNative?: number }} WmtsLayer
 * An overlay: its name, its layers, what it shows (under its name in the panel ▦; a catalogue's layer added: its
 * identifier, core/ign-layers.js).
 * @typedef {{ label: string, layers: WmtsLayer[], hint?: string, group?: string }} LayerDef
 */

/**
 * Overlays, toggled on top (the panel ▦ names each in its theme: PANEL). Protected areas: INPN / PatriNat data served
 * by the Géoplateforme. @type {Record<string, LayerDef>}
 */
export const OVERLAYS = {
  cadastre: {
    label: 'Parcelles cadastrales', hint: 'le propriétaire décide de la cueillette',
    layers: [{ id: 'CADASTRALPARCELS.PARCELLAIRE_EXPRESS', format: 'image/png', maxNative: 19 }]
  },
  contours: { label: 'Courbes de niveau', layers: [{ id: 'ELEVATION.CONTOUR.LINE', format: 'image/png', minNative: 6, maxNative: 18 }] },
  forets: {
    label: 'Forêts publiques', hint: 'ONF : domaniales et communales',
    layers: [{ id: 'FORETS.PUBLIQUES', format: 'image/png', style: 'FORETS PUBLIQUES ONF', minNative: 3, maxNative: 16 }]
  },
  parcs: { label: 'Parcs nationaux', layers: [{ id: 'Patrinat_PN', format: 'image/png', minNative: 6, maxNative: 16 }] },
  reserves: {
    label: 'Réserves naturelles', hint: 'nationales et régionales',
    layers: [{ id: 'Patrinat_RNN', format: 'image/png', minNative: 6, maxNative: 16 }, { id: 'Patrinat_RNR', format: 'image/png', minNative: 6, maxNative: 16 }]
  },
  biotopes: { label: 'Protection de biotope', hint: 'arrêtés préfectoraux (APPB)', layers: [{ id: 'Patrinat_APB', format: 'image/png', minNative: 6, maxNative: 16 }] }
};

// ── Noms et réseaux ─────────────────────────────────────────────────────────

/**
 * One of « Noms et réseaux »: its key (the look's `landmarks`, a free layout's noms=), its name and what it shows, its
 * WMTS layer (PNG: see-through but for its lines and words, laid over the pictures).
 * @typedef {{ key: string, label: string, hint?: string, layer: WmtsLayer }} Landmark
 */

/** @param {string} key @param {string} label @param {string | null} hint @param {string} id @param {number} maxNative @returns {Landmark} */
const landmark = (key, label, hint, id, maxNative) =>
  Object.freeze({ key, label, ...(hint ? { hint } : {}), layer: Object.freeze({ id, format: 'image/png', minNative: 6, maxNative }) });

/**
 * « Noms et réseaux », bottom first: each drawn over the one before it (core/ign.js LANDMARK_Z and up), the places'
 * names over all. From their first native zoom (6), not before (further out, too many tiles).
 * @type {readonly Landmark[]}
 */
export const LANDMARKS = Object.freeze([
  landmark('limites', 'Limites administratives', 'communes, départements, régions', 'LIMITES_ADMINISTRATIVES_EXPRESS.LATEST', 16),
  landmark('bati', 'Bâtiments', 'contours des constructions', 'BUILDINGS.BUILDINGS', 18),
  landmark('rail', 'Voies ferrées', null, 'TRANSPORTNETWORKS.RAILWAYS', 18),
  landmark('routes', 'Routes', 'réseau routier', 'TRANSPORTNETWORKS.ROADS', 18),
  landmark('eau', 'Cours d’eau', 'rivières, ruisseaux, lacs et étangs', 'HYDROGRAPHY.HYDROGRAPHY', 18),
  landmark('lieux', 'Noms de lieux', 'villes, villages, lieux-dits', 'GEOGRAPHICALNAMES.NAMES', 18)
]);

/** Those shown unless chosen otherwise: the roads, the rivers, the places' names (the maps' look of before: « les noms »). */
export const LANDMARK_DEFAULTS = Object.freeze(['routes', 'eau', 'lieux']);

/**
 * Their keys in the order the panel ▦ lists them and a free layout's noms= writes them: the usual three first (the
 * places' names, the roads, the rivers), then the railways, the buildings, the boundaries.
 */
export const LANDMARKS_LISTED = Object.freeze(['lieux', 'routes', 'eau', 'rail', 'bati', 'limites']);

/** The one of « Noms et réseaux » a WMTS layer is (its key), null for none (the catalogue's list toggles it). @param {string} id */
export const landmarkOf = id => LANDMARKS.find(l => l.layer.id === id)?.key ?? null;

/**
 * How far in they show (Leaflet's zoom): one past the last native zoom of most (18), their words twice as big there,
 * never eight times (21, a plant's); the boundaries as far, a line thickened.
 */
export const LANDMARK_MAX_ZOOM = 19;

/**
 * « Noms et réseaux » chosen, from anything (a stored look, a file, an address): only theirs, each once, bottom first.
 * @param {unknown} list @returns {string[]}
 */
export const cleanLandmarks = list => Array.isArray(list) ? LANDMARKS.map(l => l.key).filter(k => list.includes(k)) : [];

// ── The panel's themes ──────────────────────────────────────────────────────

/**
 * A layer of IGN's catalogue the panel ▦ offers in one of its themes, as core/ign-layers.js addCatalogLayer takes it:
 * named `title` there and among the layers shown; `hint`: what it shows, under its name; `opacity`: its own when first
 * ticked (the shading: the photos seen through it).
 * @typedef {{ id: string, title: string, format: string, style: string, minNative: number, maxNative: number, hint?: string, opacity?: number }} CatalogRow
 */

/** A protected area of INPN / PatriNat (the catalogue's « Patrinat_* »). @param {string} id @param {string} title @param {string} [hint] @returns {CatalogRow} */
const patrinat = (id, title, hint) => ({ id: 'Patrinat_' + id, title, format: 'image/png', style: 'normal', minNative: 6, maxNative: 16, ...(hint ? { hint } : {}) });

/**
 * The catalogue's layers of the panel's themes, by key (none an overlay's: PANEL names both), named as there whichever
 * list ticks them (catalogRowOf). @type {Readonly<Record<string, CatalogRow>>}
 */
export const CATALOG_ROWS = Object.freeze({
  ombrage: { id: 'ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW', title: 'Ombrage du relief', hint: 'relief ombré, à 40 %', format: 'image/png', style: 'estompage_grayscale', minNative: 0, maxNative: 15, opacity: 0.4 },
  pentes: { id: 'GEOGRAPHICALGRIDSYSTEMS.SLOPES.MOUNTAIN', title: 'Fortes pentes', hint: 'plus de 30°', format: 'image/png', style: 'normal', minNative: 0, maxNative: 17 },
  bdforet: { id: 'LANDCOVER.FORESTINVENTORY.V2', title: 'Types de forêts', hint: 'BD Forêt : feuillus, conifères, landes', format: 'image/png', style: 'normal', minNative: 6, maxNative: 16 },
  anciennes: { id: 'IGNF_FORETS-ANCIENNES', title: 'Forêts anciennes', hint: 'déjà boisées au XIXᵉ siècle', format: 'image/png', style: 'normal', minNative: 6, maxNative: 16 },
  haies: { id: 'IGNF_BD-HAIE-V1_2020', title: 'Haies', hint: 'BD Haie 2020', format: 'image/png', style: 'normal', minNative: 4, maxNative: 18 },
  humides: { id: 'TOURBIERES_ZONES-HUMIDES.BCAE', title: 'Zones humides et tourbières', hint: 'protégées par la PAC (BCAE 2)', format: 'image/png', style: 'normal', minNative: 6, maxNative: 16 },
  rbio: patrinat('RB', 'Réserves biologiques', 'forêts publiques, dirigées ou intégrales'),
  habitats: patrinat('SIC', 'Natura 2000 — habitats (ZSC, SIC)'),
  oiseaux: patrinat('ZPS', 'Natura 2000 — oiseaux (ZPS)'),
  pnr: patrinat('PNR', 'Parcs naturels régionaux'),
  cen: patrinat('CEN', 'Conservatoires d’espaces naturels'),
  znieff1: patrinat('ZNIEFF1', 'ZNIEFF de type I'),
  znieff2: patrinat('ZNIEFF2', 'ZNIEFF de type II')
});

/** The row of the panel's themes a catalogue's layer is (by its identifier), null for none. @param {string} id @returns {CatalogRow | null} */
export const catalogRowOf = id => Object.values(CATALOG_ROWS).find(r => r.id === id) ?? null;

/**
 * The panel's themes over the background, in their order (« Noms et réseaux », LANDMARKS, come before them): each its
 * parts — a title of its own or none, a note, its rows: an overlay (OVERLAYS) or a catalogue's layer (CATALOG_ROWS), by key.
 * @typedef {{ title?: string, note?: string, rows: readonly string[] }} PanelPart
 * @typedef {{ key: string, title: string, parts: readonly PanelPart[] }} PanelGroup
 * @type {readonly PanelGroup[]}
 */
export const PANEL = Object.freeze([
  { key: 'relief', title: 'Relief', parts: [{ rows: ['contours', 'ombrage', 'pentes'] }] },
  { key: 'milieux', title: 'Forêts, haies et zones humides', parts: [{ rows: ['bdforet', 'anciennes', 'haies', 'humides'] }] },
  {
    key: 'espaces', title: 'Espaces protégés et propriété', parts: [
      { title: 'Protection réglementaire', rows: ['parcs', 'reserves', 'biotopes', 'rbio'] },
      { title: 'Gestion contractuelle', rows: ['habitats', 'oiseaux', 'pnr', 'cen'] },
      { title: 'Inventaires', note: 'Sans règle propre : des secteurs connus pour leur faune et leur flore.', rows: ['znieff1', 'znieff2'] },
      { title: 'Propriété', rows: ['forets', 'cadastre'] }
    ]
  }
]);

/**
 * Every WMTS layer of the overlays, of « Noms et réseaux » and of the panel's themes, once each (the tools check each
 * is still served; the backgrounds': core/backgrounds.js everyBaseLayer). @returns {WmtsLayer[]}
 */
export const everyAppLayer = () => [...new Map([
  ...Object.values(OVERLAYS).flatMap(o => o.layers), ...LANDMARKS.map(l => l.layer), ...Object.values(CATALOG_ROWS)
].map(l => [l.id, l])).values()];
