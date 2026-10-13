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
  await expect(dialog).toContainText('Recommencer : tout effacer ?');
  await expect(dialog).toContainText('la partie en cours. Cette action est définitive.');
  await expect(dialog.getByRole('button', { name: 'Annuler' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Rejouer' }).click();
  await expect(dialog).toBeHidden();
}

test('le lanceur ouvre une mini-application seule à l’écran ; « Quitter » ramène d’où l’on venait', async ({ app, page }) => {
  await app.open('#/collections');
  await page.getByRole('button', { name: 'Scénarios' }).locator('visible=true').first().click();
  await page.getByRole('dialog').locator('li[data-app="parcours"]').getByRole('button', { name: 'Jouer' }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/app/parcours/start');
  await expect(page.locator('gf-miniapp .go')).toBeVisible();
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

test('Rencontres : départ, carte, cartes ; « Rejouer » vide la partie et ses favoris, pas ceux d’ailleurs', async ({ app, page }) => {
  await app.open('#/app/rencontres');
  await page.getByRole('button', { name: 'Autour de moi' }).click();
  await expect.poll(() => step(page)).toBe('map');
  await page.locator('ma-distance').getByRole('button', { name: 'Qui pousse par ici ?' }).click();
  await expect.poll(() => step(page)).toBe('cards');
  // Back: the step before (the map), Forward: the cards again.
  await page.goBack();
  await expect.poll(() => step(page)).toBe('map');
  await page.goForward();
  await expect.poll(() => step(page)).toBe('cards');
  const top = page.locator('ma-deck .swipe-card.top');
  await expect(top).toHaveAttribute('data-id', String(plantId('Allium ursinum')));
  await page.keyboard.press('ArrowRight');
  const ail = plantId('Allium ursinum');
  await expect.poll(() => page.evaluate(async id => (await import('/app/core/collections.js')).isFavorite(id), ail)).toBe(true);
  const session = () => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('geoflora.app.rencontres.state') || 'null')?.ctx; return s ? { point: s.point, matches: s.matches, passed: s.passed } : null; });
  await expect.poll(async () => (await session())?.matches).toEqual([ail]);
  // Its first match brought its photos: on a phone full screen over the deck, closed (Échap) before the box's ⋯.
  if (await page.evaluate(() => innerWidth < 900)) {
    await expect(page.locator('ma-meet-media[mode="dialog"]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('ma-meet-media')).toHaveCount(0);
  }
  // A favourite from elsewhere (Flore), kept.
  const ortie = plantId('Urtica dioica');
  await page.evaluate(async id => { const db = await import('/app/core/db.js'); await (await import('/app/core/collections.js')).toggleFavorite(await db.get('plants', id)); }, ortie);

  await replay(page);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/app/rencontres/start');
  await expect(page.getByRole('heading', { name: 'Rencontrez les plantes d’ici' })).toBeVisible();
  // Nothing kept: the game, and the favourite its match added, gone; the one from Flore stays.
  expect(await session()).toBe(null);
  await expect.poll(() => page.evaluate(async id => (await import('/app/core/collections.js')).isFavorite(id), ail)).toBe(false);
  expect(await page.evaluate(async id => (await import('/app/core/collections.js')).isFavorite(id), ortie)).toBe(true);
  await page.reload();
  await app.ready();
  await expect(page.getByRole('heading', { name: 'Rencontrez les plantes d’ici' })).toBeVisible();
  expect(await session()).toBe(null);
  expect(await step(page)).toBe('start');
});

test('Parcours : en marche puis « Rejouer » ; le parcours enregistré quitte Mes plantes', async ({ app, page }) => {
  await app.open('#/app/parcours');
  const trail = page.locator('gf-miniapp');
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
  await expect(page.locator('gf-miniapp .go')).toBeVisible();
  const owned = () => page.evaluate(() => ['geoflora.trail', 'geoflora.trails', 'geoflora.trailDone'].map(k => localStorage.getItem(k)));
  expect(await owned()).toEqual([null, null, null]);
  // The walk it saved in Mes plantes is its own: gone too.
  await expect.poll(kept).toBe(null);
  await page.reload();
  await app.ready();
  await expect(page.locator('gf-miniapp .go')).toBeVisible();
  await expect.poll(() => step(page)).toBe('start');
  expect(await owned()).toEqual([null, null, null]);
});

test('Parcours : ses étapes (Départ › En marche › Bilan), Retour étape par étape ; l’adresse sans étape retrouve la marche', async ({ app, page }) => {
  await app.open('#/discover');
  await app.go('#/app/parcours');
  await expect.poll(() => step(page)).toBe('start');
  const box = page.locator('gf-miniapp');
  await box.locator('.go').click();
  await expect.poll(() => step(page)).toBe('walk');
  await box.locator('.search input').fill('ortie dioique');
  await box.locator('.hit').filter({ hasText: 'Urtica dioica' }).locator('.add').click();
  await expect(box.locator('.mine > li')).toHaveCount(1);
  // Back: the start, the walk under way offered first to take up; Forward: the walk again.
  await page.goBack();
  await expect.poll(() => step(page)).toBe('start');
  await expect(page.getByRole('group', { name: 'Reprendre un parcours' })).toContainText('1 plante');
  await page.goForward();
  await expect.poll(() => step(page)).toBe('walk');
  // The address with no step: the walk under way, at once.
  await app.go('#/app/parcours');
  await expect.poll(() => step(page)).toBe('walk');
  await expect(box.locator('.mine > li')).toHaveCount(1);
  await box.locator('.end').click();
  await expect.poll(() => step(page)).toBe('done');
  await expect(page.getByRole('heading', { level: 1, name: 'Parcours terminé' })).toBeVisible();
  await page.reload();
  await app.ready();
  await expect(page.getByRole('heading', { level: 1, name: 'Parcours terminé' })).toBeVisible();
  // « Un nouveau parcours »: the start.
  await page.getByRole('button', { name: 'Un nouveau parcours' }).click();
  await expect.poll(() => step(page)).toBe('start');
  await expect(box.locator('.go')).toBeVisible();
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
  await expect(page.locator('gf-miniapp .go')).toBeVisible();
  await expect(page.locator('gf-miniapp ma-steps')).toHaveCount(0);
});
