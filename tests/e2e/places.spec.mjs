// Mes plantes and the Carte: a place saved shows in the list of collections, on the map, and opens in its editor
// with its plants. Migrated from places.cjs, mine.cjs, coll.cjs, map.cjs, mapedit.cjs, newplace.cjs.
import { test, expect, plantId } from './fixtures.mjs';

/** A place with two plants, a list with one. @param {import('@playwright/test').Page} page */
const seed = page => page.evaluate(async ids => {
  const c = await import('/app/core/collections.js');
  const db = await import('/app/core/db.js');
  const [ail, ortie] = await Promise.all(ids.map(id => db.get('plants', id)));
  const place = c.withPlant(c.withPlant(c.newPlace([2.351, 48.851], { name: 'Bois de la Source' }), ail), ortie, [2.3512, 48.8509]);
  await c.savePlace(place);
  await c.savePlace(c.withPlant(c.newCollection('list', { name: 'À cueillir' }), ail));
  return place.id;
}, [plantId('Allium ursinum'), plantId('Urtica dioica')]);

test('Mes plantes : le lieu et la liste enregistrés y sont', async ({ app, page }) => {
  await app.open('#/');
  await seed(page);
  await app.go('#/collections');
  const mine = page.locator('gf-collections');
  await expect(mine.getByText('Bois de la Source').first()).toBeVisible();
  await expect(mine.getByText('À cueillir').first()).toBeVisible();
});

test('Carte : le lieu en repère ; son éditeur montre ses plantes', async ({ app, page }) => {
  await app.open('#/');
  const id = await seed(page);
  await app.go(`#/map?spot=${id}`);
  await expect.poll(() => page.locator('gf-map-page .leaflet-marker-icon').count()).toBeGreaterThanOrEqual(1);
  await app.go(`#/collection/${id}`);
  const editor = page.locator('gf-spot-editor');
  await expect(editor.locator('input').first()).toHaveValue('Bois de la Source');
  await expect(editor.getByText('Ail des ours').first()).toBeVisible();
  await expect(editor.getByText('Ortie dioïque').first()).toBeVisible();
});

test('Flore « Voir dans Flore » d’une collection : exactement ses plantes', async ({ app, page }) => {
  await app.open('#/');
  await seed(page);
  const listId = await page.evaluate(async () => (await (await import('/app/core/collections.js')).listCollections())
    .find((/** @type {any} */ c) => c.properties.name === 'À cueillir')?.id);
  await app.go(`#/?mine=${listId}`);
  await expect.poll(() => app.state('results.total')).toBe(1);
  expect((await app.state('results.items'))[0].id).toBe(plantId('Allium ursinum'));
});

/** Every collection, as the user sees it (kind, point, plants and their positions). @param {import('@playwright/test').Page} page */
const dump = page => page.evaluate(async () => (await (await import('/app/core/collections.js')).listCollections())
  .map((/** @type {any} */ c) => ({ id: c.id, name: c.properties.name, kind: c.properties.kind, at: c.geometry?.coordinates ?? null,
    plants: c.properties.plants.map((/** @type {any} */ e) => [e.plantId, e.coordinates]) })));

