// « Disposition libre » : the map cell's settings (registry.js `map`, map-options.js), written in the layout's
// grammar. Each parameter read (its words, its values' other spellings, French, accents folded), a bare value given to
// the parameter that reads it (a distance, an intent, a background, a word for 3D or 2D, a list of layers), a list's
// unknown words said and left out, an intent's bundle with a setting written beside it winning, and the address
// written back short: the intent first, alone, then only what it does not give. Its marks in a phone's menu. The
// layers' overlays, the dates a period keeps, the controls by width.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../app/layout/grammar.js';
import { cellMark, cellName, resolve, resolveTree, withParam } from '../../app/layout/registry.js';
import { MAP_CONTROLS, MAP_INTENTS, MAP_LAYERS, catalogLayers, defaultControls, inWhen, mapControls, overlaysOf, snapRadius, uiMode } from '../../app/layout/map-options.js';

/** A layout typed → its canonical text and what was wrong. @param {string} text */
function read(text) {
  const r = resolveTree(G.parse(text).tree);
  return { text: G.serialize(r.tree), problems: r.problems.map(x => x.message), cell: /** @type {any} */ (r.cells.get('0')) };
}
/** A map cell's settings as resolved. @param {string} text */
const params = text => read(text).cell.params;

test('chaque réglage de la carte se lit : ses noms, ses valeurs, leurs autres graphies', () => {
  const p = params('map(r=2km;lieu=Mirabel Ménétrol 63;autour=1;base=photo;3d=1;layers=znieff+n2000;src=inat+gbif;when=mois;pts=pastille;regroupe=1;suit=0;plante=seule;toucher=fiche;ui=nue)');
  assert.deepEqual(p, { intent: 'explorer', portee: 'zone', r: 2000, lieu: 'Mirabel Ménétrol 63', autour: true, base: 'photo', annee: null, '3d': true, layers: ['znieff', 'n2000'], src: ['inat', 'gbif'],
    when: 'mois', pts: 'pastille', regroupe: true, suit: false, plante: 'seule', toucher: 'fiche', liste: 'vue', ui: 'nue', tete: 'oui', titre: null, actions: [], ctl: null,
    vue: null, opac: null, jumelles: null, jrayon: null, legende: false, etat: 'ouvert', groupe: 'a' });
  // In French, its other words, accents and case free.
  const q = params('carte(rayon=500m;commune=Fontainebleau 77;moi=oui;fond=satellite;vue3d=non;couches=Natura+ZNIEFF1;sources=iNaturalist;période=Année;style=Pastilles;groupes=1;recherche=non;courante=only;tap=sheet;commandes=Compact)');
  assert.deepEqual([q.r, q.lieu, q.autour, q.base, q['3d'], q.layers, q.src, q.when, q.pts, q.regroupe, q.suit, q.plante, q.toucher, q.ui],
    [500, 'Fontainebleau 77', true, 'spot', false, ['n2000', 'znieff1'], ['inat'], 'annee', 'pastille', true, false, 'seule', 'fiche', 'compacte']);
  // Defaults: the map as it always was — its background, its layers and its 2D or 3D, the maps' common ones (none written).
  const d = params('map');
  assert.deepEqual(d, { intent: 'explorer', portee: 'zone', r: null, lieu: null, autour: false, base: null, annee: null, '3d': null, layers: null, src: null, when: 'toujours', pts: 'photo',
    regroupe: false, suit: true, plante: 'grand', toucher: 'plante', liste: 'vue', ui: 'auto', tete: 'oui', titre: null, actions: [], ctl: null,
    vue: null, opac: null, jumelles: null, jrayon: null, legende: false, etat: 'ouvert', groupe: 'a' });
  assert.equal(read('map').text, '[map]');
});

