// « Créer une app » (#/builder, app/layout/gf-builder.js): the one place where an app is made. Its start: three grids
// and the ready-made layouts, each drawn small; then the free layout built on it, live (gf-layout.js « builder »), its
// address keeping everything (g=: the layout; then its state). Here: the start and its cards (Back returns to it), the
// old links (#/builder/<grille>[?g=]), Réglages' card; the cross (cut four ways — the new « Emplacement »'s first tile
// focused —, moved, taken out; 12 cells at most, the last one stays; Échap); the grips; « Ouvrir l'app » (the same
// layout and state in #/layout, a new entry) and the app's « Modifier » back here; « Avancé » (the text typed, what is
// wrong said, a component unknown shown and replaced through ✎); the title; the phone preview (390 px: the layout's own
// tabs); a cell's radius between two of the slider's stops.
import { test, expect, answerAround } from './fixtures.mjs';

/** @typedef {import('@playwright/test').Page} Page */

test.use({ reducedMotion: 'reduce' });
test.beforeEach(async ({ context }) => { await answerAround(context); });

const AT = 'at=48.85,2.35';
/** The layout being built (g=), decoded. @param {Page} page */
const grid = page => page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] || '').get('g'));
/** A parameter of the address. @param {Page} page @param {string} key */
const param = (page, key) => page.evaluate(k => new URLSearchParams(location.hash.split('?')[1] || '').get(k), key);
const hash = (/** @type {Page} */ page) => page.evaluate(() => decodeURIComponent(location.hash));
/** The cell at a path. @param {Page} page @param {string} path */
const cellAt = (page, path) => page.locator(`gf-builder gf-layout section.cell[data-cell="${path}"]`);
/** The builder's address with a layout. @param {string} spec @param {string} [state] */
const builder = (spec, state = AT) => `#/builder?g=${encodeURIComponent(spec)}${state ? '&' + state : ''}`;
/** The element focused, through the shadow roots. @param {Page} page */
const focused = page => page.evaluate(() => {
  let a = document.activeElement;
  while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
  return a ? `${a.tagName.toLowerCase()}.${a.className}[${a.getAttribute('data-comp') ?? ''}]` : '';
});

