// lib/plant-sources.mjs: a service that fails is named (`unavailable`), never read as « not on this service »; an
// answer of another shape fails loudly (audit STO-8, STO-9, OPS-2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlantSources } from '../../lib/plant-sources.mjs';

const plant = { id: 92127, scientificName: 'Colchicum autumnale', vernacularNames: ['Colchique d’automne'] };

/**
 * PlantSources over a fake fetchJson: `answer(url)` gives the JSON, or throws.
 * @param {(url: string, options: any) => any} answer
 */
const sourcesWith = answer => new PlantSources({ fetchJson: async (url, options) => {
  const data = await answer(url, options);
  if (options?.expect && !options.expect(data)) throw Object.assign(new Error('schema'), { kind: 'schema' });
  return data;
} });

const fail = () => { throw Object.assign(new Error('503'), { status: 503 }); };

test('toutes les sources en panne : details() les nomme (unavailable), sans rien inventer', async () => {
  const details = await sourcesWith(fail).details(plant);
  assert.deepEqual(details.identifiers.gbif, null);
  assert.deepEqual(details.identifiers.unavailable.sort(), ['gbif', 'inaturalist', 'wikidata']);
  assert.deepEqual(details.unavailable.sort(), ['commons', 'gbif', 'inaturalist', 'wikidata']);
  assert.deepEqual(details.commons, []);
});

test('sources joignables sans résultat : pas de « unavailable » (une vraie absence)', async () => {
  const details = await sourcesWith(url => {
    if (url.includes('species/match')) return { matchType: 'NONE' };
    if (url.includes('gbif.org')) return { results: [] };
    if (url.includes('inaturalist')) return { results: [] };
    if (url.includes('wbsearchentities')) return { search: [] };
    return { query: { pages: {} } };
  }).details(plant);
  assert.equal(details.unavailable, undefined);
  assert.equal(details.identifiers.unavailable, undefined);
  assert.equal(details.identifiers.gbif, null);
});

test('réponse de forme inattendue (GBIF { data: […] }) : une panne, pas « absent de GBIF »', async () => {
  const sources = sourcesWith(url => {
    if (url.includes('species/match')) throw new Error('match down');
    if (url.includes('gbif.org')) return { data: [{ canonicalName: 'Colchicum autumnale' }] };
    return fail();
  });
  await assert.rejects(sources.gbifTaxon(plant));
  const ids = await sources.identifiers(plant);
  assert.ok(ids.unavailable.includes('gbif'));
});

test('vignette : rien trouvé alors qu’une source a échoué → une erreur (pas null gardé une semaine)', async () => {
  await assert.rejects(sourcesWith(fail).thumbnail(plant));
  const none = await sourcesWith(url => url.includes('inaturalist') ? { results: [] } : { query: { pages: {} } }).thumbnail(plant);
  assert.equal(none, null);
});

test('une annulation n’est pas une panne : elle remonte', async () => {
  const sources = sourcesWith(() => { throw new DOMException('cancelled', 'AbortError'); });
  await assert.rejects(sources.details(plant), { name: 'AbortError' });
});

test('catégorie UICN : corps vide ou 404 → null (jamais évaluée), autre erreur → rejet', async () => {
  const empty = new PlantSources({ fetchJson: async (_url, options) => { assert.equal(options.allowEmpty, true); return null; } });
  assert.equal(await empty.gbifSpecies(1, 'iucnRedListCategory'), null);
  const missing = sourcesWith(() => { throw Object.assign(new Error('404'), { status: 404 }); });
  assert.equal(await missing.gbifSpecies(1, 'iucnRedListCategory'), null);
  await assert.rejects(sourcesWith(fail).gbifSpecies(2, 'iucnRedListCategory'));
});

test('les API Wikimedia reçoivent Api-User-Agent par le fetchJson donné', async () => {
  /** @type {any[]} */
  const seen = [];
  await new PlantSources({ fetchJson: async (url, options) => { seen.push([url, options.headers]); return { search: [] }; } }).wikidataTaxon(plant);
  assert.match(seen[0][0], /wikidata\.org\/w\/api\.php/);
  assert.match(seen[0][1]['Api-User-Agent'], /^GeoFlora /);
});
