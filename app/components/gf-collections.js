// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import * as db from '../core/db.js';
import { GeoController } from '../core/geo.js';
import { href } from '../core/router.js';
import {
  FAVORITES_ID, collectionTitle, distance, formatDistance, inSeason, listCollections, plantCount, soon, spotEvents
} from '../core/collections.js';
import { StoreController, whenReady } from '../core/store.js';

/** Up to this many thumbnails per collection row. */
const THUMBS = 4;

/** "Mes plantes": favorites, lists and places in one place. */
export class GfCollections extends LitElement {
  static properties = {
    _collections: { state: true },
    _thumbs: { state: true },
    _error: { state: true }
  };

  static styles = css`
    *, *::before, *::after { box-sizing: border-box; }
    :host { display: block; overflow-y: auto; }
    .wrap { max-width: 760px; margin: 0 auto; padding: 14px 16px 96px; }
    h1 { font-size: 1.35rem; margin: 4px 0 4px; }
    .lead { color: var(--gf-text-muted); margin: 0 0 14px; font-size: 0.9rem; }
    .new { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; }
    .new a {
      flex: 1 1 160px;
      text-align: center;
      font-weight: 600;
      padding: 11px 14px;
      border-radius: var(--gf-radius);
      border: 1px dashed var(--gf-accent);
      color: var(--gf-accent);
      text-decoration: none;
      background: var(--gf-surface);
    }
    h2 {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--gf-text-muted);
      margin: 18px 0 8px;
    }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    li a {
      display: grid;
      grid-template-columns: 40px 1fr auto;
      gap: 2px 12px;
      align-items: center;
      padding: 10px 12px;
      border-radius: var(--gf-radius);
      background: var(--gf-surface);
      border: 1px solid var(--gf-border);
      color: inherit;
      text-decoration: none;
    }
    li a:hover { border-color: var(--gf-accent); }
    .icon {
      grid-row: span 2;
      width: 40px;
      height: 40px;
      border-radius: 10px;
      display: grid;
      place-items: center;
      font-size: 1.2rem;
      background: var(--gf-accent-soft);
    }
    .icon.fav { color: #e11d48; background: color-mix(in srgb, #e11d48 14%, var(--gf-surface)); }
    .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .side { color: var(--gf-text-muted); font-size: 0.85rem; text-align: right; white-space: nowrap; }
    .sub { grid-column: 2 / -1; display: flex; align-items: center; gap: 8px; color: var(--gf-text-muted); font-size: 0.8rem; min-width: 0; }
    .thumbs { display: flex; }
    .thumbs img, .thumbs span {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      object-fit: cover;
      border: 2px solid var(--gf-surface);
      margin-left: -6px;
      background: var(--gf-surface-2);
    }
    .thumbs :first-child { margin-left: 0; }
    .badge.soon { background: var(--gf-accent-soft); color: var(--gf-text); }
    .badge { background: #fde047; color: #422006; border-radius: 999px; padding: 0 8px; font-size: 0.75rem; font-weight: 600; }
    .empty { color: var(--gf-text-muted); font-size: 0.9rem; }
    .error { color: var(--gf-danger); }
  `;

  #geo = new GeoController(this);
  #store = new StoreController(this);
  #onChange = () => this.#load();

  constructor() {
    super();
    /** @type {import('../core/collections.js').Collection[]} */
    this._collections = [];
    /** plantId → thumbnail url (from the dataset). @type {Map<number, string | null>} */
    this._thumbs = new Map();
    /** @type {string | null} */
    this._error = null;
  }

