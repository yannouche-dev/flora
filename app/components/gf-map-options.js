// @ts-check
// The maps' options, one UI wherever they are changed: the panel ▦ of every map (gf-map-panel.js, scope="map") and
// Réglages › Cartes (gf-settings.js, scope="defaults"), in this order —
//  1. whose options they are (every map's, or this map's own look and the way back);
//  2. « Affichage » (2D or 3D, the 3D options folded: map3d-options.js);
//  3. « Fond » (the plan, the aerial photos — the most recent, of a year, of a period, historical —, SPOT's satellite
//     images of a year: core/backgrounds.js);
//  4. « Sur cette carte » (scope="map", when its map has some: `data`): the data its page draws on it — the Carte's
//     GBIF distribution, my places, the plants observed around; a plant sheet's map block's distribution, my places,
//     the observations near me, its look-alike; a free layout's map's sources and the current plant's points —, a
//     checkbox or a list each, its page's own setting (`data-change` {key, value}: the page changes it, as its other
//     controls do, and gives the rows back);
//  5. « Couches affichées »: what is drawn over the background, from the top (gf-layer-stack.js: « Noms et réseaux »,
//     the overlays with their order and opacity, the background last);
//  6. « Noms et réseaux » (core/map-layers.js LANDMARKS: the places' names, the roads, the rivers by default; the
//     railways, the buildings, the boundaries), a checkbox each — over the photos and SPOT's; on a map's plan, which has
//     its own, disabled, kept (in Réglages, still chosen: the maps with their own photos or SPOT follow them);
//  7-9. IGN's layers by theme (core/map-layers.js PANEL: « Relief », « Forêts, haies et zones humides », « Espaces
//     protégés et propriété » — the protected areas in view and the rules of picking there —), each folded, opened by
//     itself once one of its layers is ticked (or, the last, an area in view), its count in its title;
//  10. « Toutes les couches de l’IGN » (the whole catalogue: gf-ign-layers.js), the layers ticked above ticked there too.
// Every option is the maps' common setting (core/map-settings.js), unless the map shown has its own look (`own`: a free
// layout's cell, a plant sheet's map block): then it says so, its changes are its own, and « Revenir aux réglages
// communs » lets it go. 2D / 3D and the 3D options are always common (a map always drawn one way says why).
//  scope="defaults": reads and changes the common settings itself.
//  scope="map": shows its map's look (`look`, `own`, `lookWhy`, `gl`, `own3d`: gf-map gives them through its panel)
//  and asks its map for each change, by events (bubbling, composed): look-edit {patch} (committed), look-preview {key,
//  opacity} (an opacity while its slider moves), look-common (« Revenir aux réglages communs »), renderer-follow
//  (« Suivre le réglage commun »: the 2D or 3D its owner fixed, let go), data-change {key, value} (a row of « Sur cette
//  carte », for its page).
// Slots, for what only a map has (scope="map"): `state` (its « État », first in « Affichage »), `rules` (first in
// « Espaces protégés et propriété »: the protected areas in view).

import { LitElement, html, css, nothing } from 'lit';
import { IGN_PREFIX, addCatalogLayer, overlayDef } from '../core/ign-layers.js';
import { LATEST_SPOT, PHOTO_HISTORIC, PHOTO_PERIODS, PHOTO_YEARS, SPOT_YEARS, fillerNote, parseBase, takesLandmarks, whenLabel } from '../core/backgrounds.js';
import { CATALOG_ROWS, LANDMARKS, LANDMARKS_LISTED, PANEL, catalogRowOf, cleanLandmarks } from '../core/map-layers.js';
import { mapLook, mapLookEvents, mapSettings, mapSettingsEvents, setMapLook, setMapSettings } from '../core/map-settings.js';
import { moduleEvents, moduleOn } from '../core/modules.js';
import { hasWebGL2 } from '../core/maplibre.js';
import { href } from '../core/router.js';
import { icon } from '../core/icons.js';
import { ui } from '../styles/ui.js';
import { map3dOptions, map3dOptionsCss, mapRendererChoice } from './map3d-options.js';
import './gf-layer-stack.js';
import './gf-ign-layers.js';

