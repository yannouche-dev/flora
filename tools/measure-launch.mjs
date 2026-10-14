// The first launch measured, as a phone on a mobile network sees it: the assembled site (tools/assemble-site.sh)
// served over HTTP/2 and gzip like GitHub Pages, a cold browser (no service worker, empty caches and IndexedDB), a
// throttled network and CPU. Not part of any check: run it by hand before and after a change of the launch path.
//   bash tools/assemble-site.sh _site && node tools/measure-launch.mjs _site [--runs 3] [--json out.json]
//   options: --down 9000 --rtt 165 (kbit/s, ms: DevTools' « Fast 4G »)   --cpu 4 (DevTools' « mid-range »)
// The network is throttled in the server (one bandwidth shared by every request: the page's, the workers', the
// service worker's precache, as on a real link; each response held one round trip before its first byte), the CPU by
// the DevTools protocol on every target (the page, its workers, the service worker). Outside hosts never resolve: only
// the site's own bytes are counted. The visitor is a returning one (Découvrir done), so the search shows first.
// Milestones, from the navigation's start (ms): first contentful paint; the shell interactive (the search field
// shown); the first search result (« ortie » typed as soon as the field shows, « Ortie dioïque » listed); the first
// plant sheet (that result opened, its name in the sheet); the full flora stored (IndexedDB holds every plant of
// meta.json). Bytes and requests: up to the first result, and in all once the network is quiet (service worker
// installed). Long tasks (> 50 ms) of the page's main thread over the whole launch: count, total and longest.
import { spawn, execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createSecureServer } from 'node:http2';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { createGzip } from 'node:zlib';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const option = (/** @type {string} */ name, /** @type {number} */ fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const SITE = resolve(args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) || '_site');
const RUNS = option('runs', 3), DOWN = option('down', 9000), RTT = option('rtt', 165), CPU = option('cpu', 4);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
// --log <file>: every request of the last run (start and end from the navigation, ms; status; bytes sent).
const logOut = args.includes('--log') ? args[args.indexOf('--log') + 1] : null;
if (!existsSync(join(SITE, 'index.html'))) {
  console.error(`usage: node tools/measure-launch.mjs <assembled site> — no ${SITE}/index.html (bash tools/assemble-site.sh _site)`);
  process.exit(2);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain' };
const COMPRESSED = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt']);

/** The shared link: every chunk of every response waits its turn on one bandwidth. */
const BYTES_PER_MS = DOWN * 1000 / 8 / 1000;
let linkFree = 0;
/** @param {number} size */
const onLink = size => {
  const now = performance.now();
  linkFree = Math.max(linkFree, now) + size / BYTES_PER_MS;
  return new Promise(done => setTimeout(done, Math.max(0, linkFree - now)));
};

const counters = { requests: 0, bytes: 0, active: 0, last: 0 };
/** @type {Map<string, number>} */
const perFile = new Map();
/** @type {{ path: string, start: number, end: number, status: number, bytes: number }[]} */
let requestLog = [];
let navigationStart = 0;
/** @param {string} path @param {number} start @param {number} status @param {number} bytes */
const logRequest = (path, start, status, bytes) =>
  requestLog.push({ path, start: Math.round(start - navigationStart), end: Math.round(performance.now() - navigationStart), status, bytes });

/**
 * A self-signed certificate for localhost (HTTP/2 needs TLS), trusted by the browser through its key's hash: a
 * certificate error merely ignored would keep every response out of the HTTP cache (and the service worker's
 * revalidations from ever getting a 304).
 */
function certificate() {
  const dir = mkdtempSync(join(tmpdir(), 'measure-cert-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
  const pair = { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) };
  rmSync(dir, { recursive: true, force: true });
  const spki = new X509Certificate(pair.cert).publicKey.export({ type: 'spki', format: 'der' });
  return { ...pair, spki: createHash('sha256').update(spki).digest('base64') };
}

const { spki: SPKI, ...tls } = certificate();
const server = createSecureServer({ ...tls, allowHTTP1: true }, async (request, response) => {
  counters.requests++;
  counters.active++;
  const started = performance.now();
  const finish = () => { counters.active--; counters.last = performance.now(); };
  await new Promise(done => setTimeout(done, RTT));
  const path = normalize(decodeURIComponent(new URL(request.url || '/', 'https://localhost').pathname)).replace(/^\/+/, '');
  let file = join(SITE, path || 'index.html');
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file.startsWith(SITE) || !existsSync(file)) {
    response.writeHead(404);
    response.end();
    logRequest(path, started, 404, 0);
    finish();
    return;
  }
  const ext = extname(file);
  // Validators, as Pages gives them: a request revalidated with an unchanged file gets a 304, no body.
  const { size, mtimeMs } = statSync(file);
  const etag = `"${size.toString(16)}-${Math.round(mtimeMs).toString(16)}"`;
  if (request.headers['if-none-match'] === etag) {
    response.writeHead(304, { etag, 'cache-control': 'max-age=600' });
    response.end();
    logRequest(path, started, 304, 0);
    finish();
    return;
  }
  const gzip = COMPRESSED.has(ext) && /gzip/.test(String(request.headers['accept-encoding'] || ''));
  response.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'max-age=600', etag,
    ...(gzip ? { 'content-encoding': 'gzip' } : {}) });
  const source = createReadStream(file);
  const body = gzip ? source.pipe(createGzip({ level: 6 })) : source;
  let sent = 0;
  for await (const chunk of body) {
    for (let i = 0; i < chunk.length; i += 16384) {
      const part = chunk.subarray(i, i + 16384);
      await onLink(part.length);
      response.write(part);
      sent += part.length;
    }
  }
  response.end();
  counters.bytes += sent;
  perFile.set(path, (perFile.get(path) || 0) + sent);
  logRequest(path, started, 200, sent);
  finish();
});
await new Promise(done => server.listen(0, '127.0.0.1', () => done(undefined)));
const PORT = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
const ORIGIN = `https://localhost:${PORT}/`;

