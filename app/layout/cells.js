// @ts-check
// What each cell of a screen of one's own shows (« Écran sur mesure »): the app's own pieces, wired to the layout's
// shared state (state.js) rather than to the address — one adapter per component of the registry (registry.js):
//  - map: the mother map (gf-map; 3D as Réglages › Cartes says): the scope's circle, the latest observations of the
//    plants found in it (those the search keeps), the current plant's own observations lit, the observation chosen.
//    A point touched: its plant is the current one; a long press: the scope moves there. Over it, the scope: its place,
//    its radius (a slider), « Autour de moi », « Toute la France » (no scope). Its settings (registry.js, map-options.js)
//    change each of these: its group's starting place while the address has none (lieu, autour: the first map's —
//    group-defaults.js), its background and 3D, its IGN
//    layers, its points (sources, period, style, the current plant's grouped), how it follows the state (suit, plante,
//    toucher), its controls (ui: by its width, compact, none; ctl: exactly which — the zone and a handle on the circle's
//    edge that drags its radius, the address search, « Me localiser », the layers, 2D / 3D, the other background's
//    thumbnail, the current plant's chip, the period's chips, the count, the legend, the zoom: map-options.js);
//  - place: the scope alone — « Autour de moi », a commune (gf-place-search), the radius;
//  - search: a search bar as Flore's (gf-results-bar: text, sort, filters chosen, « Filtrer par »), its filters (gf-filter-
//    panel, opened by the funnel) and its list; filters and results: each part alone. They read and write the search
//    of their group (its channel, core/search-channel.js: the screen's own, never Flore's); the scope keeps it to its
//    plants (state.js);
//  - plant: the plant sheet (gf-plant-detail), whole or one block (plant.wikipedia: a block alone, gf-sheet-block) —
//    its maps about « Les résultats », those of its group's search; media: the photos' viewer (gf-media-viewer). Each
//    shows the current plant;
//  - deck: Rencontres' cards (miniapp/kit/ma-deck.js) for the plants found in the scope, the one on top the current
//    plant (one passed, then chosen elsewhere: back in the deck); a heart: a favourite; each choice said aloud, in the
//    activities' words. On the swipe core (miniapp/kit/swipes.js), its swipes in memory, its favourites without
//    origin, taken back as left (deck-cell.js DeckSession).
// What is done in a cell with its own controls is kept in the layout (`cell-param` {key: value…}, gf-layout.js: the
// address is the app, sent as it is): a map's 3D, background, layers (their order, IGN's catalogue, their opacity),
// period, « Seule », legend, binoculars (« Observations autour » in 3D), its points' sources and the current plant's
// (« Sur cette carte » of its panel ▦), and its view (vue=: while the screen is modified, any map's; in use, the one
// leading the list's); the search's filters opened; the results as a list or a grid; their rows compact (compact=, the
// search's bar's button: the cell's own, never Flore's — the whole device's).
// A link to a plant's sheet anywhere in a cell (a result, a look-alike) makes it the current plant (gf-layout.js, core/embed-links.js).
// The frame every cell shares (registry.js#FRAME: its head, its actions, its empty state) is gf-layout.js'; its links
// are honoured by the cells: a plant of its own (plante=: renderCell), the whole flora instead of the zone (results
// zone=0: DlResults, state.js#wholeOf), a card touched and the swipes (toucher, ecrit=0: deck-cell.js DlDeck); the
// deck tells the layout when it has no cards (`cell-empty`), for a deck that hides meanwhile (vide=masque).
// The map cell (dl-map) is map-cell.js', the deck (dl-deck) deck-cell.js'; the others are here, with renderCell.
// What the cells share (the state watched, the scope in words, its line and its slider): cell-kit.js.

import { LitElement, html, css, nothing } from 'lit';
import { icon } from '../core/icons.js';
import { moduleOn } from '../core/modules.js';
import { SearchController } from '../core/search-channel.js';
import { blockStyle } from '../core/sheet-blocks.js';
import { counted } from '../core/fr.js';
import { ui } from '../styles/ui.js';
import { photosOffLine } from '../components/ui-kit.js';
import { cellIcon } from './registry.js';
import { obsNotes, sourcesText } from '../core/observations.js';
import { StateController, locateOnce, nameScope, radiusSlider, scopeNote, scopeStyles, scopeWords, setCell, where } from './cell-kit.js';
import './map-cell.js';
import './deck-cell.js';
import '../components/gf-place-search.js';
import '../components/gf-results-bar.js';
import '../components/gf-filter-panel.js';
import './obs-filters.js';
import '../components/gf-plant-list.js';
import '../components/gf-plant-detail.js';
import '../components/gf-sheet-block.js';
import '../components/gf-media-viewer.js';

