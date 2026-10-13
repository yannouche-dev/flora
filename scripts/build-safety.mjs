// Builds data/safety.json: what official and scientific sources say about the risks and the traditional
// medicinal use of the flora's plants, keyed by TAXREF id like data/plants.json.
//
// Sources, merged one by one with the previous file: a source that cannot be read (or reads as nothing) keeps its
// entries and its record from the previous data/safety.json, with a ::warning:: in the Actions log, so a passing
// outage never ships a file without its warnings; when no source is read, the previous file is written again. Kept
// entries are read again with this build's rules: TPPT ones attached by their Latin name and translated from their
// English, list B genera carried over to the genera split from them. The dataset build then checks the result
// (scripts/check-data.mjs: every source there, counts above floors, labels in French) before committing it.
// Names: an accepted name, or a synonym only one plant carries; a synonym several plants carry attaches to none
// (with a ::warning::), unless NAME_LINKS, reviewed by hand, says which plant it names. List B « Genus sp. » also
// covers the genera split from it (GENUS_SPLITS, reviewed by hand: Senecio → Jacobaea), with `from`.
// Each source record carries `read`, the day it was last read:
//  - ANSM, Pharmacopée française — liste A des plantes médicinales utilisées traditionnellement (parts used,
//    toxic parts) and liste B (plants whose potential adverse effects exceed the expected benefit). PDFs read
//    with `pdftotext -layout` (poppler-utils, installed by the workflow).
//  - Agroscope, Toxic Plants – Phytotoxins database (TPPT): toxic part, human and animal toxicity, main
//    toxins of 844 plants of Switzerland and Central Europe. XLSX read with the `xlsx` package. Open use,
//    source to be cited; commercial use needs Agroscope's permission (GeoFlora is non-commercial).
//
// Output: { about, sources, plants: { [taxrefId]: { ansm?: [{ list, name, parts, toxicParts, genus?, from? }],
//   tppt?: { level, levelLabel, levelEn, animal, parts, partsEn, toxins, name } } } }
//   TPPT level: 4 very strong toxic … 1 weak toxic, irritant, allergenic, estrogenic; carcinogenic is 2 (toxic);
//   0 when the base gives no human toxicity (« unknown »). levelEn and partsEn: the base's words, kept beside.

import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLANTS_FILE = process.env.PLANTS_FILE || 'data/plants.json';
const OUT_FILE = process.env.SAFETY_FILE || 'data/safety.json';
const USER_AGENT = 'GeoFlora/1.0 (https://github.com/yannouche-dev/flora)';

const ANSM_PAGE = 'https://ansm.sante.fr/pharmacopee/liste-des-plantes-medicinales-utilisees-traditionnellement';
const ANSM_FALLBACK = {
  A: 'https://ansm.sante.fr/uploads/2026/01/05/liste-a-janvier-2026.pdf',
  B: 'https://ansm.sante.fr/uploads/2026/01/05/liste-b-janvier-2026.pdf'
};
const TPPT_PACKAGE = 'https://ckan.opendata.swiss/api/3/action/package_show?id=giftpflanzen-phytotoxin-datenbank';
const TPPT_FALLBACK = 'https://www.agroscope.admin.ch/dam/de/sd-web/ty8Qf1mgVGOk/tppt-xls.xlsx';

export const SOURCES = {
  ansmA: { title: 'Pharmacopée française — Liste A des plantes médicinales utilisées traditionnellement', publisher: 'ANSM', url: ANSM_PAGE },
  ansmB: { title: 'Pharmacopée française — Liste B des plantes médicinales dont les effets indésirables potentiels sont supérieurs au bénéfice thérapeutique attendu', publisher: 'ANSM', url: ANSM_PAGE },
  tppt: { title: 'Toxic Plants – Phytotoxins database (TPPT)', publisher: 'Agroscope', url: 'https://www.agroscope.admin.ch/agroscope/en/home/services/dienste/futtermittel/toxische-pflanzen.html', licence: 'Utilisation libre avec mention de la source ; usage commercial soumis à autorisation' }
};

