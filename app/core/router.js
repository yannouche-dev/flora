// @ts-check
// Hash router: deep links work on GitHub Pages without server rewrites.

/**
 * @typedef {{ name: 'search' } | { name: 'plant', id: number } | { name: 'settings' } | { name: 'not-found' }} Route
 */

/** @param {string} hash @returns {Route} */
export function parse(hash) {
  const path = hash.replace(/^#\/?/, '').split('?')[0];
  if (path === '') return { name: 'search' };

  const plant = /^plant\/(\d+)$/.exec(path);
  if (plant) return { name: 'plant', id: Number(plant[1]) };

  if (path === 'settings') return { name: 'settings' };
  return { name: 'not-found' };
}

export const href = {
  search: () => '#/',
  plant: (/** @type {number} */ id) => '#/plant/' + id,
  settings: () => '#/settings'
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
