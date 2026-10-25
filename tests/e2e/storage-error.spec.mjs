// IndexedDB that does not open, as Chrome's does when its store is damaged, held by another process or out of room
// (« Internal error opening backing store for indexedDB.open. »): indexedDB.open made to fail in the page (an init
// script; the worker is never reached, the page opens first). A failure that passes is tried again and the app starts;
// one that stays says so in French, keeps the browser's words for support, and « Réparer le stockage » asks first
// (naming the backup copy), erases the database — never localStorage — and the collections and notes come back from
// the backup copy after the reload, said in the dialog's words (app/core/db.js, app/components/gf-storage-error.js,
// app/main.js restoreAfter). The repair's last try failing for another cause (a newer version) erases nothing; a
// restore that fails says so in French, keeps the copy, and the next launch puts it back.
import { test, expect, plantId } from './fixtures.mjs';

const BACKING_STORE = 'Internal error opening backing store for indexedDB.open.';

/**
 * indexedDB.open fails `times` times (counted across reloads, in sessionStorage) with the error named `name`, then
 * with `then`'s if given, until the database is erased; every open counted (`idb.opens`), every deletion too
 * (`idb.deleted`). While sessionStorage `idb.putFails` is set, a write into the collections (`spots`) throws.
 * @param {import('@playwright/test').BrowserContext} context
 * @param {{ times: number, name?: string, message?: string, then?: { name: string, message: string } | null }} o
 */
async function breakStorage(context, { times, name = 'UnknownError', message = BACKING_STORE, then = null }) {
  await context.addInitScript(([times, name, message, then]) => {
    const count = (/** @type {string} */ key) => sessionStorage.setItem(key, String(Number(sessionStorage.getItem(key) || 0) + 1));
    if (sessionStorage.getItem('idb.left') === null) sessionStorage.setItem('idb.left', String(times));
    const open = IDBFactory.prototype.open, remove = IDBFactory.prototype.deleteDatabase, put = IDBObjectStore.prototype.put;
    /** What the app reads of a request: its handlers, its error. @param {string} name @param {string} message */
    const failed = (name, message) => {
      const request = /** @type {any} */ ({ error: new DOMException(message, name), result: undefined, transaction: null });
      setTimeout(() => request.onerror?.(new Event('error')));
      return request;
    };
    IDBFactory.prototype.open = function (...args) {
      count('idb.opens');
      const left = Number(sessionStorage.getItem('idb.left'));
      if (left > 0) {
        sessionStorage.setItem('idb.left', String(left - 1));
        return failed(name, message);
      }
      return then && !sessionStorage.getItem('idb.deleted') ? failed(then.name, then.message) : open.apply(this, args);
    };
    IDBFactory.prototype.deleteDatabase = function (...args) {
      count('idb.deleted');
      sessionStorage.setItem('idb.left', '0');
      return remove.apply(this, args);
    };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'spots' && sessionStorage.getItem('idb.putFails')) {
        throw new DOMException('The operation failed for reasons unrelated to the database itself and not covered by any other error code.', 'UnknownError');
      }
      return put.apply(this, args);
    };
  }, /** @type {const} */ ([times, name, message, then]));
}

/**
 * Before the app starts, once: the backup copy of this device (a favourite, a collection, a place, a note), a setting.
 * @param {import('@playwright/test').BrowserContext} context
 */
async function seedBackup(context) {
  const ortie = plantId('Urtica dioica'), ail = plantId('Allium ursinum');
  const at = '2026-05-01T08:00:00.000Z';
  const backup = {
    savedAt: '2026-10-12T16:04:00.000Z',
    features: [
      { type: 'Feature', id: 'favorites', geometry: null, properties: { name: 'Favoris', createdAt: at, updatedAt: at, plants: [{ plantId: ail }] } },
      { type: 'Feature', id: 'printemps', geometry: null, properties: { name: 'Cueillette du printemps', createdAt: at, updatedAt: at, plants: [{ plantId: ortie }, { plantId: ail }] } },
      { type: 'Feature', id: 'vincennes', geometry: { type: 'Point', coordinates: [2.435, 48.835] }, properties: { name: 'Bois de Vincennes', createdAt: at, updatedAt: at, plants: [{ plantId: ortie }] } }
    ],
    sheetNotes: [{ id: 'terrain', title: 'Terrain', texts: { [ortie]: { text: 'En soupe au printemps', updatedAt: at } } }]
  };
  await context.addInitScript(json => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('geoflora.backup', json);
    localStorage.setItem('geoflora.compact', '1');
  }, JSON.stringify(backup));
  return { ortie, ail };
}

