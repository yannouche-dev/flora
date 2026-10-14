// The photos of the map's points, as the deployed site shows them: through its service worker (the other specs block
// it). Rencontres' step « map » then « cards »: every point with a photo in view shows it (loaded, faded in) within
// 5 s — at first, after three distances in a row (the photos of the points gone no longer hold the hosts' few
// connections: the worker's requests are not stopped with the page's images), after the step « cards », after a
// reload; the common plant (15 points, one photo address: one failure would take all of them) shown on each; a host
// without CORS, one refusing CORS requests (403), and a moment's failure of a CORS request all still give a photo.
// The site assembled as deployed (tools/assemble-site.sh), the photos from three hosts of their own, each a little
// slow (100–500 ms), over HTTP/1.1 (six connections a host).
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
const NAMES = ['Urtica dioica', 'Allium ursinum', 'Conium maculatum', 'Geum urbanum', 'Taraxacum officinale', 'Quercus robur',
  'Hedera helix', 'Galium aparine', 'Plantago lanceolata', 'Bellis perennis', 'Ranunculus acris', 'Trifolium repens'];

/** @param {import('node:http').Server} server @returns {Promise<string>} */
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${/** @type {any} */ (server.address()).port}/`)));
/** A latency of 100–500 ms, the same for an address each time. @param {string} s */
const latency = s => 100 + [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 401, 7);

test.describe.configure({ mode: 'serial' });
test.skip(({ isMobile }) => isMobile, 'service worker: desktop only');

let work = '', site = '';
/** The photos' hosts: CORS allowed; without CORS; answering CORS requests 403 (readable), plain ones 200. */
const hosts = { cors: '', plain: '', refusing: '' };
/** @type {import('node:http').Server[]} */ const servers = [];
/** The addresses whose first CORS request fails (503, readable): a moment's failure. */
const failedOnce = new Set();

test.beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'geoflora-photos-'));
  const build = join(work, 'site');
  execFileSync('bash', [join(ROOT, 'tools/assemble-site.sh'), build]);
  const app = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.includes('..') ? '' : /^data\/(plants|meta)\.json$/.test(path) ? join(FIXTURE, path.slice(5)) : join(build, path);
    try {
      const body = readFileSync(file);
      res.writeHead(200, { 'Content-Type': TYPES[/** @type {keyof typeof TYPES} */ (extname(file))] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  /** @param {'cors' | 'plain' | 'refusing'} kind */
  const photos = kind => createServer((req, res) => {
    const url = req.url || '/', cors = req.headers['sec-fetch-mode'] === 'cors';
    setTimeout(() => {
      if (kind === 'refusing' && cors) { res.writeHead(403, { 'Content-Type': 'application/xml', 'Access-Control-Allow-Origin': '*' }); res.end('<Error><Code>AccessDenied</Code></Error>'); return; }
      if (kind === 'cors' && cors && url.startsWith('/flaky/') && !failedOnce.has(url)) {
        failedOnce.add(url);
        res.writeHead(503, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
        res.end('SlowDown');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600', ...(kind === 'cors' ? { 'Access-Control-Allow-Origin': '*' } : {}) });
      res.end(PNG);
    }, latency(url));
  });
  const all = [app, photos('cors'), photos('plain'), photos('refusing')];
  servers.push(...all);
  [site, hosts.cors, hosts.plain, hosts.refusing] = await Promise.all(all.map(listen));
});

test.afterAll(async () => {
  await Promise.all(servers.map(s => new Promise(resolve => s.close(resolve))));
  if (work) rmSync(work, { recursive: true, force: true });
});

/** The common plant's photo: the taxon's, one address for all its points (its first CORS request fails once). */
const common = () => `${hosts.cors}flaky/photos/999/square.jpg`;

/**
 * iNaturalist's observations in the circle: 45 points, each distance its own; the first 15 the common plant's (no
 * photo but the taxon's), the others each its own taxon and photo, from one host or another in turn.
 * @param {number} radius
 */
function observations(radius) {
  const seed = Math.round(radius * 10);
  const lic = { license_code: 'cc-by', attribution: '(c) Anne' };
  return Array.from({ length: 45 }, (_, i) => {
    // The common plant's points near the middle (all in view at any step), the others out to the edge.
    const a = i * 2.39996, d = (i < 15 ? 0.1 + 0.4 * i / 15 : 0.15 + 0.7 * ((i * 37) % 45) / 45) * radius / 111.32;
    const id = seed * 1000 + i, mine = i >= 15;
    const host = [hosts.cors, hosts.plain, hosts.refusing][i % 3];
    return {
      id, observed_on: '2026-05-01', geojson: { coordinates: [2.35 + Math.cos(a) * d / 0.658, 48.85 + Math.sin(a) * d] },
      // The plant's photo, its taxon's (a point never shows the observation's own): the others' each its own taxon.
      taxon: mine ? { id: 2000 + i, name: NAMES[1 + (i % 11)], preferred_common_name: null, default_photo: { square_url: `${host}photos/${id}/square.jpg`, ...lic } }
        : { id: 1000, name: 'Urtica dioica', preferred_common_name: 'Ortie', default_photo: { square_url: common(), ...lic } },
      photos: []
    };
  });
}

/** A context where the service worker runs; iNaturalist and the rest answered here, the photos' hosts reached. @param {import('@playwright/test').Browser} browser */
async function open(browser) {
  const context = await browser.newContext({ serviceWorkers: 'allow', locale: 'fr-FR', viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference',
    geolocation: { latitude: 48.85, longitude: 2.35, accuracy: 8 }, permissions: ['geolocation'] });
  const ours = [site, ...Object.values(hosts)].map(u => new URL(u).origin);
  await context.route(url => !ours.includes(url.origin), async route => {
    const url = new URL(route.request().url());
    /** @param {any} body */
    const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (url.host === 'api.inaturalist.org' && /species_counts/.test(url.pathname)) {
      return json({ results: NAMES.map((name, i) => ({ count: 80 - i, taxon: { id: 1000 + i, name, preferred_common_name: null,
        default_photo: { square_url: `https://inaturalist-open-data.s3.amazonaws.com/photos/${i}/square.jpg`, license_code: 'cc-by', attribution: '(c) A' } } })) });
    }
    if (url.host === 'api.inaturalist.org' && url.pathname === '/v1/observations') {
      if (url.searchParams.get('taxon_id')) return json({ total_results: 0, results: [] });
      await new Promise(done => setTimeout(done, 300));
      const results = observations(Number(url.searchParams.get('radius')) || 1);
      return json({ total_results: results.length, results }).catch(() => {});
    }
    if (url.host === 'www.wikidata.org' && url.searchParams.get('action') === 'wbgetentities') {
      const ids = url.searchParams.get('ids') || '';
      return json({ entities: { [ids]: { claims: {}, sitelinks: { frwiki: { title: 'Plante ' + ids } }, aliases: { fr: [] } } } });
    }
    if (url.host === 'fr.wikipedia.org') return json({ query: { pages: [{ title: 'Plante', extract: 'Une plante.', description: 'espèce de plantes', touched: '2026-09-01T10:00:00Z' }] } });
    return route.request().resourceType() === 'image' ? route.fulfill({ contentType: 'image/svg+xml', body: BLANK_SVG }) : route.fulfill({ status: 503, body: '' });
  });
  await context.addInitScript(() => localStorage.setItem('geoflora.discover', JSON.stringify({ done: true })));
  const page = await context.newPage();
  /** @type {string[]} */ const errors = [];
  page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
  const app = new App(page);
  await page.goto(site + '#/app/rencontres');
  await app.ready();
  // The first visit installs the worker, which takes the page over: from then on, every photo goes through it.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.reload();
  await app.ready();
  return { context, page, app, errors };
}

