// The plant sheet's panes in mode King (« Déplacer vers… »), and the bound of TEST-6 / GAP3-10: a layout too deep
// for the import is never built — the move is refused, and said. Migrated from tree1.cjs, panes.cjs, dock.cjs,
// settingstree.cjs, audit/gap3 replay2.cjs.
import { test, expect, plantId } from './fixtures.mjs';

/** Mode King on, then the sheet of a plant. @param {import('./app.mjs').App} app */
async function kingSheet(app) {
  await app.open('#/settings');
  await app.page.getByRole('button', { name: 'Entrer en mode King' }).click();
  await app.go(`#/plant/${plantId('Urtica dioica')}`);
  await expect(app.page.getByRole('heading', { level: 1, name: 'Ortie dioïque' })).toBeVisible();
}

/** Opens « Déplacer « title » vers… » and picks an item. @param {import('@playwright/test').Page} page @param {string} title @param {string} item */
async function moveTo(page, title, item) {
  const picker = page.locator(`gf-plant-detail summary[aria-label="Déplacer « ${title} » vers…"]`).first();
  await picker.click();
  await page.locator('gf-plant-detail details[open] .move-menu').getByRole('menuitem', { name: item }).click();
}

const where = (/** @type {import('@playwright/test').Page} */ page, /** @type {string} */ key) => page.evaluate(async k => {
  const sb = await import('/app/core/sheet-blocks.js');
  const { plantViewOf, store } = await import('/app/core/store.js');
  return sb.isOnEdge(plantViewOf(store.state), k);
}, key);

test('mode King : « Déplacer vers… » un nouveau volet, puis de retour dans la fiche', async ({ app, page }) => {
  await kingSheet(app);
  await moveTo(page, 'Classification', 'Nouveau panneau à droite');
  await expect.poll(() => where(page, 'taxonomy')).toBe(true);
  await expect(page.locator('gf-plant-detail [data-pane]').first()).toBeVisible();
  await expect(page.locator('gf-plant-detail .said')).toHaveText('« Classification » : nouveau panneau à droite de la fiche');
  await moveTo(page, 'Classification', 'Dans la fiche');
  await expect.poll(() => where(page, 'taxonomy')).toBe(false);
});

test('TEST-6 / GAP3-10 : un volet de trop est refusé et annoncé, la mise en page se réimporte', async ({ app, page }) => {
  await kingSheet(app);
  // Six panes nested, alternately right and under the sheet: the deepest the import reads.
  const built = await page.evaluate(async () => {
    const sb = await import('/app/core/sheet-blocks.js');
    const { plantViewOf, store } = await import('/app/core/store.js');
    const view = plantViewOf(store.state);
    return ['calendar', 'names', 'uses', 'ids', 'mine', 'status'].map((k, i) => sb.dockBlock(view, k, 'sheet', i % 2 ? 'bottom' : 'right'));
  });
  expect(built).toEqual([true, true, true, true, true, true]);
  const before = await page.evaluate(async () => (await import('/app/core/sheet-blocks.js')).exportLayout());
  await moveTo(page, 'Classification', 'Nouveau panneau à droite');
  await expect(page.locator('gf-plant-detail .said')).toHaveText('« Classification » : pas déplacé, trop de panneaux imbriqués');
  expect(await where(page, 'taxonomy')).toBe(false);
  // Exported, everything reset, imported back: the same panes (the file the user keeps is never refused).
  const after = await page.evaluate(async () => {
    const sb = await import('/app/core/sheet-blocks.js');
    const text = sb.exportLayout();
    sb.resetAll();
    sb.importLayout(text);
    return { text, again: sb.exportLayout() };
  });
  expect(after.text).toBe(before);
  expect(JSON.parse(after.again).layout.tree).toEqual(JSON.parse(before).layout.tree);
});
