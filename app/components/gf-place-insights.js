// @ts-check
import { LitElement, html, css, nothing, unsafeCSS } from 'lit';
import { href } from '../core/router.js';
import { moduleOn } from '../core/modules.js';
import { speciesAround } from '../core/nearby.js';
import * as openData from '../core/open-data.js';
import { chartStyles, climateChart } from '../core/charts.js';
import { icon } from '../core/icons.js';
import { ui } from '../styles/ui.js';
import { hideImg, showImg } from '../core/img.js';

/** Radius of « Plantes vues ici » (metres). */
const SEEN_RADIUS = 500;

/**
 * What open data says about a place or a point of the map, for a walk or a survey: the natural zones it lies
 * in (ZNIEFF, Natura 2000, parks, reserves — IGN API Carto, with their INPN fiche), the plants observed around
 * (iNaturalist, research grade, 500 m; those of the flora open their sheet), today's pollens and the climate
 * of the place (Open-Meteo: CAMS forecast, ERA5 normals). Each part needs its module; `compact` (point card)
 * leaves the climate out and lists fewer plants.
 */
export class GfPlaceInsights extends LitElement {
  static properties = {
    /** [lon, lat] */
    point: { attribute: false },
    compact: { type: Boolean },
    /** Plants already in the place: marked in « Plantes vues ici ». */
    plantIds: { attribute: false },
    _zones: { state: true },
    _seen: { state: true },
    _pollen: { state: true },
    _climate: { state: true }
  };

  static styles = [ui, css`
    :host { display: block; }
    section { margin-top: 14px; }
    section:first-child { margin-top: 0; }
    h3 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--gf-text-muted); margin: 0 0 6px; display: flex; align-items: center; gap: 6px; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
    .zones li { display: flex; gap: 8px; align-items: baseline; font-size: 0.88rem; }
    .zones .kind { flex: none; font-size: 0.7rem; font-weight: 700; padding: 1px 8px; border-radius: var(--gf-radius-pill); background: color-mix(in srgb, #2e7d32 14%, var(--gf-surface)); color: #2e7d32; }
    .seen { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; }
    .seen li a, .seen li span.plain { display: flex; gap: 8px; align-items: center; padding: 4px; border-radius: var(--gf-radius); text-decoration: none; color: inherit; font-size: 0.82rem; min-width: 0; }
    .seen li a:hover { background: var(--gf-surface-2); }
    .seen img, .seen .ph { flex: none; width: 34px; height: 34px; border-radius: 6px; object-fit: cover; background: var(--gf-surface-2); }
    .seen .txt { min-width: 0; display: grid; }
    .seen .txt b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .seen .txt small { color: var(--gf-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .seen .here { color: var(--gf-accent); font-weight: 700; }
    .pollens { display: flex; flex-wrap: wrap; gap: 6px; }
    .pollens li { font-size: 0.8rem; padding: 2px 10px; border-radius: var(--gf-radius-pill); background: var(--gf-surface-2); }
    .pollens .l1 { background: #e8f5e9; color: #2e7d32; } .pollens .l2 { background: #fff8e1; color: #b26a00; }
    .pollens .l3 { background: #ffe0b2; color: #c43e00; } .pollens .l4 { background: #ffcdd2; color: #b71c1c; }
    .muted { color: var(--gf-text-muted); font-size: 0.85rem; margin: 0; }
    .credit { font-size: 0.72rem; color: var(--gf-text-muted); margin: 6px 0 0; }
    .credit a { color: inherit; }
    .summary { font-size: 0.85rem; margin: 4px 0 0; }
    ${unsafeCSS(chartStyles)}
  `];

