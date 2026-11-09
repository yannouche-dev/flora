// @ts-check
// The plant sheet's layout (core/sheet-blocks.js) where it meets the maps' look (core/map-settings.js): apart, so that
// the app's start, which reads the blocks (core/collections.js: the Note blocks' texts; components/gf-flora.js: a
// block's pane), does not load the maps' modules. Read by the sheet (its Carte blocks and their ⚙) and Réglages.
//  - A Carte block's settings (MapConfig): what it shows and lets do, its own look; the same in every mode.
//  - The layout file (Réglages › Mise en page de la fiche : Exporter / Importer): the layout and the modes made here,
//    never the Note blocks' texts (they travel with Mes plantes: GeoJSON export, transfer link, backup copy) nor this
//    device's settings.

import { cleanOwnLook } from './map-settings.js';
import { importModes, modeKeys, ownModes } from './modes.js';
import { validTree } from './pane-tree.js';
import { STYLES, SUBS, isLocked, isSubLocked, saveLayout, treeOf } from './sheet-blocks.js';
import { mergeNoteTexts } from './sheet-notes.js';
import { emptyLayout, store } from './store.js';

/** @typedef {import('./modes.js').Mode} Mode */

const layout = () => store.state.sheetLayout;

// ── A Carte block's settings ───────────────────────────────────────────────

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
export const MAP_CONFIG_DEFAULTS = {
  gbif: 'fr', places: true, near: 'off', look: null, frame: 'auto', height: 'm',
  actions: { open: true, create: true, edit: true, spot: true, locate: true }, subject: 'plant', collection: null
};

const MAP_CHOICES = { gbif: ['fr', 'world', 'off'], near: ['off', 'gbif', 'inat', 'both'], frame: ['auto', 'france', 'world', 'content', 'me', 'region'], height: ['s', 'm', 'l'], subject: ['plant', 'results', 'collection'] };

/** A map's configuration, cleaned (unknown values give the default). @param {any} saved @returns {MapConfig} */
function cleanMap(saved) {
  const c = saved && typeof saved === 'object' ? saved : {};
  /** @type {any} */ const out = { ...MAP_CONFIG_DEFAULTS, actions: { ...MAP_CONFIG_DEFAULTS.actions } };
  for (const [k, values] of Object.entries(MAP_CHOICES)) if (values.includes(c[k])) out[k] = c[k];
  if (typeof c.places === 'boolean') out.places = c.places;
  if (typeof c.collection === 'string' && c.collection.length < 80) out.collection = c.collection;
  if (out.subject === 'collection' && !out.collection) out.subject = 'plant';
  // Its look: kept as `look` (null: the common one).
  out.look = cleanOwnLook(c.look);
  for (const a of Object.keys(MAP_CONFIG_DEFAULTS.actions)) if (typeof c.actions?.[a] === 'boolean') out.actions[a] = c.actions[a];
  return out;
}

/** @param {string} key @returns {MapConfig} */
export const mapConfig = key => cleanMap(layout().maps?.[key]);

/** Changes a map's configuration (`actions` merged). @param {string} key @param {Partial<MapConfig>} patch */
export function setMapConfig(key, patch) {
  const current = mapConfig(key);
  const next = cleanMap({ ...current, ...patch, actions: { ...current.actions, ...(patch.actions || {}) } });
  const maps = { ...(layout().maps || {}) };
  if (JSON.stringify(next) === JSON.stringify(MAP_CONFIG_DEFAULTS)) delete maps[key]; else maps[key] = next;
  saveLayout({ maps });
}

// ── The layout file ────────────────────────────────────────────────────────

/**
 * What a layout file carries, and nothing else (an allowlist: no key of an earlier version, no setting of this device):
 * per mode, the order, folded blocks and sub-blocks (never a locked one), styles, titles shown, blocks left out when
 * empty and the tree of panes (sound: no block that is gone, no bare sheet); the titles, the Note and Carte blocks (no
 * text), the maps' settings.
 */
