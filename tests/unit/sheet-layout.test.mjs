// app/core/sheet-blocks.js: the layout file (Réglages › Mise en page : Exporter / Importer). Audit GAP3-10: what the
// interface lets one build, the import reads back — property over random docking, as the « Déplacer vers… » menu
// and the drag do it (dockBlock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as SB from '../../app/core/sheet-blocks.js';
import * as M from '../../app/core/modules.js';
import { leaves } from '../../app/core/pane-tree.js';
import { store } from '../../app/core/store.js';
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

test('undockAlone : les volets que les étapes guidées d’avant avaient posés retournent dans la fiche, ceux que l’utilisateur a changés restent', () => {
  SB.resetAll();
  // As the guided steps of before left them: the photos beside the sheet, the encyclopedia under them, the fork's tabs.
  SB.dockBlock('standard', 'media', 'sheet', 'right');
  SB.dockBlock('standard', 'wikipedia', /** @type {any} */ (SB.paneOf('standard', 'media')).id, 'bottom');
  SB.dockBlock('standard', 'uses', 'root', 'right');
  SB.dockBlock('standard', 'lookalikes', /** @type {any} */ (SB.paneOf('standard', 'uses')).id, 'center');
  SB.dockBlock('standard', 'calendar', /** @type {any} */ (SB.paneOf('standard', 'uses')).id, 'center');
  // … one the user then gave another block.
  SB.dockBlock('standard', 'names', /** @type {any} */ (SB.paneOf('standard', 'wikipedia')).id, 'center');
  // (Usages is always shown: a block of the fork's that can be folded.)
  SB.setHidden('standard', 'calendar', true);
  SB.undockAlone('standard', [['media'], ['wikipedia'], ['uses', 'lookalikes', 'calendar']]);
  assert.deepEqual(['media', 'uses', 'lookalikes', 'calendar'].map(k => SB.isOnEdge('standard', k)), [false, false, false, false]);
  assert.deepEqual(SB.paneOf('standard', 'wikipedia')?.tabs, ['wikipedia', 'names'], 'with a block of the user’s: kept');
  assert.ok(SB.foldedByHand('standard', 'calendar'), 'a block folded stays folded');
  SB.resetAll();
});

test('le fichier n’emporte plus Réglages › Cartes ; celui d’un fichier ancien est ignoré', async () => {
  const MS = await import('../../app/core/map-settings.js');
  SB.resetAll();
  MS.setMapSettings({ renderer: '3d', globe: true, exaggeration: 2 });
  const text = SB.exportLayout();
  assert.equal('maps3d' in JSON.parse(text), false);
  const before = JSON.stringify(MS.mapSettings());
  // A file of before carried them: this device's stay as they are, a readable value or not.
  SB.importLayout(JSON.stringify({ ...JSON.parse(text), maps3d: { renderer: '2d', globe: false, exaggeration: 1 } }));
  assert.equal(JSON.stringify(MS.mapSettings()), before);
  SB.importLayout(JSON.stringify({ ...JSON.parse(text), maps3d: { renderer: 'holo', pitch: 400 } }));
  assert.equal(JSON.stringify(MS.mapSettings()), before);
  MS.resetMapSettings();
  SB.resetAll();
});

test('« Par défaut » (resetBlocks) retire aussi les panneaux du mode, et seulement les siens', () => {
  SB.resetAll();
  SB.dockBlock('standard', 'map', 'sheet', 'right');
  SB.dockBlock('epure', 'calendar', 'sheet', 'left');
  SB.setHidden('standard', 'taxonomy', true);
  assert.ok(SB.isCustom('standard'));
  SB.resetBlocks('standard');
  assert.equal(SB.treeOf('standard').t, 'sheet');
  assert.equal(SB.isCustom('standard'), false);
  assert.ok(SB.paneOf('epure', 'calendar'), 'Épuré garde ses panneaux');
  SB.resetAll();
});

