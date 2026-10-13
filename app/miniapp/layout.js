// @ts-check
// A mini-app's screen, worked out from its manifest (pure, tested under Node):
//  - layoutAt(m, path): what the steps walked so far have put on it — their components (« places »), folded step by
//    step (added, given blocks, dropped), the columns that hold one (an empty column is gone, its separator too), the
//    rows of each column, and what the last step brought (« newest »). Going back recomputes it from the shorter path;
//  - fit(columns, W, saved): those columns in a box W px wide — the tier (phone, tablet, wide), the columns merged as
//    tabs into another while their minimum widths do not fit (the lowest rank first, into its mergeInto), each one's
//    width (the one the user left, else its base, kept between its min and max and shrunk if the box is narrower:
//    the width remembered is never rewritten), and the CSS grid template. Never wider than W: no sideways scroll.

import { BP } from '../core/media.js';

/**
 * @typedef {import('./define.js').Manifest} Manifest
 * @typedef {import('./define.js').Column} Column
 * @typedef {import('./define.js').Place} Place
 * @typedef {'phone' | 'tablet' | 'wide'} Tier
 * @typedef {{ columns: Column[], places: Place[], stacks: Record<string, string[][]>, newest: string[] }} Layout
 * @typedef {Partial<Record<Tier, Record<string, number>>>} Widths   the widths the user gave, per tier and column
 * @typedef {{ id: string, w: number | 'fill', min: number, max?: number, tabs: string[] }} FitColumn   `tabs`: the columns it holds (itself first)
 * @typedef {{ tier: Tier, cols: FitColumn[], handles: [string, string][], template: string }} Fit
 */

/** Width of a separator between two columns (px). */
export const HANDLE = 7;

/** The tier of a box W px wide. @param {number} W @returns {Tier} */
export const tierOf = W => W < BP.phone ? 'phone' : W < BP.wide ? 'tablet' : 'wide';

/**
 * The screen after the steps of `path` (step ids, the start first). Steps not in the manifest are skipped.
 * @param {Manifest} m @param {string[]} path @returns {Layout}
 */
export function layoutAt(m, path) {
  const steps = new Map(m.steps.map(s => [s.id, s]));
  /** @type {Map<string, Place>} */
  const places = new Map();
  /** @type {Record<string, string[][]>} */
  const stacks = {};
  /** @type {string[]} */
  let newest = [];
  for (const id of path) {
    const step = steps.get(id);
    if (!step) continue;
    newest = [];
    for (const p of step.add ?? []) {
      const had = places.get(p.id);
      if (had) {
        // More blocks for a component already there (a plant sheet's): the same component, never a second one.
        const blocks = [...(had.blocks ?? [])];
        for (const b of p.blocks ?? []) if (!blocks.includes(b)) blocks.push(b);
        places.set(p.id, { ...had, blocks });
      } else {
        places.set(p.id, { ...p, blocks: [...(p.blocks ?? [])] });
        const rows = (stacks[/** @type {string} */ (p.col)] ??= []);
        const rowOf = (/** @type {string | undefined} */ ref) => ref === undefined ? -1 : rows.findIndex(r => r.includes(ref));
        const tab = rowOf(p.tabWith), below = rowOf(p.below);
        if (tab >= 0) rows[tab] = [...rows[tab], p.id];
        else if (below >= 0) rows.splice(below + 1, 0, [p.id]);
        else rows.push([p.id]);
      }
      newest.push(p.id);
    }
    for (const d of step.drop ?? []) {
      const p = places.get(d);
      if (!p) continue;
      places.delete(d);
      const col = /** @type {string} */ (p.col);
      stacks[col] = stacks[col].map(r => r.filter(x => x !== d)).filter(r => r.length);
    }
  }
  for (const col of Object.keys(stacks)) if (!stacks[col].length) delete stacks[col];
  return { columns: m.columns.filter(c => stacks[c.id]), places: [...places.values()], stacks, newest: newest.filter(id => places.has(id)) };
}

/**
 * The columns on screen in a box `W` px wide. `all`: every column of the manifest, to follow a mergeInto through a
 * column not on screen (default: `columns`).
 * @param {Column[]} columns the columns with something in them, in order @param {number} W @param {Widths | null} [saved] @param {Column[]} [all]
 * @returns {Fit}
 */
export function fit(columns, W, saved = null, all = columns) {
  const tier = tierOf(W);
  if (!columns.length) return { tier, cols: [], handles: [], template: 'minmax(0, 1fr)' };
  // A phone: one column, the others under it (or as tabs, or a sheet: the grid decides, from phone.rows).
  if (tier === 'phone') return { tier, cols: [{ id: columns[0].id, w: 'fill', min: 0, tabs: columns.map(c => c.id) }], handles: [], template: 'minmax(0, 1fr)' };

  const byId = new Map(all.map(c => [c.id, c]));
  /** @type {{ col: Column, tabs: string[], fill: boolean, min: number }[]} */
  const groups = columns.map(col => ({ col, tabs: [col.id], fill: col.base === 'fill', min: col.min }));
  const need = () => groups.reduce((n, g) => n + g.min, 0) + HANDLE * (groups.length - 1);
  while (groups.length > 1 && need() > W) {
    const g = groups.reduce((a, b) => b.col.rank < a.col.rank ? b : a);
    // Into its mergeInto, or the one that one went into…, else (none on screen) the column beside it.
    let target = null;
    for (let id = g.col.mergeInto, n = 0; id && !target && n < all.length; id = byId.get(id)?.mergeInto, n++) {
      target = groups.find(x => x !== g && x.tabs.includes(/** @type {string} */ (id))) ?? null;
    }
    const i = groups.indexOf(g);
    target ??= groups[i - 1] ?? groups[i + 1];
    target.tabs.push(...g.tabs);
    target.fill ||= g.fill;
    target.min = Math.max(target.min, g.min);
    groups.splice(i, 1);
  }
  // The row is always full: with no column filling it, the last one does.
  if (!groups.some(g => g.fill)) groups[groups.length - 1].fill = true;

  const widths = saved?.[tier] ?? {};
  const room = W - HANDLE * (groups.length - 1);
  const fillMin = groups.filter(g => g.fill).reduce((n, g) => n + g.min, 0);
  const px = groups.map(g => {
    if (g.fill) return 0;
    const want = widths[g.col.id] ?? (typeof g.col.base === 'number' ? g.col.base : g.min);
    return Math.min(Math.max(want, g.min), g.col.max ?? Infinity);
  });
  // Too wide for the box: each fixed column gives back in proportion to what it has over its minimum.
  const over = px.reduce((n, w) => n + w, 0) + fillMin - room;
  if (over > 0) {
    const slack = groups.reduce((n, g, i) => n + (g.fill ? 0 : px[i] - g.min), 0);
    groups.forEach((g, i) => { if (!g.fill && slack > 0) px[i] = Math.max(g.min, Math.floor(px[i] - over * (px[i] - g.min) / slack)); });
  }
  /** @type {FitColumn[]} */
  const cols = groups.map((g, i) => ({ id: g.col.id, w: g.fill ? 'fill' : px[i], min: g.min, max: g.col.max, tabs: g.tabs }));
  const handles = /** @type {[string, string][]} */ (cols.slice(1).map((c, i) => [cols[i].id, c.id]));
  const template = cols.map(c => c.w === 'fill' ? 'minmax(0, 1fr)' : c.w + 'px').join(` ${HANDLE}px `);
  return { tier, cols, handles, template };
}
