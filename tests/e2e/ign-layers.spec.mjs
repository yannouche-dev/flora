// Browsing IGN's ~660 layers in the Carte panel (gf-ign-layers.js, on the catalogue shipped with the app): the
// taxonomy as a tree of categories and sub-categories with their counts, a series as one row with its selector,
// « Recommandées pour la botanique », the search (accents aside), a row's details (description, zooms, source, one
// preview tile); a layer checked asks its tiles, joins « Couches affichées » (gf-layer-stack.js) with its opacity and its
// place in the stack, and all of it is still there after a reload; a layer of « Noms et réseaux » there (« Voie ferrée »,
// the roads' series) is that choice, not one more layer — on the plan, which has its own, disabled and said, as the
// panel's own checkboxes. The service's GetCapabilities is never answered: the shipped copy only.
import { test, expect } from './fixtures.mjs';
import { PHOTO } from './tiles.mjs';

const CAPS_URL = /data\.geopf\.fr\/wmts\?SERVICE=WMTS&REQUEST=GetCapabilities/;
const TILE_URL = /data\.geopf\.fr\/wmts\?.*REQUEST=GetTile/;

/**
 * The map page with the tiles answered (each layer asked noted) and the catalogue's refresh refused.
 * @param {import('@playwright/test').Page} page @param {any} app
 */
async function openMap(page, app) {
  /** @type {string[]} */
  const tiles = [];
  await page.route(CAPS_URL, route => route.abort());
  await page.route(TILE_URL, route => {
    tiles.push(new URL(route.request().url()).searchParams.get('LAYER') || '');
    return route.fulfill({ contentType: 'image/png', body: PHOTO });
  });
  await app.open('#/map');
  return tiles;
}

/** The Carte panel, the catalogue shown. @param {import('@playwright/test').Page} page */
async function browse(page) {
  await page.locator('gf-map').first().evaluate(map => /** @type {any} */ (map).openPanel());
  const panel = page.locator('gf-map-panel');
  await panel.getByRole('button', { name: /Parcourir les couches de l’IGN/ }).click();
  await expect(panel.getByRole('searchbox', { name: 'Chercher une couche de l’IGN' })).toBeVisible();
  return panel;
}

/** What the map keeps of its look (base, overlays bottom first). @param {import('@playwright/test').Page} page */
const savedLook = page => page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.mapLayer') || '{}'));

test('catégories : un arbre replié avec ses nombres, des séries en une ligne avec leur sélecteur', async ({ page, app }) => {
  await openMap(page, app);
  const panel = await browse(page);
  // Categories folded, each with its count; nothing of a category is drawn before it is opened.
  const photos = panel.locator('summary', { hasText: 'Photos aériennes et satellite' });
  await expect(photos.locator('.count')).toHaveText(/^\d{2,3} couches$/);
  await expect(panel.locator('li.row', { hasText: 'Photographies aériennes par année' })).toHaveCount(0);
  await photos.click();
  await panel.locator('summary', { hasText: /^Par année/ }).click();
  const years = panel.locator('li.row', { hasText: 'Photographies aériennes par année' });
  await expect(years).toBeVisible();
  // One row, its years in a selector, the newest first.
  const select = years.getByRole('combobox', { name: /Année de Photographies aériennes par année/ });
  expect(await select.locator('option').count()).toBeGreaterThanOrEqual(20);
  await expect(select.locator('option').first()).toHaveText('2024');
  // Folded again with the keyboard (summary: Enter), its rows gone.
  await photos.focus();
  await page.keyboard.press('Enter');
  await expect(years).toHaveCount(0);
  // « Recommandées pour la botanique » open at first, eight rows then « Afficher plus ».
  const reco = panel.locator('details.reco');
  await expect(reco.locator('li.row')).toHaveCount(8);
  await reco.getByRole('button', { name: /Afficher \d+ de plus/ }).click();
  expect(await reco.locator('li.row').count()).toBeGreaterThan(8);
});

