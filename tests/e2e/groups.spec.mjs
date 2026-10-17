// « Disposition libre » : groups (registry.js FRAME groupe). The cells of one group share a zone, a plant, a period and a
// search; another group's are apart — two lists, two maps that do not follow each other on one screen. The first group
// (a) keeps the address' keys as before; another's are after its letter (b.q=, b.at=, b.p=…). Each search its own
// (core/search-channel.js), the first the app's (Flore's); reloaded, the same; in the builder, a cell's group chosen in
// « Liens » of its picker, a letter in its colour on each head. iNaturalist answered here: the zone's observations,
// of 12 plants (their plants the list).
import { test, expect, answerAround, answerZone } from './fixtures.mjs';

/** @typedef {import('@playwright/test').Page} Page */

test.use({ reducedMotion: 'reduce' });
test.beforeEach(async ({ context, page }) => { await answerAround(context); await answerZone(page); });

const param = (/** @type {Page} */ page, /** @type {string} */ key) => page.evaluate(k => new URLSearchParams(location.hash.split('?')[1] || '').get(k), key);
const cellOf = (/** @type {Page} */ page, /** @type {string} */ path) => page.locator(`gf-layout section.cell[data-cell="${path}"]`);
/** The names a results cell lists. @param {Page} page @param {string} path */
const names = (page, path) => cellOf(page, path).locator('gf-plant-list').evaluate(l => /** @type {any} */ (l).shadowRoot ? [...l.shadowRoot.querySelectorAll('gf-plant-card')].map(c => /** @type {any} */ (c).plant?.scientificName ?? '') : []);

test.describe('un grand écran', () => {
  test.skip(({ isMobile }) => isMobile, 'a wide screen');

  test('deux groupes : deux recherches, deux zones, deux plantes — chacune dans l’adresse après sa lettre ; rechargé, les mêmes', async ({ app, page }) => {
    await app.open(`#/layout/[search(list=0),results(list),search(list=0,groupe=b),results(list,groupe=b)]?q=ortie&b.at=48.85,2.35&b.r=1km`);
    // A letter on each head: two groups.
    await expect(cellOf(page, '0').locator('.cell-group')).toHaveText('A');
    await expect(cellOf(page, '2').locator('.cell-group')).toHaveText('B');
    // The first: Flore's search (ortie), the whole flora; the second: the 12 plants of its zone, no text.
    await expect.poll(() => app.state('query.q')).toBe('ortie');
    await expect.poll(async () => (await names(page, '1')).every(n => /Urtica/.test(n)) && (await names(page, '1')).length > 0).toBe(true);
    await expect.poll(async () => (await names(page, '3')).length).toBe(12);
    // Typed in the second's search: its list and its keys only.
    await cellOf(page, '2').locator('gf-plant-search input').fill('allium');
    await expect.poll(() => param(page, 'b.q')).toBe('allium');
    await expect.poll(async () => (await names(page, '3')).every(n => /^Allium/.test(n))).toBe(true);
    expect(await param(page, 'q')).toBe('ortie');
    expect(await app.state('query.q')).toBe('ortie');
    // A plant chosen in the first: its p=, never the second's.
    await cellOf(page, '1').locator('gf-plant-card a.row').first().click();
    await expect.poll(() => param(page, 'p')).not.toBe(null);
    expect(await param(page, 'b.p')).toBe(null);
    // Reloaded: the same two searches.
    await page.reload();
    await app.ready();
    await expect.poll(() => app.state('query.q')).toBe('ortie');
    await expect(cellOf(page, '2').locator('gf-plant-search input')).toHaveValue('allium');
    await expect.poll(async () => (await names(page, '3')).every(n => /^Allium/.test(n)) && (await names(page, '3')).length > 0).toBe(true);
  });

  test('dans le constructeur : le groupe d’une case choisi dans « Liens » de son contenu', async ({ app, page }) => {
    await app.open(`#/builder?g=${encodeURIComponent('[results,results]')}&q=ortie`);
    await page.locator('gf-builder section.cell[data-cell="1"] .cell-head .pick').click();
    const picker = page.locator('gf-block-picker:not([inline])');
    await picker.locator('.row[data-group="Liens"]').click();
    await picker.locator('[data-param="groupe"] button[data-value="b"]').click();
    await expect.poll(() => page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] || '').get('g'))).toBe('[results,results(groupe=b)]');
    await expect(page.locator('gf-builder section.cell[data-cell="1"] .cell-group')).toHaveText('B');
  });
});
