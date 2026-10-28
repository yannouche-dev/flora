// app/core/context.js: where each tab leads back to, as it was left — Flore its search or the plant open, which the
// logo and the ways back into the app (« Aller à Flore ») lead to too; Découvrir until Flore has come.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// What a visit before kept (read as the module loads): the first steps under way, no tab come yet; a plant open in
// Flore over its search, the Carte on a place, Mes plantes never opened. Read from Réglages (no view recorded).
localStorage.setItem('geoflora.discover', JSON.stringify({ done: false, unlocked: [] }));
localStorage.setItem('geoflora.context', JSON.stringify({ flore: '#/plant/12', query: '#/?family=Rosaceae', mine: null, map: '#/map?spot=p1' }));
location.hash = '#/settings';
const { floreHref, floreName, tabHref } = await import('../../app/core/context.js');
const { unlock } = await import('../../app/core/discover.js');

test('Flore là où on l’avait laissée, la plante comprise ; Découvrir tant que Flore n’est pas venue', () => {
  assert.equal(floreHref(), '#/discover');
  assert.equal(floreName(), 'Découvrir');
  unlock('flore');
  assert.equal(floreHref(), '#/plant/12');
  assert.equal(floreName(), 'Flore');
  assert.equal(tabHref('flore'), '#/plant/12');
});

test('chaque onglet ramène là où on l’avait laissé, son départ s’il n’a jamais servi', () => {
  assert.equal(tabHref('map'), '#/map?spot=p1');
  assert.equal(tabHref('mine'), '#/collections');
});
