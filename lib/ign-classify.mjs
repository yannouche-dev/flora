// @ts-check
// IGN's ~700 WMTS layers sorted for people: a French taxonomy (categories, then sub-categories), the series of one
// layer by year, period, édition, département or town grouped as one entry with a selector, a « pertinent pour la
// botanique » rank, readable titles for the cryptic ones (« Patrinat_ZNIEFF1 »…), and where each comes from. Pure, no
// DOM, no dependency: the deploy runs it once (scripts/build-ign-catalog.mjs writes its result in data/ign-catalog.json),
// the app again on any copy it did not get classified (an older file, a copy read from the service on the device:
// lib/ign-catalog.mjs) — the same function, the same result.
//
// The service's metadata is uneven: identifiers follow INSPIRE themes (ORTHOIMAGERY.*, ELEVATION.*, LANDCOVER.*…) or a
// producer's prefix (Patrinat_*, ADEME_*, INSEE.*, OCSGE.*…), titles carry years and éditions, a few layers have
// <ows:Keywords>. So: ordered rules on the identifier and the title first (the reliable part), then on the keywords
// and description; whatever matches nothing is « Autres », never dropped.

/** Bumped when the rules change: a catalogue file classified with another version is classified again on reading. */
export const TAXONOMY_VERSION = 1;

/**
 * The taxonomy, in display order. Each category ends with an « autres » sub-category: a layer the rules put in the
 * category without a finer place.
 * @type {{ id: string, label: string, subs: { id: string, label: string }[] }[]}
 */
export const CATEGORIES = [
  { id: 'photos', label: 'Photos aériennes et satellite', subs: [
    { id: 'actuelles', label: 'Actuelles' },
    { id: 'millesimes', label: 'Par année' },
    { id: 'infrarouge', label: 'Infrarouge (fausses couleurs)' },
    { id: 'historiques', label: 'Historiques' },
    { id: 'departements', label: 'Par département' },
    { id: 'satellite', label: 'Images satellite' },
    { id: 'locales', label: 'Prises de vue locales' },
    { id: 'autres', label: 'Autres photos' }] },
  { id: 'cartes', label: 'Cartes', subs: [
    { id: 'plans', label: 'Plans' },
    { id: 'topo', label: 'Cartes topographiques et générales' },
    { id: 'historiques', label: 'Cartes anciennes' },
    { id: 'grande-guerre', label: 'Grande Guerre (1914-1918)' },
    { id: 'autres', label: 'Autres cartes' }] },
  { id: 'relief', label: 'Relief et altitude', subs: [
    { id: 'ombrages', label: 'Ombrages et modèles de relief' },
    { id: 'altitudes', label: 'Altitudes et courbes de niveau' },
    { id: 'pentes', label: 'Pentes' },
    { id: 'autres', label: 'Autres' }] },
  { id: 'vegetation', label: 'Forêts et végétation', subs: [
    { id: 'forets', label: 'Forêts' },
    { id: 'haies', label: 'Haies et bocage' },
    { id: 'vegetation', label: 'Végétation et habitats' },
    { id: 'autres', label: 'Autres' }] },
  { id: 'nature', label: 'Nature et espaces protégés', subs: [
    { id: 'protections', label: 'Protections réglementaires' },
    { id: 'natura2000', label: 'Natura 2000' },
    { id: 'inventaires', label: 'Inventaires (ZNIEFF, géologie)' },
    { id: 'gestion', label: 'Parcs, conservatoires et labels' },
    { id: 'autres', label: 'Autres' }] },
  { id: 'sols', label: 'Sols et géologie', subs: [
    { id: 'sols', label: 'Sols' },
    { id: 'geologie', label: 'Géologie' },
    { id: 'autres', label: 'Autres' }] },
  { id: 'occupation', label: 'Occupation du sol', subs: [
    { id: 'corine', label: 'CORINE Land Cover' },
    { id: 'ocsge', label: 'OCS GE et CoSIA' },
    { id: 'autres', label: 'Autres' }] },
  { id: 'eau', label: 'Eau et littoral', subs: [
    { id: 'cours', label: 'Cours d’eau et plans d’eau' },
    { id: 'humides', label: 'Zones humides' },
    { id: 'masses', label: 'Masses d’eau' },
    { id: 'littoral', label: 'Littoral' },
    { id: 'autres', label: 'Autres' }] },
  { id: 'agriculture', label: 'Agriculture', subs: [
    { id: 'rpg', label: 'Parcelles agricoles (RPG)' },
    { id: 'pac', label: 'Règles de la PAC' },
    { id: 'appellations', label: 'Appellations' },
    { id: 'autres', label: 'Autres' }] },
  { id: 'limites', label: 'Limites administratives et cadastre', subs: [
    { id: 'admin', label: 'Limites administratives' },
    { id: 'cadastre', label: 'Cadastre' },
    { id: 'zonages', label: 'Zonages et urbanisme' },
    { id: 'grilles', label: 'Carroyages' },
    { id: 'autres', label: 'Autres' }] },
  { id: 'societe', label: 'Population, bâti et services', subs: [
    { id: 'insee', label: 'Statistiques de l’INSEE' },
    { id: 'bati', label: 'Bâtiments et zones d’activités' },
    { id: 'services', label: 'Services et lieux publics' },
    { id: 'autres', label: 'Autres' }] },
  { id: 'transports', label: 'Transports', subs: [
    { id: 'routes', label: 'Routes' },
    { id: 'rail', label: 'Voies ferrées' },
    { id: 'aerien', label: 'Aérien et drones' },
    { id: 'convois', label: 'Transports exceptionnels' },
    { id: 'randonnee', label: 'Randonnée' },
    { id: 'autres', label: 'Autres' }] },
  { id: 'energie', label: 'Énergie', subs: [
    { id: 'solaire', label: 'Solaire' },
    { id: 'eolien', label: 'Éolien' },
    { id: 'hydro', label: 'Hydroélectricité' },
    { id: 'chaleur', label: 'Chaleur et froid' },
    { id: 'gaz', label: 'Gaz, biogaz et méthanisation' },
    { id: 'reseaux', label: 'Réseaux et consommation' },
    { id: 'contraintes', label: 'Contraintes et zones d’accélération' },
    { id: 'autres', label: 'Autres' }] },
  { id: 'risques', label: 'Risques', subs: [
    { id: 'inondations', label: 'Inondations' },
    { id: 'seismes', label: 'Séismes' },
    { id: 'incendies', label: 'Incendies' },
    { id: 'tempetes', label: 'Tempêtes' },
    { id: 'autres', label: 'Autres' }] },
  { id: 'autres', label: 'Autres', subs: [
    { id: 'divers', label: 'Divers' },
    { id: 'essais', label: 'Essais et couches techniques' },
    { id: 'autres', label: 'Autres' }] }
];

