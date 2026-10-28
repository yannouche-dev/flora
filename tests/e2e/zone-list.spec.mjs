// « Écran sur mesure » : the list of the map's results (app/layout/cells.js DlResults, gf-plant-list): each plant's
// observations in the zone on its row (core/nearby.js plantCounts, core/observations.js obsNotes), the sort « Plus
// observées » (workers/search-core.js `observed`) — in the sort menu and the grid's « Observations » column, written in
// the address (sort=obs) — and never in Flore, which has no zone; the cross hover (state.js hover): a row hovered or
// reached by the keyboard lights its plant's points on the map (gf-map litKeys), a point hovered lights its plant's row
// (gf-plant-card lit); the list kept to what the map shows once moved by hand (state.js setView, workers/search-core.js
// within), « Toute la zone » back, never for a move the map makes itself, nor with liste=zone; on a phone too, the map
// in its tab and the list in another. iNaturalist answered here: the zone's observations of 12 plants, each a
// different number of times (1 to 12), each plant's in a column of its own (the first plant's the westmost).
import { test, expect, answerAround } from './fixtures.mjs';

/** @typedef {import('@playwright/test').Page} Page */

test.use({ reducedMotion: 'reduce' });
const WIDE = 'a wide screen: the map and the list side by side';

const AT = 'at=48.85,2.35&r=1km';
const LAT = 48.85, LNG = 2.35;
/** The zone's plants and how many times each was observed. */
const SEEN = /** @type {[string, number][]} */ ([['Urtica dioica', 3], ['Allium ursinum', 9], ['Conium maculatum', 1], ['Geum urbanum', 6],
  ['Taraxacum officinale', 4], ['Quercus robur', 2], ['Hedera helix', 8], ['Galium aparine', 5], ['Plantago lanceolata', 7], ['Bellis perennis', 10],
  ['Ranunculus acris', 12], ['Trifolium repens', 11]]);
/** The names, the most observed first. */
const MOST = [...SEEN].sort((a, b) => b[1] - a[1]).map(([name]) => name);

test.beforeEach(async ({ context, page }) => {
  await answerAround(context);
  // The zone's observations (no taxon asked): each plant as many times as SEEN says, around the point asked.
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\?/, route => {
    const q = new URL(route.request().url()).searchParams;
    if (q.get('taxon_id')) return route.fallback();
    const lat = Number(q.get('lat')), lng = Number(q.get('lng'));
    const results = q.get('page') && q.get('page') !== '1' ? [] : SEEN.flatMap(([name, n], i) => Array.from({ length: n }, (_, k) => ({
      id: 5000 + i * 20 + k, uri: `https://www.inaturalist.org/observations/${5000 + i * 20 + k}`, observed_on: `2026-05-0${1 + (k % 9)}`, place_guess: 'Paris',
      geojson: { coordinates: [lng + (i - 5.5) * 0.0008, lat + (k - n / 2) * 0.0004] }, taxon: { id: 1000 + i, name, preferred_common_name: null } })));
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ total_results: results.length, results }) });
  });
});

/** A parameter of the state in the address. @param {Page} page @param {string} key */
const param = (page, key) => page.evaluate(k => new URLSearchParams(location.hash.split('?')[1] || '').get(k), key);
/** The names the list holds, in its order (the store's results: the list draws only the rows in view). @param {Page} page */
const names = page => page.evaluate(async () => {
  const { store } = await import('/app/core/store.js');
  return store.state.results.items.map((/** @type {any} */ p) => p.scientificName);
});
/** What the layout's map shows now, [west, south, east, north] (gf-map bounds). @param {Page} page @returns {Promise<number[]>} */
const bounds = page => page.locator('dl-map gf-map').evaluate(el => /** @type {any} */ (el).bounds());
/** The plants with a point in a box (where the route above puts them), sorted. @param {number[]} box */
const seenIn = ([w, s, e, n]) => SEEN.filter(([, count], i) => Array.from({ length: count }, (_, k) => [LNG + (i - 5.5) * 0.0008, LAT + (k - count / 2) * 0.0004])
  .some(([x, y]) => x >= w && x <= e && y >= s && y <= n)).map(([name]) => name).sort();
