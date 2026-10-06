// @ts-check
import { LitElement, html, css } from 'lit';
import { config } from '../config.js';
import { store, StoreController } from '../core/store.js';
import { runSearch } from '../core/search.js';

export class GfSearchBar extends LitElement {
  static styles = css`
    :host { display: block; }
    input {
      width: 100%;
      font: inherit;
      font-size: 1rem;
      padding: 10px 14px;
      border-radius: 999px;
      border: 1px solid var(--gf-border);
      background: var(--gf-surface);
      color: var(--gf-text);
      outline: none;
    }
    input:focus-visible {
      border-color: var(--gf-accent);
      box-shadow: 0 0 0 3px var(--gf-accent-soft);
    }
  `;

  #store = new StoreController(this);
  /** @type {number | undefined} */
  #timer;

  /** @param {InputEvent} event */
  #onInput(event) {
    store.set({ query: /** @type {HTMLInputElement} */ (event.target).value });
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => runSearch(), config.searchDebounce);
  }

  render() {
    const { query, status } = this.#store.state;
    return html`
      <input
        type="search"
        enterkeyhint="search"
        autocomplete="off"
        spellcheck="false"
        placeholder="Nom français, scientifique, synonyme ou famille…"
        aria-label="Rechercher une plante"
        .value=${query}
        ?disabled=${status !== 'ready'}
        @input=${this.#onInput}
      />
    `;
  }
}

customElements.define('gf-search-bar', GfSearchBar);
