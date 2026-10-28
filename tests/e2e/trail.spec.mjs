// Parcours botanique (Découvrir › Parcours): start a walk, name it, add plants by the search (a tap, or Entrée on the
// fresh first answer), see them on the map. Migrated from trail.cjs, trail2.cjs, trailname.cjs, trailsearch/.
import { test, expect, plantId } from './fixtures.mjs';

/** The walk's saved collection, by name (a parcours: its mark). @param {import('@playwright/test').Page} page @param {string} name */
const saved = (page, name) => page.evaluate(async n => {
  const { listCollections } = await import('/app/core/collections.js');
  const c = (await listCollections()).find((/** @type {any} */ x) => x.properties.name === n);
  return c ? { kind: c.properties.kind, plants: c.properties.plants.map((/** @type {any} */ e) => e.plantId), walk: c.properties.walk === true } : null;
}, name);

test('un parcours : nommé, des plantes ajoutées par la recherche, enregistré et sur la carte', async ({ app, page }) => {
  await app.open('#/app/parcours');
  const trail = page.locator('gf-miniapp');
  await trail.locator('.go').click();
  const name = trail.locator('.card input.name');
  await expect(name).toBeVisible();
  await name.fill('Bord du canal');
  await name.press('Enter');
  await expect.poll(() => saved(page, 'Bord du canal')).toMatchObject({ plants: [], walk: true });

  // Every answer of the flora: Prunus spinosa among « prunus ».
  const search = trail.locator('.search input');
  await search.fill('prunus');
  await expect(trail.locator('.hit').filter({ hasText: 'Prunus spinosa' })).toBeVisible();

  // Typed quickly, then Entrée: the plant for the whole word, not for a word typed half-way.
  await search.fill('');
  await search.pressSequentially('prunellier', { delay: 10 });
  await search.press('Enter');
  await expect(trail.locator('.mine > li')).toHaveCount(1);
  await expect(trail.locator('.mine > li').first()).toContainText('Prunus spinosa');
  await expect(search).toHaveValue('');

  // A tap on « + » of an answer.
  await search.fill('ortie dioique');
  await trail.locator('.hit').filter({ hasText: 'Urtica dioica' }).locator('.add').click();
  await expect(trail.locator('.mine > li')).toHaveCount(2);
  await expect.poll(async () => (await saved(page, 'Bord du canal'))?.plants.sort()).toEqual([plantId('Prunus spinosa'), plantId('Urtica dioica')].sort());

  // The map of the walk, beside the list (desktop) or under it (phone): a marker per plant.
  await expect.poll(() => trail.locator('gf-map .leaflet-marker-icon').count()).toBeGreaterThanOrEqual(2);
});

