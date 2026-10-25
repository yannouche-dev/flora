// @ts-check
// The maps' options, one UI wherever they are changed: the panel ▦ of every map (gf-map-panel.js, scope="map") and
// Réglages › Cartes (gf-settings.js, scope="defaults") — « Affichage » (2D or 3D, the 3D options folded:
// map3d-options.js), « Fond » (the plan, the aerial photos — the most recent, of a year, of a period, historical —, SPOT's
// satellite images of a year: core/backgrounds.js; over the photos and SPOT's, the names — roads, rivers, places: the
// usual « Noms et réseaux » of core/map-layers.js —, a checkbox), and IGN's layers (terrain, the whole catalogue:
// gf-ign-layers.js, the rules of picking).
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
import { OVERLAYS, addCatalogLayer, overlayDef } from '../core/ign-layers.js';
import { LATEST_SPOT, PHOTO_HISTORIC, PHOTO_PERIODS, PHOTO_YEARS, SPOT_YEARS, fillerNote, parseBase, takesLandmarks, whenLabel } from '../core/backgrounds.js';
import { LANDMARK_DEFAULTS } from '../core/map-layers.js';
import { mapLook, mapLookEvents, mapSettings, mapSettingsEvents, setMapLook, setMapSettings } from '../core/map-settings.js';
import { moduleEvents, moduleOn } from '../core/modules.js';
import { hasWebGL2 } from '../core/maplibre.js';
import { href } from '../core/router.js';
import { icon } from '../core/icons.js';
import { ui } from '../styles/ui.js';
import { map3dOptions, map3dOptionsCss, mapRendererChoice } from './map3d-options.js';
import './gf-ign-layers.js';

/** @typedef {import('../core/map-settings.js').MapLook} MapLook @typedef {import('../core/backgrounds.js').BaseKey} BaseKey */

/**
 * The kinds of background, one button each: [kind, its name, its icon, the background it shows when chosen (the most
 * recent: the photos of now, SPOT's latest year)].
 * @type {[import('../core/backgrounds.js').BaseKind, string, import('../core/icons.js').IconName, BaseKey][]}
 */
const KINDS = [
  ['plan', 'Plan IGN', 'map', 'plan'],
  ['photo', 'Photos aériennes', 'image', 'photo'],
  ['spot', 'Satellite (SPOT)', 'globe-europe-africa', `spot:${LATEST_SPOT}`]
];

/**
 * What of the look a map has of its own, in words (its names with its background: its own background says both; its
 * names alone on the plan, which has its own, said of no effect there) — its panel's, a plant sheet's map block form's
 * (gf-plant-detail.js). @param {Partial<MapLook>} own @param {string} base the background it shows
 */
