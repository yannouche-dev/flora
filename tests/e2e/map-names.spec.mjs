// « Noms et réseaux » : over the aerial photos and SPOT's satellite images, six layers of the IGN, each its own
// (core/map-layers.js LANDMARKS: PNG, see-through but for their lines and words) — the places' names, the roads, the
// rivers (on by default: the picture of before), the railways, the buildings, the administrative boundaries —, one above
// the other in that order upside down (the boundaries lowest, the places' names on top), all over the background and
// every overlay, never one of them. Chosen in the panel ▦ of a map or in Réglages › Cartes (« Noms et réseaux », a
// checkbox each, gf-map-options.js; « Masquer » in « Couches affichées », gf-layer-stack.js), kept as the maps' common
// look (geoflora.mapLayer: nothing for the usual three, names: false for none, else landmarks: […]) and found again
// after a reload. Not on the plan, which has its own: a map's checkboxes disabled there, the choice kept, nothing asked
// (in Réglages, on the common plan, still chosen: the maps with their own photos or SPOT follow them). In
// 3D, MapLibre's style has them on top of the IGN's, once each, whatever was toggled. A layer that is one of them
// (layers=hydro) is drawn once, as that overlay. A free layout's cell says its own (noms=0, noms=1, a list —
// noms=lieux+rail: those alone —: its panel ▦ writes it, « Revenir aux réglages communs » takes it back; kept on the
// plan), the editor offers it (« Noms et réseaux »: a chip each), written before the 3D with « ; » after a digit
// (annee=2016,noms=0;3d=0). Every tile made here (tiles.mjs: see-through but for their lines), real WebGL for 3D.
import { test, expect, answerAround, plantId } from './fixtures.mjs';
import { answerTiles } from './tiles.mjs';
import { layoutOf, screen } from './app.mjs';

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
/** The usual ones, bottom first (the places' names on top): their keys (core/map-layers.js LANDMARK_DEFAULTS), their WMTS layers. */
const KEYS = ['routes', 'eau', 'lieux'];
const NAMES = ['TRANSPORTNETWORKS.ROADS', 'HYDROGRAPHY.HYDROGRAPHY', 'GEOGRAPHICALNAMES.NAMES'];
/** All six, bottom first (core/map-layers.js LANDMARKS): their keys, their WMTS layers. */
const ALL_KEYS = ['limites', 'bati', 'rail', ...KEYS];
const ALL = ['LIMITES_ADMINISTRATIVES_EXPRESS.LATEST', 'BUILDINGS.BUILDINGS', 'TRANSPORTNETWORKS.RAILWAYS', ...NAMES];
/** The usual ones drawn: each its key, its WMTS layer. */
const MARKS = KEYS.map((k, i) => [k, NAMES[i]]);
/** Their checkboxes' names, in the panel's order (the usual three first). @type {Record<string, string>} */
const LABELS = { lieux: 'Noms de lieux', routes: 'Routes', eau: 'Cours d’eau', rail: 'Voies ferrées', bati: 'Bâtiments', limites: 'Limites administratives' };

/** The WMTS layers asked so far, once each. */
const asked = () => [...new Set(seen.filter(u => u.includes('REQUEST=GetTile')).map(u => new URL(u).searchParams.get('LAYER')))];
/** The layers of « Noms et réseaux » asked so far. */
const namesAsked = () => asked().filter(l => ALL.includes(/** @type {string} */ (l)));
/** One of « Noms et réseaux » in a panel ▦ (or Réglages › Cartes): its checkbox. @param {Locator} panel @param {string} key */
const box = (panel, key) => panel.getByRole('group', { name: 'Noms et réseaux' }).getByRole('checkbox', { name: new RegExp('^' + LABELS[key]) });
/** Those ticked there, in the panel's order. @param {Locator} panel */
async function ticked(panel) {
  const out = [];
  for (const key of Object.keys(LABELS)) if (await box(panel, key).isChecked()) out.push(key);
  return out;
}
/** « Couches affichées » of a panel: « Noms et réseaux » there, from the top. @param {Locator} panel */
const stacked = panel => panel.locator('gf-layer-stack ul.marks li');
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

/** A theme of the panel unfolded (folded while none of its layers is ticked): « relief », « espaces ». @param {Locator} panel @param {string} key */
async function unfold(panel, key) {
  const theme = panel.locator(`details.theme[data-group="${key}"]`);
  if (!(await theme.evaluate(d => /** @type {HTMLDetailsElement} */ (d).open))) await theme.locator('summary').click();
  await expect(theme).toHaveAttribute('open', '');
}

