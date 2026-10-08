// @ts-check
import { LitElement, html, css, nothing, repeat } from 'lit';
import { setQuery } from '../core/query.js';
import { StoreController, gridViewOf } from '../core/store.js';
import './gf-plant-card.js';
import { icon } from '../core/icons.js';

const ROW_HEIGHT = 76;
const COMPACT_ROW_HEIGHT = 44;
const GRID_ROW_HEIGHT = 52;
const ILLUSTRATED_ROW_HEIGHT = 112;
const HEADER_HEIGHT = 38;
const OVERSCAN = 6;

/**
 * Grid columns: the plant (photo, French name), its classification in the order of the filters
 * (family, genus, species), its statuses, then the row actions (♥, 📍).
 * Each sortable column sorts the results, and shows how many values of its filter are selected.
 */
export const COLUMNS = [
  { key: 'photo', label: 'Photo', sort: 'photo', facet: 'photo', width: '40px' },
  { key: 'fr', label: 'Nom français', sort: 'fr', facet: 'french', width: 'minmax(120px, 1.4fr)' },
  { key: 'family', label: 'Famille', sort: 'family', facet: 'family', width: 'minmax(90px, 1fr)' },
  { key: 'genus', label: 'Genre', sort: 'genus', facet: 'genus', width: 'minmax(80px, 0.9fr)' },
  { key: 'species', label: 'Espèce', sort: 'sci', width: 'minmax(80px, 1fr)' },
  { key: 'status', label: 'Statut', sort: 'status', facet: 'status', width: 'minmax(80px, 0.8fr)' },
  { key: 'legal', label: 'Protection', sort: 'legal', facet: 'legal', width: 'minmax(96px, 1.1fr)' },
  { key: 'fav', label: '', width: '36px' },
  { key: 'pin', label: '', width: '36px' }
];

/** Columns of each grid view. */
const VIEW_COLUMNS = {
  standard: ['photo', 'fr', 'family', 'genus', 'species', 'fav', 'pin'],
  epure: ['photo', 'fr', 'family', 'genus', 'species', 'fav', 'pin'],
  scientific: COLUMNS.map(c => c.key)
};

/** Results pane narrower than this: the least useful columns go. */
const NARROW = 760;

/** Visible column keys for a view and a pane width. @param {string} view @param {number} width @returns {string[]} */
export function gridColumns(view, width) {
  const keys = VIEW_COLUMNS[view] || VIEW_COLUMNS.standard;
  const drop = width < NARROW ? (view === 'scientific' ? ['genus', 'status'] : ['genus']) : [];
  return keys.filter(k => !drop.includes(k));
}

/** @param {string} key @param {string} view */
const columnWidth = (key, view) => key === 'photo' && view === 'epure' ? '96px'
  : key === 'fr' && view === 'epure' ? 'minmax(160px, 2fr)'
  : /** @type {any} */ (COLUMNS.find(c => c.key === key)).width;

/** The search itself (text, filters, sort): results refreshed for the same search keep their scroll. @param {any} query */
const searchKey = query => JSON.stringify([query.q, query.filters, query.sort]);

/** Scroll position survives navigating to a plant and back, until the search changes. */
let saved = { key: '', scrollTop: 0 };

/** Virtualized result list: only the rows in (or near) the viewport are in the DOM. */
export class GfPlantList extends LitElement {
  static properties = {
    /** Results grid (columns mirroring the filters) rather than cards. */
    grid: { type: Boolean, reflect: true },
    /** Id of the plant open in the plant pane. */
    current: { type: Number },
    _scrollTop: { state: true },
    _height: { state: true },
    _width: { state: true }
  };

  static styles = css`
    :host {
      display: block;
      overflow-y: auto;
      overscroll-behavior: contain;
      contain: strict;
      background: var(--gf-surface);
    }
    .spacer { position: relative; }
    gf-plant-card {
      position: absolute;
      left: 0;
      right: 0;
    }
    .empty {
      padding: 32px 16px;
      text-align: center;
      color: var(--gf-text-muted);
    }
    .head {
      position: sticky;
      top: 0;
      z-index: 2;
      display: grid;
      grid-template-columns: var(--gf-cols);
      align-items: center;
      column-gap: 12px;
      height: ${HEADER_HEIGHT}px;
      padding: 0 8px 0 12px;
      background: var(--gf-bg);
      border-bottom: 1px solid var(--gf-border);
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--gf-text-muted);
    }
    .th { display: flex; align-items: center; gap: 2px; min-width: 0; }
    .th button {
      font: inherit;
      color: inherit;
      background: none;
      border: 0;
      padding: 4px 2px;
      cursor: pointer;
      border-radius: 6px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-align: left;
    }
    .th button:hover { color: var(--gf-text); }
    .th button:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .th [aria-sort='ascending'], .th [aria-sort='descending'] { color: var(--gf-accent); }
    .th .sort[data-active] { color: var(--gf-accent); }
    .th .funnel {
      flex: none;
      font-size: 0.7rem;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 999px;
      background: var(--gf-accent);
      color: var(--gf-accent-contrast);
    }
    .th .funnel:hover { color: var(--gf-accent-contrast); }
    [hidden] { display: none !important; }
  `;

