// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { GeoController } from '../core/geo.js';
import { href, parse } from '../core/router.js';
import {
  ABUNDANCE, addHarvest, directionsUrl, distance, entryInSeason, entryName, formatDistance, inSeason, lastHarvest, listPlaces,
  placeAbundance, placeLastHarvest, placeTitle, plantCount, spotEvents
} from '../core/collections.js';
import { whenReady } from '../core/store.js';
import './gf-facet.js';
import './gf-map.js';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const shortDate = (/** @type {string} */ iso) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

const stars = (/** @type {number} */ n) => n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '';

const PIN_COLORS = { rare: '#fb7185', moyen: '#fbbf24', abondant: '#38bdf8' };

/** Harvest places: IGN map or list sorted by distance, filters, selected-place sheet. */
export class GfMapPage extends LitElement {
  static properties = {
    route: { attribute: false },
    _spots: { state: true },
    _view: { state: true },
    _plants: { state: true },
    _toast: { state: true },
    _error: { state: true },
    _plantMenu: { state: true }
  };

  static styles = css`
    *, *::before, *::after { box-sizing: border-box; }
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
    button, .button {
      font: inherit;
      color: var(--gf-text);
      background: var(--gf-surface);
      border: 1px solid var(--gf-border);
      border-radius: 999px;
      padding: 5px 12px;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    button[aria-pressed='true'] { background: var(--gf-accent); border-color: var(--gf-accent); color: var(--gf-accent-contrast); }
    .segmented { display: inline-flex; border: 1px solid var(--gf-border); border-radius: 999px; overflow: hidden; }
    .segmented button { border: 0; border-radius: 0; }
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
      box-shadow: 0 8px 24px rgb(0 0 0 / 20%);
      padding: 0 12px 8px;
    }
    .body { flex: 1; min-height: 0; position: relative; display: flex; flex-direction: column; }
    gf-map { flex: 1; }
    /* The place sheet covers the bottom of the map: hide Leaflet's bottom controls meanwhile. */
    .body:has(.sheet) gf-map .leaflet-bottom { display: none; }
    .legend {
      position: absolute;
      left: 10px;
      top: 10px;
      z-index: 500;
      display: flex;
      gap: 10px;
      font-size: 0.75rem;
      background: color-mix(in srgb, var(--gf-surface) 88%, transparent);
      padding: 4px 10px;
      border-radius: 999px;
      box-shadow: 0 1px 4px rgb(0 0 0 / 25%);
    }
    .legend span::before {
      content: '';
      display: inline-block;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      margin-right: 4px;
      background: var(--c);
      border: 1px solid #fff;
    }
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
      box-shadow: 0 3px 10px rgb(0 0 0 / 35%);
      padding: 0;
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
      border-radius: 16px;
      box-shadow: 0 6px 24px rgb(0 0 0 / 35%);
      padding: 14px 16px;
      display: grid;
      gap: 8px;
    }
    .sheet h2 { margin: 0; font-size: 1.1rem; padding-right: 32px; }
    .sheet .sci { font-family: var(--gf-font-serif); font-style: italic; color: var(--gf-text-muted); }
    .sheet .close { position: absolute; top: 10px; right: 10px; border: 0; background: none; font-size: 1.4rem; padding: 4px 8px; }
    .meta { font-size: 0.85rem; color: var(--gf-text-muted); display: flex; gap: 6px 12px; flex-wrap: wrap; }
    .meta .stars { color: #f59e0b; letter-spacing: 1px; }
    .badge { background: #fde047; color: #422006; border-radius: 999px; padding: 0 8px; font-size: 0.75rem; font-weight: 600; }
    .sheet .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
    .sheet .actions .main { background: var(--gf-accent); color: var(--gf-accent-contrast); border-color: var(--gf-accent); font-weight: 600; }
    .notes { font-size: 0.9rem; margin: 0; white-space: pre-line; }
    .sheet { max-height: 70%; overflow-y: auto; }
    .plants { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
    .plants li { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-top: 1px solid var(--gf-border); }
    .plants .who { flex: 1; min-width: 0; display: grid; }
    .plants .nm { font-weight: 600; }
    .plants .sub { font-size: 0.8rem; color: var(--gf-text-muted); }
    .plants .sub, .plants .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .plants .harvest { flex: none; font-size: 0.85rem; padding: 4px 10px; border-color: var(--gf-accent); color: var(--gf-accent); }
    .more { font-size: 0.85rem; color: var(--gf-accent); }
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
      background: var(--gf-text);
      color: var(--gf-bg);
      padding: 8px 16px;
      border-radius: 999px;
      font-size: 0.875rem;
      box-shadow: 0 2px 8px rgb(0 0 0 / 30%);
    }
  `;

