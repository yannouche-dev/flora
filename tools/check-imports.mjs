// Static check of the app's ES module graph. No build step links the modules: the browser does, from the import
// map of index.html, and `node --check` parses each file alone. A renamed or removed export, or a typo in an import,
// passes it and only fails in the browser, where the whole graph refuses to start: a blank screen, cached offline
// by the service worker.
//   node tools/check-imports.mjs [site]    exits 1 with file:line on each broken import (site: the repository)
// Every .js module under app/, and what they import (lib/), is read. For each relative import and re-export
// (import { a, b as c } from './x.js', import x from, import * as ns from, export … from), the target file exists
// and exports those names: export const/let/var (destructuring too), function, class, async function, export { … },
// export default, and export * re-exports, followed. Members read from a namespace import (db.getAll after
// import * as db) are checked the same way, unless the name is declared again in the module. A dynamic import of
// a literal path must find its file. Bare specifiers must be keys of the import map of index.html (lit, leaflet:
// vendored files, not read), which must be there, valid JSON, each target a ./ path to a file of the site. A small
// lexer, not a parser: comments, strings, template literals and regular expressions are told apart from code, enough
// to find the module syntax, which only appears at the top level. Its limit: a « / » it takes for a regular
// expression where it is a division, followed on the same line by a backtick, opens a template that runs to the next
// backtick (none in the app today: 0 difference with acorn on every module).

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..'));
const ROOTS = ['app'];

/** @typedef {{ t: 'id' | 'str' | 'num' | 'tpl' | 're' | 'p', v: string, line: number, nl: boolean, tpl: number }} Token */

// After these words a « / » starts a regular expression, not a division.
const BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const ID_START = /[A-Za-z_$\u0080-￿]/, ID_PART = /[\w$\u0080-￿]/;

/**
 * Tokens of a module: names, strings (their text), numbers, single-character punctuators; comments left out,
 * regular expressions and template literals as one token each. Tokens inside a template's ${…} carry its depth
 * (tpl > 0): code, but never module syntax.
 * @param {string} src @returns {Token[]}
 */
export function tokenize(src) {
  /** @type {Token[]} */
  const tokens = [];
  /** Open ${ of template literals, each with the count of « { » opened inside it. @type {number[]} */
  const open = [];
  let i = 0, line = 1, nl = false;
  const push = (/** @type {Token['t']} */ t, /** @type {string} */ v, at = line) => { tokens.push({ t, v, line: at, nl, tpl: open.length }); nl = false; };
  const regexAllowed = () => {
    const p = tokens[tokens.length - 1];
    if (!p) return true;
    if (p.t === 'id') return BEFORE_REGEX.has(p.v);
    if (p.t === 'p') return !')]}'.includes(p.v);
    return false;
  };
  /** Text of a template literal from i (after « ` » or « } »), up to its end or its next ${. */
  const templateText = () => {
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { if (src[i + 1] === '\n') line++; i += 2; continue; }
      if (c === '\n') line++;
      if (c === '`') { i++; push('tpl', '`'); return; }
      if (c === '$' && src[i + 1] === '{') { i += 2; open.push(0); return; }
      i++;
    }
  };
  if (src.startsWith('#!')) while (i < src.length && src[i] !== '\n') i++;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; nl = true; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2), stop = end < 0 ? src.length : end + 2;
      for (; i < stop; i++) if (src[i] === '\n') { line++; nl = true; }
      continue;
    }
    if (c === '"' || c === "'") {
      const at = line;
      let j = i + 1, text = '';
      while (j < src.length && src[j] !== c && src[j] !== '\n') {
        if (src[j] === '\\') { if (src[j + 1] === '\n') line++; text += src[j + 1]; j += 2; } else text += src[j++];
      }
      // A quote left open (the lexer took a regex for a division) ends at the line break, still counted.
      i = src[j] === c ? j + 1 : j;
      push('str', text, at);
      continue;
    }
    if (c === '`') { i++; templateText(); continue; }
    if (c === '}' && open.length && open[open.length - 1] === 0) { open.pop(); i++; templateText(); continue; }
    if (c === '/' && regexAllowed()) {
      let j = i + 1, inClass = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\' && src[j + 1] !== '\n') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j++;
      }
      // No closing « / » on the line: a division after all (of / 2, i++ / 2), and the next line is code.
      if (src[j] !== '/') { push('p', '/'); i++; continue; }
      j++;
      while (j < src.length && ID_PART.test(src[j])) j++;
      push('re', src.slice(i, j));
      i = j;
      continue;
    }
    if (ID_START.test(c) || (c === '#' && ID_START.test(src[i + 1] || ''))) {
      let j = i + 1;
      while (j < src.length && ID_PART.test(src[j])) j++;
      push('id', src.slice(i, j));
      i = j;
      continue;
    }
    if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] || ''))) {
      let j = i + 1;
      while (j < src.length && /[\w.]/.test(src[j])) j++;
      push('num', src.slice(i, j));
      i = j;
      continue;
    }
    if (c === '.' && src[i + 1] === '.' && src[i + 2] === '.') { push('p', '...'); i += 3; continue; }
    if (open.length && c === '{') open[open.length - 1]++;
    if (open.length && c === '}') open[open.length - 1]--;
    push('p', c);
    i++;
  }
  return tokens;
}

