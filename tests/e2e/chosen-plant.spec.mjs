// Rencontres, once its first steps are over (kit/ma-around-list.js beside the map, kit/ma-distance.js): ONE plant on
// the screen, « la plante choisie ». The map's highlight (its observations, pinned), the photos beside the deck
// (kit/ma-meet-media.js) and the plant's sheet (kit/ma-plant-sheet.js) all show it, and the address names it (?p=):
//  - before any heart, it is the card on top of the deck (no ?p=: the map follows the deck as it is swiped);
//  - a heart chooses the plant loved, until the next heart (a pass changes nothing; the deck's card on top is only a
//    candidate then); the sheet's « Suivante », a point of the map, a tile of « Toutes » choose too;
//  - the address carries the whole screen (?p= the plant, &v= the view, &fiche=1 the sheet open, &m= the image):
//    a new plant is a new entry (Back returns to the one before), the rest replaces it; a reload, Back and Forward
//    restore exactly what was shown.
// (The screen of the bug: the map on the elder, the deck on another plant, the sheet and its photos on a third.)
import { test, expect, plantId, answerAround } from './fixtures.mjs';

/** @typedef {import('@playwright/test').Page} Page */

test.use({ reducedMotion: 'reduce' });
test.beforeEach(({ context }) => answerAround(context));

const AIL = 'Allium ursinum', PISSENLIT = 'Taraxacum officinale', PLANTAIN = 'Plantago lanceolata', BENOITE = 'Geum urbanum',
  LIERRE = 'Hedera helix', RENONCULE = 'Ranunculus acris', ORTIE = 'Urtica dioica';
/** The plants around, as fixtures.mjs answers them: iNaturalist's taxon of each is 1000 + its rank here. */
const NAMES = ['Urtica dioica', 'Allium ursinum', 'Conium maculatum', 'Geum urbanum', 'Taraxacum officinale', 'Quercus robur',
  'Hedera helix', 'Galium aparine', 'Plantago lanceolata', 'Bellis perennis', 'Ranunculus acris', 'Trifolium repens'];
const taxonOf = (/** @type {string} */ name) => 1000 + NAMES.indexOf(name);

const hash = (/** @type {Page} */ page) => page.evaluate(() => location.hash);

/** The observations around: two of each plant (their taxa), and a plant's own when asked (its highlight). @param {Page} page */
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

/**
 * What each part of the screen shows: the map's highlight (its plant, by its taxon, and its pinned points), the
 * photos beside the deck, the sheet, the deck's card on top, and the address (?p=, the rest).
 * @param {Page} page
 */
async function screen(page) {
  const taxon = await page.locator('ma-distance gf-map').evaluate(m => /** @type {any} */ (m).highlight?.taxonId ?? null).catch(() => null);
  const attr = async (/** @type {string} */ sel, /** @type {string} */ name) => (await page.locator(sel).count()) ? page.locator(sel).first().getAttribute(name) : null;
  const params = new URLSearchParams((await hash(page)).split('?')[1] || '');
  const num = (/** @type {string | null} */ v) => (v == null ? null : Number(v));
  return {
    map: taxon == null ? null : plantId(NAMES[taxon - 1000]),
    media: num(await attr('ma-around-list ma-meet-media[mode="pane"] gf-media-viewer', 'plant-id')),
    sheet: num(await attr('ma-plant-sheet gf-plant-detail', 'plant-id')),
    top: num(await attr('ma-deck .swipe-card.top', 'data-id')),
    p: num(params.get('p'))
  };
}

/**
 * The screen on one plant: the map pins it (its own points, large), and every pane open shows it — the address names
 * it (`inUrl`: before any heart, the deck's card on top, no ?p=). @param {Page} page @param {string} name
 * @param {{ media?: boolean, sheet?: boolean, inUrl?: boolean }} open
 */
