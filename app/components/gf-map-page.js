// @ts-check
import { LitElement, html, css, nothing, repeat } from 'lit';
import { GeoController } from '../core/geo.js';
import { href, parse } from '../core/router.js';
import { backTo, depth, entryValue, markEntry, pushHash, renewBehind, replaceHash } from '../core/history.js';
import { findEntry,
  directionsUrl, entryPosition, plantMarkers, distance, entryName, formatDistance, inSeason, listPlaces,
  placeAbundance, placeLastHarvest, placeTitle, plantCount, spotEvents, updatePlace, withEntry
} from '../core/collections.js';
import { RADII, exploreUrl, observationsAround, saveRadius, savedRadius, speciesAround } from '../core/nearby.js';
import { radiusLabel } from '../core/distance.js';
import { StoreController, whenReady } from '../core/store.js';
import { ui } from '../styles/ui.js';
import './gf-facet.js';
import './gf-map.js';
import './gf-spot-editor.js';
import './gf-thumb.js';
import { icon } from '../core/icons.js';
import { foldLetters as fold, unsigned } from '../core/fold.js';
import { getPlant, nameOf } from '../core/plants.js';
import { gbifTaxon } from '../core/sources.js';
import { mapDistribution, setMapDistribution } from '../core/map-settings.js';
import { moduleOn } from '../core/modules.js';
import { definePref } from '../core/prefs.js';
import { MediaController } from '../core/media.js';
import { PaneSizer, paneStyles } from '../core/panes.js';
import { config } from '../config.js';
import { hideImg, showImg } from '../core/img.js';
import { creditText, thumbCredit } from '../core/credit.js';
import { hintView, takeHint } from '../core/hints.js';

const shortDate = (/** @type {string} */ iso) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

const round = (/** @type {[number, number]} */ [x, y]) => /** @type {[number, number]} */ ([Math.round(x * 1e7) / 1e7, Math.round(y * 1e7) / 1e7]);

const PIN_COLORS = { rare: '#fb7185', moyen: '#fbbf24', abondant: '#38bdf8' };

/** The Carte's « Mes lieux » shown (« Sur cette carte » of its panel ▦): kept only when hidden. */
const placesPref = definePref({ key: config.storageKeys.mapPlaces, clean: v => v !== false, store: v => v ? null : false });

/**
 * Harvest places: IGN map or list sorted by distance, filters. A selected place opens in full beside the map
 * (below it on phones): the place editor, embedded — the Carte's map is the place's map.
 */
export class GfMapPage extends LitElement {
  static properties = {
    route: { attribute: false },
    _spots: { state: true },
    _view: { state: true },
    _plants: { state: true },
    _loaded: { state: true },
    _emptyHint: { state: true },
    _error: { state: true },
    _plantMenu: { state: true },
    _around: { state: true },
    _editing: { state: true },
    _panelFull: { state: true },
    _point: { state: true },
    _distribution: { state: true }
  };

