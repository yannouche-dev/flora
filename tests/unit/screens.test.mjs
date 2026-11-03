// « Mes écrans » (app/layout/screens.js): the screens of one's own opened in use on this device, newest first, 10 at
// most, one per layout and title — what was stored read back clean (anything else dropped), the address in use (never
// edit=1), a screen modified replacing the record it was entered from, × taking one out, `change` fired on each.
// The module keeps its list in memory (core/prefs.js): this file is its own process, the tests run in order on one list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../../app/config.js';

const KEY = config.storageKeys.screens;
const { clean, forgetScreen, labelOf, rememberScreen, screenEvents, screenKey, screens, usageOf } = await import('../../app/layout/screens.js');

/** A screen as stored. @param {string} href @param {string | null} [title] @param {number} [at] */
const s = (href, title = null, at = 1) => ({ href, title, label: 'Carte · Résultats', at });
const stored = () => JSON.parse(localStorage.getItem(KEY) || 'null');

test('usageOf : l’adresse en usage, edit=1 retiré où qu’il soit', () => {
  assert.equal(usageOf('#/layout/[a]?p=1&edit=1'), '#/layout/[a]?p=1');
  assert.equal(usageOf('#/layout/[a]?edit=1'), '#/layout/[a]');
  assert.equal(usageOf('#/layout/[a]?edit=1&p=1'), '#/layout/[a]?p=1');
  assert.equal(usageOf('#/layout/[a]?p=1&edit=1&q=ortie'), '#/layout/[a]?p=1&q=ortie');
  assert.equal(usageOf('#/layout/[a]?p=1'), '#/layout/[a]?p=1');
  // Another key that only ends so is not it.
  assert.equal(usageOf('#/layout/[a]?reedit=1'), '#/layout/[a]?reedit=1');
});

test('screenKey : la disposition (le chemin) et le titre, pas l’état', () => {
  assert.equal(screenKey(s('#/layout/[map,results]?p=1&at=45.1,3.2', 'Mon coin')), '#/layout/[map,results]\nMon coin');
  assert.equal(screenKey(s('#/layout/[map,results]?p=2', 'Mon coin')), screenKey(s('#/layout/[map,results]', 'Mon coin')));
  assert.notEqual(screenKey(s('#/layout/[map,results]')), screenKey(s('#/layout/[map,results]', 'Mon coin')));
});

test('labelOf : le nom de ses cases ; trop long, coupé après une case entière, « … » ; jamais au-delà de 80', () => {
  assert.equal(labelOf(['Carte', 'Résultats']), 'Carte · Résultats');
  assert.equal(labelOf([]), '');
  // The « Étude d’une plante » model: six cells, the last ones left out — never half a word.
  const etude = labelOf(['Recherche', 'Résultats', 'Classification', 'Occurrences et répartition', 'Carte', 'Photos']);
  assert.equal(etude, 'Recherche · Résultats · Classification · Occurrences et répartition · Carte …');
  assert.ok(etude.length <= 80);
  // « Tableau de bord »: seven slots.
  const slots = labelOf(Array(7).fill('Emplacement'));
  assert.equal(slots, Array(5).fill('Emplacement').join(' · ') + ' …');
  assert.equal(clean([s('#/layout/[slot]', null)].map(x => ({ ...x, label: slots })))[0].label, slots);
  // Exactly 80: whole, no « … ».
  const eighty = labelOf(['a'.repeat(40), 'b'.repeat(37)]);
  assert.equal(eighty.length, 80);
  assert.ok(!eighty.endsWith('…'));
  // One name longer than all: itself cut, « … » after.
  const one = labelOf(['x'.repeat(100), 'Carte']);
  assert.equal(one.length, 80);
  assert.ok(one.endsWith('x…'));
});

test('clean : ce qui n’est pas un écran est retiré ; un par disposition et titre, le plus récent ; 10 au plus', () => {
  for (const bad of [null, undefined, 'x', 3, {}, { href: '#/layout/[map]' }]) assert.deepEqual(clean(bad), []);
  const good = s('#/layout/[map]?p=1&edit=1', 'Ma carte', 5);
  assert.deepEqual(clean([
    null, 'texte', s('#/layout', null), s('#/layout/', null), s('#/layout/?p=1', null), s('#/plant/12', null), { ...s('#/layout/[a]'), href: 7 },
    s('#/layout/[a]', ''), s('#/layout/[a]', 'x'.repeat(81)), { ...s('#/layout/[a]'), title: 3 },
    { ...s('#/layout/[a]'), label: undefined }, { ...s('#/layout/[a]'), label: 'x'.repeat(81) },
    { ...s('#/layout/[a]'), at: Number.NaN }, { ...s('#/layout/[a]'), at: '5' },
    good
  ]), [{ href: '#/layout/[map]?p=1', title: 'Ma carte', label: 'Carte · Résultats', at: 5 }]);
  // No title: null; a title of 80 characters is the address' own limit.
  assert.equal(clean([{ href: '#/layout/[a]', label: '', at: 1 }])[0].title, null);
  assert.equal(clean([s('#/layout/[a]', 'x'.repeat(80))]).length, 1);
  // One per layout and title: the first (the newest) kept, its state whatever it is.
  assert.deepEqual(clean([s('#/layout/[a]?p=2', 'T', 9), s('#/layout/[a]?p=1', 'T', 8), s('#/layout/[a]', null, 7), s('#/layout/[b]', 'T', 6)])
    .map(x => [x.href, x.title]), [['#/layout/[a]?p=2', 'T'], ['#/layout/[a]', null], ['#/layout/[b]', 'T']]);
  // An address being modified is the same screen as in use.
  assert.equal(clean([s('#/layout/[a]?edit=1'), s('#/layout/[a]')]).length, 1);
  assert.equal(clean(Array.from({ length: 14 }, (_, i) => s(`#/layout/[slot@${10 + i},slot]`))).length, 10);
});

