// @ts-check
// The layout of the plant pane, per mode: a tree of panes, as in an editor. A split lays its children in a row
// or a column (their shares of the room as weights); a stack is a pane holding blocks as tabs; the sheet is the
// scrolling sheet itself — one, always there — holding every block that is in no stack, in the mode's order.
// No tree: the sheet alone. Pure functions only: each operation returns a new, normalized tree.

/**
 * @typedef {{ t: 'sheet', id: 'sheet' }} SheetNode
 * @typedef {{ t: 'stack', id: string, tabs: string[], active: string | null, folded?: boolean, bare?: boolean }} StackNode
 * @typedef {{ t: 'split', id: string, dir: 'row' | 'col', kids: PaneNode[], sizes: number[] }} SplitNode
 * @typedef {SheetNode | StackNode | SplitNode} PaneNode
 * @typedef {'left' | 'right' | 'top' | 'bottom'} Side
 * @typedef {Side | 'center' | { tab: number }} Zone
 */

/** @type {SheetNode} */
export const SHEET = Object.freeze({ t: 'sheet', id: 'sheet' });
/** A new pane's share when it is docked beside another (that one keeps the rest). */
const NEW_SHARE = 0.42;
const MAX_DEPTH = 6, MAX_NODES = 60;

let counter = 0;
/** @returns {string} */
export const newId = () => 'p' + Date.now().toString(36) + (counter++).toString(36);

/** @param {Side} side */
const dirOf = side => side === 'left' || side === 'right' ? 'row' : 'col';
/** @param {Side} side */
const before = side => side === 'left' || side === 'top';

/** Every node, depth first. @param {PaneNode} node @returns {PaneNode[]} */
export function nodes(node) {
  return node.t === 'split' ? [node, ...node.kids.flatMap(nodes)] : [node];
}

/** The panes (stacks and the sheet), depth first: their order on a narrow screen. @param {PaneNode} tree */
export const leaves = tree => nodes(tree).filter(n => n.t !== 'split');

/** @param {PaneNode} tree @param {string} id @returns {PaneNode | null} */
export const find = (tree, id) => nodes(tree).find(n => n.id === id) || null;

/** The stack holding a block. @param {PaneNode} tree @param {string} key @returns {StackNode | null} */
export const stackOf = (tree, key) => /** @type {StackNode | undefined} */ (nodes(tree).find(n => n.t === 'stack' && n.tabs.includes(key))) || null;

/** The blocks in stacks. @param {PaneNode} tree */
export const stacked = tree => new Set(nodes(tree).flatMap(n => n.t === 'stack' ? n.tabs : []));

/** Is the sheet in a row next to other panes (the plant pane is made wider for it)? @param {PaneNode} tree */
export const sheetInRow = tree => nodes(tree).some(n => n.t === 'split' && n.dir === 'row' && n.kids.length > 1 && nodes(n).some(m => m.t === 'sheet'));

/**
 * The tree made sound: unknown or repeated blocks out, empty stacks out, a split of one child replaced by it,
 * a split in a split of the same direction merged, weights positive, one sheet (added on the right when lost).
 * @param {PaneNode | null | undefined} tree @param {(key: string) => boolean} [isKey]
 * @returns {PaneNode}
 */
export function normalize(tree, isKey = () => true) {
  const seen = new Set();
  let sheets = 0;
  /** @param {any} n @returns {PaneNode | null} */
  const walk = n => {
    if (!n || typeof n !== 'object') return null;
    if (n.t === 'sheet') { if (sheets++) return null; return SHEET; }
    if (n.t === 'stack') {
      const tabs = (Array.isArray(n.tabs) ? n.tabs : []).filter((/** @type {any} */ k) => typeof k === 'string' && isKey(k) && !seen.has(k) && seen.add(k));
      if (!tabs.length) return null;
      /** @type {StackNode} */
      const s = { t: 'stack', id: typeof n.id === 'string' ? n.id : newId(), tabs, active: tabs.includes(n.active) ? n.active : tabs[0] };
      if (n.folded) s.folded = true;
      if (n.bare) s.bare = true;
      return s;
    }
    if (n.t === 'split' && Array.isArray(n.kids)) {
      const dir = n.dir === 'col' ? 'col' : 'row';
      /** @type {PaneNode[]} */ const kids = [];
      /** @type {number[]} */ const sizes = [];
      n.kids.forEach((/** @type {any} */ k, /** @type {number} */ i) => {
        const w = Number(n.sizes?.[i]);
        const size = Number.isFinite(w) && w > 0 ? w : 1;
        const c = walk(k);
        if (!c) return;
        // A split of the same direction inside: its children join this one, sharing its weight.
        if (c.t === 'split' && c.dir === dir) {
          const total = c.sizes.reduce((a, b) => a + b, 0) || 1;
          c.kids.forEach((g, j) => { kids.push(g); sizes.push(size * c.sizes[j] / total); });
        } else { kids.push(c); sizes.push(size); }
      });
      if (!kids.length) return null;
      if (kids.length === 1) return kids[0];
      const total = sizes.reduce((a, b) => a + b, 0);
      return { t: 'split', id: typeof n.id === 'string' ? n.id : newId(), dir, kids, sizes: sizes.map(s => Math.round(s / total * 1000) / 1000) };
    }
    return null;
  };
  const root = walk(tree);
  if (!sheets) return root ? { t: 'split', id: newId(), dir: 'row', kids: [root, SHEET], sizes: [NEW_SHARE, 1 - NEW_SHARE] } : SHEET;
  return root || SHEET;
}

