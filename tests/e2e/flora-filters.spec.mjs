// Flore: every way to clear a filter — « Tout effacer » beside the Filtres title (the pane on a desktop, the drawer
// on a phone), the chips (one ✕, or « Tout effacer »), a group's « effacer » — the list, its count and its address
// following each, the focus kept on the page (never dropped to it); the « Filtrer par » text not coming back once
// cleared, nor when a family put its genus out; genera kept to the families chosen; filters cleared beside an open plant
// staying cleared when it closes, after a reload and Back too; the « Espèce » column, a hybrid (« × ampolai ») at its
// epithet, not under its sign, and the Genre filters (Flore, Carte › Autour) so; the cards' sort menu on the sort chosen.
import { test, expect, fixturePlants, answerAround } from './fixtures.mjs';

const count = (/** @type {(p: any) => boolean} */ keep) => fixturePlants.filter(keep).length;
const NONE = { mine: [], status: [], legal: [], family: [], genus: [], photo: [], french: [] };
const hash = (/** @type {import('@playwright/test').Page} */ page) => page.evaluate(() => location.hash);

/** What has the focus, through the shadow roots: its class and its name (null: the page itself). @param {import('@playwright/test').Page} page */
const focused = page => page.evaluate(() => {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return !el || el === document.body ? null : { cls: el.className, name: (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim() };
});

/** A button pressed from the keyboard (its focus, then Enter). @param {import('@playwright/test').Locator} button */
async function press(button) {
  await button.focus();
  await button.press('Enter');
}

/**
 * The filters as one reaches them: the pane beside the list (desktop), the drawer opened from the results bar (phone).
 * @param {import('./app.mjs').App} app @param {import('@playwright/test').Page} page
 */
async function openFilters(app, page) {
  if (!app.phone) return { panel: page.locator('gf-flora .pane.filters gf-filter-panel'), head: page.locator('gf-flora .pane.filters .pane-head') };
  await page.locator('gf-flora gf-results-bar').getByRole('button', { name: /^Filtres/ }).click();
  await expect(page.locator('gf-flora dialog.drawer')).toBeVisible();
  return { panel: page.locator('gf-flora dialog.drawer gf-filter-panel'), head: page.locator('gf-flora dialog.drawer .sheet-head') };
}

/** The drawer closed (phone), with the list's own button. @param {import('./app.mjs').App} app @param {import('@playwright/test').Page} page */
async function closeFilters(app, page) {
  if (!app.phone) return;
  await page.locator('gf-flora dialog.drawer .sheet-foot button').click();
  await expect(page.locator('gf-flora dialog.drawer')).toBeHidden();
}

/** The list's count, as the results bar says it. @param {import('@playwright/test').Page} page @param {number} n */
const said = (page, n) => expect(page.locator('gf-flora gf-results-bar .count')).toHaveText(`${n.toLocaleString('fr-FR')} espèce${n > 1 ? 's' : ''}`);

test('« Tout effacer » du titre Filtres (volet, tiroir) : plus un filtre, la flore entière, l’adresse nue', async ({ app, page }) => {
  await app.open('#/?family=Urticaceae,Rosaceae&photo=avec');
  await said(page, count(p => ['Urticaceae', 'Rosaceae'].includes(p.family) && p.thumbnail?.url));
  const { panel, head } = await openFilters(app, page);
  await expect(panel.locator('gf-facet input[type="checkbox"]:checked')).toHaveCount(3);
  // Beside the title, not in it: the heading is « Filtres », not « Filtres Tout effacer ».
  await expect(head.getByRole('heading', { name: 'Filtres', exact: true })).toBeVisible();
  // Given the click as its argument, it took the event for the search to clear: nothing cleared, an error thrown.
  await head.getByRole('button', { name: 'Tout effacer' }).click();
  await expect.poll(() => app.state('query.filters')).toEqual(NONE);
  await expect.poll(() => hash(page)).toBe('#/');
  await said(page, fixturePlants.length);
  await expect(panel.locator('gf-facet input[type="checkbox"]:checked')).toHaveCount(0);
  await expect(panel.locator('gf-facet .badge')).toHaveCount(0);
  await expect(head.getByRole('button', { name: 'Tout effacer' })).toHaveCount(0);
  await expect(page.locator('gf-flora gf-active-filters')).toBeHidden();
  // The drawer closed: the list keeps what was cleared in it (its address too).
  await closeFilters(app, page);
  await expect.poll(() => hash(page)).toBe('#/');
  await said(page, fixturePlants.length);
});

test('les puces : ✕ en retire une (nommée en clair), « Tout effacer » toutes', async ({ app, page }) => {
  await app.open('#/?family=Urticaceae,Rosaceae&status=P&photo=avec');
  const chips = page.locator('gf-flora gf-active-filters');
  await expect(chips.getByRole('button', { name: /^Retirer le filtre/ })).toHaveCount(4);
  await chips.getByRole('button', { name: 'Retirer le filtre Famille : Rosaceae' }).click();
  await expect.poll(() => hash(page)).toBe('#/?status=P&family=Urticaceae&photo=avec');
  await said(page, count(p => p.family === 'Urticaceae' && p.status?.france === 'P' && p.thumbnail?.url));
  await expect(chips.getByRole('button', { name: 'Retirer le filtre Statut : Indigène' })).toBeVisible();
  await expect(chips.getByRole('button', { name: 'Retirer le filtre Photo : Avec photo' })).toBeVisible();
  await chips.getByRole('button', { name: 'Tout effacer' }).click();
  await expect.poll(() => hash(page)).toBe('#/');
  await expect.poll(() => app.state('query.filters')).toEqual(NONE);
  await said(page, fixturePlants.length);
  await expect(chips).toBeHidden();
});

test('« effacer » d’un groupe : ses valeurs seules, sa liste entière à nouveau, le groupe ouvert (Statut compris)', async ({ app, page }) => {
  await app.open('#/?family=Rosaceae&status=P&photo=avec');
  const { panel } = await openFilters(app, page);
  const family = panel.locator('gf-facet[name="family"]');
  // Its list looked through (« Filtrer famille… »): « effacer » gives it back whole.
  await family.getByRole('searchbox', { name: 'Filtrer Famille' }).fill('rosac');
  await expect(family.locator('li')).toHaveCount(1);
  // Named by its group: one « effacer » per filter, each told apart.
  await family.getByRole('button', { name: 'Effacer le filtre Famille', exact: true }).click();
  await expect.poll(() => hash(page)).toBe('#/?status=P&photo=avec');
  await said(page, count(p => p.status?.france === 'P' && p.thumbnail?.url));
  await expect(family.getByRole('searchbox', { name: 'Filtrer Famille' })).toHaveValue('');
  await expect.poll(() => family.locator('li').count()).toBeGreaterThan(1);
  // Statut, folded at first, opened by its value: emptied, it stays open (it folded away under the click).
  const status = panel.locator('gf-facet[name="status"]');
  await expect(status).toHaveAttribute('open', '');
  await status.getByRole('button', { name: 'effacer' }).click();
  await expect.poll(() => hash(page)).toBe('#/?photo=avec');
  await said(page, count(p => p.thumbnail?.url));
  await expect(status).toHaveAttribute('open', '');
  await expect(status.locator('input[type="checkbox"]')).toHaveCount(6);
  await panel.locator('gf-facet[name="photo"]').getByRole('button', { name: 'effacer' }).click();
  await expect.poll(() => hash(page)).toBe('#/');
  await said(page, fixturePlants.length);
});

test('« Filtrer par » puis « Tout effacer » : ni le texte ni ses suggestions ne reviennent, même au filtre suivant', async ({ app, page }) => {
  await app.open('#/');
  await page.getByRole('combobox', { name: 'Rechercher une plante' }).fill('urtica');
  const bar = page.locator('gf-flora gf-results-bar');
  await bar.getByRole('button', { name: /^Urtica · genre/ }).click();
  await expect.poll(() => hash(page)).toBe('#/?genus=Urtica');
  await bar.getByRole('button', { name: /^Urticaceae · famille/ }).click();
  await expect.poll(() => hash(page)).toBe('#/?family=Urticaceae&genus=Urtica');
  await page.locator('gf-flora gf-active-filters').getByRole('button', { name: 'Tout effacer' }).click();
  await expect.poll(() => hash(page)).toBe('#/');
  await said(page, fixturePlants.length);
  await expect(bar.locator('.suggestions')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Rechercher une plante' })).toHaveValue('');
  // Another filter after: the text cleared long ago does not come back with it.
  const { panel } = await openFilters(app, page);
  await panel.locator('gf-facet[name="photo"] label', { hasText: 'Avec photo' }).click();
  await expect.poll(() => hash(page)).toBe('#/?photo=avec');
  await panel.locator('gf-facet[name="photo"]').getByRole('button', { name: 'effacer' }).click();
  await expect.poll(() => hash(page)).toBe('#/');
  expect(await app.state('query.q')).toBe('');
});

test('un filtre de « Filtrer par » : retiré (✕), le texte revient ; effacé (« effacer »), la flore entière', async ({ app, page }) => {
  await app.open('#/');
  const search = page.getByRole('combobox', { name: 'Rechercher une plante' });
  await search.fill('urtica');
  const bar = page.locator('gf-flora gf-results-bar');
  await bar.getByRole('button', { name: /^Urtica · genre/ }).click();
  await expect.poll(() => hash(page)).toBe('#/?genus=Urtica');
  await page.locator('gf-flora gf-active-filters').getByRole('button', { name: 'Retirer le filtre Genre : Urtica' }).click();
  await expect.poll(() => hash(page)).toBe('#/?q=urtica');
  await expect(search).toHaveValue('urtica');
  await bar.getByRole('button', { name: /^Urtica · genre/ }).click();
  await expect.poll(() => hash(page)).toBe('#/?genus=Urtica');
  const { panel } = await openFilters(app, page);
  await panel.locator('gf-facet[name="genus"]').getByRole('button', { name: 'effacer' }).click();
  await expect.poll(() => hash(page)).toBe('#/');
  await said(page, fixturePlants.length);
  await closeFilters(app, page);
  await expect(search).toHaveValue('');
  await expect(bar.locator('.suggestions')).toHaveCount(0);
});

test('une plante ouverte à côté de la liste : les filtres effacés à côté le restent en la fermant, après Retour, au rechargement', async ({ app, page }) => {
  test.skip(app.phone, 'sur un téléphone, la fiche couvre la liste et ses filtres');
  await app.open('#/?family=Rosaceae&photo=avec');
  const withPhoto = count(p => p.thumbnail?.url);
  await page.locator('gf-flora gf-plant-list gf-plant-card a.row').first().click();
  await expect.poll(() => hash(page)).toMatch(/^#\/plant\/\d+$/);
  await page.locator('gf-flora .pane.filters gf-facet[name="family"]').getByRole('button', { name: 'effacer' }).click();
  await said(page, withPhoto);
  await expect.poll(() => app.state('context.query')).toBe('#/?photo=avec');
  await page.getByRole('button', { name: 'Fermer la fiche' }).click();
  await expect.poll(() => hash(page)).toBe('#/?photo=avec');
  await expect.poll(() => app.state('query.filters.family')).toEqual([]);
  await said(page, withPhoto);
  // Again, cleared by the chips this time, then Back.
  await page.locator('gf-flora gf-plant-list gf-plant-card a.row').first().click();
  await expect.poll(() => hash(page)).toMatch(/^#\/plant\/\d+$/);
  await page.locator('gf-flora .pane.filters .pane-head').getByRole('button', { name: 'Tout effacer' }).click();
  await said(page, fixturePlants.length);
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/');
  await expect.poll(() => app.state('query.filters')).toEqual(NONE);
  await said(page, fixturePlants.length);
  // A filter chosen beside a plant, then the page reloaded on it: the list comes back so — and Back to it too.
  await page.locator('gf-flora gf-plant-list gf-plant-card a.row').first().click();
  await expect.poll(() => hash(page)).toMatch(/^#\/plant\/\d+$/);
  await page.locator('gf-flora .pane.filters gf-facet[name="photo"] label', { hasText: 'Sans photo' }).click();
  await expect.poll(() => app.state('context.query')).toBe('#/?photo=sans');
  await page.reload();
  await app.ready();
  await expect.poll(() => app.state('query.filters.photo')).toEqual(['sans']);
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/?photo=sans');
  expect(await app.state('query.filters.photo')).toEqual(['sans']);
  await said(page, count(p => !p.thumbnail?.url));
  // Reloaded on the plant, then cleared beside it: « Fermer la fiche » goes back to the list (no new view), cleared.
  await page.goForward();
  await expect.poll(() => hash(page)).toMatch(/^#\/plant\/\d+$/);
  await page.reload();
  await app.ready();
  await page.locator('gf-flora .pane.filters gf-facet[name="photo"]').getByRole('button', { name: 'Effacer le filtre Photo' }).click();
  await expect.poll(() => app.state('context.query')).toBe('#/');
  const entries = await page.evaluate(() => history.length);
  await page.getByRole('button', { name: 'Fermer la fiche' }).click();
  await expect.poll(() => hash(page)).toBe('#/');
  expect(await page.evaluate(() => history.length)).toBe(entries);
  await expect.poll(() => app.state('query.filters')).toEqual(NONE);
  await said(page, fixturePlants.length);
});

test('un genre de « Filtrer par », puis une famille cochée qui l’écarte : cette famille seule, le texte ne revient pas', async ({ app, page }) => {
  await app.open('#/');
  const search = page.getByRole('combobox', { name: 'Rechercher une plante' });
  await search.fill('urtica');
  await page.locator('gf-flora gf-results-bar').getByRole('button', { name: /^Urtica · genre/ }).click();
  await expect.poll(() => hash(page)).toBe('#/?genus=Urtica');
  const { panel } = await openFilters(app, page);
  const family = panel.locator('gf-facet[name="family"]');
  await family.getByRole('searchbox', { name: 'Filtrer Famille' }).fill('rosac');
  await family.locator('label', { hasText: 'Rosaceae' }).click();
  // Urtica is no Rosaceae: let go — not taken off by hand, its text does not come back (« urtica » in the Rosaceae: none).
  await expect.poll(() => hash(page)).toBe('#/?family=Rosaceae');
  expect(await app.state('query.q')).toBe('');
  await said(page, count(p => p.family === 'Rosaceae'));
  await closeFilters(app, page);
  await expect(search).toHaveValue('');
});

test('« Filtrer par » et les familles choisies : une famille proposée écarte les genres d’ailleurs, un genre d’ailleurs n’est pas proposé', async ({ app, page }) => {
  await app.open('#/?genus=Rosa');
  const search = page.getByRole('combobox', { name: 'Rechercher une plante' });
  const bar = page.locator('gf-flora gf-results-bar');
  await search.fill('urtica');
  await bar.getByRole('button', { name: /^Urticaceae · famille/ }).click();
  // Rosa is no Urticaceae: let go, as ticking the family would (not 0 results under a Genre filter shown empty).
  await expect.poll(() => hash(page)).toBe('#/?family=Urticaceae');
  await said(page, count(p => p.family === 'Urticaceae'));
  // A family on: a genus of another one is not offered (none of its plants would be left).
  await app.go('#/?family=Rosaceae');
  await search.fill('urtica');
  await expect(bar.getByRole('button', { name: /^Urticaceae · famille/ })).toBeVisible();
  await expect(bar.getByRole('button', { name: /^Urtica · genre/ })).toHaveCount(0);
});

test('un genre hors des familles de l’adresse : le filtre Genre le montre coché, à décocher', async ({ app, page }) => {
  await app.open('#/?family=Urticaceae&genus=Rosa');
  await said(page, 0);
  const { panel } = await openFilters(app, page);
  const genus = panel.locator('gf-facet[name="genus"]');
  await expect(genus.locator('.badge')).toHaveText('1');
  await expect(genus.locator('input[type="checkbox"]:checked')).toHaveCount(1);
  await genus.locator('label', { hasText: 'Rosa' }).click();
  await expect.poll(() => hash(page)).toBe('#/?family=Urticaceae');
  await said(page, count(p => p.family === 'Urticaceae'));
});

test('le focus d’un bouton effacé ne tombe pas sur la page : puce voisine, nombre de la liste, en-tête du filtre, « Voir N espèces »', async ({ app, page }) => {
  await app.open('#/?family=Rosaceae&status=P&photo=avec');
  const chips = page.locator('gf-flora gf-active-filters');
  // A chip's ✕: the chip now in its place; the last one's: the one before; none left: the list's count.
  await press(chips.getByRole('button', { name: 'Retirer le filtre Statut : Indigène' }));
  await expect.poll(() => focused(page)).toMatchObject({ name: 'Retirer le filtre Famille : Rosaceae' });
  await press(chips.getByRole('button', { name: 'Retirer le filtre Photo : Avec photo' }));
  await expect.poll(() => focused(page)).toMatchObject({ name: 'Retirer le filtre Famille : Rosaceae' });
  await press(chips.getByRole('button', { name: 'Retirer le filtre Famille : Rosaceae' }));
  await expect.poll(() => focused(page)).toMatchObject({ cls: 'count' });
  await said(page, fixturePlants.length);
  // The chips' « Tout effacer »: the count.
  await app.go('#/?family=Rosaceae&photo=avec');
  await press(chips.getByRole('button', { name: 'Tout effacer' }));
  await expect.poll(() => hash(page)).toBe('#/');
  await expect.poll(() => focused(page)).toMatchObject({ cls: 'count' });
  // A group's « effacer »: its header.
  await app.go('#/?family=Rosaceae&photo=avec');
  const { panel, head } = await openFilters(app, page);
  await press(panel.locator('gf-facet[name="photo"]').getByRole('button', { name: 'Effacer le filtre Photo' }));
  await expect.poll(() => hash(page)).toBe('#/?family=Rosaceae');
  await expect.poll(() => focused(page)).toMatchObject({ cls: 'toggle', name: 'Photo' });
  // The title's « Tout effacer »: the pane's first filter; in the sheet, « Voir N espèces », and the new count said.
  await press(head.getByRole('button', { name: 'Tout effacer' }));
  await expect.poll(() => hash(page)).toBe('#/');
  if (app.phone) {
    await expect.poll(() => focused(page)).toMatchObject({ name: `Voir ${fixturePlants.length} espèces` });
    await expect(page.locator('gf-flora dialog.drawer .sheet-foot')).toHaveAttribute('aria-live', 'polite');
  } else {
    await expect.poll(() => focused(page)).toMatchObject({ cls: 'toggle', name: 'Famille' });
  }
});

test('la colonne « Espèce » trie par l’épithète, un hybride à la sienne (son signe à part), puis à l’envers', async ({ app, page }) => {
  test.skip(app.phone, 'la grille et ses colonnes : sur un écran large');
  await app.open('#/?family=Orchidaceae');
  const head = page.locator('gf-flora gf-plant-list .th').filter({ hasText: 'Espèce' });
  await head.getByRole('button').click();
  await expect.poll(() => hash(page)).toBe('#/?family=Orchidaceae&sort=species');
  await expect(head).toHaveAttribute('aria-sort', 'ascending');
  const order = ['Dactylorhiza x ampolai', 'Ophrys x barbaricina', 'Dactylorhiza brennensis', 'Traunsteinera globosa', 'Ophrys holosericea',
    'Ophrys x jarigei', 'Epipactis leptochila', 'x Serapicamptis mutata', 'Ophrys x souliei', 'Orchis x spuria', 'x Dactylodenia st-quintinii'];
  const names = async () => (await app.state('results.items')).map((/** @type {any} */ p) => p.scientificName);
  await expect.poll(names).toEqual(order);
  // Shown with its sign: « × ampolai » first, « brennensis » third — not every hybrid first, nor in genus order.
  const cells = page.locator('gf-flora gf-plant-list gf-plant-card .cell.sci');
  await expect(cells.first()).toHaveText('× ampolai');
  await expect(cells.nth(2)).toHaveText('brennensis');
  await head.getByRole('button').click();
  await expect.poll(() => hash(page)).toBe('#/?family=Orchidaceae&sort=-species');
  await expect(head).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(names).toEqual([...order].reverse());
  // The Genre filter: by count, then by name — a hybrid genus among the others, not before them.
  const genera = page.locator('gf-flora .pane.filters gf-facet[name="genus"] .name');
  await expect.poll(() => genera.allTextContents().then(t => t.map(s => s.trim()))).toEqual(
    ['Ophrys', 'Dactylorhiza', '× Dactylodenia', 'Epipactis', 'Orchis', '× Serapicamptis', 'Traunsteinera']);
});

test('le menu de tri des cartes nomme un tri de colonne (« Espèce ») et le garde choisi d’un tri hors menu à l’autre', async ({ app, page }) => {
  test.skip(!app.phone, 'les cartes et leur menu : sur un téléphone');
  await app.open('#/?sort=-sci');
  const menu = page.locator('gf-flora gf-results-bar select');
  await expect(menu).toHaveValue('-sci');
  await app.go('#/?sort=species');
  await expect.poll(() => app.state('results.sort')).toBe('species');
  await expect(menu).toHaveValue('species');
  await expect(menu.locator('option:checked')).toHaveText('Espèce');
  await app.go('#/?sort=-genus');
  await expect(menu).toHaveValue('-genus');
  await expect(menu.locator('option:checked')).toHaveText('Genre (inverse)');
  // A sort picked: shown at once — not the one before until its search answers (the menu redrawn meanwhile).
  const shown = await menu.evaluate(async select => {
    const menu = /** @type {HTMLSelectElement} */ (select);
    menu.value = 'family';
    menu.dispatchEvent(new Event('change', { bubbles: true }));
    await /** @type {any} */ (/** @type {ShadowRoot} */ (menu.getRootNode()).host).updateComplete;
    return menu.value;
  });
  expect(shown).toBe('family');
  await expect.poll(() => app.state('results.sort')).toBe('family');
  // Picked, then changed from elsewhere and back: the menu follows the sort applied (an option picked once no longer
  // follows its own `selected`).
  await menu.selectOption('sci');
  await expect.poll(() => app.state('results.sort')).toBe('sci');
  await app.go('#/?sort=family');
  await expect.poll(() => app.state('results.sort')).toBe('family');
  await expect(menu).toHaveValue('family');
  await app.go('#/?sort=sci');
  await expect.poll(() => app.state('results.sort')).toBe('sci');
  await expect(menu).toHaveValue('sci');
});

test('Carte › Autour : le filtre Genre par nombre d’espèces, puis par nom — un genre hybride (« × Dactylodenia ») à D', async ({ app, page, context }) => {
  await answerAround(context);
  // The orchids of the flora around (iNaturalist writes the sign « × »).
  const orchids = fixturePlants.filter(p => p.family === 'Orchidaceae').map(p => p.scientificName.replace(/(^| )x /g, '$1× '));
  await page.route(/^https:\/\/api\.inaturalist\.org\/v1\/observations\/species_counts/, route => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ results: orchids.map((name, i) => ({ count: 20 - i, taxon: { id: 5000 + i, name, preferred_common_name: null } })) }) }));
  await app.open('#/map');
  await page.locator('gf-map-page .around-toggle').click();
  const sheet = page.locator('gf-map-page .sheet.around');
  await expect(sheet.locator('.species .pick')).toHaveCount(orchids.length);
  const genera = sheet.locator('gf-facet[name="genera"]');
  await genera.getByRole('button', { name: 'Genre', exact: true }).click();
  await genera.getByRole('button', { name: /^Voir plus/ }).click();
  await expect.poll(() => genera.locator('.name').allTextContents().then(t => t.map(s => s.trim()))).toEqual(
    ['Ophrys', 'Dactylorhiza', '× Dactylodenia', 'Epipactis', 'Orchis', '× Serapicamptis', 'Traunsteinera']);
});
