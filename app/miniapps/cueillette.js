// @ts-check
// Cueillette prudente: around you, only the plants that matter for picking — those of the Anses and Centres antipoison
// list of dangerous confusions, the deadliest first —, each card saying its look-alikes, its toxicity, its protection
// before anything else; the list says, in red, never to pick without a certain identification, and whom to call. A
// toxic look-alike is never a match nor a favourite: swiped right, it is recognised, to avoid (kit/session.js#swiped),
// counted apart. Its start (« Autour de moi », a commune, « Reprendre »), how far to look over the map, then the
// cards. Playing it changes nothing else in the app: the harvest mode stays as the user set it (Réglages).
// Built from the kit (app/miniapp/kit): ma-distance, then ma-around-list (harvest).
// Owns — everything « Rejouer » / « Recommencer » empties, here and in the other tabs, as if never opened:
//  - geoflora.app.cueillette.state: its place and name, distance, cards swiped right (this game's matches; its toxic
//    look-alikes recognised, `avoided`) and left, the step it was left at; geoflora.app.cueillette.layout: its columns'
//    widths (runtime.js#replay);
//    geoflora.app.cueillette.sheet: the width of a plant's sheet beside the cards;
//  - in memory: the cards found, the observations, what Wikipédia says, the undo stack, the deck's order, the view
//    chosen, the swipe hint shown (kit/session.js: a new session, forgetGame).
//  - in Mes plantes, the favourites its matches added (their origin, core/collections.js#forgetMadeBy) — not one
//    that was a favourite before the match, nor one set elsewhere, nor one the user then put in a collection or
//    gave a note (made their own: place-model.js#promoted).
// Shares (never cleared, the user's whole app): Mes plantes but for those favourites, the places, the first
// steps of the app, the settings (read, never written), the answers of the online services kept in cache.

import { forgetMadeBy } from '../core/collections.js';
import { defineMiniApp } from '../miniapp/define.js';
import { aroundColumns, aroundContext, aroundSteps, locate } from '../miniapp/kit/around.js';
import { forgetGame } from '../miniapp/kit/session.js';

export default defineMiniApp({
  id: 'cueillette',
  title: 'Cueillette prudente',
  icon: 'leaf',
  scene: 'harvest',
  pitch: 'Ce qui se cueille autour de vous… et ses sosies dangereux, les mortels d’abord.',
  uses: ['inaturalist'],
  exit: { label: 'Quitter la cueillette' },
  owns: { keys: ['geoflora.app.cueillette.sheet'], reset: () => { forgetGame('cueillette'); return forgetMadeBy('cueillette'); } },
  shared: ['Mes plantes (sauf les favoris ajoutés par ses matchs)', 'lieux', 'réglages'],
  // Its own: the toxic look-alikes recognised, to avoid (kit/cards.js#avoid) — never among the matches.
  context: { ...aroundContext(), avoided: { init: [], persist: true } },
  actions: { locate },
  ...aroundColumns('Cueillette prudente'),
  steps: aroundSteps('harvest', {
    map: [{ id: 'distance', use: 'distance', col: 'map', title: 'Carte' }],
    cards: [{ id: 'list', use: 'aroundList', col: 'cards', title: 'Cueillette prudente', props: { harvest: true, heading: 'Cueillette prudente' } }]
  })
});
