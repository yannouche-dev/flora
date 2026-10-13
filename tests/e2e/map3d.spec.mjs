// « Vue 3D » (gf-map3d.js): the recap of a parcours opens its walk on the relief, MapLibre loaded on demand only.
// Headless Chromium has WebGL2 here (SwiftShader, software); --enable-unsafe-swiftshader keeps it so where newer
// releases would stop falling back to it. The real path is tested: MapLibre loaded, the map drawn, its markers, the
// tilt, 2D ⇄ 3D, Échap, the focus given back; the tiles come from here (a green picture for the IGN's photos, a
// Terrarium tile of a slope for the relief), never from the network. Then the ways it does not open, or opens flat:
// no WebGL2 (the button says so, MapLibre never asked), the relief out of reach (flat, said), the module off.
import { test, expect, plantId } from './fixtures.mjs';
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });

/** Where the screenshots of the view go, when asked (MAP3D_SHOTS=dir). */
const SHOTS = process.env.MAP3D_SHOTS || '';

// ---------- Tiles made here: a PNG encoder, enough for 256 × 256 RGB ----------

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
/** @param {Buffer} buf */
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** @param {string} type @param {Buffer} data */
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** A 256 × 256 RGB PNG, each pixel from `rgb(x, y)`. @param {(x: number, y: number) => [number, number, number]} rgb */
function png(rgb) {
  const raw = Buffer.alloc(256 * (1 + 256 * 3));
  for (let y = 0; y < 256; y++) {
    const row = y * (1 + 256 * 3);
    for (let x = 0; x < 256; x++) raw.set(rgb(x, y), row + 1 + x * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(256, 0); ihdr.writeUInt32BE(256, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** Aerial photo: green fields, a darker grid. */
const PHOTO = png((x, y) => (x % 64 < 3 || y % 64 < 3 ? [70, 110, 60] : [120 + (x >> 3), 160, 100 + (y >> 3)]));
/** Terrarium: height = R × 256 + G + B / 256 − 32768; a slope from 1 500 m to some 2 300 m across each tile. */
const TERRARIUM = png((x, y) => { const h = 1500 + x * 2 + y + 32768; return [h >> 8, h & 255, 0]; });

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
    let p = c.newPlace(start, { name: 'Vers le lac Blanc', notes: 'Parcours botanique' });
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

/** IGN photos and the relief answered from here. @param {import('@playwright/test').Page} page @param {{ dem?: 'ok' | 'fail' }} [o] */
async function tiles(page, { dem = 'ok' } = {}) {
  await page.route(/^https:\/\/data\.geopf\.fr\/wmts\?.*REQUEST=GetTile/i, route => route.fulfill({ contentType: 'image/png', body: PHOTO }));
  await page.route(/^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\//, route =>
    dem === 'ok' ? route.fulfill({ contentType: 'image/png', body: TERRARIUM, headers: { 'access-control-allow-origin': '*' } }) : route.abort('internetdisconnected'));
}

/** The recap of the seeded parcours. @param {import('./app.mjs').App} app @param {import('@playwright/test').Page} page */
async function openRecap(app, page) {
  await app.open('#/collections');
  await seedWalk(page);
  // The Parcours mini-app: its recap (« Vue 3D » over its map), in its box.
  await app.open('#/app/parcours');
  const button = page.locator('gf-trail .recap-map .map3d');
  await expect(button).toBeVisible();
  return button;
}

test('la Vue 3D du parcours : MapLibre à la demande, les plantes sur le relief, 2D ⇄ 3D, Échap', async ({ app, page }, info) => {
  // WebGL in software (SwiftShader): every frame of the relief is drawn by the CPU.
  test.slow();
  const seen = await watch(page);
  await tiles(page);
  const button = await openRecap(app, page);
  // Never at startup: MapLibre is asked only when the view opens.
  expect(seen.maplibre).toEqual([]);

  await button.click();
  const dialog = page.locator('dialog.gf-map3d');
  await expect(dialog).toHaveAttribute('open', '');
  await expect(dialog).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  expect(seen.maplibre).toEqual(expect.arrayContaining(['/vendor/maplibre/maplibre-gl.mjs', '/vendor/maplibre/maplibre-gl-worker.mjs', '/vendor/maplibre/maplibre-gl.css']));
  await expect(dialog.locator('canvas.maplibregl-canvas')).toHaveCount(1);
  await expect(dialog).toHaveAttribute('data-terrain', 'on');
  await expect(dialog.locator('#gf3d-title')).toContainText('Vers le lac Blanc');

  // Each plant on the ground, its altitude (the IGN's, kept with it); the start of the walk.
  const pins = dialog.locator('.gf3d-pin');
  await expect(pins).toHaveCount(3);
  await expect(pins.locator('.alt')).toHaveText([/^1\s?964 m$/, /^2\s?051 m$/, /^2\s?143 m$/]);
  await expect(dialog.locator('.gf3d-start')).toHaveText(/^Départ · 1\s?877 m$/);
  // The attribution: IGN and the relief's sources.
  await expect(dialog.locator('.maplibregl-ctrl-attrib-inner')).toContainText('IGN');
  await expect(dialog.locator('.maplibregl-ctrl-attrib-inner')).toContainText('Terrain Tiles (Mapzen · EU-DEM © Copernicus)');
  // French controls.
  await expect(dialog.locator('.maplibregl-ctrl-zoom-in')).toHaveAttribute('aria-label', 'Zoomer');

  // Tilted, the relief under it.
  await expect(dialog).toHaveAttribute('data-pitch', '60', { timeout: 10_000 });
  await expect(dialog).toHaveAttribute('data-view', '3d');
  // A plant's card.
  await pins.first().click();
  await expect(dialog.locator('.maplibregl-popup .gf3d-card')).toContainText('Altitude');
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.waitForTimeout(1500);
    writeFileSync(`${SHOTS}/map3d-${info.project.name}.png`, await page.screenshot());
  }
  await dialog.locator('.maplibregl-popup-close-button').click();

  // 2D: from above, flat; and back.
  await dialog.getByRole('button', { name: '2D', exact: true }).click();
  await expect(dialog).toHaveAttribute('data-pitch', '0', { timeout: 10_000 });
  await expect(dialog.getByRole('button', { name: '2D', exact: true })).toHaveAttribute('aria-pressed', 'true');
  if (SHOTS) writeFileSync(`${SHOTS}/map3d-2d-${info.project.name}.png`, await page.screenshot());
  await dialog.getByRole('button', { name: '3D', exact: true }).click();
  await expect(dialog).toHaveAttribute('data-pitch', '60', { timeout: 10_000 });

  // Échap closes it: the map removed, the focus back on the button.
  await page.keyboard.press('Escape');
  await expect(dialog).not.toHaveAttribute('open', '');
  await expect(dialog.locator('.gf3d-canvas > *')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el?.className;
  })).toBe('map3d');

  // Opened again: one map, one view.
  await button.click();
  await expect(dialog).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  await expect(page.locator('gf-map3d')).toHaveCount(1);
  await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(1);
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
  await button.click();
  await expect(page.locator('gf-trail .note3d')).toHaveText('3D indisponible sur cet appareil (WebGL2 requis).');
  await expect(page.locator('dialog.gf-map3d[open]')).toHaveCount(0);
  expect(seen.maplibre).toEqual([]);
  // The recap is still there, working.
  await expect(page.locator('gf-trail .recap-map gf-map')).toBeVisible();
  expect(seen.problems).toEqual([]);
});

test('relief injoignable : la vue s’ouvre à plat et le dit', async ({ app, page }) => {
  const seen = await watch(page);
  await tiles(page, { dem: 'fail' });
  const button = await openRecap(app, page);
  await button.click();
  const dialog = page.locator('dialog.gf-map3d');
  await expect(dialog).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  await expect(dialog).toHaveAttribute('data-terrain', 'off');
  await expect(dialog.locator('.gf3d-note')).toHaveText('Relief injoignable : vue à plat.');
  await expect(dialog.locator('.gf3d-pin')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toHaveAttribute('open', '');
  expect(seen.problems).toEqual([]);
});

test('hors ligne : pas de relief demandé, la vue à plat', async ({ app, page, context }) => {
  const seen = await watch(page);
  await tiles(page);
  /** @type {string[]} */
  const dem = [];
  page.on('request', r => { if (r.url().includes('elevation-tiles-prod')) dem.push(r.url()); });
  const button = await openRecap(app, page);
  // MapLibre already fetched once (as after a first opening online: kept by the service worker).
  await button.click();
  const dialog = page.locator('dialog.gf-map3d');
  await expect(dialog).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  await page.keyboard.press('Escape');
  dem.length = 0;
  await context.setOffline(true);
  await button.click();
  await expect(dialog).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  await expect(dialog).toHaveAttribute('data-terrain', 'off');
  await expect(dialog.locator('.gf3d-note')).toHaveText('Hors ligne : pas de relief, vue à plat.');
  expect(dem).toEqual([]);
  await page.keyboard.press('Escape');
  await context.setOffline(false);
  expect(seen.problems).toEqual([]);
});

test('module « Vue 3D (relief) » désactivé, photos coupées : le bouton l’explique ; Mes plantes ouvre la vue sans photo', async ({ app, page }) => {
  const seen = await watch(page);
  await tiles(page);
  await page.addInitScript(() => localStorage.setItem('geoflora.modules', JSON.stringify({ relief3d: false, photos: false })));
  const button = await openRecap(app, page);
  await button.click();
  await expect(page.locator('gf-trail .note3d')).toContainText('Vue 3D désactivée');
  await expect(page.locator('dialog.gf-map3d[open]')).toHaveCount(0);
  expect(seen.maplibre).toEqual([]);

  // Back on: from the parcours in Mes plantes; « Photos en ligne » off, the leaves only.
  await page.evaluate(async () => {
    const { setModule } = await import('/app/core/modules.js');
    for (const mode of ['epure', 'standard', 'scientific']) setModule('relief3d', /** @type {any} */ (mode), true);
  });
  const id = await page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.trailDone') || 'null'));
  await app.go(`#/spot/${id}`);
  const open3d = page.locator('gf-spot-editor button.map3d');
  await expect(open3d).toBeVisible();
  await open3d.click();
  const dialog = page.locator('dialog.gf-map3d');
  await expect(dialog).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  await expect(dialog.locator('.gf3d-pin')).toHaveCount(3);
  await expect(dialog.locator('.gf3d-pin .glyph')).toHaveCount(3);
  await expect(dialog.locator('.gf3d-pin img')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toHaveAttribute('open', '');
  expect(seen.problems).toEqual([]);
});