test('une valeur seule va au réglage qui la lit : une distance, une intention, un fond, 3d ou 2d, des couches, une période…', () => {
  const cases = [
    ['map(20km)', '[map(r=20km)]'], ['map(20)', '[map(r=20km)]'], ['map(photo)', '[map(base=photo)]'], ['map(plan)', '[map(base=plan)]'],
    ['map(satellite)', '[map(base=spot)]'], ['map(spot)', '[map(base=spot)]'],
    ['map(terrain)', '[map(terrain)]'], ['map(Protégé)', '[map(protege)]'], ['map(répartition)', '[map(repartition)]'], ['map(floraison)', '[map(floraison)]'],
    ['map(relief)', '[map(relief)]'], ['map(3d)', '[map(3d=1)]'], ['map(2D)', '[map(3d=0)]'], ['map(autour)', '[map(autour=1)]'], ['map(regroupe)', '[map(regroupe=1)]'],
    ['map(znieff+n2000)', '[map(layers=znieff+n2000)]'], ['map(cadastre)', '[map(layers=cadastre)]'], ['map(gbif)', '[map(src=gbif)]'],
    ['map(mois)', '[map(when=mois)]'], ['map(pastille)', '[map(pts=pastille)]'], ['map(seule)', '[map(plante=seule)]'], ['map(fiche)', '[map(toucher=fiche)]'],
    ['map(rien)', '[map(toucher=rien)]'], ['map(nue)', '[map(ui=nue)]'], ['map(compacte)', '[map(ui=compacte)]'], ['map(explorer)', '[map]']
  ];
  for (const [typed, written] of cases) {
    const r = read(typed);
    assert.equal(r.text, written, typed);
    assert.deepEqual(r.problems, [], typed);
  }
});

test('des couches : leurs noms courts et leurs alias, chacune une fois dans l’ordre écrit (la dernière dessus) ; une inconnue dite et laissée', () => {
  assert.equal(read('map(layers=reserves+natura2000+znieff+n2000)').text, '[map(layers=reserves+n2000+znieff)]');
  assert.equal(read('map(layers=APPB+forêts+contours+ombrage+rivières+parcelles)').text, '[map(layers=biotopes+forets+courbes+estompage+hydro+cadastre)]');
  const bad = read('map(layers=znieff+lune+mer)');
  assert.equal(bad.text, '[map(layers=znieff)]');
  assert.equal(bad.problems.length, 2);
  assert.match(bad.problems[0], /^Carte : « lune » n’est pas une valeur de couches \(attendu : znieff, znieff1, .*, joints par « \+ »\)\.$/);
  assert.match(bad.problems[1], /« mer »/);
  // All unknown: none kept, the default holds (the maps' common layers).
  const none = read('map(layers=lune)');
  assert.equal(none.text, '[map]');
  assert.equal(none.cell.params.layers, null);
  // A bare list with an unknown word: the list still, the word said.
  const bare = read('map(znieff+foo)');
  assert.equal(bare.text, '[map(layers=znieff)]');
  assert.match(bare.problems[0], /« foo » n’est pas une valeur de couches/);
  // « aucune »: none, written so (it overrides an intent's, and the maps' common layers: not the default).
  assert.equal(read('map(protege;layers=aucune)').text, '[map(protege,layers=aucune)]');
  assert.deepEqual(params('map(protege;layers=aucune)').layers, []);
  assert.equal(read('map(layers=aucune)').text, '[map(layers=aucune)]');
  assert.deepEqual(params('map(couches=rien)').layers, []);
  // Every layer's overlays: the app's own or the catalogue's (added before they show).
  for (const [name, l] of Object.entries(MAP_LAYERS)) {
    assert.ok(l.keys.length, name);
    for (const k of l.keys) assert.ok(!k.startsWith('ign:') || (l.catalog ?? []).some(c => 'ign:' + c.id === k), `${name} : ${k} au catalogue`);
  }
  assert.deepEqual(overlaysOf(['znieff', 'znieff1', 'parcs']), ['ign:Patrinat_ZNIEFF1', 'ign:Patrinat_ZNIEFF2', 'parcs']);
  assert.deepEqual(catalogLayers(['n2000', 'parcs']).map(l => l.id), ['Patrinat_SIC', 'Patrinat_ZPS']);
});

