// @ts-check
// A mini-app running: its context, the path of steps walked, its actions and data, and what it keeps on this
// device. The box (gf-miniapp.js) renders it and keeps the address in step; the components (kit.js) get it as `app`
// and only write through it: app.set(patch), app.do(action, …args), app.go(step), app.exit(). Nothing here renders
// or navigates: pure enough to be tested under Node.
//  - The path: the start first, then each step reached; going to a step already on it goes back to it (what was
//    added after it goes away), to one that follows the last goes on, to another one takes the shortest way there.
//    A step whose can(c) is false is not entered.
//  - With the steps bar (guided): a step whose done(c) comes true goes on to the next by itself. Without it, the
//    start leads straight to m.full. The bar is the setting of all (Réglages › Premiers pas), unless the mini-app's
//    ⋯ menu chose for it alone (`ownSteps`, kept with its game).
//  - Kept under geoflora.app.<id>.state: { v, path, ctx (the persist keys), finished, ownSteps? }, written 300 ms
//    after a change. The start is always shown first; the path kept is offered as « Reprendre ».
//  - Events: 'change' (anything to render again), 'navigate' (detail { step, replace? }: a step reached, for the
//    address), 'exit' (the way out asked), 'scenarios' (the launcher asked for, over the app), 'seen' (detail: a
//    plant's id — a card swiped, a plant noted, a new plant opened or chosen, the context's `focus`: the box counts it
//    for the first steps of the app), 'dispose' (the box gone: a component's game stops its requests and timers).

import { config } from '../config.js';
import { MODULES, moduleOn } from '../core/modules.js';
import { readJSON, writeJSON } from '../core/prefs.js';
import { publish } from '../core/sync.js';
import { createContext } from './context.js';
import { followers } from './define.js';
import { layoutAt } from './layout.js';

/**
 * @typedef {import('./define.js').Manifest} Manifest
 * @typedef {import('./define.js').Step} Step
 * @typedef {import('../core/store.js').ShowSteps} ShowSteps
 * @typedef {'on' | 'off'} OwnSteps   the steps bar, as this mini-app's ⋯ menu chose it
 * @typedef {{ v: number, path: string[], ctx: Record<string, unknown>, finished: boolean, ownSteps?: OwnSteps }} Saved
 */

/** Storage key of a mini-app's state, or of its layout. @param {string} id @param {'state' | 'layout'} part */
export const storageKey = (id, part) => config.storageKeys.appPrefix + id + '.' + part;

/**
 * What « Rejouer » / « Recommencer » will delete, said in its confirmation — the favourites its matches added, each
 * collection it made in Mes plantes still its own (« le parcours en cours (4 plantes) »), the game — and what it keeps
 * of what came from it (the user's own: a parcours finished, a favourite put in a collection). Pure.
 * @param {Manifest} m @param {import('../core/place-model.js').Made} made @returns {{ gone: string[], kept: string[] }}
 */
export function replayItems(m, made) {
  const s = (/** @type {number} */ n) => n > 1 ? 's' : '';
  const n = made.favorites.length;
  const label = m.owns.made?.label ?? 'la collection';
  const count = (/** @type {[string, string]} */ [one, many], /** @type {number} */ k) => (k > 1 ? many : one).replace('{n}', String(k));
  return {
    gone: [
      ...(n ? [`${n} favori${s(n)} ajouté${s(n)} par ${m.title}`] : []),
      ...made.collections.map(c => `${label}${c.name ? ` « ${c.name} »` : ''} (${c.plants} plante${s(c.plants)})`),
      'la partie en cours'
    ],
    kept: [
      ...(made.kept.collections && m.owns.made ? [count(m.owns.made.kept, made.kept.collections)] : []),
      ...(made.kept.favorites ? [count(['Votre favori venu de cette partie, rangé ou annoté depuis, est conservé.', 'Vos {n} favoris venus de cette partie, rangés ou annotés depuis, sont conservés.'], made.kept.favorites)] : [])
    ]
  };
}

/**
 * « Recommencer » from the list of the ways to play, the mini-app not on screen: what it owns emptied as its
 * « Rejouer » does (here and in the other tabs), nothing left behind. @param {Manifest} m
 */
export async function replayApp(m) {
  const app = new MiniApp(m);
  await app.replay();
  app.dispose();
}

/**
 * The steps bar shown? The mini-app's own choice (`own`, its ⋯ menu), else the setting of all: 'on' always; 'off'
 * never; 'auto' until the mini-app was finished once.
 * @param {ShowSteps} showSteps @param {boolean} finished @param {OwnSteps | null} [own]
 */
export const guided = (showSteps, finished, own = null) => own ? own === 'on' : showSteps === 'on' || (showSteps === 'auto' && !finished);

