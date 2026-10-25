// IndexedDB that does not open (Chrome's « Internal error opening backing store for indexedDB.open. »), against an
// IndexedDB in memory (fake-indexeddb) whose indexedDB.open is made to fail: app/core/db.js tries a passing failure
// again (250 ms, then 1 s; the delays run at once, node:test's mocked timers), never a VersionError or a lack of room,
// says each cause in French (StorageError, the browser's error kept as its cause) and keeps the failure until the reload
// when the app could not start — not once a connection has opened: the next call tries again; deleteDb erases the base
// and nothing else, freezes it until the reload, waits for a tab that does not close; collections.js holds the backup
// copy while a repair waits to put it back — or as soon as the browser emptied the base —, then puts it back whole.
import 'fake-indexeddb/auto';
import { mock, test } from 'node:test';
import assert from 'node:assert/strict';

// db.js upgrades the schema only from a page (a worker opens whatever version exists).
/** @type {any} */ (globalThis).window ??= globalThis;

const { config } = await import('../../app/config.js');
const db = await import('../../app/core/db.js');
const C = await import('../../app/core/collections.js');
const notes = await import('../../app/core/sheet-notes.js');

const BACKING_STORE = 'Internal error opening backing store for indexedDB.open.';
const unknown = () => new DOMException(BACKING_STORE, 'UnknownError');
const realOpen = indexedDB.open.bind(indexedDB);
const realDelete = indexedDB.deleteDatabase.bind(indexedDB);

let opens = 0;
/**
 * indexedDB.open fails with these errors in turn (thrown at once when given as `{ thrown }`), then opens as it does.
 * @param {...(Error | { thrown: Error })} errors
 */
function failing(...errors) {
  opens = 0;
  /** @type {any} */ (indexedDB).open = (/** @type {any[]} */ ...args) => {
    opens++;
    const error = errors.shift();
    if (!error) return realOpen(...args);
    if ('thrown' in error) throw error.thrown;
    // What db.js reads of a request: its handlers, its error.
    const request = /** @type {any} */ ({ error, result: undefined, transaction: null });
    setImmediate(() => request.onerror?.(new Event('error')));
    return request;
  };
}

/** A few turns of the event loop: a failed request, its handlers, the next attempt asked. */
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };

/** Runs the delays between attempts at once until `promise` settles. @template T @param {Promise<T>} promise */
async function settle(promise) {
  let done = false;
  promise.then(() => { done = true; }, () => { done = true; });
  while (!done) {
    await flush();
    mock.timers.runAll();
  }
  return promise;
}

mock.timers.enable({ apis: ['setTimeout'] });

test('openProblem : chaque erreur de l’ouverture a sa cause, et son message en français', () => {
  const cases = /** @type {const} */ ([
    [unknown(), 'busy'],
    [new DOMException('Version change transaction was aborted in upgradeneeded event handler.', 'AbortError'), 'busy'],
    [new DOMException('Connection to Indexed Database server lost. Refresh the page to try again', 'UnknownError'), 'busy'],
    [new DOMException('Something new', 'NotReadableError'), 'busy'],
    [new DOMException('The requested version (6) is less than the existing version (7).', 'VersionError'), 'newer'],
    [new DOMException('Quota exceeded', 'QuotaExceededError'), 'full'],
    [new DOMException('The user denied permission to access the database.', 'UnknownError'), 'blocked'],
    [new DOMException('The operation is insecure.', 'SecurityError'), 'blocked'],
    [new DOMException('A mutation operation was attempted on a database that did not allow mutations.', 'InvalidStateError'), 'blocked'],
    [new ReferenceError('indexedDB is not defined'), 'blocked']
  ]);
  for (const [error, kind] of cases) assert.equal(db.openProblem(error), kind, `${error.name} : ${error.message}`);

  const e = new db.StorageError(unknown());
  assert.equal(e.kind, 'busy');
  assert.equal(e.name, 'UnknownError', 'le nom du navigateur, gardé');
  assert.match(e.message, /^Le stockage de GeoFlora ne s’ouvre pas sur cet appareil/);
  assert.equal(/** @type {any} */ (e.cause).message, BACKING_STORE, 'ses mots, gardés pour l’assistance');
  assert.match(new db.StorageError(new DOMException('', 'VersionError')).message, /version plus récente.*rechargez la page/);
  assert.match(new db.StorageError(new DOMException('', 'QuotaExceededError')).message, /Plus assez d’espace/);
  assert.equal(new db.StorageError(new DOMException('', 'QuotaExceededError')).name, 'QuotaExceededError', 'le manque de place reconnu (quota.js)');
  assert.match(new db.StorageError(new DOMException('', 'SecurityError')).message, /navigation privée/);
  // Found behind what wraps it (core/dataset.js), not in another error.
  assert.equal(db.storageError(new Error('Impossible de télécharger la flore', { cause: e })), e);
  assert.equal(db.storageError(new DOMException('Quota exceeded', 'QuotaExceededError')), null);
});

