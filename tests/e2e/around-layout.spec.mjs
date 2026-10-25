// The games around a place, step by step on one screen (kit/around.js#aroundColumns): the step « map » is the map
// and its distance; the step « cards » ADDS the cards beside the same map (the same Leaflet map, its distance a chip);
// Rencontres' first heart ADDS the photos of the plant it chose (beside the deck while the column has room, else full
// screen). The plant chosen is the last one liked — passes never change it, ↺ of its heart goes back to the one before,
// « Ses photos » shows it, a match touched in « Matchs » is chosen; kept with the game. The map lights the card on top
// (gf-top), the plants passed (gf-passed), the matches (gf-matched) and the plant chosen's observations (its highlight).
// The cards' column never scrolls on « Rencontres ». Back to the step « map »: the cards go, the map stays. A phone:
// the map a band over the cards, folded at will.
import { test, expect, plantId, answerAround } from './fixtures.mjs';

/** @typedef {import('@playwright/test').Page} Page */

test.use({ reducedMotion: 'reduce' });
test.beforeEach(({ context }) => answerAround(context));

const AIL = 'Allium ursinum', PISSENLIT = 'Taraxacum officinale', PLANTAIN = 'Plantago lanceolata', BENOITE = 'Geum urbanum';
/** iNaturalist's taxon of each plant around (fixtures.mjs: 1000 + its rank in NAMES). */
const TAXON = { [AIL]: 1001, [PISSENLIT]: 1004, [PLANTAIN]: 1008, [BENOITE]: 1003 };

const hash = (/** @type {Page} */ page) => page.evaluate(() => location.hash);
const kept = (/** @type {Page} */ page) => page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.app.rencontres.state') || 'null')?.ctx ?? null);

/** The observations around: 24 points, two of each of the 12 plants (their taxa), and a plant's own when asked. @param {Page} page */
async function answerPoints(page) {
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\?/, route => {
    const url = new URL(route.request().url());
    const taxon = Number(url.searchParams.get('taxon_id')) || 0;
    const n = taxon ? 3 : 24;
    const results = Array.from({ length: n }, (_, i) => ({
      id: (taxon || 7) * 100 + i, observed_on: '2026-05-01',
      geojson: { coordinates: [2.35 + ((i % 6) - 2.5) * 0.0018 + (taxon ? 0.0005 : 0), 48.85 + (Math.floor(i / 6) - 1.5) * 0.0015] },
      // The plant's photo (its taxon's: a point never shows the observation's own), its address telling the point.
      taxon: { id: taxon || 1000 + (i % 12), name: 'Plante', preferred_common_name: null,
        default_photo: { square_url: `https://inaturalist-open-data.s3.amazonaws.com/photos/${(taxon || 7) * 100 + i}/square.jpg`, license_code: 'cc-by', attribution: '(c) A' } },
      photos: []
    }));
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ total_results: n, results }) });
  });
}

/** Rencontres to its cards; the map's element marked on the way (the same map after). @param {import('./app.mjs').App} app @param {Page} page */
async function toCards(app, page) {
  await answerPoints(page);
  await app.open('#/app/rencontres');
  await page.getByRole('button', { name: 'Autour de moi' }).click();
  await expect.poll(() => hash(page)).toBe('#/app/rencontres/map');
  await expect(page.locator('ma-distance .leaflet-marker-pane .gf-obs-leaf')).toHaveCount(24);
  await page.locator('ma-distance .leaflet-container').evaluate(el => { /** @type {any} */ (el).gfProbe = 'step 2'; });
  await page.locator('ma-distance').getByRole('button', { name: 'Qui pousse par ici ?' }).click();
  await expect.poll(() => hash(page)).toBe('#/app/rencontres/cards');
  await expect(page.locator('ma-deck .swipe-card.top')).toHaveAttribute('data-id', String(plantId(AIL)));
}

