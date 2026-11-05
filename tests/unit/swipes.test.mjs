// The swipe core (app/miniapp/kit/swipes.js), the same for the activities' decks (kit/session.js) and a screen's
// (layout/cells.js): one write per swipe; the toxic side never a match nor a favourite, nothing of its host merged
// into it; a card decided once; each ↺ taking back its own heart's favourite, one plant's favourite operations in
// their order (↺ then ♥ before the write, or while the forget is on its way: added again, after it); « Retirer »;
// « Revoir les plantes passées »; the heart flying off; the hint once; the current plant on top; one `change` per
// operation. Its store and its favourites are fakes: what it writes and asks for, in order, each write held until let go.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SwipeCore, forgetHint, hintOnce, memoryStore } from '../../app/miniapp/kit/swipes.js';
import { avoid, swipe } from '../../app/miniapp/kit/cards.js';

/** The card of plant `id`. @param {number} id @returns {any} */
const card = id => ({ plant: { id }, count: 1, photo: null, credit: null, blooming: false, verdict: null });
/** Every promise settled so far gone through. */
const flush = () => new Promise(resolve => setImmediate(resolve));

/** A store counting its writes. @param {any} [init] */
function counting(init) {
  const kept = memoryStore(init);
  const store = { writes: 0, read: kept.read, write: (/** @type {Record<string, unknown>} */ p) => { store.writes++; kept.write(p); } };
  return store;
}

/**
 * Favourites whose writes wait until let go (settle), each call logged: `add` resolves to the entry added (null: a
 * favourite already); `forget` takes back the entry it is given — given none (the policy's fallback), nothing, as a
 * screen's. @param {number[]} [had] the favourites already
 */
function favourites(had = []) {
  const set = new Set(had);
  /** @type {string[]} */
  const log = [];
  /** @type {(() => void)[]} */
  const held = [];
  let n = 0;
  const later = (/** @type {() => any} */ fn) => new Promise(resolve => { held.push(() => resolve(fn())); });
  return {
    set, log,
    has: (/** @type {number} */ id) => set.has(id),
    add: (/** @type {any} */ plant) => {
      log.push(`add ${plant.id}`);
      return later(() => { if (set.has(plant.id)) return null; set.add(plant.id); return { id: `e${++n}` }; });
    },
    forget: (/** @type {number} */ id, /** @type {any} */ token) => {
      log.push(`forget ${id} ${token?.id ?? null}`);
      return later(() => Boolean(token) && set.delete(id));
    },
    /** Every write held let go, and those they lead to. */
    async settle() { for (let i = 0; i < 20; i++) { while (held.length) /** @type {() => void} */ (held.shift())(); await flush(); } }
  };
}

/** A core over a fake store and fake favourites. @param {{ init?: any, had?: number[], avoids?: (c: any) => boolean }} [o] */
function core({ init, had, avoids = () => false } = {}) {
  const store = counting(init), fav = favourites(had);
  return { store, fav, core: new SwipeCore({ store, favourites: fav, avoids }) };
}

test('un cœur : une écriture (celle de swipe), son entrée, un favori demandé une fois ; passée, ou déjà un favori : rien de demandé', async () => {
  const { store, fav, core: c } = core({ had: [3] });
  const before = store.read();
  assert.deepEqual(c.decide(card(1), true), { side: 'match', fav: true, entry: { id: 1, liked: true, fav: true } });
  assert.equal(store.writes, 1);
  assert.deepEqual(store.read(), swipe(before, 1, true));
  assert.deepEqual(c.decide(card(2), false), { side: 'pass', fav: false, entry: { id: 2, liked: false, fav: false } });
  assert.deepEqual(c.decide(card(3), true)?.fav, false, 'un favori déjà : le cœur ne l’ajoute pas');
  assert.equal(store.writes, 3);
  assert.deepEqual(store.read(), { matches: [1, 3], passed: [2] });
  assert.deepEqual(c.history, [{ id: 1, liked: true, fav: true }, { id: 2, liked: false, fav: false }, { id: 3, liked: true, fav: false }]);
  await fav.settle();
  assert.deepEqual(fav.log, ['add 1']);
  // What a match's host adds (Rencontres: the plant chosen, and the one before for ↺): in the same write, in its entry.
  c.decide(card(4), true, { entry: { was: 1 }, write: { focus: 4 } });
  assert.equal(store.writes, 4);
  assert.deepEqual([store.read().focus, c.history.at(-1)], [4, { id: 4, liked: true, fav: true, was: 1 }]);
  // A pass: none of it.
  c.decide(card(5), false, { entry: { was: 4 }, write: { focus: 5 } });
  assert.deepEqual([store.read().focus, c.history.at(-1)], [4, { id: 5, liked: false, fav: false }]);
});

