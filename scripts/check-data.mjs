// Checks the safety data before it ships: the look-alike pairs, the toxicity file and the protection statuses are
// what the app warns with, offline, where the picking happens, and nothing else reads them before a user does.
// Run by tools/check.sh (pull requests, deploys) and by the dataset build before its commit (build-dataset.yml),
// so a typo in a pair or a source that failed upstream is never committed or deployed without a sound.
//   node scripts/check-data.mjs    exits 1 with ::error:: lines (GitHub annotations, also readable as file:line)
// Checks:
//  - data/plants.json, data/lookalikes.json and data/safety.json parse;
//  - every taxon of a pair names the flora by its accepted name, as written there (a genus: at least one plant of
//    it). A name the flora only knows as a synonym is an error too: installed apps that compare accepted names
//    only (before lookalikes.js read synonyms) would show no warning at all, and one name per plant keeps the
//    file unambiguous (354 synonyms are another plant's accepted name). Severity is one the app reads, sources
//    are cited ones;
//  - every id of safety.json is a plant of the flora, and its three sources (ANSM lists A and B, TPPT) are there;
//  - counts stay above floors (about 90 % of what the sources gave on 2026-10-12): a source that failed upstream,
//    or a format change read as nothing, shows as a drop under them.
// Paths: PLANTS_FILE, LOOKALIKES_FILE, SAFETY_FILE (defaults: data/…), like the build scripts.

import { readFileSync } from 'node:fs';

const PLANTS_FILE = process.env.PLANTS_FILE || 'data/plants.json';
const LOOKALIKES_FILE = process.env.LOOKALIKES_FILE || 'data/lookalikes.json';
const SAFETY_FILE = process.env.SAFETY_FILE || 'data/safety.json';

/** Floors, measured 2026-10-12: 977 plants in safety.json, 184 on ANSM list A, 400 on list B, 635 in TPPT; 2117 protected (PN, PR, PD) and 1125 regulated (REGL) plants. */
const FLOORS = { safety: 880, ansmA: 165, ansmB: 360, tppt: 570, protected: 1900, regulated: 1010 };
const SAFETY_SOURCES = ['ansmA', 'ansmB', 'tppt'];
const SEVERITIES = ['mortel', 'toxique'];

let errors = 0;
/** @param {string} file @param {string} message @param {number} [line] */
const error = (file, message, line) => {
  errors++;
  console.log(`::error file=${file}${line ? ',line=' + line : ''}::${file}${line ? ':' + line : ''}: ${message}`);
};

/** A JSON file, or null (with an error) when it cannot be read or parsed. @param {string} file */
function load(file) {
  try {
    const text = readFileSync(file, 'utf8');
    return { text, data: JSON.parse(text) };
  } catch (e) {
    error(file, `cannot be read as JSON: ${e.message}`);
    return null;
  }
}

/** Line of the first occurrence of a JSON string value in a file's text (for the annotation), else undefined. @param {string} text @param {string} value */
const lineOf = (text, value) => {
  const at = text.indexOf(JSON.stringify(value));
  return at < 0 ? undefined : text.slice(0, at).split('\n').length;
};

const plantsFile = load(PLANTS_FILE), lookFile = load(LOOKALIKES_FILE), safetyFile = load(SAFETY_FILE);
/** @type {any[]} */
const plants = Array.isArray(plantsFile?.data) ? plantsFile.data : [];
if (plantsFile && !plants.length) error(PLANTS_FILE, 'is no list of plants');

const summary = [];

