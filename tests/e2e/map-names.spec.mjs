// « Les noms par-dessus » : over the aerial photos and SPOT's satellite images, the roads, the rivers and the places'
// names (the usual « Noms et réseaux », core/map-layers.js LANDMARKS: three WMTS layers of the IGN, PNG, each its own
// layer) — over the background and every overlay, never one of them; on by default, unticked in the panel ▦ of a map or in Réglages › Cartes (« Afficher les
// noms : villes, routes, rivières, forêts », gf-map-options.js), kept as the maps' common look (geoflora.mapLayer: names
// only when off) and found again after a reload. Not on the plan, which has its own: no checkbox there, nothing asked.
// In 3D, MapLibre's style has the three sources on top of the IGN's, once each, whatever was toggled. A free layout's
// cell says its own (noms=0, noms=1: its panel ▦ writes it, « Revenir aux réglages communs » takes it back; kept on the
// plan), the editor offers it (« Noms sur le fond »), written before the 3D with « ; » (annee=2016,noms=0;3d=0). Every
// tile made here (tiles.mjs: see-through but for their lines), real WebGL for 3D.
import { test, expect, answerAround, plantId } from './fixtures.mjs';
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
/** The names' layers, bottom first (the names on top): their keys (core/map-layers.js LANDMARK_DEFAULTS), their WMTS layers. */
const KEYS = ['routes', 'eau', 'lieux'];
const NAMES = ['TRANSPORTNETWORKS.ROADS', 'HYDROGRAPHY.HYDROGRAPHY', 'GEOGRAPHICALNAMES.NAMES'];
/** Each one drawn: its key, its WMTS layer. */
const MARKS = KEYS.map((k, i) => [k, NAMES[i]]);
const CHECKBOX = 'Afficher les noms : villes, routes, rivières, forêts';

