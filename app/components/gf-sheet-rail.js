// @ts-check
// The rubrics of the plant sheet, one icon each (Noms, Images, Protection et risques, Saisons…): a touch goes to
// the rubric, hovering one lists its blocks. An icon can carry a count, like messages waiting: the alerts of
// the plant (protection, toxicity; for an edible plant, what it is mistaken for), red when it is a danger.
// A row (the header of the plant pane, the top of a narrow sheet) or a column (the left of a wide sheet);
// too many icons for the row: it scrolls, without a scrollbar.

import { LitElement, html, css, nothing } from 'lit';
import { icon } from '../core/icons.js';
import { ui } from '../styles/ui.js';

/**
 * @typedef {{ count: number, tone: 'danger' | 'warn', text: string[] }} Badge
 * @typedef {{ key: string, label: string, question: string, icon: string, blocks: { key: string, title: string, note?: string }[], badge?: Badge | null }} RailItem
 */

export class GfSheetRail extends LitElement {
  static properties = {
    /** @type {RailItem[]} */
    items: { attribute: false },
    /** The rubric lit (the one read). */
    active: {},
    /** 'row' or 'column'. */
    orientation: { reflect: true },
    /** The rubric whose blocks are listed (hover, focus). */
    _pop: { state: true }
  };

  static styles = [ui, css`
    :host { display: block; min-width: 0; }
    nav { display: flex; gap: 2px; align-items: center; }
    :host([orientation='row']) nav { overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain;
      mask-image: linear-gradient(90deg, #000 calc(100% - 14px), transparent); padding-right: 10px; }
    :host([orientation='row']) nav::-webkit-scrollbar { display: none; }
    :host([orientation='column']) nav { flex-direction: column; }
    .item { position: relative; flex: none; }
    .item > button { position: relative; width: 36px; height: 36px; min-height: 0; padding: 0; display: grid; place-items: center; border: 0; border-radius: var(--gf-radius-sm);
      background: none; color: var(--gf-text-muted); font-size: 1.05rem; cursor: pointer; }
    .item > button:hover { background: var(--gf-surface-2); color: var(--gf-text); }
    .item > button.on { background: var(--gf-accent-soft); color: var(--gf-accent); }
    .item > button:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    /* Alerts: the icon takes the colour, a count in its corner. */
    .item > button.warn { color: var(--gf-warn); }
    .item > button.danger { color: var(--gf-danger); }
    .badge { position: absolute; top: 1px; right: 0; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; display: grid; place-items: center;
      font-size: 0.62rem; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; color: #fff; background: var(--gf-warn);
      box-shadow: 0 0 0 2px var(--gf-surface); pointer-events: none; }
    .danger .badge { background: var(--gf-danger); }
    /* The blocks of a rubric: over everything (fixed), never cut by a scrolling row. */
    .pop { position: fixed; z-index: 60; min-width: 210px; max-width: 300px; padding: 6px; background: var(--gf-surface); border: 1px solid var(--gf-border);
      border-radius: var(--gf-radius); box-shadow: var(--gf-shadow-float); }
    .pop strong { display: block; padding: 2px 8px 4px; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--gf-text-muted); }
    .pop button { display: block; width: 100%; text-align: left; border: 0; background: none; padding: 6px 8px; border-radius: var(--gf-radius-sm); font: inherit; font-size: 0.9rem; color: var(--gf-text); cursor: pointer; }
    .pop button:hover, .pop button:focus-visible { background: var(--gf-accent-soft); outline: none; }
    .pop ul { margin: 2px 0 6px; padding: 0 8px 0 24px; font-size: 0.8rem; }
    .pop li { margin: 2px 0; }
    .pop .alerts.danger { color: var(--gf-danger); } .pop .alerts.warn { color: var(--gf-warn); }
  `];

  constructor() {
    super();
    /** @type {RailItem[]} */
    this.items = [];
    /** @type {string | null} */
    this.active = null;
    this.orientation = 'row';
    /** @type {{ key: string, x: number, y: number } | null} */
    this._pop = null;
  }

  /** @param {string} key */
  #go(key) {
    this._pop = null;
    this.dispatchEvent(new CustomEvent('rail-go', { detail: { key }, bubbles: true, composed: true }));
  }

  /** @param {string} key @param {Event} e */
  #open(key, e) {
    if (!matchMedia('(hover: hover)').matches && e.type !== 'focusin') return;
    clearTimeout(this.#closing);
    const r = /** @type {HTMLElement} */ (e.currentTarget).getBoundingClientRect();
    const row = this.orientation === 'row';
    const x = Math.min(row ? r.left : r.right + 6, innerWidth - 220);
    this._pop = { key, x: Math.max(4, x), y: row ? r.bottom + 4 : r.top };
  }

  #close() { clearTimeout(this.#closing); this.#closing = setTimeout(() => { this._pop = null; }, 160); }
  /** @type {any} */ #closing = 0;

  /** « fixed » is relative to the nearest contained ancestor (a pane, a container): the pop goes where asked. */
  updated() {
    const pop = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.pop'));
    if (!pop || !this._pop || pop.dataset.at === `${this._pop.x},${this._pop.y}`) return;
    const r = pop.getBoundingClientRect();
    pop.style.left = this._pop.x - (r.left - parseFloat(pop.style.left)) + 'px';
    pop.style.top = this._pop.y - (r.top - parseFloat(pop.style.top)) + 'px';
    pop.dataset.at = `${this._pop.x},${this._pop.y}`;
  }

  render() {
    if (!this.items.length) return nothing;
    const pop = this._pop && this.items.find(i => i.key === this._pop?.key);
    return html`<nav aria-label="Aller à une rubrique de la fiche">${this.items.map(c => {
      const b = c.badge;
      const label = c.label + (b ? ` — ${b.count} alerte${b.count > 1 ? 's' : ''}` : '');
      return html`<div class="item" @mouseenter=${(/** @type {Event} */ e) => this.#open(c.key, e)} @mouseleave=${() => this.#close()}
          @focusin=${(/** @type {Event} */ e) => this.#open(c.key, e)} @focusout=${() => this.#close()}>
        <button type="button" class="${this.active === c.key ? 'on' : ''} ${b ? b.tone : ''}" title=${c.label + ' — ' + c.question + (b ? '\n' + b.text.join('\n') : '')}
          aria-label=${label} aria-current=${this.active === c.key ? 'true' : 'false'} data-key=${c.key}
          @click=${() => c.blocks[0] && this.#go(c.blocks[0].key)}>${icon(/** @type {any} */ (c.icon))}${b ? html`<span class="badge" aria-hidden="true">${b.count}</span>` : nothing}</button>
      </div>`;
    })}</nav>
    ${pop && this._pop ? html`<div class="pop" role="menu" aria-label=${pop.label} style=${`left:${this._pop.x}px;top:${this._pop.y}px`}
        @mouseenter=${() => clearTimeout(this.#closing)} @mouseleave=${() => this.#close()} @focusin=${() => clearTimeout(this.#closing)} @focusout=${() => this.#close()}>
      <strong>${pop.label}</strong>
      ${pop.badge ? html`<ul class="alerts ${pop.badge.tone}">${pop.badge.text.map(t => html`<li>${t}</li>`)}</ul>` : nothing}
      ${pop.blocks.map(k => html`<button type="button" role="menuitem" @click=${() => this.#go(k.key)}>${k.title}${k.note ? html` <small>(${k.note})</small>` : nothing}</button>`)}
    </div>` : nothing}`;
  }
}

customElements.define('gf-sheet-rail', GfSheetRail);
