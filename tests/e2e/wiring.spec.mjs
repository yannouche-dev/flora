// « Disposition libre » : cells that mirror each other (state.js, cells.js dl-map). The list is the map's: the map
// shows the zone's observations (iNaturalist's latest, of the period), the list their plants (one each, the flora's),
// and a filter keeps both to its plants; the period is every cell's (periode= in the address: the zone's observations
// that month, their plants the results); a map of France and one of the world (portee=) show where the same plants
// were observed (iNaturalist's tiles, their taxa), the current plant's on top; a plant chosen outside the zone's list
// still has its observations in the zone (its taxon found by its name). iNaturalist answered here: 12 plants around.
import { test, expect, plantId } from './fixtures.mjs';

/** @typedef {import('@playwright/test').Page} Page */

test.use({ reducedMotion: 'reduce' });

const NAMES = ['Urtica dioica', 'Allium ursinum', 'Conium maculatum', 'Geum urbanum', 'Taraxacum officinale', 'Quercus robur', 'Hedera helix',
  'Galium aparine', 'Plantago lanceolata', 'Bellis perennis', 'Ranunculus acris', 'Trifolium repens'];
const AT = 'at=48.85,2.35';
/** iNaturalist's taxon of a plant the flora does not know, observed in the zone. */
const UNKNOWN = 7777;
const now = new Date();
const MONTH = String(now.getMonth() + 1);

/**
 * iNaturalist: the zone's observations — two of each of its 12 plants (this month, 6 of them), and one of a plant the
 * flora does not know —, and a plant's own when asked for (taxon_id: two each); a name looked up (/taxa): its taxon;
 * tiles: a transparent pixel. Every address asked kept.
 * @param {Page} page @returns {Promise<string[]>}
 */
