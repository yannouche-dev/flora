// app/core/observations.js: one layer over the sources of observations — every observation by default (both sources,
// every quality grade, every GBIF dataset); the filters read from an address and written back (only what differs from
// a layout's defaults; the quality's words of before still read and written), each filter in iNaturalist's and GBIF's
// words, what GBIF cannot filter applied by the app, what each source does of each filter; the zone's observations
// merged (GBIF's copy of iNaturalist's left out, the datasets left out never asked nor counted, the same plant at the
// same spot on the same day once, the most recent first), a source that fails said and the others shown; their plants
// (core/nearby.js speciesOf: one plant once, whichever source saw it — the flora's, from an IndexedDB in memory; the
// services answered by a fetch of this file's); the current plant's own points and a map of France's tiles as the
// quality grades say (core/nearby.js observationsAround, layout/map-options.js inatTiles).
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  APPLIES, GRADES, OBS_DEFAULTS, ObsError, failedText, gbifKeep, gbifQuery, inatGrades, inatQuery, obsChanges, obsKey, obsNotes, obsParams, qualityWord, readObsFilters,
  sourcesText, zoneObservations
} = await import('../../app/core/observations.js');
const { INAT_DATASET } = await import('../../app/core/around3d.js');
const { observationsAround, plantCounts, plantOfPoint, plantsIn, speciesOf } = await import('../../app/core/nearby.js');
const { inatTiles } = await import('../../app/layout/map-options.js');
const { setModule } = await import('../../app/core/modules.js');
const db = await import('../../app/core/db.js');

const FLORA = [
  { id: 1, scientificName: 'Hedera helix', synonyms: [], family: 'Araliaceae', genus: 'Hedera', vernacularNames: ['Lierre grimpant'] },
  { id: 2, scientificName: 'Bellis perennis', synonyms: [], family: 'Asteraceae', genus: 'Bellis', vernacularNames: ['Pâquerette'] },
  { id: 3, scientificName: 'Urtica dioica', synonyms: [], family: 'Urticaceae', genus: 'Urtica', vernacularNames: ['Ortie dioïque'] }
];
await db.replacePlants(FLORA, { version: 'test' });

/** The filters, every one said. @param {Partial<import('../../app/core/observations.js').ObsFilters>} [more] */
const filters = (more = {}) => ({ ...OBS_DEFAULTS, ...more });

test('par défaut, toutes les observations : les deux sources, toutes les qualités, tous les jeux, les plantes cultivées aussi', () => {
  assert.deepEqual({ ...OBS_DEFAULTS }, { sources: ['inat', 'gbif'], qualite: ['recherche', 'aidentifier', 'occasionnelles'], taxon: 'tous', photos: 'toutes',
    sauvages: false, jeux: [], sansjeux: [] });
  assert.deepEqual(GRADES, ['recherche', 'aidentifier', 'occasionnelles']);
  assert.equal(inatQuery(filters()), '', 'iNaturalist asked without a quality grade');
  assert.equal(gbifQuery(filters()), '', 'GBIF, every dataset');
});

