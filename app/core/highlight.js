// @ts-check
// Accent-insensitive highlighting: "benoite" marks "Benoîte" in "Benoîte des villes".

import { html } from 'lit';

/** Same folding as the search worker, one character at a time (keeps a map back to the original). */
const fold = (/** @type {string} */ char) => char
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/œ/g, 'oe')
  .replace(/Œ/g, 'oe')
  .replace(/æ/g, 'ae')
  .replace(/Æ/g, 'ae')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, ' ');

/**
 * @param {string | null | undefined} text
 * @param {string} query
 * @returns {unknown} plain text or a template with <mark> around matched parts
 */
export function highlight(text, query) {
  if (!text) return text ?? '';
  const tokens = fold(query).split(' ').filter(token => token.length >= 2);
  if (!tokens.length) return text;

  // folded[k] comes from text[origin[k]]
  let folded = '';
  /** @type {number[]} */
  const origin = [];
  [...text].reduce((offset, char) => {
    for (const f of fold(char)) { folded += f; origin.push(offset); }
    return offset + char.length;
  }, 0);

  /** @type {[number, number][]} */
  const ranges = [];
  for (const token of tokens) {
    // Prefer a match at a word start, as the search does.
    let at = -1;
    for (let i = folded.indexOf(token); i >= 0; i = folded.indexOf(token, i + 1)) {
      if (i === 0 || folded[i - 1] === ' ') { at = i; break; }
      if (at < 0) at = i;
    }
    if (at < 0) continue;
    const start = origin[at];
    const endIndex = at + token.length;
    const end = endIndex < origin.length ? origin[endIndex] : text.length;
    ranges.push([start, end]);
  }
  if (!ranges.length) return text;

  ranges.sort((a, b) => a[0] - b[0]);
  const parts = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start < cursor) continue;
    parts.push(text.slice(cursor, start), html`<mark>${text.slice(start, end)}</mark>`);
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return parts;
}
