// @ts-check
// Compares data/lookalikes.json (the confusions the app shows) with data/confusions-reference.json (the reference
// list of confusions to show, each with its review status), and the pairs' severity with the TPPT levels of
// data/safety.json. Run by scripts/check-data.mjs (so by tools/check.sh and the dataset build); also on its own:
//   node scripts/check-confusions.mjs    exits 1 with ::error:: lines
// Errors:
//  - a taxon of the reference names no plant of the flora (accepted name, or a genus);
//  - a « publiée » confusion is missing from lookalikes.json (no pair has all its toxic and edible taxa), is less
//    severe there than minSeverity, or does not cite its sources there;
//  - an « à vérifier » confusion is in lookalikes.json: shown to users before a source read confirmed it;
//  - a pair of lookalikes.json is in no « publiée » confusion (the two lists drifted apart);
//  - severity and TPPT (Agroscope): a pair whose toxic plant is at TPPT level 4 (very strong toxic) is never only
//    « toxique »; « grave » is that level (severityFrom « tppt »), and needs it;
//  - a « mortel » or « grave » pair without criteria (tell) or symptoms, unless its reference entry lists the field in
//    `gaps` (not given by the cited sources, to be completed); a gap that is filled is an error too (stale);
//  - a criterion (tell) that names a plant of the file that is not in its pair (by its label, the label's first words or
//    its taxon; case, accents and punctuation aside): copied from another confusion, it describes other plants.
// The « à vérifier » confusions are listed (::notice::), not required.
// Paths: PLANTS_FILE, LOOKALIKES_FILE, SAFETY_FILE, REFERENCE_FILE (defaults: data/…).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Severities, the least grave first (lookalikes.js SEVERITY reads them). */
export const SEVERITY_RANK = { toxique: 0, grave: 1, mortel: 2 };
const STATUSES = ['publiée', 'à vérifier'];
const GAPS = ['tell', 'symptoms'];

/** @param {string} a @param {string[]} list */
const has = (a, list) => list.includes(a);

/** A text as names are looked for in it: lower case, no accents, every run of non-letters one space, a space each end. @param {string} s */
const plain = s => ` ${String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}]+/gu, ' ').trim()} `;

/**
 * The names a pair's plants go by in a criterion: each label, its words before a parenthesis (« Acacia (robinier) »),
 * each taxon — as plain() writes them. @param {any} pair @returns {string[]}
 */
const namesOf = pair => [...(pair.toxic || []), ...(pair.edible || [])]
  .flatMap((/** @type {any} */ t) => [t.label, String(t.label || '').split('(')[0], t.taxon])
  .map(plain).filter(n => n.trim().length > 2);

/**
 * The highest TPPT human toxicity level of a taxon: its plant (accepted name) or, for a genus, any of its plants.
 * @param {string} taxon @param {any[]} plants @param {Record<string, any>} entries
 */
export function tpptLevel(taxon, plants, entries) {
  const of = taxon.includes(' ') ? plants.filter(p => p.scientificName === taxon) : plants.filter(p => p.genus === taxon);
  return Math.max(0, ...of.map(p => entries[p.id]?.tppt?.level ?? 0));
}

/**
 * @param {{ reference: any, lookalikes: any, plants: any[], safety: any }} data
 * @returns {{ errors: string[], pending: string[] }}
 */
