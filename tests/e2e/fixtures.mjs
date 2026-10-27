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

/** GBIF's answer to a zone's first question (its count and datasets: core/observations.js gbifZone): nothing there. */
const GBIF_NONE = { count: 0, results: [], facets: [{ field: 'DATASET_KEY', counts: [] }] };

/**
 * Rencontres' services answered (Découvrir, the mini-app): iNaturalist's plants around (12, Allium ursinum the
 * most observed), 30 observations on the map, Wikidata and Wikipédia's article of each. And GBIF's count of a layout's
 * zone (every plant, taxonKey=6, its datasets counted: a zone asks both sources by default): none, nothing more asked.
 * @param {import('@playwright/test').BrowserContext} context
 */
export async function answerAround(context) {
  /** @type {(route: import('@playwright/test').Route, body: any) => Promise<void>} */
  const json = (route, body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  await context.route(/^https:\/\/api\.gbif\.org\/v1\/occurrence\/search\?/, route => {
    const q = new URL(route.request().url()).searchParams;
    if (q.get('taxonKey') !== '6' || !q.get('geoDistance') || q.get('facet') !== 'datasetKey') return route.fallback();
    return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(GBIF_NONE) });
  });
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

/**
 * GBIF's occurrences of a layout's zone (every plant, taxonKey=6, around the point asked: core/observations.js gbifZone):
 * `gbif` of them (the first plants above, one each, in the CBN's dataset, counted in its facet); false, GBIF does not
 * answer. `seen`: the addresses asked.
 * @param {import('@playwright/test').Page} page @param {number | false} gbif @param {{ seen?: string[] }} [o]
 */
export async function answerZoneGbif(page, gbif, { seen } = {}) {
  await page.route(/^https:\/\/api\.gbif\.org\/v1\/occurrence\/search\?/, route => {
    const q = new URL(route.request().url()).searchParams;
    if (q.get('taxonKey') !== '6' || !q.get('geoDistance')) return route.fallback();
    seen?.push(route.request().url());
    if (gbif === false) return route.fulfill({ status: 503, body: '' });
    const [lat, lng] = String(q.get('geoDistance')).split(',').map(Number);
    const results = q.get('limit') === '0' ? [] : NAMES.slice(0, gbif).map((name, i) => ({ key: 7000 + i, decimalLatitude: lat - 0.002, decimalLongitude: lng + (i - 5.5) * 0.0008,
      species: name, scientificName: name + ' L.', taxonRank: 'SPECIES', eventDate: '2025-06-1' + (i % 10), datasetKey: 'cbn-mc', datasetName: 'Inventaire du CBN Massif central' }));
    return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ count: gbif, results, ...(q.get('facet') ? { facets: [{ field: 'DATASET_KEY', counts: gbif ? [{ name: 'cbn-mc', count: gbif }] : [] }] } : {}) }) });
  });
}

/**
 * A layout's zone (app/layout/state.js: the zone's latest observations, their plants the list): iNaturalist's
 * observations around the point asked, `each` of each of the 12 plants above (taxa 1000…1011, the most observed
 * first) — a plant's own (taxon_id) left to the routes before (answerAround's). `seen`: the addresses asked. `gbif`:
 * GBIF's occurrences of the zone (answerZoneGbif) — none by default (answerAround's answer, if any); a number, that
 * many; false, GBIF does not answer.
 * @param {import('@playwright/test').Page} page @param {{ each?: number, seen?: string[], gbif?: number | false }} [o]
 */
export async function answerZone(page, { each = 2, seen, gbif } = {}) {
  if (gbif !== undefined) await answerZoneGbif(page, gbif);
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\?/, route => {
    const q = new URL(route.request().url()).searchParams;
    if (q.get('taxon_id')) return route.fallback();
    seen?.push(route.request().url());
    const lat = Number(q.get('lat')), lng = Number(q.get('lng'));
    const results = q.get('page') && q.get('page') !== '1' ? [] : NAMES.flatMap((name, i) => Array.from({ length: each }, (_, k) => ({
      id: 3000 + i * 10 + k, uri: `https://www.inaturalist.org/observations/${3000 + i * 10 + k}`, observed_on: `2026-05-0${1 + (k % 9)}`, place_guess: 'Paris',
      geojson: { coordinates: [lng + (i - 5.5) * 0.0008, lat + (k - (each - 1) / 2) * 0.0008] },
      taxon: { id: 1000 + i, name, preferred_common_name: null } })));
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ total_results: results.length, results }) });
  });
}

