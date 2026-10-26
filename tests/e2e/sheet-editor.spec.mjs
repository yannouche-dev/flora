// « Personnaliser la fiche » (code name: King), on the sheet itself: its crown, at the end of the action bar of Flore's
// and Mes plantes' sheets, opens the bar « Mise en page de la fiche » there only — not on a block alone, a free
// layout's cell, the other host's sheet —, for the visit (never stored); the bar names and switches the mode arranged
// without changing the app's (core/store.js king, arrange, arrangedMode).
import { test, expect, plantId } from './fixtures.mjs';

/** @typedef {import('@playwright/test').Page} Page */

const ORTIE = plantId('Urtica dioica');
/** Flore's sheet (not the card underneath). @param {Page} page */
const flore = page => page.locator('gf-plant-detail[sheet="flore"]:not([preview])');
/** @param {import('@playwright/test').Locator} sheet */
const crown = sheet => sheet.locator('.action-bar').getByRole('button', { name: 'Personnaliser la fiche', exact: true });
/** @param {import('@playwright/test').Locator} sheet */
const bar = sheet => sheet.getByRole('region', { name: 'Mise en page de la fiche' });
/** The blocks of the sheet personalised, in order. @param {import('@playwright/test').Locator} sheet */
const order = sheet => sheet.locator('.blocks.king > .block').evaluateAll(els => els.map(e => /** @type {HTMLElement} */ (e).dataset.key));
/** Is a block folded in a mode (core/sheet-blocks.js)? @param {Page} page @param {string} mode @param {string} key */
const hidden = (page, mode, key) => page.evaluate(async ([m, k]) => (await import('/app/core/sheet-blocks.js')).isHidden(m, k), [mode, key]);

