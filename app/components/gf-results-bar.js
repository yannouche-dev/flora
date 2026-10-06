// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { SORTS } from '../config.js';
import { activeFilterCount, setQuery } from '../core/query.js';
import { setCompact, store, StoreController } from '../core/store.js';
import './gf-active-filters.js';

/**
 * Above the list: filters button (mobile), result count, sort, density, active filter chips,
 * family/genus suggestions and the "approximate results" note.
 * Fires `open-filters` when the mobile filter button is pressed.
 */
export class GfResultsBar extends LitElement {
  static properties = {
    wide: { type: Boolean }
  };

  static styles = css`
    :host {
      display: grid;
      gap: 8px;
      padding: 10px 16px;
      background: var(--gf-bg);
      border-bottom: 1px solid var(--gf-border);
      font-size: 0.875rem;
    }
    .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .count { font-weight: 600; margin-right: auto; white-space: nowrap; }
    button, select {
      font: inherit;
      color: var(--gf-text);
      background: var(--gf-surface);
      border: 1px solid var(--gf-border);
      border-radius: 999px;
      padding: 5px 12px;
      cursor: pointer;
    }
    .filters { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
    .filters .badge {
      background: var(--gf-accent);
      color: var(--gf-accent-contrast);
      border-radius: 999px;
      font-size: 0.7rem;
      padding: 0 7px;
    }
    button[aria-pressed='true'] { background: var(--gf-accent-soft); border-color: var(--gf-accent); }
    .suggestions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; color: var(--gf-text-muted); }
    .suggestions button { border-style: dashed; color: var(--gf-text); }
    .suggestions small { color: var(--gf-text-muted); }
    .note { color: var(--gf-warn); }
  `;

  #store = new StoreController(this);

  constructor() {
    super();
    this.wide = true;
  }

  /** @param {import('../core/store.js').Suggestion} suggestion */
  #applySuggestion(suggestion) {
    const { filters } = store.state.query;
    setQuery({ q: '', filters: { ...filters, [suggestion.type]: [...filters[suggestion.type], suggestion.name] } });
  }

  render() {
    const { query, results, compact, status } = this.#store.state;
    const active = activeFilterCount(query);
    const sorts = SORTS.filter(s => s.value !== 'relevance' || query.q);

    return html`
      <div class="row">
        ${this.wide ? nothing : html`
          <button class="filters" type="button" @click=${() => this.dispatchEvent(new CustomEvent('open-filters', { bubbles: true, composed: true }))}>
            Filtres ${active ? html`<span class="badge">${active}</span>` : nothing}
          </button>`}
        <span class="count" aria-live="polite">
          ${status === 'ready' ? html`${results.total.toLocaleString('fr-FR')} espèce${results.total > 1 ? 's' : ''}` : nothing}
        </span>
        <select aria-label="Trier par" .value=${results.sort}
          @change=${e => setQuery({ sort: e.target.value })}>
          ${sorts.map(s => html`<option value=${s.value} ?selected=${s.value === results.sort}>${s.label}</option>`)}
        </select>
        <button type="button" aria-pressed=${compact ? 'true' : 'false'} title="Affichage compact (sans vignettes)"
          @click=${() => setCompact(!compact)}>Compact</button>
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
