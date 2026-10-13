// Inside a mini-app, no way out to another site (app/miniapp/quiet-links.js): on the step « map », a point touched or
// clicked opens nothing — its small card only (hovered with a mouse, touched on a phone, reached with the keyboard;
// Échap, the mouse gone, a touch on the map hide it). In every screen of the games, each link to another origin left
// is a credit a licence asks for (rel="license" / "author", in a credit line or the map's attribution) or the
// emergency's (the poison centres, 15, 112); outside the mini-apps the plant's sheet keeps its links to its sources.
import { test, expect, plantId, answerAround } from './fixtures.mjs';

/** @typedef {import('@playwright/test').Page} Page */

test.use({ reducedMotion: 'reduce' });
test.beforeEach(async ({ context }) => {
  await answerAround(context);
  // window.open spied: nothing opened by the page.
  await context.addInitScript(() => {
    /** @type {any} */ (window).__opened = [];
    window.open = (/** @type {any} */ url) => { /** @type {any} */ (window).__opened.push(String(url)); return null; };
  });
});

const hash = (/** @type {Page} */ page) => page.evaluate(() => location.hash);
const opened = (/** @type {Page} */ page) => page.evaluate(() => /** @type {any} */ (window).__opened);

/** iNaturalist's observations around: 20 points near the place, each with its photo. @param {Page} page */
async function answerPoints(page) {
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\?/, route => {
    const results = Array.from({ length: 20 }, (_, i) => ({
      id: 500 + i, uri: `https://www.inaturalist.org/observations/${500 + i}`, observed_on: '2026-05-0' + (1 + (i % 9)),
      geojson: { coordinates: [2.35 + ((i % 5) - 2) * 0.003, 48.85 + (Math.floor(i / 5) - 1.5) * 0.002] },
      taxon: { id: 1000 + i, name: 'Urtica dioica', preferred_common_name: 'Ortie' },
      photos: [{ id: i, url: `https://inaturalist-open-data.s3.amazonaws.com/photos/${900 + i}/square.jpg`, license_code: 'cc-by', attribution: '(c) Anne Martin' }]
    }));
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ total_results: 20, results }) });
  });
}

/** Rencontres' step « map ». @param {import('./app.mjs').App} app @param {Page} page */
async function toMap(app, page) {
  await answerPoints(page);
  await app.open('#/app/rencontres');
  await page.getByRole('button', { name: 'Autour de moi' }).click();
  await expect.poll(() => hash(page)).toBe('#/app/rencontres/map');
  await expect(page.locator('ma-distance .leaflet-marker-pane .gf-obs-photo')).toHaveCount(20);
}

/** The index of a point well in view, above the card (none under it). @param {Page} page */
const pointInView = page => page.locator('ma-distance').evaluate(el => {
  const root = /** @type {ShadowRoot} */ (el.shadowRoot);
  const card = /** @type {Element} */ (root.querySelector('.welcome')).getBoundingClientRect();
  const dots = [...root.querySelectorAll('.leaflet-marker-pane .gf-obs-photo')];
  return dots.findIndex(d => { const r = d.getBoundingClientRect(); return r.bottom < card.top - 10 && r.top > 80 && r.left > 10 && r.right < innerWidth - 10; });
});

