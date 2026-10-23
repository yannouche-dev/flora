// app/workers/search-core.js: the search of the flora (ranking, accents, typos, abbreviations, facets, sorting), on
// the reduced flora of the tests (tests/fixtures/plants.json). Audit TEST-11: what the worker runs, tested in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FACETS, buildIndex, distance, legalValues, rank, search, sequence } from '../../app/workers/search-core.js';
import { unsigned } from '../../app/core/fold.js';

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
  // A hybrid at its name, its sign set aside (« Allium x proliferum » among the Allium, at « proliferum »).
  assert.deepEqual(sci, [...sci].sort((a, b) => unsigned(a).localeCompare(unsigned(b), 'fr', { sensitivity: 'base' })));
  assert.deepEqual(names(find('', { sort: '-sci' })), [...sci].reverse());
  assert.equal(find('ortie').sort, 'relevance');
  assert.equal(find('', { sort: 'relevance' }).items[0].id, fr.items[0].id, 'pertinence sans texte : ordre français');
});

test('le signe d’hybride à part : « x » ou « × » seul ôté pour ranger, jamais la lettre d’un nom (Xanthium, xylosteum)', () => {
  assert.equal(unsigned('× Leontoroides'), 'Leontoroides');
  assert.equal(unsigned('x Leontoroides hispidaster'), 'Leontoroides hispidaster');
  assert.equal(unsigned('Alisma x rhicnocarpum'), 'Alisma rhicnocarpum');
  assert.equal(unsigned('× rhicnocarpum'), 'rhicnocarpum');
  assert.equal(unsigned('Arum italicum x Arum maculatum'), 'Arum italicum Arum maculatum');
  for (const name of ['Xanthium strumarium', 'Xatartia scabra', 'xylosteum', 'Lonicera xylosteum', 'Rosa ×']) assert.equal(unsigned(name), name);
  assert.equal(unsigned(undefined), '');
  // Shown with it: the index keeps the names as they are.
  const proliferum = find('', { sort: 'species' }).items.find((/** @type {any} */ p) => p.scientificName === 'Allium x proliferum');
  assert.equal(proliferum.species, '× proliferum');
  assert.equal(find('', { sort: 'genus' }).items.find((/** @type {any} */ p) => p.scientificName === 'x Dactylodenia st-quintinii').genus, '× Dactylodenia');
});

test('tri « Espèce » : par l’épithète, son signe d’hybride à part, puis le genre ; à l’envers, l’inverse exact', () => {
  const species = find('', { sort: 'species' });
  assert.equal(species.sort, 'species');
  const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
  const epithets = species.items.map((/** @type {any} */ p) => unsigned(p.species));
  assert.ok(epithets.every((e, i) => i === 0 || collator.compare(epithets[i - 1], e) <= 0), 'les épithètes dans l’ordre, pas les genres');
  assert.notDeepEqual(names(species), names(find('', { sort: 'sci' })));
  // « × oblongata » at « oblongata », not before every epithet.
  assert.deepEqual(find('', { sort: 'species', filters: { genus: ['Urtica'] } }).items.map((/** @type {any} */ p) => p.species),
    ['atrovirens', 'dioica', 'membranacea', '× oblongata', '× tremolsii', 'urens']);
  const orchids = find('', { sort: 'species', filters: { family: ['Orchidaceae'] } });
  assert.deepEqual(names(orchids), ['Dactylorhiza x ampolai', 'Ophrys x barbaricina', 'Dactylorhiza brennensis', 'Traunsteinera globosa',
    'Ophrys holosericea', 'Ophrys x jarigei', 'Epipactis leptochila', 'x Serapicamptis mutata', 'Ophrys x souliei', 'Orchis x spuria',
    'x Dactylodenia st-quintinii']);
  const reversed = find('', { sort: '-species', filters: { family: ['Orchidaceae'] } });
  assert.equal(reversed.sort, '-species');
  assert.deepEqual(names(reversed), names(orchids).reverse());
  assert.deepEqual(names(find('', { sort: '-species' })), names(species).reverse());
  // One epithet, several genera: by genus.
  const officinale = species.items.filter((/** @type {any} */ p) => p.species === 'officinale').map((/** @type {any} */ p) => p.genus);
  assert.equal(officinale.length, 3);
  assert.deepEqual(officinale, [...officinale].sort((a, b) => collator.compare(a, b)));
});

