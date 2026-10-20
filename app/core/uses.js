// @ts-check
// Uses of a plant, from sourced open data only, safety first:
//  - data/safety.json (built in CI): ANSM Pharmacopée française liste A (traditional medicinal use, part used)
//    and liste B (adverse effects greater than the benefit), Agroscope TPPT (toxic plants of Central Europe,
//    toxic parts) — bundled and precached, so the warnings work offline;
//  - Wikidata (live, CC0): uses (P366), products of the plant and the part they come from (P1672 / P1582,
//    P518), dishes made of them, PFAF identifier (P4301, link only);
//  - Wikibooks (live, CC BY-SA): recipes in French and English.
// Nothing here says a plant is edible: each line is a claim with its source.

import { bundledJSON } from './bundled.js';
import * as cache from './cache.js';
import { ModuleOffError, moduleOn } from './modules.js';
import { fetchJson } from './net.js';
import { wikimediaHeaders } from '../../lib/plant-sources.mjs';

/** @typedef {import('./modules.js').Mode} Mode */

const DAY = 24 * 3600 * 1000;

/**
 * The safety file (sources and per-plant entries). Rejects when it cannot be read (an HTTP error, a broken or empty
 * file), and is asked again next time: an error is not « no data » — the sheet says the data is unavailable.
 * @returns {Promise<any>}
 */
export function safetyData() {
  return bundledJSON('safety.json', { check: d => d?.plants && typeof d.plants === 'object' && Object.keys(d.plants).length ? null : 'no plants' });
}

/**
 * What the safety file says about a plant: ANSM list (A or B, part, French name) and TPPT toxicity; null when the
 * file has nothing on it, a rejection when the file cannot be read.
 * @param {any} plant @returns {Promise<{ ansm?: any, tppt?: any, sources: Record<string, any> } | null>}
 */
export async function safetyOf(plant) {
  const data = await safetyData();
  const entry = data.plants?.[plant.id];
  return entry ? { ...entry, sources: data.sources || {} } : null;
}

/**
 * Wikibooks' API is told who asks (Api-User-Agent, lib/plant-sources.mjs); the query service is not.
 * @param {string} url @param {AbortSignal} [signal] @param {Record<string, string>} [headers] @param {(data: any) => boolean} [expect]
 */
const json = (url, signal, headers = {}, expect) => fetchJson(url, { signal, headers: { ...wikimediaHeaders(url), ...headers }, expect });

/** Cached for `ttl` (core/cache.js: a failure is never stored). @template T @param {string} key @param {number} ttl @param {() => Promise<T>} load @returns {Promise<T>} */
const cached = (key, ttl, load) => cache.cached(key, load, { ttl });

/** Kinds of uses (Wikidata P366 values), to group them. */
const FOOD = /nourriture|légume|fruit|épice|condiment|aliment|boisson|brassage|salade|infusion|tisane|aromat|food|vegetable|spice|edible|beverage|herb/i;
const MEDICINE = /médic|pharma|medic|remède/i;

/** @param {string} label @returns {'food' | 'medicine' | 'other'} */
export const useKind = label => FOOD.test(label) ? 'food' : MEDICINE.test(label) ? 'medicine' : 'other';

/**
 * @typedef {{ uses: { id: string, label: string, kind: string }[], products: { id: string, label: string, parts: string[] }[],
 *   dishes: { id: string, label: string, url: string | null }[], pfaf: string | null, qid: string }} WikidataUses
 */

/**
 * Uses, products (with the part they come from) and dishes of a plant on Wikidata.
 * @param {string} qid @param {AbortSignal} [signal] @param {Mode} [mode] @returns {Promise<WikidataUses>}
 */
