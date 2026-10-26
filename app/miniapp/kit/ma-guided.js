// @ts-check
// Rencontres while discovering (the first steps of the app): from simple to complex, one layout transformed at each
// step. The map alone, its distance (kit/ma-around-map.js); the map and the cards (kit/ma-deck.js), the plant of the
// screen lit on the map — the plant chosen (kit/session.js#chosenId, the address's ?p=): the card on top until the
// first heart, then the plant of each heart (a pass changes nothing), or the one touched on the map or in the list
// around; the panes show it, never another —; on the first match its photos beside them (zoomed); then each step
// adds its pane — its encyclopedia, a fork (picking: its uses, look-alikes and season; or science: maps, distribution,
// climate, classification), the plants around under the map —, the last one leaves for the whole app on that plant,
// as it is. The panes are the plant's sheet (gf-plant-detail panes-only) in a tree of panes of the game's own (the
// context's `panes`: a grip dragged, a tab, a fold, a block moved in Mode King stay in it, « Recommencer » forgets them) —
// never the layout of the mode, which Flore keeps as the user made it; each step docks its own blocks there once, as it
// is accepted (a module off: as it is switched back on, `leftOut`); the image of its « Médias » is the address's &m=.
// Its end changes nothing by itself: at the last step, the way chosen at the fork is offered for the whole app, by a
// button that says so (« Passer en mode Scientifique », « Allumer le mode cueillette »), or « Garder tel quel » — the
// offer in focus as the step arrives.
// The steps: a bar above the blocks, always in sight (its own: the box's is left out, manifest `ownBar`) — done, the
// one shown, to come; « Précédent » and the next one. Its first two are the app's steps « map » and « cards » (the
// address); the others are the first steps' (core/discover.js: step, branch). The widths of the map and the cards are
// the user's (separators on a wide screen, geoflora.discoverLayout).

import { LitElement, html, css, nothing } from 'lit';
import { icon } from '../../core/icons.js';
import { chooseBranch, discoverEvents, discoverState, firstMatchShown, LAST_STEP, setStep, stepBack } from '../../core/discover.js';
import { blockOf, modulesOffFor, serviceOff, undockAlone } from '../../core/sheet-blocks.js';
import { dock, normalize, patchStack, SHEET, stackOf, undock } from '../../core/pane-tree.js';
import { MODULES, moduleEvents } from '../../core/modules.js';
import { PaneSizer } from '../../core/panes.js';
import { href } from '../../core/router.js';
import { openView } from '../../core/history.js';
import { setHarvestMode, setMode, StoreController } from '../../core/store.js';
import { config } from '../../config.js';
import { ui } from '../../styles/ui.js';
import { nameOf } from './cards.js';
import { sessionOf } from './session.js';
import './ma-around-map.js';
import './ma-deck.js';
import '../../components/gf-plant-detail.js';

/**
 * @typedef {import('./cards.js').Card} Card
 * @typedef {import('../../core/pane-tree.js').PaneNode} PaneNode
 * @typedef {import('../../core/pane-tree.js').Side} Side
 */

/** The steps of the discovery, as the bar shows them. */
const STAGES = ['Carte', 'Rencontres', 'Photos', 'Encyclopédie', 'Cueillette ou science', 'Voisines'];
/** What each step brings, said on its button in the bar. */
const STAGE_ABOUT = ['La carte : jusqu’où chercher', 'Les cartes des plantes d’ici, à côté de la carte', 'Les photos de la plante en vue',
  'Ce qu’en dit l’encyclopédie', 'La cueillette ou la science : à vous de choisir', 'Les plantes voisines, sous la carte'];
/** The fork's pane: the blocks of the sheet that join the panes, picking or science (the first one shown). */
const FORK_BLOCKS = { harvest: ['uses', 'lookalikes', 'calendar'], science: ['map', 'occurrences', 'climate', 'taxonomy'] };

/**
 * A block into the panes (once): a new pane beside another block's pane (or, if that one is in no pane, on the right
 * of the sheet; `root`: across the whole plant pane). A module switched off stays off: its block is not added (the
 * panes say why, #offNote). Too many panes nested: the tree as it was (pane-tree.js dock).
 * @param {PaneNode} t @param {string} key @param {string | null} near @param {Side} side @param {boolean} [root] @returns {PaneNode}
 */
function dockOnce(t, key, near, side, root = false) {
  if (serviceOff(key) || stackOf(t, key)) return t;
  const p = near ? stackOf(t, near) : null;
  return dock(t, key, root ? 'root' : p ? p.id : 'sheet', root || p ? side : 'right');
}

/**
 * Several blocks as the tabs of one pane — those of `only` in no pane yet: with those already in one (its tab shown
 * stays shown), else in a new pane across the plant pane (the first one shown).
 * @param {PaneNode} t @param {string[]} keys @param {Side} side @param {string[]} [only] @returns {PaneNode}
 */
