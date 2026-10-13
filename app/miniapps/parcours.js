// @ts-check
// Parcours botanique: a walk; the plants met named (typed or said), each where it was met, on the map of the walk;
// « Terminer » gives its recap. Ported whole (gf-trail): its element draws the start, the walk and the recap, and
// says each step it reaches (driven). What was dimmed before while walking (the rest of GeoFlora, out of reach) is
// now the box itself: the app alone on the screen, one way out.
// Owns: the walk under way, the list of walks to take up again, the recap shown (their keys below). Shares (never
// cleared): the walks themselves, places of Mes plantes, and their plants.

import { defineMiniApp } from '../miniapp/define.js';

export default defineMiniApp({
  id: 'parcours',
  title: 'Parcours botanique',
  icon: 'geo-alt-fill',
  scene: 'trail',
  pitch: 'Marchez, nommez les plantes que vous croisez : chacune prend sa place sur la carte de votre parcours.',
  exit: { label: 'Quitter le parcours' },
  driven: true,
  owns: { keys: ['geoflora.trail', 'geoflora.trails', 'geoflora.trailDone'] },
  shared: ['Mes plantes (chaque parcours y reste, avec ses plantes)', 'réglages'],
  columns: [{ id: 'main', base: 'fill', min: 300, rank: 1, heavy: true, title: 'Parcours' }],
  phone: { rows: [['main', '1fr']] },
  steps: [
    { id: 'start', kind: 'start', label: 'Départ', about: 'Ici, ou d’une commune', next: 'walk',
      add: [{ id: 'trail', use: 'trail', col: 'main', title: 'Parcours' }] },
    { id: 'walk', label: 'En marche', about: 'Nommez les plantes croisées', next: 'done' },
    { id: 'done', label: 'Bilan', about: 'Le parcours terminé' }
  ]
});