test('Retirer la position : refusée quand des plantes ont leur position, « Copier en liste » à la place', async ({ app, page }) => {
  await app.open('#/');
  const [ail, ortie] = [plantId('Allium ursinum'), plantId('Urtica dioica')];
  const id = await page.evaluate(async ids => {
    const c = await import('/app/core/collections.js');
    const db = await import('/app/core/db.js');
    const [a, o] = await Promise.all(ids.map(i => db.get('plants', i)));
    let place = c.newPlace([2.351, 48.851], { name: 'Bois' });
    place = c.withPlant(c.withPlant(place, a, { coordinates: [2.3512, 48.8511], accuracy: 4 }), o, { coordinates: [2.3508, 48.8509], accuracy: 5 });
    return (await c.savePlace(place)).id;
  }, [ail, ortie]);
  await app.go(`#/map?spot=${id}`);
  await page.locator('gf-spot-editor').getByRole('button', { name: 'Retirer la position' }).click();
  const ask = page.getByRole('alertdialog', { name: 'Le lieu garde sa position' });
  await expect(ask).toContainText('retirer la position effacerait les positions de 2 plantes.');
  await expect(ask.getByRole('button', { name: 'Annuler' })).toBeFocused();
  await ask.getByRole('button', { name: 'Copier en liste' }).click();

  // The new list, opened: each plant once, no position; said.
  await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/collection\/[^?]+$/);
  const editor = page.locator('gf-spot-editor');
  await expect(editor.getByRole('textbox', { name: 'Nom de la liste' })).toHaveValue('Bois (liste)');
  await expect(editor.locator('.entries > li')).toHaveCount(2);
  await expect(page.locator('.gf-brief-toast')).toHaveText('Liste « Bois (liste) » créée. Le lieu garde ses positions.');
  // The lieu as it was: its point, both plants at theirs.
  const all = await dump(page);
  expect(all.find((/** @type {any} */ c) => c.id === id)).toEqual({ id, name: 'Bois', kind: 'place', at: [2.351, 48.851],
    plants: [[ail, [2.3512, 48.8511]], [ortie, [2.3508, 48.8509]]] });
  expect(all.find((/** @type {any} */ c) => c.name === 'Bois (liste)')).toMatchObject({ kind: 'list', at: null, plants: [[ail, null], [ortie, null]] });
});

test('Retirer la position sans rien perdre : demandée, puis faite ; la liste s’ouvre', async ({ app, page }) => {
  await app.open('#/');
  const id = await page.evaluate(async i => {
    const c = await import('/app/core/collections.js');
    const db = await import('/app/core/db.js');
    // « Noter ici »: the plant on the lieu's point, with the fix's accuracy.
    const place = c.withPlant(c.newPlace([2.351, 48.851], { name: 'Clairière' }), await db.get('plants', i), { coordinates: [2.351, 48.851], accuracy: 6 });
    return (await c.savePlace(place)).id;
  }, plantId('Allium ursinum'));
  await app.go(`#/map?spot=${id}`);
  const editor = page.locator('gf-spot-editor');
  await editor.getByRole('button', { name: 'Retirer la position' }).click();
  const ask = page.getByRole('alertdialog', { name: 'Retirer la position ?' });
  await expect(ask).toContainText('Le lieu devient une liste de plantes.');
  // Annuler: nothing changes.
  await ask.getByRole('button', { name: 'Annuler' }).click();
  await expect(ask).toHaveCount(0);
  expect((await dump(page))[0]).toMatchObject({ kind: 'place', at: [2.351, 48.851] });
  await editor.getByRole('button', { name: 'Retirer la position' }).click();
  await page.getByRole('alertdialog', { name: 'Retirer la position ?' }).getByRole('button', { name: 'Retirer la position' }).click();
  // The list, in its own page (the Carte shows only lieux); said.
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/collection/${id}`);
  await expect(page.locator('gf-spot-editor').getByRole('textbox', { name: 'Nom de la liste' })).toHaveValue('Clairière');
  await expect(page.locator('.gf-brief-toast')).toHaveText('Position retirée : le lieu est maintenant une liste.');
  expect(await dump(page)).toEqual([{ id, name: 'Clairière', kind: 'list', at: null, plants: [[plantId('Allium ursinum'), null]] }]);
  // From its own page: said too, and the focus kept in the form (its button gone with the point), on the name.
  await editor.getByRole('button', { name: 'Ajouter des coordonnées GPS (la liste devient un lieu)' }).click();
  await expect(editor.getByRole('button', { name: 'Retirer la position' })).toBeVisible();
  await editor.getByRole('button', { name: 'Retirer la position' }).click();
  await page.getByRole('alertdialog', { name: 'Retirer la position ?' }).getByRole('button', { name: 'Retirer la position' }).click();
  await expect(editor.getByRole('textbox', { name: 'Nom de la liste' })).toBeFocused();
  await expect(page.locator('.gf-brief-toast')).toHaveText('Position retirée : le lieu est maintenant une liste.');
  await expect.poll(async () => (await dump(page))[0].kind).toBe('list');
});

test('Ajouter à… : décocher un lieu demande avant d’effacer le journal de récolte de la plante ; « Annuler » la laisse cochée', async ({ app, page }) => {
  await app.open('#/');
  const ail = plantId('Allium ursinum');
  const id = await page.evaluate(async i => {
    const c = await import('/app/core/collections.js');
    const db = await import('/app/core/db.js');
    const place = c.withPlant(c.newPlace([2.351, 48.851], { name: 'Bois' }), await db.get('plants', i));
    return (await c.savePlace(c.withEntry(place, i, { harvests: [{ date: '2026-04-12', quantity: '1 kg', note: '' }] }))).id;
  }, ail);
  const plants = () => page.evaluate(async i => (await (await import('/app/core/collections.js')).getPlace(i))?.properties.plantIds, id);
  await app.go(`#/plant/${ail}`);
  await page.locator('.action-bar .act[data-key="addTo"] > button').first().click();
  const sheet = page.getByRole('dialog', { name: 'Ajouter à une liste ou un lieu' });
  const box = sheet.getByRole('checkbox', { name: /Bois/ });
  await expect(box).toBeChecked();
  // A click, not uncheck(): the box is ticked again when kept.
  await box.click();
  const ask = page.getByRole('alertdialog', { name: 'Retirer Ail des ours de ce lieu ?' });
  await expect(ask).toContainText('Son journal de récolte sera effacé.');
  await ask.getByRole('button', { name: 'Annuler' }).click();
  await expect(ask).toHaveCount(0);
  await expect(box).toBeChecked();
  // The focus back on the box (never thrown out of the list).
  await expect(box).toBeFocused();
  await expect(sheet).toBeVisible();
  expect(await plants()).toEqual([ail]);
  // Again, « Retirer »: out of the lieu, at once (« Ajouter à… » stays open under the question).
  await box.click();
  await page.getByRole('alertdialog', { name: 'Retirer Ail des ours de ce lieu ?' }).getByRole('button', { name: 'Retirer' }).click();
  await expect(box).not.toBeChecked();
  await expect(box).toBeFocused();
  await expect.poll(plants).toEqual([]);
  await expect(sheet).toBeVisible();
});

