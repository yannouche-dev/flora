// @ts-check
// Faux amis, playing (the step « play »; its game: kit/faux-amis.js). One card at a time: its two plants side by side,
// each with its name and its photo (the flora's, through core/thumb.js: none with « Photos en ligne » off, nor its credit
// when it does not load), and either a criterion of the sources to attribute (« À qui est cet indice ? »: a plant to
// touch) or, for a pair they give none for, the only answer « Je ne cueille pas ». Then the answer: whose criterion it
// was, the look-alike and how dangerous (« très toxique »: the TPPT base of Agroscope, said), the pair's other plants,
// the part mistaken, the sources, « Carte suivante ». After the sixth, the recap: the score, the six pairs and their
// criteria, each plant's sheet (the event ma-plant: the box keeps ?p=, ma-plant-sheet shows it — beside the recap on a
// wide screen), whom to call, « Nouvelle partie ». The game is the context's (`game`, kept on this device), its words
// the file's (`cards`): a game the file no longer gives (corrected since) is said, and dealt again; the file unreadable,
// said, with « Réessayer » (the game kept). It scrolls itself: one h1 a view, the focus on it as a view comes.

import { LitElement, html, css, nothing, repeat } from 'lit';
import { config } from '../../config.js';
import * as db from '../../core/db.js';
import { creditText } from '../../core/credit.js';
import { icon } from '../../core/icons.js';
import { hideImg, showImg } from '../../core/img.js';
import { severityOf, UNREAD_LOOKALIKES } from '../../core/lookalikes.js';
import { whenReady } from '../../core/store.js';
import { knownCredit, knownThumb } from '../../core/thumb.js';
import { emergency } from '../../components/gf-lookalikes.js';
import { fr } from '../../components/start-screen.js';
import { ui } from '../../styles/ui.js';
import { SKIP, answered, pickPlant, scoreOf } from './faux-amis.js';
import { nextCard } from './faux-amis-store.js';
import './ma-plant-sheet.js';
import '../../components/gf-thumb.js';

/**
 * @typedef {import('./faux-amis.js').Card} Card
 * @typedef {import('./faux-amis.js').Plant} Plant
 */

/** The plant of the flora each taxon shows (faux-amis.js#pickPlant), read once the flora is in; a read that failed is asked again. @type {Map<string, Promise<any>>} */
const shown = new Map();

/** @param {string} taxon @returns {Promise<any>} rejects when the flora could not be read (asked again next time) */
function plantFor(taxon) {
  let found = shown.get(taxon);
  if (!found) {
    const [genus, species] = taxon.split(' ');
    found = whenReady()
      .then(() => species ? db.getAllByIndex('plants', 'by_taxon', [genus, species]) : db.getAllByIndex('plants', 'by_genus', genus))
      .then(rows => pickPlant(taxon, rows));
    shown.set(taxon, found);
    found.catch(() => shown.delete(taxon));
  }
  return found;
}

/** « Titre — Anses et Centres antipoison, 2025 »: what it is, who said it, and when. @param {import('../../core/lookalikes.js').Source} s */
const sourceLine = s => `${s.title} — ${s.publisher}, ${String(s.date).slice(0, 4)}`;
/** Where the width of a plant's sheet beside the recap is kept (the manifest's owns.keys: « Rejouer » forgets it). */
const SHEET_KEY = config.storageKeys.appPrefix + 'faux-amis.sheet';

export class MaFauxAmis extends LitElement {
  static properties = {
    app: { attribute: false },
    c: { attribute: false },
    /** The card shown, answered or not; null: the one to answer now (the recap after the last). */
    _at: { state: true },
    /** The flora's plant of each taxon on the cards (null: none). */
    _plants: { state: true },
    /** A new game being dealt (« Nouvelle partie » waits). */
    _dealing: { state: true }
  };