const fold = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** "Urtica dioïca L." → "urtica dioica"; "Aconitum sp." → { genus: "aconitum" }. */
export function nameKey(text) {
  const words = fold(text).replace(/[×]/g, 'x').replace(/[(),=]/g, ' ').split(' ').filter(Boolean);
  if (!words.length || !/^[a-z-]+$/.test(words[0])) return null;
  if (/^spp?\.?$/.test(words[1] || '')) return { genus: words[0] };
  let i = 1;
  if (words[i] === 'x' && words[i + 1]) i++;
  const epithet = words[i];
  if (!epithet || !/^[a-z-]+$/.test(epithet)) return null;
  return { key: words[0] + (i === 2 ? ' x ' : ' ') + epithet };
}

/**
 * Source names that several plants of the flora carry as a synonym, attached by hand to the one they name (TAXREF:
 * the accepted name whose basionym, or synonym in the strict sense, it is). Any other shared synonym attaches to no
 * plant (indexPlants: `ambiguous`, listed in the build log), never to the first plant read.
 */
export const NAME_LINKS = {
  // Ranunculus ficaria L. = Ficaria verna Huds. (Ficaire printanière); Ficaria ambigua carries it in a broad sense.
  'ranunculus ficaria': 98651,
  // Senecio incanus L., basionym of Jacobaea incana (L.) Veldkamp (Jacobaea leucophylla carries it too).
  'senecio incanus': 610642,
  // Papaver alpinum L., basionym of Oreomecon alpina (L.) Banfi et al. (Papaver cambricum carries it too).
  'papaver alpinum': 1019753
};

/**
 * Genera split from a genus that the ANSM list B names as a whole (« Senecio sp. »): the list's entry also covers the
 * plants of the split genus that carry a synonym in the named one. Reviewed by hand: a synonym alone spans unrelated
 * genera (Teucrium → Ajuga, Daphne → Thymelaea…). Jacobaea: the jacobées, formerly Senecio sect. Jacobaea.
 */
export const GENUS_SPLITS = { senecio: ['jacobaea'] };

/**
 * TAXREF ids of the flora by binomial — accepted names, and the synonyms only one plant carries or NAME_LINKS
 * attaches —, by genus, and the genera of each plant's synonyms. `ambiguous`: the synonyms several plants carry
 * (left out). @param {any[]} plants
 */
export function indexPlants(plants) {
  /** @type {Map<string, number>} */
  const byName = new Map();
  /** @type {Map<string, number[]>} */
  const byGenus = new Map();
  /** @type {Map<number, string>} each plant's accepted name, as a key */
  const keyOf = new Map();
  /** @type {Map<number, Set<string>>} */
  const synonymGenera = new Map();
  /** @type {Map<string, Set<number>>} */
  const owners = new Map();
  for (const p of plants) {
    const k = nameKey(p.scientificName)?.key;
    if (k) {
      // The species itself wins over a hybrid or an infraspecific taxon that starts with its name (« Arum italicum x
      // Arum maculatum », read as « arum italicum »).
      if (!byName.has(k) || fold(p.scientificName) === k) byName.set(k, p.id);
      keyOf.set(p.id, k);
    }
    const genera = new Set();
    for (const name of p.synonyms || []) {
      const s = nameKey(name)?.key;
      if (!s) continue;
      if (!owners.has(s)) owners.set(s, new Set());
      owners.get(s).add(p.id);
      genera.add(s.split(' ')[0]);
    }
    synonymGenera.set(p.id, genera);
    const g = fold(p.genus);
    if (!byGenus.has(g)) byGenus.set(g, []);
    byGenus.get(g).push(p.id);
  }
  /** @type {Map<string, number[]>} */
  const ambiguous = new Map();
  for (const [k, ids] of owners) {
    // Another plant's accepted name wins over a synonym.
    if (byName.has(k)) continue;
    const link = NAME_LINKS[k];
    if (ids.size === 1) byName.set(k, [...ids][0]);
    else if (link && ids.has(link)) byName.set(k, link);
    else ambiguous.set(k, [...ids]);
  }
  return { byName, byGenus, keyOf, synonymGenera, ambiguous };
}

// ── ANSM lists (PDF → text, one plant per row, continuation lines) ──────────────────────────────────────

const FAMILY = /\b[A-Z][a-z]+(?:aceae|ae)\b/;