test('Nouveau lieu ajouté à une liste existante : demandé d’abord ; la plante déjà là réunie à elle, ses notes bout à bout', async ({ app, page }) => {
  await app.open('#/');
  const ail = plantId('Allium ursinum');
  const listId = await page.evaluate(async i => {
    const c = await import('/app/core/collections.js');
    const db = await import('/app/core/db.js');
    const list = c.withPlant(c.newCollection('list', { name: 'Mellifères' }), await db.get('plants', i));
    return (await c.savePlace(c.withEntry(list, i, { notes: 'En sous-bois' }))).id;
  }, ail);
  await app.go(`#/collection/new?kind=place&plant=${ail}`);
  const editor = page.locator('gf-spot-editor');
  await editor.getByRole('textbox', { name: 'Notes sur cette plante' }).fill('Fleurs en avril');
  await editor.getByRole('textbox', { name: 'Nom du lieu' }).fill('Mellif');
  const existing = editor.getByRole('group', { name: 'Listes et lieux existants' }).getByRole('button', { name: /Mellifères/ });
  await existing.click();
  const ask = page.getByRole('alertdialog', { name: 'Ajouter à la liste « Mellifères » ?' });
  await expect(ask).toContainText('Une liste ne garde pas de position : le point de ce nouveau lieu et les positions de ses plantes ne seront pas gardés.');
  // Annuler: the new lieu as it was, nothing written.
  await ask.getByRole('button', { name: 'Annuler' }).click();
  await expect(ask).toHaveCount(0);
  await expect(editor.getByRole('textbox', { name: 'Nom du lieu' })).toHaveValue('Mellif');
  const list = () => page.evaluate(async i => (await (await import('/app/core/collections.js')).listCollections())
    .map((/** @type {any} */ c) => [c.id === i ? 'liste' : c.properties.kind, c.properties.plants.map((/** @type {any} */ e) => [e.plantId, e.notes])]), listId);
  expect(await list()).toEqual([['liste', [[ail, 'En sous-bois']]]]);
  await existing.click();
  await page.getByRole('alertdialog', { name: 'Ajouter à la liste « Mellifères » ?' }).getByRole('button', { name: 'Ajouter à la liste' }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/collection/${listId}`);
  // Once in the list, its notes joined; no lieu made.
  await expect.poll(list).toEqual([['liste', [[ail, 'En sous-bois\n\nFleurs en avril']]]]);
});

test('L’éditeur d’un lieu : retirer une plante annotée demande d’abord, « Annuler » la garde ; sans rien d’écrit, elle part sans question', async ({ app, page }) => {
  await app.open('#/');
  const [ail, ortie] = [plantId('Allium ursinum'), plantId('Urtica dioica')];
  const id = await page.evaluate(async ids => {
    const c = await import('/app/core/collections.js');
    const db = await import('/app/core/db.js');
    const [a, o] = await Promise.all(ids.map(i => db.get('plants', i)));
    const place = c.withPlant(c.withPlant(c.newPlace([2.351, 48.851], { name: 'Bois' }), a), o);
    return (await c.savePlace(c.withEntry(place, ids[0], { notes: 'Coin humide derrière le lavoir' }))).id;
  }, [ail, ortie]);
  const plants = () => page.evaluate(async i => (await (await import('/app/core/collections.js')).getPlace(i))?.properties.plantIds, id);
  await app.go(`#/collection/${id}`);
  const editor = page.locator('gf-spot-editor');
  const entry = (/** @type {string} */ name) => editor.locator('.entries > li').filter({ hasText: name });
  await entry('Ail des ours').locator('button.head').click();
  await entry('Ail des ours').getByRole('button', { name: 'Retirer cette plante du lieu' }).click();
  const ask = page.getByRole('alertdialog', { name: 'Retirer Ail des ours de ce lieu ?' });
  await expect(ask).toContainText('Sa note sera effacée.');
  await expect(ask.getByRole('button', { name: 'Annuler' })).toBeFocused();
  await ask.getByRole('button', { name: 'Annuler' }).click();
  await expect(ask).toHaveCount(0);
  await expect(entry('Ail des ours')).toHaveCount(1);
  expect(await plants()).toEqual([ail, ortie]);
  await entry('Ail des ours').getByRole('button', { name: 'Retirer cette plante du lieu' }).click();
  await page.getByRole('alertdialog', { name: 'Retirer Ail des ours de ce lieu ?' }).getByRole('button', { name: 'Retirer' }).click();
  await expect(entry('Ail des ours')).toHaveCount(0);
  await expect.poll(plants).toEqual([ortie]);
  // Nothing written on it: gone at once, nothing asked.
  await entry('Ortie dioïque').locator('button.head').click();
  await entry('Ortie dioïque').getByRole('button', { name: 'Retirer cette plante du lieu' }).click();
  await expect(entry('Ortie dioïque')).toHaveCount(0);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect.poll(plants).toEqual([]);
});

test('L’éditeur : « Supprimer » une liste demande dans la question de l’app, jamais la boîte du navigateur ; « Annuler » la garde, un double clic aussi', async ({ app, page }) => {
  /** The browser's own dialogs (confirm(): a test would answer it by itself): none. @type {string[]} */
  const native = [];
  page.on('dialog', dialog => { native.push(dialog.message()); dialog.dismiss(); });
  await app.open('#/');
  const id = await page.evaluate(async ids => {
    const c = await import('/app/core/collections.js');
    const db = await import('/app/core/db.js');
    const [a, o] = await Promise.all(ids.map(i => db.get('plants', i)));
    return (await c.savePlace(c.withPlant(c.withPlant(c.newCollection('list', { name: 'À cueillir' }), a), o))).id;
  }, [plantId('Allium ursinum'), plantId('Urtica dioica')]);
  const stored = () => page.evaluate(async i => Boolean(await (await import('/app/core/collections.js')).getPlace(i)), id);
  await app.go(`#/collection/${id}`);
  const remove = page.locator('gf-spot-editor').getByRole('button', { name: 'Supprimer', exact: true });
  await remove.click();
  const ask = page.getByRole('alertdialog', { name: 'Supprimer cette liste ?' });
  await expect(ask).toContainText('La liste et ses 2 plantes, avec leurs notes, seront effacées. Cette action est définitive.');
  await expect(ask.getByRole('button', { name: 'Annuler' })).toBeFocused();
  // « Annuler »: the list kept, the focus back on « Supprimer ».
  await ask.getByRole('button', { name: 'Annuler' }).click();
  await expect(ask).toHaveCount(0);
  await expect(remove).toBeFocused();
  expect(await stored()).toBe(true);
  // A double click on « Supprimer »: its second click, in the question just opened, is no answer — it stays, unread.
  await remove.dblclick();
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Annuler' }).click();
  await expect(ask).toHaveCount(0);
  expect(await stored()).toBe(true);
  // « Supprimer »: gone, Mes plantes in its place.
  await remove.click();
  await ask.getByRole('button', { name: 'Supprimer' }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/collections');
  await expect.poll(stored).toBe(false);
  expect(native).toEqual([]);
});

test('Nouvelle liste versée dans une liste existante : ses notes la suivent, le brouillon supprimé', async ({ app, page }) => {
  await app.open('#/');
  const [ail, ortie] = [plantId('Allium ursinum'), plantId('Urtica dioica')];
  const listId = await page.evaluate(async i => {
    const c = await import('/app/core/collections.js');
    const db = await import('/app/core/db.js');
    return (await c.savePlace(c.withPlant(c.newCollection('list', { name: 'Tisanes', notes: 'Récoltes de printemps' }), await db.get('plants', i)))).id;
  }, ail);
  await app.go(`#/collection/new?kind=list&plant=${ortie}`);
  const editor = page.locator('gf-spot-editor');
  await editor.getByRole('textbox', { name: 'Notes', exact: true }).fill('Pour les tisanes de l’hiver');
  await editor.getByRole('textbox', { name: 'Nom de la liste' }).fill('Tisa');
  await editor.getByRole('group', { name: 'Listes et lieux existants' }).getByRole('button', { name: /Tisanes/ }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/collection/${listId}`);
  // One list: its plants and the draft's, its notes and then the draft's; the draft gone.
  await expect.poll(() => page.evaluate(async () => (await (await import('/app/core/collections.js')).listCollections())
    .map((/** @type {any} */ c) => [c.properties.name, c.properties.notes, c.properties.plantIds])))
    .toEqual([['Tisanes', 'Récoltes de printemps\n\nPour les tisanes de l’hiver', [ail, ortie]]]);
});

test('♥ ôté d’un favori annoté (sa fiche, sa carte dans Flore) : demandé d’abord, « Annuler » le garde ; sans rien d’écrit, ôté à l’instant', async ({ app, page }) => {
  await app.open('#/');
  const [ail, ortie] = [plantId('Allium ursinum'), plantId('Urtica dioica')];
  await page.evaluate(async ids => {
    const c = await import('/app/core/collections.js');
    const db = await import('/app/core/db.js');
    for (const i of ids) await c.toggleFavorite(await db.get('plants', i));
    await c.updatePlace('favorites', f => c.withEntry(f, ids[0], { notes: 'Coin humide derrière le lavoir', rating: 4 }));
  }, [ail, ortie]);
  const favourites = () => page.evaluate(async () => ((await (await import('/app/core/collections.js')).getPlace('favorites'))?.properties.plants ?? [])
    .map((/** @type {any} */ e) => [e.plantId, e.notes]));
  await app.go(`#/plant/${ail}`);
  const heart = page.locator('.action-bar .act[data-key="fav"] > button').first();
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  await heart.click();
  const ask = page.getByRole('alertdialog', { name: 'Retirer Ail des ours des favoris ?' });
  await expect(ask).toContainText('Sa note sera effacée.');
  await ask.getByRole('button', { name: 'Annuler' }).click();
  await expect(ask).toHaveCount(0);
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  expect(await favourites()).toEqual([[ail, 'Coin humide derrière le lavoir'], [ortie, '']]);
  await heart.click();
  await page.getByRole('alertdialog', { name: 'Retirer Ail des ours des favoris ?' }).getByRole('button', { name: 'Retirer' }).click();
  await expect(heart).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(favourites).toEqual([[ortie, '']]);
  // A plant card's ♥ in Flore, the nettle annotated meanwhile: asked the same way.
  await page.evaluate(async i => {
    const c = await import('/app/core/collections.js');
    await c.updatePlace('favorites', f => c.withEntry(f, i, { notes: 'En soupe' }));
  }, ortie);
  await app.go('#/?q=ortie');
  await page.getByRole('button', { name: 'Retirer des favoris : Ortie dioïque' }).first().click();
  const again = page.getByRole('alertdialog', { name: 'Retirer Ortie dioïque des favoris ?' });
  await expect(again).toContainText('Sa note sera effacée.');
  await again.getByRole('button', { name: 'Annuler' }).click();
  await expect(again).toHaveCount(0);
  expect(await favourites()).toEqual([[ortie, 'En soupe']]);
  // Nothing written on it: gone at once.
  await page.evaluate(async i => {
    const c = await import('/app/core/collections.js');
    await c.updatePlace('favorites', f => c.withEntry(f, i, { notes: '' }));
  }, ortie);
  await page.getByRole('button', { name: 'Retirer des favoris : Ortie dioïque' }).first().click();
  await expect.poll(favourites).toEqual([]);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('Le 📍 de Flore et « Dans mes listes et lieux » ouvrent la plante notée, la première fois ; un lien d’avant (focus= une plante) : le lieu, rien de déplié', async ({ app, page }) => {
  await app.open('#/');
  const ortie = plantId('Urtica dioica');
  // The lieu « Talus », the nettle noted there twice (the second a step away).
  const { id, first } = await page.evaluate(async plant => {
    const c = await import('/app/core/collections.js');
    const o = await (await import('/app/core/db.js')).get('plants', plant);
    const twice = c.withPlant(c.withPlant(c.newPlace([2.351, 48.851], { name: 'Talus' }), o), o, { coordinates: [2.3514, 48.8512] }, { again: true });
    const saved = await c.savePlace(twice);
    return { id: saved.id, first: saved.properties.plants[0].id };
  }, ortie);
  const opened = async () => {
    const entry = page.locator('gf-spot-editor li.entry.open');
    await expect(entry).toHaveCount(1);
    await expect(entry.locator('.nth')).toHaveText('n° 1');
  };
  // The results grid (its 📍 column): the lieu on the Carte, its first noting open.
  await app.go('#/?q=ortie');
  const pin = page.getByRole('link', { name: 'Voir sur la carte : Ortie dioïque' });
  await expect(pin).toHaveAttribute('href', `#/map?spot=${id}&focus=${first}`);
  await pin.click();
  await opened();
  // The sheet's « Dans mes listes et lieux »: the same.
  await app.go(`#/plant/${ortie}`);
  const see = page.locator('gf-plant-detail .mine').getByRole('button', { name: 'Voir' });
  if (await see.count()) await see.first().click();
  const link = page.locator('gf-plant-spots li a').first();
  await expect(link).toHaveAttribute('href', `#/map?spot=${id}&focus=${first}`);
  await link.click();
  await opened();
  // A link of before, focus= giving the plant: the lieu, nothing unfolded.
  await app.open(`#/map?spot=${id}&focus=${ortie}`);
  await expect(page.locator('gf-spot-editor li.entry')).toHaveCount(2);
  await expect(page.locator('gf-spot-editor li.entry.open')).toHaveCount(0);
});
