// @ts-check
// Rencontres: the plants observed around you, one card at a time — right if it pleases you, left if not. Its start
// (« Autour de moi », a commune, « Continuer » at the place kept), how far to look over the map, then the cards, the
// matches and all of them. One plant on the screen, the plant chosen (?p=): the map, its photos and its sheet show
// it (kit/around.js#chosenContext), the address says the whole screen (router.js). A game begun during the first steps
// of the app plays its guided way: the map, the cards and the plant's panes in one layout transformed step by step,
// under a steps bar of its own (ownBar) — decided as the game begins, kept until its steps end (« La flore complète »,
// or the first steps ended elsewhere) or « Recommencer » (kit/around.js#guidedWay).
// Built from the kit (app/miniapp/kit): ma-guided in its guided way, else ma-distance then ma-around-list.
// Owns — everything « Recommencer » empties, here and in the other tabs, as if never opened:
//  - geoflora.app.rencontres.state: its place and name, distance, cards swiped right (this game's matches) and left,
//    the step it was left at, the plant chosen, the photos its first match brought (the pane closed: kit/around.js),
//    its way (guided or not), the plant's panes its guided steps built and the blocks they left out, a module off
//    (kit/around.js#guidedContext), the steps bar as its ⋯ chose it;
//    geoflora.app.rencontres.layout: its columns' widths (runtime.js#replay); geoflora.app.rencontres.media: the
//    width of the photos' pane; geoflora.app.rencontres.sheet: the width of a plant's sheet beside the cards;
//  - geoflora.discoverLayout: the widths of the map and the cards of its guided way;
//  - in geoflora.discover, its guided way: the step reached, the fork (cueillette or science), the first match
//    celebrated (core/discover.js#replayMeet);
//  - in memory: the cards found, the observations, what Wikipédia says, the undo stack, the deck's order, the view
//    chosen, the swipe hint shown (kit/session.js: a new session, forgetGame).
//  - in Mes plantes, the favourites its matches added (their origin, core/collections.js#forgetMadeBy) — not one
//    that was a favourite before the match, nor one set elsewhere, nor one the user then made their own (filed in a
//    list or noted in a lieu, annotated, rated or given a harvest in the favourites, given a note on its sheet, in the
//    favourites shared or exported alone, kept by « Revoir les premiers pas »: place-model.js#promoted).
// Shares (never cleared, the user's whole app): Mes plantes but for those favourites, the places, the first
// steps of the app (the tabs that came, the plants seen; « La flore complète » ends them, as it says), the settings
// and the plant sheets' layouts (read, never written: its panes are its own, and the mode changes only by a button
// that says so, at the end of its guided way), the answers of the online services kept in cache.

import { config } from '../config.js';
import { forgetMadeBy } from '../core/collections.js';
import { replayMeet } from '../core/discover.js';
import { defineMiniApp } from '../miniapp/define.js';
import { forgetGame } from '../miniapp/kit/session.js';
import { aroundColumns, aroundContext, aroundSteps, chosenContext, guidedContext, guidedWay, locate } from '../miniapp/kit/around.js';

export default defineMiniApp({
  id: 'rencontres',
  title: 'Rencontres',
  icon: 'heart-fill',
  scene: 'meet',
  pitch: 'Les plantes observées autour de vous, une carte à la fois : à droite si elle vous plaît, à gauche sinon.',
  uses: ['inaturalist'],
  exit: { label: 'Quitter l’activité' },
  owns: { keys: [config.storageKeys.discoverLayout, 'geoflora.app.rencontres.media', 'geoflora.app.rencontres.sheet'], reset: () => { replayMeet(); forgetGame('rencontres'); return forgetMadeBy('rencontres'); },
    label: 'la partie en cours' },
  shared: ['Mes plantes (sauf les favoris ajoutés par ses matchs)', 'lieux', 'premiers pas de l’application', 'réglages'],
  // One plant on the screen, the plant chosen (?p=): the map, the photos its first match brought and the sheet show it
  // (kit/around.js#chosenContext); its way, and the panes of its guided way (guidedContext).
  context: { ...aroundContext(), ...chosenContext(), ...guidedContext() },
  actions: { locate },
  ownBar: (c, app) => guidedWay(c) && app.step.id !== 'start',
  ...aroundColumns('Rencontres'),
  // Its guided way covers both steps (map, cards, photos: kit/ma-guided.js); else the map then the cards beside it,
  // as the others.
  steps: aroundSteps('meet', {
    map: [{ id: 'meet', use: 'meet', col: 'map', title: 'Carte' }],
    cards: [{ id: 'list', use: 'aroundList', col: 'cards', title: 'Rencontres', props: { media: true }, when: c => !guidedWay(c) }]
  })
});
