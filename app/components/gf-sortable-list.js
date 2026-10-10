// @ts-check
import { LitElement, html, css, nothing, repeat } from 'lit';
import { icon } from '../core/icons.js';

/**
 * @typedef {{ key: string, label: string, note?: string, checked: boolean, renamable?: boolean, removable?: boolean, nested?: boolean,
 *   choices?: { key: string, label: string }[], choice?: string, titled?: boolean, emptyHidden?: boolean, place?: string, tag?: string }} SortItem
 */

/**
 * An ordered list to rearrange: drag a row (mouse: the whole row; finger: its grip ⠿, the rest scrolls the page;
 * keyboard: ↑ ↓ on the grip), tick it on or off, rename it ✎, remove it ✕, open what it holds (« Sous-blocs »,
 * from `renderNested(key)`). Rows only change their CSS order while dragging (the pressed node stays put).
 * A row may offer a choice (a block's style). Events (not bubbling, so a list inside another stays its own):
 * reorder {keys}, toggle {key, on}, rename {key, title}, remove {key}, choose {key, value}, titled {key, shown},
 * empty {key, hidden}, pin {key, on} (a row with `titled` defined gets a « title shown » switch; with `emptyHidden`, a « left out when empty »
 * one; with `place`, where the block sits: in the sheet, on an edge of the plant pane, or beside it).
 */
/** Where a block sits (sheet-blocks.js › PLACES), for the « Position » list. */
const PLACE_OPTIONS = [['', 'Dans la fiche'], ['top', 'En haut'], ['bottom', 'En bas'], ['left', 'À gauche'], ['right', 'À droite'], ['beside', 'À côté']];

export class GfSortableList extends LitElement {
  static properties = {
    items: { attribute: false },
    label: {},
    renderNested: { attribute: false },
    _sort: { state: true },
    _open: { state: true },
    _editing: { state: true }
  };

  static styles = css`
    :host { display: block; }
    .tag { display: inline-block; margin-left: 4px; padding: 0 7px; border-radius: 999px; background: var(--gf-surface-2); color: var(--gf-text-muted); font-size: 0.7rem; font-weight: 600; white-space: nowrap; }
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
    button.icon[aria-expanded='true'], button.icon[aria-pressed='true'] { color: var(--gf-accent); }
    button.icon[aria-pressed='false'] { opacity: 0.45; }
    .grip { cursor: grab; touch-action: none; }
    /* By finger the page scrolls through the list: drag by the grip, made bigger. */
    @media (pointer: coarse) { .grip { width: 34px; height: 34px; font-size: 1.05rem; } }
    label { flex: 1; min-width: 0; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
    label input { flex: none; margin: 0; }
    .muted { color: var(--gf-text-muted); font-size: 0.8em; }
    .edit { flex: 1; min-width: 0; font: inherit; padding: 2px 6px; border: 1px solid var(--gf-accent); border-radius: var(--gf-radius-sm); background: var(--gf-surface); color: var(--gf-text); }
    select.choice, select.place { flex: none; min-height: 0; font: inherit; font-size: 0.8rem; padding: 1px 4px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-sm); background: var(--gf-surface); color: var(--gf-text); }
    .nested { margin: 2px 0 6px 30px; padding-left: 8px; border-left: 2px solid var(--gf-border); }
  `;

  constructor() {
    super();
    /** @type {SortItem[]} */
    this.items = [];
    this.label = '';
    /** @type {((key: string) => unknown) | null} */
    this.renderNested = null;
    /** @type {{ key: string, order: string[], dy: number } | null} */
    this._sort = null;
    /** @type {Set<string>} */
    this._open = new Set();
    /** @type {string | null} */
    this._editing = null;
  }

  /** @param {string} type @param {object} detail */
  #emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  /** @param {string[]} order @param {string} key @param {-1 | 1} delta */
  #swap(order, key, delta) {
    const i = order.indexOf(key), j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return null;
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
    if (e.button !== 0 || this._editing || target.closest('input, select, button:not(.grip)')) return;
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

