// @ts-check
// Faux amis: a short game on the confusions of the Anses and Centres antipoison (data/lookalikes.json) — what is pure
// about it. Six cards, one pair each: the plant sought and its toxic look-alike, side by side, each with its name. Four
// ask « À qui est cet indice ? »: a criterion the sources give for one of the two (« Ail des ours : odeur d’ail… »), its
// plant to touch. Two show a pair the sources give no criterion for: the card says so, and its only answer is « Je ne
// cueille pas ». Each answer says whose the criterion was, the part mistaken, how dangerous the look-alike is, and the
// sources; the last one, the recap and the score.
// A game keeps only what names its cards (the pairs' taxa, the criterion's words, the answers): its words are read from
// the file each time, and a card the file no longer gives (a criterion corrected since) makes the game stale.
// « The sources give no criterion » means what the plant sheet (gf-lookalikes) and the CI (check-confusions) mean: the
// pair has no `tell` at all. A pair whose criteria are general (« Confusion des feuilles… ») is not dealt.
// Never a word that a plant can be eaten: a criterion that says so is left out (lookalikes.js#edibleFilter, the one
// filter of the plant sheet and the cards too).
// No DOM, no network: tested under Node (tests/unit/faux-amis.test.mjs). Where a kept game stands (the card to answer,
// a game under way): faux-amis-store.js.

import { edibleFilter } from '../../core/lookalikes.js';

/**
 * @typedef {import('../../core/lookalikes.js').Pair} Pair
 * @typedef {import('../../core/lookalikes.js').Source} Source
 * @typedef {'toxic' | 'edible'} Side
 * @typedef {{ side: Side, taxon: string, label: string, text: string }} Clue   a criterion of one plant of a pair, its name taken off
 * @typedef {{ pair: string, plants: [string, string], clue: { taxon: string, text: string } | null, answer: string | null }} Kept
 *   a card as a game keeps it: its pair (pairKey), the taxa of its two plants as shown (left, right), its criterion, its
 *   answer (the taxon touched, or SKIP)
 * @typedef {{ cards: Kept[] }} Game
 * @typedef {{ taxon: string, label: string, side: Side }} Plant   a plant of a pair
 * @typedef {{ pair: Pair, plants: [Plant, Plant], toxic: Plant, sought: Plant, also: Plant[], clue: Clue | null, sources: Source[],
 *   answer: string | null, right: boolean | null }} Card   a card as it is shown, its words read from the file; `also`: the
 *   pair's other plants, not on the card (Petite ciguë beside Grande ciguë)
 */

/** The answer of a card without criterion: « Je ne cueille pas ». */
export const SKIP = 'skip';
/** The cards of a game, and how many of them ask whose a criterion is (the others: pairs without one). */
export const CARDS = 6, CLUED = 4;

const SIDES = /** @type {Side[]} */ (['toxic', 'edible']);
/** « Ail des ours : odeur d’ail… »: a plant's name, then its criterion (any space before the colon, a French one too). */
const LABELLED = /^([^:]+?)[\s\u00a0\u202f]*:\s*([\s\S]+)$/;

/** A pair's key, its taxa (the toxic ones first): a game names its pairs by it. @param {Pair} pair */
export const pairKey = pair => `${pair.toxic.map(t => t.taxon).join('+')}>${pair.edible.map(t => t.taxon).join('+')}`;

/** The sources give no criterion for this pair (none at all, as the plant sheet says it). @param {Pair} pair */
export const noCriterion = pair => !(Array.isArray(pair?.tell) && pair.tell.length);

/**
 * The criteria of a pair that are one of its plants' (« Ail des ours : odeur d’ail… »): the sources' words, the name
 * taken off, the first letter capitalised. Not a general one (« Vérifier l’odeur d’ail… »), nor one that names another
 * plant, nor one that says a plant can be eaten.
 * @param {Pair} pair @returns {Clue[]}
 */
