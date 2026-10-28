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

/** A launch with no address (the installed app's icon): its first view put at `hash`, in place (depth 0), before anything routes. @param {string} hash */
export function startAt(hash) {
  if (!location.hash && hash) history.replaceState(history.state, '', hash);
}

// A link to the view shown (a tab touched again, the logo on Flore as it was left, Réglages' gear on Réglages): nothing.
// Followed, the browser would still navigate to it: a popstate for no move (Chromium), or, where the entry that takes
// this one's place is given no state (the same address: no hashchange to stamp it), its depth and what the views kept
// in it (gfBehind, the sheet marks, gfMapBase, gfAppFrom) lost. At the window, as it bubbles: a component's own
// handler runs first (and may take the click itself).
addEventListener('click', e => {
  const m = /** @type {MouseEvent} */ (e);
  if (m.defaultPrevented || m.button !== 0 || m.metaKey || m.ctrlKey || m.shiftKey || m.altKey) return;
  const a = /** @type {HTMLAnchorElement | undefined} */ (m.composedPath().find(n => n instanceof HTMLAnchorElement && n.hasAttribute('href')));
  if (a && !a.target && !a.hasAttribute('download') && a.href === location.href) m.preventDefault();
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

/**
 * The current view replaced by the one at `hash` (no new entry: Back skips it); the router follows it.
 * @param {string} hash @param {string[]} [keep] keys of this entry's state the new view keeps (the same sheet: its marks)
 */
export function replaceView(hash, keep = []) {
  const at = depth();
  const carried = Object.fromEntries(keep.filter(k => state()[k] !== undefined).map(k => [k, state()[k]]));
  location.replace(hash);
  // location.replace leaves the entry no state, as a link's new one (the hashchange would count it a step deeper and
  // forget the views ahead): it keeps its depth and the URLs kept for the others, not what the view replaced kept in
  // it — but the keys it says (`keep`).
  history.replaceState({ ...carried, gfDepth: at, ...kept() }, '');
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

/**
 * Where a sheet shown over a view closes to (a plant's sheet, a block's pane), kept in its entries: `from` the depth of
 * the entry it was opened from (null: a link, a tab, the start — nothing of this visit under it), `start` the depth of
 * the first entry it showed on (the plants gone through with ‹ › come after it).
 * @typedef {{ from: number | null, start: number }} SheetMark
 */

/** A mark read from a state, checked against this entry (a depth not behind it: none). @param {unknown} v @returns {SheetMark | null} */
function readMark(v) {
  const m = /** @type {any} */ (v);
  if (!m || typeof m !== 'object' || !Number.isInteger(m.start) || m.start < 0 || m.start > depth()) return null;
  return { from: Number.isInteger(m.from) && m.from >= 0 && m.from < m.start ? m.from : null, start: m.start };
}

/**
 * This entry's sheet mark (`key` in its state): kept since the entry first showed the sheet (a reload, Back, Forward
 * read it back), else decided now and kept — `opened()` gives the depth it was opened from (the list just left), the
 * mark of the sheet it goes on from (‹ ›: the same sheet, another plant), or null (a link, a tab, the start).
 * @param {string} key @param {() => number | SheetMark | null} opened @returns {SheetMark}
 */
export function sheetMark(key, opened) {
  const known = readMark(state()[key]);
  if (known) return known;
  const o = opened();
  const mark = typeof o === 'number' ? { from: o >= 0 && o < depth() ? o : null, start: depth() } : readMark(o) ?? { from: null, start: depth() };
  markEntry({ [key]: mark });
  return mark;
}

/**
 * A sheet closed (its ×, Échap): back to the entry it was opened from — past the plants gone through since —, that
 * entry given `href` (the view under the sheet as it is now: renewBehind); opened by a link, a tab or at the start: back
 * to the first entry it showed on, which takes `href` — or, that entry being this one, this one replaced by `href`
 * (keeping its `keep` keys), or by `instead` (an activity: its own address keeps its state). No entry is added.
 * Not backTo: « Quitter » and a place closed on the Carte go back to their view or open it anew; a sheet never adds one.
 * @param {SheetMark} mark @param {string} href @param {{ keep?: string[], instead?: () => void }} [options]
 */
export function closeTo(mark, href, { keep = [], instead } = {}) {
  const to = mark.from ?? mark.start;
  if (to < depth()) { renewBehind(to, href); history.go(to - depth()); }
  else if (instead) instead();
  else replaceView(href, keep);
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
 * The dialogs whose step is being taken out (a Back on its way), until it is left: each step goes back once, whoever
 * asks first — its dialog closed (openModal), or Back landing on it once its dialog is gone (popstate). Two dialogs
 * closed together (« Recommencer »'s question over Découvrir's) would otherwise go back twice from the second step.
 * @type {Set<number>}
 */
const leaving = new Set();

/** The step of dialog `id` taken out of history, once. @param {number} id */
function leave(id) {
  if (leaving.has(id)) return;
  leaving.add(id);
  history.back();
}

/**
 * Shows a modal dialog as a step in history: Back closes it; closing it otherwise (✕, Esc, a choice) takes the
 * step back out, so history is as before. Returns the step's id (afterStep), none when it was not opened.
 * @param {HTMLDialogElement | null | undefined} dialog @returns {number | undefined}
 */
export function openModal(dialog) {
  if (!dialog || dialog.open) return undefined;
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
      if (state().gfModal === id) leave(id);
      else stepUrls.delete(id);
    });
  }, { once: true });
  return id;
}

/**
 * Whether a dialog opened through openModal is open (a question, « Noter ici », « Ajouter à… »…): the keys the page
 * listens to on the window (an activity's sheet, the cards, Flore's ← →) are the dialog's meanwhile, never the page's
 * under it.
 */
export const modalOpen = () => [...open.values()].some(d => d.open && d.isConnected);

/**
 * Resolves once the step of dialog `id` (openModal) is no longer the current entry: its dialog closed has taken it out,
 * or Back has — at once when it is not. Another dialog's step under it stays (a question asked over « Ajouter à… »):
 * waiting for none at all (afterDialogSteps) would hold every answer there for the fallback's second.
 * @param {number | undefined} id @returns {Promise<void>}
 */
export function afterStep(id) {
  if (id === undefined || state().gfModal !== id) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { removeEventListener('popstate', check); clearTimeout(timer); resolve(); };
    const check = () => { if (state().gfModal !== id) done(); };
    addEventListener('popstate', check);
    // A step left in place (it should not be) does not hold the caller back.
    const timer = setTimeout(done, 1000);
  });
}

/**
 * Resolves once the current entry is no dialog's step: each dialog closed has taken its step back out (openModal), or
 * Back has skipped it — at once when there is none. A view opened from a dialog waits for it, so its entry takes the
 * step's place instead of piling on it: the depths then count the views behind (backTo, gfAppFrom).
 * @returns {Promise<void>}
 */
export function afterDialogSteps() {
  if (!state().gfModal) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { removeEventListener('popstate', check); clearTimeout(timer); resolve(); };
    const check = () => { if (!state().gfModal) done(); };
    addEventListener('popstate', check);
    // A dialog left open (it should not be) does not hold the view back: opened over its step, as before.
    const timer = setTimeout(done, 1000);
  });
}

addEventListener('popstate', () => {
  // The steps left: one may be taken out again (Forward back onto it).
  for (const id of leaving) if (state().gfModal !== id) leaving.delete(id);
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
  // Landed on the step of a dialog that is no longer open (a link inside it navigated away, or it was closed with
  // another one): skip it.
  const modal = state().gfModal;
  if (modal && !open.has(modal)) leave(modal);
});
