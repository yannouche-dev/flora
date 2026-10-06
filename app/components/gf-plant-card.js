// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { config } from '../config.js';
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
    if (this.plant && !this._thumb && this.isConnected && !this.compact) this.#schedule();
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.plant && this._thumb === undefined && !this.compact) this.#schedule();
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

  render() {
    const p = this.plant;
    if (!p) return nothing;
    const thumb = this._thumb;

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
