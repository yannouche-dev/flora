// The launch: the page's own launch screen (index.html .gf-boot: the logo, « GeoFlora », a status for screen
// readers), shown while the modules load and gone — hidden, taking no click — once the app is there; and what
// Android and iOS draw before it, from the manifest and index.html: the icons (sizes, a maskable one), the name, the id.
import { test, expect } from './fixtures.mjs';

test('l’écran de lancement : le logo et « GeoFlora » tant que l’app charge, puis plus rien sur son chemin', async ({ app, page }) => {
  // The modules held back: the launch screen is all there is.
  /** @type {() => void} */ let release = () => {};
  const held = new Promise(resolve => { release = () => resolve(undefined); });
  await page.route(/\/app\/main\.js(\?|$)/, async route => { await held; await route.fallback(); });
  // Not to « load »: the module scripts (deferred) hold DOMContentLoaded and load back.
  await page.goto('#/', { waitUntil: 'commit' });
  const boot = page.locator('.gf-boot');
  await expect(boot).toBeVisible();
  await expect(boot).toHaveAttribute('role', 'status');
  await expect(boot.locator('img[src="assets/icons/icon.svg"]')).toBeVisible();
  await expect(boot.locator('.gf-boot-name')).toHaveText('GeoFlora');
  await expect(boot).toContainText('Chargement de GeoFlora…');
  // The screen covers the page, centred: the logo in the middle of the screen.
  const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await boot.locator('img').boundingBox());
  const viewport = /** @type {{ width: number, height: number }} */ (page.viewportSize());
  expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2);
  expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(2);

  release();
  await app.ready();
  await expect(boot).toBeHidden();
  expect(await boot.evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
  // Nothing of it under a point of the app: a click there reaches the app.
  const hit = await page.evaluate(() => {
    const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return Boolean(el?.closest('.gf-boot')) || el?.localName;
  });
  expect(hit).toBe('gf-app');
  // Out of the accessibility tree: no second « status » announcing a load that is over.
  await expect(page.getByRole('status', { name: /Chargement de GeoFlora/ })).toHaveCount(0);
});

/** The width and height of a PNG, from its IHDR chunk. @param {Buffer} png */
const pngSize = png => {
  expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
};

test('le manifeste : nom, id, et des icônes qui existent à leur taille, dont une maskable', async ({ page, request, isMobile }) => {
  test.skip(isMobile, 'files only: one format is enough');
  const manifest = await (await request.get('manifest.webmanifest')).json();
  expect(manifest.name).toBe('GeoFlora');
  expect(manifest.short_name).toBe('GeoFlora');
  // The id an install already has (start_url, the site's root on GitHub Pages): a new one would be another app.
  expect(manifest.id).toBe('/flora/');
  expect(manifest.background_color).toBe('#f6f7f2');
  for (const icon of manifest.icons) {
    const response = await request.get(icon.src);
    expect(response.ok(), icon.src).toBe(true);
    if (icon.type === 'image/png') expect(pngSize(await response.body()), icon.src).toBe(icon.sizes);
  }
  const png = (/** @type {string} */ purpose) => manifest.icons.filter((/** @type {any} */ i) => i.type === 'image/png' && (i.purpose || 'any').split(' ').includes(purpose)).map((/** @type {any} */ i) => i.sizes);
  expect(png('any')).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(png('maskable')).toEqual(expect.arrayContaining(['192x192', '512x512']));
  // A maskable icon is opaque to its corners (the launcher's mask cuts them); an « any » one has room around its logo.
  const corner = async (/** @type {string} */ src) => page.evaluate(async url => {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext('2d'));
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, 1, 1).data[3];
  }, src);
  await page.goto('manifest.webmanifest');
  for (const icon of manifest.icons.filter((/** @type {any} */ i) => i.type === 'image/png')) {
    expect(await corner(icon.src), icon.src).toBe(icon.purpose === 'maskable' ? 255 : 0);
  }

  // index.html: the iOS home-screen icon (opaque, 180 px) and name.
  const html = await (await request.get('./')).text();
  const touch = /<link rel="apple-touch-icon"[^>]*href="([^"]+)"/.exec(html)?.[1];
  expect(touch).toBeTruthy();
  expect(pngSize(await (await request.get(/** @type {string} */ (touch))).body())).toBe('180x180');
  expect(html).toContain('<meta name="apple-mobile-web-app-title" content="GeoFlora" />');
});
