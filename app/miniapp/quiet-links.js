// @ts-check
// Inside a mini-app, no way out to another site: a link to another origin rendered by any component it shows (the
// plant's sheet, the photos and their credits, the map's cards…) becomes plain text — its words stay, it no longer
// leads anywhere. Kept, minimal: the credits a licence asks for — a licence link (rel="license": gf-attribution's
// « CC BY-SA 4.0 »), the author's page when the record names no author (rel="author"), the links of a credit line
// (`.credit`: « Source : GBIF.org », « D’après Wikipédia ») and of the map's attribution (IGN, the photos' sources) —;
// and, for safety, the poison centres' official list and the emergency numbers (`.sos`, core/poison.js#emergency).
// One watcher over the mini-app's box (gf-miniapp), through every shadow root under it, as they render; a click
// on what would still lead out is stopped too. Outside the mini-apps nothing changes.

/** The shadow roots (and the box's own) already watched. @type {WeakSet<Node>} */
const watched = new WeakSet();

/**
 * The nearest element matching `selector` from `el` up, through the shadow roots' hosts.
 * @param {Element} el @param {string} selector @returns {Element | null}
 */
function closestThrough(el, selector) {
  /** @type {Node | null} */ let n = el;
  while (n) {
    if (n instanceof Element) {
      const hit = n.closest(selector);
      if (hit) return hit;
    }
    const root = n instanceof Element ? n.getRootNode() : n;
    n = root instanceof ShadowRoot ? root.host : null;
  }
  return null;
}

/** Inside a mini-app (its box gf-miniapp, through the shadow roots). @param {Element} el */
export const inMiniApp = el => Boolean(closestThrough(el, 'gf-miniapp'));

/** A link to another site (or mailto:, tel:…). @param {HTMLAnchorElement} a */
function leadsOut(a) {
  const raw = a.getAttribute('href');
  if (!raw || raw.startsWith('#')) return false;
  try { return new URL(raw, location.href).origin !== location.origin; } catch { return false; }
}

/** A link kept: a licence's, an author's, a credit line's, the map's attribution's; the emergency's. @param {HTMLAnchorElement} a */
export const keptLink = a => /(^|\s)(license|author)(\s|$)/.test(a.rel) || Boolean(closestThrough(a, '.credit, .leaflet-control-attribution, .sos'));

/** Its link taken away, its words kept. @param {Element} a */
function quiet(a) {
  if (!(a instanceof HTMLAnchorElement) || !leadsOut(a) || keptLink(a)) return;
  a.removeAttribute('href');
  a.removeAttribute('target');
  a.dataset.quiet = '';
}

/** Every link under `root` quieted, and every shadow root under it watched. @param {ParentNode} root */
function sweep(root) {
  if (root instanceof Element) { quiet(root); if (root.shadowRoot) watch(root.shadowRoot); }
  for (const a of root.querySelectorAll('a[href]')) quiet(a);
  for (const el of root.querySelectorAll('*')) if (el.shadowRoot) watch(el.shadowRoot);
}

/** @param {ShadowRoot | Element} root */
function watch(root) {
  if (watched.has(root)) return;
  watched.add(root);
  sweep(root);
  new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'attributes') quiet(/** @type {Element} */ (r.target));
      else for (const n of r.addedNodes) if (n instanceof Element) sweep(n);
    }
  }).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['href'] });
}

/**
 * The mini-app's box: its links out quieted as they come, a click that would still lead out stopped.
 * @param {HTMLElement} box gf-miniapp
 */
export function quietLinks(box) {
  if (box.shadowRoot) watch(box.shadowRoot);
  watch(box);
  if (/** @type {any} */ (box).gfQuietClick) return;
  /** @type {any} */ (box).gfQuietClick = true;
  box.addEventListener('click', e => {
    const a = /** @type {HTMLAnchorElement | undefined} */ (e.composedPath().find(n => n instanceof HTMLAnchorElement));
    if (a && leadsOut(a) && !keptLink(a)) e.preventDefault();
  }, true);
}