test('Plantes à confondre et Usages (Prudence) toujours affichés : ni masqués, ni importés masqués, ni copiés masqués', () => {
  SB.resetAll();
  assert.deepEqual(SB.LOCKED, ['lookalikes', 'uses']);
  assert.ok(SB.isLocked('uses') && !SB.isLocked('taxonomy') && SB.isSubLocked('uses', 'safety') && !SB.isSubLocked('uses', 'parts'));
  SB.setHidden('standard', 'lookalikes', true);
  SB.setHidden('standard', 'uses', true);
  SB.setSubHidden('standard', 'uses', 'safety', true);
  assert.equal(SB.isCustom('standard'), false, 'rien n’a changé');
  assert.ok(!SB.isHidden('standard', 'lookalikes') && !SB.isHidden('standard', 'uses') && !SB.isSubHidden('standard', 'uses', 'safety'));
  // A file (or a layout of before) that hides them: shown all the same; the rest of its choices apply.
  const file = JSON.parse(SB.exportLayout());
  file.layout.hidden = { standard: ['lookalikes', 'uses', 'taxonomy'] };
  file.layout.subHidden = { standard: { uses: ['safety', 'parts'] } };
  SB.importLayout(JSON.stringify(file));
  assert.deepEqual(['lookalikes', 'uses', 'taxonomy'].map(k => SB.isHidden('standard', k)), [false, false, true]);
  assert.deepEqual(SB.shownSubs('standard', 'uses'), ['safety', 'uses', 'kitchen', 'links']);
  // Exported without them.
  const out = JSON.parse(SB.exportLayout());
  assert.deepEqual(out.layout.hidden, { standard: ['taxonomy'] });
  assert.deepEqual(out.layout.subHidden, { standard: { uses: ['parts'] } });
  // A mode made from it: the same.
  SB.copyLayout('standard', 'mtest');
  assert.deepEqual(['lookalikes', 'uses', 'taxonomy'].map(k => SB.isHidden(/** @type {any} */ ('mtest'), k)), [false, false, true]);
  assert.ok(!SB.isSubHidden(/** @type {any} */ ('mtest'), 'uses', 'safety'));
  SB.dropLayout(/** @type {any} */ ('mtest'));
  // Prudence first, whatever order is stored (« Usages rapportés » refers to it).
  SB.setSubOrder('standard', 'uses', ['uses', 'parts', 'kitchen', 'links', 'safety']);
  assert.equal(SB.subOrder('standard', 'uses')[0], 'safety');
  assert.deepEqual(SB.subOrder('standard', 'uses'), ['safety', 'uses', 'parts', 'kitchen', 'links']);
  SB.resetAll();
});

