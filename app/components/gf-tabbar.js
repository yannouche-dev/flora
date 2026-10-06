// @ts-check
import { LitElement, html, css } from 'lit';
import { lastSearchHash } from '../core/query.js';
import { href } from '../core/router.js';

/**
 * Mobile bottom navigation: Flore · Mes plantes · [+ Noter ici] · Carte · Plus.
 * The centre button fires `open-capture` (handled by gf-app).
 */
export class GfTabbar extends LitElement {
  static properties = {
    current: {}
  };

  static styles = css`
    :host {
      display: block;
      background: var(--gf-surface);
      border-top: 1px solid var(--gf-border);
      padding-bottom: env(safe-area-inset-bottom);
    }
    nav { display: grid; grid-template-columns: repeat(5, 1fr); align-items: end; height: 60px; }
    a, button {
      display: grid;
      justify-items: center;
      gap: 2px;
      padding: 6px 2px 8px;
      font: inherit;
      font-size: 0.7rem;
      color: var(--gf-text-muted);
      text-decoration: none;
      background: none;
      border: 0;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .icon { font-size: 1.25rem; line-height: 1; }
    a[aria-current='page'] { color: var(--gf-accent); font-weight: 600; }
    .capture { align-self: center; }
    .capture .icon {
      width: 52px;
      height: 52px;
      margin-top: -22px;
      border-radius: 50%;
      background: var(--gf-accent);
      color: var(--gf-accent-contrast);
      display: grid;
      place-items: center;
      font-size: 1.8rem;
      box-shadow: 0 3px 10px rgb(0 0 0 / 30%);
      border: 3px solid var(--gf-surface);
    }
    .capture span:last-child { color: var(--gf-accent); font-weight: 600; }
  `;

  constructor() {
    super();
    /** 'flore' | 'mine' | 'map' | 'more' */
    this.current = 'flore';
  }

  render() {
    const tab = (/** @type {string} */ id, /** @type {string} */ link, /** @type {string} */ icon, /** @type {string} */ label) => html`
      <a href=${link} aria-current=${this.current === id ? 'page' : 'false'}><span class="icon" aria-hidden="true">${icon}</span><span>${label}</span></a>`;
    return html`
      <nav aria-label="Navigation principale">
        ${tab('flore', lastSearchHash(), '🔍', 'Flore')}
        ${tab('mine', href.collections(), '♥', 'Mes plantes')}
        <button class="capture" type="button" aria-label="Noter une plante ici"
          @click=${() => this.dispatchEvent(new CustomEvent('open-capture', { bubbles: true, composed: true }))}>
          <span class="icon" aria-hidden="true">+</span><span>Noter ici</span>
        </button>
        ${tab('map', href.map(), '🗺', 'Carte')}
        ${tab('more', href.settings(), '⋯', 'Plus')}
      </nav>
    `;
  }
}

customElements.define('gf-tabbar', GfTabbar);
