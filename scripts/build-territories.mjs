// Builds data/territories.json: simplified outlines of metropolitan departments, each with its current
// region and its former (pre-2016) region — regional protection orders often still name former regions.
// Outlines: france-geojson (Grégoire David), derived from IGN ADMIN EXPRESS, Licence Ouverte (Etalab).
// Run once (or when outlines change): node scripts/build-territories.mjs

import { writeFile } from 'node:fs/promises';

const SOURCE = 'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements-version-simplifiee.geojson';
const TOLERANCE = 0.006; // degrees (~500 m): plenty to tell which department a harvest place is in

/** Former regions (INSEE, before 1 January 2016) and their departments. */
const FORMER = {
  'Alsace': ['67', '68'],
  'Aquitaine': ['24', '33', '40', '47', '64'],
  'Auvergne': ['03', '15', '43', '63'],
  'Basse-Normandie': ['14', '50', '61'],
  'Bourgogne': ['21', '58', '71', '89'],
  'Bretagne': ['22', '29', '35', '56'],
  'Centre': ['18', '28', '36', '37', '41', '45'],
  'Champagne-Ardenne': ['08', '10', '51', '52'],
  'Corse': ['2A', '2B'],
  'Franche-Comté': ['25', '39', '70', '90'],
  'Haute-Normandie': ['27', '76'],
  'Île-de-France': ['75', '77', '78', '91', '92', '93', '94', '95'],
  'Languedoc-Roussillon': ['11', '30', '34', '48', '66'],
  'Limousin': ['19', '23', '87'],
  'Lorraine': ['54', '55', '57', '88'],
  'Midi-Pyrénées': ['09', '12', '31', '32', '46', '65', '81', '82'],
  'Nord-Pas-de-Calais': ['59', '62'],
  'Pays de la Loire': ['44', '49', '53', '72', '85'],
  'Picardie': ['02', '60', '80'],
  'Poitou-Charentes': ['16', '17', '79', '86'],
  "Provence-Alpes-Côte d'Azur": ['04', '05', '06', '13', '83', '84'],
  'Rhône-Alpes': ['01', '07', '26', '38', '42', '69', '73', '74']
};

/** Current regions (since 2016), ISO 3166-2 code, and the former regions they merged. */
const REGIONS = [
  ['FR-ARA', 'Auvergne-Rhône-Alpes', ['Auvergne', 'Rhône-Alpes']],
  ['FR-BFC', 'Bourgogne-Franche-Comté', ['Bourgogne', 'Franche-Comté']],
  ['FR-BRE', 'Bretagne', ['Bretagne']],
  ['FR-CVL', 'Centre-Val de Loire', ['Centre']],
  ['FR-COR', 'Corse', ['Corse']],
  ['FR-GES', 'Grand Est', ['Alsace', 'Champagne-Ardenne', 'Lorraine']],
  ['FR-HDF', 'Hauts-de-France', ['Nord-Pas-de-Calais', 'Picardie']],
  ['FR-IDF', 'Île-de-France', ['Île-de-France']],
  ['FR-NOR', 'Normandie', ['Basse-Normandie', 'Haute-Normandie']],
  ['FR-NAQ', 'Nouvelle-Aquitaine', ['Aquitaine', 'Limousin', 'Poitou-Charentes']],
  ['FR-OCC', 'Occitanie', ['Languedoc-Roussillon', 'Midi-Pyrénées']],
  ['FR-PDL', 'Pays de la Loire', ['Pays de la Loire']],
  ['FR-PAC', "Provence-Alpes-Côte d'Azur", ["Provence-Alpes-Côte d'Azur"]]
];

/** Douglas–Peucker on one ring. @param {number[][]} points */
function simplify(points, tolerance) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = /** @type {[number, number]} */ (stack.pop());
    const [x1, y1] = points[a], [x2, y2] = points[b];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1e-12;
    let far = -1, max = 0;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * points[i][0] - dx * points[i][1] + x2 * y1 - y2 * x1) / len;
      if (d > max) { max = d; far = i; }
    }
    if (max > tolerance && far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

const r4 = n => Math.round(n * 1e3) / 1e3; // ~100 m
/** A closed ring (first point = last) is split at its farthest point, each half simplified. */
function simplifyRing(r) {
  const [x0, y0] = r[0];
  let k = 1, max = 0;
  r.forEach(([x, y], i) => { const d = Math.hypot(x - x0, y - y0); if (d > max) { max = d; k = i; } });
  return [...simplify(r.slice(0, k + 1), TOLERANCE).slice(0, -1), ...simplify(r.slice(k), TOLERANCE)];
}
const ring = (/** @type {number[][]} */ r) => simplifyRing(r).map(([x, y]) => [r4(x), r4(y)]);

async function main() {
  const source = await (await fetch(SOURCE)).json();
  const formerOf = new Map(Object.entries(FORMER).flatMap(([name, codes]) => codes.map(c => [c, name])));
  const regionOf = new Map(REGIONS.flatMap(([iso, name, formers]) => formers.map(f => [f, { iso, name }])));
  const departments = source.features.map(f => {
    const code = String(f.properties.code);
    const former = formerOf.get(code);
    if (!former) throw new Error('département sans ancienne région : ' + code);
    const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    return {
      code,
      name: f.properties.nom,
      region: regionOf.get(former).iso,
      former,
      // [[outer, hole…], …], small islets (< 4 points after simplification) dropped
      polygons: polygons.map(p => p.map(ring).filter(r => r.length >= 4)).filter(p => p.length)
    };
  }).sort((a, b) => a.code.localeCompare(b.code));
  const out = {
    source: 'france-geojson (G. David), d’après IGN ADMIN EXPRESS — Licence Ouverte (Etalab)',
    sourceUrl: SOURCE,
    regions: REGIONS.map(([iso, name, formers]) => ({ iso, name, formers })),
    departments
  };
  const json = JSON.stringify(out);
  await writeFile('data/territories.json', json + '\n', 'utf8');
  console.log(`${departments.length} départements, ${Math.round(json.length / 1024)} Ko`);
}

await main();
