// Colour ratchet: the colours written as literals in app/ — #rgb, #rrggbb and their alpha forms, rgb() and the other
// colour functions, a CSS named colour — counted per file against a committed baseline (tools/colour-baseline.json)
// that only goes down. A colour of the app is a token of app/styles/tokens.css (light and dark: var(--gf-…)); a
// literal in a component does not follow the theme, and its copies drift apart. The check fails when a file holds more
// literals than the baseline gives it (a file it does not list: none), listing that file's literals and their lines;
// and when one holds fewer, until the baseline is lowered: `--update` writes the counts of now, never a higher one, so
// a colour taken out cannot come back unnoticed. A literal that must stay (no CSS where it is drawn: MapLibre's paint,
// a chart's palette, a marker built as SVG text) is added to the baseline by hand, in the pull request that needs it,
// which says why.
// What counts, in app/**/*.css and app/**/*.js — app/styles/tokens.css aside, the colours' one home:
//  - in a .css file, its text without its /* comments */; in a module, the text of its strings and template literals
//    (tokenize of tools/check-imports.mjs: never its code — a private #add —, comments or regular expressions), a
//    css`…` template without its /* comments */;
//  - « # » and 3, 4, 6 or 8 hex digits, not glued to a word, to « & » (&#039;) or to « - »; each rgb(), rgba(), hsl(),
//    hsla(), hwb(), lab(), lch(), oklab(), oklch() and color() (a color-mix() of tokens is none; its literal operand,
//    one); in CSS text only (a .css file, a css`…` template), a named colour: white, black, red… (in a module's other
//    strings they are words of the interface, « violet », « orange », and an orchid). Never transparent, currentColor,
//    inherit or a system colour (Canvas…): they follow the theme or the text.
// Not counted: data/, assets/ (the icons take currentColor), vendor/, lib/, index.html and the manifest (theme-color,
// background_color: no CSS variable there), a colour URL-encoded in a data: URL (%23888). Limit: an element id of 3,
// 4, 6 or 8 hex letters in a selector string ('#add') would count (none in app/).
//   node tools/colour-ratchet.mjs             checks app/ against the baseline (tools/check.sh)
//   node tools/colour-ratchet.mjs --update    lowers tools/colour-baseline.json to the counts of now
// No dependency: the « check » job of CI installs none.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tokenize } from './check-imports.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'tools', 'colour-baseline.json');
/** The tokens: where the colours are written once, for both themes. */
const TOKENS = 'app/styles/tokens.css';

// The CSS named colours (CSS Color 4), lowercase.
const NAMED = ('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood '
  + 'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen '
  + 'darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray '
  + 'darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia '
  + 'gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender '
  + 'lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink '
  + 'lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon '
  + 'mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise '
  + 'mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid '
  + 'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red '
  + 'rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow '
  + 'springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen').split(' ');

const HEX = String.raw`(?<![\w&#.-])#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{3,4})(?![\w-])`;
const FUNCTION = String.raw`(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(`;
const NAME = String.raw`(?<![\w.#-])(?:${NAMED.join('|')})(?![\w(-])`;
const IN_CODE = new RegExp(`${HEX}|${FUNCTION}`, 'gi');
const IN_CSS = new RegExp(`${HEX}|${FUNCTION}|${NAME}`, 'gi');

/** A colour function's whole text, from its name to its closing parenthesis (for the report). */
function whole(/** @type {string} */ text, /** @type {number} */ at, /** @type {string} */ match) {
  if (!match.endsWith('(')) return match;
  let i = at + match.length, depth = 1;
  while (i < text.length && depth) { if (text[i] === '(') depth++; else if (text[i] === ')') depth--; i++; }
  return text.slice(at, i).replace(/\s+/g, ' ');
}

/**
 * The literal colours of one file of app/ (its path says .css or .js), each with its line.
 * @param {string} src @param {string} path @returns {{ line: number, text: string }[]}
 */
export function literalColours(src, path) {
  /** @type {{ line: number, text: string }[]} */
  const found = [];
  const scan = (/** @type {string} */ text, /** @type {number} */ line, /** @type {boolean} */ css) => {
    // Comments blanked, their line breaks kept (the lines after them stay right).
    const bare = css ? text.replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, ' ')) : text;
    for (const m of bare.matchAll(css ? IN_CSS : IN_CODE)) {
      found.push({ line: line + (bare.slice(0, m.index).match(/\n/g)?.length ?? 0), text: whole(bare, m.index, m[0]) });
    }
  };
  if (path.endsWith('.css')) scan(src, 1, true);
  else tokenize(src, (text, line, tag) => scan(text, line, tag === 'css'));
  return found;
}

/** The literal colours of app/, by file (those with none left out), the tokens aside. @returns {Map<string, { line: number, text: string }[]>} */
function appColours(root = ROOT) {
  const files = readdirSync(join(root, 'app'), { recursive: true, encoding: 'utf8' })
    .map(f => 'app/' + f.split('\\').join('/')).filter(f => /\.(css|js)$/.test(f) && f !== TOKENS).sort();
  const out = new Map();
  for (const file of files) {
    const colours = literalColours(readFileSync(join(root, file), 'utf8'), file);
    if (colours.length) out.set(file, colours);
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const update = process.argv.includes('--update');
  const now = appColours();
  /** @type {{ total: number, files: Record<string, number> } | null} */
  let baseline = null;
  try { baseline = JSON.parse(readFileSync(BASELINE, 'utf8')); } catch { /* none yet */ }
  const allowed = (/** @type {string} */ file) => baseline?.files?.[file] ?? 0;
  const count = (/** @type {string} */ file) => now.get(file)?.length ?? 0;
  const colours = (/** @type {number} */ n) => `${n} literal colour${n === 1 ? '' : 's'}`;
  const files = [...new Set([...now.keys(), ...Object.keys(baseline?.files || {})])].sort();
  const over = files.filter(f => count(f) > allowed(f));
  const under = files.filter(f => count(f) < allowed(f));
  const total = files.reduce((a, f) => a + count(f), 0);
  if (update) {
    for (const f of baseline ? over : []) console.log(`::error file=${f}::${f}: ${colours(count(f))}, more than the baseline (${allowed(f)}); the baseline only goes down`);
    if (baseline && over.length) process.exit(1);
    const counts = Object.fromEntries(files.filter(count).map(f => [f, count(f)]));
    writeFileSync(BASELINE, JSON.stringify({ total, files: counts }, null, 2) + '\n');
    console.log(`tools/colour-baseline.json: ${baseline?.total ?? 'none'} → ${colours(total)}`);
    process.exit(0);
  }
  if (!baseline) {
    console.log('::error::no tools/colour-baseline.json: write it with node tools/colour-ratchet.mjs --update');
    process.exit(1);
  }
  for (const f of over) {
    for (const c of now.get(f) || []) console.log(`  ${f}:${c.line}  ${c.text}`);
    console.log(`::error file=${f}::${f}: ${colours(count(f))}, the baseline allows ${allowed(f)} (lines above): use a token of ${TOKENS} (var(--gf-…)); a colour with no CSS where it is drawn (a map's paint, a chart), raise tools/colour-baseline.json by hand in this pull request, saying why`);
  }
  for (const f of under) {
    console.log(`::error file=tools/colour-baseline.json::${f}: ${colours(count(f))}, the baseline says ${allowed(f)}: lower it (node tools/colour-ratchet.mjs --update)`);
  }
  if (over.length || under.length) process.exit(1);
  console.log(`${colours(total)} in ${now.size} files of app/, as tools/colour-baseline.json (${TOKENS} aside: the tokens)`);
}
