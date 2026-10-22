// @ts-check
// « Disposition libre »: a screen written in its address, #/layout/<layout>?<state> (gf-layout.js). This module is the
// grammar of <layout> only — pure (no DOM, no registry: names are words here, registry.js says what they are), tested
// under Node (tests/unit/layout-grammar.test.mjs).
//
//   layout := '[' items ']' | items          the outer brackets may be left out: « map,search » is « [map,search] »
//   items  := node ( ',' node )*
//   node   := ( '[' items ']' | cell ) ( '@' number '%'? )?
//   cell   := name ( ( '.' | ':' ) view )? ( '(' param ( ( ',' | ';' ) param )* ')' )?
//   param  := key '=' value | value          a bare value is the component's main parameter: map(20km) = map(r=20km)
//
// The top level lays its nodes side by side (columns, left to right); a list inside splits that column into rows (top to
// bottom); a list in a row splits it into columns again, and so on, the direction turning at each level (dirAt), down
// to MAX_DEPTH. `@n` is a node's share of its parent, in % (the others share what is left). Spaces are free, names and
// views are words of letters, digits, « - » and « _ » (accents kept here, folded by the registry); a value is any run
// of characters but , ; ( ) [ ] = @ (a comma between two digits is a decimal one: « r=2,5km ») — never one of the
// separators, and serialize() writes « ; » where its « , » would sit between two digits (annee=2020;3d=1), so every
// layout round-trips: serialize(parse(s)) is the canonical text, and parse(serialize(t)) gives t back. Percent-encoded
// text (a link copied and pasted) is read as decoded.
//
// Never a throw: whatever is typed, parse() returns the best layout it can read and the problems it met (`errors`,
// each with its position and a sentence in French): a bracket missing is closed, a character out of place skipped, a
// list too deep flattened, cells past MAX_CELLS left out, an empty one dropped.
//
// The editor's operations (replace a cell, move it among its siblings, give a split its shares) work on this tree too,
// each returning a new, normalized one; « Modifier la disposition » splits and removes cells as boxes (builder-grid.js).

/**
 * @typedef {{ key: string | null, value: string }} Param
 * @typedef {{ t: 'cell', name: string, view: string | null, params: Param[], size: number | null, at?: number }} CellNode
 * @typedef {{ t: 'list', kids: LayoutNode[], size: number | null, at?: number }} ListNode
 * @typedef {CellNode | ListNode} LayoutNode
 * @typedef {{ at: number, message: string }} Problem
 * @typedef {{ tree: ListNode, errors: Problem[] }} Parsed
 * @typedef {'row' | 'col'} Dir   row: side by side (columns); col: one under the other (rows)
 */

/** Lists inside lists, at most (the top level is depth 0: columns; 1: rows of a column; 2: columns of a row…). */
export const MAX_DEPTH = 3;
/** Cells on one screen, at most. */
export const MAX_CELLS = 12;
/** Characters of a layout, at most (an address stays an address). */
export const MAX_LENGTH = 800;

/** How a list at `depth` lays its nodes: the top level side by side, then turning at each level. @param {number} depth @returns {Dir} */
export const dirAt = depth => depth % 2 === 0 ? 'row' : 'col';

/** Characters of a name or a view (letters with or without accents, digits, « - », « _ »). */
const WORD = /[\p{L}\p{N}_-]/u;
/** Characters a value may not hold: the separators of the grammar. */
const NOT_VALUE = new Set([',', ';', '(', ')', '[', ']', '=', '@']);

/** A cell. @param {string} name @param {string | null} [view] @param {Param[]} [params] @param {number | null} [size] @returns {CellNode} */
export const cell = (name, view = null, params = [], size = null) => ({ t: 'cell', name, view, params, size });
/** A list. @param {LayoutNode[]} kids @param {number | null} [size] @returns {ListNode} */
export const list = (kids, size = null) => ({ t: 'list', kids, size });

/** Text as typed or copied: percent-encoding undone (a `%` that encodes nothing stays as it is). @param {string} text */
function decode(text) {
  if (!/%[0-9a-f]{2}/i.test(text)) return text;
  try { return decodeURIComponent(text); } catch { return text.replace(/%([0-9a-f]{2})/gi, (m, h) => { try { return decodeURIComponent(m); } catch { return String.fromCharCode(parseInt(h, 16)); } }); }
}

/**
 * Reads a layout. Never throws: the layout it could read, and what was wrong (in the order met).
 * @param {unknown} input @returns {Parsed}
 */
