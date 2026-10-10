// @ts-check
// The plant sheet is made of titled blocks, the same ones in every display mode (each mode shows them its own
// way: compact in Épuré, complete in Scientifique), some made of sub-blocks (buttons, fact rows, links). In
// « Mode King » each mode gets its own order of blocks and sub-blocks and its own folded ones; blocks can be
// renamed, and « Note » blocks created (free text per plant) and deleted. Folding a block that shows a service
// is switching that module off for the mode (Réglages › Modules), and the other way round.
// The layout can be exported to a file and imported back.

import { config } from '../config.js';
import { MODULES, moduleOn, setModule } from './modules.js';
import { baseOf, importModes, modeKeys, ownModes } from './modes.js';
import { OVERLAYS } from './ign.js';
import { emptyLayout, migratePlaces, store } from './store.js';

/** @typedef {import('./modules.js').Mode} Mode */
/** @typedef {import('./modules.js').ModuleKey} ModuleKey */
/** @typedef {import('./store.js').SheetLayout} SheetLayout */
/** @typedef {{ key: string, title: string, module?: ModuleKey, note?: boolean }} SheetBlock */
/** @typedef {{ key: string, title: string }} SubBlock */

/** The blocks every sheet has. @type {SheetBlock[]} */
export const BLOCKS = [
  { key: 'name', title: 'Nom' },
  { key: 'media', title: 'Médias', module: 'photos' },
  { key: 'photos', title: 'Photos', module: 'photos' },
  { key: 'status', title: 'Protection et statuts' },
  { key: 'lookalikes', title: 'Plantes à confondre' },
  { key: 'uses', title: 'Usages et cuisine sauvage' },
  { key: 'taxonomy', title: 'Classification' },
  { key: 'mine', title: 'Mes collections' },
  { key: 'calendar', title: 'Calendrier' },
  { key: 'wikipedia', title: 'Wikipédia', module: 'wikipedia' },
  { key: 'descriptions', title: 'Descriptions', module: 'gbif' },
  { key: 'names', title: 'Noms' },
  { key: 'occurrences', title: 'Occurrences et répartition', module: 'gbif' },
  { key: 'map', title: 'Carte' },
  { key: 'interactions', title: 'Pollinisateurs et interactions', module: 'globi' },
  { key: 'climate', title: 'Climat et pollen', module: 'openmeteo' },
  { key: 'gbifMedia', title: 'Médias GBIF', module: 'gbif' },
  { key: 'gbifProfile', title: 'Habitat et écologie (GBIF)', module: 'gbif' },
  { key: 'literature', title: 'Publications (GBIF)', module: 'gbif' },
  { key: 'trefle', title: 'Trefle', module: 'trefle' },
  { key: 'ids', title: 'Identifiants' },
  { key: 'resources', title: 'Ressources' }
];

/** The parts of a block that can be moved and hidden inside it, in their default order. @type {Record<string, SubBlock[]>} */
export const SUBS = {
  actions: [
    { key: 'fav', title: 'Favori' }, { key: 'addTo', title: 'Ajouter à…' }, { key: 'addCurrent', title: 'Ajouter à la collection courante' },
    { key: 'share', title: 'Partager' }, { key: 'map', title: 'Sur la Carte' }, { key: 'spot', title: 'Noter ici' }
  ],
  taxonomy: [
    { key: 'chain', title: 'Classification complète' }, { key: 'ranks', title: 'Famille, genre' }, { key: 'author', title: 'Auteur' },
    { key: 'france', title: 'Statut en France' }, { key: 'synonyms', title: 'Synonymes' }, { key: 'gbifSynonyms', title: 'Synonymes GBIF' },
    { key: 'inat', title: 'Observations iNaturalist' }
  ],
  status: [{ key: 'iucn', title: 'UICN (Scientifique)' }, { key: 'table', title: 'Statuts INPN' }],
  occurrences: [
    { key: 'inat', title: 'Observations iNaturalist' }, { key: 'gbif', title: 'Occurrences GBIF en France' },
    { key: 'near', title: 'Près d’ici (GBIF)' }, { key: 'months', title: 'Par mois (GBIF)' }, { key: 'years', title: 'Par année (GBIF)' },
    { key: 'regions', title: 'Régions et départements (GBIF)' }, { key: 'basis', title: 'Types de relevés (GBIF)' }, { key: 'datasets', title: 'Principales sources (GBIF)' },
    { key: 'distribution', title: 'Répartition dans le monde' }
  ],
  gbifMedia: [{ key: 'photos', title: 'Photos d’observation' }, { key: 'herbarium', title: 'Planches d’herbier' }],
  interactions: [
    { key: 'pollination', title: 'Pollinisateurs et visiteurs' }, { key: 'herbivores', title: 'Mangée ou parasitée par' },
    { key: 'symbioses', title: 'Symbioses' }, { key: 'consumer', title: 'Elle-même parasite ou consommatrice' }, { key: 'other', title: 'Autres interactions' }
  ],
  uses: [
    { key: 'safety', title: 'Prudence' }, { key: 'uses', title: 'Usages rapportés' }, { key: 'parts', title: 'Parties et produits' },
    { key: 'kitchen', title: 'En cuisine' }, { key: 'links', title: 'Pour aller plus loin' }
  ],
  climate: [{ key: 'pollen', title: 'Pollen aujourd’hui' }, { key: 'niche', title: 'Niche climatique' }],
  names: [{ key: 'french', title: 'Noms français' }, { key: 'foreign', title: 'Autres langues' }],
  resources: [
    { key: 'inpn', title: 'INPN' }, { key: 'taxref', title: 'TAXREF' }, { key: 'gbif', title: 'GBIF' }, { key: 'inaturalist', title: 'iNaturalist' },
    { key: 'wikidata', title: 'Wikidata' }, { key: 'commons', title: 'Wikimedia Commons' }, { key: 'wikipedia', title: 'Wikipédia' }
  ],
  ids: [
    { key: 'taxref', title: 'TAXREF (cd_nom)' }, { key: 'inpn', title: 'INPN' }, { key: 'gbif', title: 'GBIF' }, { key: 'inaturalist', title: 'iNaturalist' },
    { key: 'wikidata', title: 'Wikidata' }, { key: 'tela', title: 'Tela Botanica' }, { key: 'ipni', title: 'IPNI' }, { key: 'powo', title: 'POWO' },
    { key: 'trefle', title: 'Trefle' }
  ]
};

