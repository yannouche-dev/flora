// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import * as db from '../core/db.js';
import { href } from '../core/router.js';
import { newCollection, newPlace, plantCount, saveCollection, withEntry, withPlant } from '../core/collections.js';
import { decodeCollection } from '../core/share.js';
import { whenReady } from '../core/store.js';
import './gf-map.js';

/** Preview of a collection received by link (#/shared?d=…), with "Enregistrer dans mes plantes". */
export class GfShared extends LitElement {
  static properties = {
    data: {},
    _shared: { state: true },
    _plants: { state: true },
    _error: { state: true },
    _busy: { state: true }
  };

  static styles = css`
    *, *::before, *::after { box-sizing: border-box; }
    :host { display: block; overflow-y: auto; }
    .wrap { max-width: 720px; margin: 0 auto; padding: 14px 16px 40px; display: grid; gap: 12px; }
    .kicker { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--gf-text-muted); }
    h1 { margin: 0; font-size: 1.4rem; }
    gf-map { height: 220px; border-radius: var(--gf-radius); overflow: hidden; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    li a {
      display: grid;
      grid-template-columns: 44px 1fr;
      gap: 0 12px;
      align-items: center;
      padding: 6px 10px;
      border-radius: 10px;
      background: var(--gf-surface);
      border: 1px solid var(--gf-border);
      color: inherit;
      text-decoration: none;
    }
    li img, li .ph { grid-row: span 2; width: 44px; height: 44px; border-radius: 8px; object-fit: cover; background: var(--gf-surface-2); }
    .nm { font-weight: 600; }
    .sci { font-family: var(--gf-font-serif); font-style: italic; color: var(--gf-text-muted); font-size: 0.85rem; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; position: sticky; bottom: 0; padding: 10px 0; background: var(--gf-bg); }
    button {
      font: inherit;
      font-weight: 600;
      padding: 12px 22px;
      border-radius: 999px;
      border: 0;
      background: var(--gf-accent);
      color: var(--gf-accent-contrast);
      cursor: pointer;
    }
    a.cancel { color: var(--gf-text-muted); }
    .muted { color: var(--gf-text-muted); font-size: 0.9rem; margin: 0; }
    .error { color: var(--gf-danger); }
  `;

  constructor() {
    super();
    this.data = '';
    /** @type {import('../core/share.js').SharedCollection | null} */
    this._shared = null;
    /** @type {any[]} */
    this._plants = [];
    /** @type {string | null} */
    this._error = null;
    this._busy = false;
  }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (changed.has('data')) this.#load();
  }

  async #load() {
    this._shared = null;
    this._error = null;
    try {
      const shared = await decodeCollection(this.data);
      await whenReady();
      const plants = (await Promise.all(shared.plants.map(p => db.get('plants', p.plantId)))).filter(Boolean);
      this._plants = plants;
      this._shared = shared;
      document.title = (shared.name || 'Collection partagée') + ' — GeoFlora';
    } catch (error) {
      this._error = /** @type {Error} */ (error).message;
    }
  }

  async #save() {
    const shared = this._shared;
    if (!shared) return;
    this._busy = true;
    try {
      let collection = shared.kind === 'place' && shared.coordinates
        ? newPlace(shared.coordinates, { name: shared.name })
        : newCollection('list', { name: shared.name });
      for (const plant of this._plants) {
        collection = withPlant(collection, plant);
        const abundance = shared.plants.find(p => p.plantId === plant.id)?.abundance;
        if (abundance) collection = withEntry(collection, plant.id, { abundance: /** @type {any} */ (abundance) });
      }
      const saved = await saveCollection(collection);
      location.hash = href.spot(saved.id);
    } catch (error) {
      this._error = 'Enregistrement impossible : ' + /** @type {Error} */ (error).message;
    } finally {
      this._busy = false;
    }
  }

  render() {
    if (this._error) {
      return html`<div class="wrap"><h1>Lien de partage</h1><p class="error" role="alert">${this._error}</p>
        <a href=${href.collections()}>Mes plantes</a></div>`;
    }
    const shared = this._shared;
    if (!shared) return html`<div class="wrap"><p class="muted">Ouverture du partage…</p></div>`;
    const missing = shared.plants.length - this._plants.length;

    return html`
      <div class="wrap">
        <span class="kicker">${shared.kind === 'place' ? 'Lieu partagé' : 'Liste partagée'}</span>
        <h1>${shared.name || 'Sans nom'}</h1>
        <p class="muted">${plantCount(this._plants.length)}${missing > 0 ? ` (${missing} inconnue${missing > 1 ? 's' : ''} de cette version de la flore)` : ''}</p>
        ${shared.coordinates ? html`
          <gf-map .spots=${[{ type: 'Feature', id: 'shared', geometry: { type: 'Point', coordinates: shared.coordinates },
            properties: { kind: 'place', name: shared.name, plants: this._plants.map(() => ({ abundance: 'moyen', harvests: [] })), plantIds: [] } }]} fit></gf-map>` : nothing}
        <ul>
          ${this._plants.map(plant => html`
            <li><a href=${href.plant(plant.id)}>
              ${plant.thumbnail?.url ? html`<img src=${plant.thumbnail.url} alt="" loading="lazy" referrerpolicy="no-referrer" />` : html`<span class="ph"></span>`}
              <span class="nm">${plant.vernacularNames?.[0] || plant.scientificName}</span>
              <span class="sci">${plant.scientificName}</span>
            </a></li>`)}
        </ul>
        <div class="actions">
          <button type="button" ?disabled=${this._busy || !this._plants.length} @click=${this.#save}>Enregistrer dans mes plantes</button>
          <a class="cancel" href=${href.collections()}>Ignorer</a>
        </div>
        <p class="muted">L’enregistrement crée une nouvelle ${shared.kind === 'place' ? 'collection-lieu' : 'liste'} sur cet appareil ; rien n’est envoyé.</p>
      </div>
    `;
  }
}

customElements.define('gf-shared', GfShared);