/** Whether a box holds all of the zone's circle (1 km around its centre). @param {number[]} box */
const holdsZone = ([w, s, e, n]) => w <= LNG - 0.0137 && e >= LNG + 0.0137 && s <= LAT - 0.009 && n >= LAT + 0.009;
/** The map zoomed by hand: the wheel over its middle (up: in). @param {Page} page @param {number} [dy] */
const wheel = async (page, dy = -300) => {
  const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await page.locator('dl-map gf-map .leaflet-container').boundingBox());
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, dy);
};

test('chaque ligne dit les observations de sa plante dans la zone ; « Plus observées » : dans le menu, écrit dans l’adresse, les plus observées d’abord', async ({ app, page, isMobile }) => {
  test.skip(isMobile, WIDE);
  // The search's bar, its results as a list (rows, not the grid a wide cell would draw).
  await app.open(`#/layout/[map,[search(list=0),results(view=list)]]?${AT}`);
  await expect.poll(async () => (await names(page)).length).toBe(12);
  // The default order stays the French name's; each row says its plant's observations.
  expect(await param(page, 'sort')).toBe(null);
  // Both sources asked (the defaults): iNaturalist's part said, GBIF having none here.
  await expect(page.locator('dl-results gf-plant-card').first().locator('.meta .obs')).toHaveText(/^\d+ obs\. iNat\.$/);
  const ail = page.locator('dl-results gf-plant-card').filter({ hasText: 'Ail des ours' });
  await expect(ail.locator('.meta .obs')).toHaveText('9 obs. iNat.');
  await expect(ail.locator('.meta .obs')).toHaveAttribute('title', '9 observations dans la zone : 9 iNaturalist');
  // « Plus observées »: one more choice of the sort menu, written in the address.
  const sort = page.locator('dl-search gf-results-bar select');
  await expect(sort.locator('option', { hasText: 'Plus observées' })).toHaveCount(1);
  await sort.selectOption('obs');
  await expect.poll(() => param(page, 'sort')).toBe('obs');
  await expect.poll(() => names(page)).toEqual(MOST);
  // Reloaded: the same order.
  await page.reload();
  await app.ready();
  await expect.poll(() => names(page)).toEqual(MOST);
  await expect(page.locator('dl-search gf-results-bar select')).toHaveValue('obs');
});

test('la grille : la colonne « Observations » (les plus observées d’abord, puis l’inverse) ; Flore n’a ni la colonne ni le tri', async ({ app, page, isMobile }) => {
  test.skip(isMobile, WIDE);
  await app.open(`#/layout/[map,results(view=grid)]?${AT}`);
  await expect.poll(async () => (await names(page)).length).toBe(12);
  const head = page.locator('dl-results gf-plant-list .th').filter({ hasText: 'Observations' });
  await expect(head).toHaveCount(1);
  await head.getByRole('button').click();
  await expect.poll(() => param(page, 'sort')).toBe('obs');
  await expect.poll(() => names(page)).toEqual(MOST);
  await expect(head).toHaveAttribute('aria-sort', 'descending');
  await head.getByRole('button').click();
  await expect.poll(() => param(page, 'sort')).toBe('-obs');
  await expect.poll(() => names(page)).toEqual([...MOST].reverse());
  await expect(head).toHaveAttribute('aria-sort', 'ascending');
  await expect(page.locator('dl-results gf-plant-card').filter({ hasText: 'Ail des ours' }).locator('.cell.obs')).toContainText('9');
  // Flore: no zone, no count — neither the column nor the sort; sort=obs in its address is the French name's.
  await app.go('#/?sort=obs');
  await expect.poll(() => app.state('results.sort')).toBe('fr');
  await expect(page.locator('gf-flora gf-results-bar select option', { hasText: 'Plus observées' })).toHaveCount(0);
  await expect(page.locator('gf-flora gf-plant-list .th', { hasText: 'Observations' })).toHaveCount(0);
});

