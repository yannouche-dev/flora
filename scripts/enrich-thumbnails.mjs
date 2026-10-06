import { readFile, writeFile } from 'node:fs/promises';

const PLANTS_FILE = process.env.PLANTS_FILE || 'data/plants.json';
const META_FILE = process.env.META_FILE || 'data/meta.json';
const CACHE_FILE = process.env.THUMBNAILS_FILE || 'data/thumbnails.json';
const API = 'https://en.wikipedia.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const BATCH_SIZE = 50;
const DELAY_MS = Number(process.env.WIKIMEDIA_DELAY_MS || 1400);
const RETRY_AFTER_DAYS = Number(process.env.THUMBNAIL_RETRY_DAYS || 90);
const USER_AGENT = 'GeoFlora/1.0 (https://github.com/yannouche-dev/flora)';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const key = value => clean(value).toLocaleLowerCase('la');

async function getJson(base, values, attempt = 1) {
  const url = new URL(base);
  for (const [name, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.set(name, String(value));
    }
  }

  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': USER_AGENT
    }
  });

  if (!response.ok) {
    if (attempt < 5 && [429, 500, 502, 503, 504].includes(response.status)) {
      const retryAfter = Number(response.headers.get('retry-after') || 0);
      await sleep(retryAfter ? retryAfter * 1000 : 1500 * 2 ** (attempt - 1));
      return getJson(base, values, attempt + 1);
    }
    throw new Error(response.status + ' ' + response.statusText + ': ' + url);
  }

  return response.json();
}

function chunks(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) result.push(array.slice(i, i + size));
  return result;
}

