// Every main screen opens on the reduced flora, the first launch shows Découvrir alone (its list), and the real flora still
// loads (the one spec on data/plants.json as published). Migrated from smoke.cjs, startup.cjs, tabbar.cjs.
import { readdirSync } from 'node:fs';
import { test, expect, plantId } from './fixtures.mjs';

const ROUTES = ['#/', '#/?q=ortie', `#/plant/${plantId('Urtica dioica')}`, '#/discover', '#/discover?s=harvest', '#/discover?s=trail', '#/app/rencontres', '#/app/parcours', '#/app/cueillette', '#/app/mosaique',
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

// A reactive property named after an HTMLElement member hides it: `focus` on four components made el.focus() throw
// (audit QUA-4 / ARC-10; eslint.config.js now refuses such a name). Every component keeps the native methods.
test('aucun composant ne masque focus(), blur() ni click()', async ({ app, page }) => {
  const files = readdirSync(new URL('../../app/components/', import.meta.url)).filter(f => f.endsWith('.js'));
  await app.open('#/');
  const broken = await page.evaluate(async files => {
    // eslint-disable-next-line no-unsanitized/method -- the file names of app/components, read by the test
    for (const f of files) await import('/app/components/' + f);
    const out = [];
    for (const f of files) {
      const name = f.replace(/\.js$/, '');
      if (!customElements.get(name)) continue;
      const el = document.createElement(name);
      for (const m of ['focus', 'blur', 'click']) if (typeof el[m] !== 'function') out.push(`${name}.${m}`);
    }
    return out;
  }, files);
  expect(broken).toEqual([]);
});

test.describe('premier lancement', () => {
  test.use({ firstVisit: true });

  test('Découvrir accueille, les autres onglets viennent ensuite', async ({ app, page }) => {
    await app.open('#/');
    await expect(page.getByRole('heading', { level: 1, name: 'Découvrir' })).toBeVisible();
    await expect(page.locator('gf-launcher li[data-app="rencontres"]').getByRole('button', { name: 'Jouer' })).toBeVisible();
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
