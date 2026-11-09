// @ts-check
// What the cells of a screen of one's own share (« Écran sur mesure »: cells.js, what each cell shows): the layout's
// state watched (StateController: the cell drawn again on each change), a cell's own settings kept in the layout
// (setCell: `cell-param`), « Autour de moi » (locateOnce) and the place found there (nameScope), and the scope — in
// words (scopeWords: in a cell's head too, gf-layout.js; scopeNote, periodWords), its line and its radius' slider
// (where, radiusSlider, scopeStyles: the map's zone panel, the place cell).

import { html, css, nothing } from 'lit';
import { icon } from '../core/icons.js';
import { FIX_MAX_AGE, geoProblem, takeFix } from '../core/geo.js';
import { addressAt } from '../core/geoservices.js';
import { distanceAt, distanceEvents } from '../miniapp/kit/cards.js';
import { STOPS } from '../core/distance.js';
import { distanceLabel } from './registry.js';
import { SOURCE_NAMES, sampleWords, sourcesText } from '../core/observations.js';

/** @typedef {import('./state.js').LayoutState} LayoutState */

/**
 * « Autour de moi »: the position, once (a fix older than a minute is not taken: geo.js FIX_MAX_AGE). Rejects with the
 * reason, in French.
 * @returns {Promise<[number, number]>}
 */
export function locateOnce() {
  return new Promise((resolve, reject) => {
    takeFix({ maxAge: FIX_MAX_AGE }, r => {
      if (!r) return; // never: no timeout, no signal
      if ('error' in r) reject(new Error(geoProblem(r.code, { place: true }).text));
      else resolve(r.coordinates);
    });
  });
}

/** The scope's place, once found (IGN): written in the state without a new entry. @param {LayoutState} state @param {[number, number]} at */
export async function nameScope(state, at) {
  const a = await addressAt(at).catch(() => null);
  if (a?.city && state.live.at === at) state.set({ place: a.city }, 'replace');
}

/**
 * Settings of the cell an element is in, changed by its own controls: kept in the layout (gf-layout.js, `cell-param`).
 * @param {Element} el @param {Record<string, unknown>} values
 */
export const setCell = (el, values) => el.dispatchEvent(new CustomEvent('cell-param', { detail: values, bubbles: true, composed: true }));

/** Watches the state: the host drawn again on each change — and on its other events it names, as it says (`hover`). */
export class StateController {
  /**
   * @param {import('lit').LitElement & { state: LayoutState | null }} host
   * @param {Record<string, (e: Event) => void>} [also] other events of the state, and what each does
   */
  constructor(host, also = {}) {
    this.host = host;
    /** @type {LayoutState | null} */ this.watched = null;
    /** @type {[string, (e: Event) => void][]} */
    this.handlers = [['change', () => host.requestUpdate()], ...Object.entries(also)];
    host.addController(this);
  }

  /** @param {LayoutState | null} state */
  watch(state) {
    for (const [type, fn] of this.handlers) this.watched?.removeEventListener(type, fn);
    this.watched = state;
    for (const [type, fn] of this.handlers) state?.addEventListener(type, fn);
  }

  hostUpdate() { if (this.host.state !== this.watched) this.watch(this.host.state); }
  hostDisconnected() { this.watch(null); }
  hostConnected() { if (this.host.state) this.watch(this.host.state); }
}

/**
 * The scope in words: « 2 km autour de Paris », « Toute la France » — for what shows a zone (a map of the zone, a zone
 * cell: `zone`), « Sans zone : choisissez un lieu »; a place of the address still to find (place= without at=,
 * state.js): « Recherche du lieu : … », or why it was not found (« Lieu introuvable : … »).
 * @param {LayoutState} state @param {{ zone?: boolean }} [o]
 */
export function scopeWords(state, { zone = false } = {}) {
  const { at, place } = state.live;
  if (!at && place && state.placeState === 'finding') return `Recherche du lieu : ${place}…`;
  if (!at && place && state.placeError) return state.placeError;
  return at ? `${distanceLabel(state.radius)} autour ${place ? 'de ' + place : 'du point choisi'}` : zone ? NO_ZONE : 'Toute la France';
}