/**
 * Blocks shown in more than one style, chosen per mode in Mode King: the first style is the default, except
 * where the mode's own default is given.
 * @type {Record<string, { styles: { key: string, title: string }[], defaults?: Partial<Record<Mode, string>> }>}
 */
const TABLE_LIST = [{ key: 'table', title: 'Tableau' }, { key: 'list', title: 'Liste' }];
export const STYLES = {
  names: { styles: TABLE_LIST, defaults: { epure: 'list' } },
  // Tabular data: a table by default, or a list.
  occurrences: { styles: TABLE_LIST },
  gbifProfile: { styles: TABLE_LIST },
  literature: { styles: TABLE_LIST },
  ids: { styles: TABLE_LIST },
  uses: { styles: TABLE_LIST, defaults: { epure: 'list' } },
  // Interactions also as a network around the plant.
  interactions: { styles: [...TABLE_LIST, { key: 'graph', title: 'Réseau' }], defaults: { epure: 'list' } },
  // Médias: the stage and its filmstrip, every image in a grid, or one image after the other, full frame.
  media: { styles: [{ key: 'scene', title: 'Scène' }, { key: 'mosaic', title: 'Mosaïque' }, { key: 'slideshow', title: 'Diaporama' }] }
};

/** The action bar docked at the bottom of the sheet: its actions, shown or not and ordered per mode (sub-blocks of 'actions'). */
export const ACTIONS = SUBS.actions;

/** Default order of each mode: what the mode is about first. Note blocks follow, in their creation order. @type {Record<Mode, string[]>} */
const DEFAULTS = {
  epure: ['name', 'photos', 'media', 'status', 'lookalikes', 'uses', 'calendar', 'interactions', 'wikipedia', 'names', 'taxonomy', 'mine', 'descriptions', 'occurrences', 'map', 'climate', 'gbifMedia', 'gbifProfile', 'trefle', 'literature', 'ids', 'resources'],
  standard: ['name', 'status', 'lookalikes', 'uses', 'taxonomy', 'mine', 'calendar', 'interactions', 'media', 'photos', 'wikipedia', 'descriptions', 'names', 'resources', 'occurrences', 'map', 'climate', 'gbifMedia', 'gbifProfile', 'trefle', 'literature', 'ids'],
  scientific: ['name', 'lookalikes', 'taxonomy', 'status', 'calendar', 'occurrences', 'map', 'climate', 'interactions', 'wikipedia', 'descriptions', 'gbifProfile', 'media', 'photos', 'gbifMedia', 'trefle', 'literature', 'ids', 'mine', 'resources', 'uses', 'names']
};

/**
 * Blocks a mode leaves folded until shown (Mode King), its list once changed being kept whole: « Médias »
 * (every image, in a viewer) takes the place of « Photos » and « Médias GBIF » in Standard and Scientifique;
 * Épuré keeps its large photo (touching it opens the viewer).
 * @type {Record<Mode, string[]>}
 */
const DEFAULT_HIDDEN = { epure: ['media'], standard: ['photos', 'gbifMedia'], scientific: ['photos', 'gbifMedia'] };

/** The blocks folded by hand (or by default) in a view. @param {Mode} view @returns {string[]} */
const hiddenList = view => layout().hidden[view] ?? DEFAULT_HIDDEN[baseOf(view)] ?? [];

/** Keys of earlier versions (one list per mode) → today's block. */
const RENAMED = { photo: 'photos', about: 'taxonomy', statuses: 'status', description: 'wikipedia' };

const layout = () => store.state.sheetLayout;

/** Note blocks created by hand. @returns {SheetBlock[]} */
const noteBlocks = () => layout().notes.map(n => ({ key: 'note:' + n.id, title: n.title, note: true }));

/** Map blocks added by hand (« + Bloc Carte »), besides the built-in « Carte ». @returns {SheetBlock[]} */
const mapBlocks = () => (layout().mapBlocks || []).map(m => ({ key: 'map:' + m.id, title: m.title }));

