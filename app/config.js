// @ts-check

/** Base URL of the app, resolved from this module so it works under any Pages sub-path. */
const ROOT = new URL('../', import.meta.url);

export const config = {
  dataUrl: new URL('data/plants.json', ROOT).href,
  metaUrl: new URL('data/meta.json', ROOT).href,

  db: {
    name: 'geoflora',
    version: 6
  },

  /** How long remote enrichment (GBIF, iNaturalist, Commons…) stays cached in IndexedDB. */
  remoteTtl: 7 * 24 * 3600 * 1000,

  /** Delay before a visible card without thumbnail asks remote sources for one. */
  thumbnailDelay: 400,

  searchDebounce: 120,

  storageKeys: {
    trefleToken: 'geoflora.trefleToken',
    recentSearches: 'geoflora.recentSearches',
    compact: 'geoflora.compact',
    mode: 'geoflora.mode',
    gridView: 'geoflora.gridView',
    plantView: 'geoflora.plantView',
    // Before sheetLayout (read once, to carry the order and folded blocks over).
    sheetBlocks: 'geoflora.sheetBlocks',
    sheetHidden: 'geoflora.sheetHidden',
    sheetLayout: 'geoflora.sheetLayout',
    plantNotes: 'geoflora.plantNotes',
    kingMode: 'geoflora.kingMode',
    target: 'geoflora.target',
    mapLayer: 'geoflora.mapLayer',
    /** The layers of IGN's whole catalogue added to the maps (their definitions, so they show at once, offline too). */
    ignLayers: 'geoflora.ignLayers',
    /** The opacity chosen for each overlay of the maps (key → 0…1; core/ign.js). */
    overlayOpacity: 'geoflora.overlayOpacity',
    mapView: 'geoflora.mapView',
    /** Réglages › Cartes: 2D or 3D, and the 3D options (core/map-settings.js). */
    maps3d: 'geoflora.maps3d',
    /** The observations around a centre on the maps in 3D, per map: shown, radius, sources, density (core/around3d.js). */
    around3d: 'geoflora.around3d',
    discoverLayout: 'geoflora.discoverLayout',
    trailLayout: 'geoflora.trailLayout',
    // Mini-apps (app/miniapp): « Afficher les étapes » (auto, on, off); each one's state and layout under the prefix.
    showSteps: 'geoflora.showSteps',
    appPrefix: 'geoflora.app.',
    lastExport: 'geoflora.lastExport',
    hasSpots: 'geoflora.hasSpots',
    harvestMode: 'geoflora.harvestMode',
    recentPlants: 'geoflora.recentPlants',
    backup: 'geoflora.backup',
    backupReminder: 'geoflora.backupReminder',
    region: 'geoflora.region',
    floraLayout: 'geoflora.floraLayout',
    collectionsLayout: 'geoflora.collectionsLayout',
    mapLayout: 'geoflora.mapLayout',
    // A new place on its own (gf-spot-editor, wide): the width of its form beside the map.
    placeLayout: 'geoflora.placeLayout',
    // Mes plantes: the collections unfolded to show their plants.
    collectionsOpen: 'geoflora.collectionsOpen',
    // Where the user is in each part (search, plant, collection, Carte): kept across tabs and reloads.
    context: 'geoflora.context',
    modules: 'geoflora.modules',
    // Display modes made from the app's three (Réglages › Modes d'affichage).
    modes: 'geoflora.modes',
    // Storing the flora failed for lack of room: the free space then (bytes), so it is not downloaded again in vain.
    datasetQuota: 'geoflora.datasetQuota',
    // The media viewer, wide: the width of « À propos de l’image » beside the image.
    mediaLayout: 'geoflora.mediaLayout'
  },

  /**
   * The keys of the panes' widths (core/panes.js), one per screen: the first steps (core/discover.js) never read
   * them as « used before » — a new visitor who drags a separator keeps them. A new layout's key goes here too.
   * (A mini-app's layouts are under its own prefix, storageKeys.appPrefix.)
   */
  paneLayouts: ['geoflora.discoverLayout', 'geoflora.trailLayout', 'geoflora.floraLayout', 'geoflora.collectionsLayout',
    'geoflora.mapLayout', 'geoflora.placeLayout', 'geoflora.mediaLayout'],

  /** GPS fixes at or under this accuracy (metres) are considered good enough to save. */
  goodAccuracy: 15,

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
