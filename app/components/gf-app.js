// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { lastSearchHash } from '../core/query.js';
import { MediaController, PHONE_QUERY } from '../core/media.js';
import { href, RouterController } from '../core/router.js';
import { setKingMode, setMode, StoreController } from '../core/store.js';
import './gf-flora.js';
import './gf-settings.js';
import './gf-map-page.js';
import './gf-spot-editor.js';
import './gf-collections.js';
import './gf-shared.js';
import './gf-capture.js';
import './gf-tabbar.js';
import './gf-mode-switch.js';
import { ui } from '../styles/ui.js';
import { icon } from '../core/icons.js';

/** @param {string} name */
const tabOf = name => name === 'map' ? 'map'
  : ['collections', 'spot', 'spot-new', 'shared'].includes(name) ? 'mine'
  : name === 'settings' ? 'more' : 'flore';

/** App shell: header + route outlet + (phone) bottom tab bar. */
export class GfApp extends LitElement {
  static styles = [ui, css`
    :host {
      display: grid;
      grid-template-rows: auto 1fr auto;
      height: 100%;
    }
    header {
      display: flex;
      align-items: center;
      gap: var(--gf-gap);
      padding: 8px 16px;
      background: var(--gf-surface);
      border-bottom: 1px solid var(--gf-border);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      color: var(--gf-accent);
      text-decoration: none;
      white-space: nowrap;
    }
    .brand img { width: 28px; height: 28px; }
    nav.tabs { flex: none; }
    nav.tabs a { color: var(--gf-text); text-decoration: none; white-space: nowrap; display: inline-flex; align-items: center; }
    .note, .mode { flex: none; }
    gf-map-page, gf-spot-editor, gf-collections, gf-shared, gf-flora { flex: 1; min-height: 0; }
    nav.tabs { margin-left: auto; }
    .settings {
      flex: none;
      color: var(--gf-text-muted);
      text-decoration: none;
      font-size: 1.3rem;
      line-height: 1;
      padding: 4px;
    }
    main { min-height: 0; display: flex; flex-direction: column; }
    gf-settings { flex: 1; min-height: 0; }
    .banner {
      padding: 8px 16px;
      font-size: 0.875rem;
      background: var(--gf-accent-soft);
    }
    .banner.error { color: var(--gf-danger); }

    /* « Mode King »: the crown, bottom centre, above the tab bar on a phone; touching it leaves the mode. */
    .king {
      position: fixed;
      /* Above the phone plant sheet (900); dialogs still cover it. */
      z-index: 1000;
      left: 50%;
      bottom: calc(16px + env(safe-area-inset-bottom, 0px));
      transform: translateX(-50%);
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 44px;
      padding: 8px 18px 8px 14px;
      border: 2px solid #d4a017;
      border-radius: var(--gf-radius-pill);
      background: #2b2410;
      color: #f5c518;
      font: inherit;
      font-weight: 700;
      white-space: nowrap;
      cursor: pointer;
      box-shadow: 0 6px 20px rgb(0 0 0 / 0.35), 0 0 0 0 rgb(212 160 23 / 0.6);
      animation: king 2s ease-in-out infinite;
    }
    .king svg { font-size: 1.35rem; }
    .king small { font-weight: 400; color: #e8d9a8; }
    .king:hover { background: #3a3014; }
    .king:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    :host([phone]) .king { bottom: calc(74px + env(safe-area-inset-bottom, 0px)); }
    /* A plant sheet has its action bar there: the crown goes above it. */
    :host([phone][plant]) .king { bottom: calc(134px + env(safe-area-inset-bottom, 0px)); }
    @keyframes king { 50% { box-shadow: 0 6px 20px rgb(0 0 0 / 0.35), 0 0 0 8px rgb(212 160 23 / 0); } }
    @media (prefers-reduced-motion: reduce) { .king { animation: none; } }

    @media (max-width: 560px) {
      .brand span { display: none; }
      header { gap: 8px; padding: 8px 10px; }
      nav.tabs a { padding: 4px 10px; }
    }
  `];

  #router = new RouterController(this);
  #store = new StoreController(this);
  #phone = new MediaController(this, PHONE_QUERY);

