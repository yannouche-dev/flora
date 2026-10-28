// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { href } from '../core/router.js';
import { collectionsForPlant, formatDistance, listCollections, plantMarkers, spotEvents, updatePlace, withEntry } from '../core/collections.js';
import { store } from '../core/store.js';
import { lastFix, oneFix } from '../core/geo.js';
import { FRANCE_BOUNDS, WORLD_BOUNDS } from '../core/ign.js';
import { moduleOn } from '../core/modules.js';
import { observationsAround, RADII, savedRadius, saveRadius } from '../core/nearby.js';
import { addressAt, zoneShape } from '../core/geoservices.js';
import { bundledOutline } from '../core/territory.js';
import { keptPlace } from '../core/around-sessions.js';
import { regionOf } from '../core/regions.js';
import * as sources from '../core/sources.js';
import { MAP_DEFAULTS } from '../core/sheet-blocks.js';
import { FOCUS_EVENT, focusId, isPlaceFilter, noFocus } from '../core/map-focus.js';
import { lookalikesOf } from '../core/lookalikes.js';
import { icon } from '../core/icons.js';
import { knownCredit, knownThumb, photoOf, thumbUrl } from '../core/thumb.js';
import { commonOf, nameOf } from '../core/plants.js';
import { INAT_DATASET, gbifSource } from '../core/around3d.js';
import { ui } from '../styles/ui.js';
import './gf-map.js';
import { openView } from '../core/history.js';
import { hintView, takeHint } from '../core/hints.js';

/** An iNaturalist observation's number, from its address (« …/observations/123 »); '' for another. @param {string | null | undefined} url */
const inatId = url => /\/observations\/(\d+)/.exec(String(url || ''))?.[1] || '';

/** The box of an outline, as two corners [lon, lat]. @param {any} feature @returns {[number, number][] | null} */
function zoneBounds(feature) {
  const g = feature?.geometry;
  if (!g) return null;
  const pts = /** @type {number[][]} */ (g.type === 'MultiPolygon' ? g.coordinates.flat(2) : g.coordinates.flat(1));
  if (!pts.length) return null;
  const lons = pts.map(p => p[0]), lats = pts.map(p => p[1]);
  return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
}

/**
 * The outline of the place touched in the sheet: IGN's (a région, a département), else the one the app carries
 * (offline, the IGN module off) — and France's, which only the app has.
 * @param {Record<string, string>} params @param {string} label
 */
async function placeOutline(params, label) {
  const gid = params.gadmGid || '';
  const ign = await zoneShape(gid, label).catch(() => null);
  if (ign) return ign;
  const level = /^FRA\./.test(gid) ? gid.split('.').length - 1 : 0;
  const kind = level === 1 ? 'region' : level === 2 ? 'department' : !gid && params.country === 'FR' ? 'country' : null;
  const outline = kind ? await bundledOutline(kind, label).catch(() => null) : null;
  // Its border as one Feature (lines): drawn as a perimeter, framed like IGN's.
  return outline?.feature.features[0] ?? null;
}

/** Heights of a map block. */
const HEIGHTS = { s: 180, m: 260, l: 380 };

/** The observations near me (MapConfig.near) from GBIF's and iNaturalist's chosen. @param {boolean} gbif @param {boolean} inat */
const nearOf = (gbif, inat) => gbif && inat ? 'both' : gbif ? 'gbif' : inat ? 'inat' : 'off';

/** « Observations proches » asked once in this visit: later maps look around without asking again. */
let nearAllowed = false;

/**
 * One GPS fix (a recent one if known), or why there is none (20 s at most).
 * @returns {Promise<{ coordinates: [number, number] } | { error: string } | null>}
 */
function locate() {
  const known = lastFix();
  if (known && Date.now() - known.timestamp < 5 * 60000) return Promise.resolve(known);
  // Else whatever fix the watch gives, however old (no maxAge): the one it holds comes back at once.
  return oneFix({ timeout: 20000 });
}

/**
 * A « Carte » block of the plant sheet: the layers it was set to show (GBIF distribution, my places with this
 * plant, observations around me from iNaturalist and / or GBIF), on the maps' common look — or its own, changed in its
 * panel ▦ (config.look, kept through `map-config`) —, framed as chosen, with the gates to the rest of the app (open in
 * the Carte, create a place here, move my plants, note it here, locate me).
 */
export class GfSheetMap extends LitElement {
  static properties = {
    plant: { attribute: false },
    /** GBIF Backbone key and iNaturalist taxon id of the plant (from the sheet's details). */
    gbifKey: { attribute: false },
    inatId: { attribute: false },
    /** What it shows and lets do (sheet-blocks.js › MapConfig). */
    config: { attribute: false },
    /** Pinned: fills the dock's height instead of its own. */
    fill: { type: Boolean, reflect: true },
    /** What the sheet's data asks it to show: a GBIF filter, a point, a plant to compare (map-focus.js). */
    mapFocus: { attribute: false },
    _spots: { state: true },
    _near: { state: true },
    _compare: { state: true },
    _bounds: { state: true },
    /** The region where I am (from my position, or the place chosen in Découvrir), for « Ma région ». */
    _region: { state: true },
    /** The plants it is mistaken for (to show beside it, from « Plantes à confondre »). */
    _lookalikes: { state: true },
    /** My collections (to choose one as what the map is about). */
    _collections: { state: true }
  };

