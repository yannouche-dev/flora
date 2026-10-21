// @ts-check
// The deck of a mini-app around a place: one card at a time, the next under it — its photo and credit, what
// Wikipédia says of it, a short bio (its safety first: kit/cards.js#bio). Dragged, it leans and shows its stamp
// (MATCH, BOF); far enough, or thrown, it flies off: right a match, left passed; up (or a touch), its sheet. The three
// buttons (↺ undo, ✕, ♥, « ⋯ » its sheet unless `guided`, and its photos when asked: `photos`) and the keys (→ ←, ↑) do the same — the keys only when
// the deck has the focus or nothing has (never a match by mistake from a tab, a slider or the map), and only while
// `active` (no plant open, no match on screen). Cueillette prudente's toxic look-alikes (kit/session.js#avoids) are never
// loved: their right says « Je la reconnais : à ne pas cueillir » (stamp À ÉVITER, ⛔ for ♥, a tag on the card).
// The first time, the top card leans right then left: it can be swiped.
// The hint once per app open (and again after « Rejouer »: kit/session.js#forgetGame). No more cards: further (« Chercher jusqu’à … »), or the ones passed again
// (and those recognised to avoid, counted apart from the matches).
// It decides nothing itself: the card flown off, the event `deck-decide` (detail { card, liked }); `deck-open`
// (detail { id }), `deck-undo`, `deck-photos` (detail { id }). The session (kit/session.js) gives the rest.

import { LitElement, html, css, nothing, repeat } from 'lit';
import { icon } from '../../core/icons.js';
import { hideImg, showImg } from '../../core/img.js';
import { creditText } from '../../core/credit.js';
import { moduleEvents, moduleOn } from '../../core/modules.js';
import { plantViewOf, StoreController } from '../../core/store.js';
import { floweringMonths } from '../../core/plants.js';
import { ui } from '../../styles/ui.js';
import { bio, distLabel, nameOf, nextDistance } from './cards.js';

/** @typedef {import('./cards.js').Card} Card */

/** A pointer still this long (ms) before it is let go: the card was held, not thrown. */
const REST_MS = 60;

export class MaDeck extends LitElement {
  static properties = {
    /** The game (kit/session.js). */
    session: { attribute: false },
    /** The cards as shown, the top one first. */
    cards: { attribute: false },
    /** The app's context (its matches, passed, distance). */
    c: { attribute: false },
    /** Rencontres while discovering: no « ⋯ », no ↑ (the plant is beside it), its size in the guided layout. */
    guided: { type: Boolean, reflect: true },
    /** The keys act on the deck (no plant open, no match on screen). */
    active: { type: Boolean },
    /** A button for the photos of the card on top (Rencontres, once they were shown: kit/ma-meet-media.js). */
    photos: { type: Boolean }
  };

