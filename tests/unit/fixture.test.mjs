// The reduced flora of the tests (tests/fixtures, built by build-fixture.mjs) is one the app accepts: its meta.json
// announces its fingerprint and count (app/core/dataset.js refuses a plants.json that does not match), and every plant
// is shaped like those of data/plants.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fingerprint } from '../../scripts/fingerprint-dataset.mjs';

const bytes = await readFile(new URL('../fixtures/plants.json', import.meta.url));
const meta = JSON.parse(await readFile(new URL('../fixtures/meta.json', import.meta.url), 'utf8'));
const plants = JSON.parse(bytes.toString('utf8'));

test('meta.json du jeu réduit : empreinte et nombre de plantes exacts', () => {
  assert.equal(meta.sha256, fingerprint(bytes), 'relancer node tests/fixtures/build-fixture.mjs');
  assert.equal(meta.plants, plants.length);
  assert.ok(plants.length >= 250 && plants.length <= 400);
});

test('chaque plante a la forme de data/plants.json, identifiants uniques', () => {
  assert.equal(new Set(plants.map((/** @type {any} */ p) => p.id)).size, plants.length);
  for (const p of plants) {
    assert.ok(Number.isInteger(p.id) && p.scientificName && p.family && p.genus, JSON.stringify(p).slice(0, 120));
    assert.ok(Array.isArray(p.vernacularNames) && Array.isArray(p.synonyms));
  }
});
