// @ts-check
// Hash router: deep links work on GitHub Pages without server rewrites.
// history.js first: it marks each new entry with its depth before the app routes.
import './history.js';

/**
 * @typedef {{ name: 'search' } | { name: 'plant', id: number, pane: string | null, at: number | null } | { name: 'settings' } | { name: 'legal' } | { name: 'collections', open: string | null, plant: number | null }
 *   | { name: 'map', spot: string | null, plant: number | null, focus: string | null, season: boolean, add: number | null, pick: boolean, flore: boolean }
 *   | { name: 'spot-new', plant: number | null, kind: 'list' | 'place', at: [number, number] | null }
 *   | { name: 'spot', id: string, add: number | null, pick: boolean }
 *   | { name: 'shared', data: string } | { name: 'discover' }
 *   | { name: 'app', id: string, step: string | null, plant: number | null }
 *   | { name: 'not-found' }} Route
 */

/** @param {string} hash @returns {Route} */
/** A plant of a place in an address: an occurrence id, or a plant id (older links). @param {string | null} v */
const focusParam = v => v && /^[\w-]{1,48}$/.test(v) ? v : null;

export function parse(hash) {
  const [path, search = ''] = hash.replace(/^#\/?/, '').split('?');
  const params = new URLSearchParams(search);
  const number = (/** @type {string} */ key) => /^\d+$/.test(params.get(key) || '') ? Number(params.get(key)) : null;

  if (path === '') return { name: 'search' };

  const plant = /^plant\/(\d+)$/.exec(path);
  // ?pane=<block>: a block of the sheet in a pane beside it (&i=n: the media viewer's n-th image); ?media=n: earlier links.
  if (plant) {
    const pane = params.get('pane') || (params.has('media') ? 'media' : null);
    return { name: 'plant', id: Number(plant[1]), pane: pane && /^[\w:-]{1,40}$/.test(pane) ? pane : null, at: number('i') ?? number('media') };
  }

  if (path === 'map') {
    return {
      name: 'map', spot: params.get('spot'), plant: number('plant'), focus: focusParam(params.get('focus')), season: params.get('season') === '1',
      add: number('add'), pick: params.get('pick') === '1', flore: params.get('from') === 'flore'
    };
  }
  if (path === 'collections') return { name: 'collections', open: params.get('c'), plant: number('plant') };
  // "spot/…" are the links of earlier versions; collections are the same records.
  if (path === 'collection/new' || path === 'spot/new') {
    const at = (params.get('at') || '').split(',').map(Number);
    return {
      name: 'spot-new', plant: number('plant'), kind: params.get('kind') === 'list' ? 'list' : 'place',
      at: at.length === 2 && at.every(Number.isFinite) ? /** @type {[number, number]} */ ([at[1], at[0]]) : null
    };
  }
  const spot = /^(?:collection|spot)\/([\w-]+)$/.exec(path);
  if (spot) return { name: 'spot', id: spot[1], add: number('add'), pick: params.get('pick') === '1' };
  if (path === 'shared') return { name: 'shared', data: params.get('d') || '' };

  if (path === 'settings') return { name: 'settings' };
  if (path === 'legal') return { name: 'legal' };
  // A mini-app (app/miniapps), alone on the screen: #/app/<id>[/<step>][?p=<plant>].
  const app = /^app\/([a-z][a-z0-9-]{1,23})(?:\/([a-z][a-z0-9-]{1,23}))?$/.exec(path);
  if (app) return { name: 'app', id: app[1], step: app[2] ?? null, plant: number('p') };
  // Rencontres, the Parcours, Cueillette prudente and Mosaïque, scenarios of Découvrir before they were mini-apps: their
  // old addresses open them (a plant open over Découvrir with no scenario, #/discover?p=<id>, was over Rencontres'
  // cards); a plant open there, over its cards.
  const was = path === 'discover' ? { meet: 'rencontres', trail: 'parcours', harvest: 'cueillette', mosaic: 'mosaique' }[params.get('s') || (params.has('p') ? 'meet' : '')] : undefined;
  if (was) return { name: 'app', id: was, step: was !== 'parcours' && params.has('p') ? 'cards' : null, plant: number('p') };
  // « Découvrir »: the list of the ways to play (any other scenario: the list too).
  if (path === 'discover') return { name: 'discover' };
  return { name: 'not-found' };
}

export const href = {
  search: () => '#/',
  /** Flore filtered on the plants of a collection or place (the « Mes plantes » facet). */
  inFlore: (/** @type {string} */ id) => '#/?mine=' + encodeURIComponent(id),
  plant: (/** @type {number} */ id) => '#/plant/' + id,
  /** A block of the plant's sheet in a pane beside it (`at`: the media viewer's n-th image). */
  plantPane: (/** @type {number} */ id, /** @type {string} */ pane, /** @type {number | null} */ at = null) =>
    '#/plant/' + id + '?pane=' + encodeURIComponent(pane) + (at != null ? '&i=' + at : ''),
  settings: () => '#/settings',
  /** Mentions légales et confidentialité (from Réglages). */
  legal: () => '#/legal',
  /** « Découvrir »: the list of the ways to play. */
  discover: () => '#/discover',
  /** Mes plantes; `open`: the collection shown (a place: its map too), `plant`: the plant sheet beside. */
  collections: (/** @type {{ open?: string | null, plant?: number | null }} */ options = {}) => {
    const params = new URLSearchParams();
    if (options.open) params.set('c', options.open);
    if (options.plant) params.set('plant', String(options.plant));
    const search = params.toString();
    return '#/collections' + (search ? '?' + search : '');
  },
  /**
   * `focus`: a plant of the selected place (its marker highlighted, its details open); `add` pre-adds a plant
   * to the selected place, `pick` opens its plant picker.
   */
  map: (/** @type {{ spot?: string, plant?: number, focus?: string | number, season?: boolean, add?: number, pick?: boolean, flore?: boolean }} */ options = {}) => {
    const params = new URLSearchParams();
    if (options.spot) params.set('spot', options.spot);
    if (options.spot && options.add) params.set('add', String(options.add));
    if (options.spot && options.pick) params.set('pick', '1');
    if (options.focus) params.set('focus', String(options.focus));
    if (options.plant) params.set('plant', String(options.plant));
    if (options.season) params.set('season', '1');
    // The places holding plants of the current Flore search.
    if (options.flore) params.set('from', 'flore');
    const search = params.toString();
    return '#/map' + (search ? '?' + search : '');
  },
  /**
   * New place (GPS, or `at` [lon, lat] picked on the map), optionally with a first plant.
   * @param {number | null} [plantId] @param {[number, number] | null} [at]
   */
  newSpot: (plantId, at) =>
    '#/collection/new?kind=place' + (plantId ? '&plant=' + plantId : '') + (at ? `&at=${at[1].toFixed(6)},${at[0].toFixed(6)}` : ''),
  /** New list, optionally with a first plant. @param {number | null} [plantId] */
  newList: plantId => '#/collection/new?kind=list' + (plantId ? '&plant=' + plantId : ''),
  /** A collection; `add` pre-adds a plant to it, `pick` opens the plant picker. @param {string} id @param {number | null} [add] @param {boolean} [pick] */
  spot: (id, add, pick = false) =>
    '#/collection/' + id + (add ? '?add=' + add : pick ? '?pick=1' : ''),
  shared: (/** @type {string} */ data) => '#/shared?d=' + data,
  /** A mini-app, at a step (none: its start), a plant open in it. @param {string} id @param {string | null} [step] @param {number | null} [plant] */
  app: (id, step = null, plant = null) => '#/app/' + id + (step ? '/' + step : '') + (plant ? '?p=' + plant : '')
};

/** Lit ReactiveController exposing the current route and re-rendering on navigation. */
export class RouterController {
  /** @param {import('lit').ReactiveControllerHost} host */
  constructor(host) {
    this.host = host;
    /** @type {Route} */
    this.route = parse(location.hash);
    this.onHashChange = () => {
      this.route = parse(location.hash);
      host.requestUpdate();
    };
    host.addController(this);
  }

  hostConnected() { addEventListener('hashchange', this.onHashChange); }
  hostDisconnected() { removeEventListener('hashchange', this.onHashChange); }
}
