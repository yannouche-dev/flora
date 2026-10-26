// « Personnaliser la fiche » (code name: King), on the sheet itself: its crown, at the end of the action bar of Flore's
// and Mes plantes' sheets, opens the bar « Mise en page de la fiche » there only — not on a block alone, a free
// layout's cell, the other host's sheet —, for the visit (never stored); the bar names and switches the mode arranged
// without changing the app's (core/store.js king, arrange, arrangedMode). Everything Réglages' lists did is done on the
// sheet (« Par défaut », « Barre d’actions », blocks, sub-blocks, styles, titles, Note and Carte blocks, Page web by
// keyboard, a block whose service is off, folded panes); Plantes à confondre, Usages and its Prudence never hide; on a
// phone nothing overflows, every target is 44 px and a finger on a title scrolls. Réglages › Mise en page de la fiche
// is one card: its button opens the last plant read (else the first result) personalised, the file carries the layout
// and the modes (never the Note blocks' texts), « Tout rétablir » keeps the modes, the Note blocks and their texts.
import { readFileSync } from 'node:fs';
import { test, expect, plantId } from './fixtures.mjs';
import { swipe, centre } from './touch.mjs';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').Locator} Locator */

const ORTIE = plantId('Urtica dioica');
const AIL = plantId('Allium ursinum');
/** A function of core/sheet-blocks.js, called in the page. @param {Page} page @param {string} name @param {...unknown} args */
const sb = (page, name, ...args) => page.evaluate(async ([n, a]) => /** @type {any} */ (await import('/app/core/sheet-blocks.js'))[/** @type {string} */ (n)](.../** @type {unknown[]} */ (a)), [name, args]);
/** « Déplacer « title » vers… » on the sheet, then a choice. @param {Locator} sheet @param {string} title @param {string} item */
async function moveTo(sheet, title, item) {
  await sheet.locator(`summary[aria-label="Déplacer « ${title} » vers…"]`).first().click();
  await sheet.locator('details[open] .move-menu').getByRole('menuitem', { name: item }).click();
}
/** Flore's sheet (not the card underneath). @param {Page} page */
const flore = page => page.locator('gf-plant-detail[sheet="flore"]:not([preview])');
/** @param {import('@playwright/test').Locator} sheet */
const crown = sheet => sheet.locator('.action-bar').getByRole('button', { name: 'Personnaliser la fiche', exact: true });
/** @param {import('@playwright/test').Locator} sheet */
const bar = sheet => sheet.getByRole('region', { name: 'Mise en page de la fiche' });
/** The blocks of the sheet personalised, in order. @param {import('@playwright/test').Locator} sheet */
const order = sheet => sheet.locator('.blocks.king > .block').evaluateAll(els => els.map(e => /** @type {HTMLElement} */ (e).dataset.key));
/** Is a block folded in a mode (core/sheet-blocks.js)? @param {Page} page @param {string} mode @param {string} key */
const hidden = (page, mode, key) => page.evaluate(async ([m, k]) => (await import('/app/core/sheet-blocks.js')).isHidden(m, k), [mode, key]);

