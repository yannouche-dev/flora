// « Disposition libre » : the zone's observations, one layer over iNaturalist and GBIF (core/observations.js), and their
// filters first in the list's (layout/obs-filters.js « Observations de la zone », slotted in gf-filter-panel): shown
// once the group has a zone; each setting written in the address (sources=, jeux=, taxon=, qualite=, photos=,
// sauvages=) and asked of each source in its own words (iNaturalist: quality_grade, hrank, photo_license, captive;
// GBIF: mediaType, datasetKey, its datasets counted); GBIF's datasets in the zone with their titles and counts
// (iNaturalist's copy left out); a plant seen by GBIF alone in the list and on the map; reloaded, the same; « effacer »:
// the layout's own again; the plants' origin, the « Statut en France » below; a source that fails said, the other shown.
// iNaturalist answered here: 24 observations of the 12 plants of the zone (fixtures answerZone); GBIF: the elder
// (Sambucus nigra, which iNaturalist did not see) twice, in two datasets, and a copy of iNaturalist's.
import { test, expect, answerAround, answerZone, plantId } from './fixtures.mjs';
import { mapState } from './quiet.mjs';

/** @typedef {import('@playwright/test').Page} Page */

test.use({ reducedMotion: 'reduce' });
test.skip(({ isMobile }) => isMobile, 'a wide screen: the map and the list side by side');

const AT = 'at=48.85,2.35&r=1km';
const LAYOUT = '#/layout/[map,search(filters=1)]';
/** GBIF's copy of iNaturalist's research-grade observations (core/around3d.js INAT_DATASET). */
const INAT_DATASET = '50c9509d-22c7-4a22-a47d-8c48425ef4a7';
const TITLES = { 'cbn-mc': 'Inventaire du CBN Massif central', plantnet: 'Pl@ntNet, observations identifiées' };

/**
 * GBIF answered (its occurrences around the point asked, the datasets chosen only; its datasets counted as if none
 * were; their titles), unless `down`. `seen`: the addresses of its occurrences asked.
 * @param {Page} page @param {{ seen?: string[], down?: boolean }} [o]
 */
async function answerGbif(page, { seen, down = false } = {}) {
  await page.route(/^https:\/\/api\.gbif\.org\/v1\/occurrence\/search\?/, route => {
    const url = new URL(route.request().url());
    seen?.push(url.href);
    if (down) return route.fulfill({ status: 503, body: '' });
    const [lat, lng] = (url.searchParams.get('geoDistance') || '0,0,1km').split(',').map(Number);
    const media = [{ type: 'StillImage', license: 'http://creativecommons.org/licenses/by/4.0/' }];
    const row = (/** @type {number} */ key, /** @type {string} */ species, /** @type {string} */ datasetKey, /** @type {number} */ d) => ({ key, decimalLatitude: lat + d, decimalLongitude: lng + d,
      species, scientificName: species + ' L.', taxonRank: 'SPECIES', eventDate: '2026-06-0' + (key % 9 + 1), datasetKey, datasetName: TITLES[datasetKey] ?? 'iNaturalist', media });
    const all = [row(5001, 'Sambucus nigra', 'cbn-mc', 0.001), row(5002, 'Sambucus nigra', 'plantnet', -0.001), row(5003, 'Urtica dioica', INAT_DATASET, 0.002)];
    const chosen = url.searchParams.getAll('datasetKey');
    const results = chosen.length ? all.filter(r => chosen.includes(r.datasetKey)) : all;
    const counts = [{ name: INAT_DATASET, count: 100 }, { name: 'cbn-mc', count: 30 }, { name: 'plantnet', count: 12 }];
    const count = counts.filter(c => !chosen.length || chosen.includes(c.name)).reduce((n, c) => n + c.count, 0);
    return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ count, results, facets: [{ field: 'DATASET_KEY', counts }] }) });
  });
  await page.route(/^https:\/\/api\.gbif\.org\/v1\/dataset\/[^/?]+$/, route => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '');
    return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ key, title: TITLES[key] ?? key }) });
  });
}

