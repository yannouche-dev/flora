// @ts-check
// « Découvrir » : the first steps in the app. The flora around the user comes first, in big cards; each tool
// shows up when it becomes useful — and stays: Mes plantes with the first favourite, the Carte with the first
// place noted, Flore (the whole flora, search and filters) after a few plants discovered. One tip at a time,
// on the real element; each one is shown once. Someone who already used the app starts with everything.

import { config } from '../config.js';
import { listCollections, spotEvents, FAVORITES_ID } from './collections.js';

const KEY = 'geoflora.discover';
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
 *   point: [number, number] | null, place: string | null, radius: number, matches: number[], passed: number[] }} DiscoverState
 */

/** Someone who already used the app (any setting of it): no first steps. */
function usedBefore() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      // Not the keys every visit writes by itself (where the user is, the modules' defaults).
      if (k.startsWith('geoflora.') && ![KEY, config.storageKeys.modules, config.storageKeys.context].includes(k)) return true;
    }
  } catch { /* no storage: first steps every time, harmless */ }
  return false;
}

/** @returns {DiscoverState} */
function read() {
  const fresh = { done: false, unlocked: [], tips: [], seen: [], point: null, place: null, radius: 1000, matches: [], passed: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved === 'object') return { ...fresh, ...saved };
  } catch { /* fresh */ }
  return usedBefore() ? { ...fresh, done: true } : fresh;
}

let state = read();
// Written at once: on the next visit, the app's other settings no longer mean « used before ».
try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* kept for this visit */ }

/** Fires `change` (detail: the state) and `unlock` (detail: the tab). */
export const discoverEvents = new EventTarget();

/** @param {Partial<DiscoverState>} patch */
function save(patch) {
  state = { ...state, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* kept for this visit */ }
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

/** A tip was shown and understood. @param {string} id */
export function tipDone(id) { if (!state.tips.includes(id)) save({ tips: [...state.tips, id] }); }
/** @param {string} id */
export const tipSeen = id => state.tips.includes(id);

/** A plant discovered (its sheet opened). @param {number} id */
export function plantSeen(id) {
  if (state.seen.includes(id)) return;
  save({ seen: [...state.seen, id].slice(-200) });
  if (state.seen.length >= PLANTS_BEFORE_FLORE) unlock('flore');
}

/** Where the user discovers (their position or a commune), kept for the next visit. @param {[number, number]} point @param {string | null} place */
export const setDiscoverPoint = (point, place) => save({ point, place });

/** The distance of the search, in metres. @param {number} radius */
export const setDiscoverRadius = radius => save({ radius });

/**
 * A card swiped: right, a match (kept); left, passed (not shown again here). @param {number} id @param {boolean} liked
 */
export function swiped(id, liked) {
  save(liked ? { matches: [...state.matches.filter(x => x !== id), id], passed: state.passed.filter(x => x !== id) }
    : { passed: [...state.passed.filter(x => x !== id), id].slice(-500), matches: state.matches.filter(x => x !== id) });
  plantSeen(id);
}

/** A card back in the deck (« ↺ »: the last swipe undone, or a match taken back). @param {number} id */
export const unswipe = id => save({ matches: state.matches.filter(x => x !== id), passed: state.passed.filter(x => x !== id) });

/** The cards passed, to see them again. */
export const resetPassed = () => save({ passed: [] });

/** Everything at once (« Tout montrer »). */
export function finishDiscover() { save({ done: true }); }

/** The first steps again (Réglages). */
export function restartDiscover() { save({ done: false, unlocked: [], tips: [], seen: [], passed: [] }); }

// A favourite brings Mes plantes; a place noted, the Carte.
spotEvents.addEventListener('change', async () => {
  if (state.done) return;
  const all = await listCollections().catch(() => []);
  if (all.some(c => c.id === FAVORITES_ID && c.properties.plants.length) || all.some(c => c.id !== FAVORITES_ID)) unlock('mine');
  if (all.some(c => c.geometry)) unlock('map');
});
