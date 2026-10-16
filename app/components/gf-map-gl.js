// @ts-check
// gf-map in 3D: MapLibre GL draws the map, the 2D map (Leaflet) stays under it, hidden — the « mirror » that keeps the
// view and runs all of gf-map's logic as in 2D (framing, groups, plants by zoom, protected areas, the remembered view,
// zoom() and center(), flyTo…). Pages never know: gf-map's properties, events and methods are the same.
//   attachGl(host, leaflet) → the adapter of one gf-map (made in gf-map's firstUpdated); gf-map tells it of its
//   changes (changed(props)), and when it leaves or comes back (disconnect(), connect()).
// What is mirrored, from the Leaflet map to MapLibre, as it changes:
//  - the tile layers (backgrounds, overlays, the catalogue's layers, GBIF's): raster sources in the same order
//    (core/gl-style.js); Leaflet's own stop loading (their _update set aside) while the 3D map shows;
//  - the markers (places, plants, observations, groups, the point picked, my position…): their very elements, moved
//    into MapLibre markers — each effect of map.css applies, and gf-map's code (its cards, the « kin » it lights) finds
//    them where they are; a click, a hover or Enter on one is handed to its Leaflet marker;
//  - the small circles (points): discs; the lines and areas (the circle « Autour », an outline, a group's threads, my
//    position's accuracy): one GeoJSON source, draped on the relief;
//  - the camera: the 3D map follows the mirror's moves (gf-map's flights, frames, « me localiser »), and gives it its
//    own (pan, zoom) once they end. Tilt and rotation are the 3D map's alone. MapLibre's zoom is Leaflet's minus one.
// When the map shows in 3D: the maps' one choice « 3D » (core/map-settings.js), made in Réglages › Cartes or in the
// panel « Carte » of any map (« Affichage », gf-map-panel.js: the panel is told how this map is drawn, and why it
// cannot change when it cannot). Never for a map marked map-3d="off" (or under one; map-3d-why: why, said in its
// panel), nor in the « Jusqu’où part l’expédition ? » step (ma-distance: a fixed view from above). Back to 2D while
// its positions are being edited (markers dragged), without WebGL2, when MapLibre cannot load (offline before its
// first download), when too many maps are in 3D at once (one WebGL context each), or when the GPU takes its context
// back. Why, and why it is flat (offline, the relief unreachable), is the map's state (gf-map setStatus, the quiet-map
// rule): a line of the panel's « État », said once by the map's live region — never a note over the map; its loading,
// the map's thin line past 400 ms.
// The observations around a place (gf-map-obs3d.js): every 3D map has them at will — iNaturalist's, GBIF's and the
// user's plants in a circle on the relief, its wall, its radius; their sources and layers in this map's style.
// Modules: « Vue 3D (relief) » off → no relief asked (flat 3D); « IGN – fonds de carte » off → IGN tiles from the
// cache only, no vector plan nor buildings; offline → flat, from the cache. Photos: the markers' own (gf-map asks the
// « Photos en ligne » module).

import * as L from 'leaflet';
import { MAX_PITCH, lightMoment, mapSettings, mapSettingsEvents, sunPosition } from '../core/map-settings.js';
import { moduleEvents, moduleOn } from '../core/modules.js';
import { DEM_ATTRIBUTION, IGN_VECTOR_STYLE, buildStyle, circlePolygon, describeTileLayer, mergeVectorStyle, pathStyle } from '../core/gl-style.js';
import { LOCALE, MAPLIBRE_CSS, MAP_GL_CSS, hasWebGL2, linkCss, loadMapLibre, noWebGL2 } from '../core/maplibre.js';
import { Obs3dLayer } from './gf-map-obs3d.js';

/** WebGL maps at once (each holds a context; browsers allow some 16, phones fewer, and each costs memory). */
export const MAX_GL = 3;
/** Every adapter, and those drawing in 3D now. @type {Set<GlView>} */
const views = new Set();
/** @type {Set<GlView>} */
const live = new Set();

/** Why the map is in 2D though 3D is chosen, or flat: the map's state (its panel's « État »). */
const NOTES = {
  editing: 'Modification des positions : carte en 2D le temps de l’édition.',
  webgl: '3D indisponible sur cet appareil (WebGL2 requis) : carte en 2D.',
  load: '3D indisponible pour l’instant (MapLibre n’a pas pu être chargé) : carte en 2D.',
  loadOffline: '3D indisponible hors ligne tant qu’elle n’a jamais été ouverte en ligne : carte en 2D.',
  many: 'Trop de cartes en 3D à la fois : celle-ci reste en 2D.',
  lost: 'L’affichage 3D s’est interrompu (mémoire graphique) : carte en 2D.',
  offline: 'Hors ligne : relief, bâtiments et plan vectoriel indisponibles, vue à plat.',
  dem: 'Relief injoignable : vue à plat.'
};
/** Said once the 3D takes more than a moment to come (the map's thin loading line meanwhile). */
const LOADING = 'Chargement de la 3D';

/**
 * The page's markers over the observations around (gf-map-obs3d.js: theirs up to some 100 000 + the screen's height):
 * a plant matched, the plant chosen's photos never under its stacks, however the view turns.
 */
const MARK_Z = 200000;