/** Every block, notes and added maps included. */
export const allBlocks = () => [...BLOCKS, ...noteBlocks(), ...mapBlocks()];

/** @param {string} key */
export const blockOf = key => allBlocks().find(b => b.key === key);

/** @param {string} key */
export const isNote = key => key.startsWith('note:');

/** A map block: the built-in « Carte » or one added by hand. @param {string} key */
export const isMap = key => key === 'map' || key.startsWith('map:');

/** A map block added by hand (it can be deleted). @param {string} key */
export const isAddedMap = key => key.startsWith('map:');

/** Title of a block (as renamed, else its own). @param {string} key */
export const blockTitle = key => layout().titles[key] || blockOf(key)?.title || key;

/** Its own title, before any renaming. @param {string} key */
export const defaultTitle = key => blockOf(key)?.title || key;

/** Name of the module a block shows, if any. @param {string} key */
export const blockModuleName = key => MODULES.find(m => m.key === blockOf(key)?.module)?.name || null;

/** @param {Mode} view */
const defaults = view => [...DEFAULTS[baseOf(view)], ...noteBlocks().map(b => b.key), ...mapBlocks().map(b => b.key)];

/**
 * The order of a view, blocks of the same category together (in the categories' order), each keeping its
 * place among its own. @param {Mode} view @param {(key: string) => number} rank
 */
export function orderByCategory(view, rank) {
  const order = blockOrder(view);
  const next = [...order].sort((a, b) => rank(a) - rank(b) || order.indexOf(a) - order.indexOf(b));
  setBlockOrder(view, next);
}

/** Merge a saved order with the current keys: unknown ones dropped, new ones at their default place. @param {string[]} saved @param {string[]} keys */
function merge(saved, keys) {
  const order = [...new Set(saved)].filter(k => keys.includes(k));
  keys.forEach((key, i) => {
    if (order.includes(key)) return;
    // After the default predecessor already placed, else first.
    const before = keys.slice(0, i).reverse().find(k => order.includes(k));
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, key);
  });
  return order;
}

/** The block keys of a view, in the order chosen on this device. @param {Mode} view @returns {string[]} */
export const blockOrder = view =>
  merge((layout().order[view] || []).map(k => RENAMED[/** @type {keyof RENAMED} */ (k)] || k), defaults(view));

/** Has this view been arranged by hand? @param {Mode} view */
export function isCustom(view) {
  const l = layout();
  return Boolean(l.order[view] || l.hidden[view] || l.subOrder[view] || l.subHidden[view] || l.styles?.[view] || l.titleShown?.[view] || l.hideEmpty?.[view] || l.place?.[view] || l.edges?.[view]);
}

/** Saves a new layout (only what differs from the defaults). @param {Partial<SheetLayout>} patch */
function save(patch) {
  const next = { ...layout(), ...patch };
  for (const part of /** @type {const} */ (['order', 'hidden', 'subOrder', 'subHidden', 'styles', 'titleShown', 'hideEmpty'])) {
    for (const [view, value] of Object.entries(next[part])) {
      const empty = Array.isArray(value) ? false : !Object.keys(value || {}).length;
      if (!value || empty) delete next[part][/** @type {Mode} */ (view)];
    }
  }
  const isEmpty = !next.notes.length && !Object.keys(next.titles).length && !next.mapBlocks?.length && !Object.keys(next.maps || {}).length
    && ['order', 'hidden', 'subOrder', 'subHidden', 'styles', 'titleShown', 'hideEmpty', 'place', 'edges'].every(p => !Object.keys(/** @type {any} */ (next)[p] || {}).length);
  try {
    if (isEmpty) localStorage.removeItem(config.storageKeys.sheetLayout);
    else localStorage.setItem(config.storageKeys.sheetLayout, JSON.stringify(next));
    // Earlier versions' keys: carried over once, then gone.
    localStorage.removeItem(config.storageKeys.sheetBlocks);
    localStorage.removeItem(config.storageKeys.sheetHidden);
  } catch { /* not persisted */ }
  store.set({ sheetLayout: next });
}

/** @param {Mode} view @param {string[]} keys */
export function setBlockOrder(view, keys) {
  const order = { ...layout().order };
  if (keys.join() === defaults(view).join()) delete order[view];
  else order[view] = keys;
  save({ order });
}

/** The blocks that show a module (GBIF has several). @param {ModuleKey} module */
const blocksOf = module => BLOCKS.filter(b => b.module === module).map(b => b.key);

/** @param {Mode} view @param {Set<string>} keys */
function writeHidden(view, keys) {
  const all = { ...layout().hidden };
  const byDefault = DEFAULT_HIDDEN[baseOf(view)] || [];
  // The defaults: nothing kept; anything else, kept whole (an empty list too: everything shown).
  if (keys.size === byDefault.length && byDefault.every(k => keys.has(k))) delete all[view]; else all[view] = [...keys];
  save({ hidden: all });
}

/**
 * Is this block folded in this view? A block of a module is folded when the module is off, or when it was
 * folded itself (a module may have several blocks: folding one leaves the others).
 * @param {Mode} view @param {string} key
 */
