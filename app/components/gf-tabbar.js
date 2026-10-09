// @ts-check
import { LitElement, html, css } from 'lit';
import { lastSearchHash } from '../core/query.js';
import { href } from '../core/router.js';
import { icon } from '../core/icons.js';

/**
 * Mobile bottom navigation: Flore · Carte · Mes collections · Réglages. Noting a plant here lives in Mes
 * collections, on the map (+) and in a plant's Actions.
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
    nav { display: grid; grid-template-columns: repeat(4, 1fr); align-items: center; height: 60px; }
    a {
      display: grid;
      justify-items: center;
      gap: 2px;
      padding: 6px 2px 8px;
      font: inherit;
      font-size: 0.7rem;
      color: var(--gf-text-muted);
      text-decoration: none;
      -webkit-tap-highlight-color: transparent;
    }
    .icon { font-size: 1.25rem; line-height: 1; }
    a[aria-current='page'] { color: var(--gf-accent); font-weight: 600; }
    a:focus-visible { outline: none; box-shadow: var(--gf-focus); border-radius: var(--gf-radius-sm); }
  `;

  constructor() {
    super();
    /** 'flore' | 'map' | 'mine' | 'more' */
    this.current = 'flore';
  }

  render() {
    const tab = (/** @type {string} */ id, /** @type {string} */ link, /** @type {import('../core/icons.js').IconName} */ name, /** @type {string} */ label) => html`
      <a href=${link} aria-current=${this.current === id ? 'page' : 'false'}><span class="icon" aria-hidden="true">${icon(name)}</span><span>${label}</span></a>`;
    return html`
      <nav aria-label="Navigation principale">
        ${tab('flore', lastSearchHash(), 'leaf', 'Flore')}
        ${tab('map', href.map(), 'map', 'Carte')}
        ${tab('mine', href.collections(), 'collection', 'Mes collections')}
        ${tab('more', href.settings(), 'gear', 'Réglages')}
      </nav>
    `;
  }
}

customElements.define('gf-tabbar', GfTabbar);
