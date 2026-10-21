// @ts-check
// Before a harvest is noted — « Noter ici », a place's « Récolté aujourd’hui » and « Ajouter une récolte »: the warning
// for a plant our sources say is toxic, whose data could not be read, or that is protected where it is noted
// (core/danger.js#harvestStop). It says the plant's verdict (the same chip as on its sheet and its cards), each reason
// with its source and the part it names, what to do after eating it, and asks: noted without the harvest (the choice
// offered first), or with it once « J’ai lu cet avertissement » is ticked — or nothing (Annuler). A plant noted already
// (a place's, `noted`): nothing to note without the harvest, so Annuler is the choice offered first.
// Inline in « Noter ici »'s sheet (<gf-harvest-warning>, its `harvest-choice` event); a sheet of its own elsewhere
// (askHarvest: a promise of the choice) — never the browser's confirm(), whose OK would note the harvest.

import { LitElement, html, css, nothing } from 'lit';
import { verdictOf } from '../core/alerts.js';
import { harvestStop, reasonLine } from '../core/danger.js';
import { openModal } from '../core/history.js';
import { icon } from '../core/icons.js';
import { nameOf } from '../core/plants.js';
import { emergency } from '../core/poison.js';
import { ui } from '../styles/ui.js';
import { severityChip, severityStyles, sheetStyles } from './ui-kit.js';

/** @typedef {'harvest' | 'without' | null} HarvestChoice   null: Annuler (nothing noted); never 'without' for a plant `noted` */

/** The reasons that make the plant itself toxic, not only some of its parts. */
const WHOLE = new Set(['toxic-side', 'ansm-b']);

/**
 * The warning's title: what stops the harvest, then what to do. @param {import('../core/danger.js').Verdict} v
 */
function warningTitle(v) {
  const whole = v.reasons.some(r => WHOLE.has(r.kind) || (r.kind === 'tppt' && (r.level === 'danger' || r.level === 'deadly')));
  const heads = [whole ? 'Plante toxique' : v.toxic ? 'Parties toxiques' : v.unread ? 'Toxicité inconnue pour le moment' : null, v.protected ? 'Espèce protégée' : null]
    .filter(/** @returns {h is string} */ h => Boolean(h));
  const said = heads.map((h, i) => i ? h[0].toLowerCase() + h.slice(1) : h).join(', ');
  return `${said} : ${v.protected ? 'cueillette interdite' : 'récolte déconseillée'}`;
}

export class GfHarvestWarning extends LitElement {
  static properties = {
    plant: { attribute: false },
    /** The plant's verdict (core/alerts.js#verdictOf). */
    verdict: { attribute: false },
    /** In a sheet of its own (askHarvest); else inline, in « Noter ici »'s. */
    modal: { type: Boolean },
    /** The plant is noted already (the place editor): no « Noter sans récolte », Annuler first. */
    noted: { type: Boolean },
    /** The choice is being noted: the buttons wait. */
    busy: { type: Boolean },
    /** « J’ai lu cet avertissement », ticked by the user only. */
    _ack: { state: true }
  };

  static styles = [ui, sheetStyles, severityStyles, css`
    :host { display: block; }
    dialog.drawer { --drawer-w: 560px; }
    dialog.drawer .danger { margin: 0; border: 0; border-radius: inherit; overflow-y: auto; padding: 16px 16px calc(14px + env(safe-area-inset-bottom)); }
    .danger {
      margin-top: 8px;
      padding: 10px 12px;
      border: 1px solid var(--gf-danger);
      border-radius: var(--gf-radius);
      background: var(--gf-danger-bg);
      font-size: 0.9rem;
      line-height: 1.4;
    }
    h3 { margin: 0 0 6px; font-size: 1rem; color: var(--gf-danger); display: flex; gap: 6px; align-items: center; }
    p { margin: 6px 0; }
    .who { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    ul { margin: 4px 0; padding-left: 18px; }
    .sos a { color: inherit; }
    .ack { display: flex; gap: 8px; align-items: center; margin: 8px 0; }
    .choices { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  `];

  constructor() {
    super();
    /** @type {any} */
    this.plant = null;
    /** @type {import('../core/danger.js').Verdict | null} */
    this.verdict = null;
    this.modal = false;
    this.noted = false;
    this.busy = false;
    this._ack = false;
  }

  /** The choice made, said when the sheet closes (Échap, Retour, a touch outside: Annuler). @type {HarvestChoice} */
  #choice = null;

  /** @param {Map<string, unknown>} changed */
  willUpdate(changed) {
    // Never carried over: another plant's warning is read again.
    if (changed.has('plant') || changed.has('verdict')) this._ack = false;
  }

