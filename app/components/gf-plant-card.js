// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { config, STATUS_LABELS, STATUS_SHORT } from '../config.js';
import { highlight } from '../core/highlight.js';
import { rememberSearch } from '../core/query.js';
import { href } from '../core/router.js';
import * as sources from '../core/sources.js';
import { toggleFavorite } from '../core/collections.js';
import { gridViewOf, StoreController } from '../core/store.js';
import { icon } from '../core/icons.js';
import { hideImg, showImg } from '../core/img.js';

/** One result row. Resolves a remote thumbnail when the dataset has none. */
export class GfPlantCard extends LitElement {
  static properties = {
    plant: { attribute: false },
    query: {},
    compact: { type: Boolean, reflect: true },
    grid: { type: Boolean, reflect: true },
    current: { type: Boolean, reflect: true },
    /** Grid: visible column keys, in order (gf-plant-list). */
    columns: { attribute: false },
    /** Grid view: epure (big photos), standard, scientific. */
    view: { reflect: true },
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
    a.row {
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
    a.row:hover, a.row:focus-visible { background: var(--gf-surface-2); outline: none; }
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
    :host([compact]) a.row { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) auto; padding: 0 12px; }
    :host([compact]) .text { display: contents; }
    :host([compact]) .meta { text-align: right; }
    :host([compact]) .thumb { display: none; }

    /* Grid row: same columns as the header of gf-plant-list (--gf-cols). */
    :host([grid]) {
      display: grid;
      grid-template-columns: var(--gf-cols);
      align-items: center;
      column-gap: 12px;
      padding: 0 8px 0 12px;
      border-bottom: 1px solid var(--gf-border);
    }
    :host([grid]) a.row { display: contents; }
    :host([grid]:hover), :host([grid]:focus-within) { background: var(--gf-surface-2); }
    :host([grid]) .fav { position: static; transform: none; justify-self: center; }
    :host([grid]) .thumb { width: 40px; height: 40px; font-size: 1.1rem; }
    :host([grid]) .cell { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.9rem; }
    :host([grid]) .cell.sci { font-family: var(--gf-font-serif); font-style: italic; }
    :host([grid]) .author { font-family: var(--gf-font); font-style: normal; font-size: 0.78rem; color: var(--gf-text-muted); }
    :host([grid]) .pin {
      justify-self: center;
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      text-decoration: none;
      font-size: 1.15rem;
      filter: grayscale(1);
      opacity: 0.45;
    }
    :host([grid]) .pin:hover, :host([grid]) .pin:focus-visible { opacity: 1; filter: none; background: var(--gf-surface-2); }
    :host([grid]) .pin.on { filter: none; opacity: 1; }
    /* Illustrated view: big photo, French name over the full scientific name. */
    :host([view='epure']) .thumb { width: 96px; height: 96px; font-size: 2rem; border-radius: var(--gf-radius); }
    :host([view='epure']) .stack { display: grid; gap: 4px; white-space: normal; }
    :host([view='epure']) .stack .fr { font-size: 1.1rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    :host([view='epure']) .stack .full { font-family: var(--gf-font-serif); font-style: italic; color: var(--gf-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    :host([grid]) .muted { color: var(--gf-text-muted); }
    :host([grid]) [hidden] { display: none; }
    .legal { display: flex; gap: 4px; overflow: hidden; }
    .tag { flex: none; font-size: 0.72rem; font-weight: 600; padding: 1px 7px; border-radius: 999px; background: var(--gf-surface-2); color: var(--gf-text); }
    .tag.pn, .tag.pr { background: color-mix(in srgb, #dc2626 16%, var(--gf-surface)); color: color-mix(in srgb, #dc2626 70%, var(--gf-text)); }
    .tag.re { background: color-mix(in srgb, #f59e0b 22%, var(--gf-surface)); }
    :host([current]) a.row, :host([current][grid]) { background: var(--gf-accent-soft); box-shadow: inset 3px 0 0 var(--gf-accent); }
  `;

  #store = new StoreController(this);
  /** Photos en ligne used in the results' display mode (Réglages › Modules). */
  get #photos() { return this.#store.state.modules.photos[gridViewOf(this.#store.state)]; }

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
    /** @type {string[]} */
    this.columns = [];
    this.view = '';
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
    if (!this.#photos) return;
    this.#timer = setTimeout(() => {
      this.#abort = new AbortController();
      sources.thumbnail(plant, this.#abort.signal, gridViewOf(this.#store.state))
        .then(thumb => { if (this.plant === plant) this._thumb = thumb || null; })
        .catch(() => { if (this.plant === plant) this._thumb = null; });
    }, config.thumbnailDelay);
  }

  #cancel() {
    clearTimeout(this.#timer);
    this.#abort?.abort();
    this.#abort = null;
  }

  /** Grid row: one cell per visible column, in the order of the header. */
  #gridRow(p, thumb, q, title, fav) {
    const legal = p.legal || [];
    const placeId = this.#store.state.placed.get(p.id);
    const illustrated = this.view === 'epure';
    const cells = {
      photo: () => thumb?.url
        ? html`<img class="thumb" src=${thumb.url} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error=${hideImg} @load=${showImg} />`
        : html`<span class="thumb" aria-hidden="true">${thumb === undefined ? '' : icon('flower1')}</span>`,
      fr: () => illustrated
        ? html`<span class="cell name stack">
            <span class="fr">${p.vernacularName ? highlight(p.vernacularName, q) : html`<span class="muted">Sans nom français</span>`}</span>
            <span class="full">${highlight(p.scientificName, q)} <span class="author">${p.author || ''}</span></span>
          </span>`
        : html`<span class="cell name">${p.vernacularName ? highlight(p.vernacularName, q) : html`<span class="muted">—</span>`}</span>`,
      family: () => html`<span class="cell">${p.family}</span>`,
      genus: () => html`<span class="cell"><i>${p.genus || ''}</i></span>`,
      species: () => html`<span class="cell sci" title=${p.scientificName + (p.author ? ' ' + p.author : '')}>${highlight(p.species || p.scientificName, q)}${p.fuzzy ? html` <span class="fuzzy">≈</span>` : nothing}${this.view === 'scientific' && p.author ? html` <span class="author">${p.author}</span>` : nothing}</span>`,
      status: () => html`<span class="cell muted" title=${STATUS_LABELS[p.status] || ''}>${STATUS_SHORT[p.status] || '—'}</span>`,
      legal: () => html`<span class="cell legal">
        ${legal.includes('nationale') ? html`<span class="tag pn" title="Protégée en France (protection nationale)">Protégée FR</span>`
          : legal.includes('protegee') ? html`<span class="tag pr" title="Protégée dans une région ou un département">Protégée</span>` : nothing}
        ${legal.includes('reglementee') ? html`<span class="tag re" title="Cueillette réglementée quelque part">Réglementée</span>` : nothing}
        ${legal.includes('menacee') ? html`<span class="tag" title="Menacée en France (Liste rouge nationale)">Menacée</span>` : nothing}
      </span>`
    };
    const keys = this.columns.filter(k => k in cells);
    return html`
      <a class="row" href=${href.plant(p.id)} @click=${() => rememberSearch(q)}>${keys.map(k => cells[k]())}</a>
      ${this.columns.includes('fav') ? html`<button class="fav" type="button" aria-pressed=${fav ? 'true' : 'false'}
        aria-label=${(fav ? 'Retirer des favoris : ' : 'Ajouter aux favoris : ') + title}
        title=${fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}
        @click=${this.#toggleFavorite}>${icon(fav ? 'heart-fill' : 'heart')}</button>` : nothing}
      ${this.columns.includes('pin') ? html`<a class="pin ${placeId ? 'on' : ''}"
        href=${placeId ? href.map({ spot: placeId, focus: p.id }) : href.newSpot(p.id)}
        title=${placeId ? 'Notée dans un de mes lieux : voir sur la carte' : 'Noter où je la trouve'}
        aria-label=${(placeId ? 'Voir sur la carte : ' : 'Noter où je la trouve : ') + title}>${icon('geo-alt-fill')}</a>` : nothing}`;
  }

  render() {
    const p = this.plant;
    if (!p) return nothing;
    // Photos en ligne switched off (Réglages › Modules): 🌿 instead of any remote image.
    const thumb = this.#photos ? this._thumb : null;
    if (this.grid) {
      return this.#gridRow(p, thumb, this.query, p.vernacularName || p.scientificName, this.#store.state.favorites.has(p.id));
    }

    const q = this.query;
    const title = p.vernacularName || p.scientificName;
    const fav = this.#store.state.favorites.has(p.id);

    return html`
      <a class="row" href=${href.plant(p.id)} @click=${() => rememberSearch(q)}>
        ${this.compact ? nothing : thumb?.url
          ? html`<img class="thumb" src=${thumb.url} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error=${hideImg} @load=${showImg} />`
          : html`<span class="thumb" aria-hidden="true">${thumb === undefined ? '' : icon('flower1')}</span>`}
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
        @click=${this.#toggleFavorite}>${icon(fav ? 'heart-fill' : 'heart')}</button>
    `;
  }
}

customElements.define('gf-plant-card', GfPlantCard);