test('les filtres dans l’adresse : lus (les mauvais laissés), écrits dans un ordre fixe, gardés seulement quand ils diffèrent des réglages de la disposition', () => {
  const read = readObsFilters(new URLSearchParams('sources=gbif,inat,ebird&qualite=verifiables&taxon=espece&photos=libre&sauvages=1&jeux=b-2,a_1,a_1,<x>&sansjeux=c,<y>,c'));
  assert.deepEqual(read, { sources: ['inat', 'gbif'], qualite: ['recherche', 'aidentifier'], taxon: 'espece', photos: 'libre', sauvages: true, jeux: ['a_1', 'b-2'], sansjeux: ['c'] });
  assert.ok(Object.isFrozen(read));
  assert.deepEqual(obsParams(read), [['sources', 'inat,gbif'], ['qualite', 'verifiables'], ['taxon', 'espece'], ['photos', 'libre'], ['sauvages', '1'], ['jeux', 'a_1,b-2'], ['sansjeux', 'c']]);
  assert.equal(obsKey(read), 'sources=inat,gbif&qualite=verifiables&taxon=espece&photos=libre&sauvages=1&jeux=a_1,b-2&sansjeux=c');
  // Nothing said, or only wrong values: none.
  assert.equal(readObsFilters(new URLSearchParams('q=ortie&photo=avec')), null, 'Flore’s own keys are not these');
  assert.equal(readObsFilters(new URLSearchParams('sources=x&qualite=bof&taxon=genre&photos=peut-etre&sauvages=oui&jeux=<x>&sansjeux=<x>')), null);
  assert.equal(readObsFilters(new URLSearchParams('qualite=constructor,toString')), null, 'not a word of the quality');
  assert.deepEqual(readObsFilters(new URLSearchParams('sauvages=0')), { sauvages: false });
  assert.deepEqual(obsParams(null), []);
  assert.equal(obsKey(null), '');
  // Against the defaults: only what differs; nothing: null — and a layout whose maps say iNaturalist alone (src=inat).
  assert.equal(obsChanges(filters(), OBS_DEFAULTS), null);
  const inat = filters({ sources: ['inat'] });
  assert.deepEqual(obsChanges(filters({ photos: 'avec' }), inat), { sources: ['inat', 'gbif'], photos: 'avec' });
  assert.deepEqual(obsChanges(filters({ jeux: ['a'], sauvages: true }), OBS_DEFAULTS), { sauvages: true, jeux: ['a'] });
  assert.deepEqual(obsChanges(filters({ sansjeux: ['b'], qualite: ['occasionnelles', 'recherche'] }), OBS_DEFAULTS), { qualite: ['recherche', 'occasionnelles'], sansjeux: ['b'] });
});

test('la qualité : un ensemble de notes (vérifiées, à identifier, occasionnelles) ; les mots d’avant lus, et écrits quand ils disent les mêmes', () => {
  const quality = (/** @type {string} */ q) => readObsFilters(new URLSearchParams('qualite=' + q))?.qualite ?? null;
  // The words of before: each its grades, as they meant (one choice of three).
  assert.deepEqual(quality('recherche'), ['recherche']);
  assert.deepEqual(quality('verifiables'), ['recherche', 'aidentifier']);
  assert.deepEqual(quality('toutes'), ['recherche', 'aidentifier', 'occasionnelles']);
  // A list of grades (in any order, twice, among wrong words), and the words of before among them.
  assert.deepEqual(quality('occasionnelles,aidentifier,aidentifier,bof'), ['aidentifier', 'occasionnelles']);
  assert.deepEqual(quality('verifiables,occasionnelles'), ['recherche', 'aidentifier', 'occasionnelles']);
  assert.equal(quality('bof'), null);
  // Written: the word of before when the grades are its, else their list, in their order.
  assert.deepEqual([qualityWord(['recherche']), qualityWord(['aidentifier', 'recherche']), qualityWord(['occasionnelles', 'aidentifier', 'recherche'])],
    ['recherche', 'verifiables', 'toutes']);
  assert.deepEqual([qualityWord(['aidentifier']), qualityWord(['occasionnelles', 'recherche']), qualityWord(['occasionnelles', 'aidentifier'])],
    ['aidentifier', 'recherche,occasionnelles', 'aidentifier,occasionnelles']);
  // Read and written back: the same address.
  for (const q of ['recherche', 'verifiables', 'toutes', 'aidentifier', 'recherche,occasionnelles', 'aidentifier,occasionnelles', 'occasionnelles']) {
    assert.equal(obsKey(readObsFilters(new URLSearchParams('qualite=' + q))), 'qualite=' + q, q);
  }
  // In iNaturalist's words: every grade, none said; else their list.
  assert.deepEqual([inatGrades(GRADES), inatGrades([]), inatGrades(['recherche']), inatGrades(['recherche', 'aidentifier']), inatGrades(['occasionnelles', 'aidentifier'])],
    ['', '', '&quality_grade=research', '&quality_grade=research,needs_id', '&quality_grade=needs_id,casual']);
});

