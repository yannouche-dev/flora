// @ts-check
import { LitElement, html, css, nothing, repeat } from 'lit';
import { UNREAD_LOOKALIKES, edibleFilter, genusOf, lookalikesOf, severityOf } from '../core/lookalikes.js';
import { confusionChip } from '../core/danger.js';
import { href } from '../core/router.js';
import { ui } from '../styles/ui.js';
import { icon } from '../core/icons.js';
import { emergency } from '../core/poison.js';
import { isFocused, sendFocus } from '../core/map-focus.js';
import { safeUrl } from '../core/safe-url.js';
import { severityChip, severityStyles } from './ui-kit.js';

/** @typedef {import('../core/lookalikes.js').Lookalike} Lookalike */

/**
 * « Peut être confondue avec… »: the confusions the Anses and the Centres antipoison report for this plant,
 * with how to tell them apart (never a criterion that says a plant can be eaten: lookalikes.js#edibleFilter, as Faux
 * amis and the cards) and the source; each confusion's severity as the verdict's chip (danger.js#confusionChip). Each confusion folds on its own: closed at first when `compact`
 * (Épuré: one line each), open otherwise. The symptoms of a deadly confusion in every mode (Épuré: one line outside
 * the fold, in full once open), the others' when `detailed` (Scientifique). Nothing for other plants; when the list
 * cannot be read, says so (never « nothing »), with « Réessayer » (it also tells the sheet: `safety-retry`).
 */
export class GfLookalikes extends LitElement {
  static properties = {
    plant: { attribute: false },
    compact: { type: Boolean },
    detailed: { type: Boolean },
    /** The sheet has a map: each look-alike species can be compared on it (map-focus.js). */
    mapLinked: { type: Boolean, attribute: 'map-linked' },
    /** The sheet's map focus (which look-alike is compared). */
    mapFocus: { attribute: false },
    _list: { state: true },
    _loading: { state: true },
    _error: { state: true }
  };

  static styles = [ui, severityStyles, css`
    :host { display: block; }
    :host([hidden]) { display: none; }
    .box { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; }
    .alert {
      border-radius: var(--gf-radius);
      padding: 8px 12px;
      font-size: 0.9rem;
      line-height: 1.35;
      border: 1px solid #d97706;
      background: color-mix(in srgb, #f59e0b 16%, var(--gf-surface));
    }
    .alert.mortel { border-color: #b91c1c; background: color-mix(in srgb, #dc2626 13%, var(--gf-surface)); }
    summary { list-style: none; cursor: pointer; display: flex; gap: 6px; align-items: flex-start; border-radius: 4px; }
    summary::-webkit-details-marker { display: none; }
    summary:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    summary .what { flex: 1; min-width: 0; }
    .chev { flex: none; margin-top: 2px; transition: rotate 0.15s; color: var(--gf-text-muted); }
    details[open] .chev { rotate: 180deg; }
    @media (prefers-reduced-motion: reduce) { .chev { transition: none; } }
    .alert strong { display: inline; }
    .sym { display: block; margin-top: 2px; font-size: 0.8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    details[open] .sym { display: none; }
    .alert strong a { color: inherit; }
    .alert .sev-chip { margin-left: 4px; text-transform: uppercase; font-size: 0.68rem; letter-spacing: 0.03em; }
    ul { margin: 4px 0 0; padding-left: 18px; }
    li { margin: 2px 0; }
    .no-tell { margin: 4px 0 0; font-style: italic; }
    .muted { color: var(--gf-text-muted); font-size: 0.8rem; }
    .src { margin: 4px 0 0; }
    .src a { color: inherit; }
    .compare { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 0; }
    .compare button { min-height: 0; padding: 3px 10px; font-size: 0.8rem; border-radius: var(--gf-radius-pill); }
    .compare button[aria-pressed='true'] { border-color: #7b3294; color: #7b3294; background: color-mix(in srgb, #7b3294 10%, var(--gf-surface)); }
    .sos a { color: inherit; }
    .unread { margin: 0; }
    .unread button { min-height: 0; padding: 0 4px; }
  `];

  constructor() {
    super();
    this.plant = null;
    this.compact = false;
    this.detailed = false;
    /** @type {Lookalike[]} */
    this._list = [];
    this._loading = false;
    this._error = false;
  }

  /** @param {Map<string, unknown>} changed */
  willUpdate(changed) {
    if (changed.has('plant') && this.plant?.id !== /** @type {any} */ (changed.get('plant'))?.id) this.reload();
  }

  /**
   * Reads the plant's confusions (again: « Réessayer », here or in the sheet; a file that failed is asked again).
   * Kept while the plant has the same id: the collection editor passes a new object at each render.
   */
  reload() {
    this._list = [];
    this._error = false;
    this._loading = true;
    const plant = this.plant, id = plant?.id;
    const same = () => this.plant?.id === id;
    lookalikesOf(plant).then(list => { if (same()) this._list = list; },
      error => { console.error(error); if (same()) this._error = true; })
      .finally(() => { if (same()) this._loading = false; });
  }

