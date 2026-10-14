// @ts-check
// The app's brief toast (the quiet-map rule, gf-map.js): for an action the user has just taken that failed — « Me
// localiser » refused, an address search without a result, « Vue 3D » unavailable here, a point touched whose plant
// is not among the cards — or a word on what they just did that has its own control (a walk's « Annuler »). One small
// toast, for a moment (TOAST_MS, 2.8 s), in the browser's top layer (a popover: over a map gone full screen, a dialog,
// any pane that clips), placed over the element it is about (a map: its top, under its search pill; a column: its
// bottom; a button: above it). Never two at once: a new one takes the place of the one shown, the same words while
// they show are not shown again; and the app's other toasts share the one slot (takeToastSlot: the capture's, which
// carries actions and safety warnings, outweighs a map's word — that word is then not shown, only said). Never for a background failure (a
// tile source, iNaturalist, the relief): that is a map's state (gf-map setStatus), in its panel, said once.
// What it says reaches screen readers once: by the caller's live region when it has one (`live: false`: gf-map's), else
// by a live region made once where the toast goes (the body, an open dialog) whose text changes — never a toast
// injected already written with role=status (read out unreliably).
// A toast with an action (a walk's « Annuler ») is a word, not a failure: it lasts longer (ACTION_TOAST_MS), stays
// while it is hovered or holds the focus, and outweighs a map's word (a failed « Me localiser » does not take its place).

/** How long a toast shows (ms): under 3 s. */
export const TOAST_MS = 2800;
/** How long a toast with an action shows (ms), unless hovered or focused meanwhile (then until it is left). */
export const ACTION_TOAST_MS = 6000;

/**
 * A line said in a live region (polite, visually hidden): added — the same words still there taken out first, so
 * that they are an addition again —, the oldest gone past four, each gone after a while.
 * @param {HTMLElement} live @param {string} words
 */
export function sayIn(live, words) {
  for (const old of [...live.children]) if (old.textContent === words) old.remove();
  const line = Object.assign(document.createElement('p'), { textContent: words });
  live.append(line);
  while (live.childElementCount > 4) live.firstElementChild?.remove();
  setTimeout(() => line.remove(), 20_000);
}

/** The toasts' own live region where they go (the body, an open dialog): made once there, kept. @param {Element} host */
function liveIn(host) {
  let live = /** @type {HTMLElement | null} */ ([...host.children].find(c => c.classList.contains('gf-toast-live')) || null);
  if (!live) {
    live = document.createElement('div');
    live.className = 'gf-toast-live';
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-relevant', 'additions');
    // Visually hidden (inline: the region may be in a dialog of a shadow root, out of app.css's reach).
    live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';
    host.append(live);
  }
  return live;
}

/** The one toast shown in the app now: how to let it go, and its weight. @type {{ hide: () => void, weight: number } | null} */
let slot = null;

/**
 * Takes the app's one toast place for a toast (`hide` lets it go). A toast shown with more weight keeps it: null then
 * (the newcomer is not shown — its words still said by its caller). Otherwise the one shown is let go, and the
 * function returned gives the place back.
 * @param {() => void} hide @param {number} [weight] 1: a word (a map's failure); 2: a toast with an action (a walk's
 *   « Annuler », the capture's « Annuler / Détails »); 3: a safety warning (the capture's)
 * @returns {(() => void) | null}
 */
export function takeToastSlot(hide, weight = 1) {
  if (slot && slot.hide !== hide && slot.weight > weight) return null;
  if (slot && slot.hide !== hide) slot.hide();
  const mine = { hide, weight };
  slot = mine;
  return () => { if (slot === mine) slot = null; };
}

/** @type {HTMLElement | null} */ let el = null;
let text = '';
/** @type {ReturnType<typeof setTimeout> | undefined} */ let timer;
/** @type {(() => void) | null} */ let release = null;
/** @type {(() => void) | null} */ let onHidden = null;

/** The toast let go (its time out, another one, its action taken). */
function hide() {
  clearTimeout(timer);
  release?.();
  release = null;
  text = '';
  const done = onHidden;
  onHidden = null;
  if (el) {
    el.classList.remove('on');
    try { if (el.matches(':popover-open')) el.hidePopover(); } catch { /* not shown */ }
    el.remove();
  }
  done?.();
}

