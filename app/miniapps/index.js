// @ts-check
// The mini-apps: what the launcher (gf-scenarios, the film icon) offers first, each opened alone on the screen at
// #/app/<id> (gf-miniapp). Its manifest (app/miniapps/<id>.js) is loaded when it opens. Every file is in sw.js's SHELL.

/**
 * @typedef {{ id: string, title: string, icon: import('../core/icons.js').IconName, pitch: string, scene: string,
 *   load: () => Promise<{ default: Readonly<import('../miniapp/define.js').Manifest> }> }} MiniAppEntry
 */

/** @type {MiniAppEntry[]} */
export const MINIAPPS = [
  { id: 'rencontres', title: 'Rencontres', icon: 'heart-fill', scene: 'meet',
    pitch: 'Les plantes observées autour de vous, une carte à la fois : à droite si elle vous plaît, à gauche sinon.',
    load: () => import('./rencontres.js') },
  { id: 'parcours', title: 'Parcours botanique', icon: 'geo-alt-fill', scene: 'trail',
    pitch: 'Marchez, nommez les plantes que vous croisez : chacune prend sa place sur la carte de votre parcours.',
    load: () => import('./parcours.js') }
];

/** A mini-app of the launcher, by id (null: none). @param {string} id */
export const miniApp = id => MINIAPPS.find(a => a.id === id) ?? null;