test('la couronne ouvre la mise en page sur sa fiche seulement, pour la visite', async ({ app, page }) => {
  // King kept by a version of before (geoflora.kingMode): forgotten at start, never on.
  await page.addInitScript(() => localStorage.setItem('geoflora.kingMode', '1'));
  await app.open(`#/plant/${ORTIE}`);
  const sheet = flore(page);
  await expect(sheet.getByRole('heading', { level: 1, name: 'Ortie dioïque' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('geoflora.kingMode'))).toBeNull();
  await expect(crown(sheet)).toHaveAttribute('aria-pressed', 'false');
  await expect(bar(sheet)).toHaveCount(0);

  // The crown, last of the action bar: the bar of the sheet, the app's mode arranged.
  await expect(sheet.locator('.action-bar .act').last()).toHaveClass(/\bcrown\b/);
  await app.king();
  await expect(crown(sheet)).toHaveAttribute('aria-pressed', 'true');
  await expect(bar(sheet)).toContainText('Mise en page : Standard');
  expect(await app.state('king')).toEqual({ sheet: 'flore', mode: null });
  expect(await page.evaluate(() => localStorage.getItem('geoflora.kingMode'))).toBeNull();

  // A block alone, in the pane beside (⤢): read, not arranged.
  await app.go(`#/plant/${ORTIE}?pane=map`);
  const alone = page.locator('gf-plant-detail[only]');
  await expect(alone).toHaveCount(1);
  await expect(alone.locator('.king-bar, .act.crown, .block-title .grip')).toHaveCount(0);

  // Mes plantes' sheet: its own crown, not pressed — King is Flore's.
  await app.go(`#/collections?plant=${ORTIE}`);
  const mine = page.locator('gf-plant-detail[sheet="collections"]');
  await expect(mine.getByRole('heading', { name: 'Ortie dioïque' }).first()).toBeVisible();
  await expect(crown(mine)).toHaveAttribute('aria-pressed', 'false');
  await expect(bar(mine)).toHaveCount(0);

  // A free layout's sheet: no crown at all.
  await app.go(`#/layout/[plant]?p=${ORTIE}`);
  const cell = page.locator('gf-layout gf-plant-detail');
  await expect(cell.getByRole('heading', { name: 'Ortie dioïque' }).first()).toBeVisible();
  await expect(cell.locator('.act.crown, .king-bar')).toHaveCount(0);

  // Back in Flore: still open (the visit), until « Terminé » — the focus back on the crown.
  await app.go(`#/plant/${ORTIE}`);
  await expect(bar(sheet)).toBeVisible();
  await bar(sheet).getByRole('button', { name: 'Terminé' }).click();
  await expect(bar(sheet)).toHaveCount(0);
  await expect(crown(sheet)).toHaveAttribute('aria-pressed', 'false');
  await expect(crown(sheet)).toBeFocused();
  expect(await app.state('king')).toBeNull();

  // Réglages › Mise en page de la fiche › « Personnaliser la fiche »: the last plant read in Flore, open.
  await app.go('#/settings');
  await page.locator('gf-settings').getByRole('button', { name: 'Personnaliser la fiche' }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/plant/${ORTIE}`);
  await expect(bar(sheet)).toContainText('Mise en page : Standard');

  // Then a reload: closed (never kept).
  await page.reload();
  await app.ready();
  await expect(sheet.getByRole('heading', { level: 1, name: 'Ortie dioïque' })).toBeVisible();
  await expect(bar(sheet)).toHaveCount(0);
  expect(await app.state('king')).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('geoflora.kingMode'))).toBeNull();
});

test('la barre arrange un autre mode sans changer celui de l’application', async ({ app, page }) => {
  await app.open(`#/plant/${ORTIE}`);
  const sheet = flore(page);
  await expect(sheet.getByRole('heading', { level: 1, name: 'Ortie dioïque' })).toBeVisible();
  const storedMode = await page.evaluate(() => localStorage.getItem('geoflora.mode'));
  await app.king();
  await expect.poll(() => order(sheet)).toEqual(expect.arrayContaining(['name', 'status']));
  expect((await order(sheet))[1]).toBe('status');

  // Scientifique, in the bar: the sheet drawn and arranged so (Plantes à confondre right after the name), the app's
  // mode left as it is.
  await bar(sheet).getByRole('button', { name: 'Scientifique — la mise en page' }).click();
  await expect(bar(sheet)).toContainText('Mise en page : Scientifique');
  await expect(sheet.locator('article.science')).toHaveCount(1);
  await expect.poll(async () => (await order(sheet))[1]).toBe('lookalikes');
  expect(await app.state('mode')).toBe('standard');
  expect(await page.evaluate(() => localStorage.getItem('geoflora.mode'))).toBe(storedMode);
  expect(await app.state('king')).toEqual({ sheet: 'flore', mode: 'scientific' });

  // « Classification » hidden there: in Scientifique only.
  await sheet.getByRole('button', { name: 'Masquer le bloc « Classification »' }).click();
  await expect(sheet.getByRole('button', { name: 'Réafficher le bloc « Classification »' })).toBeVisible();
  expect(await hidden(page, 'scientific', 'taxonomy')).toBe(true);
  expect(await hidden(page, 'standard', 'taxonomy')).toBe(false);

  // ↺: the app's mode arranged again.
  await bar(sheet).getByRole('button', { name: 'Revenir au mode de l’application' }).click();
  await expect(bar(sheet)).toContainText('Mise en page : Standard');
  await expect.poll(async () => (await order(sheet))[1]).toBe('status');
  await expect(sheet.locator('article.science')).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Masquer le bloc « Classification »' })).toBeVisible();

  // The app's mode changed in the header (a wide screen: on a phone the sheet covers it) while the bar arranges it:
  // the bar follows.
  if (!app.phone) {
    await page.locator('gf-app header gf-mode-switch').getByRole('button', { name: 'Épuré — toute l’application' }).click();
    await expect(bar(sheet)).toContainText('Mise en page : Épuré');
    expect(await app.state('king')).toEqual({ sheet: 'flore', mode: null });
  }
});

/** Ortie's sheet in Flore, personalised (its crown). @param {import('./app.mjs').App} app @param {Page} page @param {number} [id] */
async function kingSheet(app, page, id = ORTIE) {
  await app.open(`#/plant/${id}`);
  const sheet = flore(page);
  await expect(sheet.getByRole('heading', { level: 1 })).toBeVisible();
  await app.king();
  return sheet;
}

test('« Par défaut », dans la barre : le mode arrangé revient à sa mise en page, une fois confirmé', async ({ app, page }) => {
  const sheet = await kingSheet(app, page);
  const reset = bar(sheet).getByRole('button', { name: 'Par défaut', exact: true });
  await expect(reset).toBeDisabled();
  await moveTo(sheet, 'Classification', 'Nouveau panneau à droite');
  await expect(sheet.locator('[data-pane]').first()).toBeVisible();
  await sheet.getByRole('button', { name: 'Masquer le bloc « Calendrier »' }).click();
  await expect(reset).toBeEnabled();

  // Not confirmed: nothing changes.
  page.once('dialog', dialog => dialog.dismiss());
  await reset.click();
  expect(await sb(page, 'isCustom', 'standard')).toBe(true);
  await expect(sheet.locator('[data-pane]').first()).toBeVisible();

  // Confirmed (the message names the mode): no pane, nothing hidden by hand, the button greyed, said; the focus on
  // « Barre d’actions ».
  let message = '';
  page.once('dialog', dialog => { message = dialog.message(); dialog.accept(); });
  await reset.click();
  expect(message).toMatch(/^Remettre « Standard » par défaut \? Ordre, blocs et sous-blocs masqués, styles, titres affichés ou cachés, « masqué si vide » et panneaux de ce mode reviennent par défaut ; les noms donnés aux blocs, les blocs Note et Carte restent\.$/);
  await expect(sheet.locator('[data-pane]')).toHaveCount(0);
  expect(await sb(page, 'isCustom', 'standard')).toBe(false);
  expect(await hidden(page, 'standard', 'calendar')).toBe(false);
  await expect(reset).toBeDisabled();
  await expect(sheet.locator('.said')).toHaveText('« Standard » : mise en page par défaut');
  await expect(bar(sheet).getByRole('button', { name: 'Barre d’actions', exact: true })).toBeFocused();
});

test('« Barre d’actions », dans la barre : ses actions cochées et ordonnées, au clavier aussi', async ({ app, page }) => {
  const sheet = await kingSheet(app, page);
  const open = bar(sheet).getByRole('button', { name: 'Barre d’actions', exact: true });
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await open.click();
  await expect(open).toHaveAttribute('aria-expanded', 'true');
  const list = bar(sheet).locator('#king-actions gf-sortable-list');
  await expect(list.locator('li')).toHaveCount(6);

  // ↑ on the grip of « Partager »: before « Ajouter à la liste ou au lieu en cours », the grip still focused.
  const grip = list.getByRole('button', { name: 'Déplacer « Partager »' });
  await grip.focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => sb(page, 'subOrder', 'standard', 'actions')).toEqual(['fav', 'addTo', 'share', 'addCurrent', 'map', 'spot']);
  await expect(grip).toBeFocused();

  // Its ☑ and the ☑ on the button of the bar are one.
  const onBar = sheet.locator('.action-bar').getByRole('checkbox', { name: '« Noter ici » dans la barre d’actions' });
  await list.getByRole('checkbox', { name: 'Noter ici' }).uncheck();
  await expect(onBar).not.toBeChecked();
  expect(await sb(page, 'isSubHidden', 'standard', 'actions', 'spot')).toBe(true);
  await onBar.check();
  await expect(list.getByRole('checkbox', { name: 'Noter ici' })).toBeChecked();
  expect(await sb(page, 'isSubHidden', 'standard', 'actions', 'spot')).toBe(false);
});

test('les blocs sur la fiche : ordre, masquer et réafficher, sous-blocs et style d’un bloc masqué, titres, « masqué si vide »', async ({ app, page }) => {
  const sheet = await kingSheet(app, page);
  const at = async (/** @type {string} */ key) => (await order(sheet)).indexOf(key);

  // ↑ then ↓ on the grip of Classification: before Usages, then back (the default order: nothing kept).
  const grip = sheet.getByRole('button', { name: 'Déplacer le bloc « Classification »' });
  await grip.focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await at('taxonomy')) < (await at('uses'))).toBe(true);
  await expect(grip).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await at('taxonomy')) > (await at('uses'))).toBe(true);
  expect(await sb(page, 'isCustom', 'standard')).toBe(false);

  // The trash, then ↺; the trash, then its chip in « Ajouter ».
  await sheet.getByRole('button', { name: 'Masquer le bloc « Calendrier »' }).click();
  await sheet.getByRole('button', { name: 'Réafficher le bloc « Calendrier »' }).click();
  expect(await hidden(page, 'standard', 'calendar')).toBe(false);
  await sheet.getByRole('button', { name: 'Masquer le bloc « Calendrier »' }).click();
  await sheet.locator('.palette').getByRole('button', { name: 'Calendrier', exact: true }).click();
  await expect.poll(() => hidden(page, 'standard', 'calendar')).toBe(false);

  // A hidden block keeps its sub-blocks and its style.
  await sheet.getByRole('button', { name: 'Masquer le bloc « Occurrences et répartition »' }).click();
  const occurrences = sheet.locator('.blocks.king .block[data-key="occurrences"]');
  await occurrences.getByRole('button', { name: 'Sous-blocs de « Occurrences et répartition »' }).click();
  await occurrences.locator('gf-sortable-list').getByRole('checkbox', { name: 'Par mois (GBIF)' }).uncheck();
  expect(await sb(page, 'isSubHidden', 'standard', 'occurrences', 'months')).toBe(true);
  await occurrences.getByRole('group', { name: 'Style du bloc « Occurrences et répartition »' }).getByRole('button', { name: 'Liste' }).click();
  expect(await sb(page, 'blockStyle', 'standard', 'occurrences')).toBe('list');

  // The title hidden when read; Wikipédia shown even when empty.
  await sheet.getByRole('button', { name: 'Masquer le titre « Classification » à la lecture' }).click();
  await expect(sheet.getByRole('button', { name: 'Montrer le titre « Classification » à la lecture' })).toHaveAttribute('aria-pressed', 'false');
  expect(await sb(page, 'isTitleShown', 'standard', 'taxonomy')).toBe(false);
  await sheet.getByRole('button', { name: 'Afficher « Wikipédia » même vide, à la lecture' }).click();
  expect(await sb(page, 'hidesEmpty', 'standard', 'wikipedia')).toBe(false);

  // Renamed, then its own name again (empty).
  await sheet.getByRole('button', { name: 'Renommer le bloc « Calendrier »' }).click();
  await sheet.getByRole('textbox', { name: 'Nouveau nom du bloc « Calendrier »' }).fill('Saisons');
  await page.keyboard.press('Enter');
  await expect(sheet.locator('.block[data-key="calendar"] .block-title .name')).toHaveText('Saisons');
  await sheet.getByRole('button', { name: 'Renommer le bloc « Saisons »' }).click();
  await sheet.getByRole('textbox', { name: 'Nouveau nom du bloc « Saisons »' }).fill('');
  await page.keyboard.press('Enter');
  await expect(sheet.locator('.block[data-key="calendar"] .block-title .name')).toHaveText('Calendrier');
});

