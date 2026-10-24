// Les orchidées de la colline de Mirabel (app/miniapps/orchidees.js; what is pure about it: app/miniapp/kit/orchids.js),
// against an IndexedDB in memory (fake-indexeddb) holding the reduced flora, iNaturalist and GBIF answered here: the
// circle as it starts (the hill, 500 m), only the orchids asked of each source (iNaturalist's taxon 47217, GBIF's key
// 7689; every quality grade, the plants grown left out, the points not where the plant was too: obscured, rougher than
// the circle), the observations' orchids (one plant once, whichever source saw it; a genus named by both sources once,
// without its author; a name above the genus counted as « Genre non précisé »; a plant the flora says is not an orchid
// left out),
// what protects each one at Mirabel (Auvergne, Puy-de-Dôme — a regional protection elsewhere is not one here; the
// place unknown, any counts), and the light filters: genus, protection and statuses, a name — each choice counted in
// observations among those the other filters keep.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/** @type {any} */ (globalThis).window ??= globalThis;
/** @type {any} */ (globalThis).matchMedia ??= () => ({ matches: false });

const db = await import('../../app/core/db.js');
const { store } = await import('../../app/core/store.js');
const { territoryAt } = await import('../../app/core/territory.js');
const { MiniApp, storageKey } = await import('../../app/miniapp/runtime.js');
const { NO_GENUS, ORCHIDACEAE, RADIUS, SITE, askedKey, factsOf, filterOrchids, filtering, genusWord, nameRank, sameSpot } = await import('../../app/miniapp/kit/orchids.js');
const { obsNotes } = await import('../../app/core/observations.js');
const orchidees = (await import('../../app/miniapps/orchidees.js')).default;

const plants = JSON.parse(await readFile(new URL('../fixtures/plants.json', import.meta.url), 'utf8'));
await db.replacePlants(plants, { version: 'test' });
store.set({ status: 'ready' });
const named = (/** @type {string} */ name) => plants.find((/** @type {any} */ p) => p.scientificName === name);

/** Mirabel, as the bundled outlines place it. */
const MIRABEL = await territoryAt(SITE);

test('le lieu : la colline de Mirabel, à Ménétrol (Puy-de-Dôme, ancienne région Auvergne), 500 m', () => {
  assert.deepEqual([...SITE], [3.111, 45.869]);
  assert.equal(RADIUS, 500);
  assert.deepEqual(MIRABEL && { dept: MIRABEL.dept, region: MIRABEL.region, formers: MIRABEL.formers }, { dept: '63', region: 'FR-ARA', formers: ['Auvergne'] });
  assert.ok(sameSpot([3.111004, 45.869003], SITE));
  assert.ok(!sameSpot([3.1111, 45.869], SITE));
});

test('ce qui protège une orchidée à Mirabel : sa protection ici (France, sinon région ou département), une liste rouge, l’endémisme', () => {
  const t = /** @type {any} */ (MIRABEL);
  // Protected in Auvergne (PR) and vulnerable on its red list; protected and red-listed elsewhere too (Alsace, Lorraine).
  assert.deepEqual(factsOf(named('Traunsteinera globosa'), t), { here: 'Auvergne', red: 'vulnérable (Auvergne)', endemic: false });
  // Critically endangered in France, endemic; protected nowhere.
  assert.deepEqual(factsOf(named('Dactylorhiza brennensis'), t), { here: null, red: 'en danger critique (France)', endemic: true });
  // Protected in other regions and a department only: not here; the place unknown, any counts (fail closed).
  assert.deepEqual(factsOf(named('Ophrys holosericea'), t), { here: null, red: null, endemic: false });
  assert.equal(factsOf(named('Ophrys holosericea'), null)?.here, 'Centre');
  // A national protection, and a red list's « least concern », which is no risk.
  const national = { statuses: [{ type: 'PN', code: 'PN', area: 'France métropolitaine', iso: '' }, { type: 'LRN', code: 'LC', area: 'France métropolitaine', iso: '' }] };
  assert.deepEqual(factsOf(national, t), { here: 'France', red: null, endemic: false });
  assert.equal(factsOf(null, t), null, 'hors de la flore : rien à dire');
  // The genus an observation is counted under: none above it (a family, a tribe), an intergeneric hybrid with its sign.
  assert.deepEqual(['Orchidaceae', 'Orchideae', 'Orchidinae', 'Ophrys', '× Dactylodenia', null].map(genusWord), [null, null, null, 'Ophrys', '× Dactylodenia', null]);
  // A name outside the flora without its author, and how far it goes: the species (a hybrid too), the genus only, above it.
  assert.deepEqual(['Ophrys aranifera', 'Ophrys L.', 'Ophrys', 'Orchidaceae Juss.', 'Orchidaceae', 'Orchis × hybrida', '× Dactylodenia', '×Dactylodenia Garay & H.R.Sweet', 'Orchidoideae Eaton'].map(nameRank), [
    { name: 'Ophrys aranifera', rank: 'species' }, { name: 'Ophrys', rank: 'genus' }, { name: 'Ophrys', rank: 'genus' }, { name: 'Orchidaceae', rank: 'higher' },
    { name: 'Orchidaceae', rank: 'higher' }, { name: 'Orchis × hybrida', rank: 'species' }, { name: '× Dactylodenia', rank: 'genus' }, { name: '× Dactylodenia', rank: 'genus' },
    { name: 'Orchidoideae', rank: 'higher' }]);
});

