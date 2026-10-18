// @ts-check
// Faux amis: a short game on the confusions of the Anses and Centres antipoison (data/lookalikes.json) — what is pure
// about it. Six cards, one pair each: the plant sought and its toxic look-alike, side by side, each with its name. Four
// ask « À qui est cet indice ? »: a criterion the sources give for one of the two (« Ail des ours : odeur d’ail… »), its
// plant to touch. Two show a pair the sources give no criterion for: the card says so, and its only answer is « Je ne
// cueille pas ». Each answer says whose the criterion was, the part mistaken, how dangerous the look-alike is, and the
// sources; the last one, the recap and the score.
// A game keeps only what names its cards (the pairs' taxa, the criterion's words, the answers): its words are read from
// the file each time, and a card the file no longer gives (a criterion corrected since) makes the game stale.
// Never a word that a plant can be eaten: a criterion that says so is left out.
// No DOM, no network: tested under Node (tests/unit/faux-amis.test.mjs).

import { config } from '../../config.js';

/**
 * @typedef {import('../../core/lookalikes.js').Pair} Pair
 * @typedef {import('../../core/lookalikes.js').Source} Source
 * @typedef {'toxic' | 'edible'} Side
 * @typedef {{ side: Side, taxon: string, label: string, text: string }} Clue   a criterion of one plant of a pair, its name taken off
 * @typedef {{ pair: string, plants: [string, string], clue: { taxon: string, text: string } | null, answer: string | null }} Kept
 *   a card as a game keeps it: its pair (pairKey), the taxa of its two plants as shown (left, right), its criterion, its
 *   answer (the taxon touched, or SKIP)
 * @typedef {{ v: 1, cards: Kept[] }} Game
 * @typedef {{ taxon: string, label: string, side: Side }} Plant   a plant of a card
 * @typedef {{ key: string, pair: Pair, plants: [Plant, Plant], clue: Clue | null, sources: Source[], answer: string | null,
 *   right: boolean | null }} Card   a card as it is shown, its words read from the file
 */

/** The answer of a card without criterion: « Je ne cueille pas ». */
export const SKIP = 'skip';
/** The cards of a game, and how many of them ask whose a criterion is (the others: pairs without one). */
export const CARDS = 6, CLUED = 4;

/** A word that a plant can be eaten: never in the game. */
const EATEN = /comestible|consomm|se mange/i;
const SIDES = /** @type {Side[]} */ (['toxic', 'edible']);

/** A pair's key, its taxa (the toxic ones first): a game names its pairs by it. @param {Pair} pair */
export const pairKey = pair => `${pair.toxic.map(t => t.taxon).join('+')}>${pair.edible.map(t => t.taxon).join('+')}`;

/**
 * The criteria of a pair that are one of its plants' (« Ail des ours : odeur d’ail… »): the sources' words, the name
 * taken off, the first letter capitalised. Not a general one (« Vérifier l’odeur d’ail… »), nor one that names another
 * plant, nor one that says a plant can be eaten.
 * @param {Pair} pair @returns {Clue[]}
 */
export function cluesOf(pair) {
  /** @type {Clue[]} */
  const out = [];
  for (const tell of Array.isArray(pair?.tell) ? pair.tell : []) {
    const at = String(tell).indexOf(' : ');
    if (at < 0 || EATEN.test(tell)) continue;
    const label = tell.slice(0, at).trim(), text = tell.slice(at + 3).trim();
    const side = SIDES.find(s => (pair[s] || []).some(t => t.label === label));
    const t = side && pair[side].find(x => x.label === label);
    if (side && t && text) out.push({ side, taxon: t.taxon, label, text: text[0].toUpperCase() + text.slice(1) });
  }
  return out;
}

