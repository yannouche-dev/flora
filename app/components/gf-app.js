// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { config } from '../config.js';
import { activeFilterCount, clearFilters, lastSearchHash } from '../core/query.js';
import { href, RouterController } from '../core/router.js';
import { StoreController } from '../core/store.js';
import './gf-search-bar.js';
import './gf-results-bar.js';
import './gf-filter-panel.js';
import './gf-plant-list.js';
import './gf-plant-detail.js';
import './gf-settings.js';
import './gf-map-page.js';
import './gf-spot-editor.js';
import './gf-collections.js';
import './gf-shared.js';
import './gf-capture.js';
import './gf-tabbar.js';
import { ui } from '../styles/ui.js';

/** Lit controller tracking a media query (desktop sidebar vs. mobile bottom sheet). */
class MediaController {
  /** @param {import('lit').ReactiveControllerHost} host @param {string} query */
  constructor(host, query) {
    this.media = matchMedia(query);
    this.matches = this.media.matches;
    this.onChange = () => { this.matches = this.media.matches; host.requestUpdate(); };
    host.addController(this);
  }

  hostConnected() { this.media.addEventListener('change', this.onChange); }
  hostDisconnected() { this.media.removeEventListener('change', this.onChange); }
}

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
    gf-search-bar { flex: 1; min-width: 0; max-width: 720px; }
    nav.tabs { flex: none; }
    nav.tabs a { color: var(--gf-text); text-decoration: none; white-space: nowrap; display: inline-flex; align-items: center; }
    .note { flex: none; }
    gf-map-page, gf-spot-editor, gf-collections, gf-shared { flex: 1; min-height: 0; }
    .settings {
      flex: none;
      margin-left: auto;
      color: var(--gf-text-muted);
      text-decoration: none;
      font-size: 1.3rem;
      line-height: 1;
      padding: 4px;
    }
    main { min-height: 0; display: flex; flex-direction: column; }
    .search { display: flex; min-height: 0; flex: 1; }
    aside {
      width: 280px;
      flex: none;
      overflow-y: auto;
      padding: 4px 16px 24px;
      border-right: 1px solid var(--gf-border);
      background: var(--gf-surface);
    }
    aside h2, dialog h2 { font-size: 1rem; margin: 12px 0 4px; display: flex; align-items: center; }
    h2 .link { margin-left: auto; }
    .results { display: flex; flex-direction: column; flex: 1; min-width: 0; }
    gf-plant-list, gf-plant-detail, gf-settings { flex: 1; min-height: 0; }
    .banner {
      padding: 8px 16px;
      font-size: 0.875rem;
      background: var(--gf-accent-soft);
    }
    .banner.error { color: var(--gf-danger); }

    /* Mobile filters: bottom sheet. */
    dialog {
      position: fixed;
      inset: auto 0 0 0;
      width: 100%;
      max-width: 640px;
      max-height: 88dvh;
      margin: 0 auto;
      padding: 0;
      border: 0;
      border-radius: var(--gf-radius-lg) var(--gf-radius-lg) 0 0;
      background: var(--gf-surface);
      color: var(--gf-text);
      display: none;
      flex-direction: column;
    }
    dialog[open] { display: flex; animation: slide-up 0.2s ease-out; }
    dialog::backdrop { background: rgb(0 0 0 / 40%); }
    @keyframes slide-up { from { transform: translateY(40px); opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { dialog[open] { animation: none; } }
    .sheet-head { padding: 4px 16px 0; border-bottom: 1px solid var(--gf-border); }
    .sheet-head::before {
      content: '';
      display: block;
      width: 36px;
      height: 4px;
      margin: 6px auto 0;
      border-radius: 2px;
      background: var(--gf-border);
    }
    .sheet-body { overflow-y: auto; padding: 0 16px; flex: 1; }
    .sheet-foot { padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); border-top: 1px solid var(--gf-border); }
    .sheet-foot button { width: 100%; }
    @media (max-width: 560px) {
      .brand span { display: none; }
      header { gap: 8px; padding: 8px 10px; }
      nav.tabs a { padding: 4px 10px; }
    }
  `];

  #router = new RouterController(this);
  #store = new StoreController(this);
  #wide = new MediaController(this, config.wideQuery);
  #phone = new MediaController(this, '(max-width: 699px)');

  constructor() {
    super();
    this.addEventListener('open-capture', () => /** @type {any} */ (this.renderRoot.querySelector('gf-capture'))?.open());
  }

  get #dialog() {
    return /** @type {HTMLDialogElement | null} */ (this.renderRoot.querySelector('dialog'));
  }

  #openFilters() {
    this.#dialog?.showModal();
  }

  #closeFilters() {
    this.#dialog?.close();
  }

  render() {
    const route = this.#router.route;
    const { status, statusText, offline } = this.#store.state;
    const phone = this.#phone.matches;

    return html`
      <header>
        <a class="brand" href=${href.search()}>
          <img src="assets/icons/icon.svg" alt="" />
          <span>GeoFlora</span>
        </a>
        ${route.name === 'search' ? html`<gf-search-bar></gf-search-bar>` : nothing}
        ${phone ? nothing : html`<nav class="tabs segmented" aria-label="Sections">
          <a href=${lastSearchHash()} aria-current=${route.name === 'search' || route.name === 'plant' ? 'page' : 'false'}>Flore</a>
          <a href=${href.collections()} aria-current=${['collections', 'spot', 'spot-new', 'shared'].includes(route.name) ? 'page' : 'false'}>Mes plantes</a>
          <a href=${href.map()} aria-current=${route.name === 'map' ? 'page' : 'false'}>Carte</a>
        </nav>
        <button class="note primary" type="button" @click=${() => /** @type {any} */ (this.renderRoot.querySelector('gf-capture'))?.open()}>+ Noter ici</button>
        <a class="settings" href=${href.settings()} title="À propos et réglages" aria-label="À propos et réglages">⚙︎</a>`}
      </header>
      <main>
        ${status === 'loading' ? html`<div class="banner" role="status">${statusText || 'Chargement…'}</div>` : nothing}
        ${status === 'error' ? html`<div class="banner error" role="alert">${statusText}
          <button class="link" type="button" @click=${() => location.reload()}>Recharger</button></div>` : nothing}
        ${offline && status === 'ready' && route.name === 'search' ? html`<div class="banner">Hors ligne — recherche sur la copie locale.</div>` : nothing}
        ${this.#outlet(route)}
      </main>
      ${phone ? html`<gf-tabbar current=${tabOf(route.name)}></gf-tabbar>` : html`<span></span>`}
      <gf-capture></gf-capture>
    `;
  }

  #filtersHeader() {
    const active = activeFilterCount(this.#store.state.query);
    return html`
      <h2>Filtres ${active ? html`<button class="link" type="button" @click=${clearFilters}>Tout effacer</button>` : nothing}</h2>
    `;
  }

  /** @param {import('../core/router.js').Route} route */
  #outlet(route) {
    switch (route.name) {
      case 'search': {
        document.title = 'GeoFlora — flore de France';
        const wide = this.#wide.matches;
        const total = this.#store.state.results.total;
        return html`
          <div class="search">
            ${wide ? html`<aside aria-label="Filtres">${this.#filtersHeader()}<gf-filter-panel></gf-filter-panel></aside>` : nothing}
            <div class="results">
              <gf-results-bar .wide=${wide} @open-filters=${this.#openFilters}></gf-results-bar>
              <gf-plant-list></gf-plant-list>
            </div>
          </div>
          ${wide ? nothing : html`
            <dialog aria-label="Filtres" @click=${e => { if (e.target === e.currentTarget) this.#closeFilters(); }}>
              <div class="sheet-head">${this.#filtersHeader()}</div>
              <div class="sheet-body"><gf-filter-panel></gf-filter-panel></div>
              <div class="sheet-foot">
                <button class="primary large" type="button" @click=${this.#closeFilters}>
                  Voir ${total.toLocaleString('fr-FR')} espèce${total > 1 ? 's' : ''}
                </button>
              </div>
            </dialog>`}
        `;
      }
      case 'plant':
        return html`<gf-plant-detail plant-id=${route.id}></gf-plant-detail>`;
      case 'map':
        return html`<gf-map-page .route=${route}></gf-map-page>`;
      case 'collections':
        return html`<gf-collections></gf-collections>`;
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
