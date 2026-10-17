/** A Commons licence that lets the image be shown with credit: CC0, public domain, CC BY, CC BY-SA … */
const FREE_LICENSES = [
  /^cc0\b/i,
  /^public domain\b/i,
  /^pd\b/i,
  /^cc[- ]by\b/i
];
/** … never NC (non-commercial) nor ND (no derivatives): « CC BY-NC 4.0 », « cc-by-nd » are not free (audit LEG-12). */
const NOT_FREE = /\bn[cd]\b|non[- ]?commercial|no[- ]?deriv/i;

/**
 * How the app names itself to Wikimedia's APIs (their User-Agent policy: a browser cannot set User-Agent, so
 * Api-User-Agent): the app and where to reach its authors. The MediaWiki APIs (action and REST) accept the header
 * across origins; the query service (query.wikidata.org) is left without it, its cross-origin preflight unverified.
 */
export const WIKIMEDIA_AGENT = 'GeoFlora (https://github.com/yannouche-dev/flora)';
const WIKIMEDIA_API = /^https:\/\/[a-z.-]*\b(wikipedia|wikidata|wikimedia|wikibooks)\.org\/(w\/api\.php|api\/rest_v1\/)/;

/** The headers of a request to `url`: Api-User-Agent for a Wikimedia API. @param {string} url @returns {Record<string, string>} */
export const wikimediaHeaders = url => WIKIMEDIA_API.test(url) ? { 'Api-User-Agent': WIKIMEDIA_AGENT } : {};

const stripHtml = value => String(value ?? '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

const exact = (a, b) => String(a ?? '').trim().toLocaleLowerCase('la') ===
  String(b ?? '').trim().toLocaleLowerCase('la');

/** GBIF occurrence filter: this taxon in France, presences only, coordinates without known issue. */
const GBIF_FR = key => ({ taxonKey: key, country: 'FR', occurrenceStatus: 'PRESENT', hasGeospatialIssue: 'false' });

/** A licence that lets the image be shown with credit: CC0, CC BY, CC BY-SA (not NC, not ND). */
export const FREE_MEDIA = /creativecommons\.org\/(licenses\/by(-sa)?\/|publicdomain)|^cc0|^cc[ -_]by(?![ -_]?n)/i;

/** iNaturalist originals can weigh megabytes: the 500 px copy is enough for a gallery. */
const smallerImage = url => String(url).replace(/(inaturalist-open-data\.s3\.amazonaws\.com\/photos\/\d+\/)original\./, '$1medium.');

/** Bidirectional controls (marks, embeddings, overrides, isolates): they can make a text read in another order. */
const BIDI = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/**
 * A free-text field of a GBIF record (institution, catalogue number, place, collector…), written by whoever publishes
 * the dataset: plain text (markup and bidirectional controls dropped, control characters as spaces, spaces
 * collapsed), at most `max` characters. Other format characters stay: the joiners of Persian or Indic words, emoji.
 * The app shows it as text, but such a field once reached a map label set as HTML (audit SEC-2).
 */
const plainText = (value, max = 120) => {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const chars = [...stripHtml(String(value).replace(/\p{Cc}/gu, ' ').replace(BIDI, '')).replace(/\s*[<>]+\s*/g, ' ').trim()];
  return chars.length > max ? chars.slice(0, max - 1).join('').trimEnd() + '…' : chars.join('');
};

/** Distance in metres between two [lon, lat] points. */
function haversine([lon1, lat1], [lon2, lat2]) {
  const rad = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * rad / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lon2 - lon1) * rad / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

/** @typedef {{ signal?: AbortSignal, limit?: number, levels?: number }} RequestOptions what a request may be given */

/** How long a call may take when no fetchJson is given (ms). */
const TIMEOUT = 15000;

/**
 * The JSON of `url`, when the app gives no fetchJson of its own (it gives app/core/net.js's): a time limit, an error
 * on an HTTP error, on an answer that is not JSON or not shaped as `expect` wants. Errors are thrown, never read as
 * « no data ».
 * @param {string} url
 * @typedef {{ signal?: AbortSignal, headers?: Record<string, string>, expect?: (data: any) => boolean, allowEmpty?: boolean }} JsonOptions
 * @param {JsonOptions} [options]
 */
async function json(url, { signal, headers = {}, expect, allowEmpty = false } = {}) {
  const timer = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(TIMEOUT) : null;
  const both = signal && timer && typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timer]) : signal || timer || undefined;
  const response = await fetch(url, { signal: both, headers: { accept: 'application/json', ...headers } });

  if (!response.ok) {
    throw Object.assign(new Error(response.status + ' ' + response.statusText + ': ' + url), { status: response.status });
  }

  const text = await response.text();
  if (allowEmpty && !text.trim()) return null;
  const data = JSON.parse(text);
  if (data === null || typeof data !== 'object' || (expect && !expect(data))) throw new Error('Unexpected answer: ' + url);
  return data;
}

/** Minimal shapes of the answers read (an API that changed fails loudly instead of reading as « nothing »). */
const has = {
  results: (/** @type {any} */ d) => Array.isArray(d.results),
  search: (/** @type {any} */ d) => Array.isArray(d.search),
  entities: (/** @type {any} */ d) => Boolean(d.entities) && typeof d.entities === 'object',
  data: (/** @type {any} */ d) => Array.isArray(d.data),
  count: (/** @type {any} */ d) => typeof d.count === 'number',
  query: (/** @type {any} */ d) => !d.error
};

