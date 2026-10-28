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
  // Counted with the favourites apart: neither a list nor a place.
  await expect(page.locator('gf-settings')).toContainText('Sur cet appareil uniquement : vos favoris (1 plante), 1 liste et 1 lieu.');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exporter (fichier GeoJSON)' }).click()]);
  await expect(page.locator('gf-settings p[role=status]').first()).toHaveText('Exporté : vos favoris (1 plante), 1 liste et 1 lieu.');
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
  await expect(other.page.locator('gf-shared h1')).toHaveText('Vos favoris (1 plante), 1 liste et 1 lieu');
  expect(await dump(other.page)).toEqual([]);
  await other.page.locator('gf-shared').getByRole('button', { name: 'Importer' }).click();
  await expect(other.page.locator('gf-shared p[role=status]')).toHaveText('Importé : 3 ajoutés, 0 mis à jour, 0 déjà à jour.');
  expect(await dump(other.page)).toEqual(before);

  // The same link again: updated in place, nothing doubled.
  await other.app.go('#/');
  await other.app.go(url);
  await other.page.locator('gf-shared').getByRole('button', { name: 'Importer' }).click();
  await expect(other.page.locator('gf-shared p[role=status]')).toContainText('Importé');
  expect(await dump(other.page)).toEqual(before);
});

test('copie de secours : ce qui manque à la base, dit — les favoris à part —, puis restauré à l’identique', async ({ app, page }) => {
  await app.open('#/');
  await seed(page);
  const before = await dump(page);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.backup') || 'null')?.features.length)).toBe(3);
  await page.evaluate(async () => {
    const db = await import('/app/core/db.js');
    for (const c of await db.getAll('spots')) await db.remove('spots', c.id);
  });
  await app.go('#/collections');
  const notice = page.locator('gf-collections .notice.restore');
  await expect(notice).toContainText('Dans la copie de secours de cet appareil, mais plus ici : vos favoris (1 plante), 1 liste et 1 lieu (');
  await expect(notice).toContainText('Mellifères');
  await expect(notice).toContainText('Lisière nord');
  await notice.getByRole('button', { name: 'Restaurer' }).click();
  await expect(page.locator('gf-collections p[role=status]').filter({ hasText: 'Restauré' })).toHaveText('Restauré : vos favoris (1 plante), 1 liste et 1 lieu.');
  expect(await dump(page)).toEqual(before);
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

test('lien de partage d’un parcours : « Parcours partagé », sa marche tracée, enregistré en parcours (son départ, ses plantes dans l’ordre)', async ({ app, page, newDevice }) => {
  await app.open('#/');
  const [ortie, ail] = [plantId('Urtica dioica'), plantId('Allium ursinum')];
  // A walk started « ici »: the wild garlic listed first, but met after the nettle.
  const link = await page.evaluate(async ids => {
    const c = await import('/app/core/collections.js');
    const db = await import('/app/core/db.js');
    const s = await import('/app/core/share.js');
    const [nettle, garlic] = await Promise.all(ids.map(id => db.get('plants', id)));
    let walk = c.newPlace([4.8357, 45.7641], { name: 'Chemin du lavoir', notes: 'Parcours botanique', walk: true, startedHere: true });
    walk = c.withPlant(walk, garlic, { coordinates: [4.8366, 45.7649], accuracy: 4 }, { again: true });
    walk = c.withPlant(walk, nettle, { coordinates: [4.8361, 45.7645], accuracy: 5 }, { again: true });
    walk = c.withEntry(walk, walk.properties.plants[0].id, { addedAt: '2026-10-13T09:30:00.000Z' });
    walk = c.withEntry(walk, walk.properties.plants[1].id, { addedAt: '2026-10-13T09:10:00.000Z' });
    return '#/shared?d=' + await s.encodeCollection(await c.savePlace(walk));
  }, [ortie, ail]);

  const other = await newDevice();
  await other.app.open(link);
  const shared = other.page.locator('gf-shared');
  await expect(shared.locator('.kicker')).toHaveText('Parcours partagé');
  await expect(shared.locator('h1')).toHaveText('Chemin du lavoir');
  await expect(shared).toContainText('L’enregistrement crée un nouveau parcours dans Mes plantes ; rien n’est envoyé.');
  // Its walk on the preview's map: from its start, then plant to plant.
  await expect(shared.locator('gf-map path.gf-walk')).toHaveCount(1);
  await shared.getByRole('button', { name: 'Enregistrer dans Mes plantes' }).click();
  const walks = () => other.page.evaluate(async () => (await (await import('/app/core/collections.js')).listCollections())
    .map((/** @type {any} */ c) => ({ name: c.properties.name, walk: c.properties.walk ?? null, startedHere: c.properties.startedHere ?? null,
      origin: c.properties.origin ?? null, plants: c.properties.plants.map((/** @type {any} */ e) => e.plantId) })));
  // Received: a parcours of the user's own (no activity made it here), its plants in the order met.
  await expect.poll(walks).toEqual([{ name: 'Chemin du lavoir', walk: true, startedHere: true, origin: null, plants: [ortie, ail] }]);
  // Its Parcours offers to continue it.
  await other.app.go('#/app/parcours');
  await expect(other.page.getByRole('group', { name: 'Continuer un parcours' })).toContainText('Chemin du lavoir');
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
  // The layout and the modes only: the Note blocks' texts travel with Mes plantes, Réglages › Cartes stay this device's.
  expect(Object.keys(exported)).toEqual(['app', 'kind', 'version', 'layout', 'modes']);
  await page.evaluate(async () => (await import('/app/core/sheet-blocks.js')).resetAll());
  await page.locator('gf-settings input[type=file][accept^="application/json"]').setInputFiles(file);
  await expect(page.locator('gf-settings p[role=status]').filter({ hasText: /import/i })).toBeVisible();
  expect(await page.evaluate(async () => {
    const sb = await import('/app/core/sheet-blocks.js');
    return [sb.isOnEdge('standard', 'calendar'), sb.isOnEdge('standard', 'uses')];
  })).toEqual([true, true]);
});

/** No share sheet: the link is copied, and kept here (window.__copied). @param {import('@playwright/test').Page} page */
const copyHere = page => page.addInitScript(() => {
  /** @type {any} */ (window).__copied = [];
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (/** @type {string} */ t) => { /** @type {any} */ (window).__copied.push(t); } } });
});
const copiedOn = (/** @type {import('@playwright/test').Page} */ page) => page.evaluate(() => /** @type {any} */ (window).__copied);

