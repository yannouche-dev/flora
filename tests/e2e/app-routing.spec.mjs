// « Écran sur mesure » : what is done in a cell is kept in the layout — the address is the screen, sent as it is
// (`cell-param`, gf-layout.js; registry.js#withParam). A map's 3D, its background, its legend, « Seule »; its own layers
// chosen in its panel ▦ (in their order) and their opacity at hand (its button among the map's) — never the maps' common
// look; the view it starts on, the map moved while modified, « Recadrer sur la zone »; the search's filters opened;
// the results as a list or a grid (their head's switch); a plant chosen while modified, then Back; the binoculars of a
// map in 3D. Each one written at once (no new entry), read back the same after a reload and after « Terminé ».
import { test, expect, answerAround, answerObservations, plantId } from './fixtures.mjs';
import { answerTiles } from './tiles.mjs';
import { layoutOf, screen } from './app.mjs';

/** @typedef {import('@playwright/test').Page} Page */

test.use({ reducedMotion: 'reduce', launchOptions: { args: ['--enable-unsafe-swiftshader'] } });

const AT = 'at=48.85,2.35';

test.beforeEach(async ({ context }) => { await answerAround(context); });

/** A parameter of the state in the address. @param {Page} page @param {string} key */
const param = (page, key) => page.evaluate(k => new URLSearchParams(location.hash.split('?')[1] || '').get(k), key);
/** A screen of one's own being modified, with its layout. @param {string} spec @param {string} [state] */
const modified = (spec, state = AT) => screen(spec, state, true);
const cell = (/** @type {Page} */ page) => page.locator('dl-map');
const mapOf = (/** @type {Page} */ page) => page.locator('dl-map gf-map');
/** « Vue 3D » (the cell's control) below the map's own buttons, the binoculars among them — never over them. @param {Page} page */
const clearOfButtons = page => expect.poll(async () => {
  const [v, b] = await Promise.all([cell(page).locator('.ctl.tr').getByRole('button', { name: 'Vue 3D' }).boundingBox(),
    mapOf(page).getByRole('button', { name: 'Observations autour', exact: true }).boundingBox()]);
  return Boolean(v && b && v.y >= b.y + b.height);
}).toBe(true);

