import { readFile, writeFile } from 'node:fs/promises';

const PLANTS_FILE = process.env.PLANTS_FILE || 'data/plants.json';
const META_FILE = process.env.META_FILE || 'data/meta.json';
const CACHE_FILE = process.env.THUMBNAILS_FILE || 'data/thumbnails.json';

const WDQS = 'https://query.wikidata.org/sparql';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const BATCH_SIZE = Number(process.env.WIKIDATA_BATCH_SIZE || 120);
const DELAY_MS = Number(process.env.WIKIDATA_BULK_DELAY_MS || 350);
const USER_AGENT = 'GeoFlora/1.0 (https://github.com/yannouche-dev/flora)';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const key = value => clean(value).toLocaleLowerCase('la');

function chunks(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) result.push(array.slice(i, i + size));
  return result;
}

function sparqlString(value) {
  return '"' + String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, ' ') + '"';
}

function stripHtml(value) {
  return clean(String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'"));
}

function freeLicense(value) {
  const text = stripHtml(value).toLowerCase();
  if (!text) return false;
  if (/public domain|\bcc0\b/.test(text)) return true;
  if (/\bcc[- ]by[- ]sa\b/.test(text) && !/\bnc\b|\bnd\b/.test(text)) return true;
  if (/\bcc[- ]by\b/.test(text) && !/\bnc\b|\bnd\b/.test(text)) return true;
  return false;
}

function commonsFileFromImageUri(uri) {
  if (!uri) return null;
  try {
    const decoded = decodeURIComponent(uri);
    const marker = '/Special:FilePath/';
    const index = decoded.indexOf(marker);
    if (index >= 0) return decoded.slice(index + marker.length);
  } catch {}
  return null;
}

function commonsPageUrl(title) {
  return 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_'));
}

async function getJson(url, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'user-agent': USER_AGENT
      }
    });

    if (!response.ok) {
      if (attempt < 5 && [429, 500, 502, 503, 504].includes(response.status)) {
        const retryAfter = Number(response.headers.get('retry-after') || 0);
        await sleep(retryAfter ? retryAfter * 1000 : 1000 * 2 ** (attempt - 1));
        return getJson(url, attempt + 1);
      }
      throw new Error(response.status + ' ' + response.statusText + ': ' + url);
    }

    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function wikidataBatch(plants) {
  const values = plants.map(plant => sparqlString(plant.scientificName)).join(' ');
  const query = `
SELECT ?item ?name ?image WHERE {
  VALUES ?name { ${values} }
  ?item wdt:P225 ?name .
  OPTIONAL { ?item wdt:P18 ?image . }
}
`;

  const url = new URL(WDQS);
  url.searchParams.set('format', 'json');
  url.searchParams.set('query', query);

  const data = await getJson(url);
  const result = new Map();

  for (const binding of data.results?.bindings || []) {
    const name = binding.name?.value;
    const item = binding.item?.value?.split('/').pop();
    if (!name || !item) continue;

    const current = result.get(key(name)) || { wikidata: item, file: null };
    current.wikidata = item;

    const file = commonsFileFromImageUri(binding.image?.value);
    if (file && !current.file) current.file = file;

    result.set(key(name), current);
  }

  return result;
}

async function commonsInfo(files) {
  const titles = [...new Set(files.filter(Boolean))].map(file =>
    file.startsWith('File:') ? file : 'File:' + file
  );

  const result = new Map();

  for (const batch of chunks(titles, 50)) {
    const url = new URL(COMMONS_API);
    url.searchParams.set('action', 'query');
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatversion', '2');
    url.searchParams.set('titles', batch.join('|'));
    url.searchParams.set('prop', 'imageinfo');
    url.searchParams.set('iiprop', 'url|extmetadata');
    url.searchParams.set('iiurlwidth', '480');
    url.searchParams.set(
      'iiextmetadatafilter',
      'LicenseShortName|LicenseUrl|Artist|Credit|ImageDescription'
    );
    url.searchParams.set('origin', '*');

    const data = await getJson(url);

    for (const page of data.query?.pages || []) {
      const info = page.imageinfo?.[0];
      const meta = info?.extmetadata || {};
      const license = stripHtml(meta.LicenseShortName?.value);

      if (!info?.url || !freeLicense(license)) continue;

      result.set(key(page.title.replace(/^File:/, '')), {
        url: info.thumburl || info.url,
        originalUrl: info.url,
        source: 'Wikimedia Commons',
        sourceUrl: commonsPageUrl(page.title),
        commonsFile: page.title.replace(/^File:/, ''),
        author: stripHtml(meta.Artist?.value) || null,
        credit: stripHtml(meta.Credit?.value) || null,
        license: license || null,
        licenseUrl: stripHtml(meta.LicenseUrl?.value) || null
      });
    }

    await sleep(100);
  }

  return result;
}

