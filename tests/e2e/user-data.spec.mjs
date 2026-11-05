// The user's data (audit, chantier « Données utilisateur »): the plant sheet's notes moved from localStorage to
// IndexedDB without loss, in the GeoJSON export and back (STO-6), alone too (the transfer link names them); a write
// refused for lack of room said on screen, never a false « Enregistré » (STO-5, STO-4); two tabs: a deletion is not
// undone by the other (GAP1-2), a module switched off in one stays off when the other changes another (GAP1-7); a
// device left on an old version: its favourites, lists, lieux, parcours and notes read, its old settings forgotten.
import { readFileSync } from 'node:fs';
import { test, expect, plantId } from './fixtures.mjs';

const NOTE = { id: 'terrain', title: 'Terrain' };

/** A note block in the layout, and (earlier versions) its texts in localStorage — before the app starts. */
async function seedOldNotes(/** @type {import('@playwright/test').BrowserContext} */ context, /** @type {Record<string, string>} */ texts) {
  await context.addInitScript(([note, byPlant]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('geoflora.sheetLayout', JSON.stringify({ notes: [note] }));
    localStorage.setItem('geoflora.plantNotes', JSON.stringify({ [note.id]: byPlant }));
  }, /** @type {const} */ ([NOTE, texts]));
}

const noteText = (/** @type {import('@playwright/test').Page} */ page, /** @type {number} */ id) => page.evaluate(async ([note, plant]) =>
  (await import('/app/core/sheet-notes.js')).noteText(note, plant), /** @type {const} */ ([NOTE.id, id]));

test('notes de fiche : celles des versions précédentes passent dans IndexedDB, sans perte, et restent à l’écran', async ({ app, page, context }) => {
  const ail = plantId('Allium ursinum');
  await seedOldNotes(context, { [ail]: 'Station de 30 pieds, cueilli le 3 avril' });
  await app.open(`#/plant/${ail}`);
  await expect.poll(() => noteText(page, ail)).toBe('Station de 30 pieds, cueilli le 3 avril');
  expect(await page.evaluate(() => localStorage.getItem('geoflora.plantNotes'))).toBeNull();
  expect(await page.evaluate(async () => (await (await import('/app/core/db.js')).getAll('sheetNotes')).map((/** @type {any} */ r) => r.text)))
    .toEqual(['Station de 30 pieds, cueilli le 3 avril']);
  await expect(page.locator('gf-plant-detail textarea.note-text').first()).toHaveValue('Station de 30 pieds, cueilli le 3 avril');
  // Reloaded (the move is done once): still there.
  await page.reload();
  await app.ready();
  await expect.poll(() => noteText(page, ail)).toBe('Station de 30 pieds, cueilli le 3 avril');
});

test('un appareil resté sur une vieille version : ses favoris, listes, lieux, parcours et notes là ; ses vieux réglages oubliés au lancement', async ({ app, page, context }) => {
  const ail = plantId('Allium ursinum');
  const OLD = ['geoflora.sheetBlocks', 'geoflora.sheetHidden', 'geoflora.trails', 'geoflora.zoomPanel', 'geoflora.contextBar'];
  await context.addInitScript(([note, id, old]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('geoflora.sheetLayout', JSON.stringify({ notes: [note] }));
    localStorage.setItem('geoflora.plantNotes', JSON.stringify({ [note.id]: { [id]: 'Station de 30 pieds' } }));
    for (const k of old) localStorage.setItem(k, '{"standard":["map"]}');
    localStorage.setItem('geoflora.discover', JSON.stringify({ done: true, point: [2.35, 48.85], place: 'Paris', radius: 2000, matches: [id], passed: [], tips: ['x'] }));
    localStorage.setItem('geoflora.context', JSON.stringify({ map: '#/map?spot=x', mapPlants: [id] }));
    localStorage.setItem('geoflora.modules', JSON.stringify({ gbif: { epure: false } }));
  }, /** @type {const} */ ([NOTE, ail, OLD]));
  await app.open(`#/plant/${ail}`);
  await expect(page.locator('gf-plant-detail textarea.note-text').first()).toHaveValue('Station de 30 pieds');
  expect(await page.evaluate(keys => keys.map(k => localStorage.getItem(k)), OLD)).toEqual(OLD.map(() => null));
  // Découvrir: its fields only (the games' session and the tips of before gone, given to none).
  const discover = await page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.discover') || '{}'));
  expect(Object.keys(discover).every(k => ['done', 'unlocked', 'announced', 'seen', 'step', 'firstMatch', 'branch'].includes(k))).toBe(true);
  expect(discover.done).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('geoflora.app.rencontres.state'))).toBeNull();
  expect(await app.state('context.map')).toBe('#/map?spot=x');
  // A module cut in one mode: cut for the whole device.
  expect(await page.evaluate(async () => (await import('/app/core/modules.js')).moduleOn('gbif'))).toBe(false);

  // Mes plantes as versions 3 to 5 of the base kept them: a list, a lieu whose plant has no position of its own, a
  // parcours the Parcours made before its mark.
  const at = '2026-10-08T09:00:00.000Z';
  const [ortie, benoite, lierre] = ['Urtica dioica', 'Geum urbanum', 'Hedera helix'].map(plantId);
  await page.evaluate(async ([t, a, b, c]) => {
    const db = await import('/app/core/db.js');
    await db.put('spots', { type: 'Feature', id: 'v4-liste', geometry: null,
      properties: { kind: 'list', name: 'Liste d’avant', notes: '', createdAt: t, updatedAt: t, plantIds: [a], plants: [{ plantId: a, scientificName: 'Urtica dioica', addedAt: t }] } });
    await db.put('spots', { type: 'Feature', id: 'v3-lieu', geometry: { type: 'Point', coordinates: [2.4, 48.9] },
      properties: { name: 'Bois d’avant', notes: '', accuracy: null, createdAt: t, updatedAt: t, plantIds: [b], plants: [{ plantId: b, scientificName: 'Geum urbanum', notes: 'sous les chênes' }] } });
    await db.put('spots', { type: 'Feature', id: 'v5-parcours', geometry: { type: 'Point', coordinates: [2.41, 48.91] },
      properties: { kind: 'place', name: 'Parcours d’avant', notes: '', origin: { app: 'parcours' }, createdAt: t, updatedAt: t, plantIds: [c],
        plants: [{ id: 'e1', plantId: c, scientificName: 'Hedera helix', coordinates: [2.411, 48.911], addedAt: t }] } });
  }, /** @type {const} */ ([at, ortie, benoite, lierre]));
  await page.reload();
  await app.ready();
  await app.go('#/collections');
  const mine = page.locator('gf-collections');
  for (const name of ['Liste d’avant', 'Bois d’avant', 'Parcours d’avant']) await expect(mine).toContainText(name);
  const read = (/** @type {string} */ id) => page.evaluate(async i => (await (await import('/app/core/collections.js')).getPlace(i))?.properties, id);
  expect((await read('v5-parcours'))?.walk).toBe(true);
  expect((await read('v3-lieu'))?.plants.map((/** @type {any} */ e) => [e.plantId, e.coordinates, e.notes])).toEqual([[benoite, [2.4, 48.9], 'sous les chênes']]);
});

