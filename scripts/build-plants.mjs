import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';

const SOURCE_DIR = process.env.TAXREF_DIR || '.cache/taxref';
const TAXREF_FILE = process.env.TAXREF_FILE || path.join(SOURCE_DIR, 'TAXREFv18.txt');
const TAXVERN_FILE = process.env.TAXVERN_FILE || path.join(SOURCE_DIR, 'TAXVERNv18.txt');
const VERSION = '18.0';
const VALID_FR = new Set(['P', 'N', 'E', 'S', 'C', 'I', 'J']);

function parseTsv(line) {
  const values = [];
  let value = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === '\t' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += char;
    }
  }

  values.push(value);
  return values;
}

async function streamTsv(file, onRow) {
  const input = createReadStream(file, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let headers = null;
  let count = 0;

  for await (const rawLine of lines) {
    const line = rawLine.replace(/^\uFEFF/, '');
    if (!headers) {
      headers = parseTsv(line);
      continue;
    }
    if (!line) continue;

    const values = parseTsv(line);
    const row = Object.create(null);
    for (let i = 0; i < headers.length; i += 1) row[headers[i]] = values[i] ?? '';

    count += 1;
    await onRow(row, count);
  }

  return count;
}

function clean(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[-–—,;:\s]+|[-–—,;:\s]+$/g, '')
    .trim();
}

function normalizeKey(value) {
  return clean(value)
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('fr-FR');
}

function splitVernacularNames(value) {
  const text = clean(value);
  if (!text) return [];

  const parts = [];
  let buffer = '';
  let parenDepth = 0;

  const flush = () => {
    const name = clean(buffer);
    if (name) parts.push(name);
    buffer = '';
  };

  for (const char of text) {
    if (char === '(' || char === '[') parenDepth += 1;
    if (char === ')' || char === ']') parenDepth = Math.max(0, parenDepth - 1);

    if (parenDepth === 0 && (char === ',' || char === ';' || char === '|')) {
      flush();
    } else {
      buffer += char;
    }
  }
  flush();

  return parts;
}

function addNames(target, values) {
  for (const raw of values) {
    const name = clean(raw);
    if (!name) continue;
    const key = normalizeKey(name);
    if (!target._nameKeys.has(key)) {
      target._nameKeys.add(key);
      target.vernacularNames.push(name);
    }
  }
}

function isVascularSpecies(row) {
  if (row.REGNE !== 'Plantae') return false;
  if (row.RANG !== 'ES') return false;
  if (row.CD_NOM !== row.CD_REF) return false;
  if (!VALID_FR.has(row.FR)) return false;

  const groups = [row.GROUP1_INPN, row.GROUP2_INPN, row.GROUP3_INPN]
    .map(normalizeKey)
    .join(' ');

  return groups.includes('tracheophytes') || groups.includes('plantes vasculaires');
}

function splitScientificName(name) {
  const text = clean(name);
  const parts = text.split(/\s+/).filter(Boolean);
  const genus = parts.shift() || '';

  if (parts[0] === '×' && parts[1]) {
    return { genus, species: '× ' + parts[1] };
  }

  return { genus, species: parts[0] || '' };
}

function frenchVernacularRow(row) {
  const iso = normalizeKey(row.ISO639_3);
  const lang = normalizeKey(row.LANGUE);
  return iso === 'fra' || iso === 'fre' || iso === 'fr' || lang === 'francais' || lang === 'french';
}

async function main() {
  const acceptedPlants = new Map();
  const cdToRef = new Map();

  console.log('Reading ' + TAXREF_FILE);

  const taxrefRows = await streamTsv(TAXREF_FILE, (row, count) => {
    const cdNom = Number(row.CD_NOM);
    const cdRef = Number(row.CD_REF);

    if (Number.isFinite(cdNom) && Number.isFinite(cdRef)) {
      cdToRef.set(cdNom, cdRef);
    }

    if (!isVascularSpecies(row)) return;

    const id = cdNom;
    const scientific = splitScientificName(row.LB_NOM);

    const plant = {
      id,
      family: clean(row.FAMILLE),
      genus: scientific.genus,
      species: scientific.species,
      vernacularNames: [],
      _nameKeys: new Set()
    };

    addNames(plant, splitVernacularNames(row.NOM_VERN));
    acceptedPlants.set(id, plant);

    if (count % 100000 === 0) {
      console.log(count + ' TAXREF rows read; ' + acceptedPlants.size + ' plants retained');
    }
  });

  console.log(taxrefRows + ' TAXREF rows read');
  console.log(acceptedPlants.size + ' accepted metropolitan vascular species retained');

  console.log('Reading ' + TAXVERN_FILE);

  let attachedVernacularRows = 0;
  let frenchVernacularRows = 0;

  const taxvernRows = await streamTsv(TAXVERN_FILE, row => {
    if (!frenchVernacularRow(row)) return;
    frenchVernacularRows += 1;

    const cdNom = Number(row.CD_NOM);
    const cdRef = cdToRef.get(cdNom) ?? cdNom;
    const plant = acceptedPlants.get(cdRef);
    if (!plant) return;

    addNames(plant, splitVernacularNames(row.LB_VERN));
    attachedVernacularRows += 1;
  });

  console.log(taxvernRows + ' TAXVERN rows read');
  console.log(attachedVernacularRows + ' French vernacular rows attached');

  const plants = [...acceptedPlants.values()]
    .map(({ _nameKeys, ...plant }) => plant)
    .filter(plant => plant.family && plant.genus && plant.species)
    .sort((a, b) =>
      a.family.localeCompare(b.family, 'fr') ||
      a.genus.localeCompare(b.genus, 'fr') ||
      a.species.localeCompare(b.species, 'fr')
    );

  if (new Set(plants.map(plant => plant.id)).size !== plants.length) {
    throw new Error('Duplicate TAXREF IDs in generated dataset');
  }

  if (plants.length < 4500 || plants.length > 8000) {
    throw new Error('Unexpected vascular flora count: ' + plants.length);
  }

  await mkdir('data', { recursive: true });
  await writeFile('data/plants.json', JSON.stringify(plants, null, 2) + '\n', 'utf8');

  const meta = {
    generatedAt: new Date().toISOString(),
    source: 'TAXREF v18 official PatriNat archive',
    sourceUrl: 'https://assets.patrinat.fr/files/referentiel/TAXREF_v18_2025.zip',
    taxrefVersion: VERSION,
    criteria: {
      rank: 'ES',
      acceptedNamesOnly: true,
      group: 'Plantes vasculaires',
      territory: 'France métropolitaine (FR)',
      statuses: [...VALID_FR]
    },
    taxrefRows,
    taxvernRows,
    frenchVernacularRows,
    attachedVernacularRows,
    plants: plants.length,
    families: new Set(plants.map(plant => plant.family)).size,
    genera: new Set(plants.map(plant => plant.genus)).size,
    plantsWithFrenchNames: plants.filter(plant => plant.vernacularNames.length > 0).length,
    vernacularNames: plants.reduce((sum, plant) => sum + plant.vernacularNames.length, 0),
    plantsWithoutFrenchNames: plants.filter(plant => plant.vernacularNames.length === 0).length
  };

  await writeFile('data/meta.json', JSON.stringify(meta, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(meta, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
