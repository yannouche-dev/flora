// app/core/territory.js isNational (GAP2-3) and app/core/regulation.js (GAP2-4): which INPN statuses are national,
// and which REGL statuses are a picking rule in metropolitan France — the same answer for the badge, the Prudence,
// the Flore filter, the statut block and the toasts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isNational, sortStatuses } from '../../app/core/territory.js';
import { harvestRuleText, harvestRules, regulationKind } from '../../app/core/regulation.js';
import { legalValues } from '../../app/workers/search-core.js';

const plants = JSON.parse(await readFile(new URL('../../data/plants.json', import.meta.url), 'utf8'));
/** Every distinct (type, code, area, level, iso) of the flora's statuses. */
const statuses = [...new Map(plants.flatMap((/** @type {any} */ p) => p.statuses || [])
  .map((/** @type {any} */ s) => [[s.type, s.code, s.area, s.level, s.iso].join('|'), s])).values()];

test('GAP2-3 : national = PN, LRN, ou statut sans code FR-… dont l’aire est la France ; jamais l’Île-de-France', () => {
  assert.ok(statuses.length > 50);
  for (const s of statuses) {
    const expected = s.type === 'PN' || s.type === 'LRN' || (!s.iso && /^France( métropolitaine)?$/.test(s.area));
    assert.equal(isNational(s), expected, `${s.type} ${s.code} « ${s.area} » ${s.iso}`);
    if (/^FR-/.test(s.iso || '')) assert.equal(isNational(s), false, `${s.area} (${s.iso}) n’est pas national`);
  }
  const idf = { type: 'PR', code: 'RV11', label: 'Protection régionale', area: 'Ile-de-France', level: 'Région', iso: 'FR-J' };
  assert.equal(isNational(idf), false);
  const paca = { dept: '13', deptName: 'Bouches-du-Rhône', region: 'FR-U', regionName: 'Provence-Alpes-Côte d’Azur', formers: ['Provence-Alpes-Côte d’Azur'] };
  assert.deepEqual(sortStatuses([idf], paca), { national: [], here: [], elsewhere: [idf] }, 'à Marseille, la protection francilienne est « ailleurs »');
  const idfHere = { dept: '75', deptName: 'Paris', region: 'FR-J', regionName: 'Île-de-France', formers: ['Ile-de-France'] };
  assert.deepEqual(sortStatuses([idf], idfHere).here, [idf]);
  // New Caledonia's provinces (no ISO code) are not national either.
  assert.equal(isNational({ type: 'REGL', code: 'NCPNEI', label: '', area: 'Province Nord', level: 'Subdivision administrative', iso: '' }), false);
});

test('GAP2-4 : REGL classés par code — cueillette (métropole), commerce (CITES), outre-mer, espèces envahissantes', () => {
  const kind = (/** @type {string} */ code) => regulationKind(/** @type {any} */ (statuses.find(s => s.type === 'REGL' && s.code === code)));
  assert.equal(kind('PV1'), 'harvest');
  assert.equal(kind('NV3'), 'harvest');
  assert.equal(kind('CCB'), 'trade');
  assert.equal(kind('UEintro'), 'trade');
  assert.equal(kind('PV97'), 'overseas');
  assert.equal(kind('NCPNEI'), 'overseas');
  assert.equal(kind('FRnoEEEV'), 'invasive');
  // Every department's order is a picking rule.
  for (const s of statuses.filter(s => s.type === 'REGL' && /^FR-\d|^FR-2[AB]/.test(s.iso))) assert.equal(regulationKind(s), 'harvest', `${s.code} ${s.area}`);
  // Every REGL code of the data has a kind other than « other », but CNPN1 (derogations to protection).
  for (const s of statuses.filter(s => s.type === 'REGL' && s.code !== 'CNPN1')) assert.notEqual(regulationKind(s), 'other', s.code);
  assert.equal(regulationKind({ type: 'PN', code: 'NV1', label: '', area: 'France métropolitaine', level: '', iso: '' }), null);
});

test('GAP2-4 : badge, Prudence et filtre « Cueillette réglementée » ne comptent que la cueillette en métropole', () => {
  const byName = (/** @type {string} */ name) => plants.find((/** @type {any} */ p) => p.scientificName === name);
  // Only an invasive species list, or only the overseas one: no « réglementée ».
  for (const name of ['Heracleum mantegazzianum', 'Arum italicum']) {
    const p = byName(name);
    assert.ok(p?.statuses?.some((/** @type {any} */ s) => s.type === 'REGL'), name + ' a des REGL');
    assert.equal(harvestRuleText(p.statuses), null, name);
    assert.ok(!legalValues(p.statuses).includes('reglementee'), name);
  }
  assert.equal(harvestRuleText([{ type: 'REGL', code: 'PV1', label: '', area: 'France métropolitaine', level: 'Territoire', iso: '' }]),
    'Cueillette pouvant être réglementée par arrêté préfectoral');
  assert.equal(harvestRuleText([{ type: 'REGL', code: 'V39P6', label: '', area: 'Jura', level: 'Département', iso: 'FR-39' }]),
    'Cueillette réglementée dans certains départements');
  assert.deepEqual(legalValues([{ type: 'REGL', code: 'CCB' }]), []);
  assert.deepEqual(legalValues([{ type: 'REGL', code: 'PV1', iso: '' }]), ['reglementee']);
  // Counted over the flora: fewer « réglementée » than plants with any REGL, but never none.
  const any = plants.filter((/** @type {any} */ p) => p.statuses?.some((/** @type {any} */ s) => s.type === 'REGL')).length;
  const harvest = plants.filter((/** @type {any} */ p) => harvestRules(p.statuses).length).length;
  assert.ok(harvest > 100 && harvest < any, `${harvest} / ${any}`);
});
