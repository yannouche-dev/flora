// @ts-check
// The grip between two parts of a split that share its room by weights (flex), in a row (side by side) or a column
// (one under the other): the plant sheet's tree of panes (gf-plant-detail) and the free layouts (app/layout). One way
// to use it everywhere: drag it (its two neighbours follow live, kept on release; each keeps its own minimum width or
// height, else 60 px), ← → in a row or ↑ ↓ in a column (5 %, Maj : 20 %), Début / Fin (as far as it goes), Entrée or
// a double click (equal shares). A 1 px line, the accent on hover and focus, 44 px to hold with a finger and a tab in
// its middle (as core/panes.js' separators). Its parent has the class `split` and `row` or `col`; the parts beside it
// the class `cell` (or the one given).

import { html, css } from 'lit';

/** The least share of a part beside a grip, by the keyboard (a drag keeps each part's own minimum in px). */
export const MIN_SHARE = 0.08;

/** The grips' look, in the host's styles (its splits: `.split.row`, `.split.col`). */
export const gripStyles = css`
  .split-grip { flex: none; position: relative; z-index: 8; background: var(--gf-border); touch-action: none; }
  .split.row > .split-grip { width: 1px; cursor: col-resize; }
  .split.col > .split-grip { height: 1px; cursor: row-resize; }
  .split-grip::before { content: ''; position: absolute; inset: -5px; }
  .split-grip::after { content: ''; position: absolute; background: transparent; transition: background 0.12s; }
  .split.row > .split-grip::after { top: 0; bottom: 0; left: -1px; width: 3px; }
  .split.col > .split-grip::after { left: 0; right: 0; top: -1px; height: 3px; }
  .split-grip:hover::after, .split-grip:focus-visible::after, .split-grip.dragging::after { background: var(--gf-accent); }
  .split-grip:focus-visible { outline: none; }
  /* A finger: a 44 px grip (a touch target), and a tab to hold in the middle (as core/panes.js). */
  @media (pointer: coarse) {
    .split-grip::before { inset: -22px; }
    .split.row > .split-grip:not(:hover):not(:focus-visible)::after, .split.col > .split-grip:not(:hover):not(:focus-visible)::after {
      inset: auto; top: 50%; left: 50%; width: 10px; height: 44px; translate: -50% -50%; border-radius: 5px;
      background: var(--gf-surface); border: 1px solid var(--gf-border); box-shadow: 0 1px 4px rgb(0 0 0 / 18%); }
    .split.col > .split-grip:not(:hover):not(:focus-visible)::after { width: 44px; height: 10px; }
  }
`;

/** @param {number[]} sizes */
const unit = sizes => { const t = sizes.reduce((a, b) => a + b, 0) || 1; return sizes.map(s => s / t); };

/**
 * Dragging the grip between the parts `i - 1` and `i` of a split: their shares follow the pointer (flex-grow, live),
 * and `done` gets the new shares (summing to 1) on release, when they changed.
 * @param {PointerEvent} e @param {'row' | 'col'} dir @param {number[]} sizes @param {number} i @param {(sizes: number[]) => void} done
 * @param {string} [part] the class of the parts beside the grip
 */