test('blocs Note et Carte créés puis supprimés ; « Ranger par catégorie » range le mode arrangé seul', async ({ app, page }) => {
  const sheet = await kingSheet(app, page);
  await sheet.getByRole('button', { name: 'Bloc Note', exact: true }).click();
  await sheet.getByRole('textbox', { name: 'Nom du bloc Note' }).fill('Récolte');
  await sheet.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(sheet.locator('.blocks.king .block[data-key^="note:"] .block-title .name')).toHaveText('Récolte');
  page.once('dialog', dialog => dialog.accept());
  await sheet.getByRole('button', { name: 'Supprimer le bloc « Récolte »' }).click();
  await expect(sheet.locator('.block[data-key^="note:"]')).toHaveCount(0);

  await sheet.getByRole('button', { name: 'Bloc Carte', exact: true }).click();
  await expect(sheet.locator('.blocks.king .block[data-key^="map:"]')).toHaveCount(1);
  page.once('dialog', dialog => dialog.accept());
  await sheet.locator('.block[data-key^="map:"]').getByRole('button', { name: 'Supprimer le bloc « Carte »' }).click();
  await expect(sheet.locator('.block[data-key^="map:"]')).toHaveCount(0);

  // Scientifique arranged, sorted by category; Standard's order untouched.
  const standard = await sb(page, 'blockOrder', 'standard');
  await bar(sheet).getByRole('button', { name: 'Scientifique — la mise en page' }).click();
  await expect(bar(sheet)).toContainText('Mise en page : Scientifique');
  await bar(sheet).getByRole('button', { name: 'Ranger par catégorie' }).click();
  const sorted = await page.evaluate(async () => {
    const { blockOrder } = await import('/app/core/sheet-blocks.js');
    const { CATEGORIES, blockCategory } = await import('/app/core/categories.js');
    const rank = (/** @type {string} */ k) => CATEGORIES.findIndex(c => c.key === blockCategory(k));
    const o = blockOrder('scientific');
    return o.every((k, i) => i === 0 || rank(o[i - 1]) <= rank(k));
  });
  expect(sorted).toBe(true);
  expect(await sb(page, 'blockOrder', 'standard')).toEqual(standard);
});

