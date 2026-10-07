// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { config, STATUS_LABELS, STATUS_SHORT } from '../config.js';
import { highlight } from '../core/highlight.js';
import { rememberSearch } from '../core/query.js';
import { href } from '../core/router.js';
import * as sources from '../core/sources.js';
import { toggleFavorite } from '../core/collections.js';
import { StoreController } from '../core/store.js';

/** One result row. Resolves a remote thumbnail when the dataset has none. */
export class GfPlantCard extends LitElement {
  static properties = {
    plant: { attribute: false },
    query: {},
    compact: { type: Boolean, reflect: true },
    grid: { type: Boolean, reflect: true },
    current: { type: Boolean, reflect: true },
    hide: { attribute: false },
    _thumb: { state: true }
  };

  static styles = css`
    :host { display: block; }
    :host { position: relative; }
    .fav {
      position: absolute;
      top: 50%;
      right: 4px;
      transform: translateY(-50%);
      width: 44px;
      height: 44px;
      border: 0;
      background: none;
      font-size: 1.3rem;
      line-height: 1;
      color: var(--gf-text-muted);
      cursor: pointer;
      border-radius: 50%;
    }
    .fav[aria-pressed='true'] { color: #e11d48; }
    .fav:focus-visible { outline: 2px solid var(--gf-accent); }
    a {
      padding-right: 48px !important;
      display: grid;
      grid-template-columns: 60px 1fr;
      gap: var(--gf-gap);
      align-items: center;
      height: 100%;
      padding: 6px 12px;
      color: inherit;
      text-decoration: none;
      border-bottom: 1px solid var(--gf-border);
    }
    a:hover, a:focus-visible { background: var(--gf-surface-2); outline: none; }
    .thumb {
      width: 60px;
      height: 60px;
      border-radius: 8px;
      background: var(--gf-surface-2);
      object-fit: cover;
      display: grid;
      place-items: center;
      color: var(--gf-text-muted);
      font-size: 1.5rem;
    }
    .text { min-width: 0; }
    .name, .sci, .meta {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .name { font-weight: 600; }
    .name.latin { font-family: var(--gf-font-serif); font-style: italic; }
    .sci { font-family: var(--gf-font-serif); font-style: italic; }
    .sci .author { font-style: normal; color: var(--gf-text-muted); font-size: 0.85em; }
    .meta { font-size: 0.8rem; color: var(--gf-text-muted); }
    .fuzzy { color: var(--gf-warn); }
    mark { background: var(--gf-accent-soft); color: inherit; border-radius: 2px; padding: 0 1px; }

    /* Compact: one dense line, no thumbnail. */
    :host([compact]) a { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) auto; padding: 0 12px; }
    :host([compact]) .text { display: contents; }
    :host([compact]) .meta { text-align: right; }
    :host([compact]) .thumb { display: none; }

    /* Grid row: same columns as the header of gf-plant-list (--gf-cols). */
    :host([grid]) {
      display: grid;
      grid-template-columns: var(--gf-cols);
      align-items: center;
      column-gap: 12px;
      padding-left: 12px;
      border-bottom: 1px solid var(--gf-border);
    }
    :host([grid]) a { display: contents; }
    :host([grid]:hover), :host([grid]:focus-within) { background: var(--gf-surface-2); }
    :host([grid]) .fav { position: static; transform: none; justify-self: center; }
    :host([grid]) .thumb { width: 40px; height: 40px; font-size: 1.1rem; }
    :host([grid]) .cell { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.9rem; }
    :host([grid]) .cell.sci { font-family: var(--gf-font-serif); font-style: italic; }
    :host([grid]) .muted { color: var(--gf-text-muted); }
    :host([grid]) [hidden] { display: none; }
    .legal { display: flex; gap: 4px; overflow: hidden; }
    .tag { flex: none; font-size: 0.72rem; font-weight: 600; padding: 1px 7px; border-radius: 999px; background: var(--gf-surface-2); color: var(--gf-text); }
    .tag.pn, .tag.pr { background: color-mix(in srgb, #dc2626 16%, var(--gf-surface)); color: color-mix(in srgb, #dc2626 70%, var(--gf-text)); }
    .tag.re { background: color-mix(in srgb, #f59e0b 22%, var(--gf-surface)); }
    :host([current]) a, :host([current][grid]) { background: var(--gf-accent-soft); box-shadow: inset 3px 0 0 var(--gf-accent); }
  `;

  #store = new StoreController(this);

