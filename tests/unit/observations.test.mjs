// app/core/observations.js: one layer over the sources of observations — the filters read from an address and written
// back (only what differs from a layout's defaults), each filter in iNaturalist's and GBIF's words, what GBIF cannot
// filter applied by the app, what each source does of each filter; the zone's observations merged (GBIF's copy of
// iNaturalist's left out, the same plant at the same spot on the same day once, the most recent first), a source that
// fails said and the others shown; their plants (core/nearby.js speciesOf: one plant once, whichever source saw it —
// the flora's, from an IndexedDB in memory; the services answered by a fetch of this file's).
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  APPLIES, OBS_DEFAULTS, ObsError, failedText, gbifKeep, gbifQuery, inatQuery, obsChanges, obsKey, obsParams, readObsFilters, sourcesText, zoneObservations
} = await import('../../app/core/observations.js');
const { INAT_DATASET } = await import('../../app/core/around3d.js');
const { plantOfPoint, speciesOf } = await import('../../app/core/nearby.js');
const { appMode, setModule } = await import('../../app/core/modules.js');
const db = await import('../../app/core/db.js');

const FLORA = [
  { id: 1, scientificName: 'Hedera helix', synonyms: [], family: 'Araliaceae', genus: 'Hedera', vernacularNames: ['Lierre grimpant'] },
  { id: 2, scientificName: 'Bellis perennis', synonyms: [], family: 'Asteraceae', genus: 'Bellis', vernacularNames: ['Pâquerette'] },
  { id: 3, scientificName: 'Urtica dioica', synonyms: [], family: 'Urticaceae', genus: 'Urtica', vernacularNames: ['Ortie dioïque'] }
];
await db.replacePlants(FLORA, { version: 'test' });

/** The filters, every one said. @param {Partial<import('../../app/core/observations.js').ObsFilters>} [more] */
const filters = (more = {}) => ({ ...OBS_DEFAULTS, ...more });

test('les filtres dans l’adresse : lus (les mauvais laissés), écrits dans un ordre fixe, gardés seulement quand ils diffèrent des réglages de la disposition', () => {
  const read = readObsFilters(new URLSearchParams('sources=gbif,inat,ebird&qualite=verifiables&taxon=espece&photos=libre&sauvages=1&jeux=b-2,a_1,a_1,<x>'));
  assert.deepEqual(read, { sources: ['inat', 'gbif'], qualite: 'verifiables', taxon: 'espece', photos: 'libre', sauvages: true, jeux: ['a_1', 'b-2'] });
  assert.ok(Object.isFrozen(read));
  assert.deepEqual(obsParams(read), [['sources', 'inat,gbif'], ['qualite', 'verifiables'], ['taxon', 'espece'], ['photos', 'libre'], ['sauvages', '1'], ['jeux', 'a_1,b-2']]);
  assert.equal(obsKey(read), 'sources=inat,gbif&qualite=verifiables&taxon=espece&photos=libre&sauvages=1&jeux=a_1,b-2');
  // Nothing said, or only wrong values: none.
  assert.equal(readObsFilters(new URLSearchParams('q=ortie&photo=avec')), null, 'Flore’s own keys are not these');
  assert.equal(readObsFilters(new URLSearchParams('sources=x&qualite=bof&taxon=genre&photos=peut-etre&sauvages=oui&jeux=<x>')), null);
  assert.deepEqual(readObsFilters(new URLSearchParams('sauvages=0')), { sauvages: false });
  assert.deepEqual(obsParams(null), []);
  assert.equal(obsKey(null), '');
  // Against the defaults (a layout whose maps say GBIF too): only what differs; nothing: null.
  const both = filters({ sources: ['inat', 'gbif'] });
  assert.equal(obsChanges(both, both), null);
  assert.deepEqual(obsChanges(filters({ photos: 'avec' }), both), { sources: ['inat'], photos: 'avec' });
  assert.deepEqual(obsChanges(filters({ sources: ['inat', 'gbif'], jeux: ['a'], sauvages: true }), both), { sauvages: true, jeux: ['a'] });
});

