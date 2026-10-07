// Adds protection, harvest-regulation and Red List statuses to data/plants.json.
//
// Source: INPN « Base de connaissance Statuts » (BDC Statuts), PatriNat (OFB-MNHN-CNRS), open data, keyed by
// TAXREF CD_NOM / CD_REF like the dataset. Each matched plant gets `statuses`:
//   { type, code, label, area, level, iso }
//   type: PN (protection nationale), PR (régionale), PD (départementale), REGL (réglementation de la
//         cueillette ou du commerce), LRN / LRR (Liste rouge nationale / régionale).
// The archive is found on the INPN / PatriNat download pages (or BDC_URL); any failure only logs a warning.

import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLANTS_FILE = process.env.PLANTS_FILE || 'data/plants.json';
const META_FILE = process.env.META_FILE || 'data/meta.json';
const USER_AGENT = 'GeoFlora/1.0 (https://github.com/yannouche-dev/flora)';
const PAGES = [
  'https://inpn.mnhn.fr/telechargement/referentielEspece/bdc-statuts-especes',
  'https://www.patrinat.fr/fr/page-temporaire-de-telechargement-des-referentiels-de-donnees-lies-linpn-7353'
];
/** Known copy of the archive (GeoNature mirror of the INPN release), tried last. */
const FALLBACKS = ['https://geonature.fr/data/inpn/taxonomie/BDC-STATUTS-v18.zip'];
export const LICENSE = 'INPN — Base de connaissance Statuts (PatriNat, OFB-MNHN-CNRS), données ouvertes';

const fold = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Status types kept. Regulation: picking / trade rules, not invasive-species control. */
export function kindOf(type, typeLabel) {
  const t = String(type || '').toUpperCase();
  if (['PN', 'PR', 'PD', 'LRN', 'LRR'].includes(t)) return t;
  const label = fold(typeLabel);
  if (/lutte|nuisible|invasi|exotique|chasse|peche/.test(label)) return null;
  if (t.startsWith('REGL') || /reglementation|cueillette|ramassage|commerce/.test(label)) return 'REGL';
  return null;
}

/** One CSV line → cells (quotes allowed, no multi-line fields in this table). */
export function splitLine(line, sep) {
  const cells = [];
  let field = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === sep) { cells.push(field); field = ''; }
    else field += c;
  }
  cells.push(field);
  return cells;
}

/** Column indexes from the header line. */
export function columns(header) {
  const h = header.map(c => fold(c).replace(/^﻿/, ''));
  const at = (...names) => names.map(n => h.indexOf(n)).find(i => i >= 0) ?? -1;
  return {
    ref: at('cd_ref'), nom: at('cd_nom'), type: at('cd_type_statut'), typeLabel: at('lb_type_statut'),
    group: at('regroupement_type'), code: at('code_statut'), label: at('label_statut'), area: at('lb_adm_tr'),
    level: at('niveau_admin'), iso: at('cd_iso3166_2'), iso1: at('cd_iso3166_1')
  };
}

/**
 * Collects statuses for the dataset's plants from the table's lines.
 * @param {AsyncIterable<string> | Iterable<string>} lines
 * @param {Set<number>} ids accepted TAXREF ids of the dataset
 */
export async function collect(lines, ids) {
  /** @type {Map<number, any[]>} */
  const byPlant = new Map();
  const seenTypes = new Map();
  let cols = null, sep = ';', rows = 0;
  for await (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    if (!cols) {
      sep = [';', '\t', ','].sort((a, b) => line.split(b).length - line.split(a).length)[0];
      cols = columns(splitLine(line, sep));
      continue;
    }
    rows++;
    const cells = splitLine(line, sep);
    const ref = Number(cells[cols.ref]);
    if (!ids.has(ref)) continue;
    const type = cells[cols.type], typeLabel = cells[cols.typeLabel] || cells[cols.group];
    const key = `${type} — ${typeLabel}`;
    seenTypes.set(key, (seenTypes.get(key) || 0) + 1);
    const kind = kindOf(type, typeLabel);
    if (!kind) continue;
    const iso1 = cols.iso1 >= 0 ? cells[cols.iso1] : 'FR';
    if (iso1 && iso1 !== 'FR' && kind !== 'LRN') continue; // overseas or foreign territories
    const status = {
      type: kind,
      code: (cells[cols.code] || '').trim(),
      label: (cells[cols.label] || typeLabel || '').trim(),
      area: (cells[cols.area] || '').trim(),
      level: (cells[cols.level] || '').trim(),
      iso: cols.iso >= 0 ? (cells[cols.iso] || '').trim() : ''
    };
    const list = byPlant.get(ref) || [];
    if (!list.some(s => s.type === status.type && s.code === status.code && s.area === status.area)) list.push(status);
    byPlant.set(ref, list);
  }
  return { byPlant, seenTypes, rows, columns: cols };
}

