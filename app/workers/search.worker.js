// @ts-check
// Search, faceted filtering and sorting over the local flora, off the main thread.
// ~7.7k species: a ranked linear scan answers in a few milliseconds, no library needed.

import { getAll } from '../core/db.js';

/** Facets, in the order the filter panel shows them. Values within a facet are OR'ed, facets are AND'ed. */
const FACETS = /** @type {const} */ (['mine', 'status', 'legal', 'family', 'genus', 'photo', 'french']);
const NONE = /** @type {string[]} */ ([]);

/** @param {string} value */
const normalize = value => String(value ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[œ]/g, 'oe')
  .replace(/[æ]/g, 'ae')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const words = (/** @type {string} */ text) => text.split(' ').filter(Boolean);

/**
 * @typedef {object} Entry
 * @property {any} summary
 * @property {string} sci
 * @property {string[]} sciWords
 * @property {string[]} names
 * @property {string[][]} nameWords
 * @property {string[]} vernacularNames
 * @property {string[]} synonyms
 * @property {string} family
 * @property {string} haystack
 * @property {Record<string, string>} values   facet values
 * @property {{ fr: number, sci: number, family: number }} rank   precomputed sort positions
 */

/** @type {Entry[]} */
let entries = [];
/** Words (≥ 4 letters) → entries containing them, bucketed by first letter for typo matching. */
/** @type {Map<string, Map<string, Set<number>>>} */
let vocabulary = new Map();
/** @type {{ type: 'family' | 'genus', name: string, key: string, count: number }[]} */
let taxa = [];

/** @param {any} plant @returns {Entry} */
function toEntry(plant) {
  const names = (plant.vernacularNames || []).map(normalize);
  const synonyms = (plant.synonyms || []).map(normalize);
  const sci = normalize(plant.scientificName);
  const family = normalize(plant.family);
  return {
    summary: {
      id: plant.id,
      scientificName: plant.scientificName,
      author: plant.author,
      vernacularName: plant.vernacularNames?.[0] || null,
      family: plant.family,
      genus: plant.genus,
      status: plant.status?.france || null,
      thumbnail: plant.thumbnail || null
    },
    sci,
    sciWords: words(sci),
    names,
    nameWords: names.map(words),
    vernacularNames: plant.vernacularNames || [],
    synonyms,
    family,
    haystack: [sci, ...names, ...synonyms, family].join(' | '),
    values: {
      status: plant.status?.france || '',
      family: plant.family,
      genus: plant.genus,
      photo: plant.thumbnail?.url ? 'avec' : 'sans',
      french: plant.vernacularNames?.length ? 'avec' : 'sans',
      legal: legalValues(plant.statuses)
    },
    rank: { fr: 0, sci: 0, family: 0 }
  };
}

function buildIndex(plants) {
  entries = plants.map(toEntry);

  // Sort positions computed once, so sorting results is a cheap integer comparison.
  const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
  const label = (/** @type {Entry} */ e) => e.summary.vernacularName || e.summary.scientificName;
  const assign = (/** @type {'fr' | 'sci' | 'family'} */ key, compare) =>
    entries.slice().sort(compare).forEach((entry, i) => { entry.rank[key] = i; });

  assign('sci', (a, b) => collator.compare(a.summary.scientificName, b.summary.scientificName));
  // Species without a French name go last in the French sort.
  assign('fr', (a, b) =>
    (a.summary.vernacularName ? 0 : 1) - (b.summary.vernacularName ? 0 : 1) || collator.compare(label(a), label(b)));
  assign('family', (a, b) => collator.compare(a.summary.family, b.summary.family) || a.rank.sci - b.rank.sci);

  vocabulary = new Map();
  entries.forEach((entry, i) => {
    for (const word of words(entry.haystack.replace(/\|/g, ' '))) {
      if (word.length < 4) continue;
      let bucket = vocabulary.get(word[0]);
      if (!bucket) vocabulary.set(word[0], bucket = new Map());
      let ids = bucket.get(word);
      if (!ids) bucket.set(word, ids = new Set());
      ids.add(i);
    }
  });

  const counts = { family: new Map(), genus: new Map() };
  for (const entry of entries) {
    counts.family.set(entry.values.family, (counts.family.get(entry.values.family) || 0) + 1);
    counts.genus.set(entry.values.genus, (counts.genus.get(entry.values.genus) || 0) + 1);
  }
  taxa = [
    ...[...counts.family].map(([name, count]) => ({ type: /** @type {const} */ ('family'), name, key: normalize(name), count })),
    ...[...counts.genus].map(([name, count]) => ({ type: /** @type {const} */ ('genus'), name, key: normalize(name), count }))
  ];
}

/**
 * 0 = exact, 1 = prefix, 2 = word prefix, 3 = substring, -1 = no match.
 * @param {string} text @param {string} q
 */
