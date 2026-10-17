// @ts-check
// « Observations de la zone »: a free layout's filters of the zone's observations, first in its filters (the search
// cell's, the filters cell: gf-filter-panel `lead`), its header stacked with the facets' (gf-facet facetStyles). Where
// the observations come from and which of them count — the map's points and the list's plants (layout/state.js,
// core/observations.js):
//  - the sources: iNaturalist, GBIF — each one's count in the zone, or why it failed; one at least;
//  - GBIF's datasets in the zone (Pl@ntNet, Observation.org, the botanical conservatories…), their titles and counts:
//    none ticked, all of them;
//  - the rank (any; the species or below), the quality (verified; to identify too; any — iNaturalist's alone: GBIF has
//    none), a photo (any; one; one under a free licence), wild plants only — what a source does not filter itself
//    said under it (core/observations.js APPLIES);
//  - the plants' origin: the flora's « Statut en France », below (every source alike).
// A change: the group's state (state.set({ filtres })), the address after it — only what differs from the layout's
// defaults (sources=, qualite=, taxon=, photos=, sauvages=, jeux=).

import { LitElement, html, css, nothing } from 'lit';
import { ui } from '../styles/ui.js';
import { icon } from '../core/icons.js';
import { facetStyles } from '../components/gf-facet.js';
import { gbifDatasetTitle } from '../core/sources.js';
import { APPLIES, OBS_DEFAULTS, SOURCES, SOURCE_NAMES, obsChanges } from '../core/observations.js';

/**
 * @typedef {import('./state.js').LayoutState} LayoutState
 * @typedef {import('../core/observations.js').ObsFilters} ObsFilters
 */

/** Each choice: its value, its words, what it means. @type {Record<'qualite' | 'taxon' | 'photos', [string, string, string][]>} */
const CHOICES = {
  qualite: [
    ['recherche', 'Vérifiées', 'Qualité « recherche » d’iNaturalist : l’identification confirmée par d’autres observateurs'],
    ['verifiables', 'À identifier aussi', 'Les vérifiées et celles qui attendent une identification confirmée'],
    ['toutes', 'Toutes', 'Toutes, plantes cultivées et observations incomplètes comprises']
  ],
  taxon: [
    ['tous', 'Tous les rangs', 'Les observations identifiées au genre ou à la famille aussi'],
    ['espece', 'À l’espèce', 'Identifiées à l’espèce, ou en dessous (sous-espèce, variété)']
  ],
  photos: [
    ['toutes', 'Toutes', 'Avec ou sans photo'],
    ['avec', 'Avec photo', 'Au moins une photo'],
    ['libre', 'Photo libre', 'Une photo sous licence libre : CC0, CC BY ou CC BY-SA']
  ]
};

/** GBIF's datasets shown before « Voir plus ». */
const SHOWN = 6;

export class DlObsFilters extends LitElement {
  static properties = { state: { attribute: false }, open: { type: Boolean, reflect: true }, _all: { state: true }, _titles: { state: true } };

  static styles = [ui, facetStyles, css`
    .group { margin: 10px 0 0; }
    .label { display: block; margin: 0 0 4px; font-size: 0.78rem; font-weight: 600; color: var(--gf-text-muted); }
    .segmented { display: flex; width: 100%; box-sizing: border-box; }
    .segmented > button { flex: 1 1 0; min-width: 0; padding: 4px 6px; font-size: 0.8rem; line-height: 1.15; white-space: normal; }
    .segmented[aria-disabled='true'] { opacity: 0.55; }
    .note { margin: 4px 0 0; font-size: 0.75rem; color: var(--gf-text-muted); }
    .warn { color: var(--gf-danger); }
    .count.warn { font-size: 0.75rem; }
    .origin { margin: 12px 0 0; font-size: 0.8rem; color: var(--gf-text-muted); }
    .origin .link { font-size: inherit; }
    .key { font-family: ui-monospace, monospace; font-size: 0.75rem; color: var(--gf-text-muted); }
  `];

  constructor() {
    super();
    /** @type {LayoutState | null} */ this.state = null;
    this.open = true;
    /** Every dataset shown (« Voir plus »). */
    this._all = false;
    /** GBIF's datasets' titles, as found (core/sources.js: cached), by key; null: none. @type {Map<string, string | null>} */
    this._titles = new Map();
  }

  /** The state watched: drawn again on each change. */
  #watched = /** @type {LayoutState | null} */ (null);
  #onChange = () => this.requestUpdate();

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (!changed.has('state') || this.state === this.#watched) return;
    this.#watched?.removeEventListener('change', this.#onChange);
    this.#watched = this.state;
    this.#watched?.addEventListener('change', this.#onChange);
  }