/** Parts as written, without the tradition letters (a, b, c) and the « usage cutané » star. */
export const cleanParts = text => String(text || '')
  .replace(/\*/g, '')
  .replace(/(^|[\s,])[abc](?=\s*(?:,|$))/g, '$1')
  .replace(/\s+/g, ' ')
  .replace(/\s*,(\s*,)*\s*/g, ', ')
  .replace(/^[\s,]+|[\s,]+$/g, '')
  .replace(/\bfeuillle\b/g, 'feuille');

/**
 * Rows of an ANSM list from `pdftotext -layout` text: French name, Latin name, parts used, toxic parts.
 * @param {string} text @param {'A' | 'B'} list
 */
export function parseAnsm(text, list) {
  const rows = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (/^\f|LISTE [AB] DES|NOMS SCIENTIFIQUES|NOMS FRAN|ET SYNONYMES|DE LA PLANTE|^\s*PARTIES\s*$|Pharmacop/i.test(line)) { current = null; continue; }
    const fam = line.match(FAMILY);
    if (fam && fam.index !== undefined && fam.index > 10) {
      const before = line.slice(0, fam.index);
      const cells = before.split(/\s{2,}/).map(s => s.trim()).filter(Boolean);
      const after = line.slice(fam.index + fam[0].length);
      const tail = after.split(/\s{3,}/).map(s => s.trim()).filter(Boolean);
      const latinCell = cells.length > 1 ? cells[cells.length - 1] : cells[0] || '';
      const french = cells.length > 1 ? cells[0].replace(/(\s*,)+\s*notamment\s*$/i, '').replace(/[\s,]+$/, '') : '';
      const partsCol = fam.index + fam[0].length + (after.length - after.trimStart().length);
      current = { list, french, latin: [latinCell], parts: tail[0] || '', toxicParts: list === 'A' ? tail[1] || '' : '', partsCol, latinCol: line.indexOf(latinCell), famCol: fam.index, except: [] };
      rows.push(current);
      continue;
    }
    if (!current || !line.trim()) { if (!line.trim()) current = null; continue; }
    // Continuation: more Latin names (synonyms, « sauf … »), more parts.
    const latinPart = line.slice(Math.max(0, current.latinCol - 2), current.famCol).trim();
    const partsPart = line.slice(Math.max(current.famCol + 8, current.partsCol - 8)).trim();
    if (latinPart) {
      if (/^sauf\b/i.test(latinPart)) current.except.push(latinPart.replace(/^sauf\s+/i, ''));
      else current.latin.push(latinPart);
    }
    if (partsPart) {
      const [p, t] = partsPart.split(/\s{3,}/);
      if (p) current.parts += ' ' + p;
      if (t && list === 'A') current.toxicParts += ' ' + t;
    }
  }
  return rows.map(r => ({ ...r, parts: cleanParts(r.parts), toxicParts: cleanParts(r.toxicParts) }));
}

/**
 * Matches ANSM rows to TAXREF ids: species by name and synonyms (indexPlants); « Genus sp. » of list B to every
 * species of the genus but those the row excepts (« sauf … »), and to the genera split from it (extendSplitGenera).
 * A shared synonym (index.ambiguous) matches nothing: it goes to `skipped`, for the log.
 * @param {any[]} rows @param {ReturnType<typeof indexPlants>} index @param {Set<string>} [skipped]
 */
export function matchAnsm(rows, index, skipped = new Set()) {
  /** @type {Map<number, any[]>} */
  const out = new Map();
  const add = (id, entry) => { if (!out.has(id)) out.set(id, []); if (!out.get(id).some(e => e.list === entry.list && e.parts === entry.parts)) out.get(id).push(entry); };
  for (const r of rows) {
    const except = new Set(r.except.map(e => nameKey(e)?.key).filter(Boolean));
    const entry = { list: r.list, name: r.french || null, parts: r.parts || null, toxicParts: r.toxicParts || null };
    const names = r.latin.join(' ').split(/,|\bet\b|\(=|\)/).map(s => s.trim()).filter(Boolean);
    for (const n of names) {
      const k = nameKey(n);
      if (!k) continue;
      if (k.key && index.byName.has(k.key)) add(index.byName.get(k.key), entry);
      else if (k.key && index.ambiguous.has(k.key)) skipped.add(n);
      else if (k.genus && r.list === 'B') {
        for (const id of index.byGenus.get(k.genus) || []) if (!except.has(index.keyOf.get(id))) add(id, { ...entry, genus: true });
      }
    }
  }
  return extendSplitGenera(out, index);
}