/** iNaturalist's taxon of each plant of the answers, and GBIF's records by name. */
const TAXA = { 'Traunsteinera globosa': 901, 'Ophrys holosericea': 902, 'Dactylorhiza brennensis': 903, Ophrys: 47344, Orchidaceae: 47217, 'Urtica dioica': 48460 };

/**
 * fetch answering the circle's observations: iNaturalist's (Traunsteinera globosa twice, and a third time obscured;
 * Ophrys holosericea, two named by their genus « Ophrys », an orchid named by its family only, and a nettle — a source
 * answering wider than asked), GBIF's (Ophrys holosericea, named its way, Dactylorhiza brennensis, and again within
 * 2 km; an Ophrys named by its genus, « Ophrys L. »), around the point asked; the bundled files read from the
 * repository; anything else 503. `asked`: the addresses.
 * @param {string[]} asked
 */
function answering(asked) {
  const fetch = globalThis.fetch;
  /** @param {any} body */
  const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  globalThis.fetch = /** @type {any} */ (async (/** @type {any} */ input, /** @type {any} */ init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.protocol === 'file:') return fetch(input, init);
    asked.push(url.href);
    const q = url.searchParams;
    if (url.host === 'api.inaturalist.org' && url.pathname === '/v1/observations') {
      const [lat, lng] = [Number(q.get('lat')), Number(q.get('lng'))];
      const row = (/** @type {number} */ id, /** @type {string} */ name, /** @type {number} */ k, more = {}) => ({ id, uri: `https://www.inaturalist.org/observations/${id}`,
        geojson: { type: 'Point', coordinates: [lng + k * 0.0004, lat + k * 0.0003] }, observed_on: `2026-05-${String(10 + k).padStart(2, '0')}`, place_guess: 'Ménétrol',
        taxon: { id: TAXA[/** @type {keyof typeof TAXA} */ (name)], name, preferred_common_name: null }, ...more });
      const results = [row(1, 'Traunsteinera globosa', 1), row(2, 'Traunsteinera globosa', 2), row(3, 'Ophrys holosericea', 3), row(4, 'Orchidaceae', -1), row(5, 'Urtica dioica', -2),
        row(6, 'Ophrys', 4), row(7, 'Ophrys', 5), row(8, 'Traunsteinera globosa', 6, { obscured: true, public_positional_accuracy: 28000 })];
      return json({ total_results: results.length, results: q.get('page') === '1' ? results : [] });
    }
    if (url.host === 'api.gbif.org' && url.pathname === '/v1/occurrence/search') {
      const [lat, lng] = String(q.get('geoDistance')).split(',').map(Number);
      const rec = (/** @type {number} */ key, /** @type {string | null} */ species, /** @type {string} */ sci, /** @type {number} */ k, more = {}) => ({ key, decimalLatitude: lat - k * 0.0003, decimalLongitude: lng - k * 0.0004,
        ...(species ? { species } : {}), scientificName: sci, taxonRank: species ? 'SPECIES' : 'GENUS', genus: sci.split(' ')[0], family: 'Orchidaceae',
        eventDate: `2024-06-0${k}`, datasetKey: 'cbn', datasetName: 'CBN Massif central', ...more });
      return json({ count: 4, results: q.get('limit') === '0' ? [] : [rec(11, 'Ophrys holosericea', 'Ophrys holosericea (Burm.f.) Greuter', 1), rec(12, 'Dactylorhiza brennensis', 'Dactylorhiza brennensis (E.Nelson) Soó', 2),
        rec(13, null, 'Ophrys L.', 3), rec(14, 'Dactylorhiza brennensis', 'Dactylorhiza brennensis (E.Nelson) Soó', 4, { coordinateUncertaintyInMeters: 2000 })] });
    }
    return new Response('', { status: 503 });
  });
  return () => { globalThis.fetch = fetch; };
}

