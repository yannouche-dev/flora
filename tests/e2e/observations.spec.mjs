// « Écran sur mesure » : the zone's observations, one layer over iNaturalist and GBIF (core/observations.js), and their
// filters first in the list's (layout/obs-filters.js « Observations de la zone », slotted in gf-filter-panel): shown
// once the group has a zone; every one ticked by default (both sources, every quality grade, every dataset, the
// cultivated plants), one at least kept of each list (the last box off, why said); each setting written in the address (sources=, sansjeux=,
// taxon=, qualite=, photos=, sauvages=) and asked of each source in its own words (iNaturalist: quality_grade, hrank,
// photo_license, captive; GBIF: mediaType, datasetKey, its datasets counted); GBIF's datasets in the zone with their
// titles and counts (iNaturalist's copy left out), « Tout cocher » (the focus kept); an address of before naming those
// asked alone (jeux=): those ticked, one ticked more added to them; a plant seen by GBIF alone in the list and on the
// map; reloaded, the same; « effacer »: the layout's own again; the plants' origin, the « Statut en France » below; a
// source that fails said, the other shown; a source whose module is off left out by default (never said missing on
// the map), said when the address asks it; the zone's only dataset said so; the deck, iNaturalist down, when the search
// leaves none of GBIF's plants.
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
 * GBIF answered as it does (its occurrences around the point asked, the datasets chosen only — none with limit=0; its
 * datasets counted as if none were, when asked; their titles). `seen`: the addresses of its occurrences asked; `only`:
 * the zone's datasets but those (and its copy of iNaturalist's).
 * @param {Page} page @param {{ seen?: string[], only?: string[] }} [o]
 */
async function answerGbif(page, { seen, only } = {}) {
  await page.route(/^https:\/\/api\.gbif\.org\/v1\/occurrence\/search\?/, route => {
    const url = new URL(route.request().url());
    seen?.push(url.href);
    const [lat, lng] = (url.searchParams.get('geoDistance') || '0,0,1km').split(',').map(Number);
    const media = [{ type: 'StillImage', license: 'http://creativecommons.org/licenses/by/4.0/' }];
    const row = (/** @type {number} */ key, /** @type {string} */ species, /** @type {string} */ datasetKey, /** @type {number} */ d) => ({ key, decimalLatitude: lat + d, decimalLongitude: lng + d,
      species, scientificName: species + ' L.', taxonRank: 'SPECIES', eventDate: '2026-06-0' + (key % 9 + 1), datasetKey, datasetName: TITLES[datasetKey] ?? 'iNaturalist', media });
    const zone = (/** @type {string} */ key) => !only || only.includes(key) || key === INAT_DATASET;
    const all = [row(5001, 'Sambucus nigra', 'cbn-mc', 0.001), row(5002, 'Sambucus nigra', 'plantnet', -0.001), row(5003, 'Urtica dioica', INAT_DATASET, 0.002)].filter(r => zone(r.datasetKey));
    const chosen = url.searchParams.getAll('datasetKey');
    const results = url.searchParams.get('limit') === '0' ? [] : chosen.length ? all.filter(r => chosen.includes(r.datasetKey)) : all;
    const counts = [{ name: INAT_DATASET, count: 100 }, { name: 'cbn-mc', count: 30 }, { name: 'plantnet', count: 12 }].filter(c => zone(c.name));
    const count = counts.filter(c => !chosen.length || chosen.includes(c.name)).reduce((n, c) => n + c.count, 0);
    return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ count, results, ...(url.searchParams.get('facet') ? { facets: [{ field: 'DATASET_KEY', counts }] } : {}) }) });
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
/**
 * GBIF's last request of a kind, its parameters: its count and datasets (limit=0), or their occurrences (limit=300).
 * @param {string[]} seen @param {'0' | '300'} limit
 */