  #retry = () => {
    this.reload();
    this.dispatchEvent(new CustomEvent('safety-retry', { bubbles: true, composed: true }));
  };

  /** @param {Lookalike['others'][number]} other */
  #other(other) {
    const genus = genusOf(other.taxon);
    const link = other.id ? href.plant(other.id) : genus ? '#/?genus=' + encodeURIComponent(genus) : null;
    return link ? html`<a href=${link}>${other.label}</a>` : html`<span>${other.label}</span>`;
  }

  /** « Comparer sur la carte »: the look-alike's GBIF occurrences beside this plant's, in another colour. @param {Lookalike['others']} others */
  #compare(others) {
    const species = others.filter(o => !genusOf(o.taxon));
    if (!species.length) return nothing;
    return html`<p class="compare">${species.map(o => {
      /** @type {import('../core/map-focus.js').CompareFocus} */ const f = { kind: 'compare', label: o.label, taxon: o.taxon };
      const on = isFocused(this.mapFocus, f);
      return html`<button type="button" aria-pressed=${on ? 'true' : 'false'} @click=${() => sendFocus(this, f)}>${icon('map')} ${on ? 'Comparée sur la carte' : 'Comparer sur la carte'} : ${o.label}</button>`;
    })}</p>`;
  }

  /** @param {Lookalike} l */
  #item(l) {
    const { pair, side, others } = l;
    // Épuré (folded): the symptoms one line under the head; in full once open.
    const sev = severityOf(pair), chip = confusionChip(pair, side);
    const symptoms = (this.detailed || sev.danger) && pair.symptoms;
    const criteria = edibleFilter(l).criteria;
    const names = others.map((o, i) => html`${i ? ', ' : ''}${this.#other(o)}`);
    const head = side === 'edible'
      ? html`<strong>${icon('exclamation-triangle-fill')} Peut être confondue avec ${names}</strong>`
      : html`<strong>${icon('exclamation-octagon-fill')} Plante ${sev.plant}, confondue avec ${names}</strong>`;
    // A danger (« mortel », « très toxique », the toxic plant itself) has the red box (class mortel); the chip says which.
    return html`<details class="alert ${chip.level === 'warn' ? 'toxique' : 'mortel'}" ?open=${!this.compact}>
      <summary><span class="what">${head}${severityChip(chip)} <span class="muted">· ${pair.part}</span>
        ${symptoms && this.compact ? html`<span class="sym"><b>Symptômes :</b> ${pair.symptoms}</span>` : nothing}</span>
        <span class="chev" aria-hidden="true">${icon('chevron-down')}</span></summary>
      ${criteria.length ? html`<ul>${criteria.map(t => html`<li>${t}</li>`)}</ul>`
        : html`<p class="no-tell">Nos sources ne donnent pas de critère pour les distinguer : en cas de doute, ne la cueillez pas.</p>`}
      ${this.mapLinked ? this.#compare(others) : nothing}
      ${symptoms ? html`<p class="src"><b>Symptômes :</b> ${pair.symptoms}</p>` : nothing}
      ${pair.severityFrom === 'tppt' ? html`<p class="src muted">Gravité : plante toxique au niveau le plus haut de la base TPPT (Agroscope), « très fortement toxique ».</p>` : nothing}
      <p class="src muted">Source${l.sources.length > 1 ? 's' : ''} : ${l.sources.map((s, i) => {
        const name = `${s.publisher} (${String(s.date).slice(0, 4)})`, url = safeUrl(s.url);
        return html`${i ? ' · ' : ''}${url ? html`<a href=${url} target="_blank" rel="noopener" title=${s.title}>${name}</a>` : html`<span title=${s.title}>${name}</span>`}`;
      })}</p>
    </details>`;
  }

  updated() {
    this.hidden = !this._list.length && !this._error;
    // Still reading the list: the sheet waits before saying there is nothing.
    this.toggleAttribute('loading', this._loading);
  }

  render() {
    const list = this._list;
    if (this._error) return html`<div class="box" aria-label="Plantes à confondre"><p class="alert mortel unread" role="alert">${icon('exclamation-octagon-fill')}
      <b>${UNREAD_LOOKALIKES}</b> <button type="button" class="link" @click=${this.#retry}>Réessayer</button></p></div>`;
    if (!list.length) return nothing;
    return html`<div class="box" aria-label="Plantes à confondre">
      ${repeat(list, (_, i) => this.plant?.id + ':' + i, l => this.#item(l))}
      <p class="muted">En cas de doute, ne la consommez pas. ${emergency()}.</p>
    </div>`;
  }
}

customElements.define('gf-lookalikes', GfLookalikes);
