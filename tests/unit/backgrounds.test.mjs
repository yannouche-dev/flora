// app/core/backgrounds.js: the maps' backgrounds — the plan, the photos of now, of a year, of a period, the historical
// ones, SPOT's images of a year —: each layer as the Géoplateforme's catalogue gives it (data/ign-catalog.json:
// identifier, format, style, native zooms), the most recent photos greyed under a year's, no other key (never one an
// object inherits), their names in French, a layout cell's address (base=, annee=) and back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ALL_WHENS, LATEST_SPOT, PHOTO_HISTORIC, PHOTO_PERIODS, PHOTO_YEARS, SPOT_YEARS, addressOf, baseKeyOf, baseKind, baseLabel, baseLayers,
  everyBaseLayer, fillerNote, isBaseKey, parseBase, whenLabel
} from '../../app/core/backgrounds.js';

const catalog = JSON.parse(readFileSync(new URL('../../data/ign-catalog.json', import.meta.url), 'utf8'));
/** @type {Map<string, any>} */
const byId = new Map(catalog.layers.map((/** @type {any} */ l) => [l.id, l]));
/** A series of the catalogue (lib/ign-classify.mjs). @param {string} g @returns {any[]} */
const series = g => catalog.layers.filter((/** @type {any} */ l) => l.group === g);

/** Every background the panel ▦ offers. */
const OFFERED = ['plan', 'photo', ...[...PHOTO_YEARS, ...PHOTO_PERIODS, ...PHOTO_HISTORIC].map(w => 'photo:' + w), ...SPOT_YEARS.map(y => 'spot:' + y)];

test('chaque fond proposé : ses couches telles que le catalogue de l’IGN les donne (identifiant, format, style, zooms natifs)', () => {
  assert.equal(OFFERED.length, 2 + 25 + 5 + 3 + 13);
  for (const key of OFFERED) {
    const layers = baseLayers(key);
    assert.ok(layers.length >= 1, key);
    for (const l of layers) {
      const c = byId.get(l.id);
      assert.ok(c, `${key} : ${l.id} au catalogue`);
      assert.equal(l.format, c.format, `${key} : format de ${l.id}`);
      // core/ign-layers.js wmtsUrl: no style is « normal ».
      assert.equal(l.style ?? 'normal', c.style, `${key} : style de ${l.id}`);
      // core/ign.js wmts: no minNative is 0, no maxNative 19.
      assert.equal(l.minNative ?? 0, c.minNative, `${key} : premier zoom de ${l.id}`);
      assert.equal(l.maxNative ?? 19, c.maxNative, `${key} : dernier zoom de ${l.id}`);
    }
  }
  // The tools check each against the service (tools/api-health.mjs, scripts/build-ign-catalog.mjs): each once.
  const every = everyBaseLayer().map(l => l.id);
  assert.equal(new Set(every).size, every.length);
  assert.equal(every.length, 2 + 25 + 5 + 3 + 13);
  assert.ok(every.every(id => byId.has(id)));
});

test('les séries du catalogue, toutes proposées, la plus récente d’abord : photos par année et par période, historiques, SPOT', () => {
  const years = series('ortho-annees'), old = series('ortho-historiques'), spot = series('spot');
  assert.deepEqual([years.length, old.length, spot.length], [30, 3, 13]);
  assert.equal(PHOTO_YEARS.length + PHOTO_PERIODS.length, years.length);
  // Each by its variant (the year, the years): its key, its layer — over the most recent photos.
  for (const l of years) assert.equal(baseLayers('photo:' + l.variant)[1]?.id, l.id, l.id);
  for (const l of old) assert.equal(baseLayers('photo:' + l.variant)[1]?.id, l.id, l.id);
  for (const l of spot) assert.equal(baseLayers('spot:' + l.variant)[0]?.id, l.id, l.id);
  // Years alone, periods of years, historical ones (PNG, their own style); SPOT to its zoom 17.
  assert.ok(PHOTO_YEARS.every(w => /^\d{4}$/.test(w)) && PHOTO_PERIODS.every(w => /^\d{4}-\d{4}$/.test(w)));
  assert.deepEqual(PHOTO_HISTORIC, ['1980-1995', '1965-1980', '1950-1965']);
  assert.ok(PHOTO_HISTORIC.every(w => baseLayers('photo:' + w)[1].format === 'image/png' && baseLayers('photo:' + w)[1].style === 'BDORTHOHISTORIQUE'));
  assert.ok(SPOT_YEARS.every(y => baseLayers('spot:' + y)[0].maxNative === 17));
  const desc = (/** @type {string[]} */ list) => list.every((w, i) => i === 0 || w.slice(0, 4) < list[i - 1].slice(0, 4));
  assert.ok(desc(PHOTO_YEARS) && desc(PHOTO_PERIODS) && desc(PHOTO_HISTORIC) && desc(SPOT_YEARS), 'les plus récents d’abord');
  assert.deepEqual([PHOTO_YEARS[0], PHOTO_YEARS.at(-1), SPOT_YEARS[0], SPOT_YEARS.at(-1), LATEST_SPOT], ['2024', '2000', '2025', '2013', '2025']);
});

