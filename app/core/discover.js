// @ts-check
// « Découvrir » : the first steps in the app. The flora around the user comes first, in big cards; after the
// first match, the plant opens bare and the app shows itself step by step, each step offered by a banner with a
// question (`step`): 1 its photos, 2 its encyclopedia, 3 a choice — picking (its uses, look-alikes, season) or
// science (maps, distribution, climate, classification) — whose dashboard joins the plant (`branch`), 4 the
// plants around, 5 the whole sheet and every tool, the app as it is (the way chosen is offered for the whole app by a
// button that says so: kit/ma-guided.js).
// The tabs come when they become useful — and stay: Mes plantes with a favourite, a liste or a lieu, the Carte with a
// lieu, Flore after a few plants discovered. They are worked out from what the device holds and the plants met
// (unlocksFrom): at the start, on each change of Mes plantes (an import, a transfer link, a restore included) and after
// « Revoir les premiers pas ». The first steps hide a tab, never an address: a screen shown brings its tab (arrivedAt).
// Someone who already used the app starts with everything.
// The games around a place (Rencontres, Cueillette prudente, Mosaïque) keep their own place, distance and cards, each
// with its mini-app (core/around-sessions.js); the session they shared here before is handed over once, to the one
// played last.

import { config } from '../config.js';
import { AROUND_APPS, clearAroundGames, migrateDiscover } from './around-sessions.js';
import { adoptMadeBy, getMembership, listCollections, spotEvents } from './collections.js';
import { onStorage, publish } from './sync.js';
import { readJSON, storedKeys, writeJSON } from './prefs.js';

const KEY = config.storageKeys.discover;
/** Plants discovered before Flore (the whole flora, search and filters) comes. */
export const PLANTS_BEFORE_FLORE = 5;

/** @typedef {'mine' | 'map' | 'flore'} Unlockable */
/** @type {Record<Unlockable, { label: string, text: string }>} */
export const UNLOCKS = {
  mine: { label: 'Mes plantes', text: 'vos favoris, vos listes et vos lieux, gardés sur l’appareil' },
  map: { label: 'Carte', text: 'vos lieux, les plantes notées et ce qui pousse autour' },
  flore: { label: 'Flore', text: 'toute la flore de France : chercher, filtrer, comparer' }
};
/** The tabs that come, in UNLOCKS' order. */
const TABS = /** @type {Unlockable[]} */ (Object.keys(UNLOCKS));
/** The tabs a stored list names, in UNLOCKS' order (anything else dropped). @param {unknown} v @returns {Unlockable[]} */
const tabsIn = v => Array.isArray(v) ? TABS.filter(t => v.includes(t)) : [];

/**
 * @typedef {{ done: boolean, unlocked: Unlockable[], seen: number[],
 *   step: number, firstMatch: boolean, branch: 'harvest' | 'science' | null }} DiscoverState
 */
/** What the games around a place kept here before (handed over to them: around-sessions.js#migrateDiscover). */
const HANDED = ['point', 'place', 'radius', 'matches', 'passed'];

/** Someone who already used the app (any setting of it): no first steps. */
function usedBefore() {
  // Not the keys every visit writes by itself (where the user is, the modules' defaults), nor those of a layout or a
  // mini-app: a new visitor who drags a separator or opens a mini-app keeps the first steps. No storage: first steps
  // every time, harmless.
  const own = [KEY, config.storageKeys.modules, config.storageKeys.context, config.storageKeys.showSteps, ...config.paneLayouts];
  return storedKeys(config.storagePrefix).some(k => !k.startsWith(config.storageKeys.appPrefix) && !own.includes(k));
}

/** @returns {DiscoverState} */
function read() {
  /** @type {DiscoverState} */
  const fresh = { done: false, unlocked: [], seen: [], step: 0, firstMatch: false, branch: null };
  const saved = readJSON(KEY, null);
  if (saved && typeof saved === 'object') {
    // The session of the games around a place, kept here before: theirs now (once; written back without it).
    if (HANDED.some(k => k in saved)) {
      migrateDiscover(saved, typeof location === 'object' ? location.hash : '');
      for (const k of HANDED) delete saved[k];
      writeJSON(KEY, saved);
    }
    // The tips of before (never read) dropped; the tabs only those that come.
    const kept = { ...saved };
    delete kept.tips;
    return { ...fresh, ...kept, unlocked: tabsIn(saved.unlocked) };
  }
  return usedBefore() ? { ...fresh, done: true } : fresh;
}

let state = read();
// Written at once: on the next visit, the app's other settings no longer mean « used before » (not written: kept for
// this visit).
/** This tab's last state not written (the storage full or switched off): it holds for this visit (stored()). */
let unsaved = !writeJSON(KEY, state);

