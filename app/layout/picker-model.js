// @ts-check
// What the block picker (gf-block-picker.js) does to one cell, read from the registry's schema (registry.js) — never
// from a component by name: its settings by group (the registry's: Où, Fond, Couches…; « Réglages » for those without
// one; the frame's Cadre and Liens after them), the control each kind of setting gets, a setting changed, an intent
// chosen, the settings given back to the intent, a component chosen (the frame's settings it honours kept), whether a
// component has the room it needs in a cell, which ones to suggest given the other cells. Every change gives the cell's
// canonical text (registry.js#canonical), without its share: its host writes it where the cell is. Pure, tested under
// Node (tests/unit/block-picker.test.mjs).

import { canonical, COMPONENTS, paramName, resolve, withParam } from './registry.js';
import { parse, serialize } from './grammar.js';
import { intentKey } from './summary.js';

/**
 * @typedef {import('./registry.js').ParamSpec} ParamSpec
 * @typedef {import('./registry.js').ComponentSpec} ComponentSpec
 * @typedef {import('./registry.js').Resolved} Resolved
 * @typedef {import('./grammar.js').CellNode} CellNode
 * @typedef {'segmented' | 'select' | 'switch' | 'slider' | 'chips' | 'text' | 'id' | 'cards'} Control
 * @typedef {{ name: string, keys: string[] }} Group
 */

/** Choices a row of buttons holds at most; more: a menu. */
export const SEGMENTS = 4;

/** The heading of a component's settings that have no group of their own. */
export const OWN = 'Réglages';

/**
 * A component's settings by group, in their order: those without a group first (« Réglages »), then its own groups,
 * then the frame's (Cadre, Liens) — a frame's group of the same name as one of its own joined to it. Not its intent
 * (the picker's level « Que montre-t-il ? »).
 * @param {ComponentSpec} spec @returns {Group[]}
 */
export function groupsOf(spec) {
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  // Not what the cell's own controls set (a map's 3D, its view, its folding): done in the cell, kept in the address.
  const keys = Object.keys(spec.params).filter(k => spec.params[k].kind !== 'intent' && !spec.params[k].own);
  const add = (/** @type {string} */ name, /** @type {string} */ k) => groups.set(name, [...(groups.get(name) ?? []), k]);
  for (const k of keys) if (!spec.params[k].frame && !spec.params[k].group) add(OWN, k);
  for (const k of keys) if (!spec.params[k].frame && spec.params[k].group) add(/** @type {string} */ (spec.params[k].group), k);
  for (const k of keys) if (spec.params[k].frame) add(spec.params[k].group ?? OWN, k);
  return [...groups].map(([name, ks]) => ({ name, keys: ks }));
}

/**
 * The control a setting gets: a choice of a few (a « par défaut » counted) a row of buttons, of more a menu; a yes or
 * no a switch — a row of three when its default is « as the app's settings say » (3d); a distance a slider on the
 * radii's stops; a list chips to toggle; words a field; a plant's number a field; an intent illustrated cards.
 * @param {ParamSpec} ps @returns {Control}
 */
export function controlOf(ps) {
  switch (ps.kind) {
    case 'enum': return Object.keys(ps.values ?? {}).length + (ps.def === null ? 1 : 0) <= SEGMENTS ? 'segmented' : 'select';
    case 'bool': return ps.def === null ? 'segmented' : 'switch';
    case 'distance': return 'slider';
    case 'list': return 'chips';
    case 'text': return 'text';
    case 'id': return 'id';
    default: return 'cards';
  }
}

/**
 * The choices of a row of buttons or a menu: « Par défaut » first when the default is none, then the values with their
 * labels (a yes or no: Oui, Non). @param {ParamSpec} ps @returns {{ value: unknown, label: string }[]}
 */
export function optionsOf(ps) {
  const none = ps.def === null ? [{ value: null, label: 'Par défaut' }] : [];
  if (ps.kind === 'bool') return [...none, { value: true, label: 'Oui' }, { value: false, label: 'Non' }];
  return [...none, ...Object.entries(ps.values ?? {}).map(([value, label]) => ({ value, label }))];
}

/** Words as the grammar keeps them: none of its separators (, ; ( ) [ ] = @), one line, no spaces around. @param {string} text */
export const cleanWords = text => String(text).replace(/[,;()[\]=@]/g, ' ').replace(/\s+/g, ' ').trim();

/** A cell written alone, read (null: not one cell). @param {string} text @returns {CellNode | null} */
export function cellOf(text) {
  const { tree } = parse(text);
  const only = tree.kids.length === 1 ? tree.kids[0] : null;
  return only?.t === 'cell' ? only : null;
}

/** A cell as the address writes it, alone and without its share (« map(floraison,r=2km) »). @param {CellNode} cell */
export const cellText = cell => serialize({ t: 'list', kids: [{ ...cell, size: null }], size: null }).slice(1, -1);

/** A cell's canonical text (registry.js#canonical), without its share. @param {CellNode} cell */
const write = cell => cellText(canonical(cell));

/**
 * A setting of a cell changed: what wrote it gives way (its name, or a bare value it reads: map(20km), map(terrain)),
 * the new value written — unless the cell has that value without it (its default, the one the others make, its
 * intent's: then left out, the address stays short). null: back to the default (or the intent's). Returns the cell's
 * canonical text.
 * @param {CellNode} cell @param {string} key @param {unknown} v @returns {string}
 */