function portableLayout() {
  const l = layout();
  const per = (/** @type {Partial<Record<Mode, any>>} */ all, /** @type {(view: Mode, value: any) => any} */ clean = (_, v) => v) =>
    Object.fromEntries(Object.entries(all || {}).map(([view, v]) => [view, clean(/** @type {Mode} */ (view), v)]));
  /** @type {Partial<Record<Mode, import('./pane-tree.js').PaneNode>>} */
  const tree = {};
  for (const view of /** @type {Mode[]} */ (Object.keys(l.tree || {}))) { const t = treeOf(view); if (t.t !== 'sheet') tree[view] = t; }
  return {
    order: per(l.order),
    hidden: per(l.hidden, (_, keys) => keys.filter((/** @type {string} */ k) => !isLocked(k))),
    subOrder: per(l.subOrder),
    subHidden: per(l.subHidden, (_, blocks) => Object.fromEntries(Object.entries(blocks).map(([block, keys]) => [block, keys.filter((/** @type {string} */ k) => !isSubLocked(block, k))]))),
    styles: per(l.styles),
    titleShown: per(l.titleShown),
    hideEmpty: per(l.hideEmpty),
    tree,
    titles: { ...l.titles },
    notes: l.notes.map(n => ({ id: n.id, title: n.title })),
    mapBlocks: (l.mapBlocks || []).map(m => ({ id: m.id, title: m.title })),
    maps: Object.fromEntries(Object.entries(l.maps || {}).map(([k, c]) => [k, cleanMap(c)]))
  };
}

/**
 * The layout as a file: the layout (portableLayout) and the modes made here. Not the Note blocks' texts (they travel
 * with Mes plantes), nor what is this device's: the services (Réglages › Modules), Réglages › Cartes.
 */
export function exportLayout() {
  return JSON.stringify({ app: 'geoflora', kind: 'sheet-layout', version: 2, layout: portableLayout(), modes: ownModes() }, null, 2);
}

/** @param {any} v */
const isKeyList = v => Array.isArray(v) && v.every(k => typeof k === 'string' && k.length < 80);
/** @param {any} v @param {(x: any) => boolean} ok */
const perView = (v, ok) => v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([view, x]) => (modeKeys().includes(view) || /^m[a-z0-9]{2,12}$/.test(view)) && ok(x));
/** @param {any} v */
const perBlock = v => v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([block, keys]) => block in SUBS && isKeyList(keys));

/**
 * Applies a layout file. Throws (and changes nothing) when it is not one. Every Note block of this device stays (after
 * the file's: those it does not have). A file of before carries note texts: they are added to this device's, never over
 * them (a layout shared by someone else does not erase what was written here). A file of version 1 is read without its
 * panes. The layout is applied at once; the promise resolves once the texts are stored.
 * @param {string} text @returns {Promise<number>} how many texts were added
 */
export function importLayout(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Ce fichier n’est pas du JSON.'); }
  if (data?.app !== 'geoflora' || data?.kind !== 'sheet-layout') throw new Error('Ce fichier n’est pas une mise en page de fiche GeoFlora.');
  if (data.version !== 1 && data.version !== 2) throw new Error('Version de mise en page inconnue : ' + data.version);
  // Version 1 (before the tree of panes) is read as it is: its blocks go into the sheet, its panes are left out.
  const l = data.layout || {};
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
  // Any other field is left aside (a file of before: its services, Réglages › Cartes, version 1's panes): a layout never
  // changes this device's settings.
  if (!valid) throw new Error('Mise en page illisible ou incomplète.');
  importModes(data.modes || []);
  // This device's Note blocks the file has not are kept, after the file's (with or without a text yet).
  const kept = layout().notes.filter(n => !l.notes.some((/** @type {any} */ m) => m.id === n.id));
  const texts = Object.entries(data.notes || {}).flatMap(([note, byPlant]) => Object.entries(/** @type {Record<string, string>} */ (byPlant))
    .map(([plantId, t]) => ({ key: '', note, plantId: Number(plantId), text: t, updatedAt: '' })));
  saveLayout({ ...emptyLayout(), order: l.order || {}, hidden: l.hidden || {}, subOrder: l.subOrder || {}, subHidden: l.subHidden || {}, styles: l.styles || {}, titleShown: l.titleShown || {}, hideEmpty: l.hideEmpty || {}, tree: l.tree || {}, titles: l.titles, notes: [...l.notes, ...kept],
    mapBlocks: l.mapBlocks || [], maps: Object.fromEntries(Object.entries(l.maps || {}).map(([k, c]) => [k, cleanMap(c)])) });
  return mergeNoteTexts(texts, { keepMine: true });
}