/** A parameter of the state in the address. @param {Page} page @param {string} key */
const param = (page, key) => page.evaluate(k => new URLSearchParams(location.hash.split('?')[1] || '').get(k), key);
/** The section « Observations de la zone ». @param {Page} page */
const section = page => page.locator('dl-obs-filters');
/** The names the list holds (the store's results: the list draws only the rows in view). @param {Page} page */
const names = page => page.evaluate(async () => {
  const { store } = await import('/app/core/store.js');
  return store.state.results.items.map((/** @type {any} */ p) => p.scientificName);
});
/** The map's points: their kinds and names. @param {Page} page */
const mapPoints = page => page.locator('dl-map gf-map').evaluate(m => (/** @type {any} */ (m).area?.points ?? []).map((/** @type {any} */ p) => ({ kind: p.kind, sci: p.sci })));
/** The last address asked of a service, its parameters. @param {string[]} seen */
const lastAsked = seen => new URL(seen[seen.length - 1]).searchParams;

test.beforeEach(async ({ context }) => { await answerAround(context); });

test('la section de la liste : avec la zone seulement ; ses sources comptées ; chaque réglage écrit dans l’adresse et demandé à chaque source dans ses mots ; rechargé, le même ; « effacer »', async ({ app, page }) => {
  /** @type {string[]} */ const inat = [];
  /** @type {string[]} */ const gbif = [];
  await answerZone(page, { seen: inat });
  await answerGbif(page, { seen: gbif });
  // No zone: no section (the observations are a zone's).
  await app.open(LAYOUT);
  await expect(page.locator('dl-search gf-filter-panel')).toBeVisible();
  await expect(section(page)).toHaveCount(0);
  // A zone: the section first, iNaturalist's research grade as always, GBIF not asked.
  await app.go(`${LAYOUT}?${AT}`);
  await expect(section(page).getByRole('button', { name: 'Observations de la zone' })).toBeVisible();
  const sources = section(page).getByRole('group', { name: 'Sources des observations' });
  await expect(sources.getByRole('checkbox', { name: /iNaturalist/ })).toBeChecked();
  await expect(sources.getByRole('checkbox', { name: /iNaturalist/ })).toBeDisabled();
  await expect(sources.getByRole('checkbox', { name: /GBIF/ })).not.toBeChecked();
  await expect(sources.locator('li').first()).toContainText('24');
  await expect.poll(() => inat.length).toBeGreaterThan(0);
  expect(lastAsked(inat).get('quality_grade')).toBe('research');
  expect(gbif).toEqual([]);
  await expect.poll(async () => (await names(page)).length).toBe(12);

  // GBIF too: written, asked (its datasets counted), its count without its copy of iNaturalist's.
  await sources.getByRole('checkbox', { name: /GBIF/ }).check();
  await expect.poll(() => param(page, 'sources')).toBe('inat,gbif');
  await expect.poll(() => gbif.length).toBeGreaterThan(0);
  expect([lastAsked(gbif).get('taxonKey'), lastAsked(gbif).get('facet'), lastAsked(gbif).get('facetMultiselect'), lastAsked(gbif).get('datasetKey.facetLimit')])
    .toEqual(['6', 'datasetKey', 'true', '30']);
  await expect(sources.locator('li').nth(1)).toContainText('42');
  // Its datasets in the zone: their titles and counts, iNaturalist's copy not among them; one chosen: written, asked.
  const datasets = section(page).getByRole('group', { name: 'Jeux de données GBIF' });
  await expect(datasets.getByRole('checkbox')).toHaveCount(2);
  await expect(datasets.locator('li').first()).toContainText(TITLES['cbn-mc']);
  await expect(datasets.locator('li').first()).toContainText('30');
  await expect(datasets.locator('li').nth(1)).toContainText(TITLES.plantnet);
  await datasets.getByRole('checkbox', { name: new RegExp(TITLES.plantnet.replace(/[.@]/g, '.')) }).check();
  await expect.poll(() => param(page, 'jeux')).toBe('plantnet');
  await expect.poll(() => lastAsked(gbif).getAll('datasetKey')).toEqual(['plantnet']);
  await expect(datasets.getByRole('checkbox'), 'the others still there to choose').toHaveCount(2);

  // The rank, the quality, a free photo, wild plants: each written, each asked in each source's words.
  await section(page).getByRole('group', { name: 'Taxon' }).getByRole('button', { name: 'À l’espèce' }).click();
  await expect.poll(() => param(page, 'taxon')).toBe('espece');
  await section(page).getByRole('group', { name: 'Qualité' }).getByRole('button', { name: 'Toutes' }).click();
  await expect.poll(() => param(page, 'qualite')).toBe('toutes');
  await expect(section(page)).toContainText('GBIF n’a pas de note de qualité');
  await section(page).getByRole('group', { name: 'Photo' }).getByRole('button', { name: 'Photo libre' }).click();
  await expect.poll(() => param(page, 'photos')).toBe('libre');
  await section(page).getByRole('checkbox', { name: 'Sauvages seulement' }).check();
  await expect.poll(() => param(page, 'sauvages')).toBe('1');
  await expect.poll(() => { const q = lastAsked(inat); return [q.get('hrank'), q.get('quality_grade'), q.get('photo_license'), q.get('captive')]; })
    .toEqual(['species', null, 'cc0,cc-by,cc-by-sa', 'false']);
  await expect.poll(() => lastAsked(gbif).get('mediaType')).toBe('StillImage');
  await expect(section(page).locator('.badge')).toHaveText('6');

  // Reloaded: the same settings shown.
  await page.reload();
  await app.ready();
  await expect(section(page).getByRole('group', { name: 'Taxon' }).getByRole('button', { name: 'À l’espèce' })).toHaveAttribute('aria-pressed', 'true');
  await expect(section(page).getByRole('group', { name: 'Photo' }).getByRole('button', { name: 'Photo libre' })).toHaveAttribute('aria-pressed', 'true');
  await expect(section(page).getByRole('checkbox', { name: 'Sauvages seulement' })).toBeChecked();
  await expect(section(page).getByRole('group', { name: 'Jeux de données GBIF' }).getByRole('checkbox', { name: /Pl@ntNet/ })).toBeChecked();

  // « effacer »: the layout's own again — none of these keys in the address.
  await section(page).getByRole('button', { name: 'effacer' }).click();
  await expect.poll(() => page.evaluate(() => location.hash.split('?')[1])).toBe('at=48.85000,2.35000&r=1km');
  await expect(section(page).getByRole('group', { name: 'Sources des observations' }).getByRole('checkbox', { name: /GBIF/ })).not.toBeChecked();

  // The plants' origin: the flora's « Statut en France », below, opened.
  await section(page).getByRole('button', { name: 'Statut en France' }).click();
  await expect(page.locator('dl-search gf-facet[name="status"]')).toHaveAttribute('open', '');
});