const CAT_IDS = new Set(CATEGORIES.map(c => c.id));
const SUB_IDS = new Map(CATEGORIES.map(c => [c.id, new Set(c.subs.map(s => s.id))]));

/** Whether a category and a sub-category exist (a classification read from a file is checked with it). @param {any} cat @param {any} sub */
export const knownPlace = (cat, sub) => typeof cat === 'string' && CAT_IDS.has(cat) && typeof sub === 'string' && Boolean(SUB_IDS.get(cat)?.has(sub));

/** A category's label, and a sub-category's. @param {string} cat @param {string} [sub] */
export function placeLabel(cat, sub) {
  const c = CATEGORIES.find(x => x.id === cat);
  if (!c) return '';
  const s = sub ? c.subs.find(x => x.id === sub) : null;
  return s ? `${c.label} › ${s.label}` : c.label;
}

/** Text folded for search and matching: no accents, lower case, one space. @param {string} s */
export const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, '\'').replace(/\s+/g, ' ').trim();

// ── Rules ────────────────────────────────────────────────────────────────────

/**
 * Ordered: the first that matches wins. Tested on « IDENTIFIER title » (the title folded: no accents, lower case), the
 * identifier upper case is matched case-insensitively too, so a rule names either.
 * @type {[RegExp, string, string][]}
 */
const RULES = [
  // Tests, a training session, a QGIS plug-in's flux, copies under a technical name: kept, out of the way.
  [/(^|[\s_.-])tests?([\s_.-]|$)|^zzz_|formation - live|route500logoplugin|_raster_wmts|^licence_sv/i, 'autres', 'essais'],
  [/^WMTS_|ortho - wmts/i, 'photos', 'locales'],
  [/LGV_?(EDUGEO_)?ARCHEOLOGIE|archeolog/i, 'autres', 'divers'],
  [/LGV_?(EDUGEO_)?(FAUNE|FLORE)/i, 'vegetation', 'vegetation'],
  [/LGV_?(EDUGEO_)?TECHNIQUE/i, 'transports', 'rail'],
  [/ORTHOPHOS\.RESTRICTEDAREAS|captation aerienne/i, 'limites', 'zonages'],

  // Risks before the themes they borrow words from (forest fires, floods).
  [/DEBROUSSAILLEMENT/i, 'risques', 'incendies'],
  [/FLOODEDWATERSHEDS|LSEP-CRUE|\bcrues?\b|\bphec\b|inondation/i, 'risques', 'inondations'],
  [/SISMICITE|seism/i, 'risques', 'seismes'],
  [/KLAUS|tempete/i, 'risques', 'tempetes'],
  [/NATURALRISK|risques? naturel/i, 'risques', 'autres'],

  [/GRANDS\.SITES/i, 'nature', 'gestion'],
  [/PRAIRIES\.SENSIBLES/i, 'agriculture', 'pac'],

  // Energy (before water, relief and the cadastre: « hydroélectrique », « pentes », « cadastres solaires »).
  [/^ENR\.PERIMETRE|^ENR\.AERO|^OFB|ZAER|zones d.acceleration/i, 'energie', 'contraintes'],
  [/CHALEUR|FROID|^ENREZO|GEOTHERMIE/i, 'energie', 'chaleur'],
  [/EOLIEN/i, 'energie', 'eolien'],
  [/SOLAIRE|PHOTOVOLTA|\.PV\b|_PV\b|PV\.SOL|IRRADIATION|PARKING/i, 'energie', 'solaire'],
  [/(POTENTIEL|INSTALLATION|CONCESSIONS)\.HYDRO|hydroelectri/i, 'energie', 'hydro'],
  [/^GAZ\.|BIOMETHANE|METHANIS|BIOGAZ|CONSO\.GAZ/i, 'energie', 'gaz'],
  [/^CONSO\.|CAPACITE\.ACCUEIL|UTILITYANDGOVERNMENTALSERVICES|^PART\.ENR|reseau electrique/i, 'energie', 'reseaux'],
  [/^ENR\.|^POTENTIEL\.|^PRODUCTIBLE\.|^PUISSANCE\.|^PROD\.INSTALLATION/i, 'energie', 'autres'],

  // Photos.
  [/\bIRC\b|infrarouge/i, 'photos', 'infrarouge'],
  [/ORTHOPHOTOS-MIXTE/i, 'photos', 'actuelles'],
  [/ORTHO-?SAT|\bSPOT|PLEIADES|RAPIDEYE|satellite/i, 'photos', 'satellite'],
  [/GENEVE|URGENCE|ILESDUNORD|PRE\.IRMA|ORTHOPHOTOS\.NCL|BEZIERS|Bacquelot/i, 'photos', 'locales'],
  [/^orthophoto_\d{4}_|ORTHOPHOTOS\.D\d{2,3}\b|ORTHOPHOTOS\.(BDORTHO\.)?(0\d|[1-8]\d|9[0-5]|2A|2B|97\d)$/i, 'photos', 'departements'],
  [/^ORTHOIMAGERY\.EDUGEO\.|^ORTHO-EDUGEO|^PVA_|ORTHOPHOTOS\.(19\d\d|COAST2000)|photo\S*\s.*historique/i, 'photos', 'historiques'],
  [/^ORTHOIMAGERY\.ORTHOPHOTOS\d{4}/i, 'photos', 'millesimes'],
  [/ORTHOIMAGERY|ORTHOPHOTO|BDORTHO|^ortho|photographies? aerienne/i, 'photos', 'actuelles'],

  // Relief (before maps: GEOGRAPHICALGRIDSYSTEMS.SLOPES.* are slope maps; Litto3D is ELEVATION.SLOPES.HIGHRES).
  [/ELEVATION\.LEVEL0|trait de cote/i, 'eau', 'littoral'],
  [/SLOPES\.(MOUNTAIN|PAC)|THRESHOLD|\bpentes?\b/i, 'relief', 'pentes'],
  [/SHADOW|estompage|LIDAR-HD|RELIEF_MNS|\bMN[STH]\b|relief/i, 'relief', 'ombrages'],
  [/CONTOUR|ELEVATION\.SLOPES|QUALITY|courbes de niveau|altitude/i, 'relief', 'altitudes'],
  [/^ELEVATION/i, 'relief', 'autres'],

  // Land cover (before soils: « taux d'imperméabilisation des sols »); its tree cover layers with the forests.
  [/\.HR\.(TCD|DLT)\./i, 'vegetation', 'forets'],
  [/CORINE|LANDCOVER\.(GRID\.|HR\.)?(CLC|CHA)\d/i, 'occupation', 'corine'],
  [/OCSGE|OCS GE|COSIA/i, 'occupation', 'ocsge'],

  // Soils and geology.
  [/CARTE\.SOLS|\bsols?\b(?! grande echelle)|pedolog/i, 'sols', 'sols'],
  [/GEOLOG|BRGM/i, 'sols', 'geologie'],

  // Protected areas (INPN / PatriNat, the Conservatoire du littoral, Grands sites de France).
  [/Patrinat_(SIC|ZPS)\b|natura ?2000/i, 'nature', 'natura2000'],
  [/Patrinat_(ZNIEFF|INPG)|ZNIEFF/i, 'nature', 'inventaires'],
  [/Patrinat_(PNR|PNM|CEN|CDL|RAMSAR|BIOS|BPM|GEOPARC)\b|CONSERVATOIRE_LITTORAL|GRANDS\.SITES/i, 'nature', 'gestion'],
  [/Patrinat_|PROTECTEDAREAS(?!\.PRSF)|espaces? protege|reserve naturelle/i, 'nature', 'protections'],

  // Forests and vegetation.
  [/HAIE|HEDGE|BOCAG/i, 'vegetation', 'haies'],
  [/FORET|FOREST|SYLVO|BOISEMENT|PRSF|couvert arbore/i, 'vegetation', 'forets'],
  [/VEGETATION|VEGETALES|Carhab|habitat|NATURE-EN-VILLE|PARCS-ET-JARDINS|vegetal/i, 'vegetation', 'vegetation'],

  // Water.
  [/ZONES-HUMIDES|TOURBIERE|zones? humides?/i, 'eau', 'humides'],
  [/MASSE-EAU|masses? d.eau/i, 'eau', 'masses'],
  [/HYDROGRAPHY|HYDROGRAPHIE|^INPE\b|cours d.eau|plans? d.eau/i, 'eau', 'cours'],

  // Land cover, the rest.
  [/^LANDCOVER/i, 'occupation', 'autres'],

  // Agriculture.
  [/PRAIRIES\.SENSIBLES|ELIGIBLES-IAE|DENSITE-HOMOGENE|BCAE/i, 'agriculture', 'pac'],
  [/LANDUSE\.AGRICULTURE|RPG|parcellaire graphique|PRAIRIES/i, 'agriculture', 'rpg'],
  [/Aire-Parcellaire|appellation|\bAOC\b|\bAOP\b/i, 'agriculture', 'appellations'],
  [/^LANDUSE|agricol/i, 'agriculture', 'autres'],

  // Administrative limits, the cadastre, zonings.
  [/ADMIN-?EXPRESS|LIMITES_ADMINISTRATIVES|limites? administrative/i, 'limites', 'admin'],
  [/CADASTRAL|cadastr|parcellaire express/i, 'limites', 'cadastre'],
  [/DFCI|carroyage/i, 'limites', 'grilles'],
  [/AREAMANAGEMENT|PRIORITYDISCTRICT|_QP_|ZONAGE_PINEL|PLANIFICATION|\bSCOT\b|quartiers prioritaires|zones? urbaines? sensibles?|zones? franches?/i, 'limites', 'zonages'],

  // Population, buildings, services.
  [/^INSEE|FILOSOFI/i, 'societe', 'insee'],
  [/BUILDINGS|DIFF-BATI|ZONE_ACTIVITES|batiments?/i, 'societe', 'bati'],
  [/IGNF_POI-|\bPOI\b/i, 'societe', 'services'],

  // Transport.
  [/SECUROUTE|transports? exceptionnels?/i, 'transports', 'convois'],
  [/RANDO|randonnee/i, 'transports', 'randonnee'],
  [/RUNWAYS|DRONES|aeroport|aeronautique/i, 'transports', 'aerien'],
  [/RAILWAYS|voie ferree|ferroviaire/i, 'transports', 'rail'],
  [/ROAD|RESEAU_ROUTIER|MARKERPOST|DELAISSES|DGF_\d{4}-voirie|\broutes?\b|voirie/i, 'transports', 'routes'],
  [/^TRANSPORT|^TN\./i, 'transports', 'autres'],

  // Maps last (GEOGRAPHICALGRIDSYSTEMS.* also names slope maps and grids, placed above).
  [/1914|1915|1916|1917|1918|VERDUN|DOUAUMONT|Mort-Homme|CARTES-14-18/i, 'cartes', 'grande-guerre'],
  [/CASSINI|ETAT-?MAJOR|TERRIER|BONNE|SCAN50\.1950|1900TYPEMAPS|EDUGEO|carte (de|d.)?.{0,20}\b1[5-9]\d\d\b/i, 'cartes', 'historiques'],
  [/PLANIGN|PLAN IGN|BDUNI|GEOGRAPHICALNAMES/i, 'cartes', 'plans'],
  [/SCAN|COASTALMAPS|MAPS\.OVERVIEW|NATURALEARTH|^CARTES/i, 'cartes', 'topo'],
  [/^GEOGRAPHICALGRIDSYSTEMS?\b/i, 'cartes', 'autres']
];