// ── Download ────────────────────────────────────────────────────────────────

async function fetchOk(url) {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response;
}

async function candidates() {
  if (process.env.BDC_URL) return [process.env.BDC_URL];
  const found = [];
  for (const page of PAGES) {
    try {
      const html = await (await fetchOk(page)).text();
      const links = [...html.matchAll(/href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
        .map(m => ({ href: new URL(m[1].replace(/&amp;/g, '&'), page).href, text: m[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() }));
      const bdc = links.filter(l => /bdc|statut/i.test(l.href + ' ' + l.text) && /\.zip|download|telecharg/i.test(l.href + ' ' + l.text));
      console.log(`${page}: ${html.length} caractères, liens BDC :`, bdc.slice(0, 15));
      found.push(...bdc.filter(l => /\.zip(\?|$)/i.test(l.href) || /download/i.test(l.href)).map(l => l.href));
    } catch (error) { console.log('Page indisponible :', page, error.message); }
  }
  return [...new Set([...found, ...FALLBACKS])];
}

/** Downloads the archive and yields the lines of its statuses table (largest CSV in the zip). */
async function linesOf(url) {
  const response = await fetchOk(url);
  const bytes = new Uint8Array(await response.arrayBuffer());
  console.log(`${url}: ${bytes.length} octets, ${response.headers.get('content-type')}`);
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new Error('pas une archive zip');
  const dir = await mkdtemp(join(tmpdir(), 'bdc-'));
  const zip = join(dir, 'bdc.zip');
  await writeFile(zip, bytes);
  execFileSync('unzip', ['-q', '-o', zip, '-d', dir]);
  const files = (await readdir(dir, { recursive: true })).map(String).filter(f => /\.(csv|txt)$/i.test(f));
  console.log('Archive :', files);
  const sizes = await Promise.all(files.map(async f => [f, (await stat(join(dir, f))).size]));
  const table = sizes.sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!table) throw new Error('archive sans tableau');
  const head = (await readFile(join(dir, table))).subarray(0, 1_000_000);
  let encoding = 'utf8';
  try { new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(0, head.lastIndexOf(10))); } catch { encoding = 'latin1'; }
  console.log('Tableau :', table, encoding);
  return createInterface({ input: createReadStream(join(dir, table), { encoding: /** @type {BufferEncoding} */ (encoding) }), crlfDelay: Infinity });
}

async function main() {
  const plants = JSON.parse(await readFile(PLANTS_FILE, 'utf8'));
  const meta = JSON.parse(await readFile(META_FILE, 'utf8'));
  const ids = new Set(plants.map(p => p.id));
  let result = null, url = null;
  try {
    for (const candidate of await candidates()) {
      try {
        const r = await collect(await linesOf(candidate), ids);
        console.log('Colonnes :', r.columns, '—', r.rows, 'lignes,', r.byPlant.size, 'plantes avec un statut retenu');
        console.log('Types vus pour nos plantes :', [...r.seenTypes].sort((a, b) => b[1] - a[1]).slice(0, 60));
        if (r.byPlant.size) { result = r; url = candidate; break; }
      } catch (error) { console.log('  ', candidate, ':', error.message); }
    }
    if (!result) throw new Error('aucun tableau de statuts exploitable (définir la variable BDC_URL)');
  } catch (error) {
    console.warn('::warning::Statuts INPN ignorés :', error.message);
    return;
  }
  const count = { PN: 0, PR: 0, PD: 0, REGL: 0, LRN: 0, LRR: 0 };
  for (const plant of plants) {
    const list = result.byPlant.get(plant.id);
    if (list?.length) {
      plant.statuses = list;
      for (const type of new Set(list.map(s => s.type))) count[type]++;
    } else delete plant.statuses;
  }
  for (const name of ['Arnica montana', 'Cypripedium calceolus', 'Allium ursinum', 'Gentiana lutea']) {
    console.log(`  ${name} :`, JSON.stringify(plants.find(p => p.scientificName === name)?.statuses ?? null));
  }
  console.log('Plantes par type de statut :', count);
  meta.sources = { ...(meta.sources || {}), bdcStatuts: { url, license: LICENSE, rows: result.rows, plants: result.byPlant.size, byType: count, fetchedAt: new Date().toISOString() } };
  await writeFile(PLANTS_FILE, JSON.stringify(plants, null, 2) + '\n', 'utf8');
  await writeFile(META_FILE, JSON.stringify(meta, null, 2) + '\n', 'utf8');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
