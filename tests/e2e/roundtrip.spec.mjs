// Round trips of what the user keeps: the GeoJSON file (Réglages › Exporter / Importer), the transfer link to another
// device (#/shared?d=g…), a shared place (#/shared?d=z…), the layout file of the plant sheet. Nothing lost, nothing
// doubled. Migrated from portable.cjs, backup.cjs, m_backup.cjs, places.cjs, layoutfile.cjs, treefile.cjs.
import { test, expect, plantId } from './fixtures.mjs';
import { readFileSync } from 'node:fs';

/** Favourites, a list and a place with notes, a harvest and a plant off the place's point. @param {import('@playwright/test').Page} page */
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

/** What the user entered, comparable across devices (ids and dates of creation aside). @param {import('@playwright/test').Page} page */
const dump = page => page.evaluate(async () => (await (await import('/app/core/collections.js')).listCollections())
  .map((/** @type {any} */ c) => ({
    name: c.id === 'favorites' ? 'Favoris' : c.properties.name, kind: c.properties.kind, notes: c.properties.notes, at: c.geometry?.coordinates ?? null,
    plants: c.properties.plants.map((/** @type {any} */ e) => [e.plantId, e.vernacularName, e.abundance, e.rating, e.notes, e.harvests.length, e.coordinates])
  }))
  .sort((/** @type {any} */ a, /** @type {any} */ b) => a.name.localeCompare(b.name)));

test('fichier GeoJSON : exporté, collections effacées, réimporté à l’identique (noms repris de la flore)', async ({ app, page }) => {
  await app.open('#/');
  await seed(page);
  const before = await dump(page);
  await app.go('#/settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exporter (fichier GeoJSON)' }).click()]);
  const file = /** @type {string} */ (await download.path());
  const text = readFileSync(file, 'utf8');
  const fc = JSON.parse(text);
  expect(fc.type).toBe('FeatureCollection');
  expect(fc.features).toHaveLength(3);
  expect(text, 'la flore n’est jamais recopiée dans le fichier').not.toMatch(/vernacularName|scientificName|plantIds/);
  await page.evaluate(async () => {
    const db = await import('/app/core/db.js');
    for (const c of await db.getAll('spots')) await db.remove('spots', c.id);
  });
  expect(await dump(page)).toEqual([]);
  await page.locator('gf-settings input[type=file][accept*="geojson"]').setInputFiles(file);
  await expect(page.locator('gf-settings p[role=status]').first()).toBeVisible();
  await expect.poll(() => dump(page)).toEqual(before);
});

test('lien de transfert : l’autre appareil importe tout, notes et récoltes comprises, et rien en double', async ({ app, page, newDevice }) => {
  await app.open('#/');
  await seed(page);
  const before = await dump(page);
  await app.go('#/settings');
  await page.getByRole('button', { name: 'Créer le lien de transfert' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Ouvrez-le sur l’autre appareil' })).toBeVisible();
  const { url } = await page.evaluate(async () => (await import('/app/core/collections.js')).transferLink({ personal: true }));
  expect(url).toMatch(/^#\/shared\?d=g/);

  const other = await newDevice();
  await other.app.open(url);
  await expect(other.page.locator('gf-shared h1')).toBeVisible();
  expect(await dump(other.page)).toEqual([]);
  await other.page.locator('gf-shared').getByRole('button', { name: 'Importer' }).click();
  await expect(other.page.locator('gf-shared p[role=status]')).toContainText('Importé');
  expect(await dump(other.page)).toEqual(before);

  // The same link again: updated in place, nothing doubled.
  await other.app.go('#/');
  await other.app.go(url);
  await other.page.locator('gf-shared').getByRole('button', { name: 'Importer' }).click();
  await expect(other.page.locator('gf-shared p[role=status]')).toContainText('Importé');
  expect(await dump(other.page)).toEqual(before);
});

test('lien de partage d’un lieu : aperçu puis « Enregistrer dans Mes plantes »', async ({ app, page, newDevice }) => {
  await app.open('#/');
  await seed(page);
  const link = await page.evaluate(async () => {
    const c = await import('/app/core/collections.js');
    const s = await import('/app/core/share.js');
    const place = (await c.listCollections()).find((/** @type {any} */ x) => x.properties.name === 'Lisière nord');
    return '#/shared?d=' + await s.encodeCollection(place);
  });
  const other = await newDevice();
  await other.app.open(link);
  await expect(other.page.locator('gf-shared h1')).toContainText('Lisière nord');
  await other.page.locator('gf-shared').getByRole('button', { name: 'Enregistrer dans Mes plantes' }).click();
  await expect.poll(async () => (await dump(other.page)).map((/** @type {any} */ c) => [c.name, c.kind, c.at, c.plants.map((/** @type {any} */ e) => e[0])]))
    .toEqual([['Lisière nord', 'place', [4.8357, 45.7641], [plantId('Allium ursinum'), plantId('Urtica dioica')]]]);
});

test('mise en page de la fiche : exportée puis réimportée depuis Réglages', async ({ app, page }) => {
  await app.open('#/');
  await page.evaluate(async () => {
    const sb = await import('/app/core/sheet-blocks.js');
    sb.dockBlock('standard', 'calendar', 'sheet', 'right');
    sb.dockBlock('standard', 'uses', 'sheet', 'bottom');
  });
  await app.go('#/settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exporter la mise en page' }).click()]);
  const file = /** @type {string} */ (await download.path());
  const exported = JSON.parse(readFileSync(file, 'utf8'));
  expect(exported.kind).toBe('sheet-layout');
  await page.evaluate(async () => (await import('/app/core/sheet-blocks.js')).resetAll());
  await page.locator('gf-settings input[type=file][accept^="application/json"]').setInputFiles(file);
  await expect(page.locator('gf-settings p[role=status]').filter({ hasText: /import/i })).toBeVisible();
  expect(await page.evaluate(async () => {
    const sb = await import('/app/core/sheet-blocks.js');
    return [sb.isOnEdge('standard', 'calendar'), sb.isOnEdge('standard', 'uses')];
  })).toEqual([true, true]);
});