/**
 * @typedef {import('./state.js').LayoutState} LayoutState
 * @typedef {import('./registry.js').Resolved} Resolved
 */

// ── place ────────────────────────────────────────────────────────────────────────────────────────────────────

export class DlPlace extends LitElement {
  static properties = { state: { attribute: false }, _busy: { state: true }, _error: { state: true } };

  // Positioned: what it places absolutely (the slider's hidden label) scrolls with it — placed by the cell instead, it
  // stood below the cell's edge when the zone holds more than the cell's height, and the cell (which clips) overflowed.
  static styles = [ui, scopeStyles, css`
    :host { display: block; position: relative; overflow-y: auto; padding: 10px 12px; }
    .box { display: grid; gap: 10px; }
    .primary { justify-self: start; }
  `];


  constructor() {
    super();
    new StateController(this);
    /** @type {LayoutState | null} */ this.state = null;
    this._busy = false;
    /** @type {string | null} */ this._error = null;
  }

  async #locate() {
    const s = /** @type {LayoutState} */ (this.state);
    this._busy = true; this._error = null;
    try { const at = await locateOnce(); s.setScope(at, null); nameScope(s, /** @type {[number, number]} */ (s.live.at)); }
    catch (error) { this._error = /** @type {Error} */ (error).message; }
    finally { this._busy = false; }
  }

  render() {
    const s = this.state;
    if (!s) return nothing;
    const note = this._error || scopeNote(s);
    return html`<div class="box">
      ${where(s)}
      <button class="primary" type="button" ?disabled=${this._busy} @click=${() => this.#locate()}>${icon('geo-alt-fill')} ${this._busy ? 'Localisation…' : 'Autour de moi'}</button>
      <gf-place-search label="Choisir une commune pour la zone" @place-pick=${(/** @type {CustomEvent} */ e) => s.setScope(e.detail.coordinates, e.detail.label || null)}></gf-place-search>
      ${s.live.at ? radiusSlider(s) : nothing}
      ${note ? html`<p class="note ${this._error || s.speciesState === 'error' ? 'error' : ''}" role="status">${note}</p>` : nothing}
    </div>`;
  }
}
customElements.define('dl-place', DlPlace);

// ── results ──────────────────────────────────────────────────────────────────────────────────────────────────

/** A results pane narrower than this: cards instead of the grid (as Flore). */
const GRID_MIN = 560;

export class DlResults extends LitElement {
  static properties = { state: { attribute: false }, params: { attribute: false }, channel: { attribute: false }, _wide: { state: true } };

  static styles = [ui, css`
    :host { display: flex; flex-direction: column; min-height: 0; }
    gf-plant-list { flex: 1; min-height: 0; transition: opacity 0.2s; }
    /* A new answer of the zone coming (state.js updating): its rows dimmed until they are replaced (after a moment: a
       quick one never flashes) — never the lines that say what is happening (the zone, « recherche… »), nor their buttons. */
    :host([updating]) gf-plant-list { opacity: 0.55; transition: opacity 0.2s 0.15s; }
    .scope { flex: none; display: flex; align-items: center; gap: 6px; padding: 4px 12px; font-size: 0.78rem; color: var(--gf-text-muted); border-bottom: 1px solid var(--gf-border); background: var(--gf-bg); }
    .scope span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .scope.error { color: var(--gf-danger); }
    .scope button { min-height: 0; padding: 0; }
  `];

  #size = new ResizeObserver(([e]) => { const wide = e.contentRect.width >= GRID_MIN; if (wide !== this._wide) this._wide = wide; });
  /** Its group's search: its results kept to what a map shows of the zone, said (inZone). */
  #store = new SearchController(this);

  constructor() {
    super();
    // A plant hovered (a map's point, a row): its row lit.
    new StateController(this, { hover: () => this.requestUpdate() });
    /** @type {LayoutState | null} */ this.state = null;
    /** The search of its group (core/search-channel.js); none: the app's. @type {import('../core/search-channel.js').Channel | null} */ this.channel = null;
    /** @type {Record<string, any>} */ this.params = {};
    this._wide = false;
  }

