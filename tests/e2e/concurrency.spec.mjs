// Things happening at once: answers of the search worker arriving out of order, two tabs on the same IndexedDB, two
// quick adds. The losses of the audit (GAP1-1, GAP1-2, GAP1-4, GAP1-7) are fixed by db.update (read and write in one
// transaction), the editor saving its edits as a patch, and core/sync.js (BroadcastChannel, the storage event): each
// has its test here. Migrated from samesearch.cjs, dbgkey.cjs, review-fixes/keep-hold.
import { test, expect, plantId } from './fixtures.mjs';
import { App } from './app.mjs';

test('frappe rapide : seule la dernière recherche s’affiche', async ({ app, page }) => {
  await app.open('#/');
  const box = page.getByRole('combobox', { name: 'Rechercher une plante' });
  await box.pressSequentially('ail des ou', { delay: 5 });
  await box.press('Backspace');
  await box.pressSequentially('ours rien', { delay: 5 });
  await box.fill('ortie dioique');
  await expect(page.getByRole('link', { name: /^Ortie dioïque/ })).toBeVisible();
  await expect.poll(() => app.state('query.q')).toBe('ortie dioique');
  expect((await app.state('results.items'))[0].id).toBe(plantId('Urtica dioica'));
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/?q=ortie+dioique');
});

test('deux onglets : un favori ajouté dans l’un est dans l’autre au retour', async ({ app, page, context }) => {
  await app.open('#/');
  const other = await context.newPage();
  await other.goto('#/collections');
  await expect.poll(() => other.evaluate(async () => (await import('/app/core/store.js')).store.state.status)).toBe('ready');
  await page.evaluate(async id => {
    const db = await import('/app/core/db.js');
    const { toggleFavorite } = await import('/app/core/collections.js');
    await toggleFavorite(await db.get('plants', id));
  }, plantId('Geum urbanum'));
  await other.reload();
  await expect.poll(() => other.evaluate(async id => (await import('/app/core/collections.js')).isFavorite(id), plantId('Geum urbanum'))).toBe(true);
  await expect(other.locator('gf-collections').getByText('Favoris').first()).toBeVisible();
  await other.close();
});

test('deux onglets : chacun garde ses lieux, aucun n’efface l’autre', async ({ app, page, context }) => {
  await app.open('#/');
  const other = await context.newPage();
  await other.goto('#/');
  await expect.poll(() => other.evaluate(async () => (await import('/app/core/store.js')).store.state.status)).toBe('ready');
  const save = (/** @type {import('@playwright/test').Page} */ p, /** @type {string} */ name) => p.evaluate(async n => {
    const c = await import('/app/core/collections.js');
    await c.savePlace(c.newPlace([2.35, 48.85], { name: n }));
  }, name);
  await Promise.all([save(page, 'Lieu A'), save(other, 'Lieu B'), save(page, 'Lieu C')]);
  const names = await other.evaluate(async () => (await (await import('/app/core/collections.js')).listCollections()).map((/** @type {any} */ c) => c.properties.name).sort());
  expect(names).toEqual(expect.arrayContaining(['Lieu A', 'Lieu B', 'Lieu C']));
  await other.close();
});

