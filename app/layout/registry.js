// @ts-check
// The components a free layout (« Disposition libre », grammar.js) puts in its cells: what each one is — its id, its
// French title, its icon, its sub-views (a plant's single blocks: plant.wikipedia), its parameters (each with its kind,
// its default, its French words), what it reads of the layout's shared state and what it writes there — and how a
// cell as written resolves to it. Pure (the rendering is cells.js'), tested under Node.
//
// Resolving never fails: a name or a view is read whatever its case and accents, in English or French (carte = map,
// fiche = plant, plant.calendrier = plant.calendar); an unknown component becomes a placeholder cell that says so and
// offers the closest name; an unknown view, parameter or value is said, and left out (the default holds). What is
// kept is written back in canonical form (canonical()): the address then reads the same for everyone.
//
// The shared state (state.js): `scope` (the place's centre and the radius), `query` (the Flore search: its text, its
// filters, its sort), `results` (the plants it finds, in the scope), `plant` (the current plant), `obs` (an observation
// lit on the map). reads / writes below say which a component follows and which it changes.

import { fold } from '../core/fold.js';
import { BLOCKS } from '../core/sheet-blocks.js';
import { blockCategory, categoryOf } from '../core/categories.js';
import { MAP_CONTROL_ALIASES, MAP_CONTROLS, MAP_INTENT_ALIASES, MAP_INTENTS, MAP_LAYER_ALIASES, MAP_LAYERS, defaultControls, layerWord, readOpacities, readView } from './map-options.js';

/**
 * @typedef {'distance' | 'enum' | 'bool' | 'list' | 'text' | 'intent' | 'id'} ParamKind
 * @typedef {{ kind: ParamKind, label: string, def: unknown, values?: Record<string, string>, aliases?: Record<string, string>, words?: string[],
 *   off?: string[], group?: string, mark?: string, bundles?: Record<string, Record<string, string>>, defOf?: (params: Record<string, any>) => unknown,
 *   named?: boolean, max?: number, frame?: boolean, own?: boolean, more?: (word: string) => string | undefined, ordered?: boolean,
 *   read?: (text: string) => string | undefined, unset?: string }} ParamSpec
 *   `values`: an enum's (a list's, an intent's) canonical values and their French labels; `aliases`: other spellings of
 *   a value → canonical; `words`: other names of the parameter; `off`: words that, alone, set a yes-or-no one to no
 *   (map(2d)); `group`: its heading in the editor and the README (Où, Fond…); `mark`: its mark in a menu (cellMark),
 *   else its label's first letter; `defOf`: its default as the other parameters make it (ctl: by ui and the intent) —
 *   a value written that is the same left out of the address; `named`: never given a bare value (map(zoom) is not ctl=zoom);
 *   `unset`: what it means not said, in a few words (the editor says it beside a list none of whose values is chosen).
 *   Kinds: `list` — several of its values joined by « + » (layers=znieff+n2000), each unknown one said and left out;
 *   `text` — free words (lieu=Mirabel Ménétrol 63: never a bare value); `intent` — one word for a bundle of the other
 *   parameters (`bundles`: each value's, as the address writes them), which a parameter written beside it overrides;
 *   `id` — a plant's number (plante=128268). `max`: a text's characters at most (80 else); `frame`: one of the frame
 *   every cell shares (FRAME below: its head, its actions, its empty state, its links), not the component's own.
 *   `own`: set by the cell's own controls (the map's 3D, its layers' opacity, its view…), never in the editor's
 *   « Affiner » nor a mark — the address keeps what was done in the cell. A list's `more`: a word beyond its values that
 *   it takes all the same, canonical (layers: a layer of IGN's catalogue « ign:<id> »), else undefined; `ordered`: its
 *   values in the order written (layers: the last drawn on top), not the parameter's. A text's `read`: its words
 *   checked, canonical (vue: « 45.77/3.08/13 »), else undefined.
 * @typedef {'scope' | 'query' | 'results' | 'plant' | 'obs'} StateKey
 * @typedef {{ key: string, title: string }} ViewSpec
 * @typedef {object} ComponentSpec
 * @property {string} id
 * @property {string} title
 * @property {import('../core/icons.js').IconName} icon
 * @property {string} about                   one sentence, for the editor and the README
 * @property {string[]} aliases               other names (French): folded, as typed
 * @property {Record<string, ParamSpec>} params
 * @property {string} [main]                 the parameter a bare value sets first: map(20km) = map(r=20km) (else the first that reads it)
 * @property {() => ViewSpec[]} [views]      its sub-views (plant: one block of the sheet)
 * @property {Record<string, string>} [viewAliases]   other names of a view (folded) → its key
 * @property {StateKey[]} reads
 * @property {StateKey[]} writes
 * @property {{ w: number, h: number }} min  the least room it works in (px)
 * @property {boolean} [empty]              a place to build in (slot): what « Changer de bloc » leaves, never offered as content
 *
 * @typedef {{ known: true, spec: ComponentSpec, view: ViewSpec | null, params: Record<string, any>, given: Set<string>, implied: Set<string>, problems: string[], title: string }
 *   | { known: false, name: string, suggestion: string | null, problems: string[], title: string }} Resolved
 */

/** The radius of a scope: from 100 m to 50 km (iNaturalist searches a circle; beyond, a region's list, not « around »). */
export const DISTANCE = { min: 100, max: 50_000 };

/**
 * A distance as written: « 500m », « 2km », « 2,5 km », a bare number in km (« 20 » = 20 km). null: not a distance.
 * Clamped to DISTANCE. @param {unknown} text @returns {number | null}
 */
export function parseDistance(text) {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(km|m)?\s*$/i.exec(String(text ?? ''));
  if (!m) return null;
  const n = Number(m[1].replace(',', '.')) * ((m[2] || 'km').toLowerCase() === 'm' ? 1 : 1000);
  if (!(n > 0)) return null;
  return Math.round(Math.min(DISTANCE.max, Math.max(DISTANCE.min, n)));
}

/** A distance in the address: « 500m », « 2km », « 2.5km ». @param {number} m */
export const distanceText = m => m < 1000 ? Math.round(m) + 'm' : Math.round(m / 100) / 10 + 'km';

/** A distance in French: « 500 m », « 2,5 km ». @param {number} m */
export const distanceLabel = m => m < 1000 ? Math.round(m) + ' m' : (Math.round(m / 100) / 10).toLocaleString('fr-FR') + ' km';

const BOOL = { oui: 'true', non: 'false', yes: 'true', no: 'false', on: 'true', off: 'false', vrai: 'true', faux: 'false', 1: 'true', 0: 'false', avec: 'true', sans: 'false', true: 'true', false: 'false' };

/** The radius of the scope: a default, until the address says another one (?r=). @type {ParamSpec} */
const RADIUS = { kind: 'distance', label: 'Rayon de la zone', def: null, words: ['radius', 'rayon', 'distance', 'zone'] };

/** A value of a list, its words: each name's label. @param {Record<string, { label: string }>} o */
const labels = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.label]));

