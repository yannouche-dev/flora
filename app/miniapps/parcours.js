// @ts-check
// Parcours botanique: a walk; the plants met named (typed or said), each where it was met, on the map of the walk;
// « Terminer » gives its recap. Built from the kit (app/miniapp/kit): its first screen (trail-start.js, drawn by the
// box: « Commencer ici », a commune, a walk to take up again), the walk (ma-walk: its card, its plants, its search
// under the thumb, its map) and the recap (ma-trail-recap: its map and « Vue 3D », its profile, « Partager »); its
// game (trail-session.js) leads the steps — Départ › En marche › Bilan —, each one an address (#/app/parcours/walk),
// Back the one before. Opened with no step named, the walk under way (or its recap) comes back at once (resumeAt).
// Owns — everything « Rejouer » / « Recommencer » empties, here and in the other tabs, as if never opened: the walk
// under way (geoflora.trail), the list of walks to take up again (geoflora.trails), the recap shown
// (geoflora.trailDone), the width of its side column (geoflora.trailLayout), its state and layout
// (geoflora.app.parcours.*: runtime.js#replay); in memory, its game (a new one: trail-session.js#trailSessionOf); in
// Mes plantes, the walk under way, or one left empty — places with its origin — with every plant in it
// (core/collections.js#forgetMadeBy).
// Shares (never cleared, the user's whole app): the walks made the user's own — finished with plants, or renamed,
// edited, added to from Mes plantes, shared, exported alone: their origin dropped (place-model.js#promoted) —, the
// other places and their plants, the favourites, the settings, the answers of the online services kept in cache.

import { config } from '../config.js';
import { forgetMadeBy } from '../core/collections.js';
import { defineMiniApp } from '../miniapp/define.js';
import { trailSessionOf } from '../miniapp/kit/trail-session.js';
import { trailStart } from '../miniapp/kit/trail-start.js';
import { walkDone, walkOn } from '../miniapp/kit/trail-store.js';

export default defineMiniApp({
  id: 'parcours',
  title: 'Parcours botanique',
  icon: 'geo-alt-fill',
  scene: 'trail',
  pitch: 'Marchez, nommez les plantes que vous croisez : chacune prend sa place sur la carte de votre parcours.',
  exit: { label: 'Quitter le parcours' },
  owns: { keys: [config.storageKeys.trail, config.storageKeys.trails, config.storageKeys.trailDone, config.storageKeys.trailLayout], reset: () => forgetMadeBy('parcours'),
    made: { label: 'le parcours en cours', kept: ['Votre parcours enregistré dans Mes plantes est conservé.', 'Vos {n} parcours enregistrés dans Mes plantes sont conservés.'] } },
  shared: ['Mes plantes (sauf les parcours qu’il y a enregistrés)', 'favoris', 'réglages'],
  // « Commencer ici »: located, the walk created there (its game: trail-session.js).
  actions: { locate: { mode: 'exclusive', run: app => trailSessionOf(app).locate(app.signal('locate')) } },
  // The walk under way, or the one just ended (its recap), found again when the address names no step.
  resumeAt: () => walkOn() ? 'walk' : walkDone() ? 'done' : null,
  columns: [{ id: 'main', base: 'fill', min: 300, rank: 1, heavy: true, title: 'Parcours' }],
  phone: { rows: [['main', '1fr']] },
  steps: [
    { id: 'start', kind: 'start', label: 'Départ', about: 'Ici, ou d’une commune', next: 'walk', start: (c, app) => trailStart(c, app) },
    { id: 'walk', label: 'En marche', about: 'Nommez les plantes croisées', can: () => Boolean(walkOn()), next: 'done',
      add: [{ id: 'walk', use: 'walk', col: 'main', title: 'Parcours' }] },
    { id: 'done', label: 'Bilan', about: 'Le parcours terminé', can: () => Boolean(walkDone()), drop: ['walk'],
      add: [{ id: 'recap', use: 'recap', col: 'main', title: 'Bilan' }] }
  ]
});
