// Every map in 3D (gf-map-gl.js): the maps' one choice « 3D », in Réglages › Cartes or a map's panel « Carte ». Real WebGL (SwiftShader,
// as in map3d.spec.mjs), every tile made here (tiles.mjs: the IGN's photos and plan, the relief, a block of buildings),
// never the network. The Carte in MapLibre with its relief, the same layers as in 2D, the options (buildings, sky,
// globe) switched from its panel, its markers clickable; 2D by default, MapLibre never asked then; no 2D ⇄ 3D
// button on the maps (the choice is in their panel: maps-panel3d.spec.mjs); back in 2D while positions are edited; the ways it stays in 2D or flat (no WebGL2, modules off, offline);
// the « Jusqu’où part l’expédition ? » step always from above; one WebGL map per plant sheet. A free layout's map in
// 3D: its pins all there, never faded, over the observations around as the view turns and tilts; the binoculars
// around its zone (r=3km), one circle; a point's card over everything; its groups not made again by a fraction of a
// zoom. Why a map is in 2D or flat is its state (the panel's « État », said once by its live region), never a note
// over it (quiet.mjs).
import { test, expect, plantId, answerAround, answerObservations } from './fixtures.mjs';
import { answerTiles } from './tiles.mjs';
import { mapSaid, mapState } from './quiet.mjs';
import { longPress } from './touch.mjs';

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
  // The photos, the names over them (the roads, the rivers, the places' names: core/map-layers.js LANDMARK_DEFAULTS).
  expect(st.tiles.map((/** @type {any} */ t) => t.key)).toEqual(['photo', 'routes', 'eau', 'lieux']);
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
  // MapLibre's buttons in French (its compass; the 2D one hidden with the 2D map), the canvas reachable by keyboard.
  const compass = map.locator('.maplibregl-ctrl-compass');
  await expect(compass).toHaveAttribute('aria-label', /Revenir au nord/);
  await expect(map.locator('.gf-compass')).toBeHidden();
  await expect(map.locator('canvas.maplibregl-canvas')).toHaveAttribute('aria-label', /Carte en 3D/);
  // Shift + arrows: rotate and tilt (MapLibre's keyboard).
  await map.locator('canvas.maplibregl-canvas').focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await glState(map)).bearing, SLOW).not.toBe(0);
  // The wheel pressed and dragged orbits (as in any 3D tool): sideways turns, downwards tilts more.
  if (!test.info().project.name.startsWith('phone')) {
    // Once the turn of Shift + → is over (MapLibre eases it).
    let before = await glState(map);
    await expect.poll(async () => { const was = before; await page.waitForTimeout(400); before = await glState(map); return before.bearing === was.bearing && before.pitch === was.pitch; }, SLOW).toBe(true);
    const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await map.locator('canvas.maplibregl-canvas').boundingBox());
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 20, { steps: 6 });
    await page.mouse.up({ button: 'middle' });
    await expect.poll(async () => Math.abs((await glState(map)).bearing - before.bearing + 48) <= 1, SLOW).toBe(true);
    expect(Math.abs((await glState(map)).pitch - before.pitch - 10)).toBeLessThanOrEqual(1);
  }
  // MapLibre's compass touched: the north again, and flat (its own behaviour).
  let settled = await glState(map);
  await expect.poll(async () => { const was = settled; await page.waitForTimeout(400); settled = await glState(map); return settled.bearing === was.bearing && settled.pitch === was.pitch; }, SLOW).toBe(true);
  await compass.click();
  await expect.poll(async () => Math.abs((await glState(map)).bearing), SLOW).toBe(0);
  await expect.poll(async () => (await glState(map)).pitch, SLOW).toBe(0);

  // The places and plants of the 2D map, the same elements, on the relief; a plant clicked opens it.
  const plants = map.locator('.gf-gl-mk .gf-plant');
  await expect(plants).toHaveCount(3);
  await expect(map.locator('.gf-gl-mk .gf-place')).toHaveCount(2);
  await plants.first().dispatchEvent('click');
  await expect.poll(() => page.evaluate(() => location.hash)).toContain('focus=');

  // A long press (right click): « Poser un repère ici ? » with its ghost, as in 2D; confirmed, the reference and its card.
  const box = await map.locator('canvas.maplibregl-canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  if (app.phone) await longPress(page, box.x + box.width * 0.5, box.y + box.height * 0.6);
  else await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.6, { button: 'right' });
  const card = map.locator('gf-point-card');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Poser un repère ici ?' })).toBeVisible();
  await expect(map.locator('.gf-gl-mk .gf-ref.ghost')).toHaveCount(1);
  await card.getByRole('button', { name: 'Confirmer' }).click();
  await expect(card.getByRole('button', { name: 'Retirer le repère' })).toBeVisible();
  await expect(map.locator('.gf-gl-mk .gf-ref.ghost')).toHaveCount(0);
  await expect(map.locator('.gf-gl-mk .gf-ref')).toHaveCount(1);

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
  // IGN's layers by theme, each folded until opened.
  for (const key of ['relief', 'espaces']) await panel.locator(`details.theme[data-group="${key}"] > summary`).click();
  for (const name of ['Parcelles cadastrales', 'Courbes de niveau', 'Forêts publiques', 'Parcs nationaux', 'Réserves naturelles', 'Protection de biotope']) {
    await expect(panel.getByRole('checkbox', { name: new RegExp(name) })).toBeVisible();
  }
  // « Affichage »: the maps' one choice (3D, as Réglages say), its options folded; a link to Réglages › Cartes.
  await expect(panel.getByRole('group', { name: 'Carte en 2D ou en 3D' }).getByRole('radio', { name: /^3D/ })).toBeChecked();
  await expect(panel.getByRole('checkbox', { name: /Bâtiments en 3D/ })).toBeHidden();
  await panel.getByText('Options de la 3D').click();
  await expect(panel.getByRole('checkbox', { name: /Bâtiments en 3D/ })).toBeChecked();
  await expect(panel.getByRole('link', { name: 'Réglages › Cartes' })).toHaveAttribute('href', '#/settings');
  await expect(panel.getByRole('button', { name: /^(2D|3D)$/ })).toHaveCount(0);
  await panel.getByRole('checkbox', { name: /Courbes de niveau/ }).check();
  await expect.poll(async () => (await glState(map)).tiles.map((/** @type {any} */ t) => t.key), SLOW).toEqual(['photo', 'contours', 'routes', 'eau', 'lieux']);
  // The plan: its own names, none over it.
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
  // MapLibre's compass in 2D too (under + −): the north always up, touched, the map stays to the north.
  const compass = map.locator('.leaflet-bottom.leaflet-left .gf-compass');
  await expect(compass).toBeVisible();
  await expect(compass).toHaveAttribute('aria-label', 'Revenir au nord');
  await compass.click();
  await expect(map).toHaveAttribute('data-renderer', '2d');
  expect(await page.evaluate(() => location.hash)).not.toMatch(/#$/);

  // 3D in Réglages: the Carte follows.
  await page.evaluate(async () => { (await import('/app/core/map-settings.js')).setMapSettings({ renderer: '3d', buildings: false, pitch: 40 }); });
  await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 30_000 });
  await expect(map.locator('.gf-gl-mk .gf-place')).toHaveCount(2);
  await expect(map).toHaveAttribute('data-pitch', '40');
  await expect(map.getByRole('button', { name: /3D|2D/ })).toHaveCount(0);

  // Editing positions (markers dragged): in 2D for the time of it, said (its state, its live region; nothing over the
  // map); « Terminé »: 3D again.
  await map.getByRole('button', { name: 'Modifier les positions' }).click();
  await expect(map).toHaveAttribute('data-renderer', '2d');
  await expect.poll(() => mapState(map)).toContain('Modification des positions : carte en 2D le temps de l’édition.');
  await expect(mapSaid(map)).toContainText('Modification des positions : carte en 2D le temps de l’édition.');
  await expect(map.locator('.gf-gl-note')).toHaveCount(0);
  await expect(map.locator('canvas.maplibregl-canvas')).toHaveCount(0);
  await expect(map.locator('.leaflet-marker-pane .gf-place.editing')).toHaveCount(2);
  await map.locator('.gf-map-editbar').getByRole('button', { name: 'Terminé' }).click();
  await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 30_000 });
  await expect.poll(() => mapState(map), SLOW).not.toContain('Modification des positions : carte en 2D le temps de l’édition.');
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
  await expect.poll(() => mapState(map)).toContain('3D indisponible sur cet appareil (WebGL2 requis) : carte en 2D.');
  await expect(mapSaid(map)).toContainText('3D indisponible sur cet appareil (WebGL2 requis) : carte en 2D.');
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
  await expect.poll(() => mapState(map)).toContain('Fonds IGN désactivés : seules les zones déjà vues s’affichent.');
  await page.waitForTimeout(1500);
  expect(seen.tiles, 'no tile from the network').toEqual([]);

  // Modules back on, then offline: flat, said; no relief asked.
  await page.evaluate(async () => {
    const { setModule } = await import('/app/core/modules.js');
    setModule('relief3d', true);
    setModule('ignMaps', true);
  });
  await expect.poll(async () => (await glState(map)).terrain, SLOW).toBe(true);
  await context.setOffline(true);
  await expect.poll(async () => (await glState(map)).terrain, SLOW).toBe(false);
  await expect.poll(() => mapState(map)).toContain('Hors ligne : relief, bâtiments et plan vectoriel indisponibles, vue à plat.');
  await expect(mapSaid(map)).toContainText('Hors ligne : relief, bâtiments et plan vectoriel indisponibles, vue à plat.');
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
  await expect.poll(() => mapState(map)).toContain('Relief injoignable : vue à plat.');
  await expect(mapSaid(map)).toContainText('Relief injoignable : vue à plat.');
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
  // A second map block in the sheet (the sheet's « Bloc Carte », King).
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