test('Partager un lieu demande avant sa position : l’éditeur et Mes plantes', async ({ app, page }) => {
  await copyHere(page);
  await app.open('#/');
  await seed(page);
  const id = await page.evaluate(async () => (await (await import('/app/core/collections.js')).listCollections())
    .find((/** @type {any} */ c) => c.properties.name === 'Lisière nord')?.id);
  await app.go(`#/map?spot=${id}`);
  await page.locator('gf-spot-editor').getByRole('button', { name: 'Partager', exact: true }).click();
  const ask = page.getByRole('alertdialog', { name: 'Partager ce lieu ?' });
  await expect(ask).toContainText('Le lien contiendra la position exacte de ce lieu et de ses 2 plantes.');
  await ask.getByRole('button', { name: 'Annuler' }).click();
  await expect(ask).toHaveCount(0);
  expect(await copiedOn(page)).toEqual([]);

  // Mes plantes: the same question, then the link copied.
  await app.go('#/collections');
  await page.locator('gf-collections').getByRole('button', { name: 'Partager « Lisière nord »' }).click();
  await page.getByRole('alertdialog', { name: 'Partager ce lieu ?' }).getByRole('button', { name: 'Partager' }).click();
  await expect(page.locator('gf-collections .share-note')).toHaveText('Lien copié.');
  const links = await copiedOn(page);
  expect(links).toHaveLength(1);
  expect(links[0]).toMatch(/#\/shared\?d=z/);
});

test('Partager un parcours en cours : demandé, son départ dit ; refusé, il reste au Parcours ; partagé, il est à vous', async ({ app, page, newDevice }) => {
  await copyHere(page);
  await app.open('#/app/parcours');
  const trail = page.locator('gf-miniapp');
  await trail.locator('.go').click();
  await trail.locator('.card input.name').fill('Chemin du lavoir');
  await trail.locator('.card input.name').press('Enter');
  // No plant yet: nothing to share (never where the walker stands alone).
  await expect(trail.locator('.card .end')).toBeVisible();
  await expect(trail.locator('.card .share')).toHaveCount(0);
  await trail.locator('.search input').fill('ortie dioique');
  await trail.locator('.hit').filter({ hasText: 'Urtica dioica' }).locator('.add').click();
  await expect(trail.locator('.mine > li')).toHaveCount(1);
  const owner = () => page.evaluate(async () => {
    const c = (await (await import('/app/core/collections.js')).listCollections()).find((/** @type {any} */ x) => x.properties.name === 'Chemin du lavoir');
    return [c?.properties.origin?.app ?? null, c?.properties.from?.app ?? null];
  });

  await trail.locator('.card .share').click();
  const ask = page.getByRole('alertdialog', { name: 'Partager le parcours ?' });
  await expect(ask).toContainText('Le lien contiendra la position exacte de ce parcours et de sa plante. Son départ est la position où vous étiez quand vous l’avez commencé.');
  await ask.getByRole('button', { name: 'Annuler' }).click();
  await expect(ask).toHaveCount(0);
  expect(await copiedOn(page)).toEqual([]);
  expect(await owner()).toEqual(['parcours', null]);

  await trail.locator('.card .share').click();
  await page.getByRole('alertdialog', { name: 'Partager le parcours ?' }).getByRole('button', { name: 'Partager' }).click();
  await expect(page.locator('.gf-brief-toast')).toContainText('Lien du parcours copié : collez-le où vous voulez');
  await expect.poll(owner).toEqual([null, 'parcours']);
  const [link] = await copiedOn(page);

  const other = await newDevice();
  await other.page.goto(link);
  await expect(other.page.locator('gf-shared .kicker')).toHaveText('Parcours partagé');
  await expect(other.page.locator('gf-shared h1')).toHaveText('Chemin du lavoir');
});

test('Exporter (GeoJSON) un lieu : sur téléphone, le fichier annoncé avant la feuille de partage ; sur ordinateur, téléchargé', async ({ app, page }) => {
  // A phone's share sheet: it takes files, and keeps the names of those it was given.
  await page.addInitScript(() => {
    /** @type {any} */ (window).__sent = [];
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (/** @type {any} */ data) => { /** @type {any} */ (window).__sent.push(...data.files.map((/** @type {File} */ f) => f.name)); } });
  });
  await app.open('#/');
  await seed(page);
  const id = await page.evaluate(async () => (await (await import('/app/core/collections.js')).listCollections())
    .find((/** @type {any} */ c) => c.properties.name === 'Lisière nord')?.id);
  await app.go(`#/map?spot=${id}`);
  const exportButton = page.locator('gf-spot-editor').getByRole('button', { name: 'Exporter (GeoJSON)' });
  const sent = () => page.evaluate(() => /** @type {any} */ (window).__sent);
  if (app.phone) {
    await exportButton.click();
    const ask = page.getByRole('alertdialog', { name: 'Envoyer ce fichier ?' });
    await expect(ask).toContainText('Le fichier contient la position exacte de ce lieu et de ses 2 plantes, vos notes et vos journaux de récolte.');
    await ask.getByRole('button', { name: 'Annuler' }).click();
    await expect(ask).toHaveCount(0);
    expect(await sent()).toEqual([]);
    await exportButton.click();
    await page.getByRole('alertdialog', { name: 'Envoyer ce fichier ?' }).getByRole('button', { name: 'Envoyer' }).click();
    await expect.poll(sent).toEqual([expect.stringMatching(/^geoflora-lisiere-nord-\d{4}-\d{2}-\d{2}\.geojson$/)]);
  } else {
    // A computer: downloaded at once, nothing asked.
    const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()]);
    expect(download.suggestedFilename()).toMatch(/^geoflora-lisiere-nord-/);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(await sent()).toEqual([]);
  }
});
