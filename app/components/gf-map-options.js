// @ts-check
// The maps' options, one UI wherever they are changed: the panel ▦ of every map (gf-map-panel.js, scope="map") and
// Réglages › Cartes (gf-settings.js, scope="defaults") — « Affichage » (2D or 3D, the 3D options folded:
// map3d-options.js), « Fond », and IGN's layers (terrain, the whole catalogue: gf-ign-layers.js, the rules of picking).
// Every option is the maps' common setting (core/map-settings.js), unless the map shown has its own look (`own`: a free
// layout's cell, a plant sheet's map block): then it says so, its changes are its own, and « Revenir aux réglages
// communs » lets it go. 2D / 3D and the 3D options are always common (a map always drawn one way says why).
//  scope="defaults": reads and changes the common settings itself.
//  scope="map": shows its map's look (`look`, `own`, `lookWhy`, `gl`, `own3d`: gf-map gives them through its panel)
//  and asks its map for each change, by events (bubbling, composed): look-edit {patch} (committed), look-preview {key,
//  opacity} (an opacity while its slider moves), look-common (« Revenir aux réglages communs »), renderer-follow
//  (« Suivre le réglage commun »: the 2D or 3D its owner fixed, let go).
// Slots, for what only a map has (scope="map"): `state` (its « État », first in « Affichage »), `extra` (after « Fond »:
// the GBIF distribution of the Carte's plant), `rules` (before the rules' layers: the protected areas in view).

import { LitElement, html, css, nothing } from 'lit';
import { BASES, OVERLAYS, addCatalogLayer, overlayDef } from '../core/ign-layers.js';
import { mapLook, mapLookEvents, mapSettings, mapSettingsEvents, setMapLook, setMapSettings } from '../core/map-settings.js';
import { moduleEvents, moduleOn } from '../core/modules.js';
import { hasWebGL2 } from '../core/maplibre.js';
import { href } from '../core/router.js';
import { icon } from '../core/icons.js';
import { ui } from '../styles/ui.js';
import { map3dOptions, map3dOptionsCss, mapRendererChoice } from './map3d-options.js';
import './gf-ign-layers.js';

/** @typedef {import('../core/map-settings.js').MapLook} MapLook */

/** What of the look a map has of its own, in words. @param {Partial<MapLook>} own */
function ownWords(own) {
  const base = 'base' in own || 'names' in own, layers = 'overlays' in own || 'opacities' in own;
  return base && layers ? 'son propre fond et ses propres couches' : base ? 'son propre fond' : 'ses propres couches';
}

export class GfMapOptions extends LitElement {
  static properties = {
    /** 'map': a map's panel (its look, its events); 'defaults': Réglages › Cartes (the common settings, changed here). */
    scope: { type: String, reflect: true },
    /** The look the map shows (scope="map"; gf-map lookShown). */
    look: { attribute: false },
    /** What of it is the map's own (null: all common). */
    own: { attribute: false },
    /** How the map is drawn (gf-map-gl.js): { on, fixed: { renderer, why } | null }; null: not known yet. */
    gl: { attribute: false },
    /** Its 2D or 3D fixed by its owner (a free layout's 3d=), which « Suivre le réglage commun » lets go. */
    own3d: { type: Boolean, attribute: false },
    /** Why its own look is its owner's to keep (a free layout's intent): said, without « Revenir aux réglages communs ». */
    lookWhy: { type: String, attribute: false }
  };

  static styles = [ui, map3dOptionsCss, css`
    :host { display: grid; gap: 4px; min-width: 0; }
    h3 { margin: 14px 0 6px; }
    .display { display: grid; gap: 6px; }
    .scope { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin: 6px 0 0; padding: 8px 10px;
      border-radius: var(--gf-radius-sm); background: var(--gf-surface-2); font-size: 0.85rem; }
    .scope .bi { flex: none; color: var(--gf-text-muted); }
    .scope.own { background: var(--gf-accent-soft); }
    .scope.own .bi { color: var(--gf-accent); }
    .scope a { color: var(--gf-accent); }
    .scope .link { min-height: 32px; padding: 2px 4px; font-size: 0.85rem; }
    .bases { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .bases button {
      display: grid;
      justify-items: center;
      gap: 4px;
      min-height: 72px;
      border-radius: var(--gf-radius);
      font-size: 0.9rem;
    }
    .bases .ico { font-size: 1.6rem; line-height: 1; }
    .bases button[aria-pressed='true'] { background: var(--gf-accent-soft); border-color: var(--gf-accent); border-width: 2px; font-weight: 600; }
    label.layer { display: flex; align-items: center; gap: 12px; padding: 8px 4px; border-radius: var(--gf-radius-sm); cursor: pointer; }
    label.layer:hover { background: var(--gf-surface-2); }
    label.layer span { display: grid; }
    label.layer small { color: var(--gf-text-muted); font-size: 0.8rem; }
    .note { margin: 2px 4px 4px; font-size: 0.8rem; color: var(--gf-text-muted); }
  `];

