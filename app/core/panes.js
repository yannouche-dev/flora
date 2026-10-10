// @ts-check
// Panes of a layout (Mes plantes, the Carte's place panel…), as in Flore: each one resizable by dragging its
// separator (a guide line follows the pointer; the pane takes its width on release), with ← → on the focused
// separator, a double click giving back the default width, and a fold button (« ») turning it into a narrow
// rail with its title written vertically. Widths and folds are remembered per layout.

import { html, css, nothing } from 'lit';

/** @typedef {{ widths: Record<string, number>, folded: Record<string, boolean> }} PaneState */

/** Styles shared by these layouts (the same head, separators and rails as Flore's). */
export const paneStyles = css`
  .pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--gf-surface); }
  .pane-head {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 40px;
    padding: 2px 4px 2px 14px;
    border-bottom: 1px solid var(--gf-border);
    background: var(--gf-surface);
  }
  .pane-head h2 { margin: 0; min-width: 0; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--gf-text-muted); flex: 1; display: flex; gap: 8px; align-items: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pane-head .icon-btn { width: 32px; height: 32px; font-size: 1rem; flex: none; }
  .guide { position: absolute; top: 0; bottom: 0; left: -1px; width: 3px; background: var(--gf-accent); z-index: 5; pointer-events: none; will-change: transform; }
  .guide span { position: absolute; top: 50%; left: 8px; padding: 2px 8px; border-radius: var(--gf-radius-pill); background: var(--gf-accent); color: var(--gf-accent-contrast); font-size: 0.75rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .split { flex: none; width: 7px; margin: 0 -3px; z-index: 3; cursor: col-resize; position: relative; touch-action: none; }
  .split::after { content: ''; position: absolute; inset: 0 3px; background: var(--gf-border); transition: background 0.12s; }
  .split:hover::after, .split:focus-visible::after, .split.dragging::after { background: var(--gf-accent); inset: 0 2px; }
  .split:focus-visible { outline: none; }
  :host(.resizing) { cursor: col-resize; user-select: none; }
  .rail {
    flex: none; width: 40px; min-height: 0; border: 0; border-radius: 0; border-right: 1px solid var(--gf-border);
    background: var(--gf-surface); writing-mode: vertical-rl; padding: 14px 0; justify-content: flex-start; gap: 8px;
    font-size: 0.8rem; font-weight: 600; color: var(--gf-text-muted); box-shadow: none;
  }
  .rail.right { border-right: 0; border-left: 1px solid var(--gf-border); }
  .rail:hover { color: var(--gf-text); background: var(--gf-surface-2); }
`;

/**
 * Widths and folds of a layout's panes, saved under `storageKey`.
 * @implements {import('lit').ReactiveController}
 */
