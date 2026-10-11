// @ts-check
// The regions of France (as the IGN geocoder names them in an address's context), each with its bounding box —
// for a map to be framed on « Ma région ».

/** [west, south, east, north] of each region. @type {Record<string, [number, number, number, number]>} */
export const REGION_BOUNDS = {
  'Île-de-France': [1.44, 48.12, 3.56, 49.24],
  'Hauts-de-France': [1.38, 48.83, 4.26, 51.09],
  'Grand Est': [3.38, 47.42, 8.24, 50.17],
  'Normandie': [-1.95, 48.18, 1.81, 50.07],
  'Bretagne': [-5.14, 47.28, -1.01, 48.90],
  'Pays de la Loire': [-2.56, 46.27, 0.92, 48.57],
  'Centre-Val de Loire': [0.05, 46.35, 3.13, 48.94],
  'Bourgogne-Franche-Comté': [2.84, 46.15, 7.15, 48.40],
  'Nouvelle-Aquitaine': [-1.79, 42.77, 2.61, 47.18],
  'Auvergne-Rhône-Alpes': [2.06, 44.11, 7.19, 46.81],
  'Occitanie': [-0.33, 42.33, 4.85, 45.05],
  "Provence-Alpes-Côte d'Azur": [4.23, 42.98, 7.72, 45.13],
  'Corse': [8.53, 41.33, 9.56, 43.03],
  'Guadeloupe': [-61.81, 15.83, -61.0, 16.52],
  'Martinique': [-61.23, 14.39, -60.81, 14.88],
  'Guyane': [-54.61, 2.11, -51.61, 5.8],
  'La Réunion': [55.21, -21.39, 55.84, -20.87],
  'Mayotte': [44.95, -13.0, 45.3, -12.63]
};

/** The region named in an address's context (« 34, Hérault, Occitanie »), with its box, if known. @param {string} context */
export function regionOf(context) {
  const name = String(context || '').split(',').map(s => s.trim()).filter(Boolean).pop() || '';
  const key = Object.keys(REGION_BOUNDS).find(k => k.toLowerCase() === name.toLowerCase().replace(/’/g, "'"));
  return key ? { name: key, bounds: REGION_BOUNDS[key] } : null;
}
