// @ts-check
// A free layout's tree as boxes, and what « Modifier la disposition » does to it with its cross (gf-layout.js) — pure
// (no DOM), tested under Node (tests/unit/builder-grid.test.mjs). A box is a place (no `kids`: a cell) or a list of
// boxes; its `share` is its part of its list (%). Lists lay their boxes as the grammar does (grammar.js#dirAt): the top
// level side by side, then turning at each level — so a box's direction is never stored, only its depth says it.
//
//  - boxOf / specOf: a layout (grammar.js) as boxes, and back — every cell kept as the address writes it (`cell`, its
//    canonical text; an « Emplacement », `slot`, none), shares in whole per cents, said only where a list is not shared
//    evenly: the address stays short;
//  - split: a place cut in two towards a side (top, bottom, left, right): beside it in its list when that list runs
//    that way (the place's share halved), else the place made a list of two in that direction (half each) — the new
//    place an « Emplacement » (`slot`), the one cut keeping its cell; never past MAX_CELLS nor MAX_DEPTH;
//  - remove: a place taken out (its share given to its neighbour, the others as they were); a list left with one box
//    gives way to it;
//  - resize: width or height moved from one box of a list to the next, the list's total kept.

import { parse, dirAt, MAX_CELLS, MAX_DEPTH } from './grammar.js';
import { canonical } from './registry.js';
import { cellText } from './picker-model.js';

/** @typedef {{ share: number, kids?: Box[], cell?: string }} Box  `cell`: its cell as the address writes it (no share); none: an « Emplacement » (slot) */
/** @typedef {'top' | 'bottom' | 'left' | 'right'} Side */

/** A box's least share of its list (%). */
export const MIN_SHARE = 8;

/** The name of an « Emplacement » (registry.js `slot`). */
export const SLOT = 'slot';

/**
 * A layout's tree as boxes: every share said (those left unsaid share what the others leave of 100 %).
 * @param {import('./grammar.js').LayoutNode} node @param {number} [share] @returns {Box}
 */
function toBox(node, share = 100) {
  if (node.t === 'cell') { const cell = cellText(canonical(node)); return cell === SLOT ? { share } : { share, cell }; }
  const said = node.kids.filter(k => k.size != null);
  const rest = Math.max(0, 100 - said.reduce((a, k) => a + /** @type {number} */ (k.size), 0)) / Math.max(1, node.kids.length - said.length);
  return { share, kids: node.kids.map(k => toBox(k, k.size ?? rest)) };
}

/** A layout as boxes; null when it is not one whole (an error in its text, no cell). @param {string} spec @returns {Box | null} */
export function boxOf(spec) {
  const { tree, errors } = parse(spec);
  return errors.length || !tree.kids.length ? null : toBox(tree);
}

/**
 * Boxes written as a layout (grammar.js), as short as the address can hold them: shares in whole per cents, and said
 * only in a list whose boxes are not shared evenly (« [slot,slot,slot] », « [map@20,[slot,plant]@80] »).
 * @param {Box} box @returns {string}
 */
export function specOf(box) {
  /** @param {Box} b @param {boolean} said */
  const write = (b, said) => (b.kids ? `[${listOf(b.kids)}]` : b.cell ?? SLOT) + (said ? '@' + Math.round(b.share) : '');
  /** @param {Box[]} kids */
  const listOf = kids => {
    const even = kids.every(k => Math.round(k.share) === Math.round(100 / kids.length));
    return kids.map(k => write(k, !even)).join(',');
  };
  return write(box, false);
}

/** The places of a grid. @param {Box} box @returns {number} */
export const placesOf = box => box.kids ? box.kids.reduce((n, k) => n + placesOf(k), 0) : 1;

/** The box at a path (indices from the top), or null. @param {Box} root @param {number[]} path @returns {Box | null} */
export function at(root, path) {
  /** @type {Box | undefined} */
  let box = root;
  for (const i of path) box = box?.kids?.[i];
  return box ?? null;
}

/** A copy to change. @param {Box} box @returns {Box} */
const copy = box => box.kids ? { share: box.share, kids: box.kids.map(copy) } : box.cell ? { share: box.share, cell: box.cell } : { share: box.share };

/** The direction a side cuts in. @param {Side} side */
const dirOf = side => side === 'left' || side === 'right' ? 'row' : 'col';

