// Premiers pas : un lien ouvre toujours son écran ; les onglets suivent ce que l'appareil garde. During the first
// steps a tab not come yet is only missing from the bar: an address — a shared link, a bookmark, a link of the app,
// Back — opens its screen, and its tab comes with it (core/discover.js arrivedAt); the start alone (`#/`) leads to
// Découvrir, and Découvrir, the activities, Réglages and its screens bring none.
import { test, expect, plantId } from './fixtures.mjs';

test.use({ firstVisit: true });

/** @typedef {import('@playwright/test').Page} Page */
const hash = (/** @type {Page} */ page) => page.evaluate(() => location.hash);
/** The first steps as stored. @param {Page} page */
const discover = page => page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.discover') || '{}'));
/** The bar's tabs, Réglages on a phone. @param {import('./app.mjs').App} app @param {string[]} tabs */
const bar = (app, tabs) => ['Découvrir', ...tabs, ...(app.phone ? ['Réglages'] : [])];

/** Favourites, a list and a place with notes, a harvest and a plant off the place's point (roundtrip.spec.mjs). @param {Page} page */
const seed = page => page.evaluate(async ids => {
  const c = await import('/app/core/collections.js');
  const db = await import('/app/core/db.js');
  const [geum, ail, ortie] = await Promise.all(ids.map(id => db.get('plants', id)));
  await c.toggleFavorite(geum);
  await c.saveCollection(c.withPlant(c.withPlant(c.newCollection('list', { name: 'Mellifères' }), geum), ortie));
  let place = c.newPlace([4.8357, 45.7641], { name: 'Lisière nord', notes: 'Parking au bout du chemin' });
  place = c.withPlant(c.withPlant(place, ail), ortie, [4.83581, 45.76402]);
  place = c.withEntry(place, ail.id, { abundance: 'abondant', rating: 4, notes: 'avant floraison', harvests: [{ date: '2026-04-12', quantity: '1 kg', note: '' }] });
  await c.saveCollection(place);
}, [plantId('Geum urbanum'), plantId('Allium ursinum'), plantId('Urtica dioica')]);

const ADDRESSES = [
  { address: '#/?q=ortie', screen: 'gf-flora', tab: 'Flore' },
  { address: '#/map', screen: 'gf-map-page', tab: 'Carte' },
  { address: '#/collections', screen: 'gf-collections', tab: 'Mes plantes' },
  { address: '#/collection/new?kind=place', screen: 'gf-spot-editor', tab: 'Mes plantes' }
];

for (const { address, screen, tab } of ADDRESSES) {
  test(`un lien ouvre toujours son écran : ${address} fait venir ${tab}`, async ({ app, page }) => {
    await app.open(address);
    await expect(page.locator(screen)).toHaveCount(1);
    await expect(page.locator('gf-launcher[page]')).toHaveCount(0);
    expect(await hash(page)).toMatch(new RegExp('^' + address.replace(/[?/]/g, '\\$&')));
    await expect.poll(() => app.tabs()).toEqual(bar(app, [tab]));
  });
}

test('les autres adresses ne font venir aucun onglet ; `#/` seule mène à Découvrir', async ({ app, page }) => {
  await app.open('#/discover');
  const screens = [['#/settings', 'gf-settings'], ['#/legal', 'gf-legal'], ['#/layout/[search(list=0),results(list)]?q=ortie', 'gf-layout'],
    ['#/app/rencontres', 'gf-miniapp'], ['#/nope', 'gf-app .banner:has-text("Page introuvable")']];
  for (const [address, screen] of screens) {
    await app.go(address);
    await expect(page.locator(screen)).toHaveCount(1);
    expect((await discover(page)).unlocked).toEqual([]);
  }
  for (const start of ['#/', '#/?']) {
    await app.go(start);
    await expect.poll(() => hash(page)).toBe('#/discover');
    await expect(page.locator('gf-launcher[page]')).toHaveCount(1);
    expect(await app.tabs()).toEqual(bar(app, []));
  }
  expect((await discover(page)).unlocked).toEqual([]);
});

test('un lien de l’application mène à l’écran de son onglet : « Voir ses plantes dans Flore »', async ({ app, page }) => {
  await app.open('#/discover');
  await seed(page);
  await app.go('#/collections');
  await page.locator('gf-collections a.flore').first().click();
  await expect.poll(() => hash(page)).toBe('#/?mine=favorites');
  await expect(page.locator('gf-flora')).toHaveCount(1);
  await expect(page.locator('gf-launcher[page]')).toHaveCount(0);
  await expect.poll(() => app.tabs()).toContain('Flore');
});

test('un lien de l’application mène à l’écran de son onglet : Réglages › « Personnaliser la fiche »', async ({ app, page }) => {
  await app.open('#/settings');
  await page.locator('gf-settings').getByRole('button', { name: 'Personnaliser la fiche', exact: true }).click();
  await expect.poll(() => hash(page)).toMatch(/^#\/plant\/\d+/);
  await expect.poll(() => app.tabs()).toContain('Flore');
});

test('Flore venue par son adresse : le logo y mène, et l’icône l’ouvre là où on l’avait laissée', async ({ app, page }) => {
  await app.open('#/?family=Rosaceae');
  await expect(page.locator('gf-app a.brand')).toHaveAttribute('aria-label', 'GeoFlora — aller à Flore');
  await expect(page.locator('gf-app a.brand')).toHaveAttribute('href', '#/?family=Rosaceae');
  // Launched from its icon (start_url './', no address).
  await page.goto(new URL('./', page.url()).href);
  await app.ready();
  await expect.poll(() => hash(page)).toBe('#/?family=Rosaceae');
  await expect.poll(() => app.tabs()).toContain('Flore');
});