test('sous les photos d’une année, d’une période ou historiques : les plus récentes, en gris pâle ; rien sous le plan, les photos récentes, SPOT', () => {
  for (const w of [...PHOTO_YEARS, ...PHOTO_PERIODS, ...PHOTO_HISTORIC]) {
    const [under, over, ...more] = baseLayers('photo:' + w);
    assert.deepEqual([under.id, under.grey, over.grey, more.length], ['ORTHOIMAGERY.ORTHOPHOTOS', true, undefined, 0], w);
    assert.equal(fillerNote('photo:' + w) !== null, true);
  }
  for (const key of ['plan', 'photo', ...SPOT_YEARS.map(y => 'spot:' + y)]) {
    assert.equal(baseLayers(key).length, 1, key);
    assert.ok(!baseLayers(key)[0].grey, key);
    assert.equal(fillerNote(key), null, key);
  }
  // Greyed and pale; from very far too when the year's start at a closer zoom (2020: its first native 6; 2015 and
  // 1950-1965 from 0, the whole world).
  assert.equal(fillerNote('photo:2020'), 'Là où l’IGN n’a pas photographié en 2020 : les photos les plus récentes, en gris pâle. De très loin aussi : celles de 2020 apparaissent en s’approchant.');
  assert.equal(fillerNote('photo:2016-2020'), 'Là où l’IGN n’a pas photographié de 2016 à 2020 : les photos les plus récentes, en gris pâle. De très loin aussi : celles de 2016 à 2020 apparaissent en s’approchant.');
  assert.equal(fillerNote('photo:1965-1980'), 'Là où l’IGN n’a pas photographié de 1965 à 1980 : les photos les plus récentes, en gris pâle. De très loin aussi : celles de 1965 à 1980 apparaissent en s’approchant.');
  assert.equal(fillerNote('photo:2015'), 'Là où l’IGN n’a pas photographié en 2015 : les photos les plus récentes, en gris pâle.');
  assert.equal(fillerNote('photo:1950-1965'), 'Là où l’IGN n’a pas photographié de 1950 à 1965 : les photos les plus récentes, en gris pâle.');
});

test('une autre clé n’est pas un fond : année absente, sorte sans année, clé d’un objet, autre type', () => {
  for (const key of ['photo:1999', 'spot:2030', 'constructor', 'photo:toString', 'spot:constructor', 'toString', '__proto__', 'hasOwnProperty',
    'spot', 'satellite', 'photo:', 'photo:2025', 'spot:2016-2020', 'spot:1950-1965', 'PHOTO', ' photo', 'plan:2020', '', null, undefined, 2020, ['photo'], {}]) {
    assert.equal(parseBase(key), null, String(key));
    assert.equal(isBaseKey(key), false, String(key));
    assert.deepEqual(baseLayers(key), [], String(key));
    assert.equal(baseLabel(key), '', String(key));
    assert.equal(baseKind(key), null, String(key));
    assert.equal(fillerNote(key), null, String(key));
  }
  for (const key of OFFERED) assert.equal(parseBase(key)?.key, key);
});

test('leurs noms en français', () => {
  assert.equal(baseLabel('plan'), 'Plan IGN');
  assert.equal(baseLabel('photo'), 'Photos aériennes');
  assert.equal(baseLabel('photo:2020'), 'Photos aériennes de 2020');
  assert.equal(baseLabel('photo:2016-2020'), 'Photos aériennes de 2016 à 2020');
  assert.equal(baseLabel('photo:1950-1965'), 'Photos aériennes historiques de 1950 à 1965');
  assert.equal(baseLabel('spot:2020'), 'Images satellite SPOT de 2020');
  assert.equal(whenLabel('2016-2020'), '2016 – 2020');
  assert.equal(whenLabel('2020'), '2020');
  assert.deepEqual(['plan', 'photo', 'photo:2016-2020', 'spot:2013'].map(baseKind), ['plan', 'photo', 'photo', 'spot']);
  assert.deepEqual([parseBase('photo')?.when, parseBase('photo:1965-1980')?.when, parseBase('spot:2014')?.when], [null, '1965-1980', '2014']);
});

test('l’adresse d’une case (base=, annee=) et retour : sans année, la plus récente ; une année sans sorte, celle des photos (sinon de SPOT)', () => {
  for (const key of OFFERED) {
    const a = addressOf(key);
    assert.equal(baseKeyOf(a.base, a.annee), key, key);
  }
  assert.deepEqual(addressOf('spot:' + LATEST_SPOT), { base: 'spot', annee: null }, 'SPOT seul : sa dernière année');
  assert.deepEqual(addressOf('spot:2020'), { base: 'spot', annee: '2020' });
  assert.deepEqual(addressOf('photo'), { base: 'photo', annee: null });
  assert.deepEqual(addressOf('photo:1950-1965'), { base: 'photo', annee: '1950-1965' });
  assert.deepEqual(addressOf('constructor'), { base: null, annee: null });
  assert.equal(baseKeyOf(null, '2020'), 'photo:2020');
  assert.equal(baseKeyOf(null, '2025'), 'spot:2025');
  assert.equal(baseKeyOf('spot', null), 'spot:' + LATEST_SPOT);
  assert.equal(baseKeyOf('photo', '2016-2020'), 'photo:2016-2020');
  assert.equal(baseKeyOf('spot', '2010'), null);
  assert.equal(baseKeyOf('spot', '1950-1965'), null);
  assert.equal(baseKeyOf('photo', '2025'), null);
  assert.equal(baseKeyOf('plan', '2020'), null);
  assert.equal(baseKeyOf(null, null), null);
  assert.equal(baseKeyOf('constructor', null), null);
  assert.equal(baseKeyOf(null, 'toString'), null);
  // Every year or period annee= takes, once: SPOT's and the photos'.
  assert.equal(new Set(ALL_WHENS).size, ALL_WHENS.length);
  assert.deepEqual(new Set(ALL_WHENS), new Set([...PHOTO_YEARS, ...PHOTO_PERIODS, ...PHOTO_HISTORIC, ...SPOT_YEARS]));
  assert.ok(ALL_WHENS.every(w => baseKeyOf(null, w) !== null));
});