test('notes de fiche : dans l’export GeoJSON de Réglages, et de retour sur un autre appareil (STO-6)', async ({ app, page, context, newDevice }) => {
  const ortie = plantId('Urtica dioica');
  await seedOldNotes(context, { [ortie]: 'En soupe au printemps' });
  await app.open('#/');
  await page.evaluate(async id => {
    const db = await import('/app/core/db.js');
    const { toggleFavorite } = await import('/app/core/collections.js');
    await toggleFavorite(await db.get('plants', id));
  }, ortie);
  await app.go('#/settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exporter (fichier GeoJSON)' }).click()]);
  const file = /** @type {string} */ (await download.path());
  const exported = JSON.parse(readFileSync(file, 'utf8'));
  expect(exported.sheetNotes).toEqual([{ id: NOTE.id, title: NOTE.title, texts: { [ortie]: { text: 'En soupe au printemps', updatedAt: expect.any(String) } } }]);

  const other = await newDevice();
  await other.app.open('#/settings');
  await other.page.locator('gf-settings input[type=file][accept*="geojson"]').setInputFiles(file);
  await expect(other.page.locator('gf-settings').getByText(/1 note de fiche/)).toBeVisible();
  expect(await noteText(other.page, ortie)).toBe('En soupe au printemps');
  // The block was made there too, under its title.
  expect(await other.app.state('sheetLayout.notes')).toEqual([NOTE]);
});

test('notes de fiche seules, sans favori, liste ni lieu : exportées, transférées, et le lien les nomme', async ({ app, page, context, newDevice }) => {
  const ortie = plantId('Urtica dioica');
  await seedOldNotes(context, { [ortie]: 'En soupe au printemps' });
  await app.open('#/');
  await expect.poll(() => noteText(page, ortie)).toBe('En soupe au printemps');
  await app.go('#/settings');
  const exportButton = page.getByRole('button', { name: 'Exporter (fichier GeoJSON)' });
  await expect(exportButton).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()]);
  const exported = JSON.parse(readFileSync(/** @type {string} */ (await download.path()), 'utf8'));
  expect(exported.features).toEqual([]);
  expect(exported.sheetNotes).toEqual([{ id: NOTE.id, title: NOTE.title, texts: { [ortie]: { text: 'En soupe au printemps', updatedAt: expect.any(String) } } }]);

  await expect(page.getByRole('button', { name: 'Créer le lien de transfert' })).toBeEnabled();
  const { url } = await page.evaluate(async () => (await import('/app/core/collections.js')).transferLink({ personal: true }));
  const other = await newDevice();
  await other.app.open(url);
  await expect(other.page.locator('gf-shared h1')).toHaveText('1 note de fiche');
  await other.page.locator('gf-shared').getByRole('button', { name: 'Importer' }).click();
  await expect(other.page.locator('gf-shared p[role=status]')).toHaveText('Importé : 0 ajouté, 0 mis à jour, 0 déjà à jour, 1 note de fiche.');
  expect(await noteText(other.page, ortie)).toBe('En soupe au printemps');
});

