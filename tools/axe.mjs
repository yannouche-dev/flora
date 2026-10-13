// Accessibility ratchet: axe-core (WCAG 2.x A and AA, and its best practices) on the main screens, phone and desktop,
// against a committed baseline of violations (tools/axe-baseline.json) that may only go down. Each rule's count is the
// number of elements it finds, over every screen. More than the baseline for any rule (or a rule it does not list)
// fails: a new violation does not get in. Fewer: the run says so, and `--update` writes the lower counts, never higher
// ones (that is the ratchet: the baseline is lowered by hand, in the pull request that fixes them). As in the smoke
// test (tests/smoke.mjs), outside requests are answered here (images: a blank picture; the rest: 503), so the screens
// are the same on every run, whatever the third-party services answer.
//   bash tools/assemble-site.sh _site && python3 -m http.server 8000 --directory _site &
//   node tools/axe.mjs [http://localhost:8000/] [--update]
// Needs the dev dependencies (npm ci: Playwright and axe-core, at the versions of package-lock.json) and Chromium.

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const UPDATE = args.includes('--update');
const BASE = new URL(args.find(a => !a.startsWith('--')) || 'http://localhost:8000/').href;
const ORIGIN = new URL(BASE).origin;
const BASELINE = join(dirname(fileURLToPath(import.meta.url)), 'axe-baseline.json');
const require = createRequire(import.meta.url);
const AXE_VERSION = require('axe-core/package.json').version;
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
/** WCAG 2.0, 2.1, 2.2 levels A and AA, and axe's best practices (one h1 per view, landmarks…). */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const SCREENS = ['#/?q=ortie', '#/plant/128268', '#/discover', '#/map', '#/collections', '#/settings'];
const DEVICES = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 900 } }
};
const BLANK = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>';
const READY_MS = 90000;

/** @type {Record<string, number>} */
const counts = {};
/** @type {string[]} */
const lines = [];
const browser = await chromium.launch();
try {
  for (const [device, options] of Object.entries(DEVICES)) {
    const context = await browser.newContext({ ...options, serviceWorkers: 'block', locale: 'fr-FR', reducedMotion: 'reduce' });
    await context.route(url => new URL(url).origin !== ORIGIN, route =>
      route.request().resourceType() === 'image' ? route.fulfill({ contentType: 'image/svg+xml', body: BLANK }) : route.fulfill({ status: 503, body: '' }));
    // A returning visitor: the discovery done, every tab there (as the smoke test's desktop).
    await context.addInitScript(() => { if (!localStorage.getItem('geoflora.discover')) localStorage.setItem('geoflora.discover', JSON.stringify({ done: true })); });
    const page = await context.newPage();
    await page.goto(BASE);
    const ready = await page.evaluate(ms => import('./app/core/store.js').then(({ store }) => new Promise(resolve => {
      const check = () => { if (store.state.status !== 'loading') resolve(store.state.status === 'ready' || store.state.status); };
      store.addEventListener('change', check);
      check();
      setTimeout(() => resolve('still loading'), ms);
    })), READY_MS).catch(e => `${e}`.split('\n')[0]);
    if (ready !== true) throw new Error(`${device}: the flora did not get ready (${ready})`);
    for (const screen of SCREENS) {
      await page.goto(BASE + screen);
      await page.waitForFunction(() => {
        const view = document.querySelector('gf-app')?.shadowRoot?.querySelector('main')?.lastElementChild;
        return Boolean(view?.shadowRoot?.childElementCount);
      }, null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000);
      await page.evaluate(AXE);
      const violations = await page.evaluate(async tags => {
        const r = await /** @type {any} */ (window).axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
        return r.violations.map((/** @type {any} */ v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((/** @type {any} */ n) => n.target.flat().join(' > ')) }));
      }, TAGS);
      for (const v of violations) {
        counts[v.id] = (counts[v.id] || 0) + v.targets.length;
        lines.push(`${device} ${screen}: ${v.id} (${v.impact}) ×${v.targets.length}: ${v.targets.slice(0, 3).join(' ; ')}`);
      }
    }
    await context.close();
  }
} finally {
  await browser.close().catch(() => {});
}

for (const line of lines) console.log(line);
/** @type {{ axe?: string, rules: Record<string, number> } | null} */
let baseline = null;
try { baseline = JSON.parse(readFileSync(BASELINE, 'utf8')); } catch { /* none yet */ }
const rules = [...new Set([...Object.keys(counts), ...Object.keys(baseline?.rules || {})])].sort();
const over = rules.filter(id => (counts[id] || 0) > (baseline?.rules?.[id] ?? 0));
const under = rules.filter(id => (counts[id] || 0) < (baseline?.rules?.[id] ?? 0));
console.log(`axe-core ${AXE_VERSION}, ${SCREENS.length} screens × ${Object.keys(DEVICES).length} widths: ` +
  (rules.map(id => `${id} ${counts[id] || 0}/${baseline?.rules?.[id] ?? 0}`).join(', ') || 'no violation'));
if (baseline && baseline.axe !== AXE_VERSION) console.log(`::warning::baseline written with axe-core ${baseline.axe}, run with ${AXE_VERSION}: a new release may count differently`);

if (UPDATE) {
  if (baseline && over.length) {
    for (const id of over) console.log(`::error::${id}: ${counts[id] || 0}, more than the baseline (${baseline.rules[id] ?? 0}); the baseline only goes down`);
    process.exitCode = 1;
  } else {
    const kept = Object.fromEntries(Object.keys(counts).sort().map(id => [id, counts[id]]));
    writeFileSync(BASELINE, JSON.stringify({ axe: AXE_VERSION, rules: kept }, null, 2) + '\n');
    console.log(`axe: baseline written (${Object.keys(kept).length} rules, ${Object.values(kept).reduce((a, b) => a + b, 0)} elements)`);
  }
} else if (!baseline) {
  console.log('::error::no tools/axe-baseline.json: write it with --update');
  process.exitCode = 1;
} else if (over.length) {
  for (const id of over) console.log(`::error::axe ${id}: ${counts[id] || 0} elements, the baseline allows ${baseline.rules[id] ?? 0} (see the lines above)`);
  console.log('axe: FAILED (more violations than the baseline)');
  process.exitCode = 1;
} else {
  if (under.length) console.log(`::notice::axe: fewer violations than the baseline (${under.map(id => `${id} ${counts[id] || 0} < ${baseline.rules[id]}`).join(', ')}): lower it with node tools/axe.mjs --update`);
  console.log('axe: no more violations than the baseline');
}
