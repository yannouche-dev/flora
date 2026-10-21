// @ts-check
// Plantes à confondre: edible plants and the toxic plants they are mistaken for, as listed by the Anses and
// the Centres antipoison (data/lookalikes.json — sources, distinguishing criteria and symptoms quoted from them).
// Bundled with the app (precached): the warning must work offline, where the picking happens.
// A file that cannot be read is an error, never « no confusion »: callers say the list is unavailable.

import { bundledJSON } from './bundled.js';
import * as db from './db.js';

/**
 * @typedef {{ taxon: string, label: string }} Taxon   One word: the whole genus (« Digitalis sp. »).
 * @typedef {{ title: string, publisher: string, date: string, url: string }} Source
 * @typedef {{ toxic: Taxon[], edible: Taxon[], part: string, severity: 'mortel' | 'grave' | 'toxique', severityFrom?: 'tppt',
 *   tell: string[], symptoms?: string, sources: string[] }} Pair
 * @typedef {{ side: 'edible' | 'toxic', pair: Pair, others: (Taxon & { id: number | null })[], sources: Source[], named: boolean }} Lookalike
 *   `named`: the pair names this plant itself (its name or a synonym), not only its genus (« Symphytum »: every consoude)
 * @typedef {{ key: Pair['severity'], rank: number, tag: string, plant: string, danger: boolean }} Severity
 */

/**
 * How each severity reads: « mortel » when the Anses or the Centres antipoison say so; « grave » when the toxic plant
 * is at the top level of Agroscope's TPPT base (very strong toxic: « très toxique », severityFrom « tppt »); « toxique »
 * otherwise. `tag`: the badge and « (…) » after a name; `plant`: « Plante … »; `danger`: the red tone.
 * @type {Record<Pair['severity'], Severity>}
 */
export const SEVERITY = {
  mortel: { key: 'mortel', rank: 2, tag: 'mortel', plant: 'mortelle', danger: true },
  grave: { key: 'grave', rank: 1, tag: 'très toxique', plant: 'très toxique', danger: true },
  toxique: { key: 'toxique', rank: 0, tag: 'toxique', plant: 'toxique', danger: false }
};

/** A pair's severity (an unknown value reads as « toxique », never as nothing). @param {Pair | undefined} pair */
export const severityOf = pair => SEVERITY[/** @type {Pair['severity']} */ (pair?.severity)] || SEVERITY.toxique;

/** The gravest severity of some confusions (« toxique » for none). @param {Lookalike[]} list */
export const gravest = list => list.reduce((worst, l) => severityOf(l.pair).rank > worst.rank ? severityOf(l.pair) : worst, SEVERITY.toxique);

/** « (mortel) », « (très toxique) » after a name; nothing for « toxique ». @param {Pair} pair */
export const severityNote = pair => severityOf(pair).rank > 0 ? ` (${severityOf(pair).tag})` : '';

/**
 * The look-alikes file; rejects (and is asked again next time) when it cannot be read or has no pairs.
 * @returns {Promise<{ sources: Record<string, Source>, pairs: Pair[] }>}
 */
export function lookalikeData() {
  return bundledJSON('lookalikes.json', { check: d => Array.isArray(d?.pairs) && d.pairs.length ? null : 'no pairs' });
}

/**
 * A scientific name as a key: lower case, single spaces, « × » as « x », without its author. The word after the genus
 * (and a hybrid sign) is the epithet when it is a word, whatever its case (« molopospermum Peloponnesiacum »), else
 * the author of a genus (« Colchicum L. »); after the epithet, the author starts at the first capitalised word or
 * parenthesis, unless a hybrid sign comes just before it (« A b x C d »).
 * @param {string} name
 */
