// @ts-check
// The map cell's settings (« Écran sur mesure », registry.js `map`) that need words of their own: its IGN layers by
// short names (layers=znieff+n2000), its « Noms et réseaux » (noms=lieux+routes), its intents (one word, a bundle of
// settings: map(terrain)), the dates its points keep (when=mois), its controls by the cell's width (ui=auto). Pure (no
// DOM, no Leaflet), tested under Node; the rendering is cells.js' (dl-map).

import { CATALOG_ROWS, LANDMARKS, LANDMARKS_LISTED, LANDMARK_DEFAULTS } from '../core/map-layers.js';

/**
 * A layer of the Géoplateforme's catalogue (data/ign-catalog.json) the map adds as an overlay (core/ign.js
 * addCatalogLayer: its key « ign:<id> »): those of the panel's themes (core/map-layers.js CATALOG_ROWS), the same
 * whichever adds it.
 * @typedef {{ id: string, title: string, format: string, style: string, minNative: number, maxNative: number }} MapCatalogLayer
 * @typedef {{ label: string, keys: string[], catalog?: MapCatalogLayer[] }} MapLayer
 *   `keys`: the overlays of gf-map it shows (core/ign.js OVERLAYS' own keys, or « ign:<id> » for a catalogue's layer)
 */

const {
  znieff1: ZNIEFF1, znieff2: ZNIEFF2, habitats: SIC, oiseaux: ZPS, pnr: PNR, cen: CEN, rbio: RB, ombrage: SHADOW,
  pentes: SLOPES, bdforet: FOREST_TYPES, anciennes: OLD_FORESTS, haies: HEDGES, humides: WETLANDS
} = CATALOG_ROWS;
/** The rivers, the lakes (« Cours d’eau » of « Noms et réseaux » too: core/map-layers.js LANDMARKS — drawn once, core/ign.js landmarksShown). @type {MapCatalogLayer} */
const HYDRO = { id: 'HYDROGRAPHY.HYDROGRAPHY', title: 'Hydrographie', format: 'image/png', style: 'normal', minNative: 6, maxNative: 18 };

/** A catalogue layer's overlay key (core/ign.js IGN_PREFIX). @param {MapCatalogLayer} l */
const ign = l => 'ign:' + l.id;

/** A layer of the catalogue alone, by its row of the panel's themes (its title the panel's). @param {MapCatalogLayer} l @returns {MapLayer} */
const row = l => ({ label: l.title, keys: [ign(l)], catalog: [l] });

/**
 * The layers a map cell names (layers=znieff+n2000), in the order the address writes them: protected areas first,
 * then the land. Each its overlays (gf-map `overlays`): the app's own (core/ign.js OVERLAYS) or the catalogue's — those
 * of the panel's themes by their own short name (pentes, haies…: core/map-layers.js CATALOG_ROWS), the same overlay
 * whichever ticks it, the panel or the address.
 * @type {Record<string, MapLayer>}
 */
export const MAP_LAYERS = {
  znieff: { label: 'ZNIEFF (types I et II)', keys: [ign(ZNIEFF1), ign(ZNIEFF2)], catalog: [ZNIEFF1, ZNIEFF2] },
  znieff1: { label: 'ZNIEFF de type I', keys: [ign(ZNIEFF1)], catalog: [ZNIEFF1] },
  znieff2: { label: 'ZNIEFF de type II', keys: [ign(ZNIEFF2)], catalog: [ZNIEFF2] },
  n2000: { label: 'Natura 2000', keys: [ign(SIC), ign(ZPS)], catalog: [SIC, ZPS] },
  habitats: row(SIC),
  oiseaux: row(ZPS),
  parcs: { label: 'Parcs nationaux', keys: ['parcs'] },
  pnr: { label: 'Parcs naturels régionaux', keys: [ign(PNR)], catalog: [PNR] },
  reserves: { label: 'Réserves naturelles', keys: ['reserves'] },
  biotopes: { label: 'Protection de biotope', keys: ['biotopes'] },
  rbio: row(RB),
  cen: { label: 'Conservatoires d’espaces naturels', keys: [ign(CEN)], catalog: [CEN] },
  forets: { label: 'Forêts publiques', keys: ['forets'] },
  cadastre: { label: 'Parcelles cadastrales', keys: ['cadastre'] },
  courbes: { label: 'Courbes de niveau', keys: ['contours'] },
  estompage: row(SHADOW),
  pentes: row(SLOPES),
  bdforet: row(FOREST_TYPES),
  anciennes: row(OLD_FORESTS),
  haies: row(HEDGES),
  humides: row(WETLANDS),
  hydro: { label: 'Cours d’eau', keys: [ign(HYDRO)], catalog: [HYDRO] }
};