async function onPlant(page, name, { media = false, sheet = false, inUrl = true } = {}) {
  const id = plantId(name);
  await expect.poll(() => screen(page), { message: `l’écran sur ${name}` }).toMatchObject({
    map: id, media: media ? id : null, sheet: sheet ? id : null, p: inUrl ? id : null
  });
  await expect(page.locator('ma-distance .leaflet-marker-pane .gf-obs-leaf.hl.chosen').first()).toBeAttached();
  // The heading of each pane names it.
  const named = await page.evaluate(async id => (await import('/app/miniapp/kit/cards.js')).nameOf(await (await import('/app/core/db.js')).get('plants', id)), id);
  if (media) await expect(page.locator('ma-meet-media[mode="pane"]').getByRole('heading', { level: 2 })).toHaveText(`Photos · ${named}`);
  if (sheet) await expect(page.locator('ma-plant-sheet .sheet-head strong')).toHaveText(named);
}

const top = (/** @type {Page} */ page, /** @type {string} */ name) => expect(page.locator('ma-deck .swipe-card.top')).toHaveAttribute('data-id', String(plantId(name)));

/** Rencontres to its cards (a returning visitor). @param {import('./app.mjs').App} app @param {Page} page */
async function toCards(app, page) {
  await answerPoints(page);
  await app.open('#/app/rencontres');
  await page.getByRole('button', { name: 'Autour de moi' }).click();
  await expect.poll(() => hash(page)).toBe('#/app/rencontres/map');
  await page.locator('ma-distance').getByRole('button', { name: 'Qui pousse par ici ?' }).click();
  await expect.poll(() => hash(page)).toBe('#/app/rencontres/cards');
  await top(page, AIL);
}

