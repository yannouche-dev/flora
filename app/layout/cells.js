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
//    origin, taken back as left (DeckSession).
// What is done in a cell with its own controls is kept in the layout (`cell-param` {key: value…}, gf-layout.js: the
// address is the app, sent as it is): a map's 3D, background, layers (their order, IGN's catalogue, their opacity),
// period, « Seule », legend, binoculars (« Observations autour » in 3D), its points' sources and the current plant's
// (« Sur cette carte » of its panel ▦), and its view (vue=: while the screen is modified, any map's; in use, the one
// leading the list's); the search's filters opened; the results as a list or a grid.
// A link to a plant's sheet anywhere in a cell (a result, a look-alike) makes it the current plant (gf-layout.js, core/embed-links.js).
// The frame every cell shares (registry.js#FRAME: its head, its actions, its empty state) is gf-layout.js'; its links
// are honoured here: a plant of its own (plante=: renderCell), the whole flora instead of the zone (results zone=0:
// DlResults, state.js#wholeOf), a card touched and the swipes (toucher, ecrit=0: DlDeck); the deck tells the layout
// when it has no cards (`cell-empty`), for a deck that hides meanwhile (vide=masque).
// The map cell (dl-map) is map-cell.js'; the others are here, with renderCell.
// What the cells share (the state watched, the scope in words, its line and its slider): cell-kit.js.

import { LitElement, html, css, nothing } from 'lit';
import { icon } from '../core/icons.js';
import { moduleOn } from '../core/modules.js';
import { SearchController } from '../core/search-channel.js';
import { blockStyle } from '../core/sheet-blocks.js';
import { href } from '../core/router.js';
import { getPlant, nameOf } from '../core/plants.js';
import { counted } from '../core/fr.js';
import { verdictOf } from '../core/alerts.js';
import { addFavorite, forgetFavoriteEntry, isFavorite } from '../core/collections.js';
import { ui } from '../styles/ui.js';
import { photosOffLine } from '../components/ui-kit.js';
import { cardOf, saidOf } from '../miniapp/kit/cards.js';
import { SwipeCore, memoryStore } from '../miniapp/kit/swipes.js';
import { pushHash } from '../core/history.js';
import { cellIcon } from './registry.js';
import { SOURCE_NAMES, failedText, obsNotes, sourcesText } from '../core/observations.js';
import { StateController, locateOnce, nameScope, periodWords, radiusSlider, scopeNote, scopeStyles, scopeWords, setCell, where } from './cell-kit.js';
import './map-cell.js';
import '../components/gf-place-search.js';
import '../components/gf-results-bar.js';
import '../components/gf-filter-panel.js';
import './obs-filters.js';
import '../components/gf-plant-list.js';
import '../components/gf-plant-detail.js';
import '../components/gf-sheet-block.js';
import '../components/gf-media-viewer.js';
import { NO_MATCH } from '../miniapp/kit/ma-deck.js';