export function parse(input) {
  /** @type {Problem[]} */
  const errors = [];
  let s = decode(String(input ?? '')).trim();
  if (s.length > MAX_LENGTH) {
    errors.push({ at: MAX_LENGTH, message: `Disposition trop longue : lue jusqu’au caractère ${MAX_LENGTH}.` });
    s = s.slice(0, MAX_LENGTH);
  }
  let i = 0;
  const fail = (/** @type {string} */ message, at = i) => { errors.push({ at, message }); };
  const space = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const word = () => { const start = i; while (i < s.length && WORD.test(s[i])) i++; return s.slice(start, i); };
  const show = (/** @type {string} */ c) => c === undefined ? 'la fin' : `« ${c} »`;

  /** @returns {Param[]} */
  const params = () => {
    /** @type {Param[]} */
    const out = [];
    i++; // (
    for (;;) {
      space();
      if (i >= s.length) { fail('Parenthèse fermante « ) » manquante.'); return out; }
      if (s[i] === ')') { i++; return out; }
      if (s[i] === ']') { fail('Parenthèse fermante « ) » manquante avant « ] ».'); return out; }
      if (s[i] === ',' || s[i] === ';') { i++; continue; }
      const start = i;
      // A value runs to the next separator; a comma between two digits is a French decimal one (« r=2,5km »).
      const value = () => {
        let out = '';
        while (i < s.length && (!NOT_VALUE.has(s[i]) || (s[i] === ',' && /\d/.test(s[i - 1] ?? '') && /\d/.test(s[i + 1] ?? '')))) out += s[i++];
        return out;
      };
      let text = value();
      /** @type {string | null} */
      let key = null;
      if (s[i] === '=') {
        key = text.trim();
        i++;
        text = value();
      }
      const read = text.trim();
      if (key !== null && !key) fail('Paramètre sans nom avant « = ».', start);
      else if (key !== null && !read) fail(`Paramètre « ${key} » sans valeur.`, start);
      else if (key === null && !read) {
        // Not a value, not a separator: skipped (« map(@) »).
        if (i < s.length && s[i] !== ')' && s[i] !== ']') { fail(`Caractère ${show(s[i])} inattendu dans les paramètres.`); i++; }
        continue;
      } else out.push({ key: key === null ? null : key.toLowerCase(), value: read });
      if (i < s.length && s[i] === '=') { fail('Un seul « = » par paramètre.'); while (i < s.length && !',;)]'.includes(s[i])) i++; }
    }
  };

  /** A share « @30 » or « @30% ». @returns {number | null} */
  const size = () => {
    space();
    if (s[i] !== '@') return null;
    const start = i++;
    space();
    const m = /^\d+(?:[.,]\d+)?/.exec(s.slice(i));
    if (!m) { fail('Taille attendue après « @ » (un pourcentage : @30).', start); return null; }
    i += m[0].length;
    if (s[i] === '%') i++;
    const n = Number(m[0].replace(',', '.'));
    if (!(n > 0)) { fail('Une taille est plus grande que 0.', start); return null; }
    return Math.min(n, 1000);
  };

  /** @param {number} depth @returns {LayoutNode | null} */
  const node = depth => {
    space();
    const at = i;
    /** @type {LayoutNode} */
    let n;
    if (s[i] === '[') {
      i++;
      const kids = items(depth + 1);
      if (s[i] === ']') i++;
      else fail('Crochet fermant « ] » manquant.', at);
      n = { t: 'list', kids, size: null, at };
    } else {
      const name = word();
      if (!name) return null;
      /** @type {string | null} */
      let view = null;
      space();
      if (s[i] === '.' || s[i] === ':') {
        i++;
        const parts = [word()];
        while ((s[i] === '.' || s[i] === ':') && WORD.test(s[i + 1] ?? '')) { i++; parts.push(word()); }
        if (!parts[0]) fail(`Bloc attendu après « ${name}${s[i - 1]} ».`, at);
        else view = parts.join('.');
      }
      space();
      n = { t: 'cell', name, view, params: s[i] === '(' ? params() : [], size: null, at };
    }
    n.size = size();
    return n;
  };

  /** @param {number} depth @returns {LayoutNode[]} */
  const items = depth => {
    /** @type {LayoutNode[]} */
    const out = [];
    for (;;) {
      space();
      if (i >= s.length || s[i] === ']') return out;
      if (s[i] === ',') { i++; continue; }
      const n = node(depth);
      if (n) out.push(n);
      else { fail(`Caractère ${show(s[i])} inattendu : un composant (map, search…) ou « [ » était attendu.`); i++; }
      space();
      if (i >= s.length || s[i] === ']') return out;
      if (s[i] === ',') { i++; continue; }
      // Something glued to a node (« map search »): said, and read as the next node.
      if (!WORD.test(s[i]) && s[i] !== '[') { fail(`Caractère ${show(s[i])} inattendu.`); i++; }
      else fail(`Virgule attendue avant ${show(s[i])}.`);
    }
  };

  const top = items(0);
  while (i < s.length) {
    // A « ] » with nothing open: skipped, and what follows read as more columns.
    fail('Crochet « ] » en trop.');
    i++;
    top.push(...items(0));
  }
  // One list alone at the top: the layout's own brackets (« [a,b] » is « a,b »).
  const root = top.length === 1 && top[0].t === 'list' && top[0].size === null ? { ...top[0], size: null } : list(top);
  const tree = normalize(/** @type {ListNode} */ (root), errors);
  if (!countCells(tree)) errors.push({ at: 0, message: 'Disposition vide : aucun composant.' });
  return { tree, errors };
}

