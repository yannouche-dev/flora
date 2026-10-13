// « Toutes les couches de l'IGN » (Carte panel): the catalogue shipped with the app (data/ign-catalog.json) shows at
// once, whatever the service does; an old copy is refreshed in the background from GetCapabilities, read as it
// streams (a slow download is not cut, only a stalled one); a failure is said as such — offline, or the service not
// answering — with « Réessayer », and never hides the list.
import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.mjs';

const CAPS = readFileSync(new URL('../fixtures/ign-capabilities.xml', import.meta.url), 'utf8');
const CAPS_URL = /data\.geopf\.fr\/wmts\?SERVICE=WMTS&REQUEST=GetCapabilities/;
/** An old copy of one layer, in place of the copy shipped: a refresh is due, and its result shows. */
const OLD_COPY = JSON.stringify({ fetchedAt: '2026-01-02T00:00:00Z', layers: [
  { id: 'OLD.LAYER', title: 'Couche de la copie', about: 'livrée avec l’app', format: 'image/png', style: 'normal', minNative: 0, maxNative: 19 }] });

/** @param {import('@playwright/test').Page} page */
async function openCatalog(page) {
  await page.locator('gf-map').first().evaluate(map => /** @type {any} */ (map).openPanel());
  const panel = page.locator('gf-map-panel');
  await panel.getByRole('button', { name: /Ajouter une couche de l’IGN/ }).click();
  return panel;
}

test('la copie livrée s’affiche aussitôt, GetCapabilities bloqué : jamais « indisponible »', async ({ page, app }) => {
  /** @type {string[]} */
  const asked = [];
  await page.route(CAPS_URL, route => { asked.push(route.request().url()); return route.abort(); });
  await app.open('#/map');
  const panel = await openCatalog(page);
  const items = panel.locator('ul[aria-label="Couches de l’IGN"] li');
  await expect(items).toHaveCount(60, { timeout: 3000 });
  await expect(panel.getByRole('searchbox', { name: 'Chercher une couche de l’IGN' })).toHaveAttribute('placeholder', /Chercher parmi \d{3} couches/);
  // The copy shipped is a seed: the service is asked, fails, and that is said — the list stays.
  await expect(panel.locator('.catalog .state')).toContainText('Le catalogue de l’IGN ne répond pas');
  await expect(panel.getByRole('button', { name: 'Réessayer' })).toBeVisible();
  await expect(panel).not.toContainText('indisponible');
  expect(asked.length).toBe(1);
  // The search reads all the layers (hundreds), the rendering stays capped.
  await panel.getByRole('searchbox', { name: 'Chercher une couche de l’IGN' }).fill('foret publique');
  await expect(items.filter({ hasText: 'Forêts publiques' }).first()).toBeVisible();
  // A layer added joins the list of the panel, checked.
  await items.filter({ hasText: 'Forêts publiques' }).first().getByRole('button', { name: 'Ajouter' }).click();
  await expect(panel.locator('.catalog label.layer', { hasText: 'FORETS.PUBLIQUES' }).locator('input')).toBeChecked();
});

test('une mise à jour lente (40 s, sans arrêt) va au bout et remplace la liste', async ({ page, app }) => {
  test.setTimeout(120_000);
  await page.route(/\/data\/ign-catalog\.json(\?|$)/, route => route.fulfill({ contentType: 'application/json', body: OLD_COPY }));
  // A download that trickles for 40 s: 20 pieces, 2 s apart (the stall limit is 20 s, there is no 30 s cap any more).
  await page.addInitScript(xml => {
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (!/REQUEST=GetCapabilities/.test(String(input))) return real(input, init);
      const pieces = 20;
      const size = Math.ceil(xml.length / pieces);
      let i = 0;
      const body = new ReadableStream({
        async pull(controller) {
          await new Promise(r => setTimeout(r, 2000));
          if (i < pieces) controller.enqueue(new TextEncoder().encode(xml.slice(i * size, ++i * size)));
          else controller.close();
        }
      });
      return Promise.resolve(new Response(body, { headers: { 'content-type': 'application/xml' } }));
    };
  }, CAPS);
  await app.open('#/map');
  const panel = await openCatalog(page);
  const items = panel.locator('ul[aria-label="Couches de l’IGN"] li');
  await expect(items).toHaveCount(1);
  await expect(panel.locator('.catalog .state')).toContainText('Mise à jour du catalogue');
  await expect(items.filter({ hasText: 'Relief ombré (estompage)' })).toHaveCount(1, { timeout: 70_000 });
  await expect(items).toHaveCount(6);
  await expect(panel.locator('.catalog .state')).toHaveCount(0);
});

test('hors ligne : la liste gardée et « Hors ligne », sans appel', async ({ page, context, app }) => {
  await page.route(/\/data\/ign-catalog\.json(\?|$)/, route => route.fulfill({ contentType: 'application/json', body: OLD_COPY }));
  await app.open('#/map');
  const panel = await openCatalog(page);
  await expect(panel.locator('ul[aria-label="Couches de l’IGN"] li')).toHaveCount(1);
  await expect(panel.locator('.catalog .state')).toContainText('ne répond pas');
  await page.locator('gf-map-panel').evaluate(p => /** @type {any} */ (p).close());
  await context.setOffline(true);
  await page.locator('gf-map').first().evaluate(map => /** @type {any} */ (map).openPanel());
  await expect(panel.locator('.catalog .state')).toContainText('Hors ligne : catalogue livré avec l’app (2 janvier 2026)');
  await expect(panel.locator('ul[aria-label="Couches de l’IGN"] li')).toHaveCount(1);
  await context.setOffline(false);
});

test('« Réessayer » après un échec redemande le service et met la liste à jour', async ({ page, app }) => {
  await page.route(/\/data\/ign-catalog\.json(\?|$)/, route => route.fulfill({ contentType: 'application/json', body: OLD_COPY }));
  let up = false;
  await page.route(CAPS_URL, route => up
    ? route.fulfill({ contentType: 'application/xml', body: CAPS })
    : route.fulfill({ status: 503, body: '' }));
  await app.open('#/map');
  const panel = await openCatalog(page);
  await expect(panel.locator('.catalog .state')).toContainText('Le catalogue de l’IGN ne répond pas (erreur 503) — catalogue livré avec l’app');
  up = true;
  await panel.getByRole('button', { name: 'Réessayer' }).click();
  await expect(panel.locator('ul[aria-label="Couches de l’IGN"] li')).toHaveCount(6);
  await expect(panel.locator('.catalog .state')).toHaveCount(0);
});

test('module « IGN – fonds de carte » coupé : la liste livrée, rien demandé, et l’ajout l’explique', async ({ page, app }) => {
  await page.addInitScript(() => localStorage.setItem('geoflora.modules', JSON.stringify({ ignMaps: false })));
  /** @type {string[]} */
  const asked = [];
  await page.route(CAPS_URL, route => { asked.push(route.request().url()); return route.abort(); });
  await app.open('#/map');
  const panel = await openCatalog(page);
  await expect(panel.locator('ul[aria-label="Couches de l’IGN"] li')).toHaveCount(60);
  await expect(panel.locator('.catalog .state')).toContainText('Module « IGN – fonds de carte » désactivé : une couche ajoutée n’affichera que les zones déjà vues');
  await expect(panel.locator('.catalog .state a')).toHaveAttribute('href', '#/settings');
  expect(asked).toEqual([]);
});
