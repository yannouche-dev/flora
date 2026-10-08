// @ts-check
import { LitElement, html, css, nothing, repeat } from 'lit';
import { ui } from '../styles/ui.js';
import { icon } from '../core/icons.js';

/**
 * @typedef {{ value: string, label: string, count: number, title?: string, icon?: import('../core/icons.js').IconName }} FacetOption
 */

const fold = (/** @type {string} */ s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * One multi-select filter group: checkboxes with live counts (selecting never reorders the list),
 * optional inner search and "voir plus" for long lists.
 * Fires `facet-change` with `{ name, values }`.
 */
export class GfFacet extends LitElement {
  static properties = {
    name: {},
    label: {},
    options: { attribute: false },
    selected: { attribute: false },
    searchable: { type: Boolean },
    limit: { type: Number },
    hideEmpty: { type: Boolean, attribute: 'hide-empty' },
    /** Keep the options in the given order (no re-sorting by live counts). */
    ordered: { type: Boolean },
    open: { type: Boolean, reflect: true },
    /** Position among the filters: where the header stacks once stuck. */
    stack: { type: Number },
    _filter: { state: true },
    _expanded: { state: true }
  };

  static styles = [ui, css`
    /*
     * The host has no box: the header's sticky box is then bounded by the whole filter list, not by this facet.
     * Headers stay stuck once scrolled past, stacked in order (--stack: this facet's position).
     */
    :host { display: contents; --head-h: 40px; }
    .head {
      position: sticky;
      top: calc(var(--stack, 0) * var(--head-h));
      z-index: 2;
      height: var(--head-h);
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--gf-surface);
      border-bottom: 1px solid var(--gf-border);
    }
    :host(.flash) .head, :host(.flash) .body { animation: flash 1.2s ease-out; }
    @keyframes flash { from { background: var(--gf-accent-soft); } }
    .toggle {
      flex: 1;
      min-width: 0;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 8px;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: none;
      color: var(--gf-text);
      font-weight: 600;
      font-size: 0.9rem;
      text-align: left;
    }
    .toggle::after {
      content: '';
      margin: 0 4px 0 auto;
      width: 8px;
      height: 8px;
      border-right: 2px solid var(--gf-text-muted);
      border-bottom: 2px solid var(--gf-text-muted);
      transform: translateY(-2px) rotate(45deg);
      transition: transform 0.15s;
    }
    :host([open]) .toggle::after { transform: translateY(2px) rotate(-135deg); }
    .toggle:focus-visible { box-shadow: var(--gf-focus); }
    .body {
      padding: 2px 0 12px;
      border-bottom: 1px solid var(--gf-border);
      /* Scrolled to (funnel in the results grid): lands just below the stacked headers. */
      scroll-margin-top: calc((var(--stack, 0) + 1) * var(--head-h));
    }
    .badge {
      background: var(--gf-accent);
      color: var(--gf-accent-contrast);
      border-radius: var(--gf-radius-pill);
      font-size: 0.7rem;
      padding: 0 7px;
      line-height: 1.5;
    }
    .link { font-size: 0.8rem; }
    input[type='search'] { margin: 8px 0 4px; font-size: 0.85rem; min-height: 34px; padding: 6px 12px; }
    ul { list-style: none; margin: 6px 0 0; padding: 0; }
    li label {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 2px;
      font-size: 0.875rem;
      cursor: pointer;
      border-radius: 6px;
    }
    li label:hover { background: var(--gf-surface-2); }
    input[type='checkbox'] { width: 16px; height: 16px; margin: 0; flex: none; }
    .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .count { color: var(--gf-text-muted); font-size: 0.8rem; font-variant-numeric: tabular-nums; }
    li.empty label { opacity: 0.45; }
    .link.more { display: block; margin-top: 6px; }
    .none { font-size: 0.8rem; color: var(--gf-text-muted); padding: 4px 2px; }
  `];

  constructor() {
    super();
    this.name = '';
    this.label = '';
    /** @type {FacetOption[]} */
    this.options = [];
    /** @type {string[]} */
    this.selected = [];
    this.searchable = false;
    this.limit = 0;
    this.hideEmpty = false;
    this.ordered = false;
    this.open = true;
    this.stack = 0;
    this._filter = '';
    this._expanded = false;
  }

  /** @param {Map<string, any>} changed */
  updated(changed) {
    if (changed.has('stack')) this.style.setProperty('--stack', String(this.stack));
  }

  /** Opens the facet and scrolls its list into view, below the stacked headers. */
  async reveal() {
    this.open = true;
    await this.updateComplete;
    this.renderRoot.querySelector('.body')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  /** @param {string[]} values */
  #emit(values) {
    this.dispatchEvent(new CustomEvent('facet-change', {
      detail: { name: this.name, values },
      bubbles: true,
      composed: true
    }));
  }

  /** @param {string} value @param {Event} event */
  #toggle(value, event) {
    const checked = /** @type {HTMLInputElement} */ (event.target).checked;
    this.#emit(checked ? [...this.selected, value] : this.selected.filter(v => v !== value));
  }

  render() {
    const selected = new Set(this.selected);
    const filter = fold(this._filter.trim());

    // By count, then by name. Selecting does not move a value; a selected one past the limit stays shown in place.
    let options = this.options
      .filter(o => selected.has(o.value) || !this.hideEmpty || o.count > 0)
      .filter(o => !filter || fold(o.label).includes(filter));
    if (this.limit && !this.ordered) options = options.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr'));
    const limit = this.limit && !this._expanded && !filter ? this.limit : Infinity;
    const shown = options.filter((o, i) => i < limit || selected.has(o.value));
    const hidden = options.length - shown.length;

    return html`
      <div class="head">
        <button class="toggle" type="button" aria-expanded=${this.open ? 'true' : 'false'} aria-controls="body"
          @click=${() => {
            this.open = !this.open;
            this.dispatchEvent(new CustomEvent('facet-toggle', { detail: { name: this.name, open: this.open }, bubbles: true, composed: true }));
          }}>
          ${this.label}
          ${selected.size ? html`<span class="badge">${selected.size}</span>` : nothing}
        </button>
        ${selected.size ? html`<button class="link clear" type="button" @click=${() => this.#emit([])}>effacer</button>` : nothing}
      </div>
      ${this.open ? html`<div class="body" id="body">
        ${this.searchable ? html`
          <input type="search" placeholder="Filtrer ${this.label.toLowerCase()}…" aria-label="Filtrer ${this.label}"
            .value=${this._filter} @input=${e => { this._filter = e.target.value; }} />` : nothing}
        <!-- Keyed rows: a checkbox stays with its value when counts reorder the list. -->
        <ul role="group" aria-label=${this.label}>
          ${repeat(shown, o => o.value, o => html`
            <li class=${o.count || selected.has(o.value) ? '' : 'empty'}>
              <label title=${o.title || o.label}>
                <input type="checkbox" .checked=${selected.has(o.value)} @change=${e => this.#toggle(o.value, e)} />
                <span class="name">${o.icon ? html`${icon(o.icon)} ` : nothing}${o.label}</span>
                <span class="count">${o.count.toLocaleString('fr-FR')}</span>
              </label>
            </li>`)}
        </ul>
        ${!shown.length ? html`<div class="none">Aucune valeur</div>` : nothing}
        ${hidden > 0 ? html`<button class="link more" type="button" @click=${() => { this._expanded = true; }}>Voir plus (${hidden})</button>` : nothing}
        ${this._expanded && !filter && this.limit && options.length > this.limit ? html`<button class="link more" type="button" @click=${() => { this._expanded = false; }}>Voir moins</button>` : nothing}
      </div>` : nothing}
    `;
  }
}

customElements.define('gf-facet', GfFacet);
