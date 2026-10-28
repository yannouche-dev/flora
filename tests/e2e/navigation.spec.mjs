// Navigation: « Fermer la fiche » goes back to the view the sheet was opened from — Flore's list, Mes plantes' list or
// place — past the plants gone through with ‹ ›, never adding an entry; opened from elsewhere (another tab, a link, the
// start), the list takes its place. A block's pane closes the same way, onto the plant it was opened from
// (core/history.js sheetMark, closeTo). On both widths the sheet's head has its × « Fermer la fiche », and Échap closes
// it (Flore: its pane first).
import { test, expect, plantId } from './fixtures.mjs';

/** @typedef {import('@playwright/test').Page} Page */

const hash = (/** @type {Page} */ page) => page.evaluate(() => location.hash);
/** The entries of this tab's history (closing a sheet never adds one). @param {Page} page */
const entries = page => page.evaluate(() => history.length);
/** The depth of the current entry in this visit (core/history.js). @param {Page} page */
const depthOf = page => page.evaluate(() => history.state?.gfDepth);

/** Flore's plant sheet closed: the × of its head (the phone's sheet, the desktop's pane). @param {import('./app.mjs').App} app @param {Page} page */
const closeFlore = (app, page) => page.locator(app.phone ? 'gf-flora .sheet-plant .pane-head' : 'gf-flora #flore-plant .pane-head')
  .getByRole('button', { name: 'Fermer la fiche' }).click();

/** ← → to the next plant of the results, once the address shows it. @param {Page} page */
async function nextPlant(page) {
  const was = await hash(page);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => hash(page)).not.toBe(was);
  expect(await hash(page)).toMatch(/^#\/plant\/\d+/);
}

