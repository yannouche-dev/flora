// « Vue 3D » (gf-map3d.js): the recap of a parcours (and a place of Mes plantes) opens its walk on the relief (a lieu that
// is no parcours: its plants only, no line) — the app's one map, gf-map, set to 3D (map-3d="on": its MapLibre renderer,
// gf-map-gl.js), MapLibre loaded on demand only.
// Headless Chromium has WebGL2 here (SwiftShader, software); --enable-unsafe-swiftshader keeps it so where newer
// releases would stop falling back to it. The real path is tested: MapLibre loaded, the map drawn, its plants (the
// same markers as every map), the walk, its start, a plant's altitude, Échap, the focus given back; the tiles come
// from here (tiles.mjs), never from the network. Then the ways it does not open, or opens flat: no WebGL2 (the button
// says so — a brief toast over the recap's map, its title —, MapLibre never asked), the relief out of reach (flat,
// said: the map's state and live region, never a note over it), offline, the module off.
import { test, expect, plantId } from './fixtures.mjs';
import { answerTiles } from './tiles.mjs';
import { brief, mapSaid, mapState } from './quiet.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });
// Software WebGL draws every pixel on the CPU: on the desktop, a smaller window keeps each frame (and the run) short.
test.beforeEach(async ({ page }, info) => { if (info.project.name.startsWith('desktop')) await page.setViewportSize({ width: 1024, height: 680 }); });

/** Where the screenshots of the view go, when asked (MAP3D_SHOTS=dir). */
const SHOTS = process.env.MAP3D_SHOTS || '';
/** Software WebGL is slow: a change may take its time. */
const SLOW = { timeout: 30_000 };

// ---------- A parcours ended, seeded in the page ----------

const START = /** @type {[number, number]} */ ([6.8925, 45.972]);
const STEPS = [
  { name: 'Urtica dioica', at: [6.8952, 45.9741], m: 1964, abundance: 'rare' },
  { name: 'Prunus spinosa', at: [6.8981, 45.9768], m: 2051, abundance: 'abondant' },
  { name: 'Achillea millefolium', at: [6.9013, 45.9789], m: 2143, abundance: 'moyen' }
];

/**
 * Saves a parcours started here, three plants on the way (each with its IGN altitude), and makes it the recap shown.
 * @param {import('@playwright/test').Page} page @returns {Promise<string>} its id
 */
async function seedWalk(page) {
  const steps = STEPS.map(s => ({ ...s, id: plantId(s.name) }));
  return page.evaluate(async ({ start, steps }) => {
    const c = await import('/app/core/collections.js');
    let p = c.newPlace(start, { name: 'Vers le lac Blanc', notes: 'Parcours botanique', walk: true });
    /** @type {any} */ (p.properties).startedHere = true;
    /** @type {any} */ (p.properties).altitude = { m: 1877, at: start };
    steps.forEach((s, i) => {
      p = c.withPlant(p, { id: s.id, scientificName: s.name }, { coordinates: s.at, accuracy: 5 }, { again: true });
      const e = /** @type {any} */ (p.properties.plants[p.properties.plants.length - 1]);
      e.altitude = { m: s.m, at: s.at };
      e.abundance = s.abundance;
      e.addedAt = new Date(Date.UTC(2026, 8, 12, 9, 10 * i)).toISOString();
    });
    const saved = await c.savePlace(p);
    localStorage.setItem('geoflora.trailDone', JSON.stringify(saved.id));
    return saved.id;
  }, { start: START, steps });
}

/**
 * The page's console errors and CSP violations, and every request for MapLibre's files.
 * @param {import('@playwright/test').Page} page
 */
async function watch(page) {
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const maplibre = [];
  // Not the browser's own lines for a request refused (the fixtures answer the app's services 503, as offline).
  page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push('console: ' + m.text()); });
  page.on('request', r => { if (r.url().includes('/vendor/maplibre/')) maplibre.push(new URL(r.url()).pathname); });
  await page.addInitScript(() => {
    addEventListener('securitypolicyviolation', e => console.error(`CSP ${e.violatedDirective} ${e.blockedURI}`));
  });
  return { problems, maplibre };
}

/** The recap of the seeded parcours. @param {import('./app.mjs').App} app @param {import('@playwright/test').Page} page */
async function openRecap(app, page) {
  await app.open('#/collections');
  await seedWalk(page);
  // The Parcours mini-app: its recap (« Vue 3D » over its map), in its box.
  await app.open('#/app/parcours');
  const button = page.locator('gf-miniapp .recap-map .map3d');
  await expect(button).toBeVisible();
  return button;
}

/** The map of the view. @param {import('@playwright/test').Page} page */
const viewMap = page => page.locator('dialog.gf-map3d gf-map');
/** What its 3D renderer says. @param {import('@playwright/test').Locator} map */
const glState = map => map.evaluate(m => /** @type {any} */ (m).gl.state());

