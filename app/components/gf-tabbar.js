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
    .icon { font-size: 1.25rem; line-height: 1; display: grid; place-items: center; width: 56px; height: 30px; border-radius: var(--gf-radius-pill); transition: background 0.15s; }
    /* The current tab: its icon filled, on a pill, the label in the accent colour. */
    a[aria-current='page'] { color: var(--gf-accent); font-weight: 600; }
    a[aria-current='page'] .icon { background: var(--gf-accent-soft); }
    @media (prefers-reduced-motion: reduce) { .icon { transition: none; } }
    a:focus-visible { outline: none; box-shadow: var(--gf-focus); border-radius: var(--gf-radius-sm); }
  `;

  constructor() {
    super();
    /** 'flore' | 'map' | 'mine' | 'more' */
    this.current = 'flore';
  }

  render() {
    /** @typedef {import('../core/icons.js').IconName} IconName */
    const tab = (/** @type {string} */ id, /** @type {string} */ link, /** @type {IconName} */ name, /** @type {IconName} */ active, /** @type {string} */ label) => {
      const current = this.current === id;
      return html`<a href=${link} aria-current=${current ? 'page' : 'false'}><span class="icon" aria-hidden="true">${icon(current ? active : name)}</span><span>${label}</span></a>`;
    };
    return html`
      <nav aria-label="Navigation principale">
        ${tab('flore', lastSearchHash(), 'leaf', 'leaf-fill', 'Flore')}
        ${tab('map', href.map(), 'map', 'map-fill', 'Carte')}
        ${tab('mine', href.collections(), 'collection', 'collection-fill', 'Mes collections')}
        ${tab('more', href.settings(), 'gear', 'gear-fill', 'Réglages')}
      </nav>
    `;
  }
}

customElements.define('gf-tabbar', GfTabbar);