const gbifAsked = (seen, limit) => new URL([...seen].reverse().find(u => new URL(u).searchParams.get('limit') === limit) ?? 'https://x/').searchParams;

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
  // A zone: the section first, every observation — both sources, iNaturalist without a quality grade, GBIF in two
  // requests: the zone's count and datasets first, then the occurrences of its datasets but iNaturalist's copy.
  await app.go(`${LAYOUT}?${AT}`);
  await expect(section(page).getByRole('button', { name: 'Observations de la zone' })).toBeVisible();
  await expect(section(page).locator('.badge')).toHaveCount(0);
  const sources = section(page).getByRole('group', { name: 'Sources des observations' });
  for (const name of [/iNaturalist/, /GBIF/]) {
    await expect(sources.getByRole('checkbox', { name })).toBeChecked();
    await expect(sources.getByRole('checkbox', { name })).toBeEnabled();
  }
  await expect(sources.locator('li').first()).toContainText('24');
  await expect.poll(() => inat.length).toBeGreaterThan(0);
  expect(lastAsked(inat).has('quality_grade')).toBe(false);
  await expect.poll(() => gbif.length).toBeGreaterThan(1);
  const head = gbifAsked(gbif, '0');
  expect([head.get('taxonKey'), head.get('facet'), head.get('facetMultiselect'), head.get('datasetKey.facetLimit'), head.getAll('datasetKey')])
    .toEqual(['6', 'datasetKey', 'true', '50', []]);
  await expect.poll(() => { const q = gbifAsked(gbif, '300'); return [q.getAll('datasetKey'), q.get('facet')]; }).toEqual([['cbn-mc', 'plantnet'], null]);
  // GBIF's count without its copy of iNaturalist's; the elder, seen by GBIF alone, among the plants.
  await expect(sources.locator('li').nth(1)).toContainText('42');
  await expect.poll(async () => (await names(page)).length).toBe(13);

  // GBIF left: written; iNaturalist then kept (one source at least); ticked again: the layout's own, nothing written.
  await sources.getByRole('checkbox', { name: /GBIF/ }).uncheck();
  await expect.poll(() => param(page, 'sources')).toBe('inat');
  await expect(sources.getByRole('checkbox', { name: /iNaturalist/ })).toBeDisabled();
  await expect(sources.getByRole('checkbox', { name: /iNaturalist/ })).toHaveAccessibleDescription('Une source au moins : cochez GBIF pour décocher celle-ci.');
  await expect(section(page).getByRole('group', { name: 'Jeux de données GBIF' })).toHaveCount(0);
  await expect.poll(async () => (await names(page)).length).toBe(12);
  await sources.getByRole('checkbox', { name: /GBIF/ }).check();
  await expect.poll(() => param(page, 'sources')).toBe(null);
  // iNaturalist left: its quality grades said not to apply (GBIF has none), their boxes off.
  await sources.getByRole('checkbox', { name: /iNaturalist/ }).uncheck();
  await expect.poll(() => param(page, 'sources')).toBe('gbif');
  await expect(section(page).getByRole('group', { name: 'Qualité' }).getByRole('checkbox')).toHaveCount(3);
  for (const box of await section(page).getByRole('group', { name: 'Qualité' }).getByRole('checkbox').all()) await expect(box).toBeDisabled();
  await sources.getByRole('checkbox', { name: /iNaturalist/ }).check();
  await expect.poll(() => param(page, 'sources')).toBe(null);

  // Its datasets in the zone: their titles and counts, iNaturalist's copy not among them, every one ticked; one left
  // out: written, never asked, its records not counted; the other kept (one at least); « Tout cocher » then.
  const datasets = section(page).getByRole('group', { name: 'Jeux de données GBIF' });
  await expect(datasets.getByRole('checkbox')).toHaveCount(2);
  await expect(datasets.locator('li').first()).toContainText(TITLES['cbn-mc']);
  await expect(datasets.locator('li').first()).toContainText('30');
  await expect(datasets.locator('li').nth(1)).toContainText(TITLES.plantnet);
  for (const box of await datasets.getByRole('checkbox').all()) await expect(box).toBeChecked();
  await expect(datasets.getByRole('button', { name: 'Tout cocher' })).toHaveCount(0);
  const plantnet = datasets.getByRole('checkbox', { name: new RegExp(TITLES.plantnet.replace(/[.@]/g, '.')) });
  await plantnet.uncheck();
  await expect.poll(() => param(page, 'sansjeux')).toBe('plantnet');
  await expect.poll(() => gbifAsked(gbif, '300').getAll('datasetKey')).toEqual(['cbn-mc']);
  await expect(sources.locator('li').nth(1)).toContainText('30');
  await expect(datasets.getByRole('checkbox', { name: new RegExp(TITLES['cbn-mc']) })).toBeDisabled();
  await expect(datasets.getByRole('checkbox', { name: new RegExp(TITLES['cbn-mc']) })).toHaveAccessibleDescription('Un jeu au moins : cochez-en un autre pour décocher celui-ci.');
  await expect(datasets.getByRole('checkbox'), 'the one left out still there to tick').toHaveCount(2);
  await expect(datasets.getByRole('button', { name: 'Tout cocher' })).toBeVisible();

  // The rank, the quality grades, a free photo, the cultivated plants: each written, each asked in each source's words.
  await section(page).getByRole('group', { name: 'Taxon' }).getByRole('button', { name: 'À l’espèce' }).click();
  await expect.poll(() => param(page, 'taxon')).toBe('espece');
  const quality = section(page).getByRole('group', { name: 'Qualité' });
  for (const box of await quality.getByRole('checkbox').all()) await expect(box).toBeChecked();
  await quality.getByRole('checkbox', { name: 'Occasionnelles : cultivées ou captives, sans photo, date ou lieu précis' }).uncheck();
  await expect.poll(() => param(page, 'qualite')).toBe('verifiables');
  await expect.poll(() => lastAsked(inat).get('quality_grade')).toBe('research,needs_id');
  await expect(section(page)).toContainText('GBIF n’a pas de note de qualité');
  // iNaturalist's cultivated plants among its casual ones: the box of the cultivated plants says so.
  await expect(section(page).getByRole('checkbox', { name: 'Plantes cultivées ou captives' }))
    .toHaveAccessibleDescription('iNaturalist range ses plantes cultivées ou captives parmi les « Occasionnelles » : cochez-les pour voir les siennes.');
  await quality.getByRole('checkbox', { name: 'Vérifiées' }).uncheck();
  await expect.poll(() => param(page, 'qualite')).toBe('aidentifier');
  await expect(quality.getByRole('checkbox', { name: 'À identifier' }), 'one grade at least').toBeDisabled();
  await expect(quality.getByRole('checkbox', { name: 'À identifier' })).toHaveAccessibleDescription('Une qualité au moins : cochez-en une autre pour décocher celle-ci.');
  await section(page).getByRole('group', { name: 'Photo' }).getByRole('button', { name: 'Photo libre' }).click();
  await expect.poll(() => param(page, 'photos')).toBe('libre');
  const grown = section(page).getByRole('checkbox', { name: 'Plantes cultivées ou captives' });
  await expect(grown).toBeChecked();
  await grown.uncheck();
  await expect.poll(() => param(page, 'sauvages')).toBe('1');
  await expect.poll(() => { const q = lastAsked(inat); return [q.get('hrank'), q.get('quality_grade'), q.get('photo_license'), q.get('captive')]; })
    .toEqual(['species', 'needs_id', 'cc0,cc-by,cc-by-sa', 'false']);
  await expect.poll(() => [gbifAsked(gbif, '0').get('mediaType'), gbifAsked(gbif, '300').get('mediaType')]).toEqual(['StillImage', 'StillImage']);
  await expect(section(page).locator('.badge')).toHaveText('5');

  // Reloaded: the same settings shown.
  await page.reload();
  await app.ready();
  await expect(section(page).getByRole('group', { name: 'Taxon' }).getByRole('button', { name: 'À l’espèce' })).toHaveAttribute('aria-pressed', 'true');
  await expect(section(page).getByRole('group', { name: 'Photo' }).getByRole('button', { name: 'Photo libre' })).toHaveAttribute('aria-pressed', 'true');
  await expect(section(page).getByRole('checkbox', { name: 'Plantes cultivées ou captives' })).not.toBeChecked();
  await expect(quality.getByRole('checkbox', { name: 'Vérifiées' })).not.toBeChecked();
  await expect(quality.getByRole('checkbox', { name: 'À identifier' })).toBeChecked();
  await expect(datasets.getByRole('checkbox', { name: /Pl@ntNet/ })).not.toBeChecked();
  await expect(datasets.getByRole('checkbox', { name: new RegExp(TITLES['cbn-mc']) })).toBeChecked();

  // « Tout cocher » (the keyboard): every dataset again, nothing written for them; the button gone, the focus on the
  // first one, not lost.
  await datasets.getByRole('button', { name: 'Tout cocher' }).press('Enter');
  await expect.poll(() => param(page, 'sansjeux')).toBe(null);
  await expect(datasets.getByRole('checkbox', { name: /Pl@ntNet/ })).toBeChecked();
  await expect(datasets.getByRole('button', { name: 'Tout cocher' })).toHaveCount(0);
  await expect(datasets.getByRole('checkbox').first()).toBeFocused();
  await expect.poll(() => gbifAsked(gbif, '300').getAll('datasetKey')).toEqual(['cbn-mc', 'plantnet']);

  // « effacer »: the layout's own again — none of these keys in the address, every box ticked.
  await section(page).getByRole('button', { name: 'effacer' }).click();
  await expect.poll(() => page.evaluate(() => location.hash.split('?')[1])).toBe('at=48.85000,2.35000&r=1km');
  await expect(section(page).getByRole('group', { name: 'Sources des observations' }).getByRole('checkbox', { name: /GBIF/ })).toBeChecked();
  for (const box of await quality.getByRole('checkbox').all()) await expect(box).toBeChecked();
  await expect(section(page).getByRole('checkbox', { name: 'Plantes cultivées ou captives' })).toBeChecked();

  // The plants' origin: the flora's « Statut en France », below, opened.
  await section(page).getByRole('button', { name: 'Statut en France' }).click();
  await expect(page.locator('dl-search gf-facet[name="status"]')).toHaveAttribute('open', '');
});

