// Un verdict par plante (core/danger.js): the plant sheet says one — the badge of its Alertes rubric counts every reason,
// the confusions too, in the colour of the gravest; the Prudence opens on the same chip; each confusion's chip is the
// same level. TPPT « toxique » (2) is a danger on the sheet as on the cards and before a harvest. Never « comestible »,
// even quoted: the laurier rose's only criterion (« Seul le laurier sauce est comestible… ») is not shown. Flore's
// « Protection » column says the verdict with no place known, in its words and colours, light or dark, and never pushes
// a row sideways.
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

test('Flore, colonne « Protection » : les mots et couleurs du verdict — « Protégée » rouge ; « Protégée selon le lieu », « Réglementée » ambre', async ({ app, page }) => {
  test.skip(app.phone, 'la grille et ses colonnes : sur un écran large');
  await app.open('#/?family=Asparagaceae');
  await page.evaluate(async () => (await import('/app/core/store.js')).setMode('scientific'));
  const chips = (/** @type {string} */ name) => page.locator('gf-flora gf-plant-list gf-plant-card').filter({ hasText: name }).locator('.cell.legal .sev-chip');
  /** A token as a computed background. @param {string} css */
  const tint = css => page.evaluate(value => {
    const probe = document.createElement('span');
    probe.style.backgroundColor = value;
    document.body.append(probe);
    const out = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return out;
  }, css);
  const squill = chips('Squille à feuilles ondulées'), lily = chips('Muguet de mai');
  // Protected in France: « Protégée », a danger; the muguet, protected in some departments and its picking ruled: warnings.
  await expect(squill).toHaveText(['Protégée']);
  await expect(squill).toHaveClass(/\bdanger\b/);
  await expect(squill).toHaveAttribute('title', 'Protégée en France (protection nationale)');
  await expect(lily).toHaveText(['Protégée selon le lieu', 'Réglementée']);
  await expect(lily.first()).toHaveClass(/\bwarn\b/);
  await expect(lily.nth(1)).toHaveClass(/\bwarn\b/);
  for (const scheme of /** @type {const} */ (['light', 'dark'])) {
    await page.emulateMedia({ colorScheme: scheme });
    expect(await squill.evaluate(el => getComputedStyle(el).backgroundColor), scheme).toBe(await tint('var(--gf-danger-bg)'));
    expect(await squill.evaluate(el => getComputedStyle(el).color), scheme).toBe(await colour(page, 'var(--gf-danger)'));
    expect(await lily.first().evaluate(el => getComputedStyle(el).backgroundColor), scheme).toBe(await tint('var(--gf-warn-bg)'));
  }
  // Its column never pushes a row sideways (♥ and 📍 out of the pane): narrower, the least useful columns go first — a
  // plant open beside the list, on a laptop, too.
  const list = page.locator('gf-flora gf-plant-list');
  const sideways = async () => {
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    return list.evaluate(el => el.scrollWidth - el.clientWidth);
  };
  for (const width of [800, 900, 1100]) {
    await page.setViewportSize({ width, height: 800 });
    await expect.poll(sideways, `${width} px`).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await list.locator('gf-plant-card a.row').first().click();
  await expect(page.locator('gf-flora gf-plant-detail').first()).toBeVisible();
  await expect.poll(sideways, '1366 px, une plante ouverte').toBeLessThanOrEqual(0);
});
