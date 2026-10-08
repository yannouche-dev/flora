// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { GeoController } from '../core/geo.js';
import { href, parse } from '../core/router.js';
import {
  ABUNDANCE, addHarvest, directionsUrl, entryPosition, plantMarkers, distance, entryInSeason, entryName, entrySoon, formatDistance, inSeason, lastHarvest, listPlaces,
  placeAbundance, placeLastHarvest, placeTitle, plantCount, savePlace, spotEvents, withEntry
} from '../core/collections.js';
import { RADII, exploreUrl, observationsAround, saveRadius, savedRadius, speciesAround } from '../core/nearby.js';
import { StoreController, whenReady } from '../core/store.js';
import { addressAt, altitudeAt } from '../core/geoservices.js';
import { ui } from '../styles/ui.js';
import './gf-facet.js';
import './gf-map.js';
import './gf-thumb.js';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const shortDate = (/** @type {string} */ iso) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

const stars = (/** @type {number} */ n) => n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '';

const round = (/** @type {[number, number]} */ [x, y]) => /** @type {[number, number]} */ ([Math.round(x * 1e7) / 1e7, Math.round(y * 1e7) / 1e7]);

const PIN_COLORS = { rare: '#fb7185', moyen: '#fbbf24', abondant: '#38bdf8' };

