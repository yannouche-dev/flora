// @ts-check
// Mode King: dragging a block to arrange the tree of panes (pane-tree.js). Over a pane or the sheet, near a
// side: a new pane there (the half it would take is shaded); in a pane's middle: one of its tabs; in the
// sheet's middle: back in the sheet, at the line shown between two blocks; on the frame's outer border: a band
// or a column across the whole plant pane. Escape cancels. One controller for the sheet and for Réglages.

/**
 * @typedef {{ key: string, target: string, zone: import('./pane-tree.js').Zone | 'sheet', beforeKey: string | null }} DockDrop
 * @typedef {{ root: ShadowRoot | Document | Element, key: string, label: string, onDrop: (drop: DockDrop) => void,
 *   onStart?: () => void, onEnd?: () => void, sheetFallback?: Element | null }} DockDragOptions
 */

const THRESHOLD = 5;
/** Near a side: within this share of the target (and at most this many px). */
const SIDE_SHARE = 0.25, SIDE_MAX = 90;
/** The frame's outer border, for a band or a column across the whole pane. */
const ROOT_EDGE = 12;

/** The scrolling box of an element (across shadow roots). @param {Element} el */
function scrollerOf(el) {
  /** @type {any} */ let n = el;
  while (n) {
    if (n instanceof Element && /auto|scroll/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight) return n;
    n = n.parentNode || n.host;
  }
  return document.scrollingElement;
}

/**
 * Starts watching a press: past a few px it becomes a drag of `key`.
 * @param {PointerEvent} e @param {DockDragOptions} opts
 */
export function pressDock(e, opts) {
  if (e.button !== 0) return;
  const x0 = e.clientX, y0 = e.clientY;
  /** @type {null | { ghost: HTMLElement, hint: HTMLElement, drop: DockDrop | null, scroller: Element | null }} */
  let drag = null;
  const host = /** @type {HTMLElement} */ (opts.root instanceof ShadowRoot ? opts.root : document.body);

  const start = () => {
    const ghost = document.createElement('div');
    ghost.className = 'dock-ghost';
    ghost.textContent = opts.label;
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.cssText = 'position:fixed;z-index:2000;pointer-events:none;padding:4px 10px;border-radius:999px;background:var(--gf-accent,#2e7d32);color:#fff;font:600 0.8rem system-ui,sans-serif;box-shadow:0 6px 18px rgb(0 0 0/30%);white-space:nowrap;transform:translate(12px,12px)';
    const hint = document.createElement('div');
    hint.className = 'drop-hint';
    hint.style.cssText = 'position:fixed;z-index:1999;pointer-events:none;border:2px solid var(--gf-accent,#2e7d32);background:color-mix(in srgb,var(--gf-accent,#2e7d32) 16%,transparent);border-radius:6px;transition:all 0.08s ease-out;display:none';
    host.append(hint, ghost);
    drag = { ghost, hint, drop: null, scroller: null };
    opts.onStart?.();
  };

  /** @param {PointerEvent} ev */
  const move = ev => {
    if (!drag) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < THRESHOLD) return;
      start();
    }
    ev.preventDefault();
    const d = /** @type {NonNullable<typeof drag>} */ (drag);
    d.ghost.style.left = ev.clientX + 'px';
    d.ghost.style.top = ev.clientY + 'px';
    const found = locate(opts, ev.clientX, ev.clientY);
    d.drop = found && found.drop;
    if (found) Object.assign(d.hint.style, { display: 'block', left: found.rect.left + 'px', top: found.rect.top + 'px', width: found.rect.width + 'px', height: found.rect.height + 'px' });
    else d.hint.style.display = 'none';
    // Near the top or bottom of what scrolls under the pointer: it scrolls.
    const target = found?.el;
    const sc = target ? scrollerOf(target) : null;
    if (sc && sc !== document.scrollingElement) {
      const b = sc.getBoundingClientRect();
      if (ev.clientY < b.top + 36) sc.scrollTop -= 14; else if (ev.clientY > b.bottom - 36) sc.scrollTop += 14;
    }
  };

  const end = (/** @type {boolean} */ commit) => {
    removeEventListener('pointermove', move, true);
    removeEventListener('pointerup', up, true);
    removeEventListener('pointercancel', cancel, true);
    removeEventListener('keydown', key, true);
    if (!drag) return;
    const d = drag;
    drag = null;
    d.ghost.remove(); d.hint.remove();
    opts.onEnd?.();
    if (commit && d.drop) opts.onDrop(d.drop);
  };
  const up = () => end(true);
  const cancel = () => end(false);
  /** @param {KeyboardEvent} ev */
  const key = ev => { if (ev.key === 'Escape' && drag) { ev.preventDefault(); ev.stopPropagation(); end(false); } };
  addEventListener('pointermove', move, true);
  addEventListener('pointerup', up, true);
  addEventListener('pointercancel', cancel, true);
  addEventListener('keydown', key, true);
}

