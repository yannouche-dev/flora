// @ts-check
// Hash router: deep links work on GitHub Pages without server rewrites.

/**
 * @typedef {{ name: 'search' } | { name: 'plant', id: number } | { name: 'settings' } | { name: 'collections' }
 *   | { name: 'map', spot: string | null, plant: number | null, focus: number | null, season: boolean }
 *   | { name: 'spot-new', plant: number | null, kind: 'list' | 'place' }
 *   | { name: 'spot', id: string, add: number | null, pick: boolean }
 *   | { name: 'shared', data: string }
 *   | { name: 'not-found' }} Route
 */

/** @param {string} hash @returns {Route} */
export function parse(hash) {
  const [path, search = ''] = hash.replace(/^#\/?/, '').split('?');
  const params = new URLSearchParams(search);
  const number = (/** @type {string} */ key) => /^\d+$/.test(params.get(key) || '') ? Number(params.get(key)) : null;

  if (path === '') return { name: 'search' };

  const plant = /^plant\/(\d+)$/.exec(path);
  if (plant) return { name: 'plant', id: Number(plant[1]) };

  if (path === 'map') return { name: 'map', spot: params.get('spot'), plant: number('plant'), focus: number('focus'), season: params.get('season') === '1' };
  if (path === 'collections') return { name: 'collections' };
  // "spot/…" are the links of earlier versions; collections are the same records.
  if (path === 'collection/new' || path === 'spot/new') {
    return { name: 'spot-new', plant: number('plant'), kind: params.get('kind') === 'list' ? 'list' : 'place' };
  }
  const spot = /^(?:collection|spot)\/([\w-]+)$/.exec(path);
  if (spot) return { name: 'spot', id: spot[1], add: number('add'), pick: params.get('pick') === '1' };
  if (path === 'shared') return { name: 'shared', data: params.get('d') || '' };

  if (path === 'settings') return { name: 'settings' };
  return { name: 'not-found' };
}

export const href = {
  search: () => '#/',
  plant: (/** @type {number} */ id) => '#/plant/' + id,
  settings: () => '#/settings',
  collections: () => '#/collections',
  /** `focus`: a plant of the selected place (its marker highlighted, listed first). */
  map: (/** @type {{ spot?: string, plant?: number, focus?: number, season?: boolean }} */ options = {}) => {
    const params = new URLSearchParams();
    if (options.spot) params.set('spot', options.spot);
    if (options.focus) params.set('focus', String(options.focus));
    if (options.plant) params.set('plant', String(options.plant));
    if (options.season) params.set('season', '1');
    const search = params.toString();
    return '#/map' + (search ? '?' + search : '');
  },
  /** New place (GPS), optionally with a first plant. */
  newSpot: (/** @type {number | null | undefined} */ plantId) => '#/collection/new?kind=place' + (plantId ? '&plant=' + plantId : ''),
  /** New list, optionally with a first plant. */
  newList: (/** @type {number | null | undefined} */ plantId) => '#/collection/new?kind=list' + (plantId ? '&plant=' + plantId : ''),
  /** A collection; `add` pre-adds a plant to it, `pick` opens the plant picker. */
  spot: (/** @type {string} */ id, /** @type {number | null | undefined} */ add, /** @type {boolean} */ pick = false) =>
    '#/collection/' + id + (add ? '?add=' + add : pick ? '?pick=1' : ''),
  shared: (/** @type {string} */ data) => '#/shared?d=' + data
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