test('sur les photos : les trois habituelles demandées (PNG, du zoom 6 au 19), au-dessus d’une surcouche ; les six cochées, chacune à sa place, les noms de lieux dessus ; décochées, plus demandées, gardé au rechargement', async ({ app, page }) => {
  await app.open(`#/layout/[map(r=1km)]?${AT}`);
  const map = page.locator('dl-map gf-map');
  await expect.poll(() => lookOf(map)).toEqual({ base: 'photo', landmarks: KEYS });
  // Each asked by its identifier, its style, as PNG; the three others not.
  await expect.poll(namesAsked).toEqual(expect.arrayContaining(NAMES));
  expect(namesAsked().filter(l => !NAMES.includes(/** @type {string} */ (l)))).toEqual([]);
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

  // « Noms et réseaux » in the panel: the usual three ticked. An overlay ticked: they stay over it, one above the other.
  const panel = await openPanel(map);
  expect(await ticked(panel)).toEqual(['lieux', 'routes', 'eau']);
  await unfold(panel, 'relief');
  await panel.getByRole('checkbox', { name: /Courbes de niveau/ }).check();
  await expect.poll(async () => (await tileLayers(map)).map(l => l.key)).toEqual(expect.arrayContaining(['photo', 'contours', ...KEYS]));
  const layers = await tileLayers(map);
  const contours = /** @type {any} */ (layers.find(l => l.key === 'contours')).z;
  const photo = /** @type {any} */ (layers.find(l => l.key === 'photo')).z;
  await expect.poll(async () => (await names2d(map)).map(n => n.layer)).toEqual(NAMES);
  const named = await names2d(map);
  expect(named.every(n => n.z > contours && contours > photo)).toBe(true);
  expect(named.map(n => n.z)).toEqual([...named.map(n => n.z)].sort((a, b) => a - b));
  // Not an overlay: not among the layers shown with an opacity.
  await expect(panel.getByRole('slider', { name: /^Opacité de / })).toHaveCount(1);

  // The three others ticked: six layers, each at its place — the boundaries lowest, the places' names on top —, all
  // over the overlay; kept as every map's choice.
  for (const key of ['rail', 'bati', 'limites']) await box(panel, key).check();
  await expect.poll(() => stored(page)).toEqual({ base: 'photo', overlays: ['contours'], distribution: false, landmarks: ALL_KEYS });
  await expect.poll(async () => (await names2d(map)).sort((a, b) => a.z - b.z).map(n => n.layer)).toEqual(ALL);
  const six = (await names2d(map)).sort((a, b) => a.z - b.z);
  expect(six.map(n => n.z)).toEqual([14, 15, 16, 17, 18, 19]);
  expect(six.every(n => n.z > contours)).toBe(true);
  for (const id of ALL) expect(seen.some(u => u.includes(`LAYER=${id}&STYLE=normal&FORMAT=image%2Fpng`)), id).toBe(true);
  // « Couches affichées », from the top: each with « Masquer » only (no opacity, no order of its own).
  await expect(stacked(panel)).toHaveText(['Noms de lieux', 'Cours d’eau', 'Routes', 'Voies ferrées', 'Bâtiments', 'Limites administratives']);
  await expect(panel.locator('gf-layer-stack ul.marks').getByRole('button')).toHaveCount(6);
  await expect(panel.getByRole('slider', { name: /^Opacité de / })).toHaveCount(1);

  // All taken off (« Masquer » for two, their checkboxes for the others): none, kept as before (names: false); their
  // layers gone, never asked again.
  await panel.locator('gf-layer-stack').getByRole('button', { name: 'Masquer Limites administratives' }).click();
  await panel.locator('gf-layer-stack').getByRole('button', { name: 'Masquer Bâtiments' }).click();
  for (const key of ['rail', 'lieux', 'routes', 'eau']) await box(panel, key).uncheck();
  await expect.poll(() => stored(page)).toEqual({ base: 'photo', overlays: ['contours'], distribution: false, names: false });
  await expect(stacked(panel)).toHaveCount(0);
  await expect.poll(async () => (await tileLayers(map)).filter(l => ALL_KEYS.includes(l.key)).length).toBe(0);
  seen.length = 0;
  await map.evaluate(m => /** @type {any} */ (m).flyTo([2.37, 48.86], 15));
  await expect.poll(() => asked().includes('ORTHOIMAGERY.ORTHOPHOTOS')).toBe(true);
  expect(namesAsked()).toEqual([]);

  // Reloaded: still none, none asked.
  seen.length = 0;
  await page.reload();
  await app.ready();
  const again = page.locator('dl-map gf-map');
  await expect.poll(() => lookOf(again)).toEqual({ base: 'photo', landmarks: [] });
  await expect.poll(() => asked().includes('ORTHOIMAGERY.ORTHOPHOTOS')).toBe(true);
  expect(namesAsked()).toEqual([]);
  const panel2 = await openPanel(again);
  expect(await ticked(panel2)).toEqual([]);
  // One ticked again: that one alone, asked, kept as such; the usual three: the key of before as before.
  await box(panel2, 'routes').check();
  await expect.poll(() => stored(page)).toEqual({ base: 'photo', overlays: ['contours'], distribution: false, landmarks: ['routes'] });
  await expect.poll(namesAsked).toEqual(['TRANSPORTNETWORKS.ROADS']);
  await box(panel2, 'lieux').check();
  await box(panel2, 'eau').check();
  await expect.poll(namesAsked).toEqual(expect.arrayContaining(NAMES));
  await expect.poll(() => stored(page)).toEqual({ base: 'photo', overlays: ['contours'], distribution: false });
});

