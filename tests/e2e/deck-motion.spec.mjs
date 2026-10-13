// The deck's motion (kit/ma-deck.js): the card underneath rises as the one on top is dragged, and is full size when
// that one has flown — the swap shows no jump; let go too soon, it goes back down. A new card fades in underneath.
import { test, expect, plantId, answerAround } from './fixtures.mjs';

test.use({ reducedMotion: 'no-preference' });
test.beforeEach(({ context }) => answerAround(context));

const AIL = 'Allium ursinum';

/** To Rencontres' cards (a returning visitor). @param {import('@playwright/test').Page} page */
async function toCards(page) {
  await page.getByRole('button', { name: 'Autour de moi' }).click();
  await page.locator('ma-distance').getByRole('button', { name: 'Qui pousse par ici ?' }).click();
  await expect(page.locator('ma-deck .swipe-card.top')).toHaveAttribute('data-id', String(plantId(AIL)));
  await expect(page.locator('ma-deck .swipe-card.under')).toHaveCount(1);
}

/**
 * The width of the card `id` at the very moment it comes on top (its class changes — the swap), and once settled.
 * Measured on the change itself, not frame by frame: a slow machine's frames would miss it.
 * @param {import('@playwright/test').Page} page @param {string} id
 */
const atSwap = (page, id) => page.evaluate(id => new Promise(done => {
  /** The first element matching `sel`, through the shadow roots. @param {ParentNode} root @param {string} sel @returns {Element | null} */
  const deep = (root, sel) => {
    const hit = root.querySelector(sel);
    if (hit) return hit;
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { const h = deep(el.shadowRoot, sel); if (h) return h; }
    return null;
  };
  const root = /** @type {ShadowRoot} */ (deep(document, 'ma-deck')?.shadowRoot);
  const before = /** @type {HTMLElement} */ (root.querySelector(`.swipe-card[data-id="${id}"]`)).getBoundingClientRect().width;
  const seen = new MutationObserver(() => {
    const el = root.querySelector(`.swipe-card[data-id="${id}"]`);
    if (!el?.classList.contains('top')) return;
    seen.disconnect();
    const swap = el.getBoundingClientRect().width;
    setTimeout(() => done({ before, swap, after: el.getBoundingClientRect().width }), 700);
  });
  seen.observe(root, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
}), id);

test('la carte du dessous grandit avec le glissé, sans saut à l’échange', async ({ app, page }) => {
  await app.open('#/app/rencontres');
  await toCards(page);
  const top = page.locator('ma-deck .swipe-card.top'), under = page.locator('ma-deck .swipe-card.under');
  const id = /** @type {string} */ (await under.getAttribute('data-id'));
  const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await top.boundingBox());
  // Dragged a little: the card underneath follows the finger (risen, no delay).
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + box.width * 0.15, box.y + box.height / 2, { steps: 5 });
  await expect(under).toHaveClass(/following/);
  const rise = Number(await under.evaluate(el => /** @type {HTMLElement} */ (el).style.getPropertyValue('--rise')));
  expect(rise).toBeGreaterThan(0.2);
  expect(rise).toBeLessThan(1);
  // Let go too soon: back down, smoothly (no longer following).
  await page.mouse.up();
  await expect(under).not.toHaveClass(/following/);
  await expect.poll(() => under.evaluate(el => /** @type {HTMLElement} */ (el).style.getPropertyValue('--rise'))).toBe('');
  await expect(top).toHaveAttribute('data-id', String(plantId(AIL)));
  // Passed: the card underneath rises while the top one flies, then takes its place — its width never jumps. (A pass:
  // a heart would bring the photos beside the deck, its column narrower.)
  await page.waitForTimeout(400);
  const swapping = atSwap(page, id);
  await page.locator('ma-deck .round.pass').click();
  const w = await swapping;
  await expect(page.locator('ma-deck .swipe-card.top')).toHaveAttribute('data-id', id);
  // The deck's own width (the card on top at rest; its box above may lean, the first time).
  const full = /** @type {{ width: number }} */ (await page.locator('ma-deck .deck').boundingBox()).width;
  // Smaller underneath; full size already when it comes on top (risen while the other flew) — no jump; and it stays so.
  expect(w.before).toBeLessThan(full * 0.97);
  expect(w.swap, 'its width at the swap').toBeGreaterThan(full * 0.98);
  expect(Math.abs(w.after - full), 'on top: full size').toBeLessThan(1.5);
  // The new card underneath fades in; the risen one keeps no rise.
  await expect(page.locator('ma-deck .swipe-card.under')).toHaveCount(1);
  expect(await page.locator('ma-deck .swipe-card.under').evaluate(el => getComputedStyle(el).animationName)).toBe('under-in');
  expect(await page.locator('ma-deck .swipe-card.top').evaluate(el => /** @type {HTMLElement} */ (el).style.getPropertyValue('--rise'))).toBe('');
});
