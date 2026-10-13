// scripts/build-safety.mjs and scripts/check-confusions.mjs: how the toxicity sources attach to the flora's plants
// (never through a synonym several plants carry, DATA-4; list B genera carried to the genera split from them,
// DATA-14), TPPT read in French (SAFE-14), and the reference list of confusions against lookalikes.json, with the
// pairs' severity against TPPT (SAFE-2, SAFE-5, SAFE-13).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  NAME_LINKS, PARTS_WORDS, TOXICITY_LABELS, extendSplitGenera, indexPlants, linkTppt, matchAnsm, partsFr, retranslate, toxicity
} from '../../scripts/build-safety.mjs';
import { checkConfusions } from '../../scripts/check-confusions.mjs';

const json = async (/** @type {string} */ path) => JSON.parse(await readFile(new URL('../../' + path, import.meta.url), 'utf8'));
const [plants, safety, lookalikes, reference] = await Promise.all(['data/plants.json', 'data/safety.json', 'data/lookalikes.json', 'data/confusions-reference.json'].map(json));

/** A small flora: two plants sharing a synonym, a species and its hybrid, a split genus. */
const flora = [
  { id: 1, genus: 'Ficaria', scientificName: 'Ficaria ambigua', synonyms: ['Ranunculus ficaria'] },
  { id: 98651, genus: 'Ficaria', scientificName: 'Ficaria verna', synonyms: ['Ranunculus ficaria', 'Ficaria bulbifera'] },
  { id: 3, genus: 'Vicia', scientificName: 'Vicia disperma', synonyms: ['Vicia parviflora'] },
  { id: 4, genus: 'Ervum', scientificName: 'Ervum gracile', synonyms: ['Vicia parviflora'] },
  { id: 5, genus: 'Arum', scientificName: 'Arum italicum x Arum maculatum', synonyms: [] },
  { id: 6, genus: 'Arum', scientificName: 'Arum italicum', synonyms: [] },
  { id: 7, genus: 'Senecio', scientificName: 'Senecio vulgaris', synonyms: [] },
  { id: 8, genus: 'Jacobaea', scientificName: 'Jacobaea vulgaris', synonyms: ['Senecio jacobaea'] },
  { id: 9, genus: 'Ajuga', scientificName: 'Ajuga reptans', synonyms: ['Teucrium reptans'] },
  { id: 10, genus: 'Teucrium', scientificName: 'Teucrium chamaedrys', synonyms: [] }
];

test('DATA-4 : un synonyme porté par plusieurs plantes ne rattache à aucune, sauf correspondance relue (NAME_LINKS)', () => {
  const index = indexPlants(flora);
  assert.equal(index.byName.get('ranunculus ficaria'), 98651, 'Ranunculus ficaria L. = Ficaria verna (NAME_LINKS)');
  assert.equal(index.byName.get('vicia parviflora'), undefined, 'ambigu, sans correspondance relue : rattaché à personne');
  assert.deepEqual(index.ambiguous.get('vicia parviflora'), [3, 4]);
  assert.equal(index.byName.get('ficaria bulbifera'), 98651, 'un synonyme d’une seule plante la désigne');
  assert.equal(index.byName.get('arum italicum'), 6, 'l’espèce, pas l’hybride qui commence par son nom');
  const skipped = new Set();
  const tppt = linkTppt([{ name: 'Ranunculus ficaria L.' }, { name: 'Vicia parviflora Cav.' }, { name: 'Arum italicum Mill.' }], index, skipped);
  assert.deepEqual([...tppt.keys()].sort((a, b) => a - b), [6, 98651]);
  assert.deepEqual([...skipped], ['Vicia parviflora Cav.']);
});

test('DATA-4 : dans la flore, chaque rattachement ambigu est listé, et les correspondances relues désignent un de ses porteurs', () => {
  const index = indexPlants(plants);
  for (const [key, id] of Object.entries(NAME_LINKS)) {
    assert.ok(plants.some((/** @type {any} */ p) => p.id === id && p.synonyms?.some((/** @type {string} */ s) => s.toLowerCase() === key)), `${key} → ${id}`);
    assert.equal(index.byName.get(key), id);
  }
  // Ficaria verna (Ficaire printanière) carries TPPT « Ranunculus ficaria L. », Ficaria ambigua no longer does.
  assert.equal(safety.plants[98651]?.tppt?.name, 'Ranunculus ficaria L.');
  assert.equal(safety.plants[98643]?.tppt, undefined);
  // Every TPPT entry of safety.json is where its Latin name leads (or kept where it was when the name leads nowhere).
  for (const [id, entry] of Object.entries(safety.plants)) {
    const t = /** @type {any} */ (entry).tppt;
    if (!t) continue;
    const linked = linkTppt([t], index);
    if (linked.size) assert.ok(linked.has(Number(id)), `${t.name} → ${[...linked.keys()]}, pas ${id}`);
  }
});

test('DATA-14 : la liste B « Senecio sp. » couvre aussi les Jacobaea (ex-Senecio), pas les genres reliés par un vieux synonyme', () => {
  const index = indexPlants(flora);
  const rows = [
    { list: 'B', french: 'Séneçons', latin: ['Senecio sp.'], parts: 'partie aérienne', toxicParts: '', except: [] },
    { list: 'B', french: 'Germandrées', latin: ['Teucrium sp.'], parts: 'partie aérienne', toxicParts: '', except: [] }
  ];
  const out = matchAnsm(rows, index);
  assert.equal(out.get(7)?.[0].genus, true);
  assert.equal(out.get(8)?.[0].from, 'Senecio', 'Jacobaea vulgaris, synonyme Senecio jacobaea');
  assert.equal(out.get(9), undefined, 'Ajuga reptans, synonyme Teucrium reptans : genre non relu, pas d’entrée');
  // Idempotent on kept entries.
  assert.equal(extendSplitGenera(out, index).get(8)?.length, 1);
  // In the data: every Jacobaea of the flora has list B.
  const jacobaea = plants.filter((/** @type {any} */ p) => p.genus === 'Jacobaea');
  assert.ok(jacobaea.length > 10);
  for (const p of jacobaea) assert.ok(safety.plants[p.id]?.ansm?.some((/** @type {any} */ a) => a.list === 'B' && a.from === 'Senecio'), p.scientificName);
});