export class PaneSizer {
  /**
   * @param {import('lit').ReactiveControllerHost & HTMLElement & { renderRoot: ParentNode }} host
   * @param {string} storageKey
   * @param {Record<string, { width: number, min: number, title: string }>} panes
   */
  constructor(host, storageKey, panes) {
    this.host = host;
    this.key = storageKey;
    this.panes = panes;
    /** @type {PaneState} */
    this.state = { widths: {}, folded: {} };
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved && typeof saved === 'object') this.state = { widths: { ...saved.widths }, folded: { ...saved.folded } };
    } catch { /* defaults */ }
    host.addController(this);
  }

  hostConnected() {}

  #save() {
    try { localStorage.setItem(this.key, JSON.stringify(this.state)); } catch { /* not remembered */ }
    this.host.requestUpdate();
  }

  /** @param {string} pane */
  width(pane) { return this.state.widths[pane] ?? this.panes[pane].width; }

  /** @param {string} pane */
  folded(pane) { return this.state.folded[pane] === true; }

  /** @param {string} pane @param {boolean} on */
  fold(pane, on) {
    this.state = { ...this.state, folded: { ...this.state.folded, [pane]: on } };
    this.#save();
  }

  /** @param {string} pane @param {number} w */
  setWidth(pane, w) {
    this.state = { ...this.state, widths: { ...this.state.widths, [pane]: Math.round(w) } };
    this.#save();
  }

  /** The pane's head: its title, extra controls, and the fold button. @param {string} pane @param {unknown} title @param {unknown} [extra] @param {boolean} [right] */
  head(pane, title, extra = nothing, right = false) {
    const t = this.panes[pane].title;
    return html`<div class="pane-head">
      <h2>${title}</h2>
      ${extra}
      <button class="icon-btn fold" type="button" aria-expanded="true" title=${'Replier : ' + t}
        aria-label=${'Replier le panneau ' + t.toLowerCase()} @click=${() => this.fold(pane, true)}>${right ? '»' : '«'}</button>
    </div>`;
  }

  /** A folded pane: a narrow rail, its title written vertically; touching it unfolds it. @param {string} pane @param {boolean} [right] */
  rail(pane, right = false) {
    const t = this.panes[pane].title;
    return html`<button class="rail ${right ? 'right' : ''}" type="button" aria-expanded="false" data-pane=${pane}
      title=${'Déplier : ' + t} @click=${() => this.fold(pane, false)}>${right ? '‹' : '›'} ${t}</button>`;
  }

  /**
   * The separator that resizes `pane`. `side`: where the pane is, left or right of the separator.
   * `max()`: the widest it may be now (the other panes keep their minimum).
   * @param {string} pane @param {'left' | 'right'} side @param {() => number} max
   */
  split(pane, side, max) {
    const t = this.panes[pane].title;
    const clamp = (/** @type {number} */ w) => Math.round(Math.min(Math.max(this.panes[pane].min, max()), Math.max(this.panes[pane].min, w)));
    return html`<div class="split" role="separator" aria-orientation="vertical" tabindex="0" data-pane=${pane}
      aria-label=${'Largeur du panneau ' + t.toLowerCase()} aria-valuenow=${this.width(pane)} aria-valuemin=${this.panes[pane].min}
      title="Glisser pour redimensionner · double-clic : largeur par défaut"
      @pointerdown=${(/** @type {PointerEvent} */ e) => this.#drag(e, pane, side, clamp)}
      @keydown=${(/** @type {KeyboardEvent} */ e) => {
        const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        this.setWidth(pane, clamp(this.width(pane) + (side === 'left' ? dir : -dir) * (e.shiftKey ? 64 : 16)));
      }}
      @dblclick=${() => { const widths = { ...this.state.widths }; delete widths[pane]; this.state = { ...this.state, widths }; this.#save(); }}></div>`;
  }

  /**
   * Dragging moves a guide line only; the pane takes its width once, on release (re-laying out maps and
   * sheets on every frame is slow). @param {PointerEvent} e @param {string} pane @param {'left' | 'right'} side @param {(w: number) => number} clamp
   */
  #drag(e, pane, side, clamp) {
    if (e.button !== 0) return;
    const handle = /** @type {HTMLElement} */ (e.currentTarget);
    const box = /** @type {HTMLElement | null} */ (handle.parentElement);
    const el = /** @type {HTMLElement | null} */ (side === 'left' ? handle.previousElementSibling : handle.nextElementSibling);
    if (!box || !el) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    this.host.classList.add('resizing');
    const area = box.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const x0 = e.clientX;
    const w0 = Math.round(rect.width);
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
    const guide = document.createElement('div');
    guide.className = 'guide';
    const label = guide.appendChild(document.createElement('span'));
    box.append(guide);
    let width = w0;
    let frame = 0;
    const paint = () => {
      frame = 0;
      const edge = side === 'left' ? rect.left + width : rect.right - width;
      guide.style.transform = `translateX(${Math.round(edge - area.left)}px)`;
      label.textContent = width + ' px';
    };
    paint();
    const move = (/** @type {PointerEvent} */ ev) => {
      const dx = ev.clientX - x0;
      width = clamp(side === 'left' ? w0 + dx : w0 - dx);
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const end = () => {
      cancelAnimationFrame(frame);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      handle.classList.remove('dragging');
      this.host.classList.remove('resizing');
      guide.remove();
      if (width !== w0) this.setWidth(pane, width);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }
}
