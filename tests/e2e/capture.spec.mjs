// « Noter ici » in mode cueillette (SAFE-4): the harvest box is never ticked for you, not even by the last opening;
// a harvest of a plant our sources say is toxic — or protected where it is noted — waits for a warning to be answered
// (gf-harvest-warning, the place editor's too, never the browser's confirm()) — noted without the harvest by default
// (in the place editor, the plant noted already: « Annuler » first, nothing to note without it), with it only once the
// user ticked « J’ai lu cet avertissement ». A plant without toxicity data is noted at once. The
// confusion reminders (« Noter ici », the place editor) show whatever the mode.
import { test, expect, plantId } from './fixtures.mjs';

/**
 * Mode cueillette on (or off), « Noter ici » open.
 * @param {import('@playwright/test').Page} page @param {any} app @param {boolean} [harvest]
 */
async function openCapture(page, app, harvest = true) {
  await app.open('#/');
  await page.evaluate(async on => {
    const { setHarvestMode } = await import('/app/core/store.js');
    setHarvestMode(on);
    document.querySelector('gf-app')?.dispatchEvent(new Event('open-capture'));
  }, harvest);
  const dialog = page.locator('gf-capture dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Position GPS/)).toBeVisible();
  return dialog;
}

/** The harvests noted on a plant in every place. @param {import('@playwright/test').Page} page @param {number} id */
const harvestsOf = (page, id) => page.evaluate(async plant => {
  const c = await import('/app/core/collections.js');
  return (await c.listPlaces()).flatMap((/** @type {any} */ p) => p.properties.plants.filter((/** @type {any} */ e) => e.plantId === plant))
    .map((/** @type {any} */ e) => e.harvests.length);
}, id);

/** Types a name and picks the plant. @param {import('@playwright/test').Locator} dialog @param {string} q @param {string} name */
async function pick(dialog, q, name) {
  await dialog.getByRole('searchbox', { name: 'Chercher une plante' }).fill(q);
  await dialog.locator('gf-plant-pick-list li button').filter({ hasText: name }).first().click();
}

test('Noter ici, mode cueillette : case de récolte décochée ; plante toxique → avertissement bloquant, noté sans récolte', async ({ app, page }) => {
  const dialog = await openCapture(page, app);
  const box = dialog.getByRole('checkbox', { name: 'Noter aussi une récolte aujourd’hui' });
  await expect(box).not.toBeChecked();
  await box.check();
  await pick(dialog, 'Grande ciguë', 'Ciguë maculée');

  const warning = dialog.getByRole('alertdialog', { name: /Plante toxique : récolte déconseillée/ });
  await expect(warning).toBeVisible();
  await expect(warning.getByText(/très fortement toxique/)).toBeVisible();
  await expect(warning.getByText(/liste B/)).toBeVisible();
  await expect(warning.getByRole('link', { name: 'centres-antipoison.net' })).toBeVisible();
  // Nothing noted yet; the harvest only once the warning is read.
  expect(await harvestsOf(page, plantId('Conium maculatum'))).toEqual([]);
  // The safe choice first, focused.
  await expect(warning.getByRole('button', { name: 'Noter sans récolte' })).toBeFocused();
  const anyway = warning.getByRole('button', { name: 'Noter la récolte quand même' });
  await expect(anyway).toBeDisabled();
  await expect(warning.getByRole('checkbox', { name: 'J’ai lu cet avertissement' })).not.toBeChecked();

  await warning.getByRole('button', { name: 'Noter sans récolte' }).click();
  const toast = page.locator('gf-capture .toast');
  await expect(toast).toContainText('noté ici');
  await expect(toast).not.toContainText('récolte notée');
  await expect(toast.getByText(/Plante très toxique, confondue avec : Persil plat/)).toBeVisible();
  expect(await harvestsOf(page, plantId('Conium maculatum'))).toEqual([0]);
});

test('Nouveau lieu, mode cueillette : « Récolté aujourd’hui » décoché ; le cocher pour une plante toxique ouvre l’avertissement de « Noter ici », jamais confirm()', async ({ app, page }) => {
  // On a desktop, the place saved at once moves to the Carte's panel: the editor of a new place is the phone's.
  test.skip(!app.phone, 'éditeur d’un nouveau lieu : téléphone');
  /** The browser's own dialogs (confirm(): its OK would note the harvest): none. @type {string[]} */
  const native = [];
  page.on('dialog', dialog => { native.push(dialog.message()); dialog.dismiss(); });
  await app.open('#/');
  await page.evaluate(async () => (await import('/app/core/store.js')).setHarvestMode(true));
  await app.go(`#/collection/new?kind=place&plant=${plantId('Conium maculatum')}&at=48.851000,2.351000`);
  const editor = page.locator('gf-spot-editor');
  const today = editor.getByRole('checkbox', { name: 'Récolté aujourd’hui' });
  await expect(today).not.toBeChecked();
  await today.click();
  const warning = page.getByRole('alertdialog', { name: /Plante toxique : récolte déconseillée/ });
  await expect(warning).toBeVisible();
  await expect(warning.getByText(/très fortement toxique/)).toBeVisible();
  await expect(warning.getByRole('link', { name: 'centres-antipoison.net' })).toBeVisible();
  // The plant is noted already: no « Noter sans récolte » (it would note nothing), the safe choice « Annuler » first
  // (focused); the harvest only once the warning is read.
  await expect(warning.getByRole('button')).toHaveText(['Annuler', 'Noter la récolte quand même']);
  await expect(warning.getByRole('button', { name: 'Annuler' })).toBeFocused();
  await expect(warning.getByRole('button', { name: 'Noter la récolte quand même' })).toBeDisabled();
  await warning.getByRole('button', { name: 'Annuler' }).click();
  await expect(warning).toHaveCount(0);
  await expect(today).not.toBeChecked();
  // Asked again, read: the harvest.
  await today.click();
  await expect(warning).toBeVisible();
  await warning.getByRole('checkbox', { name: 'J’ai lu cet avertissement' }).check();
  await warning.getByRole('button', { name: 'Noter la récolte quand même' }).click();
  await expect(warning).toHaveCount(0);
  await expect(today).toBeChecked();
  expect(native).toEqual([]);
});

test('Éditeur d’un lieu, mode cueillette : une espèce protégée en France — l’avertissement avant que la récolte soit notée, « Annuler » d’abord', async ({ app, page }) => {
  /** @type {string[]} */
  const native = [];
  page.on('dialog', dialog => { native.push(dialog.message()); dialog.dismiss(); });
  await app.open('#/');
  const moly = plantId('Allium chamaemoly');
  const id = await page.evaluate(async plant => {
    (await import('/app/core/store.js')).setHarvestMode(true);
    const c = await import('/app/core/collections.js');
    const db = await import('/app/core/db.js');
    const place = c.withPlant(c.newPlace([2.351, 48.851], { name: 'Pelouse sèche' }), await db.get('plants', plant));
    await c.saveCollection(place);
    return place.id;
  }, moly);
  await app.go(`#/collection/${id}`);
  const editor = page.locator('gf-spot-editor');
  await editor.locator('li.entry button.head').filter({ hasText: 'Ail faux moly' }).first().click();
  const entry = editor.locator('li.entry.open');
  await entry.getByRole('button', { name: 'Ajouter une récolte' }).click();
  const warning = page.getByRole('alertdialog', { name: 'Espèce protégée : cueillette interdite' });
  await expect(warning).toBeVisible();
  await expect(warning.getByText('Espèce protégée en France : cueillette interdite (INPN)')).toBeVisible();
  // Its verdict: the same chip as on its sheet and its cards.
  await expect(warning.locator('.sev-chip.danger')).toHaveText('Protégée');
  // Said before: nothing noted yet.
  expect(await harvestsOf(page, moly)).toEqual([0]);
  // Noted here already: it stays, without a harvest — « Annuler » the safe choice, first and focused.
  await expect(warning.getByText('Laissez-la où elle pousse : elle reste notée, sans récolte.')).toBeVisible();
  await expect(warning.getByRole('button')).toHaveText(['Annuler', 'Noter la récolte quand même']);
  await expect(warning.getByRole('button', { name: 'Annuler' })).toBeFocused();
  await warning.getByRole('button', { name: 'Annuler' }).click();
  await expect(warning).toHaveCount(0);
  await expect(entry.getByText('Aucune récolte notée.')).toBeVisible();
  expect(await harvestsOf(page, moly)).toEqual([0]);
  expect(native).toEqual([]);
});

test('Noter ici : la récolte d’une plante toxique seulement après « J’ai lu cet avertissement » ; une plante sans donnée, tout de suite', async ({ app, page }) => {
  let dialog = await openCapture(page, app);
  await dialog.getByRole('checkbox', { name: 'Noter aussi une récolte aujourd’hui' }).check();
  await pick(dialog, 'Grande ciguë', 'Ciguë maculée');
  const warning = dialog.getByRole('alertdialog');
  await warning.getByRole('checkbox', { name: 'J’ai lu cet avertissement' }).check();
  await warning.getByRole('button', { name: 'Noter la récolte quand même' }).click();
  await expect(page.locator('gf-capture .toast')).toContainText('récolte notée');
  expect(await harvestsOf(page, plantId('Conium maculatum'))).toEqual([1]);

  // No toxicity in our sources (and no confusion): no warning, the harvest asked is noted.
  await page.evaluate(() => document.querySelector('gf-app')?.dispatchEvent(new Event('open-capture')));
  dialog = page.locator('gf-capture dialog');
  await expect(dialog).toBeVisible();
  const box = dialog.getByRole('checkbox', { name: 'Noter aussi une récolte aujourd’hui' });
  // Ticked for the ciguë, unticked again at this opening.
  await expect(box).not.toBeChecked();
  await box.check();
  await pick(dialog, 'Pâquerette', 'Pâquerette');
  // The ciguë's lieu is right here: offered first, nothing noted until it is chosen (the harvest decided already).
  await dialog.getByRole('region', { name: 'Lieux à proximité' }).getByRole('button', { name: 'Y ajouter Pâquerette vivace' }).click();
  await expect(page.locator('gf-capture .toast')).toContainText(/Pâquerette vivace ajouté au lieu « .+ » · récolte notée/);
  await expect(dialog.getByRole('alertdialog')).toHaveCount(0);
  expect(await harvestsOf(page, plantId('Bellis perennis'))).toEqual([1]);
});

test('Noter ici, mode cueillette éteint : l’ail des ours noté rappelle le colchique (sans case de récolte)', async ({ app, page }) => {
  const dialog = await openCapture(page, app, false);
  await expect(dialog.getByRole('checkbox', { name: 'Noter aussi une récolte aujourd’hui' })).toHaveCount(0);
  await pick(dialog, 'Ail des ours', 'Ail des ours');
  const toast = page.locator('gf-capture .toast');
  await expect(toast).toContainText('noté ici');
  await expect(toast).not.toContainText('récolte notée');
  await expect(toast.getByRole('alert').filter({ hasText: /Ne pas confondre avec : Colchique \(mortel\)/ })).toBeVisible();
  expect(await harvestsOf(page, plantId('Allium ursinum'))).toEqual([0]);
});

test('Noter ici, « Annuler » : la note retirée, et le nouveau lieu avec elle seulement s’il est resté vide', async ({ app, page }) => {
  const places = () => page.evaluate(async () => (await (await import('/app/core/collections.js')).listPlaces())
    .map((/** @type {any} */ p) => [p.properties.name, p.properties.plantIds.length]));
  let dialog = await openCapture(page, app, false);
  await pick(dialog, 'Pâquerette', 'Pâquerette');
  const toast = page.locator('gf-capture .toast');
  await expect(toast).toContainText('Pâquerette vivace noté ici (nouveau lieu)');
  await toast.getByRole('button', { name: 'Annuler' }).click();
  await expect(toast).toHaveCount(0);
  await expect.poll(places).toEqual([]);

  // Again, the lieu named meanwhile (its editor, another tab): « Annuler » takes the plant only, the lieu stays.
  await page.evaluate(() => document.querySelector('gf-app')?.dispatchEvent(new Event('open-capture')));
  dialog = page.locator('gf-capture dialog');
  await expect(dialog.getByText(/Position GPS/)).toBeVisible();
  await pick(dialog, 'Pâquerette', 'Pâquerette');
  await expect(toast).toContainText('Pâquerette vivace noté ici (nouveau lieu)');
  await page.evaluate(async () => {
    const c = await import('/app/core/collections.js');
    const [place] = await c.listPlaces();
    await c.updatePlace(place.id, p => ({ ...p, properties: { ...p.properties, name: 'Mon coin' } }));
  });
  await toast.getByRole('button', { name: 'Annuler' }).click();
  await expect.poll(places).toEqual([['Mon coin', 0]]);
});

test('Éditeur d’un lieu, mode cueillette éteint : l’ail des ours ouvert montre le colchique, pas la qualité', async ({ app, page }) => {
  await app.open('#/');
  const id = await page.evaluate(async plant => {
    (await import('/app/core/store.js')).setHarvestMode(false);
    const c = await import('/app/core/collections.js');
    const db = await import('/app/core/db.js');
    const place = c.withPlant(c.newPlace([2.351, 48.851], { name: 'Sous-bois' }), await db.get('plants', plant));
    await c.saveCollection(place);
    return place.id;
  }, plantId('Allium ursinum'));
  await app.go(`#/collection/${id}`);
  const editor = page.locator('gf-spot-editor');
  await editor.locator('li.entry button.head').filter({ hasText: 'Ail des ours' }).first().click();
  const entry = editor.locator('li.entry.open');
  const box = entry.locator('gf-lookalikes');
  await expect(box.getByText(/Peut être confondue avec/).first()).toBeVisible();
  await expect(box.getByRole('link', { name: 'Colchique' }).first()).toBeVisible();
  // The harvest log stays the mode's.
  await expect(entry.getByRole('radiogroup', { name: 'Qualité' })).toHaveCount(0);
});