/** The relief's tiles that may fail before the map goes on flat. */
const DEM_GIVE_UP = 3;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The IGN's vector style, asked once a session (null: not reachable). @type {Promise<ReturnType<typeof mergeVectorStyle>> | null} */
let vectorStyle = null;
function ignVectorStyle() {
  vectorStyle ||= fetch(IGN_VECTOR_STYLE, { credentials: 'omit' })
    .then(r => r.ok ? r.json() : null)
    .then(mergeVectorStyle, () => null)
    .then(v => { if (!v) vectorStyle = null; return v; });
  return vectorStyle;
}

/** Why a map is always seen from above, said in its panel. */
const FROM_ABOVE = 'Cette étape montre la distance vue de dessus : la carte reste en 2D (le choix vaut pour les autres cartes).';

/**
 * Why this map may never be shown in 3D, or '' when it may: marked map-3d="off" (or under such an element: its
 * map-3d-why says why), or in the « Jusqu’où part l’expédition ? » step of the mini-apps (a fixed top-down view, by
 * the user's wish).
 * @param {Element} host
 */
export function why2d(host) {
  /** @type {Node | null} */ let n = host;
  while (n) {
    if (n instanceof Element && n.localName === 'ma-distance') return FROM_ABOVE;
    if (n instanceof Element && n.getAttribute('map-3d') === 'off') return n.getAttribute('map-3d-why') || 'Cette carte reste en 2D (le choix vaut pour les autres cartes).';
    n = n.parentNode || (n instanceof ShadowRoot ? n.host : null);
  }
  return '';
}

/** @param {HTMLElement} host @param {L.Map} leaflet */
export function attachGl(host, leaflet) { return new GlView(host, leaflet); }

/**
 * The wheel pressed and dragged orbits, as in every 3D tool (Google Earth, Blender, Cesium…): sideways turns around the
 * middle of the map, up and down tilts — MapLibre only does it with the right button (or Ctrl), the wheel's press
 * would else start the browser's auto-scroll. Same speeds as MapLibre's right-drag; the tilt within the map's limits.
 * @param {any} map a MapLibre map
 */
export function orbitWithMiddleButton(map) {
  const box = map.getCanvasContainer();
  /** @type {{ x: number, y: number } | null} */
  let last = null;
  const move = (/** @type {MouseEvent} */ e) => {
    if (!last) return;
    const dx = e.clientX - last.x, dy = e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };
    map.jumpTo({ bearing: map.getBearing() - dx * 0.8, pitch: Math.min(map.getMaxPitch(), Math.max(map.getMinPitch(), map.getPitch() + dy * 0.5)) });
  };
  const up = (/** @type {MouseEvent} */ e) => {
    if (e.button !== 1 || !last) return;
    last = null;
    box.style.cursor = '';
    removeEventListener('mousemove', move);
    removeEventListener('mouseup', up);
  };
  // Caught on its way down: a marker under the pointer (which keeps its presses from the map) orbits too.
  box.addEventListener('mousedown', (/** @type {MouseEvent} */ e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    last = { x: e.clientX, y: e.clientY };
    box.style.cursor = 'move';
    map.stop();
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  }, true);
  // No auto-scroll, no link opened in a new tab by the wheel's click over the map.
  box.addEventListener('auxclick', (/** @type {MouseEvent} */ e) => { if (e.button === 1) e.preventDefault(); });
}

/**
 * @typedef {{ kind: 'marker', layer: any, wrap: HTMLElement, gl: any }} MarkerMirror
 * @typedef {{ kind: 'dot', layer: any, el: HTMLElement, gl: any }} DotMirror
 * @typedef {{ kind: 'path', layer: any }} PathMirror
 * @typedef {{ kind: 'tile', layer: any }} TileMirror
 * @typedef {MarkerMirror | DotMirror | PathMirror | TileMirror} Mirror
 */

export class GlView {
  /** @param {HTMLElement} host @param {L.Map} leaflet */
  constructor(host, leaflet) {
    this.host = /** @type {any} */ (host);
    this.lf = /** @type {any} */ (leaflet);
    this.root = /** @type {HTMLElement} */ (host.querySelector('.gf-map-root'));
    /** Why it is never in 3D ('' : it may be). */
    this.why2d = why2d(host);
    this.allowed = !this.why2d;
    this.#buildUi();
    this.#listenMap();
    this.connect();
  }

  /** @type {'off' | 'loading' | 'ready'} */
  #state = 'off';
  /** Why the map is in 2D though 3D is wanted (a note key), or ''. */
  #blocked = '';
  /** A failure that holds until Réglages › Cartes change, or the network comes back (MapLibre not loaded, context lost). */
  #failed = '';
  /** @type {any} MapLibre */
  #ml = null;
  /** @type {any} the 3D map */
  #map = null;
  /** @type {HTMLElement | null} */
  #box = null;
  /** @type {Map<any, Mirror>} */
  #mirrors = new Map();
  /** @type {MutationObserver | null} */
  #iconWatch = null;
  #fromGl = false;
  #styleReady = false;
  #restylePending = false;
  #demErrors = 0;
  #demFailed = false;
  #vectorFailed = false;
  /** @type {ReturnType<typeof mergeVectorStyle>} */
  #vector = null;
  /** Bumped at each start and stop: a slow load that finishes after them does nothing. */
  #run = 0;
  /** @type {any} */
  #paths = { type: 'FeatureCollection', features: [] };
  #pathsQueued = false;
  #styleQueued = false;
  /** @type {ReturnType<typeof setInterval> | undefined} */
  #sunTimer;
  #connected = false;
  #demCredited = false;
  /** The observations around (its button, its circle, its points). @type {Obs3dLayer | null} */
  #obs = null;

