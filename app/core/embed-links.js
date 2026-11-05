// @ts-check
// The links of a sheet shown inside another page — an activity's box (gf-miniapp), a screen made to measure
// (gf-layout) —, one interception for both, each host its rules:
//  - In an activity, no way out to another site: a link to another origin rendered by any component it shows (the
//    plant's sheet, the photos and their credits, the map's cards…) becomes plain text — its words stay, it no longer
//    leads anywhere. Kept, minimal: the credits a licence asks for — a licence link (rel="license": gf-attribution's
//    « CC BY-SA 4.0 »), the author's page when the record names no author (rel="author"), the links of a credit line
//    (`.credit`: « Source : GBIF.org », « D’après Wikipédia ») and of the map's attribution (IGN, the photos' sources) —;
//    and, for safety, the poison centres' official list and the emergency numbers (`.sos`, core/poison.js#emergency).
//    One watcher over the box, through every shadow root under it, as they render; a click on what would still lead
//    out is stopped too (`quiet`).
//  - A link to a plant's sheet (#/plant/<id>, its ?pane= too — a sosie in « Plantes à confondre » or Usages, a
//    result): each host's rule (`plant`) — a screen makes it its current plant, an activity opens it inside; one that
//    declines leaves it as any link. Ctrl, ⌘, Maj, Alt or another button than the first: the browser's way (a tab).
//  - The rest (another screen of the app, an anchor of the page): left alone.
// The order of a click: a component's own handler first, then the host's (bubbling up to it), then the window's
// (core/history.js, the web pane: core/web-pane.js). Outside these hosts nothing changes.

/** The hosts already given their rules. @type {WeakSet<HTMLElement>} */
const hosts = new WeakSet();

/** The shadow roots (and the box's own) already watched. @type {WeakSet<Node>} */
const watched = new WeakSet();

/**
 * What a link leads to: a plant's sheet (its id), another screen of the app (a view: #/…, or this site's own URL), an
 * anchor of the page (#…), another site (another origin, mailto:, tel:…); null: no link (nothing, or unreadable).
 * @param {string} raw the href as written @param {string} [here] the page's address
 * @returns {{ kind: 'plant', id: number } | { kind: 'view' | 'anchor' | 'out' } | null}
 */
export function hrefKind(raw, here = location.href) {
  if (!raw) return null;
  const plant = /^#\/plant\/(\d+)(?:\?|$)/.exec(raw);
  if (plant) return { kind: 'plant', id: Number(plant[1]) };
  if (raw.startsWith('#/')) return { kind: 'view' };
  if (raw.startsWith('#')) return { kind: 'anchor' };
  try { return { kind: new URL(raw, here).origin === new URL(here).origin ? 'view' : 'out' }; } catch { return null; }
}

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

/** Inside an activity (its box gf-miniapp, through the shadow roots). @param {Element} el */
export const inActivity = el => Boolean(closestThrough(el, 'gf-miniapp'));

/** A link to another site (or mailto:, tel:…). @param {HTMLAnchorElement} a */
const leadsOut = a => hrefKind(a.getAttribute('href') || '')?.kind === 'out';

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
 * A host's rules for the links shown in it, once (called again: nothing more). `quiet`: its links out quieted as they
 * come, a click that would still lead out stopped (any button, any key). `plant(id, path)`: a plant link's first-button
 * click, no key held, that no component took — 'opened', the host opened or chose it (the link's own way stopped; from a
 * dialog over the sheet, ⤢, that dialog closed); 'kept', the host does nothing with it (stopped, the dialog left open:
 * a cell's toucher=rien); false, left as any link.
 * @param {HTMLElement} host @param {{ quiet?: boolean, plant?: ((id: number, path: EventTarget[]) => 'opened' | 'kept' | false) | null }} [rules]
 */
export function embedLinks(host, { quiet: quieted = false, plant = null } = {}) {
  if (hosts.has(host)) return;
  hosts.add(host);
  if (quieted) {
    if (host.shadowRoot) watch(host.shadowRoot);
    watch(host);
    host.addEventListener('click', e => {
      const a = /** @type {HTMLAnchorElement | undefined} */ (e.composedPath().find(n => n instanceof HTMLAnchorElement));
      if (a && leadsOut(a) && !keptLink(a)) e.preventDefault();
    }, true);
  }
  if (!plant) return;
  host.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const path = e.composedPath();
    const a = /** @type {HTMLAnchorElement | undefined} */ (path.find(n => n instanceof HTMLAnchorElement && n.hasAttribute('href')));
    // Marked to leave (the map's current plant ↗) or a download: as any link.
    if (!a || a.hasAttribute('data-open') || a.hasAttribute('download')) return;
    const k = hrefKind(a.getAttribute('href') || '');
    const took = k?.kind === 'plant' && plant(k.id, path);
    if (!took) return;
    e.preventDefault();
    // Picked from a dialog over the sheet (⤢): closed after the host's new entry (core/history.js keeps it); nothing
    // picked, the block still read there.
    if (took === 'opened') /** @type {HTMLDialogElement | undefined} */ (path.find(n => n instanceof HTMLDialogElement && n.open))?.close();
  });
}
