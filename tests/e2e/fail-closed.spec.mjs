// Safety warnings fail closed (audit STO-1): when data/lookalikes.json or data/safety.json cannot be read, the sheet
// says the list is unavailable — never « nothing to confuse it with » — and « Réessayer » reads it again; when
// data/territories.json cannot be read, « Noter ici »'s message says a regional protection may be the one here.
// Migrated from lookfold.cjs, uses.cjs, mediafail.cjs.
import { test, expect, plantId } from './fixtures.mjs';

const SAFETY = /\/data\/(lookalikes|safety)\.json(\?|$)/;

test('ail des ours : « Peut être confondue avec » le colchique', async ({ app, page }) => {
  await app.open(`#/plant/${plantId('Allium ursinum')}`);
  const box = page.locator('gf-lookalikes').first();
  await expect(box.getByText(/Peut être confondue avec/).first()).toBeVisible();
  await expect(box.getByRole('link', { name: 'Colchique' }).first()).toBeVisible();
});

test('colchique : « Plante mortelle », confondue avec l’ail des ours', async ({ app, page }) => {
  await app.open(`#/plant/${plantId('Colchicum autumnale')}`);
  await expect(page.locator('gf-lookalikes').first().getByText(/Plante mortelle, confondue avec/).first()).toBeVisible();
});

test('listes illisibles : « indisponible », puis « Réessayer » les relit', async ({ app, page, context }) => {
  let failing = true;
  await context.route(SAFETY, route => failing ? route.fulfill({ status: 503, body: '' }) : route.fallback());
  await app.open(`#/plant/${plantId('Allium ursinum')}`);
  const unread = page.getByRole('alert').filter({ hasText: 'Liste des confusions indisponible pour le moment : ne consommez aucune plante sans vérification.' });
  await expect(unread).toBeVisible();
  await expect(page.getByText('Données de toxicité et liste des confusions indisponibles pour le moment').first()).toBeVisible();
  await expect(page.getByText(/Peut être confondue avec/)).toHaveCount(0);
  failing = false;
  await unread.getByRole('button', { name: 'Réessayer' }).click();
  await expect(unread).toHaveCount(0);
  await expect(page.locator('gf-lookalikes').first().getByText(/Peut être confondue avec/).first()).toBeVisible();
});

test('l’avertissement des toasts de cueillette (lookalikeWarning, dans la page) : « indisponible », pas « rien »', async ({ app, page, context }) => {
  await context.route(SAFETY, route => route.fulfill({ status: 503, body: '' }));
  await app.open('#/');
  const warning = await page.evaluate(async id => {
    const db = await import('/app/core/db.js');
    const { lookalikeWarning } = await import('/app/core/lookalikes.js');
    return lookalikeWarning(await db.get('plants', id));
  }, plantId('Allium ursinum'));
  expect(warning).toEqual({ toxic: true, unread: true, level: 'danger', text: 'Liste des confusions indisponible pour le moment : ne consommez aucune plante sans vérification.' });
});

test('le message de « Noter ici » (statusWarning, dans la page) : la région du point illisible, une protection régionale dite « peut-être ici »', async ({ app, page, context }) => {
  let failing = true;
  await context.route(/\/data\/territories\.json(\?|$)/, route => failing ? route.fulfill({ status: 503, body: '' }) : route.fallback());
  await app.open('#/');
  // The Ail jaune, protected in Île-de-France and Auvergne, noted in Paris.
  const warning = () => page.evaluate(async id => {
    const { getPlant } = await import('/app/core/plants.js');
    const { statusWarning } = await import('/app/components/gf-status.js');
    return statusWarning(await getPlant(id), [2.35, 48.85]);
  }, plantId('Allium flavum'));
  // Where it is, unreadable: never nothing — maybe here, a danger (as the verdict before the note: core/alerts.js).
  expect(await warning()).toEqual({ level: 'danger', text: 'Espèce protégée dans des régions ou départements (Ile-de-France, Auvergne), peut-être ici' });
  failing = false;
  expect(await warning()).toEqual({ level: 'danger', text: 'Espèce protégée (Ile-de-France)' });
});
