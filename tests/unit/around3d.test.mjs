// app/core/around3d.js: the observations around a centre on the maps in 3D — what each map keeps (always valid, one
// record per map), a GBIF occurrence shown as an iNaturalist observation (the same plant's photo and name whichever
// sources are on, never a hybrid's for a species; its source; core/nearby.js floraPhotos: the flora's, from an
// IndexedDB in memory, and the photo found online for a plant without one, with its credit — the services answered
// by a fetch of this file's), the points kept in the circle only, the density's hexagons, the circle's wall in
// pieces, the zoom that frames a circle.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { config } = await import('../../app/config.js');
const {
  AROUND3D_DEFAULTS, INAT_DATASET, RADII_3D, around3dPrefs, cleanAround3d, fitZoom, gbifSource, hexBins, inCircle, metres, morePhotos, observations3d,
  radiusLabel, radiusWords, ringWall, setAround3dPrefs, sharePhotos, wallHeight
} = await import('../../app/core/around3d.js');
const { floraPhotos } = await import('../../app/core/nearby.js');
const db = await import('../../app/core/db.js');

const C = /** @type {[number, number]} */ ([3.087, 45.7772]);
/** A point `m` metres from C, towards `deg` (0: north, 90: east). @param {number} m @param {number} deg @returns {[number, number]} */
const at = (m, deg) => {
  const a = deg * Math.PI / 180;
  return [C[0] + (m * Math.sin(a)) / (6371008.8 * Math.PI / 180 * Math.cos(C[1] * Math.PI / 180)), C[1] + (m * Math.cos(a)) / (6371008.8 * Math.PI / 180)];
};

test('ce que garde chaque carte : valide quoi qu’on lise, une fiche par carte', () => {
  assert.equal(config.storageKeys.around3d, 'geoflora.around3d');
  assert.deepEqual(cleanAround3d(null), { ...AROUND3D_DEFAULTS });
  assert.equal(AROUND3D_DEFAULTS.on, false, 'masqué par défaut');
  assert.deepEqual(cleanAround3d({ on: 'oui', radius: 1234, inat: false, density: true, extra: 1 }),
    { on: false, radius: AROUND3D_DEFAULTS.radius, inat: false, gbif: true, density: true });
  localStorage.removeItem(config.storageKeys.around3d);
  // A page's own circle: the nearest radius offered, while the map has none of its own.
  assert.equal(around3dPrefs('ma-around-map', 4200).radius, 5000);
  assert.equal(around3dPrefs('gf-map-page').radius, 2000);
  setAround3dPrefs('gf-map-page', { on: true, radius: 10000 });
  setAround3dPrefs('gf-sheet-map', { radius: 500, gbif: false });
  assert.deepEqual(around3dPrefs('gf-map-page'), { ...AROUND3D_DEFAULTS, on: true, radius: 10000 });
  assert.deepEqual(around3dPrefs('gf-sheet-map'), { ...AROUND3D_DEFAULTS, radius: 500, gbif: false });
  assert.equal(around3dPrefs('gf-map-page', 200).radius, 10000, 'its own radius wins over the page’s');
  localStorage.setItem(config.storageKeys.around3d, '{broken');
  assert.deepEqual(around3dPrefs('gf-map-page'), { ...AROUND3D_DEFAULTS });
  localStorage.removeItem(config.storageKeys.around3d);
});

/** A GBIF occurrence as gbifAround makes it (no photo, seldom a French name). @param {string} sci @param {Partial<any>} [more] */
const occurrence = (sci, more = {}) => ({ id: 'g1', kind: 'gbif', coordinates: C, title: sci, common: null, sci, taxonId: null, photo: null, credit: null,
  date: '2024-06-12', place: 'Royat', source: 'GBIF · Inventaire du CBN', url: 'https://www.gbif.org/occurrence/1', ...more });
const NETTLE = { sci: 'Urtica dioica', common: 'Ortie dioïque', taxonId: 50, photo: 'https://inaturalist-open-data.s3.amazonaws.com/photos/9/square.jpg',
  credit: { author: 'Camille', license: 'CC BY', source: 'iNaturalist' } };

