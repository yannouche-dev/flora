// @ts-check
// « Découvrir » : the first steps in the app. The flora around the user comes first, in big cards; after the
// first match, the plant opens bare and the app shows itself step by step, each step offered by a banner with a
// question (`step`): 1 its photos, 2 its encyclopedia, 3 a choice — picking (its uses, look-alikes, season) or
// science (maps, distribution, climate, classification) — whose dashboard joins the plant (`branch`), 4 the
// plants around, 5 the whole sheet and every tool, the app as it is (the way chosen is offered for the whole app by a
// button that says so: kit/ma-guided.js).
// The tabs come when they become useful — and stay: Mes plantes with the first favourite, the Carte with the
// first place noted, Flore after a few plants discovered. Someone who already used the app starts with everything.
// The games around a place (Rencontres, Cueillette prudente, Mosaïque) keep their own place, distance and cards, each
// with its mini-app (core/around-sessions.js); the session they shared here before is handed over once, to the one
// played last.

import { config } from '../config.js';
import { clearAroundGames, migrateDiscover } from './around-sessions.js';
import { listCollections, spotEvents, FAVORITES_ID } from './collections.js';
import { onStorage } from './sync.js';
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

/**
 * @typedef {{ done: boolean, unlocked: Unlockable[], tips: string[], seen: number[],
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
  const fresh = { done: false, unlocked: [], tips: [], seen: [], step: 0, firstMatch: false, branch: null };
  const saved = readJSON(KEY, null);
  if (saved && typeof saved === 'object') {
    // The session of the games around a place, kept here before: theirs now (once; written back without it).
    if (HANDED.some(k => k in saved)) {
      migrateDiscover(saved, typeof location === 'object' ? location.hash : '');
      for (const k of HANDED) delete saved[k];
      writeJSON(KEY, saved);
    }
    return { ...fresh, ...saved };
  }
  return usedBefore() ? { ...fresh, done: true } : fresh;
}

let state = read();
// Written at once: on the next visit, the app's other settings no longer mean « used before » (not written: kept for
// this visit).
writeJSON(KEY, state);

/** Fires `change` (detail: the state) and `unlock` (detail: the tab). */
export const discoverEvents = new EventTarget();

/** @param {Partial<DiscoverState>} patch */
function save(patch) {
  state = { ...state, ...patch };
  writeJSON(KEY, state);
  discoverEvents.dispatchEvent(new CustomEvent('change', { detail: state }));
}

export const discoverState = () => state;
/** The first steps are on (tools still to come). */
export const discovering = () => !state.done;
/** A tab is there: everything once the first steps are over. @param {string} tab */
export const tabShown = tab => state.done || tab === 'discover' || tab === 'more' || state.unlocked.includes(/** @type {Unlockable} */ (tab));

/** A tool comes (once), announced. @param {Unlockable} tab */
export function unlock(tab) {
  if (state.done || state.unlocked.includes(tab)) return;
  const unlocked = [...state.unlocked, tab];
  // Everything is there: the first steps are over.
  save({ unlocked, done: Object.keys(UNLOCKS).every(k => unlocked.includes(/** @type {Unlockable} */ (k))) });
  discoverEvents.dispatchEvent(new CustomEvent('unlock', { detail: tab }));
}

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
  if (state.seen.length >= PLANTS_BEFORE_FLORE) unlock('flore');
}

/**
 * Rencontres played again (« Rejouer » of the mini-app, which empties its own place, distance and cards): the steps
 * of its guided way and the fork forgotten. Not the first steps of the app (the tabs that came, the tips, the plants
 * seen), nor the favourites: they are the user's.
 */
export const replayMeet = () => save({ step: 0, firstMatch: false, branch: null });

/** Everything at once (« Tout montrer »). */
export function finishDiscover() { save({ done: true, step: LAST_STEP }); }

/**
 * The first steps again (Réglages › « Recommencer la découverte »): every choice and all progress forgotten — the
 * steps and the fork, the tabs that had come, and the games around a place (Rencontres, Cueillette prudente,
 * Mosaïque: their place, distance, cards and matches). (The favourites stay: they are the user's.) The maps' first-use
 * hints are forgotten by its caller (gf-settings.js: core/hints.js, not at the start of the app).
 */
export function restartDiscover() {
  clearAroundGames();
  save({ done: false, unlocked: [], tips: [], seen: [], step: 0, firstMatch: false, branch: null });
}

// Changed in another tab (a game played again there): read again, never overwritten with this tab's older copy.
onStorage(KEY, () => {
  state = read();
  discoverEvents.dispatchEvent(new CustomEvent('change', { detail: state }));
});

// A favourite brings Mes plantes; a place noted, the Carte.
spotEvents.addEventListener('change', async () => {
  if (state.done) return;
  const all = await listCollections().catch(() => []);
  if (all.some(c => c.id === FAVORITES_ID && c.properties.plants.length) || all.some(c => c.id !== FAVORITES_ID)) unlock('mine');
  if (all.some(c => c.geometry)) unlock('map');
});
