// Builds data/safety.json: what official and scientific sources say about the risks and the traditional
// medicinal use of the flora's plants, keyed by TAXREF id like data/plants.json.
//
// Sources (any failure only warns; the previous file is kept):
//  - ANSM, Pharmacopée française — liste A des plantes médicinales utilisées traditionnellement (parts used,
//    toxic parts) and liste B (plants whose potential adverse effects exceed the expected benefit). PDFs read
//    with `pdftotext -layout` (poppler-utils, installed by the workflow).
//  - Agroscope, Toxic Plants – Phytotoxins database (TPPT): toxic part, human and animal toxicity, main
//    toxins of 844 plants of Switzerland and Central Europe. XLSX read with the `xlsx` package. Open use,
//    source to be cited; commercial use needs Agroscope's permission (GeoFlora is non-commercial).
//
// Output: { about, sources, plants: { [taxrefId]: { ansm?: [{ list, name, parts, toxicParts, genus? }],
//   tppt?: { level, levelLabel, human, animal, parts, partsEn, toxins } } } }

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

/** TAXREF ids of the flora by binomial (accepted names and synonyms) and by genus. @param {any[]} plants */
export function indexPlants(plants) {
  const byName = new Map(), byGenus = new Map();
  for (const p of plants) {
    for (const name of [p.scientificName, ...(p.synonyms || [])]) {
      const k = nameKey(name)?.key;
      if (k && (!byName.has(k) || name === p.scientificName)) byName.set(k, p.id);
    }
    const g = fold(p.genus);
    if (!byGenus.has(g)) byGenus.set(g, []);
    byGenus.get(g).push(p.id);
  }
  return { byName, byGenus };
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

/** Matches ANSM rows to TAXREF ids (species by name and synonyms; « Genus sp. » to every species of the genus). */
export function matchAnsm(rows, index) {
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
      else if (k.genus && r.list === 'B') {
        for (const id of index.byGenus.get(k.genus) || []) {
          const plantKey = [...index.byName].find(([, v]) => v === id)?.[0];
          if (!except.has(plantKey)) add(id, { ...entry, genus: true });
        }
      }
    }
  }
  return out;
}

// ── TPPT (XLSX: Plants, Relationships) ───────────────────────────────────────────────────────────────────

const LEVELS = [['very strong toxic', 4, 'très fortement toxique'], ['strong toxic', 3, 'fortement toxique'], ['weak toxic', 1, 'faiblement toxique'], ['toxic', 2, 'toxique']];
const IRRITANT = [['skin-irritating', 'irritante pour la peau'], ['allergenic', 'allergisante'], ['phototoxic', 'phototoxique'], ['irritating', 'irritante']];

/** French reading of TPPT's human toxicity (level 0–4, label). @param {string} value */
export function toxicity(value) {
  const v = String(value || '').toLowerCase().trim();
  if (!v) return null;
  for (const [en, level, fr] of LEVELS) if (v.includes(en)) return { level, label: fr };
  const irr = IRRITANT.filter(([en]) => en === 'irritating' ? /(^|[^-])irritating/.test(v.replace(/skin-irritating/g, '')) : v.includes(en)).map(([, fr]) => fr);
  return irr.length ? { level: 1, label: irr.join(', ') } : { level: 1, label: v };
}

const PARTS = [
  [/whole plant without aril \(red seed coat\)/i, 'plante entière sauf l’arille (enveloppe rouge de la graine)'], [/aerial part \(or whole plant\)/i, 'partie aérienne (ou plante entière)'],
  [/highest concentrations? in/i, 'concentrations les plus fortes dans'], [/whole plant/i, 'plante entière'], [/aerial parts?/i, 'partie aérienne'],
  [/unripe fruits?/i, 'fruits non mûrs'], [/unripe berr(y|ies)/i, 'baies non mûres'], [/berr(y|ies)/i, 'baies'], [/leaves|leaf/i, 'feuilles'], [/seeds?/i, 'graines'],
  [/fruits?/i, 'fruits'], [/roots?/i, 'racines'], [/bulbs?/i, 'bulbe'], [/tubers?/i, 'tubercules'], [/rhizomes?/i, 'rhizome'], [/bark/i, 'écorce'],
  [/flowers?/i, 'fleurs'], [/latex/i, 'latex'], [/sap/i, 'sève'], [/needles/i, 'aiguilles'], [/shoots?/i, 'pousses'], [/stems?/i, 'tiges'], [/young/i, 'jeunes'],
  [/\band\b/gi, 'et'], [/\bor\b/gi, 'ou'], [/\bwithout\b/gi, 'sans'], [/\bin\b/gi, 'dans']
];

