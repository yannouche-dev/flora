// @ts-check
// Plantes à confondre: edible plants and the toxic plants they are mistaken for, as listed by the Anses and
// the Centres antipoison (data/lookalikes.json — sources, distinguishing criteria and symptoms quoted from them).
// Bundled with the app (precached): the warning must work offline, where the picking happens.

import * as db from './db.js';

/**
 * @typedef {{ taxon: string, label: string }} Taxon   One word: the whole genus (« Digitalis sp. »).
 * @typedef {{ title: string, publisher: string, date: string, url: string }} Source
 * @typedef {{ toxic: Taxon[], edible: Taxon[], part: string, severity: 'mortel' | 'toxique', tell: string[],
 *   symptoms?: string, sources: string[] }} Pair
 * @typedef {{ side: 'edible' | 'toxic', pair: Pair, others: (Taxon & { id: number | null })[], sources: Source[] }} Lookalike
 */

/** @type {Promise<{ sources: Record<string, Source>, pairs: Pair[] }> | null} */
let loading = null;

export function lookalikeData() {
  loading ??= fetch(new URL('../../data/lookalikes.json', import.meta.url)).then(r => {
    if (!r.ok) throw new Error('lookalikes ' + r.status);
    return r.json();
  }).catch(error => { loading = null; throw error; });
  return loading;
}

/** @param {Taxon} taxon @param {any} plant */
const matches = (taxon, plant) => taxon.taxon.includes(' ') ? plant.scientificName === taxon.taxon : plant.genus === taxon.taxon;

/** A species of the flora by its name, for a link to its sheet (null for a genus or a plant not in the flora). @param {string} name */
async function plantId(name) {
  const [genus, ...rest] = name.split(' ');
  if (!rest.length) return null;
  const rows = await db.getAllByIndex('plants', 'by_taxon', [genus, rest.join(' ')]).catch(() => []);
  return rows.find(row => row.scientificName === name)?.id ?? null;
}

/**
 * The confusions a plant is part of, on either side, the most dangerous first.
 * @param {any} plant @returns {Promise<Lookalike[]>}
 */
export async function lookalikesOf(plant) {
  if (!plant?.genus) return [];
  const { sources, pairs } = await lookalikeData();
  /** @type {Lookalike[]} */
  const found = [];
  for (const pair of pairs) {
    const side = pair.edible.some(t => matches(t, plant)) ? 'edible' : pair.toxic.some(t => matches(t, plant)) ? 'toxic' : null;
    if (!side) continue;
    const others = await Promise.all((side === 'edible' ? pair.toxic : pair.edible).map(async t => ({ ...t, id: await plantId(t.taxon) })));
    found.push({ side, pair, others, sources: pair.sources.map(id => sources[id]).filter(Boolean) });
  }
  return found.sort((a, b) => Number(b.pair.severity === 'mortel') - Number(a.pair.severity === 'mortel'));
}

/**
 * One line for the harvest toasts: what this plant can be mistaken for (or that it is the toxic one).
 * @param {any} plant @returns {Promise<string | null>}
 */
export async function lookalikeWarning(plant) {
  const list = await lookalikesOf(plant).catch(() => []);
  const edible = list.filter(l => l.side === 'edible');
  if (edible.length) {
    const names = edible.flatMap(l => l.others.map(o => o.label + (l.pair.severity === 'mortel' ? ' (mortel)' : '')));
    return '⚠ Ne pas confondre avec : ' + [...new Set(names)].join(', ');
  }
  const toxic = list.find(l => l.side === 'toxic');
  return toxic ? `☠ Plante ${toxic.pair.severity === 'mortel' ? 'mortelle' : 'toxique'}, confondue avec : ${toxic.others.map(o => o.label).join(', ')}` : null;
}