/** Fires `change` (detail: the state) and `unlock` (detail: the tab). */
export const discoverEvents = new EventTarget();

/** @param {Partial<DiscoverState>} patch */
function save(patch) {
  state = { ...state, ...patch };
  unsaved = !writeJSON(KEY, state);
  discoverEvents.dispatchEvent(new CustomEvent('change', { detail: state }));
}

export const discoverState = () => state;
/** The first steps are on (tools still to come). */
export const discovering = () => !state.done;
/** A tab is there: everything once the first steps are over. @param {string} tab */
export const tabShown = tab => state.done || tab === 'discover' || tab === 'more' || state.unlocked.includes(/** @type {Unlockable} */ (tab));

/**
 * The state as stored now, read before a tab comes: another tab's progress (its step, its plants seen) is never
 * written back with an older copy. Not when this tab's last state could not be written: what is stored then is older,
 * or nothing, and the tabs that came meanwhile would go.
 */
function stored() {
  if (!unsaved) state = read();
}

/** How many works run quietly now (quietly()). */
let hushed = 0;

/**
 * The tabs there now (`unlocked`, the ones there before first), written when one comes — all three: the first steps
 * are over — then each new one announced (`unlock`), unless quiet. Its callers read the state as stored first (stored()).
 * @param {Unlockable[]} unlocked @param {boolean} quiet
 */
function grant(unlocked, quiet) {
  const added = unlocked.filter(t => !state.unlocked.includes(t));
  if (!added.length) return;
  save({ unlocked, done: TABS.every(t => unlocked.includes(t)) });
  if (!quiet && !hushed) for (const tab of added) discoverEvents.dispatchEvent(new CustomEvent('unlock', { detail: tab }));
}

/** A tool comes (once), announced — also the tests' way to give one (miniapp-scope.spec.mjs). @param {Unlockable} tab */
export function unlock(tab) {
  if (tabShown(tab)) return;
  stored();
  if (!tabShown(tab)) grant([...state.unlocked, tab], false);
}

/**
 * What the device holds, counted from Mes plantes' summaries (collections.js getMembership().collections, or a list
 * read at the start): the favourites' plants, the listes, the lieux (a parcours is one).
 * @param {readonly { kind: string, count: number }[]} summaries
 */
export const holdingsOf = summaries => ({
  favorites: summaries.find(c => c.kind === 'favorites')?.count ?? 0,
  lists: summaries.filter(c => c.kind === 'list').length,
  places: summaries.filter(c => c.kind === 'place').length
});

/**
 * The tabs the first steps show: Mes plantes with a favourite, a liste or a lieu (even empty), the Carte with a lieu
 * (a parcours, a shared lieu saved), Flore once PLANTS_BEFORE_FLORE plants were met in the activities. The tabs already
 * there (`floor`: come with their data, an address, or before) stay, first, in their order.
 * @param {{ favorites: number, lists: number, places: number, seen: number }} held
 * @param {readonly Unlockable[]} [floor]
 * @returns {Unlockable[]}
 */
export function unlocksFrom({ favorites, lists, places, seen }, floor = []) {
  const earned = { mine: favorites > 0 || lists > 0 || places > 0, map: places > 0, flore: seen >= PLANTS_BEFORE_FLORE };
  return [...floor, ...TABS.filter(t => earned[t] && !floor.includes(t))];
}

/**
 * The tabs the device's data and progress bring, given: on every change of Mes plantes (here or in another tab), with a
 * plant met, at the start and after « Revoir les premiers pas » (quiet). Nothing once the first steps are over.
 * @param {{ quiet?: boolean, summaries?: readonly { kind: string, count: number }[] }} [o]
 */
export function recomputeUnlocks({ quiet = false, summaries = getMembership().collections } = {}) {
  if (state.done) return;
  stored();
  if (state.done) return;
  grant(unlocksFrom({ ...holdingsOf(summaries), seen: state.seen.length }, state.unlocked), quiet);
}

/** At the start (main.js, the base open): the tabs the device's listes and lieux bring, quietly. */
export async function unlocksAtStart() {
  if (state.done) return;
  const all = await listCollections();
  recomputeUnlocks({ quiet: true, summaries: all.map(c => ({ kind: c.properties.kind, count: c.properties.plants.length })) });
}

/** `work` done, the tabs it brings coming quietly (the collections put back after a repair: main.js). @template T @param {() => Promise<T>} work */
export async function quietly(work) {
  hushed++;
  try { return await work(); } finally { hushed--; }
}