/**
 * Whether the place at `path` can be cut towards `side`: a place more on the screen (MAX_CELLS at most), and, when it
 * must become a list, one no deeper than the grammar allows (MAX_DEPTH).
 * @param {Box} root @param {number[]} path @param {Side} side
 */
export function canSplit(root, path, side) {
  const box = at(root, path);
  if (!box || box.kids || !path.length || placesOf(root) >= MAX_CELLS) return false;
  return dirAt(path.length - 1) === dirOf(side) || path.length <= MAX_DEPTH;
}

/**
 * The place at `path` cut in two towards `side`: the new place there, the grid otherwise the same. Returns the new
 * grid and the path of the new place; the grid as it was (and a null path) when it cannot be cut so.
 * @param {Box} root @param {number[]} path @param {Side} side @returns {{ root: Box, added: number[] | null }}
 */
export function split(root, path, side) {
  if (!canSplit(root, path, side)) return { root, added: null };
  const next = copy(root);
  const parent = /** @type {Box} */ (at(next, path.slice(0, -1)));
  const i = /** @type {number} */ (path.at(-1));
  const kids = /** @type {Box[]} */ (parent.kids);
  const place = kids[i];
  const before = side === 'left' || side === 'top';
  if (dirAt(path.length - 1) === dirOf(side)) {
    // Its list runs that way: the new place beside it, each half of its share.
    const half = place.share / 2;
    place.share = half;
    kids.splice(before ? i : i + 1, 0, { share: half });
    return { root: next, added: [...path.slice(0, -1), before ? i : i + 1] };
  }
  // Across its list: the place becomes a list of two, the new one first or last (the one cut keeps its cell).
  const old = place.cell ? { share: 50, cell: place.cell } : { share: 50 };
  kids[i] = { share: place.share, kids: before ? [{ share: 50 }, old] : [old, { share: 50 }] };
  return { root: next, added: [...path, before ? 0 : 1] };
}

/**
 * The place at `path` taken out: its share to the box before it (the one after, when it is the first); a list left
 * with a single box gives way to it — a place takes the list's share, a list's boxes join the list above (they run
 * the same way). The last place of the grid stays.
 * @param {Box} root @param {number[]} path @returns {Box}
 */
export function remove(root, path) {
  const box = at(root, path);
  if (!box || box.kids || !path.length || placesOf(root) <= 1) return root;
  const next = copy(root);
  const parent = /** @type {Box} */ (at(next, path.slice(0, -1)));
  const kids = /** @type {Box[]} */ (parent.kids);
  const i = /** @type {number} */ (path.at(-1));
  const [gone] = kids.splice(i, 1);
  kids[Math.max(0, i - 1)].share += gone.share;
  return path.length > 1 ? collapse(next, path.slice(0, -1)) : next;
}

/**
 * A list at `path` left with one box gives way to it.
 * @param {Box} root @param {number[]} path @returns {Box}
 */
function collapse(root, path) {
  const list = /** @type {Box} */ (at(root, path));
  if (!list.kids || list.kids.length !== 1) return root;
  const only = list.kids[0];
  const parent = /** @type {Box} */ (at(root, path.slice(0, -1)));
  const kids = /** @type {Box[]} */ (parent.kids);
  const i = /** @type {number} */ (path.at(-1));
  if (!only.kids) kids[i] = only.cell ? { share: list.share, cell: only.cell } : { share: list.share };
  // Its boxes run the way of the list above (two levels up): there, in its place, their shares scaled to the list's.
  else kids.splice(i, 1, ...only.kids.map(k => ({ ...k, share: k.share * list.share / 100 })));
  return root;
}

/**
 * Width or height moved from box i - 1 to box i of the list at `path` (in shares of that list); each kept at
 * MIN_SHARE at least. Returns the same grid when nothing moves.
 * @param {Box} root @param {number[]} path @param {number} i @param {number} delta @returns {Box}
 */
export function resize(root, path, i, delta) {
  const list = at(root, path);
  if (!list?.kids || i < 1 || i >= list.kids.length) return root;
  const a = list.kids[i - 1], b = list.kids[i];
  const pair = a.share + b.share;
  const was = a.share;
  const now = Math.min(pair - MIN_SHARE, Math.max(MIN_SHARE, was + delta));
  if (Math.abs(now - was) < 1e-9) return root;
  const next = copy(root);
  const kids = /** @type {Box[]} */ (/** @type {Box} */ (at(next, path)).kids);
  kids[i - 1].share = now;
  kids[i].share = pair - now;
  return next;
}