export const nameKey = name => {
  const words = String(name || '').replace(/×/g, ' x ').trim().split(/\s+/).filter(Boolean);
  const x = (/** @type {string | undefined} */ w) => w?.toLowerCase() === 'x';
  // The genus (after a hybrid sign: « × Anacamptorchis »), then the epithet (after one: « Mentha × piperita »).
  const genus = x(words[0]) ? 2 : 1, epithet = genus + Number(x(words[genus]));
  if (!/^\p{L}[\p{L}-]*$/u.test(words[epithet] || '')) return words.slice(0, genus).join(' ').toLowerCase();
  const end = words.findIndex((w, i) => i > epithet && /^[(\p{Lu}]/u.test(w) && !x(words[i - 1]));
  return (end < 0 ? words : words.slice(0, end)).join(' ').toLowerCase();
};

/** A key that names a genus (one word, after a hybrid sign): « colchicum », « x anacamptorchis ». @param {string} key */
const genusKey = key => !key.replace(/^x /, '').includes(' ');

/** The genus a taxon names, without its author (« Colchicum L. » → « Colchicum »); null for a species. @param {string} name */
export function genusOf(name) {
  const key = nameKey(name);
  return genusKey(key) ? String(name).replace(/×/g, ' x ').trim().split(/\s+/).slice(0, key.split(' ').length).join(' ') : null;
}

/** Names resolved this session (only those found: the flora may still be loading). @type {Map<string, Promise<number>>} */
const ids = new Map();
/** @type {Promise<Map<string, number[]>> | null} */
let synonyms = null;

/** The plants of the flora by their synonyms (as keys), read once, when a name of the file is no accepted name. */
function synonymIndex() {
  synonyms ??= db.getAll('plants').then(plants => {
    /** @type {Map<string, number[]>} */
    const map = new Map();
    for (const p of plants) for (const s of p.synonyms || []) {
      const list = map.get(nameKey(s)) || [];
      if (!list.includes(p.id)) map.set(nameKey(s), [...list, p.id]);
    }
    // An empty flora (still loading) is not kept.
    if (!plants.length) synonyms = null;
    return map;
  });
  synonyms.catch(() => { synonyms = null; });
  return synonyms;
}

/**
 * A species of the flora by its name, for a link to its sheet and to know a sheet's plant (null for a genus or a
 * plant not in the flora): the plant whose accepted name it is, else the only plant that has it as a synonym
 * (another spelling, an older name: « Molopospermum peloponnesiacum »). Author and case left aside.
 * @param {string} name @returns {Promise<number | null>}
 */
async function plantId(name) {
  const key = nameKey(name);
  if (genusKey(key)) return null;
  const [genus, species] = key.split(' ');
  let found = ids.get(key);
  if (!found) {
    found = (async () => {
      const rows = await db.getAllByIndex('plants', 'by_taxon', [genus[0].toUpperCase() + genus.slice(1), species]);
      const accepted = rows.find(row => nameKey(row.scientificName) === key);
      if (accepted) return accepted.id;
      const owners = (await synonymIndex()).get(key) || [];
      if (owners.length !== 1) throw new Error('no plant');
      return owners[0];
    })();
    ids.set(key, found);
    found.catch(() => ids.delete(key));
  }
  return found.catch(() => null);
}

/**
 * Does this taxon of a pair name this plant, and how? Its genus (one word without its author, nameKey): 'genus'; its
 * accepted name, or one of its synonyms that is no other plant's accepted name (plantId): 'species'. A record without
 * synonyms (a collection entry) is checked through the flora.
 * @param {Taxon} taxon @param {any} plant @param {string} name the plant's name, as a key @param {Set<string> | null} own its synonyms, as keys
 * @returns {Promise<'genus' | 'species' | null>}
 */
async function matches(taxon, plant, name, own) {
  const key = nameKey(taxon.taxon);
  if (genusKey(key)) return nameKey(plant.genus) === key ? 'genus' : null;
  if (key === name) return 'species';
  if (own && !own.has(key)) return null;
  return plant.id != null && await plantId(taxon.taxon) === plant.id ? 'species' : null;
}

/**
 * The confusions a plant is part of, on either side, the most dangerous first.
 * @param {any} plant @returns {Promise<Lookalike[]>}
 */
export async function lookalikesOf(plant) {
  if (!plant?.genus) return [];
  const { sources, pairs } = await lookalikeData();
  const name = nameKey(plant.scientificName);
  const own = Array.isArray(plant.synonyms) ? new Set(plant.synonyms.map(nameKey)) : null;
  // How a side names the plant: by name before by genus (a pair may name both).
  const how = async (/** @type {Taxon[]} */ taxa) => {
    let by = null;
    for (const t of taxa) { const m = await matches(t, plant, name, own); if (m === 'species') return m; by ||= m; }
    return by;
  };
  /** @type {Lookalike[]} */
  const found = [];
  for (const pair of pairs) {
    const edible = await how(pair.edible), toxic = edible ? null : await how(pair.toxic);
    const side = edible ? 'edible' : toxic ? 'toxic' : null;
    if (!side) continue;
    const others = await Promise.all((side === 'edible' ? pair.toxic : pair.edible).map(async t => ({ ...t, id: await plantId(t.taxon) })));
    found.push({ side, pair, others, sources: pair.sources.map(id => sources[id]).filter(Boolean), named: (edible || toxic) === 'species' });
  }
  return found.sort((a, b) => severityOf(b.pair).rank - severityOf(a.pair).rank);
}

/** Words that say a plant can be eaten: never the app's (« comestible », « consommées en beignets », « se mange »). */
const EATEN = /comestible|consomm|se mange/i;

/**
 * The one « comestible » filter, read by the plant sheet (gf-lookalikes), Faux amis and the cards of the games: the app
 * never says a plant can be eaten. Of a confusion, its criteria without those that say a plant is eaten (« Seul le
 * laurier sauce (Laurus nobilis) est comestible… »), and the part its source says is picked — only for the species the
 * source names (`named`, the edible side), never for a plant it reaches through its genus: « Symphytum » names no
 * consoude in particular, so no consoude gets « partie consommée » (its confusion with the digitale is still said).
 * @param {{ pair: Pair, side?: Lookalike['side'], named?: boolean }} l a plant's confusion, or a pair alone (no part)
 * @returns {{ criteria: string[], part: string | null }}
 */
export function edibleFilter({ pair, side, named }) {
  return { criteria: (Array.isArray(pair?.tell) ? pair.tell : []).filter(t => !EATEN.test(String(t))),
    part: side === 'edible' && named && pair?.part ? pair.part : null };
}

/** When the list cannot be read: said, never left out. */
export const UNREAD_LOOKALIKES = 'Liste des confusions indisponible pour le moment : ne consommez aucune plante sans vérification.';

/**
 * One line for the toast of « Noter ici »: what this plant can be mistaken for (or that it is the toxic one), or that the
 * list could not be read (`unread`).
 * @param {any} plant @returns {Promise<{ toxic: boolean, text: string, unread?: boolean } | null>}
 */
export async function lookalikeWarning(plant) {
  let list;
  try { list = await lookalikesOf(plant); } catch { return { toxic: true, unread: true, text: UNREAD_LOOKALIKES }; }
  const edible = list.filter(l => l.side === 'edible');
  if (edible.length) {
    const names = edible.flatMap(l => l.others.map(o => o.label + severityNote(l.pair)));
    return { toxic: false, text: 'Ne pas confondre avec : ' + [...new Set(names)].join(', ') };
  }
  const toxic = list.find(l => l.side === 'toxic');
  return toxic ? { toxic: true, text: `Plante ${severityOf(toxic.pair).plant}, confondue avec : ${toxic.others.map(o => o.label).join(', ')}` } : null;
}