test('le plan : les six cases désactivées, leur choix gardé, la note les décrit ; rien de demandé, « Couches affichées » le dit ; SPOT : les noms ; Réglages › Cartes, les mêmes cases, toujours à cocher sur le plan commun', async ({ app, page }) => {
  await app.open(`#/layout/[map(r=1km)]?${AT}`);
  const map = page.locator('dl-map gf-map');
  const panel = await openPanel(map);
  const fond = panel.getByRole('group', { name: 'Fond de carte' });
  await fond.getByRole('button', { name: /Plan IGN/ }).click();
  await expect.poll(() => stored(page).then(s => s?.base)).toBe('plan');
  // Its own names: the choice kept, not offered there — said, and told to a screen reader with each checkbox.
  for (const key of Object.keys(LABELS)) {
    await expect(box(panel, key)).toBeDisabled();
    await expect(box(panel, key)).toHaveAccessibleDescription('Le plan IGN dessine déjà les siens : ces choix valent pour les photos et SPOT.');
  }
  expect(await ticked(panel)).toEqual(['lieux', 'routes', 'eau']);
  await expect(panel.locator('gf-layer-stack')).toContainText('Noms et réseaux : ceux du plan IGN.');
  await expect(stacked(panel)).toHaveCount(0);
  await expect(panel.locator('gf-layer-stack .base')).toHaveText('Fond : Plan IGN');
  await expect.poll(async () => (await tileLayers(map)).map(l => l.key)).toEqual(['plan']);
  seen.length = 0;
  await map.evaluate(m => /** @type {any} */ (m).flyTo([2.37, 48.86], 15));
  await expect.poll(() => asked().includes('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2')).toBe(true);
  expect(namesAsked()).toEqual([]);

  // SPOT: the checkboxes back, the names over its images.
  seen.length = 0;
  await fond.getByRole('button', { name: /Satellite \(SPOT\)/ }).click();
  await expect(box(panel, 'routes')).toBeEnabled();
  await expect(box(panel, 'routes')).not.toHaveAttribute('aria-describedby');
  await expect.poll(namesAsked).toEqual(expect.arrayContaining(NAMES));
  expect(asked()).toContain('ORTHOIMAGERY.ORTHO-SAT.SPOT.2025');
  await expect.poll(async () => (await names2d(map)).length).toBe(3);
  const spot = /** @type {any} */ ((await tileLayers(map)).find(l => l.key.startsWith('spot:')));
  expect((await names2d(map)).every(n => n.z > spot.z)).toBe(true);
  // A background chosen under the names alone, an overlay ticked next: the overlay over the background, the names over both.
  await fond.getByRole('button', { name: /Photos aériennes/ }).click();
  await unfold(panel, 'relief');
  await panel.getByRole('checkbox', { name: /Courbes de niveau/ }).check();
  await expect.poll(async () => {
    const layers = await tileLayers(map), named = await names2d(map);
    const z = (/** @type {string} */ key) => layers.find(l => l.key === key)?.z ?? NaN;
    return named.length === 3 && z('photo') < z('contours') && named.every(n => n.z > z('contours'));
  }).toBe(true);
  await panel.getByRole('checkbox', { name: /Courbes de niveau/ }).uncheck();
  await fond.getByRole('button', { name: /Satellite \(SPOT\)/ }).click();
  // The roads unticked on SPOT, the plan chosen, then the photos: still unticked (one choice for both).
  await box(panel, 'routes').uncheck();
  await fond.getByRole('button', { name: /Plan IGN/ }).click();
  await fond.getByRole('button', { name: /Photos aériennes/ }).click();
  expect(await ticked(panel)).toEqual(['lieux', 'eau']);
  await expect.poll(() => stored(page)).toEqual({ base: 'photo', overlays: [], distribution: false, landmarks: ['eau', 'lieux'] });

  // Réglages › Cartes: its words, the same checkboxes — ticked there, the Carte follows; on the common plan, still
  // chosen there (said): the maps with their own photos or SPOT follow them.
  await app.go('#/settings');
  const card = page.locator('gf-settings .maps-card');
  await expect(card).toContainText('sur les photos et SPOT, les noms et réseaux par-dessus toutes les couches');
  await expect(card).toContainText('ses noms et réseaux (noms=)');
  const options = page.locator('gf-settings gf-map-options[scope="defaults"]');
  expect(await ticked(options)).toEqual(['lieux', 'eau']);
  await box(options, 'routes').check();
  await expect.poll(() => stored(page)).toEqual({ base: 'photo', overlays: [], distribution: false });
  const settingsFond = options.getByRole('group', { name: 'Fond de carte' });
  await settingsFond.getByRole('button', { name: /Plan IGN/ }).click();
  await expect(box(options, 'routes')).toBeEnabled();
  await expect(box(options, 'routes')).toBeChecked();
  await expect(box(options, 'routes')).toHaveAccessibleDescription('Sans effet sur le plan IGN, qui a les siens : ces choix valent pour les cartes en photos ou SPOT.');
  await box(options, 'rail').check();
  await expect.poll(() => stored(page)).toEqual({ base: 'plan', overlays: [], distribution: false, landmarks: ['rail', 'routes', 'eau', 'lieux'] });
  expect(await page.evaluate(async () => (await import('/app/core/map-settings.js')).lookFor({ base: 'photo' }).landmarks)).toEqual(['rail', 'routes', 'eau', 'lieux']);
  await box(options, 'rail').uncheck();
  await settingsFond.getByRole('button', { name: /Photos aériennes/ }).click();
  await expect(box(options, 'routes')).toBeEnabled();
  await expect(box(options, 'routes')).not.toHaveAttribute('aria-describedby');
  await app.go('#/map');
  await expect.poll(() => lookOf(page.locator('gf-map-page gf-map'))).toEqual({ base: 'photo', landmarks: KEYS });
});