/** The tab of each screen, for the first steps (Découvrir, an activity, Réglages and its screens, a page not found: none). */
const TAB_OF = /** @type {Partial<Record<string, Unlockable>>} */ ({ search: 'flore', plant: 'flore', map: 'map', collections: 'mine', spot: 'mine', 'spot-new': 'mine', shared: 'mine' });

/**
 * A screen shown — a link, a bookmark, a shared link, a link of the app, Back —: its tab comes with it. The first steps
 * hide a tab, never an address. The start (`#/` alone) is Découvrir's: its caller leaves it out. Called first by
 * context.js#follow, before anything draws the screen. Nothing is read while its tab is there: a search typed calls it
 * at each key. @param {string} screen a route's name (core/router.js)
 */
export function arrivedAt(screen) {
  const tab = TAB_OF[screen];
  if (!tab || tabShown(tab)) return;
  stored();
  if (!tabShown(tab)) grant([...state.unlocked, tab], true);
}

/** Plants still to meet before Flore comes (« Encore N plantes… »): 0 once it is there. */
export const plantsBeforeFlore = () => tabShown('flore') ? 0 : Math.max(0, PLANTS_BEFORE_FLORE - state.seen.length);

/** The last step of the discovery reached (see the top). @param {number} step */
export function setStep(step) {
  if (step <= state.step) return;
  save({ step });
  if (step >= LAST_STEP) finishDiscover();
}
/** Back to an earlier step (« Précédent »): before the fork, the way chosen is forgotten. @param {number} step */
export function stepBack(step) {
  if (step >= state.step || step < 0) return;
  save(step < 3 ? { step, branch: null } : { step });
}
/** The step that ends the discovery (the whole app). */
export const LAST_STEP = 5;

/** The way chosen at the fork (step 3): picking or science. @param {'harvest' | 'science'} branch */
export function chooseBranch(branch) {
  save({ branch });
  setStep(3);
}

/** The first match celebrated (once): the next ones only get a heart. */
export const firstMatchShown = () => save({ firstMatch: true });

/**
 * A plant discovered, in any mini-app (a card swiped, a plant opened, chosen or noted in a parcours: the event `seen`
 * of miniapp/runtime.js, counted by its box). @param {number} id
 */
export function plantSeen(id) {
  if (state.seen.includes(id)) return;
  save({ seen: [...state.seen, id].slice(-200) });
  recomputeUnlocks();
}

/**
 * Rencontres started again (its « Recommencer », which empties its own place, distance and cards): the steps
 * of its guided way and the fork forgotten. Not the first steps of the app (the tabs that came, the plants seen),
 * nor the favourites: they are the user's. Applied to the state as stored now: the first steps started again in
 * another tab (restartDiscover, which empties an open game here too) are never written back with this tab's older copy.
 */
export function replayMeet() {
  state = read();
  save({ step: 0, firstMatch: false, branch: null });
}

/** Everything at once (« Tout montrer »). */
export function finishDiscover() { save({ done: true, step: LAST_STEP }); }

/**
 * The first steps again (Réglages › « Revoir les premiers pas », asked first): every choice and all progress
 * forgotten — the steps and the fork, the tabs that had come (but those the favourites, listes and lieux kept bring:
 * there at once, not announced), and the activities around a place (Rencontres, Cueillette prudente, Mosaïque: their
 * place, distance, cards and matches), here and in the other tabs (one open there is emptied as by its « Recommencer »).
 * The favourites stay, and those their matches added become the user's first (adoptMadeBy: no « Recommencer » takes
 * them later) — nothing is forgotten if that fails. The maps' first-use hints are forgotten by its caller
 * (gf-settings.js: core/hints.js, not at the start of the app). Resolves with how many favourites became the user's.
 * @returns {Promise<number>}
 */
export async function restartDiscover() {
  const adopted = await adoptMadeBy(AROUND_APPS);
  clearAroundGames();
  save({ done: false, unlocked: [], seen: [], step: 0, firstMatch: false, branch: null });
  // The tabs the favourites, listes and lieux kept still bring (Mes plantes, the Carte): there at once, not announced.
  recomputeUnlocks({ quiet: true });
  for (const id of AROUND_APPS) publish('miniapp', { id, op: 'replay' });
  return adopted;
}

// Changed in another tab (a game played again there): read again, never overwritten with this tab's older copy.
onStorage(KEY, () => {
  state = read();
  unsaved = false;
  discoverEvents.dispatchEvent(new CustomEvent('change', { detail: state }));
});

// Mes plantes changed, here or in another tab (an import, a transfer link, a shared list saved, a restore, a favourite,
// a lieu noted): the tabs its favourites, listes and lieux bring. Synchronous: membership is refreshed before every
// change is fired (collections.js changed(), subscribe('spots')), and quietly() holds over it.
spotEvents.addEventListener('change', () => recomputeUnlocks());