/**
 * The map's settings, by group (the editor's headings, the README's): Où, Fond, Couches, Points, Liens, Interface —
 * and first, its intent (one word, a bundle of them: map-options.js). Their defaults: the map as it always was.
 * @type {Record<string, ParamSpec>}
 */
const MAP_PARAMS = {
  intent: {
    kind: 'intent', label: 'Intention', def: 'explorer', values: labels(MAP_INTENTS), aliases: MAP_INTENT_ALIASES, words: ['intention', 'usage', 'pour'],
    bundles: Object.fromEntries(Object.entries(MAP_INTENTS).map(([k, v]) => [k, v.set]))
  },
  // Où: how far it sees — the zone (its circle, the observations of the plants found in it), the whole of France or
  // the world (the plants found, observed there: iNaturalist's tiles) —; the map's own scope, until the address says
  // one (no at= nor place=); the address' always wins, and the scope stays the layout's, shared by every cell.
  portee: {
    kind: 'enum', label: 'Étendue', def: 'zone', group: 'Où', values: { zone: 'La zone', france: 'La France', monde: 'Le monde' },
    aliases: { ici: 'zone', cercle: 'zone', pays: 'france', fr: 'france', world: 'monde', terre: 'monde', planete: 'monde', global: 'monde' },
    words: ['etendue', 'echelle', 'scope', 'reach']
  },
  r: { ...RADIUS, group: 'Où' },
  lieu: { kind: 'text', label: 'Lieu de départ', def: null, group: 'Où', words: ['place', 'commune', 'ville', 'adresse'] },
  autour: { kind: 'bool', label: 'Autour de moi au départ', def: false, group: 'Où', words: ['around', 'moi', 'gps', 'position'] },
  // The view it starts on (its centre, its zoom; in 3D its tilt and turn), the map moved in « Créer une app »: else
  // framed on the zone.
  vue: { kind: 'text', label: 'Cadrage de départ', def: null, group: 'Où', own: true, named: true, max: 60, read: readView, words: ['view', 'cadrage', 'camera'] },
  // Fond: the photos unless it says (a layout's map is the same for everyone: never the Carte's shared choice).
  base: { kind: 'enum', label: 'Fond de carte', def: 'photo', group: 'Fond', values: { photo: 'Photos aériennes', plan: 'Plan IGN' }, aliases: { photos: 'photo', ortho: 'photo', satellite: 'photo', ign: 'plan', carte: 'plan' }, words: ['fond', 'layer'] },
  '3d': { kind: 'bool', label: 'Vue 3D', def: null, group: 'Fond', mark: '3D', off: ['2d', 'plat', 'plate'], words: ['vue3d', 'relief3d', 'rendu'] },
  // Couches.
  // Any layer of IGN's catalogue too (ign:<id>), in the order drawn (the last on top); their opacity when not the usual.
  layers: {
    kind: 'list', label: 'Couches', def: [], group: 'Couches', values: labels(MAP_LAYERS), aliases: MAP_LAYER_ALIASES, more: layerWord, ordered: true,
    words: ['couches', 'calques', 'overlays', 'couche']
  },
  opac: { kind: 'text', label: 'Opacité des couches', def: null, group: 'Couches', own: true, named: true, max: 400, read: readOpacities, words: ['opacite', 'opacity', 'transparence'] },
  // Points.
  // The sources this map draws among its group's (core/observations.js: the zone's observations, merged); none said:
  // all of them — and the sources a map says are its group's own, unless the address says others (sources=).
  src: { kind: 'list', label: 'Sources des points', def: null, unset: 'toutes celles du groupe', group: 'Points', mark: 'So', values: { inat: 'iNaturalist', gbif: 'GBIF' }, aliases: { inaturalist: 'inat' },
    words: ['sources', 'source', 'donnees'] },
  when: { kind: 'enum', label: 'Période', def: 'toujours', group: 'Points', values: { toujours: 'Toujours', annee: 'Cette année', mois: 'Ce mois-ci' }, aliases: { tout: 'toujours', always: 'toujours', year: 'annee', an: 'annee', cetteannee: 'annee', month: 'mois', cemois: 'mois' }, words: ['quand', 'periode', 'date', 'dates'] },
  pts: { kind: 'enum', label: 'Style des points', def: 'photo', group: 'Points', values: { photo: 'Photos', pastille: 'Pastilles' }, aliases: { pastilles: 'pastille', dots: 'pastille', ronds: 'pastille', points: 'pastille' }, words: ['points', 'style', 'marqueurs'] },
  regroupe: { kind: 'bool', label: 'Plante courante en groupes', def: false, group: 'Points', mark: 'G', words: ['cluster', 'groupes', 'grouper', 'regrouper', 'groupe'] },
  // « Observations autour » of the map in 3D (the binoculars): on with its sources (absent: off; aucune: on, none), its radius.
  jumelles: {
    kind: 'list', label: 'Observations autour (3D)', def: null, group: 'Points', own: true, named: true, values: { inat: 'iNaturalist', gbif: 'GBIF', densite: 'Densité' },
    aliases: { inaturalist: 'inat', density: 'densite', hex: 'densite' }, words: ['binoculars', 'autour3d', 'observationsautour']
  },
  jrayon: { kind: 'distance', label: 'Rayon des observations autour', def: null, group: 'Points', own: true, named: true, words: ['rayon3d', 'jumellesrayon'] },
  // Liens: how the map follows the layout's state, and changes it.
  suit: { kind: 'bool', label: 'Suit la recherche', def: true, group: 'Liens', mark: 'R', words: ['suivre', 'recherche', 'filtre'] },
  plante: { kind: 'enum', label: 'Plante courante', def: 'grand', group: 'Liens', values: { grand: 'En grand', seule: 'Seule', non: 'Pas montrée' }, aliases: { large: 'grand', only: 'seule', seulement: 'seule', off: 'non', aucune: 'non' }, words: ['plant', 'courante'] },
  toucher: { kind: 'enum', label: 'Toucher un point', def: 'plante', group: 'Liens', values: { plante: 'Choisit sa plante', fiche: 'Ouvre sa fiche', rien: 'Rien' }, aliases: { pick: 'plante', choisir: 'plante', sheet: 'fiche', ouvrir: 'fiche', none: 'rien', aucun: 'rien' }, words: ['tap', 'clic', 'click', 'touch', 'touche'] },
  // Interface.
  legende: { kind: 'bool', label: 'Légende ouverte', def: false, group: 'Interface', own: true, named: true, words: ['legend'] },
  ui: { kind: 'enum', label: 'Commandes', def: 'auto', group: 'Interface', values: { auto: 'Selon la largeur', complete: 'Complètes', compacte: 'Compactes', nue: 'Aucune' }, aliases: { full: 'complete', completes: 'complete', compact: 'compacte', compactes: 'compacte', nu: 'nue', minimal: 'nue', minimale: 'nue', aucune: 'nue' }, words: ['interface', 'commandes', 'controles'] },
  // Which controls, exactly (map-options.js MAP_CONTROLS); not written: those of `ui` and the intent (defaultControls).
  ctl: {
    kind: 'list', label: 'Commandes sur la carte', def: null, group: 'Interface', mark: 'Ct', values: labels(MAP_CONTROLS), aliases: MAP_CONTROL_ALIASES,
    words: ['boutons', 'outils', 'controls'], named: true, defOf: p => defaultControls(p.ui, p.intent)
  }
};

