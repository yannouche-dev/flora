// « Fond par année et Satellite » : the maps' background of a year (core/backgrounds.js) — the aerial photos of one year,
// of a period, the historical ones, over the most recent ones greyed where those are missing; SPOT's satellite images of
// a year —, chosen in the panel ▦ of a map or in Réglages › Cartes (gf-map-options.js: « Date des photos », « Année des
// images »), kept as the maps' common background (geoflora.mapLayer) and found again after a reload, drawn in 2D
// (Leaflet: the layer named in each tile's address, the greyed photos under it) and in 3D (MapLibre: its sources name
// the layer, the greyed photos without their colours); a free layout's cell says its own (base=spot, annee=2020, or
// annee= alone) and keeps what its panel changes, its 3D beside its year (annee=2020;3d=1, read again whole), its
// thumbnail giving the common SPOT back; the editor's « Date du fond », its background's years only. Every tile made
// here (tiles.mjs), real WebGL for 3D.
import { test, expect, answerAround } from './fixtures.mjs';
import { answerTiles } from './tiles.mjs';

/** @typedef {import('@playwright/test').Page} Page @typedef {import('@playwright/test').Locator} Locator */

test.use({ reducedMotion: 'reduce', launchOptions: { args: ['--enable-unsafe-swiftshader'] } });

/** The IGN tiles asked in this test (their addresses). @type {string[]} */
let seen = [];
test.beforeEach(async ({ context, page }) => {
  seen = [];
  await answerAround(context);
  await answerTiles(page, { seen });
});

const AT = 'at=48.85,2.35';
const SLOW = { timeout: 30_000 };