test('en 3D : leurs sources de MapLibre au-dessus des autres couches de l’IGN, une fois chacune, dans leur ordre — décochées puis cochées, les voies ferrées en plus, le plan puis les photos', async ({ app, page }, info) => {
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
  // Unticked: none asked any more — by MapLibre, nor by the 2D map hidden under it (its layers taken off, never drawn
  // again for nothing).
  await expect.poll(() => map.evaluate(m => /** @type {any} */ (m).gl.glMap.areTilesLoaded()), SLOW).toBe(true);
  for (const key of KEYS) await box(panel, key).uncheck();
  await expect.poll(rasters, SLOW).toEqual(WITHOUT);
  seen.length = 0;
  await map.evaluate(m => /** @type {any} */ (m).flyTo([2.30, 48.87], 15));
  await expect.poll(() => asked().includes('ORTHOIMAGERY.ORTHOPHOTOS'), SLOW).toBe(true);
  expect(namesAsked()).toEqual([]);
  for (const key of KEYS) await box(panel, key).check();
  await expect.poll(rasters, SLOW).toEqual(WITH);
  // One of them off and on again, twice: at its place each time, never twice.
  for (let i = 0; i < 2; i++) {
    await box(panel, 'eau').uncheck();
    await expect.poll(rasters, SLOW).toEqual([...WITHOUT, MARKS[0], MARKS[2]]);
    await box(panel, 'eau').check();
    await expect.poll(rasters, SLOW).toEqual(WITH);
  }
  // The railways too: under the roads.
  await box(panel, 'rail').check();
  await expect.poll(rasters, SLOW).toEqual([...WITHOUT, ['rail', 'TRANSPORTNETWORKS.RAILWAYS'], ...MARKS]);
  await box(panel, 'rail').uncheck();
  await expect.poll(rasters, SLOW).toEqual(WITH);
  // An overlay added on top of the others: under them still.
  await unfold(panel, 'espaces');
  await panel.getByRole('checkbox', { name: /Parcelles cadastrales/ }).check();
  await expect.poll(rasters, SLOW).toEqual([...WITHOUT, ['cadastre', 'CADASTRALPARCELS.PARCELLAIRE_EXPRESS'], ...MARKS]);
  await panel.getByRole('checkbox', { name: /Parcelles cadastrales/ }).uncheck();
  // The plan (its names its own), then the photos: the usual three back, once each.
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

test('une couche qui est l’une d’elles (« Cours d’eau », layers=hydro) : dessinée une fois, à sa place et à son opacité, parmi les couches affichées ; masquée, « Noms et réseaux » la redessine par-dessus', async ({ app, page }) => {
  await app.open(`#/layout/[map(r=1km;layers=hydro+forets;opac=hydro.30)]?${AT}`);
  const map = page.locator('dl-map gf-map');
  const HYDRO = 'ign:HYDROGRAPHY.HYDROGRAPHY';
  // The rivers once: the overlay's, under the public forests as written, at its opacity; the names' layers without them.
  await expect.poll(async () => (await drawn(map)).filter(l => l.layer).map(l => [l.key, l.layer])).toEqual([
    ['photo', 'ORTHOIMAGERY.ORTHOPHOTOS'], [HYDRO, 'HYDROGRAPHY.HYDROGRAPHY'], ['forets', 'FORETS.PUBLIQUES'],
    ['routes', 'TRANSPORTNETWORKS.ROADS'], ['lieux', 'GEOGRAPHICALNAMES.NAMES']]);
  expect((await drawn(map)).filter(l => l.key === HYDRO).map(l => l.opacity)).toEqual([0.3]);
  // « Couches affichées »: the rivers among the layers (with their opacity), not over them.
  const panel = await openPanel(map);
  await expect(stacked(panel)).toHaveText(['Noms de lieux', 'Routes']);
  await expect(panel.locator('gf-layer-stack ul.active li .name')).toHaveText([/^Forêts publiques/, /^Hydrographie/]);
  // Its opacity changed: seen (nothing opaque over it).
  await panel.getByRole('slider', { name: /^Opacité de Hydrographie/ }).fill('60');
  await expect.poll(async () => (await drawn(map)).filter(l => l.key === HYDRO).map(l => l.opacity)).toEqual([0.6]);
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,layers=hydro+forets,opac=hydro.60)]');
  // Hidden: the names draw the rivers again, over the forests, once.
  await panel.getByRole('button', { name: /^Masquer Hydrographie/ }).click();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,layers=forets)]');
  await expect.poll(async () => (await drawn(map)).filter(l => l.layer).map(l => [l.key, l.layer])).toEqual([
    ['photo', 'ORTHOIMAGERY.ORTHOPHOTOS'], ['forets', 'FORETS.PUBLIQUES'], ...MARKS]);
  await expect(stacked(panel)).toHaveText(['Noms de lieux', 'Cours d’eau', 'Routes']);
  // Unticked one by one: the cell's own, written (noms=lieux+routes … noms=0), none drawn.
  await box(panel, 'eau').uncheck();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,noms=lieux+routes,layers=forets)]');
  await box(panel, 'lieux').uncheck();
  await box(panel, 'routes').uncheck();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,noms=0,layers=forets)]');
  await expect.poll(async () => (await drawn(map)).filter(l => KEYS.includes(l.key)).length).toBe(0);
});