  /** @param {string} key */
  #toggleOpen(key) {
    const open = new Set(this._open);
    if (open.has(key)) open.delete(key); else open.add(key);
    this._open = open;
  }

  /** @param {string} key @param {HTMLInputElement} input @param {boolean} keep */
  #finishEdit(key, input, keep) {
    if (this._editing !== key) return;
    this._editing = null;
    if (keep) this.#emit('rename', { key, title: input.value });
  }

  /** @param {SortItem} item @param {number} slot */
  #row(item, slot) {
    const { key } = item;
    const sort = this._sort;
    const dragging = sort?.key === key;
    const open = this._open.has(key);
    const editing = this._editing === key;
    return html`<li data-key=${key} class=${dragging ? 'dragging' : ''}
      style=${sort ? `order:${slot}${dragging ? `;transform:translateY(${sort.dy}px)` : ''}` : ''}>
      <div class="row" @pointerdown=${(/** @type {PointerEvent} */ e) => this.#press(e, key)}>
        <button class="icon grip" type="button" aria-label="Déplacer « ${item.label} »" title="Glisser pour déplacer (↑ ↓ au clavier)"
          @keydown=${(/** @type {KeyboardEvent} */ e) => this.#gripKey(e, key)}>${icon('grip-vertical')}</button>
        <span class="n">${slot + 1}.</span>
        ${editing ? html`<input class="edit" aria-label="Nouveau nom de « ${item.label} »" .value=${item.label} maxlength="60"
            @keydown=${(/** @type {KeyboardEvent} */ e) => {
              if (e.key === 'Enter') this.#finishEdit(key, /** @type {HTMLInputElement} */ (e.target), true);
              else if (e.key === 'Escape') this.#finishEdit(key, /** @type {HTMLInputElement} */ (e.target), false);
            }}
            @blur=${(/** @type {FocusEvent} */ e) => this.#finishEdit(key, /** @type {HTMLInputElement} */ (e.target), true)} />`
          : html`<label>
            <input type="checkbox" .checked=${item.checked} @change=${(/** @type {Event} */ e) => this.#emit('toggle', { key, on: /** @type {HTMLInputElement} */ (e.target).checked })} />
            <span>${item.label}${item.tag ? html` <span class="tag">${item.tag}</span>` : nothing}${item.note ? html` <span class="muted">${item.note}</span>` : nothing}</span>
          </label>`}
        ${item.choices ? html`<select class="choice" aria-label="Style de « ${item.label} »" title="Style"
          @change=${(/** @type {Event} */ e) => this.#emit('choose', { key, value: /** @type {HTMLSelectElement} */ (e.target).value })}>
          ${item.choices.map(c => html`<option value=${c.key} ?selected=${c.key === item.choice}>${c.label}</option>`)}
        </select>` : nothing}
        ${item.titled !== undefined ? html`<button class="icon" type="button" aria-pressed=${item.titled ? 'true' : 'false'}
          aria-label=${(item.titled ? 'Masquer' : 'Montrer') + ` le titre « ${item.label} »`} title=${item.titled ? 'Titre affiché' : 'Titre caché'}
          @click=${() => this.#emit('titled', { key, shown: !item.titled })}>${icon('type-h2')}</button>` : nothing}
        ${item.emptyHidden !== undefined ? html`<button class="icon" type="button" aria-pressed=${item.emptyHidden ? 'true' : 'false'}
          aria-label=${item.emptyHidden ? `Afficher « ${item.label} » même vide` : `Ne pas afficher « ${item.label} » s’il est vide`}
          title=${item.emptyHidden ? 'Masqué quand il est vide' : 'Affiché même vide'}
          @click=${() => this.#emit('empty', { key, hidden: !item.emptyHidden })}>${icon('eye-slash')}</button>` : nothing}
        ${item.place !== undefined ? html`<select class="place" aria-label=${'Position de « ' + item.label + ' »'} title="Position dans le panneau Plante"
          @change=${(/** @type {any} */ e) => this.#emit('place', { key, place: e.target.value })}>
          ${PLACE_OPTIONS.map(([v, l]) => html`<option value=${v} ?selected=${item.place === v}>${l}</option>`)}</select>` : nothing}
        ${item.nested ? html`<button class="icon" type="button" aria-expanded=${open ? 'true' : 'false'} aria-label="Sous-blocs de « ${item.label} »" title="Sous-blocs"
          @click=${() => this.#toggleOpen(key)}>${icon('list-nested')}</button>` : nothing}
        ${item.renamable && !editing ? html`<button class="icon" type="button" aria-label="Renommer « ${item.label} »" title="Renommer"
          @click=${async () => { this._editing = key; await this.updateComplete; const input = /** @type {HTMLInputElement | null} */ (this.renderRoot.querySelector('input.edit')); input?.focus(); input?.select(); }}>${icon('pencil')}</button>` : nothing}
        ${item.removable ? html`<button class="icon" type="button" aria-label="Supprimer « ${item.label} »" title="Supprimer"
          @click=${() => this.#emit('remove', { key })}>${icon('x-lg')}</button>` : nothing}
      </div>
      ${item.nested && open && this.renderNested ? html`<div class="nested">${this.renderNested(key)}</div>` : nothing}
    </li>`;
  }

  render() {
    const order = this._sort?.order || this.#keys;
    // Keyed: a row keeps its node (and the focus of its grip) when it moves.
    return html`<ol aria-label=${this.label}>${repeat(this.items, item => item.key, item => this.#row(item, order.indexOf(item.key)))}</ol>`;
  }
}

customElements.define('gf-sortable-list', GfSortableList);