test('deux onglets : un réglage changé dans l’un, l’autre le suit sans recharger', async ({ app, page, context }) => {
  // Flore, a plant open: its results a list beside its sheet (the grid has no compact button).
  const plant = `#/plant/${plantId('Urtica dioica')}`;
  await app.open(plant);
  const other = new App(await context.newPage());
  await other.open(plant);
  const there = other.page;
  // Flore's rows without thumbnails: the compact button there, here too.
  const compact = (/** @type {import('@playwright/test').Page} */ p) => p.locator('gf-flora gf-results-bar').getByRole('button', { name: 'Affichage compact (sans vignettes)' });
  await compact(there).click();
  await expect(compact(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('gf-flora gf-plant-list gf-plant-card').first()).toHaveAttribute('compact', '');
  // Réglages › Affichage, Activités, Carnet de récolte: changed there, shown here.
  await app.go('#/settings');
  await other.go('#/settings');
  await there.locator('gf-settings .mode-line gf-mode-switch').getByRole('button', { name: 'Scientifique — toute l’application' }).click();
  await expect(page.locator('gf-settings .mode-line strong')).toHaveText('Scientifique');
  await there.getByRole('radio', { name: 'Jamais' }).check();
  await expect(page.getByRole('radio', { name: 'Jamais' })).toBeChecked();
  const harvest = (/** @type {import('@playwright/test').Page} */ p) => p.locator('gf-settings').getByRole('checkbox', { name: /Journal de récolte/ });
  await harvest(there).check();
  await expect(harvest(page)).toBeChecked();
  // Ma région; the Trefle token (a placeholder, never a real one): its card here no longer asks for one.
  await there.getByRole('combobox', { name: 'Ma région' }).selectOption('FR-BRE');
  await expect(page.getByRole('combobox', { name: 'Ma région' })).toHaveValue('FR-BRE');
  const trefle = (/** @type {import('@playwright/test').Page} */ p) => p.locator('gf-settings li.module').filter({ hasText: 'trefle.io' });
  await expect(trefle(page).getByText('jeton requis')).toBeVisible();
  await trefle(there).getByPlaceholder('Jeton Trefle').fill('jeton-factice-e2e');
  await trefle(there).getByRole('button', { name: 'Enregistrer' }).click();
  await expect(trefle(page).getByText('jeton requis')).toHaveCount(0);
  await expect(trefle(page).getByRole('checkbox')).toBeEnabled();
  await there.close();
});

test('GAP1-4 : deux « Ajouter » rapprochés dans le parcours gardent les deux plantes', async ({ app, page }) => {
  await app.open('#/app/parcours');
  const trail = page.locator('gf-miniapp');
  await trail.locator('.go').click();
  await trail.locator('.search input').fill('ortie');
  const adds = trail.locator('.hit .add');
  await expect(adds.nth(1)).toBeVisible();
  // Both in the same moment (two mouse clicks from Playwright would interleave: one press would be lost before the app).
  await adds.evaluateAll(buttons => { /** @type {HTMLElement} */ (buttons[0]).click(); /** @type {HTMLElement} */ (buttons[1]).click(); });
  await expect(trail.locator('.mine > li')).toHaveCount(2);
});

test('GAP1-1 : l’éditeur de lieu ouvert n’efface pas une plante ajoutée ailleurs entre-temps', async ({ app, page, context }) => {
  await app.open('#/');
  const id = await page.evaluate(async () => {
    const c = await import('/app/core/collections.js');
    const place = c.newPlace([2.35, 48.85], { name: 'Bois' });
    await c.savePlace(place);
    return place.id;
  });
  await app.go(`#/collection/${id}`);
  const other = await context.newPage();
  await other.goto('#/');
  await expect.poll(() => other.evaluate(async () => (await import('/app/core/store.js')).store.state.status)).toBe('ready');
  await other.evaluate(async ([placeId, plant]) => {
    const db = await import('/app/core/db.js');
    const c = await import('/app/core/collections.js');
    await c.savePlace(c.withPlant(await c.getPlace(placeId), await db.get('plants', plant)));
  }, [id, plantId('Urtica dioica')]);
  // An edit in the open editor (its autosave writes the record back).
  await page.locator('gf-spot-editor input').first().fill('Bois du haut');
  await expect.poll(() => page.evaluate(async placeId => (await (await import('/app/core/collections.js')).getPlace(placeId))?.properties.name, id)).toBe('Bois du haut');
  expect(await page.evaluate(async placeId => (await (await import('/app/core/collections.js')).getPlace(placeId))?.properties.plantIds, id)).toEqual([plantId('Urtica dioica')]);
  await other.close();
});
