// Découvrir « Rencontres » on a first launch: around me, a map of the observations, cards of the plants seen around
// (the most observed first), a heart keeps one (favourites), and the steps lead to the whole app. iNaturalist,
// Wikidata and Wikipédia answered here. Migrated from discover2.cjs, discoverscope.cjs, meetstart.cjs, meetmatch.cjs.
import { test, expect, plantId } from './fixtures.mjs';

const NAMES = ['Urtica dioica', 'Allium ursinum', 'Conium maculatum', 'Geum urbanum', 'Taraxacum officinale', 'Quercus robur',
  'Hedera helix', 'Galium aparine', 'Plantago lanceolata', 'Bellis perennis', 'Ranunculus acris', 'Trifolium repens'];
const COUNTS = [12, 80, 5, 40, 66, 3, 25, 9, 51, 30, 18, 7];
const ARTICLE = 'La plante est une espèce vivace.\n\n== Phytonymie ==\n\n=== Étymologie ===\nSon nom vient du latin ursus, l’ours.\n\n== Description ==\nFeuilles larges.';

// No hint animation of the top card: the keys alone move the cards.
test.use({ firstVisit: true, reducedMotion: 'reduce' });

test.beforeEach(async ({ context }) => {
  /** @type {(route: import('@playwright/test').Route, body: any) => Promise<void>} */
  const json = (route, body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  await context.route(/^https:\/\/(api\.inaturalist\.org|www\.wikidata\.org|fr\.wikipedia\.org)\//, route => {
    const url = new URL(route.request().url());
    if (url.host === 'api.inaturalist.org' && /species_counts/.test(url.pathname)) {
      return json(route, { results: NAMES.map((name, i) => ({ count: COUNTS[i], taxon: { id: 1000 + i, name, preferred_common_name: null, default_photo: { square_url: `https://inaturalist-open-data.s3.amazonaws.com/photos/${i}/square.jpg` } } })) });
    }
    if (url.host === 'api.inaturalist.org' && url.pathname === '/v1/observations') {
      return json(route, { results: Array.from({ length: 30 }, (_, i) => ({ id: i, geojson: { coordinates: [2.35 + (i % 6 - 3) * 0.001, 48.85 + (Math.floor(i / 6) - 2) * 0.001] }, taxon: { name: 'Urtica dioica', preferred_common_name: 'Ortie' } })) });
    }
    if (url.host === 'www.wikidata.org' && url.searchParams.get('action') === 'wbgetentities') {
      const ids = url.searchParams.get('ids') || '';
      return json(route, { entities: { [ids]: { claims: {}, sitelinks: { frwiki: { title: 'Plante ' + ids } }, aliases: { fr: [] } } } });
    }
    if (url.host === 'fr.wikipedia.org') return json(route, { query: { pages: [{ title: 'Plante', extract: ARTICLE, description: 'espèce de plantes', touched: '2026-09-01T10:00:00Z' }] } });
    return route.fallback();
  });
});

test('autour de moi : la carte des observations, puis les cartes, la plus observée d’abord', async ({ app, page }) => {
  await app.open('#/');
  await page.getByRole('button', { name: 'Autour de moi' }).click();
  const discover = page.locator('gf-discover');
  await expect(discover.locator('.g-steps li.on .l')).toHaveText('Carte');
  const map = discover.locator('.g-mapbox gf-map');
  await expect(map.locator('path.gf-area')).toHaveCount(1);
  await expect(map.locator('.gf-obs-leaf')).toHaveCount(30);

  await discover.locator('.g-steps [data-step="go"]').click();
  await expect(discover.locator('.g-steps li.on .l')).toHaveText('Rencontres');
  const top = discover.locator('.swipe-card.top');
  await expect(top.locator('h2')).toContainText('Allium ursinum');
  await expect(top).toHaveAttribute('data-id', String(plantId('Allium ursinum')));
  await expect(top.locator('.ethno')).toContainText('ursus');
});

test('un cœur (→) garde la plante dans les favoris, un passage (←) montre la suivante', async ({ app, page }) => {
  await app.open('#/');
  await page.getByRole('button', { name: 'Autour de moi' }).click();
  const discover = page.locator('gf-discover');
  await discover.locator('.g-steps [data-step="go"]').click();
  const top = discover.locator('.swipe-card.top');
  await expect(top).toHaveAttribute('data-id', String(plantId('Allium ursinum')));
  await page.keyboard.press('ArrowLeft');
  await expect(top).toHaveAttribute('data-id', String(plantId('Taraxacum officinale')));
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(async id => (await import('/app/core/collections.js')).isFavorite(id), plantId('Taraxacum officinale'))).toBe(true);
  expect(await page.evaluate(async id => (await import('/app/core/collections.js')).isFavorite(id), plantId('Allium ursinum'))).toBe(false);
  // The first match: on to the photos step, no full-screen modal.
  await expect(discover.locator('.g-steps li.on .l')).toHaveText('Photos');
  await expect(discover.locator('.match')).toHaveCount(0);
});

test('« Passer » montre toute l’application ; « Rejouer » la cache de nouveau', async ({ app, page }) => {
  await app.open('#/');
  await page.getByRole('link', { name: 'Passer : montrer toute l’application' }).click();
  await expect.poll(() => app.tabs()).toEqual(expect.arrayContaining(['Flore', 'Carte', 'Mes plantes']));
  expect(await page.evaluate(async () => (await import('/app/core/discover.js')).discoverState().done)).toBe(true);
  await page.getByRole('button', { name: 'Scénarios' }).locator('visible=true').first().click();
  await page.getByRole('dialog').getByRole('listitem').filter({ hasText: 'Rencontres' }).getByRole('button', { name: 'Rejouer' }).click();
  await expect(page.getByRole('heading', { name: 'Rencontrez les plantes d’ici' })).toBeVisible();
  const state = await page.evaluate(async () => (await import('/app/core/discover.js')).discoverState());
  expect({ done: state.done, step: state.step, matches: state.matches.length }).toEqual({ done: false, step: 0, matches: 0 });
  await expect.poll(() => app.tabs()).not.toContain('Flore');
});
