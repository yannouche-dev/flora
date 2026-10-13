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
//  - data/meta.json carries the fingerprint of plants.json (sha256, scripts/fingerprint-dataset.mjs) and its count of
//    plants: the app compares the fingerprint to know whether to download the flora, and checks the download with it;
//  - counts stay above floors (about 90 % of what the sources gave on 2026-10-12): a source that failed upstream,
//    or a format change read as nothing, shows as a drop under them;
//  - counts drop by no more than MAX_DROP (default 5 %) from the dataset as last committed (git HEAD, or
//    DATA_BASELINE / PREVIOUS_DATA_DIR: scripts/previous-data.mjs): a source that lost part of its content passes
//    the floors but not this. A deliberate drop is let through by a manual run with a larger MAX_DROP;
//  - a source kept from a previous build (its download failed) is a ::warning::, more than STALE_DAYS (30) days
//    after it was last read.
// Paths: PLANTS_FILE, LOOKALIKES_FILE, SAFETY_FILE, META_FILE (defaults: data/…), like the build scripts.

import { readFileSync } from 'node:fs';
import { baselineName, previousJson } from './previous-data.mjs';
import { fingerprint } from './fingerprint-dataset.mjs';
import { checkConfusions } from './check-confusions.mjs';
import { PARTS_WORDS, TOXICITY_LABELS } from './build-safety.mjs';

const PLANTS_FILE = process.env.PLANTS_FILE || 'data/plants.json';
const LOOKALIKES_FILE = process.env.LOOKALIKES_FILE || 'data/lookalikes.json';
const SAFETY_FILE = process.env.SAFETY_FILE || 'data/safety.json';
const META_FILE = process.env.META_FILE || 'data/meta.json';
/** A share (0.05 = 5 %); anything else read as the default, never as « no limit ». */
const MAX_DROP = /^(0?\.\d+|1(\.0*)?)$/.test(process.env.MAX_DROP || '') ? Number(process.env.MAX_DROP) : 0.05;
const STALE_DAYS = 30;

/** Floors, measured 2026-10-12: 977 plants in safety.json, 184 on ANSM list A, 400 on list B, 635 in TPPT; 2117 protected (PN, PR, PD) and 1125 regulated (REGL) plants; 3879 with Baseflor flowering months. */
const FLOORS = { safety: 880, ansmA: 165, ansmB: 360, tppt: 570, protected: 1900, regulated: 1010, flowering: 3500 };
const SAFETY_SOURCES = ['ansmA', 'ansmB', 'tppt'];
const SEVERITIES = ['mortel', 'grave', 'toxique'];
const REFERENCE_FILE = process.env.REFERENCE_FILE || 'data/confusions-reference.json';

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

/**
 * What the checks count, for this build and for the previous one.
 * @param {any[]} plants @param {any} safety @param {any} lookalikes
 * @returns {Record<string, number>}
 */
function measure(plants, safety, lookalikes) {
  const entries = Object.values(safety?.plants && typeof safety.plants === 'object' ? safety.plants : {});
  return {
    plants: plants.length,
    protected: plants.filter(p => p.statuses?.some(s => /^P[NRD]$/.test(s.type))).length,
    regulated: plants.filter(p => p.statuses?.some(s => s.type === 'REGL')).length,
    flowering: plants.filter(p => p.flowering).length,
    thumbnails: plants.filter(p => p.thumbnail?.url).length,
    safety: entries.length,
    ansmA: entries.filter(v => v?.ansm?.some(e => e.list === 'A')).length,
    ansmB: entries.filter(v => v?.ansm?.some(e => e.list === 'B')).length,
    tppt: entries.filter(v => v?.tppt).length,
    pairs: Array.isArray(lookalikes?.pairs) ? lookalikes.pairs.length : 0
  };
}

/**
 * A ::warning:: for a source last read more than STALE_DAYS ago (kept from a previous build since its download failed).
 * @param {string} file @param {string} key @param {string} [read] ISO date or timestamp
 */
function stale(file, key, read) {
  const days = read ? (Date.now() - Date.parse(read)) / 864e5 : NaN;
  if (days > STALE_DAYS) console.log(`::warning file=${file}::${file}: ${key} last read ${String(read).slice(0, 10)}, ${Math.floor(days)} days ago: its download keeps failing`);
}

const plantsFile = load(PLANTS_FILE), lookFile = load(LOOKALIKES_FILE), safetyFile = load(SAFETY_FILE);
/** @type {any[]} */
const plants = Array.isArray(plantsFile?.data) ? plantsFile.data : [];
if (plantsFile && !plants.length) error(PLANTS_FILE, 'is no list of plants');

const summary = [];

