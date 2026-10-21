// @ts-check
// Rencontres' map while discovering (kit/ma-guided.js), the column on the left: the circle and the observations in it.
//  - First (`asking`, the step « map »): its panel, how far (the slider), a few faces of what was seen around (their
//    count said by the map, not written) and « Qui pousse par ici ? » — the event map-launch;
//  - then the perimeter in one panel over the map (under it on a phone): the distance and its slider; after a match,
//    « Où pousse-t-elle encore ? » — the circle, the département, the région, France, the world: the map eases there,
//    the outline drawn —; the place to change; and the plant in view (the card on top), lit on the map where it was
//    observed in that perimeter, its observations counted (said by the map, not written). Rencontres' own step
//    (`quiet`): the circle and its distance only.
//  - Later (`listed`), the plants around under it: a touch, or a point of the map touched, brings the plant on top of
//    the deck — the event around-pick (detail.id); one that is not among the cards: a brief toast over the map.

import { LitElement, html, css, nothing, repeat } from 'lit';
import { icon } from '../../core/icons.js';
import { observationsAround, observationsInBox } from '../../core/nearby.js';
import { addressAt, adminShape } from '../../core/geoservices.js';
import { FRANCE_BOUNDS, WORLD_BOUNDS } from '../../core/ign.js';
import { REGION_BOUNDS, regionOf } from '../../core/regions.js';
import { bundledOutline, territoryAt } from '../../core/territory.js';
import { discoverState } from '../../core/discover.js';
import { hideImg, showImg } from '../../core/img.js';
import { creditText } from '../../core/credit.js';
import { moduleOn } from '../../core/modules.js';
import { StoreController } from '../../core/store.js';
import { ui } from '../../styles/ui.js';
import { DISTANCES, distanceAt, distanceEvents, distLabel, distMood, nameOf } from './cards.js';
import { commonOf } from '../../core/plants.js';
import '../../components/gf-map.js';

/**
 * @typedef {import('./cards.js').Card} Card
 * @typedef {import('./session.js').AroundSession} AroundSession
 * @typedef {'around' | 'department' | 'region' | 'country' | 'world'} Scope
 * @typedef {[number, number, number, number]} Box
 * @typedef {{ coordinates: [number, number], title: string, url?: string, date?: string | null }} HlPoint
 * @typedef {{ key: string, scope: Scope, box?: Box, photo: string | null, credit: import('../../core/credit.js').Credit | null, common: string | null,
 *   sci: string, taxonId: number | null, points: HlPoint[], total: number }} Highlight
 * @typedef {{ feature: any, box: Box }} Outline
 */

/** Past this many points, a map groups them. */
const MANY = 250;

/** The box [west, south, east, north] of a GeoJSON polygon or multipolygon. @param {any} geometry @returns {Box} */
function boxOf(geometry) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of geometry.coordinates.flat(geometry.type === 'MultiPolygon' ? 2 : 1)) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

export class MaAroundMap extends LitElement {
  static properties = {
    app: { attribute: false },
    /** The app's context (the place, the distance). */
    c: { attribute: false },
    session: { attribute: false },
    /** The step « map »: its panel, the way to the cards. */
    asking: { type: Boolean, reflect: true },
    /** Rencontres' own step: the circle and its distance only. */
    quiet: { type: Boolean },
    /** After a match, from the photos on: « Où pousse-t-elle encore ? ». */
    scopes: { type: Boolean },
    /** The plants around, under the map. */
    listed: { type: Boolean },
    /** The plant in view (the card on top; while the cards reload, the one before). */
    card: { attribute: false },
    /** The plant of the moment's id (the card on top). */
    focusId: { attribute: false },
    /** Where else the plant in view grows: the zone chosen. */
    _scope: { state: true },
    /** The département and région of the place (their names and outlines). */
    _admin: { state: true },
    /** On the map: where the plant in view was observed in the perimeter. */
    _hl: { state: true }
  };

