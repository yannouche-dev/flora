// « Une maison pour les cartes » : how the maps look — the background, IGN's layers and their opacity, 2D or 3D — set
// in one place, the panel ▦ of each map (gf-map-options.js, scope="map"), the same options as Réglages › Cartes
// (scope="defaults"); the maps' common settings (core/map-settings.js mapLook, under the keys of before), which every
// open map follows at once, 2D and 3D; a map with its own look (a free layout's cell: base=, layers=, opac= in its
// address; a plant sheet's map block: MapConfig.look) keeps it, its panel says so and gives the common settings back
// (« Revenir aux réglages communs »); a cell's 3d= is shown fixed, with « Suivre le réglage commun » — neither way back
// when the cell's intent gives them (map(relief), map(protege)); layers=aucune: none, not the common ones. An overlay's
// opacity reaches every map, MapLibre too, a layer of several (the nature reserves) as well. The plant sheet's map ⚙ no
// longer has the background, the layers nor 2D / 3D. Every tile made here (tiles.mjs), real WebGL for 3D.
import { test, expect, answerAround, plantId } from './fixtures.mjs';
import { answerTiles } from './tiles.mjs';

/** @typedef {import('@playwright/test').Page} Page @typedef {import('@playwright/test').Locator} Locator */

test.use({ reducedMotion: 'reduce', launchOptions: { args: ['--enable-unsafe-swiftshader'] } });
test.beforeEach(async ({ context, page }) => {
  await answerAround(context);
  await answerTiles(page);
});

const AT = 'at=48.85,2.35';
const SLOW = { timeout: 30_000 };

