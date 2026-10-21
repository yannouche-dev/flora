// app/core/danger.js: one verdict per plant (dangerLevel) — the sheet's Alertes badge and Prudence, the cards of the
// games, « Noter ici » and the place editor read it (core/alerts.js#verdictOf): TPPT « toxique » the same level
// everywhere, the confusions counted, protection at the point, a file that cannot be read never « nothing to fear ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LEVELS, UNREAD, confusionLevel, dangerLevel, harvestStop, rank, reasonLine } from '../../app/core/danger.js';
import { verdictOf } from '../../app/core/alerts.js';
import { lookalikesOf } from '../../app/core/lookalikes.js';

const read = async (/** @type {string} */ path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const [plants, safety] = await Promise.all([read('../fixtures/plants.json'), read('../../data/safety.json')]);
const plant = (/** @type {string} */ name) => {
  const p = plants.find((/** @type {any} */ x) => x.scientificName === name);
  assert.ok(p, name + ' dans le jeu réduit (tests/fixtures)');
  return p;
};
const EATEN = /comestible|consomm|se mange/i;

// First, before a file is read (core/bundled.js keeps a file once read).
test('fail closed : fichiers illisibles → « Toxicité inconnue », au niveau danger, la récolte arrêtée ; jamais « rien »', async t => {
  const fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetch; });
  globalThis.fetch = async () => new Response('', { status: 503 });
  const v = await verdictOf(plant('Bellis perennis'));
  assert.equal(v.unread, true);
  assert.equal(v.level, 'danger');
  assert.equal(v.word, 'Toxicité inconnue');
  assert.equal(v.reasons[0].text, UNREAD);
  assert.ok(harvestStop(v), 'avant une récolte : l’avertissement');
  // Said first, whatever else is known; never below a warning.
  const pure = dangerLevel({ unread: true, statuses: [{ type: 'PR', code: 'X', label: 'Protection régionale', area: 'Picardie', level: '', iso: '' }] });
  assert.equal(pure.reasons[0].kind, 'unread');
  assert.ok(rank(pure.level) >= rank('warn'));
  // A point whose territory could not be read: a regional protection counts there.
  const unknown = dangerLevel({ statuses: [{ type: 'PR', code: 'X', label: 'Protection régionale', area: 'Picardie', level: '', iso: '' }], territory: 'unread' });
  assert.equal(unknown.protected, true);
});

test('rien dans nos sources : « none », sans mot ni raison — jamais « sans danger »', async () => {
  const v = await verdictOf(plant('Bellis perennis'));
  assert.deepEqual({ level: v.level, word: v.word, reasons: v.reasons, harvest: harvestStop(v) }, { level: 'none', word: '', reasons: [], harvest: false });
  assert.deepEqual(LEVELS, ['none', 'info', 'warn', 'danger', 'deadly']);
});

test('TPPT « toxique » (niveau 2) : un danger, « Toxique », le même verdict pour tous les écrans', async () => {
  const two = dangerLevel({ safety: { tppt: { level: 2, levelLabel: 'toxique', parts: 'baies' } } });
  assert.deepEqual([two.level, two.word, two.toxic, harvestStop(two)], ['danger', 'Toxique', true, true]);
  assert.equal(reasonLine(two.reasons[0]), 'Toxicité : toxique — parties toxiques : baies (Agroscope, base TPPT)');
  const one = dangerLevel({ safety: { tppt: { level: 1, levelLabel: 'faiblement toxique' } } });
  assert.deepEqual([one.level, one.toxic, harvestStop(one)], ['warn', false, false]);
  assert.equal(dangerLevel({ safety: { tppt: { level: 3, levelLabel: 'fortement toxique' } } }).word, 'Très toxique');
  // A plant of the flora at TPPT 2: what every screen reads (alerts.js) is the pure verdict on its data.
  const myosotis = plant('Myosotis sylvatica');
  assert.equal(safety.plants[myosotis.id]?.tppt?.level, 2);
  const loaded = await verdictOf(myosotis);
  assert.deepEqual(loaded, dangerLevel({ statuses: myosotis.statuses, safety: safety.plants[myosotis.id], confusions: await lookalikesOf(myosotis) }));
  assert.equal(loaded.reasons.find(r => r.kind === 'tppt')?.level, 'danger');
});

