// « Écran sur mesure » (#/layout, app/layout/gf-layout.js): one screen, in use or being modified (« Modifier ⇄ Terminé »,
// edit=1). Here: the home (« Composer un écran »: three grids and the models, each drawn small, each opened being
// modified; Back returns to it), « Changer de modèle », « Créer une app »'s old addresses (#/builder…: the screen they
// name, in their place) and Réglages' card; the cross (cut four ways — the new « Emplacement »'s first tile focused —,
// moved, taken out; 12 cells at most, the last one stays; Échap); the grips; « Modifier ⇄ Terminé » (one entry, every
// change replacing the address and given to the entry it was entered from: « Terminé » and Back land on the screen as
// modified; opened modified, « Terminé » replaces it in place); the cells kept across the toggle (the same map, no tile
// asked again); the picker closed by « Terminé » and by Back; « Avancé » (the text typed, what is wrong said, a
// component unknown shown and replaced through ✎; emptied: still modified); the title (the bar's heading); the phone
// preview (390 px: the layout's own tabs); Partager (the link in use); ⋯; an address that cannot be read; the home
// leaves Flore's search alone; a phone (the toggle's word shown); no tab of the app lit, on either width.
import { test, expect, answerAround } from './fixtures.mjs';
import { editing, layoutOf, screen } from './app.mjs';

/** @typedef {import('@playwright/test').Page} Page */

test.use({ reducedMotion: 'reduce' });
test.beforeEach(async ({ context }) => { await answerAround(context); });

const AT = 'at=48.85,2.35';
/** A parameter of the address. @param {Page} page @param {string} key */
const param = (page, key) => page.evaluate(k => new URLSearchParams(location.hash.split('?')[1] || '').get(k), key);
const hash = (/** @type {Page} */ page) => page.evaluate(() => decodeURIComponent(location.hash));
/** The depth of the entry shown in this visit (history.js). @param {Page} page */
const depthOf = page => page.evaluate(() => history.state?.gfDepth);
/** The cell at a path. @param {Page} page @param {string} path */
const cellAt = (page, path) => page.locator(`gf-layout section.cell[data-cell="${path}"]`);
/** « Modifier ⇄ Terminé ». @param {Page} page */
const toggle = page => page.locator('gf-layout .bar [data-act="modifier"]');
/** ⋯ opened, then one of its items. @param {Page} page */
const more = async page => {
  await page.locator('gf-layout .more-menu summary').click();
  return page.locator('gf-layout .more-menu .menu');
};
/** The element focused, through the shadow roots. @param {Page} page */
const focused = page => page.evaluate(() => {
  let a = document.activeElement;
  while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
  return a ? `${a.tagName.toLowerCase()}.${a.className}[${a.getAttribute('data-comp') ?? ''}]` : '';
});