  static styles = [ui, css`
    :host { position: relative; }
    .g-mapbox { position: relative; flex: 1; min-height: 0; isolation: isolate; }
    .g-mapbox gf-map { position: absolute; inset: 0; display: block; }
    .g-mapbox gf-map .leaflet-container { background: #2f4a2c; }
    /* The panel says the distance: the map's scale would say it again. */
    .g-mapbox gf-map .leaflet-control-scale { display: none; }
    /* The perimeter: one panel over the map (under it on a phone) — the zones, the circle's slider, the place, the
       plant in view and its count. No backdrop blur: the map moves under it. */
    .g-where { position: absolute; z-index: 500; left: 10px; right: 50px; top: 10px; display: grid; gap: 6px; padding: 7px 7px 8px 10px; border-radius: 14px;
      background: color-mix(in srgb, var(--gf-surface) 95%, transparent); box-shadow: var(--gf-shadow); font-size: 0.8rem; animation: g-drop 0.3s ease-out; }
    @keyframes g-drop { from { opacity: 0; transform: translateY(-8px); } }
    .g-where .top { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .g-where .top > .d { font-size: 1rem; font-weight: 800; color: var(--gf-accent); font-variant-numeric: tabular-nums; }
    .g-where .mood { min-width: 0; font-size: 0.78rem; color: var(--gf-text-muted); font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .g-where .top > .mood { flex: 1; }
    .g-where .place { flex: none; margin-left: auto; width: 32px; height: 32px; min-height: 0; }
    .g-radius { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .g-radius .mood { flex: none; max-width: 45%; }
    .g-radius input { flex: 1; min-width: 0; margin: 0; accent-color: var(--gf-accent); }
    /* The first map: its panel, the way to the cards. */
    .g-launch { position: absolute; z-index: 500; right: 16px; bottom: 28px; width: min(400px, calc(100% - 32px)); box-sizing: border-box; display: grid; gap: 10px; padding: 16px 18px;
      border-radius: 18px; background: color-mix(in srgb, var(--gf-surface) 95%, transparent); box-shadow: 0 12px 36px rgb(0 0 0 / 28%); backdrop-filter: blur(8px); animation: g-up 0.35s ease-out; }
    @keyframes g-up { from { opacity: 0; transform: translateY(16px); } }
    .g-launch h2 { margin: 0; font-size: 1.15rem; display: flex; align-items: center; gap: 8px; }
    .g-launch h2 .bi { color: var(--gf-accent); }
    .g-launch .where { margin: -4px 0 0; font-size: 0.85rem; color: var(--gf-text-muted); }
    .g-launch .where .link { font-size: inherit; padding: 0; min-height: 0; }
    .g-launch .g-dist { display: grid; grid-template-columns: auto 1fr; align-items: baseline; gap: 0 10px; }
    .g-launch .d { font-size: 1.5rem; font-weight: 800; color: var(--gf-accent); font-variant-numeric: tabular-nums; }
    .g-launch .mood { justify-self: start; font-size: 0.85rem; color: var(--gf-text-muted); font-style: italic; }
    .g-launch input { grid-column: 1 / -1; width: 100%; margin: 4px 0 0; accent-color: var(--gf-accent); }
    .g-launch .g-seen { display: flex; align-items: center; gap: 10px; font-size: 0.86rem; color: var(--gf-text); min-height: 34px; }
    .g-launch .faces { display: flex; flex: none; }
    .g-launch .faces img { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; border: 2px solid var(--gf-surface); margin-left: -8px; background: var(--gf-surface-2); }
    .g-launch .faces img:first-child { margin-left: 0; }
    .g-launch .go { min-height: 54px; display: grid; justify-items: center; gap: 0; font-size: 1.08rem; padding: 8px 16px; border-radius: 16px; }
    .g-launch .go .bi { display: none; }
    .g-launch .go small { font-size: 0.75rem; font-weight: 400; opacity: 0.85; }
    /* After a match: where else it grows — the zones, the one shown in green (the colour of its outline on the map). */
    .g-scope { flex: 1; min-width: 0; display: flex; align-items: center; gap: 4px; overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain;
      mask-image: linear-gradient(to right, #000 calc(100% - 18px), transparent); padding-right: 14px; scroll-padding-inline: 8px 22px; }
    .g-scope::-webkit-scrollbar { display: none; }
    /* With a mouse (no swipe), every zone in sight: the row wraps. */
    @media (hover: hover) and (pointer: fine) { .g-scope { flex-wrap: wrap; overflow: visible; mask-image: none; padding-right: 0; } .g-where .top:has(.g-scope) { align-items: flex-start; } }
    .g-scope button { flex: none; }
    .g-scope button { min-height: 0; height: 26px; padding: 0 10px; display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-pill);
      background: var(--gf-surface); color: var(--gf-text); font: inherit; font-size: 0.78rem; cursor: pointer; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .g-scope button[aria-pressed='true'] { background: var(--gf-accent); border-color: var(--gf-accent); color: var(--gf-accent-contrast, #fff); font-weight: 700; }
    /* The plants around (step 4), under the map: their thumbnails, a touch shows one in the panes. */
    .around { flex: 0 0 45%; width: auto; border-top: 1px solid var(--gf-border); display: flex; flex-direction: column; min-height: 0; background: var(--gf-surface); }
    .around h2 { margin: 0; padding: 10px 12px 6px; font-size: 0.95rem; display: flex; justify-content: space-between; align-items: center; gap: 6px; }
    .around ul { list-style: none; margin: 0; padding: 0 6px 10px; overflow-y: auto; flex: 1; min-height: 0; }
    .around li button { width: 100%; display: grid; grid-template-columns: 44px 1fr; gap: 8px; align-items: center; padding: 5px 6px; border: 0; border-radius: var(--gf-radius-sm); background: none; font: inherit; text-align: left; cursor: pointer; color: var(--gf-text); }
    .around li button:hover { background: var(--gf-surface-2); }
    .around li button[aria-current='true'] { background: var(--gf-accent-soft); }
    .around .th { width: 44px; height: 44px; border-radius: 8px; overflow: hidden; background: var(--gf-surface-2); }
    .around .th img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .around .t { display: grid; min-width: 0; line-height: 1.2; }
    .around .t b { font-size: 0.86rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .around .t small { font-size: 0.74rem; color: var(--gf-text-muted); }
    @media (max-width: 899px) {
      .g-where { position: static; animation: none; border-radius: 0; box-shadow: none; border-bottom: 1px solid var(--gf-border); background: var(--gf-surface); padding: 6px 10px; }
      .g-launch { left: 10px; right: 10px; bottom: 12px; bottom: 12px; width: auto; padding: 12px 14px; gap: 8px; } .g-launch h2 { font-size: 1.02rem; }
      /* A phone: the blocks one under the other, scrolled. */
      .g-mapbox { flex: none; height: 26dvh; min-height: 180px; }
      .around { flex: none; max-height: 40dvh; }
      :host([asking]) .g-mapbox { flex: 1; height: auto; }
    }
    @media (prefers-reduced-motion: reduce) { .around, .g-where { transition: none; animation: none; } }
  `];