  static styles = [ui, css`
    :host { display: block; }
    /* The deck: one card, the next under it; dragged, it leans and shows its stamp. */
    .deck-wrap { display: grid; justify-items: center; gap: 14px; }
    /* Its height: what its page gives it (--deck-max, --deck-min: the list fits its column), else the window's. */
    .deck { position: relative; width: min(100%, 380px); aspect-ratio: 3 / 4.3; max-height: var(--deck-max, calc(100dvh - 300px)); min-height: var(--deck-min, 360px); }
    .swipe-card { position: absolute; inset: 0; border-radius: 18px; overflow: hidden; background: #2a3a2a; color: #fff; box-shadow: 0 12px 30px rgb(0 0 0 / 25%);
      touch-action: none; user-select: none; -webkit-user-select: none; cursor: grab; z-index: 2;
      transition: transform 0.32s cubic-bezier(0.2, 0.8, 0.2, 1), filter 0.32s ease-out; }
    .swipe-card.dragging { transition: none; cursor: grabbing; }
    .swipe-card.fly { transition: transform 0.26s ease-in; }
    /* The first time: a little swipe right, then left (its stamps showing a moment), and back. */
    .swipe-card.hint { animation: swipe-hint 1.6s ease-in-out; }
    .swipe-card.hint .stamp.like { animation: hint-like 1.6s ease-in-out; }
    .swipe-card.hint .stamp.nope { animation: hint-nope 1.6s ease-in-out; }
    @keyframes swipe-hint { 25% { transform: translateX(46px) rotate(5deg); } 40% { transform: none; } 65% { transform: translateX(-46px) rotate(-5deg); } 80%, to { transform: none; } }
    @keyframes hint-like { 25% { opacity: 0.7; } 40%, to { opacity: 0; } }
    @keyframes hint-nope { 0%, 40% { opacity: 0; } 65% { opacity: 0.7; } 80%, to { opacity: 0; } }
    /* The card underneath: smaller, a little lower and darker; it rises as the one on top is dragged away (--rise, 0 → 1),
       and is full size when the top one has flown — the swap then shows nothing. A new one fades in under it. */
    .swipe-card.under { z-index: 1; pointer-events: none; animation: under-in 0.32s ease-out;
      transform: scale(calc(0.94 + 0.06 * var(--rise, 0))) translateY(calc(10px * (1 - var(--rise, 0)))); filter: brightness(calc(0.9 + 0.1 * var(--rise, 0))); }
    .swipe-card.under.following { transition: none; }
    /* Risen while the top card flies (0.26 s): full size before the swap. */
    .swipe-card.under.rising { transition: transform 0.24s ease-out, filter 0.24s ease-out; }
    /* Risen while the top card flies (0.26 s): full size before the swap. */
    .swipe-card.under.rising { transition: transform 0.24s ease-out, filter 0.24s ease-out; }
    @keyframes under-in { from { opacity: 0; transform: scale(0.9) translateY(18px); } }
    .swipe-card img, .swipe-card .nophoto { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
    .swipe-card .nophoto { display: grid; place-items: center; font-size: 4rem; opacity: 0.4; }
    .swipe-card .about { position: absolute; left: 0; right: 0; bottom: 0; padding: 60px 16px 14px; background: linear-gradient(transparent, rgb(0 0 0 / 82%) 45%); }
    .swipe-card h2 { margin: 0 0 6px; font-size: 1.5rem; line-height: 1.15; display: grid; }
    .swipe-card h2 small { font-size: 0.85rem; font-weight: 400; font-style: italic; opacity: 0.85; }
    .bio { margin: 0; padding: 0; list-style: none; display: grid; gap: 3px; font-size: 0.86rem; line-height: 1.35; }
    .stamp { position: absolute; top: 26px; padding: 4px 12px; border: 4px solid; border-radius: 10px; font-size: 1.8rem; font-weight: 900; letter-spacing: 0.08em; opacity: 0; pointer-events: none; }
    .stamp.like { left: 18px; color: #4ade80; transform: rotate(-14deg); opacity: var(--like, 0); }
    .stamp.nope { right: 18px; color: #f87171; transform: rotate(14deg); opacity: var(--nope, 0); }
    /* Cueillette prudente, a toxic look-alike: recognised, to avoid — never a match. */
    .stamp.like.avoid { color: #fbbf24; font-size: 1.5rem; }
    .avoid-tag { display: flex; align-items: center; gap: 5px; width: fit-content; margin: 0 0 6px; padding: 2px 10px; border-radius: var(--gf-radius-pill);
      background: #b91c1c; color: #fff; font-size: 0.8rem; font-weight: 700; }
    /* A plant already loved, brought back on top (touched on the map or in the list around). */
    .loved-badge { position: absolute; top: 12px; left: 12px; z-index: 1; display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: var(--gf-radius-pill);
      background: #e0245e; color: #fff; font-size: 0.8rem; font-weight: 700; box-shadow: 0 0 0 2px #ffd166, 0 2px 8px rgb(0 0 0 / 35%); pointer-events: none; }
    .actions { display: flex; gap: 22px; align-items: center; }
    .round { width: 62px; height: 62px; border-radius: 50%; border: 0; display: grid; place-items: center; font-size: 1.6rem; cursor: pointer; background: var(--gf-surface);
      box-shadow: 0 6px 16px rgb(0 0 0 / 18%); transition: transform 0.12s; }
    .round:active { transform: scale(0.92); }
    .round.pass { color: #ef4444; } .round.like { color: #e0245e; } .round.info { width: 46px; height: 46px; font-size: 1.1rem; color: var(--gf-text-muted); }
    .round.like.avoid { color: #b91c1c; }
    .round:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .round.undo { width: 46px; height: 46px; font-size: 1.05rem; color: #d4a017; }
    .round:disabled { opacity: 0.35; cursor: default; }
    .left { margin: 0; color: var(--gf-text-muted); font-size: 0.85rem; }
    .deck-end { text-align: center; padding: 30px 10px; display: grid; gap: 6px; justify-items: center; }
    .deck-end .big { font-size: 3rem; color: var(--gf-accent); margin: 0; }
    .deck-end p { margin: 0; }
    .deck-end .avoided { display: flex; align-items: center; gap: 6px; color: var(--gf-danger); font-weight: 600; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; margin-top: 8px; }
    /* What is said of it (Wikipédia), on the card. */
    .ethno { margin: 0 0 6px; font-size: 0.86rem; line-height: 1.35; font-style: italic; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .ethno b { font-style: normal; }
    .ethno .wsrc { font-style: normal; font-size: 0.72rem; opacity: 0.8; }
    /* The photo's credit (its author, licence and source): small, over the photo's top corner. */
    .swipe-card .credit { position: absolute; z-index: 1; top: 8px; right: 8px; max-width: calc(100% - 16px); margin: 0; padding: 2px 8px; border-radius: var(--gf-radius-pill);
      background: rgb(0 0 0 / 55%); color: #fff; font-size: 0.68rem; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
    .deck:focus-visible { outline: none; border-radius: 20px; box-shadow: var(--gf-focus); }
    /* A match after the first: a heart flies off the deck. */
    .burst { position: absolute; z-index: 5; left: 50%; top: 45%; font-size: 4rem; color: #e0245e; pointer-events: none; animation: burst 0.9s ease-out forwards; }
    @keyframes burst { from { transform: translate(-50%, -50%) scale(0.4); opacity: 0; } 30% { opacity: 1; transform: translate(-50%, -50%) scale(1.15); } to { transform: translate(-50%, -120%) scale(1); opacity: 0; } }
    /* Discovering (Rencontres), in its column beside the map. */
    :host([guided]) .deck { max-height: calc(100dvh - 320px); min-height: 300px; }
    @media (max-width: 899px) {
      :host([guided]) .deck { max-height: 42dvh; min-height: 240px; aspect-ratio: 3 / 3.6; }
      :host([guided]) .left { display: none; }
      :host([guided]) .actions { gap: 14px; }
      :host([guided]) .round { width: 50px; height: 50px; font-size: 1.3rem; }
    }
    @media (prefers-reduced-motion: reduce) { .swipe-card, .swipe-card.fly, .swipe-card.under { transition: none; animation: none; } .burst { transition: none; animation: none; } }
  `];