/**
 * List B « Genus sp. » entries carried over to the genera split from that genus (GENUS_SPLITS): a plant of the split
 * genus with a synonym in the named one, and no list B entry of its own, gets the entry with `from` (the genus the
 * list names). Also run on entries kept from a previous file.
 * @param {Map<number, any[]>} byPlant @param {ReturnType<typeof indexPlants>} index
 */
export function extendSplitGenera(byPlant, index) {
  for (const [cited, splits] of Object.entries(GENUS_SPLITS)) {
    const source = (index.byGenus.get(cited) || []).map(id => byPlant.get(id)?.find(e => e.list === 'B' && e.genus && !e.from)).find(Boolean);
    if (!source) continue;
    const from = cited[0].toUpperCase() + cited.slice(1);
    for (const genus of splits) for (const id of index.byGenus.get(genus) || []) {
      const list = byPlant.get(id) || [];
      if (index.synonymGenera.get(id)?.has(cited) && !list.some(e => e.list === 'B')) byPlant.set(id, [...list, { ...source, from }]);
    }
  }
  return byPlant;
}

// ── TPPT (XLSX: Plants, Relationships) ───────────────────────────────────────────────────────────────────

const LEVELS = [['very strong toxic', 4, 'très fortement toxique'], ['strong toxic', 3, 'fortement toxique'], ['weak toxic', 1, 'faiblement toxique'], ['toxic', 2, 'toxique']];
const IRRITANT = [['skin-irritating', 'irritante pour la peau'], ['allergenic', 'allergisante'], ['phototoxic', 'phototoxique'], ['irritating', 'irritante']];

/**
 * TPPT's other human toxicity values, word for word (never milder): a carcinogenic plant is a toxic one (level 2);
 * « unknown » is no level at all (0: the base lists the plant, its toxicity to humans is not established).
 */
const OTHER = [['carcinogenic', 2, 'cancérogène'], ['estrogenic', 1, 'œstrogénique'], ['infested plants only', 1, 'seulement les plantes infestées'], ['unknown', 0, 'toxicité inconnue']];

/** Every French label toxicity() gives (check-data.mjs: no English left in safety.json). */
export const TOXICITY_LABELS = [...LEVELS.map(([, , fr]) => fr), ...IRRITANT.map(([, fr]) => fr), ...OTHER.map(([, , fr]) => fr)];

/**
 * French reading of a TPPT toxicity value: level 0–4 and label. A value read nowhere here keeps its words, at level 1
 * (check-data.mjs then fails: its translation is to be added).
 * @param {string} value @returns {{ level: number, label: string } | null}
 */
export function toxicity(value) {
  const v = String(value || '').toLowerCase().trim();
  if (!v) return null;
  // « phototoxic » is no toxicity level (« toxic »): read without it.
  const levels = v.replace(/phototoxic/g, '');
  for (const [en, level, fr] of LEVELS) if (levels.includes(en)) return { level: /** @type {number} */ (level), label: /** @type {string} */ (fr) };
  const irr = IRRITANT.filter(([en]) => en === 'irritating' ? /(^|[^-])irritating/.test(v.replace(/skin-irritating/g, '')) : v.includes(en)).map(([, fr]) => fr);
  // Phototoxic stays at level 2, where older builds put it (read as « toxic »): never milder than before.
  if (irr.length) return { level: irr.includes('phototoxique') ? 2 : 1, label: irr.join(', ') };
  const other = OTHER.find(([en]) => v === en);
  return other ? { level: /** @type {number} */ (other[1]), label: /** @type {string} */ (other[2]) } : { level: 1, label: v };
}

/**
 * TPPT's toxic parts, phrase by phrase (one pass, the longest first): the terms of the base (« herb »: the aerial
 * parts of a herbaceous plant, « flowering top »: sommités fleuries). The source's typos (« Fuit », « concentrationt »)
 * read as meant; its English is kept beside (partsEn).
 */