/**
 * The frame every cell shares (« Cadre » in the editor, written after the component's own parameters, never when
 * default): its head (tete: whole, its title only, none — the cell's content takes the room), a title of its own
 * (titre: in its head and its tab on a phone), the actions of its head (agrandir: over the layout, Échap returns;
 * replier: folded to its head, its share to its siblings; partager: a link to a layout of this cell alone, with the same
 * state), its empty state (vide: a message, or the cell hidden while it has nothing to show — its share to its siblings).
 * And its links (« Liens »): a plant of its own instead of the current one (plante), the whole of France instead of
 * the zone (zone=0), what touching a plant does (toucher), whether it changes the current plant at all (ecrit=0).
 * Each component takes only those it honours (FRAME_OF): never a setting that does nothing.
 * @type {Record<string, ParamSpec>}
 */
const FRAME = {
  tete: {
    kind: 'enum', label: 'En-tête', def: 'oui', group: 'Cadre', frame: true, values: { oui: 'Complet', simple: 'Titre seul', non: 'Aucun' },
    aliases: { complet: 'oui', complete: 'oui', full: 'oui', yes: 'oui', seul: 'simple', minimal: 'simple', aucun: 'non', sans: 'non', no: 'non', none: 'non' },
    words: ['entete', 'en-tete', 'head', 'header', 'bandeau']
  },
  titre: { kind: 'text', label: 'Titre de la case', def: null, max: 40, group: 'Cadre', frame: true, words: ['title', 'nom', 'intitule'] },
  actions: {
    kind: 'list', label: 'Actions de l’en-tête', def: [], group: 'Cadre', frame: true, values: { agrandir: 'Agrandir', replier: 'Replier', partager: 'Partager' },
    aliases: { maximize: 'agrandir', maximiser: 'agrandir', pleinecran: 'agrandir', plein: 'agrandir', agrandi: 'agrandir', collapse: 'replier', plier: 'replier',
      fold: 'replier', reduire: 'replier', share: 'partager', partage: 'partager', lien: 'partager' },
    words: ['action', 'boutons', 'outils']
  },
  // Folded to its head by « Replier » (written by the action itself).
  etat: {
    kind: 'enum', label: 'État de la case', def: 'ouvert', group: 'Cadre', frame: true, own: true, named: true, values: { ouvert: 'Ouverte', replie: 'Repliée' },
    aliases: { ouverte: 'ouvert', open: 'ouvert', repliee: 'replie', plie: 'replie', pliee: 'replie', folded: 'replie' }, words: ['state', 'pli']
  },
  vide: {
    kind: 'enum', label: 'Sans rien à montrer', def: 'message', group: 'Cadre', frame: true, values: { message: 'Un message', masque: 'Case masquée' },
    aliases: { texte: 'message', dire: 'message', masquee: 'masque', masquer: 'masque', cache: 'masque', cachee: 'masque', cacher: 'masque', hide: 'masque', hidden: 'masque' },
    words: ['empty', 'etatvide']
  },
  plante: { kind: 'id', label: 'Plante fixée', def: null, group: 'Liens', frame: true, words: ['plant', 'fixe', 'fixee', 'epingle'] },
  zone: { kind: 'bool', label: 'Suit la zone', def: true, group: 'Liens', frame: true, off: ['france', 'toutelafrance'], words: ['scope', 'suitzone', 'perimetre'] },
  toucher: {
    kind: 'enum', label: 'Toucher une plante', def: 'plante', group: 'Liens', frame: true, values: { plante: 'La choisit', fiche: 'Ouvre sa fiche', rien: 'Rien' },
    aliases: { pick: 'plante', choisir: 'plante', sheet: 'fiche', ouvrir: 'fiche', none: 'rien', aucun: 'rien' }, words: ['tap', 'clic', 'click', 'touch', 'touche']
  },
  ecrit: { kind: 'bool', label: 'Change la plante courante', def: true, group: 'Liens', frame: true, words: ['ecrire', 'write', 'writes', 'choisit'] },
  // Its group: the cells of one group share a zone, a plant, a period and a search; another's are apart (two lists, two
  // maps that do not follow each other on one screen). Its keys in the address after its letter (state.js: b.q=).
  groupe: {
    kind: 'enum', label: 'Groupe', def: 'a', group: 'Liens', frame: true, named: true, values: { a: 'Groupe A', b: 'Groupe B', c: 'Groupe C' },
    aliases: { 1: 'a', 2: 'b', 3: 'c' }, words: ['group', 'canal', 'channel']
  }
};

/**
 * The frame's settings each component honours besides tete, titre and actions (every one's): vide where a cell can
 * have nothing to show (a plant's: no plant; the results: none found; the deck: no cards — the map, the search, the
 * filters and the zone always have something), plante where a cell shows a plant (the sheet, a block, the photos),
 * zone where a cell can leave the zone (the results), toucher and ecrit where a plant can be touched (a result, a
 * card, a link in the sheet). The map has links of its own (suit, plante, toucher: MAP_PARAMS).
 * @type {Record<string, string[]>}
 */
export const FRAME_OF = {
  map: [], place: [], filters: [], slot: [], search: ['toucher', 'ecrit'], results: ['vide', 'zone', 'toucher', 'ecrit'],
  plant: ['vide', 'plante', 'toucher', 'ecrit'], media: ['vide', 'plante'], deck: ['vide', 'toucher', 'ecrit']
};

/**
 * What touching a plant does in a cell that honours toucher (a result, a card, a link in a sheet): it becomes the
 * current plant (`plante`), its sheet opens (`fiche`: the layout left, as a link would), or nothing; a cell that does
 * not change the current plant (ecrit=0) opens the sheet instead of choosing. null: the cell has no say (the map has
 * its own). @param {Resolved} r @returns {'plante' | 'fiche' | 'rien' | null}
 */
export function touchOf(r) {
  if (!r.known || !FRAME_OF[r.spec.id]?.includes('toucher')) return null;
  const t = r.params.toucher ?? 'plante';
  return t === 'plante' && r.params.ecrit === false ? 'fiche' : t;
}

/** The frame's settings of a component, in their order (FRAME). @param {string} id @returns {Record<string, ParamSpec>} */
const frameOf = id => Object.fromEntries(Object.entries(FRAME).filter(([k]) => ['tete', 'titre', 'actions', 'etat', ...(id === 'slot' ? [] : ['groupe']), ...(FRAME_OF[id] ?? [])].includes(k)));