test('chaque filtre dans les mots d’iNaturalist et de GBIF ; ce que GBIF ne sait pas filtrer, l’app le fait ; ce que chaque source fait de chaque filtre', () => {
  // iNaturalist: by default every observation (no quality grade), each filter its own parameter.
  assert.equal(inatQuery(filters({ qualite: ['recherche'] })), '&quality_grade=research');
  assert.equal(inatQuery(filters({ qualite: ['recherche', 'aidentifier'] })), '&quality_grade=research,needs_id');
  assert.equal(inatQuery(filters({ qualite: ['recherche', 'occasionnelles'] })), '&quality_grade=research,casual');
  assert.equal(inatQuery(filters({ taxon: 'espece', photos: 'avec', sauvages: true })), '&hrank=species&photos=true&captive=false');
  assert.equal(inatQuery(filters({ qualite: ['recherche'], photos: 'libre' })), '&quality_grade=research&photo_license=cc0,cc-by,cc-by-sa');
  // GBIF: the period, a photo, the datasets (repeated).
  const now = new Date();
  assert.equal(gbifQuery(filters()), '');
  assert.equal(gbifQuery(filters(), 'annee'), `&year=${now.getFullYear()}`);
  assert.equal(gbifQuery(filters({ photos: 'libre', jeux: ['a_1', 'b-2'] }), 'mois'), `&month=${now.getMonth() + 1}&mediaType=StillImage&datasetKey=a_1&datasetKey=b-2`);
  assert.equal(gbifQuery(filters({ sansjeux: ['c'] })), '', 'GBIF has no word to leave one out: never asked for its occurrences instead');
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
 * occurrences as GBIF answers (`gbif`: its records, as GBIF writes them — none with limit=0, those of the datasets asked
 * only; its datasets counted when asked, iNaturalist's copy among them, unless `noFacets`), anything else 503 (`down`:
 * those hosts too). `inat`: more of iNaturalist's observations, by their id (obscured, their accuracy). `asked`: the addresses.
 * @param {string[]} asked
 * @param {{ gbif?: any[], count?: number, facets?: { name: string, count: number }[], noFacets?: boolean, down?: string[], inat?: Record<number, any> }} [o]
 */
function answerZone(asked, { gbif = [], count = gbif.length, facets = [], noFacets = false, down = [], inat = {} } = {}) {
  const json = (/** @type {any} */ body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  return async (/** @type {string | URL | Request} */ input) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    asked.push(url.href);
    if (down.includes(url.host)) return new Response('', { status: 503 });
    if (url.host === 'api.inaturalist.org' && url.pathname === '/v1/observations') {
      const c = /** @type {[number, number]} */ ([Number(url.searchParams.get('lng')), Number(url.searchParams.get('lat'))]);
      const IVY = { id: 60, name: 'Hedera helix', preferred_common_name: 'Lierre' }, NETTLE = { id: 50, name: 'Urtica dioica', preferred_common_name: 'Ortie dioïque' };
      const row = (/** @type {number} */ id, /** @type {any} */ taxon, /** @type {number} */ m, /** @type {string} */ date) =>
        ({ id, uri: `https://www.inaturalist.org/observations/${id}`, geojson: { type: 'Point', coordinates: north(c, m) }, observed_on: date, place_guess: 'Royat', taxon, ...inat[id] });
      return json({ total_results: 3, results: [row(901, IVY, 100, '2026-05-02'), row(902, NETTLE, 200, '2026-05-04'), row(903, NETTLE, 300, '2026-04-30')] });
    }
    if (url.host === 'api.gbif.org' && url.pathname === '/v1/occurrence/search') {
      const q = url.searchParams, keys = q.getAll('datasetKey');
      const results = q.get('limit') === '0' ? [] : gbif.filter(o => !keys.length || keys.includes(o.datasetKey));
      return json({ count, results, ...(q.get('facet') && !noFacets ? { facets: [{ field: 'DATASET_KEY', counts: facets }] } : {}) });
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

test('les observations de la zone : toutes par défaut, iNaturalist seul en qualité recherche, puis iNaturalist et GBIF fusionnés — la copie et les doublons écartés, les filtres de l’app appliqués, les plus récentes d’abord', async t => {
  const fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetch; });
  /** @type {string[]} */ const asked = [];
  globalThis.fetch = /** @type {any} */ (answerZone(asked));
  // The defaults: both sources, iNaturalist without a quality grade, GBIF's datasets of the zone (none here: its count
  // asked, nothing more).
  const every = await zoneObservations(C, 2000, { filters: filters(), max: 200 });
  const first = new URL(/** @type {string} */ (asked.find(u => u.includes('api.inaturalist.org/v1/observations?')))).searchParams;
  assert.deepEqual([first.get('quality_grade'), first.get('iconic_taxa')], [null, 'Plantae']);
  assert.deepEqual(asked.filter(u => u.includes('api.gbif.org')).map(u => [new URL(u).searchParams.get('limit'), new URL(u).searchParams.get('facet')]), [['0', 'datasetKey']]);
  assert.deepEqual([every.points.length, every.totals, every.failed], [3, { inat: 3, gbif: 0 }, []]);
  // iNaturalist alone, its research grade (a layout whose maps say src=inat, qualite=recherche): GBIF not asked.
  asked.length = 0;
  const alone = await zoneObservations(C, 2000, { filters: filters({ sources: ['inat'], qualite: ['recherche'] }), max: 200 });
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
  const f = filters({ qualite: ['recherche', 'aidentifier'], taxon: 'espece', photos: 'libre', sauvages: true, jeux: ['cbn', 'plantnet'] });
  const both = await zoneObservations(c2, 2000, { filters: f, periode: 'annee', max: 200 });
  const q = new URL(/** @type {string} */ (asked.find(u => u.includes('api.inaturalist.org/v1/observations?')))).searchParams;
  assert.deepEqual([q.get('quality_grade'), q.get('hrank'), q.get('photo_license'), q.get('captive'), q.get('year')],
    ['research,needs_id', 'species', 'cc0,cc-by,cc-by-sa', 'false', String(new Date().getFullYear())]);
  // GBIF in two requests: the zone's count and datasets first (no record), then the occurrences of the datasets chosen.
  const [g, o] = asked.filter(u => u.includes('api.gbif.org/v1/occurrence/search?')).map(u => new URL(u).searchParams);
  assert.deepEqual([g.get('taxonKey'), g.get('mediaType'), g.getAll('datasetKey'), g.get('facet'), g.get('facetMultiselect'), g.get('year'), g.get('limit')],
    ['6', 'StillImage', ['cbn', 'plantnet'], 'datasetKey', 'true', String(new Date().getFullYear()), '0']);
  assert.match(String(g.get('geoDistance')), /^45\.8000,3\.2000,2\.00km$/);
  // The size of the datasets' facet as GBIF documents it: by field (a bare facetLimit is not one of its words).
  assert.equal(g.get('datasetKey.facetLimit'), '50');
  assert.equal(g.has('facetLimit'), false);
  assert.deepEqual([o.get('limit'), o.getAll('datasetKey'), o.get('facet'), o.get('mediaType'), o.get('year')],
    ['300', ['cbn', 'plantnet'], null, 'StillImage', String(new Date().getFullYear())]);
  assert.deepEqual(both.points.map(p => p.id), ['i902', 'i901', 'i903', 'g1'], 'iNaturalist’s and GBIF’s own, the most recent first');
  const daisy = /** @type {any} */ (both.points.find(p => p.id === 'g1'));
  assert.deepEqual({ kind: daisy.kind, sci: daisy.sci, common: daisy.common, url: daisy.url }, { kind: 'gbif', sci: 'Bellis perennis', common: 'Pâquerette', url: 'https://www.gbif.org/occurrence/1' });
  // GBIF's count without its copy of iNaturalist's (when no dataset is chosen; here two are, without it: as GBIF counts them).
  assert.deepEqual(both.totals, { inat: 3, gbif: 120 });
  assert.deepEqual(both.datasets, [{ key: 'cbn', count: 25 }, { key: 'plantnet', count: 5 }], 'iNaturalist’s copy and a bad key left out');

  // No dataset chosen: GBIF's count without its copy of iNaturalist's.
  const c3 = /** @type {[number, number]} */ ([3.3, 45.9]);
  globalThis.fetch = /** @type {any} */ (answerZone(asked, { gbif: [occurrence(c3, 1, 'Bellis perennis', 400)], count: 120, facets: [{ name: INAT_DATASET, count: 90 }, { name: 'cbn', count: 30 }] }));
  asked.length = 0;
  const all = await zoneObservations(c3, 2000, { filters: filters({ sources: ['gbif'] }) });
  assert.deepEqual(all.totals, { inat: null, gbif: 30 });
  assert.deepEqual(all.points.map(p => p.id), ['g1']);
  // Its occurrences asked of the zone's datasets but the copy: GBIF's page never spent on iNaturalist's records.
  assert.deepEqual(new URL(asked.filter(u => u.includes('api.gbif.org'))[1]).searchParams.getAll('datasetKey'), ['cbn']);
});

test('les jeux GBIF laissés (sansjeux=) : jamais demandés, leurs occurrences retirées du compte ; avec jeux=, parmi ceux-là ; sans facette, écartés après', async t => {
  const fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetch; });
  /** @type {string[]} */ const asked = [];
  const gbifAsked = () => asked.filter(u => u.includes('api.gbif.org')).map(u => new URL(u).searchParams);
  const c = /** @type {[number, number]} */ ([4.1, 46.7]);
  const facets = [{ name: INAT_DATASET, count: 90 }, { name: 'cbn', count: 25 }, { name: 'plantnet', count: 5 }, { name: 'obsorg', count: 10 }];
  /** GBIF's occurrences around a centre: the CBN's, Pl@ntNet's, Observation.org's. @param {[number, number]} at */
  const around = at => [occurrence(at, 1, 'Bellis perennis', 400), occurrence(at, 2, 'Hedera helix', 500, { datasetKey: 'plantnet' }),
    occurrence(at, 3, 'Urtica dioica', 600, { datasetKey: 'obsorg' })];
  const gbif = around(c);
  globalThis.fetch = /** @type {any} */ (answerZone(asked, { gbif, count: 130, facets }));
  // Pl@ntNet left out: its count asked as always (every dataset counted), its occurrences never — the zone's others'.
  const left = await zoneObservations(c, 2000, { filters: filters({ sources: ['gbif'], sansjeux: ['plantnet'] }) });
  const [head, occ] = gbifAsked();
  assert.deepEqual([head.getAll('datasetKey'), head.get('facet'), occ.getAll('datasetKey')], [[], 'datasetKey', ['cbn', 'obsorg']]);
  assert.deepEqual(left.points.map(p => p.id).sort(), ['g1', 'g3']);
  // Its records not counted, nor the copy of iNaturalist's: 130 − 90 − 5.
  assert.equal(left.totals.gbif, 35);
  assert.deepEqual(left.datasets.map(d => d.key), ['cbn', 'plantnet', 'obsorg'], 'every dataset of the zone still listed (to tick it again)');
  // Two left out: asked anew (not the answer kept for one), neither asked.
  asked.length = 0;
  const two = await zoneObservations(c, 2000, { filters: filters({ sources: ['gbif'], sansjeux: ['obsorg', 'plantnet'] }) });
  assert.deepEqual(gbifAsked()[1].getAll('datasetKey'), ['cbn']);
  assert.deepEqual([two.points.map(p => p.id), two.totals.gbif], [['g1'], 25]);
  // Those asked alone (jeux=) and one of them left out: the others of them only, as counted for them.
  asked.length = 0;
  const c2 = /** @type {[number, number]} */ ([4.2, 46.8]);
  globalThis.fetch = /** @type {any} */ (answerZone(asked, { gbif: around(c2), count: 40, facets }));
  const both = await zoneObservations(c2, 2000, { filters: filters({ sources: ['gbif'], jeux: ['cbn', 'plantnet'], sansjeux: ['plantnet', 'obsorg'] }) });
  assert.deepEqual(gbifAsked()[1].getAll('datasetKey'), ['cbn']);
  assert.equal(both.totals.gbif, 35, 'GBIF’s count of those asked (40), Pl@ntNet’s 5 taken off; the Observation.org’s 10 not among them');
  // An answer without the facet: one page, the records of those left out taken off after.
  asked.length = 0;
  const c3 = /** @type {[number, number]} */ ([4.3, 46.9]);
  globalThis.fetch = /** @type {any} */ (answerZone(asked, { gbif: around(c3), noFacets: true }));
  const plain = await zoneObservations(c3, 2000, { filters: filters({ sources: ['gbif'], sansjeux: ['plantnet'] }) });
  assert.deepEqual(plain.points.map(p => p.id).sort(), ['g1', 'g3']);
});

test('les points de la plante choisie et les cartes de France : la qualité dite (qualité recherche sans elle : « Autour », les jeux) ; chaque demande gardée à part', async t => {
  const fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetch; });
  /** @type {string[]} */ const asked = [];
  globalThis.fetch = /** @type {any} */ (answerZone(asked));
  const c = /** @type {[number, number]} */ ([4.5, 47.1]);
  const grade = () => new URL(asked[asked.length - 1]).searchParams.get('quality_grade');
  // Unsaid: research grade, as « Autour » and the games' cards ask (verified identifications).
  const research = await observationsAround(50, c, 1000);
  assert.deepEqual([grade(), new URL(asked[asked.length - 1]).searchParams.get('taxon_id'), research.length], ['research', '50', 3]);
  // A layout's filters (inatQuery): every grade by default — asked anew, not the research grade's answer.
  await observationsAround(50, c, 1000, undefined, inatQuery(filters()));
  assert.equal(asked.length, 2);
  assert.equal(grade(), null);
  await observationsAround(50, c, 1000, undefined, inatQuery(filters({ qualite: ['aidentifier'], sauvages: true })));
  assert.deepEqual([grade(), new URL(asked[asked.length - 1]).searchParams.get('captive')], ['needs_id', 'false']);
  // Each kept a day: asked once.
  await observationsAround(50, c, 1000, undefined, '');
  assert.equal(asked.length, 3);
  // A map of France: iNaturalist's tiles of the grades shown (every one: none said).
  const tiles = (/** @type {string} */ grades) => inatTiles([1000], '&year=2026', 1001, grades).map(l => new URL(l.url.replace(/\{[xyz]\}/g, '0')).searchParams);
  assert.deepEqual(tiles('').map(q => [q.get('taxon_id'), q.get('quality_grade'), q.get('year')]), [['1000', null, '2026'], ['1000', null, '2026'], ['1001', null, '2026']]);
  assert.deepEqual(tiles(inatGrades(['recherche'])).map(q => q.get('quality_grade')), ['research', 'research', 'research']);
});