test('la couronne ouvre la mise en page sur sa fiche seulement, pour la visite', async ({ app, page }) => {
  // A « Mode King » kept by a version of before: forgotten at start, never on.
  await page.addInitScript(() => localStorage.setItem('geoflora.kingMode', '1'));
  await app.open(`#/plant/${ORTIE}`);
  const sheet = flore(page);
  await expect(sheet.getByRole('heading', { level: 1, name: 'Ortie dioïque' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('geoflora.kingMode'))).toBeNull();
  await expect(crown(sheet)).toHaveAttribute('aria-pressed', 'false');
  await expect(bar(sheet)).toHaveCount(0);

  // The crown, last of the action bar: the bar of the sheet, the app's mode arranged.
  await expect(sheet.locator('.action-bar .act').last()).toHaveClass(/\bcrown\b/);
  await app.king();
  await expect(crown(sheet)).toHaveAttribute('aria-pressed', 'true');
  await expect(bar(sheet)).toContainText('Mise en page : Standard');
  expect(await app.state('king')).toEqual({ sheet: 'flore', mode: null });
  expect(await page.evaluate(() => localStorage.getItem('geoflora.kingMode'))).toBeNull();

  // A block alone, in the pane beside (⤢): read, not arranged.
  await app.go(`#/plant/${ORTIE}?pane=map`);
  const alone = page.locator('gf-plant-detail[only]');
  await expect(alone).toHaveCount(1);
  await expect(alone.locator('.king-bar, .act.crown, .block-title .grip')).toHaveCount(0);

  // Mes plantes' sheet: its own crown, not pressed — King is Flore's.
  await app.go(`#/collections?plant=${ORTIE}`);
  const mine = page.locator('gf-plant-detail[sheet="collections"]');
  await expect(mine.getByRole('heading', { name: 'Ortie dioïque' }).first()).toBeVisible();
  await expect(crown(mine)).toHaveAttribute('aria-pressed', 'false');
  await expect(bar(mine)).toHaveCount(0);

  // A free layout's sheet: no crown at all.
  await app.go(`#/layout/[plant]?p=${ORTIE}`);
  const cell = page.locator('gf-layout gf-plant-detail');
  await expect(cell.getByRole('heading', { name: 'Ortie dioïque' }).first()).toBeVisible();
  await expect(cell.locator('.act.crown, .king-bar')).toHaveCount(0);

  // Back in Flore: still open (the visit), until « Terminé » — the focus back on the crown.
  await app.go(`#/plant/${ORTIE}`);
  await expect(bar(sheet)).toBeVisible();
  await bar(sheet).getByRole('button', { name: 'Terminé' }).click();
  await expect(bar(sheet)).toHaveCount(0);
  await expect(crown(sheet)).toHaveAttribute('aria-pressed', 'false');
  await expect(crown(sheet)).toBeFocused();
  expect(await app.state('king')).toBeNull();

  // Réglages › Mise en page de la fiche › « Personnaliser la fiche »: the last plant read in Flore, open.
  await app.go('#/settings');
  await page.locator('gf-settings').getByRole('button', { name: 'Personnaliser la fiche' }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/plant/${ORTIE}`);
  await expect(bar(sheet)).toContainText('Mise en page : Standard');

  // Then a reload: closed (never kept).
  await page.reload();
  await app.ready();
  await expect(sheet.getByRole('heading', { level: 1, name: 'Ortie dioïque' })).toBeVisible();
  await expect(bar(sheet)).toHaveCount(0);
  expect(await app.state('king')).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('geoflora.kingMode'))).toBeNull();
});

test('la barre arrange un autre mode sans changer celui de l’application', async ({ app, page }) => {
  await app.open(`#/plant/${ORTIE}`);
  const sheet = flore(page);
  await expect(sheet.getByRole('heading', { level: 1, name: 'Ortie dioïque' })).toBeVisible();
  const storedMode = await page.evaluate(() => localStorage.getItem('geoflora.mode'));
  await app.king();
  await expect.poll(() => order(sheet)).toEqual(expect.arrayContaining(['name', 'status']));
  expect((await order(sheet))[1]).toBe('status');

  // Scientifique, in the bar: the sheet drawn and arranged so (Plantes à confondre right after the name), the app's
  // mode left as it is.
  await bar(sheet).getByRole('button', { name: 'Scientifique — la mise en page' }).click();
  await expect(bar(sheet)).toContainText('Mise en page : Scientifique');
  await expect(sheet.locator('article.science')).toHaveCount(1);
  await expect.poll(async () => (await order(sheet))[1]).toBe('lookalikes');
  expect(await app.state('mode')).toBe('standard');
  expect(await page.evaluate(() => localStorage.getItem('geoflora.mode'))).toBe(storedMode);
  expect(await app.state('king')).toEqual({ sheet: 'flore', mode: 'scientific' });

  // « Classification » hidden there: in Scientifique only.
  await sheet.getByRole('button', { name: 'Masquer le bloc « Classification »' }).click();
  await expect(sheet.getByRole('button', { name: 'Réafficher le bloc « Classification »' })).toBeVisible();
  expect(await hidden(page, 'scientific', 'taxonomy')).toBe(true);
  expect(await hidden(page, 'standard', 'taxonomy')).toBe(false);

  // ↺: the app's mode arranged again.
  await bar(sheet).getByRole('button', { name: 'Revenir au mode de l’application' }).click();
  await expect(bar(sheet)).toContainText('Mise en page : Standard');
  await expect.poll(async () => (await order(sheet))[1]).toBe('status');
  await expect(sheet.locator('article.science')).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Masquer le bloc « Classification »' })).toBeVisible();

  // The app's mode changed in the header (a wide screen: on a phone the sheet covers it) while the bar arranges it:
  // the bar follows.
  if (!app.phone) {
    await page.locator('gf-app header gf-mode-switch').getByRole('button', { name: 'Épuré — toute l’application' }).click();
    await expect(bar(sheet)).toContainText('Mise en page : Épuré');
    expect(await app.state('king')).toEqual({ sheet: 'flore', mode: null });
  }
});
