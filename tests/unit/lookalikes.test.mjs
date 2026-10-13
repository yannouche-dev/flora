// app/core/lookalikes.js: the warnings of the harvest (Anses and Centres antipoison look-alikes, data/lookalikes.json).
// Fail-closed: a list that cannot be read is said, never taken for « no confusion ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { UNREAD_LOOKALIKES, genusOf, lookalikeWarning, lookalikesOf, nameKey } from '../../app/core/lookalikes.js';

const plants = JSON.parse(await readFile(new URL('../fixtures/plants.json', import.meta.url), 'utf8'));
const plant = (/** @type {string} */ name) => {
  const p = plants.find((/** @type {any} */ x) => x.scientificName === name);
  assert.ok(p, name + ' dans le jeu réduit (tests/fixtures)');
  return p;
};

test('fail-closed : fichier illisible → avertissement « liste indisponible », jamais « rien à signaler »', async t => {
  const fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetch; });
  globalThis.fetch = async () => new Response('', { status: 503 });
  assert.deepEqual(await lookalikeWarning(plant('Allium ursinum')), { toxic: true, unread: true, text: UNREAD_LOOKALIKES });
  globalThis.fetch = async () => new Response('{"pairs":[]}', { status: 200 });
  assert.equal((await lookalikeWarning(plant('Urtica dioica')))?.unread, true, 'un fichier sans paire non plus');
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(lookalikesOf(plant('Allium ursinum')));
});

test('ail des ours (comestible) : à ne pas confondre avec le colchique, mortel', async () => {
  const w = await lookalikeWarning(plant('Allium ursinum'));
  assert.equal(w?.toxic, false);
  assert.match(w?.text || '', /^Ne pas confondre avec : /);
  assert.match(w?.text || '', /Colchique \(mortel\)/);
});

test('colchique (toxique, désigné par son genre) : plante mortelle, confondue avec l’ail des ours', async () => {
  const w = await lookalikeWarning(plant('Colchicum autumnale'));
  assert.equal(w?.toxic, true);
  assert.match(w?.text || '', /^Plante mortelle, confondue avec : .*Ail des ours/);
});

test('les paires mortelles d’abord ; une plante sans confusion connue : rien', async () => {
  const list = await lookalikesOf(plant('Daucus carota'));
  assert.ok(list.length > 0);
  const severities = list.map(l => l.pair.severity);
  assert.deepEqual(severities, [...severities].sort((a, b) => Number(b === 'mortel') - Number(a === 'mortel')));
  assert.ok(list.every(l => l.sources.length > 0), 'chaque paire cite sa source');
  assert.equal(await lookalikeWarning(plant('Geum urbanum')), null);
  assert.deepEqual(await lookalikesOf({}), []);
});

test('nameKey et genusOf : auteurs, casse et hybrides laissés de côté', () => {
  assert.equal(nameKey('Colchicum autumnale L., 1753'), 'colchicum autumnale');
  assert.equal(nameKey('Colchicum L.'), 'colchicum');
  assert.equal(nameKey('Mentha × piperita L.'), 'mentha x piperita');
  assert.equal(nameKey('Molopospermum Peloponnesiacum (L.) W.D.J.Koch'), 'molopospermum peloponnesiacum');
  assert.equal(genusOf('Digitalis L.'), 'Digitalis');
  assert.equal(genusOf('Digitalis purpurea L.'), null);
});