test('le côté toxique : reconnue, à éviter — une écriture, celle d’avoid, rien de l’hôte dedans, jamais un favori ; ↺ la reprend sans rien oublier ; sans `avoids`, pas de cœur', async () => {
  const { store, fav, core: c } = core({ init: { matches: [], passed: [], avoided: [] }, avoids: () => true });
  const before = store.read();
  const r = c.decide(card(7), true, { entry: { was: 1 }, write: { focus: 9 } });
  assert.deepEqual([r?.side, r?.fav], ['avoid', false]);
  assert.equal(store.writes, 1);
  assert.deepEqual(store.read(), avoid(before, 7));
  assert.equal('focus' in store.read(), false);
  assert.deepEqual(c.history, [{ id: 7, liked: false, fav: false }]);
  assert.deepEqual(c.matchCards([card(7)]), []);
  assert.deepEqual(c.avoidCards([card(7)]).map(x => x.plant.id), [7]);
  c.undo();
  assert.deepEqual(store.read(), { matches: [], passed: [], avoided: [] });
  await fav.settle();
  assert.deepEqual(fav.log, [], 'ni ajouté ni oublié');
  assert.throws(() => new SwipeCore(/** @type {any} */ ({ store, favourites: fav })), TypeError);
});

test('une carte décidée l’est une fois : un second choix (un double-clic pendant qu’elle s’envole) ne fait rien', async () => {
  const { store, fav, core: c } = core();
  c.decide(card(1), true);
  assert.equal(c.decide(card(1), true), null);
  assert.equal(c.decide(card(1), false), null);
  assert.deepEqual([c.history.length, store.writes], [1, 1]);
  await fav.settle();
  assert.deepEqual(fav.log, ['add 1']);
});

test('chaque ↺ reprend le favori de son propre cœur ; un cœur qui n’a rien ajouté, rien', async () => {
  const { fav, core: c } = core();
  c.decide(card(1), true);
  c.decide(card(2), true);
  await fav.settle();
  assert.equal(c.undo()?.id, 2);
  assert.equal(c.undo()?.id, 1);
  assert.equal(c.undo(), null, 'plus rien à reprendre');
  await fav.settle();
  assert.deepEqual(fav.log, ['add 1', 'add 2', 'forget 2 e2', 'forget 1 e1']);
  // Made a favourite elsewhere before the heart's write: nothing added, nothing taken back.
  c.decide(card(5), true);
  fav.set.add(5);
  await fav.settle();
  c.undo();
  await fav.settle();
  assert.deepEqual(fav.log.slice(4), ['add 5']);
  assert.ok(fav.has(5));
});

test('↺ puis ♥ avant que le favori soit écrit : ajouté, repris, ajouté — dans cet ordre, la plante favorite à la fin', async () => {
  const { fav, core: c } = core();
  c.decide(card(1), true);
  c.undo();
  const again = c.decide(card(1), true);
  assert.equal(again?.fav, true);
  assert.deepEqual(c.history, [{ id: 1, liked: true, fav: true }]);
  await fav.settle();
  assert.deepEqual(fav.log, ['add 1', 'forget 1 e1', 'add 1']);
  assert.ok(fav.has(1));
});

test('♥ pendant que ↺ reprend le favori : compté comme pas un favori, ajouté après la reprise', async () => {
  const { fav, core: c } = core();
  c.decide(card(1), true);
  await fav.settle();
  assert.ok(fav.has(1));
  c.undo();
  await flush();
  assert.deepEqual(fav.log, ['add 1', 'forget 1 e1'], 'la reprise en cours');
  assert.equal(c.decide(card(1), true)?.fav, true);
  await fav.settle();
  assert.deepEqual(fav.log, ['add 1', 'forget 1 e1', 'add 1']);
  assert.ok(fav.has(1));
});

