// The health of the outside services GeoFlora relies on (api-health.yml, every day; audit OPS-5): for each one, a
// single small request of the kind the app makes (app/core/modules.js lists them by module), and a check that the
// answer still has the shape the app reads. Run in a browser, the app reads an answer from another origin only when
// the service allows it (CORS): every request here carries the site's Origin and the answer must allow it.
// One request per service, one after the other, each naming the repository (User-Agent, and Api-User-Agent for
// Wikimedia as the app sends it); a request that fails on the network or with a 5xx / 429 is asked once more, 20 s
// later, so one hiccup does not fail the day. No key or token: Trefle (a personal token) is not probed.
//   node tools/api-health.mjs [name…]        (names: the first column; none = every service)
// Prints a table (and appends it to $GITHUB_STEP_SUMMARY when set); exits 1 when any service is broken.
// From a machine behind a proxy, Node 22 needs NODE_USE_ENV_PROXY=1 to use HTTPS_PROXY.

import { appendFileSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { WIKIMEDIA_AGENT } from '../lib/plant-sources.mjs';
import { parseCapabilities } from '../lib/ign-catalog.mjs';
import { everyBaseLayer } from '../app/core/backgrounds.js';

const ORIGIN = 'https://yannouche-dev.github.io';
const AGENT = 'GeoFlora api-health (https://github.com/yannouche-dev/flora; daily check, one request per service)';
/** The reference taxon and place: the stinging nettle, in Lyon. */
const TAXON = 'Urtica dioica';
const [LON, LAT] = [4.8357, 45.764];

/**
 * The WMTS layers of the app's maps — its overlays (app/core/ign-layers.js, read from its source), its backgrounds
 * (app/core/backgrounds.js: the plan, the photos of each year, SPOT's, the names over them) —: each must still be in the catalogue.
 */
const IGN_LAYERS = [...readFileSync(new URL('../app/core/ign-layers.js', import.meta.url), 'utf8')
  .matchAll(/\{ id: '([^']+)', format: 'image\//g)].map(m => m[1]).concat(everyBaseLayer().map(l => l.id));

/** @param {Record<string, string | number>} p */
const qs = p => new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)])).toString();
const year = new Date().getUTCFullYear() - 1;

/**
 * @typedef {{ name: string, service: string, url: string, method?: string, headers?: Record<string, string>,
 *   cors?: boolean, as?: 'json' | 'text' | 'none', check: (body: any, response: Response) => true | string }} Probe
 * `check` answers true, or what is wrong.
 * @type {Probe[]}
 */
