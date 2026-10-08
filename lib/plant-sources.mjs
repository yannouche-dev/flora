const FREE_LICENSES = [
  /^cc0\b/i,
  /^public domain\b/i,
  /^pd\b/i,
  /^cc by\b/i,
  /^cc-by\b/i,
  /^cc by-sa\b/i,
  /^cc-by-sa\b/i
];

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

async function json(url, { signal } = {}) {
  const response = await fetch(url, {
    signal,
    headers: { accept: 'application/json' }
  });

  if (!response.ok) {
    throw new Error(response.status + ' ' + response.statusText + ': ' + url);
  }

  return response.json();
}

function params(values) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  return search;
}

function freeLicense(name) {
  const value = stripHtml(name);
  return FREE_LICENSES.some(pattern => pattern.test(value));
}

function commonsMeta(info = {}) {
  const metadata = info.extmetadata || {};
  const license = stripHtml(metadata.LicenseShortName?.value);
  return {
    url: info.url || null,
    thumbnail: info.thumburl || info.url || null,
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

  constructor({ trefleToken = null, cacheTtl = 86400000, allowUnverifiedMedia = false } = {}) {
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

  async #cached(key, loader) {
    const cached = this.#cache.get(key);
    if (cached && Date.now() - cached.at < this.cacheTtl) return cached.value;

    const value = await loader();
    this.#cache.set(key, { at: Date.now(), value });
    return value;
  }

  async gbifTaxon(plant, { signal } = {}) {
    return this.#cached('gbif:' + plant.scientificName, async () => {
      const query = params({
        q: plant.scientificName,
        rank: 'SPECIES',
        highertaxon_key: undefined,
        limit: 20
      });
      const data = await json('https://api.gbif.org/v1/species/search?' + query, { signal });
      const rows = data.results || [];
      const hit = rows.find(row =>
        exact(row.canonicalName, plant.scientificName) &&
        (!row.kingdom || row.kingdom === 'Plantae')
      ) || rows.find(row => exact(row.canonicalName, plant.scientificName));

      if (!hit) return null;

      return {
        id: hit.key ?? hit.nubKey ?? null,
        key: hit.key ?? null,
        nubKey: hit.nubKey ?? null,
        scientificName: hit.scientificName ?? hit.canonicalName ?? plant.scientificName,
        canonicalName: hit.canonicalName ?? plant.scientificName,
        status: hit.taxonomicStatus ?? hit.status ?? null,
        rank: hit.rank ?? null
      };
    });
  }

  async inaturalistTaxon(plant, { signal } = {}) {
    return this.#cached('inat:' + plant.scientificName, async () => {
      const query = params({
        q: plant.scientificName,
        rank: 'species',
        is_active: 'true',
        per_page: 20
      });
      const data = await json('https://api.inaturalist.org/v1/taxa?' + query, { signal });
      const rows = data.results || [];
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

  async wikidataTaxon(plant, { signal } = {}) {
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
      const found = await json('https://www.wikidata.org/w/api.php?' + search, { signal });
      const ids = (found.search || []).map(item => item.id).filter(Boolean);
      if (!ids.length) return null;

      const entityQuery = params({
        action: 'wbgetentities',
        ids: ids.join('|'),
        props: 'claims|labels',
        languages: 'en|fr',
        format: 'json',
        origin: '*'
      });
      const entities = await json('https://www.wikidata.org/w/api.php?' + entityQuery, { signal });

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

  async trefleTaxon(plant, { signal } = {}) {
    if (!this.trefleToken) return null;

    return this.#cached('trefle:' + plant.scientificName, async () => {
      const query = params({
        token: this.trefleToken,
        q: plant.scientificName,
        limit: 20
      });
      const data = await json('https://trefle.io/api/v1/species/search?' + query, { signal });
      const rows = data.data || [];
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

  async trefleDetails(trefle, { signal } = {}) {
    if (!this.trefleToken || !trefle?.id) return null;

    return this.#cached('trefle-details:' + trefle.id, async () => {
      const query = params({ token: this.trefleToken });
      const data = await json('https://trefle.io/api/v1/species/' + trefle.id + '?' + query, { signal });
      return data.data || null;
    });
  }

  async commonsImages(plant, { signal, limit = 8 } = {}) {
    const key = 'commons:' + plant.scientificName + ':' + limit;
    return this.#cached(key, async () => {
      const query = params({
        action: 'query',
        generator: 'search',
        gsrsearch: '"' + plant.scientificName + '"',
        gsrnamespace: 6,
        gsrlimit: limit,
        prop: 'imageinfo',
        iiprop: 'url|extmetadata',
        iiurlwidth: 900,
        iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|Credit|ImageDescription',
        format: 'json',
        origin: '*'
      });
      const data = await json('https://commons.wikimedia.org/w/api.php?' + query, { signal });

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

  async gbifDetails(gbif, { signal } = {}) {
    if (!gbif?.id) return null;
    const key = gbif.id;

    return this.#cached('gbif-details:' + key, async () => {
      const base = 'https://api.gbif.org/v1/species/' + key;
      const [media, distributions, descriptions, vernacularNames] = await Promise.allSettled([
        json(base + '/media', { signal }),
        json(base + '/distributions', { signal }),
        json(base + '/descriptions', { signal }),
        json(base + '/vernacularNames', { signal })
      ]);

      const value = result => result.status === 'fulfilled' ? result.value : null;
      return {
        media: value(media),
        distributions: value(distributions),
        descriptions: value(descriptions),
        vernacularNames: value(vernacularNames)
      };
    });
  }

  async identifiers(plant, { signal } = {}) {
    const tasks = [
      this.gbifTaxon(plant, { signal }),
      this.inaturalistTaxon(plant, { signal }),
      this.wikidataTaxon(plant, { signal }),
      this.trefleTaxon(plant, { signal })
    ];

    const [gbif, inaturalist, wikidata, trefle] = await Promise.all(
      tasks.map(task => task.catch(() => null))
    );

    return {
      taxref: plant.id,
      gbif,
      inaturalist,
      wikidata,
      trefle
    };
  }

  async thumbnail(plant, { signal } = {}) {
    const [trefle, inaturalist, commons] = await Promise.all([
      this.trefleTaxon(plant, { signal }).catch(() => null),
      this.inaturalistTaxon(plant, { signal }).catch(() => null),
      this.commonsImages(plant, { signal, limit: 3 }).catch(() => [])
    ]);

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
  async phenology(plant, { signal } = {}) {
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
      const data = await json('https://api.inaturalist.org/v1/observations/histogram?' + query, { signal });
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
  async wikidataClaims(qid, { signal } = {}) {
    if (!qid) return null;
    return this.#cached('wikidata-claims:' + qid, async () => {
      const query = params({ action: 'wbgetentities', ids: qid, props: 'claims|sitelinks', sitefilter: 'frwiki', format: 'json', origin: '*' });
      const entity = (await json('https://www.wikidata.org/w/api.php?' + query, { signal })).entities?.[qid];
      if (!entity) return null;
      const claim = id => entity.claims?.[id]?.[0]?.mainsnak?.datavalue?.value ?? null;
      return {
        id: qid,
        frwiki: entity.sitelinks?.frwiki?.title || null,
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
  async #wikidataItems(ids, { signal } = {}) {
    const list = [...new Set(ids.filter(Boolean))];
    if (!list.length) return {};
    const query = params({ action: 'wbgetentities', ids: list.join('|'), props: 'labels|claims', languages: 'fr|en', format: 'json', origin: '*' });
    const entities = (await json('https://www.wikidata.org/w/api.php?' + query, { signal })).entities || {};
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
  async wikidataScience(qid, { signal, levels = 8 } = {}) {
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

  /** Lead paragraph of the French Wikipedia article (REST summary). */
  async wikipediaSummary(title, { signal } = {}) {
    if (!title) return null;
    return this.#cached('wikipedia:' + title, async () => {
      const data = await json('https://fr.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title.replace(/ /g, '_')), { signal });
      if (!data?.extract) return null;
      return {
        title: data.title,
        extract: data.extract,
        url: data.content_urls?.desktop?.page || 'https://fr.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_'))
      };
    });
  }

  /** Number of GBIF occurrences recorded in France for a GBIF taxon key. */
  async gbifOccurrencesFR(key, { signal } = {}) {
    if (!key) return null;
    return this.#cached('gbif-fr:' + key, async () => {
      const data = await json('https://api.gbif.org/v1/occurrence/search?' + params({ taxonKey: key, country: 'FR', limit: 0 }), { signal });
      return typeof data.count === 'number' ? data.count : null;
    });
  }

  async details(plant, { signal } = {}) {
    const identifiers = await this.identifiers(plant, { signal });

    const [trefle, gbif, commons] = await Promise.all([
      this.trefleDetails(identifiers.trefle, { signal }).catch(() => null),
      this.gbifDetails(identifiers.gbif, { signal }).catch(() => null),
      this.commonsImages(plant, { signal, limit: 12 }).catch(() => [])
    ]);

    return {
      plant,
      identifiers,
      links: this.links(plant),
      trefle,
      gbif,
      commons
    };
  }
}