test('stockage plein : la note n’est pas dite enregistrée, un bandeau dit quoi faire (STO-5)', async ({ app, page, context }) => {
  const ail = plantId('Allium ursinum');
  await seedOldNotes(context, {});
  await app.open(`#/plant/${ail}`);
  const area = page.locator('gf-plant-detail textarea.note-text').first();
  await expect(area).toBeVisible();
  // Every IndexedDB write refused for lack of room from now on.
  await page.evaluate(() => {
    const full = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
    IDBObjectStore.prototype.put = full;
    IDBObjectStore.prototype.add = full;
    IDBObjectStore.prototype.delete = full;
  });
  await area.fill('Station de 30 pieds');
  await expect(page.locator('gf-plant-detail').getByRole('alert')).toContainText('Non enregistré');
  await expect(page.locator('gf-plant-detail').getByText('Enregistré sur cet appareil.')).toHaveCount(0);
  const banner = page.locator('gf-app .full');
  await expect(banner).toContainText('Espace de stockage plein');
  await expect(banner.getByRole('button', { name: 'Exporter mes plantes' })).toBeVisible();
  // Said once: a second refusal does not bring it back once closed.
  await banner.getByRole('button', { name: 'Fermer' }).click();
  await area.fill('Station de 40 pieds');
  await expect(page.locator('gf-plant-detail').getByRole('alert')).toContainText('Non enregistré');
  await expect(page.locator('gf-app .full')).toHaveCount(0);
});

test('deux onglets : un lieu supprimé dans l’un n’est pas recréé par l’éditeur de l’autre (GAP1-2)', async ({ app, page, context }) => {
  await app.open('#/');
  const id = await page.evaluate(async () => {
    const c = await import('/app/core/collections.js');
    return (await c.saveCollection(c.newCollection('list', { name: 'Friche' }))).id;
  });
  await app.go(`#/collection/${id}`);
  const name = page.locator('gf-spot-editor input').first();
  await expect(name).toHaveValue('Friche');
  const other = await context.newPage();
  await other.goto('#/');
  await expect.poll(() => other.evaluate(async () => (await import('/app/core/store.js')).store.state.status)).toBe('ready');
  await other.evaluate(async placeId => (await import('/app/core/collections.js')).deletePlace(placeId), id);
  await name.fill('Friche (corrigé)');
  await expect(page.locator('gf-spot-editor')).toContainText('supprimée entre-temps');
  await page.waitForTimeout(1000);
  expect(await page.evaluate(async placeId => (await import('/app/core/collections.js')).getPlace(placeId), id)).toBeUndefined();
  await other.close();
});

test('deux onglets : un module coupé dans l’un reste coupé quand l’autre en coupe un autre (GAP1-7)', async ({ app, page, context }) => {
  await app.open('#/');
  const other = await context.newPage();
  await other.goto('#/');
  await expect.poll(() => other.evaluate(async () => (await import('/app/core/store.js')).store.state.status)).toBe('ready');
  const set = (/** @type {import('@playwright/test').Page} */ p, /** @type {string} */ key) => p.evaluate(async k => {
    const m = await import('/app/core/modules.js');
    m.setModule(/** @type {any} */ (k), false);
  }, key);
  const on = (/** @type {import('@playwright/test').Page} */ p, /** @type {string} */ key) => p.evaluate(async k => (await import('/app/core/modules.js')).moduleOn(/** @type {any} */ (k)), key);
  await set(page, 'gbif');
  // The other tab follows at once (storage event), and its own change keeps the first.
  await expect.poll(() => on(other, 'gbif')).toBe(false);
  await set(other, 'globi');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.modules') || '{}'));
  expect(Object.keys(stored).sort()).toEqual(['gbif', 'globi']);
  await expect.poll(() => on(page, 'globi')).toBe(false);
  expect(await on(page, 'gbif')).toBe(false);
  await other.close();
});

test('stockage plein au premier lancement : la flore n’est pas retéléchargée en vain, le message dit quoi faire (STO-4)', async ({ page, context }) => {
  // No room for the flora: every write of a plant refused — in the search worker, which stores it (its script served
  // with the refusal first; an init script reaches the page only).
  await context.route(/\/app\/workers\/search\.worker\.js$/, async route => {
    const response = await route.fetch();
    const refuse = `{ const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'plants') throw new DOMException('Quota exceeded', 'QuotaExceededError');
        return put.apply(this, args);
      }; }\n`;
    await route.fulfill({ response, body: refuse + await response.text() });
  });
  let downloads = 0;
  page.on('request', request => { if (/\/data\/plants\.json/.test(request.url())) downloads++; });
  await page.goto('#/');
  const banner = page.locator('gf-app .banner.error');
  await expect(banner).toContainText('Espace de stockage insuffisant');
  await expect(banner).toContainText('Libérez de l’espace');
  expect(downloads).toBe(1);
  // Launched again with no more room: the 11.5 MB are not asked for again.
  await page.reload();
  await expect(banner).toContainText('Espace de stockage insuffisant');
  expect(downloads).toBe(1);
});
