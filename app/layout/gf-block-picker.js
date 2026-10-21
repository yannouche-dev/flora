// @ts-check
// The block picker: one panel that edits ONE cell of a free layout (gf-layout.js: a cell's « Choisir le contenu », an
// « Emplacement »'s tiles) — its component, its block, its intent, its settings. Everything it offers comes from the registry's schema (registry.js; picker-model.js,
// summary.js), never from a component by name. Three levels, a breadcrumb (« Case 3 › Carte › Couches ») and Back:
//  - « Contenu »: a tile per component (its icon, title, sentence), those to suggest first (what the other cells
//    read and write: nothing chooses a plant → the results, the map…), those too large for the cell greyed with why
//    (« « Carte » demande 240 px de large »); the sheet's tile opens its blocks; never the « Emplacement » itself (what
//    « Vider la case » leaves, when the host offers it: `clear-label`).
//  - « Que montre-t-il ? » (a component with intents: the map): a card per intent, what it sets drawn as chips; a tap
//    applies it.
//  - « Affiner »: a row per group of settings (Où, Fond, Couches…, « Réglages », Cadre, Liens), each with a line of
//    its values (« Plan IGN · 2D ») and a dot ● when written beside the intent; a row opens its controls, made from
//    each setting's kind: a few choices a row of buttons, more a menu, a yes or no a switch, a distance a slider on the
//    radii's stops, a list chips, words a field. « Revenir à l'intention ».
// Inline (`inline`: an « Emplacement », slot, of a layout — built or in the app): its first level drawn in the place
// itself, sized to it (compact tiles of an icon and a name when it is small, with their sentence when it is large):
// one tap builds the component there — a component with intents, its intent cards first, in the place too.
// Every change applies at once: `change` ({ text }: the cell's canonical text, no share) — the host writes it where
// the cell is, and gives the picker its new `cell`. `clear`, `close` (Échap, ✕): the host's. Docked on the right of the
// screen; on a phone (< 700 px), a bottom sheet (85 % of the height at most, scrolled inside) — between the host's
// --picker-top and --picker-bottom (px: its own view, not the app's bars).

import { LitElement, html, css, nothing } from 'lit';
import { icon } from '../core/icons.js';
import { ui } from '../styles/ui.js';
import { DISTANCES, distanceAt, distanceEvents } from '../miniapp/kit/cards.js';
import { cellIcon, COMPONENTS, distanceLabel, resolve } from './registry.js';
import { cell as makeCell } from './grammar.js';
import { bundleOf, cellChips, changed, groupSummary, intentKey, valueLabel, valueOf } from './summary.js';
import { cellOf, choose, cleanWords, controlOf, fitReason, groupsOf, optionsOf, resetSettings, setParam, suggestions, warningOf, withIntent } from './picker-model.js';
import { SLOT } from './builder-grid.js';

/**
 * @typedef {import('./registry.js').Resolved} Resolved
 * @typedef {Resolved & { known: true }} Known
 * @typedef {import('./registry.js').ComponentSpec} ComponentSpec
 * @typedef {'content' | 'blocks' | 'intent' | 'settings' | 'group'} Level
 */

/**
 * Where a host's picker goes: between the top and the bottom of the host's own view (the app's bars left in sight), as
 * the style of the gf-block-picker element. @param {Element} host @returns {string}
 */
export function pickerBounds(host) {
  const r = host.getBoundingClientRect();
  return `--picker-top: ${Math.max(0, Math.round(r.top))}px; --picker-bottom: ${Math.max(0, Math.round(innerHeight - r.bottom))}px`;
}

const LEVEL_TITLE = { content: 'Contenu', blocks: 'Fiche : un bloc', intent: 'Que montre-t-il ?', settings: 'Affiner', group: '' };