/** The layout of the address, decoded. @param {Page} page */
const layoutOf = page => page.evaluate(() => decodeURIComponent(location.hash.split('?')[0].replace(/^#\/layout\//, '')));
/** The free layout's maps. @param {Page} page */
const maps = page => page.locator('dl-map gf-map');
/** What a map shows: its background and overlays (its own look over the common one). @param {Locator} map */
const shown = map => map.evaluate(m => { const l = /** @type {any} */ (m).lookShown; return { base: l.base, overlays: l.overlays }; });
/** The common settings as kept (the key of before). @param {Page} page */
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.mapLayer') || 'null'));
/** An overlay's opacity in 2D (Leaflet: each of its tile layers). @param {Locator} map @param {string} key */
const opacities = (map, key) => map.evaluate((m, k) => [...m.querySelectorAll('.gf-tiles-' + k)].map(e => getComputedStyle(e).opacity), key);
/** An overlay's opacity as MapLibre draws it (a map in 3D: each of its tile layers). @param {Locator} map @param {string} key */
const glOpacity = (map, key) => map.evaluate((m, k) => /** @type {any} */ (m).gl.glMap.getStyle().layers
  .filter((/** @type {any} */ l) => l.metadata?.['gf:key'] === k).map((/** @type {any} */ l) => l.paint['raster-opacity']), key);
/** The 3D maps here: flat and bare (quicker in software WebGL). @param {Page} page */
const flat3d = page => page.addInitScript(() => localStorage.setItem('geoflora.maps3d', JSON.stringify({ relief: false, buildings: false, hillshade: false, sky: false, pitch: 0 })));

/** A map's panel ▦, open. @param {Locator} map */
async function openPanel(map) {
  await map.evaluate(m => /** @type {any} */ (m).openPanel());
  const panel = map.locator('gf-map-panel dialog');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Affichage' })).toBeVisible();
  return panel;
}

test('un réglage commun changé dans le panneau ▦ d’une carte : toutes les cartes ouvertes le suivent, en 2D comme en 3D ; une 3D fixée par l’adresse rendue au réglage commun', async ({ app, page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'two maps side by side, software WebGL: one project');
  test.slow();
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.addInitScript(() => localStorage.setItem('geoflora.maps3d', JSON.stringify({ relief: false, buildings: false, hillshade: false, sky: false, pitch: 0 })));
  await app.open(`#/layout/[map(r=2km;3d=1),map(r=2km)]?${AT}`);
  const in3d = maps(page).nth(0), in2d = maps(page).nth(1);
  await expect(in3d).toHaveAttribute('data-renderer', '3d', SLOW);
  await expect(in2d).toHaveAttribute('data-renderer', '2d');
  // The 2D map's panel: the common settings, the plan and the contour lines chosen there.
  const panel = await openPanel(in2d);
  await expect(panel.locator('.scope')).toContainText('Réglages communs à toutes les cartes');
  await panel.getByRole('button', { name: /Plan IGN/ }).click();
  await panel.getByRole('checkbox', { name: /Courbes de niveau/ }).check();
  // Both maps follow at once; the 3D one draws them (its tiles are its 2D map's, mirrored).
  await expect.poll(() => shown(in2d)).toEqual({ base: 'plan', overlays: ['contours'] });
  await expect.poll(() => shown(in3d)).toEqual({ base: 'plan', overlays: ['contours'] });
  await expect.poll(async () => (await in3d.evaluate(m => /** @type {any} */ (m).gl.state())).tiles.map((/** @type {any} */ t) => t.key), SLOW).toEqual(['plan', 'contours']);
  // Kept as every map's, under the key of before; the layout's address unchanged.
  expect(await stored(page)).toEqual({ base: 'plan', overlays: ['contours'], distribution: false });
  expect(await layoutOf(page)).toBe('[map(r=2km,3d=1),map(r=2km)]');
  await panel.getByRole('button', { name: 'Fermer' }).click();

  // The 3D map's panel: the same settings — an opacity changed there, the 2D map draws it too.
  const panel3d = await openPanel(in3d);
  await expect(panel3d.getByRole('button', { name: /Plan IGN/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel3d.getByRole('checkbox', { name: /Courbes de niveau/ })).toBeChecked();
  await panel3d.getByRole('slider', { name: 'Opacité de Courbes de niveau' }).fill('50');
  await expect.poll(() => in2d.evaluate(m => getComputedStyle(/** @type {HTMLElement} */ (m.querySelector('.gf-tiles-contours'))).opacity)).toBe('0.5');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.overlayOpacity') || 'null'))).toEqual({ contours: 0.5 });
  // MapLibre draws it too, though its slider had already moved its 2D layer.
  await expect.poll(() => glOpacity(in3d, 'contours'), SLOW).toEqual([0.5]);
  // Its 3D, fixed by its address (3d=1): shown so, why said, and the way back to the common choice (2D here).
  const choice = panel3d.getByRole('group', { name: 'Carte en 2D ou en 3D' });
  await expect(choice.getByRole('radio', { name: /^3D/ })).toBeChecked();
  await expect(choice.getByRole('radio', { name: /^2D/ })).toBeDisabled();
  await expect(panel3d).toContainText('Cette carte de la disposition est en 3D (3d=1 dans son adresse');
  await panel3d.getByRole('button', { name: 'Suivre le réglage commun' }).click();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=2km),map(r=2km)]');
  await expect(in3d).toHaveAttribute('data-renderer', '2d');
  await expect(choice.getByRole('radio', { name: /^2D/ })).toBeChecked();
  await expect(choice.getByRole('radio', { name: /^3D/ })).toBeEnabled();
  await expect(panel3d.getByRole('button', { name: 'Suivre le réglage commun' })).toHaveCount(0);
});

test('l’opacité des réserves naturelles (deux couches) : suivie par chaque carte ouverte, en 2D comme en 3D, celle dont le curseur a bougé comprise', async ({ app, page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'two maps side by side, software WebGL: one project');
  test.slow();
  await page.setViewportSize({ width: 1100, height: 700 });
  await flat3d(page);
  await page.addInitScript(() => localStorage.setItem('geoflora.mapLayer', JSON.stringify({ base: 'plan', overlays: ['reserves'], distribution: false })));
  await app.open(`#/layout/[map(r=2km;3d=1),map(r=2km)]?${AT}`);
  const in3d = maps(page).nth(0), in2d = maps(page).nth(1);
  await expect(in3d).toHaveAttribute('data-renderer', '3d', SLOW);
  await expect.poll(() => glOpacity(in3d, 'reserves'), SLOW).toEqual([0.8, 0.8]);
  // Changed in the 2D map's panel: both its layers, on both maps (the 3D one drawing it anew).
  const panel = await openPanel(in2d);
  await panel.getByRole('slider', { name: 'Opacité de Réserves naturelles' }).fill('40');
  await expect.poll(() => opacities(in2d, 'reserves')).toEqual(['0.4', '0.4']);
  await expect.poll(() => opacities(in3d, 'reserves')).toEqual(['0.4', '0.4']);
  await expect.poll(() => glOpacity(in3d, 'reserves'), SLOW).toEqual([0.4, 0.4]);
  await panel.getByRole('button', { name: 'Fermer' }).click();
  // Changed in the 3D map's own panel: MapLibre draws it, the other map follows.
  const panel3d = await openPanel(in3d);
  await panel3d.getByRole('slider', { name: 'Opacité de Réserves naturelles' }).fill('60');
  await expect.poll(() => glOpacity(in3d, 'reserves'), SLOW).toEqual([0.6, 0.6]);
  await expect.poll(() => opacities(in2d, 'reserves')).toEqual(['0.6', '0.6']);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.overlayOpacity') || 'null'))).toEqual({ reserves: 0.6 });
});

test('une case qui décoche sa dernière couche n’en montre aucune (layers=aucune), pas les couches communes ; sans layers=, elle les suit', async ({ app, page }) => {
  await page.addInitScript(() => localStorage.setItem('geoflora.mapLayer', JSON.stringify({ base: 'photo', overlays: ['forets'], distribution: false })));
  await app.open(`#/layout/[map(r=1km;layers=cadastre)]?${AT}`);
  const map = maps(page).nth(0);
  await expect.poll(() => shown(map)).toEqual({ base: 'photo', overlays: ['cadastre'] });
  const panel = await openPanel(map);
  await expect(panel.locator('.scope')).toContainText('Cette carte a ses propres couches');
  await panel.getByRole('checkbox', { name: /Parcelles cadastrales/ }).uncheck();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,layers=aucune)]');
  await expect.poll(() => shown(map)).toEqual({ base: 'photo', overlays: [] });
  await expect(panel.locator('.scope')).toContainText('Cette carte a ses propres couches');
  await expect(panel.getByRole('checkbox', { name: /Forêts publiques/ })).not.toBeChecked();
  // Its own still: a layer ticked now is its own, not every map's.
  await panel.getByRole('checkbox', { name: /Courbes de niveau/ }).check();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,layers=courbes)]');
  expect(await stored(page)).toEqual({ base: 'photo', overlays: ['forets'], distribution: false });
  // « Revenir aux réglages communs »: the common layers again.
  await panel.getByRole('button', { name: 'Revenir aux réglages communs' }).click();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km)]');
  await expect.poll(() => shown(map)).toEqual({ base: 'photo', overlays: ['forets'] });
});

