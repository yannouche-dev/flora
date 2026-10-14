// app/core/around3d.js: the observations around a centre on the maps in 3D — what each map keeps (always valid, one
// record per map), the points kept in the circle only, the density's hexagons, the circle's wall in pieces, the zoom
// that frames a circle.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { config } = await import('../../app/config.js');
const {
  AROUND3D_DEFAULTS, RADII_3D, around3dPrefs, cleanAround3d, fitZoom, hexBins, inCircle, metres, radiusLabel, radiusWords, ringWall,
  setAround3dPrefs, wallHeight
} = await import('../../app/core/around3d.js');

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
