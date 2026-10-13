// @ts-check
// The grid of a mini-app: every component on screen is a direct child of ONE display:grid, keyed (repeat), however
// the columns are laid out — side by side, merged as tabs, under one another on a phone. A step or a tier changes
// the grid's CSS and the cells' attributes, never what holds them: a map made once (gf-map) stays the same map.
//  - Columns: layout.js#fit, from the box's own width (a ResizeObserver: the box, not the window); between two, a
//    separator (core/panes.js, as in Mes plantes and the Carte: guide line, ← → / Début / Fin / Entrée, double
//    click). The widths are kept per tier under geoflora.app.<id>.layout; the one beside a map holds its frame.
//  - Rows of a column: 12 grid rows shared out (n ≤ 3 components: 12 / n each); components in tabs share one area,
//    the others [hidden], a tab strip at its top.
//  - A phone: one column; each column a row of the height phone.rows gives it; a component placed 'sheet' covers the
//    box while it has something to show (kit `empty`), with « Fermer ».

import { LitElement, html, css, nothing, repeat } from 'lit';
import { PaneSizer, paneStyles } from '../core/panes.js';
import { fit, HANDLE } from './layout.js';
import { kit } from './kit.js';
import { storageKey } from './runtime.js';
import { icon } from '../core/icons.js';
import { ui } from '../styles/ui.js';

/**
 * @typedef {import('./define.js').Place} Place
 * @typedef {import('./layout.js').Fit} Fit
 * @typedef {{ kind: 'cell', key: string, place: Place, area: string, hidden: boolean, tabbed: boolean, sheet: boolean }
 *   | { kind: 'tabs', key: string, area: string, tabs: { id: string, label: string, fresh: boolean }[], active: string, group: string }
 *   | { kind: 'handle', key: string, area: string, l: string, r: string }} Item
 */

const ROWS = 12;

export class MaGrid extends LitElement {
  static properties = {
    app: { attribute: false },
    /** The context as last rendered (a new one: drawn again). */
    c: { attribute: false },
    /** The steps walked (another path: drawn again). */
    path: { attribute: false },
    _w: { state: true },
    /** The tab shown in each group of tabs (a merged column, a row of tabs), by group. */
    _tabs: { state: true }
  };

  static styles = [ui, paneStyles, css`
    :host { display: block; position: relative; min-height: 0; height: 100%; container-type: inline-size; }
    .grid { display: grid; height: 100%; min-height: 0; grid-template-rows: repeat(${ROWS}, minmax(0, 1fr)); }
    .grid.phone { overflow-y: auto; overscroll-behavior: contain; grid-template-rows: none; }
    .cell { position: relative; min-width: 0; min-height: 0; overflow: auto; display: flex; flex-direction: column; background: var(--gf-surface); }
    .cell > * { flex: 1; min-height: 0; }
    .cell[hidden] { display: none; }
    .cell.tabbed { margin-top: 40px; }
    .cell.sheet { position: absolute; inset: 0; z-index: 20; grid-area: auto; }
    .sheet-bar { flex: none; display: flex; align-items: center; min-height: 44px; padding: 0 8px; border-bottom: 1px solid var(--gf-border); }
    .strip { align-self: start; z-index: 2; display: flex; gap: 2px; height: 40px; padding: 4px 6px 0; border-bottom: 1px solid var(--gf-border); background: var(--gf-surface); overflow-x: auto; }
    .strip button { min-height: 0; padding: 4px 12px; border: 0; border-radius: 8px 8px 0 0; background: none; box-shadow: none; font-size: 0.85rem; }
    .strip button[aria-selected='true'] { background: var(--gf-accent-soft); color: var(--gf-accent); font-weight: 700; }
    .fresh { display: inline-block; width: 7px; height: 7px; margin-left: 6px; border-radius: 50%; background: var(--gf-accent); }
    .grid { position: relative; }
    .grid > .split { grid-row: 1 / span ${ROWS}; margin: 0 -3px; width: auto; }
    @media (pointer: coarse) { .grid > .split { margin: 0 -9px; } }
  `];

  constructor() {
    super();
    /** @type {import('./runtime.js').MiniApp | null} */
    this.app = null;
    /** @type {Record<string, any> | null} */
    this.c = null;
    /** @type {string[]} */
    this.path = [];
    this._w = 0;
    /** @type {Record<string, string>} */
    this._tabs = {};
  }

  /** @type {PaneSizer | null} */ #sizer = null;
  #size = new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w !== this._w) this._w = w; });

