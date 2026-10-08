// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import * as sources from '../core/sources.js';

const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/**
 * Months (0–11) of a Baseflor flowering period [first, last] (1–12); last < first wraps over the year end.
 * @param {[number, number] | null | undefined} period
 * @returns {Set<number>}
 */
export function floweringMonths(period) {
  const months = new Set();
  if (!Array.isArray(period)) return months;
  const [first, last] = period;
  if (!(first >= 1 && first <= 12 && last >= 1 && last <= 12)) return months;
  for (let m = first; ; m = m % 12 + 1) {
    months.add(m - 1);
    if (m === last) break;
  }
  return months;
}

/** @param {Set<number>} months */
const range = months => {
  if (!months.size) return '';
  if (months.size === 12) return 'toute l’année';
  // Start where the period starts, even when it wraps over December.
  const start = [...months].find(m => !months.has((m + 11) % 12)) ?? 0;
  const end = [...months].find(m => !months.has((m + 1) % 12)) ?? 11;
  return start === end ? MONTH_NAMES[start] : `${MONTH_NAMES[start]} → ${MONTH_NAMES[end]}`;
};

/**
 * Flowering and fruiting calendar of a plant, from sourced data only:
 *  - Baseflor (Ph. Julve, Tela Botanica): flowering months, embedded in the dataset (`plant.flowering`);
 *  - iNaturalist: observations in France per month annotated "en fleurs" / "en fruits", fetched and cached.
 * Rows without data are not shown; nothing at all when no source knows the plant.
 */
export class GfCalendar extends LitElement {
  static properties = {
    plant: { attribute: false },
    /** Mode of the sheet showing the calendar: its modules decide whether iNaturalist is asked. */
    mode: {},
    /** Inside a titled block (plant sheet): no title of its own. */
    notitle: { type: Boolean },
    _phenology: { state: true }
  };

  static styles = css`
    :host { display: block; }
    h2 {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--gf-text-muted);
      margin: 0 0 8px;
    }
    .grid { display: grid; grid-template-columns: minmax(84px, max-content) repeat(12, 1fr); gap: 3px; align-items: center; }
    .head { font-size: 0.7rem; color: var(--gf-text-muted); text-align: center; }
    .head.now { color: var(--gf-text); font-weight: 700; }
    .label { font-size: 0.8rem; padding-right: 6px; white-space: nowrap; }
    .cell {
      height: 18px;
      border-radius: 4px;
      background: var(--gf-surface-2);
      position: relative;
    }
    .cell i { position: absolute; inset: 0; border-radius: inherit; background: var(--c); opacity: var(--o, 1); }
    .cell.now { outline: 2px solid var(--gf-text); outline-offset: 1px; }
    .flower { --c: #d946ef; }
    .bloom { --c: #f59e0b; }
    .fruit { --c: #dc2626; }
    .notes { margin: 8px 0 0; padding: 0; list-style: none; display: grid; gap: 2px; font-size: 0.8rem; color: var(--gf-text-muted); }
    .notes a { color: var(--gf-accent); }
    .muted { color: var(--gf-text-muted); font-size: 0.8rem; margin: 6px 0 0; }
    .loading { height: 18px; border-radius: 4px; background: var(--gf-surface-2); grid-column: 2 / -1; }
  `;

  constructor() {
    super();
    /** @type {any} */
    this.plant = null;
    /** undefined = loading, null = unavailable. @type {any} */
    this._phenology = undefined;
    this.notitle = false;
    this._empty = false;
  }

  /** Nothing to show: hidden, so the block holding it is not shown either. */
  updated() { this.hidden = this._empty; }

  /** @type {AbortController | null} */
  #abort = null;

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (changed.has('plant') || changed.has('mode')) this.#load();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abort?.abort();
  }

  async #load() {
    this.#abort?.abort();
    this._phenology = undefined;
    if (!this.plant) return;
    const abort = this.#abort = new AbortController();
    try {
      const data = await sources.phenology(this.plant, abort.signal, this.mode || undefined);
      if (!abort.signal.aborted) this._phenology = data;
    } catch {
      if (!abort.signal.aborted) this._phenology = null;
    }
  }

  /**
   * @param {string} label @param {string} kind
   * @param {(month: number) => number} level 0..1 for each month
   * @param {string} title
   */
  #row(label, kind, level, title) {
    const now = new Date().getMonth();
    return html`
      <span class="label">${label}</span>
      ${MONTHS.map((_, m) => {
        const o = level(m);
        return html`<span class="cell ${kind} ${m === now ? 'now' : ''}" title="${MONTH_NAMES[m]} : ${title}">
          ${o > 0 ? html`<i style="--o:${Math.max(0.18, o).toFixed(2)}"></i>` : nothing}</span>`;
      })}`;
  }

  render() {
    const plant = this.plant;
    if (!plant) return nothing;
    const flowering = floweringMonths(plant.flowering);
    const ph = this._phenology;
    const loading = ph === undefined;
    const sum = (/** @type {number[] | undefined} */ a) => (a || []).reduce((t, n) => t + n, 0);
    const bloomTotal = sum(ph?.flowering);
    const fruitTotal = sum(ph?.fruiting);
    const max = (/** @type {number[]} */ a) => Math.max(1, ...a);
    this._empty = !flowering.size && !loading && !bloomTotal && !fruitTotal;
    if (this._empty) return nothing;
    const now = new Date().getMonth();

    return html`
      ${this.notitle ? nothing : html`<h2>Calendrier</h2>`}
      <div class="grid" role="table" aria-label="Floraison et fructification par mois">
        <span></span>
        ${MONTHS.map((m, i) => html`<span class="head ${i === now ? 'now' : ''}" aria-label=${MONTH_NAMES[i]}>${m}</span>`)}
        ${flowering.size ? this.#row('Floraison', 'flower', m => (flowering.has(m) ? 1 : 0), 'en fleurs (Baseflor)') : nothing}
        ${bloomTotal ? this.#row('Vue en fleurs', 'bloom', m => ph.flowering[m] / max(ph.flowering), 'observations en fleurs') : nothing}
        ${fruitTotal ? this.#row('Vue en fruits', 'fruit', m => ph.fruiting[m] / max(ph.fruiting), 'observations en fruits') : nothing}
        ${loading ? html`<span class="label muted">iNaturalist…</span><span class="loading"></span>` : nothing}
      </div>
      <ul class="notes">
        ${flowering.size ? html`<li>Floraison : ${range(flowering)} — Baseflor, Ph. Julve, <a href="https://www.tela-botanica.org/" target="_blank" rel="noopener">Tela Botanica</a> (CC BY-SA).</li>` : nothing}
        ${bloomTotal || fruitTotal ? html`<li>
          ${bloomTotal ? `${bloomTotal.toLocaleString('fr-FR')} observation${bloomTotal > 1 ? 's' : ''} en fleurs` : ''}${bloomTotal && fruitTotal ? ', ' : ''}${fruitTotal ? `${fruitTotal.toLocaleString('fr-FR')} en fruits` : ''}
          en France — <a href=${ph.sourceUrl} target="_blank" rel="noopener">iNaturalist</a>.</li>` : nothing}
      </ul>
      <p class="muted">Indications de floraison et de fructification, pas des dates de cueillette : selon la partie récoltée (feuilles, fleurs, fruits), la bonne période diffère.</p>
    `;
  }
}

customElements.define('gf-calendar', GfCalendar);
