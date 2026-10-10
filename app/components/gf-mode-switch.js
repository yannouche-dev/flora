// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { modeIcon } from '../core/icons.js';
import { StoreController } from '../core/store.js';
import { ui } from '../styles/ui.js';
import { icon } from '../core/icons.js';

/**
 * One icon button per display mode: Épuré · Standard · Scientifique, then the modes made from them. For the app-wide mode, or for one surface (grid,
 * plant sheet) that may override it: then a dot marks the override and ↺ goes back to the app mode.
 * Fires `mode-change` with `{ mode }` (null: follow the app mode).
 */
export class GfModeSwitch extends LitElement {
  static properties = {
    value: {},
    /** Set for a surface overriding the app mode. */
    overridden: { type: Boolean },
    /** What the switch applies to, for the labels (« la grille », « la fiche »). */
    scope: {}
  };

  static styles = [ui, css`
    :host { display: inline-flex; align-items: center; gap: 4px; }
    .segmented > button { min-height: 30px; padding: 3px 9px; display: inline-grid; place-items: center; color: var(--gf-text-muted); }
    .segmented > button[aria-pressed='true'] { color: var(--gf-accent-contrast); }
    .segmented > button svg { display: block; width: 17px; height: 17px; }
    .reset { position: relative; width: 26px; height: 26px; font-size: 0.95rem; color: var(--gf-accent); }
    .reset::after {
      content: '';
      position: absolute;
      top: 2px;
      right: 2px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--gf-accent);
    }
  `];

  constructor() {
    super();
    this.value = 'standard';
    this.overridden = false;
    this.scope = '';
  }

  #store = new StoreController(this);

  /** @param {string | null} mode */
  #emit(mode) {
    this.dispatchEvent(new CustomEvent('mode-change', { detail: { mode }, bubbles: true, composed: true }));
  }

  render() {
    const where = this.scope ? ' — ' + this.scope : '';
    return html`
      <div class="segmented" role="group" aria-label=${'Affichage' + where}>
        ${this.#store.state.modes.map(({ key: mode, label }) => html`<button type="button" aria-pressed=${this.value === mode ? 'true' : 'false'}
          title=${label + where} aria-label=${label + where}
          @click=${() => this.#emit(mode)}>${modeIcon(mode)}</button>`)}
      </div>
      ${this.overridden ? html`<button class="reset icon-btn" type="button" title="Revenir au mode de l’application"
        aria-label="Revenir au mode de l’application" @click=${() => this.#emit(null)}>${icon('arrow-counterclockwise')}</button>` : nothing}
    `;
  }
}

customElements.define('gf-mode-switch', GfModeSwitch);