  connectedCallback() { super.connectedCallback(); this.#size.observe(this); }

  /** Shown as a grid now (view=grid, or auto and wide): its cell's head says so (gf-layout.js, its list / grid switch). */
  get grid() { const v = this.params?.view ?? 'auto'; return v === 'grid' || (v === 'auto' && this._wide); }

  /** @param {Map<string, any>} changed */
  updated(changed) {
    // (zone=0: the whole flora's rows, which no answer of the zone replaces.)
    this.toggleAttribute('updating', Boolean(this.state?.updating) && this.params?.zone !== false);
    if (changed.has('_wide')) this.dispatchEvent(new CustomEvent('results-shown', { bubbles: true, composed: true }));
  }
  disconnectedCallback() { super.disconnectedCallback(); this.#size.disconnect(); }

  render() {
    const s = this.state;
    if (!s) return nothing;
    const grid = this.grid;
    // zone=0: the search over the whole flora, whatever the zone (state.js#wholeOf, asked by the layout), said so — its
    // plants once it answered the search on screen; until then, the rows of its answer before (another text, another
    // sort: the list stays, its rows, its headers and its focus with it; another screen's never: state.js forgetWhole),
    // and « Aucune plante… » never said.
    if (this.params.zone === false) {
      const whole = s.whole, answered = whole?.key === s.wholeFor;
      return html`${s.live.at ? html`<div class="scope" role="note">${icon('globe-europe-africa')}<span>Toute la France : cette case ne suit pas la zone.</span></div>` : nothing}
        <gf-plant-list ?grid=${grid} .compact=${Boolean(this.params.compact)} .current=${s.live.plant} .items=${whole?.items ?? []} .answered=${answered} .channel=${this.channel}
          .lit=${s.hover?.plant ?? null} @plant-hover=${(/** @type {CustomEvent} */ e) => this.#onHover(e)}></gf-plant-list>`;
    }
    const note = s.live.at ? scopeNote(s) : '';
    // Kept to what a map shows of the zone (moved by hand: state.js setView): said, with the way back.
    const results = this.#store.state.results;
    const zoneOf = s.live.at && results.inZone ? results.inZone.length : null;
    // The map that leads it pinned to fewer sources than its group's (its src=): their plants alone, said.
    const kinds = s.view?.kinds, group = s.filters.sources, kept = group.filter(x => kinds?.includes(x));
    const pinned = kinds && kept.length < group.length ? ` (${kept.length ? sourcesText(kept) + ' seul' : 'aucune source'})` : '';
    return html`${s.live.at ? html`<div class="scope ${s.speciesState === 'error' ? 'error' : ''}" role="status">${icon('crosshair')}<span title=${note}>${scopeWords(s)} · ${note}</span>
        <button class="link" type="button" @click=${() => s.setScope(null)}>Toute la France</button></div>` : nothing}
      ${zoneOf !== null ? html`<div class="scope view" role="status">${icon('map')}<span>Dans la vue de la carte${pinned} : ${counted(results.total, 'plante')} sur ${zoneOf.toLocaleString('fr-FR')}</span>
        <button class="link" type="button" @click=${() => s.wholeZone()}>Toute la zone</button></div>` : nothing}
      <gf-plant-list ?grid=${grid} .compact=${Boolean(this.params.compact)} .current=${s.live.plant} .channel=${this.channel} .obs=${this.#obs(s)}
        .empty=${zoneOf !== null ? 'Rien d’observé dans ce que montre la carte : déplacez-la, ou voyez toute la zone.' : null}
        .lit=${s.hover?.plant ?? null} @plant-hover=${(/** @type {CustomEvent} */ e) => this.#onHover(e)}></gf-plant-list>`;
  }

  /** A row hovered, or no more (gf-plant-card `plant-hover`): the maps beside light its plant's points (state.js hover). @param {CustomEvent} e */
  #onHover(e) {
    const { id, on } = e.detail;
    if (on) this.state?.hoverOn(id, 'list');
    else this.state?.hoverOff(id, 'list');
  }

  /**
   * Each plant's observations in the zone, in words (core/observations.js obsNotes: its rows say them, its grid has their
   * column): the same Map while they are the same; none without a zone. @param {LayoutState} s
   */
  #obs(s) {
    const c = s.live.at ? s.obsCounts : null;
    if (this.#obsFor !== c) { this.#obsFor = c; this.#obsMemo = c ? obsNotes(c.counts, c.sources) : null; }
    return this.#obsMemo;
  }
  /** @type {LayoutState['obsCounts']} */ #obsFor = null;
  /** @type {ReturnType<typeof obsNotes> | null} */ #obsMemo = null;
}
customElements.define('dl-results', DlResults);

// ── search ───────────────────────────────────────────────────────────────────────────────────────────────────

export class DlSearch extends LitElement {
  static properties = { state: { attribute: false }, params: { attribute: false }, channel: { attribute: false }, _filters: { state: true } };

