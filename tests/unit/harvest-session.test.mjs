// Cueillette prudente's game (app/miniapp/kit/session.js, AroundSession), against an IndexedDB in memory
// (fake-indexeddb) holding the reduced flora, iNaturalist answered here: every plant read and ordered before the 120
// kept — a deadly look-alike seen once, behind more than 120 more observed plants, is kept (Rencontres' way still
// keeps the 120 most observed); a toxic look-alike swiped right is recognised, to avoid — never a match nor a
// favourite, ↺ and « Revoir les plantes passées » bring it back —; the edible side is a match, as before. The list of
// the confusions unreadable, no card is a match (the game cannot tell a plant's side: fail closed).
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// db.js upgrades the schema only from a page (a worker opens whatever version exists); a match asks whether the
// pointer is coarse (to vibrate).
/** @type {any} */ (globalThis).window ??= globalThis;
/** @type {any} */ (globalThis).matchMedia ??= () => ({ matches: false });

const db = await import('../../app/core/db.js');
const { store } = await import('../../app/core/store.js');
const { lookalikesOf } = await import('../../app/core/lookalikes.js');
const { listCollections, newCollection, savePlace, setInCollection, toggleFavorite } = await import('../../app/core/collections.js');
const { MiniApp } = await import('../../app/miniapp/runtime.js');
const { sessionOf } = await import('../../app/miniapp/kit/session.js');
const cueillette = (await import('../../app/miniapps/cueillette.js')).default;

const plants = JSON.parse(await readFile(new URL('../fixtures/plants.json', import.meta.url), 'utf8'));
await db.replacePlants(plants, { version: 'test' });
store.set({ status: 'ready' });

const named = (/** @type {string} */ name) => plants.find((/** @type {any} */ p) => p.scientificName === name);
const ail = named('Allium ursinum'), cigue = named('Conium maculatum'), colchique = named('Colchicum autumnale');
/** The favourites' plants. */
const favourites = async () => ((await listCollections()).find(c => c.id === 'favorites')?.properties.plants ?? []).map((/** @type {any} */ e) => e.plantId);
const tick = () => new Promise(resolve => setTimeout(resolve, 20));

/**
 * fetch answering iNaturalist's plants around with `around` ([plant, count], the most observed first); the bundled
 * files read from the repository, unless `unreadable` names one (503); anything else 503.
 * @param {any[][]} around @param {string} [unreadable]
 */
function answering(around, unreadable) {
  const fetch = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (async (/** @type {any} */ input, /** @type {any} */ init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.protocol === 'file:' && !(unreadable && url.pathname.endsWith('/' + unreadable))) return fetch(input, init);
    if (url.host === 'api.inaturalist.org' && url.pathname.endsWith('/species_counts')) {
      const results = around.map(([p, count], i) => ({ count, taxon: { id: 5000 + i, name: p.scientificName, preferred_common_name: null, default_photo: null } }));
      return new Response(JSON.stringify({ total_results: results.length, results }), { headers: { 'content-type': 'application/json' } });
    }
    return new Response('', { status: 503 });
  });
  return () => { globalThis.fetch = fetch; };
}

// First: the list of the confusions is read once per run (core/bundled.js), and kept once read.
test('Cueillette prudente, la liste des confusions illisible : chaque plante gardée, et aucune n’est un match ni un favori (le jeu ne sait pas de quel côté elle est)', async t => {
  t.after(answering([[ail, 800], [colchique, 1]], 'lookalikes.json'));
  const app = new MiniApp(cueillette, { saved: null });
  t.after(() => app.dispose());
  // Another place than the next test's: iNaturalist's answers are kept by place (core/nearby.js).
  app.set({ point: [5.72, 45.19], radius: 20000 });
  const s = sessionOf(app);
  await s.load(true);
  assert.equal(s.unread, true);
  const [garlic, saffron] = /** @type {import('../../app/miniapp/kit/cards.js').Card[]} */ (s.cards);
  assert.deepEqual([garlic.plant.id, saffron.plant.id], [ail.id, colchique.id]);
  assert.ok(s.avoids(saffron) && s.avoids(garlic));
  assert.equal(s.swiped(saffron, true), false);
  assert.equal(s.swiped(garlic, true), false);
  assert.deepEqual({ matches: app.c.matches, avoided: app.c.avoided }, { matches: [], avoided: [colchique.id, ail.id] });
  await tick();
  assert.deepEqual(await favourites(), []);
  // A pass stays a pass; ↺ undoes the last one.
  s.rewind();
  assert.deepEqual(app.c.avoided, [colchique.id]);
});

