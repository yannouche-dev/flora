// @ts-check
// Hash router: deep links work on GitHub Pages without server rewrites.

/**
 * @typedef {{ name: 'search' } | { name: 'plant', id: number } | { name: 'settings' }
 *   | { name: 'map', spot: string | null, plant: number | null, season: boolean }
 *   | { name: 'spot-new', plant: number | null } | { name: 'spot', id: string }
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

  if (path === 'map') return { name: 'map', spot: params.get('spot'), plant: number('plant'), season: params.get('season') === '1' };
  if (path === 'spot/new') return { name: 'spot-new', plant: number('plant') };
  const spot = /^spot\/([\w-]+)$/.exec(path);
  if (spot) return { name: 'spot', id: spot[1] };

  if (path === 'settings') return { name: 'settings' };
  return { name: 'not-found' };
}

export const href = {
  search: () => '#/',
  plant: (/** @type {number} */ id) => '#/plant/' + id,
  settings: () => '#/settings',
  map: (/** @type {{ spot?: string, plant?: number, season?: boolean }} */ options = {}) => {
    const params = new URLSearchParams();
    if (options.spot) params.set('spot', options.spot);
    if (options.plant) params.set('plant', String(options.plant));
    if (options.season) params.set('season', '1');
    const search = params.toString();
    return '#/map' + (search ? '?' + search : '');
  },
  newSpot: (/** @type {number | null | undefined} */ plantId) => '#/spot/new' + (plantId ? '?plant=' + plantId : ''),
  spot: (/** @type {string} */ id) => '#/spot/' + id
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