function rank(text, q) {
  if (text === q) return 0;
  if (text.startsWith(q)) return 1;
  if (text.includes(' ' + q)) return 2;
  if (text.includes(q)) return 3;
  return -1;
}

/**
 * Botanist abbreviations: every token starts a word, in order, words may be skipped.
 * "ger rob" → geranium robertianum, "ben vil" → benoite des villes.
 * @param {string[]} textWords @param {string[]} tokens
 */
function sequence(textWords, tokens) {
  let w = 0;
  for (const token of tokens) {
    while (w < textWords.length && !textWords[w].startsWith(token)) w++;
    if (w === textWords.length) return false;
    w++;
  }
  return true;
}

/**
 * @param {Entry} entry @param {string} q @param {string[]} tokens
 * @returns {{ score: number, match?: string } | null}
 */
function score(entry, q, tokens) {
  let best = rank(entry.sci, q);
  let match;

  entry.names.forEach((name, i) => {
    const r = rank(name, q);
    if (r >= 0 && (best < 0 || r < best)) {
      best = r;
      match = i > 0 ? entry.vernacularNames[i] : undefined;
    }
  });
  // A hit on a secondary French name ranks just after hits on the main names.
  if (best >= 0) return { score: match ? best + 0.1 : best, match };

  if (tokens.length > 1) {
    if (sequence(entry.sciWords, tokens)) return { score: 2.5 };
    const i = entry.nameWords.findIndex(nameWords => sequence(nameWords, tokens));
    if (i >= 0) return { score: 2.5, match: i > 0 ? entry.vernacularNames[i] : undefined };
  }

  for (const synonym of entry.synonyms) {
    const r = rank(synonym, q);
    if (r >= 0) return { score: 4 + r, match: 'syn.' };
  }

  const r = rank(entry.family, q);
  if (r >= 0 && r <= 1) return { score: 8 };

  // Multi-word query matching across fields ("rosa canin", "benoite urbanum").
  if (tokens.length > 1 && tokens.every(token => entry.haystack.includes(token))) return { score: 9 };
  return null;
}

/**
 * Optimal string alignment distance (Damerau–Levenshtein with adjacent swaps), bounded.
 * @param {string} a @param {string} b @param {number} max
 */
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  /** @type {number[][]} */
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/**
 * Typo-tolerant pass: each token must match a word exactly (substring) or within
 * 1 typo (≥ 5 letters) / 2 typos (≥ 8 letters). Also matches typed word starts ("pisenl").
 * @param {string[]} tokens
 * @returns {Map<number, number>} entry index → total distance
 */
function fuzzyMatches(tokens) {
  /** @type {Map<number, number> | null} */
  let result = null;

  for (const token of tokens) {
    /** @type {Map<number, number>} */
    const found = new Map();
    const max = token.length >= 8 ? 2 : token.length >= 5 ? 1 : 0;

    if (max === 0) {
      entries.forEach((entry, i) => { if (entry.haystack.includes(token)) found.set(i, 0); });
    } else {
      for (const [word, ids] of vocabulary.get(token[0]) || []) {
        const d = Math.min(
          distance(token, word, max),
          word.length > token.length ? distance(token, word.slice(0, token.length), max) : max + 1
        );
        if (d > max) continue;
        for (const i of ids) found.set(i, Math.min(found.get(i) ?? d, d));
      }
    }

    if (result === null) {
      result = found;
    } else {
      const previous = result;
      result = new Map();
      for (const [i, d] of found) if (previous.has(i)) result.set(i, /** @type {number} */ (previous.get(i)) + d);
    }
    if (!result.size) break;
  }
  return result || new Map();
}

/** Families and genera whose name starts with the query, to offer as one-tap filters. */
function suggest(q, filters) {
  if (q.length < 2 || q.includes(' ')) return [];
  return taxa
    .filter(taxon => taxon.key.startsWith(q) && !filters[taxon.type]?.includes(taxon.name))
    .sort((a, b) => (a.type === 'family' ? 0 : 1) - (b.type === 'family' ? 0 : 1) || b.count - a.count)
    .slice(0, 4)
    .map(({ type, name, count }) => ({ type, name, count }));
}

/**
 * "Protection et menace" facet (INPN statuses; several values per plant): protected nationally, protected
 * somewhere (region or department), harvest regulated somewhere, threatened in France (national Red List).
 * @param {{ type: string }[] | undefined} statuses
 */
function legalValues(statuses) {
  const types = new Set((statuses || []).map(s => s.type));
  const values = [];
  if (types.has('PN')) values.push('nationale');
  if (types.has('PN') || types.has('PR') || types.has('PD')) values.push('protegee');
  if (types.has('REGL')) values.push('reglementee');
  if (types.has('LRN')) values.push('menacee');
  return values;
}