/** Section titles left out: references, links, galleries; protection (INPN is the reference); fiction. */
const WIKI_SKIP = /^(notes?|references?|liens?|voir aussi|bibliographie|articles? connexes?|galerie|annexes?|sources?|webographie|reference taxonomique|statuts? de protection|protection|menaces|dans la (fiction|culture)|filmographie|liste des)/;

/** The theme of a section, from its title (accents and case aside); the first that matches. */
const WIKI_THEMES = /** @type {[string, RegExp][]} */ ([
  ['toxicity', /toxi|danger|precaution|poison|confusion|contre indic|intoxic|hypersensib|effets? indesirable/],
  ['food', /aliment|cuisin|culinai|comestib|gastronom|recette|consommation|legume|condiment/],
  ['uses', /usage|utilis|propriet|medic|therap|phyto|vertu|emploi|posolog|principes? actifs?|constituant|composition|industri|apicult|mellif|interet/],
  ['description', /descri|morpho|caracter|appareil|feuill|fleur|fruit|graine|tige|racine|botaniq|identific|aspect/],
  ['biology', /biolog|reproduc|pollini|phenolog|floraison|cycle|dissemin|germination|ecophysio/],
  ['ecology', /ecolog|habitat|biotope|milieu|espece hote|hotes?$|interaction|faune|parasit|ravageur|maladie/],
  ['distribution', /reparti|distribution|aire|origine|presence|localisation|en france|invasi/],
  ['names', /etymo|phytonym|nom|denomin|appell|vernacul|toponym/],
  ['history', /histoir|symbol|folklor|mytho|tradition|legende|litterat|culture populaire|dans les arts|heraldi|calendrier republicain/],
  ['taxonomy', /taxon|taxin|systemat|synonym|classif|sous especes?|variet|hybrid|phylog|cultivar/]
]);
const foldTitle = (/** @type {string} */ t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
/** @param {string} title */
export const wikiTheme = title => WIKI_THEMES.find(([, re]) => re.test(foldTitle(title)))?.[0] || 'other';

/**
 * A plain-text article (« == Titre == » headings) cut in sections: each sub-section takes its own theme, else
 * its parent's; a section without text of its own (only sub-sections) is not kept on its own.
 * @param {string} text @returns {{ lead: string, sections: { theme: string, title: string, text: string }[] }}
 */
export function wikiSections(text) {
  const parts = String(text).split(/\n(?=={2,}\s)/);
  const clean = (/** @type {string} */ t) => t.replace(/\n{2,}/g, '\n').trim().slice(0, 5000);
  const lead = clean(parts.shift() || '');
  /** @type {{ theme: string, title: string, text: string }[]} */
  const sections = [];
  /** @type {{ title: string, skip: boolean, theme: string } | null} */
  let parent = null;
  for (const part of parts) {
    const m = /^(={2,})\s*(.+?)\s*\1\s*\n?([\s\S]*)$/.exec(part);
    if (!m) continue;
    const level = m[1].length, title = m[2], body = clean(m[3]);
    if (level === 2) parent = { title, skip: WIKI_SKIP.test(foldTitle(title)), theme: wikiTheme(title) };
    if (parent?.skip || WIKI_SKIP.test(foldTitle(title)) || !body) continue;
    const own = wikiTheme(title);
    const theme = own !== 'other' ? own : parent?.theme || 'other';
    sections.push({ theme, title: level > 2 && parent ? `${parent.title} › ${title}` : title, text: body });
  }
  return { lead, sections };
}

function params(values) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) for (const v of value) search.append(key, String(v));
    else if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  return search;
}

export function freeLicense(name) {
  const value = stripHtml(name);
  return FREE_LICENSES.some(pattern => pattern.test(value)) && !NOT_FREE.test(value);
}

function commonsMeta(info = {}) {
  const metadata = info.extmetadata || {};
  const license = stripHtml(metadata.LicenseShortName?.value);
  return {
    url: info.url || null,
    thumbnail: info.thumburl || info.url || null,
    // Size of the original (the media viewer zooms on it).
    width: info.width || null,
    height: info.height || null,
    author: stripHtml(metadata.Artist?.value),
    credit: stripHtml(metadata.Credit?.value),
    description: stripHtml(metadata.ImageDescription?.value),
    license,
    licenseUrl: stripHtml(metadata.LicenseUrl?.value),
    free: freeLicense(license)
  };
}

export class PlantSources {
  #cache = new Map();

  /**
   * @param {object} [options]
   * @param {string | null} [options.trefleToken] Trefle API token (none: Trefle is not called)
   * @param {number} [options.cacheTtl] how long an answer is kept, in milliseconds
   * @param {boolean} [options.allowUnverifiedMedia] media whose licence is not checked may be shown
   * @param {(service: string) => boolean} [options.enabled] services the user switched off are never called
   *   ('gbif', 'inaturalist', 'wikidata', 'wikipedia', 'commons', 'trefle'); they answer null or [].
   * @param {(url: string, options: JsonOptions) => Promise<any>} [options.fetchJson]
   *   how JSON is fetched (the app gives app/core/net.js's: time limit, typed errors); a failure is thrown, never
   *   read as « no data »: the results that gather several sources say which ones failed (`unavailable`).
   */
  constructor({ trefleToken = null, cacheTtl = 86400000, allowUnverifiedMedia = false, enabled = () => true, fetchJson = json } = {}) {
    this.enabled = enabled;
    this.fetchJson = fetchJson;
    this.trefleToken = trefleToken;
    this.cacheTtl = cacheTtl;
    this.allowUnverifiedMedia = allowUnverifiedMedia;
  }

