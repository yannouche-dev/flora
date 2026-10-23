// @ts-check
// Case- and accent-insensitive text, as the search compares it: « Œillet », « oeillet » and « ŒILLET » are one word;
// and a botanical name as it is ordered, without its hybrid sign (unsigned). Shared by the search worker, the
// highlighting of what it found and the lists filtered or ordered as one types.

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

/**
 * A botanical name as it is ordered: its hybrid sign set aside, kept where it is shown. « × Leontoroides » goes
 * at L, « x Leontoroides hispidaster » among the Leontodon, « Alisma x rhicnocarpum » and « × rhicnocarpum » at
 * their epithet, a formula (« Arum italicum x Arum maculatum ») right after its first parent. Only a sign standing
 * alone goes: « Xanthium », « xylosteum » keep their x (the collator puts « × » and « x » before every letter).
 * @param {unknown} name
 */
export const unsigned = name => String(name ?? '').replace(/(^|\s)[×x](?=\s)/g, '$1').replace(/\s+/g, ' ').trim();

/** A hybrid's name (« × Leontoroides », « × rhicnocarpum », « Alisma x rhicnocarpum »): its sign standing alone. @param {unknown} name */
export const signed = name => /(^|\s)[×x]\s/.test(String(name ?? ''));