test('recherche sans accents et détails d’une couche : description, zooms, source, une tuile d’aperçu', async ({ page, app }) => {
  await openMap(page, app);
  const panel = await browse(page);
  const search = panel.getByRole('searchbox', { name: 'Chercher une couche de l’IGN' });
  await search.fill('sylvoecoregions');
  await expect(panel.getByRole('status').filter({ hasText: /résultats?/ })).toHaveText(/^[12] résultats?$/);
  const row = panel.locator('li.row', { hasText: 'Sylvoécorégions' }).first();
  await expect(row.locator('.where')).toHaveText('Forêts et végétation › Forêts');
  // A word of a category finds its layers too.
  await search.fill('natura 2000');
  await expect(panel.locator('li.row', { hasText: 'zones de protection spéciale' })).toBeVisible();
  await search.fill('forets publiques');
  const forets = panel.locator('li.row', { hasText: 'Forêts publiques' }).first();
  const more = forets.getByRole('button', { name: 'Détails : Forêts publiques' });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const details = forets.locator('.details');
  await expect(details).toContainText('Zooms3 à 16');
  await expect(details).toContainText('ONF, via la Géoplateforme de l’IGN');
  await expect(details.locator('code')).toHaveText('FORETS.PUBLIQUES');
  // One tile, at a zoom the layer draws, of this layer.
  const preview = details.getByRole('img', { name: 'Aperçu : Forêts publiques' });
  await expect(preview).toHaveAttribute('src', /TILEMATRIX=12&.*LAYER=FORETS\.PUBLIQUES&/);
});

test('cocher une couche demande ses tuiles ; ordre, opacité et choix gardés d’une visite à l’autre', async ({ page, app }) => {
  const tiles = await openMap(page, app);
  let panel = await browse(page);
  const search = panel.getByRole('searchbox', { name: 'Chercher une couche de l’IGN' });
  // A series: its newest variant shown, then another chosen in its selector (swapped on the map).
  await search.fill('corine land cover');
  const clc = panel.locator('li.row').filter({ has: page.getByText('CORINE Land Cover', { exact: true }) }).first();
  await clc.getByRole('checkbox').check();
  await expect.poll(() => tiles.includes('LANDCOVER.CLC18')).toBe(true);
  await clc.getByRole('combobox').selectOption({ label: '2006' });
  await expect.poll(() => tiles.includes('LANDCOVER.CLC06')).toBe(true);
  await expect.poll(async () => (await savedLook(page)).overlays).toEqual(['ign:LANDCOVER.CLC06']);
  // One of the app's own overlays, from the catalogue (« Forêts publiques »): on top.
  await search.fill('forets publiques');
  await panel.locator('li.row', { hasText: 'Forêts publiques' }).first().getByRole('checkbox').check();
  const active = panel.locator('ul.active li');
  await expect(active).toHaveCount(2);
  await expect(active.first()).toContainText('Forêts publiques');
  await expect(active.nth(1)).toContainText('CORINE Land Cover — 2006');
  // CORINE moved on top; its opacity set to 40 %.
  await panel.getByRole('button', { name: 'Monter CORINE Land Cover — 2006' }).click();
  await expect(active.first()).toContainText('CORINE Land Cover — 2006');
  await expect(panel.getByRole('button', { name: 'Descendre CORINE Land Cover — 2006' })).toBeFocused();
  await panel.getByRole('slider', { name: 'Opacité de CORINE Land Cover — 2006' }).fill('40');
  await expect(active.first().locator('output')).toHaveText('40 %');
  // The map's tile layers (Leaflet's containers, in the map's shadow root: a locator reaches them).
  const layerStyle = () => page.locator('.leaflet-layer').evaluateAll(els => {
    const grid = els.find(el => el.className.includes('gf-tiles-ign:LANDCOVER.CLC06'));
    const forest = els.find(el => el.className.includes('gf-tiles-forets'));
    return grid && forest ? { opacity: getComputedStyle(grid).opacity, above: Number(getComputedStyle(grid).zIndex) > Number(getComputedStyle(forest).zIndex) } : null;
  });
  await expect.poll(layerStyle).toEqual({ opacity: '0.4', above: true });
  await expect.poll(async () => (await savedLook(page)).overlays).toEqual(['forets', 'ign:LANDCOVER.CLC06']);

  // Next visit: the same layers, in the same order, at the same opacity, their tiles asked again.
  tiles.length = 0;
  await page.reload();
  await page.locator('gf-map').first().waitFor();
  await expect.poll(() => tiles.includes('LANDCOVER.CLC06')).toBe(true);
  await expect.poll(layerStyle).toEqual({ opacity: '0.4', above: true });
  await page.locator('gf-map').first().evaluate(map => /** @type {any} */ (map).openPanel());
  panel = page.locator('gf-map-panel');
  await expect(active.first()).toContainText('CORINE Land Cover — 2006');
  await expect(panel.getByRole('slider', { name: 'Opacité de CORINE Land Cover — 2006' })).toHaveValue('40');
  // Hidden from « Couches affichées »: off the map, off the list.
  await panel.getByRole('button', { name: 'Masquer CORINE Land Cover — 2006' }).click();
  await expect(active).toHaveCount(1);
  await expect.poll(async () => (await savedLook(page)).overlays).toEqual(['forets']);
});