test('Page web au clavier : « Déplacer vers… » sans « Dans la fiche », sa corbeille la range, sa puce la remet dans un panneau', async ({ app, page }) => {
  const sheet = await kingSheet(app, page);
  const picker = sheet.locator('.blocks.king .block[data-key="web"] summary[aria-label="Déplacer « Page web » vers…"]');
  const menu = sheet.getByRole('menu', { name: 'Déplacer « Page web » vers' });
  const items = menu.getByRole('menuitem');
  await picker.focus();
  await page.keyboard.press('Enter');
  await expect(items.first()).toBeFocused();
  await expect(menu.getByRole('menuitem', { name: 'Dans la fiche' })).toHaveCount(0);
  await page.keyboard.press('End');
  await expect(items.last()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(picker).toBeFocused();

  // Again: « Nouveau panneau à droite » — in a pane, shown, said, its grip focused.
  await page.keyboard.press('Enter');
  await expect(menu.getByRole('menuitem', { name: 'Nouveau panneau à droite' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => sb(page, 'isOnEdge', 'standard', 'web')).toBe(true);
  expect(await hidden(page, 'standard', 'web')).toBe(false);
  await expect(sheet.locator('.said')).toHaveText('« Page web » : nouveau panneau à droite de la fiche');
  await expect(sheet.locator('[data-pane] .block[data-key="web"] .grip')).toBeFocused();

  // Its trash: out of its pane, hidden.
  await sheet.locator('[data-pane]').getByRole('button', { name: 'Masquer le bloc « Page web »' }).click();
  await expect.poll(() => sb(page, 'isOnEdge', 'standard', 'web')).toBe(false);
  expect(await hidden(page, 'standard', 'web')).toBe(true);
  await expect(sheet.locator('[data-pane]')).toHaveCount(0);

  // Its chip in « Ajouter », by Entrée: a new pane on the right again.
  const chip = sheet.locator('.palette').getByRole('button', { name: 'Page web', exact: true });
  await expect(chip).toHaveAttribute('title', 'Toucher : dans un nouveau panneau à droite ; ou glisser vers un panneau');
  await chip.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => sb(page, 'isOnEdge', 'standard', 'web')).toBe(true);
  expect(await hidden(page, 'standard', 'web')).toBe(false);
  await expect(sheet.locator('.said')).toHaveText('« Page web » : nouveau panneau à droite de la fiche');

  // Its tab dragged into the sheet (a mouse): put away too.
  if (!app.phone) {
    const from = await centre(sheet.locator('.edge-tabs [data-drag-key="web"]'));
    const to = await centre(sheet.locator('.main[data-drop-node="sheet"]'));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + (to.x - from.x) * i / 8, from.y + (to.y - from.y) * i / 8);
    await page.mouse.up();
    await expect.poll(() => sb(page, 'isOnEdge', 'standard', 'web')).toBe(false);
    expect(await hidden(page, 'standard', 'web')).toBe(true);
    await expect(sheet.locator('.said')).toHaveText('« Page web » : masqué (il ne s’affiche que dans un panneau)');
  }
});

test('un service coupé : « Garder … masqué dans ce mode » ; un panneau replié s’ouvre pendant qu’on personnalise', async ({ app, page }) => {
  const sheet = await kingSheet(app, page);
  await page.evaluate(async () => (await import('/app/core/modules.js')).setModule('gbif', false));
  const keep = sheet.getByRole('button', { name: 'Garder « Descriptions » masqué dans ce mode' });
  await expect(keep).toHaveAttribute('aria-pressed', 'false');
  await expect(keep).toHaveAttribute('title', 'Reviendra dans ce mode avec son service');
  await expect(sheet.getByRole('button', { name: 'Réafficher le bloc « Descriptions »' })).toHaveCount(0);
  await keep.click();
  await expect(keep).toHaveAttribute('aria-pressed', 'true');
  await expect(keep).toHaveAttribute('title', 'Restera masqué dans ce mode quand le service reviendra');
  expect(await sb(page, 'foldedByHand', 'standard', 'descriptions')).toBe(true);
  await keep.click();
  await expect(keep).toHaveAttribute('aria-pressed', 'false');
  expect(await sb(page, 'foldedByHand', 'standard', 'descriptions')).toBe(false);

  // A pane folded (its ⚙ « Replié »): drawn open, saying so, without its chevron; read again, folded.
  await moveTo(sheet, 'Calendrier', 'Nouveau panneau à droite');
  const pane = sheet.locator('[data-pane]');
  await expect(pane).toHaveCount(1);
  await page.evaluate(async () => {
    const { paneOf, setStackState } = await import('/app/core/sheet-blocks.js');
    setStackState('standard', /** @type {any} */ (paneOf('standard', 'calendar')).id, { folded: true });
  });
  await expect(pane.locator('.fold-note')).toHaveText('replié à la lecture');
  await expect(pane).not.toHaveClass(/\bfolded\b/);
  await expect(pane.locator('.block[data-key="calendar"] .grip')).toBeVisible();
  await expect(pane.getByRole('button', { name: /^(Replier|Déplier) le panneau/ })).toHaveCount(0);
  await bar(sheet).getByRole('button', { name: 'Terminé' }).click();
  await expect(pane).toHaveClass(/\bfolded\b/);
  await expect(pane.locator('.fold-note')).toHaveCount(0);
});

test('Plantes à confondre, Usages et sa Prudence : jamais masqués — un cadenas dit pourquoi, un panneau n’est pas masquer', async ({ app, page }) => {
  const sheet = await kingSheet(app, page, AIL);
  for (const title of ['Plantes à confondre', 'Usages et cuisine sauvage']) {
    await expect(sheet.getByRole('button', { name: `Masquer le bloc « ${title} »` })).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: `« ${title} » ne se masque dans aucun mode : sécurité` })).toBeVisible();
  }
  // Its padlock touched (a finger on a phone): why, written under the title.
  const lock = sheet.getByRole('button', { name: '« Plantes à confondre » ne se masque dans aucun mode : sécurité' });
  if (app.phone) await lock.tap(); else await lock.click();
  await expect(sheet.locator('.block[data-key="lookalikes"] .lock-tip')).toHaveText('« Plantes à confondre » ne se masque dans aucun mode : sécurité');

  // In a pane: allowed.
  await moveTo(sheet, 'Plantes à confondre', 'Nouveau panneau à droite');
  await expect.poll(() => sb(page, 'isOnEdge', 'standard', 'lookalikes')).toBe(true);

  // Usages' sub-blocks: Prudence first, ticked and greyed, without a grip; nothing passes it; the others untick.
  const uses = sheet.locator('.blocks.king .block[data-key="uses"]');
  await uses.getByRole('button', { name: 'Sous-blocs de « Usages et cuisine sauvage »' }).click();
  const list = uses.locator('gf-sortable-list');
  await expect(list.locator('li').first()).toHaveAttribute('data-key', 'safety');
  const prudence = list.getByRole('checkbox', { name: 'Prudence' });
  await expect(prudence).toBeChecked();
  await expect(prudence).toBeDisabled();
  await expect(list.getByRole('button', { name: 'Déplacer « Prudence »' })).toHaveCount(0);
  const why = list.getByRole('button', { name: '« Prudence » reste affiché et en tête : sécurité' });
  if (app.phone) await why.tap(); else await why.click();
  await expect(list.locator('.why')).toHaveText('« Prudence » reste affiché et en tête : sécurité');
  const reported = list.getByRole('button', { name: 'Déplacer « Usages rapportés »' });
  await reported.focus();
  await page.keyboard.press('ArrowUp');
  await expect(list.locator('li').first()).toHaveAttribute('data-key', 'safety');
  expect((await sb(page, 'subOrder', 'standard', 'uses'))[0]).toBe('safety');
  await list.getByRole('checkbox', { name: 'Parties et produits' }).uncheck();
  expect(await sb(page, 'isSubHidden', 'standard', 'uses', 'parts')).toBe(true);
});