  static styles = [ui, paneStyles, css`
    :host { display: flex; flex-direction: column; min-height: 0; position: relative; }
    .bar {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      padding: 8px 12px;
      background: var(--gf-bg);
      border-bottom: 1px solid var(--gf-border);
      font-size: 0.875rem;
      position: relative;
      z-index: 2;
    }
    .bar .count { margin-right: auto; font-weight: 600; }
    .plant-menu {
      position: absolute;
      top: calc(100% + 4px);
      left: 12px;
      width: min(340px, calc(100% - 24px));
      max-height: 60vh;
      overflow-y: auto;
      background: var(--gf-surface);
      border: 1px solid var(--gf-border);
      border-radius: var(--gf-radius);
      box-shadow: var(--gf-shadow-float);
      padding: 0 12px 8px;
    }
    .body { flex: 1; min-height: 0; position: relative; display: flex; flex-direction: column; }
    gf-map { flex: 1; min-height: 0; }
    /* The selected place, in full: beside the map on wide screens, below it on phones (half, or most of the height). */
    .panel {
      display: flex;
      flex-direction: column;
      min-height: 0;
      background: var(--gf-bg);
      overflow-y: auto;
      overscroll-behavior: contain;
      flex: 0 0 52%;
      border-top: 1px solid var(--gf-border);
      box-shadow: 0 -4px 14px rgb(0 0 0 / 10%);
      z-index: 1;
    }
    .panel.full { flex-basis: 84%; }
    .body.with-panel gf-map { min-height: 120px; }
    @media (min-width: 900px) {
      .body.with-panel { flex-direction: row; }
      .panel, .panel.full { flex: none; border-top: 0; border-left: 1px solid var(--gf-border); box-shadow: -4px 0 14px rgb(0 0 0 / 8%); }
      .panel .grip { display: none; }
      /* Wide screens: the place panel is a pane like Flore's, resizable by its separator, foldable (»). */
      .panel-head .fold { grid-column: 4; grid-row: 2 / span 2; }
      .panel-head { grid-template-columns: 1fr auto auto auto; }
      .body.with-panel > .rail { z-index: 1; }
    }
    .panel-head {
      position: sticky;
      top: 0;
      z-index: 2;
      display: grid;
      grid-template-columns: 1fr auto auto;
      align-items: center;
      gap: 2px 8px;
      padding: 6px 8px 8px 16px;
      background: var(--gf-bg);
      border-bottom: 1px solid var(--gf-border);
    }
    .panel-head h2 { margin: 0; font-size: 1.05rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .panel-head .meta { grid-column: 1; grid-row: 3; }
    .panel-head .button.small { grid-column: 2; grid-row: 2 / span 2; min-height: 34px; padding: 4px 12px; font-size: 0.85rem; }
    .panel-head .close { grid-column: 3; grid-row: 2 / span 2; }
    .panel-head h2 { grid-column: 1; grid-row: 2; }
    .grip { grid-column: 1 / -1; grid-row: 1; justify-self: center; width: 56px; height: 18px; min-height: 0; padding: 0; border: 0; background: none; position: relative; }
    .grip::before { content: ''; position: absolute; left: 12px; right: 12px; top: 7px; height: 4px; border-radius: 2px; background: var(--gf-border); }
    /* The place sheet covers the bottom of the map: hide Leaflet's bottom controls meanwhile. */
    .body:has(.sheet) gf-map .leaflet-bottom { display: none; }
    .fab {
      position: absolute;
      z-index: 600;
      right: 16px;
      /* Above the tab bar on a phone (the tab bar is outside this page, so no safe-area here). */
      bottom: 24px;
      width: 58px;
      height: 58px;
      border-radius: 50%;
      border: 0;
      background: var(--gf-accent);
      color: var(--gf-accent-contrast);
      font-size: 2rem;
      line-height: 1;
      justify-content: center;
      box-shadow: var(--gf-shadow-float);
      padding: 0;
      min-height: 0;
    }
    .sheet {
      position: absolute;
      z-index: 700;
      left: 8px;
      right: 8px;
      bottom: calc(8px + env(safe-area-inset-bottom));
      max-width: 560px;
      margin: 0 auto;
      background: var(--gf-surface);
      color: var(--gf-text);
      border-radius: var(--gf-radius-lg);
      box-shadow: var(--gf-shadow-float);
      padding: 14px 16px;
      display: grid;
      gap: 8px;
    }
    .sheet h2 { margin: 0; font-size: 1.1rem; padding-right: 32px; }
    .sheet .sci { font-family: var(--gf-font-serif); font-style: italic; color: var(--gf-text-muted); }
    .sheet .close { position: absolute; top: 4px; right: 4px; }
    .meta { font-size: 0.85rem; color: var(--gf-text-muted); display: flex; gap: 6px 12px; flex-wrap: wrap; }
    .meta .stars { color: var(--gf-star); letter-spacing: 1px; }
    .sheet .actions { margin-top: 4px; }
    .notes { font-size: 0.9rem; margin: 0; white-space: pre-line; }
    .sheet { max-height: 70%; overflow-y: auto; }
    .plants { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
    .plants li { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-top: 1px solid var(--gf-border); }
    .plants .who { flex: 1; min-width: 0; display: grid; }
    .plants .nm { font-weight: 600; }
    .plants .sub { font-size: 0.8rem; color: var(--gf-text-muted); }
    .plants .sub, .plants .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .plants li.focus { background: var(--gf-accent-soft); border-radius: var(--gf-radius-sm); padding-left: 6px; padding-right: 6px; }
    .plants gf-thumb { box-shadow: 0 0 0 2.5px var(--c); margin: 3px; }
    .plants .harvest { flex: none; }
    .around { max-height: 55%; }
    .around .radii { display: flex; gap: 6px; flex-wrap: wrap; }
        .around .back { justify-self: start; }
    .species li { padding: 0; }
    .species .pick { width: 100%; justify-content: flex-start; text-align: left; font-size: 1rem; font-weight: 400; gap: 10px; border: 0; border-radius: var(--gf-radius-sm); padding: 6px 4px; background: none; }
    .species .pick:hover { background: var(--gf-surface-2); }
    .species .n { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--gf-text-muted); }
    .around .ph { width: 38px; height: 38px; border-radius: var(--gf-radius-sm); object-fit: cover; flex: none; background: var(--gf-surface-2); }
    .recap { margin: 2px 0 0; font-size: 0.9rem; }
    .recap .muted { color: var(--gf-text-muted); font-size: 0.8rem; }
    .around-facets { margin-top: -4px; }
    .around .filter { min-height: 38px; padding: 7px 12px; font-size: 0.9rem; }
    .species-head { display: flex; gap: 12px; align-items: center; }
    .species-head .ph { width: 56px; height: 56px; }
    .source { font-size: 0.75rem; color: var(--gf-text-muted); margin: 0; }
    .species-head .credit { display: block; font-size: 0.72rem; color: var(--gf-text-muted); }
    .source a { color: inherit; }
    .list { flex: 1; overflow-y: auto; margin: 0; padding: 0 0 96px; list-style: none; background: var(--gf-surface); }
    .list a {
      display: grid;
      grid-template-columns: 14px 1fr auto;
      gap: 4px 12px;
      align-items: center;
      padding: 10px 16px;
      border-bottom: 1px solid var(--gf-border);
      color: inherit;
      text-decoration: none;
    }
    .list a:hover { background: var(--gf-surface-2); }
    .list .dot { width: 12px; height: 12px; border-radius: 50%; background: var(--c); border: 1px solid rgb(0 0 0 / 20%); grid-row: span 2; }
    .list .title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .list .dist { font-variant-numeric: tabular-nums; color: var(--gf-text-muted); font-size: 0.85rem; text-align: right; }
    .list .sub { grid-column: 2 / -1; font-size: 0.8rem; color: var(--gf-text-muted); }
    .empty { padding: 32px 20px; text-align: center; color: var(--gf-text-muted); max-width: 420px; margin: 0 auto; }
    /* The empty Carte's first-use hint (once per device, its ✕): a strip above the map, not over it — so it never
       covers a control (Leaflet's zoom and scale, MapLibre's, the « Observations autour » chip). */
    .empty-hint { flex: none; margin: 8px 12px 0; box-shadow: none; background: var(--gf-surface-2); }
    .bar .count.error { color: var(--gf-danger); display: inline-flex; align-items: center; gap: 6px; }
    .bar .count.error .link { min-height: 0; padding: 0 4px; }
  `];

  #geo = new GeoController(this);
  #store = new StoreController(this);
  get #harvest() { return this.#store.state.harvestMode; }
  #onSpotsChange = () => this.#load();
  /** « Mes lieux » shown or hidden in another tab. */
  #redraw = () => this.requestUpdate();

  constructor() {
    super();
    /** @type {any} */
    this.route = { name: 'map', spot: null, plants: [], season: false };
    /** @type {import('../core/collections.js').Place[]} */
    this._spots = [];
    /** @type {string | null} */
    this._error = null;
    /** @type {'map' | 'list'} */
    this._view = 'map';
    /** The plant filter: the address's (plants=). @type {number[]} */
    this._plants = [];
    /** One plant filtered: its GBIF distribution, offered in the Carte panel. @type {{ key: number, label: string } | null} */
    this._distribution = null;
    /** The places read once (before: no « no place yet » hint). */
    this._loaded = false;
    /** The empty Carte's way to start: a first-use hint (core/hints.js), until its ✕. */
    this._emptyHint = false;
    this._plantMenu = false;
    /**
     * "Autour": iNaturalist species observed in a circle.
     * @type {null | { center: [number, number], radius: number, where: string, status: 'loading' | 'ok' | 'error',
     *   error?: string, result?: import('../core/nearby.js').NearbyResult, species?: import('../core/nearby.js').NearbySpecies | null,
     *   obs?: import('../core/nearby.js').NearbyObservation[] | null, frame: string,
     *   thumb?: { url: string, credit: import('../core/credit.js').Credit | null } | null }}
     */
    this._around = null;
    /** The map is in position editing (its ✎ control): the sheets and Autour wait. */
    this._editing = false;
    /** Phones: the place panel takes most of the height (else half, the map above). */
    this._panelFull = false;
  }

