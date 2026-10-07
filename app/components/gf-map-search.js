// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { searchPlaces } from '../core/geoservices.js';
import { ui } from '../styles/ui.js';

/**
 * Search pill on top of the map: addresses, lieux-dits, communes (IGN). The ▦ button at its end opens the
 * "Carte" panel. Events: place-pick {coordinates, label}, open-panel.
 */
export class GfMapSearch extends LitElement {
  static properties = {
    _query: { state: true },
    _results: { state: true },
    _status: { state: true },
    _active: { state: true }
  };

  static styles = [ui, css`
    :host { display: block; position: relative; }
    .pill {
      display: flex;
      align-items: center;
      background: var(--gf-surface);
      border-radius: var(--gf-radius-pill);
      box-shadow: var(--gf-shadow-float);
      padding: 0 4px 0 14px;
      gap: 4px;
    }
    .pill:focus-within { box-shadow: var(--gf-shadow-float), var(--gf-focus); }
    .ico { color: var(--gf-text-muted); }
    input[type='search'] { border: 0; box-shadow: none; background: none; padding: 10px 6px; min-height: 44px; }
    input[type='search']:focus-visible { box-shadow: none; }
    .icon-btn { width: 40px; height: 40px; font-size: 1.2rem; color: var(--gf-text); }
    ul {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      right: 0;
      margin: 0;
      padding: 6px;
      list-style: none;
      background: var(--gf-surface);
      border-radius: var(--gf-radius);
      box-shadow: var(--gf-shadow-float);
      max-height: 50vh;
      overflow-y: auto;
    }
    li button {
      width: 100%;
      justify-content: flex-start;
      text-align: left;
      border: 0;
      border-radius: var(--gf-radius-sm);
      font-size: 0.95rem;
      font-weight: 400;
      padding: 8px 10px;
      display: grid;
      gap: 0;
    }
    li small { color: var(--gf-text-muted); font-size: 0.8rem; }
    .status { padding: 8px 10px; font-size: 0.85rem; color: var(--gf-text-muted); }
  `];

  constructor() {
    super();
    this._query = '';
    /** @type {import('../core/geoservices.js').GeoResult[]} */
    this._results = [];
    /** @type {'' | 'loading' | 'empty' | 'error'} */
    this._status = '';
    this._active = false;
  }

  /** @type {AbortController | null} */ #abort = null;
  /** @type {number | undefined} */ #timer;

  /** @param {Event} e */
  #input(e) {
    this._query = /** @type {HTMLInputElement} */ (e.target).value;
    this._active = true;
    clearTimeout(this.#timer);
    this.#abort?.abort();
    if (this._query.trim().length < 3) { this._results = []; this._status = ''; return; }
    this._status = 'loading';
    this.#timer = setTimeout(async () => {
      const abort = this.#abort = new AbortController();
      try {
        const results = await searchPlaces(this._query, abort.signal);
        if (abort.signal.aborted) return;
        this._results = results;
        this._status = results.length ? '' : 'empty';
      } catch {
        if (!abort.signal.aborted) { this._results = []; this._status = 'error'; }
      }
    }, 300);
  }

  /** @param {import('../core/geoservices.js').GeoResult} r */
  #pick(r) {
    this._query = r.label;
    this._active = false;
    this.dispatchEvent(new CustomEvent('place-pick', { detail: { coordinates: r.coordinates, label: r.label }, bubbles: true, composed: true }));
  }

  render() {
    const open = this._active && (this._results.length || this._status);
    return html`
      <div class="pill">
        <span class="ico" aria-hidden="true">🔍</span>
        <input type="search" placeholder="Adresse, commune, lieu-dit…" aria-label="Aller à une adresse" autocomplete="off"
          .value=${this._query} @input=${this.#input}
          @focus=${() => { this._active = true; }}
          @keydown=${e => { if (e.key === 'Enter' && this._results[0]) this.#pick(this._results[0]); if (e.key === 'Escape') this._active = false; }} />
        <button class="icon-btn" type="button" aria-label="Carte : fond, couches, légende" title="Carte : fond, couches, légende"
          @click=${() => this.dispatchEvent(new CustomEvent('open-panel', { bubbles: true, composed: true }))}>▦</button>
      </div>
      ${open ? html`<ul role="listbox" aria-label="Résultats">
        ${this._results.map(r => html`<li><button type="button" @click=${() => this.#pick(r)}>
          <span>${r.label}</span><small>${[r.kind, r.detail].filter(Boolean).join(' · ')}</small></button></li>`)}
        ${this._status === 'loading' ? html`<li class="status">Recherche…</li>` : nothing}
        ${this._status === 'empty' ? html`<li class="status">Aucun résultat.</li>` : nothing}
        ${this._status === 'error' ? html`<li class="status">${navigator.onLine === false ? 'Hors ligne : recherche indisponible.' : 'Recherche indisponible pour le moment.'}</li>` : nothing}
      </ul>` : nothing}
    `;
  }
}

customElements.define('gf-map-search', GfMapSearch);