/** French names of the sheet's blocks (folded) → their key (sheet-blocks.js#BLOCKS). */
const BLOCK_ALIASES = {
  wiki: 'wikipedia', calendrier: 'calendar', floraison: 'calendar', fleurs: 'calendar', medias: 'media', galerie: 'media', photo: 'photos',
  statut: 'status', statuts: 'status', protection: 'status', confusions: 'lookalikes', sosies: 'lookalikes', usages: 'uses', cuisine: 'uses',
  classification: 'taxonomy', taxonomie: 'taxonomy', collections: 'mine', nom: 'name', noms: 'names', repartition: 'occurrences',
  carte: 'map', pollinisateurs: 'interactions', climat: 'climate', pollen: 'climate', habitat: 'gbifprofile', ecologie: 'gbifprofile',
  publications: 'literature', identifiants: 'ids', ressources: 'resources', liens: 'resources', description: 'descriptions'
};

/** The sheet's blocks a cell can show alone (not « Page web »: another site, which needs its address). @returns {ViewSpec[]} */
const blockViews = () => BLOCKS.filter(b => b.key !== 'web').map(b => ({ key: b.key, title: b.title }));

/** @type {ComponentSpec[]} */
export const COMPONENTS = [
  {
    id: 'map', title: 'Carte', icon: 'map', aliases: ['carte'],
    about: 'La zone (cercle autour d’un lieu), les observations des plantes trouvées, celles de la plante courante en grand. Toucher un point : sa plante devient la plante courante ; appui long : la zone s’y centre.',
    params: MAP_PARAMS,
    main: 'r', reads: ['scope', 'results', 'plant', 'obs'], writes: ['scope', 'plant', 'obs'], min: { w: 240, h: 180 }
  },
  {
    id: 'search', title: 'Recherche', icon: 'search', aliases: ['recherche', 'chercher', 'flore'],
    about: 'La recherche de Flore : le texte, le tri, les filtres (familles, statuts, protection…) et la liste des plantes trouvées dans la zone.',
    params: {
      filters: { kind: 'bool', label: 'Filtres ouverts', def: false, words: ['filtres', 'facettes'] },
      list: { kind: 'bool', label: 'Liste des résultats', def: true, words: ['liste', 'resultats', 'results'] }
    },
    // 280 px: its bar (gf-results-bar) gives way in a narrow cell (the sort menu beside its tools, the count being in the
    // cell's head, its longest words cut short as on a phone; the chips wrapped), every control inside the cell — and a
    // bar taller than its cell scrolls in it (cells.js); at 280 px its field still shows about eleven letters beside its
    // ✕ and its microphone — narrower, too few to read what is typed (measured: 86 px at 280, 67 at 260).
    main: 'filters', reads: ['query', 'results', 'plant'], writes: ['query', 'plant'], min: { w: 280, h: 160 }
  },
  {
    id: 'filters', title: 'Filtres', icon: 'funnel', aliases: ['filtres', 'facettes'],
    about: 'Les filtres de la recherche seuls : familles, genres, statuts, protection, photo, nom français, mes plantes.',
    params: {}, reads: ['query', 'results'], writes: ['query'], min: { w: 220, h: 160 }
  },
  {
    id: 'results', title: 'Résultats', icon: 'list-ul', aliases: ['resultats', 'liste', 'list'],
    about: 'Les plantes trouvées (la recherche, dans la zone) : en liste, ou en grille aux colonnes triables.',
    params: {
      view: { kind: 'enum', label: 'Présentation', def: 'auto', values: { auto: 'Selon la largeur', list: 'Liste', grid: 'Grille' }, aliases: { liste: 'list', grille: 'grid', table: 'grid', tableau: 'grid' }, words: ['vue', 'affichage'] }
    },
    main: 'view', reads: ['query', 'results', 'plant'], writes: ['query', 'plant'], min: { w: 240, h: 140 }
  },
  {
    id: 'plant', title: 'Fiche', icon: 'card-text', aliases: ['fiche', 'plante', 'sheet'],
    about: 'La fiche de la plante courante, entière (plant), ou un seul de ses blocs (plant.wikipedia, plant.calendar…).',
    params: {
      mode: { kind: 'enum', label: 'Mode d’affichage', def: null, values: { epure: 'Épuré', standard: 'Standard', scientific: 'Scientifique' }, aliases: { scientifique: 'scientific', science: 'scientific', simple: 'epure' }, words: ['vue', 'view'] }
    },
    main: 'mode', views: blockViews, viewAliases: BLOCK_ALIASES, reads: ['plant'], writes: ['plant'], min: { w: 260, h: 140 }
  },
  {
    id: 'media', title: 'Photos', icon: 'images', aliases: ['medias', 'photos', 'photo', 'images', 'galerie'],
    about: 'Les photos de la plante courante, en grand (la visionneuse de la fiche : zoom, plein écran).',
    params: {
      style: { kind: 'enum', label: 'Présentation', def: 'scene', values: { scene: 'Scène', mosaic: 'Mosaïque', slideshow: 'Diaporama' }, aliases: { mosaique: 'mosaic', diaporama: 'slideshow' }, words: ['presentation', 'vue'] }
    },
    main: 'style', reads: ['plant'], writes: [], min: { w: 260, h: 220 }
  },
  {
    id: 'deck', title: 'Rencontres', icon: 'heart-fill', aliases: ['cartes', 'rencontres', 'swipe', 'paquet'],
    about: 'Les plantes trouvées en cartes, une à la fois : la carte du dessus est la plante courante ; à droite, un coup de cœur (vos favoris), à gauche, la suivante.',
    params: {}, reads: ['results', 'plant', 'scope'], writes: ['plant'], min: { w: 280, h: 360 }
  },
  {
    id: 'place', title: 'Zone', icon: 'geo-alt', aliases: ['lieu', 'zone', 'scope', 'autour'],
    about: 'Choisir la zone : autour de moi, une commune, et le rayon. Sans zone, toute la flore de France.',
    params: { r: RADIUS }, main: 'r', reads: ['scope'], writes: ['scope'], min: { w: 220, h: 170 }
  },
  {
    // A place of a layout to build a component in (a starting grid's places, a cell cut in two, « Changer de bloc »):
    // the block picker's first level drawn in it (gf-layout.js, gf-block-picker.js `inline`): one tap, the place is that block.
    id: 'slot', title: 'Emplacement', icon: 'plus-lg', aliases: ['emplacement', 'case'],
    about: 'Un emplacement où construire un bloc : ses tuiles le proposent, un toucher le choisit.',
    params: {}, reads: [], writes: [], min: { w: 120, h: 80 }, empty: true
  }
];

// Every component's parameters: its own, then the frame's it honours (after them: the address writes them after).
for (const c of COMPONENTS) c.params = { ...c.params, ...frameOf(c.id) };

/** @type {Map<string, ComponentSpec>} folded names and aliases → component */
const BY_NAME = new Map(COMPONENTS.flatMap(c => [c.id, ...c.aliases].map(n => [fold(n).replace(/ /g, ''), c])));

/** A name as compared: folded, no spaces (« Médias » = « medias »). @param {string} s */
const key = s => fold(s).replace(/ /g, '');

