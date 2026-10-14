// The fast first launch: the flora packed in two files at deploy (app/workers/flora-pack.js, tools/pack-flora.mjs),
// the search on the index alone the same as on plants.json, the plant reads of a first launch (app/core/db.js
// readPlantsFrom), the typo words built on demand (search-core.js vocabularyOf) and the modules preloaded by the
// deployed index.html (tools/preload-modules.mjs). On the reduced flora of the tests (tests/fixtures/plants.json).
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INDEX_FIELDS, indexPlants, mergeFlora, packFlora, PACK_FORMAT } from '../../app/workers/flora-pack.js';
import { buildIndex, FACETS, legalValues, search, vocabularyOf } from '../../app/workers/search-core.js';
import { packFiles } from '../../tools/pack-flora.mjs';
import { staticGraph } from '../../tools/preload-modules.mjs';

// db.js upgrades the schema only from a page (a worker opens whatever version exists).
/** @type {any} */ (globalThis).window ??= globalThis;

const ROOT = new URL('../../', import.meta.url).pathname;
const FIXTURE = new URL('../fixtures/', import.meta.url);
const plants = JSON.parse(readFileSync(new URL('plants.json', FIXTURE), 'utf8'));
const NONE = Object.fromEntries(FACETS.map(f => [f, []]));
/** Through JSON, as the files travel. @param {any} value */
const wire = value => JSON.parse(JSON.stringify(value));

test('le paquet rend les fiches de plants.json exactement, chaque champ dans un seul des deux fichiers', () => {
  const { index, details } = wire(packFlora(plants, legalValues));
  assert.equal(index.format, PACK_FORMAT);
  assert.deepEqual(mergeFlora(index, details), plants);
  // The index holds the search's fields only; the details the rest.
  assert.deepEqual(index.fields, [...INDEX_FIELDS, 'legal']);
  for (const [, rest] of details.rows) for (const field of INDEX_FIELDS) assert.ok(!(field in rest), field);
  assert.ok(details.rows.some((/** @type {any} */ [, rest]) => rest.statuses), 'les statuts INPN dans les détails');
});

test('un champ absent reste absent (pas null), un champ inconnu passe dans les détails', () => {
  const odd = [{ id: 1, family: 'Rosaceae', genus: 'Rosa', species: 'canina', scientificName: 'Rosa canina', newField: { a: 1 } },
    { ...plants[0], thumbnail: null }];
  const { index, details } = wire(packFlora(odd, legalValues));
  assert.deepEqual(mergeFlora(index, details), odd);
  assert.ok(!('author' in mergeFlora(index, details)[0]));
});

test('la recherche sur l’index seul est celle de plants.json : mêmes fiches résumées, facettes, tris et résultats', () => {
  const { index } = wire(packFlora(plants, legalValues));
  const light = buildIndex(indexPlants(index)), full = buildIndex(plants);
  assert.deepEqual(light.entries.map(e => [e.summary, e.values, e.rank]), full.entries.map(e => [e.summary, e.values, e.rank]));
  for (const q of ['ortie', 'pisenlit', 'ail des ours', '']) {
    for (const sort of ['', 'sci', 'family', 'status', 'legal']) {
      assert.deepEqual(search(light, { q, filters: NONE, sort }), search(full, { q, filters: NONE, sort }), `${q} / ${sort}`);
    }
  }
  assert.ok(light.entries.some(e => e.values.legal.length), 'la facette protection vient de l’index');
});

test('une paire qui ne va pas ensemble est refusée', () => {
  const { index, details } = wire(packFlora(plants, legalValues));
  assert.throws(() => mergeFlora(index, { ...details, rows: details.rows.slice(1) }), /plantes/);
  const swapped = [details.rows[1], details.rows[0], ...details.rows.slice(2)];
  assert.throws(() => mergeFlora(index, { ...details, rows: swapped }), /n’est pas celle de l’index/);
  assert.throws(() => indexPlants({ ...index, format: PACK_FORMAT + 1 }), /format inconnu/);
  assert.throws(() => indexPlants({ ...index, fields: ['id'] }), /champs inconnus/);
});

