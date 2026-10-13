// @ts-check
// The Parcours, walking (the step « walk »): one screen made for a walk.
//  - A phone: the walk's card at the top (kit/ma-walk-card.js), its map always in sight (ma-walk-map), the plants met
//    (ma-walk-list), and the search stuck at the bottom, under the thumb (ma-walk-search) — even with the keyboard up
//    (the page fits itself above the keys, fitKeyboard). Nothing scrolls but the list. Searching, the suggestions rise
//    over the card, the map and the list, which stay where they are underneath, out of reach.
//  - Wider (900 px): the same column on the left — its width the user's (a separator, geoflora.trailLayout) —, the
//    map on the right, in sight beside the suggestions.
// A word after each action (« Ortie dioïque ajoutée au parcours, ici », « Annuler »), over the bottom, waits under the
// suggestions. The game (kit/trail-session.js) is followed (my position) while it is on screen.

import { LitElement, html, css, nothing } from 'lit';
import { icon } from '../../core/icons.js';
import { PaneSizer } from '../../core/panes.js';
import { config } from '../../config.js';
import { ui } from '../../styles/ui.js';
import { trailSessionOf } from './trail-session.js';
import { SessionWatch } from './watch.js';
import './ma-walk-card.js';
import './ma-walk-list.js';
import './ma-walk-map.js';
import './ma-walk-search.js';

/**
 * While a walk is walked, the keyboard shrinks the page (its search and the menu stay right above the keys):
 * `interactive-widget=resizes-content` (Chrome, Firefox), else gf-app fits itself to the visual viewport (Safari) —
 * told by `data-fit-keyboard`. Elsewhere, the browser's own way (the page under the keyboard, scrolled to the field).
 * @param {boolean} on
 */
function fitKeyboard(on) {
  const root = document.documentElement;
  if (root.hasAttribute('data-fit-keyboard') === on) return;
  root.toggleAttribute('data-fit-keyboard', on);
  // gf-app fits itself again at once (the keyboard may be up as the walk is entered or left).
  window.dispatchEvent(new Event('fit-keyboard'));
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  const rest = (meta.getAttribute('content') || '').split(',').map(x => x.trim()).filter(x => x && !x.startsWith('interactive-widget'));
  meta.setAttribute('content', [...rest, ...(on ? ['interactive-widget=resizes-content'] : [])].join(', '));
}

export class MaWalk extends LitElement {
  static properties = {
    app: { attribute: false },
    /** The search open (its sheet over the walk). */
    _open: { state: true }
  };

  static styles = [ui, css`
    :host { display: block; position: relative; height: 100%; background: var(--gf-bg, var(--gf-surface-2)); container-type: inline-size; }
    /*
     * Walking. A phone: the walk's card, the map (always in sight), the plants noted, and the search at the bottom,
     * under the thumb — its suggestions open above it. Wider: the same column on the left, the map on the right.
     */
    .wrap { display: grid; grid-template-columns: minmax(0, 1fr); position: relative; height: 100%; min-height: 0; overflow: clip;
      grid-template-areas: "head" "map" "list" "dock"; grid-template-rows: minmax(0, auto) minmax(0, 1fr) minmax(0, auto) auto; }
    .side { display: contents; }
    .head { grid-area: head; padding: 10px 12px 8px; min-height: 0; overflow: hidden; }
    .mapcol { grid-area: map; position: relative; min-height: 0; overflow: hidden; }
    .list { grid-area: list; min-height: 0; max-height: 30dvh; overflow-y: auto; padding: 8px 12px 4px; box-sizing: border-box; border-top: 1px solid var(--gf-border); background: var(--gf-bg, var(--gf-surface-2)); }
    .head, .mapcol, .list { transition: opacity 0.2s ease; }
    .seeking .head, .seeking .mapcol, .seeking .list { opacity: 0; }
    /* The separator between the walk and the map (wide screens). */
    .wrap > .split { display: none; width: 9px; margin-left: -4px; z-index: 6; cursor: col-resize; position: relative; touch-action: none; }
    .wrap > .split::after { content: ''; position: absolute; inset: 0 4px; transition: background 0.12s; }
    .wrap > .split:hover::after, .wrap > .split:focus-visible::after, .wrap > .split.dragging::after { background: var(--gf-accent); inset: 0 3px; }
    .wrap > .split:focus-visible { outline: none; }
    .wrap > .guide { position: absolute; top: 0; bottom: 0; left: -1px; width: 3px; background: var(--gf-accent); z-index: 7; pointer-events: none; }
    .wrap > .guide span { position: absolute; top: 50%; left: 8px; padding: 2px 8px; border-radius: var(--gf-radius-pill); background: var(--gf-accent); color: var(--gf-accent-contrast); font-size: 0.75rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
    @media (pointer: coarse) {
      .wrap > .split { width: 44px; margin-left: -22px; }
      .wrap > .split::after { inset: 0 21.5px; }
      .wrap > .split:hover::after, .wrap > .split:focus-visible::after, .wrap > .split.dragging::after { inset: 0 20.5px; }
      .wrap > .split::before { content: ''; position: absolute; top: 50%; left: 50%; width: 10px; height: 44px; translate: -50% -50%; border-radius: 5px;
        background: var(--gf-surface); border: 1px solid var(--gf-border); box-shadow: 0 1px 4px rgb(0 0 0 / 18%); z-index: 1; }
    }
    :host(.resizing) { cursor: col-resize; user-select: none; }
    @container (min-width: 900px) {
      .wrap { grid-template-columns: minmax(360px, 480px) 0 minmax(0, 1fr); grid-template-areas: "side split map"; grid-template-rows: minmax(0, 1fr); }
      /* A width chosen (the separator): kept while the map keeps 360 px. */
      .wrap.sized { grid-template-columns: max(320px, min(var(--w-side), calc(100% - 360px))) 0 minmax(0, 1fr); }
      .wrap > .split { display: block; grid-area: split; }
      .side { grid-area: side; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; min-height: 0; overflow: hidden; border-right: 1px solid var(--gf-border); }
      .head { grid-area: 1 / 1; padding: 14px 14px 10px; }
      .list { grid-area: 2 / 1; max-height: none; border-top: 0; padding: 4px 14px; }
      /* Wide: the map stays in sight beside the suggestions. */
      .seeking .mapcol { opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) { .head, .mapcol, .list { transition: none; } }
    .toast { position: absolute; z-index: 20; left: 12px; right: 12px; margin: 0 auto; width: fit-content; bottom: calc(84px + env(safe-area-inset-bottom, 0px)); display: flex; gap: 12px; align-items: center; padding: 10px 14px 10px 16px;
      border-radius: var(--gf-radius-pill); background: #1f2a1f; color: #fff; box-shadow: 0 10px 30px rgb(0 0 0 / 35%); font-size: 0.92rem; animation: up 0.25s ease-out; }
    .toast button { border: 0; background: none; color: #9be15d; font: inherit; font-weight: 700; cursor: pointer; padding: 4px; }
    @keyframes up { from { opacity: 0; transform: translateY(10px); } }
    @container (max-width: 899px) {
      .head { padding: 8px 10px 4px; }
      /* A phone, searching: the map under the sheet is out of reach too (Tab, screen readers), once faded. */
      .seeking .mapcol { visibility: hidden; transition: opacity 0.2s ease, visibility 0s linear 0.2s; }
    }
    @media (max-height: 480px) { .list { max-height: 22dvh; } }
    @media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
  `];