test('GBIF comme iNaturalist : la photo, le nom et le taxon d’une observation de la même plante, sans rien changer des points donnés', () => {
  const gbif = [occurrence('Urtica dioica'), occurrence('Urtica dioica subsp. dioica', { title: 'Ortie', common: 'Ortie' }), occurrence('Hedera helix'),
    occurrence('Urtica dioica', { photo: 'https://example.org/own.jpg' })];
  const before = JSON.stringify(gbif);
  const [a, b, c, d] = sharePhotos(gbif, [{ ...NETTLE, photo: null, common: 'Ortie sans photo' }, NETTLE]);
  // The first observation of the plant with a photo gives it; its French name names the point.
  assert.deepEqual({ photo: a.photo, credit: a.credit, common: a.common, title: a.title, taxonId: a.taxonId },
    { photo: NETTLE.photo, credit: NETTLE.credit, common: 'Ortie dioïque', title: 'Ortie dioïque', taxonId: 50 });
  assert.equal(a.source, 'GBIF · Inventaire du CBN', 'its source kept: its card says it');
  // A subspecies is its species' plant; its own name kept.
  assert.equal(b.photo, NETTLE.photo);
  assert.equal(b.title, 'Ortie');
  // No twin: as it was (the same object); a photo of its own: kept, the plant's name given.
  assert.equal(c, gbif[2]);
  assert.deepEqual({ photo: d.photo, common: d.common }, { photo: 'https://example.org/own.jpg', common: 'Ortie dioïque' });
  assert.equal(JSON.stringify(gbif), before, 'the points given unchanged (a cache holds them)');
  assert.deepEqual(sharePhotos(gbif, []), gbif);
  // A twin without a free photo: its name and taxon (an iNaturalist observation of it is named so), no photo.
  const [named] = sharePhotos([occurrence('Hedera helix')], [{ sci: 'Hedera helix', common: 'Lierre', taxonId: 60, photo: null, credit: null }]);
  assert.deepEqual({ photo: named.photo, common: named.common, title: named.title, taxonId: named.taxonId }, { photo: null, common: 'Lierre', title: 'Lierre', taxonId: 60 });
  // A species' own photo over its subspecies' for another subspecies.
  const ssp = { ...NETTLE, sci: 'Urtica dioica subsp. dioica', photo: 'https://example.org/ssp.jpg' };
  assert.equal(sharePhotos([occurrence('Urtica dioica subsp. galeopsifolia')], [ssp, NETTLE])[0].photo, NETTLE.photo);
});

test('GBIF comme iNaturalist : jamais la photo ni le nom d’un hybride pour une espèce, ni d’un hybride pour un autre', () => {
  const twin = (/** @type {string} */ sci, /** @type {string} */ common, /** @type {number} */ taxonId) =>
    ({ sci, common, taxonId, photo: `https://example.org/${taxonId}.jpg`, credit: { author: 'Camille', license: 'CC BY', source: 'iNaturalist' } });
  const from = [twin('Heracleum mantegazzianum × sphondylium', 'Berce hybride', 222), twin('Mentha × piperita', 'Menthe poivrée', 111)];
  const gbif = [occurrence('Heracleum mantegazzianum'), occurrence('Mentha × villosa'), occurrence('Mentha x piperita'), occurrence('Heracleum mantegazzianum x sphondylium')];
  const [hogweed, villosa, piperita, hybrid] = sharePhotos(gbif, from);
  // The giant hogweed (dangerous) never takes the hybrid's photo or name; two nothospecies of a genus are two plants.
  assert.equal(hogweed, gbif[0]);
  assert.equal(villosa, gbif[1]);
  // The same hybrid, by its whole name (« x » or « × »): its photo and name.
  assert.deepEqual({ photo: piperita.photo, common: piperita.common }, { photo: 'https://example.org/111.jpg', common: 'Menthe poivrée' });
  assert.deepEqual({ photo: hybrid.photo, common: hybrid.common, taxonId: hybrid.taxonId }, { photo: 'https://example.org/222.jpg', common: 'Berce hybride', taxonId: 222 });
});

/** The flora of these tests: the ivy with its thumbnail, the daisy without one (its photo found online). */
const FLORA = [
  { id: 1, scientificName: 'Hedera helix', synonyms: [], family: 'Araliaceae', genus: 'Hedera', vernacularNames: ['Lierre grimpant'],
    thumbnail: { url: 'https://upload.wikimedia.org/hedera.jpg', author: 'Jane', license: 'CC BY-SA 4.0', source: 'Wikimedia Commons' } },
  { id: 2, scientificName: 'Bellis perennis', synonyms: [], family: 'Asteraceae', genus: 'Bellis', vernacularNames: ['Pâquerette'] }
];