test('tools/pack-flora.mjs : noms et empreintes des fichiers, meta.json les décrit, --check les reconnaît', () => {
  const files = packFiles(plants);
  for (const file of Object.values(files)) {
    assert.equal(createHash('sha256').update(file.text).digest('hex'), file.sha256);
    assert.equal(file.path, `data/flora/${file.path.includes('index') ? 'index' : 'details'}.${file.sha256.slice(0, 12)}.json`);
    assert.equal(Buffer.byteLength(file.text), file.bytes);
  }
  const site = mkdtempSync(join(tmpdir(), 'geoflora-pack-'));
  try {
    cpSync(new URL('plants.json', FIXTURE), join(site, 'data/plants.json'));
    cpSync(new URL('meta.json', FIXTURE), join(site, 'data/meta.json'));
    const tool = join(ROOT, 'tools/pack-flora.mjs');
    assert.throws(() => execFileSync('node', [tool, site, '--check'], { stdio: 'pipe' }), 'pas encore de paquet');
    execFileSync('node', [tool, site], { stdio: 'pipe' });
    const meta = JSON.parse(readFileSync(join(site, 'data/meta.json'), 'utf8'));
    assert.equal(meta.files.format, PACK_FORMAT);
    assert.equal(meta.files.index.sha256, files.index.sha256);
    assert.equal(meta.sha256, JSON.parse(readFileSync(new URL('meta.json', FIXTURE), 'utf8')).sha256, 'l’empreinte de la flore reste celle de plants.json');
    execFileSync('node', [tool, site, '--check'], { stdio: 'pipe' });
    // A plants.json that is not the one meta.json announces: no pack.
    cpSync(new URL('meta.json', FIXTURE), join(site, 'data/plants.json'));
    assert.throws(() => execFileSync('node', [tool, site], { stdio: 'pipe' }));
  } finally {
    rmSync(site, { recursive: true, force: true });
  }
});

test('les mots des fautes de frappe se construisent à la première recherche qui en a besoin', () => {
  const index = buildIndex(plants);
  assert.equal(index.vocabulary, null);
  const typo = search(index, { q: 'pisenlit', filters: NONE, sort: '' });
  assert.ok(typo.fuzzy > 0 && index.vocabulary, 'construits par la recherche approchante');
  assert.equal(vocabularyOf(index), index.vocabulary, 'une seule fois');
});

test('premier lancement : une plante lue depuis le worker, toute lecture du magasin attend qu’il soit rempli', async () => {
  const db = await import('../../app/core/db.js');
  /** @type {() => void} */
  let fill = () => {};
  const stored = new Promise(resolve => { fill = () => resolve(undefined); });
  const asked = [];
  db.readPlantsFrom({ get: async id => { asked.push(id); return { id, from: 'worker' }; }, stored });
  try {
    assert.deepEqual(await db.get('plants', 7), { id: 7, from: 'worker' });
    assert.deepEqual(asked, [7]);
    let counted = null;
    const counting = db.count('plants').then(n => { counted = n; });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(counted, null, 'le compte attend le remplissage');
    await db.replacePlants(plants.slice(0, 3), { plants: 3 });
    fill();
    await counting;
    assert.equal(counted, 3);
    // Other stores are read as always.
    assert.deepEqual(await db.get('meta', 'dataset'), { plants: 3 });
  } finally {
    db.readPlantsFrom(null);
  }
  assert.equal((await db.get('plants', plants[0].id))?.id, plants[0].id, 'puis depuis IndexedDB');
});

test('tools/preload-modules.mjs : le démarrage sans les écrans chargés à la demande, la fiche à part', () => {
  const start = staticGraph(ROOT);
  assert.equal(start[0], 'app/main.js');
  assert.ok(start.includes('app/components/gf-flora.js') && start.includes('vendor/lit.js'));
  for (const later of ['app/components/gf-plant-detail.js', 'app/components/gf-map-page.js', 'app/components/gf-settings.js', 'app/layout/gf-layout.js']) {
    assert.ok(!start.includes(later), `${later} n’est pas du démarrage`);
  }
  const sheet = staticGraph(ROOT, 'app/components/gf-plant-detail.js');
  assert.ok(sheet.includes('app/components/gf-media-viewer.js'));
});