test('openDb : un échec passager (UnknownError) est retenté après 250 ms puis 1 s, et la base s’ouvre', async () => {
  failing(unknown(), unknown());
  const opened = db.openDb();
  await flush();
  assert.equal(opens, 1);
  mock.timers.tick(249);
  await flush();
  assert.equal(opens, 1, 'pas avant 250 ms');
  mock.timers.tick(1);
  await flush();
  assert.equal(opens, 2);
  mock.timers.tick(999);
  await flush();
  assert.equal(opens, 2, 'pas avant 1 s de plus');
  mock.timers.tick(1);
  const conn = await opened;
  assert.equal(opens, 3);
  assert.equal(conn.version, config.db.version);
  // Opened: the next calls share it.
  assert.equal(await db.openDb(), conn);
  assert.equal(opens, 3);
});

test('openDb : toujours UnknownError au démarrage — trois essais, partagés par les appels simultanés, puis l’échec gardé jusqu’au rechargement', async () => {
  // As at a launch (deleteDb: the reload comes next): no connection opened yet.
  await db.deleteDb();
  failing(unknown(), unknown(), unknown(), unknown());
  const [a, b] = [db.reopenDb(), db.openDb()];
  await assert.rejects(settle(a), error => error instanceof db.StorageError && error.kind === 'busy' && error.name === 'UnknownError');
  await assert.rejects(b, error => error instanceof db.StorageError);
  assert.equal(opens, 3, 'un seul cycle d’essais pour les deux appels');
  // Given up on: every later call rejects at once, without trying again (a reload, or the repair, does).
  await assert.rejects(db.openDb(), error => error instanceof db.StorageError);
  await assert.rejects(db.get('meta', 'dataset'), /ne s’ouvre pas/);
  assert.equal(opens, 3);
});

test('openDb : en cours de session, une réouverture qui échoue n’est pas gardée — l’écriture suivante rouvre, et passe', async () => {
  failing();
  await settle(db.reopenDb());
  await db.put('meta', 'avant', 'session');
  // The browser closes the connection on its own (page frozen in the background…): only its `close` event says so.
  const conn = await db.openDb();
  conn.close();
  conn.onclose?.(new Event('close'));
  // Its store busy a moment: the three tries fail, this write with them.
  failing(unknown(), unknown(), unknown());
  await assert.rejects(settle(db.put('meta', 'pendant', 'session')), error => error instanceof db.StorageError && error.kind === 'busy');
  assert.equal(opens, 3);
  // Back a moment later: the next write opens again (not refused at once), and is saved.
  await db.put('meta', 'après', 'session');
  assert.equal(opens, 4);
  assert.equal(await db.get('meta', 'session'), 'après');
});