test('survol croisé : une ligne survolée (ou atteinte au clavier) allume les points de sa plante sur la carte, un point survolé la ligne de sa plante ; partis, plus rien', async ({ app, page, isMobile }) => {
  test.skip(isMobile, WIDE);
  // The points as dots (pts=pastille): one path each.
  await app.open(`#/layout/[map(pts=pastille),results(view=list)]?${AT}`);
  await expect.poll(async () => (await names(page)).length).toBe(12);
  const map = page.locator('dl-map gf-map');
  const dots = map.locator('.leaflet-overlay-pane path.gf-obs');
  await expect(dots).toHaveCount(78);
  const hash = await page.evaluate(() => location.hash);
  const cards = page.locator('dl-results gf-plant-card');
  const lit = page.locator('dl-results gf-plant-card[lit]');
  // A row hovered: its plant's points lit on the map (Ail des ours: 9 of them), no other; its row lit.
  await cards.filter({ hasText: 'Ail des ours' }).hover();
  await expect(map.locator('path.gf-lit')).toHaveCount(9);
  await expect(lit).toHaveCount(1);
  await expect(lit).toContainText('Ail des ours');
  // Gone from the list: nothing lit.
  await page.mouse.move(2, 2);
  await expect(map.locator('path.gf-lit')).toHaveCount(0);
  await expect(lit).toHaveCount(0);
  // A point hovered — the northmost of the westmost column, the first plant's (Urtica dioica: 3 observations): its
  // plant's row lit, it alone; the map lights its plant's points itself (gf-kin), none from outside.
  const at = await dots.evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  const west = Math.min(...at.map(b => b.x));
  const north = at.filter(b => b.x - west < 2).sort((a, b) => a.y - b.y)[0];
  await page.mouse.move(north.x, north.y);
  await expect(lit).toHaveCount(1);
  expect(await lit.evaluate(el => /** @type {any} */ (el).plant.scientificName)).toBe('Urtica dioica');
  await expect(map.locator('path.gf-kin')).toHaveCount(3);
  await expect(map.locator('path.gf-lit')).toHaveCount(0);
  await page.mouse.move(2, 2);
  await expect(lit).toHaveCount(0);
  // The keyboard: Tab from the first row's ♥ reaches the second row, lit with its points; Tab on, the third.
  const order = await names(page);
  const seen = Object.fromEntries(SEEN);
  await cards.first().locator('button.fav').focus();
  await page.keyboard.press('Tab');
  await expect(lit).toHaveCount(1);
  expect(await lit.evaluate(el => /** @type {any} */ (el).plant.scientificName)).toBe(order[1]);
  await expect(map.locator('path.gf-lit')).toHaveCount(seen[order[1]]);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect.poll(() => lit.evaluateAll(els => els.map(el => /** @type {any} */ (el).plant.scientificName))).toEqual([order[2]]);
  await expect(map.locator('path.gf-lit')).toHaveCount(seen[order[2]]);
  // Nothing of it in the address.
  expect(await page.evaluate(() => location.hash)).toBe(hash);
});

