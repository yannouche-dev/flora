// @ts-check
// The plant sheet is made of titled blocks, the same ones in every display mode (each mode shows them its own
// way: compact in Épuré, complete in Scientifique), some made of sub-blocks (buttons, fact rows, links). In
// « Mode King » each mode gets its own order of blocks and sub-blocks and its own folded ones; blocks can be
// renamed, and « Note » blocks created (free text per plant) and deleted. A block that shows a service is folded
// while that module is off (Réglages › Modules, a choice for the whole device, whatever the mode): there is nothing
// to show. Folding or showing a block never switches a module.
// The layout can be exported to a file and imported back.

import { config } from '../config.js';
import { MODULES, moduleOn } from './modules.js';
import { baseOf, importModes, modeKeys, ownModes } from './modes.js';
import { emptyLayout, migratePlaces, migrateTree, store } from './store.js';
import { allNoteTexts, deleteNoteTexts, fromPortable, mergeNoteTexts, noteText as storedText, notesWithText, portableNotes, setNoteText as storeText } from './sheet-notes.js';
import { writeJSON, writeText } from './prefs.js';
import { cleanMapSettings, cleanOwnLook, mapSettings, mapSettingsDiff, setMapSettings } from './map-settings.js';
import { SHEET, dock, normalize, patchStack, setSizes, sheetInRow, stackOf, undock, validTree } from './pane-tree.js';

/** @typedef {import('./modes.js').Mode} Mode */
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
  { key: 'resources', title: 'Ressources' },
  // Another site, in a frame: in a pane, the app's links to other sites open there.
  { key: 'web', title: 'Page web' }
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

const TABLE_LIST = [{ key: 'table', title: 'Tableau' }, { key: 'list', title: 'Liste' }];
/**
 * Blocks shown in more than one style, chosen per mode in Mode King: the first style is the default, except
 * where the mode's own default is given.
 * @type {Record<string, { styles: { key: string, title: string }[], defaults?: Partial<Record<Mode, string>> }>}
 */
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

/** Default order of each mode: what the mode is about first. Note blocks follow, in their creation order. @type {Record<Mode, string[]>} */
const DEFAULTS = {
  epure: ['name', 'photos', 'media', 'status', 'lookalikes', 'uses', 'calendar', 'interactions', 'wikipedia', 'names', 'taxonomy', 'mine', 'descriptions', 'occurrences', 'map', 'climate', 'gbifMedia', 'gbifProfile', 'trefle', 'literature', 'ids', 'resources', 'web'],
  standard: ['name', 'status', 'lookalikes', 'uses', 'taxonomy', 'mine', 'calendar', 'interactions', 'media', 'photos', 'wikipedia', 'descriptions', 'names', 'resources', 'occurrences', 'map', 'climate', 'gbifMedia', 'gbifProfile', 'trefle', 'literature', 'ids', 'web'],
  scientific: ['name', 'lookalikes', 'taxonomy', 'status', 'calendar', 'occurrences', 'map', 'climate', 'interactions', 'wikipedia', 'descriptions', 'gbifProfile', 'media', 'photos', 'gbifMedia', 'trefle', 'literature', 'ids', 'mine', 'resources', 'uses', 'names', 'web']
};

/**
 * Blocks a mode leaves folded until shown (Mode King), its list once changed being kept whole: « Médias »
 * (every image, in a viewer) takes the place of « Photos » and « Médias GBIF » in Standard and Scientifique;
 * Épuré keeps its large photo (touching it opens the viewer).
 * @type {Record<Mode, string[]>}
 */
const DEFAULT_HIDDEN = { epure: ['media', 'web'], standard: ['photos', 'gbifMedia', 'web'], scientific: ['photos', 'gbifMedia', 'web'] };

/** The blocks folded by hand (or by default) in a view. @param {Mode} view @returns {string[]} */
const hiddenList = view => layout().hidden[view] ?? DEFAULT_HIDDEN[baseOf(view)] ?? [];

/**
 * Folded by hand (or by default) in this view, whatever its service: the block's own choice, which Mode King's
 * « Réafficher » and Réglages' block lists change. @param {Mode} view @param {string} key
 */
