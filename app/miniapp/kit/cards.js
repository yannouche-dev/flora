// @ts-check
// The cards of the plants around a place (Rencontres, Cueillette prudente, Mosaïque): what is pure about them — the
// distances offered and their words, the order of Cueillette prudente (only the plants of a dangerous confusion, the
// deadliest first), the deck (the cards not yet swiped), a swipe kept or taken back, the first sentence of what
// Wikipédia says, and a card's short « bio », its safety lines first. No DOM, no network: tested under Node
// (tests/unit/around-cards.test.mjs).

import { UNREAD } from '../../core/alerts.js';
import { gravest, severityOf } from '../../core/lookalikes.js';
import { harvestRules } from '../../core/regulation.js';

/**
 * @typedef {{ plant: any, taxonId?: number, count: number, photo: string | null, credit: import('../../core/credit.js').Credit | null,
 *   blooming: boolean, alerts: any, confusions?: import('../../core/lookalikes.js').Lookalike[] }} Card
 * @typedef {{ matches: number[], passed: number[] }} Swipes
 */

/** How far to look, in metres (iNaturalist searches a circle; beyond 50 km the list is a region's, not « around »). */
export const DISTANCES = [200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
/** @param {number} m */
export const distLabel = m => m >= 1000 ? (m / 1000).toLocaleString('fr-FR') + ' km' : m + ' m';
/** The distance in words, as a screen reader says it (« 2 kilomètres », « 500 mètres »). @param {number} m */
export const distWords = m => {
  const n = m >= 1000 ? m / 1000 : m, unit = m >= 1000 ? 'kilomètre' : 'mètre';
  return `${n.toLocaleString('fr-FR')} ${unit}${n >= 2 ? 's' : ''}`;
};
/** A word for the distance, for fun. @param {number} m */
export const distMood = m => m <= 200 ? 'Juste devant la porte' : m <= 1000 ? 'Le quartier' : m <= 5000 ? 'Une balade à pied' : m <= 20000 ? 'Un tour à vélo' : 'Toute la région';
/** The next distance offered past `m` (none past 50 km). @param {number} m */
export const nextDistance = m => DISTANCES.find(d => d > m);
/** The slider's position of a distance. @param {number} m */
export const distanceAt = m => Math.max(0, DISTANCES.indexOf(m));
export const MONTH = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** The cards shown at first in « Toutes », and each « Voir plus ». */
export const PAGE = 12;

/** A plant's name: its first common name, else its scientific one. @param {any} plant @returns {string} */
export const nameOf = plant => plant.vernacularNames?.[0] || plant.scientificName;

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

/** The cards not yet swiped (passed ones are not shown again; matches neither). @param {Card[]} cards @param {Swipes} s */
export const deckOf = (cards, s) => cards.filter(c => !s.passed.includes(c.plant.id) && !s.matches.includes(c.plant.id));

/**
 * A card swiped: right, a match (kept); left, passed (not shown again here; the last 500).
 * @param {Swipes} s @param {number} id @param {boolean} liked @returns {Swipes}
 */
export const swipe = (s, id, liked) => liked
  ? { matches: [...s.matches.filter(x => x !== id), id], passed: s.passed.filter(x => x !== id) }
  : { passed: [...s.passed.filter(x => x !== id), id].slice(-500), matches: s.matches.filter(x => x !== id) };

/** A card back in the deck (« ↺ »: the last swipe undone, or a match taken back). @param {Swipes} s @param {number} id @returns {Swipes} */
export const unswipe = (s, id) => ({ matches: s.matches.filter(x => x !== id), passed: s.passed.filter(x => x !== id) });

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

/**
 * A short bio, from the plant's real data — with a wink. Safety first (only 4 lines are kept): Cueillette prudente's
 * confusions, toxicity data unreadable, toxic or protected; « à table » never said of a plant toxic, protected,
 * regulated or whose toxicity could not be read. `months`: its flowering months (0 = January).
 * @param {Card} c @param {Set<number>} months @returns {string[]}
 */
export function bio(c, months) {
  const p = c.plant, a = c.alerts, out = [];
  // Cueillette prudente: the confusion first.
  for (const l of (c.confusions || []).slice(0, 2)) {
    const others = l.others.map(o => o.label).join(', ');
    out.push(l.side === 'edible' ? `⚠️ Ne me confondez pas avec ${others} (${severityOf(l.pair).tag}). Partie : ${l.pair.part}.`
      : `☠️ Je suis le sosie ${severityOf(l.pair).tag} de ${others}.`);
  }
  // Data unreadable: said, never left out (alerts.js).
  if (a?.unread) out.push('⚠️ ' + UNREAD + '.');
  const facts = /** @type {string[]} */ (a?.safety?.text || []).filter(t => t !== UNREAD);
  const toxicLine = a?.safety?.tone === 'danger' && facts.find(t => /toxi|mortel|ANSM/i.test(t));
  if (toxicLine) out.push('☠️ ' + toxicLine + '. On regarde, on ne goûte pas.');
  else if (facts.some(t => /Protégée/.test(t))) out.push('🛡️ Espèce protégée : on m’admire, on ne me cueille pas.');
  if (a?.edible) {
    // Never « comestible »: the part the Anses says is eaten, and no « à table » for a plant toxic (TPPT 2 or more,
    // ANSM), protected or regulated, or whose toxicity could not be read.
    const n = a.edible.text.length;
    const kept = (p.statuses || []).some((/** @type {any} */ s) => /^(PN|PR|PD)$/.test(s.type)) || harvestRules(p.statuses).length > 0;
    out.push(a.toxic || kept || a.unread ? `⚠️ J’ai des sosies dangereux (${n}). Lisez ma fiche avant toute cueillette.`
      : a.edible.parts?.length ? `🍽️ Partie consommée selon l’Anses : ${a.edible.parts.join(', ')}. J’ai des sosies dangereux (${n}) : lisez ma fiche avant de passer à table.`
      : `⚠️ J’ai des sosies dangereux (${n}) : lisez ma fiche avant de passer à table.`);
  }
  if (c.blooming) out.push('🌼 En fleur en ce moment : c’est le jour de la photo.');
  else if (months.size) out.push(`🗓️ Je fleuris de ${MONTH[[...months][0]]} à ${MONTH[[...months][months.size - 1]]}. Repassez me voir.`);
  // How often it is seen here, in words (no count on the card).
  out.push(c.count >= 50 ? '📸 Très populaire par ici.' : c.count <= 3 ? '🤫 Rare par ici : une belle rencontre.' : '👀 Assez présente dans le coin.');
  if (p.family) out.push(`👪 De la famille des ${p.family}.`);
  return out.slice(0, 4);
}
