// Every map in 3D (gf-map-gl.js): Réglages › Cartes « 3D », or a map's own 2D ⇄ 3D button. Real WebGL (SwiftShader,
// as in map3d.spec.mjs), every tile made here (tiles.mjs: the IGN's photos and plan, the relief, a block of buildings),
// never the network. The Carte in MapLibre with its relief, the same layers as in 2D, the options (buildings, sky,
// globe) switched from its panel, its markers clickable; 2D by default, MapLibre never asked then; each map's own
// button; back in 2D while positions are edited; the ways it stays in 2D or flat (no WebGL2, modules off, offline);
// the « Jusqu’où part l’expédition ? » step always from above; one WebGL map per plant sheet.
import { test, expect, plantId, answerAround } from './fixtures.mjs';
import { answerTiles } from './tiles.mjs';

test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });
// Software WebGL draws every pixel on the CPU: on the desktop, a smaller window keeps each frame (and the run) short.
test.beforeEach(async ({ page }, info) => { if (info.project.name.startsWith('desktop')) await page.setViewportSize({ width: 1024, height: 680 }); });

/**
 * MapLibre's files asked, the map tiles asked, the console's errors (not the browser's lines for a request refused)
 * and CSP violations.
 * @param {import('@playwright/test').Page} page
 */
async function watch(page) {
  /** @type {string[]} */ const problems = [];
  /** @type {string[]} */ const maplibre = [];
  /** @type {string[]} */ const tiles = [];
  page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push('console: ' + m.text()); });
  page.on('request', r => { if (r.url().includes('/vendor/maplibre/')) maplibre.push(new URL(r.url()).pathname); });
  await page.addInitScript(() => {
    addEventListener('securitypolicyviolation', e => console.error(`CSP ${e.violatedDirective} ${e.blockedURI}`));
  });
  return { problems, maplibre, tiles };
}

/** Réglages › Cartes as stored before the app starts. @param {import('@playwright/test').Page} page @param {Record<string, any>} s */
const settings = (page, s) => page.addInitScript(v => { if (!sessionStorage.getItem('gf-maps3d-set')) { sessionStorage.setItem('gf-maps3d-set', '1'); localStorage.setItem('geoflora.maps3d', v); } }, JSON.stringify(s));

/**
 * Two places in Clermont-Ferrand, three plants in them. @param {import('@playwright/test').Page} page
 * @returns {Promise<string>} the first place's id
 */
function seedPlaces(page) {
  return page.evaluate(async ({ a, b, c }) => {
    const col = await import('/app/core/collections.js');
    let p = col.newPlace([3.0870, 45.7772], { name: 'Jardin Lecoq' });
    p = col.withPlant(p, { id: a, scientificName: 'Urtica dioica' }, { coordinates: [3.0875, 45.7775], accuracy: 5 });
    p = col.withPlant(p, { id: b, scientificName: 'Allium ursinum' }, { coordinates: [3.0866, 45.7769], accuracy: 5 });
    const saved = await col.savePlace(p);
    let q = col.newPlace([3.0890, 45.7778], { name: 'Place de Jaude' });
    q = col.withPlant(q, { id: c, scientificName: 'Bellis perennis' }, { coordinates: [3.0891, 45.7779], accuracy: 5 });
    await col.savePlace(q);
    return saved.id;
  }, { a: plantId('Urtica dioica'), b: plantId('Allium ursinum'), c: plantId('Bellis perennis') });
}

/** What the 3D adapter of a map says (gf-map-gl.js state()). @param {import('@playwright/test').Locator} map */
/** Software WebGL is slow: a change of style may take its time. */
const SLOW = { timeout: 30_000 };
const glState = map => map.evaluate(m => /** @type {any} */ (m).gl.state());

/** A finger held on the screen (a long press). @param {import('@playwright/test').Page} page @param {number} x @param {number} y */
async function longPress(page, x, y) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(900);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** The Carte's map. @param {import('@playwright/test').Page} page */
const carte = page => page.locator('gf-map-page gf-map');