export const foldedByHand = (view, key) => hiddenList(view).includes(key);

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
  merge((layout().order[view] || []).map(k => RENAMED[/** @type {keyof typeof RENAMED} */ (k)] || k), defaults(view));

/** Has this view been arranged by hand? @param {Mode} view */
export function isCustom(view) {
  const l = layout();
  return Boolean(l.order[view] || l.hidden[view] || l.subOrder[view] || l.subHidden[view] || l.styles?.[view] || l.titleShown?.[view] || l.hideEmpty?.[view] || l.tree?.[view]);
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
    && ['order', 'hidden', 'subOrder', 'subHidden', 'styles', 'titleShown', 'hideEmpty', 'tree'].every(p => !Object.keys(/** @type {any} */ (next)[p] || {}).length);
  // A refusal for lack of room is said on screen (quota.js); the layout still applies to this session.
  if (writeJSON(config.storageKeys.sheetLayout, isEmpty ? null : next)) {
    // Earlier versions' keys: carried over once, then gone.
    writeText(config.storageKeys.sheetBlocks, null);
    writeText(config.storageKeys.sheetHidden, null);
  }
  store.set({ sheetLayout: next });
}

/** @param {Mode} view @param {string[]} keys */
export function setBlockOrder(view, keys) {
  const order = { ...layout().order };
  if (keys.join() === defaults(view).join()) delete order[view];
  else order[view] = keys;
  save({ order });
}

/** @param {Mode} view @param {Set<string>} keys */
function writeHidden(view, keys) {
  const all = { ...layout().hidden };
  const byDefault = DEFAULT_HIDDEN[baseOf(view)] || [];
  // The defaults: nothing kept; anything else, kept whole (an empty list too: everything shown).
  if (keys.size === byDefault.length && byDefault.every(k => keys.has(k))) delete all[view]; else all[view] = [...keys];
  save({ hidden: all });
}

/**
 * The modules a block needs that are off on this device (Wikipédia needs Wikidata too: the article is found through
 * it), empty when none: only the user switches them on again, in Réglages › Modules.
 * @param {string} key @returns {ModuleKey[]}
 */
export function modulesOffFor(key) {
  const module = blockOf(key)?.module;
  if (!module) return [];
  return /** @type {ModuleKey[]} */ ([module, ...(module === 'wikipedia' ? ['wikidata'] : [])]).filter(m => !moduleOn(m));
}

/** Does this block show a service switched off on this device (Réglages › Modules)? @param {string} key */
export const serviceOff = key => modulesOffFor(key).length > 0;

/**
 * What a block folded for its service says (Mode King, Réglages): « service GBIF coupé pour tout l’appareil »; null
 * when its services are on. @param {string} key
 */
export function serviceOffNote(key) {
  const names = modulesOffFor(key).map(m => MODULES.find(x => x.key === m)?.name || m);
  if (!names.length) return null;
  return names.length > 1 ? `services ${names.slice(0, -1).join(', ')} et ${names.at(-1)} coupés pour tout l’appareil`
    : `service ${names[0]} coupé pour tout l’appareil`;
}

/**
 * Is this block folded in this view? Folded by hand (or by default), or its service off on this device (serviceOff):
 * it has nothing to show.
 * @param {Mode} view @param {string} key
 */
export const isHidden = (view, key) => foldedByHand(view, key) || serviceOff(key);

/**
 * Fold a block away, or bring it back, in this view: the block's own choice only. Its service stays as it is (a block
 * brought back while its module is off stays folded until the module is on again, Réglages › Modules).
 * @param {Mode} view @param {string} key @param {boolean} hidden
 */