  #store = new StoreController(this);
  #resize = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    this._height = height;
    // Re-render on a width change only when it shows or hides columns (a pane being dragged changes it every frame).
    if ((width < NARROW) !== (this._width < NARROW)) this._width = width;
  });
  /** @type {any[] | null} */
  #items = null;
  /** Search the shown results answer (see `searchKey`). @type {string | null} */
  #key = null;
  #frame = 0;

  constructor() {
    super();
    this._scrollTop = 0;
    this._height = 800;
    this._width = 1000;
    this.grid = false;
    /** @type {number | null} */
    this.current = null;
    this.addEventListener('scroll', () => {
      cancelAnimationFrame(this.#frame);
      this.#frame = requestAnimationFrame(() => { this._scrollTop = this.scrollTop; });
    }, { passive: true });
  }

  connectedCallback() {
    super.connectedCallback();
    this.#resize.observe(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#resize.disconnect();
    // Once detached, the element reports scrollTop 0: keep the last position seen while scrolling.
    saved = { key: this.#key || '', scrollTop: this._scrollTop };
  }

  /**
   * A new search → back to the top. The same search refreshed (♥, a collection changed: a line action)
   * → the list stays where it is. Coming back from a plant → where it was.
   */
  updated() {
    const { results: { items }, query } = this.#store.state;
    if (items === this.#items) return;
    const key = searchKey(query);
    const first = this.#items === null;
    this.#items = items;
    if (key === this.#key) return;
    this.#key = key;
    const top = first && saved.key === key ? saved.scrollTop : 0;
    this.scrollTop = top;
    this._scrollTop = top;
  }

  /** Header click: sort by the column, again to reverse. @param {string} key */
  #sortBy(key) {
    const sort = this.#store.state.results.sort;
    setQuery({ sort: sort === key ? '-' + key : key });
  }

  /** Funnel of a column: show its filter (filters pane or sheet). @param {string} facet */
  #showFacet(facet) {
    this.dispatchEvent(new CustomEvent('focus-facet', { detail: { facet }, bubbles: true, composed: true }));
  }

  /** @param {string[]} keys */
  #header(keys) {
    const { results: { sort }, query: { filters } } = this.#store.state;
    return html`<div class="head" role="row">
      ${keys.map(key => /** @type {any} */ (COLUMNS.find(c => c.key === key))).map(c => {
        const active = c.sort && (sort === c.sort ? 'ascending' : sort === '-' + c.sort ? 'descending' : null);
        const count = c.facet ? filters[c.facet]?.length || 0 : 0;
        return html`<div class="th" role="columnheader" aria-sort=${active || 'none'}>
          ${c.sort ? html`<button class="sort" type="button" ?data-active=${Boolean(active)}
            title=${'Trier par ' + c.label.toLowerCase() + (active === 'ascending' ? ' (ordre inverse)' : '')}
            @click=${() => this.#sortBy(/** @type {string} */ (c.sort))}>${c.label}${active === 'ascending' ? html` ${icon('caret-up-fill')}` : active === 'descending' ? html` ${icon('caret-down-fill')}` : ''}</button>` : nothing}
          ${count ? html`<button class="funnel" type="button" title=${`Filtre ${c.label.toLowerCase()} : ${count} valeur${count > 1 ? 's' : ''}`}
            @click=${() => this.#showFacet(/** @type {string} */ (c.facet))}>${icon('funnel-fill')} ${count}</button>` : nothing}
        </div>`;
      })}
    </div>`;
  }

  render() {
    const { results: { items }, query: { q }, compact, status } = this.#store.state;
    const gridView = gridViewOf(this.#store.state);
    const columns = this.grid ? gridColumns(gridView, this._width) : [];
    if (this.grid) this.style.setProperty('--gf-cols', columns.map(k => columnWidth(k, gridView)).join(' '));
    const header = this.grid ? this.#header(columns) : nothing;
    if (status === 'ready' && !items.length) {
      return html`${header}<p class="empty">Aucune plante ne correspond à cette recherche.</p>`;
    }

    const rowHeight = this.grid ? (gridView === 'epure' ? ILLUSTRATED_ROW_HEIGHT : GRID_ROW_HEIGHT) : compact ? COMPACT_ROW_HEIGHT : ROW_HEIGHT;
    const offset = this.grid ? HEADER_HEIGHT : 0;
    const top = Math.max(0, this._scrollTop - offset);
    const first = Math.max(0, Math.floor(top / rowHeight) - OVERSCAN);
    const last = Math.min(items.length, Math.ceil((top + this._height) / rowHeight) + OVERSCAN);
    const visible = items.slice(first, last);

    return html`
      ${header}
      <div class="spacer" role="list" style="height:${items.length * rowHeight}px">
        ${repeat(visible, plant => plant.id, (plant, i) => html`
          <gf-plant-card
            role="listitem"
            style="top:${(first + i) * rowHeight}px;height:${rowHeight}px"
            .plant=${plant}
            .query=${q}
            .columns=${columns}
            view=${this.grid ? gridView : ''}
            ?compact=${compact && !this.grid}
            ?grid=${this.grid}
            ?current=${plant.id === this.current}
          ></gf-plant-card>
        `)}
      </div>
    `;
  }
}

customElements.define('gf-plant-list', GfPlantList);
