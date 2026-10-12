// Smoke test: the app, served as deployed (tools/assemble-site.sh), opens every main screen on a phone (390 px,
// touch) and a desktop (1280 px) without a page error, a CSP violation, a console error, a file of the site that does
// not load, or a screen left empty. No build step links the modules: only a browser shows a broken import (a blank
// screen the service worker would then cache), so this runs on every pull request (ci.yml). Outside requests are
// answered here (images: a blank picture; the rest: 503), so the app's offline and degraded paths are what is
// exercised, never a third-party service. The phone opens the app as a first visit (Découvrir); the desktop as a
// returning one (every tab unlocked: the search and the plant open in Flore).
//   bash tools/assemble-site.sh _site && python3 -m http.server 8000 --directory _site &   node tests/smoke.mjs [http://localhost:8000/]
// Exits 1 with one line per problem.

import { chromium } from 'playwright';

const BASE = new URL(process.argv[2] || 'http://localhost:8000/').href;
const ORIGIN = new URL(BASE).origin;
const ROUTES = ['#/', '#/?q=ortie', '#/plant/128268', '#/discover', '#/discover?s=harvest', '#/discover?s=trail', '#/map', '#/collections', '#/settings'];
const DEVICES = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 900 }, returning: true }
};
const BLANK = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>';
/** The longest the flora may take to load into IndexedDB (11 MB) and be indexed. */
const READY_MS = 90000;

const problems = [];
const ours = (/** @type {string} */ url) => { try { return new URL(url).origin === ORIGIN; } catch { return false; } };
const browser = await chromium.launch();
try {
  for (const [device, { returning, ...options }] of Object.entries(DEVICES)) {
    const context = await browser.newContext({ ...options, serviceWorkers: 'block', locale: 'fr-FR' });
    await context.route(url => new URL(url).origin !== ORIGIN, route =>
      route.request().resourceType() === 'image' ? route.fulfill({ contentType: 'image/svg+xml', body: BLANK }) : route.fulfill({ status: 503, body: '' }));
    await context.addInitScript(returning => {
      // Every CSP violation, as the page sees it (a blocked script, style or request).
      /** @type {any} */ (window).__csp = [];
      addEventListener('securitypolicyviolation', e => /** @type {any} */ (window).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
      // A returning visitor: the discovery done, every tab there.
      if (returning && !localStorage.getItem('geoflora.discover')) localStorage.setItem('geoflora.discover', JSON.stringify({ done: true }));
    }, Boolean(returning));
    const page = await context.newPage();
    let where = 'start';
    page.on('pageerror', e => problems.push(`${device} ${where}: page error: ${e.message.split('\n')[0]}`));
    page.on('console', m => {
      // The answers given above to outside requests (503) are expected; a file of the site's own that fails is not.
      const outside = /Failed to load resource/.test(m.text()) && !ours(m.location().url || '');
      if (m.type() === 'error' && !outside) problems.push(`${device} ${where}: console error: ${m.text().split('\n')[0]} ${m.location().url || ''}`.trim());
    });
    page.on('response', r => { if (ours(r.url()) && r.status() >= 400) problems.push(`${device} ${where}: ${r.status()} ${r.url()}`); });
    page.on('requestfailed', r => { if (ours(r.url()) && !/ERR_ABORTED/.test(r.failure()?.errorText || '')) problems.push(`${device} ${where}: failed ${r.url()} (${r.failure()?.errorText})`); });

    // First visit: the flora is downloaded into IndexedDB; the app must start and get ready (or say why not).
    await page.goto(BASE);
    const started = await page.waitForFunction(() => customElements.get('gf-app') && document.querySelector('gf-app')?.shadowRoot?.childElementCount, null, { timeout: 30000 })
      .then(() => true, () => false);
    if (!started) { problems.push(`${device}: the app did not start (gf-app not rendered: a module failed to load or link?)`); await context.close(); continue; }
    const ready = await page.evaluate(ms => import('./app/core/store.js').then(({ store }) => new Promise(resolve => {
      const check = () => { const { status, statusText } = store.state; if (status !== 'loading') resolve(status === 'ready' || `${status}: ${statusText || ''}`); };
      store.addEventListener('change', check);
      check();
      setTimeout(() => resolve(`still loading after ${ms / 1000} s`), ms);
    })), READY_MS).catch(e => `${e}`.split('\n')[0]);
    if (ready !== true) { problems.push(`${device}: the flora did not get ready (${ready})`); await context.close(); continue; }

    for (const route of ROUTES) {
      where = route;
      await page.goto(BASE + route);
      // The route's view is in place: the last element of <main> is a component, defined, that rendered something —
      // not « Page introuvable », not an unknown (never defined) element, not an empty one.
      const shown = await page.waitForFunction(() => {
        const main = document.querySelector('gf-app')?.shadowRoot?.querySelector('main');
        const view = main?.lastElementChild;
        if (!view) return null;
        if (main.querySelector('.banner.error')) return 'error: ' + main.querySelector('.banner.error')?.textContent?.trim();
        if (!view.localName.includes('-')) return 'not a view: ' + (view.textContent || '').trim().slice(0, 60);
        return customElements.get(view.localName) && view.shadowRoot?.childElementCount ? 'ok' : null;
      }, null, { timeout: 15000 }).then(h => h.jsonValue(), () => 'nothing shown in the main area (an unknown or empty view)');
      if (shown !== 'ok') problems.push(`${device} ${route}: ${shown}`);
      await page.waitForTimeout(1500);
      for (const v of await page.evaluate(() => /** @type {any} */ (window).__csp.splice(0))) problems.push(`${device} ${route}: CSP violation: ${v}`);
    }
    console.log(`${device}: ${ROUTES.length} screens opened`);
    await context.close();
  }
} catch (error) {
  problems.push(`the test itself failed: ${String(error).split('\n')[0]}`);
} finally {
  await browser.close().catch(() => {});
  if (problems.length) {
    for (const p of problems) console.log(`::error::${p}`);
    console.log(`smoke: ${problems.length} problem(s)`);
    process.exitCode = 1;
  } else console.log('smoke: every screen opened, no error');
}