/** Edit distance, two letters swapped counting as one (« mpa » is one edit from « map »). @param {string} a @param {string} b */
function edits(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** The closest of `names` to `word` (2 edits at most, 1 for a short word), else null. @param {string} word @param {string[]} names */
function closest(word, names) {
  let best = null, bestD = word.length <= 4 ? 1 : 2;
  for (const n of names) {
    const d = edits(word, key(n));
    if (d <= bestD && (best === null || d < bestD)) { best = n; bestD = d; }
  }
  return best;
}

/** The view of a component a word names (its key, a French name, any case), else null. @param {ComponentSpec} spec @param {string} word @returns {ViewSpec | null} */
function viewOf(spec, word) {
  const views = spec.views?.() ?? [];
  const k = key(word);
  const alias = spec.viewAliases?.[k];
  return views.find(v => key(v.key) === k || (alias && key(v.key) === alias)) ?? null;
}

/** A parameter of a component a word names (its key or one of its words). @param {ComponentSpec} spec @param {string} word @returns {string | null} */
function paramOf(spec, word) {
  const k = key(word);
  return Object.entries(spec.params).find(([p, s]) => key(p) === k || (s.words ?? []).some(w => key(w) === k))?.[0] ?? null;
}

/**
 * The parameter a bare value sets: the main one when the value is one of its own, else the first that reads it
 * (map(plan): its background; map(terrain): its intent; map(znieff+n2000): its layers) — never a text one (any words
 * would do) —, else a yes-or-no one it names, or one of its words for no (search(filtres), map(3d), map(2d)), else the
 * main one (to say why not).
 * @param {ComponentSpec} spec @param {string} value @returns {string | null}
 */
function bareParam(spec, value) {
  // Never a list's « none » alone (map(rien): toucher=rien, not layers=aucune).
  const fits = (/** @type {string} */ k) => {
    const v = spec.params[k].kind === 'text' || spec.params[k].named ? undefined : readValue(spec.params[k], value);
    return v !== undefined && !(Array.isArray(v) && !v.length);
  };
  if (spec.main && fits(spec.main)) return spec.main;
  const other = Object.keys(spec.params).find(fits);
  if (other) return other;
  const named = paramOf(spec, value) ?? offOf(spec, value);
  if (named && spec.params[named].kind === 'bool') return named;
  // Some of a list's words among others (map(znieff+foo)): that list, the others said.
  return Object.keys(spec.params).find(k => spec.params[k].kind === 'list' && !spec.params[k].named && readList(spec.params[k], value).values.length) ?? spec.main ?? null;
}

/**
 * What a cell's intent gives (its bundle, each value read), when one is written; {} else. @param {Resolved & { known: true }} r
 * @returns {Record<string, unknown>}
 */
function bundleOf(r) {
  const ps = r.spec.params;
  const intent = Object.keys(ps).find(k => ps[k].kind === 'intent' && r.given.has(k));
  const bundle = intent ? ps[intent].bundles?.[r.params[intent]] ?? {} : {};
  return Object.fromEntries(Object.entries(bundle).filter(([k]) => ps[k]).map(([k, text]) => [k, readValue(ps[k], text)]));
}

/** A parameter written as the cell's intent gives it (left out of the address, and of the marks). @param {Resolved & { known: true }} r @param {string} k */
const asIntent = (r, k) => { const b = bundleOf(r); return k in b && same(b[k], r.params[k]); };

/** A parameter written as its default made by the others gives it (ctl: the controls of ui and the intent), left out. @param {Resolved & { known: true }} r @param {string} k */
const asDefault = (r, k) => { const d = r.spec.params[k].defOf; return Boolean(d) && same(r.params[k], d?.(r.params)); };

/** The value a parameter has when not written: its default, or the one the others make (defOf). @param {ParamSpec} ps @param {Record<string, any>} params */
export const defaultOf = (ps, params) => ps.defOf ? ps.defOf(params) : ps.def;

/** The yes-or-no parameter a word sets to no, alone (map(2d)). @param {ComponentSpec} spec @param {string} word @returns {string | null} */
function offOf(spec, word) {
  const k = key(word);
  return Object.entries(spec.params).find(([, s]) => s.kind === 'bool' && (s.off ?? []).some(w => key(w) === k))?.[0] ?? null;
}

/**
 * The parameter a written one sets (its name, or a bare value's: bareParam), or null: none — the editor replaces it
 * by what is chosen. @param {ComponentSpec} spec @param {import('./grammar.js').Param} p @returns {string | null}
 */
export const paramName = (spec, p) => p.key === null ? bareParam(spec, p.value) : paramOf(spec, p.key);

/** One value of an enum, a list or an intent, canonical (undefined: not one). @param {ParamSpec} p @param {string} k folded */
function oneValue(p, k) {
  const values = Object.keys(p.values ?? {});
  return values.find(v => key(v) === k) ?? (p.aliases?.[k] && values.includes(p.aliases[k]) ? p.aliases[k] : undefined);
}

/** Words for none, in a list (layers=aucune). */
const NONE = new Set(['aucune', 'aucun', 'non', 'none', 'rien', '0', 'sans']);

/**
 * A list as written (« znieff+n2000 »; spaces or « / » too): its known values, each once, in the parameter's order,
 * and the words it does not know. @param {ParamSpec} p @param {string} text @returns {{ values: string[], unknown: string[] }}
 */
export function readList(p, text) {
  const words = String(text).split(/[+/\s]+/).map(w => w.trim()).filter(Boolean);
  if (words.length === 1 && NONE.has(key(words[0]))) return { values: [], unknown: [] };
  /** @type {string[]} */ const found = [];
  /** @type {string[]} */ const unknown = [];
  for (const w of words) {
    const v = oneValue(p, key(w)) ?? p.more?.(w);
    if (v === undefined) unknown.push(w);
    else if (!found.includes(v)) found.push(v);
  }
  // In the parameter's order (those it takes beyond its values after them), or as written (`ordered`).
  const values = p.ordered ? found : [...Object.keys(p.values ?? {}).filter(v => found.includes(v)), ...found.filter(v => !(v in (p.values ?? {})))];
  return { values, unknown };
}

/** Free words, as the address keeps them: one line, 80 characters at most (`max`; null: none). @param {string} text @param {number} [max] */
const cleanWords = (text, max = 80) => String(text).replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim() || null;

/**
 * A value read for a parameter, canonical (enum, intent: its value; bool: true / false; distance: metres; list: its
 * values — every word known, else undefined —; text: the words). undefined: not one.
 * @param {ParamSpec} p @param {string} text @returns {unknown}
 */
export function readValue(p, text) {
  if (p.kind === 'distance') return parseDistance(text) ?? undefined;
  if (p.kind === 'text') { const w = cleanWords(text, p.max); return w === null ? undefined : p.read ? p.read(w) : w; }
  if (p.kind === 'id') return /^\s*\d{1,9}\s*$/.test(text) && Number(text) > 0 ? Number(text) : undefined;
  if (p.kind === 'list') {
    const l = readList(p, text);
    return l.unknown.length || (!l.values.length && !NONE.has(key(text))) ? undefined : l.values;
  }
  const k = key(text);
  if (p.kind === 'bool') return k in BOOL ? BOOL[/** @type {keyof typeof BOOL} */ (k)] === 'true' : undefined;
  return oneValue(p, k);
}

/** A value as the address writes it. @param {ParamSpec} p @param {unknown} v */
export const valueText = (p, v) => p.kind === 'distance' ? distanceText(/** @type {number} */ (v)) : p.kind === 'bool' ? (v ? '1' : '0')
  : p.kind === 'list' ? (/** @type {string[]} */ (v).length ? /** @type {string[]} */ (v).join('+') : 'aucune') : String(v);

/** Two values the same (lists: the same values, in the same order). @param {unknown} a @param {unknown} b */
export const same = (a, b) => a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]));

