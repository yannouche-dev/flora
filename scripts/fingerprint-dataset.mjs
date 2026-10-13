// The fingerprint of the flora: sha256 of data/plants.json, as published, written into data/meta.json (`sha256`).
// The app compares it with the one of its local copy (app/core/dataset.js): a new build of the same flora (a new
// generatedAt) is not downloaded again, a changed one is (also when only its photos changed), and the plants.json
// downloaded is checked against it before it replaces the local copy.
// Run after the last script that writes plants.json (build-dataset.yml, enrich-media.yml); build-plants.mjs sets it
// too. scripts/check-data.mjs fails when it does not match plants.json.
//   node scripts/fingerprint-dataset.mjs     PLANTS_FILE, META_FILE (defaults: data/…), like the build scripts

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** sha256 (hex) of the bytes of plants.json. @param {string | Uint8Array} content */
export const fingerprint = content => createHash('sha256').update(content).digest('hex');

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const PLANTS_FILE = process.env.PLANTS_FILE || 'data/plants.json';
  const META_FILE = process.env.META_FILE || 'data/meta.json';
  const bytes = await readFile(PLANTS_FILE);
  const meta = JSON.parse(await readFile(META_FILE, 'utf8'));
  meta.sha256 = fingerprint(bytes);
  meta.plants = JSON.parse(bytes.toString('utf8')).length;
  await writeFile(META_FILE, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  console.log(`${META_FILE}: sha256 ${meta.sha256} (${meta.plants} plants)`);
}