/**
 * What a module imports and exports, from its top-level tokens.
 * @param {Token[]} all
 */
export function moduleSyntax(all) {
  const tokens = all.filter(t => t.tpl === 0);
  /** @type {{ spec: string, line: number, names: { name: string, line: number }[], local?: string, dynamic?: boolean }[]} */
  const imports = [];
  /** Names declared by the module's own export statements. */
  const exports = new Set();
  /** export * from: their names (default aside) are the module's too. @type {string[]} */
  const stars = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i], prev = tokens[i - 1];
    if (tok.t === 'p') {
      if ('([{'.includes(tok.v)) depth++;
      else if (')]}'.includes(tok.v)) depth = Math.max(0, depth - 1);
      continue;
    }
    if (tok.t !== 'id' || (prev?.t === 'p' && prev.v === '.')) continue;
    const at = (/** @type {number} */ k) => tokens[k] || { t: 'p', v: '', line: tok.line, nl: false, tpl: 0 };
    const is = (/** @type {number} */ k, /** @type {string} */ v) => at(k).v === v && (at(k).t === 'p' || at(k).t === 'id');

    if (tok.v === 'import' && is(i + 1, '(') && at(i + 2).t === 'str' && is(i + 3, ')')) {
      imports.push({ spec: at(i + 2).v, line: tok.line, names: [], dynamic: true });
      continue;
    }
    if (depth !== 0) continue;

    if (tok.v === 'import' && !is(i + 1, '(') && !is(i + 1, '.')) {
      let k = i + 1;
      /** @type {{ name: string, line: number }[]} */
      const names = [];
      let local;
      if (at(k).t !== 'str') {
        if (at(k).t === 'id' && at(k).v !== 'from') { names.push({ name: 'default', line: at(k).line }); k++; if (is(k, ',')) k++; }
        if (is(k, '*')) { local = at(k + 2).v; k += 3; }
        if (is(k, '{')) {
          k++;
          while (k < tokens.length && !is(k, '}')) {
            if (at(k).t === 'id' || at(k).t === 'str') { names.push({ name: at(k).v, line: at(k).line }); k += is(k + 1, 'as') ? 3 : 1; }
            if (is(k, ',')) k++;
            else if (!is(k, '}')) k++;
          }
          k++;
        }
        if (!is(k, 'from')) continue;
        k++;
      }
      if (at(k).t === 'str') imports.push({ spec: at(k).v, line: tok.line, names, local });
      i = k;
      continue;
    }

    if (tok.v !== 'export') continue;
    let k = i + 1;
    if (is(k, '*')) {
      // export * from 'x' | export * as ns from 'x'
      if (is(k + 1, 'as')) { exports.add(at(k + 2).v); k += 3; } else k++;
      if (is(k, 'from') && at(k + 1).t === 'str') {
        if (!is(i + 2, 'as')) stars.push(at(k + 1).v);
        imports.push({ spec: at(k + 1).v, line: tok.line, names: [] });
      }
      i = k + 1;
      continue;
    }
    if (is(k, '{')) {
      // export { a, b as c } [from 'x']
      k++;
      /** @type {{ name: string, line: number }[]} */
      const names = [];
      while (k < tokens.length && !is(k, '}')) {
        if (at(k).t === 'id' || at(k).t === 'str') {
          names.push({ name: at(k).v, line: at(k).line });
          if (is(k + 1, 'as')) { exports.add(at(k + 2).v); k += 3; } else { exports.add(at(k).v); k++; }
        } else k++;
      }
      k++;
      if (is(k, 'from') && at(k + 1).t === 'str') { imports.push({ spec: at(k + 1).v, line: tok.line, names }); i = k + 1; } else i = k - 1;
      continue;
    }
    if (is(k, 'default')) { exports.add('default'); continue; }
    if (is(k, 'async')) k++;
    if (is(k, 'function') || is(k, 'class')) {
      k++;
      if (is(k, '*')) k++;
      if (at(k).t === 'id') exports.add(at(k).v);
      continue;
    }
    if (is(k, 'const') || is(k, 'let') || is(k, 'var')) {
      // Declarators: a name or a destructuring pattern, then an initializer up to a comma at this level.
      k++;
      for (;;) {
        k = bindings(tokens, k, exports);
        let d = 0;
        while (k < tokens.length) {
          const t = tokens[k];
          if (t.t === 'p' && '([{'.includes(t.v)) d++;
          else if (t.t === 'p' && ')]}'.includes(t.v)) d--;
          else if (d === 0 && t.t === 'p' && (t.v === ',' || t.v === ';')) break;
          // A statement without its semicolon: the next one starts on a new line with a keyword.
          else if (d === 0 && t.nl && t.t === 'id' && ['export', 'import', 'const', 'let', 'var', 'function', 'class'].includes(t.v)) break;
          k++;
        }
        if (!(at(k).t === 'p' && at(k).v === ',')) break;
        k++;
      }
      i = k - 1;
    }
  }
  return { imports, exports, stars };
}

