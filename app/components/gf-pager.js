// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { ui } from '../styles/ui.js';
import { icon } from '../core/icons.js';

/** @typedef {{ name: string, thumb?: string | null }} PagerPlant */

/**
 * Previous / next plant of a list (Flore's results, a collection or a place), docked at the bottom of the
 * plant pane, above the menu. `simple` (phone): ‹ 6 / 24 › and where the list comes from, big touch targets.
 * Otherwise complete: first, previous (its name and photo), the pages around (1 … 4 5 6 7 8 … 24), a field
 * to go to a position, next, last. Narrow panes drop the names, then the pages.
 * Emits `page` { index, dir? } (dir 'prev' / 'next' for a neighbour: the sheet can animate the move).
 */
export class GfPager extends LitElement {
  static properties = {
    index: { type: Number },
    total: { type: Number },
    /** Where the list comes from: « Résultats », a collection's name… */
    source: {},
    prev: { attribute: false },
    next: { attribute: false },
    simple: { type: Boolean, reflect: true }
  };

  static styles = [ui, css`
    :host { display: block; container-type: inline-size; position: relative; background: var(--gf-surface); border-top: 1px solid var(--gf-border); }
    /* Where we are in the list, at a glance. */
    .progress { position: absolute; left: 0; top: -1px; height: 2px; background: var(--gf-accent); transition: width 0.2s; }
    @media (prefers-reduced-motion: reduce) { .progress { transition: none; } }
    nav { display: flex; align-items: center; gap: 4px; padding: 4px 8px; min-height: 44px; }
    button { min-height: 0; border: 0; background: none; box-shadow: none; color: var(--gf-text); cursor: pointer; font: inherit; }
    button:disabled { opacity: 0.3; cursor: default; }
    button:focus-visible, input:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .icon { flex: none; width: 34px; height: 34px; padding: 0; display: grid; place-items: center; border-radius: var(--gf-radius); font-size: 1rem; }
    .icon:not(:disabled):hover, .side:not(:disabled):hover, .num:hover { background: var(--gf-surface-2); }
    .side { flex: 1 1 0; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: var(--gf-radius); text-align: left; }
    .side.next { justify-content: flex-end; text-align: right; }
    .side img, .side .ph { flex: none; width: 30px; height: 30px; border-radius: 6px; object-fit: cover; background: var(--gf-surface-2); }
    .side .txt { min-width: 0; display: grid; }
    .side small { color: var(--gf-text-muted); font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .side b { font-size: 0.85rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mid { flex: none; display: flex; align-items: center; gap: 2px; }
    .num { min-width: 30px; height: 30px; padding: 0 6px; border-radius: var(--gf-radius-pill); font-size: 0.8rem; font-variant-numeric: tabular-nums; color: var(--gf-text-muted); }
    .num[aria-current='true'] { background: var(--gf-accent); color: #fff; font-weight: 700; }
    .gap { color: var(--gf-text-muted); padding: 0 2px; }
    .jump { display: flex; align-items: center; gap: 4px; font-size: 0.8rem; color: var(--gf-text-muted); white-space: nowrap; margin-left: 4px; }
    .jump input { width: 3.4em; padding: 3px 6px; font: inherit; font-variant-numeric: tabular-nums; text-align: right; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-sm); background: var(--gf-surface); color: var(--gf-text); }
    .source { font-size: 0.72rem; color: var(--gf-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 14em; }
    /* Narrower panes: the pages and the source go, then the photos, then the names. */
    @container (max-width: 640px) { .pages, .source { display: none; } }
    @container (max-width: 560px) { .side img, .side .ph, .side small { display: none; } .side { padding: 4px; gap: 4px; } }
    @container (max-width: 340px) { .side .txt { display: none; } .side { flex: 0 0 auto; } .mid { flex: 1; justify-content: center; } }

    /* Simple (phone): ‹  6 / 24 · Résultats  ›, big targets. */
    :host([simple]) nav { gap: 8px; padding: 4px 10px; min-height: 48px; }
    .big { flex: none; display: flex; align-items: center; gap: 4px; height: 40px; padding: 0 14px; border-radius: var(--gf-radius-pill); background: var(--gf-surface-2); font-weight: 600; font-size: 0.85rem; }
    .here { flex: 1; min-width: 0; display: grid; justify-items: center; line-height: 1.2; }
    .here b { font-variant-numeric: tabular-nums; font-size: 0.95rem; }
    .here small { color: var(--gf-text-muted); font-size: 0.72rem; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `];

  constructor() {
    super();
    this.index = 0;
    this.total = 0;
    this.source = '';
    /** @type {PagerPlant | null} */ this.prev = null;
    /** @type {PagerPlant | null} */ this.next = null;
    this.simple = false;
  }

