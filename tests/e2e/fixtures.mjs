// What every spec starts from (import { test, expect } from './fixtures.mjs'):
//  - the network: every request outside the app's own server answered here (pictures: a small blank image; the rest
//    503), so the app's offline and degraded paths run, never a real service; a spec answers some services itself
//    with ctx.route / page.route (registered later, so tried first) and route.fallback() for the rest;
//  - the flora: data/plants.json and data/meta.json served from tests/fixtures (300 plants, fingerprint matching),
//    unless the spec sets `realData: true`;
//  - the visitor: returning (Découvrir done, every tab there) by default, `firstVisit: true` for a first launch;
//  - no uncaught page error: any one fails the test after it ran.
import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const FIXTURE = new URL('../fixtures/', import.meta.url);
const PLANTS = readFileSync(new URL('plants.json', FIXTURE));
const META = readFileSync(new URL('meta.json', FIXTURE));
export const fixturePlants = JSON.parse(PLANTS.toString('utf8'));
export const BLANK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#7fae6b"/></svg>';

/** The id of a plant of the reduced flora, by its scientific name (never a TAXREF id written in a spec). @param {string} name */
export function plantId(name) {
  const p = fixturePlants.find((/** @type {any} */ x) => x.scientificName === name);
  if (!p) throw new Error(`${name}: not in tests/fixtures/plants.json`);
  return /** @type {number} */ (p.id);
}

/**
 * Prepares a browser context as every spec expects it (see above): outside requests answered, the reduced flora
 * served, the visitor returning unless asked.
 * @param {import('@playwright/test').BrowserContext} context
 * @param {{ baseURL: string, realData?: boolean, firstVisit?: boolean, offlineData?: boolean }} options
 */
export async function prepare(context, { baseURL, realData = false, firstVisit = false, offlineData = false }) {
  const origin = new URL(baseURL).origin;
  await context.route(url => url.origin !== origin, route =>
    route.request().resourceType() === 'image'
      ? route.fulfill({ contentType: 'image/svg+xml', body: BLANK_SVG })
      : route.fulfill({ status: 503, body: '' }));
  if (offlineData) await context.route(/\/data\/(plants|meta)\.json(\?|$)/, route => route.fulfill({ status: 503, body: '' }));
  else if (!realData) {
    await context.route(/\/data\/plants\.json(\?|$)/, route => route.fulfill({ contentType: 'application/json', body: PLANTS }));
    await context.route(/\/data\/meta\.json(\?|$)/, route => route.fulfill({ contentType: 'application/json', body: META }));
  }
  if (!firstVisit) {
    await context.addInitScript(() => {
      if (!localStorage.getItem('geoflora.discover')) localStorage.setItem('geoflora.discover', JSON.stringify({ done: true }));
    });
  }
}

const NAMES = ['Urtica dioica', 'Allium ursinum', 'Conium maculatum', 'Geum urbanum', 'Taraxacum officinale', 'Quercus robur',
  'Hedera helix', 'Galium aparine', 'Plantago lanceolata', 'Bellis perennis', 'Ranunculus acris', 'Trifolium repens'];
const COUNTS = [12, 80, 5, 40, 66, 3, 25, 9, 51, 30, 18, 7];
const ARTICLE = 'La plante est une espèce vivace.\n\n== Phytonymie ==\n\n=== Étymologie ===\nSon nom vient du latin ursus, l’ours.\n\n== Description ==\nFeuilles larges.';

/**
 * Rencontres' services answered (Découvrir, the mini-app): iNaturalist's plants around (12, Allium ursinum the
 * most observed), 30 observations on the map, Wikidata and Wikipédia's article of each.
 * @param {import('@playwright/test').BrowserContext} context
 */
export async function answerAround(context) {
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
}

const OBS_NAMES = [['Ortie dioïque', 'Urtica dioica'], ['Ail des ours', 'Allium ursinum'], ['Pâquerette', 'Bellis perennis'], ['Benoîte commune', 'Geum urbanum'],
  ['Pissenlit', 'Taraxacum officinale'], ['Lierre grimpant', 'Hedera helix'], ['Plantain lancéolé', 'Plantago lanceolata'], ['Bouton d’or', 'Ranunculus acris']];

/**
 * The observations around a centre, for the maps in 3D (gf-map-obs3d.js): iNaturalist's (`inat` of them, each with a
 * free photo, one in four in the same species, Ortie dioïque) and GBIF's (`gbif`, one of iNaturalist's copies among
 * them, left out by the app), spread in the circle asked — and `outside` of each just beyond it (the app keeps only
 * those inside). `seen`: the addresses asked.
 * @param {import('@playwright/test').Page | import('@playwright/test').BrowserContext} page
 * @param {{ inat?: number, gbif?: number, outside?: number, seen?: string[] }} [o]
 */
