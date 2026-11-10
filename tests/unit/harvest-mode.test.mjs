// app/core/store.js: the harvest mode — « auto » while the user never chose it (it comes on with the harvests on the
// device, app/main.js, never off during a visit, and writes nothing), the user's own choice kept once made (Réglages,
// the end of the guided discovery), for the visit even when storage refuses it: the app never decides it again. The
// key the app wrote by itself before is no choice: forgotten at start (config.obsoleteKeys).
import { test } from 'node:test';
import assert from 'node:assert/strict';

// A window before the app loads (core/sync.js listens there for another tab's writes): a launch read again below.
/** @type {any} */ (globalThis).window ??= globalThis;
const { config } = await import('../../app/config.js');
const { forgetObsolete } = await import('../../app/core/prefs.js');
const { followHarvests, harvestModeChosen, setHarvestMode, store } = await import('../../app/core/store.js');

const KEY = config.storageKeys.harvestMode;
/** Where the app wrote it before, at the first launch or as Cueillette prudente began. */
const LEGACY = 'geoflora.harvestMode';

test('carnet de récolte « auto » : activé par les récoltes qui arrivent, sans rien écrire, jamais désactivé en cours de visite', () => {
  localStorage.removeItem(KEY);
  assert.equal(harvestModeChosen(), false);
  followHarvests(false);
  assert.equal(store.state.harvestMode, false);
  followHarvests(true);
  assert.equal(store.state.harvestMode, true, 'des récoltes arrivent (un import, un lien) : allumé');
  assert.equal(localStorage.getItem(KEY), null, 'rien d’écrit : toujours « auto »');
  // The last harvest deleted (to note it again): the journal stays.
  followHarvests(false);
  assert.equal(store.state.harvestMode, true);
  assert.equal(harvestModeChosen(), false);
  store.set({ harvestMode: false });
});

test('carnet de récolte d’une version d’avant : la valeur écrite par l’application n’est pas un choix, « auto » de nouveau', () => {
  localStorage.removeItem(KEY);
  localStorage.setItem(LEGACY, '1');
  // Every setting read again, as at a launch (the storage cleared elsewhere: key null).
  dispatchEvent(Object.assign(new Event('storage'), { key: null, storageArea: localStorage }));
  assert.equal(harvestModeChosen(), false, 'le « 1 » posé par Cueillette prudente ou au premier lancement');
  assert.ok(config.obsoleteKeys.includes(LEGACY));
  forgetObsolete(config.obsoleteKeys);
  assert.equal(localStorage.getItem(LEGACY), null);
});

test('carnet de récolte choisi, même quand le stockage refuse de l’écrire : les récoltes n’y changent rien', () => {
  localStorage.removeItem(KEY);
  const setItem = localStorage.setItem;
  localStorage.setItem = () => { throw new DOMException('plein', 'QuotaExceededError'); };
  try {
    setHarvestMode(false);
  } finally {
    localStorage.setItem = setItem;
  }
  assert.equal(localStorage.getItem(KEY), null, 'pas écrit');
  assert.equal(harvestModeChosen(), true, 'choisi pour cette visite');
  followHarvests(true);
  assert.equal(store.state.harvestMode, false, 'éteint par l’utilisateur : reste éteint');
});

test('carnet de récolte choisi : gardé, les récoltes n’y changent plus rien', () => {
  localStorage.removeItem(KEY);
  setHarvestMode(false);
  assert.equal(harvestModeChosen(), true);
  followHarvests(true);
  assert.deepEqual([store.state.harvestMode, localStorage.getItem(KEY)], [false, '0'], 'éteint par l’utilisateur : reste éteint');
  setHarvestMode(true);
  followHarvests(false);
  assert.deepEqual([store.state.harvestMode, localStorage.getItem(KEY)], [true, '1']);
  localStorage.removeItem(KEY);
});
