// @ts-check
// « Page web » panes: once one is in the layout (a pane of the plant sheet, in sight), the links of the app to other
// sites open in it instead of a new tab — a Wikipédia link, an INPN record, a GBIF page… A modifier key (Ctrl, ⌘,
// Maj), a middle click or a download still go the browser's way. The page opened stays from one plant to the next
// (and is kept while the app is open), with its own history (← →).

/**
 * A plant sheet with a « Page web » pane: it shows that pane (its tab, unfolded) when a page arrives.
 * @typedef {HTMLElement & { preview?: boolean, revealWeb(): void }} WebPane
 */

/** The sheets with such a pane, the first in sight receiving the links. @type {Set<WebPane>} */
const panes = new Set();

/** What the panes show, kept while browsing. */
export const webSession = {
  /** The pages opened, in order, and the one shown. @type {string[]} */
  stack: [],
  at: -1
};

/** Told when the page shown changes. */
export const webEvents = new EventTarget();
const changed = () => webEvents.dispatchEvent(new Event('change'));

/** A page to show: after the one shown, the pages ahead forgotten. @param {string} url */
export function pushPage(url) {
  webSession.stack = [...webSession.stack.slice(0, webSession.at + 1), paneUrl(url)].slice(-50);
  webSession.at = webSession.stack.length - 1;
  changed();
}

/** ← → among the pages opened. @param {number} d */
export function goPage(d) {
  const at = webSession.at + d;
  if (at < 0 || at >= webSession.stack.length) return;
  webSession.at = at;
  changed();
}

export function clearPages() {
  webSession.stack = [];
  webSession.at = -1;
  changed();
}

/** @param {WebPane} pane */
export function registerWebPane(pane) { panes.add(pane); }
/** @param {WebPane} pane */
export function unregisterWebPane(pane) { panes.delete(pane); }

/** A pane in sight (not a card waiting underneath), to receive the links. */
function paneInSight() {
  for (const p of panes) {
    if (!p.isConnected || !p.getClientRects().length) continue;
    if (p.preview) continue;
    return p;
  }
  return null;
}

/**
 * The address to open in a pane: Wikipédia in its mobile version (made for a narrow column, and shown in frames).
 * @param {string} url
 */
export function paneUrl(url) {
  try {
    const u = new URL(url);
    if (/^[a-z-]+\.wikipedia\.org$/.test(u.hostname) && !/\.m\.wikipedia\.org$/.test(u.hostname)) u.hostname = u.hostname.replace('.wikipedia.org', '.m.wikipedia.org');
    return u.href;
  } catch { return url; }
}

/** Opens `url` in the pane in sight, if there is one. @param {string} url @returns {boolean} */
export function openInWebPane(url) {
  const pane = paneInSight();
  if (!pane) return false;
  pushPage(url);
  pane.revealWeb();
  return true;
}

// The links to other sites, wherever they are in the app (inside its components too): to the pane, when there is one.
addEventListener('click', e => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = /** @type {HTMLAnchorElement | undefined} */ (e.composedPath().find(n => n instanceof HTMLAnchorElement && n.href));
  if (!a || a.hasAttribute('download') || a.closest('[data-no-web-pane]')) return;
  let url;
  try { url = new URL(a.href, location.href); } catch { return; }
  if (!/^https?:$/.test(url.protocol) || url.origin === location.origin) return;
  if (openInWebPane(url.href)) e.preventDefault();
});
