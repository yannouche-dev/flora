// @ts-check
// The cards of the plants around a place (Rencontres, Cueillette prudente, Mosaïque): what is pure about them — the
// distances offered, their words and their slider, the order of Cueillette prudente (only the plants of a dangerous
// confusion, the deadliest first) and its toxic look-alikes (never a match: recognised, to avoid), the deck (the cards
// not yet swiped), a swipe kept or taken back, the first sentence of what Wikipédia says, and a card's short « bio »,
// its safety lines first. No DOM, no network: tested under Node (tests/unit/around.test.mjs).

import { UNREAD, rank } from '../../core/danger.js';
import { gravest, severityOf } from '../../core/lookalikes.js';
import { STOPS as DISTANCES } from '../../core/distance.js';

/**
 * @typedef {{ plant: any, taxonId?: number, count: number, photo: string | null, credit: import('../../core/credit.js').Credit | null,
 *   blooming: boolean, verdict: import('../../core/danger.js').Verdict | null, confusions?: import('../../core/lookalikes.js').Lookalike[] }} Card
 *   `verdict`: the plant's (core/alerts.js#verdictOf, at the place), null until read
 * @typedef {{ matches: number[], passed: number[], avoided?: number[] }} Swipes `avoided`: Cueillette prudente's toxic
 *   look-alikes recognised (toAvoid); a game without it never gets the key.
 */

// How far to look, in metres (iNaturalist searches a circle; beyond 50 km the list is a region's, not « around »), and
// the distance shown (« 2 km », unrounded: a free layout's may lie between two stops) and in words, as a screen reader
// says it (« 2 kilomètres », « 500 mètres »): core/distance.js's.
export { DISTANCES };
export { radiusLabel as distLabel, radiusWords as distWords } from '../../core/distance.js';
/** A word for the distance, for fun. @param {number} m */
export const distMood = m => m <= 200 ? 'Juste devant la porte' : m <= 1000 ? 'Le quartier' : m <= 5000 ? 'Une balade à pied' : m <= 20000 ? 'Un tour à vélo' : 'Toute la région';
/** The next distance offered past `m` (none past 50 km). @param {number} m */
export const nextDistance = m => DISTANCES.find(d => d > m);

// A slider of the distances (Rencontres' « Jusqu'où ? », a free layout's radius): its stops are DISTANCES, each the
// same width, and its value a position among them — any distance shown where it is, never moved to a stop it is not:
// a free layout's address may say r=3km, which sits between 2 and 5 km (the thumb there, the label « 3 km »). So the
// input is step="any": dragged or touched, it gives the closest stop (distanceNear), and its keys are its own
// (distanceKey: from stop to stop — the browser's would creep by hundredths).

/**
 * The slider's position of a distance: its stop (0…7), or between the two stops around it, as far along as its ratio
 * to them (3 km: 0.44 of the way from 2 to 5 km); before the first stop or past the last, at that end.
 * @param {number} m
 */
export function distanceAt(m) {
  const at = DISTANCES.indexOf(m);
  if (at >= 0) return at;
  const next = DISTANCES.findIndex(d => d > m);
  if (next <= 0) return next === 0 ? 0 : DISTANCES.length - 1;
  return next - 1 + Math.log(m / DISTANCES[next - 1]) / Math.log(DISTANCES[next] / DISTANCES[next - 1]);
}

/** The stop closest to a position of the slider (a thumb dragged, the track touched). @param {number} at */
export const distanceNear = at => DISTANCES[Math.min(DISTANCES.length - 1, Math.max(0, Math.round(Number(at) || 0)))];

/**
 * The distance a key gives on the slider, from `m`: → ↑ the next stop past it, ← ↓ the one before (from between two
 * stops: one of those two), Page ↑ / Page ↓ two stops, Début / Fin the ends (at an end, `m` itself); null for any other key.
 * @param {string} key @param {number} m @returns {number | null}
 */
export function distanceKey(key, m) {
  const up = (/** @type {number} */ n) => { const past = DISTANCES.filter(d => d > m); return past.length ? past[Math.min(n, past.length) - 1] : m; };
  const down = (/** @type {number} */ n) => { const before = DISTANCES.filter(d => d < m); return before.length ? before[Math.max(0, before.length - n)] : m; };
  switch (key) {
    case 'ArrowRight': case 'ArrowUp': return up(1);
    case 'ArrowLeft': case 'ArrowDown': return down(1);
    case 'PageUp': return up(2);
    case 'PageDown': return down(2);
    case 'Home': return DISTANCES[0];
    case 'End': return DISTANCES[DISTANCES.length - 1];
    default: return null;
  }
}

