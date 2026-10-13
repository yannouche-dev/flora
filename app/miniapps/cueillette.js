// @ts-check
// Cueillette prudente: around you, only the plants that matter for picking — those of the Anses and Centres antipoison
// list of dangerous confusions, the deadliest first —, each card saying its look-alikes, its toxicity, its protection
// before anything else; the list says, in red, never to pick without a certain identification, and whom to call. Its
// start (« Autour de moi », a commune, « Reprendre »), how far to look over the map, then the cards. Launched, the
// harvest mode comes on (app/miniapps/index.js).
// Built from the kit (app/miniapp/kit): ma-distance, then ma-around-list (harvest).
// Owns — everything « Rejouer » / « Recommencer » empties, here and in the other tabs, as if never opened:
//  - geoflora.app.cueillette.state: its place and name, distance, cards swiped right (this game's matches) and left, the
//    step it was left at; geoflora.app.cueillette.layout: its columns' widths (runtime.js#replay);
//  - in memory: the cards found, the observations, what Wikipédia says, the undo stack, the deck's order, the view
//    chosen, the swipe hint shown (kit/session.js: a new session, forgetGame).
//  - in Mes plantes, the favourites its matches added (their origin, core/collections.js#forgetMadeBy) — not one
//    that was a favourite before the match, nor one set elsewhere, nor one the user then put in a collection or
//    gave a note (made their own: place-model.js#promoted).
// Shares (never cleared, the user's whole app): Mes plantes but for those favourites, the places, the first
// steps of the app, the harvest mode, the settings, the answers of the online services kept in cache.

import { forgetMadeBy } from '../core/collections.js';
import { defineMiniApp } from '../miniapp/define.js';
import { aroundContext, aroundSteps, locate } from '../miniapp/kit/around.js';
import { forgetGame } from '../miniapp/kit/session.js';

export default defineMiniApp({
  id: 'cueillette',
  title: 'Cueillette prudente',
  icon: 'leaf',
  scene: 'harvest',
  pitch: 'Ce qui se cueille autour de vous… et ses sosies dangereux, les mortels d’abord. Le mode cueillette s’allume.',
  uses: ['inaturalist'],
  exit: { label: 'Quitter la cueillette' },
  owns: { reset: () => { forgetGame('cueillette'); return forgetMadeBy('cueillette'); } },
  shared: ['Mes plantes (sauf les favoris ajoutés par ses matchs)', 'lieux', 'mode cueillette', 'réglages'],
  context: aroundContext(),
  actions: { locate },
  columns: [{ id: 'main', base: 'fill', min: 300, rank: 1, heavy: true, title: 'Cueillette prudente' }],
  phone: { rows: [['main', '1fr']] },
  steps: aroundSteps('harvest', {
    map: [{ id: 'distance', use: 'distance', col: 'main', title: 'Distance' }],
    drop: ['distance'],
    cards: [{ id: 'list', use: 'aroundList', col: 'main', title: 'Cueillette prudente', props: { harvest: true, heading: 'Cueillette prudente' } }]
  })
});