test('une case de disposition : noms=0 les cache, son panneau ▦ les montre (noms=lieux, noms=1) ; « Revenir aux réglages communs » retire noms= ; gardé sur le plan de sa vignette', async ({ app, page }) => {
  await app.open(`#/layout/[map(r=1km;noms=0)]?${AT}`);
  const map = page.locator('dl-map gf-map');
  await expect.poll(() => lookOf(map)).toEqual({ base: 'photo', landmarks: [] });
  await expect.poll(() => asked().includes('ORTHOIMAGERY.ORTHOPHOTOS')).toBe(true);
  expect(namesAsked()).toEqual([]);
  // Its panel: its own choice, said; ticked there, written in its address — the common look untouched.
  const panel = await openPanel(map);
  await expect(panel.locator('.scope')).toContainText('Cette carte a son propre choix des noms et réseaux');
  expect(await ticked(panel)).toEqual([]);
  await box(panel, 'lieux').check();
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,noms=lieux)]');
  await box(panel, 'routes').check();
  await box(panel, 'eau').check();
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
  for (const key of KEYS) await box(panel2, key).uncheck();
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
  await expect(panel3.locator('.scope')).toContainText('Cette carte a son propre choix des noms et réseaux, sans effet sur le plan IGN');
  await expect(box(panel3, 'lieux')).toBeDisabled();
  expect(await ticked(panel3)).toEqual([]);
  await expect(panel3.getByRole('button', { name: 'Revenir aux réglages communs' })).toBeVisible();
});

