// The games around a place as mini-apps — Cueillette prudente and Mosaïque beside Rencontres —, each with its own
// game: its start, its map and distance, its cards (#/app/<id>/<step>); Cueillette prudente's safety warnings exactly
// as before (never pick without a certain identification, the look-alikes, the deadliest first, toxicity); Mosaïque's
// photo grid; the old addresses of Découvrir; the session the three shared before handed over to each; « Rejouer » in
// one leaving the others as they were. Rencontres' services answered here.
import { test, expect, plantId, answerAround } from './fixtures.mjs';

test.use({ reducedMotion: 'reduce' });
test.beforeEach(({ context }) => answerAround(context));

/** @param {import('@playwright/test').Page} page */
const hash = page => page.evaluate(() => location.hash);
/** What a mini-app keeps (its state's ctx; none: null). @param {import('@playwright/test').Page} page @param {string} id */
const kept = (page, id) => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null')?.ctx ?? null, `geoflora.app.${id}.state`);

/** A mini-app around a place played to its cards: « Autour de moi », « Qui pousse par ici ? ». @param {import('@playwright/test').Page} page @param {string} id */
async function toCards(page, id) {
  await page.getByRole('button', { name: 'Autour de moi' }).click();
  await expect.poll(() => hash(page)).toBe(`#/app/${id}/map`);
  await page.locator('ma-distance').getByRole('button', { name: 'Qui pousse par ici ?' }).click();
  await expect.poll(() => hash(page)).toBe(`#/app/${id}/cards`);
}

/** « Rejouer » from the box's ⋯, confirmed. @param {import('@playwright/test').Page} page */
async function replay(page) {
  const box = page.locator('gf-miniapp');
  await box.locator('.more summary').click();
  await box.locator('.menu').getByRole('button', { name: 'Rejouer' }).click();
  const dialog = box.getByRole('dialog');
  await expect(dialog).toContainText('Recommencer : tout effacer ?');
  await dialog.getByRole('button', { name: 'Rejouer' }).click();
  await expect(dialog).toBeHidden();
}

test('Cueillette prudente : ses avertissements de sécurité, tels qu’avant ; la plus dangereuse d’abord', async ({ app, page }) => {
  await app.open('#/app/cueillette');
  await expect(page.locator('gf-miniapp .start .caution')).toHaveText('Ne cueillez jamais une plante sans être sûr de vous.');
  await toCards(page, 'cueillette');
  const list = page.locator('ma-around-list');
  await expect(list.locator('.head h1')).toHaveText('Cueillette prudente · Autour de vous');
  // Never without a certain identification, each plant here has a dangerous look-alike, whom to call.
  const banner = list.locator('.banner-warn[role="note"]');
  await expect(banner).toContainText('Ne cueillez jamais une plante sans identification certaine : chacune de ces plantes a un sosie dangereux (liste de l’Anses et des Centres antipoison).');
  await expect(banner).toContainText('Centre antipoison : centres-antipoison.net (liste officielle) · 15 ou 112 en cas de détresse vitale.');
  // Only the plants of a dangerous confusion (2 of the 12 around), the deadliest look-alike first.
  await expect(list.locator('.head .where')).toHaveText('2 plantes à moins de 1 km');
  const top = list.locator('.swipe-card.top');
  await expect(top).toHaveAttribute('data-id', String(plantId('Allium ursinum')));
  await expect(top.locator('.bio li').first()).toHaveText('⚠️ Ne me confondez pas avec Colchique (mortel). Partie : feuilles.');
  await expect(top.locator('.bio li').nth(1)).toHaveText('⚠️ Ne me confondez pas avec Muguet (très toxique). Partie : feuilles.');
  await expect(top.locator('.bio')).toContainText('🍽️ Partie consommée selon l’Anses : feuilles. J’ai des sosies dangereux (2) : lisez ma fiche avant de passer à table.');
  await page.keyboard.press('ArrowLeft');
  await expect(top).toHaveAttribute('data-id', String(plantId('Conium maculatum')));
  await expect(top.locator('.bio li').first()).toHaveText('☠️ Je suis le sosie très toxique de Persil plat.');
  await expect(top.locator('.bio')).toContainText('☠️ Liste B de l’ANSM : toxicité de la plante. On regarde, on ne goûte pas.');
  // « Toutes »: each tile says « Attention ».
  await list.getByRole('tab', { name: 'Toutes' }).click();
  await expect(list.locator('.grid .card .chip.danger')).toHaveText(['Attention · 3', 'Attention · 3']);
});