export function ownWords(own, base) {
  const names = takesLandmarks(base) ? 'son propre choix des noms' : 'son propre choix des noms, sans effet sur le plan IGN';
  const fond = 'base' in own ? 'son propre fond' : 'landmarks' in own ? names : '';
  const layers = 'overlays' in own || 'opacities' in own ? 'ses propres couches' : '';
  return [fond, layers].filter(Boolean).join(' et ');
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
    .bases { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .bases button {
      display: grid;
      justify-items: center;
      align-content: center;
      gap: 4px;
      min-height: 72px;
      min-width: 0;
      padding: 8px 4px;
      border-radius: var(--gf-radius);
      font-size: 0.9rem;
      text-align: center;
      overflow-wrap: anywhere;
    }
    .bases .ico { font-size: 1.6rem; line-height: 1; }
    .bases button[aria-pressed='true'] { background: var(--gf-accent-soft); border-color: var(--gf-accent); border-width: 2px; font-weight: 600; }
    label.layer { display: flex; align-items: center; gap: 12px; padding: 8px 4px; border-radius: var(--gf-radius-sm); cursor: pointer; }
    label.layer:hover { background: var(--gf-surface-2); }
    label.layer span { display: grid; }
    label.layer small { color: var(--gf-text-muted); font-size: 0.8rem; }
    .note { margin: 2px 4px 4px; font-size: 0.8rem; color: var(--gf-text-muted); }
    .when { display: grid; gap: 4px; margin: 10px 0 2px; min-width: 0; }
    .when label { font-size: 0.85rem; color: var(--gf-text-muted); }
    .when select { width: 100%; max-width: 100%; }
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
    return { base: c.base, landmarks: [...c.landmarks], overlays: [...c.overlays], opacities: { ...c.opacities } };
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
      return html`<p class="scope own">${icon('pin-map')}<span>Cette carte a ${ownWords(this.own, this.#look.base)}${this.lookWhy ? ` (${this.lookWhy})` : ''}</span>
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

  /**
   * « Fond »: the plan, the aerial photos, SPOT's satellite images — a button each, the kind shown pressed —; under the
   * photos their date (the most recent, a year, a period, historical ones), under SPOT its year, each a list; under the
   * photos of a year or a period, where they are missing (the most recent ones, greyed): the list's description, said
   * when a date brings it — on a map, by its panel's one live region (`options-say`: the panel is a modal, one region
   * says all); in Réglages, by its own polite region. Over the photos and SPOT's, the names (a checkbox, on by default:
   * ticked, the usual « Noms et réseaux », core/map-layers.js LANDMARK_DEFAULTS; unticked, none) — not on the plan, which
   * has its own: no checkbox there, as no date. @param {MapLook} look
   */
  #bases(look) {
    const kind = parseBase(look.base)?.kind ?? 'photo';
    const id = (this.#defaults ? 'settings' : 'panel') + '-base-when';
    const option = (/** @type {string} */ key, /** @type {string} */ label) => html`<option value=${key} .selected=${look.base === key}>${label}</option>`;
    const choose = (/** @type {Event} */ e) => {
      const base = /** @type {BaseKey} */ (/** @type {HTMLSelectElement} */ (e.target).value);
      this.#edit({ base });
      const said = fillerNote(base);
      if (said && !this.#defaults) this.#emit('options-say', { text: said });
    };
    const note = fillerNote(look.base);
    const noteView = note ? html`<p class="note" id=${id + '-note'}>${note}</p>` : nothing;
    const described = note ? id + '-note' : nothing;
    return html`<h3 class="kicker">Fond</h3>
      <div class="bases" role="group" aria-label="Fond de carte">
        ${KINDS.map(([k, label, ico, first]) => html`
          <button type="button" aria-pressed=${kind === k ? 'true' : 'false'} @click=${() => { if (kind !== k) this.#edit({ base: first }); }}>
            <span class="ico" aria-hidden="true">${icon(ico)}</span>${label}
          </button>`)}
      </div>
      ${kind === 'photo' ? html`<div class="when"><label for=${id}>Date des photos</label>
        <select id=${id} aria-describedby=${described} @change=${choose}>
          ${option('photo', 'La plus récente')}
          <optgroup label="Une année">${PHOTO_YEARS.map(w => option('photo:' + w, w))}</optgroup>
          <optgroup label="Une période">${PHOTO_PERIODS.map(w => option('photo:' + w, whenLabel(w)))}</optgroup>
          <optgroup label="Photos historiques">${PHOTO_HISTORIC.map(w => option('photo:' + w, whenLabel(w)))}</optgroup>
        </select></div>`
      : kind === 'spot' ? html`<div class="when"><label for=${id}>Année des images</label>
        <select id=${id} @change=${choose}>${SPOT_YEARS.map(y => option('spot:' + y, y))}</select></div>` : nothing}
      ${this.#defaults ? html`<div aria-live="polite">${noteView}</div>` : noteView}
      ${takesLandmarks(look.base) ? html`<label class="layer">
        <input type="checkbox" .checked=${look.landmarks.length > 0}
          @change=${(/** @type {any} */ e) => this.#edit({ landmarks: e.target.checked ? [...LANDMARK_DEFAULTS] : [] })} />
        <span>Afficher les noms : villes, routes, rivières, forêts</span>
      </label>` : nothing}`;
  }

  render() {
    const look = this.#look;
    const group = (/** @type {string} */ g) => Object.keys(OVERLAYS).filter(k => OVERLAYS[k].group === g);
    return html`
      ${this.#scope()}
      ${this.#display()}
      ${this.#bases(look)}
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
