// « Disposition libre » : the map cell's settings (registry.js `map`, map-options.js, cells.js dl-map), written in the
// layout's address. Où: its own scope while the address has none (lieu=: the place found as ?place= is; autour: around
// me), the address' always winning. Fond: the background, the 3D (map-3d on the map, its 3D adapter told). Couches: the
// IGN layers by their short names, given to the map as its own overlays (the catalogue's added), their tiles asked, an
// unknown name said and left out. Points: GBIF's beside iNaturalist's, a period (this month: dates kept), dots instead of
// photos. Liens: every plant of the scope (suit=0), the current plant alone (plante=seule), a point touched opening
// its sheet (toucher=fiche). Interface: none (no search, no buttons, no zone panel), compact by the cell's width. Intents:
// one word for a bundle (terrain, protege, repartition), a setting written beside it winning. The editor: the map's
// settings by group, a change written in the address. iNaturalist answered here: 12 plants around, 24 observations of
// three dates (this month, May of this year, this month two years ago); GBIF: 8 occurrences.
import { test, expect, answerAround, plantId } from './fixtures.mjs';

/** @typedef {import('@playwright/test').Page} Page */

test.use({ reducedMotion: 'reduce' });
test.skip(({ isMobile }) => isMobile, 'a wide screen: every cell in sight');

const NAMES = ['Urtica dioica', 'Allium ursinum', 'Conium maculatum', 'Geum urbanum', 'Taraxacum officinale', 'Quercus robur', 'Hedera helix',
  'Galium aparine', 'Plantago lanceolata', 'Bellis perennis', 'Ranunculus acris', 'Trifolium repens'];
const AT = 'at=48.85,2.35';
const now = new Date();
const THIS_MONTH = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-02`;
const OTHER_MONTH = `${now.getFullYear()}-${String(((now.getMonth() + 6) % 12) + 1).padStart(2, '0')}-02`;
const OLD_SAME_MONTH = `${now.getFullYear() - 2}-${String(now.getMonth() + 1).padStart(2, '0')}-02`;
/** Observation i's date: this month, another month of this year, this month two years ago. @param {number} i */
const dateOf = i => [THIS_MONTH, OTHER_MONTH, OLD_SAME_MONTH][i % 3];

test.beforeEach(async ({ context, page }) => {
  await answerAround(context);
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\/species_counts\?/, route => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ results: NAMES.map((name, i) => ({ count: 30 - i, taxon: { id: 1000 + i, name, preferred_common_name: null } })) }) }));
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\?/, route => {
    const taxon = Number(new URL(route.request().url()).searchParams.get('taxon_id')) || 0;
    const n = taxon ? 3 : 24;
    const results = Array.from({ length: n }, (_, i) => ({
      id: (taxon || 7) * 100 + i, observed_on: dateOf(i),
      geojson: { coordinates: [2.35 + ((i % 6) - 2.5) * 0.0018 + (taxon ? 0.0005 : 0), 48.85 + (Math.floor(i / 6) - 1.5) * 0.0015] },
      taxon: { id: taxon || 1000 + (i % 12), name: taxon ? NAMES[taxon - 1000] : NAMES[i % 12], preferred_common_name: null }
    }));
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ total_results: n, results }) });
  });
  await page.route(/^https:\/\/api\.gbif\.org\/v1\/occurrence\/search\?/, route => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ count: 8, results: Array.from({ length: 8 }, (_, i) => ({
      key: 4000 + i, decimalLatitude: 48.85 + (i - 4) * 0.001, decimalLongitude: 2.351, species: NAMES[i % 2], scientificName: NAMES[i % 2] + ' L.',
      eventDate: dateOf(i), datasetName: 'Inventaire du CBN', datasetKey: 'cbn' })) }) }));
});

/** A parameter of the state in the address. @param {Page} page @param {string} key */
const param = (page, key) => page.evaluate(k => new URLSearchParams(location.hash.split('?')[1] || '').get(k), key);
const layoutOf = (/** @type {Page} */ page) => page.evaluate(() => decodeURIComponent(location.hash.split('?')[0]));
/** The cell's map. @param {Page} page */
const mapOf = page => page.locator('dl-map gf-map');
/** What the cell gives its map: its own layers, background, points, the current plant's, how a point answers. @param {Page} page */
const given = page => mapOf(page).evaluate(m => {
  const g = /** @type {any} */ (m);
  return { base: g.base, overlays: g.overlays, leaves: g.area?.leaves ?? null, points: g.area?.points ?? null, highlight: g.highlight?.points?.length ?? null,
    cluster: g.cluster?.points?.length ?? null, noSearch: g.noSearch, noLocate: g.noLocate, track: g.track, click: g.pointClick, d3: g.getAttribute('map-3d') };
});
/** The map's points, once there. @param {Page} page */
const points = async page => { await expect.poll(async () => (await given(page)).points?.length ?? 0).toBeGreaterThan(0); return /** @type {any[]} */ ((await given(page)).points); };

test('fond, 3D et couches : photo, la 3D voulue puis à plat, les couches IGN par leurs noms courts (une inconnue dite et laissée)', async ({ app, page }) => {
  /** @type {string[]} */
  const tiles = [];
  page.on('request', r => { if (r.url().startsWith('https://data.geopf.fr/wmts')) tiles.push(new URL(r.url()).searchParams.get('LAYER') ?? ''); });
  await app.open(`#/layout/[map(photo;3d;layers=znieff+n2000+parcs+lune),plant]?${AT}`);
  await expect.poll(() => layoutOf(page)).toBe('#/layout/[map(base=photo,3d=1,layers=znieff+n2000+parcs),plant]');
  const g = await given(page);
  expect(g.base).toBe('photo');
  expect(g.overlays).toEqual(['ign:Patrinat_ZNIEFF1', 'ign:Patrinat_ZNIEFF2', 'ign:Patrinat_SIC', 'ign:Patrinat_ZPS', 'parcs']);
  expect(g.d3).toBe('on');
  // Its 3D adapter: the 3D wanted for this map, whatever Réglages › Cartes say.
  expect(await mapOf(page).evaluate(m => /** @type {any} */ (m).gl.state().wanted)).toBe(true);
  // The layers' tiles asked: the catalogue's (ZNIEFF, Natura 2000) and the app's own (Parcs nationaux).
  await expect.poll(() => ['ORTHOIMAGERY.ORTHOPHOTOS', 'Patrinat_ZNIEFF1', 'Patrinat_ZNIEFF2', 'Patrinat_SIC', 'Patrinat_ZPS', 'Patrinat_PN'].filter(l => !tiles.includes(l))).toEqual([]);
  // The layers not saved as every map's (the Carte's shared choice).
  expect(await page.evaluate(() => Object.entries(localStorage).filter(([k, v]) => /maplayer/i.test(k) && v.includes('ZNIEFF')).length)).toBe(0);
  // 2D written: the map stays flat (its adapter told at once).
  await app.go(`#/layout/[map(photo;2d),plant]?${AT}`);
  await expect.poll(async () => (await given(page)).d3).toBe('off');
  await expect.poll(() => mapOf(page).evaluate(m => /** @type {any} */ (m).gl.state().allowed)).toBe(false);
  // No layers written: the Carte's choice (null).
  expect((await given(page)).overlays).toBe(null);
});