/** @param {LayoutNode} n @returns {number} */
const countCells = n => n.t === 'cell' ? 1 : n.kids.reduce((a, k) => a + countCells(k), 0);

/**
 * The tree made sound: an empty list dropped, a list of one cell replaced by the cell (its share kept), lists past
 * MAX_DEPTH flattened into their parent, cells past MAX_CELLS left out. `errors` (when given) hears what was changed
 * that the text said otherwise.
 * @param {ListNode} root @param {Problem[]} [errors] @returns {ListNode}
 */
export function normalize(root, errors = []) {
  let cells = 0;
  /** @param {LayoutNode} n @param {number} depth @returns {LayoutNode[]} the node as it stays (none, one, or its cells) */
  const walk = (n, depth) => {
    if (n.t === 'cell') {
      if (++cells > MAX_CELLS) {
        if (cells === MAX_CELLS + 1) errors.push({ at: n.at ?? 0, message: `Trop de composants : ${MAX_CELLS} au plus, les suivants sont ignorés.` });
        return [];
      }
      return [{ t: 'cell', name: n.name, view: n.view ?? null, params: (n.params || []).map(p => ({ key: p.key ?? null, value: String(p.value) })), size: validSize(n.size), ...(n.at !== undefined ? { at: n.at } : {}) }];
    }
    if (depth > MAX_DEPTH) {
      const flat = n.kids.flatMap(k => walk(k, depth));
      // One cell: the list was only brackets around it.
      if (flat.length > 1) errors.push({ at: n.at ?? 0, message: `Trop d’imbrication : ${MAX_DEPTH} niveaux de crochets au plus, le reste est mis à plat.` });
      return flat.length === 1 ? [{ ...flat[0], size: validSize(n.size) ?? flat[0].size }] : flat;
    }
    const kids = n.kids.flatMap(k => walk(k, depth + 1));
    if (!kids.length) {
      if (depth > 0) errors.push({ at: n.at ?? 0, message: 'Liste vide « [] » ignorée.' });
      return depth === 0 ? [list([], null)] : [];
    }
    // A list of one cell inside another: the cell, with the list's share when it has one.
    if (depth > 0 && kids.length === 1 && kids[0].t === 'cell') return [{ ...kids[0], size: validSize(n.size) ?? kids[0].size }];
    return [{ t: 'list', kids, size: validSize(n.size), ...(n.at !== undefined ? { at: n.at } : {}) }];
  };
  const out = walk(root, 0)[0];
  return out && out.t === 'list' ? { ...out, size: null } : list(out ? [out] : []);
}

/** @param {unknown} n */
const validSize = n => typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : null;

/** A share as written: an integer, else up to one decimal. @param {number} n */
const shareText = n => String(Math.round(n * 10) / 10);

/**
 * The canonical text of a tree: outer brackets, no spaces, `,` between parameters — `;` after a value ending in a digit
 * when the next starts with one (annee=2020;3d=1: a comma there would be read as a decimal one) —, shares when `sizes`
 * (default).
 * @param {ListNode} tree @param {{ sizes?: boolean, params?: boolean }} [options] `params: false`: names and views only
 * @returns {string}
 */
export function serialize(tree, { sizes = true, params = true } = {}) {
  /** The separator before a parameter. @param {Param[]} ps @param {number} i */
  const sep = (ps, i) => i === 0 ? '' : /\d$/.test(ps[i - 1].value) && /^\d/.test(ps[i].key ?? ps[i].value) ? ';' : ',';
  /** @param {LayoutNode} n @returns {string} */
  const text = n => {
    const share = sizes && n.size != null ? '@' + shareText(n.size) : '';
    if (n.t === 'list') return '[' + n.kids.map(text).join(',') + ']' + share;
    const ps = params && n.params.length ? '(' + n.params.map((p, i) => sep(n.params, i) + (p.key ? p.key + '=' : '') + p.value).join('') + ')' : '';
    return n.name + (n.view ? '.' + n.view : '') + ps + share;
  };
  return text(tree);
}

