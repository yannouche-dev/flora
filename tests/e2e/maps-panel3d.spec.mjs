// The 2D / 3D choice in the panel ▦ of every map (gf-map-options.js « Affichage », the maps' one choice of
// core/map-settings.js): on the Carte, the plant sheet's map (and in its pane beside), Mes plantes' place map, a
// place's editor, the mini-apps' maps (Rencontres' first steps, Parcours' walk) — each one's panel has « 2D » / « 3D »;
// « 3D » chosen there swaps that map to MapLibre and is stored for every map (Réglages › Cartes show it); « 2D » there
// brings it back. The maps that always stay one way show the choice disabled, with why: « Jusqu’où part
// l’expédition ? » (from above), a second map of a plant sheet (one WebGL map per sheet). The map block's form of the
// plant sheet (mode King, ⚙) no longer has it, nor the background and IGN's layers: its panel ▦ does. Real WebGL
// (SwiftShader), every tile made here (tiles.mjs).
import { test, expect, plantId, answerAround } from './fixtures.mjs';
import { answerTiles } from './tiles.mjs';

/** @typedef {import('@playwright/test').Page} Page @typedef {import('@playwright/test').Locator} Locator */

test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });
test.beforeEach(async ({ page, context, firstVisit }, info) => {
  // Software WebGL draws every pixel on the CPU: a smaller desktop window, a flat map from above, no buildings (not on
  // a first visit: a setting stored makes the app « used before »).
  if (info.project.name.startsWith('desktop')) await page.setViewportSize({ width: 1024, height: 680 });
  if (!firstVisit) await page.addInitScript(() => {
    if (!sessionStorage.getItem('gf-maps3d-set')) { sessionStorage.setItem('gf-maps3d-set', '1'); localStorage.setItem('geoflora.maps3d', JSON.stringify({ pitch: 0, relief: false, buildings: false, hillshade: false })); }
  });
  await answerTiles(page);
  await answerAround(context);
});

const LABEL = 'Carte : fond, couches, légende';
const stored = (/** @type {Page} */ page) => page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.maps3d') || 'null')?.renderer ?? '2d');

/** The map's panel « Carte », opened from its own button (round, or at the end of its search pill). @param {Locator} map */
async function openPanel(map) {
  await map.getByRole('button', { name: LABEL }).click();
  const panel = map.locator('gf-map-panel dialog');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Affichage' })).toBeVisible();
  return panel;
}

/** The panel's 2D / 3D choice. @param {Locator} panel */
const choice = panel => panel.getByRole('group', { name: 'Carte en 2D ou en 3D' });

/**
 * From the map's own panel: 2D shown, « 3D » chosen → this map in MapLibre, stored for every map; « 2D » → back.
 * @param {Page} page @param {Locator} map
 */
async function switchFromPanel(page, map) {
  await expect(map.locator('.leaflet-container')).toBeAttached();
  await expect(map).toHaveAttribute('data-renderer', '2d');
  const panel = await openPanel(map);
  const group = choice(panel);
  await expect(group.getByRole('radio', { name: /^2D/ })).toBeChecked();
  await group.getByRole('radio', { name: /^3D/ }).check();
  await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 30_000 });
  await expect(map.locator('canvas.maplibregl-canvas')).toHaveCount(1);
  expect(await stored(page)).toBe('3d');
  // Its options, folded, the same as Réglages'.
  await panel.getByText('Options de la 3D').click();
  await expect(panel.getByRole('checkbox', { name: /Ciel et brume/ })).toBeChecked();
  // Back to 2D from the same panel.
  await group.getByRole('radio', { name: /^2D/ }).check();
  await expect(map).toHaveAttribute('data-renderer', '2d');
  await expect(map.locator('canvas.maplibregl-canvas')).toHaveCount(0);
  expect(await stored(page)).toBe('2d');
  await panel.getByRole('button', { name: 'Fermer' }).click();
}

/** A place in Clermont-Ferrand with two plants. @param {Page} page @returns {Promise<string>} its id */
const seedPlace = page => page.evaluate(async ({ a, b }) => {
  const col = await import('/app/core/collections.js');
  let p = col.newPlace([3.0870, 45.7772], { name: 'Jardin Lecoq' });
  p = col.withPlant(p, { id: a, scientificName: 'Urtica dioica' }, { coordinates: [3.0875, 45.7775], accuracy: 5 });
  p = col.withPlant(p, { id: b, scientificName: 'Allium ursinum' }, { coordinates: [3.0866, 45.7769], accuracy: 5 });
  return (await col.savePlace(p)).id;
}, { a: plantId('Urtica dioica'), b: plantId('Allium ursinum') });

test('la Carte : 2D / 3D dans son panneau, la même chose que Réglages › Cartes', async ({ app, page }) => {
  test.slow();
  await app.open('#/map');
  const map = page.locator('gf-map-page gf-map');
  await switchFromPanel(page, map);
  // Chosen in the panel, shown in Réglages (one choice for every map).
  const panel = await openPanel(map);
  await choice(panel).getByRole('radio', { name: /^3D/ }).check();
  await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 30_000 });
  await app.go('#/settings');
  await expect(page.locator('gf-settings').getByRole('group', { name: 'Affichage des cartes' }).getByRole('radio', { name: /^3D/ })).toBeChecked();
});

test('la carte d’un lieu de Mes plantes', async ({ app, page }) => {
  test.slow();
  await app.open('#/collections');
  const id = await seedPlace(page);
  await app.go(`#/collections?c=${id}`);
  await switchFromPanel(page, page.locator('gf-collections gf-map'));
});