const PROBES = [
  { name: 'gbif', service: 'GBIF (species match)',
    url: 'https://api.gbif.org/v1/species/match?' + qs({ name: TAXON, kingdom: 'Plantae', strict: 'true' }),
    check: d => Number.isInteger(d.usageKey) && d.matchType !== 'NONE' || `no usageKey (matchType ${d.matchType})` },
  { name: 'inaturalist', service: 'iNaturalist (taxa)',
    url: 'https://api.inaturalist.org/v1/taxa?' + qs({ q: TAXON, rank: 'species', per_page: 1 }),
    check: d => Array.isArray(d.results) && d.results.length > 0 || 'no results[]' },
  { name: 'wikidata', service: 'Wikidata (action API)',
    url: 'https://www.wikidata.org/w/api.php?' + qs({ action: 'wbsearchentities', search: TAXON, language: 'en', type: 'item', limit: 1, format: 'json', origin: '*' }),
    headers: { 'Api-User-Agent': WIKIMEDIA_AGENT },
    check: d => Array.isArray(d.search) && /^Q\d+$/.test(d.search[0]?.id) || 'no search[0].id' },
  { name: 'wdqs', service: 'Wikidata Query Service (SPARQL)',
    url: 'https://query.wikidata.org/sparql?' + qs({ format: 'json', query: 'SELECT ?x WHERE { VALUES ?x { 1 } }' }),
    headers: { accept: 'application/sparql-results+json' },
    check: d => Array.isArray(d.results?.bindings) && d.results.bindings.length === 1 || 'no results.bindings[]' },
  { name: 'wikipedia', service: 'Wikipédia (fr, action API)',
    url: 'https://fr.wikipedia.org/w/api.php?' + qs({ action: 'query', prop: 'info', titles: 'Grande ortie', redirects: 1, format: 'json', formatversion: 2, origin: '*' }),
    headers: { 'Api-User-Agent': WIKIMEDIA_AGENT },
    check: d => Array.isArray(d.query?.pages) && d.query.pages[0] && !d.query.pages[0].missing || 'no query.pages[0]' },
  { name: 'commons', service: 'Wikimedia Commons (action API)',
    url: 'https://commons.wikimedia.org/w/api.php?' + qs({ action: 'query', list: 'search', srsearch: TAXON, srnamespace: 6, srlimit: 1, format: 'json', origin: '*' }),
    headers: { 'Api-User-Agent': WIKIMEDIA_AGENT },
    check: d => Array.isArray(d.query?.search) && d.query.search.length > 0 || 'no query.search[]' },
  { name: 'wikibooks', service: 'Wikibooks (fr, recettes)',
    url: 'https://fr.wikibooks.org/w/api.php?' + qs({ action: 'query', list: 'search', srsearch: 'ortie recette', srnamespace: 0, srlimit: 1, format: 'json', origin: '*' }),
    headers: { 'Api-User-Agent': WIKIMEDIA_AGENT },
    check: d => Array.isArray(d.query?.search) || 'no query.search[]' },
  { name: 'globi', service: 'GloBI (interactions)',
    url: 'https://api.globalbioticinteractions.org/interaction?' + qs({ sourceTaxon: TAXON, limit: 1 }),
    check: d => Array.isArray(d.data) && Array.isArray(d.columns) || 'no data[] / columns[]' },
  { name: 'openmeteo-archive', service: 'Open-Meteo (archive, climat)',
    url: 'https://archive-api.open-meteo.com/v1/archive?' + qs({ latitude: LAT, longitude: LON, start_date: `${year}-06-01`, end_date: `${year}-06-02`, daily: 'temperature_2m_mean,precipitation_sum' }),
    check: d => Array.isArray(d.daily?.time) && Array.isArray(d.daily?.temperature_2m_mean) || 'no daily.time[] / temperature_2m_mean[]' },
  { name: 'openmeteo-air', service: 'Open-Meteo (qualité de l’air, pollens)',
    url: 'https://air-quality-api.open-meteo.com/v1/air-quality?' + qs({ latitude: LAT, longitude: LON, hourly: 'birch_pollen,grass_pollen', forecast_days: 1, timezone: 'auto' }),
    check: d => Array.isArray(d.hourly?.time) && Array.isArray(d.hourly?.grass_pollen) || 'no hourly.time[] / grass_pollen[]' },
  { name: 'ign-wmts', service: 'IGN Géoplateforme (WMTS GetCapabilities)',
    url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities', as: 'text',
    check: xml => {
      if (!/<Capabilities\b/.test(xml)) return 'not a WMTS Capabilities document';
      const gone = IGN_LAYERS.filter(id => !xml.includes(`<ows:Identifier>${id}</ows:Identifier>`));
      if (gone.length) return `layers of the app missing: ${gone.join(', ')}`;
      // Read as the app reads it (lib/ign-catalog.mjs): a document it can no longer read shows here, not on a phone.
      const read = parseCapabilities(xml).length;
      return read >= 50 || `only ${read} layers read by lib/ign-catalog.mjs`;
    } },
  // Not a service: the copy of that catalogue the site publishes, written at each deploy (deploy-pages.yml, monthly at
  // least). Older than 45 days, or the starting copy: the deploys could not read the service for weeks.
  { name: 'ign-catalog', service: 'Catalogue IGN publié (data/ign-catalog.json)',
    url: ORIGIN + '/flora/data/ign-catalog.json', cors: false,
    check: d => {
      if (!Array.isArray(d.layers) || d.layers.length < 50) return `${d.layers?.length ?? 0} layers`;
      if (d.seed) return 'the starting copy (seed): no deploy has read the service yet';
      const days = (Date.now() - Date.parse(d.fetchedAt)) / 86400e3;
      return days <= 45 || `read ${Number.isFinite(days) ? Math.round(days) + ' days ago' : 'at an unknown date'} (more than 45)`;
    } },
  { name: 'ign-alti', service: 'IGN Géoplateforme (altimétrie)',
    url: 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?' + qs({ lon: LON, lat: LAT, resource: 'ign_rge_alti_wld', zonly: 'true' }),
    check: d => Array.isArray(d.elevations) && Number.isFinite(typeof d.elevations[0] === 'object' ? d.elevations[0]?.z : d.elevations[0]) || 'no elevations[0]' },
  { name: 'ign-geocodage', service: 'IGN Géoplateforme (géocodage)',
    url: 'https://data.geopf.fr/geocodage/completion?' + qs({ text: 'Lyon', maximumResponses: 1 }),
    check: d => Array.isArray(d.results) && Number.isFinite(d.results[0]?.x) || 'no results[0].x' },
  { name: 'ign-wfs', service: 'IGN Géoplateforme (WFS, espaces protégés)',
    url: 'https://data.geopf.fr/wfs/ows?' + qs({ SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature', TYPENAMES: 'patrinat_pn:parc_national', OUTPUTFORMAT: 'application/json', COUNT: 1, PROPERTYNAME: 'nom_site,url_fiche,id_mnhn,zone' }),
    check: d => Array.isArray(d.features) && d.features.length === 1 || 'no features[0]' },
  { name: 'apicarto', service: 'API Carto IGN (nature : PNR)',
    url: 'https://apicarto.ign.fr/api/nature/pnr?' + qs({ geom: JSON.stringify({ type: 'Point', coordinates: [4.6, 45.38] }) }),
    check: d => Array.isArray(d.features) || 'no features[]' },
  // The dataset build's source (build-dataset.yml), not a call of the app: its first byte only, no CORS.
  { name: 'taxref', service: 'TAXREF v18 (archive PatriNat, build)',
    url: 'https://assets.patrinat.fr/files/referentiel/TAXREF_v18_2025.zip', headers: { range: 'bytes=0-0' }, cors: false, as: 'none',
    check: (_, r) => {
      const size = Number(r.headers.get('content-range')?.split('/')[1] || r.headers.get('content-length'));
      return size > 10e6 || `archive of ${size} bytes`;
    } }
];

/** One request; once more after 20 s on a network error, a 5xx or a 429. @param {Probe} probe */
async function run(probe) {
  for (let attempt = 1; ; attempt++) {
    const started = performance.now();
    let response;
    try {
      response = await fetch(probe.url, {
        method: probe.method || 'GET', redirect: 'follow', signal: AbortSignal.timeout(30000),
        headers: { 'user-agent': AGENT, accept: 'application/json', ...probe.cors === false ? {} : { origin: ORIGIN }, ...probe.headers }
      });
    } catch (error) {
      if (attempt === 1) { await sleep(20000); continue; }
      return { ok: false, status: '—', ms: Math.round(performance.now() - started), note: `network: ${error.cause?.code || error.message}` };
    }
    if ((response.status >= 500 || response.status === 429) && attempt === 1) { await response.body?.cancel(); await sleep(20000); continue; }
    const result = { ok: false, status: String(response.status), ms: 0, note: '' };
    try {
      if (!response.ok) { result.note = `HTTP ${response.status}`; await response.body?.cancel(); return result; }
      const allowed = response.headers.get('access-control-allow-origin');
      const body = probe.as === 'none' ? (await response.body?.cancel(), null) : probe.as === 'text' ? await response.text() : await response.json();
      result.ms = Math.round(performance.now() - started);
      if (probe.cors !== false && allowed !== '*' && allowed !== ORIGIN) { result.note = `CORS: Access-Control-Allow-Origin ${allowed ?? 'absent'}`; return result; }
      const verdict = probe.check(body, response);
      result.ok = verdict === true;
      result.note = verdict === true ? '' : `shape: ${verdict}`;
    } catch (error) {
      result.ms = Math.round(performance.now() - started);
      result.note = `answer unreadable: ${error.message}`;
    }
    return result;
  }
}

const only = process.argv.slice(2);
const unknown = only.filter(n => !PROBES.some(p => p.name === n));
if (unknown.length) {
  console.error(`unknown service(s): ${unknown.join(', ')}; known: ${PROBES.map(p => p.name).join(', ')}`);
  process.exit(2);
}
const rows = [];
for (const probe of PROBES.filter(p => !only.length || only.includes(p.name))) {
  const r = await run(probe);
  rows.push({ probe, ...r });
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${probe.name.padEnd(18)} ${r.status.padStart(3)} ${String(r.ms).padStart(6)} ms  ${r.note}`);
  if (!r.ok) console.log(`::error title=${probe.service}::${r.note} — ${probe.url}`);
}

const broken = rows.filter(r => !r.ok);
const cell = (/** @type {string} */ s) => s.replace(/\|/g, '\\|');
const summary = [
  `### Services tiers : ${broken.length ? `${broken.length} en panne sur ${rows.length}` : `${rows.length} sur ${rows.length} répondent`}`,
  '', '| | Service | HTTP | Durée | Problème |', '|---|---|---|---|---|',
  ...rows.map(r => `| ${r.ok ? '✅' : '❌'} | [${cell(r.probe.service)}](${r.probe.url}) | ${r.status} | ${r.ms} ms | ${cell(r.note)} |`),
  '', 'Non sondé : Trefle (jeton personnel). Une requête par service, en-tête `Origin` du site (CORS vérifié).', ''
].join('\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
if (broken.length) process.exitCode = 1;