test('une mise en page enregistrée qui masquerait les blocs de sécurité les montre quand même, Prudence en tête', async ({ app, page }) => {
  await page.addInitScript(() => localStorage.setItem('geoflora.sheetLayout', JSON.stringify({
    hidden: { standard: ['lookalikes', 'uses', 'photos', 'gbifMedia', 'web'] },
    subOrder: { standard: { uses: ['uses', 'parts', 'kitchen', 'links', 'safety'] } },
    subHidden: { standard: { uses: ['safety', 'links'] } }
  })));
  await app.open(`#/plant/${AIL}`);
  const sheet = flore(page);
  await expect(sheet.getByRole('heading', { level: 1, name: 'Ail des ours' })).toBeVisible();
  await expect(sheet.locator('.block[data-key="lookalikes"]')).toHaveCount(1);
  await expect(sheet.locator('.block[data-key="uses"]')).toHaveCount(1);
  await expect(sheet.locator('gf-lookalikes').first().locator('.sev-chip.deadly').first()).toHaveText(/mortel/i);
  await expect(sheet.locator('.block[data-key="uses"] .prudence .verdict .sev-chip')).toHaveText('Sosie mortel');
  expect((await sb(page, 'subOrder', 'standard', 'uses'))[0]).toBe('safety');
  expect(await sb(page, 'isSubHidden', 'standard', 'uses', 'links')).toBe(true);
});

