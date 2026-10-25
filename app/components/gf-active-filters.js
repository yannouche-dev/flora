// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { STATUS_SHORT } from '../config.js';
import { FACETS, activeFilterCount, clearFilters, toggleValue } from '../core/query.js';
import { store } from '../core/store.js';
import { SearchController } from '../core/search-channel.js';
import { ui } from '../styles/ui.js';
import { icon } from '../core/icons.js';

/** Each filter value's name, as words (the chip's, and what its button says it removes). */
const NAMES = {
  mine: (/** @type {string} */ v) => v === 'place' ? 'Dans un lieu' : v === 'favorites' ? 'Favoris'
    : store.state.collections.find(c => c.id === v)?.name || 'Liste',
  status: (/** @type {string} */ v) => STATUS_SHORT[v] || v,
  family: (/** @type {string} */ v) => v,
  genus: (/** @type {string} */ v) => v,
  photo: (/** @type {string} */ v) => v === 'avec' ? 'Avec photo' : 'Sans photo',
  legal: (/** @type {string} */ v) => ({ nationale: 'Protégée en France', protegee: 'Protégée', reglementee: 'Cueillette réglementée', menacee: 'Menacée en France' })[v] || v,
  french: (/** @type {string} */ v) => v === 'avec' ? 'Avec nom français' : 'Sans nom français'
};

/** The filter groups' names (gf-filter-panel), so a chip's button says which filter it removes. */
const GROUPS = { mine: 'Mes plantes', status: 'Statut', legal: 'Protection', family: 'Famille', genus: 'Genre', photo: 'Photo', french: 'Nom français' };

/** A chip's label: its name, a place's or the favourites' icon before it, a genus in italics. @param {import('../core/query.js').Facet} facet @param {string} v */
const label = (facet, v) => facet === 'genus' ? html`<i>${v}</i>`
  : facet === 'mine' && (v === 'place' || v === 'favorites') ? html`${icon(v === 'place' ? 'geo-alt-fill' : 'heart-fill')} ${NAMES.mine(v)}`
  : NAMES[facet](v);

/** Removable chips for every active filter value + "Tout effacer". */
export class GfActiveFilters extends LitElement {
  static styles = [ui, css`
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
    button { white-space: nowrap; padding-right: 8px; }
    /* In a narrow results bar (its container, gf-results-bar.js: a free layout's search cell), the chips wrap, every
       one in sight — a row scrolled sideways, its scrollbar hidden, would keep most of them (and « Tout effacer »)
       out of reach there; a long one is cut, never wider than the bar. */
    @container results-bar (max-width: 320px) {
      ul { flex-wrap: wrap; overflow-x: visible; }
      li { max-width: 100%; }
      button { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
    }
    button .x { font-size: 1rem; line-height: 1; color: var(--gf-text-muted); }
  `];

  static properties = {
    /** The search whose filters it shows (core/search-channel.js: a free layout's group); none: the app's. */
    channel: { attribute: false }
  };

  #store = new SearchController(this);

  constructor() {
    super();
    /** @type {import('../core/search-channel.js').Channel | null} */
    this.channel = null;
  }

  /**
   * A chip's ✕, or « Tout effacer »: its button goes with the filter. The focus it had to the chip now in its place,
   * else the one before; none left, to the list's count (the results bar's: `chips-gone`) — not to the page.
   * @param {Event} e @param {() => void} remove
   */
  async #remove(e, remove) {
    const button = e.currentTarget;
    const focused = /** @type {ShadowRoot} */ (this.renderRoot).activeElement === button;
    const at = [...this.renderRoot.querySelectorAll('button.chip')].indexOf(/** @type {Element} */ (button));
    remove();
    if (!focused) return;
    await this.updateComplete;
    const chips = [...this.renderRoot.querySelectorAll('button.chip')];
    const next = at < 0 ? null : /** @type {HTMLElement | undefined} */ (chips[Math.min(at, chips.length - 1)]);
    if (next) next.focus();
    else this.dispatchEvent(new CustomEvent('chips-gone'));
  }

  render() {
    const { query } = this.#store.state;
    const total = activeFilterCount(query);
    this.hidden = total === 0;
    if (!total) return nothing;

    return html`
      <ul aria-label="Filtres actifs">
        ${FACETS.flatMap(facet => query.filters[facet].map(value => html`
          <li>
            <button class="chip" aria-pressed="true" type="button" aria-label="Retirer le filtre ${GROUPS[facet]} : ${NAMES[facet](value)}"
              @click=${(/** @type {Event} */ e) => this.#remove(e, () => toggleValue(facet, value, this.#store.channel))}>
              ${label(facet, value)} <span class="x" aria-hidden="true">${icon('x')}</span>
            </button>
          </li>`))}
        ${total > 1 ? html`<li><button class="link" type="button" @click=${(/** @type {Event} */ e) => this.#remove(e, () => clearFilters(this.#store.channel))}>Tout effacer</button></li>` : nothing}
      </ul>
    `;
  }
}

customElements.define('gf-active-filters', GfActiveFilters);
