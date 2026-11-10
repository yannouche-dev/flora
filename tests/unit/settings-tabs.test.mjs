// Réglages suivis d'un onglet à l'autre (core/prefs.js definePref, core/sync.js): the settings kept as plain text since
// their first days — the display mode, the grid's, compact, the Carnet de récolte and the activities' steps
// (core/store.js), Ma région (core/territory.js), the Trefle token (core/sources.js) — read and written as before (their
// keys, their values: nothing lost), and, changed in another tab, followed in this one: the store (or the setting's
// events) says it, once, and nothing is written back.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// A window, so core/sync.js listens to `storage` (another tab's writes) as in a browser: set before it loads.
/** @type {any} */ (globalThis).window ??= globalThis;
const { config } = await import('../../app/config.js');
const prefs = await import('../../app/core/prefs.js');
const S = await import('../../app/core/store.js');
const K = config.storageKeys;

/**
 * Another tab writes a key (null: removes it; `key` null: clears the whole storage) — the `storage` event it fires
 * here; returns how many times this tab wrote meanwhile (never: no tab answers another) and the store's `change`s.
 * @param {string | null} key @param {string | null} value
 */
function fromAnotherTab(key, value) {
  if (key === null) localStorage.clear();
  else if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
  const { setItem, removeItem } = localStorage;
  let written = 0, changed = 0;
  localStorage.setItem = localStorage.removeItem = () => { written++; };
  const on = () => { changed++; };
  S.store.addEventListener('change', on);
  try {
    dispatchEvent(Object.assign(new Event('storage'), { key, storageArea: localStorage, newValue: value }));
  } finally {
    Object.assign(localStorage, { setItem, removeItem });
    S.store.removeEventListener('change', on);
  }
  return { written, changed };
}

test('definePref en texte : la valeur gardée telle quelle (sans JSON), relue quand un autre onglet l’écrit, `change` à chaque fois', () => {
  const key = 'geoflora.essaiTexte';
  localStorage.setItem(key, 'texte d’avant');
  const pref = prefs.definePref({ key, text: true, clean: v => v || null });
  /** @type {unknown[]} */ const heard = [];
  pref.events.addEventListener('change', e => heard.push(/** @type {CustomEvent} */ (e).detail));
  assert.equal(pref.get(), 'texte d’avant', 'lue telle quelle (en JSON, illisible : perdue)');
  pref.set('autre');
  assert.equal(localStorage.getItem(key), 'autre', 'écrite telle quelle, sans guillemets');
  pref.set(null);
  assert.equal(localStorage.getItem(key), null, 'null : la clé retirée');
  fromAnotherTab(key, 'ailleurs');
  assert.equal(pref.get(), 'ailleurs');
  fromAnotherTab(key, null);
  assert.equal(pref.get(), null);
  assert.deepEqual(heard, ['autre', null, 'ailleurs', null]);
  // `fallback` given to `clean` when there is none (a text pref's default).
  const other = prefs.definePref({ key: 'geoflora.essaiTexte2', text: true, fallback: 'défaut', clean: v => String(v) });
  assert.equal(other.get(), 'défaut');
});

test('mode, grille, compact : par défaut, écrits comme avant (texte), une grille égale au mode n’en est pas une', () => {
  assert.deepEqual([S.store.state.mode, S.store.state.gridView, S.store.state.compact], ['standard', null, false]);
  S.setCompact(true);
  assert.deepEqual([S.store.state.compact, localStorage.getItem(K.compact)], [true, '1']);
  S.setCompact(false);
  assert.deepEqual([S.store.state.compact, localStorage.getItem(K.compact)], [false, '0']);
  S.setGridView('scientific');
  assert.deepEqual([S.store.state.gridView, localStorage.getItem(K.gridView)], ['scientific', 'scientific']);
  S.setMode('epure');
  assert.deepEqual([S.store.state.mode, S.store.state.gridView, localStorage.getItem(K.mode), localStorage.getItem(K.gridView)], ['epure', null, 'epure', null],
    'le mode de l’application vaut partout : la grille le suit de nouveau');
  S.setGridView('epure');
  assert.deepEqual([S.store.state.gridView, localStorage.getItem(K.gridView)], [null, null]);
  S.setMode('standard');
});

