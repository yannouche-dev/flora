// @ts-check
// Scenarios: ways into the app, each one a simple story built from its tools (the film icon of the header).
//  - Rencontres: the plants observed around, one card at a time, à la Tinder (Découvrir), then the app step by
//    step, with a fork: picking or science. « Rejouer » starts it all again.
//  - Cueillette prudente: around, only the plants that matter for picking — the edible ones of the Anses and
//    Centres antipoison list and their toxic look-alikes, the deadly first; the harvest mode on.
//  - Mosaïque: the photos of the plants around, a large mosaic; a touch, the plant's images.
//  - Scientifique: the scientific mode, every tool.
// Others are announced (« bientôt »).

import { href } from './router.js';
import { setHarvestMode, setMode } from './store.js';
import { discoverState, finishDiscover, resetChoices, restartDiscover } from './discover.js';

/**
 * @typedef {{ key: string, title: string, pitch: string, icon: import('./icons.js').IconName, play?: () => void, played?: () => boolean, soon?: boolean }} Scenario
 */

/** @type {Scenario[]} */
export const SCENARIOS = [
  { key: 'meet', title: 'Rencontres', icon: 'heart-fill', pitch: 'Les plantes observées autour de vous, une carte à la fois : à droite si elle vous plaît, à gauche sinon.',
    // Played again: from the very start (place, distance, cards, matches, steps, fork, tabs).
    play: () => { restartDiscover(); location.hash = href.discover(null, 'meet'); }, played: () => { const s = discoverState(); return Boolean(s.point || s.matches.length || s.step); } },
  { key: 'harvest', title: 'Cueillette prudente', icon: 'leaf', pitch: 'Ce qui se cueille autour de vous… et ses sosies dangereux, les mortels d’abord. Le mode cueillette s’allume.',
    play: () => { resetChoices(); setHarvestMode(true); location.hash = href.discover(null, 'harvest'); }, played: () => Boolean(discoverState().point) },
  { key: 'mosaic', title: 'Mosaïque', icon: 'images', pitch: 'Toutes les photos des plantes du coin, en grand. Une image touchée : toutes celles de la plante.',
    play: () => { resetChoices(); location.hash = href.discover(null, 'mosaic'); }, played: () => Boolean(discoverState().point) },
  { key: 'science', title: 'Scientifique', icon: 'table', pitch: 'Toutes les données et tous les outils : la flore complète, les fiches en mode Scientifique.',
    play: () => { setMode('scientific'); finishDiscover(); location.hash = href.search(); } },
  { key: 'map', title: 'La carte d’abord', icon: 'map', pitch: 'La carte au centre, la flore et la fiche en panneaux autour.', soon: true },
  { key: 'dashboard', title: 'Tableau de bord scientifique', icon: 'diagram-3', pitch: 'Répartition, phénologie, statuts et niche climatique d’un coup d’œil.', soon: true }
];

/** @param {string | null | undefined} key */
export const scenarioOf = key => SCENARIOS.find(s => s.key === key && !s.soon) || SCENARIOS[0];