  constructor() {
    super();
    this.addEventListener('open-capture', () => /** @type {any} */ (this.renderRoot.querySelector('gf-capture'))?.open());
  }

  render() {
    const route = this.#router.route;
    const { status, statusText, offline, updateReady } = this.#store.state;
    const phone = this.#phone.matches;

    return html`
      <header>
        <a class="brand" href=${href.search()}>
          <img src="assets/icons/icon.svg" alt="" />
          <span>GeoFlora</span>
        </a>
        ${phone ? nothing : html`<nav class="tabs segmented" aria-label="Sections">
          <a href=${lastSearchHash()} aria-current=${route.name === 'search' || route.name === 'plant' ? 'page' : 'false'}>Flore</a>
          <a href=${href.collections()} aria-current=${['collections', 'spot', 'spot-new', 'shared'].includes(route.name) ? 'page' : 'false'}>Mes plantes</a>
          <a href=${href.map()} aria-current=${route.name === 'map' ? 'page' : 'false'}>Carte</a>
        </nav>
        <gf-mode-switch class="mode" scope="toute l’application" value=${this.#store.state.mode}
          @mode-change=${e => setMode(e.detail.mode || 'standard')}></gf-mode-switch>
        <button class="note primary" type="button" @click=${() => /** @type {any} */ (this.renderRoot.querySelector('gf-capture'))?.open()}>${icon('plus-lg')} Noter ici</button>
        <a class="settings" href=${href.settings()} title="À propos et réglages" aria-label="À propos et réglages">${icon('gear')}</a>`}
      </header>
      <main>
        ${updateReady ? html`<div class="banner" role="status">Nouvelle version de GeoFlora disponible.
          <button class="link" type="button" @click=${() => location.reload()}>Recharger</button></div>` : nothing}
        ${status === 'loading' ? html`<div class="banner" role="status">${statusText || 'Chargement…'}</div>` : nothing}
        ${status === 'error' ? html`<div class="banner error" role="alert">${statusText}
          <button class="link" type="button" @click=${() => location.reload()}>Recharger</button></div>` : nothing}
        ${offline && status === 'ready' && route.name === 'search' ? html`<div class="banner">Hors ligne — recherche sur la copie locale.</div>` : nothing}
        ${this.#outlet(route)}
      </main>
      ${phone ? html`<gf-tabbar current=${tabOf(route.name)}></gf-tabbar>` : html`<span></span>`}
      <gf-capture></gf-capture>
      ${this.#store.state.kingMode ? html`<button class="king" type="button" aria-pressed="true" aria-label="Quitter le mode King"
        title="Mode King actif : touchez pour quitter" @click=${() => setKingMode(false)}>${icon('crown')} Mode King <small>· quitter</small></button>` : nothing}
    `;
  }

  updated() {
    this.toggleAttribute('phone', this.#phone.matches);
    this.toggleAttribute('plant', this.#router.route.name === 'plant');
  }

  /** @param {import('../core/router.js').Route} route */
  #outlet(route) {
    switch (route.name) {
      case 'search':
      case 'plant':
        return html`<gf-flora .route=${route}></gf-flora>`;
      case 'map':
        return html`<gf-map-page .route=${route}></gf-map-page>`;
      case 'collections':
        return html`<gf-collections .route=${route}></gf-collections>`;
      case 'shared':
        document.title = 'Partage — GeoFlora';
        return html`<gf-shared .data=${route.data}></gf-shared>`;
      case 'spot-new':
        return html`<gf-spot-editor kind=${route.kind} plant-id=${route.plant ?? ''} .at=${route.at}></gf-spot-editor>`;
      case 'spot':
        return html`<gf-spot-editor spot-id=${route.id} add-plant=${route.add ?? ''} ?pick=${route.pick}></gf-spot-editor>`;
      case 'settings':
        document.title = 'Réglages — GeoFlora';
        return html`<gf-settings></gf-settings>`;
      default:
        return html`<div class="banner">Page introuvable. <a href=${href.search()}>Retour à la recherche</a></div>`;
    }
  }
}

customElements.define('gf-app', GfApp);