/** @template T @param {T[]} list @param {() => number} random @returns {T[]} */
function shuffled(list, random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * A new game: `clued` pairs with criteria (one of theirs, at random), pairs without for the rest of the `count` cards
 * (short of one kind, more of the other), each pair once, in no set order. On each card, the plant of its criterion
 * (else the look-alike) and the first plant of the other side, left or right at random.
 * @param {Pair[]} pairs @param {{ random?: () => number, count?: number, clued?: number }} [o] @returns {Game}
 */
export function dealGame(pairs, { random = Math.random, count = CARDS, clued = CLUED } = {}) {
  const valid = (Array.isArray(pairs) ? pairs : []).filter(p => p?.toxic?.length && p?.edible?.length);
  const withClues = shuffled(valid.filter(p => cluesOf(p).length), random);
  const without = shuffled(valid.filter(p => !cluesOf(p).length), random);
  const a = Math.min(clued, withClues.length);
  const b = Math.min(count - a, without.length);
  const more = Math.min(count - a - b, withClues.length - a);
  const picked = [...withClues.slice(0, a + more), ...without.slice(0, b)];
  return { v: 1, cards: shuffled(picked, random).map(p => {
    const clues = cluesOf(p);
    const clue = clues.length ? clues[Math.floor(random() * clues.length)] : null;
    const first = clue ? clue.taxon : p.toxic[0].taxon;
    const other = (clue?.side === 'edible' ? p.toxic : p.edible)[0].taxon;
    return { pair: pairKey(p), plants: /** @type {[string, string]} */ (random() < 0.5 ? [first, other] : [other, first]),
      clue: clue ? { taxon: clue.taxon, text: clue.text } : null, answer: null };
  }) };
}

/** A plant of a pair by its taxon, with its side. @param {Pair} pair @param {unknown} taxon @returns {Plant | null} */
function plantOf(pair, taxon) {
  for (const side of SIDES) {
    const t = pair[side].find(x => x.taxon === taxon);
    if (t) return { taxon: t.taxon, label: t.label, side };
  }
  return null;
}

/**
 * The cards of a game as they are shown, their words read from the file; null when there is no game, or when the file
 * no longer gives one of its cards (a pair, a plant or a criterion changed since it was dealt: the game is stale).
 * @param {Game | null | undefined} game @param {{ sources: Record<string, Source>, pairs: Pair[] } | null | undefined} data
 * @returns {Card[] | null}
 */
export function cardsOf(game, data) {
  if (!game || !Array.isArray(game.cards) || !game.cards.length || !Array.isArray(data?.pairs)) return null;
  const byKey = new Map(data.pairs.map(p => [pairKey(p), p]));
  /** @type {Card[]} */
  const out = [];
  for (const k of game.cards) {
    const pair = byKey.get(k?.pair);
    if (!pair || !Array.isArray(k.plants) || k.plants.length !== 2) return null;
    const plants = k.plants.map(t => plantOf(pair, t));
    if (!plants[0] || !plants[1] || plants[0].side === plants[1].side) return null;
    const clue = k.clue ? cluesOf(pair).find(c => c.taxon === k.clue?.taxon && c.text === k.clue.text) ?? null : null;
    if (k.clue && (!clue || !k.plants.includes(clue.taxon))) return null;
    const answer = typeof k.answer === 'string' ? k.answer : null;
    out.push({ key: k.pair, pair, plants: /** @type {[Plant, Plant]} */ (plants), clue, sources: pair.sources.map(id => data.sources?.[id]).filter(Boolean),
      answer, right: answer == null ? null : clue ? answer === clue.taxon : answer === SKIP });
  }
  return out;
}

/**
 * The game with its card `at` answered: `choice` is one of its plants (a card with a criterion) or SKIP (one without).
 * The same game for a card already answered, an answer it does not take, a card it does not have.
 * @param {Game} game @param {number} at @param {string} choice @returns {Game}
 */
export function answered(game, at, choice) {
  const k = game?.cards?.[at];
  if (!k || k.answer != null || !(k.clue ? k.plants.includes(choice) : choice === SKIP)) return game;
  return { ...game, cards: game.cards.map((c, i) => i === at ? { ...c, answer: choice } : c) };
}

/** The card to answer now, -1 when all are (the recap). @param {Game | null | undefined} game */
export const nextCard = game => Array.isArray(game?.cards) ? game.cards.findIndex(k => k?.answer == null) : -1;

/** A game started and not finished (the list of the ways to play offers « Continuer »). @param {Game | null | undefined} game */
export const underWay = game => Array.isArray(game?.cards) && game.cards.length > 0 && nextCard(game) >= 0;

/** The game kept on this device (the mini-app's state, runtime.js), read for the list of the ways to play. @returns {Game | null} */
export function keptGame() {
  try { return JSON.parse(localStorage.getItem(config.storageKeys.appPrefix + 'faux-amis.state') || 'null')?.ctx?.game ?? null; } catch { return null; }
}

/** The right answers among the cards. @param {Card[]} cards */
export const scoreOf = cards => ({ right: cards.filter(c => c.right).length, total: cards.length });

/**
 * The species shown for a taxon that names a genus: the one the sources mean, as people know it (digitale pourpre,
 * vérâtre blanc…); a genus not listed, its first species of the flora with a photo.
 */
export const SHOWN_SPECIES = /** @type {Record<string, string>} */ ({
  Colchicum: 'Colchicum autumnale', Digitalis: 'Digitalis purpurea', Symphytum: 'Symphytum officinale', Veratrum: 'Veratrum album',
  Vaccinium: 'Vaccinium myrtillus', Arum: 'Arum maculatum', Rumex: 'Rumex acetosa'
});

/**
 * The plant of the flora a card shows for a taxon, among `rows` (the flora's plants of its genus, or of its name): the
 * species itself, or the one shown for a genus (SHOWN_SPECIES), else the genus' first species with a photo, never a
 * hybrid; null when there is none.
 * @param {string} taxon @param {any[]} rows @returns {any}
 */
export function pickPlant(taxon, rows) {
  const name = taxon.includes(' ') ? taxon : SHOWN_SPECIES[taxon];
  const exact = name ? rows.find(r => r?.scientificName === name) : null;
  if (exact || taxon.includes(' ')) return exact ?? null;
  const species = rows.filter(r => r?.genus === taxon && !/ x /i.test(String(r.scientificName)));
  return species.find(r => r.thumbnail?.url) ?? species[0] ?? null;
}
