import { readFile, writeFile } from 'node:fs/promises';

const PLANTS_FILE = process.env.PLANTS_FILE || 'data/plants.json';
const META_FILE = process.env.META_FILE || 'data/meta.json';
const CACHE_FILE = process.env.THUMBNAILS_FILE || 'data/thumbnails.json';

const CONCURRENCY = Number(process.env.FALLBACK_CONCURRENCY || 4);
const REQUEST_DELAY_MS = Number(process.env.FALLBACK_DELAY_MS || 180);
const RETRY_AFTER_DAYS = Number(process.env.FALLBACK_RETRY_DAYS || 90);
const GBIF_LIMIT = Number(process.env.GBIF_MEDIA_LIMIT || 30);
const USER_AGENT = 'GeoFlora/1.0 (https://github.com/yannouche-dev/flora)';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

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

function licenseUrl(value) {
  const raw = clean(value);
  if (/^https?:\/\//i.test(raw) && /creativecommons\.org/i.test(raw)) return raw;
  return null;
}

function fresh(value) {
  if (!value) return false;
  const age = Date.now() - Date.parse(value);
  return Number.isFinite(age) && age < RETRY_AFTER_DAYS * 86400000;
}

async function getJson(url, attempt = 1) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': USER_AGENT
    }
  });

  if (!response.ok) {
    if (attempt < 5 && [429, 500, 502, 503, 504].includes(response.status)) {
      const retryAfter = Number(response.headers.get('retry-after') || 0);
      await sleep(retryAfter ? retryAfter * 1000 : 800 * 2 ** (attempt - 1));
      return getJson(url, attempt + 1);
    }
    throw new Error(response.status + ' ' + response.statusText + ': ' + url);
  }

  return response.json();
}

async function gbifThumbnail(plant) {
  const url = new URL('https://api.gbif.org/v1/occurrence/search');
  url.searchParams.set('scientificName', plant.scientificName);
  url.searchParams.set('mediaType', 'StillImage');
  url.searchParams.set('limit', String(GBIF_LIMIT));

  const data = await getJson(url);

  for (const occurrence of data.results || []) {
    const occurrenceName = clean(occurrence.species || occurrence.acceptedScientificName || occurrence.scientificName);
    if (occurrenceName && !occurrenceName.toLowerCase().startsWith(plant.scientificName.toLowerCase())) continue;

    for (const media of occurrence.media || []) {
      const license = freeLicense(media.license);
      const image = media.identifier || media.references;
      if (!license || !image || !/^https?:\/\//i.test(image)) continue;

      return {
        url: image,
        source: 'GBIF',
        sourceUrl: occurrence.key
          ? 'https://www.gbif.org/occurrence/' + occurrence.key
          : clean(occurrence.references) || null,
        author: clean(media.creator || occurrence.recordedBy || occurrence.rightsHolder) || null,
        license,
        licenseUrl: licenseUrl(media.license),
        provider: clean(occurrence.institutionCode || occurrence.datasetTitle || occurrence.publisher) || null
      };
    }
  }

  return null;
}

async function inaturalistThumbnail(plant) {
  const url = new URL('https://api.inaturalist.org/v1/observations');
  url.searchParams.set('taxon_name', plant.scientificName);
  url.searchParams.set('photos', 'true');
  url.searchParams.set('quality_grade', 'research');
  url.searchParams.set('photo_license', 'cc0,cc-by,cc-by-sa');
  url.searchParams.set('per_page', '20');
  url.searchParams.set('order_by', 'votes');
  url.searchParams.set('order', 'desc');

  const data = await getJson(url);

  for (const observation of data.results || []) {
    const taxonName = clean(observation.taxon?.name);
    if (taxonName && !taxonName.toLowerCase().startsWith(plant.scientificName.toLowerCase())) continue;

    for (const photo of observation.photos || []) {
      const license = freeLicense(photo.license_code);
      if (!license || !photo.url) continue;

      return {
        url: photo.url.replace('/square.', '/medium.'),
        source: 'iNaturalist',
        sourceUrl: observation.uri || 'https://www.inaturalist.org/observations/' + observation.id,
        author: clean(photo.attribution) || clean(observation.user?.name || observation.user?.login) || null,
        license,
        licenseUrl: null
      };
    }
  }

  return null;
}

async function resolveThumbnail(plant) {
  try {
    const inaturalist = await inaturalistThumbnail(plant);
    if (inaturalist) return inaturalist;
  } catch (error) {
    console.warn('iNaturalist ' + plant.scientificName + ': ' + error.message);
  }

  try {
    const gbif = await gbifThumbnail(plant);
    if (gbif) return gbif;
  } catch (error) {
    console.warn('GBIF ' + plant.scientificName + ': ' + error.message);
  }

  return null;
}

async function main() {
  const plants = JSON.parse(await readFile(PLANTS_FILE, 'utf8'));

  let cache = {};
  try {
    cache = JSON.parse(await readFile(CACHE_FILE, 'utf8'));
  } catch {
    cache = {};
  }

  const pending = plants.filter(plant => {
    const row = cache[plant.id] || {};
    return !row.thumbnail?.url && !fresh(row.fallbackCheckedAt);
  });

  console.log(plants.length + ' plants; ' + pending.length + ' open-media fallbacks to check');

  let cursor = 0;
  let checked = 0;
  let foundGbif = 0;
  let foundInaturalist = 0;

  async function checkpoint() {
    await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2) + '\n', 'utf8');
  }

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= pending.length) return;

      const plant = pending[index];
      const thumbnail = await resolveThumbnail(plant);
      const row = cache[plant.id] || {};

      if (thumbnail) {
        row.thumbnail = thumbnail;
        if (thumbnail.source === 'GBIF') foundGbif += 1;
        if (thumbnail.source === 'iNaturalist') foundInaturalist += 1;
      }

      row.fallbackCheckedAt = new Date().toISOString();
      cache[plant.id] = row;

      checked += 1;
      if (checked % 100 === 0) {
        console.log(
          checked + '/' + pending.length +
          '; GBIF +' + foundGbif +
          '; iNaturalist +' + foundInaturalist
        );
        await checkpoint();
      }

      if (REQUEST_DELAY_MS > 0) await sleep(REQUEST_DELAY_MS);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length || 1) }, worker));
  await checkpoint();

  let withThumbnail = 0;
  const bySource = {};

  for (const plant of plants) {
    const enrichment = cache[plant.id] || {};
    const image = enrichment.thumbnail;

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
    meta.thumbnails.bySource = bySource;
    meta.thumbnails.fallbacks = {
      gbif: true,
      inaturalist: true,
      acceptedLicenses: ['CC0', 'CC BY', 'CC BY-SA']
    };
    await writeFile(META_FILE, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  } catch {}

  console.log(JSON.stringify({
    plants: plants.length,
    withThumbnail,
    withoutThumbnail: plants.length - withThumbnail,
    coveragePercent,
    bySource,
    checked,
    foundGbif,
    foundInaturalist
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