test.describe('un grand écran', () => {
  test.skip(({ isMobile }) => isMobile, 'a wide screen');

  test('le départ : trois grilles et les modèles ; une grille choisie, ses emplacements et leurs tuiles ; Retour', async ({ app, page }) => {
    await app.open('#/builder');
    await expect(page.locator('gf-builder a[data-grid]')).toHaveText([/Une colonne/, /Trois colonnes/, /Tableau de bord/]);
    await expect(page.locator('gf-builder a[data-preset]')).toHaveCount(5);
    await expect(page.locator('gf-builder gf-layout')).toHaveCount(0);
    await page.locator('gf-builder a[data-grid="trois"]').click();
    await expect.poll(() => grid(page)).toBe('[slot@30,slot@35,slot]');
    await expect(page.locator('gf-builder gf-layout section.cell')).toHaveCount(3);
    await expect(page.locator('gf-builder gf-layout section.cell[data-comp="slot"] gf-block-picker[inline] .lead')).toHaveText(['Choisir un bloc', 'Choisir un bloc', 'Choisir un bloc']);
    await page.goBack();
    await expect.poll(() => hash(page)).toBe('#/builder');
    await expect(page.locator('gf-builder a[data-grid]')).toHaveCount(3);
    // A model: its layout, live.
    await page.locator('gf-builder a[data-preset="carte-recherche-fiche"]').click();
    await expect.poll(() => grid(page)).toBe('[map(r=2km)@34,search@30,plant@36]');
    await expect(cellAt(page, '0').locator('gf-map')).toHaveCount(1);
  });

  test('« Changer de modèle » ramène au départ ; Retour rend la grille', async ({ app, page }) => {
    await app.open(builder('[map,results]'));
    const before = await grid(page);
    const link = page.locator('gf-builder .top').getByRole('link', { name: 'Changer de modèle' });
    await expect(link).toHaveAttribute('title', 'Partir d’une autre grille ou d’un autre modèle');
    await expect(page.locator('gf-builder .top').getByRole('link', { name: 'Recommencer' })).toHaveCount(0);
    await link.click();
    await expect.poll(() => hash(page)).toBe('#/builder');
    await expect(page.locator('gf-builder a[data-grid]')).toHaveCount(3);
    await page.goBack();
    await expect.poll(() => grid(page)).toBe(before);
  });

  test('les anciens liens et la carte de Réglages', async ({ app, page }) => {
    await app.open('#/builder/trois');
    await expect.poll(() => hash(page)).toBe('#/builder?g=[slot@30,slot@35,slot]');
    await app.go('#/builder/tableau?g=[slot,slot]');
    await expect.poll(() => grid(page)).toBe('[slot,slot]');
    await expect(page.locator('gf-builder gf-layout section.cell')).toHaveCount(2);
    await app.go('#/settings');
    const link = page.locator('gf-settings a.builder');
    await expect(link).toContainText('Créer une app');
    const [card, firstH2] = await Promise.all([link.boundingBox(), page.locator('gf-settings h2').first().boundingBox()]);
    expect(card?.y ?? 0).toBeLessThan(firstH2?.y ?? 0);
    await link.click();
    await expect.poll(() => hash(page)).toBe('#/builder');
  });

  test('la croix : diviser dans les quatre sens, déplacer, retirer ; l’adresse garde la disposition', async ({ app, page }) => {
    await app.open(builder('[slot@30,slot@35,slot]', ''));
    // The build button opens the cross: four arms, the middle; Échap closes it, the button focused again.
    await cellAt(page, '1').locator('.build').click();
    await expect(cellAt(page, '1').locator('.cross .arm')).toHaveCount(4);
    await page.keyboard.press('Escape');
    await expect(cellAt(page, '1').locator('.cross')).toHaveCount(0);
    await expect(cellAt(page, '1').locator('.build')).toBeFocused();
    // Below the middle column: a column of two there, the new place's first tile focused.
    await cellAt(page, '1').locator('.build').click();
    await cellAt(page, '1').locator('.arm.bottom').click();
    await expect.poll(() => grid(page)).toBe('[slot@30,[slot,slot]@35,slot@35]');
    await expect.poll(() => focused(page)).toMatch(/^button\.tile\[/);
    // Right of the new one: a row of two inside; left of the first column: beside it in the top row.
    await cellAt(page, '1.1').locator('.build').click();
    await cellAt(page, '1.1').locator('.arm.right').click();
    await cellAt(page, '0').locator('.build').click();
    await cellAt(page, '0').locator('.arm.left').click();
    await expect.poll(() => grid(page)).toBe('[slot@15,slot@15,[slot,[slot,slot]]@35,slot@35]');
    await expect(page.locator('gf-builder gf-layout section.cell')).toHaveCount(6);
    // A block built in the last place, moved before its neighbour.
    await cellAt(page, '3').locator('gf-block-picker[inline] .tile[data-comp="results"]').click();
    await cellAt(page, '3').locator('.build').click();
    await cellAt(page, '3').locator('[data-act="before"]').click();
    await expect.poll(() => grid(page)).toBe('[slot@15,slot@15,results@35,[slot,[slot,slot]]@35]');
    await expect(cellAt(page, '2').locator('.build')).toBeFocused();
    // Taken out: its room to its neighbour; a list of one gives way.
    await cellAt(page, '3.1.0').locator('.build').click();
    await cellAt(page, '3.1.0').locator('[data-act="remove"]').click();
    await expect.poll(() => grid(page)).toBe('[slot@15,slot@15,results@35,[slot,slot]@35]');
    // Reloaded: the same.
    await page.reload();
    await app.ready();
    await expect(page.locator('gf-builder gf-layout section.cell')).toHaveCount(5);
    await expect(cellAt(page, '2')).toHaveAttribute('data-comp', 'results');
  });

  test('la croix : ses limites — 12 cases au plus, la dernière reste ; les poignées règlent les parts', async ({ app, page }) => {
    await app.open(builder('[' + Array(12).fill('slot').join(',') + ']', ''));
    await cellAt(page, '0').locator('.build').click();
    await expect(cellAt(page, '0').locator('.arm:disabled')).toHaveCount(4);
    await app.go(builder('[slot]', ''));
    await cellAt(page, '0').locator('.build').click();
    await expect(cellAt(page, '0').locator('[data-act="remove"]')).toBeDisabled();
    // The grips: the keyboard moves width from one column to the other, written in the address.
    await app.go(builder('[slot@30,slot@35,slot]', ''));
    const grip = page.locator('gf-builder gf-layout [role="separator"]').first();
    await grip.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => Number(/^\[slot@([\d.]+)/.exec(await grid(page) ?? '')?.[1] ?? 0)).toBeGreaterThan(30);
  });

  test('« Ouvrir l’app » : la même disposition et le même état dans l’app ; son « Modifier » revient ici', async ({ app, page }) => {
    await app.open(builder('[slot,slot]'));
    await cellAt(page, '0').locator('gf-block-picker[inline] .tile[data-comp="results"]').click();
    await expect.poll(() => grid(page)).toBe('[results,slot]');
    await page.locator('gf-builder [data-act="open-app"]').click();
    await expect.poll(() => hash(page)).toMatch(/^#\/layout\/\[results,slot\]\?/);
    expect(await param(page, 'at')).toBe('48.85000,2.35000');
    await expect(page.locator('gf-layout section.cell')).toHaveCount(2);
    // In the app, an « Emplacement » is still a place to build in.
    await expect(page.locator('gf-layout section.cell[data-cell="1"] gf-block-picker[inline] .tile').first()).toBeVisible();
    // The app's « Modifier »: here again, the same layout and state; Back: the app.
    await page.locator('gf-layout [data-act="modifier"]').click();
    await expect.poll(() => grid(page)).toBe('[results,slot]');
    expect(await param(page, 'at')).toBe('48.85000,2.35000');
    await page.goBack();
    await expect.poll(() => hash(page)).toMatch(/^#\/layout\//);
  });

  test('« Avancé » : le texte tapé, ce qui ne va pas, un composant inconnu montré puis remplacé', async ({ app, page }) => {
    await app.open(builder('[map,search]'));
    await page.getByText('Avancé : le texte de la disposition').click();
    const field = page.locator('gf-builder #layout-text');
    await expect(field).toHaveValue('[map,search]');
    await field.fill('[mpa,search(filtres),[plant.wiki,plant.calendrier]');
    await expect(page.locator('gf-builder ul.problems')).toContainText('Crochet fermant « ] » manquant');
    await expect(page.locator('gf-builder ul.problems')).toContainText('Composant inconnu « mpa » : vouliez-vous dire « map » ?');
    await expect(cellAt(page, '0')).toContainText('Composant inconnu : « mpa »');
    await expect(page.locator('gf-builder gf-layout section.cell[data-comp="plant.calendar"]')).toBeVisible();
    // Kept in the address as typed, to be corrected.
    await expect.poll(() => grid(page)).toBe('[mpa,search(filtres),[plant.wiki,plant.calendrier]');
    // ✎ on the unknown one: a map; the text written as the address writes it.
    await cellAt(page, '0').locator('.pick').click();
    await page.locator('gf-block-picker:not([inline]) .tile[data-comp="map"]').click();
    await page.locator('gf-block-picker:not([inline]) .tile[data-intent="explorer"]').click();
    await expect.poll(() => grid(page)).toBe('[map,search(filters=1),[plant.wikipedia,plant.calendar]]');
    await expect(field).toHaveValue('[map,search(filters=1),[plant.wikipedia,plant.calendar]]');
    await expect(page.locator('gf-builder ul.problems')).toHaveCount(0);
  });

  test('le titre : tapé, l’adresse remplacée (pas de nouvelle entrée), le bandeau et l’onglet ; jamais du HTML', async ({ app, page }) => {
    await app.open(builder('[search,results]'));
    await expect(page.locator('gf-builder gf-layout .titlebar')).toHaveCount(0);
    const entries = await page.evaluate(() => history.length);
    const field = page.locator('gf-builder #layout-title');
    await field.fill('Mes  plantes ');
    await expect.poll(() => param(page, 'title')).toBe('Mes plantes');
    await expect(page.locator('gf-builder gf-layout .titlebar')).toHaveText('Mes plantes');
    await expect(page).toHaveTitle('Mes plantes · GeoFlora');
    await expect(field).toHaveValue('Mes  plantes ');
    expect(await page.evaluate(() => history.length)).toBe(entries);
    await field.fill('<b>Prés</b>');
    await expect(page.locator('gf-builder gf-layout .titlebar')).toHaveText('<b>Prés</b>');
    await expect(page.locator('gf-builder gf-layout .titlebar b')).toHaveCount(0);
    await field.fill('');
    await expect.poll(() => param(page, 'title')).toBe(null);
    await expect(page.locator('gf-builder gf-layout .titlebar')).toHaveCount(0);
    await expect(page).toHaveTitle('Créer une app — GeoFlora');
  });

  test('l’aperçu « Téléphone » : 390 px, les onglets de la disposition ; le rayon d’une case entre deux crans', async ({ app, page }) => {
    await app.open(builder('[map(r=3km),place]'));
    await expect(page.getByRole('tablist', { name: 'Colonnes' })).toHaveCount(0);
    await page.locator('gf-builder [data-preview="phone"]').click();
    await expect(page.locator('gf-builder [data-preview="phone"]')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => Math.round((await page.locator('gf-builder gf-layout').boundingBox())?.width ?? 0)).toBeLessThanOrEqual(390);
    await expect(page.getByRole('tablist', { name: 'Colonnes' })).toBeVisible();
    await page.locator('gf-builder [data-preview="computer"]').click();
    await expect(page.getByRole('tablist', { name: 'Colonnes' })).toHaveCount(0);
    // A radius between two stops: shown where it is, never « par défaut ».
    await cellAt(page, '0').locator('.pick').click();
    await page.locator('gf-block-picker:not([inline]) .row[data-group="Où"]').click();
    await expect(page.locator('gf-block-picker:not([inline]) [data-param="r"] output')).toHaveText('3 km');
    const at = Number(await page.locator('gf-block-picker:not([inline]) [data-param="r"] input').inputValue());
    expect(at).toBeGreaterThan(3);
    expect(at).toBeLessThan(4);
  });
});

test.describe('un téléphone', () => {
  test.skip(({ isMobile }) => !isMobile, 'a phone');

  test('construire au doigt : une tuile, la croix', async ({ app, page }) => {
    await app.open(builder('[slot,slot]', ''));
    const panel = page.locator('gf-builder gf-layout .tabpanel:not([hidden])');
    await panel.locator('gf-block-picker[inline] .tile[data-comp="results"]').tap();
    await expect.poll(() => grid(page)).toBe('[results,slot]');
    await panel.locator('.build').first().tap();
    await panel.locator('.arm.bottom').tap();
    await expect.poll(() => grid(page)).toBe('[[results,slot],slot]');
  });
});
