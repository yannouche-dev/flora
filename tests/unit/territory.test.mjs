// « Ma région » of a map (app/core/territory.js mapRegion): the region chosen in Réglages first, else the one where the
// point is — both found in the bundled outlines (data/territories.json): nothing asked of a service; none outside
// metropolitan France; each region of Réglages its outline, so its framing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundledOutline, mapRegion, setMyRegion, territories } from '../../app/core/territory.js';

/** Runs `run`, noting every request but the repository's files (file: URLs). @param {() => Promise<void>} run */
async function offline(run) {
  const fetch = globalThis.fetch;
  /** @type {string[]} */
  const asked = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('file:')) asked.push(url);
    return fetch(input, init);
  };
  try { await run(); } finally { globalThis.fetch = fetch; }
  return asked;
}

test('« Ma région » d’une carte : sans région choisie, celle du point, trouvée sans réseau ; aucune hors métropole', async () => {
  setMyRegion(null);
  const asked = await offline(async () => {
    assert.deepEqual(await mapRegion([2.35, 48.85]),
      { iso: 'FR-IDF', name: 'Île-de-France', box: (await bundledOutline('region', 'Île-de-France'))?.box, chosen: false });
    assert.equal(await mapRegion(null), null);
    assert.equal(await mapRegion([-61.5, 16.2]), null, 'la Guadeloupe');
    assert.equal(await mapRegion([-30, 40]), null, 'en mer');
  });
  assert.deepEqual(asked, [], 'rien n’est envoyé');
});

test('« Ma région » d’une carte : celle de Réglages d’abord, où que l’on soit ; un code inconnu, celle du point', async () => {
  try {
    setMyRegion('FR-BRE');
    for (const point of [[2.35, 48.85], null, [-61.5, 16.2]]) {
      const r = await mapRegion(/** @type {any} */ (point));
      assert.deepEqual([r?.iso, r?.name, r?.chosen], ['FR-BRE', 'Bretagne', true], JSON.stringify(point));
    }
    setMyRegion('FR-XXX');
    const r = await mapRegion([2.35, 48.85]);
    assert.deepEqual([r?.iso, r?.chosen], ['FR-IDF', false]);
  } finally {
    setMyRegion(null);
  }
});

test('chaque région de Réglages a son contour, donc son cadrage', async () => {
  try {
    for (const region of (await territories()).regions) {
      setMyRegion(region.iso);
      const r = await mapRegion(null);
      assert.ok(r, region.name);
      assert.equal(r.name, region.name);
      const [w, s, e, n] = r.box;
      assert.ok(w < e && s < n && w >= -6 && e <= 10 && s >= 41 && n <= 52, region.name + ' ' + r?.box);
    }
  } finally {
    setMyRegion(null);
  }
});
