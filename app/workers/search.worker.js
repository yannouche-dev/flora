// @ts-check
// Accent-insensitive search over the local flora, off the main thread.
// ~7.7k species: a ranked linear scan answers in a few milliseconds, no library needed.

import { getAll } from '../core/db.js';

/** @param {string} value */
const normalize = value => String(value ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[œ]/g, 'oe')
  .replace(/[æ]/g, 'ae')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

/**
 * @typedef {object} Entry
 * @property {any} summary
 * @property {string} sci
 * @property {string[]} names
 * @property {string[]} vernacularNames
 * @property {string[]} synonyms
 * @property {string} family
 * @property {string} haystack
 */

/** @type {Entry[]} */
let entries = [];

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
      status: plant.status?.france || null,
      thumbnail: plant.thumbnail || null,
      wikidata: plant.identifiers?.wikidata || null
    },
    sci,
    names,
    vernacularNames: plant.vernacularNames || [],
    synonyms,
    family,
    haystack: [sci, ...names, ...synonyms, family].join(' | ')
  };
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
  if (best >= 0) return { score: best, match };

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

/** @param {{ query: string, family: string, statuses: string[] }} params */
function search({ query, family, statuses }) {
  const q = normalize(query);
  const tokens = q.split(' ').filter(Boolean);
  const statusSet = new Set(statuses);

  /** @type {{ entry: Entry, score: number, match?: string }[]} */
  const hits = [];
  for (const entry of entries) {
    if (family && entry.summary.family !== family) continue;
    if (statusSet.size && !statusSet.has(entry.summary.status)) continue;
    if (!q) { hits.push({ entry, score: 0 }); continue; }
    const result = score(entry, q, tokens);
    if (result) hits.push({ entry, ...result });
  }

  hits.sort((a, b) => a.score - b.score || a.entry.sci.localeCompare(b.entry.sci));
  return {
    total: hits.length,
    items: hits.map(({ entry, match }) => match ? { ...entry.summary, match } : entry.summary)
  };
}

self.addEventListener('message', async ({ data }) => {
  const { requestId } = data;
  try {
    if (data.type === 'load') {
      const plants = await getAll('plants');
      entries = plants.map(toEntry);

      const counts = new Map();
      for (const plant of plants) counts.set(plant.family, (counts.get(plant.family) || 0) + 1);
      const families = [...counts]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => a.name.localeCompare(b.name));

      self.postMessage({ requestId, count: entries.length, families });
    } else if (data.type === 'search') {
      self.postMessage({ requestId, ...search(data) });
    }
  } catch (error) {
    self.postMessage({ requestId, error: /** @type {Error} */ (error).message });
  }
});
