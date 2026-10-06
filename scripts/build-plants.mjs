import { mkdir, writeFile } from 'node:fs/promises';

const API = process.env.TAXREF_API_BASE || 'https://taxref.mnhn.fr/api';
const VERSION = process.env.TAXREF_VERSION || '18.0';
const PAGE_SIZE = 5000;
const CONCURRENCY = Number(process.env.DETAIL_CONCURRENCY || 6);
const SKIP_DETAIL_NAMES = process.argv.includes('--skip-detail-names');
const VALID_FR = new Set(['P', 'N', 'E', 'S', 'C', 'I', 'J']);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getJson(url, attempt = 1) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/hal+json, application/json;q=0.9',
      'user-agent': 'GeoFlora dataset builder/1.0 (+https://github.com/yannouche-dev/flora)'
    }
  });

  if (!response.ok) {
    if (attempt < 4 && [429, 500, 502, 503, 504].includes(response.status)) {
      await sleep(500 * 2 ** (attempt - 1));
      return getJson(url, attempt + 1);
    }
    throw new Error(response.status + ' ' + response.statusText + ': ' + url);
  }
  return response.json();
}

function embeddedArray(payload, preferred = []) {
  const embedded = payload && payload._embedded;
  if (!embedded || typeof embedded !== 'object') return [];
  for (const key of preferred) {
    if (Array.isArray(embedded[key])) return embedded[key];
  }
  return Object.values(embedded).find(Array.isArray) || [];
}

async function fetchSpeciesPages() {
  const all = [];
  let page = 1;

  while (true) {
    const params = new URLSearchParams({
      version: VERSION,
      taxonomicRanks: 'ES',
      territories: 'fr',
      domain: 'continental',
      page: String(page),
      size: String(PAGE_SIZE)
    });

    const payload = await getJson(API + '/taxa/search?' + params);
    const taxa = embeddedArray(payload, ['taxa']);
    all.push(...taxa);
    console.log('TAXREF page ' + page + ': ' + taxa.length + ' rows (' + all.length + ' total)');

    const totalPages = Number(payload && payload.page && payload.page.totalPages || 0);
    const hasNext = Boolean(payload && payload._links && payload._links.next && payload._links.next.href);
    if ((totalPages && page >= totalPages) || (!hasNext && taxa.length < PAGE_SIZE) || taxa.length === 0) break;
    page += 1;
  }
  return all;
}

const lower = value => String(value ?? '').trim().toLocaleLowerCase('fr-FR');

function accepted(taxon) {
  return Number(taxon.id) === Number(taxon.referenceId ?? taxon.id);
}

function frenchStatus(taxon) {
  const candidates = [
    taxon.fr, taxon.FR, taxon.frStatus, taxon.frenchStatus,
    taxon.statusFr, taxon.statusFR, taxon.biogeographicStatusFr
  ];
  const value = candidates.find(v => typeof v === 'string' && v.trim());
  if (!value) return null;
  const match = value.trim().match(/\b([A-Z])\b/);
  return match ? match[1] : value.trim().slice(0, 1).toUpperCase();
}

function established(taxon) {
  const status = frenchStatus(taxon);
  return status ? VALID_FR.has(status) : true;
}

function vascularPlant(taxon) {
  if (lower(taxon.kingdomName) !== 'plantae') return false;

  const searchable = Object.entries(taxon)
    .filter(([key]) => /kingdom|phylum|class|order|group|lineage|parent/i.test(key))
    .flatMap(([, value]) => Array.isArray(value) ? value : [value])
    .filter(v => typeof v === 'string')
    .join(' ')
    .toLocaleLowerCase('fr-FR');

  const vascularSignals = [
    'tracheophyta', 'plantes vasculaires', 'vascular plant', 'spermatophyta',
    'equisetopsida', 'lycopodiopsida', 'polypodiopsida', 'magnoliopsida', 'liliopsida'
  ];
  if (vascularSignals.some(token => searchable.includes(token))) return true;

  const allText = Object.values(taxon)
    .flatMap(value => Array.isArray(value) ? value : [value])
    .filter(v => typeof v === 'string')
    .join(' ')
    .toLocaleLowerCase('fr-FR');

  const nonVascular = [
    'bryophyta', 'marchantiophyta', 'anthocerotophyta',
    'chlorophyta', 'algues vertes', 'mousse', 'hépatique'
  ];
  if (nonVascular.some(token => allText.includes(token))) return false;

  return Boolean(taxon.familyName && taxon.genusName);
}

function clean(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[-–—,;:\s]+|[-–—,;:\s]+$/g, '')
    .trim();
}

