// What a link of a sheet shown inside another page is (app/core/embed-links.js hrefKind): a plant — with or without its
// panel (?pane=) —, which each host takes in its own way; another screen of the app or an anchor, left alone; another
// site, which an activity quiets. A Ctrl or ⌘ click, a middle click, is never taken (the browser's way: a new tab) —
// the host's listener lets every click but a first-button one, no key held, go as it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hrefKind } from '../../app/core/embed-links.js';

const here = 'http://localhost/#/app/cueillette/cards?p=12';

test('ce qu’est un lien d’une fiche intégrée', () => {
  assert.deepEqual(hrefKind('#/plant/12', here), { kind: 'plant', id: 12 });
  assert.deepEqual(hrefKind('#/plant/12?pane=uses', here), { kind: 'plant', id: 12 });
  assert.deepEqual(hrefKind('#/plant/12x', here), { kind: 'view' });
  assert.deepEqual(hrefKind('#/?genus=Allium', here), { kind: 'view' });
  assert.deepEqual(hrefKind('#/settings', here), { kind: 'view' });
  assert.deepEqual(hrefKind('#wiki-uses', here), { kind: 'anchor' });
  assert.deepEqual(hrefKind('https://inpn.mnhn.fr/x', here), { kind: 'out' });
  assert.deepEqual(hrefKind('mailto:a@b', here), { kind: 'out' });
  assert.deepEqual(hrefKind('tel:15', here), { kind: 'out' });
  assert.deepEqual(hrefKind('/data/x.json', here), { kind: 'view' });
  assert.equal(hrefKind('', here), null);
});
