// app/workers/search-core.js: the search of the flora (ranking, accents, typos, abbreviations, facets, sorting), on
// the reduced flora of the tests (tests/fixtures/plants.json). Audit TEST-11: what the worker runs, tested in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FACETS, buildIndex, distance, legalValues, rank, search, sequence } from '../../app/workers/search-core.js';

const plants = JSON.parse(await readFile(new URL('../fixtures/plants.json', import.meta.url), 'utf8'));
const index = buildIndex(plants);
const NONE = Object.fromEntries(FACETS.map(f => [f, []]));
const find = (/** @type {string} */ q, /** @type {any} */ more = {}) => search(index, { q, filters: { ...NONE, ...(more.filters || {}) }, sort: more.sort || '', membership: more.membership });
const names = (/** @type {any} */ r) => r.items.map((/** @type {any} */ p) => p.scientificName);

test('rank, sequence, distance : les briques du classement', () => {
  assert.equal(rank('ortie dioique', 'ortie dioique'), 0);
  assert.equal(rank('ortie dioique', 'ortie'), 1);
  assert.equal(rank('grande ortie', 'ortie'), 2);
  assert.equal(rank('lortie', 'ortie'), 3);
  assert.equal(rank('ortie', 'rose'), -1);
  assert.ok(sequence(['geranium', 'robertianum'], ['ger', 'rob']));
  assert.ok(!sequence(['geranium', 'robertianum'], ['rob', 'ger']), 'dans l’ordre');
  assert.equal(distance('pissenlit', 'pisenlit', 2), 1);
  assert.equal(distance('ortie', 'otrie', 1), 1, 'lettres inversées : une faute');
  assert.equal(distance('ortie', 'rosier', 1), 2, 'au-delà du maximum : max + 1');
});

test('un nom français exact passe d’abord ; accents et ligatures sans importance', () => {
  assert.equal(names(find('Ortie dioïque'))[0], 'Urtica dioica');
  assert.equal(names(find('ORTIE DIOIQUE'))[0], 'Urtica dioica');
  assert.equal(names(find('ail des ours'))[0], 'Allium ursinum');
  assert.equal(names(find('benoite des villes'))[0], 'Geum urbanum');
});

test('nom scientifique, abréviation de botaniste, synonyme', () => {
  assert.equal(names(find('urtica dioica'))[0], 'Urtica dioica');
  assert.equal(names(find('geu urb'))[0], 'Geum urbanum', 'débuts de mots, dans l’ordre');
  const syn = find('urtica galeopsifolia');
  assert.equal(names(syn)[0], 'Urtica dioica');
  assert.equal(syn.items[0].match, 'syn.');
});

test('fautes de frappe : « pisenlit », « otrie dioique » trouvent quand même', () => {
  const r = find('pisenlit');
  assert.ok(r.fuzzy > 0, 'résultats approchés signalés');
  assert.ok(names(r).includes('Taraxacum officinale'));
  assert.equal(names(find('otrie dioique'))[0], 'Urtica dioica');
  assert.equal(find('zzzzqqq').total, 0);
});

test('facettes : un filtre réduit les résultats, chaque compte vaut ce qu’on aurait en l’ajoutant', () => {
  const all = find('');
  assert.equal(all.total, plants.length);
  const urticaceae = all.facets.family.Urticaceae;
  assert.ok(urticaceae > 0);
  const only = find('', { filters: { family: ['Urticaceae'] } });
  assert.equal(only.total, urticaceae);
  assert.ok(only.items.every((/** @type {any} */ p) => p.family === 'Urticaceae'));
  // The family facet still counts the other families (adding one), the others count within Urticaceae.
  assert.equal(only.facets.family.Rosaceae, all.facets.family.Rosaceae);
  assert.equal(Object.values(only.facets.photo).reduce((a, b) => a + b, 0), urticaceae);
  // Two values of one facet: OR; two facets: AND.
  const two = find('', { filters: { family: ['Urticaceae', 'Rosaceae'] } });
  assert.equal(two.total, urticaceae + all.facets.family.Rosaceae);
  const and = find('', { filters: { family: ['Urticaceae'], photo: ['avec'] } });
  assert.equal(and.total, only.facets.photo.avec);
});

test('facette « Mes plantes » (fournie à chaque recherche) et protection', () => {
  const r = find('', { filters: { mine: ['favorites'] }, membership: { 128268: ['favorites'], 81541: ['favorites', 'l1'] } });
  assert.deepEqual(names(r).sort(), ['Allium ursinum', 'Urtica dioica']);
  const pn = find('', { filters: { legal: ['nationale'] } });
  assert.ok(pn.total >= 10, 'le jeu réduit garde des plantes protégées');
  assert.ok(pn.items.every((/** @type {any} */ p) => p.legal.includes('nationale') && p.legal.includes('protegee')));
  assert.deepEqual(legalValues([{ type: 'PR' }, { type: 'LRN' }]), ['protegee', 'menacee']);
  assert.deepEqual(legalValues(undefined), []);
});

test('tri : français par défaut (sans nom français en dernier), scientifique, inverse, pertinence avec un texte', () => {
  const fr = find('');
  assert.equal(fr.sort, 'fr');
  const firstWithout = fr.items.findIndex((/** @type {any} */ p) => !p.vernacularName);
  assert.ok(firstWithout > 0 && fr.items.slice(firstWithout).every((/** @type {any} */ p) => !p.vernacularName));
  const sci = names(find('', { sort: 'sci' }));
  assert.deepEqual(sci, [...sci].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' })));
  assert.deepEqual(names(find('', { sort: '-sci' })), [...sci].reverse());
  assert.equal(find('ortie').sort, 'relevance');
  assert.equal(find('', { sort: 'relevance' }).items[0].id, fr.items[0].id, 'pertinence sans texte : ordre français');
});

test('suggestions : familles et genres qui commencent par le texte, pas déjà filtrés', () => {
  const r = find('urtic');
  assert.deepEqual(r.suggestions.map((/** @type {any} */ s) => `${s.type}:${s.name}`), ['family:Urticaceae', 'genus:Urtica']);
  assert.deepEqual(find('urtic', { filters: { family: ['Urticaceae'] } }).suggestions.map((/** @type {any} */ s) => s.name), ['Urtica']);
  assert.deepEqual(find('u').suggestions, [], 'pas sur une lettre');
});

test('un index vide répond sans erreur', () => {
  const empty = buildIndex([]);
  assert.deepEqual(search(empty, { q: 'ortie', filters: NONE, sort: '' }).items, []);
});
