// « Écran sur mesure » : groups (registry.js FRAME groupe). The cells of one group share a zone, a plant, a period and a
// search; another group's are apart — two lists, two maps that do not follow each other on one screen. The first group
// (a) keeps the address' keys as before; another's are after its letter (b.q=, b.at=, b.p=…). Each search its own
// (core/search-channel.js), the first's too — never Flore's; reloaded, the same; being modified, a cell's group chosen in
// « Liens » of its picker, a letter in its colour on each head, the colour down each cell's edge (its letter on its top
// without a head, its group in its name), its letter on a phone's tabs — never the colour alone, lighter in the dark.
// A cell talks to its group alone: a plant chosen in b brings a tab of b's; ⤢ on a block of b's sheet, a funnel of b's
// grid, never a cell of a; a b cell's « Plante » chip and « Fixer la plante courante » take b's plant. iNaturalist
// answered here: the zone's observations, of 12 plants (their plants the list).
import { test, expect, answerAround, answerZone, plantId } from './fixtures.mjs';
import { layoutOf, screen, screenSearch } from './app.mjs';

/** @typedef {import('@playwright/test').Page} Page */

test.use({ reducedMotion: 'reduce' });
test.beforeEach(async ({ context, page }) => { await answerAround(context); await answerZone(page); });

const param = (/** @type {Page} */ page, /** @type {string} */ key) => page.evaluate(k => new URLSearchParams(location.hash.split('?')[1] || '').get(k), key);
const cellOf = (/** @type {Page} */ page, /** @type {string} */ path) => page.locator(`gf-layout section.cell[data-cell="${path}"]`);
/** The names a results cell lists. @param {Page} page @param {string} path */
const names = (page, path) => cellOf(page, path).locator('gf-plant-list').evaluate(l => /** @type {any} */ (l).shadowRoot ? [...l.shadowRoot.querySelectorAll('gf-plant-card')].map(c => /** @type {any} */ (c).plant?.scientificName ?? '') : []);