/** The WMTS layers asked so far, once each. */
const asked = () => [...new Set(seen.filter(u => u.includes('REQUEST=GetTile')).map(u => new URL(u).searchParams.get('LAYER')))];
/** The layout of the address, decoded. @param {Page} page */
const layoutOf = page => page.evaluate(() => decodeURIComponent(location.hash.split('?')[0].replace(/^#\/layout\//, '')));
/** The background a map shows (its own over the common one). @param {Locator} map */
const baseOf = map => map.evaluate(m => /** @type {any} */ (m).lookShown.base);
/** The common background as kept (the key of before). @param {Page} page */
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.mapLayer') || 'null')?.base ?? null);
/** A map's tile layers in 2D: each one's classes, filter and tiles drawn. @param {Locator} map */
const tileLayers = map => map.evaluate(m => [...m.querySelectorAll('.leaflet-tile-pane > .leaflet-layer')]
  .map(e => ({ cls: e.className, filter: getComputedStyle(e).filter, tiles: e.querySelectorAll('img.leaflet-tile-loaded').length })));
/** The filter of the most recent photos under a year's: greyed and pale (map.css). */
const PALE = 'grayscale(1) contrast(0.36) brightness(1.25)';

/** A map's panel ▦, open. @param {Locator} map */
async function openPanel(map) {
  await map.evaluate(m => /** @type {any} */ (m).openPanel());
  const panel = map.locator('gf-map-panel dialog');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Fond' })).toBeVisible();
  return panel;
}

test('les photos d’une période : ses tuiles et, dessous, les plus récentes en gris pâle ; la note le dit (la description de la liste) ; la France entière au zoom 5 ; gardé au rechargement', async ({ app, page }) => {
  await app.open(`#/layout/[map(r=1km)]?${AT}`);
  const map = page.locator('dl-map gf-map');
  await expect.poll(() => baseOf(map)).toBe('photo');
  const panel = await openPanel(map);
  const fond = panel.getByRole('group', { name: 'Fond de carte' });
  await expect(fond.getByRole('button', { name: /Photos aériennes/ })).toHaveAttribute('aria-pressed', 'true');
  // The photos' date: a list with its label, the most recent first.
  const date = panel.getByRole('combobox', { name: 'Date des photos' });
  await expect(date).toHaveValue('photo');
  await expect(date.locator('option:checked')).toHaveText('La plus récente');
  await expect(panel.getByText(/n’a pas photographié/)).toHaveCount(0);
  seen.length = 0;
  await date.selectOption({ label: '2016 – 2020' });
  // The common background (no own look here): every map's, kept under the key of before, as a string.
  await expect.poll(() => stored(page)).toBe('photo:2016-2020');
  await expect.poll(() => baseOf(map)).toBe('photo:2016-2020');
  expect(await layoutOf(page)).toBe('[map(r=1km)]');
  // Its tiles, and the most recent photos' under them (greyed).
  await expect.poll(asked).toEqual(expect.arrayContaining(['ORTHOIMAGERY.ORTHOPHOTOS2016-2020', 'ORTHOIMAGERY.ORTHOPHOTOS']));
  expect(seen.some(u => /LAYER=ORTHOIMAGERY\.ORTHOPHOTOS2016-2020&STYLE=normal&FORMAT=image%2Fjpeg/.test(u))).toBe(true);
  await expect.poll(async () => (await tileLayers(map)).filter(l => l.cls.includes('gf-tiles-photo:2016-2020')).map(l => [l.cls.includes('gf-grey'), l.filter]))
    .toEqual([[true, PALE], [false, 'none']]);
  // The note: the list's description, said as it comes — by the panel's one live region (a modal: one region says all).
  const note = 'Là où l’IGN n’a pas photographié de 2016 à 2020 : les photos les plus récentes, en gris pâle. De très loin aussi : celles de 2016 à 2020 apparaissent en s’approchant.';
  await expect(panel.locator('#panel-base-when-note')).toHaveText(note);
  await expect(date).toHaveAccessibleDescription(note);
  await expect(panel.locator('[aria-live]')).toHaveCount(1);
  await expect(panel.locator('[aria-live]')).toContainText(note);
  await expect(fond.getByRole('button', { name: /Photos aériennes/ })).toHaveAttribute('aria-pressed', 'true');
  // France whole (zoom 5, a phone's France view): the period's photos still drawn — its zoom 6 tiles, smaller.
  await map.evaluate(m => /** @type {any} */ (m).flyTo([2.35, 46.6], 5));
  await expect.poll(() => map.evaluate(m => /** @type {any} */ (m).zoom())).toBe(5);
  await expect.poll(async () => (await tileLayers(map)).find(l => l.cls.includes('gf-tiles-photo:2016-2020') && !l.cls.includes('gf-grey'))?.tiles ?? 0).toBeGreaterThan(0);
  expect(seen.some(u => (q => q.get('LAYER') === 'ORTHOIMAGERY.ORTHOPHOTOS2016-2020' && q.get('TILEMATRIX') === '6')(new URL(u).searchParams))).toBe(true);

  // Reloaded: the same background, the same choice shown, its tiles asked again.
  seen.length = 0;
  await page.reload();
  await app.ready();
  const again = page.locator('dl-map gf-map');
  await expect.poll(() => baseOf(again)).toBe('photo:2016-2020');
  await expect.poll(asked).toContain('ORTHOIMAGERY.ORTHOPHOTOS2016-2020');
  const panel2 = await openPanel(again);
  await expect(panel2.getByRole('combobox', { name: 'Date des photos' })).toHaveValue('photo:2016-2020');

  // A historical one: PNG, its own style.
  seen.length = 0;
  await panel2.getByRole('combobox', { name: 'Date des photos' }).selectOption('photo:1950-1965');
  await expect.poll(() => seen.some(u => /LAYER=ORTHOIMAGERY\.ORTHOPHOTOS\.1950-1965&STYLE=BDORTHOHISTORIQUE&FORMAT=image%2Fpng/.test(u))).toBe(true);
  await expect(panel2.locator('#panel-base-when-note')).toHaveText('Là où l’IGN n’a pas photographié de 1950 à 1965 : les photos les plus récentes, en gris pâle.');
  // Back to the most recent: one layer, no note, nothing to describe.
  await panel2.getByRole('combobox', { name: 'Date des photos' }).selectOption({ label: 'La plus récente' });
  await expect.poll(() => stored(page)).toBe('photo');
  await expect.poll(async () => (await tileLayers(again)).filter(l => l.cls.includes('gf-grey')).length).toBe(0);
  await expect(panel2.locator('#panel-base-when-note')).toHaveCount(0);
  await expect(panel2.getByRole('combobox', { name: 'Date des photos' })).not.toHaveAttribute('aria-describedby', /./);
});

test('Satellite (SPOT) : ses images de la dernière année, puis d’une année choisie au clavier ; le plan sans date ; sans défilement de côté', async ({ app, page }) => {
  await app.open(`#/layout/[map(r=1km)]?${AT}`);
  const map = page.locator('dl-map gf-map');
  const panel = await openPanel(map);
  const fond = panel.getByRole('group', { name: 'Fond de carte' });
  seen.length = 0;
  await fond.getByRole('button', { name: /Satellite \(SPOT\)/ }).click();
  await expect.poll(() => stored(page)).toBe('spot:2025');
  await expect(fond.getByRole('button', { name: /Satellite \(SPOT\)/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(fond.getByRole('button', { name: /Photos aériennes/ })).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(asked).toContain('ORTHOIMAGERY.ORTHO-SAT.SPOT.2025');
  // SPOT alone: nothing greyed under it, no note.
  expect((await tileLayers(map)).some(l => l.cls.includes('gf-grey'))).toBe(false);
  await expect(panel.getByText(/n’a pas photographié/)).toHaveCount(0);
  const year = panel.getByRole('combobox', { name: 'Année des images' });
  await expect(year).toHaveValue('spot:2025');
  // The keyboard: the list focused, the next year down (2024 after 2025).
  await year.focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => stored(page)).toBe('spot:2024');
  seen.length = 0;
  await year.selectOption({ label: '2020' });
  await expect.poll(() => baseOf(map)).toBe('spot:2020');
  await expect.poll(asked).toContain('ORTHOIMAGERY.ORTHO-SAT.SPOT.2020');
  expect(seen.some(u => /LAYER=ORTHOIMAGERY\.ORTHO-SAT\.SPOT\.2020&STYLE=normal&FORMAT=image%2Fjpeg/.test(u))).toBe(true);
  // A phone's width: the three kinds side by side, the list within the panel, nothing past its right edge.
  const options = panel.locator('gf-map-options');
  expect(await options.evaluate(o => o.scrollWidth <= o.clientWidth + 1)).toBe(true);
  const box = await options.boundingBox();
  for (const control of [fond.getByRole('button', { name: /Plan IGN/ }), fond.getByRole('button', { name: /Satellite \(SPOT\)/ }), year]) {
    const b = await control.boundingBox();
    expect(b && box && b.x + b.width <= box.x + box.width + 1).toBe(true);
  }
  // The plan: no date to choose.
  await fond.getByRole('button', { name: /Plan IGN/ }).click();
  await expect.poll(() => stored(page)).toBe('plan');
  await expect(panel.getByRole('combobox')).toHaveCount(0);
  // The photos again: the most recent (not the year chosen for SPOT).
  await fond.getByRole('button', { name: /Photos aériennes/ }).click();
  await expect.poll(() => stored(page)).toBe('photo');
});

test('une case de disposition : base=spot,annee=2020 la sienne, gardée de son panneau ▦ ; annee= seul, les photos ; base=satellite lu spot', async ({ app, page }) => {
  await app.open(`#/layout/[map(r=1km;base=satellite;annee=2020)]?${AT}`);
  const map = page.locator('dl-map gf-map');
  await expect.poll(() => baseOf(map)).toBe('spot:2020');
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,base=spot,annee=2020)]');
  await expect.poll(asked).toContain('ORTHOIMAGERY.ORTHO-SAT.SPOT.2020');
  expect(await stored(page)).toBe(null);
  // Its panel: its own background, its year; another year there is its own (its address), the common one untouched.
  const panel = await openPanel(map);
  await expect(panel.locator('.scope')).toContainText('Cette carte a son propre fond');
  await expect(panel.getByRole('group', { name: 'Fond de carte' }).getByRole('button', { name: /Satellite \(SPOT\)/ })).toHaveAttribute('aria-pressed', 'true');
  const year = panel.getByRole('combobox', { name: 'Année des images' });
  await expect(year).toHaveValue('spot:2020');
  await year.selectOption('spot:2018');
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,base=spot,annee=2018)]');
  await expect.poll(() => baseOf(map)).toBe('spot:2018');
  // SPOT's latest: SPOT without a year in the address.
  await year.selectOption('spot:2025');
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,base=spot)]');
  // A period of photos: base=photo, annee=2016-2020.
  await panel.getByRole('group', { name: 'Fond de carte' }).getByRole('button', { name: /Photos aériennes/ }).click();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,base=photo)]');
  await panel.getByRole('combobox', { name: 'Date des photos' }).selectOption('photo:2016-2020');
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,base=photo,annee=2016-2020)]');
  expect(await stored(page)).toBe(null);
  // « Revenir aux réglages communs »: base= and annee= gone.
  await panel.getByRole('button', { name: 'Revenir aux réglages communs' }).click();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km)]');
  await expect.poll(() => baseOf(map)).toBe('photo');
  await panel.getByRole('button', { name: 'Fermer' }).click();

  // annee= alone: the photos of that period; the thumbnail of the other background (the plan) writes base=plan, no year.
  seen.length = 0;
  await app.go(`#/layout/[map(r=1km;annee=2016-2020;ctl=couches+fond)]?${AT}`);
  const cell = page.locator('dl-map');
  await expect.poll(() => baseOf(cell.locator('gf-map'))).toBe('photo:2016-2020');
  await expect.poll(asked).toEqual(expect.arrayContaining(['ORTHOIMAGERY.ORTHOPHOTOS2016-2020', 'ORTHOIMAGERY.ORTHOPHOTOS']));
  const thumb = cell.locator('button.base');
  await expect(thumb).toHaveAttribute('aria-label', 'Fond : le plan IGN');
  await thumb.click();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,base=plan,ctl=couches+fond)]');
  await expect.poll(() => baseOf(cell.locator('gf-map'))).toBe('plan');
});

