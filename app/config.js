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
    // Before sheetLayout (read once, to carry the order and folded blocks over).
    sheetBlocks: 'geoflora.sheetBlocks',
    sheetHidden: 'geoflora.sheetHidden',
    sheetLayout: 'geoflora.sheetLayout',
    plantNotes: 'geoflora.plantNotes',
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
    // The harvest mode as the user set it ('1', '0'; none: « auto », core/store.js). Its key before,
    // geoflora.harvestMode, the app wrote by itself too (obsoleteKeys).
    harvestMode: 'geoflora.harvestModeChoice',
    recentPlants: 'geoflora.recentPlants',
    backup: 'geoflora.backup',
    // « Réparer le stockage » erased the database: the backup copy is held (never rewritten) until it is put back.
    restorePending: 'geoflora.restorePending',
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
    mediaLayout: 'geoflora.mediaLayout',
    // « Disposition libre » (app/layout): the shares given to the columns and rows of each layout, by its shape.
    freeLayout: 'geoflora.freeLayout',
    // The first-use hints of the maps already shown on this device (core/hints.js): never shown again.
    hints: 'geoflora.hints',
    // The first steps (core/discover.js): the tabs unlocked, the step reached.
    discover: 'geoflora.discover',
    // The radius chosen last on the Carte's « Autour » (core/nearby.js), metres.
    aroundRadius: 'geoflora.aroundRadius',
    // The Carte's « Mes lieux » (« Sur cette carte » of its panel ▦): false when hidden; none, shown.
    mapPlaces: 'geoflora.mapPlaces',
    // The media viewer in the sheet: the image's height as a proportion of its width (its grip).
    mediaRatio: 'geoflora.mediaRatio',
    // When the sources' cache was last purged (core/cache.js), ms.
    cachePurgedAt: 'geoflora.cachePurgedAt',
    // The Parcours botanique (miniapp/kit/trail-store.js): the walk under way, the one ended.
    trail: 'geoflora.trail',
    // Obsolete: the walks to take up again, read from Mes plantes since 2.8 — read once at start (main.js), forgotten once
    // they are marked (collections.js#markWalks); gone with 3.2.
    trails: 'geoflora.trails',
    trailDone: 'geoflora.trailDone',
    // Between tabs, where BroadcastChannel is missing (core/sync.js).
    sync: 'geoflora.sync'
  },

  /** Every key above starts so (core/prefs.js#storedKeys: the app's own, among a shared origin's). */
  storagePrefix: 'geoflora.',

  /**
   * Keys of settings the app no longer has, removed at start (core/prefs.js#forgetObsolete): the plant sheet's own
   * mode (it follows the app's), the one-tap target of the Épuré sheet (never read), the harvest mode as the app
   * once wrote it by itself — at the first launch, or as Cueillette prudente began — never told from the user's own
   * choice: « auto » again (storageKeys.harvestMode), King (« Personnaliser la fiche ») kept until left: it
   * now lasts for the visit (core/store.js KingState).
   */
  obsoleteKeys: ['geoflora.plantView', 'geoflora.target', 'geoflora.harvestMode', 'geoflora.kingMode'],

  /**
   * The keys of the panes' widths (core/panes.js), one per screen: the first steps (core/discover.js) never read
   * them as « used before » — a new visitor who drags a separator keeps them. A new layout's key goes here too.
   * (A mini-app's layouts are under its own prefix, storageKeys.appPrefix.)
   */
  paneLayouts: ['geoflora.discoverLayout', 'geoflora.trailLayout', 'geoflora.floraLayout', 'geoflora.collectionsLayout',
    'geoflora.mapLayout', 'geoflora.placeLayout', 'geoflora.mediaLayout', 'geoflora.freeLayout'],

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
  // A free layout's zone only (its plants' observations counted: workers/search-core.js `observed`).
  { value: 'obs', label: 'Plus observées' },
  { value: 'fr', label: 'Nom français A–Z' },
  { value: 'sci', label: 'Nom scientifique A–Z' },
  { value: 'family', label: 'Famille' },
  { value: 'photo', label: 'Avec photo d’abord' }
];