test('un parcours terminé se continue depuis Mes plantes (« Continuer le parcours », sur la Carte)', async ({ app, page }) => {
  await app.open('#/app/parcours');
  const trail = page.locator('gf-miniapp');
  await trail.locator('.go').click();
  await trail.locator('.card input.name').fill('Chemin des saules');
  await trail.locator('.card input.name').press('Enter');
  await trail.locator('.search input').fill('ortie dioique');
  await trail.locator('.hit').filter({ hasText: 'Urtica dioica' }).locator('.add').click();
  await expect(trail.locator('.mine > li')).toHaveCount(1);
  await trail.locator('.end').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Parcours terminé' })).toBeVisible();
  // No list of walks kept on the device: they are read from Mes plantes.
  expect(await page.evaluate(() => localStorage.getItem('geoflora.trails'))).toBeNull();
  const id = await page.evaluate(async () => (await (await import('/app/core/collections.js')).listCollections())
    .find((/** @type {any} */ c) => c.properties.name === 'Chemin des saules')?.id);

  // On the Carte, its lieu's panel: « Continuer le parcours » — the Parcours, on this walk.
  await app.go(`#/map?spot=${id}`);
  await page.locator('gf-spot-editor').getByRole('button', { name: 'Continuer le parcours' }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/app/parcours/walk');
  await expect(page.locator('gf-miniapp .card input.name')).toHaveValue('Chemin des saules');
  await expect(trail.locator('.mine > li')).toHaveCount(1);
  await trail.locator('.search input').fill('prunellier');
  await trail.locator('.hit').filter({ hasText: 'Prunus spinosa' }).locator('.add').click();
  await expect(trail.locator('.mine > li')).toHaveCount(2);
  await expect.poll(async () => (await saved(page, 'Chemin des saules'))?.plants.sort()).toEqual([plantId('Prunus spinosa'), plantId('Urtica dioica')].sort());
});

test('« Continuer le parcours » d’un autre : celui en marche terminé, à vous avec ses plantes — « Recommencer » le garde', async ({ app, page }) => {
  await app.open('#/');
  // An older walk of Mes plantes, the user's.
  const older = await page.evaluate(async id => {
    const c = await import('/app/core/collections.js');
    const db = await import('/app/core/db.js');
    const walk = c.withPlant(c.newPlace([2.43, 48.83], { name: 'Mon parcours botanique au bois de Vincennes', walk: true, from: { app: 'parcours' } }), await db.get('plants', id));
    return (await c.savePlace(walk)).id;
  }, plantId('Prunus spinosa'));
  // A walk under way, with a plant.
  await app.go('#/app/parcours');
  const trail = page.locator('gf-miniapp');
  await trail.locator('.go').click();
  await trail.locator('.card input.name').fill('Chemin des saules');
  await trail.locator('.card input.name').press('Enter');
  await trail.locator('.search input').fill('ortie dioique');
  await trail.locator('.hit').filter({ hasText: 'Urtica dioica' }).locator('.add').click();
  await expect(trail.locator('.mine > li')).toHaveCount(1);
  /** Who owns « Chemin des saules », and its plants. */
  const walked = () => page.evaluate(async () => {
    const c = (await (await import('/app/core/collections.js')).listCollections()).find((/** @type {any} */ x) => x.properties.name === 'Chemin des saules');
    return c ? [c.properties.origin?.app ?? null, c.properties.from?.app ?? null, c.properties.plantIds] : null;
  });
  expect(await walked()).toEqual(['parcours', null, [plantId('Urtica dioica')]]);
  // The older one continued from its lieu on the Carte: the one under way is ended, never dropped the Parcours'.
  await app.go(`#/map?spot=${older}`);
  await page.locator('gf-spot-editor').getByRole('button', { name: 'Continuer le parcours' }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/app/parcours/walk');
  await expect(page.locator('gf-miniapp .card input.name')).toHaveValue('Mon parcours botanique au bois de Vincennes');
  await expect.poll(walked).toEqual([null, 'parcours', [plantId('Urtica dioica')]]);
  // « Recommencer » the Parcours: it takes nothing of it.
  await page.evaluate(async () => (await import('/app/core/collections.js')).forgetMadeBy('parcours'));
  expect(await walked()).toEqual([null, 'parcours', [plantId('Urtica dioica')]]);
});

test('« Continuer un parcours » : les parcours de Mes plantes, pas les autres lieux', async ({ app, page }) => {
  await app.open('#/');
  // A walk this device never listed (received, imported, or kept before the list went), and a lieu that is no walk.
  await page.evaluate(async id => {
    const c = await import('/app/core/collections.js');
    const db = await import('/app/core/db.js');
    const ortie = await db.get('plants', id);
    await c.savePlace(c.withPlant(c.newPlace([2.43, 48.83], { name: 'Mon parcours botanique au bois de Vincennes', walk: true }), ortie));
    await c.savePlace(c.withPlant(c.newPlace([2.36, 48.84], { name: 'Jardin des Plantes' }), ortie));
  }, plantId('Urtica dioica'));
  await app.go('#/app/parcours');
  const offered = page.getByRole('group', { name: 'Continuer un parcours' });
  await expect(offered.getByRole('button')).toHaveCount(1);
  await expect(offered).toContainText('Au bois de Vincennes');
  await expect(offered).toContainText('1 plante');
  await offered.getByRole('button').click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/app/parcours/walk');
  await expect(page.locator('gf-miniapp .card input.name')).toHaveValue('Mon parcours botanique au bois de Vincennes');
});

test('le nom du parcours se garde au rechargement', async ({ app, page }) => {
  await app.open('#/app/parcours');
  const trail = page.locator('gf-miniapp');
  await trail.locator('.go').click();
  await trail.locator('.card input.name').fill('Sentier des crêtes');
  await trail.locator('.card input.name').press('Enter');
  await expect.poll(() => saved(page, 'Sentier des crêtes')).not.toBeNull();
  await page.reload();
  await app.ready();
  await expect(page.locator('gf-miniapp .card input.name')).toHaveValue('Sentier des crêtes');
});