test('en 3D : les sources de MapLibre nomment la couche de l’année, les photos grises sans couleurs ; SPOT aussi', async ({ app, page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'software WebGL: one project');
  test.slow();
  await page.addInitScript(() => {
    localStorage.setItem('geoflora.maps3d', JSON.stringify({ relief: false, buildings: false, hillshade: false, sky: false, pitch: 0 }));
    localStorage.setItem('geoflora.mapLayer', JSON.stringify({ base: 'photo:2016-2020', overlays: [], distribution: false }));
  });
  await app.open(`#/layout/[map(r=1km;3d=1)]?${AT}`);
  const map = page.locator('dl-map gf-map');
  await expect(map).toHaveAttribute('data-renderer', '3d', SLOW);
  /** The background's layers in MapLibre: each one's key, saturation, and its source's tile address. */
  const glBase = () => map.evaluate(m => {
    const style = /** @type {any} */ (m).gl.glMap.getStyle();
    return style.layers.filter((/** @type {any} */ l) => /^(photo|spot|plan)/.test(l.metadata?.['gf:key'] ?? ''))
      .map((/** @type {any} */ l) => ({ key: l.metadata['gf:key'], saturation: l.paint?.['raster-saturation'] ?? 0, layer: new URL(style.sources[l.source].tiles[0]).searchParams.get('LAYER') }));
  });
  await expect.poll(glBase, SLOW).toEqual([
    { key: 'photo:2016-2020', saturation: -1, layer: 'ORTHOIMAGERY.ORTHOPHOTOS' },
    { key: 'photo:2016-2020', saturation: 0, layer: 'ORTHOIMAGERY.ORTHOPHOTOS2016-2020' }
  ]);
  // MapLibre asks those tiles itself.
  await expect.poll(asked, SLOW).toContain('ORTHOIMAGERY.ORTHOPHOTOS2016-2020');
  // SPOT chosen in its panel: one source, its layer.
  const panel = await openPanel(map);
  await panel.getByRole('group', { name: 'Fond de carte' }).getByRole('button', { name: /Satellite \(SPOT\)/ }).click();
  await panel.getByRole('combobox', { name: 'Année des images' }).selectOption('spot:2020');
  await expect.poll(glBase, SLOW).toEqual([{ key: 'spot:2020', saturation: 0, layer: 'ORTHOIMAGERY.ORTHO-SAT.SPOT.2020' }]);
  await expect.poll(asked, SLOW).toContain('ORTHOIMAGERY.ORTHO-SAT.SPOT.2020');
});