test('Réglages › Cartes « 3D » : la Carte en MapLibre — relief, bâtiments, ciel, crédits ; marqueurs cliquables, appui long', async ({ app, page }) => {
  test.slow();
  const seen = await watch(page);
  await answerTiles(page, { seen: seen.tiles });
  await app.open('#/settings');
  const s = page.locator('gf-settings');
  await expect(s.locator('#cartes')).toHaveText('Cartes');
  const group = s.getByRole('group', { name: 'Affichage des cartes' });
  await expect(group.getByRole('radio', { name: /^2D/ })).toBeChecked();
  await group.getByRole('radio', { name: /^3D/ }).check();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.maps3d') || 'null'))).toEqual({ renderer: '3d' });
  // Its options, in French; the relief's exaggeration stored as soon as it is moved.
  await expect(s.getByRole('checkbox', { name: /Bâtiments en 3D/ })).toBeChecked();
  await s.getByLabel('Exagération du relief').fill('2');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.maps3d') || 'null')?.exaggeration)).toBe(2);
  // A gentler tilt (software WebGL, here, draws a steep one slowly).
  await s.getByLabel('Inclinaison à l’ouverture').fill('30');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.maps3d') || 'null')?.pitch)).toBe(30);
  expect(seen.maplibre, 'Réglages draw no map').toEqual([]);

  const spot = await seedPlaces(page);
  await app.go(`#/map?spot=${spot}`);
  const map = carte(page);
  await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 30_000 });
  expect(seen.maplibre).toEqual(expect.arrayContaining(['/vendor/maplibre/maplibre-gl.mjs', '/vendor/maplibre/maplibre-gl-worker.mjs', '/vendor/maplibre/maplibre-gl.css']));
  await expect(map.locator('canvas.maplibregl-canvas')).toHaveCount(1);
  // The 2D map stays under it, hidden: the view and the markers' logic.
  await expect(map.locator('.gf-map-canvas')).toBeHidden();
  let st = await glState(map);
  expect(st.terrain).toBe(true);
  expect(st.exaggeration).toBe(2);
  expect(st.sky).toBe(true);
  expect(st.pitch).toBe(30);
  expect(st.layers).toContain('gf-buildings');
  expect(st.layers).toContain('gf-hillshade');
  expect(st.sources).toContain('gf-bati');
  expect(st.tiles.map((/** @type {any} */ t) => t.key)).toEqual(['photo']);
  // The relief from AWS, the buildings from the IGN's vector tiles, the photos from its WMTS.
  await expect.poll(() => seen.tiles.some(u => u.includes('elevation-tiles-prod'))).toBe(true);
  await expect.poll(() => seen.tiles.some(u => /tms\/1\.0\.0\/PLAN\.IGN\/\d+/.test(u))).toBe(true);
  await expect.poll(() => seen.tiles.some(u => u.includes('ORTHOIMAGERY.ORTHOPHOTOS'))).toBe(true);
  // Credits (the 2D map's, the relief's).
  await expect(map.locator('.leaflet-control-attribution')).toContainText('IGN');
  await expect(map.locator('.leaflet-control-attribution')).toContainText('Terrain Tiles');
  // Software WebGL draws buildings on the relief slowly (a second or two a frame, here): flat and without them for
  // the rest of the test (the relief's credit goes with it).
  await page.evaluate(async () => { (await import('/app/core/map-settings.js')).setMapSettings({ buildings: false, hillshade: false, relief: false }); });
  await expect.poll(async () => (await glState(map)).terrain, SLOW).toBe(false);
  expect((await glState(map)).layers).not.toContain('gf-buildings');
  await expect(map.locator('.leaflet-control-attribution')).not.toContainText('Terrain Tiles');
  // MapLibre's buttons in French, the canvas reachable by keyboard.
  await expect(map.locator('.maplibregl-ctrl-compass')).toHaveAttribute('aria-label', /Revenir au nord/);
  await expect(map.locator('canvas.maplibregl-canvas')).toHaveAttribute('aria-label', /Carte en 3D/);
  // Shift + arrows: rotate and tilt (MapLibre's keyboard).
  await map.locator('canvas.maplibregl-canvas').focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await glState(map)).bearing, SLOW).not.toBe(0);

  // The places and plants of the 2D map, the same elements, on the relief; a plant clicked opens it.
  const plants = map.locator('.gf-gl-mk .gf-plant');
  await expect(plants).toHaveCount(3);
  await expect(map.locator('.gf-gl-mk .gf-place')).toHaveCount(2);
  await plants.first().dispatchEvent('click');
  await expect.poll(() => page.evaluate(() => location.hash)).toContain('focus=');

  // A long press (right click): the point's card, as in 2D.
  const box = await map.locator('canvas.maplibregl-canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  if (app.phone) await longPress(page, box.x + box.width * 0.5, box.y + box.height * 0.6);
  else await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.6, { button: 'right' });
  await expect(map.locator('gf-point-card')).toBeVisible();
  await expect(map.locator('.gf-gl-mk .gf-point')).toHaveCount(1);

  // Back in 2D for good (Réglages): MapLibre's map removed, the 2D map shown with its markers.
  await page.evaluate(async () => { (await import('/app/core/map-settings.js')).setMapSettings({ renderer: '2d' }); });
  await expect(map).toHaveAttribute('data-renderer', '2d');
  await expect(map.locator('canvas.maplibregl-canvas')).toHaveCount(0);
  await expect(map.locator('.gf-map-canvas')).toBeVisible();
  await expect(map.locator('.leaflet-marker-pane .gf-place')).toHaveCount(2);
  st = await glState(map);
  expect(st.renderer).toBe('2d');
  expect(seen.problems).toEqual([]);
});

