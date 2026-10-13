// app/core/store.js: the layouts saved by earlier versions (pinned blocks, then places at the edges) read into the
// current one (a tree of panes), without losing what the user arranged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyLayout, migratePlaces, migrateTree } from '../../app/core/store.js';
import { leaves, validTree } from '../../app/core/pane-tree.js';

const panes = (/** @type {any} */ tree) => leaves(tree).map(n => n.t === 'stack' ? n.tabs.join('+') : 'sheet');

test('une mise en page actuelle passe telle quelle', () => {
  const current = { ...emptyLayout(), order: { standard: ['map', 'uses'] } };
  assert.equal(migratePlaces(current), current);
  assert.equal(migrateTree(current), current);
  assert.equal(migratePlaces(null), null);
});

test('migratePlaces : blocs épinglés (dock) et « en volet » deviennent des places, taille et repli gardés', () => {
  const old = { order: { standard: ['map'] }, pinned: { standard: ['map', 'calendar'] }, paned: { standard: ['uses'] }, dock: { standard: { side: 'left', size: 'l', folded: true } } };
  const l = migratePlaces(old);
  assert.deepEqual(l.place, { standard: { map: 'left', calendar: 'left', uses: 'beside' } });
  assert.deepEqual(l.edges, { standard: { left: { size: 'l', folded: true } } });
  assert.equal(l.pinned, undefined);
  assert.equal(l.dock, undefined);
  assert.deepEqual(l.order, old.order, 'le reste ne change pas');
  assert.deepEqual(migratePlaces({ pinned: { epure: ['map'] }, dock: { epure: { side: 'auto' } } }).place, { epure: { map: 'right' } }, "« auto » était à droite");
});

test('migrateTree : les places deviennent un arbre de volets valide, mode par mode', () => {
  const l = migrateTree({ order: { standard: ['calendar', 'map'] }, place: { standard: { map: 'right', calendar: 'top' }, epure: {} }, edges: { standard: { right: { size: 's' } } } });
  assert.equal(l.place, undefined);
  assert.equal(l.edges, undefined);
  assert.ok(validTree(l.tree.standard));
  assert.deepEqual(panes(l.tree.standard), ['calendar', 'sheet', 'map']);
  assert.equal(l.tree.epure, undefined, 'sans place : pas d’arbre');
});

test('migrateTree ne remplace pas un arbre déjà là', () => {
  const tree = { t: 'split', id: 'x', dir: 'row', kids: [{ t: 'sheet', id: 'sheet' }, { t: 'stack', id: 's', tabs: ['uses'], active: 'uses' }], sizes: [0.6, 0.4] };
  const l = migrateTree({ tree: { standard: tree }, place: { standard: { map: 'left' } } });
  assert.equal(l.tree.standard, tree);
});

test('chaîne complète v1 → arbre', () => {
  const l = migrateTree(migratePlaces({ pinned: { scientific: ['gbif'] }, dock: { scientific: { side: 'bottom', size: 's' } } }));
  assert.deepEqual(panes(l.tree.scientific), ['sheet', 'gbif']);
  assert.equal(l.tree.scientific.dir, 'col');
});