/** Replaces a node (by id) with what `fn` makes of it. @param {PaneNode} tree @param {string} id @param {(n: PaneNode) => PaneNode} fn @returns {PaneNode} */
function replace(tree, id, fn) {
  if (tree.id === id) return fn(tree);
  if (tree.t !== 'split') return tree;
  return { ...tree, kids: tree.kids.map(k => replace(k, id, fn)) };
}

/** The block out of every stack (back in the sheet). @param {PaneNode} tree @param {string} key @returns {PaneNode} */
export function undock(tree, key) {
  /** @param {PaneNode} n @returns {PaneNode} */
  const walk = n => n.t === 'stack' ? { ...n, tabs: n.tabs.filter(k => k !== key) } : n.t === 'split' ? { ...n, kids: n.kids.map(walk) } : n;
  return normalize(walk(tree));
}

/**
 * A block docked: on a side of a pane (a new pane there, taking part of its room), in its centre (a tab of
 * that stack), or at a place among its tabs. `root:` before the side: across the whole frame.
 * A layout the import would refuse (validTree: too deep, too many panes) is never built: the tree is then
 * returned as it was, the block where it was, so a saved layout can always be read back (audit TEST-6).
 * @param {PaneNode} tree @param {string} key @param {string} targetId a node's id, or 'root'
 * @param {Zone} zone
 * @returns {PaneNode}
 */
export function dock(tree, key, targetId, zone) {
  const out = dockAnyhow(tree, key, targetId, zone);
  return validTree(out) || !validTree(tree) ? out : tree;
}

/** dock(), without the bound. @param {PaneNode} tree @param {string} key @param {string} targetId @param {Zone} zone @returns {PaneNode} */
function dockAnyhow(tree, key, targetId, zone) {
  const out = undock(tree, key);
  const target = targetId === 'root' ? out : find(out, targetId);
  if (!target) return out;
  if (zone === 'center' || typeof zone === 'object') {
    if (target.t !== 'stack') return out;
    return normalize(replace(out, target.id, n => {
      const s = /** @type {StackNode} */ (n);
      const tabs = [...s.tabs];
      tabs.splice(typeof zone === 'object' ? Math.max(0, Math.min(tabs.length, zone.tab)) : tabs.length, 0, key);
      return { ...s, tabs, active: key, folded: false };
    }));
  }
  /** @type {StackNode} */
  const pane = { t: 'stack', id: newId(), tabs: [key], active: key };
  const dir = dirOf(zone);
  const parent = targetId === 'root' ? null : /** @type {SplitNode | undefined} */ (nodes(out).find(n => n.t === 'split' && n.kids.some(k => k.id === target.id)));
  if (parent && parent.dir === dir) {
    // Beside it in the same row (column): it shares the target's weight.
    return normalize(replace(out, parent.id, n => {
      const p = /** @type {SplitNode} */ (n);
      const i = p.kids.findIndex(k => k.id === target.id);
      const share = p.sizes[i] * NEW_SHARE;
      const kids = [...p.kids], sizes = [...p.sizes];
      sizes[i] -= share;
      const at = before(zone) ? i : i + 1;
      kids.splice(at, 0, pane); sizes.splice(at, 0, share);
      return { ...p, kids, sizes };
    }));
  }
  return normalize(replace(out, target.id, n => ({
    t: 'split', id: newId(), dir,
    kids: before(zone) ? [pane, n] : [n, pane],
    sizes: before(zone) ? [NEW_SHARE, 1 - NEW_SHARE] : [1 - NEW_SHARE, NEW_SHARE]
  })));
}