test('une adresse d’avant qui nomme ses jeux (jeux=) : ceux-là seuls cochés et demandés ; un autre coché s’y ajoute ; « Tout cocher » les efface', async ({ app, page }) => {
  /** @type {string[]} */ const gbif = [];
  await answerZone(page);
  await answerGbif(page, { seen: gbif });
  await app.open(`${LAYOUT}?${AT}&jeux=plantnet`);
  const datasets = section(page).getByRole('group', { name: 'Jeux de données GBIF' });
  const plantnet = datasets.getByRole('checkbox', { name: /Pl@ntNet/ });
  const cbn = datasets.getByRole('checkbox', { name: new RegExp(TITLES['cbn-mc']) });
  // Pl@ntNet alone ticked (the last one: kept, why said), asked alone; the CBN there to tick.
  await expect(plantnet).toBeChecked();
  await expect(plantnet).toBeDisabled();
  await expect(plantnet).toHaveAccessibleDescription('Un jeu au moins : cochez-en un autre pour décocher celui-ci.');
  await expect(cbn).not.toBeChecked();
  await expect(datasets.getByRole('button', { name: 'Tout cocher' })).toBeVisible();
  await expect.poll(() => gbifAsked(gbif, '300').getAll('datasetKey')).toEqual(['plantnet']);
  // The CBN ticked: among those named (jeux=), never a dataset left out (sansjeux=).
  await cbn.check();
  await expect.poll(() => param(page, 'jeux')).toBe('cbn-mc,plantnet');
  expect(await param(page, 'sansjeux')).toBe(null);
  await expect.poll(() => gbifAsked(gbif, '300').getAll('datasetKey')).toEqual(['cbn-mc', 'plantnet']);
  await expect(plantnet).toBeEnabled();
  // Pl@ntNet unticked: the CBN alone named; « Tout cocher »: none named, every one ticked.
  await plantnet.uncheck();
  await expect.poll(() => param(page, 'jeux')).toBe('cbn-mc');
  await datasets.getByRole('button', { name: 'Tout cocher' }).click();
  await expect.poll(() => param(page, 'jeux')).toBe(null);
  expect(await param(page, 'sansjeux')).toBe(null);
  for (const box of [plantnet, cbn]) await expect(box).toBeChecked();
});

