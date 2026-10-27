// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { FAVORITES_ID, addedTo, getMembership, getPlace, matchCollections, newCollection, removeQuestion, saveCollection, setInCollection, withPlant } from '../core/collections.js';
import { recentFix } from '../core/geo.js';
import { href } from '../core/router.js';
import { setContext } from '../core/context.js';
import { openModal } from '../core/history.js';
import { StoreController } from '../core/store.js';
import { ui } from '../styles/ui.js';
import { sheetStyles } from './ui-kit.js';
import { icon, kindIcon } from '../core/icons.js';
import { confirmAsk } from './gf-ask.js';

/**
 * "Ajouter à…" sheet: check the lists and places a plant belongs to, create a list on the fly,
 * or start a new place here. Call `open()`; the plant comes from the `plant` property. Ticked, a lieu takes it at your
 * position when you stand near it (a position from the last minute: geo.js recentFix; never asked for here), else at
 * its point — said under the list (addedTo). Unticked, a list, a lieu or the favourites asks first when the plant's
 * note, its harvest log or its other notings would go (as the lieu's editor).
 */

export class GfAddTo extends LitElement {
  static properties = {
    plant: { attribute: false },
    _creating: { state: true },
    _query: { state: true },
    _busy: { state: true },
    /** Where the plant just added went (addedTo), said above « Terminé ». */
    _said: { state: true }
  };

  static styles = [ui, sheetStyles, css`
    dialog.drawer { --drawer-h: 80dvh; }
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
    .said { margin: 0; font-size: 0.85rem; color: var(--gf-text-muted); }
  `];

  #store = new StoreController(this);

  constructor() {
    super();
    /** @type {any} */
    this.plant = null;
    this._creating = false;
    this._query = '';
    this._busy = false;
    /** @type {string | null} */
    this._said = null;
  }

  open() {
    this._creating = false;
    this._query = '';
    this._said = null;
    openModal(/** @type {HTMLDialogElement} */ (this.renderRoot.querySelector('dialog')));
  }

  #close() {
    /** @type {HTMLDialogElement} */ (this.renderRoot.querySelector('dialog')).close();
  }

  /** @param {string} id @param {Event} event */
  async #toggle(id, event) {
    const box = /** @type {HTMLInputElement} */ (event.target);
    const on = box.checked;
    this._busy = true;
    try {
      if (!on) {
        // What would go with it, read as stored (collections.js removeQuestion): asked first. Kept: ticked again (its
        // membership did not change, so the view would not).
        const current = await getPlace(id);
        const q = current && removeQuestion(current, this.plant.id);
        if (q && !await confirmAsk(q)) { box.checked = true; return; }
      }
      const fix = on ? recentFix() : null;
      const saved = await setInCollection(id, this.plant, on, fix);
      this._said = on ? addedTo(saved, fix) : null;
      // The last collection a plant was put in becomes the current one (« Ajouter à … » on the sheet).
      if (on && id !== FAVORITES_ID) setContext({ collection: id });
    } finally { this._busy = false; }
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
      const created = newCollection('list', { name });
      // A favourite of a game put in a list: the user's own now (saveCollection says so).
      await saveCollection(withPlant(created, this.plant));
      setContext({ collection: created.id });
      this._creating = false;
      this._query = '';
    } finally { this._busy = false; }
  }

  /** A suggested existing collection was picked while typing a new name. @param {string} id */
  async #addToExisting(id) {
    this._busy = true;
    try {
      const fix = recentFix();
      this._said = addedTo(await setInCollection(id, this.plant, true, fix), fix);
      setContext({ collection: id });
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

    const row = (/** @type {{ id: string, name: string, count: number }} */ c, /** @type {string} */ kind) => html`
      <li><label>
        <input type="checkbox" .checked=${inIds.has(c.id)} ?disabled=${this._busy} @change=${e => this.#toggle(c.id, e)} />
        <span class="name">${kindIcon(kind)} ${c.name}</span>
        <span class="count">${c.count}</span>
      </label></li>`;

    return html`
      <dialog class="drawer centered" aria-label="Ajouter à une liste ou un lieu" @click=${e => { if (e.target === e.currentTarget) this.#close(); }}>
        <header>
          <h2>Ajouter à…</h2>
          <p>${name}</p>
        </header>
        <ul>
          ${row(favorites, 'favorites')}
          ${lists.length ? html`<li class="section kicker">Listes</li>${lists.map(c => row(c, 'list'))}` : nothing}
          ${places.length ? html`<li class="section kicker">Lieux</li>${places.map(c => row(c, 'place'))}` : nothing}
        </ul>
        <footer>
          ${this._creating ? html`
            ${suggestions.matches.length ? html`
              <div class="suggest" role="group" aria-label="Listes et lieux existants">
                Déjà :
                ${suggestions.matches.map(c => html`
                  <button type="button" aria-pressed=${inIds.has(c.id) ? 'true' : 'false'} ?disabled=${this._busy || inIds.has(c.id)}
                    @click=${() => this.#addToExisting(c.id)}>${kindIcon(c.kind)} ${c.name}${inIds.has(c.id) ? html` ${icon('check-lg')}` : ''}</button>`)}
              </div>` : nothing}
            <form @submit=${this.#createList}>
              <input type="text" placeholder="Nom de la liste (ex. Mellifères)" aria-label="Nom de la nouvelle liste" autofocus
                .value=${this._query} @input=${e => { this._query = e.target.value; }} />
              <button class="primary" type="submit" ?disabled=${this._busy}>${suggestions.exact ? 'Ajouter' : 'Créer'}</button>
            </form>` : html`
            <div class="row">
              <button type="button" @click=${() => { this._creating = true; }}>${icon('plus-lg')} Nouvelle liste</button>
              <a class="button" href=${href.newSpot(plant?.id)} @click=${() => this.#close()}>${icon('geo-alt-fill')} Nouveau lieu ici</a>
            </div>`}
          ${this._said ? html`<p class="said" role="status">${this._said}</p>` : nothing}
          <button class="primary" type="button" @click=${() => this.#close()}>Terminé</button>
        </footer>
      </dialog>
    `;
  }
}

customElements.define('gf-add-to', GfAddTo);