function dockTabs(t, keys, side, only = keys) {
  // The blocks whose module is on: the first one to come opens the pane; the others join it as tabs.
  const shown = keys.filter(k => !serviceOff(k));
  const add = shown.filter(k => only.includes(k) && !stackOf(t, k));
  if (!add.length) return t;
  const had = shown.map(k => stackOf(t, k)).find(Boolean);
  let next = had ? t : dockOnce(t, add[0], null, side, true);
  const pane = had ?? stackOf(next, add[0]);
  if (!pane) return next;
  for (const k of add) if (!stackOf(next, k)) next = dock(next, k, pane.id, 'center');
  const after = stackOf(next, add[0]);
  return after ? patchStack(next, after.id, { active: had?.active ?? add[0] }) : next;
}

/**
 * The blocks `only` of the steps reached docked into the panes (each once): the photos on the right of the sheet, the
 * encyclopedia under them, the fork's blocks in a pane of their own. A block already in a pane stays where it is; the
 * others (one the user moved back into the sheet among them) are left alone.
 * @param {PaneNode} t @param {number} step @param {'harvest' | 'science' | null} branch @param {string[]} only @returns {PaneNode}
 */
function withSteps(t, step, branch, only) {
  let next = t;
  if (step >= 1 && only.includes('media')) next = dockOnce(next, 'media', null, 'right');
  if (step >= 2 && only.includes('wikipedia')) next = dockOnce(next, 'wikipedia', 'media', 'bottom');
  if (step >= 3 && branch) next = dockTabs(next, FORK_BLOCKS[branch], 'right', only);
  return next;
}

/**
 * What a step docks as it is accepted: the photos (1), the encyclopedia (2), the fork's tabs (3, the way chosen); the
 * others, nothing. @param {number} step @param {'harvest' | 'science' | null} branch @returns {string[]}
 */
const stepBlocks = (step, branch) => step === 1 ? ['media'] : step === 2 ? ['wikipedia'] : step === 3 && branch ? FORK_BLOCKS[branch] : [];

/**
 * What the steps reached dock, pane by pane: the photos, the encyclopedia, the fork's tabs.
 * @param {number} step @param {'harvest' | 'science' | null} branch @returns {string[][]}
 */
const stepPanes = (step, branch) => [1, 2, 3].filter(s => s <= step).map(s => stepBlocks(s, branch)).filter(keys => keys.length);

/** The game's trees of panes, made sound once each (the stored one: its blocks known, its nodes well formed). @type {WeakMap<object, PaneNode>} */
const trees = new WeakMap();

/**
 * The end of the guided way: the way chosen at the fork, offered for the whole app — what it does, its button (it does
 * that only), and what is said once pressed. The offer is left out when it already applies.
 */
const END = {
  science: { text: 'Vous avez choisi la science : le mode Scientifique montre toutes les données des fiches, dans toute l’application.',
    label: 'Passer en mode Scientifique', done: 'Mode Scientifique activé pour toute l’application.' },
  harvest: { text: 'Vous avez choisi la cueillette : le mode cueillette ajoute à vos lieux le journal de récolte, la qualité et les plantes de saison.',
    label: 'Allumer le mode cueillette', done: 'Mode cueillette allumé pour toute l’application.' }
};

export class MaGuided extends LitElement {
  static properties = {
    app: { attribute: false },
    /** The app's context (the place, the distance, the swipes, the plant chosen). */
    c: { attribute: false },
    /** What a swipe did, said to a screen reader (a match, a plant passed, the next card); what the end's offer did. */
    _said: { state: true },
    /** The end's offer: put away (« Garder tel quel »), or taken (what it did, said in its place). */
    _endKept: { state: true },
    _endDone: { state: true }
  };