/**
 * Other names of the layers (folded, no spaces) → their name. One directive of Natura 2000 (sic, zps, zsc) is still
 * n2000, both; habitats and oiseaux, one each.
 */
export const MAP_LAYER_ALIASES = {
  natura: 'n2000', natura2000: 'n2000', sic: 'n2000', zps: 'n2000', zsc: 'n2000',
  directivehabitats: 'habitats', directiveoiseaux: 'oiseaux',
  parc: 'parcs', parcsnationaux: 'parcs', pn: 'parcs', parcsregionaux: 'pnr', reserve: 'reserves', reservesnaturelles: 'reserves', rn: 'reserves',
  biotope: 'biotopes', appb: 'biotopes', reservesbiologiques: 'rbio', reservebiologique: 'rbio', conservatoires: 'cen', foret: 'forets', onf: 'forets', parcelles: 'cadastre',
  contours: 'courbes', niveaux: 'courbes', relief: 'estompage', ombrage: 'estompage', pente: 'pentes', fortespentes: 'pentes',
  peuplements: 'bdforet', typesdeforets: 'bdforet', foretsanciennes: 'anciennes', haie: 'haies', bocage: 'haies',
  zoneshumides: 'humides', tourbieres: 'humides', eau: 'hydro', rivieres: 'hydro', coursdeau: 'hydro'
};

// ── Noms et réseaux (noms=) ─────────────────────────────────────────────────

/**
 * « Noms et réseaux » as a map cell names them (noms=lieux+routes: core/map-layers.js LANDMARKS' keys), in the order
 * the address writes them and the panel ▦ lists them (core/map-layers.js LANDMARKS_LISTED): the usual three first (the
 * places' names, the roads, the rivers), then the railways, the buildings, the boundaries.
 * @type {Record<string, string>}
 */
export const MAP_LANDMARKS = Object.fromEntries(LANDMARKS_LISTED
  .map(k => [k, /** @type {import('../core/map-layers.js').Landmark} */ (LANDMARKS.find(l => l.key === k)).label]));

/** Other names of « Noms et réseaux » (folded, no spaces) → their name. */
export const MAP_LANDMARK_ALIASES = {
  villes: 'lieux', villages: 'lieux', toponymes: 'lieux', nomsdelieux: 'lieux', lieuxdits: 'lieux', route: 'routes',
  hydro: 'eau', rivieres: 'eau', coursdeau: 'eau', hydrographie: 'eau', train: 'rail', fer: 'rail', voiesferrees: 'rail',
  batiments: 'bati', constructions: 'bati', communes: 'limites', admin: 'limites', limitesadministratives: 'limites'
};

/**
 * noms= as the address writes them: 1 the usual ones (core/map-layers.js LANDMARK_DEFAULTS: what noms=1 always
 * said), 0 none, else their names in their order (MAP_LANDMARKS). @param {string[]} keys @returns {string}
 */
export function landmarksText(keys) {
  const on = Object.keys(MAP_LANDMARKS).filter(k => keys.includes(k));
  if (!on.length) return '0';
  return on.length === LANDMARK_DEFAULTS.length && LANDMARK_DEFAULTS.every(k => on.includes(k)) ? '1' : on.join('+');
}

