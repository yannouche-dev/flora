// The CSS custom properties of app/ (tokens.css and the components' styles): none defined by itself — `--x: var(--x)`
// makes the property invalid, so whatever reads it falls back to nothing (a transparent danger box).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const app = new URL('../../app/', import.meta.url);

test('aucune propriété CSS ne se définit par elle-même', async () => {
  const files = (await readdir(app, { recursive: true })).filter(f => /\.(css|js)$/.test(f));
  assert.ok(files.includes('styles/tokens.css'));
  const found = [];
  for (const file of files) {
    const text = await readFile(new URL(file, app), 'utf8');
    for (const [, name, value] of text.matchAll(/(--[\w-]+)\s*:([^;{}]*)/g)) {
      if (new RegExp(`var\\(\\s*${name}\\s*[,)]`).test(value)) found.push(`${file}: ${name}:${value.trim()}`);
    }
  }
  assert.deepEqual(found, []);
});
