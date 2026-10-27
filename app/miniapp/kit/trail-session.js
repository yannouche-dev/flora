// @ts-check
// The game of the Parcours botanique, shared by its kit (the start, ma-walk and its parts, ma-trail-recap): one per
// activity open, a new one after « Recommencer » (trailSessionOf). The walk under way and the one just ended (their ids
// kept on the device: kit/trail-store.js), those to continue (the parcours of Mes plantes: every place marked a walk,
// received ones too, the last changed first), where I am (followed while walking), the
// plant touched, the word said after an action (« Annuler »). Its actions: start here (the app's action `locate`) or
// from a commune, take one up again, add a plant where I stand, take one out, rename, share, end (its recap), start
// another. Each walk is written as it is stored now (collections.js updatePlace, by the Parcours: it stays its own
// while under way). It leads the app's steps (app.go: start › walk › done). Fires `change`.

import { FIX_MAX_AGE, geoProblem, takeFix, watchLocation, whenGranted } from '../../core/geo.js';
import { atPlace, placeNameAt } from '../../core/geoservices.js';
import { entriesOf, getPlace, lastEntry, listCollections, newPlace, promotePlace, refreshMembership, savePlace, spotEvents, updatePlace, withPlant, withoutPlant } from '../../core/collections.js';
import { fillAltitudes } from '../../core/altitude.js';
import { getPlant } from '../../core/plants.js';
import { href } from '../../core/router.js';
import { encodeCollection, share } from '../../core/share.js';
import { ACTION_TOAST_MS, TOAST_MS } from '../../core/toast.js';
import { readJSON, writeJSON } from '../../core/prefs.js';
import { DONE, KEY, NAMED, countOf } from './trail-store.js';

/** @typedef {import('../runtime.js').MiniApp} MiniApp */