test('GBIF en deux temps : sans facette, une page comme avant (la copie écartée) ; la copie seule, rien de plus demandé ; choisie, jamais demandée', async t => {
  const fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetch; });
  /** @type {string[]} */ const asked = [];
  const gbifAsked = () => asked.filter(u => u.includes('api.gbif.org')).map(u => new URL(u).searchParams);
  // No facet in the answer: the occurrences of the zone in one page, without a dataset, the copy left out after.
  const c = /** @type {[number, number]} */ ([3.7, 46.3]);
  globalThis.fetch = /** @type {any} */ (answerZone(asked, { noFacets: true, count: 2,
    gbif: [occurrence(c, 1, 'Bellis perennis', 400), occurrence(c, 2, 'Hedera helix', 500, { datasetKey: INAT_DATASET })] }));
  const plain = await zoneObservations(c, 2000, { filters: filters({ sources: ['gbif'] }) });
  const [, page] = gbifAsked();
  assert.deepEqual([page.get('limit'), page.getAll('datasetKey'), page.get('facet')], ['300', [], null]);
  assert.deepEqual(plain.points.map(p => p.id), ['g1']);
  assert.deepEqual([plain.totals.gbif, plain.datasets], [2, []]);
  // Only GBIF's copy of iNaturalist's in the zone: its count asked, nothing more — no point, none of its own.
  asked.length = 0;
  const c2 = /** @type {[number, number]} */ ([3.8, 46.4]);
  globalThis.fetch = /** @type {any} */ (answerZone(asked, { count: 40, facets: [{ name: INAT_DATASET, count: 40 }],
    gbif: [occurrence(c2, 3, 'Hedera helix', 500, { datasetKey: INAT_DATASET })] }));
  const copy = await zoneObservations(c2, 2000, { filters: filters({ sources: ['gbif'] }) });
  assert.equal(gbifAsked().length, 1);
  assert.deepEqual([copy.points, copy.totals.gbif, copy.datasets], [[], 0, []]);
  // The copy among the datasets chosen (an address that says it): counted as asked, its occurrences never asked.
  asked.length = 0;
  const c3 = /** @type {[number, number]} */ ([3.9, 46.5]);
  globalThis.fetch = /** @type {any} */ (answerZone(asked, { count: 60, facets: [{ name: INAT_DATASET, count: 40 }, { name: 'cbn', count: 20 }],
    gbif: [occurrence(c3, 4, 'Bellis perennis', 400)] }));
  const chosen = await zoneObservations(c3, 2000, { filters: filters({ sources: ['gbif'], jeux: [INAT_DATASET, 'cbn'] }) });
  const [head, occ] = gbifAsked();
  assert.deepEqual(head.getAll('datasetKey').sort(), [INAT_DATASET, 'cbn'].sort());
  assert.deepEqual(occ.getAll('datasetKey'), ['cbn']);
  assert.deepEqual([chosen.points.map(p => p.id), chosen.totals.gbif], [['g4'], 20]);
});