  static styles = [ui, css`
    /* It scrolls itself (a grid cell gives it its height), its background all the way down — what is out of the flow too
       (the visually hidden words: positioned, it is their box). */
    :host { display: block; position: relative; height: 100%; min-height: 0; overflow-y: auto; overscroll-behavior: contain; background: var(--gf-bg, var(--gf-surface-2));
      container-type: inline-size; }
    /* A plant's sheet beside the recap (a wide screen): the recap keeps clear of it. */
    @media (min-width: 900px) { :host([sheet]) { padding-right: var(--ma-sheet-w, min(560px, 48vw)); box-sizing: border-box; } }
    .wrap { display: grid; max-width: 680px; margin: 0 auto; padding: 16px 16px 32px; box-sizing: border-box; }
    .card-view, .recap { display: grid; gap: 14px; min-width: 0; }
    h1 { margin: 0; font-size: 1.35rem; line-height: 1.25; text-wrap: balance; }
    h1:focus, .verdict:focus { outline: none; }
    .top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .count { margin: 0; font-size: 0.8125rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--gf-accent); }
    /* Where the game is: one dot a card, the answered ones filled. */
    .dots { display: flex; gap: 6px; margin: 0; padding: 0; list-style: none; }
    .dots li { width: 10px; height: 10px; border-radius: 50%; background: var(--gf-border); }
    .dots li.now { background: var(--gf-accent); box-shadow: 0 0 0 3px var(--gf-accent-soft); }
    .dots li.right { background: var(--gf-accent); }
    .dots li.wrong { background: var(--gf-danger); }

    /* The criterion: the sources' words, as a note pinned on the card. */
    .clue { display: flex; gap: 10px; margin: 0; padding: 14px 16px; border-radius: 14px; font-size: 1.0625rem; line-height: 1.45;
      background: color-mix(in srgb, var(--gf-season) 24%, var(--gf-surface)); border: 1px solid color-mix(in srgb, var(--gf-season) 60%, var(--gf-border)); }
    .clue .bi { flex: none; margin-top: 0.2em; color: var(--gf-warn); }
    .clue p { margin: 0; }
    .none { margin: 0; font-size: 1.0625rem; line-height: 1.45; color: var(--gf-text); }

    /* The two plants, side by side. */
    .pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    figure { display: grid; gap: 6px; align-content: start; margin: 0; min-width: 0; }
    /* A grid of one column the width of the card (a button centres its content: not here). */
    .pick { display: grid; grid-template-columns: minmax(0, 1fr); justify-content: stretch; align-content: start; justify-items: start; gap: 4px; width: 100%;
      min-height: 0; padding: 8px 8px 10px; box-sizing: border-box; border-radius: 16px; border: 2px solid var(--gf-border); background: var(--gf-surface);
      color: var(--gf-text); text-align: left; font-weight: 400; }
    button.pick { cursor: pointer; }
    button.pick:hover { border-color: var(--gf-accent); background: var(--gf-surface); }
    .photo { position: relative; display: block; width: 100%; aspect-ratio: 4 / 3; max-height: min(30dvh, 230px); border-radius: 10px; overflow: hidden; background: var(--gf-surface-2); }
    .photo img { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; object-fit: cover; }
    .photo .ph { position: absolute; inset: 0; display: grid; place-items: center; font-size: 2rem; color: var(--gf-text-muted); }
    .name { font-size: 1.0625rem; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
    .sci { font-size: 0.8125rem; font-style: italic; color: var(--gf-text-muted); overflow-wrap: anywhere; }
    .credit { margin: 0; padding: 0 4px; font-size: 0.6875rem; line-height: 1.3; color: var(--gf-text-muted); overflow-wrap: anywhere; }
    .tag { display: inline-flex; align-items: center; gap: 4px; justify-self: start; padding: 2px 8px; border-radius: var(--gf-radius-pill); font-size: 0.75rem; font-weight: 700;
      background: var(--gf-surface-2); color: var(--gf-text); }
    .tag.severe { background: color-mix(in srgb, var(--gf-danger) 14%, var(--gf-surface)); color: var(--gf-danger); }
    /* The warning colour, a little toward the text's: 4.5:1 on its tint, light or dark. */
    .tag.mild { background: color-mix(in srgb, var(--gf-warn) 12%, var(--gf-surface)); color: color-mix(in srgb, var(--gf-warn) 78%, var(--gf-text)); }
    .yours { font-size: 0.75rem; font-weight: 600; color: var(--gf-text-muted); }
    figure.toxic .pick { border-color: color-mix(in srgb, var(--gf-warn) 60%, var(--gf-border)); }
    figure.toxic.severe .pick { border-color: color-mix(in srgb, var(--gf-danger) 65%, var(--gf-border)); }
    figure.chosen .pick { box-shadow: 0 0 0 3px color-mix(in srgb, var(--gf-text) 18%, transparent); }

    .big { justify-self: center; min-height: 52px; min-width: min(100%, 260px); padding: 12px 28px; gap: 10px; border-radius: var(--gf-radius-pill); font-size: 1.0625rem; }

    /* The answer. */
    .answer { display: grid; gap: 10px; padding: 14px 16px; border-radius: 14px; background: var(--gf-surface); border: 1px solid var(--gf-border); }
    .verdict { margin: 0; font-size: 1.0625rem; line-height: 1.4; }
    .verdict .bi { vertical-align: -0.15em; }
    .right .verdict .bi { color: var(--gf-accent); }
    .wrong .verdict .bi { color: var(--gf-danger); }
    .facts { display: grid; gap: 4px; margin: 0; }
    .facts div { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
    .facts dt { font-weight: 600; }
    .facts dd { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0; }
    .facts .from { font-size: 0.875rem; color: var(--gf-text-muted); }
    .src { margin: 0; padding-left: 18px; font-size: 0.8125rem; line-height: 1.4; color: var(--gf-text-muted); }
    .src-head { margin: 0; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--gf-text-muted); }

    /* The recap. */
    .score { margin: 0; font-size: 1.125rem; }
    .score strong { font-size: 2.25rem; line-height: 1; color: var(--gf-accent); margin-right: 4px; }
    .lesson { margin: 0; color: var(--gf-text-muted); }
    .rows { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .row { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 10px; padding: 10px 12px; border-radius: 14px; background: var(--gf-surface); border: 1px solid var(--gf-border); }
    .row .mark { grid-row: span 3; font-size: 1.15rem; padding-top: 8px; }
    .row.right .mark { color: var(--gf-accent); }
    .row.wrong .mark { color: var(--gf-danger); }
    /* The look-alike ↔ the plant sought, each in its half (a long name wraps there). */
    .who { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: start; gap: 2px 8px; margin: 0; }
    .who .side { display: grid; justify-items: start; gap: 2px; min-width: 0; }
    .who .vs { align-self: center; color: var(--gf-text-muted); }
    .part { margin: 0; font-size: 0.8125rem; color: var(--gf-text-muted); }
    .plant-link { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 6px 0 0; font-weight: 600; text-align: left; overflow-wrap: anywhere; }
    .plant-link gf-thumb { flex: none; }
    .said { margin: 0; font-size: 0.875rem; line-height: 1.4; color: var(--gf-text); }
    .said .bi { color: var(--gf-warn); margin-right: 4px; }
    .said .owner { color: var(--gf-text-muted); white-space: nowrap; }
    .src-note { margin: 0; font-size: 0.8125rem; line-height: 1.4; color: var(--gf-text-muted); }
    .sos-line { display: flex; gap: 8px; margin: 0; padding: 10px 12px; border-radius: 12px; font-size: 0.9375rem; line-height: 1.4;
      background: color-mix(in srgb, var(--gf-danger) 9%, var(--gf-surface)); border: 1px solid color-mix(in srgb, var(--gf-danger) 35%, var(--gf-border)); }
    .sos-line > .bi { flex: none; margin-top: 0.2em; color: var(--gf-danger); }
    .sos-line a { color: inherit; font-weight: 600; }
    .acts { display: grid; justify-items: center; gap: 6px; }
    .acts .link { min-height: 44px; }
    .state { margin: 0; color: var(--gf-text-muted); }
    .state.alert { color: var(--gf-danger); }

    @container (max-width: 420px) {
      .wrap { padding: 12px 12px 28px; }
      .card-view, .recap { gap: 12px; }
      h1 { font-size: 1.2rem; }
      .pair { gap: 8px; }
      .pick { padding: 6px 6px 8px; border-radius: 14px; }
      .name { font-size: 0.9375rem; }
    }
    @media (pointer: fine) { .plant-link, .acts .link { min-height: 32px; } }
  `];