test('mode, grille, compact changés dans un autre onglet : le store suit, une fois, sans rien réécrire', () => {
  assert.deepEqual(fromAnotherTab(K.compact, '1'), { written: 0, changed: 1 });
  assert.equal(S.store.state.compact, true);
  assert.deepEqual(fromAnotherTab(K.mode, 'scientific'), { written: 0, changed: 1 });
  assert.equal(S.store.state.mode, 'scientific');
  fromAnotherTab(K.gridView, 'epure');
  assert.equal(S.gridViewOf(S.store.state), 'epure');
  fromAnotherTab(K.gridView, 'scientific');
  assert.equal(S.store.state.gridView, null, 'la grille sur le mode : pas d’exception');
  // What this tab cannot read: the default (a mode it does not have — made elsewhere and deleted since —, a « oui »).
  fromAnotherTab(K.mode, 'm-inconnu');
  fromAnotherTab(K.compact, 'oui');
  assert.deepEqual([S.store.state.mode, S.store.state.compact], ['standard', false]);
  assert.equal(localStorage.getItem(K.mode), 'm-inconnu', 'gardé tel que l’autre onglet l’a écrit');
  // The whole storage cleared elsewhere: every setting read again.
  fromAnotherTab(K.compact, '1');
  fromAnotherTab(K.gridView, 'epure');
  assert.equal(fromAnotherTab(null, null).written, 0);
  assert.deepEqual([S.store.state.mode, S.store.state.gridView, S.store.state.compact], ['standard', null, false]);
});

test('Carnet de récolte et étapes des activités changés dans un autre onglet : suivis ; la clé retirée, « auto » tel que cet onglet le montre', () => {
  assert.equal(S.harvestModeChosen(), false);
  assert.deepEqual(fromAnotherTab(K.harvestMode, '1'), { written: 0, changed: 1 });
  assert.deepEqual([S.store.state.harvestMode, S.harvestModeChosen()], [true, true]);
  fromAnotherTab(K.harvestMode, '0');
  assert.equal(S.store.state.harvestMode, false);
  S.followHarvests(true);
  assert.equal(S.store.state.harvestMode, false, 'choisi ailleurs : les récoltes n’y changent rien');
  assert.deepEqual(fromAnotherTab(K.harvestMode, null), { written: 0, changed: 0 });
  assert.equal(S.harvestModeChosen(), false, '« auto » de nouveau');
  S.followHarvests(true);
  assert.equal(S.store.state.harvestMode, true);
  S.store.set({ harvestMode: false });
  // The steps: on, off, else « auto » (nothing kept).
  assert.equal(S.store.state.showSteps, 'auto');
  assert.deepEqual(fromAnotherTab(K.showSteps, 'off'), { written: 0, changed: 1 });
  assert.equal(S.store.state.showSteps, 'off');
  fromAnotherTab(K.showSteps, 'jamais');
  assert.equal(S.store.state.showSteps, 'auto');
  S.setShowSteps('on');
  assert.deepEqual([S.store.state.showSteps, localStorage.getItem(K.showSteps)], ['on', 'on']);
  S.setShowSteps('auto');
  assert.deepEqual([S.store.state.showSteps, localStorage.getItem(K.showSteps)], ['auto', null]);
});

test('Ma région et le jeton Trefle : gardés en texte comme avant ; changés dans un autre onglet, suivis, `change` à chaque fois', async () => {
  const { myRegion, regionEvents, setMyRegion } = await import('../../app/core/territory.js');
  const { getTrefleToken, setTrefleToken, trefleEvents } = await import('../../app/core/sources.js');
  /** @type {unknown[]} */ const heard = [];
  regionEvents.addEventListener('change', e => heard.push(['région', /** @type {CustomEvent} */ (e).detail]));
  trefleEvents.addEventListener('change', e => heard.push(['jeton', /** @type {CustomEvent} */ (e).detail]));
  assert.deepEqual([myRegion(), getTrefleToken()], [null, null]);
  setMyRegion('FR-BRE');
  assert.equal(localStorage.getItem(K.region), 'FR-BRE', 'son code tel quel');
  setMyRegion('');
  assert.equal(localStorage.getItem(K.region), null);
  assert.deepEqual(fromAnotherTab(K.region, 'FR-OCC'), { written: 0, changed: 0 });
  assert.equal(myRegion(), 'FR-OCC');
  // A placeholder, never a real token.
  setTrefleToken('jeton-factice');
  assert.equal(localStorage.getItem(K.trefleToken), 'jeton-factice', 'tel que saisi');
  setTrefleToken(null);
  assert.equal(localStorage.getItem(K.trefleToken), null);
  assert.equal(fromAnotherTab(K.trefleToken, 'autre-jeton-factice').written, 0);
  assert.equal(getTrefleToken(), 'autre-jeton-factice');
  fromAnotherTab(K.trefleToken, '');
  assert.equal(getTrefleToken(), null, 'vide : aucun');
  assert.deepEqual(heard, [['région', 'FR-BRE'], ['région', null], ['région', 'FR-OCC'], ['jeton', 'jeton-factice'], ['jeton', null],
    ['jeton', 'autre-jeton-factice'], ['jeton', null]]);
});