test('la liste suit la carte déplacée à la main : les plantes de ce qu’elle montre, dites ; « Toute la zone » la rend et recadre la carte ; un point touché (la carte vole) n’y change rien ; dézoomée sur tout le cercle, toute la zone', async ({ app, page, isMobile }) => {
  test.skip(isMobile, WIDE);
  await app.open(`#/layout/[map(pts=pastille),results(view=list)]?${AT}`);
  await expect.poll(async () => (await names(page)).length).toBe(12);
  const hash = await page.evaluate(() => location.hash);
  const line = page.locator('dl-results .scope.view');
  await expect(line).toHaveCount(0);
  // Zoomed in by hand: the plants of the points it shows, said — in the cell's head too.
  await wheel(page);
  await expect.poll(async () => (await names(page)).length).toBeLessThan(12);
  const shown = seenIn(await bounds(page));
  expect(shown.length).toBeGreaterThan(0);
  await expect.poll(async () => (await names(page)).sort()).toEqual(shown);
  await expect(line).toContainText(`Dans la vue de la carte : ${shown.length} plante${shown.length > 1 ? 's' : ''} sur 12`);
  await expect(page.locator('section.cell[data-comp="results"] .cell-head .sub')).toContainText('dans la vue');
  // The map's points are still the zone's (never kept to its view), and nothing of it in the address.
  await expect(page.locator('dl-map .leaflet-overlay-pane path.gf-obs')).toHaveCount(78);
  expect(await page.evaluate(() => location.hash)).toBe(hash);
  // « Toute la zone »: the whole list, the map framed on the zone again.
  await line.getByRole('button', { name: 'Toute la zone' }).click();
  await expect.poll(async () => (await names(page)).length).toBe(12);
  await expect(line).toHaveCount(0);
  await expect.poll(async () => holdsZone(await bounds(page))).toBe(true);
  // A point touched (the mouse's own click: a hand on the map) — one of the eastmost column, clear of the zone's
  // panel —: its plant chosen, the map flying to it, a move it makes itself: the list stays the zone's. Where the
  // points are once still (an eased frame has its view at once, its points drawn there a moment later).
  const dots = () => page.locator('dl-map .leaflet-overlay-pane path.gf-obs').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  let at = await dots();
  await expect.poll(async () => { const was = JSON.stringify(at); at = await dots(); return JSON.stringify(at) === was; }, { intervals: [300] }).toBe(true);
  const east = Math.max(...at.map(b => b.x));
  const column = at.filter(b => east - b.x < 2).sort((a, b) => a.y - b.y);
  const dot = column[Math.floor(column.length / 2)];
  await page.mouse.click(dot.x, dot.y);
  await expect.poll(() => param(page, 'p')).not.toBe(null);
  await page.waitForTimeout(1500);
  expect((await names(page)).length).toBe(12);
  await expect(line).toHaveCount(0);
  // Zoomed in, then out past all of the circle: the whole zone.
  await wheel(page);
  await expect.poll(async () => (await names(page)).length).toBeLessThan(12);
  await wheel(page, 300);
  await wheel(page, 300);
  await expect.poll(async () => holdsZone(await bounds(page))).toBe(true);
  await expect.poll(async () => (await names(page)).length).toBe(12);
  await expect(line).toHaveCount(0);
});

test('liste=zone : la carte zoomée laisse la liste à toute la zone ; menée par la carte, un autre rayon lâche sa vue', async ({ app, page, isMobile }) => {
  test.skip(isMobile, WIDE);
  await app.open(`#/layout/[map(pts=pastille,liste=zone),results(view=list)]?${AT}`);
  await expect.poll(async () => (await names(page)).length).toBe(12);
  await wheel(page);
  await page.waitForTimeout(1500);
  expect((await names(page)).length).toBe(12);
  await expect(page.locator('dl-results .scope.view')).toHaveCount(0);
  // Led by the map (its default): kept to its view; the radius changed — another circle —: the whole new zone.
  await app.open(`#/layout/[map(pts=pastille),results(view=list)]?${AT}`);
  await expect.poll(async () => (await names(page)).length).toBe(12);
  await wheel(page);
  await expect.poll(async () => (await names(page)).length).toBeLessThan(12);
  await page.evaluate(() => { location.hash = location.hash.replace('r=1km', 'r=2km'); });
  await expect.poll(() => param(page, 'r')).toBe('2km');
  await expect.poll(async () => (await names(page)).length).toBe(12);
  await expect(page.locator('dl-results .scope.view')).toHaveCount(0);
});

test('au téléphone : la carte zoomée dans son onglet, l’onglet de la liste montre ses plantes, et le dit', async ({ app, page, isMobile }) => {
  test.skip(!isMobile, 'a phone: the map and the list in tabs');
  await app.open(`#/layout/[map(pts=pastille),results(view=list)]?${AT}`);
  await expect.poll(async () => (await names(page)).length).toBe(12);
  await wheel(page);
  await expect.poll(async () => (await names(page)).length).toBeLessThan(12);
  const shown = seenIn(await bounds(page));
  await page.locator('gf-layout [role="tab"]').nth(1).click();
  const line = page.locator('dl-results .scope.view');
  await expect(line).toBeVisible();
  await expect(line).toContainText(`Dans la vue de la carte : ${shown.length} plante${shown.length > 1 ? 's' : ''} sur 12`);
  expect((await names(page)).sort()).toEqual(shown);
});