  static styles = [ui, css`
    :host { display: block; position: relative; min-height: 0; overflow-y: auto; background: var(--gf-bg, var(--gf-surface-2)); container-type: inline-size; }
    /* Discovering: blocks side by side — the map, the cards, then the panes the steps add. */
    .guided { position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--gf-bg, var(--gf-surface-2)); }
    .g-scroll { position: relative; flex: 1; min-height: 0; display: flex; }
    /* The steps: a bar above the blocks, always in sight — done, the one shown, to come; back and next. */
    .g-steps { flex: none; display: flex; align-items: center; gap: 10px; padding: 6px 10px; background: var(--gf-surface); border-bottom: 1px solid var(--gf-border); z-index: 2; }
    .g-steps .mid { flex: 1; min-width: 0; display: grid; gap: 2px; }
    .g-steps ol { list-style: none; margin: 0; padding: 0; display: flex; align-items: center; gap: 4px; overflow-x: auto; scrollbar-width: none; }
    .g-steps ol::-webkit-scrollbar { display: none; }
    .g-steps li { flex: none; display: inline-flex; align-items: center; gap: 5px; font-size: 0.8rem; color: var(--gf-text-muted); white-space: nowrap; }
    .g-steps li + li::before { content: ''; width: 14px; height: 1px; background: var(--gf-border); margin-right: 2px; }
    .g-steps .n { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 0.7rem; font-weight: 700; border: 1px solid var(--gf-border); background: var(--gf-surface); }
    .g-steps li.done .n { background: var(--gf-accent-soft); border-color: var(--gf-accent); color: var(--gf-accent); }
    .g-steps li.on { color: var(--gf-text); font-weight: 700; }
    .g-steps li button { display: inline-flex; align-items: center; gap: 5px; border: 0; background: none; padding: 2px 4px; margin: -2px -4px; border-radius: var(--gf-radius-pill);
      font: inherit; color: inherit; cursor: pointer; min-height: 0; }
    .g-steps li button:not(:disabled):hover { background: var(--gf-accent-soft); color: var(--gf-text); }
    .g-steps li button:disabled { cursor: default; opacity: 1; }
    .g-steps li:not(.done):not(.on) button:disabled { opacity: 0.6; }
    .g-steps li.on .n { background: var(--gf-accent); border-color: var(--gf-accent); color: var(--gf-accent-contrast, #fff); }
    .g-steps .hint { margin: 0; font-size: 0.78rem; color: var(--gf-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .g-steps .prev { flex: none; display: inline-flex; align-items: center; gap: 2px; min-height: 34px; padding: 0 10px 0 6px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-pill);
      background: var(--gf-surface); color: var(--gf-text); font: inherit; font-size: 0.85rem; cursor: pointer; }
    .g-steps .prev:disabled { opacity: 0.35; cursor: default; }
    .g-steps .next { flex: none; display: flex; gap: 6px; }
    .g-steps .next button { min-height: 34px; padding: 0 14px; display: inline-flex; align-items: center; gap: 4px; font-size: 0.88rem; white-space: nowrap; }
    /* The end: the way chosen, offered for the whole app (under the steps, never over the blocks). */
    .g-end { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 8px 10px; background: var(--gf-accent-soft); border-bottom: 1px solid var(--gf-border); }
    .g-end p { flex: 1 1 260px; min-width: 0; margin: 0; font-size: 0.86rem; color: var(--gf-text); }
    .g-end .acts { display: flex; flex-wrap: wrap; gap: 8px; }
    .g-end button { min-height: 40px; padding: 0 14px; font-size: 0.88rem; }
    .g-end p .bi { color: var(--gf-accent); }
    .g-end:focus { outline: none; }
    .g-end:focus-visible { outline: 2px solid var(--gf-accent); outline-offset: -2px; }
    @media (max-width: 899px) {
      .g-steps { flex-wrap: wrap; gap: 6px 8px; padding: 6px 8px; }
      .g-steps .mid { order: -1; flex-basis: 100%; }
      .g-steps li:not(.on) .l { display: none; }
      .g-steps .prev span { display: none; }
      .g-steps .prev { padding: 0 8px; }
      .g-steps .next { flex: 1; justify-content: flex-end; }
    }
    /* The map alone first (its distance): the cards' column slides in next. */
    .g-deck, .g-map { transition: flex-basis 0.4s ease, padding 0.4s ease; }
    .guided.asking .g-deck { flex: 0 0 0 !important; padding: 0 !important; overflow: hidden; border: 0 !important; }
    .guided.asking .g-map { flex: 1 1 auto; border-right: 0; }
    .g-map { position: relative; flex: 1 1 0; min-width: 260px; min-height: 0; display: flex; flex-direction: column; border-right: 1px solid var(--gf-border); background: var(--gf-surface); }
    .guided.with-panes .g-map { flex: 0 1 var(--w-map, min(30%, 380px)); }
    /* A width remembered on a wider window: the map and the cards give way, the plant's panes keep 320 px. */
    .guided.with-panes .g-plant { min-width: 320px; }
    .g-deck { flex: 0 0 min(400px, 42%); min-width: 0; overflow-y: auto; padding: 14px 12px 90px; }
    .guided:not(.with-panes) .g-deck { flex: 0 1 var(--w-cards, 50%); }
    .guided.with-panes .g-deck { flex: 0 1 var(--w-deck, min(360px, 32%)); border-right: 1px solid var(--gf-border); }
    /* The separators (wide screens): the map's and the cards' widths, remembered (PaneSizer). */
    .g-off { margin: 8px; padding: 8px 10px; border-radius: var(--gf-radius); background: var(--gf-surface); border: 1px solid var(--gf-border); font-size: 0.8125rem; color: var(--gf-text-muted); }
    .g-off a { color: var(--gf-accent); }
    .g-scroll > .split { flex: none; width: 9px; margin: 0 -4px; z-index: 3; cursor: col-resize; position: relative; touch-action: none; }
    .g-scroll > .split::after { content: ''; position: absolute; inset: 0 4px; background: transparent; transition: background 0.12s; }
    .g-scroll > .split:hover::after, .g-scroll > .split:focus-visible::after, .g-scroll > .split.dragging::after { background: var(--gf-accent); inset: 0 3px; }
    .g-scroll > .split:focus-visible { outline: none; }
    .g-scroll > .guide { position: absolute; top: 0; bottom: 0; left: -1px; width: 3px; background: var(--gf-accent); z-index: 5; pointer-events: none; }
    .g-scroll > .guide span { position: absolute; top: 50%; left: 8px; padding: 2px 8px; border-radius: var(--gf-radius-pill); background: var(--gf-accent); color: var(--gf-accent-contrast); font-size: 0.75rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
    @media (pointer: coarse) {
      .g-scroll > .split { width: 44px; margin: 0 -22px; }
      .g-scroll > .split::after { inset: 0 21.5px; }
      .g-scroll > .split:hover::after, .g-scroll > .split:focus-visible::after, .g-scroll > .split.dragging::after { inset: 0 20.5px; }
      .g-scroll > .split::before { content: ''; position: absolute; top: 50%; left: 50%; width: 10px; height: 44px; translate: -50% -50%; border-radius: 5px;
        background: var(--gf-surface); border: 1px solid var(--gf-border); box-shadow: 0 1px 4px rgb(0 0 0 / 18%); z-index: 1; }
    }
    :host(.resizing) { cursor: col-resize; user-select: none; }
    @media (max-width: 899px) { .g-scroll > .split { display: none; } }
    .g-wait { text-align: center; padding: 40px 10px; }
    .g-plant { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--gf-surface); isolation: isolate; animation: g-in 0.35s ease-out; }
    @keyframes g-in { from { opacity: 0; transform: translateX(24px); } }
    .g-plant gf-plant-detail { flex: 1; min-height: 0; }
    .g-empty { height: 100%; display: grid; place-content: center; justify-items: center; gap: 8px; padding: 24px; text-align: center; color: var(--gf-text-muted); font-size: 0.95rem; }
    .g-empty .bi { font-size: 2.4rem; opacity: 0.5; }
    .g-empty p { margin: 0; max-width: 300px; }
    @media (max-width: 899px) {
      /* A phone: the blocks one under the other, scrolled. */
      .g-scroll { flex-direction: column; overflow-y: auto; }
      .g-map, .guided.with-panes .g-map { flex: none; min-width: 0; border-right: 0; border-bottom: 1px solid var(--gf-border); }
      .g-deck, .guided:not(.with-panes) .g-deck, .guided.with-panes .g-deck { flex: none; border-right: 0; border-bottom: 1px solid var(--gf-border); padding: 8px 10px 12px; overflow: visible; }
      .g-plant, .guided.with-panes .g-plant { flex: none; height: 85dvh; min-width: 0; }
      .guided.asking .g-scroll { overflow: hidden; }
    }
    @media (prefers-reduced-motion: reduce) { .g-deck, .g-map { transition: none; animation: none; } }
  `];