export function isHidden(view, key) {
  const module = blockOf(key)?.module;
  const own = hiddenList(view).includes(key);
  if (module) return own || !moduleOn(module, view) || (module === 'wikipedia' && !moduleOn('wikidata', view));
  return own;
}

/**
 * Fold a block away, or bring it back. A module goes off with the last of its blocks, and comes back on
 * with the first one (its other blocks staying folded).
 * @param {Mode} view @param {string} key @param {boolean} hidden
 */
export function setHidden(view, key, hidden) {
  const keys = new Set(hiddenList(view));
  const module = blockOf(key)?.module;
  if (!module) {
    if (hidden) keys.add(key); else keys.delete(key);
    writeHidden(view, keys);
    return;
  }
  const siblings = blocksOf(module);
  if (hidden) {
    keys.add(key);
    if (siblings.every(k => keys.has(k))) {
      // The last one: the module goes off (Réglages › Modules), its blocks folded with it.
      for (const k of siblings) keys.delete(k);
      writeHidden(view, keys);
      setModule(module, view, false);
      return;
    }
    writeHidden(view, keys);
    return;
  }
  // The module was off: only this block comes back.
  if (!moduleOn(module, view)) for (const k of siblings) keys.add(k);
  keys.delete(key);
  writeHidden(view, keys);
  setModule(module, view, true);
  // The Wikipédia article is found through Wikidata.
  if (module === 'wikipedia' && !moduleOn('wikidata', view)) setModule('wikidata', view, true);
}

// ── Sub-blocks ─────────────────────────────────────────────────────────────

/** Title of a sub-block. @param {string} block @param {string} key */
export const subTitle = (block, key) => SUBS[block]?.find(s => s.key === key)?.title || key;

/** The sub-block keys of a block in a view, in order. @param {Mode} view @param {string} block */
export const subOrder = (view, block) =>
  merge(layout().subOrder[view]?.[block] || [], (SUBS[block] || []).map(s => s.key));

/**
 * Sub-blocks a mode leaves out until shown in Mode King (a block's list, once changed, is kept whole).
 * @type {Record<Mode, Record<string, string[]>>}
 */
const SUB_HIDDEN = {
  epure: { occurrences: ['months', 'years', 'regions', 'basis', 'datasets', 'distribution'], gbifMedia: ['herbarium'], taxonomy: ['gbifSynonyms'], interactions: ['consumer', 'other'], uses: ['parts', 'links'] },
  standard: { occurrences: ['years', 'basis', 'datasets'], taxonomy: ['gbifSynonyms'], interactions: ['other'] },
  scientific: {}
};

/** The sub-blocks a view leaves out of a block. @param {Mode} view @param {string} block @returns {string[]} */
const hiddenSubs = (view, block) => layout().subHidden[view]?.[block] ?? SUB_HIDDEN[baseOf(view)]?.[block] ?? [];

/** @param {Mode} view @param {string} block @param {string} key */
export const isSubHidden = (view, block, key) => hiddenSubs(view, block).includes(key);

/** The sub-blocks a view shows, in order. @param {Mode} view @param {string} block */
export const shownSubs = (view, block) => subOrder(view, block).filter(k => !isSubHidden(view, block, k));

/** @param {Mode} view @param {string} block @param {string[]} keys */
export function setSubOrder(view, block, keys) {
  const all = { ...layout().subOrder };
  const mine = { ...all[view] };
  if (keys.join() === (SUBS[block] || []).map(s => s.key).join()) delete mine[block]; else mine[block] = keys;
  all[view] = mine;
  save({ subOrder: all });
}

/** @param {Mode} view @param {string} block @param {string} key @param {boolean} hidden */
export function setSubHidden(view, block, key, hidden) {
  const all = { ...layout().subHidden };
  const mine = { ...all[view] };
  const keys = new Set(hiddenSubs(view, block));
  if (hidden) keys.add(key); else keys.delete(key);
  const byDefault = new Set(SUB_HIDDEN[baseOf(view)]?.[block] || []);
  // Back to the mode's own choice: nothing stored; otherwise the whole list (an empty one included).
  if (keys.size === byDefault.size && [...keys].every(k => byDefault.has(k))) delete mine[block]; else mine[block] = [...keys];
  all[view] = mine;
  save({ subHidden: all });
}

// ── Styles ─────────────────────────────────────────────────────────────────

/** The style a block is shown in, in a view (null: the block has one style). @param {Mode} view @param {string} block */
export function blockStyle(view, block) {
  const def = STYLES[block];
  if (!def) return null;
  const chosen = layout().styles?.[view]?.[block];
  return def.styles.some(s => s.key === chosen) ? /** @type {string} */ (chosen) : def.defaults?.[baseOf(view)] || def.styles[0].key;
}

/** @param {Mode} view @param {string} block @param {string} style */
export function setBlockStyle(view, block, style) {
  const def = STYLES[block];
  if (!def?.styles.some(s => s.key === style)) return;
  const all = { ...layout().styles };
  const mine = { ...all[view] };
  if (style === (def.defaults?.[baseOf(view)] || def.styles[0].key)) delete mine[block]; else mine[block] = style;
  all[view] = mine;
  save({ styles: all });
}