test('Réglages › Cartes : les mêmes choix de fond, que la Carte suit', async ({ app, page }) => {
  await app.open('#/settings');
  const options = page.locator('gf-settings gf-map-options[scope="defaults"]');
  await expect(options.getByRole('group', { name: 'Fond de carte' })).toBeVisible();
  await options.getByRole('combobox', { name: 'Date des photos' }).selectOption({ label: '2020' });
  await expect.poll(() => stored(page)).toBe('photo:2020');
  const note = 'Là où l’IGN n’a pas photographié en 2020 : les photos les plus récentes, en gris pâle. De très loin aussi : celles de 2020 apparaissent en s’approchant.';
  await expect(options.getByText(note)).toBeVisible();
  // No map panel here: said by its own polite region.
  await expect(options.locator('[aria-live="polite"]')).toContainText(note);
  await app.go('#/map');
  await expect.poll(() => baseOf(page.locator('gf-map-page gf-map'))).toBe('photo:2020');
});

test('une case : son année puis sa 3D (annee=2020;3d=1), l’adresse relue entière au rechargement', async ({ app, page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'software WebGL: one project');
  test.slow();
  await page.addInitScript(() => {
    localStorage.setItem('geoflora.maps3d', JSON.stringify({ relief: false, buildings: false, hillshade: false, sky: false, pitch: 0 }));
  });
  await app.open(`#/layout/[map(r=1km;base=spot;annee=2020;ctl=3d)]?${AT}`);
  const map = page.locator('dl-map gf-map');
  await expect.poll(() => baseOf(map)).toBe('spot:2020');
  // The cell's own « Vue 3D »: written after its year, never read as « 2020,3d ».
  await page.locator('dl-map').getByRole('button', { name: 'Vue 3D' }).click();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,base=spot,annee=2020;3d=1,ctl=3d)]');
  await expect(map).toHaveAttribute('data-renderer', '3d', SLOW);
  await page.reload();
  await app.ready();
  const again = page.locator('dl-map gf-map');
  await expect.poll(() => baseOf(again)).toBe('spot:2020');
  await expect(again).toHaveAttribute('data-renderer', '3d', SLOW);
  expect(await layoutOf(page)).toBe('[map(r=1km,base=spot,annee=2020;3d=1,ctl=3d)]');
  // A later change of the cell still written (the layout read whole).
  await page.locator('dl-map').getByRole('button', { name: 'Vue 3D' }).click();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,base=spot,annee=2020;3d=0,ctl=3d)]');
});