/** Buildings drawn on the relief are slow in software WebGL, and there are none on a mountain path. @param {import('@playwright/test').Page} page */
const noBuildings = page => page.addInitScript(() => { if (!localStorage.getItem('geoflora.maps3d')) localStorage.setItem('geoflora.maps3d', JSON.stringify({ buildings: false, hillshade: false, pitch: 30 })); });

test('la Vue 3D du parcours : la carte de l’app en 3D, MapLibre à la demande, les plantes et la marche sur le relief, Échap', async ({ app, page }, info) => {
  test.slow();
  const seen = await watch(page);
  await answerTiles(page);
  await noBuildings(page);
  const button = await openRecap(app, page);
  // Never at startup, nor for the recap's map (2D, Réglages' default): MapLibre is asked only when the view opens.
  expect(seen.maplibre).toEqual([]);

  await button.click();
  const dialog = page.locator('dialog.gf-map3d');
  await expect(dialog).toHaveAttribute('open', '');
  const map = viewMap(page);
  await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 30_000 });
  expect(seen.maplibre).toEqual(expect.arrayContaining(['/vendor/maplibre/maplibre-gl.mjs', '/vendor/maplibre/maplibre-gl-worker.mjs', '/vendor/maplibre/maplibre-gl.css']));
  await expect(dialog.locator('canvas.maplibregl-canvas')).toHaveCount(1);
  await expect(dialog.locator('#gf3d-title')).toContainText('Vers le lac Blanc');
  // No 2D ⇄ 3D switch: a view in 3D (Réglages › Cartes set the rest).
  await expect(dialog.getByRole('button', { name: /^(2D|3D)$/ })).toHaveCount(0);

  // Its plants: the app's markers (their ring of abundance), on the relief; the walk; its start.
  await expect(map.locator('.gf-gl-mk .gf-plant')).toHaveCount(3);
  await expect(map.locator('.gf-gl-dot.gf-obs-start')).toHaveCount(1);
  let st = await glState(map);
  expect(st.terrain).toBe(true);
  expect(st.pitch).toBe(30);
  expect(st.paths).toBe(2);
  // The attribution: IGN and the relief's sources.
  await expect(map.locator('.leaflet-control-attribution')).toContainText('IGN');
  await expect(map.locator('.leaflet-control-attribution')).toContainText('Terrain Tiles (Mapzen · EU-DEM © Copernicus)');
  await expect(map.locator('.maplibregl-ctrl-compass')).toBeVisible();

  // A plant touched: its name and its altitude (the IGN's, kept with it).
  await map.locator('.gf-gl-mk .gf-plant').first().dispatchEvent('click');
  await expect(dialog.locator('.gf3d-card')).toContainText(/Altitude : (1|2)\s?\d{3} m \(IGN\)/);
  // Said by the map's one live region (the card has none of its own); no altitude pill following the pointer.
  await expect(mapSaid(map)).toContainText(/Altitude : (1|2)\s?\d{3} m \(IGN\)/);
  await expect(dialog.locator('.gf3d-card[role], .gf-gl-alt')).toHaveCount(0);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.waitForTimeout(1500);
    writeFileSync(`${SHOTS}/map3d-${info.project.name}.png`, await page.screenshot());
  }

  // Échap closes it: the map removed (its WebGL context given back), the focus back on the button.
  await page.keyboard.press('Escape');
  await expect(dialog).not.toHaveAttribute('open', '');
  await expect(dialog.locator('gf-map')).toHaveCount(0);
  await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el?.className;
  })).toBe('map3d');

  // Opened again: one map, one view.
  await button.click();
  await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 30_000 });
  await expect(page.locator('gf-map3d')).toHaveCount(1);
  await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(1);
  st = await glState(map);
  expect(st.terrain).toBe(true);
  await dialog.getByRole('button', { name: 'Fermer la vue 3D' }).click();
  await expect(dialog).not.toHaveAttribute('open', '');
  expect(seen.problems).toEqual([]);
});

test('sans WebGL2 : le bouton le dit, MapLibre n’est jamais demandé', async ({ app, page }) => {
  const seen = await watch(page);
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    // @ts-ignore -- this device has no WebGL2
    HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return kind === 'webgl2' ? null : get.call(this, kind, ...rest); };
  });
  const button = await openRecap(app, page);
  await expect(button).toHaveAttribute('title', '3D indisponible sur cet appareil (WebGL2 requis).');
  await button.click();
  // The user asked: one brief toast over the recap's map (gone in under 3 s), said by its live region.
  await expect(brief(page)).toHaveText('3D indisponible sur cet appareil (WebGL2 requis).');
  await expect(mapSaid(page.locator('gf-miniapp .recap-map gf-map'))).toContainText('3D indisponible sur cet appareil (WebGL2 requis).');
  await expect(brief(page)).toHaveCount(0, { timeout: 4000 });
  await expect(page.locator('dialog.gf-map3d[open]')).toHaveCount(0);
  expect(seen.maplibre).toEqual([]);
  // The recap is still there, working.
  await expect(page.locator('gf-miniapp .recap-map gf-map')).toBeVisible();
  expect(seen.problems).toEqual([]);
});

