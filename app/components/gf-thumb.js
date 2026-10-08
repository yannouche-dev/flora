// @ts-check
import { LitElement, html, css } from 'lit';
import { knownThumb, thumbUrl } from '../core/thumb.js';
import { icon } from '../core/icons.js';

/**
 * Small plant photo for list rows (like the search results): a rounded square, 🌿 while loading or
 * when the plant has no photo. Give it `plant` (record or search result) or `plant-id`.
 * Attribute `round` makes it a circle; `size` in px (default 40).
 */
export class GfThumb extends LitElement {
  static properties = {
    plant: { attribute: false },
    plantId: { type: Number, attribute: 'plant-id' },
    size: { type: Number },
    round: { type: Boolean, reflect: true },
    _url: { state: true },
    _broken: { state: true }
  };

  static styles = css`
    :host {
      --size: 40px;
      display: inline-block;
      flex: none;
      width: var(--size);
      height: var(--size);
      border-radius: 8px;
      overflow: hidden;
      background: var(--gf-surface-2);
      vertical-align: middle;
    }
    :host([round]) { border-radius: 50%; }
    img { display: block; width: 100%; height: 100%; object-fit: cover; }
    span {
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
      color: var(--gf-text-muted);
      font-size: calc(var(--size) * 0.45);
      line-height: 1;
    }
  `;

  constructor() {
    super();
    /** @type {any} */
    this.plant = null;
    this.plantId = 0;
    this.size = 40;
    this.round = false;
    /** @type {string | null | undefined} */
    this._url = undefined;
    this._broken = false;
  }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (changed.has('size')) this.style.setProperty('--size', this.size + 'px');
    if (!changed.has('plant') && !changed.has('plantId')) return;
    const id = this.plant?.id ?? this.plantId;
    this._broken = false;
    this._url = knownThumb(this.plant || { id });
    if (this._url === undefined && id) {
      thumbUrl(id, this.plant).then(url => {
        if ((this.plant?.id ?? this.plantId) === id) this._url = url;
      });
    }
  }

  render() {
    return this._url && !this._broken
      ? html`<img src=${this._url} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"
          @error=${() => { this._broken = true; }} />`
      : html`<span aria-hidden="true">${this._url === undefined ? '' : icon('flower1')}</span>`;
  }
}

customElements.define('gf-thumb', GfThumb);