test('un groupe de plantes seul (une famille : les orchidées) : chaque source le reçoit dans ses numéros, sa réponse gardée à part de celle des plantes', async t => {
  const fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetch; });
  /** @type {string[]} */ const asked = [];
  const c = /** @type {[number, number]} */ ([3.111, 45.869]);
  globalThis.fetch = /** @type {any} */ (answerZone(asked, { gbif: [occurrence(c, 1, 'Bellis perennis', 400)], count: 1, facets: [{ name: 'cbn', count: 1 }] }));
  const f = filters();
  await zoneObservations(c, 500, { filters: f, taxon: { inat: 47217, gbif: 7689 } });
  const inat = new URL(/** @type {string} */ (asked.find(u => u.includes('api.inaturalist.org/v1/observations?')))).searchParams;
  assert.deepEqual([inat.get('taxon_id'), inat.get('iconic_taxa'), inat.get('quality_grade')], ['47217', 'Plantae', null]);
  const gbif = asked.filter(u => u.includes('api.gbif.org')).map(u => new URL(u).searchParams.get('taxonKey'));
  assert.ok(gbif.length === 2 && gbif.every(k => k === '7689'), 'ses deux requêtes');
  // The same circle for every plant: asked anew (not the orchids' answer), taxonKey=6 as always.
  asked.length = 0;
  await zoneObservations(c, 500, { filters: f });
  assert.equal(new URL(/** @type {string} */ (asked.find(u => u.includes('api.inaturalist.org/v1/observations?')))).searchParams.get('taxon_id'), null);
  assert.deepEqual(asked.filter(u => u.includes('api.gbif.org')).map(u => new URL(u).searchParams.get('taxonKey')), ['6', '6']);
});