/** What the repair puts back, in the dialog's words and in the banner's after it. */
const CONTENTS = 'vos favoris (1 plante), 1 liste, 1 lieu et 1 note de fiche';

/** @param {import('@playwright/test').Page} page @param {string} key */
const counted = (page, key) => page.evaluate(k => Number(sessionStorage.getItem(k) || 0), key);

test('une fois seulement : un nouvel essai, et l’app démarre normalement', async ({ app, page, context }) => {
  await breakStorage(context, { times: 1 });
  await app.open('#/');
  expect(await counted(page, 'idb.opens')).toBe(2);
  await expect(page.locator('gf-app .banner.error')).toHaveCount(0);
  await expect(page.locator('gf-storage-error')).toHaveCount(0);
  await expect(page.locator('gf-plant-card').first()).toBeVisible();
});

test('toujours : le message en français, « Réparer le stockage » efface la base (pas le localStorage) et les collections reviennent de la copie de secours', async ({ app, page, context }) => {
  const { ortie, ail } = await seedBackup(context);
  await breakStorage(context, { times: 1e9 });
  await page.goto('#/');

  const banner = page.locator('gf-storage-error');
  await expect(banner).toContainText('Le stockage de GeoFlora ne s’ouvre pas sur cet appareil.');
  await expect(banner).toContainText('fermez les autres onglets et fenêtres de GeoFlora');
  // The browser's words, folded away (for support); tried three times, not more.
  await expect(banner.locator('details')).toContainText(`UnknownError — ${BACKING_STORE}`);
  await expect(banner.locator('details')).not.toHaveAttribute('open', '');
  expect(await counted(page, 'idb.opens')).toBe(3);
  await expect(banner.getByRole('button', { name: 'Réessayer' })).toBeVisible();
  // Announced once: what happened, not the advice, the buttons and the details (nor the line shown while it loaded).
  await expect(page.getByRole('alert')).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveText(/^Le stockage de GeoFlora ne s’ouvre pas sur cet appareil\. Le navigateur/);

  // Asked first: what comes back (the backup copy, its date, what it holds), what is downloaded again.
  await banner.getByRole('button', { name: 'Réparer le stockage…' }).click();
  const dialog = banner.locator('dialog.ask');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Reviennent de la copie de secours de cet appareil, du 12 octobre 2026 à 18:04');
  await expect(dialog).toContainText(CONTENTS);
  await expect(dialog).toContainText('Téléchargées de nouveau : la flore');
  // « Annuler »: nothing erased.
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(dialog).toBeHidden();
  expect(await counted(page, 'idb.deleted')).toBe(0);

  await banner.getByRole('button', { name: 'Réparer le stockage…' }).click();
  await dialog.getByRole('button', { name: 'Réparer le stockage', exact: true }).click();
  // Erased, reloaded on Mes plantes: the flora downloaded again, the collections back by themselves.
  await expect(page).toHaveURL(/#\/collections$/);
  await app.ready();
  expect(await counted(page, 'idb.deleted')).toBe(1);
  const mine = page.locator('gf-collections');
  await expect(mine).toContainText('Cueillette du printemps');
  await expect(mine).toContainText('Bois de Vincennes');
  // Said in the dialog's words: what it promised is what came back.
  await expect(page.locator('gf-app').getByRole('status').filter({ hasText: 'Stockage réparé' }))
    .toContainText(`Stockage réparé : la copie de secours de cet appareil a remis ${CONTENTS}.`);
  expect(await page.evaluate(async id => (await import('/app/core/sheet-notes.js')).noteText('terrain', id), ortie)).toBe('En soupe au printemps');
  expect(await page.evaluate(async () => (await (await import('/app/core/collections.js')).getPlace('favorites'))?.properties.plantIds)).toEqual([ail]);
  // localStorage untouched (a setting kept), the repair no longer waiting, the copy following the base again.
  const kept = await page.evaluate(() => ({ compact: localStorage.getItem('geoflora.compact'), pending: localStorage.getItem('geoflora.restorePending'),
    backup: JSON.parse(localStorage.getItem('geoflora.backup') || 'null') }));
  expect(kept.compact).toBe('1');
  expect(kept.pending).toBeNull();
  expect(kept.backup.features.map((/** @type {any} */ f) => f.id).sort()).toEqual(['favorites', 'printemps', 'vincennes']);
});

test('une version plus récente a ouvert la base : pas de nouvel essai, rien à réparer, recharger', async ({ page, context }) => {
  await breakStorage(context, { times: 1e9, name: 'VersionError', message: 'The requested version (6) is less than the existing version (7).' });
  await page.goto('#/');
  const banner = page.locator('gf-storage-error');
  await expect(banner).toContainText('Une version plus récente de GeoFlora a ouvert vos données.');
  await expect(banner.locator('details')).toContainText('VersionError');
  expect(await counted(page, 'idb.opens')).toBe(1);
  await expect(banner.getByRole('button', { name: 'Réessayer' })).toBeVisible();
  await expect(banner.getByRole('button', { name: /Réparer/ })).toHaveCount(0);
});

test('la réparation retente l’ouverture, qui échoue autrement (version plus récente) : rien n’est effacé, le dialogue le dit, puis le bandeau', async ({ page, context }) => {
  await seedBackup(context);
  await breakStorage(context, { times: 3, then: { name: 'VersionError', message: 'The requested version (6) is less than the existing version (7).' } });
  await page.goto('#/');
  const banner = page.locator('gf-storage-error');
  await expect(banner).toContainText('Le stockage de GeoFlora ne s’ouvre pas sur cet appareil.');
  await banner.getByRole('button', { name: 'Réparer le stockage…' }).click();
  const dialog = banner.locator('dialog.ask');
  await dialog.getByRole('button', { name: 'Réparer le stockage', exact: true }).click();
  // Its last try finds a newer version: stopped there, nothing erased, the focus on the dialog's way out.
  await expect(dialog.getByRole('alert')).toContainText('Réparation arrêtée, rien n’a été effacé. Une version plus récente de GeoFlora a ouvert vos données.');
  await expect(dialog.locator('details')).toContainText('VersionError');
  await expect(dialog.getByRole('button', { name: 'Fermer' })).toBeFocused();
  expect(await counted(page, 'idb.deleted')).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('geoflora.restorePending'))).toBeNull();
  // Closed: the banner now says that cause, with nothing to repair.
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(banner).toContainText('Une version plus récente de GeoFlora a ouvert vos données.');
  await expect(banner.getByRole('button', { name: /Réparer/ })).toHaveCount(0);
});