/** The map's points of a plant, by its taxon, and those lit a way. @param {Page} page @param {number} taxon */
const dotsOf = (page, taxon) => page.locator('ma-distance').evaluate((el, t) => {
  const out = { all: 0, top: 0, passed: 0, matched: 0 };
  for (const icon of /** @type {ShadowRoot} */ (el.shadowRoot).querySelectorAll('.leaflet-marker-pane .gf-obs-leaf:not(.hl)')) {
    // The taxon of each point: the photo's address carries it (fixtures above).
    const src = icon.querySelector('img')?.getAttribute('src') || '';
    if (!new RegExp(`/photos/7\\d\\d/`).test(src)) continue;
    const i = Number(/photos\/7(\d\d)\//.exec(src)?.[1]);
    if (1000 + (i % 12) !== t) continue;
    out.all++;
    for (const k of /** @type {const} */ (['top', 'passed', 'matched'])) if (icon.classList.contains('gf-' + k)) out[k]++;
  }
  return out;
}, taxon);

/** The plant chosen's own points on the map (its highlight: large, ringed). @param {Page} page */
const chosenDots = page => page.locator('ma-distance .leaflet-marker-pane .gf-obs-leaf.hl.chosen');

test.describe('un grand écran', () => {
  test.skip(({ isMobile }) => isMobile, 'a wide screen');

  test('l’étape « cartes » ajoute les cartes à côté de la même carte ; la carte suit la carte du dessus ; retour : les cartes s’en vont', async ({ app, page }) => {
    await toCards(app, page);
    // The same map (its element and its Leaflet map), beside the deck.
    const map = page.locator('ma-grid [data-place="meet"] ma-distance');
    await expect(map).toBeVisible();
    expect(await page.locator('ma-distance .leaflet-container').evaluate(el => /** @type {any} */ (el).gfProbe)).toBe('step 2');
    const mapBox = /** @type {any} */ (await map.boundingBox()), deckBox = /** @type {any} */ (await page.locator('ma-deck .deck').boundingBox());
    expect(mapBox.x + mapBox.width).toBeLessThanOrEqual(deckBox.x);
    await expect(page.locator('ma-distance .dist-chip')).toContainText('1 km · Changer');
    await expect(page.locator('ma-distance svg.gf-ring')).toHaveCount(1);
    // The card on top lit on the map; passed, dimmed, and the next one lit.
    await expect.poll(() => dotsOf(page, TAXON[AIL])).toEqual({ all: 2, top: 2, passed: 0, matched: 0 });
    await page.locator('ma-deck .round.pass').click();
    await expect(page.locator('ma-deck .swipe-card.top')).toHaveAttribute('data-id', String(plantId(PISSENLIT)));
    await expect.poll(() => dotsOf(page, TAXON[AIL])).toEqual({ all: 2, top: 0, passed: 2, matched: 0 });
    await expect.poll(() => dotsOf(page, TAXON[PISSENLIT])).toEqual({ all: 2, top: 2, passed: 0, matched: 0 });
    // The separator between the map and the cards: ← widens the cards, kept.
    const split = page.locator('ma-grid .split').first();
    await split.focus();
    const before = mapBox.width;
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => /** @type {any} */ (await map.boundingBox()).width).toBeLessThan(before);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('geoflora.app.rencontres.layout') || '')).toContain('map');
    // Back to the step « map »: the cards go, the same map stays (its card again).
    await page.locator('ma-distance .dist-chip').click();
    await expect.poll(() => hash(page)).toBe('#/app/rencontres/map');
    await expect(page.locator('ma-around-list')).toHaveCount(0);
    await expect(page.locator('ma-distance').getByRole('button', { name: 'Qui pousse par ici ?' })).toBeVisible();
    expect(await page.locator('ma-distance .leaflet-container').evaluate(el => /** @type {any} */ (el).gfProbe)).toBe('step 2');
  });

  test('la plante choisie : le premier cœur ajoute ses photos ; les passes n’y changent rien ; un autre cœur la remplace ; ↺ revient ; « Ses photos » ; gardée', async ({ app, page }) => {
    await toCards(app, page);
    const pane = page.locator('ma-around-list ma-meet-media[mode="pane"]');
    await page.locator('ma-deck .round.like').click();
    await expect(pane.locator('gf-media-viewer')).toHaveAttribute('plant-id', String(plantId(AIL)));
    await expect(pane.locator('.coach')).toContainText('Chaque nouveau coup de cœur la remplace ici.');
    // Three columns: the map, the cards, the photos.
    const [m, d, p] = await Promise.all(['ma-distance', 'ma-deck .deck', 'ma-meet-media'].map(async s => /** @type {any} */ (await page.locator(s).first().boundingBox())));
    expect(m.x + m.width).toBeLessThanOrEqual(d.x);
    expect(d.x + d.width).toBeLessThanOrEqual(p.x);
    await expect(chosenDots(page)).toHaveCount(3);
    await expect.poll(() => dotsOf(page, TAXON[AIL])).toMatchObject({ matched: 2 });
    // Passes: the photos stay on the plant chosen.
    for (const name of [PISSENLIT, PLANTAIN]) {
      await expect(page.locator('ma-deck .swipe-card.top')).toHaveAttribute('data-id', String(plantId(name)));
      await page.locator('ma-deck .round.pass').click();
    }
    await expect(pane.locator('gf-media-viewer')).toHaveAttribute('plant-id', String(plantId(AIL)));
    await expect(pane.getByRole('heading', { level: 2 })).toContainText('Ail des ours');
    // Another heart: it is chosen now.
    await expect(page.locator('ma-deck .swipe-card.top')).toHaveAttribute('data-id', String(plantId(BENOITE)));
    await page.locator('ma-deck .round.like').click();
    await expect(pane.locator('gf-media-viewer')).toHaveAttribute('plant-id', String(plantId(BENOITE)));
    await expect.poll(async () => (await kept(page)).focus).toBe(plantId(BENOITE));
    await expect.poll(async () => (await kept(page)).media).toEqual({ by: plantId(AIL), closed: false });
    // ↺ of that heart: back to the one chosen before.
    await page.locator('ma-deck .round.undo').click();
    await expect(pane.locator('gf-media-viewer')).toHaveAttribute('plant-id', String(plantId(AIL)));
    await expect.poll(async () => (await kept(page)).focus).toBe(plantId(AIL));
    // Closed, « Ses photos » shows the plant chosen (not the card on top).
    await pane.getByRole('button', { name: /Fermer les photos/ }).click();
    await expect(pane).toHaveCount(0);
    await page.locator('ma-deck').getByRole('button', { name: /Ses photos/ }).click();
    await expect(pane.locator('gf-media-viewer')).toHaveAttribute('plant-id', String(plantId(AIL)));
    // Kept with the game: after a reload, « Continuer » finds it.
    await expect.poll(async () => (await kept(page)).media).toEqual({ by: plantId(AIL), closed: false });
    await page.reload();
    await app.ready();
    expect((await kept(page)).media).toEqual({ by: plantId(AIL), closed: false });
    expect((await kept(page)).focus).toBe(plantId(AIL));
    await expect(pane.locator('gf-media-viewer')).toHaveAttribute('plant-id', String(plantId(AIL)));
  });

  for (const [width, height] of [[1280, 800], [1920, 920]]) {
    test(`« Rencontres » tient dans sa colonne : jamais de barre de défilement (${width} × ${height})`, async ({ app, page }) => {
      await page.setViewportSize({ width, height });
      await toCards(app, page);
      const over = () => page.locator('ma-around-list').evaluate(el => {
        const list = /** @type {HTMLElement} */ (/** @type {ShadowRoot} */ (el.shadowRoot).querySelector('.list'));
        return Math.max(el.scrollHeight - el.clientHeight, list.scrollHeight - list.clientHeight);
      });
      await expect.poll(over).toBeLessThanOrEqual(0);
      await page.locator('ma-deck .round.like').click();
      await expect(page.locator('ma-meet-media[mode="pane"]')).toHaveCount(1);
      await expect.poll(over).toBeLessThanOrEqual(0);
    });
  }

  test('une tablette (1024) : pas la place des photos à côté du jeu — en plein écran', async ({ app, page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await toCards(app, page);
    await expect(page.locator('ma-distance')).toBeVisible();
    await page.locator('ma-deck .round.like').click();
    await expect(page.locator('ma-meet-media[mode="dialog"] dialog')).toHaveJSProperty('open', true);
    await expect(page.locator('ma-meet-media[mode="dialog"] gf-media-viewer')).toHaveAttribute('plant-id', String(plantId(AIL)));
  });
});

test('un téléphone : la carte en bandeau au-dessus des cartes, repliable ; les photos de la plante choisie en plein écran', async ({ app, page, isMobile }) => {
  test.skip(!isMobile, 'a phone');
  await toCards(app, page);
  const band = page.locator('ma-distance[band]');
  await expect(band).toBeVisible();
  const b = /** @type {any} */ (await band.boundingBox()), deck = /** @type {any} */ (await page.locator('ma-deck .deck').boundingBox());
  expect(b.y + b.height).toBeLessThanOrEqual(deck.y);
  expect(b.height).toBeLessThan(0.45 * 844);
  await band.getByRole('button', { name: 'Replier la carte' }).click();
  await expect(page.locator('ma-distance gf-map')).toBeHidden();
  await band.getByRole('button', { name: 'Montrer la carte' }).click();
  await expect(page.locator('ma-distance gf-map')).toBeVisible();
  await page.locator('ma-deck .round.like').click();
  const full = page.locator('ma-meet-media[mode="dialog"]');
  await expect(full.locator('gf-media-viewer')).toHaveAttribute('plant-id', String(plantId(AIL)));
});
