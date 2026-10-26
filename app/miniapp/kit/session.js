// @ts-check
// The game of a mini-app around a place (Rencontres, Cueillette prudente, Mosaïque), shared by its components (kit:
// ma-distance, ma-around-list, ma-deck, ma-guided, ma-around-map) — one per mini-app open, a new one after « Recommencer »
// (sessionOf). What is kept on the device is the app's context (app.c: point, place, radius, matches, passed;
// Cueillette prudente: avoided — persist keys of the manifest, under geoflora.app.<id>.state), written only through
// app.set. The rest lives while the app is open: the cards found (iNaturalist, matched to the flora; Cueillette
// prudente: only the plants of a dangerous confusion, the deadliest first, its toxic look-alikes never a match but
// recognised, to avoid), the observations in the circle (the map), what Wikipédia says of each
// card, the swipes to undo, how many of the list's cards are shown. The view of the list is the context's (`view`,
// the address's &v=). Rencontres: the plant of the screen, chosen (chosenId: kit/around.js#chosenContext). Fires
// `change`.

import { floweringMonths, getPlant } from '../../core/plants.js';
import { speciesAround, observationPointsAround } from '../../core/nearby.js';
import { addressAt } from '../../core/geoservices.js';
import { verdictOf } from '../../core/alerts.js';
import { lookalikesOf } from '../../core/lookalikes.js';
import { discovering } from '../../core/discover.js';
import { forgetFavoriteMadeBy, isFavorite, toggleFavorite } from '../../core/collections.js';
import { thumbCredit } from '../../core/credit.js';
import * as sources from '../../core/sources.js';
import { whenReady } from '../../core/store.js';
import { subscribe } from '../../core/sync.js';
import { PAGE, aroundOrder, avoid, deckOf, ethnoSentence, harvestOrder, swipe, toAvoid, unswipe } from './cards.js';

/**
 * @typedef {import('./cards.js').Card} Card
 * @typedef {import('../../core/nearby.js').AroundPoint} AroundPoint
 * @typedef {import('../runtime.js').MiniApp} MiniApp
 */

/** The mini-apps whose deck has shown it can be swiped (once while the app is open). @type {Set<string>} */
const hinted = new Set();

/** The cards of a search, at most: the most observed (Cueillette prudente: the first in its order, the deadliest first). */
const MAX_CARDS = 120;

/**
 * The views of the list (kit/ma-around-list.js: « Rencontres », « Matchs », « Toutes »), as the address writes them
 * (&v=; the list's own view is not written).
 */
const VIEW_WORDS = /** @type {const} */ ({ swipe: 'rencontres', matches: 'matchs', all: 'toutes' });
/** @param {string | null | undefined} word @returns {string | null} */
const viewOfWord = word => Object.entries(VIEW_WORDS).find(([, w]) => w === word)?.[0] ?? null;

/**
 * What a mini-app around a place keeps in memory forgotten (« Recommencer », in its ⋯ or in Découvrir: its manifest's
 * owns.reset; another tab's, by core/sync.js): the swipe hint shown — it comes again.
 * @param {string} id
 */
export function forgetGame(id) {
  hinted.delete(id);
}
subscribe('miniapp', d => { if (d?.op === 'replay' && typeof d.id === 'string') forgetGame(d.id); });

export class AroundSession extends EventTarget {
  /** @param {MiniApp} app */
  constructor(app) {
    super();
    this.app = app;
    /** The emptying of the app it belongs to (« Recommencer »: another session). */
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
    /** The observations of another circle on their way (those of the last one still shown, dimmed). */
    this.obsLoading = false;
    /** @type {AbortController | null} */
    this.pointsAbort = null;
    /** What is said of a plant (Wikipédia), by plant id: the text, null (nothing), or absent (not asked yet). @type {Map<number, string | null>} */
    this.ethno = new Map();
    /** ↺: the last swipes, to undo (`was`: the plant chosen before a heart chose this one). @type {{ id: number, liked: boolean, fav: boolean, was?: number | null }[]} */
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
    /** The photos' pane hovered: the plant chosen lit on the map. */
    this.chosenGlow = false;
    /**
     * A game of Rencontres kept from before its way was its own (a place chosen, no `guided`): the way it was playing
     * kept from now on (kit/around.js#guidedWay — never swapped when the tabs arrive); ma-guided then takes back the
     * panes its steps had put in the layout of the mode.
     */
    this.keptFromBefore = 'guided' in app.m.context && Array.isArray(this.c.point) && this.c.guided === null;
    if (this.keptFromBefore) app.set({ guided: discovering() });
    app.addEventListener('dispose', () => this.dispose(), { once: true });
  }

  /** The app's context: the place, the distance, the swipes. @returns {any} */
  get c() { return this.app.c; }

  changed() { this.dispatchEvent(new Event('change')); }

