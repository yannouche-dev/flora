// @ts-check
// The credit an image owes: who took it, under what licence, from where. CC BY and CC BY-SA require it; CC0 and the
// public domain do not, and get no « © » (nothing is reserved). One wording for the cards, the map and the sheet.

/**
 * The licences an iNaturalist photo is shown under: CC0, CC BY, CC BY-SA — as the media viewer and the plant
 * sheet (lib/plant-sources.mjs): never NC, ND or « all rights reserved » (no code), which iNaturalist sets by default.
 */
export const INAT_FREE = /^(cc0|cc-by|cc-by-sa)$/i;

/** @typedef {{ author: string | null, license: string | null, source: string, sourceUrl?: string | null }} Credit */

const INAT_LICENSES = /** @type {Record<string, string>} */ ({ cc0: 'CC0', 'cc-by': 'CC BY', 'cc-by-sa': 'CC BY-SA' });

/**
 * An iNaturalist photo's credit, null when its licence is not free (the photo is then not shown).
 * Its author: `attribution_name`, else the name in « (c) Jane Doe, some rights reserved (CC BY) ».
 * @param {any} photo an iNaturalist photo record @param {string | null} [pageUrl] the observation it belongs to
 * @returns {Credit | null}
 */
export function inatCredit(photo, pageUrl = null) {
  const code = String(photo?.license_code || '').toLowerCase();
  if (!INAT_FREE.test(code)) return null;
  const named = String(photo.attribution || '').replace(/^\s*(\(c\)|©)\s*/i, '').split(',')[0].trim();
  const author = String(photo.attribution_name || '').trim() || (/rights reserved|copyright/i.test(named) ? '' : named) || null;
  return { author, license: INAT_LICENSES[code], source: 'iNaturalist', sourceUrl: pageUrl || (photo.id ? `https://www.inaturalist.org/photos/${photo.id}` : null) };
}

/** A licence as people read it: « CC BY-SA 4.0 » for its creativecommons.org address, « CC BY » for « cc-by ». @param {string | null | undefined} license */
export function licenseLabel(license) {
  const l = String(license || '').trim();
  const cc = /creativecommons\.org\/licenses\/(by(?:-sa)?)\/(\d(?:\.\d)?)/i.exec(l);
  if (cc) return `CC ${cc[1].toUpperCase()} ${cc[2]}`;
  if (/creativecommons\.org\/publicdomain\/zero/i.test(l)) return 'CC0';
  if (/creativecommons\.org\/publicdomain\/mark/i.test(l)) return 'Domaine public';
  return INAT_LICENSES[l.toLowerCase()] || l;
}

/** Nothing reserved (CC0, the public domain): no « © ». @param {string | null | undefined} license */
export const unreserved = license => /^(cc0|pd\b|public domain|domaine public|no restrictions)|publicdomain/i.test(String(license || '').trim());

/** A licence that asks for the author's name (CC BY, CC BY-SA…). @param {string | null | undefined} license */
export const needsAuthor = license => /\bby\b/i.test(licenseLabel(license)) && !unreserved(license);

/** A dataset thumbnail's credit (plants.json `thumbnail`). @param {any} thumb @returns {Credit | null} */
export const thumbCredit = thumb => thumb?.url
  ? { author: thumb.author || null, license: thumb.license || null, source: thumb.source || 'Wikimedia Commons', sourceUrl: thumb.sourceUrl || null }
  : null;

/**
 * The credits of a row of small photos, in one line: « Jane Doe, Li Wei (CC BY, CC0) via iNaturalist ».
 * @param {(Credit | null | undefined)[]} credits
 */
export function creditsText(credits) {
  const list = /** @type {Credit[]} */ (credits.filter(Boolean));
  if (!list.length) return '';
  const uniq = (/** @type {(string | null)[]} */ xs) => [...new Set(xs.filter(Boolean))];
  const authors = uniq(list.map(c => c.author)), licenses = uniq(list.map(c => licenseLabel(c.license))), sources = uniq(list.map(c => c.source));
  return `${authors.length ? authors.join(', ') + ' ' : ''}(${licenses.join(', ')}) via ${sources.join(', ')}`;
}

/**
 * « © Jane Doe · CC BY · iNaturalist »; CC0: « Jane Doe · CC0 · iNaturalist »; a CC BY image whose author is not
 * known: « CC BY-SA 3.0 · Wikimedia Commons (auteur sur sa page) », the page naming them.
 * @param {Credit | null | undefined} c
 */
export function creditText(c) {
  if (!c) return '';
  const who = c.author ? (unreserved(c.license) ? c.author : '© ' + c.author) : '';
  const source = !c.author && needsAuthor(c.license) ? `${c.source} (auteur sur sa page)` : c.source;
  return [who, licenseLabel(c.license), source].filter(Boolean).join(' · ');
}