  connectedCallback() { super.connectedCallback(); this.#watched?.addEventListener('change', this.#onChange); }
  disconnectedCallback() { super.disconnectedCallback(); this.#watched?.removeEventListener('change', this.#onChange); }

  /** The layout's defaults (its maps' sources: state.js), against which the address keeps what differs. */
  get #defaults() { return { ...OBS_DEFAULTS, sources: /** @type {LayoutState} */ (this.state).defaultSources }; }

  /** The filters changed: the group's state, the address after it. @param {Partial<ObsFilters>} patch */
  #set(patch) {
    const s = /** @type {LayoutState} */ (this.state);
    const next = { ...s.filters, ...patch };
    // GBIF left: its datasets with it (the address never keeps what is not asked).
    if (!next.sources.includes('gbif')) next.jeux = [];
    s.set({ filtres: obsChanges(next, this.#defaults) }, 'replace');
  }

  /** A source ticked or not (one at least stays). @param {'inat' | 'gbif'} source @param {boolean} on */
  #source(source, on) {
    const now = /** @type {LayoutState} */ (this.state).filters.sources;
    const sources = SOURCES.filter(x => x === source ? on : now.includes(x));
    if (sources.length) this.#set({ sources: [...sources] });
  }

  /** A GBIF dataset ticked or not. @param {string} key @param {boolean} on */
  #dataset(key, on) {
    const now = /** @type {LayoutState} */ (this.state).filters.jeux;
    this.#set({ jeux: on ? [...new Set([...now, key])].sort() : now.filter(k => k !== key) });
  }

  /** The datasets' titles not known yet, found four at a time (each once). @param {string[]} keys */
  async #findTitles(keys) {
    const wanted = keys.filter(k => !this.#asked.has(k));
    for (const k of wanted) this.#asked.add(k);
    for (let i = 0; i < wanted.length; i += 4) {
      const part = wanted.slice(i, i + 4);
      const titles = await Promise.all(part.map(k => gbifDatasetTitle(k).catch(() => null)));
      const next = new Map(this._titles);
      part.forEach((k, j) => next.set(k, titles[j]));
      this._titles = next;
    }
  }
  /** @type {Set<string>} */ #asked = new Set();

  /** The plants' origin: the flora's « Statut en France », below — opened and scrolled to. */
  #toOrigin() {
    const facet = /** @type {any} */ (this.parentElement?.shadowRoot?.querySelector('gf-facet[name="status"]'));
    facet?.reveal();
  }

  /**
   * A source's count in the zone, or why it gave none: being counted, failed (its module off, or not answering).
   * @param {LayoutState} s @param {'inat' | 'gbif'} source
   */
  #count(s, source) {
    if (!s.filters.sources.includes(source)) return nothing;
    const failed = s.failed.find(f => f.name === SOURCE_NAMES[source]);
    if (failed) return html`<span class="count warn">${failed.off ? 'module désactivé' : 'ne répond pas'}</span>`;
    const n = s.totals[source];
    if (s.speciesState === 'loading' || n == null) return html`<span class="count">…</span>`;
    return html`<span class="count" title=${`${n.toLocaleString('fr-FR')} observation${n > 1 ? 's' : ''} dans la zone`}>${n.toLocaleString('fr-FR')}</span>`;
  }

  /**
   * One of the choices of a filter, in a segmented control; `off`: no source asked applies it (said why).
   * @param {'qualite' | 'taxon' | 'photos'} key @param {string} label @param {string} value @param {boolean} [off]
   */
  #choices(key, label, value, off = false) {
    return html`<div class="segmented" role="group" aria-label=${label} aria-disabled=${off ? 'true' : nothing}>${CHOICES[key].map(([v, words, title]) => html`<button type="button"
      aria-pressed=${String(v === value)} title=${title} ?disabled=${off} @click=${() => this.#set({ [key]: v })}>${words}</button>`)}</div>`;
  }