  #store = new StoreController(this);

  constructor() {
    super();
    /** @type {import('../runtime.js').MiniApp | null} */
    this.app = null;
    /** @type {Record<string, any> | null} */
    this.c = null;
    /** @type {AroundSession | null} */
    this.session = null;
    this.asking = false;
    this.quiet = false;
    this.scopes = false;
    this.listed = false;
    /** @type {Card | undefined} */
    this.card = undefined;
    /** @type {number | null} */
    this.focusId = null;
    /** @type {Scope} */
    this._scope = 'around';
    /** @type {{ department: string | null, region: string | null, shapes: Record<string, Outline | null> } | null} */
    this._admin = null;
    /** @type {Highlight | null} */
    this._hl = null;
  }

  connectedCallback() {
    super.connectedCallback();
    // The discovery screens: no zone alerts on their maps (gf-map).
    this.setAttribute('no-areas', '');
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#watched?.removeEventListener('change', this.#onChange);
    this.#watched = null;
  }

  #onChange = () => this.requestUpdate();
  /** @type {EventTarget | null} */ #watched = null;

  /** The map's view held while its column changes width (a separator dragged beside it). */
  holdFrame() { /** @type {any} */ (this.renderRoot.querySelector('gf-map'))?.holdFrame?.(); }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    // The session's news (the observations, the cards): drawn again.
    if (this.session !== this.#watched) {
      this.#watched?.removeEventListener('change', this.#onChange);
      this.#watched = this.session;
      this.#watched?.addEventListener('change', this.#onChange);
    }
    // The distance changed: the map's observations follow (a moment after the slider stops).
    this.session?.watchPoints();
    // Another place: its own département and région (found again for this point), never the last place's meanwhile.
    if (changed.has('c') && changed.get('c') && changed.get('c').point !== this.c?.point) { this._admin = null; this.#adminFor = ''; }
  }

