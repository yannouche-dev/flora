// The colour ratchet of tools/check.sh (tools/colour-ratchet.mjs): what counts as a colour written as a literal in
// app/ — in a module's strings and templates, never its code or comments; named colours in CSS text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { literalColours } from '../../tools/colour-ratchet.mjs';

const found = (/** @type {string} */ src, /** @type {string} */ path) => literalColours(src, path).map(c => `${c.line} ${c.text}`);

test('cliquet des couleurs : une couleur écrite en dur, dans les chaînes et les gabarits d’un module, jamais son code ni ses commentaires', () => {
  const module = [
    '// #123456 and rgb(1 2 3) in a comment',
    'class A { async #add() { this.#fade = 1; } }',
    "const pin = { rare: '#fb7185', moyen: '#FBBF24' };",
    'const s = css`a { color: #fff; /* #000, white */ background: rgb(0 0 0 / 30%);',
    '  border-color: white; fill: color-mix(in srgb, var(--gf-accent) 12%, transparent); stroke: currentColor; }`;',
    "const h = html`<p style=\"color:#abc\">&#039; ${x ? '#ddd' : ''} violet, orange</p>`;",
    "const t = 'Orchis violet, fleurs orange — Linen';",
    'const u = `url("data:image/svg+xml,%3Csvg fill=\'%23888\'%3E") #/plant/12 #12345`;',
    'const re = /#ffffff/;'
  ].join('\n');
  assert.deepEqual(found(module, 'app/x.js'), ['3 #fb7185', '3 #FBBF24', '4 #fff', '4 rgb(0 0 0 / 30%)', '5 white', '6 #abc', '6 #ddd']);
});

test('cliquet des couleurs : un fichier .css sans ses commentaires, ses couleurs nommées comprises', () => {
  const css = '/* #fff, red */\na { color: #FFF; fill: Red; }\n.orchid, .tan { rotate: tan(1deg); background: hsl(120 50% 50%); }\n.x::after { content: "Orchidées · redémarrer · #café"; }';
  assert.deepEqual(found(css, 'app/x.css'), ['2 #FFF', '2 Red', '3 hsl(120 50% 50%)']);
});