/**
 * Names bound by a declarator's target from k (a name, { a, b: c, d = 1, ...e }, [a, , b]): added to `out`.
 * Returns the index after the pattern.
 * @param {Token[]} tokens @param {number} k @param {Set<string>} out
 */
function bindings(tokens, k, out) {
  const t = tokens[k];
  if (!t) return k;
  if (t.t === 'id') { out.add(t.v); return k + 1; }
  if (t.t !== 'p' || (t.v !== '{' && t.v !== '[')) return k + 1;
  const close = t.v === '{' ? '}' : ']';
  k++;
  while (k < tokens.length && !(tokens[k].t === 'p' && tokens[k].v === close)) {
    const cur = tokens[k];
    if (cur.t === 'p' && (cur.v === ',' || cur.v === '...')) { k++; continue; }
    // { key: target }: the target binds, the key does not.
    if (t.v === '{' && (cur.t === 'id' || cur.t === 'str' || cur.t === 'num') && tokens[k + 1]?.t === 'p' && tokens[k + 1].v === ':') k += 2;
    else if (t.v === '{' && cur.t === 'p' && cur.v === '[') k = skip(tokens, k) + 2;
    k = bindings(tokens, k, out);
    // A default value: skipped to the next comma of this pattern.
    if (tokens[k]?.t === 'p' && tokens[k].v === '=') {
      k++;
      let d = 0;
      while (k < tokens.length) {
        const x = tokens[k];
        if (x.t === 'p' && '([{'.includes(x.v)) d++;
        else if (x.t === 'p' && ')]}'.includes(x.v)) { if (d === 0) break; d--; }
        else if (d === 0 && x.t === 'p' && x.v === ',') break;
        k++;
      }
    }
  }
  return k + 1;
}

/** Index of the bracket closing the one at k. @param {Token[]} tokens @param {number} k */
function skip(tokens, k) {
  let d = 0;
  for (; k < tokens.length; k++) {
    const x = tokens[k];
    if (x.t === 'p' && '([{'.includes(x.v)) d++;
    else if (x.t === 'p' && ')]}'.includes(x.v) && --d === 0) return k;
  }
  return k;
}

// ── The graph ──────────────────────────────────────────────────────────────────────────────────────────────

