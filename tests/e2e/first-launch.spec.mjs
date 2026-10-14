// The fast first launch (app/workers/flora-pack.js, tools/pack-flora.mjs, core/dataset.js): with the flora packed as
// a deploy publishes it (data/meta.json listing an index and the details), the search works as soon as the index has
// come — the details held back here — the list says quietly that the flora is still being stored, a plant opened
// meanwhile shows once its record comes, and the app then reaches the whole flora in IndexedDB, plants.json never
// downloaded. A pack that fails its fingerprint is never used: plants.json instead, checked as before.
import { test, expect, fixturePlants } from './fixtures.mjs';
import { readFileSync } from 'node:fs';
import { packFiles } from '../../tools/pack-flora.mjs';

const META = JSON.parse(readFileSync(new URL('../fixtures/meta.json', import.meta.url), 'utf8'));
const FILES = packFiles(fixturePlants);
const PACKED_META = {
  ...META,
  files: { format: 1, ...Object.fromEntries(Object.entries(FILES).map(([name, { path, sha256, bytes }]) => [name, { path, sha256, bytes }])) }
};
const json = (/** @type {string} */ body) => ({ contentType: 'application/json', body });

/** Plants in IndexedDB, counted without the app's waiting (db.js). @param {import('@playwright/test').Page} page */
const storedCount = page => page.evaluate(() => new Promise(resolve => {
  const open = indexedDB.open('geoflora');
  open.onsuccess = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains('plants')) { db.close(); resolve(0); return; }
    const count = db.transaction('plants').objectStore('plants').count();
    count.onsuccess = () => { db.close(); resolve(count.result); };
  };
  open.onerror = () => resolve(-1);
}));

/**
 * The site as deployed: meta.json listing the pack, the index served; the details answered by `details` (held back,
 * broken…). Returns how many times plants.json was asked.
 * @param {import('@playwright/test').BrowserContext} context @param {(route: import('@playwright/test').Route) => Promise<void>} details
 */
async function deployed(context, details) {
  const asked = { plants: 0 };
  await context.route(/\/data\/plants\.json(\?|$)/, route => { asked.plants++; return route.fallback(); });
  await context.route(/\/data\/meta\.json(\?|$)/, route => route.fulfill(json(JSON.stringify(PACKED_META))));
  await context.route(/\/data\/flora\/index\.[0-9a-f]{12}\.json$/, route => route.fulfill(json(FILES.index.text)));
  await context.route(/\/data\/flora\/details\.[0-9a-f]{12}\.json$/, details);
  return asked;
}

test('la recherche marche avant que la flore soit enregistrée, puis l’app a toute la flore', async ({ app, page, context }) => {
  /** @type {() => void} */
  let release = () => {};
  const held = new Promise(resolve => { release = () => resolve(undefined); });
  const asked = await deployed(context, async route => { await held; await route.fulfill(json(FILES.details.text)); });

  await page.goto('#/');
  await expect.poll(() => app.state('status'), { timeout: 30_000 }).toBe('ready');
  expect(await app.state('floraStoring')).toBe(true);
  await expect(page.getByText('· mise hors ligne…').first()).toBeVisible();
  await expect(page.locator('gf-results-bar .count').first()).toContainText(`${fixturePlants.length} espèces`);
  await page.getByRole('combobox', { name: 'Rechercher une plante' }).fill('ortie');
  const ortie = page.getByRole('link', { name: /^Ortie dioïque/ });
  await expect(ortie).toBeVisible();
  expect(await storedCount(page), 'nothing stored yet').toBe(0);

  // A plant opened now shows once its record has come (the worker holds it before IndexedDB does).
  await ortie.click();
  release();
  await expect(page.locator('gf-plant-detail h1').filter({ hasText: 'Ortie dioïque' }).first()).toBeVisible();

  await expect.poll(() => app.state('floraStoring'), { timeout: 30_000 }).toBe(false);
  expect(await storedCount(page)).toBe(fixturePlants.length);
  expect(await page.evaluate(async () => (await import('/app/core/db.js')).count('plants'))).toBe(fixturePlants.length);
  // The record stored is the one of plants.json, whole (its INPN statuses: not in the index).
  const withStatuses = fixturePlants.find((/** @type {any} */ p) => p.statuses?.length);
  expect(await page.evaluate(async id => (await import('/app/core/db.js')).get('plants', id), withStatuses.id)).toEqual(withStatuses);
  expect(await page.evaluate(async () => (await import('/app/core/db.js')).get('meta', 'dataset').then(m => m.sha256))).toBe(META.sha256);
  await expect(page.getByText('· mise hors ligne…')).toHaveCount(0);
  expect(asked.plants, 'plants.json never downloaded').toBe(0);

  // Then a launch on the local copy, the network gone for the flora.
  await context.route(/\/data\//, route => route.fulfill({ status: 503, body: '' }));
  await page.goto('#/?q=ortie');
  await app.ready();
  await expect(page.getByRole('link', { name: /^Ortie dioïque/ })).toBeVisible();
});

test('des détails qui ne sont pas ceux annoncés : refusés, plants.json à la place', async ({ app, page, context }) => {
  const altered = JSON.parse(FILES.details.text);
  altered.rows[0][1].links = { taxref: 'https://example.org/' };
  const asked = await deployed(context, route => route.fulfill(json(JSON.stringify(altered))));
  await page.goto('#/');
  await app.ready();
  expect(asked.plants).toBe(1);
  expect(await storedCount(page)).toBe(fixturePlants.length);
  const first = fixturePlants[0];
  expect((await page.evaluate(async id => (await import('/app/core/db.js')).get('plants', id), first.id)).links).toEqual(first.links);
});

test('un index qui ne correspond pas : la flore vient de plants.json, vérifiée', async ({ app, page, context }) => {
  const asked = await deployed(context, route => route.fulfill(json(FILES.details.text)));
  await context.route(/\/data\/flora\/index\.[0-9a-f]{12}\.json$/, route => route.fulfill(json(FILES.index.text.replace('Urtica', 'Urtika'))));
  await page.goto('#/?q=ortie');
  await app.ready();
  await expect(page.getByRole('link', { name: /^Ortie dioïque/ })).toBeVisible();
  expect(asked.plants).toBe(1);
  expect(await storedCount(page)).toBe(fixturePlants.length);
});