test('téléphone 390 : rien ne déborde, des cibles de 44 px, la barre ne couvre pas celle des actions, un doigt sur un titre fait défiler', async ({ app, page, isMobile }) => {
  test.skip(!isMobile, 'téléphone seulement');
  await app.open(`#/plant/${ORTIE}`);
  const sheet = flore(page);
  await expect(sheet.getByRole('heading', { level: 1, name: 'Ortie dioïque' })).toBeVisible();
  await page.evaluate(async () => (await import('/app/core/modules.js')).setModule('gbif', false));
  await app.king();
  const occurrences = sheet.locator('.blocks.king .block[data-key="occurrences"]');
  await occurrences.getByRole('button', { name: 'Sous-blocs de « Occurrences et répartition »' }).click();
  await expect(occurrences.locator('gf-sortable-list')).toBeVisible();
  await bar(sheet).getByRole('button', { name: 'Barre d’actions', exact: true }).click();
  await expect(bar(sheet).locator('gf-sortable-list')).toBeVisible();

  // No side scroll: the page, the sheet, the bar and every title row inside the screen.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await sheet.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const rows = await sheet.locator('.king-bar, .blocks.king .block-title').evaluateAll(els => els.map(el => {
    const r = el.getBoundingClientRect();
    return { key: el.closest('.block')?.getAttribute('data-key') || 'bar', fits: el.scrollWidth <= el.clientWidth && r.left >= 0 && r.right <= innerWidth };
  }));
  expect(rows.filter(r => !r.fits)).toEqual([]);

  // Targets at 44 × 44: grips, tools, ☑ of the action bar, « Déplacer vers… », the lists' grips and padlocks, the bar's
  // buttons and its mode switch (↺ too, once another mode is arranged).
  const small = (/** @type {Locator} */ targets) => targets.evaluateAll(els => els.filter(el => el.getClientRects().length).map(el => {
    const r = el.getBoundingClientRect();
    return { name: el.getAttribute('aria-label') || el.textContent?.trim() || el.className, w: Math.round(r.width), h: Math.round(r.height) };
  }).filter(t => t.w < 44 || t.h < 44));
  expect(await small(sheet.locator('.blocks.king .block-title :is(.grip, .tool), .action-bar .act-toggle, .action-bar .act.crown > button'))).toEqual([]);
  expect(await small(sheet.locator('gf-sortable-list :is(.grip, .lock)'))).toEqual([]);
  expect(await small(sheet.locator('.king-bar button, .king-bar gf-mode-switch .segmented > button'))).toEqual([]);
  await bar(sheet).getByRole('button', { name: 'Scientifique — la mise en page' }).click();
  expect(await small(sheet.locator('.king-bar gf-mode-switch .reset'))).toEqual([]);
  await bar(sheet).getByRole('button', { name: 'Revenir au mode de l’application' }).click();
  await expect(bar(sheet)).toContainText('Mise en page : Standard');

  // A block's « Déplacer vers… »: its menu inside the screen.
  await sheet.locator('summary[aria-label="Déplacer « Classification » vers…"]').click();
  const menu = await sheet.locator('details[open] .move-menu').boundingBox();
  expect(menu && menu.x >= 0 && menu.x + menu.width <= 390).toBe(true);
  await page.keyboard.press('Escape');

  // The bar never covers the action bar: at the top, and further down.
  const clear = async () => {
    const top = await bar(sheet).boundingBox(), actions = await sheet.locator('.action-bar').boundingBox();
    return Boolean(top && actions && top.y + top.height <= actions.y);
  };
  expect(await clear()).toBe(true);
  await sheet.evaluate(el => { el.scrollTop = 900; });
  expect(await clear()).toBe(true);

  // A finger on a title scrolls the sheet: no drag, the order as it was.
  await bar(sheet).getByRole('button', { name: 'Barre d’actions', exact: true }).click();
  const before = await order(sheet);
  const title = sheet.locator('.blocks.king .block[data-key="taxonomy"] .block-title .name');
  await title.evaluate(el => el.scrollIntoView({ block: 'center' }));
  const from = await centre(title);
  const top0 = await sheet.evaluate(el => el.scrollTop);
  await swipe(page, from, { x: from.x, y: from.y - 260 });
  await expect.poll(() => sheet.evaluate(el => el.scrollTop)).toBeGreaterThan(top0 + 100);
  expect(await order(sheet)).toEqual(before);
  await expect(sheet).not.toHaveAttribute('docking', '');
});

