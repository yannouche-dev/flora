// @ts-check
// Faux amis, playing (the step « play »; its game: kit/faux-amis.js). One card at a time: its two plants side by side,
// each with its name and its photo (the flora's, through core/thumb.js: none with « Photos en ligne » off), and either a
// criterion of the sources to attribute (« À qui est cet indice ? »: a plant to touch) or, for a pair they give none
// for, the only answer « Je ne cueille pas ». Then the answer: whose criterion it was, the look-alike and how dangerous,
// the part mistaken, the sources, « Carte suivante ». After the sixth, the recap: the score, the six pairs and their
// criteria, each plant's sheet (the event ma-plant: the box keeps ?p=, ma-plant-sheet shows it), whom to call,
// « Nouvelle partie ». The game is the context's (`game`, kept on this device), its words the file's (`cards`): a game
// the file no longer gives (corrected since) is said, and dealt again.

import { LitElement, html, css, nothing, repeat } from 'lit';
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
import { SKIP, answered, nextCard, pickPlant, scoreOf } from './faux-amis.js';
import './ma-plant-sheet.js';
import '../../components/gf-thumb.js';

/**
 * @typedef {import('./faux-amis.js').Card} Card
 * @typedef {import('./faux-amis.js').Plant} Plant
 */

/** The plant of the flora each taxon shows (faux-amis.js#pickPlant), read once the flora is in. @type {Map<string, Promise<any>>} */
const shown = new Map();

/** @param {string} taxon @returns {Promise<any>} */
function plantFor(taxon) {
  let found = shown.get(taxon);
  if (!found) {
    const [genus, species] = taxon.split(' ');
    found = whenReady()
      .then(() => species ? db.getAllByIndex('plants', 'by_taxon', [genus, species]) : db.getAllByIndex('plants', 'by_genus', genus))
      .then(rows => pickPlant(taxon, rows), () => null);
    shown.set(taxon, found);
  }
  return found;
}

/** « Anses et Centres antipoison, 2025 »: who said it, and when. @param {import('../../core/lookalikes.js').Source} s */
const sourceLine = s => `${s.title} — ${s.publisher}, ${String(s.date).slice(0, 4)}`;

export class MaFauxAmis extends LitElement {
  static properties = {
    app: { attribute: false },
    c: { attribute: false },
    /** The card shown, answered or not; null: the one to answer now (the recap after the last). */
    _at: { state: true },
    /** The flora's plant of each taxon on the cards (null: none). */
    _plants: { state: true }
  };

