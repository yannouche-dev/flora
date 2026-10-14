// The step « map » of the games around a place (kit/ma-distance.js over components/gf-map.js, area.smooth): the card
// at the bottom of the map, in its middle; the circle still on the screen for the whole step (the map's middle, its
// centre a fifth of the map's height above the card), the map zooming under it — the place under its centre, the
// distance chosen to its edge (a larger one: a lower zoom); the slider's stops (a dot each,
// ← → one stop, Home / End, its value said in words); a slow iNaturalist: the points shown stay (dimmed) while
// « Recherche des observations… », then the new ones; a quick run of changes asks only for the last distance; and
// every point that has a photo shows it after any run of changes (the photos of points gone no longer hold up the
// browser's few connections to the photos' host).
import http from 'node:http';
import { test, expect, answerAround } from './fixtures.mjs';

/** @typedef {import('@playwright/test').Page} Page */

test.use({ reducedMotion: 'no-preference' });
test.beforeEach(({ context }) => answerAround(context));

const hash = (/** @type {Page} */ page) => page.evaluate(() => location.hash);

/**
 * iNaturalist's observations in the circle, answered by this page: `n` points spread in it (each radius its own),
 * after `delay(radius)` ms; each asked radius counted. `photo(radius, i)`: a point's photo address (none: no photo).
 * @param {Page} page @param {{ n?: number, delay?: (r: number) => number, photo?: (r: number, i: number) => string | null }} [o]
 */
async function answerPoints(page, { n = 30, delay = () => 0, photo = () => null } = {}) {
  /** @type {number[]} */
  const asked = [];
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\?/, async route => {
    const r = Number(new URL(route.request().url()).searchParams.get('radius'));
    asked.push(r);
    await new Promise(done => setTimeout(done, delay(r)));
    const results = Array.from({ length: n }, (_, i) => {
      const a = i * 2.39996, d = (0.15 + 0.8 * ((i * 37) % n) / n) * r / 111.32;
      const url = photo(r, i);
      return { id: Math.round(r * 1000) * 1000 + i, observed_on: '2026-05-01', geojson: { coordinates: [2.35 + Math.cos(a) * d / 0.658, 48.85 + Math.sin(a) * d] },
        // The plant's photo: its taxon's (a point never shows the observation's own); a plant the flora does not know.
        taxon: { id: 1000 + (i % 12), name: 'Plante', preferred_common_name: 'Ortie', ...(url ? { default_photo: { square_url: url, license_code: 'cc-by', attribution: '(c) Anne' } } : {}) },
        photos: [] };
    });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ total_results: n * 3, results }) }).catch(() => {});
  });
  return asked;
}

/** Rencontres' step « map » (a returning visitor: « Autour de moi »). @param {import('./app.mjs').App} app @param {Page} page */
async function toMap(app, page) {
  await app.open('#/app/rencontres');
  await page.getByRole('button', { name: 'Autour de moi' }).click();
  await expect.poll(() => hash(page)).toBe('#/app/rencontres/map');
  await expect(page.locator('ma-distance svg.gf-ring circle.gf-area')).toHaveCount(1);
}

const PLACE = /** @type {[number, number]} */ ([2.35, 48.85]);