  // ── What the user is told: the map's state, its loading ─────────────────────────────────────────
  // (No 2D ⇄ 3D button on the maps: the choice is in Réglages › Cartes and in each map's panel « Carte », one choice
  // for every map. Nothing written over the map: the quiet-map rule, gf-map.js.)

  #buildUi() {
    if (!this.allowed) this.host.dataset.renderer = '2d';
  }

  /**
   * Why the map is in 2D though 3D is chosen (editing, no WebGL2, MapLibre not loaded, too many maps, the GPU), or
   * why it is flat (offline, the relief unreachable): the map's state — a line of its panel's « État », said once as
   * it changes (gf-map setStatus: a restyle saying the same again says nothing). The device without WebGL2: said once a
   * visit, whatever the map.
   */
  #syncStatus() {
    const blocked = this.wanted && this.#blocked ? NOTES[/** @type {keyof typeof NOTES} */ (this.#blocked)] || '' : '';
    this.host.setStatus?.('gl', blocked || (this.on ? this.#flatWhy() : ''), { once: this.#blocked === 'webgl' });
    // Loading: the map's thin line past 400 ms (no text), « Chargement de la 3D » said then.
    this.host.busy?.('gl', this.#state === 'loading', LOADING);
  }

  /** 3D wanted for this map: Réglages › Cartes say so (or the map is a 3D view: map-3d="on"; and it may be in 3D). */
  get wanted() {
    // A ring held on the screen (area.ring: the games' « map » step) is a view from above by design: never in 3D.
    if (this.host.area?.ring) return false;
    return this.allowed && (this.host.getAttribute('map-3d') === 'on' || mapSettings().renderer === '3d');
  }
  /** Drawn in 3D now (or loading). */
  get on() { return this.#state !== 'off'; }

  // ── When it is drawn in 3D ──────────────────────────────────────────────────────────────────────

  /** Something that keeps the map in 2D now (a note key), or ''. */
  #blocker() {
    if (this.#failed) return this.#failed;
    if (this.host.editing) return 'editing';
    // A marker that can be dragged (an editor, positions being moved): MapLibre's markers cannot be dragged on a tilted
    // relief reliably — the map shows in 2D while there is one.
    let drag = false;
    this.lf.eachLayer((/** @type {any} */ l) => { if (!drag && l instanceof L.Marker && l.options.draggable) drag = true; });
    if (drag) return 'editing';
    if (!hasWebGL2()) return 'webgl';
    if (!live.has(this) && live.size >= MAX_GL) return 'many';
    return '';
  }

  /** Its map-3d attribute changed (a free layout's map, 3d=1 or 3d=0): whether it may be in 3D read again, and shown so. */
  recheck() {
    this.why2d = why2d(this.host);
    this.allowed = !this.why2d;
    if (!this.allowed) this.host.dataset.renderer = '2d';
    this.sync();
  }

  /** Shows the map as it should be now: 2D or 3D. */
  sync() {
    if (!this.#connected) return;
    const blocked = this.wanted ? this.#blocker() : '';
    this.#blocked = blocked;
    if (this.wanted && !blocked) { if (!this.on) this.#start(); }
    else if (this.on) this.#stop();
    this.#syncButton();
  }

  /** The map says how it is drawn (data-renderer, data-gl: its styles, the tests), and why (its state). */
  #syncButton() {
    this.host.dataset.renderer = this.#state === 'ready' ? '3d' : '2d';
    this.host.setNorth?.(this.#state === 'ready' && this.#map ? this.#map.getBearing() : null);
    if (this.#state === 'off') delete this.host.dataset.gl; else this.host.dataset.gl = this.#state;
    this.#syncStatus();
    this.#syncPanel();
  }

  /** The view its page gives it (gf-map `view`), shown in 3D too: its centre and zoom, its tilt and turn when it has them. */
  viewChanged() {
    const map = this.#map, v = this.host.view;
    if (!map || !v) return;
    const tilted = Boolean(v.pitch || v.bearing);
    map.jumpTo({ center: [v.lon, v.lat], zoom: Math.max(0, v.zoom - 1), ...(tilted ? { pitch: v.pitch, bearing: v.bearing } : {}) }, { gfMirror: true });
    this.#syncPitchAttr();
  }

  /** Its compass touched: back to the north, the tilt kept (an ease; a jump with « reduced motion »). */
  resetNorth() {
    this.#map?.easeTo({ bearing: 0, duration: reduceMotion() ? 0 : 500 });
  }

  /** gf-map's properties changed: editing starts or ends, markers become draggable. @param {Map<string, any>} changed */
  changed(changed) {
    if (['editing', 'editable', 'draggablePlants', 'pin', 'pinDraggable', 'area'].some(k => changed.has(k))) queueMicrotask(() => this.sync());
    this.#obs?.changed(changed);
  }

  /** In the page (again): it follows Réglages, the modules and the network while it is. */
  connect() {
    if (this.#connected) return;
    this.#connected = true;
    views.add(this);
    for (const [target, type, fn] of this.#global) target.addEventListener(type, fn);
    this.sync();
  }

  /** Out of the page: its 3D map goes (map.remove(): its WebGL context given back). */
  disconnect() {
    if (!this.#connected) return;
    this.#connected = false;
    views.delete(this);
    for (const [target, type, fn] of this.#global) target.removeEventListener(type, fn);
    if (this.on) this.#stop();
  }

  /** @type {[EventTarget, string, (e: any) => void][]} */
  #global = [
    [mapSettingsEvents, 'change', () => {
      // Réglages changed: a failure is tried again.
      this.#failed = this.#failed === 'webgl' ? 'webgl' : '';
      this.sync();
      if (this.#state === 'ready') { this.#restyle(); this.#applyPitch(); this.#fetchVector(); }
      this.#syncPanel();
    }],
    [moduleEvents, 'change', () => { if (this.on) this.#restyle(); this.#syncPanel(); }],
    [window, 'online', () => { if (this.#failed === 'loadOffline') { this.#failed = ''; this.sync(); } if (this.on) { this.#demFailed = false; this.#vectorFailed = false; this.#restyle(); this.#fetchVector(); } }],
    [window, 'offline', () => { if (this.on) this.#restyle(); }]
  ];

  /** The 2D map's own events, for its whole life (a setting may switch it to 3D at any time). */
  #listenMap() {
    // Draggable markers come and go (editing): the map goes to 2D and back.
    let queued = false;
    const later = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; if (this.wanted) this.sync(); }); } };
    this.lf.on('layeradd layerremove', (/** @type {any} */ e) => { if (e.layer instanceof L.Marker) later(); });
    // The panel « Carte » opened: its 3D part.
    new MutationObserver(() => this.#syncPanel()).observe(this.root, { childList: true });
  }

  // ── Start and stop ──────────────────────────────────────────────────────────────────────────────

  async #start() {
    const run = ++this.#run;
    this.#state = 'loading';
    live.add(this);
    this.#syncButton();
    let ml;
    try {
      [ml] = await Promise.all([loadMapLibre(), linkCss(this.#cssRoot(), MAPLIBRE_CSS), linkCss(this.#cssRoot(), MAP_GL_CSS)]);
    } catch (error) {
      if (run !== this.#run) return;
      console.warn('Carte 3D :', error);
      this.#fail(navigator.onLine ? 'load' : 'loadOffline');
      return;
    }
    if (run !== this.#run || !this.#connected) return;
    this.#ml = ml;
    try {
      this.#create(ml);
    } catch (error) {
      console.warn('Carte 3D :', error);
      noWebGL2();
      this.#fail('webgl');
      return;
    }
    // The vector plan and the buildings' source, when wanted: the map shows at once, they come in when they are here.
    this.#fetchVector();
  }

  /** Where the stylesheets go: the shadow root the map lives in, or the document. */
  #cssRoot() { const r = this.host.getRootNode(); return r instanceof ShadowRoot ? r : document; }

  /** @param {string} why a note key */
  #fail(why) {
    this.#failed = why;
    this.#stop();
    this.#blocked = '';
    this.sync();
  }

  /** @param {any} ml */
  #create(ml) {
    const lf = this.lf;
    const box = this.#box = Object.assign(document.createElement('div'), { className: 'gf-map-gl' });
    // Unseen until its first frame (the 2D map shows meanwhile).
    box.style.visibility = 'hidden';
    this.root.querySelector('.gf-map-canvas')?.after(box);
    this.#demErrors = 0;
    this.#styleReady = false;
    // The tile layers, lines and areas first: in the first style.
    lf.eachLayer((/** @type {any} */ l) => { if (!(l instanceof L.Marker || l instanceof L.CircleMarker)) this.#mirror(l); });
    this.#syncPaths();
    const c = lf.getCenter();
    const s = mapSettings();
    // The view its page gives it (a free layout's vue=, tilted or turned): that tilt and turn, else Réglages'.
    const v = this.host.view;
    const tilted = Boolean(v && (v.pitch || v.bearing));
    const map = this.#map = new ml.Map({
      container: box,
      style: this.#style(),
      center: [c.lng, c.lat],
      zoom: Math.max(0, lf.getZoom() - 1),
      pitch: tilted ? v.pitch : s.pitch,
      bearing: tilted ? v.bearing : 0,
      // Tilted up to the horizon (the orbit, the right button, two fingers): the mountains ahead, not only from above.
      maxPitch: MAX_PITCH,
      minZoom: this.#minZoom(),
      maxZoom: 20,
      locale: LOCALE,
      attributionControl: false,
      pixelRatio: Math.min(devicePixelRatio || 1, 2),
      fadeDuration: reduceMotion() ? 0 : 300,
      cancelPendingTileRequestsWhileZooming: true
    });
    // The usual 3D navigation, MapLibre's defaults on every device: drag to pan, the wheel pressed (as in any 3D
    // tool), right-drag (Ctrl-drag) or two fingers to rotate and tilt, wheel or pinch to zoom, arrow keys; + −. The
    // compass is the map's own, among its buttons (gf-map setNorth: every map has it, 2D too).
    map.addControl(new ml.NavigationControl({ showCompass: false }), 'bottom-left');
    orbitWithMiddleButton(map);
    map.addControl(new ml.ScaleControl({ unit: 'metric', maxWidth: 90 }), 'bottom-left');
    const frame = this.host.querySelector('.gf-map-frame');
    map.addControl(new ml.FullscreenControl(frame ? { container: frame } : {}), 'bottom-left');

    this.#listenGl(map);
    this.#listenLeaflet();
    // The 2D map: still there, hidden, without tiles; zooms between whole levels, as the 3D map has them.
    lf.options.zoomSnap = 0;
    lf.eachLayer((/** @type {any} */ l) => this.#mirror(l));
    map.on('style.load', () => {
      this.#styleReady = true;
      if (this.#restylePending) { this.#restylePending = false; this.#restyle(); }
    });
    this.#watchIcons();
    this.#credit();
    this.#obs = new Obs3dLayer({ host: this.host, lf, ml, map, box, root: this.root, restyle: () => this.#restyle() });

    const ready = () => {
      if (this.#map !== map) return;
      this.#state = 'ready';
      box.style.visibility = '';
      this.#syncPitchAttr();
      this.#syncButton();
    };
    map.once('render', ready);
    if (this.#sunMoving()) this.#sunTimer = setInterval(() => this.#restyle(), 10 * 60 * 1000);
  }

  #stop() {
    this.#run++;
    const map = this.#map;
    this.#map = null;
    clearInterval(this.#sunTimer);
    this.#iconWatch?.disconnect();
    this.#iconWatch = null;
    this.#obs?.destroy();
    this.#obs = null;
    this.#unlistenLeaflet();
    for (const layer of [...this.#mirrors.keys()]) this.#unmirror(layer);
    this.#credit(true);
    if (this.lf.options.zoomSnap === 0) {
      this.lf.options.zoomSnap = 1;
      // Back on a whole zoom level (the 2D tiles' own), where the 3D map was.
      if (this.#connected) this.lf.setZoom(Math.round(this.lf.getZoom()), { animate: false });
    }
    try { map?.remove(); } catch { /* its context already lost */ }
    this.#box?.remove();
    this.#box = null;
    this.#state = 'off';
    live.delete(this);
    this.#syncButton();
    // A map waiting for room (too many in 3D) may have it now.
    for (const v of views) if (v !== this && v.#blocked === 'many') v.sync();
  }

  // ── The style ───────────────────────────────────────────────────────────────────────────────────

  #minZoom() { return mapSettings().globe ? 0 : Math.max(0, (this.lf.getMinZoom?.() ?? 5) - 1); }
  #online() { return navigator.onLine; }
  #terrainOn() { const s = mapSettings(); return s.relief && moduleOn('relief3d') && this.#online() && !this.#demFailed; }
  #buildingsOn() { return mapSettings().buildings && moduleOn('ignMaps') && this.#online(); }
  #vectorWanted() { return mapSettings().plan === 'vector' && moduleOn('ignMaps') && this.#online() && !this.#vectorFailed; }
  #sunMoving() { return mapSettings().light === 'now'; }

  /** Why the map is flat though the relief is asked (a note), or ''. */
  #flatWhy() {
    const s = mapSettings();
    if (!s.relief || !moduleOn('relief3d')) return '';
    if (!this.#online()) return NOTES.offline;
    if (this.#demFailed) return NOTES.dem;
    return '';
  }

  #sun() {
    const moment = lightMoment(mapSettings());
    if (!moment) return null;
    const c = this.lf.getCenter();
    return sunPosition(moment, c.lat, c.lng);
  }

  /** The tile layers of the 2D map, bottom first. */
  #tiles() {
    const tiles = [...this.#mirrors.values()].filter(m => m.kind === 'tile').map(m => m.layer)
      .sort((a, b) => (a.options.zIndex ?? 1) - (b.options.zIndex ?? 1) || L.Util.stamp(a) - L.Util.stamp(b));
    return tiles.map((l, i) => describeTileLayer(l, i)).filter(Boolean);
  }

  #style() {
    const style = buildStyle({
      tiles: /** @type {any} */ (this.#tiles()),
      settings: mapSettings(),
      terrain: this.#terrainOn(),
      cacheOnly: !moduleOn('ignMaps'),
      buildings: this.#buildingsOn(),
      vector: this.#vectorWanted() ? this.#vector : null,
      planSource: this.#vector?.planSource ?? null,
      sun: this.#sun(),
      paths: this.#paths
    });
    // The observations around, over the rest.
    this.#obs?.addTo(style);
    return style;
  }

  /** Drawn again (a layer, a setting, a module, the network changed): only what differs (MapLibre's diff). */
  #restyle() {
    if (this.#styleQueued) return;
    this.#styleQueued = true;
    queueMicrotask(() => {
      this.#styleQueued = false;
      const map = this.#map;
      if (!map) return;
      // Not loaded yet (its first style): once it is.
      if (!this.#styleReady) { this.#restylePending = true; return; }
      map.setStyle(this.#style(), { diff: true });
      map.setMinZoom(this.#minZoom());
      this.#credit();
      // Flat or not (offline, the relief unreachable): the map's state, said only as it changes.
      this.#syncStatus();
      this.#syncPanel();
    });
  }

  #fetchVector() {
    if (!this.#vectorWanted() && !this.#buildingsOn()) return;
    if (this.#vector) return;
    const run = this.#run;
    ignVectorStyle().then(v => {
      if (run !== this.#run || !v) return;
      this.#vector = v;
      this.#restyle();
    });
  }

  #applyPitch() {
    const map = this.#map;
    if (map) map.easeTo({ pitch: mapSettings().pitch, duration: reduceMotion() ? 0 : 600 }, { gfMirror: true });
  }

  /** The relief's credit with the 2D map's (shown over the 3D map). @param {boolean} [off] */
  #credit(off = false) {
    const on = !off && Boolean(this.#map) && this.#terrainOn();
    if (on === this.#demCredited) return;
    this.#demCredited = on;
    if (on) this.lf.attributionControl?.addAttribution(DEM_ATTRIBUTION);
    else this.lf.attributionControl?.removeAttribution(DEM_ATTRIBUTION);
  }

  // ── The 3D map's events ─────────────────────────────────────────────────────────────────────────

  /** @param {any} map */
  #listenGl(map) {
    const lf = this.lf;
    const latlng = (/** @type {any} */ e) => L.latLng(e.lngLat.lat, e.lngLat.lng);
    const onMarker = (/** @type {any} */ e) => Boolean(e.originalEvent?.target?.closest?.('.maplibregl-marker'));
    // Its own moves (pan, zoom), once they end: the 2D map goes there too (its groups, plants by zoom, protected areas).
    // Moved by hand: told to the map (gf-map view-change: a tilt or a turn alone moves no 2D map).
    map.on('moveend', (/** @type {any} */ e) => {
      if (!e.gfMirror) { this.#toLeaflet(); this.root.dispatchEvent(new Event('gl-moveend')); }
      this.#syncPitchAttr();
    });
    map.on('movestart', (/** @type {any} */ e) => { if (e.originalEvent) lf.fire('movestart'); });
    map.on('dragstart', () => lf.fire('dragstart'));
    map.on('click', (/** @type {any} */ e) => {
      if (onMarker(e)) return;
      lf.fire('click', { latlng: latlng(e), originalEvent: e.originalEvent });
    });
    // Right click, or a long touch: the point's card (as in 2D).
    let lastMenu = 0;
    const menu = (/** @type {any} */ e) => {
      if (onMarker(e) || performance.now() - lastMenu < 600) return;
      lastMenu = performance.now();
      lf.fire('contextmenu', { latlng: latlng(e), originalEvent: e.originalEvent });
    };
    map.on('contextmenu', menu);
    /** @type {ReturnType<typeof setTimeout> | undefined} */ let press;
    /** @type {any} */ let pressAt = null;
    map.on('touchstart', (/** @type {any} */ e) => {
      clearTimeout(press);
      if (e.originalEvent.touches?.length !== 1 || onMarker(e)) return;
      pressAt = e.point;
      press = setTimeout(() => menu(e), 550);
    });
    map.on('touchmove', (/** @type {any} */ e) => { if (pressAt && Math.hypot(e.point.x - pressAt.x, e.point.y - pressAt.y) > 8) clearTimeout(press); });
    map.on('touchend touchcancel movestart', () => clearTimeout(press));
    // (No altitude following the pointer: the point's card gives it on demand — a long press, a right click: the
    // IGN's —, and the Vue 3D's plant card for a plant.)
    map.on('error', (/** @type {any} */ e) => this.#onError(e));
    map.on('webglcontextlost', () => this.#fail('lost'));
    // The compass turns with the map.
    map.on('rotate', () => { if (this.#state === 'ready') this.host.setNorth?.(map.getBearing()); });
  }

  #syncPitchAttr() {
    const map = this.#map;
    if (!map) return;
    this.host.dataset.pitch = String(Math.round(map.getPitch()));
    this.host.dataset.bearing = String(Math.round(map.getBearing()));
  }

  /** A tile failed. @param {any} e */
  #onError(e) {
    const map = this.#map;
    if (!map) return;
    const source = e?.sourceId || e?.source?.id || '';
    // A failed tile asks for no new frame: one more settles the view (offline, the host out of reach).
    map.triggerRepaint();
    if ((source === 'gf-dem' || source === 'gf-shade') && ++this.#demErrors === DEM_GIVE_UP && !this.#demFailed) {
      this.#demFailed = true;
      this.#restyle();
    } else if (String(source).startsWith('ign-v:') && !this.#vectorFailed) {
      this.#vectorFailed = true;
      this.#restyle();
    }
  }

  // ── The camera, between the two maps ────────────────────────────────────────────────────────────

  /**
   * The 3D map's view being given to the 2D map now (gf-map: a zoom it makes is no zoom of its own — its groups kept,
   * its spread points not gathered).
   */
  get mirroring() { return this.#fromGl; }

  /**
   * What the 3D map shows (tilted, turned: the smallest box around it — not the 2D map's, north up, seen from above),
   * or null when it is not drawn.
   * @returns {L.LatLngBounds | null}
   */
  get bounds() {
    const b = this.#state === 'ready' ? this.#map?.getBounds() : null;
    return b ? L.latLngBounds([b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]) : null;
  }

  /** The 3D map's view given to the 2D map (silently: never sent back). */
  #toLeaflet() {
    const map = this.#map;
    if (!map) return;
    const c = map.getCenter();
    this.#fromGl = true;
    try { this.lf.setView([c.lat, c.lng], map.getZoom() + 1, { animate: false }); } finally { this.#fromGl = false; }
  }

  /** @type {Record<string, (e: any) => void>} */
  #lfHandlers = {};

  #listenLeaflet() {
    const lf = this.lf;
    const follow = (/** @type {boolean} */ end) => {
      const map = this.#map;
      if (!map || this.#fromGl || (!end && reduceMotion())) return;
      const c = lf.getCenter();
      map.jumpTo({ center: [c.lng, c.lat], zoom: Math.max(0, lf.getZoom() - 1) }, { gfMirror: true });
    };
    this.#lfHandlers = {
      move: () => follow(false),
      moveend: () => follow(true),
      // A zoom animated in 2D (fitBounds, setView): eased in 3D too.
      zoomanim: (/** @type {any} */ e) => {
        if (!this.#map || this.#fromGl) return;
        this.#map.easeTo({ center: [e.center.lng, e.center.lat], zoom: Math.max(0, e.zoom - 1), duration: reduceMotion() ? 0 : 250 }, { gfMirror: true });
      },
      resize: () => this.#map?.resize(),
      layeradd: (/** @type {any} */ e) => this.#mirror(e.layer),
      layerremove: (/** @type {any} */ e) => this.#unmirror(e.layer)
    };
    for (const [type, fn] of Object.entries(this.#lfHandlers)) lf.on(type, fn);
  }

  #unlistenLeaflet() {
    for (const [type, fn] of Object.entries(this.#lfHandlers)) this.lf.off(type, fn);
    this.#lfHandlers = {};
  }

  // ── Mirroring the 2D map's layers ───────────────────────────────────────────────────────────────

  /** @param {any} layer */
  #mirror(layer) {
    if (this.#state === 'off' || this.#mirrors.has(layer)) return;
    if (layer instanceof L.GridLayer) {
      const grid = /** @type {any} */ (layer);
      // Its tiles: MapLibre's now; Leaflet's stop loading (and go) until the map is in 2D again.
      if (!grid.gfUpdate) {
        grid.gfUpdate = grid._update;
        grid._update = () => {};
        grid._abortLoading?.();
        grid._removeAllTiles?.();
      }
      this.#mirrors.set(layer, { kind: 'tile', layer });
      this.#restyle();
    } else if (layer instanceof L.Marker) {
      if (this.#map) this.#mirrorMarker(layer);
    } else if (layer instanceof L.CircleMarker && !(layer instanceof L.Circle)) {
      if (this.#map) this.#mirrorDot(layer);
    } else if (layer instanceof L.Path) {
      this.#mirrors.set(layer, { kind: 'path', layer });
      layer.on('move', this.#queuePaths);
      this.#queuePaths();
    }
  }

  /** @param {any} layer */
  #unmirror(layer) {
    const m = this.#mirrors.get(layer);
    if (!m) return;
    this.#mirrors.delete(layer);
    if (m.kind === 'tile') {
      if (layer.gfUpdate) { layer._update = layer.gfUpdate; delete layer.gfUpdate; }
      // Still on the 2D map (the 3D map going): its tiles back.
      if (layer._map) layer.redraw();
      if (this.#map) this.#restyle();
    } else if (m.kind === 'marker') {
      layer.off('move', m.gl.gfMove);
      const icon = layer._icon;
      // Still on the 2D map: its element back in its pane, placed by Leaflet again.
      if (icon && layer._map) { layer.getPane()?.appendChild(icon); layer.update(); }
      m.gl.remove();
    } else if (m.kind === 'dot') {
      layer.off('move', m.gl.gfMove);
      delete layer.getElement;
      m.gl.remove();
    } else {
      layer.off('move', this.#queuePaths);
      this.#queuePaths();
    }
  }

  /**
   * Events on a mirrored element handed to its Leaflet layer: what gf-map listens to (click, hover; Enter on a marker
   * of the keyboard).
   * @param {HTMLElement} el @param {any} layer
   */
  #forward(el, layer) {
    const fire = (/** @type {string} */ type, /** @type {Event} */ e) => layer.fire(type, { originalEvent: e, latlng: layer.getLatLng?.() });
    el.addEventListener('click', e => { e.stopPropagation(); fire('click', e); });
    el.addEventListener('mouseenter', e => fire('mouseover', e));
    el.addEventListener('mouseleave', e => fire('mouseout', e));
    el.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === layer._icon) { e.preventDefault(); fire('click', e); }
    });
    // MapLibre does not start a pan from a marker pressed (a click stays a click).
    el.addEventListener('mousedown', e => e.stopPropagation());
    el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); });
  }

  /** A marker: its element in a MapLibre marker (Leaflet's margins anchor it). @param {any} layer */
  #mirrorMarker(layer) {
    const ml = this.#ml, map = this.#map;
    const wrap = Object.assign(document.createElement('div'), { className: 'gf-gl-mk' });
    const { lat, lng } = layer.getLatLng();
    // Never faded behind the relief (MapLibre tests the marker's foot: a head standing clear of a ridge was faded).
    const gl = new ml.Marker({ element: wrap, anchor: 'top-left', opacityWhenCovered: '1', subpixelPositioning: true }).setLngLat([lng, lat]).addTo(map);
    // Over the others as in 2D (a place selected, the plant chosen's photos), and over the observations around.
    wrap.style.zIndex = String(MARK_Z + Math.max(0, layer.options.zIndexOffset || 0));
    gl.gfMove = () => { const p = layer.getLatLng(); gl.setLngLat([p.lng, p.lat]); };
    layer.on('move', gl.gfMove);
    if (layer.options.interactive !== false) this.#forward(wrap, layer);
    /** @type {MarkerMirror} */
    const m = { kind: 'marker', layer, wrap, gl };
    this.#mirrors.set(layer, m);
    this.#adopt(m);
  }

  /**
   * The marker's element (Leaflet made a new one: a new look) into its MapLibre marker. (No name left over a point:
   * gf-map shows names on hover, focus or touch — its floating card —, never a permanent label.)
   * @param {MarkerMirror} m
   */
  #adopt(m) {
    const icon = m.layer._icon;
    if (icon && icon.parentNode !== m.wrap) {
      for (const old of [...m.wrap.children]) if (old.classList.contains('leaflet-marker-icon')) old.remove();
      m.wrap.prepend(icon);
    }
    m.wrap.style.zIndex = String(MARK_Z + Math.max(0, m.layer.options.zIndexOffset || 0));
  }

  /** Leaflet replaces a marker's element when its look changes: the new one goes where the old one was. */
  #watchIcons() {
    const pane = this.lf.getPane('markerPane');
    if (!pane) return;
    this.#iconWatch = new MutationObserver(records => {
      if (!records.some(r => r.addedNodes.length)) return;
      for (const m of this.#mirrors.values()) if (m.kind === 'marker' && m.layer._icon?.parentNode === pane) this.#adopt(m);
    });
    this.#iconWatch.observe(pane, { childList: true });
  }

  /** A small circle (a point): a disc, the element gf-map lights and places its card by. @param {any} layer */
  #mirrorDot(layer) {
    const ml = this.#ml, map = this.#map;
    const o = layer.options;
    const el = Object.assign(document.createElement('div'), { className: 'gf-gl-dot ' + (o.className || '') });
    el.style.setProperty('--r', String(o.radius || 6));
    if (o.interactive === false) el.classList.add('inert');
    const { lat, lng } = layer.getLatLng();
    const gl = new ml.Marker({ element: el, anchor: 'center', opacityWhenCovered: '1' }).setLngLat([lng, lat]).addTo(map);
    el.style.zIndex = String(MARK_Z);
    gl.gfMove = () => { const p = layer.getLatLng(); gl.setLngLat([p.lng, p.lat]); };
    layer.on('move', gl.gfMove);
    // gf-map places its cards and lights a plant's points by their element: this one, while the map is in 3D.
    layer.getElement = () => el;
    if (o.interactive !== false) this.#forward(el, layer);
    this.#mirrors.set(layer, { kind: 'dot', layer, el, gl });
  }

  #queuePaths = () => {
    if (this.#pathsQueued) return;
    this.#pathsQueued = true;
    requestAnimationFrame(() => { this.#pathsQueued = false; this.#syncPaths(); });
  };

  /** The lines and areas as one GeoJSON source (styled by their classes, as map.css does in 2D). */
  #syncPaths() {
    /** @type {any[]} */
    const features = [];
    for (const m of this.#mirrors.values()) {
      if (m.kind !== 'path') continue;
      const l = m.layer;
      const props = pathStyle(l.options.className, l.options);
      if (l instanceof L.Circle) {
        const c = l.getLatLng();
        features.push({ type: 'Feature', properties: { ...props, fill: props.fill }, geometry: { type: 'Polygon', coordinates: [circlePolygon([c.lng, c.lat], l.getRadius())] } });
      } else {
        const f = l.toGeoJSON?.();
        if (f?.geometry) features.push({ type: 'Feature', properties: { ...props, fill: props.fill && !(l instanceof L.Polyline && !(l instanceof L.Polygon)) }, geometry: f.geometry });
      }
    }
    this.#paths = { type: 'FeatureCollection', features };
    this.#map?.getSource('gf-paths')?.setData(this.#paths);
  }

  // ── The panel « Carte »: its « Affichage » (2D / 3D, the 3D options) knows how this map is drawn ────────

  /**
   * This map drawn one way whatever the choice ({ renderer, why }), or null: the choice applies to it.
   * @returns {{ renderer: '2d' | '3d', why: string } | null}
   */
  get fixed() {
    if (!this.allowed) return { renderer: '2d', why: this.why2d };
    if (this.host.area?.ring) return { renderer: '2d', why: FROM_ABOVE };
    if (this.host.getAttribute('map-3d') === 'on') return { renderer: '3d', why: 'Cette vue est toujours en 3D (le choix vaut pour les autres cartes).' };
    return null;
  }

  #syncPanel() {
    const panel = /** @type {any} */ (this.root.querySelector('gf-map-panel'));
    if (!panel) return;
    // Why it is in 2D though 3D is wanted, or flat: the map's state, in the same panel's « État » (#syncStatus).
    panel.gl = { on: this.on, fixed: this.fixed };
  }

  // ── For the tests (and the curious): what the 3D map shows now ──────────────────────────────────

  /** @returns {any} */
  state() {
    const map = this.#map;
    const style = map?.getStyle();
    return {
      renderer: this.#state === 'ready' ? '3d' : '2d', state: this.#state, blocked: this.#blocked, wanted: this.wanted, allowed: this.allowed,
      demFailed: this.#demFailed, vectorFailed: this.#vectorFailed,
      ...(map ? {
        layers: style.layers.map((/** @type {any} */ l) => l.id),
        sources: Object.keys(style.sources),
        tiles: this.#tiles(),
        terrain: Boolean(map.getTerrain()),
        exaggeration: map.getTerrain()?.exaggeration ?? null,
        sky: Boolean(style.sky),
        projection: map.getProjection?.()?.type ?? 'mercator',
        pitch: Math.round(map.getPitch()), bearing: Math.round(map.getBearing()), zoom: map.getZoom(),
        markers: [...this.#mirrors.values()].filter(m => m.kind === 'marker' || m.kind === 'dot').length,
        paths: this.#paths.features.length,
        light: map.getLight?.() ?? null,
        obs3d: this.#obs?.state() ?? null
      } : {})
    };
  }

  /** The 3D map itself (tests). */
  get glMap() { return this.#map; }
}
