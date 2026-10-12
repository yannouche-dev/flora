// @ts-check
// Addresses that come with third-party data (a GBIF record, Wikidata, Wikibooks, API Carto, a data file) and end up
// in a link: only web addresses are kept, never a javascript:, data: or other scheme that would run in the app's
// origin when touched. A defence in depth: the CSP blocks javascript: URLs too.

/**
 * The address when it is an absolute http(s) one (as the browser reads it: spaces, tabs and case left aside), else null:
 * then show the text without a link. @param {unknown} url @returns {string | null}
 */
export function safeUrl(url) {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}