test('la restauration après la réparation échoue : dit en français, la copie de secours gardée, remise au lancement suivant', async ({ app, page, context }) => {
  await seedBackup(context);
  await breakStorage(context, { times: 1e9 });
  await page.goto('#/');
  const banner = page.locator('gf-storage-error');
  await banner.getByRole('button', { name: 'Réparer le stockage…' }).click();
  // After the reload, a write into the collections fails (the browser's store gives way again).
  await page.evaluate(() => sessionStorage.setItem('idb.putFails', '1'));
  await banner.locator('dialog.ask').getByRole('button', { name: 'Réparer le stockage', exact: true }).click();
  await expect(page).toHaveURL(/#\/collections$/);
  await app.ready();
  const failed = page.locator('gf-app .banner.error').filter({ hasText: 'copie de secours' });
  await expect(failed.getByRole('alert')).toHaveText(/^Vos plantes et vos notes n’ont pas pu être remises depuis la copie de secours de cet appareil\. Elles y restent,\s+gardées telles quelles : rechargez la page pour réessayer\.$/);
  // The browser's words folded away, never in the sentence.
  await expect(failed.locator('details')).toContainText('UnknownError — The operation failed');
  await expect(failed.locator('details')).not.toHaveAttribute('open', '');
  // Mes plantes says the same, not that they are on their way; dismissed, the banner leaves it there.
  const mine = page.locator('gf-collections');
  await expect(mine).toContainText('Vos plantes et vos notes n’ont pas pu être remises');
  await expect(mine).not.toContainText('reviennent de la copie de secours');
  await failed.getByRole('button', { name: 'Fermer' }).click();
  await expect(failed).toHaveCount(0);
  await expect(mine).toContainText('Vos plantes et vos notes n’ont pas pu être remises');
  expect(await page.evaluate(() => Boolean(localStorage.getItem('geoflora.restorePending')))).toBe(true);
  // The store mended: reloaded from Mes plantes, everything comes back.
  await page.evaluate(() => sessionStorage.removeItem('idb.putFails'));
  await mine.getByRole('button', { name: 'Recharger' }).click();
  await app.ready();
  await expect(mine).toContainText('Cueillette du printemps');
  await expect(page.locator('gf-app').getByRole('status').filter({ hasText: 'Stockage réparé' }))
    .toContainText(`Stockage réparé : la copie de secours de cet appareil a remis ${CONTENTS}.`);
  expect(await page.evaluate(() => localStorage.getItem('geoflora.restorePending'))).toBeNull();
});

test('la base vidée par le navigateur avant le lancement, une copie de secours là : tenue avant toute écriture, puis remise d’elle-même', async ({ app, page, context }) => {
  await seedBackup(context);
  await app.open('#/collections');
  const mine = page.locator('gf-collections');
  await expect(mine).toContainText('Cueillette du printemps');
  await expect(mine).toContainText('Bois de Vincennes');
  await expect(page.locator('gf-app').getByRole('status').filter({ hasText: 'vidé' }))
    .toContainText(`Le navigateur avait vidé le stockage de GeoFlora`);
  // The copy never replaced by the empty base made meanwhile.
  const backup = await page.evaluate(() => JSON.parse(localStorage.getItem('geoflora.backup') || 'null'));
  expect(backup.features.map((/** @type {any} */ f) => f.id).sort()).toEqual(['favorites', 'printemps', 'vincennes']);
});

test('la base vidée sous la page ouverte, puis un ♥ : la copie de secours tenue, dit, et remise après le rechargement', async ({ app, page, context, baseURL }) => {
  const ortie = plantId('Urtica dioica'), ail = plantId('Allium ursinum');
  await app.open('#/');
  await page.evaluate(async id => {
    const C = await import('/app/core/collections.js'), db = await import('/app/core/db.js');
    await C.savePlace(C.withPlant(C.newCollection('list', { name: 'Sauvages' }), await db.get('plants', id)));
    await C.writeBackup();
  }, ortie);
  // Emptied by the browser itself while the page has it open (as Chromium does with a damaged store).
  const cdp = await context.newCDPSession(page);
  await cdp.send('Storage.clearDataForOrigin', { origin: new URL(/** @type {string} */ (baseURL)).origin, storageTypes: 'indexeddb' });
  const after = await page.evaluate(async id => {
    const C = await import('/app/core/collections.js');
    await C.toggleFavorite({ id, scientificName: 'Allium ursinum', genus: 'Allium', species: 'ursinum', family: 'Amaryllidaceae' });
    await C.writeBackup().catch(() => {});
    const backup = JSON.parse(localStorage.getItem('geoflora.backup') || 'null');
    return { pending: localStorage.getItem('geoflora.restorePending'), kept: backup.features.some((/** @type {any} */ f) => f.properties.name === 'Sauvages') };
  }, ail);
  expect(after.kept).toBe(true);
  expect(after.pending).not.toBeNull();
  await expect(page.locator('gf-app .banner.error')).toContainText('vidé par le navigateur');
  await page.reload();
  await app.ready();
  await page.goto('#/collections');
  await expect(page.locator('gf-collections')).toContainText('Sauvages');
});