export async function answerObservations(page, { inat = 60, gbif = 24, outside = 6, seen } = {}) {
  /** Points spread in a circle (a sunflower's spiral), then `outside` beyond it. @param {number} lat @param {number} lng @param {number} km @param {number} n */
  const spread = (lat, lng, km, n) => Array.from({ length: n + outside }, (_, i) => {
    const out = i >= n, r = out ? km * (1.15 + 0.1 * (i - n)) : km * 0.93 * Math.sqrt((i + 0.5) / n), a = i * 2.39996;
    return [lng + (r * Math.sin(a)) / (111.32 * Math.cos(lat * Math.PI / 180)), lat + (r * Math.cos(a)) / 110.54];
  });
  const json = (/** @type {import('@playwright/test').Route} */ route, /** @type {any} */ body) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\?/, route => {
    const q = new URL(route.request().url()).searchParams;
    seen?.push(route.request().url());
    if (q.get('page') && q.get('page') !== '1') return json(route, { total_results: inat + outside, results: [] });
    const pts = spread(Number(q.get('lat')), Number(q.get('lng')), Number(q.get('radius')), inat);
    return json(route, { total_results: pts.length, results: pts.map(([x, y], i) => {
      const [common, sci] = OBS_NAMES[i % 4 === 0 ? 0 : i % OBS_NAMES.length];
      return { id: 9000 + i, uri: `https://www.inaturalist.org/observations/${9000 + i}`, geojson: { type: 'Point', coordinates: [x, y] }, observed_on: '2026-05-' + String(1 + (i % 28)).padStart(2, '0'),
        place_guess: 'Clermont-Ferrand', taxon: { id: 50 + (i % 4 === 0 ? 0 : i % OBS_NAMES.length), name: sci, preferred_common_name: common },
        photos: [{ id: 7000 + i, url: `https://inaturalist-open-data.s3.amazonaws.com/photos/${7000 + i}/square.jpg`, license_code: 'cc-by', attribution: '(c) Camille, some rights reserved (CC BY)' }] };
    }) });
  });
  await page.route(/^https:\/\/api\.gbif\.org\/v1\/occurrence\/search\?/, route => {
    const url = new URL(route.request().url());
    seen?.push(url.href);
    const [lat, lng, km] = (url.searchParams.get('geoDistance') || '0,0,1km').replace('km', '').split(',').map(Number);
    const pts = spread(lat, lng, km, gbif);
    return json(route, { count: pts.length, results: pts.map(([x, y], i) => ({
      key: 4000 + i, decimalLatitude: y, decimalLongitude: x, species: OBS_NAMES[(i + 3) % OBS_NAMES.length][1], scientificName: OBS_NAMES[(i + 3) % OBS_NAMES.length][1] + ' L.',
      eventDate: '2024-06-1' + (i % 10), datasetName: 'Inventaire du CBN', datasetKey: i === 0 ? '50c9509d-22c7-4a22-a47d-8c48425ef4a7' : 'cbn-mc'
    })) });
  });
}

/** GBIF's copy of iNaturalist's research-grade observations (core/around3d.js INAT_DATASET). */
const INAT_DATASET = '50c9509d-22c7-4a22-a47d-8c48425ef4a7';

/**
 * A plant sheet's map and its sources (gf-sheet-map.js): the nettle (Urtica dioica) found on GBIF (taxon 5341) and on
 * iNaturalist (taxon 48460, its own photo under CC BY-NC: never shown, the flora's thumbnail is), and its records:
 * around a point (iNaturalist's `inat` observations, GBIF's `gbif` occurrences — one of them GBIF's copy of an
 * iNaturalist one, left out when iNaturalist's are shown too), spread in the circle asked, each source on its own
 * side (iNaturalist west, GBIF east); and in an area touched in the sheet (a GADM id: `area` occurrences around Paris).
 * `seen`: the addresses asked.
 * @param {import('@playwright/test').Page | import('@playwright/test').BrowserContext} page
 * @param {{ inat?: number, gbif?: number, area?: number, seen?: string[] }} [o]
 */
