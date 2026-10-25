// Faux amis (app/miniapp/kit/faux-amis.js, faux-amis-store.js): the criteria a pair of data/lookalikes.json gives one of
// its plants, the cards dealt (four criteria to attribute, two pairs without any criterion — as the plant sheet says
// it —, every plant of a pair in turn), the answers and the score, a game kept then read again from a file that changed
// since (stale), the plant of the flora a card shows for a taxon — and never a word that a plant can be eaten. The
// activity's « Commencer » left before the file came deals nothing (app/miniapps/faux-amis.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CARDS, CLUED, SKIP, SHOWN_SPECIES, answered, cardsOf, cluesOf, dealGame, noCriterion, pairKey, pickPlant, scoreOf } from '../../app/miniapp/kit/faux-amis.js';
import { nextCard, underWay } from '../../app/miniapp/kit/faux-amis-store.js';
import { MiniApp, storageKey } from '../../app/miniapp/runtime.js';
import { random } from './support/random.mjs';

const json = async (/** @type {string} */ path) => JSON.parse(await readFile(new URL('../../' + path, import.meta.url), 'utf8'));
const [data, plants] = await Promise.all([json('data/lookalikes.json'), json('data/plants.json')]);
/** @type {any[]} */
const pairs = data.pairs;
/** Math.random's shape, seeded: the same seed, the same game. @param {number} seed */
const seeded = seed => { const r = random(seed); return () => r(1_000_000) / 1_000_000; };
const pairOf = (/** @type {string} */ toxic) => pairs.find(p => p.toxic[0].taxon === toxic);

test('cluesOf : les critères d’une seule plante de la paire, son nom ôté ; ni les généraux, ni ceux qui disent qu’une plante se mange', () => {
  assert.deepEqual(cluesOf(pairOf('Colchicum')), [
    { side: 'edible', taxon: 'Allium ursinum', label: 'Ail des ours', text: 'Odeur d’ail quand on froisse la feuille ; feuilles ovales et pointues, portées par une tige ; bulbe blanc et allongé.' },
    { side: 'toxic', taxon: 'Colchicum', label: 'Colchique', text: 'Feuilles plus rigides, charnues, à bout arrondi, sans tige, qui semblent sortir directement du sol ; bulbe rond et foncé ; fleurs mauves seulement en automne.' }
  ], 'le troisième critère (« Vérifier l’odeur… ») n’est celui d’aucune des deux');
  assert.deepEqual(cluesOf(pairOf('Aesculus hippocastanum')).map(c => c.label), ['Châtaigne', 'Marron d’Inde']);
  assert.deepEqual(cluesOf(pairOf('Digitalis')), [], 'un critère général');
  assert.deepEqual(cluesOf(pairOf('Nerium oleander')), [], '« … est comestible » : jamais dans le jeu');
  // In the shipped file: five pairs give criteria, nine in all, none saying a plant can be eaten.
  const all = pairs.flatMap(cluesOf);
  assert.equal(pairs.filter(p => cluesOf(p).length).length, 5);
  assert.equal(all.length, 9);
  for (const c of all) assert.doesNotMatch(c.text, /comestible|consomm|se mange/i);
  // A criterion naming another plant (the laurier rose's given to the laurier cerise), one saying it is eaten.
  const pair = { ...pairOf('Prunus laurocerasus'), tell: ['Laurier rose : feuilles étroites.', 'Laurier sauce : comestible, feuilles aromatiques.', 'Laurier cerise : feuilles luisantes.'] };
  assert.deepEqual(cluesOf(pair).map(c => [c.label, c.text]), [['Laurier cerise', 'Feuilles luisantes.']]);
  // Typed with a French space before the colon (narrow or not): the same criterion.
  assert.deepEqual(cluesOf({ ...pair, tell: ['Laurier cerise\u202f: feuilles luisantes.', 'Laurier sauce\u00a0: feuilles mates.'] }).map(c => c.label), ['Laurier cerise', 'Laurier sauce']);
});

