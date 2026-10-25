// The Parcours botanique, what is pure about it (app/miniapp/kit/trail-store.js): a walk's plants grouped and
// counted, its name shortened for the list to take up again, its recap's numbers (time without the pauses, distance
// from plant to plant, from the start when it was started here); and what it keeps on the device.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countOf, groupsOf, keptWalks, shortName, walkDone, walkOn, walkUnderWay, KEY, LIST, DONE } from '../../app/miniapp/kit/trail-store.js';
import { recapOf } from '../../app/miniapp/kit/trail-recap.js';
import { writeJSON } from '../../app/core/prefs.js';

/** A walk started here at 9:00, with plants at their own places. @param {any[]} plants */
const walk = plants => ({ id: 'w', geometry: { type: 'Point', coordinates: [2.35, 48.85] },
  properties: { name: 'Mon parcours botanique en forêt de Fontainebleau', startedHere: true, createdAt: '2026-10-13T09:00:00.000Z', altitude: null, plants } });
/** @param {number} plantId @param {string} at @param {[number, number]} coordinates */
const entry = (plantId, at, coordinates) => ({ id: 'e' + plantId + at, plantId, scientificName: 'P' + plantId, vernacularName: null, addedAt: at, coordinates, accuracy: 5, altitude: null });

test('les plantes du parcours : chacune une fois, la dernière rencontrée d’abord ; comptées', () => {
  const t = walk([entry(1, '2026-10-13T09:10:00.000Z', [2.351, 48.85]), entry(2, '2026-10-13T09:20:00.000Z', [2.352, 48.85]), entry(1, '2026-10-13T09:30:00.000Z', [2.353, 48.85])]);
  assert.deepEqual(groupsOf(t).map(g => [g.plantId, g.entries.length]), [[1, 2], [2, 1]]);
  assert.equal(countOf(t), '2 plantes, notées 3 fois');
  assert.equal(countOf(walk([entry(1, '2026-10-13T09:10:00.000Z', [2.351, 48.85])])), '1 plante');
  assert.equal(countOf(walk([])), 'Aucune plante encore');
  assert.equal(shortName('Mon parcours botanique en forêt de Fontainebleau'), 'En forêt de Fontainebleau');
  assert.equal(shortName('Chemin du lavoir'), 'Chemin du lavoir');
});

test('le bilan : la durée sans les pauses, la distance de plante en plante depuis le départ', () => {
  const t = walk([entry(1, '2026-10-13T09:10:00.000Z', [2.36, 48.85]), entry(2, '2026-10-13T09:25:00.000Z', [2.37, 48.85]),
    // Taken up again the next day: a pause, not counted.
    entry(3, '2026-10-14T10:00:00.000Z', [2.38, 48.85])]);
  const r = recapOf(t);
  assert.equal(r.time, '25 min');
  assert.match(r.dist, /^2,2 km$/);
  assert.equal(r.profile, null, 'sans altitude : pas de profil');
});

test('ce que le parcours garde sur l’appareil', () => {
  localStorage.clear();
  assert.deepEqual([walkUnderWay(), walkOn(), walkDone(), keptWalks()], [false, null, null, []]);
  writeJSON(KEY, 'a'); writeJSON(LIST, ['a', 'b']); writeJSON(DONE, 'c');
  assert.deepEqual([walkUnderWay(), walkOn(), walkDone(), keptWalks()], [true, 'a', 'c', ['a', 'b', 'c']]);
  writeJSON(KEY, null);
  assert.equal(localStorage.getItem(KEY), null, 'rien : la clé retirée');
});