const OBS_NAMES = [['Ortie dioïque', 'Urtica dioica'], ['Ail des ours', 'Allium ursinum'], ['Pâquerette', 'Bellis perennis'], ['Benoîte commune', 'Geum urbanum'],
  ['Pissenlit', 'Taraxacum officinale'], ['Lierre grimpant', 'Hedera helix'], ['Plantain lancéolé', 'Plantago lanceolata'], ['Bouton d’or', 'Ranunculus acris']];

/** A plant outside the reduced flora, known to iNaturalist (`taxa` below). */
const OUTSIDE = ['Lampourde imaginaire', 'Xanthium imaginarium'];

/**
 * The observations around a centre, for the maps in 3D (gf-map-obs3d.js): iNaturalist's (`inat` of them, each with a
 * free photo, one in four in the same species, Ortie dioïque) and GBIF's (`gbif`, one of iNaturalist's copies among
 * them, left out by the app), spread in the circle asked — and `outside` of each just beyond it (the app keeps only
 * those inside). `taxa`: iNaturalist knows its plants' photos too (each taxon's default photo, CC BY: on its
 * observations and in the plants of the circle, species_counts), and one GBIF occurrence in six is a plant outside
 * the flora that iNaturalist knows (Lampourde imaginaire). `seen`: the addresses asked.
 * @param {import('@playwright/test').Page | import('@playwright/test').BrowserContext} page
 * @param {{ inat?: number, gbif?: number, outside?: number, taxa?: boolean, seen?: string[] }} [o]
 */
export async function answerObservations(page, { inat = 60, gbif = 24, outside = 6, taxa = false, seen } = {}) {
  /** Points spread in a circle (a sunflower's spiral), then `outside` beyond it. @param {number} lat @param {number} lng @param {number} km @param {number} n */
  const spread = (lat, lng, km, n) => Array.from({ length: n + outside }, (_, i) => {
    const out = i >= n, r = out ? km * (1.15 + 0.1 * (i - n)) : km * 0.93 * Math.sqrt((i + 0.5) / n), a = i * 2.39996;
    return [lng + (r * Math.sin(a)) / (111.32 * Math.cos(lat * Math.PI / 180)), lat + (r * Math.cos(a)) / 110.54];
  });
  const json = (/** @type {import('@playwright/test').Route} */ route, /** @type {any} */ body) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
  /** iNaturalist's taxon `n` of OBS_NAMES (8: the plant outside the flora), its default photo with `taxa`. @param {number} n */
  const taxon = n => {
    const [common, sci] = n < OBS_NAMES.length ? OBS_NAMES[n] : OUTSIDE;
    return { id: 50 + n, name: sci, preferred_common_name: common,
      ...(taxa ? { default_photo: { id: 500 + n, license_code: 'cc-by', attribution: '(c) Dominique, some rights reserved (CC BY)', square_url: `https://inaturalist-open-data.s3.amazonaws.com/photos/${500 + n}/square.jpg` } } : {}) };
  };
  if (taxa) {
    await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\/species_counts\?/, route => {
      seen?.push(route.request().url());
      return json(route, { results: Array.from({ length: OBS_NAMES.length + 1 }, (_, n) => ({ count: 10 - n, taxon: taxon(n) })) });
    });
  }
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\?/, route => {
    const q = new URL(route.request().url()).searchParams;
    seen?.push(route.request().url());
    if (q.get('page') && q.get('page') !== '1') return json(route, { total_results: inat + outside, results: [] });
    const pts = spread(Number(q.get('lat')), Number(q.get('lng')), Number(q.get('radius')), inat);
    return json(route, { total_results: pts.length, results: pts.map(([x, y], i) => {
      const n = i % 4 === 0 ? 0 : i % OBS_NAMES.length;
      return { id: 9000 + i, uri: `https://www.inaturalist.org/observations/${9000 + i}`, geojson: { type: 'Point', coordinates: [x, y] }, observed_on: '2026-05-' + String(1 + (i % 28)).padStart(2, '0'),
        place_guess: 'Clermont-Ferrand', taxon: taxon(n),
        photos: [{ id: 7000 + i, url: `https://inaturalist-open-data.s3.amazonaws.com/photos/${7000 + i}/square.jpg`, license_code: 'cc-by', attribution: '(c) Camille, some rights reserved (CC BY)' }] };
    }) });
  });
  await page.route(/^https:\/\/api\.gbif\.org\/v1\/occurrence\/search\?/, route => {
    const url = new URL(route.request().url());
    seen?.push(url.href);
    const [lat, lng, km] = (url.searchParams.get('geoDistance') || '0,0,1km').replace('km', '').split(',').map(Number);
    const pts = spread(lat, lng, km, gbif);
    return json(route, { count: pts.length, results: pts.map(([x, y], i) => {
      const sci = taxa && i % 6 === 5 ? OUTSIDE[1] : OBS_NAMES[(i + 3) % OBS_NAMES.length][1];
      return { key: 4000 + i, decimalLatitude: y, decimalLongitude: x, species: sci, scientificName: sci + ' L.',
        eventDate: '2024-06-1' + (i % 10), datasetName: 'Inventaire du CBN', datasetKey: i === 0 ? '50c9509d-22c7-4a22-a47d-8c48425ef4a7' : 'cbn-mc' };
    }) });
  });
}

