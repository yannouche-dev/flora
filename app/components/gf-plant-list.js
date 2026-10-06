// @ts-check
import { LitElement, html, css, repeat } from 'lit';
import { StoreController } from '../core/store.js';
import './gf-plant-card.js';

const ROW_HEIGHT = 76;
const COMPACT_ROW_HEIGHT = 44;
const OVERSCAN = 6;

/** Scroll position survives navigating to a plant and back, until the results change. */
let saved = { items: /** @type {any[] | null} */ (null), scrollTop: 0 };

/** Virtualized result list: only the rows in (or near) the viewport are in the DOM. */
export class GfPlantList extends LitElement {
  static properties = {
    _scrollTop: { state: true },
    _height: { state: true }
  };

  static styles = css`
    :host {
      display: block;
      overflow-y: auto;
      overscroll-behavior: contain;
      contain: strict;
      background: var(--gf-surface);
    }
    .spacer { position: relative; }
    gf-plant-card {
      position: absolute;
      left: 0;
      right: 0;
    }
    .empty {
      padding: 32px 16px;
      text-align: center;
      color: var(--gf-text-muted);
    }
  `;

  #store = new StoreController(this);
  #resize = new ResizeObserver(([entry]) => { this._height = entry.contentRect.height; });
  /** @type {any[] | null} */
  #items = null;
  #frame = 0;

  constructor() {
    super();
    this._scrollTop = 0;
    this._height = 800;
    this.addEventListener('scroll', () => {
      cancelAnimationFrame(this.#frame);
      this.#frame = requestAnimationFrame(() => { this._scrollTop = this.scrollTop; });
    }, { passive: true });
  }

  connectedCallback() {
    super.connectedCallback();
    this.#resize.observe(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#resize.disconnect();
    // Once detached, the element reports scrollTop 0: keep the last position seen while scrolling.
    saved = { items: this.#items, scrollTop: this._scrollTop };
  }

  /** New results → back to the top; same results (coming back from a plant) → restore. */
  updated() {
    const items = this.#store.state.results.items;
    if (items === this.#items) return;
    this.#items = items;
    const top = saved.items === items ? saved.scrollTop : 0;
    this.scrollTop = top;
    this._scrollTop = top;
  }

  render() {
    const { results: { items }, query: { q }, compact, status } = this.#store.state;
    if (status === 'ready' && !items.length) {
      return html`<p class="empty">Aucune plante ne correspond à cette recherche.</p>`;
    }

    const rowHeight = compact ? COMPACT_ROW_HEIGHT : ROW_HEIGHT;
    const first = Math.max(0, Math.floor(this._scrollTop / rowHeight) - OVERSCAN);
    const last = Math.min(items.length, Math.ceil((this._scrollTop + this._height) / rowHeight) + OVERSCAN);
    const visible = items.slice(first, last);

    return html`
      <div class="spacer" role="list" style="height:${items.length * rowHeight}px">
        ${repeat(visible, plant => plant.id, (plant, i) => html`
          <gf-plant-card
            role="listitem"
            style="top:${(first + i) * rowHeight}px;height:${rowHeight}px"
            .plant=${plant}
            .query=${q}
            ?compact=${compact}
          ></gf-plant-card>
        `)}
      </div>
    `;
  }
}

customElements.define('gf-plant-list', GfPlantList);
