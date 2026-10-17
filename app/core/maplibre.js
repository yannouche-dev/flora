// @ts-check
// MapLibre GL JS (vendor/maplibre, ~1.6 MB with its worker), for the maps shown in 3D (app/components/gf-map-gl.js):
// fetched only the first time a map is shown in 3D (import(), never at startup; sw.js keeps it once asked:
// ON_DEMAND). Here: loading it once, whether this device can draw it (WebGL2), its words in French, and the
// gfcache:// protocol — IGN tiles read from the device's cache only, never the network (module « IGN – fonds de
// carte » off).

import { CACHE_PROTOCOL } from './gl-style.js';

/** Its address as a value (not a literal import), so the type checker never reads 1 MB of it. */
const MAPLIBRE = new URL('../../vendor/maplibre/maplibre-gl.mjs', import.meta.url).href;
export const MAPLIBRE_CSS = new URL('../../vendor/maplibre/maplibre-gl.css', import.meta.url).href;
/** The 3D maps' own rules (markers as MapLibre places them, the 3D buttons and notes). */
export const MAP_GL_CSS = new URL('../styles/map-gl.css', import.meta.url).href;

/** MapLibre's own words, in French (its buttons, its canvas). */
export const LOCALE = {
  'AttributionControl.ToggleAttribution': 'Afficher ou masquer les crédits',
  'Map.Title': 'Carte en 3D — flèches : se déplacer ; Maj + flèches : tourner et incliner ; + et − : zoomer',
  'Marker.Title': 'Repère',
  'NavigationControl.ResetBearing': 'Revenir au nord (glisser pour tourner et incliner)',
  'NavigationControl.ZoomIn': 'Zoomer',
  'NavigationControl.ZoomOut': 'Dézoomer',
  'FullscreenControl.Enter': 'Plein écran',
  'FullscreenControl.Exit': 'Quitter le plein écran',
  'GeolocateControl.FindMyLocation': 'Me localiser',
  'GeolocateControl.LocationNotAvailable': 'Position indisponible',
  'GlobeControl.Enable': 'Afficher le globe',
  'GlobeControl.Disable': 'Afficher la carte à plat',
  'ScaleControl.Meters': 'm',
  'ScaleControl.Kilometers': 'km',
  'Popup.Close': 'Fermer',
  'TerrainControl.Enable': 'Afficher le relief',
  'TerrainControl.Disable': 'Masquer le relief',
  'CooperativeGesturesHandler.WindowsHelpText': 'Ctrl + molette pour zoomer',
  'CooperativeGesturesHandler.MacHelpText': '⌘ + molette pour zoomer',
  'CooperativeGesturesHandler.MobileHelpText': 'Deux doigts pour déplacer la carte'
};

/** @type {boolean | null} */
let webgl2 = null;
/** WebGL2 (MapLibre 6 needs it), asked once; the test's context given back at once. */
export function hasWebGL2() {
  if (webgl2 == null) {
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      webgl2 = Boolean(gl);
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch { webgl2 = false; }
  }
  return webgl2;
}
/** A map could not get its context after all (the GPU refused): no more tries this session. */
export function noWebGL2() { webgl2 = false; }

/** A 1×1 transparent PNG: a tile never seen, while the network is not to be used. */
const BLANK = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), c => c.charCodeAt(0));

/** @type {Promise<any> | null} */
let loading = null;

/**
 * MapLibre, loaded once (null when it cannot be: offline before its first download, the file missing).
 * @returns {Promise<any>}
 */
export function loadMapLibre() {
  // eslint-disable-next-line no-unsanitized/method -- a constant: the app's own vendored file
  loading ||= import(MAPLIBRE).then(ml => {
    // IGN tiles from the cache only: what the 2D map's cached layer does (core/ign.js), for MapLibre.
    ml.addProtocol(CACHE_PROTOCOL, async (/** @type {{ url: string }} */ params) => {
      const url = params.url.slice(CACHE_PROTOCOL.length + 3);
      try {
        const hit = typeof caches === 'undefined' ? undefined : await caches.match(url);
        if (hit) return { data: await hit.arrayBuffer() };
      } catch { /* not readable */ }
      return { data: BLANK.buffer.slice(0) };
    });
    return ml;
  }, error => { loading = null; throw error; });
  return loading;
}

/** A stylesheet in a root (the document's head, or a shadow root a map lives in), once per root. @param {Node} root @param {string} href */
export function linkCss(root, href) {
  const parent = /** @type {ParentNode} */ (root instanceof Document ? root.head : root);
  if ([...parent.querySelectorAll('link[rel=stylesheet]')].some(l => /** @type {HTMLLinkElement} */ (l).href === href)) return Promise.resolve();
  return new Promise(resolve => {
    const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href });
    link.addEventListener('load', () => resolve(undefined), { once: true });
    link.addEventListener('error', () => resolve(undefined), { once: true });
    parent.append(link);
  });
}