/**
 * What lies at a point of the window, through the shadow roots (the layout's cells). An element that lets the pointer
 * through (a point's card) is asked as if it did not: what covers it is what is found.
 * @param {import('@playwright/test').Locator} card
 */
const onTop = card => card.evaluate(el => {
  const e = /** @type {HTMLElement} */ (el), r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  const was = e.style.pointerEvents;
  e.style.pointerEvents = 'auto';
  /** @type {Document | ShadowRoot} */ let root = document;
  /** @type {Element | null} */ let hit = null;
  for (;;) {
    const at = root.elementFromPoint(x, y);
    if (!at || at === hit) break;
    hit = at;
    if (!at.shadowRoot) break;
    root = at.shadowRoot;
  }
  e.style.pointerEvents = was;
  return Boolean(hit && e.contains(hit)) || (hit?.localName ?? 'nothing') + '.' + (hit?.className ?? '');
});

/** The page's markers in 3D: the area's points and the current plant's (their 2D elements in MapLibre's markers). @param {import('@playwright/test').Locator} map */
const pins = map => map.evaluate(m => [...m.querySelectorAll('.gf-gl-mk')].filter(w => w.querySelector(':scope > .gf-obs-leaf, :scope > .gf-occ-group'))
  .map(w => ({ opacity: getComputedStyle(w).opacity, z: Number(getComputedStyle(w).zIndex) })));