test('GBIF comme iNaturalist : la photo et le nom de la flore pour une plante sans observation iNaturalist ; une plante inconnue reste une feuille', async () => {
  await db.replacePlants(FLORA, { version: 'test' });
  const given = [occurrence('Hedera helix L.'), occurrence('Bellis perennis'), occurrence('Plantus ignotus'), { ...occurrence('Hedera helix'), ...NETTLE, sci: 'Hedera helix' }];
  const [ivy, daisy, unknown, done] = await floraPhotos(given, { names: true });
  assert.deepEqual({ photo: ivy.photo, common: ivy.common, title: ivy.title }, { photo: 'https://upload.wikimedia.org/hedera.jpg', common: 'Lierre grimpant', title: 'Lierre grimpant' });
  assert.deepEqual(ivy.credit, { author: 'Jane', license: 'CC BY-SA 4.0', source: 'Wikimedia Commons', sourceUrl: null });
  // Known without a thumbnail: its name, its leaf.
  assert.deepEqual({ photo: daisy.photo, common: daisy.common }, { photo: null, common: 'Pâquerette' });
  assert.equal(unknown, given[2]);
  assert.equal(done, given[3], 'a photo and a name already: as it was');
  assert.equal(given[0].photo, null, 'the points given unchanged');
  // Without `names`: the photos only (iNaturalist's observations keep their names).
  const [photoOnly] = await floraPhotos([occurrence('Bellis perennis', { photo: null }), occurrence('Hedera helix')]);
  assert.equal(photoOnly.common, null);
});

test('la source d’un relevé GBIF, telle que sa carte la dit', () => {
  assert.equal(gbifSource('Inventaire du CBN'), 'GBIF · Inventaire du CBN');
  assert.equal(gbifSource('  '), 'GBIF');
  assert.equal(gbifSource(null), 'GBIF');
  const long = gbifSource('Données d’observation de la flore du Conservatoire botanique national du Massif central (2000-2024)');
  assert.ok(long.length <= 'GBIF · '.length + 60 && long.endsWith('…'));
});

test('les rayons : ceux des mini-apps, dits en français', () => {
  assert.deepEqual(RADII_3D, [200, 500, 1000, 2000, 5000, 10000, 20000, 50000]);
  assert.equal(radiusLabel(500), '500 m');
  assert.equal(radiusLabel(2000), '2 km');
  assert.equal(radiusWords(1000), '1 kilomètre');
  assert.equal(radiusWords(20000), '20 kilomètres');
});

test('seuls les points dans le cercle restent', () => {
  const pts = [{ coordinates: at(100, 0) }, { coordinates: at(1990, 90) }, { coordinates: at(2050, 180) }, { coordinates: at(5000, 270) }];
  assert.ok(Math.abs(metres(C, at(1500, 45)) - 1500) < 2);
  assert.deepEqual(inCircle(pts, C, 2000), pts.slice(0, 2));
});

test('la densité : des hexagones, chacun son compte, sa part du plus chargé et ses plantes les plus vues', () => {
  const pts = [
    ...Array.from({ length: 6 }, (_, i) => ({ coordinates: at(20 + i, i * 60), title: i < 4 ? 'Ortie' : 'Ail des ours' })),
    { coordinates: at(1500, 90), title: 'Pâquerette' }, { coordinates: at(1510, 90), title: 'Pâquerette' }, { coordinates: at(1500, 270), title: 'Lierre' }
  ];
  const hex = hexBins(pts, C, 2000);
  assert.equal(hex.size, 2000 / 7);
  assert.equal(hex.max, 6);
  const byN = hex.features.map(f => f.properties.n).sort((a, b) => b - a);
  assert.deepEqual(byN, [6, 2, 1]);
  const busiest = hex.features.find(f => f.properties.n === 6);
  assert.equal(busiest.properties.t, 1);
  assert.equal(busiest.properties.top, 'Ortie · Ail des ours');
  assert.equal(hex.features.find(f => f.properties.n === 2).properties.t, 2 / 6);
  for (const f of hex.features) {
    const ring = f.geometry.coordinates[0];
    assert.equal(ring.length, 7);
    assert.deepEqual(ring[0], ring[6], 'closed');
  }
  assert.deepEqual(hexBins([], C, 2000).features, []);
});