test('un hybride rangé à son nom dans les tris scientifique, genre et famille, et leurs inverses', () => {
  const around = (/** @type {string[]} */ list, /** @type {string} */ name) => list.slice(list.indexOf(name) - 1, list.indexOf(name) + 2);
  const sci = names(find('', { sort: 'sci' }));
  assert.deepEqual(around(sci, 'x Dactylodenia st-quintinii'), ['Daboecia cantabrica', 'x Dactylodenia st-quintinii', 'Dactylorhiza x ampolai']);
  assert.deepEqual(around(sci, 'x Serapicamptis mutata'), ['Senecio sarracenicus', 'x Serapicamptis mutata', 'Seseli annuum']);
  assert.deepEqual(around(sci, 'Urtica x oblongata'), ['Urtica membranacea', 'Urtica x oblongata', 'Urtica x tremolsii']);
  assert.deepEqual(around(names(find('', { sort: '-sci' })), 'x Dactylodenia st-quintinii'), ['Dactylorhiza x ampolai', 'x Dactylodenia st-quintinii', 'Daboecia cantabrica']);
  const genus = find('', { sort: 'genus' }).items.map((/** @type {any} */ p) => p.genus);
  assert.equal(genus[0], 'Acanthus', 'les genres hybrides ne passent pas devant');
  assert.deepEqual(around(genus, '× Dactylodenia'), ['Daboecia', '× Dactylodenia', 'Dactylorhiza']);
  assert.deepEqual(around(find('', { sort: '-genus' }).items.map((/** @type {any} */ p) => p.genus), '× Serapicamptis'), ['Seseli', '× Serapicamptis', 'Senecio']);
  assert.deepEqual(names(find('', { sort: 'family', filters: { family: ['Orchidaceae'] } })), ['x Dactylodenia st-quintinii', 'Dactylorhiza x ampolai',
    'Dactylorhiza brennensis', 'Epipactis leptochila', 'Ophrys x barbaricina', 'Ophrys holosericea', 'Ophrys x jarigei', 'Ophrys x souliei',
    'Orchis x spuria', 'x Serapicamptis mutata', 'Traunsteinera globosa']);
  // Without a French name, last in the French sort: in scientific order.
  const fr = find('').items;
  const tail = fr.slice(fr.findIndex((/** @type {any} */ p) => !p.vernacularName)).map((/** @type {any} */ p) => p.scientificName);
  assert.deepEqual(tail, sci.filter(n => tail.includes(n)));
});

test('sans nom français, un hybride parmi ceux de son genre, à son épithète ; un même nom écrit des deux façons, l’hybride après', () => {
  const plant = (/** @type {number} */ id, /** @type {string} */ scientificName, /** @type {string} */ genus, /** @type {string} */ species, more = {}) =>
    ({ id, scientificName, genus, species, family: 'Rosaceae', ...more });
  // Each hybrid before its look-alike here: the order below is the sort's, not the list's kept (a stable sort).
  const small = buildIndex([
    plant(1, 'Rosa canina', 'Rosa', 'canina'),
    plant(2, 'Rosa x andegavensis', 'Rosa', '× andegavensis'),
    plant(3, 'Rosa agrestis', 'Rosa', 'agrestis', { vernacularNames: ['Rosier des haies'] }),
    plant(4, 'Mentha x piperita', 'Mentha', '× piperita', { family: 'Lamiaceae' }),
    plant(5, 'Mentha piperita', 'Mentha', 'piperita', { family: 'Lamiaceae' }),
    plant(6, 'x Pyronia veitchii', '× Pyronia', 'veitchii'),
    plant(7, 'Pyronia zeta', 'Pyronia', 'zeta')
  ]);
  const ids = (/** @type {string} */ sort) => search(small, { q: '', filters: NONE, sort }).items.map((/** @type {any} */ p) => p.id);
  // « Rosa x andegavensis » at « andegavensis », before « Rosa canina » (written so, it came after: « x » > « c »).
  assert.deepEqual(ids('fr'), [3, 5, 4, 6, 7, 2, 1], 'the French name first, then in scientific order');
  assert.deepEqual(ids('sci'), [5, 4, 6, 7, 3, 2, 1]);
  // « × Pyronia » and « Pyronia »: two genera, not one — the hybrid after, its plants not among the other's.
  assert.deepEqual(ids('genus'), [5, 4, 7, 6, 3, 2, 1]);
  assert.deepEqual(ids('species'), [3, 2, 1, 5, 4, 6, 7]);
});