test('noms et réseaux dans le catalogue (« Voie ferrée », la série « Routes ») : cochés, c’est le choix de « Noms et réseaux », au-dessus de tout, jamais une couche de plus', async ({ page, app }) => {
  const tiles = await openMap(page, app);
  const panel = await browse(page);
  const search = panel.getByRole('searchbox', { name: 'Chercher une couche de l’IGN' });
  const marks = panel.getByRole('group', { name: 'Noms et réseaux' });
  // Close enough for « Noms et réseaux » (from their zoom 6).
  await page.locator('gf-map').first().evaluate(map => /** @type {any} */ (map).flyTo([2.35, 48.85], 12));
  // The railways: ticked there, one of « Noms et réseaux » (under the usual three), asked; no overlay.
  await search.fill('voie ferree');
  const rail = panel.locator('li.row', { hasText: 'Voie ferrée' }).first();
  await expect(rail.getByRole('checkbox')).not.toBeChecked();
  await rail.getByRole('checkbox').check();
  await expect.poll(async () => (await savedLook(page)).landmarks).toEqual(['rail', 'routes', 'eau', 'lieux']);
  expect((await savedLook(page)).overlays).toEqual([]);
  await expect.poll(() => tiles.includes('TRANSPORTNETWORKS.RAILWAYS')).toBe(true);
  await expect(marks.getByRole('checkbox', { name: /^Voies ferrées/ })).toBeChecked();
  await expect(panel.locator('gf-layer-stack ul.marks li')).toHaveText(['Noms de lieux', 'Cours d’eau', 'Routes', 'Voies ferrées']);
  await expect(panel.locator('ul.active')).toHaveCount(0);
  // Unticked in « Noms et réseaux »: unticked in the catalogue too.
  await marks.getByRole('checkbox', { name: /^Voies ferrées/ }).uncheck();
  await expect(rail.getByRole('checkbox')).not.toBeChecked();
  // The roads, a series: their usual version shown, ticked; unticked there, gone from « Noms et réseaux ».
  await search.fill('routes');
  const roads = panel.locator('li.row').filter({ has: page.getByRole('combobox', { name: 'Version de Routes' }) }).first();
  await expect(roads.getByRole('combobox')).toHaveValue('TRANSPORTNETWORKS.ROADS');
  await expect(roads.getByRole('checkbox')).toBeChecked();
  await roads.getByRole('checkbox').uncheck();
  await expect.poll(async () => (await savedLook(page)).landmarks).toEqual(['eau', 'lieux']);
  await expect(marks.getByRole('checkbox', { name: /^Routes/ })).not.toBeChecked();
  expect((await savedLook(page)).overlays).toEqual([]);

  // On the plan, which draws its own: their rows disabled, as chosen, said why (a ticked box and an unchanged map,
  // never); a series' version kept.
  await marks.getByRole('checkbox', { name: /^Routes/ }).check();
  await panel.getByRole('button', { name: /Plan IGN/ }).click();
  await expect.poll(async () => (await savedLook(page)).base).toBe('plan');
  const why = 'Noms et réseaux : le plan IGN dessine déjà les siens, ce choix vaut pour les photos et SPOT.';
  await expect(roads.getByRole('checkbox')).toBeDisabled();
  await expect(roads.getByRole('checkbox')).toBeChecked();
  await expect(roads.getByRole('combobox')).toBeDisabled();
  await expect(roads.getByRole('combobox')).toHaveValue('TRANSPORTNETWORKS.ROADS');
  await expect(roads).toContainText(why);
  await search.fill('limites administratives');
  const limits = panel.locator('li.row', { hasText: 'Limites administratives mises à jour en continu' }).first();
  await expect(limits.getByRole('checkbox')).toBeDisabled();
  await expect(limits.getByRole('checkbox')).toHaveAccessibleDescription(new RegExp(why.replace(/[.()]/g, '\\$&') + '$'));
  await search.fill('hydrographie');
  const water = panel.locator('li.row', { hasText: 'Hydrographie' }).first();
  await expect(water.getByRole('checkbox')).toBeDisabled();
  await expect(water.getByRole('checkbox')).toBeChecked();
  // Back on the photos: theirs again.
  await panel.getByRole('button', { name: /Photos aériennes/ }).click();
  await expect(water.getByRole('checkbox')).toBeEnabled();
  await expect(water).not.toContainText(why);
});
