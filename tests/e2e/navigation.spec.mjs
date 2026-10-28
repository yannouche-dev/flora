// Navigation: « Fermer la fiche » goes back to the view the sheet was opened from — Flore's list, Mes plantes' list or
// place — past the plants gone through with ‹ ›, never adding an entry; opened from elsewhere (another tab, a link, the
// start), the list takes its place. A block's pane closes the same way, onto the plant it was opened from
// (core/history.js sheetMark, closeTo). On both widths the sheet's head has its × « Fermer la fiche », and Échap closes
// it (Flore: its pane first). « Annuler » goes back, never a step more: a new place's, a dialog's; a share's « Ignorer »
// too, and a share saved takes the preview's place. The Carte's plant filter is in its address (plants=).
import { test, expect, plantId } from './fixtures.mjs';

/** @typedef {import('@playwright/test').Page} Page */

const hash = (/** @type {Page} */ page) => page.evaluate(() => location.hash);
/** The entries of this tab's history (closing a sheet never adds one). @param {Page} page */
const entries = page => page.evaluate(() => history.length);
/** The depth of the current entry in this visit (core/history.js). @param {Page} page */
const depthOf = page => page.evaluate(() => history.state?.gfDepth);

/** Flore's plant sheet closed: the × of its head (the phone's sheet, the desktop's pane). @param {import('./app.mjs').App} app @param {Page} page */
const closeFlore = (app, page) => page.locator(app.phone ? 'gf-flora .sheet-plant .pane-head' : 'gf-flora #flore-plant .pane-head')
  .getByRole('button', { name: 'Fermer la fiche' }).click();

/** ← → to the next plant of the results, once the address shows it. @param {Page} page */
async function nextPlant(page) {
  const was = await hash(page);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => hash(page)).not.toBe(was);
  expect(await hash(page)).toMatch(/^#\/plant\/\d+/);
}

