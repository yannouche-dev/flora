// Builds data/ign-catalog.json: IGN's whole WMTS catalogue (Géoplateforme GetCapabilities), compact, shipped with the
// app so the « Toutes les couches de l'IGN » list of the Carte panel shows at once, offline too, and never depends on
// downloading and parsing the service's multi-megabyte description on a phone. Read with the app's own parser
// (lib/ign-catalog.mjs) and classified with its rules (lib/ign-classify.mjs: categories, sub-categories, series, the
// layers useful for botany), written in the file's format 2 (the head of lib/ign-catalog.mjs). Run at each deploy
// (deploy-pages.yml, which also runs monthly for it): the site gets a fresh copy, the committed one being the fallback;
// the app still refreshes it in the background once it is over a month old (app/core/ign-catalog.js).
//   node scripts/build-ign-catalog.mjs                  asks the service, writes data/ign-catalog.json
//     [--out file]                                       writes there instead
//     [--from caps.xml]                                  a Capabilities document already downloaded
//   node scripts/build-ign-catalog.mjs --reclassify [file]
//                                                        a catalogue file (default the committed one) classified again
//                                                        and written back in format 2, its layers and dates kept: for
//                                                        new rules, without asking the service
//     [--seed "note"]                                    marks the file as a starting copy (the app asks the service
//                                                        again at once): for a copy not read from the service itself
//     [--fallback]                                       a failure is a ::warning:: and exit 0, the file left as it was
//                                                        (deploy: the committed copy is published)
//   node scripts/build-ign-catalog.mjs --check file      checks a catalogue file (exit 1 when unusable)
// A document is refused (nothing written) when it reads as fewer than MIN_LAYERS layers (default 50), when the app's own
// map layers (app/core/ign-layers.js) are missing from it, or when it lost more than MAX_DROP (default 0.3) of the layers of
// the copy committed: a broken or truncated answer never replaces a good catalogue.
// Size: descriptions are kept up to ABOUT_MAX characters, cut shorter (400, 300, 240) while the file is over
// SIZE_BUDGET bytes (default 600 kB; the service worker precaches it, every phone downloads it).
// Behind a proxy, Node 22.21+ needs NODE_USE_ENV_PROXY=1.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CAPABILITIES_URL, FORMAT_VERSION, fileLayers, layersOf, parseCapabilities } from '../lib/ign-catalog.mjs';
import { CATEGORIES, TAXONOMY_VERSION } from '../lib/ign-classify.mjs';

const COMMITTED = fileURLToPath(new URL('../data/ign-catalog.json', import.meta.url));
const MIN_LAYERS = Number(process.env.MIN_LAYERS || 50);
const MAX_DROP = Number(process.env.MAX_DROP || 0.3);
const TRIES = Number(process.env.TRIES || 3);
const RETRY_WAIT_MS = Number(process.env.RETRY_WAIT_MS || 30_000);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 4 * 60_000);
const SIZE_BUDGET = Number(process.env.SIZE_BUDGET || 600_000);
const AGENT = 'GeoFlora build-ign-catalog (https://github.com/yannouche-dev/flora; at each deploy, at least monthly)';

