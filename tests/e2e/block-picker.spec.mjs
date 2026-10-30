// The block picker (app/layout/gf-block-picker.js) on a screen of one's own being modified: one panel that edits one cell of
// the layout being built through the registry's schema, and its first level drawn in each « Emplacement » (slot). Here:
// a cell's picker (✎) opened on its settings, docked beside the live layout; the map changed for the results then back
// to a map with an intent; a group of settings (Fond → photos, 2D, layers as chips) — the cell and the screen's address
// following at once (no new entry), its row marked ●, « Revenir à l'intention »; Échap closing it, the focus back on
// its button; the frame (a cell without a head in the app has one here) and the links; « Changer de bloc » (an
// « Emplacement » again, its tiles); a place's tiles: one tap builds a block there (a sheet's block; the map's intent
// first), a block too large for the place greyed with why; a phone's bottom sheet.
import { test, expect, answerAround } from './fixtures.mjs';
import { layoutOf, screen } from './app.mjs';
import { modelSpec } from '../../app/layout/models.js';

/** @typedef {import('@playwright/test').Page} Page */

test.use({ reducedMotion: 'reduce' });

const AT = 'at=48.85,2.35';
const LAYOUT = '[map(r=1km),results(view=list)]';

test.beforeEach(async ({ context }) => { await answerAround(context); });

/** The docked picker (not a place's tiles). @param {Page} page */
const picker = page => page.locator('gf-block-picker:not([inline])');
/** The cell at a path. @param {Page} page @param {string} path */
const cellAt = (page, path) => page.locator(`gf-layout section.cell[data-cell="${path}"]`);
/** A place's tiles. @param {Page} page @param {string} path */
const tilesAt = (page, path) => cellAt(page, path).locator('gf-block-picker[inline]');
/** A screen of one's own being modified, with its layout. @param {string} spec @param {string} [state] */
const modified = (spec, state = AT) => screen(spec, state, true);