  constructor() {
    super();
    /** @type {[number, number] | null} */
    this.point = null;
    this.compact = false;
    /** @type {number[]} */
    this.plantIds = [];
    /** @type {any} */ this._zones = undefined;
    /** @type {any} */ this._seen = undefined;
    /** @type {any} */ this._pollen = undefined;
    /** @type {any} */ this._climate = undefined;
  }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (!changed.has('point') || !this.point) return;
    const prev = /** @type {[number, number] | null | undefined} */ (changed.get('point'));
    if (prev && Math.abs(prev[0] - this.point[0]) < 1e-4 && Math.abs(prev[1] - this.point[1]) < 1e-4) return;
    const point = this.point;
    const keep = (/** @type {string} */ k) => (/** @type {any} */ v) => { if (this.point === point) /** @type {any} */ (this)[k] = v; };
    const fail = (/** @type {string} */ k) => () => { if (this.point === point) /** @type {any} */ (this)[k] = null; };
    this._zones = this._seen = this._pollen = this._climate = undefined;
    if (moduleOn('ignNature')) openData.zonesAt(point).then(keep('_zones'), fail('_zones')); else this._zones = 'off';
    if (moduleOn('inaturalist')) speciesAround(point, SEEN_RADIUS).then(keep('_seen'), fail('_seen')); else this._seen = 'off';
    if (moduleOn('openmeteo')) {
      openData.pollensAt(point).then(keep('_pollen'), fail('_pollen'));
      if (!this.compact) openData.climateAt(point).then(keep('_climate'), fail('_climate'));
    } else { this._pollen = 'off'; this._climate = 'off'; }
  }

  render() {
    if (!this.point) return nothing;
    return html`${this.#zones()}${this.#seen()}${this.#pollens()}${this.compact ? nothing : this.#climate()}`;
  }

  #zones() {
    const z = this._zones;
    if (z === 'off') return nothing;
    return html`<section class="zones-part">
      <h3>${icon('shield-check')} Zones naturelles</h3>
      ${z === undefined ? html`<p class="muted">chargement…</p>`
        : z === null ? html`<p class="muted">API Carto (IGN) ne répond pas pour le moment.</p>`
        : !z.length ? html`<p class="muted">Ni ZNIEFF, ni site Natura 2000, ni parc ou réserve ici.</p>`
        : html`<ul class="zones">${z.map((/** @type {any} */ x) => html`<li><span class="kind">${x.label}</span>
            ${x.url ? html`<a href=${x.url} target="_blank" rel="noopener">${x.name}</a>` : html`<span>${x.name}</span>`}</li>`)}</ul>`}
      ${Array.isArray(z) ? html`<p class="credit">Source : INPN / PatriNat via <a href="https://apicarto.ign.fr/api/doc/nature" target="_blank" rel="noopener">API Carto (IGN)</a>. Une ZNIEFF signale un milieu riche ; Natura 2000, un site européen ; un parc ou une réserve a ses propres règles de cueillette.</p>` : nothing}
    </section>`;
  }

  #seen() {
    const s = this._seen;
    if (s === 'off') return nothing;
    const max = this.compact ? 6 : 12;
    return html`<section class="seen-part">
      <h3>${icon('flower1')} Plantes vues ici <small>(${SEEN_RADIUS} m)</small></h3>
      ${s === undefined ? html`<p class="muted">chargement…</p>`
        : s === null ? html`<p class="muted">iNaturalist ne répond pas pour le moment.</p>`
        : !s.species.length ? html`<p class="muted">Aucune plante observée (et validée) à moins de ${SEEN_RADIUS} m sur iNaturalist.</p>`
        : html`<p class="summary"><strong>${s.species.length}</strong> espèce${s.species.length > 1 ? 's' : ''} observée${s.species.length > 1 ? 's' : ''}, ${s.observations.toLocaleString('fr-FR')} observation${s.observations > 1 ? 's' : ''} ; les plus vues :</p>
          <ul class="seen">${s.species.slice(0, max).map((/** @type {any} */ x) => {
            const inner = html`${x.photo ? html`<img src=${x.photo} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error=${hideImg} @load=${showImg} />` : html`<span class="ph"></span>`}
              <span class="txt"><b>${x.common || x.name}</b><small>${this.plantIds.includes(x.plantId) ? html`<span class="here">dans ce lieu · </span>` : nothing}${x.count} obs.</small></span>`;
            return html`<li>${x.plantId ? html`<a href=${href.plant(x.plantId)} title=${x.name}>${inner}</a>` : html`<span class="plain" title=${x.name}>${inner}</span>`}</li>`;
          })}</ul>
          <p class="credit">Source : <a href=${s.sourceUrl} target="_blank" rel="noopener">iNaturalist</a>, observations de qualité recherche ; une plante de la flore ouvre sa fiche.</p>`}
    </section>`;
  }

  #pollens() {
    const p = this._pollen;
    if (p === 'off' || p === null) return nothing;
    const list = p ? openData.POLLENS.map(x => ({ ...x, value: p.values[x.key] })).filter(x => x.value != null) : [];
    return html`<section class="pollen-part">
      <h3>${icon('leaf')} Pollens aujourd’hui</h3>
      ${p === undefined ? html`<p class="muted">chargement…</p>` : !list.length ? html`<p class="muted">Pas de prévision de pollen ici (le modèle CAMS couvre l’Europe).</p>`
        : html`<ul class="pollens">${list.map(x => { const l = openData.pollenLevel(/** @type {number} */ (x.value)); return html`<li class=${'l' + l.level} title=${Math.round(/** @type {number} */ (x.value)) + ' grains/m³ au plus fort de la journée'}>${x.label} : ${l.label}</li>`; })}</ul>
          <p class="credit">Prévision : Copernicus CAMS via <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0).</p>`}
    </section>`;
  }

  #climate() {
    const c = this._climate;
    if (c === 'off' || c === null) return nothing;
    return html`<section class="climate-part">
      <h3>${icon('triangle')} Climat du lieu</h3>
      ${c === undefined ? html`<p class="muted">chargement…</p>` : html`${climateChart(c.temp, c.precip)}
        <p class="summary">Moyenne annuelle <strong>${c.annualTemp} °C</strong>, <strong>${c.annualPrecip.toLocaleString('fr-FR')} mm</strong> de pluie par an${c.elevation != null ? `, altitude du modèle ${Math.round(c.elevation)} m` : ''}.</p>
        <p class="credit">ERA5 (Copernicus) via <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>, moyennes ${c.years} (CC BY 4.0).</p>`}
    </section>`;
  }
}

customElements.define('gf-place-insights', GfPlaceInsights);

