// Découvrir on a first launch: the list of the activities, then « Rencontres » (the activity): around me, a map of
// the observations, cards of the plants seen around (the most observed first), a heart keeps one (favourites), and the
// steps lead to the whole app. iNaturalist, Wikidata and Wikipédia answered here. Migrated from discover2.cjs,
// discoverscope.cjs, meetstart.cjs, meetmatch.cjs.
import { test, expect, plantId, answerAround } from './fixtures.mjs';

// No hint animation of the top card: the keys alone move the cards.
test.use({ firstVisit: true, reducedMotion: 'reduce' });

test.beforeEach(({ context }) => answerAround(context));

test('autour de moi : la carte des observations, puis les cartes, la plus observée d’abord', async ({ app, page }) => {
  await app.open('#/');
  await page.locator('gf-launcher li[data-app="rencontres"]').getByRole('button', { name: 'Commencer : Rencontres' }).click();
  await page.getByRole('button', { name: 'Autour de moi' }).click();
  const discover = page.locator('ma-guided');
  await expect(discover.locator('.g-steps li.on .l')).toHaveText('Carte');
  const map = discover.locator('.g-mapbox gf-map');
  await expect(map.locator('path.gf-area')).toHaveCount(1);
  await expect(map.locator('.gf-obs-leaf')).toHaveCount(30);

  await discover.locator('.g-steps [data-step="go"]').click();
  await expect(discover.locator('.g-steps li.on .l')).toHaveText('Rencontres');
  const top = discover.locator('.swipe-card.top');
  await expect(top.locator('h2')).toContainText('Allium ursinum');
  await expect(top).toHaveAttribute('data-id', String(plantId('Allium ursinum')));
  await expect(top.locator('.ethno')).toContainText('ursus');
});

test('un cœur (→) garde la plante dans les favoris, un passage (←) montre la suivante', async ({ app, page }) => {
  await app.open('#/app/rencontres');
  await page.getByRole('button', { name: 'Autour de moi' }).click();
  const discover = page.locator('ma-guided');
  await discover.locator('.g-steps [data-step="go"]').click();
  const top = discover.locator('.swipe-card.top');
  await expect(top).toHaveAttribute('data-id', String(plantId('Allium ursinum')));
  await page.keyboard.press('ArrowLeft');
  await expect(top).toHaveAttribute('data-id', String(plantId('Taraxacum officinale')));
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(async id => (await import('/app/core/collections.js')).isFavorite(id), plantId('Taraxacum officinale'))).toBe(true);
  expect(await page.evaluate(async id => (await import('/app/core/collections.js')).isFavorite(id), plantId('Allium ursinum'))).toBe(false);
  // The first match: on to the photos step, no full-screen modal.
  await expect(discover.locator('.g-steps li.on .l')).toHaveText('Photos');
  await expect(discover.locator('.match')).toHaveCount(0);
});

test('« Passer » montre toute l’application ; « Revoir les premiers pas » la cache de nouveau', async ({ app, page }) => {
  await app.open('#/');
  await page.getByRole('link', { name: 'Passer : montrer toute l’application' }).click();
  await expect.poll(() => app.tabs()).toEqual(expect.arrayContaining(['Flore', 'Carte', 'Mes plantes']));
  expect(await page.evaluate(async () => (await import('/app/core/discover.js')).discoverState().done)).toBe(true);
  await app.go('#/settings');
  // What it empties too, said under it.
  await expect(page.getByText('Rencontres, Cueillette prudente et Mosaïque repartent alors de zéro ; vos favoris restent.')).toBeVisible();
  await page.getByRole('button', { name: 'Revoir les premiers pas' }).click();
  // Découvrir again: the list of the activities, not Rencontres.
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/discover');
  await expect(page.getByRole('heading', { level: 1, name: 'Découvrir' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rencontrez les plantes d’ici' })).toHaveCount(0);
  const state = await page.evaluate(async () => (await import('/app/core/discover.js')).discoverState());
  expect({ done: state.done, step: state.step }).toEqual({ done: false, step: 0 });
  // Rencontres' game (its place, its matches) forgotten too.
  expect(await page.evaluate(() => localStorage.getItem('geoflora.app.rencontres.state'))).toBe(null);
  await expect.poll(() => app.tabs()).not.toContain('Flore');
});
