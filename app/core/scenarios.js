// @ts-check
// Scenarios: ways into the app, each one a simple story built from its tools (the film icon of the header). The
// first ones are mini-apps now (app/miniapps: Rencontres, Parcours botanique), each alone on the screen; the
// launcher (gf-scenarios) shows them first. Here, those still played in Découvrir itself (#/discover?s=…):
//  - Cueillette prudente: around, only the plants that matter for picking — the edible ones of the Anses and
//    Centres antipoison list and their toxic look-alikes, the deadly first; the harvest mode on.
//  - Mosaïque: the photos of the plants around, a large mosaic; a touch, the plant's images.
//  - Scientifique: the scientific mode, every tool.
// Découvrir without one (its tab, the first steps) is Rencontres' way: `scenarioOf` gives it for a key unknown.

import { href, parse } from './router.js';
import { setHarvestMode, setMode } from './store.js';
import { finishDiscover, resetChoices } from './discover.js';
import { openView } from './history.js';

/**
 * @typedef {{ key: string, title: string, pitch: string, icon: import('./icons.js').IconName, play: () => void, played?: () => boolean }} Scenario
 */

/** The scenario on screen (Découvrir with it): played again, it starts over; another one keeps the place chosen. @param {string} key */
const current = key => { const r = parse(location.hash); return r.name === 'discover' && r.scenario === key; };

/** @type {Scenario[]} */
export const SCENARIOS = [
  { key: 'harvest', title: 'Cueillette prudente', icon: 'leaf', pitch: 'Ce qui se cueille autour de vous… et ses sosies dangereux, les mortels d’abord. Le mode cueillette s’allume.',
    play: () => { if (current('harvest')) resetChoices(); setHarvestMode(true); openView(href.discover(null, 'harvest')); }, played: () => current('harvest') },
  { key: 'mosaic', title: 'Mosaïque', icon: 'images', pitch: 'Toutes les photos des plantes du coin, en grand. Une image touchée : toutes celles de la plante.',
    play: () => { if (current('mosaic')) resetChoices(); openView(href.discover(null, 'mosaic')); }, played: () => current('mosaic') },
  { key: 'science', title: 'Scientifique', icon: 'table', pitch: 'Toutes les données et tous les outils : la flore complète, les fiches en mode Scientifique.',
    play: () => { setMode('scientific'); finishDiscover(); openView(href.search()); } }
];

/** Découvrir's own way, with no scenario: Rencontres' (its cards, its guided first steps). */
const MEET = { key: 'meet', title: 'Rencontres' };

/** The scenario of Découvrir for a key (Rencontres' way for none, or one unknown). @param {string | null | undefined} key */
export const scenarioOf = key => SCENARIOS.find(s => s.key === key) || MEET;
