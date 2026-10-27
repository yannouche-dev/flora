// @ts-check
// « Vue 3D »: a parcours (or a place of Mes plantes) on the relief, read-only, in a modal dialog over the app. Not a map
// of its own: the app's one map, gf-map, set to show in 3D whatever Réglages › Cartes say (map-3d="on": its MapLibre
// renderer, gf-map-gl.js) — its plants as on every map (their photo in a ring); a parcours (marked `walk`) also its
// walk from plant to plant (gf-map's `line`) and its start — another lieu, its plants only; a plant touched: its name
// and altitude (the IGN's, kept with it).
//   openMap3d(place, opener) → null when the view opened, else why not (« 3D indisponible sur cet appareil »…),
//   for the button to say. One view at a time (one element, in the body); its map goes when it closes.
// The relief (module « Vue 3D (relief) »), the photos, offline and failures: as on every map in 3D (flat, said).

import { LitElement, html, nothing } from 'lit';
import { moduleOn } from '../core/modules.js';
import { altitudeOf, formatAltitude } from '../core/altitude.js';
import { plantMarkers } from '../core/collections.js';
import { walkOf } from '../core/walk.js';
import { openModal } from '../core/history.js';
import { icon } from '../core/icons.js';
import { hasWebGL2 } from '../core/maplibre.js';
import './gf-map.js';

export const UNAVAILABLE = '3D indisponible sur cet appareil (WebGL2 requis).';
const MODULE_OFF = 'Vue 3D désactivée : module « Vue 3D (relief) » dans Réglages › Modules.';

/** Why the 3D view cannot open here (the module off, no WebGL2), or null. */
export function map3dProblem() {
  if (!moduleOn('relief3d')) return MODULE_OFF;
  if (!hasWebGL2()) return UNAVAILABLE;
  return null;
}

/**
 * Opens the 3D view of a place (a parcours: its walk and its start too). Resolves once the view is up (null), or with why it could
 * not open — then nothing stays open. `opener` gets the focus back when the view closes.
 * @param {any} place @param {HTMLElement | null} [opener]
 * @returns {Promise<string | null>}
 */
export async function openMap3d(place, opener = null) {
  const problem = map3dProblem();
  if (problem) return problem;
  let view = /** @type {GfMap3d | null} */ (document.querySelector('gf-map3d'));
  if (!view) {
    view = /** @type {GfMap3d} */ (document.createElement('gf-map3d'));
    document.body.append(view);
  }
  return view.show(place, opener);
}

export class GfMap3d extends LitElement {
  static properties = {
    _place: { state: true },
    _card: { state: true }
  };

  constructor() {
    super();
    /** @type {any} */
    this._place = null;
    /** The plant touched: { name, sci, m }. @type {{ name: string, sci: string, m: number | null } | null} */
    this._card = null;
  }

  /** Light DOM: map.css and gf-map's stylesheets reach it. */
  createRenderRoot() { return this; }

  /** @type {HTMLElement | null} */
  #opener = null;

  get #dialog() { return /** @type {HTMLDialogElement} */ (this.querySelector('dialog')); }

  render() {
    const place = this._place;
    return html`<dialog class="gf-map3d" aria-labelledby="gf3d-title" @close=${() => this.#closed()}>
      <header class="gf3d-head">
        <h2 id="gf3d-title"><span class="gf3d-kicker">Vue 3D</span> ${place?.properties?.name || ''}</h2>
        <button type="button" class="gf3d-close" autofocus aria-label="Fermer la vue 3D" @click=${() => this.#dialog.close()}>${icon('x-lg')}</button>
      </header>
      <div class="gf3d-canvas">${place ? this.#map(place) : nothing}</div>
      ${this._card ? html`<div class="gf3d-card"><b>${this._card.name}</b>${this._card.sci && this._card.sci !== this._card.name ? html`<i>${this._card.sci}</i>` : nothing}
        <small>${this.#altitude(this._card)}</small>
        <button type="button" class="gf3d-card-x" aria-label="Fermer la fiche de la plante" title="Fermer" @click=${() => { this._card = null; }}>${icon('x-lg')}</button></div>` : nothing}
    </dialog>`;
  }

  /**
   * The app's map, in 3D: the place's plants; a parcours' walk and its start too (a point named « Départ », with its
   * altitude) — never a line drawn through the plants of a lieu that is no walk. @param {any} place
   */
  #map(place) {
    const { line, start } = place.properties.walk ? walkOf(place) : { line: [], start: null };
    const plants = plantMarkers([place]);
    const points = [...plants.map(p => p.coordinates), ...(start ? [start] : [])].filter(Boolean);
    const m = start ? altitudeOf(place.properties, start) : null;
    return html`<gf-map map-3d="on" no-search no-create no-locate no-areas plant-zoom="0" point-click="none"
      .spots=${[]} .plants=${plants} .line=${{ key: place.id, coordinates: line }}
      .points=${start ? [{ coordinates: start, title: m == null ? 'Départ' : `Départ · ${formatAltitude(m)}`, kind: 'start' }] : []}
      .frame=${{ key: '3d:' + place.id, points, maxZoom: 17 }}
      @plant-select=${(/** @type {CustomEvent} */ e) => this.#pick(e.detail.entryId)}></gf-map>`;
  }

  /** @param {{ m: number | null }} card */
  #altitude(card) { return card.m == null ? 'Altitude inconnue' : `Altitude : ${formatAltitude(card.m)} (IGN)`; }

  /**
   * A plant touched: its name and altitude, in a small card over the map's top (the answer to a touch: its ✕ lets it
   * go), said by the map's one live region — not a live region of its own (the quiet-map rule, gf-map.js).
   * @param {string} entryId
   */
  #pick(entryId) {
    const place = this._place;
    const entry = place?.properties.plants.find((/** @type {any} */ e) => e.id === entryId);
    if (!entry) return;
    const m = altitudeOf(entry, entry.coordinates) ?? (entry.coordinates ? null : altitudeOf(place.properties, place.geometry?.coordinates));
    const card = this._card = { name: entry.vernacularName || entry.scientificName || 'Plante', sci: entry.scientificName || '', m };
    /** @type {any} */ (this.querySelector('gf-map'))?.announce?.(`${card.name} : ${this.#altitude(card)}`);
  }

  /**
   * @param {any} place @param {HTMLElement | null} opener
   * @returns {Promise<string | null>}
   */
  async show(place, opener) {
    // One view at a time: the one open goes first (its map removed).
    this._place = null;
    await this.updateComplete;
    this.#opener = opener;
    this._card = null;
    this._place = place;
    await this.updateComplete;
    openModal(this.#dialog);
    return null;
  }

  /** The dialog closed (✕, Échap, Back): the map goes (gf-map gives its WebGL context back), the focus back. */
  #closed() {
    this._place = null;
    this._card = null;
    const opener = this.#opener;
    this.#opener = null;
    if (opener?.isConnected) opener.focus();
  }
}

customElements.define('gf-map3d', GfMap3d);