/**
 * @typedef {import('../core/map-settings.js').MapLook} MapLook @typedef {import('../core/backgrounds.js').BaseKey} BaseKey
 * @typedef {import('../core/map-layers.js').PanelGroup} PanelGroup
 */

/**
 * A row of « Sur cette carte »: a layer of data its page draws on the map, as its page's own setting says it — a
 * checkbox (`value` a boolean) or a list (`value` one of `options`' values); `disabled` with `why` (said under it, and
 * describing it): why it cannot change here.
 * @typedef {{ key: string, label: string, hint?: string, kind: 'check' | 'select', value: boolean | string,
 *   options?: { value: string, label: string }[], disabled?: boolean, why?: string }} DataRow
 */

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

/** Before picking, said first in « Espaces protégés et propriété ». */
const BEFORE_PICKING = 'Avant de cueillir : les règles du lieu et l’accord du propriétaire. Dans un espace protégé, la cueillette est souvent interdite ou réglementée.';

/** The overlay key of a row of the panel's themes: an overlay's own, or a catalogue's layer's (« ign:<id> »). @param {string} row */
const rowKey = row => CATALOG_ROWS[row] ? IGN_PREFIX + CATALOG_ROWS[row].id : row;

/**
 * What of the look a map has of its own, in words (its « Noms et réseaux » with its background: its own background
 * says both; them alone on the plan, which has its own, said of no effect there) — its panel's, a plant sheet's map
 * block form's (gf-plant-detail.js). @param {Partial<MapLook>} own @param {string} base the background it shows
 */
