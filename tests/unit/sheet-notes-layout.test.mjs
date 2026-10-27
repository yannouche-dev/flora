// app/core/sheet-blocks.js with the Note blocks' texts (sheet-notes.js, in an IndexedDB in memory: fake-indexeddb):
// « Tout rétablir » (resetAll) and the layout file (exportLayout, importLayout) never lose what the user wrote — the
// Note blocks and their texts stay; the file carries the blocks, not the texts (they travel with Mes plantes).
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// db.js upgrades the schema only from a page (a worker opens whatever version exists).
/** @type {any} */ (globalThis).window ??= globalThis;

const SB = await import('../../app/core/sheet-blocks.js');
const notes = await import('../../app/core/sheet-notes.js');
const { store } = await import('../../app/core/store.js');
const { nodes } = await import('../../app/core/pane-tree.js');

const PLANT = 100225;
const idOf = (/** @type {string} */ key) => key.slice('note:'.length);

await notes.loadNotes();

test('le fichier de mise en page : l’arbre de panneaux sans la clé d’un bloc Note supprimé, et aucun texte', async () => {
  SB.resetAll();
  const key = SB.createNote('Récolte');
  await SB.setNoteText(key, PLANT, 'Station de 30 pieds');
  SB.dockBlock('standard', key, 'sheet', 'right');
  SB.dockBlock('standard', 'map', /** @type {any} */ (SB.paneOf('standard', key)).id, 'center');
  assert.ok(!SB.exportLayout().includes('Station de 30 pieds'), 'les textes voyagent avec Mes plantes, pas dans ce fichier');
  SB.deleteNote(key);
  const text = SB.exportLayout();
  assert.ok(!text.includes(idOf(key)), 'plus rien de ce bloc');
  assert.deepEqual(nodes(JSON.parse(text).layout.tree.standard).filter(n => n.t === 'stack').map(n => /** @type {any} */ (n).tabs), [['map']], 'son panneau garde la carte');
  SB.resetAll();
});

test('« Tout rétablir » garde les blocs Note et leurs textes, rien d’autre', async () => {
  SB.resetAll();
  const key = SB.createNote('Récolte');
  assert.equal(await SB.setNoteText(key, PLANT, 'Station de 30 pieds'), true);
  SB.renameBlock('taxonomy', 'Familles');
  SB.setHidden('standard', 'calendar', true);
  SB.setHidden('standard', key, true);
  SB.setBlockOrder('standard', [key, ...SB.blockOrder('standard').filter(k => k !== key)]);
  SB.dockBlock('epure', 'map', 'sheet', 'right');
  const map = SB.createMap('Ma carte');
  SB.resetAll();
  assert.deepEqual(store.state.sheetLayout.notes, [{ id: idOf(key), title: 'Récolte' }]);
  for (const mode of /** @type {const} */ (['epure', 'standard', 'scientific'])) {
    assert.equal(SB.blockOrder(mode).at(-1), key, `${mode} : en fin de fiche`);
    assert.equal(SB.isHidden(mode, key), false, `${mode} : affiché`);
    assert.equal(SB.isCustom(mode), false, mode);
  }
  assert.equal(SB.noteText(key, PLANT), 'Station de 30 pieds');
  assert.equal(SB.blockTitle('taxonomy'), 'Classification');
  assert.equal(SB.isHidden('standard', 'calendar'), false);
  assert.equal(SB.treeOf('epure').t, 'sheet');
  assert.equal(SB.blockOf(map), undefined, 'le bloc Carte ajouté est parti');
  SB.resetAll();
  SB.deleteNote(key);
});

test('importer une mise en page garde tous les blocs Note d’ici ; les textes d’un fichier ancien s’ajoutent, sans rien remplacer', async () => {
  SB.resetAll();
  const empty = SB.exportLayout();
  const written = SB.createNote('Récolte');
  const blank = SB.createNote('Vide');
  await SB.setNoteText(written, PLANT, 'le mien');
  assert.equal(await SB.importLayout(empty), 0);
  assert.deepEqual(store.state.sheetLayout.notes.map(n => n.id), [idOf(written), idOf(blank)], 'un bloc sans texte aussi');
  // A file of before: its own Note blocks, one of them also here (renamed there), and their texts.
  const old = JSON.parse(empty);
  old.layout.notes = [{ id: 'ancienne', title: 'Ancienne' }, { id: idOf(written), title: 'Récolte 2024' }];
  old.notes = { ancienne: { [PLANT]: 'texte ancien' }, [idOf(written)]: { [PLANT]: 'pas le mien', 7: 'nouveau' } };
  assert.equal(await SB.importLayout(JSON.stringify(old)), 2, 'deux textes ajoutés');
  assert.deepEqual(store.state.sheetLayout.notes, [{ id: 'ancienne', title: 'Ancienne' }, { id: idOf(written), title: 'Récolte 2024' }, { id: idOf(blank), title: 'Vide' }]);
  assert.equal(SB.noteText(written, PLANT), 'le mien', 'jamais par-dessus le texte d’ici');
  assert.equal(SB.noteText(written, 7), 'nouveau');
  assert.equal(SB.noteText('note:ancienne', PLANT), 'texte ancien');
  for (const key of ['note:ancienne', written, blank]) SB.deleteNote(key);
  SB.resetAll();
});
