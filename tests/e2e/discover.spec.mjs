// Découvrir on a first launch: the list of the activities, then « Rencontres » (the activity): around me, a map of
// the observations, cards of the plants seen around (the most observed first), a heart keeps one (favourites), and the
// steps lead to the whole app. iNaturalist, Wikidata and Wikipédia answered here. Migrated from discover2.cjs,
// discoverscope.cjs, meetstart.cjs, meetmatch.cjs.
import { test, expect, plantId, answerAround } from './fixtures.mjs';

// No hint animation of the top card: the keys alone move the cards.
test.use({ firstVisit: true, reducedMotion: 'reduce' });

test.beforeEach(({ context }) => answerAround(context));

test('autour de moi : la carte des observations, puis les cartes, la plus observée d’abord', async ({ app, page }) => {
  await app.open('#/');
  await page.locator('gf-launcher li[data-app="rencontres"]').getByRole('button', { name: 'Commencer : Rencontres', exact: true }).click();
  await page.getByRole('button', { name: 'Autour de moi' }).click();
  const discover = page.locator('ma-guided');
  await expect(discover.locator('.g-steps li.on .l')).toHaveText('Carte');
  const map = discover.locator('.g-mapbox gf-map');
  await expect(map.locator('path.gf-area')).toHaveCount(1);
  await expect(map.locator('.gf-obs-leaf')).toHaveCount(30);

  await discover.locator('.g-steps [data-step="go"]').click();
  await expect(discover.locator('.g-steps li.on .l')).toHaveText('Rencontres');
  const top = discover.locator('.swipe-card.top');
  await expect(top.locator('h2')).toContainText('Allium ursinum');
  await expect(top).toHaveAttribute('data-id', String(plantId('Allium ursinum')));
  await expect(top.locator('.ethno')).toContainText('ursus');
});

test('un cœur (→) garde la plante dans les favoris, un passage (←) montre la suivante', async ({ app, page }) => {
  await app.open('#/app/rencontres');
  await page.getByRole('button', { name: 'Autour de moi' }).click();
  const discover = page.locator('ma-guided');
  await discover.locator('.g-steps [data-step="go"]').click();
  const top = discover.locator('.swipe-card.top');
  await expect(top).toHaveAttribute('data-id', String(plantId('Allium ursinum')));
  await page.keyboard.press('ArrowLeft');
  await expect(top).toHaveAttribute('data-id', String(plantId('Taraxacum officinale')));
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(async id => (await import('/app/core/collections.js')).isFavorite(id), plantId('Taraxacum officinale'))).toBe(true);
  expect(await page.evaluate(async id => (await import('/app/core/collections.js')).isFavorite(id), plantId('Allium ursinum'))).toBe(false);
  // The first match: on to the photos step, no full-screen modal.
  await expect(discover.locator('.g-steps li.on .l')).toHaveText('Photos');
  await expect(discover.locator('.match')).toHaveCount(0);
});