/** The WMTS layers asked so far, once each. */
const asked = () => [...new Set(seen.filter(u => u.includes('REQUEST=GetTile')).map(u => new URL(u).searchParams.get('LAYER')))];
/** The names' layers asked so far. */
const namesAsked = () => asked().filter(l => NAMES.includes(/** @type {string} */ (l)));
/** The layout of the address, decoded. @param {Page} page */
const layoutOf = page => page.evaluate(() => decodeURIComponent(location.hash.split('?')[0].replace(/^#\/layout\//, '')));
/** What a map shows of its look (its own over the common one). @param {Locator} map */
const lookOf = map => map.evaluate(m => { const l = /** @type {any} */ (m).lookShown; return { base: l.base, landmarks: l.landmarks }; });
/** The common look as kept (the key of before). @param {Page} page */
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.mapLayer') || 'null'));
/** A map's tile layers in 2D, bottom of the DOM first: each one's key (its gf-tiles- class) and z-index. @param {Locator} map */
const tileLayers = map => map.evaluate(m => [...m.querySelectorAll('.leaflet-tile-pane > .leaflet-layer')]
  .map(e => ({ key: /gf-tiles-(\S+)/.exec(e.className)?.[1] ?? '', z: Number(getComputedStyle(e).zIndex) })));
/** The names' layers drawn in 2D: their z-index, and the LAYER of the tiles each one shows. @param {Locator} map */
const names2d = map => map.evaluate(m => [...m.querySelectorAll('.leaflet-tile-pane > .leaflet-layer.gf-capped')]
  .map(e => ({ z: Number(getComputedStyle(e).zIndex), layer: new URL(/** @type {HTMLImageElement} */ (e.querySelector('img.leaflet-tile'))?.src || 'https://x/').searchParams.get('LAYER') })));
/** The tiles of the names drawn in 2D now. @param {Locator} map */
const namesTiles = map => map.evaluate(m => m.querySelectorAll('.leaflet-tile-pane > .leaflet-layer.gf-capped img.leaflet-tile').length);
/** Whether the photos were asked at this zoom. @param {number} z */
const photoAt = z => seen.some(u => u.includes('LAYER=ORTHOIMAGERY.ORTHOPHOTOS&') && new URL(u).searchParams.get('TILEMATRIX') === String(z));
/**
 * A map's tile layers in 2D, bottom first: each one's key, z-index, opacity and the LAYER of the tiles it shows.
 * @param {Locator} map
 */
const drawn = map => map.evaluate(m => [...m.querySelectorAll('.leaflet-tile-pane > .leaflet-layer')].map(e => ({
  key: /gf-tiles-(\S+)/.exec(e.className)?.[1] ?? '', z: Number(getComputedStyle(e).zIndex), opacity: Number(getComputedStyle(e).opacity),
  layer: new URL(/** @type {HTMLImageElement} */ (e.querySelector('img.leaflet-tile'))?.src || 'https://x/').searchParams.get('LAYER')
})).sort((a, b) => a.z - b.z));

/**
 * A map's panel ▦ closed, and its step in history gone: closing a dialog goes back a step after a timer (core/history.js
 * openModal), which would undo an address set meanwhile. @param {Page} page @param {Locator} panel
 */
async function closePanel(page, panel) {
  await panel.getByRole('button', { name: 'Fermer' }).click();
  await expect.poll(() => page.evaluate(() => history.state?.gfModal ?? null)).toBe(null);
}

/** A map's panel ▦, open. @param {Locator} map */
async function openPanel(map) {
  await map.evaluate(m => /** @type {any} */ (m).openPanel());
  const panel = map.locator('gf-map-panel dialog');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Fond' })).toBeVisible();
  return panel;
}

test('sur les photos : les trois couches demandées (PNG, du zoom 6 au 19), dessinées au-dessus d’une surcouche ; décochées, plus demandées, gardé au rechargement', async ({ app, page }) => {
  await app.open(`#/layout/[map(r=1km)]?${AT}`);
  const map = page.locator('dl-map gf-map');
  await expect.poll(() => lookOf(map)).toEqual({ base: 'photo', landmarks: KEYS });
  // Each asked by its identifier, its style, as PNG.
  await expect.poll(namesAsked).toEqual(expect.arrayContaining(NAMES));
  for (const id of NAMES) expect(seen.some(u => u.includes(`LAYER=${id}&STYLE=normal&FORMAT=image%2Fpng`)), id).toBe(true);
  await expect.poll(() => namesTiles(map)).toBeGreaterThan(0);
  // From their first native zoom (6) to one past their last (19), not further: at 5 (France whole on a phone) and at
  // 20 (a plant's), none drawn — their words neither shrunk nor blown up four times —, the photos still.
  for (const [zoom, z] of [[5, 5], [20, 19]]) {
    await map.evaluate((m, zoom) => /** @type {any} */ (m).flyTo([2.35, 48.85], zoom), zoom);
    await expect.poll(() => photoAt(z)).toBe(true);
    await expect.poll(() => namesTiles(map)).toBe(0);
  }
  await map.evaluate(m => /** @type {any} */ (m).flyTo([2.35, 48.85], 15));
  await expect.poll(() => namesTiles(map)).toBeGreaterThan(0);
  // Nothing written by merely showing them.
  expect(await stored(page)).toBe(null);

  // The checkbox in « Fond », ticked; an overlay ticked: the names still over it, one above the other.
  const panel = await openPanel(map);
  const box = panel.getByRole('checkbox', { name: CHECKBOX });
  await expect(box).toBeChecked();
  await panel.getByRole('checkbox', { name: /Courbes de niveau/ }).check();
  await expect.poll(async () => (await tileLayers(map)).map(l => l.key)).toEqual(expect.arrayContaining(['photo', 'contours', ...KEYS]));
  const layers = await tileLayers(map);
  const contours = /** @type {any} */ (layers.find(l => l.key === 'contours')).z;
  const photo = /** @type {any} */ (layers.find(l => l.key === 'photo')).z;
  await expect.poll(async () => (await names2d(map)).map(n => n.layer)).toEqual(NAMES);
  const named = await names2d(map);
  expect(named.every(n => n.z > contours && contours > photo)).toBe(true);
  expect(named.map(n => n.z)).toEqual([...named.map(n => n.z)].sort((a, b) => a - b));
  // Not an overlay: not among the layers shown (nor counted), nor in the opacity sliders.
  await expect(panel.getByRole('slider', { name: /^Opacité de / })).toHaveCount(1);

  // Unticked: the common look's (every map's), kept only when off; their layers gone, never asked again.
  await box.uncheck();
  await expect.poll(() => stored(page)).toEqual({ base: 'photo', overlays: ['contours'], distribution: false, names: false });
  await expect.poll(async () => (await tileLayers(map)).filter(l => KEYS.includes(l.key)).length).toBe(0);
  seen.length = 0;
  await map.evaluate(m => /** @type {any} */ (m).flyTo([2.37, 48.86], 15));
  await expect.poll(() => asked().includes('ORTHOIMAGERY.ORTHOPHOTOS')).toBe(true);
  expect(namesAsked()).toEqual([]);

  // Reloaded: still off, the checkbox unticked, none asked.
  seen.length = 0;
  await page.reload();
  await app.ready();
  const again = page.locator('dl-map gf-map');
  await expect.poll(() => lookOf(again)).toEqual({ base: 'photo', landmarks: [] });
  await expect.poll(() => asked().includes('ORTHOIMAGERY.ORTHOPHOTOS')).toBe(true);
  expect(namesAsked()).toEqual([]);
  const panel2 = await openPanel(again);
  await expect(panel2.getByRole('checkbox', { name: CHECKBOX })).not.toBeChecked();
  // Ticked again: drawn, asked; the key of before as before (no names in it).
  await panel2.getByRole('checkbox', { name: CHECKBOX }).check();
  await expect.poll(namesAsked).toEqual(expect.arrayContaining(NAMES));
  await expect.poll(() => stored(page)).toEqual({ base: 'photo', overlays: ['contours'], distribution: false });
});

test('le plan : pas de case, rien de demandé (ses noms sont les siens) ; SPOT : les noms ; Réglages › Cartes, la même case', async ({ app, page }) => {
  await app.open(`#/layout/[map(r=1km)]?${AT}`);
  const map = page.locator('dl-map gf-map');
  const panel = await openPanel(map);
  const fond = panel.getByRole('group', { name: 'Fond de carte' });
  await fond.getByRole('button', { name: /Plan IGN/ }).click();
  await expect.poll(() => stored(page).then(s => s?.base)).toBe('plan');
  await expect(panel.getByRole('checkbox', { name: CHECKBOX })).toHaveCount(0);
  await expect.poll(async () => (await tileLayers(map)).map(l => l.key)).toEqual(['plan']);
  seen.length = 0;
  await map.evaluate(m => /** @type {any} */ (m).flyTo([2.37, 48.86], 15));
  await expect.poll(() => asked().includes('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2')).toBe(true);
  expect(namesAsked()).toEqual([]);

  // SPOT: the names over its images, the checkbox back.
  seen.length = 0;
  await fond.getByRole('button', { name: /Satellite \(SPOT\)/ }).click();
  await expect(panel.getByRole('checkbox', { name: CHECKBOX })).toBeChecked();
  await expect.poll(namesAsked).toEqual(expect.arrayContaining(NAMES));
  expect(asked()).toContain('ORTHOIMAGERY.ORTHO-SAT.SPOT.2025');
  await expect.poll(async () => (await names2d(map)).length).toBe(3);
  const spot = /** @type {any} */ ((await tileLayers(map)).find(l => l.key.startsWith('spot:')));
  expect((await names2d(map)).every(n => n.z > spot.z)).toBe(true);
  // A background chosen under the names alone, an overlay ticked next: the overlay over the background, the names over both.
  await fond.getByRole('button', { name: /Photos aériennes/ }).click();
  await panel.getByRole('checkbox', { name: /Courbes de niveau/ }).check();
  await expect.poll(async () => {
    const layers = await tileLayers(map), named = await names2d(map);
    const z = (/** @type {string} */ key) => layers.find(l => l.key === key)?.z ?? NaN;
    return named.length === 3 && z('photo') < z('contours') && named.every(n => n.z > z('contours'));
  }).toBe(true);
  await panel.getByRole('checkbox', { name: /Courbes de niveau/ }).uncheck();
  await fond.getByRole('button', { name: /Satellite \(SPOT\)/ }).click();
  // Unticked on SPOT, the plan chosen, then the photos: still unticked (one choice for both).
  await panel.getByRole('checkbox', { name: CHECKBOX }).uncheck();
  await fond.getByRole('button', { name: /Plan IGN/ }).click();
  await fond.getByRole('button', { name: /Photos aériennes/ }).click();
  await expect(panel.getByRole('checkbox', { name: CHECKBOX })).not.toBeChecked();
  await expect.poll(() => stored(page)).toEqual({ base: 'photo', overlays: [], distribution: false, names: false });

  // Réglages › Cartes: the same checkbox, ticked there, the Carte follows; the names and noms= in its words.
  await app.go('#/settings');
  await expect(page.locator('gf-settings .maps-card')).toContainText('sur les photos et SPOT, les noms par-dessus');
  await expect(page.locator('gf-settings .maps-card')).toContainText('ses noms (noms=)');
  const options = page.locator('gf-settings gf-map-options[scope="defaults"]');
  await expect(options.getByRole('checkbox', { name: CHECKBOX })).not.toBeChecked();
  await options.getByRole('checkbox', { name: CHECKBOX }).check();
  await expect.poll(() => stored(page)).toEqual({ base: 'photo', overlays: [], distribution: false });
  await options.getByRole('group', { name: 'Fond de carte' }).getByRole('button', { name: /Plan IGN/ }).click();
  await expect(options.getByRole('checkbox', { name: CHECKBOX })).toHaveCount(0);
  await options.getByRole('group', { name: 'Fond de carte' }).getByRole('button', { name: /Photos aériennes/ }).click();
  await app.go('#/map');
  await expect.poll(() => lookOf(page.locator('gf-map-page gf-map'))).toEqual({ base: 'photo', landmarks: KEYS });
});

test('en 3D : les trois sources de MapLibre au-dessus des autres couches de l’IGN, une fois chacune, dans leur ordre — décochées puis cochées, le plan puis les photos', async ({ app, page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'software WebGL: one project');
  test.slow();
  await page.addInitScript(() => {
    localStorage.setItem('geoflora.maps3d', JSON.stringify({ relief: false, buildings: false, hillshade: false, sky: false, pitch: 0 }));
    localStorage.setItem('geoflora.mapLayer', JSON.stringify({ base: 'photo', overlays: ['contours'], distribution: false }));
  });
  await app.open(`#/layout/[map(r=1km;3d=1)]?${AT}`);
  const map = page.locator('dl-map gf-map');
  await expect(map).toHaveAttribute('data-renderer', '3d', SLOW);
  /** MapLibre's raster layers, bottom first: each one's key and its source's LAYER. */
  const rasters = () => map.evaluate(m => {
    const style = /** @type {any} */ (m).gl.glMap.getStyle();
    return style.layers.filter((/** @type {any} */ l) => l.type === 'raster')
      .map((/** @type {any} */ l) => [l.metadata?.['gf:key'], new URL(style.sources[l.source].tiles[0].replace(/^gfcache:\/\//, '')).searchParams.get('LAYER')]);
  });
  const WITH = [['photo', 'ORTHOIMAGERY.ORTHOPHOTOS'], ['contours', 'ELEVATION.CONTOUR.LINE'], ...MARKS];
  const WITHOUT = WITH.slice(0, 2);
  await expect.poll(rasters, SLOW).toEqual(WITH);
  // MapLibre asks them itself.
  seen.length = 0;
  await map.evaluate(m => /** @type {any} */ (m).flyTo([2.37, 48.86], 15));
  await expect.poll(namesAsked, SLOW).toEqual(expect.arrayContaining(NAMES));
  const panel = await openPanel(map);
  const box = panel.getByRole('checkbox', { name: CHECKBOX });
  // Unticked: none asked any more — by MapLibre, nor by the 2D map hidden under it (its layers taken off, never drawn
  // again for nothing).
  await expect.poll(() => map.evaluate(m => /** @type {any} */ (m).gl.glMap.areTilesLoaded()), SLOW).toBe(true);
  seen.length = 0;
  await box.uncheck();
  await expect.poll(rasters, SLOW).toEqual(WITHOUT);
  await map.evaluate(m => /** @type {any} */ (m).flyTo([2.30, 48.87], 15));
  await expect.poll(() => asked().includes('ORTHOIMAGERY.ORTHOPHOTOS'), SLOW).toBe(true);
  expect(namesAsked()).toEqual([]);
  await box.check();
  await expect.poll(rasters, SLOW).toEqual(WITH);
  for (let i = 0; i < 2; i++) {
    await box.uncheck();
    await expect.poll(rasters, SLOW).toEqual(WITHOUT);
    await box.check();
    await expect.poll(rasters, SLOW).toEqual(WITH);
  }
  // An overlay added on top of the others: under the names still.
  await panel.getByRole('checkbox', { name: /Parcelles cadastrales/ }).check();
  await expect.poll(rasters, SLOW).toEqual([...WITHOUT, ['cadastre', 'CADASTRALPARCELS.PARCELLAIRE_EXPRESS'], ...MARKS]);
  await panel.getByRole('checkbox', { name: /Parcelles cadastrales/ }).uncheck();
  // The plan (its names its own), then the photos: the three back, once each.
  const fond = panel.getByRole('group', { name: 'Fond de carte' });
  await fond.getByRole('button', { name: /Plan IGN/ }).click();
  await expect.poll(rasters, SLOW).toEqual([['plan', 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2'], ['contours', 'ELEVATION.CONTOUR.LINE']]);
  await fond.getByRole('button', { name: /Photos aériennes/ }).click();
  await expect.poll(rasters, SLOW).toEqual(WITH);
  await closePanel(page, panel);

  // A cell showing the rivers itself (layers=hydro, the same WMTS layer): one source of them, where its layers are.
  await app.go(`#/layout/[map(r=1km;3d=1;layers=hydro)]?${AT}`);
  const hydro = page.locator('dl-map gf-map');
  await expect(hydro).toHaveAttribute('data-renderer', '3d', SLOW);
  const rastersOf = () => hydro.evaluate(m => {
    const style = /** @type {any} */ (m).gl.glMap.getStyle();
    return style.layers.filter((/** @type {any} */ l) => l.type === 'raster')
      .map((/** @type {any} */ l) => [l.metadata?.['gf:key'], new URL(style.sources[l.source].tiles[0].replace(/^gfcache:\/\//, '')).searchParams.get('LAYER')]);
  });
  await expect.poll(rastersOf, SLOW).toEqual([['photo', 'ORTHOIMAGERY.ORTHOPHOTOS'], ['ign:HYDROGRAPHY.HYDROGRAPHY', 'HYDROGRAPHY.HYDROGRAPHY'],
    ['routes', 'TRANSPORTNETWORKS.ROADS'], ['lieux', 'GEOGRAPHICALNAMES.NAMES']]);
});

test('une couche qui est l’une des trois (« Cours d’eau », layers=hydro) : dessinée une fois, à sa place et à son opacité ; masquée, les noms la redessinent par-dessus', async ({ app, page }) => {
  await app.open(`#/layout/[map(r=1km;layers=hydro+forets;opac=hydro.30)]?${AT}`);
  const map = page.locator('dl-map gf-map');
  const HYDRO = 'ign:HYDROGRAPHY.HYDROGRAPHY';
  // The rivers once: the overlay's, under the public forests as written, at its opacity; the names' layers without them.
  await expect.poll(async () => (await drawn(map)).filter(l => l.layer).map(l => [l.key, l.layer])).toEqual([
    ['photo', 'ORTHOIMAGERY.ORTHOPHOTOS'], [HYDRO, 'HYDROGRAPHY.HYDROGRAPHY'], ['forets', 'FORETS.PUBLIQUES'],
    ['routes', 'TRANSPORTNETWORKS.ROADS'], ['lieux', 'GEOGRAPHICALNAMES.NAMES']]);
  expect((await drawn(map)).filter(l => l.key === HYDRO).map(l => l.opacity)).toEqual([0.3]);
  // Its opacity changed: seen (nothing opaque over it).
  const panel = await openPanel(map);
  await panel.getByRole('slider', { name: /^Opacité de Hydrographie/ }).fill('60');
  await expect.poll(async () => (await drawn(map)).filter(l => l.key === HYDRO).map(l => l.opacity)).toEqual([0.6]);
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,layers=hydro+forets,opac=hydro.60)]');
  // Hidden: the names draw the rivers again, over the forests, once.
  await panel.getByRole('button', { name: /^Masquer Hydrographie/ }).click();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,layers=forets)]');
  await expect.poll(async () => (await drawn(map)).filter(l => l.layer).map(l => [l.key, l.layer])).toEqual([
    ['photo', 'ORTHOIMAGERY.ORTHOPHOTOS'], ['forets', 'FORETS.PUBLIQUES'], ...MARKS]);
  // The names unticked, the rivers ticked again: the overlay alone.
  await panel.getByRole('checkbox', { name: CHECKBOX }).uncheck();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,noms=0,layers=forets)]');
  await expect.poll(async () => (await drawn(map)).filter(l => KEYS.includes(l.key)).length).toBe(0);
});

test('une case de disposition : noms=0 les cache, son panneau ▦ les montre (noms=1) ; « Revenir aux réglages communs » retire noms= ; gardé sur le plan de sa vignette', async ({ app, page }) => {
  await app.open(`#/layout/[map(r=1km;noms=0)]?${AT}`);
  const map = page.locator('dl-map gf-map');
  await expect.poll(() => lookOf(map)).toEqual({ base: 'photo', landmarks: [] });
  await expect.poll(() => asked().includes('ORTHOIMAGERY.ORTHOPHOTOS')).toBe(true);
  expect(namesAsked()).toEqual([]);
  // Its panel: its own choice, said; ticked there, written in its address — the common look untouched.
  const panel = await openPanel(map);
  await expect(panel.locator('.scope')).toContainText('Cette carte a son propre choix des noms');
  const box = panel.getByRole('checkbox', { name: CHECKBOX });
  await expect(box).not.toBeChecked();
  await box.check();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,noms=1)]');
  await expect.poll(namesAsked).toEqual(expect.arrayContaining(NAMES));
  expect(await stored(page)).toBe(null);
  // « Revenir aux réglages communs »: noms= gone, the common choice (on) followed.
  await panel.getByRole('button', { name: 'Revenir aux réglages communs' }).click();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km)]');
  await expect.poll(() => lookOf(map)).toEqual({ base: 'photo', landmarks: KEYS });
  await closePanel(page, panel);

  // Its own background (SPOT of a year): unticked in its panel, noms=0 beside base= and annee= (« , » between them).
  await app.go(`#/layout/[map(r=1km;base=spot;annee=2020;ctl=fond)]?${AT}`);
  const cell = page.locator('dl-map');
  await expect.poll(() => lookOf(cell.locator('gf-map'))).toEqual({ base: 'spot:2020', landmarks: KEYS });
  const panel2 = await openPanel(cell.locator('gf-map'));
  await expect(panel2.locator('.scope')).toContainText('Cette carte a son propre fond');
  await panel2.getByRole('checkbox', { name: CHECKBOX }).uncheck();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,base=spot,annee=2020,noms=0,ctl=fond)]');
  await expect.poll(() => lookOf(cell.locator('gf-map'))).toEqual({ base: 'spot:2020', landmarks: [] });
  await closePanel(page, panel2);
  seen.length = 0;
  // Its thumbnail: first the common background (the photos: base= and annee= let go), noms= kept; then the plan, noms=
  // kept (of no effect there: nothing asked), found again on the photos.
  await cell.locator('button.base').click();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,noms=0,ctl=fond)]');
  await expect.poll(() => lookOf(cell.locator('gf-map'))).toEqual({ base: 'photo', landmarks: [] });
  await cell.locator('button.base').click();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,base=plan,noms=0,ctl=fond)]');
  await expect.poll(async () => (await tileLayers(cell.locator('gf-map'))).map(l => l.key)).toEqual(['plan']);
  await cell.locator('button.base').click();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,noms=0,ctl=fond)]');
  await expect.poll(() => lookOf(cell.locator('gf-map'))).toEqual({ base: 'photo', landmarks: [] });
  await expect.poll(() => asked().includes('ORTHOIMAGERY.ORTHOPHOTOS')).toBe(true);
  expect(namesAsked()).toEqual([]);

  // On the common plan: its own names said of no effect there, the way back offered still (noms= kept for the photos).
  await page.evaluate(async () => { (await import('/app/core/map-settings.js')).setMapLook({ base: 'plan' }); });
  await app.go(`#/layout/[map(r=1km;noms=0)]?${AT}`);
  const onPlan = page.locator('dl-map gf-map');
  await expect.poll(() => lookOf(onPlan)).toEqual({ base: 'plan', landmarks: [] });
  const panel3 = await openPanel(onPlan);
  await expect(panel3.locator('.scope')).toContainText('Cette carte a son propre choix des noms, sans effet sur le plan IGN');
  await expect(panel3.getByRole('checkbox', { name: CHECKBOX })).toHaveCount(0);
  await expect(panel3.getByRole('button', { name: 'Revenir aux réglages communs' })).toBeVisible();
});