/** Réglages › Mise en page de la fiche. @param {Page} page */
const card = page => page.locator('gf-settings').getByRole('region', { name: 'Mise en page de la fiche' });

test('Réglages : la mise en page et vos modes font l’aller-retour par un fichier ; les textes des blocs Note restent sur l’appareil', async ({ app, page, newDevice }) => {
  await app.open('#/');
  const { note, mode, before } = await page.evaluate(async ortie => {
    const sb = await import('/app/core/sheet-blocks.js');
    const { createMode } = await import('/app/core/mode-admin.js');
    sb.dockBlock('standard', 'calendar', 'sheet', 'right');
    sb.setHidden('standard', 'taxonomy', true);
    sb.renameBlock('names', 'Tous les noms');
    const made = createMode('Terrain', 'standard');
    sb.setHidden(made, 'wikipedia', true);
    const key = sb.createNote('Récolte');
    await sb.setNoteText(key, ortie, 'Feuilles jeunes, en avril');
    return { note: key, mode: made, before: JSON.parse(sb.exportLayout()) };
  }, ORTIE);

  // Exported from Réglages: the layout and the modes, nothing else — the Note block by its name, never its text.
  await app.go('#/settings');
  const [download] = await Promise.all([page.waitForEvent('download'), card(page).getByRole('button', { name: 'Exporter la mise en page' }).click()]);
  const path = /** @type {string} */ (await download.path());
  const text = readFileSync(path, 'utf8');
  const file = JSON.parse(text);
  expect(Object.keys(file)).toEqual(['app', 'kind', 'version', 'layout', 'modes']);
  expect(file).toEqual(before);
  expect(file.layout.notes).toEqual([{ id: note.slice('note:'.length), title: 'Récolte' }]);
  expect(file.modes.map((/** @type {any} */ m) => m.label)).toContain('Terrain');
  expect(text).not.toContain('Feuilles jeunes');

  // Everything back to the defaults, then the file imported: the same layout, the note's text still here.
  await page.evaluate(async () => (await import('/app/core/sheet-blocks.js')).resetAll());
  expect(await page.evaluate(async () => (await import('/app/core/sheet-blocks.js')).treeOf('standard').t)).toBe('sheet');
  await page.locator('gf-settings input[type=file][accept^="application/json"]').setInputFiles(path);
  await expect(card(page).locator('p[role=status]')).toHaveText('Mise en page importée.');
  expect(await page.evaluate(async ([key, ortie, made]) => {
    const sb = await import('/app/core/sheet-blocks.js');
    return { file: JSON.parse(sb.exportLayout()), text: sb.noteText(/** @type {string} */ (key), /** @type {number} */ (ortie)), docked: sb.isOnEdge('standard', 'calendar'),
      title: sb.blockTitle('names'), hidden: sb.isHidden(/** @type {any} */ (made), 'wikipedia') };
  }, [note, ORTIE, mode])).toEqual({ file: before, text: 'Feuilles jeunes, en avril', docked: true, title: 'Tous les noms', hidden: true });

  // Another device: the mode and the Note block arrive, not the text.
  const other = await newDevice();
  await other.app.open('#/settings');
  await other.page.locator('gf-settings input[type=file][accept^="application/json"]').setInputFiles(path);
  await expect(card(other.page).locator('p[role=status]')).toHaveText('Mise en page importée.');
  expect(await other.page.evaluate(async ([key, ortie, made]) => {
    const sb = await import('/app/core/sheet-blocks.js');
    const { modeLabel } = await import('/app/core/modes.js');
    const { store } = await import('/app/core/store.js');
    return { label: modeLabel(/** @type {any} */ (made)), notes: store.state.sheetLayout.notes, text: sb.noteText(/** @type {string} */ (key), /** @type {number} */ (ortie)) };
  }, [note, ORTIE, mode])).toEqual({ label: 'Terrain', notes: [{ id: note.slice('note:'.length), title: 'Récolte' }], text: '' });
});

