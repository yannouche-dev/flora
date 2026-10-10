// @ts-check
// The film icon of the header: the scenarios of the app (core/scenarios.js), in cards — what each one does,
// « Jouer »; those to come, « Bientôt ».

import { LitElement, html, css, nothing } from 'lit';
import { icon } from '../core/icons.js';
import { openModal } from '../core/history.js';
import { SCENARIOS } from '../core/scenarios.js';
import { ui } from '../styles/ui.js';

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
    .head p { margin: 0; }
    .intro { margin: 0 18px 10px; color: var(--gf-text-muted); font-size: 0.9rem; }
    ul { list-style: none; margin: 0; padding: 4px 14px 18px; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); gap: 10px; }
    li { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; align-items: start; padding: 14px; border: 1px solid var(--gf-border); border-radius: 14px; }
    li .ic { grid-row: span 3; width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; font-size: 1.3rem; background: var(--gf-accent-soft); color: var(--gf-accent); }
    li b { font-size: 1rem; }
    li p { margin: 0; font-size: 0.86rem; color: var(--gf-text-muted); }
    li button { justify-self: start; margin-top: 6px; }
    li.soon { opacity: 0.55; }
    li.soon .ic { background: var(--gf-surface-2); color: var(--gf-text-muted); }
    .tag { justify-self: start; margin-top: 6px; padding: 2px 10px; border-radius: var(--gf-radius-pill); background: var(--gf-surface-2); font-size: 0.75rem; font-weight: 600; }
  `];

  get #dialog() { return /** @type {HTMLDialogElement | null} */ (this.renderRoot.querySelector('dialog')); }

  render() {
    return html`<button class="open" type="button" title="Scénarios : des façons de découvrir la flore" aria-label="Scénarios"
        @click=${() => openModal(this.#dialog)}>${icon('camera-reels')}</button>
      <dialog aria-label="Scénarios" @click=${(/** @type {Event} */ e) => { if (e.target === e.currentTarget) this.#dialog?.close(); }}>
        <div class="head">${icon('camera-reels')}<h2>Scénarios</h2>
          <button class="icon-btn" type="button" aria-label="Fermer" @click=${() => this.#dialog?.close()}>${icon('x-lg')}</button></div>
        <p class="intro">Des façons de découvrir la flore, chacune avec les outils qu’il lui faut. On peut en changer quand on veut.</p>
        <ul>${SCENARIOS.map(s => html`<li class=${s.soon ? 'soon' : ''}>
          <span class="ic" aria-hidden="true">${icon(s.icon)}</span>
          <b>${s.title}</b>
          <p>${s.pitch}</p>
          ${s.soon ? html`<span class="tag">Bientôt</span>` : html`<button class="primary" type="button" @click=${() => { s.play?.(); this.#dialog?.close(); }}>Jouer</button>`}
        </li>`)}</ul>
      </dialog>`;
  }
}

customElements.define('gf-scenarios', GfScenarios);