export function dragShares(e, dir, sizes, i, done, part = 'cell') {
  if (e.button !== 0) return;
  const grip = /** @type {HTMLElement} */ (e.currentTarget);
  const split = /** @type {HTMLElement} */ (grip.parentElement);
  const cells = /** @type {HTMLElement[]} */ ([...split.children].filter(c => c.classList.contains(part)));
  const a = cells[i - 1], b = cells[i];
  if (!a || !b) return;
  e.preventDefault();
  try { grip.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
  grip.classList.add('dragging');
  const row = dir === 'row';
  const start = row ? e.clientX : e.clientY;
  const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
  const pa = row ? ra.width : ra.height, pb = row ? rb.width : rb.height;
  // Each side keeps its own minimum (the media's pane: room for its viewer), else 60 px.
  const least = (/** @type {HTMLElement} */ c) => Math.max(60, parseFloat(getComputedStyle(c)[row ? 'minWidth' : 'minHeight']) || 0);
  const ma = Math.min(least(a), pa), mb = Math.min(least(b), pb);
  const shares = unit(sizes), wa = shares[i - 1], wb = shares[i];
  let na = wa, nb = wb;
  const move = (/** @type {PointerEvent} */ ev) => {
    const d = Math.max(-pa + ma, Math.min(pb - mb, (row ? ev.clientX : ev.clientY) - start));
    na = wa * (pa + d) / (pa || 1); nb = wb * (pb - d) / (pb || 1);
    a.style.flexGrow = String(na); b.style.flexGrow = String(nb);
  };
  const up = () => {
    grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
    grip.classList.remove('dragging');
    if (Math.abs(na - wa) > 0.002) { const next = [...shares]; next[i - 1] = na; next[i] = nb; done(next); }
  };
  grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
}

/**
 * The keyboard on the grip between the parts `i - 1` and `i`: their new shares (summing to 1), or null when the key is
 * not one of its own (left to the page). Entrée: every part of the split an equal share.
 * @param {KeyboardEvent} e @param {'row' | 'col'} dir @param {number[]} sizes @param {number} i @returns {number[] | null}
 */
export function keyShares(e, dir, sizes, i) {
  const keys = dir === 'row' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
  if (![...keys, 'Home', 'End', 'Enter'].includes(e.key)) return null;
  // Handled here: not also by the page (Flore's ← → go from plant to plant).
  e.preventDefault(); e.stopPropagation();
  if (e.key === 'Enter') return sizes.map(() => 1 / sizes.length);
  const shares = unit(sizes);
  const pair = shares[i - 1] + shares[i];
  const step = e.shiftKey ? 0.2 : 0.05;
  const a = e.key === 'Home' ? MIN_SHARE : e.key === 'End' ? pair - MIN_SHARE : shares[i - 1] + (e.key === keys[0] ? -step : step);
  const next = Math.max(MIN_SHARE, Math.min(pair - MIN_SHARE, a));
  if (Math.abs(next - shares[i - 1]) < 0.001) return null;
  shares[i - 1] = next; shares[i] = pair - next;
  return shares;
}

/**
 * The grip between the parts `i - 1` and `i` of a split: a separator (its value: the share of the part before it, in
 * %), dragged or moved by the keyboard, `set` given the new shares.
 * @param {{ dir: 'row' | 'col', sizes: number[], i: number, label: string, controls?: string, set: (sizes: number[]) => void, part?: string }} o
 */
export function shareGrip({ dir, sizes, i, label, controls, set, part = 'cell' }) {
  const shares = unit(sizes);
  const pct = (/** @type {number} */ s) => Math.round(100 * s);
  return html`<div class="split-grip" role="separator" tabindex="0" aria-orientation=${dir === 'row' ? 'vertical' : 'horizontal'}
    aria-label=${label} aria-controls=${controls || ''}
    aria-valuenow=${pct(shares[i - 1])} aria-valuemin=${pct(MIN_SHARE)} aria-valuemax=${pct(shares[i - 1] + shares[i]) - pct(MIN_SHARE)}
    aria-valuetext=${pct(shares[i - 1]) + ' %'}
    title=${`Tirer pour partager la place · ${dir === 'row' ? '← →' : '↑ ↓'} au clavier · double-clic ou Entrée : parts égales`}
    @pointerdown=${(/** @type {PointerEvent} */ e) => dragShares(e, dir, sizes, i, set, part)}
    @dblclick=${() => set(sizes.map(() => 1 / sizes.length))}
    @keydown=${(/** @type {KeyboardEvent} */ e) => { const next = keyShares(e, dir, sizes, i); if (next) set(next); }}></div>`;
}