test('les blocs Carte : leur propre fond (MapConfig.look) ; ceux d’avant, leur fond et leurs couches IGN repris une fois', () => {
  SB.resetAll();
  // A new block: the maps' common look (none of its own).
  assert.equal(SB.mapConfig('map').look, null);
  // A file of before: the main map set to the photos and the cadastre, an added map left on the plan with its height
  // changed — the first keeps them as its own look, the second follows the common one (the plan was only the default).
  const file = JSON.parse(SB.exportLayout());
  file.layout.mapBlocks = [{ id: 'abc', title: 'Ma carte' }];
  file.layout.maps = { map: { base: 'photo', overlays: ['cadastre', 'lune'], height: 'l' }, 'map:abc': { base: 'plan', overlays: [], height: 's' } };
  SB.importLayout(JSON.stringify(file));
  assert.deepEqual(SB.mapConfig('map').look, { base: 'photo', overlays: ['cadastre'] });
  assert.equal(SB.mapConfig('map').height, 'l');
  assert.ok(!('base' in SB.mapConfig('map')) && !('overlays' in SB.mapConfig('map')), 'les champs d’avant ne restent pas');
  assert.equal(SB.mapConfig('map:abc').look, null);
  // Changed in its panel ▦ (gf-sheet-map `map-config` {look}), kept; « Revenir aux réglages communs »: none again.
  SB.setMapConfig('map:abc', { look: { base: 'plan', overlays: ['forets'], opacities: { forets: 0.5 } } });
  assert.deepEqual(SB.mapConfig('map:abc').look, { base: 'plan', overlays: ['forets'], opacities: { forets: 0.5 } });
  SB.setMapConfig('map', { look: null });
  assert.equal(SB.mapConfig('map').look, null);
  assert.equal(SB.mapConfig('map').height, 'l');
  // Exported and read back as they are.
  const text = SB.exportLayout();
  SB.resetAll();
  SB.importLayout(text);
  assert.deepEqual(SB.mapConfig('map:abc').look, { base: 'plan', overlays: ['forets'], opacities: { forets: 0.5 } });
  assert.equal(SB.mapConfig('map').look, null);
  // A file's look with a background or a layer that is a key every object inherits: left out (the map would not show).
  const odd = JSON.parse(SB.exportLayout());
  odd.layout.maps = { map: { look: { base: 'constructor' } }, 'map:abc': { look: { base: 'toString', overlays: ['constructor', 'cadastre'] } } };
  SB.importLayout(JSON.stringify(odd));
  assert.equal(SB.mapConfig('map').look, null);
  assert.deepEqual(SB.mapConfig('map:abc').look, { overlays: ['cadastre'] });
  // Its own background of a year, a period, SPOT's: kept, exported and read back; one no version has (1999), left out.
  SB.setMapConfig('map', { look: { base: 'photo:2016-2020' } });
  SB.setMapConfig('map:abc', { look: { base: 'spot:2020', overlays: ['cadastre'] } });
  const years = SB.exportLayout();
  SB.resetAll();
  SB.importLayout(years);
  assert.deepEqual(SB.mapConfig('map').look, { base: 'photo:2016-2020' });
  assert.deepEqual(SB.mapConfig('map:abc').look, { base: 'spot:2020', overlays: ['cadastre'] });
  const gone = JSON.parse(years);
  gone.layout.maps = { map: { look: { base: 'photo:1999' } }, 'map:abc': { look: { base: 'spot:2030', overlays: ['cadastre'] } } };
  SB.importLayout(JSON.stringify(gone));
  assert.equal(SB.mapConfig('map').look, null);
  assert.deepEqual(SB.mapConfig('map:abc').look, { overlays: ['cadastre'] });
  SB.resetAll();
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
  // The layout and the modes, nothing else: no note text, no Réglages › Cartes, no key of an earlier version.
  assert.deepEqual(Object.keys(JSON.parse(text)), ['app', 'kind', 'version', 'layout', 'modes']);
  assert.deepEqual(Object.keys(JSON.parse(text).layout),
    ['order', 'hidden', 'subOrder', 'subHidden', 'styles', 'titleShown', 'hideEmpty', 'tree', 'titles', 'notes', 'mapBlocks', 'maps']);
  // A layout read from an earlier version's keys, left in memory: none of them in the file.
  store.set({ sheetLayout: /** @type {any} */ ({ ...store.state.sheetLayout, place: { standard: { map: 'right' } }, edges: { standard: { right: { size: 'm' } } } }) });
  const stray = JSON.parse(SB.exportLayout()).layout;
  assert.ok(!('place' in stray) && !('edges' in stray));
  const before = JSON.stringify(M.modulesState());
  const old = { ...JSON.parse(text), modulesOff: { standard: ['photos', 'wikipedia'], epure: [] } };
  assert.doesNotThrow(() => SB.importLayout(JSON.stringify(old)));
  assert.equal(JSON.stringify(M.modulesState()), before, 'ni coupé ni rallumé par l’import');
  assert.doesNotThrow(() => SB.importLayout(JSON.stringify({ ...old, modulesOff: 'illisible' })));
  M.setModule('gbif', true);
  SB.resetAll();
});
