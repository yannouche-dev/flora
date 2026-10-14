// The classification of IGN's layers (lib/ign-classify.mjs), on the catalogue shipped with the app
// (data/ign-catalog.json, ~660 layers): every layer placed (« Autres » at worst), none lost or counted twice by the
// grouping of series, the series grouped as expected (by year, édition, département, town), the layers useful for
// botany ranked first; and the same result whether the file was classified at build time or is classified on reading.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layersOf } from '../../lib/ign-catalog.mjs';
import { CATEGORIES, classifyLayer, classifyLayers, entriesOf, fold, knownPlace, searchEntries, treeOf } from '../../lib/ign-classify.mjs';

const FILE = JSON.parse(readFileSync(new URL('../../data/ign-catalog.json', import.meta.url), 'utf8'));
const RAW = FILE.layers.map((/** @type {any} */ { id, title, about, format, style, minNative, maxNative }) => ({ id, title, about, format, style, minNative, maxNative }));
const LAYERS = classifyLayers(RAW);
const ENTRIES = entriesOf(LAYERS);
const byId = Object.fromEntries(LAYERS.map(l => [l.id, l]));

test('chaque couche du catalogue livré a une catégorie et une sous-catégorie connues', () => {
  assert.equal(LAYERS.length, RAW.length);
  for (const l of LAYERS) assert.ok(knownPlace(l.cat, l.sub), `${l.id} : ${l.cat}/${l.sub}`);
  // « Autres » is a small remainder, not where the rules give up.
  const others = LAYERS.filter(l => l.cat === 'autres');
  assert.ok(others.length <= LAYERS.length * 0.03, `${others.length} couches dans « Autres »`);
});

test('aucune couche perdue ni comptée deux fois : lignes, arbre et catalogue ont les mêmes couches', () => {
  const inEntries = ENTRIES.flatMap(e => e.layers.map(l => l.id));
  assert.equal(inEntries.length, LAYERS.length);
  assert.equal(new Set(inEntries).size, LAYERS.length);
  const tree = treeOf(ENTRIES);
  assert.equal(tree.reduce((n, c) => n + c.count, 0), LAYERS.length);
  assert.equal(tree.reduce((n, c) => n + c.rows, 0), ENTRIES.length);
  // Far fewer rows than layers: the series are grouped.
  assert.ok(ENTRIES.length < LAYERS.length * 0.6, `${ENTRIES.length} lignes pour ${LAYERS.length} couches`);
  // The tree in the taxonomy's order, each category with its own sub-categories only.
  const order = CATEGORIES.map(c => c.id);
  assert.deepEqual(tree.map(c => c.id), order.filter(id => tree.some(c => c.id === id)));
  for (const c of tree) for (const s of c.subs) assert.ok(s.entries.every(e => e.cat === c.id && e.sub === s.id));
});

test('séries : une ligne par série, ses variantes (années, éditions, départements, villes) sans doublon', () => {
  const entry = (/** @type {string} */ id) => /** @type {any} */ (ENTRIES.find(e => e.layers.some(l => l.id === id)));
  const years = entry('ORTHOIMAGERY.ORTHOPHOTOS2012');
  assert.equal(years.title, 'Photographies aériennes par année');
  assert.ok(years.layers.length >= 20);
  assert.equal(years.layers[0].variant, '2024', 'la plus récente d’abord');
  assert.deepEqual(entry('ORTHOIMAGERY.ORTHOPHOTOS.IRC.2018').layers[0].variant, 'La plus récente');
  // Éditions: « Dernière édition » first.
  const admin = entry('ADMINEXPRESS-COG.2019');
  assert.equal(admin.title, 'ADMINEXPRESS COG');
  assert.equal(admin.layers[0].variant, 'Dernière édition');
  // A département's historic photos, by year.
  const calvados = entry('orthophoto_1947_calvados');
  assert.equal(calvados.title, 'BD ORTHO® historique – Calvados');
  assert.equal(calvados.sub, 'departements');
  assert.deepEqual(calvados.layers.map((/** @type {any} */ l) => l.variant), ['1991', '1984', '1972', '1955', '1947']);
  // Towns and years (Édugéo): by town, then year.
  const towns = entry('ORTHOIMAGERY.EDUGEO.AJACCIO1975');
  assert.equal(towns.layers[0].variant, 'Ajaccio 1975');
  assert.equal(entry('GEOGRAPHICALGRIDSYSTEMS.EDUGEO.PARIS1964').layers.find((/** @type {any} */ l) => l.id.endsWith('PARIS1964')).variant, 'Paris 1964');
  // Overseas territories told apart in one series.
  assert.ok(entry('IGNF_MASQUE-CARTO-FORMATIONS-VEGETALES_2004').layers.some((/** @type {any} */ l) => l.variant === '2004 – Martinique'));
  // Two years in one title are not a series (« entre 1945 et 1970 » and « entre 1970 et 1990 »).
  assert.equal(entry('INSEE.FILOSOFI.PART.LOGEMENTS.CONSTRUITS.1945.1970.SECRET').layers.length, 1);
  // Within each series: variants all different, each layer once.
  for (const e of ENTRIES) {
    if (e.layers.length < 2) continue;
    const variants = e.layers.map(l => l.variant);
    assert.equal(new Set(variants).size, variants.length, `${e.title} : ${variants.join(' | ')}`);
    assert.ok(e.layers.every(l => l.cat === e.cat && l.sub === e.sub), e.title);
  }
});

