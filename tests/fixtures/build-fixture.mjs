// The reduced flora of the tests (audit TEST-18): about 300 plants of data/plants.json, chosen so that the specs and the
// unit tests find what they look for — the plants of the scenarios (ortie, ail des ours, colchique, aconit…), both
// sides of every look-alike pair (data/lookalikes.json), protected plants, a few large genera for the search (Allium,
// Taraxacum, Prunus) — and filled up with an even sample of the rest. Written with a matching meta.json (sha256 and
// count, as scripts/fingerprint-dataset.mjs sets them), so the app takes it as the published flora: the e2e specs serve
// both instead of data/ (tests/e2e/fixtures.mjs), and every test loads 0.3 MB instead of 11.5 MB.
// Same licence as data/plants.json (data/LICENSE). Rebuilt by hand when the flora's shape changes:
//   node tests/fixtures/build-fixture.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { fingerprint } from '../../scripts/fingerprint-dataset.mjs';

const ROOT = new URL('../../', import.meta.url);
const OUT = new URL('./', import.meta.url);
const SIZE = 300;

/** Species the tests name (scientific names without author). */
const NAMED = [
  'Urtica dioica', 'Urtica urens', 'Allium ursinum', 'Allium polyanthum', 'Allium vineale', 'Allium acutiflorum',
  'Allium narcissiflorum', 'Allium oleraceum', 'Colchicum autumnale', 'Aconitum napellus', 'Conium maculatum',
  'Geum urbanum', 'Taraxacum officinale', 'Prunus spinosa', 'Prunus avium', 'Prunus laurocerasus', 'Quercus robur',
  'Hedera helix', 'Galium aparine', 'Plantago lanceolata', 'Bellis perennis', 'Ranunculus acris', 'Trifolium repens',
  'Digitalis purpurea', 'Atropa bella-donna', 'Veratrum album', 'Gentiana lutea', 'Arum maculatum',
  'Convallaria majalis', 'Sambucus nigra', 'Sambucus ebulus', 'Daucus carota', 'Oenanthe crocata', 'Aethusa cynapium',
  'Petroselinum crispum', 'Datura stramonium', 'Vaccinium myrtillus', 'Laburnum anagyroides', 'Robinia pseudoacacia',
  'Symphytum officinale', 'Rumex acetosa', 'Castanea sativa', 'Aesculus hippocastanum', 'Lonicera nigra',
  'Ribes nigrum', 'Vitis vinifera', 'Laurus nobilis', 'Nerium oleander', 'Rosa canina', 'Crataegus monogyna',
  'Rubus fruticosus', 'Mentha aquatica', 'Thymus vulgaris', 'Achillea millefolium', 'Papaver rhoeas',
  'Viola odorata', 'Primula veris', 'Leucanthemum vulgare', 'Salvia pratensis'
];
/** Genera named by the look-alikes file (« Digitalis sp. »), and genera the search tests browse: at most this many each. */
const GENERA = { Colchicum: 4, Arum: 3, Digitalis: 3, Veratrum: 2, Rumex: 4, Symphytum: 3, Vaccinium: 3, Allium: 14, Taraxacum: 8, Prunus: 8, Urtica: 4 };
/** Plants protected nationally (PN), for the protection facet and banners. */
const PROTECTED = 20;

const plants = JSON.parse(await readFile(new URL('data/plants.json', ROOT), 'utf8'));
const meta = JSON.parse(await readFile(new URL('data/meta.json', ROOT), 'utf8'));
const lookalikes = JSON.parse(await readFile(new URL('data/lookalikes.json', ROOT), 'utf8'));

/** @type {Map<number, any>} */
const chosen = new Map();
const take = (/** @type {any} */ p) => { if (p && chosen.size < SIZE) chosen.set(p.id, p); };

const byName = new Map(plants.map((/** @type {any} */ p) => [p.scientificName, p]));
const missing = [];
for (const name of NAMED) byName.has(name) ? take(byName.get(name)) : missing.push(name);
for (const pair of lookalikes.pairs) for (const t of [...pair.toxic, ...pair.edible]) {
  if (t.taxon.includes(' ')) take(byName.get(t.taxon));
  else GENERA[t.taxon] ??= 3;
}
for (const [genus, count] of Object.entries(GENERA)) {
  plants.filter((/** @type {any} */ p) => p.genus === genus && !chosen.has(p.id)).slice(0, count).forEach(take);
}
plants.filter((/** @type {any} */ p) => !chosen.has(p.id) && p.statuses?.some((/** @type {any} */ s) => s.type === 'PN'))
  .filter((/** @type {any} */ _, /** @type {number} */ i) => i % 7 === 0).slice(0, PROTECTED).forEach(take);
// The rest: an even sample of the flora (every n-th plant, in the file's order), with a photo or without.
const rest = plants.filter((/** @type {any} */ p) => !chosen.has(p.id));
const step = Math.max(1, Math.floor(rest.length / (SIZE - chosen.size)));
for (let i = 0; chosen.size < SIZE && i < rest.length; i += step) take(rest[i]);

// The file's order (by family, then name), one plant per line: small diffs when it is rebuilt.
const list = plants.filter((/** @type {any} */ p) => chosen.has(p.id));
const text = '[\n' + list.map((/** @type {any} */ p) => JSON.stringify(p)).join(',\n') + '\n]\n';
const out = {
  ...meta,
  fixture: 'tests/fixtures/build-fixture.mjs: a sample of data/plants.json, for the tests only',
  generatedAt: '2026-01-01T00:00:00.000Z',
  sha256: fingerprint(text),
  plants: list.length,
  families: new Set(list.map((/** @type {any} */ p) => p.family)).size,
  genera: new Set(list.map((/** @type {any} */ p) => p.genus)).size
};
for (const key of ['plantsWithFrenchNames', 'vernacularNames', 'synonyms', 'plantsWithSynonyms', 'plantsWithoutFrenchNames']) delete out[key];
await writeFile(new URL('plants.json', OUT), text);
await writeFile(new URL('meta.json', OUT), JSON.stringify(out, null, 2) + '\n');
console.log(`tests/fixtures: ${list.length} plants, ${out.families} families, ${(text.length / 1024).toFixed(0)} KB, sha256 ${out.sha256}`);
if (missing.length) console.log('not in the flora (left out):', missing.join(', '));
