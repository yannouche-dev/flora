// @ts-check
// The plant sheet is made of titled blocks, the same ones in every display mode (each mode shows them its own
// way: compact in Épuré, complete in Scientifique), some made of sub-blocks (buttons, fact rows, links). In
// « Mode King » each mode gets its own order of blocks and sub-blocks and its own folded ones; blocks can be
// renamed, and « Note » blocks created (free text per plant) and deleted. Folding a block that shows a service
// is switching that module off for the mode (Réglages › Modules), and the other way round.
// The layout can be exported to a file and imported back.

import { config } from '../config.js';
import { MODE_KEYS, MODULES, moduleOn, setModule } from './modules.js';
import { emptyLayout, store } from './store.js';

/** @typedef {import('./modules.js').Mode} Mode */
/** @typedef {import('./modules.js').ModuleKey} ModuleKey */
/** @typedef {import('./store.js').SheetLayout} SheetLayout */
/** @typedef {{ key: string, title: string, module?: ModuleKey, note?: boolean }} SheetBlock */
/** @typedef {{ key: string, title: string }} SubBlock */

/** The blocks every sheet has. @type {SheetBlock[]} */
export const BLOCKS = [
  { key: 'name', title: 'Nom' },
  { key: 'actions', title: 'Actions' },
  { key: 'photos', title: 'Photos', module: 'photos' },
  { key: 'status', title: 'Protection et statuts' },
  { key: 'lookalikes', title: 'Plantes à confondre' },
  { key: 'collect', title: 'Ajouter à ma collection' },
  { key: 'taxonomy', title: 'Classification' },
  { key: 'mine', title: 'Mes collections' },
  { key: 'calendar', title: 'Calendrier' },
  { key: 'wikipedia', title: 'Wikipédia', module: 'wikipedia' },
  { key: 'descriptions', title: 'Descriptions', module: 'gbif' },
  { key: 'names', title: 'Noms' },
  { key: 'occurrences', title: 'Occurrences et répartition', module: 'gbif' },
  { key: 'gbifMedia', title: 'Médias GBIF', module: 'gbif' },
  { key: 'trefle', title: 'Trefle', module: 'trefle' },
  { key: 'ids', title: 'Identifiants' },
  { key: 'resources', title: 'Ressources' }
];

/** The parts of a block that can be moved and hidden inside it, in their default order. @type {Record<string, SubBlock[]>} */
export const SUBS = {
  actions: [
    { key: 'fav', title: 'Favori' }, { key: 'addTo', title: 'Ajouter à…' }, { key: 'share', title: 'Partager' }, { key: 'spot', title: 'Noter ici' }
  ],
  collect: [
    { key: 'add', title: 'Ajout en un geste' }, { key: 'choose', title: 'Choix de la collection' }, { key: 'more', title: 'Plus d’infos (Épuré)' }
  ],
  taxonomy: [
    { key: 'chain', title: 'Classification complète' }, { key: 'ranks', title: 'Famille, genre' }, { key: 'author', title: 'Auteur' },
    { key: 'france', title: 'Statut en France' }, { key: 'synonyms', title: 'Synonymes' }, { key: 'inat', title: 'Observations iNaturalist' }
  ],
  status: [{ key: 'iucn', title: 'UICN (Scientifique)' }, { key: 'table', title: 'Statuts INPN' }],
  occurrences: [{ key: 'inat', title: 'Observations iNaturalist' }, { key: 'gbif', title: 'Occurrences GBIF en France' }, { key: 'distribution', title: 'Répartition' }],
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
export const STYLES = {
  names: { styles: [{ key: 'table', title: 'Tableau' }, { key: 'list', title: 'Liste' }], defaults: { epure: 'list' } }
};

/** Default order of each mode: what the mode is about first. Note blocks follow, in their creation order. @type {Record<Mode, string[]>} */
const DEFAULTS = {
  epure: ['name', 'photos', 'status', 'lookalikes', 'collect', 'actions', 'calendar', 'wikipedia', 'names', 'taxonomy', 'mine', 'descriptions', 'occurrences', 'gbifMedia', 'trefle', 'ids', 'resources'],
  standard: ['name', 'actions', 'status', 'lookalikes', 'taxonomy', 'mine', 'calendar', 'photos', 'wikipedia', 'descriptions', 'names', 'resources', 'collect', 'occurrences', 'gbifMedia', 'trefle', 'ids'],
  scientific: ['name', 'actions', 'lookalikes', 'taxonomy', 'status', 'calendar', 'occurrences', 'wikipedia', 'descriptions', 'photos', 'gbifMedia', 'trefle', 'ids', 'mine', 'resources', 'names', 'collect']
};

/** Keys of earlier versions (one list per mode) → today's block. */
const RENAMED = { photo: 'photos', about: 'taxonomy', statuses: 'status', description: 'wikipedia' };

const layout = () => store.state.sheetLayout;

/** Note blocks created by hand. @returns {SheetBlock[]} */
const noteBlocks = () => layout().notes.map(n => ({ key: 'note:' + n.id, title: n.title, note: true }));

/** Every block, notes included. */
export const allBlocks = () => [...BLOCKS, ...noteBlocks()];

/** @param {string} key */
export const blockOf = key => allBlocks().find(b => b.key === key);

/** @param {string} key */
export const isNote = key => key.startsWith('note:');

/** Title of a block (as renamed, else its own). @param {string} key */
export const blockTitle = key => layout().titles[key] || blockOf(key)?.title || key;

/** Its own title, before any renaming. @param {string} key */
export const defaultTitle = key => blockOf(key)?.title || key;

/** Name of the module a block shows, if any. @param {string} key */
export const blockModuleName = key => MODULES.find(m => m.key === blockOf(key)?.module)?.name || null;

/** @param {Mode} view */
const defaults = view => [...DEFAULTS[view], ...noteBlocks().map(b => b.key)];

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
  return Boolean(l.order[view] || l.hidden[view] || l.subOrder[view] || l.subHidden[view] || l.styles?.[view] || l.titleShown?.[view]);
}

