// Adds flowering months from Baseflor to data/plants.json.
//
// Baseflor — « Index botanique, écologique et chorologique de la flore de France », Philippe Julve
// (programme CATMINAT), distributed by Tela Botanica. Database under ODbL 1.0, content under CC BY-SA 2.0.
// Each matched plant gets `flowering: [firstMonth, lastMonth]` (1–12; last < first wraps over the year end).
//
// The file is found on the Tela Botanica downloads page (or BASEFLOR_URL), as CSV/TSV, .xlsx/.xls (read with
// the `xlsx` package, installed by the workflow) or a .zip holding one of those. Any failure only logs a
// warning: the dataset then ships without flowering months.

import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLANTS_FILE = process.env.PLANTS_FILE || 'data/plants.json';
const META_FILE = process.env.META_FILE || 'data/meta.json';
const DOWNLOADS_PAGE = 'https://www.tela-botanica.org/ressources/donnees/telechargements/';
const USER_AGENT = 'GeoFlora/1.0 (https://github.com/yannouche-dev/flora)';
export const LICENSE = 'CC BY-SA 2.0 (données), ODbL 1.0 (base) — Ph. Julve, Tela Botanica';

const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];

const fold = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Binomial of a scientific name with authors ("Allium ursinum L." → "allium ursinum"), and whether the
 * name is infraspecific (subsp., var., f.). Hybrid signs are kept ("mentha x piperita").
 */
export function binomial(name) {
  const tokens = fold(name).replace(/[×]/g, 'x').split(' ').filter(Boolean);
  if (tokens.length < 2) return { key: null, infra: false };
  const words = [tokens[0]];
  let i = 1;
  if (tokens[i] === 'x' && tokens[i + 1]) words.push(tokens[i++]);
  words.push(tokens[i]);
  const rest = tokens.slice(i + 1);
  return {
    key: /^[a-z-]+$/.test(words[words.length - 1]) ? words.join(' ') : null,
    infra: rest.some(t => /^(subsp|ssp|var|f|forma|subvar)\.?$/.test(t))
  };
}

/** A month cell: 1–12, "5", "mai", "Mai". */
export function month(value) {
  const text = fold(value).replace(/\.$/, '');
  if (!text) return null;
  const n = Number(text);
  if (Number.isInteger(n) && n >= 1 && n <= 12) return n;
  const index = MONTHS.findIndex(m => m === text || (text.length >= 3 && m.startsWith(text)));
  return index >= 0 ? index + 1 : null;
}