/** A point of the map of `name` (one of its observations among the others) clicked. @param {Page} page @param {string} name */
async function clickPoint(page, name) {
  const at = await page.locator('ma-distance').evaluate((el, t) => [...(/** @type {ShadowRoot} */ (el.shadowRoot)).querySelectorAll('.leaflet-marker-pane .gf-obs-leaf:not(.hl)')]
    .findIndex(icon => {
      // The point's photo (its plant's), whose address tells its taxon (answerPoints) — loaded or still to load.
      const img = icon.querySelector('img'), src = img?.getAttribute('src') || img?.dataset.src || '';
      const i = Number(/photos\/7(\d\d)\//.exec(src)?.[1] ?? -1);
      return i >= 0 && 1000 + (i % 12) === t;
    }), taxonOf(name));
  expect(at).toBeGreaterThanOrEqual(0);
  await page.locator('ma-distance .leaflet-marker-pane .gf-obs-leaf:not(.hl)').nth(at).dispatchEvent('click');
}

test.describe('un grand écran', () => {
  test.skip(({ isMobile }) => isMobile, 'the three panes side by side');

  test('la carte, les photos et la fiche montrent toujours la même plante, celle de l’adresse ; Retour, Suivant et rechargement la retrouvent', async ({ app, page }) => {
    // A long walk through the screen (a reload in it): more time than a test's usual minute.
    test.slow();
    await toCards(app, page);
    // Before any heart: the card on top, the map following it as the deck is swiped.
    await onPlant(page, AIL, { inUrl: false });
    await page.locator('ma-deck .round.pass').click();
    await top(page, PISSENLIT);
    await onPlant(page, PISSENLIT, { inUrl: false });
    expect(await hash(page)).toBe('#/app/rencontres/cards');

    // A heart: that plant chosen — its photos come; the map and the address on it.
    await page.locator('ma-deck .round.like').click();
    await onPlant(page, PISSENLIT, { media: true });
    // A pass: the deck goes on (a candidate on top), the plant chosen stays — and the screen says which it is.
    await top(page, PLANTAIN);
    await page.locator('ma-deck .round.pass').click();
    await top(page, BENOITE);
    await onPlant(page, PISSENLIT, { media: true });
    await expect(page.locator('ma-around-list .chosen-line')).toContainText('Pissenlit');
    // The next heart: that one chosen.
    await page.locator('ma-deck .round.like').click();
    await onPlant(page, BENOITE, { media: true });
    const afterHearts = await hash(page);

    // « Toutes », a tile: its sheet, chosen — the map on it; the view and the sheet in the address.
    await page.locator('ma-around-list').getByRole('tab', { name: 'Toutes' }).click();
    await expect.poll(() => hash(page)).toContain('v=toutes');
    await page.locator('ma-around-list .grid .card').filter({ hasText: 'Lierre' }).click();
    await onPlant(page, LIERRE, { sheet: true });
    expect(await hash(page)).toMatch(/[?&]fiche=1(&|$)/);
    // The sheet's « Suivante »: the next tile — the map follows, never the sheet alone.
    await page.locator('ma-plant-sheet .pager .next').click();
    await onPlant(page, RENONCULE, { sheet: true });
    await expect(page.locator('ma-plant-sheet .pager span')).toHaveText('7 / 12');
    const atRenoncule = await hash(page);
    expect(atRenoncule).toBe(`#/app/rencontres/cards?p=${plantId(RENONCULE)}&v=toutes&fiche=1`);

    // Back: the plant before (the map, the sheet, the address); Forward: this one again.
    await page.goBack();
    await onPlant(page, LIERRE, { sheet: true });
    await page.goForward();
    await onPlant(page, RENONCULE, { sheet: true });
    // A reload: the same screen.
    await page.reload();
    await app.ready();
    await expect.poll(() => hash(page)).toBe(atRenoncule);
    await expect(page.locator('ma-around-list').getByRole('tab', { name: 'Toutes' })).toHaveAttribute('aria-selected', 'true');
    await onPlant(page, RENONCULE, { sheet: true });

    // The sheet closed: the plant stays chosen; back to the deck: its photos beside it, on that plant.
    await page.locator('ma-plant-sheet').getByRole('button', { name: 'Fermer la fiche' }).click();
    await expect.poll(() => hash(page)).toBe(`#/app/rencontres/cards?p=${plantId(RENONCULE)}&v=toutes`);
    await page.locator('ma-around-list').getByRole('tab', { name: 'Rencontres' }).click();
    await expect.poll(() => hash(page)).toBe(`#/app/rencontres/cards?p=${plantId(RENONCULE)}`);
    await onPlant(page, RENONCULE, { media: true });
    await top(page, 'Bellis perennis');

    // A point of the map: its plant chosen — the photos and the address follow; Back: the one before.
    await clickPoint(page, ORTIE);
    await onPlant(page, ORTIE, { media: true });
    await page.goBack();
    await onPlant(page, RENONCULE, { media: true });
    // Further back, through the entries: the plant of the last heart, then the deck's card on top before any heart.
    expect(afterHearts).toBe(`#/app/rencontres/cards?p=${plantId(BENOITE)}`);
    // The sheet closed went back past the sheets it showed (the screen under them took its plant): Back again is the
    // heart before them, never a sheet opened again.
    await page.goBack();
    await expect.poll(() => hash(page)).toBe(`#/app/rencontres/cards?p=${plantId(PISSENLIT)}`);
    expect(await hash(page)).not.toMatch(/fiche=1/);
  });

  test('↺ d’un cœur revient à la plante choisie avant ; « Matchs » : une plante touchée est choisie', async ({ app, page }) => {
    await toCards(app, page);
    await page.locator('ma-deck .round.like').click();
    await onPlant(page, AIL, { media: true });
    await page.locator('ma-deck .round.like').click();
    await onPlant(page, PISSENLIT, { media: true });
    await page.locator('ma-deck .round.undo').click();
    await top(page, PISSENLIT);
    await onPlant(page, AIL, { media: true });
    await page.locator('ma-deck .round.like').click();
    await onPlant(page, PISSENLIT, { media: true });
    await page.locator('ma-around-list').getByRole('tab', { name: /Matchs/ }).click();
    await page.locator('ma-around-list .grid .card').filter({ hasText: 'Ail des ours' }).click();
    await expect.poll(() => hash(page)).toBe(`#/app/rencontres/cards?p=${plantId(AIL)}&v=matchs`);
    await page.locator('ma-around-list').getByRole('tab', { name: 'Rencontres' }).click();
    await onPlant(page, AIL, { media: true });
  });

  test('une adresse partagée ouvre exactement cet écran : la plante, la vue, la fiche, l’image', async ({ app, page }) => {
    await toCards(app, page);
    await page.locator('ma-deck .round.like').click();
    await onPlant(page, AIL, { media: true });
    const lierre = plantId(LIERRE);
    await app.go(`#/app/rencontres/cards?p=${lierre}&v=matchs&fiche=1`);
    await onPlant(page, LIERRE, { sheet: true });
    await expect(page.locator('ma-around-list').getByRole('tab', { name: /Matchs/ })).toHaveAttribute('aria-selected', 'true');
    // Its sheet closed (no new entry); back to the deck: its photos beside it.
    const entries = await page.evaluate(() => history.length);
    await page.locator('ma-plant-sheet').getByRole('button', { name: 'Fermer la fiche' }).click();
    await page.locator('ma-around-list').getByRole('tab', { name: 'Rencontres' }).click();
    await expect.poll(() => hash(page)).toBe(`#/app/rencontres/cards?p=${lierre}`);
    await onPlant(page, LIERRE, { media: true });
    expect(await page.evaluate(() => history.length)).toBe(entries);
    // The image shown, by its place among the plant's media (&m=): the viewer says it, the address keeps it (no new
    // entry); an address with one gives it to the viewer.
    const viewer = page.locator('ma-meet-media[mode="pane"] gf-media-viewer');
    await expect.poll(() => viewer.evaluate(v => /** @type {any} */ (v)._done)).toBe(true);
    await viewer.evaluate(v => v.dispatchEvent(new CustomEvent('media-index', { detail: { index: 3 }, bubbles: true, composed: true })));
    await expect.poll(() => hash(page)).toBe(`#/app/rencontres/cards?p=${lierre}&m=3`);
    expect(await page.evaluate(() => history.length)).toBe(entries);
    await app.go(`#/app/rencontres/cards?p=${lierre}&m=5`);
    await expect(viewer).toHaveJSProperty('index', 5);
    // Another plant: its first image (no &m=).
    // (The points drawn on the step « map », where they choose nothing: beside the cards, they choose.)
    await clickPoint(page, ORTIE);
    await onPlant(page, ORTIE, { media: true });
    expect(await hash(page)).toBe(`#/app/rencontres/cards?p=${plantId(ORTIE)}`);
  });
});

test('un téléphone : ses photos et sa fiche sur la plante choisie ; la fiche d’une carte la choisit, Retour la ferme', async ({ app, page, isMobile }) => {
  test.skip(!isMobile, 'a phone');
  await toCards(app, page);
  await onPlant(page, AIL, { inUrl: false });
  // A heart: its photos full screen, on the plant chosen; closed, back to the deck.
  await page.locator('ma-deck .round.like').click();
  const full = page.locator('ma-meet-media[mode="dialog"]');
  await expect(full.locator('gf-media-viewer')).toHaveAttribute('plant-id', String(plantId(AIL)));
  await page.keyboard.press('Escape');
  await expect(full).toHaveCount(0);
  await expect.poll(() => hash(page)).toBe(`#/app/rencontres/cards?p=${plantId(AIL)}`);
  // The card on top's sheet (« ⋯ »): that plant chosen, its sheet over the deck — the map on it too.
  await top(page, PISSENLIT);
  await page.locator('ma-deck').getByRole('button', { name: /Voir sa fiche/ }).click();
  await expect.poll(() => hash(page)).toBe(`#/app/rencontres/cards?p=${plantId(PISSENLIT)}&fiche=1`);
  await expect.poll(() => screen(page)).toMatchObject({ map: plantId(PISSENLIT), sheet: plantId(PISSENLIT), p: plantId(PISSENLIT) });
  // Back: its sheet closed, the plant chosen before.
  await page.goBack();
  await expect.poll(() => hash(page)).toBe(`#/app/rencontres/cards?p=${plantId(AIL)}`);
  await expect.poll(() => screen(page)).toMatchObject({ map: plantId(AIL), sheet: null, p: plantId(AIL) });
});
