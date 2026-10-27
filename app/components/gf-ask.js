// @ts-check
// A question asked before the app does something the user may not want (« Revoir les premiers pas ? »…): a modal
// dialog (<dialog class="ask" role="alertdialog">, ui-kit's askStyles), its title, its text, « Annuler » first — with the
// focus — then the choices. Échap, a touch outside the box and Back are « Annuler » (core/history.js openModal: a step
// in history). Never the browser's confirm(), which a phone shows bare and an automated test answers by itself.
// ask() resolves with the value of the choice (null: Annuler), confirmAsk() with whether it was confirmed — once the
// dialog's step has left history (afterDialogSteps), so a caller may open another view at once. Added to the page's
// body while it asks (as askHarvest, gf-harvest-warning.js), removed once answered. Its texts go through fr() (French
// spacing).

import { LitElement, html, css } from 'lit';
import { fr } from '../core/fr.js';
import { afterDialogSteps, openModal } from '../core/history.js';
import { ui } from '../styles/ui.js';
import { askStyles } from './ui-kit.js';

/** A choice offered after « Annuler »: `primary` the action asked for, `danger` one that deletes. @typedef {{ value: string, label: string, primary?: boolean, danger?: boolean }} AskChoice */

export class GfAsk extends LitElement {
  static properties = {
    heading: { attribute: false },
    text: { attribute: false },
    choices: { attribute: false },
    cancel: { attribute: false }
  };

  static styles = [ui, askStyles, css`
    /* The box's padding inside it: a touch on the dialog itself is a touch on the backdrop, outside the box. */
    dialog.ask { padding: 0; }
    dialog.ask .box { padding: 20px; }
  `];

  constructor() {
    super();
    this.heading = '';
    this.text = '';
    /** @type {AskChoice[]} */
    this.choices = [];
    this.cancel = 'Annuler';
  }

  /** The choice made, said when the dialog closes (Échap, Back, a touch outside: null). @type {string | null} */
  #choice = null;

  firstUpdated() {
    openModal(/** @type {HTMLDialogElement} */ (this.renderRoot.querySelector('dialog')));
  }

  /** @param {string | null} value */
  #choose(value) {
    this.#choice = value;
    /** @type {HTMLDialogElement | null} */ (this.renderRoot.querySelector('dialog'))?.close();
  }

  render() {
    return html`<dialog class="ask" role="alertdialog" aria-labelledby="ask-title" aria-describedby="ask-text"
        @close=${() => this.dispatchEvent(new CustomEvent('ask-choice', { detail: { choice: this.#choice } }))}
        @click=${(/** @type {Event} */ e) => { if (e.target === e.currentTarget) this.#choose(null); }}>
      <div class="box">
        <h2 id="ask-title">${fr(this.heading)}</h2>
        <p id="ask-text">${fr(this.text)}</p>
        <div class="row">
          <button type="button" autofocus @click=${() => this.#choose(null)}>${fr(this.cancel)}</button>
          ${this.choices.map(c => html`<button type="button" class=${c.danger ? 'danger' : c.primary ? 'primary' : ''}
            @click=${() => this.#choose(c.value)}>${fr(c.label)}</button>`)}
        </div>
      </div>
    </dialog>`;
  }
}

customElements.define('gf-ask', GfAsk);

/**
 * Asks, in a modal dialog: resolves with the value of the choice made, or null (« Annuler », Échap, a touch outside,
 * Back), once the dialog's step has left history.
 * @param {{ title: string, text: string, choices: AskChoice[], cancel?: string }} q @returns {Promise<string | null>}
 */
export function ask({ title, text, choices, cancel = 'Annuler' }) {
  const el = /** @type {GfAsk} */ (document.createElement('gf-ask'));
  el.heading = title;
  el.text = text;
  el.choices = choices;
  el.cancel = cancel;
  return new Promise(resolve => {
    el.addEventListener('ask-choice', async e => {
      const { choice } = /** @type {CustomEvent} */ (e).detail;
      el.remove();
      await afterDialogSteps();
      resolve(choice);
    }, { once: true });
    document.body.append(el);
  });
}

/**
 * An action confirmed first: « Annuler » or `yes` (`danger`: it deletes). Resolves with whether it was confirmed.
 * @param {{ title: string, text: string, yes: string, danger?: boolean }} q @returns {Promise<boolean>}
 */
export async function confirmAsk({ title, text, yes, danger = false }) {
  return await ask({ title, text, choices: [{ value: 'yes', label: yes, primary: !danger, danger }] }) === 'yes';
}