// ── Titles shown or not ────────────────────────────────────────────────────

/** Blocks read without a title unless asked: the name, the actions, the photos, the Wikipédia summary (its source line names it). */
const UNTITLED = ['name', 'actions', 'media', 'photos', 'wikipedia'];

/** Does this block show its title in this view (outside Mode King)? @param {Mode} view @param {string} key */
export function isTitleShown(view, key) {
  const chosen = layout().titleShown?.[view]?.[key];
  return typeof chosen === 'boolean' ? chosen : !UNTITLED.includes(key);
}

/** @param {Mode} view @param {string} key @param {boolean} shown */
export function setTitleShown(view, key, shown) {
  const all = { ...layout().titleShown };
  const mine = { ...all[view] };
  if (shown === !UNTITLED.includes(key)) delete mine[key]; else mine[key] = shown;
  all[view] = mine;
  save({ titleShown: all });
}

// ── Positions: where each block sits in the plant pane ─────────────────────

/**
 * A block is in the scrolling sheet (no place), or stuck to an edge of the plant pane — 'top', 'bottom',
 * 'left', 'right' — or 'beside' it (a pane of its own in the parent layout: in Flore, in place of the
 * results). Per mode. Several edges at once; several blocks on one edge are its tabs.
 */
export const PLACES = /** @type {const} */ (['top', 'bottom', 'left', 'right', 'beside']);
/** @typedef {typeof PLACES[number]} Place */
/** The edges of the plant pane (not 'beside'). */
export const EDGES = /** @type {const} */ (['top', 'left', 'right', 'bottom']);
/** @typedef {typeof EDGES[number]} Edge */

/** @param {Mode} view @param {string} key @returns {Place | null} */
export function placeOf(view, key) {
  const p = layout().place?.[view]?.[key];
  return PLACES.includes(/** @type {any} */ (p)) && blockOf(key) ? /** @type {Place} */ (p) : null;
}

/** Moves a block to an edge, beside the sheet, or back in the sheet (null). @param {Mode} view @param {string} key @param {Place | null} place */
export function setPlace(view, key, place) {
  const all = { ...layout().place };
  const mine = { ...all[view] };
  if (place && PLACES.includes(place)) mine[key] = place; else delete mine[key];
  if (Object.keys(mine).length) all[view] = mine; else delete all[view];
  // Arriving on an edge: its tab, unfolded.
  const edges = { ...layout().edges };
  if (place && place !== 'beside') edges[view] = { ...edges[view], [place]: { ...edges[view]?.[place], tab: key, folded: false } };
  save({ place: all, edges });
}

/** The blocks at a place, in the sheet's order. @param {Mode} view @param {Place} place */
export const blocksAt = (view, place) => blockOrder(view).filter(k => placeOf(view, k) === place);

/** Blocks on the left or right edge: the plant pane is made wider to hold the columns. @param {Mode} view */
export const hasColumns = view => blocksAt(view, 'left').length + blocksAt(view, 'right').length > 0;

/** Is the block stuck to an edge (not in the sheet, not beside)? @param {Mode} view @param {string} key */
export const isOnEdge = (view, key) => { const p = placeOf(view, key); return Boolean(p && p !== 'beside'); };

/** Sizes of an edge (s, m, l: about a third, half, 60 % of the pane), unless dragged to its own size. */
export const EDGE_SIZES = /** @type {const} */ (['s', 'm', 'l']);

/**
 * How an edge shows. `size` S / M / L, or `px` when its border was dragged; `folded`: its bar only (the
 * block opens on touch); `full`: across the whole pane (a top / bottom band over the left and right
 * columns, a column from top to bottom); `bare`: no title or frame, the block fills the edge (tabs as icons);
 * `tab`: the block shown when the edge has several.
 * @typedef {{ size: 's' | 'm' | 'l', px: number | null, folded: boolean, full: boolean, bare: boolean, tab: string | null }} EdgeState
 */

/** @param {Mode} view @param {Edge} edge @returns {EdgeState} */
export function edgeState(view, edge) {
  const e = layout().edges?.[view]?.[edge] || {};
  return {
    size: EDGE_SIZES.includes(e.size) ? e.size : 'm',
    px: typeof e.px === 'number' && e.px >= 80 && e.px <= 4000 ? Math.round(e.px) : null,
    folded: e.folded === true, full: e.full === true, bare: e.bare === true,
    tab: typeof e.tab === 'string' ? e.tab : null
  };
}

/** @param {Mode} view @param {Edge} edge @param {Partial<EdgeState>} patch */
export function setEdgeState(view, edge, patch) {
  const next = { ...edgeState(view, edge), ...patch };
  // S / M / L chosen: the dragged size goes.
  if (patch.size) next.px = null;
  const all = { ...layout().edges };
  const mine = { ...all[view] };
  const plain = next.size === 'm' && next.px === null && !next.folded && !next.full && !next.bare && !next.tab;
  if (plain) delete mine[edge]; else mine[edge] = next;
  if (Object.keys(mine).length) all[view] = mine; else delete all[view];
  save({ edges: all });
}

