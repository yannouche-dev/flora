// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { href } from '../core/router.js';
import { collectionsForPlant, formatDistance, plantMarkers, savePlace, spotEvents, withEntry } from '../core/collections.js';
import { lastFix, watchLocation } from '../core/geo.js';
import { FRANCE_BOUNDS } from '../core/ign.js';
import { moduleOn } from '../core/modules.js';
import { observationsAround, savedRadius } from '../core/nearby.js';
import * as sources from '../core/sources.js';
import { MAP_DEFAULTS } from '../core/sheet-blocks.js';
import { icon } from '../core/icons.js';
import { ui } from '../styles/ui.js';
import './gf-map.js';

/** Heights of a map block. */
const HEIGHTS = { s: 180, m: 260, l: 380 };

/** « Observations proches » asked once in this visit: later maps look around without asking again. */
let nearAllowed = false;

/**
 * One GPS fix (a recent one if known), or why there is none (20 s at most).
 * @returns {Promise<{ coordinates: [number, number] } | { error: string } | null>}
 */
function locate() {
  const known = lastFix();
  if (known && Date.now() - known.timestamp < 5 * 60000) return Promise.resolve(known);
  return new Promise(resolve => {
    /** @type {(() => void) | null} */ let stop = null;
    let done = false;
    const finish = (/** @type {any} */ value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      queueMicrotask(() => stop?.());
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 20000);
    stop = watchLocation(state => {
      if (state.fix) finish(state.fix);
      else if (state.error) finish({ error: state.error });
    });
  });
}

/**
 * A « Carte » block of the plant sheet: the layers it was set to show (GBIF distribution, my places with this
 * plant, observations around me from iNaturalist and / or GBIF), on its own IGN background and overlays, framed
 * as chosen, with the gates to the rest of the app (open in the Carte, create a place here, move my plants,
 * note it here, locate me).
 */
export class GfSheetMap extends LitElement {
  static properties = {
    plant: { attribute: false },
    /** GBIF Backbone key and iNaturalist taxon id of the plant (from the sheet's details). */
    gbifKey: { attribute: false },
    inatId: { attribute: false },
    /** What it shows and lets do (sheet-blocks.js › MapConfig). */
    config: { attribute: false },
    /** Plant sheet mode (the modules on in it). */
    mode: {},
    _spots: { state: true },
    _near: { state: true }
  };

  static styles = [ui, css`
    :host { display: block; }
    .frame { position: relative; border-radius: var(--gf-radius); overflow: hidden; border: 1px solid var(--gf-border); background: var(--gf-surface-2); }
    gf-map { position: absolute; inset: 0; min-height: 0; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; align-items: center; }
    .actions .button, .actions button { font-size: 0.85rem; min-height: 36px; padding: 4px 12px; }
    .legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 6px; font-size: 0.78rem; color: var(--gf-text-muted); }
    .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 5px; vertical-align: -1px; border: 1px solid #fff; box-shadow: 0 0 0 1px rgb(0 0 0 / 20%); }
    .hint { font-size: 0.78rem; color: var(--gf-text-muted); margin: 6px 0 0; }
  `];