test('chaque filtre dans les mots d’iNaturalist et de GBIF ; ce que GBIF ne sait pas filtrer, l’app le fait ; ce que chaque source fait de chaque filtre', () => {
  // iNaturalist: as the app always asked by default (research grade), each filter its own parameter.
  assert.equal(inatQuery(filters()), '&quality_grade=research');
  assert.equal(inatQuery(filters({ qualite: 'verifiables' })), '&quality_grade=research,needs_id');
  assert.equal(inatQuery(filters({ qualite: 'toutes' })), '');
  assert.equal(inatQuery(filters({ qualite: 'toutes', taxon: 'espece', photos: 'avec', sauvages: true })), '&hrank=species&photos=true&captive=false');
  assert.equal(inatQuery(filters({ photos: 'libre' })), '&quality_grade=research&photo_license=cc0,cc-by,cc-by-sa');
  // GBIF: the period, a photo, the datasets (repeated).
  const now = new Date();
  assert.equal(gbifQuery(filters()), '');
  assert.equal(gbifQuery(filters(), 'annee'), `&year=${now.getFullYear()}`);
  assert.equal(gbifQuery(filters({ photos: 'libre', jeux: ['a_1', 'b-2'] }), 'mois'), `&month=${now.getMonth() + 1}&mediaType=StillImage&datasetKey=a_1&datasetKey=b-2`);
  // What GBIF cannot filter: the rank, a free licence, wild plants — kept or not by the app.
  const record = { taxonRank: 'SPECIES', media: [{ type: 'StillImage', license: 'http://creativecommons.org/licenses/by/4.0/' }], establishmentMeans: null, degreeOfEstablishment: null };
  assert.ok(gbifKeep(record, filters({ taxon: 'espece', photos: 'libre', sauvages: true })));
  assert.ok(gbifKeep({ ...record, taxonRank: 'VARIETY' }, filters({ taxon: 'espece' })), 'below the species: kept');
  assert.ok(!gbifKeep({ ...record, taxonRank: 'GENUS' }, filters({ taxon: 'espece' })));
  assert.ok(gbifKeep({ ...record, taxonRank: 'GENUS' }, filters()), 'any rank by default');
  assert.ok(!gbifKeep({ ...record, media: [{ type: 'StillImage', license: 'http://creativecommons.org/licenses/by-nc/4.0/' }] }, filters({ photos: 'libre' })));
  assert.ok(!gbifKeep({ ...record, media: [{ type: 'Sound', license: 'CC0_1_0' }] }, filters({ photos: 'libre' })), 'a sound is not a photo');
  assert.ok(gbifKeep({ ...record, media: [{ license: 'CC0_1_0' }] }, filters({ photos: 'libre' })), 'GBIF’s licence words (CC0_1_0)');
  assert.ok(!gbifKeep({ ...record, establishmentMeans: 'MANAGED' }, filters({ sauvages: true })));
  assert.ok(!gbifKeep({ ...record, degreeOfEstablishment: 'cultivated' }, filters({ sauvages: true })));
  assert.ok(gbifKeep({ ...record, establishmentMeans: 'INTRODUCED' }, filters({ sauvages: true })), 'introduced but wild: kept (its origin is the Statut en France)');
  // Each filter, for each source: asked of it, done by the app, or of no sense there — and why.
  for (const [key, a] of Object.entries(APPLIES)) {
    assert.ok(['api', 'app', 'non'].includes(a.inat) && ['api', 'app', 'non'].includes(a.gbif), key);
    assert.ok(a.why.length > 10, key);
  }
  assert.equal(APPLIES.qualite.gbif, 'non', 'GBIF has no quality grade');
  assert.equal(APPLIES.jeux.inat, 'non', 'datasets are GBIF’s');
});

test('les sources et leurs pannes, en mots', () => {
  assert.equal(sourcesText(['inat']), 'iNaturalist');
  assert.equal(sourcesText(['inat', 'gbif']), 'iNaturalist et GBIF');
  assert.equal(failedText([{ name: 'iNaturalist', off: false }]), 'iNaturalist ne répond pas');
  assert.equal(failedText([{ name: 'iNaturalist', off: false }, { name: 'GBIF', off: false }]), 'iNaturalist et GBIF ne répondent pas');
  assert.equal(failedText([{ name: 'iNaturalist', off: true }]), 'Le module iNaturalist est désactivé');
  assert.equal(failedText([{ name: 'iNaturalist', off: true }, { name: 'GBIF', off: true }]), 'Les modules iNaturalist et GBIF sont désactivés');
  assert.equal(failedText([{ name: 'iNaturalist', off: true }, { name: 'GBIF', off: false }]), 'Le module iNaturalist est désactivé et GBIF ne répond pas');
  assert.equal(failedText([]), '');
});

