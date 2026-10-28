// @ts-check
// What a screen of one's own starts from (gf-layout.js: its home, « Composer un écran »; « Créer une app »'s old
// addresses): the grids — layouts of empty places (`slot`, registry.js) — then the ready-made screens. Each one is only a
// layout as written (grammar.js): opened, it is modified like any other; nothing is kept but the sizes given to it
// on this device (sizes.js). Pure data, read under Node by the unit tests.

/**
 * `kind`: a grid (empty places) or a model (a ready-made screen); `spec`: its layout; `about`: what it suits.
 * @typedef {{ id: string, kind: 'grille' | 'modele', title: string, about: string, spec: string, icon?: import('../core/icons.js').IconName }} Model
 */

/** Grids first, then the models. @type {Model[]} */
export const MODELS = [
  { id: 'colonne', kind: 'grille', title: 'Une colonne', icon: 'layout-text-window',
    about: 'Simple : les blocs l’un sous l’autre, comme une page qu’on fait défiler. Idéal pour une fiche, un récit, un téléphone.',
    spec: '[[slot@20,slot@45,slot]]' },
  { id: 'trois', kind: 'grille', title: 'Trois colonnes', icon: 'layout-three-columns',
    about: 'Classique : trois colonnes côte à côte, par exemple la carte, la liste et la fiche.',
    spec: '[slot@30,slot@35,slot]' },
  { id: 'tableau', kind: 'grille', title: 'Tableau de bord', icon: 'grid-1x2',
    about: 'Complet : un volet latéral, une rangée d’indicateurs, une grande zone et deux blocs en bas.',
    spec: '[slot@20,[[slot,slot,slot]@22,slot@46,[slot@60,slot]]]' },
  { id: 'carte-recherche-fiche', kind: 'modele', title: 'Carte, recherche et fiche', about: 'La zone sur la carte, la recherche de l’écran, la fiche de la plante choisie.',
    spec: '[map(r=2km)@34,search@30,plant@36]' },
  { id: 'carte-wiki-calendrier', kind: 'modele', title: 'Carte, résultats, Wikipédia et calendrier', about: 'Les plantes de la zone, et pour celle choisie : son article et son calendrier, l’un sous l’autre.',
    spec: '[map(r=2km),search,[plant.wikipedia,plant.calendar]]' },
  { id: 'rencontres', kind: 'modele', title: 'Rencontres autour d’un lieu', about: 'Choisir un lieu, voir ses plantes en cartes à swiper, leurs photos et leur carte.',
    spec: '[[place@22,map],deck,[media,plant.status]]' },
  { id: 'etude', kind: 'modele', title: 'Étude d’une plante', about: 'Chercher, puis lire une plante à la loupe : classification, répartition, carte et photos.',
    spec: '[[search(list=0)@30,results],[plant.taxonomy,plant.occurrences],[plant.map,media]]' },
  { id: 'grille', kind: 'modele', title: 'Grille et photos', about: 'Les résultats en grille aux colonnes triables, la recherche et ses filtres à côté, les photos de la plante choisie.',
    spec: '[[search(list=0)@30,filters]@24,results(view=grid)@46,[media,plant.name]]' }
];

/** A model's layout by its id (the old #/builder/<grid>); null: none. @param {string | null | undefined} id */
export const modelSpec = id => MODELS.find(m => m.id === id)?.spec ?? null;