export function cluesOf(pair) {
  /** @type {Clue[]} */
  const out = [];
  for (const tell of edibleFilter({ pair }).criteria) {
    const m = LABELLED.exec(String(tell).trim());
    if (!m) continue;
    const label = m[1].trim(), text = m[2].trim();
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
 * A new game of `count` cards: `clued` pairs with criteria (one of theirs, at random), pairs without any criterion for
 * the rest (short of those, more pairs with criteria), each pair once, in no set order. On a card with a criterion,
 * its plant and the one it tells it from (on the other side: one with a criterion of its own — the ail des ours for the
 * colchique's —, else any); without, one look-alike and one plant sought, any of the pair's. Left or right at random.
 * @param {Pair[]} pairs @param {{ random?: () => number, count?: number, clued?: number }} [o] @returns {Game}
 */
export function dealGame(pairs, { random = Math.random, count = CARDS, clued = CLUED } = {}) {
  const valid = (Array.isArray(pairs) ? pairs : []).filter(p => p?.toxic?.length && p?.edible?.length);
  const withClues = shuffled(valid.filter(p => cluesOf(p).length), random);
  const without = shuffled(valid.filter(noCriterion), random);
  const n = Math.max(0, count);
  const a = Math.min(clued, n, withClues.length);
  const b = Math.min(n - a, without.length);
  const more = Math.min(n - a - b, withClues.length - a);
  const picked = [...withClues.slice(0, a + more), ...without.slice(0, b)];
  const pick = (/** @type {any[]} */ list) => list[Math.floor(random() * list.length)];
  return { cards: shuffled(picked, random).map(p => {
    const clues = cluesOf(p);
    const clue = clues.length ? pick(clues) : null;
    let first, other;
    if (clue) {
      const side = clue.side === 'edible' ? 'toxic' : 'edible';
      const counter = clues.filter(c => c.side === side).map(c => c.taxon);
      first = clue.taxon;
      other = counter.length ? pick(counter) : pick(p[side]).taxon;
    } else {
      first = pick(p.toxic).taxon;
      other = pick(p.edible).taxon;
    }
    return { pair: pairKey(p), plants: /** @type {[string, string]} */ (random() < 0.5 ? [first, other] : [other, first]),
      clue: clue ? { taxon: clue.taxon, text: clue.text } : null, answer: null };
  }) };
}

/** The plants of a pair, the look-alikes first, each with its side. @param {Pair} pair @returns {Plant[]} */
const plantsOf = pair => SIDES.flatMap(side => pair[side].map(t => ({ taxon: t.taxon, label: t.label, side })));

/**
 * The cards of a game as they are shown, their words read from the file; null when there is no game, or when the file
 * no longer gives one of its cards — a pair, a plant or a criterion changed since it was dealt, a pair without criterion
 * that now has some — or the game is not one the app deals (the game is stale).
 * @param {Game | null | undefined} game @param {{ sources: Record<string, Source>, pairs: Pair[] } | null | undefined} data
 * @returns {Card[] | null}
 */
export function cardsOf(game, data) {
  if (!game || !Array.isArray(game.cards) || !game.cards.length || !Array.isArray(data?.pairs)) return null;
  const byKey = new Map(data.pairs.map(p => [pairKey(p), p]));
  if (new Set(game.cards.map(k => k?.pair)).size !== game.cards.length) return null;
  /** @type {Card[]} */
  const out = [];
  for (const k of game.cards) {
    const pair = byKey.get(k?.pair);
    if (!pair || !Array.isArray(k.plants) || k.plants.length !== 2) return null;
    const all = plantsOf(pair);
    const plants = k.plants.map(t => all.find(p => p.taxon === t));
    if (!plants[0] || !plants[1] || plants[0].side === plants[1].side) return null;
    const clue = k.clue ? cluesOf(pair).find(c => c.taxon === k.clue?.taxon && c.text === k.clue.text) ?? null : null;
    if (k.clue ? !clue || !k.plants.includes(clue.taxon) : !noCriterion(pair)) return null;
    const answer = k.answer ?? null;
    if (answer != null && !(clue ? k.plants.includes(answer) : answer === SKIP)) return null;
    out.push({ pair, plants: /** @type {[Plant, Plant]} */ (plants),
      toxic: /** @type {Plant} */ (plants.find(p => p.side === 'toxic')), sought: /** @type {Plant} */ (plants.find(p => p.side === 'edible')),
      also: all.filter(p => !k.plants.includes(p.taxon)), clue, sources: pair.sources.map(id => data.sources?.[id]).filter(Boolean),
      answer, right: answer == null ? null : clue ? answer === clue.taxon : true });
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
  const species = rows.filter(r => r?.genus === taxon && !/(^|\s)[x×](\s|$)/i.test(String(r.scientificName)));
  return species.find(r => r.thumbnail?.url) ?? species[0] ?? null;
}