test.describe('un grand écran', () => {
  test.skip(({ isMobile }) => isMobile, 'a wide screen');

  test('la 3D, le fond, la légende, « Seule » : touchés sur la carte, écrits dans la disposition ; rechargés, après « Terminé », les mêmes', async ({ app, page }) => {
    const ortie = plantId('Urtica dioica');
    await app.open(modified('[map(r=1km;ctl=rayon+3d+fond+plante+legende),results]', `${AT}&p=${ortie}`));
    const entries = await page.evaluate(() => history.length);
    const tr = cell(page).locator('.ctl.tr');
    await tr.getByRole('button', { name: 'Vue 3D' }).click();
    await expect.poll(() => layoutOf(page)).toContain('3d=1');
    await expect(mapOf(page)).toHaveAttribute('map-3d', 'on');
    await tr.locator('button.base').click();
    await expect.poll(() => layoutOf(page)).toContain('base=plan');
    await cell(page).getByRole('button', { name: 'Légende' }).click();
    await expect(cell(page).getByRole('list', { name: 'Légende de la carte' })).toBeVisible();
    await cell(page).locator('.chip').getByRole('button', { name: 'Seule' }).click();
    await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,base=plan,3d=1,plante=seule,legende=1,ctl=rayon+3d+fond+plante+legende),results]');
    // Each one replaced the address: no new entry.
    expect(await page.evaluate(() => history.length)).toBe(entries);
    // Reloaded: the same map.
    await page.reload();
    await app.ready();
    await expect(mapOf(page)).toHaveAttribute('map-3d', 'on');
    await expect.poll(() => mapOf(page).evaluate(m => /** @type {any} */ (m).baseShown)).toBe('plan');
    await expect(cell(page).getByRole('list', { name: 'Légende de la carte' })).toBeVisible();
    await expect(cell(page).locator('.chip').getByRole('button', { name: 'Seule' })).toHaveAttribute('aria-pressed', 'true');
    // « Terminé »: the same layout, the same state, in use.
    await page.locator('gf-layout [data-act="modifier"]').click();
    await expect.poll(() => page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] || '').get('edit'))).toBe(null);
    expect(await layoutOf(page)).toBe('[map(r=1km,base=plan,3d=1,plante=seule,legende=1,ctl=rayon+3d+fond+plante+legende),results]');
    expect(await param(page, 'p')).toBe(String(ortie));
    // Turned back: left out of the address again.
    await cell(page).locator('.chip').getByRole('button', { name: 'Seule' }).click();
    await cell(page).getByRole('button', { name: 'Légende' }).click();
    await cell(page).locator('.ctl.tr button.base').click();
    await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,3d=1,ctl=rayon+3d+fond+plante+legende),results]');
  });

  test('les couches : les siennes, choisies dans son panneau ▦, dans leur ordre (layers=) ; leur opacité à portée de main (opac=) ; jamais les réglages communs', async ({ app, page }) => {
    await app.open(`#/layout/[map(r=1km;layers=parcs+reserves),results]?${AT}`);
    const map = mapOf(page);
    await expect.poll(() => map.evaluate(m => /** @type {any} */ (m).lookShown.overlays)).toEqual(['parcs', 'reserves']);
    // The opacity at hand: a button among the map's, a slider each (the top one first).
    const button = map.getByRole('button', { name: 'Opacité des couches' });
    await expect(button).toBeVisible();
    await button.click();
    const card = map.getByRole('region', { name: 'Opacité des couches' });
    await expect(card.getByRole('slider')).toHaveCount(2);
    await expect(card.getByRole('slider').first()).toHaveAccessibleName('Opacité de Réserves naturelles');
    await expect(card.getByRole('slider').first()).toBeFocused();
    await card.getByRole('slider', { name: 'Opacité de Réserves naturelles' }).fill('40');
    await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,layers=parcs+reserves,opac=reserves.40),results]');
    await expect(card.locator('output').first()).toHaveText('40 %');
    // The tiles drawn so.
    await expect.poll(() => map.evaluate(m => getComputedStyle(/** @type {HTMLElement} */ (m.querySelector('.gf-tiles-reserves'))).opacity)).toBe('0.4');
    // Échap closes it, its button focused again.
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await expect(button).toBeFocused();
    // The panel ▦: this map's own layers, said; one taken off, another put on top.
    await map.evaluate(m => /** @type {any} */ (m).openPanel());
    const panel = map.locator('gf-map-panel');
    await expect(panel.locator('.scope')).toContainText('Cette carte a ses propres couches');
    await panel.locator('label.layer', { hasText: 'Parcs nationaux' }).locator('input').uncheck();
    await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,layers=reserves,opac=reserves.40),results]');
    await panel.locator('label.layer', { hasText: 'Parcelles cadastrales' }).locator('input').check();
    await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,layers=reserves+cadastre,opac=reserves.40),results]');
    // Never the maps' common look, nor its opacities.
    expect(await page.evaluate(() => [localStorage.getItem('geoflora.mapLayer'), Object.keys(localStorage).filter(k => /opacity/i.test(k)).map(k => localStorage.getItem(k)).join('')]))
      .toEqual([null, '']);
    // Reloaded: the same layers, the same opacity.
    await page.reload();
    await app.ready();
    await expect.poll(() => map.evaluate(m => /** @type {any} */ (m).lookShown.overlays)).toEqual(['reserves', 'cadastre']);
    await expect.poll(() => map.evaluate(m => getComputedStyle(/** @type {HTMLElement} */ (m.querySelector('.gf-tiles-reserves'))).opacity)).toBe('0.4');
  });

  test('le cadrage : la carte déplacée en modification part de là (vue=) ; « Recadrer sur la zone » l’efface', async ({ app, page }) => {
    await app.open(modified('[map(r=1km),results]'));
    const map = mapOf(page);
    await expect.poll(() => map.evaluate(m => Boolean(/** @type {any} */ (m).area?.center))).toBe(true);
    await page.waitForTimeout(600);
    expect(await layoutOf(page)).toBe('[map(r=1km),results]');
    // Dragged by hand: its view kept.
    const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await map.locator('.leaflet-container').boundingBox());
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.7);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5 - 160, box.y + box.height * 0.7 - 60, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => layoutOf(page)).toMatch(/^\[map\(r=1km,vue=[\d.]+:[\d.]+:[\d.]+\),results\]$/);
    const vue = String(/vue=([^,)]+)/.exec(String(await layoutOf(page)))?.[1] ?? '').split(':').map(Number);
    expect(vue[1]).toBeGreaterThan(2.35);
    // Reloaded: it starts there, not on the zone.
    await page.reload();
    await app.ready();
    await expect.poll(() => map.evaluate(m => /** @type {any} */ (m).center()?.[0] ?? 0)).toBeCloseTo(vue[1], 3);
    // « Recadrer sur la zone »: framed on it again, the setting gone.
    await cell(page).getByRole('button', { name: 'Recadrer sur la zone' }).click();
    await expect.poll(() => layoutOf(page)).toBe('[map(r=1km),results]');
    await expect.poll(() => map.evaluate(m => /** @type {any} */ (m).center()?.[0] ?? 0)).toBeCloseTo(2.35, 2);
    await expect(cell(page).getByRole('button', { name: 'Recadrer sur la zone' })).toHaveCount(0);
  });

  test('les filtres ouverts de la recherche (filters=1), les résultats en liste ou en grille (le bouton de leur en-tête, view=)', async ({ app, page }) => {
    await app.open('#/layout/[search(list=0),results(list)]?q=ortie');
    await page.locator('dl-search gf-results-bar').getByRole('button', { name: /^Filtres/ }).click();
    await expect(page.locator('dl-search gf-filter-panel')).toBeVisible();
    await expect.poll(() => layoutOf(page)).toBe('[search(filters=1,list=0),results(view=list)]');
    const head = page.locator('section.cell[data-comp="results"] .cell-head');
    await expect(head.getByRole('button', { name: 'En liste' })).toHaveAttribute('aria-pressed', 'true');
    await head.getByRole('button', { name: 'En grille' }).click();
    await expect.poll(() => layoutOf(page)).toBe('[search(filters=1,list=0),results(view=grid)]');
    await expect(page.locator('dl-results gf-plant-list')).toHaveAttribute('grid', '');
    await expect(head.getByRole('button', { name: 'En grille' })).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await app.ready();
    await expect(page.locator('dl-search gf-filter-panel')).toBeVisible();
    await expect(page.locator('dl-results gf-plant-list')).toHaveAttribute('grid', '');
    // Closed: left out again.
    await page.locator('dl-search gf-results-bar').getByRole('button', { name: /^Filtres/ }).click();
    await expect.poll(() => layoutOf(page)).toBe('[search(list=0),results(view=grid)]');
  });

  test('en modification, une plante choisie remplace l’adresse ; Retour sort de la modification, la plante gardée', async ({ app, page }) => {
    await app.open(screen('[results(list),plant]', 'q=ortie'));
    await page.locator('gf-layout [data-act="modifier"]').click();
    await expect.poll(() => param(page, 'edit')).toBe('1');
    const entries = await page.evaluate(() => history.length);
    await page.locator('dl-results gf-plant-card a.row').first().click();
    await expect.poll(() => param(page, 'p')).not.toBe(null);
    const plant = await param(page, 'p');
    await expect(page.locator('gf-layout section.cell[data-comp="plant"] gf-plant-detail')).toHaveCount(1);
    expect(await page.evaluate(() => history.length)).toBe(entries);
    await page.goBack();
    await expect.poll(() => param(page, 'edit')).toBe(null);
    expect(await param(page, 'p')).toBe(plant);
    await expect(page.locator('gf-layout[editing]')).toHaveCount(0);
    await expect(page.locator('gf-layout section.cell[data-comp="plant"] gf-plant-detail')).toHaveCount(1);
    expect(await layoutOf(page)).toBe('[results(view=list),plant]');
  });
});

