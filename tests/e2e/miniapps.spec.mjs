// The mini-apps (app/miniapps), each alone on the screen at #/app/<id>/<step>: opened from the launcher, the old
// addresses of Découvrir leading to them, their steps in the address, « Rejouer » (confirmed) emptying what each owns
// and only that, back at its first step — and still empty after a reload. Rencontres' services answered here.
import { test, expect, plantId, answerAround } from './fixtures.mjs';

test.use({ reducedMotion: 'reduce' });
test.beforeEach(({ context }) => answerAround(context));

/** The step of the address (#/app/<id>/<step>). @param {import('@playwright/test').Page} page */
const step = page => page.evaluate(() => /^#\/app\/[^/]+\/([^?]+)/.exec(location.hash)?.[1] ?? null);

/** « Rejouer » from the box's ⋯, confirmed in its dialog. @param {import('@playwright/test').Page} page */
async function replay(page) {
  const box = page.locator('gf-miniapp');
  await box.locator('.more summary').click();
  await box.locator('.menu').getByRole('button', { name: 'Rejouer' }).click();
  const dialog = box.getByRole('dialog');
  await expect(dialog).toContainText('Rejouer : tout recommencer depuis le début ?');
  await expect(dialog).toContainText('Les données de cette partie seront effacées.');
  await dialog.getByRole('button', { name: 'Rejouer' }).click();
  await expect(dialog).toBeHidden();
}

test('le lanceur ouvre une mini-application seule à l’écran ; « Quitter » ramène d’où l’on venait', async ({ app, page }) => {
  await app.open('#/collections');
  await page.getByRole('button', { name: 'Scénarios' }).locator('visible=true').first().click();
  await page.getByRole('dialog').locator('li[data-app="parcours"]').getByRole('button', { name: 'Jouer' }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/app/parcours/start');
  await expect(page.locator('gf-trail .go')).toBeVisible();
  // Alone: no header, no tab bar.
  await expect(page.locator('gf-app header')).toHaveCount(0);
  await expect(page.locator('gf-tabbar')).toHaveCount(0);
  await page.locator('gf-miniapp .quit').click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/collections');
});

test('les anciennes adresses de Découvrir ouvrent les mini-applications', async ({ app, page }) => {
  await app.open('#/discover?s=trail');
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/app/parcours/start');
  await app.go('#/discover?s=meet');
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/app/rencontres/start');
  await expect(page.getByRole('heading', { name: 'Rencontrez les plantes d’ici' })).toBeVisible();
});

test('Rencontres : départ, carte, cartes ; « Rejouer » vide la partie, pas les favoris', async ({ app, page }) => {
  await app.open('#/app/rencontres');
  const discover = page.locator('gf-discover');
  await page.getByRole('button', { name: 'Autour de moi' }).click();
  await expect.poll(() => step(page)).toBe('map');
  await discover.getByRole('button', { name: 'Qui pousse par ici ?' }).click();
  await expect.poll(() => step(page)).toBe('cards');
  const top = discover.locator('.swipe-card.top');
  await expect(top).toHaveAttribute('data-id', String(plantId('Allium ursinum')));
  await page.keyboard.press('ArrowRight');
  const ail = plantId('Allium ursinum');
  await expect.poll(() => page.evaluate(async id => (await import('/app/core/collections.js')).isFavorite(id), ail)).toBe(true);
  expect((await page.evaluate(async () => (await import('/app/core/discover.js')).discoverState())).matches).toEqual([ail]);

  await replay(page);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/app/rencontres/start');
  await expect(page.getByRole('heading', { name: 'Rencontrez les plantes d’ici' })).toBeVisible();
  const empty = { point: null, matches: [], passed: [] };
  const session = () => page.evaluate(async () => { const s = (await import('/app/core/discover.js')).discoverState(); return { point: s.point, matches: s.matches, passed: s.passed }; });
  expect(await session()).toEqual(empty);
  // The favourite is the user's: it stays.
  expect(await page.evaluate(async id => (await import('/app/core/collections.js')).isFavorite(id), ail)).toBe(true);
  await page.reload();
  await app.ready();
  await expect(page.getByRole('heading', { name: 'Rencontrez les plantes d’ici' })).toBeVisible();
  expect(await session()).toEqual(empty);
  expect(await step(page)).toBe('start');
});

test('Parcours : en marche puis « Rejouer » ; le parcours reste dans Mes plantes', async ({ app, page }) => {
  await app.open('#/app/parcours');
  const trail = page.locator('gf-trail');
  await trail.locator('.go').click();
  await expect.poll(() => step(page)).toBe('walk');
  await trail.locator('.card input.name').fill('Chemin du lavoir');
  await trail.locator('.card input.name').press('Enter');
  await trail.locator('.search input').fill('ortie dioique');
  await trail.locator('.hit').filter({ hasText: 'Urtica dioica' }).locator('.add').click();
  await expect(trail.locator('.mine > li')).toHaveCount(1);
  const kept = () => page.evaluate(async () => (await (await import('/app/core/collections.js')).listCollections())
    .find((/** @type {any} */ c) => c.properties.name === 'Chemin du lavoir')?.properties.plants.length ?? null);
  await expect.poll(kept).toBe(1);

  await replay(page);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/app/parcours/start');
  await expect(page.locator('gf-trail .go')).toBeVisible();
  const owned = () => page.evaluate(() => ['geoflora.trail', 'geoflora.trails', 'geoflora.trailDone'].map(k => localStorage.getItem(k)));
  expect(await owned()).toEqual([null, null, null]);
  // The walk itself is a place of Mes plantes: the user's, it stays.
  expect(await kept()).toBe(1);
  await page.reload();
  await app.ready();
  await expect(page.locator('gf-trail .go')).toBeVisible();
  await expect.poll(() => step(page)).toBe('start');
  expect(await owned()).toEqual([null, null, null]);
});

test('Réglages : « Afficher les étapes » toujours, puis jamais', async ({ app, page }) => {
  await app.open('#/settings');
  await page.getByRole('radio', { name: 'Toujours' }).check();
  await app.go('#/app/parcours');
  await expect(page.locator('gf-miniapp ma-steps').getByRole('navigation', { name: 'Étapes' })).toBeVisible();
  await expect(page.locator('gf-miniapp ma-steps [aria-current="step"]')).toContainText('Départ');
  await app.go('#/settings');
  await page.getByRole('radio', { name: 'Jamais' }).check();
  await app.go('#/app/parcours');
  await expect(page.locator('gf-trail .go')).toBeVisible();
  await expect(page.locator('gf-miniapp ma-steps')).toHaveCount(0);
});
