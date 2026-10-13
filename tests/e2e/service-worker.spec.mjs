// The service worker of the site as deployed (tools/assemble-site.sh: VERSION written from the files it precaches):
// a launch offline, an update to a new build (installed whole, the app offering to reload), a broken build that never
// installs, the photos: stored in CORS across versions, an answer without CORS shown but never stored, and MapLibre
// (sw.js ON_DEMAND): not precached, kept once asked.
// The other specs block the service worker (playwright.config.mjs): these allow it, and serve the sites themselves —
// two builds of the app on one origin (switched by the test), the photos from a second origin, with or without CORS.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { App } from './app.mjs';
import { BLANK_SVG } from './fixtures.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const FIXTURE = new URL('../fixtures/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
// A 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** @param {import('node:http').Server} server @returns {Promise<string>} */
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${/** @type {any} */ (server.address()).port}/`)));
/** The VERSION a build's sw.js carries. @param {string} dir */
const versionOf = dir => /** @type {string} */ (/^const VERSION = '([0-9a-f]{12})';$/m.exec(readFileSync(join(dir, 'sw.js'), 'utf8'))?.[1]);

test.describe.configure({ mode: 'serial' });
// The worker does not depend on the screen: one format is enough.
test.skip(({ isMobile }) => isMobile, 'service worker: desktop only');

/** @type {{ A: string, B: string, broken: string }} */ const builds = /** @type {any} */ ({});
/** The build the site serves. */ let served = '';
let site = '';
let photos = '';
/** The photos' host unreachable (the context's offline mode does not reach the service worker's requests). */
let photosDown = false;
/** The site unreachable, likewise. */
let siteDown = false;
/** @type {import('node:http').Server[]} */ const servers = [];
let work = '';

test.beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'geoflora-sw-'));
  builds.A = join(work, 'A');
  execFileSync('bash', [join(ROOT, 'tools/assemble-site.sh'), builds.A]);
  // B: one precached file changed — a new version. broken: changed too, and a precached file missing.
  for (const [name, change] of /** @type {const} */ ([['B', '// build B\n'], ['broken', '// build broken\n']])) {
    builds[name] = join(work, name);
    cpSync(builds.A, builds[name], { recursive: true });
    appendFileSync(join(builds[name], 'app/config.js'), change);
    execFileSync('node', [join(ROOT, 'tools/stamp-sw.mjs'), builds[name]]);
  }
  rmSync(join(builds.broken, 'app/core/icons.js'));
});

test.beforeAll(async () => {
  // The site: the build of `served`, the reduced flora of the other specs.
  const app = createServer((req, res) => {
    if (siteDown) { req.socket.destroy(); return; }
    const path = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.includes('..') ? '' : /^data\/(plants|meta)\.json$/.test(path) ? join(FIXTURE, path.slice(5)) : join(served, path);
    try {
      const body = readFileSync(file);
      res.writeHead(200, { 'Content-Type': TYPES[/** @type {keyof typeof TYPES} */ (extname(file))] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  // The photos: /cors/… with Access-Control-Allow-Origin, /plain/… without.
  const images = createServer((req, res) => {
    if (photosDown) { req.socket.destroy(); return; }
    const cors = (req.url || '').startsWith('/cors/');
    // no-store: offline, only the worker's cache can show a photo again (not the browser's HTTP cache).
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', ...(cors ? { 'Access-Control-Allow-Origin': '*' } : {}) });
    res.end(PNG);
  });
  servers.push(app, images);
  [site, photos] = await Promise.all([listen(app), listen(images)]);
});

test.afterAll(async () => {
  await Promise.all(servers.map(s => new Promise(resolve => s.close(resolve))));
  if (work) rmSync(work, { recursive: true, force: true });
});

test.beforeEach(() => { served = builds.A; photosDown = false; siteDown = false; });

/** A context where service workers run; outside services answered as in the other specs, the photos' server reached. */
async function open(/** @type {import('@playwright/test').Browser} */ browser) {
  const context = await browser.newContext({ serviceWorkers: 'allow', locale: 'fr-FR', viewport: { width: 1280, height: 900 } });
  // As fixtures.mjs's prepare(), but the photos' server and the flora reached for real (no route: offline, a route
  // would still answer).
  const ours = [new URL(site).origin, new URL(photos).origin];
  await context.route(url => !ours.includes(url.origin), route =>
    route.request().resourceType() === 'image' ? route.fulfill({ contentType: 'image/svg+xml', body: BLANK_SVG }) : route.fulfill({ status: 503, body: '' }));
  await context.addInitScript(() => localStorage.setItem('geoflora.discover', JSON.stringify({ done: true })));
  const page = await context.newPage();
  /** @type {string[]} */ const errors = [];
  page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
  const app = new App(page);
  await page.goto(site);
  await app.ready();
  // The first visit installs the worker, which takes the page over (clients.claim).
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  return { context, page, app, errors };
}

/** The width of a photo loaded by a plain <img>, as the app's (no crossorigin attribute); 0 when it fails. @param {import('@playwright/test').Page} page @param {string} src */
const shown = (page, src) => page.evaluate(s => new Promise(resolve => Object.assign(new Image(), {
  referrerPolicy: 'no-referrer', onload: (/** @type {any} */ e) => resolve(e.target.naturalWidth), onerror: () => resolve(0), src: s
})), src);
/** @param {import('@playwright/test').Page} page */
const cacheNames = page => page.evaluate(() => caches.keys());
/** The text of a file as the page gets it (through the worker). @param {import('@playwright/test').Page} page @param {string} path */
const fetched = (page, path) => page.evaluate(p => fetch(p).then(r => r.text()), path);
/** Asks the browser to look for a new sw.js now (it does so at each launch and when the app comes back to the foreground). */
const checkForUpdate = (/** @type {import('@playwright/test').Page} */ page) => page.evaluate(() =>
  navigator.serviceWorker.getRegistration().then(r => r?.update()).then(() => true, () => false));

test('hors ligne : l’app se relance depuis le cache de sa version', async ({ browser }) => {
  const { context, page, app, errors } = await open(browser);
  expect(await cacheNames(page)).toContain(`geoflora-shell-${versionOf(builds.A)}`);
  await context.setOffline(true);
  siteDown = true;
  await page.reload();
  await app.ready();
  expect(await app.state('offline')).toBe(true);
  await page.getByRole('combobox', { name: 'Rechercher une plante' }).fill('ortie');
  await expect(page.getByRole('link', { name: /^Ortie/ }).first()).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

test('mise à jour : la nouvelle version s’installe en entier, l’app propose de recharger, les photos restent', async ({ browser }) => {
  const { context, page, errors } = await open(browser);
  const [A, B] = [versionOf(builds.A), versionOf(builds.B)];
  expect(A).not.toBe(B);
  // A photo kept, and a cache of photos named after a version (before they were kept across versions).
  const photo = `${photos}cors/kept.png`;
  expect(await shown(page, photo)).toBe(1);
  await expect.poll(() => page.evaluate(src => caches.open('geoflora-images').then(c => c.match(src)).then(Boolean), photo)).toBe(true);
  await page.evaluate(() => caches.open('geoflora-images-v105').then(c => c.put('/old', new Response('x'))));

  served = builds.B;
  // Until the new worker takes over, the running version is served whole from its cache, not the new files.
  // (Twice: a stale-while-revalidate would have the second answer from the network.)
  expect(await fetched(page, 'app/config.js')).not.toContain('// build B');
  await page.waitForTimeout(500);
  expect(await fetched(page, 'app/config.js')).not.toContain('// build B');
  await checkForUpdate(page);
  await expect(page.getByRole('status').filter({ hasText: 'Nouvelle version de GeoFlora disponible.' })).toBeVisible();
  // Once activated: the previous shell gone, and the photos named after a version; the photos kept.
  await expect.poll(async () => (await cacheNames(page)).filter(n => n !== 'geoflora-tiles').sort()).toEqual(['geoflora-images', `geoflora-shell-${B}`]);
  expect(await page.evaluate(src => caches.open('geoflora-images').then(c => c.match(src)).then(Boolean), photo), 'photos kept across versions').toBe(true);

  await page.getByRole('button', { name: 'Recharger' }).click();
  await new App(page).ready();
  expect(await fetched(page, 'app/config.js')).toContain('// build B');
  expect(errors).toEqual([]);
  await context.close();
});

test('une version incomplète ne s’installe pas : l’app garde la sienne, entière', async ({ browser }) => {
  const { context, page, errors } = await open(browser);
  served = builds.broken;
  await checkForUpdate(page);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => Boolean(r && !r.installing && !r.waiting)))).toBe(true);
  const names = await cacheNames(page);
  expect(names).toContain(`geoflora-shell-${versionOf(builds.A)}`);
  expect(names, 'no partial cache left').not.toContain(`geoflora-shell-${versionOf(builds.broken)}`);
  expect(await fetched(page, 'app/config.js')).not.toContain('// build broken');
  await page.reload();
  await new App(page).ready();
  await expect(page.getByText('Nouvelle version de GeoFlora disponible.')).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});

test('photos : gardées en CORS ; sans CORS, affichées mais jamais gardées (une réponse opaque pèse ~7 Mo de quota)', async ({ browser }) => {
  const { context, page, errors } = await open(browser);
  const withCors = `${photos}cors/a.png`;
  const without = `${photos}plain/b.png`;
  // Plain <img>, as the app's: no crossorigin attribute.
  for (const src of [withCors, without]) expect(await shown(page, src), `${src} shown`).toBe(1);
  const stored = () => page.evaluate(async () => {
    const cache = await caches.open('geoflora-images');
    return Promise.all((await cache.keys()).map(async k => [k.url, (await cache.match(k))?.type]));
  });
  await expect.poll(stored).toEqual([[withCors, 'cors']]);
  // Its host unreachable, in a new page (no memory cache): the photo kept still shows, the other one is gone.
  photosDown = true;
  await page.reload();
  await new App(page).ready();
  expect(await shown(page, withCors), 'stored photo, offline').toBe(1);
  expect(await shown(page, without), 'photo without CORS, offline').toBe(0);
  expect(errors).toEqual([]);
  await context.close();
});

test('MapLibre (ON_DEMAND) : pas précaché, gardé dans le cache de la version à sa première demande, servi hors ligne', async ({ browser }) => {
  const { context, page, errors } = await open(browser);
  const shell = `geoflora-shell-${versionOf(builds.A)}`;
  const kept = () => page.evaluate(async name => (await (await caches.open(name)).keys()).map(k => new URL(k.url).pathname).filter(p => p.includes('/vendor/maplibre/')), shell);
  // Installed without it: the app's 1.6 MB lighter.
  expect(await kept()).toEqual([]);
  // Asked as MapLibre asks for its worker (with ?v=…): kept under its address without the query.
  const worker = await fetched(page, 'vendor/maplibre/maplibre-gl-worker.mjs?v=6.13.0');
  expect(worker).toContain('MapLibre GL JS');
  await expect.poll(kept).toEqual(['/vendor/maplibre/maplibre-gl-worker.mjs']);
  // The site out of reach: served from that cache, whatever the query.
  siteDown = true;
  await context.setOffline(true);
  expect(await fetched(page, 'vendor/maplibre/maplibre-gl-worker.mjs?v=6.13.0')).toBe(worker);
  expect(await fetched(page, 'vendor/maplibre/maplibre-gl-worker.mjs')).toBe(worker);
  expect(errors).toEqual([]);
  await context.close();
});