  #store = new StoreController(this);

  constructor() {
    super();
    /** @type {import('../runtime.js').MiniApp | null} */
    this.app = null;
    /** @type {Record<string, any> | null} */
    this.c = null;
    this._said = '';
    this._endKept = false;
    /** @type {string | null} */
    this._endDone = null;
  }

  #onChange = () => this.requestUpdate();
  /** @type {import('./session.js').AroundSession | null} */ #session = null;

  /** The widths of the map and the cards (wide screens); the plant's panes take the rest. */
  #sizer = new PaneSizer(this, config.storageKeys.discoverLayout, {
    map: { width: 380, min: 260, title: 'Carte' },
    deck: { width: 360, min: 300, title: 'Cartes' },
    // The first step: the map and the cards only, the cards' column wider.
    cards: { width: 520, min: 300, title: 'Cartes' }
  }, { onChange: () => /** @type {any} */ (this.renderRoot.querySelector('ma-around-map'))?.holdFrame?.() });

  connectedCallback() {
    super.connectedCallback();
    discoverEvents.addEventListener('change', this.#onChange);
    // A module switched on or off (Réglages, another tab): photos and panes follow it.
    moduleEvents.addEventListener('change', this.#onChange);
    this.setAttribute('no-areas', '');
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    discoverEvents.removeEventListener('change', this.#onChange);
    moduleEvents.removeEventListener('change', this.#onChange);
    this.#session?.removeEventListener('change', this.#onChange);
    this.#session = null;
  }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (!this.app) return;
    const s = sessionOf(this.app);
    if (s !== this.#session) {
      this.#session?.removeEventListener('change', this.#onChange);
      this.#session = s;
      s.addEventListener('change', this.#onChange);
    }
    // The cards: there from the step « cards » on (a reload there, « Continuer »).
    if (!this.#asking) s.ensure(false);
    // The end's offer: made again each time the last step is reached.
    if (this.#stage !== STAGES.length - 1) { this._endKept = false; this._endDone = null; }
  }

  updated() {
    if (!this.app) return;
    const { step, branch } = discoverState();
    // A game kept from before its panes were its own (kit/session.js#keptFromBefore): the panes its steps had docked
    // then into the layout of the mode taken back, once — as they left them (core/sheet-blocks.js#undockAlone) —, and
    // docked into the game's own, as its steps do.
    if (this.#s.keptFromBefore) {
      this.#s.keptFromBefore = false;
      undockAlone(this.#view, stepPanes(step, branch));
      this.#dockSteps(this.#tree, this.#stepKeys, step, branch);
      return;
    }
    // A module switched back on (Réglages, another tab): the blocks its steps had left out docked now. Nothing else is
    // docked on an update: a block the user moved (Mode King: « Déplacer vers… », a drag) stays where it was put.
    const back = /** @type {string[]} */ (this.app.c.leftOut ?? []).filter(k => this.#stepKeys.includes(k) && !serviceOff(k));
    if (back.length) this.#dockSteps(this.#tree, back, step, branch);
  }

  get #s() { return /** @type {import('./session.js').AroundSession} */ (this.#session); }

  /** The step « map »: the map alone, its distance. */
  get #asking() { return this.app?.step.id === 'map'; }

  /** The mode the plant's panes are drawn in (their blocks' styles; their tree is the game's own: #tree). */
  get #view() { return this.#store.state.mode; }

  /** The panes the steps built, the game's (the context's `panes`), made sound; none yet: the sheet alone. @returns {PaneNode} */
  get #tree() {
    const raw = this.app?.c.panes;
    if (!raw || typeof raw !== 'object') return SHEET;
    let t = trees.get(raw);
    if (!t) { t = normalize(raw, k => Boolean(blockOf(k))); trees.set(raw, t); }
    return t;
  }

  /** The game's panes, kept with it (never the layout of the mode). @param {PaneNode} t */
  #setPanes(t) {
    if (t === this.#tree) return;
    trees.set(t, t);
    this.app?.set({ panes: t.t === 'sheet' ? null : t });
  }

  /**
   * Blocks of the steps reached docked into the game's panes `t` — `keys`: their step accepted, their module switched
   * back on, a game kept from before —, each once; never on a mere update (#updated), so that a block the user moved
   * stays where it was put. Those whose module is off wait for it, kept with the game (the context's `leftOut`).
   * @param {PaneNode} t @param {string[]} keys @param {number} step @param {'harvest' | 'science' | null} branch
   */
  #dockSteps(t, keys, step, branch) {
    const was = /** @type {string[]} */ (this.app?.c.leftOut ?? []);
    const left = [...was.filter(k => !keys.includes(k)), ...keys.filter(serviceOff)];
    if (left.join() !== was.join()) this.app?.set({ leftOut: left.length ? left : null });
    this.#setPanes(withSteps(t, step, branch, keys));
  }

  /** The plant of the screen: the plant chosen, else (before any heart) the card on top — the map lights it, the panes show it. */
  get #focusId() { return this.#s.chosenId; }

  /**
   * A plant touched (on the map, or in the list around): chosen — the map and the panes follow it, and the address.
   * One not loved yet comes on top of the deck too (one passed: back in it), to be swiped.
   * @param {number} id
   */
  #aroundGo(id) {
    const card = (this.#s.cards || []).find(c => c.plant.id === id);
    if (!card) return;
    if (!this.c?.matches.includes(id)) {
      if (this.c?.passed.includes(id)) this.#s.unswipe(id);
      this.#s.toTop(card);
    }
    this.#s.choose(id);
  }

  /**
   * A card swiped (flown off the deck): a heart chooses its plant (kit/session.js#swiped) — the map lights it, the
   * panes show it, until the next heart; a pass changes nothing (before any heart, the card now on top is the plant of
   * the screen). The first match brings its photos at once (the third block, zoomed); the next ones, a heart.
   * @param {CustomEvent} e
   */
  #onDecide = e => {
    const { card, liked } = /** @type {{ card: Card, liked: boolean }} */ (e.detail);
    const s = this.#s;
    const fav = s.swiped(card, liked);
    // Said aloud (the status under the view): what the swipe did, then the card now on top.
    const next = s.deck[0];
    this._said = `${liked ? `Match : ${nameOf(card.plant)}${fav ? ', ajoutée aux favoris' : ''}` : `Passée : ${nameOf(card.plant)}`}. ${next ? `Carte suivante : ${nameOf(next.plant)}.` : 'Plus aucune carte.'}`;
    if (!liked) return;
    if (!discoverState().firstMatch) {
      firstMatchShown();
      // Its photos are the game's now: once the first steps are over, the list keeps them beside the deck
      // (kit/ma-around-list.js, the context's `media`) — not brought a second time.
      this.app?.set({ media: { by: card.plant.id, closed: false } });
      if (discoverState().step === 0) this.#accept(1);
    }
    else s.heart();
  };

  /** ↺: the last card back on top — its heart undone, the plant chosen before it (kit/session.js#rewind). */
  #onUndo = () => { this.#s.rewind(); };

  /**
   * The fork: picking or science; its dashboard joins the plant (the other way's, chosen before « Précédent », leaves).
   * @param {'harvest' | 'science'} branch
   */
  #fork(branch) {
    let t = this.#tree;
    for (const k of FORK_BLOCKS[branch === 'harvest' ? 'science' : 'harvest']) if (stackOf(t, k)) t = undock(t, k);
    this.#dockSteps(t, stepBlocks(3, branch), 3, branch);
    chooseBranch(branch);
    this.requestUpdate();
    this.#showNewBlock();
  }

  /**
   * A step accepted: its pane joins the game's panes — the photos beside the sheet, the encyclopedia under them (its
   * own blocks only: those of the steps before stay where the user left them). The last one ends the first steps and
   * opens Flore on this plant, as it is (the mode, the harvest mode: only the end's own buttons change them,
   * #endOffer); this game then goes on as the others. @param {number} step
   */
  #accept(step) {
    const id = this.#focusId;
    const { branch } = discoverState();
    if (step < LAST_STEP) this.#dockSteps(this.#tree, stepBlocks(step, branch), step, branch);
    else this.app?.set({ guided: false });
    setStep(step);
    if (step >= LAST_STEP && id != null) openView(href.plant(id));
    this.requestUpdate();
    this.#showNewBlock();
    if (step === LAST_STEP - 1) this.#offerFocus();
  }

  /**
   * The last step reached: its offer, when there is one, takes the focus — read out by its name, the way chosen — so
   * that the next Enter never leaves for Flore without it (« La flore complète », where the focus was, comes before
   * it).
   */
  async #offerFocus() {
    await this.updateComplete;
    /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.g-end[role="group"]'))?.focus();
  }

  /**
   * The end (the last step, a way chosen at the fork): that way offered for the whole app — its button does only what
   * it says (the mode, or the harvest mode, for the whole app), « Garder tel quel » puts the offer away; nothing changes
   * without one of them. Left out when it already applies.
   */
  #endOffer() {
    const { branch } = discoverState();
    if (this.#stage !== STAGES.length - 1 || !branch || this._endKept) return nothing;
    const end = END[branch];
    if (this._endDone) return html`<div class="g-end"><p>${icon('check-lg')} ${this._endDone}</p></div>`;
    const state = this.#store.state;
    if (branch === 'science' ? state.mode === 'scientific' : state.harvestMode) return nothing;
    return html`<div class="g-end" role="group" aria-labelledby="g-end-text" tabindex="-1">
      <p id="g-end-text">${end.text}</p>
      <div class="acts">
        <button type="button" class="primary" data-end="apply" @click=${() => this.#endApply(branch)}>${icon(branch === 'science' ? 'diagram-3' : 'basket')} ${end.label}</button>
        <button type="button" data-end="keep" @click=${() => this.#endKeep()}>Garder tel quel</button>
      </div>
    </div>`;
  }

  /** The way chosen, for the whole app — that only. @param {'harvest' | 'science'} branch */
  #endApply(branch) {
    if (branch === 'science') setMode('scientific');
    else setHarvestMode(true);
    this._endDone = this._said = END[branch].done;
    this.#endFocus();
  }

  /** « Garder tel quel »: the offer put away, nothing changed. */
  #endKeep() {
    this._endKept = true;
    this._said = 'Rien n’a changé.';
    this.#endFocus();
  }

  /** After the end's offer, the focus on what comes next: « La flore complète ». */
  async #endFocus() {
    await this.updateComplete;
    /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('[data-step="flore"]'))?.focus();
  }

  /** A phone: the blocks one under the other — the new one scrolled into view. */
  async #showNewBlock() {
    if (!matchMedia('(max-width: 899px)').matches) return;
    await this.updateComplete;
    requestAnimationFrame(() => this.renderRoot.querySelector('.g-plant')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
  }

  /** The blocks the steps reached have added to the panes (only those are shown while discovering). */
  get #paneKeys() {
    return this.#stepKeys.filter(k => !modulesOffFor(k).length);
  }

  /** The blocks the steps reached would add, modules off or not. */
  get #stepKeys() {
    const { step, branch } = discoverState();
    return stepPanes(step, branch).flat();
  }

  /** Why some steps added nothing: their modules are off (Réglages › Modules), and Découvrir leaves them so. */
  #offNote() {
    const off = [...new Set(this.#stepKeys.flatMap(k => modulesOffFor(k)))];
    if (!off.length) return nothing;
    const names = off.map(m => `« ${MODULES.find(x => x.key === m)?.name || m} »`);
    return html`<p class="g-off" role="note">${icon('eye-slash')} ${names.length > 1 ? `Modules ${names.slice(0, -1).join(', ')} et ${names.at(-1)} désactivés` : `Module ${names[0]} désactivé`} : ${names.length > 1 ? 'leurs panneaux ne sont pas ajoutés' : 'son panneau n’est pas ajouté'}. Vous pouvez ${names.length > 1 ? 'les' : 'le'} réactiver dans <a href=${href.settings()}>Réglages › Modules</a>.</p>`;
  }

  /** Where the discovery is: 0 the map, 1 the cards, 2 the photos, 3 the encyclopedia, 4 the fork, 5 the plants around. */
  get #stage() { return this.#asking ? 0 : Math.min(discoverState().step + 1, STAGES.length - 1); }

  /** The furthest step reached (in the bar's numbering: 0 the map, 1 the cards…). */
  get #reached() { return Math.min(discoverState().step + 1, STAGES.length - 1); }

  /** « Précédent »: one step back (the cards: back to the map and its distance). */
  #prev() {
    const stage = this.#stage;
    if (stage === 0) return;
    if (stage === 1) { this.app?.go('map'); return; }
    stepBack(stage - 2);
    this.requestUpdate();
  }

  /** « Qui pousse par ici ? »: from the map to the map and the cards. */
  #toCards() { this.app?.go('cards'); this.#s.ensure(false); }

  /**
   * The steps, always in sight above the blocks (never over them): each one done, the one shown, those to come;
   * « Précédent » and the next one — what it adds said on its button (at the fork, the two ways).
   */
  #steps() {
    const stage = this.#stage;
    const { branch } = discoverState();
    const focus = this.#focusId != null;
    /** @type {[string, unknown, () => void, boolean?][]} */
    const next = stage === 0 ? [['go', html`${icon('binoculars')} Qui pousse par ici ?`, () => this.#toCards()]]
      : stage === 1 ? [['photos', html`Ses photos ${icon('chevron-right')}`, () => this.#accept(1), !focus]]
      : stage === 2 ? [['wiki', html`L’encyclopédie ${icon('chevron-right')}`, () => this.#accept(2)]]
      : stage === 3 ? [['harvest', html`${icon('basket')} La cueillette`, () => this.#fork('harvest')], ['science', html`${icon('diagram-3')} La science`, () => this.#fork('science')]]
      : stage === 4 ? [['around', html`Les voisines ${icon('chevron-right')}`, () => this.#accept(4)]]
      : [['flore', html`La flore complète ${icon('chevron-right')}`, () => this.#accept(LAST_STEP)]];
    const hint = ['Choisissez jusqu’où chercher, sur la carte.', 'Glissez les cartes : à droite un coup de cœur — ses photos arrivent.',
      'Ses photos, zoomables. Ensuite : ce qu’en dit l’encyclopédie.', 'Et vous, qu’aimeriez-vous savoir des plantes ?',
      branch === 'science' ? 'Cartes et données de la science. Ensuite : les plantes autour.' : 'Ce qui se cueille, et ce qu’il ne faut pas confondre. Ensuite : les plantes autour.',
      'Les voisines, sous la carte. Ensuite : toute la flore.'][stage];
    return html`<nav class="g-steps" aria-label="Étapes des premiers pas">
      <button type="button" class="prev" data-step="prev" ?disabled=${stage === 0} @click=${() => this.#prev()} aria-label="Étape précédente">${icon('chevron-left')}<span>Précédent</span></button>
      <div class="mid">
        <ol>${STAGES.map((label, i) => {
          const can = this.#canGo(i, stage, next);
          return html`<li class=${i < stage ? 'done' : i === stage ? 'on' : ''} aria-current=${i === stage ? 'step' : 'false'}>
            <button type="button" data-stage=${i} ?disabled=${!can} title=${STAGE_ABOUT[i]} @click=${() => this.#goStage(i, stage, next)}>
              <span class="n">${i < stage ? icon('check-lg') : i + 1}</span><span class="l">${i === 4 && branch ? (branch === 'science' ? 'Science' : 'Cueillette') : label}</span></button></li>`;
        })}</ol>
        <p class="hint">${hint}</p>
      </div>
      <div class="next">${next.map(([k, label, act, off]) => html`<button type="button" class="primary" data-step=${k} ?disabled=${Boolean(off)} @click=${act}>${label}</button>`)}</div>
    </nav>`;
  }

  /**
   * A step of the bar touched: one reached goes back (or forth) to it — the layout of that step; the next one is the
   * « Suivant » (one way only: the fork asks its button); further ones wait.
   * @param {number} i @param {number} stage @param {any[]} next
   */
  #canGo(i, stage, next) {
    if (i === stage) return false;
    if (i <= this.#reached) return i === 0 || Boolean(this.#s.cards || this.#s.loading);
    return i === stage + 1 && next.length === 1 && !next[0][3];
  }

  /** @param {number} i @param {number} stage @param {any[]} next */
  #goStage(i, stage, next) {
    if (!this.#canGo(i, stage, next)) return;
    if (i === 0) { this.app?.go('map'); return; }
    if (i <= this.#reached) {
      if (this.#asking) this.#toCards();
      if (i - 1 < discoverState().step) stepBack(i - 1);
      this.requestUpdate();
      return;
    }
    next[0][2]();
  }

  /** The card the map's panel shows: the one on top; while the cards reload (the distance changed), the one it showed. @type {Card | undefined} */
  #panelCard;

  render() {
    const app = this.app, c = this.c, s = this.#session;
    if (!app || !c || !s || !c.point) return nothing;
    const step = discoverState().step;
    const asking = this.#asking;
    const cards = s.cards || [];
    const id = this.#focusId;
    const card = asking ? undefined : cards.find(x => x.plant.id === id);
    // While the cards reload (the distance changed), the panel keeps the plant it showed: nothing jumps.
    if (card) this.#panelCard = card;
    const panelCard = card ?? (s.loading && !asking ? this.#panelCard : undefined);
    const panes = !asking && step >= 1;
    const stage = this.#stage;
    // Rencontres: the map, the place (distance) and the cards — no legend, no « Où pousse-t-elle encore ? ».
    const quiet = stage === 1;
    return html`<section class="guided ${asking ? 'asking' : ''} ${panes ? 'with-panes' : ''} ${step >= 4 && !asking ? 'listed' : ''}" aria-label="Premiers pas"
      style=${this.#widths(asking, panes)}>
      <h1 class="visually-hidden">Premiers pas : étape ${stage + 1} sur ${STAGES.length}, ${STAGES[stage]}</h1>
      ${this.#steps()}
      ${this.#endOffer()}
      <div class="g-scroll">
        <ma-around-map class="g-map" .app=${app} .c=${c} .session=${s} ?asking=${asking} ?quiet=${quiet} ?scopes=${stage >= 2} ?listed=${step >= 4}
          .card=${panelCard} .focusId=${id} @map-launch=${() => this.#toCards()}
          @around-pick=${(/** @type {CustomEvent} */ e) => this.#aroundGo(e.detail.id)}></ma-around-map>
        ${asking ? nothing : panes ? this.#sizer.split('map', 'left', () => this.#paneMax('map')) : this.#sizer.split('cards', 'right', () => this.#paneMax('cards'))}
        <div class="g-deck">${asking ? nothing : s.cards ? html`<ma-deck guided .session=${s} .cards=${s.deck} .c=${c} active
            @deck-decide=${this.#onDecide} @deck-undo=${this.#onUndo}></ma-deck>` : html`<p class="muted g-wait">Recherche des plantes observées autour…</p>`}</div>
        ${panes ? this.#sizer.split('deck', 'left', () => this.#paneMax('deck')) : nothing}
        ${panes ? html`<div class="g-plant" aria-label=${card ? 'Panneaux : ' + nameOf(card.plant) : 'Panneaux'}>
          ${this.#offNote()}
          ${id != null ? html`<gf-plant-detail embedded subheading panes-only plant-id=${id} view=${this.#view} .tree=${this.#tree} .paneKeys=${this.#paneKeys} .mediaAt=${c.mediaAt ?? 0}
            @pane-sizes=${(/** @type {CustomEvent} */ e) => this.#setPanes(e.detail)}
            @media-index=${(/** @type {CustomEvent} */ e) => { e.stopPropagation(); const at = Number(e.detail?.index) || null; if (c.mediaAt !== at) app.set({ mediaAt: at }); }}>
            <div class="g-empty">${icon('binoculars')}<p>Ses photos, son histoire, ses secrets viendront s’installer ici.</p></div>
          </gf-plant-detail>` : nothing}
        </div>` : nothing}
      </div>
    </section>
    <p class="visually-hidden" role="status">${this._said || ''}</p>`;
  }

  /**
   * The widths of the map and the cards, as shown: the ones chosen, made to fit (the plant's panes keep 320 px, the
   * cards 300). `all`: the view's width. @param {number} all
   */
  #fit(all) {
    const z = this.#sizer;
    const map = Math.max(z.panes.map.min, Math.min(z.width('map'), all - 320 - z.panes.deck.min));
    const deck = Math.max(z.panes.deck.min, Math.min(z.width('deck'), all - 320 - map));
    return { map, deck, cards: Math.max(z.panes.cards.min, Math.min(z.width('cards'), all - z.panes.map.min)) };
  }

  /** The widest `pane` may be now. @param {'map' | 'deck' | 'cards'} pane */
  #paneMax(pane) {
    const all = this.renderRoot.querySelector('.g-scroll')?.getBoundingClientRect().width || this.clientWidth;
    const z = this.#sizer.panes;
    return pane === 'map' ? all - 320 - z.deck.min : pane === 'deck' ? all - 320 - this.#fit(all).map : all - z.map.min;
  }

  /** The widths chosen (the separators), as the view's CSS variables; none: the defaults. @param {boolean} asking @param {boolean} panes */
  #widths(asking, panes) {
    const chosen = this.#sizer.state.widths;
    if (asking || this.clientWidth < 900 || !Object.keys(chosen).length) return '';
    const w = this.#fit(this.clientWidth);
    return panes ? (chosen.map || chosen.deck ? `--w-map: ${w.map}px; --w-deck: ${w.deck}px` : '') : chosen.cards ? `--w-cards: ${w.cards}px` : '';
  }
}

customElements.define('ma-guided', MaGuided);
