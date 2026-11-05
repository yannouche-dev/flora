// What a group's cells give it (app/layout/group-defaults.js): its radius, its period, its starting place — the first
// cell in reading order wins, two that disagree said; the address against a cell said too, with the way to take the
// cell's (Q3: the address keeps writing r=). One group: « du groupe A » left out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from '../../app/layout/registry.js';
import { parse } from '../../app/layout/grammar.js';
import { groupDefaults, groupNotes, startToFind } from '../../app/layout/group-defaults.js';

/** A layout's cells, in reading order, as gf-layout.js gives them (path, number, title, resolved). @param {string} text */
function cells(text) {
  /** @type {any[]} */
  const out = [];
  /** @param {any} n @param {number[]} path */
  const walk = (n, path) => {
    if (n.t === 'list') n.kids.forEach((/** @type {any} */ k, /** @type {number} */ j) => walk(k, [...path, j]));
    else { const r = resolve(n); out.push({ path: path.join('.'), n: out.length + 1, title: r.title, r }); }
  };
  walk(parse(text).tree, []);
  return out;
}
const NONE = { r: null, periode: null, at: null, place: null };

test('le rayon : le premier r= l’emporte (une case Zone avant une carte), dit', () => {
  const d = groupDefaults(cells('[place(r=5km),map(r=2km),results]'));
  assert.equal(d.radius, 5000);
  assert.deepEqual(d.conflicts.map(c => [c.key, c.cells.map(x => x.n), c.values]), [['r', [1, 2], [5000, 2000]]]);
  assert.deepEqual(groupNotes(d, NONE).map(n => n.text), ['Rayon : 5 km (« Zone », case 1) l’emporte sur 2 km (« Carte », case 2).']);
  // Several groups: whose.
  assert.equal(groupNotes(d, NONE, { letter: 'A' })[0].text, 'Rayon du groupe A : 5 km (« Zone », case 1) l’emporte sur 2 km (« Carte », case 2).');
  // The same radius twice: nothing to say. None: the state's own (null).
  assert.deepEqual(groupDefaults(cells('[map(r=2km),place(r=2km)]')).conflicts, []);
  assert.equal(groupDefaults(cells('[map,results]')).radius, null);
});

test('la période : la première carte qui en dit une (pas « Toujours ») ; une autre, dite — le même titre, son numéro seul', () => {
  const d = groupDefaults(cells('[map(when=mois),results,map(when=annee)]'));
  assert.equal(d.periode, 'mois');
  assert.equal(d.conflicts.length, 1);
  assert.equal(groupNotes(d, NONE)[0].text, 'Période : « Ce mois-ci » (« Carte », case 1) l’emporte sur « Cette année » (case 3).');
  assert.equal(groupDefaults(cells('[map(when=toujours),map(when=annee)]')).periode, 'annee');
  assert.equal(groupDefaults(cells('[map,results]')).periode, 'toujours');
});

test('le lieu de départ : la première carte qui en dit un (lieu=, sinon autour) ; deux, l’autre pas pris', () => {
  const d = groupDefaults(cells('[map(lieu=Mirabel),map(lieu=Riom)]'));
  assert.equal(d.start, 'lieu:Mirabel');
  assert.deepEqual(d.conflicts.map(c => c.key), ['start']);
  assert.equal(groupNotes(d, NONE)[0].text, 'Lieu de départ : « Mirabel » (« Carte », case 1) ; « Riom » (case 2) n’est pas pris.');
  assert.equal(groupDefaults(cells('[map(autour),results]')).start, 'autour');
  assert.equal(groupDefaults(cells('[map(lieu=Riom,autour)]')).start, 'lieu:Riom');
  assert.equal(groupDefaults(cells('[map,place,results]')).start, null);
});

test('l’adresse contre une case : dite, avec de quoi prendre celle de la case', () => {
  const d = groupDefaults(cells('[map(r=5km,when=mois,lieu=Mirabel),results]'));
  // (Mirabel's words lead near Ménétrol: far from Paris.)
  const notes = groupNotes(d, { r: 2000, periode: 'toujours', at: [2.35, 48.85], place: 'Paris' }, { zone: '2 km autour de Paris', startAt: [3.1116, 45.8726] });
  assert.deepEqual(notes.map(n => [n.text, n.take?.label, n.take?.patch]), [
    ['Rayon : l’adresse dit 2 km, la case « Carte » 5 km.', 'Prendre celui de la case', { r: 5000 }],
    ['Période : l’adresse dit « Toujours », la case « Carte » « Ce mois-ci ».', 'Prendre celle de la case', { periode: null }],
    ['Lieu : l’adresse a sa zone (2 km autour de Paris) ; le lieu de départ « Mirabel » ne s’applique pas.', 'Prendre celui de la case', { at: null, place: 'Mirabel', obs: null }]
  ]);
  // The address as the cells say, or not saying: nothing. A zone the starting place found (its name): nothing either.
  assert.deepEqual(groupNotes(d, { r: 5000, periode: 'mois', at: [3.1, 45.87], place: 'Puy de Mirabel (Ménétrol)' }), []);
  assert.deepEqual(groupNotes(d, NONE), []);
  // A cell that says nothing: the address' own is no conflict.
  assert.deepEqual(groupNotes(groupDefaults(cells('[map,results]')), { r: 5000, periode: 'mois', at: [2.35, 48.85], place: 'Paris' }), []);
});

test('le lieu de départ trouvé sous un autre nom (un code postal) : dit d’après où il mène, jamais d’après son nom seul', () => {
  const d = groupDefaults(cells('[map(lieu=63100),results]'));
  const live = { r: null, periode: null, at: /** @type {[number, number]} */ ([3.08707, 45.77722]), place: 'Clermont-Ferrand' };
  // Its name does not tell: where its words lead is asked; being found, nothing said yet.
  assert.equal(startToFind(d, live), '63100');
  assert.deepEqual(groupNotes(d, live), []);
  // They lead there (a reload, a shared link of its own zone): nothing to say.
  assert.deepEqual(groupNotes(d, live, { startAt: [3.0871, 45.7772] }), []);
  // Elsewhere, or nowhere (not found): said, with the way to take it.
  const far = groupNotes(d, live, { zone: '2 km autour de Clermont-Ferrand', startAt: [2.35, 48.85] });
  assert.deepEqual(far.map(n => [n.key, n.take?.patch]), [['address:start', { at: null, place: '63100', obs: null }]]);
  assert.equal(groupNotes(d, live, { startAt: null }).length, 1);
  // Named as it: nothing asked. No zone, no start: nothing asked either.
  assert.equal(startToFind(groupDefaults(cells('[map(lieu=Mirabel)]')), { at: [3.11, 45.87], place: 'Puy de Mirabel (Ménétrol)' }), null);
  assert.equal(startToFind(d, { at: null, place: null }), null);
  assert.equal(startToFind(groupDefaults(cells('[map(autour)]')), live), null);
});
