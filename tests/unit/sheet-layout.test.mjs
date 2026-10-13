// app/core/sheet-blocks.js: the layout file (Réglages › Mise en page : Exporter / Importer). Audit GAP3-10: what the
// interface lets one build, the import reads back — property over random docking, as the « Déplacer vers… » menu
// and the drag do it (dockBlock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as SB from '../../app/core/sheet-blocks.js';
import { leaves } from '../../app/core/pane-tree.js';
import { random } from './support/random.mjs';

const KEYS = SB.BLOCKS.map(b => b.key).filter(k => !['name', 'actions', 'web'].includes(k));
const ZONES = /** @type {const} */ (['left', 'right', 'top', 'bottom', 'center']);

test('exportLayout → importLayout : aller-retour sans perte', () => {
  SB.resetAll();
  SB.dockBlock('standard', 'map', 'sheet', 'right');
  const text = SB.exportLayout();
  assert.equal(JSON.parse(text).version, 2);
  SB.resetAll();
  SB.importLayout(text);
  assert.equal(SB.exportLayout(), text);
  assert.ok(SB.paneOf('standard', 'map'));
});

test('importLayout refuse un fichier étranger ou un arbre hostile, sans rien changer', () => {
  SB.resetAll();
  SB.dockBlock('standard', 'calendar', 'sheet', 'left');
  const before = SB.exportLayout();
  assert.throws(() => SB.importLayout('pas du json'), /pas du JSON/);
  assert.throws(() => SB.importLayout('{"app":"autre"}'), /pas une mise en page/);
  const bad = JSON.parse(before);
  bad.layout.tree = { standard: { t: 'stack', id: 'x', tabs: ['map'] } };
  assert.throws(() => SB.importLayout(JSON.stringify(bad)), /illisible/);
  assert.equal(SB.exportLayout(), before);
});

test('GAP3-10 : volets imbriqués en alternance par le menu, exportés puis réimportés', () => {
  SB.resetAll();
  const moved = KEYS.slice(0, 9).map((k, i) => SB.dockBlock('standard', k, 'sheet', i % 2 ? 'top' : 'left'));
  assert.ok(moved.includes(false), 'le volet de trop est refusé (dockBlock rend false)');
  const text = SB.exportLayout();
  SB.resetAll();
  assert.doesNotThrow(() => SB.importLayout(text));
  assert.equal(SB.exportLayout(), text);
});

test('propriété : toute mise en page bâtie par dockBlock se réimporte à l’identique', () => {
  const rnd = random(20261013);
  for (let run = 0; run < 150; run++) {
    SB.resetAll();
    for (let step = 0, n = 8 + rnd(25); step < n; step++) {
      const ids = ['root', 'sheet', ...leaves(SB.treeOf('standard')).map(p => p.id)];
      const key = KEYS[rnd(KEYS.length)];
      if (rnd(10) === 0) SB.toSheet('standard', key);
      else SB.dockBlock('standard', key, ids[rnd(ids.length)], ZONES[rnd(ZONES.length)]);
    }
    const text = SB.exportLayout();
    SB.resetAll();
    assert.doesNotThrow(() => SB.importLayout(text), `run ${run}`);
    assert.equal(SB.exportLayout(), text, `run ${run}`);
  }
});

test('resetAll retire les volets : la fiche seule', () => {
  SB.resetAll();
  SB.dockBlock('standard', 'uses', 'sheet', 'right');
  assert.ok(SB.isOnEdge('standard', 'uses'));
  SB.resetAll();
  assert.equal(SB.treeOf('standard').t, 'sheet');
});