/** The rings drawn on the 3D map (the page's paths, gf-paths): each one's radius (m) around the zone's centre. @param {import('@playwright/test').Locator} map */
const rings = map => map.evaluate(async m => {
  const g = /** @type {any} */ (m), [lon, lat] = g.area.center;
  const data = await g.gl.glMap.getSource('gf-paths').getData();
  const metres = (/** @type {number[]} */ [x, y]) => {
    const r = Math.PI / 180, a = Math.sin((y - lat) * r / 2) ** 2 + Math.cos(lat * r) * Math.cos(y * r) * Math.sin((x - lon) * r / 2) ** 2;
    return 2 * 6371008.8 * Math.asin(Math.sqrt(a));
  };
  return data.features.filter((/** @type {any} */ f) => f.geometry.type === 'Polygon').map((/** @type {any} */ f) => Math.round(metres(f.geometry.coordinates[0][0])));
});

test('une carte de la disposition en 3D : ses points tous là quand la vue tourne et s’incline, estompés derrière le relief comme MapLibre le fait ; avec les jumelles, un seul cercle ; la carte d’un point par-dessus tout', async ({ app, page }) => {
  test.slow();
  const seen = await watch(page);
  await answerTiles(page);
  await answerObservations(page, { taxa: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // The relief on (MapLibre fades a marker it finds behind it), the map tilted.
  await settings(page, { renderer: '3d', buildings: false, hillshade: false, sky: false, pitch: 30 });
  const nettle = plantId('Urtica dioica');
  await app.open(`#/layout/[map(r=3km,3d=1,jumelles=inat+gbif),plant]?p=${nettle}&at=45.7772,3.087`);
  const map = page.locator('dl-map gf-map');
  await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 30_000 });
  /** @returns {Promise<any>} */
  const obs = () => map.evaluate(m => /** @type {any} */ (m).gl.state().obs3d);

  // The binoculars around the zone: its radius (3 km, between two of their stops), no ring of their own — the zone's
  // is there, their wall on it: one circle (and its shadow) on the map.
  await expect.poll(async () => (await obs())?.why, SLOW).toBe('area');
  await expect.poll(async () => (await obs()).points, SLOW).toBeGreaterThan(0);
  let st = await obs();
  expect(st.radius).toBe(3000);
  expect(st.ring).toBe(false);
  let layers = (await glState(map)).layers;
  expect(layers).toEqual(expect.arrayContaining(['gf-o3-wall', 'gf-o3-seeds']));
  expect(layers).not.toContain('gf-o3-zone-line');
  expect(layers).not.toContain('gf-o3-zone-fill');
  await expect.poll(() => rings(map), SLOW).toHaveLength(2);
  for (const r of await rings(map)) expect(Math.abs(r - 3000)).toBeLessThan(30);
  await expect(map.locator('.gf-o3-chip')).toContainText('3 km');
  // The page's own points not again among theirs (the same records: iNaturalist's, the zone's).
  await expect.poll(() => map.evaluate(m => /** @type {any} */ (m).area?.points?.length ?? 0), SLOW).toBeGreaterThan(0);
  await expect.poll(async () => (await obs()).kinds.inat, SLOW).toBe(0);

  // The page's markers (the zone's points, the current plant's), once all there: as many, over the observations
  // around, however the view turns and tilts — faded only where the relief hides one (MapLibre's default opacities).
  await expect.poll(async () => (await pins(map)).length, SLOW).toBeGreaterThan(10);
  let count = 0;
  await expect.poll(async () => { const was = count; await page.waitForTimeout(500); count = (await pins(map)).length; return count === was; }, SLOW).toBe(true);
  const o3 = await map.evaluate(m => Math.max(0, ...[...m.querySelectorAll('.gf-o3-mk')].map(e => Number(getComputedStyle(e).zIndex) || 0)));
  for (const [bearing, pitch] of [[60, 55], [150, 75], [-120, 85], [-30, 40]]) {
    await map.evaluate((m, v) => /** @type {any} */ (m).gl.glMap.jumpTo(v), { bearing, pitch });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const now = await pins(map);
    expect(now, `turned ${bearing}°, tilted ${pitch}°`).toHaveLength(count);
    expect(now.filter(p => p.opacity !== '1' && p.opacity !== '0.2'), `turned ${bearing}°, tilted ${pitch}°`).toEqual([]);
    expect(Math.min(...now.map(p => p.z))).toBeGreaterThan(o3);
  }
  expect((await glState(map)).pitch).toBe(40);

  // A point's card, hovered (touched on a phone): over everything — the markers, the map's controls, the page.
  if (!app.phone) {
    const pin = map.locator('.gf-gl-mk:has(> .gf-obs-leaf:not(.hl))').first();
    await pin.dispatchEvent('mouseenter');
    const tip = map.locator('.gf-float-tip.on');
    await expect(tip.locator('.gf-obs-card')).toBeVisible();
    expect(await onTop(tip)).toBe(true);
    await pin.dispatchEvent('mouseleave');
    await expect(tip).toHaveCount(0);
  }
  const mark = map.locator('.gf-o3-mk:not(.group)').first();
  await expect(mark).toBeAttached(SLOW);
  if (app.phone) await mark.dispatchEvent('click'); else await mark.dispatchEvent('mouseenter');
  const card = map.locator('.gf-o3-card');
  await expect(card.locator('.gf-obs-card')).toBeVisible();
  expect(await card.evaluate(c => c.matches(':popover-open'))).toBe(true);
  expect(await onTop(card)).toBe(true);
  if (app.phone) await card.getByRole('button', { name: 'Fermer' }).click(); else await mark.dispatchEvent('mouseleave');
  await expect(card).toHaveCount(0);

  // Their slider moves the zone (its handle's way): 5 km — the zone's, theirs with it, still one circle; no radius
  // of their own written in the address (they follow the zone).
  // Its chip touched for real: on a phone the map's credits, long here, run over it — a touch goes through them.
  await map.locator('.gf-o3-chip').click();
  const panel = map.locator('.gf-o3-panel');
  await expect(panel.locator('.gf-o3-value')).toHaveText('3 km');
  await expect(panel).toContainText('Autour de la zone de la page');
  await panel.getByRole('slider', { name: 'Rayon autour du centre' }).fill('4');
  await expect.poll(() => page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] || '').get('r'))).toBe('5km');
  await expect.poll(async () => (await obs()).radius, SLOW).toBe(5000);
  await expect.poll(async () => (await rings(map)).every(r => Math.abs(r - 5000) < 50), SLOW).toBe(true);
  expect(await rings(map)).toHaveLength(2);
  layers = (await glState(map)).layers;
  expect(layers).not.toContain('gf-o3-zone-line');
  expect(decodeURIComponent(await page.evaluate(() => location.hash))).not.toContain('jrayon');
  st = await obs();
  expect(st.on).toBe(true);
  expect(seen.problems).toEqual([]);
});