/**
 * The points with a photo in the map's view: how many, those whose photo shows (loaded, faded in), those of the
 * common plant and those of them shown. @param {import('@playwright/test').Page} page
 */
const photos = page => page.locator('ma-distance').evaluate(host => {
  const root = /** @type {ShadowRoot} */ (host.shadowRoot);
  const box = /** @type {Element} */ (root.querySelector('.leaflet-container')).getBoundingClientRect();
  const out = { points: 0, shown: 0, common: 0, commonShown: 0 };
  for (const el of root.querySelectorAll('.leaflet-marker-pane .gf-obs-photo:not(.gf-leave)')) {
    const r = el.getBoundingClientRect();
    if (r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom) continue;
    const img = el.querySelector('img');
    const isCommon = Boolean(img?.dataset.src?.includes('/photos/999/'));
    const shown = Boolean(img && img.getAttribute('src') && img.complete && img.naturalWidth > 0 && img.classList.contains('in') && getComputedStyle(img).visibility !== 'hidden');
    out.points++;
    if (shown) out.shown++;
    if (isCommon) { out.common++; if (shown) out.commonShown++; }
  }
  return out;
});

/** Every point in view shows its photo within 5 s, the common plant's 15 among them. @param {import('@playwright/test').Page} page @param {string} when */
async function allShown(page, when) {
  await expect.poll(async () => {
    const p = await photos(page);
    return p.points >= 30 && p.shown === p.points && p.common === 15 && p.commonShown === 15 ? 'all' : JSON.stringify(p);
  }, { message: `photos shown (${when})`, timeout: 5000, intervals: [250] }).toBe('all');
}

test('les photos des points : toutes affichées en 5 s, d’une distance à l’autre, à l’étape des cartes, après rechargement — par le service worker', async ({ browser }) => {
  const { context, page, errors } = await open(browser);
  await page.getByRole('button', { name: 'Autour de moi' }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/app/rencontres/map');
  // How many: said by the map's live region (the quiet-map rule: never written over the map).
  await expect(page.locator('ma-distance gf-map .gf-map-live')).toContainText('observations de plantes');
  await allShown(page, 'first load');

  const slider = page.locator('ma-distance input[type="range"]');
  await slider.focus();
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(700);
  }
  await expect(page.locator('ma-distance .welcome')).toHaveAttribute('aria-busy', 'false', { timeout: 5000 });
  await expect(page.locator('ma-distance gf-map .gf-map-live')).toContainText('observations de plantes');
  await allShown(page, 'after 3 distances');

  await page.locator('ma-distance').getByRole('button', { name: 'Qui pousse par ici ?' }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/app/rencontres/cards');
  await allShown(page, 'step « cards »');

  await page.reload();
  await new App(page).ready();
  await expect(page.locator('ma-distance .leaflet-marker-pane .gf-obs-photo').first()).toBeAttached();
  await allShown(page, 'after a reload');
  expect(errors).toEqual([]);
  await context.close();
});
