// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { StoreController } from '../core/store.js';
import { listen, voiceAvailable, voiceError } from '../core/voice.js';

/**
 * 🎙 Dictate a search. Hidden when the browser can't, or when « Dictée vocale » is off (Réglages › Modules).
 * Events: voice-text {text, final} (interim results, then the final one). A second tap stops listening.
 */
export class GfVoiceButton extends LitElement {
  static properties = {
    _listening: { state: true },
    _note: { state: true }
  };

  static styles = css`
    :host { display: inline-flex; position: relative; }
    :host([hidden]) { display: none; }
    button {
      width: 32px;
      height: 32px;
      display: grid;
      place-items: center;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--gf-text-muted);
      cursor: pointer;
      padding: 0;
    }
    button:hover { background: var(--gf-surface-2); color: var(--gf-text); }
    button:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    button[aria-pressed='true'] { background: var(--gf-danger, #dc2626); color: #fff; animation: pulse 1.2s ease-in-out infinite; }
    @keyframes pulse { 50% { box-shadow: 0 0 0 6px color-mix(in srgb, #dc2626 25%, transparent); } }
    @media (prefers-reduced-motion: reduce) { button[aria-pressed='true'] { animation: none; } }
    svg { width: 18px; height: 18px; }
    .note {
      position: absolute;
      right: 0;
      top: calc(100% + 6px);
      z-index: 20;
      white-space: nowrap;
      font-size: 0.78rem;
      padding: 4px 8px;
      border-radius: var(--gf-radius-sm);
      background: var(--gf-surface);
      color: var(--gf-text);
      box-shadow: var(--gf-shadow-float);
    }
  `;

  #store = new StoreController(this);
  /** @type {(() => void) | null} */ #stop = null;

  constructor() {
    super();
    this._listening = false;
    /** @type {string | null} */
    this._note = null;
  }

  #toggle() {
    if (this.#stop) { this.#stop(); return; }
    this._note = null;
    this._listening = true;
    this.#stop = listen(
      (text, final) => this.dispatchEvent(new CustomEvent('voice-text', { detail: { text, final }, bubbles: true, composed: true })),
      error => {
        this.#stop = null;
        this._listening = false;
        this._note = voiceError(error);
        if (this._note) setTimeout(() => { this._note = null; }, 2500);
      });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#stop?.();
  }

  updated() { this.toggleAttribute('hidden', !voiceAvailable()); }

  render() {
    void this.#store.state.modules;
    if (!voiceAvailable()) return nothing;
    return html`
      <button type="button" aria-pressed=${this._listening ? 'true' : 'false'}
        aria-label=${this._listening ? 'Arrêter la dictée' : 'Chercher à la voix'} title=${this._listening ? 'Arrêter la dictée' : 'Chercher à la voix'}
        @mousedown=${(/** @type {Event} */ e) => e.preventDefault()} @click=${this.#toggle}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>
        </svg>
      </button>
      ${this._note ? html`<span class="note" role="status">${this._note}</span>` : nothing}`;
  }
}

customElements.define('gf-voice-button', GfVoiceButton);
