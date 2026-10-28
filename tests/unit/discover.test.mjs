// The first steps' tabs (app/core/discover.js): worked out from what the device holds — a favourite, a liste or a lieu
// bring Mes plantes, a lieu the Carte — and from the plants met (5: Flore), and kept (a tab that came stays: the floor);
// a screen shown brings its tab, `#/` alone none (its caller, context.js, leaves it out). Each tab that comes waits to
// be announced once (`announced`, pendingUnlocks, markAnnounced: gf-app shows it), in the bar's order; the start, a
// repair's restore and « Revoir les premiers pas » bring theirs quietly (announced at once), « Passer » and « Tout
// montrer maintenant » announce nothing. The state of before read again: its tips (never read) dropped, its tabs only
// those that come and announced then; a state the storage refused keeps its tabs. Against an IndexedDB in memory
// (fake-indexeddb). The module reads and writes as it loads, and this file is its own process: the tests run in order,
// on one state.
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
/** How many times the first steps are written while `work` runs. @param {() => unknown} work */
async function writes(work) {
  const set = localStorage.setItem;
  let n = 0;
  localStorage.setItem = (k, v) => { if (k === KEY) n++; set.call(localStorage, k, v); };
  try { await work(); } finally { localStorage.setItem = set; }
  return n;
}

