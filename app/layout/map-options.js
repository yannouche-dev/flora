// @ts-check
// The map cell's settings (« Disposition libre », registry.js `map`) that need words of their own: its IGN layers by
// short names (layers=znieff+n2000), its intents (one word, a bundle of settings: map(terrain)), the dates its points
// keep (when=mois), its controls by the cell's width (ui=auto). Pure (no DOM, no Leaflet), tested under Node; the
// rendering is cells.js' (dl-map).

/**
 * A layer of the Géoplateforme's catalogue (data/ign-catalog.json) the map adds as an overlay (core/ign.js
 * addCatalogLayer: its key « ign:<id> »).
 * @typedef {{ id: string, title: string, format: string, style: string, minNative: number, maxNative: number }} MapCatalogLayer
 * @typedef {{ label: string, keys: string[], catalog?: MapCatalogLayer[] }} MapLayer
 *   `keys`: the overlays of gf-map it shows (core/ign.js OVERLAYS' own keys, or « ign:<id> » for a catalogue's layer)
 */

/** A protected area of INPN / PatriNat served by the Géoplateforme (the catalogue's « Patrinat_* »). @param {string} id @param {string} title @returns {MapCatalogLayer} */
const patrinat = (id, title) => ({ id: 'Patrinat_' + id, title, format: 'image/png', style: 'normal', minNative: 6, maxNative: 16 });

const ZNIEFF1 = patrinat('ZNIEFF1', 'ZNIEFF de type I');
const ZNIEFF2 = patrinat('ZNIEFF2', 'ZNIEFF de type II');
const SIC = patrinat('SIC', 'Natura 2000 — directive Habitats (SIC, ZSC)');
const ZPS = patrinat('ZPS', 'Natura 2000 — directive Oiseaux (ZPS)');
const PNR = patrinat('PNR', 'Parcs naturels régionaux');
const CEN = patrinat('CEN', 'Conservatoires d’espaces naturels');
/** @type {MapCatalogLayer} */
const SHADOW = { id: 'ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW', title: 'Estompage (relief ombré)', format: 'image/png', style: 'estompage_grayscale', minNative: 0, maxNative: 15 };
/** @type {MapCatalogLayer} */
const HYDRO = { id: 'HYDROGRAPHY.HYDROGRAPHY', title: 'Hydrographie', format: 'image/png', style: 'normal', minNative: 6, maxNative: 18 };

/** A catalogue layer's overlay key (core/ign.js IGN_PREFIX). @param {MapCatalogLayer} l */
const ign = l => 'ign:' + l.id;

/**
 * The layers a map cell names (layers=znieff+n2000), in the order the address writes them: protected areas first,
 * then the land. Each its overlays (gf-map `overlays`): the app's own (core/ign.js OVERLAYS) or the catalogue's.
 * @type {Record<string, MapLayer>}
 */
export const MAP_LAYERS = {
  znieff: { label: 'ZNIEFF (types I et II)', keys: [ign(ZNIEFF1), ign(ZNIEFF2)], catalog: [ZNIEFF1, ZNIEFF2] },
  znieff1: { label: 'ZNIEFF de type I', keys: [ign(ZNIEFF1)], catalog: [ZNIEFF1] },
  znieff2: { label: 'ZNIEFF de type II', keys: [ign(ZNIEFF2)], catalog: [ZNIEFF2] },
  n2000: { label: 'Natura 2000', keys: [ign(SIC), ign(ZPS)], catalog: [SIC, ZPS] },
  parcs: { label: 'Parcs nationaux', keys: ['parcs'] },
  pnr: { label: 'Parcs naturels régionaux', keys: [ign(PNR)], catalog: [PNR] },
  reserves: { label: 'Réserves naturelles', keys: ['reserves'] },
  biotopes: { label: 'Protection de biotope', keys: ['biotopes'] },
  cen: { label: 'Conservatoires d’espaces naturels', keys: [ign(CEN)], catalog: [CEN] },
  forets: { label: 'Forêts publiques', keys: ['forets'] },
  cadastre: { label: 'Parcelles cadastrales', keys: ['cadastre'] },
  courbes: { label: 'Courbes de niveau', keys: ['contours'] },
  estompage: { label: 'Estompage (relief)', keys: [ign(SHADOW)], catalog: [SHADOW] },
  hydro: { label: 'Cours d’eau', keys: [ign(HYDRO)], catalog: [HYDRO] }
};

/** Other names of the layers (folded, no spaces) → their name. */
export const MAP_LAYER_ALIASES = {
  natura: 'n2000', natura2000: 'n2000', sic: 'n2000', zps: 'n2000', zsc: 'n2000',
  parc: 'parcs', parcsnationaux: 'parcs', pn: 'parcs', parcsregionaux: 'pnr', reserve: 'reserves', reservesnaturelles: 'reserves', rn: 'reserves',
  biotope: 'biotopes', appb: 'biotopes', conservatoires: 'cen', foret: 'forets', onf: 'forets', parcelles: 'cadastre',
  contours: 'courbes', niveaux: 'courbes', relief: 'estompage', ombrage: 'estompage', eau: 'hydro', rivieres: 'hydro', coursdeau: 'hydro'
};

/** The overlays of gf-map these layers show, each once, in their order. @param {string[]} names @returns {string[]} */
export const overlayKeys = names => [...new Set(names.flatMap(n => MAP_LAYERS[n]?.keys ?? []))];

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
  repartition: { label: 'Répartition de la plante', about: 'la plante courante seule, toutes ses observations (iNaturalist et GBIF)', set: { src: 'inat+gbif', suit: '0', plante: 'seule' } },
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
