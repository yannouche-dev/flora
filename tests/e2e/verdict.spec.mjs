// Un verdict par plante (core/danger.js): the plant sheet says one — the badge of its Alertes rubric counts every reason,
// the confusions too, in the colour of the gravest; the Prudence opens on the same chip; each confusion's chip is the
// same level. TPPT « toxique » (2) is a danger on the sheet as on the cards and before a harvest. Never « comestible »,
// even quoted: the laurier rose's only criterion (« Seul le laurier sauce est comestible… ») is not shown.
import { test, expect, plantId } from './fixtures.mjs';

/** A colour as the page computes it. @param {import('@playwright/test').Page} page @param {string} css */
const colour = (page, css) => page.evaluate(value => {
  const probe = document.createElement('span');
  probe.style.color = value;
  document.body.append(probe);
  const out = getComputedStyle(probe).color;
  probe.remove();
  return out;
}, css);

test('ail des ours : le badge d’Alertes compte la confusion avec le colchique, à la couleur du mortel ; aucun second badge', async ({ app, page }) => {
  await app.open(`#/plant/${plantId('Allium ursinum')}`);
  const sheet = page.locator('gf-plant-detail').first();
  const go = sheet.locator('.rubric[data-cat="safety"] .rub-go');
  const badge = go.locator('.rub-badge');
  // Colchique (mortel), Muguet (très toxique), TPPT (irritante pour la peau): three reasons, the deadly colour.
  await expect(badge).toHaveText('3');
  await expect(badge).toHaveClass(/\bdeadly\b/);
  await expect(go).toHaveAttribute('aria-label', 'Alertes — 3 alertes');
  await expect(go).toHaveAttribute('title', /Ne pas confondre avec Colchique \(mortel\)/);
  expect(await badge.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await colour(page, 'var(--gf-deadly)'));
  // One verdict, one badge: Usages carries none.
  await expect(sheet.locator('.rubric[data-cat="uses"] .rub-badge')).toHaveCount(0);
  // The confusion block says it the same way: Colchique, its chip « mortel » in the deadly level.
  await expect(sheet.locator('gf-lookalikes').first().locator('.sev-chip.deadly').first()).toHaveText(/mortel/i);
  // The Prudence opens on the verdict's chip.
  await expect(sheet.locator('.prudence .verdict .sev-chip')).toHaveText('Sosie mortel');
});

test('TPPT « toxique » (niveau 2) : rouge sur la fiche, « Toxique » — plus orange', async ({ app, page }) => {
  await app.open(`#/plant/${plantId('Myosotis sylvatica')}`);
  const sheet = page.locator('gf-plant-detail').first();
  const chip = sheet.locator('.prudence .verdict .sev-chip');
  await expect(chip).toHaveText('Toxique');
  await expect(chip).toHaveClass(/\bdanger\b/);
  await expect(sheet.locator('.prudence li[data-level="danger"]').filter({ hasText: 'Plante toxique' })).toHaveCount(1);
  await expect(sheet.locator('.rubric[data-cat="safety"] .rub-badge')).toHaveClass(/\bdanger\b/);
});

test('laurier sauce : sa fiche ne cite jamais « comestible » ; ses parties toxiques nommées', async ({ app, page }) => {
  await app.open(`#/plant/${plantId('Laurus nobilis')}`);
  const sheet = page.locator('gf-plant-detail').first();
  const box = sheet.locator('gf-lookalikes').first();
  await expect(box.getByText(/Peut être confondue avec/).first()).toBeVisible();
  await expect(box).not.toContainText(/comestible/i);
  await expect(sheet.locator('.prudence')).toContainText('Parties toxiques : fruit.');
});