test('Cueillette prudente : toutes les plantes lues et triées avant d’en garder 120 — la colchique vue une fois reste ; un sosie toxique à droite, reconnu à éviter, jamais un match ni un favori', async t => {
  // Plants of no dangerous confusion: never in Cueillette prudente's list.
  /** @type {any[]} */
  const plain = [];
  for (const p of plants) if (plain.length < 125 && !(await lookalikesOf(p)).length) plain.push(p);
  assert.equal(plain.length, 125, 'plus de 120 plantes plus observées que la colchique');
  // iNaturalist's plants around, the most observed first: the wild garlic and the hemlock among the most observed,
  // 125 plants of no confusion, then the meadow saffron, seen once — past the 120 most observed.
  t.after(answering([[cigue, 900], [ail, 800], ...plain.map((p, i) => [p, 700 - i]), [colchique, 1]]));
  const app = new MiniApp(cueillette, { saved: null });
  t.after(() => app.dispose());
  // A match of the meadow saffron from before (an earlier version of the game), and the favourite it made: both taken
  // back, the plant recognised to avoid. The hemlock, a favourite the user made: theirs, kept.
  await toggleFavorite(colchique, { app: cueillette.id });
  await toggleFavorite(cigue);
  app.set({ point: [2.35, 48.85], radius: 20000, matches: [colchique.id] });
  const s = sessionOf(app);

  // Rencontres' way (and Mosaïque's), as it was: the 120 most observed — the meadow saffron left out.
  await s.load(false);
  assert.equal(s.cards?.length, 120);
  assert.ok(!s.cards?.some(c => c.plant.id === colchique.id));

  // Cueillette prudente: every plant looked up first, the deadliest first — the meadow saffron, seen once, is there.
  await s.load(true);
  assert.equal(s.unread, false);
  assert.deepEqual(s.cards?.map(c => c.plant.scientificName), ['Allium ursinum', 'Colchicum autumnale', 'Conium maculatum']);
  assert.deepEqual(app.c.matches, [], 'un sosie toxique n’est jamais un match, même gardé d’avant');
  assert.deepEqual(app.c.avoided, [colchique.id]);
  for (let i = 0; i < 100 && (await favourites()).includes(colchique.id); i++) await tick();
  assert.deepEqual(await favourites(), [cigue.id], 'le favori fait par l’ancien match retiré, celui de l’utilisateur gardé');
  s.resetPassed();
  assert.deepEqual(app.c.avoided, [], '« Revoir les plantes passées » la ramène');
  const [garlic, saffron, hemlock] = /** @type {import('../../app/miniapp/kit/cards.js').Card[]} */ (s.cards);
  assert.deepEqual(s.deck, [garlic, saffron, hemlock]);

  // The meadow saffron swiped right: recognised, to avoid — not shown again, never a match nor a favourite.
  assert.equal(s.swiped(saffron, true), false);
  assert.deepEqual({ matches: app.c.matches, passed: app.c.passed, avoided: app.c.avoided }, { matches: [], passed: [], avoided: [colchique.id] });
  assert.deepEqual(s.deck, [garlic, hemlock]);
  assert.deepEqual(s.matchCards, []);
  assert.deepEqual(s.avoidCards, [saffron]);
  assert.deepEqual(s.history.at(-1), { id: colchique.id, liked: false, fav: false });
  // ↺: back on top, as it was.
  s.rewind();
  assert.deepEqual(app.c.avoided, []);
  assert.deepEqual(s.deck, [garlic, saffron, hemlock]);
  // The hemlock too (its own pair, the toxic side): recognised.
  s.swiped(hemlock, true);
  assert.deepEqual(app.c.avoided, [cigue.id]);
  // The wild garlic, the edible side: a match and a favourite, as before.
  assert.equal(s.swiped(garlic, true), true);
  assert.deepEqual(app.c.matches, [ail.id]);
  assert.deepEqual(s.matchCards, [garlic]);
  s.swiped(saffron, true);
  assert.deepEqual(s.deck, []);
  assert.deepEqual(s.avoidCards, [saffron, hemlock]);
  for (let i = 0; i < 100 && !(await favourites()).includes(ail.id); i++) await tick();
  assert.deepEqual(await favourites(), [cigue.id, ail.id], 'la colchique jamais dans les favoris, la ciguë seulement par l’utilisateur');
});

