// @ts-check

/** Base URL of the app, resolved from this module so it works under any Pages sub-path. */
const ROOT = new URL('../', import.meta.url);

export const config = {
  dataUrl: new URL('data/plants.json', ROOT).href,
  metaUrl: new URL('data/meta.json', ROOT).href,

  db: {
    name: 'geoflora',
    version: 1
  },

  /** How long remote enrichment (GBIF, iNaturalist, Commons…) stays cached in IndexedDB. */
  remoteTtl: 7 * 24 * 3600 * 1000,

  /** Delay before a visible card without thumbnail asks remote sources for one. */
  thumbnailDelay: 400,

  searchDebounce: 120,

  storageKeys: {
    trefleToken: 'geoflora.trefleToken',
    recentSearches: 'geoflora.recentSearches',
    compact: 'geoflora.compact'
  },

  /** Desktop layout (filter sidebar) from this width; below, filters open in a bottom sheet. */
  wideQuery: '(min-width: 900px)'
};

/** TAXREF biogeographic status codes for France métropolitaine. */
export const STATUS_LABELS = {
  P: 'Présent (indigène ou indéterminé)',
  E: 'Endémique',
  S: 'Subendémique',
  C: 'Cryptogène',
  N: 'Naturalisé',
  I: 'Introduit',
  J: 'Introduit envahissant'
};

/** Short labels for the status facet; STATUS_LABELS gives the full meaning as a tooltip. */
export const STATUS_SHORT = {
  P: 'Indigène',
  E: 'Endémique',
  S: 'Subendémique',
  C: 'Cryptogène',
  N: 'Naturalisé',
  I: 'Introduit',
  J: 'Envahissant'
};

export const SORTS = [
  { value: 'relevance', label: 'Pertinence' },
  { value: 'fr', label: 'Nom français A–Z' },
  { value: 'sci', label: 'Nom scientifique A–Z' },
  { value: 'family', label: 'Famille' },
  { value: 'photo', label: 'Avec photo d’abord' }
];