/**
 * The path that reaches `target` from `path`: back to it, one step on, or the shortest way from the start; null
 * when there is none, or `target` may not be entered now (its can).
 * @param {Manifest} m @param {string[]} path @param {string} target @param {Record<string, any>} c @returns {string[] | null}
 */
export function pathTo(m, path, target, c) {
  const steps = new Map(m.steps.map(s => [s.id, s]));
  if (!steps.has(target)) return null;
  let next = null;
  const at = path.indexOf(target);
  if (at >= 0) next = path.slice(0, at + 1);
  else if (path.length && followers(m, /** @type {Step} */ (steps.get(path[path.length - 1]))).includes(target)) next = [...path, target];
  else {
    // Breadth first from the start: the shortest way.
    /** @type {string[][]} */
    const queue = [[m.steps[0].id]];
    while (queue.length && !next) {
      const p = /** @type {string[]} */ (queue.shift());
      if (p[p.length - 1] === target) { next = p; break; }
      for (const f of followers(m, /** @type {Step} */ (steps.get(p[p.length - 1])))) if (!p.includes(f)) queue.push([...p, f]);
    }
  }
  if (!next) return null;
  // The step reached may be entered now (the ones passed through on the way are not on screen: a recap after a walk
  // ended is reached through the walk, which can no longer be entered itself).
  const s = steps.get(target);
  return !s?.can || s.can(c) ? next : null;
}