/** On the keywords and description, for a layer the rules above left out: broad themes only. @type {[RegExp, string, string][]} */
const LOOSE = [
  [/\bforets?\b|forestier|\barbres?\b/, 'vegetation', 'forets'],
  [/vegetation|flore|habitats? naturels?/, 'vegetation', 'vegetation'],
  [/natura ?2000|znieff|aire protegee|espace protege|reserve naturelle|parc national/, 'nature', 'protections'],
  [/geolog/, 'sols', 'geologie'],
  [/\bsols?\b|pedolog/, 'sols', 'sols'],
  [/altitude|relief|\bmnt\b|elevation/, 'relief', 'autres'],
  [/hydrograph|cours d.eau|riviere|\blacs?\b/, 'eau', 'cours'],
  [/occupation du sol|land ?cover/, 'occupation', 'autres'],
  [/agricol|cultures?\b|\bpac\b/, 'agriculture', 'autres'],
  [/cadastr/, 'limites', 'cadastre'],
  [/commune|departement|region|administrati/, 'limites', 'admin'],
  [/route|transport|ferroviaire/, 'transports', 'autres'],
  [/energie|electricite|solaire|eolien/, 'energie', 'autres'],
  [/risque|inondation|seism/, 'risques', 'autres'],
  [/orthophoto|photographie aerienne|ortho-?image/, 'photos', 'autres'],
  [/\bcarte\b|\bplan\b|scan/, 'cartes', 'autres']
];