  /** @param {Event} event */
  async #toggleFavorite(event) {
    event.preventDefault();
    event.stopPropagation();
    try { await toggleFavorite(this.plant); } catch (error) { console.error(error); }
  }

  constructor() {
    super();
    /** @type {any} */
    this.plant = null;
    this.query = '';
    this.compact = false;
    /** Row of the results grid (columns mirroring the filters) instead of a card. */
    this.grid = false;
    /** The plant shown in the plant pane. */
    this.current = false;
    /** Grid columns hidden by the list (narrow results pane). @type {Set<string>} */
    this.hide = new Set();
    /** @type {any} */
    this._thumb = undefined;
  }

  /** @type {AbortController | null} */
  #abort = null;
  /** @type {number | undefined} */
  #timer;

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (!changed.has('plant')) return;
    this.#cancel();
    this._thumb = this.plant?.thumbnail?.url ? this.plant.thumbnail : undefined;
    if (this.plant && !this._thumb && this.isConnected && (!this.compact || this.grid)) this.#schedule();
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.plant && this._thumb === undefined && (!this.compact || this.grid)) this.#schedule();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#cancel();
  }

  // Wait a little so fast scrolling doesn't fire hundreds of API calls.
  #schedule() {
    const plant = this.plant;
    this.#timer = setTimeout(() => {
      this.#abort = new AbortController();
      sources.thumbnail(plant, this.#abort.signal)
        .then(thumb => { if (this.plant === plant) this._thumb = thumb || null; })
        .catch(() => { if (this.plant === plant) this._thumb = null; });
    }, config.thumbnailDelay);
  }

  #cancel() {
    clearTimeout(this.#timer);
    this.#abort?.abort();
    this.#abort = null;
  }

  /** Grid row: the plant's values in the columns that mirror the filters. @param {Set<string>} hide */
  #gridRow(p, thumb, q, title, fav, hide) {
    const legal = p.legal || [];
    const tags = [
      legal.includes('nationale') ? html`<span class="tag pn" title="Protégée en France (protection nationale)">Protégée FR</span>`
        : legal.includes('protegee') ? html`<span class="tag pr" title="Protégée dans une région ou un département">Protégée</span>` : nothing,
      legal.includes('reglementee') ? html`<span class="tag re" title="Cueillette réglementée quelque part">Réglementée</span>` : nothing,
      legal.includes('menacee') ? html`<span class="tag" title="Menacée en France (Liste rouge nationale)">Menacée</span>` : nothing
    ];
    return html`
      <a href=${href.plant(p.id)} @click=${() => rememberSearch(q)}>
        ${thumb?.url
          ? html`<img class="thumb" src=${thumb.url} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
          : html`<span class="thumb" aria-hidden="true">${thumb === undefined ? '' : '🌿'}</span>`}
        <span class="cell name">${p.vernacularName ? highlight(p.vernacularName, q) : html`<span class="muted">—</span>`}</span>
        <span class="cell sci">${highlight(p.scientificName, q)}${p.fuzzy ? html` <span class="fuzzy">≈</span>` : nothing}</span>
        <span class="cell" ?hidden=${hide.has('family')}>${p.family}</span>
        <span class="cell" ?hidden=${hide.has('genus')}><i>${p.genus || ''}</i></span>
        <span class="cell muted" ?hidden=${hide.has('status')} title=${STATUS_LABELS[p.status] || ''}>${STATUS_SHORT[p.status] || '—'}</span>
        <span class="cell legal" ?hidden=${hide.has('legal')}>${tags}</span>
      </a>
      <button class="fav" type="button" aria-pressed=${fav ? 'true' : 'false'}
        aria-label=${(fav ? 'Retirer des favoris : ' : 'Ajouter aux favoris : ') + title}
        @click=${this.#toggleFavorite}>${fav ? '♥' : '♡'}</button>`;
  }

  render() {
    const p = this.plant;
    if (!p) return nothing;
    const thumb = this._thumb;
    if (this.grid) {
      return this.#gridRow(p, thumb, this.query, p.vernacularName || p.scientificName, this.#store.state.favorites.has(p.id), this.hide);
    }

    const q = this.query;
    const title = p.vernacularName || p.scientificName;
    const fav = this.#store.state.favorites.has(p.id);

    return html`
      <a href=${href.plant(p.id)} @click=${() => rememberSearch(q)}>
        ${this.compact ? nothing : thumb?.url
          ? html`<img class="thumb" src=${thumb.url} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
          : html`<span class="thumb" aria-hidden="true">${thumb === undefined ? '' : '🌿'}</span>`}
        <span class="text">
          <div class="name ${p.vernacularName ? '' : 'latin'}">${highlight(title, q)}</div>
          <div class="sci">${p.vernacularName ? highlight(p.scientificName, q) : nothing} <span class="author">${this.compact ? '' : p.author || ''}</span></div>
          <div class="meta">
            ${p.family}${p.match ? html` · ${p.match === 'syn.' ? 'synonyme' : highlight(p.match, q)}` : nothing}${p.fuzzy ? html` · <span class="fuzzy">approchant</span>` : nothing}
          </div>
        </span>
      </a>
      <button class="fav" type="button" aria-pressed=${fav ? 'true' : 'false'}
        aria-label=${(fav ? 'Retirer des favoris : ' : 'Ajouter aux favoris : ') + title}
        @click=${this.#toggleFavorite}>${fav ? '♥' : '♡'}</button>
    `;
  }
}

customElements.define('gf-plant-card', GfPlantCard);
