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
  if (typeof state().gfDepth !== 'number') {
    forget(last + 1);
    history.replaceState({ ...state(), gfDepth: last + 1, ...kept() }, '');
  }
  last = depth();
});

/** Updates the URL of the current view (no new entry), keeping its place in history. @param {string} hash */
export function replaceHash(hash) {
  history.replaceState({ ...state(), gfDepth: depth() }, '', hash);
  // On a dialog's step (filters ticked in the « Filtres » sheet): the view behind it gets this URL when it closes.
  const modal = state().gfModal;
  if (modal && stepUrls.has(modal)) stepUrls.set(modal, { ...stepUrls.get(modal), href: location.href });
  moved();
}

/** The URL changed without a hashchange (replaceHash, pushHash shown by its page): for those that follow it (context.js). */
const moved = () => dispatchEvent(new Event('gf-location'));

/**
 * A new view, made by the app rather than by a link. The router follows it like a link, unless the page
 * that made it shows it itself (`notify` false: Back still reaches the router).
 * @param {string} hash @param {Record<string, unknown>} [extra] kept in the entry's state @param {boolean} [notify]
 */
export function pushHash(hash, extra = {}, notify = true) {
  forget(depth() + 1);
  history.pushState({ ...extra, gfDepth: depth() + 1, ...kept() }, '', hash);
  last = depth();
  if (notify) dispatchEvent(new HashChangeEvent('hashchange'));
  else moved();
}

/** Keeps values in the current entry's state (read back with entryValue, also after Back / Forward). @param {Record<string, unknown>} values */
export function markEntry(values) {
  history.replaceState({ ...state(), ...values }, '');
}

/** A value this app kept in the current entry's state (pushHash `extra`). @param {string} key */
export const entryValue = key => state()[key];

/**
 * A new view, as a link to `hash` would open it: a new entry, which the router follows (hashchange). The one place
 * the app sets location.hash (eslint.config.js): a navigation service has one place to start from.
 * @param {string} hash
 */
export function openView(hash) {
  location.hash = hash;
}

/** The current view replaced by the one at `hash` (no new entry: Back skips it); the router follows it. @param {string} hash */
export function replaceView(hash) {
  const at = depth();
  location.replace(hash);
  // location.replace leaves the entry no state, as a link's new one (the hashchange would count it a step deeper and
  // forget the views ahead): it keeps its depth and the URLs kept for the others, not what the view replaced kept in it.
  history.replaceState({ gfDepth: at, ...kept() }, '');
}

/** This page is a reload of its entry: the entry's state was written by the page just on it (not by one long ago). */
const reloaded = () => /** @type {PerformanceNavigationTiming | undefined} */ (performance.getEntriesByType('navigation')[0])?.type === 'reload';

/**
 * URLs the views of this visit were given after they were left (the list a plant was opened from, its filters
 * changed beside the plant), by depth: going back to one — or Forward to it, after going back past it at once — it
 * takes its URL. Kept until a new view takes its place (forget). In the current entry's state too (gfBehind: written
 * as it changes, carried to each new entry), so a reload, then Back or Forward, still finds them. A page gone back or
 * forward to from another page keeps only those behind its entry: the state it reads may hold some ahead that a view
 * made since in their place, by a link, forgot (they go from it too).
 * @type {Map<number, string>}
 */
const behind = new Map((Array.isArray(state().gfBehind) ? state().gfBehind : [])
  .filter((/** @type {any} */ e) => Array.isArray(e) && Number.isInteger(e[0]) && e[0] >= 0 && typeof e[1] === 'string'
    && (e[0] < depth() || (e[0] > depth() && reloaded()))));
keepBehind();

/** `behind` as a new entry's state carries it (none: nothing). */
function kept() { return behind.size ? { gfBehind: [...behind] } : {}; }

/** A new view at `at` depth: the URLs kept for the views it replaces (there and beyond) go with them. @param {number} at */
function forget(at) {
  for (const d of behind.keys()) if (d >= at) behind.delete(d);
}