test('un lieu (un petit cercle) : seuls les points où était la plante, ceux masqués ou plus larges que le cercle comptés à part ; un genre ou une famille de GBIF nommés sans leur auteur', async t => {
  const fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetch; });
  /** @type {string[]} */ const asked = [];
  const c = /** @type {[number, number]} */ ([3.2, 45.7]);
  const above = (/** @type {number} */ key, /** @type {string} */ rank, /** @type {string} */ sci, /** @type {number} */ m) =>
    ({ ...occurrence(c, key, '', m, { taxonRank: rank, genus: 'Ophrys', family: 'Orchidaceae', scientificName: sci }), species: undefined });
  globalThis.fetch = /** @type {any} */ (answerZone(asked, {
    // The nettle 902 obscured (a point at random in its cell), the ivy 901 within 30 m; GBIF's daisy 2 within 5 km,
    // its daisy 3 within 200 m, an Ophrys and an orchid named by their genus and their family only.
    inat: { 902: { obscured: true, public_positional_accuracy: 28000 }, 901: { public_positional_accuracy: 30 } },
    gbif: [occurrence(c, 1, 'Bellis perennis', 100), occurrence(c, 2, 'Bellis perennis', 150, { coordinateUncertaintyInMeters: 5000 }),
      occurrence(c, 3, 'Bellis perennis', 120, { coordinateUncertaintyInMeters: 200 }), above(4, 'GENUS', 'Ophrys L.', 180), above(5, 'FAMILY', 'Orchidaceae Juss.', 190)],
    facets: [{ name: 'cbn', count: 5 }]
  }));
  const f = filters();
  const site = await zoneObservations(c, 500, { filters: f, precise: true });
  assert.deepEqual(site.points.map(p => p.id).sort(), ['g1', 'g3', 'g4', 'g5', 'i901', 'i903']);
  assert.equal(site.vague, 2, 'the obscured nettle, the daisy within 5 km');
  assert.deepEqual(['g4', 'g5'].map(id => site.points.find(p => p.id === id)?.sci), ['Ophrys', 'Orchidaceae']);
  // Every point as before without it (the layouts' maps): none left out, none counted.
  const all = await zoneObservations(c, 500, { filters: f });
  assert.deepEqual([all.points.length, 'vague' in all], [8, false]);
  // A circle wider than the daisy's 5 km: it is in it; the obscured nettle never.
  const wide = await zoneObservations(c, 10000, { filters: f, precise: true });
  assert.deepEqual([wide.points.some(p => p.id === 'g2'), wide.points.some(p => p.id === 'i902'), wide.vague], [true, false, 1]);
});