  firstUpdated() {
    if (!this.modal) return;
    const dialog = /** @type {HTMLDialogElement} */ (this.renderRoot.querySelector('dialog'));
    openModal(dialog);
  }

  /** @param {Map<string, unknown>} changed */
  updated(changed) {
    // A warning shown takes the focus, on the safe choice (in its own sheet, showModal's autofocus does it).
    if (!this.modal && this.verdict && (changed.has('verdict') || changed.has('plant'))) {
      /** @type {HTMLButtonElement | null} */ (this.renderRoot.querySelector('.choices .primary'))?.focus();
    }
  }

  /** @param {HarvestChoice} choice */
  #choose(choice) {
    if (this.modal) {
      this.#choice = choice;
      /** @type {HTMLDialogElement | null} */ (this.renderRoot.querySelector('dialog'))?.close();
      return;
    }
    this.#said(choice);
  }

  /** @param {HarvestChoice} choice */
  #said(choice) {
    this.dispatchEvent(new CustomEvent('harvest-choice', { detail: { choice }, bubbles: true, composed: true }));
  }

  #body() {
    const v = /** @type {import('../core/danger.js').Verdict} */ (this.verdict);
    const title = warningTitle(v);
    const inline = !this.modal;
    return html`<section class="danger" role=${inline ? 'alertdialog' : nothing} aria-labelledby=${inline ? 'harvest-warning' : nothing}
        aria-describedby=${inline ? 'harvest-reasons' : nothing}>
      <h3 id="harvest-warning">${icon('exclamation-octagon-fill')} ${title}</h3>
      <p class="who"><b>${nameOf(this.plant)}</b>${severityChip(v)}<span>— d’après nos sources :</span></p>
      <ul id="harvest-reasons">${v.reasons.map(r => html`<li>${reasonLine(r)}</li>`)}</ul>
      ${v.toxic || v.unread ? html`<p>Ne la consommez pas. ${emergency()}.</p>` : nothing}
      ${v.protected ? html`<p>Laissez-la où elle pousse : ${this.noted ? 'elle reste notée, sans récolte' : 'notez-la sans la cueillir'}.</p>` : nothing}
      <label class="ack"><input type="checkbox" .checked=${this._ack} @change=${(/** @type {Event} */ e) => { this._ack = /** @type {HTMLInputElement} */ (e.target).checked; }} />
        J’ai lu cet avertissement</label>
      <div class="choices">
        ${this.noted
          ? html`<button type="button" class="primary" ?autofocus=${this.modal} @click=${() => this.#choose(null)}>Annuler</button>`
          : html`<button type="button" class="primary" ?autofocus=${this.modal} ?disabled=${this.busy} @click=${() => this.#choose('without')}>Noter sans récolte</button>`}
        <button type="button" ?disabled=${!this._ack || this.busy} @click=${() => this.#choose('harvest')}>Noter la récolte quand même</button>
        ${this.noted ? nothing : html`<button type="button" class="link" @click=${() => this.#choose(null)}>Annuler</button>`}
      </div>
    </section>`;
  }

  render() {
    if (!this.verdict) return nothing;
    if (!this.modal) return this.#body();
    return html`<dialog class="drawer centered rises" role="alertdialog" aria-labelledby="harvest-warning" aria-describedby="harvest-reasons"
        @close=${() => this.#said(this.#choice)} @click=${(/** @type {Event} */ e) => { if (e.target === e.currentTarget) this.#choose(null); }}>${this.#body()}</dialog>`;
  }
}

customElements.define('gf-harvest-warning', GfHarvestWarning);

/**
 * Before a harvest of this plant is noted: its verdict at `at` (where it is noted), and when the harvest must be
 * answered (danger.js#harvestStop), the warning in a sheet of its own. 'harvest' at once when there is nothing to say.
 * `noted`: the plant is noted there already (a place's): its choices are Annuler (first) and the harvest.
 * @param {any} plant TAXREF record (with `statuses`) @param {{ at?: [number, number] | null, noted?: boolean }} [o]
 * @returns {Promise<HarvestChoice>}
 */
export async function askHarvest(plant, { at = null, noted = false } = {}) {
  const verdict = await verdictOf(plant, { at });
  if (!harvestStop(verdict)) return 'harvest';
  const el = /** @type {GfHarvestWarning} */ (document.createElement('gf-harvest-warning'));
  el.plant = plant;
  el.verdict = verdict;
  el.modal = true;
  el.noted = noted;
  return new Promise(resolve => {
    el.addEventListener('harvest-choice', e => { resolve(/** @type {CustomEvent} */ (e).detail.choice); el.remove(); }, { once: true });
    document.body.append(el);
  });
}
