// @ts-check
// The components a mini-app's steps put on its screen (`use` in a manifest), as render functions, not elements:
// each one renders the app's own elements from the context. The contract:
//  - render(c, app, place) reads only `c` (the context and what is derived), and app.view (the display mode of a
//    plant sheet, kept by the box in step with the app's);
//  - it writes only through app.set, app.do or app.go: it never navigates, and listens to nothing global;
//  - `reads`: the context keys it reads, declared (checked against the manifest as it loads: define.js#unread);
//  - `heavy`: a map in it (a separator beside it moves a guide line, not the map, until released);
//  - `empty(c)`: nothing to show yet (a phone keeps such a sheet closed); `clear`: the patch that empties it.
// The apps ported whole (Rencontres, Parcours) are one component each: their element draws every screen and says
// which step it is on (the event ma-step, which the box follows).

import { html } from 'lit';
import '../components/gf-discover.js';
import '../components/gf-trail.js';

/**
 * @typedef {import('./define.js').Place} Place
 * @typedef {{ reads: string[], heavy?: boolean, empty?: (c: any) => boolean, clear?: Record<string, unknown>,
 *   render: (c: any, app: import('./runtime.js').MiniApp, place: Place) => unknown }} Component
 */

/**
 * Rencontres: the plants observed around, one card at a time (gf-discover, as Découvrir shows it), in the box. The
 * plant open over it is c.focus (the address's ?p=). @type {Component}
 */
const meet = {
  reads: ['focus'],
  heavy: true,
  render: (c, app) => html`<gf-discover scenario="meet" boxed=${app.m.id} .open=${c.focus ?? null}></gf-discover>`
};

/** Parcours botanique: the walk, its plants and their map, its recap (gf-trail), in the box. @type {Component} */
const trail = {
  reads: [],
  heavy: true,
  render: () => html`<gf-trail></gf-trail>`
};

/** The components, by their `use` name. @type {Record<string, Component>} */
export const kit = { meet, trail };