test('une intention qui met la carte en 3D : son panneau ▦ le dit, sans « Suivre le réglage commun » (sans 3d=, elle y resterait)', async ({ app, page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'software WebGL: one project');
  test.slow();
  await flat3d(page);
  await app.open(`#/layout/[map(relief;r=1km)]?${AT}`);
  const map = maps(page).nth(0);
  await expect(map).toHaveAttribute('data-renderer', '3d', SLOW);
  const panel = await openPanel(map);
  await expect(panel).toContainText('Cette carte de la disposition est en 3D (son intention « Relief »');
  await expect(panel).not.toContainText('3d=1');
  await expect(panel.getByRole('group', { name: 'Carte en 2D ou en 3D' }).getByRole('radio', { name: /^2D/ })).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Suivre le réglage commun' })).toHaveCount(0);
  expect(await layoutOf(page)).toBe('[map(relief,r=1km)]');
});

test('une intention qui donne les couches : son panneau ▦ le dit, sans « Revenir aux réglages communs » (elle les redonnerait)', async ({ app, page }) => {
  await app.open(`#/layout/[map(protege;r=1km)]?${AT}`);
  const map = maps(page).nth(0);
  await expect.poll(async () => (await shown(map)).overlays).toContain('parcs');
  const panel = await openPanel(map);
  await expect(panel.locator('.scope')).toContainText('Cette carte a ses propres couches (son intention « Espaces protégés » dans la disposition)');
  await expect(panel.getByRole('button', { name: 'Revenir aux réglages communs' })).toHaveCount(0);
  await expect(panel.getByRole('checkbox', { name: /Parcs nationaux/ })).toBeChecked();
});

test('une intention qui donne le fond, des couches écrites en plus : « Revenir aux réglages communs » reprend ces couches, le fond de l’intention reste', async ({ app, page }) => {
  await app.open(`#/layout/[map(terrain;r=1km;layers=parcs)]?${AT}`);
  const map = maps(page).nth(0);
  await expect.poll(() => shown(map)).toEqual({ base: 'photo', overlays: ['parcs'] });
  let panel = await openPanel(map);
  await panel.getByRole('button', { name: 'Revenir aux réglages communs' }).click();
  await expect.poll(() => layoutOf(page)).not.toContain('layers=');
  await expect.poll(() => shown(map)).toEqual({ base: 'photo', overlays: [] });
  // Left with the intent's photos alone: said so, no way back.
  panel = await openPanel(map);
  await expect(panel.locator('.scope')).toContainText('(son intention « Sur le terrain » dans la disposition)');
  await expect(panel.getByRole('button', { name: 'Revenir aux réglages communs' })).toHaveCount(0);
});