  static styles = [ui, css`
    :host { display: block; }
    :host([fill]) { display: flex; flex-direction: column; }
    :host([fill]) .frame { flex: 1; min-height: 160px; }
    :host([fill]) .hint-once { display: none; }
    .chips { position: absolute; z-index: 2; top: 8px; left: 8px; right: 52px; display: flex; flex-wrap: wrap; gap: 4px; pointer-events: none; }
    .chip { pointer-events: auto; display: inline-flex; align-items: center; gap: 4px; max-width: 100%; min-height: 0; padding: 3px 4px 3px 10px; border: 0; border-radius: var(--gf-radius-pill);
      background: var(--gf-surface); color: var(--gf-text); box-shadow: var(--gf-shadow); font-size: 0.75rem; font-weight: 600; cursor: pointer; }
    .chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chip i { width: 10px; height: 10px; border-radius: 50%; flex: none; }
    /* Nothing of it drawn (none placed, absent from GBIF): its swatch hollow — why, in the map's panel « État ». */
    .chip i.none { box-sizing: border-box; border: 1.5px dashed var(--gf-text-muted); background: none; }
    .chip svg { flex: none; font-size: 0.9rem; color: var(--gf-text-muted); }
    .chip:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .frame { position: relative; border-radius: var(--gf-radius); overflow: hidden; border: 1px solid var(--gf-border); background: var(--gf-surface-2); }
    gf-map { position: absolute; inset: 0; min-height: 0; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; align-items: center; }
    .actions .button, .actions button { font-size: 0.85rem; min-height: 36px; padding: 4px 12px; }
    .actions .near-note { flex-basis: 100%; font-size: 0.75rem; color: var(--gf-text-muted); }
    /* The plant's points (its observations, whatever their source): its marker's pink and gold ring. */
    .scope button i.obs, .chip i.obs { border: 0; background: radial-gradient(circle at 35% 30%, #ff6f9c, var(--gf-kin) 75%); box-shadow: 0 0 0 1.5px var(--gf-highlight); }
    .hint-once.gestures { margin-top: 6px; }
    /* What the map can show: how to frame it, how far around me, which data. */
    .scope { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 8px; align-items: center; margin-top: 8px; font-size: 0.78rem; }
    .scope > b { color: var(--gf-text-muted); font-weight: 600; white-space: nowrap; }
    .scope .row { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
    .scope button { min-height: 0; height: 26px; padding: 0 10px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-pill); background: var(--gf-surface);
      color: var(--gf-text); font: inherit; font-size: 0.78rem; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; white-space: nowrap; }
    .scope button:hover { background: var(--gf-surface-2); }
    .scope button[aria-pressed='true'] { background: var(--gf-accent-soft); border-color: var(--gf-accent); color: var(--gf-accent); font-weight: 600; }
    .scope button:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .scope button i { width: 8px; height: 8px; border-radius: 50%; flex: none; }
    .scope small { color: var(--gf-text-muted); font-weight: 400; }
    .scope select { height: 26px; min-height: 0; padding: 0 8px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-pill); background: var(--gf-surface); color: var(--gf-text); font: inherit; font-size: 0.78rem; max-width: 220px; }
    .scope select.on { background: var(--gf-accent-soft); border-color: var(--gf-accent); color: var(--gf-accent); font-weight: 600; }
  `];

  #onChange = () => { this.#loadSpots(); this.#loadCollections(); };
  /** The results changed (the search, its filters): a map about them follows. */
  #onStore = () => {
    const items = store.state.results.items;
    if (items !== this.#items) { this.#items = items; if (this.config.subject === 'results') this.#loadSpots(); }
  };
  /** @type {any} */ #items = null;
  /** Which plants of a place are shown (the plant, the results', the collection's). @type {(e: any) => boolean} */
  #keep = () => true;

  constructor() {
    super();
    /** @type {any} */
    this.plant = null;
    /** @type {number | null} */
    this.gbifKey = null;
    /** @type {number | null} */
    this.inatId = null;
    /** @type {import('../core/sheet-blocks.js').MapConfig} */
    this.config = MAP_DEFAULTS;
    this.fill = false;
    /** @type {import('../core/map-focus.js').SheetFocus} */
    this.mapFocus = noFocus();
    /** The compared plant's GBIF key: { taxon, key } (key null: not in GBIF; undefined: looking). @type {any} */
    this._compare = null;
    /** Extent of the filtered occurrences, for a place filter: { id, points } (points empty: none). @type {any} */
    this._bounds = null;
    /** @type {any[]} */
    this._spots = [];
    /** Observations around: not asked, looking, the result, or what went wrong. @type {any} */
    this._near = undefined;
    /** @type {{ name: string, bounds: [number, number, number, number] } | null} */
    this._region = null;
  }

  connectedCallback() {
    super.connectedCallback();
    spotEvents.addEventListener('change', this.#onChange);
    store.addEventListener('change', this.#onStore);
    this.#items = store.state.results.items;
    this.#findRegion();
    this.#loadCollections();
  }

  async #loadCollections() {
    const all = await listCollections().catch(() => []);
    this._collections = all.map(c => ({ id: c.id, name: c.properties.name || (c.properties.kind === 'favorites' ? 'Favoris' : 'Sans nom'), kind: c.properties.kind, count: c.properties.plants.length }));
  }

  /** Where I am, as far as the app knows without asking: my last position, else the place chosen in Découvrir. */
  get #whereIAm() {
    return /** @type {[number, number] | null} */ (this._near?.point || lastFix()?.coordinates || keptPlace()?.point || null);
  }

  /** My region (IGN address of where I am), once. */
  async #findRegion() {
    const point = this.#whereIAm;
    if (!point || this.#regionFor === point.join()) return;
    this.#regionFor = point.join();
    const a = await addressAt(point).catch(() => null);
    this._region = a ? regionOf(a.context) : null;
  }
  #regionFor = '';