test('dealGame : six paires différentes, quatre indices à attribuer et deux sans critère, les deux plantes de chaque paire', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const game = dealGame(pairs, { random: seeded(seed) });
    assert.equal(game.cards.length, CARDS);
    assert.equal(new Set(game.cards.map(k => k.pair)).size, CARDS, 'chaque paire une fois');
    assert.equal(game.cards.filter(k => k.clue).length, CLUED);
    const cards = /** @type {NonNullable<ReturnType<typeof cardsOf>>} */ (cardsOf(game, data));
    assert.ok(cards, 'le jeu se lit dans le fichier qui l’a donné');
    for (const c of cards) {
      assert.deepEqual(c.plants.map(p => p.side).sort(), ['edible', 'toxic'], 'la plante cherchée et son sosie toxique');
      assert.equal(c.answer, null);
      assert.equal(c.right, null);
      assert.ok(c.sources.length && c.sources.every(s => s.title && s.publisher));
      if (c.clue) assert.ok(c.plants.some(p => p.taxon === c.clue?.taxon), 'la plante de l’indice est sur la carte');
      else assert.ok(noCriterion(c.pair), 'une carte sans critère : une paire qui n’en a aucun, comme le dit sa fiche');
      assert.deepEqual([c.toxic.side, c.sought.side], ['toxic', 'edible']);
      assert.equal(c.also.length + 2, c.pair.toxic.length + c.pair.edible.length, 'les autres plantes de la paire, dites');
    }
  }
  // The same seed, the same game; others, other games; each side drawn left and right.
  assert.deepEqual(dealGame(pairs, { random: seeded(7) }), dealGame(pairs, { random: seeded(7) }));
  const games = Array.from({ length: 30 }, (_, i) => dealGame(pairs, { random: seeded(i + 100) }));
  assert.ok(new Set(games.map(g => g.cards.map(k => k.pair).join())).size > 20);
  const lefts = new Set(games.flatMap(g => cardsOf(g, data)?.map(c => c.plants[0].side) ?? []));
  assert.deepEqual([...lefts].sort(), ['edible', 'toxic']);
  // A pair whose criteria are only general (Digitale, Aconit…) is never dealt: neither a criterion to attribute, nor
  // « aucun critère » (the plant sheet lists them).
  const general = pairs.filter(p => !noCriterion(p) && !cluesOf(p).length).map(pairKey);
  assert.deepEqual(general.length, 6);
  for (const g of games) for (const k of g.cards) assert.ok(!general.includes(k.pair), k.pair);
  // Every plant of a pair comes in turn (Petite ciguë as Grande ciguë, Myrtille and Cassis as Raisin, Poireau sauvage),
  // but the colchique's criterion always beside the ail des ours it is told from.
  const seen = new Set();
  for (let seed = 1; seed <= 400; seed++) for (const k of dealGame(pairs, { random: seeded(seed) }).cards) {
    k.plants.forEach(t => seen.add(t));
    if (k.clue?.taxon === 'Colchicum') assert.ok(k.plants.includes('Allium ursinum'), k.plants.join());
  }
  for (const t of ['Aethusa cynapium', 'Conium maculatum', 'Vaccinium', 'Ribes nigrum', 'Vitis vinifera']) assert.ok(seen.has(t), t);
  // Short of pairs without criteria: more with; short of pairs: as many cards as there are; fewer cards asked: so many.
  const fewWithout = [...pairs.filter(p => cluesOf(p).length), ...pairs.filter(noCriterion).slice(0, 1)];
  const g2 = dealGame(fewWithout, { random: seeded(3) });
  assert.deepEqual([g2.cards.length, g2.cards.filter(k => k.clue).length], [6, 5]);
  assert.equal(dealGame(pairs.slice(0, 3), { random: seeded(3) }).cards.length, 2, 'Colchique, Muguet ; pas la Digitale');
  for (const count of [0, 1, 3, 5]) assert.equal(dealGame(pairs, { random: seeded(3), count }).cards.length, count);
  assert.deepEqual(dealGame([], { random: seeded(3) }).cards, []);
});

