// @ts-check
// The plants observed around a place, as a page: where and how far (« Distance », « Changer de lieu »), and three
// views — « Rencontres » (the deck: kit/ma-deck.js), « Matchs » (the cards swiped right, each to take back), « Toutes »
// (a grid; Mosaïque: large photos, the names over them, « En fleur maintenant » filters, a touch opens the plant at its
// images). Cueillette prudente says first, in red, never to pick without a certain identification, that each plant here
// has a dangerous look-alike (Anses, Centres antipoison) and whom to call; its list unreadable, it says so (every plant
// kept). The first match during the first steps: a screen of its own (« C’est un match ! »). A plant open (?p=): its
// sheet beside the list (kit/ma-plant-sheet.js). The step « cards » of Cueillette prudente, Mosaïque, and Rencontres
// once its first steps are over.

import { LitElement, html, css, nothing } from 'lit';
import { icon } from '../../core/icons.js';
import { hideImg, showImg } from '../../core/img.js';
import { creditText } from '../../core/credit.js';
import { discoverEvents, discoverState, discovering, firstMatchShown, plantSeen, PLANTS_BEFORE_FLORE } from '../../core/discover.js';
import { UNREAD_LOOKALIKES } from '../../core/lookalikes.js';
import { moduleEvents, moduleOn } from '../../core/modules.js';
import { openModal } from '../../core/history.js';
import { sheetSession } from '../../core/sheet-session.js';
import { plantViewOf, StoreController } from '../../core/store.js';
import { emergency } from '../../components/gf-lookalikes.js';
import { ui } from '../../styles/ui.js';
import { MONTH, PAGE, distLabel, nameOf, nextDistance } from './cards.js';
import { sessionOf } from './session.js';
import './ma-deck.js';
import './ma-plant-sheet.js';

/** @typedef {import('./cards.js').Card} Card */

export class MaAroundList extends LitElement {
  static properties = {
    app: { attribute: false },
    /** The app's context (the place, the distance, the swipes, the plant open). */
    c: { attribute: false },
    /** Cueillette prudente: only the plants of a dangerous confusion, its warnings. */
    harvest: { type: Boolean },
    /** Mosaïque: « Toutes » as a mosaic of large photos, « En fleur maintenant ». */
    mosaic: { type: Boolean },
    /** Its name before « Autour de … » (Cueillette prudente, Mosaïque); none for Rencontres. */
    heading: {},
    /** The view it opens on: 'swipe' (one card at a time) or 'all' (Mosaïque). */
    view: {},
    /** The match just made (its card), celebrated. */
    _match: { state: true },
    /** What a swipe did, said to a screen reader (a match, a plant passed, the next card). */
    _said: { state: true },
    /** Mosaïque: only the plants in flower now. */
    _bloomOnly: { state: true }
  };

