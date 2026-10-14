// @ts-check
// The observations around a place, on a map in 3D (gf-map-gl.js makes one for each 3D map, gone with it): iNaturalist's
// and GBIF's plant observations, and the plants of the user's places, inside a circle around a centre — shown on the
// relief, the circle a wall of light standing on the ground. Any map in 3D has it (its button « Observations
// autour », binoculars, with the map's others); what each map keeps (shown, radius, sources, density) is its own
// (core/around3d.js, by the page or block the map is in).
// The centre: the map's area (a page's circle), else the point picked (a long press, a search result: the point card)
// or the place selected, else the view's centre when it is shown — fixed then: the view moves, the circle stays;
// « Centrer ici » brings it to the view's centre. The radius: the stops of the mini-apps' distance (200 m to 50 km), on
// the same stepped slider, in a card at the bottom of the map (folded to its chip: « 2 km · 128 »).
// What is drawn, and why (the views tried: every point a DOM marker — a few hundred elements moved at each frame of a
// tilt, slow on a phone; every point a symbol of MapLibre — fast, but no photos, no card, not the 2D markers; a
// clustered source — bubbles, not the app's look):
//  - the zone: the circle draped on the relief (its 2D look: a pale green line on a dark shadow, lightly filled), and
//    at its edge a translucent wall, its rim brighter — it reads as a place in a tilted view, where a flat line is
//    lost in the relief; the wall in short pieces, each standing on the ground where it is; the radius on a pill at
//    its south;
//  - the points: the same markers as in 2D (map-style.js: a photo over its leaf, a leaf alone, the plant chosen in its
//    pink and gold ring) — a GBIF occurrence as an iNaturalist observation: its plant's photo, the same seed, the same
//    card but for its source (core/around3d.js); the photos of plants without one in the flora's data, found online
//    after the points are drawn, drawn again with them (morePhotos) —, standing on the ground on a thin stem as the map tilts (none from
//    above), smaller further away, faded where the relief hides them (MapLibre's own test of the terrain). Only the
//    nearest ones are elements:
//    the points on the screen are grouped by distance on the screen (the nearest first, the plant chosen before all),
//    and the first groups (40 on a phone, 70 otherwise) are markers — a point alone its photo, a group a stack of
//    photos with its count (as the 2D groups: never a bubble); every other point is a small seed drawn by MapLibre
//    (one circle layer, the points shown as markers hidden by feature state: no data sent again as the view moves);
//    laid out again as the view moves (a few times a second) and once it rests;
//  - the density, at will: the circle in hexagons, a column per hexagon as tall as its share of the busiest one,
//    coloured from the app's greens to gold — touched, how many and the plants most seen;
//  - a point hovered or touched: the 2D card (map-style.js obsCard: photo and credit, names, when and where); a
//    group touched, the map zooms to it (close already: the card of its first point and the names of the others);
//    one of the user's plants opens it (plant-select, as in 2D);
//  - the camera, on open (and when the centre moves): a gentle flight that frames the circle, tilted, then a slow
//    turn around it (30°); none with « reduced motion » (the view jumps there).
// One WebGL context (the 3D map's), no image of the map made; offline, the points cached (a day) are shown; without
// relief, the same, flat.

import { html, nothing, render } from 'lit';
import { RADII_3D, around3dPrefs, fitZoom, hexBins, metres, morePhotos, observations3d, radiusLabel, radiusWords, ringWall, setAround3dPrefs, wallHeight } from '../core/around3d.js';
import { circlePolygon } from '../core/gl-style.js';
import { mapSettings } from '../core/map-settings.js';
import { cachedThumb } from '../core/thumb.js';
import { icon, iconMarkup } from '../core/icons.js';
import { hintView, takeHint } from '../core/hints.js';
import { PHONE_QUERY } from '../core/media.js';
import { cancelImages, chosenMarker, elem, leafMarker, obsCard, photoMarker, speciesKey } from './map-style.js';

/** @typedef {import('../core/around3d.js').Obs3d} Obs3d */

const ID = 'gf-o3-';
/** The groups drawn as elements, at most (a phone, a larger screen). */
const DOM_PHONE = 40;
const DOM_WIDE = 70;
/** Points closer than this on the screen (px) are one group. */
const GROUP_PX = 46;
/** The layout again while the view moves: at most this often (ms). */
const LAYOUT_EVERY = 120;
/** Its seeds' colours: an observation's green (iNaturalist's and GBIF's alike), the user's plants gold. */
const SEED = { obs: '#5c8a00', mine: '#f5c542' };

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The page or block a map is in (its custom element, across shadow roots), and its id: what it keeps is its own. @param {Element} host */
function scopeOf(host) {
  /** @type {Node | null} */ let n = host.parentNode || null;
  while (n) {
    if (n instanceof ShadowRoot) n = n.host;
    else if (n instanceof Element && n.localName.includes('-') && n.localName !== 'gf-map') break;
    else n = n.parentNode;
  }
  const page = n instanceof Element ? n.localName : 'map';
  return host.id ? page + '#' + host.id : page;
}

/**
 * @typedef {{ key: string, gl: any, el: HTMLElement, sig: string, members: number[] }} Mark
 */

export class Obs3dLayer {
  /**
   * @param {{ host: any, lf: any, ml: any, map: any, box: HTMLElement, root: HTMLElement, restyle: () => void }} o
   */
  constructor({ host, lf, ml, map, box, root, restyle }) {
    this.host = host;
    this.lf = lf;
    this.ml = ml;
    this.map = map;
    this.box = box;
    this.root = root;
    this.restyle = restyle;
    this.scope = scopeOf(host);
    this.prefs = around3dPrefs(this.scope, host.area?.radius);
    this.#buildUi();
    this.#listen();
    if (this.prefs.on) this.#turnOn(true);
  }

