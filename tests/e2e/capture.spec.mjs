// « Noter ici » in mode cueillette (SAFE-4): the harvest box is never ticked for you, not even by the last opening;
// a harvest of a plant our sources say is toxic — or protected where it is noted — waits for a warning to be answered
// (gf-harvest-warning, the place editor's too, never the browser's confirm()) — noted without the harvest by default
// (in the place editor, the plant noted already: « Annuler » first, nothing to note without it), with it only once the
// user ticked « J’ai lu cet avertissement ». A plant without toxicity data is noted at once. The
// confusion reminders (« Noter ici », the place editor) show whatever the mode. « Noter ici » is one dialog everywhere
// (the header, a plant's sheet, an activity's sheet: that plant chosen) and offers the lieux within 100 m before it
// saves (never a parcours), as a new lieu's editor does; its « Annuler » takes away the note only.
import { test, expect, plantId } from './fixtures.mjs';

/**
 * Mode cueillette on (or off), « Noter ici » open.
 * @param {import('@playwright/test').Page} page @param {any} app @param {boolean} [harvest]
 */
async function openCapture(page, app, harvest = true) {
  await app.open('#/');
  await page.evaluate(async on => {
    const { setHarvestMode } = await import('/app/core/store.js');
    setHarvestMode(on);
    document.querySelector('gf-app')?.dispatchEvent(new Event('open-capture'));
  }, harvest);
  const dialog = page.locator('gf-capture dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Position GPS/)).toBeVisible();
  return dialog;
}

/** The harvests noted on a plant in every place. @param {import('@playwright/test').Page} page @param {number} id */
const harvestsOf = (page, id) => page.evaluate(async plant => {
  const c = await import('/app/core/collections.js');
  return (await c.listPlaces()).flatMap((/** @type {any} */ p) => p.properties.plants.filter((/** @type {any} */ e) => e.plantId === plant))
    .map((/** @type {any} */ e) => e.harvests.length);
}, id);

/** Types a name and picks the plant. @param {import('@playwright/test').Locator} dialog @param {string} q @param {string} name */
async function pick(dialog, q, name) {
  await dialog.getByRole('searchbox', { name: 'Chercher une plante' }).fill(q);
  await dialog.locator('gf-plant-pick-list li button').filter({ hasText: name }).first().click();
}

test('Noter ici, mode cueillette : case de récolte décochée ; plante toxique → avertissement bloquant, noté sans récolte', async ({ app, page }) => {
  const dialog = await openCapture(page, app);
  const box = dialog.getByRole('checkbox', { name: 'Noter aussi une récolte aujourd’hui' });
  await expect(box).not.toBeChecked();
  await box.check();
  await pick(dialog, 'Grande ciguë', 'Ciguë maculée');

  const warning = dialog.getByRole('alertdialog', { name: /Plante toxique : récolte déconseillée/ });
  await expect(warning).toBeVisible();
  await expect(warning.getByText(/très fortement toxique/)).toBeVisible();
  await expect(warning.getByText(/liste B/)).toBeVisible();
  await expect(warning.getByRole('link', { name: 'centres-antipoison.net' })).toBeVisible();
  // Nothing noted yet; the harvest only once the warning is read.
  expect(await harvestsOf(page, plantId('Conium maculatum'))).toEqual([]);
  // The safe choice first, focused.
  await expect(warning.getByRole('button', { name: 'Noter sans récolte' })).toBeFocused();
  const anyway = warning.getByRole('button', { name: 'Noter la récolte quand même' });
  await expect(anyway).toBeDisabled();
  await expect(warning.getByRole('checkbox', { name: 'J’ai lu cet avertissement' })).not.toBeChecked();

  await warning.getByRole('button', { name: 'Noter sans récolte' }).click();
  const toast = page.locator('gf-capture .toast');
  await expect(toast).toContainText('noté ici');
  await expect(toast).not.toContainText('récolte notée');
  await expect(toast.getByText(/Plante très toxique, confondue avec : Persil plat/)).toBeVisible();
  expect(await harvestsOf(page, plantId('Conium maculatum'))).toEqual([0]);
});

test('Nouveau lieu, mode cueillette : « Récolté aujourd’hui » décoché ; le cocher pour une plante toxique ouvre l’avertissement de « Noter ici », jamais confirm()', async ({ app, page }) => {
  // On a desktop, the place saved at once moves to the Carte's panel: the editor of a new place is the phone's.
  test.skip(!app.phone, 'éditeur d’un nouveau lieu : téléphone');
  /** The browser's own dialogs (confirm(): its OK would note the harvest): none. @type {string[]} */
  const native = [];
  page.on('dialog', dialog => { native.push(dialog.message()); dialog.dismiss(); });
  await app.open('#/');
  await page.evaluate(async () => (await import('/app/core/store.js')).setHarvestMode(true));
  await app.go(`#/collection/new?kind=place&plant=${plantId('Conium maculatum')}&at=48.851000,2.351000`);
  const editor = page.locator('gf-spot-editor');
  const today = editor.getByRole('checkbox', { name: 'Récolté aujourd’hui' });
  await expect(today).not.toBeChecked();
  await today.click();
  const warning = page.getByRole('alertdialog', { name: /Plante toxique : récolte déconseillée/ });
  await expect(warning).toBeVisible();
  await expect(warning.getByText(/très fortement toxique/)).toBeVisible();
  await expect(warning.getByRole('link', { name: 'centres-antipoison.net' })).toBeVisible();
  // The plant is noted already: no « Noter sans récolte » (it would note nothing), the safe choice « Annuler » first
  // (focused); the harvest only once the warning is read.
  await expect(warning.getByRole('button')).toHaveText(['Annuler', 'Noter la récolte quand même']);
  await expect(warning.getByRole('button', { name: 'Annuler' })).toBeFocused();
  await expect(warning.getByRole('button', { name: 'Noter la récolte quand même' })).toBeDisabled();
  await warning.getByRole('button', { name: 'Annuler' }).click();
  await expect(warning).toHaveCount(0);
  await expect(today).not.toBeChecked();
  // Asked again, read: the harvest.
  await today.click();
  await expect(warning).toBeVisible();
  await warning.getByRole('checkbox', { name: 'J’ai lu cet avertissement' }).check();
  await warning.getByRole('button', { name: 'Noter la récolte quand même' }).click();
  await expect(warning).toHaveCount(0);
  await expect(today).toBeChecked();
  expect(native).toEqual([]);
});

test('Éditeur d’un lieu, mode cueillette : une espèce protégée en France — l’avertissement avant que la récolte soit notée, « Annuler » d’abord', async ({ app, page }) => {
  /** @type {string[]} */
  const native = [];
  page.on('dialog', dialog => { native.push(dialog.message()); dialog.dismiss(); });
  await app.open('#/');
  const moly = plantId('Allium chamaemoly');
  const id = await page.evaluate(async plant => {
    (await import('/app/core/store.js')).setHarvestMode(true);
    const c = await import('/app/core/collections.js');
    const db = await import('/app/core/db.js');
    const place = c.withPlant(c.newPlace([2.351, 48.851], { name: 'Pelouse sèche' }), await db.get('plants', plant));
    await c.saveCollection(place);
    return place.id;
  }, moly);
  await app.go(`#/collection/${id}`);
  const editor = page.locator('gf-spot-editor');
  await editor.locator('li.entry button.head').filter({ hasText: 'Ail faux moly' }).first().click();
  const entry = editor.locator('li.entry.open');
  await entry.getByRole('button', { name: 'Ajouter une récolte' }).click();
  const warning = page.getByRole('alertdialog', { name: 'Espèce protégée : cueillette interdite' });
  await expect(warning).toBeVisible();
  await expect(warning.getByText('Espèce protégée en France : cueillette interdite (INPN)')).toBeVisible();
  // Its verdict: the same chip as on its sheet and its cards.
  await expect(warning.locator('.sev-chip.danger')).toHaveText('Protégée');
  // Said before: nothing noted yet.
  expect(await harvestsOf(page, moly)).toEqual([0]);
  // Noted here already: it stays, without a harvest — « Annuler » the safe choice, first and focused.
  await expect(warning.getByText('Laissez-la où elle pousse : elle reste notée, sans récolte.')).toBeVisible();
  await expect(warning.getByRole('button')).toHaveText(['Annuler', 'Noter la récolte quand même']);
  await expect(warning.getByRole('button', { name: 'Annuler' })).toBeFocused();
  await warning.getByRole('button', { name: 'Annuler' }).click();
  await expect(warning).toHaveCount(0);
  await expect(entry.getByText('Aucune récolte notée.')).toBeVisible();
  expect(await harvestsOf(page, moly)).toEqual([0]);
  expect(native).toEqual([]);
});

test('Noter ici : la récolte d’une plante toxique seulement après « J’ai lu cet avertissement » ; une plante sans donnée, tout de suite', async ({ app, page }) => {
  let dialog = await openCapture(page, app);
  await dialog.getByRole('checkbox', { name: 'Noter aussi une récolte aujourd’hui' }).check();
  await pick(dialog, 'Grande ciguë', 'Ciguë maculée');
  const warning = dialog.getByRole('alertdialog');
  await warning.getByRole('checkbox', { name: 'J’ai lu cet avertissement' }).check();
  await warning.getByRole('button', { name: 'Noter la récolte quand même' }).click();
  await expect(page.locator('gf-capture .toast')).toContainText('récolte notée');
  expect(await harvestsOf(page, plantId('Conium maculatum'))).toEqual([1]);

  // No toxicity in our sources (and no confusion): no warning, the harvest asked is noted.
  await page.evaluate(() => document.querySelector('gf-app')?.dispatchEvent(new Event('open-capture')));
  dialog = page.locator('gf-capture dialog');
  await expect(dialog).toBeVisible();
  const box = dialog.getByRole('checkbox', { name: 'Noter aussi une récolte aujourd’hui' });
  // Ticked for the ciguë, unticked again at this opening.
  await expect(box).not.toBeChecked();
  await box.check();
  await pick(dialog, 'Pâquerette', 'Pâquerette');
  // The ciguë's lieu is right here: offered first, nothing noted until it is chosen (the harvest decided already).
  await dialog.getByRole('region', { name: 'Lieux à proximité' }).getByRole('button', { name: 'Y ajouter Pâquerette vivace' }).click();
  await expect(page.locator('gf-capture .toast')).toContainText(/Pâquerette vivace ajouté au lieu « .+ » · récolte notée/);
  await expect(dialog.getByRole('alertdialog')).toHaveCount(0);
  expect(await harvestsOf(page, plantId('Bellis perennis'))).toEqual([1]);
});

test('Noter ici, mode cueillette éteint : l’ail des ours noté rappelle le colchique (sans case de récolte)', async ({ app, page }) => {
  const dialog = await openCapture(page, app, false);
  await expect(dialog.getByRole('checkbox', { name: 'Noter aussi une récolte aujourd’hui' })).toHaveCount(0);
  await pick(dialog, 'Ail des ours', 'Ail des ours');
  const toast = page.locator('gf-capture .toast');
  await expect(toast).toContainText('noté ici');
  await expect(toast).not.toContainText('récolte notée');
  await expect(toast.getByRole('alert').filter({ hasText: /Ne pas confondre avec : Colchique \(mortel\)/ })).toBeVisible();
  expect(await harvestsOf(page, plantId('Allium ursinum'))).toEqual([0]);
});

test('Noter ici, « Annuler » : la note retirée, et le nouveau lieu avec elle seulement s’il est resté vide', async ({ app, page }) => {
  const places = () => page.evaluate(async () => (await (await import('/app/core/collections.js')).listPlaces())
    .map((/** @type {any} */ p) => [p.properties.name, p.properties.plantIds.length]));
  let dialog = await openCapture(page, app, false);
  await pick(dialog, 'Pâquerette', 'Pâquerette');
  const toast = page.locator('gf-capture .toast');
  await expect(toast).toContainText('Pâquerette vivace noté ici (nouveau lieu)');
  await toast.getByRole('button', { name: 'Annuler' }).click();
  await expect(toast).toHaveCount(0);
  await expect.poll(places).toEqual([]);

  // Again, the lieu named meanwhile (its editor, another tab): « Annuler » takes the plant only, the lieu stays.
  await page.evaluate(() => document.querySelector('gf-app')?.dispatchEvent(new Event('open-capture')));
  dialog = page.locator('gf-capture dialog');
  await expect(dialog.getByText(/Position GPS/)).toBeVisible();
  await pick(dialog, 'Pâquerette', 'Pâquerette');
  await expect(toast).toContainText('Pâquerette vivace noté ici (nouveau lieu)');
  await page.evaluate(async () => {
    const c = await import('/app/core/collections.js');
    const [place] = await c.listPlaces();
    await c.updatePlace(place.id, p => ({ ...p, properties: { ...p.properties, name: 'Mon coin' } }));
  });
  await toast.getByRole('button', { name: 'Annuler' }).click();
  await expect.poll(places).toEqual([['Mon coin', 0]]);
});

test('Noter ici : la même offre partout — l’en-tête, la fiche, un nouveau lieu, la fiche d’une activité', async ({ app, page }) => {
  const ortie = plantId('Urtica dioica');
  await app.open('#/');
  // Around the fixture's position: « Pré » 60 m away, « Loin » 150 m, a parcours 30 m (its point only its start).
  await page.evaluate(async pissenlit => {
    const c = await import('/app/core/collections.js');
    const db = await import('/app/core/db.js');
    const north = (/** @type {number} */ m) => /** @type {[number, number]} */ ([2.35, 48.85 + m / 111195]);
    await c.savePlace(c.withPlant(c.newPlace(north(60), { name: 'Pré' }), await db.get('plants', pissenlit)));
    await c.savePlace(c.newPlace(north(150), { name: 'Loin' }));
    await c.savePlace(c.newPlace(north(30), { name: 'Parcours du matin', origin: { app: 'parcours' } }));
  }, plantId('Taraxacum officinale'));
  const names = () => page.evaluate(async () => (await (await import('/app/core/collections.js')).listPlaces())
    .map((/** @type {any} */ p) => [p.properties.name, p.properties.plantIds.length]).sort());
  const toast = page.locator('gf-capture .toast');

  // The header's (the Carte's +, Mes plantes'): the plant picked, then the lieux within 100 m — « Pré » only.
  let dialog = await openCapture(page, app, false);
  await pick(dialog, 'Pâquerette', 'Pâquerette');
  let offer = dialog.getByRole('region', { name: 'Lieux à proximité' });
  await expect(offer.getByRole('listitem')).toHaveText(['Pré · 60 m · 1 plante Y ajouter Pâquerette vivace']);
  await expect(offer.getByRole('button', { name: 'Y ajouter Pâquerette vivace' })).toBeFocused();
  await offer.getByRole('button', { name: 'Y ajouter Pâquerette vivace' }).click();
  await expect(toast).toContainText('Pâquerette vivace ajouté au lieu « Pré »');

  // A plant's sheet: the same dialog, the plant chosen (no list to choose from), the same offer.
  await app.go(`#/plant/${ortie}`);
  await page.locator('.action-bar .act[data-key="spot"] > button').first().click();
  dialog = page.locator('gf-capture dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.chosen')).toContainText('Ortie dioïque');
  await expect(dialog.getByRole('searchbox', { name: 'Chercher une plante' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Noter ici', exact: true }).click();
  offer = dialog.getByRole('region', { name: 'Lieux à proximité' });
  await expect(offer.getByRole('listitem')).toHaveText(['Pré · 60 m · 2 plantes Y ajouter Ortie dioïque']);
  await dialog.getByRole('button', { name: 'Nouveau lieu ici' }).click();
  await expect(toast).toContainText('Ortie dioïque noté ici (nouveau lieu)');
  await expect.poll(names).toEqual([['', 1], ['Loin', 0], ['Parcours du matin', 0], ['Pré', 2]]);

  // A new lieu's editor: the same lieux (its own plant's lieu opened, « Pré » to add it to), never the parcours.
  await app.go(`#/collection/new?kind=place&plant=${ortie}`);
  offer = page.locator('gf-spot-editor').getByRole('region', { name: 'Lieux à proximité' });
  await expect(offer.getByRole('listitem')).toHaveText(['Ortie dioïque · 0 m · 1 plante Ouvrir ce lieu', 'Pré · 60 m · 2 plantes Y ajouter Ortie dioïque']);

  // An activity's sheet (Rencontres): « Noter ici » over the activity, the address unchanged; « Fermer », still there.
  await app.go(`#/discover?p=${ortie}`);
  await expect.poll(() => page.evaluate(() => location.hash)).toMatch(new RegExp(`^#/app/rencontres/[a-z]+\\?p=${ortie}&fiche=1$`));
  const there = await page.evaluate(() => location.hash);
  const sheet = page.locator('ma-plant-sheet');
  await expect(sheet.locator('.action-bar .act[data-key="map"]')).toHaveCount(0);
  await sheet.locator('.action-bar .act[data-key="spot"] > button').first().click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.chosen')).toContainText('Ortie dioïque');
  expect(await page.evaluate(() => location.hash)).toBe(there);
  // « Autre plante »: the list, its search field focused.
  await dialog.getByRole('button', { name: 'Autre plante' }).click();
  await expect(dialog.getByRole('searchbox', { name: 'Chercher une plante' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(there);
  await expect(sheet).toHaveCount(1);
});

test('Éditeur d’un lieu, mode cueillette éteint : l’ail des ours ouvert montre le colchique, pas la qualité', async ({ app, page }) => {
  await app.open('#/');
  const id = await page.evaluate(async plant => {
    (await import('/app/core/store.js')).setHarvestMode(false);
    const c = await import('/app/core/collections.js');
    const db = await import('/app/core/db.js');
    const place = c.withPlant(c.newPlace([2.351, 48.851], { name: 'Sous-bois' }), await db.get('plants', plant));
    await c.saveCollection(place);
    return place.id;
  }, plantId('Allium ursinum'));
  await app.go(`#/collection/${id}`);
  const editor = page.locator('gf-spot-editor');
  await editor.locator('li.entry button.head').filter({ hasText: 'Ail des ours' }).first().click();
  const entry = editor.locator('li.entry.open');
  const box = entry.locator('gf-lookalikes');
  await expect(box.getByText(/Peut être confondue avec/).first()).toBeVisible();
  await expect(box.getByRole('link', { name: 'Colchique' }).first()).toBeVisible();
  // The harvest log stays the mode's.
  await expect(entry.getByRole('radiogroup', { name: 'Qualité' })).toHaveCount(0);
});
