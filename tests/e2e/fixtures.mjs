// What every spec starts from (import { test, expect } from './fixtures.mjs'):
//  - the network: every request outside the app's own server answered here (pictures: a small blank image; the rest
//    503), so the app's offline and degraded paths run, never a real service; a spec answers some services itself
//    with ctx.route / page.route (registered later, so tried first) and route.fallback() for the rest;
//  - the flora: data/plants.json and data/meta.json served from tests/fixtures (300 plants, fingerprint matching),
//    unless the spec sets `realData: true`;
//  - the visitor: returning (Découvrir done, every tab there) by default, `firstVisit: true` for a first launch;
//  - no uncaught page error: any one fails the test after it ran.
import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const FIXTURE = new URL('../fixtures/', import.meta.url);
const PLANTS = readFileSync(new URL('plants.json', FIXTURE));
const META = readFileSync(new URL('meta.json', FIXTURE));
export const fixturePlants = JSON.parse(PLANTS.toString('utf8'));
export const BLANK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#7fae6b"/></svg>';

/** The id of a plant of the reduced flora, by its scientific name (never a TAXREF id written in a spec). @param {string} name */
export function plantId(name) {
  const p = fixturePlants.find((/** @type {any} */ x) => x.scientificName === name);
  if (!p) throw new Error(`${name}: not in tests/fixtures/plants.json`);
  return /** @type {number} */ (p.id);
}

/**
 * Prepares a browser context as every spec expects it (see above): outside requests answered, the reduced flora
 * served, the visitor returning unless asked.
 * @param {import('@playwright/test').BrowserContext} context
 * @param {{ baseURL: string, realData?: boolean, firstVisit?: boolean, offlineData?: boolean }} options
 */
export async function prepare(context, { baseURL, realData = false, firstVisit = false, offlineData = false }) {
  const origin = new URL(baseURL).origin;
  await context.route(url => url.origin !== origin, route =>
    route.request().resourceType() === 'image'
      ? route.fulfill({ contentType: 'image/svg+xml', body: BLANK_SVG })
      : route.fulfill({ status: 503, body: '' }));
  if (offlineData) await context.route(/\/data\/(plants|meta)\.json(\?|$)/, route => route.fulfill({ status: 503, body: '' }));
  else if (!realData) {
    await context.route(/\/data\/plants\.json(\?|$)/, route => route.fulfill({ contentType: 'application/json', body: PLANTS }));
    await context.route(/\/data\/meta\.json(\?|$)/, route => route.fulfill({ contentType: 'application/json', body: META }));
  }
  if (!firstVisit) {
    await context.addInitScript(() => {
      if (!localStorage.getItem('geoflora.discover')) localStorage.setItem('geoflora.discover', JSON.stringify({ done: true }));
    });
  }
}

/**
 * @typedef {{ realData: boolean, firstVisit: boolean, offlineData: boolean }} Options
 * @typedef {{ pageErrors: string[], app: import('./app.mjs').App, newDevice: () => Promise<{ page: import('@playwright/test').Page, app: import('./app.mjs').App }> }} Fixtures
 */
export const test = base.extend(/** @type {any} */ ({
  realData: [false, { option: true }],
  firstVisit: [false, { option: true }],
  /** The data files answer 503 (and nothing else on the server changes): a first launch offline. */
  offlineData: [false, { option: true }],

  context: async ({ context, baseURL, realData, firstVisit, offlineData }, /** @type {any} */ use) => {
    await prepare(context, { baseURL, realData, firstVisit, offlineData });
    await use(context);
  },

  pageErrors: async ({ page }, /** @type {any} */ use) => {
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
    await use(errors);
    expect(errors, 'no uncaught error in the page').toEqual([]);
  },

  app: async ({ page, pageErrors }, /** @type {any} */ use) => {
    const { App } = await import('./app.mjs');
    void pageErrors;
    await use(new App(page));
  },

  /** Another device: a fresh context (its own IndexedDB and storage), prepared the same way, closed after the test. */
  newDevice: async ({ browser, baseURL, viewport, isMobile, hasTouch, locale, timezoneId, geolocation, permissions, serviceWorkers }, /** @type {any} */ use) => {
    const { App } = await import('./app.mjs');
    /** @type {import('@playwright/test').BrowserContext[]} */
    const opened = [];
    /** @type {string[]} */
    const errors = [];
    await use(async () => {
      const context = await browser.newContext({ baseURL, viewport, isMobile, hasTouch, locale, timezoneId, geolocation, permissions, serviceWorkers });
      opened.push(context);
      await prepare(context, { baseURL });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
      return { page, app: new App(page) };
    });
    await Promise.all(opened.map(c => c.close()));
    expect(errors, 'no uncaught error in the other device').toEqual([]);
  }
}));

export { expect };
