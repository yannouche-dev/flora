// Flore: the search, its address, the filters and the favourites from the list. Migrated from flora.cjs,
// samesearch.cjs, audit67/filters.cjs, favscroll.cjs, plantnav.cjs.
import { test, expect, fixturePlants, plantId } from './fixtures.mjs';

const count = (/** @type {(p: any) => boolean} */ keep) => fixturePlants.filter(keep).length;

test('« ortie » : la grande ortie d’abord, la recherche dans l’adresse et gardée au rechargement', async ({ app, page }) => {
  await app.open('#/');
  await expect(page.getByText(`${fixturePlants.length} espèces`, { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Rechercher une plante' }).fill('ortie');
  const ortie = page.getByRole('link', { name: /^Ortie dioïque/ });
  await expect(ortie).toHaveAttribute('href', `#/plant/${plantId('Urtica dioica')}`);
  const urtica = count(p => p.genus === 'Urtica');
  await expect(page.getByText(`${urtica} espèces`, { exact: true })).toBeVisible();
  // Names starting with the words typed first: the nettles, in French alphabetical order.
  expect((await app.state('results.items')).slice(0, 3).map((/** @type {any} */ p) => p.genus)).toEqual(['Urtica', 'Urtica', 'Urtica']);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/?q=ortie');
  await page.reload();
  await app.ready();
  await expect(page.getByRole('combobox', { name: 'Rechercher une plante' })).toHaveValue('ortie');
  await expect(page.getByRole('link', { name: /^Ortie dioïque/ })).toBeVisible();
});

test('une faute de frappe trouve quand même (« pisenlit »)', async ({ app, page }) => {
  await app.open('#/?q=pisenlit');
  await expect(page.getByText('Aucun résultat exact pour « pisenlit » : résultats approchants.')).toBeVisible();
  await expect(page.getByRole('link', { name: /^Pissenlit / }).first()).toBeVisible();
  expect(await app.state('results.fuzzy')).toBeGreaterThan(0);
  expect((await app.state('results.items')).map((/** @type {any} */ p) => p.id)).toContain(plantId('Taraxacum officinale'));
});

test('filtres dans l’adresse : famille et photo, comptes exacts, effacés d’un geste', async ({ app, page }) => {
  const urticaceae = count(p => p.family === 'Urticaceae');
  await app.open('#/?family=Urticaceae');
  await expect(page.getByText(`${urticaceae} espèce${urticaceae > 1 ? 's' : ''}`, { exact: true })).toBeVisible();
  expect(await app.state('query.filters.family')).toEqual(['Urticaceae']);
  await app.go('#/?family=Urticaceae,Rosaceae&photo=avec');
  const both = count(p => ['Urticaceae', 'Rosaceae'].includes(p.family) && p.thumbnail?.url);
  await expect.poll(() => app.state('results.total')).toBe(both);
  await page.evaluate(async () => (await import('/app/core/query.js')).clearFilters());
  await expect.poll(() => app.state('results.total')).toBe(fixturePlants.length);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/');
});

test('un cœur dans la liste : la plante rejoint les favoris et Mes plantes', async ({ app, page }) => {
  await app.open('#/?q=ail%20des%20ours');
  await page.getByRole('button', { name: 'Ajouter aux favoris : Ail des ours' }).click();
  await expect.poll(() => page.evaluate(async id => (await import('/app/core/collections.js')).isFavorite(id), plantId('Allium ursinum'))).toBe(true);
  await app.go('#/collections');
  await expect(page.locator('gf-collections').getByText('Favoris').first()).toBeVisible();
  await expect(page.locator('gf-collections').getByText('1 plante').first()).toBeVisible();
});
