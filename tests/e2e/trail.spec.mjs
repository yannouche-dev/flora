// Parcours botanique (Découvrir › Parcours): start a walk, name it, add plants by the search (a tap, or Entrée on the
// fresh first answer), see them on the map. Migrated from trail.cjs, trail2.cjs, trailname.cjs, trailsearch/.
import { test, expect, plantId } from './fixtures.mjs';

/** The walk's saved collection, by name. @param {import('@playwright/test').Page} page @param {string} name */
const saved = (page, name) => page.evaluate(async n => {
  const { listCollections } = await import('/app/core/collections.js');
  const c = (await listCollections()).find((/** @type {any} */ x) => x.properties.name === n);
  return c ? { kind: c.properties.kind, plants: c.properties.plants.map((/** @type {any} */ e) => e.plantId) } : null;
}, name);

test('un parcours : nommé, des plantes ajoutées par la recherche, enregistré et sur la carte', async ({ app, page }) => {
  await app.open('#/app/parcours');
  const trail = page.locator('gf-miniapp');
  await trail.locator('.go').click();
  const name = trail.locator('.card input.name');
  await expect(name).toBeVisible();
  await name.fill('Bord du canal');
  await name.press('Enter');
  await expect.poll(() => saved(page, 'Bord du canal')).toMatchObject({ plants: [] });

  // Every answer of the flora: Prunus spinosa among « prunus ».
  const search = trail.locator('.search input');
  await search.fill('prunus');
  await expect(trail.locator('.hit').filter({ hasText: 'Prunus spinosa' })).toBeVisible();

  // Typed quickly, then Entrée: the plant for the whole word, not for a word typed half-way.
  await search.fill('');
  await search.pressSequentially('prunellier', { delay: 10 });
  await search.press('Enter');
  await expect(trail.locator('.mine > li')).toHaveCount(1);
  await expect(trail.locator('.mine > li').first()).toContainText('Prunus spinosa');
  await expect(search).toHaveValue('');

  // A tap on « + » of an answer.
  await search.fill('ortie dioique');
  await trail.locator('.hit').filter({ hasText: 'Urtica dioica' }).locator('.add').click();
  await expect(trail.locator('.mine > li')).toHaveCount(2);
  await expect.poll(async () => (await saved(page, 'Bord du canal'))?.plants.sort()).toEqual([plantId('Prunus spinosa'), plantId('Urtica dioica')].sort());

  // The map of the walk, beside the list (desktop) or under it (phone): a marker per plant.
  await expect.poll(() => trail.locator('gf-map .leaflet-marker-icon').count()).toBeGreaterThanOrEqual(2);
});

test('le nom du parcours se garde au rechargement', async ({ app, page }) => {
  await app.open('#/app/parcours');
  const trail = page.locator('gf-miniapp');
  await trail.locator('.go').click();
  await trail.locator('.card input.name').fill('Sentier des crêtes');
  await trail.locator('.card input.name').press('Enter');
  await expect.poll(() => saved(page, 'Sentier des crêtes')).not.toBeNull();
  await page.reload();
  await app.ready();
  await expect(page.locator('gf-miniapp .card input.name')).toHaveValue('Sentier des crêtes');
});
