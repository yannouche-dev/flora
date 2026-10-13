// @ts-check
// Rencontres: the plants observed around you, one card at a time — right if it pleases you, left if not. Its start
// (« Autour de moi », a commune, « Reprendre » the place kept), how far to look over the map, then the cards, the
// matches and all of them; the plant open over them at ?p=. During the first steps of the app, its guided way: the
// map, the cards and the plant's panes in one layout transformed step by step, under a steps bar of its own (ownBar).
// Built from the kit (app/miniapp/kit): ma-guided during the first steps, else ma-distance then ma-around-list.
// Owns — everything « Rejouer » / « Recommencer » empties, here and in the other tabs, as if never opened:
//  - geoflora.app.rencontres.state: its place and name, distance, cards swiped right (this game's matches) and left,
//    the step it was left at, the photos its first match brought (the plant, the pane closed: kit/ma-around-list.js);
//    geoflora.app.rencontres.layout: its columns' widths (runtime.js#replay); geoflora.app.rencontres.media: the
//    width of the photos' pane; geoflora.app.rencontres.sheet: the width of a plant's sheet beside the cards;
//  - geoflora.discoverLayout: the widths of the map and the cards of its guided way;
//  - in geoflora.discover, its guided way: the step reached, the fork (cueillette or science), the first match
//    celebrated (core/discover.js#replayMeet);
//  - in memory: the cards found, the observations, what Wikipédia says, the undo stack, the deck's order, the view
//    chosen, the swipe hint shown (kit/session.js: a new session, forgetGame).
//  - in Mes plantes, the favourites its matches added (their origin, core/collections.js#forgetMadeBy) — not one
//    that was a favourite before the match, nor one set elsewhere, nor one the user then put in a collection or
//    gave a note (made their own: place-model.js#promoted).
// Shares (never cleared, the user's whole app): Mes plantes but for those favourites, the places, the first
// steps of the app (the tabs that came, the plants seen), the settings and the plant sheets' layouts, the answers of
// the online services kept in cache (shared with the rest of the app).

import { forgetMadeBy } from '../core/collections.js';
import { discovering, replayMeet } from '../core/discover.js';
import { defineMiniApp } from '../miniapp/define.js';
import { forgetGame } from '../miniapp/kit/session.js';
import { aroundColumns, aroundContext, aroundSteps, locate } from '../miniapp/kit/around.js';

export default defineMiniApp({
  id: 'rencontres',
  title: 'Rencontres',
  icon: 'heart-fill',
  scene: 'meet',
  pitch: 'Les plantes observées autour de vous, une carte à la fois : à droite si elle vous plaît, à gauche sinon.',
  uses: ['inaturalist'],
  exit: { label: 'Quitter Rencontres' },
  owns: { keys: ['geoflora.discoverLayout', 'geoflora.app.rencontres.media', 'geoflora.app.rencontres.sheet'], reset: () => { replayMeet(); forgetGame('rencontres'); return forgetMadeBy('rencontres'); } },
  shared: ['Mes plantes (sauf les favoris ajoutés par ses matchs)', 'lieux', 'premiers pas de l’application', 'réglages'],
  // The photos its first match brought (once a game): { id: the plant, closed: the pane closed } — none: not yet.
  context: { ...aroundContext(), media: { init: null, persist: true } },
  actions: { locate },
  ownBar: (c, app) => discovering() && app.step.id !== 'start',
  ...aroundColumns('Rencontres'),
  // During the first steps, its guided way covers both steps (map, cards, photos: kit/ma-guided.js); after them, the
  // map then the cards beside it, as the others.
  steps: aroundSteps('meet', {
    map: [{ id: 'meet', use: 'meet', col: 'map', title: 'Carte' }],
    cards: [{ id: 'list', use: 'aroundList', col: 'cards', title: 'Rencontres', props: { media: true }, when: () => !discovering() }]
  })
});