  /* A cell lower than its bar (a narrow one, where the bar folds onto more lines; a short row: « Étude », « Grille et
     photos » at 720 px, or on a phone): the cell scrolls, never cuts the bar's last lines (the chips, « Filtrer par »)
     out of reach — the cell around it clips. Below the bar, the filters opened and the list keep a little room of
     their own (reached by scrolling the cell), never squeezed to nothing under a tall bar. */
  static styles = [ui, css`
    :host { display: flex; flex-direction: column; min-height: 0; overflow-y: auto; }
    gf-results-bar { flex: none; }
    .filters { flex: none; max-height: 45%; overflow-y: auto; padding: 0 12px; border-bottom: 1px solid var(--gf-border); background: var(--gf-surface); }
    :host([no-list]) .filters { flex: 1; max-height: none; min-height: 8rem; }
    /* (A new answer of the zone coming: dl-results dims its own rows — its bar, being typed in, never.) */
    dl-results { flex: 1; min-height: 8rem; }
  `];

  constructor() {
    super();
    new StateController(this);
    /** @type {LayoutState | null} */ this.state = null;
    /** The search of its group (core/search-channel.js); none: the app's. @type {import('../core/search-channel.js').Channel | null} */ this.channel = null;
    /** @type {Record<string, any>} */ this.params = {};
    /** @type {boolean | null} the filters brought into view by a column's funnel, until the cell's parameter says it (null: as it says) */
    this._filters = null;
  }

  /** A facet brought into view (a column's funnel in a list): the filters opened on it. @param {string} facet */
  async revealFacet(facet) {
    this._filters = true;
    if (!this.params.filters) setCell(this, { filters: true });
    await this.updateComplete;
    return revealFacet(this.renderRoot.querySelector('gf-filter-panel'), facet);
  }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) { if (changed.has('params')) this._filters = null; }

  updated() { this.toggleAttribute('no-list', this.params.list === false); }

  render() {
    const open = this._filters ?? Boolean(this.params.filters);
    const list = this.params.list !== false;
    // Its rows compact: its own (compact=, its bar's button), none without its list, nor while it shows a grid (wide).
    const compact = Boolean(this.params.compact);
    const grid = Boolean(/** @type {any} */ (this.renderRoot?.querySelector('dl-results'))?.grid);
    return html`<gf-results-bar .wide=${false} count-above .channel=${this.channel} .compact=${list && !grid ? compact : null}
        @open-filters=${(/** @type {Event} */ e) => { e.stopPropagation(); this._filters = !open; setCell(this, { filters: !open }); }}
        @compact-change=${(/** @type {CustomEvent} */ e) => setCell(this, { compact: e.detail.compact })}></gf-results-bar>
      ${open ? html`<div class="filters" role="region" aria-label="Filtres">${filterPanel(this.state, this.channel)}</div>` : nothing}
      ${list ? html`<dl-results .state=${this.state} .params=${{ view: 'auto', compact }} .channel=${this.channel} aria-busy=${this.state?.updating ? 'true' : nothing}
        @results-shown=${() => this.requestUpdate()}></dl-results>` : nothing}`;
  }
}
customElements.define('dl-search', DlSearch);

/**
 * The filters of a layout's search: Flore's panel (gf-filter-panel), « Observations de la zone » first when its group has a
 * zone (obs-filters.js: where its observations come from, which of them count). @param {LayoutState | null} state
 * @param {import('../core/search-channel.js').Channel | null} channel
 */
