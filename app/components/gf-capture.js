// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { config } from '../config.js';
import * as db from '../core/db.js';
import { watchLocation } from '../core/geo.js';
import { href } from '../core/router.js';
import {
  deleteCollection, distance, findEntry, listPlaces, nearbyPlaces, newPlace, placeTitle, recentPlants, rememberPlant,
  saveCollection, withEntry, withPlant
} from '../core/collections.js';
import { store, StoreController } from '../core/store.js';
import { lookalikeWarning } from '../core/lookalikes.js';
import { statusWarning } from './gf-status.js';
import { ui } from '../styles/ui.js';
import './gf-thumb.js';
import './gf-voice-button.js';
import { icon } from '../core/icons.js';
import { voiceAvailable } from '../core/voice.js';
import './gf-plant-pick-list.js';

/** A plant tapped within this distance of an existing place joins it instead of creating a new one. */
const JOIN_RADIUS = 30;
/** Plants of places within this distance are suggested first. */
const AROUND_RADIUS = 200;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * "Noter ici": one tap on a plant records it at the current GPS position — in the nearest place
 * within 30 m, or in a new place. Suggestions first: plants around you, favorites, recent.
 * Opened with `open()`; shows an undo toast afterwards.
 */
export class GfCapture extends LitElement {
  static properties = {
    _fix: { state: true },
    _gpsError: { state: true },
    _suggest: { state: true },
    _query: { state: true },
    _harvestToday: { state: true },
    _busy: { state: true },
    _toast: { state: true }
  };

  static styles = [ui, css`
    dialog {
      position: fixed;
      inset: auto 0 0 0;
      width: 100%;
      max-width: 560px;
      max-height: 86dvh;
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
    header { padding: 14px 16px 10px; border-bottom: 1px solid var(--gf-border); display: grid; gap: 6px; }
    .ask { position: relative; display: grid; }
    /* Right of the field: [✕ effacer] [micro], side by side; the input leaves them room (padding set in render). */
    input::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; display: none; }
    .tools { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); display: flex; align-items: center; gap: 2px; }
    .clear {
      width: 32px;
      height: 32px;
      min-height: 0;
      display: grid;
      place-items: center;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--gf-text-muted);
      font-size: 0.95rem;
      cursor: pointer;
    }
    .clear:hover { background: var(--gf-surface-2); color: var(--gf-text); }
    .clear:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    h2 { margin: 0; font-size: 1.1rem; }
    .gps { font-size: 0.85rem; color: var(--gf-text-muted); display: flex; align-items: center; gap: 8px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--gf-text-muted); flex: none; }
    .dot.good { background: #16a34a; }
    .dot.weak { background: #f59e0b; }
    .dot.none { background: var(--gf-danger); }
    .body { overflow-y: auto; padding: 8px 16px 16px; flex: 1; }
    h3 { margin: 12px 0 6px; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chips button { padding: 3px 14px 3px 3px; gap: 8px; }
    .chips small { color: var(--gf-text-muted); }
    footer { padding: 10px 16px calc(12px + env(safe-area-inset-bottom)); border-top: 1px solid var(--gf-border); display: flex; align-items: center; gap: 10px; }
    footer label { display: flex; align-items: center; gap: 8px; flex: 1; font-size: 0.9rem; }
    p.muted { font-size: 0.9rem; }
    .toast {
      position: fixed;
      z-index: 2000;
      left: 50%;
      transform: translateX(-50%);
      bottom: calc(84px + env(safe-area-inset-bottom));
      width: min(520px, calc(100% - 24px));
      display: grid;
      gap: 6px;
    }
    .toast .warn { color: #fecaca; font-weight: 600; font-size: 0.85rem; margin-bottom: 4px; }
    .toast .warn a { color: inherit; }
    .toast .warn.lookalike { color: #fde68a; }
    .toast .row { display: flex; gap: 12px; align-items: center; }
    .toast .row span { flex: 1; }
  `];

  #store = new StoreController(this);
  /** @type {(() => void) | null} */ #unwatch = null;
  /** @type {number | undefined} */ #toastTimer;

  constructor() {
    super();
    /** @type {import('../core/geo.js').Fix | null} */
    this._fix = null;
    /** @type {string | null} */
    this._gpsError = null;
    /** @type {{ around: any[], favorites: any[], recent: any[] }} */
    this._suggest = { around: [], favorites: [], recent: [] };
    this._query = '';
    this._harvestToday = true;
    this._busy = false;
    /** @type {{ text: string, undo: () => Promise<void>, details: string, warning?: string | null, lookalike?: { toxic: boolean, text: string } | null, plantId?: number } | null} */
    this._toast = null;
  }

  get #dialog() { return /** @type {HTMLDialogElement} */ (this.renderRoot.querySelector('dialog')); }