test.describe('un grand écran', () => {
  test.skip(({ isMobile }) => isMobile, 'a wide screen');

  test('choisir le contenu d’une case, son intention, un groupe de réglages : la case et l’adresse suivent', async ({ app, page }) => {
    await app.open(modified(LAYOUT));
    await expect(cellAt(page, '0')).toHaveAttribute('data-comp', 'map');
    const entries = await page.evaluate(() => history.length);
    const pick = cellAt(page, '0').locator('.cell-head .pick');
    await pick.click();
    const p = picker(page);
    await expect(p).toBeVisible();
    // A known cell opens on its settings: « Case 1 › Carte », the intent's row then a row per group.
    await expect(p.locator('ol.crumbs li')).toHaveText(['Case 1', 'Carte']);
    await expect(p.locator('.row')).toHaveText([/Que montre-t-il/, /Où/, /Fond/, /Couches/, /Points/, /Liens/, /Interface/, /Cadre/]);
    await expect(p.locator('.row[data-group="Où"] small')).toHaveText('1 km');
    // Docked on the right of the screen, its cells beside it.
    await expect.poll(() => page.evaluate(() => {
      const gl = /** @type {any} */ (document.querySelector('gf-app')?.shadowRoot?.querySelector('gf-layout'));
      const stage = gl.shadowRoot.querySelector('.stage'), pk = gl.shadowRoot.querySelector('gf-block-picker:not([inline])').getBoundingClientRect();
      return { right: Math.round(pk.right - innerWidth), top: Math.round(pk.top - gl.getBoundingClientRect().top), beside: stage.getBoundingClientRect().right <= pk.left + 1 };
    })).toEqual({ right: 0, top: 0, beside: true });

    // The content: the results instead of the map — the cell and the address at once.
    await p.locator('[data-act="content"]').click();
    await expect(p.locator('h2')).toHaveText('Contenu');
    await expect(p.locator('h2')).toBeFocused();
    // Never the « Emplacement » itself among the blocks.
    await expect(p.locator('.tile[data-comp="slot"]')).toHaveCount(0);
    await p.locator('.tile[data-comp="results"]').click();
    await expect.poll(() => layoutOf(page)).toBe('[results,results(view=list)]');
    await expect(cellAt(page, '0')).toHaveAttribute('data-comp', 'results');
    await expect(p.locator('ol.crumbs li')).toHaveText(['Case 1', 'Résultats']);
    await expect(p.locator('.row')).toHaveText([/Réglages/, /Cadre/, /Liens/]);

    // Back to a map, with its intent (one tap): Floraison du moment.
    await p.locator('ol.crumbs button', { hasText: 'Case 1' }).click();
    await p.locator('.tile[data-comp="map"]').click();
    await expect(p.locator('h2')).toHaveText('Que montre-t-il ?');
    await expect(p.locator('.tile[data-intent="floraison"] .chips span')).toHaveText(['Ce mois-ci', 'Plante courante en groupes']);
    await p.locator('.tile[data-intent="floraison"]').click();
    await expect.poll(() => layoutOf(page)).toBe('[map(floraison),results(view=list)]');
    await expect(cellAt(page, '0')).toHaveAttribute('data-comp', 'map');
    await expect(p.locator('.row[data-group="Points"] small')).toHaveText('Ce mois-ci · Plante courante en groupes');

    // A group: Fond → plan IGN; its row marked, the map's background the plan.
    await p.locator('.row[data-group="Fond"]').click();
    await expect(p.locator('ol.crumbs li')).toHaveText(['Case 1', 'Carte', 'Fond']);
    await p.locator('[data-param="base"] button[data-value="plan"]').click();
    await expect.poll(() => layoutOf(page)).toBe('[map(floraison,base=plan),results(view=list)]');
    await expect.poll(() => cellAt(page, '0').locator('dl-map gf-map').evaluate(m => /** @type {any} */ (m).look?.base)).toBe('plan');
    await expect(p.locator('[data-param="base"] button[data-value="plan"]')).toHaveAttribute('aria-pressed', 'true');
    // The 3D: a row of three (as the app's settings say, or not); Back to the rows, the line says both.
    await p.locator('[data-param="3d"] button[data-value="false"]').click();
    await expect.poll(() => layoutOf(page)).toBe('[map(floraison,base=plan,3d=0),results(view=list)]');
    await p.locator('.back').click();
    await expect(p.locator('.row[data-group="Fond"]')).toContainText('Plan IGN · 2D');
    await expect(p.locator('.row[data-group="Fond"] .dot')).toHaveCount(1);
    await expect(p.locator('.row[data-group="Points"] .dot')).toHaveCount(0);
    // Couches: chips.
    await p.locator('.row[data-group="Couches"]').click();
    await p.locator('[data-param="layers"] button[data-value="znieff"]').click();
    await expect.poll(() => layoutOf(page)).toBe('[map(floraison,base=plan,3d=0,layers=znieff),results(view=list)]');
    await p.locator('.back').click();
    // « Revenir à l'intention »: the settings written beside it gone.
    await p.locator('[data-act="reset"]').click();
    await expect.poll(() => layoutOf(page)).toBe('[map(floraison),results(view=list)]');
    await expect(p.locator('[data-act="reset"]')).toHaveCount(0);
    // The layout's state kept beside it, every change replacing the address.
    expect(await page.evaluate(() => location.hash)).toContain('at=48.85000,2.35000');
    expect(await page.evaluate(() => history.length)).toBe(entries);

    // Échap closes; the focus back on the cell's button.
    await page.keyboard.press('Escape');
    await expect(p).toHaveCount(0);
    await expect(pick).toBeFocused();
  });

  test('le cadre et les liens d’une case (une case sans en-tête en usage en a un en modification) ; « Changer de bloc », les tuiles d’un emplacement', async ({ app, page }) => {
    await app.open(modified('[map(tete=non),results(list),plant]'));
    await cellAt(page, '0').locator('.cell-head .pick').click();
    const p = picker(page);
    await p.locator('.row[data-group="Cadre"]').click();
    await p.locator('[data-param="tete"] button[data-value="simple"]').click();
    await p.locator('[data-param="actions"] button[data-value="agrandir"]').click();
    await p.locator('[data-param="titre"] input').fill('Ici, (la) carte');
    await p.locator('[data-param="titre"] input').press('Enter');
    await expect.poll(() => layoutOf(page)).toBe('[map(tete=simple,actions=agrandir,titre=Ici la carte),results(view=list),plant]');
    await expect(cellAt(page, '0').locator('.cell-head h2')).toHaveText('Ici la carte');
    await page.keyboard.press('Escape');
    // The sheet: its links (a plant of its own…); « Changer de bloc »: an « Emplacement », its tiles, the first focused.
    await cellAt(page, '2').locator('.cell-head .pick').click();
    await p.locator('.row[data-group="Liens"]').click();
    await expect(p.locator('[data-param="plante"] input')).toHaveAttribute('placeholder', 'la plante courante');
    await p.locator('.back').click();
    await p.locator('[data-act="content"]').click();
    await p.locator('[data-act="clear"]').click();
    await expect.poll(() => layoutOf(page)).toBe('[map(tete=simple,actions=agrandir,titre=Ici la carte),results(view=list),slot]');
    await expect(p).toHaveCount(0);
    await expect(cellAt(page, '2')).toHaveAttribute('data-comp', 'slot');
    await expect(tilesAt(page, '2').locator('.lead')).toHaveText('Choisir un bloc');
    await expect(tilesAt(page, '2').locator('.tile').first()).toBeFocused();
    // A map and results choose a plant, nothing shows it: the sheet first; its blocks a level of their own, in the place.
    await expect(tilesAt(page, '2').locator('.tile').first()).toHaveAttribute('data-comp', 'plant');
    await tilesAt(page, '2').locator('.tile[data-comp="plant"]').click();
    await expect(tilesAt(page, '2').locator('.lead')).toHaveText('Fiche : un bloc');
    await tilesAt(page, '2').locator('.tile[data-view="wikipedia"]').click();
    await expect.poll(() => layoutOf(page)).toBe('[map(tete=simple,actions=agrandir,titre=Ici la carte),results(view=list),plant.wikipedia]');
    await expect(cellAt(page, '2')).toHaveAttribute('data-comp', 'plant.wikipedia');
  });

  test('les tuiles d’un emplacement : à sa taille, jamais un bloc refusé (un conseil quand la case est petite) ; la carte, son intention d’abord', async ({ app, page }) => {
    await app.open(modified(/** @type {string} */ (modelSpec('tableau')), ''));
    // The row of three, 22 % of the height: compact tiles; a little low for a map — said, never refused.
    const small = tilesAt(page, '1.0.0');
    await expect(small.locator('.tile small').first()).toBeHidden();
    await expect(small.locator('.tile[aria-disabled="true"]')).toHaveCount(0);
    const map = small.locator('.tile[data-comp="map"]');
    await expect(map.locator('.why.small')).toHaveText(/Un peu bas pour « Carte » : 180 px de haut conseillés \(la case en a \d+\)/);
    for (const id of ['map', 'results', 'filters']) await expect(small.locator(`.tile[data-comp="${id}"]`)).toBeEnabled();
    await map.click();
    await expect(small.locator('.lead')).toHaveText('Carte : que montre-t-elle ?');
    await small.locator('.tile[data-intent="explorer"]').click();
    await expect.poll(() => layoutOf(page)).toBe('[slot@20,[[map,slot,slot]@22,slot@46,[slot@60,slot]]]');
    // A large place: its sentences; a map, its intent first, in the place.
    await app.go(modified('[slot,slot]', ''));
    const large = tilesAt(page, '1');
    await expect(large.locator('.tile[data-comp="map"] small')).toBeVisible();
    await large.locator('.tile[data-comp="map"]').click();
    await expect(large.locator('.lead')).toHaveText('Carte : que montre-t-elle ?');
    await large.locator('.tile[data-intent="terrain"]').click();
    await expect.poll(() => layoutOf(page)).toBe('[slot,map(terrain)]');
    await expect(cellAt(page, '1')).toHaveAttribute('data-comp', 'map');
    await expect(cellAt(page, '1').locator('gf-map')).toHaveCount(1);
  });
});

