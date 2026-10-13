// The flora offline and its downloads checked (app/core/dataset.js): a first launch without network says so; a device
// with its local copy starts on it; a plants.json that is not the one announced (truncated, another build, altered)
// never replaces the flora. Migrated from audit67/startup*.cjs, update.cjs, off/, persist.cjs.
import { test, expect, fixturePlants } from './fixtures.mjs';
import { readFileSync } from 'node:fs';

const META = JSON.parse(readFileSync(new URL('../fixtures/meta.json', import.meta.url), 'utf8'));
const DATA = /\/data\/(plants|meta)\.json(\?|$)/;
const json = (/** @type {any} */ body) => ({ contentType: 'application/json', body: typeof body === 'string' ? body : JSON.stringify(body) });

test.describe('premier lancement hors ligne', () => {
  test.use({ offlineData: true });

  test('la flore ne se télécharge pas : un message, et « Recharger »', async ({ app, page }) => {
    await page.goto('#/');
    await expect.poll(() => app.state('status')).toBe('error');
    const alert = page.getByRole('alert').filter({ hasText: 'Impossible de télécharger la flore (hors ligne ?)' });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole('button', { name: 'Recharger' })).toBeVisible();
  });
});

test('copie locale : l’app démarre dessus, hors ligne, et le dit sur la liste', async ({ app, page, context }) => {
  await app.open('#/');
  await context.route(DATA, route => route.fulfill({ status: 503, body: '' }));
  await page.reload();
  await app.ready();
  await expect(page.getByText('Hors ligne — recherche sur la copie locale.')).toBeVisible();
  await page.getByRole('combobox', { name: 'Rechercher une plante' }).fill('ail des ours');
  await expect(page.getByRole('link', { name: /^Ail des ours/ })).toBeVisible();
});

test('une mise à jour dont plants.json n’est pas celui annoncé est reportée, la copie locale gardée', async ({ app, page, context }) => {
  await app.open('#/');
  const altered = fixturePlants.slice(0, 120);
  await context.route(DATA, route => /meta/.test(route.request().url())
    ? route.fulfill(json({ ...META, generatedAt: '2026-02-01T00:00:00.000Z', sha256: 'f'.repeat(64), plants: altered.length }))
    : route.fulfill(json(altered)));
  await page.reload();
  await app.ready();
  await expect(page.getByRole('status').filter({ hasText: 'Mise à jour de la flore reportée — recherche sur la copie locale.' })).toBeVisible();
  expect(await page.evaluate(async () => (await import('/app/core/db.js')).count('plants'))).toBe(fixturePlants.length);
  expect(await app.state('results.total')).toBe(fixturePlants.length);
});

test.describe('premier lancement, fichier altéré', () => {
  test('empreinte différente de celle annoncée : refusé', async ({ app, page, context }) => {
    await context.route(DATA, route => /meta/.test(route.request().url())
      ? route.fulfill(json(META))
      : route.fulfill(json(JSON.stringify(fixturePlants.map((/** @type {any} */ p) => ({ ...p, family: 'Altérée' }))))));
    await page.goto('#/');
    await expect.poll(() => app.state('status')).toBe('error');
    await expect(page.getByRole('alert')).toContainText('plants.json ne correspond pas à la version annoncée');
    expect(await page.evaluate(async () => (await import('/app/core/db.js')).count('plants'))).toBe(0);
  });

  test('tronqué (sans empreinte, moins de plantes qu’annoncé) : refusé', async ({ app, page, context }) => {
    const { sha256: _, ...withoutFingerprint } = META;
    await context.route(DATA, route => /meta/.test(route.request().url())
      ? route.fulfill(json(withoutFingerprint))
      : route.fulfill(json(fixturePlants.slice(0, -1))));
    await page.goto('#/');
    await expect.poll(() => app.state('status')).toBe('error');
    await expect(page.getByRole('alert')).toContainText(`plants.json incomplet : ${fixturePlants.length - 1} plantes sur ${fixturePlants.length}`);
  });
});