/** A single "floraison" cell such as "5-7", "4 à 6", "mai-juillet". */
export function period(value) {
  const parts = fold(value).split(/\s*(?:-|–|\/)\s*|\s+(?:a|au|jusqu'a)\s+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const first = month(parts[0]), last = month(parts[1]);
  return first && last ? [first, last] : null;
}

/** Splits CSV/TSV text (quoted fields allowed) into rows; the separator is guessed from the header line. */
export function parseDelimited(text) {
  const firstLine = text.slice(0, text.indexOf('\n') >>> 0);
  const sep = ['\t', ';', ','].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(cell => cell.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(cell => cell.trim())) rows.push(row);
  return rows;
}

/**
 * Finds the name and flowering columns from the header row.
 * @param {string[]} header
 */
export function columns(header) {
  const h = header.map(fold);
  const find = test => h.findIndex(test);
  const name = [
    c => /nom.*scien|scientific|nom_sci|^taxon$|nom latin/.test(c),
    c => /^nom$|^nom /.test(c) && !/vern|franc|bdnff|num|code/.test(c)
  ].map(find).find(i => i >= 0) ?? -1;
  const first = find(c => /flor/.test(c) && /(debut|deb\b|begin|start|premier|^flor.*1$)/.test(c));
  const last = find(c => /flor/.test(c) && /(fin\b|fin$|end|dernier|^flor.*2$)/.test(c));
  const single = first < 0 || last < 0 ? find(c => /floraison|flowering/.test(c)) : -1;
  const ref = find(c => c === 'cd_ref');
  return { name, first, last, single, ref };
}

/**
 * Flowering period per binomial. Species rows win over subspecies/varieties of the same binomial.
 * @param {string[][]} rows header first
 * Also keyed by TAXREF CD_REF when the table carries it (the dataset's plant ids are TAXREF CD_REF).
 * @returns {{ periods: Map<string, [number, number]>, byRef: Map<number, [number, number]>, rows: number, columns: ReturnType<typeof columns> }}
 */
export function floweringByName(rows) {
  // The header is the first row (of the first 20) naming both the taxon and its flowering.
  const usable = c => c.name >= 0 && (c.single >= 0 || (c.first >= 0 && c.last >= 0));
  const at = Math.max(0, rows.slice(0, 20).findIndex(row => usable(columns(row))));
  const [header, ...data] = rows.slice(at);
  const cols = columns(header || []);
  const periods = new Map();
  const byRef = new Map();
  const fromInfra = new Set();
  if (cols.name < 0 || (cols.single < 0 && (cols.first < 0 || cols.last < 0))) return { periods, byRef, rows: data.length, columns: cols };
  for (const row of data) {
    const { key, infra } = binomial(row[cols.name]);
    if (!key) continue;
    const value = cols.single >= 0 ? period(row[cols.single]) : (() => {
      const first = month(row[cols.first]), last = month(row[cols.last]);
      return first && last ? /** @type {[number, number]} */ ([first, last]) : null;
    })();
    if (!value) continue;
    const ref = cols.ref >= 0 ? Number(row[cols.ref]) : NaN;
    if (Number.isInteger(ref) && ref > 0 && (!infra || !byRef.has(ref))) byRef.set(ref, value);
    if (!infra) { periods.set(key, value); fromInfra.delete(key); }
    else if (!periods.has(key)) { periods.set(key, value); fromInfra.add(key); }
  }
  return { periods, byRef, rows: data.length, columns: cols };
}

/**
 * Writes `flowering` on plants: by TAXREF id (CD_REF) first, else accepted name, else a synonym.
 * @param {any[]} plants @param {Map<string, [number, number]>} periods @param {Map<number, [number, number]>} [byRef]
 * @returns {{ matched: number, byId: number }}
 */
export function applyFlowering(plants, periods, byRef = new Map()) {
  let matched = 0, byId = 0;
  for (const plant of plants) {
    const fromRef = byRef.get(plant.id);
    const names = [plant.scientificName, ...(plant.synonyms || [])];
    const hit = fromRef ? null : names.map(n => binomial(n).key).find(key => key && periods.has(key));
    const value = fromRef || (hit && periods.get(hit));
    if (value) { plant.flowering = value; matched++; if (fromRef) byId++; }
    else delete plant.flowering;
  }
  return { matched, byId };
}

// ── Download ────────────────────────────────────────────────────────────────

async function fetchOk(url) {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response;
}

const FILE_EXT = /\.(csv|txt|tsv|zip|xlsx|xls)(\?|$)/i;
const SEED_PAGES = [DOWNLOADS_PAGE, 'https://www.tela-botanica.org/projets/phytosociologie/'];
// Baseflor in Tela Botanica's document store (Cumulus), as linked from its eFlore metadata page.
const KNOWN_DOCS = ['https://api.tela-botanica.org/service:cumulus:doc/c6f031b23d74373071094f2b1347b5813a3fc2c7'];
const CUMULUS = /https?:\/\/api\.tela-botanica\.org\/service:cumulus:doc\/[0-9a-f]{40}/gi;

/** Anchors of a page: absolute href + visible text. */
function anchors(html, base) {
  return [...html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m => {
    let href = null;
    try { href = new URL(m[1].replace(/&amp;/g, '&'), base).href; } catch { /* not a URL */ }
    return { href, text: m[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() };
  }).filter(a => a.href);
}

/**
 * Looks for the Baseflor table on the downloads page and the CATMINAT project page: links whose address
 * or text names Baseflor, following one level of pages. Logs what it sees, to adjust if the site changes.
 */
async function findUrl() {
  const rank = href => ['.csv', '.txt', '.tsv', '.zip', '.xlsx', '.xls'].findIndex(ext => href.toLowerCase().split('?')[0].endsWith(ext));
  const found = [];
  for (const page of SEED_PAGES) {
    let html;
    try { html = await (await fetchOk(page)).text(); } catch (error) { console.log('Page indisponible :', error.message); continue; }
    const links = anchors(html, page);
    console.log(`${page}: ${html.length} caractères, ${links.length} liens, titre « ${(/<title>([^<]*)/i.exec(html) || [])[1] || ''} »`);
    const named = links.filter(a => /baseflor/i.test(a.href + ' ' + a.text));
    console.log('  liens Baseflor :', named.slice(0, 20));
    console.log('  fichiers :', links.filter(a => FILE_EXT.test(a.href)).slice(0, 40));
    for (const link of named) {
      if (FILE_EXT.test(link.href)) { found.push(link.href); continue; }
      // A page about Baseflor: look one level down for its files, and Cumulus document links in its source.
      try {
        const innerHtml = await (await fetchOk(link.href)).text();
        const inner = anchors(innerHtml, link.href).filter(a => FILE_EXT.test(a.href));
        const docs = [...new Set(innerHtml.match(CUMULUS) || [])];
        console.log('  ', link.href, '→', inner.slice(0, 20), docs.slice(0, 20));
        found.push(...inner.filter(a => /baseflor/i.test(a.href + ' ' + a.text)).map(a => a.href), ...docs);
      } catch (error) { console.log('  ', link.href, error.message); }
    }
    if (found.length) break;
  }
  // Files with a known extension first, then extension-less document links (format sniffed on download).
  const files = [...new Set([...found, ...KNOWN_DOCS])]
    .sort((a, b) => (rank(a) < 0 ? 99 : rank(a)) - (rank(b) < 0 ? 99 : rank(b)));
  console.log('Candidats :', files);
  return files;
}

const decode = bytes => {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return new TextDecoder('latin1').decode(bytes); }
};

async function readSpreadsheet(path) {
  const { default: XLSX } = await import('xlsx');
  const book = XLSX.read(await readFile(path));
  // The sheet with the most rows is the data table.
  const sheets = book.SheetNames.map(n => XLSX.utils.sheet_to_json(book.Sheets[n], { header: 1, raw: false, defval: '' }));
  return sheets.sort((a, b) => b.length - a.length)[0].map(row => row.map(String));
}

/** File kind from its first bytes: xlsx/zip ("PK"), legacy xls (OLE2), else text. */
function sniff(bytes) {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4000));
    return /\[Content_Types\]\.xml|xl\//.test(head) ? 'xlsx' : 'zip';
  }
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return 'xls';
  return 'txt';
}

