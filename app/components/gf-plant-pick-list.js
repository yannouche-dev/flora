// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { config } from '../config.js';
import { searchPlants } from '../core/search.js';
import { ui } from '../styles/ui.js';
import './gf-thumb.js';

/** Rows added by « Afficher plus ». */
const PAGE = 30;

/**
 * Plants matching `query`, for picking one (« Ajouter une plante », « Noter ici »): the same engine, matches and
 * order as the Flore search, all of them (« Afficher plus »), with their count.
 * `taken`: plants already there (shown, not pickable), `takenLabel` says where. Event: plant-pick {plant}.
 */
export class GfPlantPickList extends LitElement {
  static properties = {
    query: {},
    taken: { attribute: false },
    takenLabel: { attribute: 'taken-label' },
    disabled: { type: Boolean },
    _total: { state: true },
    _items: { state: true },
    _limit: { state: true }
  };

  static styles = [ui, css`
    :host { display: block; }
    .count { font-size: 0.8rem; color: var(--gf-text-muted); margin: 6px 2px; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
    li button {
      width: 100%;
      justify-content: flex-start;
      text-align: left;
      font-size: 1rem;
      font-weight: 400;
      padding: 6px 12px 6px 6px;
      gap: 10px;
      border-radius: var(--gf-radius);
    }
    li button span { min-width: 0; }
    i { color: var(--gf-text-muted); font-family: var(--gf-font-serif); }
    small { color: var(--gf-text-muted); }
    .more { margin-top: 8px; }
    .none { color: var(--gf-text-muted); font-size: 0.9rem; margin: 8px 2px; }
  `];

  constructor() {
    super();
    this.query = '';
    /** @type {Set<number>} */
    this.taken = new Set();
    this.takenLabel = 'déjà ajoutée';
    this.disabled = false;
    /** @type {number | null} null: no search (fewer than 2 characters) */
    this._total = null;
    /** @type {any[]} */
    this._items = [];
    this._limit = PAGE;
  }

  #run = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ #timer;

  /** @param {Map<string, unknown>} changed */
  willUpdate(changed) {
    if (changed.has('query')) {
      this._limit = PAGE;
      clearTimeout(this.#timer);
      if ((this.query || '').trim().length < 2) {
        ++this.#run;
        this._total = null;
        this._items = [];
      } else {
        this.#timer = setTimeout(() => this.#search(), config.searchDebounce);
      }
    }
  }

  /** Only the latest answer is shown (a slow, older keystroke never replaces it). */
  async #search() {
    const run = ++this.#run;
    const q = this.query;
    try {
      const { total, items } = await searchPlants(q, { limit: this._limit });
      if (run !== this.#run) return;
      this._total = total;
      this._items = items;
    } catch (error) {
      console.error(error);
    }
  }

  #more() {
    this._limit += PAGE;
    this.#search();
  }

  render() {
    if (this._total === null) return nothing;
    if (!this._total) return html`<p class="none">Aucune plante ne correspond.</p>`;
    const rest = this._total - this._items.length;
    return html`
      <p class="count" role="status">${this._total.toLocaleString('fr-FR')} plante${this._total > 1 ? 's' : ''}</p>
      <ul>${this._items.map(r => {
        const taken = this.taken.has(r.id);
        return html`<li><button type="button" ?disabled=${this.disabled || taken}
          @click=${() => this.dispatchEvent(new CustomEvent('plant-pick', { detail: { plant: r } }))}>
          <gf-thumb .plant=${r} size="40"></gf-thumb>
          <span>${r.vernacularName || r.scientificName} <i>${r.scientificName}</i>${taken ? html` <small>· ${this.takenLabel}</small>` : nothing}</span>
        </button></li>`;
      })}</ul>
      ${rest > 0 ? html`<button class="more" type="button" @click=${this.#more}>Afficher plus (${rest.toLocaleString('fr-FR')} restante${rest > 1 ? 's' : ''})</button>` : nothing}`;
  }
}

customElements.define('gf-plant-pick-list', GfPlantPickList);