test('relief injoignable : la vue s’ouvre à plat et le dit', async ({ app, page }) => {
  test.slow();
  const seen = await watch(page);
  await answerTiles(page, { dem: 'fail' });
  await noBuildings(page);
  const button = await openRecap(app, page);
  await button.click();
  const map = viewMap(page);
  await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 30_000 });
  await expect.poll(async () => (await glState(map)).terrain, SLOW).toBe(false);
  await expect.poll(() => mapState(map)).toContain('Relief injoignable : vue à plat.');
  await expect(mapSaid(map)).toContainText('Relief injoignable : vue à plat.');
  await expect(map.locator('.gf-map-gl')).not.toContainText('Relief injoignable');
  await expect(map.locator('.gf-gl-mk .gf-plant')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog.gf-map3d')).not.toHaveAttribute('open', '');
  expect(seen.problems).toEqual([]);
});

test('hors ligne : pas de relief demandé, la vue à plat', async ({ app, page, context }) => {
  test.slow();
  const seen = await watch(page);
  await answerTiles(page);
  await noBuildings(page);
  /** @type {string[]} */
  const dem = [];
  page.on('request', r => { if (r.url().includes('elevation-tiles-prod')) dem.push(r.url()); });
  const button = await openRecap(app, page);
  // MapLibre already fetched once (as after a first opening online: kept by the service worker).
  await button.click();
  const map = viewMap(page);
  await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 30_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(0);
  dem.length = 0;
  await context.setOffline(true);
  await button.click();
  await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 30_000 });
  expect((await glState(map)).terrain).toBe(false);
  await expect.poll(() => mapState(map)).toContain('Hors ligne : relief, bâtiments et plan vectoriel indisponibles, vue à plat.');
  await expect(mapSaid(map)).toContainText('Hors ligne : relief, bâtiments et plan vectoriel indisponibles, vue à plat.');
  expect(dem).toEqual([]);
  await page.keyboard.press('Escape');
  await context.setOffline(false);
  expect(seen.problems).toEqual([]);
});

test('module « Vue 3D (relief) » désactivé, photos coupées : le bouton l’explique ; Mes plantes ouvre la vue sans photo — sans trait pour un lieu qui n’est pas un parcours', async ({ app, page }) => {
  test.slow();
  const seen = await watch(page);
  await answerTiles(page);
  await noBuildings(page);
  await page.addInitScript(() => localStorage.setItem('geoflora.modules', JSON.stringify({ relief3d: false, photos: false })));
  const button = await openRecap(app, page);
  await button.click();
  await expect(brief(page)).toContainText('Vue 3D désactivée');
  await expect(button).toHaveAttribute('title', /Vue 3D désactivée/);
  await expect(page.locator('dialog.gf-map3d[open]')).toHaveCount(0);
  expect(seen.maplibre).toEqual([]);

  // Back on: from the parcours in Mes plantes; « Photos en ligne » off, the leaves only.
  await page.evaluate(async () => {
    const { setModule } = await import('/app/core/modules.js');
    setModule('relief3d', true);
  });
  const id = await page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.trailDone') || 'null'));
  await app.go(`#/spot/${id}`);
  const open3d = page.locator('gf-spot-editor button.map3d');
  await expect(open3d).toBeVisible();
  await open3d.click();
  const map = viewMap(page);
  await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 30_000 });
  await expect(map.locator('.gf-gl-mk .gf-plant')).toHaveCount(3);
  await expect(map.locator('.gf-gl-mk .gf-plant img')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog.gf-map3d')).not.toHaveAttribute('open', '');

  // A lieu that is no parcours: its plants on the relief, and no line drawn through them, no start.
  const plain = await page.evaluate(async ({ start, steps }) => {
    const c = await import('/app/core/collections.js');
    let p = c.newPlace(start, { name: 'Pré du lac' });
    for (const s of steps) p = c.withPlant(p, { id: s.id, scientificName: s.name }, { coordinates: s.at, accuracy: 5 }, { again: true });
    return (await c.savePlace(p)).id;
  }, { start: START, steps: STEPS.slice(0, 2).map(s => ({ ...s, id: plantId(s.name) })) });
  await app.go(`#/spot/${plain}`);
  await expect(open3d).toBeVisible();
  await open3d.click();
  await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 30_000 });
  await expect(map.locator('.gf-gl-mk .gf-plant')).toHaveCount(2);
  await expect(map.locator('.gf-gl-dot.gf-obs-start')).toHaveCount(0);
  expect((await glState(map)).paths).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog.gf-map3d')).not.toHaveAttribute('open', '');
  expect(seen.problems).toEqual([]);
});