test.describe('un grand écran', () => {
  test.skip(({ isMobile }) => isMobile, 'a wide screen');

  test('deux groupes : deux recherches, deux zones, deux plantes — chacune dans l’adresse après sa lettre ; rechargé, les mêmes', async ({ app, page }) => {
    await app.open(`#/layout/[search(list=0),results(list),search(list=0,groupe=b),results(list,groupe=b)]?q=ortie&b.at=48.85,2.35&b.r=1km`);
    // A letter on each head: two groups.
    await expect(cellOf(page, '0').locator('.cell-group')).toHaveText('A');
    await expect(cellOf(page, '2').locator('.cell-group')).toHaveText('B');
    // The first: its own search (ortie), the whole flora — Flore's untouched; the second: the 12 plants of its zone, no text.
    await expect.poll(async () => (await screenSearch(page, 'a'))?.query.q).toBe('ortie');
    expect(await app.state('query.q')).toBe('');
    await expect.poll(async () => (await names(page, '1')).every(n => /Urtica/.test(n)) && (await names(page, '1')).length > 0).toBe(true);
    await expect.poll(async () => (await names(page, '3')).length).toBe(12);
    // Typed in the second's search: its list and its keys only.
    await cellOf(page, '2').locator('gf-plant-search input').fill('allium');
    await expect.poll(() => param(page, 'b.q')).toBe('allium');
    await expect.poll(async () => (await names(page, '3')).every(n => /^Allium/.test(n))).toBe(true);
    expect(await param(page, 'q')).toBe('ortie');
    expect((await screenSearch(page, 'a'))?.query.q).toBe('ortie');
    expect((await screenSearch(page, 'b'))?.query.q).toBe('allium');
    expect(await app.state('query.q')).toBe('');
    // A plant chosen in the first: its p=, never the second's.
    await cellOf(page, '1').locator('gf-plant-card a.row').first().click();
    await expect.poll(() => param(page, 'p')).not.toBe(null);
    expect(await param(page, 'b.p')).toBe(null);
    // Reloaded: the same two searches.
    await page.reload();
    await app.ready();
    await expect.poll(async () => (await screenSearch(page, 'a'))?.query.q).toBe('ortie');
    await expect.poll(async () => (await screenSearch(page, 'b'))?.query.q).toBe('allium');
    expect(await app.state('query.q')).toBe('');
    await expect(cellOf(page, '2').locator('gf-plant-search input')).toHaveValue('allium');
    await expect.poll(async () => (await names(page, '3')).every(n => /^Allium/.test(n)) && (await names(page, '3')).length > 0).toBe(true);
  });

  test('en modification : le groupe d’une case choisi dans « Liens » de son contenu', async ({ app, page }) => {
    await app.open(screen('[results,results]', 'q=ortie', true));
    await page.locator('gf-layout section.cell[data-cell="1"] .cell-head .pick').click();
    const picker = page.locator('gf-block-picker:not([inline])');
    await picker.locator('.row[data-group="Liens"]').click();
    await picker.locator('[data-param="groupe"] button[data-value="b"]').click();
    await expect.poll(() => layoutOf(page)).toBe('[results,results(groupe=b)]');
    await expect(page.locator('gf-layout section.cell[data-cell="1"] .cell-group')).toHaveText('B');
  });

  test('les groupes se voient : une couleur par groupe le long de chaque case, avec ou sans en-tête ; un seul groupe, aucune', async ({ app, page }) => {
    await app.open('#/layout/[results(list),results(list,groupe=b,tete=simple),plant(groupe=b,tete=non)]?q=ortie&b.q=ail');
    await expect(cellOf(page, '0')).toHaveAttribute('data-group', 'a');
    await expect(cellOf(page, '1')).toHaveAttribute('data-group', 'b');
    await expect(cellOf(page, '2')).toHaveAttribute('data-group', 'b');
    // Its letter in a head of its title alone too; its colour down its edge, a's the accent's, b's its own.
    await expect(cellOf(page, '1').locator('.cell-head .cell-group')).toHaveText('B');
    const edge = (/** @type {string} */ path) => cellOf(page, path).evaluate(el => getComputedStyle(el, '::before').backgroundColor);
    expect(await edge('1')).toBe('rgb(29, 78, 216)');
    expect(await edge('2')).toBe('rgb(29, 78, 216)');
    expect(await edge('0')).not.toBe(await edge('1'));
    // Never its colour alone: its name says its group; without a head, its letter on its edge's top.
    await expect(cellOf(page, '2')).toHaveAttribute('aria-label', /^Fiche — groupe B$/);
    await expect(cellOf(page, '0')).toHaveAttribute('aria-label', / — groupe A$/);
    await expect(cellOf(page, '1').locator('.cell-head .cell-group')).toHaveAccessibleName('Groupe B');
    const letter = (/** @type {string} */ path) => cellOf(page, path).evaluate(el => getComputedStyle(el, '::after').content);
    expect(await letter('2')).toBe('"b"');
    expect(await letter('1')).toBe('none');
    // One group: no letter, no colour.
    await app.go('#/layout/[results(list),plant(tete=non)]?q=ortie');
    await expect(page.locator('gf-layout section.cell[data-group]')).toHaveCount(0);
    await expect(page.locator('gf-layout .cell-group')).toHaveCount(0);
    expect(await letter('1')).toBe('none');
    await expect(cellOf(page, '1')).toHaveAttribute('aria-label', 'Fiche');
  });

  test('une case ne parle qu’à son groupe : ⤢ sur un bloc de la fiche de b ouvre son panneau, jamais la case de a qui montre ce bloc ; dans a, cette case-là', async ({ app, page }) => {
    const ail = plantId('Allium ursinum'), ortie = plantId('Urtica dioica');
    await app.open(`#/layout/[plant(groupe=b),plant.taxonomy]?p=${ail}&b.p=${ortie}`);
    const sheet = cellOf(page, '0').locator('gf-plant-detail');
    await expect(sheet).toHaveAttribute('plant-id', String(ortie));
    await sheet.getByRole('button', { name: 'Ouvrir « Classification » en panneau' }).click();
    // b's own pane (its nettle's block), a's cell (the garlic's) never flashed for it.
    await expect(sheet.locator('dialog.pane')).toHaveAttribute('open', '');
    await expect(cellOf(page, '1')).not.toHaveClass(/flash/);
    // The same in one group: the cell that shows the block flashes, no pane.
    await app.go(`#/layout/[plant,plant.taxonomy]?p=${ail}`);
    const own = cellOf(page, '0').locator('gf-plant-detail');
    await expect(own).toHaveAttribute('plant-id', String(ail));
    await own.getByRole('button', { name: 'Ouvrir « Classification » en panneau' }).click();
    await expect(cellOf(page, '1')).toHaveClass(/flash/);
    await expect(own.locator('dialog.pane[open]')).toHaveCount(0);
  });

  test('une case ne parle qu’à son groupe : l’entonnoir d’une colonne de la grille de b ouvre les filtres de la recherche de b, jamais ceux de a', async ({ app, page }) => {
    await app.open('#/layout/[search(list=0),results(grid,groupe=b),search(list=0,groupe=b)]?b.q=ortie&b.family=Urticaceae');
    const funnel = cellOf(page, '1').locator('gf-plant-list .th .funnel');
    await expect(funnel).toBeVisible();
    await funnel.click();
    // b's filters opened (written in its cell), its family's filter brought into view; a's left closed.
    await expect(cellOf(page, '2').locator('dl-search gf-filter-panel gf-facet[name="family"]')).toHaveAttribute('open', '');
    await expect.poll(() => layoutOf(page)).toBe('[search(list=0),results(view=grid,groupe=b),search(filters=1,list=0,groupe=b)]');
    await expect(cellOf(page, '0').locator('dl-search gf-filter-panel')).toHaveCount(0);
  });

  test('en modification, une case du groupe b : sa pastille « Plante » et « Fixer la plante courante » prennent la plante de b, jamais celle de a', async ({ app, page }) => {
    const ail = plantId('Allium ursinum'), ortie = plantId('Urtica dioica');
    await app.open(screen('[plant.calendar,plant.status(groupe=b)]', `p=${ail}&b.p=${ortie}`, true));
    const b = cellOf(page, '1');
    await b.locator('.cell-head .link-chip[data-link="plante"]').click();
    await expect.poll(() => layoutOf(page)).toBe(`[plant.calendar,plant.status(plante=${ortie},groupe=b)]`);
    // Attached again, then fixed from its picker: b's plant again.
    await b.locator('.cell-head .link-chip[data-link="plante"]').click();
    await expect.poll(() => layoutOf(page)).toBe('[plant.calendar,plant.status(groupe=b)]');
    await b.locator('.cell-head .pick').click();
    const picker = page.locator('gf-block-picker:not([inline])');
    await picker.locator('.row[data-group="Liens"]').click();
    await picker.locator('[data-param="plante"] [data-act="fix"]').click();
    await expect.poll(() => layoutOf(page)).toBe(`[plant.calendar,plant.status(plante=${ortie},groupe=b)]`);
  });
});