export async function answerPlantNear(page, { inat = 6, gbif = 6, area = 12, seen } = {}) {
  const json = (/** @type {import('@playwright/test').Route} */ route, /** @type {any} */ body) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
  /** `n` points on a half circle (east: 1, west: -1), from a third of `km` to 90 % of it. @param {number} lat @param {number} lng @param {number} km @param {number} n @param {number} side */
  const half = (lat, lng, km, n, side) => Array.from({ length: n }, (_, i) => {
    const r = km * (0.35 + 0.55 * (i % 3) / 2), a = (Math.PI * (i + 0.5)) / n;
    return [lng + side * (r * Math.sin(a)) / (111.32 * Math.cos(lat * Math.PI / 180)), lat + (r * Math.cos(a)) / 110.54];
  });
  await page.route(/^https:\/\/api\.gbif\.org\/v1\/species\/match\?/, route => json(route, {
    usageKey: 5341, scientificName: 'Urtica dioica L.', canonicalName: 'Urtica dioica', rank: 'SPECIES', status: 'ACCEPTED', matchType: 'EXACT', confidence: 99
  }));
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/taxa\?/, route => json(route, { results: [{
    id: 48460, name: 'Urtica dioica', rank: 'species', preferred_common_name: 'Grande ortie',
    default_photo: { license_code: 'cc-by-nc', square_url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/1/square.jpg', medium_url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/1/medium.jpg' }
  }] }));
  await page.route(/^https:\/\/api\.gbif\.org\/v1\/occurrence\/search\?/, route => {
    const q = new URL(route.request().url()).searchParams;
    if (q.get('taxonKey') !== '5341') return route.fallback();
    seen?.push(route.request().url());
    const where = q.get('geoDistance');
    if (where) {
      const [lat, lng, km] = where.replace('km', '').split(',').map(Number);
      return json(route, { count: gbif, results: half(lat, lng, km, gbif, 1).map(([x, y], i) => ({
        key: 3000 + i, decimalLatitude: y, decimalLongitude: x, eventDate: '2024-06-1' + (i % 10), basisOfRecord: 'HUMAN_OBSERVATION',
        datasetName: i === 0 ? 'iNaturalist research-grade observations' : 'Inventaire du CBN du Bassin parisien', datasetKey: i === 0 ? INAT_DATASET : 'cbn-bp',
        locality: 'Bois de Vincennes'
      })) });
    }
    if (q.get('gadmGid')) {
      return json(route, { count: 120, results: half(48.85, 2.35, 30, area, 1).map(([x, y], i) => ({
        key: 5000 + i, decimalLatitude: y, decimalLongitude: x, eventDate: '2023-05-0' + (1 + (i % 9)), datasetName: 'Inventaire régional', datasetKey: 'region', locality: 'Essonne'
      })) });
    }
    return route.fallback();
  });
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\?/, route => {
    const q = new URL(route.request().url()).searchParams;
    if (q.get('taxon_id') !== '48460') return route.fallback();
    seen?.push(route.request().url());
    if (q.get('page') && q.get('page') !== '1') return json(route, { total_results: inat, results: [] });
    const pts = half(Number(q.get('lat')), Number(q.get('lng')), Number(q.get('radius')), inat, -1);
    return json(route, { total_results: pts.length, results: pts.map(([x, y], i) => ({
      id: 8000 + i, uri: `https://www.inaturalist.org/observations/${8000 + i}`, geojson: { type: 'Point', coordinates: [x, y] }, observed_on: '2026-05-0' + (1 + (i % 9)),
      place_guess: 'Paris 5e', taxon: { id: 48460, name: 'Urtica dioica', preferred_common_name: 'Grande ortie' },
      photos: [{ id: 6000 + i, url: `https://inaturalist-open-data.s3.amazonaws.com/photos/${6000 + i}/square.jpg`, license_code: 'cc-by', attribution: '(c) Camille' }]
    })) });
  });
}

/**
 * @typedef {{ realData: boolean, firstVisit: boolean, offlineData: boolean }} Options
 * @typedef {{ pageErrors: string[], app: import('./app.mjs').App, newDevice: () => Promise<{ page: import('@playwright/test').Page, app: import('./app.mjs').App }> }} Fixtures
 */
export const test = base.extend(/** @type {any} */ ({
  realData: [false, { option: true }],
  firstVisit: [false, { option: true }],
  /** The data files answer 503 (and nothing else on the server changes): a first launch offline. */
  offlineData: [false, { option: true }],

  context: async ({ context, baseURL, realData, firstVisit, offlineData }, /** @type {any} */ use) => {
    await prepare(context, { baseURL, realData, firstVisit, offlineData });
    await use(context);
  },

  pageErrors: async ({ page }, /** @type {any} */ use) => {
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
    await use(errors);
    expect(errors, 'no uncaught error in the page').toEqual([]);
  },

  app: async ({ page, pageErrors }, /** @type {any} */ use) => {
    const { App } = await import('./app.mjs');
    void pageErrors;
    await use(new App(page));
  },

  /** Another device: a fresh context (its own IndexedDB and storage), prepared the same way, closed after the test. */
  newDevice: async ({ browser, baseURL, viewport, isMobile, hasTouch, locale, timezoneId, geolocation, permissions, serviceWorkers }, /** @type {any} */ use) => {
    const { App } = await import('./app.mjs');
    /** @type {import('@playwright/test').BrowserContext[]} */
    const opened = [];
    /** @type {string[]} */
    const errors = [];
    await use(async () => {
      const context = await browser.newContext({ baseURL, viewport, isMobile, hasTouch, locale, timezoneId, geolocation, permissions, serviceWorkers });
      opened.push(context);
      await prepare(context, { baseURL });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
      return { page, app: new App(page) };
    });
    await Promise.all(opened.map(c => c.close()));
    expect(errors, 'no uncaught error in the other device').toEqual([]);
  }
}));

export { expect };