test('fiche plante : un bloc Carte qui n’a que ses noms et réseaux à lui le dit, dans son ⚙ comme dans son panneau ▦', async ({ app, page }) => {
  test.slow();
  await app.open('#/');
  await page.evaluate(async () => { (await import('/app/core/sheet-blocks.js')).setMapConfig('map', { look: { names: false } }); });
  await app.go(`#/plant/${plantId('Urtica dioica')}`);
  const map = page.locator('gf-sheet-map gf-map').first();
  await map.scrollIntoViewIfNeeded();
  await expect.poll(() => lookOf(map), { timeout: 20_000 }).toEqual({ base: 'photo', landmarks: [] });
  await app.king();
  await page.getByRole('button', { name: 'Configurer la carte « Carte »' }).click();
  const form = page.locator('gf-plant-detail .map-form').first();
  await expect(form).toContainText('dans le panneau ▦ de la carte (cette carte a son propre choix des noms et réseaux ; le panneau propose de revenir aux réglages communs)');
  const panel = await openPanel(map);
  await expect(panel.locator('.scope')).toContainText('Cette carte a son propre choix des noms et réseaux');
  expect(await ticked(panel)).toEqual([]);
});

test('une case de disposition : noms= une liste (ceux-là seuls, chacun à sa place, l’un au-dessus de l’autre), ses autres noms réécrits ; 1 et une de plus ; dits dans sa légende ; sur le plan, rien', async ({ app, page }) => {
  // Their other names, in any order: written canonical (the panel's order); the railways under the places' names.
  await app.open(`#/layout/[map(r=1km;noms=train+villes)]?${AT}`);
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,noms=lieux+rail)]');
  const map = page.locator('dl-map gf-map');
  await expect.poll(() => lookOf(map)).toEqual({ base: 'photo', landmarks: ['rail', 'lieux'] });
  /** Those drawn, the lowest first. @param {Locator} m */
  const byZ = async m => (await names2d(m)).sort((x, y) => x.z - y.z).map(n => n.layer);
  await expect.poll(() => byZ(map)).toEqual(['TRANSPORTNETWORKS.RAILWAYS', 'GEOGRAPHICALNAMES.NAMES']);
  for (const id of ['TRANSPORTNETWORKS.RAILWAYS', 'GEOGRAPHICALNAMES.NAMES']) expect(seen.some(u => u.includes(`LAYER=${id}&STYLE=normal&FORMAT=image%2Fpng`)), id).toBe(true);
  expect(asked().filter(l => ['TRANSPORTNETWORKS.ROADS', 'HYDROGRAPHY.HYDROGRAPHY', 'BUILDINGS.BUILDINGS', 'LIMITES_ADMINISTRATIVES_EXPRESS.LATEST'].includes(/** @type {string} */ (l)))).toEqual([]);
  // Its panel: those two ticked, read from the top in « Couches affichées ».
  const panel = await openPanel(map);
  expect(await ticked(panel)).toEqual(['lieux', 'rail']);
  await expect(stacked(panel)).toHaveText(['Noms de lieux', 'Voies ferrées']);
  await closePanel(page, panel);
  // The usual three and the buildings (noms=1+bati): four, the buildings at the bottom.
  await app.go(`#/layout/[map(r=1km;noms=1+bâtiments)]?${AT}`);
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,noms=lieux+routes+eau+bati)]');
  await expect.poll(() => lookOf(page.locator('dl-map gf-map'))).toEqual({ base: 'photo', landmarks: ['bati', ...KEYS] });
  await expect.poll(() => byZ(page.locator('dl-map gf-map'))).toEqual(['BUILDINGS.BUILDINGS', ...NAMES]);
  // Its legend: its own ones said, after its layers.
  await app.go(`#/layout/[map(r=1km;noms=rail+lieux;layers=haies;ctl=legende;legende=1)]?${AT}`);
  const legend = page.locator('dl-map').getByRole('list', { name: 'Légende de la carte' });
  await expect(legend.locator('li').filter({ hasText: /Haies|Noms et réseaux/ })).toHaveText(['Haies', 'Noms et réseaux : Noms de lieux, Voies ferrées']);
  // On the plan: kept, none drawn nor asked, nor in its legend.
  seen.length = 0;
  await app.go(`#/layout/[map(r=1km;base=plan;noms=rail+lieux;ctl=legende;legende=1)]?${AT}`);
  await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,base=plan,noms=lieux+rail,legende=1,ctl=legende)]');
  const plan = page.locator('dl-map gf-map');
  await expect.poll(() => lookOf(plan)).toEqual({ base: 'plan', landmarks: ['rail', 'lieux'] });
  await expect.poll(async () => (await tileLayers(plan)).map(l => l.key)).toEqual(['plan']);
  expect(asked().filter(l => /RAILWAYS|GEOGRAPHICALNAMES/.test(String(l)))).toEqual([]);
  await expect(legend).toContainText('La zone');
  await expect(legend).not.toContainText('Noms et réseaux');
});