test.describe('un grand écran', () => {
  test.skip(({ isMobile }) => isMobile, 'two maps side by side');

  test('une carte à son propre fond le garde quand les réglages communs changent ; « Revenir aux réglages communs » le lui rend', async ({ app, page }) => {
    await app.open(`#/layout/[map(r=1km;base=photo),map(r=1km)]?${AT}`);
    const own = maps(page).nth(0), common = maps(page).nth(1);
    await expect.poll(() => shown(own)).toEqual({ base: 'photo', overlays: [] });
    await expect.poll(() => shown(common)).toEqual({ base: 'photo', overlays: [] });
    // The common settings changed in the other map's panel: the plan, the national parks.
    let panel = await openPanel(common);
    await panel.getByRole('button', { name: /Plan IGN/ }).click();
    await panel.getByRole('checkbox', { name: /Parcs nationaux/ }).check();
    await expect.poll(() => shown(common)).toEqual({ base: 'plan', overlays: ['parcs'] });
    // The map with its own background keeps it; its layers, not its own, follow.
    await expect.poll(() => shown(own)).toEqual({ base: 'photo', overlays: ['parcs'] });
    expect(await layoutOf(page)).toBe('[map(r=1km,base=photo),map(r=1km)]');
    await panel.getByRole('button', { name: 'Fermer' }).click();

    // Its panel says so; a change made there is its own (its address), not the common one.
    panel = await openPanel(own);
    await expect(panel.locator('.scope')).toContainText('Cette carte a son propre fond');
    await expect(panel.getByRole('button', { name: /Photos aériennes/ })).toHaveAttribute('aria-pressed', 'true');
    await panel.getByRole('checkbox', { name: /Réserves naturelles/ }).check();
    await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,base=photo,layers=parcs+reserves),map(r=1km)]');
    await expect(panel.locator('.scope')).toContainText('Cette carte a son propre fond et ses propres couches');
    await expect.poll(() => shown(own)).toEqual({ base: 'photo', overlays: ['parcs', 'reserves'] });
    expect(await shown(common)).toEqual({ base: 'plan', overlays: ['parcs'] });
    expect(await stored(page)).toEqual({ base: 'plan', overlays: ['parcs'], distribution: false });
    // « Revenir aux réglages communs »: its own look let go (its address too), the common one shown.
    await panel.getByRole('button', { name: 'Revenir aux réglages communs' }).click();
    await expect.poll(() => layoutOf(page)).toBe('[map(r=1km),map(r=1km)]');
    await expect.poll(() => shown(own)).toEqual({ base: 'plan', overlays: ['parcs'] });
    await expect(panel.locator('.scope')).toContainText('Réglages communs à toutes les cartes');
    await expect(panel.getByRole('button', { name: /Plan IGN/ })).toHaveAttribute('aria-pressed', 'true');
    // Reloaded: both follow the common settings.
    await page.reload();
    await app.ready();
    await expect.poll(() => shown(maps(page).nth(0))).toEqual({ base: 'plan', overlays: ['parcs'] });
    await expect.poll(() => shown(maps(page).nth(1))).toEqual({ base: 'plan', overlays: ['parcs'] });
  });
});

