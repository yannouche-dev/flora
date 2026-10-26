// @ts-check
import { LitElement, html, css, nothing, repeat } from 'lit';
import { icon } from '../core/icons.js';

/**
 * `locked`: always shown and first (safety: Prudence in Usages) — no grip, its box ticked and greyed, nothing passes it.
 * @typedef {{ key: string, label: string, checked: boolean, locked?: boolean }} SortItem
 */

/**
 * An ordered list to rearrange: drag a row (mouse: the whole row; finger: its grip ⠿, the rest scrolls the page;
 * keyboard: ↑ ↓ on the grip) and tick it on or off. Rows only change their CSS order while dragging (the pressed
 * node stays put). A locked row (Prudence) is ticked and first: a padlock instead of its grip — touched, it says why
 * (written under the row, and read out) — and nothing passes it. Events (not bubbling, so a list inside another
 * stays its own): reorder {keys}, toggle {key, on}. Used by gf-plant-detail.js, personalising the sheet: a block's
 * sub-blocks, and « Barre d’actions ».
 */

export class GfSortableList extends LitElement {
  static properties = {
    items: { attribute: false },
    label: {},
    _sort: { state: true },
    /** The locked row whose padlock was touched: why it is locked, written under it. */
    _why: { state: true }
  };

  static styles = css`
    :host { display: block; }
    ol { margin: 0; padding: 0; list-style: none; font-size: 0.88rem; display: flex; flex-direction: column; gap: 2px; }
    li { border-radius: var(--gf-radius-sm); background: var(--gf-surface); }
    .row { display: flex; align-items: center; gap: 4px; padding: 2px 4px 2px 0; border-radius: var(--gf-radius-sm); cursor: grab; user-select: none; -webkit-user-select: none; }
    .row:hover { background: var(--gf-surface-2); }
    li.dragging { position: relative; z-index: 2; box-shadow: var(--gf-shadow-float); outline: 2px solid var(--gf-accent); }
    li.dragging .row { cursor: grabbing; }
    .n { min-width: 1.6em; text-align: right; color: var(--gf-text-muted); font-variant-numeric: tabular-nums; }
    button.icon {
      flex: none; width: 24px; height: 24px; min-height: 0; padding: 0; display: grid; place-items: center;
      border: 0; background: none; color: var(--gf-text-muted); cursor: pointer; border-radius: var(--gf-radius-sm); font: inherit;
    }
    button.icon:hover { color: var(--gf-text); background: var(--gf-surface-2); }
    button.icon:focus-visible, input:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .grip { cursor: grab; touch-action: none; }
    /* A locked row: its padlock where the grip is (touched: why), nothing to drag. */
    button.icon.lock { cursor: help; opacity: 0.75; font-size: 0.85rem; }
    li.locked .row { cursor: default; }
    .why { margin: 0 0 4px 28px; font-size: 0.8rem; color: var(--gf-text-muted); }
    .why:empty { display: none; }
    /* By finger the page scrolls through the list: drag by the grip, made a finger's size. */
    @media (pointer: coarse) { button.icon.grip, button.icon.lock { width: 44px; height: 44px; font-size: 1.05rem; } .why { margin-left: 48px; } }
    label { flex: 1; min-width: 0; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
    label input { flex: none; margin: 0; }
  `;

  constructor() {
    super();
    /** @type {SortItem[]} */
    this.items = [];
    this.label = '';
    /** @type {{ key: string, order: string[], dy: number } | null} */
    this._sort = null;
    /** @type {string | null} */
    this._why = null;
  }

  /** @param {string} type @param {object} detail */
  #emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  /** @param {string} key */
  #locked(key) { return Boolean(this.items.find(i => i.key === key)?.locked); }

  /** One place up or down; null at an end, or past a locked row (nothing passes it, by keyboard or drag). @param {string[]} order @param {string} key @param {-1 | 1} delta */
  #swap(order, key, delta) {
    const i = order.indexOf(key), j = i + delta;
    if (i < 0 || j < 0 || j >= order.length || this.#locked(key) || this.#locked(order[j])) return null;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  }

  get #keys() { return this.items.map(i => i.key); }

  /** @param {KeyboardEvent} e @param {string} key */
  async #gripKey(e, key) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const order = this.#swap(this.#keys, key, e.key === 'ArrowUp' ? -1 : 1);
    if (!order) return;
    this.#emit('reorder', { keys: order });
    // The owner saves, the store changes, the new items come down: then the grip is still the one focused.
    setTimeout(() => /** @type {HTMLElement | null} */ (this.renderRoot.querySelector(`li[data-key="${key}"] > .row .grip`))?.focus());
  }

  /** @type {{ key: string, y0: number, started: boolean } | null} */
  #drag = null;