  #geo = new GeoController(this);
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
  /** @param {{ spot?: string | null, season?: boolean }} patch */
  #navigate(patch) {
    const next = { ...this.route, ...patch };
    const hash = href.map({ spot: next.spot || undefined, season: next.season, plant: this._plants.length === 1 ? this._plants[0] : undefined });
    history.replaceState(null, '', hash);
    this.route = parse(hash);
  }

  get #filtered() {
    const plants = new Set(this._plants);
    return this._spots.filter(place =>
      (!plants.size || place.properties.plantIds.some(id => plants.has(id))) &&
      (!this.route.season || inSeason(place)));
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
        <button type="button" aria-pressed=${this.route.season ? 'true' : 'false'}
          @click=${() => this.#navigate({ season: !this.route.season, spot: null })}>En saison · ${seasonCount}</button>
        <button type="button" aria-expanded=${this._plantMenu ? 'true' : 'false'} aria-pressed=${this._plants.length ? 'true' : 'false'}
          @click=${() => { this._plantMenu = !this._plantMenu; }}>Plantes${this._plants.length ? ' · ' + this._plants.length : ''} ▾</button>
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
            .spots=${spots}
            .selectedId=${this.route.spot}
            remember
            ?fit=${Boolean(this.route.spot || this._plants.length)}
            @spot-select=${e => this.#navigate({ spot: e.detail.id })}
          ></gf-map>
          <div class="legend" aria-hidden="true">
            ${ABUNDANCE.map(a => html`<span style="--c:${PIN_COLORS[a.value]}">${a.label}</span>`)}
          </div>
          ${selected ? this.#sheet(selected) : nothing}
        ` : this.#list(spots)}

        ${!this._spots.length ? html`
          <p class="empty" style=${this._view === 'map' ? 'position:absolute;inset:auto 16px 100px;z-index:550;background:var(--gf-surface);border-radius:16px;box-shadow:0 2px 12px rgb(0 0 0 / 25%)' : ''}>
            Aucun lieu enregistré. Sur place, touchez <strong>+</strong> pour créer un lieu et y noter les plantes qui y poussent, ou ouvrez une fiche plante et touchez « Ajouter un lieu ».
          </p>` : nothing}

        ${selected && this._view === 'map' ? nothing : html`
          <a class="button fab" href=${href.newSpot(this._plants.length === 1 ? this._plants[0] : null)} aria-label="Ajouter un lieu de récolte">+</a>`}
        ${this._toast ? html`<div class="toast" role="status">${this._toast}</div>` : nothing}
        ${this._error ? html`<div class="toast" role="alert">${this._error}
          <button type="button" @click=${() => this.#load()}>Réessayer</button></div>` : nothing}
      </div>
    `;
  }

  /** @param {import('../core/collections.js').Place} place */
  #sheet(place) {
    const p = place.properties;
    const dist = this.#distanceTo(place);
    const filter = new Set(this._plants);
    // Plants in season first, then the filtered ones, then by name.
    const entries = [...p.plants].sort((a, b) =>
      Number(entryInSeason(b)) - Number(entryInSeason(a)) ||
      Number(filter.has(/** @type {number} */ (b.plantId))) - Number(filter.has(/** @type {number} */ (a.plantId))) ||
      entryName(a).localeCompare(entryName(b), 'fr'));
    const shown = entries.slice(0, 5);

    return html`
      <section class="sheet" aria-label="Lieu sélectionné">
        <button class="close" type="button" aria-label="Fermer" @click=${() => this.#navigate({ spot: null })}>×</button>
        <h2>${placeTitle(place)}</h2>
        <div class="meta">
          <span>${plantCount(p.plants.length)}</span>
          ${inSeason(place) ? html`<span class="badge">En saison</span>` : nothing}
          ${dist !== null ? html`<span>à ${formatDistance(dist)}</span>` : nothing}
        </div>
        ${shown.length ? html`
          <ul class="plants">
            ${shown.map(e => {
              const last = lastHarvest(e);
              return html`<li>
                <span class="who">
                  <span class="nm">${entryName(e)}${entryInSeason(e) ? html` <span class="badge">En saison</span>` : nothing}</span>
                  <span class="sub">${ABUNDANCE.find(a => a.value === e.abundance)?.label}${e.rating ? ' · ' + stars(e.rating) : ''}
                    · ${last ? 'récolté le ' + shortDate(last.date) : 'aucune récolte'}</span>
                </span>
                <button type="button" class="harvest" aria-label="Noter une récolte de ${entryName(e)} aujourd’hui"
                  @click=${() => this.#quickHarvest(place, e)}>+ Récolte</button>
              </li>`;
            })}
          </ul>
          ${entries.length > shown.length ? html`<a class="more" href=${href.spot(place.id)}>+ ${entries.length - shown.length} autre${entries.length - shown.length > 1 ? 's' : ''}…</a>` : nothing}`
        : html`<p class="notes">Aucune plante notée pour ce lieu.</p>`}
        ${p.notes ? html`<p class="notes">${p.notes}</p>` : nothing}
        <div class="actions">
          <a class="button main" href=${href.spot(place.id)}>Ouvrir le lieu</a>
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
                  ${inSeason(place) ? html`<span class="badge">En saison</span> ` : nothing}
                  ${names.length > 1 || place.properties.name ? names.join(', ') + ' · ' : ''}
                  ${last ? 'récolté le ' + shortDate(last.harvest.date) : 'aucune récolte'}
                </span>
              </a>
            </li>`;
        })}
      </ul>
    `;
  }
}

customElements.define('gf-map-page', GfMapPage);
