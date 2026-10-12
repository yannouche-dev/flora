// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { StoreController } from '../core/store.js';
import { MIC_BLOCKED, askMicrophone, listen, voiceAvailable, voiceError, voiceSupported } from '../core/voice.js';
import { moduleOn } from '../core/modules.js';
import { icon } from '../core/icons.js';

/**
 * 🎙 Dictate a search, with the system's speech input (Android's, iOS's — through the browser's speech
 * recognition). Hidden when « Dictée vocale » is off (Réglages › Modules), or when the browser can't — except
 * `fallback`: shown even so — a touch says how to dictate with the keyboard's own microphone (the keyboard is
 * not opened by the button).
 * `size="large"`: a big round button, made for a thumb (the Parcours botanique).
 * The first touch asks the browser for the microphone (its own prompt); refused, the button says where to allow it.
 * Events: voice-text {text, final} (interim results, then the final one), voice-state {state: 'idle' |
 * 'starting' | 'listening'}. A second tap stops.
 */
export class GfVoiceButton extends LitElement {
  static properties = {
    size: { reflect: true },
    fallback: { type: Boolean },
    _state: { state: true },
    _note: { state: true }
  };

  static styles = css`
    :host { display: inline-flex; position: relative; flex: none; }
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
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      transition: transform 0.08s ease-out, background 0.15s, color 0.15s;
    }
    button:hover { background: var(--gf-surface-2); color: var(--gf-text); }
    button:active { transform: scale(0.9); }
    button:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    button.starting { background: color-mix(in srgb, var(--gf-danger, #dc2626) 70%, transparent); color: #fff; }
    button.listening { background: var(--gf-danger, #dc2626); color: #fff; animation: pulse 1.1s ease-in-out infinite; }
    @keyframes pulse { 50% { box-shadow: 0 0 0 7px color-mix(in srgb, #dc2626 28%, transparent); } }
    svg { width: 18px; height: 18px; flex: none; }

    /* Large: a thumb's button, always visible — the accent, filled. */
    :host([size='large']) button { width: 52px; height: 52px; background: var(--gf-accent); color: var(--gf-accent-contrast, #fff);
      box-shadow: 0 3px 10px color-mix(in srgb, var(--gf-accent) 40%, transparent); }
    :host([size='large']) button:hover { background: color-mix(in srgb, var(--gf-accent) 88%, #000); color: var(--gf-accent-contrast, #fff); }
    :host([size='large']) button.starting { background: color-mix(in srgb, var(--gf-danger, #dc2626) 75%, var(--gf-accent)); }
    :host([size='large']) button.listening { background: var(--gf-danger, #dc2626); animation: pulse-large 1.1s ease-in-out infinite; }
    @keyframes pulse-large { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, #dc2626 45%, transparent); } 50% { box-shadow: 0 0 0 12px color-mix(in srgb, #dc2626 0%, transparent); } }
    :host([size='large']) svg { width: 26px; height: 26px; }
    @media (prefers-reduced-motion: reduce) { button.listening, :host([size='large']) button.listening { animation: none; } button:active { transform: none; } }

    .note {
      position: absolute;
      right: 0;
      top: calc(100% + 6px);
      z-index: 20;
      width: max-content;
      max-width: min(280px, 80vw);
      font-size: 0.8rem;
      padding: 6px 10px;
      border-radius: var(--gf-radius-sm);
      background: var(--gf-surface);
      color: var(--gf-text);
      box-shadow: var(--gf-shadow-float);
    }
    /* At the bottom of the screen (large): the note above the button. */
    :host([size='large']) .note { top: auto; bottom: calc(100% + 10px); }
  `;

  #store = new StoreController(this);
  /** @type {(() => void) | null} */ #stop = null;
  #asking = false;

  constructor() {
    super();
    /** @type {string | null} */
    this.size = null;
    this.fallback = false;
    /** @type {'idle' | 'starting' | 'listening'} */
    this._state = 'idle';
    /** @type {string | null} */
    this._note = null;
  }

  /** @param {'idle' | 'starting' | 'listening'} state */
  #set(state) {
    this._state = state;
    this.dispatchEvent(new CustomEvent('voice-state', { detail: { state }, bubbles: true, composed: true }));
  }

  /** @type {any} */ #noteTimer = 0;
  /** @param {string | null} text @param {number} [ms] */
  #say(text, ms = 2800) {
    clearTimeout(this.#noteTimer);
    this._note = text;
    if (text) this.#noteTimer = setTimeout(() => { this._note = null; }, ms);
  }

  async #toggle() {
    if (this.#stop) { this.#stop(); return; }
    // The browser is asking for the microphone: its answer comes first.
    if (this.#asking) return;
    // No speech recognition in this browser: the keyboard's own microphone does it.
    if (!voiceSupported()) {
      this.#say('Pas de dictée dans ce navigateur : touchez le champ, puis le micro du clavier', 4500);
      return;
    }
    this.#say(null);
    // At once: the button says it heard the touch, before the microphone opens.
    this.#set('starting');
    if (matchMedia('(pointer: coarse)').matches) navigator.vibrate?.(12);
    // The browser asked for the microphone (its prompt), unless already allowed.
    this.#asking = true;
    const mic = await askMicrophone().finally(() => { this.#asking = false; });
    if (!this.isConnected) { this.#set('idle'); return; }
    if (mic === 'denied' || mic === 'none') {
      this.#set('idle');
      this.#say(mic === 'none' ? 'Aucun micro trouvé sur cet appareil.' : MIC_BLOCKED, 7000);
      return;
    }
    this.#stop = listen(
      (text, final) => this.dispatchEvent(new CustomEvent('voice-text', { detail: { text, final }, bubbles: true, composed: true })),
      error => {
        this.#stop = null;
        this.#set('idle');
        this.#say(voiceError(error));
      },
      () => this.#set('listening'));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#stop?.();
    clearTimeout(this.#noteTimer);
  }

  /** Shown: dictation on and possible here — or, with `fallback`, on (the keyboard's mic then). */
  get #shown() { return this.fallback ? moduleOn('voice') : voiceAvailable(); }

  updated() { this.toggleAttribute('hidden', !this.#shown); }

  render() {
    void this.#store.state.modules;
    if (!this.#shown) return nothing;
    const on = this._state !== 'idle';
    const label = this._state === 'listening' ? 'J’écoute… (toucher pour arrêter)' : this._state === 'starting' ? 'Ouverture du micro…' : 'Dicter le nom';
    return html`
      <button type="button" class=${this._state} aria-pressed=${on ? 'true' : 'false'} aria-label=${label} title=${label}
        @mousedown=${(/** @type {Event} */ e) => e.preventDefault()} @click=${this.#toggle}>
        ${icon(on ? 'mic-fill' : 'mic')}
      </button>
      ${this._note ? html`<span class="note" role="status">${this._note}</span>` : nothing}`;
  }
}

customElements.define('gf-voice-button', GfVoiceButton);