/** A minimal DevTools-protocol client over the browser's WebSocket: the CPU throttled on every target, as it starts. */
async function throttleCpu(/** @type {string} */ wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((done, fail) => { ws.onopen = done; ws.onerror = fail; });
  let id = 0;
  const send = (/** @type {string} */ method, params = {}, /** @type {string | undefined} */ sessionId = undefined) =>
    ws.send(JSON.stringify({ id: ++id, method, params, ...(sessionId ? { sessionId } : {}) }));
  ws.onmessage = event => {
    const message = JSON.parse(String(event.data));
    if (message.method !== 'Target.attachedToTarget') return;
    const { sessionId, targetInfo } = message.params;
    if (!['page', 'worker', 'service_worker'].includes(targetInfo.type)) { send('Runtime.runIfWaitingForDebugger', {}, sessionId); return; }
    send('Emulation.setCPUThrottlingRate', { rate: CPU }, sessionId);
    send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
    send('Runtime.runIfWaitingForDebugger', {}, sessionId);
  };
  send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  return ws;
}

/** @param {number} ms */
const sleep = ms => new Promise(done => setTimeout(done, ms));

async function measure() {
  const profile = mkdtempSync(join(tmpdir(), 'measure-profile-'));
  const chrome = spawn(chromium.executablePath(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
     `--ignore-certificate-errors-spki-list=${SPKI}`, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost',
    '--no-first-run', '--no-default-browser-check', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((done, fail) => {
    let text = '';
    chrome.stderr.on('data', chunk => {
      text += chunk;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(text);
      if (m) done(m[1]);
    });
    chrome.on('exit', () => fail(new Error('chromium exited: ' + text)));
  });
  const ws = await throttleCpu(wsUrl);
  const browser = await chromium.connectOverCDP(wsUrl);
  try {
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await context.addInitScript(() => {
      try { localStorage.setItem('geoflora.discover', JSON.stringify({ done: true })); } catch {}
      /** @type {any} */ (window).__longTasks = [];
      new PerformanceObserver(list => { for (const e of list.getEntries()) /** @type {any} */ (window).__longTasks.push(e.duration); })
        .observe({ type: 'longtask', buffered: true });
    });
    await sleep(500);
    Object.assign(counters, { requests: 0, bytes: 0, active: 0, last: performance.now() });
    perFile.clear();
    requestLog = [];
    navigationStart = performance.now();
    linkFree = 0;
    const now = () => page.evaluate(() => performance.now());
    await page.goto(ORIGIN, { waitUntil: 'commit' });

    const search = page.getByRole('combobox', { name: 'Rechercher une plante' });
    await search.waitFor({ state: 'visible', timeout: 120_000 });
    const shell = await now();
    await search.fill('ortie');
    const hit = page.getByRole('link', { name: /^Ortie dioïque/ }).first();
    await hit.waitFor({ state: 'visible', timeout: 300_000 });
    const result = await now();
    const atResult = { requests: counters.requests, bytes: counters.bytes };
    await hit.click();
    await page.locator('gf-plant-detail h1').filter({ hasText: 'Ortie dioïque' }).first().waitFor({ state: 'visible', timeout: 300_000 });
    const sheet = await now();
    const fcp = await page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null);

    let stored = 0;
    for (const end = Date.now() + 300_000; Date.now() < end; await sleep(100)) {
      const done = await page.evaluate(async () => {
        const db = await import('/app/core/db.js');
        const meta = await db.get('meta', 'dataset').catch(() => null);
        if (!meta?.plants) return false;
        // Counted outside db.js's own waiting (a copy being filled is not a copy stored).
        const open = await new Promise((ok, ko) => { const r = indexedDB.open('geoflora'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
        const n = await new Promise(ok => { const r = open.transaction('plants').objectStore('plants').count(); r.onsuccess = () => ok(r.result); });
        open.close();
        return n === meta.plants;
      });
      if (done) { stored = await now(); break; }
    }
    // The network quiet for 3 s (service worker installed, every download done).
    for (const end = Date.now() + 300_000; Date.now() < end; await sleep(250)) {
      if (!counters.active && performance.now() - counters.last > 3000) break;
    }
    const longTasks = await page.evaluate(() => /** @type {number[]} */ (/** @type {any} */ (window).__longTasks));
    const sw = await page.evaluate(() => Boolean(navigator.serviceWorker?.controller) || navigator.serviceWorker?.getRegistration().then(r => Boolean(r?.active)));
    return {
      fcp: Math.round(fcp ?? NaN), shell: Math.round(shell), result: Math.round(result), sheet: Math.round(sheet), stored: Math.round(stored),
      requestsToResult: atResult.requests, kbToResult: Math.round(atResult.bytes / 1024),
      requests: counters.requests, kb: Math.round(counters.bytes / 1024),
      longTasks: longTasks.length, longTotal: Math.round(longTasks.reduce((a, b) => a + b, 0)), longMax: Math.round(Math.max(0, ...longTasks)),
      sw, files: Object.fromEntries([...perFile].filter(([, b]) => b > 50_000).map(([f, b]) => [f, Math.round(b / 1024)]))
    };
  } finally {
    await browser.close().catch(() => {});
    ws.close();
    chrome.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  }
}

const runs = [];
for (let i = 0; i < RUNS; i++) {
  const run = await measure();
  console.log(`run ${i + 1}:`, JSON.stringify(run));
  runs.push(run);
}
const median = (/** @type {number[]} */ values) => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
const KEYS = /** @type {const} */ (['fcp', 'shell', 'result', 'sheet', 'stored', 'requestsToResult', 'kbToResult', 'requests', 'kb', 'longTasks', 'longTotal', 'longMax']);
const summary = Object.fromEntries(KEYS.map(k => [k, median(runs.map(r => r[k]))]));
console.log(`\nmedian of ${RUNS} (network ${DOWN} kbit/s, ${RTT} ms; CPU ×${CPU}):`);
console.table(summary);
if (logOut) writeFileSync(logOut, requestLog.map(r => `${r.start}\t${r.end}\t${r.status}\t${r.bytes}\t${r.path}`).join('\n') + '\n');
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ settings: { DOWN, RTT, CPU, RUNS }, summary, runs }, null, 2));
server.close();
process.exit(0);
