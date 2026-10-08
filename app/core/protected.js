// @ts-check
// Espaces protégés in view: national parks (core area), national and regional nature reserves, biotope
// protection orders. Source: INPN / PatriNat layers on the IGN Géoplateforme WFS (free, no key). Only names
// and INPN links are fetched (no geometry): enough to say « you are looking at… » on a map.
// Cached in IndexedDB by rounded view, so a place already seen keeps its banner offline.

import * as db from './db.js';
import { ModuleOffError, moduleOn } from './modules.js';

const WFS = 'https://data.geopf.fr/wfs/ows';
/** Protected-area boundaries change rarely: a month. */
const TTL = 30 * 24 * 3600 * 1000;
/** Views are rounded outward to this grid (degrees), so nearby views share a cache entry. */
const GRID = 0.02;

/** @typedef {{ id: string, name: string, kind: string, url: string | null }} ProtectedArea */

/** Layers asked, in the banner's order (strongest rules first). */
export const PROTECTED_LAYERS = [
  { typeName: 'patrinat_pn:parc_national', kind: 'Parc national', extra: ',zone' },
  { typeName: 'patrinat_rnn:rnn', kind: 'Réserve naturelle nationale', extra: '' },
  { typeName: 'patrinat_rnr:rnr', kind: 'Réserve naturelle régionale', extra: '' },
  { typeName: 'patrinat_apb:apb', kind: 'Arrêté de protection de biotope', extra: '' }
];

const down = (/** @type {number} */ v) => (Math.floor(v / GRID) * GRID).toFixed(2);
const up = (/** @type {number} */ v) => (Math.ceil(v / GRID) * GRID).toFixed(2);

/**
 * Protected areas intersecting a view.
 * @param {{ south: number, west: number, north: number, east: number }} bounds
 * @param {AbortSignal} [signal]
 * @returns {Promise<ProtectedArea[]>}
 */
export async function protectedAreasIn(bounds, signal) {
  if (!moduleOn('ignProtected')) throw new ModuleOffError('ignProtected');
  const box = [down(bounds.south), down(bounds.west), up(bounds.north), up(bounds.east)];
  const key = 'protected:' + box.join(',');
  const hit = await db.get('plantDetails', key).catch(() => null);
  if (hit && Date.now() - hit.fetchedAt < TTL) return hit.value;
  try {
    const lists = await Promise.all(PROTECTED_LAYERS.map(async layer => {
      const params = new URLSearchParams({
        SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature', TYPENAMES: layer.typeName,
        BBOX: box.join(',') + ',urn:ogc:def:crs:EPSG::4326', OUTPUTFORMAT: 'application/json', COUNT: '20',
        PROPERTYNAME: 'nom_site,url_fiche,id_mnhn' + layer.extra
      });
      const response = await fetch(WFS + '?' + params, { signal });
      if (!response.ok) throw new Error('Géoplateforme WFS ' + response.status);
      const { features = [] } = await response.json();
      return features
        // A national park's « aire d'adhésion » is not a protected area in the strict sense: only its core.
        .filter((/** @type {any} */ f) => !/adh/i.test(f.properties?.zone || ''))
        .map((/** @type {any} */ f) => ({
          id: f.properties.id_mnhn || f.id,
          name: String(f.properties.nom_site || '').trim(),
          kind: layer.kind,
          url: f.properties.url_fiche || null
        }));
    }));
    const seen = new Set();
    const value = lists.flat().filter(a => a.name && !seen.has(a.id) && seen.add(a.id));
    await db.put('plantDetails', { key, fetchedAt: Date.now(), value }).catch(() => {});
    return value;
  } catch (error) {
    if (hit && !signal?.aborted) return hit.value;
    throw error;
  }
}
