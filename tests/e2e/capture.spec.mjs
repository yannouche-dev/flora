// « Noter ici » in mode cueillette (SAFE-4): the harvest box is never ticked for you, not even by the last opening;
// a harvest of a plant our sources say is toxic waits for a warning to be answered — noted without the harvest by
// default, with it only once the user ticked « J’ai lu cet avertissement ». A plant without toxicity data is noted at
// once. The confusion reminders (« Noter ici », the place editor) show whatever the mode.
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

test('Nouveau lieu, mode cueillette : « Récolté aujourd’hui » décoché ; le cocher pour une plante toxique demande confirmation', async ({ app, page }) => {
  // On a desktop, the place saved at once moves to the Carte's panel: the editor of a new place is the phone's.
  test.skip(!app.phone, 'éditeur d’un nouveau lieu : téléphone');
  await app.open('#/');
  await page.evaluate(async () => (await import('/app/core/store.js')).setHarvestMode(true));
  await app.go(`#/collection/new?kind=place&plant=${plantId('Conium maculatum')}&at=48.851000,2.351000`);
  const editor = page.locator('gf-spot-editor');
  const today = editor.getByRole('checkbox', { name: 'Récolté aujourd’hui' });
  await expect(today).not.toBeChecked();
  // The warning (a confirm) refused: the box stays unticked.
  /** @type {string[]} */
  const asked = [];
  page.once('dialog', dialog => { asked.push(dialog.message()); dialog.dismiss(); });
  await today.click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toMatch(/^Plante toxique : récolte déconseillée/);
  expect(asked[0]).toMatch(/très fortement toxique/);
  await expect(today).not.toBeChecked();
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
  await expect(page.locator('gf-capture .toast')).toContainText('récolte notée');
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
