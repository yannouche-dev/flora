// The observations around a place on the maps in 3D (components/gf-map-obs3d.js): real WebGL (SwiftShader, as in
// maps3d.spec.mjs), every tile and every source answered here (tiles.mjs, fixtures.mjs answerObservations). The
// button of a 3D map shows iNaturalist's and GBIF's observations inside a circle around the view's centre — only those
// inside, GBIF's copy of iNaturalist left out; the radius from the stepped slider (asked again, kept for that map);
// the markers touched (a group: closer; a point: its card); the density's columns; a long press, a new centre; the
// cache offline; and in 2D, nothing of it. Quiet (quiet.mjs): its radius and count are the chip's (its name for the
// count) and its card's, said by the map's live region — no radius pill on the ground, no count badge over the map.
import { test, expect, answerObservations } from './fixtures.mjs';
import { answerTiles } from './tiles.mjs';
import { mapSaid } from './quiet.mjs';
import { longPress } from './touch.mjs';

test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });
// Software WebGL draws every pixel on the CPU: a smaller window on the desktop, from above-ish, flat, no flights.
test.beforeEach(async ({ page }, info) => {
  if (info.project.name.startsWith('desktop')) await page.setViewportSize({ width: 1024, height: 680 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

/** Software WebGL is slow: a change of style may take its time. */
const SLOW = { timeout: 30_000 };
/** What the 3D map's observations say (gf-map-obs3d.js state()). @param {import('@playwright/test').Locator} map */
const obs = map => map.evaluate(m => /** @type {any} */ (m).gl.state().obs3d);
/** The Carte's map. @param {import('@playwright/test').Page} page */
const carte = page => page.locator('gf-map-page gf-map');

/**
 * A place of the user's in the circle (one plant in it): the Carte has something to show (no « Aucun lieu » over it).
 * @param {import('@playwright/test').Page} page
 */
function seedPlace(page) {
  return page.evaluate(async () => {
    const col = await import('/app/core/collections.js');
    let p = col.newPlace([3.0890, 45.7790], { name: 'Jardin Lecoq' });
    p = col.withPlant(p, { id: 1, scientificName: 'Urtica dioica' }, { coordinates: [3.0892, 45.7791], accuracy: 5 });
    await col.savePlace(p);
  });
}

/**
 * The Carte in 3D, flat, over Clermont-Ferrand (zoom 14), the console's errors kept.
 * @param {import('@playwright/test').Page} page @param {Record<string, any>} [around] what the Carte's map kept (geoflora.around3d)
 */
async function open3d(page, around) {
  /** @type {string[]} */ const problems = [];
  page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(m.text()); });
  await page.addInitScript(a => {
    if (sessionStorage.getItem('gf-obs3d-set')) return;
    sessionStorage.setItem('gf-obs3d-set', '1');
    localStorage.setItem('geoflora.maps3d', JSON.stringify({ renderer: '3d', relief: false, buildings: false, hillshade: false, sky: false, pitch: 30 }));
    localStorage.setItem('geoflora.mapView', JSON.stringify({ lat: 45.7772, lng: 3.087, zoom: 14 }));
    if (a) localStorage.setItem('geoflora.around3d', JSON.stringify({ 'gf-map-page': a }));
  }, around);
  return problems;
}

test('en 3D, « Observations autour » : iNaturalist et GBIF dans le cercle seulement ; le rayon, les marqueurs, la densité, un nouveau centre', async ({ app, page }) => {
  test.slow();
  /** @type {string[]} */ const asked = [];
  await answerTiles(page);
  await answerObservations(page, { seen: asked });
  const problems = await open3d(page);
  await app.open('#/collections');
  await seedPlace(page);
  await app.go('#/map');
  const map = carte(page);
  await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 30_000 });
  expect(asked, 'nothing asked before the button').toEqual([]);

  // The button, with the map's others: the circle around the view's centre, its points.
  const button = map.getByRole('button', { name: 'Observations autour', exact: true });
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await obs(map)).points, SLOW).toBeGreaterThan(0);
  let st = await obs(map);
  expect(st.why).toBe('view');
  expect(st.radius).toBe(2000);
  expect(st.center[0]).toBeCloseTo(3.087, 2);
  // 60 of iNaturalist's and 24 of GBIF's in the circle, 6 of each beyond it; GBIF's copy of an iNaturalist one left
  // out; the user's plant in it.
  expect(st.kinds).toEqual({ inat: 60, gbif: 23, mine: 1 });
  expect(st.farthest).toBeLessThanOrEqual(2000);
  expect(st.failed).toEqual([]);
  // iNaturalist's of every quality grade (none asked).
  const inat = asked.filter(u => /api\.inaturalist\.org\/v1\/observations\?lat=45\.777\d+&lng=3\.08\d+&radius=2\.00&iconic_taxa=Plantae&/.test(u));
  expect(inat.length).toBeGreaterThan(0);
  expect(inat.every(u => !new URL(u).searchParams.has('quality_grade'))).toBe(true);
  expect(asked.some(u => /api\.gbif\.org\/v1\/occurrence\/search\?taxonKey=6&.*geoDistance=45\.777\d%2C3\.08\d+%2C2\.00km/.test(u))).toBe(true);
  // Its circle, its wall and its seeds in the 3D map's style; the nearest points as markers (the 2D markers, standing).
  const layers = await map.evaluate(m => /** @type {any} */ (m).gl.state().layers);
  expect(layers).toEqual(expect.arrayContaining(['gf-o3-zone-line', 'gf-o3-wall', 'gf-o3-wall-rim', 'gf-o3-seeds']));
  expect(layers).not.toContain('gf-o3-hex');
  await expect.poll(async () => (await obs(map)).markers, SLOW).toBeGreaterThan(0);
  st = await obs(map);
  expect(st.onMarkers + st.seeds).toBe(st.points);
  await expect(map.locator('.gf-o3-mk .gf-obs-leaf').first()).toBeAttached();
  // The radius: the chip's (no pill left on the ground); the count: in its name, said by the map — not a badge.
  await expect(map.locator('.gf-o3-rlabel')).toHaveCount(0);
  const chip = map.locator('.gf-o3-chip');
  await expect(chip).toContainText('2 km');
  await expect(chip).not.toContainText('84');
  await expect(chip).toHaveAttribute('aria-label', /^Observations autour : 2 kilomètres, 84 observations\./);
  await expect(mapSaid(map)).toContainText('Observations autour : 84 observations dans le cercle');

  // The plant a page shows (its highlight): its observations lit, markers before any other.
  await map.evaluate(m => { /** @type {any} */ (m).highlight = { key: 'hl', points: [], sci: 'Urtica dioica', common: 'Ortie dioïque' }; });
  await expect.poll(async () => (await obs(map)).lit).toEqual(['s:urtica dioica']);
  await expect(map.locator('.gf-o3-mk.lit .gf-obs-leaf.chosen').first()).toBeAttached(SLOW);
  await map.evaluate(m => { /** @type {any} */ (m).highlight = null; });
  await expect(map.locator('.gf-o3-mk.lit')).toHaveCount(0, SLOW);

  // A marker touched: a group, closer to it; a point alone, its card (the 2D card: its name, its photo's credit).
  const zoom = await map.evaluate(m => /** @type {any} */ (m).gl.glMap.getZoom());
  const group = map.locator('.gf-o3-mk.group').first();
  if (await group.count()) {
    await group.dispatchEvent('click');
    await expect.poll(() => map.evaluate(m => /** @type {any} */ (m).gl.glMap.getZoom()), SLOW).toBeGreaterThan(zoom + 1);
  }
  const single = map.locator('.gf-o3-mk:not(.group)').first();
  await expect(single).toBeAttached(SLOW);
  await single.dispatchEvent('click');
  const card = map.locator('.gf-o3-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.gf-obs-card b')).not.toBeEmpty();
  await card.getByRole('button', { name: 'Fermer' }).click();
  await expect(map.locator('.gf-o3-card.pinned')).toHaveCount(0);

  // The slider: 5 km — asked again for the new circle, kept for this map.
  await chip.click();
  const panel = map.locator('.gf-o3-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Autour du centre de la vue');
  // Its count, in the card the user opened (its state: kept there); its long press, a hint once per device, and the
  // title of « Centrer ici ».
  await expect(panel.locator('.gf-o3-count')).toContainText('84 observations dans le cercle');
  await expect(panel.locator('.gf-o3-count')).not.toHaveAttribute('aria-live', /./);
  await expect(panel.locator('.hint-once')).toContainText('Appui long sur la carte, puis « Confirmer » : un repère, nouveau centre.');
  await expect(panel.getByRole('button', { name: 'Centrer ici' })).toHaveAttribute('title', /appui long sur la carte : un repère, nouveau centre/);
  await panel.locator('.hint-once').getByRole('button', { name: 'Masquer l’astuce' }).click();
  await expect(panel.locator('.hint-once')).toHaveCount(0);
  const slider = panel.getByRole('slider', { name: 'Rayon autour du centre' });
  await expect(slider).toHaveAttribute('aria-valuetext', '2 kilomètres');
  await slider.fill('4');
  await expect.poll(async () => (await obs(map)).radius).toBe(5000);
  await expect.poll(() => asked.some(u => /radius=5\.00/.test(u)), SLOW).toBe(true);
  await expect.poll(async () => (await obs(map)).farthest, SLOW).toBeGreaterThan(2000);
  st = await obs(map);
  expect(st.farthest).toBeLessThanOrEqual(5000);
  await expect(chip).toContainText('5 km');
  await expect(panel.locator('.gf-o3-value')).toHaveText('5 km');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.around3d') || '{}')['gf-map-page'])).toMatchObject({ on: true, radius: 5000 });

  // GBIF off: iNaturalist's alone.
  await panel.locator('.gf-o3-toggle', { hasText: 'GBIF' }).locator('input').uncheck();
  await expect.poll(async () => (await obs(map)).kinds, SLOW).toEqual({ inat: 60, gbif: 0, mine: 1 });
  await panel.locator('.gf-o3-toggle', { hasText: 'GBIF' }).locator('input').check();
  await expect.poll(async () => (await obs(map)).kinds.gbif, SLOW).toBe(23);

  // The density: columns in place of the markers, touched they say how many.
  await panel.locator('.gf-o3-toggle', { hasText: 'Densité' }).locator('input').check();
  await expect.poll(async () => (await obs(map)).hexes, SLOW).toBeGreaterThan(3);
  await expect.poll(() => map.evaluate(m => /** @type {any} */ (m).gl.state().layers.includes('gf-o3-hex')), SLOW).toBe(true);
  expect(await map.evaluate(m => /** @type {any} */ (m).gl.state().layers.includes('gf-o3-seeds'))).toBe(false);
  await expect(map.locator('.gf-o3-mk')).toHaveCount(0);
  await panel.locator('.gf-o3-toggle', { hasText: 'Densité' }).locator('input').uncheck();
  await expect.poll(async () => (await obs(map)).markers, SLOW).toBeGreaterThan(0);
  await chip.click();
  await expect(panel).toHaveCount(0);

  // A long press (a right click): « Poser un repère ici ? » — the circle stays until it is confirmed, then goes there.
  const box = await map.locator('canvas.maplibregl-canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  const before = (await obs(map)).center;
  if (app.phone) await longPress(page, box.x + box.width * 0.3, box.y + box.height * 0.35);
  else await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.35, { button: 'right' });
  const question = map.locator('gf-point-card');
  await expect(question.getByRole('heading', { name: 'Poser un repère ici ?' })).toBeVisible();
  expect((await obs(map)).center).toEqual(before);
  await question.getByRole('button', { name: 'Confirmer' }).click();
  await expect.poll(async () => (await obs(map)).why, SLOW).toBe('reference');
  st = await obs(map);
  expect(st.center).not.toEqual(before);
  expect(st.center).toEqual(await map.evaluate(m => /** @type {any} */ (m).reference));
  await expect.poll(async () => (await obs(map)).loading, SLOW).toBe(false);
  expect((await obs(map)).farthest).toBeLessThanOrEqual(5000);

  // Off: nothing of it left on the map; kept off.
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(map.locator('.gf-o3-mk')).toHaveCount(0);
  await expect.poll(() => map.evaluate(m => /** @type {any} */ (m).gl.state().layers.some((/** @type {string} */ l) => l.startsWith('gf-o3-'))), SLOW).toBe(false);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.around3d') || '{}')['gf-map-page'].on)).toBe(false);
  expect(problems).toEqual([]);
});