test('en modification : « Noms et réseaux » dans Fond, une pastille par couche ; aucune écrit noms=0 avant la 3D (« ; » entre deux chiffres), les trois habituelles noms=1, Par défaut le retire', async ({ app, page, isMobile }) => {
  test.skip(isMobile, 'the picker docked: a wide screen');
  await app.open(screen('[map(r=1km,base=photo,annee=2016;3d=0)]', AT, true));
  await page.locator('gf-layout section.cell[data-cell="0"] .cell-head .pick').click();
  const p = page.locator('gf-block-picker:not([inline])');
  await p.locator('.row[data-group="Fond"]').click();
  const noms = p.locator('[data-param="noms"]');
  await expect(noms).toContainText('Noms et réseaux');
  await expect(noms).toContainText('aucune choisie : selon les réglages communs (sur les photos et SPOT)');
  await expect(noms.locator('button.chip')).toHaveText(['Noms de lieux', 'Routes', 'Cours d’eau', 'Voies ferrées', 'Bâtiments', 'Limites administratives']);
  await expect(noms.locator('[data-act="default"]')).toHaveCount(0);
  const grid = () => layoutOf(page);
  const look = () => lookOf(page.locator('gf-layout dl-map gf-map'));
  // One chosen: that one alone, written.
  await noms.locator('button[data-value="rail"]').click();
  await expect.poll(grid).toBe('[map(r=1km,base=photo,annee=2016,noms=rail,3d=0)]');
  await expect(noms.locator('button[data-value="rail"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(look).toEqual({ base: 'photo:2016', landmarks: ['rail'] });
  // Unchosen: none (noms=0, « ; » before the 3D).
  await noms.locator('button[data-value="rail"]').click();
  await expect.poll(grid).toBe('[map(r=1km,base=photo,annee=2016,noms=0;3d=0)]');
  await expect.poll(look).toEqual({ base: 'photo:2016', landmarks: [] });
  // The usual three, one at a time: noms=1.
  for (const [v, written] of [['lieux', 'noms=lieux,3d=0'], ['routes', 'noms=lieux+routes,3d=0'], ['eau', 'noms=1;3d=0']]) {
    await noms.locator(`button[data-value="${v}"]`).click();
    await expect.poll(grid).toBe(`[map(r=1km,base=photo,annee=2016,${written})]`);
  }
  await expect.poll(look).toEqual({ base: 'photo:2016', landmarks: KEYS });
  // « Par défaut »: noms= gone, the common choice.
  await noms.locator('[data-act="default"]').click();
  await expect.poll(grid).toBe('[map(r=1km,base=photo,annee=2016;3d=0)]');
  await expect(noms.locator('[data-act="default"]')).toHaveCount(0);
  await expect.poll(look).toEqual({ base: 'photo:2016', landmarks: KEYS });
});

