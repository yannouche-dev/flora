// What a map says, for the specs (the quiet-map rule, app/components/gf-map.js): nothing written over the map but its
// controls and credits — its state in the panel « Carte » (« État »), its words in its one live region, an action
// that failed in one brief toast (core/toast.js).
//   mapState(map)  the lines of the map's state (gf-map statusLines), as its panel shows them;
//   mapSaid(map)   the map's one live region (visually hidden, polite);
//   brief(page)    the brief toast (in the top layer);
//   overMap(page)  every text box painted over a visible map that is neither a control nor a credit (should be none).
import { expect } from '@playwright/test';

/** The words of a map's state now. @param {import('@playwright/test').Locator} map @returns {Promise<string[]>} */
export const mapState = map => map.evaluate(m => /** @type {any} */ (m).statusLines.map((/** @type {any} */ l) => l.text));

/** A map's one live region. @param {import('@playwright/test').Locator} map */
export const mapSaid = map => map.locator('.gf-map-live');

/** The brief toast. @param {import('@playwright/test').Page} page */
export const brief = page => page.locator('.gf-brief-toast');

/**
 * The map's panel « Carte » opened (its button: at the end of the search pill, or round among its buttons), and its
 * « État ». @param {import('@playwright/test').Locator} map
 */
export async function openPanel(map) {
  await map.getByRole('button', { name: /^Carte : fond, couches, légende/ }).first().click();
  const panel = map.locator('gf-map-panel dialog');
  await expect(panel).toBeVisible();
  return panel;
}

/**
 * The texts over a visible map's box that are not one of its controls (buttons, inputs, the search pill and its
 * results, the point card and the panels the user opened, the mini-apps' own step panels given as `allowed`), nor a
 * credit, nor a scale, nor a marker; nor visually hidden. Each: its text and where it is.
 * @param {import('@playwright/test').Page} page @param {string[]} [allowed] more CSS selectors of what may be there
 * @returns {Promise<{ text: string, path: string }[]>}
 */
export function overMap(page, allowed = []) {
  return page.evaluate(more => {
    /** @param {Document | ShadowRoot} root @returns {Generator<Element>} */
    const deep = function* (root) { for (const el of root.querySelectorAll('*')) { yield el; if (el.shadowRoot) yield* deep(el.shadowRoot); } };
    /** @param {Element} el */
    const up = el => el.parentElement || (el.getRootNode() instanceof ShadowRoot ? /** @type {ShadowRoot} */ (el.getRootNode()).host : null);
    /** @param {Element} el @param {string} sel */
    const closest = (el, sel) => { for (let n = /** @type {Element | null} */ (el); n; n = up(n)) if (n.matches?.(sel)) return n; return null; };
    /** @param {Element} el */
    const path = el => { const p = []; for (let n = /** @type {Element | null} */ (el), i = 0; n && i < 5; n = up(n), i++) p.unshift(n.localName + (n.classList?.length ? '.' + [...n.classList].slice(0, 2).join('.') : '')); return p.join(' > '); };
    const all = [...deep(document)];
    const maps = all.filter(e => e.localName === 'gf-map' && e.checkVisibility()).map(m => m.getBoundingClientRect()).filter(r => r.width > 20 && r.height > 20);
    // Controls and credits (rule 5), what the user opened (a card, a panel, a sheet, the step's own panel: rule 6),
    // markers and tiles, the brief toast (checked on its own).
    const ok = ['.leaflet-control-attribution', '.leaflet-control-scale', '.maplibregl-ctrl', '.leaflet-control-zoom', 'button', 'a', 'input', 'select', 'label',
      'gf-map-search', 'gf-point-card', 'gf-map-panel', '.gf-float-tip', '.gf-o3-bar', '.gf-o3-card', '.gf-map-editbar', '.leaflet-marker-pane', '.leaflet-tile-pane',
      '.leaflet-overlay-pane', '.gf-gl-mk', '.gf-gl-dot', '.gf-o3-mk', '.gf-brief-toast', '.hint-once', 'dialog[open]:not(.gf-map3d)', ...more].join(', ');
    /** @type {{ text: string, path: string }[]} */
    const found = [];
    for (const el of all) {
      const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
      if (!own || el.localName === 'style' || el.localName === 'script') continue;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const b = el.getBoundingClientRect();
      // Visually hidden (1 px, clipped): read by screen readers only.
      if (b.width <= 2 || b.height <= 2) continue;
      if (!maps.some(r => b.right > r.left + 1 && b.left < r.right - 1 && b.bottom > r.top + 1 && b.top < r.bottom - 1)) continue;
      if (closest(el, ok)) continue;
      // Seen there (on top at its middle: not under a sheet or a panel), through the shadow roots.
      const x = b.left + b.width / 2, y = b.top + b.height / 2;
      let top = document.elementFromPoint(x, y);
      while (top?.shadowRoot) { const inner = top.shadowRoot.elementFromPoint(x, y); if (!inner || inner === top) break; top = inner; }
      if (!top || !(top === el || el.contains(top))) continue;
      found.push({ text: own.slice(0, 160), path: path(el) });
    }
    return found;
  }, allowed);
}
