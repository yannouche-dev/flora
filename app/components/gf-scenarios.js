// @ts-check
// The film icon of the header (and of a mini-app's bar): the launcher. Its dialog holds the list of the ways to play
// (gf-launcher, the same list as the Découvrir tab's page): the mini-apps. A mini-app is played again from its own ⋯.

import { LitElement, html, css } from 'lit';
import { icon } from '../core/icons.js';
import { openModal } from '../core/history.js';
import { ui } from '../styles/ui.js';
import './gf-launcher.js';

export class GfScenarios extends LitElement {
  static styles = [ui, css`
    :host { display: inline-flex; flex: none; }
    .open { width: 38px; height: 38px; min-height: 0; padding: 0; display: grid; place-items: center; border: 0; border-radius: 50%; background: none;
      color: var(--gf-text-muted); font-size: 1.3rem; cursor: pointer; }
    .open:hover { color: var(--gf-accent); background: var(--gf-surface-2); }
    .open:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    dialog { width: min(640px, calc(100vw - 24px)); max-height: calc(100dvh - 40px); padding: 0; border: 0; border-radius: 18px; background: var(--gf-surface); color: var(--gf-text);
      box-shadow: var(--gf-shadow-float); }
    dialog::backdrop { background: rgb(0 0 0 / 45%); }
    .head { display: flex; align-items: center; gap: 10px; padding: 16px 18px 8px; }
    .head h2 { margin: 0; flex: 1; font-size: 1.25rem; }
    .intro { margin: 0 18px 10px; color: var(--gf-text-muted); font-size: 0.9rem; }
    gf-launcher { padding: 4px 14px 18px; }
  `];

  get #dialog() { return /** @type {HTMLDialogElement | null} */ (this.renderRoot.querySelector('dialog')); }

  /** The scenarios, shown (also from elsewhere: « Quitter … : autres scénarios »), as they are now. */
  async open() {
    const list = /** @type {import('./gf-launcher.js').GfLauncher | null} */ (this.renderRoot.querySelector('gf-launcher'));
    list?.requestUpdate();
    await list?.updateComplete;
    openModal(this.#dialog);
  }

  render() {
    return html`<button class="open" type="button" title="Scénarios : des façons de découvrir la flore" aria-label="Scénarios"
        @click=${() => this.open()}>${icon('camera-reels')}</button>
      <dialog aria-label="Scénarios" @click=${(/** @type {Event} */ e) => { if (e.target === e.currentTarget) this.#dialog?.close(); }}>
        <div class="head">${icon('camera-reels')}<h2>Scénarios</h2>
          <button class="icon-btn" type="button" aria-label="Fermer" @click=${() => this.#dialog?.close()}>${icon('x-lg')}</button></div>
        <p class="intro">Des façons de découvrir la flore, chacune avec les outils qu’il lui faut. On peut en changer quand on veut.</p>
        <gf-launcher @launched=${() => this.#dialog?.close()}></gf-launcher>
      </dialog>`;
  }
}

customElements.define('gf-scenarios', GfScenarios);
