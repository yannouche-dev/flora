import { readFile, writeFile } from 'node:fs/promises';

const CONCURRENCY = Number(process.env.THUMBNAIL_CONCURRENCY || 10);
const CHECKPOINT_EVERY = Number(process.env.CHECKPOINT_EVERY || 100);
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 40);

const FREE_LICENSES = [
  /^cc0\b/i,
  /^public domain\b/i,
  /^pd\b/i,
  /^cc by\b/i,
  /^cc-by\b/i,
  /^cc by-sa\b/i,
  /^cc-by-sa\b/i
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const stripHtml = value => String(value ?? '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

const freeLicense = value => FREE_LICENSES.some(pattern => pattern.test(stripHtml(value)));

function params(values) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  return query;
}

async function getJson(url, attempt = 1) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'GeoFlora thumbnail builder/1.0 (+https://github.com/yannouche-dev/flora)'
    }
  });

  if (!response.ok) {
    if (attempt < 5 && [429, 500, 502, 503, 504].includes(response.status)) {
      await sleep(500 * 2 ** (attempt - 1));
      return getJson(url, attempt + 1);
    }
    throw new Error(response.status + ' ' + response.statusText);
  }

  return response.json();
}

function commonsMedia(page) {
  const info = page.imageinfo?.[0];
  if (!info?.url) return null;

  const meta = info.extmetadata || {};
  const license = stripHtml(meta.LicenseShortName?.value);
  if (!freeLicense(license)) return null;

  return {
    url: info.thumburl || info.url,
    source: 'Wikimedia Commons',
    sourceUrl: 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(page.title),
    author: stripHtml(meta.Artist?.value) || null,
    license: license || null,
    licenseUrl: stripHtml(meta.LicenseUrl?.value) || null
  };
}

function score(page, scientificName) {
  const title = String(page.title || '').toLocaleLowerCase('la');
  const needle = scientificName.toLocaleLowerCase('la');
  let value = 0;
  if (title.includes(needle)) value += 10;
  if (/\.(jpg|jpeg|png|webp)$/i.test(title)) value += 2;
  return value;
}

async function findThumbnail(plant) {
  const search = params({
    action: 'query',
    generator: 'search',
    gsrsearch: '"' + plant.scientificName + '"',
    gsrnamespace: 6,
    gsrlimit: 8,
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: 420,
    iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist',
    format: 'json',
    origin: '*'
  });

  const data = await getJson('https://commons.wikimedia.org/w/api.php?' + search);
  const pages = Object.values(data.query?.pages || {})
    .sort((a, b) => score(b, plant.scientificName) - score(a, plant.scientificName));

  for (const page of pages) {
    const media = commonsMedia(page);
    if (media) return media;
  }

  return null;
}

async function main() {
  const plants = JSON.parse(await readFile('data/plants.json', 'utf8'));

  let cache = {};
  try {
    cache = JSON.parse(await readFile('data/thumbnails.json', 'utf8'));
  } catch {
    cache = {};
  }

  const pending = plants.filter(plant => !(String(plant.id) in cache));
  console.log(plants.length + ' plants; ' + pending.length + ' thumbnails to resolve');

  let cursor = 0;
  let processed = 0;
  let found = 0;

  async function checkpoint() {
    await writeFile('data/thumbnails.json', JSON.stringify(cache, null, 2) + '\n', 'utf8');
  }

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= pending.length) return;
      const plant = pending[index];

      try {
        cache[String(plant.id)] = await findThumbnail(plant);
        if (cache[String(plant.id)]) found += 1;
      } catch (error) {
        console.warn('Thumbnail failed for ' + plant.scientificName + ': ' + error.message);
        cache[String(plant.id)] = null;
      }

      processed += 1;
      if (processed % CHECKPOINT_EVERY === 0) {
        console.log(processed + '/' + pending.length + ' processed; ' + found + ' found');
        await checkpoint();
      }

      if (REQUEST_DELAY_MS > 0) await sleep(REQUEST_DELAY_MS);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await checkpoint();

  let attached = 0;
  for (const plant of plants) {
    plant.thumbnail = cache[String(plant.id)] || null;
    if (plant.thumbnail) attached += 1;
  }

  await writeFile('data/plants.json', JSON.stringify(plants, null, 2) + '\n', 'utf8');
  console.log(attached + '/' + plants.length + ' plants now have a search thumbnail');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