/**
 * The listeners of a distance slider (`@input`, `@keydown`): the distance set, and the thumb put on it at once (a
 * drag between two stops shows the stop it gives, not where the pointer is).
 * @param {() => number} now the distance shown @param {(m: number) => void} set
 * @returns {{ input: (e: any) => void, keydown: (e: any) => void }}
 */
export function distanceEvents(now, set) {
  const to = (/** @type {any} */ e, /** @type {number} */ m) => {
    if (m !== now()) set(m);
    e.target.value = String(distanceAt(m));
  };
  return {
    input: e => to(e, distanceNear(e.target.value)),
    keydown: e => {
      const m = distanceKey(e.key, now());
      if (m === null) return;
      e.preventDefault();
      to(e, m);
    }
  };
}
export const MONTH = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** The cards shown at first in « Toutes », and each « Voir plus ». */
export const PAGE = 12;

// A plant's name (its first common name, else its scientific one) is core/plants.js's, offered here too: the kit's
// screens import it from this module, and so do two e2e specs, in the page.
export { nameOf } from '../../core/plants.js';

/**
 * Cueillette prudente: only the plants of the Anses / Centres antipoison confusions, the deadliest first, then
 * those with an edible side, then the most observed. The list unreadable (`unread`): every plant kept, never « none to
 * pick » (each card says it). @param {Card[]} list @param {boolean} unread @returns {Card[]}
 */
export function harvestOrder(list, unread) {
  const deadly = (/** @type {Card} */ c) => gravest(c.confusions || []).rank;
  const edible = (/** @type {Card} */ c) => Number(Boolean(c.confusions?.some(l => l.side === 'edible')));
  return list.filter(c => unread || c.confusions?.length)
    .sort((a, b) => deadly(b) - deadly(a) || edible(b) - edible(a) || b.count - a.count);
}

/** The other ways: the most observed here first (the most photos), then those in flower. @param {Card[]} list */
export const aroundOrder = list => [...list].sort((a, b) => b.count - a.count || Number(b.blooming) - Number(a.blooming));

/**
 * Cueillette prudente: a plant on the toxic side of a confusion (only its cards carry their confusions) — never a
 * match nor a favourite: swiped right, it is recognised, to avoid (kit/session.js#swiped). @param {Card} c
 */
export const toAvoid = c => Boolean(c.confusions?.some(l => l.side === 'toxic'));

/**
 * The cards not yet swiped (passed ones are not shown again; matches neither, nor the plants recognised to avoid).
 * @param {Card[]} cards @param {Swipes} s
 */
export const deckOf = (cards, s) => cards.filter(c => !s.passed.includes(c.plant.id) && !s.matches.includes(c.plant.id) && !s.avoided?.includes(c.plant.id));

/** The plants recognised to avoid without `id`, in a game that keeps them (Cueillette prudente). @param {Swipes} s @param {number} id */
const unavoided = (s, id) => (s.avoided ? { avoided: s.avoided.filter(x => x !== id) } : {});

/**
 * A card swiped: right, a match (kept); left, passed (not shown again here; the last 500).
 * @param {Swipes} s @param {number} id @param {boolean} liked @returns {Swipes}
 */
export const swipe = (s, id, liked) => ({ ...(liked
  ? { matches: [...s.matches.filter(x => x !== id), id], passed: s.passed.filter(x => x !== id) }
  : { passed: [...s.passed.filter(x => x !== id), id].slice(-500), matches: s.matches.filter(x => x !== id) }), ...unavoided(s, id) });

/**
 * Cueillette prudente: a toxic look-alike swiped right (toAvoid) — recognised, to avoid: never a match, not shown again
 * here (as a pass; the last 500), counted apart. @param {Swipes} s @param {number} id @returns {Swipes}
 */
export const avoid = (s, id) => ({ avoided: [...(s.avoided ?? []).filter(x => x !== id), id].slice(-500),
  matches: s.matches.filter(x => x !== id), passed: s.passed.filter(x => x !== id) });

/** A card back in the deck (« ↺ »: the last swipe undone, or a match taken back). @param {Swipes} s @param {number} id @returns {Swipes} */
export const unswipe = (s, id) => ({ matches: s.matches.filter(x => x !== id), passed: s.passed.filter(x => x !== id), ...unavoided(s, id) });