/** Readable titles for the layers named by a code. @type {Record<string, string>} */
const LABELS = {
  Patrinat_APB: 'Arrêtés de protection de biotope (APB)',
  Patrinat_APG: 'Arrêtés de protection de géotope (APG)',
  Patrinat_APHN: 'Arrêtés de protection d’habitats naturels (APHN)',
  Patrinat_BIOS: 'Réserves de biosphère (UNESCO)',
  Patrinat_BPM: 'Biens du patrimoine mondial (UNESCO)',
  Patrinat_CDL: 'Terrains du Conservatoire du littoral',
  Patrinat_CEN: 'Terrains des conservatoires d’espaces naturels (CEN)',
  Patrinat_GEOPARC: 'Géoparcs mondiaux (UNESCO)',
  Patrinat_INPG: 'Inventaire du patrimoine géologique (INPG)',
  Patrinat_APLG: 'Espaces protégés (INPN) : APLG',
  Patrinat_ZPR: 'Espaces protégés (INPN) : ZPR',
  Patrinat_PN: 'Parcs nationaux',
  Patrinat_PNM: 'Parcs naturels marins',
  Patrinat_PNR: 'Parcs naturels régionaux',
  Patrinat_PPRNN: 'Périmètres de protection de réserves naturelles nationales',
  Patrinat_RAMSAR: 'Sites Ramsar (zones humides d’importance internationale)',
  Patrinat_RB: 'Réserves biologiques',
  Patrinat_RIPN: 'Réserves intégrales de parcs nationaux',
  Patrinat_RNC: 'Réserves naturelles de Corse',
  Patrinat_RNCFS: 'Réserves nationales de chasse et de faune sauvage',
  Patrinat_RNN: 'Réserves naturelles nationales',
  Patrinat_RNR: 'Réserves naturelles régionales',
  Patrinat_SIC: 'Natura 2000 : sites d’importance communautaire (directive Habitats)',
  Patrinat_ZPS: 'Natura 2000 : zones de protection spéciale (directive Oiseaux)',
  Patrinat_ZNIEFF1: 'ZNIEFF de type I',
  Patrinat_ZNIEFF2: 'ZNIEFF de type II',
  Patrinat_ZNIEFF1_MER: 'ZNIEFF marines de type I',
  Patrinat_ZNIEFF2_MER: 'ZNIEFF marines de type II',
  INRAE_GRAIN_BOCAGER: 'Grain bocager (INRAE)',
  'INRAE_GRAIN-BOCAGER': 'Grain bocager (INRAE)',
  Carhab_habitat: 'Habitats naturels (CarHab)',
  Carhab_Reunion_PYRAMIDE: 'Habitats naturels de La Réunion (CarHab)',
  'hedge.hedge': 'Haies linéaires',
  'INRA.CARTE.SOLS': 'Carte des sols de France',
  'ELEVATION.SLOPES': 'Altitude (teintes hypsométriques)',
  'ELEVATION.SLOPES.HIGHRES': 'Litto3D® (relief du littoral)',
  'ELEVATIONGRIDCOVERAGE.HIGHRES.QUALITY': 'Sources du RGE ALTI® (qualité)',
  COSIA: 'CoSIA : carte de prédiction simplifiée (essai)'
};

/** Who produces a layer (said with it; the service is the Géoplateforme's whatever the producer). @type {[RegExp, string][]} */
const SOURCES = [
  [/^Patrinat_/, 'PatriNat (OFB, MNHN, CNRS, IRD) – INPN'],
  [/^ADEME_/, 'ADEME'],
  [/^INSEE\./, 'INSEE (Filosofi)'],
  [/^INRAE?[._]/, 'INRAE'],
  [/^OFB/, 'OFB'],
  [/^FORETS\.PUBLIQUES/, 'ONF'],
  [/CLC|CHA\d|CORINE/, 'Copernicus (UE) – CORINE Land Cover, données SDES'],
  [/ASP/, 'ASP (Agence de services et de paiement)'],
  [/COASTALMAPS/, 'SHOM et IGN'],
  [/^BNF-IGNF_/, 'BnF et IGN'],
  [/^AN-IGNF_/, 'Archives nationales et IGN'],
  [/ORTHOPHOTOS\.GENEVE/, 'SITG (canton de Genève)'],
  [/ORTHOPHOTOS\.NCL/, 'DITTT (Nouvelle-Calédonie)'],
  [/Carhab/, 'CarHab (OFB, MNHN)'],
  [/CONSERVATOIRE_LITTORAL/, 'Conservatoire du littoral'],
  [/^MGP_/, 'Métropole du Grand Paris'],
  [/^DGF_/, 'DGCL'],
  [/EDUGEO/, 'IGN (Édugéo)']
];

// ── Series ───────────────────────────────────────────────────────────────────

/** The départements, for a series by département (title or identifier). @type {[string, string][]} */
const DEPARTEMENTS = [
  ['01', 'Ain'], ['02', 'Aisne'], ['03', 'Allier'], ['04', 'Alpes-de-Haute-Provence'], ['05', 'Hautes-Alpes'],
  ['06', 'Alpes-Maritimes'], ['07', 'Ardèche'], ['08', 'Ardennes'], ['09', 'Ariège'], ['10', 'Aube'], ['11', 'Aude'],
  ['12', 'Aveyron'], ['13', 'Bouches-du-Rhône'], ['14', 'Calvados'], ['15', 'Cantal'], ['16', 'Charente'],
  ['17', 'Charente-Maritime'], ['18', 'Cher'], ['19', 'Corrèze'], ['2A', 'Corse-du-Sud'], ['2B', 'Haute-Corse'],
  ['21', 'Côte-d’Or'], ['22', 'Côtes-d’Armor'], ['23', 'Creuse'], ['24', 'Dordogne'], ['25', 'Doubs'], ['26', 'Drôme'],
  ['27', 'Eure'], ['28', 'Eure-et-Loir'], ['29', 'Finistère'], ['30', 'Gard'], ['31', 'Haute-Garonne'], ['32', 'Gers'],
  ['33', 'Gironde'], ['34', 'Hérault'], ['35', 'Ille-et-Vilaine'], ['36', 'Indre'], ['37', 'Indre-et-Loire'],
  ['38', 'Isère'], ['39', 'Jura'], ['40', 'Landes'], ['41', 'Loir-et-Cher'], ['42', 'Loire'], ['43', 'Haute-Loire'],
  ['44', 'Loire-Atlantique'], ['45', 'Loiret'], ['46', 'Lot'], ['47', 'Lot-et-Garonne'], ['48', 'Lozère'],
  ['49', 'Maine-et-Loire'], ['50', 'Manche'], ['51', 'Marne'], ['52', 'Haute-Marne'], ['53', 'Mayenne'],
  ['54', 'Meurthe-et-Moselle'], ['55', 'Meuse'], ['56', 'Morbihan'], ['57', 'Moselle'], ['58', 'Nièvre'], ['59', 'Nord'],
  ['60', 'Oise'], ['61', 'Orne'], ['62', 'Pas-de-Calais'], ['63', 'Puy-de-Dôme'], ['64', 'Pyrénées-Atlantiques'],
  ['65', 'Hautes-Pyrénées'], ['66', 'Pyrénées-Orientales'], ['67', 'Bas-Rhin'], ['68', 'Haut-Rhin'], ['69', 'Rhône'],
  ['70', 'Haute-Saône'], ['71', 'Saône-et-Loire'], ['72', 'Sarthe'], ['73', 'Savoie'], ['74', 'Haute-Savoie'],
  ['75', 'Paris'], ['76', 'Seine-Maritime'], ['77', 'Seine-et-Marne'], ['78', 'Yvelines'], ['79', 'Deux-Sèvres'],
  ['80', 'Somme'], ['81', 'Tarn'], ['82', 'Tarn-et-Garonne'], ['83', 'Var'], ['84', 'Vaucluse'], ['85', 'Vendée'],
  ['86', 'Vienne'], ['87', 'Haute-Vienne'], ['88', 'Vosges'], ['89', 'Yonne'], ['90', 'Territoire de Belfort'],
  ['91', 'Essonne'], ['92', 'Hauts-de-Seine'], ['93', 'Seine-Saint-Denis'], ['94', 'Val-de-Marne'], ['95', 'Val-d’Oise'],
  ['971', 'Guadeloupe'], ['972', 'Martinique'], ['973', 'Guyane'], ['974', 'La Réunion'], ['976', 'Mayotte']
];
// Only in a photo's title (« … Historique 1947 - Calvados »): « Nord », « Loire », « Paris »… are words of other titles.
const DEPT_NAME = new RegExp(`(?:^|[\\s(,-])(${DEPARTEMENTS.map(([, n]) => fold(n).replace(/[-’']/g, '.')).sort((a, b) => b.length - a.length).join('|')})\\s*$`);