test('règles : thèmes attendus, y compris quand l’identifiant trompe', () => {
  const place = (/** @type {string} */ id) => `${byId[id].cat}/${byId[id].sub}`;
  const expected = {
    'ORTHOIMAGERY.ORTHOPHOTOS': 'photos/actuelles',
    'ORTHOIMAGERY.ORTHOPHOTOS.1950-1965': 'photos/historiques',
    'ORTHOIMAGERY.ORTHO-SAT.SPOT.2020': 'photos/satellite',
    'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2': 'cartes/plans',
    'BNF-IGNF_GEOGRAPHICALGRIDSYSTEMS.CASSINI': 'cartes/historiques',
    'GEOGRAPHICALGRIDSYSTEMS.SLOPES.MOUNTAIN': 'relief/pentes',
    'ELEVATION.CONTOUR.LINE': 'relief/altitudes',
    'GEOGRAPHICALGRIDSYSTEM.DFCI': 'limites/grilles',
    'FORETS.PUBLIQUES': 'vegetation/forets',
    'LANDCOVER.HR.TCD.CLC15': 'vegetation/forets',
    'Patrinat_ZNIEFF1': 'nature/inventaires',
    'Patrinat_SIC': 'nature/natura2000',
    'Patrinat_PNR': 'nature/gestion',
    'INRA.CARTE.SOLS': 'sols/sols',
    'LANDCOVER.CLC18': 'occupation/corine',
    'LANDCOVER.HR.IMD.CLC15': 'occupation/corine',
    'TOURBIERES_ZONES-HUMIDES.BCAE': 'eau/humides',
    'PRAIRIES.SENSIBLES.BCAE': 'agriculture/pac',
    'LANDUSE.AGRICULTURE2020': 'agriculture/rpg',
    'CADASTRALPARCELS.PARCELLAIRE_EXPRESS': 'limites/cadastre',
    'CADASTRALPARCELS.HISTO.2008-2013.PARCELS': 'limites/cadastre',
    'CADASTRES.SOLAIRES.LOCAUX': 'energie/solaire',
    'POTENTIEL.HYDRO': 'energie/hydro',
    'ENR.PERIMETRE.PENTE': 'energie/contraintes',
    'ENR.GRANDS.SITES.FRANCE': 'nature/gestion',
    'TRANSPORTNETWORKS.ROADS.DIRECTION': 'transports/routes',
    'DEBROUSSAILLEMENT': 'risques/incendies',
    'COMMUNES.SISMICITE': 'risques/seismes',
    'ZZZ_Test_DINAMIS_formation_live': 'autres/essais'
  };
  assert.deepEqual(Object.fromEntries(Object.keys(expected).map(id => [id, place(id)])), expected);
  // Readable titles for the coded ones.
  assert.equal(byId.Patrinat_ZNIEFF1.label, 'ZNIEFF de type I');
  // A layer the rules do not know: placed by its keywords, else « Autres ».
  assert.deepEqual(classifyLayer({ id: 'XYZ.NOUVELLE', title: 'Couche nouvelle', kw: ['Forêts', 'Peuplements'] }), { cat: 'vegetation', sub: 'forets', label: '', source: '' });
  assert.equal(classifyLayer({ id: 'XYZ.INCONNUE', title: 'Une couche' }).cat, 'autres');
});

test('botanique : « Recommandées » réunit forêts, espaces protégés, sols, végétation, relief', () => {
  const reco = ENTRIES.filter(e => e.botany === 1);
  assert.ok(reco.length >= 12 && reco.length <= 30, `${reco.length} recommandées`);
  for (const id of ['FORETS.PUBLIQUES', 'LANDCOVER.FORESTINVENTORY.V2', 'Patrinat_ZNIEFF1', 'Patrinat_SIC', 'INRA.CARTE.SOLS', 'ELEVATION.CONTOUR.LINE', 'Carhab_habitat']) {
    assert.ok(reco.some(e => e.layers.some(l => l.id === id)), id);
  }
  // A series is recommended as one (any of its layers).
  assert.ok(reco.some(e => e.title.startsWith('BD ORTHO® infrarouge')));
  // Nothing from energy, statistics or tests.
  assert.ok(reco.every(e => !['energie', 'societe', 'autres'].includes(e.cat)));
});

test('recherche : sans accents, sur le titre, la description, la catégorie, les variantes', () => {
  const titles = (/** @type {string} */ q) => searchEntries(ENTRIES, q).map(e => e.title);
  assert.equal(fold('Forêts  Publiques'), 'forets publiques');
  assert.equal(titles('foret publique')[0], 'Forêts publiques');
  assert.ok(titles('ZNIEFF').slice(0, 2).every(t => t.startsWith('ZNIEFF')));
  // By category label (« Relief et altitude »), by a variant (a year, a town).
  assert.ok(titles('relief et altitude').includes('Courbes de niveau'));
  assert.ok(titles('ajaccio').includes('Photographies anciennes de villes (Édugéo)'));
  assert.ok(titles('rpg 2015').includes('Registre parcellaire graphique (RPG)'));
  assert.deepEqual(titles('aucune couche ne porte ce nom xyzzy'), []);
  assert.equal(searchEntries(ENTRIES, '  ').length, ENTRIES.length);
});

test('le fichier livré (format 2) se relit avec le même classement que le calcul', () => {
  assert.equal(FILE.version, 2);
  const read = layersOf(FILE);
  assert.equal(read.length, LAYERS.length);
  const key = (/** @type {any} */ l) => [l.id, l.cat, l.sub, l.group || '', l.gtitle || '', l.variant || '', l.botany || 0, l.label || ''].join('|');
  assert.deepEqual(read.map(key), LAYERS.map(key));
});
