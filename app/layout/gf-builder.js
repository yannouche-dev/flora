// @ts-check
// « Créer une app » (#/builder[/<grille>][?g=<grille découpée>]): an app builder, easy but powerful, one step at a time.
// Step 1, the grid: three to start from — a single column, three columns, a dashboard (gf-builder-grids.js) —, each
// drawn small on its card; the one chosen drawn large on a desktop (1280 × 800, as wide as the page), its places
// numbered in reading order. Then made one's own (builder-grid.js), the address keeping it (g=, the shares too):
//  - a grip between two boxes of a list (side by side: width; one under the other: height), dragged or ←/→ (↑/↓),
//    moves its share from one to the other — the grid always full width;
//  - the build button of a place opens its cross: the place in the middle, an arm towards each side; an arm cuts the
//    place in two that way (any place, any way: a whole layout from three columns); the middle takes the place out
//    (its room to its neighbour: the grid adapts). Escape or ✕ closes it.
// A grid is a layout of the free layout's grammar (grammar.js) whose cells are empty places (`slot`): what the builder
// makes in the end is a « Disposition libre » (#/layout/…), the blocks chosen at the next step.
import { LitElement, html, css, nothing } from 'lit';
import { href } from '../core/router.js';
import { icon } from '../core/icons.js';
import { openView, replaceView } from '../core/history.js';
import { ui } from '../styles/ui.js';
import { dirAt } from './grammar.js';
import { GRIDS } from './gf-builder-grids.js';
import { boxOf, specOf, split, remove, resize, canSplit, placesOf } from './builder-grid.js';

export { GRIDS };

/** The desktop drawn: its width and height (px, before scaling). */
const DESKTOP = { w: 1280, h: 800 };

/** @typedef {import('./builder-grid.js').Box} Box */
/** @typedef {import('./builder-grid.js').Side} Side */

/** The arms of the cross: their side, their words, their arrow. @type {{ side: Side, label: string, icon: import('../core/icons.js').IconName }[]} */
const ARMS = [
  { side: 'top', label: 'Au-dessus', icon: 'arrow-up' },
  { side: 'left', label: 'À gauche', icon: 'arrow-left' },
  { side: 'right', label: 'À droite', icon: 'arrow-right' },
  { side: 'bottom', label: 'En dessous', icon: 'arrow-down' }
];

/** A path as a key (« 0.1.2 »). @param {number[]} path */
const keyOf = path => path.join('.');

export class GfBuilder extends LitElement {
  static properties = {
    /** The route: { name: 'builder', grid: string | null, spec: string | null }. */
    route: { attribute: false },
    _scale: { state: true },
    /** The place whose cross is open (its path's key), or null. */
    _open: { state: true }
  };

