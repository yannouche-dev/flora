// @ts-check
// A screen's deck cell (« Écran sur mesure »: cells.js says what each cell shows, renderCell draws it): dl-deck,
// Rencontres' cards (miniapp/kit/ma-deck.js) for the plants found in the scope, the one on top the current plant; on
// the swipe core (miniapp/kit/swipes.js), its swipes in memory (DeckSession), its hearts favourites without origin,
// taken back as left (entryFavourites); its empty state told to the layout (`cell-empty`).

import { LitElement, html, css, nothing } from 'lit';
import { icon } from '../core/icons.js';
import { SearchController } from '../core/search-channel.js';
import { href } from '../core/router.js';
import { getPlant, nameOf } from '../core/plants.js';
import { verdictOf } from '../core/alerts.js';
import { addFavorite, forgetFavoriteEntry, isFavorite } from '../core/collections.js';
import { ui } from '../styles/ui.js';
import { cardOf, saidOf } from '../miniapp/kit/cards.js';
import { SwipeCore, memoryStore } from '../miniapp/kit/swipes.js';
import { pushHash } from '../core/history.js';
import { SOURCE_NAMES, failedText, sourcesText } from '../core/observations.js';
import { StateController, locateOnce, nameScope, periodWords } from './cell-kit.js';
import { NO_MATCH } from '../miniapp/kit/ma-deck.js';

/**
 * @typedef {import('./state.js').LayoutState} LayoutState
 * @typedef {import('../miniapp/kit/cards.js').Card} Card
 * @typedef {import('../miniapp/kit/ma-deck.js').DeckHost} DeckHost
 */

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
