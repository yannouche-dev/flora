// @ts-check
// « Observations de la zone »: a free layout's filters of the zone's observations, first in its filters (the search
// cell's, the filters cell: gf-filter-panel `lead`), its header stacked with the facets' (gf-facet facetStyles). Where
// the observations come from and which of them count — the map's points and the list's plants (layout/state.js,
// core/observations.js):
//  - the sources: iNaturalist, GBIF — each one's count in the zone, or why it failed; one at least; one whose module
//    is off not ticked by default (core/observations.js defaultSources), said;
//  - GBIF's datasets in the zone (Pl@ntNet, Observation.org, the botanical conservatories…), their titles and counts:
//    every one ticked, one at least, « Tout cocher » when some are not (the focus then on the first one; those left
//    out: sansjeux=; an address that names those asked alone, jeux=: those); the zone's only one: said so, and how to
//    hide it (GBIF unticked) when GBIF can be;
//  - the rank (any; the species or below), the quality grades (verified, to identify, casual — every one ticked, one
//    at least; iNaturalist's alone: GBIF has none), a photo (any; one; one under a free licence), the cultivated or
//    captive plants (ticked: shown — sauvages=1 when not; iNaturalist's are among its casual ones, said when those
//    are not) — what a source does not filter itself said under it (core/observations.js APPLIES);
//  - a list down to one box: that box off, and why said (its description);
//  - the plants' origin: the flora's « Statut en France », below (every source alike).
// Everything ticked by default: every observation available (core/observations.js OBS_DEFAULTS). A change: the group's
// state (state.set({ filtres })), the address after it — only what differs from the layout's defaults (sources=,
// qualite=, taxon=, photos=, sauvages=, jeux=, sansjeux=).

import { LitElement, html, css, nothing } from 'lit';
import { ui } from '../styles/ui.js';
import { icon } from '../core/icons.js';
import { facetStyles } from '../components/gf-facet.js';
import { gbifDatasetTitle } from '../core/sources.js';
import { APPLIES, GRADES, OBS_DEFAULTS, SOURCES, SOURCE_NAMES, obsChanges, sourceOn } from '../core/observations.js';

/**
 * @typedef {import('./state.js').LayoutState} LayoutState
 * @typedef {import('../core/observations.js').ObsFilters} ObsFilters
 * @typedef {import('../core/observations.js').ObsGrade} ObsGrade
 */

/**
 * iNaturalist's quality grades: each its words (a name, what follows it: muted), what it means.
 * @type {Record<ObsGrade, [string, string, string]>}
 */
const GRADE_WORDS = {
  recherche: ['Vérifiées', '', 'Qualité « recherche » d’iNaturalist : l’identification confirmée par d’autres observateurs'],
  aidentifier: ['À identifier', '', 'Celles qui attendent une identification confirmée'],
  occasionnelles: ['Occasionnelles', ' : cultivées ou captives, sans photo, date ou lieu précis',
    'Qualité « occasionnelle » d’iNaturalist : plantes cultivées ou captives, observations sans photo, sans date ou sans lieu précis']
};