test('carte : un point ne mène nulle part ; sa vignette au survol (souris), au toucher (téléphone), au clavier', async ({ app, page, context }) => {
  const pages = [];
  context.on('page', p => pages.push(p));
  await toMap(app, page);
  const dots = page.locator('ma-distance .leaflet-marker-pane .gf-obs-photo');
  const tip = page.locator('ma-distance .gf-float-tip');
  const i = await pointInView(page);
  expect(i).toBeGreaterThanOrEqual(0);
  const dot = dots.nth(i);
  if (app.phone) {
    await dot.tap();
    await expect(tip).toBeVisible();
    await dot.tap();
    await expect(tip).toBeVisible();
    await expect(tip).not.toContainText('Touchez encore');
    // A touch on the map elsewhere: hidden.
    const box = /** @type {any} */ (await page.locator('ma-distance gf-map').boundingBox());
    await page.touchscreen.tap(box.x + 20, box.y + 140);
    await expect(tip).toBeHidden();
  } else {
    await dot.hover();
    await expect(tip).toBeVisible();
    await dot.click();
    await page.mouse.move(2, 300);
    await expect(tip).toBeHidden();
  }
  // Its card: the photo, the name, the scientific name, the credit (as text) — no link.
  await page.locator('ma-distance input[type="range"]').focus();
  await dot.focus();
  await expect(tip).toBeVisible();
  await expect(tip.locator('img')).toHaveCount(1);
  await expect(tip.locator('b')).toHaveText('Ortie');
  await expect(tip.locator('i')).toHaveText('Urtica dioica');
  await expect(tip.locator('.credit')).toHaveText('Photo : © Anne Martin · CC BY · iNaturalist');
  await expect(tip.locator('a')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
  await expect(dot).toHaveAttribute('aria-label', 'Ortie, Urtica dioica');
  // Nothing opened.
  await page.waitForTimeout(300);
  expect(await opened(page)).toEqual([]);
  expect(pages).toHaveLength(0);
  expect(await hash(page)).toBe('#/app/rencontres/map');
});

/** Every link of the page to another origin, through the shadow roots: its address, whether it is a credit. @param {Page} page */
const linksOut = page => page.evaluate(() => {
  /** @type {{ href: string, text: string, credit: boolean }[]} */
  const out = [];
  /** A credit (rel license / author, a credit line, the map's attribution) or the emergency's, through the shadow roots. @param {Element} a */
  const credit = a => {
    if (/(^|\s)(license|author)(\s|$)/.test(a.getAttribute('rel') || '')) return true;
    /** @type {Node | null} */ let n = a;
    while (n) {
      if (n instanceof Element && n.closest('.credit, .leaflet-control-attribution, .sos')) return true;
      const root = n instanceof Element ? n.getRootNode() : n;
      n = root instanceof ShadowRoot ? root.host : null;
    }
    return false;
  };
  /** @param {ParentNode} root */
  const walk = root => {
    for (const a of root.querySelectorAll('a[href]')) {
      const url = new URL(/** @type {string} */ (a.getAttribute('href')), location.href);
      if (url.origin !== location.origin) out.push({ href: url.href, text: (a.textContent || '').trim(), credit: credit(a) });
    }
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
  };
  walk(document);
  return out;
});

/** Only credits lead out, and a few of them were found (the check looked at something). @param {Page} page @param {string} where */
async function onlyCredits(page, where) {
  const links = await linksOut(page);
  expect(links.filter(l => !l.credit), `${where} : aucun lien vers un autre site, sauf les crédits`).toEqual([]);
  return links;
}

test('dans les mini-applications, seuls les crédits mènent ailleurs ; hors d’elles, la fiche garde ses sources', async ({ app, page }) => {
  await toMap(app, page);
  await onlyCredits(page, 'Rencontres, carte');
  await page.locator('ma-distance').getByRole('button', { name: 'Qui pousse par ici ?' }).click();
  await expect(page.locator('ma-deck .swipe-card.top')).toBeVisible();
  await onlyCredits(page, 'Rencontres, cartes');
  // The first match: its photos, their credits.
  await page.locator('ma-deck .round.like').click();
  await expect(page.locator('ma-meet-media gf-media-viewer')).toHaveCount(1);
  await expect(page.locator('ma-meet-media gf-attribution').first()).toBeAttached();
  await onlyCredits(page, 'Rencontres, ses photos');
  // A plant's sheet in the game.
  const ail = plantId('Allium ursinum');
  await app.go(`#/app/rencontres/cards?p=${ail}`);
  await expect(page.locator('ma-plant-sheet gf-plant-detail, ma-plant-sheet .sheet').first()).toBeVisible();
  await page.waitForTimeout(800);
  await onlyCredits(page, 'Rencontres, une fiche');
  // Its sources named still, as text (their links taken away).
  expect(await page.evaluate(() => {
    let n = 0;
    /** @param {ParentNode} root */
    const walk = root => { n += root.querySelectorAll('a[data-quiet]').length; for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot); };
    walk(document);
    return n;
  })).toBeGreaterThan(0);
  for (const id of ['cueillette', 'mosaique']) {
    await app.go(`#/app/${id}`);
    await page.getByRole('button', { name: 'Autour de moi' }).click();
    await expect.poll(() => hash(page)).toBe(`#/app/${id}/map`);
    await onlyCredits(page, `${id}, carte`);
    await page.locator('ma-distance').getByRole('button', { name: 'Qui pousse par ici ?' }).click();
    await expect.poll(() => hash(page)).toBe(`#/app/${id}/cards`);
    await expect(page.locator('ma-around-list .head')).toBeVisible();
    await onlyCredits(page, `${id}, cartes`);
  }
  // Outside the games: the plant's sheet with its links to its sources.
  await app.go(`#/plant/${ail}`);
  await expect.poll(async () => (await linksOut(page)).filter(l => !l.credit).length, { timeout: 15_000 }).toBeGreaterThan(0);
});