/**
 * What is under the pointer, and what dropping there does.
 * @param {DockDragOptions} opts @param {number} x @param {number} y
 * @returns {{ el: Element, rect: { left: number, top: number, width: number, height: number }, drop: DockDrop } | null}
 */
function locate(opts, x, y) {
  const nodes = /** @type {HTMLElement[]} */ ([...opts.root.querySelectorAll('[data-drop-node]')]);
  if (!nodes.some(n => n.dataset.dropNode === 'sheet') && opts.sheetFallback) {
    /** @type {any} */ (opts.sheetFallback).dataset.dropNode = 'sheet';
    nodes.push(/** @type {HTMLElement} */ (opts.sheetFallback));
  }
  const inside = (/** @type {DOMRect} */ r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  // The frame's outer border first: across the whole pane.
  const root = nodes.find(n => n.dataset.dropNode === 'root');
  if (root) {
    const r = root.getBoundingClientRect();
    if (inside(r)) {
      const side = x - r.left < ROOT_EDGE ? 'left' : r.right - x < ROOT_EDGE ? 'right' : y - r.top < ROOT_EDGE ? 'top' : r.bottom - y < ROOT_EDGE ? 'bottom' : null;
      if (side) return { el: root, rect: half(r, side, 0.3), drop: { key: opts.key, target: 'root', zone: side, beforeKey: null } };
    }
  }
  // The innermost pane (or the sheet) under the pointer.
  const under = nodes.filter(n => n.dataset.dropNode !== 'root' && inside(n.getBoundingClientRect()));
  const el = under[under.length - 1];
  if (!el) return null;
  const id = /** @type {string} */ (el.dataset.dropNode);
  const r = el.getBoundingClientRect();
  const near = Math.min(SIDE_MAX, r.width * SIDE_SHARE), nearY = Math.min(SIDE_MAX, r.height * SIDE_SHARE);
  const side = x - r.left < near ? 'left' : r.right - x < near ? 'right' : y - r.top < nearY ? 'top' : r.bottom - y < nearY ? 'bottom' : null;
  if (side) return { el, rect: half(r, side, 0.42), drop: { key: opts.key, target: id, zone: side, beforeKey: null } };
  if (id !== 'sheet') {
    // Over its tabs: among them; elsewhere: the last tab.
    const tabs = /** @type {HTMLElement[]} */ ([...el.querySelectorAll('.edge-tabs [data-drag-key]')]);
    const bar = el.querySelector('.edge-tabs')?.getBoundingClientRect();
    if (bar && y >= bar.top && y <= bar.bottom && tabs.length) {
      let i = tabs.findIndex(t => { const b = t.getBoundingClientRect(); return x < b.left + b.width / 2; });
      if (i < 0) i = tabs.length;
      const ref = (tabs[i] || tabs[tabs.length - 1]).getBoundingClientRect();
      const lx = tabs[i] ? ref.left - 2 : ref.right + 1;
      return { el, rect: { left: lx, top: bar.top, width: 3, height: bar.height }, drop: { key: opts.key, target: id, zone: { tab: i }, beforeKey: null } };
    }
    return { el, rect: { left: r.left + 6, top: r.top + 6, width: r.width - 12, height: r.height - 12 }, drop: { key: opts.key, target: id, zone: 'center', beforeKey: null } };
  }
  // In the sheet: back in its flow, before the block whose middle is below the pointer.
  const blocks = /** @type {HTMLElement[]} */ ([...el.querySelectorAll('.blocks > .block')]).filter(b => b.dataset.key !== opts.key);
  const next = blocks.find(b => { const br = b.getBoundingClientRect(); return y < br.top + br.height / 2; });
  const line = next ? next.getBoundingClientRect().top - 2 : (blocks.length ? blocks[blocks.length - 1].getBoundingClientRect().bottom + 2 : r.top + 8);
  return { el, rect: { left: r.left + 8, top: line, width: r.width - 16, height: 3 }, drop: { key: opts.key, target: 'sheet', zone: 'sheet', beforeKey: next?.dataset.key || null } };
}

/** The part of a box a new pane on that side would take. @param {DOMRect} r @param {string} side @param {number} f */
function half(r, side, f) {
  if (side === 'left') return { left: r.left, top: r.top, width: r.width * f, height: r.height };
  if (side === 'right') return { left: r.right - r.width * f, top: r.top, width: r.width * f, height: r.height };
  if (side === 'top') return { left: r.left, top: r.top, width: r.width, height: r.height * f };
  return { left: r.left, top: r.bottom - r.height * f, width: r.width, height: r.height * f };
}