  static styles = [ui, css`
    :host { display: block; position: relative; min-height: 0; overflow-y: auto; background: var(--gf-bg, var(--gf-surface-2)); container-type: inline-size; }
    .error { color: var(--gf-danger); font-size: 0.9rem; }
    .list { padding: 14px 16px 90px; max-width: 1100px; margin: 0 auto; }
    .head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin-bottom: 12px; }
    .head h1 { margin: 0; font-size: 1.25rem; }
    .head .where { color: var(--gf-text-muted); font-size: 0.9rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
    @container (min-width: 700px) { .grid { grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 12px; } }
    .card { position: relative; display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start; min-height: 0; border: 0; padding: 0; border-radius: var(--gf-radius); overflow: hidden; background: var(--gf-surface);
      box-shadow: var(--gf-shadow); text-align: left; font: inherit; color: var(--gf-text); cursor: pointer; transition: transform 0.15s; }
    .card:hover { transform: translateY(-2px); }
    .card:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .card[aria-current='true'] { box-shadow: 0 0 0 3px var(--gf-accent); }
    .card .ph { position: relative; width: 100%; aspect-ratio: 4 / 3; background: var(--gf-surface-2); overflow: hidden; }
    .card img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .card .txt { padding: 8px 10px 10px; display: grid; gap: 2px; }
    .card b { font-size: 1rem; }
    .card i { color: var(--gf-text-muted); font-size: 0.82rem; }
    .chips { position: absolute; top: 8px; left: 8px; right: 8px; display: flex; gap: 4px; flex-wrap: wrap; pointer-events: none; }
    .chip { padding: 2px 8px; border-radius: var(--gf-radius-pill); font-size: 0.72rem; font-weight: 600; background: rgb(255 255 255 / 92%); color: #1f3d1f; }
    .chip.bloom { background: #fdf3c4; color: #6b4e00; }
    .chip.warn { background: #fff1d6; color: var(--gf-warn); }
    .chip.danger { background: #fde2df; color: var(--gf-danger); }
    .seen { position: absolute; right: 8px; bottom: 54px; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--gf-accent); color: #fff; font-size: 0.75rem; }
    .more { display: block; margin: 16px auto 0; }
    .src { margin-top: 18px; font-size: 0.75rem; color: var(--gf-text-muted); text-align: center; }
    /* Cueillette prudente: never without a certain identification. */
    .banner-warn { margin: 0 0 12px; padding: 10px 12px; border-radius: var(--gf-radius); background: #fde2df; color: #7a1d16; font-size: 0.88rem; display: flex; gap: 8px; align-items: flex-start; }
    .banner-warn .sos-line { display: block; margin-top: 2px; }
    .banner-warn .sos a, .banner-warn .link { color: inherit; }
    .banner-warn .link { font-size: inherit; font-weight: 600; margin-left: 4px; }
    /* Mosaïque. */
    .bloom-only { display: flex; gap: 6px; align-items: center; justify-content: center; margin: 0 0 10px; font-size: 0.9rem; }
    .grid.mosaic { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); grid-auto-flow: dense; gap: 6px; }
    .grid.mosaic .card { border-radius: 10px; }
    .grid.mosaic .card:nth-child(5n + 1) { grid-column: span 2; grid-row: span 2; }
    .grid.mosaic .card .ph { aspect-ratio: 1; height: 100%; }
    .grid.mosaic .card .txt { position: absolute; left: 0; right: 0; bottom: 0; padding: 18px 8px 6px; background: linear-gradient(transparent, rgb(0 0 0 / 70%)); color: #fff; }
    .grid.mosaic .card i { color: #e6e6e6; }
    .mwrap { position: relative; display: grid; }
    .unmatch { position: absolute; z-index: 3; right: 6px; bottom: 6px; min-height: 28px; padding: 2px 10px; border-radius: var(--gf-radius-pill); border: 1px solid var(--gf-border); background: var(--gf-surface); font: inherit; font-size: 0.75rem; display: inline-flex; gap: 4px; align-items: center; cursor: pointer; }
    .views { display: flex; margin: 0 auto 14px; width: fit-content; }
    .views button[aria-selected='true'] { background: var(--gf-accent); color: var(--gf-accent-contrast); }
    .card .heart { position: absolute; z-index: 2; right: 8px; top: 8px; color: #e0245e; font-size: 1.2rem; filter: drop-shadow(0 1px 2px rgb(0 0 0 / 40%)); }
    .empty { text-align: center; padding: 30px 10px; }
    .deck-end { text-align: center; padding: 30px 10px; display: grid; gap: 6px; justify-items: center; }
    .deck-end p { margin: 0; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; margin-top: 8px; }
    /* The photo's credit (its author, licence and source): small, over the photo. */
    .card .credit { position: absolute; z-index: 1; left: 0; right: 0; bottom: 0; padding: 1px 6px; background: rgb(0 0 0 / 50%); color: #fff;
      font-size: 0.62rem; line-height: 1.4; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .grid.mosaic .card .credit { position: static; padding: 0; background: none; opacity: 0.85; }
    /* The match. */
    .match { position: fixed; inset: 0; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; border: 0; place-content: center; justify-items: center; gap: 12px; padding: 24px; text-align: center;
      background: linear-gradient(160deg, rgb(224 36 94 / 92%), rgb(46 125 50 / 92%)); color: #fff; animation: pop 0.3s ease-out; }
    .match[open] { display: grid; }
    .match::backdrop { background: transparent; }
    .match .title { margin: 0; font-size: 2.4rem; font-weight: 900; font-style: italic; transform: rotate(-4deg); text-shadow: 0 3px 0 rgb(0 0 0 / 20%); }
    .match img { width: 180px; height: 180px; border-radius: 50%; object-fit: cover; border: 5px solid #fff; box-shadow: 0 10px 30px rgb(0 0 0 / 30%); }
    .match p { margin: 0; max-width: 340px; }
    .match .secondary { background: transparent; color: #fff; border-color: rgb(255 255 255 / 70%); }
    .match .credit { font-size: 0.75rem; opacity: 0.9; }
    @keyframes pop { from { opacity: 0; transform: scale(1.06); } }
    /* A plant open beside the list (wide screens). */
    @media (min-width: 900px) { :host([opened]) .list { margin-right: min(560px, 48vw); } }
    @media (prefers-reduced-motion: reduce) { .match, .card { transition: none; animation: none; } }
  `];

