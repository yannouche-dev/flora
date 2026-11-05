// A block of the sheet shown alone (gf-sheet-block): over the page where there is no pane beside the sheet (⤢ in Mes
// plantes: a dialog with that block alone, Échap closing it and its history entry with it).
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
