// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { config } from '../config.js';
import { href } from '../core/router.js';
import * as sources from '../core/sources.js';

/** One result row. Resolves a remote thumbnail when the dataset has none. */
export class GfPlantCard extends LitElement {
  static properties = {
    plant: { attribute: false },
    _thumb: { state: true }
  };

  static styles = css`
    :host { display: block; }
    a {
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
    .sci { font-family: var(--gf-font-serif); font-style: italic; }
    .sci .author { font-style: normal; color: var(--gf-text-muted); font-size: 0.85em; }
    .meta { font-size: 0.8rem; color: var(--gf-text-muted); }
  `;

  constructor() {
    super();
    /** @type {any} */
    this.plant = null;
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
    if (this.plant && !this._thumb && this.isConnected) this.#schedule();
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.plant && this._thumb === undefined) this.#schedule();
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

    return html`
      <a href=${href.plant(p.id)}>
        ${thumb?.url
          ? html`<img class="thumb" src=${thumb.url} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
          : html`<span class="thumb" aria-hidden="true">${thumb === undefined ? '' : '🌿'}</span>`}
        <span class="text">
          <div class="name">${p.vernacularName || p.scientificName}</div>
          <div class="sci">${p.scientificName} <span class="author">${p.author || ''}</span></div>
          <div class="meta">${p.family}${p.match ? html` · ${p.match}` : nothing}</div>
        </span>
      </a>
    `;
  }
}

customElements.define('gf-plant-card', GfPlantCard);
