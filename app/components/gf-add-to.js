// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { FAVORITES_ID, getMembership, matchCollections, newCollection, saveCollection, setInCollection, withPlant } from '../core/collections.js';
import { href } from '../core/router.js';
import { StoreController } from '../core/store.js';
import { ui } from '../styles/ui.js';

/**
 * "Ajouter à…" sheet: check the collections a plant belongs to, create a list on the fly,
 * or start a new place here. Call `open()`; the plant comes from the `plant` property.
 */
const ICONS = { favorites: '♥', list: '☰', place: '📍' };

export class GfAddTo extends LitElement {
  static properties = {
    plant: { attribute: false },
    _creating: { state: true },
    _query: { state: true },
    _busy: { state: true }
  };

  static styles = [ui, css`
    dialog {
      position: fixed;
      inset: auto 0 0 0;
      width: 100%;
      max-width: 520px;
      max-height: 80dvh;
      margin: 0 auto;
      padding: 0;
      border: 0;
      border-radius: var(--gf-radius-lg) var(--gf-radius-lg) 0 0;
      background: var(--gf-surface);
      color: var(--gf-text);
      flex-direction: column;
    }
    dialog[open] { display: flex; }
    dialog::backdrop { background: rgb(0 0 0 / 40%); }
    @media (min-width: 700px) { dialog { inset: 0; margin: auto; border-radius: var(--gf-radius-lg); height: fit-content; } }
    header { padding: 14px 16px 8px; border-bottom: 1px solid var(--gf-border); }
    h2 { margin: 0; font-size: 1.05rem; }
    header p { margin: 2px 0 0; color: var(--gf-text-muted); font-size: 0.85rem; }
    ul { list-style: none; margin: 0; padding: 6px 8px; overflow-y: auto; flex: 1; }
    li label {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 8px;
      border-radius: var(--gf-radius-sm);
      cursor: pointer;
    }
    li label:hover { background: var(--gf-surface-2); }
    li input { flex: none; }
    .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .count { color: var(--gf-text-muted); font-size: 0.8rem; }
    .section { padding: 8px 8px 2px; }
    footer { display: grid; gap: 8px; padding: 10px 16px calc(14px + env(safe-area-inset-bottom)); border-top: 1px solid var(--gf-border); }
    footer form { display: flex; gap: 8px; }
    footer input { flex: 1; min-width: 0; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; }
    .row > * { flex: 1; }
    .suggest { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 0.85rem; color: var(--gf-text-muted); }
  `];

  #store = new StoreController(this);

  constructor() {
    super();
    /** @type {any} */
    this.plant = null;
    this._creating = false;
    this._query = '';
    this._busy = false;
  }

  open() {
    this._creating = false;
    this._query = '';
    /** @type {HTMLDialogElement} */ (this.renderRoot.querySelector('dialog')).showModal();
  }

  #close() {
    /** @type {HTMLDialogElement} */ (this.renderRoot.querySelector('dialog')).close();
  }

  /** @param {string} id @param {Event} event */
  async #toggle(id, event) {
    const on = /** @type {HTMLInputElement} */ (event.target).checked;
    this._busy = true;
    try { await setInCollection(id, this.plant, on); } finally { this._busy = false; }
  }

  /** @param {SubmitEvent} event */
  async #createList(event) {
    event.preventDefault();
    const input = /** @type {HTMLInputElement} */ (this.renderRoot.querySelector('footer input'));
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    // Same name as an existing collection: add to it instead of creating a twin.
    const { exact } = matchCollections(this.#store.state.collections, name);
    if (exact) return this.#addToExisting(exact.id);
    this._busy = true;
    try {
      await saveCollection(withPlant(newCollection('list', { name }), this.plant));
      this._creating = false;
      this._query = '';
    } finally { this._busy = false; }
  }

  /** A suggested existing collection was picked while typing a new name. @param {string} id */
  async #addToExisting(id) {
    this._busy = true;
    try {
      await setInCollection(id, this.plant, true);
      this._creating = false;
      this._query = '';
    } finally { this._busy = false; }
  }

  render() {
    const plant = this.plant;
    const { collections } = this.#store.state;
    const inIds = new Set(plant ? getMembership().byPlant.get(plant.id) || [] : []);
    const name = plant?.vernacularNames?.[0] || plant?.vernacularName || plant?.scientificName || '';
    const favorites = collections.find(c => c.kind === 'favorites') || { id: FAVORITES_ID, name: 'Favoris', kind: 'favorites', count: 0 };
    const lists = collections.filter(c => c.kind === 'list');
    const places = collections.filter(c => c.kind === 'place');
    const suggestions = matchCollections(collections, this._query);

    const row = (/** @type {{ id: string, name: string, count: number }} */ c, /** @type {string} */ icon) => html`
      <li><label>
        <input type="checkbox" .checked=${inIds.has(c.id)} ?disabled=${this._busy} @change=${e => this.#toggle(c.id, e)} />
        <span class="name">${icon} ${c.name}</span>
        <span class="count">${c.count}</span>
      </label></li>`;

    return html`
      <dialog aria-label="Ajouter à une collection" @click=${e => { if (e.target === e.currentTarget) this.#close(); }}>
        <header>
          <h2>Ajouter à…</h2>
          <p>${name}</p>
        </header>
        <ul>
          ${row(favorites, '♥')}
          ${lists.length ? html`<li class="section kicker">Collections</li>${lists.map(c => row(c, '☰'))}` : nothing}
          ${places.length ? html`<li class="section kicker">Endroits</li>${places.map(c => row(c, '📍'))}` : nothing}
        </ul>
        <footer>
          ${this._creating ? html`
            ${suggestions.matches.length ? html`
              <div class="suggest" role="group" aria-label="Collections existantes">
                Déjà :
                ${suggestions.matches.map(c => html`
                  <button type="button" aria-pressed=${inIds.has(c.id) ? 'true' : 'false'} ?disabled=${this._busy || inIds.has(c.id)}
                    @click=${() => this.#addToExisting(c.id)}>${ICONS[c.kind] || '☰'} ${c.name}${inIds.has(c.id) ? ' ✓' : ''}</button>`)}
              </div>` : nothing}
            <form @submit=${this.#createList}>
              <input type="text" placeholder="Nom de la collection (ex. Mellifères)" aria-label="Nom de la nouvelle collection" autofocus
                .value=${this._query} @input=${e => { this._query = e.target.value; }} />
              <button class="primary" type="submit" ?disabled=${this._busy}>${suggestions.exact ? 'Ajouter' : 'Créer'}</button>
            </form>` : html`
            <div class="row">
              <button type="button" @click=${() => { this._creating = true; }}>+ Nouvelle collection</button>
              <a class="button" href=${href.newSpot(plant?.id)} @click=${() => this.#close()}>📍 Nouvel endroit ici</a>
            </div>`}
          <button class="primary" type="button" @click=${() => this.#close()}>Terminé</button>
        </footer>
      </dialog>
    `;
  }
}

customElements.define('gf-add-to', GfAddTo);