  static styles = [ui, css`
    :host { display: block; min-height: 100%; background: var(--gf-bg, var(--gf-surface-2)); container-type: inline-size; }
    .wrap { display: grid; max-width: 680px; margin: 0 auto; padding: 16px 16px 32px; box-sizing: border-box; }
    .card-view, .recap { display: grid; gap: 14px; min-width: 0; }
    h2 { margin: 0; font-size: 1.35rem; line-height: 1.25; text-wrap: balance; }
    h2:focus, .verdict:focus { outline: none; }
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

    .skip, .next, .again { justify-self: center; min-height: 52px; min-width: min(100%, 260px); padding: 12px 28px; gap: 10px; border-radius: var(--gf-radius-pill); font-size: 1.0625rem; }

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
    .sos-line { display: flex; gap: 8px; margin: 0; padding: 10px 12px; border-radius: 12px; font-size: 0.9375rem; line-height: 1.4;
      background: color-mix(in srgb, var(--gf-danger) 9%, var(--gf-surface)); border: 1px solid color-mix(in srgb, var(--gf-danger) 35%, var(--gf-border)); }
    .sos-line > .bi { flex: none; margin-top: 0.2em; color: var(--gf-danger); }
    .sos-line a { color: inherit; font-weight: 600; }
    .acts { display: grid; justify-items: center; gap: 6px; }
    .acts .link { min-height: 44px; }
    .state { margin: 24px 0 0; text-align: center; color: var(--gf-text-muted); }
    .state.alert { color: var(--gf-danger); }

    @container (max-width: 420px) {
      .wrap { padding: 12px 12px 28px; gap: 12px; }
      h2 { font-size: 1.2rem; }
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
  }

  /** The game the card shown belongs to: another one (a new game), and the card to answer is shown. */
  #game = /** @type {any} */ (undefined);
  /** The taxa whose plant was asked for. */
  #asked = new Set();
  /** What gets the focus once drawn (a selector): the new card's question, the answer, the recap. */
  #focus = '';

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (!changed.has('c')) return;
    const game = this.c?.game;
    if (game !== this.#game) { this.#game = game; this._at = null; }
    for (const card of /** @type {Card[]} */ (this.c?.cards ?? [])) for (const p of card.plants) {
      if (this.#asked.has(p.taxon)) continue;
      this.#asked.add(p.taxon);
      plantFor(p.taxon).then(r => { this._plants = new Map(this._plants).set(p.taxon, r); });
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
    this.#game = game;
    this._at = at;
    this.#focus = '.verdict';
    this.app?.set({ game });
  }

  /** On to the card to answer now, or the recap. */
  #next() {
    this._at = null;
    this.#focus = nextCard(this.c.game) >= 0 ? '#fa-question' : '#fa-recap';
  }

  /** A plant's sheet (the box keeps it in the address). @param {number} id */
  #sheet(id) { this.dispatchEvent(new CustomEvent('ma-plant', { detail: { id }, bubbles: true, composed: true })); }

  /** « Nouvelle partie »: dealt again from the file, its first card's question in focus. */
  async #again() {
    await this.app?.do('deal');
    this.#focus = '#fa-question';
    this.requestUpdate();
  }

  render() {
    const c = this.c, app = this.app;
    if (!c || !app || !c.game) return nothing;
    const sheet = typeof c.focus === 'number' ? html`<ma-plant-sheet .open=${c.focus} scoped></ma-plant-sheet>` : nothing;
    const again = html`<button class="primary again" type="button" ?disabled=${app.busy('deal')} @click=${() => this.#again()}>${icon('arrow-counterclockwise')} Nouvelle partie</button>`;
    // The file being read, or unreadable (said, never « nothing to fear »; « Nouvelle partie » asks for it again).
    if (!c.lookalikes) return html`<div class="wrap"><p class="state" role="status">Les cartes…</p></div>`;
    if (c.lookalikes.unread) return html`<div class="wrap"><p class="state alert" id="fa-question" role="alert" tabindex="-1">${fr(UNREAD_LOOKALIKES)}</p>${again}</div>`;
    /** @type {Card[] | null} */
    const cards = c.cards;
    if (!cards) return html`<div class="wrap"><h2 id="fa-question" tabindex="-1">Une partie à recommencer</h2>
      <p class="none">${fr('La liste des confusions a changé depuis cette partie : ses cartes ne sont plus à jour.')}</p>${again}</div>`;
    const at = this._at ?? nextCard(c.game);
    return html`<div class="wrap">${repeat([at], k => k, () => at < 0 ? this.#recap(cards) : this.#card(cards, at))}</div>${sheet}`;
  }

  /** A card: its question, its two plants, its answer once given. @param {Card[]} cards @param {number} at */
  #card(cards, at) {
    const card = cards[at];
    return html`<section class="card-view" aria-labelledby="fa-question">
      <div class="top"><p class="count">Carte ${at + 1} sur ${cards.length}</p>
        <ol class="dots" aria-hidden="true">${cards.map((k, i) => html`<li class=${i === at && k.answer == null ? 'now' : k.right === true ? 'right' : k.right === false ? 'wrong' : ''}></li>`)}</ol></div>
      <h2 id="fa-question" tabindex="-1">${card.clue ? 'À qui est cet indice ?' : 'Aucun indice sûr'}</h2>
      ${card.clue
        ? html`<blockquote class="clue">${icon('quote')}<p>${fr(card.clue.text)}</p></blockquote>`
        : html`<p class="none">${fr('Ces deux plantes se confondent, et les sources ne donnent aucun critère pour les distinguer.')}</p>`}
      <div class="pair">${card.plants.map(p => this.#plant(card, at, p))}</div>
      ${card.answer != null ? this.#answer(card, cards)
        : card.clue ? nothing
        : html`<button class="primary skip" type="button" @click=${() => this.#choose(at, SKIP)}>${icon('shield-check')} Je ne cueille pas</button>`}
    </section>`;
  }

  /** A plant of a card: its photo and name (to touch, for a criterion not yet attributed); answered, which one it is. @param {Card} card @param {number} at @param {Plant} p */
  #plant(card, at, p) {
    const rec = this._plants.get(p.taxon);
    const url = rec ? knownThumb(rec) : null, credit = rec ? knownCredit(rec) : null;
    const done = card.answer != null, sev = severityOf(card.pair), severe = sev.danger ? 'severe' : 'mild';
    const body = html`<span class="photo">${url ? html`<img src=${url} alt="" loading="lazy" decoding="async" @error=${hideImg} @load=${showImg} />` : nothing}<span class="ph" aria-hidden="true">${icon('leaf-fill')}</span></span>
      <span class="name">${p.label}</span>${rec?.scientificName ? html`<span class="sci">${rec.scientificName}</span>` : nothing}`;
    return html`<figure class="${done ? p.side : ''} ${done && p.side === 'toxic' ? severe : ''} ${card.answer === p.taxon ? 'chosen' : ''}">
      ${card.clue && !done ? html`<button class="pick" type="button" @click=${() => this.#choose(at, p.taxon)}>${body}</button>` : html`<div class="pick">${body}</div>`}
      ${done ? (p.side === 'toxic'
        ? html`<span class="tag ${severe}">${icon('exclamation-triangle-fill')} Faux ami · ${sev.tag}</span>`
        : html`<span class="tag">Plante cherchée</span>`) : nothing}
      ${card.answer === p.taxon ? html`<span class="yours">Votre choix</span>` : nothing}
      ${url && credit ? html`<figcaption class="credit">Photo : ${creditText(credit)}</figcaption>` : nothing}
    </figure>`;
  }

  /** The answer: right or not, whose criterion, the look-alike, the part mistaken, the sources; on. @param {Card} card @param {Card[]} cards */
  #answer(card, cards) {
    const owner = card.clue ? card.plants.find(p => p.taxon === card.clue?.taxon) : null;
    const toxic = /** @type {Plant} */ (card.plants.find(p => p.side === 'toxic')), sev = severityOf(card.pair);
    const more = cards.some(k => k.answer == null);
    return html`<div class="answer ${card.right ? 'right' : 'wrong'}">
      <p class="verdict" tabindex="-1">${icon(card.right ? 'check-circle-fill' : 'x-lg')} <strong>${owner ? (card.right ? 'Bien vu' : 'Raté') : 'Bonne décision'}</strong>${
        owner ? fr(` : cet indice décrit ${owner.label}.`) : fr(' : sans critère sûr, on ne cueille pas.')}</p>
      <dl class="facts">
        <div><dt>${fr('Faux ami :')}</dt><dd>${toxic.label} <span class="tag ${sev.danger ? 'severe' : 'mild'}">${sev.tag}</span></dd></div>
        <div><dt>${fr('Partie confondue :')}</dt><dd>${card.pair.part}</dd></div>
      </dl>
      <p class="src-head">Sources</p>
      <ul class="src">${card.sources.map(s => html`<li>${fr(sourceLine(s))}</li>`)}</ul>
      <button class="primary next" type="button" @click=${() => this.#next()}>${more ? 'Carte suivante' : 'Le bilan'} ${icon('arrow-right')}</button>
    </div>`;
  }

  /** The recap: the score, the six pairs (each plant's sheet), whom to call, another game. @param {Card[]} cards */
  #recap(cards) {
    const { right, total } = scoreOf(cards);
    return html`<section class="recap" aria-labelledby="fa-recap">
      <h2 id="fa-recap" tabindex="-1">Partie terminée</h2>
      <p class="score"><strong>${right}</strong> ${right > 1 ? 'bonnes réponses' : 'bonne réponse'} sur ${total}</p>
      <p class="lesson">${fr('Au moindre doute, on ne cueille pas : un indice ne suffit jamais seul, une photo encore moins.')}</p>
      <ol class="rows">${cards.map(card => this.#row(card))}</ol>
      <p class="sos-line">${icon('exclamation-triangle-fill')}<span>${fr('Une plante avalée par erreur ?')} ${emergency()}.</span></p>
      <div class="acts">
        <button class="primary again" type="button" ?disabled=${this.app?.busy('deal')} @click=${() => this.#again()}>${icon('arrow-counterclockwise')} Nouvelle partie</button>
        <button class="link muted" type="button" @click=${() => this.app?.scenarios()}>${icon('camera-reels')} ${fr('Autres scénarios')}</button>
      </div>
    </section>`;
  }

  /** A pair of the recap: right or not, its two plants (their sheets), the part, the criterion and whose it is. @param {Card} card */
  #row(card) {
    const toxic = /** @type {Plant} */ (card.plants.find(p => p.side === 'toxic')), sought = /** @type {Plant} */ (card.plants.find(p => p.side === 'edible'));
    const sev = severityOf(card.pair), owner = card.clue ? card.plants.find(p => p.taxon === card.clue?.taxon) : null;
    const plant = (/** @type {Plant} */ p) => {
      const rec = this._plants.get(p.taxon);
      return rec?.id != null
        ? html`<button class="link plant-link" type="button" @click=${() => this.#sheet(rec.id)} aria-label=${`${p.label}, voir sa fiche`}><gf-thumb plant-id=${rec.id} size="32" round></gf-thumb>${p.label}</button>`
        : html`<span class="plant-link">${p.label}</span>`;
    };
    return html`<li class="row ${card.right ? 'right' : 'wrong'}">
      <span class="mark">${icon(card.right ? 'check-circle-fill' : 'x-lg')}<span class="visually-hidden">${card.right ? 'Bonne réponse' : 'Raté'}</span></span>
      <p class="who"><span class="side">${plant(toxic)}<span class="tag ${sev.danger ? 'severe' : 'mild'}">${sev.tag}</span></span>
        <span class="vs" aria-hidden="true">↔</span><span class="visually-hidden">à ne pas confondre avec</span><span class="side">${plant(sought)}</span></p>
      <p class="part">${fr(`Partie confondue : ${card.pair.part}`)}</p>
      <p class="said">${owner && card.clue
        ? html`${icon('quote')}${fr(card.clue.text)} <span class="owner">${fr(`— ${owner.label}`)}</span>`
        : fr('Aucun critère sûr dans les sources : on ne cueille pas.')}</p>
    </li>`;
  }
}

customElements.define('ma-faux-amis', MaFauxAmis);