test('Flore : « Fermer la fiche » revient à la liste d’où elle a été ouverte, en passant les plantes parcourues', async ({ app, page }) => {
  await app.open('#/settings');
  await app.go('#/?family=Rosaceae');
  await expect.poll(() => app.state('results.total')).toBeGreaterThan(3);
  await page.locator('gf-flora gf-plant-list gf-plant-card a.row').first().click();
  await expect.poll(() => hash(page)).toMatch(/^#\/plant\/\d+$/);
  await nextPlant(page);
  await nextPlant(page);
  const n = await entries(page);
  await closeFlore(app, page);
  await expect.poll(() => hash(page)).toBe('#/?family=Rosaceae');
  expect(await entries(page)).toBe(n);
  expect(await depthOf(page)).toBe(1);
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/settings');
});

test('Flore : une fiche ouverte d’ailleurs se ferme sur la liste de Flore, à sa place ; Retour ramène d’où elle venait', async ({ app, page }) => {
  await app.open('#/?family=Rosaceae');
  await app.go('#/settings');
  await app.go(`#/plant/${plantId('Geum urbanum')}`);
  await expect.poll(() => app.state('query.filters.family')).toEqual(['Rosaceae']);
  await expect(page.locator('gf-flora gf-plant-detail:not([preview])').first()).toBeVisible();
  await nextPlant(page);
  const n = await entries(page);
  await closeFlore(app, page);
  await expect.poll(() => hash(page)).toBe('#/?family=Rosaceae');
  expect(await entries(page)).toBe(n);
  expect(await depthOf(page)).toBe(2);
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/settings');
});

test('Flore : ouverte au démarrage, la liste prend sa place', async ({ app, page }) => {
  await app.open(`#/plant/${plantId('Geum urbanum')}`);
  const n = await entries(page);
  await closeFlore(app, page);
  await expect.poll(() => hash(page)).toBe('#/');
  expect(await entries(page)).toBe(n);
  expect(await depthOf(page)).toBe(0);
});

test('Flore : un panneau, puis ‹ › ; un panneau après un rechargement', async ({ app, page }) => {
  test.skip(app.phone, 'the pane beside the sheet: a wide screen');
  await app.open('#/?family=Rosaceae');
  await page.locator('gf-flora gf-plant-list gf-plant-card a.row').first().click();
  await expect.poll(() => hash(page)).toMatch(/^#\/plant\/\d+$/);
  const p1 = await hash(page);
  const toPane = page.locator('gf-flora #flore-plant gf-plant-detail:not([preview]) button.to-pane').first();
  const closePane = page.locator('gf-flora .block-pane').getByRole('button', { name: 'Fermer le panneau' });
  // A pane, then the next plant (its pane with it), then the pane closed: that plant without it, in place.
  await toPane.click();
  await expect.poll(() => hash(page)).toMatch(/^#\/plant\/\d+\?pane=/);
  await nextPlant(page);
  const p2 = (await hash(page)).split('?')[0];
  expect(p2).not.toBe(p1);
  let n = await entries(page);
  await closePane.click();
  await expect.poll(() => hash(page)).toBe(p2);
  expect(await entries(page)).toBe(n);
  await page.goBack();
  await expect.poll(() => hash(page)).toMatch(new RegExp('^' + p1.replace(/[?]/g, '\\?') + '(\\?|$)'));
  // Back on the first plant (its pane): Back again to it without, then a pane, a reload, closed: back to the plant.
  await page.goBack();
  await expect.poll(() => hash(page)).toBe(p1);
  await toPane.click();
  await expect.poll(() => hash(page)).toMatch(/^#\/plant\/\d+\?pane=/);
  await page.reload();
  await app.ready();
  n = await entries(page);
  await closePane.click();
  await expect.poll(() => hash(page)).toBe(p1);
  expect(await entries(page)).toBe(n);
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/?family=Rosaceae');
});

/** A place with three plants (Mes plantes). @param {Page} page @returns {Promise<string>} its id */
const seedPlace = page => page.evaluate(async ids => {
  const c = await import('/app/core/collections.js');
  const db = await import('/app/core/db.js');
  const plants = await Promise.all(ids.map(id => db.get('plants', id)));
  const place = plants.reduce((p, plant) => c.withPlant(p, plant), c.newPlace([2.351, 48.851], { name: 'Bois de la Source' }));
  return (await c.savePlace(place)).id;
}, [plantId('Allium ursinum'), plantId('Urtica dioica'), plantId('Geum urbanum')]);

/** Mes plantes' plant sheet closed: the × of its head (the phone's sheet, the desktop's pane). @param {import('./app.mjs').App} app @param {Page} page */
const closeMine = (app, page) => page.locator(app.phone ? 'gf-collections .sheet-plant .pane-head' : 'gf-collections #mine-plant .pane-head')
  .getByRole('button', { name: 'Fermer la fiche' }).click();

test('Mes plantes : la fiche fermée revient au lieu, en passant les plantes parcourues', async ({ app, page }) => {
  await app.open('#/');
  const id = await seedPlace(page);
  await app.go('#/collections');
  const mine = page.locator('gf-collections');
  await mine.locator('button.main', { hasText: 'Bois de la Source' }).click();
  await expect.poll(() => hash(page)).toBe(`#/collections?c=${id}`);
  await mine.locator('ul.plants a').first().click();
  await expect.poll(() => hash(page)).toBe(`#/collections?c=${id}&plant=${plantId('Allium ursinum')}`);
  for (const next of ['Urtica dioica', 'Geum urbanum']) {
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => hash(page)).toBe(`#/collections?c=${id}&plant=${plantId(next)}`);
  }
  const n = await entries(page);
  await closeMine(app, page);
  await expect.poll(() => hash(page)).toBe(`#/collections?c=${id}`);
  expect(await entries(page)).toBe(n);
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/collections');
  if (app.phone) return;
  // The place's map closed beside the plant, then the plant: Mes plantes without the map.
  await page.goForward();
  await expect.poll(() => hash(page)).toBe(`#/collections?c=${id}`);
  await mine.locator('ul.plants a').first().click();
  await expect.poll(() => hash(page)).toMatch(/&plant=/);
  await mine.getByRole('button', { name: 'Fermer la carte' }).click();
  await expect.poll(() => hash(page)).toBe(`#/collections?plant=${plantId('Allium ursinum')}`);
  await closeMine(app, page);
  await expect.poll(() => hash(page)).toBe('#/collections');
  await expect(page.locator('gf-collections section[aria-label="Carte du lieu"]')).toHaveCount(0);
});

test('Échap ferme le panneau, puis la fiche', async ({ app, page }) => {
  test.skip(app.phone, 'the pane beside the sheet, a keyboard: a wide screen');
  await app.open('#/settings');
  await app.go('#/?family=Rosaceae');
  await page.locator('gf-flora gf-plant-list gf-plant-card a.row').first().click();
  await expect.poll(() => hash(page)).toMatch(/^#\/plant\/\d+$/);
  const plant = await hash(page);
  await expect(page.locator('gf-flora #flore-plant').getByRole('button', { name: 'Fermer la fiche' })).toHaveAttribute('title', 'Fermer la fiche (Échap)');
  await page.locator('gf-flora #flore-plant gf-plant-detail:not([preview]) button.to-pane').first().click();
  await expect.poll(() => hash(page)).toMatch(/^#\/plant\/\d+\?pane=/);
  const n = await entries(page);
  await page.keyboard.press('Escape');
  await expect.poll(() => hash(page)).toBe(plant);
  await expect(page.locator('gf-flora .block-pane')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect.poll(() => hash(page)).toBe('#/?family=Rosaceae');
  expect(await entries(page)).toBe(n);
  // No plant open: Échap does nothing.
  await page.keyboard.press('Escape');
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/settings');
});

test('Échap ferme la fiche de Mes plantes', async ({ app, page }) => {
  await app.open('#/');
  const id = await seedPlace(page);
  await app.go('#/collections');
  const mine = page.locator('gf-collections');
  await mine.locator('button.main', { hasText: 'Bois de la Source' }).click();
  await expect.poll(() => hash(page)).toBe(`#/collections?c=${id}`);
  await mine.locator('ul.plants a').first().click();
  await expect.poll(() => hash(page)).toMatch(/&plant=/);
  const head = mine.locator(app.phone ? '.sheet-plant .pane-head' : '#mine-plant .pane-head');
  await expect(head.getByRole('button', { name: 'Fermer la fiche' })).toHaveAttribute('title', app.phone ? 'Fermer (Échap)' : 'Fermer la fiche (Échap)');
  const n = await entries(page);
  await page.keyboard.press('Escape');
  await expect.poll(() => hash(page)).toBe(`#/collections?c=${id}`);
  expect(await entries(page)).toBe(n);
  await expect(mine.locator('#mine-plant, .sheet-plant')).toHaveCount(0);
});
