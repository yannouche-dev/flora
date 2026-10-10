// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { SORTS } from '../config.js';
import { activeFilterCount, applySuggestion, setQuery, toHash } from '../core/query.js';
import { share } from '../core/share.js';
import { gridViewOf, setCompact, setGridView, StoreController } from '../core/store.js';
import './gf-mode-switch.js';
import './gf-active-filters.js';
import './gf-plant-search.js';
import { ui } from '../styles/ui.js';
import { icon } from '../core/icons.js';
import { href } from '../core/router.js';

/**
 * Above the list: filters button (mobile), result count, sort, density, active filter chips,
 * family/genus suggestions and the "approximate results" note.
 * Fires `open-filters` when the mobile filter button is pressed.
 */
const COLUMN_LABELS = { fr: 'Nom français', sci: 'Nom scientifique', family: 'Famille', genus: 'Genre', status: 'Statut', legal: 'Protection', photo: 'Photo' };
/** Sort chosen in the grid (e.g. "-family") shown in the card view's menu. @param {string} sort */
const columnSortLabel = sort => (COLUMN_LABELS[sort.replace(/^-/, '')] || sort) + (sort.startsWith('-') ? ' (inverse)' : '');

export class GfResultsBar extends LitElement {
  static properties = {
    wide: { type: Boolean },
    /** The list is a grid whose column headers sort: no sort menu or density toggle then. */
    grid: { type: Boolean },
    _copied: { state: true }
  };

  static styles = [ui, css`
    :host {
      display: grid;
      gap: 8px;
      padding: 10px 16px;
      background: var(--gf-bg);
      border-bottom: 1px solid var(--gf-border);
      font-size: 0.875rem;
    }
    .row { display: flex; align-items: center; gap: 8px; }
    /* Icon-only toggles and actions of the row (compact, share): round, same height as the other controls. */
    .tool { flex: none; width: 34px; height: 34px; min-height: 0; padding: 0; display: inline-grid; place-items: center; font-size: 1rem; }
    .search { display: flex; gap: 8px; align-items: center; }
    .search gf-plant-search { flex: 1; min-width: 0; }
    .search .filters { min-height: 40px; }
    .count { font-weight: 600; margin-right: auto; white-space: nowrap; }
    button, select { min-height: 32px; padding: 4px 12px; font-size: 0.85rem; }
    /* One line on phones too: the sort menu gives way rather than pushing the icons below. */
    select { padding-right: 28px; border-radius: var(--gf-radius-pill); min-width: 0; flex: 0 1 auto; }
    .filters { font-weight: 600; }
    .filters .badge { background: var(--gf-accent); color: var(--gf-accent-contrast); font-size: 0.7rem; padding: 0 7px; }
    .suggestions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; color: var(--gf-text-muted); }
    .suggestions button { border-style: dashed; }
    .suggestions small { color: var(--gf-text-muted); }
    .note { color: var(--gf-warn); }
  `];

  #store = new StoreController(this);

  /** Shares the current search: text, filters (families, statuses…) and sort are all in the URL. */
  async #share() {
    const { query, results } = this.#store.state;
    const families = query.filters.family;
    const title = families.length === 1 && !query.q
      ? `${families[0]} — GeoFlora`
      : query.q ? `« ${query.q} » — GeoFlora` : 'Recherche GeoFlora';
    const result = await share({ title, text: `${results.total.toLocaleString('fr-FR')} espèces`, url: toHash(query) });
    if (result === 'copied') {
      this._copied = true;
      setTimeout(() => { this._copied = false; }, 2000);
    }
  }

  constructor() {
    super();
    this.wide = true;
    this.grid = false;
    this._copied = false;
  }

  /** @param {import('../core/store.js').Suggestion} suggestion */
  #applySuggestion(suggestion) {
    applySuggestion(suggestion.type, suggestion.name);
  }

  render() {
    const { query, results, compact, status, gridView } = this.#store.state;
    const view = gridViewOf(this.#store.state);
    const active = activeFilterCount(query);
    const sorts = SORTS.filter(s => s.value !== 'relevance' || query.q);

    return html`
      <div class="search">
        ${this.wide ? nothing : html`
          <button class="filters icon-btn" type="button" aria-label=${active ? `Filtres (${active} actif${active > 1 ? 's' : ''})` : 'Filtres'} title="Filtres"
            @click=${() => this.dispatchEvent(new CustomEvent('open-filters', { bubbles: true, composed: true }))}>
            ${icon(active ? 'funnel-fill' : 'funnel')}${active ? html`<span class="badge">${active}</span>` : nothing}
          </button>`}
        <gf-plant-search></gf-plant-search>
      </div>
      <div class="row">
        <span class="count" aria-live="polite">
          ${status === 'ready' ? html`${results.total.toLocaleString('fr-FR')} espèce${results.total > 1 ? 's' : ''}` : nothing}
        </span>
        ${this.grid ? html`
          ${results.sort === 'relevance' || !query.q ? nothing : html`<button type="button" title="Trier par pertinence" @click=${() => setQuery({ sort: '' })}>Pertinence</button>`}
          <gf-mode-switch class="views" scope="la grille" value=${view} ?overridden=${gridView !== null}
            @mode-change=${e => setGridView(e.detail.mode)}></gf-mode-switch>` : html`
          <select aria-label="Trier par" .value=${results.sort}
            @change=${e => setQuery({ sort: e.target.value })}>
            ${sorts.map(s => html`<option value=${s.value} ?selected=${s.value === results.sort}>${s.label}</option>`)}
            ${sorts.some(s => s.value === results.sort) ? nothing : html`<option value=${results.sort} selected>${columnSortLabel(results.sort)}</option>`}
          </select>
          <button class="tool" type="button" aria-pressed=${compact ? 'true' : 'false'}
            title="Affichage compact (sans vignettes)" aria-label="Affichage compact (sans vignettes)"
            @click=${() => setCompact(!compact)}>${icon('arrows-collapse')}</button>`}
        ${this.#store.state.placed.size ? html`<a class="tool button" href=${href.map({ flore: true })} title="Sur la Carte : mes lieux qui ont une plante de ces résultats"
          aria-label="Sur la Carte : mes lieux qui ont une plante de ces résultats">${icon('map')}</a>` : nothing}
        <button class="tool" type="button" title=${this._copied ? 'Lien copié' : 'Partager cette recherche (filtres compris)'}
          aria-label=${this._copied ? 'Lien copié' : 'Partager cette recherche (filtres compris)'} @click=${this.#share}>${icon(this._copied ? 'check-lg' : 'share')}</button>
      </div>

      <gf-active-filters></gf-active-filters>

      ${results.suggestions.length ? html`
        <div class="suggestions">
          Filtrer par :
          ${results.suggestions.map(s => html`
            <button type="button" @click=${() => this.#applySuggestion(s)}>
              ${s.type === 'genus' ? html`<i>${s.name}</i>` : s.name}
              <small>· ${s.type === 'family' ? 'famille' : 'genre'} · ${s.count}</small>
            </button>`)}
        </div>` : nothing}

      ${results.fuzzy ? html`
        <div class="note">
          ${results.total > results.fuzzy
            ? html`Résultats approchants inclus pour « ${query.q} ».`
            : html`Aucun résultat exact pour « ${query.q} » : résultats approchants.`}
        </div>` : nothing}
    `;
  }
}

customElements.define('gf-results-bar', GfResultsBar);