  /**
   * ✓ Valider on the map: moved places and plants, saved place by place.
   * @param {{ places: { id: string, coordinates: [number, number] }[], plants: { placeId: string, entryId?: string, plantId: number | null, coordinates: [number, number] }[] }} moves
   */
  async #savePositions({ places, plants }) {
    // Only the selected place moved: its panel's editor holds it, it saves the moves with its other edits.
    const editor = /** @type {any} */ (this.renderRoot.querySelector('gf-spot-editor'));
    const id = this.route.spot;
    if (editor && id && places.every(p => p.id === id) && plants.every(p => p.placeId === id)) {
      editor.savePositions({ pin: places[0]?.coordinates ?? null, plants });
      this.#map?.announce('Position enregistrée');
      return;
    }
    // The moves of each place, applied to it as stored now (in one transaction: nothing changed meanwhile is lost).
    /** @type {Map<string, ((place: any) => any)[]>} */
    const changes = new Map();
    const add = (/** @type {string} */ id, /** @type {(place: any) => any} */ change) => {
      if (this._spots.some(s => s.id === id)) changes.set(id, [...changes.get(id) || [], change]);
    };
    for (const { id, coordinates } of places) {
      add(id, place => ({ ...place, geometry: { type: 'Point', coordinates: round(coordinates) }, properties: { ...place.properties, accuracy: null } }));
    }
    for (const { placeId, entryId, plantId, coordinates } of plants) {
      add(placeId, place => withEntry(place, entryId ?? plantId, { coordinates: round(coordinates), accuracy: null }));
    }
    // Saved: said to screen readers only (the user's own drag needs no toast); failed: one brief toast over the map,
    // in the top layer (over the full-screen editing frame).
    try {
      for (const [id, list] of changes) await updatePlace(id, place => list.reduce((p, change) => change(p), place));
      this.#map?.announce('Position enregistrée');
    } catch (error) {
      this.#map?.toast('Enregistrement impossible : ' + /** @type {Error} */ (error).message);
    }
  }

  /** The Carte's map (gf-map: what it says goes through it — the quiet-map rule). @returns {any} */
  get #map() { return this.renderRoot.querySelector('gf-map'); }

  /** @type {AbortController | null} */ #aroundAbort = null;
  #aroundFrames = 0;

  /** A point was picked on the map (long press, search): its card replaces the place sheet. */
  #onPointInfo() {
    this._point = true;
    if (this._editing) return;
    this.#aroundAbort?.abort();
    this._around = null;
    if (this.route.spot) this.#navigate({ spot: null });
  }

  #hidePoint() {
    /** @type {any} */ (this.renderRoot.querySelector('gf-map'))?.hidePoint();
  }

  /** Opens "Autour" on the selected place, else my position, else the map centre. */
  #toggleAround() {
    if (this._around) { this.#aroundAbort?.abort(); this._around = null; return; }
    this.#hidePoint();
    const selected = this._spots.find(s => s.id === this.route.spot);
    const fix = this.#geo.state.fix;
    const map = /** @type {any} */ (this.renderRoot.querySelector('gf-map'));
    if (selected) this.#searchAround(selected.geometry.coordinates, placeTitle(selected));
    else if (fix) this.#searchAround(fix.coordinates, 'ma position');
    else if (map?.center()) this.#searchAround(map.center(), 'centre de la carte');
  }

  /** @param {[number, number]} center @param {string} where @param {number} [radius] */
  async #searchAround(center, where, radius = this._around?.radius ?? savedRadius()) {
    this.#aroundAbort?.abort();
    const abort = this.#aroundAbort = new AbortController();
    this._view = 'map';
    this._around = { center, radius, where, status: 'loading', species: null, obs: null, frame: 'around:' + (++this.#aroundFrames),
      filter: { q: '', families: /** @type {string[]} */ ([]), genera: /** @type {string[]} */ ([]), open: { families: false, genera: false } } };
    try {
      const result = await speciesAround(center, radius, abort.signal);
      if (abort.signal.aborted) return;
      this._around = { ...this._around, status: 'ok', result };
      const n = result.species.length;
      this.#map?.announce(n ? `Autour : ${n} espèce${n > 1 ? 's' : ''} observée${n > 1 ? 's' : ''}` : 'Autour : aucune observation validée de plante dans ce cercle');
    } catch (error) {
      if (abort.signal.aborted) return;
      const off = /** @type {Error} */ (error).name === 'ModuleOffError';
      const text = off ? 'Le module iNaturalist est désactivé.'
        : navigator.onLine === false ? 'Hors ligne : les observations ne peuvent pas être chargées.' : 'iNaturalist ne répond pas pour le moment.';
      // Asked, failed: one brief toast over the map; the sheet keeps what to do (Réessayer, Réglages).
      this._around = { ...this._around, status: 'error', off, error: text };
      this.#map?.toast(text);
    }
  }

  /** @param {import('../core/nearby.js').NearbySpecies | null} species */
  async #pickSpecies(species) {
    const around = this._around;
    if (!around) return;
    this._around = { ...around, species, obs: null, thumb: null };
    if (!species) return;
    // No photo of iNaturalist's under a free licence (its default one, CC BY-NC, is never shown): the flora's
    // thumbnail on its points, with its credit — never a bare dot for a plant the app has a photo of.
    if (!species.photo && species.plantId) getPlant(species.plantId).then(plant => {
      const t = /** @type {any} */ (plant)?.thumbnail;
      if (t?.url && this._around?.species === species) this._around = { ...this._around, thumb: { url: t.url, credit: thumbCredit(t) } };
    });
    /** @type {any[]} */ let obs = [];
    try { obs = await observationsAround(species.taxonId, around.center, around.radius); } catch { /* none placed */ }
    if (this._around?.species !== species) return;
    this._around = { ...this._around, obs };
    // How many are on the map: said (the sheet keeps the species' own count).
    const name = species.common || species.name;
    this.#map?.announce(obs.length ? `${name} : ${obs.length} point${obs.length > 1 ? 's' : ''} sur la carte${obs.length < species.count ? ' (les plus récents)' : ''}`
      : `${name} : aucun point localisé`);
  }

  /** Search text / family chip of the species list (kept while a species is open). @param {object} patch */
  #filterAround(patch) {
    const a = this._around;
    if (a) this._around = { ...a, filter: { ...a.filter, ...patch } };
  }

  /**
   * The circle for gf-map, with the chosen species' observations — the same object while they do not change: the
   * map redraws them only then (its markers bounce in once, not at each render, a GPS fix…).
   */
  get #area() {
    const a = this._around;
    if (!a) return null;
    // The species picked: its photo on each of its observations (when photos are on) — iNaturalist's, else the flora's.
    const own = a.species?.photo || a.thumb?.url || null;
    const photo = own && this.#store.state.modules.photos ? own : null;
    const m = this.#areaMemo;
    if (m && m.center === a.center && m.radius === a.radius && m.obs === a.obs && m.species === a.species && m.photo === photo) return m.value;
    const name = a.species ? a.species.common || a.species.name : '';
    const value = {
      center: a.center,
      radius: a.radius,
      photo,
      // Its credit (author, licence: a free one, nearby.js), on each point's card.
      credit: !photo ? null : a.species?.photo ? a.species.credit || null : a.thumb?.credit || null,
      points: (a.obs || []).map(o => ({ coordinates: o.coordinates, title: name + (o.date ? ' · ' + shortDate(o.date) : ''), url: o.url,
        common: a.species?.common || null, sci: a.species?.name || '', date: o.date || null }))
    };
    this.#areaMemo = { center: a.center, radius: a.radius, obs: a.obs, species: a.species, photo, value };
    return value;
  }
  /** @type {any} */ #areaMemo = null;

  /** Frames the whole circle above the panel. */
  get #aroundFrame() {
    const a = this._around;
    if (!a) return null;
    const [lon, lat] = a.center;
    const dLat = a.radius / 111320;
    const dLon = a.radius / (111320 * Math.cos(lat * Math.PI / 180));
    return { key: a.frame + ':' + a.radius, points: [[lon - dLon, lat - dLat], [lon + dLon, lat + dLat]], bottom: 0.45 };
  }

  #aroundPanel() {
    const a = /** @type {NonNullable<typeof this._around>} */ (this._around);
    const head = html`
      <button class="close icon-btn" type="button" aria-label="Fermer" @click=${() => this.#toggleAround()}>${icon('x-lg')}</button>
      <h2>Autour · ${radiusLabel(a.radius)}</h2>
      <div class="meta"><span>Centre envoyé à iNaturalist : ${a.where}</span>
        <button type="button" class="link" @click=${() => {
          const c = /** @type {any} */ (this.renderRoot.querySelector('gf-map'))?.center();
          if (c) this.#searchAround(c, 'centre de la carte');
        }}>Chercher au centre de la carte</button></div>
      <div class="radii" role="group" aria-label="Rayon">
        ${RADII.map(r => html`<button type="button" aria-pressed=${r === a.radius ? 'true' : 'false'}
          @click=${() => { saveRadius(r); this.#searchAround(a.center, a.where, r); }}>${radiusLabel(r)}</button>`)}
      </div>`;
    const source = html`<p class="source">Source : <a href=${a.species ? exploreUrl(a.center, a.radius, a.species.taxonId) : exploreUrl(a.center, a.radius)}
      target="_blank" rel="noopener">iNaturalist</a>, observations validées (niveau recherche), toutes dates. Photos d’iNaturalist sous licence libre seulement (CC0, CC BY, CC BY-SA) ; auteur et licence en ouvrant l’espèce.</p>`;

    // Coming: the sheet's head only (aria-busy; the map's thin line past 400 ms). Failed: the brief toast said why; the
    // sheet keeps what to do, its button named by it.
    if (a.status === 'loading') return html`<section class="sheet around" aria-label="Autour" aria-busy="true">${head}</section>`;
    if (a.status === 'error') return html`<section class="sheet around" aria-label="Autour">${head}
      <div class="actions">${a.off
        ? html`<a class="button" href=${href.settings()} title=${a.error || ''}>Réglages › Modules</a>`
        : html`<button type="button" title=${a.error || ''} @click=${() => this.#searchAround(a.center, a.where)}>Réessayer</button>`}</div></section>`;

    const result = /** @type {import('../core/nearby.js').NearbyResult} */ (a.result);
    const s = a.species;
    if (s) {
      return html`<section class="sheet around" aria-label="Autour">
        <button class="close icon-btn" type="button" aria-label="Fermer" @click=${() => this.#toggleAround()}>${icon('x-lg')}</button>
        <button type="button" class="link back" @click=${() => this.#pickSpecies(null)}>${icon('arrow-left')} Toutes les espèces</button>
        <div class="species-head">
          ${s.plantId ? html`<gf-thumb plant-id=${s.plantId} size="56"></gf-thumb>` : s.photo && this.#store.state.modules.photos ? html`<img class="ph" src=${s.photo} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error=${hideImg} @load=${showImg} />` : nothing}
          <div><h2>${s.common || s.name}</h2>${s.common ? html`<span class="sci">${s.name}</span>` : nothing}
            ${!s.plantId && s.photo && s.credit && this.#store.state.modules.photos ? html`<small class="credit">Photo : ${creditText(s.credit)}</small>` : nothing}</div>
        </div>
        <div class="meta" aria-busy=${a.obs === null ? 'true' : 'false'}><span>${s.count} observation${s.count > 1 ? 's' : ''} dans le cercle</span></div>
        <div class="actions">
          ${s.plantId ? html`<a class="button primary" href=${href.plant(s.plantId)}>Fiche de la plante</a>` : html`<span class="notes">Absente de la flore de l’app (TAXREF).</span>`}
          <a class="button" href=${exploreUrl(a.center, a.radius, s.taxonId)} target="_blank" rel="noopener">Observations</a>
        </div>
        ${source}
      </section>`;
    }
    const all = result.species;
    const plural = (/** @type {number} */ n, /** @type {string} */ word) => `${n.toLocaleString('fr-FR')} ${word}${n > 1 ? 's' : ''}`;
    const familyCount = new Set(all.map(sp => sp.family).filter(Boolean)).size;
    const genusCount = new Set(all.map(sp => sp.genus).filter(Boolean)).size;
    const outside = all.filter(sp => !sp.plantId).length;

    // Search + two multi-select filters (Famille, Genre). Each filter's counts take the others into account.
    const { q, families, genera, open } = a.filter;
    const needle = fold(q.trim());
    const bySearch = (/** @type {any} */ sp) => !needle || fold([sp.common, sp.name, sp.genus, sp.family].filter(Boolean).join(' ')).includes(needle);
    const byFamily = (/** @type {any} */ sp) => !families.length || families.includes(sp.family);
    const byGenus = (/** @type {any} */ sp) => !genera.length || genera.includes(sp.genus);
    const shown = all.filter(sp => bySearch(sp) && byFamily(sp) && byGenus(sp));
    const filtered = Boolean(needle || families.length || genera.length);
    const tally = (/** @type {any[]} */ list, /** @type {'family' | 'genus'} */ key) => {
      const counts = new Map();
      for (const sp of list) if (sp[key]) counts.set(sp[key], (counts.get(sp[key]) || 0) + 1);
      return counts;
    };
    const familyHits = tally(all.filter(sp => bySearch(sp) && byGenus(sp)), 'family');
    const genusHits = tally(all.filter(sp => bySearch(sp) && byFamily(sp)), 'genus');
    // Fixed order (most species in the circle first): choosing a value never reorders the lists. A hybrid genus
    // (« × Dactylodenia ») among the others, at its name (core/fold.js).
    const ranked = (/** @type {Map<string, number>} */ totals) => [...totals].sort((x, y) => y[1] - x[1] || unsigned(x[0]).localeCompare(unsigned(y[0]), 'fr')).map(([v]) => v);
    const familyOptions = ranked(tally(all, 'family')).map(f => ({ value: f, label: f, count: familyHits.get(f) || 0 }));
    // Genera of the chosen families only (as in the Flore filters).
    const genusOptions = ranked(tally(all.filter(byFamily), 'genus')).map(g => ({ value: g, label: g, count: genusHits.get(g) || 0 }));

    return html`<section class="sheet around" aria-label="Autour">
      ${head}
      <p class="recap">
        <strong>${plural(all.length, 'espèce')}</strong> · <strong>${plural(familyCount, 'famille')}</strong>
        · <strong>${plural(genusCount, 'genre')}</strong> · ${plural(result.observations, 'observation')}
        ${outside ? html`<span class="muted" title="Absentes de la flore de l’app (TAXREF) : famille inconnue">(${outside} hors flore)</span>` : nothing}
      </p>
      ${all.length ? html`
        <input type="search" class="filter" placeholder="Filtrer : nom, genre, famille…" aria-label="Filtrer les espèces"
          .value=${q} @input=${e => this.#filterAround({ q: e.target.value })} />
        <div class="around-facets" @facet-change=${e => {
          e.stopPropagation();
          const { name, values } = e.detail;
          if (name === 'families') {
            // Genera outside the chosen families no longer apply.
            const keep = new Set(all.filter(sp => !values.length || values.includes(sp.family)).map(sp => sp.genus));
            this.#filterAround({ families: values, genera: genera.filter(g => keep.has(g)) });
          } else this.#filterAround({ genera: values });
        }} @facet-toggle=${e => { e.stopPropagation(); this.#filterAround({ open: { ...open, [e.detail.name]: e.detail.open } }); }}>
          ${familyOptions.length ? html`<gf-facet name="families" label="Famille" stack="0" searchable ordered limit="6" .open=${open.families || families.length > 0}
            .selected=${families} .options=${familyOptions}></gf-facet>` : nothing}
          <gf-facet name="genera" label="Genre" stack="1" searchable ordered limit="6" hide-empty .open=${open.genera || genera.length > 0}
            .selected=${genera} .options=${genusOptions}></gf-facet>
        </div>
        ${filtered ? html`<div class="meta"><span><strong>${shown.length}</strong> / ${plural(all.length, 'espèce')}</span>
          <button type="button" class="link" @click=${() => this.#filterAround({ q: '', families: [], genera: [] })}>Effacer</button></div>` : nothing}
        ${shown.length ? html`<ul class="plants species">
          ${shown.map(sp => html`<li><button type="button" class="pick" @click=${() => this.#pickSpecies(sp)}>
            ${sp.plantId ? html`<gf-thumb plant-id=${sp.plantId} size="38"></gf-thumb>`
              : sp.photo && this.#store.state.modules.photos ? html`<img class="ph" src=${sp.photo} alt="" title=${creditText(sp.credit)} loading="lazy" decoding="async" referrerpolicy="no-referrer" @error=${hideImg} @load=${showImg} />` : html`<gf-thumb size="38"></gf-thumb>`}
            <span class="who"><span class="nm">${sp.common || sp.name}</span>
              <span class="sub">${sp.common ? html`<i>${sp.name}</i>` : nothing}${sp.common && sp.family ? ' · ' : ''}${sp.family || ''}</span></span>
            <span class="n">${sp.count}</span>
          </button></li>`)}
        </ul>` : html`<p class="notes">Aucune espèce ne correspond.</p>`}`
      : html`<p class="notes">Aucune observation validée de plante dans ce cercle. Essayez un rayon plus grand.</p>`}
      ${source}
    </section>`;
  }

  connectedCallback() {
    super.connectedCallback();
    spotEvents.addEventListener('change', this.#onSpotsChange);
    placesPref.events.addEventListener('change', this.#redraw);
    this.#load();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    spotEvents.removeEventListener('change', this.#onSpotsChange);
    placesPref.events.removeEventListener('change', this.#redraw);
  }

  /**
   * « Sur cette carte » of the map's panel ▦: what the Carte draws on it, as its own controls say — the GBIF
   * distribution of the one plant filtered (kept: core/map-settings.js mapDistribution), my places (kept: placesPref),
   * the plants observed around (« Autour », the bar's button: off while the places are moved). The same array while
   * the same. @param {number} count the places the filters keep
   * @returns {import('./gf-map-options.js').DataRow[]}
   */
  #dataRows(count) {
    /** @type {import('./gf-map-options.js').DataRow[]} */
    const rows = [];
    const d = this._distribution;
    if (d && moduleOn('gbif')) rows.push({ key: 'distribution', kind: 'check', label: 'Répartition GBIF : ' + d.label, hint: 'densité des occurrences connues', value: mapDistribution() });
    rows.push({ key: 'places', kind: 'check', label: 'Mes lieux', hint: count ? `${count} lieu${count > 1 ? 'x' : ''}, et leurs plantes` : 'aucun lieu', value: placesPref.get() });
    rows.push({ key: 'around', kind: 'check', label: 'Plantes observées autour',
      hint: 'envoyé à iNaturalist : le lieu choisi, sinon votre position, sinon le centre de la carte', value: Boolean(this._around),
      disabled: this._editing, why: 'Pas pendant le déplacement des lieux (✎).' });
    const key = JSON.stringify(rows);
    if (this.#rowsMemo?.key !== key) this.#rowsMemo = { key, rows };
    return this.#rowsMemo.rows;
  }
  /** @type {{ key: string, rows: import('./gf-map-options.js').DataRow[] } | null} */ #rowsMemo = null;

  /**
   * A row of « Sur cette carte » changed (the map's panel ▦): as its own control does — kept, or « Autour » opened or
   * closed as by the bar's button. @param {{ key: string, value: unknown }} d
   */
  #onData({ key, value }) {
    if (key === 'distribution') setMapDistribution(Boolean(value));
    else if (key === 'places') placesPref.set(Boolean(value));
    else if (key === 'around' && Boolean(value) !== Boolean(this._around)) this.#toggleAround();
    this.requestUpdate();
  }

  /** @param {Map<string, any>} changed */
  updated(changed) {
    if (changed.has('_plants')) this.#findDistribution();
    // What the map says (the quiet-map rule): Autour's plants or points coming — its thin line past 400 ms; the places
    // unreadable — its state (and the bar's « Réessayer »); my places hidden — its state too.
    const map = this.#map, a = this._around;
    map?.busy('around', Boolean(a && (a.status === 'loading' || (a.species && a.obs === null))), 'Recherche des observations autour');
    map?.setStatus('places', this._error, { level: 'error' });
    map?.setStatus('places-hidden', placesPref.get() ? '' : 'Mes lieux masqués : seul le lieu ouvert est sur la carte (▦ › Sur cette carte).', { once: true });
  }

  /** Exactly one plant filtered: look up its GBIF taxon, for the distribution layer. */
  async #findDistribution() {
    const id = this._plants.length === 1 ? this._plants[0] : null;
    if (id === null) { this._distribution = null; return; }
    if (this._distribution && this.#distributionFor === id) return;
    this.#distributionFor = id;
    this._distribution = null;
    try {
      const plant = await getPlant(id);
      const taxon = plant ? await gbifTaxon(plant) : null;
      if (this.#distributionFor === id && taxon?.id) {
        this._distribution = { key: taxon.id, label: nameOf(plant) };
      }
    } catch { /* GBIF off or unreachable: no layer offered */ }
  }

  /** @type {number | null} */ #distributionFor = null;

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    // Lit re-applies object properties on every parent render: the app passing its (unchanged) route again
    // must not undo the selection this page made with replaceState.
    // Also when the app re-renders in the middle of this page's own change (the context follows the URL and
    // updates the store): the page's route stays.
    if (changed.has('route') && this.route === this.#parentRoute && this.#ownRoute && this.route !== this.#ownRoute) {
      this.route = this.#ownRoute;
      this.#internalRoute = true;
    }
    if (changed.has('route') && !this.#internalRoute) this.#markBase(changed.get('route'));
    if (changed.has('route') && !this.#internalRoute) {
      this.#parentRoute = this.route;
      this.#ownRoute = null;
    }
    // The plant filter is the address's: a link, Back, Forward, a reload, the Carte tab give theirs.
    if (changed.has('route') && !this.#internalRoute && this.route.plants.join() !== this._plants.join()) this._plants = [...this.route.plants];
    // Arriving on a place from elsewhere (Mes plantes, the editor, a link): frame it with all its plants.
    if (changed.has('route') && !this.#internalRoute && this.route.spot) {
      if (this.route.add || this.route.pick) this.#arrival = { spot: this.route.spot, add: this.route.add, pick: this.route.pick };
      this.#frameKey = this.route.spot + ':' + (++this.#frames);
    }
    this.#internalRoute = false;
    const base = entryValue('gfMapBase');
    this.#base = this.route.spot && typeof base === 'number' ? base : null;
  }

  #internalRoute = false;

  /**
   * A place opened by a link (a list row, a marker) or reached by Back / Forward: remember in its history
   * entry where the map was before the first place opened, so closing it goes back there.
   * @param {any} before the previous route
   */
  #markBase(before) {
    if (!this.route?.spot || typeof entryValue('gfMapBase') === 'number') return;
    if (before?.name !== 'map') return;
    markEntry({ gfMapBase: before.spot && typeof this.#base === 'number' ? this.#base : depth() - 1 });
  }

  /** The base of the place shown last (see #markBase). @type {number | null} */
  #base = null;
  /** « Add this plant » / « pick a plant » asked for a place when arriving on it; kept while it stays selected. @type {{ spot: string, add: number | null, pick: boolean } | null} */
  #arrival = null;
  /** Route last received from the app, and the one this page navigated to since (replaceState). @type {any} */
  #parentRoute = null;
  /** @type {any} */ #ownRoute = null;
  #frames = 0;
  /** @type {string | null} */ #frameKey = null;

  /** Zoom target for the map: the arrived-on place, its point and every plant's own position. */
  get #frame() {
    const place = this.#frameKey && this._spots.find(s => s.id === this.route.spot);
    if (!place || !this.#frameKey?.startsWith(place.id + ':')) return null;
    return {
      key: this.#frameKey,
      points: [place.geometry.coordinates, ...place.properties.plants.map(e => entryPosition(place, e))]
    };
  }

  async #load() {
    await whenReady();
    try {
      this._spots = await listPlaces();
      this._error = null;
      // No place yet: how to start, said once per device on the map (core/hints.js); then the bar's « 0 lieu » and
      // the list say it.
      if (!this._loaded && !this._spots.length) this._emptyHint = takeHint('carte-empty');
      this._loaded = true;
    } catch (error) {
      console.error(error);
      this._error = 'Lieux illisibles pour le moment : ' + /** @type {Error} */ (error).message;
    }
    document.title = 'Carte des lieux — GeoFlora';
  }

  /**
   * Keeps the URL in sync with selection and filters. Opening a place is a view (Back closes it, closing it
   * goes back); the focused plant, the season and the plant filter update the view in place.
   */
  /** The marker of the focused plant of the selected place (an occurrence, or a plant's first). @param {any[]} spots */
  #focusKey(spots) {
    const { spot, focus } = this.route;
    if (!spot || !focus) return null;
    const place = spots.find(s => s.id === spot);
    const entry = place && findEntry(place, focus);
    return entry ? spot + ':' + entry.id : null;
  }

  /** @param {{ spot?: string | null, focus?: string | number | null, season?: boolean }} patch */
  #navigate(patch) {
    const next = { ...this.route, ...(patch.spot !== undefined && !('focus' in patch) ? { focus: null } : {}), ...patch };
    const hash = href.map({
      spot: next.spot || undefined,
      focus: next.spot && next.focus ? next.focus : undefined,
      season: next.season,
      plants: this._plants
    });
    const opened = (next.spot || null) !== (this.route.spot || null);
    // The map's entry before the first place opened: closing a place goes back there — given the filters as they are
    // now (its URL would otherwise undo « En saison » and the plant filter changed beside the place).
    const base = entryValue('gfMapBase');
    if (opened && next.spot) pushHash(hash, { gfMapBase: typeof base === 'number' ? base : depth() }, false);
    else if (opened && typeof base === 'number') { renewBehind(base, hash); backTo(base, hash); }
    else replaceHash(hash);
    if (next.spot !== this.#arrival?.spot) this.#arrival = null;
    // Every place selected is framed with all its plants (above its sheet).
    if (next.spot !== this.route.spot) this.#frameKey = next.spot ? next.spot + ':' + (++this.#frames) : null;
    this.#internalRoute = true;
    this.route = this.#ownRoute = parse(hash);
  }

  get #filtered() {
    const plants = new Set(this._plants);
    return this._spots.filter(place =>
      (!plants.size || place.properties.plantIds.some(id => plants.has(id))) &&
      (!this.route.season || !this.#harvest || inSeason(place)));
  }

  /** @param {import('../core/collections.js').Place} spot */
  #distanceTo(spot) {
    const fix = this.#geo.state.fix;
    return fix ? distance(fix.coordinates, spot.geometry.coordinates) : null;
  }

  #plantOptions() {
    const counts = new Map();
    for (const place of this._spots) {
      for (const e of place.properties.plants) {
        if (e.plantId === null) continue;
        const option = counts.get(e.plantId) || { value: String(e.plantId), label: entryName(e), count: 0 };
        option.count++;
        counts.set(e.plantId, option);
      }
    }
    return [...counts.values()].sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  }

  render() {
    const spots = this.#filtered;
    const selected = this._spots.find(s => s.id === this.route.spot) || null;
    const seasonCount = this._spots.filter(s => inSeason(s)).length;
    // « Mes lieux » hidden (« Sur cette carte »): on the map, only the place opened (framed, its sheet beside it, moved
    // by ✎) — the list and the bar's count keep them all, the panel's « État » says so; ✎ only with a place to move.
    const drawn = placesPref.get() ? spots : spots.filter(s => s.id === this.route.spot);

    return html`
      <h1 class="visually-hidden">Carte des lieux</h1>
      <div class="bar">
        ${this._error ? html`<span class="count error" title=${this._error}>${icon('exclamation-triangle-fill')} Lieux illisibles
          <button type="button" class="link" @click=${() => this.#load()}>Réessayer</button></span>`
          : html`<span class="count">${spots.length} lieu${spots.length > 1 ? 'x' : ''}</span>`}
        ${this.#harvest ? html`<button type="button" aria-pressed=${this.route.season ? 'true' : 'false'}
          @click=${() => this.#navigate({ season: !this.route.season, spot: null })}>En saison · ${seasonCount}</button>` : nothing}
        <button type="button" aria-expanded=${this._plantMenu ? 'true' : 'false'} aria-pressed=${this._plants.length ? 'true' : 'false'}
          @click=${() => { this._plantMenu = !this._plantMenu; }}>Plantes${this._plants.length ? ' · ' + this._plants.length : ''} ${icon('chevron-down')}</button>
        <button type="button" class="around-toggle" ?disabled=${this._editing} aria-pressed=${this._around ? 'true' : 'false'}
          title="Plantes observées autour (iNaturalist) : le lieu choisi, sinon votre position, sinon le centre de la carte est envoyé à iNaturalist" @click=${() => this.#toggleAround()}>Autour</button>
        <div class="segmented" role="group" aria-label="Affichage">
          <button type="button" aria-pressed=${this._view === 'map' ? 'true' : 'false'} @click=${() => { this._view = 'map'; }}>Carte</button>
          <button type="button" ?disabled=${this._editing} aria-pressed=${this._view === 'list' ? 'true' : 'false'} @click=${() => { this._view = 'list'; }}>Liste</button>
        </div>
        ${this._plantMenu ? html`
          <div class="plant-menu">
            <gf-facet name="plant" label="Plantes" searchable .selected=${this._plants.map(String)} .options=${this.#plantOptions()}
              @facet-change=${e => { this._plants = e.detail.values.map(Number); this.#navigate({ spot: null }); }}></gf-facet>
          </div>` : nothing}
      </div>

      <div class="body ${selected && this._view === 'map' && !this._around ? 'with-panel' : ''}" @click=${() => { if (this._plantMenu) this._plantMenu = false; }}>
        ${this._view === 'map' ? html`
          ${this.#empty()}
          <gf-map
            .spots=${drawn}
            .selectedId=${this.route.spot}
            .plants=${this.#plantMarkers(drawn)}
            .distribution=${this._distribution}
            .distributionOn=${mapDistribution()}
            .data=${this.#dataRows(spots.length)}
            @data-change=${e => this.#onData(e.detail)}
            plant-zoom="16"
            ?editable=${drawn.length > 0 || placesPref.get() || this._editing}
            ?editing=${this._editing}
            @edit-change=${e => {
              this._editing = e.detail.editing;
              if (this._editing) { this.#aroundAbort?.abort(); this._around = null; }
            }}
            @positions-save=${e => this.#savePositions(e.detail)}
            .selectedPlant=${this.#focusKey(spots)}
            remember
            @point-info=${() => this.#onPointInfo()}
            @point-close=${() => { this._point = false; }}
            .frame=${this.#aroundFrame || this.#frame}
            .area=${this.#area}
            ?fit=${Boolean(this._plants.length && !this.#frameKey)}
            @spot-select=${e => { this.#hidePoint(); this.#navigate({ spot: e.detail.id }); }}
            @plant-select=${e => this.#navigate({ spot: e.detail.placeId, focus: e.detail.entryId ?? e.detail.plantId })}
          ></gf-map>
          ${this._editing || !this._around ? nothing : this.#aroundPanel()}
          ${selected && !this._around ? this.#panel(selected) : nothing}
        ` : html`${this.#list(spots)}${this.#empty()}`}

        ${(selected || this._editing) && this._view === 'map' ? nothing : html`
          <button class="fab" type="button" aria-label="Noter une plante ici" title="Noter une plante ici : dans un lieu proche ou un nouveau lieu"
            @click=${() => this.dispatchEvent(new CustomEvent('open-capture', { bubbles: true, composed: true }))}>+</button>`}
      </div>
    `;
  }

  /**
   * No place yet. The list: says so, and how to start. The map: the same words once per device (a first-use hint, its
   * ✕, in a strip above the map), never again — then the bar's « 0 lieu » and the list say it (the quiet-map rule, gf-map.js).
   */
  #empty() {
    if (!this._loaded || this._spots.length || this._error) return nothing;
    const words = html`Aucun lieu enregistré. Sur place, touchez <strong>+</strong> pour créer un lieu et y noter les plantes qui y poussent, ou ouvrez une fiche plante et touchez « Ajouter un lieu ».`;
    if (this._view === 'list') return html`<p class="empty">${words}</p>`;
    if (!this._emptyHint || this._point || this._around || this._editing) return nothing;
    return hintView(words, () => { this._emptyHint = false; }, 'empty-hint');
  }

  /** Plant markers of the shown places (only the filtered plants when a plant filter is on). */
  /** @param {import('../core/collections.js').Place[]} places */
  #plantMarkers(places) {
    const filter = new Set(this._plants);
    return plantMarkers(places, e => !filter.size || filter.has(/** @type {number} */ (e.plantId)), this.#harvest);
  }

  /** The selected place, in full: header (distance, route, close), then its editor. @param {import('../core/collections.js').Place} place */
  /** Wide screens: the place panel's width and fold (resizable and foldable like Flore's panes). */
  #wide = new MediaController(this, '(min-width: 900px)');
  #panes = new PaneSizer(this, config.storageKeys.mapLayout, { place: { width: 440, min: 320, title: 'Lieu' } });

  #panel(place) {
    const wide = this.#wide.matches;
    const p = this.#panes;
    if (wide && p.folded('place')) return p.rail('place', true);
    const max = () => (this.getBoundingClientRect().width || innerWidth) - 320;
    const dist = this.#distanceTo(place);
    // Arrived with « add this plant » / « pick a plant » for this place (links to a place, « Y ajouter… »).
    const arrival = this.#arrival?.spot === place.id ? this.#arrival : null;
    return html`
      ${wide ? p.split('place', 'right', max, 'map-place') : nothing}
      <section class="panel ${this._panelFull ? 'full' : ''}" id="map-place" aria-label="Lieu sélectionné" style=${wide ? `width:${Math.min(p.width('place'), Math.max(320, max()))}px` : ''}>
        <div class="panel-head">
          <button class="grip" type="button" aria-label=${this._panelFull ? 'Réduire la fiche' : 'Agrandir la fiche'}
            aria-expanded=${this._panelFull ? 'true' : 'false'} @click=${() => { this._panelFull = !this._panelFull; }}></button>
          <h2>${icon('geo-alt-fill')} ${placeTitle(place)}</h2>
          <span class="meta">${plantCount(place.properties.plants.length)}${dist !== null ? ` · à ${formatDistance(dist)}` : ''}</span>
          <a class="button small" href=${directionsUrl(place)} target="_blank" rel="noopener">Itinéraire</a>
          <button class="close icon-btn" type="button" aria-label="Fermer" @click=${() => this.#navigate({ spot: null })}>${icon('x-lg')}</button>
          ${wide ? html`<button class="icon-btn fold" type="button" aria-expanded="true" title="Replier : Lieu" aria-label="Replier le panneau lieu"
            @click=${() => p.fold('place', true)}>»</button>` : nothing}
        </div>
        ${repeat([place], p => p.id, () => html`<gf-spot-editor embedded spot-id=${place.id}
          add-plant=${arrival?.add ?? ''} ?pick=${Boolean(arrival?.pick)}
          .focusEntry=${this.route.focus} .mapEditing=${this._editing}
          @map-fly=${e => /** @type {any} */ (this.renderRoot.querySelector('gf-map'))?.flyTo(e.detail.coordinates, e.detail.zoom)}
          @map-edit=${() => { this._editing = true; }}
          @plant-focus=${e => this.#navigate({ spot: place.id, focus: e.detail.entryId ?? e.detail.plantId })}
          @panel-close=${() => this.#navigate({ spot: null })}></gf-spot-editor>`)}

      </section>`;
  }

  /** @param {import('../core/collections.js').Place[]} places */
  #list(places) {
    const fix = this.#geo.state.fix;
    const rows = places
      .map(place => ({ place, dist: this.#distanceTo(place) }))
      .sort((a, b) => fix
        ? /** @type {number} */ (a.dist) - /** @type {number} */ (b.dist)
        : b.place.properties.updatedAt.localeCompare(a.place.properties.updatedAt));

    if (!rows.length) return html`<ul class="list"></ul>`;
    return html`
      <ul class="list">
        ${rows.map(({ place, dist }) => {
          const last = placeLastHarvest(place);
          const names = place.properties.plants.map(entryName);
          return html`
            <li>
              <a href=${href.map({ spot: place.id })} @click=${() => { this._view = 'map'; }}>
                <span class="dot" style="--c:${PIN_COLORS[placeAbundance(place)]}"></span>
                <span class="title">${placeTitle(place)}</span>
                <span class="dist">${dist !== null ? formatDistance(dist) : ''}</span>
                <span class="sub">
                  ${this.#harvest && inSeason(place) ? html`<span class="badge">En saison</span> ` : nothing}
                  ${names.length > 1 || place.properties.name ? names.join(', ') : ''}
                  ${this.#harvest ? (names.length > 1 || place.properties.name ? ' · ' : '') + (last ? 'récolté le ' + shortDate(last.harvest.date) : 'aucune récolte') : ''}
                </span>
              </a>
            </li>`;
        })}
      </ul>
    `;
  }
}

customElements.define('gf-map-page', GfMapPage);