  constructor() {
    super();
    /** @type {import('../runtime.js').MiniApp | null} */
    this.app = null;
    /** @type {any} */
    this.c = null;
    /** @type {number | null} */
    this._at = null;
    /** @type {Map<string, any>} */
    this._plants = new Map();
    this._dealing = false;
  }

  /** The taxa whose plant was asked for. */
  #asked = new Set();
  /** The photos that did not load: neither shown nor credited. */
  #broken = new Set();
  /** What gets the focus once drawn (a selector): the new view's title, the answer. */
  #focus = '';
  /** Waiting for a plant's sheet to close (« Nouvelle partie » from the recap, its sheet open). @type {(() => void) | null} */
  #closed = null;

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (!changed.has('c')) return;
    this.toggleAttribute('sheet', typeof this.c?.focus === 'number');
    if (this.#closed && this.c?.focus == null) this.#closed();
    for (const card of /** @type {Card[]} */ (this.c?.cards ?? [])) for (const p of card.plants) {
      if (this.#asked.has(p.taxon)) continue;
      this.#asked.add(p.taxon);
      plantFor(p.taxon).then(r => { this._plants = new Map(this._plants).set(p.taxon, r); }, () => { this.#asked.delete(p.taxon); });
    }
  }

  updated() {
    if (!this.#focus) return;
    const el = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector(this.#focus));
    if (el) { this.#focus = ''; el.focus(); }
  }

  /** The card `at` answered `choice` (a plant's taxon, or SKIP); its answer shown. @param {number} at @param {string} choice */
  #choose(at, choice) {
    const game = answered(this.c.game, at, choice);
    if (game === this.c.game) return;
    this._at = at;
    this.#focus = '.verdict';
    this.app?.set({ game });
  }

  /** On to the card to answer now, or the recap. */
  #next() {
    this._at = null;
    this.#focus = '#fa-title';
  }

  /** A plant's sheet, or none (the box keeps it in the address, and closes it through history). @param {number | null} id */
  #sheet(id) { this.dispatchEvent(new CustomEvent('ma-plant', { detail: { id }, bubbles: true, composed: true })); }

  /** The sheet open beside the recap closed, as Back would (its entry left), before anything else. @returns {Promise<void>} */
  #closeSheet() {
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); this.#closed = null; resolve(); };
      const timer = setTimeout(done, 1500);
      this.#closed = done;
      this.#sheet(null);
    });
  }

