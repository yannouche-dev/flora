// @ts-check
// What a plant's sheet reads of the data loaded for it (sheet-base.js: its blocks' content): its photos (the dataset's
// thumbnail, Commons, iNaturalist), GBIF's descriptions, distribution, French and other names, species profiles and
// synonyms, Trefle's facts; names without their duplicates (dedupNames). Pure, no import: out of the app's start (the
// sheet loads it).

/** Remote text is untrusted HTML: keep only its text content (DOMParser never runs scripts). */
function toText(/** @type {string} */ value) {
  const { body } = new DOMParser().parseFromString(String(value ?? ''), 'text/html');
  body.querySelectorAll('script, style, noscript').forEach(node => node.remove());
  return body.textContent?.replace(/\s+/g, ' ').trim() || '';
}

const truncate = (/** @type {string} */ text, max = 900) =>
  text.length > max ? text.slice(0, max).replace(/\s+\S*$/, '') + '…' : text;

const commonsKey = (/** @type {string | undefined} */ url) => {
  try { return decodeURIComponent(url || '').replace(/_/g, ' ').toLowerCase(); } catch { return url || ''; }
};

/**
 * Builds the gallery: the dataset thumbnail first, then free-licensed Commons images,
 * then the iNaturalist default photo; deduplicated by Commons page.
 */
export function gallery(plant, details) {
  const images = [];
  const seen = new Set();
  const add = (/** @type {any} */ image) => {
    const key = commonsKey(image.sourceUrl || image.pageUrl || image.url);
    if (!image.url || seen.has(key)) return;
    seen.add(key);
    images.push(image);
  };

  if (plant.thumbnail?.url) add(plant.thumbnail);
  for (const image of details?.commons || []) {
    add({ ...image, url: image.thumbnail || image.url, source: 'Wikimedia Commons' });
  }
  const inat = details?.identifiers?.inaturalist;
  if (inat?.photo?.url) {
    add({
      url: inat.photo.url,
      attribution: inat.photo.attribution,
      license: inat.photo.license,
      source: 'iNaturalist',
      sourceUrl: 'https://www.inaturalist.org/taxa/' + inat.id
    });
  }
  return images;
}

/** GBIF descriptions, French first, then English; one per type. @param {any} gbif the sheet's GBIF data */
export function descriptions(gbif) {
  const rows = gbif?.descriptions?.results || [];
  const order = { fra: 0, fre: 0, fr: 0, eng: 1, en: 1 };
  const byType = new Map();
  rows
    .filter(row => row.description && row.language in order)
    .sort((a, b) => order[a.language] - order[b.language])
    .forEach(row => {
      const type = row.type || 'description';
      if (!byType.has(type)) byType.set(type, { ...row, text: truncate(toText(row.description)) });
    });
  return [...byType.values()].filter(row => row.text).slice(0, 4);
}

/** @param {any} gbif */
export function distributions(gbif) {
  const rows = gbif?.distributions?.results || [];
  const seen = new Set();
  return rows
    .map(row => ({
      place: row.locality || row.country || row.locationId,
      means: row.establishmentMeans,
      // An ISO country code (some checklists): the map can show the occurrences there.
      country: /^[A-Z]{2}$/.test(row.country || '') ? row.country : /^ISO3166:[A-Z]{2}$/i.test(row.locationId || '') ? row.locationId.slice(-2).toUpperCase() : null
    }))
    .filter(row => row.place && !seen.has(row.place) && seen.add(row.place))
    .slice(0, 24);
}

/** @param {any} plant @param {any} gbif */
export function gbifFrenchNames(plant, gbif) {
  const known = new Set((plant.vernacularNames || []).map(name => name.toLowerCase()));
  const names = (gbif?.vernacularNames?.results || [])
    .filter(row => /^(fra|fre|fr)$/.test(row.language || ''))
    .map(row => row.vernacularName)
    .filter(name => name && !known.has(name.toLowerCase()) && known.add(name.toLowerCase()));
  return names.slice(0, 12);
}

/**
 * A name's key, for the duplicates written differently: case, accents, hyphens and apostrophes, an article in
 * front (« la », « l’ »), plurals (« Orties »), spaces. @param {string} name
 */
function nameKey(name) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[-‐‑’'`´_.]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(le|la|les|l|the|der|die|das|el|il|lo|los|las)\s+/, '')
    .split(' ').map(w => w.length > 3 ? w.replace(/(s|x)$/, '') : w).join(' ');
}

/** How well a name is written: its accents (the first letter gets its capital anyway). @param {string} name */
const nameCare = name => name.normalize('NFD').length - name.length;

/**
 * Names without their duplicates: lists split (« grande ortie, ortie dioïque »), the same name written
 * differently counted once — its best-written form kept, at the place of its first one; the first letter in
 * capital. `except`: names already shown elsewhere (the title).
 * @param {(string | null | undefined)[]} names @param {(string | null | undefined)[]} [except] @returns {string[]}
 */
export function dedupNames(names, except = []) {
  const skip = new Set(except.filter(Boolean).map(n => nameKey(String(n))));
  /** @type {Map<string, string>} */
  const kept = new Map();
  for (const raw of names) {
    for (const part of String(raw || '').split(/\s*[,;/]\s*|\s+ou\s+/)) {
      const name = part.replace(/\s+/g, ' ').trim();
      if (name.length < 2) continue;
      const key = nameKey(name);
      if (!key || skip.has(key)) continue;
      const had = kept.get(key);
      if (!had || nameCare(name) > nameCare(had)) kept.set(key, name);
    }
  }
  return [...kept.values()].map(n => n.charAt(0).toLocaleUpperCase('fr') + n.slice(1));
}

