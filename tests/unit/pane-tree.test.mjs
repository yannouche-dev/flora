// app/core/pane-tree.js: the layout of the plant pane as a tree of panes (pure functions). Includes the property of
// audit TEST-6 / GAP3-10: whatever the docking, the tree stays one the import accepts (validTree).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../app/core/pane-tree.js';
import { random } from './support/random.mjs';

/** The panes in their narrow-screen order: 'sheet', or a stack's tabs joined. @param {T.PaneNode} tree */
const panes = tree => T.leaves(tree).map(n => n.t === 'stack' ? n.tabs.join('+') : 'sheet');
const depth = (/** @type {any} */ n) => n.t === 'split' ? 1 + Math.max(...n.kids.map(depth)) : 0;

test('dock à droite de la fiche : une ligne [fiche, volet], parts 58/42', () => {
  const tree = T.dock(T.SHEET, 'map', 'sheet', 'right');
  assert.equal(tree.t, 'split');
  assert.equal(/** @type {T.SplitNode} */ (tree).dir, 'row');
  assert.deepEqual(panes(tree), ['sheet', 'map']);
  assert.deepEqual(/** @type {T.SplitNode} */ (tree).sizes, [0.58, 0.42]);
  assert.ok(T.sheetInRow(tree));
  assert.ok(T.validTree(tree));
});

test('dock en haut puis à gauche : colonne puis ligne, dans l’ordre des côtés', () => {
  let tree = T.dock(T.SHEET, 'map', 'sheet', 'top');
  assert.deepEqual(panes(tree), ['map', 'sheet']);
  assert.equal(T.sheetInRow(tree), false);
  tree = T.dock(tree, 'calendar', 'sheet', 'left');
  assert.deepEqual(panes(tree), ['map', 'calendar', 'sheet']);
  assert.ok(T.sheetInRow(tree));
});

test('dock au centre : un onglet actif du volet ; undock replie tout', () => {
  let tree = T.dock(T.SHEET, 'map', 'sheet', 'right');
  tree = T.dock(tree, 'climate', /** @type {T.StackNode} */ (T.stackOf(tree, 'map')).id, 'center');
  assert.equal(T.stackOf(tree, 'climate'), T.stackOf(tree, 'map'));
  assert.equal(T.stackOf(tree, 'map')?.active, 'climate');
  tree = T.dock(tree, 'uses', /** @type {T.StackNode} */ (T.stackOf(tree, 'map')).id, { tab: 0 });
  assert.deepEqual(T.stackOf(tree, 'map')?.tabs, ['uses', 'map', 'climate']);
  tree = T.undock(T.undock(T.undock(tree, 'map'), 'climate'), 'uses');
  assert.deepEqual(tree, T.SHEET, 'sans volet il ne reste que la fiche');
});

test('dock sur une cible inconnue ou au centre de la fiche : le bloc ne va nulle part ailleurs', () => {
  const tree = T.dock(T.SHEET, 'map', 'sheet', 'right');
  assert.deepEqual(panes(T.dock(tree, 'calendar', 'nope', 'left')), ['sheet', 'map']);
  assert.deepEqual(panes(T.dock(tree, 'calendar', 'sheet', 'center')), ['sheet', 'map']);
});

test('normalize : blocs inconnus et doublons retirés, splits de même sens fusionnés, une seule fiche', () => {
  const n = /** @type {T.SplitNode} */ (T.normalize(/** @type {any} */ ({ t: 'split', id: 'a', dir: 'row', sizes: [1, 2], kids: [
    { t: 'stack', id: 'x', tabs: ['bogus', 'map', 'map'] },
    { t: 'split', id: 'b', dir: 'row', sizes: [1, 1], kids: [T.SHEET, { t: 'stack', id: 'y', tabs: ['calendar'] }] },
    T.SHEET
  ] }), k => k !== 'bogus'));
  assert.equal(n.kids.length, 3);
  assert.deepEqual(/** @type {T.StackNode} */ (n.kids[0]).tabs, ['map']);
  assert.equal(T.nodes(n).filter(x => x.t === 'sheet').length, 1);
  assert.ok(Math.abs(n.sizes.reduce((a, b) => a + b, 0) - 1) < 0.01);
  assert.deepEqual(T.normalize(null), T.SHEET);
  assert.deepEqual(panes(T.normalize({ t: 'stack', id: 's', tabs: ['map'], active: 'map' })), ['map', 'sheet'], 'fiche perdue : remise à droite');
});

