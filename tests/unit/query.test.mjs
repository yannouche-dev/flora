// app/core/query.js (search state ↔ #/?q=…&family=…) and app/core/router.js (address → screen): the addresses a user
// bookmarks or shares, read back the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeFilterCount, fromHash, toHash } from '../../app/core/query.js';
import { href, parse } from '../../app/core/router.js';

test('fromHash ↔ toHash : aller-retour stable, filtres multiples et tri', () => {
  const q = fromHash('#/?q=ortie&family=Urticaceae,Rosaceae&status=I,J&photo=avec&sort=sci');
  assert.equal(q.q, 'ortie');
  assert.deepEqual(q.filters.family, ['Urticaceae', 'Rosaceae']);
  assert.deepEqual(q.filters.status, ['I', 'J']);
  assert.equal(q.sort, 'sci');
  assert.equal(activeFilterCount(q), 5);
  // The facets in their fixed order (mine, status, legal, family…), whatever the order typed.
  assert.equal(toHash(q), '#/?q=ortie&status=I,J&family=Urticaceae,Rosaceae&photo=avec&sort=sci');
  assert.deepEqual(fromHash(toHash(q)), q);
});

test('fromHash tolère les adresses vides ou bancales', () => {
  assert.equal(toHash(fromHash('#/')), '#/');
  assert.equal(toHash(fromHash('')), '#/');
  assert.deepEqual(fromHash('#/?family=, ,Rosaceae,').filters.family, ['Rosaceae']);
  assert.equal(fromHash('#/?q=pr%C3%AAle').q, 'prêle');
  assert.equal(fromHash('#/?q=a+b').q, 'a b');
  assert.equal(activeFilterCount(fromHash('#/?bogus=1')), 0);
});

test('toHash encode le texte (espaces, accents, &)', () => {
  const hash = toHash({ q: 'ail & ours', filters: fromHash('#/').filters, sort: '' });
  assert.equal(hash, '#/?q=ail+%26+ours');
  assert.equal(fromHash(hash).q, 'ail & ours');
});

test('parse : chaque écran de l’app et ses paramètres', () => {
  assert.deepEqual(parse('#/'), { name: 'search' });
  assert.deepEqual(parse('#/plant/128268'), { name: 'plant', id: 128268, pane: null, at: null });
  assert.deepEqual(parse('#/plant/128268?pane=media&i=2'), { name: 'plant', id: 128268, pane: 'media', at: 2 });
  assert.deepEqual(parse('#/plant/1?media=3'), { name: 'plant', id: 1, pane: 'media', at: 3 }, 'ancien lien ?media=');
  assert.equal(parse('#/plant/1?pane=<script>').pane, null);
  assert.deepEqual(parse('#/discover'), { name: 'discover' });
  assert.deepEqual(parse('#/discover?s=inconnu'), { name: 'discover' });
  // Rencontres, the Parcours, Cueillette prudente and Mosaïque are mini-apps: their old addresses open them (a plant
  // open there: over the cards).
  // (Rencontres' plant then was open in its sheet: &fiche=1 now.)
  const none = { view: null, media: null, sheet: false };
  assert.deepEqual(parse('#/discover?s=trail'), { name: 'app', id: 'parcours', step: null, plant: null, ...none });
  assert.deepEqual(parse('#/discover?s=meet&p=12'), { name: 'app', id: 'rencontres', step: 'cards', plant: 12, ...none, sheet: true });
  assert.deepEqual(parse('#/discover?p=12'), { name: 'app', id: 'rencontres', step: 'cards', plant: 12, ...none, sheet: true });
  assert.deepEqual(parse('#/discover?s=harvest'), { name: 'app', id: 'cueillette', step: null, plant: null, ...none });
  assert.deepEqual(parse('#/discover?s=mosaic&p=5'), { name: 'app', id: 'mosaique', step: 'cards', plant: 5, ...none });
  assert.deepEqual(parse('#/app/parcours/walk?p=3'), { name: 'app', id: 'parcours', step: 'walk', plant: 3, ...none });
  assert.equal(parse('#/app/Parcours').name, 'not-found');
  assert.equal(href.app('rencontres', 'cards', 7), '#/app/rencontres/cards?p=7');
  assert.deepEqual(parse('#/discover?s=../x'), { name: 'discover' });
  assert.deepEqual(parse('#/collection/new?kind=list'), { name: 'spot-new', plant: null, kind: 'list', at: null });
  assert.deepEqual(parse('#/spot/new?at=48.85,2.35').at, [2.35, 48.85], 'ancien lien spot/');
  assert.deepEqual(parse('#/map?plant=12&season=1'), { name: 'map', spot: null, plants: [12], focus: null, season: true, add: null, pick: false });
  // An older link of Flore's results (« from=flore »): the Carte, on what else it says.
  assert.deepEqual(parse('#/map?plant=12&from=flore'), parse('#/map?plant=12'));
  assert.deepEqual(parse('#/map?plant=x').plants, []);
  // The Carte's plant filter in its address: each plant once, in the order given; plants= over an older plant=.
  assert.deepEqual(parse('#/map?plants=12,7,12,x').plants, [12, 7]);
  assert.deepEqual(parse('#/map?plants=7&plant=12').plants, [7]);
  assert.equal(href.map({ plants: [12, 7], season: true }), '#/map?plants=12,7&season=1');
  assert.equal(href.map({ spot: 'p1', plants: [] }), '#/map?spot=p1');
  assert.deepEqual(parse('#/shared?d=zABC'), { name: 'shared', data: 'zABC' });
  assert.equal(parse('#/nope').name, 'not-found');
  assert.equal(parse('#/plant/abc').name, 'not-found');
});