test('fusionnées : une plante vue par GBIF seul dans la liste et sur la carte, la copie d’iNaturalist laissée ; la note dit les deux sources', async ({ app, page }) => {
  await answerZone(page);
  await answerGbif(page);
  await app.open(`${LAYOUT}?${AT}`);
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
  await app.go(`${LAYOUT}?${AT}&p=${plantId('Sambucus nigra')}`);
  await expect.poll(() => param(page, 'p')).toBe(String(plantId('Sambucus nigra')));
});

test('une source en panne : dite dans la section et sur la carte, l’autre montrée', async ({ app, page }) => {
  await answerZone(page, { gbif: false });
  await app.open(`${LAYOUT}?${AT}`);
  const map = page.locator('dl-map gf-map');
  await expect.poll(() => mapState(map)).toContain('GBIF ne répond pas : ses observations manquent sur la carte et dans la liste.');
  await expect(section(page).getByRole('group', { name: 'Sources des observations' }).locator('li').nth(1)).toContainText('ne répond pas');
  await expect.poll(async () => (await names(page)).length).toBe(12);
  await expect(page.locator('dl-search dl-results .scope')).toContainText('(iNaturalist)');
});

test('un module coupé (Réglages › Modules) : sa source laissée par défaut, jamais demandée ni dite manquante sur la carte ; demandée par l’adresse, dite', async ({ app, page }) => {
  /** @type {string[]} */ const gbif = [];
  await page.addInitScript(() => localStorage.setItem('geoflora.modules', JSON.stringify({ gbif: false })));
  await answerZone(page);
  await answerGbif(page, { seen: gbif });
  await app.open(`${LAYOUT}?${AT}`);
  const sources = section(page).getByRole('group', { name: 'Sources des observations' });
  await expect(sources.locator('li').first()).toContainText('24');
  await expect(sources.getByRole('checkbox', { name: /GBIF/ })).not.toBeChecked();
  await expect(sources.locator('li').nth(1)).toContainText('module désactivé');
  await expect(page.locator('dl-search dl-results .scope')).toContainText('12 plantes dans les observations de la zone (iNaturalist)');
  const map = page.locator('dl-map gf-map');
  expect((await mapState(map)).filter(l => /manquent/.test(l))).toEqual([]);
  expect([gbif, await param(page, 'sources')]).toEqual([[], null]);
  // The address asks GBIF: its module said off, as before — it was asked.
  await app.go(`${LAYOUT}?${AT}&sources=inat,gbif`);
  await expect.poll(() => mapState(map)).toContain('Le module GBIF est désactivé : ses observations manquent sur la carte et dans la liste.');
});