/** Lower case without accents, for the "Autour" list filter. */
const fold = (/** @type {string} */ s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Harvest places: IGN map or list sorted by distance, filters, selected-place sheet. */
export class GfMapPage extends LitElement {
  static properties = {
    route: { attribute: false },
    _spots: { state: true },
    _view: { state: true },
    _plants: { state: true },
    _toast: { state: true },
    _error: { state: true },
    _plantMenu: { state: true },
    _around: { state: true },
    _edit: { state: true },
    _geo: { state: true },
    _point: { state: true }
  };

  static styles = [ui, css`
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
    gf-map { flex: 1; }
    /* The place sheet covers the bottom of the map: hide Leaflet's bottom controls meanwhile. */
    .body:has(.sheet) gf-map .leaflet-bottom { display: none; }
    /* Phones have the "Noter ici" button in the tab bar. */
    @media (max-width: 699px) { .fab { display: none !important; } }
    .fab {
      position: absolute;
      z-index: 600;
      right: 16px;
      bottom: calc(24px + env(safe-area-inset-bottom));
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
    .toast {
      position: absolute;
      z-index: 800;
      left: 50%;
      transform: translateX(-50%);
      top: 12px;
    }
  `];

  #geo = new GeoController(this);
  #store = new StoreController(this);
  get #harvest() { return this.#store.state.harvestMode; }
  #onSpotsChange = () => this.#load();

  constructor() {
    super();
    /** @type {any} */
    this.route = { name: 'map', spot: null, plant: null, season: false };
    /** @type {import('../core/collections.js').Spot[]} */
    this._spots = [];
    /** @type {string | null} */
    this._error = null;
    /** @type {'map' | 'list'} */
    this._view = 'map';
    /** @type {number[]} */
    this._plants = [];
    /** @type {string | null} */
    this._toast = null;
    this._plantMenu = false;
    /**
     * "Autour": iNaturalist species observed in a circle.
     * @type {null | { center: [number, number], radius: number, where: string, status: 'loading' | 'ok' | 'error',
     *   error?: string, result?: import('../core/nearby.js').NearbyResult, species?: import('../core/nearby.js').NearbySpecies | null,
     *   obs?: import('../core/nearby.js').NearbyObservation[] | null, frame: string }}
     */
    this._around = null;
    /** Position editing of the selected place on this map: a working copy, saved on "Valider". @type {any} */
    this._edit = null;
    this._editFrames = 0;
    /** Commune and altitude of places, looked up once (IGN, cached). @type {Map<string, { city?: string, alt?: number | null }>} */
    this._geo = new Map();
  }

  /** @param {import('../core/collections.js').Place} place */
  #placeGeo(place) {
    const key = place.id + ':' + place.geometry.coordinates.join(',');
    if (!this._geo.has(key)) {
      this._geo.set(key, {});
      const set = patch => { this._geo = new Map(this._geo).set(key, { ...this._geo.get(key), ...patch }); };
      addressAt(place.geometry.coordinates).then(a => set({ city: a?.city || '' })).catch(() => {});
      altitudeAt(place.geometry.coordinates).then(alt => set({ alt })).catch(() => {});
    }
    return /** @type {{ city?: string, alt?: number | null }} */ (this._geo.get(key));
  }

  /** @param {import('../core/collections.js').Place} place */
  #startEdit(place) {
    this.#aroundAbort?.abort();
    this._around = null;
    this._edit = { place, frame: 'edit:' + place.id + ':' + (++this._editFrames) };
  }

  /** @param {[number, number]} coordinates */
  #movePin(coordinates) {
    if (!this._edit) return;
    const place = this._edit.place;
    this._edit = { ...this._edit, place: { ...place, geometry: { type: 'Point', coordinates: round(coordinates) }, properties: { ...place.properties, accuracy: null } } };
  }

  /** @param {number | null} plantId @param {[number, number]} coordinates */
  #moveEditedPlant(plantId, coordinates) {
    if (!this._edit) return;
    this._edit = { ...this._edit, place: withEntry(this._edit.place, plantId, { coordinates: round(coordinates), accuracy: null }) };
  }

  async #saveEdit() {
    const edit = this._edit;
    if (!edit) return;
    try {
      await savePlace(edit.place);
      this._edit = null;
      this.#showToast('Positions enregistrées');
    } catch (error) {
      this.#showToast('Enregistrement impossible : ' + /** @type {Error} */ (error).message);
    }
  }

  get #editFrame() {
    const e = this._edit;
    if (!e) return null;
    const place = e.place;
    return { key: e.frame, points: [place.geometry.coordinates, ...place.properties.plants.map(p => entryPosition(place, p))], bottom: 0.15 };
  }

  /** @type {AbortController | null} */ #aroundAbort = null;
  #aroundFrames = 0;

  /** A point was picked on the map (long press, search): its card replaces the place sheet. */
  #onPointInfo() {
    this._point = true;
    if (this._edit) return;
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
    } catch (error) {
      if (abort.signal.aborted) return;
      this._around = { ...this._around, status: 'error', off: /** @type {Error} */ (error).name === 'ModuleOffError',
        error: /** @type {Error} */ (error).name === 'ModuleOffError' ? 'Le module iNaturalist est désactivé.'
          : navigator.onLine === false ? 'Hors ligne : les observations ne peuvent pas être chargées.' : 'iNaturalist ne répond pas pour le moment.' };
    }
  }

  /** @param {import('../core/nearby.js').NearbySpecies | null} species */
  async #pickSpecies(species) {
    const around = this._around;
    if (!around) return;
    this._around = { ...around, species, obs: null };
    if (!species) return;
    try {
      const obs = await observationsAround(species.taxonId, around.center, around.radius);
      if (this._around?.species === species) this._around = { ...this._around, obs };
    } catch {
      if (this._around?.species === species) this._around = { ...this._around, obs: [] };
    }
  }

  /** Search text / family chip of the species list (kept while a species is open). @param {object} patch */
  #filterAround(patch) {
    const a = this._around;
    if (a) this._around = { ...a, filter: { ...a.filter, ...patch } };
  }

  /** The circle for gf-map, with the chosen species' observations. */
  get #area() {
    const a = this._around;
    if (!a) return null;
    const name = a.species ? a.species.common || a.species.name : '';
    return {
      center: a.center,
      radius: a.radius,
      points: (a.obs || []).map(o => ({ coordinates: o.coordinates, title: name + (o.date ? ' · ' + shortDate(o.date) : ''), url: o.url }))
    };
  }

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
    const km = r => r < 1000 ? r + ' m' : r / 1000 + ' km';
    const head = html`
      <button class="close icon-btn" type="button" aria-label="Fermer" @click=${() => this.#toggleAround()}>×</button>
      <h2>Autour · ${km(a.radius)}</h2>
      <div class="meta"><span>Centre : ${a.where}</span>
        <button type="button" class="link" @click=${() => {
          const c = /** @type {any} */ (this.renderRoot.querySelector('gf-map'))?.center();
          if (c) this.#searchAround(c, 'centre de la carte');
        }}>Chercher au centre de la carte</button></div>
      <div class="radii" role="group" aria-label="Rayon">
        ${RADII.map(r => html`<button type="button" aria-pressed=${r === a.radius ? 'true' : 'false'}
          @click=${() => { saveRadius(r); this.#searchAround(a.center, a.where, r); }}>${km(r)}</button>`)}
      </div>`;
    const source = html`<p class="source">Source : <a href=${a.species ? exploreUrl(a.center, a.radius, a.species.taxonId) : exploreUrl(a.center, a.radius)}
      target="_blank" rel="noopener">iNaturalist</a>, observations validées (niveau recherche), toutes dates.</p>`;

    if (a.status === 'loading') return html`<section class="sheet around" aria-label="Autour">${head}<p class="notes">Chargement des observations…</p></section>`;
    if (a.status === 'error') return html`<section class="sheet around" aria-label="Autour">${head}<p class="notes">${a.error}</p>
      <div class="actions">${a.off
        ? html`<a class="button" href=${href.settings()}>Réglages › Modules</a>`
        : html`<button type="button" @click=${() => this.#searchAround(a.center, a.where)}>Réessayer</button>`}</div></section>`;

    const result = /** @type {import('../core/nearby.js').NearbyResult} */ (a.result);
    const s = a.species;
    if (s) {
      return html`<section class="sheet around" aria-label="Autour">
        <button class="close icon-btn" type="button" aria-label="Fermer" @click=${() => this.#toggleAround()}>×</button>
        <button type="button" class="link back" @click=${() => this.#pickSpecies(null)}>← Toutes les espèces</button>
        <div class="species-head">
          ${s.plantId ? html`<gf-thumb plant-id=${s.plantId} size="56"></gf-thumb>` : s.photo && this.#store.state.modules.photos ? html`<img class="ph" src=${s.photo} alt="" referrerpolicy="no-referrer" />` : nothing}
          <div><h2>${s.common || s.name}</h2>${s.common ? html`<span class="sci">${s.name}</span>` : nothing}</div>
        </div>
        <div class="meta"><span>${s.count} observation${s.count > 1 ? 's' : ''} dans le cercle</span>
          <span>${a.obs === null ? 'Chargement des points…' : a.obs?.length ? `${a.obs.length} point${a.obs.length > 1 ? 's' : ''} sur la carte${a.obs.length < s.count ? ' (les plus récents)' : ''}` : 'Aucun point localisé'}</span></div>
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
    // Fixed order (most species in the circle first): choosing a value never reorders the lists.
    const ranked = (/** @type {Map<string, number>} */ totals) => [...totals].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], 'fr')).map(([v]) => v);
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
              : sp.photo && this.#store.state.modules.photos ? html`<img class="ph" src=${sp.photo} alt="" loading="lazy" referrerpolicy="no-referrer" />` : html`<gf-thumb size="38"></gf-thumb>`}
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
    this.#load();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    spotEvents.removeEventListener('change', this.#onSpotsChange);
  }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (changed.has('route') && this.route.plant && !this._plants.includes(this.route.plant)) {
      this._plants = [this.route.plant];
    }
    // Arriving on a place from elsewhere (Mes plantes, the editor, a link): frame it with all its plants.
    if (changed.has('route') && !this.#internalRoute && this.route.spot) {
      if (!this.route.plant) this._plants = [];
      this.#frameKey = this.route.spot + ':' + (++this.#frames);
    }
    this.#internalRoute = false;
  }

  #internalRoute = false;
  #frames = 0;
  /** @type {string | null} */ #frameKey = null;

  /** Zoom target for the map: the arrived-on place, its point and every plant's own position. */
  get #frame() {
    const place = this.#frameKey && this._spots.find(s => s.id === this.route.spot);
    if (!place || !this.#frameKey?.startsWith(place.id + ':')) return null;
    return {
      key: this.#frameKey,
      points: [place.geometry.coordinates, ...place.properties.plants.map(e => entryPosition(place, e))],
      bottom: 0.4
    };
  }

  async #load() {
    await whenReady();
    try {
      this._spots = await listPlaces();
      this._error = null;
    } catch (error) {
      console.error(error);
      this._error = 'Lieux illisibles pour le moment : ' + /** @type {Error} */ (error).message;
    }
    document.title = 'Carte des lieux — GeoFlora';
  }

  /** Keeps the URL in sync with selection/filters without adding history entries. */
  /** @param {{ spot?: string | null, focus?: number | null, season?: boolean }} patch */
  #navigate(patch) {
    const next = { ...this.route, ...(patch.spot !== undefined && !('focus' in patch) ? { focus: null } : {}), ...patch };
    const hash = href.map({
      spot: next.spot || undefined,
      focus: next.spot && next.focus ? next.focus : undefined,
      season: next.season,
      plant: this._plants.length === 1 ? this._plants[0] : undefined
    });
    history.replaceState(null, '', hash);
    if (next.spot !== this.route.spot) this.#frameKey = null;
    this.#internalRoute = true;
    this.route = parse(hash);
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

  /** @param {import('../core/collections.js').Place} place @param {import('../core/collections.js').PlantEntry} entry */
  async #quickHarvest(place, entry) {
    try {
      await addHarvest(place, entry.plantId, { date: today(), quantity: '', note: '' });
      this.#showToast(`${entryName(entry)} : récolte du jour notée`);
    } catch (error) {
      this.#showToast('Enregistrement impossible : ' + /** @type {Error} */ (error).message);
    }
  }

  /** @param {string} message */
  #showToast(message) {
    this._toast = message;
    setTimeout(() => { if (this._toast === message) this._toast = null; }, 2500);
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

    return html`
      <div class="bar">
        <span class="count">${spots.length} lieu${spots.length > 1 ? 'x' : ''}</span>
        ${this.#harvest ? html`<button type="button" aria-pressed=${this.route.season ? 'true' : 'false'}
          @click=${() => this.#navigate({ season: !this.route.season, spot: null })}>En saison · ${seasonCount}</button>` : nothing}
        <button type="button" aria-expanded=${this._plantMenu ? 'true' : 'false'} aria-pressed=${this._plants.length ? 'true' : 'false'}
          @click=${() => { this._plantMenu = !this._plantMenu; }}>Plantes${this._plants.length ? ' · ' + this._plants.length : ''} ▾</button>
        <button type="button" class="around-toggle" ?disabled=${Boolean(this._edit)} aria-pressed=${this._around ? 'true' : 'false'}
          title="Plantes observées autour (iNaturalist)" @click=${() => this.#toggleAround()}>Autour</button>
        <div class="segmented" role="group" aria-label="Affichage">
          <button type="button" aria-pressed=${this._view === 'map' ? 'true' : 'false'} @click=${() => { this._view = 'map'; }}>Carte</button>
          <button type="button" aria-pressed=${this._view === 'list' ? 'true' : 'false'} @click=${() => { this._view = 'list'; }}>Liste</button>
        </div>
        ${this._plantMenu ? html`
          <div class="plant-menu">
            <gf-facet name="plant" label="Plantes" searchable .selected=${this._plants.map(String)} .options=${this.#plantOptions()}
              @facet-change=${e => { this._plants = e.detail.values.map(Number); this.#navigate({ spot: null }); }}></gf-facet>
          </div>` : nothing}
      </div>

      <div class="body" @click=${() => { if (this._plantMenu) this._plantMenu = false; }}>
        ${this._view === 'map' ? html`
          <gf-map
            .spots=${this._edit ? spots.filter(s => s.id !== this._edit.place.id) : spots}
            .selectedId=${this._edit ? null : this.route.spot}
            .plants=${this._edit ? plantMarkers([this._edit.place], () => true, this.#harvest) : this.#plantMarkers(spots)}
            .pin=${this._edit ? this._edit.place.geometry.coordinates : null}
            .pinDraggable=${Boolean(this._edit)}
            ?draggable-plants=${Boolean(this._edit)}
            plant-zoom=${this._edit ? 0 : 16}
            @pin-move=${e => this.#movePin(e.detail.coordinates)}
            @plant-move=${e => this.#moveEditedPlant(e.detail.plantId, e.detail.coordinates)}
            @map-longpress=${e => this.#movePin(e.detail.coordinates)}
            .selectedPlant=${this.route.spot && this.route.focus ? this.route.spot + ':' + this.route.focus : null}
            remember
            search
            legend
            @point-info=${() => this.#onPointInfo()}
            @point-close=${() => { this._point = false; }}
            .frame=${this.#editFrame || this.#aroundFrame || this.#frame}
            .area=${this.#area}
            ?fit=${Boolean(this._plants.length && !this.#frameKey)}
            @spot-select=${e => { if (!this._edit) { this.#hidePoint(); this.#navigate({ spot: e.detail.id }); } }}
            @plant-select=${e => { if (!this._edit) this.#navigate({ spot: e.detail.placeId, focus: e.detail.plantId }); }}
          ></gf-map>
          ${this._edit ? html`
            <section class="sheet editbar" aria-label="Modifier les positions">
              <h2>${placeTitle(this._edit.place)}</h2>
              <p class="notes">Glissez le carré (l’endroit) ou les ronds (les plantes) à leur place.</p>
              <div class="actions">
                <button class="button primary" type="button" @click=${() => this.#saveEdit()}>✓ Valider</button>
                <button class="button" type="button" @click=${() => { this._edit = null; }}>Annuler</button>
              </div>
            </section>`
          : this._around ? this.#aroundPanel() : selected ? this.#sheet(selected) : nothing}
        ` : this.#list(spots)}

        ${!this._spots.length && !this._point ? html`
          <p class="empty" style=${this._view === 'map' ? 'position:absolute;inset:auto 16px 100px;z-index:550;background:var(--gf-surface);border-radius:16px;box-shadow:0 2px 12px rgb(0 0 0 / 25%)' : ''}>
            Aucun lieu enregistré. Sur place, touchez <strong>+</strong> pour créer un lieu et y noter les plantes qui y poussent, ou ouvrez une fiche plante et touchez « Ajouter un lieu ».
          </p>` : nothing}

        ${selected && this._view === 'map' ? nothing : html`
          <button class="fab" type="button" aria-label="Noter une plante ici"
            @click=${() => this.dispatchEvent(new CustomEvent('open-capture', { bubbles: true, composed: true }))}>+</button>`}
        ${this._toast ? html`<div class="toast" role="status">${this._toast}</div>` : nothing}
        ${this._error ? html`<div class="toast" role="alert">${this._error}
          <button type="button" @click=${() => this.#load()}>Réessayer</button></div>` : nothing}
      </div>
    `;
  }

  /** Plant markers of the shown places (only the filtered plants when a plant filter is on). */
  /** @param {import('../core/collections.js').Place[]} places */
  #plantMarkers(places) {
    const filter = new Set(this._plants);
    return plantMarkers(places, e => !filter.size || filter.has(/** @type {number} */ (e.plantId)), this.#harvest);
  }

  /** @param {import('../core/collections.js').Place} place */
  #sheet(place) {
    const p = place.properties;
    const dist = this.#distanceTo(place);
    const filter = new Set(this._plants);
    const focus = this.route.focus;
    // The tapped plant first, then plants in season, then the filtered ones, then by name.
    const entries = [...p.plants].sort((a, b) =>
      Number(b.plantId === focus) - Number(a.plantId === focus) ||
      Number(entryInSeason(b)) - Number(entryInSeason(a)) ||
      Number(filter.has(/** @type {number} */ (b.plantId))) - Number(filter.has(/** @type {number} */ (a.plantId))) ||
      entryName(a).localeCompare(entryName(b), 'fr'));
    const shown = entries.slice(0, 5);

    return html`
      <section class="sheet" aria-label="Lieu sélectionné">
        <button class="close icon-btn" type="button" aria-label="Fermer" @click=${() => this.#navigate({ spot: null })}>×</button>
        <h2>${placeTitle(place)}</h2>
        <div class="meta">
          <span>${plantCount(p.plants.length)}</span>
          ${this.#harvest && inSeason(place) ? html`<span class="badge">En saison</span>` : nothing}
          ${dist !== null ? html`<span>à ${formatDistance(dist)}</span>` : nothing}
          ${(geo => html`${geo.city ? html`<span>📍 ${geo.city}</span>` : nothing}${geo.alt != null ? html`<span>⛰ ${geo.alt} m</span>` : nothing}`)(this.#placeGeo(place))}
        </div>
        ${shown.length ? html`
          <ul class="plants">
            ${shown.map(e => {
              const last = lastHarvest(e);
              const own = entryPosition(place, e);
              const away = own && place.geometry ? distance(own, place.geometry.coordinates) : 0;
              return html`<li class=${e.plantId === focus ? 'focus' : ''}>
                <gf-thumb plant-id=${e.plantId ?? 0} size="38" round style="--c:${PIN_COLORS[e.abundance]}"></gf-thumb>
                <span class="who">
                  <span class="nm">${entryName(e)}${!this.#harvest ? nothing
                    : entryInSeason(e) ? html` <span class="badge">En saison</span>`
                    : entrySoon(e) ? html` <span class="badge soon">Bientôt</span>` : nothing}</span>
                  <span class="sub">${away >= 3 ? `à ${formatDistance(away)} du point · ` : ''}${ABUNDANCE.find(a => a.value === e.abundance)?.label}${this.#harvest ? html`${e.rating ? ' · ' + stars(e.rating) : ''}
                    · ${last ? 'récolté le ' + shortDate(last.date) : 'aucune récolte'}` : e.notes ? ' · ' + e.notes.slice(0, 50) : ''}</span>
                </span>
                ${this.#harvest ? html`<button type="button" class="harvest small" aria-label="Noter une récolte de ${entryName(e)} aujourd’hui"
                  @click=${() => this.#quickHarvest(place, e)}>+ Récolte</button>` : nothing}
              </li>`;
            })}
          </ul>
          ${entries.length > shown.length ? html`<a class="link" href=${href.spot(place.id)}>+ ${entries.length - shown.length} autre${entries.length - shown.length > 1 ? 's' : ''}…</a>` : nothing}`
        : html`<p class="notes">Aucune plante notée pour ce lieu.</p>`}
        ${p.notes ? html`<p class="notes">${p.notes}</p>` : nothing}
        <div class="actions">
          <a class="button primary" href=${href.spot(place.id)}>Ouvrir le lieu</a>
          <button class="button" type="button" @click=${() => this.#startEdit(place)}>✎ Positions</button>
          <a class="button" href=${href.spot(place.id, null, true)}>+ Plante</a>
          <a class="button" href=${directionsUrl(place)} target="_blank" rel="noopener">Itinéraire</a>
        </div>
      </section>
    `;
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