  /** The photos' pane hovered (its head): the plant chosen lit on the map beside. @param {boolean} on */
  glowChosen(on) {
    if (this.chosenGlow === on) return;
    this.chosenGlow = on;
    this.changed();
  }

  // ── The plant of the screen (Rencontres) ─────────────────────────────

  /**
   * Does this game show one plant chosen (Rencontres: kit/around.js#chosenContext) — the map, the photos and the sheet
   * on it —, or a plant opened in its sheet (?p=: Cueillette prudente, Mosaïque)?
   */
  get chooses() { return 'sheet' in this.app.m.context; }

  /**
   * The plant of the screen, the one source of what the map lights, the photos and the sheet show: the plant chosen
   * (the context's `focus`, the address's ?p=) — else, before any heart, the card on top of the deck (followed as it
   * is swiped). None in a game that does not choose (its sheet is the context's `focus`).
   * @returns {number | null}
   */
  get chosenId() {
    if (!this.chooses) return null;
    return this.c.focus ?? this.deck[0]?.plant.id ?? null;
  }

  /** The card of the plant of the screen (none while the cards are not there). */
  get chosenCard() {
    const id = this.chosenId;
    return id == null ? undefined : (this.cards || []).find(c => c.plant.id === id);
  }

  /**
   * A plant chosen — a heart, the sheet's « Suivante », a point of the map, a tile: every pane follows it, and the
   * address (a new entry: Back returns to the one before, gf-miniapp.js). Its first image shown. `sheet`: its sheet
   * opened too. @param {number} id @param {{ sheet?: boolean }} [o]
   */
  choose(id, o = {}) {
    /** @type {Record<string, unknown>} */
    const patch = {};
    if (this.c.focus !== id) Object.assign(patch, { focus: id, mediaAt: null });
    if (o.sheet && !this.c.sheet) patch.sheet = true;
    if (Object.keys(patch).length) this.app.set(patch);
  }

  /** The deck's swipe hint: not shown yet in this app (and now it is). */
  hintOnce() {
    if (hinted.has(this.app.m.id)) return false;
    hinted.add(this.app.m.id);
    return true;
  }

  /** The view of the list (the context's, the address's &v=; none chosen: the app's own, `fallback`). @param {string} fallback */
  viewOr(fallback) { return viewOfWord(this.c.view) ?? fallback; }
  /**
   * Another view of the list (none: the app's own, `own`, which the address does not write).
   * @param {string | null} view @param {string} [own]
   */
  setView(view, own) {
    const word = view && view !== own ? VIEW_WORDS[/** @type {keyof typeof VIEW_WORDS} */ (view)] ?? null : null;
    if (word !== this.c.view) this.app.set({ view: word });
    this.changed();
  }

  // ── Where ─────────────────────────────────────────────────────────────

