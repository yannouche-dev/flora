// A block of the sheet shown alone (gf-sheet-block): over the page where there is no pane beside the sheet (⤢ in Mes
// plantes: a dialog with that block alone, Échap closing it and its history entry with it); in Flore's pane, what it
// cannot show said (a word that is no block, its service off), its name a heading of level 2, a photo touched in
// Photos turning the pane to Médias; in a screen's cell, no control tied to a map that is not there.
import { test, expect, plantId } from './fixtures.mjs';

const ORTIE = plantId('Urtica dioica');

test('⤢ dans Mes plantes : le bloc par-dessus la page', async ({ app, page }) => {
  await app.open(`#/collections?plant=${ORTIE}`);
  const mine = page.locator('gf-collections gf-plant-detail[sheet="collections"]');
  await expect(mine.getByRole('heading', { name: 'Ortie dioïque' }).first()).toBeVisible();
  const n = await page.evaluate(() => history.length);
  await mine.locator('.block[data-key="calendar"] button.to-pane').click();
  const dialog = page.locator('gf-collections dialog.pane');
  await expect(dialog).toBeVisible();
  // The block alone, its name in the bar: nothing of the sheet's layout around it.
  await expect(dialog.locator('.pane-bar')).toContainText('Calendrier');
  const alone = dialog.locator('gf-sheet-block[key="calendar"]');
  await expect(alone.locator('gf-calendar')).toBeAttached();
  await expect(alone.locator('.action-bar, .rub-head, .king-bar')).toHaveCount(0);
  expect(await page.evaluate(() => history.length)).toBe(n + 1);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => history.state?.gfModal ?? null)).toBeNull();
  expect(await page.evaluate(() => location.hash)).toBe(`#/collections?plant=${ORTIE}`);
});

test('un bloc seul dit ce qu’il ne peut pas montrer ; une photo de Photos seul ouvre Médias à sa place', async ({ app, page }) => {
  test.skip(app.phone, 'the pane beside the sheet: a wide screen');
  const pane = page.locator('gf-flora .block-pane gf-sheet-block');
  await app.open(`#/plant/${ORTIE}?pane=nimporte`);
  await expect(pane).toContainText('Bloc inconnu : « nimporte » — la fiche n’a pas de bloc de ce nom.');
  // Its name: under the pane's own title, a heading of level 2 (no second h1 on the page).
  await app.go(`#/plant/${ORTIE}?pane=name`);
  await expect(pane.getByRole('heading', { level: 2, name: 'Ortie dioïque' })).toBeVisible();
  await expect(pane.locator('h1')).toHaveCount(0);
  // Photos touched: the same pane turns to Médias at that photo, no step added.
  await app.go(`#/plant/${ORTIE}?pane=photos`);
  const n = await page.evaluate(() => history.length);
  await pane.locator('.gallery figure a').first().click();
  await expect.poll(() => page.evaluate(() => location.hash)).toMatch(new RegExp(`^#/plant/${ORTIE}\\?pane=media(&i=\\d+)?$`));
  await expect(page.locator('gf-flora .block-pane gf-sheet-block[key="media"] gf-media-viewer')).toBeAttached();
  expect(await page.evaluate(() => history.length)).toBe(n);
  // GBIF off: Occurrences alone says so, the way to Réglages beside, nothing loading.
  await page.evaluate(async () => (await import('/app/core/modules.js')).setModule('gbif', false));
  await app.go(`#/plant/${ORTIE}?pane=occurrences`);
  await expect(pane).toContainText('Service GBIF coupé pour tout l’appareil : rien à montrer ici');
  await expect(pane.getByRole('link', { name: 'Réglages › Modules' })).toBeVisible();
  await expect(pane).not.toContainText('chargement…');
  // A screen's cell: no map beside the block, no « Comparer sur la carte ».
  await app.go(`#/layout/[plant.lookalikes]?p=${plantId('Allium ursinum')}`);
  const cell = page.locator('gf-layout gf-sheet-block[key="lookalikes"]');
  await expect(cell.locator('gf-lookalikes')).toContainText('Colchique');
  await expect(cell.getByRole('button', { name: /Comparer sur la carte/ })).toHaveCount(0);
});