test('le seul jeu GBIF de la zone : sa case grisée, dit ; « décochez GBIF » seulement quand sa case peut l’être', async ({ app, page }) => {
  await answerZone(page);
  await answerGbif(page, { only: ['plantnet'] });
  await app.open(`${LAYOUT}?${AT}`);
  const plantnet = section(page).getByRole('group', { name: 'Jeux de données GBIF' }).getByRole('checkbox', { name: /Pl@ntNet/ });
  await expect(plantnet).toBeDisabled();
  await expect(plantnet).toHaveAccessibleDescription('Le seul jeu de la zone : décochez GBIF pour ne pas le voir.');
  // GBIF alone (its box off): said plainly, without what cannot be done.
  const sources = section(page).getByRole('group', { name: 'Sources des observations' });
  await sources.getByRole('checkbox', { name: /iNaturalist/ }).uncheck();
  await expect(sources.getByRole('checkbox', { name: /GBIF/ })).toBeDisabled();
  await expect(plantnet).toHaveAccessibleDescription('Le seul jeu de la zone.');
});

test('les cartes de Rencontres, iNaturalist en panne : les plantes de GBIF que la recherche écarte dites comme telles, jamais « GBIF n’a vu aucune plante »', async ({ app, page }) => {
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\?/, route => route.fulfill({ status: 503, body: '' }));
  await answerGbif(page);
  // The search (ortie) keeps none of the plants GBIF saw here (the elder).
  await app.open(`#/layout/[map,deck]?${AT}&q=ortie`);
  const said = page.locator('dl-deck .empty');
  await expect(said).toContainText('iNaturalist ne répond pas');
  await expect(said).toContainText('Aucune des plantes que GBIF a vues dans la zone ne correspond à la recherche ; sans iNaturalist, pas de cartes pour l’instant.');
  // Without the search: the elder, a card.
  await app.go(`#/layout/[map,deck]?${AT}`);
  await expect(page.locator('dl-deck ma-deck .swipe-card.top')).toHaveAttribute('data-id', String(plantId('Sambucus nigra')));
});
