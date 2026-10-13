// Every main screen opens on the reduced flora, the first launch shows Découvrir alone, and the real flora still
// loads (the one spec on data/plants.json as published). Migrated from smoke.cjs, startup.cjs, tabbar.cjs.
import { test, expect, plantId } from './fixtures.mjs';

const ROUTES = ['#/', '#/?q=ortie', `#/plant/${plantId('Urtica dioica')}`, '#/discover', '#/discover?s=harvest', '#/discover?s=trail',
  '#/map', '#/collections', '#/settings', '#/legal'];

test('chaque écran s’ouvre et montre quelque chose (visiteur habitué)', async ({ app, page }) => {
  await app.open('#/');
  expect(await app.tabs()).toEqual(expect.arrayContaining(['Découvrir', 'Flore', 'Mes plantes', 'Carte']));
  for (const route of ROUTES) {
    await app.go(route);
    await expect.poll(() => page.evaluate(() => {
      const main = document.querySelector('gf-app')?.shadowRoot?.querySelector('main');
      const view = main?.lastElementChild;
      if (!view || main.querySelector('.banner.error')) return 'nothing';
      return view.localName.includes('-') && customElements.get(view.localName) && view.shadowRoot?.childElementCount ? 'shown' : 'nothing';
    }), { message: route }).toBe('shown');
  }
});

test.describe('premier lancement', () => {
  test.use({ firstVisit: true });

  test('Découvrir accueille, les autres onglets viennent ensuite', async ({ app, page }) => {
    await app.open('#/');
    await expect(page.getByRole('heading', { name: 'Rencontrez les plantes d’ici' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Autour de moi' })).toBeVisible();
    expect(await app.tabs()).toContain('Découvrir');
    expect(await app.tabs()).not.toContain('Flore');
    // An address of the flora still opens it (a shared link): the discovery never locks one out.
    await app.go(`#/plant/${plantId('Allium ursinum')}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Ail des ours' })).toBeVisible();
  });
});

test.describe('jeu de données réel', () => {
  test.use({ realData: true });
  test.skip(({ isMobile }) => isMobile, 'une fois suffit : le bureau');

  test('data/plants.json tel que publié se charge, son empreinte vérifiée', async ({ app, page }) => {
    test.setTimeout(120_000);
    await page.goto('#/');
    await expect.poll(() => app.state('status'), { timeout: 90_000 }).toBe('ready');
    const { count, meta } = await page.evaluate(async () => {
      const db = await import('/app/core/db.js');
      return { count: await db.count('plants'), meta: await db.get('meta', 'dataset') };
    });
    expect(count).toBeGreaterThan(5000);
    expect(count).toBe(meta.plants);
    expect(meta.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