export function checkConfusions({ reference, lookalikes, plants, safety }) {
  const errors = [], pending = [];
  const accepted = new Set(plants.map(p => p.scientificName)), genera = new Set(plants.map(p => p.genus));
  const pairs = /** @type {any[]} */ (Array.isArray(lookalikes?.pairs) ? lookalikes.pairs : []);
  const confusions = /** @type {any[]} */ (Array.isArray(reference?.confusions) ? reference.confusions : []);
  const entries = safety?.plants && typeof safety.plants === 'object' ? safety.plants : {};
  if (!confusions.length) errors.push('the reference list has no confusions');
  const taxa = (/** @type {any} */ pair, /** @type {'toxic' | 'edible'} */ side) => (pair[side] || []).map((/** @type {any} */ t) => t.taxon);
  /** The pairs holding every toxic and edible taxon of a reference confusion. @param {any} c */
  const pairsOf = c => pairs.filter(p => c.toxic.every((/** @type {string} */ t) => has(t, taxa(p, 'toxic'))) && c.edible.every((/** @type {string} */ t) => has(t, taxa(p, 'edible'))));
  const covered = new Set();
  const ids = new Set();

  for (const c of confusions) {
    const name = `« ${c.id} » (${(c.toxic || []).join(', ')} ↔ ${(c.edible || []).join(', ')})`;
    if (!c.id || ids.has(c.id)) errors.push(`reference: confusion id « ${c.id} » missing or repeated`);
    ids.add(c.id);
    if (!Array.isArray(c.toxic) || !c.toxic.length || !Array.isArray(c.edible) || !c.edible.length) { errors.push(`reference ${name}: needs toxic and edible taxa`); continue; }
    for (const t of [...c.toxic, ...c.edible]) {
      if (!(t.includes(' ') ? accepted.has(t) : genera.has(t))) errors.push(`reference ${name}: « ${t} » is no accepted name or genus of the flora`);
    }
    if (!STATUSES.includes(c.status)) { errors.push(`reference ${name}: status « ${c.status} » is none of ${STATUSES.join(', ')}`); continue; }
    const found = pairsOf(c);
    if (c.status === 'à vérifier') {
      if (found.length) errors.push(`reference ${name}: still « à vérifier », but shown in lookalikes.json: confirm it from a source read first (status « publiée », with that source)`);
      pending.push(name);
      continue;
    }
    if (!(c.minSeverity in SEVERITY_RANK)) errors.push(`reference ${name}: minSeverity « ${c.minSeverity} » is none of ${Object.keys(SEVERITY_RANK).join(', ')}`);
    if (!Array.isArray(c.sources) || !c.sources.length) errors.push(`reference ${name}: « publiée » cites no source`);
    if (!found.length) { errors.push(`lookalikes.json misses the reference confusion ${name}`); continue; }
    for (const p of found) covered.add(p);
    const pair = found.find(p => (SEVERITY_RANK[/** @type {'mortel'} */ (p.severity)] ?? -1) >= (SEVERITY_RANK[/** @type {'mortel'} */ (c.minSeverity)] ?? 0));
    if (!pair) errors.push(`lookalikes.json: the reference confusion ${name} is « ${found[0].severity} » there, under « ${c.minSeverity} »`);
    for (const s of c.sources || []) if (!found.some(p => p.sources?.includes(s))) errors.push(`lookalikes.json: the reference confusion ${name} does not cite « ${s} » there`);
    // Criteria and symptoms of a deadly or grave confusion: there, or said missing.
    const gaps = Array.isArray(c.gaps) ? c.gaps : [];
    for (const g of gaps) if (!GAPS.includes(g)) errors.push(`reference ${name}: gap « ${g} » is none of ${GAPS.join(', ')}`);
    for (const p of found) {
      if (!(SEVERITY_RANK[/** @type {'mortel'} */ (p.severity)] > 0)) continue;
      const missing = { tell: !p.tell?.length, symptoms: !p.symptoms };
      for (const g of GAPS) {
        if (missing[/** @type {'tell'} */ (g)] && !gaps.includes(g)) errors.push(`lookalikes.json: the ${p.severity} confusion ${name} has no ${g} (add it from a source read, or list « ${g} » in its gaps)`);
        if (!missing[/** @type {'tell'} */ (g)] && gaps.includes(g)) errors.push(`reference ${name}: « ${g} » is listed in gaps, but lookalikes.json has it now: remove the gap`);
      }
    }
  }

  /** Every plant name of the file (plain()). */
  const names = new Set(pairs.flatMap(namesOf));
  pairs.forEach((p, i) => {
    const name = `pair ${i + 1} (${taxa(p, 'toxic').join(', ')} ↔ ${taxa(p, 'edible').join(', ')})`;
    if (!covered.has(p)) errors.push(`lookalikes.json ${name} is in no « publiée » confusion of the reference list`);
    // A criterion names only plants of its pair.
    const own = new Set(namesOf(p));
    for (const t of Array.isArray(p.tell) ? p.tell : []) {
      const text = plain(t);
      const foreign = [...names].filter(n => !own.has(n) && text.includes(n));
      if (foreign.length) errors.push(`lookalikes.json ${name}: its criterion « ${t} » names ${foreign.map(n => `« ${n.trim()} »`).join(', ')}, not a plant of this pair (copied from another confusion?)`);
    }
    // Severity and TPPT.
    const level = Math.max(0, ...taxa(p, 'toxic').map((/** @type {string} */ t) => tpptLevel(t, plants, entries)));
    if (level >= 4 && p.severity === 'toxique') errors.push(`lookalikes.json ${name}: « toxique », but its toxic plant is at TPPT level 4 (très fortement toxique): « grave » (severityFrom « tppt ») or « mortel »`);
    if (p.severity === 'grave' && (p.severityFrom !== 'tppt' || level < 4)) errors.push(`lookalikes.json ${name}: « grave » is TPPT level 4 (severityFrom « tppt »), here level ${level}${p.severityFrom ? '' : ', no severityFrom'}`);
    if (p.severityFrom && p.severity !== 'grave') errors.push(`lookalikes.json ${name}: severityFrom « ${p.severityFrom} » with severity « ${p.severity} »`);
  });
  return { errors, pending };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const read = (/** @type {string} */ file) => JSON.parse(readFileSync(file, 'utf8'));
  const REFERENCE_FILE = process.env.REFERENCE_FILE || 'data/confusions-reference.json';
  const { errors, pending } = checkConfusions({
    reference: read(REFERENCE_FILE),
    lookalikes: read(process.env.LOOKALIKES_FILE || 'data/lookalikes.json'),
    plants: read(process.env.PLANTS_FILE || 'data/plants.json'),
    safety: read(process.env.SAFETY_FILE || 'data/safety.json')
  });
  for (const e of errors) console.log(`::error file=${REFERENCE_FILE}::${e}`);
  console.log(`check-confusions: ${errors.length} error${errors.length === 1 ? '' : 's'}; ${pending.length} confusion${pending.length === 1 ? '' : 's'} à vérifier.`);
  if (errors.length) process.exitCode = 1;
}