test('fusionnées : une plante vue par GBIF seul dans la liste et sur la carte, la copie d’iNaturalist laissée ; la note dit les deux sources', async ({ app, page }) => {
  await answerZone(page);
  await answerGbif(page);
  await app.open(`${LAYOUT}?${AT}&sources=inat,gbif`);
  await expect.poll(async () => (await names(page)).length).toBe(13);
  expect(await names(page)).toContain('Sambucus nigra');
  await expect.poll(async () => (await mapPoints(page)).filter(p => p.kind === 'gbif').map(p => p.sci)).toEqual(['Sambucus nigra', 'Sambucus nigra']);
  expect((await mapPoints(page)).filter(p => p.kind === 'inat')).toHaveLength(24);
  await expect(page.locator('dl-search dl-results .scope')).toContainText('13 plantes dans les observations de la zone (iNaturalist et GBIF)');
  // A map of the group that shows iNaturalist's alone (src=inat): its points, the list the same.
  await app.go(`#/layout/[map(src=inat),search(filters=1)]?${AT}&sources=inat,gbif`);
  await expect.poll(async () => (await mapPoints(page)).every(p => p.kind === 'inat') && (await mapPoints(page)).length === 24).toBe(true);
  expect(await names(page)).toContain('Sambucus nigra');
  // The elder touched on the map: its plant chosen.
  await app.go(`${LAYOUT}?${AT}&sources=inat,gbif&p=${plantId('Sambucus nigra')}`);
  await expect.poll(() => param(page, 'p')).toBe(String(plantId('Sambucus nigra')));
});

test('une source en panne : dite dans la section et sur la carte, l’autre montrée', async ({ app, page }) => {
  await answerZone(page);
  await answerGbif(page, { down: true });
  await app.open(`${LAYOUT}?${AT}&sources=inat,gbif`);
  const map = page.locator('dl-map gf-map');
  await expect.poll(() => mapState(map)).toContain('GBIF ne répond pas : ses observations manquent sur la carte et dans la liste.');
  await expect(section(page).getByRole('group', { name: 'Sources des observations' }).locator('li').nth(1)).toContainText('ne répond pas');
  await expect.poll(async () => (await names(page)).length).toBe(12);
  await expect(page.locator('dl-search dl-results .scope')).toContainText('(iNaturalist)');
});
