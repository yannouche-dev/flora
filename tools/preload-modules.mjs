// The modules of the app's start preloaded by the assembled index.html: without a bundler the browser finds the graph
// of app/main.js one level of imports at a time (~9 levels deep: as many round trips before the last module is even
// asked for, ~1.5 s on a mobile network). A <link rel="modulepreload"> for each module main.js imports statically,
// directly or not, lets it ask for them all at once. Dynamic imports (loaded when needed) are left out on purpose.
// The plant sheet, loaded after the start (app/components/gf-flora.js), gets the same for its own modules (those the
// start has not loaded), listed in a <meta name="geoflora-preload-sheet">: preloaded only when the sheet is asked for.
// Written into the site only, after the two the repository's index.html already names (vendor/lit.js, app/main.js):
// the repository needs no list kept in step by hand (without the list, the sheet loads level by level, as before).
// The start is held by a ratchet: tools/start-baseline.json lists its modules, and a module joining it fails the check
// (load it where it is used: import() at first use, an element defined when first shown); one leaving it fails too,
// until the list is lowered (--update), so it cannot come back unnoticed.
//   node tools/preload-modules.mjs <site>            writes them (tools/assemble-site.sh, before the service worker's version)
//   node tools/preload-modules.mjs <site> --check    exits 1 unless the start is the baseline's and, on an assembled site,
//                                                    <site>/index.html carries exactly those preloads (tools/check.sh)
//   node tools/preload-modules.mjs . --update        lowers tools/start-baseline.json to the start of now (never raises it)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { moduleSyntax, tokenize } from './check-imports.mjs';

const ENTRY = 'app/main.js';
const SHEET = 'app/components/gf-plant-detail.js';
/** The line the preloads follow (index.html). */
const ANCHOR = '<link rel="modulepreload" href="app/main.js" />';
const MARK = 'data-preload="start"';
const SHEET_META = 'name="geoflora-preload-sheet"';
const BASELINE = new URL('./start-baseline.json', import.meta.url);

/**
 * The modules `entry` imports statically, directly or not, itself first, then nearest first (breadth first, as the
 * browser finds them); bare specifiers through the import map of index.html. Paths relative to the site. `via` gets,
 * for each module, the first one found importing it and the line (the shortest chain from the entry).
 * @param {string} site @param {string} [entry] @param {Map<string, { from: string, line: number }>} [via]
 * @returns {string[]}
 */
export function staticGraph(site, entry = ENTRY, via) {
  const html = readFileSync(join(site, 'index.html'), 'utf8');
  const mapText = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)?.[1];
  /** @type {Record<string, string>} */
  const bare = mapText ? JSON.parse(mapText).imports || {} : {};
  const seen = new Set([entry]);
  const queue = [entry];
  for (let i = 0; i < queue.length; i++) {
    const file = queue[i];
    const { imports } = moduleSyntax(tokenize(readFileSync(join(site, file), 'utf8')));
    for (const imp of imports) {
      if (imp.dynamic) continue;
      const target = imp.spec in bare ? relative(site, resolve(site, bare[imp.spec]))
        : /^\.{1,2}\//.test(imp.spec) ? relative(site, resolve(site, dirname(file), imp.spec)) : null;
      if (!target || seen.has(target)) continue;
      seen.add(target);
      via?.set(target, { from: file, line: imp.line });
      queue.push(target);
    }
  }
  return queue;
}

/** The lines index.html gets (the entry and lit are already there). @param {string} site @returns {string[]} */
function preloadLines(site) {
  const start = staticGraph(site);
  const loaded = new Set(start);
  const sheet = staticGraph(site, SHEET).filter(f => !loaded.has(f));
  return [
    ...start.filter(f => f !== ENTRY && f !== 'vendor/lit.js').map(f => `  <link rel="modulepreload" href="${f}" ${MARK} />`),
    `  <meta ${SHEET_META} content="${sheet.join(' ')}" ${MARK} />`
  ];
}

