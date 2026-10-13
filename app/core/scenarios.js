// @ts-check
// Scenarios: ways into the app, each one a simple story built from its tools (the film icon of the header).
//  - Rencontres: the plants observed around, one card at a time, à la Tinder (Découvrir), then the app step by
//    step, with a fork: picking or science. « Rejouer » starts it all again.
//  - Cueillette prudente: around, only the plants that matter for picking — the edible ones of the Anses and
//    Centres antipoison list and their toxic look-alikes, the deadly first; the harvest mode on.
//  - Mosaïque: the photos of the plants around, a large mosaic; a touch, the plant's images.
//  - Parcours botanique: a walk, the plants met named, each where it was met (gf-trail).
//  - Scientifique: the scientific mode, every tool.

import { href, parse } from './router.js';
import { setHarvestMode, setMode } from './store.js';
import { discoverState, finishDiscover, resetChoices, restartDiscover } from './discover.js';
import { openView } from './history.js';

/**
 * @typedef {{ key: string, title: string, pitch: string, icon: import('./icons.js').IconName, play: () => void, played?: () => boolean }} Scenario
 */

/** The scenario on screen (Découvrir with it): played again, it starts over; another one keeps the place chosen. @param {string} key */
const current = key => { const r = parse(location.hash); return r.name === 'discover' && (r.scenario || 'meet') === key; };

/** @type {Scenario[]} */
export const SCENARIOS = [
  { key: 'meet', title: 'Rencontres', icon: 'heart-fill', pitch: 'Les plantes observées autour de vous, une carte à la fois : à droite si elle vous plaît, à gauche sinon.',
    // Played again: from the very start (place, distance, cards, matches, steps, fork, tabs).
    play: () => { restartDiscover(); openView(href.discover(null, 'meet')); }, played: () => { const s = discoverState(); return Boolean(s.point || s.matches.length || s.step); } },
  { key: 'harvest', title: 'Cueillette prudente', icon: 'leaf', pitch: 'Ce qui se cueille autour de vous… et ses sosies dangereux, les mortels d’abord. Le mode cueillette s’allume.',
    play: () => { if (current('harvest')) resetChoices(); setHarvestMode(true); openView(href.discover(null, 'harvest')); }, played: () => current('harvest') },
  { key: 'mosaic', title: 'Mosaïque', icon: 'images', pitch: 'Toutes les photos des plantes du coin, en grand. Une image touchée : toutes celles de la plante.',
    play: () => { if (current('mosaic')) resetChoices(); openView(href.discover(null, 'mosaic')); }, played: () => current('mosaic') },
  { key: 'trail', title: 'Parcours botanique', icon: 'geo-alt-fill', pitch: 'Marchez, nommez les plantes que vous croisez : chacune prend sa place sur la carte de votre parcours.',
    play: () => { openView(href.discover(null, 'trail')); }, played: () => current('trail') },
  { key: 'science', title: 'Scientifique', icon: 'table', pitch: 'Toutes les données et tous les outils : la flore complète, les fiches en mode Scientifique.',
    play: () => { setMode('scientific'); finishDiscover(); openView(href.search()); } }
];

/** The scenario of a key (Rencontres for none, or one unknown). @param {string | null | undefined} key */
export const scenarioOf = key => SCENARIOS.find(s => s.key === key) || SCENARIOS[0];