/** What a map of the zone or a zone cell says without one. */
const NO_ZONE = 'Sans zone : choisissez un lieu';

/** The layout's period (state.js) in words, after « dans la zone »: the plants of the zone that year, that month. @param {LayoutState} state */
export const periodWords = state => state.periode === 'annee' ? ' cette année' : state.periode === 'mois' ? ' ce mois-ci' : '';

/**
 * What the scope says of the plants: their count, coming, or why it does not filter — and, a source of the zone having
 * more observations than were loaded (state.js sample), which ones (core/observations.js sampleWords: iNaturalist's
 * most recent, a page of GBIF's). @param {LayoutState} state
 */
export function scopeNote(state) {
  if (!state.live.at) return '';
  if (state.speciesState === 'loading') return 'Observations de la zone : recherche…';
  if (state.speciesState === 'error') return state.speciesError ?? '';
  const n = state.species?.list.length ?? 0;
  const when = periodWords(state);
  // The plants of the zone's latest observations (the map's: state.js), as the flora knows them — and from where.
  const from = sourcesText(state.filters.sources.filter(x => !state.failed.some(f => f.name === SOURCE_NAMES[x])));
  const part = sampleWords(state.sample);
  const most = part ? ' — ' + part : '';
  return n ? `${n.toLocaleString('fr-FR')} plante${n > 1 ? 's' : ''} dans les observations de la zone${when} (${from})${most}` : `Aucune plante de la flore dans les observations de la zone${when} (${from}).`;
}

/** Shared by the scope's controls (map, place): the radius slider, « Autour de moi », the place's name. */
export const scopeStyles = css`
  .radius { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 0.85rem; }
  .radius input { flex: 1; min-width: 0; margin: 0; accent-color: var(--gf-accent); }
  .radius b { flex: none; min-width: 48px; font-variant-numeric: tabular-nums; color: var(--gf-accent); }
  .note { margin: 0; font-size: 0.78rem; color: var(--gf-text-muted); }
  .note.error { color: var(--gf-danger); }
  .where { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 0.85rem; font-weight: 600; }
  .where span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .where .icon-btn { width: 32px; height: 32px; font-size: 1rem; flex: none; }
  .where.error { color: var(--gf-danger); }
`;

/**
 * The scope's line (map, place): its words — in the danger's colour, and read at once, when a place of the address
 * was not found — and ✕: no scope (nor a place to find).
 * @param {LayoutState} s
 */
export const where = s => {
  const failed = Boolean(s.placeError && !s.live.at);
  const words = scopeWords(s, { zone: true });
  return html`<div class="where ${failed ? 'error' : ''}" data-place-state=${s.placeState}>${icon(failed ? 'exclamation-triangle-fill' : 'crosshair')}<span role=${failed ? 'alert' : nothing} title=${words}>${words}</span>
    ${s.live.at || s.live.place ? html`<button class="icon-btn" type="button" title="Toute la France (sans zone)" aria-label="Toute la France (sans zone)" @click=${() => s.setScope(null)}>${icon('x-lg')}</button>` : nothing}</div>`;
};

/**
 * The radius' slider (map, place): Rencontres' stops (kit/cards.js), the radius shown where it is — one the address
 * gives between two stops (r=3km) sits between them, never on a stop it is not; moved, it goes from stop to stop.
 * @param {LayoutState} state
 */
export const radiusSlider = state => {
  const on = distanceEvents(() => state.radius, m => state.set({ r: m }, 'replace'));
  return html`<label class="radius"><span class="visually-hidden">Rayon de la zone</span>
    <input type="range" min="0" max=${STOPS.length - 1} step="any" .value=${String(distanceAt(state.radius))} aria-label="Rayon de la zone"
      aria-valuetext=${distanceLabel(state.radius)} @input=${on.input} @keydown=${on.keydown} />
    <b>${distanceLabel(state.radius)}</b></label>`;
};
