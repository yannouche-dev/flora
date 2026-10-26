// @ts-check
// The plants of the walk, one line each — its photo, its names and, met several times, « × 3 » —, the last met first;
// the one just added lit. Touched: its occurrences lit on the map and « Ajouter ici » in the head (again: let go); a
// plant touched on the map is brought into view here. None yet: how to name one.

import { LitElement, html, css, nothing, repeat } from 'lit';
import { ui } from '../../styles/ui.js';
import { countOf, groupsOf } from './trail-store.js';
import { SessionWatch } from './watch.js';
import '../../components/gf-thumb.js';

export class MaWalkList extends LitElement {
  static properties = {
    /** The game (kit/trail-session.js). */
    session: { attribute: false }
  };

  static styles = [ui, css`
    :host { display: block; }
    h2 { margin: 2px 2px 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--gf-text-muted); display: flex; justify-content: space-between; }
    /* The plants met: one line each (its photo, its names, × how many times), the list scrolling. */
    .mine { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
    .mine > li { border-radius: 12px; background: var(--gf-surface); }
    .mine > li.fresh { box-shadow: inset 0 0 0 2px var(--gf-accent); }
    .mine > li.sel { background: color-mix(in srgb, var(--gf-accent-soft) 55%, var(--gf-surface)); box-shadow: inset 0 0 0 2px var(--gf-accent), var(--gf-shadow); }
    .mine .pick { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 10px; align-items: center; width: 100%; padding: 6px 8px; border: 0; border-radius: 12px;
      background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .mine .pick:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .mine .pick .t { min-width: 0; display: grid; }
    .mine .pick b { font-size: 0.95rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mine .pick i { font-size: 0.78rem; color: var(--gf-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mine .n { font-size: 0.78rem; font-weight: 700; color: var(--gf-accent); background: var(--gf-accent-soft); border-radius: var(--gf-radius-pill); padding: 2px 8px; white-space: nowrap; }
    .hint { margin: 0; padding: 6px 2px; color: var(--gf-text-muted); font-size: 0.92rem; }
  `];

  constructor() {
    super();
    /** @type {import('./trail-session.js').TrailSession | null} */
    this.session = null;
  }

  /** Drawn again as the game changes. */
  _watch = new SessionWatch(this, () => this.session);

  /** The plant last brought into view. @type {number | null} */
  #shownSel = null;

  updated() {
    // A plant touched (here or on the map): its line lit and brought into view.
    const sel = this.session?.sel ?? null;
    if (sel === this.#shownSel) return;
    this.#shownSel = sel;
    if (sel != null) this.renderRoot.querySelector(`.mine li[data-plant="${sel}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  render() {
    const s = this.session, t = s?.trail;
    if (!s || !t) return nothing;
    const plants = groupsOf(t);
    return plants.length ? html`<h2><span>Le parcours</span><span>${countOf(t)}</span></h2>
      <ul class="mine">${repeat(plants, g => g.plantId, g => this.#row(g))}</ul>`
      : html`<p class="hint">Tapez ou dites le nom d’une plante (« ortie », « pissenlit »…) : la flore la propose, son marqueur + la pose sur la carte, là où vous êtes.</p>`;
  }

  /**
   * A plant met on the way, one line: its photo, its names, how many times. Touched: its occurrences lit on the map,
   * « Ajouter ici » in the head (again: let go). @param {{ plantId: number, entries: any[], last: any }} g
   */
  #row(g) {
    const s = /** @type {import('./trail-session.js').TrailSession} */ (this.session);
    const e = g.last, n = g.entries.length, sel = s.sel === g.plantId;
    const name = e.vernacularName || e.scientificName;
    const fresh = g.entries.some(x => x.id === s.fresh);
    return html`<li class="${sel ? 'sel' : ''} ${fresh ? 'fresh' : ''}" data-plant=${g.plantId}>
      <button class="pick" type="button" aria-pressed=${sel ? 'true' : 'false'}
        aria-label=${`${name}${n > 1 ? `, ${n} fois` : ''} : ${sel ? 'ne plus la montrer' : 'la montrer sur la carte'}`} @click=${() => s.select(sel ? null : g.plantId)}>
        <gf-thumb plant-id=${g.plantId} size="44"></gf-thumb>
        <span class="t"><b>${name}</b>${e.vernacularName ? html`<i>${e.scientificName}</i>` : nothing}</span>
        ${n > 1 ? html`<span class="n" title=${`Notée ${n} fois dans le parcours`}>× ${n}</span>` : nothing}
      </button>
    </li>`;
  }
}

customElements.define('ma-walk-list', MaWalkList);
