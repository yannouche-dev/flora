// The flora of an assembled site packed for a fast first launch (app/workers/flora-pack.js): from its
// data/plants.json, the index the search starts on and the details that complete it, written under data/flora/ with
// their sha256 in their names (a CDN never serves the previous deploy's under the address of a new one), and
// described in its data/meta.json (`files`: path, sha256 and size of each), which the app checks each download against.
//   node tools/pack-flora.mjs <site>            writes them (tools/assemble-site.sh)
//   node tools/pack-flora.mjs <site> --check    exits 1 unless <site> carries the pack of its plants.json (tools/check.sh)
// Refused (exit 1): a plants.json that is not the one data/meta.json announces (sha256, count), or a pack that does not
// give its records back exactly, or whose search differs from the one of plants.json (same summaries, same order).
// plants.json stays deployed: the app falls back to it when the pack fails, and versions without the pack read it.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { indexPlants, mergeFlora, packFlora, PACK_FORMAT } from '../app/workers/flora-pack.js';
import { buildIndex, legalValues } from '../app/workers/search-core.js';

const DIR = 'data/flora';

/** @param {string | Uint8Array} bytes */
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/**
 * The pack of a flora, as files: their text, sha256 and published path. Throws when the pack does not give back the
 * flora, or its search (see above).
 * @param {any[]} plants
 */
export function packFiles(plants) {
  const { index, details } = packFlora(plants, legalValues);
  const files = Object.fromEntries(Object.entries({ index, details }).map(([name, value]) => {
    const text = JSON.stringify(value);
    const hash = sha256(text);
    return [name, { path: `${DIR}/${name}.${hash.slice(0, 12)}.json`, sha256: hash, bytes: Buffer.byteLength(text), text }];
  }));
  verifyPack(plants, JSON.parse(files.index.text), JSON.parse(files.details.text));
  return /** @type {Record<'index' | 'details', { path: string, sha256: string, bytes: number, text: string }>} */ (files);
}

/** The pack gives back the records exactly, and the same search. @param {any[]} plants @param {any} index @param {any} details */
function verifyPack(plants, index, details) {
  const merged = mergeFlora(index, details);
  if (merged.length !== plants.length) throw new Error(`the pack holds ${merged.length} plants, plants.json ${plants.length}`);
  merged.forEach((plant, i) => {
    if (!isDeepStrictEqual(plant, plants[i])) throw new Error(`the pack does not give back plant ${plants[i]?.id} of plants.json exactly`);
  });
  const fromPack = buildIndex(indexPlants(index)).entries, fromPlants = buildIndex(plants).entries;
  fromPlants.forEach((entry, i) => {
    if (!isDeepStrictEqual(entry.summary, fromPack[i].summary) || !isDeepStrictEqual(entry.values, fromPack[i].values) || !isDeepStrictEqual(entry.rank, fromPack[i].rank)) {
      throw new Error(`the search on the pack differs for plant ${entry.summary.id}`);
    }
  });
}

/** The site's flora and its meta.json, the flora checked against what meta.json announces. @param {string} site */
function readFlora(site) {
  const bytes = readFileSync(join(site, 'data/plants.json'));
  const meta = JSON.parse(readFileSync(join(site, 'data/meta.json'), 'utf8'));
  const plants = JSON.parse(bytes.toString('utf8'));
  if (meta.sha256 && meta.sha256 !== sha256(bytes)) throw new Error('data/plants.json is not the flora data/meta.json announces (sha256)');
  if (!Array.isArray(plants) || plants.length !== meta.plants) throw new Error(`data/plants.json holds ${plants?.length} plants, data/meta.json announces ${meta.plants}`);
  return { plants, meta };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [site, flag] = process.argv.slice(2);
  if (!site || (flag && flag !== '--check')) {
    console.error('usage: node tools/pack-flora.mjs <site> [--check]');
    process.exit(2);
  }
  try {
    const { plants, meta } = readFlora(site);
    const files = packFiles(plants);
    if (flag) {
      for (const name of /** @type {const} */ (['index', 'details'])) {
        const listed = meta.files?.[name];
        if (meta.files?.format !== PACK_FORMAT || !listed) throw new Error(`data/meta.json lists no ${name} of the flora (format ${PACK_FORMAT}): tools/assemble-site.sh writes it`);
        const path = join(site, listed.path);
        if (!existsSync(path)) throw new Error(`${listed.path} (data/meta.json) is not in the site`);
        const text = readFileSync(path);
        if (sha256(text) !== listed.sha256 || text.length !== listed.bytes) throw new Error(`${listed.path} is not the file data/meta.json describes`);
        if (listed.sha256 !== files[name].sha256) throw new Error(`${listed.path} is not the ${name} of data/plants.json`);
      }
      console.log(`flora pack: ${meta.files.index.path} and ${meta.files.details.path} match data/plants.json`);
    } else {
      rmSync(join(site, DIR), { recursive: true, force: true });
      mkdirSync(join(site, DIR), { recursive: true });
      for (const file of Object.values(files)) writeFileSync(join(site, file.path), file.text);
      meta.files = { format: PACK_FORMAT, ...Object.fromEntries(Object.entries(files).map(([name, { path, sha256: hash, bytes }]) => [name, { path, sha256: hash, bytes }])) };
      writeFileSync(join(site, 'data/meta.json'), JSON.stringify(meta, null, 2) + '\n');
      const kb = (/** @type {number} */ n) => `${Math.round(n / 1024)} KB`;
      console.log(`flora pack: ${files.index.path} (${kb(files.index.bytes)}), ${files.details.path} (${kb(files.details.bytes)})`);
    }
  } catch (error) {
    console.error(`::error file=data/plants.json::${/** @type {Error} */ (error).message}`);
    process.exit(1);
  }
}