test('la vignette de l’autre fond, le fond commun étant SPOT : le plan, puis SPOT de nouveau, rien d’écrit', async ({ app, page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('geoflora.mapLayer', JSON.stringify({ base: 'spot:2025', overlays: [], distribution: false }));
  });
  await app.open(`#/layout/[map(r=1km;ctl=fond)]?${AT}`);
  const cell = page.locator('dl-map');
  await expect.poll(() => baseOf(cell.locator('gf-map'))).toBe('spot:2025');
  const thumb = cell.locator('button.base');
  await expect(thumb).toHaveAttribute('aria-label', 'Fond : le plan IGN');
  await thumb.click();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,base=plan,ctl=fond)]');
  await expect.poll(() => baseOf(cell.locator('gf-map'))).toBe('plan');
  // Its own plan: the thumbnail offers the common background back (SPOT), and lets go.
  await expect(thumb).toHaveAttribute('aria-label', 'Fond : les images satellite (SPOT)');
  await expect(thumb).toHaveText('SPOT');
  await thumb.click();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,ctl=fond)]');
  await expect.poll(() => baseOf(cell.locator('gf-map'))).toBe('spot:2025');
  await expect(thumb).toHaveAttribute('aria-label', 'Fond : le plan IGN');
  expect(await stored(page)).toBe('spot:2025');
});

test('« Créer une app » : la date du fond, les seules années de son fond, la plus récente d’abord ; puis la 2D écrite après elle', async ({ app, page, isMobile }) => {
  test.skip(isMobile, 'the picker docked: a wide screen');
  await app.open(`#/builder?g=${encodeURIComponent('[map(r=1km,base=spot)]')}&${AT}`);
  await page.locator('gf-builder gf-layout section.cell[data-cell="0"] .cell-head .pick').click();
  const p = page.locator('gf-block-picker:not([inline])');
  await p.locator('.row[data-group="Fond"]').click();
  const date = p.locator('[data-param="annee"] select');
  await expect(date.locator('option')).toHaveText(['Par défaut', '2025', '2024', '2023', '2022', '2021', '2020', '2019', '2018', '2017', '2016', '2015', '2014', '2013']);
  const grid = () => page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] || '').get('g'));
  await date.selectOption('2016');
  await expect.poll(grid).toBe('[map(r=1km,base=spot,annee=2016)]');
  await expect.poll(() => page.locator('gf-builder dl-map gf-map').evaluate(m => /** @type {any} */ (m).lookShown.base)).toBe('spot:2016');
  // The photos: their years, periods, historical ones (the most recent first); SPOT's 2025 no more.
  await p.locator('[data-param="base"] button[data-value="photo"]').click();
  await expect.poll(grid).toBe('[map(r=1km,base=photo,annee=2016)]');
  const values = await date.locator('option').evaluateAll(os => os.map(o => /** @type {HTMLOptionElement} */ (o).value));
  expect(values.slice(0, 3)).toEqual(['', '2024', '2023']);
  expect(values.slice(-3)).toEqual(['1980-1995', '1965-1980', '1950-1965']);
  expect(values).not.toContain('2025');
  // The 2D written after the year: « ; » between them, the layout read whole.
  await p.locator('[data-param="3d"] button[data-value="false"]').click();
  await expect.poll(grid).toBe('[map(r=1km,base=photo,annee=2016;3d=0)]');
  await expect(p.locator('[data-param="annee"] select')).toHaveValue('2016');
});
