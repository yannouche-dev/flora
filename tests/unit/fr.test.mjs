// app/core/fr.js: a number and its word, as the app says them (counted) — the French grouping from 1 000, 0 and 1
// singular.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { counted } from '../../app/core/fr.js';

test('counted : un nombre et son mot', () => {
  assert.equal(counted(0, 'résultat'), '0 résultat');
  assert.equal(counted(1, 'couche'), '1 couche');
  assert.equal(counted(660, 'couche'), '660 couches');
  assert.equal(counted(1000, 'couche'), '1 000 couches', 'l’espace fine des milliers');
});
