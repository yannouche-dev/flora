// @ts-check
// « Vue 3D »: a parcours (or a place of Mes plantes) on the relief, read-only, in a modal dialog over the app — its
// plants standing on the ground (their photo in a ring, as on gf-map; their altitude, the IGN's, kept with each), the
// walk from plant to plant, its start. MapLibre GL JS (vendor/maplibre, ~1.6 MB) is fetched only when the view opens
// (import(), never at startup; not precached: sw.js ON_DEMAND keeps it once asked). Leaflet (gf-map.js) stays the map
// of everything else.
//   openMap3d(place, opener) → null when the view opened, else why not (« 3D indisponible sur cet appareil »…),
//   for the button to say. One view at a time (one element, in the body); its map is removed when it closes.
// The relief: AWS Terrain Tiles (Terrarium PNG, keyless, EU-DEM over France ≈ 25-30 m), module « Vue 3D (relief) ».
// Offline, or once its tiles fail, the view stays flat (tilted, without relief) and says so. The ground: IGN aerial
// photos (module « IGN – fonds de carte »), else, or when they fail, the relief's shading.

import { LitElement, html, nothing } from 'lit';
import { moduleOn } from '../core/modules.js';
import { cachedThumb, photoOf, thumbUrl } from '../core/thumb.js';
import { altitudeOf, formatAltitude } from '../core/altitude.js';
import { entryPosition } from '../core/collections.js';
import { boundsOf, fitPadding, walkOf } from '../core/walk.js';
import { openModal } from '../core/history.js';
import { icon, iconMarkup } from '../core/icons.js';
import { ATTRIBUTION as IGN_ATTRIBUTION } from '../core/ign.js';
import { PIN_COLORS } from './gf-map.js';

/** MapLibre, vendored: its address as a value (not a literal import), so the type checker never reads 1 MB of it. */
const MAPLIBRE = new URL('../../vendor/maplibre/maplibre-gl.mjs', import.meta.url).href;
const MAPLIBRE_CSS = new URL('../../vendor/maplibre/maplibre-gl.css', import.meta.url).href;

/** IGN Géoplateforme WMTS, Web Mercator (as core/ign.js asks it), aerial photos. */
const IGN_PHOTOS = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&TILEMATRIXSET=PM'
  + '&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}';
/**
 * AWS Terrain Tiles (Mapzen), Terrarium encoding, 256 px, keyless, CORS. Over France every zoom is EU-DEM (25 m):
 * z12 (≈ 27 m a pixel at 46° N) already holds it all — past it, the same data resampled, 4 to 64 times the tiles.
 */
const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const DEM_MAX = 12;
const DEM_ATTRIBUTION = 'Relief : <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain Tiles</a> (Mapzen · EU-DEM © Copernicus)';
/** This many relief tiles failed (offline, the host out of reach): the view goes on flat. */
const DEM_GIVE_UP = 3;
const IGN_GIVE_UP = 3;
const EXAGGERATION = 1.3;
const PITCH = 60;

/** MapLibre's own words, in French. */
const LOCALE = {
  'AttributionControl.ToggleAttribution': 'Afficher ou masquer les crédits',
  'Map.Title': 'Carte en 3D',
  'Marker.Title': 'Repère',
  'NavigationControl.ResetBearing': 'Glisser pour tourner la carte, toucher pour revenir au nord',
  'NavigationControl.ZoomIn': 'Zoomer',
  'NavigationControl.ZoomOut': 'Dézoomer',
  'Popup.Close': 'Fermer',
  'TerrainControl.Enable': 'Afficher le relief',
  'TerrainControl.Disable': 'Masquer le relief',
  'CooperativeGesturesHandler.WindowsHelpText': 'Ctrl + molette pour zoomer',
  'CooperativeGesturesHandler.MacHelpText': '⌘ + molette pour zoomer',
  'CooperativeGesturesHandler.MobileHelpText': 'Deux doigts pour déplacer la carte'
};

const SKY = {
  'sky-color': '#79aee0', 'horizon-color': '#dbe9f4', 'fog-color': '#e6edf1',
  'sky-horizon-blend': 0.55, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.35, 'atmosphere-blend': 0.6
};

