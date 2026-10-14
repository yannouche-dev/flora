// app/core/around3d.js: the observations around a centre on the maps in 3D — what each map keeps (always valid, one
// record per map), a GBIF occurrence shown as an iNaturalist observation (the same plant's photo and name, its
// source; core/nearby.js floraPhotos: the flora's, from an IndexedDB in memory), the points kept in the circle only,
// the density's hexagons, the circle's wall in pieces, the zoom that frames a circle.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { config } = await import('../../app/config.js');
const {
  AROUND3D_DEFAULTS, RADII_3D, around3dPrefs, cleanAround3d, fitZoom, gbifSource, hexBins, inCircle, metres, radiusLabel, radiusWords, ringWall,
  setAround3dPrefs, sharePhotos, wallHeight
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
  // No twin, or a photo of its own: as it was (the same object).
  assert.equal(c, gbif[2]);
  assert.equal(d, gbif[3]);
  assert.equal(JSON.stringify(gbif), before, 'the points given unchanged (a cache holds them)');
  assert.deepEqual(sharePhotos(gbif, []), gbif);
});

test('GBIF comme iNaturalist : la photo et le nom de la flore pour une plante sans observation iNaturalist ; une plante inconnue reste une feuille', async () => {
  await db.replacePlants([
    { id: 1, scientificName: 'Hedera helix', synonyms: [], family: 'Araliaceae', genus: 'Hedera', vernacularNames: ['Lierre grimpant'],
      thumbnail: { url: 'https://upload.wikimedia.org/hedera.jpg', author: 'Jane', license: 'CC BY-SA 4.0', source: 'Wikimedia Commons' } },
    { id: 2, scientificName: 'Bellis perennis', synonyms: [], family: 'Asteraceae', genus: 'Bellis', vernacularNames: ['Pâquerette'] }
  ], { version: 'test' });
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
