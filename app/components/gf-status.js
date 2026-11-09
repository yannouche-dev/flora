// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { getPlant } from '../core/plants.js';
import { myRegion, sortStatuses, territoryAt, territoryFor } from '../core/territory.js';
import { harvestRules, tradeRules } from '../core/regulation.js';
import { ui } from '../styles/ui.js';
import { severityStyles } from './ui-kit.js';

/** @typedef {import('../core/territory.js').Status} Status */

const PROTECTION = ['PN', 'PR', 'PD'];
const LEVEL = { PN: 'Protection nationale', PR: 'Protection régionale', PD: 'Protection départementale' };

/** INPN page listing every status of a taxon, with the legal texts. @param {number} id */
export const inpnStatusUrl = id => `https://inpn.mnhn.fr/espece/cd_nom/${id}/tab/statut`;

/**
 * One-line warning for the toast of « Noter ici »: protection (danger) or picking rule (warn) where the plant is. Where
 * the point is could not be read (the outlines): a regional protection may be the one here — said so, a danger (fail
 * closed, as the verdict before the note: core/alerts.js#verdictOf).
 * @param {any} plant TAXREF record with `statuses`
 * @param {[number, number] | null} [point] where it is recorded
 * @returns {Promise<{ level: 'danger' | 'warn', text: string } | null>}
 */
export async function statusWarning(plant, point) {
  if (!plant?.statuses?.length) return null;
  const territory = await (point ? territoryAt(point).then(t => t ?? territoryFor(null)) : territoryFor(null))
    .catch(() => /** @type {const} */ ('unread'));
  const { national, here, elsewhere } = sortStatuses(plant.statuses, territory === 'unread' ? null : territory);
  const protection = [...national, ...here].find(s => PROTECTION.includes(s.type));
  if (protection) return { level: 'danger', text: `Espèce protégée (${protection.type === 'PN' ? 'France' : protection.area})` };
  const maybe = territory === 'unread' ? [...new Set(elsewhere.filter(s => PROTECTION.includes(s.type)).map(s => s.area || s.label))] : [];
  if (maybe.length) return { level: 'danger', text: `Espèce protégée dans des régions ou départements (${maybe.slice(0, 3).join(', ')}), peut-être ici` };
  // Only a picking rule of this department or region (never a CITES annex, an overseas or invasive species list).
  const rule = harvestRules(here)[0];
  return rule ? { level: 'warn', text: `Cueillette réglementée (${rule.area})` } : null;
}

/**
 * Protection / picking regulation / Red List of a plant, for the territory where it is (a place's point,
 * else "Ma région"). Source: INPN, Base de connaissance Statuts. Renders nothing for plants without status. A
 * protection here is in the danger box, a picking rule in the warning's (ui-kit.js .sev-box), as the verdict says them.
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

  /** Nothing to show for this plant here: hidden (the plant sheet then hides its block). */
  _empty = true;
  updated() {
    this.hidden = this._empty;
    // Still finding where we are: the sheet waits before saying there is nothing.
    this.toggleAttribute('loading', this._territory === undefined);
  }

  static styles = [ui, severityStyles, css`
    :host { display: block; }
    .box { display: grid; gap: 6px; }
    .alert { font-size: 0.9rem; line-height: 1.35; }
    .alert strong { display: block; }
    .info { font-size: 0.85rem; color: var(--gf-text); }
    .muted { color: var(--gf-text-muted); font-size: 0.8rem; }
    ul { margin: 4px 0 0; padding-left: 18px; }
    li { margin: 2px 0; }
    .link { font-size: 0.8rem; }
    a { color: var(--gf-accent); }
  `];

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
    const record = await getPlant(this.plantId);
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
    this._empty = true;
    if (!statuses?.length || this._territory === undefined) return nothing;
    const territory = this._territory;
    const { national, here, elsewhere } = sortStatuses(statuses, territory);
    const protections = [...national, ...here].filter(s => PROTECTION.includes(s.type));
    // Picking rules: this department's or region's, then the national ones (PV1: a prefect may regulate it; NV3).
    // Trade rules (CITES) on a line of their own; overseas and invasive species lists rule no picking here.
    const rules = harvestRules(here);
    const nationalRules = harvestRules(national);
    const trade = tradeRules(national);
    const redLists = [...national, ...here].filter(s => s.type === 'LRN' || s.type === 'LRR');
    const away = [...elsewhere.filter(s => PROTECTION.includes(s.type)), ...harvestRules(elsewhere)];
    if (!protections.length && !rules.length && !nationalRules.length && !trade.length && !redLists.length && !away.length) return nothing;
    this._empty = false;
    const place = territory ? (territory.deptName ? `${territory.deptName}, ${territory.regionName}` : territory.regionName) : null;

    return html`
      <div class="box">
        ${protections.length ? html`
          <div class="alert sev-box danger" role="alert">
            <strong>Espèce protégée${place ? ' ici' : ''}</strong>
            ${protections.map(s => html`<div>${LEVEL[s.type]} (${this.#where(s)})${s.label && s.label !== LEVEL[s.type] ? html`<small> — ${s.label}</small>` : nothing}</div>`)}
            <div class="muted">Ne la cueillez pas sans avoir vérifié ce que permet le texte officiel.</div>
          </div>` : nothing}
        ${rules.length ? html`
          <div class="alert sev-box warn" role="alert">
            <strong>Cueillette réglementée${place ? ' ici' : ''}</strong>
            ${rules.map(s => html`<div>${s.area} — ${s.label}</div>`)}
          </div>` : nothing}
        ${nationalRules.length ? html`
          <div class="alert sev-box warn">
            <strong>${nationalRules.some(s => s.code !== 'PV1') ? 'Cueillette réglementée en France métropolitaine' : 'Cueillette pouvant être réglementée par arrêté préfectoral'}</strong>
            ${nationalRules.map(s => html`<div>${s.area} — ${s.label}</div>`)}
            ${nationalRules.every(s => s.code === 'PV1') ? html`<div class="muted">Un arrêté du préfet peut en limiter ou en interdire la cueillette dans un département : renseignez-vous avant de cueillir.</div>` : nothing}
          </div>` : nothing}
        ${trade.length ? html`
          <div class="info">Commerce réglementé : ${trade.map((s, i) => html`${i ? ' ; ' : ''}${s.label}`)}.</div>` : nothing}
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