/** What a parameter expects, in French. @param {ParamSpec} ps */
const expected = ps => ps.kind === 'distance' ? 'une distance (500m, 2km)' : ps.kind === 'bool' ? 'oui ou non (1, 0)' : ps.kind === 'text' ? 'des mots'
  : ps.kind === 'id' ? 'le numéro d’une plante (celui de p= dans l’adresse)'
  : Object.keys(ps.values ?? {}).join(', ') + (ps.kind === 'list' ? ', joints par « + »' : '');

/**
 * What a cell is: its component (or none: unknown, with the closest name), its view, its parameters with their
 * defaults, and what was wrong (said in French, never thrown). An intent written (map(terrain)) gives its bundle's
 * values (`implied`); a parameter written beside it, before or after, wins (`given`).
 * @param {import('./grammar.js').CellNode} cell @returns {Resolved}
 */
export function resolve(cell) {
  /** @type {string[]} */
  const problems = [];
  const spec = BY_NAME.get(key(cell.name));
  if (!spec) {
    const suggestion = closest(key(cell.name), [...BY_NAME.keys()]);
    const to = suggestion ? /** @type {ComponentSpec} */ (BY_NAME.get(suggestion)).id : null;
    problems.push(`Composant inconnu « ${cell.name} »${to ? ` : vouliez-vous dire « ${to} » ?` : '.'}`);
    return { known: false, name: cell.name, suggestion: to, problems, title: cell.name };
  }
  /** @type {Record<string, any>} */
  const params = Object.fromEntries(Object.entries(spec.params).map(([k, p]) => [k, p.def]));
  /** @type {Set<string>} */
  const given = new Set();
  /** @type {Set<string>} */
  const implied = new Set();
  let paramList = cell.params;
  /** @type {ViewSpec | null} */
  let view = null;
  if (cell.view) {
    const [first, ...rest] = cell.view.split('.');
    view = viewOf(spec, first);
    // « map:radius(20) »: a component without views, its parameter named as a view.
    const named = !view && !spec.views ? paramOf(spec, first) : null;
    if (named) paramList = paramList.map(p => p.key === null ? { key: named, value: p.value } : p);
    else if (!view) {
      const near = spec.views ? closest(key(first), (spec.views() ?? []).map(v => v.key)) : null;
      problems.push(spec.views ? `${spec.title} : bloc inconnu « ${first} »${near ? ` (« ${near} » ?)` : ''} — la fiche entière est montrée.`
        : `${spec.title} n’a pas de bloc « ${first} ».`);
    }
    if (view && rest.length) problems.push(`${spec.title} : « ${rest.join('.')} » ignoré, un bloc se montre en entier.`);
  }
  for (const p of paramList) {
    const name = paramName(spec, p);
    // One of the frame's that this component does not honour (filters(vide=masque): never empty): said so.
    const notHere = !name && p.key !== null ? Object.keys(FRAME).find(k => key(k) === key(/** @type {string} */ (p.key)) || (FRAME[k].words ?? []).some(w => key(w) === key(/** @type {string} */ (p.key)))) : null;
    if (notHere) { problems.push(`${spec.title} : « ${notHere} » ne s’applique pas à ce composant.`); continue; }
    if (!name) {
      problems.push(p.key === null ? `${spec.title} : valeur « ${p.value} » sans nom de paramètre.` : `${spec.title} : paramètre inconnu « ${p.key} ».`);
      continue;
    }
    const ps = spec.params[name];
    // « search(filtres) », « map(3d) »: a yes-or-no parameter named alone is on; « map(2d) »: one of its words for no.
    let v = p.key === null && ps.kind === 'bool' && paramOf(spec, p.value) === name ? true
      : p.key === null && ps.kind === 'bool' && offOf(spec, p.value) === name ? false : readValue(ps, p.value);
    if (v === undefined && ps.kind === 'list') {
      // A list: each word it does not know said and left out, the others kept.
      const l = readList(ps, p.value);
      for (const w of l.unknown) problems.push(`${spec.title} : « ${w} » n’est pas une valeur de ${ps.label.toLowerCase()} (attendu : ${expected(ps)}).`);
      if (!l.values.length) continue;
      v = l.values;
    }
    if (v === undefined) {
      problems.push(`${spec.title} : « ${p.value} » n’est pas une valeur de ${ps.label.toLowerCase()} (attendu : ${expected(ps)}).`);
      continue;
    }
    if (given.has(name)) problems.push(`${spec.title} : ${ps.label.toLowerCase()} donné deux fois, le dernier compte.`);
    params[name] = v;
    given.add(name);
    implied.delete(name);
    // An intent: its bundle, for each parameter not written before it (those written after it win too).
    if (ps.kind === 'intent') {
      for (const [k, text] of Object.entries(ps.bundles?.[/** @type {string} */ (v)] ?? {})) {
        if (given.has(k) || !spec.params[k]) continue;
        const iv = readValue(spec.params[k], text);
        if (iv !== undefined) { params[k] = iv; implied.add(k); }
      }
    }
  }
  // A title of its own (titre=): the cell's name everywhere (its head, its tab on a phone, its grips).
  const title = params.titre ?? (view ? view.title : spec.title);
  return { known: true, spec, view, params, given, implied, problems, title };
}

/**
 * The cell as the address writes it: the component's id, its view's key, the parameters given (valid ones, in the
 * component's order, free words last, their canonical values), its share. An intent is written first, alone (map(terrain,r=2km)) —
 * not the default one (explorer) —, and a parameter written as its intent gives it is left out: the address stays
 * short. An unknown component keeps its name as typed.
 * @param {import('./grammar.js').CellNode} cell @param {Resolved} [r] @returns {import('./grammar.js').CellNode}
 */