  static styles = [ui, css`
    :host { display: flex; flex-direction: column; min-height: 0; overflow: auto; background: var(--gf-bg); color: var(--gf-text); }
    .wrap { width: 100%; max-width: 1180px; margin: 0 auto; padding: 16px 16px 32px; box-sizing: border-box; display: flex; flex-direction: column; gap: 18px; }
    header h1 { margin: 0; font-size: 1.35rem; display: flex; align-items: center; gap: 8px; }
    header p { margin: 4px 0 0; color: var(--gf-text-muted); }
    ol.steps { list-style: none; display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 10px 0 0; padding: 0; font-size: 0.85rem; color: var(--gf-text-muted); }
    ol.steps li { display: flex; align-items: center; gap: 6px; }
    ol.steps b { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--gf-border); font-size: 0.75rem; }
    ol.steps [aria-current] { color: var(--gf-text); font-weight: 600; }
    ol.steps [aria-current] b { background: var(--gf-accent); border-color: var(--gf-accent); color: var(--gf-accent-contrast); }
    h2 { margin: 0; font-size: 1rem; }
    .choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .choice { all: unset; box-sizing: border-box; cursor: pointer; display: flex; flex-direction: column; gap: 10px; padding: 12px;
      border: 1px solid var(--gf-border); border-radius: var(--gf-radius-lg); background: var(--gf-surface); transition: border-color .15s, box-shadow .15s; }
    .choice:hover { border-color: var(--gf-accent); }
    .choice:focus-visible { outline: 2px solid var(--gf-focus); outline-offset: 2px; }
    .choice[aria-pressed="true"] { border-color: var(--gf-accent); box-shadow: 0 0 0 2px var(--gf-accent); }
    .choice .thumb { aspect-ratio: 16 / 10; border-radius: var(--gf-radius-sm); background: var(--gf-bg); padding: 6px; box-sizing: border-box; display: flex; }
    .choice b { display: flex; align-items: center; gap: 6px; }
    .choice b .ok { margin-left: auto; color: var(--gf-accent); }
    .choice small { color: var(--gf-text-muted); line-height: 1.35; }
    /* A grid chosen: the cards in one compact line (the thumbnail beside the name), the desktop in sight below. */
    .choices.compact .choice { flex-direction: row; align-items: center; padding: 8px 10px; }
    .choices.compact .thumb { width: 84px; flex: none; padding: 4px; }
    .choices.compact .choice b { flex: 1; }
    .choices.compact .choice small { display: none; }
    .choices.compact .g { --gap: 2px; }
    /* A grid drawn: lists as flex boxes turning at each level, places as boxes. */
    .g { display: flex; flex: 1; min-width: 0; min-height: 0; gap: var(--gap, 4px); }
    .g.row { flex-direction: row; }
    .g.col { flex-direction: column; }
    .slot { flex: 1; min-width: 0; min-height: 0; border-radius: 3px; background: color-mix(in srgb, var(--gf-accent) 22%, transparent); }
    .preview { display: flex; flex-direction: column; gap: 10px; }
    .preview .head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
    .preview .head small { color: var(--gf-text-muted); }
    .preview .head .reset { margin-left: auto; min-height: 32px; padding: 4px 12px; font-size: 0.85rem; }
    .room { width: 100%; display: flex; justify-content: center; }
    .room > div { flex: none; }
    .desk { width: ${DESKTOP.w}px; height: ${DESKTOP.h}px; transform-origin: 0 0; user-select: none; -webkit-user-select: none; display: flex; flex-direction: column; border-radius: 12px; overflow: hidden;
      border: 1px solid var(--gf-border); background: var(--gf-surface); box-shadow: var(--gf-shadow-float, 0 8px 30px rgb(0 0 0 / .15)); }
    .chrome { flex: none; height: 36px; display: flex; align-items: center; gap: 8px; padding: 0 14px; background: var(--gf-surface-2, var(--gf-bg)); border-bottom: 1px solid var(--gf-border); }
    .chrome i { width: 12px; height: 12px; border-radius: 50%; background: var(--gf-border); }
    .chrome span { margin-left: 12px; flex: 1; max-width: 520px; height: 22px; border-radius: var(--gf-radius-pill); background: var(--gf-bg); color: var(--gf-text-muted); font-size: 12px; display: flex; align-items: center; padding: 0 12px; }
    .apphead { flex: none; height: 52px; display: flex; align-items: center; gap: 10px; padding: 0 20px; border-bottom: 1px solid var(--gf-border); font-weight: 600; }
    .apphead .dot { width: 26px; height: 26px; border-radius: 8px; background: var(--gf-accent); }
    .screen { flex: 1; display: flex; padding: 16px; min-height: 0; --gap: 12px; }
    .screen .slot { position: relative; container-type: size; display: grid; place-content: center; justify-items: center; gap: 6px; text-align: center; padding: 8px;
      background: color-mix(in srgb, var(--gf-accent) 7%, var(--gf-surface)); border: 2px dashed color-mix(in srgb, var(--gf-accent) 45%, transparent); border-radius: 10px; color: var(--gf-text-muted); font-size: 15px; }
    .screen .slot .n { display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--gf-accent); color: var(--gf-accent-contrast); font-weight: 700; font-size: 16px; }
    .screen .slot strong { color: var(--gf-text); font-size: 16px; }
    .screen .slot .w { font-size: 13px; color: var(--gf-text); font-variant-numeric: tabular-nums; }
    @container (max-height: 150px) { .screen .slot > span:not(.n), .screen .slot .w { display: none; } }
    @container (max-height: 90px) { .screen .slot > strong { display: none; } }
    .screen .slot.new { animation: born .7s ease-out; }
    @keyframes born { from { background: color-mix(in srgb, var(--gf-accent) 40%, var(--gf-surface)); } }
    @media (prefers-reduced-motion: reduce) { .screen .slot.new { animation: none; } }
    /* A grip between two boxes of a list: a thin bar, wider to the hand than to the eye; across a row or a column. */
    .grip { flex: none; position: relative; z-index: 1; touch-action: none; display: flex; justify-content: center; align-items: stretch; border-radius: 6px; }
    .row > .grip { width: 12px; margin: 0 -6px; cursor: col-resize; }
    .col > .grip { height: 12px; margin: -6px 0; cursor: row-resize; flex-direction: column; }
    .grip::before { content: ''; border-radius: 2px; background: var(--gf-border); transition: background .15s; }
    .row > .grip::before { width: 4px; }
    .col > .grip::before { height: 4px; }
    .grip:hover::before, .grip.on::before, .grip:focus-visible::before { background: var(--gf-accent); }
    .grip:focus-visible { outline: 2px solid var(--gf-focus); outline-offset: 2px; }
    /* A place's build button (top right); open, its cross: the place in the middle, an arm towards each side. */
    .build { position: absolute; top: 8px; right: 8px; width: 40px; height: 40px; padding: 0; font-size: 20px; border-radius: 10px; display: grid; place-items: center; z-index: 1; }
    .screen .slot.open { border-style: solid; border-color: var(--gf-accent); padding: 0; }
    .cross { position: absolute; inset: 6px; display: grid; grid-template: 1fr 1.3fr 1fr / 1fr 1.3fr 1fr; gap: 6px; }
    .cross button { min-width: 0; min-height: 0; padding: 2px; font-size: 14px; border-radius: 10px; display: flex; align-items: center; justify-content: center; gap: 6px; }
    .cross .arm { background: color-mix(in srgb, var(--gf-accent) 14%, var(--gf-surface)); border: 2px dashed var(--gf-accent); color: var(--gf-text); }
    .cross .arm:hover:not(:disabled), .cross .arm:focus-visible { background: color-mix(in srgb, var(--gf-accent) 30%, var(--gf-surface)); border-style: solid; }
    .cross .arm:disabled { opacity: .45; cursor: not-allowed; }
    .cross .top { grid-area: 1 / 2; } .cross .bottom { grid-area: 3 / 2; } .cross .left { grid-area: 2 / 1; } .cross .right { grid-area: 2 / 3; }
    .cross .mid { grid-area: 2 / 2; display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap: wrap; padding: 2px; border-radius: 10px; background: var(--gf-surface); border: 2px solid var(--gf-accent); }
    .cross .mid .n { width: 28px; height: 28px; font-size: 14px; }
    .cross .mid button { width: 34px; height: 34px; padding: 0; font-size: 16px; }
    .cross .mid .del { color: var(--gf-danger); }
    .cross .lbl { white-space: nowrap; }
    @container (max-width: 420px) { .cross .lbl { display: none; } }
    @container (max-height: 170px) { .cross { gap: 3px; inset: 3px; } .cross .mid .n { display: none; } .cross .mid button { width: 28px; height: 28px; font-size: 14px; } }
    .next { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .next p { margin: 0; color: var(--gf-text-muted); flex: 1 1 260px; }
    .empty { padding: 28px 16px; text-align: center; color: var(--gf-text-muted); border: 1px dashed var(--gf-border); border-radius: var(--gf-radius-lg); }
  `];

