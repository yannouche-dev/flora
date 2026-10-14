// @ts-check
// « Créer une app » (#/builder[/<grille>]): an app builder, easy but powerful, one step at a time. Step 1, the grid:
// three to choose from — a single column, three columns, a dashboard —, each drawn small on its card; the one chosen
// drawn large in a desktop window (1280 × 800, scaled to the room), its places numbered in reading order, the blocks
// to put in them chosen at the next step. A grid is a layout of the free layout's grammar (grammar.js) whose cells
// are empty places (`slot`): what the builder makes in the end is a « Disposition libre » (#/layout/…).
import { LitElement, html, css, nothing } from 'lit';
import { href } from '../core/router.js';
import { icon } from '../core/icons.js';
import { openView, replaceView } from '../core/history.js';
import { ui } from '../styles/ui.js';
import { parse, dirAt } from './grammar.js';

/**
 * The grids offered. `spec`: the layout (grammar.js) of empty places; `about`: what it suits.
 * @type {{ id: string, title: string, about: string, spec: string, icon: import('../core/icons.js').IconName }[]}
 */
export const GRIDS = [
  { id: 'colonne', title: 'Une colonne', icon: 'layout-text-window',
    about: 'Simple : les blocs l’un sous l’autre, comme une page qu’on fait défiler. Idéal pour une fiche, un récit, un téléphone.',
    spec: '[[slot@20,slot@45,slot]]' },
  { id: 'trois', title: 'Trois colonnes', icon: 'layout-three-columns',
    about: 'Classique : trois colonnes côte à côte, par exemple la carte, la liste et la fiche.',
    spec: '[slot@30,slot@35,slot]' },
  { id: 'tableau', title: 'Tableau de bord', icon: 'grid-1x2',
    about: 'Complet : un volet latéral, une rangée d’indicateurs, une grande zone et deux blocs en bas.',
    spec: '[slot@20,[[slot,slot,slot]@22,slot@46,[slot@60,slot]]]' }
];

/** The desktop drawn: its width and height (px, before scaling). */
const DESKTOP = { w: 1280, h: 800 };

/** @typedef {import('./grammar.js').LayoutNode} LayoutNode */
/** A grid as drawn: a place, or a list of boxes side by side (row) or one under the other (col); `share`: its part of its list (%). @typedef {{ share: number, dir?: 'row' | 'col', kids?: Box[] }} Box */

/** A column's least share of its row, dragged (%). */
const MIN_SHARE = 8;

/**
 * A layout's tree as boxes: every share said (those left unsaid share what the others leave of 100 %).
 * @param {LayoutNode} node @param {number} depth @param {number} [share] @returns {Box}
 */
function boxOf(node, depth, share = 100) {
  if (node.t === 'cell') return { share };
  const said = node.kids.filter(k => k.size != null);
  const rest = Math.max(0, 100 - said.reduce((a, k) => a + /** @type {number} */ (k.size), 0)) / Math.max(1, node.kids.length - said.length);
  return { share, dir: dirAt(depth), kids: node.kids.map(k => boxOf(k, depth + 1, k.size ?? rest)) };
}

