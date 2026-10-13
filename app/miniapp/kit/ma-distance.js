// @ts-check
// How far to look, over the map of what was observed in the circle: a slider of distances (200 m to 50 km, what
// iNaturalist's search allows), its word for fun, how many observations — then « Qui pousse par ici ? » (on to the
// cards) or « Changer de lieu » (back to the start). The step « map » of Cueillette prudente and Mosaïque, and of
// Rencontres once its first steps are over (kit/ma-guided.js shows it otherwise).

import { LitElement, html, css } from 'lit';
import { icon } from '../../core/icons.js';
import { ui } from '../../styles/ui.js';
import { DISTANCES, distanceAt, distLabel, distMood } from './cards.js';
import { sessionOf } from './session.js';
import '../../components/gf-map.js';

export class MaDistance extends LitElement {
  static properties = {
    app: { attribute: false },
    /** The app's context (the place, the distance). */
    c: { attribute: false },
    /** The list's own view, back to it as the cards come (Mosaïque: the grid). */
    view: {}
  };

  static styles = [ui, css`
    :host { display: block; position: relative; min-height: 0; overflow-y: auto; background: var(--gf-bg, var(--gf-surface-2)); container-type: inline-size; }
    .welcome { max-width: 560px; margin: 0 auto; padding: 28px 20px 32px; display: grid; gap: 18px; text-align: center; }
    .welcome .leaf { font-size: 3rem; color: var(--gf-accent); }
    .welcome h1 { margin: 0; font-size: 1.7rem; line-height: 1.2; }
    .welcome p { margin: 0; color: var(--gf-text-muted); }
    .welcome .go { justify-self: center; font-size: 1.05rem; padding: 12px 26px; min-height: 48px; display: inline-flex; gap: 8px; align-items: center; }
    .skip { font-size: 0.85rem; }
    .dist { display: grid; gap: 4px; justify-items: center; }
    .dist output { font-size: 2.4rem; font-weight: 800; color: var(--gf-accent); font-variant-numeric: tabular-nums; }
    .dist .mood { color: var(--gf-text-muted); font-style: italic; }
    .dist input { width: min(100%, 420px); accent-color: var(--gf-accent); margin-top: 6px; }
    .dist .ticks { width: min(100%, 420px); display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--gf-text-muted); }
    .dist .obs { font-size: 0.8rem; color: var(--gf-text-muted); min-height: 1.2em; }
    .distance-wrap { position: relative; min-height: 100%; display: grid; }
    .distance-wrap gf-map { position: absolute; inset: 0; display: block; }
    /* Under the tiles, the colour of the aerial photo: a zoom out (a larger circle) shows no pale flash. */
    .distance-wrap gf-map .leaflet-container { background: #2f4a2c; }
    .distance-wrap .welcome { position: relative; z-index: 1; align-self: end; margin: auto auto 24px; width: min(560px, calc(100% - 24px)); padding: 18px 18px 16px;
      border-radius: 18px; background: color-mix(in srgb, var(--gf-surface) 92%, transparent); box-shadow: var(--gf-shadow-float); backdrop-filter: blur(6px); gap: 10px; }
    .distance-wrap .welcome .leaf { display: none; }
    .distance-wrap .welcome h1 { font-size: 1.35rem; }
  `];

  constructor() {
    super();
    /** @type {import('../runtime.js').MiniApp | null} */
    this.app = null;
    /** @type {Record<string, any> | null} */
    this.c = null;
    /** @type {string | null} */
    this.view = null;
  }

  #onChange = () => this.requestUpdate();
  /** @type {import('./session.js').AroundSession | null} */ #session = null;

  connectedCallback() {
    super.connectedCallback();
    // The discovery screens: no zone alerts on their maps (gf-map).
    this.setAttribute('no-areas', '');
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#session?.removeEventListener('change', this.#onChange);
    this.#session = null;
  }

  willUpdate() {
    if (!this.app) return;
    const s = sessionOf(this.app);
    if (s !== this.#session) {
      this.#session?.removeEventListener('change', this.#onChange);
      this.#session = s;
      s.addEventListener('change', this.#onChange);
    }
    // The distance changed: the map's observations follow (a moment after the slider stops).
    s.watchPoints();
  }

  /** The circle and its observations, the same object while they do not change (the map does not redraw them). */
  #area() {
    const s = /** @type {import('./session.js').AroundSession} */ (this.#session), c = /** @type {Record<string, any>} */ (this.c);
    const a = this.#areaMemo;
    if (a && a.center === c.point && a.radius === c.radius && a.obs === s.obs) return a;
    // The panel is over it: the circle framed beside it (above it on a phone). The 100 latest, each its plant's photo
    // popping in (a small card of the plant on hover).
    const inset = matchMedia('(max-width: 899px)').matches ? { bottom: 250 } : { right: 430 };
    return (this.#areaMemo = { center: c.point, radius: c.radius, fit: true, leaves: true, points: s.obs, obs: s.obs, asking: true, inset });
  }
  /** @type {any} */ #areaMemo = null;

  /** How many observations: all of them, and how many are on the map. */
  #obsLine() {
    const s = /** @type {import('./session.js').AroundSession} */ (this.#session);
    const n = s.obs.length, total = Math.max(s.obsTotal || 0, n);
    if (!n) return '';
    const fr = (/** @type {number} */ x) => x.toLocaleString('fr-FR');
    return `${fr(total)} observation${total > 1 ? 's' : ''} de plantes${total > n ? ` — les ${fr(n)} plus récentes sur la carte` : ' sur la carte'}`;
  }

  /** « Qui pousse par ici ? »: the cards, searched anew, in the list's own view. */
  #go() {
    const s = /** @type {import('./session.js').AroundSession} */ (this.#session);
    s.invalidate();
    s.setView(this.view);
    this.app?.go('cards');
  }

  render() {
    const app = this.app, c = this.c;
    if (!app || !c || !this.#session || !c.point) return html``;
    return html`<div class="distance-wrap">
      <gf-map no-search no-create no-locate .area=${this.#area()}></gf-map>
      <section class="welcome distance">
      <div class="leaf" aria-hidden="true">${icon('geo-alt-fill')}</div>
      <h1>Jusqu’où part l’expédition ?</h1>
      <p>Autour ${c.place ? 'de ' + c.place : 'de vous'}. Plus le cercle est grand, plus la récolte de rencontres est riche — et plus il faudra marcher pour aller les saluer.</p>
      <div class="dist">
        <output>${distLabel(c.radius)}</output>
        <span class="mood">${distMood(c.radius)}</span>
        <input type="range" min="0" max=${DISTANCES.length - 1} step="1" .value=${String(distanceAt(c.radius))} aria-label="Distance de la recherche"
          aria-valuetext=${distLabel(c.radius)} @input=${(/** @type {any} */ e) => app.set({ radius: DISTANCES[Number(e.target.value)] })} />
        <div class="ticks" aria-hidden="true"><span>200 m</span><span>50 km</span></div>
        <span class="obs" aria-live="polite">${this.#obsLine()}</span>
      </div>
      <button class="primary go" type="button" @click=${() => this.#go()}>${icon('binoculars')} Qui pousse par ici ?</button>
      <button class="link skip" type="button" @click=${() => app.go('start')}>Changer de lieu</button>
    </section></div>`;
  }
}

customElements.define('ma-distance', MaDistance);