  updated() {
    this.#say();
    this.#showScope();
    // The plant in view lit on the map (where it was seen in the perimeter).
    const c = this.c;
    const id = this.focusId;
    if (id != null) this.#findAdmin();
    const scope = this.#scopeNow;
    // Its département or région by name: another place (its own, once known) loads again.
    const where = scope === 'department' || scope === 'region' ? this._admin?.[scope] ?? '?' : '';
    const key = id == null || !c?.point ? '' : `${id}:${c.radius}:${c.point}:${scope}:${where}`;
    if (key === this.#hlFor) return;
    this.#hlFor = key;
    // Another plant: its leaves come (the old ones go); another scope of the same plant: the map stays until its
    // observations are in (no empty map in between). Back to the circle (from another scope, or another step):
    // never the wider scope's groups meanwhile.
    if (!this._hl || !key || !this._hl.key.startsWith(id + ':') || (scope === 'around' && this._hl.scope !== 'around')) this._hl = null;
    const card = key ? (this.session?.cards || []).find(x => x.plant.id === id) : null;
    if (!card?.taxonId) { this._hl = null; return; }
    this.#loadHighlight(key, card, scope);
  }
  #hlFor = '';

  /** A plant's photo, unless the « Photos en ligne » module is off in this view (a leaf shows instead). @param {string | null | undefined} url */
  #photo(url) { return url && moduleOn('photos', this.#store.state.mode) ? url : null; }

  /** The zone chosen, in sight in its row (scrolled sideways on a touch screen): a row drawn again starts at its left. */
  #showScope() {
    const row = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.g-scope'));
    if (!row || (row === this.#scopeRow && this._scope === this.#scopeRowFor)) return;
    this.#scopeRow = row;
    this.#scopeRowFor = this._scope;
    const chip = row.querySelector('[aria-pressed="true"]');
    if (!chip || row.scrollWidth <= row.clientWidth) return;
    const r = row.getBoundingClientRect(), b = chip.getBoundingClientRect();
    // Its right end clear of the row's fading edge.
    if (b.left < r.left || b.right > r.right - 18) row.scrollLeft += b.left - r.left - 8;
  }
  /** @type {HTMLElement | null} */ #scopeRow = null;
  #scopeRowFor = '';

  /** The scope shown for the plant in view: chosen after a match (its scope bar), else the circle. @returns {Scope} */
  get #scopeNow() {
    // From the first match on: the scope chosen, for the card in view — from the Photos step on (the Carte and
    // Rencontres steps are only the map around you, the place and the cards).
    return this.focusId != null && discoverState().firstMatch && this.scopes ? this._scope : 'around';
  }

  /**
   * The département and région of the place chosen (from its IGN address), once; offline (IGN unreachable or its
   * module off), from the outlines the app carries.
   */
  async #findAdmin() {
    const point = this.c?.point;
    if (!point || this.#adminFor === point.join()) return;
    this.#adminFor = point.join();
    const a = await addressAt(point).catch(() => null);
    const parts = String(a?.context || '').split(',').map(x => x.trim()).filter(Boolean);
    let department = parts.length >= 3 ? parts[1] : null, region = regionOf(a?.context || '')?.name || null;
    if (!department || !region) {
      const t = await territoryAt(point).catch(() => null);
      department ||= t?.deptName || null;
      region ||= t?.regionName || null;
    }
    if (this.c?.point !== point) return;
    this._admin = { department, region, shapes: {} };
  }
  #adminFor = '';

  /**
   * The outline of the département or région — IGN's, else the one the app carries (simplified) —, and its box;
   * kept once asked. @param {'department' | 'region'} scope @returns {Promise<Outline | null>}
   */
  async #adminOutline(scope) {
    const admin = this._admin;
    const name = admin?.[scope];
    if (!admin || !name) return null;
    if (!(scope in admin.shapes)) {
      const shape = await adminShape(scope === 'department' ? 'departement' : 'region', name).catch(() => null);
      admin.shapes[scope] = shape ? { feature: shape, box: boxOf(shape.geometry) } : await bundledOutline(scope, name).catch(() => null);
    }
    return admin.shapes[scope] ?? null;
  }

