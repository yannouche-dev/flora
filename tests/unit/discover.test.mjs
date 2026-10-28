// The first steps' tabs (app/core/discover.js): worked out from what the device holds — a favourite, a liste or a lieu
// bring Mes plantes, a lieu the Carte — and from the plants met (5: Flore), and kept (a tab that came stays: the floor);
// a screen shown brings its tab, quietly, `#/` alone none (its caller, context.js, leaves it out); the start, a repair's
// restore and « Revoir les premiers pas » bring theirs quietly too. The state of before read again: its tips (never
// read) dropped, its tabs only those that come; a state the storage refused keeps its tabs. Against an IndexedDB in
// memory (fake-indexeddb). The module reads and writes as it loads, and this file is its own process: the tests run in
// order, on one state.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// db.js upgrades the schema only from a page (a worker opens whatever version exists).
/** @type {any} */ (globalThis).window ??= globalThis;
// No service answers here (the altitudes of a lieu are asked in the background): refused at once.
const nodeFetch = globalThis.fetch;
globalThis.fetch = /** @type {any} */ (async (/** @type {any} */ input, /** @type {any} */ init) =>
  String(input instanceof Request ? input.url : input).startsWith('file:') ? nodeFetch(input, init) : new Response('', { status: 503 }));

const KEY = 'geoflora.discover';
// A device of before: its tips, a tab that no longer exists, two plants met.
localStorage.setItem(KEY, JSON.stringify({ done: false, unlocked: ['map', 'nope'], tips: ['x'], seen: [1, 2], step: 0 }));

const d = await import('../../app/core/discover.js');
const c = await import('../../app/core/collections.js');

/** The state as stored. */
const stored = () => JSON.parse(localStorage.getItem(KEY) || 'null');
/** The tabs announced (`unlock`) while `work` runs. @param {() => unknown} work */
async function announced(work) {
  /** @type {string[]} */ const tabs = [];
  const on = (/** @type {Event} */ e) => tabs.push(/** @type {CustomEvent} */ (e).detail);
  d.discoverEvents.addEventListener('unlock', on);
  try { await work(); } finally { d.discoverEvents.removeEventListener('unlock', on); }
  return tabs;
}
/** How many times the first steps are written while `work` runs. @param {() => unknown} work */
async function writes(work) {
  const set = localStorage.setItem;
  let n = 0;
  localStorage.setItem = (k, v) => { if (k === KEY) n++; set.call(localStorage, k, v); };
  try { await work(); } finally { localStorage.setItem = set; }
  return n;
}

test('l’état d’avant relu : ses astuces oubliées, ses onglets seulement ceux qui viennent', () => {
  assert.deepEqual(d.discoverState().unlocked, ['map']);
  assert.deepEqual(d.discoverState().seen, [1, 2]);
  assert.equal('tips' in d.discoverState(), false);
  // Written back once, cleaned.
  assert.equal('tips' in stored(), false);
  assert.deepEqual(stored().unlocked, ['map']);
});

test('unlocksFrom : les onglets de ce que l’appareil garde et des plantes rencontrées, ceux déjà venus gardés', () => {
  const none = { favorites: 0, lists: 0, places: 0, seen: 0 };
  assert.deepEqual(d.unlocksFrom(none), []);
  assert.deepEqual(d.unlocksFrom({ ...none, favorites: 1 }), ['mine']);
  // An empty list too.
  assert.deepEqual(d.unlocksFrom({ ...none, lists: 1 }), ['mine']);
  assert.deepEqual(d.unlocksFrom({ ...none, places: 1 }), ['mine', 'map']);
  assert.deepEqual(d.unlocksFrom({ ...none, seen: 4 }), []);
  assert.deepEqual(d.unlocksFrom({ ...none, seen: d.PLANTS_BEFORE_FLORE }), ['flore']);
  // A tab that came stays, first, in its order.
  assert.deepEqual(d.unlocksFrom(none, ['map']), ['map']);
  assert.deepEqual(d.unlocksFrom({ ...none, favorites: 1 }, ['map']), ['map', 'mine']);
});

test('holdingsOf : les plantes des favoris, les listes, les lieux (même vides)', () => {
  assert.deepEqual(d.holdingsOf([{ kind: 'favorites', count: 0 }, { kind: 'list', count: 0 }, { kind: 'place', count: 2 }]), { favorites: 0, lists: 1, places: 1 });
  assert.deepEqual(d.holdingsOf([]), { favorites: 0, lists: 0, places: 0 });
});

test('arrivedAt : un écran montré fait venir son onglet, sans annonce ; Découvrir, une activité, Réglages et ses écrans aucun', async () => {
  const said = await announced(async () => {
    for (const screen of ['discover', 'app', 'settings', 'legal', 'layout', 'builder', 'not-found']) d.arrivedAt(screen);
    assert.deepEqual(d.discoverState().unlocked, ['map']);
    // Its tab there: nothing read, nothing written (a search typed calls it at each key).
    assert.equal(await writes(() => d.arrivedAt('map')), 0);
    // A share's preview, not saved yet: Mes plantes.
    d.arrivedAt('shared');
  });
  assert.deepEqual(d.discoverState().unlocked, ['map', 'mine']);
  assert.deepEqual(stored().unlocked, ['map', 'mine']);
  assert.equal(d.discoverState().done, false);
  assert.deepEqual(said, []);
});