export class GfBlockPicker extends LitElement {
  static properties = {
    /** The cell as the address writes it (« map(floraison) »); empty or « slot »: none yet. */
    cell: { type: String },
    /** Its name in the breadcrumb: « Case 3 », « Emplacement 3 ». */
    label: { type: String },
    /** The room the cell has (px), to grey the components too large for it; null: unknown. */
    room: { attribute: false },
    /** The other cells of the layout (their text): what to suggest. */
    others: { attribute: false },
    /** The words of the button that empties the place or removes the cell; none: no such button. */
    clearLabel: { type: String, attribute: 'clear-label' },
    /** The current plant (a cell's « Plante fixée » can take it). */
    plant: { type: Number },
    /** Drawn in an « Emplacement » (a slot), its first level only. */
    inline: { type: Boolean, reflect: true },
    /** Inline: the component chosen whose intent comes next. */
    _pending: { state: true },
    /** Inline: the room of the place (px), measured. */
    _room: { state: true },
    _level: { state: true },
    _group: { state: true }
  };

  static styles = [ui, css`
    :host { position: fixed; z-index: 40; top: var(--picker-top, 0px); right: 0; bottom: var(--picker-bottom, 0px); width: min(380px, 100%); display: flex; color: var(--gf-text); }
    .panel { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--gf-surface); border-left: 1px solid var(--gf-border);
      box-shadow: var(--gf-shadow-float, -8px 0 30px rgb(0 0 0 / .15)); }
    @media (max-width: 699px) {
      :host { top: auto; left: 0; width: auto; max-height: min(85vh, 100vh - var(--picker-top, 0px) - var(--picker-bottom, 0px)); }
      .panel { border-left: 0; border-top: 1px solid var(--gf-border); border-radius: 16px 16px 0 0; }
      .panel::before { content: ''; align-self: center; width: 40px; height: 4px; margin-top: 6px; border-radius: 2px; background: var(--gf-border); }
    }
    header { flex: none; display: flex; align-items: center; gap: 4px; padding: 6px 6px 0; min-width: 0; }
    header .icon-btn { width: 40px; height: 40px; font-size: 1.1rem; flex: none; }
    header .back[hidden] { visibility: hidden; display: inline-grid; }
    nav { flex: 1; min-width: 0; }
    ol.crumbs { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 2px 4px; font-size: 0.82rem; color: var(--gf-text-muted); }
    ol.crumbs li { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
    ol.crumbs li + li::before { content: '›'; }
    ol.crumbs button { all: unset; cursor: pointer; color: var(--gf-accent); border-radius: 4px; }
    ol.crumbs button:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    ol.crumbs [aria-current] { color: var(--gf-text); font-weight: 600; }
    h2 { margin: 4px 16px 8px; font-size: 1.1rem; outline: none; }
    .body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 16px 16px; display: grid; gap: 10px; align-content: start; }
    .hint { margin: 0; font-size: 0.85rem; color: var(--gf-text-muted); }
    .tiles { display: grid; gap: 8px; }
    .tile { all: unset; box-sizing: border-box; cursor: pointer; display: grid; grid-template-columns: auto 1fr auto; gap: 2px 12px; align-items: center; padding: 10px 12px;
      border: 1px solid var(--gf-border); border-radius: var(--gf-radius-lg, 14px); background: var(--gf-surface); }
    .tile:hover { border-color: var(--gf-accent); }
    .tile:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .tile[aria-pressed='true'] { border-color: var(--gf-accent); box-shadow: 0 0 0 2px var(--gf-accent); }
    .tile > .bi { grid-row: span 3; font-size: 1.6rem; color: var(--gf-accent); }
    .tile b { font-size: 0.95rem; }
    .tile small { grid-column: 2; color: var(--gf-text-muted); font-size: 0.8rem; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .tile .go { grid-row: span 3; grid-column: 3; color: var(--gf-text-muted); }
    .tile .why { grid-column: 2; font-size: 0.78rem; font-weight: 600; }
    .tile .why.sugg { color: var(--gf-accent); }
    .tile .why.warn { color: var(--gf-warn, #9a5b00); }
    .tile .why.small { color: var(--gf-text-muted); font-weight: 500; }
    .tiles.small .tile { padding: 8px 12px; }
    .tiles.small .tile > .bi { font-size: 1.2rem; grid-row: auto; }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; grid-column: 2; }
    .chips span { font-size: 0.74rem; padding: 1px 8px; border-radius: var(--gf-radius-pill); background: var(--gf-accent-soft); color: var(--gf-text); }
    .card { display: grid; gap: 6px; padding: 10px 12px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-lg, 14px); }
    .card .top { display: flex; align-items: center; gap: 8px; }
    .card .top .bi { font-size: 1.3rem; color: var(--gf-accent); }
    .card .top b { flex: 1; }
    .card .top button { min-height: 32px; padding: 2px 12px; font-size: 0.82rem; }
    .card .chips { grid-column: auto; }
    .rows { display: grid; gap: 6px; }
    .row { all: unset; box-sizing: border-box; cursor: pointer; display: grid; grid-template-columns: 1fr auto; gap: 0 8px; align-items: center; padding: 10px 12px;
      border: 1px solid var(--gf-border); border-radius: 12px; }
    .row:hover { border-color: var(--gf-accent); }
    .row:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .row b { display: flex; align-items: center; gap: 6px; font-size: 0.92rem; }
    .row .dot { color: var(--gf-accent); font-size: 0.7rem; }
    .row small { grid-column: 1; color: var(--gf-text-muted); font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row .go { grid-row: span 2; grid-column: 2; color: var(--gf-text-muted); }
    .ctl { display: grid; gap: 6px; padding: 8px 0; border-bottom: 1px solid var(--gf-border); }
    .ctl:last-child { border-bottom: 0; }
    .ctl > .name { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 0.88rem; font-weight: 600; }
    .ctl .note { font-size: 0.78rem; color: var(--gf-text-muted); font-weight: 400; }
    .seg { display: flex; flex-wrap: wrap; gap: 4px; }
    .seg button, .chipset button { min-height: 34px; padding: 4px 12px; font-size: 0.84rem; }
    .chipset { display: flex; flex-wrap: wrap; gap: 6px; }
    .ctl select { width: 100%; }
    .switch { all: unset; cursor: pointer; flex: none; position: relative; width: 44px; height: 26px; border-radius: 13px; background: var(--gf-border); transition: background .15s; }
    .switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: var(--gf-surface); box-shadow: 0 1px 3px rgb(0 0 0 / .3); transition: left .15s; }
    .switch[aria-checked='true'] { background: var(--gf-accent); }
    .switch[aria-checked='true']::after { left: 21px; }
    .switch:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .slider { display: flex; align-items: center; gap: 10px; }
    .slider input { flex: 1; accent-color: var(--gf-accent); }
    .slider output { min-width: 4.5em; text-align: right; font-variant-numeric: tabular-nums; font-size: 0.85rem; }
    .ctl input[type='text'] { min-height: 38px; padding: 6px 10px; font-size: 0.9rem; }
    .foot { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 6px; }
    .foot button { min-height: 34px; padding: 4px 14px; font-size: 0.85rem; }
    /* Inline: in the place itself, its tiles sized to it. */
    :host([inline]) { position: static; z-index: auto; display: block; width: auto; height: 100%; min-height: 0; overflow-y: auto; container-type: size; }
    .inline { display: grid; gap: 8px; align-content: start; padding: 10px; box-sizing: border-box; }
    .inline .ihead { display: flex; align-items: center; gap: 6px; min-height: 32px; }
    .inline .ihead .lead { margin: 0; font-weight: 700; font-size: 0.92rem; }
    .inline .ihead .icon-btn { width: 32px; height: 32px; font-size: 1rem; }
    .inline .tiles { grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr)); }
    @container (max-width: 420px) or (max-height: 340px) {
      .inline { padding: 6px; gap: 6px; }
      .inline .tiles { grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 6px; }
      .inline .tile { grid-template-columns: 1fr; justify-items: center; text-align: center; gap: 2px; padding: 8px 4px; }
      .inline .tile > .bi { grid-row: auto; font-size: 1.3rem; }
      .inline .tile b { font-size: 0.8rem; }
      .inline .tile small, .inline .tile .go, .inline .tile .chips { display: none; }
      .inline .tile .why { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    }
    @media (prefers-reduced-motion: no-preference) { .panel { animation: in .18s ease-out; } }
    @keyframes in { from { transform: translateX(24px); opacity: 0; } }
    @media (max-width: 699px) and (prefers-reduced-motion: no-preference) { .panel { animation-name: up; } }
    @keyframes up { from { transform: translateY(40px); opacity: 0; } }
  `];