/**
 * @typedef {import('./state.js').LayoutState} LayoutState
 * @typedef {import('./registry.js').Resolved} Resolved
 * @typedef {import('../miniapp/kit/cards.js').Card} Card
 * @typedef {import('../miniapp/kit/ma-deck.js').DeckHost} DeckHost
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
        <gf-plant-list ?grid=${grid} .current=${s.live.plant} .items=${whole?.items ?? []} .answered=${answered} .channel=${this.channel}
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
      <gf-plant-list ?grid=${grid} .current=${s.live.plant} .channel=${this.channel} .obs=${this.#obs(s)}
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
    return html`<gf-results-bar .wide=${false} count-above .channel=${this.channel} @open-filters=${(/** @type {Event} */ e) => { e.stopPropagation(); this._filters = !open; setCell(this, { filters: !open }); }}></gf-results-bar>
      ${open ? html`<div class="filters" role="region" aria-label="Filtres">${filterPanel(this.state, this.channel)}</div>` : nothing}
      ${list ? html`<dl-results .state=${this.state} .params=${{ view: 'auto' }} .channel=${this.channel} aria-busy=${this.state?.updating ? 'true' : nothing}></dl-results>` : nothing}`;
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

// ── deck ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The favourites of a screen's hearts (kit/swipes.js's policy): without origin — a screen is not an activity, no
 * « Recommencer » takes them away —, added only if the plant is not one (a heart never removes a favourite). ↺ takes
 * back the entry its heart added, and only as that heart left it (core/collections.js#forgetFavoriteEntry compares its
 * notes, rating, abundance and harvests: one of them given since, it is the user's and stays; filed in a list, noted in
 * a lieu, given a sheet's note or shared since, it still goes — the list or the lieu keeps the plant). A plant already
 * a favourite — one an activity made too — gets nothing from a heart here: it stays that activity's, and that
 * activity's « Recommencer » still removes it. No fallback: forget(id, null) takes back nothing.
 * @type {import('../miniapp/kit/swipes.js').FavouritePolicy}
 */
const entryFavourites = {
  has: isFavorite,
  add: plant => addFavorite(plant).catch(() => null),
  forget: (_id, e) => (e ? forgetFavoriteEntry(e.id, e) : Promise.resolve(false))
};

/**
 * Rencontres' deck (ma-deck) asks its host (kit/ma-deck.js DeckHost) for its cards and a few things more: this one
 * gives the plants found in the scope, the current plant on top. Its swipes on the swipe core (kit/swipes.js), in
 * memory (this screen's: forgotten when it goes), its favourites without origin, taken back as left (entryFavourites);
 * no toxic side (a screen's deck is not an activity: never « to avoid »), no Wikipédia sentence (the sheet is beside).
 * @implements {DeckHost}
 */
class DeckSession extends EventTarget {
  #store = memoryStore();

  constructor() {
    super();
    /** @type {Card[]} */ this.cards = [];
    /** @type {number | null} */ this.top = null;
    /** The scope's radius (m): « Chercher jusqu’à … » past it. */
    this.radius = 0;
    this.hinted = false;
    this.core = new SwipeCore({ store: this.#store, favourites: entryFavourites, avoids: () => false });
    this.core.addEventListener('change', () => this.changed());
  }

  changed() { this.dispatchEvent(new Event('change')); }

  /** @type {{ s: import('../miniapp/kit/cards.js').Swipes, radius: number, c: Record<string, any> } | null} */ #c = null;
  /** What ma-deck reads of the swipes, and the radius: a new object only when one of them changed. */
  get c() {
    const s = this.#store.read();
    if (this.#c?.s !== s || this.#c.radius !== this.radius) this.#c = { s, radius: this.radius, c: { ...s, radius: this.radius } };
    return this.#c.c;
  }
  /** ↺: the last swipes, to undo. */
  get history() { return this.core.history; }
  /** A heart flying off the deck. */
  get burst() { return this.core.burst; }
  /** The cards not swiped, the current plant first. */
  get deck() { return this.core.deck(this.cards, this.top); }
  get matchCards() { return this.core.matchCards(this.cards); }
  /** None: no toxic side. @returns {Card[]} */
  get avoidCards() { return []; }
  /** Never « recognised, to avoid ». @returns {boolean} */
  avoids() { return false; }
  /** The swipe hint, once per deck shown (this element's). */
  hintOnce() { if (this.hinted) return false; this.hinted = true; return true; }
  /** No Wikipédia sentence on these cards (their sheet is beside). @returns {null} */
  ethnoOf() { return null; }
  /** @type {(m: number) => void} */ widen = () => {};
  resetPassed() { this.core.reset(); }
}

/** Cards past this many results are not made (the deck is a walk through the first ones: its end says so). */
const DECK_MAX = 60;

/** The hearts counted at the end of the deck (a screen has no tab « Matchs »). @param {number} n */
const heartsKept = n => (n ? `${n} coup${n > 1 ? 's' : ''} de cœur dans vos favoris.` : NO_MATCH);

export class DlDeck extends LitElement {
  static properties = { state: { attribute: false }, params: { attribute: false }, channel: { attribute: false }, _loading: { state: true }, _said: { state: true } };

  static styles = [ui, css`
    :host { display: block; overflow-y: auto; padding: 12px 8px; container-type: size; --deck-max: calc(100cqh - 150px); --deck-min: 220px; }
    .empty { display: grid; gap: 10px; justify-items: center; padding: 24px 12px; text-align: center; color: var(--gf-text-muted); }
    .empty .big { font-size: 2rem; color: var(--gf-accent); margin: 0; }
    .empty .big.warn { color: var(--gf-warn); }
    /* A new answer of the zone coming (state.js updating): its cards dimmed until they are replaced (after a moment: a
       quick one never flashes) — never what it says (« Les cartes arrivent… »). */
    ma-deck { transition: opacity 0.2s; }
    :host([updating]) ma-deck { opacity: 0.55; transition: opacity 0.2s 0.15s; }
  `];

  #store = new SearchController(this);
  #session = new DeckSession();
  /** Plant records read for the cards, by id. @type {Map<number, any>} */
  #plants = new Map();
  #cardsFor = '';
  /** The zone's plants the cards are the first of (DECK_MAX): their end says it when there are more. */
  #of = 0;
  /** What the deck's end says (ma-deck DeckEnd), made again only when the plants it counts change. @type {{ of: number, end: import('../miniapp/kit/ma-deck.js').DeckEnd } | null} */
  #endFor = null;

  constructor() {
    super();
    new StateController(this);
    /** @type {LayoutState | null} */ this.state = null;
    /** The search of its group (core/search-channel.js); none: the app's. @type {import('../core/search-channel.js').Channel | null} */ this.channel = null;
    /** @type {Record<string, any>} */ this.params = {};
    this._loading = false;
    /** What the last swipe did, said aloud (kit/cards.js#saidOf: the activities' words). */
    this._said = '';
    this.#session.widen = m => this.state?.set({ r: m }, 'replace');
    this.#session.addEventListener('change', () => this.requestUpdate());
    this.addEventListener('deck-decide', e => { e.stopPropagation(); this.#decide(/** @type {CustomEvent} */ (e).detail); });
    // A card's sheet asked for (a touch, a swipe up, ↑, « ⋯ »): only when touching opens it (ma-deck `opens`).
    this.addEventListener('deck-open', e => {
      e.stopPropagation();
      if (this.#touch === 'fiche') pushHash(href.plant(/** @type {CustomEvent} */ (e).detail.id));
    });
    this.addEventListener('deck-undo', e => { e.stopPropagation(); this.#undo(); });
  }

  /** The deck changes the current plant (its swipes, its first card): not with ecrit=0 — its cards then go their own way. */
  get #writes() { return this.params?.ecrit !== false; }

  /**
   * What touching a card does, as the cell says (toucher, ecrit: registry.js#touchOf): its sheet, or nothing — with
   * toucher=plante, the deck chooses by its swipes (the card on top, most often the current plant already; not when a
   * plant loved here was chosen elsewhere: it stays out): its touch, ↑ and « ⋯ » do nothing, none shown.
   * @returns {'plante' | 'fiche' | 'rien'}
   */
  get #touch() {
    const t = this.params?.toucher;
    return t === 'rien' ? 'rien' : t === 'fiche' || !this.#writes ? 'fiche' : 'plante';
  }

  /** Nothing to show (registry.js#FRAME, vide): told to the layout (gf-layout.js: a cell vide=masque hidden meanwhile). */
  #empty = /** @type {boolean | null} */ (null);

  /**
   * Whether the deck has cards to show: none without a zone, nor when the zone's plants could not be had, nor when the
   * zone has none; while they come — its search not answered yet too —, not empty. The cards swiped do not count: the
   * deck's end is something to show.
   */
  updated() {
    const s = this.state;
    this.toggleAttribute('updating', Boolean(s?.updating));
    if (!s) return;
    const empty = !s.live.at || s.speciesState === 'error' || (s.speciesState === 'ready' && this.#store.answered && !this._loading && !this.#session.cards.length);
    if (empty === this.#empty) return;
    this.#empty = empty;
    this.dispatchEvent(new CustomEvent('cell-empty', { detail: { empty }, bubbles: true, composed: true }));
  }

  /**
   * The cards: the plants found in the scope (the first DECK_MAX, in the search's order), and the current plant when
   * it is not among them (on top: the deck always shows it); made again when they change. Not before the scope's
   * plants are known (the search is not kept to them yet): « Les cartes arrivent… » while they come — and only then:
   * the zone's sources failing, the deck says so (render), never waits for cards that will not come.
   */
  async #cards() {
    const s = /** @type {LayoutState} */ (this.state);
    const species = s.species;
    if (!species) { this._loading = s.speciesState === 'loading'; return; }
    // The zone's plants, even while the list keeps to what a map shows of it — the first DECK_MAX (more: said at its end).
    const results = this.#store.state.results;
    const all = (results.inZone ?? results.items.map(p => p.id)).filter(id => species.byPlant.has(id));
    const ids = all.slice(0, DECK_MAX);
    this.#of = all.length;
    const current = s.live.plant;
    if (current != null && !ids.includes(current)) ids.unshift(current);
    const key = species.key + '|' + ids.join(',');
    if (key === this.#cardsFor) return;
    this.#cardsFor = key;
    this._loading = true;
    const month = new Date().getMonth();
    const cards = (await Promise.all(ids.map(async id => {
      const plant = this.#plants.get(id) ?? await getPlant(id);
      if (!plant) return null;
      this.#plants.set(id, plant);
      return cardOf(plant, species.byPlant.get(id), month);
    }))).filter(c => c !== null);
    if (key !== this.#cardsFor) return;
    this.#session.cards = /** @type {Card[]} */ (cards);
    this._loading = false;
    // Their verdict (local data; protection at the zone's point), as it comes: never a card without it once known.
    for (const c of this.#session.cards) verdictOf(c.plant, { at: s.live.at }).then(v => { c.verdict = v; this.#session.changed(); }, () => {});
    // No plant chosen yet: the card on top is the current plant.
    const first = this.#session.deck[0];
    if (first && s.live.plant == null && this.#writes) s.pick(first.plant.id, { how: 'replace' });
    this.#session.changed();
  }

  /**
   * A card swiped (kit/swipes.js): a heart (a favourite — added only if it is not one: a heart never removes a
   * favourite) and its heart flying off, or passed; a card decided already (a second click while it flew): nothing.
   * Said aloud, as in the activities (« Match : Ail des ours, ajoutée aux favoris. Carte suivante : … »). The next one
   * on top is the current plant. @param {{ card: Card, liked: boolean }} d
   */
  #decide({ card, liked }) {
    const ses = this.#session;
    const r = ses.core.decide(card, liked);
    if (!r) return;
    if (r.side === 'match') ses.core.heart();
    // The card now on top: the deck's next (made the current plant) — ecrit=0: the current plant's, while it is there.
    this.#undone = null;
    ses.top = this.#writes ? null : this.state?.live.plant ?? null;
    const next = ses.deck[0];
    this._said = saidOf({ name: nameOf(card.plant), side: r.side, fav: r.fav, next: next ? nameOf(next.plant) : null });
    if (next && this.#writes) this.state?.pick(next.plant.id, { how: 'replace' });
  }

  /**
   * ↺: the last card swiped back on top — a heart that made a favourite: out of the favourites again, only that entry
   * and only as it left it (entryFavourites: a note, a rating, a harvest given since — the user's, kept). The current
   * plant again; ecrit=0, on top until the current plant changes or the next swipe.
   */
  #undo() {
    const last = this.#session.core.undo();
    if (!last) return;
    this.#undone = last.id;
    if (this.#writes) this.state?.pick(last.id, { how: 'replace' });
  }

  /** The current plant last seen (undefined: none yet): a new one, chosen elsewhere, comes on top. @type {number | null | undefined} */
  #plantSeen = undefined;
  /** The card ↺ brought back: on top until the current plant changes or the next swipe (ecrit=0). @type {number | null} */
  #undone = null;

  willUpdate() {
    const s = this.state;
    if (!s?.live.at) return;
    this.#cards();
    const ses = this.#session, plant = s.live.plant;
    if (plant !== this.#plantSeen) {
      this.#plantSeen = plant;
      this.#undone = null;
      // Chosen elsewhere, passed here before: back in the deck, on top — as in Rencontres —, its pass out of ↺ (a ↺
      // of it would show nothing: the next one goes to the swipe before). One loved stays out (its heart made it a
      // favourite). The deck's own choices (its next card, its first) are never a card passed.
      if (plant != null && ses.core.swipes.passed.includes(plant)) ses.core.restore(plant, { dropSwipes: true });
    }
    ses.top = this.#undone ?? plant;
    ses.radius = s.radius;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Its heart flying off stopped; its swipes stay with it (back in the page, the same deck).
    this.#session.core.dispose();
  }

  render() {
    const s = this.state;
    if (!s) return nothing;
    if (!s.live.at) {
      return html`<div class="empty"><p class="big">${icon('heart-fill')}</p><p><b>Rencontrez les plantes d’un lieu.</b></p>
        <p>Choisissez une zone (sur la carte, ou « Autour de moi ») : ses plantes arrivent ici, une carte à la fois.</p>
        <button class="primary" type="button" @click=${() => locateOnce().then(at => { s.setScope(at, null); nameScope(s, /** @type {[number, number]} */ (s.live.at)); }, () => {})}>${icon('geo-alt')} Autour de moi</button></div>`;
    }
    const ses = this.#session;
    if (s.speciesState === 'error') return this.#failed(s);
    // Its search not answered yet: the cards still coming, never the deck's end.
    if ((this._loading || !this.#store.answered) && !ses.cards.length) return html`<p class="empty" role="status">Les cartes arrivent…</p>`;
    // A source failing, no card from the others (no plant — GBIF's own, often none where iNaturalist's are —, or none
    // the search keeps): said as a failure, never the deck's end (« toutes les plantes du coin »).
    if (s.speciesState === 'ready' && s.failed.length && !ses.cards.length) return this.#failed(s);
    return html`<ma-deck active .session=${ses} .cards=${ses.deck} .c=${ses.c} .end=${this.#end()} .opens=${this.#touch === 'fiche'}></ma-deck>
      <p class="visually-hidden" role="status">${this._said}</p>`;
  }

  /**
   * What its end says: the hearts counted, in the favourites (never « Matchs »: a screen has no such tab); more plants
   * than cards, that it met the first ones, and the way to the others (never « toutes »).
   */
  #end() {
    const of = this.#of > DECK_MAX ? this.#of : 0;
    if (this.#endFor?.of !== of) {
      this.#endFor = { of, end: of ? { title: `Vous avez rencontré les ${DECK_MAX} premières plantes du coin (sur ${of.toLocaleString('fr-FR')}).`,
        kept: heartsKept, note: 'Cherchez ou filtrez pour voir les autres.' } : { kept: heartsKept } };
    }
    return this.#endFor.end;
  }

  /**
   * The scope's plants could not be had (its sources down, offline, their modules off) — or only some of its sources
   * answered, with no card (`ready`: those that failed named; the others said to have seen no plant, or none that the
   * search keeps — its words, its filters): no cards — said, with what to do (« Réessayer », or the module turned on),
   * instead of cards of another scope or a wait without end.
   * @param {LayoutState} s
   */
  #failed(s) {
    const partial = s.speciesState === 'ready';
    const off = partial ? s.failed.every(f => f.off) : s.speciesFailure === 'off';
    // The zone's sources (core/observations.js): « iNaturalist », « iNaturalist et GBIF » — those that failed, when
    // the others answered.
    const failing = partial ? s.failed.map(f => f.name) : s.filters.sources.map(x => SOURCE_NAMES[x]);
    const names = failing.join(' et '), many = failing.length > 1;
    const others = s.filters.sources.filter(x => !failing.includes(SOURCE_NAMES[x]));
    const why = s.speciesFailure === 'offline' ? `Hors ligne : ${names} ${many ? 'sont injoignables' : 'est injoignable'}.` : `${failedText(s.failed)}.`;
    const seen = `${/^[aeiouy]/i.test(names) ? 'qu’' : 'que '}${names} ${many ? 'ont vues dans la zone : sans eux' : 'a vues dans la zone : sans lui'}`;
    const later = off ? '' : ' pour l’instant';
    // The others' plants: none seen (in the period), or none that the search keeps (the cards are its plants of the zone).
    const them = sourcesText(others), plural = others.length > 1, when = periodWords(s);
    const none = !s.species?.list.length ? `${them} ${plural ? 'n’ont' : 'n’a'} vu aucune plante dans la zone${when}`
      : `Aucune des plantes ${/^[aeiouy]/i.test(them) ? 'qu’' : 'que '}${them} ${plural ? 'ont' : 'a'} vues dans la zone${when} ne correspond à la recherche`;
    return html`<div class="empty" role="status"><p class="big warn">${icon('exclamation-triangle-fill')}</p><p><b>${why}</b></p>
      <p>${partial ? `${none} ; sans ${names}, pas de cartes${later}.` : `Les cartes sont les plantes ${seen}, pas de cartes${later}.`}</p>
      ${off ? html`<p><a href=${href.settings()}>Réglages › Modules</a></p>`
        : html`<button class="primary" type="button" @click=${() => s.retryScope()}>${icon('arrow-counterclockwise')} Réessayer</button>`}</div>`;
  }
}
customElements.define('dl-deck', DlDeck);

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
