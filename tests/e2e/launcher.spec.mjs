// The list of the ways to play (gf-launcher: the Découvrir tab's page, the film icon's dialog): a mini-app with a game
// under way offers « Continuer » (where it was left) and « Recommencer » — confirmed in a dialog that says what will be
// deleted, with its counts —, else « Jouer ». « Recommencer » (and « Rejouer » in the app's ⋯) empties everything the
// mini-app owns and made — its game, its favourites, its parcours in Mes plantes —, nothing else, and opens it at its
// first screen: the app's storage as if it had never been opened. Rencontres' services answered here.
import { test, expect, plantId, answerAround } from './fixtures.mjs';

test.use({ reducedMotion: 'reduce' });
test.beforeEach(({ context }) => answerAround(context));

const TITLES = { rencontres: 'Rencontres', parcours: 'Parcours botanique', cueillette: 'Cueillette prudente', mosaique: 'Mosaïque' };
/** The first screen of each, as its start screen says it. */
const START = { rencontres: 'Rencontrez les plantes d’ici', parcours: null, cueillette: 'Cueillette prudente', mosaique: 'La mosaïque du coin' };

/** @param {import('@playwright/test').Page} page */
const hash = page => page.evaluate(() => location.hash);
/** The page's list. @param {import('@playwright/test').Page} page */
const list = page => page.locator('gf-launcher[page]');

/**
 * What the device keeps for the mini-apps (localStorage, the user's whole-app settings left out): to compare with a
 * never-opened app. @param {import('@playwright/test').Page} page
 */
const footprint = page => page.evaluate(() => {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = /** @type {string} */ (localStorage.key(i));
    if (!k.startsWith('geoflora.') || ['geoflora.harvestMode', 'geoflora.backup', 'geoflora.hasSpots', 'geoflora.context', 'geoflora.showSteps'].includes(k)) continue;
    const v = JSON.parse(localStorage.getItem(k) || 'null');
    // The first steps of the app (the tabs that came, the plants seen) are the user's: only Rencontres' guided way.
    out[k] = k === 'geoflora.discover' ? { step: v.step, firstMatch: v.firstMatch, branch: v.branch } : v;
  }
  return out;
});

/** The favourites, with the mini-app that made each (none: null). @param {import('@playwright/test').Page} page */
const favourites = page => page.evaluate(async () => {
  const fav = (await (await import('/app/core/collections.js')).listCollections()).find((/** @type {any} */ c) => c.id === 'favorites');
  return Object.fromEntries((fav?.properties.plants ?? []).map((/** @type {any} */ e) => [e.plantId, e.origin?.app ?? null]));
});

