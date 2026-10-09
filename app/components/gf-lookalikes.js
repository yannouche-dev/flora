// @ts-check
import { LitElement, html, css, nothing, repeat } from 'lit';
import { lookalikesOf } from '../core/lookalikes.js';
import { href } from '../core/router.js';
import { ui } from '../styles/ui.js';
import { icon } from '../core/icons.js';

/** @typedef {import('../core/lookalikes.js').Lookalike} Lookalike */

/**
 * « Peut être confondue avec… »: the confusions the Anses and the Centres antipoison report for this plant,
 * with how to tell them apart and the source. Each confusion folds on its own: closed at first when `compact`
 * (Épuré: one line each), open otherwise. `detailed`: also the symptoms (Scientifique). Nothing for other plants.
 */
export class GfLookalikes extends LitElement {
  static properties = {
    plant: { attribute: false },
    compact: { type: Boolean },
    detailed: { type: Boolean },
    _list: { state: true },
    _loading: { state: true }
  };

  static styles = [ui, css`
    :host { display: block; }
    :host([hidden]) { display: none; }
    .box { display: grid; gap: 6px; }
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
    .alert strong a { color: inherit; }
    .sev { font-weight: 700; text-transform: uppercase; font-size: 0.72rem; letter-spacing: 0.03em; margin-left: 4px; }
    .mortel .sev { color: #b91c1c; }
    ul { margin: 4px 0 0; padding-left: 18px; }
    li { margin: 2px 0; }
    .muted { color: var(--gf-text-muted); font-size: 0.8rem; }
    .src { margin: 4px 0 0; }
    .src a { color: inherit; }
  `];

  constructor() {
    super();
    this.plant = null;
    this.compact = false;
    this.detailed = false;
    /** @type {Lookalike[]} */
    this._list = [];
    this._loading = false;
  }

  /** @param {Map<string, unknown>} changed */
  willUpdate(changed) {
    if (changed.has('plant') && this.plant?.id !== /** @type {any} */ (changed.get('plant'))?.id) {
      this._list = [];
      this._loading = true;
      const plant = this.plant;
      lookalikesOf(plant).then(list => { if (this.plant === plant) this._list = list; }).catch(console.error)
        .finally(() => { if (this.plant === plant) this._loading = false; });
    }
  }

  /** @param {Lookalike['others'][number]} other */
  #other(other) {
    const link = other.id ? href.plant(other.id) : other.taxon.includes(' ') ? null : '#/?genus=' + encodeURIComponent(other.taxon);
    return link ? html`<a href=${link}>${other.label}</a>` : html`<span>${other.label}</span>`;
  }

  /** @param {Lookalike} l */
  #item(l) {
    const { pair, side, others } = l;
    const names = others.map((o, i) => html`${i ? ', ' : ''}${this.#other(o)}`);
    const head = side === 'edible'
      ? html`<strong>${icon('exclamation-triangle-fill')} Peut être confondue avec ${names}</strong>`
      : html`<strong>${icon('exclamation-octagon-fill')} Plante toxique, confondue avec ${names}</strong>`;
    return html`<details class="alert ${pair.severity}" ?open=${!this.compact}>
      <summary><span class="what">${head}<span class="sev">${pair.severity}</span> <span class="muted">· ${pair.part}</span></span>
        <span class="chev" aria-hidden="true">${icon('chevron-down')}</span></summary>
      ${pair.tell.length ? html`<ul>${pair.tell.map(t => html`<li>${t}</li>`)}</ul>` : nothing}
      ${this.detailed && pair.symptoms ? html`<p class="src"><b>Symptômes :</b> ${pair.symptoms}</p>` : nothing}
      <p class="src muted">Source${l.sources.length > 1 ? 's' : ''} : ${l.sources.map((s, i) => html`${i ? ' · ' : ''}<a href=${s.url} target="_blank" rel="noopener" title=${s.title}>${s.publisher} (${s.date.slice(0, 4)})</a>`)}</p>
    </details>`;
  }

  updated() {
    this.hidden = !this._list.length;
    // Still reading the list: the sheet waits before saying there is nothing.
    this.toggleAttribute('loading', this._loading);
  }

  render() {
    const list = this._list;
    if (!list.length) return nothing;
    return html`<div class="box" aria-label="Plantes à confondre">
      ${repeat(list, (_, i) => this.plant?.id + ':' + i, l => this.#item(l))}
      <p class="muted">En cas de doute, ne pas consommer. Centre antipoison 24 h/24 ; le 15 en cas de détresse vitale.</p>
    </div>`;
  }
}

customElements.define('gf-lookalikes', GfLookalikes);