/** @type {Map<string, { tokens: Token[], syntax: ReturnType<typeof moduleSyntax> }>} */
const modules = new Map();
/** @param {string} file absolute */
function read(file) {
  let m = modules.get(file);
  if (!m) {
    const tokens = tokenize(readFileSync(file, 'utf8'));
    m = { tokens, syntax: moduleSyntax(tokens) };
    modules.set(file, m);
  }
  return m;
}

/** Every name a module exports, export * followed (default aside, as the language does). @param {string} file @param {Set<string>} [seen] */
function exportsOf(file, seen = new Set()) {
  if (seen.has(file)) return new Set();
  seen.add(file);
  const { syntax } = read(file);
  const names = new Set(syntax.exports);
  for (const spec of syntax.stars) {
    const target = resolve(dirname(file), spec);
    if (isModule(target)) for (const n of exportsOf(target, seen)) if (n !== 'default') names.add(n);
  }
  return names;
}

const isModule = (/** @type {string} */ f) => /\.m?js$/.test(f) && existsSync(f) && statSync(f).isFile();
const show = (/** @type {string} */ f) => relative(SITE, f) || f;

/**
 * Keys of the import map of index.html (bare specifiers the browser resolves); null without index.html, or without
 * a map to read. A map missing or not JSON, or a target that is no file of the site, is an error on index.html: the
 * browser then resolves no bare specifier, or fetches a 404, and the app does not start.
 * @param {(file: string, line: number, message: string) => void} error
 */
