// @ts-check
// Scenarios: ways into the app, each one a simple story built from its tools (the film icon of the header). Most are
// mini-apps now (app/miniapps: Rencontres, Parcours botanique, Cueillette prudente, Mosaïque), each alone on the
// screen; the list of the ways to play (gf-launcher: the Découvrir tab's page, the launcher's dialog) shows them
// first, then those here:
//  - Scientifique: the scientific mode, every tool.

import { href } from './router.js';
import { setMode } from './store.js';
import { finishDiscover } from './discover.js';
import { openView } from './history.js';

/**
 * @typedef {{ key: string, title: string, pitch: string, icon: import('./icons.js').IconName, scene?: string, play: () => void }} Scenario
 */

/** @type {Scenario[]} */
export const SCENARIOS = [
  { key: 'science', title: 'Scientifique', icon: 'table', pitch: 'Toutes les données et tous les outils : la flore complète, les fiches en mode Scientifique.',
    play: () => { setMode('scientific'); finishDiscover(); openView(href.search()); } }
];