// ── Left out when empty ────────────────────────────────────────────────────

/**
 * Blocks that can have nothing for a plant (no protection, no look-alike, no article…): each mode chooses to
 * show them anyway, with a « nothing known » line, or to leave them out. Name, classification, identifiers
 * and resources always have something.
 */
export const CAN_BE_EMPTY = ['media', 'photos', 'status', 'lookalikes', 'mine', 'calendar', 'wikipedia', 'descriptions', 'names', 'occurrences', 'gbifMedia', 'gbifProfile', 'trefle', 'literature', 'interactions', 'climate', 'uses'];

/** Left out when empty unless asked otherwise (as they always were). */
const EMPTY_HIDDEN = ['wikipedia', 'names', 'gbifProfile', 'literature'];

/** Can this block be left out when empty? (note blocks too: no text for this plant) @param {string} key */
export const canBeEmpty = key => CAN_BE_EMPTY.includes(key) || isNote(key);

/** Is this block left out of this view when it has nothing for the plant (outside Mode King)? @param {Mode} view @param {string} key */
export function hidesEmpty(view, key) {
  if (!canBeEmpty(key)) return false;
  const chosen = layout().hideEmpty?.[view]?.[key];
  return typeof chosen === 'boolean' ? chosen : EMPTY_HIDDEN.includes(key);
}

/** @param {Mode} view @param {string} key @param {boolean} on */
export function setHidesEmpty(view, key, on) {
  if (!canBeEmpty(key)) return;
  const all = { ...layout().hideEmpty };
  const mine = { ...all[view] };
  if (on === EMPTY_HIDDEN.includes(key)) delete mine[key]; else mine[key] = on;
  all[view] = mine;
  save({ hideEmpty: all });
}

// ── Titles and note blocks ─────────────────────────────────────────────────

/** Rename a block; an empty title gives it back its own. @param {string} key @param {string} title */
export function renameBlock(key, title) {
  const text = title.trim().slice(0, 60);
  if (isNote(key)) {
    if (!text) return;
    save({ notes: layout().notes.map(n => 'note:' + n.id === key ? { ...n, title: text } : n) });
    return;
  }
  if (isAddedMap(key)) {
    if (!text) return;
    save({ mapBlocks: (layout().mapBlocks || []).map(m => 'map:' + m.id === key ? { ...m, title: text } : m) });
    return;
  }
  const titles = { ...layout().titles };
  if (!text || text === defaultTitle(key)) delete titles[key]; else titles[key] = text;
  save({ titles });
}

/** A new note block, at the end of every mode. @param {string} title @returns {string} its key */
export function createNote(title) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  save({ notes: [...layout().notes, { id, title: title.trim().slice(0, 60) || 'Note' }] });
  return 'note:' + id;
}

/** @returns {Record<string, Record<string, string>>} note id → plant id → text */
const readNotes = () => {
  try { return JSON.parse(localStorage.getItem(config.storageKeys.plantNotes) || '{}') || {}; } catch { return {}; }
};
/** @param {Record<string, Record<string, string>>} notes */
const writeNotes = notes => {
  try {
    if (Object.keys(notes).length) localStorage.setItem(config.storageKeys.plantNotes, JSON.stringify(notes));
    else localStorage.removeItem(config.storageKeys.plantNotes);
  } catch { /* not persisted */ }
};

/** Delete a note block everywhere, with what was written in it. @param {string} key */
/** A deleted block leaves every mode's places. @param {string} key */
const unplace = key => Object.fromEntries(Object.entries(layout().place || {}).map(([v, per]) => {
  const rest = { ...per };
  delete rest[key];
  return [v, rest];
}).filter(([, per]) => Object.keys(per).length));

export function deleteNote(key) {
  const id = key.slice('note:'.length);
  const strip = (/** @type {Partial<Record<Mode, string[]>>} */ per) =>
    Object.fromEntries(Object.entries(per).map(([v, keys]) => [v, (keys || []).filter(k => k !== key)]));
  const notes = readNotes();
  delete notes[id];
  writeNotes(notes);
  save({ notes: layout().notes.filter(n => n.id !== id), order: strip(layout().order), hidden: strip(layout().hidden), place: unplace(key) });
}

// ── Map blocks ─────────────────────────────────────────────────────────────

/**
 * What a map block shows and lets do (the same in every mode).
 * @typedef {{ gbif: 'fr' | 'world' | 'off', places: boolean, near: 'off' | 'gbif' | 'inat' | 'both', base: 'plan' | 'photo',
 *   overlays: string[], frame: 'auto' | 'france' | 'world' | 'content' | 'me', height: 's' | 'm' | 'l',
 *   actions: { open: boolean, create: boolean, edit: boolean, spot: boolean, locate: boolean } }} MapConfig
 */

/** @type {MapConfig} */
export const MAP_DEFAULTS = {
  gbif: 'fr', places: true, near: 'off', base: 'plan', overlays: [], frame: 'auto', height: 'm',
  actions: { open: true, create: true, edit: true, spot: true, locate: true }
};

const MAP_CHOICES = { gbif: ['fr', 'world', 'off'], near: ['off', 'gbif', 'inat', 'both'], base: ['plan', 'photo'], frame: ['auto', 'france', 'world', 'content', 'me'], height: ['s', 'm', 'l'] };

