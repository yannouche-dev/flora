// Usages et cuisine sauvage shown alone (gf-sheet-block key="uses") always carries « Plantes à confondre » under its
// Prudence — in Flore's pane (?pane=uses), in a screen's cell plant.uses, over the page (⤢) —: the box titled, « Voir
// « Plantes à confondre » ci-dessous », « Aucune confusion… » for a plant of none, one « Réessayer » for both when the
// safety files cannot be read, no « Comparer sur la carte » (no map beside it). A sosie touched in a cell: the current
// plant (core/embed-links.js).
import { test, expect, plantId } from './fixtures.mjs';

const AIL = plantId('Allium ursinum'), MUGUET = plantId('Convallaria majalis');
const SAFETY = /\/data\/(lookalikes|safety)\.json(\?|$)/;
const NO_CONFUSION = 'Aucune confusion de notre liste (Anses, Centres antipoison) ne concerne cette plante : cela ne garantit pas l’absence de risque.';

test('Usages montré seul emporte toujours l’encadré « Plantes à confondre », sur grand écran comme sur téléphone', async ({ app, page, context }) => {
  // The safety files unreadable first (none read yet in this page): both say so, one « Réessayer » brings both back.
  let failing = true;
  await context.route(SAFETY, route => failing ? route.fulfill({ status: 503, body: '' }) : route.fallback());
  await app.open(`#/plant/${AIL}?pane=uses`);
  const pane = page.locator('gf-flora gf-sheet-block[key="uses"]');
  const unread = pane.getByRole('alert').filter({ hasText: 'Liste des confusions indisponible pour le moment : ne consommez aucune plante sans vérification.' });
  await expect(unread).toBeVisible();
  await expect(pane.getByText('Données de toxicité et liste des confusions indisponibles pour le moment')).toBeVisible();
  failing = false;
  await pane.locator('.prudence').getByRole('button', { name: 'Réessayer' }).click();
  await expect(unread).toHaveCount(0);
  await expect(pane.getByText(/indisponibles? pour le moment/)).toHaveCount(0);

  // The box under Prudence: its heading, the sosies, the verdict's chip, whom to call.
  const box = pane.locator('gf-lookalikes');
  await expect(box.getByText(/Peut être confondue avec/).first()).toBeVisible();
  await expect(box.getByRole('link', { name: 'Muguet' })).toBeVisible();
  // Prudence, then the heading and the box (a source down, Wikidata here, said above them).
  expect(await pane.locator('.content').evaluate(c => {
    const kids = [...c.children];
    const prudence = kids.findIndex(e => e.matches('.prudence')), head = kids.findIndex(e => e.matches('h3') && e.textContent?.trim() === 'Plantes à confondre');
    return prudence >= 0 && prudence < head && kids[head + 1]?.localName === 'gf-lookalikes';
  })).toBe(true);
  await expect(pane.locator('.sev-chip').first()).toBeVisible();
  await expect(pane.locator('.sos').first()).toBeVisible();
  await expect(pane.getByText('Voir « Plantes à confondre » ci-dessous.').first()).toBeVisible();
  await expect(pane.getByRole('button', { name: /Comparer sur la carte/ })).toHaveCount(0);
  // Beside the sheet (a wide screen): the sheet keeps its own block.
  if (!app.phone) await expect(page.locator('gf-flora gf-lookalikes')).toHaveCount(2);

  // The toxic side; a plant of no confusion: the line under the heading, the box hidden.
  await app.go(`#/plant/${plantId('Colchicum autumnale')}?pane=uses`);
  await expect(box.getByText(/Plante mortelle, confondue avec/).first()).toBeVisible();
  await app.go(`#/plant/${plantId('Urtica dioica')}?pane=uses`);
  await expect(pane.getByText(NO_CONFUSION)).toBeVisible();
  await expect(box).toBeHidden();
  await expect(pane.getByRole('heading', { level: 3, name: 'Plantes à confondre' })).toBeVisible();

  // A screen's cell: the box there; a sosie touched, the current plant.
  await app.go(`#/layout/[plant.uses]?p=${AIL}`);
  const cell = page.locator('gf-layout gf-sheet-block[key="uses"]');
  await cell.locator('gf-lookalikes').getByRole('link', { name: 'Muguet' }).click();
  await expect.poll(() => page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] || '').get('p'))).toBe(String(MUGUET));
  expect(await page.evaluate(() => location.hash)).toMatch(/^#\/layout\//);
  await expect(cell.getByRole('button', { name: /Comparer sur la carte/ })).toHaveCount(0);

  // Over the page (⤢ in Mes plantes): the same box.
  if (app.phone) return;
  await app.go(`#/collections?plant=${AIL}`);
  await page.locator('gf-collections gf-plant-detail[sheet="collections"] .block[data-key="uses"] button.to-pane').click();
  const over = page.locator('gf-collections dialog.pane gf-sheet-block[key="uses"]');
  await expect(over.locator('gf-lookalikes')).toContainText('Muguet');
  await expect(over.getByRole('button', { name: /Comparer sur la carte/ })).toHaveCount(0);
});
