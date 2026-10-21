// @ts-check
// The grids a free layout offers to start from (gf-layout.js, its start screen; the old « Créer une app » links,
// router.js): layouts of the grammar (grammar.js) whose cells are empty places (`slot`, registry.js). Pure data, read
// under Node by the unit tests.

/**
 * `spec`: the layout of empty places; `about`: what it suits.
 * @type {{ id: string, title: string, about: string, spec: string, icon: import('../core/icons.js').IconName }[]}
 */
export const GRIDS = [
  { id: 'colonne', title: 'Une colonne', icon: 'layout-text-window',
    about: 'Simple : les blocs l’un sous l’autre, comme une page qu’on fait défiler. Idéal pour une fiche, un récit, un téléphone.',
    spec: '[[slot@20,slot@45,slot]]' },
  { id: 'trois', title: 'Trois colonnes', icon: 'layout-three-columns',
    about: 'Classique : trois colonnes côte à côte, par exemple la carte, la liste et la fiche.',
    spec: '[slot@30,slot@35,slot]' },
  { id: 'tableau', title: 'Tableau de bord', icon: 'grid-1x2',
    about: 'Complet : un volet latéral, une rangée d’indicateurs, une grande zone et deux blocs en bas.',
    spec: '[slot@20,[[slot,slot,slot]@22,slot@46,[slot@60,slot]]]' }
];

/**
 * The layout a builder route is building: its g= text, else the grid it names (#/builder/<grid>), else none (null: the
 * builder's start). Resolved here, not by the router, so the grids stay out of the start of the app.
 * @param {{ spec?: string | null, grid?: string | null }} route @returns {string | null}
 */
export const builderSpec = route => route.spec ?? GRIDS.find(g => g.id === route.grid)?.spec ?? null;