  #onChange = () => this.#loadSpots();

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
    this.mode = 'standard';
    /** @type {any[]} */
    this._spots = [];
    /** Observations around: not asked, looking, the result, or what went wrong. @type {any} */
    this._near = undefined;
  }

  connectedCallback() {
    super.connectedCallback();
    spotEvents.addEventListener('change', this.#onChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    spotEvents.removeEventListener('change', this.#onChange);
  }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (changed.has('plant')) { this._near = undefined; this.#loadSpots(); }
    const near = this.config.near;
    if ((changed.has('config') || changed.has('plant') || changed.has('gbifKey') || changed.has('inatId')) && near !== 'off') {
      // The sources asked changed: look again (automatically once allowed in this visit).
      const wanted = near + ':' + this.gbifKey + ':' + this.inatId;
      if (this._near?.wanted !== wanted) this._near = nearAllowed ? undefined : this._near?.state === 'done' ? undefined : this._near;
      if (nearAllowed && !this._near) queueMicrotask(() => this.#findNear());
    }
  }

  async #loadSpots() {
    const id = this.plant?.id;
    if (!id) return;
    try {
      const all = await collectionsForPlant(id);
      if (this.plant?.id === id) this._spots = all.filter(c => c.properties.kind === 'place' && c.geometry);
    } catch { this._spots = []; }
  }

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
    if (!fix || 'error' in fix) { this._near = { state: 'error', wanted, message: fix && 'error' in fix ? fix.error : 'Position introuvable pour le moment.' }; return; }
    const radius = savedRadius();
    const point = /** @type {[number, number]} */ (fix.coordinates);
    this._near = { state: 'loading', wanted, point, radius };
    const useGbif = (c.near === 'gbif' || c.near === 'both') && this.gbifKey && moduleOn('gbif', /** @type {any} */ (this.mode));
    const useInat = (c.near === 'inat' || c.near === 'both') && this.inatId && moduleOn('inaturalist', /** @type {any} */ (this.mode));
    const [gbif, inat] = await Promise.all([
      useGbif ? sources.gbifNear(this.gbifKey, point, radius, undefined, /** @type {any} */ (this.mode), 30).catch(() => null) : null,
      useInat ? observationsAround(/** @type {number} */ (this.inatId), point, radius).catch(() => null) : null
    ]);
    if (this.plant !== plant) return;
    /** @type {{ coordinates: [number, number], title: string, url?: string, kind: string }[]} */
    const points = [];
    for (const o of gbif?.nearest || []) {
      points.push({ coordinates: o.coordinates, kind: 'gbif', url: 'https://www.gbif.org/occurrence/' + o.key,
        title: `GBIF · ${formatDistance(o.distance)}${o.date ? ' · ' + new Date(o.date).toLocaleDateString('fr-FR') : ''}` });
    }
    for (const o of inat || []) {
      points.push({ coordinates: o.coordinates, kind: 'inat', url: o.url,
        title: `iNaturalist${o.date ? ' · ' + new Date(o.date).toLocaleDateString('fr-FR') : ''}` });
    }
    this._near = { state: 'done', wanted, point, radius, points, gbifTotal: gbif?.total ?? null, inatCount: inat?.length ?? null, gbifOn: Boolean(useGbif), inatOn: Boolean(useInat) };
  }

  /** ✎ on the map: this plant's new position in each place it was moved in. @param {{ placeId: string, plantId: number | null, coordinates: [number, number] }[]} moves */
  async #savePositions(moves) {
    for (const { placeId, plantId, coordinates } of moves) {
      const place = this._spots.find(p => p.id === placeId);
      if (!place) continue;
      const rounded = /** @type {[number, number]} */ (coordinates.map(v => Math.round(v * 1e7) / 1e7));
      await savePlace(withEntry(place, plantId, { coordinates: rounded, accuracy: null })).catch(() => {});
    }
  }

  /** Framing: France, the content shown, or the circle around me. */
  get #frame() {
    const c = this.config;
    if (c.frame === 'me') {
      const near = this._near;
      const center = near?.point || lastFix()?.coordinates;
      if (center) {
        const r = (near?.radius || savedRadius()) / 111320;
        const [lon, lat] = center;
        const dLon = r / Math.cos(lat * Math.PI / 180);
        return { key: 'me:' + center.join(), points: [[lon - dLon, lat - r], [lon + dLon, lat + r]] };
      }
    }
    if (c.frame === 'content' && (this._spots.length || this._near?.points?.length)) return null;
    const sw = FRANCE_BOUNDS.getSouthWest(), ne = FRANCE_BOUNDS.getNorthEast();
    return { key: 'fr', points: [[sw.lng, sw.lat], [ne.lng, ne.lat]] };
  }

  render() {
    const c = this.config;
    const plant = this.plant;
    if (!plant) return nothing;
    const near = this._near;
    const spots = c.places ? this._spots : [];
    const gbifOn = c.gbif !== 'off' && this.gbifKey && moduleOn('gbif', /** @type {any} */ (this.mode));
    const frame = this.#frame;
    return html`
      <div class="frame" style=${`height:${HEIGHTS[c.height] || HEIGHTS.m}px`}>
        <gf-map
          .spots=${spots}
          .plants=${c.places ? plantMarkers(this._spots, e => e.plantId === plant.id) : []}
          plant-zoom="0"
          ?editable=${c.actions.edit && c.places && this._spots.length > 0}
          ?fit=${c.frame === 'content'}
          .frame=${frame}
          .area=${near?.state === 'done' && c.near !== 'off' ? { center: near.point, radius: near.radius } : null}
          .points=${c.near !== 'off' && near?.state === 'done' ? near.points : []}
          .distribution=${gbifOn ? { key: this.gbifKey, label: plant.vernacularNames?.[0] || plant.scientificName, country: c.gbif === 'fr' ? 'FR' : '' } : null}
          ?distribution-on=${Boolean(gbifOn)}
          .base=${c.base}
          .overlays=${c.overlays}
          no-search
          ?no-create=${!c.actions.create}
          .createPlant=${plant.id}
          ?no-locate=${!c.actions.locate}
          @spot-select=${e => { location.hash = href.map({ spot: e.detail.id }); }}
          @plant-select=${e => { location.hash = href.map({ spot: e.detail.placeId, focus: e.detail.plantId }); }}
          @positions-save=${e => this.#savePositions(e.detail.plants)}
          @layers-change=${e => this.dispatchEvent(new CustomEvent('map-layers', { detail: e.detail }))}
        ></gf-map>
      </div>
      ${this.#legend(gbifOn)}
      <div class="actions">
        ${c.near !== 'off' && (!near || near.state === 'error') ? html`<button type="button" class="near-ask" @click=${() => this.#findNear()}>${icon('crosshair')} Observations autour de moi (${formatDistance(savedRadius())})</button>` : nothing}
        ${c.actions.open ? html`<a class="button" href=${href.map({ plant: plant.id })}>${icon('map')} Ouvrir dans la Carte</a>` : nothing}
        ${c.actions.spot ? html`<a class="button" href=${href.newSpot(plant.id)}>${icon('geo-alt-fill')} Noter ici</a>` : nothing}
      </div>
      ${near?.state === 'error' ? html`<p class="hint" role="alert">${near.message}</p>` : nothing}
      ${near?.state === 'locating' || near?.state === 'loading' ? html`<p class="hint">Recherche des observations autour de vous…</p>` : nothing}
      ${c.actions.create || (c.actions.edit && this._spots.length) ? html`<p class="hint">${[
        c.actions.create ? 'Appui long sur la carte : adresse, altitude, créer un endroit avec cette plante' : '',
        c.actions.edit && c.places && this._spots.length ? '✎ : déplacer mes plants' : '',
        'les couches : fond et couches IGN de cette carte'].filter(Boolean).join(' · ')}.</p>` : nothing}`;
  }

  /** What the colours mean, and where the data comes from. @param {any} gbifOn */
  #legend(gbifOn) {
    const c = this.config;
    const near = this._near;
    const parts = [];
    if (gbifOn) parts.push(html`<span>Densité GBIF${c.gbif === 'fr' ? ' (France)' : ''}</span>`);
    if (c.places && this._spots.length) parts.push(html`<span>Mes lieux (${this._spots.length})</span>`);
    if (near?.state === 'done') {
      if (near.inatOn) parts.push(html`<span><i style="background:#74ac00"></i>iNaturalist (${near.inatCount ?? 0})</span>`);
      if (near.gbifOn) parts.push(html`<span><i style="background:#4e7b9f"></i>GBIF (${(near.gbifTotal ?? 0).toLocaleString('fr-FR')} à moins de ${formatDistance(near.radius)})</span>`);
    }
    return parts.length ? html`<div class="legend">${parts}</div>` : nothing;
  }
}

customElements.define('gf-sheet-map', GfSheetMap);
