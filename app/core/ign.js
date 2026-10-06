// @ts-check
// IGN Géoplateforme WMTS layers (free, no API key) as Leaflet tile layers.

import * as L from 'leaflet';

const WMTS = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&TILEMATRIXSET=PM'
  + '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&STYLE=normal';

export const ATTRIBUTION = '© <a href="https://geoservices.ign.fr/" target="_blank" rel="noopener">IGN – Géoplateforme</a>';

/** Base layers (one at a time) and overlays (toggled on top). */
export const LAYERS = {
  photo: { label: 'Photos aériennes', layer: 'ORTHOIMAGERY.ORTHOPHOTOS', format: 'image/jpeg', base: true },
  plan: { label: 'Plan IGN', layer: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', format: 'image/png', base: true },
  cadastre: { label: 'Parcelles cadastrales', layer: 'CADASTRALPARCELS.PARCELLAIRE_EXPRESS', format: 'image/png', base: false }
};

/** @param {keyof typeof LAYERS} key */
export function tileLayer(key) {
  const def = LAYERS[key];
  return L.tileLayer(`${WMTS}&LAYER=${def.layer}&FORMAT=${encodeURIComponent(def.format)}`, {
    attribution: ATTRIBUTION,
    maxNativeZoom: 19,
    maxZoom: 21,
    minZoom: 5,
    // CORS requests give the service worker readable responses (opaque ones cost ~7 MB of quota each).
    crossOrigin: 'anonymous',
    opacity: def.base ? 1 : 0.85,
    className: 'gf-tiles-' + key
  });
}

/** Metropolitan France, for the initial view when there is nothing else to show. */
export const FRANCE_BOUNDS = L.latLngBounds([41.3, -5.2], [51.1, 9.6]);