/**
 * Where the toast goes: over `near`'s top (`at: 'top'`, `offset` px under its edge), at its bottom (`'bottom'`), or
 * above it (`'above'`: a button) — within the window.
 * @param {HTMLElement} toast @param {Element | null} near @param {'top' | 'bottom' | 'above'} at @param {number} offset
 */
function place(toast, near, at, offset) {
  const r = near?.getBoundingClientRect();
  const box = r && r.width > 0 && r.height > 0 ? r : { left: 0, right: innerWidth, top: 0, bottom: innerHeight, width: innerWidth, height: innerHeight };
  const w = Math.min(toast.offsetWidth, innerWidth - 16), h = toast.offsetHeight;
  const left = Math.max(8, Math.min(innerWidth - w - 8, box.left + box.width / 2 - w / 2));
  const top = at === 'top' ? box.top + offset : at === 'bottom' ? box.bottom - h - offset : box.top - h - offset;
  toast.style.left = left + 'px';
  toast.style.top = Math.max(8, Math.min(innerHeight - h - 8, top)) + 'px';
}

/**
 * Shows the brief toast. Returns a handle to let it go before its time (`ms: 0`: it stays until then — a caller that
 * times it itself, told by `onHold` while it is hovered or focused), or null when it was not shown (the same words
 * showing already, a weightier toast in the place). A toast with an action lasts ACTION_TOAST_MS by default.
 * @param {string} words
 * @param {{ near?: Element | null, at?: 'top' | 'bottom' | 'above', offset?: number, ms?: number, live?: boolean,
 *   action?: { label: string, run: () => void } | null, onHide?: () => void, onHold?: (held: boolean) => void }} [o]
 * @returns {{ hide: () => void } | null}
 */
export function briefToast(words, { near = null, at = 'top', offset = 10, ms, live = true, action = null, onHide, onHold } = {}) {
  ms ??= action ? ACTION_TOAST_MS : TOAST_MS;
  if (!words || typeof document === 'undefined') return null;
  if (el?.isConnected && text === words) return null;
  const take = takeToastSlot(hide, action ? 2 : 1);
  if (!take) return null;
  hide();
  release = take;
  text = words;
  onHidden = onHide || null;
  const toast = el = document.createElement('div');
  toast.className = 'gf-brief-toast';
  if ('popover' in toast) toast.popover = 'manual';
  // Said by the caller's live region (gf-map's), or by the toasts' own region (below): the toast itself is not read.
  toast.setAttribute('aria-hidden', 'true');
  const span = document.createElement('span');
  span.textContent = words;
  toast.append(span);
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', () => { hide(); action.run(); });
    toast.append(button);
    // Its control reachable: not hidden from screen readers (its words are read by the region, not as it comes).
    toast.removeAttribute('aria-hidden');
  }
  // In the open dialog the element is in (its inert outside would hide it from screen readers), else in the body.
  const host = near?.closest('dialog[open]') || document.body;
  host.append(toast);
  if (live) sayIn(liveIn(host), words);
  try { toast.showPopover(); } catch { /* no popover: fixed, high (app.css) */ }
  place(toast, near, at, offset);
  requestAnimationFrame(() => toast.classList.add('on'));
  if (ms > 0) timer = setTimeout(hide, ms);
  if (action) {
    // Hovered or focused: it stays (its timer, or its caller's: onHold), until left.
    let over = false, focused = false;
    const hold = () => {
      const held = over || focused;
      if (ms > 0) { clearTimeout(timer); if (!held && el === toast) timer = setTimeout(hide, ms); }
      onHold?.(held);
    };
    // Hovered by a mouse only: a finger's pointerenter (a tap where the toast then shows) has no leave to follow it.
    toast.addEventListener('pointerenter', e => { if (e.pointerType !== 'mouse') return; over = true; hold(); });
    toast.addEventListener('pointerleave', e => { if (e.pointerType !== 'mouse') return; over = false; hold(); });
    toast.addEventListener('focusin', () => { focused = true; hold(); });
    toast.addEventListener('focusout', e => { if (!toast.contains(/** @type {Node | null} */ (e.relatedTarget))) { focused = false; hold(); } });
  }
  const mine = toast;
  return { hide: () => { if (el === mine) hide(); } };
}