  open() {
    this._query = '';
    this.#dialog.showModal();
    this.#unwatch ??= watchLocation(({ fix, error }) => {
      const firstFix = !this._fix && fix;
      this._fix = fix;
      this._gpsError = error;
      if (firstFix) this.#loadSuggestions();
    });
    this.#loadSuggestions();
  }

  #close() {
    this.#dialog.close();
  }

  #onClosed() {
    this.#unwatch?.();
    this.#unwatch = null;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#onClosed();
  }

  async #loadSuggestions() {
    const plantsById = async (/** @type {number[]} */ ids) =>
      (await Promise.all(ids.map(id => db.get('plants', id)))).filter(Boolean);
    try {
      /** @type {Map<number, { plant: any, d: number }>} */
      const around = new Map();
      if (this._fix) {
        const fix = this._fix;
        for (const place of await listPlaces()) {
          const d = place.geometry ? distance(fix.coordinates, place.geometry.coordinates) : Infinity;
          if (d > AROUND_RADIUS) continue;
          for (const e of place.properties.plants) {
            if (e.plantId === null) continue;
            const best = around.get(e.plantId);
            if (!best || d < best.d) around.set(e.plantId, { plant: e, d });
          }
        }
      }
      const aroundIds = [...around.entries()].sort((a, b) => a[1].d - b[1].d).map(([id]) => id).slice(0, 12);
      const shown = new Set(aroundIds);
      const favoriteIds = [...store.state.favorites].filter(id => !shown.has(id)).slice(0, 12);
      favoriteIds.forEach(id => shown.add(id));
      const recentIds = recentPlants().filter(id => !shown.has(id)).slice(0, 8);
      this._suggest = {
        around: (await plantsById(aroundIds)).map(p => ({ ...p, d: around.get(p.id)?.d })),
        favorites: await plantsById(favoriteIds),
        recent: await plantsById(recentIds)
      };
    } catch (error) {
      console.error(error);
    }
  }

  /** @param {Event} event */
  async #search(event) {
    await this.#find(/** @type {HTMLInputElement} */ (event.target).value);
  }

  /** ✕: empty the search, keep typing. */
  #clear() {
    this.#find('');
    /** @type {HTMLInputElement | null} */ (this.renderRoot.querySelector('.ask input'))?.focus();
  }

  /** Typed or dictated: the list below follows (gf-plant-pick-list). @param {string} q */
  #find(q) {
    this._query = q;
  }

  /** Records the plant here. @param {any} summaryOrPlant */
  async #capture(summaryOrPlant) {
    const fix = this._fix;
    if (!fix || this._busy) return;
    this._busy = true;
    try {
      const plant = summaryOrPlant.vernacularNames ? summaryOrPlant : await db.get('plants', summaryOrPlant.id);
      const [nearest] = await nearbyPlaces(fix.coordinates, JOIN_RADIUS);
      const before = nearest?.place ? structuredClone(nearest.place) : null;
      // The plant is noted exactly where you stand; the place keeps its own point.
      const here = { coordinates: fix.coordinates, accuracy: Math.round(fix.accuracy) };
      let place = before
        ? withPlant(before, plant, here)
        : withPlant(newPlace(fix.coordinates, { accuracy: here.accuracy }), plant, here);
      const harvest = this.#store.state.harvestMode && this._harvestToday;
      if (harvest) {
        const entry = /** @type {any} */ (findEntry(place, plant.id));
        if (!entry.harvests.some(h => h.date === today())) {
          place = withEntry(place, plant.id, { harvests: [{ date: today(), quantity: '', note: '' }, ...entry.harvests] });
        }
      }
      const saved = await saveCollection(place);
      rememberPlant(plant.id);
      this.#close();

      const name = plant.vernacularNames?.[0] || plant.scientificName;
      // Protected or regulated where it was just noted: say so right away (INPN statuses).
      const record = plant.statuses ? plant : await db.get('plants', plant.id).catch(() => null);
      const warning = await statusWarning(record, fix.coordinates);
      // Mode cueillette: the plants it can be mistaken for (Anses / Centres antipoison).
      const lookalike = this.#store.state.harvestMode ? await lookalikeWarning(plant) : null;
      this.#showToast({
        warning,
        lookalike,
        plantId: plant.id,
        text: before ? `${name} ajouté au lieu « ${placeTitle(before)} »${harvest ? ' · récolte notée' : ''}` : `${name} noté ici (nouveau lieu)${harvest ? ' · récolte notée' : ''}`,
        details: href.spot(saved.id),
        undo: async () => {
          if (before) await saveCollection(before);
          else await deleteCollection(saved.id);
        }
      });
    } catch (error) {
      console.error(error);
      this._gpsError = 'Enregistrement impossible : ' + /** @type {Error} */ (error).message;
    } finally {
      this._busy = false;
    }
  }

  /** @param {NonNullable<GfCapture['_toast']>} toast */
  #showToast(toast) {
    clearTimeout(this.#toastTimer);
    this._toast = toast;
    this.#toastTimer = setTimeout(() => { this._toast = null; }, toast.lookalike ? 12000 : 7000);
  }

  async #undo() {
    const toast = this._toast;
    this._toast = null;
    try { await toast?.undo(); } catch (error) { console.error(error); }
  }

  /** @param {string} title @param {any[]} plants */
  #chips(title, plants) {
    if (!plants.length) return nothing;
    return html`<h3 class="kicker">${title}</h3><div class="chips">${plants.map(p => html`
      <button type="button" ?disabled=${!this._fix || this._busy} @click=${() => this.#capture(p)}>
        <gf-thumb .plant=${p} size="30" round></gf-thumb>
        ${p.vernacularNames?.[0] || p.scientificName}${p.d !== undefined ? html` <small>· ${Math.round(p.d)} m</small>` : nothing}
      </button>`)}</div>`;
  }

  #gps() {
    const fix = this._fix;
    if (!fix) return html`<span class="dot ${this._gpsError ? 'none' : ''}"></span>${this._gpsError || 'Recherche de la position GPS…'}`;
    const good = fix.accuracy <= config.goodAccuracy;
    return html`<span class="dot ${good ? 'good' : 'weak'}"></span>Position GPS ± ${Math.round(fix.accuracy)} m${good ? '' : ' — précision faible'}`;
  }

  render() {
    const { around, favorites, recent } = this._suggest;
    const harvestMode = this.#store.state.harvestMode;
    const t = this._toast;
    return html`
      <dialog aria-label="Noter une plante ici" @close=${this.#onClosed}
        @click=${e => { if (e.target === e.currentTarget) this.#close(); }}>
        <header>
          <h2>Noter ici</h2>
          <div class="gps" role="status">${this.#gps()}</div>
          <div class="ask">
            <input type="search" placeholder="Quelle plante ?" aria-label="Chercher une plante" autocomplete="off"
              style="padding-right:${12 + 34 * (Number(Boolean(this._query)) + Number(voiceAvailable()))}px"
              .value=${this._query} @input=${this.#search} />
            <span class="tools">
              ${this._query ? html`<button class="clear" type="button" aria-label="Effacer la recherche" title="Effacer"
                @mousedown=${e => e.preventDefault()} @click=${this.#clear}>${icon('x-lg')}</button>` : nothing}
              <gf-voice-button @voice-text=${e => this.#find(e.detail.text)}></gf-voice-button>
            </span>
          </div>
        </header>
        <div class="body">
          ${this._query.trim().length >= 2 ? html`<gf-plant-pick-list .query=${this._query} ?disabled=${!this._fix || this._busy}
              @plant-pick=${e => this.#capture(e.detail.plant)}></gf-plant-pick-list>`
            : html`
              ${this.#chips('Autour de vous', around)}
              ${this.#chips('Favoris', favorites)}
              ${this.#chips('Récemment notées', recent)}
              ${!around.length && !favorites.length && !recent.length
                ? html`<p class="muted">Tapez le nom de la plante. Elle sera notée à votre position, dans le lieu le plus proche (moins de ${JOIN_RADIUS} m) ou dans un nouveau lieu.</p>`
                : nothing}`}
        </div>
        <footer>
          ${harvestMode ? html`<label><input type="checkbox" .checked=${this._harvestToday}
            @change=${e => { this._harvestToday = e.target.checked; }} /> Noter aussi une récolte aujourd’hui</label>` : html`<span style="flex:1"></span>`}
          <button type="button" @click=${() => this.#close()}>Fermer</button>
        </footer>
      </dialog>
      ${t ? html`<div class="toast" role="status">
        ${t.warning ? html`<div class="warn" role="alert">${icon('exclamation-triangle-fill')} ${t.warning} — <a href=${href.plant(/** @type {any} */ (t).plantId)}>voir la fiche</a></div>` : nothing}
        ${t.lookalike ? html`<div class="warn lookalike" role="alert">${icon(t.lookalike.toxic ? 'exclamation-octagon-fill' : 'exclamation-triangle-fill')} ${t.lookalike.text} — <a href=${href.plant(/** @type {any} */ (t).plantId)}>comment les distinguer</a></div>` : nothing}
        <div class="row"><span>${t.text}</span>
          <button class="link" type="button" @click=${this.#undo}>Annuler</button>
          <a class="link" href=${t.details} @click=${() => { this._toast = null; }}>Détails</a>
        </div>
      </div>` : nothing}
    `;
  }
}

customElements.define('gf-capture', GfCapture);