function stripHtml(value) {
  return clean(String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'"));
}

function fileTitle(name) {
  if (!name) return null;
  return name.startsWith('File:') ? name : 'File:' + name;
}

function commonsPageUrl(title) {
  return 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_'));
}

function fresh(entry) {
  if (!entry?.checkedAt) return false;
  const age = Date.now() - Date.parse(entry.checkedAt);
  return Number.isFinite(age) && age < RETRY_AFTER_DAYS * 86400000;
}

async function wikipediaPages(plants) {
  const titles = plants.map(plant => plant.scientificName).join('|');
  const data = await getJson(API, {
    action: 'query',
    format: 'json',
    formatversion: 2,
    redirects: 1,
    titles,
    prop: 'pageimages|pageprops',
    piprop: 'name|thumbnail',
    pithumbsize: 480,
    ppprop: 'wikibase_item',
    origin: '*'
  });

  const redirects = new Map(
    (data.query?.redirects || []).map(row => [key(row.from), key(row.to)])
  );

  const pages = new Map();
  for (const page of data.query?.pages || []) {
    if (page.missing) continue;
    pages.set(key(page.title), page);
  }

  const resolved = new Map();
  for (const plant of plants) {
    const wanted = key(plant.scientificName);
    const page = pages.get(wanted) || pages.get(redirects.get(wanted));
    if (page) resolved.set(plant.id, page);
  }

  return resolved;
}

async function wikidataImages(pageMap) {
  const ids = [...new Set(
    [...pageMap.values()]
      .map(page => page.pageprops?.wikibase_item)
      .filter(Boolean)
  )];

  if (!ids.length) return new Map();

  const data = await getJson(WIKIDATA_API, {
    action: 'wbgetentities',
    format: 'json',
    ids: ids.join('|'),
    props: 'claims',
    origin: '*'
  });

  const result = new Map();

  for (const [id, entity] of Object.entries(data.entities || {})) {
    const claim = entity?.claims?.P18?.find(row =>
      row?.mainsnak?.snaktype === 'value' &&
      typeof row?.mainsnak?.datavalue?.value === 'string'
    );
    const filename = claim?.mainsnak?.datavalue?.value;
    if (filename) result.set(id, filename);
  }

  return result;
}

async function commonsInfo(titlesInput) {
  const titles = [...new Set(
    titlesInput
      .map(fileTitle)
      .filter(Boolean)
  )];

  if (!titles.length) return new Map();

  const data = await getJson(COMMONS_API, {
    action: 'query',
    format: 'json',
    formatversion: 2,
    titles: titles.join('|'),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: 480,
    iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|Credit|ImageDescription',
    origin: '*'
  });

  const result = new Map();

  for (const page of data.query?.pages || []) {
    if (page.missing || !page.imageinfo?.[0]) continue;
    const info = page.imageinfo[0];
    const meta = info.extmetadata || {};
    result.set(key(page.title), {
      url: info.thumburl || info.url || null,
      originalUrl: info.url || null,
      source: 'Wikimedia Commons',
      sourceUrl: commonsPageUrl(page.title),
      commonsFile: page.title.replace(/^File:/, ''),
      author: stripHtml(meta.Artist?.value),
      credit: stripHtml(meta.Credit?.value),
      license: stripHtml(meta.LicenseShortName?.value),
      licenseUrl: stripHtml(meta.LicenseUrl?.value)
    });
  }

  return result;
}

async function readCache() {
  try {
    return JSON.parse(await readFile(CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function main() {
  const plants = JSON.parse(await readFile(PLANTS_FILE, 'utf8'));
  const cache = await readCache();

  const pending = plants.filter(plant => !fresh(cache[plant.id]));
  console.log(plants.length + ' plants; ' + pending.length + ' thumbnails to check');

  let checked = 0;
  let found = 0;

  for (const batch of chunks(pending, BATCH_SIZE)) {
    const pages = await wikipediaPages(batch);
    const wikidata = await wikidataImages(pages);

    const chosenFiles = new Map();
    for (const plant of batch) {
      const page = pages.get(plant.id);
      const qid = page?.pageprops?.wikibase_item;
      const filename = (qid && wikidata.get(qid)) || page?.pageimage || null;
      if (filename) chosenFiles.set(plant.id, filename);
    }

    const media = await commonsInfo([...chosenFiles.values()]);
    const checkedAt = new Date().toISOString();

    for (const plant of batch) {
      const page = pages.get(plant.id);
      const filename = chosenFiles.get(plant.id);
      const image = filename ? media.get(key(fileTitle(filename))) : null;

      cache[plant.id] = {
        checkedAt,
        wikidata: page?.pageprops?.wikibase_item || null,
        thumbnail: image?.url ? image : null
      };

      checked += 1;
      if (image?.url) found += 1;
    }

    console.log('Checked ' + checked + '/' + pending.length + '; found ' + found);
    await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2) + '\n', 'utf8');

    if (checked < pending.length) await sleep(DELAY_MS);
  }

  let withThumbnail = 0;
  let withWikidata = 0;

  for (const plant of plants) {
    const enrichment = cache[plant.id] || {};
    const image = enrichment.thumbnail;
    plant.thumbnail = image?.url ? {
      url: image.url,
      source: image.source,
      sourceUrl: image.sourceUrl,
      author: image.author || null,
      license: image.license || null
    } : null;

    if (enrichment.wikidata) {
      plant.identifiers ||= {};
      plant.identifiers.wikidata = enrichment.wikidata;
      withWikidata += 1;
    }

    if (plant.thumbnail?.url) withThumbnail += 1;
  }

  await writeFile(PLANTS_FILE, JSON.stringify(plants, null, 2) + '\n', 'utf8');

  const thumbnailCoverage = Number((withThumbnail / plants.length * 100).toFixed(2));
  try {
    const meta = JSON.parse(await readFile(META_FILE, 'utf8'));
    meta.thumbnails = {
      source: 'Wikidata P18 + Wikimedia Commons',
      withThumbnail,
      withoutThumbnail: plants.length - withThumbnail,
      coveragePercent: thumbnailCoverage,
      withWikidata
    };
    await writeFile(META_FILE, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  } catch {}

  console.log(JSON.stringify({
    plants: plants.length,
    withThumbnail,
    withoutThumbnail: plants.length - withThumbnail,
    thumbnailCoverage,
    withWikidata
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