test('les valeurs inconnues dites et laissées : le défaut tient', () => {
  const r = read('map(base=nuit;when=hier;pts=carré;toucher=mordre;ui=géante;plante=petite;suit=peut-être;3d=4d;lieu=;zoom=3)');
  assert.equal(r.text, '[map]');
  assert.deepEqual(r.problems, [
    'Carte : « nuit » n’est pas une valeur de fond de carte (attendu : photo, plan, spot).',
    'Carte : « hier » n’est pas une valeur de période (attendu : toujours, annee, mois).',
    'Carte : « carré » n’est pas une valeur de style des points (attendu : photo, pastille).',
    'Carte : « mordre » n’est pas une valeur de toucher un point (attendu : plante, fiche, rien).',
    'Carte : « géante » n’est pas une valeur de commandes (attendu : auto, complete, compacte, nue).',
    'Carte : « petite » n’est pas une valeur de plante courante (attendu : grand, seule, non).',
    'Carte : « peut-être » n’est pas une valeur de suit la recherche (attendu : oui ou non (1, 0)).',
    'Carte : « 4d » n’est pas une valeur de vue 3d (attendu : oui ou non (1, 0)).',
    'Carte : paramètre inconnu « zoom ».'
  ]);
  assert.match(read('map(intent=balade2)').problems[0], /« balade2 » n’est pas une valeur d?e? ?intention/);
});