test.describe('un grand écran', () => {
  test.skip(({ isMobile }) => isMobile, 'a wide screen');

  test('l’accueil : trois grilles et les modèles ; une grille ouverte en modification, ses emplacements et leurs tuiles ; Retour', async ({ app, page }) => {
    await app.open('#/layout');
    await expect(page.getByRole('heading', { level: 1, name: 'Composer un écran' })).toBeVisible();
    await expect(page.locator('gf-layout a[data-grid]')).toHaveText([/Une colonne/, /Trois colonnes/, /Tableau de bord/]);
    await expect(page.locator('gf-layout a[data-model]')).toHaveCount(5);
    await expect(page.locator('gf-layout section.cell')).toHaveCount(0);
    await expect(page).toHaveTitle('Composer un écran — GeoFlora');
    await page.locator('gf-layout a[data-grid="trois"]').click();
    await expect.poll(() => hash(page)).toBe('#/layout/[slot@30,slot@35,slot]?edit=1');
    await expect(page.locator('gf-layout section.cell')).toHaveCount(3);
    await expect(page.locator('gf-layout section.cell[data-comp="slot"] gf-block-picker[inline] .lead')).toHaveText(['Choisir un bloc', 'Choisir un bloc', 'Choisir un bloc']);
    expect(await editing(page)).toBe(true);
    await expect(page).toHaveTitle('Écran sur mesure — GeoFlora');
    await page.goBack();
    await expect.poll(() => hash(page)).toBe('#/layout');
    await expect(page.locator('gf-layout a[data-grid]')).toHaveCount(3);
    // A model: its layout, live, being modified.
    await page.locator('gf-layout a[data-model="carte-recherche-fiche"]').click();
    await expect.poll(() => layoutOf(page)).toBe('[map(r=2km)@34,search@30,plant@36]');
    await expect(cellAt(page, '0').locator('gf-map')).toHaveCount(1);
    expect(await editing(page)).toBe(true);
  });

  test('« Changer de modèle » (⋯) ramène à l’accueil ; Retour rend l’écran en modification', async ({ app, page }) => {
    await app.open(screen('[map,results]', AT, true));
    const before = await layoutOf(page);
    const menu = await more(page);
    const link = menu.getByRole('link', { name: 'Changer de modèle' });
    await expect(link).toHaveAttribute('title', 'Partir d’une autre grille ou d’un autre modèle');
    await expect(menu.getByRole('link', { name: 'Recommencer' })).toHaveCount(0);
    await link.click();
    await expect.poll(() => hash(page)).toBe('#/layout');
    await expect(page.locator('gf-layout a[data-grid]')).toHaveCount(3);
    await page.goBack();
    await expect.poll(() => layoutOf(page)).toBe(before);
    expect(await editing(page)).toBe(true);
  });

  test('les anciens liens de « Créer une app » : l’écran qu’ils nomment, en modification, à leur place ; la carte de Réglages', async ({ app, page }) => {
    await app.open('#/settings');
    const entries = await page.evaluate(() => history.length);
    await app.go('#/builder/trois');
    await expect.poll(() => hash(page)).toBe('#/layout/[slot@30,slot@35,slot]?edit=1');
    await expect(page.locator('gf-layout section.cell')).toHaveCount(3);
    // The link's own entry, replaced: none more.
    expect(await page.evaluate(() => history.length)).toBe(entries + 1);
    await page.goBack();
    await expect.poll(() => hash(page)).toBe('#/settings');
    await app.go('#/builder/tableau?g=[slot,slot]&' + AT);
    await expect.poll(() => layoutOf(page)).toBe('[slot,slot]');
    expect(await param(page, 'at')).toBe('48.85000,2.35000');
    expect(await param(page, 'edit')).toBe('1');
    await expect(page.locator('gf-layout section.cell')).toHaveCount(2);
    // Nothing named, a grid unknown, a stray edit=1: the home.
    for (const old of ['#/builder', '#/builder?g=', '#/builder/inconnue', '#/layout?edit=1']) {
      await app.go(old);
      await expect.poll(() => hash(page), old).toBe('#/layout');
      await expect(page.locator('gf-layout a[data-grid]')).toHaveCount(3);
    }
    // Réglages: « Écran sur mesure » first on the page, « Composer un écran » leads to the home.
    await app.go('#/settings');
    const card = page.locator('gf-settings .builder');
    await expect(card).toContainText('Écran sur mesure');
    const [box, firstH2] = await Promise.all([card.boundingBox(), page.locator('gf-settings h2').first().boundingBox()]);
    expect(box?.y ?? 0).toBeLessThan(firstH2?.y ?? 0);
    await card.getByRole('link', { name: 'Composer un écran' }).click();
    await expect.poll(() => hash(page)).toBe('#/layout');
    await expect(page.getByRole('heading', { level: 1, name: 'Composer un écran' })).toBeVisible();
  });

  test('la croix : diviser dans les quatre sens, déplacer, retirer ; l’adresse garde la disposition', async ({ app, page }) => {
    await app.open(screen('[slot@30,slot@35,slot]', '', true));
    // The build button opens the cross: four arms, the middle; Échap closes it, the button focused again.
    await cellAt(page, '1').locator('.build').click();
    await expect(cellAt(page, '1').locator('.cross .arm')).toHaveCount(4);
    await page.keyboard.press('Escape');
    await expect(cellAt(page, '1').locator('.cross')).toHaveCount(0);
    await expect(cellAt(page, '1').locator('.build')).toBeFocused();
    // Below the middle column: a column of two there, the new place's first tile focused.
    await cellAt(page, '1').locator('.build').click();
    await cellAt(page, '1').locator('.arm.bottom').click();
    await expect.poll(() => layoutOf(page)).toBe('[slot@30,[slot,slot]@35,slot@35]');
    await expect.poll(() => focused(page)).toMatch(/^button\.tile\[/);
    // Right of the new one: a row of two inside; left of the first column: beside it in the top row.
    await cellAt(page, '1.1').locator('.build').click();
    await cellAt(page, '1.1').locator('.arm.right').click();
    await cellAt(page, '0').locator('.build').click();
    await cellAt(page, '0').locator('.arm.left').click();
    await expect.poll(() => layoutOf(page)).toBe('[slot@15,slot@15,[slot,[slot,slot]]@35,slot@35]');
    await expect(page.locator('gf-layout section.cell')).toHaveCount(6);
    // A block built in the last place, moved before its neighbour.
    await cellAt(page, '3').locator('gf-block-picker[inline] .tile[data-comp="results"]').click();
    await cellAt(page, '3').locator('.build').click();
    await cellAt(page, '3').locator('[data-act="before"]').click();
    await expect.poll(() => layoutOf(page)).toBe('[slot@15,slot@15,results@35,[slot,[slot,slot]]@35]');
    await expect(cellAt(page, '2').locator('.build')).toBeFocused();
    // Taken out: its room to its neighbour; a list of one gives way.
    await cellAt(page, '3.1.0').locator('.build').click();
    await cellAt(page, '3.1.0').locator('[data-act="remove"]').click();
    await expect.poll(() => layoutOf(page)).toBe('[slot@15,slot@15,results@35,[slot,slot]@35]');
    // Reloaded: the same, still being modified.
    await page.reload();
    await app.ready();
    await expect(page.locator('gf-layout section.cell')).toHaveCount(5);
    await expect(cellAt(page, '2')).toHaveAttribute('data-comp', 'results');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  });

  test('la croix : ses limites — 12 cases au plus, la dernière reste ; les poignées règlent les parts', async ({ app, page }) => {
    await app.open(screen('[' + Array(12).fill('slot').join(',') + ']', '', true));
    await cellAt(page, '0').locator('.build').click();
    await expect(cellAt(page, '0').locator('.arm:disabled')).toHaveCount(4);
    await app.go(screen('[slot]', '', true));
    await cellAt(page, '0').locator('.build').click();
    await expect(cellAt(page, '0').locator('[data-act="remove"]')).toBeDisabled();
    // The grips: the keyboard moves width from one column to the other, written in the address.
    await app.go(screen('[slot@30,slot@35,slot]', '', true));
    const grip = page.locator('gf-layout [role="separator"]').first();
    await grip.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => Number(/^\[slot@([\d.]+)/.exec(await layoutOf(page))?.[1] ?? 0)).toBeGreaterThan(30);
  });

  test('Modifier ⇄ Terminé : une étape, Terminé revient d’où l’on vient', async ({ app, page }) => {
    // In use: « Modifier » is one entry; a change replaces it; « Terminé » goes back to the entry left, which has it.
    await app.open(screen('[slot,slot]', AT));
    const d0 = await depthOf(page), entries = await page.evaluate(() => history.length);
    await expect(toggle(page)).toHaveText('Modifier');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await toggle(page).click();
    await expect.poll(() => param(page, 'edit')).toBe('1');
    expect(await page.evaluate(() => history.length)).toBe(entries + 1);
    await expect(toggle(page)).toHaveText('Terminé');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle(page)).toBeFocused();
    await cellAt(page, '0').locator('gf-block-picker[inline] .tile[data-comp="results"]').click();
    await expect.poll(() => layoutOf(page)).toBe('[results,slot]');
    await toggle(page).click();
    await expect.poll(() => param(page, 'edit')).toBe(null);
    expect(await depthOf(page)).toBe(d0);
    expect(await layoutOf(page)).toBe('[results,slot]');
    expect(await param(page, 'at')).toBe('48.85000,2.35000');
    expect(await editing(page)).toBe(false);
    // In use, an « Emplacement » is still a place to build in.
    await expect(cellAt(page, '1').locator('gf-block-picker[inline] .tile').first()).toBeVisible();

    // Opened being modified (a link with edit=1): « Terminé » replaces it in place.
    await app.go(screen('[slot,slot]', AT, true));
    await expect(toggle(page)).toHaveText('Terminé');
    const [d1, n1] = [await depthOf(page), await page.evaluate(() => history.length)];
    await toggle(page).click();
    await expect.poll(() => param(page, 'edit')).toBe(null);
    expect(await depthOf(page)).toBe(d1);
    expect(await page.evaluate(() => history.length)).toBe(n1);
    expect(await layoutOf(page)).toBe('[slot,slot]');

    // Back while modified: in use, with what was changed.
    await toggle(page).click();
    await expect.poll(() => param(page, 'edit')).toBe('1');
    await cellAt(page, '1').locator('gf-block-picker[inline] .tile[data-comp="results"]').click();
    await expect.poll(() => layoutOf(page)).toBe('[slot,results]');
    await page.goBack();
    await expect.poll(() => param(page, 'edit')).toBe(null);
    expect(await layoutOf(page)).toBe('[slot,results]');
    await expect(page.locator('gf-layout[editing]')).toHaveCount(0);
    await expect(cellAt(page, '1')).toHaveAttribute('data-comp', 'results');
  });

  test('les cases restent montées : Modifier puis Terminé, la même carte, aucun carreau redemandé', async ({ app, page }) => {
    /** @type {string[]} */
    const tiles = [];
    page.on('request', r => { if (r.resourceType() === 'image' && /GetTile|\/tile|\/\d+\/\d+\/\d+\.(png|jpe?g|webp)/i.test(r.url())) tiles.push(r.url()); });
    await app.open(screen('[map(r=1km),results]', AT));
    const map = page.locator('dl-map gf-map');
    await expect(map).toHaveCount(1);
    await expect.poll(() => tiles.length).toBeGreaterThan(0);
    await page.waitForLoadState('networkidle');
    await map.evaluate(m => { /** @type {any} */ (m).__mark = 1; });
    const asked = tiles.length;
    await toggle(page).click();
    await expect(page.getByRole('region', { name: 'Modifier l’écran' })).toBeVisible();
    expect(await map.evaluate(m => /** @type {any} */ (m).__mark)).toBe(1);
    await toggle(page).click();
    await expect(page.locator('gf-layout[editing]')).toHaveCount(0);
    expect(await map.evaluate(m => /** @type {any} */ (m).__mark)).toBe(1);
    await page.waitForLoadState('networkidle');
    expect(tiles.length - asked, 'aucun carreau demandé de plus').toBe(0);
    expect(new Set(tiles).size, 'aucun carreau demandé deux fois').toBe(tiles.length);
  });

  test('le choix du contenu ouvert, puis Terminé : il se ferme ; Retour depuis la modification aussi', async ({ app, page }) => {
    await app.open(screen('[map(r=1km),results(view=list)]', AT));
    const docked = page.locator('gf-block-picker:not([inline])');
    await toggle(page).click();
    await cellAt(page, '1').locator('.cell-head .pick').click();
    await expect(docked).toBeVisible();
    await toggle(page).click();
    await expect(docked).toHaveCount(0);
    await expect(page.locator('gf-layout[editing]')).toHaveCount(0);
    await toggle(page).click();
    await cellAt(page, '1').locator('.cell-head .pick').click();
    await expect(docked).toBeVisible();
    await page.goBack();
    await expect(docked).toHaveCount(0);
    await expect(page.locator('gf-layout[editing]')).toHaveCount(0);
  });

  test('Partager en modification : le lien d’usage', async ({ app, page }) => {
    await page.addInitScript(() => {
      /** @type {any} */ (window).__copied = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (/** @type {string} */ t) => { /** @type {any} */ (window).__copied.push(t); } } });
    });
    await app.open(screen('[map(r=1km),results]', AT, true));
    const share = page.locator('gf-layout .bar [data-act="share"]');
    await share.click();
    await expect(share).toHaveAttribute('aria-label', 'Lien copié');
    const copied = await page.evaluate(() => /** @type {any} */ (window).__copied);
    expect(copied).toHaveLength(1);
    expect(copied[0]).not.toContain('edit=1');
    expect(decodeURIComponent(copied[0])).toContain('#/layout/[map(r=1km),results]?at=48.85000,2.35000');
  });

  test('« Avancé » : le texte tapé, ce qui ne va pas, un composant inconnu montré puis remplacé ; une erreur de texte l’ouvre d’elle-même', async ({ app, page }) => {
    await app.open(screen('[map,search]', AT, true));
    await (await more(page)).locator('[data-act="text"]').click();
    const field = page.locator('gf-layout #layout-text');
    await expect(field).toHaveValue('[map,search]');
    await expect(field).toBeFocused();
    await field.fill('[mpa,search(filtres),[plant.wiki,plant.calendrier]');
    await expect(page.locator('gf-layout ul.problems')).toContainText('Crochet fermant « ] » manquant');
    await expect(page.locator('gf-layout ul.problems')).toContainText('Composant inconnu « mpa » : vouliez-vous dire « map » ?');
    await expect(cellAt(page, '0')).toContainText('Composant inconnu : « mpa »');
    await expect(page.locator('gf-layout section.cell[data-comp="plant.calendar"]')).toBeVisible();
    // Kept in the address as typed, to be corrected.
    await expect.poll(() => layoutOf(page)).toBe('[mpa,search(filtres),[plant.wiki,plant.calendrier]');
    // ✎ on the unknown one: a map; the text written as the address writes it.
    await cellAt(page, '0').locator('.pick').click();
    await page.locator('gf-block-picker:not([inline]) .tile[data-comp="map"]').click();
    await page.locator('gf-block-picker:not([inline]) .tile[data-intent="explorer"]').click();
    await expect.poll(() => layoutOf(page)).toBe('[map,search(filters=1),[plant.wikipedia,plant.calendar]]');
    await expect(field).toHaveValue('[map,search(filters=1),[plant.wikipedia,plant.calendar]]');
    await expect(page.locator('gf-layout ul.problems')).toHaveCount(0);
    // Folded; a text that cannot be read whole unfolds it by itself.
    await page.keyboard.press('Escape');
    await page.locator('gf-layout .advanced').getByRole('button', { name: 'Fermer le texte' }).click();
    await expect(field).toHaveCount(0);
    await app.go(screen('[map,search', AT, true));
    await expect(field).toHaveValue('[map,search');
  });

  test('« Avancé » vidé : toujours en modification, l’adresse garde la dernière disposition, « Terminé » attend une case', async ({ app, page }) => {
    await app.open(screen('[map,search]', AT, true));
    await (await more(page)).locator('[data-act="text"]').click();
    await page.locator('gf-layout #layout-text').fill('');
    await expect(page.locator('gf-layout p.problems')).toContainText('Disposition vide');
    await expect(toggle(page)).toBeDisabled();
    expect(await layoutOf(page)).toBe('[map,search]');
    expect(await param(page, 'edit')).toBe('1');
    await expect(page.locator('gf-layout[editing]')).toHaveCount(1);
  });

  test('le titre : tapé, l’adresse remplacée (pas de nouvelle entrée), le titre de la barre et de l’onglet ; jamais du HTML', async ({ app, page }) => {
    await app.open(screen('[search,results]', AT, true));
    const h1 = page.locator('gf-layout .bar h1');
    await expect(h1).toHaveText('Écran sur mesure');
    const entries = await page.evaluate(() => history.length);
    const field = page.locator('gf-layout #layout-title');
    await field.fill('Mes  plantes ');
    await expect.poll(() => param(page, 'title')).toBe('Mes plantes');
    await expect(h1).toHaveText('Mes plantes');
    await expect(page).toHaveTitle('Mes plantes · GeoFlora');
    await expect(field).toHaveValue('Mes  plantes ');
    expect(await page.evaluate(() => history.length)).toBe(entries);
    await field.fill('<b>Prés</b>');
    await expect(h1).toHaveText('<b>Prés</b>');
    await expect(page.locator('gf-layout .bar h1 b')).toHaveCount(0);
    await field.fill('');
    await expect.poll(() => param(page, 'title')).toBe(null);
    await expect(h1).toHaveText('Écran sur mesure');
    await expect(page).toHaveTitle('Écran sur mesure — GeoFlora');
  });

  test('l’aperçu « Téléphone » : 390 px, les onglets de l’écran ; le rayon d’une case entre deux crans', async ({ app, page }) => {
    await app.open(screen('[map(r=3km),place]', AT, true));
    await expect(page.getByRole('tablist', { name: 'Colonnes' })).toHaveCount(0);
    await page.locator('gf-layout [data-preview="phone"]').click();
    await expect(page.locator('gf-layout [data-preview="phone"]')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => Math.round((await page.locator('gf-layout .stage.phone').boundingBox())?.width ?? 0)).toBeLessThanOrEqual(390);
    await expect(page.getByRole('tablist', { name: 'Colonnes' })).toBeVisible();
    await page.locator('gf-layout [data-preview="computer"]').click();
    await expect(page.getByRole('tablist', { name: 'Colonnes' })).toHaveCount(0);
    // A radius between two stops: shown where it is, never « par défaut ».
    await cellAt(page, '0').locator('.pick').click();
    await page.locator('gf-block-picker:not([inline]) .row[data-group="Où"]').click();
    await expect(page.locator('gf-block-picker:not([inline]) [data-param="r"] output')).toHaveText('3 km');
    const at = Number(await page.locator('gf-block-picker:not([inline]) [data-param="r"] input').inputValue());
    expect(at).toBeGreaterThan(3);
    expect(at).toBeLessThan(4);
  });

  test('une adresse illisible n’est pas l’accueil : ses remarques, « Modifier »', async ({ app, page }) => {
    await app.open('#/layout/[');
    await expect(page.locator('gf-layout .remarks')).toBeVisible();
    await expect(toggle(page)).toBeVisible();
    await expect(page.locator('gf-layout .placeholder')).toContainText('Aucune case lisible dans cet écran.');
    await expect(page.getByRole('heading', { name: 'Composer un écran' })).toHaveCount(0);
    // « Voir et corriger »: modified, the text unfolded.
    await page.locator('gf-layout .remarks').getByRole('button', { name: 'Voir et corriger' }).click();
    await expect(page.locator('gf-layout #layout-text')).toHaveValue('[');
  });

  test('l’accueil ne touche pas la recherche de Flore', async ({ app, page }) => {
    await app.open('#/?q=ortie');
    await expect.poll(() => app.state('query.q')).toBe('ortie');
    await app.go('#/layout');
    await expect(page.getByRole('heading', { level: 1, name: 'Composer un écran' })).toBeVisible();
    expect(await app.state('query.q')).toBe('ortie');
  });

  test('⋯ en usage : « Composer un écran » ; Échap le ferme', async ({ app, page }) => {
    await app.open(screen('[map,results]', AT));
    const item = (await more(page)).getByRole('link', { name: 'Composer un écran' });
    await expect(item).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(item).toBeHidden();
    await expect(page.locator('gf-layout .more-menu summary')).toBeFocused();
    await (await more(page)).getByRole('link', { name: 'Composer un écran' }).click();
    await expect.poll(() => hash(page)).toBe('#/layout');
  });
});