// ── Fingerprint of the flora ──
const metaFile = load(META_FILE);
if (plantsFile && metaFile) {
  const { sha256, plants: count } = metaFile.data || {};
  const actual = fingerprint(readFileSync(PLANTS_FILE));
  if (!sha256) error(META_FILE, `has no sha256: installed apps would download the flora on every build (run scripts/fingerprint-dataset.mjs)`);
  else if (sha256 !== actual) error(META_FILE, `sha256 ${sha256} is not that of ${PLANTS_FILE} (${actual}): installed apps would refuse the download (run scripts/fingerprint-dataset.mjs)`);
  if (count !== plants.length) error(META_FILE, `plants: ${count}, but ${PLANTS_FILE} has ${plants.length}`);
  if (sha256 === actual) summary.push(`${META_FILE}: sha256 ${actual.slice(0, 12)}…`);
}

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

  // ── Reference list of confusions, severity and TPPT (scripts/check-confusions.mjs) ──
  const referenceFile = load(REFERENCE_FILE);
  if (referenceFile && lookFile) {
    const { errors: wrong, pending } = checkConfusions({ reference: referenceFile.data, lookalikes: lookFile.data, plants, safety: safetyFile?.data });
    for (const e of wrong) error(/^lookalikes\.json/.test(e) ? LOOKALIKES_FILE : REFERENCE_FILE, e);
    if (pending.length) console.log(`::notice file=${REFERENCE_FILE}::${pending.length} confusions à vérifier against a source (not shown in the app): ${pending.join(' ; ')}`);
    summary.push(`${REFERENCE_FILE}: ${referenceFile.data?.confusions?.length ?? 0} confusions, ${pending.length} à vérifier`);
  }

  // ── Toxicity and medicinal use ──
  if (safetyFile) {
    const { data } = safetyFile;
    const entries = data?.plants && typeof data.plants === 'object' ? data.plants : {};
    const ids = new Set(plants.map(p => String(p.id)));
    for (const key of SAFETY_SOURCES) if (!data?.sources?.[key]) error(SAFETY_FILE, `source « ${key} » is missing: its warnings would be gone from the app`);
    const unknown = Object.keys(entries).filter(id => !ids.has(id));
    if (unknown.length) error(SAFETY_FILE, `${unknown.length} ids are no plant of ${PLANTS_FILE}: ${unknown.slice(0, 10).join(', ')}${unknown.length > 10 ? '…' : ''}`);
    const count = measure([], data, null);
    for (const key of ['safety', ...SAFETY_SOURCES]) if (count[key] < FLOORS[key]) error(SAFETY_FILE, `${key === 'safety' ? 'plants with an entry' : key + ' entries'}: ${count[key]}, under the floor of ${FLOORS[key]}`);
    for (const key of SAFETY_SOURCES) stale(SAFETY_FILE, key, data?.sources?.[key]?.read);
    // TPPT in French: every label one build-safety.mjs writes, every word of the parts one of its translations.
    const english = new Map();
    for (const [id, entry] of Object.entries(entries)) {
      const t = /** @type {any} */ (entry)?.tppt;
      if (!t) continue;
      for (const label of [t.levelLabel, t.animal]) if (label && !label.split(', ').every((/** @type {string} */ l) => TOXICITY_LABELS.includes(l))) english.set(`level « ${label} »`, id);
      const odd = String(t.parts || '').toLowerCase().split(/[^\p{L}]+/u).filter(w => w && !PARTS_WORDS.has(w));
      if (odd.length) english.set(`parts « ${t.parts} » (${odd.join(', ')})`, id);
    }
    for (const [what, id] of english) error(SAFETY_FILE, `TPPT ${what} of plant ${id} is not translated (scripts/build-safety.mjs: toxicity, PARTS)`);
    summary.push(`${SAFETY_FILE}: ${count.safety} plants (ANSM A ${count.ansmA}, ANSM B ${count.ansmB}, TPPT ${count.tppt})`);
  }

  // ── Protection and harvest regulation ──
  const now = measure(plants, safetyFile?.data, lookFile?.data);
  if (now.protected < FLOORS.protected) error(PLANTS_FILE, `protected plants (PN, PR, PD): ${now.protected}, under the floor of ${FLOORS.protected}`);
  if (now.regulated < FLOORS.regulated) error(PLANTS_FILE, `regulated plants (REGL): ${now.regulated}, under the floor of ${FLOORS.regulated}`);
  if (now.flowering < FLOORS.flowering) error(PLANTS_FILE, `plants with flowering months (Baseflor): ${now.flowering}, under the floor of ${FLOORS.flowering}`);
  summary.push(`${PLANTS_FILE}: ${now.plants} plants, ${now.protected} protected, ${now.regulated} regulated, ${now.flowering} with flowering months, ${now.thumbnails} thumbnails`);

  // ── Sources kept from a previous build ──
  const meta = load(META_FILE)?.data;
  stale(META_FILE, 'bdcStatuts', meta?.sources?.bdcStatuts?.fetchedAt);
  stale(META_FILE, 'baseflor', meta?.sources?.baseflor?.fetchedAt);

  // ── Against the dataset as last committed ──
  const before = previousJson('data/plants.json');
  if (Array.isArray(before) && before.length) {
    const then = measure(before, previousJson('data/safety.json'), previousJson('data/lookalikes.json'));
    /** Where each count is read, for the annotation. @type {Record<string, string>} */
    const fileOf = { safety: SAFETY_FILE, ansmA: SAFETY_FILE, ansmB: SAFETY_FILE, tppt: SAFETY_FILE, pairs: LOOKALIKES_FILE };
    const drops = [];
    for (const [key, was] of Object.entries(then)) {
      if (!was) continue;
      const lost = (was - now[key]) / was;
      if (lost > MAX_DROP) error(fileOf[key] || PLANTS_FILE, `${key}: ${now[key]}, down ${Math.round(lost * 100)} % from ${was} in ${baselineName()} (at most ${Math.round(MAX_DROP * 100)} %: a source lost part of its content; a deliberate drop needs a manual run with a larger MAX_DROP)`);
      if (now[key] !== was) drops.push(`${key} ${was} → ${now[key]}`);
    }
    summary.push(`against ${baselineName()}: ${drops.join(', ') || 'same counts'}`);
  } else summary.push(`no previous dataset to compare with (${baselineName()})`);
}

console.log(`check-data: ${summary.join('; ') || 'nothing checked'}.`);
if (errors) {
  console.log(`check-data: ${errors} error${errors > 1 ? 's' : ''}.`);
  process.exitCode = 1;
}
