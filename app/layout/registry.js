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

/**
 * @typedef {'distance' | 'enum' | 'bool'} ParamKind
 * @typedef {{ kind: ParamKind, label: string, def: unknown, values?: Record<string, string>, aliases?: Record<string, string>, words?: string[] }} ParamSpec
 *   `values`: an enum's canonical values and their French labels; `aliases`: other spellings of a value → canonical; `words`: other names of the parameter
 * @typedef {'scope' | 'query' | 'results' | 'plant' | 'obs'} StateKey
 * @typedef {{ key: string, title: string }} ViewSpec
 * @typedef {object} ComponentSpec
 * @property {string} id
 * @property {string} title
 * @property {import('../core/icons.js').IconName} icon
 * @property {string} about                   one sentence, for the editor and the README
 * @property {string[]} aliases               other names (French): folded, as typed
 * @property {Record<string, ParamSpec>} params
 * @property {string} [main]                 the parameter a bare value sets: map(20km) = map(r=20km)
 * @property {() => ViewSpec[]} [views]      its sub-views (plant: one block of the sheet)
 * @property {Record<string, string>} [viewAliases]   other names of a view (folded) → its key
 * @property {StateKey[]} reads
 * @property {StateKey[]} writes
 * @property {{ w: number, h: number }} min  the least room it works in (px)
 *
 * @typedef {{ known: true, spec: ComponentSpec, view: ViewSpec | null, params: Record<string, any>, given: Set<string>, problems: string[], title: string }
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
    params: {
      r: RADIUS,
      base: { kind: 'enum', label: 'Fond de carte', def: null, values: { photo: 'Photos aériennes', plan: 'Plan IGN' }, aliases: { photos: 'photo', ortho: 'photo', satellite: 'photo', ign: 'plan', carte: 'plan' }, words: ['fond', 'layer'] }
    },
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
    about: 'La fiche de la plante courante, entière (plant), ou une seule de ses rubriques (plant.wikipedia, plant.calendar…).',
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
  }
];

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
 * (map(plan): its background), else a yes-or-no one it names (search(filtres)), else the main one (to say why not).
 * @param {ComponentSpec} spec @param {string} value @returns {string | null}
 */
function bareParam(spec, value) {
  const fits = (/** @type {string} */ k) => readValue(spec.params[k], value) !== undefined;
  if (spec.main && fits(spec.main)) return spec.main;
  const other = Object.keys(spec.params).find(fits);
  if (other) return other;
  const named = paramOf(spec, value);
  return named && spec.params[named].kind === 'bool' ? named : spec.main ?? null;
}

/**
 * A value read for a parameter, canonical (enum: its value; bool: true / false; distance: metres). undefined: not one.
 * @param {ParamSpec} p @param {string} text @returns {unknown}
 */
export function readValue(p, text) {
  if (p.kind === 'distance') return parseDistance(text) ?? undefined;
  const k = key(text);
  if (p.kind === 'bool') return k in BOOL ? BOOL[/** @type {keyof typeof BOOL} */ (k)] === 'true' : undefined;
  const values = Object.keys(p.values ?? {});
  return values.find(v => key(v) === k) ?? (p.aliases?.[k] && values.includes(p.aliases[k]) ? p.aliases[k] : undefined);
}

/** A value as the address writes it. @param {ParamSpec} p @param {unknown} v */
export const valueText = (p, v) => p.kind === 'distance' ? distanceText(/** @type {number} */ (v)) : p.kind === 'bool' ? (v ? '1' : '0') : String(v);

/**
 * What a cell is: its component (or none: unknown, with the closest name), its view, its parameters with their
 * defaults, and what was wrong (said in French, never thrown).
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
      problems.push(spec.views ? `${spec.title} : rubrique inconnue « ${first} »${near ? ` (« ${near} » ?)` : ''} — la fiche entière est montrée.`
        : `${spec.title} n’a pas de rubrique « ${first} ».`);
    }
    if (view && rest.length) problems.push(`${spec.title} : « ${rest.join('.')} » ignoré, une rubrique se montre en entier.`);
  }
  for (const p of paramList) {
    const name = p.key === null ? bareParam(spec, p.value) : paramOf(spec, p.key);
    if (!name) {
      problems.push(p.key === null ? `${spec.title} : valeur « ${p.value} » sans nom de paramètre.` : `${spec.title} : paramètre inconnu « ${p.key} ».`);
      continue;
    }
    const ps = spec.params[name];
    // « search(filtres) »: a yes-or-no parameter named alone is on.
    const v = p.key === null && ps.kind === 'bool' && paramOf(spec, p.value) === name ? true : readValue(ps, p.value);
    if (v === undefined) {
      const expected = ps.kind === 'distance' ? 'une distance (500m, 2km)' : ps.kind === 'bool' ? 'oui ou non (1, 0)' : Object.keys(ps.values ?? {}).join(', ');
      problems.push(`${spec.title} : « ${p.value} » n’est pas une valeur de ${ps.label.toLowerCase()} (attendu : ${expected}).`);
      continue;
    }
    if (given.has(name)) problems.push(`${spec.title} : ${ps.label.toLowerCase()} donné deux fois, le dernier compte.`);
    params[name] = v;
    given.add(name);
  }
  const title = view ? view.title : spec.title;
  return { known: true, spec, view, params, given, problems, title };
}

/**
 * The cell as the address writes it: the component's id, its view's key, the parameters given (valid ones, in the
 * component's order, their canonical values), its share. An unknown component keeps its name as typed.
 * @param {import('./grammar.js').CellNode} cell @param {Resolved} [r] @returns {import('./grammar.js').CellNode}
 */
export function canonical(cell, r = resolve(cell)) {
  if (!r.known) return { t: 'cell', name: cell.name, view: cell.view, params: cell.params, size: cell.size };
  const params = Object.keys(r.spec.params).filter(k => r.given.has(k)).map(k => ({ key: k, value: valueText(r.spec.params[k], r.params[k]) }));
  return { t: 'cell', name: r.spec.id, view: r.view?.key ?? null, params, size: cell.size };
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
