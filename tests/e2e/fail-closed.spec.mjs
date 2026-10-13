// Safety warnings fail closed (audit STO-1): when data/lookalikes.json or data/safety.json cannot be read, the sheet
// says the list is unavailable — never « nothing to confuse it with » — and « Réessayer » reads it again. Migrated
// from lookfold.cjs, uses.cjs, mediafail.cjs.
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
  expect(warning).toEqual({ toxic: true, unread: true, text: 'Liste des confusions indisponible pour le moment : ne consommez aucune plante sans vérification.' });
});
