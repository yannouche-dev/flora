// « Disposition libre » : the list of the map's results (app/layout/cells.js DlResults, gf-plant-list): each plant's
// observations in the zone on its row (core/nearby.js plantCounts, core/observations.js obsNotes), the sort « Plus
// observées » (workers/search-core.js `observed`) — in the sort menu and the grid's « Observations » column, written in
// the address (sort=obs) — and never in Flore, which has no zone. iNaturalist answered here: the zone's observations of
// 12 plants, each a different number of times (1 to 12).
import { test, expect, answerAround } from './fixtures.mjs';

/** @typedef {import('@playwright/test').Page} Page */

test.use({ reducedMotion: 'reduce' });
test.skip(({ isMobile }) => isMobile, 'a wide screen: the map and the list side by side');

const AT = 'at=48.85,2.35&r=1km';
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

test('chaque ligne dit les observations de sa plante dans la zone ; « Plus observées » : dans le menu, écrit dans l’adresse, les plus observées d’abord', async ({ app, page }) => {
  // The search's bar, its results as a list (rows, not the grid a wide cell would draw).
  await app.open(`#/layout/[map,[search(list=0),results(view=list)]]?${AT}`);
  await expect.poll(async () => (await names(page)).length).toBe(12);
  // The default order stays the French name's; each row says its plant's observations.
  expect(await param(page, 'sort')).toBe(null);
  await expect(page.locator('dl-results gf-plant-card').first().locator('.meta .obs')).toHaveText(/^\d+ obs\.$/);
  const ail = page.locator('dl-results gf-plant-card').filter({ hasText: 'Ail des ours' });
  await expect(ail.locator('.meta .obs')).toHaveText('9 obs.');
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

test('la grille : la colonne « Observations » (les plus observées d’abord, puis l’inverse) ; Flore n’a ni la colonne ni le tri', async ({ app, page }) => {
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
