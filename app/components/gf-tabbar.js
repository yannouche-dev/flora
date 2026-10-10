// @ts-check
import { LitElement, html, css } from 'lit';
import { href } from '../core/router.js';
import { tabHref } from '../core/context.js';
import { StoreController } from '../core/store.js';
import { icon } from '../core/icons.js';
import { discoverEvents, tabShown } from '../core/discover.js';

/**
 * Mobile bottom navigation: Découvrir · Flore · Carte · Mes collections · Réglages — during the first steps,
 * only the tabs already met (discover.js). Noting a plant here lives in Mes
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
    nav { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; align-items: center; height: 60px; }
    a.new .icon { animation: arrive 1.2s ease-out 2; }
    @keyframes arrive { 30% { background: #fdf3c4; transform: scale(1.15); } }
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
    @media (prefers-reduced-motion: reduce) { .icon { transition: none; } a.new .icon { animation: none; } }
    a:focus-visible { outline: none; box-shadow: var(--gf-focus); border-radius: var(--gf-radius-sm); }
  `;

  // Tabs lead back to where each part was left (context.js), which changes as the user moves.
  #store = new StoreController(this);

  constructor() {
    super();
    /** 'discover' | 'flore' | 'map' | 'mine' | 'more' */
    this.current = 'flore';
  }

  /** The tab that just came, for a moment. @type {string | null} */
  #fresh = null;
  #onChange = () => this.requestUpdate();
  #onUnlock = (/** @type {Event} */ e) => { this.#fresh = /** @type {CustomEvent} */ (e).detail; this.requestUpdate(); setTimeout(() => { this.#fresh = null; this.requestUpdate(); }, 4000); };

  connectedCallback() {
    super.connectedCallback();
    discoverEvents.addEventListener('change', this.#onChange);
    discoverEvents.addEventListener('unlock', this.#onUnlock);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    discoverEvents.removeEventListener('change', this.#onChange);
    discoverEvents.removeEventListener('unlock', this.#onUnlock);
  }

  render() {
    /** @typedef {import('../core/icons.js').IconName} IconName */
    const tab = (/** @type {string} */ id, /** @type {string} */ link, /** @type {IconName} */ name, /** @type {IconName} */ active, /** @type {string} */ label) => {
      if (!tabShown(id)) return '';
      const current = this.current === id;
      return html`<a class=${this.#fresh === id ? 'new' : ''} href=${link} aria-current=${current ? 'page' : 'false'}><span class="icon" aria-hidden="true">${icon(current ? active : name)}</span><span>${label}</span></a>`;
    };
    return html`
      <nav aria-label="Navigation principale">
        ${tab('discover', href.discover(), 'binoculars', 'binoculars-fill', 'Découvrir')}
        ${tab('flore', tabHref('flore', this.current === 'flore'), 'leaf', 'leaf-fill', 'Flore')}
        ${tab('map', tabHref('map', this.current === 'map'), 'map', 'map-fill', 'Carte')}
        ${tab('mine', tabHref('mine', this.current === 'mine'), 'collection', 'collection-fill', 'Mes plantes')}
        ${tab('more', href.settings(), 'gear', 'gear-fill', 'Réglages')}
      </nav>
    `;
  }
}

customElements.define('gf-tabbar', GfTabbar);