export class MiniApp extends EventTarget {
  /** @param {Manifest} m @param {{ showSteps?: ShowSteps, saved?: Saved | null }} [opts] */
  constructor(m, opts = {}) {
    super();
    this.m = m;
    this.showSteps = opts.showSteps ?? 'auto';
    let saved = opts.saved === undefined ? readJSON(storageKey(m.id, 'state'), null) : opts.saved;
    if (saved && saved.v !== m.version) saved = m.migrate ? m.migrate(saved, saved.v) : null;
    /** The path kept from the last visit, offered as « Reprendre ». @type {string[]} */
    this.savedPath = Array.isArray(saved?.path) ? saved.path.filter((/** @type {unknown} */ s) => typeof s === 'string') : [];
    this.finished = saved?.finished === true;
    /** The steps bar as its ⋯ menu chose it, for it alone (null: the setting of all). @type {OwnSteps | null} */
    this.ownSteps = saved?.ownSteps === 'on' || saved?.ownSteps === 'off' ? saved.ownSteps : null;
    /** @type {string[]} */
    this.path = [m.steps[0].id];
    /** The last action or data load that failed, said on screen. @type {string | null} */
    this.error = null;
    /** @type {Map<string, AbortController>} */
    this.running = new Map();
    this.ctx = createContext(m.context, m.derive, saved?.ctx ?? null);
    /** Data loads: the last key asked, its timer and its request. @type {Map<string, { key: string, timer: any, abort: AbortController | null }>} */
    this.loads = new Map();
    /** @type {any} */
    this.saveTimer = 0;
    /** How many times it was emptied (« Rejouer »): the box draws its components anew each time. */
    this.generation = 0;
    /** The display mode of a plant sheet in it (kept by the box in step with the app's). */
    this.view = 'standard';
    /** The last plant opened or chosen (the context's `focus`) said `seen`: the one kept with the game already was. */
    this.#focusSeen = this.c.focus ?? null;
    this.ctx.subscribe(() => this.#changed());
    this.#load();
  }

  /** The context, as it is now (with what is derived). */
  get c() { return this.ctx.get(); }

  /** The step on screen. @returns {Step} */
  get step() {
    const id = this.path[this.path.length - 1];
    return /** @type {Step} */ (this.m.steps.find(s => s.id === id));
  }

  /** The steps bar shown. */
  get guided() { return guided(this.showSteps, this.finished, this.ownSteps); }

  /**
   * « Afficher / Masquer les étapes » of its ⋯ menu: for this mini-app alone, kept with its game (« Rejouer » forgets
   * it) — never the setting of all. The same as that setting gives: no choice of its own. @param {boolean} on
   */
  setOwnSteps(on) {
    this.ownSteps = null;
    if (this.guided !== on) this.ownSteps = on ? 'on' : 'off';
    this.#save();
    this.#emit('change');
  }

  /** A plant seen in it (a card swiped, a plant noted in a walk): told to the box. @param {number} id */
  seen(id) { this.#emit('seen', id); }

  /** What the steps walked have put on the screen (a place's `when` reads the context). */
  get layout() { return layoutAt(this.m, this.path, this.c); }

  /** @param {Record<string, unknown>} patch */
  set(patch) { this.ctx.set(patch); }

  /** An action of the manifest; an exclusive one running takes no second call. @param {string} name @param {...unknown} args */
  async do(name, ...args) {
    const spec = this.m.actions[name];
    if (!spec) throw new Error(`mini-app ${this.m.id}: no action ${name}`);
    if ((spec.mode ?? 'exclusive') === 'exclusive' && this.running.has(name)) return undefined;
    const abort = new AbortController();
    this.running.set(name, abort);
    this.error = null;
    this.#emit('change');
    try {
      return await spec.run(this, ...args);
    } catch (e) {
      if (!abort.signal.aborted) { this.error = e instanceof Error ? e.message : String(e); console.warn(e); }
      return undefined;
    } finally {
      if (this.running.get(name) === abort) this.running.delete(name);
      this.#emit('change');
    }
  }

  /** An action running. @param {string} name */
  busy(name) { return this.running.has(name); }

  /** Its signal, for an action to stop when cancelled. @param {string} name */
  signal(name) { return this.running.get(name)?.signal ?? AbortSignal.abort(); }

  /** Stops an action running (« Annuler »). @param {string} name */
  cancel(name) {
    this.running.get(name)?.abort();
    this.running.delete(name);
    this.#emit('change');
  }

  /**
   * To a step: back, on, or the shortest way; without the steps bar, past the start straight to m.full. False when
   * it may not be entered now. @param {string} target
   */
  go(target) {
    let to = target;
    if (!this.guided && this.m.full && this.path.length === 1 && target !== this.path[0]) to = this.m.full;
    const path = pathTo(this.m, this.path, to, this.c) ?? (to !== target ? pathTo(this.m, this.path, target, this.c) : null);
    if (!path) return false;
    this.#walk(path);
    this.#emit('navigate', { step: this.step.id });
    return true;
  }

  /**
   * The step of an address (Back, Forward, a link): the path to it, without a new address. False when it may not
   * be entered (the box goes to the start). @param {string | null} target
   */
  follow(target) {
    const path = pathTo(this.m, this.path, target ?? this.m.steps[0].id, this.c);
    if (!path) return false;
    if (path.join() !== this.path.join()) this.#walk(path);
    return true;
  }

  /** « Reprendre »: the path of the last visit, when it may still be walked. @returns {{ label: string, run: () => void } | null} */
  resume() {
    const last = this.savedPath[this.savedPath.length - 1];
    if (this.savedPath.length < 2 || !pathTo(this.m, [this.m.steps[0].id], last, this.c)) return null;
    const step = this.m.steps.find(s => s.id === last);
    return { label: 'Reprendre : ' + (step?.label ?? last), run: () => { this.go(last); } };
  }

  /**
   * « Rejouer » (confirmed by the box): what the mini-app owns emptied — its own state, the keys listed in owns.keys,
   * owns.reset() for the rest — and back to its first step. Never what it only uses (manifest `shared`). The other
   * tabs are told (core/sync.js): theirs is emptied too.
   */
  async replay(remote = false) {
    await this.m.owns.reset?.();
    for (const key of [...(this.m.owns.keys ?? []), storageKey(this.m.id, 'state'), storageKey(this.m.id, 'layout')]) {
      writeJSON(key, null);
    }
    this.cleared();
    // Told once, by the tab where it was asked (the others empty theirs the same way: it is the same each time).
    if (!remote) publish('miniapp', { id: this.m.id, op: 'replay' });
  }

  /**
   * Emptied in memory (« Rejouer » here or in another tab): the first step, the context as it starts, nothing to
   * take up again; `generation` counts it (the box draws its components anew, from what is stored now).
   */
  cleared() {
    for (const l of this.loads.values()) { clearTimeout(l.timer); l.abort?.abort(); }
    this.loads.clear();
    for (const a of this.running.values()) a.abort();
    this.running.clear();
    this.savedPath = [];
    this.finished = false;
    this.ownSteps = null;
    this.error = null;
    this.path = [this.m.steps[0].id];
    this.generation++;
    this.ctx.set(Object.fromEntries(Object.entries(this.m.context).map(([k, s]) => [k, s.init])));
    this.#load();
    this.#save();
    this.#emit('change');
    this.#emit('navigate', { step: this.path[0], replace: true });
  }

  /**
   * A driven app's component says where it is (ma-step): its step, on the path as the steps bar shows it (no new
   * address: Back leaves the app, as before). False for a step the manifest does not have. @param {string} step
   */
  reached(step) {
    if (!this.m.steps.some(s => s.id === step)) return false;
    const at = this.m.steps.findIndex(s => s.id === step);
    const path = this.m.steps.slice(0, at + 1).map(s => s.id);
    if (path.join() !== this.path.join()) this.#walk(path);
    return true;
  }

  /** The way out asked (the box asks for confirmation if the manifest wants it). */
  exit() { this.#emit('exit'); }

  /** Something it shows changed outside its context (a component's game): drawn again (the box, its start screen). */
  refresh() { this.#emit('change'); }

  /** The launcher asked for (« Quitter … : autres scénarios »): the box opens it over the app. */
  scenarios() { this.#emit('scenarios'); }

  /** A module it needs switched off (its name), else null: checked at the start. */
  blocked() {
    const off = this.m.uses.find(u => !moduleOn(u));
    return off ? MODULES.find(x => x.key === off)?.name ?? off : null;
  }

  /**
   * The screen of a start or screen step, from its manifest: with the exit of the manifest unless the step gives its
   * own (« Quitter … : autres scénarios »), and, a module it needs switched off, that said in place of an error, the
   * action disabled.
   * @param {Step} step @returns {import('../components/start-screen.js').StartSpec}
   */
  startSpec(step) {
    const spec = /** @type {NonNullable<Step['start']>} */ (step.start)(this.c, this);
    const off = this.blocked();
    return {
      ...spec,
      error: off ? `« ${off} » est désactivé dans Réglages › Modules : ${this.m.title} en a besoin.` : spec.error ?? this.error,
      primary: off ? { ...spec.primary, disabled: true } : spec.primary,
      exit: spec.exit ?? { label: this.m.exit.label, icon: 'x-lg', run: () => this.exit() }
    };
  }

  /** What is kept: the path, the persist keys, finished once, the steps bar of its own. @returns {Saved} */
  saved() {
    return { v: this.m.version, path: this.path, ctx: this.ctx.persisted(), finished: this.finished, ...(this.ownSteps ? { ownSteps: this.ownSteps } : {}) };
  }

  /**
   * Nothing to keep: at its start, its context as it starts, never finished, no steps bar of its own — as if never
   * opened (no state written: after « Rejouer », the app leaves nothing behind).
   */
  get pristine() {
    const ctx = this.ctx.persisted();
    return this.path.length === 1 && !this.finished && this.ownSteps === null
      && Object.entries(ctx).every(([k, v]) => JSON.stringify(v) === JSON.stringify(this.m.context[k].init));
  }

  /** Written now (the box leaving), not 300 ms later; nothing to keep, nothing written (the key removed). */
  flush() {
    clearTimeout(this.saveTimer);
    const key = storageKey(this.m.id, 'state');
    writeJSON(key, this.pristine ? null : this.saved()); // not written: not kept
  }

  /** Stops its loads and timers (the box gone); `dispose` told (a component's game stops its own). */
  dispose() {
    for (const l of this.loads.values()) { clearTimeout(l.timer); l.abort?.abort(); }
    for (const a of this.running.values()) a.abort();
    this.flush();
    this.#emit('dispose');
  }

  /** @param {string[]} path */
  #walk(path) {
    this.path = path;
    if (!followers(this.m, this.step).length && this.step.kind !== 'start') this.finished = true;
    this.#save();
    this.#emit('change');
  }

  /** @type {unknown} */ #focusSeen = null;

  #changed() {
    this.#load();
    // A new plant opened or chosen (a sheet, a point of the map, a link's ?p=): seen.
    const focus = this.c.focus;
    if (typeof focus === 'number' && focus !== this.#focusSeen) { this.#focusSeen = focus; this.seen(focus); }
    // Guided: the step done goes on by itself (a plant touched opens its sheet).
    const s = this.step;
    const next = followers(this.m, s);
    if (this.guided && s.done && next.length === 1 && s.done(this.c)) this.go(next[0]);
    this.#save();
    this.#emit('change');
  }

  /** The data of the manifest whose key changed: loaded (after its debounce), the one before cancelled. */
  #load() {
    for (const [name, d] of Object.entries(this.m.data)) {
      const raw = d.key(this.c);
      const key = raw ? JSON.stringify(raw) : '';
      const was = this.loads.get(name);
      if (was?.key === key) continue;
      if (was) { clearTimeout(was.timer); was.abort?.abort(); }
      const entry = { key, timer: /** @type {any} */ (0), abort: /** @type {AbortController | null} */ (null) };
      this.loads.set(name, entry);
      if (!key) continue;
      const start = () => {
        const abort = entry.abort = new AbortController();
        d.load(this, raw, abort.signal).then(value => { if (!abort.signal.aborted) this.ctx.set({ [d.into]: value }); },
          e => { if (!abort.signal.aborted) { this.error = e instanceof Error ? e.message : String(e); this.#emit('change'); } });
      };
      if (d.debounce) entry.timer = setTimeout(start, d.debounce); else start();
    }
  }

  #save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 300);
  }

  /** @param {string} type @param {unknown} [detail] */
  #emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
}