/** Habitats and life forms of GBIF species profiles that read the same in any checklist, in French. */
/** @type {[RegExp, string][]} */
const HABITATS = [[/terrestr|terr[ií]cola/i, 'terrestre'], [/fresh|dulce|douce|dulcícola/i, 'eau douce'], [/brackish|saumâtre|salobre/i, 'eau saumâtre'], [/marine|marin/i, 'marin']];
/** @type {[RegExp, string][]} */
const LIFE_FORMS = [
  [/^(herb|herbaceous|hierba|erva|herbacée)s?$/i, 'herbacée'], [/^(shrub|arbusto|arbuste)s?$/i, 'arbuste'], [/^(subshrub|subarbusto|sous-arbrisseau)s?$/i, 'sous-arbrisseau'],
  [/^(tree|árbol|arbre|árvore)s?$/i, 'arbre'], [/climb|vine|liana|trepadeira|grimpante/i, 'grimpante'],
  [/geophyt/i, 'géophyte'], [/hemicryptophyt/i, 'hémicryptophyte'], [/chamaephyt/i, 'chaméphyte'], [/therophyt/i, 'thérophyte'], [/phanerophyt/i, 'phanérophyte']
];

/**
 * What GBIF species profiles agree on: habitats and life forms (only values that translate cleanly), and the
 * checklists that flag the plant as invasive somewhere. @param {any} gbif
 */
export function profile(gbif) {
  const rows = gbif?.speciesProfiles?.results || [];
  /** @type {Map<string, number>} */ const habitats = new Map();
  /** @type {Map<string, number>} */ const forms = new Map();
  /** @type {string[]} */ const invasive = [];
  const count = (/** @type {Map<string, number>} */ m, /** @type {string} */ k) => m.set(k, (m.get(k) || 0) + 1);
  for (const r of rows) {
    const found = new Set();
    for (const [re, label] of HABITATS) if (re.test(String(r.habitat || ''))) found.add(label);
    if (r.terrestrial) found.add('terrestre');
    if (r.freshwater) found.add('eau douce');
    if (r.marine) found.add('marin');
    found.forEach(h => count(habitats, h));
    const lifeForm = String(r.lifeForm || '');
    if (lifeForm && !lifeForm.startsWith('{')) for (const part of lifeForm.split(/[,;|/]/)) {
      const label = LIFE_FORMS.find(([re]) => re.test(part.trim()))?.[1];
      if (label) count(forms, label);
    }
    if (r.isInvasive === true && r.source && !invasive.includes(r.source)) invasive.push(r.source);
  }
  const sorted = (/** @type {Map<string, number>} */ m) => [...m].sort((a, b) => b[1] - a[1]);
  return { habitats: sorted(habitats), forms: sorted(forms), invasive, sources: rows.length };
}

/** GBIF synonyms that TAXREF does not list (names compared without authors). @param {any} plant @param {any} gbif */
export function gbifSynonyms(plant, gbif) {
  const known = (plant.synonyms || []).map((/** @type {string} */ n) => n.toLowerCase());
  /** @type {string[]} */ const out = [];
  for (const r of gbif?.synonyms?.results || []) {
    const canonical = r.canonicalName || r.scientificName;
    // Shown with its rank and author (« Urtica dioica subsp. eudioica Selander »), compared without them.
    const name = r.scientificName || canonical;
    if (!canonical || out.includes(name)) continue;
    const lower = canonical.toLowerCase();
    if (lower === String(plant.scientificName).toLowerCase() || known.some((/** @type {string} */ k) => k === lower || k.startsWith(lower + ' '))) continue;
    out.push(name);
  }
  return out.slice(0, 30);
}

/** Vernacular names in other languages (GBIF), grouped by language. @param {any} gbif */
export function otherNames(gbif) {
  const byLang = new Map();
  for (const row of gbif?.vernacularNames?.results || []) {
    const lang = row.language || '';
    if (!row.vernacularName || /^(fra|fre|fr)$/.test(lang)) continue;
    byLang.set(lang, [...byLang.get(lang) || [], row.vernacularName]);
  }
  return [...byLang].map(([lang, list]) => [lang, dedupNames(list).slice(0, 4)]).slice(0, 12);
}

/** Trefle species record (user's own token): its scalar facts, flattened. */
export function trefleFacts(details) {
  const t = details?.trefle;
  if (!t) return [];
  const facts = [];
  const add = (/** @type {string} */ label, /** @type {any} */ value) => {
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return;
    if (typeof value === 'object' && !Array.isArray(value)) {
      if ('cm' in value || 'mm' in value) return add(label, value.cm != null ? value.cm + ' cm' : value.mm != null ? value.mm + ' mm' : null);
      for (const [k, v] of Object.entries(value)) add(label + ' · ' + k.replace(/_/g, ' '), v);
      return;
    }
    facts.push([label, Array.isArray(value) ? value.join(', ') : String(value)]);
  };
  add('common name', t.common_name);
  add('observations', t.observations);
  add('duration', t.duration);
  add('edible', t.edible);
  add('edible part', t.edible_part);
  add('vegetable', t.vegetable);
  for (const key of ['specifications', 'growth', 'flower', 'foliage', 'fruit_or_seed']) add(key.replace(/_/g, ' '), t[key]);
  return facts.slice(0, 60);
}