async function answer(page) {
  /** @type {string[]} */ const asked = [];
  const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  await page.route(/^https:\/\/api\.inaturalist\.org\//, route => {
    const url = new URL(route.request().url());
    asked.push(url.href);
    const json = (/** @type {any} */ body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (/\/v1\/(grid|points)\//.test(url.pathname)) return route.fulfill({ contentType: 'image/png', body: PIXEL });
    if (url.pathname === '/v1/observations/species_counts') {
      const month = url.searchParams.get('month');
      const names = month ? NAMES.slice(0, 6) : NAMES;
      return json({ results: names.map((name, i) => ({ count: 30 - i, taxon: { id: 1000 + i, name, preferred_common_name: null } })) });
    }
    if (url.pathname === '/v1/taxa') {
      const q = url.searchParams.get('q') || '';
      return json({ results: [{ id: 5555, name: q }] });
    }
    if (url.pathname === '/v1/observations') {
      const taxa = (url.searchParams.get('taxon_id') || '').split(',').filter(Boolean).map(Number);
      const month = url.searchParams.get('month');
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-03`;
      const of = taxa.length ? taxa : [...(month ? NAMES.slice(0, 6) : NAMES).map((_, i) => 1000 + i), ...(month ? [] : [UNKNOWN])];
      const results = of.flatMap((t, k) => Array.from({ length: 2 }, (_, i) => ({
        id: t * 10 + i, observed_on: month || i % 2 === 0 ? date : '2020-01-03',
        geojson: { coordinates: [2.35 + ((k % 6) - 2.5) * 0.0015 + i * 0.0003, 48.85 + (Math.floor(k / 6) - 1) * 0.0015] },
        taxon: { id: t, name: NAMES[t - 1000] ?? 'Planta ignota', preferred_common_name: null }
      })));
      if (Number(url.searchParams.get('page') || 1) > 1) return json({ total_results: results.length, results: [] });
      return json({ total_results: results.length, results });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  return asked;
}

const mapAt = (/** @type {Page} */ page, /** @type {number} */ i) => page.locator('dl-map').nth(i).locator('gf-map');
/** The taxa of a map's points. @param {Page} page @param {number} i */
const taxaOn = (page, i) => mapAt(page, i).evaluate(m => [...new Set((/** @type {any} */ (m).area?.points ?? []).map((/** @type {any} */ p) => p.taxonId))].sort());
const param = (/** @type {Page} */ page, /** @type {string} */ key) => page.evaluate(k => new URLSearchParams(location.hash.split('?')[1] || '').get(k), key);

test.describe('un grand écran', () => {
  test.skip(({ isMobile }) => isMobile, 'a wide screen');

  test('la liste est celle de la carte : les plantes des observations de la zone, une chacune ; un filtre, ses seules plantes sur les deux', async ({ app, page }) => {
    const asked = await answer(page);
    await app.open(`#/layout/[map(r=1km),search]?${AT}`);
    // The zone's observations asked (its plants, not each plant's): their 12 plants of the flora, the list.
    await expect.poll(() => app.state('results.total')).toBe(12);
    await expect.poll(() => taxaOn(page, 0)).toEqual(NAMES.map((_, i) => 1000 + i));
    expect(asked.some(u => /\/v1\/observations\?.*iconic_taxa=Plantae/.test(u) && !u.includes('taxon_id='))).toBe(true);
    expect(asked.some(u => u.includes('species_counts'))).toBe(false);
    // A search: its plant alone, on the map too.
    await page.locator('dl-search gf-plant-search input').fill('ortie');
    await expect.poll(() => app.state('results.total')).toBe(1);
    await expect.poll(() => taxaOn(page, 0)).toEqual([1000]);
    // A map that does not follow the search: every observation of the zone, the plant the flora does not know too.
    await app.go(`#/layout/[map(r=1km,suit=0),search]?${AT}&q=ortie`);
    await expect.poll(() => taxaOn(page, 0)).toEqual([...NAMES.map((_, i) => 1000 + i), UNKNOWN]);
  });

  test('la période est celle de toutes les cases : ce mois-ci, les plantes de la zone ce mois-ci, la liste et la carte ; dans l’adresse', async ({ app, page }) => {
    const asked = await answer(page);
    await app.open(`#/layout/[map(r=1km;ctl=rayon+periode),results]?${AT}`);
    await expect.poll(() => app.state('results.total')).toBe(12);
    await page.locator('dl-map').getByRole('group', { name: 'Période des observations' }).getByRole('button', { name: 'Ce mois-ci' }).click();
    await expect.poll(() => param(page, 'periode')).toBe('mois');
    // The zone's observations of this month: their plants the results, the map theirs.
    await expect.poll(() => asked.some(u => /\/v1\/observations\?/.test(u) && u.includes(`month=${MONTH}`))).toBe(true);
    await expect.poll(() => app.state('results.total')).toBe(6);
    await expect.poll(() => taxaOn(page, 0)).toEqual([1000, 1001, 1002, 1003, 1004, 1005]);
    // Reloaded: the same period.
    await page.reload();
    await app.ready();
    await expect.poll(() => app.state('results.total')).toBe(6);
    await expect(page.locator('dl-map').getByRole('button', { name: 'Ce mois-ci' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('trois cartes : la zone, la France, le monde — les mêmes plantes, les observations de la France et du monde en carreaux d’iNaturalist', async ({ app, page }) => {
    await answer(page);
    await app.open(`#/layout/[map(r=1km),map(france),map(monde),results]?${AT}`);
    await expect.poll(() => app.state('results.total')).toBe(12);
    const tiles = (/** @type {number} */ i) => mapAt(page, i).evaluate(m => (/** @type {any} */ (m).tiles ?? []).map((/** @type {any} */ t) => t.url));
    const ids = NAMES.map((_, i) => 1000 + i).join('%2C');
    for (const i of [1, 2]) {
      await expect.poll(async () => (await tiles(i)).find(u => u.includes('/v1/grid/')) ?? '').toContain(`taxon_id=${ids.replace(/%2C/g, ',')}`);
      // No circle of its own framed: the zone's drawn where it is.
      expect(await mapAt(page, i).evaluate(m => /** @type {any} */ (m).area?.fit)).toBe(false);
    }
    // The world goes further out.
    expect(await mapAt(page, 2).getAttribute('min-zoom')).toBe('1');
    // A filter: the same plants on every map.
    await app.go(`#/layout/[map(r=1km),map(france),map(monde),results]?${AT}&q=ortie`);
    await expect.poll(() => app.state('results.total')).toBe(1);
    await expect.poll(async () => (await tiles(1)).find(u => u.includes('/v1/grid/')) ?? '').toContain('taxon_id=1000&');
    await expect.poll(() => taxaOn(page, 0)).toEqual([1000]);
    // The current plant: its own points on top, on the wide maps.
    await app.go(`#/layout/[map(r=1km),map(france),map(monde),results]?${AT}&p=${plantId('Urtica dioica')}&q=ortie`);
    await expect.poll(async () => (await tiles(2)).filter(u => u.includes('/v1/points/') && u.includes('taxon_id=1000&') && u.includes('e0245e')).length).toBe(1);
  });

  test('les liens dans le constructeur : une pastille par lien ; touchée, la case se détache ou se relie (le réglage écrit)', async ({ app, page }) => {
    await answer(page);
    const ortie = plantId('Urtica dioica');
    await app.open(`#/builder?g=${encodeURIComponent('[map(r=1km),results,plant.wikipedia]')}&${AT}&p=${ortie}`);
    const grid = () => page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] || '').get('g'));
    const chips = (/** @type {string} */ comp) => page.locator(`gf-builder section.cell[data-comp="${comp}"] .cell-links`);
    await expect(chips('map').locator('.link-chip')).toHaveCount(4);
    // The map's points: every plant of the zone, not only the search's.
    await chips('map').locator('[data-link="recherche"]').click();
    await expect.poll(grid).toBe('[map(r=1km,suit=0),results,plant.wikipedia]');
    await expect(chips('map').locator('[data-link="recherche"]')).toHaveAttribute('aria-pressed', 'false');
    // The results over the whole of France.
    await chips('results').locator('[data-link="zone"]').click();
    await expect.poll(grid).toBe('[map(r=1km,suit=0),results(zone=0),plant.wikipedia]');
    // The sheet's block fixed on the current plant; then following it again.
    await chips('plant.wikipedia').locator('[data-link="plante"]').click();
    await expect.poll(grid).toBe(`[map(r=1km,suit=0),results(zone=0),plant.wikipedia(plante=${ortie})]`);
    await chips('plant.wikipedia').locator('[data-link="plante"]').click();
    await expect.poll(grid).toBe('[map(r=1km,suit=0),results(zone=0),plant.wikipedia]');
    // The map: France instead of the zone.
    await chips('map').locator('[data-link="zone"]').click();
    await expect.poll(grid).toBe('[map(portee=france,r=1km,suit=0),results(zone=0),plant.wikipedia]');
  });

  test('une plante hors de la liste de la zone : son taxon trouvé par son nom, ses observations dans la zone demandées', async ({ app, page }) => {
    const asked = await answer(page);
    const acanthe = plantId('Acanthus arboreus');
    await app.open(`#/layout/[map(r=1km),results]?${AT}&p=${acanthe}`);
    await expect.poll(() => asked.some(u => u.includes('/v1/taxa?q=Acanthus'))).toBe(true);
    await expect.poll(() => asked.some(u => /\/v1\/observations\?taxon_id=5555&/.test(u))).toBe(true);
    expect(await param(page, 'p')).toBe(String(acanthe));
  });
});