  connectedCallback() {
    super.connectedCallback();
    spotEvents.addEventListener('change', this.#onChange);
    document.title = 'Mes plantes — GeoFlora';
    this.#load();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    spotEvents.removeEventListener('change', this.#onChange);
  }

  async #load() {
    try {
      await whenReady();
      const all = await listCollections();
      this._collections = all;
      // Thumbnails of the first plants of each collection, from the local dataset.
      const ids = new Set(all.flatMap(c => c.properties.plantIds.slice(0, THUMBS)));
      const thumbs = new Map(this._thumbs);
      await Promise.all([...ids].filter(id => !thumbs.has(id)).map(async id => {
        const plant = await db.get('plants', id);
        thumbs.set(id, plant?.thumbnail?.url || null);
      }));
      this._thumbs = thumbs;
      this._error = null;
    } catch (error) {
      console.error(error);
      this._error = 'Collections illisibles pour le moment : ' + /** @type {Error} */ (error).message;
    }
  }

  /** @param {import('../core/collections.js').Collection} c @param {string | null} side */
  #row(c, side) {
    const p = c.properties;
    const icon = p.kind === 'favorites' ? '♥' : p.kind === 'place' ? '📍' : '☰';
    return html`
      <li>
        <a href=${href.spot(c.id)}>
          <span class="icon ${p.kind === 'favorites' ? 'fav' : ''}" aria-hidden="true">${icon}</span>
          <span class="name">${collectionTitle(c)}</span>
          <span class="side">${side || ''}</span>
          <span class="sub">
            <span class="thumbs" aria-hidden="true">
              ${p.plantIds.slice(0, THUMBS).map(id => this._thumbs.get(id)
                ? html`<img src=${/** @type {string} */ (this._thumbs.get(id))} alt="" loading="lazy" referrerpolicy="no-referrer" />`
                : html`<span></span>`)}
            </span>
            ${plantCount(p.plants.length)}
            ${p.kind !== 'place' || !this.#store.state.harvestMode ? nothing
              : inSeason(c) ? html`<span class="badge">En saison</span>`
              : soon(c) ? html`<span class="badge soon">Bientôt</span>` : nothing}
          </span>
        </a>
      </li>`;
  }

  render() {
    const all = this._collections;
    const favorites = all.find(c => c.id === FAVORITES_ID);
    const lists = all.filter(c => c.properties.kind === 'list')
      .sort((a, b) => b.properties.updatedAt.localeCompare(a.properties.updatedAt));
    const fix = this.#geo.state.fix;
    const places = all.filter(c => c.properties.kind === 'place' && c.geometry)
      .map(c => ({ c, d: fix && c.geometry ? distance(fix.coordinates, c.geometry.coordinates) : null }))
      .sort((a, b) => a.d !== null && b.d !== null ? a.d - b.d : b.c.properties.updatedAt.localeCompare(a.c.properties.updatedAt));

    return html`
      <div class="wrap">
        <h1>Mes plantes</h1>
        <p class="lead">Favoris, listes et lieux. Tout reste sur cet appareil ; partagez une collection par un simple lien.</p>
        <div class="new">
          <a href=${href.newList()}>☰ Nouvelle liste</a>
          <a href=${href.newSpot()} @click=${e => { e.preventDefault(); this.dispatchEvent(new CustomEvent('open-capture', { bubbles: true, composed: true })); }}>📍 Noter une plante ici</a>
        </div>
        ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}

        <ul>
          ${favorites ? this.#row(favorites, null) : html`
            <li><a href=${href.spot(FAVORITES_ID)}>
              <span class="icon fav" aria-hidden="true">♥</span><span class="name">Favoris</span><span class="side"></span>
              <span class="sub">Touchez ♡ sur une plante pour l’ajouter.</span>
            </a></li>`}
        </ul>

        <h2>Listes</h2>
        ${lists.length ? html`<ul>${lists.map(c => this.#row(c, null))}</ul>`
          : html`<p class="empty">Regroupez des plantes sans lieu : « Mellifères », « À chercher cet été »…</p>`}

        <h2>Lieux${fix ? ' · par distance' : ''}</h2>
        ${places.length ? html`<ul>${places.map(({ c, d }) => this.#row(c, d !== null ? formatDistance(d) : null))}</ul>`
          : html`<p class="empty">Un lieu est une liste de plantes à un endroit précis, visible sur la carte.</p>`}
      </div>
    `;
  }
}

customElements.define('gf-collections', GfCollections);
