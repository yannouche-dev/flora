// app/core/store.js: « Personnaliser la fiche » (code name: King) — open on one host's sheet, for the visit only (never
// written: the key of the « Mode King » of before is forgotten at start), arranging the app's mode or another one picked
// in the sheet's bar, never changing the app's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../../app/config.js';
import { arrange, arrangedMode, closeKing, openKing, store } from '../../app/core/store.js';
import { createMode, deleteMode } from '../../app/core/mode-admin.js';
import { forgetObsolete } from '../../app/core/prefs.js';

test('ouverte sur une fiche, elle arrange le mode de l’application, ou celui choisi dans sa barre — sans le changer', () => {
  assert.equal(store.state.king, null, 'fermée au lancement');
  openKing('flore');
  assert.deepEqual(store.state.king, { sheet: 'flore', mode: null });
  assert.equal(arrangedMode('flore', 'standard'), 'standard');
  arrange('scientific', 'standard');
  assert.equal(arrangedMode('flore', 'standard'), 'scientific');
  assert.equal(arrangedMode('collections', 'standard'), 'standard', 'l’autre fiche lit son mode');
  assert.equal(store.state.mode, 'standard', 'le mode de l’application ne change pas');
  // The app's mode picked (or none, ↺): it follows the app's again.
  arrange('standard', 'standard');
  assert.equal(store.state.king?.mode, null);
  arrange('epure', 'standard');
  arrange(null, 'standard');
  assert.equal(store.state.king?.mode, null);
  closeKing();
  assert.equal(store.state.king, null);
  arrange('scientific', 'standard');
  assert.equal(store.state.king, null, 'fermée, rien à arranger');
  assert.equal(arrangedMode('flore', 'epure'), 'epure');
});

test('le mode arrangé supprimé : la fiche arrange de nouveau celui de l’application', () => {
  const mine = createMode('Médias seuls', 'epure');
  openKing('collections');
  arrange(mine, 'standard');
  assert.equal(arrangedMode('collections', 'standard'), mine);
  deleteMode(mine);
  assert.deepEqual(store.state.king, { sheet: 'collections', mode: null });
  assert.equal(arrangedMode('collections', 'standard'), 'standard');
  closeKing();
});

test('jamais écrite : la clé du « Mode King » d’avant est oubliée au lancement', () => {
  assert.ok(config.obsoleteKeys.includes('geoflora.kingMode'));
  assert.ok(!Object.values(config.storageKeys).includes('geoflora.kingMode'));
  localStorage.setItem('geoflora.kingMode', '1');
  forgetObsolete(config.obsoleteKeys);
  assert.equal(localStorage.getItem('geoflora.kingMode'), null);
  openKing('flore');
  assert.equal(localStorage.getItem('geoflora.kingMode'), null);
  closeKing();
});