/** Each choice: its value, its words, what it means. @type {Record<'taxon' | 'photos', [string, string, string][]>} */
const CHOICES = {
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
    .name.wrap { white-space: normal; }
    .hint { color: var(--gf-text-muted); }
    ul[aria-disabled='true'] { opacity: 0.55; }
    .label .link { margin-left: 6px; font-weight: 400; }
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
    if (!next.sources.includes('gbif')) { next.jeux = []; next.sansjeux = []; }
    s.set({ filtres: obsChanges(next, this.#defaults) }, 'replace');
  }

  /** A source ticked or not (one at least stays). @param {'inat' | 'gbif'} source @param {boolean} on */
  #source(source, on) {
    const now = /** @type {LayoutState} */ (this.state).filters.sources;
    const sources = SOURCES.filter(x => x === source ? on : now.includes(x));
    if (sources.length) this.#set({ sources: [...sources] });
  }

  /** A quality grade ticked or not (one at least stays). @param {ObsGrade} grade @param {boolean} on */
  #grade(grade, on) {
    const now = /** @type {LayoutState} */ (this.state).filters.qualite;
    const qualite = GRADES.filter(g => g === grade ? on : now.includes(g));
    if (qualite.length) this.#set({ qualite: [...qualite] });
  }

  /**
   * A GBIF dataset ticked or not: an address that names those asked alone (jeux=), among them; else left out or not
   * (sansjeux=). @param {string} key @param {boolean} on
   */
  #dataset(key, on) {
    const { jeux, sansjeux } = /** @type {LayoutState} */ (this.state).filters;
    if (jeux.length) this.#set({ jeux: on ? [...new Set([...jeux, key])].sort() : jeux.filter(k => k !== key) });
    else this.#set({ sansjeux: on ? sansjeux.filter(k => k !== key) : [...new Set([...sansjeux, key])].sort() });
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

  /** « Tout cocher »: every dataset ticked — the button gone with it, the focus on the first one (not lost). */
  #allDatasets() {
    this.#refocus = true;
    this.#set({ jeux: [], sansjeux: [] });
  }
  #refocus = false;

  updated() {
    if (!this.#refocus || this.renderRoot.querySelector('#obs-all')) return;
    this.#refocus = false;
    if (!/** @type {ShadowRoot} */ (this.renderRoot).activeElement) /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('#obs-jeux input'))?.focus();
  }

  /** The plants' origin: the flora's « Statut en France », below — opened and scrolled to. */
  #toOrigin() {
    const facet = /** @type {any} */ (this.parentElement?.shadowRoot?.querySelector('gf-facet[name="status"]'));
    facet?.reveal();
  }

  /**
   * A source's count in the zone, or why it gave none: being counted, failed (its module off, or not answering); not
   * asked, its module off (why it is not ticked by default).
   * @param {LayoutState} s @param {'inat' | 'gbif'} source
   */
  #count(s, source) {
    if (!s.filters.sources.includes(source)) return sourceOn(source) ? nothing : html`<span class="count">module désactivé</span>`;
    const failed = s.failed.find(f => f.name === SOURCE_NAMES[source]);
    if (failed) return html`<span class="count warn">${failed.off ? 'module désactivé' : 'ne répond pas'}</span>`;
    const n = s.totals[source];
    if (s.speciesState === 'loading' || n == null) return html`<span class="count">…</span>`;
    return html`<span class="count" title=${`${n.toLocaleString('fr-FR')} observation${n > 1 ? 's' : ''} dans la zone`}>${n.toLocaleString('fr-FR')}</span>`;
  }

  /**
   * One of the choices of a filter, in a segmented control; `off`: no source asked applies it (said why).
   * @param {'taxon' | 'photos'} key @param {string} label @param {string} value @param {boolean} [off]
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
    // The cultivated plants shown, iNaturalist's casual ones not (where it puts its cultivated or captive ones): said.
    const grown = inat && !f.sauvages && !f.qualite.includes('occasionnelles');
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
          ${SOURCES.map(x => {
            const last = f.sources.length === 1 && f.sources.includes(x);
            return html`<li><label title=${x === 'inat' ? 'Les observations d’iNaturalist (les 1 000 plus récentes)' : 'Les occurrences de GBIF : herbiers, inventaires, Pl@ntNet, Observation.org… (300 au plus ; sa copie d’iNaturalist laissée)'}>
            <input type="checkbox" .checked=${f.sources.includes(x)} ?disabled=${last} aria-describedby=${last ? 'obs-one-source' : nothing}
              @change=${(/** @type {Event} */ e) => this.#source(x, /** @type {HTMLInputElement} */ (e.target).checked)} />
            <span class="name">${SOURCE_NAMES[x]}</span>${this.#count(s, x)}</label></li>`;
          })}
        </ul>
        ${f.sources.length === 1 ? html`<p class="note" id="obs-one-source">Une source au moins : cochez ${SOURCE_NAMES[SOURCES.find(x => !f.sources.includes(x)) ?? 'gbif']} pour décocher celle-ci.</p>` : nothing}
        ${gbif ? this.#datasets(s, f) : nothing}
        <div class="group"><span class="label">Taxon</span>${this.#choices('taxon', 'Taxon', f.taxon)}
          ${gbif && f.taxon !== 'tous' ? html`<p class="note">${APPLIES.taxon.why}.</p>` : nothing}</div>
        <div class="group"><span class="label">Qualité</span>${this.#grades(f, !inat)}
          ${gbif ? html`<p class="note">${inat ? 'iNaturalist seulement : ' : ''}${APPLIES.qualite.why}.</p>` : nothing}</div>
        <div class="group"><span class="label">Photo</span>${this.#choices('photos', 'Photo', f.photos)}
          ${gbif && f.photos === 'libre' ? html`<p class="note">${APPLIES.photos.why}.</p>` : nothing}</div>
        <ul class="group">
          <li><label title="Cultivées ou captives (iNaturalist) ; gérées, cultivées, captives ou relâchées (GBIF). Décochées : les plantes sauvages seulement">
            <input type="checkbox" .checked=${!f.sauvages} aria-describedby=${grown ? 'obs-grown' : nothing}
              @change=${(/** @type {Event} */ e) => this.#set({ sauvages: !(/** @type {HTMLInputElement} */ (e.target).checked) })} />
            <span class="name wrap">Plantes cultivées ou captives</span></label></li>
        </ul>
        ${grown ? html`<p class="note" id="obs-grown">iNaturalist range ses plantes cultivées ou captives parmi les « Occasionnelles » : cochez-les pour voir les siennes.</p>` : nothing}
        ${gbif && f.sauvages ? html`<p class="note">${APPLIES.sauvages.why}.</p>` : nothing}
        <p class="origin">${icon('globe-europe-africa')} L’origine des plantes (indigène, naturalisée, introduite…) : <button class="link" type="button" @click=${() => this.#toOrigin()}>Statut en France</button>, plus bas, pour toutes les sources.</p>
      </div>` : nothing}
    `;
  }

  /**
   * iNaturalist's quality grades, each a box (every one ticked by default, one at least); `off`: iNaturalist not asked
   * (GBIF has none). @param {Readonly<ObsFilters>} f @param {boolean} off
   */
  #grades(f, off) {
    const one = !off && f.qualite.length === 1;
    return html`<ul role="group" aria-label="Qualité" aria-disabled=${off ? 'true' : nothing}>${GRADES.map(g => {
      const [name, more, title] = GRADE_WORDS[g], on = f.qualite.includes(g), last = one && on;
      return html`<li><label title=${title}>
        <input type="checkbox" .checked=${on} ?disabled=${off || last} aria-describedby=${last ? 'obs-one-grade' : nothing}
          @change=${(/** @type {Event} */ e) => this.#grade(g, /** @type {HTMLInputElement} */ (e.target).checked)} />
        <span class="name wrap">${name}${more ? html`<span class="hint">${more}</span>` : nothing}</span></label></li>`;
    })}</ul>
    ${one ? html`<p class="note" id="obs-one-grade">Une qualité au moins : cochez-en une autre pour décocher celle-ci.</p>` : nothing}`;
  }

  /**
   * GBIF's datasets in the zone (counted as if none were chosen), the most records first, those the address names but
   * not in it after; their titles as found. Every one ticked, but those left out (or, an address naming those asked
   * alone: those); one at least; « Tout cocher » when some are not. The zone's only one: its box off, said why — and
   * GBIF to untick, only when its box can be (iNaturalist ticked too). @param {LayoutState} s @param {Readonly<ObsFilters>} f
   */
  #datasets(s, f) {
    const known = new Set(s.datasets.map(d => d.key));
    const named = f.jeux.length ? f.jeux : f.sansjeux;
    const all = [...s.datasets, ...named.filter(k => !known.has(k)).map(key => ({ key, count: 0 }))];
    const ticked = (/** @type {string} */ key) => f.jeux.length ? f.jeux.includes(key) : !f.sansjeux.includes(key);
    const kept = all.filter(d => ticked(d.key)).length;
    const shown = this._all ? all : all.filter((d, i) => i < SHOWN || named.includes(d.key));
    const missing = shown.map(d => d.key).filter(k => !this._titles.has(k) && !this.#asked.has(k));
    if (missing.length) this.#findTitles(missing);
    return html`<div class="group" role="group" aria-label="Jeux de données GBIF" id="obs-jeux">
      <span class="label">Jeux de données GBIF${kept < all.length ? html`<button class="link" type="button" id="obs-all" @click=${() => this.#allDatasets()}>Tout cocher</button>` : nothing}</span>
      ${!all.length ? html`<p class="note">${s.speciesState === 'loading' ? 'Jeux de la zone : recherche…' : 'Aucun jeu de données GBIF dans la zone.'}</p>` : html`<ul>
        ${shown.map(d => {
          const title = this._titles.get(d.key), on = ticked(d.key), last = on && kept === 1;
          return html`<li class=${d.count || named.includes(d.key) ? '' : 'empty'}><label title=${title ?? d.key}>
            <input type="checkbox" .checked=${on} ?disabled=${last} aria-describedby=${last ? 'obs-one-set' : nothing}
              @change=${(/** @type {Event} */ e) => this.#dataset(d.key, /** @type {HTMLInputElement} */ (e.target).checked)} />
            <span class="name">${title ?? html`<span class="key">${d.key.slice(0, 8)}…</span>`}</span>
            <span class="count">${d.count.toLocaleString('fr-FR')}</span></label></li>`;
        })}
      </ul>
      ${kept === 1 ? html`<p class="note" id="obs-one-set">${all.length > 1 ? 'Un jeu au moins : cochez-en un autre pour décocher celui-ci.'
        : f.sources.length > 1 ? 'Le seul jeu de la zone : décochez GBIF pour ne pas le voir.' : 'Le seul jeu de la zone.'}</p>` : nothing}
      ${all.length > shown.length ? html`<button class="link more" type="button" @click=${() => { this._all = true; }}>Voir plus (${all.length - shown.length})</button>` : nothing}
      ${this._all && all.length > SHOWN ? html`<button class="link more" type="button" @click=${() => { this._all = false; }}>Voir moins</button>` : nothing}`}
    </div>`;
  }
}
customElements.define('dl-obs-filters', DlObsFilters);