  #store = new StoreController(this);

  constructor() {
    super();
    /** @type {import('./session.js').AroundSession | null} */
    this.session = null;
    /** @type {Card[]} */
    this.cards = [];
    /** @type {Record<string, any> | null} */
    this.c = null;
    this.guided = false;
    this.active = false;
    this.photos = false;
  }

  #onChange = () => this.requestUpdate();

  connectedCallback() {
    super.connectedCallback();
    addEventListener('keydown', this.#onKey);
    // A module switched on or off (Réglages, another tab): the photos follow it.
    moduleEvents.addEventListener('change', this.#onChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    removeEventListener('keydown', this.#onKey);
    moduleEvents.removeEventListener('change', this.#onChange);
    this.#watched?.removeEventListener('change', this.#onChange);
    this.#watched = null;
  }

  /** @type {EventTarget | null} */ #watched = null;

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (changed.has('session') && this.session !== this.#watched) {
      this.#watched?.removeEventListener('change', this.#onChange);
      this.#watched = this.session;
      this.#watched?.addEventListener('change', this.#onChange);
    }
  }

  updated() { this.#hintSwipe(); }

  /** The deck takes the focus (after the first match's window): false when there is none (no cards left). */
  focusDeck() {
    const el = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.deck, .deck-end button'));
    el?.focus();
    return Boolean(el);
  }

  /** A plant's photo, unless the « Photos en ligne » module is off in this view (a leaf shows instead). @param {string | null | undefined} url */
  #photo(url) { return url && moduleOn('photos', plantViewOf(this.#store.state)) ? url : null; }

  #onKey = (/** @type {KeyboardEvent} */ e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || !this.active) return;
    // ← passes, → matches, ↑ its sheet — when the deck has the focus, or nothing has (the page itself). Elsewhere
    // (a tab, a button, a field, the map, a slider) the arrows keep their own meaning: never a match by mistake.
    const t0 = /** @type {HTMLElement} */ (e.composedPath()[0]);
    const free = t0 === document.body || t0 === document.documentElement || Boolean(t0?.closest?.('.deck'));
    if (!free) return;
    const top = this.cards[0];
    if (!top) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); this.decide(top, e.key === 'ArrowRight'); }
    else if (e.key === 'ArrowUp' && !this.guided) { e.preventDefault(); this.#open(top); }
  };

  /** @param {Card} card */
  #open(card) { this.dispatchEvent(new CustomEvent('deck-open', { detail: { id: card.plant.id }, bubbles: true, composed: true })); }

  /** The cards just there: the one on top leans a little right, then left — they can be swiped (once). */
  #hintSwipe() {
    if (!this.active || !this.session) return;
    const el = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.swipe-card.top'));
    if (!el || !this.session.hintOnce()) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setTimeout(() => {
      if (!el.isConnected || el.classList.contains('dragging')) return;
      el.classList.add('hint');
      el.addEventListener('animationend', () => el.classList.remove('hint'), { once: true });
    }, 700);
  }