/** A map's configuration, cleaned (unknown values give the default). @param {any} saved @returns {MapConfig} */
function cleanMap(saved) {
  const c = saved && typeof saved === 'object' ? saved : {};
  /** @type {any} */ const out = { ...MAP_DEFAULTS, actions: { ...MAP_DEFAULTS.actions } };
  for (const [k, values] of Object.entries(MAP_CHOICES)) if (values.includes(c[k])) out[k] = c[k];
  if (typeof c.places === 'boolean') out.places = c.places;
  if (Array.isArray(c.overlays)) out.overlays = c.overlays.filter((/** @type {any} */ o) => typeof o === 'string' && o in OVERLAYS);
  for (const a of Object.keys(MAP_DEFAULTS.actions)) if (typeof c.actions?.[a] === 'boolean') out.actions[a] = c.actions[a];
  return out;
}

/** @param {string} key @returns {MapConfig} */
export const mapConfig = key => cleanMap(layout().maps?.[key]);

/** Changes a map's configuration (`actions` merged). @param {string} key @param {Partial<MapConfig>} patch */
export function setMapConfig(key, patch) {
  const current = mapConfig(key);
  const next = cleanMap({ ...current, ...patch, actions: { ...current.actions, ...(patch.actions || {}) } });
  const maps = { ...(layout().maps || {}) };
  if (JSON.stringify(next) === JSON.stringify(MAP_DEFAULTS)) delete maps[key]; else maps[key] = next;
  save({ maps });
}

/** A new map block, at the end of every mode. @param {string} title @returns {string} its key */
export function createMap(title) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  save({ mapBlocks: [...(layout().mapBlocks || []), { id, title: title.trim().slice(0, 60) || 'Carte' }] });
  return 'map:' + id;
}

/** Delete an added map block everywhere. @param {string} key */
export function deleteMap(key) {
  if (!isAddedMap(key)) return;
  const id = key.slice('map:'.length);
  const strip = (/** @type {Partial<Record<Mode, string[]>>} */ per) =>
    Object.fromEntries(Object.entries(per).map(([v, keys]) => [v, (keys || []).filter(k => k !== key)]));
  const maps = { ...(layout().maps || {}) };
  delete maps[key];
  save({ mapBlocks: (layout().mapBlocks || []).filter(m => m.id !== id), maps, order: strip(layout().order), hidden: strip(layout().hidden), place: unplace(key) });
}

/** @param {string} key @param {number} plantId */
export const noteText = (key, plantId) => readNotes()[key.slice('note:'.length)]?.[plantId] || '';

/** @param {string} key @param {number} plantId @param {string} text */
export function setNoteText(key, plantId, text) {
  const id = key.slice('note:'.length);
  const notes = readNotes();
  const mine = { ...notes[id] };
  if (text.trim()) mine[plantId] = text; else delete mine[plantId];
  if (Object.keys(mine).length) notes[id] = mine; else delete notes[id];
  writeNotes(notes);
}

// ── Reset, export, import ──────────────────────────────────────────────────

/** The modules that have blocks. */
const blockModules = () => [...new Set(BLOCKS.filter(b => b.module).map(b => /** @type {ModuleKey} */ (b.module)))];

/** Modules with blocks that are off in a view (each block's own folding is in the layout). @param {Mode} view */
const foldedModules = view => blockModules().filter(m => !moduleOn(m, view));

/** Back to the default order, every block and sub-block shown (modules included). Titles and notes stay. @param {Mode} view */
export function resetBlocks(view) {
  const l = layout();
  const without = (/** @type {any} */ per) => { const next = { ...per }; delete next[view]; return next; };
  save({ order: without(l.order), hidden: without(l.hidden), subOrder: without(l.subOrder), subHidden: without(l.subHidden), styles: without(l.styles || {}), titleShown: without(l.titleShown || {}), hideEmpty: without(l.hideEmpty || {}), place: without(l.place || {}), edges: without(l.edges || {}) });
  for (const b of BLOCKS) if (b.module && !moduleOn(b.module, view)) setHidden(view, b.key, false);
}

/** Everything back to the defaults, note blocks and titles included (the notes' texts are deleted). */
export function resetAll() {
  for (const n of layout().notes) deleteNote('note:' + n.id);
  save(emptyLayout());
  for (const view of modeKeys()) resetBlocks(view);
}

/** The layout as a file: blocks, sub-blocks, titles, note blocks and their texts, folded modules. */
export function exportLayout() {
  return JSON.stringify({
    app: 'geoflora', kind: 'sheet-layout', version: 1,
    layout: layout(),
    notes: readNotes(),
    modes: ownModes(),
    modulesOff: Object.fromEntries(modeKeys().map(v => [v, foldedModules(v)]))
  }, null, 2);
}

/** @param {any} v */
const isKeyList = v => Array.isArray(v) && v.every(k => typeof k === 'string' && k.length < 80);
/** @param {any} v @param {(x: any) => boolean} ok */
const perView = (v, ok) => v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([view, x]) => (modeKeys().includes(view) || /^m[a-z0-9]{2,12}$/.test(view)) && ok(x));
/** @param {any} v */
const perBlock = v => v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([block, keys]) => block in SUBS && isKeyList(keys));