/** New weights for a split's children. @param {PaneNode} tree @param {string} id @param {number[]} sizes */
export function setSizes(tree, id, sizes) {
  return normalize(replace(tree, id, n => n.t === 'split' && sizes.length === n.kids.length ? { ...n, sizes: sizes.map(s => Math.max(0.05, s)) } : n));
}

/** A stack's state (active tab, folded, bare). @param {PaneNode} tree @param {string} id @param {Partial<StackNode>} patch */
export function patchStack(tree, id, patch) {
  return normalize(replace(tree, id, n => n.t === 'stack' ? { ...n, ...patch, t: 'stack', id: n.id, tabs: n.tabs } : n));
}

/** A tree from a file or storage: well formed, not too big. @param {any} x */
export function validTree(x) {
  let count = 0, sheets = 0;
  /** @param {any} n @param {number} depth @returns {boolean} */
  const ok = (n, depth) => {
    if (!n || typeof n !== 'object' || depth > MAX_DEPTH || ++count > MAX_NODES) return false;
    if (n.t === 'sheet') return ++sheets === 1;
    if (n.t === 'stack') return typeof n.id === 'string' && Array.isArray(n.tabs) && n.tabs.length > 0 && n.tabs.every((/** @type {any} */ k) => typeof k === 'string' && k.length < 80);
    if (n.t === 'split') return typeof n.id === 'string' && (n.dir === 'row' || n.dir === 'col') && Array.isArray(n.kids) && n.kids.length > 1
      && Array.isArray(n.sizes) && n.sizes.length === n.kids.length && n.sizes.every((/** @type {any} */ s) => typeof s === 'number' && s > 0)
      && n.kids.every((/** @type {any} */ k) => ok(k, depth + 1));
    return false;
  };
  return ok(x, 0) && sheets === 1;
}

/**
 * The old positions (blocks stuck to an edge of the plant pane, or beside it) as a tree: the sheet; top and
 * bottom above and under it, then the left and right columns; then the bands and columns across the whole
 * pane; what was beside, a folded pane on the right. Sizes S / M / L (or dragged px) become shares.
 * @param {Record<string, string>} place block → 'top' | 'bottom' | 'left' | 'right' | 'beside'
 * @param {Record<string, any>} edges edge → { size, px, folded, full, bare, tab }
 * @param {string[]} order the mode's block order
 * @returns {PaneNode | null}
 */
export function treeFromPlaces(place, edges, order) {
  const keysAt = (/** @type {string} */ p) => {
    const ks = Object.keys(place).filter(k => place[k] === p);
    return ks.sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
  };
  const share = (/** @type {string} */ side) => {
    const e = edges?.[side] || {};
    if (typeof e.px === 'number' && e.px > 0) return Math.min(0.7, Math.max(0.15, e.px / (side === 'left' || side === 'right' ? 1000 : 800)));
    return e.size === 's' ? 0.33 : e.size === 'l' ? 0.6 : 0.5;
  };
  const stackAt = (/** @type {string} */ side) => {
    const tabs = keysAt(side);
    if (!tabs.length) return null;
    const e = edges?.[side] || {};
    /** @type {StackNode} */
    const s = { t: 'stack', id: newId(), tabs, active: tabs.includes(e.tab) ? e.tab : tabs[0] };
    if (e.folded) s.folded = true;
    if (e.bare) s.bare = true;
    return s;
  };
  /** @type {PaneNode} */
  let tree = SHEET;
  let changed = false;
  /** @param {Side} side @param {boolean} full */
  const wrap = (side, full) => {
    if (Boolean(edges?.[side]?.full) !== full) return;
    const s = stackAt(side);
    if (!s) return;
    const w = share(side);
    tree = { t: 'split', id: newId(), dir: dirOf(side), kids: before(side) ? [s, tree] : [tree, s], sizes: before(side) ? [w, 1 - w] : [1 - w, w] };
    changed = true;
  };
  for (const full of [false, true]) for (const side of /** @type {Side[]} */ (['top', 'bottom', 'left', 'right'])) wrap(side, full);
  const beside = keysAt('beside');
  if (beside.length) {
    tree = { t: 'split', id: newId(), dir: 'row', kids: [tree, { t: 'stack', id: newId(), tabs: beside, active: beside[0], folded: true }], sizes: [0.7, 0.3] };
    changed = true;
  }
  return changed ? normalize(tree) : null;
}
