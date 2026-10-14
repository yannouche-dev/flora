// The photos of the map's points: each its plant's photo, never the observation's own — its taxon's under a free
// licence, else the plant's thumbnail from the flora (plants.json), as the plant chosen's points always showed (most
// iNaturalist photos are under its default licence, CC BY-NC, never shown: the points were leaves) — with no plant
// chosen, after a heart (the plant chosen: its points lit) and after its ↺ (none chosen again). Hovered, a point's card
// shows that photo too. Only a plant the flora does not know (and without a free photo) stays a leaf.
import { test, expect, answerAround, plantId } from './fixtures.mjs';

/** @typedef {import('@playwright/test').Page} Page */

test.use({ reducedMotion: 'no-preference' });
test.skip(({ isMobile }) => isMobile, 'hover: a pointer');
test.beforeEach(({ context }) => answerAround(context));

/** The plants around, as fixtures.mjs answers them (taxon 1000 + rank); the 13th unknown to the flora. */
const NAMES = ['Urtica dioica', 'Allium ursinum', 'Conium maculatum', 'Geum urbanum', 'Taraxacum officinale', 'Quercus robur',
  'Hedera helix', 'Galium aparine', 'Plantago lanceolata', 'Bellis perennis', 'Ranunculus acris', 'Trifolium repens'];
const NC = { license_code: 'cc-by-nc', attribution: '(c) Anne, some rights reserved (CC BY-NC)' };
const FREE = { license_code: 'cc-by', attribution: '(c) Anne' };

/**
 * iNaturalist's observations: 40 points in the circle, of the 12 plants and one the flora does not know (2 of them);
 * their own photos under CC BY or CC BY-NC (never shown either way), their taxa's under CC BY-NC but the nettle's
 * (1000) under CC BY. A plant's own (taxon_id): 6 points, the same way. @param {Page} page
 */
async function answerPoints(page) {
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\?/, route => {
    const taxon = Number(new URL(route.request().url()).searchParams.get('taxon_id')) || 0;
    const n = taxon ? 6 : 40;
    const results = Array.from({ length: n }, (_, i) => {
      const unknown = !taxon && i % 20 === 19, t = taxon || (unknown ? 2000 : 1000 + (i % 12));
      const name = unknown ? 'Plantus ignotus' : NAMES[t - 1000];
      return {
        id: (taxon || 7) * 100 + i, observed_on: '2026-05-01',
        geojson: { coordinates: [2.35 + ((i % 8) - 3.5) * 0.0011, 48.85 + (Math.floor(i / 8) - 2) * 0.0009] },
        taxon: { id: t, name, preferred_common_name: null, default_photo: { square_url: `https://inaturalist-open-data.s3.amazonaws.com/photos/9${t}/square.jpg`, ...(t === 1000 ? FREE : NC) } },
        photos: [{ id: i, url: `https://inaturalist-open-data.s3.amazonaws.com/photos/${(taxon || 7) * 100 + i}/square.jpg`, ...(i % 2 ? FREE : NC) }]
      };
    });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ total_results: n, results }) });
  });
}

/** The points in the map's view, those whose photo shows (loaded, faded in), those of a plant chosen. @param {Page} page */
const inView = page => page.locator('ma-distance').evaluate(host => {
  const root = /** @type {ShadowRoot} */ (host.shadowRoot);
  const box = /** @type {Element} */ (root.querySelector('.leaflet-container')).getBoundingClientRect();
  const out = { points: 0, shown: 0, chosen: 0, own: 0, nettle: 0 };
  for (const el of root.querySelectorAll('.leaflet-marker-pane .gf-obs-leaf:not(.gf-leave)')) {
    const r = el.getBoundingClientRect();
    if (r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom) continue;
    const img = el.querySelector('img');
    out.points++;
    if (el.classList.contains('hl')) out.chosen++;
    // An observation's own photo (never shown); the nettle's taxon photo (free: shown).
    const src = img?.dataset.src || '';
    if (/\/photos\/\d{3,4}\//.test(src)) out.own++;
    if (src.includes('/photos/91000/')) out.nettle++;
    if (img && img.complete && img.naturalWidth > 0 && img.classList.contains('in')) out.shown++;
  }
  return out;
});

/** At least 90 % of the points in view show a photo (here: all but the unknown plant's). @param {Page} page @param {string} when */
async function mostShown(page, when) {
  await expect.poll(async () => {
    const p = await inView(page);
    return p.points >= 20 && p.shown >= 0.9 * p.points ? 'ok' : JSON.stringify(p);
  }, { message: `photos shown (${when})`, timeout: 8000, intervals: [250] }).toBe('ok');
}

/** A point of the map hovered (one of the flora's plants, without a free photo of its own): its card shows a photo. @param {Page} page */
async function hoverCard(page) {
  const point = page.locator('ma-distance .leaflet-marker-pane .gf-obs-leaf:not(.gf-leave):not(.hl) img[data-src*="wikimedia"]').first();
  await point.evaluate(img => /** @type {Element} */ (img.closest('.leaflet-marker-icon')).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  const photo = page.locator('ma-distance .gf-float-tip.on .gf-obs-card img');
  await expect(photo).toHaveAttribute('src', /wikimedia/);
  await expect.poll(() => photo.evaluate(img => /** @type {HTMLImageElement} */ (img).complete && /** @type {HTMLImageElement} */ (img).naturalWidth > 0)).toBe(true);
  await expect(page.locator('ma-distance .gf-float-tip.on .gf-obs-card .credit')).toContainText('Photo :');
  await point.evaluate(img => /** @type {Element} */ (img.closest('.leaflet-marker-icon')).dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
}

test('chaque point : la photo de sa plante (jamais celle de l’observation), sans plante choisie, avec, puis sans — et dans sa carte au survol', async ({ app, page }) => {
  await answerPoints(page);
  await app.open('#/app/rencontres');
  await page.getByRole('button', { name: 'Autour de moi' }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/app/rencontres/map');
  await expect(page.locator('ma-distance .leaflet-marker-pane .gf-obs-leaf')).toHaveCount(40);
  // No plant chosen: every point of the flora's plants has a photo (its own under CC BY, else the flora's), the
  // unknown plant's two a leaf; none of the CC BY-NC photos.
  await mostShown(page, 'no plant chosen');
  expect(await page.locator('ma-distance .leaflet-marker-pane .gf-obs-leaf:not(.gf-obs-photo)').count()).toBe(2);
  expect(await inView(page)).toMatchObject({ own: 0, nettle: 4 });
  await hoverCard(page);

  // The cards, then a heart: the plant chosen's points lit — the others keep their photos.
  await page.locator('ma-distance').getByRole('button', { name: 'Qui pousse par ici ?' }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/app/rencontres/cards');
  await expect(page.locator('ma-deck .swipe-card.top')).toHaveAttribute('data-id', String(plantId('Allium ursinum')));
  await mostShown(page, 'the cards');
  await page.locator('ma-deck .round.like').click();
  await expect(page.locator('ma-distance .leaflet-marker-pane .gf-obs-leaf.hl.chosen')).toHaveCount(6);
  await mostShown(page, 'a plant chosen');
  await hoverCard(page);

  // Its ↺: no plant chosen again, the photos stay.
  await page.locator('ma-deck .round.undo').click();
  await expect(page.locator('ma-distance .leaflet-marker-pane .gf-obs-leaf.hl.chosen')).toHaveCount(0);
  await mostShown(page, 'none chosen again');
  await hoverCard(page);
});