test('openDb : ni une version plus récente, ni le manque de place, ni un stockage bloqué ne sont retentés', async () => {
  // A newer GeoFlora upgraded the base (version 7): this page's version 6 is refused, for real.
  failing();
  const newer = await new Promise((resolve, reject) => {
    const request = realOpen(config.db.name, config.db.version + 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  /** @type {IDBDatabase} */ (newer).close();
  await assert.rejects(settle(db.reopenDb()), error => error instanceof db.StorageError && error.kind === 'newer' && error.name === 'VersionError');
  assert.equal(opens, 1);
  await new Promise(resolve => { realDelete(config.db.name).onsuccess = resolve; });

  failing(new DOMException('Quota exceeded', 'QuotaExceededError'));
  await assert.rejects(settle(db.reopenDb()), error => error instanceof db.StorageError && error.kind === 'full');
  assert.equal(opens, 1);

  // Thrown at once (site data blocked): failed the same way — and not for ever: the next try opens.
  failing({ thrown: new DOMException('The operation is insecure.', 'SecurityError') });
  await assert.rejects(settle(db.reopenDb()), error => error instanceof db.StorageError && error.kind === 'blocked');
  assert.equal(opens, 1);
  const conn = await settle(db.reopenDb());
  assert.equal(conn.version, config.db.version);
});

test('deleteDb : efface la base et rien d’autre ; rien ne s’ouvre avant le rechargement', async () => {
  await db.put('meta', 'avant', 'k');
  localStorage.setItem(config.storageKeys.backup, '{"savedAt":"2026-10-01T10:00:00.000Z","features":[]}');
  await db.deleteDb();
  // Until the reload: nothing written into the new, empty base.
  await assert.rejects(db.put('meta', 'pendant', 'k'), /réparation/);
  assert.equal(localStorage.getItem(config.storageKeys.backup), '{"savedAt":"2026-10-01T10:00:00.000Z","features":[]}');
  // The reload: a new base, empty, at the app's version.
  const conn = await db.reopenDb();
  assert.equal(conn.version, config.db.version);
  assert.equal(await db.get('meta', 'k'), undefined);
  localStorage.removeItem(config.storageKeys.backup);
});

test('deleteDb : une connexion qui ne se ferme pas retient l’effacement, qui passe dès qu’elle se ferme ; les onglets GeoFlora le savent', async () => {
  await db.openDb();
  /** @type {CustomEvent[]} */
  const told = [];
  addEventListener('geoflora-outdated', event => told.push(/** @type {CustomEvent} */ (event)));
  // Another tab, an old build: its connection never closes by itself.
  const stale = /** @type {IDBDatabase} */ (await new Promise(resolve => { realOpen(config.db.name).onsuccess = (/** @type {any} */ e) => resolve(e.target.result); }));
  let blocked = 0;
  await db.deleteDb(() => { blocked++; stale.close(); });
  assert.equal(blocked, 1);
  // This tab's own connection was closed first: not told it is outdated.
  assert.equal(told.length, 0);
  // Another tab of GeoFlora (its connection open) is told the base was erased, not updated.
  await db.reopenDb();
  await new Promise(resolve => { realDelete(config.db.name).onsuccess = resolve; });
  assert.equal(told.length, 1);
  assert.equal(told[0].detail.deleted, true);
});

test('deleteDb : le navigateur ne peut pas l’effacer non plus — rejeté, avec ses mots', async () => {
  /** @type {any} */ (indexedDB).deleteDatabase = () => {
    const request = /** @type {any} */ ({ error: new DOMException('Internal error opening backing store for indexedDB.deleteDatabase.', 'UnknownError') });
    setImmediate(() => request.onerror?.(new Event('error')));
    return request;
  };
  try {
    await assert.rejects(db.deleteDb(), { name: 'UnknownError', message: /indexedDB\.deleteDatabase/ });
  } finally {
    /** @type {any} */ (indexedDB).deleteDatabase = realDelete;
  }
  // Nothing erased, nothing held: the base opens as before.
  assert.equal((await db.openDb()).version, config.db.version);
});

const plant = (/** @type {number} */ id) => ({ id, scientificName: 'Planta ' + id, vernacularNames: ['Plante ' + id], genus: 'Planta', species: String(id), family: 'Plantaceae' });

test('réparation : la copie de secours, gardée telle quelle jusqu’à sa restauration, revient entière — un ♥ ajouté entre-temps aussi', async () => {
  failing();
  const flora = [plant(1), plant(2), plant(3), plant(4)];
  await db.replacePlants(flora, { plants: flora.length });
  await C.toggleFavorite(plant(1));
  await C.savePlace(C.withPlant(C.newCollection('list', { name: 'Comestibles' }), plant(2)));
  await C.savePlace(C.withPlant(C.newPlace([2.35, 48.85], { name: 'Bois' }), plant(3)));
  await notes.loadNotes();
  await notes.setNoteText('terrain', 2, 'En soupe');
  assert.equal(await C.writeBackup(), 'saved');
  const backup = localStorage.getItem(config.storageKeys.backup);
  assert.deepEqual({ ...C.backupSummary(), savedAt: '' }, { savedAt: '', favorites: 1, lists: 1, places: 1, notes: 1 });

  // « Réparer le stockage »: noted, then the base erased; the next launch stores the flora again.
  assert.equal(C.markRestore(), true);
  await db.deleteDb();
  await db.reopenDb();
  await notes.loadNotes();
  await db.replacePlants(flora, { plants: flora.length });
  // Meanwhile: a ♥ in the new base, a deletion — the backup copy stays as it was.
  await C.toggleFavorite(plant(4));
  assert.equal(await C.writeBackup(), 'kept');
  const extra = await C.saveCollection(C.newCollection('list', { name: 'Brouillon' }));
  await C.deletePlace(extra.id);
  assert.equal(localStorage.getItem(config.storageKeys.backup), backup);

  // What came back is said as the repair's dialog said what would: the same counts, the same words.
  const restored = await C.restoreAfterRepair();
  assert.deepEqual({ ...restored, savedAt: '' }, { savedAt: '', favorites: 1, lists: 1, places: 1, notes: 1 });
  assert.equal(C.backupContents(/** @type {any} */ (restored)), 'vos favoris (1 plante), 1 liste, 1 lieu et 1 note de fiche');
  const all = await C.listCollections();
  assert.deepEqual(all.map(c => c.properties.name).sort(), ['Bois', 'Comestibles', 'Favoris']);
  assert.deepEqual((await C.getPlace(C.FAVORITES_ID))?.properties.plantIds.sort(), [1, 4], 'le ♥ d’entre-temps gardé');
  assert.equal(notes.noteText('terrain', 2), 'En soupe');
  // Done: no longer held, and the copy follows the base again.
  assert.equal(C.restorePending(), false);
  assert.equal(C.backupSummary()?.favorites, 2);
});

test('base vidée par le navigateur sous la page : dit aussitôt, la copie de secours tenue — un ♥ ne la remplace pas —, puis remise', async () => {
  failing();
  const flora = [plant(1), plant(2), plant(3), plant(4)];
  await db.replacePlants(flora, { plants: flora.length });
  const list = C.withPlant(C.newCollection('list', { name: 'Sauvages' }), plant(2));
  await C.savePlace(list);
  assert.equal(await C.writeBackup(), 'saved');
  // As main.js: the base made again under the page holds the copy at once.
  let emptied = 0;
  const onEmptied = () => { emptied++; C.holdIfEmptied(); };
  addEventListener('geoflora-emptied', onEmptied);
  try {
    // The browser erases the base under the page (a damaged store; here from outside: the page's connection closes)…
    await new Promise(resolve => { realDelete(config.db.name).onsuccess = resolve; });
    assert.equal(C.restorePending(), false);
    // … and the next write makes it again, empty: said before the ♥ is written, the copy held.
    await C.toggleFavorite(plant(3));
    assert.equal(emptied, 1);
    assert.equal(C.restorePending(), true);
    assert.equal(C.restoreReason(), 'lost');
    assert.equal(await C.writeBackup(), 'kept');
    assert.ok(C.readBackup()?.features.some(f => f.id === list.id), 'la liste toujours dans la copie de secours');
    // The next launch puts it back (main.js restoreAfter), the ♥ of meanwhile kept.
    await C.restoreAfterRepair();
    assert.equal((await C.getPlace(list.id))?.properties.name, 'Sauvages');
    assert.ok((await C.getPlace(C.FAVORITES_ID))?.properties.plantIds.includes(3));
    assert.equal(C.restorePending(), false);
  } finally {
    removeEventListener('geoflora-emptied', onEmptied);
  }
});

test('base vidée au lancement (faite à cette ouverture, une copie de secours présente) : tenue avant toute écriture ; sans copie, rien', async () => {
  assert.equal(await C.writeBackup(), 'saved');
  // The page loads on a base the browser emptied (the reload after deleteDb stands for it): made at its first open.
  await db.deleteDb();
  await db.reopenDb();
  assert.equal(db.baseMade(), true);
  assert.equal(C.holdIfEmptied(), true);
  assert.equal(C.restoreReason(), 'lost');
  await C.toggleFavorite(plant(1));
  assert.equal(await C.writeBackup(), 'kept');
  assert.ok((C.backupSummary()?.lists ?? 0) > 0, 'les collections toujours dans la copie de secours');
  C.cancelRestore();
  // A first launch: no copy, nothing held.
  const backup = localStorage.getItem(config.storageKeys.backup);
  localStorage.removeItem(config.storageKeys.backup);
  assert.equal(C.holdIfEmptied(), false);
  localStorage.setItem(config.storageKeys.backup, /** @type {string} */ (backup));
});

test('copie de secours : ce qu’elle tient, dit avec les mots du dialogue de réparation', () => {
  assert.equal(C.backupContents({ savedAt: '', favorites: 1, lists: 0, places: 0, notes: 0 }), 'vos favoris (1 plante)');
  assert.equal(C.backupContents({ savedAt: '', favorites: 0, lists: 2, places: 0, notes: 3 }), '2 listes et 3 notes de fiche');
  assert.equal(C.backupContents({ savedAt: '', favorites: 4, lists: 1, places: 2, notes: 0 }), 'vos favoris (4 plantes), 1 liste et 2 lieux');
});

test('favoris, listes et lieux comptés (Réglages, export, transfert) : les favoris à part — ni liste ni lieu —, vidés pas du tout', () => {
  const favorites = (/** @type {number} */ n) => ({ id: C.FAVORITES_ID, geometry: null, properties: { plants: Array(n).fill({}) } });
  const list = { id: 'l', geometry: null, properties: { plants: [] } };
  const place = (/** @type {string} */ id) => ({ id, geometry: { type: 'Point', coordinates: [3.1, 45.8] }, properties: { plants: [{}] } });
  assert.equal(C.keptContents([favorites(2)]), 'vos favoris (2 plantes)', 'seulement des favoris : pas « 1 liste ou lieu »');
  assert.equal(C.keptContents([favorites(0)]), '', 'des favoris vidés : rien');
  assert.equal(C.keptContents([favorites(0), list]), '1 liste');
  assert.equal(C.keptContents([list, place('a'), favorites(1), place('b')]), 'vos favoris (1 plante), 1 liste et 2 lieux');
  assert.equal(C.keptContents([]), '');
});

test('copie de secours : aucune, ou vide — rien à annoncer', () => {
  localStorage.removeItem(config.storageKeys.backup);
  assert.equal(C.backupSummary(), null);
  localStorage.setItem(config.storageKeys.backup, JSON.stringify({ savedAt: '2026-10-01T10:00:00.000Z', features: [] }));
  assert.equal(C.backupSummary(), null);
  localStorage.removeItem(config.storageKeys.backup);
});
