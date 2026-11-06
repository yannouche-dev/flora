// @ts-check
// The Parcours' recap (the step « done »), on the start screens' template: its picture the map of the walk with
// every plant (« Vue 3D » over it: the walk on the relief, kit/../components/gf-map3d.js — or why it cannot open
// here), the plants met, the altitude profile of the walk; « Parcours terminé », what it holds, how long, how far,
// how high — then « Partager le parcours » (the big action); smaller: see it in Mes plantes, take it up again, start
// another; the way out. Left for another scenario, it is not shown again (not for Mes plantes: Back comes to it).

import { LitElement, html, css, nothing, svg } from 'lit';
import { icon } from '../../core/icons.js';
import { plantMarkers } from '../../core/collections.js';
import { formatAltitude } from '../../core/altitude.js';
import { href, parse } from '../../core/router.js';
import { startScreen, startStyles } from '../../components/start-screen.js';
import { map3dProblem, openMap3d } from '../../components/gf-map3d.js';
import { ui } from '../../styles/ui.js';
import { briefToast } from '../../core/toast.js';
import { writeJSON } from '../../core/prefs.js';
import { DONE, countOf, groupsOf } from './trail-store.js';
import { recapOf } from './trail-recap.js';
import { trailSessionOf } from './trail-session.js';
import { SessionWatch } from './watch.js';
import '../../components/gf-map.js';
import '../../components/gf-thumb.js';

/** The map of a walk shows its plants, not its place. */
const NO_SPOTS = /** @type {any[]} */ ([]);

export class MaTrailRecap extends LitElement {
  static properties = {
    app: { attribute: false }
  };

  static styles = [ui, startStyles, css`
    :host { display: block; position: relative; height: 100%; background: var(--gf-bg, var(--gf-surface-2)); container-type: inline-size; }
    .wrap { display: grid; grid-template-columns: minmax(0, 1fr); min-height: 100%; align-content: start; }
    .start .art > .recap { display: grid; gap: 10px; }
    .start .art:has(> .recap) { width: min(100%, 420px); }
    @media (max-height: 500px) and (min-aspect-ratio: 3/2) { .start .art > .recap .recap-map { height: 160px; } }
    .recap-map { position: relative; height: clamp(140px, 26dvh, 240px); border-radius: 16px; overflow: hidden; box-shadow: var(--gf-shadow); }
    .recap-map gf-map { position: absolute; inset: 0; display: block; }
    /* « Vue 3D », over the recap's map (above Leaflet's panes and controls). */
    .recap-map .map3d { position: absolute; top: 8px; left: 8px; z-index: 1000; min-height: 44px; padding: 0 14px; gap: 6px; border-radius: var(--gf-radius-pill);
      background: var(--gf-surface); color: var(--gf-text); border: 1px solid var(--gf-border); box-shadow: var(--gf-shadow); font-weight: 600; }
    .met { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
    .met .more-n { align-self: center; font-size: 0.8rem; font-weight: 700; color: var(--gf-text-muted); padding: 0 4px; }
    /* The walk's altitude profile, under the plants met. */
    .profile { margin: 0; }
    .profile svg { display: block; width: 100%; height: auto; }
    .profile .area { fill: color-mix(in srgb, var(--gf-accent) 18%, transparent); }
    .profile .line { fill: none; stroke: var(--gf-accent); stroke-width: 2; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
    .profile circle { fill: var(--gf-surface); stroke: var(--gf-accent); stroke-width: 1.5; }
    .profile figcaption { text-align: center; font-size: 0.75rem; color: var(--gf-text-muted); font-variant-numeric: tabular-nums; }
    .recap-of { display: block; color: var(--gf-text); font-weight: 600; }
  `];

  constructor() {
    super();
    /** @type {import('../runtime.js').MiniApp | null} */
    this.app = null;
  }

  get #session() { return this.app ? trailSessionOf(this.app) : null; }

  /** Drawn again as the game changes. */
  _watch = new SessionWatch(this, () => this.#session);

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#toast?.shown?.hide();
    this.#toast = null;
    // The recap left for another scenario (not for « Le voir dans Mes plantes », whose Back comes to it again; not for
    // another walk, which leaves it itself).
    if (this.#session?.done && parse(location.hash).name !== 'collections') writeJSON(DONE, null);
  }

  /**
   * « Vue 3D » of the walk; when it cannot open here (no WebGL2, the module off), why: a brief toast over its map, said
   * by the map's live region (the user asked; the quiet-map rule, gf-map.js) — and the button's title says it too.
   * @param {any} t @param {Event} e
   */
  async #open3d(t, e) {
    const problem = await openMap3d(t, /** @type {HTMLElement} */ (e.currentTarget));
    if (problem) /** @type {any} */ (this.renderRoot.querySelector('.recap-map gf-map'))?.toast(problem);
  }

