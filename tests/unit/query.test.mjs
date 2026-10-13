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
  assert.deepEqual(parse('#/discover?s=trail'), { name: 'discover', plant: null, scenario: 'trail' });
  assert.equal(parse('#/discover?s=../x').scenario, null);
  assert.deepEqual(parse('#/collection/new?kind=list'), { name: 'spot-new', plant: null, kind: 'list', at: null });
  assert.deepEqual(parse('#/spot/new?at=48.85,2.35').at, [2.35, 48.85], 'ancien lien spot/');
  assert.equal(parse('#/map?plant=12&season=1&from=flore').flore, true);
  assert.equal(parse('#/map?plant=x').plant, null);
  assert.deepEqual(parse('#/shared?d=zABC'), { name: 'shared', data: 'zABC' });
  assert.equal(parse('#/nope').name, 'not-found');
  assert.equal(parse('#/plant/abc').name, 'not-found');
});

test('href et parse s’accordent', () => {
  assert.equal(parse(href.search()).name, 'search');
  for (const [name, fn] of Object.entries(href)) {
    if (typeof fn !== 'function' || fn.length) continue;
    const hash = /** @type {() => string} */ (fn)();
    assert.notEqual(parse(hash).name, 'not-found', `href.${name}() → ${hash}`);
  }
});
