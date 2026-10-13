// @ts-check
// The game of a mini-app around a place (Rencontres, Cueillette prudente, Mosaïque), shared by its components (kit:
// ma-distance, ma-around-list, ma-deck, ma-guided, ma-around-map) — one per mini-app open, a new one after « Rejouer »
// (sessionOf). What is kept on the device is the app's context (app.c: point, place, radius, matches, passed —
// persist keys of the manifest, under geoflora.app.<id>.state), written only through app.set. The rest lives while
// the app is open: the cards found (iNaturalist, matched to the flora; Cueillette prudente: only the plants of a
// dangerous confusion, the deadliest first), the observations in the circle (the map), what Wikipédia says of each
// card, the swipes to undo, the view of the list and how many of its cards are shown. Fires `change`.

import * as db from '../../core/db.js';
import { speciesAround, observationPointsAround } from '../../core/nearby.js';
import { addressAt } from '../../core/geoservices.js';
import { alertsOf } from '../../core/alerts.js';
import { lookalikesOf } from '../../core/lookalikes.js';
import { plantSeen } from '../../core/discover.js';
import { isFavorite, toggleFavorite } from '../../core/collections.js';
import { thumbCredit } from '../../core/credit.js';
import * as sources from '../../core/sources.js';
import { whenReady } from '../../core/store.js';
import { subscribe } from '../../core/sync.js';
import { floweringMonths } from '../../components/gf-calendar.js';
import { PAGE, aroundOrder, deckOf, ethnoSentence, harvestOrder, swipe, unswipe } from './cards.js';

/**
 * @typedef {import('./cards.js').Card} Card
 * @typedef {import('../../core/nearby.js').AroundPoint} AroundPoint
 * @typedef {import('../runtime.js').MiniApp} MiniApp
 */

/** The view chosen in each mini-app's list (Rencontres, Matchs, Toutes), kept while the app is open. @type {Record<string, string>} */
const views = {};
/** The mini-apps whose deck has shown it can be swiped (once while the app is open). @type {Set<string>} */
const hinted = new Set();

/**
 * What a mini-app around a place keeps in memory forgotten (« Rejouer », « Recommencer »: its manifest's
 * owns.reset; another tab's, by core/sync.js): the view chosen, the swipe hint shown — they come again.
 * @param {string} id
 */
export function forgetGame(id) {
  delete views[id];
  hinted.delete(id);
}
subscribe('miniapp', d => { if (d?.op === 'replay' && typeof d.id === 'string') forgetGame(d.id); });

export class AroundSession extends EventTarget {
  /** @param {MiniApp} app */
  constructor(app) {
    super();
    this.app = app;
    /** The emptying of the app it belongs to (« Rejouer »: another session). */
    this.generation = app.generation;
    /** @type {Card[] | null} */
    this.cards = null;
    this.loading = false;
    /** @type {string | null} */
    this.error = null;
    /** Cueillette prudente: the look-alikes list could not be read (every plant kept, never « none to pick »). */
    this.unread = false;
    /** The last search: Cueillette prudente's (only the plants of a dangerous confusion). */
    this.harvest = false;
    /** The search the cards are for ('radius:point:harvest'). */
    this.loadedFor = '';
    /** The observations in the circle (the map), and how many there are in all (the map shows up to 100). @type {AroundPoint[]} */
    this.obs = [];
    this.obsTotal = 0;
    /** What is said of a plant (Wikipédia), by plant id: the text, null (nothing), or absent (not asked yet). @type {Map<number, string | null>} */
    this.ethno = new Map();
    /** ↺: the last swipes, to undo. @type {{ id: number, liked: boolean, fav: boolean }[]} */
    this.history = [];
    /** A heart flying off the deck (a match after the first). */
    this.burst = 0;
    /** The cards shown in « Toutes » (« Voir plus »). */
    this.shown = PAGE;
    /** The cards the open sheet steps through. @type {number[]} */
    this.sheetIds = [];
    /** @type {AbortController | null} */
    this.abort = null;
    /** @type {any} */
    this.timers = { points: 0, radius: 0, burst: 0 };
    this.pointsFor = '';
    app.addEventListener('dispose', () => this.dispose(), { once: true });
  }

  /** The app's context: the place, the distance, the swipes. @returns {any} */
  get c() { return this.app.c; }

  changed() { this.dispatchEvent(new Event('change')); }

  /** The deck's swipe hint: not shown yet in this app (and now it is). */
  hintOnce() {
    if (hinted.has(this.app.m.id)) return false;
    hinted.add(this.app.m.id);
    return true;
  }

  /** The view of the list (none chosen: the app's own, `fallback`). @param {string} fallback */
  viewOr(fallback) { return views[this.app.m.id] || fallback; }
  /** @param {string | null} view */
  setView(view) {
    if (view) views[this.app.m.id] = view; else delete views[this.app.m.id];
    this.changed();
  }

