// app/core/history.js: where a sheet closes to (sheetMark, closeTo) — back to the entry it was opened from, past the
// plants gone through, or in place when nothing of this visit is under it — and a view replaced keeping the keys it says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeTo, depth, replaceView, sheetMark } from '../../app/core/history.js';

/** The current entry: at depth `d`, with `extra` in its state. @param {number} d @param {Record<string, unknown>} [extra] */
const at = (d, extra = {}) => history.replaceState({ ...extra, gfDepth: d }, '', '#/plant/1');
/** history.go spied on: the steps asked. */
const spyGo = () => {
  /** @type {number[]} */ const went = [];
  history.go = (/** @type {number} */ n) => { went.push(n); };
  return went;
};

test('sheetMark : décidée une fois, gardée dans l’entrée, relue ensuite', () => {
  at(3);
  assert.deepEqual(sheetMark('gfSheetFrom', () => 2), { from: 2, start: 3 });
  assert.deepEqual(history.state.gfSheetFrom, { from: 2, start: 3 });
  // Read back (a reload, Back, Forward): what `opened` says no longer counts.
  assert.deepEqual(sheetMark('gfSheetFrom', () => null), { from: 2, start: 3 });
  // Opened from elsewhere (a link, a tab, the start): nothing under it.
  at(3);
  assert.deepEqual(sheetMark('gfSheetFrom', () => null), { from: null, start: 3 });
  // A depth not behind this entry is none.
  at(3);
  assert.deepEqual(sheetMark('gfSheetFrom', () => 3), { from: null, start: 3 });
  // The mark of the sheet it goes on from (‹ ›): kept as it is.
  at(4);
  assert.deepEqual(sheetMark('gfSheetFrom', () => ({ from: 2, start: 3 })), { from: 2, start: 3 });
  assert.deepEqual(history.state.gfSheetFrom, { from: 2, start: 3 });
});

test('sheetMark : une marque en avant de l’entrée (une autre visite) est décidée à nouveau', () => {
  at(2, { gfSheetFrom: { from: 1, start: 3 } });
  assert.deepEqual(sheetMark('gfSheetFrom', () => 1), { from: 1, start: 2 });
  at(2, { gfSheetFrom: { from: 5, start: 2 } });
  // A `from` not behind its start: none.
  assert.deepEqual(sheetMark('gfSheetFrom', () => 0), { from: null, start: 2 });
  at(2, { gfSheetFrom: 'bogus' });
  assert.deepEqual(sheetMark('gfSheetFrom', () => null), { from: null, start: 2 });
});

test('closeTo : retour à l’entrée d’où la fiche a été ouverte, qui prend l’adresse de la liste', () => {
  const went = spyGo();
  at(3);
  closeTo({ from: 1, start: 2 }, '#/?family=Rosaceae');
  assert.deepEqual(went, [-2]);
  assert.ok(history.state.gfBehind.some((/** @type {[number, string]} */ [d, h]) => d === 1 && h === '#/?family=Rosaceae'));
});

test('closeTo : ouverte par un lien, retour à la première fiche montrée', () => {
  const went = spyGo();
  at(3);
  closeTo({ from: null, start: 1 }, '#/');
  assert.deepEqual(went, [-2]);
});

test('closeTo : ouverte par un lien sur cette entrée, la liste à sa place (les clés gardées), ou `instead`', () => {
  const went = spyGo();
  at(3, { gfSheetFrom: { from: null, start: 3 }, gfPaneFrom: { from: null, start: 3 } });
  closeTo({ from: null, start: 3 }, '#/?q=ortie', { keep: ['gfSheetFrom'] });
  assert.deepEqual(went, []);
  assert.equal(location.hash, '#/?q=ortie');
  assert.equal(depth(), 3);
  assert.deepEqual(history.state.gfSheetFrom, { from: null, start: 3 });
  assert.equal(history.state.gfPaneFrom, undefined);
  // An activity: its own way (its address keeps its state).
  at(3);
  let instead = 0;
  closeTo({ from: null, start: 3 }, '#/app/x', { instead: () => { instead++; } });
  assert.equal(instead, 1);
  assert.deepEqual(went, []);
  assert.equal(location.hash, '#/plant/1');
});

test('replaceView(hash, keep) : la même profondeur, et seules les clés dites', () => {
  at(2, { gfSheetFrom: { from: 1, start: 2 }, gfPaneFrom: { from: null, start: 2 }, gfAppFrom: 0 });
  replaceView('#/plant/2', ['gfSheetFrom']);
  assert.equal(location.hash, '#/plant/2');
  assert.equal(depth(), 2);
  assert.deepEqual(history.state.gfSheetFrom, { from: 1, start: 2 });
  assert.equal(history.state.gfPaneFrom, undefined);
  assert.equal(history.state.gfAppFrom, undefined);
  // None said: none kept.
  at(2, { gfSheetFrom: { from: 1, start: 2 } });
  replaceView('#/plant/3');
  assert.equal(history.state.gfSheetFrom, undefined);
  assert.equal(depth(), 2);
});
