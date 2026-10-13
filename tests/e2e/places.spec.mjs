// Mes plantes and the Carte: a place saved shows in the list of collections, on the map, and opens in its editor
// with its plants. Migrated from places.cjs, mine.cjs, coll.cjs, map.cjs, mapedit.cjs, newplace.cjs.
import { test, expect, plantId } from './fixtures.mjs';

/** A place with two plants, a list with one. @param {import('@playwright/test').Page} page */
const seed = page => page.evaluate(async ids => {
  const c = await import('/app/core/collections.js');
  const db = await import('/app/core/db.js');
  const [ail, ortie] = await Promise.all(ids.map(id => db.get('plants', id)));
  const place = c.withPlant(c.withPlant(c.newPlace([2.351, 48.851], { name: 'Bois de la Source' }), ail), ortie, [2.3512, 48.8509]);
  await c.saveCollection(place);
  await c.saveCollection(c.withPlant(c.newCollection('list', { name: 'À cueillir' }), ail));
  return place.id;
}, [plantId('Allium ursinum'), plantId('Urtica dioica')]);

test('Mes plantes : le lieu et la liste enregistrés y sont', async ({ app, page }) => {
  await app.open('#/');
  await seed(page);
  await app.go('#/collections');
  const mine = page.locator('gf-collections');
  await expect(mine.getByText('Bois de la Source').first()).toBeVisible();
  await expect(mine.getByText('À cueillir').first()).toBeVisible();
});

test('Carte : le lieu en repère ; son éditeur montre ses plantes', async ({ app, page }) => {
  await app.open('#/');
  const id = await seed(page);
  await app.go(`#/map?spot=${id}`);
  await expect.poll(() => page.locator('gf-map-page .leaflet-marker-icon').count()).toBeGreaterThanOrEqual(1);
  await app.go(`#/collection/${id}`);
  const editor = page.locator('gf-spot-editor');
  await expect(editor.locator('input').first()).toHaveValue('Bois de la Source');
  await expect(editor.getByText('Ail des ours').first()).toBeVisible();
  await expect(editor.getByText('Ortie dioïque').first()).toBeVisible();
});

test('Flore « Voir dans Flore » d’une collection : exactement ses plantes', async ({ app, page }) => {
  await app.open('#/');
  await seed(page);
  const listId = await page.evaluate(async () => (await (await import('/app/core/collections.js')).listCollections())
    .find((/** @type {any} */ c) => c.properties.name === 'À cueillir')?.id);
  await app.go(`#/?mine=${listId}`);
  await expect.poll(() => app.state('results.total')).toBe(1);
  expect((await app.state('results.items'))[0].id).toBe(plantId('Allium ursinum'));
});