test('Mosaïque : la grille des photos, « En fleur maintenant », une image touchée ouvre la plante (Retour la ferme)', async ({ app, page }) => {
  await app.open('#/app/mosaique');
  await expect(page.getByRole('heading', { name: 'La mosaïque du coin' })).toBeVisible();
  await toCards(page, 'mosaique');
  const list = page.locator('ma-around-list');
  await expect(list.locator('.grid.mosaic .card')).toHaveCount(12);
  await expect(list.getByRole('tab', { name: 'Toutes' })).toHaveAttribute('aria-selected', 'true');
  await list.getByRole('checkbox', { name: /En fleur maintenant/ }).check();
  const blooming = await list.locator('.grid.mosaic .card').count();
  expect(blooming).toBeLessThan(12);
  await list.getByRole('checkbox', { name: /En fleur maintenant/ }).uncheck();
  await list.locator('.grid.mosaic .card').first().click();
  await expect.poll(() => hash(page)).toMatch(/^#\/app\/mosaique\/cards\?p=\d+$/);
  await expect(page.locator('ma-plant-sheet .pager')).toContainText('1 / 12');
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/app/mosaique/cards');
  await expect(page.locator('ma-plant-sheet')).toHaveCount(0);
});

test('chacune sa partie : « Rejouer » la Cueillette ne touche ni Rencontres ni la Mosaïque ; vide après rechargement', async ({ app, page }) => {
  await app.open('#/discover');
  for (const id of ['rencontres', 'mosaique', 'cueillette']) {
    await app.go(`#/app/${id}`);
    await toCardsAny(page, id);
  }
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await kept(page, 'cueillette'))?.matches).toEqual([plantId('Allium ursinum')]);
  const others = { rencontres: await kept(page, 'rencontres'), mosaique: await kept(page, 'mosaique') };
  expect(others.rencontres.point).toEqual([2.35, 48.85]);
  await replay(page);
  await expect.poll(() => hash(page)).toBe('#/app/cueillette/start');
  await expect(page.getByRole('heading', { name: 'Cueillette prudente' })).toBeVisible();
  // No « Reprendre » here any more; the others as they were.
  await expect(page.getByRole('group', { name: 'Reprendre' })).toHaveCount(0);
  expect(await kept(page, 'rencontres')).toEqual(others.rencontres);
  expect(await kept(page, 'mosaique')).toEqual(others.mosaique);
  await page.reload();
  await app.ready();
  await expect.poll(() => hash(page)).toBe('#/app/cueillette/start');
  await expect(page.getByRole('button', { name: 'Autour de moi' })).toBeVisible();
  expect(await kept(page, 'cueillette')).toBe(null);
  // Rencontres still offers to take up its place.
  await app.go('#/app/rencontres');
  await expect(page.getByRole('group', { name: 'Reprendre' })).toContainText('Au dernier lieu choisi');
});

/** To the cards of any of the three (Rencontres too: a returning visitor, no guided way). @param {import('@playwright/test').Page} page @param {string} id */
async function toCardsAny(page, id) {
  await expect.poll(() => hash(page)).toBe(`#/app/${id}/start`);
  await toCards(page, id);
  await expect(page.locator('ma-around-list .head')).toBeVisible();
}

