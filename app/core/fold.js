// @ts-check
// Case- and accent-insensitive text, as the search compares it: « Œillet », « oeillet » and « ŒILLET » are one word.
// Shared by the search worker, the highlighting of what it found and the lists filtered as one types.

/** Letters that are not a base letter plus accents: lowercase first (« Œ » → « œ »), then spelled out. */
const SPELLED = /** @type {Record<string, string>} */ ({ œ: 'oe', æ: 'ae', ß: 'ss', ø: 'o', ł: 'l', đ: 'd', ð: 'd', þ: 'th' });

/** Lowercase, ligatures spelled out, accents removed; anything else kept as it is. @param {unknown} value */
export const foldLetters = value => String(value ?? '')
  .toLowerCase()
  .replace(/[œæßøłđðþ]/g, char => SPELLED[char])
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '');

/** Folded letters and digits, any other run of characters a single space: the words the search compares. @param {unknown} value */
export const fold = value => foldLetters(value).replace(/[^a-z0-9]+/g, ' ').trim();
