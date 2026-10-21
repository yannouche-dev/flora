// app/core/sheet-blocks.js: the layout file (Réglages › Mise en page : Exporter / Importer). Audit GAP3-10: what the
// interface lets one build, the import reads back — property over random docking, as the « Déplacer vers… » menu
// and the drag do it (dockBlock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as SB from '../../app/core/sheet-blocks.js';
import * as M from '../../app/core/modules.js';
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

test('le fichier de mise en page emporte Réglages › Cartes (2D / 3D et options), et les rend à l’import', async () => {
  const MS = await import('../../app/core/map-settings.js');
  SB.resetAll();
  MS.setMapSettings({ renderer: '3d', globe: true, exaggeration: 2 });
  const text = SB.exportLayout();
  assert.deepEqual(JSON.parse(text).maps3d, { renderer: '3d', exaggeration: 2, globe: true });
  MS.resetMapSettings();
  SB.importLayout(text);
  assert.equal(MS.mapSettings().renderer, '3d');
  assert.equal(MS.mapSettings().globe, true);
  // A file of before (no maps3d): the settings here stay; a broken value is made valid.
  const old = JSON.parse(text);
  delete old.maps3d;
  SB.importLayout(JSON.stringify(old));
  assert.equal(MS.mapSettings().exaggeration, 2);
  SB.importLayout(JSON.stringify({ ...old, maps3d: { renderer: 'holo', pitch: 400 } }));
  assert.equal(MS.mapSettings().renderer, '2d');
  assert.equal(MS.mapSettings().pitch, 85);
  MS.resetMapSettings();
});

// Services are the device's (Réglages › Modules): hiding or showing a block never switches one.
const GBIF_BLOCKS = ['descriptions', 'occurrences', 'gbifMedia', 'gbifProfile', 'literature'];

test('masquer ou réafficher un bloc ne coupe ni ne rallume jamais son service', () => {
  SB.resetAll();
  const before = JSON.stringify(M.modulesState());
  for (const k of [...GBIF_BLOCKS, 'wikipedia', 'photos', 'media', 'trefle']) SB.setHidden('standard', k, true);
  assert.ok(GBIF_BLOCKS.every(k => SB.isHidden('standard', k)));
  assert.equal(JSON.stringify(M.modulesState()), before, 'le dernier bloc GBIF masqué : GBIF reste utilisé');
  for (const k of GBIF_BLOCKS) SB.setHidden('standard', k, false);
  assert.equal(JSON.stringify(M.modulesState()), before);

  // Its service off: the block is folded whatever its own choice (nothing to show), and stays so when brought back.
  M.setModule('gbif', false);
  assert.ok(SB.serviceOff('occurrences') && SB.isHidden('standard', 'occurrences') && !SB.foldedByHand('standard', 'occurrences'));
  SB.setHidden('standard', 'occurrences', false);
  SB.toSheet('standard', 'descriptions');
  assert.ok(SB.dockBlock('standard', 'literature', 'sheet', 'right'));
  assert.equal(SB.dockBlock('standard', 'gbifProfile', 'sheet', 'left', { auto: true }), false, 'une mise en page faite par l’app laisse le bloc');
  assert.equal(M.moduleOn('gbif'), false, 'ni réafficher, ni ramener dans la fiche, ni mettre en panneau ne le rallume');
  assert.ok(SB.isHidden('standard', 'occurrences'));
  assert.equal(SB.serviceOffNote('occurrences'), 'service GBIF coupé pour tout l’appareil');
  M.setModule('gbif', true);
  assert.equal(SB.isHidden('standard', 'occurrences'), false, 'rallumé dans les Réglages : le bloc revient');

  // Wikipédia is found through Wikidata.
  M.setModule('wikidata', false);
  assert.ok(SB.serviceOff('wikipedia'));
  assert.equal(SB.serviceOffNote('wikipedia'), 'service Wikidata coupé pour tout l’appareil');
  M.setModule('wikipedia', false);
  assert.equal(SB.serviceOffNote('wikipedia'), 'services Wikipédia et Wikidata coupés pour tout l’appareil');
  M.setModule('wikipedia', true);
  M.setModule('wikidata', true);
  SB.resetAll();
});

test('« Par défaut » rend Occurrences, Habitat et Publications, et ne touche à aucun service', () => {
  SB.resetAll();
  for (const k of ['descriptions', 'occurrences', 'gbifProfile', 'literature', 'interactions']) SB.setHidden('scientific', k, true);
  M.setModule('globi', false);
  const before = JSON.stringify(M.modulesState());
  SB.resetBlocks('scientific');
  for (const k of ['descriptions', 'occurrences', 'gbifProfile', 'literature']) assert.equal(SB.isHidden('scientific', k), false, k);
  assert.equal(JSON.stringify(M.modulesState()), before, 'aucun service changé');
  assert.ok(SB.isHidden('scientific', 'interactions'), 'GloBI coupé : son bloc reste masqué');
  // GBIF off in Réglages: « Par défaut » leaves it off; switched on, every one of its blocks is back (not the first only).
  M.setModule('gbif', false);
  SB.resetBlocks('scientific');
  SB.resetAll();
  assert.equal(M.moduleOn('gbif'), false);
  M.setModule('gbif', true);
  M.setModule('globi', true);
  for (const k of ['descriptions', 'occurrences', 'gbifProfile', 'literature', 'interactions']) assert.equal(SB.isHidden('scientific', k), false, k);
});

test('le fichier de mise en page n’emporte pas les services ; ceux d’un fichier ancien sont ignorés', () => {
  SB.resetAll();
  M.setModule('gbif', false);
  const text = SB.exportLayout();
  assert.equal('modulesOff' in JSON.parse(text), false);
  const before = JSON.stringify(M.modulesState());
  const old = { ...JSON.parse(text), modulesOff: { standard: ['photos', 'wikipedia'], epure: [] } };
  assert.doesNotThrow(() => SB.importLayout(JSON.stringify(old)));
  assert.equal(JSON.stringify(M.modulesState()), before, 'ni coupé ni rallumé par l’import');
  assert.doesNotThrow(() => SB.importLayout(JSON.stringify({ ...old, modulesOff: 'illisible' })));
  M.setModule('gbif', true);
  SB.resetAll();
});