/**
 * What is said of it, in one sentence: the first of the article's names and etymology, else of its history, else its
 * short description (Wikipédia, CC BY-SA); '' for nothing worth it. @param {any} wiki @returns {string}
 */
export function ethnoSentence(wiki) {
  const first = (/** @type {string | undefined} */ t) => {
    const one = (t || '').replace(/\s+/g, ' ').trim().match(/^.{20,220}?[.!?](?=\s|$)/)?.[0] || (t || '').trim().slice(0, 180);
    return one.length > 20 ? one : '';
  };
  const pick = (/** @type {string} */ theme) => first(wiki?.sections?.find((/** @type {any} */ x) => x.theme === theme)?.text);
  return pick('names') || pick('history') || first(wiki?.description || '') || '';
}

/** The reasons that say the plant itself is toxic; the toxic side of a confusion too, unless the card says it already. */
const TOXIC = new Set(['tppt', 'ansm-b', 'ansm-a']);

/**
 * A short bio, from the plant's real data — with a wink. Safety first (only 4 lines are kept): Cueillette prudente's
 * confusions, toxicity data unreadable, toxic or protected — its verdict's reasons (core/danger.js); « à table » only
 * for the species the Anses names as picked (lookalikes.js#edibleFilter: never through its genus), never for a plant
 * toxic, protected, regulated or whose toxicity could not be read. `months`: its flowering months (0 = January).
 * @param {Card} c @param {Set<number>} months @returns {string[]}
 */
export function bio(c, months) {
  const p = c.plant, v = c.verdict, out = [];
  // Cueillette prudente: the confusion first (only its cards carry their confusions).
  const said = (c.confusions || []).slice(0, 2);
  for (const l of said) {
    const others = l.others.map(o => o.label).join(', ');
    out.push(l.side === 'edible' ? `⚠️ Ne me confondez pas avec ${others} (${severityOf(l.pair).tag}). Partie : ${l.pair.part}.`
      : `☠️ Je suis le sosie ${severityOf(l.pair).tag} de ${others}.`);
  }
  // Data unreadable: said, never left out (danger.js).
  if (v?.unread) out.push('⚠️ ' + UNREAD + '.');
  const reasons = v?.reasons || [];
  // The toxic side of a confusion is the plant's own ☠️ line wherever no confusion line says it (Rencontres, Mosaïque,
  // a free layout's deck: a card without its confusions — « Plante mortelle, confondue avec Carotte sauvage »).
  const saidSide = said.some(l => l.side === 'toxic');
  const toxicLine = reasons.find(r => (TOXIC.has(r.kind) || (r.kind === 'toxic-side' && !saidSide)) && rank(r.level) >= rank('danger'));
  if (toxicLine) out.push('☠️ ' + toxicLine.text + '. On regarde, on ne goûte pas.');
  else if (reasons.some(r => r.kind === 'protected' || r.kind === 'protected-elsewhere')) out.push('🛡️ Espèce protégée : on m’admire, on ne me cueille pas.');
  const n = reasons.filter(r => r.kind === 'edible-side').length;
  if (n && v) {
    // Never « comestible »: the part the Anses says is picked, for the species it names; no « à table » for a plant
    // toxic (TPPT 2 or more, ANSM), protected or regulated, whose toxicity could not be read, or reached by its genus.
    const kept = reasons.some(r => r.kind === 'protected' || r.kind === 'protected-elsewhere' || r.kind === 'regulated');
    out.push(!v.toxic && !kept && !v.unread && v.eaten.length
      ? `🍽️ Partie consommée selon l’Anses : ${v.eaten.join(', ')}. J’ai des sosies toxiques (${n}) : lisez ma fiche avant de passer à table.`
      : `⚠️ J’ai des sosies toxiques (${n}). Lisez ma fiche avant toute cueillette.`);
  }
  if (c.blooming) out.push('🌼 En fleur en ce moment : c’est le jour de la photo.');
  else if (months.size) out.push(`🗓️ Je fleuris de ${MONTH[[...months][0]]} à ${MONTH[[...months][months.size - 1]]}. Repassez me voir.`);
  // How often it is seen here, in words (no count on the card).
  out.push(c.count >= 50 ? '📸 Très populaire par ici.' : c.count <= 3 ? '🤫 Rare par ici : une belle rencontre.' : '👀 Assez présente dans le coin.');
  if (p.family) out.push(`👪 De la famille des ${p.family}.`);
  return out.slice(0, 4);
}