  /** « Nouvelle partie »: a plant's sheet closed first, then dealt again from the file, its first card's question in focus. */
  async #again() {
    if (this._dealing || !this.app) return;
    this._dealing = true;
    try {
      if (typeof this.c?.focus === 'number') await this.#closeSheet();
      await this.app.do('deal');
    } finally { this._dealing = false; }
    this._at = null;
    this.#focus = '#fa-title';
  }

  /** « Réessayer »: the file read again, the game kept. */
  #retry() {
    this.app?.set({ lookalikes: null, retry: (this.c?.retry ?? 0) + 1 });
    this.#focus = '#fa-title';
  }

  /** « Nouvelle partie » (busy while dealt). */
  #againButton() {
    return html`<button class="primary big again" type="button" ?disabled=${this._dealing} aria-busy=${this._dealing ? 'true' : 'false'}
      @click=${() => this.#again()}>${icon('arrow-counterclockwise')} ${this._dealing ? 'Les cartes…' : 'Nouvelle partie'}</button>`;
  }

  render() {
    const c = this.c;
    if (!c || !this.app || !c.game) return nothing;
    const sheet = typeof c.focus === 'number' ? html`<ma-plant-sheet .open=${c.focus} scoped layout-key=${SHEET_KEY} back="Retour au bilan"></ma-plant-sheet>` : nothing;
    // The file being read, or unreadable (said, never « nothing to fear »; « Réessayer » reads it again, the game kept).
    if (!c.lookalikes) return html`<div class="wrap"><h1 class="visually-hidden">Faux amis</h1><p class="state" role="status">Les cartes…</p></div>`;
    if (c.lookalikes.unread) return html`<div class="wrap"><section class="card-view">
      <h1 id="fa-title" tabindex="-1">Liste des confusions indisponible</h1>
      <p class="state alert" role="alert">${fr(UNREAD_LOOKALIKES)}</p>
      <button class="primary big retry" type="button" @click=${() => this.#retry()}>${icon('arrow-counterclockwise')} Réessayer</button></section></div>`;
    /** @type {Card[] | null} */
    const cards = c.cards;
    if (!cards) return html`<div class="wrap"><section class="card-view"><h1 id="fa-title" tabindex="-1">Une partie à recommencer</h1>
      <p class="none">${fr('La liste des confusions a changé depuis cette partie : ses cartes ne sont plus à jour.')}</p>${this.#againButton()}</section></div>`;
    const at = this._at ?? nextCard(c.game);
    return html`<div class="wrap">${repeat([at], k => k, () => at < 0 ? this.#recap(cards) : this.#card(cards, at))}</div>${sheet}`;
  }

  /** A card: its question, its two plants, its answer once given. @param {Card[]} cards @param {number} at */
  #card(cards, at) {
    const card = cards[at];
    return html`<section class="card-view" aria-labelledby="fa-title">
      <div class="top"><p class="count">Carte ${at + 1} sur ${cards.length}</p>
        <ol class="dots" aria-hidden="true">${cards.map((k, i) => html`<li class=${i === at && k.answer == null ? 'now' : k.right === true ? 'right' : k.right === false ? 'wrong' : ''}></li>`)}</ol></div>
      <h1 id="fa-title" tabindex="-1">${card.clue ? 'À qui est cet indice ?' : 'Aucun indice sûr'}</h1>
      ${card.clue
        ? html`<blockquote class="clue">${icon('quote')}<p>${fr(card.clue.text)}</p></blockquote>`
        : html`<p class="none">${fr('Ces deux plantes se confondent, et les sources ne donnent aucun critère pour les distinguer.')}</p>`}
      <div class="pair">${card.plants.map(p => this.#plant(card, at, p))}</div>
      ${card.answer != null ? this.#answer(card, cards)
        : card.clue ? nothing
        : html`<button class="primary big skip" type="button" @click=${() => this.#choose(at, SKIP)}>${icon('shield-check')} Je ne cueille pas</button>`}
    </section>`;
  }

  /** A plant of a card: its photo and name (to touch, for a criterion not yet attributed); answered, which one it is. @param {Card} card @param {number} at @param {Plant} p */
  #plant(card, at, p) {
    const rec = this._plants.get(p.taxon);
    const found = rec ? knownThumb(rec) : null;
    const url = found && !this.#broken.has(found) ? found : null, credit = url ? knownCredit(rec) : null;
    const done = card.answer != null, sev = severityOf(card.pair), severe = sev.danger ? 'severe' : 'mild';
    const failed = (/** @type {Event} */ e) => { hideImg(e); if (url) this.#broken.add(url); this.requestUpdate(); };
    const body = html`<span class="photo">${url ? html`<img src=${url} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error=${failed} @load=${showImg} />` : nothing}<span class="ph" aria-hidden="true">${icon('leaf-fill')}</span></span>
      <span class="name">${p.label}</span>${rec?.scientificName ? html`<span class="sci">${rec.scientificName}</span>` : nothing}`;
    return html`<figure class="${done ? p.side : ''} ${done && p.side === 'toxic' ? severe : ''} ${card.answer === p.taxon ? 'chosen' : ''}">
      ${card.clue && !done ? html`<button class="pick" type="button" @click=${() => this.#choose(at, p.taxon)}>${body}</button>` : html`<div class="pick">${body}</div>`}
      ${done ? (p.side === 'toxic'
        ? html`<span class="tag ${severe}">${icon('exclamation-triangle-fill')} Faux ami · ${sev.tag}</span>`
        : html`<span class="tag">Plante cherchée</span>`) : nothing}
      ${card.answer === p.taxon ? html`<span class="yours">Votre choix</span>` : nothing}
      ${credit ? html`<figcaption class="credit">Photo : ${creditText(credit)}</figcaption>` : nothing}
    </figure>`;
  }

  /**
   * The answer: right or not, whose criterion; the look-alike and how dangerous (and from whom that is), the pair's other
   * plants, the part mistaken, the sources; on. @param {Card} card @param {Card[]} cards
   */
  #answer(card, cards) {
    const sev = severityOf(card.pair), more = cards.some(k => k.answer == null);
    return html`<div class="answer ${card.right ? 'right' : 'wrong'}">
      <p class="verdict" tabindex="-1">${icon(card.right ? 'check-circle-fill' : 'x-lg')} <strong>${card.clue ? (card.right ? 'Bien vu' : 'Raté') : 'Bonne décision'}</strong>${
        card.clue ? fr(` : cet indice décrit ${card.clue.label}.`) : fr(' : sans critère sûr, on ne cueille pas.')}</p>
      <dl class="facts">
        <div><dt>${fr('Faux ami :')}</dt><dd>${card.toxic.label} <span class="tag ${sev.danger ? 'severe' : 'mild'}">${sev.tag}</span>${card.pair.severityFrom === 'tppt'
          ? html`<span class="from">${fr('(niveau le plus haut de la base TPPT d’Agroscope, « très fortement toxique »)')}</span>` : nothing}</dd></div>
        ${card.also.length ? html`<div><dt>${fr('Dans la même confusion :')}</dt><dd>${this.#also(card)}</dd></div>` : nothing}
        <div><dt>${fr('Partie confondue :')}</dt><dd>${card.pair.part}</dd></div>
      </dl>
      <p class="src-head">${card.sources.length > 1 ? 'Sources' : 'Source'}</p>
      <ul class="src">${card.sources.map(s => html`<li>${fr(sourceLine(s))}</li>`)}</ul>
      <button class="primary big next" type="button" @click=${() => this.#next()}>${more ? 'Carte suivante' : 'Le bilan'} ${icon('arrow-right')}</button>
    </div>`;
  }

  /** The pair's other plants, the look-alikes said so (Petite ciguë beside Grande ciguë). @param {Card} card */
  #also(card) {
    return card.also.map((p, i) => html`${i ? ', ' : ''}${p.label}${p.side === 'toxic' ? ' (faux ami)' : ''}`);
  }

  /** The recap: the score, the six pairs (each plant's sheet), from whom, whom to call, another game. @param {Card[]} cards */
  #recap(cards) {
    const { right, total } = scoreOf(cards);
    const tppt = cards.some(k => k.pair.severityFrom === 'tppt');
    return html`<section class="recap" aria-labelledby="fa-title">
      <h1 id="fa-title" tabindex="-1">Partie terminée</h1>
      <p class="score"><strong>${right}</strong> ${right > 1 ? 'bonnes réponses' : 'bonne réponse'} sur ${total}</p>
      <p class="lesson">${fr('Au moindre doute, on ne cueille pas : un indice ne suffit jamais seul, une photo encore moins.')}</p>
      <ol class="rows">${cards.map(card => this.#row(card))}</ol>
      <p class="src-note">${fr(`Confusions, indices et sources : Anses et Centres antipoison${tppt ? ' ; « très toxique » : niveau le plus haut de la base TPPT d’Agroscope' : ''}.`)}</p>
      <p class="sos-line">${icon('exclamation-triangle-fill')}<span>${fr('Une plante avalée par erreur ?')} ${emergency()}.</span></p>
      <div class="acts">
        ${this.#againButton()}
        <button class="link muted" type="button" @click=${() => this.app?.scenarios()}>${icon('camera-reels')} ${fr('Autres scénarios')}</button>
      </div>
    </section>`;
  }

  /** A pair of the recap: right or not, its two plants (their sheets), the others, the part, the criterion and whose it is. @param {Card} card */
  #row(card) {
    const sev = severityOf(card.pair);
    const plant = (/** @type {Plant} */ p) => {
      const rec = this._plants.get(p.taxon);
      return rec?.id != null
        ? html`<button class="link plant-link" type="button" @click=${() => this.#sheet(rec.id)} aria-label=${`${p.label}, voir sa fiche`}><gf-thumb .plant=${rec} size="32" round></gf-thumb>${p.label}</button>`
        : html`<span class="plant-link">${p.label}</span>`;
    };
    return html`<li class="row ${card.right ? 'right' : 'wrong'}">
      <span class="mark">${icon(card.right ? 'check-circle-fill' : 'x-lg')}<span class="visually-hidden">${card.right ? 'Bonne réponse' : 'Raté'}</span></span>
      <p class="who"><span class="side">${plant(card.toxic)}<span class="tag ${sev.danger ? 'severe' : 'mild'}">${sev.tag}</span></span>
        <span class="vs" aria-hidden="true">↔</span><span class="visually-hidden">à ne pas confondre avec</span><span class="side">${plant(card.sought)}</span></p>
      <p class="part">${fr(`Partie confondue : ${card.pair.part}`)}${card.also.length ? html` · ${fr('Dans la même confusion :')} ${this.#also(card)}` : nothing}</p>
      <p class="said">${card.clue
        ? html`${icon('quote')}${fr(card.clue.text)} <span class="owner">${fr(`— ${card.clue.label}`)}</span>`
        : fr('Aucun critère dans les sources : on ne cueille pas.')}</p>
    </li>`;
  }
}

customElements.define('ma-faux-amis', MaFauxAmis);