test('en 3D, ce que la carte a gardé revient à l’ouverture ; hors ligne, les observations en cache', async ({ app, page, context }) => {
  test.slow();
  /** @type {string[]} */ const asked = [];
  await answerTiles(page);
  await answerObservations(page, { seen: asked, inat: 20, gbif: 10 });
  const problems = await open3d(page, { on: true, radius: 1000, gbif: false });
  await app.open('#/collections');
  await seedPlace(page);
  await app.go('#/map');
  const map = carte(page);
  await expect(map).toHaveAttribute('data-renderer', '3d', { timeout: 30_000 });
  await expect(map.getByRole('button', { name: 'Observations autour', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await obs(map)).points, SLOW).toBe(21);
  const st = await obs(map);
  expect(st.radius).toBe(1000);
  expect(st.sources).toEqual({ inat: true, gbif: false });
  expect(asked.some(u => u.includes('api.gbif.org'))).toBe(false);
  expect(asked.some(u => /radius=1\.00/.test(u))).toBe(true);

  // Offline: off and on again, the same circle from the cache.
  await context.setOffline(true);
  const button = map.getByRole('button', { name: 'Observations autour', exact: true });
  await button.click();
  await expect.poll(async () => (await obs(map)).on).toBe(false);
  const count = asked.length;
  await button.click();
  await expect.poll(async () => (await obs(map)).points, SLOW).toBe(21);
  expect((await obs(map)).failed).toEqual([]);
  expect(asked.length, 'from the cache').toBe(count);
  await context.setOffline(false);
  expect(problems).toEqual([]);
});

test('en 2D, rien de tout cela : ni bouton, ni requête, même gardé « affiché »', async ({ app, page }) => {
  /** @type {string[]} */ const asked = [];
  await answerObservations(page, { seen: asked });
  await page.addInitScript(() => {
    localStorage.setItem('geoflora.mapView', JSON.stringify({ lat: 45.7772, lng: 3.087, zoom: 14 }));
    localStorage.setItem('geoflora.around3d', JSON.stringify({ 'gf-map-page': { on: true, radius: 2000 } }));
  });
  await app.open('#/map');
  const map = carte(page);
  await expect(map.locator('.leaflet-container')).toBeVisible();
  await expect(map).toHaveAttribute('data-renderer', '2d');
  await expect(map.getByRole('button', { name: 'Me localiser' })).toBeVisible();
  await expect(map.getByRole('button', { name: 'Observations autour', exact: true })).toHaveCount(0);
  await page.waitForTimeout(1000);
  await expect(map.locator('.gf-o3-mk, .gf-o3-bar')).toHaveCount(0);
  expect(asked).toEqual([]);
});