const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
/** Years, periods (« 2016-2017 », « 2024-06 »), éditions (« Edition : 2017-01-01 », « Dernière édition »). */
const DATED = /\s*[;,(–-]?\s*(?:[ée]dition\s*:?\s*)?(?:\d{4}-\d{2}-\d{2}|(?:18|19|20)\d{2}(?:\s*[-–]\s*(?:(?:18|19|20)?\d{2}))?)\)?/gi;
const LATEST = /\s*[;,–-]?\s*(?:derni[eè]re [ée]dition|latest)\b/gi;

/** The year or period a layer is of (title, else identifier), '' when none. @param {string} title @param {string} id */
function periodOf(title, id) {
  const edition = /(?:^|\D)((?:18|19|20)\d{2})-\d{2}-\d{2}(?:\D|$)/.exec(title);
  if (edition) return edition[1];
  const month = new RegExp(`\\b(${MONTHS.join('|')})\\s+((?:19|20)\\d{2})\\b`).exec(fold(title));
  if (month) return `${month[1]} ${month[2]}`;
  for (const s of [title, id.replace(/[._]/g, ' ')]) {
    const m = /(?:^|[^\d])((?:18|19|20)\d{2})(?:\s*-\s*((?:18|19|20)\d{2}|\d{2}))?(?!\d)/.exec(s);
    if (m) return m[2] && m[2].length === 4 ? `${m[1]}-${m[2]}` : m[2] && Number(m[2]) > 12 ? `${m[1]}-${m[1].slice(0, 2)}${m[2]}` : m[1];
  }
  return '';
}

/**
 * The series a layer belongs to by its identifier (rules for the series the titles say badly), else null.
 * @param {string} id @param {string} title
 * @returns {{ key: string, title: string, variant: string } | null}
 */
