// @ts-check
// Browser history: every view is an entry, so the browser's and the phone's Back button return to the
// previous view and close an open dialog. Each entry carries its depth in this visit (history.state.gfDepth),
// so « close » buttons can go back to the view they came from instead of piling a new one on top.
// Imported first by the router: its hashchange listener stamps a new entry before the app routes.

/** @returns {Record<string, any>} */
const state = () => (history.state && typeof history.state === 'object' ? history.state : {});

/** Depth of the current entry in this visit (0: the first one). */
export const depth = () => (typeof state().gfDepth === 'number' ? state().gfDepth : 0);

let last = depth();
if (typeof state().gfDepth !== 'number') history.replaceState({ ...state(), gfDepth: 0 }, '');

// A link or `location.hash =` pushed an entry with no state: it is one step deeper than the one we were on.
addEventListener('hashchange', () => {
  if (typeof state().gfDepth !== 'number') history.replaceState({ ...state(), gfDepth: last + 1 }, '');
  last = depth();
});

/** Updates the URL of the current view (no new entry), keeping its place in history. @param {string} hash */
export function replaceHash(hash) {
  history.replaceState({ ...state(), gfDepth: depth() }, '', hash);
}

/**
 * A new view, made by the app rather than by a link. The router follows it like a link, unless the page
 * that made it shows it itself (`notify` false: Back still reaches the router).
 * @param {string} hash @param {Record<string, unknown>} [extra] kept in the entry's state @param {boolean} [notify]
 */
export function pushHash(hash, extra = {}, notify = true) {
  history.pushState({ ...extra, gfDepth: depth() + 1 }, '', hash);
  last = depth();
  if (notify) dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Keeps values in the current entry's state (read back with entryValue, also after Back / Forward). @param {Record<string, unknown>} values */
export function markEntry(values) {
  history.replaceState({ ...state(), ...values }, '');
}

/** A value this app kept in the current entry's state (pushHash `extra`). @param {string} key */
export const entryValue = key => state()[key];

/** Back to the entry at `target` depth when it is behind this one, else a new view at `fallback`. @param {number | null} target @param {string} fallback */
export function backTo(target, fallback) {
  if (target !== null && target >= 0 && target < depth()) history.go(target - depth());
  else location.hash = fallback;
}

/** Back one view when there is one in this visit, else to `fallback` (in place). @param {string} fallback */
export function back(fallback) {
  if (depth() > 0) history.back();
  else location.replace(fallback);
}

// ── Dialogs: open one = a history entry (same URL); Back closes it ─────────────────────────────────────────

let modals = 0;
/** Dialogs open through openModal, by id. @type {Map<number, HTMLDialogElement>} */
const open = new Map();

/**
 * Shows a modal dialog as a step in history: Back closes it; closing it otherwise (✕, Esc, a choice) takes the
 * step back out, so history is as before.
 * @param {HTMLDialogElement | null | undefined} dialog
 */
export function openModal(dialog) {
  if (!dialog || dialog.open) return;
  dialog.showModal();
  const id = ++modals;
  open.set(id, dialog);
  history.pushState({ ...state(), gfModal: id }, '');
  dialog.addEventListener('close', () => {
    open.delete(id);
    // Closed by the app or the user, not by Back: remove the step it added — after the click that closed it,
    // so a link in the dialog navigates first (its view then stays, and the step behind is skipped on Back).
    setTimeout(() => { if (state().gfModal === id) history.back(); });
  }, { once: true });
}

addEventListener('popstate', () => {
  // A link fires popstate too, on its new entry not stamped yet (hashchange stamps it from `last`).
  if (typeof state().gfDepth === 'number') last = depth();
  // A dialog whose page went away without closing it.
  for (const [id, dialog] of open) if (!dialog.isConnected) open.delete(id);
  // Back from a dialog's step: close it.
  for (const [id, dialog] of open) if (state().gfModal !== id && dialog.open) dialog.close();
  // Landed on the step of a dialog that is no longer open (a link inside it navigated away): skip it.
  const modal = state().gfModal;
  if (modal && !open.has(modal)) history.back();
});