  constructor() {
    super();
    /** @type {{ name: string, grid?: string | null, spec?: string | null } | undefined} */
    this.route = undefined;
    this._scale = 0;
    /** @type {string | null} */
    this._open = null;
    this.#resize = new ResizeObserver(() => this.#fit());
  }

  /** @type {ResizeObserver} */ #resize;
  /** @type {HTMLElement | null} */ #room = null;
  /** The grid on the desktop, as cut and sized; and the address it was read from. @type {Box | null} */ #tree = null;
  /** @type {string} */ #treeFor = '';
  /** The grid the tree is of. @type {string} */ #treeGrid = '';
  /** The place just added (its path's key): drawn new once. @type {string | null} */ #added = null;
  /** What to focus once drawn (a selector). @type {string | null} */ #focus = null;

  disconnectedCallback() { super.disconnectedCallback(); this.#resize.disconnect(); this.#room = null; }

  updated() {
    const room = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.room'));
    if (room && room !== this.#room) { this.#resize.disconnect(); this.#room = room; this.#resize.observe(room); }
    if (this.#focus) { /** @type {HTMLElement | null} */ (this.renderRoot.querySelector(this.#focus))?.focus(); this.#focus = null; }
    this.#added = null;
  }

  /** The desktop's scale: the room's whole width (never above 1:1). */
  #fit() {
    if (this.#room) this._scale = Math.min(1, this.#room.clientWidth / DESKTOP.w);
  }

  get #grid() { return GRIDS.find(g => g.id === this.route?.grid) ?? null; }

  /** The grid on the desktop: the address's (g=), else the grid chosen as offered; read again when the address changes. */
  get #current() {
    const grid = this.#grid;
    if (!grid) return null;
    const want = this.route?.spec ?? '';
    const from = grid.id + '?' + want;
    if (from !== this.#treeFor || !this.#tree) {
      this.#treeFor = from;
      // The address catching up with the grid drawn (written by #set): kept as it is; else (a link, Back, a reload,
      // another grid) read from it.
      const own = this.#tree && this.#treeGrid === grid.id && specOf(this.#tree) === (want || specOf(/** @type {Box} */ (boxOf(grid.spec))));
      if (!own) {
        this.#tree = (want ? boxOf(want) : null) ?? boxOf(grid.spec);
        this.#treeGrid = grid.id;
        this._open = null;
      }
    }
    return this.#tree;
  }

  /** A grid chosen: its address — a new entry the first time (Back: no grid), then the same one (a change of mind is no step). @param {string} id */
  #choose(id) { (this.#grid ? replaceView : openView)(href.builder(id)); }

  /**
   * The grid changed (cut, a place out, sized): drawn now, and the address says it (g=, no new entry: the address is
   * where it is kept); `write` false while a grip is being dragged (written on release).
   * @param {Box} tree @param {boolean} [write]
   */
  #set(tree, write = true) {
    this.#tree = tree;
    const grid = /** @type {{ id: string, spec: string }} */ (this.#grid);
    if (write) {
      const spec = specOf(tree);
      const own = spec === specOf(/** @type {Box} */ (boxOf(grid.spec)));
      replaceView(href.builder(grid.id, own ? null : spec));
    }
    this.requestUpdate();
  }

  /** A place cut towards a side: the new place drawn new, its build button focused. @param {number[]} path @param {Side} side */
  #split(path, side) {
    const { root, added } = split(/** @type {Box} */ (this.#tree), path, side);
    if (!added) return;
    this._open = null;
    this.#added = keyOf(added);
    this.#focus = `[data-path="${this.#added}"] .build`;
    this.#set(root);
  }

  /** A place taken out: its room to its neighbour. @param {number[]} path */
  #remove(path) {
    this._open = null;
    this.#focus = '.screen .build';
    this.#set(remove(/** @type {Box} */ (this.#tree), path));
  }

  /** The cross of a place, open or closed (its build button focused again when closed). @param {number[]} path */
  #toggle(path) {
    const key = keyOf(path);
    if (this._open === key) { this._open = null; this.#focus = `[data-path="${key}"] .build`; }
    else { this._open = key; this.#focus = `[data-path="${key}"] .cross .arm:not(:disabled)`; }
  }

  /**
   * A grid drawn: its lists as flex boxes (the direction turning at each level, grammar.js#dirAt), its cells as
   * places; `big` (the desktop): numbered, labelled, each with its build button (and its cross, open), a grip
   * between two boxes of a list.
   * @param {Box} box @param {number[]} path @param {{ n: number }} count @param {boolean} big @param {string} [of] its share said, of what
   * @returns {import('lit').TemplateResult}
   */
  #draw(box, path, count, big, of = '') {
    const flex = `flex: ${box.share} 1 0`;
    if (!box.kids) {
      const n = ++count.n;
      if (!big) return html`<div class="slot" style=${flex}></div>`;
      const key = keyOf(path), open = this._open === key, isNew = this.#added === key;
      const root = /** @type {Box} */ (this.#tree);
      return html`<div class="slot ${open ? 'open' : ''} ${isNew ? 'new' : ''}" style=${flex} data-slot=${n} data-path=${key}
          @keydown=${(/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); this.#toggle(path); } }}>
        ${open ? html`<div class="cross" role="group" aria-label=${`Emplacement ${n} : le diviser, ou le retirer`}>
            ${ARMS.map(a => {
              const ok = canSplit(root, path, a.side);
              return html`<button type="button" class="arm ${a.side}" data-side=${a.side} ?disabled=${!ok}
                aria-label=${`Ajouter un emplacement ${a.label.toLowerCase()} de l’emplacement ${n}`}
                title=${ok ? `Ajouter un emplacement ${a.label.toLowerCase()}` : placesOf(root) >= 12 ? '12 emplacements au plus' : 'Pas plus de découpes dans ce sens ici'}
                @click=${() => this.#split(path, a.side)}>${icon(a.icon)}<span class="lbl">${a.label}</span></button>`;
            })}
            <div class="mid"><span class="n" aria-hidden="true">${n}</span>
              <button type="button" class="del" ?disabled=${placesOf(root) <= 1} title="Retirer cet emplacement (sa place revient à son voisin)"
                aria-label=${`Retirer l’emplacement ${n}`} @click=${() => this.#remove(path)}>${icon('trash3')}</button>
              <button type="button" class="close" title="Fermer" aria-label="Fermer" @click=${() => this.#toggle(path)}>${icon('x-lg')}</button>
            </div>
          </div>`
        : html`<span class="n">${n}</span><strong>Emplacement ${n}</strong><span>Bloc à choisir</span>${of ? html`<small class="w">${Math.round(box.share)} % ${of}</small>` : nothing}
          <button type="button" class="build" title="Diviser ou retirer cet emplacement" aria-label=${`Construire : diviser ou retirer l’emplacement ${n}`}
            @click=${() => this.#toggle(path)}>${icon('tools')}</button>`}
      </div>`;
    }
    const dir = dirAt(path.length), kids = box.kids;
    const sub = dir === 'row' ? (path.length ? 'de sa rangée' : 'de la largeur') : 'de sa colonne';
    return html`<div class="g ${dir}" style=${path.length ? flex : ''}>${kids.map((k, i) => html`${big && i > 0 ? this.#grip(path, kids, i, dir) : nothing}${this.#draw(k, [...path, i], count, big, sub)}`)}</div>`;
  }

  /**
   * A grip between boxes i - 1 and i of the list at `path`: dragged, or ←/→ (a row) ↑/↓ (a column), 2 % (Maj: 10 %).
   * @param {number[]} path @param {Box[]} kids @param {number} i @param {'row' | 'col'} dir
   */
  #grip(path, kids, i, dir) {
    const row = dir === 'row';
    return html`<div class="grip" role="separator" tabindex="0" aria-orientation=${row ? 'vertical' : 'horizontal'}
      aria-label=${row ? `Largeur entre les colonnes ${i} et ${i + 1}` : `Hauteur entre les rangées ${i} et ${i + 1}`} aria-valuemin="0" aria-valuemax="100"
      aria-valuenow=${Math.round(kids[i - 1].share / (kids[i - 1].share + kids[i].share) * 100)}
      @pointerdown=${(/** @type {PointerEvent} */ e) => this.#drag(e, path, i, row)}
      @keydown=${(/** @type {KeyboardEvent} */ e) => {
        const back = row ? 'ArrowLeft' : 'ArrowUp', on = row ? 'ArrowRight' : 'ArrowDown';
        if (e.key !== back && e.key !== on) return;
        e.preventDefault();
        const total = kids.reduce((t, k) => t + k.share, 0);
        this.#set(resize(/** @type {Box} */ (this.#tree), path, i, (e.key === on ? 1 : -1) * (e.shiftKey ? 10 : 2) * total / 100));
      }}></div>`;
  }

  /** A grip dragged: the pointer's moves in shares of its list (its size on screen, scaled or not); the address written on release. @param {PointerEvent} e @param {number[]} path @param {number} i @param {boolean} row */
  #drag(e, path, i, row) {
    if (e.button !== 0) return;
    e.preventDefault();
    const grip = /** @type {HTMLElement} */ (e.currentTarget);
    const rect = /** @type {HTMLElement} */ (grip.parentElement).getBoundingClientRect();
    const size = row ? rect.width : rect.height;
    const list = /** @type {Box} */ (path.reduce((b, j) => /** @type {Box[]} */ (b.kids)[j], /** @type {Box} */ (this.#tree)));
    const total = /** @type {Box[]} */ (list.kids).reduce((t, k) => t + k.share, 0);
    let at = row ? e.clientX : e.clientY;
    grip.setPointerCapture(e.pointerId);
    grip.classList.add('on');
    const move = (/** @type {PointerEvent} */ m) => {
      const now = row ? m.clientX : m.clientY;
      const d = (now - at) / size * total;
      at = now;
      this.#set(resize(/** @type {Box} */ (this.#tree), path, i, d), false);
    };
    const up = () => {
      grip.classList.remove('on');
      grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
      this.#set(/** @type {Box} */ (this.#tree));
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  }

  render() {
    const chosen = this.#grid;
    const tree = this.#current;
    const places = tree ? placesOf(tree) : 0;
    const changed = Boolean(chosen && this.route?.spec && tree && specOf(tree) !== specOf(/** @type {Box} */ (boxOf(chosen.spec))));
    return html`<div class="wrap">
      <header>
        <h1>${icon('window-desktop')} Créer une app</h1>
        <p>Une grille, puis des blocs dans ses emplacements, puis leurs réglages : votre écran, partageable par un lien.</p>
        <ol class="steps" aria-label="Étapes">
          <li aria-current="step"><b>1</b> Grille</li>
          <li><b>2</b> Blocs</li>
          <li><b>3</b> Réglages</li>
        </ol>
      </header>
      <section aria-labelledby="grids">
        <h2 id="grids">1. Choisissez une grille</h2>
        <div class="choices ${chosen ? 'compact' : ''}" role="group" aria-label="Grilles">${GRIDS.map(g => html`
          <button class="choice" type="button" title=${g.about} aria-pressed=${chosen?.id === g.id ? 'true' : 'false'} data-grid=${g.id} @click=${() => this.#choose(g.id)}>
            <div class="thumb" aria-hidden="true">${this.#draw(/** @type {Box} */ (boxOf(g.spec)), [], { n: 0 }, false)}</div>
            <b>${icon(g.icon)} ${g.title}${chosen?.id === g.id ? html`<span class="ok">${icon('check-circle-fill')}</span>` : nothing}</b>
            <small>${g.about}</small>
          </button>`)}</div>
      </section>
      ${chosen && tree ? html`<section class="preview" aria-labelledby="preview">
        <div class="head"><h2 id="preview">Aperçu sur ordinateur : ${chosen.title}${changed ? ' (modifiée)' : ''}</h2>
          <small>${places} emplacement${places > 1 ? 's' : ''} · ${DESKTOP.w} × ${DESKTOP.h} · ${icon('tools')} divise ou retire un emplacement ; les poignées règlent largeurs et hauteurs</small>
          ${changed ? html`<button type="button" class="reset" @click=${() => replaceView(href.builder(chosen.id))}>${icon('arrow-counterclockwise')} Revenir à la grille d’origine</button>` : nothing}</div>
        <div class="room" style="height: ${Math.round(DESKTOP.h * (this._scale || 0))}px"><div style="width: ${Math.round(DESKTOP.w * (this._scale || 0))}px">
          <div class="desk" role="group" aria-label=${`Écran d’ordinateur avec la grille « ${chosen.title} » : ${places} emplacements, numérotés`}
            style="transform: scale(${this._scale || 0})">
            <div class="chrome" aria-hidden="true"><i></i><i></i><i></i><span>yannouche-dev.github.io/flora</span></div>
            <div class="apphead" aria-hidden="true"><span class="dot"></span> Mon app</div>
            <div class="screen">${this.#draw(tree, [], { n: 0 }, true)}</div>
          </div>
        </div></div>
        <div class="next"><p>Étape suivante : choisir le bloc de chaque emplacement (carte, recherche, liste, fiche, photos…).</p>
          <button type="button" disabled title="Bientôt">Choisir les blocs ${icon('arrow-right')}</button></div>
      </section>` : html`<p class="empty">Choisissez une grille ci-dessus : elle s’affiche ici, sur un écran d’ordinateur.</p>`}
    </div>`;
  }
}
customElements.define('gf-builder', GfBuilder);