test('le mur du cercle : de courts morceaux le long du bord, à la hauteur du rayon', () => {
  const wall = ringWall(C, 2000, 48);
  assert.equal(wall.features.length, 48);
  for (const f of wall.features) {
    const [a, b, c, d] = f.geometry.coordinates[0];
    assert.ok(Math.abs(metres(C, a) - 2000) < 1 && Math.abs(metres(C, b) - 2000) < 1);
    assert.ok(metres(C, c) < 2000 && metres(C, d) < 2000);
  }
  assert.equal(wallHeight(2000), 160);
  assert.equal(wallHeight(100), 20);
  assert.equal(wallHeight(50000), 1500);
});

test('le cadrage : le zoom où le cercle couvre tant de pixels', () => {
  // At the equator, zoom 0 (512 px tiles): 78 271.5 m a pixel; 1 km across 500 px is 2 m a pixel: zoom ~15.25.
  assert.ok(Math.abs(fitZoom(500, 0, 500) - Math.log2(78271.517 / 2)) < 1e-3);
  assert.ok(fitZoom(1000, 45, 400) > fitZoom(2000, 45, 400), 'a smaller circle, closer');
});

/**
 * The services of a circle answered (anything else: 503): GBIF's occurrences (the nettle, the ivy, the daisy, a plant
 * outside the flora, the giant hogweed, and GBIF's copy of an iNaturalist observation), iNaturalist's plants in the
 * circle (the nettle's photo under CC BY; the ivy's under CC BY-NC, never shown; a hogweed hybrid's), its observations
 * (`inat` of them, the nettle and the ivy), and its taxon search (the daisy's photo under CC BY). `asked`: the addresses.
 * @param {string[]} asked @param {number} [inat]
 */