/** The catalogue's layers these layers need added to the maps (core/ign.js addCatalogLayer) before they show. @param {string[]} names */
export const catalogLayers = names => names.flatMap(n => MAP_LAYERS[n]?.catalog ?? []);

/**
 * The map's intents: one word, a bundle of its settings, as the address writes them (registry.js reads them as if
 * they were written; a setting written beside the word wins: map(terrain;base=plan)). `explorer`: none, the map as it is.
 * @type {Record<string, { label: string, about: string, set: Record<string, string> }>}
 */
export const MAP_INTENTS = {
  explorer: { label: 'Explorer', about: 'la carte telle quelle', set: {} },
  terrain: { label: 'Sur le terrain', about: 'photos aériennes, autour de moi (ma position suivie), commandes compactes', set: { autour: '1', base: 'photo', ui: 'compacte' } },
  floraison: { label: 'Floraison du moment', about: 'les observations de ce mois-ci, la plante courante en groupes', set: { when: 'mois', regroupe: '1' } },
  protege: { label: 'Espaces protégés', about: 'ZNIEFF, Natura 2000, parcs nationaux, réserves, biotopes', set: { layers: 'znieff+n2000+parcs+reserves+biotopes' } },
  repartition: { label: 'Répartition de la plante', about: 'la plante courante seule, toutes ses observations (iNaturalist et GBIF)', set: { src: 'inat+gbif', suit: '0', plante: 'seule', liste: 'zone' } },
  relief: { label: 'Relief', about: 'la carte en 3D', set: { '3d': '1' } }
};

/** Other names of the intents (folded, no spaces) → their name. */
export const MAP_INTENT_ALIASES = {
  explore: 'explorer', exploration: 'explorer', defaut: 'explorer', field: 'terrain', balade: 'terrain', sortie: 'terrain',
  fleurs: 'floraison', bloom: 'floraison', protection: 'protege', proteges: 'protege', protegee: 'protege', protegees: 'protege',
  distribution: 'repartition', aire: 'repartition', montagne: 'relief'
};

/**
 * An observation's date kept by `when`: always; this year's (annee); this month's — of any year: what flowers now
 * (mois). A point without a date is only kept « toujours ». @param {string | null | undefined} date « 2026-05-14 »
 * @param {string} when @param {Date} [now]
 */
export function inWhen(date, when, now = new Date()) {
  if (when !== 'annee' && when !== 'mois') return true;
  const m = /^(\d{4})-(\d{2})/.exec(String(date ?? ''));
  if (!m) return false;
  return when === 'annee' ? Number(m[1]) === now.getFullYear() : Number(m[2]) === now.getMonth() + 1;
}

/** iNaturalist's taxon of all plants (a map of France or the world when the search keeps them all). */
export const PLANTAE = 47126;

/** What a map of France or of the world frames once (portee=): [lon, lat] corners. */
export const WIDE_FRAMES = { france: [[-5.14, 41.33], [9.56, 51.09]], monde: [[-170, -56], [180, 75]] };

/**
 * A map of France or of the world (portee=): where these plants were observed, iNaturalist's tiles — squares far out
 * (grid, to zoom 9), points closer —, of a period (`when`: core/nearby.js periodQuery), as the zone's filters say
 * (`filters`: core/observations.js inatQuery — the quality grades, the cultivated plants left out…; '' every
 * observation). `taxa`: their iNaturalist taxa (null: all plants), the current plant's in its colour on top. Each tile
 * layer: its key, its address, its zooms.
 * @param {number[] | null} taxa @param {string} when @param {number | null} [plant] the current plant's taxon @param {string} [filters]
 * @returns {{ key: string, url: string, minZoom?: number, maxZoom?: number, opacity: number }[]}
 */