const C = /** @type {[number, number]} */ ([3.087, 45.7772]);
/** A point `m` metres north of a centre. @param {[number, number]} c @param {number} m @returns {[number, number]} */
const north = (c, m) => [c[0], c[1] + m / (6371008.8 * Math.PI / 180)];

/**
 * The services of a zone answered: iNaturalist's observations (the ivy and the nettle, twice; taxa 60 and 50), GBIF's
 * occurrences (`gbif`: its records, as GBIF writes them; its datasets counted, iNaturalist's copy among them), anything
 * else 503 (`down`: those hosts too). `asked`: the addresses.
 * @param {string[]} asked @param {{ gbif?: any[], count?: number, facets?: { name: string, count: number }[], down?: string[] }} [o]
 */
function answerZone(asked, { gbif = [], count = gbif.length, facets = [], down = [] } = {}) {
  const json = (/** @type {any} */ body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  return async (/** @type {string | URL | Request} */ input) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    asked.push(url.href);
    if (down.includes(url.host)) return new Response('', { status: 503 });
    if (url.host === 'api.inaturalist.org' && url.pathname === '/v1/observations') {
      const c = /** @type {[number, number]} */ ([Number(url.searchParams.get('lng')), Number(url.searchParams.get('lat'))]);
      const IVY = { id: 60, name: 'Hedera helix', preferred_common_name: 'Lierre' }, NETTLE = { id: 50, name: 'Urtica dioica', preferred_common_name: 'Ortie dioïque' };
      const row = (/** @type {number} */ id, /** @type {any} */ taxon, /** @type {number} */ m, /** @type {string} */ date) =>
        ({ id, uri: `https://www.inaturalist.org/observations/${id}`, geojson: { type: 'Point', coordinates: north(c, m) }, observed_on: date, place_guess: 'Royat', taxon });
      return json({ total_results: 3, results: [row(901, IVY, 100, '2026-05-02'), row(902, NETTLE, 200, '2026-05-04'), row(903, NETTLE, 300, '2026-04-30')] });
    }
    if (url.host === 'api.gbif.org' && url.pathname === '/v1/occurrence/search') {
      return json({ count, results: gbif, facets: [{ field: 'DATASET_KEY', counts: facets }] });
    }
    return new Response('', { status: 503 });
  };
}

/** A GBIF occurrence `m` metres north of a centre, as GBIF writes it. @param {[number, number]} c @param {number} key @param {string} species @param {number} m @param {Partial<any>} [more] */
const occurrence = (c, key, species, m, more = {}) => {
  const [lon, lat] = north(c, m);
  return { key, decimalLatitude: lat, decimalLongitude: lon, species, scientificName: species + ' L.', taxonRank: 'SPECIES', eventDate: '2025-06-12T10:00:00',
    datasetKey: 'cbn', datasetName: 'Inventaire du CBN', locality: 'Royat', media: [], ...more };
};

