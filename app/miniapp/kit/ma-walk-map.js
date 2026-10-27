// @ts-check
// The map of the walk: a marker for each occurrence (not the walk's pin, which would gather them under a count), and
// me, followed. Framed on the whole walk (its start and every plant), again as it grows; a plant touched: on its
// occurrences, and me where I was when it was touched (« Ajouter ici ») — the map stays put as I walk. A marker
// touched: its plant lit (the game's select).

import { LitElement, html, css, nothing } from 'lit';
import { plantMarkers } from '../../core/collections.js';
import { ui } from '../../styles/ui.js';
import { SessionWatch } from './watch.js';
import '../../components/gf-map.js';

/** The map of a walk shows its plants, not its place. */
const NO_SPOTS = /** @type {any[]} */ ([]);

export class MaWalkMap extends LitElement {
  static properties = {
    /** The game (kit/trail-session.js). */
    session: { attribute: false }
  };

  // The map's own parts (its controls, my position) take the app's look from here (gf-map draws in this root).
  static styles = [ui, css`
    :host { position: absolute; inset: 0; display: block; }
    /* Its row may be small (landscape, the keyboard up): the map keeps to it, never over the plants. */
    gf-map { position: absolute; inset: 0; display: block; min-height: 0; }
  `];

  constructor() {
    super();
    /** @type {import('./trail-session.js').TrailSession | null} */
    this.session = null;
  }

  /** Drawn again as the game changes. */
  _watch = new SessionWatch(this, () => this.session);

  /** The map's view held while its column changes width (the separator beside it). */
  holdFrame() { /** @type {any} */ (this.renderRoot.querySelector('gf-map'))?.holdFrame?.(); }

  render() {
    const s = this.session, t = s?.trail;
    if (!s || !t) return nothing;
    const markers = plantMarkers([t]);
    const lit = s.sel != null ? markers.filter(m => m.plantId === s.sel) : [];
    const shown = lit.length ? lit.map(m => m.coordinates) : [t.geometry?.coordinates, ...markers.map(m => m.coordinates)].filter(Boolean);
    const points = lit.length && s.fix ? [...shown, s.fix.coordinates] : shown;
    // A new frame each time (the map zooms once per key, and tries again while it has no size yet).
    const frame = { key: 'trail:' + t.id + ':' + (s.sel ?? '') + ':' + shown.map(c => c.join(',')).join(';'), maxZoom: lit.length ? 19 : 17, points, ease: true };
    return html`<gf-map no-search no-create .spots=${NO_SPOTS} .plants=${markers} plant-zoom="0" .frame=${frame} track
      .selectedPlant=${lit.length ? lit.map(m => m.key) : null}
      @plant-select=${(/** @type {CustomEvent} */ e) => s.select(e.detail.plantId, e.detail.entryId)}></gf-map>`;
  }
}

customElements.define('ma-walk-map', MaWalkMap);