  render() {
    const s = this.#session, t = s?.done;
    if (!s || !t) return nothing;
    const plants = t.properties.plants, groups = groupsOf(t);
    const markers = plantMarkers([t]);
    // Its point (none: nothing to frame but its plants), then its plants.
    const points = [t.geometry?.coordinates, ...markers.map(m => m.coordinates)].filter(Boolean);
    const frame = { key: 'done:' + t.id, points, maxZoom: 17 };
    const { profile, time, dist } = recapOf(t);
    const walk = [time && 'en ' + time, dist && 'sur ' + dist, profile && profile.climb >= 10 && `${formatAltitude(profile.climb)} de montée`].filter(Boolean).join(', ');
    const art = html`<div class="recap">
      <div class="recap-map"><gf-map no-search no-create .spots=${NO_SPOTS} .plants=${markers} plant-zoom="0" .frame=${frame}></gf-map>
        ${markers.length ? html`<button type="button" class="map3d" title=${map3dProblem() || 'Le parcours sur le relief'} @click=${(/** @type {Event} */ e) => this.#open3d(t, e)}>${icon('map')} Vue 3D</button>` : nothing}</div>
      ${groups.length ? html`<ul class="met" aria-label="Les plantes du parcours">${groups.slice(0, 8).map(g => html`<li title=${g.last.vernacularName || g.last.scientificName}><gf-thumb plant-id=${g.plantId} size="44" round></gf-thumb></li>`)}
        ${groups.length > 8 ? html`<li class="more-n">+${groups.length - 8}</li>` : nothing}</ul>` : nothing}
      ${profile ? this.#profile(profile) : nothing}
    </div>`;
    return html`<div class="wrap done">${startScreen({
      id: 'trail-done',
      art,
      title: 'Parcours terminé',
      lead: html`<span class="recap-of">${t.properties.name}</span>${plants.length ? `${countOf(t)}${walk ? ', ' + walk : ''}.` : 'Aucune plante notée.'}`,
      primary: plants.length
        ? { icon: 'share', label: 'Partager le parcours', run: () => s.share(t) }
        : { icon: 'geo-alt-fill', label: 'Un nouveau parcours', run: () => s.another() },
      note: 'Il reste dans Mes plantes.',
      alternatives: [
        { kind: 'link', icon: 'collection', label: 'Le voir dans Mes plantes', href: href.collections({ open: t.id }) },
        { kind: 'link', icon: 'arrow-right', label: 'Le continuer', run: () => s.resume(t) },
        plants.length > 0 && { kind: 'link', icon: 'geo-alt-fill', label: 'Un nouveau parcours', run: () => s.another() }
      ],
      // The recap stays until another activity is chosen (Découvrir closed without a choice: still here).
      exit: { icon: 'camera-reels', label: 'Autres activités', run: () => this.app?.scenarios() }
    })}
    </div>`;
  }

  updated() { this.#syncToast(); }

  /** The word shown now (the session's toast), and how to let it go. @type {{ toast: any, shown: { hide: () => void } | null } | null} */
  #toast = null;

  /**
   * The recap's word (« Lien du parcours copié… »): the app's brief toast (core/toast.js), as during the walk
   * (ma-walk.js#syncToast) — above the button it speaks of, in the top layer, read out by the toasts' own live region;
   * the session times it.
   */
  #syncToast() {
    const s = this.#session, toast = s?.done ? s.toast : null;
    if (this.#toast?.toast === toast) return;
    this.#toast?.shown?.hide();
    this.#toast = null;
    if (!toast) return;
    const go = this.renderRoot.querySelector('button.go');
    this.#toast = { toast, shown: briefToast(toast.text, go ? { near: go, at: 'above', offset: 10, ms: 0 } : { near: this, at: 'bottom', offset: 12, ms: 0 }) };
  }

  /**
   * The walk's altitude profile: the ground's altitude at each plant, by distance from the start; its lowest and
   * highest. @param {NonNullable<ReturnType<typeof recapOf>['profile']>} p
   */
  #profile(p) {
    const W = 320, H = 84, pad = 6;
    const span = Math.max(20, p.high - p.low), len = Math.max(1, p.length);
    const x = (/** @type {number} */ d) => pad + d / len * (W - 2 * pad);
    const y = (/** @type {number} */ m) => H - pad - (m - p.low) / span * (H - 2 * pad);
    const line = p.points.map((q, i) => `${i ? 'L' : 'M'}${x(q.d).toFixed(1)} ${y(q.m).toFixed(1)}`).join(' ');
    const area = `${line} L${x(p.points[p.points.length - 1].d).toFixed(1)} ${H} L${x(p.points[0].d).toFixed(1)} ${H} Z`;
    return html`<figure class="profile">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label=${`Profil d’altitude du parcours : de ${formatAltitude(p.low)} à ${formatAltitude(p.high)}, ${formatAltitude(p.climb)} de montée`}>
        ${svg`<path class="area" d=${area}></path><path class="line" d=${line}></path>
        ${p.points.map(q => svg`<circle cx=${x(q.d)} cy=${y(q.m)} r="3"><title>${q.label ? q.label + ' — ' : ''}${formatAltitude(q.m)}</title></circle>`)}`}
      </svg>
      <figcaption>Altitude au fil des plantes : de ${formatAltitude(p.low)} à ${formatAltitude(p.high)} (IGN)</figcaption>
    </figure>`;
  }
}

customElements.define('ma-trail-recap', MaTrailRecap);
