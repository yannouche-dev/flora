// @ts-check
// The Parcours' search, under the thumb: a large field — typed, or said (the big round microphone beside it) — and,
// rising from it over the walk, the flora's plants for what is typed (each with its photo, its names, « Déjà une fois
// dans le parcours », and its marker + to add it where I stand): the best right above the field, « Voir plus » at the
// top; before a letter, how to name one. Entrée adds the first plant for the whole word typed. Added: the search goes
// down (on a phone the keyboard too), the walk is back. The keyboard put away without leaving the field (Android's
// « Retour »): the suggestions go down too. Its host has no box of its own (display: contents): its sheet and its
// dock are laid in the walk's grid (kit/ma-walk.js), which it tells when it opens (the event walk-seeking).

import { LitElement, html, css, nothing, repeat } from 'lit';
import { icon } from '../../core/icons.js';
import { photoOf } from '../../core/thumb.js';
import { findPlants } from '../../core/search.js';
import { entriesOf } from '../../core/collections.js';
import { ui } from '../../styles/ui.js';
import { SessionWatch } from './watch.js';
import '../../components/gf-voice-button.js';

/** « Ajouter » (here): a + on a marker. */
export const addPin = html`<span class="addpin" aria-hidden="true">${icon('geo-alt-fill')}<i>${icon('plus-lg')}</i></span>`;
/** Its look (the search's answers, the head's « Ajouter ici »). */
export const addPinStyles = css`
  .addpin { position: relative; display: inline-grid; place-items: center; font-size: 1.2rem; line-height: 1; }
  .addpin > i { position: absolute; right: -8px; top: -7px; width: 15px; height: 15px; border-radius: 50%; display: grid; place-items: center; font-size: 0.6rem; font-style: normal;
    background: var(--gf-accent-contrast, #fff); color: var(--gf-accent); box-shadow: 0 0 0 1.5px var(--gf-accent); }
`;

/** Plants proposed at first, and added by each « Voir plus ». */
const STEP = 12;

export class MaWalkSearch extends LitElement {
  static properties = {
    /** The game (kit/trail-session.js). */
    session: { attribute: false },
    _q: { state: true },
    _hits: { state: true },
    _searching: { state: true },
    /** The microphone is open (the field says « Parlez… »). */
    _listening: { state: true },
    /** How many of the hits are shown (« Voir plus » adds STEP). */
    _shown: { state: true },
    /** The search field touched by the hand (the keyboard up): the suggestions come over the walk, even before a letter. */
    _peek: { state: true }
  };