/** GBIF's copy of iNaturalist's research-grade observations (core/around3d.js INAT_DATASET). */
const INAT_DATASET = '50c9509d-22c7-4a22-a47d-8c48425ef4a7';

/** The nettle on GBIF and iNaturalist: its taxa, its iNaturalist photo under CC BY-NC (never shown: the flora's is). */
const NETTLE_NEAR = { sci: 'Urtica dioica', gbifKey: 5341, taxonId: 48460, common: 'Grande ortie', license: 'cc-by-nc', author: null };

/**
 * A plant sheet's map and its sources (gf-sheet-map.js): a plant (`plant`: the nettle by default) found on GBIF and on
 * iNaturalist — its taxon's photo there under `license` (by `author`): the photo its sheet finds when the flora has
 * none —, and its records: around a point (iNaturalist's `inat` observations, GBIF's `gbif` occurrences — the first
 * GBIF's copy of iNaturalist's first observation, its number there, left out when iNaturalist's are shown too),
 * spread in the circle asked, each source on its own side (iNaturalist west, GBIF east); and in an area touched in the
 * sheet (a GADM id: `area` occurrences around Paris — the first GBIF's copy of iNaturalist's second observation, the
 * second the same record as GBIF's second one around the point, at the default radius). `seen`: the addresses asked.
 * @param {import('@playwright/test').Page | import('@playwright/test').BrowserContext} page
 * @param {{ inat?: number, gbif?: number, area?: number, seen?: string[], plant?: Partial<typeof NETTLE_NEAR> }} [o]
 */