test('points : une période (ce mois-ci, toutes années : la floraison du moment ; cette année), en pastilles, GBIF à côté d’iNaturalist', async ({ app, page }) => {
  await app.open(`#/layout/[map(r=1km),plant]?${AT}`);
  const all = await points(page);
  expect(all).toHaveLength(24);
  expect((await given(page)).leaves).toBe(true);
  await app.go(`#/layout/[map(r=1km;mois;pastille),plant]?${AT}`);
  await expect.poll(async () => (await given(page)).points?.length).toBe(16);
  const month = THIS_MONTH.slice(5, 7);
  expect((/** @type {any[]} */ ((await given(page)).points)).every(p => p.date.slice(5, 7) === month)).toBe(true);
  // Dots: the map's plain circles, no photo marker.
  expect((await given(page)).leaves).toBe(false);
  await expect(page.locator('dl-map path.gf-obs')).toHaveCount(16);
  await app.go(`#/layout/[map(r=1km;when=annee),plant]?${AT}`);
  await expect.poll(async () => ((await given(page)).points ?? []).map(p => p.date.slice(0, 4)).filter(y => y !== String(now.getFullYear())).length).toBe(0);
  expect((await given(page)).points).toHaveLength(16);
  // GBIF's too: its occurrences of the plants of the scope, beside iNaturalist's.
  await app.go(`#/layout/[map(r=1km;src=inat+gbif),plant]?${AT}`);
  await expect.poll(async () => ((await given(page)).points ?? []).filter(p => p.kind === 'gbif').length).toBe(8);
  expect((await given(page)).points).toHaveLength(32);
});