function namedSeries(id, title) {
  /** @type {RegExpExecArray | null} */
  let m;
  if ((m = /^ORTHOIMAGERY\.ORTHOPHOTOS(\d{4}(?:-\d{4})?)$/.exec(id))) return { key: 'ortho-annees', title: 'Photographies aériennes par année', variant: m[1] };
  if ((m = /^ORTHOIMAGERY\.ORTHOPHOTOS\.(\d{4}-\d{4})$/.exec(id))) return { key: 'ortho-historiques', title: 'Photographies aériennes historiques', variant: m[1] };
  if ((m = /^ORTHOIMAGERY\.ORTHOPHOTOS\.IRC(?:\.(\d{4}))?$/.exec(id))) return { key: 'ortho-irc', title: 'BD ORTHO® infrarouge fausses couleurs', variant: m[1] || 'La plus récente' };
  if ((m = /^ORTHOIMAGERY\.ORTHOPHOTOS\.IRC-EXPRESS\.(\d{4})$/.exec(id))) return { key: 'ortho-irc-express', title: 'Ortho-express infrarouge', variant: m[1] };
  if ((m = /^ORTHOIMAGERY\.ORTHOPHOTOS\.(?:ORTHO|RVB)-EXPRESS\.(\d{4})$/.exec(id))) return { key: 'ortho-express', title: 'Ortho-express (couleurs)', variant: m[1] };
  if ((m = /^ORTHOIMAGERY\.ORTHOPHOTOS\.ORTHO-ASP_PAC(\d{4})$/.exec(id))) return { key: 'ortho-pac', title: 'Orthophotos de la PAC (ASP)', variant: m[1] };
  if ((m = /^ORTHOIMAGERY\.ORTHO-SAT\.PLEIADES\.MAYOTTE\.(\d{4}-\d{2})$/.exec(id))) return { key: 'pleiades-mayotte', title: 'Pléiades sur Mayotte', variant: periodOf(title, m[1]) || m[1] };
  if ((m = /^ORTHOIMAGERY\.ORTHO-SAT\.PLEIADES\.(\d{4})$/.exec(id))) return { key: 'pleiades', title: 'Images Pléiades', variant: m[1] };
  if ((m = /^ORTHOIMAGERY\.ORTHO-SAT\.SPOT\.(\d{4})$/.exec(id))) return { key: 'spot', title: 'Images SPOT 6-7', variant: m[1] };
  if (/RAPIDEYE/i.test(id)) return { key: 'rapideye', title: 'Images RapidEye (GEOSUD)', variant: periodOf(title, id) || 'Sans date' };
  if (/^ORTHOIMAGERY\.EDUGEO\.|^ORTHO-EDUGEO_/.test(id) || /^SPOT-EDUGEO_/.test(id)) {
    const spot = /^spot\b/i.test(title);
    return spot ? { key: 'edugeo-spot', title: 'Images SPOT de villes (Édugéo)', variant: placeVariant(title.replace(/^spot\s*/i, '')) }
      : { key: 'edugeo-photos', title: 'Photographies anciennes de villes (Édugéo)', variant: placeVariant(title.replace(/^photographie\s*-\s*/i, '')) };
  }
  if (/^(GEOGRAPHICALGRIDSYSTEMS\.EDUGEO\.|SCAN-EDUGEO_)/.test(id) && /^cartographie\b/i.test(title)) {
    // « Cartographie 1964 »: the town is only in the identifier (…EDUGEO.PARIS1964).
    const named = title.replace(/^cartographie\s*/i, '');
    const place = /^\d{4}$/.test(named) ? (/\.([A-Za-z-]+)\d{4}$/.exec(id)?.[1].replace(/-/g, ' ') || '') + ' ' + named : named;
    return { key: 'edugeo-cartes', title: 'Cartes anciennes de villes (Édugéo)', variant: placeVariant(place) };
  }
  if (/^(EDUGEO\.)?LANDUSE\.AGRICULTURE|^RPG\d{4}_/.test(id)) return { key: 'rpg', title: 'Registre parcellaire graphique (RPG)', variant: /LATEST/.test(id) ? 'Dernière édition' : periodOf(title, id) };
  if (/^HYDROGRAPHY\.BCAE\./.test(id)) return { key: 'bcae-cours', title: 'Cours d’eau BCAE (bandes tampons)', variant: /LATEST/.test(id) ? 'Dernière édition' : periodOf(title, id) };
  if ((m = /^IGNF_COSIA_(\d{4}-\d{4})$/.exec(id))) return { key: 'cosia', title: 'CoSIA : occupation du sol par intelligence artificielle', variant: periodOf(title, id) || m[1] };
  if ((m = /^LANDCOVER\.(GRID\.)?(CLC|CHA)(\d\d)(R?)(_FR|_DOM)?$/.exec(id))) {
    const [, grid, kind, yy, revised, where] = m;
    const zone = where === '_FR' ? ' – France métropolitaine' : where === '_DOM' ? ' – outre-mer' : '';
    const year = (Number(yy) > 50 ? '19' : '20') + yy;
    const variant = kind === 'CHA' ? periodOf(title, id) || year : year + (revised ? ' révisée' : '');
    return { key: `clc-${grid ? 'raster-' : ''}${kind === 'CHA' ? 'changements-' : ''}${where ? where.slice(1).toLowerCase() : 'tout'}`,
      title: `CORINE Land Cover${kind === 'CHA' ? ' : changements' : ''}${grid ? ' (raster)' : ''}${zone}`, variant };
  }
  if ((m = /^ADEME_(EPCI|KM2)_(.+)$/.exec(id))) {
    const what = m[2].replace(/-/g, ' ').replace(/\blineaire\b/g, 'linéaire').replace(/\bpreleve\b/g, 'prélevé').replace(/\ba stock\b/g, 'à stock');
    return { key: 'ademe-' + m[2], title: `Haies (ADEME) : ${what}`, variant: m[1] === 'EPCI' ? 'Par intercommunalité (EPCI)' : 'Par km²' };
  }
  if ((m = /^orthophoto_(\d{4})_([a-z-]+)$/i.exec(id))) {
    const dept = DEPARTEMENTS.find(([, n]) => fold(n) === fold(m?.[2].replace(/-/g, ' ') || ''));
    return { key: 'ortho-histo-' + m[2].toLowerCase(), title: `BD ORTHO® historique – ${dept ? dept[1] : m[2]}`, variant: m[1] };
  }
  return null;
}

/** A short, stable fingerprint of a text (a series' key). @param {string} s */
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** « AJACCIO 1975 » → « Ajaccio 1975 ». @param {string} s */
function placeVariant(s) {
  const t = s.replace(/^[\s:-]+/, '').trim();
  return t === t.toUpperCase() ? t.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()) : t.replace(/^\p{L}/u, c => c.toUpperCase());
}

/** A title without its year, period, édition or département: what the layers of one series share. @param {string} title */
function stemOf(title) {
  let s = fold(title).replace(LATEST, '').replace(DATED, '');
  for (const month of MONTHS) s = s.replace(new RegExp(`\\b${month}\\b`, 'g'), '');
  s = s.replace(DEPT_NAME, '');
  return s.replace(/[\s;:,–-]+$/, '').replace(/\s+/g, ' ').trim();
}