test('les anciennes adresses : Cueillette prudente et Mosaïque ouvrent leur mini-application', async ({ app, page }) => {
  await app.open('#/discover?s=harvest');
  await expect.poll(() => hash(page)).toBe('#/app/cueillette/start');
  await expect(page.getByRole('heading', { name: 'Cueillette prudente' })).toBeVisible();
  await app.go('#/discover?s=mosaic');
  await expect.poll(() => hash(page)).toBe('#/app/mosaique/start');
  await expect(page.getByRole('heading', { name: 'La mosaïque du coin' })).toBeVisible();
  // A plant open there, with no place kept: the plant over the start screen.
  const ail = plantId('Allium ursinum');
  await app.go(`#/discover?s=mosaic&p=${ail}`);
  await expect.poll(() => hash(page)).toBe(`#/app/mosaique/start?p=${ail}`);
  await expect(page.locator('ma-plant-sheet .sheet-head')).toContainText('Ail des ours');
});

test.describe('la partie partagée d’avant', () => {
  test('donnée à Rencontres (rien ne dit laquelle a été jouée), une fois ; ses favoris restent à soi', async ({ app, page, context }) => {
    const ail = plantId('Allium ursinum');
    await context.addInitScript(id => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('geoflora.discover', JSON.stringify({ done: true, point: [2.35, 48.85], place: 'Paris', radius: 2000, matches: [id], passed: [] }));
    }, ail);
    await app.open('#/discover');
    expect(await kept(page, 'rencontres')).toEqual({ point: [2.35, 48.85], place: 'Paris', radius: 2000, matches: [ail], passed: [] });
    expect(await kept(page, 'cueillette')).toBe(null);
    expect(await kept(page, 'mosaique')).toBe(null);
    const discover = await page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.discover') || 'null'));
    expect(discover.point).toBeUndefined();
    expect(discover.done).toBe(true);
    const launcher = page.locator('gf-launcher[page]');
    await expect(launcher.getByRole('button', { name: 'Jouer : Mosaïque' })).toBeVisible();
    await expect(launcher.getByRole('button', { name: 'Continuer : Cueillette prudente' })).toHaveCount(0);
    // A favourite of before (its match then): the user's, never tagged — Recommencer Rencontres keeps it.
    await page.evaluate(async id => {
      const db = await import('/app/core/db.js');
      await (await import('/app/core/collections.js')).toggleFavorite(await db.get('plants', id));
      await db.remove('meta', 'origins');
    }, ail);
    await page.reload();
    await app.ready();
    const origin = () => page.evaluate(async id => {
      const fav = (await (await import('/app/core/collections.js')).listCollections()).find((/** @type {any} */ c) => c.id === 'favorites');
      const e = fav?.properties.plants.find((/** @type {any} */ x) => x.plantId === id);
      return e ? e.origin ?? 'none' : 'gone';
    }, ail);
    await expect.poll(() => page.evaluate(async () => Boolean(await (await import('/app/core/db.js')).get('meta', 'origins')))).toBe(true);
    expect(await origin()).toBe('none');
    await launcher.getByRole('button', { name: 'Recommencer : Rencontres' }).click();
    await expect(launcher.locator('dialog.ask')).toContainText('Seront supprimés : la partie en cours.');
    await launcher.locator('dialog.ask').getByRole('button', { name: 'Recommencer' }).click();
    await expect.poll(() => hash(page)).toBe('#/app/rencontres/start');
    expect(await origin()).toBe('none');
  });

  test('donnée à la dernière jouée quand l’adresse le dit (Cueillette prudente)', async ({ app, page, context }) => {
    await context.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('geoflora.discover', JSON.stringify({ done: true, point: [2.35, 48.85], place: 'Paris', radius: 2000, matches: [], passed: [3] }));
    });
    await app.open('#/discover?s=harvest');
    await expect.poll(() => hash(page)).toBe('#/app/cueillette/start');
    expect((await kept(page, 'cueillette'))?.passed).toEqual([3]);
    expect(await kept(page, 'rencontres')).toBe(null);
    await expect(page.getByRole('group', { name: 'Reprendre' })).toContainText('Autour de Paris');
  });
});