test('en 3D, le panneau « Carte » : les mêmes couches qu’en 2D ; les options de Réglages › Cartes changent la carte aussitôt', async ({ app, page }) => {
  test.slow();
  const seen = await watch(page);
  await answerTiles(page, { seen: seen.tiles });
  // From above, from afar (France), flat: software WebGL draws it fast enough.
  await settings(page, { renderer: '3d', pitch: 0, relief: false });
  await app.open('#/map');
  const map = carte(page);
  await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 30_000 });
  await map.getByRole('button', { name: 'Carte : fond, couches, légende' }).click();
  const panel = map.locator('gf-map-panel dialog');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: /Photos aériennes/ })).toHaveAttribute('aria-pressed', 'true');
  for (const name of ['Parcelles cadastrales', 'Courbes de niveau', 'Forêts publiques', 'Parcs nationaux', 'Réserves naturelles', 'Protection de biotope']) {
    await expect(panel.getByRole('checkbox', { name: new RegExp(name) })).toBeVisible();
  }
  // No 2D ⇄ 3D switch here: the panel says where the 3D is set.
  await expect(panel).toContainText('Carte en 3D');
  await expect(panel.getByRole('link', { name: 'Réglages › Cartes' })).toHaveAttribute('href', '#/settings');
  await expect(panel.getByRole('button', { name: /^(2D|3D)$/ })).toHaveCount(0);
  await panel.getByRole('checkbox', { name: /Courbes de niveau/ }).check();
  await expect.poll(async () => (await glState(map)).tiles.map((/** @type {any} */ t) => t.key), SLOW).toEqual(['photo', 'contours']);
  await panel.getByRole('button', { name: /Plan IGN/ }).click();
  await expect.poll(async () => (await glState(map)).tiles.map((/** @type {any} */ t) => t.key), SLOW).toEqual(['plan', 'contours']);
  await panel.getByRole('button', { name: 'Fermer' }).click();

  // Réglages › Cartes (here as they store them; in another tab the same: core/sync.js): buildings off, sky off, the
  // globe on, the vector plan — each one at once on the map.
  const set = (/** @type {Record<string, any>} */ patch) => page.evaluate(async p => { (await import('/app/core/map-settings.js')).setMapSettings(p); }, patch);
  expect((await glState(map)).layers).toContain('gf-buildings');
  await set({ buildings: false });
  await expect.poll(async () => (await glState(map)).layers.includes('gf-buildings'), SLOW).toBe(false);
  await set({ sky: false });
  await expect.poll(async () => (await glState(map)).sky, SLOW).toBe(false);
  await set({ globe: true });
  await expect.poll(async () => (await glState(map)).projection, SLOW).toBe('globe');
  await set({ plan: 'vector' });
  await expect.poll(async () => (await glState(map)).layers.includes('ign-v:bati_surf'), SLOW).toBe(true);
  await set({ light: 'hour', hour: 21 });
  await expect.poll(async () => (await glState(map)).light?.color, SLOW).not.toBe('#ffffff');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.maps3d') || 'null'))).toEqual({ renderer: '3d', pitch: 0, relief: false, buildings: false, sky: false, globe: true, plan: 'vector', light: 'hour', hour: 21 });
  expect(seen.problems).toEqual([]);
});