/**
 * Facet values of an entry. Single-valued facets come from the index; "mine" (the user's
 * collections containing the plant) is multi-valued and supplied with each request.
 * @param {Entry} entry @param {string} facet @param {Record<number, string[]>} mine
 * @returns {string | string[]}
 */
const facetValue = (entry, facet, mine) => facet === 'mine' ? (mine[entry.summary.id] || NONE) : entry.values[facet];

/** @param {string | string[]} value @param {Set<string>} set */
const matchesFacet = (value, set) => Array.isArray(value) ? value.some(v => set.has(v)) : set.has(value);

/**
 * @param {{ q: string, filters: Record<string, string[]>, sort: string, membership?: Record<number, string[]> }} params
 */
function search({ q: query, filters, sort, membership: mine = {} }) {
  const q = normalize(query);
  const tokens = words(q);

  /** @type {Map<number, { score: number, match?: string, fuzzy?: boolean }> | null} */
  let matches = null;
  let fuzzy = 0;
  if (q) {
    matches = new Map();
    entries.forEach((entry, i) => {
      const result = score(entry, q, tokens);
      if (result) /** @type {Map<number, any>} */ (matches).set(i, result);
    });
    if (matches.size < 5) {
      const max = tokens[0].length >= 8 ? 2 : 1;
      for (const [i, d] of fuzzyMatches(tokens)) {
        if (matches.has(i)) continue;
        // "pisenlit": species *named* Pissenlit before species merely mentioning it.
        const { sciWords, nameWords } = entries[i];
        const primary = [sciWords[0], nameWords[0]?.[0]].some(word => word && distance(tokens[0], word, max) <= max);
        matches.set(i, { score: 20 + d + (primary ? 0 : 0.5), fuzzy: true });
        fuzzy++;
      }
    }
  }

  // Faceted counts: a value's count is what you'd get by adding it, all *other* facets applied.
  const active = FACETS.filter(f => filters[f]?.length).map(f => /** @type {const} */ ([f, new Set(filters[f])]));
  /** @type {Record<string, Map<string, number>>} */
  const counts = Object.fromEntries(FACETS.map(f => [f, new Map()]));
  const inc = (/** @type {string} */ facet, /** @type {string | string[]} */ value) => {
    for (const v of Array.isArray(value) ? value : [value]) counts[facet].set(v, (counts[facet].get(v) || 0) + 1);
  };

  /** @type {number[]} */
  const hits = [];
  const candidates = matches ? matches.keys() : entries.keys();
  for (const i of candidates) {
    const entry = entries[i];
    let failures = 0;
    let failed = '';
    for (const [facet, set] of active) {
      if (!matchesFacet(facetValue(entry, facet, mine), set)) {
        failed = facet;
        if (++failures > 1) break;
      }
    }
    if (failures === 0) {
      hits.push(i);
      for (const facet of FACETS) inc(facet, facetValue(entry, facet, mine));
    } else if (failures === 1) {
      inc(failed, facetValue(entry, failed, mine));
    }
  }

  const effectiveSort = sort || (q ? 'relevance' : 'fr');
  const by = {
    relevance: (a, b) => /** @type {any} */ (matches).get(a).score - /** @type {any} */ (matches).get(b).score || entries[a].rank.fr - entries[b].rank.fr,
    fr: (a, b) => entries[a].rank.fr - entries[b].rank.fr,
    sci: (a, b) => entries[a].rank.sci - entries[b].rank.sci,
    family: (a, b) => entries[a].rank.family - entries[b].rank.family,
    photo: (a, b) =>
      (entries[a].values.photo === 'avec' ? 0 : 1) - (entries[b].values.photo === 'avec' ? 0 : 1) ||
      entries[a].rank.fr - entries[b].rank.fr
  };
  hits.sort(by[effectiveSort === 'relevance' && !matches ? 'fr' : effectiveSort] || by.fr);

  return {
    total: hits.length,
    items: hits.map(i => {
      const meta = matches?.get(i);
      return meta?.match || meta?.fuzzy ? { ...entries[i].summary, match: meta.match, fuzzy: meta.fuzzy } : entries[i].summary;
    }),
    facets: Object.fromEntries(FACETS.map(f => [f, Object.fromEntries(counts[f])])),
    suggestions: suggest(q, filters),
    fuzzy: hits.some(i => matches?.get(i)?.fuzzy) ? fuzzy : 0,
    sort: effectiveSort
  };
}

self.addEventListener('message', async ({ data }) => {
  const { requestId } = data;
  try {
    if (data.type === 'load') {
      buildIndex(await getAll('plants'));
      const genusFamily = Object.fromEntries(entries.map(e => [e.values.genus, e.values.family]));
      self.postMessage({ requestId, count: entries.length, genusFamily });
    } else if (data.type === 'search') {
      self.postMessage({ requestId, ...search(data) });
    }
  } catch (error) {
    self.postMessage({ requestId, error: /** @type {Error} */ (error).message });
  }
});
