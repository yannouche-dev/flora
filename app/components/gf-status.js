// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import * as db from '../core/db.js';
import { myRegion, sortStatuses, territoryFor } from '../core/territory.js';

/** @typedef {import('../core/territory.js').Status} Status */

const PROTECTION = ['PN', 'PR', 'PD'];
const LEVEL = { PN: 'Protection nationale', PR: 'Protection régionale', PD: 'Protection départementale' };

/** INPN page listing every status of a taxon, with the legal texts. @param {number} id */
export const inpnStatusUrl = id => `https://inpn.mnhn.fr/espece/cd_nom/${id}/tab/statut`;

/**
 * One-line warning for toasts (capture, added plant): protection or picking rule where the plant is.
 * @param {any} plant TAXREF record with `statuses`
 * @param {[number, number] | null} [point] where it is recorded
 * @returns {Promise<string | null>}
 */
export async function statusWarning(plant, point) {
  if (!plant?.statuses?.length) return null;
  const { national, here } = sortStatuses(plant.statuses, await territoryFor(point).catch(() => null));
  const protection = [...national, ...here].find(s => PROTECTION.includes(s.type));
  if (protection) return `⚠ Espèce protégée (${protection.type === 'PN' ? 'France' : protection.area})`;
  const rule = here.find(s => s.type === 'REGL');
  return rule ? `⚠ Cueillette réglementée (${rule.area})` : null;
}

/**
 * Protection / picking regulation / Red List of a plant, for the territory where it is (a place's point,
 * else "Ma région"). Source: INPN, Base de connaissance Statuts. Renders nothing for plants without status.
 */
export class GfStatus extends LitElement {
  static properties = {
    plant: { attribute: false },
    plantId: { type: Number, attribute: 'plant-id' },
    point: { attribute: false },
    _plant: { state: true },
    _territory: { state: true },
    _open: { state: true }
  };

  static styles = css`
    :host { display: block; }
    .box { display: grid; gap: 6px; }
    .alert {
      border-radius: 10px;
      padding: 8px 12px;
      font-size: 0.9rem;
      line-height: 1.35;
      border: 1px solid;
    }
    .alert strong { display: block; }
    .protected { background: color-mix(in srgb, #dc2626 12%, var(--gf-surface)); border-color: #dc2626; }
    .regulated { background: color-mix(in srgb, #f59e0b 16%, var(--gf-surface)); border-color: #d97706; }
    .info { font-size: 0.85rem; color: var(--gf-text); }
    .muted { color: var(--gf-text-muted); font-size: 0.8rem; }
    ul { margin: 4px 0 0; padding-left: 18px; }
    li { margin: 2px 0; }
    button.link { font: inherit; font-size: 0.8rem; border: 0; background: none; color: var(--gf-accent); padding: 0; cursor: pointer; text-decoration: underline; }
    a { color: var(--gf-accent); }
  `;

  constructor() {
    super();
    /** @type {any} */
    this.plant = null;
    this.plantId = 0;
    /** @type {[number, number] | null} */
    this.point = null;
    /** @type {any} */
    this._plant = null;
    /** @type {import('../core/territory.js').Territory | null | undefined} */
    this._territory = undefined;
    this._open = false;
  }

  #onRegion = () => this.#locate();

  connectedCallback() {
    super.connectedCallback();
    addEventListener('geoflora-region', this.#onRegion);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    removeEventListener('geoflora-region', this.#onRegion);
  }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (changed.has('plant') || changed.has('plantId')) this.#loadPlant();
    if (changed.has('point')) this.#locate();
  }

  async #loadPlant() {
    if (this.plant?.statuses || !this.plantId) { this._plant = this.plant; return; }
    this._plant = this.plant;
    const record = await db.get('plants', this.plantId).catch(() => null);
    if (record && (record.id === this.plantId)) this._plant = record;
  }

  async #locate() {
    this._territory = await territoryFor(this.point).catch(() => null);
  }

  /** @param {Status} s */
  #where(s) {
    return s.type === 'PN' || s.type === 'LRN' ? 'France' : s.area;
  }

  render() {
    const plant = this._plant;
    const statuses = plant?.statuses;
    if (!statuses?.length || this._territory === undefined) return nothing;
    const territory = this._territory;
    const { national, here, elsewhere } = sortStatuses(statuses, territory);
    const protections = [...national, ...here].filter(s => PROTECTION.includes(s.type));
    const rules = here.filter(s => s.type === 'REGL');
    const redLists = [...national, ...here].filter(s => s.type === 'LRN' || s.type === 'LRR');
    const away = elsewhere.filter(s => PROTECTION.includes(s.type) || s.type === 'REGL');
    if (!protections.length && !rules.length && !redLists.length && !away.length) return nothing;
    const place = territory ? (territory.deptName ? `${territory.deptName}, ${territory.regionName}` : territory.regionName) : null;

    return html`
      <div class="box">
        ${protections.length ? html`
          <div class="alert protected" role="alert">
            <strong>Espèce protégée${place ? ' ici' : ''}</strong>
            ${protections.map(s => html`<div>${LEVEL[s.type]} (${this.#where(s)})${s.label && s.label !== LEVEL[s.type] ? html`<small> — ${s.label}</small>` : nothing}</div>`)}
            <div class="muted">Ne la cueillez pas sans avoir vérifié ce que permet le texte officiel.</div>
          </div>` : nothing}
        ${rules.length ? html`
          <div class="alert regulated" role="alert">
            <strong>Cueillette réglementée${place ? ' ici' : ''}</strong>
            ${rules.map(s => html`<div>${s.area} — ${s.label}</div>`)}
          </div>` : nothing}
        ${redLists.length ? html`
          <div class="info">Liste rouge : ${redLists.map((s, i) => html`${i ? ', ' : ''}<strong>${s.label}</strong> (${this.#where(s)})`)}</div>` : nothing}
        ${away.length ? html`
          <div class="muted">
            ${territory ? '' : html`Choisissez votre région (Plus → Réglages) pour savoir ce qui s’applique chez vous. `}
            ${territory ? 'Ailleurs : ' : ''}protégée ou réglementée dans ${new Set(away.map(s => s.area)).size} territoire${new Set(away.map(s => s.area)).size > 1 ? 's' : ''}.
            <button class="link" type="button" @click=${() => { this._open = !this._open; }}>${this._open ? 'Masquer' : 'Voir la liste'}</button>
            ${this._open ? html`<ul>${away.map(s => html`<li>${s.area} — ${s.type === 'REGL' ? 'cueillette réglementée' : LEVEL[s.type].toLowerCase()}</li>`)}</ul>` : nothing}
          </div>` : nothing}
        <div class="muted">
          ${place ? `Pour : ${place}${territory?.dept ? '' : myRegion() ? ' (ma région)' : ''}. ` : ''}Source : INPN, Base de connaissance Statuts —
          <a href=${inpnStatusUrl(plant.id)} target="_blank" rel="noopener">textes officiels</a>.
        </div>
      </div>
    `;
  }
}

customElements.define('gf-status', GfStatus);