  connectedCallback() {
    super.connectedCallback();
    this.#size.observe(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#size.disconnect();
  }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    // The widths of this app's columns, per tier ('wide:list'), kept as Mes plantes keeps its panes'.
    if (changed.has('app') && this.app) {
      this.#sizer = new PaneSizer(this, storageKey(this.app.m.id, 'layout'), {}, {
        // A map beside the separator keeps its frame as its column changes width.
        onChange: () => { for (const m of this.renderRoot.querySelectorAll('gf-map')) /** @type {any} */ (m).holdFrame?.(); }
      });
    }
  }

  /** The widths back to the manifest's (« Remettre la mise en page »). */
  resetLayout() {
    const s = this.#sizer;
    if (!s) return;
    for (const pane of Object.keys(s.state.widths)) s.reset(pane);
    this._tabs = {};
  }

  render() {
    const app = this.app;
    if (!app || !this._w) return html`<div class="grid"></div>`;
    const layout = app.layout;
    const sizer = /** @type {PaneSizer} */ (this.#sizer);
    /** @type {Record<string, Record<string, number>>} */
    const saved = {};
    for (const [k, w] of Object.entries(sizer.state.widths)) { const [tier, col] = k.split(':'); (saved[tier] ??= {})[col] = w; }
    const f = fit(layout.columns, this._w, saved, app.m.columns);
    const items = f.tier === 'phone' ? this.#phoneItems(f) : this.#wideItems(f);
    const style = f.tier === 'phone' ? `grid-template-columns: minmax(0, 1fr); grid-template-rows: ${this.#phoneRows(f)}` : `grid-template-columns: ${f.template}`;
    const byPlace = new Map(layout.places.map(p => [p.id, p]));
    return html`<div class="grid ${f.tier}" style=${style}>${repeat(items, it => it.key, it => {
      // Placed by the grid itself: its row is set (.split below), its column is the next free one, between the two.
      if (it.kind === 'handle') return this.#handle(it.l, it.r, f, sizer);
      if (it.kind === 'tabs') return html`<div class="strip" role="tablist" aria-label="Volets" style=${it.area}>${it.tabs.map(t => html`<button type="button" role="tab"
        aria-selected=${t.id === it.active ? 'true' : 'false'} @click=${() => { this._tabs = { ...this._tabs, [it.group]: t.id }; }}>${t.label}${t.fresh ? html`<span class="fresh" title="Nouveau"></span><span class="visually-hidden"> (nouveau)</span>` : nothing}</button>`)}</div>`;
      const p = /** @type {Place} */ (byPlace.get(it.place.id) ?? it.place);
      const comp = kit[/** @type {string} */ (p.use)];
      const title = p.title || app.m.columns.find(c => c.id === p.col)?.title || p.id;
      return html`<section class="cell ${it.tabbed ? 'tabbed' : ''} ${it.sheet ? 'sheet' : ''}" data-place=${p.id} aria-label=${title} style=${it.sheet ? '' : it.area} ?hidden=${it.hidden}>
        ${it.sheet ? html`<div class="sheet-bar"><button class="link" type="button" @click=${() => app.set(comp.clear ?? {})}>${icon('arrow-left')} Fermer</button></div>` : nothing}
        ${comp ? comp.render(this.c ?? app.c, app, p) : nothing}</section>`;
    })}</div>`;
  }

  /** The separator between the columns `l` and `r`: it sizes the one of fixed width (the other fills). @param {string} l @param {string} r @param {Fit} f @param {PaneSizer} sizer */
  #handle(l, r, f, sizer) {
    const cl = /** @type {import('./layout.js').FitColumn} */ (f.cols.find(c => c.id === l)), cr = /** @type {import('./layout.js').FitColumn} */ (f.cols.find(c => c.id === r));
    const [col, side] = cl.w !== 'fill' ? [cl, /** @type {const} */ ('left')] : [cr, /** @type {const} */ ('right')];
    const pane = f.tier + ':' + col.id;
    const others = f.cols.filter(c => c !== col).reduce((n, c) => n + c.min, 0) + HANDLE * (f.cols.length - 1);
    sizer.panes[pane] = { width: typeof col.w === 'number' ? col.w : col.min, min: col.min,
      title: this.app?.m.columns.find(c => c.id === col.id)?.title || col.id };
    return sizer.split(pane, side, () => Math.min(col.max ?? Infinity, this._w - others));
  }

  /** The cells, strips and separators side by side. @param {Fit} f @returns {Item[]} */
  #wideItems(f) {
    const app = /** @type {import('./runtime.js').MiniApp} */ (this.app);
    const { stacks, newest } = app.layout;
    const byPlace = new Map(app.layout.places.map(p => [p.id, p]));
    /** @type {Item[]} */
    const items = [];
    f.cols.forEach((col, i) => {
      const x = 2 * i + 1;
      /** @type {Item[]} */
      const strips = [], hidden = [], shown = [];
      // A column holding others (merged): one tab each, the one with something new first shown.
      const group = 'col:' + col.id;
      const active = col.tabs.includes(this._tabs[group]) ? this._tabs[group] : col.tabs.find(t => (stacks[t] || []).flat().some(id => newest.includes(id))) ?? col.tabs[0];
      if (col.tabs.length > 1) {
        strips.push({ kind: 'tabs', key: 'tabs:' + group, group, active, area: `grid-column: ${x}; grid-row: 1 / span ${ROWS}`,
          tabs: col.tabs.map(t => ({ id: t, label: app.m.columns.find(c => c.id === t)?.title || t, fresh: t !== active && (stacks[t] || []).flat().some(id => newest.includes(id)) })) });
      }
      for (const t of col.tabs) {
        const rows = stacks[t] || [];
        const span = Math.max(1, Math.floor(ROWS / Math.max(1, rows.length)));
        rows.forEach((row, ri) => {
          const start = 1 + ri * span, len = ri === rows.length - 1 ? ROWS - ri * span : span;
          const rowGroup = 'row:' + row[0];
          const rowActive = row.includes(this._tabs[rowGroup]) ? this._tabs[rowGroup] : row.find(id => newest.includes(id)) ?? row[0];
          if (row.length > 1) {
            strips.push({ kind: 'tabs', key: 'tabs:' + rowGroup, group: rowGroup, active: rowActive, area: `grid-column: ${x}; grid-row: ${start} / span ${len}`,
              tabs: row.map(id => ({ id, label: byPlace.get(id)?.title || id, fresh: id !== rowActive && newest.includes(id) })) });
          }
          for (const id of row) {
            const off = t !== active || id !== rowActive;
            const cell = { kind: /** @type {const} */ ('cell'), key: 'cell:' + id, place: /** @type {Place} */ (byPlace.get(id)), area: `grid-column: ${x}; grid-row: ${start} / span ${len}`,
              hidden: off, tabbed: col.tabs.length > 1 || row.length > 1, sheet: false };
            (off ? hidden : shown).push(cell);
          }
        });
      }
      // The separator's neighbours are cells of full width: a strip (or a cell shown) first, a cell shown last.
      items.push(...strips, ...hidden, ...shown);
      if (i < f.cols.length - 1) items.push({ kind: 'handle', key: 'handle:' + col.id + '|' + f.cols[i + 1].id, area: '', l: col.id, r: f.cols[i + 1].id });
    });
    return items;
  }

  /** A phone: the columns as rows (phone.rows), a sheet over the rest. @param {Fit} f @returns {Item[]} */
  #phoneItems(f) {
    const app = /** @type {import('./runtime.js').MiniApp} */ (this.app);
    const { stacks, newest } = app.layout;
    const c = this.c ?? app.c;
    const byPlace = new Map(app.layout.places.map(p => [p.id, p]));
    /** @type {Item[]} */
    const items = [];
    let row = 1;
    for (const col of this.#phoneOrder(f)) {
      const size = this.#rowSize(col);
      const ids = (stacks[col] || []).flat();
      const asSheet = (/** @type {string} */ id) => size === 'sheet' || byPlace.get(id)?.phone === 'sheet';
      const inRow = ids.filter(id => !asSheet(id) && byPlace.get(id)?.phone !== 'hide');
      for (const id of ids.filter(asSheet)) {
        const comp = kit[/** @type {string} */ (byPlace.get(id)?.use)];
        items.push({ kind: 'cell', key: 'cell:' + id, place: /** @type {Place} */ (byPlace.get(id)), area: '', hidden: Boolean(comp?.empty?.(c)), tabbed: false, sheet: true });
      }
      if (!inRow.length) continue;
      const group = 'phone:' + col;
      const active = inRow.includes(this._tabs[group]) ? this._tabs[group] : inRow[0];
      const tabbed = size === 'tabs' && inRow.length > 1;
      if (tabbed) items.push({ kind: 'tabs', key: 'tabs:' + group, group, active, area: `grid-row: ${row}`, tabs: inRow.map(id => ({ id, label: byPlace.get(id)?.title || id, fresh: id !== active && newest.includes(id) })) });
      for (const id of inRow) {
        items.push({ kind: 'cell', key: 'cell:' + id, place: /** @type {Place} */ (byPlace.get(id)), area: `grid-row: ${tabbed ? row : row++}`, hidden: tabbed && id !== active, tabbed, sheet: false });
      }
      if (tabbed) row++;
    }
    return items;
  }

  /** The columns in phone.rows' order (the others after them). @param {Fit} f */
  #phoneOrder(f) {
    const listed = (this.app?.m.phone.rows ?? []).map(([z]) => z.split(':')[0]);
    const all = f.cols[0]?.tabs ?? [];
    return [...listed.filter(z => all.includes(z)), ...all.filter(z => !listed.includes(z))].filter((z, i, a) => a.indexOf(z) === i);
  }

  /** @param {string} col */
  #rowSize(col) { return this.app?.m.phone.rows.find(([z]) => z.split(':')[0] === col)?.[1] ?? 'auto'; }

  /** The rows' heights on a phone. @param {Fit} f */
  #phoneRows(f) {
    const app = /** @type {import('./runtime.js').MiniApp} */ (this.app);
    const { stacks } = app.layout;
    const sizes = [];
    for (const col of this.#phoneOrder(f)) {
      const size = this.#rowSize(col);
      if (size === 'sheet') continue;
      const ids = (stacks[col] || []).flat().filter(id => !['sheet', 'hide'].includes(app.layout.places.find(p => p.id === id)?.phone ?? ''));
      const n = size === 'tabs' ? 1 : ids.length;
      for (let i = 0; i < n; i++) sizes.push(size === 'tabs' ? 'auto' : size === '1fr' ? 'minmax(0, 1fr)' : size);
    }
    return sizes.join(' ') || 'minmax(0, 1fr)';
  }
}

customElements.define('ma-grid', MaGrid);