  // ── Where ─────────────────────────────────────────────────────────────

  /**
   * The place chosen (a position: its commune found, IGN): kept by the app; the cards of another place to search
   * again. @param {[number, number]} point @param {string | null} place
   */
  async setPoint(point, place) {
    this.app.set({ point, place });
    this.cards = null;
    this.loadedFor = '';
    this.changed();
    if (!place) {
      const a = await addressAt(point).catch(() => null);
      if (a?.city && this.c.point === point) this.app.set({ place: a.city });
    }
  }

  /** The distance (m); `reload` ms later, the cards searched again (the slider at rest). @param {number} m @param {number} [reload] */
  setRadius(m, reload) {
    this.app.set({ radius: m });
    clearTimeout(this.timers.radius);
    if (reload !== undefined) this.timers.radius = setTimeout(() => this.load(), reload);
  }

  /** Further (« Chercher jusqu’à … »): the distance, and the cards searched again at once. @param {number} m */
  widen(m) { this.app.set({ radius: m }); this.load(); }

  /** The observations in the circle (the map): asked again 400 ms after the place or the distance changed. */
  watchPoints() {
    const { point, radius } = this.c;
    const key = point ? radius + ':' + point : '';
    if (!key || key === this.pointsFor) return;
    const first = !this.pointsFor && !this.obs.length;
    this.pointsFor = key;
    clearTimeout(this.timers.points);
    if (first) this.#loadPoints();
    else this.timers.points = setTimeout(() => this.#loadPoints(), 400);
  }

  async #loadPoints() {
    const { point, radius } = this.c;
    if (!point) return;
    const found = await observationPointsAround(point, radius).catch(() => ({ points: [], total: 0 }));
    if (this.c.point === point && this.c.radius === radius) { this.obs = found.points; this.obsTotal = found.total; this.changed(); }
  }

  // ── What grows around ────────────────────────────────────────────────

  /** The key of a search. @param {boolean} harvest */
  #key(harvest) { const { point, radius } = this.c; return point ? radius + ':' + point + ':' + harvest : ''; }

  /** The cards of the place and distance chosen: searched unless they are there already (or on their way). @param {boolean} harvest */
  ensure(harvest) {
    const key = this.#key(harvest);
    if (key && key !== this.loadedFor) this.load(harvest);
  }

  /** The next ensure() searches again (« Qui pousse par ici ? »: the cards anew, as the button says). */
  invalidate() { this.loadedFor = ''; }

  /** The cards searched (again): the plants observed in the circle, matched to the flora. @param {boolean} [harvest] */
  async load(harvest = this.harvest) {
    const point = this.c.point;
    if (!point) return;
    this.abort?.abort();
    const abort = this.abort = new AbortController();
    this.harvest = harvest;
    this.loading = true; this.error = null; this.unread = false; this.cards = null; this.shown = PAGE;
    this.loadedFor = this.#key(harvest);
    this.changed();
    try {
      await whenReady();
      const found = await speciesAround(point, this.c.radius, abort.signal);
      if (abort.signal.aborted) return;
      const month = new Date().getMonth();
      const species = (found?.species || []).filter(s => s.plantId).slice(0, 120);
      const cards = (await Promise.all(species.map(async s => {
        const plant = await db.get('plants', /** @type {number} */ (s.plantId)).catch(() => null);
        if (!plant) return null;
        // iNaturalist's photo (a free licence only, nearby.js), else the flora's thumbnail: each with its credit.
        /** @type {Card} */
        const card = { plant, taxonId: s.taxonId, count: s.count, photo: s.photo ? s.photo.replace(/\/square\./, '/medium.') : plant.thumbnail?.url || null,
          credit: s.photo ? s.credit : thumbCredit(plant.thumbnail), blooming: floweringMonths(plant.flowering).has(month), alerts: null };
        return card;
      }))).filter(c => c !== null);
      if (abort.signal.aborted) return;
      let list = /** @type {Card[]} */ (cards);
      if (harvest) {
        // Cueillette prudente: only the plants of the Anses / Centres antipoison confusions, the deadly first. The list
        // unreadable: said, with every plant (each card says it too), never « none to pick ».
        let unread = false;
        for (const c of list) {
          c.confusions = await lookalikesOf(c.plant).catch(error => { console.error(error); unread = true; return []; });
          if (unread) break;
        }
        if (abort.signal.aborted) return;
        this.unread = unread;
        list = harvestOrder(list, unread);
      } else list = aroundOrder(list);
      this.cards = list;
      // The alerts of each plant (local data), as they come.
      for (const c of list) alertsOf(c.plant).then(a => { c.alerts = a; this.changed(); }, () => {});
    } catch (error) {
      if (abort.signal.aborted) return;
      const e = /** @type {Error} */ (error);
      this.error = e.name === 'ModuleOffError' ? 'Le module iNaturalist est désactivé (Réglages › Modules) : il dit ce qui a été observé autour.'
        : navigator.onLine ? 'iNaturalist ne répond pas pour le moment. Réessayez dans un instant.' : 'Hors ligne : la liste des plantes autour a besoin du réseau la première fois.';
    } finally {
      if (!abort.signal.aborted) { this.loading = false; this.changed(); }
    }
  }