  links(plant) {
    const q = encodeURIComponent(plant.scientificName);
    return {
      taxref: plant.links?.taxref || null,
      inpn: plant.links?.inpn || null,
      gbif: 'https://www.gbif.org/species/search?q=' + q,
      inaturalist: 'https://www.inaturalist.org/taxa/search?q=' + q,
      wikimedia: 'https://commons.wikimedia.org/w/index.php?search=' + q + '&title=Special:MediaSearch&type=image',
      wikidata: 'https://www.wikidata.org/w/index.php?search=' + q,
      trefle: 'https://trefle.io/species?query=' + q
    };
  }

  /** JSON from `url`, Wikimedia's APIs told who asks (Api-User-Agent). */
  /** @param {string} url @param {JsonOptions} [options] */
  #json(url, { signal, expect, allowEmpty } = {}) {
    return this.fetchJson(url, { signal, headers: wikimediaHeaders(url), expect, allowEmpty });
  }

  async #cached(key, loader) {
    const cached = this.#cache.get(key);
    if (cached && Date.now() - cached.at < this.cacheTtl) return cached.value;

    const value = await loader();
    this.#cache.set(key, { at: Date.now(), value });
    return value;
  }

  /**
   * The plant in the GBIF Backbone: `species/match` (plants only, no fuzzy guess). A match above the species
   * or none at all gives null; an exact name found by the plain search is the fallback.
   */
  async gbifTaxon(plant, /** @type {RequestOptions} */ { signal } = {}) {
    if (!this.enabled('gbif')) return null;
    return this.#cached('gbif:' + plant.scientificName, async () => {
      // The match failing, the plain search is tried; it finding nothing then is not « not on GBIF »: the failure is.
      let matchError = null;
      const match = await this.#json('https://api.gbif.org/v1/species/match?' + params({ name: plant.scientificName, kingdom: 'Plantae', strict: 'true' }), { signal })
        .catch(error => { if (error?.name === 'AbortError') throw error; matchError = error; return null; });
      if (match?.usageKey && match.matchType !== 'NONE' && match.matchType !== 'HIGHERRANK') {
        // A synonym's accepted taxon holds the occurrences and most of the data.
        const key = match.acceptedUsageKey ?? match.usageKey;
        return {
          id: key,
          key,
          nubKey: key,
          scientificName: match.scientificName ?? plant.scientificName,
          canonicalName: match.canonicalName ?? plant.scientificName,
          status: match.status ?? null,
          rank: match.rank ?? null,
          confidence: match.confidence ?? null,
          matchType: match.matchType ?? null
        };
      }
      const data = await this.#json('https://api.gbif.org/v1/species/search?' + params({ q: plant.scientificName, rank: 'SPECIES', limit: 20 }), { signal, expect: has.results });
      const rows = data.results;
      const hit = rows.find(row => exact(row.canonicalName, plant.scientificName) && (!row.kingdom || row.kingdom === 'Plantae'));
      if (!hit && matchError) throw matchError;
      if (!hit) return null;
      const key = hit.nubKey ?? hit.key ?? null;
      return {
        id: key,
        key,
        nubKey: hit.nubKey ?? null,
        scientificName: hit.scientificName ?? hit.canonicalName ?? plant.scientificName,
        canonicalName: hit.canonicalName ?? plant.scientificName,
        status: hit.taxonomicStatus ?? null,
        rank: hit.rank ?? null,
        confidence: null,
        matchType: 'SEARCH'
      };
    });
  }

  async inaturalistTaxon(plant, /** @type {RequestOptions} */ { signal } = {}) {
    if (!this.enabled('inaturalist')) return null;
    return this.#cached('inat:' + plant.scientificName, async () => {
      const query = params({
        q: plant.scientificName,
        rank: 'species',
        is_active: 'true',
        per_page: 20
      });
      const data = await this.#json('https://api.inaturalist.org/v1/taxa?' + query, { signal, expect: has.results });
      const rows = data.results;
      const hit = rows.find(row => exact(row.name, plant.scientificName));
      if (!hit) return null;

      const photoLicense = hit.default_photo?.license_code || '';
      const photoIsFree = /^(cc0|cc-by|cc-by-sa)$/i.test(photoLicense);
      const photo = hit.default_photo && photoIsFree ? {
        url: hit.default_photo.medium_url || hit.default_photo.original_url || null,
        thumbnail: hit.default_photo.square_url || hit.default_photo.medium_url || null,
        attribution: hit.default_photo.attribution || null,
        license: photoLicense
      } : null;

      return {
        id: hit.id,
        name: hit.name,
        commonName: hit.preferred_common_name || null,
        observationsCount: hit.observations_count ?? null,
        wikipediaUrl: hit.wikipedia_url || null,
        thumbnail: photo?.thumbnail || photo?.url || null,
        photo
      };
    });
  }

  async wikidataTaxon(plant, /** @type {RequestOptions} */ { signal } = {}) {
    if (!this.enabled('wikidata')) return null;
    return this.#cached('wikidata:' + plant.scientificName, async () => {
      const search = params({
        action: 'wbsearchentities',
        search: plant.scientificName,
        language: 'en',
        uselang: 'en',
        type: 'item',
        limit: 10,
        format: 'json',
        origin: '*'
      });
      const found = await this.#json('https://www.wikidata.org/w/api.php?' + search, { signal, expect: has.search });
      const ids = found.search.map(item => item.id).filter(Boolean);
      if (!ids.length) return null;

      const entityQuery = params({
        action: 'wbgetentities',
        ids: ids.join('|'),
        props: 'claims|labels',
        languages: 'en|fr',
        format: 'json',
        origin: '*'
      });
      const entities = await this.#json('https://www.wikidata.org/w/api.php?' + entityQuery, { signal, expect: has.entities });

      for (const id of ids) {
        const entity = entities.entities?.[id];
        const taxonName = entity?.claims?.P225?.[0]?.mainsnak?.datavalue?.value;
        if (exact(taxonName, plant.scientificName)) {
          return {
            id,
            taxonName,
            label: entity.labels?.fr?.value || entity.labels?.en?.value || taxonName
          };
        }
      }

      return null;
    });
  }

  async trefleTaxon(plant, /** @type {RequestOptions} */ { signal } = {}) {
    if (!this.enabled('trefle')) return null;
    if (!this.trefleToken) return null;

    return this.#cached('trefle:' + plant.scientificName, async () => {
      const query = params({
        token: this.trefleToken,
        q: plant.scientificName,
        limit: 20
      });
      const data = await this.#json('https://trefle.io/api/v1/species/search?' + query, { signal, expect: has.data });
      const rows = data.data;
      const hit = rows.find(row => exact(row.scientific_name, plant.scientificName));
      if (!hit) return null;

      return {
        id: hit.id,
        slug: hit.slug,
        scientificName: hit.scientific_name,
        imageUrl: hit.image_url || null,
        commonName: hit.common_name || null,
        family: hit.family || null,
        genus: hit.genus || null
      };
    });
  }

  async trefleDetails(trefle, /** @type {RequestOptions} */ { signal } = {}) {
    if (!this.enabled('trefle')) return null;
    if (!this.trefleToken || !trefle?.id) return null;

    return this.#cached('trefle-details:' + trefle.id, async () => {
      const query = params({ token: this.trefleToken });
      const data = await this.#json('https://trefle.io/api/v1/species/' + trefle.id + '?' + query, { signal });
      return data.data || null;
    });
  }

  /**
   * The photos chosen for a taxon on iNaturalist (taxon_photos), under a free licence, with every size
   * (square → original) and the size of the original.
   */
  async inaturalistPhotos(taxonId, /** @type {RequestOptions} */ { signal } = {}) {
    if (!this.enabled('inaturalist') || !taxonId) return [];
    return this.#cached('inat-photos:' + taxonId, async () => {
      const data = await this.#json('https://api.inaturalist.org/v1/taxa/' + taxonId, { signal, expect: has.results });
      return (data.results?.[0]?.taxon_photos || []).map(t => t.photo).filter(p => p && /^(cc0|cc-by|cc-by-sa)$/i.test(p.license_code || ''))
        .map(p => ({
          id: p.id,
          square: p.square_url || p.url || null,
          medium: p.medium_url || null,
          large: p.large_url || null,
          original: p.original_url || null,
          width: p.original_dimensions?.width || null,
          height: p.original_dimensions?.height || null,
          attribution: p.attribution || null,
          author: p.attribution_name || null,
          license: p.license_code,
          pageUrl: 'https://www.inaturalist.org/photos/' + p.id
        }));
    });
  }

  async commonsImages(plant, /** @type {RequestOptions} */ { signal, limit = 8 } = {}) {
    if (!this.enabled('commons')) return [];
    const key = 'commons:' + plant.scientificName + ':' + limit;
    return this.#cached(key, async () => {
      const query = params({
        action: 'query',
        generator: 'search',
        gsrsearch: '"' + plant.scientificName + '"',
        gsrnamespace: 6,
        gsrlimit: limit,
        prop: 'imageinfo',
        iiprop: 'url|size|extmetadata',
        iiurlwidth: 900,
        iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|Credit|ImageDescription',
        format: 'json',
        origin: '*'
      });
      const data = await this.#json('https://commons.wikimedia.org/w/api.php?' + query, { signal, expect: has.query });

      return Object.values(data.query?.pages || {})
        .map(page => {
          const media = commonsMeta(page.imageinfo?.[0]);
          return {
            ...media,
            title: page.title,
            pageUrl: 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(page.title)
          };
        })
        .filter(media => media.url && media.free);
    });
  }

  /**
   * One kind of data on a GBIF species, fetched on its own (only what the sheet shows is asked for):
   * 'vernacularNames' | 'descriptions' | 'distributions' | 'speciesProfiles' | 'synonyms' | 'iucnRedListCategory'.
   */
  async gbifSpecies(key, part, /** @type {RequestOptions} */ { signal } = {}) {
    if (!this.enabled('gbif') || !key) return null;
    const limits = { vernacularNames: 300, descriptions: 100, distributions: 200, speciesProfiles: 100, synonyms: 100 };
    const url = 'https://api.gbif.org/v1/species/' + key + '/' + part + (limits[part] ? '?limit=' + limits[part] : '');
    // The pages of a species' data hold `results`; its IUCN category is a bare object, or nothing when never assessed.
    if (part === 'iucnRedListCategory') {
      return this.#cached('gbif-' + part + ':' + key, () => this.#json(url, { signal, allowEmpty: true })
        .catch(error => { if (error?.status === 404 || error?.status === 204) return null; throw error; }));
    }
    return this.#cached('gbif-' + part + ':' + key, () => this.#json(url, { signal, expect: has.results }));
  }


  /**
   * The plant on each service. One that fails gives null and is named in `unavailable` (absent when none failed):
   * a failure is not « not on this service », and a cache keeps such a result only a few minutes.
   */
  async identifiers(plant, /** @type {RequestOptions} */ { signal } = {}) {
    const unavailable = [];
    const [gbif, inaturalist, wikidata, trefle] = await Promise.all([
      settled(this.gbifTaxon(plant, { signal }), 'gbif', null, unavailable),
      settled(this.inaturalistTaxon(plant, { signal }), 'inaturalist', null, unavailable),
      settled(this.wikidataTaxon(plant, { signal }), 'wikidata', null, unavailable),
      settled(this.trefleTaxon(plant, { signal }), 'trefle', null, unavailable)
    ]);

    return {
      taxref: plant.id,
      gbif,
      inaturalist,
      wikidata,
      trefle,
      ...(unavailable.length ? { unavailable } : {})
    };
  }

  /** A thumbnail from the first service that has one; none found while a service failed: that failure is thrown. */
  async thumbnail(plant, /** @type {RequestOptions} */ { signal } = {}) {
    const unavailable = [];
    const errors = [];
    const [trefle, inaturalist, commons] = await Promise.all([
      // Trefle's image is only used when unverified media are allowed: its failure matters only then.
      settled(this.trefleTaxon(plant, { signal }), 'trefle', null, unavailable, this.allowUnverifiedMedia ? errors : undefined),
      settled(this.inaturalistTaxon(plant, { signal }), 'inaturalist', null, unavailable, errors),
      settled(this.commonsImages(plant, { signal, limit: 3 }), 'commons', [], unavailable, errors)
    ]);
    const found = inaturalist?.thumbnail || commons[0] || (this.allowUnverifiedMedia && trefle?.imageUrl);
    if (!found && errors.length) throw errors[0];

    if (inaturalist?.thumbnail) {
      return {
        url: inaturalist.thumbnail,
        source: 'iNaturalist',
        sourceUrl: 'https://www.inaturalist.org/taxa/' + inaturalist.id,
        license: inaturalist.photo?.license || null,
        attribution: inaturalist.photo?.attribution || null
      };
    }

    const image = commons[0];
    if (image) {
      return {
        url: image.thumbnail || image.url,
        source: 'Wikimedia Commons',
        sourceUrl: image.pageUrl,
        license: image.license,
        licenseUrl: image.licenseUrl,
        attribution: image.author
      };
    }

    if (this.allowUnverifiedMedia && trefle?.imageUrl) {
      return {
        url: trefle.imageUrl,
        source: 'Trefle',
        sourceUrl: 'https://trefle.io/species/' + trefle.slug,
        verifiedLicense: false
      };
    }

    return null;
  }

  /**
   * Monthly observations in France from iNaturalist: all verifiable observations, and those annotated
   * "Plant Phenology = Flowering / Fruiting" (controlled term 12, values 13 / 14). place_id 6753 = France.
   * Counts are indexed January = 0.
   */
  async phenology(plant, /** @type {RequestOptions} */ { signal } = {}) {
    if (!this.enabled('inaturalist')) return null;
    const taxon = await this.inaturalistTaxon(plant, { signal });
    if (!taxon?.id) return null;
    const histogram = async term => {
      const query = params({
        taxon_id: taxon.id,
        place_id: 6753,
        interval: 'month_of_year',
        verifiable: 'true',
        ...(term ? { term_id: 12, term_value_id: term } : {})
      });
      const data = await this.#json('https://api.inaturalist.org/v1/observations/histogram?' + query, { signal, expect: d => Boolean(d.results) && typeof d.results === 'object' });
      const months = data.results?.month_of_year || {};
      return Array.from({ length: 12 }, (_, i) => Number(months[i + 1]) || 0);
    };
    const [all, flowering, fruiting] = await Promise.all([histogram(null), histogram(13), histogram(14)]);
    const query = params({ taxon_id: taxon.id, place_id: 6753, verifiable: 'true' });
    return {
      all,
      flowering,
      fruiting,
      taxonId: taxon.id,
      sourceUrl: 'https://www.inaturalist.org/observations?' + query
    };
  }

  /** Wikidata claims the app reads for a taxon item (one call: claims and the French Wikipedia sitelink). */
  async wikidataClaims(qid, /** @type {RequestOptions} */ { signal } = {}) {
    if (!this.enabled('wikidata')) return null;
    if (!qid) return null;
    return this.#cached('wikidata-claims2:' + qid, async () => {
      const query = params({ action: 'wbgetentities', ids: qid, props: 'claims|sitelinks|aliases', sitefilter: 'frwiki|enwiki', languages: 'fr', format: 'json', origin: '*' });
      const entity = (await this.#json('https://www.wikidata.org/w/api.php?' + query, { signal, expect: has.entities })).entities[qid];
      if (!entity) return null;
      const claim = id => entity.claims?.[id]?.[0]?.mainsnak?.datavalue?.value ?? null;
      return {
        id: qid,
        frwiki: entity.sitelinks?.frwiki?.title || null,
        enwiki: entity.sitelinks?.enwiki?.title || null,
        // Other French names of the item (CC0).
        aliases: (entity.aliases?.fr || []).map(a => a.value).filter(Boolean),
        parent: claim('P171')?.id || null,
        rank: claim('P105')?.id || null,
        iucn: claim('P141')?.id || null,
        tela: claim('P3105'),
        powo: claim('P5037'),
        ipni: claim('P961')
      };
    });
  }

  /** French labels, taxon names, ranks and parents of a batch of Wikidata items. */
  async #wikidataItems(ids, /** @type {RequestOptions} */ { signal } = {}) {
    const list = [...new Set(ids.filter(Boolean))];
    if (!list.length) return {};
    const query = params({ action: 'wbgetentities', ids: list.join('|'), props: 'labels|claims', languages: 'fr|en', format: 'json', origin: '*' });
    const entities = (await this.#json('https://www.wikidata.org/w/api.php?' + query, { signal, expect: has.entities })).entities;
    const out = {};
    for (const [id, entity] of Object.entries(entities)) {
      const claim = p => entity.claims?.[p]?.[0]?.mainsnak?.datavalue?.value ?? null;
      out[id] = {
        id,
        label: entity.labels?.fr?.value || entity.labels?.en?.value || null,
        name: claim('P225'),
        rank: claim('P105')?.id || null,
        parent: claim('P171')?.id || null
      };
    }
    return out;
  }

  /**
   * Classification above the taxon (Wikidata P171 chain), nearest first, up to the order (or 8 levels),
   * plus the IUCN global status label.
   */
  async wikidataScience(qid, /** @type {RequestOptions} */ { signal, levels = 8 } = {}) {
    const claims = await this.wikidataClaims(qid, { signal });
    if (!claims) return null;
    return this.#cached('wikidata-science:' + qid, async () => {
      const ORDER = 'Q36602';
      const first = await this.#wikidataItems([claims.parent, claims.iucn], { signal });
      const iucn = claims.iucn ? { id: claims.iucn, label: first[claims.iucn]?.label || null } : null;
      const chain = [];
      let item = first[claims.parent];
      while (item && chain.length < levels) {
        chain.push(item);
        if (item.rank === ORDER || !item.parent) break;
        item = (await this.#wikidataItems([item.parent], { signal }))[item.parent];
      }
      return { claims, iucn, classification: chain };
    });
  }

  /**
   * The French Wikipedia article, in one call: its short description, its lead and its sections as plain text,
   * each with the theme it speaks of (description, ecology, toxicity…, see wikiTheme) — the references, links
   * and protection status left out (INPN is the reference for that).
   * @returns {Promise<{ title: string, url: string, description: string | null, extract: string, touched: string | null,
   *   sections: { theme: string, title: string, text: string }[] } | null>}
   */
  async wikipediaArticle(title, /** @type {RequestOptions} */ { signal } = {}) {
    if (!this.enabled('wikipedia')) return null;
    if (!title) return null;
    return this.#cached('wikipedia-article:' + title, async () => {
      const query = params({ action: 'query', prop: 'extracts|description|info', explaintext: '1', exsectionformat: 'wiki', redirects: '1',
        titles: title, format: 'json', formatversion: '2', origin: '*' });
      const page = (await this.#json('https://fr.wikipedia.org/w/api.php?' + query, { signal, expect: has.query })).query?.pages?.[0];
      if (!page?.extract) return null;
      const { lead, sections } = wikiSections(page.extract);
      return {
        title: page.title,
        url: 'https://fr.wikipedia.org/wiki/' + encodeURIComponent(page.title.replace(/ /g, '_')),
        description: page.description || null,
        extract: lead,
        touched: page.touched || null,
        sections
      };
    });
  }

  /** Lead paragraph of the French Wikipedia article (REST summary). */
  async wikipediaSummary(title, /** @type {RequestOptions} */ { signal } = {}) {
    if (!this.enabled('wikipedia')) return null;
    if (!title) return null;
    return this.#cached('wikipedia:' + title, async () => {
      const data = await this.#json('https://fr.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title.replace(/ /g, '_')), { signal });
      if (!data?.extract) return null;
      return {
        title: data.title,
        extract: data.extract,
        url: data.content_urls?.desktop?.page || 'https://fr.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_'))
      };
    });
  }

  /**
   * GBIF occurrences in France: the count and, in the same request, their spread by month, year, kind of
   * record, source dataset, region and département. Only presences with coordinates that have no known issue.
   */
  async gbifOccurrenceStats(key, /** @type {RequestOptions} */ { signal } = {}) {
    if (!this.enabled('gbif') || !key) return null;
    return this.#cached('gbif-stats:' + key, async () => {
      const data = await this.#json('https://api.gbif.org/v1/occurrence/search?' + params({
        ...GBIF_FR(key), limit: 0,
        facet: ['month', 'year', 'basisOfRecord', 'datasetKey', 'gadmLevel1Gid', 'gadmLevel2Gid'],
        'month.facetLimit': 12, 'year.facetLimit': 400, 'basisOfRecord.facetLimit': 10,
        'datasetKey.facetLimit': 5, 'gadmLevel1Gid.facetLimit': 50, 'gadmLevel2Gid.facetLimit': 200
      }), { signal, expect: has.count });
      /** @type {Record<string, { name: string, count: number }[]>} */
      const facets = {};
      for (const f of data.facets || []) facets[f.field] = f.counts || [];
      const of = (/** @type {string} */ field) => facets[field] || [];
      return {
        count: typeof data.count === 'number' ? data.count : null,
        months: Array.from({ length: 12 }, (_, i) => of('MONTH').find(c => Number(c.name) === i + 1)?.count || 0),
        years: of('YEAR').map(c => ({ year: Number(c.name), count: c.count })).filter(y => y.year).sort((a, b) => a.year - b.year),
        basis: of('BASIS_OF_RECORD').map(c => ({ basis: c.name, count: c.count })),
        datasets: of('DATASET_KEY').map(c => ({ key: c.name, count: c.count })),
        regions: of('GADM_LEVEL_1_GID').map(c => ({ gid: c.name, count: c.count })),
        departments: of('GADM_LEVEL_2_GID').map(c => ({ gid: c.name, count: c.count }))
      };
    });
  }

  /** Number of GBIF occurrences recorded in France (presences, coordinates without known issue). */
  async gbifOccurrencesFR(key, /** @type {RequestOptions} */ { signal } = {}) {
    return (await this.gbifOccurrenceStats(key, { signal }))?.count ?? null;
  }

  /** Name of a GBIF dataset. */
  async gbifDatasetTitle(datasetKey, /** @type {RequestOptions} */ { signal } = {}) {
    if (!this.enabled('gbif') || !datasetKey) return null;
    return this.#cached('gbif-dataset:' + datasetKey, async () =>
      (await this.#json('https://api.gbif.org/v1/dataset/' + encodeURIComponent(datasetKey), { signal }))?.title ?? null);
  }

  /** Name of a GADM area (region, département) by its id, e.g. FRA.11_1 → Occitanie. */
  async gadmName(gid, /** @type {RequestOptions} */ { signal } = {}) {
    if (!this.enabled('gbif') || !gid) return null;
    return this.#cached('gadm:' + gid, async () =>
      (await this.#json('https://api.gbif.org/v1/geocode/gadm/' + encodeURIComponent(gid), { signal }))?.name ?? null);
  }

  /**
   * Still images of occurrences under a free licence (CC0, CC BY, CC BY-SA), kept apart by kind:
   * 'herbarium' (preserved specimens, from anywhere) or 'photos' (field observations in France).
   */
  async gbifOccurrenceMedia(key, kind, /** @type {RequestOptions} */ { signal, limit = 12 } = {}) {
    if (!this.enabled('gbif') || !key) return [];
    return this.#cached('gbif-media-' + kind + ':' + key, async () => {
      const data = await this.#json('https://api.gbif.org/v1/occurrence/search?' + params({
        taxonKey: key, mediaType: 'StillImage', occurrenceStatus: 'PRESENT',
        basisOfRecord: kind === 'herbarium' ? 'PRESERVED_SPECIMEN' : 'HUMAN_OBSERVATION',
        ...(kind === 'herbarium' ? {} : { country: 'FR' }),
        license: ['CC0_1_0', 'CC_BY_4_0'], limit: 24
      }), { signal, expect: has.results });
      const images = [];
      for (const o of data.results || []) {
        // An image address only (shown as an image, linked as « Ouvrir l’original »): never a javascript: or data: URL.
        const m = (o.media || []).find(x => typeof x.identifier === 'string' && /^https?:\/\//i.test(x.identifier)
          && (!x.type || x.type === 'StillImage') && FREE_MEDIA.test(x.license || o.license || ''));
        if (!m) continue;
        const license = m.license || o.license || '';
        const year = [o.year, String(o.eventDate ?? '').slice(0, 4)].map(Number).find(y => Number.isInteger(y) && y > 0) ?? null;
        images.push({
          url: smallerImage(m.identifier),
          original: m.identifier,
          author: plainText(m.creator || m.rightsHolder || o.recordedBy),
          license: /publicdomain|cc0/i.test(license) ? 'CC0 / domaine public' : /by-sa/i.test(license) ? 'CC BY-SA' : 'CC BY',
          licenseUrl: /^https?:/.test(license) ? license : '',
          source: 'GBIF',
          sourceUrl: 'https://www.gbif.org/occurrence/' + o.key,
          institution: plainText(o.institutionCode, 60),
          catalogNumber: plainText(o.catalogNumber, 60),
          year,
          country: plainText(o.country, 60),
          dataset: plainText(o.datasetName, 200),
          coordinates: typeof o.decimalLatitude === 'number' && typeof o.decimalLongitude === 'number' ? [o.decimalLongitude, o.decimalLatitude] : null,
          locality: plainText(o.locality, 200)
        });
        if (images.length >= limit) break;
      }
      return images;
    });
  }

  /**
   * GBIF occurrences in France around a point (lat, lon), nearest first: at most `limit`, with the total
   * within the radius (metres). Each with its dataset (`datasetKey`: GBIF's copy of iNaturalist's observations
   * told apart, `catalog` its record's number there: the iNaturalist observation it copies) and where it was made
   * (`locality`, else its commune or county: its card on a map says it).
   */
  async gbifNear(key, [lon, lat], radius, /** @type {RequestOptions} */ { signal, limit = 5 } = {}) {
    if (!this.enabled('gbif') || !key) return null;
    const PAGE = 300;
    const search = r => this.#json('https://api.gbif.org/v1/occurrence/search?' + params({
      ...GBIF_FR(key), hasCoordinate: 'true', geoDistance: `${lat.toFixed(4)},${lon.toFixed(4)},${(r / 1000).toFixed(2)}km`, limit: PAGE
    }), { signal, expect: has.results });
    let data = await search(radius);
    const total = typeof data.count === 'number' ? data.count : (data.results || []).length;
    // GBIF does not sort by distance: with more than a page, look in a smaller circle (the nearest ones are
    // in it) until one page holds them all.
    for (let r = radius / 4; (data.count ?? 0) > PAGE && r >= 50; r /= 4) {
      const inner = await search(r);
      if (!(inner.results || []).length) break;
      data = inner;
    }
    const rows = (data.results || [])
      .filter(o => typeof o.decimalLatitude === 'number' && typeof o.decimalLongitude === 'number')
      .map(o => ({
        key: o.key,
        coordinates: [o.decimalLongitude, o.decimalLatitude],
        distance: haversine([lon, lat], [o.decimalLongitude, o.decimalLatitude]),
        date: o.eventDate ? String(o.eventDate).slice(0, 10) : null,
        basis: o.basisOfRecord || null,
        dataset: o.datasetName || '',
        datasetKey: o.datasetKey || null,
        catalog: plainText(o.catalogNumber, 40) || null,
        locality: plainText(o.locality || o.municipality || o.county, 80) || null,
        uncertainty: o.coordinateUncertaintyInMeters ?? null
      }))
      .sort((a, b) => a.distance - b.distance);
    return { total, nearest: rows.slice(0, limit) };
  }

  /**
   * The occurrences matching a filter (a GADM area, a country…): up to 300 of them (presences with clean
   * coordinates), each with its record, date, place and dataset (its key and its record's number there, as
   * gbifNear's), and their extent (south-west and north-east corners [lon, lat]); null when none.
   */
  async gbifOccurrenceBounds(key, filter, /** @type {RequestOptions} */ { signal } = {}) {
    if (!this.enabled('gbif') || !key) return null;
    const data = await this.#json('https://api.gbif.org/v1/occurrence/search?' + params({
      taxonKey: key, occurrenceStatus: 'PRESENT', hasGeospatialIssue: 'false', hasCoordinate: 'true', ...filter, limit: 300
    }), { signal, expect: has.results });
    const rows = (data.results || []).filter(o => typeof o.decimalLatitude === 'number' && typeof o.decimalLongitude === 'number');
    if (!rows.length) return null;
    const lons = rows.map(o => o.decimalLongitude), lats = rows.map(o => o.decimalLatitude);
    return {
      count: data.count ?? rows.length,
      bounds: [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      points: rows.map(o => ({
        coordinates: [o.decimalLongitude, o.decimalLatitude], key: o.key, date: o.eventDate || null,
        locality: plainText(o.locality || o.municipality || o.county, 80) || null, dataset: plainText(o.datasetName, 60) || null,
        datasetKey: o.datasetKey || null, catalog: plainText(o.catalogNumber, 40) || null
      }))
    };
  }

  /** Publications that use GBIF data on this taxon, latest first. */
  async gbifLiterature(key, /** @type {RequestOptions} */ { signal, limit = 5 } = {}) {
    if (!this.enabled('gbif') || !key) return null;
    return this.#cached('gbif-literature:' + key, async () => {
      const data = await this.#json('https://api.gbif.org/v1/literature/search?' + params({ gbifTaxonKey: key, limit }), { signal, expect: has.results });
      return {
        total: data.count ?? 0,
        items: (data.results || []).map(r => ({
          title: r.title || '',
          year: r.year ?? null,
          source: r.source || '',
          authors: (r.authors || []).map(a => a.lastName).filter(Boolean),
          url: r.identifiers?.doi ? 'https://doi.org/' + r.identifiers.doi : r.websites?.[0] || null
        })).filter(r => r.title)
      };
    });
  }

  /**
   * What the sheet needs first: the identifiers, Trefle's sheet, the Commons photos. `unavailable`: the services that
   * failed (absent when none did), their part null or empty — to be asked again, not taken for « nothing known ».
   */
  async details(plant, /** @type {RequestOptions} */ { signal } = {}) {
    const identifiers = await this.identifiers(plant, { signal });
    const unavailable = [...(identifiers.unavailable || [])];

    // GBIF data is fetched apart, part by part, as the sheet shows it (gbifSpecies, gbifOccurrenceStats…).
    const [trefle, commons] = await Promise.all([
      settled(this.trefleDetails(identifiers.trefle, { signal }), 'trefle', null, unavailable),
      settled(this.commonsImages(plant, { signal, limit: 12 }), 'commons', [], unavailable)
    ]);

    return {
      plant,
      identifiers,
      links: this.links(plant),
      trefle,
      commons,
      ...(unavailable.length ? { unavailable: [...new Set(unavailable)] } : {})
    };
  }
}

/**
 * A part of a result gathering several services: its value, or `fallback` when it failed — the service then named in
 * `unavailable` (and the error kept in `errors`). A cancel by the caller is not a failure: it is thrown.
 * @template T @param {Promise<T>} task @param {string} service @param {T} fallback @param {string[]} unavailable @param {unknown[]} [errors]
 * @returns {Promise<T>}
 */
function settled(task, service, fallback, unavailable, errors) {
  return task.catch(error => {
    if (error?.name === 'AbortError') throw error;
    unavailable.push(service);
    errors?.push(error);
    return fallback;
  });
}
