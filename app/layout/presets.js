// @ts-check
// Ready-made free layouts (« Disposition libre »): offered in Réglages, on an empty layout and in the layout's editor.
// Each one is only a layout as written (grammar.js): a link opens it, the editor changes it, and nothing is kept
// but the sizes given to it on this device (sizes.js).

/** @typedef {{ id: string, title: string, about: string, spec: string }} Preset */

/** @type {Preset[]} */
export const PRESETS = [
  { id: 'carte-recherche-fiche', title: 'Carte, recherche et fiche', about: 'La zone sur la carte, la recherche de Flore, la fiche de la plante choisie.',
    spec: '[map(r=2km)@34,search@30,plant@36]' },
  { id: 'carte-wiki-calendrier', title: 'Carte, résultats, Wikipédia et calendrier', about: 'Les plantes de la zone, et pour celle choisie : son article et son calendrier, l’un sous l’autre.',
    spec: '[map(r=2km),search,[plant.wikipedia,plant.calendar]]' },
  { id: 'rencontres', title: 'Rencontres autour d’un lieu', about: 'Choisir un lieu, voir ses plantes en cartes à swiper, leurs photos et leur carte.',
    spec: '[[place@22,map],deck,[media,plant.status]]' },
  { id: 'etude', title: 'Étude d’une plante', about: 'Chercher, puis lire une plante à la loupe : classification, répartition, carte et photos.',
    spec: '[[search(list=0)@30,results],[plant.taxonomy,plant.occurrences],[plant.map,media]]' },
  { id: 'grille', title: 'Grille et photos', about: 'Les résultats en grille aux colonnes triables, la recherche et ses filtres à côté, les photos de la plante choisie.',
    spec: '[[search(list=0)@30,filters]@24,results(view=grid)@46,[media,plant.name]]' }
];
