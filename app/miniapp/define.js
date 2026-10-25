// @ts-check
// An activity's manifest (a mini-app, in the code: app/miniapps/<id>.js): what it is, the context it keeps, its
// columns, and the steps that build its screen one component at a time. defineMiniApp() checks it once, as it loads:
// a mistake in a manifest fails there, with its name and the step at fault, not later on a screen. Pure: tested under
// Node.
//
// What is whose (« Recommencer », see runtime.js#replay): an activity OWNS its context, its own state and layout
// (geoflora.app.<id>.*) and what its manifest lists in `owns` — the storage keys of its session (`keys`), and
// `reset()` for the rest of it (a deck's swipes kept by a core module); « Recommencer » empties exactly that, then
// starts again at its first step. What it only USES is the user's, and it never clears it: `shared` names it (Mes
// plantes, the favourites, the places, the settings), for the reader. Doing or leaving an activity changes nothing
// else in the app: no mode, no setting, no layout of the plant sheet — only a button that says so, pressed by the user.
//
// An app ported whole from before the mini-apps (`driven`): one component draws every screen, the start too, and
// says which step it is on (the event ma-step); the steps follow it rather than lead it. Its first step then adds
// that component instead of giving a start().
//
// The rules: an id of lowercase letters; the first step is the start (kind 'start'); step ids are unique; every step
// but the last says how it goes on (done, next or choose), to a step that exists; a step adds a component to a
// column of the manifest, or adds blocks to one already there (same id, no `use`); along any path through the steps
// the same component, or the same block of it, is never added twice, and only one added before is dropped.

import { config } from '../config.js';
import { MODULES } from '../core/modules.js';

/** The app's storage keys (a manifest's `owns.keys` are among them, or under its prefix). */
const KEYS = new Set(Object.values(config.storageKeys));

/**
 * @typedef {{ init: unknown, persist?: boolean, min?: number, max?: number }} ContextKey
 * @typedef {{ id: string, base: number | 'fill', min: number, max?: number, rank: number, mergeInto?: string, heavy?: boolean, title?: string }} Column
 * @typedef {'top' | 'main' | 'tab' | 'sheet' | 'hide'} PhonePlace
 * @typedef {{ id: string, use?: string, col?: string, below?: string, tabWith?: string, blocks?: string[],
 *   phone?: PhonePlace, title?: string, props?: Record<string, unknown>, when?: (c: any) => boolean }} Place   `when`: on screen
 *   only while it says so, from the context (Rencontres' list, not in a game begun in its guided way)
 * @typedef {{ label: string, icon?: string, to: string }} Choice
 * @typedef {{ id: string, label: string, about?: string, kind?: 'start' | 'grid' | 'screen',
 *   start?: (c: any, app: any) => import('../components/start-screen.js').StartSpec,
 *   add?: Place[], drop?: string[], next?: string, choose?: Choice[], done?: (c: any) => boolean, can?: (c: any) => boolean,
 *   action?: { label: string, run: (app: any) => void } }} Step
 * @typedef {{ label: string, confirm?: (c: any) => string | null }} Exit
 * @typedef {{ key: (c: any) => unknown, load: (app: any, key: any, signal: AbortSignal) => Promise<unknown>, debounce?: number, into: string }} DataSpec
 * @typedef {{ run: (app: any, ...args: any[]) => unknown, mode?: 'exclusive' | 'parallel' }} ActionSpec
 *
 * @typedef {object} Manifest
 * @property {string} id
 * @property {string} title
 * @property {string} icon
 * @property {string} [pitch]
 * @property {string} [scene]
 * @property {import('../core/modules.js').ModuleKey[]} uses     online modules it needs: checked as it starts
 * @property {Exit} exit
 * @property {Record<string, ContextKey>} context
 * @property {Record<string, (c: any) => unknown>} derive         pure, memoized on what they read
 * @property {Record<string, DataSpec>} data
 * @property {Record<string, ActionSpec>} actions
 * @property {Column[]} columns
 * @property {{ rows: [string, string][] }} phone                 the columns under one another on a phone, with their height
 * @property {Step[]} steps
 * @property {string} [full]                                      the step shown at once when the steps bar is off
 * @property {{ default: (c: any, s: any) => string }} [fork]
 * @property {number} version
 * @property {boolean} [driven]                                   its component leads its steps (see above)
 * @property {(c: any, app: any) => boolean} [ownBar]             its component shows a steps bar of its own now: the box's is left out
 * @property {(c: any) => string | null} [resumeAt]              the step its address opens when it names none (a game under way), else the start
 * @property {{ simple?: boolean }} [plantSheet]   the plant of its address over a start screen, as the box shows it
 *   (kit/ma-plant-sheet.js): `simple`, its « Médias » and « L'essentiel » only
 * @property {{ keys?: string[], reset?: () => unknown, made?: { label: string, kept: [string, string] }, label?: string }} owns     the session
 *   data it owns, emptied by « Recommencer »; `made`: what it calls a collection it makes in Mes plantes, still its own
 *   (« le parcours en cours »), and those the user made their own, kept (one, many — {n} the count); `label`: its
 *   session in words, as « Recommencer » says it goes (a game: « la partie en cours »; none: « l’activité en cours »)
 * @property {string[]} shared                                    the user's data it uses and never clears (said, not enforced)
 * @property {(data: any, from: number) => any} [migrate]
 */