test('en 3D, les jumelles (« Observations autour ») allumées ou éteintes : gardées dans la disposition (jumelles=)', async ({ app, page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'software WebGL: one project');
  test.slow();
  await page.setViewportSize({ width: 1024, height: 680 });
  await answerTiles(page);
  await answerObservations(page);
  await page.addInitScript(() => localStorage.setItem('geoflora.maps3d', JSON.stringify({ relief: false, buildings: false, hillshade: false, sky: false, pitch: 30 })));
  await app.open('#/layout/[map(r=2km;3d=1),results]?at=45.7772,3.087');
  const map = mapOf(page);
  await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 30_000 });
  await clearOfButtons(page);
  const binoculars = map.getByRole('button', { name: 'Observations autour', exact: true });
  await expect(binoculars).toHaveAttribute('aria-pressed', 'false');
  await binoculars.click();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=2km,3d=1,jumelles=inat+gbif),results]');
  // Never kept on the device for its page: the layout keeps it.
  expect(await page.evaluate(() => localStorage.getItem('geoflora.around3d'))).toBe(null);
  await page.reload();
  await app.ready();
  await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 30_000 });
  await expect(map.getByRole('button', { name: 'Observations autour', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await clearOfButtons(page);
  await map.getByRole('button', { name: 'Observations autour', exact: true }).click();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=2km,3d=1),results]');
});
