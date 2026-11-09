// The CSS custom properties of app/ (tokens.css and the components' styles), and how they are read:
//  - none defined by itself — `--x: var(--x)` makes the property invalid, so whatever reads it falls back to nothing
//    (a transparent danger box);
//  - a token of tokens.css read without a fallback: it is defined on :root, for both themes (the dark one only
//    changes values), in the app's one page (index.html links tokens.css first) and in every shadow root (custom
//    properties inherit), so a fallback `var(--gf-x, #2e7d32)` is never used — a second colour, kept in step for
//    nothing; every --gf- name read is defined somewhere (tokens.css, or set by the code: --gf-tilt, --gf-credits…);
//  - a corner rounded like a token is written with it (--gf-radius-sm 8px, --gf-radius 10px, --gf-radius-lg 16px,
//    --gf-radius-pill);
//  - a slider's thumb shows the focus ring in Chrome and in Firefox alike; a text for screen readers only
//    (clip-path: inset(50%)) stays on one line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const app = new URL('../../app/', import.meta.url);
const root = new URL('../../', import.meta.url);

/** The styles of the app: app/**\/*.{css,js} and index.html (its launch screen), as [path, text]. */
async function sources() {
  const files = (await readdir(app, { recursive: true })).filter(f => /\.(css|js)$/.test(f)).map(f => 'app/' + f);
  return Promise.all([...files, 'index.html'].map(async f => /** @type {[string, string]} */ ([f, await readFile(new URL(f, root), 'utf8')])));
}
const lineOf = (/** @type {string} */ text, /** @type {number} */ index) => text.slice(0, index).split('\n').length;

/** The tokens of tokens.css: its :root, and the dark theme's (values only). */
async function tokens() {
  const css = await readFile(new URL('styles/tokens.css', app), 'utf8');
  const [light, dark] = css.split('@media (prefers-color-scheme: dark)');
  const names = (/** @type {string} */ block) => [...block.matchAll(/(--gf-[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]);
  return { light: new Map(names(light)), dark: new Map(names(dark || '')) };
}

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

test('un jeton de tokens.css se lit sans repli (toujours défini) ; un nom --gf- lu est défini quelque part', async () => {
  const { light, dark } = await tokens();
  // The dark theme only changes values: every token it sets is one of :root's (defined in both themes).
  assert.deepEqual([...dark.keys()].filter(name => !light.has(name)), []);
  const all = await sources();
  const fallbacks = [], undefinedNames = new Set();
  for (const [file, text] of all) {
    for (const m of text.matchAll(/var\(\s*(--gf-[\w-]+)\s*(,?)/g)) {
      const [, name, comma] = m;
      if (comma && light.has(name)) fallbacks.push(`${file}:${lineOf(text, m.index)} var(${name}, …)`);
      // Set in a stylesheet (`--gf-x:`), a style string ('--gf-x: ' + n) or by setProperty('--gf-x', …).
      const set = new RegExp(`${name}\\s*:|['"\`]${name}['"\`]`);
      if (!light.has(name) && !all.some(([, t]) => set.test(t))) undefinedNames.add(`${file}: ${name}`);
    }
  }
  assert.deepEqual(fallbacks, []);
  assert.deepEqual([...undefinedNames], []);
});

test('un rayon égal à un jeton s’écrit par le jeton (--gf-radius-sm, --gf-radius, --gf-radius-lg, --gf-radius-pill)', async () => {
  const { light } = await tokens();
  const radii = new Map([...light].filter(([name]) => name.startsWith('--gf-radius')).map(([name, value]) => [value, name]));
  assert.deepEqual([...radii.keys()].sort(), ['10px', '16px', '8px', '999px']);
  const found = [];
  for (const [file, text] of await sources()) {
    for (const m of text.matchAll(/border(?:-(?:top|bottom)-(?:left|right))?-radius\s*:\s*([^;{}'"`]+)/g)) {
      const literal = m[1].split(/\s+/).find(v => radii.has(v));
      if (literal) found.push(`${file}:${lineOf(text, m.index)} ${literal} → var(${radii.get(literal)})`);
    }
  }
  assert.deepEqual(found, []);
});

test('le pouce d’un curseur : son anneau de focus (--gf-focus) sous Chrome comme sous Firefox', async () => {
  const sliders = [], missing = [];
  for (const [file, text] of await sources()) {
    const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
    // One rule each: a selector list naming a pseudo-element the browser does not know is dropped whole.
    for (const m of css.matchAll(/([^{};`]+?):focus-visible::-webkit-slider-thumb\s*\{/g)) {
      const twin = `${m[1].trim()}:focus-visible::-moz-range-thumb`;
      sliders.push(`${file} ${m[1].trim()}`);
      if (!css.includes(twin)) missing.push(`${file}: ${twin}`);
    }
  }
  assert.ok(sliders.length >= 2, sliders.join(', '));
  assert.deepEqual(missing, []);
});

test('un texte pour les lecteurs d’écran seulement (clip-path: inset(50%)) tient sur une ligne : white-space: nowrap', async () => {
  const recipes = [], wrapping = [];
  for (const [file, text] of await sources()) {
    // A rule's declarations, or a style string (core/toast.js): what holds clip-path: inset(50%).
    for (const m of text.matchAll(/[{'"`][^{}'"`]*clip-path:\s*inset\(50%\)[^{}'"`]*/g)) {
      recipes.push(file);
      if (!/white-space:\s*nowrap/.test(m[0])) wrapping.push(`${file}:${lineOf(text, m.index)}`);
    }
  }
  assert.ok(recipes.length >= 7, recipes.join(', '));
  assert.deepEqual(wrapping, []);
});
