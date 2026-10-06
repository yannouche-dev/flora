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
    trefleToken: 'geoflora.trefleToken'
  }
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