test('une activité : l’adresse dit tout l’écran (la plante, la vue, l’image, la fiche), dans un ordre', () => {
  // The whole screen of Rencontres: the plant chosen, the view of its list, the image shown, its sheet open.
  assert.deepEqual(parse('#/app/rencontres/cards?p=125677&v=matchs&m=14&fiche=1'),
    { name: 'app', id: 'rencontres', step: 'cards', plant: 125677, view: 'matchs', media: 14, sheet: true });
  // One address per screen: the parameters in one order, the defaults left out (no view: its own; the first image).
  assert.equal(href.app('rencontres', 'cards', 125677, { view: 'matchs', media: 14, sheet: true }), '#/app/rencontres/cards?p=125677&v=matchs&m=14&fiche=1');
  assert.equal(href.app('rencontres', 'cards', 125677, { view: null, media: 0, sheet: false }), '#/app/rencontres/cards?p=125677');
  assert.equal(href.app('rencontres', 'cards', null, { view: 'toutes' }), '#/app/rencontres/cards?v=toutes');
  assert.equal(href.app('rencontres'), '#/app/rencontres');
  // And back: what href writes, parse reads (in any order of its parameters).
  for (const more of [{}, { view: 'toutes' }, { media: 3 }, { sheet: true }, { view: 'matchs', media: 2, sheet: true }]) {
    const h = href.app('rencontres', 'cards', 81541, more);
    const r = /** @type {any} */ (parse(h));
    assert.deepEqual({ view: r.view, media: r.media, sheet: r.sheet }, { view: null, media: null, sheet: false, ...more }, h);
    assert.equal(href.app(r.id, r.step, r.plant, r), h);
  }
  assert.deepEqual(parse('#/app/rencontres/cards?fiche=1&m=2&v=toutes&p=9'), parse('#/app/rencontres/cards?p=9&v=toutes&m=2&fiche=1'));
  // What is not one: left out (a view of letters only, a number for the image; &fiche= is 1 or nothing).
  const odd = /** @type {any} */ (parse('#/app/rencontres/cards?p=x&v=<b>&m=-1&fiche=yes'));
  assert.deepEqual([odd.plant, odd.view, odd.media, odd.sheet], [null, null, null, false]);
  assert.equal(/** @type {any} */ (parse('#/app/rencontres/cards?m=0')).media, null, 'la première image : rien à dire');
});

test('href et parse s’accordent', () => {
  assert.equal(parse(href.search()).name, 'search');
  for (const [name, fn] of Object.entries(href)) {
    if (typeof fn !== 'function' || fn.length) continue;
    const hash = /** @type {() => string} */ (fn)();
    assert.notEqual(parse(hash).name, 'not-found', `href.${name}() → ${hash}`);
  }
});