async function readRows(url) {
  const response = await fetchOk(url);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const kind = sniff(bytes);
  console.log(`${url}: ${bytes.length} octets, ${response.headers.get('content-type')}, ${response.headers.get('content-disposition') || ''} → ${kind}`);
  const dir = await mkdtemp(join(tmpdir(), 'baseflor-'));
  let file = join(dir, 'baseflor.' + kind);
  await writeFile(file, bytes);
  if (kind === 'zip') {
    execFileSync('unzip', ['-q', '-o', file, '-d', dir]);
    const inner = (await readdir(dir, { recursive: true })).map(String).filter(f => /\.(csv|txt|tsv|xlsx|xls)$/i.test(f));
    console.log('Archive :', inner);
    if (!inner.length) throw new Error('archive sans tableau');
    file = join(dir, inner.sort((a, b) => Number(!/baseflor/i.test(a)) - Number(!/baseflor/i.test(b)))[0]);
  }
  if (/\.(xlsx|xls)$/i.test(file)) return readSpreadsheet(file);
  const text = decode(await readFile(file));
  if (/^\s*</.test(text)) throw new Error('page HTML au lieu d’un tableau');
  return parseDelimited(text);
}

async function main() {
  const plants = JSON.parse(await readFile(PLANTS_FILE, 'utf8'));
  const meta = JSON.parse(await readFile(META_FILE, 'utf8'));
  try {
    const candidates = process.env.BASEFLOR_URL ? [process.env.BASEFLOR_URL] : await findUrl();
    let result = null, url = null;
    for (const candidate of candidates) {
      try {
        const rows = await readRows(candidate);
        const parsed = floweringByName(rows);
        console.log('Premières lignes :', rows.slice(0, 3).map(r => r.slice(0, 60)));
        console.log('Colonnes :', parsed.columns, '—', parsed.rows, 'lignes,', parsed.periods.size, 'noms avec une floraison');
        if (parsed.periods.size) { result = parsed; url = candidate; break; }
      } catch (error) { console.log('  ', candidate, ':', error.message); }
    }
    if (!result) throw new Error('aucun tableau Baseflor exploitable (définir la variable BASEFLOR_URL)');
    const { periods, byRef, rows: count } = result;
    console.log('Baseflor :', url);
    const { matched, byId } = applyFlowering(plants, periods, byRef);
    console.log(`  dont ${byId} par identifiant TAXREF (CD_REF), ${matched - byId} par nom`);
    meta.sources = { ...(meta.sources || {}), baseflor: { url, license: LICENSE, rows: count, matched, fetchedAt: new Date().toISOString() } };
    console.log(`Baseflor: flowering months for ${matched} / ${plants.length} plants`);
  } catch (error) {
    console.warn('::warning::Baseflor skipped:', error.message);
    return;
  }
  await writeFile(PLANTS_FILE, JSON.stringify(plants, null, 2) + '\n', 'utf8');
  await writeFile(META_FILE, JSON.stringify(meta, null, 2) + '\n', 'utf8');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