function importMap(error) {
  const index = join(SITE, 'index.html');
  if (!existsSync(index)) return null;
  // Comments blanked, offsets kept: a comment may name a <script>.
  const html = readFileSync(index, 'utf8').replace(/<!--[\s\S]*?-->/g, c => c.replace(/[^\n]/g, ' '));
  // Every <script type="importmap"> (the browser merges them) — that type exactly, not importmap-shim or data-type.
  const scripts = [...html.matchAll(/<script\b(?=[^>]*?\stype\s*=\s*(["']?)importmap\1(?=[\s/>]))[^>]*>([\s\S]*?)<\/script\s*>/gi)];
  const lineAt = (/** @type {number} */ at) => html.slice(0, at).split('\n').length;
  if (!scripts.length) { error(index, 1, 'no <script type="importmap">: bare specifiers (lit, leaflet) resolve to nothing'); return null; }
  /** @type {string[]} */
  const keys = [];
  for (const script of scripts) {
    const at = /** @type {number} */ (script.index);
    let map;
    try { map = JSON.parse(script[2]); } catch (e) { error(index, lineAt(at), `the import map is not valid JSON (${/** @type {Error} */ (e).message})`); return null; }
    const { imports, scopes } = map || {};
    const isMap = (/** @type {any} */ m) => m && typeof m === 'object' && !Array.isArray(m);
    if (!isMap(imports)) { error(index, lineAt(at), 'the import map has no « imports » object'); return null; }
    /** @param {Record<string, unknown>} entries @param {string} where */
    const check = (entries, where) => {
      for (const [key, target] of Object.entries(entries)) {
        const line = lineAt(at + Math.max(0, script[0].indexOf(JSON.stringify(key))));
        const bad = (/** @type {string} */ why) => error(index, line, `import map${where}: « ${key} » → « ${target} »: ${why}`);
        // The browser takes ./ and ../ paths (or full URLs): it ignores « vendor/x.js », and « /x.js » leaves the sub-path.
        if (typeof target !== 'string' || !/^\.\.?\//.test(target)) { bad('not a relative path (./…) to a file of the site'); continue; }
        if (key.endsWith('/') !== target.endsWith('/')) { bad('a key ending in « / » maps to a folder ending in « / », and only it'); continue; }
        let path = target.replace(/[?#].*/, '');
        try { path = decodeURIComponent(path); } catch { bad('not a valid URL path'); continue; }
        const file = resolve(SITE, path);
        if (/^\.\.(\/|$)/.test(relative(SITE, file))) { bad('outside the site'); continue; }
        if (!existsSync(file) || statSync(file).isDirectory() !== key.endsWith('/')) bad(`${show(file)} not found`);
      }
    };
    check(imports, '');
    keys.push(...Object.keys(imports));
    if (scopes !== undefined) {
      if (!isMap(scopes)) error(index, lineAt(at), 'the import map\'s « scopes » is not an object');
      else for (const [scope, entries] of Object.entries(scopes)) {
        if (isMap(entries)) check(/** @type {Record<string, unknown>} */ (entries), ` (scope ${scope})`);
        else error(index, lineAt(at), `the import map's scope « ${scope} » is not an object`);
      }
    }
  }
  return keys;
}

/** @param {string} dir @returns {string[]} */
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : /\.m?js$/.test(e.name) ? [join(dir, e.name)] : []).sort();

function main() {
  let errors = 0, checked = 0;
  /** @param {string} file @param {number} line @param {string} message */
  const error = (file, line, message) => { errors++; console.log(`::error file=${show(file)},line=${line}::${show(file)}:${line}: ${message}`); };
  const bare = importMap(error);
  const queue = ROOTS.flatMap(r => existsSync(join(SITE, r)) ? walk(join(SITE, r)) : []);
  if (!queue.length) { console.log(`::error::check-imports: no module under ${ROOTS.join(', ')} in ${SITE}`); process.exitCode = 1; return; }
  const done = new Set();
  while (queue.length) {
    const file = /** @type {string} */ (queue.shift());
    if (done.has(file)) continue;
    done.add(file);
    const { tokens, syntax } = read(file);
    for (const imp of syntax.imports) {
      checked++;
      if (!/^\.{0,2}\//.test(imp.spec)) {
        if (imp.dynamic && /^[a-z]+:/i.test(imp.spec)) continue;
        if (bare && !bare.some(k => k === imp.spec || (k.endsWith('/') && imp.spec.startsWith(k)))) error(file, imp.line, `« ${imp.spec} » is neither a relative path nor a key of the import map of index.html`);
        continue;
      }
      if (imp.spec.startsWith('/')) { error(file, imp.line, `« ${imp.spec} »: an absolute path breaks under the site's sub-path, write it relative`); continue; }
      const target = resolve(dirname(file), imp.spec);
      if (!existsSync(target) || !statSync(target).isFile()) { error(file, imp.line, `« ${imp.spec} » not found (${show(target)})`); continue; }
      if (!isModule(target)) continue;
      queue.push(target);
      const names = exportsOf(target);
      for (const { name, line } of imp.names) if (!names.has(name)) error(file, line, `« ${imp.spec} » does not export « ${name} »`);
      // import * as ns: ns.member must be exported too (an undefined function only fails when called).
      if (imp.local && !declaresAgain(tokens, imp.local)) {
        for (let k = 0; k < tokens.length - 2; k++) {
          const t = tokens[k], before = tokens[k - 1];
          if (t.t !== 'id' || t.v !== imp.local || (before?.t === 'p' && before.v === '.')) continue;
          const dot = tokens[k + 1], member = tokens[k + 2];
          if (dot.t === 'p' && dot.v === '.' && member.t === 'id' && !names.has(member.v)) error(file, member.line, `« ${imp.spec} » (imported as ${imp.local}) does not export « ${member.v} »`);
        }
      }
    }
  }
  console.log(`check-imports: ${done.size} modules, ${checked} imports checked${errors ? `, ${errors} broken` : ', all resolved'}.`);
  if (errors) process.exitCode = 1;
}

/**
 * Is a namespace's name bound again in the module (a parameter, a variable, a property shorthand in a pattern)?
 * Then its members are not checked: they may be someone else's.
 * @param {Token[]} tokens @param {string} name
 */
function declaresAgain(tokens, name) {
  let seen = 0;
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.t !== 'id' || t.v !== name) continue;
    const before = tokens[k - 1], after = tokens[k + 1];
    if (before?.t === 'p' && before.v === '.') continue;
    // import * as name: the binding itself.
    if (before?.t === 'id' && before.v === 'as' && !seen++) continue;
    if (before?.t === 'id' && ['const', 'let', 'var', 'function', 'class'].includes(before.v)) return true;
    if (after?.t === 'p' && (after.v === ',' || after.v === ')' || after.v === '=') && before?.t === 'p' && (before.v === '(' || before.v === ',' || before.v === '{')) return true;
    if (after?.t === 'p' && after.v === '=' && tokens[k + 2]?.t === 'p' && tokens[k + 2].v === '>') return true;
  }
  return false;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