async function main() {
  const plants = JSON.parse(await readFile(PLANTS_FILE, 'utf8'));

  let cache = {};
  try {
    cache = JSON.parse(await readFile(CACHE_FILE, 'utf8'));
  } catch {
    cache = {};
  }

  const pending = plants.filter(plant => !cache[plant.id]?.thumbnail?.url);
  console.log(plants.length + ' plants; ' + pending.length + ' missing thumbnails before bulk Wikidata');

  let checked = 0;
  let matched = 0;
  let images = 0;

  for (const batch of chunks(pending, BATCH_SIZE)) {
    let matches = new Map();

    try {
      matches = await wikidataBatch(batch);
    } catch (error) {
      console.warn('Wikidata batch failed: ' + error.message);
      await sleep(1000);
      continue;
    }

    const files = [...matches.values()].map(value => value.file).filter(Boolean);
    let media = new Map();

    try {
      media = await commonsInfo(files);
    } catch (error) {
      console.warn('Commons metadata batch failed: ' + error.message);
    }

    for (const plant of batch) {
      const match = matches.get(key(plant.scientificName));
      if (!match) continue;

      const row = cache[plant.id] || {};
      row.wikidata = match.wikidata;
      row.wikidataBulkCheckedAt = new Date().toISOString();
      matched += 1;

      const image = match.file ? media.get(key(match.file)) : null;
      if (image && !row.thumbnail?.url) {
        row.thumbnail = image;
        images += 1;
      }

      cache[plant.id] = row;
    }

    checked += batch.length;
    console.log(
      checked + '/' + pending.length +
      '; Wikidata matches ' + matched +
      '; free P18 images +' + images
    );

    await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2) + '\n', 'utf8');
    if (checked < pending.length) await sleep(DELAY_MS);
  }

  let withThumbnail = 0;
  let withWikidata = 0;
  const bySource = {};

  for (const plant of plants) {
    const enrichment = cache[plant.id] || {};
    const image = enrichment.thumbnail;

    if (enrichment.wikidata) {
      plant.identifiers ||= {};
      plant.identifiers.wikidata = enrichment.wikidata;
      withWikidata += 1;
    }

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

  await writeFile(PLANTS_FILE, JSON.stringify(plants, null, 2) + '\n', 'utf8');

  const coveragePercent = Number((withThumbnail / plants.length * 100).toFixed(2));

  try {
    const meta = JSON.parse(await readFile(META_FILE, 'utf8'));
    meta.thumbnails ||= {};
    meta.thumbnails.withThumbnail = withThumbnail;
    meta.thumbnails.withoutThumbnail = plants.length - withThumbnail;
    meta.thumbnails.coveragePercent = coveragePercent;
    meta.thumbnails.withWikidata = withWikidata;
    meta.thumbnails.bySource = bySource;
    meta.thumbnails.wikidataBulk = {
      checked,
      matched,
      freeP18ImagesAdded: images
    };
    await writeFile(META_FILE, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  } catch {}

  console.log(JSON.stringify({
    plants: plants.length,
    withThumbnail,
    withoutThumbnail: plants.length - withThumbnail,
    coveragePercent,
    withWikidata,
    checked,
    matched,
    imagesAdded: images,
    bySource
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