export function canonical(cell, r = resolve(cell)) {
  if (!r.known) return { t: 'cell', name: cell.name, view: cell.view, params: cell.params, size: cell.size };
  const ps = r.spec.params;
  const intent = Object.keys(ps).find(k => ps[k].kind === 'intent' && r.given.has(k));
  /** @type {import('./grammar.js').Param[]} */
  const params = [];
  if (intent && r.params[intent] !== ps[intent].def) params.push({ key: null, value: String(r.params[intent]) });
  // Free words last: they may end with digits (« Fontainebleau 77 »), and a comma between two digits is a decimal one
  // (grammar.js) — before 3d=1, they would take it.
  const order = Object.keys(ps).sort((a, b) => Number(ps[a].kind === 'text') - Number(ps[b].kind === 'text'));
  for (const k of order) {
    // The frame's: never written when default (actions=aucune, tete=oui).
    if (!r.given.has(k) || ps[k].kind === 'intent' || asIntent(r, k) || asDefault(r, k) || (ps[k].frame && same(r.params[k], ps[k].def))) continue;
    params.push({ key: k, value: valueText(ps[k], r.params[k]) });
  }
  return { t: 'cell', name: r.spec.id, view: r.view?.key ?? null, params, size: cell.size };
}

/**
 * A cell with one of its settings changed (the block picker, the cell's own controls: a map's 3D, its layers…): what
 * wrote it gives way (its name, or a bare value it reads: map(20km), map(terrain)), the new value written — unless the
 * cell has that value without it (its default, the one the others make, its intent's: then left out, the address
 * stays short). null: back to the default (or the intent's). The cell as it is when the setting is not one of its own.
 * @param {import('./grammar.js').CellNode} cell @param {string} key @param {unknown} v @returns {import('./grammar.js').CellNode}
 */
export function withParam(cell, key, v) {
  const r = resolve(cell);
  if (!r.known || !r.spec.params[key]) return cell;
  const ps = r.spec.params[key];
  const params = cell.params.filter(p => paramName(r.spec, p) !== key);
  const without = resolve({ ...cell, params });
  const was = without.known ? without.params[key] ?? defaultOf(ps, without.params) : ps.def;
  const empty = v === null || v === undefined || v === '';
  if (!empty && !same(v, was)) params.push({ key, value: valueText(ps, v) });
  return { ...cell, params };
}

/**
 * A whole layout resolved: its canonical tree, each cell's resolution by path ('0', '2.1'), and every problem with
 * the path of its cell. @param {import('./grammar.js').ListNode} tree
 * @returns {{ tree: import('./grammar.js').ListNode, cells: Map<string, Resolved>, problems: { path: string, message: string }[] }}
 */
export function resolveTree(tree) {
  /** @type {Map<string, Resolved>} */
  const cells = new Map();
  /** @type {{ path: string, message: string }[]} */
  const problems = [];
  /** @param {import('./grammar.js').LayoutNode} n @param {number[]} path @returns {import('./grammar.js').LayoutNode} */
  const walk = (n, path) => {
    if (n.t === 'list') return { t: 'list', kids: n.kids.map((k, j) => walk(k, [...path, j])), size: n.size };
    const r = resolve(n);
    const p = path.join('.');
    cells.set(p, r);
    for (const message of r.problems) problems.push({ path: p, message });
    return canonical(n, r);
  };
  return { tree: /** @type {import('./grammar.js').ListNode} */ (walk(tree, [])), cells, problems };
}

/** Every name a cell may start with, for the editor's list and the README (the ids, then the views of plant). */
export const names = () => COMPONENTS.flatMap(c => [c.id, ...(c.views?.() ?? []).map(v => c.id + '.' + v.key)]);

/**
 * The icon of each block of the sheet a cell shows alone, in a narrow layout's menu of columns: its own, finer than its
 * rubric's (categories.js, the sheet's panes: the statuses and the look-alikes share a triangle there, the four
 * encyclopedias a W), and never a component's (the sheet's map is not the map, its photos not the photos' viewer) —
 * so that two columns of one block each are told apart at a glance. A block without one: its rubric's.
 * @type {Record<string, import('../core/icons.js').IconName>}
 */
const BLOCK_ICONS = {
  name: 'tag', names: 'translate', taxonomy: 'diagram-2', ids: 'hash', media: 'film', photos: 'image', gbifMedia: 'camera', status: 'shield',
  lookalikes: 'exclamation-triangle-fill', uses: 'basket', mine: 'collection', calendar: 'flower1', wikipedia: 'wikipedia', descriptions: 'quote',
  occurrences: 'globe-europe-africa', map: 'pin-map', interactions: 'bug', climate: 'cloud-sun', gbifProfile: 'tree', literature: 'journal-text',
  trefle: 'leaf', resources: 'link-45deg'
};

/** The icon of a component unknown (mistyped: « mpa »), in the menu: a question, unlike any block's. */
export const UNKNOWN_ICON = 'question-circle';

/**
 * A cell's icon (a narrow layout's menu of columns): its component's; one block of the sheet, the block's own
 * (BLOCK_ICONS); an unknown component, a question. @param {Resolved} r @returns {import('../core/icons.js').IconName}
 */
export const cellIcon = r => !r.known ? UNKNOWN_ICON : r.spec.id === 'plant' && r.view ? BLOCK_ICONS[r.view.key] ?? categoryOf(blockCategory(r.view.key)).icon : r.spec.icon;

/**
 * How a cell says it is shown, when it says so — its choices given another value than their default, in the
 * component's order: a presentation (plant(epure), results(grid), media(mosaic), map(base=photo)), a yes-or-no
 * (search(filters=1), search(list=0)) —: their French words, and a mark of a letter or two each that tells two cells of
 * one component apart at a glance. A presentation: the first letter of its words, two when another value of the
 * parameter starts with it (Épuré É, Standard St, Scientifique Sc; Liste L, Grille G); a yes: the first letter of the
 * parameter's words (Filtres ouverts F), a no: the same after a minus (sans liste des résultats −L). A distance is no
 * mark: the zone is the layout's, one for every cell (map(r=2km) only gives its default). null: as by default.
 * @param {Resolved} r @returns {{ label: string, short: string } | null}
 */
export function cellMark(r) {
  if (!r.known) return null;
  const first = (/** @type {string} */ s) => fold(s).charAt(0);
  const lower = (/** @type {string} */ s) => s.charAt(0).toLowerCase() + s.slice(1);
  // Not the frame's (its head, its links: said in the cell itself, never a mark), nor what the cell's own controls set.
  const marks = Object.entries(r.spec.params).filter(([k, p]) => !p.frame && !p.own && p.kind !== 'distance' && p.kind !== 'text' && r.given.has(k) && !same(r.params[k], defaultOf(p, r.params)) && !asIntent(r, k)).map(([k, p]) => {
    const letter = p.mark ?? p.label.charAt(0).toUpperCase();
    if (p.kind === 'bool') return r.params[k] ? { label: lower(p.label), short: letter } : { label: 'sans ' + lower(p.label), short: '−' + letter };
    // A list: its words after the parameter's (« couches : ZNIEFF (types I et II), Natura 2000 »), the parameter's letter.
    if (p.kind === 'list') {
      const chosen = /** @type {string[]} */ (r.params[k]).map(v => p.values?.[v] ?? v);
      return { label: `${lower(p.label)} : ${chosen.length ? chosen.join(', ') : 'aucune'}`, short: letter };
    }
    const all = Object.values(p.values ?? {});
    const label = /** @type {string} */ (p.values?.[r.params[k]]);
    const shared = all.some(l => l !== label && first(l) === first(label));
    return { label, short: label.charAt(0).toUpperCase() + (shared ? label.charAt(1) : '') };
  });
  return marks.length ? { label: marks.map(m => m.label).join(', '), short: marks.map(m => m.short).join('') } : null;
}