test('answered : le toucher d’une des deux plantes, ou « Je ne cueille pas » sans critère ; une fois ; bonne réponse et score', () => {
  const game = dealGame(pairs, { random: seeded(11) });
  const at = game.cards.findIndex(k => k.clue), plain = game.cards.findIndex(k => !k.clue);
  const k = game.cards[at], owner = /** @type {{ taxon: string }} */ (k.clue).taxon, other = /** @type {string} */ (k.plants.find(t => t !== owner));
  assert.equal(answered(game, at, SKIP), game, 'une carte à indice attend une plante');
  assert.equal(answered(game, at, 'Plantus inventus'), game, 'une plante qui n’est pas sur la carte');
  assert.equal(answered(game, plain, plain >= 0 ? game.cards[plain].plants[0] : ''), game, 'sans critère : seulement « Je ne cueille pas »');
  assert.equal(answered(game, 99, SKIP), game);
  const wrong = answered(game, at, other);
  assert.notEqual(wrong, game);
  assert.equal(game.cards[at].answer, null, 'la partie d’avant intacte');
  assert.equal(answered(wrong, at, owner), wrong, 'répondue une fois');
  const right = answered(answered(game, at, owner), plain, SKIP);
  assert.deepEqual(cardsOf(wrong, data)?.[at].right, false);
  const cards = /** @type {NonNullable<ReturnType<typeof cardsOf>>} */ (cardsOf(right, data));
  assert.deepEqual([cards[at].right, cards[plain].right], [true, true]);
  assert.deepEqual(scoreOf(cards), { right: 2, total: 6 });
  // The card to answer, the game under way, until the last answer.
  let g = game;
  assert.equal(nextCard(g), 0);
  assert.ok(underWay(g));
  for (let i = 0; i < g.cards.length; i++) g = answered(g, i, g.cards[i].clue ? /** @type {any} */ (g.cards[i].clue).taxon : SKIP);
  assert.equal(nextCard(g), -1);
  assert.equal(underWay(g), false);
  assert.deepEqual(scoreOf(/** @type {any} */ (cardsOf(g, data))), { right: 6, total: 6 });
  assert.equal(underWay(null), false);
  assert.equal(underWay({ cards: [] }), false);
});

test('cardsOf : une partie gardée se relit dans le fichier ; un critère corrigé, une paire changée depuis : partie périmée', () => {
  const game = dealGame(pairs, { random: seeded(5) });
  // Kept as JSON (the mini-app's state), read again.
  assert.deepEqual(cardsOf(JSON.parse(JSON.stringify(game)), data)?.map(c => pairKey(c.pair)), game.cards.map(k => k.pair));
  const clued = /** @type {any} */ (game.cards.find(k => k.clue));
  const changed = structuredClone(data);
  const pair = changed.pairs.find((/** @type {any} */ p) => pairKey(p) === clued.pair);
  // The criterion's words corrected.
  pair.tell = pair.tell.map((/** @type {string} */ t) => t.endsWith(clued.clue.text.slice(1)) ? t.replace(/\.$/, ', corrigé.') : t);
  assert.equal(cardsOf(game, changed), null);
  // A plant added to the pair (its key changes), a pair taken away.
  const added = structuredClone(data);
  added.pairs.find((/** @type {any} */ p) => pairKey(p) === clued.pair).edible.push({ taxon: 'Daucus carota', label: 'Carotte sauvage' });
  assert.equal(cardsOf(game, added), null);
  const gone = { ...data, pairs: data.pairs.filter((/** @type {any} */ p) => pairKey(p) !== game.cards[0].pair) };
  assert.equal(cardsOf(game, gone), null);
  // A card kept wrong (two plants of the same side, a plant the pair does not have): stale too.
  const odd = structuredClone(game);
  odd.cards[0].plants = [odd.cards[0].plants[0], odd.cards[0].plants[0]];
  assert.equal(cardsOf(odd, data), null);
  // A pair dealt without criterion that has one now (a gap filled): the card would say what the file no longer says.
  const plain = /** @type {any} */ (game.cards.find(k => !k.clue));
  const filled = structuredClone(data);
  const pairNow = filled.pairs.find((/** @type {any} */ p) => pairKey(p) === plain.pair);
  pairNow.tell = [`${pairNow.edible[0].label} : un critère des sources.`];
  assert.equal(cardsOf(game, filled), null);
  // A card kept with an answer it does not take, or a pair twice: not a game the app deals.
  const skipped = structuredClone(game), twice = structuredClone(game);
  /** @type {any} */ (skipped.cards.find(k => k.clue)).answer = SKIP;
  twice.cards[1] = twice.cards[0];
  assert.equal(cardsOf(skipped, data), null);
  assert.equal(cardsOf(twice, data), null);
  assert.equal(cardsOf(null, data), null);
  assert.equal(cardsOf(game, null), null);
});