test('SAFE-14 : TPPT en français, jamais adouci ; « unknown » sans niveau ; l’anglais gardé à côté', () => {
  assert.deepEqual(toxicity('very strong toxic'), { level: 4, label: 'très fortement toxique' });
  assert.deepEqual(toxicity('carcinogenic'), { level: 2, label: 'cancérogène' });
  assert.deepEqual(toxicity('unknown'), { level: 0, label: 'toxicité inconnue' });
  assert.deepEqual(toxicity('infested plants only'), { level: 1, label: 'seulement les plantes infestées' });
  assert.deepEqual(toxicity('phototoxic'), { level: 2, label: 'phototoxique' }, 'dit « phototoxique », au niveau qu’il avait');
  assert.deepEqual(toxicity('strong toxic, phototoxic'), { level: 3, label: 'fortement toxique' });
  assert.equal(partsFr('Flowering top, young plant'), 'sommités fleuries, jeune plante');
  assert.equal(partsFr('Whole plant, highest concentrationt in flower, fruit'), 'plante entière, concentrations les plus fortes dans fleurs, fruits');
  assert.equal(partsFr('Fuit, root (or whole plant without)'), 'fruits, racines (ou plante entière sans …)');
  const old = retranslate({ level: 1, levelLabel: 'carcinogenic', parts: 'fleursing top', partsEn: 'Flowering top' });
  assert.deepEqual([old.level, old.levelLabel, old.levelEn, old.parts], [2, 'cancérogène', 'carcinogenic', 'sommités fleuries']);
  // The whole file: labels and parts in French.
  for (const entry of Object.values(safety.plants)) {
    const t = /** @type {any} */ (entry).tppt;
    if (!t) continue;
    assert.ok(t.levelLabel.split(', ').every((/** @type {string} */ l) => TOXICITY_LABELS.includes(l)), t.levelLabel);
    for (const w of String(t.parts || '').toLowerCase().split(/[^\p{L}]+/u).filter(Boolean)) assert.ok(PARTS_WORDS.has(w), `${w} (${t.parts})`);
  }
});

test('SAFE-2 / SAFE-5 / SAFE-13 : les données livrées passent la comparaison avec la liste de référence', () => {
  const { errors, pending } = checkConfusions({ reference, lookalikes, plants, safety });
  assert.deepEqual(errors, []);
  assert.ok(pending.length > 0, 'des pistes restent à vérifier contre une source');
});

test('check-confusions : confusion de référence absente, piste non vérifiée montrée, gravité sous le TPPT, critères manquants', () => {
  const clone = (/** @type {any} */ x) => structuredClone(x);
  const run = (/** @type {any} */ ref, /** @type {any} */ look) => checkConfusions({ reference: ref, lookalikes: look, plants, safety }).errors;
  // A published confusion removed from lookalikes.json.
  const look1 = clone(lookalikes);
  look1.pairs = look1.pairs.filter((/** @type {any} */ p) => p.toxic[0].taxon !== 'Colchicum');
  assert.ok(run(reference, look1).some(e => /misses the reference confusion « colchicum-allium-ursinum »/.test(e)));
  // A confusion still « à vérifier » shown to users.
  const look2 = clone(lookalikes);
  look2.pairs.push({ toxic: [{ taxon: 'Arum', label: 'Arum' }], edible: [{ taxon: 'Allium ursinum', label: 'Ail des ours' }], part: 'feuilles', severity: 'grave', severityFrom: 'tppt', tell: ['x'], symptoms: 'x', sources: ['aide-memoire'] });
  assert.ok(run(reference, look2).some(e => /still « à vérifier », but shown/.test(e)));
  // TPPT level 4 written « toxique » (Grande ciguë).
  const look3 = clone(lookalikes);
  const conium = look3.pairs.find((/** @type {any} */ p) => p.toxic[0].taxon === 'Conium maculatum');
  conium.severity = 'toxique';
  delete conium.severityFrom;
  const errors3 = run(reference, look3);
  assert.ok(errors3.some(e => /TPPT level 4/.test(e)), errors3.join('\n'));
  // « grave » without TPPT level 4 (Marron d'Inde, TPPT 1).
  const look4 = clone(lookalikes);
  Object.assign(look4.pairs.find((/** @type {any} */ p) => p.toxic[0].taxon === 'Aesculus hippocastanum'), { severity: 'grave', severityFrom: 'tppt' });
  assert.ok(run(reference, look4).some(e => /« grave » is TPPT level 4/.test(e)));
  // A deadly pair without criteria, its gap not listed.
  const ref5 = clone(reference);
  delete ref5.confusions.find((/** @type {any} */ c) => c.id === 'datura-stramonium-tetragonia-tetragonoides').gaps;
  assert.ok(run(ref5, lookalikes).some(e => /has no tell/.test(e)));
  // A reference taxon that is no plant of the flora.
  const ref6 = clone(reference);
  ref6.confusions.push({ id: 'x', toxic: ['Plantus inventus'], edible: ['Daucus carota'], status: 'à vérifier' });
  assert.ok(run(ref6, lookalikes).some(e => /Plantus inventus/.test(e)));
});