test('fiche plante : un bloc Carte qui n’a que ses noms à lui le dit, dans son ⚙ comme dans son panneau ▦', async ({ app, page }) => {
  test.slow();
  await app.open('#/');
  await page.evaluate(async () => { (await import('/app/core/sheet-blocks.js')).setMapConfig('map', { look: { names: false } }); });
  await app.go(`#/plant/${plantId('Urtica dioica')}`);
  const map = page.locator('gf-sheet-map gf-map').first();
  await map.scrollIntoViewIfNeeded();
  await expect.poll(() => lookOf(map), { timeout: 20_000 }).toEqual({ base: 'photo', landmarks: [] });
  await page.evaluate(async () => { (await import('/app/core/store.js')).setKingMode(true); });
  await page.getByRole('button', { name: 'Configurer la carte « Carte »' }).click();
  const form = page.locator('gf-plant-detail .map-form').first();
  await expect(form).toContainText('dans le panneau ▦ de la carte (cette carte a son propre choix des noms ; le panneau propose de revenir aux réglages communs)');
  const panel = await openPanel(map);
  await expect(panel.locator('.scope')).toContainText('Cette carte a son propre choix des noms');
});

test('« Créer une app » : « Noms sur le fond » dans Fond, Non écrit noms=0 avant la 3D (« ; » entre deux chiffres), Par défaut le retire', async ({ app, page, isMobile }) => {
  test.skip(isMobile, 'the picker docked: a wide screen');
  await app.open(`#/builder?g=${encodeURIComponent('[map(r=1km,base=photo,annee=2016;3d=0)]')}&${AT}`);
  await page.locator('gf-builder gf-layout section.cell[data-cell="0"] .cell-head .pick').click();
  const p = page.locator('gf-block-picker:not([inline])');
  await p.locator('.row[data-group="Fond"]').click();
  const noms = p.locator('[data-param="noms"]');
  await expect(noms).toContainText('Noms sur le fond');
  await expect(noms).toContainText('par défaut : selon les réglages communs (sur les photos et SPOT)');
  await expect(noms.locator('button')).toHaveText(['Par défaut', 'Oui', 'Non']);
  const grid = () => page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] || '').get('g'));
  await noms.locator('button[data-value="false"]').click();
  await expect.poll(grid).toBe('[map(r=1km,base=photo,annee=2016,noms=0;3d=0)]');
  await expect(noms.locator('button[data-value="false"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => lookOf(page.locator('gf-builder dl-map gf-map'))).toEqual({ base: 'photo:2016', landmarks: [] });
  await noms.locator('button[data-value="null"]').click();
  await expect.poll(grid).toBe('[map(r=1km,base=photo,annee=2016;3d=0)]');
  await expect.poll(() => lookOf(page.locator('gf-builder dl-map gf-map'))).toEqual({ base: 'photo:2016', landmarks: KEYS });
});
