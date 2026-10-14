// @ts-check
// The components a mini-app's steps put on its screen (`use` in a manifest), as render functions, not elements:
// each one renders the app's own elements from the context. The contract:
//  - render(c, app, place) reads only `c` (the context and what is derived), and app.view (the display mode of a
//    plant sheet, kept by the box in step with the app's);
//  - it writes only through app.set, app.do or app.go: it never navigates, and listens to nothing global;
//  - `reads`: the context keys it reads, declared (checked against the manifest as it loads: define.js#unread);
//  - `heavy`: a map in it (a separator beside it moves a guide line, not the map, until released);
//  - `empty(c)`: nothing to show yet (a phone keeps such a sheet closed); `clear`: the patch that empties it.
// The mini-apps around a place (Rencontres, Cueillette prudente, Mosaïque) compose the kit of app/miniapp/kit/: the
// distance over the map (ma-distance), the list of the plants around (ma-around-list: the deck ma-deck, the matches,
// the grid or mosaic, the plant's sheet ma-plant-sheet, the first match), and Rencontres' guided way during the
// first steps (ma-guided: the map ma-around-map, the deck, the plant's panes, its own steps bar). The Parcours
// composes its own (app/miniapp/kit/: its game trail-session.js, its start screen trail-start.js): the walk (ma-walk:
// its card, its plants, its search, its map) and the recap (ma-trail-recap).

import { html } from 'lit';
import { discovering } from '../core/discover.js';
import './kit/ma-distance.js';
import './kit/ma-around-list.js';
import './kit/ma-guided.js';
import './kit/ma-walk.js';
import './kit/ma-trail-recap.js';

/**
 * @typedef {import('./define.js').Place} Place
 * @typedef {{ reads: string[], heavy?: boolean, empty?: (c: any) => boolean, clear?: Record<string, unknown>,
 *   render: (c: any, app: import('./runtime.js').MiniApp, place: Place) => unknown }} Component
 */

/** What the plants-around components read of the context. */
const AROUND = ['point', 'place', 'radius', 'matches', 'passed', 'focus', 'view', 'mediaAt'];

/**
 * How far to look, over the map of the observations in the circle (step « map »). props.view: the list's own view,
 * back to it as the cards come. @type {Component}
 */
const distance = {
  reads: AROUND,
  heavy: true,
  render: (c, app, p) => html`<ma-distance .app=${app} .c=${c} .view=${p.props?.view ?? 'swipe'}></ma-distance>`
};

/**
 * The plants around, a page of cards (step « cards »). props: harvest (Cueillette prudente's cards and warnings),
 * mosaic (« Toutes » as a mosaic), heading (its name before « Autour de … »), view (the one it opens on), media (Rencontres:
 * the photos of the first match beside the deck — the context's `media`). @type {Component}
 */
const aroundList = {
  reads: AROUND,
  render: (c, app, p) => html`<ma-around-list .app=${app} .c=${c} ?harvest=${Boolean(p.props?.harvest)} ?mosaic=${Boolean(p.props?.mosaic)}
    .heading=${p.props?.heading ?? null} .view=${p.props?.view ?? 'swipe'} ?media=${Boolean(p.props?.media)}></ma-around-list>`
};

/**
 * Rencontres' map: during the first steps, its guided way (map, cards and the plant's panes, one layout across the
 * steps « map » and « cards »); after them, the map and its distance, the list then beside it, as the others.
 * @type {Component}
 */
const meet = {
  reads: [...AROUND, 'media', 'sheet'],
  heavy: true,
  render: (c, app, p) => discovering() ? html`<ma-guided .app=${app} .c=${c}></ma-guided>` : distance.render(c, app, p)
};

/** The Parcours, walking: its card, its plants, its search under the thumb, its map (step « walk »). @type {Component} */
const walk = {
  reads: [],
  heavy: true,
  render: (c, app) => html`<ma-walk .app=${app}></ma-walk>`
};

/** The Parcours' recap: its map (« Vue 3D »), its plants, its profile, « Partager » (step « done »). @type {Component} */
const recap = {
  reads: [],
  heavy: true,
  render: (c, app) => html`<ma-trail-recap .app=${app}></ma-trail-recap>`
};

/** The components, by their `use` name. @type {Record<string, Component>} */
export const kit = { distance, aroundList, meet, walk, recap };