  constructor() {
    super();
    this.cell = '';
    this.label = 'Case';
    /** @type {{ w: number, h: number } | null} */
    this.room = null;
    /** @type {string[]} */
    this.others = [];
    /** @type {string | null} */
    this.clearLabel = null;
    /** @type {number | null} */
    this.plant = null;
    /** @type {Level | null} */
    this._level = null;
    /** @type {string | null} */
    this._group = null;
    this.inline = false;
    /** @type {ComponentSpec | null} */
    this._pending = null;
    /** @type {{ w: number, h: number } | null} */
    this._room = null;
  }

  /** Inline: the place's room, followed. */
  #size = new ResizeObserver(() => {
    const cell = this.closest('section.cell') ?? this.parentElement;
    const r = cell?.getBoundingClientRect();
    if (r && (r.width !== this._room?.w || r.height !== this._room?.h)) this._room = { w: r.width, h: r.height };
  });

  /** The first choice focused (a place just made: the cross). */
  focusFirst() { /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.tile'))?.focus(); }

  /** The cell, read: its node (null: an « Emplacement ») and what it is. */
  get #node() {
    const n = this.cell ? cellOf(this.cell) : null;
    return n && !(n.name === SLOT && !n.view && !n.params.length) ? n : null;
  }

  /** @param {import('lit').PropertyValues} changed */
  willUpdate(changed) {
    // Opened: on a cell that is a known component, its settings; else what to put there.
    if (this._level === null) this._level = this.#known() ? 'settings' : 'content';
    if (changed.has('cell') && this._level !== 'content' && this._level !== 'blocks' && !this.#known()) this._level = 'content';
  }

  /** @returns {Known | null} */
  #known() {
    const n = this.#node;
    const r = n ? resolve(n) : null;
    return r?.known ? r : null;
  }

  firstUpdated() { if (!this.inline) this.#focusHeading(); }

  connectedCallback() {
    super.connectedCallback();
    if (this.inline) this.#size.observe(this); else addEventListener('keydown', this.#onWindowKey);
  }
  disconnectedCallback() { super.disconnectedCallback(); this.#size.disconnect(); removeEventListener('keydown', this.#onWindowKey); }

  /** Échap with the focus nowhere (a button gone with its level): the picker closes all the same. @param {KeyboardEvent} e */
  #onWindowKey = e => {
    if (e.key === 'Escape' && !e.defaultPrevented && (document.activeElement === document.body || document.activeElement === null)) { e.preventDefault(); this.#fire('close'); }
  };

  /** The level's heading focused (a level opened, Back): what is read next is the level. */
  async #focusHeading() {
    await this.updateComplete;
    if (this.inline) this.focusFirst();
    else /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('h2'))?.focus();
  }

  /** @param {Level} level @param {string | null} [group] */
  #go(level, group = null) {
    this._level = level;
    this._group = group;
    this.#focusHeading();
  }

  /** Back one level: a group to the settings; the intents to the settings (a component known); the settings, the blocks to the content. */
  #back() {
    const l = this._level;
    if (l === 'group' || (l === 'intent' && this.#known())) this.#go('settings');
    else if (l !== 'content') this.#go('content');
  }

  /** @param {string} name @param {Record<string, unknown>} [detail] */
  #fire(name, detail = {}) { this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true })); }

  /** The cell's new text, to the host (which gives it back as `cell`). @param {string} text */
  #emit(text) {
    if (text === this.cell) return;
    this.cell = text;
    this.#fire('change', { text });
  }

  /** @param {KeyboardEvent} e */
  #key(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    this.#fire('close');
  }

  /** The other cells, resolved. @returns {Resolved[]} */
  get #others() {
    return (this.others ?? []).map(t => cellOf(t)).filter(n => n && n.name !== SLOT).map(n => resolve(/** @type {any} */ (n)));
  }

  /** A component chosen: written at once; then its intents, or its settings. @param {ComponentSpec} c @param {string | null} [view] */
  #choose(c, view = null) {
    const intents = Object.values(c.params).some(p => p.kind === 'intent');
    // Inline: a component with intents, its intent first (the place becomes the component then).
    if (this.inline) {
      if (intents) { this._pending = c; this.#go('intent'); } else this.#emit(choose(null, c.id, view));
      return;
    }
    const r = this.#known();
    const same = r && r.spec.id === c.id && (r.view?.key ?? null) === view;
    if (!same) this.#emit(choose(this.#node, c.id, view));
    this.#go(intents ? 'intent' : 'settings');
  }

  // ── Levels ──────────────────────────────────────────────────────────────────────────────────────────────

  /** « Contenu »: a tile per component, suggested first — every one can be chosen (one a little large for the cell says so). */
  #content() {
    const others = this.#others;
    const sugg = suggestions(others);
    const r = this.#known();
    // Not the place itself: what « Changer de bloc » leaves.
    const room = this.inline ? this._room : this.room;
    const tiles = COMPONENTS.filter(c => !c.empty).map(c => ({ c, why: sugg.get(c.id) ?? null, small: fitReason(c, room), warn: warningOf(c, others) }))
      .map((t, i) => ({ ...t, rank: (t.why ? 0 : 1) * 100 + i }))
      .sort((a, b) => a.rank - b.rank);
    return html`${this.inline ? nothing : html`<p class="hint">Ce que montre « ${this.label} » : un outil de GeoFlora, relié aux autres cases.</p>`}
      <div class="tiles" role="group" aria-label="Composants">${tiles.map(({ c, why, small, warn }) => {
        const views = Boolean(c.views);
        const on = r?.spec.id === c.id;
        return html`<button type="button" class="tile" data-comp=${c.id} aria-pressed=${on ? 'true' : 'false'} title=${c.about}
          @click=${() => { if (views) this.#go('blocks'); else this.#choose(c); }}>
          ${icon(c.icon)}<b>${c.title}</b>${views ? html`<span class="go" aria-hidden="true">${icon('chevron-right')}</span>` : nothing}
          <small>${c.about}</small>
          ${why ? html`<span class="why sugg">${icon('lightbulb')} Suggéré : ${why}</span>` : warn ? html`<span class="why warn">${icon('exclamation-triangle-fill')} ${warn}</span>` : nothing}
          ${small ? html`<span class="why small">${icon('arrows-angle-expand')} ${small}</span>` : nothing}
        </button>`;
      })}</div>
      ${this.clearLabel && !this.inline ? html`<div class="foot"><button type="button" data-act="clear" @click=${() => this.#fire('clear')}>${icon('arrow-counterclockwise')} ${this.clearLabel}</button></div>` : nothing}`;
  }

  /** The sheet's blocks: the whole sheet, then each block (its own icon). */
  #blocks() {
    const plant = /** @type {ComponentSpec} */ (COMPONENTS.find(c => c.views));
    const r = this.#known();
    const views = [{ key: null, title: `${plant.title} entière` }, ...(plant.views?.() ?? [])];
    return html`${this.inline ? nothing : html`<p class="hint">${plant.about}</p>`}
      <div class="tiles small" role="group" aria-label=${'Blocs de ' + plant.title.toLowerCase()}>${views.map(v => {
        const on = r?.spec.id === plant.id && (r.view?.key ?? null) === v.key;
        const ic = cellIcon(resolve(makeCell(plant.id, v.key)));
        return html`<button type="button" class="tile" data-view=${v.key ?? ''} aria-pressed=${on ? 'true' : 'false'} @click=${() => this.#choose(plant, v.key)}>
          ${icon(ic)}<b>${v.title}</b></button>`;
      })}</div>`;
  }

  /** « Que montre-t-il ? »: a card per intent, what it sets as chips; a tap applies it. @param {Known} r */
  #intents(r) {
    const k = /** @type {string} */ (intentKey(r));
    const ps = r.spec.params[k];
    const now = r.given.has(k) ? r.params[k] : ps.def;
    return html`${this.inline ? nothing : html`<p class="hint">Une intention règle ${r.spec.title.toLowerCase()} d’un geste ; « Affiner » change ensuite ce qu’on veut.</p>`}
      <div class="tiles" role="group" aria-label="Intentions">${Object.entries(ps.values ?? {}).map(([v, label]) => {
        const bundle = bundleOf(r, v);
        const chips = Object.entries(bundle).map(([p, x]) => valueLabel(r.spec.params[p], x)).filter(Boolean);
        return html`<button type="button" class="tile" data-intent=${v} aria-pressed=${now === v ? 'true' : 'false'}
          @click=${() => { this.#emit(withIntent(this.#node ?? makeCell(r.spec.id), v)); if (!this.inline) this.#go('settings'); }}>
          ${icon(r.spec.icon)}<b>${label}</b>
          <span class="chips">${chips.length ? chips.map(c => html`<span>${c}</span>`) : html`<span>Réglages par défaut</span>`}</span>
        </button>`;
      })}</div>`;
  }

  /** « Affiner »: the cell said, its intent, a row per group of settings. @param {Known} r */
  #settings(r) {
    const k = intentKey(r);
    const groups = groupsOf(r.spec);
    const any = Object.keys(r.spec.params).some(p => changed(r, p) && !r.spec.params[p].frame && r.spec.params[p].group !== 'Où');
    return html`<div class="card"><div class="top">${icon(cellIcon(r))}<b>${r.view ? `${r.spec.title} › ${r.view.title}` : r.spec.title}</b>
        <button type="button" data-act="content" @click=${() => this.#go('content')}>Changer</button></div>
        <span class="chips" data-summary>${cellChips(r).slice(r.view ? 2 : 1).map(c => html`<span>${c}</span>`)}</span></div>
      <div class="rows">
        ${k ? html`<button type="button" class="row" data-group="intent" @click=${() => this.#go('intent')}>
          <b>Que montre-t-il ?</b><small>${valueLabel(r.spec.params[k], r.given.has(k) ? r.params[k] : r.spec.params[k].def)}</small>
          <span class="go" aria-hidden="true">${icon('chevron-right')}</span></button>` : nothing}
        ${groups.map(g => {
          const dot = g.keys.some(p => changed(r, p));
          const line = groupSummary(r, g.keys);
          return html`<button type="button" class="row" data-group=${g.name} @click=${() => this.#go('group', g.name)}
            aria-label=${`${g.name}${dot ? ' (modifié)' : ''} : ${line}`}>
            <b>${g.name}${dot ? html`<span class="dot" aria-hidden="true">●</span>` : nothing}</b><small>${line}</small>
            <span class="go" aria-hidden="true">${icon('chevron-right')}</span></button>`;
        })}
      </div>
      ${any ? html`<div class="foot"><button type="button" data-act="reset" @click=${() => { this.#emit(resetSettings(/** @type {any} */ (this.#node))); this.#focusHeading(); }}>
        ${icon('arrow-counterclockwise')} ${k ? 'Revenir à l’intention' : 'Réglages par défaut'}</button></div>` : nothing}`;
  }

  /** A group's settings, each with the control its kind gets. @param {Known} r @param {string} name */
  #group(r, name) {
    const g = groupsOf(r.spec).find(x => x.name === name);
    if (!g) return nothing;
    return html`<div role="group" aria-label=${name}>${g.keys.map(k => this.#control(r, k))}</div>`;
  }

  /** One setting's control. @param {Known} r @param {string} key */
  #control(r, key) {
    const ps = r.spec.params[key];
    const node = /** @type {any} */ (this.#node);
    const set = (/** @type {unknown} */ v) => this.#emit(setParam(node, key, v));
    const v = r.params[key];
    const id = 'p-' + key;
    const note = r.implied.has(key) ? html`<span class="note">selon l’intention</span>` : changed(r, key) ? html`<span class="note">● modifié</span>`
      : v == null && ps.unset ? html`<span class="note">${ps.kind === 'list' ? 'aucune choisie' : 'par défaut'} : ${ps.unset}</span>` : nothing;
    const kind = controlOf(ps);
    /** @type {unknown} */
    let body = nothing;
    if (kind === 'switch') {
      return html`<div class="ctl" data-param=${key}><div class="name"><span id=${id}>${ps.label} ${note}</span>
        <button type="button" class="switch" role="switch" aria-labelledby=${id} aria-checked=${v ? 'true' : 'false'} @click=${() => set(!v)}></button></div></div>`;
    }
    if (kind === 'segmented') {
      body = html`<div class="seg" role="group" aria-labelledby=${id}>${optionsOf(ps).map(o => html`<button type="button" data-value=${String(o.value)}
        aria-pressed=${(v ?? null) === o.value ? 'true' : 'false'} @click=${() => set(o.value)}>${o.label}</button>`)}</div>`;
    } else if (kind === 'select') {
      body = html`<select aria-labelledby=${id} @change=${(/** @type {any} */ e) => set(e.target.value === '' ? null : e.target.value)}>
        ${optionsOf(ps).map(o => html`<option value=${o.value === null ? '' : String(o.value)} ?selected=${(v ?? null) === o.value}>${o.label}</option>`)}</select>`;
    } else if (kind === 'slider') {
      const m = /** @type {number | null} */ (v);
      const ev = distanceEvents(() => m ?? 2000, x => set(x));
      body = html`<div class="slider"><input type="range" min="0" max=${DISTANCES.length - 1} step="any" .value=${String(distanceAt(m ?? 2000))}
          aria-labelledby=${id} aria-valuetext=${m == null ? 'par défaut' : distanceLabel(m)} @input=${ev.input} @keydown=${ev.keydown} />
        <output>${m == null ? 'Par défaut' : distanceLabel(m)}</output></div>
        ${r.given.has(key) ? html`<div class="seg"><button type="button" data-act="default" @click=${() => set(null)}>Par défaut</button></div>` : nothing}`;
    } else if (kind === 'chips') {
      const on = /** @type {string[]} */ (valueOf(r, key) ?? []);
      body = html`<div class="chipset" role="group" aria-labelledby=${id}>${Object.entries(ps.values ?? {}).map(([x, label]) => html`<button type="button" class="chip" data-value=${x}
        aria-pressed=${on.includes(x) ? 'true' : 'false'} @click=${() => set(Object.keys(ps.values ?? {}).filter(y => y === x ? !on.includes(x) : on.includes(y)))}>${label}</button>`)}</div>`;
    } else if (kind === 'text') {
      body = html`<input type="text" aria-labelledby=${id} maxlength=${ps.max ?? 80} .value=${v == null ? '' : String(v)}
        placeholder=${ps.frame ? 'par exemple : Ce qui fleurit' : 'par exemple : Fontainebleau 77'}
        @change=${(/** @type {any} */ e) => set(cleanWords(e.target.value) || null)} />`;
    } else if (kind === 'id') {
      body = html`<input type="text" inputmode="numeric" aria-labelledby=${id} maxlength="9" .value=${v == null ? '' : String(v)} placeholder="la plante courante"
        @change=${(/** @type {any} */ e) => { const t = e.target.value.trim(); set(/^\d+$/.test(t) ? Number(t) : null); }} />
        ${this.plant && this.plant !== v ? html`<div class="seg"><button type="button" data-act="fix" @click=${() => set(this.plant)}>${icon('pin-angle-fill')} Fixer la plante courante</button></div>` : nothing}`;
    }
    return html`<div class="ctl" data-param=${key}><div class="name"><span id=${id}>${ps.label}</span>${note}</div>${body}</div>`;
  }

  /** Inline: the place's first level — the components, the sheet's blocks, the intents of the one chosen. */
  #inlineView() {
    const level = this._level === 'blocks' || (this._level === 'intent' && this._pending) ? this._level : 'content';
    const pending = this._pending ? /** @type {Known} */ (resolve(makeCell(this._pending.id))) : null;
    const lead = level === 'blocks' ? 'Fiche : un bloc' : level === 'intent' && pending ? `${pending.spec.title} : que montre-t-elle ?` : 'Choisir un bloc';
    return html`<div class="inline" data-level=${level} role="group" aria-label=${`${this.label} : ${lead}`}>
      <div class="ihead">${level !== 'content' ? html`<button type="button" class="icon-btn back" aria-label="Retour aux blocs" title="Retour"
        @click=${() => { this._pending = null; this.#go('content'); }}>${icon('arrow-left')}</button>` : nothing}<p class="lead">${lead}</p></div>
      ${level === 'content' ? this.#content() : level === 'blocks' ? this.#blocks() : pending ? this.#intents(pending) : nothing}
    </div>`;
  }

  render() {
    if (this.inline) return this.#inlineView();
    const r = this.#known();
    let level = /** @type {Level} */ (this._level ?? 'content');
    if ((level === 'settings' || level === 'group' || level === 'intent') && !r) level = 'content';
    if (level === 'intent' && r && !intentKey(r)) level = 'settings';
    const blocksOf = COMPONENTS.find(c => c.views);
    /** @type {{ label: string, to?: () => void }[]} */
    const crumbs = [{ label: this.label, to: level !== 'content' ? () => this.#go('content') : undefined }];
    if (level === 'blocks' && blocksOf) crumbs.push({ label: blocksOf.title });
    if (r && level !== 'content' && level !== 'blocks') {
      crumbs.push({ label: r.view ? `${r.spec.title} › ${r.view.title}` : r.spec.title, to: level !== 'settings' ? () => this.#go('settings') : undefined });
      if (level === 'intent') crumbs.push({ label: 'Intention' });
      if (level === 'group' && this._group) crumbs.push({ label: this._group });
    }
    const title = level === 'group' ? this._group ?? '' : level === 'settings' ? LEVEL_TITLE.settings : LEVEL_TITLE[level];
    return html`<section class="panel" role="dialog" aria-modal="false" aria-labelledby="pk-title" data-level=${level} @keydown=${(/** @type {KeyboardEvent} */ e) => this.#key(e)}>
      <header>
        <button type="button" class="icon-btn back" aria-label="Retour" title="Retour" ?hidden=${level === 'content'} @click=${() => this.#back()}>${icon('arrow-left')}</button>
        <nav aria-label="Fil d’Ariane"><ol class="crumbs">${crumbs.map((c, i) => html`<li>${c.to ? html`<button type="button" @click=${c.to}>${c.label}</button>`
          : html`<span aria-current=${i === crumbs.length - 1 ? 'location' : nothing}>${c.label}</span>`}</li>`)}</ol></nav>
        <button type="button" class="icon-btn close" aria-label="Fermer (Échap)" title="Fermer (Échap)" @click=${() => this.#fire('close')}>${icon('x-lg')}</button>
      </header>
      <h2 id="pk-title" tabindex="-1">${title}</h2>
      <div class="body">${level === 'content' ? this.#content() : level === 'blocks' ? this.#blocks()
        : level === 'intent' && r ? this.#intents(r) : level === 'group' && r && this._group ? this.#group(r, this._group) : r ? this.#settings(r) : nothing}</div>
    </section>`;
  }
}
customElements.define('gf-block-picker', GfBlockPicker);