test('les observations de la zone : iNaturalist seul comme toujours, puis iNaturalist et GBIF fusionnés — la copie et les doublons écartés, les filtres de l’app appliqués, les plus récentes d’abord', async t => {
  const fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetch; });
  /** @type {string[]} */ const asked = [];
  globalThis.fetch = /** @type {any} */ (answerZone(asked));
  // iNaturalist alone, the defaults: its research grade, as the app always asked; GBIF not asked.
  const alone = await zoneObservations(C, 2000, { filters: filters(), max: 200 });
  const inatUrl = new URL(/** @type {string} */ (asked.find(u => u.includes('api.inaturalist.org/v1/observations?'))));
  assert.equal(inatUrl.searchParams.get('quality_grade'), 'research');
  assert.equal(inatUrl.searchParams.get('iconic_taxa'), 'Plantae');
  assert.ok(!asked.some(u => u.includes('api.gbif.org')), 'GBIF not asked: not a source');
  assert.deepEqual(alone.points.map(p => p.id), ['i902', 'i901', 'i903'], 'the most recent first');
  assert.deepEqual(alone.totals, { inat: 3, gbif: null });
  assert.deepEqual(alone.failed, []);
  assert.ok(alone.points.every(p => p.kind === 'inat' && p.source === 'iNaturalist'));

  // Both, filtered: each source asked in its own words; GBIF's records the app keeps or not.
  const c2 = /** @type {[number, number]} */ ([3.2, 45.8]);
  asked.length = 0;
  const free = { type: 'StillImage', license: 'http://creativecommons.org/licenses/by/4.0/' };
  globalThis.fetch = /** @type {any} */ (answerZone(asked, {
    gbif: [
      occurrence(c2, 1, 'Bellis perennis', 400, { media: [free] }), // GBIF's own: kept
      occurrence(c2, 2, 'Urtica dioica', 205, { eventDate: '2026-05-04', media: [free] }), // iNaturalist's 902 again (same day, 5 m): once
      occurrence(c2, 3, 'Hedera helix', 500, { datasetKey: INAT_DATASET, media: [free] }), // GBIF's copy of iNaturalist's: left out
      occurrence(c2, 4, 'Urtica', 600, { taxonRank: 'GENUS', media: [free] }), // not to the species: left out
      occurrence(c2, 5, 'Hedera helix', 700, { media: [{ type: 'StillImage', license: 'http://creativecommons.org/licenses/by-nc/4.0/' }] }), // not free: left out
      occurrence(c2, 6, 'Bellis perennis', 800, { media: [free], establishmentMeans: 'MANAGED' }), // planted: left out
      occurrence(c2, 7, 'Bellis perennis', 5000, { media: [free] }) // out of the circle
    ],
    count: 120,
    facets: [{ name: INAT_DATASET, count: 90 }, { name: 'cbn', count: 25 }, { name: 'plantnet', count: 5 }, { name: '<bad>', count: 1 }]
  }));
  const f = filters({ sources: ['inat', 'gbif'], qualite: 'verifiables', taxon: 'espece', photos: 'libre', sauvages: true, jeux: ['cbn', 'plantnet'] });
  const both = await zoneObservations(c2, 2000, { filters: f, periode: 'annee', max: 200 });
  const q = new URL(/** @type {string} */ (asked.find(u => u.includes('api.inaturalist.org/v1/observations?')))).searchParams;
  assert.deepEqual([q.get('quality_grade'), q.get('hrank'), q.get('photo_license'), q.get('captive'), q.get('year')],
    ['research,needs_id', 'species', 'cc0,cc-by,cc-by-sa', 'false', String(new Date().getFullYear())]);
  const g = new URL(/** @type {string} */ (asked.find(u => u.includes('api.gbif.org/v1/occurrence/search?')))).searchParams;
  assert.deepEqual([g.get('taxonKey'), g.get('mediaType'), g.getAll('datasetKey'), g.get('facet'), g.get('facetMultiselect'), g.get('year')],
    ['6', 'StillImage', ['cbn', 'plantnet'], 'datasetKey', 'true', String(new Date().getFullYear())]);
  assert.match(String(g.get('geoDistance')), /^45\.8000,3\.2000,2\.00km$/);
  // The size of the datasets' facet as GBIF documents it: by field (a bare facetLimit is not one of its words).
  assert.equal(g.get('datasetKey.facetLimit'), '30');
  assert.equal(g.has('facetLimit'), false);
  assert.deepEqual(both.points.map(p => p.id), ['i902', 'i901', 'i903', 'g1'], 'iNaturalist’s and GBIF’s own, the most recent first');
  const daisy = /** @type {any} */ (both.points.find(p => p.id === 'g1'));
  assert.deepEqual({ kind: daisy.kind, sci: daisy.sci, common: daisy.common, url: daisy.url }, { kind: 'gbif', sci: 'Bellis perennis', common: 'Pâquerette', url: 'https://www.gbif.org/occurrence/1' });
  // GBIF's count without its copy of iNaturalist's (when no dataset is chosen; here two are, without it: as GBIF counts them).
  assert.deepEqual(both.totals, { inat: 3, gbif: 120 });
  assert.deepEqual(both.datasets, [{ key: 'cbn', count: 25 }, { key: 'plantnet', count: 5 }], 'iNaturalist’s copy and a bad key left out');

  // No dataset chosen: GBIF's count without its copy of iNaturalist's.
  const c3 = /** @type {[number, number]} */ ([3.3, 45.9]);
  globalThis.fetch = /** @type {any} */ (answerZone(asked, { gbif: [occurrence(c3, 1, 'Bellis perennis', 400)], count: 120, facets: [{ name: INAT_DATASET, count: 90 }, { name: 'cbn', count: 30 }] }));
  const all = await zoneObservations(c3, 2000, { filters: filters({ sources: ['gbif'] }) });
  assert.deepEqual(all.totals, { inat: null, gbif: 30 });
  assert.deepEqual(all.points.map(p => p.id), ['g1']);
});