const filterPanel = (state, channel) => {
  const zone = Boolean(state?.live.at);
  return html`<gf-filter-panel .channel=${channel} .lead=${zone ? 1 : 0}>${zone ? html`<dl-obs-filters slot="lead" .state=${state}></dl-obs-filters>` : nothing}</gf-filter-panel>`;
};

/** A filter of a filters panel opened and scrolled to, flashing a moment. @param {Element | null} panel @param {string} facet */
export async function revealFacet(panel, facet) {
  await /** @type {any} */ (panel)?.updateComplete;
  const el = /** @type {any} */ (panel?.shadowRoot?.querySelector(`gf-facet[name="${facet}"]`));
  if (!el) return false;
  await el.reveal();
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1200);
  return true;
}

// ── a cell ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * What a cell shows: its component's piece, given the state; an unknown component: what is wrong and how to fix it.
 * @param {Resolved} r @param {{ state: LayoutState, view: string, plant: number | null, first: { id: number, name: string } | null,
 *   editing?: boolean, channel?: import('../core/search-channel.js').Channel | null }} ctx  `editing`: the screen being modified; `channel`:
 *   the search of the cell's group (its own, never Flore's)
 */
export function renderCell(r, ctx) {
  if (!r.known) {
    const u = /** @type {{ name: string, suggestion: string | null }} */ (/** @type {unknown} */ (r));
    return html`<div class="placeholder" role="note">${icon('exclamation-triangle-fill')}
      <p><b>Composant inconnu : « ${u.name} »</b></p>
      <p>${u.suggestion ? html`Vouliez-vous dire <code>${u.suggestion}</code> ? ` : nothing}Les composants : <code>map</code>, <code>search</code>, <code>filters</code>,
        <code>results</code>, <code>plant</code> (ou <code>plant.wikipedia</code>, <code>plant.calendar</code>…), <code>media</code>, <code>deck</code>, <code>place</code>.</p>
      <p>« Modifier », puis ${icon('sliders')} « Choisir le contenu » sur cette case, pour le corriger.</p></div>`;
  }
  const { state } = ctx;
  const id = r.spec.id;
  const channel = ctx.channel ?? null;
  if (id === 'map') return html`<dl-map .state=${state} .params=${r.params} .channel=${channel} .editing=${Boolean(ctx.editing)}></dl-map>`;
  if (id === 'place') return html`<dl-place .state=${state}></dl-place>`;
  if (id === 'search') return html`<dl-search .state=${state} .params=${r.params} .channel=${channel}></dl-search>`;
  if (id === 'results') return html`<dl-results .state=${state} .params=${r.params} .channel=${channel}></dl-results>`;
  if (id === 'filters') return html`<div class="scroll pad">${filterPanel(state, channel)}</div>`;
  if (id === 'deck') return html`<dl-deck .state=${state} .params=${r.params} .channel=${channel}></dl-deck>`;
  // A plant cell: its own plant (plante=: fixed, whatever the current one), else the current plant, or how to choose one.
  const plant = r.params.plante ?? ctx.plant;
  if (plant == null) {
    return html`<div class="placeholder quiet" role="note">${icon(cellIcon(r))}<p>Aucune plante choisie : touchez un résultat, un point de la carte ou une carte.</p>
      ${ctx.first ? html`<button type="button" @click=${() => state.pick(/** @type {any} */ (ctx.first).id)}>Voir ${ctx.first.name}</button>` : nothing}</div>`;
  }
  const view = r.params.mode ?? ctx.view;
  if (id === 'media') {
    // A block of its own among the cells (local): drawn by itself (its plant come), it never takes the focus from where
    // it is (⋯ open, a search being typed); nothing to close.
    return moduleOn('photos')
      ? html`<gf-media-viewer local plant-id=${plant} presentation=${r.params.style ?? blockStyle(/** @type {any} */ (view), 'media')}></gf-media-viewer>`
      : html`<p class="placeholder quiet">${photosOffLine()}</p>`;
  }
  // Among the cells (local): its photos block (plant.media) drawn by itself never takes the focus either.
  return r.view
    ? html`<gf-sheet-block local key=${r.view.key} plant-id=${plant} view=${view} .channel=${channel}></gf-sheet-block>`
    : html`<gf-plant-detail embedded subheading plant-id=${plant} view=${view} .channel=${channel}></gf-plant-detail>`;
}