test('un tri inconnu (adresse écrite à la main) : l’ordre français, dit tel', () => {
  const fr = find('').items.map((/** @type {any} */ p) => p.id);
  for (const sort of ['__proto__', '-__proto__', 'constructor', 'hasOwnProperty', 'toString', 'n-importe-quoi']) {
    const r = find('', { sort });
    assert.equal(r.sort, 'fr', sort);
    assert.deepEqual(r.items.map((/** @type {any} */ p) => p.id), fr, sort);
  }
});

test('tri « Plus observées » : les observations de la zone d’abord, puis le nom français ; sans elles, le nom français, dit', () => {
  const id = (/** @type {string} */ sci) => /** @type {any} */ (plants.find((/** @type {any} */ p) => p.scientificName === sci)).id;
  const zone = ['Urtica dioica', 'Allium ursinum', 'Geum urbanum', 'Bellis perennis'].map(id);
  const observed = { [id('Allium ursinum')]: 9, [id('Geum urbanum')]: 3, [id('Urtica dioica')]: 3, [id('Bellis perennis')]: 1 };
  const run = (/** @type {string} */ sort, /** @type {any} */ o = observed) => search(index, { q: '', filters: NONE, sort, only: zone, observed: o });
  const most = run('obs');
  assert.equal(most.sort, 'obs');
  assert.equal(most.counted, true);
  // Ties (3 each): by French name — Benoîte des villes before Ortie dioïque.
  assert.deepEqual(names(most), ['Allium ursinum', 'Geum urbanum', 'Urtica dioica', 'Bellis perennis']);
  assert.deepEqual(names(run('-obs')), ['Bellis perennis', 'Urtica dioica', 'Geum urbanum', 'Allium ursinum'], 'the least observed first');
  // No counts (Flore, the whole flora): the French name's order, and the answer says so.
  const none = run('obs', null);
  assert.deepEqual([none.sort, none.counted], ['fr', false]);
  assert.deepEqual(names(none), names(run('fr')));
  assert.equal(find('', { sort: 'obs' }).sort, 'fr');
});

test('ce que montre une carte de la zone (within) : la liste, son nombre, ses facettes et son ordre ; la zone entière à part (inZone), dans le même ordre', () => {
  const id = (/** @type {string} */ sci) => /** @type {any} */ (plants.find((/** @type {any} */ p) => p.scientificName === sci)).id;
  const zone = ['Urtica dioica', 'Allium ursinum', 'Geum urbanum', 'Bellis perennis'].map(id);
  const view = ['Allium ursinum', 'Bellis perennis'].map(id);
  const observed = { [id('Allium ursinum')]: 9, [id('Geum urbanum')]: 3, [id('Urtica dioica')]: 3, [id('Bellis perennis')]: 1 };
  const all = search(index, { q: '', filters: NONE, sort: 'obs', only: zone, observed });
  const kept = search(index, { q: '', filters: NONE, sort: 'obs', only: zone, observed, within: view });
  assert.equal(all.inZone, null, 'no view: no zone said apart');
  assert.deepEqual(names(kept), ['Allium ursinum', 'Bellis perennis']);
  assert.equal(kept.total, 2);
  // Its facets count its plants only; the zone's, all of them, in the list's order.
  assert.equal(Object.values(kept.facets.photo).reduce((a, b) => a + b, 0), 2);
  assert.deepEqual(kept.inZone, all.items.map((/** @type {any} */ p) => p.id));
  // A filter: both keep to it.
  const family = /** @type {any} */ (plants.find((/** @type {any} */ p) => p.scientificName === 'Allium ursinum')).family;
  const filtered = search(index, { q: '', filters: { ...NONE, family: [family] }, sort: 'fr', only: zone, within: view });
  assert.deepEqual(names(filtered), ['Allium ursinum']);
  assert.deepEqual(filtered.inZone, [id('Allium ursinum')]);
  // Nothing of the zone in view: none listed, the zone's still said.
  const none = search(index, { q: '', filters: NONE, sort: 'fr', only: zone, within: [] });
  assert.deepEqual([none.total, none.inZone?.length], [0, 4]);
  // Without a zone (the whole flora), a view means nothing.
  assert.equal(search(index, { q: '', filters: NONE, sort: 'fr', within: view }).total, plants.length);
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