test('une source en panne : dite, les autres montrées ; toutes en panne : une erreur qui dit chacune ; un module coupé : dit comme tel', async t => {
  const fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetch; setModule('gbif', true); });
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
    assert.deepEqual(error.failed.map(x => x.name), ['iNaturalist', 'GBIF'], 'in the sources’ order, whichever failed first');
    assert.equal(error.message, failedText(error.failed));
    assert.equal(error.message, 'iNaturalist et GBIF ne répondent pas');
    return true;
  });

  setModule('gbif', false);
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

test('les observations de chaque plante : ses sources à part, comptées comme sa ligne de la liste ; en mots', async () => {
  const p = (/** @type {number | null} */ taxonId, /** @type {string} */ sci, /** @type {string} */ kind) => ({ taxonId, sci, kind, common: null, photo: null, credit: null });
  const points = [p(50, 'Urtica dioica', 'inat'), p(50, 'Urtica dioica', 'inat'), p(null, 'Urtica dioica', 'gbif'), p(null, 'Bellis perennis', 'gbif'),
    p(60, 'Hedera helix', 'inat'), p(null, 'Plantus ignotus', 'gbif')];
  const { list, plantOf } = await speciesOf(points);
  const counts = plantCounts(points, plantOf);
  assert.deepEqual([...counts].sort((a, b) => a[0] - b[0]), [[1, { inat: 1, gbif: 0 }], [2, { inat: 0, gbif: 1 }], [3, { inat: 2, gbif: 1 }]],
    'a plant unknown to the flora not counted');
  for (const s of list.filter(x => x.plantId)) {
    const c = /** @type {any} */ (counts.get(/** @type {number} */ (s.plantId)));
    assert.equal(c.inat + c.gbif, s.count, s.name);
  }
  // In words: both sources asked — the part of each; one source — the number alone.
  const both = obsNotes(counts, ['inat', 'gbif']);
  assert.deepEqual(both.get(3), { n: 3, detail: '2 iNat., 1 GBIF', text: '3 obs. (2 iNat., 1 GBIF)', title: '3 observations dans la zone : 2 iNaturalist, 1 GBIF' });
  assert.deepEqual([both.get(2)?.text, both.get(1)?.text], ['1 obs. GBIF', '1 obs. iNat.']);
  assert.deepEqual(obsNotes(new Map([[7, { inat: 1200, gbif: 0 }]]), ['inat']).get(7),
    { n: 1200, detail: '', text: '1\u202f200 obs.', title: '1\u202f200 observations dans la zone : 1\u202f200 iNaturalist' });
});

