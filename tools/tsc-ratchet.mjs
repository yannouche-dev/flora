// Type ratchet: tsc checks the JSDoc types of app/ (jsconfig.json: checkJs, the types of lit and Leaflet from the dev
// dependencies) against a committed baseline of its errors (tools/tsc-baseline.json), counted per file and per error
// code, that may only go down. More errors than the baseline for any file and code (or one it does not list) fails:
// a new type error does not get in, nor one moved to another file. Fewer: the run says so, and `--update` writes the
// lower counts, never higher ones (the baseline is lowered by hand, in the pull request that fixes them). Line
// numbers are left out on purpose: an edit above an old error does not fail the run.
//   npm run typecheck             (node tools/tsc-ratchet.mjs)
//   node tools/tsc-ratchet.mjs --update
// Needs the dev dependencies (npm ci: typescript, lit, @types/leaflet, at the versions of package-lock.json).

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'tools', 'tsc-baseline.json');
const UPDATE = process.argv.includes('--update');
// From node_modules, not through require: the package does not export its bin/ nor its package.json.
const TSC_DIR = join(ROOT, 'node_modules', 'typescript');
const TSC_VERSION = JSON.parse(readFileSync(join(TSC_DIR, 'package.json'), 'utf8')).version;

const run = spawnSync(process.execPath, [join(TSC_DIR, 'bin', 'tsc'), '-p', 'jsconfig.json', '--pretty', 'false'],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (run.error) throw run.error;
const output = run.stdout + run.stderr;

/** @type {Record<string, Record<string, number>>} file → code → errors */
const counts = {};
/** @type {Map<string, string[]>} `file code` → the error lines, to show what is new */
const lines = new Map();
for (const line of output.split('\n')) {
  const m = /^(.+?)\(\d+,\d+\): error (TS\d+):/.exec(line);
  if (!m) continue;
  const [, file, code] = m;
  (counts[file] ||= {})[code] = (counts[file][code] || 0) + 1;
  lines.set(`${file} ${code}`, [...(lines.get(`${file} ${code}`) || []), line]);
}
const total = Object.values(counts).flatMap(Object.values).reduce((a, b) => a + b, 0);
// tsc failing for another reason than type errors (a broken jsconfig.json, a missing dependency): no count to trust.
if (run.status !== 0 && total === 0) {
  console.log(output);
  console.log('::error::tsc did not run (see above)');
  process.exit(1);
}

/** @type {{ typescript?: string, errors?: Record<string, Record<string, number>> } | null} */
let baseline = null;
try { baseline = JSON.parse(readFileSync(BASELINE, 'utf8')); } catch { /* none yet */ }
const allowed = (/** @type {string} */ file, /** @type {string} */ code) => baseline?.errors?.[file]?.[code] ?? 0;
const keys = [...new Set([
  ...Object.entries(counts).flatMap(([f, c]) => Object.keys(c).map(code => `${f} ${code}`)),
  ...Object.entries(baseline?.errors || {}).flatMap(([f, c]) => Object.keys(c).map(code => `${f} ${code}`))
])].sort();
const count = (/** @type {string} */ key) => { const [f, c] = key.split(' '); return counts[f]?.[c] || 0; };
const limit = (/** @type {string} */ key) => { const [f, c] = key.split(' '); return allowed(f, c); };
const over = keys.filter(k => count(k) > limit(k));
const under = keys.filter(k => count(k) < limit(k));
const baseTotal = keys.reduce((a, k) => a + limit(k), 0);

console.log(`tsc ${TSC_VERSION}: ${total} errors in ${Object.keys(counts).length} files (baseline: ${baseline ? baseTotal : 'none'})`);
if (baseline && baseline.typescript !== TSC_VERSION) {
  console.log(`::warning::baseline written with typescript ${baseline.typescript}, run with ${TSC_VERSION}: a new release may count differently`);
}

if (UPDATE) {
  if (baseline && over.length) {
    for (const k of over) console.log(`::error::${k}: ${count(k)}, more than the baseline (${limit(k)}); the baseline only goes down`);
    process.exitCode = 1;
  } else {
    /** @type {Record<string, Record<string, number>>} */
    const errors = {};
    for (const file of Object.keys(counts).sort()) {
      errors[file] = Object.fromEntries(Object.entries(counts[file]).sort(([a], [b]) => a.localeCompare(b)));
    }
    writeFileSync(BASELINE, JSON.stringify({ typescript: TSC_VERSION, total, errors }, null, 2) + '\n');
    console.log(`tsc: baseline written (${total} errors)`);
  }
} else if (!baseline) {
  console.log('::error::no tools/tsc-baseline.json: write it with node tools/tsc-ratchet.mjs --update');
  process.exitCode = 1;
} else if (over.length) {
  for (const k of over) {
    const [file, code] = k.split(' ');
    for (const line of lines.get(k) || []) console.log(line);
    console.log(`::error file=${file}::${code} in ${file}: ${count(k)} errors, the baseline allows ${limit(k)} (lines above: fix the new one)`);
  }
  console.log('tsc: FAILED (more type errors than the baseline)');
  process.exitCode = 1;
} else {
  if (under.length) {
    console.log(`::notice::tsc: fewer errors than the baseline (${under.map(k => `${k} ${count(k)} < ${limit(k)}`).join(', ')}): lower it with node tools/tsc-ratchet.mjs --update`);
  }
  console.log('tsc: no more type errors than the baseline');
}