export function ownWords(own, base) {
  const names = takesLandmarks(base) ? 'son propre choix des noms et réseaux' : 'son propre choix des noms et réseaux, sans effet sur le plan IGN';
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
    lookWhy: { type: String, attribute: false },
    /** « Sur cette carte » (scope="map"): its page's layers of data on it (DataRow[]); none: no such section. */
    data: { attribute: false },
    /** The themes folded or open as last seen (a theme's key → open), else as its layers say (#auto). */
    _open: { state: true },
    /** Protected areas in view (slot `rules` filled): « Espaces protégés et propriété » opens by itself. */
    _inView: { state: true }
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
    label.layer input { flex: none; }
    label.layer span { display: grid; min-width: 0; overflow-wrap: anywhere; }
    label.layer small { color: var(--gf-text-muted); font-size: 0.8rem; }
    label.layer:has(input:disabled) { cursor: default; color: var(--gf-text-muted); }
    label.layer:has(input:disabled):hover { background: none; }
    .note { margin: 2px 4px 4px; font-size: 0.8rem; color: var(--gf-text-muted); }
    /* « Sur cette carte »: a list's row, its words then its list; why a row cannot change, under its words. */
    .data .pick { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; padding: 8px 4px; }
    .data .pick label { flex: 1 1 10em; display: grid; min-width: 0; overflow-wrap: anywhere; }
    .data .pick small { color: var(--gf-text-muted); font-size: 0.8rem; }
    .data .pick select { flex: 0 1 auto; max-width: 100%; }
    .data .pick:has(select:disabled) { color: var(--gf-text-muted); }
    .data .why { margin-top: -6px; padding-left: 36px; }
    /* A theme: folded under its title (a heading), its count of layers ticked beside it. */
    details.theme { min-width: 0; border-top: 1px solid var(--gf-border); }
    details.theme:last-of-type { border-bottom: 1px solid var(--gf-border); }
    details.theme > summary { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 2px 4px; cursor: pointer; list-style: none; border-radius: var(--gf-radius-sm); }
    details.theme > summary::-webkit-details-marker { display: none; }
    details.theme > summary::before { content: ''; flex: none; width: 0.5em; height: 0.5em; border: solid currentColor; border-width: 0 2px 2px 0; transform: rotate(-45deg); transition: transform 0.15s; margin: 0 4px; opacity: 0.6; }
    details.theme[open] > summary::before { transform: rotate(45deg); }
    details.theme > summary:hover { background: var(--gf-surface-2); }
    details.theme > summary h3 { margin: 0; flex: 1; min-width: 0; }
    details.theme > summary .count { flex: none; font-size: 0.8rem; color: var(--gf-text-muted); background: var(--gf-surface-2); border-radius: var(--gf-radius-pill); padding: 1px 8px; }
    details.theme[open] { padding-bottom: 8px; }
    details.theme h4 { margin: 10px 4px 2px; font-size: 0.8rem; font-weight: 600; color: var(--gf-text-muted); }
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
    /** @type {DataRow[]} */
    this.data = [];
    /** @type {Map<string, boolean>} */
    this._open = new Map();
    this._inView = false;
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

  /** A row of « Sur cette carte » just changed: its place there. @type {number | null} */
  #changed = null;

  /**
   * A row of « Sur cette carte » changed and taken away by its page (the look-alike let go: no row for none), the focus
   * gone with it: on the row now in its place, else the one above it, else « Couches affichées » (the row's control kept,
   * now the next one's: left there). @param {Map<string, any>} changed
   */
  updated(changed) {
    if (!changed.has('data') || this.#changed === null) return;
    const at = this.#changed;
    this.#changed = null;
    const root = /** @type {ShadowRoot} */ (this.renderRoot);
    if (root.activeElement || document.activeElement !== document.body) return;
    const here = [...root.querySelectorAll('.data input, .data select')];
    /** @type {HTMLElement | null | undefined} */ (here[Math.min(at, here.length - 1)] ?? root.querySelector('#layers-shown'))?.focus();
  }

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
   * IGN's whole catalogue made known first (kept, for every map): one of the panel's themes named as there, whichever
   * list ticks it (at its own opacity unless one is chosen: the shading's, core/ign-layers.js defaultOpacity).
   * @param {string} key @param {boolean} on @param {any} [layer] @param {string} [replace]
   */
  #toggle(key, on, layer, replace) {
    const k = layer ? addCatalogLayer(/** @type {any} */ (catalogRowOf(layer.id) ?? layer)) : key;
    const now = this.#look.overlays.filter(o => o !== k);
    const at = replace ? now.indexOf(replace) : -1;
    this.#edit({ overlays: !on ? now : at >= 0 ? now.map(o => o === replace ? k : o) : [...now, k] });
  }

  /** One of « Noms et réseaux » chosen or not (by its key). @param {string} key @param {boolean} on */
  #mark(key, on) {
    const now = this.#look.landmarks.filter(k => k !== key);
    this.#edit({ landmarks: cleanLandmarks(on ? [...now, key] : now) });
  }

  /**
   * gf-layer-stack's and gf-ign-layers' events (the layers shown, the catalogue), as changes of the look; not past this
   * element. @param {Event} e
   */
  #onLayers = e => {
    const d = /** @type {CustomEvent} */ (e).detail;
    e.stopPropagation();
    if (e.type === 'overlay-toggle') this.#toggle(d.key, d.on, d.layer, d.replace);
    else if (e.type === 'landmark-toggle') this.#mark(d.key, d.on);
    else if (e.type === 'overlay-order') this.#edit({ overlays: d.keys });
    else if (!d.commit) { if (!this.#defaults) this.#emit('look-preview', { key: d.key, opacity: d.opacity }); }
    else this.#edit({ opacities: { ...this.#look.opacities, [d.key]: Math.round(Math.min(1, Math.max(0, Number(d.opacity) || 0)) * 20) / 20 } });
  };

  /**
   * A row of the panel's themes: an overlay of the app's (its name, what it shows) or a catalogue's layer (its row's
   * title and hint), ticked when shown. @param {string} row @param {MapLook} look
   */
  #layer(row, look) {
    const cat = CATALOG_ROWS[row];
    const def = cat ? { label: cat.title, hint: cat.hint } : overlayDef(row);
    if (!def) return nothing;
    const key = rowKey(row);
    return html`<label class="layer">
      <input type="checkbox" .checked=${look.overlays.includes(key)}
        @change=${(/** @type {any} */ e) => cat ? this.#toggle(key, e.target.checked, cat) : this.#toggle(key, e.target.checked)} />
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
   * says all); in Réglages, by its own polite region (« Noms et réseaux » over them: #landmarks). @param {MapLook} look
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
      ${this.#defaults ? html`<div aria-live="polite">${noteView}</div>` : noteView}`;
  }

  /**
   * A map on the plan, which draws its own « Noms et réseaux » (not Réglages: the common choice is also every map's
   * with its own photos or SPOT — a free layout's cell, a plant sheet's map block). @param {MapLook} look
   */
  #onPlan(look) { return !this.#defaults && !takesLandmarks(look.base); }

  /**
   * « Noms et réseaux »: a checkbox each, in their order (core/map-layers.js LANDMARKS_LISTED), over the photos and
   * SPOT's, above every layer; on a map's plan, which draws its own, disabled — the choice kept for the photos and SPOT,
   * said by a note each checkbox is described by (in Réglages, the common plan: said, still chosen there for the maps
   * with their own photos or SPOT). @param {MapLook} look
   */
  #landmarks(look) {
    const plan = this.#onPlan(look), over = takesLandmarks(look.base);
    const id = (this.#defaults ? 'settings' : 'panel') + '-marks';
    const note = plan ? 'Le plan IGN dessine déjà les siens : ces choix valent pour les photos et SPOT.'
      : over ? 'Par-dessus les photos et les images SPOT, au-dessus de toutes les couches.'
      : 'Sans effet sur le plan IGN, qui a les siens : ces choix valent pour les cartes en photos ou SPOT.';
    return html`<h3 class="kicker" id=${id}>Noms et réseaux</h3>
      <p class="note" id=${id + '-note'}>${note}</p>
      <div class="marks" role="group" aria-labelledby=${id}>${LANDMARKS_LISTED.map(key => {
        const m = /** @type {import('../core/map-layers.js').Landmark} */ (LANDMARKS.find(l => l.key === key));
        return html`<label class="layer">
          <input type="checkbox" .checked=${look.landmarks.includes(key)} ?disabled=${plan} aria-describedby=${over ? nothing : id + '-note'}
            @change=${(/** @type {any} */ e) => this.#mark(key, e.target.checked)} />
          <span>${m.label}${m.hint ? html`<small>${m.hint}</small>` : nothing}</span>
        </label>`;
      })}</div>`;
  }

  /**
   * « Sur cette carte » (a map's panel, its page drawing data on it): each layer of data, a checkbox or a list, as its
   * page's own setting says it — changed by its page (`data-change` {key, value}), which gives the rows back; one that
   * cannot change here disabled, why said under it (and describing it). None: no section (Réglages, a map without data).
   */
  #data() {
    const rows = this.#defaults ? [] : this.data ?? [];
    if (!rows.length) return nothing;
    const change = (/** @type {DataRow} */ r, /** @type {boolean | string} */ value) => {
      this.#changed = rows.indexOf(r);
      this.#emit('data-change', { key: r.key, value });
    };
    return html`<h3 class="kicker" id="panel-data">Sur cette carte</h3>
      <div class="data" role="group" aria-labelledby="panel-data">${rows.map(r => {
        const id = 'panel-data-' + r.key;
        const why = r.disabled && r.why ? id + '-why' : null;
        const text = html`${r.label}${r.hint ? html`<small>${r.hint}</small>` : nothing}`;
        return html`${r.kind === 'select'
          ? html`<div class="layer pick" data-key=${r.key}><label for=${id}>${text}</label>
              <select id=${id} ?disabled=${Boolean(r.disabled)} aria-describedby=${why ?? nothing} @change=${(/** @type {any} */ e) => change(r, e.target.value)}>
                ${(r.options ?? []).map(o => html`<option value=${o.value} .selected=${o.value === r.value}>${o.label}</option>`)}
              </select></div>`
          : html`<label class="layer" data-key=${r.key}>
              <input type="checkbox" .checked=${Boolean(r.value)} ?disabled=${Boolean(r.disabled)} aria-describedby=${why ?? nothing}
                @change=${(/** @type {any} */ e) => change(r, e.target.checked)} />
              <span>${text}</span>
            </label>`}
          ${why ? html`<p class="note why" id=${why}>${r.why}</p>` : nothing}`;
      })}</div>`;
  }

  /** Its layers ticked: how many. @param {PanelGroup} g @param {MapLook} look */
  #ticked(g, look) { return g.parts.flatMap(p => p.rows).filter(r => look.overlays.includes(rowKey(r))).length; }

  /** Open by itself: one of its layers ticked; « Espaces protégés et propriété », an area in view too. @param {PanelGroup} g @param {MapLook} look */
  #auto(g, look) { return this.#ticked(g, look) > 0 || (g.key === 'espaces' && this._inView); }

  /**
   * A theme folded or opened (by a touch, or by itself: the details' toggle either way): kept so — a layer unticked
   * there never folds it under the finger, a theme folded stays so. @param {PanelGroup} g @param {Event} e
   */
  #fold(g, e) {
    const open = /** @type {HTMLDetailsElement} */ (e.currentTarget).open;
    if (this._open.get(g.key) !== open) this._open = new Map(this._open).set(g.key, open);
  }

  /**
   * A theme of IGN's layers (core/map-layers.js PANEL), folded under its title and its count of layers ticked: its
   * parts, each its title, its note, its rows; « Espaces protégés et propriété » first the protected areas in view (slot
   * `rules`) and what to know before picking. @param {PanelGroup} g @param {MapLook} look
   */
  #group(g, look) {
    const n = this.#ticked(g, look);
    const open = this._open.get(g.key) ?? this.#auto(g, look);
    const rules = g.key === 'espaces';
    return html`<details class="theme" data-group=${g.key} ?open=${open} @toggle=${(/** @type {Event} */ e) => this.#fold(g, e)}>
      <summary><h3 class="kicker">${g.title}</h3>${n ? html`<span class="count">${n} cochée${n > 1 ? 's' : ''}</span>` : nothing}</summary>
      ${rules ? html`<slot name="rules" @slotchange=${(/** @type {Event} */ e) => { this._inView = /** @type {HTMLSlotElement} */ (e.target).assignedElements().length > 0; }}></slot>
        <p class="note">${BEFORE_PICKING}</p>` : nothing}
      ${g.parts.map(p => html`${p.title ? html`<h4>${p.title}</h4>` : nothing}${p.note ? html`<p class="note">${p.note}</p>` : nothing}
        ${p.rows.map(r => this.#layer(r, look))}`)}
    </details>`;
  }

  render() {
    const look = this.#look;
    return html`
      ${this.#scope()}
      ${this.#display()}
      ${this.#bases(look)}
      ${this.#data()}

      <h3 class="kicker" id="layers-shown" tabindex="-1">Couches affichées</h3>
      <gf-layer-stack .base=${look.base} .landmarks=${look.landmarks} .overlays=${look.overlays} .opacities=${look.opacities}
        @overlay-toggle=${this.#onLayers} @overlay-order=${this.#onLayers} @overlay-opacity=${this.#onLayers} @landmark-toggle=${this.#onLayers}></gf-layer-stack>

      ${this.#landmarks(look)}
      <div class="themes">${PANEL.map(g => this.#group(g, look))}</div>

      <h3 class="kicker">Toutes les couches de l’IGN</h3>
      <p class="note">Tout le catalogue de la Géoplateforme, rangé par thème : photos anciennes, forêts, espaces protégés, sols, relief, cartes anciennes… Les couches cochées plus haut s’y retrouvent cochées.</p>
      <gf-ign-layers .overlays=${look.overlays} .landmarks=${look.landmarks} ?plan=${this.#onPlan(look)}
        @overlay-toggle=${this.#onLayers} @landmark-toggle=${this.#onLayers}></gf-ign-layers>`;
  }
}

customElements.define('gf-map-options', GfMapOptions);