test('les plantes de ce que montre une carte : celles de ses points dans sa vue, de ses sources ; une plante inconnue de la flore laiss\u00e9e', async () => {
  const p = (/** @type {number | null} */ taxonId, /** @type {string} */ sci, /** @type {string} */ kind, /** @type {[number, number]} */ coordinates) =>
    ({ taxonId, sci, kind, coordinates, common: null, photo: null, credit: null });
  // West, the ivy and an unknown plant; east, the nettle (iNaturalist) and the daisy (GBIF alone).
  const points = [p(60, 'Hedera helix', 'inat', [2.30, 48.85]), p(null, 'Plantus ignotus', 'gbif', [2.31, 48.85]),
    p(50, 'Urtica dioica', 'inat', [2.40, 48.86]), p(null, 'Bellis perennis', 'gbif', [2.41, 48.84])];
  const { plantOf } = await speciesOf(points);
  assert.deepEqual(plantsIn(points, plantOf, [2.35, 48.8, 2.5, 48.9]), [2, 3]);
  assert.deepEqual(plantsIn(points, plantOf, [2.35, 48.8, 2.5, 48.9], ['inat']), [3], 'the sources the map shows');
  assert.deepEqual(plantsIn(points, plantOf, [2.2, 48.8, 2.5, 48.9]), [1, 2, 3], 'the whole zone: every plant of the flora');
  assert.deepEqual(plantsIn(points, plantOf, [3, 45, 3.1, 45.1]), []);
});