test('Réglages › Cartes : les mêmes options que le panneau ▦ de chaque carte — les réglages communs, que la Carte suit', async ({ app, page }) => {
  await app.open('#/settings');
  const options = page.locator('gf-settings gf-map-options[scope="defaults"]');
  await expect(options).toBeVisible();
  // The same parts: 2D or 3D, the background, IGN's layers (terrain, the whole catalogue, the rules of picking).
  await expect(options.getByRole('group', { name: 'Affichage des cartes' })).toBeVisible();
  await expect(options.getByRole('group', { name: 'Fond de carte' }).getByRole('button', { name: /Photos aériennes/ })).toHaveAttribute('aria-pressed', 'true');
  for (const name of ['Parcelles cadastrales', 'Courbes de niveau', 'Forêts publiques', 'Parcs nationaux', 'Réserves naturelles', 'Protection de biotope']) {
    await expect(options.getByRole('checkbox', { name: new RegExp(name) })).toBeVisible();
  }
  await expect(options.getByRole('heading', { name: 'Toutes les couches de l’IGN' })).toBeVisible();
  await expect(options.getByRole('button', { name: /Parcourir les couches de l’IGN/ })).toBeVisible();
  // No map here: nothing about one map's own look.
  await expect(options.getByRole('button', { name: 'Revenir aux réglages communs' })).toHaveCount(0);
  await options.getByRole('button', { name: /Plan IGN/ }).click();
  await options.getByRole('checkbox', { name: /Forêts publiques/ }).check();
  await expect.poll(() => stored(page)).toEqual({ base: 'plan', overlays: ['forets'], distribution: false });
  // The Carte follows them; its panel ▦ shows the same.
  await app.go('#/map');
  const map = page.locator('gf-map-page gf-map');
  await expect.poll(() => shown(map)).toEqual({ base: 'plan', overlays: ['forets'] });
  const panel = await openPanel(map);
  await expect(panel.locator('.scope')).toContainText('Réglages communs à toutes les cartes');
  await expect(panel.getByRole('link', { name: 'Réglages › Cartes' })).toHaveAttribute('href', '#/settings');
  await expect(panel.getByRole('button', { name: /Plan IGN/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('checkbox', { name: /Forêts publiques/ })).toBeChecked();
});

test('fiche plante : son ⚙ n’a plus ni fond, ni couches IGN, ni 2D / 3D ; un bloc à son propre fond le dit, et son panneau ▦ le rend aux réglages communs', async ({ app, page }) => {
  test.slow();
  await app.open('#/');
  // A map block with its own look (set before: its background and the cadastre).
  await page.evaluate(async () => { (await import('/app/core/sheet-blocks.js')).setMapConfig('map', { look: { base: 'plan', overlays: ['cadastre'] } }); });
  await app.go(`#/plant/${plantId('Urtica dioica')}`);
  const map = page.locator('gf-sheet-map gf-map').first();
  await map.scrollIntoViewIfNeeded();
  await expect.poll(() => shown(map), { timeout: 20_000 }).toEqual({ base: 'plan', overlays: ['cadastre'] });
  // Mode King, its ⚙: what it shows and lets do — not how it looks (said: its panel ▦).
  await page.evaluate(async () => { (await import('/app/core/store.js')).setKingMode(true); });
  await page.getByRole('button', { name: 'Configurer la carte « Carte »' }).click();
  const form = page.locator('gf-plant-detail .map-form').first();
  await expect(form.getByRole('combobox', { name: 'Cadrage' })).toBeVisible();
  await expect(form.getByRole('group', { name: 'Carte en 2D ou en 3D' })).toHaveCount(0);
  await expect(form.getByRole('combobox', { name: 'Fond' })).toHaveCount(0);
  await expect(form.getByRole('checkbox', { name: 'Parcelles cadastrales' })).toHaveCount(0);
  await expect(form).toContainText('dans le panneau ▦ de la carte (cette carte a son propre fond');
  // Its panel ▦: its own look, said, and given back to the common settings (kept in the sheet's layout).
  const panel = await openPanel(map);
  await expect(panel.locator('.scope')).toContainText('Cette carte a son propre fond et ses propres couches');
  await expect(panel.getByRole('checkbox', { name: /Parcelles cadastrales/ })).toBeChecked();
  await panel.getByRole('button', { name: 'Revenir aux réglages communs' }).click();
  await expect.poll(() => page.evaluate(async () => (await import('/app/core/sheet-blocks.js')).mapConfig('map').look)).toBe(null);
  await expect.poll(() => shown(map)).toEqual({ base: 'photo', overlays: [] });
  await expect(panel.locator('.scope')).toContainText('Réglages communs à toutes les cartes');
  // A change there now: the common settings (every map's), the block's configuration left as it is.
  await panel.getByRole('button', { name: /Plan IGN/ }).click();
  await expect.poll(() => stored(page)).toEqual({ base: 'plan', overlays: [], distribution: false });
  await expect.poll(() => shown(map)).toEqual({ base: 'plan', overlays: [] });
  expect(await page.evaluate(async () => (await import('/app/core/sheet-blocks.js')).mapConfig('map').look)).toBe(null);
  await panel.getByRole('button', { name: 'Fermer' }).click();
  await expect(form).toContainText('dans le panneau ▦ de la carte (réglages communs à toutes les cartes)');
});
