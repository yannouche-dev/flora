// @ts-check
import { LitElement, html, css } from 'lit';
import { STATUS_LABELS } from '../config.js';
import { store, StoreController } from '../core/store.js';
import { runSearch } from '../core/search.js';

const STATUS_CHIPS = [
  { label: 'Indigènes', codes: ['P', 'E', 'S'] },
  { label: 'Endémiques', codes: ['E', 'S'] },
  { label: 'Introduites', codes: ['I', 'J', 'N', 'C'] },
  { label: 'Envahissantes', codes: ['J'] }
];

const sameCodes = (/** @type {string[]} */ a, /** @type {string[]} */ b) =>
  a.length === b.length && a.every(code => b.includes(code));

export class GfFilters extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      font-size: 0.875rem;
    }
    select, button {
      font: inherit;
      color: var(--gf-text);
      background: var(--gf-surface);
      border: 1px solid var(--gf-border);
      border-radius: 999px;
      padding: 5px 12px;
      cursor: pointer;
    }
    select { max-width: 220px; }
    button[aria-pressed='true'] {
      background: var(--gf-accent);
      border-color: var(--gf-accent);
      color: var(--gf-accent-contrast);
    }
    .count {
      margin-left: auto;
      color: var(--gf-text-muted);
      white-space: nowrap;
    }
  `;

  #store = new StoreController(this);

  /** @param {Event} event */
  #onFamily(event) {
    store.set({ family: /** @type {HTMLSelectElement} */ (event.target).value });
    runSearch();
  }

  /** @param {string[]} codes */
  #toggleStatus(codes) {
    store.set({ statuses: sameCodes(store.state.statuses, codes) ? [] : codes });
    runSearch();
  }

  render() {
    const { families, family, statuses, results } = this.#store.state;
    return html`
      <select aria-label="Famille" .value=${family} @change=${this.#onFamily}>
        <option value="">Toutes les familles</option>
        ${families.map(f => html`<option value=${f.name} ?selected=${f.name === family}>${f.name} (${f.count})</option>`)}
      </select>
      ${STATUS_CHIPS.map(chip => html`
        <button
          type="button"
          title=${chip.codes.map(code => STATUS_LABELS[code]).join(', ')}
          aria-pressed=${sameCodes(statuses, chip.codes) ? 'true' : 'false'}
          @click=${() => this.#toggleStatus(chip.codes)}
        >${chip.label}</button>
      `)}
      <span class="count" aria-live="polite">${results.total.toLocaleString('fr-FR')} espèces</span>
    `;
  }
}

customElements.define('gf-filters', GfFilters);