  /** @param {PointerEvent} e @param {string} key */
  #press(e, key) {
    const target = /** @type {Element} */ (e.target);
    if (e.button !== 0 || this.#locked(key) || target.closest('input, button:not(.grip)')) return;
    // By finger, only the grip: elsewhere the touch scrolls the page.
    if (e.pointerType === 'touch' && !target.closest('.grip')) return;
    this.#drag = { key, y0: e.clientY, started: false };
    /** @type {Element} */ (e.currentTarget).setPointerCapture?.(e.pointerId);
    addEventListener('pointermove', this.#move);
    addEventListener('pointerup', this.#release);
    addEventListener('pointercancel', this.#release);
  }

  /** Middle of a row where it sits in the list (without the drag offset). @param {string} key */
  #mid(key) {
    const el = this.renderRoot.querySelector(`li[data-key="${key}"]`);
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return r.top + r.height / 2 - (this._sort?.key === key ? this._sort.dy : 0);
  }

  /** @param {PointerEvent} e */
  #move = async e => {
    const drag = this.#drag;
    if (!drag) return;
    const y = e.clientY;
    if (!drag.started) {
      if (Math.abs(y - drag.y0) < 5) return;
      drag.started = true;
      this._sort = { key: drag.key, order: this.#keys, dy: 0 };
      await this.updateComplete;
    }
    e.preventDefault();
    // Past several rows at once (a fast move): one place at a time until the pointer is between its neighbours.
    for (let step = 0; step < 40 && this._sort && this.#drag === drag; step++) {
      const sort = this._sort;
      const i = sort.order.indexOf(drag.key);
      let next = null;
      if (i > 0 && y < this.#mid(sort.order[i - 1])) next = this.#swap(sort.order, drag.key, -1);
      else if (i < sort.order.length - 1 && y > this.#mid(sort.order[i + 1])) next = this.#swap(sort.order, drag.key, 1);
      if (!next) break;
      this._sort = { ...sort, order: next };
      await this.updateComplete;
    }
    if (this._sort && this.#drag === drag) this._sort = { ...this._sort, dy: Math.round(y - this.#mid(drag.key)) };
  };

  /** @param {PointerEvent} e */
  #release = e => {
    removeEventListener('pointermove', this.#move);
    removeEventListener('pointerup', this.#release);
    removeEventListener('pointercancel', this.#release);
    const drag = this.#drag;
    const sort = this._sort;
    this.#drag = null;
    this._sort = null;
    if (!drag?.started || !sort) return;
    if (sort.order.join() !== this.#keys.join()) this.#emit('reorder', { keys: sort.order });
    // A drag that ends on the name is not a click on its checkbox.
    if (e.type === 'pointerup') addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); }, { capture: true, once: true });
  };

  disconnectedCallback() {
    super.disconnectedCallback();
    removeEventListener('pointermove', this.#move);
    removeEventListener('pointerup', this.#release);
    removeEventListener('pointercancel', this.#release);
  }

  /** @param {SortItem} item @param {number} slot */
  #row(item, slot) {
    const { key } = item;
    const sort = this._sort;
    const dragging = sort?.key === key;
    const locked = Boolean(item.locked);
    // Locked: the padlock says why when touched (a title alone is never read on a touch screen).
    const why = `« ${item.label} » reste affiché et en tête : sécurité`;
    return html`<li data-key=${key} class="${dragging ? 'dragging' : ''} ${locked ? 'locked' : ''}"
      style=${sort ? `order:${slot}${dragging ? `;transform:translateY(${sort.dy}px)` : ''}` : ''}>
      <div class="row" @pointerdown=${(/** @type {PointerEvent} */ e) => this.#press(e, key)}>
        ${locked
          ? html`<button class="icon lock" type="button" aria-label=${why} title="Reste affiché et en tête : sécurité"
              @click=${() => { this._why = this._why === key ? null : key; }}>${icon('lock-fill')}</button>`
          : html`<button class="icon grip" type="button" aria-label="Déplacer « ${item.label} »" title="Glisser pour déplacer (↑ ↓ au clavier)"
              @keydown=${(/** @type {KeyboardEvent} */ e) => this.#gripKey(e, key)}>${icon('grip-vertical')}</button>`}
        <span class="n">${slot + 1}.</span>
        <label>
          <input type="checkbox" .checked=${item.checked || locked} ?disabled=${locked}
            @change=${(/** @type {Event} */ e) => this.#emit('toggle', { key, on: /** @type {HTMLInputElement} */ (e.target).checked })} />
          <span>${item.label}</span>
        </label>
      </div>
      ${locked ? html`<p class="why" role="status">${this._why === key ? why : nothing}</p>` : nothing}
    </li>`;
  }

  render() {
    const order = this._sort?.order || this.#keys;
    // Keyed: a row keeps its node (and the focus of its grip) when it moves.
    return html`<ol aria-label=${this.label}>${repeat(this.items, item => item.key, item => this.#row(item, order.indexOf(item.key)))}</ol>`;
  }
}

customElements.define('gf-sortable-list', GfSortableList);