  constructor() {
    super();
    /** @type {import('../runtime.js').MiniApp | null} */
    this.app = null;
    this._open = false;
    this.addEventListener('walk-seeking', e => {
      this._open = Boolean(/** @type {CustomEvent} */ (e).detail?.open);
      this.#session?.setSearching(this._open);
    });
  }

  get #session() { return this.app ? trailSessionOf(this.app) : null; }

  /** Drawn again as the game changes. */
  _watch = new SessionWatch(this, () => this.#session);

  /** The walk's column (wide screens): its width, remembered; the map takes the rest. */
  #sizer = new PaneSizer(this, config.storageKeys.trailLayout, { side: { width: 480, min: 320, title: 'Parcours' } },
    { onChange: () => /** @type {any} */ (this.renderRoot.querySelector('ma-walk-map'))?.holdFrame?.() });

  connectedCallback() {
    super.connectedCallback();
    // Where I am, followed while the walk is on screen (once the permission is granted: no gesture here).
    this.#session?.follow();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    fitKeyboard(false);
    this.#session?.stop();
  }

  updated() {
    // Only while on screen: a late update (a toast's end, a GPS fix, the IGN's name) never sets it elsewhere.
    fitKeyboard(this.isConnected && Boolean(this.#session?.trail));
  }

  render() {
    const s = this.#session, t = s?.trail;
    if (!s || !t) return nothing;
    const open = this._open;
    const sized = 'side' in this.#sizer.state.widths;
    // Under the suggestions, the walk is out of reach (the keyboard's Tab, the screen readers): only what is seen.
    return html`<div class="wrap ${open ? 'seeking' : ''} ${sized ? 'sized' : ''}" style=${sized ? `--w-side: ${this.#sizer.width('side')}px` : ''}>
      <h1 class="visually-hidden">Parcours botanique : ${t.properties.name}</h1>
      <div class="side">
        <div class="head" ?inert=${open}><ma-walk-card .session=${s}></ma-walk-card></div>
        <section class="list" aria-label="Les plantes du parcours" ?inert=${open}><ma-walk-list .session=${s}></ma-walk-list></section>
        <ma-walk-search .session=${s}></ma-walk-search>
      </div>
      ${this.#sizer.split('side', 'left', () => this.clientWidth - 360)}
      <div class="mapcol"><ma-walk-map .session=${s}></ma-walk-map></div>
      ${s.toast && !open ? html`<div class="toast" role="status">${icon('check-lg')} <span>${s.toast.text}</span>
        ${s.toast.undo ? html`<button type="button" @click=${() => { s.toast?.undo?.(); s.toast = null; s.changed(); }}>Annuler</button>` : nothing}</div>` : nothing}
    </div>`;
  }
}

customElements.define('ma-walk', MaWalk);