test('une source en panne : dite, les autres montrées ; toutes en panne : une erreur qui dit chacune ; un module coupé : dit comme tel', async t => {
  const fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetch; setModule('gbif', appMode(), true); });
  /** @type {string[]} */ const asked = [];
  const c = /** @type {[number, number]} */ ([3.4, 46]);
  globalThis.fetch = /** @type {any} */ (answerZone(asked, { down: ['api.gbif.org'] }));
  const some = await zoneObservations(c, 2000, { filters: filters({ sources: ['inat', 'gbif'] }), max: 200 });
  assert.deepEqual(some.failed, [{ name: 'GBIF', off: false }]);
  assert.equal(some.points.length, 3, 'iNaturalist’s shown');
  assert.deepEqual(some.totals, { inat: 3, gbif: null });

  globalThis.fetch = /** @type {any} */ (answerZone(asked, { down: ['api.gbif.org', 'api.inaturalist.org'] }));
  const c2 = /** @type {[number, number]} */ ([3.5, 46.1]);
  await assert.rejects(zoneObservations(c2, 2000, { filters: filters({ sources: ['inat', 'gbif'] }), max: 200 }), error => {
    assert.ok(error instanceof ObsError);
    assert.deepEqual(error.failed.map(x => x.name).sort(), ['GBIF', 'iNaturalist']);
    assert.equal(error.message, failedText(error.failed));
    return true;
  });

  setModule('gbif', appMode(), false);
  const c3 = /** @type {[number, number]} */ ([3.6, 46.2]);
  globalThis.fetch = /** @type {any} */ (answerZone(asked));
  const off = await zoneObservations(c3, 2000, { filters: filters({ sources: ['inat', 'gbif'] }), max: 200 });
  assert.deepEqual(off.failed, [{ name: 'GBIF', off: true }]);
  await assert.rejects(zoneObservations(c3, 2000, { filters: filters({ sources: ['gbif'] }) }), error => error instanceof ObsError && error.failed[0].off === true);
});

test('les plantes des observations : une plante une fois, que iNaturalist (son taxon) ou GBIF (son nom) l’ait vue, ses observations comptées ensemble ; chaque point retrouve sa plante', async () => {
  const p = (/** @type {number | null} */ taxonId, /** @type {string} */ sci) => ({ taxonId, sci, common: null, photo: null, credit: null });
  const { list, plantOf } = await speciesOf([p(50, 'Urtica dioica'), p(50, 'Urtica dioica'), p(null, 'Urtica dioica'), p(null, 'Bellis perennis'), p(60, 'Hedera helix'),
    p(null, 'Plantus ignotus'), p(70, 'Urtica dioica subsp. dioica')]);
  const nettle = /** @type {any} */ (list.find(s => s.plantId === 3));
  assert.deepEqual({ count: nettle.count, taxonId: nettle.taxonId }, { count: 4, taxonId: 50 }, 'its taxon, its name and its subspecies: one plant, iNaturalist’s taxon kept');
  assert.equal(list.filter(s => s.plantId === 3).length, 1);
  assert.deepEqual(list.map(s => s.plantId), [3, 2, 1, null], 'the most observed first; a plant the flora does not know kept, without a plant');
  assert.equal(list.find(s => s.plantId === 2)?.taxonId, null, 'seen by GBIF alone: no taxon of iNaturalist’s');
  // Each point its plant: by its taxon, else its name (a subspecies' taxon too).
  assert.equal(plantOfPoint(plantOf, { taxonId: 70, sci: 'Urtica dioica subsp. dioica' }), 3);
  assert.equal(plantOfPoint(plantOf, { taxonId: null, sci: 'Bellis perennis' }), 2);
  assert.equal(plantOfPoint(plantOf, { taxonId: 999, sci: 'Hedera helix' }), 1, 'a taxon not among them: its name');
  assert.equal(plantOfPoint(plantOf, { taxonId: null, sci: 'Plantus ignotus' }), undefined);
});