test('liens : toutes les plantes de la zone (suit=0), la plante courante seule ou pas montrée, un point touché ouvre sa fiche', async ({ app, page }) => {
  const ortie = plantId('Urtica dioica');
  // The search keeps a few plants: their points alone; suit=0, every plant observed.
  await app.open(`#/layout/[map(r=1km),search]?${AT}&q=${encodeURIComponent('Urtica dioica')}`);
  await expect.poll(async () => (await given(page)).points?.length ?? 0).toBeGreaterThan(0);
  await expect.poll(async () => (await given(page)).points?.length).toBeLessThan(12);
  await app.go(`#/layout/[map(r=1km;suit=0),search]?${AT}&q=${encodeURIComponent('Urtica dioica')}`);
  await expect.poll(async () => (await given(page)).points?.length).toBe(24);
  // The current plant alone: its points only, and its own observations, large.
  await app.go(`#/layout/[map(r=1km;plante=seule),plant]?${AT}&p=${ortie}`);
  await expect.poll(async () => (await given(page)).highlight).toBe(3);
  await expect.poll(async () => ((await given(page)).points ?? []).map(p => p.taxonId)).toEqual([1000, 1000]);
  // Not shown: no large points.
  await app.go(`#/layout/[map(r=1km;plante=non),plant]?${AT}&p=${ortie}`);
  await expect.poll(async () => (await given(page)).highlight).toBe(null);
  // Grouped (regroupe): the current plant's observations given as the map's cluster.
  await app.go(`#/layout/[map(r=1km;regroupe),plant]?${AT}&p=${ortie}`);
  await expect.poll(async () => (await given(page)).cluster).toBe(3);
  expect((await given(page)).highlight).toBe(null);
  // A point touched: its plant's sheet opens.
  await app.go(`#/layout/[map(r=1km;toucher=fiche),plant]?${AT}`);
  await points(page);
  const dot = page.locator('dl-map .leaflet-marker-pane .gf-obs-leaf:not(.gf-leave)').first();
  await expect(dot).toBeVisible();
  await dot.click();
  await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/plant\/\d+$/);
  const id = Number((await page.evaluate(() => location.hash)).split('/').pop());
  expect(NAMES.map(plantId)).toContain(id);
  // Nothing (toucher=rien): the map's points answer nothing.
  await app.open(`#/layout/[map(r=1km;rien),plant]?${AT}`);
  await expect.poll(async () => (await given(page)).click).toBe('none');
});

test('interface : aucune commande (nue), compacte dans une case étroite (auto), complète', async ({ app, page }) => {
  await app.open(`#/layout/[map(r=1km;ui=nue),plant]?${AT}`);
  await expect(mapOf(page)).toBeVisible();
  await expect.poll(async () => (await given(page)).noSearch).toBe(true);
  await expect(page.locator('dl-map gf-map-search')).toHaveCount(0);
  await expect(page.locator('dl-map .gf-map-buttons')).toBeHidden();
  await expect(page.locator('dl-map .leaflet-control-zoom')).toBeHidden();
  await expect(page.locator('dl-map .panel')).toHaveCount(0);
  // A narrow cell (auto): compact — no address search, the zone a pill at the top (« 1 km ▾ »), « Autour de moi »
  // under it once opened.
  await app.go(`#/layout/[map(r=1km)@20,plant,search]?${AT}`);
  await expect(page.locator('dl-map')).toHaveAttribute('ui', 'compacte');
  await expect(page.locator('dl-map gf-map-search')).toHaveCount(0);
  await expect(page.locator('dl-map .zone > button')).toHaveText(/1 km/);
  await expect(page.locator('dl-map .gf-map-buttons .layers')).toBeVisible();
  await page.locator('dl-map .zone > button').click();
  await expect(page.locator('dl-map').getByRole('button', { name: 'Autour de moi' })).toBeVisible();
  // Wide: complete — the search there again (the map's own controls made again with it).
  await app.go(`#/layout/[map(r=1km)@50,plant]?${AT}`);
  await expect(page.locator('dl-map')).toHaveAttribute('ui', 'complete');
  await expect(page.locator('dl-map gf-map-search')).toHaveCount(1);
  await expect(page.locator('dl-map .gf-map-buttons .layers')).toHaveCount(0);
  await expect(page.locator('dl-map .panel:not(.compact)')).toBeVisible();
});

