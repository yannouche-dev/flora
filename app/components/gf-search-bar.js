// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { config } from '../config.js';
import { clearRecentSearches, recentSearches, rememberSearch, setQuery } from '../core/query.js';
import { StoreController } from '../core/store.js';

/** Search input with a recent-searches menu (shown when focused and empty). */
export class GfSearchBar extends LitElement {
  static properties = {
    _open: { state: true },
    _active: { state: true }
  };

  static styles = css`
    :host { display: block; position: relative; }
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
    [role='listbox'] {
      position: absolute;
      z-index: 10;
      top: calc(100% + 6px);
      left: 0;
      right: 0;
      margin: 0;
      padding: 6px;
      list-style: none;
      background: var(--gf-surface);
      border: 1px solid var(--gf-border);
      border-radius: var(--gf-radius);
      box-shadow: 0 8px 24px rgb(0 0 0 / 15%);
    }
    .title {
      display: flex;
      justify-content: space-between;
      font-size: 0.75rem;
      color: var(--gf-text-muted);
      padding: 4px 8px;
    }
    .title button { font: inherit; background: none; border: 0; color: var(--gf-accent); cursor: pointer; }
    [role='option'] { padding: 8px 10px; border-radius: 6px; cursor: pointer; }
    [role='option'][aria-selected='true'], [role='option']:hover { background: var(--gf-surface-2); }
  `;

  #store = new StoreController(this);

  constructor() {
    super();
    this._open = false;
    this._active = -1;
  }

  /** @param {InputEvent} event */
  #onInput(event) {
    const q = /** @type {HTMLInputElement} */ (event.target).value;
    setQuery({ q }, { debounce: config.searchDebounce });
    this._open = !q;
    this._active = -1;
  }

  /** @param {string} q */
  #pick(q) {
    setQuery({ q });
    rememberSearch(q);
    this._open = false;
  }

  /** @param {KeyboardEvent} event */
  #onKeyDown(event) {
    const items = this._open ? recentSearches() : [];
    if (event.key === 'ArrowDown' && items.length) {
      event.preventDefault();
      this._active = (this._active + 1) % items.length;
    } else if (event.key === 'ArrowUp' && items.length) {
      event.preventDefault();
      this._active = (this._active - 1 + items.length) % items.length;
    } else if (event.key === 'Enter') {
      if (this._active >= 0 && items[this._active]) this.#pick(items[this._active]);
      else rememberSearch(this.#store.state.query.q);
      this._open = false;
      /** @type {HTMLInputElement} */ (event.target).blur();
    } else if (event.key === 'Escape') {
      if (this._open) this._open = false;
      else if (this.#store.state.query.q) setQuery({ q: '' });
    }
  }

  render() {
    const { query: { q }, status } = this.#store.state;
    const recent = this._open && !q ? recentSearches() : [];

    return html`
      <input
        type="search"
        enterkeyhint="search"
        autocomplete="off"
        spellcheck="false"
        role="combobox"
        aria-expanded=${recent.length ? 'true' : 'false'}
        aria-controls="recent"
        aria-activedescendant=${this._active >= 0 ? 'recent-' + this._active : ''}
        placeholder="Nom français, scientifique (ger rob), synonyme, famille…"
        aria-label="Rechercher une plante"
        .value=${q}
        ?disabled=${status !== 'ready'}
        @input=${this.#onInput}
        @keydown=${this.#onKeyDown}
        @focus=${() => { this._open = true; }}
        @blur=${() => { setTimeout(() => { this._open = false; }, 150); }}
      />
      ${recent.length ? html`
        <ul id="recent" role="listbox" aria-label="Recherches récentes">
          <li class="title" role="presentation">
            Recherches récentes
            <button type="button" @mousedown=${e => { e.preventDefault(); clearRecentSearches(); this.requestUpdate(); }}>effacer</button>
          </li>
          ${recent.map((item, i) => html`
            <li id="recent-${i}" role="option" aria-selected=${i === this._active ? 'true' : 'false'}
              @mousedown=${e => { e.preventDefault(); this.#pick(item); }}>${item}</li>`)}
        </ul>` : nothing}
    `;
  }
}

customElements.define('gf-search-bar', GfSearchBar);
