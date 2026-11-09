// @ts-check
// What a group's cells give it (« Écran sur mesure », gf-layout.js#defaults) until its address says otherwise: its
// radius (the first r= of a map or a zone cell, in reading order), its period (the first map's when= other than
// « toujours ») and the place it starts on (the first map's lieu=, else its « Autour de moi au départ ») — each acts on
// the whole group (registry.js `shared`: « pour tout le groupe » in the editor). Where two cells disagree, the first
// wins, and the edit strip says it; where the address says another radius, another period or has a zone of its own,
// said too, with the way to take the cell's (the address keeps writing r=: it is never rewritten behind one's back).
// The group's sources are no cell's: a map's src= is its own, a pin (map-cell.js). Pure, tested under Node
// (tests/unit/group-defaults.test.mjs).

import { fold } from '../core/fold.js';
import { metres } from '../core/distance.js';
import { distanceLabel } from './registry.js';

/**
 * @typedef {import('./registry.js').Resolved} Resolved
 * @typedef {{ path: string, n: number, title: string }} CellRef  a cell: its path ('0', '2.1'), its number in reading
 *   order (« case 2 »), its title
 * @typedef {'r' | 'when' | 'start'} GroupKey
 * @typedef {{ key: GroupKey, cells: CellRef[], values: unknown[] }} Conflict  the cells that say another value than the
 *   first (`cells[0]`, `values[0]`: the one that wins), each with its value
 * @typedef {{ radius: number | null, periode: string, start: string | null, from: Partial<Record<GroupKey, CellRef>>, conflicts: Conflict[] }} GroupDefaults
 *   `radius`: null when no cell says one (the state's DEFAULT_RADIUS); `start`: 'lieu:<words>', 'autour' or null;
 *   `from`: the cell each comes from
 * @typedef {{ key: string, text: string, take?: { label: string, patch: Record<string, unknown> } }} GroupNote  a line of the
 *   edit strip; `take`: its button, and the group's state patch it sets (state.js set, the address replaced)
 */

/** The periods' words (registry.js when). @type {Record<string, string>} */
const PERIODS = { toujours: 'Toujours', annee: 'Cette année', mois: 'Ce mois-ci' };

/** What each setting of the group is, in a cell (null: it says none). @type {Record<GroupKey, (r: Resolved) => unknown>} */
const SAID = {
  r: r => r.known && r.params.r != null ? r.params.r : null,
  when: r => r.known && r.spec.id === 'map' && r.params.when && r.params.when !== 'toujours' ? r.params.when : null,
  start: r => !r.known || r.spec.id !== 'map' ? null : r.params.lieu ? 'lieu:' + r.params.lieu : r.params.autour ? 'autour' : null
};

/**
 * What a group's cells give it, and where they disagree.
 * @param {(CellRef & { r: Resolved })[]} cells the group's, in reading order
 * @returns {GroupDefaults}
 */
export function groupDefaults(cells) {
  /** @type {Partial<Record<GroupKey, CellRef>>} */
  const from = {};
  /** @type {Partial<Record<GroupKey, unknown>>} */
  const value = {};
  /** @type {Conflict[]} */
  const conflicts = [];
  for (const key of /** @type {GroupKey[]} */ (['r', 'when', 'start'])) {
    const given = cells.flatMap(c => { const v = SAID[key](c.r); return v == null ? [] : [{ c, v }]; });
    if (!given.length) continue;
    const [first] = given;
    from[key] = ref(first.c);
    value[key] = first.v;
    const others = given.filter(x => x.v !== first.v);
    if (others.length) conflicts.push({ key, cells: [first, ...others].map(x => ref(x.c)), values: [first, ...others].map(x => x.v) });
  }
  return {
    radius: /** @type {number | null} */ (value.r ?? null),
    periode: /** @type {string} */ (value.when ?? 'toujours'),
    start: /** @type {string | null} */ (value.start ?? null),
    from, conflicts
  };
}

/** A cell as a reference (its path, number and title). @param {CellRef} c @returns {CellRef} */
const ref = c => ({ path: c.path, n: c.n, title: c.title });

/** A value in words: a radius (« 5 km »), a period (« « Ce mois-ci » »), a start (« « Mirabel » »). @param {GroupKey} key @param {unknown} v */
function valueWords(key, v) {
  if (key === 'r') return distanceLabel(/** @type {number} */ (v));
  if (key === 'when') return `« ${PERIODS[/** @type {string} */ (v)] ?? v} »`;
  const s = /** @type {string} */ (v);
  return `« ${s.startsWith('lieu:') ? s.slice(5) : 'Autour de moi'} »`;
}

/** French words joined: « a », « a et b », « a, b et c ». @param {string[]} words */
const joined = words => words.length > 1 ? words.slice(0, -1).join(', ') + ' et ' + words[words.length - 1] : words[0] ?? '';

/** What each setting is called in the strip. @type {Record<GroupKey, string>} */
const NAMES = { r: 'Rayon', when: 'Période', start: 'Lieu de départ' };