  constructor() {
    super();
    /** @type {'map' | 'defaults'} */
    this.scope = 'map';
    /** @type {MapLook | null} */
    this.look = null;
    /** @type {Partial<MapLook> | null} */
    this.own = null;
    /** @type {{ on: boolean, fixed: { renderer: '2d' | '3d', why: string } | null } | null} */
    this.gl = null;
    this.own3d = false;
    this.lookWhy = '';
  }

  connectedCallback() {
    super.connectedCallback();
    // The 2D / 3D choice and the common look, changed here, on another map, in Réglages or another tab; a module that
    // the 3D options depend on.
    mapSettingsEvents.addEventListener('change', this.#redraw);
    mapLookEvents.addEventListener('change', this.#redraw);
    moduleEvents.addEventListener('change', this.#redraw);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    mapSettingsEvents.removeEventListener('change', this.#redraw);
    mapLookEvents.removeEventListener('change', this.#redraw);
    moduleEvents.removeEventListener('change', this.#redraw);
  }

  #redraw = () => this.requestUpdate();

  /** The catalogue shown before: asked again (online again, a month gone, the module switched…). */
  reopen() { /** @type {any} */ (this.renderRoot.querySelector('gf-ign-layers'))?.reopen(); }

  get #defaults() { return this.scope === 'defaults'; }

  /** The look shown: the common one in Réglages, the map's in its panel. @returns {MapLook} */
  get #look() {
    const l = this.#defaults ? null : this.look;
    if (l) return l;
    const c = mapLook();
    return { base: c.base, names: c.names, overlays: [...c.overlays], opacities: { ...c.opacities } };
  }

  /** @param {string} name @param {any} [detail] */
  #emit(name, detail = {}) { this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true })); }

  /** A field of the look changed: the common look here, its map's choice there. @param {Partial<MapLook>} patch */
  #edit(patch) {
    if (this.#defaults) setMapLook(patch);
    else this.#emit('look-edit', { patch });
  }

  /**
   * An overlay on (on top, or in the place of the one it replaces: another variant of its series) or off — a layer of
   * IGN's whole catalogue made known first (kept, for every map).
   * @param {string} key @param {boolean} on @param {any} [layer] @param {string} [replace]
   */
  #toggle(key, on, layer, replace) {
    const k = layer ? addCatalogLayer(layer) : key;
    const now = this.#look.overlays.filter(o => o !== k);
    const at = replace ? now.indexOf(replace) : -1;
    if (!on) this.#edit({ overlays: now });
    else if (at >= 0) this.#edit({ overlays: now.map(o => o === replace ? k : o) });
    else this.#edit({ overlays: [...now, k] });
  }

  /** gf-ign-layers' events (its « Affichées » list, its catalogue), as changes of the look; not past this element. @param {Event} e */
  #onLayers = e => {
    const d = /** @type {CustomEvent} */ (e).detail;
    e.stopPropagation();
    if (e.type === 'overlay-toggle') this.#toggle(d.key, d.on, d.layer, d.replace);
    else if (e.type === 'overlay-order') this.#edit({ overlays: d.keys });
    else if (!d.commit) { if (!this.#defaults) this.#emit('look-preview', { key: d.key, opacity: d.opacity }); }
    else this.#edit({ opacities: { ...this.#look.opacities, [d.key]: Math.round(Math.min(1, Math.max(0, Number(d.opacity) || 0)) * 20) / 20 } });
  };

  /** @param {string} key */
  #layer(key) {
    const def = overlayDef(key);
    if (!def) return nothing;
    return html`<label class="layer">
      <input type="checkbox" .checked=${this.#look.overlays.includes(key)}
        @change=${(/** @type {any} */ e) => this.#toggle(key, e.target.checked)} />
      <span>${def.label}${def.hint ? html`<small>${def.hint}</small>` : nothing}</span>
    </label>`;
  }

  /**
   * Whose options these are: the common ones (every map), or — a map with its own look — that map's, with the way back
   * to the common ones (none when its owner keeps it: why said).
   */
  #scope() {
    if (this.#defaults) return nothing;
    if (this.own) {
      return html`<p class="scope own">${icon('pin-map')}<span>Cette carte a ${ownWords(this.own)}${this.lookWhy ? ` (${this.lookWhy})` : ''}</span>
        ${this.lookWhy ? nothing : html`<button type="button" class="link" @click=${() => this.#emit('look-common')}>${icon('arrow-counterclockwise')} Revenir aux réglages communs</button>`}</p>`;
    }
    return html`<p class="scope">${icon('globe-europe-africa')}<span>Réglages communs à toutes les cartes</span>
      <a href=${href.settings()}>Réglages › Cartes</a></p>`;
  }

  /**
   * « Affichage »: 2D or 3D — one choice for every map — and, in 3D, its options (folded on a map: its layers come
   * next). A map always drawn one way says so, the choice disabled; fixed by its owner, the way back to the common one.
   */
  #display() {
    const s = mapSettings();
    const fixed = this.#defaults ? null : this.gl?.fixed ?? null;
    const id = this.#defaults ? 'settings' : 'panel';
    const change = (/** @type {Partial<import('../core/map-settings.js').MapSettings>} */ patch) => setMapSettings(patch);
    return html`<h3 class="kicker">Affichage</h3>
      <div class="display">
        <slot name="state"></slot>
        ${mapRendererChoice(s, change, { id, legend: this.#defaults ? 'Affichage des cartes' : 'Carte en 2D ou en 3D', webgl: hasWebGL2(), fixed })}
        ${fixed && this.own3d ? html`<p><button type="button" class="small" @click=${() => this.#emit('renderer-follow')}>
          ${icon('arrow-counterclockwise')} Suivre le réglage commun</button></p>` : nothing}
        ${fixed || s.renderer !== '3d' ? nothing : html`<details class="more3d" ?open=${this.#defaults}>
          <summary>Options de la 3D</summary>
          ${map3dOptions(s, change, { relief: moduleOn('relief3d'), ign: moduleOn('ignMaps'), id: id + '3d' })}
        </details>`}
        ${this.own ? html`<p class="note">2D ou 3D : le même choix pour toutes les cartes (<a href=${href.settings()}>Réglages › Cartes</a>).</p>` : nothing}
      </div>`;
  }

  render() {
    const look = this.#look;
    const group = (/** @type {string} */ g) => Object.keys(OVERLAYS).filter(k => OVERLAYS[k].group === g);
    return html`
      ${this.#scope()}
      ${this.#display()}
      <h3 class="kicker">Fond</h3>
      <div class="bases" role="group" aria-label="Fond de carte">
        ${Object.entries(BASES).map(([key, def]) => html`
          <button type="button" aria-pressed=${look.base === key ? 'true' : 'false'} @click=${() => { if (look.base !== key) this.#edit({ base: /** @type {'photo' | 'plan'} */ (key) }); }}>
            <span class="ico" aria-hidden="true">${icon(key === 'photo' ? 'globe-europe-africa' : 'map')}</span>${def.label}
          </button>`)}
      </div>
      <slot name="extra"></slot>

      <h3 class="kicker">Terrain</h3>
      ${group('terrain').map(k => this.#layer(k))}

      <h3 class="kicker">Toutes les couches de l’IGN</h3>
      <p class="note">Tout le catalogue de la Géoplateforme, rangé par thème : photos anciennes, forêts, espaces protégés, sols, relief, cartes anciennes…</p>
      <gf-ign-layers .overlays=${look.overlays} .opacities=${look.opacities}
        @overlay-toggle=${this.#onLayers} @overlay-order=${this.#onLayers} @overlay-opacity=${this.#onLayers}></gf-ign-layers>

      <h3 class="kicker">Règles de cueillette</h3>
      <slot name="rules"></slot>
      <p class="note">Dans ces zones, la cueillette a souvent des règles propres : vérifiez-les avant de cueillir.</p>
      ${group('rules').map(k => this.#layer(k))}`;
  }
}

customElements.define('gf-map-options', GfMapOptions);