  #store = new StoreController(this);

  constructor() {
    super();
    /** @type {import('../runtime.js').MiniApp | null} */
    this.app = null;
    /** @type {Record<string, any> | null} */
    this.c = null;
    this.harvest = false;
    this.mosaic = false;
    /** @type {string | null} */
    this.heading = null;
    this.view = 'swipe';
    /** @type {Card | null} */
    this._match = null;
    this._said = '';
    this._bloomOnly = false;
  }

  #onChange = () => this.requestUpdate();
  /** @type {import('./session.js').AroundSession | null} */ #session = null;

  connectedCallback() {
    super.connectedCallback();
    // The plants seen (a tick on their tile) and the first steps (the plants still to meet before Flore).
    discoverEvents.addEventListener('change', this.#onChange);
    // A module switched on or off (Réglages, another tab): photos follow it.
    moduleEvents.addEventListener('change', this.#onChange);
    addEventListener('keydown', this.#onKey);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    discoverEvents.removeEventListener('change', this.#onChange);
    moduleEvents.removeEventListener('change', this.#onChange);
    removeEventListener('keydown', this.#onKey);
    this.#session?.removeEventListener('change', this.#onChange);
    this.#session = null;
  }

  /** The first match waits for its one button: no key closes it. @param {KeyboardEvent} e */
  #onKey = e => { if (this._match && e.key === 'Escape') e.preventDefault(); };

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (!this.app || !this.c) return;
    const s = sessionOf(this.app);
    if (s !== this.#session) {
      this.#session?.removeEventListener('change', this.#onChange);
      this.#session = s;
      s.addEventListener('change', this.#onChange);
    }
    // The cards of the place and distance chosen (searched unless they are there).
    s.ensure(this.harvest);
    const open = this.c.focus;
    if (changed.has('c') && open != null && changed.get('c')?.focus !== open) plantSeen(open);
    this.toggleAttribute('opened', open != null);
  }

  updated() {
    // The first match's window: modal, a step in history (Back closes it, as the button does).
    if (this._match) openModal(/** @type {HTMLDialogElement | null} */ (this.renderRoot.querySelector('dialog.match')));
  }

  get #s() { return /** @type {import('./session.js').AroundSession} */ (this.#session); }
  get #view() { return this.#s.viewOr(this.view); }

  /** A plant's photo, unless the « Photos en ligne » module is off in this view (a leaf shows instead). @param {string | null | undefined} url */
  #photo(url) { return url && moduleOn('photos', plantViewOf(this.#store.state)) ? url : null; }

  /** A plant opened in its sheet, which steps through `ids`. @param {number} id @param {number[]} ids */
  #openPlant(id, ids) {
    this.#s.sheetIds = ids;
    this.dispatchEvent(new CustomEvent('ma-plant', { detail: { id }, bubbles: true, composed: true }));
  }

  /** The sheet on to another plant: « Toutes » shows it. @param {CustomEvent} e */
  #onSheet = e => {
    const id = e.detail?.id;
    if (id == null || this.#view !== 'all') return;
    const at = this.#s.sheetCards.findIndex(c => c.plant.id === id);
    if (at >= this.#s.shown) { this.#s.shown = at + 1; this.requestUpdate(); }
  };

  /**
   * The views' tabs, as tabs go (ARIA's pattern): one stop in the Tab order, ← → (Début, Fin) to the next one,
   * shown at once. @param {KeyboardEvent} e
   */
  #tabKey = e => {
    const tabs = /** @type {HTMLElement[]} */ ([...(/** @type {HTMLElement} */ (e.currentTarget)).querySelectorAll('[role="tab"]')]);
    const at = tabs.indexOf(/** @type {HTMLElement} */ (e.target));
    const to = e.key === 'ArrowRight' ? (at + 1) % tabs.length : e.key === 'ArrowLeft' ? (at - 1 + tabs.length) % tabs.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (at < 0 || to < 0) return;
    e.preventDefault();
    e.stopPropagation();
    this.#s.setView(/** @type {string} */ (tabs[to].dataset.view));
    tabs[to].focus();
  };

  /** A card swiped (flown off the deck): kept, said; a match celebrated — the first one by a screen of its own. @param {CustomEvent} e */
  #onDecide = e => {
    const { card, liked } = /** @type {{ card: Card, liked: boolean }} */ (e.detail);
    const s = this.#s;
    const fav = s.swiped(card, liked);
    // Said aloud (the status under the view): what the swipe did, then the card now on top.
    const next = s.deck[0];
    this._said = `${liked ? `Match : ${nameOf(card.plant)}${fav ? ', ajoutée aux favoris' : ''}` : `Passée : ${nameOf(card.plant)}`}. ${next ? `Carte suivante : ${nameOf(next.plant)}.` : 'Plus aucune carte.'}`;
    if (!liked) return;
    // The first match (while discovering): its screen, once. The next ones: a heart.
    if (discovering() && !discoverState().firstMatch) this._match = card;
    else s.heart();
  };

  /** ↺: the last card back on top. */
  #onUndo = () => { this.#s.rewind(); this._match = null; };

  /** The match's window closed: the deck goes on, the focus back on the views. @param {Card} c */
  async #matchClosed(c) {
    if (this._match !== c) return;
    firstMatchShown();
    this._match = null;
    await this.updateComplete;
    /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.views [aria-selected="true"]'))?.focus();
  }

  render() {
    const app = this.app, c = this.c, s = this.#session;
    if (!app || !c || !s) return nothing;
    const cards = s.cards;
    const view = this.#view;
    const month = MONTH[new Date().getMonth()];
    const km = distLabel(c.radius);
    const ds = discoverState();
    const matchCards = s.matchCards, matches = matchCards.length;
    const further = nextDistance(c.radius);
    return html`<section class="list ${this.harvest ? 'harvest' : this.mosaic ? 'mosaic' : 'meet'}">
      <div class="head">
        <h1>${this.heading ? this.heading + ' · ' : ''}Autour ${c.place ? 'de ' + c.place : 'de vous'}</h1>
        <span class="where">${cards ? `${cards.length} plantes à moins de ${km}${cards.some(x => x.blooming) ? ` · ${cards.filter(x => x.blooming).length} en fleur en ${month}` : ''}` : ''}</span>
        <button class="link" type="button" @click=${() => app.go('map')}>Distance : ${km}</button>
        <button class="link" type="button" @click=${() => app.go('start')}>Changer de lieu</button>
      </div>
      ${this.harvest ? html`<p class="banner-warn" role="note">${icon('exclamation-triangle-fill')}<span>Ne cueillez jamais une plante sans identification certaine${s.unread ? ''
        : ' : chacune de ces plantes a un sosie dangereux (liste de l’Anses et des Centres antipoison)'}.
        <span class="sos-line">${emergency()}.</span></span></p>` : nothing}
      ${this.harvest && s.unread && !s.loading ? html`<p class="banner-warn" role="alert">${icon('exclamation-octagon-fill')}<span><b>${UNREAD_LOOKALIKES}</b>
        <button class="link" type="button" @click=${() => s.load()}>Réessayer</button></span></p>` : nothing}
      ${this.harvest && cards && !cards.length && !s.loading && !s.unread ? html`<div class="deck-end"><p><b>Aucune plante de cueillette observée à moins de ${km}.</b></p>
        ${further ? html`<button class="primary" type="button" @click=${() => s.widen(further)}>Chercher jusqu’à ${distLabel(further)}</button>` : nothing}</div>` : nothing}
      ${this.mosaic && cards?.length ? html`<label class="bloom-only"><input type="checkbox" .checked=${this._bloomOnly} @change=${(/** @type {any} */ e) => { this._bloomOnly = e.target.checked; }} /> En fleur maintenant (${cards.filter(x => x.blooming).length})</label>` : nothing}
      ${cards && cards.length ? html`<div class="views segmented" role="tablist" aria-label="Affichage" @keydown=${this.#tabKey}>
        ${[['swipe', 'Rencontres'], ['matches', `Matchs${matches ? ' · ' + matches : ''}`], ['all', 'Toutes']].map(([k, l]) => html`<button type="button" role="tab"
          data-view=${k} aria-selected=${String(view === k)} tabindex=${view === k ? '0' : '-1'} @click=${() => s.setView(k)}>${l}</button>`)}
      </div>` : nothing}
      ${s.loading ? html`<p class="muted">Recherche des plantes observées autour…</p>` : nothing}
      ${s.error ? html`<p class="error" role="alert">${s.error} <button class="link" type="button" @click=${() => s.load()}>Réessayer</button></p>` : nothing}
      ${cards && !cards.length && !s.loading ? html`<p class="muted">Aucune plante observée ici pour le moment. Essayez une autre commune.</p>` : nothing}
      ${cards && view === 'swipe' ? html`<ma-deck .session=${s} .cards=${s.deck} .c=${c} ?active=${c.focus == null && !this._match}
          @deck-decide=${this.#onDecide} @deck-undo=${this.#onUndo}
          @deck-open=${(/** @type {CustomEvent} */ e) => this.#openPlant(e.detail.id, s.deck.map(x => x.plant.id))}></ma-deck>` : nothing}
      ${cards && view === 'matches' ? (matches ? html`<div class="grid">${matchCards.map(x => html`<div class="mwrap">${this.#card(x, matchCards.map(m => m.plant.id))}
          <button class="unmatch" type="button" title="Retirer ce match (et des favoris)" aria-label=${'Retirer ' + nameOf(x.plant) + ' des matchs'}
            @click=${() => s.unmatch(x)}>${icon('x-lg')} Retirer</button></div>`)}</div>`
        : html`<p class="muted empty">Pas encore de match. Glissez à droite une plante qui vous plaît dans « Rencontres ».</p>`) : nothing}
      ${cards && view === 'all' ? this.#allView(cards) : nothing}
      ${cards ? html`
        <p class="src">Observations confirmées d’iNaturalist ; noms, floraison et alertes de la flore embarquée (TAXREF, Baseflor, INPN, ANSM, Anses).
          ${ds.done ? nothing : html`<br />Encore ${Math.max(0, PLANTS_BEFORE_FLORE - ds.seen.length)} plante${PLANTS_BEFORE_FLORE - ds.seen.length > 1 ? 's' : ''} à rencontrer avant la flore complète.`}</p>` : nothing}
    </section>
    <p class="visually-hidden" role="status">${this._said || ''}</p>
    ${this._match ? this.#matchView(this._match) : nothing}
    ${c.focus != null ? html`<ma-plant-sheet .open=${c.focus} .cards=${s.sheetCards} scoped @ma-plant=${this.#onSheet}></ma-plant-sheet>` : nothing}`;
  }

  /** « Toutes »: the grid (Mosaïque: large photos, the names over them; « En fleur » filters). @param {Card[]} all */
  #allView(all) {
    const s = this.#s;
    const cards = this.mosaic && this._bloomOnly ? all.filter(c => c.blooming) : all;
    const ids = cards.map(c => c.plant.id);
    return html`<div class="grid ${this.mosaic ? 'mosaic' : ''}">${cards.slice(0, s.shown).map(c => this.#card(c, ids))}</div>
      ${cards.length > s.shown ? html`<button class="secondary more" type="button" @click=${() => { s.shown += PAGE; this.requestUpdate(); }}>Voir plus (${cards.length - s.shown})</button>` : nothing}`;
  }

  /**
   * The first match: a screen of its own, with one way out — to the plant. Nothing else closes it (no click
   * outside, no key, no timer) but Back, which does what the button does.
   * @param {Card} c
   */
  #matchView(c) {
    const name = nameOf(c.plant);
    const photo = this.#photo(c.photo);
    // A modal <dialog> (opened in updated(), by openModal): the focus goes to its button and stays in it, the rest of
    // the page is out of reach. Échap is held back (cancel); should the browser close it anyway, it is as the button.
    return html`<dialog class="match" aria-labelledby="match-title" aria-describedby="match-text"
        @cancel=${(/** @type {Event} */ e) => e.preventDefault()} @close=${() => this.#matchClosed(c)}>
      <p class="title" id="match-title">C’est un match !</p>
      ${photo ? html`<img src=${photo} alt="" decoding="async" referrerpolicy="no-referrer" @error=${hideImg} />` : nothing}
      ${photo && c.credit ? html`<p class="credit">Photo : ${creditText(c.credit)}</p>` : nothing}
      <p id="match-text">Coup de cœur pour <b>${name}</b> ! Direction votre herbier (♥ favoris) — et ce n’est que le début de l’exploration.</p>
      <div class="row">
        <button class="primary" type="button" autofocus @click=${(/** @type {any} */ e) => e.currentTarget.closest('dialog')?.close()}>Découvrir cette plante</button>
      </div>
    </dialog>`;
  }

  /** A tile of the grid; a touch opens its plant (Mosaïque: at its images). @param {Card} c @param {number[]} ids */
  #card(c, ids) {
    const p = c.plant, name = nameOf(p);
    const a = c.alerts, danger = a?.safety?.tone === 'danger' || a?.edible?.tone === 'danger';
    const n = (a?.safety?.count || 0) + (a?.edible?.count || 0);
    const photo = this.#photo(c.photo);
    const mosaic = this.mosaic && this.#view === 'all';
    const ds = discoverState();
    // The photo's credit, shown on it; not in the button's name (the plant's), which a screen reader says at each tile.
    const credit = photo && c.credit ? html`<small class="credit" aria-hidden="true">${creditText(c.credit)}</small>` : nothing;
    return html`<button class="card" type="button" aria-current=${String(this.c?.focus === p.id)} @click=${() => {
      if (mosaic) { sheetSession.anchor = 'images'; sheetSession.anchorBlock = 'media'; sheetSession.anchorOffset = 0; }
      this.#openPlant(p.id, ids);
    }}>
      ${/** @type {number[]} */ (this.c?.matches ?? []).includes(p.id) ? html`<span class="heart" aria-label="Match">${icon('heart-fill')}</span>` : nothing}
      <div class="ph">${photo ? html`<img src=${photo} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error=${hideImg} @load=${showImg} />` : nothing}${mosaic ? nothing : credit}</div>
      <div class="chips">${c.blooming ? html`<span class="chip bloom">En fleur</span>` : nothing}
        ${n ? html`<span class="chip ${danger ? 'danger' : 'warn'}">${danger ? 'Attention' : 'À savoir'} · ${n}</span>` : nothing}</div>
      ${ds.seen.includes(p.id) ? html`<span class="seen" title="Déjà découverte" aria-label="Déjà découverte">${icon('check-lg')}</span>` : nothing}
      <div class="txt"><b>${name}</b><i>${p.scientificName}</i>${mosaic ? credit : nothing}</div>
    </button>`;
  }
}

customElements.define('ma-around-list', MaAroundList);