  /**
   * The place chosen (a position: its commune found, IGN): kept by the app; the cards of another place to search
   * again. The first one of a game begins it: Rencontres' way is decided then, for the whole game (its `guided`:
   * during the first steps of the app, its guided way — kit/around.js#guidedWay). @param {[number, number]} point
   * @param {string | null} place
   */
  async setPoint(point, place) {
    this.app.set({ point, place, ...(this.c.guided === null ? { guided: discovering() } : {}) });
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

  /**
   * The observations in the circle (the map): asked again 250 ms after the place or the distance changed (the slider
   * at rest); meanwhile `obsLoading` (the map dims the points shown, its circle breathing). A request overtaken by
   * another is cancelled, and a late answer for another circle dropped.
   */
  watchPoints() {
    const { point, radius } = this.c;
    const key = point ? radius + ':' + point : '';
    if (!key || key === this.pointsFor) return;
    const first = !this.pointsFor && !this.obs.length;
    this.pointsFor = key;
    clearTimeout(this.timers.points);
    this.pointsAbort?.abort();
    this.pointsAbort = null;
    if (!this.obsLoading) { this.obsLoading = true; queueMicrotask(() => this.changed()); }
    if (first) { this.#loadPoints(); return; }
    this.timers.points = setTimeout(() => this.#loadPoints(), 250);
  }

  async #loadPoints() {
    const { point, radius } = this.c;
    if (!point) return;
    const abort = this.pointsAbort = new AbortController();
    const found = await observationPointsAround(point, radius, abort.signal).catch(() => (abort.signal.aborted ? null : { points: [], total: 0 }));
    if (!found || abort.signal.aborted || this.pointsAbort !== abort) return;
    this.pointsAbort = null;
    if (this.c.point === point && this.c.radius === radius) { this.obs = found.points; this.obsTotal = found.total; this.obsLoading = false; this.changed(); }
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
      // Rencontres, Mosaïque: the most observed. Cueillette prudente: every plant read, ordered, then cut — a deadly
      // plant seen once (a colchique at 20 km) never falls behind the most observed ones.
      const known = (found?.species || []).filter(s => s.plantId);
      const species = harvest ? known : known.slice(0, MAX_CARDS);
      const cards = (await Promise.all(species.map(async s => {
        const plant = await getPlant(/** @type {number} */ (s.plantId));
        if (!plant) return null;
        // iNaturalist's photo (a free licence only, nearby.js), else the flora's thumbnail: each with its credit.
        /** @type {Card} */
        const card = { plant, taxonId: s.taxonId, count: s.count, photo: s.photo ? s.photo.replace(/\/square\./, '/medium.') : plant.thumbnail?.url || null,
          credit: s.photo ? s.credit : thumbCredit(plant.thumbnail), blooming: floweringMonths(plant.flowering).has(month), verdict: null };
        return card;
      }))).filter(c => c !== null);
      if (abort.signal.aborted) return;
      let list = /** @type {Card[]} */ (cards);
      if (harvest) {
        // Cueillette prudente: only the plants of the Anses / Centres antipoison confusions, the deadly first. The list
        // unreadable: said, with every plant (each card says it too), never « none to pick ».
        let unread = false;
        for (const c of list) {
          if (abort.signal.aborted) return;
          c.confusions = await lookalikesOf(c.plant).catch(error => { console.error(error); unread = true; return []; });
          if (unread) break;
        }
        if (abort.signal.aborted) return;
        this.unread = unread;
        list = harvestOrder(list, unread).slice(0, MAX_CARDS);
        // A toxic look-alike matched before the game knew better: recognised, to avoid — never a match, and the
        // favourite that match made taken back (not one the user made their own).
        const wrong = new Set(list.filter(c => toAvoid(c) && this.c.matches.includes(c.plant.id)).map(c => c.plant.id));
        if (wrong.size) {
          this.app.set({ matches: this.c.matches.filter((/** @type {number} */ id) => !wrong.has(id)),
            avoided: [...(this.c.avoided ?? []).filter((/** @type {number} */ id) => !wrong.has(id)), ...wrong] });
          for (const id of wrong) forgetFavoriteMadeBy(id, this.app.m.id);
        }
      } else list = aroundOrder(list);
      this.cards = list;
      // The verdict on each plant (local data; its protection here, at the circle's centre), as they come.
      for (const c of list) verdictOf(c.plant, { at: point }).then(v => { c.verdict = v; this.changed(); }, () => {});
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

  /** Cueillette prudente: the toxic look-alikes recognised, to avoid (never among the matches). */
  get avoidCards() {
    const ids = this.c.avoided ?? [];
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
   * Cueillette prudente: is this card's right « recognised, to avoid »? A toxic look-alike (cards.js#toAvoid) — and,
   * the list of the confusions unreadable, every card: the game cannot tell a plant's side, so none is a match (fail
   * closed). The other games: never. @param {Card} card
   */
  avoids(card) { return this.harvest && (this.unread || card.confusions === undefined || toAvoid(card)); }

  /**
   * A card swiped: right, a match (kept by the app, and in the favourites); left, passed. Cueillette prudente: a card
   * to avoid (avoids) swiped right is recognised, to avoid — never a match nor a favourite, whatever asked it (a
   * button, a swipe, a key). It can be undone (↺). Returns whether the match put it in the favourites.
   * @param {Card} card @param {boolean} liked
   */
  swiped(card, liked) {
    const id = card.plant.id;
    const avoided = liked && this.avoids(card);
    const match = liked && !avoided;
    const fav = match && !isFavorite(id);
    // Rencontres: a heart chooses the plant loved (until the next one; a pass changes nothing) — the plant chosen
    // before kept for its ↺.
    const choose = match && this.chooses;
    this.history = [...this.history, { id, liked: match, fav, ...(choose ? { was: this.c.focus } : {}) }].slice(-30);
    this.app.set(avoided ? avoid(this.c, id) : { ...swipe(this.c, id, match), ...(choose && this.c.focus !== id ? { focus: id, mediaAt: null } : {}) });
    this.app.seen(id);
    if (match) {
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
    // The heart that chose the plant undone: the plant chosen before it (none: the card on top again).
    const back = last.liked && this.chooses && 'was' in last && this.c.focus === last.id ? { focus: last.was ?? null, mediaAt: null } : {};
    this.app.set({ ...unswipe(this.c, last.id), ...back });
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

  /** The cards passed (and those recognised to avoid, Cueillette prudente), to see them again. */
  resetPassed() { this.app.set({ passed: [], avoided: [] }); }

  /** A plant brought on top of the deck (touched on the map or in the list around). @param {Card} card */
  toTop(card) {
    this.cards = [card, ...(this.cards || []).filter(c => c !== card)];
    this.changed();
  }

  /** Its requests and timers stopped (the app gone, or played again). */
  dispose() {
    this.abort?.abort();
    this.pointsAbort?.abort();
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