test('2D par défaut, MapLibre jamais demandé, aucun bouton 2D ⇄ 3D ; l’édition repasse en 2D, avec une note', async ({ app, page }) => {
  test.slow();
  const seen = await watch(page);
  await answerTiles(page);
  await app.open('#/collections');
  const spot = await seedPlaces(page);
  await app.go(`#/map?spot=${spot}`);
  const map = carte(page);
  await expect(map.locator('.leaflet-marker-pane .gf-place')).toHaveCount(2);
  await expect(map).toHaveAttribute('data-renderer', '2d');
  expect(seen.maplibre).toEqual([]);
  // The choice is Réglages': no map has a 2D ⇄ 3D button.
  await expect(map.getByRole('button', { name: /3D|2D/ })).toHaveCount(0);

  // 3D in Réglages: the Carte follows.
  await page.evaluate(async () => { (await import('/app/core/map-settings.js')).setMapSettings({ renderer: '3d', buildings: false, pitch: 40 }); });
  await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 30_000 });
  await expect(map.locator('.gf-gl-mk .gf-place')).toHaveCount(2);
  await expect(map).toHaveAttribute('data-pitch', '40');
  await expect(map.getByRole('button', { name: /3D|2D/ })).toHaveCount(0);

  // Editing positions (markers dragged): in 2D for the time of it, said; « Terminé »: 3D again.
  await map.getByRole('button', { name: 'Modifier les positions' }).click();
  await expect(map).toHaveAttribute('data-renderer', '2d');
  await expect(map.locator('.gf-gl-note')).toContainText('Modification des positions : carte en 2D le temps de l’édition.');
  await expect(map.locator('canvas.maplibregl-canvas')).toHaveCount(0);
  await expect(map.locator('.leaflet-marker-pane .gf-place.editing')).toHaveCount(2);
  await map.locator('.gf-map-editbar').getByRole('button', { name: 'Terminé' }).click();
  await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 30_000 });
  await expect(map.locator('.gf-gl-note')).toBeHidden();
  expect(seen.problems).toEqual([]);
});

test('sans WebGL2 : les cartes restent en 2D et le disent, MapLibre jamais demandé', async ({ app, page }) => {
  const seen = await watch(page);
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    // @ts-ignore -- this device has no WebGL2
    HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return kind === 'webgl2' ? null : get.call(this, kind, ...rest); };
  });
  await settings(page, { renderer: '3d' });
  await app.open('#/map');
  const map = carte(page);
  await expect(map.locator('.gf-gl-note')).toContainText('3D indisponible sur cet appareil (WebGL2 requis) : carte en 2D.');
  await expect(map).toHaveAttribute('data-renderer', '2d');
  await expect(map.locator('.gf-map-canvas')).toBeVisible();
  expect(seen.maplibre).toEqual([]);
  // Réglages say so too.
  await app.go('#/settings');
  await expect(page.locator('gf-settings')).toContainText('Cet appareil n’affiche pas la 3D (WebGL2 requis)');
  expect(seen.problems).toEqual([]);
});

test('modules coupés et hors ligne : ni relief ni tuile du réseau, la 3D à plat ; le relief injoignable', async ({ app, page, context }) => {
  test.slow();
  const seen = await watch(page);
  await answerTiles(page, { seen: seen.tiles });
  await settings(page, { renderer: '3d', hillshade: false });
  await page.addInitScript(() => { if (!sessionStorage.getItem('gf-mod')) { sessionStorage.setItem('gf-mod', '1'); localStorage.setItem('geoflora.modules', JSON.stringify({ relief3d: false, ignMaps: false })); } });
  await app.open('#/map');
  const map = carte(page);
  await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 30_000 });
  let st = await glState(map);
  // « Vue 3D (relief) » off: flat, tilted; « IGN – fonds de carte » off: its tiles from the cache, no buildings.
  expect(st.terrain).toBe(false);
  expect(st.sources).not.toContain('gf-dem');
  expect(st.layers).not.toContain('gf-buildings');
  const source = await map.evaluate(m => /** @type {any} */ (m).gl.glMap.getStyle().sources['gf-tiles-0'].tiles[0]);
  expect(source).toMatch(/^gfcache:\/\/https:\/\/data\.geopf\.fr\/wmts\?/);
  await expect(map.locator('.gf-map-off')).toContainText('Fonds IGN désactivés');
  await page.waitForTimeout(1500);
  expect(seen.tiles, 'no tile from the network').toEqual([]);

  // Modules back on, then offline: flat, said; no relief asked.
  await page.evaluate(async () => {
    const { setModule } = await import('/app/core/modules.js');
    for (const mode of ['epure', 'standard', 'scientific']) { setModule('relief3d', /** @type {any} */ (mode), true); setModule('ignMaps', /** @type {any} */ (mode), true); }
  });
  await expect.poll(async () => (await glState(map)).terrain, SLOW).toBe(true);
  await context.setOffline(true);
  await expect.poll(async () => (await glState(map)).terrain, SLOW).toBe(false);
  await expect(map.locator('.gf-gl-note')).toContainText('Hors ligne : relief, bâtiments et plan vectoriel indisponibles, vue à plat.');
  st = await glState(map);
  expect(st.layers).not.toContain('gf-buildings');
  await context.setOffline(false);
  await expect.poll(async () => (await glState(map)).terrain, SLOW).toBe(true);
  expect(seen.problems).toEqual([]);
});