/** Metres between two [lon, lat] (haversine, as Leaflet measures). @param {number[]} a @param {number[]} b */
function metres([lon1, lat1], [lon2, lat2]) {
  const rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/**
 * The ring, the map and the card (px, the window's), the zoom, where the place is drawn and the place at the ring's
 * right edge — once the map no longer moves. @param {Page} page
 */
async function layout(page) {
  /** @returns {Promise<any>} */
  const read = () => page.locator('ma-distance').evaluate((el, place) => {
    const root = /** @type {ShadowRoot} */ (el.shadowRoot);
    const box = (/** @type {string} */ sel) => { const r = /** @type {Element} */ (root.querySelector(sel)).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
    const ring = box('svg.gf-ring circle.gf-area'), map = box('gf-map');
    const m = /** @type {any} */ (root.querySelector('gf-map'));
    const cx = (ring.left + ring.right) / 2, cy = (ring.top + ring.bottom) / 2, r = (ring.right - ring.left) / 2;
    return { ring: { x: cx, y: cy, r }, map, card: box('.welcome'), zoom: m.zoom(), place: m.pointOf(place), edge: m.placeAt(cx - map.left + r, cy - map.top) };
  }, PLACE);
  let last = '';
  await expect.poll(async () => { const now = JSON.stringify(await read()); const same = now === last; last = now; return same; }, { intervals: [300] }).toBe(true);
  return JSON.parse(last);
}

/**
 * The ring where it stands: in the middle of the map's width (the card's middle too), its centre a fifth of the map's
 * height above the card (a quarter of it from the top at least), its radius 54 % of the map's height (42 % of its width
 * at most); the place under its centre, the distance chosen from its centre to its edge (±3 %).
 * @param {any} l @param {number} radius
 */
function ringed(l, radius) {
  const w = l.map.right - l.map.left, h = l.map.bottom - l.map.top;
  expect(Math.abs(l.ring.x - (l.map.left + w / 2)), 'the ring in the middle of the map').toBeLessThanOrEqual(2);
  expect(Math.abs((l.card.left + l.card.right) / 2 - l.ring.x), 'the card in the middle of the map').toBeLessThanOrEqual(2);
  expect(Math.abs(l.ring.y - Math.max(l.map.top + 0.25 * h, l.card.top - 0.2 * h)), 'a fifth of the map above the card').toBeLessThanOrEqual(2);
  expect(Math.abs(l.ring.r - Math.min(0.54 * h, 0.42 * w))).toBeLessThanOrEqual(2);
  expect(Math.abs(l.place.x + l.map.left - l.ring.x), 'the place under the centre').toBeLessThanOrEqual(1.5);
  expect(Math.abs(l.place.y + l.map.top - l.ring.y), 'the place under the centre').toBeLessThanOrEqual(1.5);
  expect(Math.abs(metres(PLACE, l.edge) - radius) / radius, 'the distance chosen fills the ring').toBeLessThanOrEqual(0.03);
}

test('le cercle immobile au-dessus de la carte, la carte zoome dessous : le lieu au centre, la distance au bord', async ({ app, page }) => {
  await answerPoints(page);
  await toMap(app, page);
  const first = await layout(page);
  ringed(first, 1000);
  const slider = page.locator('ma-distance input[type="range"]');
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuetext', '2 kilomètres');
  const wider = await layout(page);
  ringed(wider, 2000);
  expect(wider.ring).toEqual(first.ring);
  expect(wider.zoom).toBeLessThan(first.zoom);
  await page.keyboard.press('End');
  const widest = await layout(page);
  ringed(widest, 50000);
  expect(widest.ring).toEqual(first.ring);
  expect(widest.zoom).toBeLessThan(wider.zoom);
  await page.keyboard.press('Home');
  await expect(slider).toHaveAttribute('aria-valuetext', '200 mètres');
  const closest = await layout(page);
  ringed(closest, 200);
  expect(closest.ring).toEqual(first.ring);
  expect(closest.zoom).toBeGreaterThan(first.zoom);
  // The view is the ring's: no dragging it away.
  const box = /** @type {any} */ (await page.locator('ma-distance gf-map').boundingBox());
  await page.mouse.move(box.x + 40, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 240, box.y + 260, { steps: 6 });
  await page.mouse.up();
  ringed(await layout(page), 200);
});

test('le curseur : un point par palier, ← → d’un palier, Début / Fin, sa valeur dite en mots', async ({ app, page }) => {
  await answerPoints(page);
  await toMap(app, page);
  const card = page.locator('ma-distance .welcome');
  const slider = card.locator('input[type="range"]');
  await expect(card.locator('.range .stop')).toHaveCount(8);
  await expect(card.locator('.range .stop.on')).toHaveCount(3);
  await expect(slider).toHaveAttribute('aria-valuetext', '1 kilomètre');
  await expect(card.locator('.range .mark.cur')).toHaveText('1 km');
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveValue('3');
  await expect(slider).toHaveAttribute('aria-valuetext', '2 kilomètres');
  await expect(card.locator('output')).toHaveText('2 km');
  await expect(card.locator('.mood')).toHaveText('Une balade à pied');
  await expect(card.locator('.range .stop.on')).toHaveCount(4);
  await page.keyboard.press('End');
  await expect(slider).toHaveAttribute('aria-valuetext', '50 kilomètres');
  await expect(card.locator('.mood')).toHaveText('Toute la région');
  await page.keyboard.press('Home');
  await expect(slider).toHaveAttribute('aria-valuetext', '200 mètres');
  await expect(card.locator('.mood')).toHaveText('Juste devant la porte');
  // The labels never overlap (the narrow card shows the main ones only).
  const marks = await card.locator('.range .mark').evaluateAll(els => els.filter(e => getComputedStyle(e).display !== 'none').map(e => { const r = e.getBoundingClientRect(); return [r.left, r.right]; }));
  expect(marks.length).toBeGreaterThanOrEqual(4);
  for (let i = 1; i < marks.length; i++) expect(marks[i][0]).toBeGreaterThan(marks[i - 1][1] + 2);
  const range = await card.locator('.range').boundingBox();
  expect(marks[0][0]).toBeGreaterThanOrEqual(/** @type {any} */ (range).x - 1);
  expect(marks[marks.length - 1][1]).toBeLessThanOrEqual(/** @type {any} */ (range).x + /** @type {any} */ (range).width + 1);
});

test('iNaturalist lent : les points restent, estompés, pendant « Recherche des observations… », puis les nouveaux', async ({ app, page }) => {
  await answerPoints(page, { delay: r => r === 2 ? 2000 : 0 });
  await toMap(app, page);
  const map = page.locator('ma-distance gf-map');
  const dots = map.locator('.leaflet-marker-pane .gf-obs-leaf:not(.gf-leave)');
  await expect(dots).toHaveCount(30);
  const before = await dots.evaluateAll(els => els.map(e => /** @type {HTMLElement} */ (e).style.transform));
  await page.locator('ma-distance input[type="range"]').focus();
  await page.keyboard.press('ArrowRight');
  const line = page.locator('ma-distance .obs');
  await expect(line).toHaveText('Recherche des observations…');
  await expect(line.locator('.spin')).toHaveCount(1);
  await expect(map.locator('.leaflet-container')).toHaveClass(/gf-area-loading/);
  // The points of before still there, dimmed.
  await page.waitForTimeout(800);
  await expect(dots).toHaveCount(30);
  expect(Number(await dots.first().locator('.pop').evaluate(e => getComputedStyle(e).opacity))).toBeLessThan(0.6);
  await expect(line).toHaveText('90 observations de plantes — les 30 plus récentes sur la carte', { timeout: 5000 });
  await expect(map.locator('.leaflet-container')).not.toHaveClass(/gf-area-loading/);
  await expect(dots).toHaveCount(30);
  const after = await dots.evaluateAll(els => els.map(e => /** @type {HTMLElement} */ (e).style.transform));
  expect(after).not.toEqual(before);
  await expect.poll(() => dots.first().locator('.pop').evaluate(e => Number(getComputedStyle(e).opacity))).toBe(1);
});

test('des changements rapides : seule la dernière distance est demandée', async ({ app, page }) => {
  const asked = await answerPoints(page);
  await toMap(app, page);
  await expect(page.locator('ma-distance .obs')).toContainText('observations de plantes');
  expect(asked).toEqual([1]);
  // The slider dragged: 2, 5, 10 then back to 5 km, each a moment after the other (a hand's pace, under the 250 ms).
  await page.locator('ma-distance input[type="range"]').evaluate(async el => {
    const input = /** @type {HTMLInputElement} */ (el);
    for (const v of ['3', '4', '5', '4']) {
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      await new Promise(done => setTimeout(done, 60));
    }
  });
  await expect(page.locator('ma-distance input[type="range"]')).toHaveAttribute('aria-valuetext', '5 kilomètres');
  await expect(page.locator('ma-distance .obs')).toContainText('observations de plantes', { timeout: 5000 });
  await page.waitForTimeout(600);
  expect(asked).toEqual([1, 5]);
});

test.describe('les photos des points', () => {
  /** A host of photos as slow as a real one, over HTTP/1.1 (the browser asks it only a few at a time). @type {http.Server} */
  let server;
  let port = 0;
  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#c0392b"/></svg>';
      setTimeout(() => { res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=3600' }); res.end(svg); }, 400 + (Number(req.url?.match(/(\d)\/square/)?.[1]) || 0) * 30);
    });
    await new Promise(done => server.listen(0, '127.0.0.1', () => done(undefined)));
    port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  });
  test.afterAll(() => new Promise(done => server.close(() => done(undefined))));

  test('après plusieurs distances (iNaturalist lent), chaque point qui a une photo la montre ; les autres, la feuille', async ({ app, page }) => {
    await page.route(new RegExp(`^http://127\\.0\\.0\\.1:${port}/`), route => route.continue());
    // Each distance its own observations; every 7th without a photo.
    await answerPoints(page, { n: 60, delay: r => r === 1 ? 0 : 600, photo: (r, i) => i % 7 === 3 ? null : `http://127.0.0.1:${port}/photos/${Math.round(r * 10)}0${i}/square.jpg` });
    await toMap(app, page);
    const slider = page.locator('ma-distance input[type="range"]');
    await slider.focus();
    for (const key of ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'ArrowRight', 'ArrowRight']) {
      await page.keyboard.press(key);
      await page.waitForTimeout(900);
    }
    await expect(slider).toHaveAttribute('aria-valuetext', '20 kilomètres');
    await expect(page.locator('ma-distance .obs')).toContainText('observations de plantes');
    const dots = page.locator('ma-distance .leaflet-marker-pane .gf-obs-leaf:not(.gf-leave)');
    await expect(dots).toHaveCount(60);
    /** Of the points shown: those with a photo, those whose photo shows, those without any (a leaf each). */
    const photos = () => dots.evaluateAll(els => {
      const out = { photo: 0, shown: 0, leaf: 0, blank: 0 };
      for (const el of els) {
        const img = el.querySelector('img');
        if (el.classList.contains('gf-obs-photo')) {
          out.photo++;
          if (img && img.complete && img.naturalWidth > 0 && img.classList.contains('in') && getComputedStyle(img).visibility !== 'hidden') out.shown++;
        } else if (el.querySelector('svg')) out.leaf++;
        else out.blank++;
      }
      return out;
    });
    await expect.poll(photos, { timeout: 15_000 }).toEqual({ photo: 51, shown: 51, leaf: 9, blank: 0 });
  });
});
