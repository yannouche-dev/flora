// The phone, by the finger (390 px project only): swiping the cards of Rencontres, a tap on a result, swiping from a
// plant to the next one of the results. Known touch bugs of the audit (GAP3-5) as test.fixme. Migrated from
// tinder.cjs, meetpick.cjs, plantnav.cjs, drag.cjs, review-parcours/a11y-touch.
import { test, expect, plantId } from './fixtures.mjs';
import { centre, swipe } from './touch.mjs';

test.skip(({ hasTouch }) => !hasTouch, 'gestes au doigt : le projet téléphone');

/** Rencontres on its cards, iNaturalist answering with a few plants around. @param {import('@playwright/test').BrowserContext} context */
async function cardsAround(context) {
  const names = ['Allium ursinum', 'Urtica dioica', 'Geum urbanum', 'Hedera helix', 'Bellis perennis'];
  await context.route(/^https:\/\/api\.inaturalist\.org\//, route => {
    const url = new URL(route.request().url());
    const body = /species_counts/.test(url.pathname)
      ? { results: names.map((name, i) => ({ count: 50 - i, taxon: { id: 1000 + i, name, preferred_common_name: null, default_photo: null } })) }
      : { results: [] };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test.describe('Rencontres', () => {
  // No hint (the top card leaning right then left on its own): the finger alone moves the cards.
  test.use({ firstVisit: true, reducedMotion: 'reduce' });

  test('balayer la carte : à droite un cœur (favori), à gauche la suivante', async ({ app, page, context }) => {
    await cardsAround(context);
    await app.open('#/app/rencontres');
    await page.getByRole('button', { name: 'Autour de moi' }).click();
    await page.locator('ma-guided .g-steps [data-step="go"]').click();
    const top = page.locator('ma-guided .swipe-card.top');
    await expect(top).toHaveAttribute('data-id', String(plantId('Allium ursinum')));
    let at = await centre(top);
    await swipe(page, at, { x: at.x - 260, y: at.y + 10 });
    await expect(top).toHaveAttribute('data-id', String(plantId('Urtica dioica')));
    at = await centre(top);
    await swipe(page, at, { x: at.x + 260, y: at.y });
    await expect.poll(() => page.evaluate(async id => (await import('/app/core/collections.js')).isFavorite(id), plantId('Urtica dioica'))).toBe(true);
    expect(await page.evaluate(async id => (await import('/app/core/collections.js')).isFavorite(id), plantId('Allium ursinum'))).toBe(false);
  });

  test.fixme('GAP3-5 : un geste repris par le navigateur (pointercancel) ne décide rien', async ({ app, page, context }) => {
    await cardsAround(context);
    await app.open('#/app/rencontres');
    await page.getByRole('button', { name: 'Autour de moi' }).click();
    await page.locator('ma-guided .g-steps [data-step="go"]').click();
    const top = page.locator('ma-guided .swipe-card.top');
    await expect(top).toHaveAttribute('data-id', String(plantId('Allium ursinum')));
    // The pointer events a finger gives when the browser takes the gesture over (a scroll, a pinch): pointercancel.
    const at = await centre(top);
    const init = (/** @type {number} */ dx) => ({ pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, clientX: at.x + dx, clientY: at.y });
    await top.dispatchEvent('pointerdown', init(0));
    for (const dx of [40, 90, 150, 220]) await top.dispatchEvent('pointermove', init(dx));
    await top.dispatchEvent('pointercancel', init(220));
    // Settled: the card back in place — or, the gesture taken as a decision, the next card on top.
    await expect.poll(() => top.evaluate(el => /** @type {HTMLElement} */ (el).style.transform || '')).toBe('');
    await expect(top).toHaveAttribute('data-id', String(plantId('Allium ursinum')));
    expect(await page.evaluate(async id => (await import('/app/core/collections.js')).isFavorite(id), plantId('Allium ursinum'))).toBe(false);
  });
});

test('Flore : un toucher ouvre la plante, un balayage passe à la suivante des résultats', async ({ app, page }) => {
  await app.open('#/?q=ail');
  const items = /** @type {any[]} */ (await app.state('results.items'));
  expect(items.length).toBeGreaterThan(2);
  await page.getByRole('link', { name: new RegExp('^' + items[0].vernacularName) }).first().tap();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/plant/${items[0].id}`);
  const sheet = page.getByRole('heading', { level: 1, name: items[0].vernacularName });
  await expect(sheet).toBeVisible();
  const at = await centre(sheet);
  await swipe(page, { x: 330, y: at.y + 120 }, { x: 40, y: at.y + 130 }, { steps: 12 });
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/plant/${items[1].id}`);
  await expect(page.getByRole('heading', { level: 1, name: items[1].vernacularName })).toBeVisible();
});
