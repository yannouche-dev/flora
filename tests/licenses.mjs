// The licence rules of the images, as a table: what may be shown (CC0, public domain, CC BY, CC BY-SA — never NC,
// ND, nor « all rights reserved »), and how a credit reads. Run by tools/check.sh; exits 1 with one line per miss.
//   node tests/licenses.mjs

import { freeLicense, wikimediaHeaders } from '../lib/plant-sources.mjs';
import { INAT_FREE, creditText, creditsText, inatCredit, licenseLabel, unreserved } from '../app/core/credit.js';

/** Commons' LicenseShortName → shown (lib/plant-sources.mjs; scripts/build-thumbnails.mjs has the same rule). */
const COMMONS = /** @type {[string, boolean][]} */ ([
  ['CC0', true], ['Public domain', true], ['PD-old', true], ['pd', true],
  ['CC BY 4.0', true], ['CC BY-SA 3.0', true], ['CC-BY-SA-4.0', true], ['cc-by 2.0', true], ['CC BY-SA 2.5 nl', true],
  ['CC BY-NC 4.0', false], ['CC BY-ND 2.0', false], ['cc-by-nd', false], ['CC BY-NC-SA 4.0', false], ['cc-by-nc-nd 3.0', false],
  ['GFDL', false], ['FAL', false], ['', false], ['<span>CC BY-SA 4.0</span>', true]
]);
/** iNaturalist's license_code → shown (app/core/nearby.js, as the sheet's media). */
const INAT = /** @type {[string | null, boolean][]} */ ([
  ['cc0', true], ['cc-by', true], ['cc-by-sa', true], ['CC-BY', true],
  ['cc-by-nc', false], ['cc-by-nd', false], ['cc-by-nc-sa', false], ['cc-by-nc-nd', false], [null, false], ['', false]
]);
/** A credit, as the cards and the map read it. */
const CREDITS = /** @type {[any, string][]} */ ([
  [{ author: 'Jane Doe', license: 'CC BY', source: 'iNaturalist' }, '© Jane Doe · CC BY · iNaturalist'],
  [{ author: 'Jane Doe', license: 'CC0', source: 'iNaturalist' }, 'Jane Doe · CC0 · iNaturalist'],
  [{ author: 'Algirdas', license: 'Public domain', source: 'Wikimedia Commons' }, 'Algirdas · Public domain · Wikimedia Commons'],
  [{ author: null, license: 'CC BY-SA 3.0', source: 'Wikimedia Commons' }, 'CC BY-SA 3.0 · Wikimedia Commons (auteur sur sa page)'],
  [{ author: 'GBIF user', license: 'http://creativecommons.org/licenses/by/4.0/', source: 'GBIF' }, '© GBIF user · CC BY 4.0 · GBIF']
]);

const misses = [];
for (const [license, free] of COMMONS) if (freeLicense(license) !== free) misses.push(`freeLicense(${JSON.stringify(license)}) should be ${free}`);
for (const [code, free] of INAT) {
  if (INAT_FREE.test(code || '') !== free) misses.push(`INAT_FREE ${JSON.stringify(code)} should be ${free}`);
  if (Boolean(inatCredit({ license_code: code, attribution: '(c) Jane Doe, some rights reserved (CC BY)' })) !== free) misses.push(`inatCredit ${JSON.stringify(code)} should be ${free ? 'a credit' : 'null'}`);
}
for (const [credit, text] of CREDITS) if (creditText(credit) !== text) misses.push(`creditText → ${JSON.stringify(creditText(credit))}, not ${JSON.stringify(text)}`);
const named = inatCredit({ license_code: 'cc-by', attribution: '(c) Jane Doe, some rights reserved (CC BY)', id: 7 });
if (named?.author !== 'Jane Doe' || named.license !== 'CC BY' || named.sourceUrl !== 'https://www.inaturalist.org/photos/7') misses.push(`inatCredit reads ${JSON.stringify(named)}`);
if (inatCredit({ license_code: 'cc0', attribution: 'no rights reserved' })?.author !== null) misses.push('inatCredit takes « no rights reserved » for a name');
if (creditsText([{ author: 'A', license: 'cc-by', source: 'iNaturalist' }, null, { author: 'B', license: 'cc0', source: 'iNaturalist' }]) !== 'A, B (CC BY, CC0) via iNaturalist') misses.push('creditsText');
if (licenseLabel('http://creativecommons.org/publicdomain/zero/1.0/') !== 'CC0' || !unreserved('CC0') || unreserved('CC BY')) misses.push('licenseLabel / unreserved');
// Api-User-Agent: Wikimedia's MediaWiki APIs only, never another host (nor a personal address).
const agent = (/** @type {string} */ url) => wikimediaHeaders(url)['Api-User-Agent'] || '';
for (const url of ['https://www.wikidata.org/w/api.php?action=wbgetentities', 'https://fr.wikipedia.org/api/rest_v1/page/summary/Ortie', 'https://commons.wikimedia.org/w/api.php?x', 'https://fr.wikibooks.org/w/api.php?x']) {
  if (!/^GeoFlora .*github\.com\/yannouche-dev\/flora/.test(agent(url))) misses.push(`no Api-User-Agent for ${url}`);
}
for (const url of ['https://api.gbif.org/v1/x', 'https://api.inaturalist.org/v1/taxa', 'https://query.wikidata.org/sparql?query=x', 'https://evil.org/wikipedia.org/w/api.php']) {
  if (agent(url)) misses.push(`Api-User-Agent sent to ${url}`);
}
if (/@/.test(agent('https://www.wikidata.org/w/api.php'))) misses.push('Api-User-Agent carries an e-mail address');

for (const m of misses) console.log(`::error file=tests/licenses.mjs::${m}`);
console.log(misses.length ? `licenses: ${misses.length} miss(es)` : `licenses: ${COMMONS.length + INAT.length + CREDITS.length} cases, all as expected`);
if (misses.length) process.exitCode = 1;
