// A free layout as boxes (app/layout/builder-grid.js, the cross of « Modifier la disposition »): read from and written
// to a layout, cut towards a side,
// a place taken out, a share moved — any cell kept as the address writes it, an empty place (`slot`) new.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxOf, specOf, split, remove, resize, canSplit, placesOf, MIN_SHARE } from '../../app/layout/builder-grid.js';
import { GRIDS } from '../../app/layout/gf-builder-grids.js';

test('les trois grilles : lues, chaque part dite, réécrites telles quelles', () => {
  for (const g of GRIDS) {
    const box = /** @type {any} */ (boxOf(g.spec));
    assert.ok(box, g.id);
    assert.equal(specOf(/** @type {any} */ (boxOf(specOf(box)))), specOf(box));
  }
  assert.equal(specOf(/** @type {any} */ (boxOf('[slot,slot,slot@40]'))), '[slot@30,slot@30,slot@40]');
  // Shared evenly: no share said; in whole per cents.
  assert.equal(specOf(/** @type {any} */ (boxOf('[slot@33.3,slot@33.3,slot]'))), '[slot,slot,slot]');
  assert.equal(specOf(/** @type {any} */ (boxOf('[slot@20.44,[slot,slot]]'))), '[slot@20,[slot,slot]@80]');
  // Not a layout whole: an error, nothing.
  for (const bad of ['[slot,(', '', '[]']) assert.equal(boxOf(bad), null, bad);
  // A component unknown: kept as typed; an empty place's parameter it does not take: left out, as the registry says.
  assert.equal(specOf(/** @type {any} */ (boxOf('[mpa(x=1),Emplacement]'))), '[mpa(x=1),slot]');
  assert.equal(specOf(/** @type {any} */ (boxOf('[slot(r=2),slot]'))), '[slot,slot]');
});

test('couper : à côté dans sa liste quand elle va dans ce sens, sinon la place devient une liste de deux', () => {
  const three = /** @type {any} */ (boxOf('[slot@30,slot@30,slot@40]'));
  // Left of the second (a row): a sibling before it, half its share each.
  let r = split(three, [1], 'left');
  assert.deepEqual(r.added, [1]);
  assert.equal(specOf(r.root), '[slot@30,slot@15,slot@15,slot@40]');
  // Below the first (across the row): a column of two, the new place last.
  r = split(three, [0], 'bottom');
  assert.deepEqual(r.added, [0, 1]);
  assert.equal(specOf(r.root), '[[slot,slot]@30,slot@30,slot@40]');
  // Then left of the new one (across its column): a row of two inside.
  r = split(r.root, [0, 1], 'left');
  assert.deepEqual(r.added, [0, 1, 0]);
  assert.equal(specOf(r.root), '[[slot,[slot,slot]]@30,slot@30,slot@40]');
  // The given grid unchanged.
  assert.equal(specOf(three), '[slot@30,slot@30,slot@40]');
});

test('couper : jamais plus profond que la grammaire, ni plus de 12 places', () => {
  let g = /** @type {any} */ (boxOf('[slot]'));
  g = split(g, [0], 'top').root;            // [[slot,slot]]        depth 1
  g = split(g, [0, 0], 'left').root;        // depth 2
  g = split(g, [0, 0, 0], 'top').root;      // depth 3
  assert.equal(canSplit(g, [0, 0, 0, 0], 'left'), false, 'a list at depth 4');
  assert.equal(canSplit(g, [0, 0, 0, 0], 'top'), true, 'beside it in its own list');
  let row = /** @type {any} */ (boxOf('[slot]'));
  for (let i = 0; i < 20; i++) row = split(row, [0], 'right').root;
  assert.equal(placesOf(row), 12);
  assert.deepEqual(split(row, [0], 'right').added, null);
});

test('retirer : sa part au voisin ; une liste d’une seule place lui cède la sienne ; la dernière place reste', () => {
  const g = /** @type {any} */ (boxOf('[[slot,[slot,slot]]@30,slot@30,slot@40]'));
  assert.equal(specOf(remove(g, [1])), '[[slot,[slot,slot]]@60,slot@40]');
  // The inner row loses one: the place left takes the row's share in its column.
  assert.equal(specOf(remove(g, [0, 1, 0])), '[[slot,slot]@30,slot@30,slot@40]');
  // The column loses its first place: a row left alone, its places join the top row, scaled to the column's share.
  assert.equal(specOf(remove(g, [0, 0])), '[slot@15,slot@15,slot@30,slot@40]');
  const one = /** @type {any} */ (boxOf('[slot]'));
  assert.equal(remove(one, [0]), one);
});

test('régler : la part passe d’une boîte à la suivante, le total gardé, jamais sous le minimum', () => {
  const g = /** @type {any} */ (boxOf('[slot@30,slot@30,slot@40]'));
  assert.equal(specOf(resize(g, [], 1, 10)), '[slot@40,slot@20,slot@40]');
  assert.equal(specOf(resize(g, [], 1, 100)), `[slot@${60 - MIN_SHARE},slot@${MIN_SHARE},slot@40]`);
  assert.equal(resize(g, [], 0, 10), g);
});

test('une place remplie : lue et réécrite sous sa forme canonique, gardée quand on coupe, retire ou règle', () => {
  const g = /** @type {any} */ (boxOf('[slot@30,carte(floraison;rayon=2km)@35,[slot,fiche:wiki]]'));
  assert.ok(g);
  assert.equal(specOf(g), '[slot@30,map(floraison,r=2km)@35,[slot,plant.wikipedia]@35]');
  assert.equal(g.kids[1].cell, 'map(floraison,r=2km)');
  assert.equal(placesOf(g), 4);
  assert.equal(specOf(/** @type {any} */ (boxOf(specOf(g)))), specOf(g));
  // Cut across its list: the place filled first or last as asked, the new one empty.
  assert.equal(specOf(split(g, [1], 'bottom').root), '[slot@30,[map(floraison,r=2km),slot]@35,[slot,plant.wikipedia]@35]');
  assert.equal(specOf(split(g, [1], 'top').root), '[slot@30,[slot,map(floraison,r=2km)]@35,[slot,plant.wikipedia]@35]');
  // Beside it in its list: kept, halved.
  assert.equal(specOf(split(g, [1], 'right').root), '[slot@30,map(floraison,r=2km)@18,slot@18,[slot,plant.wikipedia]@35]');
  // A list left with one filled place: the place, its cell kept.
  assert.equal(specOf(remove(g, [2, 0])), '[slot@30,map(floraison,r=2km)@35,plant.wikipedia@35]');
  assert.equal(specOf(resize(g, [], 1, 5)), '[slot@35,map(floraison,r=2km)@30,[slot,plant.wikipedia]@35]');
});