/** A game played in a mini-app, from its start: to its cards (a heart on the first), or a walk with a plant. @param {import('@playwright/test').Page} page @param {string} id */
async function play(page, id) {
  if (id === 'parcours') {
    const trail = page.locator('gf-miniapp');
    await trail.locator('.go').click();
    await trail.locator('.card input.name').fill('Chemin du lavoir');
    await trail.locator('.card input.name').press('Enter');
    await trail.locator('.search input').fill('ortie dioique');
    await trail.locator('.hit').filter({ hasText: 'Urtica dioica' }).locator('.add').click();
    await expect(trail.locator('.mine > li')).toHaveCount(1);
    await expect.poll(() => hash(page)).toBe('#/app/parcours/walk');
    return 'walk';
  }
  await page.getByRole('button', { name: 'Autour de moi' }).click();
  await page.locator('ma-distance').getByRole('button', { name: 'Qui pousse par ici ?' }).click();
  await expect.poll(() => hash(page)).toBe(`#/app/${id}/cards`);
  if (id === 'mosaique') await page.locator('ma-around-list').getByRole('tab', { name: 'Rencontres' }).click();
  await expect(page.locator('ma-deck .swipe-card.top')).toHaveAttribute('data-id', String(plantId('Allium ursinum')));
  await page.locator('ma-deck .round.like').click();
  await expect.poll(async () => (await favourites(page))[plantId('Allium ursinum')]).toBe(id);
  // Rencontres' first match brings its photos: on a phone full screen over the deck (Échap closes it; meet-media.spec).
  if (id === 'rencontres' && await page.evaluate(() => innerWidth < 900)) {
    await expect(page.locator('ma-meet-media[mode="dialog"]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('ma-meet-media')).toHaveCount(0);
  }
  return 'cards';
}

/** The first screen of a mini-app is on screen: the address at its first step, its start's heading or action. @param {import('@playwright/test').Page} page @param {string} id */
async function atStart(page, id) {
  await expect.poll(() => hash(page)).toBe(`#/app/${id}/start`);
  if (START[id]) await expect(page.getByRole('heading', { level: 1, name: START[id] })).toBeVisible();
  else await expect(page.locator('gf-miniapp .go')).toBeVisible();
}

for (const id of /** @type {(keyof typeof TITLES)[]} */ (Object.keys(TITLES))) {
  test(`${TITLES[id]} : « Continuer » reprend où on l’avait laissée ; « Recommencer » efface tout, le départ, comme jamais ouverte`, async ({ app, page }) => {
    await app.open('#/discover');
    const never = await footprint(page);
    await expect(list(page).getByRole('button', { name: `Jouer : ${TITLES[id]}` })).toBeVisible();
    await expect(list(page).getByRole('button', { name: `Continuer : ${TITLES[id]}` })).toHaveCount(0);
    await list(page).getByRole('button', { name: `Jouer : ${TITLES[id]}` }).click();
    await atStart(page, id);
    const step = await play(page, id);
    await page.locator('gf-miniapp .quit').click();
    await expect.poll(() => hash(page)).toBe('#/discover');

    // « Continuer »: back at the step it was left at.
    await list(page).getByRole('button', { name: `Continuer : ${TITLES[id]}` }).click();
    await expect.poll(() => hash(page)).toBe(`#/app/${id}/${step}`);
    if (id === 'parcours') await expect(page.locator('gf-miniapp .mine > li')).toHaveCount(1);
    else await expect(page.locator('ma-around-list .head')).toBeVisible();
    await page.locator('gf-miniapp .quit').click();
    await expect.poll(() => hash(page)).toBe('#/discover');

    // « Recommencer », then « Annuler »: nothing changes.
    const before = await footprint(page);
    const card = list(page).locator(`li[data-app="${id}"]`);
    await card.getByRole('button', { name: `Recommencer : ${TITLES[id]}` }).click();
    const dialog = list(page).locator('dialog.ask');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Annuler' })).toBeFocused();
    await expect(dialog).toContainText('Recommencer : tout effacer ?');
    await expect(dialog).toContainText(id === 'parcours'
      ? 'Seront supprimés : le parcours en cours « Chemin du lavoir » (1 plante), la partie en cours. Cette action est définitive.'
      : `Seront supprimés : 1 favori ajouté par ${TITLES[id]}, la partie en cours. Cette action est définitive.`);
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    await expect(dialog).toBeHidden();
    expect(await footprint(page)).toEqual(before);
    expect(await hash(page)).toBe('#/discover');

    // Confirmed: its first screen, everything it owns and made gone, as if never opened.
    await card.getByRole('button', { name: `Recommencer : ${TITLES[id]}` }).click();
    await dialog.getByRole('button', { name: 'Recommencer' }).click();
    await atStart(page, id);
    expect(await footprint(page)).toEqual(never);
    if (id === 'parcours') {
      await expect.poll(() => page.evaluate(async () => (await (await import('/app/core/collections.js')).listCollections())
        .filter((/** @type {any} */ c) => c.properties.name === 'Chemin du lavoir').length)).toBe(0);
    } else expect(await favourites(page)).toEqual({});
    await page.reload();
    await app.ready();
    await atStart(page, id);
    expect(await footprint(page)).toEqual(never);
    await page.locator('gf-miniapp .quit').click();
    await expect(list(page).getByRole('button', { name: `Jouer : ${TITLES[id]}` })).toBeVisible();
  });
}

test('Recommencer une partie ne touche pas les autres, ni un favori venu d’ailleurs', async ({ app, page }) => {
  await app.open('#/');
  // A favourite from Flore, before: kept whatever the games do with it.
  await page.evaluate(async id => {
    const db = await import('/app/core/db.js');
    await (await import('/app/core/collections.js')).toggleFavorite(await db.get('plants', id));
  }, plantId('Taraxacum officinale'));
  await app.go('#/app/rencontres');
  await play(page, 'rencontres');
  // The plant already a favourite: a heart on it does not make it Rencontres'.
  await expect(page.locator('ma-deck .swipe-card.top')).toHaveAttribute('data-id', String(plantId('Taraxacum officinale')));
  await page.locator('ma-deck .round.like').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.app.rencontres.state') || 'null')?.ctx.matches.length)).toBe(2);
  // Cueillette prudente: its own game (a card passed).
  await app.go('#/app/cueillette');
  await page.getByRole('button', { name: 'Autour de moi' }).click();
  await page.locator('ma-distance').getByRole('button', { name: 'Qui pousse par ici ?' }).click();
  await expect(page.locator('ma-deck .swipe-card.top')).toHaveAttribute('data-id', String(plantId('Allium ursinum')));
  await page.locator('ma-deck .round.pass').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.app.cueillette.state') || 'null')?.ctx.passed.length)).toBe(1);
  const fav = await favourites(page);
  expect(fav).toEqual({ [plantId('Taraxacum officinale')]: null, [plantId('Allium ursinum')]: 'rencontres' });
  const cueillette = await page.evaluate(() => localStorage.getItem('geoflora.app.cueillette.state'));
  // « Rejouer » from Rencontres' ⋯.
  await app.go('#/app/rencontres/cards');
  const box = page.locator('gf-miniapp');
  await box.locator('.more summary').click();
  await box.locator('.menu').getByRole('button', { name: 'Rejouer' }).click();
  await expect(box.getByRole('dialog')).toContainText('Seront supprimés : 1 favori ajouté par Rencontres, la partie en cours.');
  await box.getByRole('dialog').getByRole('button', { name: 'Rejouer' }).click();
  await atStart(page, 'rencontres');
  expect(await favourites(page)).toEqual({ [plantId('Taraxacum officinale')]: null });
  expect(await page.evaluate(() => localStorage.getItem('geoflora.app.cueillette.state'))).toBe(cueillette);
  await page.reload();
  await app.ready();
  await atStart(page, 'rencontres');
});

test('la liste avec une partie en cours (captures)', async ({ app, page }, info) => {
  await app.open('#/discover');
  await list(page).getByRole('button', { name: 'Jouer : Cueillette prudente' }).click();
  await play(page, 'cueillette');
  await page.locator('gf-miniapp .quit').click();
  await expect(list(page).getByRole('button', { name: 'Continuer : Cueillette prudente' })).toBeVisible();
  await expect(list(page).getByRole('button', { name: 'Jouer : Rencontres' })).toBeVisible();
  await expect(list(page).getByRole('button', { name: 'Jouer : Mosaïque' })).toBeVisible();
  await expect(list(page).getByRole('button', { name: 'Jouer : Scientifique' })).toHaveCount(0);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/launcher-underway-${info.project.name}.png`, fullPage: false });
});

/** The places of Mes plantes named so, with their origin (who made them, still theirs) and where they came from. @param {import('@playwright/test').Page} page @param {string} name */
const walksNamed = (page, name) => page.evaluate(async n => (await (await import('/app/core/collections.js')).listCollections())
  .filter((/** @type {any} */ c) => c.properties.name === n).map((/** @type {any} */ c) => ({ origin: c.properties.origin ?? null, from: c.properties.from ?? null })), name);

test('Parcours : un parcours terminé avec ses plantes reste dans Mes plantes, le sien désormais', async ({ app, page }) => {
  await app.open('#/discover');
  await list(page).getByRole('button', { name: 'Jouer : Parcours botanique' }).click();
  await play(page, 'parcours');
  expect(await walksNamed(page, 'Chemin du lavoir')).toEqual([{ origin: { app: 'parcours' }, from: null }]);
  // A plant touched first (its occurrences lit), then « Terminer »: the recap, and it stays.
  await page.locator('gf-miniapp .mine .pick').first().click();
  await page.locator('gf-miniapp .end').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Parcours terminé' })).toBeVisible();
  await expect.poll(() => walksNamed(page, 'Chemin du lavoir')).toEqual([{ origin: null, from: { app: 'parcours' } }]);
  // Still the recap once its promotion is written (no stale reload brings the walk back).
  await page.waitForTimeout(800);
  await expect(page.getByRole('heading', { level: 1, name: 'Parcours terminé' })).toBeVisible();
  const box = page.locator('gf-miniapp');
  await box.locator('.more summary').click();
  await box.locator('.menu').getByRole('button', { name: 'Rejouer' }).click();
  const dialog = box.getByRole('dialog');
  await expect(dialog).toContainText('Seront supprimés : la partie en cours. Cette action est définitive. Votre parcours enregistré dans Mes plantes est conservé.');
  await dialog.getByRole('button', { name: 'Rejouer' }).click();
  await atStart(page, 'parcours');
  expect(await walksNamed(page, 'Chemin du lavoir')).toEqual([{ origin: null, from: { app: 'parcours' } }]);
});

test('Parcours : un parcours en cours renommé depuis Mes plantes est gardé ; Annuler ne supprime rien', async ({ app, page }) => {
  await app.open('#/discover');
  await list(page).getByRole('button', { name: 'Jouer : Parcours botanique' }).click();
  await play(page, 'parcours');
  await page.locator('gf-miniapp .quit').click();
  const id = await page.evaluate(async () => (await (await import('/app/core/collections.js')).listCollections()).find((/** @type {any} */ c) => c.properties.name === 'Chemin du lavoir')?.id);
  // Mes plantes: the walk's editor, its name changed.
  await app.go(`#/collection/${id}`);
  await page.locator('gf-spot-editor input').first().fill('Le lavoir, à moi');
  await expect.poll(() => walksNamed(page, 'Le lavoir, à moi')).toEqual([{ origin: null, from: { app: 'parcours' } }]);
  await app.go('#/discover');
  await list(page).getByRole('button', { name: 'Recommencer : Parcours botanique' }).click();
  const dialog = list(page).locator('dialog.ask');
  await expect(dialog).toContainText('Seront supprimés : la partie en cours. Cette action est définitive. Votre parcours enregistré dans Mes plantes est conservé.');
  await dialog.getByRole('button', { name: 'Recommencer' }).click();
  await atStart(page, 'parcours');
  expect(await walksNamed(page, 'Le lavoir, à moi')).toEqual([{ origin: null, from: { app: 'parcours' } }]);
});

test('Rencontres : un favori de match rangé dans une liste est gardé, un favori de match simple supprimé', async ({ app, page }) => {
  await app.open('#/discover');
  await list(page).getByRole('button', { name: 'Jouer : Rencontres' }).click();
  await play(page, 'rencontres');
  await expect(page.locator('ma-deck .swipe-card.top')).toHaveAttribute('data-id', String(plantId('Taraxacum officinale')));
  await page.locator('ma-deck .round.like').click();
  await expect.poll(() => favourites(page)).toEqual({ [plantId('Allium ursinum')]: 'rencontres', [plantId('Taraxacum officinale')]: 'rencontres' });
  // The wild garlic put in a list of the user's (« Ajouter à… »): theirs now.
  await page.evaluate(async id => {
    const c = await import('/app/core/collections.js');
    const db = await import('/app/core/db.js');
    const listOf = c.newCollection('list', { name: 'Cuisine' });
    await c.saveCollection(listOf);
    await c.setInCollection(listOf.id, await db.get('plants', id), true);
  }, plantId('Allium ursinum'));
  await expect.poll(() => favourites(page)).toEqual({ [plantId('Allium ursinum')]: null, [plantId('Taraxacum officinale')]: 'rencontres' });
  await page.locator('gf-miniapp .quit').click();
  await list(page).getByRole('button', { name: 'Recommencer : Rencontres' }).click();
  const dialog = list(page).locator('dialog.ask');
  await expect(dialog).toContainText('Seront supprimés : 1 favori ajouté par Rencontres, la partie en cours. Cette action est définitive. Votre favori venu de cette partie, rangé ou annoté depuis, est conservé.');
  await dialog.getByRole('button', { name: 'Recommencer' }).click();
  await atStart(page, 'rencontres');
  expect(await favourites(page)).toEqual({ [plantId('Allium ursinum')]: null });
  await page.reload();
  await app.ready();
  expect(await favourites(page)).toEqual({ [plantId('Allium ursinum')]: null });
});