test('ail des ours : les confusions comptent — le colchique mortel donne la couleur, trois raisons', async () => {
  const v = await verdictOf(plant('Allium ursinum'));
  assert.equal(v.level, 'deadly');
  assert.equal(v.word, 'Sosie mortel');
  assert.deepEqual(v.reasons.map(r => [r.kind, r.level]), [['edible-side', 'deadly'], ['edible-side', 'danger'], ['tppt', 'warn']]);
  assert.equal(v.reasons[0].text, 'Ne pas confondre avec Colchique (mortel)');
  // The edible side alone stops no harvest: its look-alikes are said right after it is noted.
  assert.equal(harvestStop(v), false);
  const colchique = await verdictOf(plant('Colchicum autumnale'));
  assert.deepEqual([colchique.level, colchique.word, harvestStop(colchique)], ['deadly', 'Mortelle', true]);
  // One level per confusion, for both sides: a « toxique » pair is a danger for the toxic plant itself.
  const pair = /** @type {any} */ ({ severity: 'toxique' });
  assert.deepEqual([confusionLevel(pair, 'toxic'), confusionLevel(pair, 'edible')], ['danger', 'warn']);
});

test('laurier sauce : parties toxiques nommées (le fruit, ANSM liste A), le sosie très toxique d’abord', async () => {
  const v = await verdictOf(plant('Laurus nobilis'));
  assert.equal(v.word, 'Sosie très toxique');
  assert.ok(harvestStop(v), 'toxic parts: the warning before a harvest, never loosened');
  const parts = v.reasons.find(r => r.kind === 'ansm-a');
  assert.equal(parts && reasonLine(parts), 'Parties toxiques : fruit (ANSM, liste A)');
  assert.equal(v.reasons.some(r => r.kind === 'ansm-b' || (r.kind === 'tppt' && r.level === 'danger')), false, 'not « Plante toxique » as a whole');
});

test('espèce protégée : en France, ou là où elle est notée ; ailleurs seulement, un avertissement', async () => {
  const pn = await verdictOf(plant('Allium chamaemoly'));
  assert.deepEqual([pn.level, pn.word, pn.protected, harvestStop(pn)], ['danger', 'Protégée', true, true]);
  assert.equal(pn.reasons[0].text, 'Espèce protégée en France : cueillette interdite');
  // The colchique: protected in the Haute-Vienne (PD), not in Paris.
  const colchique = plant('Colchicum autumnale');
  const limoges = await verdictOf(colchique, { at: [1.2611, 45.8336] });
  assert.equal(limoges.protected, true);
  assert.match(limoges.reasons.find(r => r.kind === 'protected')?.text || '', /^Espèce protégée ici \(Haute-Vienne\)/);
  const paris = await verdictOf(colchique, { at: [2.3522, 48.8566] });
  assert.equal(paris.protected, false);
  assert.equal(paris.reasons.find(r => r.kind === 'protected-elsewhere')?.level, 'warn');
  // No point (the sheet): elsewhere, a warning — no harvest stopped for it alone.
  const regional = dangerLevel({ statuses: [{ type: 'PR', code: 'X', label: 'Protection régionale', area: 'Picardie', level: '', iso: '' }] });
  assert.deepEqual([regional.level, regional.word, harvestStop(regional)], ['warn', 'Protégée selon le lieu', false]);
});

test('jamais « comestible » : aucune raison de la flore réduite ne le dit', async () => {
  for (const p of plants) {
    const v = await verdictOf(p);
    for (const r of v.reasons) assert.doesNotMatch(reasonLine(r), EATEN, p.scientificName);
    assert.ok(LEVELS.includes(v.level));
    if (v.level === 'none') assert.equal(v.reasons.length, 0);
    else assert.equal(v.level, v.reasons[0].level, 'the level of its gravest reason');
  }
});