test('un lieu : sa fiche sur la Carte ; un nouveau lieu sur sa propre carte (en 2D pendant le placement, puis au choix)', async ({ app, page }) => {
  test.slow();
  await app.open('#/collections');
  const id = await seedPlace(page);
  // A place opened: its editor beside the Carte, whose map is the place's.
  await app.go(`#/collection/${id}`);
  await switchFromPanel(page, page.locator('gf-map-page gf-map'));
  // A new place: its own map, its point being placed (positions edited: 2D, the panel's button set aside), then
  // « Terminé »: the panel and its choice.
  await app.go('#/collection/new?kind=place&at=45.777200,3.087000');
  const map = page.locator('gf-spot-editor gf-map');
  await expect(map).toHaveAttribute('editing', '');
  await expect(map.getByRole('button', { name: LABEL })).toBeHidden();
  await map.locator('.gf-map-editbar').getByRole('button', { name: 'Terminé' }).click();
  await switchFromPanel(page, map);
});

test('fiche plante : sa carte en 3D depuis son panneau ; une carte ajoutée reste en 2D et le dit ; le formulaire du bloc renvoie au panneau', async ({ app, page }) => {
  test.slow();
  await app.open('#/collections');
  await seedPlace(page);
  await page.evaluate(async () => { (await import('/app/core/sheet-blocks.js')).createMap('Ma carte'); });
  await app.go(`#/plant/${plantId('Urtica dioica')}`);
  await expect(page.locator('gf-sheet-map gf-map')).toHaveCount(2, { timeout: 20_000 });
  const main = page.locator('gf-sheet-map:not([map-3d="off"]) gf-map');
  await main.scrollIntoViewIfNeeded();
  await switchFromPanel(page, main);

  // The map added: the choice disabled, why said.
  const added = page.locator('gf-sheet-map[map-3d="off"] gf-map');
  await added.scrollIntoViewIfNeeded();
  const panel = await openPanel(added);
  await expect(choice(panel).getByRole('radio', { name: /^3D/ })).toBeDisabled();
  await expect(choice(panel).getByRole('radio', { name: /^2D/ })).toBeChecked();
  await expect(panel).toContainText('Une seule carte en 3D par fiche plante');
  await panel.getByRole('button', { name: 'Fermer' }).click();

  // Mode King: the map block's form (⚙) keeps its subject, its layers, its framing, its height and its actions; its
  // background, IGN's layers and 2D / 3D are its panel ▦'s — said.
  await page.evaluate(async () => { (await import('/app/core/store.js')).setKingMode(true); });
  await page.getByRole('button', { name: 'Configurer la carte « Carte »' }).click();
  const form = page.locator('gf-plant-detail .map-form').first();
  await expect(form.getByRole('combobox', { name: 'La carte montre' })).toBeVisible();
  await expect(form.getByRole('combobox', { name: 'Hauteur' })).toBeVisible();
  await expect(form.getByRole('group', { name: 'Carte en 2D ou en 3D' })).toHaveCount(0);
  await expect(form.getByRole('combobox', { name: 'Fond' })).toHaveCount(0);
  await expect(form.getByRole('checkbox', { name: 'Parcelles cadastrales' })).toHaveCount(0);
  await expect(form).toContainText('Fond, couches IGN, 2D ou 3D : dans le panneau ▦ de la carte (réglages communs à toutes les cartes)');
});

test('la carte d’une fiche dans le volet d’à côté', async ({ app, page }) => {
  test.slow();
  await app.open(`#/plant/${plantId('Urtica dioica')}?pane=map`);
  const map = page.locator('gf-sheet-map:not([map-3d="off"]) gf-map').last();
  await map.scrollIntoViewIfNeeded();
  await switchFromPanel(page, map);
});

test('Parcours : la carte de la marche', async ({ app, page }) => {
  test.slow();
  await app.open('#/app/parcours');
  await page.locator('gf-miniapp .go').click();
  const map = page.locator('gf-miniapp ma-walk-map gf-map');
  await map.scrollIntoViewIfNeeded();
  await switchFromPanel(page, map);
});

test.describe('Rencontres, première fois', () => {
  test.use({ firstVisit: true, reducedMotion: 'reduce' });
  test('la carte des premiers pas', async ({ app, page }) => {
    test.slow();
    await app.open('#/');
    await page.locator('gf-launcher li[data-app="rencontres"]').getByRole('button', { name: 'Commencer : Rencontres', exact: true }).click();
    await page.getByRole('button', { name: 'Autour de moi' }).click();
    const map = page.locator('ma-guided .g-mapbox gf-map');
    await expect(map.locator('path.gf-area')).toHaveCount(1);
    await switchFromPanel(page, map);
  });
});

test('« Jusqu’où part l’expédition ? » : le choix grisé, vue de dessus, même en 3D', async ({ app, page }) => {
  await page.addInitScript(() => localStorage.setItem('geoflora.maps3d', JSON.stringify({ renderer: '3d' })));
  await app.open('#/app/rencontres');
  await page.getByRole('button', { name: 'Autour de moi' }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/app/rencontres/map');
  const map = page.locator('ma-distance gf-map');
  await expect(map.locator('.leaflet-container')).toBeVisible();
  const panel = await openPanel(map);
  await expect(choice(panel).getByRole('radio', { name: /^2D/ })).toBeChecked();
  await expect(choice(panel).getByRole('radio', { name: /^3D/ })).toBeDisabled();
  await expect(panel).toContainText('Cette étape montre la distance vue de dessus');
  await expect(panel.getByText('Options de la 3D')).toHaveCount(0);
  await expect(map).toHaveAttribute('data-renderer', '2d');
});
