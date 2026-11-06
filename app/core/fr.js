// @ts-check
// French typography for the text the app shows: fr(t) puts a narrow no-break space (U+202F) before : ; ! ? » and
// after «, so a line never starts with « : » nor ends on « ». Used by the start screens (components/start-screen.js),
// the list of Découvrir, the activities' frame and steps, and Faux amis. And a number and its word (counted), wherever
// the app counts. Strings only; no imports.

/**
 * French spacing: a narrow no-break space before : ; ! ? » and after «, so a line never starts with « : ».
 * Strings only. @template T @param {T} t @returns {T}
 */
export const fr = t => /** @type {any} */ (typeof t === 'string' ? t.replace(/ ([:;!?»])/g, ' $1').replace(/« /g, '« ') : t);

/**
 * A number and its word, as the app says them: « 1 couche », « 660 couches », « 1 000 couches » (the French grouping);
 * 0 and 1 singular. @param {number} n @param {string} word
 */
export const counted = (n, word) => `${n.toLocaleString('fr-FR')} ${word}${n > 1 ? 's' : ''}`;