function answerCircle(asked, inat = 2) {
  const json = (/** @type {any} */ body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const taxon = (/** @type {number} */ id, /** @type {string} */ name, /** @type {string | null} */ common, /** @type {string} */ license) => ({ id, name, preferred_common_name: common,
    default_photo: { id: id * 10, license_code: license, attribution: '(c) Camille, some rights reserved', square_url: `https://inaturalist-open-data.s3.amazonaws.com/photos/${id}/square.jpg` } });
  const NETTLE_T = taxon(50, 'Urtica dioica', 'Ortie dioïque', 'cc-by'), IVY_T = taxon(60, 'Hedera helix', 'Lierre', 'cc-by-nc');
  return async (/** @type {string | URL | Request} */ input) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    asked.push(url.href);
    if (url.host === 'api.gbif.org' && url.pathname === '/v1/occurrence/search') {
      const [lat, lon] = String(url.searchParams.get('geoDistance')).split(',').map(Number);
      const row = (/** @type {number} */ key, /** @type {string} */ species, more = {}) => ({ key, decimalLatitude: lat + key * 1e-4, decimalLongitude: lon, species, scientificName: species + ' L.',
        eventDate: '2024-06-12', datasetName: 'Inventaire du CBN', datasetKey: 'cbn', locality: 'Royat', ...more });
      return json({ count: 6, results: [row(1, 'Urtica dioica'), row(2, 'Hedera helix'), row(3, 'Bellis perennis'), row(4, 'Plantus ignotus'),
        row(5, 'Heracleum mantegazzianum'), row(6, 'Urtica dioica', { datasetKey: INAT_DATASET })] });
    }
    if (url.host === 'api.inaturalist.org' && url.pathname === '/v1/observations/species_counts') {
      return json({ results: [{ count: 9, taxon: NETTLE_T }, { count: 4, taxon: IVY_T }, { count: 1, taxon: taxon(70, 'Heracleum mantegazzianum × sphondylium', 'Berce hybride', 'cc-by') }] });
    }
    if (url.host === 'api.inaturalist.org' && url.pathname === '/v1/observations') {
      const [lat, lon] = [Number(url.searchParams.get('lat')), Number(url.searchParams.get('lng'))];
      return json({ total_results: inat, results: Array.from({ length: inat }, (_, i) => ({ id: 900 + i, uri: `https://www.inaturalist.org/observations/${900 + i}`,
        geojson: { type: 'Point', coordinates: [lon, lat - (i + 1) * 1e-4] }, observed_on: '2026-05-02', place_guess: 'Royat', taxon: i % 2 ? IVY_T : NETTLE_T })) });
    }
    if (url.host === 'api.inaturalist.org' && url.pathname === '/v1/taxa' && url.searchParams.get('q') === 'Bellis perennis') {
      return json({ results: [{ id: 80, name: 'Bellis perennis', rank: 'species', preferred_common_name: 'Pâquerette vivace',
        default_photo: { license_code: 'cc-by', attribution: '(c) Jane Doe, some rights reserved (CC BY)', square_url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/80/square.jpg' } }] });
    }
    return new Response('', { status: 503 });
  };
}

test('GBIF seul, ou avec iNaturalist : la même photo pour la même plante — celle de son taxon sur iNaturalist, sinon celle de la flore, sinon trouvée en ligne avec son crédit', async t => {
  await db.replacePlants(FLORA, { version: 'test' });
  const fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetch; });
  /** @type {string[]} */ const asked = [];
  globalThis.fetch = /** @type {any} */ (answerCircle(asked));
  const alone = await observations3d(C, 2000, { inat: false, gbif: true });
  assert.deepEqual(alone.failed, []);
  assert.ok(asked.some(u => u.includes('/v1/observations/species_counts')), 'iNaturalist asked for its plants in the circle');
  assert.ok(!asked.some(u => /\/v1\/observations\?/.test(u)), 'not for its observations: its source is off');
  const by = (/** @type {any[]} */ pts) => Object.fromEntries(pts.filter(p => p.kind === 'gbif').map(p => [p.sci, p]));
  const g = by(alone.points);
  // GBIF's copy of an iNaturalist observation left out.
  assert.equal(alone.points.filter(p => p.kind === 'gbif').length, 5);
  // The nettle (not in this flora): its taxon's photo on iNaturalist, its credit, its French name, its taxon.
  assert.deepEqual({ photo: g['Urtica dioica'].photo, common: g['Urtica dioica'].common, title: g['Urtica dioica'].title, taxonId: g['Urtica dioica'].taxonId },
    { photo: 'https://inaturalist-open-data.s3.amazonaws.com/photos/50/square.jpg', common: 'Ortie dioïque', title: 'Ortie dioïque', taxonId: 50 });
  assert.equal(g['Urtica dioica'].credit?.license, 'CC BY');
  // The ivy: iNaturalist's photo not free — the flora's, its credit; its name as iNaturalist's observations say it.
  assert.deepEqual({ photo: g['Hedera helix'].photo, common: g['Hedera helix'].common, credit: g['Hedera helix'].credit?.author },
    { photo: 'https://upload.wikimedia.org/hedera.jpg', common: 'Lierre', credit: 'Jane' });
  // Outside the flora and unknown to iNaturalist here: a leaf, named by its scientific name.
  assert.deepEqual({ photo: g['Plantus ignotus'].photo, title: g['Plantus ignotus'].title }, { photo: null, title: 'Plantus ignotus' });
  // The giant hogweed: never the hybrid's photo nor name.
  assert.deepEqual({ photo: g['Heracleum mantegazzianum'].photo, common: g['Heracleum mantegazzianum'].common }, { photo: null, common: null });
  // The daisy: in the flora without a thumbnail — a leaf at first, then the photo its sheet shows, found online, with
  // its author and licence (iNaturalist's « (c) Jane Doe, … »).
  assert.equal(g['Bellis perennis'].photo, null);
  const more = /** @type {any[]} */ (await morePhotos(alone.points));
  assert.ok(more, 'a photo found: the points again');
  const daisy = by(more)['Bellis perennis'];
  assert.equal(daisy.photo, 'https://inaturalist-open-data.s3.amazonaws.com/photos/80/square.jpg');
  assert.deepEqual(daisy.credit, { author: 'Jane Doe', license: 'CC BY', source: 'iNaturalist', sourceUrl: 'https://www.inaturalist.org/taxa/80' });
  assert.equal(await morePhotos(more), null, 'nothing more to find: nothing to draw again');
  assert.equal(alone.points.find(p => p.sci === 'Bellis perennis')?.photo, null, 'the points given unchanged');

  // iNaturalist's observations too: every GBIF point the same photo, name and credit as with GBIF alone.
  const both = await observations3d(C, 2000, { inat: true, gbif: true });
  assert.equal(both.points.filter(p => p.kind === 'inat').length, 2);
  const g2 = by(both.points);
  for (const sci of Object.keys(g)) {
    const pick = (/** @type {any} */ p) => ({ photo: p.photo, common: p.common, credit: p.credit });
    assert.deepEqual(pick(g2[sci]), pick(sci === 'Bellis perennis' ? daisy : g[sci]), sci);
  }
  // And as iNaturalist's own observation of the same plant shows it.
  const inatNettle = both.points.find(p => p.kind === 'inat' && p.sci === 'Urtica dioica');
  assert.equal(inatNettle?.photo, g['Urtica dioica'].photo);
});