  /**
   * Right: a match (Cueillette prudente's toxic look-alike: recognised, to avoid — the session decides,
   * kit/session.js#swiped); left: passed. The card flies off first, then `deck-decide` says it.
   * @param {Card} card @param {boolean} liked @param {HTMLElement} [el]
   */
  decide(card, liked, el) {
    const node = el || /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.swipe-card.top'));
    const done = () => {
      if (node) { node.style.transition = 'none'; this.#reset(node); node.classList.remove('fly'); requestAnimationFrame(() => { node.style.transition = ''; }); }
      this.dispatchEvent(new CustomEvent('deck-decide', { detail: { card, liked }, bubbles: true, composed: true }));
      // Now on top, the card that rose needs its rise no more (it would show if it came back under, by ↺).
      this.updateComplete.then(() => this.renderRoot.querySelectorAll('.swipe-card').forEach(n => /** @type {HTMLElement} */ (n).style.removeProperty('--rise')));
    };
    node?.classList.remove('hint');
    if (!node || matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return; }
    this.#rise(1);
    node.classList.add('fly');
    node.style.transform = `translate(${liked ? 140 : -140}vw, -40px) rotate(${liked ? 30 : -30}deg)`;
    setTimeout(done, 260);
  }

  /** @type {{ id: number, x: number, y: number, dx: number, dy: number, el: HTMLElement, t: number, vx: number, lx: number, lt: number } | null} */ #drag = null;

  #dragStart = (/** @type {PointerEvent} */ e) => {
    const el = /** @type {HTMLElement} */ (e.currentTarget);
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    this.#drag = { id: Number(el.dataset.id), x: e.clientX, y: e.clientY, dx: 0, dy: 0, el, t: performance.now(), vx: 0, lx: e.clientX, lt: performance.now() };
    el.classList.remove('hint');
    el.classList.add('dragging');
  };