/**
 * Applies a layout file. Throws (and changes nothing) when it is not one.
 * @param {string} text
 */
export function importLayout(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Ce fichier n’est pas du JSON.'); }
  if (data?.app !== 'geoflora' || data?.kind !== 'sheet-layout') throw new Error('Ce fichier n’est pas une mise en page de fiche GeoFlora.');
  if (data.version !== 1) throw new Error('Version de mise en page inconnue : ' + data.version);
  // Layouts of earlier versions: pinned blocks, their dock and blocks « en volet » become places.
  const l = migratePlaces(data.layout || {});
  const valid = perView(l.order || {}, isKeyList) && perView(l.hidden || {}, isKeyList)
    && perView(l.subOrder || {}, perBlock) && perView(l.subHidden || {}, perBlock)
    && perView(l.titleShown || {}, (/** @type {any} */ x) => x && typeof x === 'object' && Object.values(x).every(v => typeof v === 'boolean'))
    && perView(l.hideEmpty || {}, (/** @type {any} */ x) => x && typeof x === 'object' && Object.values(x).every(v => typeof v === 'boolean'))
    && perView(l.styles || {}, (/** @type {any} */ x) => x && typeof x === 'object' && Object.entries(x).every(([block, st]) => STYLES[block]?.styles.some(s => s.key === st)))
    && perView(l.place || {}, (/** @type {any} */ x) => x && typeof x === 'object' && !Array.isArray(x) && Object.values(x).every(p => PLACES.includes(/** @type {any} */ (p))))
    && perView(l.edges || {}, (/** @type {any} */ x) => x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).every(e => EDGES.includes(/** @type {any} */ (e))))
    && l.titles && typeof l.titles === 'object' && Object.values(l.titles).every(t => typeof t === 'string' && t.length <= 60)
    && Array.isArray(l.notes) && l.notes.every((/** @type {any} */ n) => typeof n?.id === 'string' && /^[a-z0-9]{1,24}$/.test(n.id) && typeof n.title === 'string' && n.title.length <= 60)
    && (!l.mapBlocks || (Array.isArray(l.mapBlocks) && l.mapBlocks.every((/** @type {any} */ m) => typeof m?.id === 'string' && /^[a-z0-9]{1,24}$/.test(m.id) && typeof m.title === 'string' && m.title.length <= 60)))
    && (!l.maps || (typeof l.maps === 'object' && !Array.isArray(l.maps) && Object.keys(l.maps).every(k => k === 'map' || /^map:[a-z0-9]{1,24}$/.test(k))))
    && (!data.notes || (typeof data.notes === 'object' && Object.values(data.notes).every(byPlant => byPlant && typeof byPlant === 'object' && Object.values(byPlant).every(t => typeof t === 'string'))))
    && (!data.modulesOff || perView(data.modulesOff, x => Array.isArray(x) && x.every(m => MODULES.some(mm => mm.key === m))));
  if (!valid) throw new Error('Mise en page illisible ou incomplète.');
  importModes(data.modes || []);
  writeNotes(data.notes || {});
  save({ ...emptyLayout(), order: l.order || {}, hidden: l.hidden || {}, subOrder: l.subOrder || {}, subHidden: l.subHidden || {}, styles: l.styles || {}, titleShown: l.titleShown || {}, hideEmpty: l.hideEmpty || {}, place: l.place || {}, edges: l.edges || {}, titles: l.titles, notes: l.notes,
    mapBlocks: l.mapBlocks || [], maps: Object.fromEntries(Object.entries(l.maps || {}).map(([k, c]) => [k, cleanMap(c)])) });
  for (const view of modeKeys()) {
    const off = data.modulesOff?.[view] || [];
    for (const m of blockModules()) setModule(m, view, !off.includes(m));
    if (!off.includes('wikipedia') && !moduleOn('wikidata', view)) setModule('wikidata', view, true);
  }
}

// ── Modes made here ────────────────────────────────────────────────────────

/** The parts of the layout kept per mode. */
const PER_MODE = /** @type {const} */ (['order', 'hidden', 'subOrder', 'subHidden', 'styles', 'titleShown', 'hideEmpty', 'place', 'edges']);

/** A new mode starts with its model's layout (what differs from the defaults; the defaults are its model's). @param {Mode} from @param {Mode} to */
export function copyLayout(from, to) {
  const l = layout();
  /** @type {any} */
  const patch = {};
  for (const part of PER_MODE) {
    const per = { .../** @type {any} */ (l)[part] };
    if (per[from] !== undefined) per[to] = structuredClone(per[from]); else delete per[to];
    patch[part] = per;
  }
  // A map's settings are per block, the same in every mode: nothing to copy.
  save(patch);
}

/** A mode deleted: its layout goes. @param {Mode} mode */
export function dropLayout(mode) {
  const l = layout();
  /** @type {any} */
  const patch = {};
  for (const part of PER_MODE) { const per = { .../** @type {any} */ (l)[part] }; delete per[mode]; patch[part] = per; }
  save(patch);
}
