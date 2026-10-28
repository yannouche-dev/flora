// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { config } from '../config.js';
import * as db from '../core/db.js';
import { getPlant, getPlants, nameOf } from '../core/plants.js';
import { watchLocation } from '../core/geo.js';
import { href } from '../core/router.js';
import { openModal } from '../core/history.js';
import {
  GoneError, NEAR_PLACE, distance, getPlace, listPlaces, newPlace, placeTitle, placesNear, recentPlants, rememberPlant,
  saveCollection, undoNewPlace, updatePlace, withEntry, withPlant, withoutPlant, entriesOf, lastEntry } from '../core/collections.js';
import { store, StoreController } from '../core/store.js';
import { lookalikeWarning } from '../core/lookalikes.js';
import { verdictOf } from '../core/alerts.js';
import { harvestStop } from '../core/danger.js';
import { statusWarning } from './gf-status.js';
import { emergency } from '../core/poison.js';
import { ui } from '../styles/ui.js';
import './gf-thumb.js';
import './gf-voice-button.js';
import { icon } from '../core/icons.js';
import { voiceAvailable } from '../core/voice.js';
import { takeToastSlot } from '../core/toast.js';
import './gf-plant-pick-list.js';
import './gf-harvest-warning.js';
import './gf-nearby-places.js';