test('« Retirer » attend l’écriture du cœur, puis reprend son favori ; sans cœur, la règle de l’hôte (forget(id, null)) ; dit si la plante reste favorite ; ses glissés quittent ↺', async () => {
  const { store, fav, core: c } = core();
  c.decide(card(1), true);
  const out = c.unmatch(card(1));
  assert.equal(c.decided(1), false);
  assert.deepEqual(c.history, []);
  await flush();
  assert.deepEqual(fav.log, ['add 1']);
  await fav.settle();
  assert.equal(await out, false);
  assert.deepEqual(fav.log, ['add 1', 'forget 1 e1']);
  assert.deepEqual(store.read(), { matches: [], passed: [] });
  // A favourite already (the user's): no heart's write — the fallback, which keeps it here.
  const other = core({ had: [4] });
  other.core.decide(card(4), true);
  const kept = other.core.unmatch(card(4));
  await other.fav.settle();
  assert.equal(await kept, true);
  assert.deepEqual(other.fav.log, ['forget 4 null']);
  // Taken back by the host's fallback, after the plant's operations on their way.
  other.core.decide(card(6), true);
  const gone = other.core.unfavourite(6);
  await other.fav.settle();
  assert.equal(await gone, false);
  assert.deepEqual(other.fav.log.slice(1), ['add 6', 'forget 6 null']);
  // Its swipes out of ↺'s history (a pass, then a heart, of the same plant): ↺ goes back to the swipe before them —
  // and takes back nothing of theirs.
  const third = core();
  third.core.decide(card(7), false);
  third.core.decide(card(8), false);
  third.core.restore(8);
  third.core.decide(card(8), true);
  third.core.unmatch(card(8));
  assert.deepEqual(third.core.history, [{ id: 7, liked: false, fav: false }]);
  assert.equal(third.core.undo()?.id, 7);
  assert.equal(third.core.undo(), null);
  await third.fav.settle();
  assert.deepEqual(third.fav.log, ['add 8', 'forget 8 e1']);
});

test('« Revoir les plantes passées » : les passées reviennent — et les plantes reconnues à éviter là où le magasin les garde, sans clé ajoutée ailleurs', () => {
  const plain = core();
  plain.core.decide(card(1), false);
  plain.core.reset();
  assert.deepEqual(plain.store.read(), { matches: [], passed: [] });
  const harvest = core({ init: { matches: [], passed: [], avoided: [] }, avoids: x => x.plant.id === 2 });
  harvest.core.decide(card(1), false);
  harvest.core.decide(card(2), true);
  harvest.core.decide(card(3), true);
  harvest.core.reset();
  assert.deepEqual(harvest.store.read(), { matches: [3], passed: [], avoided: [] });
});

test('le cœur qui s’envole : jusqu’à 900 ms après le dernier (un second ne l’écourte pas) ; dispose l’arrête', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { core: c } = core();
  let changes = 0;
  c.addEventListener('change', () => changes++);
  c.heart();
  t.mock.timers.tick(500);
  c.heart();
  assert.equal(c.burst, 2);
  t.mock.timers.tick(899);
  assert.equal(c.burst, 2, 'le second compte depuis lui');
  t.mock.timers.tick(1);
  assert.deepEqual([c.burst, changes], [0, 3]);
  c.heart();
  c.dispose();
  assert.equal(c.burst, 0);
  t.mock.timers.tick(1000);
  assert.equal(changes, 4, 'plus rien après dispose');
});

test('l’indice du glissé, une fois par clé ; de nouveau une fois oublié (« Recommencer »)', () => {
  assert.equal(hintOnce('swipes-test'), true);
  assert.equal(hintOnce('swipes-test'), false);
  forgetHint('swipes-test');
  assert.equal(hintOnce('swipes-test'), true);
});

test('le paquet : la plante courante dessus si elle y est (décidée : non) ; une carte remise dans le paquet, ↺ intact', () => {
  const { core: c } = core();
  const cards = [1, 2, 3].map(card);
  const ids = (/** @type {any[]} */ deck) => deck.map(x => x.plant.id);
  assert.deepEqual(ids(c.deck(cards)), [1, 2, 3]);
  assert.deepEqual(ids(c.deck(cards, 3)), [3, 1, 2]);
  c.decide(cards[2], false);
  assert.deepEqual(ids(c.deck(cards, 3)), [1, 2]);
  c.restore(3);
  assert.deepEqual(ids(c.deck(cards, 3)), [3, 1, 2]);
  assert.deepEqual(c.history, [{ id: 3, liked: false, fav: false }]);
});

test('un `change` par opération, à sa fin ; aucun pour un choix ignoré', async () => {
  const { fav, core: c } = core();
  let changes = 0;
  c.addEventListener('change', () => changes++);
  const count = (/** @type {() => unknown} */ fn) => { const was = changes; fn(); return changes - was; };
  assert.equal(count(() => c.decide(card(1), true)), 1);
  assert.equal(count(() => c.decide(card(1), true)), 0);
  assert.equal(count(() => c.undo()), 1);
  assert.equal(count(() => c.undo()), 0);
  assert.equal(count(() => c.restore(1)), 1);
  assert.equal(count(() => c.reset()), 1);
  c.decide(card(2), true);
  assert.equal(count(() => c.unmatch(card(2))), 1);
  c.dispose();
  await fav.settle();
});
