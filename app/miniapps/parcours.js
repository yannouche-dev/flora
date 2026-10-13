// @ts-check
// Parcours botanique: a walk; the plants met named (typed or said), each where it was met, on the map of the walk;
// « Terminer » gives its recap. Ported whole (gf-trail): its element draws the start, the walk and the recap, and
// says each step it reaches (driven). What was dimmed before while walking (the rest of GeoFlora, out of reach) is
// now the box itself: the app alone on the screen, one way out.
// Owns — everything « Rejouer » / « Recommencer » empties, here and in the other tabs, as if never opened: the walk
// under way (geoflora.trail), the list of walks to take up again (geoflora.trails), the recap shown
// (geoflora.trailDone), the width of its side column (geoflora.trailLayout), its state and layout
// (geoflora.app.parcours.*: runtime.js#replay); in memory, its element (drawn anew); in Mes plantes, the walk under
// way, or one left empty — places with its origin — with every plant in it (core/collections.js#forgetMadeBy).
// Shares (never cleared, the user's whole app): the walks made the user's own — finished with plants, or renamed,
// edited, added to from Mes plantes, shared, exported alone: their origin dropped (place-model.js#promoted) —, the
// other places and their plants, the favourites, the settings, the answers of the online services kept in cache.

import { forgetMadeBy } from '../core/collections.js';
import { defineMiniApp } from '../miniapp/define.js';

export default defineMiniApp({
  id: 'parcours',
  title: 'Parcours botanique',
  icon: 'geo-alt-fill',
  scene: 'trail',
  pitch: 'Marchez, nommez les plantes que vous croisez : chacune prend sa place sur la carte de votre parcours.',
  exit: { label: 'Quitter le parcours' },
  driven: true,
  owns: { keys: ['geoflora.trail', 'geoflora.trails', 'geoflora.trailDone', 'geoflora.trailLayout'], reset: () => forgetMadeBy('parcours'),
    made: { label: 'le parcours en cours', kept: ['Votre parcours enregistré dans Mes plantes est conservé.', 'Vos {n} parcours enregistrés dans Mes plantes sont conservés.'] } },
  shared: ['Mes plantes (sauf les parcours qu’il y a enregistrés)', 'favoris', 'réglages'],
  columns: [{ id: 'main', base: 'fill', min: 300, rank: 1, heavy: true, title: 'Parcours' }],
  phone: { rows: [['main', '1fr']] },
  steps: [
    { id: 'start', kind: 'start', label: 'Départ', about: 'Ici, ou d’une commune', next: 'walk',
      add: [{ id: 'trail', use: 'trail', col: 'main', title: 'Parcours' }] },
    { id: 'walk', label: 'En marche', about: 'Nommez les plantes croisées', next: 'done' },
    { id: 'done', label: 'Bilan', about: 'Le parcours terminé' }
  ]
});