export class TrailSession extends EventTarget {
  /** @param {MiniApp} app */
  constructor(app) {
    super();
    this.app = app;
    /** The emptying of the app it belongs to (« Recommencer »: another session). */
    this.generation = app.generation;
    /** The walk under way (its place), the one just ended (its recap), those to continue. @type {any} */
    this.trail = null;
    /** @type {any} */
    this.done = null;
    /** @type {any[]} */
    this.past = [];
    /** The walk under way and the recap read once. */
    this.known = false;
    /** Where I am (followed while walking), or why not. @type {{ coordinates: [number, number], accuracy: number } | null} */
    this.fix = null;
    /** @type {string | null} */
    this.geoError = null;
    /** Why « Commencer ici » failed (the start screen's words, from geo.js's code). @type {import('../../components/start-screen.js').StartError | null} */
    this.startError = null;
    /** A walk being created (saved, then shown): no second one meanwhile. */
    this.creating = false;
    /** The occurrence just added (lit in the list). @type {string | null} */
    this.fresh = null;
    /** The plant touched (its id), in the list or on the map: its occurrences lit, « Ajouter ici » in the head. @type {number | null} */
    this.sel = null;
    /** The occurrence of it touched on the map (the one the head's ✕ takes out; else its last). @type {string | null} */
    this.selEntry = null;
    /** The word said after an action, with its « Annuler ». @type {{ text: string, undo?: () => void } | null} */
    this.toast = null;
    /** The search is open (its sheet over the walk): the word waits until it is left. */
    this.searching = false;
    /** The walk just created: the field ready for the first plant (a wide screen). */
    this.focusSearch = false;
    /** The name being edited (a touch in the field): the IGN's name for the place does not replace it. */
    this.editingName = false;
    /** @type {any} */
    this.timers = { toast: 0, name: 0 };
    /** @type {(() => void) | null} */
    this.stopGeo = null;
    /** Waiting for the permission before following (a walk found again on opening). @type {(() => void) | null} */
    this.waitGeo = null;
    spotEvents.addEventListener('change', this.#onSpots);
    app.addEventListener('dispose', () => this.dispose(), { once: true });
    this.reload();
  }

  #onSpots = () => this.reload();

  /** Drawn again: its elements, and the box (the start screen is the box's). */
  changed() {
    this.dispatchEvent(new Event('change'));
    this.app.refresh();
  }

  /** The walk walked (and those before, the one just ended), from Mes plantes. */
  async reload() {
    const id = readJSON(KEY, null);
    const trail = id ? await getPlace(id).catch(() => undefined) : undefined;
    this.trail = trail || null;
    if (!trail && id) writeJSON(KEY, null);
    // The walk just ended: its recap again (back from Mes plantes, the page reloaded), as it is now.
    const done = !trail && readJSON(DONE, null);
    if (done) {
      this.done = await getPlace(done).catch(() => undefined) || null;
      if (!this.done) writeJSON(DONE, null);
      // Its altitudes, for its profile (a walk noted offline, or before they were kept): saved again once found.
      else fillAltitudes(this.done.id, getPlace, updatePlace);
    } else if (!trail) this.done = null;
    // Those to continue: the parcours of Mes plantes (a place marked a walk — received ones too —, its point kept), the
    // last changed first; 20 at most.
    this.past = (await listCollections().catch(() => /** @type {any[]} */ ([])))
      .filter(c => c.properties.walk && c.geometry && c.id !== id)
      .sort((a, b) => b.properties.updatedAt.localeCompare(a.properties.updatedAt))
      .slice(0, 20);
    this.known = true;
    // Gone meanwhile (deleted from Mes plantes, in another tab): its step left for the start.
    const step = this.app.step.id;
    if (!this.creating && ((step === 'walk' && !this.trail) || (step === 'done' && !this.done))) this.app.go('start');
    this.changed();
  }

  /** Where I am, followed while walking — once the permission is granted when no gesture asked for it (a walk found again on opening). @param {boolean} [asked] */
  follow(asked = false) {
    if (this.stopGeo) return;
    if (!asked) {
      this.waitGeo?.();
      const cancel = whenGranted(() => { this.waitGeo = null; if (this.trail) this.follow(true); });
      this.waitGeo = this.stopGeo ? null : cancel;
      return;
    }
    this.stopGeo = watchLocation(s => {
      if (s.fix) { this.fix = { coordinates: s.fix.coordinates, accuracy: s.fix.accuracy }; this.geoError = null; }
      else if (s.error) this.geoError = s.error;
      this.changed();
    });
  }

  /** Not followed any more (the walk left, ended, the app left). */
  stop() {
    this.stopGeo?.(); this.stopGeo = null;
    this.waitGeo?.(); this.waitGeo = null;
  }

  /**
   * « Commencer ici » (the app's action `locate`): located, the walk created there. Once: a second touch, a late or
   * repeated answer, an old fix do nothing; « Annuler », a commune chosen, the app left drop its answer.
   * @param {AbortSignal} signal
   */
  locate(signal) {
    return new Promise(resolve => {
      if (this.creating) { resolve(undefined); return; }
      this.startError = null;
      // Within the watch's call (takeFix): a fix the watch already holds starts the walk before the start is drawn again.
      takeFix({ maxAge: FIX_MAX_AGE, signal }, r => {
        resolve(undefined);
        if (!r) return;
        if ('error' in r) { this.startError = geoProblem(r.code, { place: true, retry: () => this.app.do('locate') }); this.changed(); }
        else this.create(r.coordinates, null, r.accuracy);
      });
    });
  }

  /**
   * A new walk at `at`: named after the commune chosen (`where`), or — started here — after the finest place the IGN
   * knows there (a park, a forest, a wood, a summit, a lieu-dit, a hamlet, the commune), as soon as it answers — the
   * commune only when the position is rough (over 250 m). Then on to the walk.
   * @param {[number, number]} at @param {string | null} where @param {number} [accuracy] metres
   */
  async create(at, where, accuracy = 0) {
    if (this.creating) return;
    this.creating = true;
    this.app.cancel('locate');
    this.startError = null;
    this.changed();
    try {
      const name = where ? `${NAMED} ${atPlace({ name: where, kind: 'commune', commune: '' })}` : NAMED;
      // Made by the Parcours (its origin): « Recommencer » it, and the walk goes with every plant in it. A parcours
      // (its mark): its line in the « Vue 3D », « Continuer », whoever owns it later.
      const place = newPlace(at, { name: name.slice(0, 80), notes: 'Parcours botanique', origin: { app: 'parcours' }, walk: true });
      // Started where I stand: its point is the walk's first step (the recap's distance counts from it).
      if (!where) /** @type {any} */ (place.properties).startedHere = true;
      // Asked at once; given once the walk is saved (it may answer first: from the cache).
      const found = where ? null : this.#placeName(at, accuracy > 250);
      await savePlace(place);
      this.leaveRecap();
      writeJSON(KEY, place.id);
      await refreshMembership().catch(() => {});
      this.trail = place;
      if (found) this.#nameAfter(place.id, found);
      this.focusSearch = true;
      this.follow(true);
      this.app.go('walk');
    } finally {
      this.creating = false;
      this.changed();
    }
  }

  /** A walk continued (« Continuer un parcours », « Le continuer »; from Mes plantes: trail-store.js#continueWalk): on to it. @param {any} place */
  resume(place) {
    this.app.cancel('locate');
    this.leaveRecap();
    writeJSON(KEY, place.id);
    this.trail = place;
    this.sel = null; this.selEntry = null;
    this.follow(true);
    this.app.go('walk');
    this.reload();
  }

  /** The recap left (another walk, the scenarios): it is not shown again. */
  leaveRecap() {
    this.done = null;
    writeJSON(DONE, null);
  }

  /** « Un nouveau parcours » (the recap): back to the start. */
  another() {
    this.leaveRecap();
    this.app.go('start');
    this.changed();
  }

  /**
   * A plant added to the walk, where I stand (else at the walk's point) — again if it is already there: the same
   * species met further on is another occurrence, at its own spot. Resolves with whether it was added.
   * @param {any} hit
   */
  async add(hit) {
    const trail = this.trail;
    if (!trail) return false;
    const plant = await getPlant(hit.id) || { id: hit.id, scientificName: hit.scientificName, vernacularName: hit.vernacularName };
    const position = this.fix ? { coordinates: this.fix.coordinates, accuracy: Math.round(this.fix.accuracy) } : undefined;
    // Added to the walk as stored now (another add, another tab, the altitudes may have written meanwhile).
    const next = await this.update(trail.id, current => withPlant(current, plant, position, { again: true, origin: { app: 'parcours' } }));
    if (!next) return false;
    const added = /** @type {any} */ (lastEntry(next)).id;
    this.fresh = added;
    // A plant noted: seen, for the first steps of the app (the box counts it).
    this.app.seen(plant.id);
    const name = hit.vernacularName || hit.scientificName;
    const n = entriesOf(next, plant.id).length;
    this.say(`${name} ajoutée au parcours${n > 1 ? ` (${n}e fois)` : ''}${position ? ', ici' : ''}`, () => { this.update(trail.id, current => withoutPlant(current, added)); });
    return true;
  }

  /** One occurrence out of the walk (the plant's others stay) — « Annuler » puts it back. @param {string} entryId */
  async remove(entryId) {
    const t = this.trail;
    const entry = t?.properties.plants.find((/** @type {any} */ e) => e.id === entryId);
    if (!t || !entry) return;
    const next = await this.update(t.id, current => withoutPlant(current, entryId));
    if (!next) return;
    this.selEntry = null;
    if (this.sel != null && !entriesOf(next, this.sel).length) this.sel = null;
    this.say(`${entry.vernacularName || entry.scientificName} retirée du parcours`, () => {
      this.update(t.id, current => current.properties.plants.some(e => e.id === entryId) ? current
        : { ...current, properties: { ...current.properties, plants: [...current.properties.plants, entry] } });
    });
  }

  /** A plant touched, in the list or on the map (null: let go). @param {number | null} plantId @param {string | null} [entryId] the occurrence touched on the map */
  select(plantId, entryId = null) {
    this.sel = plantId;
    this.selEntry = entryId;
    this.changed();
  }

  /** The name as typed: kept 500 ms after the last key. @param {string} name */
  typeName(name) {
    clearTimeout(this.timers.name);
    this.pendingName = name;
    this.timers.name = setTimeout(() => this.rename(name), 500);
  }
  /** @type {string | null} */ pendingName = null;

  /** The name being typed, stored now (before sharing, ending…). */
  async flushName() {
    if (this.pendingName != null) await this.rename(this.pendingName);
  }

  /** The name, kept at once (drawn first: never behind the field), then stored. @param {string} name */
  async rename(name) {
    clearTimeout(this.timers.name);
    this.pendingName = null;
    const n = name.trim();
    if (!n || !this.trail || n === this.trail.properties.name) return;
    const kept = n.slice(0, 80);
    this.trail = { ...this.trail, properties: { ...this.trail.properties, name: kept } };
    this.changed();
    await this.update(this.trail.id, current => ({ ...current, properties: { ...current.properties, name: kept } }));
  }

  /**
   * The finest place name at `at` (its commune only, `rough`), or null (the IGN silent 8 s, off, out of reach).
   * @param {[number, number]} at @param {boolean} rough @returns {Promise<{ name: string, kind: string, commune: string } | null>}
   */
  async #placeName(at, rough) {
    const found = await Promise.race([placeNameAt(at).catch(() => null), new Promise(done => setTimeout(() => done(null), 8000))]);
    if (!found || !rough || found.kind === 'commune') return found;
    return found.commune ? { name: found.commune, kind: 'commune', commune: found.commune } : null;
  }