const PARTS = /** @type {[string, string][]} */ ([
  ['whole plant without aril (red seed coat)', 'plante entière sauf l’arille (enveloppe rouge de la graine)'],
  ['whole plant without fruit', 'plante entière sans les fruits'], ['whole plant without', 'plante entière sans …'],
  ['whole plant', 'plante entière'], ['whole fruit', 'fruit entier'], ['whole part', 'partie entière'],
  ['highest concentrations in', 'concentrations les plus fortes dans'], ['highest concentration in', 'concentrations les plus fortes dans'],
  ['highest concentrationt in', 'concentrations les plus fortes dans'],
  ['flowering top', 'sommités fleuries'], ['blooming herb', 'herbe en fleurs'], ['young herb', 'jeune herbe'], ['young plant', 'jeune plante'],
  ['aerial parts', 'parties aériennes'], ['aerial part', 'partie aérienne'], ['root cortex', 'écorce de racine'], ['tree bark', 'écorce du tronc'],
  ['unripe fruits', 'fruits non mûrs'], ['unripe fruit', 'fruits non mûrs'], ['unripe berries', 'baies non mûres'], ['unripe berry', 'baies non mûres'],
  ['berries', 'baies'], ['berry', 'baies'], ['leaves', 'feuilles'], ['leaf', 'feuilles'], ['seeds', 'graines'], ['seed', 'graines'],
  ['fruits', 'fruits'], ['fruit', 'fruits'], ['fuit', 'fruits'], ['roots', 'racines'], ['root', 'racines'], ['bulbs', 'bulbe'], ['bulb', 'bulbe'],
  ['tubers', 'tubercules'], ['tuber', 'tubercules'], ['rhizomes', 'rhizome'], ['rhizome', 'rhizome'], ['bark', 'écorce'],
  ['flowers', 'fleurs'], ['flower', 'fleurs'], ['latex', 'latex'], ['sap', 'sève'], ['needles', 'aiguilles'], ['shoots', 'pousses'], ['shoot', 'pousses'],
  ['stems', 'tiges'], ['stem', 'tiges'], ['herb', 'herbe'], ['capsule', 'capsule'], ['pollen', 'pollen'], ['wood', 'bois'], ['young', 'jeunes'],
  ['and', 'et'], ['or', 'ou'], ['without', 'sans'], ['in', 'dans']
]).sort((a, b) => b[0].length - a[0].length);
const PARTS_FR = new Map(PARTS);
const PARTS_RE = new RegExp(`(?<![a-z])(?:${PARTS.map(([en]) => en.replace(/[()]/g, '\\$&')).join('|')})(?![a-z])`, 'gi');

/** The French words partsFr() writes (check-data.mjs: a part with any other word was not translated). */
export const PARTS_WORDS = new Set(PARTS.flatMap(([, fr]) => fr.toLowerCase().split(/[^\p{L}]+/u)).filter(Boolean));