  /** The cards not yet swiped. */
  get deck() { return deckOf(this.cards || [], this.c); }

  /** The cards matched. */
  get matchCards() {
    const ids = this.c.matches;
    return (this.cards || []).filter(c => ids.includes(c.plant.id));
  }

  /** The cards the open sheet steps through. */
  get sheetCards() {
    const by = new Map((this.cards || []).map(c => [c.plant.id, c]));
    const list = this.sheetIds.map(id => by.get(id)).filter(c => c !== undefined);
    return list.length ? list : this.cards || [];
  }

  /**
   * What is said of it (Wikipédia): asked once, for the cards in view only (the top one and the next).
   * @param {Card} c @returns {string | null | undefined}
   */
  ethnoOf(c) {
    const id = c.plant.id;
    if (!this.ethno.has(id)) this.#loadEthno(c);
    return this.ethno.get(id);
  }

  /** @param {Card} c */
  async #loadEthno(c) {
    const id = c.plant.id;
    this.ethno = new Map(this.ethno).set(id, null);
    const qid = c.plant.identifiers?.wikidata;
    const wiki = qid ? await sources.wikipedia(c.plant, qid).catch(() => null) : null;
    const text = ethnoSentence(wiki);
    if (text) { this.ethno = new Map(this.ethno).set(id, text); this.changed(); }
  }

  // ── Swiping ───────────────────────────────────────────────────────────

  /**
   * A card swiped: right, a match (kept by the app, and in the favourites); left, passed. It can be undone (↺).
   * Returns whether the match put it in the favourites. @param {Card} card @param {boolean} liked
   */
  swiped(card, liked) {
    const id = card.plant.id;
    const fav = liked && !isFavorite(id);
    this.history = [...this.history, { id, liked, fav }].slice(-30);
    this.app.set(swipe(this.c, id, liked));
    plantSeen(id);
    if (liked) {
      // A favourite of this game (its origin): « Recommencer » takes it away again.
      if (fav) toggleFavorite(card.plant, { app: this.app.m.id }).catch(() => {});
      if (matchMedia('(pointer: coarse)').matches) navigator.vibrate?.(30);
    }
    this.changed();
    return fav;
  }

  /** A match after the first: a heart flies off the deck. */
  heart() {
    this.burst++;
    const n = this.burst;
    clearTimeout(this.timers.burst);
    this.timers.burst = setTimeout(() => { if (this.burst === n) { this.burst = 0; this.changed(); } }, 900);
    this.changed();
  }

  /** ↺: the last card swiped comes back on top (a match undone: out of the favourites too, if it put it there). */
  rewind() {
    const last = this.history[this.history.length - 1];
    if (!last) return;
    this.history = this.history.slice(0, -1);
    this.app.set(unswipe(this.c, last.id));
    const card = (this.cards || []).find(c => c.plant.id === last.id);
    if (last.fav && card && isFavorite(last.id)) toggleFavorite(card.plant).catch(() => {});
    this.changed();
  }

  /** A card back in the deck (on top: a plant touched on the map or in the list around). @param {number} id */
  unswipe(id) { this.app.set(unswipe(this.c, id)); }

  /** A match taken back: out of the matches and the favourites. @param {Card} c */
  unmatch(c) {
    this.app.set(unswipe(this.c, c.plant.id));
    if (isFavorite(c.plant.id)) toggleFavorite(c.plant).catch(() => {});
  }

  /** The cards passed, to see them again. */
  resetPassed() { this.app.set({ passed: [] }); }

  /** A plant brought on top of the deck (touched on the map or in the list around). @param {Card} card */
  toTop(card) {
    this.cards = [card, ...(this.cards || []).filter(c => c !== card)];
    this.changed();
  }

  /** Its requests and timers stopped (the app gone, or played again). */
  dispose() {
    this.abort?.abort();
    for (const t of Object.values(this.timers)) clearTimeout(t);
  }
}

/** @type {WeakMap<MiniApp, AroundSession>} */
const sessions = new WeakMap();

/** The game of a mini-app around a place (a new one once it was played again). @param {MiniApp} app */
export function sessionOf(app) {
  let s = sessions.get(app);
  if (!s || s.generation !== app.generation) {
    s?.dispose();
    s = new AroundSession(app);
    sessions.set(app, s);
  }
  return s;
}