export function inatTiles(taxa, when, plant = null, filters = '') {
  const api = 'https://api.inaturalist.org/v1';
  const of = (/** @type {number[]} */ ids, /** @type {string} */ color) => `taxon_id=${ids.join(',')}${filters}${when}&color=${encodeURIComponent(color)}`;
  const all = of(taxa ?? [PLANTAE], '#5c8a00');
  /** @type {{ key: string, url: string, minZoom?: number, maxZoom?: number, opacity: number }[]} */
  const layers = [
    { key: 'grid', url: `${api}/grid/{z}/{x}/{y}.png?${all}`, maxZoom: 9, opacity: 0.75 },
    { key: 'points', url: `${api}/points/{z}/{x}/{y}.png?${all}`, minZoom: 10, opacity: 0.9 }
  ];
  if (plant) layers.push({ key: 'plant', url: `${api}/points/{z}/{x}/{y}.png?${of([plant], '#e0245e')}`, opacity: 1 });
  return layers;
}

/** Under this width (px), a map cell « auto » has compact controls. */
export const COMPACT_WIDTH = 360;

/**
 * The map's controls as drawn: `ui` as written, « auto » by the cell's width (compact under 360 px; unknown yet: complete).
 * @param {string | null | undefined} ui @param {number} [width] @returns {'complete' | 'compacte' | 'nue'}
 */
export function uiMode(ui, width = 0) {
  if (ui === 'complete' || ui === 'compacte' || ui === 'nue') return ui;
  return width > 0 && width < COMPACT_WIDTH ? 'compacte' : 'complete';
}

/**
 * The controls a map cell draws over its map (ctl=rayon+lieu+…), in the order the address writes them, each in its
 * fixed place: the address search on top (lieu), the layers button at its end or top right (couches), under it
 * « Me localiser » (gps — and « Autour de moi » in the zone), the 2D / 3D switch (3d) and the other background's
 * thumbnail (fond); the zone with its radius top left (rayon: its panel, and a handle on the circle's edge); bottom
 * left the current plant's chip (plante) and the legend (legende) over the zoom (zoom); bottom right the period's
 * chips (periode) and the counter (compte).
 * @type {Record<string, { label: string }>}
 */
export const MAP_CONTROLS = {
  rayon: { label: 'Zone et poignée du rayon' },
  lieu: { label: 'Recherche d’adresse' },
  gps: { label: 'Me localiser, autour de moi' },
  couches: { label: 'Bouton des couches' },
  '3d': { label: 'Bascule 2D / 3D' },
  fond: { label: 'Vignette de l’autre fond' },
  plante: { label: 'Plante courante' },
  periode: { label: 'Période' },
  compte: { label: 'Compteur' },
  legende: { label: 'Légende' },
  zoom: { label: 'Zoom' }
};

/** Other names of the controls (folded, no spaces) → their name. */
export const MAP_CONTROL_ALIASES = {
  zone: 'rayon', poignee: 'rayon', radius: 'rayon', cercle: 'rayon', recherche: 'lieu', adresse: 'lieu', search: 'lieu',
  localiser: 'gps', locate: 'gps', position: 'gps', moi: 'gps', layers: 'couches', calques: 'couches', couche: 'couches',
  relief: '3d', '2d3d': '3d', base: 'fond', fonds: 'fond', vignette: 'fond', plant: 'plante', puce: 'plante',
  when: 'periode', dates: 'periode', compteur: 'compte', count: 'compte', nombre: 'compte', legend: 'legende'
};

/** The controls of complete ones (ui=complete; auto on a wide cell). */
const COMPLETE_CONTROLS = ['rayon', 'lieu', 'gps', 'couches', '3d', 'compte', 'zoom', 'plante'];

/** What each intent adds to them (nue: none, whatever the intent). @type {Record<string, string[]>} */
export const INTENT_CONTROLS = { floraison: ['periode'], protege: ['legende'], repartition: ['plante'], terrain: ['gps'] };

/**
 * The controls a map cell has when ctl= is not written: its `ui`'s set — complete (`auto` too, whatever the width:
 * the address does not know it), compacte the same without the address search, nue none — and its intent's, in the
 * address' order. @param {string | null | undefined} ui @param {string | null | undefined} [intent] @returns {string[]}
 */