function splitNames(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(splitNames);
  return String(value)
    .split(/\s*[;|]\s*|\s*,\s*(?=[A-ZÀ-ÖØ-ÝŒÆ])/u)
    .map(clean)
    .filter(Boolean);
}

function uniqueNames(names) {
  const result = [];
  const seen = new Set();

  for (const raw of names) {
    const name = clean(raw);
    if (!name) continue;
    const key = name.normalize('NFKD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('fr-FR');
    if (!seen.has(key)) {
      seen.add(key);
      result.push(name);
    }
  }
  return result;
}

function rowName(row) {
  return row && (row.name || row.vernacularName || row.nameVernacular || row.label || row.value) || null;
}

function frenchRow(row) {
  const lang = lower(row && (row.languageCode || row.language || row.lang || row.iso6391 || row.iso6393));
  return !lang || ['fr', 'fra', 'fre', 'français', 'francais', 'french'].includes(lang);
}

async function detailedNames(id) {
  const payload = await getJson(API + '/taxa/' + id + '/vernacularNames');
  const rows = embeddedArray(payload, ['vernacularNames', 'names']);
  return uniqueNames(rows.filter(frenchRow).map(rowName));
}

async function mapPool(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function epithet(taxon) {
  const scientific = clean(taxon.scientificName || taxon.referenceName || '');
  const genus = clean(taxon.genusName || scientific.split(/\s+/)[0]);
  const parts = scientific.slice(genus.length).trim().split(/\s+/).filter(Boolean);
  if (parts[0] === '×' && parts[1]) return '× ' + parts[1];
  return parts[0] || '';
}

async function main() {
  console.log('Building metropolitan French vascular flora from TAXREF ' + VERSION);
  const raw = await fetchSpeciesPages();

  let taxa = raw.filter(accepted).filter(established).filter(vascularPlant);
  taxa = [...new Map(taxa.map(taxon => [Number(taxon.id), taxon])).values()];

  console.log(taxa.length + ' accepted vascular plant species retained before vernacular enrichment.');

  let detailFailures = 0;
  const plants = await mapPool(taxa, CONCURRENCY, async (taxon, index) => {
    const base = uniqueNames([
      ...splitNames(taxon.frenchVernacularName),
      ...splitNames(taxon.vernacularName)
    ]);

    let extra = [];
    if (!SKIP_DETAIL_NAMES) {
      try {
        extra = await detailedNames(taxon.id);
      } catch (error) {
        detailFailures += 1;
        console.warn('Vernacular fallback for ' + taxon.id + ': ' + error.message);
      }
    }

    if ((index + 1) % 250 === 0) {
      console.log('Vernacular names: ' + (index + 1) + '/' + taxa.length);
    }

    return {
      id: Number(taxon.id),
      family: clean(taxon.familyName),
      genus: clean(taxon.genusName),
      species: epithet(taxon),
      vernacularNames: uniqueNames([...base, ...extra])
    };
  });

  const cleaned = plants
    .filter(p => p.id && p.family && p.genus && p.species)
    .sort((a, b) =>
      a.family.localeCompare(b.family, 'fr') ||
      a.genus.localeCompare(b.genus, 'fr') ||
      a.species.localeCompare(b.species, 'fr')
    );

  if (new Set(cleaned.map(p => p.id)).size !== cleaned.length) {
    throw new Error('Duplicate TAXREF IDs in generated dataset.');
  }
  if (cleaned.length < 4000 || cleaned.length > 9000) {
    throw new Error('Unexpected plant count: ' + cleaned.length + '. Refusing to publish without review.');
  }

  await mkdir('data', { recursive: true });
  await writeFile('data/plants.json', JSON.stringify(cleaned, null, 2) + '\n', 'utf8');

  const meta = {
    generatedAt: new Date().toISOString(),
    source: 'TAXREF API',
    sourceUrl: 'https://taxref.mnhn.fr/',
    taxrefVersion: VERSION,
    criteria: {
      territory: 'France métropolitaine (fr)',
      domain: 'continental',
      rank: 'ES',
      acceptedNamesOnly: true,
      establishedStatuses: [...VALID_FR],
      vascularPlants: true
    },
    rawRows: raw.length,
    plants: cleaned.length,
    families: new Set(cleaned.map(p => p.family)).size,
    genera: new Set(cleaned.map(p => p.genus)).size,
    plantsWithFrenchNames: cleaned.filter(p => p.vernacularNames.length).length,
    vernacularNames: cleaned.reduce((sum, p) => sum + p.vernacularNames.length, 0),
    detailVernacularFailures: detailFailures
  };

  await writeFile('data/meta.json', JSON.stringify(meta, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(meta, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
