// @ts-check
// « Page web »: a pane of the plant sheet showing another site, in a frame. Once it is in the layout, the links
// of the app to other sites open here (core/web-pane.js) — Wikipédia, INPN, GBIF… —, with ← → among the pages
// opened, the address, and « open in a new tab » for the sites that refuse to be shown inside another one.

import { LitElement, html, css, nothing } from 'lit';
import { icon } from '../core/icons.js';
import { clearPages, goPage, webEvents, webSession } from '../core/web-pane.js';
import { ui } from '../styles/ui.js';

export class GfWebPane extends LitElement {
  static properties = {
    /** Not in a pane (Mode King, in the flow): it says where it works (the links go to a pane only). */
    inactive: { type: Boolean },
    _at: { state: true }
  };

  static styles = [ui, css`
    :host { display: flex; flex-direction: column; min-height: 0; flex: 1; background: var(--gf-surface); }
    .bar { flex: none; display: flex; align-items: center; gap: 2px; padding: 3px 6px; border-bottom: 1px solid var(--gf-border); }
    .bar .icon-btn { width: 30px; height: 30px; min-height: 0; }
    .bar .icon-btn:disabled { opacity: 0.35; }
    .addr { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 2px; padding: 3px 8px; border-radius: var(--gf-radius-pill); background: var(--gf-surface-2);
      font-size: 0.8rem; white-space: nowrap; overflow: hidden; }
    .addr b { font-weight: 600; flex: none; }
    .addr span { color: var(--gf-text-muted); overflow: hidden; text-overflow: ellipsis; }
    .hint { flex: none; margin: 0; padding: 3px 10px; font-size: 0.72rem; color: var(--gf-text-muted); border-bottom: 1px solid var(--gf-border); }
    .hint a { color: inherit; }
    iframe { flex: 1; min-height: 240px; width: 100%; border: 0; background: #fff; }
    .empty { flex: 1; display: grid; place-content: center; justify-items: center; gap: 8px; padding: 24px; text-align: center; color: var(--gf-text-muted); font-size: 0.9rem; }
    .empty .bi { font-size: 2.2rem; opacity: 0.5; }
    .empty p { margin: 0; max-width: 320px; }
  `];

  constructor() {
    super();
    this.inactive = false;
    this._at = webSession.at;
  }

  #onChange = () => { this._at = webSession.at; this.requestUpdate(); };
  connectedCallback() { super.connectedCallback(); webEvents.addEventListener('change', this.#onChange); this.#onChange(); }
  disconnectedCallback() { super.disconnectedCallback(); webEvents.removeEventListener('change', this.#onChange); }

  render() {
    const url = webSession.stack[this._at] || null;
    let host = '', path = '';
    if (url) { try { const u = new URL(url); host = u.hostname.replace(/^www\./, ''); path = decodeURIComponent(u.pathname + u.search); } catch { host = url; } }
    if (this.inactive) {
      return html`<div class="empty">${icon('globe-europe-africa')}<p>Placez ce bloc dans un panneau : les liens vers d’autres sites (Wikipédia, INPN, GBIF…) s’y ouvriront.</p></div>`;
    }
    return html`<div class="bar">
        <button class="icon-btn" type="button" aria-label="Page précédente" title="Page précédente" ?disabled=${this._at <= 0} @click=${() => goPage(-1)}>${icon('arrow-left')}</button>
        <button class="icon-btn" type="button" aria-label="Page suivante" title="Page suivante" ?disabled=${this._at >= webSession.stack.length - 1} @click=${() => goPage(1)}>${icon('arrow-right')}</button>
        <span class="addr" title=${url || ''}>${url ? html`<b>${host}</b><span>${path}</span>` : html`<span>Aucune page</span>`}</span>
        ${url ? html`<a class="icon-btn" href=${url} target="_blank" rel="noopener" data-no-web-pane aria-label="Ouvrir dans un nouvel onglet" title="Ouvrir dans un nouvel onglet">${icon('box-arrow-up-right')}</a>
          <button class="icon-btn" type="button" aria-label="Fermer la page" title="Fermer la page" @click=${() => clearPages()}>${icon('x-lg')}</button>` : nothing}
      </div>
      ${url ? html`<p class="hint">Page vide ? Ce site refuse d’être affiché ici : <a href=${url} target="_blank" rel="noopener" data-no-web-pane>l’ouvrir dans un onglet</a>.</p>
        <iframe src=${url} title=${'Page web : ' + host} referrerpolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"></iframe>`
      : html`<div class="empty">${icon('globe-europe-africa')}<p>Les liens vers d’autres sites — Wikipédia, INPN, GBIF, iNaturalist… — s’ouvriront ici, à côté de la fiche.</p></div>`}`;
  }
}

customElements.define('gf-web-pane', GfWebPane);
