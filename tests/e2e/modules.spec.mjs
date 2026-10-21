// Réglages › Modules: each online service is a permission of the device, one switch whatever the display mode
// (core/modules.js). Switched off there, its data leaves the plant sheet in every mode and nothing is asked of it;
// hiding a block in mode King never switches its service (core/sheet-blocks.js setHidden), and a block whose service
// is off says so, with the way to Réglages › Modules instead of « Réafficher ».
import { test, expect, plantId } from './fixtures.mjs';

const GBIF = /api\.gbif\.org\//;
const GBIF_BLOCKS = ['descriptions', 'occurrences', 'gbifProfile', 'literature'];
const CUT = 'service GBIF coupé pour tout l’appareil';

/** @param {import('@playwright/test').Page} page */
const gbifSwitch = page => page.locator('gf-settings').getByRole('checkbox', { name: 'Utilisé sur cet appareil : GBIF' });

/** The sheet open (not the next plant's waiting under it, nor a block alone in a pane). @param {import('@playwright/test').Page} page */
const sheetOf = page => page.locator('gf-plant-detail:not([preview]):not([only])').first();

/** @param {import('@playwright/test').Page} page @param {string} key */
const block = (page, key) => sheetOf(page).locator(`.block[data-key="${key}"]`);

test('GBIF coupé dans les Réglages : ses données quittent la fiche, quel que soit le mode d’affichage', async ({ app, page, context }) => {
  let asked = 0;
  await context.route(GBIF, route => { asked++; return route.fulfill({ status: 503, body: '' }); });
  const sheet = `#/plant/${plantId('Urtica dioica')}`;
  // On: its block is there (its source down here, said in it).
  await app.open(sheet);
  await expect(block(page, 'occurrences').first()).toBeVisible();

  await app.go('#/settings');
  await expect(gbifSwitch(page)).toBeChecked();
  await gbifSwitch(page).uncheck();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('geoflora.modules'))).toBe('{"gbif":false}');

  // Every mode, a mode made here too: no GBIF block, nothing asked of GBIF.
  const made = await page.evaluate(async () => (await import('/app/core/mode-admin.js')).createMode('Poste', 'scientific'));
  asked = 0;
  for (const mode of ['epure', 'standard', 'scientific', made]) {
    await page.evaluate(async m => (await import('/app/core/store.js')).setMode(m), mode);
    await app.go('#/');
    await app.go(sheet);
    await expect(block(page, 'name').first()).toBeVisible();
    for (const key of GBIF_BLOCKS) await expect(block(page, key), `${mode} : ${key}`).toHaveCount(0);
    expect(await app.state('modules.gbif'), mode).toBe(false);
  }
  expect(asked, 'GBIF jamais appelé').toBe(0);
});

test('mode King : masquer les blocs GBIF ne coupe pas GBIF ; coupé dans les Réglages, son bloc le dit et y mène', async ({ app, page }) => {
  await app.open('#/settings');
  await page.getByRole('button', { name: 'Entrer en mode King' }).click();
  await app.go(`#/plant/${plantId('Urtica dioica')}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Ortie dioïque' })).toBeVisible();
  const sheet = sheetOf(page);
  // Every GBIF block of the sheet hidden (Médias GBIF is by default): the last one used to switch GBIF off.
  for (const title of ['Descriptions', 'Occurrences et répartition', 'Habitat et écologie (GBIF)', 'Publications (GBIF)']) {
    await sheet.getByRole('button', { name: `Masquer le bloc « ${title} »` }).click();
    await expect(sheet.getByRole('button', { name: `Réafficher le bloc « ${title} »` })).toBeVisible();
  }
  expect(await app.state('modules.gbif')).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('geoflora.modules'))).toBeNull();
  await sheet.getByRole('button', { name: 'Réafficher le bloc « Descriptions »' }).click();

  await app.go('#/settings');
  await expect(gbifSwitch(page), 'Réglages : GBIF toujours utilisé').toBeChecked();
  await gbifSwitch(page).uncheck();

  // Back on the sheet: the block shown by hand is folded, says why and leads to Réglages › Modules; « Ajouter » does
  // not offer it (only the blocks hidden by hand).
  await app.go(`#/plant/${plantId('Urtica dioica')}`);
  const descriptions = sheet.locator('.block[data-key="descriptions"]');
  await expect(descriptions.locator('.off-note')).toHaveText(`${CUT} (Réglages › Modules)`);
  await expect(descriptions.getByRole('button', { name: 'Réafficher le bloc « Descriptions »' })).toHaveCount(0);
  const toSettings = descriptions.getByRole('link', { name: `Réglages › Modules : ${CUT}` });
  await expect(toSettings).toHaveAttribute('href', '#/settings');
  const palette = sheet.locator('.palette');
  await expect(palette.getByRole('button', { name: 'Descriptions', exact: true })).toHaveCount(0);
  await expect(palette.getByRole('button', { name: 'Occurrences et répartition', exact: true })).toHaveCount(1);
  await toSettings.click();
  await expect(gbifSwitch(page)).not.toBeChecked();
  await gbifSwitch(page).check();

  // On again: Descriptions is back, the blocks hidden by hand stay hidden.
  await app.go(`#/plant/${plantId('Urtica dioica')}`);
  await expect(descriptions.locator('.off-note')).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Masquer le bloc « Descriptions »' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Réafficher le bloc « Occurrences et répartition »' })).toBeVisible();
});