export const setParam = (cell, key, v) => write(withParam(cell, key, v));

/** Whether a setting is kept when the intent changes or comes back: the frame's, and where the cell is (Où). @param {ParamSpec} ps */
const kept = ps => Boolean(ps.frame) || ps.group === 'Où';

/**
 * An intent chosen (one tap): the cell's other settings give way to it — but where it is (Où: its radius, its place)
 * and its frame (its head, its title…). The default intent is not written. @param {CellNode} cell @param {string} intent @returns {string}
 */
export function withIntent(cell, intent) {
  const r = resolve(cell);
  if (!r.known) return write(cell);
  const ik = intentKey(r);
  if (!ik) return write(cell);
  const params = cell.params.filter(p => { const k = paramName(r.spec, p); return k !== null && k !== ik && kept(r.spec.params[k]); });
  if (intent !== r.spec.params[ik].def) params.unshift({ key: null, value: intent });
  return write({ ...cell, params });
}

/**
 * « Revenir à l'intention »: every setting written beside the intent taken out (where the cell is, and its frame,
 * kept); a component without intents, its settings back to their defaults. @param {CellNode} cell @returns {string}
 */
export function resetSettings(cell) {
  const r = resolve(cell);
  if (!r.known) return write(cell);
  const ik = intentKey(r);
  const params = cell.params.filter(p => { const k = paramName(r.spec, p); return k !== null && (k === ik || kept(r.spec.params[k])); });
  return write({ ...cell, params });
}

/**
 * Another component (or block) chosen for a cell: its name, and the frame's settings of the old one that it honours
 * too (its head, its title, its actions). @param {CellNode | null} cell @param {string} id @param {string | null} [view] @returns {string}
 */
export function choose(cell, id, view = null) {
  /** @type {CellNode} */
  const next = { t: 'cell', name: id, view, params: [], size: null };
  const r = cell ? resolve(cell) : null;
  const to = resolve(next);
  if (cell && r?.known && to.known) {
    next.params = cell.params.filter(p => { const k = paramName(r.spec, p); return k !== null && r.spec.params[k].frame && to.spec.params[k]?.frame; })
      .map(p => ({ key: paramName(r.spec, p), value: p.value }));
  }
  return write(next);
}

/**
 * Whether a cell is narrow for a component, or null: its least width and height (registry.js `min`) against the room
 * the cell has (px; unknown: it fits) — advice only, never a block refused (a cell can be made larger afterwards).
 * « Un peu étroit pour « Carte » : 240 px de large conseillés (la case en a 200) ».
 * @param {ComponentSpec} spec @param {{ w: number, h: number } | null | undefined} room @returns {string | null}
 */
export function fitReason(spec, room) {
  if (!room || !(room.w > 0) || !(room.h > 0)) return null;
  if (room.w < spec.min.w) return `Un peu étroit pour « ${spec.title} » : ${spec.min.w} px de large conseillés (la case en a ${Math.round(room.w)})`;
  if (room.h < spec.min.h) return `Un peu bas pour « ${spec.title} » : ${spec.min.h} px de haut conseillés (la case en a ${Math.round(room.h)})`;
  return null;
}

/** A component that chooses the current plant among others (the results, the map, the deck…): it writes it and reads more than it. @param {ComponentSpec} c */
const chooser = c => c.writes.includes('plant') && c.reads.some(k => k !== 'plant');
/** A component that shows the current plant only (the sheet, its blocks, the photos). @param {ComponentSpec} c */
const shower = c => c.reads.includes('plant') && !chooser(c);

/**
 * The components to suggest for a cell, given the others (by what they read and write of the shared state): nothing
 * chooses a plant — those that do (a sheet waiting for one, or the layout empty); something chooses one and nothing
 * shows it — those that show it. A component already there is not suggested again. Each with why.
 * @param {Resolved[]} others @returns {Map<string, string>} component id → why
 */
export function suggestions(others) {
  const there = others.filter(r => r.known).map(r => /** @type {Resolved & { known: true }} */ (r).spec);
  const hasChooser = there.some(chooser), hasShower = there.some(shower);
  const ids = new Set(there.map(c => c.id));
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const c of COMPONENTS) {
    if (ids.has(c.id)) continue;
    if (!hasChooser && chooser(c)) out.set(c.id, hasShower ? 'Choisit la plante que montrent les autres cases' : 'Choisit une plante, que les autres cases montrent');
    else if (hasChooser && !hasShower && shower(c)) out.set(c.id, 'Montre la plante choisie dans les autres cases');
  }
  return out;
}

/**
 * What to say of a component for a cell, given the others: one that only shows the current plant, with nothing to
 * choose it — which ones would. null: nothing to say. @param {ComponentSpec} spec @param {Resolved[]} others @returns {string | null}
 */
export function warningOf(spec, others) {
  if (!shower(spec) || others.some(r => r.known && chooser(r.spec))) return null;
  return `Aucune autre case ne choisit la plante (${COMPONENTS.filter(chooser).map(c => c.title).join(', ')})`;
}
