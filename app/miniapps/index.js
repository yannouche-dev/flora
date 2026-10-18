// @ts-check
// The mini-apps: what the list of the ways to play offers first (gf-launcher: the Découvrir tab, and the launcher's
// dialog behind the film icon), each opened alone on the screen at #/app/<id> (gf-miniapp). Its manifest
// (app/miniapps/<id>.js) is loaded when it opens. Every file is in sw.js's SHELL.
// `underWay`: a game under way, kept on this device (the list offers « Continuer » and « Recommencer »); `play`: what
// launching it changes in the app (Cueillette prudente: the harvest mode on).

import { aroundUnderWay } from '../core/around-sessions.js';
import { setHarvestMode } from '../core/store.js';
import { keptGame, underWay } from '../miniapp/kit/faux-amis.js';
import { walkUnderWay } from '../miniapp/kit/trail-store.js';

/**
 * @typedef {{ id: string, title: string, icon: import('../core/icons.js').IconName, pitch: string, scene: string, underWay: () => boolean,
 *   play?: () => void, load: () => Promise<{ default: Readonly<import('../miniapp/define.js').Manifest> }> }} MiniAppEntry
 */

/** @type {MiniAppEntry[]} */
export const MINIAPPS = [
  { id: 'rencontres', title: 'Rencontres', icon: 'heart-fill', scene: 'meet',
    pitch: 'Les plantes observées autour de vous, une carte à la fois : à droite si elle vous plaît, à gauche sinon.',
    underWay: () => aroundUnderWay('rencontres'),
    load: () => import('./rencontres.js') },
  { id: 'parcours', title: 'Parcours botanique', icon: 'geo-alt-fill', scene: 'trail',
    pitch: 'Marchez, nommez les plantes que vous croisez : chacune prend sa place sur la carte de votre parcours.',
    underWay: walkUnderWay,
    load: () => import('./parcours.js') },
  { id: 'cueillette', title: 'Cueillette prudente', icon: 'leaf', scene: 'harvest',
    pitch: 'Ce qui se cueille autour de vous… et ses sosies dangereux, les mortels d’abord. Le mode cueillette s’allume.',
    underWay: () => aroundUnderWay('cueillette'),
    play: () => setHarvestMode(true),
    load: () => import('./cueillette.js') },
  { id: 'mosaique', title: 'Mosaïque', icon: 'images', scene: 'mosaic',
    pitch: 'Toutes les photos des plantes du coin, en grand. Une image touchée : toutes celles de la plante.',
    underWay: () => aroundUnderWay('mosaique'),
    load: () => import('./mosaique.js') },
  { id: 'faux-amis', title: 'Faux amis', icon: 'lightbulb', scene: 'twins',
    pitch: 'Six paires de plantes qu’on confond : à qui est chaque indice ? Sans indice sûr, on ne cueille pas.',
    underWay: () => underWay(keptGame()),
    load: () => import('./faux-amis.js') }
];

/** A mini-app of the launcher, by id (null: none). @param {string} id */
export const miniApp = id => MINIAPPS.find(a => a.id === id) ?? null;