/** Plants of places within this distance are suggested first. */
const AROUND_RADIUS = 200;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * "Noter ici": one tap on a plant records it at the current GPS position. A lieu within NEAR_PLACE is offered first
 * (gf-nearby-places, the same offer as a new lieu's editor: collections.js placesNear, never a parcours) — « Y ajouter »
 * one of them, or « Nouveau lieu ici »; none near, a new lieu at once. Suggestions first: plants around you, favorites,
 * recent. Opened with `open()`, or `open({ plant })` with the plant chosen already (its sheet, its map, a plant card, an
 * activity's sheet: one « Noter ici » everywhere) — « Noter ici », or « Autre plante » back to the list; the warning,
 * the offer and the toast are the same. Shows an undo toast afterwards.
 */

/** Within this distance (m), the plant noted again is the same occurrence; farther, another one. */
const SAME_SPOT = 15;
export class GfCapture extends LitElement {
  static properties = {
    _fix: { state: true },
    _gpsError: { state: true },
    _suggest: { state: true },
    _query: { state: true },
    _harvestToday: { state: true },
    _confirm: { state: true },
    _where: { state: true },
    _chosen: { state: true },
    _error: { state: true },
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
    p.error { color: var(--gf-danger); font-size: 0.9rem; margin: 8px 0; }
    .chosen { display: flex; align-items: center; gap: 12px; margin: 8px 0; }
    .chosen i { color: var(--gf-text-muted); font-size: 0.9rem; }
    .where { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; }
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
    .toast .warn .sos-line { display: block; font-weight: 400; margin-top: 2px; }
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
    // Never ticked for you: a harvest is noted only when asked (and, for a toxic plant, once the warning is read).
    this._harvestToday = false;
    /** The plant whose harvest waits for its warning to be answered (gf-harvest-warning: danger.js#harvestStop). @type {{ plant: any, verdict: import('../core/danger.js').Verdict } | null} */
    this._confirm = null;
    /**
     * The lieux near, offered before the plant is noted (its harvest decided already, the position they were measured
     * from: the one saved). @type {{ plant: any, harvest: boolean, near: { place: import('../core/collections.js').Place, distance: number }[], fix: import('../core/geo.js').Fix } | null}
     */
    this._where = null;
    /** The plant chosen before the sheet opened (open({ plant })): no list, its « Noter ici ». @type {any} */
    this._chosen = null;
    /** Why the last note could not be saved (said in the sheet, until the next try). @type {string | null} */
    this._error = null;
    this._busy = false;
    /** @type {{ text: string, undo: () => Promise<void>, details: string, warning?: string | null, lookalike?: { toxic: boolean, text: string, unread?: boolean } | null, plantId?: number } | null} */
    this._toast = null;
  }

  get #dialog() { return /** @type {HTMLDialogElement} */ (this.renderRoot.querySelector('dialog')); }

  /**
   * Opens the sheet; `plant` (a record or a search summary): chosen already — a summary is replaced by its record once
   * read (its names, its photo). Drawn first, then shown, the focus where it starts (#focusStart): never on the view
   * the last opening left, which the drawing would remove under it (the focus fallen to the page).
   * @param {{ plant?: any }} [options]
   */
  async open({ plant } = {}) {
    this._query = '';
    this._confirm = null;
    this._where = null;
    this._error = null;
    this._chosen = plant ?? null;
    if (plant && !plant.vernacularNames) {
      db.get('plants', plant.id).then(record => { if (record && this._chosen === plant) this._chosen = record; }).catch(() => {});
    }
    // Unticked at each opening: a harvest asked for one plant is never carried over to the next one noted.
    this._harvestToday = false;
    await this.updateComplete;
    openModal(this.#dialog);
    this.#focusStart();
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

  /** The focus where the sheet starts: the plant chosen, its « Noter ici » (« Autre plante » until the position comes); else the search field. */
  #focusStart() {
    const at = this._chosen ? this.renderRoot.querySelector('.body .where button:not([disabled])') : this.renderRoot.querySelector('.ask input');
    /** @type {HTMLElement | null} */ (at)?.focus();
  }

  /** « Annuler » the lieux offered: back to the plant chosen or the list, the focus with it (its button is gone). */
  async #leaveOffer() {
    this._where = null;
    await this.updateComplete;
    this.#focusStart();
  }

  /**
   * The keys the page behind would take (an activity's sheet: Échap closes it, ← → change its plant; the cards: → a
   * match), kept in the sheet: its own Échap still closes it (the dialog's default), never the page under it.
   * @param {KeyboardEvent} e
   */
  #keepKeys(e) {
    if (e.key === 'Escape' || e.key.startsWith('Arrow')) e.stopPropagation();
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
        around: (await getPlants(aroundIds)).map(p => ({ ...p, d: around.get(p.id)?.d })),
        favorites: await getPlants(favoriteIds),
        recent: await getPlants(recentIds)
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

  /** Typed or dictated: the list below follows (gf-plant-pick-list) — back from the lieux offered. @param {string} q */
  #find(q) {
    this._query = q;
    this._where = null;
  }

  /**
   * Records the plant here. With today's harvest (mode cueillette, box ticked), a plant our sources say is toxic, whose
   * toxicity data cannot be read, or protected where you stand, first shows a warning that must be answered (its
   * verdict here, core/danger.js). Then, a lieu within NEAR_PLACE (placesNear): offered first, nothing saved until one is
   * chosen (`into`) or « Nouveau lieu ici » (`into: null`).
   * @param {any} summaryOrPlant
   * @param {{ harvest?: boolean, into?: string | null }} [chosen] `harvest`: the user chose, after the warning (or with
   *   the offer); `into`: the lieu chosen in the offer (null: a new one; undefined: not offered yet)
   */
  async #capture(summaryOrPlant, { harvest: chosen, into } = {}) {
    // Chosen in the offer: saved where it was measured from (the distances said are those of where the plant goes).
    const fix = into !== undefined && this._where ? this._where.fix : this._fix;
    if (!fix || this._busy) return;
    this._busy = true;
    this._error = null;
    try {
      const plant = summaryOrPlant.vernacularNames ? summaryOrPlant : await db.get('plants', summaryOrPlant.id);
      const asked = this.#store.state.harvestMode && this._harvestToday;
      if (asked && chosen === undefined) {
        // Its statuses: a search summary has none (the protection is read from the record).
        const record = plant.statuses ? plant : await getPlant(plant.id) ?? plant;
        const verdict = await verdictOf(record, { at: fix.coordinates });
        if (harvestStop(verdict)) {
          this._confirm = { plant, verdict };
          return;
        }
      }
      this._confirm = null;
      const harvest = chosen ?? asked;
      // The lieux near (never a parcours): offered first, nothing saved yet.
      if (into === undefined) {
        const near = await placesNear(fix.coordinates);
        if (near.length) {
          this._where = { plant, harvest, near, fix };
          return;
        }
      }
      this._where = null;
      const before = into ? await getPlace(into) : null;
      if (into && !before) throw new GoneError();
      // The plant is noted exactly where you stand; the place keeps its own point.
      const here = { coordinates: fix.coordinates, accuracy: Math.round(fix.accuracy) };
      // Already noted right here (within a few metres): the same occurrence (today's harvest goes on it);
      // elsewhere in the place: another occurrence of it, at this spot.
      /** What this note added (for « Annuler »): an occurrence, or today's harvest on one already there. */
      const did = { entry: /** @type {string | null} */ (null), harvestOn: /** @type {string | null} */ (null) };
      /** The plant noted in `place` (and today's harvest). @param {import('../core/collections.js').Place} place */
      const note = place => {
        // It lost its point meanwhile (another tab): never put in a list unsaid — nothing written.
        if (!place.geometry) throw new Error('Ce lieu n’a plus de position : rien n’a été enregistré.');
        did.entry = did.harvestOn = null;
        const same = entriesOf(place, plant.id).find(e => e.coordinates && distance(e.coordinates, here.coordinates) <= SAME_SPOT);
        let next = same ? place : withPlant(place, plant, here, { again: true });
        if (!same) did.entry = /** @type {any} */ (lastEntry(next)).id;
        if (harvest) {
          const entry = /** @type {any} */ (same || lastEntry(next));
          if (!entry.harvests.some((/** @type {any} */ h) => h.date === today())) {
            next = withEntry(next, entry.id, { harvests: [{ date: today(), quantity: '', note: '' }, ...entry.harvests] });
            if (same) did.harvestOn = entry.id;
          }
        }
        return next;
      };
      // An existing place: noted in it as stored now (one transaction: nothing written meanwhile is lost).
      const saved = before ? await updatePlace(before.id, note)
        : await saveCollection(note(newPlace(fix.coordinates, { accuracy: here.accuracy })));
      rememberPlant(plant.id);
      this.#close();

      const name = nameOf(plant);
      // Protected or regulated where it was just noted: say so right away (INPN statuses).
      const record = plant.statuses ? plant : await getPlant(plant.id);
      const warning = await statusWarning(record, fix.coordinates);
      // The plants it can be mistaken for (Anses / Centres antipoison), whatever the mode: noted here, it may be picked.
      const lookalike = await lookalikeWarning(plant);
      this.#showToast({
        warning,
        lookalike,
        plantId: plant.id,
        text: before ? `${name} ajouté au lieu « ${placeTitle(before)} »${harvest ? ' · récolte notée' : ''}` : `${name} noté ici (nouveau lieu)${harvest ? ' · récolte notée' : ''}`,
        details: href.spot(saved.id),
        undo: async () => {
          // Only this note undone (the place's other changes since stay); the lieu it made goes with it only if
          // nothing else is in it now (no plant, name or notes: undoNewPlace).
          if (!before) await undoNewPlace(saved.id, /** @type {string} */ (did.entry));
          else if (did.entry) await updatePlace(before.id, current => withoutPlant(current, /** @type {string} */ (did.entry)));
          else if (did.harvestOn) {
            const id = did.harvestOn;
            await updatePlace(before.id, current => {
              const entry = current.properties.plants.find(e => e.id === id);
              const at = entry ? entry.harvests.findIndex(h => h.date === today() && !h.quantity && !h.note) : -1;
              return at < 0 ? current : withEntry(current, id, { harvests: entry.harvests.filter((_, i) => i !== at) });
            });
          }
        }
      });
    } catch (error) {
      console.error(error);
      this._error = 'Enregistrement impossible : ' + /** @type {Error} */ (error).message;
    } finally {
      this._busy = false;
    }
  }

  /**
   * The capture's word (and its safety warnings): the app's one toast place (core/toast.js) — a map's brief toast
   * shown meanwhile goes, and none comes over it while it shows (it carries « Annuler » and « Détails »: weight 2, a
   * safety warning 3; never two toasts stacked).
   * @param {NonNullable<GfCapture['_toast']>} toast
   */
  #showToast(toast) {
    clearTimeout(this.#toastTimer);
    this.#releaseSlot?.();
    this._toast = toast;
    this.#releaseSlot = takeToastSlot(() => { clearTimeout(this.#toastTimer); this._toast = null; }, toast.warning || toast.lookalike ? 3 : 2);
    this.#toastTimer = setTimeout(() => { this._toast = null; }, toast.lookalike ? 12000 : 7000);
  }
  /** Gives the app's toast place back. @type {(() => void) | null} */ #releaseSlot = null;

  /** @param {Map<string, any>} changed */
  updated(changed) {
    // The toast gone (its time, Annuler, Détails, another one): its place given back.
    if (changed.has('_toast') && !this._toast) { this.#releaseSlot?.(); this.#releaseSlot = null; }
    // The lieux near offered: the focus on the nearest one's « Y ajouter ».
    if (changed.has('_where') && this._where) {
      const offer = /** @type {HTMLElement & { updateComplete?: Promise<unknown> } | null} */ (this.renderRoot.querySelector('gf-nearby-places'));
      offer?.updateComplete?.then(() => offer.focus());
    }
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
        ${nameOf(p)}${p.d !== undefined ? html` <small>· ${Math.round(p.d)} m</small>` : nothing}
      </button>`)}</div>`;
  }

  /**
   * The warning before the harvest (gf-harvest-warning, the place editor's too): noted without the harvest (the choice
   * offered first), or with it once « J’ai lu cet avertissement » is ticked; Annuler, back to the list.
   */
  #warning() {
    const c = /** @type {NonNullable<GfCapture['_confirm']>} */ (this._confirm);
    return html`<gf-harvest-warning .plant=${c.plant} .verdict=${c.verdict} ?busy=${this._busy}
      @harvest-choice=${(/** @type {CustomEvent} */ e) => { if (e.detail.choice) this.#capture(c.plant, { harvest: e.detail.choice === 'harvest' }); else this._confirm = null; }}></gf-harvest-warning>`;
  }

  /**
   * The lieux near (gf-nearby-places, as a new lieu's editor offers them): « Y ajouter » one, or « Nouveau lieu ici »;
   * « Annuler », back to the list — nothing saved until then.
   */
  #whereView() {
    const w = /** @type {NonNullable<GfCapture['_where']>} */ (this._where);
    return html`<gf-nearby-places mode="note" .rows=${w.near} .plant=${{ id: w.plant.id, name: nameOf(w.plant) }} ?disabled=${this._busy}
        @nearby-pick=${(/** @type {CustomEvent} */ e) => this.#capture(w.plant, { harvest: w.harvest, into: e.detail.id })}></gf-nearby-places>
      <div class="where">
        <button class="primary" type="button" ?disabled=${this._busy} @click=${() => this.#capture(w.plant, { harvest: w.harvest, into: null })}>Nouveau lieu ici</button>
        <button class="link" type="button" ?disabled=${this._busy} @click=${this.#leaveOffer}>Annuler</button>
      </div>`;
  }

  /** The plant chosen (open({ plant })): its photo and names, and « Noter ici » — or « Autre plante », the list. */
  #chosenView() {
    const p = this._chosen;
    const name = p.vernacularNames?.[0] ?? p.vernacularName ?? p.scientificName;
    return html`<div class="chosen">
        <gf-thumb .plant=${p} size="48" round></gf-thumb>
        <span><strong>${name}</strong>${name !== p.scientificName ? html`<br /><i>${p.scientificName}</i>` : nothing}</span>
      </div>
      <p class="muted">Elle sera notée à votre position : dans un lieu à moins de ${NEAR_PLACE} m si vous le choisissez, sinon dans un nouveau lieu.</p>
      <div class="where">
        <button class="primary" type="button" ?disabled=${!this._fix || this._busy} @click=${() => this.#capture(p)}>Noter ici</button>
        <button type="button" ?disabled=${this._busy} @click=${this.#otherPlant}>Autre plante</button>
      </div>`;
  }

  /** « Autre plante »: the list, the search field focused. */
  async #otherPlant() {
    this._chosen = null;
    await this.updateComplete;
    /** @type {HTMLInputElement | null} */ (this.renderRoot.querySelector('.ask input'))?.focus();
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
      <dialog aria-label="Noter une plante ici" @close=${this.#onClosed} @keydown=${this.#keepKeys}
        @click=${e => { if (e.target === e.currentTarget) this.#close(); }}>
        <header>
          <h2>Noter ici</h2>
          <div class="gps" role="status">${this.#gps()}</div>
          ${this._chosen ? nothing : html`<div class="ask">
            <input type="search" placeholder="Quelle plante ?" aria-label="Chercher une plante" autocomplete="off"
              style="padding-right:${12 + 34 * (Number(Boolean(this._query)) + Number(voiceAvailable()))}px"
              .value=${this._query} @input=${this.#search} />
            <span class="tools">
              ${this._query ? html`<button class="clear" type="button" aria-label="Effacer la recherche" title="Effacer"
                @mousedown=${e => e.preventDefault()} @click=${this.#clear}>${icon('x-lg')}</button>` : nothing}
              <gf-voice-button @voice-text=${e => this.#find(e.detail.text)}></gf-voice-button>
            </span>
          </div>`}
        </header>
        <div class="body">
          ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
          ${this._confirm ? this.#warning() : this._where ? this.#whereView() : this._chosen ? this.#chosenView() : this._query.trim().length >= 2 ? html`<gf-plant-pick-list .query=${this._query} ?disabled=${!this._fix || this._busy}
              @plant-pick=${e => this.#capture(e.detail.plant)}></gf-plant-pick-list>`
            : html`
              ${this.#chips('Autour de vous', around)}
              ${this.#chips('Favoris', favorites)}
              ${this.#chips('Récemment notées', recent)}
              ${!around.length && !favorites.length && !recent.length
                ? html`<p class="muted">Tapez le nom de la plante. Elle sera notée à votre position : dans un lieu à moins de ${NEAR_PLACE} m si vous le choisissez, sinon dans un nouveau lieu.</p>`
                : nothing}`}
        </div>
        <footer>
          ${harvestMode ? html`<label><input type="checkbox" .checked=${this._harvestToday} ?disabled=${Boolean(this._confirm || this._where)}
            @change=${e => { this._harvestToday = e.target.checked; }} /> Noter aussi une récolte aujourd’hui</label>` : html`<span style="flex:1"></span>`}
          <button type="button" @click=${() => this.#close()}>Fermer</button>
        </footer>
      </dialog>
      ${t ? html`<div class="toast" role="status">
        ${t.warning ? html`<div class="warn" role="alert">${icon('exclamation-triangle-fill')} ${t.warning} — <a href=${href.plant(/** @type {any} */ (t).plantId)}>voir la fiche</a></div>` : nothing}
        ${t.lookalike ? html`<div class="warn lookalike" role="alert">${icon(t.lookalike.toxic ? 'exclamation-octagon-fill' : 'exclamation-triangle-fill')} ${t.lookalike.text} — <a href=${href.plant(/** @type {any} */ (t).plantId)}>${t.lookalike.unread ? 'voir la fiche' : 'comment les distinguer'}</a>
          <span class="sos-line">${emergency()}.</span></div>` : nothing}
        <div class="row"><span>${t.text}</span>
          <button class="link" type="button" @click=${this.#undo}>Annuler</button>
          <a class="link" href=${t.details} @click=${() => { this._toast = null; }}>Détails</a>
        </div>
      </div>` : nothing}
    `;
  }
}

customElements.define('gf-capture', GfCapture);
