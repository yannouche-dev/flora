// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { searchPlaces } from '../core/geoservices.js';
import { ui } from '../styles/ui.js';
import { icon } from '../core/icons.js';

/**
 * Search pill on top of the map: addresses, lieux-dits, communes (IGN). The ▦ button at its end opens the
 * "Carte" panel (a discreet dot on it while protected areas are in view: `flag`, said in its name). Quiet (the
 * quiet-map rule, gf-map.js): only results drop under it — a search under way is the map's thin loading line past
 * 400 ms (map-busy, aria-busy on the field), a search that finds nothing or fails one brief toast over the map
 * (map-toast), said by the map's live region. Events: place-pick {coordinates, label}, open-panel, map-busy {key,
 * on, label}, map-toast {text}.
 */
export class GfMapSearch extends LitElement {
  static properties = {
    /** Why the panel's button has its dot ('' : none): « espaces protégés en vue ». */
    flag: { type: String },
    /** No button for the panel « Carte » at its end (a free layout's map without its layers control: ctl=). */
    noPanel: { type: Boolean, attribute: false },
    _query: { state: true },
    _results: { state: true },
    _busy: { state: true },
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
    .icon-btn { width: 40px; height: 40px; font-size: 1.2rem; color: var(--gf-text); position: relative; }
    .icon-btn .dot { position: absolute; top: 7px; right: 7px; width: 7px; height: 7px; border-radius: 50%; background: #15803d;
      box-shadow: 0 0 0 1.5px var(--gf-surface); }
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
  `];

  constructor() {
    super();
    this.flag = '';
    this.noPanel = false;
    this._query = '';
    /** @type {import('../core/geoservices.js').GeoResult[]} */
    this._results = [];
    this._busy = false;
    this._active = false;
  }

  /** @type {AbortController | null} */ #abort = null;
  /** @type {number | undefined} */ #timer;

  /** @param {string} name @param {any} detail */
  #emit(name, detail) { this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true })); }

  /** The search under way, or done: the map's thin line past 400 ms (gf-map busy), aria-busy on the field. @param {boolean} on */
  #setBusy(on) {
    if (on === this._busy) return;
    this._busy = on;
    this.#emit('map-busy', { key: 'search', on, label: on ? 'Recherche de l’adresse' : '' });
  }

  /** @param {Event} e */
  #input(e) {
    this._query = /** @type {HTMLInputElement} */ (e.target).value;
    this._active = true;
    clearTimeout(this.#timer);
    this.#abort?.abort();
    if (this._query.trim().length < 3) { this._results = []; this.#setBusy(false); return; }
    this.#setBusy(true);
    this.#timer = setTimeout(async () => {
      const abort = this.#abort = new AbortController();
      const asked = this._query.trim();
      try {
        const results = await searchPlaces(this._query, abort.signal);
        if (abort.signal.aborted) return;
        this._results = results;
        this.#setBusy(false);
        // Asked, nothing found: said a moment over the map (no row left under the pill).
        if (!results.length) this.#emit('map-toast', { text: `Aucun résultat pour « ${asked} ».` });
      } catch (error) {
        if (abort.signal.aborted) return;
        this._results = [];
        this.#setBusy(false);
        this.#emit('map-toast', { text: /** @type {Error} */ (error).name === 'ModuleOffError' ? 'Recherche d’adresse désactivée (Réglages › Modules).'
          : navigator.onLine === false ? 'Hors ligne : recherche d’adresse indisponible.' : 'Recherche d’adresse indisponible pour le moment.' });
      }
    }, 300);
  }

  /** @param {import('../core/geoservices.js').GeoResult} r */
  #pick(r) {
    this._query = r.label;
    this._active = false;
    this.#emit('place-pick', { coordinates: r.coordinates, label: r.label });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this.#timer);
    this.#abort?.abort();
    this.#setBusy(false);
  }

  render() {
    const open = this._active && this._results.length > 0;
    const panel = 'Carte : fond, couches, légende' + (this.flag ? ' — ' + this.flag : '');
    return html`
      <div class="pill">
        <span class="ico" aria-hidden="true">${icon('search')}</span>
        <input type="search" placeholder="Adresse, commune, lieu-dit…" aria-label="Aller à une adresse" autocomplete="off"
          aria-busy=${this._busy ? 'true' : 'false'}
          .value=${this._query} @input=${this.#input}
          @focus=${() => { this._active = true; }}
          @keydown=${e => { if (e.key === 'Enter' && this._results[0]) this.#pick(this._results[0]); if (e.key === 'Escape') this._active = false; }} />
        ${this.noPanel ? nothing : html`<button class="icon-btn" type="button" aria-label=${panel} title=${panel}
          @click=${() => this.#emit('open-panel', {})}>${icon('layers')}${this.flag ? html`<span class="dot" aria-hidden="true"></span>` : nothing}</button>`}
      </div>
      ${open ? html`<ul role="listbox" aria-label="Résultats">
        ${this._results.map(r => html`<li><button type="button" @click=${() => this.#pick(r)}>
          <span>${r.label}</span><small>${[r.kind, r.detail].filter(Boolean).join(' · ')}</small></button></li>`)}
      </ul>` : nothing}
    `;
  }
}

customElements.define('gf-map-search', GfMapSearch);