/** A title made a series' title: its year, édition, département taken off. @param {string} title */
function seriesTitle(title) {
  const t = title.replace(/\s*[;,]?\s*[ée]dition\s*:?\s*\d{4}-\d{2}-\d{2}/gi, '').replace(/\s*[;,–-]?\s*derni[eè]re [ée]dition/gi, '')
    .replace(/\s*\(?\b(?:18|19|20)\d{2}(?:\s*-\s*(?:(?:18|19|20)?\d{2}))?\b\)?/g, '').replace(/\s*-\s*(?=-|$)/g, '');
  let out = t.replace(/[\s;:,–-]+$/, '').replace(/\s{2,}/g, ' ').trim();
  // A département at the end (folding keeps the length of these titles: cut at the same place).
  const folded = fold(out);
  const dept = folded.length === out.length ? DEPT_NAME.exec(folded) : null;
  if (dept) out = out.slice(0, dept.index + dept[0].length - dept[1].length).replace(/[\s;:,(–-]+$/, '').trim();
  return out || title;
}

// ── Botany ───────────────────────────────────────────────────────────────────

/**
 * « Pertinent pour la botanique »: 1, the most useful (shown first, « Recommandées »); 2, useful (a mark in the list).
 * On identifiers (a series: its key or any of its layers).
 * @type {[RegExp, 1 | 2][]}
 */
const BOTANY = [
  [/^(FORETS\.PUBLIQUES|LANDCOVER\.FORESTINVENTORY\.V2|IGNF_FORETS-ANCIENNES|LANDCOVER\.SYLVOECOREGIONS)$/, 1],
  [/^Patrinat_(ZNIEFF1|ZNIEFF2|SIC|ZPS|PN|RNN|RNR|APB)$/, 1],
  [/^(INRA\.CARTE\.SOLS|GEOLOGIE\..*|.*GEOLOG.*)$/i, 1],
  [/^(Carhab_habitat|IGNF_BD-FRANCE-TOPO-VEGETATION|TOURBIERES_ZONES-HUMIDES\.BCAE)$/, 1],
  [/^(ELEVATION\.ELEVATIONGRIDCOVERAGE\.SHADOW|ELEVATION\.CONTOUR\.LINE)$/, 1],
  [/^ORTHOIMAGERY\.ORTHOPHOTOS\.IRC(\.\d{4})?$/, 1],
  [/^(LANDCOVER\.FORESTINVENTORY\.V1|IGNF_MASQUE-FORET.*|LANDCOVER\.FORESTAREAS|LANDCOVER\.SYLVOECOREGIONS\.ALLUVIUM|ZONES-A-PROSPECTER-FORETS-SUBNATURELLES)$/, 2],
  [/^Patrinat_(PNR|PNM|RAMSAR|RB|RIPN|CEN|CDL|RNC|APHN|APG|INPG|ZNIEFF1_MER|ZNIEFF2_MER|BIOS)$/, 2],
  [/^(IGNF_BD-HAIE.*|hedge\.hedge|INRAE_GRAIN-BOCAGER|Carhab_Reunion_PYRAMIDE|IGNF_MASQUE-CARTO-FORMATIONS-VEGETALES.*|IGNF_NATURE-EN-VILLE.*)$/, 2],
  [/^LANDCOVER\.(CLC18.*|HR\.(TCD|DLT|GRA|WAW)\.CLC15)$/, 2],
  [/^OCSGE\.COUVERTURE\..*$/, 2],
  [/^(IGNF_LIDAR-HD_(MNT|MNH)_.*|IGNF_ELEVATION\.ELEVATIONGRIDCOVERAGE\.SHADOW|ELEVATION\.SLOPES|GEOGRAPHICALGRIDSYSTEMS\.SLOPES\.MOUNTAIN)$/, 2],
  [/^(HYDROGRAPHY\.HYDROGRAPHY|INPE|IGNF_RPG_PRAIRIES-PERMANENTES.*|PRAIRIES\.SENSIBLES\.BCAE)$/, 2],
  [/^(BNF-IGNF_GEOGRAPHICALGRIDSYSTEMS\.CASSINI|GEOGRAPHICALGRIDSYSTEMS\.ETATMAJOR40|ORTHOIMAGERY\.ORTHOPHOTOS\.1950-1965)$/, 2],
  [/^(ORTHOIMAGERY\.ORTHOPHOTOS|HR\.ORTHOIMAGERY\.ORTHOPHOTOS|GEOGRAPHICALGRIDSYSTEMS\.PLANIGNV2|CADASTRALPARCELS\.PARCELLAIRE_EXPRESS|TRACES\.RANDO\.HIVERNALE)$/, 2]
];

/** @param {string} id @returns {0 | 1 | 2} */
function botanyOf(id) {
  for (const [re, rank] of BOTANY) if (re.test(id)) return rank;
  return 0;
}

// ── Classifying ──────────────────────────────────────────────────────────────

/**
 * A layer's place, read from it alone: category, sub-category, readable title, producer.
 * @param {{ id: string, title: string, about?: string, kw?: string[] }} layer
 * @returns {{ cat: string, sub: string, label: string, source: string }}
 */
export function classifyLayer(layer) {
  const id = layer.id;
  const subject = `${id} ${fold(layer.title)}`;
  let place = RULES.find(([re]) => re.test(subject));
  if (!place) {
    const loose = fold(`${(layer.kw || []).join(' ')} ${layer.about || ''}`);
    place = LOOSE.find(([re]) => re.test(loose));
  }
  const [, cat, sub] = place || [null, 'autres', 'divers'];
  const label = LABELS[id] || (/^[a-z]/.test(layer.title) ? layer.title[0].toUpperCase() + layer.title.slice(1) : '');
  const source = SOURCES.find(([re]) => re.test(id))?.[1] || '';
  return { cat, sub, label: label && label !== layer.title ? label : '', source };
}

/**
 * The classification of a whole catalogue (a series needs its siblings): each layer with its place, and, when it is
 * one of a series, the series' key, title and its own variant (« 2018 », « Calvados », « Ajaccio 1975 »…).
 * @template {{ id: string, title: string, about?: string, kw?: string[] }} T
 * @param {T[]} layers
 * @returns {(T & Classified)[]}
 */
export function classifyLayers(layers) {
  const out = layers.map(l => {
    const { cat, sub, label, source } = classifyLayer(l);
    /** @type {T & Classified} */
    const c = { ...l, cat, sub };
    delete c.group; delete c.gtitle; delete c.variant; delete c.label; delete c.source; delete c.botany;
    if (label) c.label = label;
    if (source) c.source = source;
    const rank = botanyOf(l.id);
    if (rank) c.botany = rank;
    return c;
  });

  // Series named by their identifiers.
  /** @type {Map<string, (T & Classified)[]>} */
  const groups = new Map();
  for (const l of out) {
    const s = namedSeries(l.id, l.title);
    if (!s) continue;
    l.group = s.key; l.gtitle = s.title; l.variant = s.variant;
    groups.set(s.key, [...(groups.get(s.key) || []), l]);
  }
  // The others, by title: the same title but for a year, an édition or a département, in the same category (copies
  // of one layer under two identifiers, too).
  /** @type {Map<string, (T & Classified)[]>} */
  const byStem = new Map();
  for (const l of out) {
    if (l.group) continue;
    // Two years apart in one title (« entre 1945 et 1970 »): a layer of its own, not one of a series (its copies aside).
    const stem = (fold(l.title).match(/(?<![\d-])(?:18|19|20)\d{2}(?![\d-])/g) || []).length > 1 ? fold(l.title) : stemOf(l.title);
    if (!stem) continue;
    const key = `${l.cat}|${stem}`;
    byStem.set(key, [...(byStem.get(key) || []), l]);
  }
  for (const [key, members] of byStem) {
    if (members.length < 2) continue;
    const gkey = 's-' + key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '-' + hash(key);
    // Copies of one layer (the same title): the title as it is, each told by its identifier.
    const copies = members.every(l => l.title === members[0].title);
    const newest = [...members].sort((a, b) => periodOf(b.title, b.id).localeCompare(periodOf(a.title, a.id)))[0];
    const title = copies ? members[0].label || members[0].title : seriesTitle(newest.label || newest.title);
    for (const l of members) {
      const dept = DEPT_NAME.exec(fold(l.title).replace(DATED, '').trim());
      const name = dept ? DEPARTEMENTS.find(([, n]) => fold(n) === dept[1])?.[1] : '';
      l.group = gkey; l.gtitle = title;
      l.variant = copies ? periodOf('', l.id) || l.id : /LATEST|derni[eè]re [ée]dition/i.test(l.id + ' ' + l.title) ? 'Dernière édition'
        : [periodOf(l.title, l.id), name].filter(Boolean).join(' – ') || '';
    }
    groups.set(gkey, members);
  }

  // Within a series: one place (its first layer's, in the order of the taxonomy), a botany rank (the best), variants
  // told apart (two copies of one layer: by identifier).
  const order = (/** @type {Classified} */ l) => {
    const ci = CATEGORIES.findIndex(c => c.id === l.cat);
    return ci * 100 + (CATEGORIES[ci]?.subs.findIndex(s => s.id === l.sub) ?? 0);
  };
  for (const members of groups.values()) {
    if (members.length < 2) {
      for (const l of members) { delete l.group; delete l.gtitle; delete l.variant; }
      continue;
    }
    const lead = [...members].sort((a, b) => order(a) - order(b))[0];
    const best = Math.min(...members.map(l => l.botany || 9));
    // Two copies of one variant (the same layer under two identifiers): « 2012 », « 2012 (copie 2) »…
    /** @type {Map<string, number>} */
    const seen = new Map();
    // The layer under its usual name first, its technical copies (pyramids, Édugéo's) after.
    const technical = (/** @type {Classified & { id: string }} */ l) => (/_PYR-|_WM_|^EDUGEO\./.test(l.id) ? 2 : /EDUGEO/.test(l.id) ? 1 : 0);
    for (const l of [...members].sort((a, b) => technical(a) - technical(b))) {
      l.cat = lead.cat; l.sub = lead.sub;
      if (best < 9) l.botany = /** @type {1 | 2} */ (best);
      const v = l.variant || l.label || l.title;
      const n = (seen.get(v) || 0) + 1;
      seen.set(v, n);
      l.variant = n > 1 ? `${v} (copie ${n})` : v;
    }
  }
  return out;
}

/**
 * What classifyLayers adds to a layer.
 * @typedef {{ cat: string, sub: string, label?: string, source?: string, botany?: 1 | 2, group?: string, gtitle?: string, variant?: string }} Classified
 */

// ── Entries: what a list shows (a layer, or a series as one) ─────────────────

/**
 * One row of the list: a layer, or a series of layers (its variants, newest first).
 * @template {{ id: string, title: string, about?: string, kw?: string[] } & Classified} L
 * @typedef {{ key: string, title: string, about: string, cat: string, sub: string, botany: number, layers: L[], text: string }} Entry
 */

/** Variants in order: « Dernière édition » first, then the newest year, then by name. @param {string} a @param {string} b */
function variantOrder(a, b) {
  const copy = (/** @type {string} */ v) => Number(/ \(copie (\d+)\)$/.exec(v)?.[1] || 1);
  const [ca, cb] = [copy(a), copy(b)];
  a = a.replace(/ \(copie \d+\)$/, ''); b = b.replace(/ \(copie \d+\)$/, '');
  if (a === b) return ca - cb;
  const latest = (/** @type {string} */ v) => /^(Dernière édition|La plus récente)/.test(v) ? 1 : 0;
  if (latest(a) !== latest(b)) return latest(b) - latest(a);
  const ya = /\b(18|19|20)\d{2}\b/.exec(a)?.[0], yb = /\b(18|19|20)\d{2}\b/.exec(b)?.[0];
  const placeA = a.replace(/\b(18|19|20)\d{2}\b.*/, '').trim(), placeB = b.replace(/\b(18|19|20)\d{2}\b.*/, '').trim();
  // Towns (« Ajaccio 1975 »): by town, then by year; years alone: the newest first.
  if (placeA || placeB) return placeA.localeCompare(placeB, 'fr') || (ya || '').localeCompare(yb || '') || a.localeCompare(b, 'fr');
  if (ya && yb && ya !== yb) return yb.localeCompare(ya);
  return b.localeCompare(a, 'fr', { numeric: true });
}

/**
 * A classified catalogue as the rows of its list, each with its folded searchable text (title, readable title,
 * description, keywords, category, sub-category, variants, identifiers).
 * @template {{ id: string, title: string, about?: string, kw?: string[] } & Classified} L
 * @param {L[]} layers @returns {Entry<L>[]}
 */
export function entriesOf(layers) {
  /** @type {Map<string, Entry<L>>} */
  const byKey = new Map();
  for (const l of layers) {
    const key = l.group ? 'g:' + l.group : 'l:' + l.id;
    let e = byKey.get(key);
    if (!e) {
      e = { key, title: l.group ? l.gtitle || l.title : l.label || l.title, about: l.about || '', cat: l.cat, sub: l.sub, botany: l.botany || 0, layers: [], text: '' };
      byKey.set(key, e);
    }
    e.layers.push(l);
    if (!e.about && l.about) e.about = l.about;
  }
  const entries = [...byKey.values()];
  for (const e of entries) {
    if (e.layers.length > 1) e.layers.sort((a, b) => variantOrder(a.variant || '', b.variant || ''));
    // A series' description: its newest layer's.
    if (e.layers.length > 1 && e.layers[0].about) e.about = e.layers[0].about;
    const parts = [e.title, placeLabel(e.cat, e.sub)];
    for (const l of e.layers) parts.push(l.title, l.label || '', l.about || '', (l.kw || []).join(' '), l.variant || '', l.id, l.source || '');
    e.text = fold(parts.join(' '));
  }
  return entries.sort((a, b) => a.title.localeCompare(b.title, 'fr', { ignorePunctuation: true, sensitivity: 'base' }));
}

/**
 * The entries in the taxonomy's tree: each category with its sub-categories (the empty ones left out), each counting
 * its layers and its rows.
 * @template {{ key: string, cat: string, sub: string, layers: any[] }} E
 * @param {E[]} entries
 * @returns {{ id: string, label: string, count: number, rows: number, subs: { id: string, label: string, count: number, entries: E[] }[] }[]}
 */
export function treeOf(entries) {
  return CATEGORIES.map(c => {
    const subs = c.subs.map(s => {
      const list = entries.filter(e => e.cat === c.id && e.sub === s.id);
      return { id: s.id, label: s.label, count: list.reduce((n, e) => n + e.layers.length, 0), entries: list };
    }).filter(s => s.entries.length);
    return { id: c.id, label: c.label, count: subs.reduce((n, s) => n + s.count, 0), rows: subs.reduce((n, s) => n + s.entries.length, 0), subs };
  }).filter(c => c.subs.length);
}

/**
 * The entries a search finds: every word (folded) in the entry's text; the best first (a word in the title before a
 * word in the description only), recommended ones before the others at equal score.
 * @template {{ title: string, text: string, botany: number }} E
 * @param {E[]} entries @param {string} query @returns {E[]}
 */
export function searchEntries(entries, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return entries;
  const scored = [];
  for (const e of entries) {
    if (!words.every(w => e.text.includes(w))) continue;
    const title = fold(e.title);
    const score = words.reduce((n, w) => n + (title.startsWith(w) ? 3 : title.includes(w) ? 2 : 0), 0) + (e.botany === 1 ? 1 : e.botany === 2 ? 0.5 : 0);
    scored.push({ e, score });
  }
  return scored.sort((a, b) => b.score - a.score).map(s => s.e);
}