export async function answerPlantNear(page, { inat = 6, gbif = 6, area = 12, seen, plant = {} } = {}) {
  const p = { ...NETTLE_NEAR, ...plant };
  const json = (/** @type {import('@playwright/test').Route} */ route, /** @type {any} */ body) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
  /** `n` points on a half circle (east: 1, west: -1), from a third of `km` to 90 % of it. @param {number} lat @param {number} lng @param {number} km @param {number} n @param {number} side */
  const half = (lat, lng, km, n, side) => Array.from({ length: n }, (_, i) => {
    const r = km * (0.35 + 0.55 * (i % 3) / 2), a = (Math.PI * (i + 0.5)) / n;
    return [lng + side * (r * Math.sin(a)) / (111.32 * Math.cos(lat * Math.PI / 180)), lat + (r * Math.cos(a)) / 110.54];
  });
  /** GBIF's occurrence `i` around a point. @param {number} lat @param {number} lng @param {number} km @param {number} i */
  const nearRow = (lat, lng, km, i) => {
    const [x, y] = half(lat, lng, km, gbif, 1)[i];
    return { key: 3000 + i, decimalLatitude: y, decimalLongitude: x, eventDate: '2024-06-1' + (i % 10), basisOfRecord: 'HUMAN_OBSERVATION',
      datasetName: i === 0 ? 'iNaturalist research-grade observations' : 'Inventaire du CBN du Bassin parisien', datasetKey: i === 0 ? INAT_DATASET : 'cbn-bp',
      ...(i === 0 ? { catalogNumber: '8000' } : {}), locality: 'Bois de Vincennes' };
  };
  await page.route(/^https:\/\/api\.gbif\.org\/v1\/species\/match\?/, route => json(route, {
    usageKey: p.gbifKey, scientificName: p.sci + ' L.', canonicalName: p.sci, rank: 'SPECIES', status: 'ACCEPTED', matchType: 'EXACT', confidence: 99
  }));
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/taxa\?/, route => json(route, { results: [{
    id: p.taxonId, name: p.sci, rank: 'species', preferred_common_name: p.common,
    default_photo: { id: 77, license_code: p.license, ...(p.author ? { attribution: `(c) ${p.author}, some rights reserved (CC BY)` } : {}),
      square_url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/77/square.jpg', medium_url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/77/medium.jpg' }
  }] }));
  await page.route(/^https:\/\/api\.gbif\.org\/v1\/occurrence\/search\?/, route => {
    const q = new URL(route.request().url()).searchParams;
    if (q.get('taxonKey') !== String(p.gbifKey)) return route.fallback();
    seen?.push(route.request().url());
    const where = q.get('geoDistance');
    if (where) {
      const [lat, lng, km] = where.replace('km', '').split(',').map(Number);
      return json(route, { count: gbif, results: Array.from({ length: gbif }, (_, i) => nearRow(lat, lng, km, i)) });
    }
    if (q.get('gadmGid')) {
      return json(route, { count: 120, results: half(48.85, 2.35, 30, area, 1).map(([x, y], i) => i === 1 && gbif > 1 ? nearRow(48.85, 2.35, 5, 1) : {
        key: 5000 + i, decimalLatitude: y, decimalLongitude: x, eventDate: '2023-05-0' + (1 + (i % 9)), locality: 'Essonne',
        ...(i === 0 ? { datasetName: 'iNaturalist research-grade observations', datasetKey: INAT_DATASET, catalogNumber: '8001' } : { datasetName: 'Inventaire régional', datasetKey: 'region' })
      }) });
    }
    return route.fallback();
  });
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\?/, route => {
    const q = new URL(route.request().url()).searchParams;
    if (q.get('taxon_id') !== String(p.taxonId)) return route.fallback();
    seen?.push(route.request().url());
    if (q.get('page') && q.get('page') !== '1') return json(route, { total_results: inat, results: [] });
    const pts = half(Number(q.get('lat')), Number(q.get('lng')), Number(q.get('radius')), inat, -1);
    return json(route, { total_results: pts.length, results: pts.map(([x, y], i) => ({
      id: 8000 + i, uri: `https://www.inaturalist.org/observations/${8000 + i}`, geojson: { type: 'Point', coordinates: [x, y] }, observed_on: '2026-05-0' + (1 + (i % 9)),
      place_guess: 'Paris 5e', taxon: { id: p.taxonId, name: p.sci, preferred_common_name: p.common },
      photos: [{ id: 6000 + i, url: `https://inaturalist-open-data.s3.amazonaws.com/photos/${6000 + i}/square.jpg`, license_code: 'cc-by', attribution: '(c) Camille' }]
    })) });
  });
}

/** iNaturalist's taxon and GBIF's key of the orchids (app/miniapp/kit/orchids.js ORCHIDACEAE). */
export const ORCHIDS = { inat: 47217, gbif: 7689 };

/** The orchids observed (iNaturalist's: [scientific name, French name, taxon, how many]; GBIF's: [species or null, scientific name, how many]). */
const ORCHIDS_INAT = [['Traunsteinera globosa', 'Traunsteinère globuleuse', 7001, 3], ['Ophrys holosericea', 'Ophrys bourdon', 7002, 2],
  ['Epipactis leptochila', 'Épipactide à labelle étroit', 7003, 1], ['Orchidaceae', 'Orchidées', ORCHIDS.inat, 1]];
const ORCHIDS_GBIF = [['Dactylorhiza brennensis', 'Dactylorhiza brennensis (E.Nelson) Soó', 1], ['Ophrys holosericea', 'Ophrys holosericea (Burm.f.) Greuter', 1], [null, 'Ophrys L.', 1]];

/**
 * Les orchidées de la colline de Mirabel (app/miniapps/orchidees.js): the orchids observed around the point asked —
 * iNaturalist's when asked for its taxon of the orchids alone (Traunsteinère globuleuse three times, its taxon's photo
 * under CC BY; Ophrys bourdon twice; Épipactide à labelle étroit; one named by its family only), GBIF's when asked for
 * its key of the orchids (Dactylorhize de la Brenne, Ophrys bourdon, an Ophrys named by its genus, « Ophrys L. », as
 * GBIF writes it) —, spread in the circle, one of each source just beyond it, and one of each in it whose point is not
 * where the plant was (a Traunsteinère obscured, a Dactylorhize within 2 km); any other question of theirs left to the
 * routes before. `inat`, `gbif`: false, that source does not answer (503); `none`: both answer, nothing observed;
 * `totals`: how many each says it has (more than it gives). `seen`: the addresses asked.
 * @param {import('@playwright/test').Page | import('@playwright/test').BrowserContext} page
 * @param {{ inat?: boolean, gbif?: boolean, none?: boolean, totals?: { inat?: number, gbif?: number }, seen?: string[] }} [o]
 */