  static styles = [ui, addPinStyles, css`
    :host { display: contents; }
    .dock { grid-row: 4; grid-column: 1; position: relative; z-index: 5; padding: 8px 12px calc(8px + env(safe-area-inset-bottom, 0px)); background: var(--gf-surface); border-top: 1px solid var(--gf-border); box-shadow: 0 -6px 18px rgb(0 0 0 / 8%); }
    /*
     * Searching: the suggestions rise from the search over the walk (its card, its map, its plants), which stay where
     * they are underneath — nothing is laid out again, the map is not redrawn. Only the suggestions, the search and the
     * menu are seen; an « Ajouter », and they go down again: the card and the map are back.
     * Under the thumb: the suggestions hold on to the search — the best one right above the field, the others upwards,
     * « Voir plus » at the top (in that order for the keyboard and the screen readers too); it is scrolled from the
     * bottom, and stays so when it grows or shrinks (the keyboard).
     */
    .sheet { grid-area: 1 / 1 / 4 / 2; z-index: 4; min-height: 0; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 6px;
      padding: 10px 12px 12px; background: var(--gf-bg, var(--gf-surface-2)); border-radius: 16px 16px 0 0; box-shadow: 0 -10px 28px rgb(0 0 0 / 16%);
      transform: translateY(calc(100% + 24px)); visibility: hidden; transition: transform 0.26s cubic-bezier(0.3, 0.7, 0.4, 1), visibility 0s linear 0.26s; }
    .sheet.open { transform: none; visibility: visible; transition: transform 0.26s cubic-bezier(0.2, 0.8, 0.3, 1), visibility 0s; }
    .sheet > :first-child { margin-top: auto; }
    .sheet .hint { padding: 4px 4px 0; }
    @container (min-width: 900px) {
      .dock { grid-area: 3 / 1; padding: 10px 14px 14px; }
      .sheet { grid-area: 1 / 1 / 3 / 2; border-radius: 0; box-shadow: none; padding: 12px 14px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .sheet, .sheet.open { transform: none; transition: opacity 0.12s, visibility 0s linear 0.12s; opacity: 0; }
      .sheet.open { opacity: 1; transition: opacity 0.12s, visibility 0s; }
    }
    .search input { width: 100%; box-sizing: border-box; font: inherit; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-pill); background: var(--gf-surface); color: var(--gf-text); }
    .search { position: relative; }
    .search input { padding: 13px 48px 13px 46px; font-size: 1.08rem; }
    .bar { display: flex; align-items: center; gap: 10px; }
    .bar .search { flex: 1; min-width: 0; }
    .search.listening input { border-color: var(--gf-danger, #dc2626); box-shadow: 0 0 0 3px color-mix(in srgb, var(--gf-danger, #dc2626) 22%, transparent); }
    .search.listening input::placeholder { color: var(--gf-danger, #dc2626); }
    .search input:focus { border-color: var(--gf-accent); outline: none; box-shadow: var(--gf-focus); }
    .search input::-webkit-search-cancel-button { display: none; }
    .search .lens { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: var(--gf-text-muted); font-size: 1.1rem; pointer-events: none; }
    .search .tools { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); display: flex; gap: 2px; align-items: center; }
    .hits { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .hit { display: grid; grid-template-columns: 52px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 6px; border-radius: 14px; background: var(--gf-surface); box-shadow: var(--gf-shadow); }
    .th { width: 52px; height: 52px; border-radius: 10px; overflow: hidden; background: var(--gf-surface-2); display: grid; place-items: center; color: var(--gf-text-muted); }
    .th img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .hit .t { display: grid; min-width: 0; line-height: 1.25; }
    .hit .t b { font-size: 1rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hit .t i { font-size: 0.82rem; color: var(--gf-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* « Ajouter » (here): a marker with a +, round, under the thumb. */
    .add { width: 46px; height: 46px; min-height: 0; padding: 0; border-radius: 50%; display: grid; place-items: center; }
    .muted { color: var(--gf-text-muted); margin: 0; }
    .more { align-self: center; min-height: 44px; }
    .times { font-size: 0.75rem; font-weight: 600; color: var(--gf-accent); white-space: nowrap; }
    .hint { margin: 0; padding: 6px 2px; color: var(--gf-text-muted); font-size: 0.92rem; }
  `];

  constructor() {
    super();
    /** @type {import('./trail-session.js').TrailSession | null} */
    this.session = null;
    this._q = '';
    /** @type {any[]} */
    this._hits = [];
    this._searching = false;
    this._listening = false;
    this._shown = STEP;
    this._peek = false;
  }

  /** The walk's element (its width says phone or not: this host has no box). */
  get #wide() { return (/** @type {any} */ (this.getRootNode()).host?.clientWidth ?? innerWidth) >= 900; }

