// Premiers pas : un lien ouvre toujours son écran ; les onglets suivent ce que l'appareil garde. During the first
// steps a tab not come yet is only missing from the bar: an address — a shared link, a bookmark, a link of the app,
// Back — opens its screen, and its tab comes with it (core/discover.js arrivedAt); the start alone (`#/`) leads to
// Découvrir, and Découvrir, the activities, Réglages and its screens bring none. The tabs follow what the device holds
// (a favourite, a list or a lieu: Mes plantes; a lieu: the Carte): at the start, after an import (a file, a transfer
// link), a restore of the backup copy and « Revoir les premiers pas ».
import { test, expect, plantId } from './fixtures.mjs';
import { writeFileSync } from 'node:fs';

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

test('au démarrage, les listes et les lieux de l’appareil font venir Mes plantes et la Carte', async ({ app, page }) => {
  await app.open('#/discover');
  await page.evaluate(async () => {
    const c = await import('/app/core/collections.js');
    await c.saveCollection(c.newCollection('list', { name: 'Bois' }));
    await c.saveCollection(c.newPlace([4.8357, 45.7641], { name: 'Lisière nord' }));
    // A device of before: its lists and lieux, no tab come.
    localStorage.setItem('geoflora.discover', JSON.stringify({ done: false, unlocked: [], seen: [], step: 0 }));
  });
  await page.goto('about:blank');
  await app.open('#/discover');
  await expect.poll(() => app.tabs()).toEqual(bar(app, ['Carte', 'Mes plantes']));
  expect((await discover(page)).done).toBe(false);
});

test('un fichier importé dans Réglages fait venir Mes plantes et la Carte', async ({ app, page }, info) => {
  const file = info.outputPath('lieux.geojson');
  writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'bois', geometry: null, properties: { kind: 'list', name: 'Bois', plants: [] } },
    { type: 'Feature', id: 'lisiere', geometry: { type: 'Point', coordinates: [4.8357, 45.7641] }, properties: { kind: 'place', name: 'Lisière nord', plants: [] } }
  ] }));
  await app.open('#/settings');
  expect(await app.tabs()).toEqual(bar(app, []));
  await page.locator('gf-settings input[type=file][accept*="geojson"]').setInputFiles(file);
  await expect.poll(() => app.tabs()).toEqual(bar(app, ['Carte', 'Mes plantes']));
});

test('un lien de transfert pendant les premiers pas : Mes plantes avec l’aperçu, la Carte avec l’import', async ({ app, page, newDevice }) => {
  await app.open('#/discover');
  await seed(page);
  const { url } = await page.evaluate(async () => (await import('/app/core/collections.js')).transferLink({ personal: true }));
  const other = await newDevice();
  // The other device in its first steps, none of its tabs come (once: a reload keeps what it has).
  await other.page.addInitScript(() => {
    if (sessionStorage.getItem('first-steps')) return;
    sessionStorage.setItem('first-steps', '1');
    localStorage.setItem('geoflora.discover', JSON.stringify({ done: false, unlocked: [] }));
  });
  await other.app.open(url);
  await expect(other.page.locator('gf-shared h1')).toHaveText('Vos favoris (1 plante), 1 liste et 1 lieu');
  // The preview, not saved yet: its address brought Mes plantes.
  await expect.poll(() => other.app.tabs()).toEqual(bar(other.app, ['Mes plantes']));
  await other.page.locator('gf-shared').getByRole('button', { name: 'Importer' }).click();
  await expect.poll(() => other.app.tabs()).toEqual(bar(other.app, ['Carte', 'Mes plantes']));
});

test('la copie de secours restaurée fait venir la Carte', async ({ app, page }) => {
  await app.open('#/discover');
  await seed(page);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.backup') || 'null')?.features.length)).toBe(3);
  await page.evaluate(async () => {
    const db = await import('/app/core/db.js');
    for (const c of await db.getAll('spots')) await db.remove('spots', c.id);
    localStorage.setItem('geoflora.discover', JSON.stringify({ done: false, unlocked: [] }));
  });
  await page.goto('about:blank');
  await app.open('#/collections');
  // The address brought Mes plantes; the base holds nothing.
  await expect.poll(() => app.tabs()).toEqual(bar(app, ['Mes plantes']));
  await page.locator('gf-collections .notice.restore').getByRole('button', { name: 'Restaurer' }).click();
  await expect.poll(() => app.tabs()).toEqual(bar(app, ['Carte', 'Mes plantes']));
});

test('« Revoir les premiers pas » garde les onglets de vos listes et de vos lieux', async ({ app, page }) => {
  await app.open('#/discover');
  await seed(page);
  await app.go('#/settings');
  await page.getByRole('button', { name: 'Tout montrer maintenant' }).click();
  await page.getByRole('button', { name: 'Revoir les premiers pas' }).click();
  await page.getByRole('alertdialog', { name: 'Revoir les premiers pas ?' }).getByRole('button', { name: 'Revoir les premiers pas' }).click();
  await expect.poll(() => hash(page)).toBe('#/discover');
  // There at once; Flore waits for 5 new plants.
  await expect.poll(() => app.tabs()).toEqual(bar(app, ['Carte', 'Mes plantes']));
  const state = await discover(page);
  expect({ done: state.done, unlocked: state.unlocked }).toEqual({ done: false, unlocked: ['mine', 'map'] });
});