/** The chain from the entry to `module`: « app/main.js:5 → … → module ». @param {Map<string, { from: string, line: number }>} via @param {string} module */
function chain(via, module) {
  const steps = [module];
  for (let m = module, at = via.get(m); at; m = at.from, at = via.get(m)) steps.unshift(`${at.from}:${at.line}`);
  return steps.join(' → ');
}

/**
 * The ratchet: the problems of the start of `site` against tools/start-baseline.json (none: []).
 * @param {string} site @returns {string[]}
 */
function ratchet(site) {
  const baseline = new Set(JSON.parse(readFileSync(BASELINE, 'utf8')).modules);
  /** @type {Map<string, { from: string, line: number }>} */
  const via = new Map();
  const start = staticGraph(site, ENTRY, via);
  const now = new Set(start);
  return [
    ...start.filter(m => !baseline.has(m)).map(m => {
      const at = /** @type {{ from: string, line: number }} */ (via.get(m));
      return `file=${at.from},line=${at.line}::${m} joins the app's start (${chain(via, m)}): load it where it is used (import() at first use, an element defined when first shown), or add it to tools/start-baseline.json by hand in this PR`;
    }),
    ...[...baseline].filter(m => !now.has(m)).map(m => `file=tools/start-baseline.json::${m} no longer loads at start: lower the baseline (node tools/preload-modules.mjs . --update)`)
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [site, flag] = process.argv.slice(2);
  if (!site || (flag && flag !== '--check' && flag !== '--update') || (flag === '--update' && resolve(site) !== process.cwd())) {
    console.error('usage: node tools/preload-modules.mjs <site> [--check] | node tools/preload-modules.mjs . --update');
    process.exit(2);
  }
  if (flag === '--update') {
    const start = staticGraph(site);
    const baseline = new Set(JSON.parse(readFileSync(BASELINE, 'utf8')).modules);
    const added = start.filter(m => !baseline.has(m));
    for (const m of added) console.error(`::error file=tools/start-baseline.json::${m}: not in the baseline; the baseline only goes down`);
    if (added.length) process.exit(1);
    const modules = [...start].sort();
    writeFileSync(BASELINE, JSON.stringify({ entry: ENTRY, total: modules.length, modules }, null, 2) + '\n');
    console.log(`tools/start-baseline.json: ${baseline.size} → ${modules.length} modules at start`);
    process.exit(0);
  }
  if (flag === '--check') {
    const problems = ratchet(site);
    for (const p of problems) console.error(`::error ${p}`);
    if (problems.length) process.exit(1);
    console.log(`the app's start is the baseline's (${staticGraph(site).length} modules, tools/start-baseline.json)`);
  }
  try {
    const file = join(site, 'index.html');
    const html = readFileSync(file, 'utf8');
    // The repository's index.html names the entry only: its preloads are the assembled site's.
    if (flag && resolve(site) === process.cwd()) {
      if (html.includes(MARK)) throw new Error('the repository\'s index.html carries the preloads of an assembled site (tools/assemble-site.sh writes them there only)');
      process.exit(0);
    }
    if (!html.includes(ANCHOR)) throw new Error(`index.html has no « ${ANCHOR} » line to put the preloads after`);
    const lines = preloadLines(site);
    const present = html.split('\n').filter(l => l.includes(MARK));
    const summary = `${lines.length + 1} modules of the app's start, ${lines.at(-1)?.split('content="')[1].split(' ').length} of the plant sheet`;
    if (flag) {
      if (present.join('\n') !== lines.join('\n')) {
        throw new Error('index.html does not preload the modules the start of the app and the plant sheet import (tools/assemble-site.sh writes them)');
      }
      console.log(`index.html preloads the ${summary}`);
    } else {
      const without = html.split('\n').filter(l => !l.includes(MARK)).join('\n');
      writeFileSync(file, without.replace(ANCHOR, [ANCHOR, ...lines.map(l => l.trimStart())].join('\n  ')));
      console.log(`index.html: preloads the ${summary}`);
    }
  } catch (error) {
    console.error(`::error file=index.html::${/** @type {Error} */ (error).message}`);
    process.exit(1);
  }
}