  /** @type {[number, number] | null} */ center = null;
  /** Why the centre is there: 'area', 'point', 'place', 'view'. */
  why = 'view';
  /** @type {Obs3d[]} */ #remote = [];
  /** The points or their photos changed (new points, photos found online): every marker drawn again (its signature). */
  #photoGen = 0;
  /** @type {Obs3d[]} */ #points = [];
  /** @type {{ inat: number | null, gbif: number | null }} */ #totals = { inat: null, gbif: null };
  /** @type {string[]} */ #failed = [];
  #loading = false;
  /** @type {AbortController | null} */ #abort = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ #loadTimer;
  /** @type {Map<string, Mark>} */ #marks = new Map();
  /** The points shown as markers now (their seeds hidden). @type {Set<number>} */ #shown = new Set();
  /** The plants lit (speciesKey). @type {Set<string>} */ #lit = new Set();
  /** @type {any} */ #pts = { type: 'FeatureCollection', features: [] };
  /** @type {any} */ #hex = { type: 'FeatureCollection', features: [], max: 1, size: 0 };
  /** @type {[number, number] | null} the point picked last (point card) */ #picked = null;
  #open = false;
  #lastLayout = 0;
  #layoutQueued = false;
  #alive = true;
  /** @type {HTMLElement | null} */ #card = null;
  /** The card stays (touched), or follows the pointer (hovered). */
  #cardPinned = false;
  #phone = matchMedia(PHONE_QUERY).matches;
  /** Close enough that gf-map shows the user's plants itself. */
  #close = false;

  // ── Its controls: the button, the card at the bottom ────────────────────────────────────────────

  /** @type {HTMLButtonElement | null} */ #button = null;
  /** @type {HTMLElement | null} */ #bar = null;

  #buildUi() {
    const buttons = this.root.querySelector('.gf-map-buttons');
    const b = this.#button = Object.assign(document.createElement('button'), { type: 'button', className: 'around3d' });
    b.setAttribute('aria-label', 'Observations autour');
    b.title = 'Observations autour (iNaturalist, GBIF, vos plantes)';
    // eslint-disable-next-line no-unsanitized/property -- a bundled icon, no data in it
    b.innerHTML = iconMarkup('binoculars');
    b.addEventListener('click', () => this.prefs.on ? this.#turnOff() : this.#turnOn(false));
    (buttons || this.root).append(b);
    const bar = this.#bar = Object.assign(document.createElement('div'), { className: 'gf-o3-bar', hidden: true });
    for (const type of ['mousedown', 'touchstart', 'wheel', 'dblclick', 'contextmenu']) bar.addEventListener(type, e => e.stopPropagation());
    this.box.append(bar);
    this.#syncUi();
  }

  #syncUi() {
    const b = this.#button, bar = this.#bar;
    if (!b || !bar) return;
    b.setAttribute('aria-pressed', String(this.prefs.on));
    bar.hidden = !this.prefs.on;
    this.box.classList.toggle('gf-o3-on', this.prefs.on);
    this.box.classList.toggle('gf-o3-density', this.prefs.on && this.prefs.density);
    if (this.prefs.on) render(this.#barView(), bar);
  }

  /** How many, and from where — a source unreachable said here only (its card is its panel: never a toast). */
  #countLine() {
    const n = this.#points.length;
    if (this.#loading) return '';
    const by = (/** @type {string} */ k) => this.#points.filter(p => p.kind === k).length;
    const parts = [this.prefs.inat ? `iNaturalist ${by('inat')}` : '', this.prefs.gbif ? `GBIF ${by('gbif')}` : '', by('mine') ? `vos plantes ${by('mine')}` : ''].filter(Boolean);
    const failed = this.#failed.length ? ` — ${this.#failed.join(' et ')} injoignable${this.#failed.length > 1 ? 's' : ''}` : '';
    if (!n) return (this.prefs.inat || this.prefs.gbif ? 'Aucune observation dans le cercle' : 'Aucune source choisie') + failed;
    return `${n.toLocaleString('fr-FR')} observation${n > 1 ? 's' : ''} dans le cercle · ${parts.join(' · ')}${failed}`;
  }