export function setHidden(view, key, hidden) {
  const keys = new Set(hiddenList(view));
  if (hidden) keys.add(key); else keys.delete(key);
  writeHidden(view, keys);
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

// ── Positions: the tree of panes of the plant pane ─────────────────────────

/**
 * Per mode, the plant pane is a tree of panes (pane-tree.js): the scrolling sheet, and beside, above or under
 * it, panes holding blocks as tabs, split in rows and columns. A block in no pane is in the sheet.
 * @typedef {import('./pane-tree.js').PaneNode} PaneNode
 * @typedef {import('./pane-tree.js').Zone} Zone
 * @typedef {import('./pane-tree.js').StackNode} StackNode
 */

/** @type {WeakMap<object, PaneNode>} */
const treeCache = new WeakMap();

/** The mode's tree, sound (blocks that exist, no empty pane); no tree: the sheet alone. @param {Mode} view @returns {PaneNode} */
export function treeOf(view) {
  const raw = layout().tree?.[view];
  if (!raw) return SHEET;
  let t = treeCache.get(raw);
  if (!t) { t = normalize(raw, k => Boolean(blockOf(k))); treeCache.set(raw, t); }
  return t;
}

/** @param {Mode} view @param {PaneNode} tree */
function setTree(view, tree) {
  const all = { ...layout().tree };
  if (tree.t === 'sheet') delete all[view]; else all[view] = tree;
  save({ tree: all });
}

/**
 * A block docked: on a side of a pane (or of the sheet, or of the whole frame: target 'root'), in a pane's
 * centre (a tab), or among its tabs. A block folded by hand comes back when the user moves it (its service stays as
 * it is: off, the block stays folded); `auto` (a layout the app makes itself, like Découvrir's steps) leaves out a
 * block whose module is off: it is left where it is, and false returned. False too when the layout would be too deep
 * (too many panes nested: pane-tree.js dock refuses what an export could not be imported back from): nothing moves.
 * @param {Mode} view @param {string} key @param {string} target a node's id ('sheet', a pane's id, 'root') @param {Zone} zone
 * @param {{ auto?: boolean }} [options]
 */
export function dockBlock(view, key, target, zone, { auto = false } = {}) {
  if (auto && serviceOff(key)) return false;
  const before = treeOf(view), after = dock(before, key, target, zone);
  if (after === before) return false;
  if (foldedByHand(view, key)) setHidden(view, key, false);
  setTree(view, after);
  return true;
}

/** A block back in the sheet, before another one (or where it was in the order). @param {Mode} view @param {string} key @param {string | null} [beforeKey] */
export function toSheet(view, key, beforeKey = null) {
  if (foldedByHand(view, key)) setHidden(view, key, false);
  if (stackOf(treeOf(view), key)) setTree(view, undock(treeOf(view), key));
  if (beforeKey && beforeKey !== key) {
    const order = blockOrder(view).filter(k => k !== key);
    const at = order.indexOf(beforeKey);
    if (at >= 0) { order.splice(at, 0, key); setBlockOrder(view, order); }
  }
}

/** New shares for a split's children. @param {Mode} view @param {string} id @param {number[]} sizes */
export const setPaneSizes = (view, id, sizes) => setTree(view, setSizes(treeOf(view), id, sizes));

/** A pane's state: its tab shown, folded, bare. @param {Mode} view @param {string} id @param {Partial<StackNode>} patch */
export const setStackState = (view, id, patch) => setTree(view, patchStack(treeOf(view), id, patch));

/** The pane holding a block (null: in the sheet). @param {Mode} view @param {string} key */
export const paneOf = (view, key) => blockOf(key) ? stackOf(treeOf(view), key) : null;

/** Where a block is: 'pane' (in a pane of the tree) or null (in the sheet). @param {Mode} view @param {string} key @returns {'pane' | null} */
export const placeOf = (view, key) => paneOf(view, key) ? 'pane' : null;

/** Is the block in a pane (not in the sheet)? @param {Mode} view @param {string} key */
export const isOnEdge = (view, key) => Boolean(paneOf(view, key));

/** Panes beside the sheet (in a row): the plant pane is made wider to hold them. @param {Mode} view */
export const hasColumns = view => sheetInRow(treeOf(view));

/**
 * From a list (Réglages): back in the sheet, or a new pane on a side of the sheet.
 * @param {Mode} view @param {string} key @param {'left' | 'right' | 'top' | 'bottom' | null} side
 */
export function setPlace(view, key, side) {
  if (!side) toSheet(view, key);
  else dockBlock(view, key, 'sheet', side);
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


/** A deleted block leaves every mode's places. @param {string} key */
const unplace = key => Object.fromEntries(Object.entries(layout().place || {}).map(([v, per]) => {
  const rest = { ...per };
  delete rest[key];
  return [v, rest];
}).filter(([, per]) => Object.keys(per).length));

/** Delete a note block everywhere, with what was written in it. @param {string} key */
export function deleteNote(key) {
  const id = key.slice('note:'.length);
  const strip = (/** @type {Partial<Record<Mode, string[]>>} */ per) =>
    Object.fromEntries(Object.entries(per).map(([v, keys]) => [v, (keys || []).filter(k => k !== key)]));
  deleteNoteTexts(id).catch(error => console.error(error));
  save({ notes: layout().notes.filter(n => n.id !== id), order: strip(layout().order), hidden: strip(layout().hidden), place: unplace(key) });
}

// ── Map blocks ─────────────────────────────────────────────────────────────

/**
 * What a map block shows and lets do (the same in every mode).
 * @typedef {{ gbif: 'fr' | 'world' | 'off', places: boolean, near: 'off' | 'gbif' | 'inat' | 'both',
 *   look: Partial<import('./map-settings.js').MapLook> | null, frame: 'auto' | 'france' | 'world' | 'content' | 'me' | 'region',
 *   height: 's' | 'm' | 'l', actions: { open: boolean, create: boolean, edit: boolean, spot: boolean, locate: boolean },
 *   subject: 'plant' | 'results' | 'collection', collection: string | null }} MapConfig
 * `subject`: what the map is about — the plant of the sheet, the plants of the results (the search and its
 * filters), or a collection (`collection`: its id) — its places shown. `look`: its own look (core/map-settings.js),
 * changed in its panel ▦ — null: the maps' common look, followed (2D or 3D always is).
 */

/** @type {MapConfig} */
export const MAP_DEFAULTS = {
  gbif: 'fr', places: true, near: 'off', look: null, frame: 'auto', height: 'm',
  actions: { open: true, create: true, edit: true, spot: true, locate: true }, subject: 'plant', collection: null
};

const MAP_CHOICES = { gbif: ['fr', 'world', 'off'], near: ['off', 'gbif', 'inat', 'both'], frame: ['auto', 'france', 'world', 'content', 'me', 'region'], height: ['s', 'm', 'l'], subject: ['plant', 'results', 'collection'] };

/**
 * The look of a configuration of before (its own background, « plan » unless chosen, and IGN overlays, set in the
 * block's form): carried into its own look when it was not that default (the plan, no overlay) — a block left as it
 * was follows the common look, as every map. @param {any} c @returns {Partial<import('./map-settings.js').MapLook> | null}
 */
function oldLook(c) {
  const base = c.base === 'photo' ? 'photo' : 'plan';
  const overlays = Array.isArray(c.overlays) ? c.overlays : [];
  return base !== 'plan' || overlays.length ? cleanOwnLook({ base, overlays }) : null;
}

/** A map's configuration, cleaned (unknown values give the default). @param {any} saved @returns {MapConfig} */
function cleanMap(saved) {
  const c = saved && typeof saved === 'object' ? saved : {};
  /** @type {any} */ const out = { ...MAP_DEFAULTS, actions: { ...MAP_DEFAULTS.actions } };
  for (const [k, values] of Object.entries(MAP_CHOICES)) if (values.includes(c[k])) out[k] = c[k];
  if (typeof c.places === 'boolean') out.places = c.places;
  if (typeof c.collection === 'string' && c.collection.length < 80) out.collection = c.collection;
  if (out.subject === 'collection' && !out.collection) out.subject = 'plant';
  // Its look: kept as `look` (null: the common one); a configuration of before, read once from its old fields.
  out.look = 'look' in c ? cleanOwnLook(c.look) : oldLook(c);
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

/** The text of a note block for a plant (sheet-notes.js). @param {string} key @param {number} plantId */
export const noteText = (key, plantId) => storedText(key.slice('note:'.length), plantId);

/**
 * Writes a note block's text for a plant; resolves with whether it is stored (false: not saved, storage full).
 * @param {string} key @param {number} plantId @param {string} text @returns {Promise<boolean>}
 */
export const setNoteText = (key, plantId, text) => storeText(key.slice('note:'.length), plantId, text);

/** The note blocks' texts in their portable form (export, backup copy, transfer link). */
export const exportNotes = () => portableNotes(layout().notes);

/**
 * Note texts from an export, a backup copy or a link: their blocks made where missing (same id, same title), the
 * texts merged (a newer one replaces this device's; nothing is deleted). @param {any} list @returns {Promise<number>}
 */
export async function importNotes(list) {
  const texts = fromPortable(list);
  if (!texts.length) return 0;
  const have = new Set(layout().notes.map(n => n.id));
  const blocks = /** @type {any[]} */ (list).filter(b => texts.some(t => t.note === b.id) && !have.has(b.id))
    .map(b => ({ id: b.id, title: String(b.title || 'Note').trim().slice(0, 60) || 'Note' }));
  if (blocks.length) save({ notes: [...layout().notes, ...blocks] });
  return mergeNoteTexts(texts);
}

// ── Reset, export, import ──────────────────────────────────────────────────

/**
 * Back to the mode's defaults: order, folded blocks and sub-blocks, styles, titles shown, blocks left out when empty.
 * Titles and notes stay; so do the services (Réglages › Modules): a block whose module is off stays folded.
 * @param {Mode} view
 */
export function resetBlocks(view) {
  const l = layout();
  const without = (/** @type {any} */ per) => { const next = { ...per }; delete next[view]; return next; };
  save({ order: without(l.order), hidden: without(l.hidden), subOrder: without(l.subOrder), subHidden: without(l.subHidden), styles: without(l.styles || {}), titleShown: without(l.titleShown || {}), hideEmpty: without(l.hideEmpty || {}), place: without(l.place || {}), edges: without(l.edges || {}) });
}

/** Everything back to the defaults, note blocks and titles included (the notes' texts are deleted); services stay. */
export function resetAll() {
  for (const n of layout().notes) deleteNote('note:' + n.id);
  save(emptyLayout());
  for (const view of modeKeys()) resetBlocks(view);
}

/**
 * The layout as a file: blocks, sub-blocks, titles, note blocks and their texts, the modes made here. Not the services
 * (Réglages › Modules): they are this device's.
 */
export function exportLayout() {
  return JSON.stringify({
    app: 'geoflora', kind: 'sheet-layout', version: 2,
    layout: layout(),
    notes: allNoteTexts(),
    modes: ownModes(),
    // Réglages › Cartes (2D or 3D, the 3D options): what differs from the defaults.
    maps3d: mapSettingsDiff(mapSettings())
  }, null, 2);
}

/** @param {any} v */
const isKeyList = v => Array.isArray(v) && v.every(k => typeof k === 'string' && k.length < 80);
/** @param {any} v @param {(x: any) => boolean} ok */
const perView = (v, ok) => v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([view, x]) => (modeKeys().includes(view) || /^m[a-z0-9]{2,12}$/.test(view)) && ok(x));
/** @param {any} v */
const perBlock = v => v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([block, keys]) => block in SUBS && isKeyList(keys));

/**
 * Applies a layout file. Throws (and changes nothing) when it is not one. Its note texts are added to this device's,
 * never over them (a layout shared by someone else does not erase what was written here), and the note blocks that
 * hold a text here stay. The layout is applied at once; the promise resolves once the texts are stored.
 * @param {string} text @returns {Promise<number>} how many texts were added
 */
export function importLayout(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Ce fichier n’est pas du JSON.'); }
  if (data?.app !== 'geoflora' || data?.kind !== 'sheet-layout') throw new Error('Ce fichier n’est pas une mise en page de fiche GeoFlora.');
  if (data.version !== 1 && data.version !== 2) throw new Error('Version de mise en page inconnue : ' + data.version);
  // Layouts of earlier versions: pinned blocks, their dock and blocks « en volet » became places, then the tree.
  const old = migratePlaces(data.layout || {});
  const validOld = perView(old.place || {}, (/** @type {any} */ x) => x && typeof x === 'object' && !Array.isArray(x) && Object.values(x).every(p => ['top', 'bottom', 'left', 'right', 'beside'].includes(/** @type {any} */ (p))))
    && perView(old.edges || {}, (/** @type {any} */ x) => x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).every(e => ['top', 'bottom', 'left', 'right'].includes(e)));
  if (!validOld) throw new Error('Mise en page illisible ou incomplète.');
  const l = migrateTree(old);
  const valid = perView(l.order || {}, isKeyList) && perView(l.hidden || {}, isKeyList)
    && perView(l.subOrder || {}, perBlock) && perView(l.subHidden || {}, perBlock)
    && perView(l.titleShown || {}, (/** @type {any} */ x) => x && typeof x === 'object' && Object.values(x).every(v => typeof v === 'boolean'))
    && perView(l.hideEmpty || {}, (/** @type {any} */ x) => x && typeof x === 'object' && Object.values(x).every(v => typeof v === 'boolean'))
    && perView(l.styles || {}, (/** @type {any} */ x) => x && typeof x === 'object' && Object.entries(x).every(([block, st]) => STYLES[block]?.styles.some(s => s.key === st)))
    && perView(l.tree || {}, validTree)
    && l.titles && typeof l.titles === 'object' && Object.values(l.titles).every(t => typeof t === 'string' && t.length <= 60)
    && Array.isArray(l.notes) && l.notes.every((/** @type {any} */ n) => typeof n?.id === 'string' && /^[a-z0-9]{1,24}$/.test(n.id) && typeof n.title === 'string' && n.title.length <= 60)
    && (!l.mapBlocks || (Array.isArray(l.mapBlocks) && l.mapBlocks.every((/** @type {any} */ m) => typeof m?.id === 'string' && /^[a-z0-9]{1,24}$/.test(m.id) && typeof m.title === 'string' && m.title.length <= 60)))
    && (!l.maps || (typeof l.maps === 'object' && !Array.isArray(l.maps) && Object.keys(l.maps).every(k => k === 'map' || /^map:[a-z0-9]{1,24}$/.test(k))))
    && (!data.notes || (typeof data.notes === 'object' && Object.values(data.notes).every(byPlant => byPlant && typeof byPlant === 'object' && Object.values(byPlant).every(t => typeof t === 'string'))));
  // `modulesOff` (files of earlier versions: the services folded with their blocks, per mode) is left aside: services
  // are this device's, chosen in Réglages › Modules, and a layout never switches one.
  if (!valid) throw new Error('Mise en page illisible ou incomplète.');
  importModes(data.modes || []);
  // Réglages › Cartes, when the file has them (an older one has not: they stay as they are here).
  if (data.maps3d && typeof data.maps3d === 'object') setMapSettings(cleanMapSettings(data.maps3d));
  // Note blocks holding a text on this device are kept, after the file's.
  const written = new Set(notesWithText());
  const kept = layout().notes.filter(n => written.has(n.id) && !l.notes.some((/** @type {any} */ m) => m.id === n.id));
  const texts = Object.entries(data.notes || {}).flatMap(([note, byPlant]) => Object.entries(/** @type {Record<string, string>} */ (byPlant))
    .map(([plantId, t]) => ({ key: '', note, plantId: Number(plantId), text: t, updatedAt: '' })));
  save({ ...emptyLayout(), order: l.order || {}, hidden: l.hidden || {}, subOrder: l.subOrder || {}, subHidden: l.subHidden || {}, styles: l.styles || {}, titleShown: l.titleShown || {}, hideEmpty: l.hideEmpty || {}, tree: l.tree || {}, titles: l.titles, notes: [...l.notes, ...kept],
    mapBlocks: l.mapBlocks || [], maps: Object.fromEntries(Object.entries(l.maps || {}).map(([k, c]) => [k, cleanMap(c)])) });
  return mergeNoteTexts(texts, { keepMine: true });
}

// ── Modes made here ────────────────────────────────────────────────────────

/** The parts of the layout kept per mode. */
const PER_MODE = /** @type {const} */ (['order', 'hidden', 'subOrder', 'subHidden', 'styles', 'titleShown', 'hideEmpty', 'tree']);

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