export class GfBuilder extends LitElement {
  static properties = {
    /** The route: { name: 'builder', grid: string | null }. */
    route: { attribute: false },
    _scale: { state: true }
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
    .screen .slot { display: grid; place-content: center; justify-items: center; gap: 6px; text-align: center; padding: 8px;
      background: color-mix(in srgb, var(--gf-accent) 7%, var(--gf-surface)); border: 2px dashed color-mix(in srgb, var(--gf-accent) 45%, transparent); border-radius: 10px; color: var(--gf-text-muted); font-size: 15px; }
    .screen .slot .n { display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--gf-accent); color: var(--gf-accent-contrast); font-weight: 700; font-size: 16px; }
    .screen .slot strong { color: var(--gf-text); font-size: 16px; }
    .screen .slot .w { font-size: 13px; color: var(--gf-text); font-variant-numeric: tabular-nums; }
    /* A grip between two columns: a thin bar, wider to the hand than to the eye. */
    .grip { flex: none; width: 12px; margin: 0 -6px; position: relative; z-index: 1; cursor: col-resize; touch-action: none; display: flex; justify-content: center; border-radius: 6px; }
    .grip::before { content: ''; width: 4px; border-radius: 2px; background: var(--gf-border); transition: background .15s; }
    .grip:hover::before, .grip.on::before, .grip:focus-visible::before { background: var(--gf-accent); }
    .grip:focus-visible { outline: 2px solid var(--gf-focus); outline-offset: 2px; }
    .next { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .next p { margin: 0; color: var(--gf-text-muted); flex: 1 1 260px; }
    .empty { padding: 28px 16px; text-align: center; color: var(--gf-text-muted); border: 1px dashed var(--gf-border); border-radius: var(--gf-radius-lg); }
  `];

  constructor() {
    super();
    /** @type {{ name: string, grid?: string | null } | undefined} */
    this.route = undefined;
    this._scale = 0;
    /** The chosen grid's shares, as dragged (null: its own); keyed by grid. @type {{ id: string, tree: Box } | null} */
    this._shares = null;
    this.#resize = new ResizeObserver(() => this.#fit());
  }

  /** @type {ResizeObserver} */ #resize;

  disconnectedCallback() { super.disconnectedCallback(); this.#resize.disconnect(); this.#room = null; }

  updated() {
    const room = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.room'));
    if (room && room !== this.#room) { this.#resize.disconnect(); this.#room = room; this.#resize.observe(room); }
  }

  /** The desktop's scale: the room's whole width (never above 1:1). */
  #fit() {
    if (this.#room) this._scale = Math.min(1, this.#room.clientWidth / DESKTOP.w);
  }
  /** @type {HTMLElement | null} */ #room = null;

  get #grid() { return GRIDS.find(g => g.id === this.route?.grid) ?? null; }

  /** A grid chosen: its address — a new entry the first time (Back: no grid), then the same one (a change of mind is no step). @param {string} id */
  #choose(id) { (this.#grid ? replaceView : openView)(href.builder(id)); }

  /** The chosen grid as boxes (its own shares, or as dragged). @param {{ id: string, spec: string }} grid @returns {Box} */
  #boxes(grid) {
    if (this._shares?.id !== grid.id) this._shares = { id: grid.id, tree: boxOf(parse(grid.spec).tree, 0) };
    return this._shares.tree;
  }

  /**
   * A grid drawn: its lists as flex boxes (the direction turning at each level, grammar.js#dirAt), its cells as
   * places; `big`: numbered and labelled (the desktop), with a grip between two columns side by side (dragged, or
   * ←/→ when focused: the width moves from one to the other, the row as wide as before — the grid stays full width).
   * @param {Box} box @param {{ n: number }} count @param {boolean} big @param {string} [of] a column of a row: its width said, of what (« de la largeur », « de sa rangée »)
   * @returns {import('lit').TemplateResult}
   */
  #draw(box, count, big, of = '') {
    const flex = `flex: ${box.share} 1 0`;
    if (!box.kids) {
      const n = ++count.n;
      return big ? html`<div class="slot" style=${flex} data-slot=${n}><span class="n">${n}</span><strong>Emplacement ${n}</strong><span>Bloc à choisir</span>${of ? html`<small class="w">${Math.round(box.share)} % ${of}</small>` : nothing}</div>`
        : html`<div class="slot" style=${flex}></div>`;
    }
    const kids = box.kids;
    return html`<div class="g ${box.dir}" style=${flex}>${kids.map((k, i) => html`${big && box.dir === 'row' && i > 0 ? html`<div class="grip" role="separator" tabindex="0"
        aria-orientation="vertical" aria-label=${`Largeur entre les colonnes ${i} et ${i + 1}`} aria-valuemin="0" aria-valuemax="100"
        aria-valuenow=${Math.round(kids[i - 1].share / (kids[i - 1].share + k.share) * 100)}
        @pointerdown=${(/** @type {PointerEvent} */ e) => this.#drag(e, box, i)} @keydown=${(/** @type {KeyboardEvent} */ e) => this.#key(e, box, i)}></div>` : nothing}${this.#draw(k, count, big, box.dir !== 'row' ? '' : box === this._shares?.tree ? 'de la largeur' : 'de sa rangée')}`)}</div>`;
  }

  /** The width moved from column i - 1 to column i (in shares of their row; each kept above MIN_SHARE). @param {Box} row @param {number} i @param {number} delta */
  #move(row, i, delta) {
    const a = /** @type {Box[]} */ (row.kids)[i - 1], b = /** @type {Box[]} */ (row.kids)[i];
    const pair = a.share + b.share;
    const next = Math.min(pair - MIN_SHARE, Math.max(MIN_SHARE, a.share + delta));
    if (next === a.share) return;
    a.share = next; b.share = pair - next;
    this.requestUpdate();
  }

  /** A grip dragged: the pointer's moves, in shares of the row (its width on screen, scaled or not). @param {PointerEvent} e @param {Box} row @param {number} i */
  #drag(e, row, i) {
    if (e.button !== 0) return;
    e.preventDefault();
    const grip = /** @type {HTMLElement} */ (e.currentTarget);
    const width = /** @type {HTMLElement} */ (grip.parentElement).getBoundingClientRect().width;
    const total = /** @type {Box[]} */ (row.kids).reduce((t, k) => t + k.share, 0);
    let x = e.clientX;
    grip.setPointerCapture(e.pointerId);
    grip.classList.add('on');
    const move = (/** @type {PointerEvent} */ m) => { const d = (m.clientX - x) / width * total; x = m.clientX; this.#move(row, i, d); };
    const up = () => { grip.classList.remove('on'); grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  }

  /** A grip's keys: ←/→ 2 % of the row (Maj: 10 %). @param {KeyboardEvent} e @param {Box} row @param {number} i */
  #key(e, row, i) {
    const step = (e.shiftKey ? 10 : 2) * /** @type {Box[]} */ (row.kids).reduce((t, k) => t + k.share, 0) / 100;
    if (e.key === 'ArrowLeft') this.#move(row, i, -step);
    else if (e.key === 'ArrowRight') this.#move(row, i, step);
    else return;
    e.preventDefault();
  }

  /** @param {{ id: string, spec: string }} grid @param {boolean} big */
  #drawGrid(grid, big) { return this.#draw(big ? this.#boxes(grid) : boxOf(parse(grid.spec).tree, 0), { n: 0 }, big); }

  render() {
    const chosen = this.#grid;
    const places = chosen ? (chosen.spec.match(/slot/g) ?? []).length : 0;
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
            <div class="thumb" aria-hidden="true">${this.#drawGrid(g, false)}</div>
            <b>${icon(g.icon)} ${g.title}${chosen?.id === g.id ? html`<span class="ok">${icon('check-circle-fill')}</span>` : nothing}</b>
            <small>${g.about}</small>
          </button>`)}</div>
      </section>
      ${chosen ? html`<section class="preview" aria-labelledby="preview">
        <div class="head"><h2 id="preview">Aperçu sur ordinateur : ${chosen.title}</h2><small>${places} emplacements · ${DESKTOP.w} × ${DESKTOP.h} · glissez les poignées entre les colonnes pour régler leurs largeurs</small></div>
        <div class="room" style="height: ${Math.round(DESKTOP.h * (this._scale || 0))}px"><div style="width: ${Math.round(DESKTOP.w * (this._scale || 0))}px">
          <div class="desk" role="group" aria-label=${`Écran d’ordinateur avec la grille « ${chosen.title} » : ${places} emplacements, numérotés ; les poignées entre les colonnes règlent leurs largeurs`}
            style="transform: scale(${this._scale || 0})">
            <div class="chrome" aria-hidden="true"><i></i><i></i><i></i><span>yannouche-dev.github.io/flora</span></div>
            <div class="apphead" aria-hidden="true"><span class="dot"></span> Mon app</div>
            <div class="screen">${this.#drawGrid(chosen, true)}</div>
          </div>
        </div></div>
        <div class="next"><p>Étape suivante : choisir le bloc de chaque emplacement (carte, recherche, liste, fiche, photos…).</p>
          <button type="button" disabled title="Bientôt">Choisir les blocs ${icon('arrow-right')}</button></div>
      </section>` : html`<p class="empty">Choisissez une grille ci-dessus : elle s’affiche ici, sur un écran d’ordinateur.</p>`}
    </div>`;
  }
}
customElements.define('gf-builder', GfBuilder);
