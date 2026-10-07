// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { STATUS_SHORT } from '../config.js';
import { FACETS, activeFilterCount, clearFilters, toggleValue } from '../core/query.js';
import { store, StoreController } from '../core/store.js';

const LABELS = {
  mine: (/** @type {string} */ v) => v === 'place' ? '📍 Dans un lieu'
    : v === 'favorites' ? '♥ Favoris'
    : store.state.collections.find(c => c.id === v)?.name || 'Collection',
  status: (/** @type {string} */ v) => STATUS_SHORT[v] || v,
  family: (/** @type {string} */ v) => v,
  genus: (/** @type {string} */ v) => html`<i>${v}</i>`,
  photo: (/** @type {string} */ v) => v === 'avec' ? 'Avec photo' : 'Sans photo',
  legal: (/** @type {string} */ v) => ({ nationale: 'Protégée en France', protegee: 'Protégée', reglementee: 'Cueillette réglementée', menacee: 'Menacée en France' })[v] || v,
  french: (/** @type {string} */ v) => v === 'avec' ? 'Avec nom français' : 'Sans nom français'
};

/** Removable chips for every active filter value + "Tout effacer". */
export class GfActiveFilters extends LitElement {
  static styles = css`
    :host { display: block; }
    :host([hidden]) { display: none; }
    ul {
      display: flex;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
      overflow-x: auto;
      scrollbar-width: none;
    }
    ul::-webkit-scrollbar { display: none; }
    li { flex: none; }
    button {
      font: inherit;
      font-size: 0.8rem;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border-radius: 999px;
      padding: 3px 6px 3px 10px;
      border: 1px solid var(--gf-accent);
      background: var(--gf-accent-soft);
      color: var(--gf-text);
      cursor: pointer;
      white-space: nowrap;
    }
    button .x { font-size: 1rem; line-height: 1; color: var(--gf-text-muted); }
    button.reset { border-color: transparent; background: none; color: var(--gf-accent); padding: 3px 6px; }
  `;

  #store = new StoreController(this);

  render() {
    const { query } = this.#store.state;
    const total = activeFilterCount(query);
    this.hidden = total === 0;
    if (!total) return nothing;

    return html`
      <ul aria-label="Filtres actifs">
        ${FACETS.flatMap(facet => query.filters[facet].map(value => html`
          <li>
            <button type="button" aria-label="Retirer le filtre ${value}" @click=${() => toggleValue(facet, value)}>
              ${LABELS[facet](value)} <span class="x" aria-hidden="true">×</span>
            </button>
          </li>`))}
        ${total > 1 ? html`<li><button class="reset" type="button" @click=${clearFilters}>Tout effacer</button></li>` : nothing}
      </ul>
    `;
  }
}

customElements.define('gf-active-filters', GfActiveFilters);