  #dragMove = (/** @type {PointerEvent} */ e) => {
    const d = this.#drag;
    if (!d) return;
    d.dx = e.clientX - d.x; d.dy = e.clientY - d.y;
    // The speed of the throw (px / ms), smoothed.
    const now = performance.now();
    if (now > d.lt) { d.vx = 0.7 * d.vx + 0.3 * (e.clientX - d.lx) / (now - d.lt); d.lx = e.clientX; d.lt = now; }
    d.el.style.transform = `translate(${d.dx}px, ${d.dy}px) rotate(${d.dx / 18}deg)`;
    const reach = (d.el.offsetWidth || 300) * 0.3;
    d.el.style.setProperty('--like', String(Math.max(0, Math.min(1, d.dx / reach))));
    d.el.style.setProperty('--nope', String(Math.max(0, Math.min(1, -d.dx / reach))));
    // The card underneath rises with the drag, full size at the distance that decides.
    this.#rise(Math.min(1, Math.abs(d.dx) / reach), true);
  };

  #dragEnd = () => {
    const d = this.#drag;
    this.#drag = null;
    if (!d) return;
    d.el.classList.remove('dragging');
    this.#under()?.classList.remove('following');
    const card = this.cards.find(c => c.plant.id === d.id);
    // Far enough (30 % of the card's width), or thrown (fast enough, the same way).
    const w = d.el.offsetWidth || 300, h = d.el.offsetHeight || 400;
    // The speed is that of the last moves: a card held still before it is let go was not thrown, however fast it was
    // dragged there (the speed is only measured as the pointer moves: without this, a quick drag, a pause, then a
    // release threw the card — a match by mistake).
    const vx = performance.now() - d.lt > REST_MS ? 0 : d.vx;
    const thrown = Math.abs(d.dx) > 40 && Math.abs(vx) > 0.6 && Math.sign(vx) === Math.sign(d.dx);
    if (card && (Math.abs(d.dx) > w * 0.3 || thrown)) { this.decide(card, d.dx > 0, d.el); return; }
    if (card && d.dy < -h * 0.18 && Math.abs(d.dx) < w * 0.25) { this.#reset(d.el); this.#open(card); return; }
    // A touch without moving: its sheet.
    if (card && Math.hypot(d.dx, d.dy) < 6) { this.#reset(d.el); this.#open(card); return; }
    this.#reset(d.el);
  };

  /** @param {HTMLElement} el The card on top back in place — and the one underneath back down. */
  #reset(el) { el.style.transform = ''; el.style.removeProperty('--like'); el.style.removeProperty('--nope'); this.#rise(0); }

  /** @returns {HTMLElement | null} the card underneath */
  #under() { return /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.swipe-card.under')); }

  /** The card underneath risen by `p` (0: under, 1: full size); `follow`: at once, under the finger. @param {number} p @param {boolean} [follow] */
  #rise(p, follow = false) {
    const u = this.#under();
    if (!u) return;
    u.classList.toggle('following', follow);
    u.classList.toggle('rising', !follow && p === 1);
    u.classList.toggle('rising', !follow && p === 1);
    if (p) u.style.setProperty('--rise', String(p)); else u.style.removeProperty('--rise');
  }

  render() {
    const s = this.session, c = this.c;
    if (!s || !c) return nothing;
    const deck = this.cards;
    if (!deck.length) {
      const next = nextDistance(c.radius);
      const matches = s.matchCards.length;
      // Cueillette prudente: the toxic look-alikes recognised, counted apart — never with the matches. (A layout's
      // deck, layout/cells.js, has none.)
      const avoided = s.avoidCards?.length ?? 0;
      return html`<div class="deck-end">
        <p class="big">${icon('flower3')}</p>
        <p><b>Vous avez rencontré toutes les plantes du coin !</b></p>
        <p class="muted">${matches ? `${matches} match${matches > 1 ? 's' : ''} dans votre herbier — à retrouver dans « Matchs ».` : 'Aucun coup de cœur ? Le prochain se cache peut-être un peu plus loin, derrière la haie.'}</p>
        ${avoided ? html`<p class="avoided">${icon('exclamation-octagon-fill')}${avoided} plante${avoided > 1 ? 's' : ''} reconnue${avoided > 1 ? 's' : ''} à ne pas cueillir.</p>` : nothing}
        <div class="row">${next ? html`<button class="primary" type="button" @click=${() => s.widen(next)}>Chercher jusqu’à ${distLabel(next)}</button>` : nothing}
          ${c.passed.length || c.avoided?.length ? html`<button class="secondary" type="button" @click=${() => s.resetPassed()}>Revoir les plantes passées</button>` : nothing}</div>
      </div>`;
    }
    const [top, under] = deck;
    const name = nameOf(top.plant);
    const left = s.deck.length;
    // Cueillette prudente: a toxic look-alike on top (or the confusions unreadable) — its right is « recognised, to
    // avoid », never a match (kit/session.js#avoids; a layout's deck, layout/cells.js, has none). One button for both,
    // so the focus stays on it from a card to the next.
    const avoid = s.avoids?.(top) ?? false;
    // The deck takes the focus (a Tab), and ← → ↑ then act on its top card — only there (#onKey): on a tab, a
    // button or the map, the arrows keep their own meaning.
    return html`<div class="deck-wrap">
      <div class="deck" tabindex="0" role="group" aria-label=${`Carte : ${name}. Flèche droite : ${avoid ? 'je la reconnais, à ne pas cueillir' : 'match'}, flèche gauche : passer${this.guided ? '' : ', flèche haut : sa fiche'}`}>
        ${repeat(under ? [under, top] : [top], x => x.plant.id, x => this.#card(x, x === top))}
        ${s.burst ? html`<span class="burst" aria-hidden="true">${icon('heart-fill')}</span>` : nothing}
      </div>
      <div class="actions" role="group" aria-label="Votre réponse">
        <button class="round undo" type="button" aria-label="Revenir à la carte précédente" title="Revenir à la carte précédente" ?disabled=${!s.history.length}
          @click=${() => this.dispatchEvent(new CustomEvent('deck-undo', { bubbles: true, composed: true }))}>${icon('arrow-counterclockwise')}</button>
        <button class="round pass" type="button" aria-label=${'Passer : ' + name} title="Passer (←)" @click=${() => this.decide(top, false)}>${icon('x-lg')}</button>
        ${this.photos ? html`<button class="round info photos" type="button" aria-label=${'Ses photos : ' + name} title="Ses photos"
          @click=${() => this.dispatchEvent(new CustomEvent('deck-photos', { detail: { id: top.plant.id }, bubbles: true, composed: true }))}>${icon('images')}</button>` : nothing}
        ${this.guided ? nothing : html`<button class="round info" type="button" aria-label=${'Voir sa fiche : ' + name} title="Sa fiche (↑)" @click=${() => this.#open(top)}>${icon('three-dots')}</button>`}
        <button class="round like ${avoid ? 'avoid' : ''}" type="button" aria-label=${avoid ? `Je reconnais ${name} : à ne pas cueillir` : `J’aime ${name} : c’est un match`}
          title=${avoid ? 'Je la reconnais : à ne pas cueillir (→)' : 'Match (→)'} @click=${() => this.decide(top, true)}>${icon(avoid ? 'exclamation-octagon-fill' : 'heart-fill')}</button>
      </div>
      <p class="left">${left} plante${left > 1 ? 's' : ''} à rencontrer</p>
    </div>`;
  }

  /** @param {Card} c @param {boolean} top */
  #card(c, top) {
    const s = /** @type {import('./session.js').AroundSession} */ (this.session);
    const p = c.plant, name = nameOf(p);
    // A plant already loved, brought back on top: its heart says so; a swipe either way only puts it back.
    const loved = /** @type {number[]} */ (this.c?.matches ?? []).includes(p.id);
    const photo = this.#photo(c.photo);
    const ethno = s.ethnoOf(c);
    // Cueillette prudente's toxic look-alike: swiped right, recognised — its stamp and its tag say so.
    const avoid = s.avoids?.(c) ?? false;
    // The card underneath is out of reach (inert) and unread: a screen reader meets the card on top only.
    return html`<article class="swipe-card ${top ? 'top' : 'under'} ${loved ? 'loved' : ''}" aria-label=${loved ? name + ' — déjà aimée' : name} data-id=${p.id}
        ?inert=${!top} aria-hidden=${top ? 'false' : 'true'}
        @pointerdown=${top ? this.#dragStart : null} @pointermove=${top ? this.#dragMove : null} @pointerup=${top ? this.#dragEnd : null} @pointercancel=${top ? this.#dragEnd : null}>
      <div class="nophoto">${icon('leaf')}</div>
      ${photo ? html`<img src=${photo} alt="" loading="eager" decoding="async" referrerpolicy="no-referrer" draggable="false" @error=${hideImg} @load=${showImg} />` : nothing}
      <span class="stamp like ${avoid ? 'avoid' : ''}" aria-hidden="true">${avoid ? 'À ÉVITER' : 'MATCH'}</span><span class="stamp nope" aria-hidden="true">BOF</span>
      ${loved ? html`<span class="loved-badge">${icon('heart-fill')} Déjà aimée</span>` : nothing}
      ${photo && c.credit ? html`<p class="credit">Photo : ${creditText(c.credit)}</p>` : nothing}
      <div class="about">
        ${avoid ? html`<p class="avoid-tag">${icon('exclamation-octagon-fill')} À ne pas cueillir</p>` : nothing}
        <h2>${name}<small>${p.scientificName}</small></h2>
        ${ethno ? html`<p class="ethno"><b>On dit de moi</b> <small class="wsrc">(Wikipédia, CC BY-SA)</small> : ${ethno}</p>` : nothing}
        <ul class="bio">${bio(c, floweringMonths(p.flowering)).slice(0, ethno ? 3 : 4).map(line => html`<li>${line}</li>`)}</ul>
      </div>
    </article>`;
  }
}

customElements.define('ma-deck', MaDeck);
