// @ts-check
// Rencontres: the plants observed around you, one card at a time — right if it pleases you, left if not. Ported
// whole from Découvrir (gf-discover, scenario 'meet'): its start (« Autour de moi », a commune, « Reprendre »), how
// far to look over the map, then the cards, the matches and all of them; the plant open over it at ?p=. Its element
// leads the steps (driven) and says each one it reaches.
// Owns: the session kept by core/discover.js — the place, the distance, the cards swiped, this game's matches, the
// steps of its guided way and the fork. Shares (never cleared): the favourites a match adds, the first steps of the
// app (the tabs that came), the settings.

import { replayMeet } from '../core/discover.js';
import { defineMiniApp } from '../miniapp/define.js';

export default defineMiniApp({
  id: 'rencontres',
  title: 'Rencontres',
  icon: 'heart-fill',
  scene: 'meet',
  pitch: 'Les plantes observées autour de vous, une carte à la fois : à droite si elle vous plaît, à gauche sinon.',
  uses: ['inaturalist'],
  exit: { label: 'Quitter Rencontres' },
  driven: true,
  owns: { reset: replayMeet },
  shared: ['favoris (les matchs y restent)', 'premiers pas de l’application', 'réglages'],
  context: { focus: { init: null } },
  columns: [{ id: 'main', base: 'fill', min: 300, rank: 1, heavy: true, title: 'Rencontres' }],
  phone: { rows: [['main', '1fr']] },
  steps: [
    { id: 'start', kind: 'start', label: 'Départ', about: 'Autour de vous, ou d’une commune', next: 'map',
      add: [{ id: 'meet', use: 'meet', col: 'main', title: 'Rencontres' }] },
    { id: 'map', label: 'Carte', about: 'Jusqu’où chercher', next: 'cards' },
    { id: 'cards', label: 'Rencontres', about: 'Une carte à la fois' }
  ]
});