test.describe('un téléphone', () => {
  test.skip(({ isMobile }) => !isMobile, 'a phone');

  test('le choix du contenu en feuille du bas', async ({ app, page }) => {
    await app.open(modified(LAYOUT));
    const pick = page.locator('gf-layout .tabpanel:not([hidden]) section.cell .cell-head .pick').first();
    await expect(pick).toBeVisible();
    await pick.tap();
    const panel = picker(page).locator('.panel');
    await expect(panel).toBeVisible();
    const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await panel.boundingBox());
    const vp = /** @type {{ width: number, height: number }} */ (page.viewportSize());
    expect(Math.round(box.width)).toBe(vp.width);
    expect(box.height).toBeLessThanOrEqual(vp.height * 0.85 + 1);
    // Above the app's bottom bar: the screen's own bottom.
    await expect.poll(() => page.evaluate(() => {
      const gl = /** @type {any} */ (document.querySelector('gf-app')?.shadowRoot?.querySelector('gf-layout'));
      const pk = gl.shadowRoot.querySelector('gf-block-picker:not([inline])');
      return Math.round(pk.getBoundingClientRect().bottom - gl.getBoundingClientRect().bottom);
    })).toBe(0);
    // A group, scrolled inside the sheet; a change applied.
    await picker(page).locator('.row[data-group="Fond"]').tap();
    await picker(page).locator('[data-param="base"] button[data-value="plan"]').tap();
    await expect.poll(() => layoutOf(page)).toBe('[map(r=1km,base=plan),results(view=list)]');
    await picker(page).locator('.close').tap();
    await expect(picker(page)).toHaveCount(0);
  });
});