/**
 * Two cells that disagree, in words — the first wins: « Rayon du groupe A : 5 km (« Zone », case 1) l’emporte sur 2 km
 * (« Carte », case 2). »; a cell of the same title as the first's named by its number alone.
 * @param {Conflict} c @param {string} of « du groupe A », or '' (one group)
 */
function conflictWords(c, of) {
  const [win, ...rest] = c.cells.map((cell, i) => ({ cell, v: c.values[i] }));
  const where = (/** @type {CellRef} */ cell) => cell === win.cell || cell.title !== win.cell.title ? `« ${cell.title} », case ${cell.n}` : `case ${cell.n}`;
  const said = (/** @type {{ cell: CellRef, v: unknown }} */ x) => `${valueWords(c.key, x.v)} (${where(x.cell)})`;
  if (c.key === 'start') return `${NAMES.start}${of} : ${said(win)} ; ${joined(rest.map(said))} ${rest.length > 1 ? 'ne sont pas pris' : 'n’est pas pris'}.`;
  return `${NAMES[c.key]}${of} : ${said(win)} l’emporte sur ${joined(rest.map(said))}.`;
}

/**
 * Whether a zone's place seems to be the start's own (« Puy de Mirabel (Ménétrol) » for lieu=Mirabel): its name holds the
 * start's first word — a quick look only: a start found under another name (lieu=63100 → « Clermont-Ferrand ») is told
 * by where it is (groupNotes `startAt`). @param {string | null} place @param {string} lieu
 */
function namesStart(place, lieu) {
  const first = fold(lieu).split(' ').find(w => w.length > 2);
  return Boolean(place && first && ` ${fold(place)} `.includes(` ${first} `));
}

/** How near the address' zone is to its starting place's own for it to be that place (m): its at= has 5 decimals. */
const START_NEAR = 100;

/**
 * The starting place (its words) whose position the strip needs (groupNotes `startAt`): the group's address has a zone
 * whose name does not tell it is that place; null: none needed.
 * @param {GroupDefaults} d @param {{ at: unknown, place: string | null }} live
 */
export function startToFind(d, live) {
  const lieu = d.from.start && d.start?.startsWith('lieu:') ? d.start.slice(5) : null;
  return lieu && live.at && !namesStart(live.place, lieu) ? lieu : null;
}

/**
 * The lines the edit strip says of a group's settings (« Réglages du groupe »): its cells that disagree; then its
 * address against its cells — another radius (r=, written in use from the cell's, then the cell changed), another
 * period, a zone of its own that keeps its starting place from applying (neither named as it, nor where its words lead:
 * a reload, a shared link of the start's own zone says nothing) —, each with the way to take the cell's.
 * @param {GroupDefaults} d
 * @param {{ r: number | null, periode: string | null, at: [number, number] | null, place: string | null }} live the group's address
 * @param {{ letter?: string, zone?: string, startAt?: [number, number] | null }} [o] `letter`: the group's (A, B), ''
 *   with one group; `zone`: the address' zone in words (cell-kit.js scopeWords); `startAt`: where the starting place's
 *   words lead (startToFind: [lon, lat]; null: nowhere, not found; undefined: not known yet — said once known)
 * @returns {GroupNote[]}
 */
export function groupNotes(d, live, { letter = '', zone = '', startAt } = {}) {
  const of = letter ? ` du groupe ${letter}` : '';
  /** @type {GroupNote[]} */
  const out = d.conflicts.map(c => ({ key: 'conflict:' + c.key, text: conflictWords(c, of) }));
  const r = d.from.r, when = d.from.when, start = d.from.start;
  if (r && d.radius != null && live.r != null && live.r !== d.radius) {
    out.push({ key: 'address:r', text: `${NAMES.r}${of} : l’adresse dit ${distanceLabel(live.r)}, la case « ${r.title} » ${distanceLabel(d.radius)}.`,
      take: { label: 'Prendre celui de la case', patch: { r: d.radius } } });
  }
  if (when && live.periode && live.periode !== d.periode) {
    out.push({ key: 'address:when', text: `${NAMES.when}${of} : l’adresse dit ${valueWords('when', live.periode)}, la case « ${when.title} » ${valueWords('when', d.periode)}.`,
      take: { label: 'Prendre celle de la case', patch: { periode: null } } });
  }
  const lieu = start && d.start?.startsWith('lieu:') ? d.start.slice(5) : null;
  // A zone: the start's own when named as it, or where its words lead (being found: nothing said yet).
  const own = !live.at ? false : startAt === undefined || (startAt !== null && metres(live.at, startAt) <= START_NEAR);
  if (lieu && (live.at || live.place) && !namesStart(live.place, lieu) && !own) {
    out.push({ key: 'address:start', text: `Lieu${of} : l’adresse a sa zone (${zone}) ; le lieu de départ « ${lieu} » ne s’applique pas.`,
      take: { label: 'Prendre celui de la case', patch: { at: null, place: lieu, obs: null } } });
  }
  return out;
}