/**
 * A cell's whole name, in the menu of columns (read, and shown on hover): its title — a block named as a component is
 * (« Carte », « Photos ») said as the sheet's: « Fiche › Carte » —, how it is shown after it (« Fiche (Épuré) »,
 * « Recherche (sans liste des résultats) »); an unknown component, its name as typed: « mpa (inconnu) ».
 * @param {Resolved} r @returns {string}
 */
export function cellName(r) {
  if (!r.known) return `${r.title} (inconnu)`;
  const mark = cellMark(r);
  const title = r.view && COMPONENTS.some(c => c.title === r.title) ? `${r.spec.title} › ${r.title}` : r.title;
  return title + (mark ? ` (${mark.label})` : '');
}

/**
 * @typedef {{ name: string, icon: import('../core/icons.js').IconName, mark: string | null }} MenuCell  a cell, in the menu of columns
 * @typedef {{ label: string, glyphs: { icon: import('../core/icons.js').IconName, mark: string | null }[], more: number, nth: number }} MenuItem
 */

/**
 * A narrow layout's menu of columns, as each item looks: the column's whole name (its cells' names: « Recherche ·
 * Filtres · Résultats »), its cells' icons with their marks — one alike shown once (two maps: one map), three at most
 * —, how many cells more than the icons shown (« +n »), and, the rare time two columns would still look alike (the
 * same three icons and « +n », what differs hidden past them), a number each (1, 2…) that tells them apart; 0: none.
 * @param {MenuCell[][]} columns @returns {MenuItem[]}
 */
export function menuLooks(columns) {
  const items = columns.map(cells => {
    const glyphs = cells.filter((c, i) => cells.findIndex(d => d.icon === c.icon && d.mark === c.mark) === i).slice(0, 3).map(c => ({ icon: c.icon, mark: c.mark }));
    return { label: cells.map(c => c.name).join(' · '), glyphs, more: cells.length - glyphs.length, nth: 0 };
  });
  const look = (/** @type {MenuItem} */ m) => m.glyphs.map(g => g.icon + (g.mark ? ':' + g.mark : '')).join(' ') + ' +' + m.more;
  for (const m of items) {
    const labels = [...new Set(items.filter(o => look(o) === look(m)).map(o => o.label))];
    if (labels.length > 1) m.nth = labels.indexOf(m.label) + 1;
  }
  return items;
}

/**
 * @typedef {'zone' | 'recherche' | 'periode' | 'plante'} LinkKey
 * @typedef {{ link: LinkKey, on: boolean, why: string, toggle: Record<string, unknown> | null }} Link
 *   `on`: the cell follows (and changes) that shared state; `toggle`: its settings detached or attached again (null:
 *   always so — said, never a switch); `why`: what it does, in French
 */

/** In a link's toggle: the current plant's number, put there by the layout (a plant cell fixed on it). */
export const CURRENT = 'courante';

/** The links, in their order, and their words. @type {Record<LinkKey, string>} */
export const LINKS = { zone: 'Zone', recherche: 'Recherche', periode: 'Période', plante: 'Plante' };

/**
 * How a cell is wired to the others — what of the layout's shared state it follows and changes (the zone, the
 * search, the period, the current plant), and the setting that detaches it from one, or attaches it again: the
 * builder's chips in each cell's head. A place to build in, an unknown component: none.
 * @param {Resolved} r @returns {Link[]}
 */
export function linksOf(r) {
  if (!r.known || r.spec.empty) return [];
  const p = r.params, id = r.spec.id;
  /** @type {Link[]} */
  const out = [];
  const add = (/** @type {LinkKey} */ link, /** @type {boolean} */ on, /** @type {string} */ why, /** @type {Record<string, unknown> | null} */ toggle = null) => out.push({ link, on, why, toggle });
  // The current plant: shown (a fixed one detaches it), chosen by a touch (toucher, ecrit).
  const chooses = (/** @type {string} */ what) => p.ecrit === false ? `Toucher ${what} ouvre sa fiche, sans changer la plante courante`
    : p.toucher === 'rien' ? `Toucher ${what} ne fait rien` : p.toucher === 'fiche' ? `Toucher ${what} ouvre sa fiche` : `Toucher ${what} en fait la plante courante`;
  if (id === 'map') {
    const zone = p.portee === 'zone';
    add('zone', zone, zone ? 'Montre la zone ; l’appui long, le rayon la déplacent' : `Montre ${p.portee === 'france' ? 'toute la France' : 'le monde'} (l’appui long y pose la zone)`,
      { portee: zone ? 'france' : null });
    add('recherche', p.suit !== false, p.suit !== false ? 'Ses points : les plantes que garde la recherche' : 'Ses points : toutes les plantes de la zone', { suit: p.suit === false ? null : false });
    add('periode', true, 'Ses points : ceux de la période de toutes les cases');
    add('plante', p.plante !== 'non', p.plante === 'non' ? 'La plante courante n’y est pas montrée' : 'La plante courante en grand ; toucher un point la choisit',
      { plante: p.plante === 'non' ? null : 'non' });
  } else if (id === 'place') {
    add('zone', true, 'Choisit la zone de toutes les cases');
  } else if (id === 'search' || id === 'filters') {
    add('recherche', true, 'La recherche de toutes les cases : ce qu’on y tape, ses filtres');
    add('zone', true, 'Ses plantes : celles de la zone');
    if (id === 'search') add('plante', p.ecrit !== false, chooses('une plante'), { ecrit: p.ecrit === false ? null : false });
  } else if (id === 'results') {
    add('recherche', true, 'Les plantes que garde la recherche');
    add('zone', p.zone !== false, p.zone !== false ? 'Ses plantes : celles de la zone' : 'Toute la France, quelle que soit la zone', { zone: p.zone === false ? null : false });
    add('periode', p.zone !== false, 'Celles de la zone pendant la période de toutes les cases');
    add('plante', p.ecrit !== false, chooses('une plante'), { ecrit: p.ecrit === false ? null : false });
  } else if (id === 'deck') {
    add('zone', true, 'Ses cartes : les plantes de la zone');
    add('recherche', true, 'Ses cartes : celles que garde la recherche');
    add('plante', p.ecrit !== false, p.ecrit !== false ? 'La carte du dessus est la plante courante' : 'Ses cartes vont leur chemin, sans changer la plante courante', { ecrit: p.ecrit === false ? null : false });
  } else {
    // A plant's sheet, one of its blocks, its photos: the current plant, or one of its own (fixed: plante=).
    const fixed = p.plante != null;
    // Attached again: the current plant followed; detached: the current one fixed (gf-layout.js puts its number for CURRENT).
    add('plante', !fixed, fixed ? 'Montre toujours sa plante fixée' : 'Montre la plante courante', { plante: fixed ? null : CURRENT });
  }
  return out;
}