test('Cueillette prudente : ↺ et « Retirer » ne reprennent que le favori que la partie a ajouté, encore le sien', async t => {
  t.after(answering([[ail, 800]]));
  /** The favourites: plant id → [origin, from] (none: null). */
  const own = async () => Object.fromEntries(((await listCollections()).find(c => c.id === 'favorites')?.properties.plants ?? [])
    .map((/** @type {any} */ e) => [e.plantId, [e.origin?.app ?? null, e.from?.app ?? null]]));
  /** Waits for `ok` (the favourites are written after the swipe), at most 2 s. @param {() => Promise<boolean>} ok */
  const until = async ok => { for (let i = 0; i < 100 && !(await ok()); i++) await tick(); };
  // The favourites the tests before left: gone.
  for (const id of await favourites()) await toggleFavorite(plants.find((/** @type {any} */ p) => p.id === id));
  assert.deepEqual(await favourites(), []);
  const app = new MiniApp(cueillette, { saved: null });
  t.after(() => app.dispose());
  // Another place than the tests before: iNaturalist's answers are kept by place (core/nearby.js).
  app.set({ point: [4.83, 45.76], radius: 20000 });
  const s = sessionOf(app);
  await s.load(true);
  const garlic = /** @type {import('../../app/miniapp/kit/cards.js').Card} */ (s.cards?.find(c => c.plant.id === ail.id));

  // A heart, then ↺: the favourite it added goes.
  assert.equal(s.swiped(garlic, true), true);
  await until(async () => (await favourites()).includes(ail.id));
  s.rewind();
  await until(async () => !(await favourites()).includes(ail.id));
  assert.deepEqual(await own(), {});

  // A heart, the wild garlic then put in a list (the user's now), then ↺: the match undone, the favourite stays.
  assert.equal(s.swiped(garlic, true), true);
  await until(async () => (await favourites()).includes(ail.id));
  const list = await savePlace(newCollection('list', { name: 'Cuisine' }));
  await setInCollection(list.id, ail, true);
  s.rewind();
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(app.c.matches, []);
  assert.deepEqual(await own(), { [ail.id]: [null, 'cueillette'] }, 'à vous : gardé, d’où il vient dit');

  // A favourite of the user's (set before), matched, then « Retirer »: out of the matches, still a favourite.
  await toggleFavorite(ail);
  await toggleFavorite(ail);
  assert.deepEqual(await own(), { [ail.id]: [null, null] });
  assert.equal(s.swiped(garlic, true), false, 'un favori déjà : le match ne l’ajoute pas');
  assert.equal(await s.unmatch(garlic), 'kept');
  assert.deepEqual({ matches: app.c.matches, favourites: await own() }, { matches: [], favourites: { [ail.id]: [null, null] } });

  // The match's own favourite, then « Retirer »: both go.
  await toggleFavorite(ail);
  assert.equal(s.swiped(garlic, true), true);
  assert.equal(await s.unmatch(garlic), null);
  assert.deepEqual({ matches: app.c.matches, favourites: await own() }, { matches: [], favourites: {} });
});