  /** @param {number} index */
  #go(index) {
    if (index < 0 || index >= this.total || index === this.index) return;
    const dir = index === this.index - 1 ? 'prev' : index === this.index + 1 ? 'next' : undefined;
    this.dispatchEvent(new CustomEvent('page', { detail: { index, dir } }));
  }

  /** The pages shown around the current one: first, last, two on each side, gaps as null. */
  #pages() {
    const n = this.total, i = this.index;
    const keep = new Set([0, n - 1, i - 2, i - 1, i, i + 1, i + 2].filter(k => k >= 0 && k < n));
    /** @type {(number | null)[]} */ const out = [];
    let last = -1;
    for (const k of [...keep].sort((a, b) => a - b)) {
      if (k - last > 1) out.push(k - last === 2 ? last + 1 : null);
      out.push(k);
      last = k;
    }
    return out;
  }

  render() {
    const { index: i, total: n } = this;
    if (n < 2) return nothing;
    const pos = `${(i + 1).toLocaleString('fr-FR')} / ${n.toLocaleString('fr-FR')}`;
    const progress = html`<span class="progress" style=${`width:${((i + 1) / n * 100).toFixed(2)}%`} aria-hidden="true"></span>`;
    const label = `Plantes ${this.source ? 'de « ' + this.source + ' »' : ''}`.trim();
    if (this.simple) return html`${progress}<nav aria-label=${label}>
      <button class="big" type="button" ?disabled=${i === 0} aria-label=${'Plante précédente' + (this.prev ? ' : ' + this.prev.name : '')} @click=${() => this.#go(i - 1)}>${icon('chevron-left')} Préc.</button>
      <span class="here" aria-live="polite"><b>${pos}</b>${this.source ? html`<small>${this.source}</small>` : nothing}</span>
      <button class="big" type="button" ?disabled=${i === n - 1} aria-label=${'Plante suivante' + (this.next ? ' : ' + this.next.name : '')} @click=${() => this.#go(i + 1)}>Suiv. ${icon('chevron-right')}</button>
    </nav>`;
    const side = (/** @type {'prev' | 'next'} */ dir) => {
      const p = dir === 'prev' ? this.prev : this.next;
      const to = dir === 'prev' ? i - 1 : i + 1;
      const pic = p?.thumb ? html`<img src=${p.thumb} alt="" loading="lazy" referrerpolicy="no-referrer" />` : html`<span class="ph" aria-hidden="true"></span>`;
      const txt = html`<span class="txt"><small>${dir === 'prev' ? '← Précédente' : 'Suivante →'}</small><b>${p?.name ?? '—'}</b></span>`;
      return html`<button class="side ${dir}" type="button" ?disabled=${!p} title=${p ? (dir === 'prev' ? 'Plante précédente : ' : 'Plante suivante : ') + p.name : ''}
        aria-label=${(dir === 'prev' ? 'Plante précédente' : 'Plante suivante') + (p ? ' : ' + p.name : '')} @click=${() => this.#go(to)}>
        ${dir === 'prev' ? html`${icon('chevron-left')}${pic}${txt}` : html`${txt}${pic}${icon('chevron-right')}`}</button>`;
    };
    return html`${progress}<nav aria-label=${label}>
      <button class="icon" type="button" ?disabled=${i === 0} title="Première plante" aria-label="Première plante" @click=${() => this.#go(0)}>${icon('chevron-bar-left')}</button>
      ${side('prev')}
      <span class="mid">
        <span class="pages" role="group" aria-label="Positions">${this.#pages().map(k => k === null ? html`<span class="gap">…</span>`
          : html`<button class="num" type="button" aria-current=${k === i ? 'true' : 'false'} aria-label=${'Plante ' + (k + 1)} @click=${() => this.#go(k)}>${k + 1}</button>`)}</span>
        <label class="jump" title=${this.source ? 'Dans « ' + this.source + ' »' : ''}>
          <input type="number" min="1" max=${n} .value=${String(i + 1)} aria-label=${'Aller à la plante n° (sur ' + n + ')'}
            @change=${(/** @type {Event} */ e) => { const t = /** @type {HTMLInputElement} */ (e.target); const k = Math.round(Number(t.value)) - 1; if (k >= 0 && k < n) this.#go(k); else t.value = String(i + 1); }}
            @keydown=${(/** @type {KeyboardEvent} */ e) => e.stopPropagation()} />
          <span>/ ${n.toLocaleString('fr-FR')}</span>
        </label>
        ${this.source ? html`<span class="source">· ${this.source}</span>` : nothing}
      </span>
      ${side('next')}
      <button class="icon" type="button" ?disabled=${i === n - 1} title="Dernière plante" aria-label="Dernière plante" @click=${() => this.#go(n - 1)}>${icon('chevron-bar-right')}</button>
    </nav>`;
  }
}

customElements.define('gf-pager', GfPager);