/** Until the circle asked has its answer. @param {any} app */
async function answered(app) {
  for (let i = 0; i < 200 && app.c.obs?.key !== askedKey(app.c); i++) await new Promise(resolve => setTimeout(resolve, 20));
  return app.c.obs;
}

test('Orchidées de Mirabel : seules les orchidées demandées aux deux sources, autour de la colline ; chacune une fois, ce qui la protège ici', async t => {
  /** @type {string[]} */
  const asked = [];
  t.after(answering(asked));
  const app = new MiniApp(orchidees, { saved: null });
  t.after(() => { app.dispose(); localStorage.removeItem(storageKey('orchidees', 'state')); });
  assert.deepEqual([app.step.id, app.c.point, app.c.radius, app.c.genera, app.c.marks, app.c.query], ['start', SITE, 500, [], [], '']);
  assert.ok(app.go('map'));
  const found = await answered(app);
  assert.equal(found.error, null);

  // iNaturalist: the family alone, every quality grade, no plant grown; GBIF: its key, the plants (6) never asked.
  const inat = new URL(/** @type {string} */ (asked.find(u => u.includes('api.inaturalist.org/v1/observations?')))).searchParams;
  assert.deepEqual([inat.get('taxon_id'), inat.get('lat'), inat.get('lng'), inat.get('radius'), inat.get('quality_grade'), inat.get('captive')],
    [String(ORCHIDACEAE.inat), '45.86900', '3.11100', '0.50', null, 'false']);
  const gbif = asked.filter(u => u.includes('api.gbif.org/v1/occurrence/search?')).map(u => new URL(u).searchParams);
  assert.ok(gbif.length && gbif.every(g => g.get('taxonKey') === String(ORCHIDACEAE.gbif)));
  assert.equal(gbif[0].get('geoDistance'), '45.8690,3.1110,0.50km');

  // The orchids, the most observed first: one plant once whichever source saw it — the genus Ophrys too, iNaturalist's
  // « Ophrys » and GBIF's « Ophrys L. » —; the nettle left out; the obscured Traunsteinère and the Dactylorhize within
  // 2 km left out, counted.
  assert.deepEqual(found.orchids.map((/** @type {any} */ o) => [o.name, o.genus, o.rank, o.inat, o.gbif, Boolean(o.plant)]), [
    ['Ophrys', 'Ophrys', 'genus', 2, 1, false],
    ['Ophrys holosericea', 'Ophrys', 'species', 1, 1, true],
    ['Traunsteinera globosa', 'Traunsteinera', 'species', 2, 0, true],
    ['Dactylorhiza brennensis', 'Dactylorhiza', 'species', 0, 1, true],
    ['Orchidaceae', null, 'higher', 1, 0, false]
  ]);
  assert.equal(obsNotes(new Map([[0, found.orchids[0]]]), ['inat', 'gbif']).get(0)?.text, '3 obs. (2 iNat., 1 GBIF)');
  assert.equal(new Set(found.points.filter((/** @type {any} */ p) => /^Ophrys$/.test(p.sci)).map((/** @type {any} */ p) => p.orchid)).size, 1, 'one key on the map');
  assert.equal(found.points.length, 9);
  assert.equal(found.vague, 2);
  assert.ok(!found.points.some((/** @type {any} */ p) => /Urtica/.test(p.sci)));
  const traun = found.orchids.find((/** @type {any} */ o) => o.name === 'Traunsteinera globosa');
  assert.deepEqual(traun.facts, { here: 'Auvergne', red: 'vulnérable (Auvergne)', endemic: false });
  assert.equal(traun.common, 'Traunsteinère globuleuse', 'le nom français de la flore');

  // The filters, as the screen applies them (the manifest's `shown`).
  assert.deepEqual(app.c.shown.genera.map((/** @type {any} */ g) => [g.label, g.count]), [['Ophrys', 5], ['Traunsteinera', 2], ['Dactylorhiza', 1], ['Genre non précisé', 1]]);
  assert.deepEqual(app.c.shown.marks.map((/** @type {any} */ m) => [m.label, m.count]), [['Protégée ici', 2], ['Liste rouge', 3], ['Endémique', 1]]);
  app.set({ genera: ['Ophrys'] });
  assert.deepEqual([app.c.shown.points.length, app.c.shown.orchids.map((/** @type {any} */ o) => o.name)], [5, ['Ophrys', 'Ophrys holosericea']]);
  // A mark chosen: an orchid outside the flora (no status) goes; the genera counted among the protected ones.
  app.set({ genera: [], marks: ['protegee'] });
  assert.deepEqual(app.c.shown.orchids.map((/** @type {any} */ o) => o.name), ['Traunsteinera globosa']);
  assert.deepEqual(app.c.shown.genera.map((/** @type {any} */ g) => [g.label, g.count]), [['Traunsteinera', 2]]);
  // A name, case and accents aside, its French name too.
  app.set({ marks: [], query: 'TRAUNSTEINERE glob' });
  assert.deepEqual(app.c.shown.orchids.map((/** @type {any} */ o) => o.name), ['Traunsteinera globosa']);
  app.set({ query: '' });

  // Moved and widened: asked again around the new centre.
  asked.length = 0;
  app.set({ point: [3.12, 45.87], radius: 1000 });
  await answered(app);
  const again = new URL(/** @type {string} */ (asked.find(u => u.includes('api.inaturalist.org/v1/observations?')))).searchParams;
  assert.deepEqual([again.get('lat'), again.get('lng'), again.get('radius')], ['45.87000', '3.12000', '1.00']);
});