  #whereLine() {
    return { area: 'Autour de la zone de la page', point: 'Autour du point choisi', place: 'Autour du lieu choisi', view: 'Autour du centre de la vue' }[this.why] || '';
  }

  /** The card's first-use hint (core/hints.js: the first card unfolded ever on this device), until its ✕. @type {boolean | undefined} */
  #pressHint;

  #barView() {
    const p = this.prefs, at = Math.max(0, RADII_3D.indexOf(p.radius)), n = RADII_3D.length - 1, count = this.#points.length;
    // The chip: its radius, a spinner while they come (past 400 ms: map-gl.css), its count in its name only (the
    // quiet-map rule: no number left over the map; the unfolded card says it, the map's live region too).
    const chip = html`<button type="button" class="gf-o3-chip" aria-expanded=${String(this.#open)} aria-busy=${String(this.#loading)}
      aria-label=${`Observations autour : ${radiusWords(p.radius)}${this.#loading ? '' : `, ${count} observation${count > 1 ? 's' : ''}`}. ${this.#open ? 'Replier' : 'Régler'}`}
      @click=${() => { this.#open = !this.#open; this.#syncUi(); }}>
      ${icon('binoculars')} <b>${radiusLabel(p.radius)}</b>
      ${this.#loading ? html`<i class="gf-o3-spin" aria-hidden="true"></i>` : nothing}
      ${icon(this.#open ? 'chevron-down' : 'chevron-up')}</button>`;
    if (!this.#open) return chip;
    this.#pressHint ??= takeHint('obs3d-press');
    const toggle = (/** @type {'inat' | 'gbif' | 'density'} */ k, /** @type {string} */ label) => html`<label class="gf-o3-toggle">
      <input type="checkbox" .checked=${p[k]} @change=${(/** @type {any} */ e) => this.#set({ [k]: e.target.checked })} /> ${label}</label>`;
    return html`<section class="gf-o3-panel" aria-label="Observations autour">
      <div class="gf-o3-top"><b>Observations autour</b><span class="gf-o3-where">${this.#whereLine()}</span>
        <button type="button" class="gf-o3-close" aria-label="Masquer les observations" title="Masquer les observations" @click=${() => this.#turnOff()}>${icon('x-lg')}</button></div>
      <output class="gf-o3-value">${radiusLabel(p.radius)}</output>
      <div class="gf-o3-range" style="--n:${n};--p:${at / n}">
        <div class="gf-o3-rail" aria-hidden="true"></div>
        ${RADII_3D.map((d, i) => html`<span class="gf-o3-stop ${i <= at ? 'on' : ''}" style="--i:${i}" aria-hidden="true"></span>`)}
        ${RADII_3D.map((d, i) => html`<span class="gf-o3-mark ${[200, 1000, 5000, 50000].includes(d) ? '' : 'minor'} ${i === 0 ? 'first' : i === n ? 'last' : ''} ${i === at ? 'cur' : ''}"
          style="--i:${i}" aria-hidden="true">${radiusLabel(d)}</span>`)}
        <input type="range" min="0" max=${n} step="1" .value=${String(at)} aria-label="Rayon autour du centre" aria-valuetext=${radiusWords(p.radius)}
          @input=${(/** @type {any} */ e) => this.#set({ radius: RADII_3D[Number(e.target.value)] })} />
      </div>
      <p class="gf-o3-count" aria-busy=${String(this.#loading)}>${this.#loading ? html`<i class="gf-o3-spin" aria-hidden="true"></i>` : nothing}${this.#countLine()}</p>
      <div class="gf-o3-row">${toggle('inat', 'iNaturalist')}${toggle('gbif', 'GBIF')}${toggle('density', 'Densité')}</div>
      <div class="gf-o3-row">
        <button type="button" class="gf-o3-recentre" title="Centrer sur le milieu de la vue (ou appui long sur la carte : nouveau centre)"
          @click=${() => this.#recentre()}>${icon('crosshair')} Centrer ici</button>
      </div>
      ${this.#pressHint ? hintView('Appui long sur la carte : nouveau centre.', () => { this.#pressHint = false; this.#syncUi(); }, 'gf-o3-hint') : nothing}
    </section>${chip}`;
  }

  /** @param {Partial<import('../core/around3d.js').Around3dPrefs>} patch */
  #set(patch) {
    const before = this.prefs;
    this.prefs = setAround3dPrefs(this.scope, patch);
    if (patch.radius != null && patch.radius !== before.radius) { this.#zone(); this.#frame(false); this.#queueLoad(); }
    if ((patch.inat != null && patch.inat !== before.inat) || (patch.gbif != null && patch.gbif !== before.gbif)) this.#queueLoad(0);
    if (patch.density != null && patch.density !== before.density) { this.#density(); this.restyle(); this.#layout(); }
    this.#syncUi();
  }

  /** @param {boolean} opening the map opens with it on (what it kept) */
  #turnOn(opening) {
    if (!opening) this.prefs = setAround3dPrefs(this.scope, { on: true });
    // Folded to its chip: the circle and its points first (the chip unfolds the slider).
    this.#open = false;
    this.#pickCenter();
    this.#zone();
    this.restyle();
    this.#syncUi();
    this.#queueLoad(0);
    // On open, once the map has drawn (and gf-map framed its own content): framed on the circle.
    if (opening) this.map.once('idle', () => { if (this.#alive && this.prefs.on) this.#frame(true); });
    else this.#frame(true);
  }

  #turnOff() {
    this.prefs = setAround3dPrefs(this.scope, { on: false });
    this.#abort?.abort();
    clearTimeout(this.#loadTimer);
    this.#loading = false;
    this.#open = false;
    this.#clearMarks();
    this.#hideCard();
    this.restyle();
    this.#syncUi();
  }

  // ── The centre ──────────────────────────────────────────────────────────────────────────────────

  /** The centre now: the page's area, the point picked, the place selected, else the view's centre. */
  #pickCenter() {
    const h = this.host;
    /** @type {[number, number] | null} */ let c = null;
    if (Array.isArray(h.area?.center)) { c = h.area.center; this.why = 'area'; }
    else if (this.#picked) { c = this.#picked; this.why = 'point'; }
    else {
      const place = h.selectedId ? (h.spots || []).find((/** @type {any} */ s) => s.id === h.selectedId) : null;
      if (place?.geometry?.coordinates) { c = place.geometry.coordinates; this.why = 'place'; }
      else if (Array.isArray(h.focusPoint?.coordinates)) { c = h.focusPoint.coordinates; this.why = 'point'; }
    }
    if (!c) {
      // The view's centre — or the circle it had, still in view (shown again: the same circle, not one a little aside).
      const was = this.why === 'view' ? this.center : null;
      if (was && this.map.getBounds().contains(was)) c = was;
      else { const v = this.map.getCenter(); c = [v.lng, v.lat]; }
      this.why = 'view';
    }
    this.center = [Number(c[0]), Number(c[1])];
  }

  /** The centre moved (a page's area, a point picked, a place selected, « Centrer ici »): there, framed again. */
  #moveCenter() {
    const was = this.center?.join();
    this.#pickCenter();
    if (this.center?.join() === was) return;
    this.#zone();
    this.#queueLoad(0);
    this.#frame(true);
    this.#syncUi();
  }

  #recentre() {
    this.#picked = null;
    const v = this.map.getCenter();
    this.center = [v.lng, v.lat];
    this.why = 'view';
    this.#zone();
    this.#queueLoad(0);
    this.#frame(false);
    this.#syncUi();
  }

  /** gf-map's properties changed (gf-map-gl.js tells). @param {Map<string, any>} changed */
  changed(changed) {
    if (!this.prefs.on) return;
    if (changed.has('area') || changed.has('selectedId')) this.#moveCenter();
    if (changed.has('plants') || changed.has('highlight') || changed.has('selectedPlant')) { this.#merge(); this.#layout(); }
  }

  // ── The camera ──────────────────────────────────────────────────────────────────────────────────

  /** Bumped by each flight, and by a hand on the map: a turn never starts after either. */
  #flight = 0;

  /** Framed on the circle: a flight, tilted, then a slow turn of 30° (`orbit`); a jump with « reduced motion ». @param {boolean} orbit */
  #frame(orbit) {
    const map = this.map, c = this.center;
    if (!c) return;
    const canvas = map.getCanvas(), pitch = mapSettings().pitch;
    // The circle across most of the width; tilted, it is shorter than wide (by the tilt's cosine): its depth in the height.
    const px = Math.max(160, Math.min(canvas.clientWidth * 0.8, canvas.clientHeight * 0.7 / Math.max(0.45, Math.cos(pitch * Math.PI / 180))));
    const zoom = Math.min(18, Math.max(3, fitZoom(this.prefs.radius, c[1], px)));
    // Its centre a little above the middle: tilted, its near half is the larger one (and the chip is at the bottom).
    const view = { center: c, zoom, pitch, bearing: map.getBearing(), offset: [0, -Math.round(canvas.clientHeight * pitch / 900)] };
    if (reduceMotion()) { map.easeTo({ ...view, duration: 0 }, { gfObs: true }); return; }
    if (!orbit) { map.easeTo({ ...view, duration: 700 }, { gfObs: true }); return; }
    const flight = ++this.#flight;
    map.flyTo({ ...view, bearing: map.getBearing() - 20, duration: 1800, curve: 1.3, essential: false }, { gfObs: 'fly' });
    const start = (/** @type {any} */ e) => {
      if (e.gfObs !== 'fly') return;
      map.off('moveend', start);
      // Not stopped by a hand (nor followed by another flight): a turn of 30°, slow, at an even pace.
      if (flight === this.#flight && this.#alive && this.prefs.on) map.easeTo({ bearing: map.getBearing() + 30, duration: 9000, easing: (/** @type {number} */ t) => t }, { gfObs: 'orbit' });
    };
    map.on('moveend', start);
  }

  // ── The data ────────────────────────────────────────────────────────────────────────────────────

  #queueLoad(delay = 350) {
    clearTimeout(this.#loadTimer);
    this.#loading = true;
    this.#syncUi();
    this.#loadTimer = setTimeout(() => this.#load(), delay);
  }

  async #load() {
    const c = this.center, p = this.prefs;
    if (!c || !p.on) { this.#loading = false; return; }
    this.#abort?.abort();
    const abort = this.#abort = new AbortController();
    this.box.classList.add('gf-o3-loading');
    try {
      const r = await observations3d(c, p.radius, { inat: p.inat, gbif: p.gbif }, abort.signal);
      if (abort.signal.aborted || !this.#alive) return;
      this.#remote = r.points;
      this.#totals = r.totals;
      this.#failed = r.failed;
      // New points: each marker drawn again (the same point may have another photo: a source switched on or off).
      this.#photoGen++;
      this.#morePhotos(r.points, abort.signal);
    } catch (error) {
      if (abort.signal.aborted || !this.#alive) return;
      console.warn('Observations autour (3D) :', error);
      this.#remote = [];
      this.#failed = ['Les observations'];
    }
    this.#loading = false;
    this.box.classList.remove('gf-o3-loading');
    this.#merge();
    this.#layout();
    this.#syncUi();
    // How many came (a source unreachable with it): said by the map's one live region (gf-map announce).
    this.host.announce?.(`Observations autour : ${this.#countLine()}`);
  }

  /**
   * The photos of the plants without one in the flora's data, looked up once the points are drawn (core/around3d.js
   * morePhotos: their sheet's photo): the points drawn again with them, if these points are still the ones shown.
   * @param {Obs3d[]} points @param {AbortSignal} signal
   */
  async #morePhotos(points, signal) {
    const more = await morePhotos(points).catch(() => null);
    if (!more || signal.aborted || !this.#alive || this.#remote !== points) return;
    this.#remote = more;
    this.#photoGen++;
    this.#merge();
    this.#layout();
    this.#syncUi();
  }

  /** The points: the sources' and the user's plants in the circle (not while gf-map shows them itself, close up). */
  #merge() {
    const h = this.host, c = this.center, r = this.prefs.radius;
    /** @type {Obs3d[]} */ const mine = [];
    const close = this.#close = this.lf.getZoom() >= (h.plantZoom ?? 16);
    if (c && !close) {
      for (const pl of h.plants || []) {
        const [lon, lat] = pl.coordinates || [];
        if (typeof lon !== 'number' || metres(c, [lon, lat]) > r) continue;
        mine.push({ id: 'm' + pl.key, kind: 'mine', coordinates: [lon, lat], title: pl.label || pl.sci || 'Plante', common: pl.label || null, sci: pl.sci || '',
          taxonId: null, photo: pl.plantId ? cachedThumb(pl.plantId) || null : null, credit: null, date: null, place: 'Vos endroits', url: null,
          plant: { placeId: pl.placeId, entryId: pl.entryId, plantId: pl.plantId } });
      }
    }
    this.#points = [...mine, ...this.#remote];
    // The plants lit: the one a page shows (highlight), the plant selected on the map.
    const lit = new Set();
    const hl = h.highlight;
    if (hl) { const k = speciesKey(hl); if (k) lit.add(k); }
    const sel = h.selectedPlant;
    for (const key of Array.isArray(sel) ? sel : sel ? [sel] : []) {
      const pl = (h.plants || []).find((/** @type {any} */ x) => x.key === key);
      const k = pl ? speciesKey(pl) : null;
      if (k) lit.add(k);
    }
    this.#lit = lit;
    this.#pts = {
      type: 'FeatureCollection',
      features: this.#points.map((p, i) => ({ type: 'Feature', id: i, properties: { k: p.kind, hl: this.#isLit(p) }, geometry: { type: 'Point', coordinates: p.coordinates } }))
    };
    // New points, new ids: every seed shown again until the next layout says which are markers.
    if (this.map.getSource(ID + 'pts')) {
      this.map.removeFeatureState({ source: ID + 'pts' });
      this.map.getSource(ID + 'pts').setData(this.#pts);
    }
    this.#shown = new Set();
    this.#density();
  }

  /** @param {Obs3d} p */
  #isLit(p) { const k = speciesKey(p); return Boolean(k && this.#lit.has(k)); }

  #density() {
    this.#hex = this.prefs.density && this.center ? hexBins(this.#points, this.center, this.prefs.radius) : { type: 'FeatureCollection', features: [], max: 1, size: 0 };
    this.map.getSource(ID + 'hex')?.setData(this.#hex);
  }

  /** The circle: its area, its wall (its radius is the chip's and the slider's: no pill left on the ground). */
  #zone() {
    const c = this.center;
    if (!c) return;
    this.map.getSource(ID + 'zone')?.setData(this.#zoneData());
    this.map.getSource(ID + 'wall')?.setData(ringWall(c, this.prefs.radius));
    this.restyle();
  }

  #zoneData() {
    const c = /** @type {[number, number]} */ (this.center);
    return { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circlePolygon(c, this.prefs.radius, 128)] } },
      { type: 'Feature', properties: { centre: true }, geometry: { type: 'Point', coordinates: c } }
    ] };
  }

  // ── The style: its sources and layers, in the 3D map's (gf-map-gl.js#style adds them) ───────────

  /** Adds its sources and layers to a style (nothing while it is off). @param {any} style */
  addTo(style) {
    if (!this.prefs.on || !this.center) return;
    const c = this.center, r = this.prefs.radius, h = wallHeight(r), density = this.prefs.density;
    Object.assign(style.sources, {
      [ID + 'zone']: { type: 'geojson', data: this.#zoneData() },
      [ID + 'wall']: { type: 'geojson', data: ringWall(c, r) },
      [ID + 'pts']: { type: 'geojson', data: this.#pts },
      [ID + 'hex']: { type: 'geojson', data: this.#hex }
    });
    const zone = ['==', ['geometry-type'], 'Polygon'];
    style.layers.push(
      { id: ID + 'zone-fill', type: 'fill', source: ID + 'zone', filter: zone, paint: { 'fill-color': '#a3e68a', 'fill-opacity': density ? 0.05 : 0.1 } },
      { id: ID + 'zone-shadow', type: 'line', source: ID + 'zone', filter: zone, paint: { 'line-color': '#000000', 'line-width': 5, 'line-opacity': 0.3, 'line-blur': 2 } },
      { id: ID + 'zone-line', type: 'line', source: ID + 'zone', filter: zone, layout: { 'line-join': 'round' }, paint: { 'line-color': '#a3e68a', 'line-width': 3 } },
      // The wall: translucent, lighter at its foot; its rim, a band of light on top.
      { id: ID + 'wall', type: 'fill-extrusion', source: ID + 'wall',
        paint: { 'fill-extrusion-color': '#a3e68a', 'fill-extrusion-height': h, 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.35, 'fill-extrusion-vertical-gradient': true } },
      { id: ID + 'wall-rim', type: 'fill-extrusion', source: ID + 'wall',
        paint: { 'fill-extrusion-color': '#f2ffe6', 'fill-extrusion-height': h, 'fill-extrusion-base': Math.round(h * 0.93), 'fill-extrusion-opacity': 0.75, 'fill-extrusion-vertical-gradient': false } },
      { id: ID + 'centre', type: 'circle', source: ID + 'zone', filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 5, 'circle-color': '#ffffff', 'circle-stroke-color': '#2f6b3a', 'circle-stroke-width': 2.5, 'circle-pitch-alignment': 'map' } }
    );
    if (density) {
      const top = Math.max(30, r * 0.18);
      style.layers.push({ id: ID + 'hex', type: 'fill-extrusion', source: ID + 'hex',
        paint: {
          'fill-extrusion-color': ['interpolate', ['linear'], ['get', 't'], 0, '#cfe8b8', 0.35, '#7cc25b', 0.7, '#2f6b3a', 1, '#f5c542'],
          'fill-extrusion-height': ['+', top * 0.03, ['*', top, ['get', 't']]], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.85,
          'fill-extrusion-vertical-gradient': true
        } });
    } else {
      // The points not shown as markers: seeds on the ground, an observation's green whatever its source (the user's plants gold).
      style.layers.push({ id: ID + 'seeds', type: 'circle', source: ID + 'pts',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2, 14, 3.5, 18, 5],
          'circle-color': ['case', ['get', 'hl'], '#e0245e', ['match', ['get', 'k'], 'mine', SEED.mine, SEED.obs]],
          'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.2, 'circle-pitch-alignment': 'map',
          'circle-opacity': ['case', ['boolean', ['feature-state', 'dom'], false], 0, 0.95],
          'circle-stroke-opacity': ['case', ['boolean', ['feature-state', 'dom'], false], 0, 0.95]
        } });
    }
  }

  // ── The markers: the nearest groups ─────────────────────────────────────────────────────────────

  #listen() {
    const map = this.map;
    map.on('move', () => this.#queueLayout());
    map.on('moveend', () => this.#layout());
    map.on('idle', () => this.#layout());
    map.on('pitch', () => this.#tilt());
    map.on('movestart', (/** @type {any} */ e) => { if (e.originalEvent) this.#hideCard(); });
    // A hand on the map: the flight's turn is off.
    for (const type of ['mousedown', 'touchstart', 'wheel']) map.getCanvasContainer().addEventListener(type, () => { this.#flight++; }, { passive: true });
    // The style made again (gf-map-gl.js#restyle): the points' state is new, the markers' seeds hidden again.
    let restated = false;
    map.on('styledata', () => {
      if (restated || !this.#shown.size) return;
      restated = true;
      requestAnimationFrame(() => {
        restated = false;
        if (!this.#alive || !map.getSource(ID + 'pts')) return;
        for (const i of this.#shown) map.setFeatureState({ source: ID + 'pts', id: i }, { dom: true });
      });
    });
    // Close enough for gf-map to show the user's plants itself (or no longer): they leave the points (or come back).
    map.on('moveend', () => { const close = this.lf.getZoom() >= (this.host.plantZoom ?? 16); if (close !== this.#close && this.prefs.on) { this.#merge(); this.#layout(); } });
    map.on('click', (/** @type {any} */ e) => {
      if (!this.prefs.on) return;
      if (this.prefs.density && map.getLayer(ID + 'hex')) {
        const f = map.queryRenderedFeatures(e.point, { layers: [ID + 'hex'] })[0];
        if (f) { this.#hexCard(f, e.point); return; }
      }
      this.#hideCard();
    });
    this.#tilt();
    // The point card (a long press, a search result): the centre goes there.
    this.host.addEventListener('point-info', this.#onPoint);
  }

  /** @param {any} e */
  #onPoint = e => {
    if (!this.prefs.on || this.host.area?.center) return;
    this.#picked = e.detail?.coordinates || null;
    this.#moveCenter();
  };

  /** How tilted the view is (0 from above, 1 at 50° and more): the stems' height. */
  #tilt() {
    const t = Math.min(1, Math.max(0, (this.map.getPitch() - 5) / 45));
    this.box.style.setProperty('--gf-tilt', t.toFixed(3));
  }

  #queueLayout() {
    if (this.#layoutQueued) return;
    this.#layoutQueued = true;
    requestAnimationFrame(() => {
      this.#layoutQueued = false;
      if (performance.now() - this.#lastLayout >= LAYOUT_EVERY) this.#layout();
      else this.#queueLayout();
    });
  }

  /**
   * The points on the screen grouped (the nearest first: lowest on the screen of a tilted view, the plant lit before
   * all), the first groups as markers, the others left to their seeds.
   */
  #layout() {
    if (!this.#alive) return;
    this.#lastLayout = performance.now();
    const map = this.map;
    if (!this.prefs.on || this.prefs.density || !this.#points.length) { this.#clearMarks(); return; }
    const canvas = map.getCanvas(), W = canvas.clientWidth, H = canvas.clientHeight;
    const tilted = map.getPitch() > 8;
    /** @type {{ i: number, x: number, y: number, lit: boolean, photo: boolean }[]} */
    const seen = [];
    for (const [i, p] of this.#points.entries()) {
      const s = map.project(p.coordinates);
      if (!(s.x > -30 && s.x < W + 30 && s.y > -40 && s.y < H + 30)) continue;
      seen.push({ i, x: s.x, y: s.y, lit: this.#isLit(p), photo: Boolean(p.photo) });
    }
    seen.sort((a, b) => Number(b.lit) - Number(a.lit) || (tilted ? b.y - a.y : 0) || Number(b.photo) - Number(a.photo) || a.i - b.i);
    // Greedy groups on a grid of GROUP_PX cells: a point joins the group whose head is within GROUP_PX (a lit point never joins another's).
    /** @type {{ head: typeof seen[0], members: number[] }[]} */
    const groups = [];
    /** @type {Map<string, number[]>} */
    const grid = new Map();
    const cell = (/** @type {number} */ x, /** @type {number} */ y) => Math.floor(x / GROUP_PX) + ',' + Math.floor(y / GROUP_PX);
    for (const s of seen) {
      let joined = -1;
      // Further away (smaller), closer together before they are one.
      const near = GROUP_PX * (tilted ? Math.min(1.1, Math.max(0.62, 0.55 + 0.6 * s.y / H)) : 1);
      if (!s.lit) {
        const cx = Math.floor(s.x / GROUP_PX), cy = Math.floor(s.y / GROUP_PX);
        for (let dx = -1; dx <= 1 && joined < 0; dx++) for (let dy = -1; dy <= 1 && joined < 0; dy++) {
          for (const g of grid.get((cx + dx) + ',' + (cy + dy)) || []) {
            const h = groups[g].head;
            if (!h.lit && Math.hypot(h.x - s.x, h.y - s.y) < near) { joined = g; break; }
          }
        }
      }
      if (joined >= 0) groups[joined].members.push(s.i);
      else {
        const key = cell(s.x, s.y);
        grid.set(key, [...(grid.get(key) || []), groups.length]);
        groups.push({ head: s, members: [s.i] });
      }
    }
    const max = this.#phone ? DOM_PHONE : DOM_WIDE;
    const chosen = groups.slice(0, max);
    // The seeds of the points now shown as markers hidden, the others shown again (only those that change).
    const shown = new Set(chosen.flatMap(g => g.members));
    const source = map.getSource(ID + 'pts') ? ID + 'pts' : null;
    if (source) {
      for (const i of this.#shown) if (!shown.has(i)) map.setFeatureState({ source, id: i }, { dom: false });
      for (const i of shown) if (!this.#shown.has(i)) map.setFeatureState({ source, id: i }, { dom: true });
    }
    this.#shown = shown;
    /** @type {Set<string>} */
    const keep = new Set();
    for (const [rank, g] of chosen.entries()) {
      const head = this.#points[g.head.i];
      const key = (g.members.length > 1 ? 'g:' : 'p:') + head.id;
      keep.add(key);
      const sig = (g.members.length > 1 ? 'g' + g.members.length + ':' + g.members.slice(0, 3).join(',') : 'p' + (g.head.lit ? 'hl' : '')) + '#' + this.#photoGen;
      let m = this.#marks.get(key);
      if (!m) m = this.#mark(key, head);
      if (m.sig !== sig) this.#fill(m, g.members, g.head.lit, sig);
      m.members = g.members;
      // Nearer, over; smaller further away (in a tilted view).
      const scale = tilted ? Math.min(1.1, Math.max(0.62, 0.55 + 0.6 * g.head.y / H)) : 1;
      m.el.style.setProperty('--s', scale.toFixed(2));
      m.el.style.zIndex = String((g.head.lit ? 100000 : 0) + Math.round(tilted ? g.head.y : max - rank));
    }
    for (const [key, m] of this.#marks) if (!keep.has(key)) this.#dropMark(key, m);
  }

  /** A marker: an element standing on the ground (a foot, a stem, the head). @param {string} key @param {Obs3d} head @returns {Mark} */
  #mark(key, head) {
    const el = elem('div', 'gf-o3-mk');
    el.append(elem('span', 'gf-o3-foot'), elem('span', 'gf-o3-stem'), elem('div', 'gf-o3-head'));
    el.addEventListener('mousedown', e => e.stopPropagation());
    el.addEventListener('click', e => { e.stopPropagation(); this.#touch(m, true); });
    el.addEventListener('mouseenter', () => { if (!this.#cardPinned && !matchMedia('(hover: none)').matches) this.#touch(m, false); });
    el.addEventListener('mouseleave', () => { if (!this.#cardPinned) this.#hideCard(); });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.#touch(m, true); } });
    const gl = new this.ml.Marker({ element: el, anchor: 'center', opacityWhenCovered: '0.3', subpixelPositioning: true }).setLngLat(head.coordinates).addTo(this.map);
    /** @type {Mark} */
    const m = { key, gl, el, sig: '', members: [] };
    this.#marks.set(key, m);
    return m;
  }

  /** Its look: a point (its photo, its leaf; the plant lit in its ring), or a group (a stack of photos, its count). @param {Mark} m @param {number[]} members @param {boolean} lit @param {string} sig */
  #fill(m, members, lit, sig) {
    m.sig = sig;
    const head = /** @type {HTMLElement} */ (m.el.querySelector('.gf-o3-head'));
    cancelImages(head);
    head.replaceChildren();
    const pts = members.map(i => this.#points[i]);
    const first = pts[0];
    m.el.classList.toggle('lit', lit);
    m.el.classList.toggle('group', pts.length > 1);
    m.el.classList.toggle('mine', first.kind === 'mine');
    m.el.tabIndex = 0;
    m.el.setAttribute('role', 'button');
    if (pts.length === 1) {
      const spec = lit ? chosenMarker(first.photo, 0, 40) : first.photo ? photoMarker(first.photo, 0) : leafMarker(0);
      head.append(wrap(spec));
      for (const img of head.querySelectorAll('img')) img.loading = 'eager';
      m.el.setAttribute('aria-label', `${first.title}${first.date ? ', ' + new Date(first.date).toLocaleDateString('fr-FR') : ''}`);
    } else {
      // A stack: up to three photos of the group (those with a photo first), fanned, its count on top.
      const faces = [...pts.filter(p => p.photo), ...pts.filter(p => !p.photo)].slice(0, 3).reverse();
      const stack = elem('span', 'gf-o3-stack');
      for (const [i, p] of faces.entries()) {
        const face = wrap(p.photo ? photoMarker(p.photo, 0) : leafMarker(0));
        face.classList.add('gf-o3-face', 'f' + (faces.length - 1 - i));
        stack.append(face);
      }
      stack.append(elem('b', 'gf-o3-n', pts.length > 999 ? Math.round(pts.length / 1000) + 'k' : String(pts.length)));
      head.append(stack);
      // Only the markers on the screen are made: their photos at once (not lazy: under a transform, never « near the view »).
      for (const img of stack.querySelectorAll('img')) img.loading = 'eager';
      m.el.setAttribute('aria-label', `${pts.length} observations ici : ${[...new Set(pts.map(p => p.title))].slice(0, 3).join(', ')}`);
    }
  }

  /** @param {string} key @param {Mark} m */
  #dropMark(key, m) {
    cancelImages(m.el);
    m.gl.remove();
    this.#marks.delete(key);
    if (this.#card && this.#cardFor === key) this.#hideCard();
  }

  #clearMarks() {
    for (const [key, m] of [...this.#marks]) this.#dropMark(key, m);
    const source = this.map.getSource(ID + 'pts') ? ID + 'pts' : null;
    if (source) for (const i of this.#shown) this.map.setFeatureState({ source, id: i }, { dom: false });
    this.#shown = new Set();
  }

  // ── A point touched: its card ───────────────────────────────────────────────────────────────────

  #cardFor = '';

  /** A marker hovered (`pin` false) or touched. @param {Mark} m @param {boolean} pin */
  #touch(m, pin) {
    const pts = m.members.map(i => this.#points[i]);
    const first = pts[0];
    if (!first) return;
    if (pin && pts.length === 1 && first.kind === 'mine' && first.plant) {
      this.host.dispatchEvent(new CustomEvent('plant-select', { detail: first.plant, bubbles: true, composed: true }));
      return;
    }
    // A group touched, from afar: closer to it.
    if (pin && pts.length > 1 && this.map.getZoom() < 16.5) {
      this.#hideCard();
      this.map.easeTo({ center: first.coordinates, zoom: Math.min(17, this.map.getZoom() + 2), duration: reduceMotion() ? 0 : 600 }, { gfObs: true });
      return;
    }
    const card = obsCard(first);
    card.classList.add(first.kind);
    if (pts.length > 1) {
      const others = [...new Set(pts.slice(1).map(p => p.title))];
      card.querySelector('.t')?.append(elem('small', 'gf-o3-more', `Et ${pts.length - 1} autre${pts.length > 2 ? 's' : ''} ici : ${others.slice(0, 4).join(', ')}${others.length > 4 ? '…' : ''}`));
    }
    const head = /** @type {HTMLElement} */ (m.el.querySelector('.gf-o3-head'));
    this.#showCard(card, head.getBoundingClientRect(), pin);
    this.#cardFor = m.key;
  }

  /** A column of the density touched: how many, the plants most seen. @param {any} f @param {{ x: number, y: number }} at */
  #hexCard(f, at) {
    const card = elem('div', 'gf-obs-card gf-o3-hexcard'), t = elem('div', 't');
    const n = Number(f.properties.n) || 0;
    t.append(elem('b', '', `${n} observation${n > 1 ? 's' : ''} ici`));
    if (f.properties.top) t.append(elem('small', '', 'Surtout : ' + f.properties.top));
    card.append(t);
    const box = this.box.getBoundingClientRect();
    this.#showCard(card, new DOMRect(box.left + at.x, box.top + at.y, 0, 0), true);
    this.#cardFor = 'hex';
  }

  /** @param {HTMLElement} content @param {DOMRect} near @param {boolean} pin */
  #showCard(content, near, pin) {
    this.#hideCard();
    const card = this.#card = elem('div', 'gf-o3-card' + (pin ? ' pinned' : ''));
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Observation');
    card.append(content);
    if (pin) {
      const close = Object.assign(document.createElement('button'), { type: 'button', className: 'gf-o3-close' });
      close.setAttribute('aria-label', 'Fermer');
      // eslint-disable-next-line no-unsanitized/property -- a bundled icon, no data in it
      close.innerHTML = iconMarkup('x-lg');
      close.addEventListener('click', e => { e.stopPropagation(); this.#hideCard(); });
      card.append(close);
    }
    for (const type of ['mousedown', 'touchstart', 'wheel', 'click']) card.addEventListener(type, e => e.stopPropagation());
    this.box.append(card);
    this.#cardPinned = pin;
    // Above the point, in the map (below it when there is no room above) — never under what lies over the map's top
    // (the Carte's search pill: a card there could not be closed on a phone).
    const box = this.box.getBoundingClientRect(), w = card.offsetWidth, h = card.offsetHeight;
    const top = this.#topInset(box);
    const x = Math.min(box.width - w - 8, Math.max(8, near.left + near.width / 2 - box.left - w / 2));
    let y = near.top - box.top - h - 10;
    if (y < top) y = Math.min(box.height - h - 8, near.bottom - box.top + 10);
    card.style.left = Math.round(x) + 'px';
    card.style.top = Math.round(Math.max(top, y)) + 'px';
    if (pin) /** @type {HTMLElement | null} */ (card.querySelector('.gf-o3-close'))?.focus({ preventScroll: true });
  }

  /** Where a card may start, from the map's top: below the search pill when the map has one. @param {DOMRect} box */
  #topInset(box) {
    const pill = /** @type {HTMLElement | null} */ (this.host.querySelector?.('.gf-map-search'));
    const r = pill && pill.offsetParent ? pill.getBoundingClientRect() : null;
    return r && r.height ? Math.max(8, Math.round(r.bottom - box.top + 8)) : 8;
  }

  #hideCard() {
    if (this.#card) cancelImages(this.#card);
    this.#card?.remove();
    this.#card = null;
    this.#cardPinned = false;
    this.#cardFor = '';
  }

  // ── Its end, and what it says (tests) ───────────────────────────────────────────────────────────

  destroy() {
    this.#alive = false;
    this.#abort?.abort();
    clearTimeout(this.#loadTimer);
    this.host.removeEventListener('point-info', this.#onPoint);
    for (const [key, m] of [...this.#marks]) this.#dropMark(key, m);
    this.#hideCard();
    this.#button?.remove();
    this.#bar?.remove();
  }

  state() {
    const by = (/** @type {string} */ k) => this.#points.filter(p => p.kind === k).length, c = this.center;
    const pictured = (/** @type {string} */ k) => this.#points.filter(p => p.kind === k && p.photo).length;
    return {
      on: this.prefs.on, scope: this.scope, center: this.center, why: this.why, radius: this.prefs.radius, loading: this.#loading,
      sources: { inat: this.prefs.inat, gbif: this.prefs.gbif }, density: this.prefs.density, failed: this.#failed,
      points: this.#points.length, kinds: { inat: by('inat'), gbif: by('gbif'), mine: by('mine') }, totals: this.#totals,
      photos: { inat: pictured('inat'), gbif: pictured('gbif'), mine: pictured('mine') },
      // Each plant's photo and name on its points, by source (one plant, one photo, whatever the source).
      plants: Object.fromEntries(['inat', 'gbif'].map(k => [k, Object.fromEntries(this.#points.filter(p => p.kind === k).map(p => [p.sci, { photo: p.photo, common: p.common }]))])),
      farthest: c ? Math.round(Math.max(0, ...this.#points.map(p => metres(c, p.coordinates)))) : null,
      markers: this.#marks.size, onMarkers: this.#shown.size, seeds: this.#points.length - this.#shown.size, hexes: this.#hex.features.length,
      lit: [...this.#lit]
    };
  }
}

/** A marker of the map style (map-style.js) in its element: its classes, its size. @param {import('./map-style.js').MarkerSpec} spec */
function wrap(spec) {
  const el = elem('span', spec.className);
  el.style.width = spec.size[0] + 'px';
  el.style.height = spec.size[1] + 'px';
  el.append(spec.html);
  return el;
}
