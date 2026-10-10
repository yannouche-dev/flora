// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import * as db from '../core/db.js';
import { clearContext, context, contextBarOn } from '../core/context.js';
import { activeFilterCount, fromHash } from '../core/query.js';
import { href } from '../core/router.js';
import { StoreController } from '../core/store.js';
import { icon, kindIcon } from '../core/icons.js';

/**
 * Under the header, on every page: where the user is elsewhere — the current plant, the current collection or
 * place, the Flore search — each a link back to it, with ✕ to forget it. What the page already shows is left out.
 */
export class GfContextBar extends LitElement {
  static properties = {
    route: { attribute: false },
    _names: { state: true }
  };

  static styles = css`
    :host { display: block; }
    :host([hidden]) { display: none; }
    nav {
      display: flex;
      gap: 6px;
      align-items: center;
      padding: 5px 12px;
      overflow-x: auto;
      scrollbar-width: none;
      background: var(--gf-surface-2);
      border-bottom: 1px solid var(--gf-border);
    }
    nav::-webkit-scrollbar { display: none; }
    .chip {
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: 2px;
      max-width: 60vw;
      border: 1px solid var(--gf-border);
      border-radius: var(--gf-radius-pill);
      background: var(--gf-surface);
      font-size: 0.8rem;
      line-height: 1;
    }
    .chip a {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
      padding: 5px 2px 5px 10px;
      color: var(--gf-text);
      text-decoration: none;
    }
    .chip a span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chip a .bi { flex: none; color: var(--gf-accent); }
    .chip button {
      flex: none;
      border: 0;
      background: none;
      padding: 5px 8px 5px 4px;
      min-height: 0;
      color: var(--gf-text-muted);
      cursor: pointer;
      font: inherit;
      display: inline-grid;
      place-items: center;
    }
    .chip a:focus-visible, .chip button:focus-visible { outline: none; box-shadow: var(--gf-focus); border-radius: var(--gf-radius-pill); }
  `;

  #store = new StoreController(this);

  constructor() {
    super();
    /** @type {any} */
    this.route = { name: 'search' };
    /** plant id → its name. @type {Map<number, string>} */
    this._names = new Map();
  }

  /** @param {number} id */
  async #name(id) {
    if (this._names.has(id)) return;
    this._names = new Map(this._names).set(id, '…');
    const plant = await db.get('plants', id).catch(() => null);
    // No longer in the flora: forgotten.
    if (!plant) { if (this.#store.state.status === 'ready') clearContext('plant'); return; }
    this._names = new Map(this._names).set(id, plant.vernacularNames?.[0] || plant.scientificName);
  }

  render() {
    const state = this.#store.state;
    const r = this.route;
    const c = context();
    /** @type {unknown[]} */
    const chips = [];
    this.#count = 0;
    if (!contextBarOn() || r.name === 'settings' || r.name === 'not-found') return nothing;

    // The plant: unless it is the one shown.
    const shownPlant = r.name === 'plant' ? r.id : r.name === 'collections' ? r.plant : r.name === 'map' ? (r.focus || r.plant) : null;
    if (c.plant && c.plant !== shownPlant) {
      this.#name(c.plant);
      chips.push(this.#chip(href.plant(c.plant), icon('leaf'), this._names.get(c.plant) || '…', 'la plante', () => clearContext('plant')));
    }

    // The collection or place: unless it is the one shown.
    const shownCollection = r.name === 'collections' ? r.open : r.name === 'map' ? r.spot : r.name === 'spot' ? r.id : null;
    if (c.collection && c.collection !== shownCollection) {
      const summary = state.collections.find((/** @type {any} */ x) => x.id === c.collection);
      if (!summary && state.status === 'ready' && state.collections.length) queueMicrotask(() => clearContext('collection'));
      else if (summary) chips.push(this.#chip(href.collections({ open: summary.id }), kindIcon(summary.kind), summary.name, 'la collection', () => clearContext('collection')));
    }

    // The Flore search: unless Flore's list is shown, or there is nothing searched.
    if (c.query && r.name !== 'search') {
      const q = fromHash(c.query);
      const filters = activeFilterCount(q);
      if (q.q || filters) {
        const label = [q.q ? `« ${q.q} »` : 'Recherche', filters ? `${filters} filtre${filters > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
        chips.push(this.#chip(c.query, icon('search'), label, 'la recherche', () => clearContext('query')));
      }
    }

    this.#count = chips.length;
    return chips.length ? html`<nav aria-label="Contexte : plante, collection et recherche en cours">${chips}</nav>` : nothing;
  }

  #count = 0;
  updated() { this.hidden = !this.#count; }

  /** @param {string} link @param {unknown} ico @param {string} label @param {string} what @param {() => void} clear */
  #chip(link, ico, label, what, clear) {
    return html`<span class="chip"><a href=${link} title=${label}>${ico}<span>${label}</span></a>
      <button type="button" aria-label=${'Oublier ' + what + ' « ' + label + ' »'} title="Oublier" @click=${clear}>${icon('x')}</button></span>`;
  }
}

customElements.define('gf-context-bar', GfContextBar);