test('recomputeUnlocks : ce qui est déjà là ne s’écrit ni ne s’annonce', async () => {
  const said = await announced(async () => {
    assert.equal(await writes(() => d.recomputeUnlocks({ quiet: true, summaries: [{ kind: 'favorites', count: 1 }] })), 0);
    assert.equal(await writes(() => d.recomputeUnlocks({ summaries: [{ kind: 'place', count: 0 }] })), 0);
  });
  // Read again as stored: in UNLOCKS' order.
  assert.deepEqual(d.discoverState().unlocked, ['mine', 'map']);
  assert.deepEqual(said, []);
});

test('plantSeen : Flore à la 5e plante rencontrée, annoncée, et les premiers pas finis', async () => {
  assert.equal(d.plantsBeforeFlore(), 3);
  const said = await announced(() => { d.plantSeen(3); d.plantSeen(4); });
  assert.deepEqual(said, []);
  assert.equal(d.discoverState().unlocked.includes('flore'), false);
  assert.equal(d.plantsBeforeFlore(), 1);
  assert.deepEqual(await announced(() => d.plantSeen(5)), ['flore']);
  assert.deepEqual(d.discoverState().unlocked, ['mine', 'map', 'flore']);
  assert.equal(d.discoverState().done, true);
  assert.equal(d.plantsBeforeFlore(), 0);
  // Over: no tab is worked out or written any more.
  assert.equal(await writes(() => { d.arrivedAt('plant'); d.recomputeUnlocks(); }), 0);
});

test('quietly : les onglets qu’apporte un travail viennent sans annonce', async () => {
  // « Revoir les premiers pas » with nothing kept: no tab.
  assert.deepEqual(await announced(() => d.restartDiscover()), []);
  assert.deepEqual(d.discoverState().unlocked, []);
  const said = await announced(() => d.quietly(async () => c.saveCollection(c.newPlace([4.8, 45.7], { name: 'Lisière' }))));
  assert.deepEqual(said, []);
  assert.deepEqual(d.discoverState().unlocked, ['mine', 'map']);
});

test('« Revoir les premiers pas » garde les onglets de vos listes et de vos lieux, là tout de suite, sans annonce', async () => {
  await c.saveCollection(c.newCollection('list', { name: 'Bois' }));
  d.finishDiscover();
  const said = await announced(() => d.restartDiscover());
  const s = d.discoverState();
  assert.deepEqual({ unlocked: s.unlocked, done: s.done, seen: s.seen }, { unlocked: ['mine', 'map'], done: false, seen: [] });
  assert.deepEqual(stored().unlocked, ['mine', 'map']);
  assert.deepEqual(said, []);
  // Flore waits for 5 new plants.
  assert.equal(d.plantsBeforeFlore(), d.PLANTS_BEFORE_FLORE);
});

test('un état qui n’a pas pu s’écrire (stockage plein) garde ses onglets', async () => {
  for (const each of await c.listCollections()) if (each.id !== c.FAVORITES_ID) await c.deletePlace(each.id);
  await d.restartDiscover();
  assert.deepEqual(d.discoverState().unlocked, []);
  const set = localStorage.setItem;
  localStorage.setItem = (k, v) => { if (k === KEY) throw new DOMException('Plein', 'QuotaExceededError'); set.call(localStorage, k, v); };
  try {
    d.arrivedAt('collections');
  } finally {
    localStorage.setItem = set;
  }
  assert.deepEqual(d.discoverState().unlocked, ['mine']);
  assert.deepEqual(stored().unlocked, []);
  // What is stored is older: Mes plantes stays.
  d.arrivedAt('map');
  assert.deepEqual(stored().unlocked, ['mine', 'map']);
});

test('unlocksAtStart : au démarrage, les listes et les lieux de l’appareil font venir leurs onglets, sans annonce', async () => {
  await c.saveCollection(c.newCollection('list', { name: 'Bois' }));
  await c.saveCollection(c.newPlace([4.8357, 45.7641], { name: 'Lisière nord' }));
  // A device of before (or « Revoir les premiers pas » of before): its lists and lieux, no tab.
  localStorage.setItem(KEY, JSON.stringify({ done: false, unlocked: [], seen: [], step: 0 }));
  assert.deepEqual(await announced(() => d.unlocksAtStart()), []);
  assert.deepEqual(d.discoverState().unlocked, ['mine', 'map']);
  assert.deepEqual(stored().unlocked, ['mine', 'map']);
});

test('unlock : un onglet donné, annoncé (les tests s’en servent)', async () => {
  assert.deepEqual(await announced(() => d.unlock('flore')), ['flore']);
  assert.equal(d.discoverState().done, true);
  assert.deepEqual(await announced(() => d.unlock('flore')), []);
});