export const UNAVAILABLE = '3D indisponible sur cet appareil (WebGL2 requis).';
const MODULE_OFF = 'Vue 3D désactivée : module « Vue 3D (relief) » dans Réglages › Modules.';
const NOT_DOWNLOADED = '3D indisponible hors ligne : la vue 3D se télécharge à sa première ouverture, en ligne.';

/** @type {boolean | null} */
let webgl2 = null;
/** WebGL2 (MapLibre 6 needs it), asked once; the context of the test given back at once. */
function hasWebGL2() {
  if (webgl2 == null) {
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      webgl2 = Boolean(gl);
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch { webgl2 = false; }
  }
  return webgl2;
}

/** Why the 3D view cannot open here (the module off, no WebGL2), or null. */
export function map3dProblem() {
  if (!moduleOn('relief3d')) return MODULE_OFF;
  if (!hasWebGL2()) return UNAVAILABLE;
  return null;
}

/** @type {Promise<void> | null} */
let cssLoaded = null;
/** MapLibre's stylesheet, in the document (the view lives in the body), once: waited for, never blocking on failure. */
function loadCss() {
  cssLoaded ||= new Promise(resolve => {
    const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: MAPLIBRE_CSS });
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => resolve(), { once: true });
    document.head.append(link);
  });
  return cssLoaded;
}

/**
 * Opens the 3D view of a place (a parcours: its walk too). Resolves once the view is up (null), or with why it could
 * not open — then nothing stays open. `opener` gets the focus back when the view closes.
 * @param {any} place @param {HTMLElement | null} [opener]
 * @returns {Promise<string | null>}
 */
export async function openMap3d(place, opener = null) {
  const problem = map3dProblem();
  if (problem) return problem;
  let view = /** @type {GfMap3d | null} */ (document.querySelector('gf-map3d'));
  if (!view) {
    view = /** @type {GfMap3d} */ (document.createElement('gf-map3d'));
    document.body.append(view);
  }
  return view.show(place, opener);
}