/** TPPT toxic part in French (word by word for the usual terms; the English stays alongside). @param {string} en */
export function partsFr(en) {
  let s = String(en || '').trim();
  for (const [re, fr] of PARTS) s = s.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), fr);
  return s;
}

/** @param {any} XLSX @param {Buffer} buffer @param {any} index */
export function matchTppt(XLSX, buffer, index) {
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
    const k = nameKey(p.Latin_plant_name)?.key;
    const id = k && index.byName.get(k);
    if (!id) continue;
    const human = toxicity(p.Human_toxicity), animal = toxicity(p.Animal_toxicity);
    if (!human && !animal) continue;
    out.set(id, {
      level: human?.level ?? 0, levelLabel: human?.label ?? null, animal: animal?.label ?? null,
      parts: partsFr(p.Toxic_plant_part) || null, partsEn: String(p.Toxic_plant_part || '').trim() || null,
      toxins: [...new Set(toxins.get(p.Plant_number) || [])].slice(0, 6), name: String(p.Latin_plant_name).trim()
    });
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

async function main() {
  const plants = JSON.parse(await readFile(PLANTS_FILE, 'utf8'));
  const index = indexPlants(plants);
  const dir = await mkdtemp(join(tmpdir(), 'safety-'));
  /** @type {Record<number, any>} */
  const out = {};
  const put = (id, k, v) => { (out[id] ||= {})[k] = v; };
  const sources = {};

  try {
    const urls = await ansmUrls();
    for (const list of /** @type {const} */ (['A', 'B'])) {
      const pdf = join(dir, `ansm-${list}.pdf`), txt = join(dir, `ansm-${list}.txt`);
      await writeFile(pdf, await download(urls[list]));
      execFileSync('pdftotext', ['-layout', pdf, txt]);
      const rows = parseAnsm(await readFile(txt, 'utf8'), list);
      const matched = matchAnsm(rows, index);
      for (const [id, entries] of matched) put(id, 'ansm', [...(out[id]?.ansm || []), ...entries]);
      sources['ansm' + list] = { ...SOURCES['ansm' + list], file: urls[list] };
      console.log(`ANSM liste ${list}: ${rows.length} rows, ${matched.size} plants of the flora`);
    }
  } catch (error) { console.warn('ANSM lists skipped:', error.message); }

  try {
    const { default: XLSX } = await import('xlsx');
    const url = await tpptUrl();
    const matched = matchTppt(XLSX, await download(url), index);
    for (const [id, entry] of matched) put(id, 'tppt', entry);
    sources.tppt = { ...SOURCES.tppt, file: url };
    console.log(`TPPT: ${matched.size} plants of the flora`);
  } catch (error) { console.warn('TPPT skipped:', error.message); }

  if (!Object.keys(sources).length) { console.warn('No safety source read: data/safety.json left as is.'); return; }
  const about = 'Risques et usages médicinaux traditionnels des plantes de la flore, d’après des sources officielles et scientifiques citées : ANSM (Pharmacopée française, listes A et B) et Agroscope (base TPPT des plantes toxiques). Ne dit jamais qu’une plante est comestible.';
  await writeFile(OUT_FILE, JSON.stringify({ about, built: new Date().toISOString().slice(0, 10), sources, plants: out }));
  console.log(`${OUT_FILE}: ${Object.keys(out).length} plants`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