export async function answerOrchids(page, { inat = true, gbif = true, none = false, totals = {}, seen } = {}) {
  const json = (/** @type {import('@playwright/test').Route} */ route, /** @type {any} */ body) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
  /** Point `i` of `n` in a circle of `km` around a centre (a sunflower's spiral), past its edge when `out`. @param {number} lat @param {number} lng @param {number} km @param {number} i @param {number} n @param {boolean} [out] */
  const at = (lat, lng, km, i, n, out = false) => {
    const r = out ? km * 1.3 : km * 0.85 * Math.sqrt((i + 0.5) / n), a = i * 2.39996 + (out ? 1 : 0);
    return [lng + (r * Math.sin(a)) / (111.32 * Math.cos(lat * Math.PI / 180)), lat + (r * Math.cos(a)) / 110.54];
  };
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\?/, route => {
    const q = new URL(route.request().url()).searchParams;
    if (!(q.get('taxon_id') || '').split(',').includes(String(ORCHIDS.inat))) return route.fallback();
    seen?.push(route.request().url());
    if (!inat) return route.fulfill({ status: 503, body: '' });
    /** @type {{ name: unknown, common: unknown, id: unknown, more?: object }[]} */
    const rows = none ? [] : ORCHIDS_INAT.flatMap(([name, common, id, n]) => Array.from({ length: Number(n) }, () => ({ name, common, id })));
    // Beyond the circle; obscured (its point at random in its cell: here in the circle).
    const more = none ? [] : [rows[0], { ...rows[0], more: { obscured: true, public_positional_accuracy: 27000 } }];
    const [lat, lng, km] = [Number(q.get('lat')), Number(q.get('lng')), Number(q.get('radius'))];
    const results = q.get('page') && q.get('page') !== '1' ? [] : [...rows, ...more].map((t, i) => ({
      id: 6100 + i, uri: `https://www.inaturalist.org/observations/${6100 + i}`,
      geojson: { type: 'Point', coordinates: i > rows.length ? at(lat, lng, km, 0.4, rows.length) : at(lat, lng, km, i, rows.length, i === rows.length) },
      observed_on: '2026-05-' + String(10 + i).padStart(2, '0'), place_guess: 'Ménétrol',
      taxon: { id: t.id, name: t.name, preferred_common_name: t.common,
        ...(t.id === 7001 ? { default_photo: { id: 610, license_code: 'cc-by', attribution: '(c) Camille, some rights reserved (CC BY)', square_url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/610/square.jpg' } } : {}) },
      ...t.more
    }));
    return json(route, { total_results: totals.inat ?? results.length, results });
  });
  await page.route(/^https:\/\/api\.gbif\.org\/v1\/occurrence\/search\?/, route => {
    const q = new URL(route.request().url()).searchParams;
    if (q.get('taxonKey') !== String(ORCHIDS.gbif)) return route.fallback();
    seen?.push(route.request().url());
    if (!gbif) return route.fulfill({ status: 503, body: '' });
    const [lat, lng, km] = (q.get('geoDistance') || '0,0,1km').replace('km', '').split(',').map(Number);
    /** @type {{ species: unknown, sci: unknown, more?: object }[]} */
    const rows = none ? [] : ORCHIDS_GBIF.flatMap(([species, sci, n]) => Array.from({ length: Number(n) }, () => ({ species, sci })));
    // Beyond the circle; placed within 2 km (a square of a grid: here in the circle).
    const more = none ? [] : [rows[0], { ...rows[0], more: { coordinateUncertaintyInMeters: 2000 } }];
    const results = [...rows, ...more].map((r, i) => {
      const [x, y] = i > rows.length ? at(lat, lng, km, 1.6, rows.length) : at(lat, lng, km, i + 0.5, rows.length, i === rows.length);
      return { key: 6200 + i, decimalLatitude: y, decimalLongitude: x, ...(r.species ? { species: r.species } : {}), scientificName: r.sci,
        taxonRank: r.species ? 'SPECIES' : 'GENUS', genus: String(r.species || r.sci).split(' ')[0], family: 'Orchidaceae',
        eventDate: '2024-06-1' + i, datasetKey: 'cbn-mc', datasetName: 'Conservatoire botanique national du Massif central', ...r.more };
    });
    return json(route, { count: totals.gbif ?? results.length, results });
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