test('pickPlant : l’espèce elle-même, celle qu’on montre pour un genre, sinon sa première espèce en photo, jamais un hybride', () => {
  const rows = (/** @type {string} */ taxon) => plants.filter((/** @type {any} */ p) => taxon.includes(' ') ? p.scientificName === taxon : p.genus === taxon);
  assert.equal(pickPlant('Allium ursinum', rows('Allium ursinum'))?.scientificName, 'Allium ursinum');
  assert.equal(pickPlant('Colchicum', rows('Colchicum'))?.scientificName, 'Colchicum autumnale');
  assert.equal(pickPlant('Molopospermum peleponnesiacum', rows('Molopospermum peleponnesiacum'))?.id, 1012157, 'Couscouil, sous son nom de la flore');
  // Every taxon of every pair has its plant in the flora, with a photo.
  for (const p of pairs) for (const t of [...p.toxic, ...p.edible]) {
    const plant = pickPlant(t.taxon, rows(t.taxon));
    assert.ok(plant?.thumbnail?.url, `${t.label} (${t.taxon})`);
  }
  for (const [genus, species] of Object.entries(SHOWN_SPECIES)) assert.equal(species.split(' ')[0], genus);
  // A genus not listed: its first species with a photo; a hybrid never.
  const flora = [{ genus: 'Arum', scientificName: 'Arum x sooi', thumbnail: { url: 'x' } }, { genus: 'Arum', scientificName: 'Arum italicum' },
    { genus: 'Arum', scientificName: 'Arum cylindraceum', thumbnail: { url: 'y' } }];
  assert.equal(pickPlant('Arum', flora)?.scientificName, 'Arum cylindraceum', 'Arum maculatum absent ici');
  assert.equal(pickPlant('Arum', flora.slice(0, 2))?.scientificName, 'Arum italicum');
  assert.equal(pickPlant('Plantus inventus', []), null);
  assert.equal(pickPlant('Plantus', []), null);
});

test('Faux amis : « Commencer » quitté avant que la liste arrive ne distribue rien, ni ne garde une partie', async () => {
  const m = (await import('../../app/miniapps/faux-amis.js')).default;
  const real = globalThis.fetch;
  /** @type {() => void} */
  let arrive = () => {};
  globalThis.fetch = /** @type {any} */ ((/** @type {any} */ url) => new Promise(resolve => { arrive = () => real(url).then(resolve); }));
  try {
    const app = new MiniApp(m, { saved: null });
    const dealing = app.do('deal');
    app.dispose();
    arrive();
    await dealing;
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(app.c.game, null);
    assert.equal(localStorage.getItem(storageKey('faux-amis', 'state')), null);
  } finally { globalThis.fetch = real; }
  // Once read, dealt at once: a game of six, at « play ».
  const app = new MiniApp(m, { saved: null });
  await app.do('deal');
  assert.deepEqual([app.c.game.cards.length, app.step.id], [6, 'play']);
  app.dispose();
  localStorage.removeItem(storageKey('faux-amis', 'state'));
});