/** An element, its text set as text (names come from the flora or the user). @param {string} tag @param {string} [className] @param {string} [text] */
function elem(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** The leaf a plant shows until its photo has loaded (and for good without one). */
function leaf() {
  const glyph = elem('span', 'glyph');
  // eslint-disable-next-line no-unsanitized/property -- the markup of a bundled icon, no data in it
  glyph.innerHTML = iconMarkup('leaf-fill');
  return glyph;
}

/** A photo over the leaf, shown once loaded, gone if it fails. @param {HTMLElement} ring @param {string | null} src */
function addPhoto(ring, src) {
  if (!src || ring.querySelector('img')) return;
  const img = Object.assign(document.createElement('img'), { alt: '', decoding: 'async', referrerPolicy: 'no-referrer' });
  img.addEventListener('error', () => img.remove(), { once: true });
  img.addEventListener('load', () => ring.classList.add('photo'), { once: true });
  img.src = src;
  ring.append(img);
}

export class GfMap3d extends LitElement {
  static properties = {
    _name: { state: true },
    _view: { state: true },
    _note: { state: true },
    _state: { state: true },
    /** The relief is on (online, its tiles answering). */
    _terrain: { state: true }
  };

  constructor() {
    super();
    this._name = '';
    /** @type {'2d' | '3d'} */
    this._view = '3d';
    this._note = '';
    /** @type {'idle' | 'loading' | 'ready' | 'error'} */
    this._state = 'idle';
    this._terrain = false;
  }

  /** Light DOM: MapLibre's stylesheet and map.css (the document's) reach the map. */
  createRenderRoot() { return this; }

  /** @type {any} the MapLibre map, while the view is open */
  #map = null;
  /** @type {HTMLElement | null} */
  #opener = null;
  #demErrors = 0;
  #ignErrors = 0;
  /** Bumped at each open and close: a slow import or load that finishes after them does nothing. */
  #run = 0;

  get #dialog() { return /** @type {HTMLDialogElement} */ (this.querySelector('dialog')); }
  get #canvas() { return /** @type {HTMLElement} */ (this.querySelector('.gf3d-canvas')); }

  render() {
    return html`<dialog class="gf-map3d" aria-labelledby="gf3d-title" data-state=${this._state} data-view=${this._view} data-terrain=${this._terrain ? 'on' : 'off'}
        @close=${() => this.#closed()}>
      <header class="gf3d-head">
        <h2 id="gf3d-title"><span class="gf3d-kicker">Vue 3D</span> ${this._name}</h2>
        <div class="gf3d-seg" role="group" aria-label="Vue">
          <button type="button" aria-pressed=${String(this._view === '2d')} ?disabled=${this._state !== 'ready'} @click=${() => this.#set3d(false)}>2D</button>
          <button type="button" aria-pressed=${String(this._view === '3d')} ?disabled=${this._state !== 'ready'} @click=${() => this.#set3d(true)}>3D</button>
        </div>
        <button type="button" class="gf3d-close" autofocus aria-label="Fermer la vue 3D" @click=${() => this.#dialog.close()}>${icon('x-lg')}</button>
      </header>
      <div class="gf3d-canvas"></div>
      ${this._state === 'loading' ? html`<p class="gf3d-loading">Chargement de la vue 3D…</p>` : nothing}
      <p class="gf3d-note" role="status">${this._note}</p>
    </dialog>`;
  }

  /**
   * @param {any} place @param {HTMLElement | null} opener
   * @returns {Promise<string | null>}
   */
  async show(place, opener) {
    // One map at a time: the one open goes first.
    this.#destroy();
    const run = ++this.#run;
    this.#opener = opener;
    this._name = place.properties?.name || '';
    this._note = '';
    this._view = '3d';
    this._state = 'loading';
    await this.updateComplete;
    openModal(this.#dialog);
    try {
      // eslint-disable-next-line no-unsanitized/method -- a constant: the app's own vendored file
      const [ml] = await Promise.all([import(MAPLIBRE), loadCss()]);
      if (run !== this.#run) return null;
      this.#create(ml, place);
      return null;
    } catch (error) {
      if (run !== this.#run) return null;
      console.warn('Vue 3D :', error);
      const why = navigator.onLine ? UNAVAILABLE : NOT_DOWNLOADED;
      this._state = 'error';
      this.#destroy();
      this.#dialog.close();
      return why;
    }
  }

  /** @param {any} ml MapLibre @param {any} place */
  #create(ml, place) {
    const { line, start } = walkOf(place);
    /** @type {{ entry: any, at: [number, number] }[]} */
    const plants = place.properties.plants.map((/** @type {any} */ e) => ({ entry: e, at: entryPosition(place, e) })).filter((/** @type {any} */ p) => p.at);
    const points = [...plants.map(p => p.at), ...(start ? [start] : []), ...(place.geometry ? [place.geometry.coordinates] : [])];
    const bounds = boundsOf(points);
    if (!bounds) throw new Error('nothing to show');

    const photos = moduleOn('ignMaps');
    const offline = !navigator.onLine;
    this._terrain = !offline;
    this.#demErrors = 0;
    this.#ignErrors = 0;
    if (offline) this._note = 'Hors ligne : pas de relief, vue à plat.';

    /** @type {Record<string, any>} */
    const sources = {
      walk: { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line.length >= 2 ? line : [] } } }
    };
    if (photos) sources.ign = { type: 'raster', tiles: [IGN_PHOTOS], tileSize: 256, maxzoom: 19, attribution: IGN_ATTRIBUTION };
    if (this._terrain) {
      // Two sources of the same tiles: MapLibre wants one for the ground's shape, another for its shading.
      sources.dem = { type: 'raster-dem', tiles: [DEM], encoding: 'terrarium', tileSize: 256, maxzoom: DEM_MAX, attribution: DEM_ATTRIBUTION };
      sources.shade = { type: 'raster-dem', tiles: [DEM], encoding: 'terrarium', tileSize: 256, maxzoom: DEM_MAX, attribution: DEM_ATTRIBUTION };
    }
    const layers = [
      { id: 'ground', type: 'background', paint: { 'background-color': '#dfe6d8' } },
      ...(photos ? [{ id: 'photo', type: 'raster', source: 'ign', paint: { 'raster-fade-duration': 150 } }] : []),
      // The shading: the ground without photos (the module off, or IGN out of reach).
      ...(this._terrain ? [{ id: 'shade', type: 'hillshade', source: 'shade', layout: { visibility: photos ? 'none' : 'visible' },
        paint: { 'hillshade-exaggeration': 0.5, 'hillshade-shadow-color': '#24352a' } }] : []),
      { id: 'walk-casing', type: 'line', source: 'walk', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.9 } },
      { id: 'walk', type: 'line', source: 'walk', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#e0245e', 'line-width': 3.5 } }
    ];

    const box = this.#canvas.getBoundingClientRect();
    let map;
    try {
      map = new ml.Map({
        container: this.#canvas,
        style: { version: 8, sources, layers },
        bounds,
        fitBoundsOptions: { padding: fitPadding(box.width, box.height), maxZoom: 17 },
        maxPitch: 75,
        locale: LOCALE,
        pixelRatio: Math.min(devicePixelRatio || 1, 2),
        attributionControl: { compact: true }
      });
    } catch (error) {
      // No WebGL context after all (the GPU blocked, too many contexts): the button says so.
      webgl2 = false;
      throw error;
    }
    this.#map = map;
    map.addControl(new ml.NavigationControl({ visualizePitch: true }), 'bottom-right');

    map.on('error', (/** @type {any} */ e) => this.#tileError(e));
    // The GPU took its context back (memory, the tab in the background): this map is gone, the view says so.
    map.on('webglcontextlost', () => {
      this._note = 'L’affichage 3D s’est interrompu (mémoire graphique). Fermez la vue et rouvrez-la.';
      this._state = 'error';
    });
    map.on('moveend', () => this.#dialog?.setAttribute('data-pitch', String(Math.round(map.getPitch()))));

    const markers = this.#markers(ml, map, plants, start, place);
    // A marker is placed on the ground as known when the camera last moved: the relief's finer tiles, come since,
    // move the ground under it. Placed again once they are in (a handful of markers: cheap).
    let queued = false;
    const replace = () => { queued = false; for (const m of markers) m.setLngLat(m.getLngLat()); };
    map.on('sourcedata', (/** @type {any} */ e) => {
      if (e.sourceId === 'dem' && e.tile && map.getTerrain() && !queued) { queued = true; requestAnimationFrame(replace); }
    });

    // Tilted at once, the relief under it (eased from above; no easing when the motion is reduced).
    // Ready (its buttons on) once the style is in and a first frame drawn — not when every tile has come ('load'):
    // tilted, the horizon asks for many, and offline some never come.
    const tilt = () => {
      if (this.#map !== map) return;
      if (this._view === '3d') this.#set3d(true, true);
      map.once('render', () => { if (this.#map === map && this._state === 'loading') this._state = 'ready'; });
      map.triggerRepaint();
    };
    if (map.isStyleLoaded()) tilt(); else map.once('style.load', tilt);
  }

  /** A tile failed. @param {any} e */
  #tileError(e) {
    const map = this.#map;
    if (!map) return;
    const source = e?.sourceId || e?.source?.id || '';
    // A failed tile asks for no new frame: when the last ones of a view all fail (offline, the host out of reach),
    // MapLibre would never draw again — no 'load', the view stuck. One more frame settles it.
    map.triggerRepaint();
    if ((source === 'dem' || source === 'shade') && ++this.#demErrors === DEM_GIVE_UP && this._terrain) {
      this._terrain = false;
      map.setTerrain(null);
      if (map.getLayer('shade')) map.setLayoutProperty('shade', 'visibility', 'none');
      this._note = 'Relief injoignable : vue à plat.';
    } else if (source === 'ign' && ++this.#ignErrors === IGN_GIVE_UP) {
      if (this._terrain && map.getLayer('shade')) map.setLayoutProperty('shade', 'visibility', 'visible');
      this._note = this._terrain ? 'Photos aériennes IGN injoignables : le relief seul.' : 'Photos aériennes IGN injoignables.';
    }
  }

  /**
   * Each plant standing on the ground (its photo in a ring of its abundance colour, a leaf without; its altitude),
   * a card on a touch; the start of the walk.
   * @param {any} ml @param {any} map @param {{ entry: any, at: [number, number] }[]} plants @param {[number, number] | null} start @param {any} place
   * @returns {any[]} the markers
   */
  #markers(ml, map, plants, start, place) {
    const markers = [];
    for (const { entry, at } of plants) {
      const name = entry.vernacularName || entry.scientificName || 'Plante';
      const m = altitudeOf(entry, entry.coordinates) ?? (entry.coordinates ? null : altitudeOf(place.properties, place.geometry?.coordinates));
      const el = elem('div', 'gf3d-pin');
      el.setAttribute('aria-label', m == null ? name : `${name}, ${formatAltitude(m)}`);
      const ring = elem('span', 'ring');
      ring.style.setProperty('--c', PIN_COLORS[/** @type {keyof typeof PIN_COLORS} */ (entry.abundance)] || PIN_COLORS.moyen);
      ring.append(leaf());
      // « Photos en ligne » off: the leaf only (photoOf, thumbUrl ask the module).
      if (entry.plantId) {
        const known = photoOf(cachedThumb(entry.plantId));
        if (known) addPhoto(ring, known);
        else thumbUrl(entry.plantId).then(url => addPhoto(ring, photoOf(url))).catch(() => {});
      }
      el.append(ring);
      if (m != null) el.append(elem('span', 'alt', formatAltitude(m)));
      el.append(elem('span', 'stem'));

      const card = elem('div', 'gf3d-card');
      card.append(elem('b', '', name));
      if (entry.scientificName && entry.scientificName !== name) card.append(elem('i', '', entry.scientificName));
      card.append(elem('small', '', m == null ? 'Altitude inconnue' : `Altitude : ${formatAltitude(m)} (IGN)`));
      const popup = new ml.Popup({ offset: 76, maxWidth: '260px' }).setDOMContent(card);
      markers.push(new ml.Marker({ element: el, anchor: 'bottom', opacityWhenCovered: '0.35' }).setLngLat(at).setPopup(popup).addTo(map));
    }
    if (start) {
      const m = altitudeOf(place.properties, start);
      const chip = elem('div', 'gf3d-start', m == null ? 'Départ' : `Départ · ${formatAltitude(m)}`);
      markers.push(new ml.Marker({ element: chip, anchor: 'top', offset: [0, 6], opacityWhenCovered: '0.35' }).setLngLat(start).addTo(map));
    }
    return markers;
  }

  /**
   * 3D: tilted, the relief under it (online, its tiles answering), the sky; 2D: from above, flat. Eased, unless the
   * motion is reduced.
   * @param {boolean} on @param {boolean} [first] the view just opened (its fitted camera tilted)
   */
  #set3d(on, first = false) {
    const map = this.#map;
    if (!map) return;
    this._view = on ? '3d' : '2d';
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1200;
    if (on) {
      if (this._terrain) {
        map.setTerrain({ source: 'dem', exaggeration: EXAGGERATION });
        map.setSky(SKY);
      }
      // A tilted view shows less of the walk at the same zoom: a little further.
      map.easeTo({ pitch: PITCH, bearing: first ? -15 : map.getBearing(), zoom: map.getZoom() - (first ? 0.5 : 0), duration, essential: true });
    } else {
      map.easeTo({ pitch: 0, bearing: 0, duration, essential: true });
      // Flat first, then the relief goes (removing it mid-tilt makes the ground jump).
      const drop = () => { if (this.#map === map && this._view === '2d') { map.setTerrain(null); map.setSky({ 'atmosphere-blend': 0 }); } };
      if (duration) map.once('moveend', drop); else drop();
    }
  }

  /** The dialog closed (✕, Échap, Back): the map goes, the focus back where it was. */
  #closed() {
    this.#run++;
    this.#destroy();
    if (this._state !== 'error') this._state = 'idle';
    const opener = this.#opener;
    this.#opener = null;
    if (opener?.isConnected) opener.focus();
  }

  #destroy() {
    const map = this.#map;
    this.#map = null;
    if (!map) return;
    try { map.remove(); } catch { /* its context already lost */ }
    this.#canvas?.replaceChildren();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#destroy();
  }
}

customElements.define('gf-map3d', GfMap3d);