if (plants.length) {
  const accepted = new Map(plants.map(p => [p.scientificName, p]));
  const genera = new Set(plants.map(p => p.genus));
  // Names folded (case, spaces) to say what was meant: another case, or a synonym.
  const fold = (/** @type {string} */ s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const byFolded = new Map(plants.map(p => [fold(p.scientificName), p]));
  /** @type {Map<string, any[]>} */
  const bySynonym = new Map();
  for (const p of plants) for (const s of p.synonyms || []) bySynonym.set(fold(s), [...(bySynonym.get(fold(s)) || []), p]);

  // ── Look-alike pairs ──
  if (lookFile) {
    const { text, data } = lookFile;
    const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
    if (!pairs.length) error(LOOKALIKES_FILE, 'has no pairs');
    const cited = data?.sources && typeof data.sources === 'object' ? data.sources : {};
    let taxa = 0;
    pairs.forEach((pair, i) => {
      const where = `pair ${i + 1}`;
      for (const side of ['toxic', 'edible']) {
        if (!Array.isArray(pair[side]) || !pair[side].length) { error(LOOKALIKES_FILE, `${where}: no ${side} taxon`); continue; }
        for (const t of pair[side]) {
          taxa++;
          const name = t?.taxon, line = lineOf(text, name);
          if (typeof name !== 'string' || !name.trim()) { error(LOOKALIKES_FILE, `${where}: a ${side} taxon has no name`); continue; }
          if (!t.label) error(LOOKALIKES_FILE, `${where}: « ${name} » has no label`, line);
          if (!name.includes(' ')) {
            if (!genera.has(name)) error(LOOKALIKES_FILE, `${where}: genus « ${name} » has no plant in ${PLANTS_FILE}`, line);
            continue;
          }
          if (accepted.has(name)) continue;
          const near = byFolded.get(fold(name));
          const owners = bySynonym.get(fold(name)) || [];
          if (near) error(LOOKALIKES_FILE, `${where}: « ${name} » is written « ${near.scientificName} » in ${PLANTS_FILE} (id ${near.id}): the app compares names exactly`, line);
          else if (owners.length) error(LOOKALIKES_FILE, `${where}: « ${name} » is only a synonym of ${owners.map(p => `« ${p.scientificName} » (id ${p.id})`).join(', ')}: write the accepted name, the one every version of the app finds`, line);
          else error(LOOKALIKES_FILE, `${where}: « ${name} » is no plant of ${PLANTS_FILE}, neither accepted name nor synonym`, line);
        }
      }
      if (!SEVERITIES.includes(pair.severity)) error(LOOKALIKES_FILE, `${where}: severity « ${pair.severity} » is none of ${SEVERITIES.join(', ')}`);
      if (!Array.isArray(pair.sources) || !pair.sources.length) error(LOOKALIKES_FILE, `${where}: cites no source`);
      else for (const id of pair.sources) if (!cited[id]) error(LOOKALIKES_FILE, `${where}: source « ${id} » is not in sources`, lineOf(text, id));
    });
    summary.push(`${LOOKALIKES_FILE}: ${pairs.length} pairs, ${taxa} taxa`);
  }

  // ── Toxicity and medicinal use ──
  if (safetyFile) {
    const { data } = safetyFile;
    const entries = data?.plants && typeof data.plants === 'object' ? data.plants : {};
    const ids = new Set(plants.map(p => String(p.id)));
    for (const key of SAFETY_SOURCES) if (!data?.sources?.[key]) error(SAFETY_FILE, `source « ${key} » is missing: its warnings would be gone from the app`);
    const unknown = Object.keys(entries).filter(id => !ids.has(id));
    if (unknown.length) error(SAFETY_FILE, `${unknown.length} ids are no plant of ${PLANTS_FILE}: ${unknown.slice(0, 10).join(', ')}${unknown.length > 10 ? '…' : ''}`);
    const values = Object.values(entries);
    const count = {
      safety: values.length,
      ansmA: values.filter(v => v?.ansm?.some(e => e.list === 'A')).length,
      ansmB: values.filter(v => v?.ansm?.some(e => e.list === 'B')).length,
      tppt: values.filter(v => v?.tppt).length
    };
    for (const [key, n] of Object.entries(count)) if (n < FLOORS[key]) error(SAFETY_FILE, `${key === 'safety' ? 'plants with an entry' : key + ' entries'}: ${n}, under the floor of ${FLOORS[key]}`);
    summary.push(`${SAFETY_FILE}: ${count.safety} plants (ANSM A ${count.ansmA}, ANSM B ${count.ansmB}, TPPT ${count.tppt})`);
  }

  // ── Protection and harvest regulation ──
  const protectedN = plants.filter(p => p.statuses?.some(s => /^P[NRD]$/.test(s.type))).length;
  const regulatedN = plants.filter(p => p.statuses?.some(s => s.type === 'REGL')).length;
  if (protectedN < FLOORS.protected) error(PLANTS_FILE, `protected plants (PN, PR, PD): ${protectedN}, under the floor of ${FLOORS.protected}`);
  if (regulatedN < FLOORS.regulated) error(PLANTS_FILE, `regulated plants (REGL): ${regulatedN}, under the floor of ${FLOORS.regulated}`);
  summary.push(`${PLANTS_FILE}: ${plants.length} plants, ${protectedN} protected, ${regulatedN} regulated`);
}

console.log(`check-data: ${summary.join('; ') || 'nothing checked'}.`);
if (errors) {
  console.log(`check-data: ${errors} error${errors > 1 ? 's' : ''}.`);
  process.exitCode = 1;
}
