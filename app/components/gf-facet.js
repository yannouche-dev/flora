// @ts-check
import { LitElement, html, css, nothing, repeat } from 'lit';
import { ui } from '../styles/ui.js';

/**
 * @typedef {{ value: string, label: string, count: number, title?: string }} FacetOption
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
    open: { type: Boolean, reflect: true },
    _filter: { state: true },
    _expanded: { state: true }
  };

  static styles = [ui, css`
    :host { display: block; border-bottom: 1px solid var(--gf-border); }
    :host(.flash) { animation: flash 1.2s ease-out; }
    @keyframes flash { from { background: var(--gf-accent-soft); } }
    details { padding: 10px 0; }
    /* The header stays at the top of the filters while its list scrolls: it can be folded from anywhere. */
    summary {
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--gf-surface);
      min-height: 32px;
      box-shadow: 0 6px 6px -6px rgb(0 0 0 / 18%);
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      list-style: none;
      font-weight: 600;
      font-size: 0.9rem;
      padding: 2px 0;
    }
    summary::-webkit-details-marker { display: none; }
    summary::after {
      content: '';
      margin-left: auto;
      width: 8px;
      height: 8px;
      border-right: 2px solid var(--gf-text-muted);
      border-bottom: 2px solid var(--gf-text-muted);
      transform: rotate(45deg);
      transition: transform 0.15s;
    }
    details[open] summary::after { transform: rotate(-135deg); }
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
    this.open = true;
    this._filter = '';
    this._expanded = false;
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
    if (this.limit) options = options.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr'));
    const limit = this.limit && !this._expanded && !filter ? this.limit : Infinity;
    const shown = options.filter((o, i) => i < limit || selected.has(o.value));
    const hidden = options.length - shown.length;

    return html`
      <details ?open=${this.open} @toggle=${e => { this.open = e.target.open; }}>
        <summary>
          ${this.label}
          ${selected.size ? html`<span class="badge">${selected.size}</span>
            <button class="link clear" type="button" @click=${e => { e.preventDefault(); this.#emit([]); }}>effacer</button>` : nothing}
        </summary>
        ${this.searchable ? html`
          <input type="search" placeholder="Filtrer ${this.label.toLowerCase()}…" aria-label="Filtrer ${this.label}"
            .value=${this._filter} @input=${e => { this._filter = e.target.value; }} />` : nothing}
        <!-- Keyed rows: selecting reorders the list, and a reused unkeyed checkbox kept its clicked state. -->
        <ul role="group" aria-label=${this.label}>
          ${repeat(shown, o => o.value, o => html`
            <li class=${o.count || selected.has(o.value) ? '' : 'empty'}>
              <label title=${o.title || o.label}>
                <input type="checkbox" .checked=${selected.has(o.value)} @change=${e => this.#toggle(o.value, e)} />
                <span class="name">${o.label}</span>
                <span class="count">${o.count.toLocaleString('fr-FR')}</span>
              </label>
            </li>`)}
        </ul>
        ${!shown.length ? html`<div class="none">Aucune valeur</div>` : nothing}
        ${hidden > 0 ? html`<button class="link more" type="button" @click=${() => { this._expanded = true; }}>Voir plus (${hidden})</button>` : nothing}
        ${this._expanded && !filter && this.limit && options.length > this.limit ? html`<button class="link more" type="button" @click=${() => { this._expanded = false; }}>Voir moins</button>` : nothing}
      </details>
    `;
  }
}

customElements.define('gf-facet', GfFacet);
