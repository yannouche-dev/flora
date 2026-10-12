// Smoke test: the app, served as deployed, opens every main screen on a phone (390 px, touch) and a desktop
// (1280 px) without a page error, a CSP violation, a console error or a module that fails to link. No build step
// links the modules: only a browser shows a broken import (a blank screen the service worker would then cache),
// so this runs on every pull request (ci.yml). Outside requests are answered here (images: a blank picture; the
// rest: 503), so the app's offline and degraded paths are what is exercised, never a third-party service.
//   python3 -m http.server 8000 &   node tests/smoke.mjs [http://localhost:8000/]
// Exits 1 with one line per problem.

import { chromium } from 'playwright';

const BASE = new URL(process.argv[2] || 'http://localhost:8000/').href;
const ROUTES = ['#/', '#/?q=ortie', '#/plant/128268', '#/discover', '#/discover?s=harvest', '#/discover?s=trail', '#/map', '#/collections', '#/settings'];
const DEVICES = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 900 } }
};
const BLANK = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>';

const problems = [];
const browser = await chromium.launch();
try {
  for (const [device, options] of Object.entries(DEVICES)) {
    const context = await browser.newContext({ ...options, serviceWorkers: 'block', locale: 'fr-FR' });
    await context.route(url => new URL(url).origin !== new URL(BASE).origin, route =>
      route.request().resourceType() === 'image' ? route.fulfill({ contentType: 'image/svg+xml', body: BLANK }) : route.fulfill({ status: 503, body: '' }));
    // Every CSP violation, as the page sees it (a blocked script, style or request).
    await context.addInitScript(() => {
      /** @type {any} */ (window).__csp = [];
      addEventListener('securitypolicyviolation', e => /** @type {any} */ (window).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    const page = await context.newPage();
    let where = 'start';
    page.on('pageerror', e => problems.push(`${device} ${where}: page error: ${e.message.split('\n')[0]}`));
    page.on('console', m => {
      // The answers given above to outside requests (503) are expected; anything else logged as an error is not.
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`${device} ${where}: console error: ${m.text().split('\n')[0]}`);
    });

    // First visit: the flora is downloaded into IndexedDB; the app must start and get ready.
    await page.goto(BASE);
    const started = await page.waitForFunction(() => customElements.get('gf-app') && document.querySelector('gf-app')?.shadowRoot?.childElementCount, null, { timeout: 30000 })
      .then(() => true, () => false);
    if (!started) { problems.push(`${device}: the app did not start (gf-app not rendered: a module failed to load or link?)`); await context.close(); continue; }
    const ready = await page.evaluate(() => import('./app/core/store.js').then(m => m.whenReady()).then(() => true), null).catch(e => `${e}`);
    if (ready !== true) problems.push(`${device}: the flora did not get ready (${ready})`);

    for (const route of ROUTES) {
      where = route;
      await page.goto(BASE + route);
      const shown = await page.waitForFunction(() => {
        const root = document.querySelector('gf-app')?.shadowRoot;
        // The route's view is in place: something rendered in the main area.
        return root && root.querySelector('main')?.childElementCount;
      }, null, { timeout: 15000 }).then(() => true, () => false);
      if (!shown) problems.push(`${device} ${route}: nothing shown in the main area`);
      await page.waitForTimeout(1500);
      for (const v of await page.evaluate(() => /** @type {any} */ (window).__csp.splice(0))) problems.push(`${device} ${route}: CSP violation: ${v}`);
    }
    console.log(`${device}: ${ROUTES.length} screens opened`);
    await context.close();
  }
} finally {
  await browser.close();
}

if (problems.length) {
  for (const p of problems) console.log(`::error::${p}`);
  console.log(`smoke: ${problems.length} problem(s)`);
  process.exitCode = 1;
} else console.log('smoke: every screen opened, no error');