export async function wikidataUses(qid, signal, mode) {
  if (!moduleOn('wikidata', mode)) throw new ModuleOffError('wikidata');
  return cached('wd-uses:' + qid, 14 * DAY, async () => {
    const q = `SELECT ?kind ?val ?valLabel ?partLabel ?site WHERE {
      VALUES ?taxon { wd:${qid} }
      { ?taxon wdt:P366 ?val . BIND("use" AS ?kind) }
      UNION { { ?taxon p:P1672 ?st . ?st ps:P1672 ?val . OPTIONAL { ?st pq:P518 ?part } }
              UNION { ?val wdt:P1582 ?taxon . OPTIONAL { ?val wdt:P518 ?part } } BIND("product" AS ?kind) }
      UNION { { ?val wdt:P527|wdt:P186|wdt:P4330 ?taxon } UNION { ?p wdt:P1582 ?taxon . ?val wdt:P527|wdt:P186|wdt:P4330 ?p . }
              ?val wdt:P31/wdt:P279* wd:Q746549 . BIND("dish" AS ?kind)
              OPTIONAL { ?site schema:about ?val ; schema:isPartOf <https://fr.wikipedia.org/> } }
      UNION { ?taxon wdt:P4301 ?val . BIND("pfaf" AS ?kind) }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". } }`;
    const data = await json('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), signal, { accept: 'application/sparql-results+json' }, d => Array.isArray(d.results?.bindings));
    /** @type {WikidataUses} */
    const out = { uses: [], products: [], dishes: [], pfaf: null, qid };
    const id = (/** @type {string} */ uri) => uri.split('/').pop() || uri;
    // A label that is still a Q-id has no French or English name: left out.
    const named = (/** @type {string} */ label) => label && !/^Q\d+$/.test(label);
    for (const b of data.results?.bindings || []) {
      const kind = b.kind?.value, val = b.val?.value, label = b.valLabel?.value || '';
      if (kind === 'pfaf') { out.pfaf = val; continue; }
      if (!named(label)) continue;
      if (kind === 'use' && !out.uses.some(u => u.id === id(val))) out.uses.push({ id: id(val), label, kind: useKind(label) });
      if (kind === 'product') {
        let p = out.products.find(x => x.id === id(val));
        if (!p) out.products.push(p = { id: id(val), label, parts: [] });
        const part = b.partLabel?.value;
        if (part && named(part) && !p.parts.includes(part)) p.parts.push(part);
      }
      if (kind === 'dish' && !out.dishes.some(d => d.id === id(val))) out.dishes.push({ id: id(val), label, url: b.site?.value || null });
    }
    return out;
  });
}

/**
 * Recipes on Wikibooks: the French wiki (recipes of villages, cookbook) and the English Cookbook.
 * @param {{ french: string | null, latin: string, english?: string | null }} names @param {AbortSignal} [signal]
 * @returns {Promise<{ title: string, url: string, lang: string }[]>}
 */
export async function recipes(names, signal) {
  if (!moduleOn('wikibooks')) throw new ModuleOffError('wikibooks');
  // 'wikibooks2': 'wikibooks' kept a failed search as « no recipe » for a month (audit STO-9).
  const key = 'wikibooks2:' + [names.french, names.latin, names.english].filter(Boolean).join('|');
  return cached(key, 30 * DAY, async () => {
    const search = (/** @type {string} */ host, /** @type {string} */ q, /** @type {number} */ ns) => json(`https://${host}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srnamespace=${ns}&srlimit=5&format=json&origin=*`, signal, {}, d => Array.isArray(d.query?.search))
      .then(d => d.query.search.map((/** @type {any} */ r) => ({ title: r.title, url: `https://${host}/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`, lang: host.slice(0, 2) })));
    // A failed search is thrown (never cached as « no recipe », audit STO-9).
    const fr = names.french ? await search('fr.wikibooks.org', `"${names.french}" recette`, 0) : [];
    const en = await search('en.wikibooks.org', names.english || names.latin, 102);
    // Recipes only (French: the cookbook and the « Recettes » books; English: the Cookbook namespace).
    return [...fr.filter((/** @type {any} */ r) => /recette|cuisine|livre de cuisine/i.test(r.title)), ...en].slice(0, 6);
  });
}