test.describe('un téléphone', () => {
  test.skip(({ isMobile }) => !isMobile, 'a phone');

  test('construire au doigt : une tuile, la croix', async ({ app, page }) => {
    await app.open(screen('[slot,slot]', '', true));
    const panel = page.locator('gf-layout .tabpanel:not([hidden])');
    await panel.locator('gf-block-picker[inline] .tile[data-comp="results"]').tap();
    await expect.poll(() => layoutOf(page)).toBe('[results,slot]');
    await panel.locator('.build').first().tap();
    await panel.locator('.arm.bottom').tap();
    await expect.poll(() => layoutOf(page)).toBe('[[results,slot],slot]');
  });

  test('la bascule montre son mot, le titre de l’écran aussi', async ({ app, page }) => {
    await app.open(screen('[map,results]', AT + '&title=Mes%20plantes'));
    await expect(toggle(page)).toBeVisible();
    await expect(toggle(page)).toHaveText('Modifier');
    await expect(page.locator('gf-layout .bar h1')).toBeVisible();
    await expect(page.locator('gf-layout .bar h1')).toHaveText('Mes plantes');
    await toggle(page).tap();
    await expect(toggle(page)).toHaveText('Terminé');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  });
});

test('aucun onglet allumé : l’accueil, l’écran, sa modification', async ({ app, page }) => {
  // The tab bar's (a phone) and the header's (a computer).
  const lit = page.locator('gf-tabbar a[aria-current="page"], gf-app nav.tabs a[aria-current="page"]');
  await app.open('#/discover');
  await expect(lit).toHaveCount(1);
  await app.go('#/layout');
  await expect(page.getByRole('heading', { level: 1, name: 'Composer un écran' })).toBeVisible();
  await expect(lit).toHaveCount(0);
  await app.go(screen('[search,results]', AT));
  await expect(toggle(page)).toHaveText('Modifier');
  await expect(lit).toHaveCount(0);
  await toggle(page).click();
  await expect(toggle(page)).toHaveText('Terminé');
  await expect(lit).toHaveCount(0);
});
