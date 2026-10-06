import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';

const PLANTS_FILE = process.env.PLANTS_FILE || 'data/plants.json';
const META_FILE = process.env.META_FILE || 'data/meta.json';
const CACHE_FILE = process.env.THUMBNAILS_FILE || 'data/thumbnails.json';
const ARCHIVE_DIR = process.env.PLANTNET_DWCA_DIR || '.cache/plantnet';
const OCCURRENCES_PER_PLANT = Number(process.env.PLANTNET_OCCURRENCES_PER_PLANT || 8);

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const taxonKey = value => clean(value).toLocaleLowerCase('la');

function xmlDecode(value) {
  return String(value ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function decodeSeparator(value, fallback = '\t') {
  const text = xmlDecode(value || '');
  if (!text) return fallback;
  return text
    .replace(/\\t/g, '\t')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r');
}

function attr(text, name) {
  const match = String(text).match(new RegExp(name + '="([^"]*)"'));
  return match ? xmlDecode(match[1]) : null;
}

function localTerm(term) {
  return String(term || '').split(/[\/#]/).pop();
}

function parseTableBlock(xml, kind) {
  const blocks = [...xml.matchAll(kind === 'core'
    ? /<core\b[\s\S]*?<\/core>/gi
    : /<extension\b[\s\S]*?<\/extension>/gi
  )].map(match => match[0]);

  const wanted = blocks.find(block => {
    const open = block.match(/^<[^>]+>/)?.[0] || '';
    const rowType = attr(open, 'rowType') || '';
    return kind === 'core'
      ? /Occurrence$/i.test(rowType)
      : /Multimedia$/i.test(rowType);
  });

  if (!wanted) throw new Error('Darwin Core ' + kind + ' table not found in meta.xml');

  const open = wanted.match(/^<[^>]+>/)?.[0] || '';
  const location = wanted.match(/<location>([\s\S]*?)<\/location>/i)?.[1]?.trim();
  if (!location) throw new Error('Missing table location in meta.xml');

  const idTag = kind === 'core'
    ? wanted.match(/<id\b[^>]*>/i)?.[0]
    : wanted.match(/<coreid\b[^>]*>/i)?.[0];

  const idIndex = Number(attr(idTag || '', 'index'));
  if (!Number.isFinite(idIndex)) throw new Error('Missing id index for ' + kind);

  const fields = {};
  for (const match of wanted.matchAll(/<field\b[^>]*>/gi)) {
    const field = match[0];
    const index = Number(attr(field, 'index'));
    const term = localTerm(attr(field, 'term'));
    if (term && Number.isFinite(index)) fields[term] = index;
  }

  return {
    file: path.join(ARCHIVE_DIR, xmlDecode(location)),
    delimiter: decodeSeparator(attr(open, 'fieldsTerminatedBy'), '\t'),
    quote: decodeSeparator(attr(open, 'fieldsEnclosedBy'), ''),
    ignoreHeaderLines: Number(attr(open, 'ignoreHeaderLines') || 0),
    idIndex,
    fields
  };
}

function splitDelimited(line, delimiter, quote) {
  if (!quote) return line.split(delimiter);

  const values = [];
  let value = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === quote) {
      if (quoted && line[i + 1] === quote) {
        value += quote;
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && line.startsWith(delimiter, i)) {
      values.push(value);
      value = '';
      i += delimiter.length - 1;
    } else {
      value += char;
    }
  }

  values.push(value);
  return values;
}

function rowValue(values, table, ...names) {
  for (const name of names) {
    const index = table.fields[name];
    if (Number.isFinite(index) && values[index] != null && values[index] !== '') {
      return values[index];
    }
  }
  return '';
}

function canonicalName(value) {
  const tokens = clean(value)
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean);

  if (tokens.length < 2) return clean(value);
  if (tokens[1] === '×' && tokens[2]) return tokens[0] + ' × ' + tokens[2];
  return tokens[0] + ' ' + tokens[1];
}

function freeLicense(value) {
  const raw = clean(value);
  const text = raw.toLowerCase();

  if (!raw) return null;
  if (/publicdomain|public domain|creativecommons\.org\/publicdomain\/zero|\bcc0\b/.test(text)) {
    return raw.includes('creativecommons.org') ? 'CC0' : raw;
  }
  if (/creativecommons\.org\/licenses\/by-sa\//.test(text) || /\bcc[- ]by[- ]sa\b/.test(text)) {
    if (/\bnc\b|noncommercial|\/by-nc/.test(text)) return null;
    if (/\bnd\b|noderivatives|\/by-nd/.test(text)) return null;
    return raw;
  }
  if (/creativecommons\.org\/licenses\/by\//.test(text) || /\bcc[- ]by\b/.test(text)) {
    if (/\bnc\b|noncommercial|\/by-nc/.test(text)) return null;
    if (/\bnd\b|noderivatives|\/by-nd/.test(text)) return null;
    return raw;
  }
  return null;
}

async function eachRow(table, callback) {
  const input = createReadStream(table.file, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;

  for await (const raw of lines) {
    lineNumber += 1;
    if (lineNumber <= table.ignoreHeaderLines) continue;

    const line = raw.replace(/^\uFEFF/, '');
    if (!line) continue;

    const values = splitDelimited(line, table.delimiter, table.quote);
    await callback(values, lineNumber);
  }
}

async function main() {
  const plants = JSON.parse(await readFile(PLANTS_FILE, 'utf8'));

  let cache = {};
  try {
    cache = JSON.parse(await readFile(CACHE_FILE, 'utf8'));
  } catch {
    cache = {};
  }

  const missing = plants.filter(plant => !cache[plant.id]?.thumbnail?.url);
  const wanted = new Map(missing.map(plant => [taxonKey(plant.scientificName), plant]));
  console.log(plants.length + ' plants; ' + missing.length + ' missing before Pl@ntNet bulk enrichment');

  if (!missing.length) return;

  const metaXml = await readFile(path.join(ARCHIVE_DIR, 'meta.xml'), 'utf8');
  const occurrence = parseTableBlock(metaXml, 'core');
  const multimedia = parseTableBlock(metaXml, 'extension');

  console.log('Occurrence table:', occurrence.file);
  console.log('Multimedia table:', multimedia.file);

  const occurrenceToPlant = new Map();
  const perPlant = new Map();

  let occurrenceRows = 0;
  let selectedOccurrences = 0;

  await eachRow(occurrence, (values, lineNumber) => {
    occurrenceRows += 1;

    const species = rowValue(
      values,
      occurrence,
      'species',
      'acceptedScientificName',
      'scientificName',
      'verbatimScientificName'
    );

    const candidate = wanted.get(taxonKey(canonicalName(species)));
    if (!candidate) return;

    const count = perPlant.get(candidate.id) || 0;
    if (count >= OCCURRENCES_PER_PLANT) return;

    const coreId = values[occurrence.idIndex];
    if (!coreId) return;

    occurrenceToPlant.set(coreId, {
      plantId: candidate.id,
      references: clean(rowValue(values, occurrence, 'references', 'occurrenceID')),
      author: clean(rowValue(values, occurrence, 'recordedBy', 'identifiedBy', 'rightsHolder'))
    });

    perPlant.set(candidate.id, count + 1);
    selectedOccurrences += 1;

    if (lineNumber % 500000 === 0) {
      console.log(lineNumber + ' occurrence rows; ' + selectedOccurrences + ' candidates retained');
    }
  });

  console.log(occurrenceRows + ' occurrence rows read; ' + selectedOccurrences + ' candidate occurrences retained');

  const foundPlants = new Set();
  let multimediaRows = 0;
  let attached = 0;

  await eachRow(multimedia, (values, lineNumber) => {
    multimediaRows += 1;

    const coreId = values[multimedia.idIndex];
    const selected = occurrenceToPlant.get(coreId);
    if (!selected || foundPlants.has(selected.plantId)) return;

    const type = clean(rowValue(values, multimedia, 'type'));
    const format = clean(rowValue(values, multimedia, 'format'));
    if (type && !/stillimage|image/i.test(type)) return;
    if (format && !/^image\//i.test(format)) return;

    const url = clean(rowValue(values, multimedia, 'identifier', 'accessURI'));
    if (!/^https?:\/\//i.test(url)) return;

    const rawLicense = clean(rowValue(values, multimedia, 'license', 'rights'));
    const license = freeLicense(rawLicense);
    if (!license) return;

    const sourceUrl = clean(rowValue(values, multimedia, 'references')) ||
      selected.references ||
      'https://ipt.plantnet.org/resource?r=observations';

    const author = clean(rowValue(values, multimedia, 'creator', 'rightsHolder')) ||
      selected.author ||
      null;

    cache[selected.plantId] ||= {};
    cache[selected.plantId].thumbnail = {
      url,
      source: 'Pl@ntNet',
      sourceUrl,
      author,
      license,
      licenseUrl: /^https?:\/\//i.test(rawLicense) ? rawLicense : null,
      dataset: 'Pl@ntNet observations'
    };
    cache[selected.plantId].plantnetCheckedAt = new Date().toISOString();

    foundPlants.add(selected.plantId);
    attached += 1;

    if (lineNumber % 500000 === 0) {
      console.log(lineNumber + ' multimedia rows; +' + attached + ' Pl@ntNet thumbnails');
    }
  });

  console.log(multimediaRows + ' multimedia rows read; +' + attached + ' Pl@ntNet thumbnails');

  let withThumbnail = 0;
  const bySource = {};

  for (const plant of plants) {
    const image = cache[plant.id]?.thumbnail;

    plant.thumbnail = image?.url ? {
      url: image.url,
      source: image.source,
      sourceUrl: image.sourceUrl || null,
      author: image.author || null,
      license: image.license || null
    } : null;

    if (plant.thumbnail?.url) {
      withThumbnail += 1;
      bySource[plant.thumbnail.source] = (bySource[plant.thumbnail.source] || 0) + 1;
    }
  }

  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2) + '\n', 'utf8');
  await writeFile(PLANTS_FILE, JSON.stringify(plants, null, 2) + '\n', 'utf8');

  const coveragePercent = Number((withThumbnail / plants.length * 100).toFixed(2));

  try {
    const meta = JSON.parse(await readFile(META_FILE, 'utf8'));
    meta.thumbnails ||= {};
    meta.thumbnails.withThumbnail = withThumbnail;
    meta.thumbnails.withoutThumbnail = plants.length - withThumbnail;
    meta.thumbnails.coveragePercent = coveragePercent;
    meta.thumbnails.bySource = bySource;
    meta.thumbnails.plantnetBulk = {
      dataset: 'Pl@ntNet observations v1.9',
      sourceUrl: 'https://ipt.plantnet.org/resource?r=observations&v=1.9',
      occurrenceRows,
      multimediaRows,
      selectedOccurrences,
      thumbnailsAdded: attached
    };
    await writeFile(META_FILE, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  } catch {}

  console.log(JSON.stringify({
    plants: plants.length,
    withThumbnail,
    withoutThumbnail: plants.length - withThumbnail,
    coveragePercent,
    bySource,
    plantnetAdded: attached
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