/** `behind` into the current entry's state (a reload reads it back), its URL `href` when given. @param {string} [href] */
function keepBehind(href) {
  const { gfBehind, ...rest } = state();
  if (behind.size || gfBehind || href) history.replaceState({ ...rest, ...kept() }, '', href);
}

/**
 * The view at `target` depth, behind this one, gets `href` when it is gone back to (Back, backTo; Forward, gone back
 * past it): its URL would otherwise undo what changed since it was left (the store follows the URL).
 * @param {number} target @param {string} href
 */
export function renewBehind(target, href) {
  if (target < 0 || target >= depth() || behind.get(target) === href) return;
  behind.set(target, href);
  keepBehind();
}

/** Back to the entry at `target` depth when it is behind this one, else a new view at `fallback`. @param {number | null} target @param {string} fallback */
export function backTo(target, fallback) {
  if (target !== null && target >= 0 && target < depth()) history.go(target - depth());
  else openView(fallback);
}

/** Back one view when there is one in this visit, else to `fallback` (in place). @param {string} fallback */
export function back(fallback) {
  if (depth() > 0) history.back();
  else replaceView(fallback);
}

// ── Dialogs: open one = a history entry (same URL); Back closes it ─────────────────────────────────────────

let modals = 0;
/** Dialogs open through openModal, by id. @type {Map<number, HTMLDialogElement>} */
const open = new Map();
/**
 * The URL a dialog's step was given while it was open (replaceHash), by dialog id, with the depth of the view it
 * covers: leaving the step takes it back to that view, whose URL would otherwise undo what was chosen in the dialog.
 * @type {Map<number, { depth: number, href: string }>}
 */
const stepUrls = new Map();

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
  stepUrls.set(id, { depth: depth(), href: location.href });
  dialog.addEventListener('close', () => {
    open.delete(id);
    // Closed by the app or the user, not by Back: remove the step it added — after the click that closed it,
    // so a link in the dialog navigates first (its view then stays, and the step behind is skipped on Back).
    setTimeout(() => {
      if (state().gfModal === id) history.back();
      else stepUrls.delete(id);
    });
  }, { once: true });
}

addEventListener('popstate', () => {
  // A link fires popstate too, on its new entry not stamped yet (hashchange stamps it from `last`).
  if (typeof state().gfDepth === 'number') {
    last = depth();
    // Back (or Forward) to a view given a URL since it was left (renewBehind): it takes it before the hashchange of
    // this move reads it. Those of the other views stay — gone back past at once (history.go(-2), the long-pressed
    // Back's menu), one is still given its URL on Forward; a new view in its place forgets it (pushHash, a link's
    // entry). This entry's state is told.
    const href = behind.get(depth());
    behind.delete(depth());
    keepBehind(href && href !== location.hash ? href : undefined);
  }
  // Back from a dialog's step to the view it covered (same depth): that view takes the URL the step was given,
  // before the hashchange of this move reads it (the store follows the URL: the filters would be undone).
  for (const [id, step] of stepUrls) {
    if (state().gfModal === id) continue;
    stepUrls.delete(id);
    if (typeof state().gfDepth !== 'number' || depth() !== step.depth || step.href === location.href) continue;
    history.replaceState(state(), '', step.href);
    // Back onto another dialog's step (one dialog over another): it carries the URL on in turn.
    const under = state().gfModal;
    if (under && stepUrls.has(under)) stepUrls.set(under, { ...stepUrls.get(under), href: step.href });
  }
  // A dialog whose page went away without closing it.
  for (const [id, dialog] of open) if (!dialog.isConnected) open.delete(id);
  // Back from a dialog's step: close it.
  for (const [id, dialog] of open) if (state().gfModal !== id && dialog.open) dialog.close();
  // Landed on the step of a dialog that is no longer open (a link inside it navigated away): skip it.
  const modal = state().gfModal;
  if (modal && !open.has(modal)) history.back();
});