/** Saves a new layout (only what differs from the defaults). @param {Partial<SheetLayout>} patch */
function save(patch) {
  const next = { ...layout(), ...patch };
  for (const part of /** @type {const} */ (['order', 'hidden', 'subOrder', 'subHidden', 'styles', 'titleShown'])) {
    for (const [view, value] of Object.entries(next[part])) {
      const empty = Array.isArray(value) ? false : !Object.keys(value || {}).length;
      if (!value || empty) delete next[part][/** @type {Mode} */ (view)];
    }
  }
  const isEmpty = !next.notes.length && !Object.keys(next.titles).length
    && ['order', 'hidden', 'subOrder', 'subHidden', 'styles', 'titleShown'].every(p => !Object.keys(/** @type {any} */ (next)[p] || {}).length);
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

/** Is this block folded in this view? A block of a module is folded when the module is off. @param {Mode} view @param {string} key */
export function isHidden(view, key) {
  const module = blockOf(key)?.module;
  if (module) return !moduleOn(module, view) || (module === 'wikipedia' && !moduleOn('wikidata', view));
  return (layout().hidden[view] || []).includes(key);
}

/** Fold a block away, or bring it back. @param {Mode} view @param {string} key @param {boolean} hidden */
export function setHidden(view, key, hidden) {
  const module = blockOf(key)?.module;
  if (module) {
    setModule(module, view, !hidden);
    // The Wikipédia article is found through Wikidata.
    if (module === 'wikipedia' && !hidden && !moduleOn('wikidata', view)) setModule('wikidata', view, true);
    return;
  }
  const keys = new Set(layout().hidden[view] || []);
  if (hidden) keys.add(key); else keys.delete(key);
  const all = { ...layout().hidden };
  if (keys.size) all[view] = [...keys]; else delete all[view];
  save({ hidden: all });
}

// ── Sub-blocks ─────────────────────────────────────────────────────────────

/** Title of a sub-block. @param {string} block @param {string} key */
export const subTitle = (block, key) => SUBS[block]?.find(s => s.key === key)?.title || key;

/** The sub-block keys of a block in a view, in order. @param {Mode} view @param {string} block */
export const subOrder = (view, block) =>
  merge(layout().subOrder[view]?.[block] || [], (SUBS[block] || []).map(s => s.key));

/** @param {Mode} view @param {string} block @param {string} key */
export const isSubHidden = (view, block, key) => (layout().subHidden[view]?.[block] || []).includes(key);

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
  const keys = new Set(mine[block] || []);
  if (hidden) keys.add(key); else keys.delete(key);
  if (keys.size) mine[block] = [...keys]; else delete mine[block];
  all[view] = mine;
  save({ subHidden: all });
}

// ── Styles ─────────────────────────────────────────────────────────────────

/** The style a block is shown in, in a view (null: the block has one style). @param {Mode} view @param {string} block */
export function blockStyle(view, block) {
  const def = STYLES[block];
  if (!def) return null;
  const chosen = layout().styles?.[view]?.[block];
  return def.styles.some(s => s.key === chosen) ? /** @type {string} */ (chosen) : def.defaults?.[view] || def.styles[0].key;
}

/** @param {Mode} view @param {string} block @param {string} style */
export function setBlockStyle(view, block, style) {
  const def = STYLES[block];
  if (!def?.styles.some(s => s.key === style)) return;
  const all = { ...layout().styles };
  const mine = { ...all[view] };
  if (style === (def.defaults?.[view] || def.styles[0].key)) delete mine[block]; else mine[block] = style;
  all[view] = mine;
  save({ styles: all });
}

// ── Titles shown or not ────────────────────────────────────────────────────

