// @ts-check
// Mosaïque: the photos of the plants observed near here, large — a mosaic; « En fleur maintenant » keeps those in
// flower; a touch opens the plant at its images. Its start (« Autour de moi », a commune, « Reprendre »), how far to
// look over the map, then the mosaic (the deck and the matches too, as the other games around a place).
// Built from the kit (app/miniapp/kit): ma-distance, then ma-around-list (mosaic).
// Owns — everything « Rejouer » / « Recommencer » empties, here and in the other tabs, as if never opened:
//  - geoflora.app.mosaique.state: its place and name, distance, cards swiped right (this game's matches) and left, the
//    step it was left at; geoflora.app.mosaique.layout: its columns' widths (runtime.js#replay);
//    geoflora.app.mosaique.sheet: the width of a plant's sheet beside the cards;
//  - in memory: the cards found, the observations, what Wikipédia says, the undo stack, the deck's order, the view
//    chosen, the « En fleur » filter, the swipe hint shown (kit/session.js: a new session, forgetGame).
//  - in Mes plantes, the favourites its matches added (their origin, core/collections.js#forgetMadeBy) — not one
//    that was a favourite before the match, nor one set elsewhere, nor one the user then put in a collection or
//    gave a note (made their own: place-model.js#promoted).
// Shares (never cleared, the user's whole app): Mes plantes but for those favourites, the places, the first
// steps of the app, the settings, the answers of the online services kept in cache.

import { forgetMadeBy } from '../core/collections.js';
import { defineMiniApp } from '../miniapp/define.js';
import { aroundContext, aroundSteps, locate } from '../miniapp/kit/around.js';
import { forgetGame } from '../miniapp/kit/session.js';

export default defineMiniApp({
  id: 'mosaique',
  title: 'Mosaïque',
  icon: 'images',
  scene: 'mosaic',
  pitch: 'Toutes les photos des plantes du coin, en grand. Une image touchée : toutes celles de la plante.',
  uses: ['inaturalist'],
  exit: { label: 'Quitter la mosaïque' },
  owns: { keys: ['geoflora.app.mosaique.sheet'], reset: () => { forgetGame('mosaique'); return forgetMadeBy('mosaique'); } },
  shared: ['Mes plantes (sauf les favoris ajoutés par ses matchs)', 'lieux', 'réglages'],
  context: aroundContext(),
  actions: { locate },
  columns: [{ id: 'main', base: 'fill', min: 300, rank: 1, heavy: true, title: 'Mosaïque' }],
  phone: { rows: [['main', '1fr']] },
  steps: aroundSteps('mosaic', {
    map: [{ id: 'distance', use: 'distance', col: 'main', title: 'Distance', props: { view: 'all' } }],
    drop: ['distance'],
    cards: [{ id: 'list', use: 'aroundList', col: 'main', title: 'Mosaïque', props: { mosaic: true, heading: 'Mosaïque', view: 'all' } }]
  })
});