export function defaultControls(ui, intent) {
  if (ui === 'nue') return [];
  const base = ui === 'compacte' ? COMPLETE_CONTROLS.filter(c => c !== 'lieu') : COMPLETE_CONTROLS;
  const on = new Set([...base, ...(INTENT_CONTROLS[intent ?? ''] ?? [])]);
  return Object.keys(MAP_CONTROLS).filter(c => on.has(c));
}

/**
 * The controls drawn, and how: ctl= as written (exactly that set), else by `ui` (auto: by the cell's width) and the
 * intent; compact (smaller, icons alone, the zone a pill) when the controls are compact.
 * @param {{ ctl?: string[] | null, ui?: string | null, intent?: string | null }} params @param {number} [width]
 * @returns {{ on: Set<string>, compact: boolean, mode: 'complete' | 'compacte' | 'nue' }}
 */
export function mapControls(params, width = 0) {
  const mode = uiMode(params.ui, width);
  const on = new Set(params.ctl ?? defaultControls(mode, params.intent));
  return { on, compact: mode === 'compacte', mode };
}

/** Within this share of a stop, a radius dragged sticks to it. */
export const SNAP = 0.06;

/**
 * A radius dragged (the circle's handle): the stop it is near (within SNAP), else itself rounded (10 m under 1 km,
 * 100 m beyond), between 100 m and 50 km. @param {number} m @param {number[]} stops @param {number} [tol] @returns {number}
 */
export function snapRadius(m, stops, tol = SNAP) {
  const near = stops.find(s => Math.abs(m - s) <= s * tol);
  if (near !== undefined) return near;
  const r = m < 1000 ? Math.round(m / 10) * 10 : Math.round(m / 100) * 100;
  return Math.min(50_000, Math.max(100, r));
}

// ── What a map cell keeps of what was done on it (registry.js `own`: written by its controls, not by the editor) ──

/** A catalogue layer's id as the maps take it (core/ign.js SAFE_ID). */
const SAFE_ID = /^[A-Za-z0-9._:-]{1,160}$/;

/**
 * A layer of IGN's whole catalogue named in layers= (« ign:<id> », added by the Carte panel's « Toutes les couches »):
 * its name when it is one of MAP_LAYERS alone (ign:Patrinat_PNR is pnr), else itself; undefined: not one.
 * @param {string} word @returns {string | undefined}
 */
export function layerWord(word) {
  const m = /^ign:(.+)$/i.exec(String(word).trim());
  if (!m || !SAFE_ID.test(m[1])) return undefined;
  const key = 'ign:' + m[1];
  return Object.entries(MAP_LAYERS).find(([, l]) => l.keys.length === 1 && l.keys[0] === key)?.[0] ?? key;
}

/** A layer's name as written (a name, one of its other names, « ign:<id> »), canonical; undefined: none. @param {string} word */
function layerName(word) {
  const k = String(word).toLowerCase().normalize('NFD').replace(/[̀-ͯ\s]/g, '');
  if (k in MAP_LAYERS) return k;
  const alias = /** @type {Record<string, string>} */ (MAP_LAYER_ALIASES)[k];
  return alias ?? layerWord(word);
}

/**
 * The overlays of gf-map (their keys, in the order drawn) as layers= names them: a layer of several overlays (znieff:
 * its two types; n2000: its two directives) when all of them are there, each overlay of the app's own by its name
 * (contours: courbes), a catalogue's « ign:<id> » — in the order the overlays are drawn (the first of each layer).
 * @param {string[]} keys @returns {string[]}
 */
