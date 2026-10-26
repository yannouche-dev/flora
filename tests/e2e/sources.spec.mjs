// A source that fails is said (« Source indisponible — Réessayer »), never « aucune donnée », and its failure is not
// kept: « Réessayer » asks again, and once the service is back a reload shows its data (audit STO-7, STO-8, STO-9, OPS-2).
// Distinct from a module switched off (nothing asked, nothing to retry) and from a valid empty answer (« Aucune… »).
import { test, expect, plantId } from './fixtures.mjs';

const GLOBI = /api\.globalbioticinteractions\.org\/interaction/;
const GBIF = /api\.gbif\.org\/v1\//;

/** GloBI's answer: one pollinator of the plant. */
const INTERACTIONS = {
  columns: ['interaction_type', 'target_taxon_name', 'target_taxon_path', 'study_citation'],
  data: [['pollinatedBy', 'Bombus terrestris', 'Animalia | Insecta | Hymenoptera | Apoidea | Bombus terrestris', 'Étude de test']]
};

/** @param {import('@playwright/test').Page} page */
const interactionsBlock = page => page.locator('gf-plant-detail .block[data-key="interactions"]').first();

test('GloBI en panne : « Source indisponible », puis « Réessayer » affiche ses données', async ({ app, page, context }) => {
  let failing = true;
  let asked = 0;
  await context.route(GLOBI, route => {
    asked++;
    return failing ? route.fulfill({ status: 503, body: '' }) : route.fulfill({ contentType: 'application/json', body: JSON.stringify(INTERACTIONS) });
  });
  await app.open(`#/plant/${plantId('Allium ursinum')}`);
  const block = interactionsBlock(page);
  const down = block.locator('.source-down');
  await expect(down).toContainText('Source indisponible : GloBI (erreur 503)');
  await expect(block.getByText('Aucune interaction connue de GloBI pour cette espèce.')).toHaveCount(0);
  failing = false;
  const before = asked;
  await down.getByRole('button', { name: 'Réessayer' }).click();
  await expect(block.getByText('Bombus terrestris').first()).toBeVisible();
  await expect(block.locator('.source-down')).toHaveCount(0);
  expect(asked).toBeGreaterThan(before);
});

test('GloBI joignable sans interaction : « Aucune interaction connue », pas « indisponible »', async ({ app, page, context }) => {
  await context.route(GLOBI, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ columns: INTERACTIONS.columns, data: [] }) }));
  await app.open(`#/plant/${plantId('Allium ursinum')}`);
  // Empty blocks may be left out when read (outside King): shown, it says « none »; never « unavailable ».
  await expect.poll(() => page.locator('gf-plant-detail .source-down').filter({ hasText: 'GloBI' }).count()).toBe(0);
  const block = interactionsBlock(page);
  if (await block.count()) await expect(block.getByText('Aucune interaction connue de GloBI pour cette espèce.')).toBeVisible();
});

test('réponse de forme inattendue : une panne (« réponse inattendue »), pas une absence', async ({ app, page, context }) => {
  await context.route(GLOBI, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ rows: [] }) }));
  await app.open(`#/plant/${plantId('Allium ursinum')}`);
  await expect(interactionsBlock(page).locator('.source-down')).toContainText('réponse inattendue');
});

test('module GloBI coupé : rien demandé, pas de « Source indisponible »', async ({ app, page, context }) => {
  let asked = 0;
  await context.route(GLOBI, route => { asked++; return route.fulfill({ status: 503, body: '' }); });
  await context.addInitScript(() => localStorage.setItem('geoflora.modules', JSON.stringify({ globi: false })));
  await app.open(`#/plant/${plantId('Allium ursinum')}`);
  await expect(page.locator('gf-plant-detail .block[data-key="name"]').first()).toBeVisible();
  await expect(page.locator('gf-plant-detail .source-down').filter({ hasText: 'GloBI' })).toHaveCount(0);
  expect(asked).toBe(0);
});

test('GBIF en panne puis rétabli : la panne n’est pas gardée, la fiche se remplit au rechargement', async ({ app, page, context }) => {
  let failing = true;
  let asked = 0;
  await context.route(GBIF, route => {
    asked++;
    if (failing) return route.fulfill({ status: 503, body: '' });
    const url = route.request().url();
    if (url.includes('/species/match')) return route.fulfill({ json: { usageKey: 2857697, matchType: 'EXACT', scientificName: 'Allium ursinum L.', canonicalName: 'Allium ursinum', status: 'ACCEPTED', rank: 'SPECIES' } });
    if (url.includes('/descriptions')) return route.fulfill({ json: { results: [{ description: 'Plante à bulbe des sous-bois frais.', language: 'fra', type: 'general', source: 'Test' }] } });
    return route.fulfill({ json: { results: [], count: 0, facets: [] } });
  });
  await app.open(`#/plant/${plantId('Allium ursinum')}`);
  const descriptions = page.locator('gf-plant-detail .block[data-key="descriptions"]').first();
  await expect(descriptions.locator('.source-down')).toContainText('GBIF');
  await expect(descriptions.getByText(/Aucune description/)).toHaveCount(0);
  failing = false;
  const before = asked;
  await page.reload();
  await app.ready();
  await expect(descriptions.getByText('Plante à bulbe des sous-bois frais.')).toBeVisible();
  expect(asked, 'GBIF demandé à nouveau : la panne n’a pas été mise en cache').toBeGreaterThan(before);
  // In IndexedDB: GBIF's identifier now; marked partial (iNaturalist, Wikidata, Commons still fail), so kept minutes only.
  const kept = await page.evaluate(async () => {
    const db = await import('/app/core/db.js');
    const rows = /** @type {any[]} */ (await db.getAll('plantDetails'));
    return rows.filter(r => String(r.key).startsWith('details3:')).map(r => ({ gbif: r.value?.identifiers?.gbif?.id ?? null, partial: Boolean(r.partial) }));
  });
  expect(kept).toContainEqual({ gbif: 2857697, partial: true });
});

test('GBIF en panne : « Réessayer » dans un bloc redemande la fiche (identifiants compris), sans recharger', async ({ app, page, context }) => {
  let failing = true;
  await context.route(GBIF, route => {
    if (failing) return route.fulfill({ status: 503, body: '' });
    const url = route.request().url();
    if (url.includes('/species/match')) return route.fulfill({ json: { usageKey: 2857697, matchType: 'EXACT', canonicalName: 'Allium ursinum', rank: 'SPECIES' } });
    if (url.includes('/descriptions')) return route.fulfill({ json: { results: [{ description: 'Feuilles à odeur d’ail.', language: 'fra', type: 'general' }] } });
    return route.fulfill({ json: { results: [], count: 0, facets: [] } });
  });
  await app.open(`#/plant/${plantId('Allium ursinum')}`);
  const descriptions = page.locator('gf-plant-detail .block[data-key="descriptions"]').first();
  const down = descriptions.locator('.source-down');
  await expect(down).toContainText('GBIF');
  failing = false;
  await down.getByRole('button', { name: 'Réessayer' }).click();
  await expect(descriptions.getByText('Feuilles à odeur d’ail.')).toBeVisible();
  await expect(descriptions.locator('.source-down')).toHaveCount(0);
});