test('une carte de la disposition en 3D, la plante courante en groupes : tourner, incliner, zoomer d’une fraction ne refait aucun de ses marqueurs', async ({ app, page }) => {
  test.slow();
  const seen = await watch(page);
  await answerTiles(page);
  await answerObservations(page, { taxa: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await settings(page, { renderer: '3d', relief: false, buildings: false, hillshade: false, sky: false, pitch: 30 });
  await app.open(`#/layout/[map(r=3km,3d=1,regroupe),plant]?p=${plantId('Urtica dioica')}&at=45.7772,3.087`);
  const map = page.locator('dl-map gf-map');
  await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 30_000 });
  const marks = map.locator('.gf-gl-mk > .gf-occ-group, .gf-gl-mk > .gf-obs-leaf.hl');
  await expect.poll(() => marks.count(), SLOW).toBeGreaterThan(2);
  let count = 0;
  await expect.poll(async () => { const was = count; await page.waitForTimeout(500); count = await marks.count(); return count === was; }, SLOW).toBe(true);
  // Each marker known by its element: the same ones after the view moved (none made again, none gone).
  await marks.evaluateAll(els => els.forEach((e, i) => { /** @type {any} */ (e).gfSeen = i + 1; }));
  const z = await map.evaluate(m => /** @type {any} */ (m).gl.glMap.getZoom());
  // A fraction of a zoom that keeps the 2D map's whole zoom (MapLibre's is one less).
  const whole = Math.round(z + 1), to = whole - 1 + (z + 1 - whole > 0 ? -0.2 : 0.2);
  for (const v of [{ bearing: 70, pitch: 60 }, { zoom: to }, { bearing: -40, pitch: 80, zoom: (z + to) / 2 }]) {
    await map.evaluate((m, view) => /** @type {any} */ (m).gl.glMap.jumpTo(view), v);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const now = await marks.evaluateAll(els => els.map(e => /** @type {any} */ (e).gfSeen ?? 0));
    expect(now, JSON.stringify(v)).toHaveLength(count);
    expect(now.filter(n => !n), JSON.stringify(v)).toEqual([]);
  }
  expect(seen.problems).toEqual([]);
});
