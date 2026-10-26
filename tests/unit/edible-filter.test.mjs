// app/core/lookalikes.js#edibleFilter: the one « comestible » filter of the plant sheet (gf-lookalikes), Faux amis
// (kit/faux-amis.js) and the cards of the games (kit/cards.js, through danger.js): never a criterion that says a plant
// can be eaten, and « partie consommée » only for the species a source names — never through its genus. Here a
// look-alikes file of our own: a pair naming Symphytum officinale, another the whole genus (the Anses' « Consoude »).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { edibleFilter, lookalikeData, lookalikesOf } from '../../app/core/lookalikes.js';
import { dangerLevel } from '../../app/core/danger.js';
import { bio } from '../../app/miniapp/kit/cards.js';
import { cluesOf } from '../../app/miniapp/kit/faux-amis.js';

const plants = JSON.parse(await readFile(new URL('../fixtures/plants.json', import.meta.url), 'utf8'));
const officinale = plants.find((/** @type {any} */ p) => p.scientificName === 'Symphytum officinale');
// Not in the reduced flora: its record as the flora has it (TAXREF 125364, data/safety.json).
const tuberosum = { id: 125364, scientificName: 'Symphytum tuberosum', genus: 'Symphytum', species: 'tuberosum', statuses: [] };
const real = JSON.parse(await readFile(new URL('../../data/lookalikes.json', import.meta.url), 'utf8'));

const FILE = {
  sources: {},
  pairs: [
    { toxic: [{ taxon: 'Digitalis', label: 'Digitale' }], edible: [{ taxon: 'Symphytum', label: 'Consoude' }], part: 'feuilles', severity: 'mortel',
      tell: ['Confusion des feuilles, surtout quand la digitale n’est pas fleurie.'], sources: [] },
    { toxic: [{ taxon: 'Digitalis purpurea', label: 'Digitale pourpre' }], edible: [{ taxon: 'Symphytum officinale', label: 'Consoude officinale' }], part: 'feuilles',
      severity: 'mortel', tell: ['Seule la consoude officinale est comestible ; la digitale est mortelle.', 'Consoude officinale : feuilles rudes au toucher.'], sources: [] }
  ]
};
const fetch = globalThis.fetch;
globalThis.fetch = async (input, init) => String(input instanceof Request ? input.url : input).endsWith('/data/lookalikes.json')
  ? new Response(JSON.stringify(FILE), { status: 200 }) : fetch(input, init);

test('le genre ne nomme aucune espèce : Symphytum tuberosum n’a que la confusion ; officinale, nommée, sa partie', async () => {
  assert.equal((await lookalikeData()).pairs.length, 2);
  const tub = await lookalikesOf(tuberosum), off = await lookalikesOf(officinale);
  assert.deepEqual(tub.map(l => [l.pair.toxic[0].taxon, l.named]), [['Digitalis', false]]);
  assert.deepEqual(off.map(l => [l.pair.toxic[0].taxon, l.named]), [['Digitalis', false], ['Digitalis purpurea', true]]);
  assert.deepEqual(tub.map(l => edibleFilter(l).part), [null]);
  assert.deepEqual(off.map(l => edibleFilter(l).part), [null, 'feuilles']);
  // The toxic side never has a part to pick.
  assert.equal(edibleFilter({ ...off[1], side: 'toxic' }).part, null);
  // The verdict: the confusion counted for both; the part only for the species named.
  const vt = dangerLevel({ confusions: tub }), vo = dangerLevel({ confusions: off });
  assert.deepEqual([vt.word, vt.eaten], ['Sosie mortel', []]);
  assert.deepEqual(vo.eaten, ['feuilles']);
});

test('les cartes : par le genre, la confusion seule, « avant toute cueillette » ; l’espèce nommée, sa partie et « à table »', async () => {
  const card = (/** @type {any} */ p, /** @type {any} */ confusions) => ({ plant: p, count: 10, photo: null, credit: null, blooming: false, verdict: dangerLevel({ statuses: p.statuses, confusions }) });
  const tub = bio(card(tuberosum, await lookalikesOf(tuberosum)), new Set());
  assert.ok(tub.includes('⚠️ J’ai des sosies toxiques (1). Lisez ma fiche avant toute cueillette.'), tub.join('\n'));
  assert.ok(!tub.some(l => /consommée|à table/.test(l)));
  // Officinale with no toxicity data here (the pure verdict): the part the source names, « à table ».
  const off = bio(card({ ...officinale, statuses: [] }, await lookalikesOf(officinale)), new Set());
  assert.ok(off.includes('🍽️ Partie consommée selon l’Anses : feuilles. J’ai des sosies toxiques (2) : lisez ma fiche avant de passer à table.'), off.join('\n'));
});

test('un seul filtre des critères : la fiche et Faux amis taisent « … est comestible »', () => {
  const pair = FILE.pairs[1];
  assert.deepEqual(edibleFilter({ pair }).criteria, ['Consoude officinale : feuilles rudes au toucher.']);
  assert.deepEqual(cluesOf(/** @type {any} */ (pair)).map(c => c.text), ['Feuilles rudes au toucher.']);
  // The real file: the laurier rose's only criterion says the laurier sauce is eaten — never shown, never a clue.
  const laurier = real.pairs.find((/** @type {any} */ p) => p.toxic[0].taxon === 'Nerium oleander');
  assert.deepEqual(edibleFilter({ pair: laurier }).criteria, []);
  assert.deepEqual(cluesOf(laurier), []);
  for (const p of real.pairs) for (const t of edibleFilter({ pair: p }).criteria) assert.doesNotMatch(t, /comestible|consomm|se mange/i);
});