test('validTree refuse les arbres hostiles (fichier importé)', () => {
  assert.equal(T.validTree(null), false);
  assert.equal(T.validTree({ t: 'stack', id: 's', tabs: ['map'] }), false, 'pas de fiche');
  assert.equal(T.validTree({ t: 'split', id: 'a', dir: 'diag', kids: [T.SHEET, { t: 'stack', id: 's', tabs: ['map'] }], sizes: [1, 1] }), false);
  assert.equal(T.validTree({ t: 'split', id: 'a', dir: 'row', kids: [T.SHEET, T.SHEET], sizes: [1, 1] }), false, 'deux fiches');
  assert.equal(T.validTree({ t: 'split', id: 'a', dir: 'row', kids: [T.SHEET, { t: 'stack', id: 's', tabs: ['map'] }], sizes: [1, 0] }), false, 'part nulle');
  /** @type {any} */
  let deep = T.SHEET;
  for (let i = 0; i < 8; i++) deep = { t: 'split', id: 'd' + i, dir: i % 2 ? 'row' : 'col', kids: [deep, { t: 'stack', id: 's' + i, tabs: ['k' + i] }], sizes: [1, 1] };
  assert.equal(T.validTree(deep), false, 'profondeur > 6 refusée');
});

test('TEST-6 / GAP3-10 : des volets imbriqués en alternance s’arrêtent avant ce que l’import refuse', () => {
  const keys = ['map', 'calendar', 'climate', 'media', 'wikipedia', 'names', 'uses', 'lookalikes', 'statuses'];
  let tree = /** @type {T.PaneNode} */ (T.SHEET);
  let refused = 0;
  keys.forEach((key, i) => {
    const next = T.dock(tree, key, 'sheet', i % 2 ? 'bottom' : 'right');
    if (next === tree) refused++;
    tree = next;
    assert.ok(T.validTree(tree), `après ${i + 1} volets : ${JSON.stringify(tree)}`);
  });
  assert.ok(refused > 0, 'le 7e volet imbriqué est refusé');
  assert.equal(depth(tree), 6);
  assert.equal(T.stacked(tree).size, keys.length - refused, 'un volet refusé laisse le bloc dans la fiche');
});

test('propriété : 400 suites aléatoires de dock/undock gardent un arbre valide, sans bloc perdu ni dupliqué', () => {
  const rnd = random(42);
  const KEYS = ['map', 'calendar', 'climate', 'media', 'wikipedia', 'names', 'uses', 'lookalikes', 'statuses', 'gbif'];
  const ZONES = /** @type {T.Zone[]} */ (['left', 'right', 'top', 'bottom', 'center', { tab: 0 }, { tab: 9 }]);
  for (let run = 0; run < 400; run++) {
    let tree = /** @type {T.PaneNode} */ (T.SHEET);
    const docked = new Set();
    for (let step = 0; step < 40; step++) {
      const key = KEYS[rnd(KEYS.length)];
      if (rnd(8) === 0) { tree = T.undock(tree, key); docked.delete(key); continue; }
      const targets = T.leaves(tree);
      // Often the sheet itself (« Nouveau volet … de la fiche »): what nests deepest.
      const target = rnd(6) === 0 ? 'root' : rnd(3) === 0 ? 'sheet' : targets[rnd(targets.length)].id;
      const zone = ZONES[rnd(ZONES.length)];
      const before = tree;
      tree = T.dock(tree, key, target, zone);
      if (tree !== before) { if (T.stackOf(tree, key)) docked.add(key); else docked.delete(key); }
      assert.ok(T.validTree(tree), `run ${run} step ${step} : arbre refusé après dock(${key}, ${target}, ${JSON.stringify(zone)})`);
      const tabs = T.leaves(tree).flatMap(n => n.t === 'stack' ? n.tabs : []);
      assert.equal(tabs.length, new Set(tabs).size, `run ${run} step ${step} : bloc dupliqué`);
    }
    assert.deepEqual([...T.stacked(tree)].sort(), [...docked].sort(), `run ${run} : blocs empilés ≠ blocs attendus`);
  }
});

test('treeFromPlaces : les anciennes positions deviennent un arbre (haut, bas, côtés, à côté replié)', () => {
  const tree = T.treeFromPlaces({ map: 'right', calendar: 'top', uses: 'beside' }, { right: { size: 's' } }, ['calendar', 'map', 'uses']);
  assert.ok(tree && T.validTree(tree));
  assert.deepEqual(panes(/** @type {T.PaneNode} */ (tree)), ['calendar', 'sheet', 'map', 'uses']);
  assert.equal(T.stackOf(/** @type {T.PaneNode} */ (tree), 'uses')?.folded, true);
  assert.equal(T.treeFromPlaces({}, {}, []), null);
});
