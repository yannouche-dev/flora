// @ts-check
// French typography for the text the app shows: fr(t) puts a narrow no-break space (U+202F) before : ; ! ? » and
// after «, so a line never starts with « : » nor ends on « ». Used by the start screens (components/start-screen.js),
// the launcher, the mini-apps' frame and steps, and Faux amis. Strings only; no imports.

/**
 * French spacing: a narrow no-break space before : ; ! ? » and after «, so a line never starts with « : ».
 * Strings only. @template T @param {T} t @returns {T}
 */
export const fr = t => /** @type {any} */ (typeof t === 'string' ? t.replace(/ ([:;!?»])/g, ' $1').replace(/« /g, '« ') : t);