test('le relief injoignable : la 3D continue à plat et le dit', async ({ app, page }) => {
  test.slow();
  const seen = await watch(page);
  await answerTiles(page, { dem: 'fail' });
  await settings(page, { renderer: '3d', buildings: false, hillshade: false });
  await app.open('#/collections');
  const spot = await seedPlaces(page);
  await app.go(`#/map?spot=${spot}`);
  const map = carte(page);
  await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 30_000 });
  await expect.poll(async () => (await glState(map)).terrain, { timeout: 20_000 }).toBe(false);
  await expect(map.locator('.gf-gl-note')).toContainText('Relief injoignable : vue à plat.');
  await expect(map.locator('.gf-gl-mk .gf-place')).toHaveCount(2);
  expect(seen.problems).toEqual([]);
});

test('l’étape « Jusqu’où part l’expédition ? » reste vue de dessus, en 2D, même en 3D', async ({ app, page, context }) => {
  await answerAround(context);
  const seen = await watch(page);
  await settings(page, { renderer: '3d' });
  await app.open('#/app/rencontres');
  await page.getByRole('button', { name: 'Autour de moi' }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/app/rencontres/map');
  const map = page.locator('ma-distance gf-map');
  await expect(map.locator('.leaflet-container')).toBeVisible();
  await expect(map).toHaveAttribute('data-renderer', '2d');
  await page.waitForTimeout(1000);
  expect(seen.maplibre).toEqual([]);
  await expect(map.locator('canvas.maplibregl-canvas')).toHaveCount(0);
  expect(seen.problems).toEqual([]);
});

test('fiche plante : sa carte principale en 3D, une carte ajoutée reste en 2D (un seul contexte WebGL)', async ({ app, page }) => {
  test.slow();
  const seen = await watch(page);
  await answerTiles(page);
  await settings(page, { renderer: '3d', buildings: false, hillshade: false, pitch: 30 });
  await app.open('#/collections');
  await seedPlaces(page);
  // A second map block in the sheet (Mode King's « + Carte »).
  await page.evaluate(async () => { (await import('/app/core/sheet-blocks.js')).createMap('Ma carte'); });
  await app.go(`#/plant/${plantId('Urtica dioica')}`);
  const maps = page.locator('gf-sheet-map gf-map');
  await expect(maps).toHaveCount(2, { timeout: 20_000 });
  const main = page.locator('gf-sheet-map:not([map-3d="off"]) gf-map');
  const added = page.locator('gf-sheet-map[map-3d="off"] gf-map');
  await main.scrollIntoViewIfNeeded();
  await expect(main).toHaveAttribute('data-renderer', '3d', { timeout: 30_000 });
  await expect(main.locator('.gf-gl-mk .gf-plant, .gf-gl-mk .gf-place').first()).toBeAttached();
  await expect(added).toHaveAttribute('data-renderer', '2d');
  await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(1);
  // The whole 3D: relief, tilt, sky, its layers (the block's own background).
  const st = await glState(main);
  expect(st.terrain).toBe(true);
  expect(st.sky).toBe(true);
  expect(st.pitch).toBe(30);
  expect(st.tiles.length).toBeGreaterThan(0);
  // 2D again in Réglages: the sheet's map follows at once.
  await page.evaluate(async () => { (await import('/app/core/map-settings.js')).setMapSettings({ renderer: '2d' }); });
  await expect(main).toHaveAttribute('data-renderer', '2d');
  await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(0);
  expect(seen.problems).toEqual([]);
});