test('Réglages › « Tout rétablir » : tout revient par défaut, dans tous les modes, sauf vos modes, les blocs Note et leurs textes', async ({ app, page }) => {
  await app.open(`#/plant/${ORTIE}`);
  const sheet = flore(page);
  await expect(sheet.getByRole('heading', { level: 1, name: 'Ortie dioïque' })).toBeVisible();
  const { note, mode } = await page.evaluate(async ortie => {
    const sb = await import('/app/core/sheet-blocks.js');
    const { createMode } = await import('/app/core/mode-admin.js');
    const key = sb.createNote('Récolte');
    await sb.setNoteText(key, ortie, 'Soupe au printemps');
    sb.setBlockOrder('standard', [key, ...sb.blockOrder('standard').filter(k => k !== key)]);
    sb.setHidden('standard', key, true);
    sb.renameBlock('taxonomy', 'Systématique');
    sb.setHidden('epure', 'names', true);
    sb.dockBlock('standard', 'status', 'sheet', 'right');
    sb.createMap('Carte des lieux');
    return { note: key, mode: createMode('Terrain', 'standard') };
  }, ORTIE);
  const layout = () => page.evaluate(async () => (await import('/app/core/sheet-blocks.js')).exportLayout());
  const saved = await layout();

  // Not confirmed: nothing changes.
  await app.go('#/settings');
  const reset = card(page).getByRole('button', { name: 'Tout rétablir' });
  let message = '';
  page.once('dialog', dialog => { message = dialog.message(); dialog.dismiss(); });
  await reset.click();
  expect(message).toBe('Tout rétablir ? Dans tous les modes, ordre, blocs et sous-blocs masqués, styles, titres affichés ou cachés, « masqué si vide » et panneaux reviennent par défaut, les noms donnés aux blocs aussi, et les blocs Carte ajoutés sont supprimés. Vos modes, vos blocs Note et leurs textes restent.');
  expect(await layout()).toBe(saved);

  // Confirmed: said; every mode as it was at first, the Carte block gone; the mode, the Note block (last, shown) and its
  // text kept.
  page.once('dialog', dialog => dialog.accept());
  await reset.click();
  await expect(card(page).locator('p[role=status]')).toHaveText('Mise en page rétablie.');
  expect(await page.evaluate(async ([key, ortie, made]) => {
    const sb = await import('/app/core/sheet-blocks.js');
    const { modeLabel } = await import('/app/core/modes.js');
    const { store } = await import('/app/core/store.js');
    const k = /** @type {string} */ (key);
    return {
      taxonomy: sb.blockTitle('taxonomy'), names: sb.foldedByHand('epure', 'names'), tree: sb.treeOf('standard').t,
      mapBlocks: store.state.sheetLayout.mapBlocks, added: sb.allBlocks().filter(b => b.key.startsWith('map:')).length,
      last: sb.blockOrder('standard').at(-1) === k, hidden: sb.isHidden('standard', k), text: sb.noteText(k, /** @type {number} */ (ortie)),
      custom: sb.isCustom('standard'), mode: modeLabel(/** @type {any} */ (made))
    };
  }, [note, ORTIE, mode])).toEqual({ taxonomy: 'Classification', names: false, tree: 'sheet', mapBlocks: [], added: 0, last: true, hidden: false,
    text: 'Soupe au printemps', custom: false, mode: 'Terrain' });

  // On the sheet: the note and its text, no pane.
  await app.go(`#/plant/${ORTIE}`);
  await expect(sheet.locator(`.block[data-key="${note}"] textarea.note-text`)).toHaveValue('Soupe au printemps');
  await expect(sheet.locator('[data-pane]')).toHaveCount(0);
});

test('Réglages › Mise en page de la fiche : le bouton, le fichier, « Tout rétablir », rien d’autre ; « Personnaliser la fiche » ouvre la dernière plante lue, la couronne allumée', async ({ app, page }) => {
  // The last plant read with a block alone beside it (?pane=): the sheet itself is opened.
  await app.open(`#/plant/${ORTIE}?pane=map`);
  await expect(page.locator('gf-plant-detail[only]')).toHaveCount(1);
  await app.go('#/settings');
  const box = card(page);
  await expect(box.locator('button')).toHaveText([/Personnaliser la fiche/, /Exporter la mise en page/, /Tout rétablir/]);
  await expect(box.locator('label.file')).toHaveText(/Importer…/);
  await expect(page.locator('gf-settings :is(gf-sortable-list, .mini-tree, .block-orders)')).toHaveCount(0);
  await expect(box.getByRole('button', { name: 'Personnaliser la fiche' })).toBeEnabled();

  await box.getByRole('button', { name: 'Personnaliser la fiche' }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/plant/${ORTIE}`);
  expect(await app.state('king')).toEqual({ sheet: 'flore', mode: null });
  const sheet = flore(page);
  await expect(crown(sheet)).toHaveAttribute('aria-pressed', 'true');
  await expect(bar(sheet)).toContainText('Mise en page : ');

  // Réglages again, the sheet still personalised: still no list.
  await app.go('#/settings');
  await expect(card(page)).toBeVisible();
  expect(await app.state('king')).toEqual({ sheet: 'flore', mode: null });
  await expect(page.locator('gf-settings gf-sortable-list')).toHaveCount(0);
});

test('« Personnaliser la fiche » : sinon la première plante des résultats ; sans plante ni résultat, grisé, il dit pourquoi', async ({ app, page }) => {
  await app.open('#/?q=ortie');
  await expect.poll(() => app.state('results.total')).toBeGreaterThan(0);
  const first = (await app.state('results.items'))[0].id;
  await app.go('#/settings');
  await card(page).getByRole('button', { name: 'Personnaliser la fiche' }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/plant/${first}`);

  // A search that finds nothing, read last: no plant to open.
  await app.go('#/?q=xqzwv');
  await expect.poll(() => app.state('results.total')).toBe(0);
  await app.go('#/settings');
  const button = card(page).getByRole('button', { name: 'Personnaliser la fiche' });
  await expect(button).toBeDisabled();
  await expect(button).toHaveAccessibleDescription('Ouvrez une plante dans Flore.');
});