test('intentions : terrain (photo, compacte, autour de moi), protégé (les espaces protégés), répartition ; un réglage écrit à côté l’emporte', async ({ app, page }) => {
  // terrain: no scope in the address, around me (the position of the tests), photos, compact controls, my position followed.
  await app.open('#/layout/[map(terrain),plant]');
  await expect.poll(() => param(page, 'at')).toBe('48.85000,2.35000');
  let g = await given(page);
  expect([g.base, g.noSearch, g.track]).toEqual(['photo', true, true]);
  await expect(page.locator('dl-map')).toHaveAttribute('ui', 'compacte');
  // The scope taken off (✕, in its pill): it stays off.
  await page.locator('dl-map .zone > button').click();
  await page.locator('dl-map').getByRole('button', { name: 'Toute la France (sans zone)' }).click();
  await expect.poll(() => param(page, 'at')).toBe(null);
  await page.waitForTimeout(300);
  expect(await param(page, 'at')).toBe(null);
  // A setting written beside it wins, wherever: the plan; written as the intent gives it, left out of the address.
  await app.go(`#/layout/[map(base=plan;terrain),plant]?${AT}`);
  await expect.poll(async () => (await given(page)).base).toBe('plan');
  await app.go(`#/layout/[map(terrain;base=photo;r=2km),plant]?${AT}`);
  await expect.poll(() => layoutOf(page)).toBe('#/layout/[map(terrain,r=2km),plant]');
  // protégé: the protected areas.
  await app.go(`#/layout/[map(protégé),plant]?${AT}`);
  await expect.poll(() => layoutOf(page)).toBe('#/layout/[map(protege),plant]');
  g = await given(page);
  expect(g.overlays).toEqual(['ign:Patrinat_ZNIEFF1', 'ign:Patrinat_ZNIEFF2', 'ign:Patrinat_SIC', 'ign:Patrinat_ZPS', 'parcs', 'reserves', 'biotopes']);
  // répartition: the current plant alone, from iNaturalist and GBIF.
  await app.go(`#/layout/[map(répartition;r=1km),plant]?${AT}&p=${plantId('Urtica dioica')}`);
  await expect.poll(async () => ((await given(page)).points ?? []).map(p => p.kind === 'gbif' ? 'gbif' : 'inat').sort()).toEqual(['gbif', 'gbif', 'gbif', 'gbif', 'inat', 'inat']);
});

test('où : un lieu de départ trouvé comme ?place= l’est, tant que l’adresse n’a pas de zone — la sienne l’emporte', async ({ app, page }) => {
  /** @type {string[]} */
  const asked = [];
  await page.route(/^https:\/\/data\.geopf\.fr\/geocodage\/completion\?/, route => {
    const text = new URL(route.request().url()).searchParams.get('text') ?? '';
    asked.push(text);
    const results = text === 'Mirabel Ménétrol' ? [{ fulltext: 'Colline de Mirabel, 63200 Ménétrol', zipcode: '63200', city: 'Ménétrol', kind: 'lieu-dit', x: 3.1116, y: 45.8726 }] : [];
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'OK', results }) });
  });
  await app.open(`#/layout/[map(lieu=Mirabel Ménétrol 63;r=2km),plant]`);
  await expect.poll(() => param(page, 'at')).toBe('45.87260,3.11160');
  expect(await param(page, 'place')).toBe('Colline de Mirabel (Ménétrol)');
  expect(asked).toEqual(['Mirabel Ménétrol']);
  expect(await layoutOf(page)).toBe('#/layout/[map(r=2km,lieu=Mirabel Ménétrol 63),plant]');
  // The address' scope wins.
  await app.open(`#/layout/[map(lieu=Mirabel Ménétrol 63;r=2km),plant]?${AT}`);
  await expect.poll(() => mapOf(page).evaluate(m => /** @type {any} */ (m).area?.center)).toEqual([2.35, 48.85]);
  expect(asked).toHaveLength(1);
});

test('« Créer une app » : les réglages de la carte par groupe, un choix écrit dans l’adresse', async ({ app, page }) => {
  await app.open(`#/builder?g=[map(terrain;r=1km),plant]&${AT}`);
  await page.locator('gf-builder gf-layout section.cell[data-comp="map"] .cell-head .pick').click();
  const p = page.locator('gf-block-picker:not([inline])');
  await expect(p.locator('.row b')).toHaveText(['Que montre-t-il ?', /^Où/, 'Fond', 'Couches', 'Points', 'Liens', 'Interface', 'Cadre']);
  // What the intent gives, said as such.
  await p.locator('.row[data-group="Fond"]').click();
  await expect(p.locator('[data-param="base"] .note')).toHaveText('selon l’intention');
  await expect(p.locator('[data-param="base"] button[data-value="photo"]')).toHaveAttribute('aria-pressed', 'true');
  await p.locator('.back').click();
  await p.locator('.row[data-group="Liens"]').click();
  await p.locator('[data-param="toucher"] button[data-value="fiche"]').click();
  await p.locator('.back').click();
  await p.locator('.row[data-group="Couches"]').click();
  await p.locator('[data-param="layers"] button[data-value="znieff"]').click();
  await expect.poll(() => page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] || '').get('g'))).toBe('[map(terrain,r=1km,layers=znieff,toucher=fiche),plant]');
});