export function layersOf(keys) {
  const on = new Set(keys), used = new Set(), out = [];
  for (const key of keys) {
    if (used.has(key)) continue;
    const fits = Object.entries(MAP_LAYERS).filter(([, l]) => l.keys.includes(key) && l.keys.every(k => on.has(k) && !used.has(k)))
      .sort((a, b) => b[1].keys.length - a[1].keys.length);
    const name = fits[0]?.[0] ?? layerWord(key);
    if (!name) continue;
    for (const k of fits[0]?.[1].keys ?? [key]) used.add(k);
    out.push(name);
  }
  return out;
}

/** The overlays of gf-map these layers show, in their order, a catalogue's « ign:<id> » itself. @param {string[]} names @returns {string[]} */
export const overlaysOf = names => [...new Set(names.flatMap(n => MAP_LAYERS[n]?.keys ?? (n.startsWith('ign:') ? [n] : [])))];

/**
 * The layers' opacity as written (opac=znieff.60+ign:XYZ.40: each layer's name, a dot, its opacity in %), canonical;
 * undefined: not that. @param {string} text @returns {string | undefined}
 */
export function readOpacities(text) {
  const out = [];
  for (const part of String(text).split(/[+\s]+/).filter(Boolean)) {
    const m = /^(.+)\.(\d{1,3})$/.exec(part);
    const name = m ? layerName(m[1]) : undefined;
    if (!m || !name || Number(m[2]) > 100) return undefined;
    out.push(`${name}.${Number(m[2])}`);
  }
  return out.length ? out.join('+') : undefined;
}

/** The opacity of each overlay (0…1) opac= gives. @param {string | null | undefined} text @returns {Record<string, number>} */
export function opacitiesOf(text) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const part of String(text ?? '').split('+').filter(Boolean)) {
    const m = /^(.+)\.(\d{1,3})$/.exec(part);
    if (m) for (const key of overlaysOf([m[1]])) out[key] = Math.min(100, Number(m[2])) / 100;
  }
  return out;
}

/**
 * opac= for these overlays' opacities (0…1): by layer, as layers= names them (a layer of several overlays, its first's),
 * only those not at their usual one (`def`: core/ign-layers.js defaultOpacity — the shading's 40 % left unsaid); null:
 * none. @param {Record<string, number>} opacities @param {string[]} keys the overlays shown
 * @param {(key: string) => number} def an overlay's opacity unless said @returns {string | null}
 */
export function opacText(opacities, keys, def) {
  const parts = layersOf(keys).map(name => {
    const key = overlaysOf([name])[0], v = opacities[key];
    return v === undefined || Math.abs(v - def(key)) < 0.001 ? null : `${name}.${Math.round(v * 100)}`;
  }).filter(Boolean);
  return parts.length ? parts.join('+') : null;
}

/** @typedef {{ lat: number, lon: number, zoom: number, pitch: number, bearing: number }} MapView */

/** A number rounded to `d` decimals. @param {number} n @param {number} d */
const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

/** A view as vue= writes it: « 45.77123:3.08456:13.5 », and « :60:-20 » after it when tilted or turned (3D). @param {MapView} v */
export const viewText = v => [round(v.lat, 5), round(v.lon, 5), round(v.zoom, 2)]
  .concat(Math.round(v.pitch) || Math.round(v.bearing) ? [Math.round(v.pitch), Math.round(v.bearing)] : []).join(':');

/** A view as written (vue=), or null: not one. @param {string | null | undefined} text @returns {MapView | null} */
export function viewOf(text) {
  const n = String(text ?? '').split(':').map(x => x.trim() === '' ? NaN : Number(x));
  if ((n.length !== 3 && n.length !== 5) || n.some(x => !Number.isFinite(x))) return null;
  const [lat, lon, zoom, pitch = 0, bearing = 0] = n;
  if (Math.abs(lat) > 85 || Math.abs(lon) > 180 || zoom < 0 || zoom > 22 || pitch < 0 || pitch > 85 || Math.abs(bearing) > 180) return null;
  return { lat, lon, zoom, pitch, bearing };
}

/** vue= as written, canonical; undefined: not a view. @param {string} text */
export const readView = text => { const v = viewOf(text); return v ? viewText(v) : undefined; };