test.describe('un téléphone', () => {
  test.skip(({ isMobile }) => !isMobile, 'a phone: the columns as tabs');

  test('une plante choisie dans le groupe b amène l’onglet d’une fiche de b, jamais celle de a ; chaque onglet a un point par groupe de ses cases, et le dit', async ({ app, page }) => {
    await app.open('#/layout/[results(list,groupe=b),plant.calendar,plant.status(groupe=b)]?b.q=ortie');
    const tabs = page.getByRole('tablist', { name: 'Colonnes' }).getByRole('tab');
    await expect(tabs.nth(0).locator('.dots i')).toHaveCount(1);
    await expect(tabs.nth(0).locator('.dots i[data-group="b"]')).toHaveCount(1);
    await expect(tabs.nth(1).locator('.dots i[data-group="a"]')).toHaveCount(1);
    await expect(tabs.nth(0)).toHaveAccessibleName(/ — groupe B$/);
    await expect(tabs.nth(0)).toHaveAttribute('title', / — groupe B$/);
    await expect(tabs.nth(1)).toHaveAccessibleName(/ — groupe A$/);
    await cellOf(page, '0').locator('gf-plant-card a.row').first().click();
    await expect.poll(() => param(page, 'b.p')).not.toBe(null);
    expect(await param(page, 'p')).toBe(null);
    await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
    await expect(cellOf(page, '2').locator('gf-plant-detail')).toHaveAttribute('plant-id', /** @type {string} */ (await param(page, 'b.p')));
  });

  test('chaque onglet dit ses groupes par leur lettre, jamais par leur seule couleur ; en sombre, des couleurs plus claires, lisibles sur l’onglet', async ({ app, page }) => {
    await app.open('#/layout/[results(list,groupe=b),plant.calendar,results(list,groupe=c)]?b.q=ortie&c.q=ail');
    const tabs = page.getByRole('tablist', { name: 'Colonnes' }).getByRole('tab');
    const mark = (/** @type {number} */ i, /** @type {string} */ g) => tabs.nth(i).locator(`.dots i[data-group="${g}"]`).evaluate(el => ({ letter: getComputedStyle(el, '::before').content, background: getComputedStyle(el).backgroundColor }));
    expect(await mark(0, 'b')).toEqual({ letter: '"b"', background: 'rgb(29, 78, 216)' });
    expect((await mark(2, 'c')).letter).toBe('"c"');
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await mark(0, 'b')).toEqual({ letter: '"b"', background: 'rgb(126, 166, 255)' });
    expect((await mark(2, 'c')).background).toBe('rgb(183, 156, 255)');
    expect(await cellOf(page, '0').evaluate(el => getComputedStyle(el, '::before').backgroundColor)).toBe('rgb(126, 166, 255)');
  });
});