  connectedCallback() {
    super.connectedCallback();
    (window.visualViewport || window).addEventListener('resize', this.#onViewport);
    const { w, h } = this.#viewport();
    this.#vw = w; this.#tallest = this.#low = h;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    (window.visualViewport || window).removeEventListener('resize', this.#onViewport);
    this.#sheetSize.disconnect();
    this.#sheetEl = null; this.#sheetH = -1; this.#bottomFor = '';
    for (const t of [this.#gone, this.#findTimer]) clearTimeout(t);
  }

  /** Drawn again as the game changes. */
  _watch = new SessionWatch(this, () => this.session);

  firstUpdated() {
    // Ready for the first plant: the field on a wide screen; on a phone, no keyboard yet (the mic is there too).
    const s = this.session;
    if (s?.focusSearch) { s.focusSearch = false; if (this.#wide) this.#input?.focus(); }
  }

  updated() {
    // The walk is told whether the search is open (its card, its map, its plants out of reach under it).
    if (this.#open !== this.#told) {
      this.#told = this.#open;
      this.dispatchEvent(new CustomEvent('walk-seeking', { detail: { open: this.#open }, bubbles: true, composed: true }));
    }
    const sheet = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.sheet'));
    if (sheet !== this.#sheetEl) {
      if (this.#sheetEl) this.#sheetSize.unobserve(this.#sheetEl);
      // A scroll the hand (or the content) made — not the browser's, as the sheet changes height.
      if (sheet) { this.#sheetSize.observe(sheet); sheet.addEventListener('scroll', () => { if (sheet.clientHeight === this.#sheetH) this.#keepFrom(sheet); }, { passive: true }); }
      this.#sheetEl = sheet;
    }
    // New suggestions (another word, the sheet opening): the best one, right above the field, in sight.
    const what = !sheet?.classList.contains('open') ? '' : this._q ? 'q:' + this.#hitsFor + ':' + this._hits.length : 'hint:' + this._listening;
    if (sheet && what && what !== this.#bottomFor) { sheet.scrollTop = sheet.scrollHeight; this.#fromBottom = 0; }
    else if (sheet && sheet.clientHeight === this.#sheetH) this.#keepFrom(sheet);
    this.#bottomFor = what;
  }

  /** Open as last drawn, and as last told to the walk. */
  #open = false;
  /** @type {boolean | null} */ #told = null;

  /** The sheet of suggestions, watched: it is held from the bottom (the field), as it grows or shrinks. @type {HTMLElement | null} */
  #sheetEl = null;
  /** What the sheet showed when brought to its bottom (a new word: brought again). */
  #bottomFor = '';
  /** How far the sheet is scrolled up from its bottom. */
  #fromBottom = 0;
  /** @param {HTMLElement} sheet */
  #keepFrom(sheet) { this.#fromBottom = sheet.scrollHeight - sheet.clientHeight - sheet.scrollTop; }
  /** The sheet's height when last held (a scroll at another height is the browser's, as it resizes). */
  #sheetH = -1;
  /** The keyboard comes or goes, the sheet changes height: what was above the field stays above it. */
  #sheetSize = new ResizeObserver(() => {
    const sheet = this.#sheetEl;
    if (!sheet) return;
    this.#sheetH = sheet.clientHeight;
    sheet.scrollTop = sheet.scrollHeight - sheet.clientHeight - this.#fromBottom;
  });

  /** The visible viewport's width, its tallest height at that width (no keyboard), its lowest since it last grew. */
  #vw = 0;
  #tallest = 0;
  #low = 0;
  /** The keyboard up, as last seen (kept through a rotation or a pinch, which only set the heights again). */
  #kbUp = false;
  /** On which side of 900 px the walk was (the sheet's state follows a crossing at once). */
  #phone = false;
  #viewport() {
    const vv = window.visualViewport;
    return { w: Math.round(vv?.width ?? innerWidth), h: Math.round(vv?.height ?? innerHeight) };
  }
  /**
   * The keyboard put away without leaving the field (Android's « Retour », the ⌄ key) — the viewport much taller at
   * the same width (a rotation, a pinch change the width: they only set the heights again): nothing typed, the
   * suggestions' sheet goes down, the walk, its map and its plants are back.
   */
  #onViewport = () => {
    const phone = !this.#wide;
    if (phone !== this.#phone) { this.#phone = phone; this.requestUpdate(); }
    const { w, h } = this.#viewport();
    if (w !== this.#vw) { this.#vw = w; this.#tallest = this.#low = h; return; }
    if (h < this.#tallest - 80) this.#kbUp = true;
    // Grown from its lowest (an animated keyboard is told in several steps, each under 80 px).
    const grew = h > this.#low + 80;
    if (grew) { this.#kbUp = false; this.#tallest = this.#low = h; }
    else { this.#tallest = Math.max(this.#tallest, h); this.#low = Math.min(this.#low, h); }
    // Only a phone's sheet: on a computer, a window made taller leaves the field as it is.
    if (grew && this._peek && !this._q && phone) { this._peek = false; this.#input?.blur(); }
  };
  /** How the ✕ was touched (a finger, the keyboard away: the search is left). */
  #clearBy = '';
  /** When the hand last touched the search field (a focus right after it is the hand's, not the app's). */
  #touchedAt = 0;

  /** @type {any} */ #findTimer = 0;
  /** The flora's plants for what is typed (or said), as it is typed. @param {string} text @param {boolean} [now] */
  #find(text, now = false) {
    this._q = text;
    clearTimeout(this.#findTimer);
    const run = async () => {
      const q = text.trim();
      if (!q) { this._hits = []; return; }
      this._searching = true;
      const hits = await findPlants(q).catch(() => []);
      if (this._q === text) { this._hits = hits; this.#hitsFor = text; this._shown = STEP; this._searching = false; }
      return hits;
    };
    if (now) return run();
    this.#findTimer = setTimeout(run, 160);
    return null;
  }

  /** @returns {HTMLInputElement | null} */
  get #input() { return this.renderRoot.querySelector('.dock .search input'); }

  /** Text put in the field by the app (dictation, clearing, after an add) — then searched. @param {string} text @param {boolean} [now] */
  #type(text, now = true) {
    const input = this.#input;
    if (input && input.value !== text) input.value = text;
    return this.#find(text, now);
  }

  /** The words the hits shown answer (Entrée never adds a plant found for fewer letters). */
  #hitsFor = '';

  /** Entrée: the first plant for what is typed now — searched at once when the hits are not yet for it. @param {string} text */
  async #addFirst(text) {
    const hits = this.#hitsFor === text ? this._hits : await this.#find(text, true);
    if (hits?.[0] && this._q === text) this.#add(hits[0]);
  }

  /**
   * A plant added where I stand: the search goes down — on a phone the keyboard too — and the card and the map are
   * back, the plant on it. Wide (no keyboard): the field stays ready for the next one. @param {any} hit
   */
  async #add(hit) {
    const s = this.session;
    if (!s || !(await s.add(hit))) return;
    s.select(null);
    this.#type('');
    this._peek = false;
    if (!this.#wide) this.#input?.blur(); else this.#input?.focus();
  }

  render() {
    const t = this.session?.trail;
    if (!t) return nothing;
    // Searching: something typed or said — or, on a phone, the field touched (the keyboard takes the room). The
    // microphone never brings the keyboard: the field is let go while it listens.
    const open = Boolean(this._q) || this._listening || (this._peek && !this.#wide);
    this.#open = open;
    return html`${this.#sheet(t, open)}
      <div class="dock">
        <div class="bar">
          <div class="search ${this._listening ? 'listening' : ''}" role="search">
            <span class="lens" aria-hidden="true">${icon('search')}</span>
            <!-- No value binding: the keyboard's own dictation (and its composition) is never disturbed. -->
            <input type="search" enterkeyhint="search" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"
              placeholder=${this._listening ? 'Parlez : « ortie », « pissenlit »…' : 'Quelle plante voyez-vous ?'} aria-label="Nommer une plante (la flore propose)"
              @pointerdown=${() => { this.#touchedAt = performance.now(); }}
              @focus=${() => { if (performance.now() - this.#touchedAt < 1000) this._peek = true; }}
              @blur=${() => { this._peek = false; }}
              @input=${(/** @type {any} */ e) => this.#find(e.target.value)}
              @keydown=${(/** @type {KeyboardEvent} */ e) => {
                if (e.isComposing) return;
                if (e.key === 'Enter') { e.preventDefault(); this.#addFirst(/** @type {any} */ (e.target).value); }
                if (e.key === 'Escape') this.#type(''); }} />
            <!-- ✕ as Échap: the field kept (and the keyboard, and the sheet with its hint) — but touched with the
                 keyboard put away, the search is left (no empty sheet over the walk). -->
            ${this._q ? html`<span class="tools"><button class="icon-btn" type="button" aria-label="Effacer"
              @pointerdown=${(/** @type {PointerEvent} */ e) => { this.#clearBy = e.pointerType; }}
              @mousedown=${(/** @type {Event} */ e) => e.preventDefault()}
              @click=${() => {
                this.#type('');
                if (this.#clearBy === 'touch' && !this.#kbUp) { this._peek = false; this.#input?.blur(); }
                this.#clearBy = ''; }}>${icon('x-lg')}</button></span>` : nothing}
          </div>
          <gf-voice-button size="large" fallback
            @voice-state=${(/** @type {CustomEvent} */ e) => { this._listening = e.detail.state !== 'idle'; if (this._listening) this.#input?.blur(); }}
            @voice-text=${(/** @type {CustomEvent} */ e) => this.#type(e.detail.text, e.detail.final)}></gf-voice-button>
        </div>
      </div>`;
  }

  /**
   * The suggestions, rising over the walk while searching: the flora's plants for what is typed — before a letter,
   * how to name one. Going down, they keep what they showed until they are gone.
   * @param {any} t @param {boolean} open
   */
  #sheet(t, open) {
    if (open) {
      this.#shown = this._q ? this.#hitsView(t)
        : this._listening ? html`<p class="hint">Parlez : « ortie », « pissenlit »… La flore propose la plante, son marqueur + la pose sur la carte, là où vous êtes.</p>`
        : html`<p class="hint">Tapez ou dites le nom d’une plante (« ortie », « pissenlit »…) : la flore la propose, son marqueur + la pose sur la carte, là où vous êtes.</p>`;
      clearTimeout(this.#gone);
    } else if (this.#shown !== nothing) {
      clearTimeout(this.#gone);
      this.#gone = setTimeout(() => { this.#shown = nothing; this.requestUpdate(); }, 320);
    }
    return html`<section class="sheet ${open ? 'open' : ''}" aria-label="Plantes proposées" ?inert=${!open} aria-hidden=${String(!open)}>${this.#shown}</section>`;
  }
  /** @type {unknown} */ #shown = nothing;
  /** @type {any} */ #gone = 0;

  /**
   * The flora's suggestions: each with its photo, its names and a large « Ajouter » — in the order seen, from the
   * top: « Voir plus », then the last shown, down to the best, right above the field. @param {any} t
   */
  #hitsView(t) {
    if (!this._hits.length) return html`<p class="muted">${this._searching ? 'Recherche dans la flore…' : `Aucune plante de la flore pour « ${this._q} ».`}</p>`;
    const shown = this._hits.slice(0, this._shown);
    const more = this._hits.length - shown.length;
    return html`${more > 0 ? html`<button class="more secondary" type="button" @click=${() => { this._shown += STEP; }}>Voir ${Math.min(more, STEP)} plante${Math.min(more, STEP) > 1 ? 's' : ''} de plus (${this._hits.length} en tout)</button>` : nothing}
    <ul class="hits" aria-label="Plantes proposées">${repeat([...shown].reverse(), h => h.id, h => {
      // Already met: it can be added again (another occurrence, here).
      const times = entriesOf(t, h.id).length;
      return html`<li class="hit">
        <span class="th">${photoOf(h.thumbnail?.url) ? html`<img src=${h.thumbnail.url} alt="" loading="lazy" referrerpolicy="no-referrer" @error=${(/** @type {any} */ e) => e.target.remove()} />` : icon('flower1')}</span>
        <span class="t"><b>${h.vernacularName || h.scientificName}</b><i>${h.vernacularName ? h.scientificName + ' · ' : ''}${h.family || ''}</i>
          ${times ? html`<span class="times">${icon('check-lg')} Déjà ${times === 1 ? 'une fois' : times + ' fois'} dans le parcours</span>` : nothing}</span>
        <button class="primary add" type="button" @click=${() => this.#add(h)} title=${times ? 'L’ajouter encore, ici' : 'L’ajouter au parcours, ici'}
          aria-label=${(times ? 'Ajouter encore ' : 'Ajouter ') + (h.vernacularName || h.scientificName) + ' au parcours'}>${addPin}</button>
      </li>`;
    })}</ul>`;
  }
}

customElements.define('ma-walk-search', MaWalkSearch);