test('les filtres : un genre, une protection, un nom ; chaque choix compté parmi ce que gardent les autres ; un choix sans observation gardé s’il est choisi', () => {
  /** @param {string} key @param {string | null} genus @param {any} facts @param {string} words */
  const orchid = (key, genus, facts, words) => ({ key, plant: facts ? { id: key } : null, name: key, common: null, genus, inat: 1, gbif: 0, facts, words });
  const found = {
    orchids: [orchid('a', 'Ophrys', { here: 'France', red: null, endemic: false }, 'ophrys abeille'), orchid('b', 'Orchis', { here: null, red: 'vulnérable (Auvergne)', endemic: false }, 'orchis militaire'),
      orchid('c', null, null, 'orchidaceae')],
    points: /** @type {any[]} */ (['a', 'a', 'b', 'c'].map((orchid, i) => ({ id: String(i), orchid })))
  };
  const all = filterOrchids(/** @type {any} */ (found));
  assert.equal(all.points.length, 4);
  assert.deepEqual(all.genera.map(g => [g.value, g.count]), [['Ophrys', 2], ['Orchis', 1], [NO_GENUS, 1]], 'les plus observés d’abord, « non précisé » à la fin');
  assert.deepEqual(all.marks.map(m => [m.value, m.count]), [['protegee', 2], ['liste-rouge', 1]], 'aucune endémique : pas de puce');
  const some = filterOrchids(/** @type {any} */ (found), { genera: ['Orchis', 'Ophrys'], marks: ['liste-rouge'] });
  assert.deepEqual(some.points.map(p => p.orchid), ['b']);
  assert.deepEqual(some.genera.map(g => [g.value, g.count]), [['Orchis', 1], ['Ophrys', 0]], 'un genre choisi reste, même à zéro');
  assert.deepEqual(some.marks.map(m => [m.value, m.count]), [['protegee', 2], ['liste-rouge', 1]], 'compté parmi les genres choisis');
  assert.deepEqual(filterOrchids(/** @type {any} */ (found), { query: 'Abeille' }).orchids.map(o => o.key), ['a']);
  assert.deepEqual(filterOrchids(/** @type {any} */ (found), { genera: [NO_GENUS] }).orchids.map(o => o.key), ['c']);
  assert.ok(!filtering({}) && !filtering({ query: '  ' }) && filtering({ marks: ['endemique'] }));
});