test('« Passer » montre toute l’application ; « Revoir les premiers pas » la cache de nouveau', async ({ app, page }) => {
  await app.open('#/');
  await page.getByRole('link', { name: 'Passer : montrer toute l’application' }).click();
  await expect.poll(() => app.tabs()).toEqual(expect.arrayContaining(['Flore', 'Carte', 'Mes plantes']));
  expect(await page.evaluate(async () => (await import('/app/core/discover.js')).discoverState().done)).toBe(true);
  await app.go('#/settings');
  // What it empties too, and what it keeps, said under it; asked first.
  await expect(page.getByText('« Revoir les premiers pas » repart du début (Découvrir, une astuce à la fois, les onglets qui arrivent un à un) : '
    + 'les étapes et ce que gardent Rencontres, Cueillette prudente et Mosaïque (lieu, distance, cartes, matchs) sont oubliés. '
    + 'Vos favoris restent, et ceux venus de ces activités deviennent les vôtres.')).toBeVisible();
  await page.getByRole('button', { name: 'Revoir les premiers pas' }).click();
  await page.getByRole('alertdialog', { name: 'Revoir les premiers pas ?' }).getByRole('button', { name: 'Revoir les premiers pas' }).click();
  // Découvrir again: the list of the activities, not Rencontres.
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/discover');
  await expect(page.getByRole('heading', { level: 1, name: 'Découvrir' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rencontrez les plantes d’ici' })).toHaveCount(0);
  const state = await page.evaluate(async () => (await import('/app/core/discover.js')).discoverState());
  expect({ done: state.done, step: state.step }).toEqual({ done: false, step: 0 });
  // Rencontres' game (its place, its matches) forgotten too.
  expect(await page.evaluate(() => localStorage.getItem('geoflora.app.rencontres.state'))).toBe(null);
  await expect.poll(() => app.tabs()).not.toContain('Flore');
});

test('« Revoir les premiers pas » : demandé d’abord ; les favoris venus des activités deviennent les vôtres', async ({ app, page }) => {
  const ail = plantId('Allium ursinum');
  /** The wild garlic's favourite: [origin, from] (none: null), or null when it is none. */
  const favourite = () => page.evaluate(async id => {
    const fav = (await (await import('/app/core/collections.js')).listCollections()).find((/** @type {any} */ c) => c.id === 'favorites');
    const e = fav?.properties.plants.find((/** @type {any} */ x) => x.plantId === id);
    return e ? [e.origin?.app ?? null, e.from?.app ?? null] : null;
  }, ail);
  await app.open('#/app/rencontres');
  await page.getByRole('button', { name: 'Autour de moi' }).click();
  const discover = page.locator('ma-guided');
  await discover.locator('.g-steps [data-step="go"]').click();
  await expect(discover.locator('.swipe-card.top')).toHaveAttribute('data-id', String(ail));
  await page.keyboard.press('ArrowRight');
  await expect.poll(favourite).toEqual(['rencontres', null]);
  await app.go('#/settings');
  await page.getByRole('button', { name: 'Tout montrer maintenant' }).click();
  const again = page.getByRole('button', { name: 'Revoir les premiers pas' });
  const dialog = page.getByRole('alertdialog', { name: 'Revoir les premiers pas ?' });
  // « Annuler » (the focus on it): nothing changes.
  await again.click();
  await expect(dialog).toContainText('Les étapes et ce que gardent Rencontres, Cueillette prudente et Mosaïque (lieu, distance, cartes, matchs) sont oubliés. Vos favoris restent, et ceux venus de ces activités deviennent les vôtres.');
  await expect(dialog.getByRole('button', { name: 'Annuler' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(dialog).toHaveCount(0);
  // Échap too.
  await again.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => location.hash)).toBe('#/settings');
  expect(await favourite()).toEqual(['rencontres', null]);
  expect(await page.evaluate(() => localStorage.getItem('geoflora.app.rencontres.state'))).not.toBe(null);
  // Confirmed: the game forgotten, the favourite the user's — said once on Découvrir.
  await again.click();
  await dialog.getByRole('button', { name: 'Revoir les premiers pas' }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/discover');
  await expect(page.locator('.gf-brief-toast')).toHaveText('Votre favori venu des activités est désormais à vous.');
  expect(await favourite()).toEqual([null, 'rencontres']);
  expect(await page.evaluate(() => localStorage.getItem('geoflora.app.rencontres.state'))).toBe(null);
  // No « Recommencer » of the game takes it back.
  expect(await page.evaluate(async () => (await import('/app/core/collections.js')).forgetMadeBy('rencontres'))).toBe(0);
  expect(await favourite()).toEqual([null, 'rencontres']);
});

test('« Revoir les premiers pas » quand les favoris ne s’écrivent pas : rien n’est oublié, et c’est dit sous le bouton', async ({ app, page }) => {
  const ail = plantId('Allium ursinum');
  await app.open('#/');
  await page.evaluate(async id => {
    const c = await import('/app/core/collections.js');
    await c.addFavorite(await (await import('/app/core/db.js')).get('plants', id), { app: 'rencontres' });
  }, ail);
  const favourite = () => page.evaluate(async id => {
    const e = (await (await import('/app/core/collections.js')).getPlace('favorites'))?.properties.plants.find((/** @type {any} */ x) => x.plantId === id);
    return e ? [e.origin?.app ?? null, e.from?.app ?? null] : null;
  }, ail);
  await app.go('#/settings');
  await page.getByRole('button', { name: 'Tout montrer maintenant' }).click();
  // The browser's store gives way: a write into the collections throws.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    /** @type {any} */ (window).__put = put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'spots') throw new DOMException('The operation failed for reasons unrelated to the database itself.', 'UnknownError');
      return put.apply(this, args);
    };
  });
  const again = page.getByRole('button', { name: 'Revoir les premiers pas' });
  await again.click();
  await page.getByRole('alertdialog', { name: 'Revoir les premiers pas ?' }).getByRole('button', { name: 'Revoir les premiers pas' }).click();
  await expect(page.locator('gf-settings').getByRole('alert')).toHaveText('Impossible de lire vos favoris : rien n’a été changé. Réessayez dans un moment.');
  expect(await page.evaluate(() => location.hash)).toBe('#/settings');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.discover') || '{}').done)).toBe(true);
  // Mended, tried again: done, the line gone.
  await page.evaluate(() => { IDBObjectStore.prototype.put = /** @type {any} */ (window).__put; });
  expect(await favourite()).toEqual(['rencontres', null]);
  await again.click();
  await page.getByRole('alertdialog', { name: 'Revoir les premiers pas ?' }).getByRole('button', { name: 'Revoir les premiers pas' }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/discover');
  expect(await favourite()).toEqual([null, 'rencontres']);
});