test('rememberScreen : en tête de liste, gardé sur l’appareil ; rouvert, son ancienne place quittée ; `change` à chaque fois', () => {
  /** @type {unknown[]} */
  const said = [];
  const listen = (/** @type {Event} */ e) => said.push(/** @type {CustomEvent} */ (e).detail);
  screenEvents.addEventListener('change', listen);
  assert.deepEqual(screens(), []);
  rememberScreen({ href: '#/layout/[map,results]?at=45.1,3.2', title: null, label: 'Carte · Résultats' });
  rememberScreen({ href: '#/layout/[search,results]?q=ortie&title=Orties&edit=1', title: 'Orties', label: 'Recherche · Résultats' });
  assert.deepEqual(screens().map(x => x.href), ['#/layout/[search,results]?q=ortie&title=Orties', '#/layout/[map,results]?at=45.1,3.2']);
  assert.ok(screens().every(x => Number.isFinite(x.at) && x.at > 0));
  assert.deepEqual(stored(), screens());
  // Opened again (another state): first, with its latest address, once.
  rememberScreen({ href: '#/layout/[map,results]?at=44,2', title: null, label: 'Carte · Résultats' });
  assert.deepEqual(screens().map(x => x.href), ['#/layout/[map,results]?at=44,2', '#/layout/[search,results]?q=ortie&title=Orties']);
  assert.equal(said.length, 3);
  assert.deepEqual(said.at(-1), screens());
  screenEvents.removeEventListener('change', listen);
});

test('rememberScreen(…, clé) : l’écran modifié remplace celui d’où « Modifier » est parti ; les autres restent', () => {
  const before = screenKey(screens()[1]);
  assert.equal(before, '#/layout/[search,results]\nOrties');
  rememberScreen({ href: '#/layout/[search,results,plant]?q=ortie&title=Orties', title: 'Orties', label: 'Recherche · Résultats · Fiche' }, before);
  assert.deepEqual(screens().map(x => x.href), ['#/layout/[search,results,plant]?q=ortie&title=Orties', '#/layout/[map,results]?at=44,2']);
  // A key no record has: nothing else taken out.
  rememberScreen({ href: '#/layout/[deck]', title: 'Rencontres', label: 'Rencontres' }, '#/layout/[nope]\n');
  assert.equal(screens().length, 3);
  // Ten at most: the oldest go.
  for (let i = 0; i < 9; i++) rememberScreen({ href: `#/layout/[slot@${20 + i},slot]`, title: null, label: 'Emplacement · Emplacement' });
  assert.equal(screens().length, 10);
  assert.equal(screens()[0].href, '#/layout/[slot@28,slot]');
  assert.equal(screens().at(-1)?.href, '#/layout/[deck]');
});

test('forgetScreen : × en retire un ; le dernier retiré, la clé avec ; une liste stockée illisible est vide', () => {
  let changes = 0;
  const count = () => { changes++; };
  screenEvents.addEventListener('change', count);
  forgetScreen('#/layout/[deck]');
  assert.equal(screens().some(x => x.href === '#/layout/[deck]'), false);
  assert.equal(screens().length, 9);
  for (const x of screens()) forgetScreen(x.href);
  assert.deepEqual(screens(), []);
  assert.equal(localStorage.getItem(KEY), null);
  assert.equal(changes, 10);
  screenEvents.removeEventListener('change', count);
  // Stored by hand (another version, a broken write): read back clean when the next change starts from it.
  localStorage.setItem(KEY, '{nope');
  rememberScreen({ href: '#/layout/[map]', title: null, label: 'Carte' });
  assert.deepEqual(stored().map((/** @type {{ href: string }} */ x) => x.href), ['#/layout/[map]']);
  localStorage.setItem(KEY, JSON.stringify([s('#/layout/[a]'), 'x', s('#/home')]));
  forgetScreen('#/layout/[map]');
  assert.deepEqual(stored().map((/** @type {{ href: string }} */ x) => x.href), ['#/layout/[a]']);
});