/** Blocks read without a title unless asked: the name, the actions, the photos, the Wikipédia summary (its source line names it). */
const UNTITLED = ['name', 'actions', 'photos', 'wikipedia'];

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

// ── Titles and note blocks ─────────────────────────────────────────────────

/** Rename a block; an empty title gives it back its own. @param {string} key @param {string} title */
export function renameBlock(key, title) {
  const text = title.trim().slice(0, 60);
  if (isNote(key)) {
    if (!text) return;
    save({ notes: layout().notes.map(n => 'note:' + n.id === key ? { ...n, title: text } : n) });
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
export function deleteNote(key) {
  const id = key.slice('note:'.length);
  const strip = (/** @type {Partial<Record<Mode, string[]>>} */ per) =>
    Object.fromEntries(Object.entries(per).map(([v, keys]) => [v, (keys || []).filter(k => k !== key)]));
  const notes = readNotes();
  delete notes[id];
  writeNotes(notes);
  save({ notes: layout().notes.filter(n => n.id !== id), order: strip(layout().order), hidden: strip(layout().hidden) });
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

/** Module blocks folded in a view (the module switches they mirror). @param {Mode} view */
const foldedModules = view => [...new Set(BLOCKS.filter(b => b.module && isHidden(view, b.key)).map(b => /** @type {ModuleKey} */ (b.module)))];

/** Back to the default order, every block and sub-block shown (modules included). Titles and notes stay. @param {Mode} view */
export function resetBlocks(view) {
  const l = layout();
  const without = (/** @type {any} */ per) => { const next = { ...per }; delete next[view]; return next; };
  save({ order: without(l.order), hidden: without(l.hidden), subOrder: without(l.subOrder), subHidden: without(l.subHidden), styles: without(l.styles || {}), titleShown: without(l.titleShown || {}) });
  for (const b of BLOCKS) if (b.module && isHidden(view, b.key)) setHidden(view, b.key, false);
}

/** Everything back to the defaults, note blocks and titles included (the notes' texts are deleted). */
export function resetAll() {
  for (const n of layout().notes) deleteNote('note:' + n.id);
  save(emptyLayout());
  for (const view of MODE_KEYS) resetBlocks(view);
}

/** The layout as a file: blocks, sub-blocks, titles, note blocks and their texts, folded modules. */
export function exportLayout() {
  return JSON.stringify({
    app: 'geoflora', kind: 'sheet-layout', version: 1,
    layout: layout(),
    notes: readNotes(),
    modulesOff: Object.fromEntries(MODE_KEYS.map(v => [v, foldedModules(v)]))
  }, null, 2);
}

/** @param {any} v */
const isKeyList = v => Array.isArray(v) && v.every(k => typeof k === 'string' && k.length < 80);
/** @param {any} v @param {(x: any) => boolean} ok */
const perView = (v, ok) => v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([view, x]) => MODE_KEYS.includes(/** @type {Mode} */ (view)) && ok(x));
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
  const l = data.layout || {};
  const valid = perView(l.order || {}, isKeyList) && perView(l.hidden || {}, isKeyList)
    && perView(l.subOrder || {}, perBlock) && perView(l.subHidden || {}, perBlock)
    && perView(l.titleShown || {}, (/** @type {any} */ x) => x && typeof x === 'object' && Object.values(x).every(v => typeof v === 'boolean'))
    && perView(l.styles || {}, (/** @type {any} */ x) => x && typeof x === 'object' && Object.entries(x).every(([block, st]) => STYLES[block]?.styles.some(s => s.key === st)))
    && l.titles && typeof l.titles === 'object' && Object.values(l.titles).every(t => typeof t === 'string' && t.length <= 60)
    && Array.isArray(l.notes) && l.notes.every((/** @type {any} */ n) => typeof n?.id === 'string' && /^[a-z0-9]{1,24}$/.test(n.id) && typeof n.title === 'string' && n.title.length <= 60)
    && (!data.notes || (typeof data.notes === 'object' && Object.values(data.notes).every(byPlant => byPlant && typeof byPlant === 'object' && Object.values(byPlant).every(t => typeof t === 'string'))))
    && (!data.modulesOff || perView(data.modulesOff, x => Array.isArray(x) && x.every(m => MODULES.some(mm => mm.key === m))));
  if (!valid) throw new Error('Mise en page illisible ou incomplète.');
  writeNotes(data.notes || {});
  save({ ...emptyLayout(), order: l.order || {}, hidden: l.hidden || {}, subOrder: l.subOrder || {}, subHidden: l.subHidden || {}, styles: l.styles || {}, titleShown: l.titleShown || {}, titles: l.titles, notes: l.notes });
  for (const view of MODE_KEYS) {
    const off = data.modulesOff?.[view] || [];
    for (const b of BLOCKS) if (b.module) setHidden(view, b.key, off.includes(b.module));
  }
}