/** Its shape: names and views only — what its saved sizes are kept under (parameters and shares changed, the same). @param {ListNode} tree */
export const shapeKey = tree => serialize(tree, { sizes: false, params: false });

/** Every cell with its path (indices from the top), in reading order. @param {ListNode} tree @returns {{ path: number[], cell: CellNode }[]} */
export function cells(tree) {
  /** @type {{ path: number[], cell: CellNode }[]} */
  const out = [];
  /** @param {LayoutNode} n @param {number[]} path */
  const walk = (n, path) => { if (n.t === 'cell') out.push({ path, cell: n }); else n.kids.forEach((k, j) => walk(k, [...path, j])); };
  walk(tree, []);
  return out;
}

/** The node at a path (null: none). @param {ListNode} tree @param {number[]} path @returns {LayoutNode | null} */
export function nodeAt(tree, path) {
  /** @type {LayoutNode | undefined} */
  let n = tree;
  for (const j of path) n = n?.t === 'list' ? n.kids[j] : undefined;
  return n ?? null;
}

/**
 * The shares of a list's nodes, summing to 1: those given (`@n`), the others sharing what is left (when nothing is
 * left, each the mean of those given). `saved`: shares kept for this list (a separator dragged), used when the text
 * gives none. @param {ListNode} n @param {number[] | null} [saved] @returns {number[]}
 */
export function shares(n, saved = null) {
  const given = n.kids.map(k => k.size);
  if (given.every(x => x == null) && saved && saved.length === n.kids.length && saved.every(x => x > 0)) return unit(saved);
  const known = /** @type {number[]} */ (given.filter(x => x != null));
  const sum = known.reduce((a, b) => a + b, 0);
  const free = given.length - known.length;
  const rest = free ? (sum < 100 ? (100 - sum) / free : (known.length ? sum / known.length : 1)) : 0;
  return unit(given.map(x => x ?? rest));
}

/** @param {number[]} xs */
const unit = xs => { const t = xs.reduce((a, b) => a + b, 0) || 1; return xs.map(x => x / t); };

/** A new tree with the node at `path` replaced by what `fn` makes of it. @param {ListNode} tree @param {number[]} path @param {(n: LayoutNode) => LayoutNode | null} fn @returns {ListNode} */
function edit(tree, path, fn) {
  /** @param {LayoutNode} n @param {number} d @returns {LayoutNode | null} */
  const walk = (n, d) => {
    if (d === path.length) return fn(n);
    if (n.t !== 'list') return n;
    const kids = n.kids.map((k, j) => j === path[d] ? walk(k, d + 1) : k).filter(k => k !== null);
    return { ...n, kids: /** @type {LayoutNode[]} */ (kids) };
  };
  const out = walk(tree, 0);
  return normalize(out && out.t === 'list' ? out : list(out ? [out] : []));
}

/** The node at `path` replaced. @param {ListNode} tree @param {number[]} path @param {LayoutNode} node */
export const replaceAt = (tree, path, node) => edit(tree, path, () => node);

/** The node at `path` moved by `by` among its siblings (−1: before, +1: after). @param {ListNode} tree @param {number[]} path @param {number} by @returns {ListNode} */
export function moveAt(tree, path, by) {
  const parent = nodeAt(tree, path.slice(0, -1));
  const at = path[path.length - 1], to = at + by;
  if (!parent || parent.t !== 'list' || to < 0 || to >= parent.kids.length) return tree;
  const kids = [...parent.kids];
  const [n] = kids.splice(at, 1);
  kids.splice(to, 0, n);
  return path.length === 1 ? normalize({ ...parent, kids }) : replaceAt(tree, path.slice(0, -1), { ...parent, kids });
}

/**
 * The shares of the list at `path`, written as `@n` (in %, rounded; summing to about 100), or taken out (null).
 * @param {ListNode} tree @param {number[]} path @param {number[] | null} sizes @returns {ListNode}
 */
export function setShares(tree, path, sizes) {
  const n = nodeAt(tree, path);
  if (!n || n.t !== 'list' || (sizes && sizes.length !== n.kids.length)) return tree;
  const pct = sizes ? unit(sizes).map(x => Math.max(1, Math.round(x * 1000) / 10)) : null;
  const kids = n.kids.map((k, j) => ({ ...k, size: pct ? pct[j] : null }));
  return path.length ? replaceAt(tree, path, { ...n, kids }) : normalize({ ...n, kids });
}

/** A tree without positions (what the editor compares and tests check). @param {LayoutNode} n @returns {LayoutNode} */
export function strip(n) {
  if (n.t === 'cell') return { t: 'cell', name: n.name, view: n.view, params: n.params.map(p => ({ key: p.key, value: p.value })), size: n.size };
  return { t: 'list', kids: n.kids.map(strip), size: n.size };
}
