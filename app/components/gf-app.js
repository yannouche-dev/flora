// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { href, RouterController } from '../core/router.js';
import { StoreController } from '../core/store.js';
import './gf-search-bar.js';
import './gf-filters.js';
import './gf-plant-list.js';
import './gf-plant-detail.js';
import './gf-settings.js';

/** App shell: header + route outlet. */
export class GfApp extends LitElement {
  static styles = css`
    :host {
      display: grid;
      grid-template-rows: auto 1fr;
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
    gf-search-bar { flex: 1; }
    .settings {
      color: var(--gf-text-muted);
      text-decoration: none;
      font-size: 1.3rem;
      line-height: 1;
      padding: 4px;
    }
    main { min-height: 0; display: flex; flex-direction: column; }
    .search { display: flex; flex-direction: column; min-height: 0; flex: 1; }
    gf-filters { padding: 8px 16px; border-bottom: 1px solid var(--gf-border); }
    gf-plant-list, gf-plant-detail, gf-settings { flex: 1; min-height: 0; }
    .banner {
      padding: 8px 16px;
      font-size: 0.875rem;
      background: var(--gf-accent-soft);
    }
    .banner.error { color: var(--gf-danger); }
    @media (max-width: 560px) {
      .brand span { display: none; }
    }
  `;

  #router = new RouterController(this);
  #store = new StoreController(this);

  render() {
    const route = this.#router.route;
    const { status, statusText, offline } = this.#store.state;

    return html`
      <header>
        <a class="brand" href=${href.search()}>
          <img src="assets/icons/icon.svg" alt="" />
          <span>GeoFlora</span>
        </a>
        ${route.name === 'search' ? html`<gf-search-bar></gf-search-bar>` : html`<span style="flex:1"></span>`}
        <a class="settings" href=${href.settings()} title="À propos et réglages" aria-label="À propos et réglages">⚙︎</a>
      </header>
      <main>
        ${status === 'loading' ? html`<div class="banner" role="status">${statusText || 'Chargement…'}</div>` : nothing}
        ${status === 'error' ? html`<div class="banner error" role="alert">${statusText}</div>` : nothing}
        ${offline && status === 'ready' && route.name === 'search' ? html`<div class="banner">Hors ligne — recherche sur la copie locale.</div>` : nothing}
        ${this.#outlet(route)}
      </main>
    `;
  }

  /** @param {import('../core/router.js').Route} route */
  #outlet(route) {
    switch (route.name) {
      case 'search':
        document.title = 'GeoFlora — flore de France';
        return html`<div class="search"><gf-filters></gf-filters><gf-plant-list></gf-plant-list></div>`;
      case 'plant':
        return html`<gf-plant-detail plant-id=${route.id}></gf-plant-detail>`;
      case 'settings':
        document.title = 'Réglages — GeoFlora';
        return html`<gf-settings></gf-settings>`;
      default:
        return html`<div class="banner">Page introuvable. <a href=${href.search()}>Retour à la recherche</a></div>`;
    }
  }
}

customElements.define('gf-app', GfApp);