  render() {
    const s = this.state;
    if (!s?.live.at) return nothing;
    const f = s.filters;
    const changed = Object.keys(obsChanges(f, this.#defaults) ?? {}).length;
    const gbif = f.sources.includes('gbif'), inat = f.sources.includes('inat');
    return html`
      <div class="head">
        <button class="toggle" type="button" aria-expanded=${String(this.open)} aria-controls="obs-body" @click=${() => { this.open = !this.open; }}>
          Observations de la zone
          ${changed ? html`<span class="badge" title=${`${changed} réglage${changed > 1 ? 's' : ''} changé${changed > 1 ? 's' : ''}`}>${changed}</span>` : nothing}
        </button>
        ${changed ? html`<button class="link clear" type="button" title="Les réglages de la disposition" @click=${() => s.set({ filtres: null }, 'replace')}>effacer</button>` : nothing}
      </div>
      ${this.open ? html`<div class="body" id="obs-body">
        <ul role="group" aria-label="Sources des observations">
          ${SOURCES.map(x => html`<li><label title=${x === 'inat' ? 'Les observations d’iNaturalist (les 1 000 plus récentes)' : 'Les occurrences de GBIF : herbiers, inventaires, Pl@ntNet, Observation.org… (300 au plus ; sa copie d’iNaturalist laissée)'}>
            <input type="checkbox" .checked=${f.sources.includes(x)} ?disabled=${f.sources.length === 1 && f.sources.includes(x)}
              @change=${(/** @type {Event} */ e) => this.#source(x, /** @type {HTMLInputElement} */ (e.target).checked)} />
            <span class="name">${SOURCE_NAMES[x]}</span>${this.#count(s, x)}</label></li>`)}
        </ul>
        ${gbif ? this.#datasets(s, f) : nothing}
        <div class="group"><span class="label">Taxon</span>${this.#choices('taxon', 'Taxon', f.taxon)}
          ${gbif && f.taxon !== 'tous' ? html`<p class="note">${APPLIES.taxon.why}.</p>` : nothing}</div>
        <div class="group"><span class="label">Qualité</span>${this.#choices('qualite', 'Qualité', f.qualite, !inat)}
          ${gbif ? html`<p class="note">${inat ? 'iNaturalist seulement : ' : ''}${APPLIES.qualite.why}.</p>` : nothing}</div>
        <div class="group"><span class="label">Photo</span>${this.#choices('photos', 'Photo', f.photos)}
          ${gbif && f.photos === 'libre' ? html`<p class="note">${APPLIES.photos.why}.</p>` : nothing}</div>
        <ul class="group" role="group" aria-label="Plantes sauvages">
          <li><label title="Ni cultivées ni captives (iNaturalist) ; ni gérées, cultivées, captives ou relâchées (GBIF)">
            <input type="checkbox" .checked=${f.sauvages} @change=${(/** @type {Event} */ e) => this.#set({ sauvages: /** @type {HTMLInputElement} */ (e.target).checked })} />
            <span class="name">Sauvages seulement</span></label></li>
        </ul>
        ${gbif && f.sauvages ? html`<p class="note">${APPLIES.sauvages.why}.</p>` : nothing}
        <p class="origin">${icon('globe-europe-africa')} L’origine des plantes (indigène, naturalisée, introduite…) : <button class="link" type="button" @click=${() => this.#toOrigin()}>Statut en France</button>, plus bas, pour toutes les sources.</p>
      </div>` : nothing}
    `;
  }

  /**
   * GBIF's datasets in the zone (counted as if none were chosen), the most records first, those chosen but not in it
   * after; their titles as found. None ticked: all of them. @param {LayoutState} s @param {Readonly<ObsFilters>} f
   */
  #datasets(s, f) {
    const known = new Set(s.datasets.map(d => d.key));
    const all = [...s.datasets, ...f.jeux.filter(k => !known.has(k)).map(key => ({ key, count: 0 }))];
    const shown = this._all ? all : all.filter((d, i) => i < SHOWN || f.jeux.includes(d.key));
    const missing = shown.map(d => d.key).filter(k => !this._titles.has(k) && !this.#asked.has(k));
    if (missing.length) this.#findTitles(missing);
    return html`<div class="group" role="group" aria-label="Jeux de données GBIF">
      <span class="label">Jeux de données GBIF${f.jeux.length ? '' : ' · aucun coché : tous'}</span>
      ${!all.length ? html`<p class="note">${s.speciesState === 'loading' ? 'Jeux de la zone : recherche…' : 'Aucun jeu de données GBIF dans la zone.'}</p>` : html`<ul>
        ${shown.map(d => {
          const title = this._titles.get(d.key);
          return html`<li class=${d.count || f.jeux.includes(d.key) ? '' : 'empty'}><label title=${title ?? d.key}>
            <input type="checkbox" .checked=${f.jeux.includes(d.key)} @change=${(/** @type {Event} */ e) => this.#dataset(d.key, /** @type {HTMLInputElement} */ (e.target).checked)} />
            <span class="name">${title ?? html`<span class="key">${d.key.slice(0, 8)}…</span>`}</span>
            <span class="count">${d.count.toLocaleString('fr-FR')}</span></label></li>`;
        })}
      </ul>
      ${all.length > shown.length ? html`<button class="link more" type="button" @click=${() => { this._all = true; }}>Voir plus (${all.length - shown.length})</button>` : nothing}
      ${this._all && all.length > SHOWN ? html`<button class="link more" type="button" @click=${() => { this._all = false; }}>Voir moins</button>` : nothing}`}
    </div>`;
  }
}
customElements.define('dl-obs-filters', DlObsFilters);