/** TPPT toxic part in French (the English stays alongside, partsEn). @param {string} en */
export function partsFr(en) {
  const s = String(en || '').trim().replace(PARTS_RE, m => /** @type {string} */ (PARTS_FR.get(m.toLowerCase())));
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * A TPPT entry read again with the current translations, from its English (levelEn, partsEn): for entries kept from
 * a previous file, whose labels were written by an older build. An entry without levelEn has its label as written,
 * French or (an older build's fallback) the English value.
 * @param {any} entry
 */
export function retranslate(entry) {
  const french = String(entry.levelLabel || '').split(', ').every(l => TOXICITY_LABELS.includes(l));
  const levelEn = entry.levelEn ?? (french ? null : entry.levelLabel);
  const human = levelEn ? toxicity(levelEn) : null;
  return {
    ...entry,
    ...(human ? { level: human.level, levelLabel: human.label } : {}),
    ...(levelEn ? { levelEn } : {}),
    parts: entry.partsEn ? partsFr(entry.partsEn) : entry.parts
  };
}

/** @param {any} XLSX @param {Buffer} buffer @param {ReturnType<typeof indexPlants>} index @param {Set<string>} [skipped] */
export function matchTppt(XLSX, buffer, index, skipped = new Set()) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = name => XLSX.utils.sheet_to_json(wb.Sheets[name] || {}, { defval: '' });
  const toxins = new Map();
  for (const r of sheet('Relationships')) {
    if (!/toxin/i.test(r.Composition || '') || /precursor|metabolite|possible/i.test(r.Composition || '')) continue;
    const list = toxins.get(r.Plant_number) || [];
    // Major toxins first.
    if (/major/i.test(r.Composition)) list.unshift(r.Phytotoxin_name); else list.push(r.Phytotoxin_name);
    toxins.set(r.Plant_number, list);
  }
  const out = new Map();
  for (const p of sheet('Plants')) {
    const human = toxicity(p.Human_toxicity), animal = toxicity(p.Animal_toxicity);
    if (!human && !animal) continue;
    out.set(String(p.Latin_plant_name).trim(), {
      level: human?.level ?? 0, levelLabel: human?.label ?? null, levelEn: String(p.Human_toxicity || '').trim() || null, animal: animal?.label ?? null,
      parts: partsFr(p.Toxic_plant_part) || null, partsEn: String(p.Toxic_plant_part || '').trim() || null,
      toxins: [...new Set(toxins.get(p.Plant_number) || [])].slice(0, 6), name: String(p.Latin_plant_name).trim()
    });
  }
  return linkTppt(out.values(), index, skipped);
}

/**
 * TPPT entries to TAXREF ids, by their Latin name (indexPlants: a shared synonym attaches to no plant, it goes to
 * `skipped`). The first entry for a plant wins. Also run on entries kept from a previous file: an older build may
 * have attached them through a shared synonym.
 * @param {Iterable<any>} entries @param {ReturnType<typeof indexPlants>} index @param {Set<string>} [skipped]
 * @returns {Map<number, any>}
 */
export function linkTppt(entries, index, skipped = new Set()) {
  const out = new Map();
  for (const entry of entries) {
    const k = nameKey(entry.name)?.key;
    const id = k && index.byName.get(k);
    if (k && index.ambiguous.has(k)) skipped.add(entry.name);
    if (id && !out.has(id)) out.set(id, entry);
  }
  return out;
}

// ── Download and assemble ─────────────────────────────────────────────────────────────────────────────

async function download(url) {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${url} → ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function ansmUrls() {
  try {
    const html = (await download(ANSM_PAGE)).toString('utf8');
    const a = html.match(/href="([^"]*liste-a[^"]*\.pdf)"/i)?.[1], b = html.match(/href="([^"]*liste-b[^"]*\.pdf)"/i)?.[1];
    const abs = u => u && new URL(u, ANSM_PAGE).href;
    return { A: abs(a) || ANSM_FALLBACK.A, B: abs(b) || ANSM_FALLBACK.B };
  } catch { return ANSM_FALLBACK; }
}

async function tpptUrl() {
  try {
    const data = JSON.parse((await download(TPPT_PACKAGE)).toString('utf8'));
    const res = (data.result?.resources || []).find(r => /xlsx?/i.test(r.format || '') || /\.xlsx$/i.test(r.url || ''));
    return res?.download_url || res?.url || TPPT_FALLBACK;
  } catch { return TPPT_FALLBACK; }
}

/**
 * What a source gave each plant in a safety file: the ANSM entries of one list, or the TPPT entry.
 * @type {Record<string, (entry: any) => any>}
 */
const SLICE = {
  ansmA: entry => entry.ansm?.filter(e => e.list === 'A'),
  ansmB: entry => entry.ansm?.filter(e => e.list === 'B'),
  tppt: entry => entry.tppt
};

/** The previous safety file, or null when there is none or it cannot be read. */
async function previousFile() {
  try {
    const data = JSON.parse(await readFile(OUT_FILE, 'utf8'));
    return data?.plants && data.sources ? data : null;
  } catch { return null; }
}

async function main() {
  const plants = JSON.parse(await readFile(PLANTS_FILE, 'utf8'));
  const index = indexPlants(plants);
  const flora = new Set(plants.map(p => p.id));
  const dir = await mkdtemp(join(tmpdir(), 'safety-'));
  const today = new Date().toISOString().slice(0, 10);
  /** Per source, what it gives each plant (an array of ANSM entries, or the TPPT entry). @type {Record<string, Map<number, any>>} */
  const got = {};
  /** @type {Record<string, any>} */
  const sources = {};
  const failed = [];
  /** Names of the sources left out for being synonyms several plants carry (indexPlants). @type {Set<string>} */
  const skipped = new Set();
  /** @type {string | undefined} */
  let previousBuilt;

  /** Reads one source; on failure, or when it matches no plant, keeps its part of the previous file. @param {string} key @param {() => Promise<{ matched: Map<number, any>, file: string }>} read */
  const source = async (key, read) => {
    try {
      const { matched, file } = await read();
      if (!matched.size) throw new Error('no plant of the flora matched');
      got[key] = matched;
      sources[key] = { ...SOURCES[key], file, read: today };
    } catch (error) {
      failed.push(key);
      // On one line: an annotation ends at the first line break, and execFileSync's message carries the stderr.
      const why = String(error?.message ?? error).replace(/\s*\n\s*/g, ' ').trim();
      const previous = await previousFile();
      if (previous?.sources?.[key]) {
        previousBuilt = previous.built;
        got[key] = new Map();
        for (const [id, entry] of Object.entries(previous.plants)) {
          const part = SLICE[key](entry);
          if (flora.has(Number(id)) && part && (!Array.isArray(part) || part.length)) got[key].set(Number(id), part);
        }
        // Read again with this build's rules: translations, attachment by name (not through a shared synonym), split genera.
        if (key === 'tppt') {
          const kept = got[key];
          got[key] = linkTppt([...kept.values()].map(retranslate), index, skipped);
          // A name this flora no longer resolves (and shares with no other plant) stays where it was.
          for (const [id, entry] of kept) {
            const k = nameKey(entry.name)?.key;
            if (!(k && (index.byName.has(k) || index.ambiguous.has(k))) && !got[key].has(id)) got[key].set(id, retranslate(entry));
          }
        }
        if (key === 'ansmB') extendSplitGenera(got[key], index);
        sources[key] = { read: previous.built, ...previous.sources[key] };
        console.warn(`::warning::${key} not read (${why}): its ${got[key].size} plants kept from the previous ${OUT_FILE} (read ${sources[key].read || 'on an unknown day'})`);
      } else console.warn(`::warning::${key} not read (${why}), and no previous ${OUT_FILE} has it: its warnings are missing`);
    }
  };

  const urls = await ansmUrls();
  for (const list of /** @type {const} */ (['A', 'B'])) {
    await source('ansm' + list, async () => {
      const pdf = join(dir, `ansm-${list}.pdf`), txt = join(dir, `ansm-${list}.txt`);
      await writeFile(pdf, await download(urls[list]));
      execFileSync('pdftotext', ['-layout', pdf, txt]);
      const rows = parseAnsm(await readFile(txt, 'utf8'), list);
      const matched = matchAnsm(rows, index, skipped);
      console.log(`ANSM liste ${list}: ${rows.length} rows, ${matched.size} plants of the flora`);
      return { matched, file: urls[list] };
    });
  }

  await source('tppt', async () => {
    const { default: XLSX } = await import('xlsx');
    const url = await tpptUrl();
    const matched = matchTppt(XLSX, await download(url), index, skipped);
    console.log(`TPPT: ${matched.size} plants of the flora`);
    return { matched, file: url };
  });

  // Never attached to the first plant read: said, to be added to NAME_LINKS once reviewed.
  for (const name of skipped) console.warn(`::warning::« ${name} » is a synonym of several plants (${index.ambiguous.get(nameKey(name)?.key ?? '')?.join(', ')}): attached to none (NAME_LINKS in scripts/build-safety.mjs)`);
  // No source read: the previous file, read again with this build's rules (same day of build).
  const none = failed.length === Object.keys(SOURCES).length;
  if (none && !previousBuilt) { console.warn(`::warning::No safety source read and no previous ${OUT_FILE}: nothing written.`); return; }
  /** @type {Record<number, any>} */
  const out = {};
  for (const id of [...new Set(Object.values(got).flatMap(m => [...m.keys()]))].sort((a, b) => a - b)) {
    const ansm = [...(got.ansmA?.get(id) || []), ...(got.ansmB?.get(id) || [])];
    const tppt = got.tppt?.get(id);
    out[id] = { ...(ansm.length ? { ansm } : {}), ...(tppt ? { tppt } : {}) };
  }
  const about = 'Risques et usages médicinaux traditionnels des plantes de la flore, d’après des sources officielles et scientifiques citées : ANSM (Pharmacopée française, listes A et B) et Agroscope (base TPPT des plantes toxiques). Ne dit jamais qu’une plante est comestible.';
  await writeFile(OUT_FILE, JSON.stringify({ about, built: none ? previousBuilt : today, sources, plants: out }));
  console.log(`${OUT_FILE}: ${Object.keys(out).length} plants${failed.length ? ` (not read: ${failed.join(', ')}; see the warnings above)` : ''}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