test('Flore : « Fermer la fiche » revient à la liste d’où elle a été ouverte, en passant les plantes parcourues', async ({ app, page }) => {
  await app.open('#/settings');
  await app.go('#/?family=Rosaceae');
  await expect.poll(() => app.state('results.total')).toBeGreaterThan(3);
  await page.locator('gf-flora gf-plant-list gf-plant-card a.row').first().click();
  await expect.poll(() => hash(page)).toMatch(/^#\/plant\/\d+$/);
  await nextPlant(page);
  await nextPlant(page);
  const n = await entries(page);
  await closeFlore(app, page);
  await expect.poll(() => hash(page)).toBe('#/?family=Rosaceae');
  expect(await entries(page)).toBe(n);
  expect(await depthOf(page)).toBe(1);
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/settings');
});

test('Flore : une fiche ouverte d’ailleurs se ferme sur la liste de Flore, à sa place ; Retour ramène d’où elle venait', async ({ app, page }) => {
  await app.open('#/?family=Rosaceae');
  await app.go('#/settings');
  await app.go(`#/plant/${plantId('Geum urbanum')}`);
  await expect.poll(() => app.state('query.filters.family')).toEqual(['Rosaceae']);
  await expect(page.locator('gf-flora gf-plant-detail:not([preview])').first()).toBeVisible();
  await nextPlant(page);
  const n = await entries(page);
  await closeFlore(app, page);
  await expect.poll(() => hash(page)).toBe('#/?family=Rosaceae');
  expect(await entries(page)).toBe(n);
  expect(await depthOf(page)).toBe(2);
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/settings');
});

test('Flore : ouverte au démarrage, la liste prend sa place', async ({ app, page }) => {
  await app.open(`#/plant/${plantId('Geum urbanum')}`);
  const n = await entries(page);
  await closeFlore(app, page);
  await expect.poll(() => hash(page)).toBe('#/');
  expect(await entries(page)).toBe(n);
  expect(await depthOf(page)).toBe(0);
});

test('Flore : un panneau, puis ‹ › ; un panneau après un rechargement', async ({ app, page }) => {
  test.skip(app.phone, 'the pane beside the sheet: a wide screen');
  await app.open('#/?family=Rosaceae');
  await page.locator('gf-flora gf-plant-list gf-plant-card a.row').first().click();
  await expect.poll(() => hash(page)).toMatch(/^#\/plant\/\d+$/);
  const p1 = await hash(page);
  const toPane = page.locator('gf-flora #flore-plant gf-plant-detail:not([preview]) button.to-pane').first();
  const closePane = page.locator('gf-flora .block-pane').getByRole('button', { name: 'Fermer le panneau' });
  // A pane, then the next plant (its pane with it), then the pane closed: that plant without it, in place.
  await toPane.click();
  await expect.poll(() => hash(page)).toMatch(/^#\/plant\/\d+\?pane=/);
  await nextPlant(page);
  const p2 = (await hash(page)).split('?')[0];
  expect(p2).not.toBe(p1);
  let n = await entries(page);
  await closePane.click();
  await expect.poll(() => hash(page)).toBe(p2);
  expect(await entries(page)).toBe(n);
  await page.goBack();
  await expect.poll(() => hash(page)).toMatch(new RegExp('^' + p1.replace(/[?]/g, '\\?') + '(\\?|$)'));
  // Back on the first plant (its pane): Back again to it without, then a pane, a reload, closed: back to the plant.
  await page.goBack();
  await expect.poll(() => hash(page)).toBe(p1);
  await toPane.click();
  await expect.poll(() => hash(page)).toMatch(/^#\/plant\/\d+\?pane=/);
  await page.reload();
  await app.ready();
  n = await entries(page);
  await closePane.click();
  await expect.poll(() => hash(page)).toBe(p1);
  expect(await entries(page)).toBe(n);
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/?family=Rosaceae');
});

/** A place with three plants (Mes plantes). @param {Page} page @returns {Promise<string>} its id */
const seedPlace = page => page.evaluate(async ids => {
  const c = await import('/app/core/collections.js');
  const db = await import('/app/core/db.js');
  const plants = await Promise.all(ids.map(id => db.get('plants', id)));
  const place = plants.reduce((p, plant) => c.withPlant(p, plant), c.newPlace([2.351, 48.851], { name: 'Bois de la Source' }));
  return (await c.savePlace(place)).id;
}, [plantId('Allium ursinum'), plantId('Urtica dioica'), plantId('Geum urbanum')]);

/** Mes plantes' plant sheet closed: the × of its head (the phone's sheet, the desktop's pane). @param {import('./app.mjs').App} app @param {Page} page */
const closeMine = (app, page) => page.locator(app.phone ? 'gf-collections .sheet-plant .pane-head' : 'gf-collections #mine-plant .pane-head')
  .getByRole('button', { name: 'Fermer la fiche' }).click();

test('Mes plantes : la fiche fermée revient au lieu, en passant les plantes parcourues', async ({ app, page }) => {
  await app.open('#/');
  const id = await seedPlace(page);
  await app.go('#/collections');
  const mine = page.locator('gf-collections');
  await mine.locator('button.main', { hasText: 'Bois de la Source' }).click();
  await expect.poll(() => hash(page)).toBe(`#/collections?c=${id}`);
  await mine.locator('ul.plants a').first().click();
  await expect.poll(() => hash(page)).toBe(`#/collections?c=${id}&plant=${plantId('Allium ursinum')}`);
  for (const next of ['Urtica dioica', 'Geum urbanum']) {
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => hash(page)).toBe(`#/collections?c=${id}&plant=${plantId(next)}`);
  }
  const n = await entries(page);
  await closeMine(app, page);
  await expect.poll(() => hash(page)).toBe(`#/collections?c=${id}`);
  expect(await entries(page)).toBe(n);
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/collections');
  if (app.phone) return;
  // The place's map closed beside the plant, then the plant: Mes plantes without the map.
  await page.goForward();
  await expect.poll(() => hash(page)).toBe(`#/collections?c=${id}`);
  await mine.locator('ul.plants a').first().click();
  await expect.poll(() => hash(page)).toMatch(/&plant=/);
  await mine.getByRole('button', { name: 'Fermer la carte' }).click();
  await expect.poll(() => hash(page)).toBe(`#/collections?plant=${plantId('Allium ursinum')}`);
  await closeMine(app, page);
  await expect.poll(() => hash(page)).toBe('#/collections');
  await expect(page.locator('gf-collections section[aria-label="Carte du lieu"]')).toHaveCount(0);
});

test('Échap ferme le panneau, puis la fiche', async ({ app, page }) => {
  test.skip(app.phone, 'the pane beside the sheet, a keyboard: a wide screen');
  await app.open('#/settings');
  await app.go('#/?family=Rosaceae');
  await page.locator('gf-flora gf-plant-list gf-plant-card a.row').first().click();
  await expect.poll(() => hash(page)).toMatch(/^#\/plant\/\d+$/);
  const plant = await hash(page);
  await expect(page.locator('gf-flora #flore-plant').getByRole('button', { name: 'Fermer la fiche' })).toHaveAttribute('title', 'Fermer la fiche (Échap)');
  await page.locator('gf-flora #flore-plant gf-plant-detail:not([preview]) button.to-pane').first().click();
  await expect.poll(() => hash(page)).toMatch(/^#\/plant\/\d+\?pane=/);
  const n = await entries(page);
  await page.keyboard.press('Escape');
  await expect.poll(() => hash(page)).toBe(plant);
  await expect(page.locator('gf-flora .block-pane')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect.poll(() => hash(page)).toBe('#/?family=Rosaceae');
  expect(await entries(page)).toBe(n);
  // No plant open: Échap does nothing.
  await page.keyboard.press('Escape');
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/settings');
});

test('Échap ferme la fiche de Mes plantes', async ({ app, page }) => {
  await app.open('#/');
  const id = await seedPlace(page);
  await app.go('#/collections');
  const mine = page.locator('gf-collections');
  await mine.locator('button.main', { hasText: 'Bois de la Source' }).click();
  await expect.poll(() => hash(page)).toBe(`#/collections?c=${id}`);
  await mine.locator('ul.plants a').first().click();
  await expect.poll(() => hash(page)).toMatch(/&plant=/);
  const head = mine.locator(app.phone ? '.sheet-plant .pane-head' : '#mine-plant .pane-head');
  await expect(head.getByRole('button', { name: 'Fermer la fiche' })).toHaveAttribute('title', app.phone ? 'Fermer (Échap)' : 'Fermer la fiche (Échap)');
  const n = await entries(page);
  await page.keyboard.press('Escape');
  await expect.poll(() => hash(page)).toBe(`#/collections?c=${id}`);
  expect(await entries(page)).toBe(n);
  await expect(mine.locator('#mine-plant, .sheet-plant')).toHaveCount(0);
});

/** « Annuler » of a new place (its editor's footer). @param {Page} page */
const cancelNewPlace = page => page.locator('gf-spot-editor .actions.footer').getByRole('button', { name: 'Annuler', exact: true }).click();
/** Whether the current entry is a dialog's step (core/history.js openModal). @param {Page} page */
const onStep = page => page.evaluate(() => Boolean(history.state?.gfModal));

test('« Annuler » d’un nouveau lieu revient en arrière, sans étape de plus', async ({ app, page }) => {
  const id = plantId('Geum urbanum');
  const newPlace = `#/collection/new?kind=place&plant=${id}`;
  // From Flore's sheet: the sheet again, on its own entry; Back: the list it was opened from.
  await app.open('#/?family=Rosaceae');
  await app.go(`#/plant/${id}`);
  await expect(page.locator('gf-flora gf-plant-detail:not([preview])').first()).toBeVisible();
  const at = await depthOf(page);
  await app.go(newPlace);
  await cancelNewPlace(page);
  await expect.poll(() => hash(page)).toBe(`#/plant/${id}`);
  expect(await depthOf(page)).toBe(at);
  // From « Ajouter à… » › « Nouveau lieu ici »: the closed dialog's step skipped, the sheet again.
  await page.locator('.action-bar .act[data-key="addTo"] > button').first().click();
  await page.getByRole('dialog', { name: 'Ajouter à une liste ou un lieu' }).getByRole('link', { name: 'Nouveau lieu ici' }).click();
  await expect.poll(() => hash(page)).toBe(newPlace);
  await cancelNewPlace(page);
  await expect.poll(() => hash(page)).toBe(`#/plant/${id}`);
  await expect.poll(() => onStep(page)).toBe(false);
  expect(await depthOf(page)).toBe(at);
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/?family=Rosaceae');
  // From Mes plantes' sheet: the same.
  await app.go(`#/collections?plant=${id}`);
  await expect(page.locator('gf-collections gf-plant-detail:not([preview])').first()).toBeVisible();
  await app.go(newPlace);
  await cancelNewPlace(page);
  await expect.poll(() => hash(page)).toBe(`#/collections?plant=${id}`);
  expect(await depthOf(page)).toBe(at);
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/?family=Rosaceae');
});

test('Un dialogue « Annuler » : l’historique comme avant', async ({ app, page }) => {
  await app.open('#/settings');
  await app.go('#/app/parcours');
  const box = page.locator('gf-miniapp');
  await box.locator('.more summary').click();
  const at = await depthOf(page);
  await box.locator('.menu').getByRole('button', { name: 'Recommencer' }).click();
  const dialog = box.getByRole('dialog');
  await expect(dialog).toContainText('Recommencer : tout effacer ?');
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => onStep(page)).toBe(false);
  expect(await depthOf(page)).toBe(at);
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/settings');
});

test('Partage : « Enregistrer dans Mes plantes » prend la place de l’aperçu ; « Ignorer » revient en arrière', async ({ app, page, newDevice }) => {
  await app.open('#/');
  const id = await seedPlace(page);
  const link = await page.evaluate(async i => '#/shared?d=' + await (await import('/app/core/share.js'))
    .encodeCollection(await (await import('/app/core/collections.js')).getPlace(i)), id);
  const other = await newDevice();
  await other.app.open('#/');
  await other.app.go(link);
  const shared = other.page.locator('gf-shared');
  await expect(shared.locator('h1')).toHaveText('Bois de la Source');
  let n = await entries(other.page);
  // Saved: the new place on the Carte, in the preview's place; Back does not open the preview again.
  await shared.getByRole('button', { name: 'Enregistrer dans Mes plantes' }).click();
  await expect.poll(() => hash(other.page)).toMatch(/^#\/map\?spot=/);
  expect(await entries(other.page)).toBe(n);
  await other.page.goBack();
  await expect.poll(() => hash(other.page)).toBe('#/');
  await expect(shared).toHaveCount(0);
  // « Ignorer »: back to where the link was opened.
  await other.app.go(link);
  await expect(shared.locator('h1')).toHaveText('Bois de la Source');
  await shared.getByRole('button', { name: 'Ignorer' }).click();
  await expect.poll(() => hash(other.page)).toBe('#/');
  // A link that cannot be read: « Voir Mes plantes » in its place.
  await other.app.go('#/shared?d=zzz');
  await expect(shared.getByRole('alert')).toBeVisible();
  n = await entries(other.page);
  await shared.getByRole('link', { name: 'Voir Mes plantes' }).click();
  await expect.poll(() => hash(other.page)).toBe('#/collections');
  expect(await entries(other.page)).toBe(n);
  await other.page.goBack();
  await expect.poll(() => hash(other.page)).toBe('#/');
});

test('Carte : le filtre de plantes dans l’adresse', async ({ app, page }) => {
  await app.open('#/');
  const id = await seedPlace(page);
  const [a, b] = [plantId('Allium ursinum'), plantId('Urtica dioica')];
  const plants = page.locator('gf-map-page .bar').getByRole('button', { name: /^Plantes/ });
  /** A plant of the « Plantes » menu ticked or unticked (its menu opened first). @param {RegExp} name */
  const tick = async name => {
    if (await page.locator('gf-map-page .plant-menu').count() === 0) await plants.click();
    await page.locator('gf-map-page .plant-menu').getByRole('checkbox', { name }).click();
  };
  await app.go('#/map');
  await tick(/Ail des ours/);
  await tick(/Ortie/);
  await expect.poll(() => hash(page)).toBe(`#/map?plants=${a},${b}`);
  // Reloaded: the same filter, the address's.
  await page.reload();
  await app.ready();
  expect(await hash(page)).toBe(`#/map?plants=${a},${b}`);
  await expect(plants).toContainText('Plantes · 2');
  // The Carte tab: the Carte as it was left, its filter with it.
  await app.go('#/settings');
  await tabLink(app, page, 'Carte').click();
  await expect.poll(() => hash(page)).toBe(`#/map?plants=${a},${b}`);
  await expect(plants).toContainText('Plantes · 2');
  // A link of before (plant=): its plant filtered.
  await app.go(`#/map?plant=${a}`);
  await expect(plants).toContainText('Plantes · 1');

  // A place open, the filter changed beside it: the place closes onto the Carte filtered as now — never as it was
  // before the place opened; Back does not open the place again.
  /** @param {string} from the Carte, filtered @param {() => Promise<unknown>} change @param {string} now its address after */
  const changedBeside = async (from, change, now) => {
    await app.go('#/settings');
    await app.go(from);
    await app.go(from.replace('#/map?', `#/map?spot=${id}&`));
    await expect(page.locator('gf-map-page gf-spot-editor')).toHaveCount(1);
    await change();
    await expect.poll(() => hash(page)).toBe(now);
    await expect(page.locator('gf-map-page gf-spot-editor')).toHaveCount(0);
    await page.goBack();
    await expect.poll(() => hash(page)).toBe('#/settings');
  };
  await changedBeside(`#/map?plants=${a},${b}`, () => tick(/Ortie/), `#/map?plants=${a}`);
  await changedBeside(`#/map?plant=${a}`, () => tick(/Ortie/), `#/map?plants=${a},${b}`);
  // « En saison » (the harvest journal on), the same.
  await page.evaluate(async ([i, p]) => {
    const c = await import('/app/core/collections.js');
    await c.updatePlace(i, place => c.withEntry(place, p, { harvests: [{ date: new Date().toISOString().slice(0, 10), quantity: '', note: '' }] }));
    (await import('/app/core/store.js')).setHarvestMode(true);
  }, [id, a]);
  await changedBeside(`#/map?plants=${a}`, () => page.locator('gf-map-page .bar').getByRole('button', { name: /^En saison/ }).click(), `#/map?plants=${a}&season=1`);
});

/**
 * What `touch` does to the view shown: nothing — the same address, depth and number of entries, not even a popstate
 * or a hashchange for no move (core/history.js: a link to the view shown is not followed).
 * @param {Page} page @param {() => Promise<unknown>} touch @param {string} [what]
 */
async function expectNothing(page, touch, what) {
  const now = () => page.evaluate(() => ({ hash: location.hash, entries: history.length, depth: history.state?.gfDepth, moves: /** @type {any} */ (window).__moves }));
  await page.evaluate(() => {
    const w = /** @type {any} */ (window);
    if (w.__moves === undefined) for (const type of ['popstate', 'hashchange']) addEventListener(type, () => { w.__moves++; });
    w.__moves = 0;
  });
  const was = await now();
  await touch();
  await page.waitForTimeout(250);
  expect(await now(), what).toEqual(was);
}

/** A tab, as touched: the phone's bar, the computer's header (Réglages: its gear there). @param {import('./app.mjs').App} app @param {Page} page @param {string} name */
const tabLink = (app, page, name) => app.phone ? page.locator('gf-tabbar').getByRole('link', { name, exact: true })
  : name === 'Réglages' ? page.locator('gf-app a.settings') : page.locator('gf-app nav.tabs').getByRole('link', { name, exact: true });

test('Un onglet touché quand on y est : rien ne change', async ({ app, page }) => {
  await app.open('#/discover');
  const id = await seedPlace(page);
  const plant = plantId('Allium ursinum');
  /** @type {[string, string][]} */
  const tabs = [['Flore', `#/plant/${plant}`], ['Mes plantes', `#/collections?c=${id}&plant=${plant}`], ['Carte', `#/map?spot=${id}`], ['Réglages', '#/settings']];
  for (const [name, route] of tabs) {
    await app.go(route);
    await expect.poll(() => depthOf(page), name).toBe(1);
    const tab = tabLink(app, page, name);
    // Each tab leads back to where it was left: here, the view shown.
    await expect.poll(async () => (await tab.getAttribute('href')) === await hash(page), name).toBe(true);
    await expectNothing(page, () => tab.click(), name);
    await page.goBack();
    await expect.poll(() => hash(page), name).toBe('#/discover');
  }
});

test('Une seule recherche : une disposition libre ne change pas celle de Flore', async ({ app, page }) => {
  await app.open('#/?family=Rosaceae');
  // The layout's first group shares the app's live search (here: ortie), never kept as Flore's.
  await app.go('#/layout/[search(list=0),results(list)]?q=ortie');
  await expect.poll(() => app.state('query.q')).toBe('ortie');
  await app.go(`#/plant/${plantId('Geum urbanum')}`);
  await expect.poll(() => app.state('query.q')).toBe('');
  expect(await app.state('query.filters.family')).toEqual(['Rosaceae']);
  expect(await app.state('context.query')).toBe('#/?family=Rosaceae');
  await closeFlore(app, page);
  await expect.poll(() => hash(page)).toBe('#/?family=Rosaceae');
  await expect.poll(() => app.state('results.total')).toBeGreaterThan(3);
});

test('Le logo ramène à Flore là où on l’avait laissée', async ({ app, page }) => {
  await app.open('#/?family=Rosaceae');
  await expect.poll(() => app.state('results.total')).toBeGreaterThan(3);
  await page.locator('gf-flora gf-plant-list gf-plant-card a.row').first().click();
  await expect.poll(() => hash(page)).toMatch(/^#\/plant\/\d+$/);
  const plant = await hash(page);
  await app.go('#/map');
  await expect(page.locator('gf-map-page')).toBeVisible();
  const logo = page.getByRole('link', { name: 'GeoFlora — aller à Flore' });
  await expect(logo).toHaveAttribute('href', plant);
  await logo.click();
  await expect.poll(() => hash(page)).toBe(plant);
  expect(await app.state('query.filters.family')).toEqual(['Rosaceae']);
  // Touched again on Flore as it was left (a computer: on a phone the sheet covers the header): nothing.
  if (!app.phone) await expectNothing(page, () => logo.click());
  // Réglages' way back: Flore too, the plant included.
  await app.go('#/settings');
  await expect(page.locator('gf-settings').getByRole('link', { name: 'Aller à Flore' })).toHaveAttribute('href', plant);
});

test('Quitter une activité ouverte par un lien, et « Page introuvable », ramènent à Flore là où on l’avait laissée', async ({ app, page, context }) => {
  await app.open('#/?family=Rosaceae');
  // A link to the activity, opened in a new tab: nothing of this visit behind it.
  const { App } = await import('./app.mjs');
  const tab = await context.newPage();
  const other = new App(tab);
  await other.open('#/app/mosaique');
  await tab.locator('gf-miniapp .quit').click();
  await expect.poll(() => hash(tab)).toBe('#/?family=Rosaceae');
  await other.go('#/nope');
  await expect(tab.getByText('Page introuvable.').getByRole('link', { name: 'Aller à Flore' })).toHaveAttribute('href', '#/?family=Rosaceae');
  // An activity that does not exist: the same way out.
  await other.go('#/app/nope');
  await expect(tab.locator('gf-miniapp .missing').getByRole('link', { name: 'Aller à Flore' })).toHaveAttribute('href', '#/?family=Rosaceae');
  await tab.close();
});

test('« Passer » après « Revoir les premiers pas » garde la recherche de Flore', async ({ app, page }) => {
  await app.open('#/?family=Rosaceae');
  await app.go('#/settings');
  await page.getByRole('button', { name: 'Revoir les premiers pas' }).click();
  await page.getByRole('alertdialog', { name: 'Revoir les premiers pas ?' }).getByRole('button', { name: 'Revoir les premiers pas' }).click();
  await expect.poll(() => hash(page)).toBe('#/discover');
  await page.getByRole('link', { name: 'Passer : montrer toute l’application' }).click();
  await expect.poll(() => hash(page)).toBe('#/?family=Rosaceae');
  await expect.poll(() => app.state('query.filters.family')).toEqual(['Rosaceae']);
});

/** The app launched from its icon: its address without a hash (the manifest's start_url, './'). @param {import('./app.mjs').App} app @param {Page} page */
async function launch(app, page) {
  await page.goto(new URL('./', page.url()).href);
  await app.ready();
}

test('Lancée depuis son icône, sans adresse : Flore là où on l’avait laissée', async ({ app, page }) => {
  await app.open('#/?family=Rosaceae');
  await app.go('#/settings');
  await launch(app, page);
  await expect.poll(() => hash(page)).toBe('#/?family=Rosaceae');
  expect(await depthOf(page)).toBe(0);
  // Never an empty search in its place: the saved one is the list's.
  await expect.poll(() => app.state('query.filters.family')).toEqual(['Rosaceae']);
  expect(await app.state('context.query')).toBe('#/?family=Rosaceae');
});

test.describe('pendant les premiers pas', () => {
  test.use({ firstVisit: true });

  test('le logo, « Page introuvable » et Réglages mènent à Découvrir', async ({ app, page }) => {
    await app.open('#/');
    await expect.poll(() => hash(page)).toBe('#/discover');
    const logo = page.locator('gf-app a.brand');
    await expect(logo).toHaveAttribute('href', '#/discover');
    await expect(logo).toHaveAttribute('aria-label', 'GeoFlora — aller à Découvrir');
    await app.go('#/nope');
    await expect(page.getByText('Page introuvable.').getByRole('link', { name: 'Aller à Découvrir' })).toHaveAttribute('href', '#/discover');
    await app.go('#/settings');
    await expect(page.locator('gf-settings').getByRole('link', { name: 'Aller à Découvrir' })).toHaveAttribute('href', '#/discover');
  });

  test('lancée depuis son icône, sans adresse : Découvrir', async ({ app, page }) => {
    await app.open('#/');
    await launch(app, page);
    await expect.poll(() => hash(page)).toBe('#/discover');
    expect(await depthOf(page)).toBe(0);
  });
});