  /**
   * The walk `id` named after the place where it starts, when the IGN answers — unless it was renamed meanwhile, or
   * its name is being edited. @param {string} id @param {Promise<{ name: string, kind: string, commune: string } | null>} pending
   */
  async #nameAfter(id, pending) {
    const found = await pending;
    const t = this.trail;
    if (!found || t?.id !== id || t.properties.name !== NAMED || this.editingName) return;
    await this.rename(`${NAMED} ${atPlace(found)}`);
  }

  /**
   * A change to the walk, applied to it as stored now, in one transaction (collections.js updatePlace): two quick
   * adds, or the same walk open in two tabs, never lose one another's plants. Written by the Parcours itself: it stays
   * its own while under way. Deleted meanwhile (in another tab): said, and the walk left. Resolves with it as stored.
   * @param {string} id @param {(current: import('../../core/collections.js').Place) => import('../../core/collections.js').Place} change
   */
  async update(id, change) {
    try {
      const saved = await updatePlace(id, change, { by: 'parcours' });
      if (this.trail?.id === id) this.trail = saved;
      this.changed();
      return saved;
    } catch (error) {
      this.say(/** @type {Error} */ (error).name === 'GoneError' ? 'Ce parcours a été supprimé (dans un autre onglet ?) : rien n’a été enregistré.'
        : 'Enregistrement impossible : ' + /** @type {Error} */ (error).message);
      this.reload();
      return null;
    }
  }

  /**
   * The walk shared: a link carrying it (its plants and their places), by the system's sheet or copied — the user's
   * own from then on (« Recommencer » the Parcours keeps it). @param {any} [place] the walk ended (its recap), else the one walked
   */
  async share(place) {
    await this.flushName();
    const t = place || this.trail;
    if (!t) return;
    const url = href.shared(await encodeCollection(t));
    promotePlace(t.id);
    const result = await share({ title: t.properties.name + ' — GeoFlora', text: `${t.properties.name} · ${countOf(t)}`, url });
    if (result === 'copied') this.say('Lien du parcours copié : collez-le où vous voulez');
  }

  /**
   * « Terminer »: the walk stays in Mes plantes; its recap shows; another one can start. With plants, it is the
   * user's own now: « Recommencer » the Parcours keeps it (collections.js#promotePlace) — promoted once it is no
   * longer under way (the reload its change brings finds the recap).
   */
  async end() {
    await this.flushName();
    const ended = this.trail;
    writeJSON(KEY, null);
    writeJSON(DONE, ended?.id ?? null);
    this.stop();
    if (ended?.properties.plants.length) promotePlace(ended.id);
    this.done = ended;
    this.trail = null; this.sel = null; this.selEntry = null; this.toast = null; this.fix = null;
    this.app.go('done');
    this.reload();
  }

  /**
   * A word said for a while (core/toast.js: longer with its « Annuler »; its time waits while the search is open, or
   * while the word is hovered or focused: holdToast). @param {string} text @param {() => void} [undo]
   */
  say(text, undo) {
    this.toast = { text, undo };
    this.#held = false;
    this.#timeToast();
    this.changed();
  }

  /** The word's time, from now (none while the search is open, or while it is held). */
  #timeToast() {
    clearTimeout(this.timers.toast);
    const toast = this.toast;
    if (!toast || this.searching || this.#held) return;
    this.timers.toast = setTimeout(() => { if (this.toast === toast) { this.toast = null; this.changed(); } }, toast.undo ? ACTION_TOAST_MS : TOAST_MS);
  }

  /** The word hovered or focused (its « Annuler » within reach): it waits; let go, its time runs again. */
  #held = false;
  /** @param {boolean} held */
  holdToast(held) {
    this.#held = held;
    this.#timeToast();
  }

  /** The search open or left: the word's time waits under it, and runs again once it is left. @param {boolean} open */
  setSearching(open) {
    if (open === this.searching) return;
    this.searching = open;
    this.#timeToast();
  }

  /** Its timers, its GPS, its listening stopped (the app gone, or played again). */
  dispose() {
    this.stop();
    for (const t of Object.values(this.timers)) clearTimeout(t);
    spotEvents.removeEventListener('change', this.#onSpots);
  }
}

/** @type {WeakMap<MiniApp, TrailSession>} */
const sessions = new WeakMap();

/** The game of the Parcours (a new one once it was played again). @param {MiniApp} app */
export function trailSessionOf(app) {
  let s = sessions.get(app);
  if (!s || s.generation !== app.generation) {
    s?.dispose();
    s = new TrailSession(app);
    sessions.set(app, s);
  }
  return s;
}