test('le fond d’une année : base= (satellite lu spot) et annee= — une année, une période, des photos historiques, SPOT ; ce que le fond n’a pas, dit et laissé', () => {
  const p = params('map(base=spot;annee=2020)');
  assert.deepEqual([p.base, p.annee], ['spot', '2020']);
  assert.equal(read('carte(fond=Satellite;an=2020)').text, '[map(base=spot,annee=2020)]');
  assert.equal(read('map(sat)').text, '[map(base=spot)]');
  assert.equal(read('map(base=ortho;millesime=2016-2020)').text, '[map(base=photo,annee=2016-2020)]');
  // Alone: the photos' year or period (whatever the dash), the historical ones; a year only SPOT has, SPOT's.
  assert.equal(read('map(annee=2016–2020)').text, '[map(annee=2016-2020)]');
  assert.equal(read('map(annee=1950-1965)').text, '[map(annee=1950-1965)]');
  assert.deepEqual(read('map(annee=2025)').problems, []);
  // SPOT's latest year: SPOT alone (its default; a newer year will be « spot » then).
  assert.equal(read('map(base=spot,annee=2025)').text, '[map(base=spot)]');
  // A year that background has not, the plan with a year: said, left out (the background kept).
  const spot2010 = read('map(base=spot,annee=2010)');
  assert.equal(spot2010.text, '[map(base=spot)]');
  assert.deepEqual(spot2010.problems, ['Carte : pas d’images SPOT pour 2010.']);
  assert.deepEqual(read('map(base=photo,annee=2025)').problems, ['Carte : pas de photos aériennes pour 2025.']);
  const plan = read('map(plan,annee=2020)');
  assert.equal(plan.text, '[map(base=plan)]');
  assert.deepEqual(plan.problems, ['Carte : le plan IGN n’a pas d’année.']);
  const bad = read('map(annee=1999)');
  assert.equal(bad.text, '[map]');
  assert.match(bad.problems[0], /^Carte : « 1999 » n’est pas une valeur de date du fond \(attendu : une année des photos \(2000 à 2024\) ou de SPOT \(2013 à 2025\), une période/);
  // Never a bare value: map(2020) is a radius (50 km at most), map(annee) the period of the points.
  assert.equal(read('map(2020)').text, '[map(r=50km)]');
  assert.equal(read('map(annee)').text, '[map(when=annee)]');
  // Its name in the menu of columns: the background said once, whole — its kind too when only annee= is written.
  const name = (/** @type {string} */ text) => cellName(resolve(/** @type {any} */ (G.parse(text).tree.kids[0])));
  assert.equal(name('map(base=spot,annee=2020)'), 'Carte (Images satellite SPOT de 2020)');
  assert.equal(name('map(base=spot)'), 'Carte (Satellite (SPOT))');
  assert.equal(name('map(base=spot,annee=2025)'), 'Carte (Satellite (SPOT))', 'sa dernière année : SPOT seul');
  assert.equal(name('map(annee=2016-2020)'), 'Carte (Photos aériennes de 2016 à 2020)');
  assert.equal(name('map(annee=2025)'), 'Carte (Images satellite SPOT de 2025)', 'une année que seul SPOT a : SPOT');
  assert.equal(name('map(annee=1950-1965)'), 'Carte (Photos aériennes historiques de 1950 à 1965)');
  assert.equal(name('map(terrain,annee=2020)'), 'Carte (Sur le terrain, Photos aériennes de 2020)', 'le fond de l’intention, son année');
  assert.equal(name('map(base=photo;annee=2020;3d=1)'), 'Carte (Photos aériennes de 2020, vue 3D)');
  // Written by the cell (withParam, the background first): SPOT's latest left out, null back to the most recent.
  const cell = /** @type {any} */ (G.parse('map(r=2km)').tree.kids[0]);
  const set = (/** @type {any} */ c, /** @type {Record<string, unknown>} */ values) => Object.entries(values).reduce((n, [k, v]) => withParam(n, k, v), c);
  const text = (/** @type {any} */ c) => G.serialize({ t: 'list', kids: [c], size: null });
  assert.equal(text(set(cell, { base: 'spot', annee: '2020' })), '[map(r=2km,base=spot,annee=2020)]');
  assert.equal(text(set(cell, { base: 'spot', annee: '2025' })), '[map(r=2km,base=spot)]');
  assert.equal(text(set(set(cell, { base: 'photo', annee: '2016-2020' }), { base: 'plan', annee: null })), '[map(r=2km,base=plan)]');
  assert.equal(text(set(set(cell, { base: 'photo', annee: '2016-2020' }), { base: null, annee: null })), '[map(r=2km)]');
});

test('une année puis la 3D : l’adresse réécrite se relit telle quelle (jamais « 2020,3d » lu comme un nombre à virgule)', () => {
  /** A layout typed, then its canonical text read again: the same text, no error, its year and its 3D kept. @param {string} typed */
  const twice = typed => {
    const once = read(typed);
    const again = G.parse(once.text);
    return { text: once.text, errors: again.errors.map(e => e.message), back: read(once.text).text, cell: read(once.text).cell.params };
  };
  for (const [typed, annee, d3] of /** @type {[string, string, boolean][]} */ ([
    ['[map(base=spot,3d=1,annee=2020),results]', '2020', true], ['[map(3d=0,annee=1950-1965)]', '1950-1965', false], ['[map(2d;base=photo;annee=2016-2020)]', '2016-2020', false]
  ])) {
    const t = twice(typed);
    assert.deepEqual(t.errors, [], t.text);
    assert.equal(t.back, t.text, typed);
    assert.deepEqual([t.cell.annee, t.cell['3d']], [annee, d3], typed);
  }
  // The cell's own « 3D » (withParam, then the whole layout written as gf-layout writes it): read back whole.
  const cell = /** @type {any} */ (G.parse('[map(base=spot,annee=2020)]').tree.kids[0]);
  const written = G.serialize({ t: 'list', kids: [withParam(cell, '3d', true)], size: null });
  assert.equal(written, '[map(base=spot,annee=2020;3d=1)]');
  assert.deepEqual(G.parse(written).errors, []);
  assert.deepEqual([read(written).cell.params.annee, read(written).cell.params['3d']], ['2020', true]);
});

test('les intentions : un mot, un ensemble de réglages ; un réglage écrit à côté, avant ou après, l’emporte ; l’adresse reste courte', () => {
  const t = params('map(terrain)');
  assert.deepEqual([t.base, t.ui, t.autour], ['photo', 'compacte', true]);
  const f = params('map(floraison)');
  assert.deepEqual([f.when, f.regroupe], ['mois', true]);
  assert.deepEqual(params('map(protégé)').layers, ['znieff', 'n2000', 'parcs', 'reserves', 'biotopes']);
  const rep = params('map(répartition)');
  assert.deepEqual([rep.src, rep.suit, rep.plante, rep.liste], [['inat', 'gbif'], false, 'seule', 'zone']);
  assert.equal(params('map(relief)')['3d'], true);
  // Overrides, wherever written.
  assert.equal(params('map(terrain;base=plan)').base, 'plan');
  assert.equal(params('map(base=plan;terrain)').base, 'plan');
  assert.equal(read('map(base=plan;terrain)').text, '[map(terrain,base=plan)]');
  // What the intent gives, written again: left out.
  assert.equal(read('map(terrain;base=photo;ui=compacte;r=2km)').text, '[map(terrain,r=2km)]');
  assert.equal(read('carte(R=2km ; Terrain)').text, '[map(terrain,r=2km)]');
  // Named, and in its French words.
  assert.equal(read('map(intention=Floraison)').text, '[map(floraison)]');
  assert.equal(read('map(usage=balade)').text, '[map(terrain)]');
  // Two intents: the last counts, said.
  const two = read('map(terrain;protege)');
  assert.equal(two.text, '[map(protege)]');
  assert.match(two.problems[0], /intention donné deux fois/);
  assert.deepEqual(two.cell.params.layers, ['znieff', 'n2000', 'parcs', 'reserves', 'biotopes']);
  // Every intent reads its own bundle without a remark, and round-trips.
  for (const name of Object.keys(MAP_INTENTS)) {
    const r = read(`map(${name})`);
    assert.deepEqual(r.problems, [], name);
    assert.equal(read(r.text).text, r.text, name);
    for (const [k, v] of Object.entries(MAP_INTENTS[name].set)) assert.ok(r.cell.implied.has(k), `${name} : ${k}=${v}`);
  }
});

test('la liste (liste=) : ce que montre la carte par défaut, toute la zone écrite ; jamais pour un mot seul (map(zone) reste l’étendue)', () => {
  assert.equal(params('map').liste, 'vue');
  assert.equal(read('map(liste=zone)').text, '[map(liste=zone)]');
  assert.equal(read(read('map(liste=zone)').text).text, '[map(liste=zone)]');
  assert.equal(read('carte(liste=Toute)').text, '[map(liste=zone)]');
  // Its default written: kept as written.
  assert.equal(read('map(liste=vue)').text, '[map(liste=vue)]');
  assert.deepEqual(read('map(liste=vue)').problems, []);
  // A bare « zone »: the reach, never the list.
  assert.equal(read('map(zone)').text, '[map(portee=zone)]');
  assert.equal(params('map(zone)').liste, 'vue');
});

test('l’adresse réécrite se relit à l’identique (aller-retour), dans l’ordre des groupes', () => {
  // Its words last: « Fontainebleau 77,3d=1 » would read a decimal comma.
  const written = '[map(terrain,r=2km,3d=1,layers=forets+znieff,src=inat+gbif,when=annee,pts=pastille,regroupe=1,suit=0,plante=non,toucher=rien,ui=nue,lieu=Fontainebleau 77)]';
  const typed = 'map(ui=nue;toucher=rien;plante=non;suit=0;regroupe;pastille;annee;src=gbif+inat;layers=forets+znieff;3d;lieu=Fontainebleau 77;r=2km;terrain)';
  assert.equal(read(typed).text, written);
  assert.equal(read(written).text, written);
  assert.deepEqual(read(written).problems, []);
});

test('les marques de la carte (menu des colonnes) : l’intention, puis ce qui en diffère', () => {
  const mark = (/** @type {string} */ t) => { const m = cellMark(resolve(G.parse(t).tree.kids[0])); return m && [m.short, m.label]; };
  assert.deepEqual(mark('map(terrain)'), ['S', 'Sur le terrain']);
  assert.deepEqual(mark('map(terrain;base=photo)'), ['S', 'Sur le terrain'], 'ce que l’intention donne : pas de marque');
  assert.deepEqual(mark('map(terrain;base=plan)'), ['SPl', 'Sur le terrain, Plan IGN']);
  assert.deepEqual(mark('map(3d)'), ['3D', 'vue 3D']);
  assert.deepEqual(mark('map(2d)'), ['−3D', 'sans vue 3D']);
  assert.deepEqual(mark('map(layers=znieff)'), ['C', 'couches : ZNIEFF (types I et II)']);
  assert.equal(mark('map(lieu=Paris;r=2km)'), null, 'un lieu et un rayon : la zone, pas une présentation');
  assert.equal(mark('map(explorer)'), null);
});

test('la période, les commandes selon la largeur', () => {
  const now = new Date(2026, 9, 14);
  assert.equal(inWhen('2026-10-02', 'mois', now), true);
  assert.equal(inWhen('2019-10-30', 'mois', now), true, 'ce mois-ci, toutes années : ce qui fleurit maintenant');
  assert.equal(inWhen('2026-05-02', 'mois', now), false);
  assert.equal(inWhen('2026-05-02', 'annee', now), true);
  assert.equal(inWhen('2025-10-02', 'annee', now), false);
  assert.equal(inWhen(null, 'annee', now), false);
  assert.equal(inWhen(null, 'toujours', now), true);
  assert.equal(uiMode('auto', 300), 'compacte');
  assert.equal(uiMode('auto', 800), 'complete');
  assert.equal(uiMode('auto'), 'complete', 'largeur inconnue : complètes');
  assert.equal(uiMode('nue', 800), 'nue');
  assert.equal(uiMode(null, 359), 'compacte');
});

test('les commandes sur la carte (ctl=) : lues, dans l’ordre de l’adresse ; écrites seulement quand elles diffèrent de celles de ui et de l’intention', () => {
  // Read in their order, aliases and French words free; an unknown one said and left out.
  assert.deepEqual(params('map(ctl=zoom+compte+Zone+légende)').ctl, ['rayon', 'compte', 'legende', 'zoom']);
  assert.deepEqual(params('map(boutons=calques+compteur)').ctl, ['couches', 'compte']);
  const bad = read('map(ctl=zoom+boussole)');
  assert.equal(bad.text, '[map(ctl=zoom)]');
  assert.match(bad.problems[0], /« boussole » n’est pas une valeur de commandes sur la carte \(attendu : rayon, lieu, gps, couches, 3d, fond, plante, periode, compte, legende, zoom, joints par « \+ »\)/);
  // None: written so (ctl=aucune), the map bare whatever its ui.
  assert.equal(read('map(ctl=aucune)').text, '[map(ctl=aucune)]');
  assert.deepEqual(params('map(ctl=aucune)').ctl, []);
  // Never a bare value: map(zoom) is not ctl=zoom; map(3d), map(gps) keep their own settings.
  assert.equal(read('map(3d)').text, '[map(3d=1)]');
  assert.equal(read('map(gps)').text, '[map(autour=1)]');
  assert.match(read('map(compte)').problems[0], /valeur « compte »|n’est pas une valeur/);
  // The defaults: complete (auto too), compact without the address search, none; each intent adds its own.
  assert.deepEqual(defaultControls('complete'), ['rayon', 'lieu', 'gps', 'couches', '3d', 'plante', 'compte', 'zoom']);
  assert.deepEqual(defaultControls('auto'), defaultControls('complete'));
  assert.deepEqual(defaultControls('compacte'), ['rayon', 'gps', 'couches', '3d', 'plante', 'compte', 'zoom']);
  assert.deepEqual(defaultControls('nue', 'floraison'), []);
  assert.deepEqual(defaultControls('auto', 'floraison'), ['rayon', 'lieu', 'gps', 'couches', '3d', 'plante', 'periode', 'compte', 'zoom']);
  assert.deepEqual(defaultControls('auto', 'protege').filter(c => !defaultControls('auto').includes(c)), ['legende']);
  assert.deepEqual(defaultControls('compacte', 'terrain'), defaultControls('compacte'), 'terrain : « Me localiser » (en grand) est déjà là');
  // Written as the default gives them: left out; otherwise kept, whole (the exact set).
  assert.equal(read('map(ctl=rayon+lieu+gps+couches+3d+plante+compte+zoom)').text, '[map]');
  assert.equal(read('map(ui=nue;ctl=aucune)').text, '[map(ui=nue)]');
  assert.equal(read('map(floraison;ctl=rayon+lieu+gps+couches+3d+plante+periode+compte+zoom)').text, '[map(floraison)]');
  assert.equal(read('map(floraison;ctl=rayon+lieu+gps+couches+3d+plante+compte+zoom)').text, '[map(floraison,ctl=rayon+lieu+gps+couches+3d+plante+compte+zoom)]');
  assert.equal(read('map(ui=compacte;ctl=rayon+gps+couches+3d+plante+compte+zoom)').text, '[map(ui=compacte)]');
  assert.equal(read('map(ctl=zoom+fond;ui=nue)').text, '[map(ui=nue,ctl=fond+zoom)]');
  // Round trip, every control.
  const all = `[map(ctl=${Object.keys(MAP_CONTROLS).join('+')})]`;
  assert.equal(read(all).text, all);
  assert.deepEqual(read(all).problems, []);
  // Its mark: only when it differs from the default.
  const mark = (/** @type {string} */ t) => cellMark(resolve(G.parse(t).tree.kids[0]))?.short ?? null;
  assert.equal(mark('map(ctl=rayon+lieu+gps+couches+3d+plante+compte+zoom)'), null);
  assert.equal(mark('map(ctl=zoom)'), 'Ct');
});

test('les commandes dessinées : ctl tel quel, sinon selon ui (auto : la largeur) et l’intention', () => {
  const on = (/** @type {any} */ p, w = 0) => [...mapControls(p, w).on];
  assert.deepEqual(on({ ui: 'auto' }, 800), defaultControls('complete'));
  assert.deepEqual(on({ ui: 'auto' }, 300), defaultControls('compacte'));
  assert.equal(mapControls({ ui: 'auto' }, 300).compact, true);
  assert.equal(mapControls({ ui: 'auto' }, 800).compact, false);
  assert.deepEqual(on({ ui: 'auto', intent: 'floraison' }, 800).includes('periode'), true);
  assert.deepEqual(on({ ui: 'nue' }), []);
  assert.deepEqual(on({ ui: 'auto', ctl: ['zoom'] }, 300), ['zoom'], 'ctl : exactement ces commandes');
  assert.deepEqual(on({ ui: 'nue', ctl: ['compte'] }), ['compte']);
});

test('la poignée du rayon : aimantée aux crans du curseur à quelques % près, sinon arrondie, entre 100 m et 50 km', () => {
  const stops = [200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
  assert.equal(snapRadius(2080, stops), 2000);
  assert.equal(snapRadius(1910, stops), 2000);
  assert.equal(snapRadius(2300, stops), 2300);
  assert.equal(snapRadius(3456, stops), 3500);
  assert.equal(snapRadius(734, stops), 730);
  assert.equal(snapRadius(40, stops), 100);
  assert.equal(snapRadius(90_000, stops), 50_000);
  assert.equal(snapRadius(48_000, stops), 50_000);
});