test('l’état d’avant relu : ses astuces oubliées, ses onglets seulement ceux qui viennent, annoncés alors', () => {
  assert.deepEqual(d.discoverState().unlocked, ['map']);
  assert.deepEqual(d.discoverState().seen, [1, 2]);
  assert.equal('tips' in d.discoverState(), false);
  // No announcement replayed.
  assert.deepEqual(d.discoverState().announced, ['map']);
  assert.deepEqual(d.pendingUnlocks(), []);
  // Written back once, cleaned.
  assert.equal('tips' in stored(), false);
  assert.deepEqual(stored().unlocked, ['map']);
  assert.deepEqual(stored().announced, ['map']);
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

test('arrivedAt : un écran montré fait venir son onglet, à annoncer ; Découvrir, une activité, Réglages et ses écrans aucun', async () => {
  for (const screen of ['discover', 'app', 'settings', 'legal', 'layout', 'builder', 'not-found']) d.arrivedAt(screen);
  assert.deepEqual(d.discoverState().unlocked, ['map']);
  // Its tab there: nothing read, nothing written (a search typed calls it at each key).
  assert.equal(await writes(() => d.arrivedAt('map')), 0);
  assert.deepEqual(d.pendingUnlocks(), []);
  // A share's preview, not saved yet: Mes plantes, announced on that screen (gf-app).
  d.arrivedAt('shared');
  assert.deepEqual(d.discoverState().unlocked, ['map', 'mine']);
  assert.deepEqual(stored().unlocked, ['map', 'mine']);
  assert.equal(d.discoverState().done, false);
  assert.deepEqual(d.pendingUnlocks(), ['mine']);
});

test('markAnnounced : un onglet annoncé ne l’est plus, ici ni ailleurs', async () => {
  d.markAnnounced(['mine']);
  assert.deepEqual(d.pendingUnlocks(), []);
  assert.deepEqual(stored().announced, ['mine', 'map']);
  // Announced already: nothing written.
  assert.equal(await writes(() => d.markAnnounced(['mine', 'map'])), 0);
});

test('recomputeUnlocks : ce qui est déjà là ne s’écrit ni ne s’annonce', async () => {
  assert.equal(await writes(() => d.recomputeUnlocks({ quiet: true, summaries: [{ kind: 'favorites', count: 1 }] })), 0);
  assert.equal(await writes(() => d.recomputeUnlocks({ summaries: [{ kind: 'place', count: 0 }] })), 0);
  // Read again as stored: in UNLOCKS' order.
  assert.deepEqual(d.discoverState().unlocked, ['mine', 'map']);
  assert.deepEqual(d.pendingUnlocks(), []);
});

test('plantSeen : Flore à la 5e plante rencontrée, et les premiers pas finis ; elle reste à annoncer', async () => {
  assert.equal(d.plantsBeforeFlore(), 3);
  d.plantSeen(3);
  d.plantSeen(4);
  assert.equal(d.discoverState().unlocked.includes('flore'), false);
  assert.equal(d.plantsBeforeFlore(), 1);
  d.plantSeen(5);
  assert.deepEqual(d.discoverState().unlocked, ['mine', 'map', 'flore']);
  assert.equal(d.discoverState().done, true);
  assert.equal(d.plantsBeforeFlore(), 0);
  // The tab that ends the first steps keeps its announcement.
  assert.deepEqual(d.pendingUnlocks(), ['flore']);
  // Over: no tab is worked out or written any more.
  assert.equal(await writes(() => { d.arrivedAt('plant'); d.recomputeUnlocks(); }), 0);
  d.markAnnounced(['flore']);
  assert.deepEqual(d.pendingUnlocks(), []);
  // Over and announced: nothing written again (a device whose first steps are done keeps its footprint).
  assert.equal(await writes(() => d.markAnnounced(['flore', 'mine'])), 0);
});

test('quietly : les onglets qu’apporte un travail viennent sans annonce', async () => {
  // « Revoir les premiers pas » with nothing kept: no tab.
  await d.restartDiscover();
  assert.deepEqual(d.discoverState().unlocked, []);
  assert.deepEqual(d.discoverState().announced, []);
  await d.quietly(async () => c.saveCollection(c.newPlace([4.8, 45.7], { name: 'Lisière' })));
  assert.deepEqual(d.discoverState().unlocked, ['mine', 'map']);
  // Announced at once.
  assert.deepEqual(d.discoverState().announced, ['mine', 'map']);
  assert.deepEqual(d.pendingUnlocks(), []);
});

test('« Revoir les premiers pas » garde les onglets de vos listes et de vos lieux, là tout de suite, sans annonce', async () => {
  await c.saveCollection(c.newCollection('list', { name: 'Bois' }));
  d.finishDiscover();
  await d.restartDiscover();
  const s = d.discoverState();
  assert.deepEqual({ unlocked: s.unlocked, done: s.done, seen: s.seen }, { unlocked: ['mine', 'map'], done: false, seen: [] });
  assert.deepEqual(stored().unlocked, ['mine', 'map']);
  assert.deepEqual(stored().announced, ['mine', 'map']);
  assert.deepEqual(d.pendingUnlocks(), []);
  // Flore waits for 5 new plants.
  assert.equal(d.plantsBeforeFlore(), d.PLANTS_BEFORE_FLORE);
});

test('recomputeUnlocks : un onglet venu à annoncer, sauf sans annonce', async () => {
  for (const each of await c.listCollections()) if (each.id !== c.FAVORITES_ID) await c.deletePlace(each.id);
  await d.restartDiscover();
  assert.deepEqual(d.discoverState().unlocked, []);
  // A liste made: Mes plantes, to be announced.
  d.recomputeUnlocks({ summaries: [{ kind: 'list', count: 0 }] });
  assert.deepEqual(d.pendingUnlocks(), ['mine']);
  // A lieu put back quietly: the Carte, announced at once; Mes plantes still waits.
  d.recomputeUnlocks({ quiet: true, summaries: [{ kind: 'list', count: 0 }, { kind: 'place', count: 0 }] });
  assert.deepEqual(d.discoverState().unlocked, ['mine', 'map']);
  assert.deepEqual(d.discoverState().announced, ['map']);
  assert.deepEqual(d.pendingUnlocks(), ['mine']);
});

test('pendingUnlocks dans l’ordre de la barre ; « Tout montrer maintenant » n’annonce rien', async () => {
  await d.restartDiscover();
  assert.deepEqual(d.discoverState().unlocked, []);
  d.arrivedAt('collections');
  d.arrivedAt('map');
  d.arrivedAt('search');
  assert.deepEqual(d.discoverState().unlocked, ['mine', 'map', 'flore']);
  assert.equal(d.discoverState().done, true);
  // Flore, Carte, Mes plantes: as the bar shows them.
  assert.deepEqual(d.pendingUnlocks(), ['flore', 'map', 'mine']);
  d.finishDiscover();
  assert.deepEqual(d.pendingUnlocks(), []);
  assert.deepEqual(d.discoverState().unlocked, ['mine', 'map', 'flore']);
});

test('un état qui n’a pas pu s’écrire (stockage plein) garde ses onglets', async () => {
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
  // What is stored is older: Mes plantes stays, still to be announced.
  d.arrivedAt('map');
  assert.deepEqual(stored().unlocked, ['mine', 'map']);
  assert.deepEqual(d.pendingUnlocks(), ['map', 'mine']);
});

test('unlocksAtStart : au démarrage, les listes et les lieux de l’appareil font venir leurs onglets, sans annonce', async () => {
  await c.saveCollection(c.newCollection('list', { name: 'Bois' }));
  await c.saveCollection(c.newPlace([4.8357, 45.7641], { name: 'Lisière nord' }));
  // A device of before (or « Revoir les premiers pas » of before): its lists and lieux, no tab.
  localStorage.setItem(KEY, JSON.stringify({ done: false, unlocked: [], seen: [], step: 0 }));
  await d.unlocksAtStart();
  assert.deepEqual(d.discoverState().unlocked, ['mine', 'map']);
  assert.deepEqual(stored().unlocked, ['mine', 'map']);
  // Quiet: announced at once.
  assert.deepEqual(stored().announced, ['mine', 'map']);
  assert.deepEqual(d.pendingUnlocks(), []);
});

test('unlocksAtStart : l’onglet venu avec l’adresse à l’ouverture, que l’appareil fait venir aussi, sans annonce ; un onglet d’avant l’ouverture attend la sienne', async () => {
  // A device of before (its list and lieu kept) opened on Mes plantes' address: its tab came first (context.js follow()).
  localStorage.setItem(KEY, JSON.stringify({ done: false, unlocked: [], seen: [], step: 0 }));
  d.recomputeUnlocks({ summaries: [] });
  assert.deepEqual(d.discoverState().unlocked, []);
  d.arrivedAt('collections');
  assert.deepEqual(d.pendingUnlocks(), ['mine']);
  await d.unlocksAtStart();
  assert.deepEqual(d.discoverState().unlocked, ['mine', 'map']);
  assert.deepEqual(d.pendingUnlocks(), []);
  // The Carte there as this page opened (the state of before, at the top), still to be announced (an activity
  // reloaded): it still is; Mes plantes comes quietly.
  localStorage.setItem(KEY, JSON.stringify({ done: false, unlocked: ['map'], announced: [], seen: [], step: 0 }));
  await d.unlocksAtStart();
  assert.deepEqual(d.discoverState().unlocked, ['map', 'mine']);
  assert.deepEqual(d.pendingUnlocks(), ['map']);
  d.markAnnounced(['map']);
});

test('markAnnounced : un onglet repris entre-temps (« Revoir les premiers pas » pendant son annonce) est annoncé quand il revient', async () => {
  for (const each of await c.listCollections()) if (each.id !== c.FAVORITES_ID) await c.deletePlace(each.id);
  await d.restartDiscover();
  // The Carte come with its address, its announcement showing.
  d.arrivedAt('map');
  assert.deepEqual(d.pendingUnlocks(), ['map']);
  d.finishDiscover();
  await d.restartDiscover();
  // The announcement gone after « Revoir »: nothing noted.
  d.markAnnounced(['map']);
  assert.deepEqual(d.discoverState().announced, []);
  assert.deepEqual(stored().announced, []);
  // A lieu saved: both come, both to be announced.
  await c.saveCollection(c.newPlace([4.8357, 45.7641], { name: 'Lisière nord' }));
  assert.deepEqual(d.discoverState().unlocked, ['mine', 'map']);
  assert.deepEqual(d.pendingUnlocks(), ['map', 'mine']);
  d.markAnnounced(['map', 'mine']);
});

test('« Recommencer » de Rencontres sur un état qui n’a pas pu s’écrire (stockage plein) : ses onglets restent', async () => {
  for (const each of await c.listCollections()) if (each.id !== c.FAVORITES_ID) await c.deletePlace(each.id);
  await d.restartDiscover();
  assert.deepEqual(d.discoverState().unlocked, []);
  const set = localStorage.setItem;
  localStorage.setItem = (k, v) => { if (k === KEY) throw new DOMException('Plein', 'QuotaExceededError'); set.call(localStorage, k, v); };
  try {
    d.arrivedAt('collections');
    d.arrivedAt('map');
    d.replayMeet();
    assert.deepEqual(d.discoverState().unlocked, ['mine', 'map']);
  } finally {
    localStorage.setItem = set;
  }
  assert.deepEqual(stored().unlocked, []);
  // Written at last: the tabs with it.
  d.replayMeet();
  assert.deepEqual(stored().unlocked, ['mine', 'map']);
  d.markAnnounced(['mine', 'map']);
  assert.deepEqual(d.pendingUnlocks(), []);
});

test('unlock : un onglet donné, à annoncer (les tests s’en servent)', async () => {
  d.unlock('flore');
  assert.equal(d.discoverState().done, true);
  assert.deepEqual(d.pendingUnlocks(), ['flore']);
  assert.equal(await writes(() => d.unlock('flore')), 0);
});
