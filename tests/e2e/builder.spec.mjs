// « Créer une app » (#/builder, app/layout/gf-builder.js), step 1: three grids to choose from, each drawn on its card;
// the one chosen drawn on a desktop as wide as the page, its places numbered, a grip between two columns side by side
// (dragged, or ←/→) moving width from one to the other — the row as wide as before.
import { test, expect } from './fixtures.mjs';

test.beforeEach(({ isMobile }) => { test.skip(isMobile, 'the desktop preview: a wide screen'); });

/** The widths of the top row's places, in px. @param {import('@playwright/test').Page} page */
const widths = page => page.locator('gf-builder .screen > .g > .slot').evaluateAll(els => els.map(e => e.getBoundingClientRect().width));

test('trois grilles ; la grille choisie sur un ordinateur, ses emplacements numérotés ; Retour : aucune', async ({ app, page }) => {
  await app.open('#/builder');
  const cards = page.locator('gf-builder .choice');
  await expect(cards).toHaveText([/Une colonne/, /Trois colonnes/, /Tableau de bord/]);
  await expect(page.locator('gf-builder .desk')).toHaveCount(0);
  await expect(page.locator('gf-builder .empty')).toBeVisible();
  for (const [id, places] of /** @type {const} */ ([['colonne', 3], ['trois', 3], ['tableau', 7]])) {
    await page.locator(`gf-builder button[data-grid="${id}"]`).click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/builder/' + id);
    await expect(page.locator(`gf-builder button[data-grid="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('gf-builder .screen .slot')).toHaveCount(places);
    await expect(page.locator('gf-builder .screen .slot strong')).toHaveText(Array.from({ length: places }, (_, i) => `Emplacement ${i + 1}`));
  }
  // The desktop as wide as its room.
  const [room, desk] = await Promise.all([page.locator('gf-builder .room').boundingBox(), page.locator('gf-builder .desk').boundingBox()]);
  expect(Math.abs((desk?.width ?? 0) - (room?.width ?? 0))).toBeLessThan(2);
  // A change of mind is no step: Back leaves the builder's grids for no grid at all.
  await page.goBack();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/builder');
  await expect(page.locator('gf-builder .desk')).toHaveCount(0);
});

test('les poignées entre les colonnes : glissées ou au clavier, la largeur passe de l’une à l’autre, la grille toujours pleine largeur', async ({ app, page }) => {
  await app.open('#/builder/trois');
  const grips = page.locator('gf-builder .grip');
  await expect(grips).toHaveCount(2);
  const before = await widths(page);
  const total = before.reduce((a, b) => a + b, 0);
  // Dragged 120 px to the right: the first column wider, the second narrower by as much, the third as it was.
  const g = /** @type {{ x: number, y: number, width: number, height: number }} */ (await grips.first().boundingBox());
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + 120, g.y + g.height / 2, { steps: 6 });
  await page.mouse.up();
  const dragged = await widths(page);
  expect(dragged[0] - before[0]).toBeGreaterThan(100);
  expect(Math.abs(dragged[1] - (before[1] - (dragged[0] - before[0])))).toBeLessThan(2);
  expect(Math.abs(dragged[2] - before[2])).toBeLessThan(2);
  expect(Math.abs(dragged.reduce((a, b) => a + b, 0) - total)).toBeLessThan(2);
  // No text selected by the drag.
  expect(await page.evaluate(() => String(getSelection()))).toBe('');
  // The keyboard: ← on the second grip, the third column wider; never below its least width, however far.
  await grips.nth(1).focus();
  await page.keyboard.press('ArrowLeft');
  const keyed = await widths(page);
  expect(keyed[2]).toBeGreaterThan(dragged[2]);
  for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowLeft');
  const least = await widths(page);
  expect(least[1]).toBeGreaterThan(total * 0.07);
  expect(Math.abs(least.reduce((a, b) => a + b, 0) - total)).toBeLessThan(2);
  await expect(grips.nth(1)).toHaveAttribute('aria-orientation', 'vertical');
});

/** The grid as the address keeps it (g=), decoded. @param {import('@playwright/test').Page} page */
const spec = page => page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] || '').get('g'));

test('la croix : diviser un emplacement dans les quatre sens, le retirer ; l’adresse garde la grille et ses parts', async ({ app, page }) => {
  await app.open('#/builder/trois');
  const slot = (/** @type {string} */ path) => page.locator(`gf-builder .screen [data-path="${path}"]`);
  // The build button opens the cross: four arms, the middle (retirer, fermer); Escape closes it, the button focused again.
  await slot('1').locator('.build').click();
  await expect(slot('1').locator('.arm')).toHaveCount(4);
  await page.keyboard.press('Escape');
  await expect(slot('1').locator('.cross')).toHaveCount(0);
  await expect(slot('1').locator('.build')).toBeFocused();
  // Below the middle column: a column of two there.
  await slot('1').locator('.build').click();
  await slot('1').locator('.arm.bottom').click();
  await expect.poll(() => spec(page)).toBe('[slot@30,[slot,slot]@35,slot@35]');
  await expect(slot('1.1').locator('.build')).toBeFocused();
  // Right of the new one: a row of two inside; left of the first column: beside it in the top row.
  await slot('1.1').locator('.build').click();
  await slot('1.1').locator('.arm.right').click();
  await slot('0').locator('.build').click();
  await slot('0').locator('.arm.left').click();
  await expect.poll(() => spec(page)).toBe('[slot@15,slot@15,[slot,[slot,slot]]@35,slot@35]');
  await expect(page.locator('gf-builder .screen .slot')).toHaveCount(6);
  await expect(page.locator('gf-builder .reset')).toBeVisible();
  // A height grip: ↓ gives room to the top of the middle column.
  const hgrip = page.locator('gf-builder .screen .g.col > .grip').first();
  await hgrip.focus();
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(() => spec(page)).toBe('[slot@15,slot@15,[slot@60,[slot,slot]@40]@35,slot@35]');
  // Taken out: its room to its neighbour; a list of one gives way.
  await slot('2.1.0').locator('.build').click();
  await slot('2.1.0').locator('.del').click();
  await expect.poll(() => spec(page)).toBe('[slot@15,slot@15,[slot@60,slot@40]@35,slot@35]');
  // Reloaded: the same grid.
  await page.reload();
  await app.ready();
  await expect(page.locator('gf-builder .screen .slot')).toHaveCount(5);
  // Back to the grid offered: no g= left.
  await page.locator('gf-builder .reset').click();
  await expect.poll(() => spec(page)).toBe(null);
  await expect(page.locator('gf-builder .screen .slot')).toHaveCount(3);
});

test('la croix : ses limites — 12 emplacements au plus, pas plus profond que la grammaire, le dernier emplacement reste', async ({ app, page }) => {
  await app.open('#/builder/trois?g=' + '[' + Array(12).fill('slot').join(',') + ']');
  await page.locator('gf-builder .screen [data-path="0"] .build').click();
  await expect(page.locator('gf-builder .screen [data-path="0"] .arm:disabled')).toHaveCount(4);
  await app.go('#/builder/trois?g=[slot]');
  await page.locator('gf-builder .screen [data-path="0"] .build').click();
  await expect(page.locator('gf-builder .screen [data-path="0"] .del')).toBeDisabled();
  // An address that is no grid: the grid offered.
  await app.go('#/builder/trois?g=[map,slot]');
  await expect(page.locator('gf-builder .screen .slot')).toHaveCount(3);
});