  /** France's outline (the app carries it), drawn when its scope is chosen. @type {Outline | null} */
  #france = null;
  #franceAsked = false;
  #loadFrance() {
    if (this.#franceAsked) return;
    this.#franceAsked = true;
    bundledOutline('country').then(o => { this.#france = o; this.requestUpdate(); }, () => { this.#franceAsked = false; });
  }

  /** The box of a scope [west, south, east, north]. @param {Scope} scope @returns {Promise<Box | null>} */
  async #scopeBox(scope) {
    if (scope === 'country') return [FRANCE_BOUNDS.getWest(), FRANCE_BOUNDS.getSouth(), FRANCE_BOUNDS.getEast(), FRANCE_BOUNDS.getNorth()];
    if (scope === 'world') return [WORLD_BOUNDS.getWest(), WORLD_BOUNDS.getSouth(), WORLD_BOUNDS.getEast(), WORLD_BOUNDS.getNorth()];
    if (scope === 'around') return null;
    const shape = await this.#adminOutline(scope);
    if (shape) return shape.box;
    // No outline at all: the région's box, if known.
    return scope === 'region' && this._admin?.region ? REGION_BOUNDS[this._admin.region] || null : null;
  }

  /**
   * Where the plant in view was seen, in its scope: the circle, or a département, a région, France, the world — each
   * point with its date, the plant's photo and names for the map to show on them.
   * @param {string} key @param {Card} card @param {Scope} scope
   */
  async #loadHighlight(key, card, scope) {
    const c = /** @type {Record<string, any>} */ (this.c);
    const title = nameOf(card.plant);
    const photo = this.#photo(card.photo) ? /** @type {string} */ (card.photo).replace('/medium.', '/small.') : null;
    const who = { plantId: card.plant.id, photo, credit: photo ? card.credit : null, common: commonOf(card.plant), sci: card.plant.scientificName, taxonId: card.taxonId ?? null };
    const pointsOf = (/** @type {{ coordinates: [number, number], date: string | null, url: string }[]} */ pts) => pts.map(p => ({ coordinates: p.coordinates, title, url: p.url, date: p.date }));
    if (scope === 'around') {
      const pts = await observationsAround(/** @type {number} */ (card.taxonId), c.point, c.radius).catch(() => null);
      if (pts && this.#hlFor === key) this._hl = { key, scope, ...who, points: pointsOf(pts), total: pts.length };
      return;
    }
    const box = await this.#scopeBox(scope);
    if (!box || this.#hlFor !== key) { if (this.#hlFor === key) this._hl = { key, scope, ...who, points: [], total: 0 }; return; }
    const found = await observationsInBox(/** @type {number} */ (card.taxonId), box).catch(() => null);
    if (found && this.#hlFor === key) this._hl = { key, scope, box, ...who, points: pointsOf(found.points), total: found.total };
  }

  /** Rencontres (quiet): the plant in view lit by leaves only, the MANY latest at most — never numbered groups. */
  get #quietHighlight() {
    const hl = this._hl;
    if (!hl || hl.points.length <= MANY) return hl;
    if (this.#qhMemo?.key !== hl.key) this.#qhMemo = { key: hl.key, value: { ...hl, key: hl.key + ':quiet', points: hl.points.slice(0, MANY) } };
    return this.#qhMemo.value;
  }
  /** @type {{ key: string, value: Highlight } | null} */ #qhMemo = null;

  /** The plant's observations in a wider scope, many: grouped (pink and gold: gf-map's `cluster` is one plant's points). */
  get #cluster() {
    const many = this._hl && this._hl.points.length > MANY ? this._hl : null;
    if (!many) return null;
    const key = many.key;
    if (this.#gcMemo?.key === key) return this.#gcMemo.value;
    const value = { key, photo: many.photo, credit: many.credit, common: many.common, sci: many.sci, taxonId: many.taxonId, points: many.points };
    this.#gcMemo = { key, value };
    return value;
  }
  /** @type {{ key: string, value: unknown } | null} */ #gcMemo = null;

  /** The map framed on the scope chosen (eased), once its box is known; back to the circle after. */
  get #scopeFrame() {
    const hl = this._hl, scope = this.#scopeNow, c = /** @type {Record<string, any>} */ (this.c);
    if (scope === 'around') {
      if (!this.#leftAround || !c.point) return null;
      const [lon, lat] = c.point, r = c.radius / 111320, dLon = r / Math.cos(lat * Math.PI / 180);
      return this.#frameMemo('around:' + c.point + ':' + c.radius, [[lon - dLon, lat - r], [lon + dLon, lat + r]]);
    }
    if (!hl?.box || hl.scope !== scope) return this.#lastFrame;
    this.#leftAround = true;
    const [w, s, e, n] = hl.box;
    return this.#frameMemo('scope:' + scope + ':' + hl.box.join(), [[w, s], [e, n]]);
  }
  #leftAround = false;
  /** @type {{ key: string, points: [number, number][], ease: boolean } | null} */ #lastFrame = null;
  /** @param {string} key @param {[number, number][]} points */
  #frameMemo(key, points) {
    if (this.#lastFrame?.key !== key) this.#lastFrame = { key, points, ease: true };
    return this.#lastFrame;
  }

  /** The outline of the scope shown — the département, the région, France —: a perimeter, like the circle. */
  get #scopeZone() {
    const scope = this.#scopeNow;
    if (scope === 'country') this.#loadFrance();
    const shape = scope === 'country' ? this.#france
      : (scope === 'department' || scope === 'region') ? this._admin?.shapes?.[scope] : null;
    const feature = shape?.feature;
    if (!feature) return null;
    if (this.#zoneMemo?.feature !== feature) this.#zoneMemo = { key: scope + ':' + (scope === 'department' || scope === 'region' ? this._admin?.[scope] || '' : ''), feature };
    return this.#zoneMemo;
  }
  /** @type {{ key: string, feature: any } | null} */ #zoneMemo = null;

  /** « 23 observations », « 1 204 observations (1 000 sur la carte) »: where, the perimeter chosen says it. */
  #hlLine() {
    const hl = this._hl;
    if (!hl) return '…';
    const n = hl.total ?? hl.points.length;
    return `${n.toLocaleString('fr-FR')} observation${n > 1 ? 's' : ''}${n > hl.points.length ? ` (${hl.points.length.toLocaleString('fr-FR')} sur la carte)` : ''}`;
  }

  /** The circle and its observations, the same object while they do not change (the map does not redraw them). */
  get #area() {
    const c = /** @type {Record<string, any>} */ (this.c), s = /** @type {AroundSession} */ (this.session);
    const point = c.point, radius = c.radius, obs = s.obs, asking = this.asking;
    const a = this.#areaMemo;
    if (a && a.center === point && a.radius === radius && a.obs === obs && a.asking === asking) return a;
    // The first map's panel (#launch) is over it: the circle framed beside it (above it on a phone).
    const inset = !asking ? undefined : matchMedia('(max-width: 899px)').matches ? { bottom: 250 } : { right: 430 };
    // The 100 latest, each its plant's photo popping in (a small card of the plant on hover).
    return (this.#areaMemo = { center: point, radius, fit: true, leaves: true, points: obs, obs, asking, inset });
  }
  /** @type {any} */ #areaMemo = null;

  /** The map (gf-map: what this panel says goes through it — the quiet-map rule). @returns {any} */
  get #map() { return this.renderRoot.querySelector('gf-map'); }

  /**
   * What was counted, said by the map's one live region rather than written over it: the observations around (the
   * first panel), the plant in view's in the perimeter (its points lit on the map show where). The observations
   * coming: the map's thin line past 400 ms.
   */
  #say() {
    const s = this.session, map = this.#map;
    if (!s || !map) return;
    map.busy('obs', Boolean(this.asking && !s.obs.length && s.obsLoading), 'Les observations arrivent');
    const words = this.asking ? this.#seenLine() : this.card && !this.quiet && this._hl ? `${nameOf(this.card.plant)} : ${this.#hlLine()}` : '';
    if (words && words !== this.#said) map.announce(words);
    this.#said = words;
  }
  #said = '';

  /** « 230 observations de plantes, 12 espèces différentes — les 100 plus récentes sur la carte » ('' before any). */
  #seenLine() {
    const s = /** @type {AroundSession} */ (this.session);
    if (!s.obs.length) return '';
    const species = new Set(s.obs.map(o => o.sci).filter(Boolean)).size;
    const fr = (/** @type {number} */ x) => x.toLocaleString('fr-FR');
    const total = Math.max(s.obsTotal || 0, s.obs.length);
    return `${fr(total)} observation${total > 1 ? 's' : ''} de plantes, ${fr(species)} espèce${species > 1 ? 's' : ''} différente${species > 1 ? 's' : ''}${total > s.obs.length ? ` — les ${fr(s.obs.length)} plus récentes sur la carte` : ' sur la carte'}`;
  }

  /** @param {number} id */
  #pick(id) { this.dispatchEvent(new CustomEvent('around-pick', { detail: { id }, bubbles: true, composed: true })); }

  /**
   * A point of the map touched (the cards shown): its plant comes on top of the deck. One not among the cards: said.
   * @param {CustomEvent} e
   */
  #onPoint(e) {
    const p = e.detail.point;
    const card = (this.session?.cards || []).find(x => (p.taxonId != null && x.taxonId === p.taxonId) || x.plant.scientificName === p.sci);
    // Not among the cards: one brief toast over the map (the user touched it).
    if (!card) { this.#map?.toast(`${p.common || p.sci || 'Cette plante'} n’est pas parmi les rencontres d’ici.`); return; }
    this.#pick(card.plant.id);
  }

  render() {
    const c = this.c, s = this.session;
    if (!c || !s || !c.point) return nothing;
    const asking = this.asking, quiet = this.quiet;
    return html`<div class="g-mapbox"><gf-map no-search no-create no-locate point-click=${asking ? 'none' : 'pick'} @point-pick=${(/** @type {CustomEvent} */ e) => this.#onPoint(e)}
        .area=${this.#area} .highlight=${asking ? null : quiet ? this.#quietHighlight : this._hl && this._hl.points.length <= MANY ? this._hl : null}
        .cluster=${asking || quiet ? null : this.#cluster} .frame=${asking ? null : this.#scopeFrame} .zone=${asking ? null : this.#scopeZone}></gf-map>${asking ? this.#launch() : nothing}</div>
      ${asking ? nothing : this.#wherePanel(this.card, quiet)}
      ${this.listed && !asking ? this.#aroundList(s.cards || []) : nothing}`;
  }

  /**
   * The perimeter, in one panel over the map (under it on a phone) — the distance said once: after a match, the zones
   * to choose (the circle with its radius, the département, the région, France, the world) — the map eases there, the
   * outline drawn —; under the circle's, its slider; the place to change; and the plant in view, its observations in
   * the perimeter counted. Rencontres (quiet): the circle and its distance only.
   * @param {Card | undefined} card @param {boolean} quiet
   */
  #wherePanel(card, quiet) {
    const c = /** @type {Record<string, any>} */ (this.c), s = /** @type {AroundSession} */ (this.session);
    const scopes = !quiet && Boolean(card) && discoverState().firstMatch;
    const scope = scopes ? this._scope : 'around';
    const a = this._admin;
    const km = distLabel(c.radius), mood = distMood(c.radius);
    const slide = distanceEvents(() => /** @type {Record<string, any>} */ (this.c).radius, m => s.setRadius(m, 700));
    /** @type {[Scope, unknown][]} */
    const chips = [['around', html`${icon('crosshair')} ${km}`], ...(a?.department ? [/** @type {[Scope, unknown]} */ (['department', a.department])] : []),
      ...(a?.region ? [/** @type {[Scope, unknown]} */ (['region', a.region])] : []), ['country', 'France'], ['world', 'Monde']];
    // (The plant in view and its count: said by the map, #say — its lit points show where; nothing written here.)
    return html`<div class="g-where" role="group" aria-label="Périmètre de la recherche">
      <div class="top">
        ${scopes ? html`<div class="g-scope" role="group" aria-label="Où pousse-t-elle encore ?"
            @focusin=${(/** @type {any} */ e) => e.target.scrollIntoView?.({ inline: 'nearest', block: 'nearest' })}>
            ${chips.map(([k, label]) => html`<button type="button" data-scope=${k} aria-pressed=${String(scope === k)} aria-label=${k === 'around' ? 'Autour, ' + km : nothing}
              @click=${() => { this._scope = k; }}>${label}</button>`)}
          </div>`
          : html`<span class="d">${km}</span><span class="mood">${mood}</span>`}
        <button class="icon-btn place" type="button" title="Changer de lieu" aria-label="Changer de lieu" @click=${() => this.app?.go('start')}>${icon('geo-alt')}</button>
      </div>
      ${scope === 'around' ? html`<label class="g-radius">${scopes ? html`<span class="mood">${mood}</span>` : nothing}
        <input type="range" min="0" max=${DISTANCES.length - 1} step="any" .value=${String(distanceAt(c.radius))} aria-label="Distance de la recherche"
          aria-valuetext=${km} @input=${slide.input} @keydown=${slide.keydown} /></label>` : nothing}
    </div>`;
  }