  /** A setting of this map changed here (the scope bar): the sheet keeps it, per map. @param {any} patch */
  #set(patch) {
    if ('near' in patch && patch.near !== 'off') nearAllowed = true;
    this.dispatchEvent(new CustomEvent('map-config', { detail: patch }));
  }

  /** « Autour de moi »: framed on the circle around me (located first if needed). */
  async #aroundMe() {
    this.#set({ frame: 'me' });
    if (!lastFix() && !this._near?.point) { const fix = await locate(); if (fix && !('error' in fix)) { this.#findRegion(); this.requestUpdate(); } }
  }

  /** Another radius: kept (as in the Carte), the observations around looked for again. @param {number} r */
  #setRadius(r) {
    saveRadius(r);
    if (this.config.near !== 'off' && this._near?.state === 'done') this.#findNear(); else this.requestUpdate();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    spotEvents.removeEventListener('change', this.#onChange);
    store.removeEventListener('change', this.#onStore);
  }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (changed.has('_near')) this.#findRegion();
    if (changed.has('plant')) { this._near = undefined; this.#loadSpots(); this.#loadLookalikes(); }
    else if (changed.has('config') && (changed.get('config')?.subject !== this.config.subject || changed.get('config')?.collection !== this.config.collection)) this.#loadSpots();
    if (changed.has('mapFocus') || changed.has('gbifKey')) this.#loadFocus();
    const near = this.config.near;
    if ((changed.has('config') || changed.has('plant') || changed.has('gbifKey') || changed.has('inatId')) && near !== 'off') {
      // The sources asked changed: look again (automatically once allowed in this visit).
      const wanted = near + ':' + this.gbifKey + ':' + this.inatId;
      if (this._near?.wanted !== wanted) this._near = nearAllowed ? undefined : this._near?.state === 'done' ? undefined : this._near;
      if (nearAllowed && !this._near) queueMicrotask(() => this.#findNear());
    }
  }

  /** What the focus needs: the compared plant's GBIF key, the extent of a place filter's occurrences. */
  async #loadFocus() {
    const f = this.mapFocus || noFocus();
    const taxon = f.compare?.taxon;
    if (!taxon) this._compare = null;
    else if (this._compare?.taxon !== taxon) {
      this._compare = { taxon, key: undefined };
      const hit = await sources.gbifTaxon({ id: 'cmp:' + taxon, scientificName: taxon }).catch(() => null);
      if (this.mapFocus?.compare?.taxon === taxon) this._compare = { taxon, key: hit?.key ?? null };
    }
    const filter = f.filter;
    const id = focusId(filter);
    if (!filter || !isPlaceFilter(filter.params) || !this.gbifKey) this._bounds = null;
    else if (this._bounds?.id !== id + ':' + this.gbifKey) {
      const wanted = id + ':' + this.gbifKey;
      // Both asked at once: the occurrences in the area, and its outline (French régions and départements).
      // Until both are in, the map stays where it is (no default view in between).
      this._bounds = { id: wanted, points: null, occ: [], zone: undefined };
      const [found, zone] = await Promise.all([
        sources.gbifBounds(this.gbifKey, filter.params).catch(() => null),
        placeOutline(filter.params, filter.label).catch(() => null)
      ]);
      if (this._bounds?.id === wanted) this._bounds = { id: wanted, points: found?.bounds || [], occ: found?.points || [], zone, count: found?.count ?? 0 };
    }
  }

  async #loadLookalikes() {
    const plant = this.plant;
    this._lookalikes = [];
    if (!plant) return;
    const list = await lookalikesOf(plant).catch(() => []);
    if (this.plant !== plant) return;
    /** @type {Map<string, { taxon: string, label: string }>} */
    const others = new Map();
    for (const l of list) for (const o of l.others) if (o.taxon && !others.has(o.taxon)) others.set(o.taxon, { taxon: o.taxon, label: o.label || o.taxon });
    this._lookalikes = [...others.values()].slice(0, 4);
  }

  /**
   * The places shown, from what the map is about: those with this plant; those with a plant of the results; a
   * collection's — the place itself, or (a list) the places where its plants are. And which of their plants show.
   */
  async #loadSpots() {
    const id = this.plant?.id, c = this.config;
    if (!id) return;
    const want = c.subject + ':' + c.collection + ':' + id;
    this.#spotsFor = want;
    try {
      /** @type {any[]} */ let places;
      if (c.subject === 'results' || c.subject === 'collection') {
        const all = await listCollections();
        const isPlace = (/** @type {any} */ x) => x.properties.kind === 'place' && x.geometry;
        /** @type {Set<number>} */ let ids;
        const chosen = c.subject === 'collection' ? all.find(x => x.id === c.collection) : null;
        if (c.subject === 'results') ids = new Set(store.state.results.items.map((/** @type {any} */ i) => i.id));
        else ids = new Set((chosen?.properties.plants || []).map((/** @type {any} */ e) => e.plantId));
        if (chosen && isPlace(chosen)) { places = [chosen]; this.#keep = () => true; }
        else { places = all.filter(x => isPlace(x) && x.properties.plants.some((/** @type {any} */ e) => ids.has(e.plantId))); this.#keep = e => ids.has(e.plantId); }
      } else {
        places = (await collectionsForPlant(id)).filter(x => x.properties.kind === 'place' && x.geometry);
        this.#keep = e => e.plantId === id;
      }
      if (this.#spotsFor === want) this._spots = places;
    } catch { this._spots = []; }
  }
  #spotsFor = '';

  /** The map is about this plant (its distribution, around me, its look-alikes, an area touched in the sheet). */
  get #aboutPlant() { return this.config.subject === 'plant'; }

  /** Observations around me, from the sources chosen. */
  async #findNear() {
    const c = this.config;
    if (c.near === 'off') return;
    nearAllowed = true;
    const plant = this.plant;
    const wanted = c.near + ':' + this.gbifKey + ':' + this.inatId;
    this._near = { state: 'locating', wanted };
    const fix = await locate();
    if (this.plant !== plant) return;
    if (!fix || 'error' in fix) {
      // Asked, no position: one brief toast over the map (the button stays, to try again).
      const message = fix && 'error' in fix ? fix.error : 'Position introuvable pour le moment.';
      this._near = { state: 'error', wanted, message };
      this.#map?.toast(message);
      return;
    }
    const radius = savedRadius();
    const point = /** @type {[number, number]} */ (fix.coordinates);
    this._near = { state: 'loading', wanted, point, radius };
    const useGbif = (c.near === 'gbif' || c.near === 'both') && this.gbifKey && moduleOn('gbif');
    const useInat = (c.near === 'inat' || c.near === 'both') && this.inatId && moduleOn('inaturalist');
    const [gbif, inat] = await Promise.all([
      useGbif ? sources.gbifNear(this.gbifKey, point, radius, undefined, 30).catch(() => null) : null,
      // iNaturalist's of every quality grade (no quality_grade): all that is there, as GBIF's.
      useInat ? observationsAround(/** @type {number} */ (this.inatId), point, radius, undefined, '').catch(() => null) : null
    ]);
    if (this.plant !== plant) return;
    // Each the plant's observation, whatever its source (drawn alike: #occurrences), its card saying when, where and
    // from where. GBIF's copy of an iNaturalist observation shown here is left out (the same record: its number on
    // GBIF is the observation's; one without its number, from the same circle, too) — counted, the legend says it.
    const inatIds = new Set((inat || []).map(o => inatId(o.url)).filter(Boolean));
    /** @type {{ coordinates: [number, number], title: string, url?: string, date: string | null, place: string | null, source: string, gbif?: number }[]} */
    const points = [];
    let copies = 0;
    for (const o of gbif?.nearest || []) {
      if (inat?.length && o.datasetKey === INAT_DATASET && (!o.catalog || inatIds.has(String(o.catalog)))) { copies++; continue; }
      points.push({ coordinates: o.coordinates, url: 'https://www.gbif.org/occurrence/' + o.key, date: o.date || null, place: o.locality || null,
        source: gbifSource(o.dataset), gbif: o.key,
        title: `GBIF · ${formatDistance(o.distance)}${o.date ? ' · ' + new Date(o.date).toLocaleDateString('fr-FR') : ''}` });
    }
    const gbifPlaced = points.length;
    for (const o of inat || []) {
      points.push({ coordinates: o.coordinates, url: o.url, date: o.date || null, place: o.place || null, source: 'iNaturalist',
        title: `iNaturalist${o.date ? ' · ' + new Date(o.date).toLocaleDateString('fr-FR') : ''}` });
    }
    this._near = { state: 'done', wanted, point, radius, points, inatIds, gbifTotal: gbif?.total ?? null, gbifPlaced, gbifCopies: copies,
      inatCount: inat?.length ?? null, gbifOn: Boolean(useGbif), inatOn: Boolean(useInat) };
    // How many came: said by the map's live region (the counts in its panel's « Légende », never written over it).
    this.#map?.announce(points.length ? `Autour de vous : ${points.length} observation${points.length > 1 ? 's' : ''} sur la carte` : 'Autour de vous : aucune observation de cette plante');
  }

  /** The block's map (gf-map: what it says goes through it — the quiet-map rule). @returns {any} */
  get #map() { return this.renderRoot.querySelector('gf-map'); }

  /**
   * ✎ on the map: a place moved there (once « Déplacer le lieu ici ? » is confirmed), this plant's new position in each
   * place it was moved in.
   * @param {{ places: { id: string, coordinates: [number, number] }[], plants: { placeId: string, entryId?: string, plantId: number | null, coordinates: [number, number] }[] }} moves
   */
  async #savePositions({ places, plants }) {
    const round = (/** @type {[number, number]} */ c) => /** @type {[number, number]} */ (c.map(v => Math.round(v * 1e7) / 1e7));
    // On the place as stored now (its other plants may have changed meanwhile, in another tab).
    for (const { id, coordinates } of places) {
      if (!this._spots.some(p => p.id === id)) continue;
      await updatePlace(id, current => ({ ...current, geometry: { type: 'Point', coordinates: round(coordinates) }, properties: { ...current.properties, accuracy: null } })).catch(error => console.error(error));
    }
    for (const { placeId, entryId, plantId, coordinates } of plants) {
      if (!this._spots.some(p => p.id === placeId)) continue;
      await updatePlace(placeId, current => withEntry(current, entryId ?? plantId, { coordinates: round(coordinates), accuracy: null })).catch(error => console.error(error));
    }
  }

  /**
   * What the map frames, from its settings and what it shows: « Automatique » follows the layers — the circle
   * around me once looked, else my places and their plants, else the world for a worldwide GBIF distribution,
   * else France. Any change of setting or data frames it again (the key changes); moving the map by hand stays.
   * @returns {{ frame: { key: string, points: [number, number][] }, world: boolean }}
   */
  #framing() {
    const c = this.config;
    const near = this.#aboutPlant && this._near?.state === 'done' && c.near !== 'off' ? this._near : null;
    const content = /** @type {[number, number][]} */ ([
      ...(c.places ? this._spots.flatMap(s => [s.geometry.coordinates, ...s.properties.plants.filter((/** @type {any} */ e) => this.#keep(e) && e.coordinates).map((/** @type {any} */ e) => e.coordinates)]) : []),
      ...(near ? near.points.map((/** @type {any} */ p) => p.coordinates) : [])
    ]);
    const center = near?.point || (c.frame === 'me' ? lastFix()?.coordinates : null);
    const circle = () => {
      const r = (near?.radius || savedRadius()) / 111320;
      const [lon, lat] = /** @type {[number, number]} */ (center);
      const dLon = r / Math.cos(lat * Math.PI / 180);
      return /** @type {[number, number][]} */ ([[lon - dLon, lat - r], [lon + dLon, lat + r]]);
    };
    // A place touched in the sheet (a région, a country): its outline, else its occurrences — once both are in;
    // until then, the view shown stays (no France or world in between).
    const b = this.#aboutPlant ? this._bounds : null;
    if (b && b.points === null && this.#lastFraming) return this.#lastFraming;
    const zoneBox = b?.zone ? zoneBounds(b.zone) : null;
    if (b && (zoneBox || b.points?.length)) {
      const world = !/^FRA\./.test(this.mapFocus?.filter?.params.gadmGid || '') && this.mapFocus?.filter?.params.country !== 'FR';
      return (this.#lastFraming = { frame: { key: 'filter|' + b.id + '|' + c.height, points: zoneBox || b.points, ease: true }, world });
    }
    const box = (/** @type {any} */ bounds) => /** @type {[number, number][]} */ ([[bounds.getWest(), bounds.getSouth()], [bounds.getEast(), bounds.getNorth()]]);
    /** @type {string} */ let kind = c.frame;
    if (kind === 'auto') kind = near ? 'me' : content.length ? 'content' : c.gbif === 'world' ? 'world' : 'france';
    if (kind === 'region' && !this._region) kind = 'france';
    if (kind === 'me' && !center) kind = content.length ? 'content' : 'france';
    if (kind === 'content' && !content.length) kind = c.gbif === 'world' ? 'world' : 'france';
    const region = this._region?.bounds;
    const points = kind === 'me' ? circle() : kind === 'content' ? content : kind === 'world' ? box(WORLD_BOUNDS)
      : kind === 'region' && region ? /** @type {[number, number][]} */ ([[region[0], region[1]], [region[2], region[3]]]) : box(FRANCE_BOUNDS);
    // Framed again whenever what it shows changes (settings, data, size), not when the user moves it.
    // Where the points are (not only how many): another place with as many points is framed again.
    const where = points.length ? points.reduce((m, p) => [m[0] + p[0], m[1] + p[1]], [0, 0]).map(v => v.toFixed(3)).join(',') : '';
    const key = [kind, c.subject, c.collection, this._spots.length, c.gbif, c.places, c.near, c.height, points.length, where, center?.join() || '', kind === 'me' ? near?.radius || savedRadius() : '', kind === 'region' ? this._region?.name : ''].join('|');
    // Back from a place touched (its ✕): eased too.
    return (this.#lastFraming = { frame: { key, points, ease: Boolean(this.#lastFraming) }, world: kind === 'world' || c.gbif === 'world' });
  }
  /** @type {{ frame: { key: string, points: [number, number][], ease?: boolean }, world: boolean } | null} */
  #lastFraming = null;


  render() {
    const c = this.config;
    const plant = this.plant;
    if (!plant) return nothing;
    const near = this._near;
    const spots = c.places ? this._spots : [];
    const f = this.mapFocus || noFocus();
    const gbifReady = this.#aboutPlant && Boolean(this.gbifKey) && moduleOn('gbif');
    // A filter shows the plant's occurrences even on a map set without them.
    const gbifOn = gbifReady && (c.gbif !== 'off' || Boolean(f.filter));
    const country = f.filter && isPlaceFilter(f.filter.params) ? '' : c.gbif === 'world' ? '' : 'FR';
    const compare = this._compare?.key && gbifReady ? { key: this._compare.key, label: f.compare?.label || '', country } : null;
    const framing = this.#framing();
    const frame = framing.frame;
    // What the colours mean: the map's panel « Légende » (gf-map setLegend, updated), not a block of text by the map.
    this.#legendNow = this.#legend(gbifOn);
    const gestures = this.#gestures;
    if (gestures && this.#gestureHint === undefined && !this.fill) this.#gestureHint = takeHint('sheet-map-gestures');
    return html`
      <div class="frame" style=${this.fill ? '' : `height:${HEIGHTS[c.height] || HEIGHTS.m}px`}>
        <gf-map
          .spots=${spots}
          .plants=${c.places ? plantMarkers(this._spots, this.#keep) : []}
          plant-zoom="0"
          ?editable=${c.actions.edit && c.places && this._spots.length > 0}
          .frame=${frame}
          min-zoom=${framing.world || compare ? 1 : 5}
          .area=${this.#aboutPlant && near?.state === 'done' && c.near !== 'off' ? { center: near.point, radius: near.radius } : null}
          .points=${[]}
          .distribution=${gbifOn ? { key: this.gbifKey, label: nameOf(plant), country, filter: f.filter?.params || null } : null}
          .compare=${compare}
          .focusPoint=${f.point ? { coordinates: f.point.coordinates, title: f.point.label, url: f.point.url, photo: this.#photo().photo } : null}
          .zone=${this.#aboutPlant && this._bounds?.zone ? { key: this._bounds.id, feature: this._bounds.zone } : null}
          .cluster=${this.#occurrences()}
          ?distribution-on=${Boolean(gbifOn)}
          .data=${this.#dataRows(gbifReady, f)}
          @data-change=${(/** @type {CustomEvent} */ e) => this.#onData(e.detail)}
          .look=${c.look}
          no-search
          ?no-create=${!c.actions.create}
          .createPlant=${plant.id}
          ?no-locate=${!c.actions.locate}
          @spot-select=${e => { openView(href.map({ spot: e.detail.id })); }}
          @plant-select=${e => { openView(href.map({ spot: e.detail.placeId, focus: e.detail.entryId ?? e.detail.plantId })); }}
          @positions-save=${e => this.#savePositions(e.detail)}
          @look-change=${e => this.dispatchEvent(new CustomEvent('map-config', { detail: { look: e.detail.look } }))}
        ></gf-map>
        ${this.#chips(f)}
      </div>
      ${this.#scope(gbifReady)}
      <div class="actions">
        ${c.near !== 'off' && near?.state !== 'done' ? this.#nearButton(near) : nothing}
        ${c.actions.open ? html`<a class="button" href=${href.map({ plants: [plant.id] })}>${icon('map')} Ouvrir dans la Carte</a>` : nothing}
        ${c.actions.spot ? html`<button type="button" @click=${() => this.dispatchEvent(new CustomEvent('open-capture', { bubbles: true, composed: true, detail: { plant } }))}>${icon('geo-alt-fill')} Noter ici</button>` : nothing}
      </div>
      ${gestures && this.#gestureHint ? hintView(gestures + '.', () => { this.#gestureHint = false; this.requestUpdate(); }, 'gestures') : nothing}`;
  }

  /** The gestures' first-use hint shows (core/hints.js: the first map block ever, not a pinned one), until its ✕. @type {boolean | undefined} */
  #gestureHint;

  /**
   * « Observations autour de moi », its privacy line under it (its description). While it looks (locating, then
   * asking): disabled, aria-busy, a light sweeping it past 400 ms — no text; a refusal: a brief toast over the map.
   * @param {any} near
   */
  #nearButton(near) {
    const c = this.config;
    const busy = near?.state === 'locating' || near?.state === 'loading';
    return html`<button type="button" class="near-ask ${busy ? 'busy' : ''}" ?disabled=${busy} aria-busy=${String(busy)} aria-describedby="near-note"
        @click=${() => this.#findNear()}>${icon('crosshair')} Observations autour de moi (${formatDistance(savedRadius())})</button>
      <span class="near-note" id="near-note">Votre position précise est envoyée à ${c.near === 'both' ? 'iNaturalist et GBIF' : c.near === 'gbif' ? 'GBIF' : 'iNaturalist'} pour cette recherche.</span>`;
  }

  /** What the map's gestures do here (long press, ✎, its layers): a first-use hint once per device, and the map's own description. */
  get #gestures() {
    const c = this.config;
    if (!c.actions.create && !(c.actions.edit && this._spots.length)) return '';
    return [c.actions.create ? 'Appui long sur la carte : un repère à confirmer, son adresse, son altitude, créer un lieu avec cette plante' : '',
      c.actions.edit && c.places && this._spots.length ? '✎ : déplacer mes plantes notées' : '',
      'les couches : fond et couches IGN de cette carte'].filter(Boolean).join(' · ');
  }

  /** @param {Map<string, any>} changed */
  updated(changed) {
    // The map's legend (its panel) and what changed in it, said once; the chips' states: lines of its panel's « État »
    // (said once by the map, seen there on a touch screen too — a chip has no hover).
    const map = this.#map;
    if (!map) return;
    map.setLegend?.(this.#legendNow);
    for (const [key, text] of Object.entries(this.#chipState)) map.setStatus?.(key, text);
    for (const said of this.#toSay.splice(0)) map.announce?.(said);
    if (changed.has('config') || changed.has('_spots')) map.setAttribute('aria-description', this.#gestures);
  }

  /** The legend drawn last (render) for the map's panel. @type {{ text: string, swatch?: string }[]} */ #legendNow = [];
  /** Words to say once the map is there (updated). @type {string[]} */ #toSay = [];
  /** The chips' states (render), for the map's « État » (updated): '' when there is none. */ #chipState = { filter: '', compare: '' };

  /**
   * The points shown — the occurrences of the place touched (GBIF), the observations around me (iNaturalist, GBIF) —,
   * each as an observation of this plant is drawn whatever its source: the plant chosen's marker, its photo (#photo),
   * grouped by the map in stacks of that photo when they are many; its card its names, when, where and from where.
   * Each record once: an occurrence of the place touched also around me is drawn once, and GBIF's copy of an
   * iNaturalist observation shown around me is left out (`areaPlaced`, `areaCopies`: the legend says so).
   */
  #occurrences() {
    if (!this.#aboutPlant) return null;
    const b = this._bounds, near = this.config.near !== 'off' && this._near?.state === 'done' ? this._near : null;
    const id = (b?.occ?.length ? b.id : '') + '|' + (near ? near.wanted + ':' + near.radius + ':' + near.points.length : '');
    if (id === '|') return null;
    const plant = this.plant, { photo, credit } = this.#photo();
    // The photo and its credit in the key: one found later draws the points again with it.
    const key = id + '|' + (photo || '') + '|' + (credit?.author || '');
    if (this.#occMemo?.id === key) return this.#occMemo.value;
    /** @type {Set<string>} */ const inatIds = near?.inatIds || new Set();
    /** @type {any[]} */ const area = [];
    let areaCopies = 0;
    for (const o of b?.occ || []) {
      if (o.datasetKey === INAT_DATASET && o.catalog && inatIds.has(String(o.catalog))) { areaCopies++; continue; }
      const date = o.date ? String(o.date).slice(0, 10) : null;
      area.push({ coordinates: o.coordinates, url: 'https://www.gbif.org/occurrence/' + o.key, date, place: o.locality || null, gbif: o.key,
        source: gbifSource(o.dataset), title: 'GBIF' + (date ? ' · ' + new Date(date).toLocaleDateString('fr-FR') : '') });
    }
    const drawn = new Set(area.map(p => p.gbif));
    const value = {
      key, photo, credit, common: commonOf(plant), sci: plant.scientificName, taxonId: this.inatId ?? null,
      areaPlaced: area.length, areaCopies,
      points: [...area, ...(near?.points || []).filter((/** @type {any} */ p) => p.gbif == null || !drawn.has(p.gbif)).map((/** @type {any} */ p) => ({ ...p }))]
    };
    this.#occMemo = { id: key, value };
    return value;
  }
  /** @type {{ id: string, value: any } | null} */ #occMemo = null;

  /**
   * The plant's photo on its points and on the point touched in the sheet: the one its card and its markers on my
   * places show (core/thumb.js: the flora's, else one found for it — asked here once when not known yet), with its
   * credit (its author and licence, wherever it was found); none with « Photos en ligne » off (its leaf then).
   * @returns {{ photo: string | null, credit: import('../core/credit.js').Credit | null }}
   */
  #photo() {
    const plant = this.plant;
    const url = knownThumb(plant);
    if (url === undefined && plant?.id != null && this.#thumbFor !== plant.id) {
      this.#thumbFor = plant.id;
      thumbUrl(plant.id, plant).then(found => { if (found && this.plant === plant) this.requestUpdate(); }, () => {});
    }
    const photo = photoOf(url);
    return { photo, credit: photo ? knownCredit(plant) : null };
  }
  /** @type {number | null} */ #thumbFor = null;

  /**
   * What the sheet's data shows on the map, each with its ✕ (a control: kept). Its state (looking, none placed,
   * absent from GBIF) is no suffix written over the map: in its name and title, its swatch hollow (no text), and a line
   * of the map's panel « État » (gf-map setStatus, in updated: said once by the map's live region).
   * @param {import('../core/map-focus.js').SheetFocus} f
   */
  #chips(f) {
    const clear = (/** @type {string} */ kind) => this.dispatchEvent(new CustomEvent('focus-clear', { detail: { kind }, bubbles: true, composed: true }));
    const chips = [];
    this.#chipState = { filter: '', compare: '' };
    if (f.filter) {
      const none = this._bounds && Array.isArray(this._bounds.points) && !this._bounds.points.length;
      const name = `Filtre : ${f.filter.label}${none ? ' (aucune occurrence localisée)' : ''}`;
      if (none) this.#chipState.filter = `${f.filter.label} : aucune occurrence localisée`;
      chips.push(html`<button class="chip ${this._bounds?.points === null ? 'busy' : ''}" type="button" data-kind="filter" title=${name + ' — retirer le filtre'}
        aria-label=${name + '. Retirer le filtre'} aria-busy=${String(this._bounds?.points === null)} @click=${() => clear('filter')}>
        <i class=${none ? 'none' : 'obs'}></i><span>Filtre : ${f.filter.label}</span>${icon('x-lg')}</button>`);
    }
    if (f.compare) {
      const looking = this._compare?.key === undefined;
      const absent = this._compare?.key === null;
      const name = `Comparaison : ${f.compare.label}${absent ? ' (absente de GBIF)' : ''}`;
      if (absent) this.#chipState.compare = `${f.compare.label} : absente de GBIF, rien à comparer`;
      chips.push(html`<button class="chip ${looking ? 'busy' : ''}" type="button" data-kind="compare" title=${name + ' — retirer la comparaison'}
        aria-label=${name + '. Retirer la comparaison'} aria-busy=${String(looking)} @click=${() => clear('compare')}>
        <i class=${absent ? 'none' : ''} style=${absent ? '' : 'background:#7b3294'}></i><span>Comparaison : ${f.compare.label}</span>${icon('x-lg')}</button>`);
    }
    if (f.point) {
      chips.push(html`<button class="chip" type="button" data-kind="point" title=${f.point.label + ' — retirer le point'} aria-label=${f.point.label + '. Retirer le point'}
        @click=${() => clear('point')}><i style="background:#e11d48"></i><span>${f.point.label}</span>${icon('x-lg')}</button>`);
    }
    return chips.length ? html`<div class="chips">${chips}</div>` : nothing;
  }

  /**
   * What this map can show, suggested from what is known: how to frame it (my region when it is known, around me,
   * the points shown, France, the world), how far around me once located, and the data it can show — the GBIF
   * distribution, my places with this plant, the observations around me (iNaturalist, GBIF) — each with a touch. (Its
   * background and IGN's layers: its panel ▦, as on every map.)
   * @param {boolean} gbifReady
   */
  #scope(gbifReady) {
    const c = this.config, near = this._near;
    const located = Boolean(this.#whereIAm);
    const hasContent = (c.places && this._spots.length > 0) || (near?.state === 'done' && near.points.length > 0);
    /** @param {string} value @param {unknown} label @param {string} [title] @param {() => void} [act] */
    const frameBtn = (value, label, title, act) => html`<button type="button" aria-pressed=${String(c.frame === value)}
      title=${title || ''} data-frame=${value} @click=${act || (() => this.#set({ frame: value }))}>${label}</button>`;
    const inatReady = Boolean(this.inatId) && moduleOn('inaturalist');
    const gbifNear = c.near === 'gbif' || c.near === 'both', inatNear = c.near === 'inat' || c.near === 'both';
    const r = near?.radius || savedRadius();
    const showRadius = c.frame === 'me' || c.near !== 'off';
    const about = this.#aboutPlant;
    const count = store.state.results.total ?? store.state.results.items.length;
    const places = this._collections?.filter((/** @type {any} */ x) => x.count) || [];
    return html`<div class="scope" role="group" aria-label="Ce que la carte montre">
      <b>Sujet</b><div class="row">
        <button type="button" data-subject="plant" aria-pressed=${String(c.subject === 'plant')} title="Cette plante : sa répartition, mes lieux où elle est, ce qui est autour"
          @click=${() => this.#set({ subject: 'plant' })}>${icon('flower1')} Cette plante</button>
        <button type="button" data-subject="results" aria-pressed=${String(c.subject === 'results')} title="Les plantes des résultats (la recherche et ses filtres) : mes lieux où elles sont"
          @click=${() => this.#set({ subject: 'results' })}>${icon('funnel')} Les résultats <small>${count}</small></button>
        ${places.length ? html`<select aria-label="Une liste ou un lieu" data-subject="collection" class=${c.subject === 'collection' ? 'on' : ''}
          @change=${(/** @type {any} */ e) => e.target.value && this.#set({ subject: 'collection', collection: e.target.value })}>
          <option value="" ?selected=${c.subject !== 'collection'}>Une liste ou un lieu…</option>
          ${places.map((/** @type {any} */ x) => html`<option value=${x.id} ?selected=${c.subject === 'collection' && c.collection === x.id}>${x.kind === 'place' ? '📍 ' : ''}${x.name} (${x.count})</option>`)}
        </select>` : nothing}
      </div>
      <b>Cadrer</b><div class="row">
        ${frameBtn('auto', 'Auto', 'Selon ce qui est affiché')}
        ${this._region ? frameBtn('region', html`Ma région <small>${this._region.name}</small>`, 'La région où vous êtes') : nothing}
        ${about || located ? frameBtn('me', html`${icon('crosshair')} Autour de moi`, located ? 'Le cercle autour de vous' : 'Vous localiser, puis le cercle autour de vous', () => this.#aroundMe()) : nothing}
        ${hasContent ? frameBtn('content', 'Les points', 'Ajusté aux points affichés') : nothing}
        ${frameBtn('france', 'France')}
        ${frameBtn('world', 'Monde')}
      </div>
      ${about && showRadius ? html`<b>Rayon</b><div class="row">${RADII.map(d => html`<button type="button" data-radius=${d} aria-pressed=${String(r === d)}
        @click=${() => this.#setRadius(d)}>${formatDistance(d)}</button>`)}</div>` : nothing}
      <b>Données</b><div class="row">
        ${gbifReady ? html`<button type="button" data-layer="gbif-fr" aria-pressed=${String(c.gbif === 'fr')} title="Répartition GBIF en France" @click=${() => this.#set({ gbif: c.gbif === 'fr' ? 'off' : 'fr' })}><i style="background:#f97316"></i>Répartition France</button>
          <button type="button" data-layer="gbif-world" aria-pressed=${String(c.gbif === 'world')} title="Répartition GBIF dans le monde" @click=${() => this.#set({ gbif: c.gbif === 'world' ? 'off' : 'world' })}><i style="background:#f97316"></i>Monde</button>` : nothing}
        ${this._spots.length || !about ? html`<button type="button" data-layer="places" aria-pressed=${String(c.places)} @click=${() => this.#set({ places: !c.places })}>${icon('geo-alt-fill')} Mes lieux <small>${this._spots.length}</small></button>` : nothing}
        ${about && inatReady ? html`<button type="button" data-layer="inat" aria-pressed=${String(inatNear)} title="Observations iNaturalist autour de moi" @click=${() => this.#set({ near: nearOf(gbifNear, !inatNear) })}><i class="obs"></i>iNaturalist autour${near?.state === 'done' && near.inatOn ? html` <small>${near.inatCount ?? 0}</small>` : nothing}</button>` : nothing}
        ${gbifReady ? this._lookalikes.map(o => html`<button type="button" data-layer="compare" data-taxon=${o.taxon} aria-pressed=${String(this.mapFocus?.compare?.taxon === o.taxon)}
          title=${'Sa répartition (GBIF) à côté : ' + o.label + ' — une plante avec laquelle elle se confond'}
          @click=${() => this.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: { kind: 'compare', label: o.label, taxon: o.taxon }, bubbles: true, composed: true }))}><i style="background:#7b3294"></i>Sosie : ${o.label}</button>`) : nothing}
        ${gbifReady ? html`<button type="button" data-layer="gbif-near" aria-pressed=${String(gbifNear)} title="Occurrences GBIF autour de moi" @click=${() => this.#set({ near: nearOf(!gbifNear, inatNear) })}><i class="obs"></i>GBIF autour${near?.state === 'done' && near.gbifOn ? html` <small>${(near.gbifTotal ?? 0).toLocaleString('fr-FR')}</small>` : nothing}</button>` : nothing}
      </div>
    </div>`;
  }

  /**
   * « Sur cette carte » of the map's panel ▦: the same data as its scope bar's « Données » and its ⚙ form (MapConfig),
   * each as they say it — the GBIF distribution (France, the world, none), my places, the observations near me from
   * iNaturalist and GBIF (my position sent to it: asked as by its chip), the look-alike compared beside it (its chip's
   * ✕ when unticked). The same array while the same. @param {boolean} gbifReady
   * @param {import('../core/map-focus.js').SheetFocus} f @returns {import('./gf-map-options.js').DataRow[]}
   */
  #dataRows(gbifReady, f) {
    const c = this.config, about = this.#aboutPlant, n = this._spots.length;
    /** @type {import('./gf-map-options.js').DataRow[]} */
    const rows = [];
    if (gbifReady) rows.push({ key: 'gbif', kind: 'select', label: 'Répartition GBIF', hint: 'densité des occurrences connues', value: c.gbif,
      options: [{ value: 'fr', label: 'France' }, { value: 'world', label: 'Monde' }, { value: 'off', label: 'Non' }] });
    if (n || !about) {
      const chosen = c.subject === 'collection' ? this._collections?.find((/** @type {any} */ x) => x.id === c.collection) : null;
      const which = c.subject === 'results' ? 'avec des plantes des résultats' : c.subject !== 'collection' ? 'avec cette plante, et chaque plant'
        : chosen?.kind === 'place' ? 'choisi' : 'de la liste';
      rows.push({ key: 'places', kind: 'check', label: 'Mes lieux', hint: `${n} lieu${n > 1 ? 'x' : ''} ${which}`, value: c.places });
    }
    const near = (/** @type {string} */ source) => `autour de vous : votre position précise est envoyée à ${source}`;
    if (about && this.inatId && moduleOn('inaturalist')) rows.push({ key: 'inat', kind: 'check', label: 'Observations proches : iNaturalist', hint: near('iNaturalist'), value: c.near === 'inat' || c.near === 'both' });
    if (gbifReady) rows.push({ key: 'gbif-near', kind: 'check', label: 'Observations proches : GBIF', hint: near('GBIF'), value: c.near === 'gbif' || c.near === 'both' });
    if (f.compare) {
      const absent = this._compare?.key === null;
      rows.push({ key: 'compare', kind: 'check', label: 'Sosie : ' + f.compare.label, hint: absent ? 'absente de GBIF : rien à comparer' : 'sa répartition GBIF à côté, en violet', value: true });
    }
    const key = JSON.stringify(rows);
    if (this.#rowsMemo?.key !== key) this.#rowsMemo = { key, rows };
    return this.#rowsMemo.rows;
  }
  /** @type {{ key: string, rows: import('./gf-map-options.js').DataRow[] } | null} */ #rowsMemo = null;

  /**
   * A row of « Sur cette carte » changed (the map's panel ▦): as its scope bar's chip does — kept for this map (its
   * observations near me looked for at once: asked by this touch), the look-alike let go as by its chip's ✕.
   * @param {{ key: string, value: unknown }} d
   */
  #onData({ key, value }) {
    const c = this.config, on = Boolean(value);
    const gbifNear = c.near === 'gbif' || c.near === 'both', inatNear = c.near === 'inat' || c.near === 'both';
    if (key === 'gbif' && (value === 'fr' || value === 'world' || value === 'off')) this.#set({ gbif: value });
    else if (key === 'places') this.#set({ places: on });
    else if (key === 'inat') this.#set({ near: nearOf(gbifNear, on) });
    else if (key === 'gbif-near') this.#set({ near: nearOf(on, inatNear) });
    else if (key === 'compare' && !on) this.dispatchEvent(new CustomEvent('focus-clear', { detail: { kind: 'compare' }, bubbles: true, composed: true }));
  }

  /**
   * What the colours mean, where the data comes from, how many each source has: the lines of the map's panel
   * « Légende » (gf-map setLegend — not a block of text by the map; the quiet-map rule). Each new line said once.
   * @param {any} gbifOn @returns {{ text: string, swatch?: string }[]}
   */
  #legend(gbifOn) {
    const c = this.config;
    const near = this._near;
    /** @type {{ text: string, swatch?: string }[]} */
    const lines = [];
    const f = this.mapFocus || noFocus();
    // How many each source has, how many are placed as points — and those not placed twice (GBIF's copies of the
    // iNaturalist observations shown: #findNear, #occurrences).
    const placed = (/** @type {number} */ total, /** @type {number} */ n, /** @type {number} */ copies) =>
      `${total > n ? `, ${n.toLocaleString('fr-FR')} placée${n > 1 ? 's' : ''} en points` : ''}${copies ? `, ${copies} déjà sur iNaturalist` : ''}`;
    const occ = this._bounds?.count ? this.#occurrences() : null;
    if (gbifOn && f.filter) {
      const counted = this._bounds?.points === null ? ' …' : this._bounds?.count
        ? ` (${this._bounds.count.toLocaleString('fr-FR')}${placed(this._bounds.count, occ?.areaPlaced ?? (this._bounds.occ?.length || 0), occ?.areaCopies || 0)})` : '';
      lines.push({ text: `Occurrences GBIF : ${f.filter.label}${counted}`, swatch: 'obs' });
      if (this._bounds?.zone) lines.push({ text: `Limites : ${f.filter.label} (IGN)`, swatch: 'outline' });
    } else if (gbifOn) lines.push({ text: `Densité GBIF${c.gbif === 'fr' ? ' (France)' : ''}`, swatch: '#f97316' });
    if (f.compare && this._compare?.key) lines.push({ text: `${f.compare.label} (GBIF, comparaison)`, swatch: '#7b3294' });
    if (c.places && (this._spots.length || !this.#aboutPlant)) {
      const chosen = this._collections?.find((/** @type {any} */ x) => x.id === c.collection);
      lines.push({ text: c.subject === 'results' ? `Mes lieux avec des plantes des résultats (${this._spots.length})`
        : c.subject === 'collection' ? `${chosen?.kind === 'place' ? 'Le lieu' : 'Mes lieux de la liste'} « ${chosen?.name || '…'} » (${this._spots.length})`
        : `Mes lieux (${this._spots.length})` });
    }
    // Its observations around me, drawn alike whatever their source (while shown: #occurrences).
    if (near?.state === 'done' && c.near !== 'off') {
      if (near.inatOn) lines.push({ text: `iNaturalist (${near.inatCount ?? 0})`, swatch: 'obs' });
      if (near.gbifOn) lines.push({ text: `GBIF (${(near.gbifTotal ?? 0).toLocaleString('fr-FR')} à moins de ${formatDistance(near.radius)}${placed(near.gbifTotal ?? 0, near.gbifPlaced ?? 0, near.gbifCopies || 0)})`, swatch: 'obs' });
    }
    // A count that came (not « … »): said once.
    for (const l of lines) if (!l.text.endsWith('…') && /\d/.test(l.text) && !this.#legendSaid.has(l.text)) { this.#legendSaid.add(l.text); this.#toSay.push(l.text); }
    return lines;
  }
  /** The legend's lines said already. @type {Set<string>} */ #legendSaid = new Set();
}

customElements.define('gf-sheet-map', GfSheetMap);