/** Ids of activities, steps, columns and components: what an address carries (router.js). */
export const ID = /^[a-z][a-z0-9-]{1,23}$/;
const PHONE = ['top', 'main', 'tab', 'sheet', 'hide'];
const KINDS = ['start', 'grid', 'screen'];

/** A mistake in a manifest. */
export class ManifestError extends Error {
  /** @param {string} app @param {string} message */
  constructor(app, message) {
    super(`mini-app ${app}: ${message}`);
    this.name = 'ManifestError';
  }
}

const isFn = (/** @type {unknown} */ f) => typeof f === 'function';
const isObj = (/** @type {unknown} */ o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const isNum = (/** @type {unknown} */ n) => typeof n === 'number' && Number.isFinite(n);

/**
 * The steps that may follow `step`: its next, its choices, else (done alone) the one after it in the list.
 * @param {Manifest} m @param {Step} step @returns {string[]}
 */
export function followers(m, step) {
  if (step.next) return [step.next];
  if (step.choose?.length) return step.choose.map(c => c.to);
  const i = m.steps.indexOf(step);
  return step.done && i >= 0 && i < m.steps.length - 1 ? [m.steps[i + 1].id] : [];
}

/**
 * Every path from the start to a step with no follower (each one a list of step ids). A loop is a mistake.
 * @param {Manifest} m @returns {string[][]}
 */
export function paths(m) {
  const byId = new Map(m.steps.map(s => [s.id, s]));
  /** @type {string[][]} */
  const out = [];
  /** @param {string[]} path */
  const walk = path => {
    const step = /** @type {Step} */ (byId.get(path[path.length - 1]));
    const next = followers(m, step);
    if (!next.length) { out.push(path); return; }
    for (const id of next) {
      if (path.includes(id)) throw new ManifestError(m.id, `steps loop back to « ${id} » (${[...path, id].join(' › ')})`);
      walk([...path, id]);
    }
  };
  walk([m.steps[0].id]);
  return out;
}

/**
 * Checks a manifest and returns it frozen, with its defaults (no modules, empty context…).
 * @param {Partial<Manifest> & { id: string, title: string, steps: Step[], columns: Column[], exit: Exit }} spec @returns {Readonly<Manifest>}
 */
export function defineMiniApp(spec) {
  const id = String(spec?.id ?? '?');
  const fail = (/** @type {string} */ message) => { throw new ManifestError(id, message); };
  if (!ID.test(id)) fail('id must be 2 to 24 lowercase letters, digits or « - », starting with a letter');
  if (typeof spec.title !== 'string' || !spec.title.trim()) fail('a title is needed');
  if (typeof spec.icon !== 'string' || !spec.icon) fail('an icon is needed');

  /** @type {Manifest} */
  const m = {
    uses: [], context: {}, derive: {}, data: {}, actions: {}, phone: { rows: [] }, version: 1, owns: {}, shared: [],
    ...spec, icon: /** @type {string} */ (spec.icon)
  };

  const known = new Set(MODULES.map(x => x.key));
  if (!Array.isArray(m.uses)) fail('uses must be a list of modules');
  for (const u of m.uses) if (!known.has(u)) fail(`uses: unknown module « ${u} »`);
  if (!isObj(m.exit) || typeof m.exit.label !== 'string' || !m.exit.label) fail('exit needs a label (« Quitter … »)');
  if (m.exit.confirm !== undefined && !isFn(m.exit.confirm)) fail('exit.confirm must be a function');
  if (!Number.isInteger(m.version) || m.version < 1) fail('version must be a whole number from 1');
  if (!isObj(m.owns)) fail('owns must be an object: { keys?, reset? }');
  const appKey = (/** @type {unknown} */ k) => typeof k === 'string' && (KEYS.has(k) || k.startsWith(config.storageKeys.appPrefix));
  if (m.owns.keys !== undefined && (!Array.isArray(m.owns.keys) || !m.owns.keys.every(appKey))) fail('owns.keys: storage keys of the app (config.storageKeys, or geoflora.app.…)');
  if (m.owns.reset !== undefined && !isFn(m.owns.reset)) fail('owns.reset must be a function');
  if (m.owns.made !== undefined && (typeof m.owns.made?.label !== 'string' || !Array.isArray(m.owns.made.kept) || m.owns.made.kept.length !== 2)) fail('owns.made: { label, kept: [one, many] }');
  if (m.owns.label !== undefined && (typeof m.owns.label !== 'string' || !m.owns.label.trim())) fail('owns.label: its session in words (« la partie en cours »)');
  if (m.plantSheet !== undefined && (!isObj(m.plantSheet) || (m.plantSheet.simple !== undefined && typeof m.plantSheet.simple !== 'boolean'))) fail('plantSheet: { simple?: boolean }');
  if (!Array.isArray(m.shared) || m.shared.some(x => typeof x !== 'string')) fail('shared must be a list of what it uses of the user\'s');

  // The context and what is derived from it: one name each.
  if (!isObj(m.context)) fail('context must be an object');
  for (const [key, c] of Object.entries(m.context)) {
    if (!isObj(c) || !('init' in c)) fail(`context.${key} needs an init value`);
    if ((c.min !== undefined && !isNum(c.min)) || (c.max !== undefined && !isNum(c.max))) fail(`context.${key}: min and max are numbers`);
  }
  if (!isObj(m.derive)) fail('derive must be an object');
  for (const [key, f] of Object.entries(m.derive)) {
    if (!isFn(f)) fail(`derive.${key} must be a function`);
    if (key in m.context) fail(`« ${key} » is both in context and derive`);
  }
  if (!isObj(m.data)) fail('data must be an object');
  for (const [key, d] of Object.entries(m.data)) {
    if (!isObj(d) || !isFn(d.key) || !isFn(d.load)) fail(`data.${key} needs key() and load()`);
    if (!(d.into in m.context)) fail(`data.${key}: into « ${d.into} » is not a context key`);
    if (d.debounce !== undefined && !(isNum(d.debounce) && d.debounce >= 0)) fail(`data.${key}: debounce is in milliseconds`);
  }
  if (!isObj(m.actions)) fail('actions must be an object');
  for (const [key, a] of Object.entries(m.actions)) {
    if (!isObj(a) || !isFn(a.run)) fail(`actions.${key} needs run()`);
    if (a.mode !== undefined && !['exclusive', 'parallel'].includes(a.mode)) fail(`actions.${key}: mode is exclusive or parallel`);
  }

  // Columns: widths in px or 'fill' (one at most), merged in turn into another as room runs out.
  if (!Array.isArray(m.columns) || !m.columns.length) fail('at least one column is needed');
  const cols = new Map();
  for (const c of m.columns) {
    if (!isObj(c) || !ID.test(c.id ?? '')) fail(`column « ${c?.id} »: bad id`);
    if (cols.has(c.id)) fail(`column « ${c.id} » twice`);
    cols.set(c.id, c);
    if (c.base !== 'fill' && !(isNum(c.base) && c.base > 0)) fail(`column ${c.id}: base is a width in px or 'fill'`);
    if (!(isNum(c.min) && c.min > 0)) fail(`column ${c.id}: min is a width in px`);
    if (c.max !== undefined && !(isNum(c.max) && c.max >= c.min)) fail(`column ${c.id}: max is a width not under min`);
    if (typeof c.base === 'number' && (c.base < c.min || (c.max !== undefined && c.base > c.max))) fail(`column ${c.id}: base outside min…max`);
    if (!isNum(c.rank)) fail(`column ${c.id}: a rank is needed (the lowest merges first)`);
  }
  if (m.columns.filter(c => c.base === 'fill').length > 1) fail('one column at most fills the room left');
  for (const c of m.columns) {
    if (c.mergeInto === undefined) continue;
    if (c.mergeInto === c.id || !cols.has(c.mergeInto)) fail(`column ${c.id}: mergeInto « ${c.mergeInto} » is not another column`);
    const seen = new Set([c.id]);
    for (let t = cols.get(c.mergeInto); t; t = t.mergeInto ? cols.get(t.mergeInto) : null) {
      if (seen.has(t.id)) fail(`columns merge into one another in a loop (${[...seen, t.id].join(' › ')})`);
      seen.add(t.id);
    }
  }
  if (!isObj(m.phone) || !Array.isArray(m.phone.rows)) fail('phone.rows must be a list of [column, height]');
  for (const row of m.phone.rows) {
    if (!Array.isArray(row) || row.length !== 2 || typeof row[1] !== 'string') fail('phone.rows: each row is [column, height]');
    if (!cols.has(String(row[0]).split(':')[0])) fail(`phone.rows: « ${row[0]} » is not a column`);
  }

  // Steps.
  if (!Array.isArray(m.steps) || !m.steps.length) fail('at least one step is needed');
  const steps = new Map();
  m.steps.forEach((s, i) => {
    if (!isObj(s) || !ID.test(s.id ?? '')) fail(`step « ${s?.id} »: bad id`);
    if (steps.has(s.id)) fail(`step « ${s.id} » twice`);
    steps.set(s.id, s);
    if (typeof s.label !== 'string' || !s.label) fail(`step ${s.id}: a label is needed`);
    const kind = s.kind ?? 'grid';
    if (!KINDS.includes(kind)) fail(`step ${s.id}: kind is start, grid or screen`);
    if ((i === 0) !== (kind === 'start')) fail(i === 0 ? 'the first step is the start (kind: \'start\')' : `step ${s.id}: only the first step is the start`);
    // Ported whole (driven): its component, added at the start, draws the start screen.
    const drawn = m.driven && kind === 'start';
    if (drawn && !s.add?.length) fail(`step ${s.id}: a driven app's start adds the component that draws it`);
    if (!drawn && (kind === 'start' || kind === 'screen') && !isFn(s.start)) fail(`step ${s.id}: start() gives its screen`);
    if (!drawn && kind !== 'grid' && (s.add?.length || s.drop?.length)) fail(`step ${s.id}: a ${kind} step has no grid to add to`);
    for (const f of ['done', 'can']) if (s[f] !== undefined && !isFn(s[f])) fail(`step ${s.id}: ${f} must be a function`);
    if (s.choose !== undefined && (!Array.isArray(s.choose) || !s.choose.length || s.choose.some(c => !c?.label || !c?.to))) fail(`step ${s.id}: choose is a list of { label, to }`);
    if (s.next && s.choose) fail(`step ${s.id}: next or choose, not both`);
    if (i < m.steps.length - 1 && !s.done && !s.next && !s.choose) fail(`step ${s.id}: says how it goes on (done, next or choose)`);
    for (const p of s.add ?? []) {
      if (!isObj(p) || !ID.test(p.id ?? '')) fail(`step ${s.id}: a component with a bad id`);
      if (p.use !== undefined && (typeof p.use !== 'string' || !cols.has(p.col))) fail(`step ${s.id}: component ${p.id} needs a column of the manifest`);
      if (p.use === undefined && (p.col !== undefined || !p.blocks?.length)) fail(`step ${s.id}: component ${p.id} without use only adds blocks`);
      if (p.phone !== undefined && !PHONE.includes(p.phone)) fail(`step ${s.id}: component ${p.id}: phone is one of ${PHONE.join(', ')}`);
      if (p.blocks !== undefined && (!Array.isArray(p.blocks) || p.blocks.some(b => typeof b !== 'string'))) fail(`step ${s.id}: component ${p.id}: blocks is a list of block keys`);
    }
  });
  for (const s of m.steps) {
    for (const to of [s.next, ...(s.choose ?? []).map(c => c.to)]) if (to !== undefined && !steps.has(to)) fail(`step ${s.id}: no step « ${to} »`);
    if (s.next === s.id) fail(`step ${s.id}: goes on to itself`);
  }
  if (m.full !== undefined && !steps.has(m.full)) fail(`full: no step « ${m.full} »`);
  if (m.fork !== undefined && !isFn(m.fork?.default)) fail('fork.default must be a function');
  if (m.ownBar !== undefined && !isFn(m.ownBar)) fail('ownBar must be a function');
  if (m.resumeAt !== undefined && !isFn(m.resumeAt)) fail('resumeAt must be a function');

  // Along every path: a component, or a block of it, added once; a drop only of one there.
  for (const path of paths(m)) {
    /** @type {Map<string, Set<string>>} */
    const shown = new Map();
    for (const sid of path) {
      const s = steps.get(sid);
      for (const p of s.add ?? []) {
        const blocks = shown.get(p.id);
        if (p.use !== undefined && blocks) fail(`step ${sid}: component ${p.id} is already there (${path.join(' › ')})`);
        if (p.use === undefined && !blocks) fail(`step ${sid}: component ${p.id} gets blocks before it is added (${path.join(' › ')})`);
        const mine = blocks ?? new Set();
        for (const b of p.blocks ?? []) {
          if (mine.has(b)) fail(`step ${sid}: block ${b} of ${p.id} is already there (${path.join(' › ')})`);
          mine.add(b);
        }
        shown.set(p.id, mine);
      }
      for (const d of s.drop ?? []) {
        if (!shown.has(d)) fail(`step ${sid}: drops ${d}, not there (${path.join(' › ')})`);
        shown.delete(d);
      }
    }
  }
  return Object.freeze(m);
}

/**
 * What the kit lacks for a manifest (empty: nothing): a component it does not have, or a context key a component
 * reads that the manifest neither declares nor derives. Checked as it loads, against app/miniapp/kit.js (which
 * renders, so is not imported here). @param {Manifest} m @param {Record<string, { reads: string[] }>} kit @returns {string[]}
 */
export function kitProblems(m, kit) {
  const names = new Set([...Object.keys(m.context), ...Object.keys(m.derive)]);
  const uses = new Set(m.steps.flatMap(s => (s.add ?? []).map(p => p.use)).filter(u => u !== undefined));
  return [...uses].flatMap(u => !kit[u] ? [`no component « ${u} » in the kit`]
    : kit[u].reads.filter(r => !names.has(r)).map(r => `component « ${u} » reads « ${r} », not in context nor derive`));
}