const args = process.argv.slice(2);
const option = (/** @type {string} */ name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const from = option('--from');
const seed = option('--seed');
const out = option('--out') || COMMITTED;
const check = option('--check');
const reclassify = args.includes('--reclassify') ? (option('--reclassify') && !option('--reclassify')?.startsWith('--') ? option('--reclassify') : COMMITTED) : null;
const fallback = args.includes('--fallback');

/**
 * What is wrong with a catalogue file (none: usable).
 * @param {any} file @returns {string[]}
 */
function problemsOf(file) {
  const problems = [];
  const raw = Array.isArray(file?.layers) ? file.layers : null;
  if (!raw) return ['no layers[]'];
  const good = layersOf(file);
  if (good.length !== raw.length) problems.push(`${raw.length - good.length} layers without a safe id, a PNG/JPEG format, a title or zooms`);
  if (good.length < MIN_LAYERS) problems.push(`${good.length} layers, fewer than ${MIN_LAYERS}`);
  if (!Number.isFinite(Date.parse(file.fetchedAt))) problems.push('no fetchedAt date');
  if (new Set(good.map(l => l.id)).size !== good.length) problems.push('layers listed twice');
  // Every layer has its place (« Autres » at worst): none lost by the classification.
  const places = new Set(CATEGORIES.flatMap(c => c.subs.map(sub => `${c.id}/${sub.id}`)));
  const lost = good.filter(l => !places.has(`${l.cat}/${l.sub}`));
  if (lost.length) problems.push(`${lost.length} layers without a category`);
  return problems;
}

/**
 * The file's text: one layer per line (two copies compare as a short diff), descriptions cut shorter while it is over
 * SIZE_BUDGET. @param {Record<string, any>} head @param {import('../lib/ign-catalog.mjs').CatalogLayer[]} layers
 */
function serialize(head, layers) {
  const { groups, layers: rows } = fileLayers(layers);
  let text = '';
  for (const max of [Infinity, 400, 300, 240]) {
    const cut = rows.map(l => (l.about.length > max ? { ...l, about: l.about.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' } : l));
    const file = { version: FORMAT_VERSION, taxonomy: TAXONOMY_VERSION, ...head, count: layers.length, groups };
    text = '{\n' + Object.entries(file).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},\n`).join('')
      + '  "layers": [\n' + cut.map(l => '    ' + JSON.stringify(l)).join(',\n') + '\n  ]\n}\n';
    if (Buffer.byteLength(text) <= SIZE_BUDGET) break;
  }
  return text;
}

/** Counts per category, for the log. @param {import('../lib/ign-catalog.mjs').CatalogLayer[]} layers */
const census = layers => CATEGORIES.map(c => [c.label, layers.filter(l => l.cat === c.id).length]).filter(([, n]) => n).map(([c, n]) => `${c} ${n}`).join(', ');

/** The document: from a file, or from the service (TRIES tries). @returns {Promise<Buffer>} */
async function download() {
  if (from) return readFileSync(from);
  let last;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    try {
      const response = await fetch(CAPABILITIES_URL, { headers: { 'user-agent': AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      last = error;
      console.warn(`::warning::GetCapabilities, try ${attempt}/${TRIES}: ${/** @type {Error} */ (error).message}`);
      if (attempt < TRIES) await new Promise(resolve => setTimeout(resolve, RETRY_WAIT_MS));
    }
  }
  throw last;
}

/** Reads the service and writes the catalogue; throws (nothing written) when the answer is not usable. */
async function build() {
  const body = await download();
  const xml = body.toString('utf8');
  if (!/<(?:[\w.-]+:)?Capabilities\b/.test(xml)) throw new Error('not a WMTS Capabilities document');
  const layers = parseCapabilities(xml);

  const problems = [];
  // The app's own layers (backgrounds and overlays of app/core/ign-layers.js) are each in the catalogue.
  const own = [...readFileSync(new URL('../app/core/ign-layers.js', import.meta.url), 'utf8').matchAll(/\{ id: '([^']+)', format: 'image\//g)].map(m => m[1]);
  const ids = new Set(layers.map(l => l.id));
  const missing = own.filter(id => !ids.has(id));
  if (missing.length) problems.push(`layers of the app missing: ${missing.join(', ')}`);
  if (existsSync(COMMITTED)) {
    const before = layersOf(JSON.parse(readFileSync(COMMITTED, 'utf8'))).length;
    if (before && layers.length < before * (1 - MAX_DROP)) problems.push(`${layers.length} layers, down from ${before} committed (more than ${MAX_DROP * 100} %)`);
  }
  const head = {
    fetchedAt: new Date().toISOString(),
    ...(seed ? { seed: true } : {}),
    source: {
      url: CAPABILITIES_URL,
      sha256: createHash('sha256').update(body).digest('hex'),
      bytes: body.length,
      ...(seed ? { note: seed } : {})
    }
  };
  const text = serialize(head, layers);
  problems.push(...problemsOf(JSON.parse(text)));
  if (problems.length) throw new Error(problems.join('; '));

  writeFileSync(out, text);
  const formats = layers.reduce((/** @type {Record<string, number>} */ n, l) => ({ ...n, [l.format]: (n[l.format] || 0) + 1 }), {});
  console.log(`${out}: ${layers.length} layers (${Object.entries(formats).map(([f, n]) => `${n} ${f}`).join(', ')}), ${(body.length / 1e6).toFixed(1)} MB read, sha256 ${head.source.sha256.slice(0, 12)}…${seed ? ' (seed)' : ''}, ${(Buffer.byteLength(text) / 1e3).toFixed(0)} kB written`);
  console.log(census(layers));
}

/** A catalogue file classified again with the rules of lib/ign-classify.mjs, its layers and dates kept. @param {string} path */
function reclassifyFile(path) {
  const file = JSON.parse(readFileSync(path, 'utf8'));
  // Not taken as classified: the rules are applied again (a file of these very rules gives the same result).
  const layers = layersOf(file.layers);
  if (layers.length !== file.layers.length) throw new Error(`${file.layers.length - layers.length} layers unreadable`);
  const { version, taxonomy, count, groups, layers: _, ...head } = file;
  const text = serialize(head, layers);
  const problems = problemsOf(JSON.parse(text));
  if (problems.length) throw new Error(problems.join('; '));
  writeFileSync(out === COMMITTED ? path : out, text);
  console.log(`${out === COMMITTED ? path : out}: ${layers.length} layers classified (taxonomy ${TAXONOMY_VERSION}), ${(Buffer.byteLength(text) / 1e3).toFixed(0)} kB`);
  console.log(census(layers));
}

if (reclassify) {
  try {
    reclassifyFile(reclassify);
  } catch (error) {
    console.error(`::error::${/** @type {Error} */ (error).message}`);
    process.exit(1);
  }
} else if (check) {
  let problems;
  try { problems = problemsOf(JSON.parse(readFileSync(check, 'utf8'))); } catch (error) { problems = [/** @type {Error} */ (error).message]; }
  for (const p of problems) console.error(`::error file=${check}::${p}`);
  if (problems.length) process.exit(1);
  console.log(`${check}: a usable catalogue`);
} else {
  try {
    await build();
  } catch (error) {
    const message = `IGN catalogue not rebuilt: ${/** @type {Error} */ (error).message}`;
    if (!fallback) { console.error(`::error::${message}`); process.exit(1); }
    console.warn(`::warning::${message} — the committed copy (data/ign-catalog.json) is kept`);
    if (out !== COMMITTED) writeFileSync(out, readFileSync(COMMITTED));
  }
}