  /**
   * The first map's panel (the step's own: kept): how far, a few faces of what was seen around, and the way on —
   * « Qui pousse par ici ? » brings the cards next to the map. How many were seen is said by the map (#say), not
   * written; while they come, the map's thin line (no text).
   */
  #launch() {
    const c = /** @type {Record<string, any>} */ (this.c), s = /** @type {AroundSession} */ (this.session);
    const slide = distanceEvents(() => /** @type {Record<string, any>} */ (this.c).radius, m => s.setRadius(m));
    /** @type {Map<string, import('./session.js').AroundPoint>} */
    const species = new Map();
    for (const o of s.obs) if (o.sci && !species.has(o.sci)) species.set(o.sci, o);
    const faces = [...species.values()].filter(o => this.#photo(o.photo)).slice(0, 6);
    return html`<section class="g-launch" aria-label="Lancer la découverte">
      <h2>${icon('binoculars')} Jusqu’où part l’expédition ?</h2>
      <p class="where">Autour ${c.place ? 'de ' + c.place : 'de vous'} · <button class="link" type="button" @click=${() => this.app?.go('start')}>changer de lieu</button></p>
      <label class="g-dist"><span class="d">${distLabel(c.radius)}</span><span class="mood">${distMood(c.radius)}</span>
        <input type="range" min="0" max=${DISTANCES.length - 1} step="any" .value=${String(distanceAt(c.radius))} aria-label="Distance de la recherche"
          aria-valuetext=${distLabel(c.radius)} @input=${slide.input} @keydown=${slide.keydown} /></label>
      <div class="g-seen" aria-hidden="true">
        ${faces.length ? html`<span class="faces">${faces.map(o => html`<img src=${/** @type {string} */ (o.photo)} alt="" title=${o.credit ? creditText(o.credit) : ''} loading="lazy" referrerpolicy="no-referrer" @error=${(/** @type {any} */ e) => e.target.remove()} />`)}</span>` : nothing}
      </div>
      <button class="primary go" type="button" @click=${() => this.dispatchEvent(new CustomEvent('map-launch', { bubbles: true, composed: true }))}>${icon('heart-fill')} Qui pousse par ici ? <small>Les rencontres arrivent à côté de la carte</small></button>
    </section>`;
  }

  /** The plants around (step 4): their thumbnail, name and « en fleur »; a touch brings one on top of the deck. @param {Card[]} cards */
  #aroundList(cards) {
    const matches = /** @type {number[]} */ (this.c?.matches ?? []);
    return html`<aside class="around" aria-label="Les plantes autour">
      <h2>Les voisines <small class="muted">${cards.length}</small></h2>
      <ul>${repeat(cards, c => c.plant.id, c => html`<li><button type="button" aria-current=${String(c.plant.id === this.focusId)} @click=${() => this.#pick(c.plant.id)}>
        <span class="th">${this.#photo(c.photo) ? html`<img src=${/** @type {string} */ (c.photo).replace('/medium.', '/square.')} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error=${hideImg} @load=${showImg} />` : nothing}</span>
        <span class="t"><b>${nameOf(c.plant)}</b><small>${c.blooming ? 'En fleur · ' : ''}${c.count} obs.${matches.includes(c.plant.id) ? ' · ♥' : ''}</small></span>
      </button></li>`)}</ul>
    </aside>`;
  }
}

customElements.define('ma-around-map', MaAroundMap);
