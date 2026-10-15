// « Disposition libre » (app/layout): the grammar of a layout written in the address (grammar.js), what its cells are
// (registry.js: names in English or French, parameters checked, an unknown component a placeholder, never a throw;
// each cell's icon, mark and name in a phone's menu of columns, and how its columns look there), the live state beside
// it (state.js: plant, scope, search), and the router's route. A layout read and written back is the same; whatever is
// typed, something sound comes out, with what was wrong said in French.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../app/layout/grammar.js';
import { cellIcon, cellMark, cellName, COMPONENTS, distanceText, menuLooks, names, parseDistance, resolve, resolveTree } from '../../app/layout/registry.js';
import { cleanText, liveSearch, readLive, readQuery } from '../../app/layout/state.js';
import { PRESETS } from '../../app/layout/presets.js';
import { href, parse as route } from '../../app/core/router.js';
import { fromHash } from '../../app/core/query.js';
import { random } from './support/random.mjs';

/** A layout typed → its canonical text (resolved) and what was wrong. @param {string} text */
function read(text) {
  const p = G.parse(text);
  const r = resolveTree(p.tree);
  return { text: G.serialize(r.tree), errors: p.errors.map(e => e.message), problems: r.problems.map(x => x.message), tree: r.tree, cells: r.cells };
}

test('les exemples de la demande : colonnes, une colonne coupée en lignes, paramètres et blocs', () => {
  const a = read('[map:radius(20), search, fiche]');
  assert.equal(a.text, '[map(r=20km),search,plant]');
  assert.deepEqual([a.errors, a.problems], [[], []]);
  const b = read('[map:radius(20), search, [plant:wiki:categorie, plant:calendrier]]');
  assert.equal(b.text, '[map(r=20km),search,[plant.wikipedia,plant.calendar]]');
  assert.deepEqual(b.errors, []);
  assert.match(b.problems[0], /« categorie » ignoré/);
  assert.equal(G.dirAt(0), 'row');
  assert.equal(G.dirAt(1), 'col');
  assert.equal(/** @type {any} */ (G.nodeAt(b.tree, [2])).t, 'list', 'la 3e colonne est une liste de deux lignes');
});

test('crochets extérieurs facultatifs ; une liste seule en haut est la disposition ; [[a,b]] : une colonne de deux lignes', () => {
  assert.equal(read('map,search').text, '[map,search]');
  assert.equal(read('[map,search]').text, '[map,search]');
  const one = read('[[map,search]]');
  assert.equal(one.text, '[[map,search]]');
  assert.equal(one.tree.kids.length, 1);
  // A list of one cell inside another is the cell; its share kept.
  assert.equal(read('[map,[search]@30]').text, '[map,search@30]');
  // A list next to cells at the top: a column of rows.
  assert.equal(read('[map,search],plant').text, '[[map,search],plant]');
});

test('noms et valeurs en français ou en anglais, casse et accents indifférents ; écrits sous leur forme canonique', () => {
  assert.equal(read('Carte(Plan), RECHERCHE(filtres), Résultats(grille), Médias(mosaïque), Plante(scientifique)').text,
    '[map(base=plan),search(filters=1),results(view=grid),media(style=mosaic),plant(mode=scientific)]');
  assert.equal(read('[lieu(rayon=500 m),cartes,plant.Usages,plant.sosies,plant.repartition]').text,
    '[place(r=500m),deck,plant.uses,plant.lookalikes,plant.occurrences]');
  // A decimal comma (« 2,5 ») is one; between parameters, a comma or « ; ».
  assert.equal(read('map(r=2,5km;base=photo)').text, '[map(r=2.5km,base=photo)]');
  assert.equal(read('map(r=2.5km,base=photo)').text, '[map(r=2.5km,base=photo)]');
  assert.match(read('map(2km,5km)').problems[0], /donné deux fois/);
});

test('tailles : @n en %, les autres se partagent le reste ; écrites et relues', () => {
  const t = /** @type {G.ListNode} */ (G.parse('[map@60,search,plant]').tree);
  const sh = G.shares(t);
  assert.deepEqual(sh.map(x => Math.round(x * 100)), [60, 20, 20]);
  assert.deepEqual(G.shares(/** @type {G.ListNode} */ (G.parse('[a,b]').tree)).map(x => x * 2), [1, 1]);
  // Shares kept for it (a separator dragged) when the text gives none; the text's win otherwise.
  assert.deepEqual(G.shares(/** @type {G.ListNode} */ (G.parse('[a,b]').tree), [3, 1]).map(x => x * 4), [3, 1]);
  assert.deepEqual(G.shares(t, [1, 1, 1]).map(x => Math.round(x * 100)), [60, 20, 20]);
  // Over 100: each unnamed one the mean of those given.
  assert.deepEqual(G.shares(/** @type {G.ListNode} */ (G.parse('[a@80,b@40,c]').tree)).map(x => Math.round(x * 180)), [80, 40, 60]);
  assert.equal(read('[map@33.333,search@66,plant@1%]').text, '[map@33.3,search@66,plant@1]');
  const set = G.setShares(t, [], [1, 2, 1]);
  assert.equal(G.serialize(set), '[map@25,search@50,plant@25]');
  assert.equal(G.serialize(G.setShares(set, [], null)), '[map,search,plant]');
  assert.equal(G.shapeKey(set), '[map,search,plant]', 'la forme ne dépend ni des tailles ni des paramètres');
});

test('erreurs : jamais d’exception, la disposition lue au mieux et ce qui ne va pas dit (position comprise)', () => {
  const cases = [
    ['[map,search', '[map,search]', /Crochet fermant « \] » manquant/],
    ['[map,search]]', '[map,search]', /Crochet « \] » en trop/],
    ['map(r=2km,search', '[map(r=2km,search)]', /Parenthèse fermante/],
    ['[map,,search]', '[map,search]', null],
    ['[map search]', '[map,search]', /Virgule attendue/],
    ['[map,?,search]', '[map,search]', /Caractère « \? » inattendu/],
    ['[map@,search]', '[map,search]', /Taille attendue/],
    ['map(=plan)', '[map]', /sans nom/],
    ['[]', '[]', /Disposition vide/],
    ['', '[]', /Disposition vide/],
    ['[a,[b,[c,[d,[e,f]]]]]', '[a,[b,[c,[d,e,f]]]]', /Trop d’imbrication/]
  ];
  for (const [text, out, error] of cases) {
    const p = G.parse(text);
    assert.equal(G.serialize(p.tree), out, text);
    if (error) assert.ok(p.errors.some(e => /** @type {RegExp} */ (error).test(e.message)), `${text}: ${p.errors.map(e => e.message).join(' | ')}`);
    else assert.deepEqual(p.errors, [], text);
    for (const e of p.errors) assert.ok(e.at >= 0 && e.at <= text.length, `${text}: position ${e.at}`);
  }
  // Too many cells: the first MAX_CELLS kept.
  const many = G.parse(Array.from({ length: G.MAX_CELLS + 3 }, (_, i) => 'c' + i).join(','));
  assert.equal(G.cells(many.tree).length, G.MAX_CELLS);
  assert.ok(many.errors.some(e => /Trop de composants/.test(e.message)));
  // Percent-encoded (a link pasted): read as decoded; a stray « % » kept.
  assert.equal(G.serialize(G.parse('%5Bmap%2C%5Bsearch%2Cplant%5D%5D').tree), '[map,[search,plant]]');
  assert.equal(G.parse('map(%zz)').errors.length, 0);
});

test('composant inconnu : une case qui le dit et propose le plus proche ; paramètres et valeurs vérifiés', () => {
  const r = resolve(G.cell('mpa'));
  assert.equal(r.known, false);
  assert.equal(/** @type {any} */ (r).suggestion, 'map');
  assert.equal(/** @type {any} */ (resolve(G.cell('serch'))).suggestion, 'search');
  assert.equal(/** @type {any} */ (resolve(G.cell('zzzz'))).suggestion, null);
  assert.equal(read('[foo,map]').text, '[foo,map]', 'son nom reste, pour être corrigé');
  const bad = read('[map(r=loin,base=nuit,zoom=3),plant.inconnue,results(table),search(1,list=non)]');
  assert.equal(bad.text, '[map,plant,results(view=grid),search(filters=1,list=0)]');
  assert.deepEqual(bad.problems, [
    'Carte : « loin » n’est pas une valeur de rayon de la zone (attendu : une distance (500m, 2km)).',
    'Carte : « nuit » n’est pas une valeur de fond de carte (attendu : photo, plan).',
    'Carte : paramètre inconnu « zoom ».',
    'Fiche : bloc inconnu « inconnue » — la fiche entière est montrée.'
  ]);
  // Defaults, and the parameters given.
  const map = resolve(G.cell('map'));
  assert.ok(map.known && map.params.r === null && map.params.base === 'photo' && map.given.size === 0);
  const plant = resolve(G.cell('plant', 'calendrier'));
  assert.ok(plant.known && plant.view?.key === 'calendar' && plant.title === 'Calendrier');
});

test('distances : 500m, 2km, 2,5 km, un nombre seul en km ; bornées de 100 m à 50 km', () => {
  assert.equal(parseDistance('500m'), 500);
  assert.equal(parseDistance('2km'), 2000);
  assert.equal(parseDistance('2,5 km'), 2500);
  assert.equal(parseDistance('20'), 20000);
  assert.equal(parseDistance('5m'), 100);
  assert.equal(parseDistance('900'), 50000);
  assert.equal(parseDistance('loin'), null);
  assert.equal(distanceText(500), '500m');
  assert.equal(distanceText(2500), '2.5km');
  assert.equal(parseDistance(distanceText(1234)), 1200);
});

test('chaque nom du registre se lit, et les modèles sont des dispositions sans remarque', () => {
  for (const n of names()) {
    const r = read(n);
    assert.equal(r.text, '[' + n + ']', n);
    assert.deepEqual([...r.errors, ...r.problems], [], n);
  }
  assert.ok(COMPONENTS.every(c => c.title && c.icon && c.about && (c.reads.length || c.empty) && c.min.w > 0));
  for (const p of PRESETS) {
    const r = read(p.spec);
    assert.deepEqual([...r.errors, ...r.problems], [], p.id);
    assert.equal(r.text, p.spec, `${p.id} : écrit sous sa forme canonique`);
  }
});

test('le menu des colonnes (téléphone) : l’icône de chaque case, chaque bloc de la fiche le sien ; une présentation, un oui ou un non choisis, leur marque ; son nom entier', () => {
  /** A cell as typed → its icon, its mark (null: as by default), its whole name. @param {string} text */
  const look = text => { const r = resolve(G.parse(text).tree.kids[0]); const m = cellMark(r); return [cellIcon(r), m && m.short, cellName(r)]; };
  assert.deepEqual(look('map(r=5km)'), ['map', null, 'Carte'], 'un rayon n’est pas une marque : la zone est celle de toute la disposition');
  assert.deepEqual(look('plant'), ['card-text', null, 'Fiche']);
  // One block of the sheet: its own icon, finer than its rubric's — the statuses and the look-alikes, the four
  // encyclopedias, the sheet's map and the map, its photos and the photos' viewer: never alike.
  assert.deepEqual(look('plant.calendar'), ['flower1', null, 'Calendrier']);
  assert.deepEqual(look('plant.wikipedia'), ['wikipedia', null, 'Wikipédia']);
  assert.deepEqual(look('plant.literature'), ['journal-text', null, 'Publications (GBIF)']);
  assert.deepEqual(look('plant.status'), ['shield', null, 'Protection et statuts']);
  assert.deepEqual(look('plant.lookalikes'), ['exclamation-triangle-fill', null, 'Plantes à confondre']);
  assert.deepEqual(look('plant.mine'), ['collection', null, 'Mes collections']);
  // A block named as a component is: said as the sheet's.
  assert.deepEqual(look('plant.map'), ['pin-map', null, 'Fiche › Carte']);
  assert.deepEqual(look('plant.photos'), ['image', null, 'Fiche › Photos']);
  assert.deepEqual(look('plant.media'), ['film', null, 'Médias']);
  assert.deepEqual(look('mpa'), ['question-circle', null, 'mpa (inconnu)'], 'un composant inconnu : une question, son nom tel que tapé');
  const blocks = names().filter(n => n.startsWith('plant.'));
  const icons = blocks.map(n => look(n)[0]);
  assert.equal(new Set(icons).size, blocks.length, 'chaque bloc son icône');
  for (const [i, n] of blocks.entries()) assert.ok(!COMPONENTS.some(c => c.icon === icons[i]) && icons[i] !== 'question-circle', `${n} : ni l’icône d’un composant ni celle d’un inconnu`);
  // Three modes of the sheet told apart: one letter, two where another mode starts with it.
  assert.deepEqual(look('fiche(épuré)'), ['card-text', 'É', 'Fiche (Épuré)']);
  assert.deepEqual(look('plant(standard)'), ['card-text', 'St', 'Fiche (Standard)']);
  assert.deepEqual(look('plant(scientifique)'), ['card-text', 'Sc', 'Fiche (Scientifique)']);
  assert.deepEqual(look('plant.calendar(epure)'), ['flower1', 'É', 'Calendrier (Épuré)']);
  assert.deepEqual(look('results(liste)'), ['list-ul', 'L', 'Résultats (Liste)']);
  assert.deepEqual(look('results(view=grid)'), ['list-ul', 'G', 'Résultats (Grille)']);
  assert.deepEqual(look('results(view=auto)'), ['list-ul', null, 'Résultats'], 'la valeur par défaut, écrite : sans marque');
  assert.deepEqual(look('media(mosaic)'), ['images', 'M', 'Photos (Mosaïque)']);
  assert.deepEqual(look('map(base=plan)'), ['map', 'Pl', 'Carte (Plan IGN)']);
  assert.deepEqual(look('map(base=photo)'), ['map', null, 'Carte'], 'les photos, le fond par défaut : sans marque');
  // A yes or a no: its first letter, a no after a minus; two of them, both.
  assert.deepEqual(look('search(filters=1)'), ['search', 'F', 'Recherche (filtres ouverts)']);
  assert.deepEqual(look('search(list=0)'), ['search', '−L', 'Recherche (sans liste des résultats)']);
  assert.deepEqual(look('search(list=0,filters=1)'), ['search', 'F−L', 'Recherche (filtres ouverts, sans liste des résultats)']);
  assert.deepEqual(look('search(list=1)'), ['search', null, 'Recherche']);
  // Every cell has an icon of the sprite's (icons.js names them).
  for (const n of names()) assert.match(cellIcon(resolve(G.parse(n).tree.kids[0])), /^[a-z0-9-]+$/, n);
});

test('le menu des colonnes : une icône pareille montrée une fois, trois au plus et « +n » ; deux colonnes qui se ressembleraient encore, numérotées', () => {
  /** A layout's columns as the menu shows them. @param {string} text */
  const menu = text => {
    const { tree, cells } = resolveTree(G.parse(text).tree);
    /** @param {G.LayoutNode} n @param {number[]} path @returns {import('../../app/layout/registry.js').MenuCell[]} */
    const of = (n, path) => n.t === 'list' ? n.kids.flatMap((k, j) => of(k, [...path, j]))
      : [(r => ({ name: cellName(r), icon: cellIcon(r), mark: cellMark(r)?.short ?? null }))(/** @type {any} */ (cells.get(path.join('.'))))];
    return menuLooks(tree.kids.map((k, j) => of(k, [j]))).map(m => [m.glyphs.map(g => g.icon + (g.mark ?? '')).join(' '), m.more, m.nth, m.label]);
  };
  assert.deepEqual(menu('[map(r=2km),plant.map]'), [['map', 0, 0, 'Carte'], ['pin-map', 0, 0, 'Fiche › Carte']]);
  assert.deepEqual(menu('[search(list=0),search(filters=1)]'), [['search−L', 0, 0, 'Recherche (sans liste des résultats)'], ['searchF', 0, 0, 'Recherche (filtres ouverts)']]);
  // Alike in one column: once, the cells past the icons counted.
  assert.deepEqual(menu('[[plant.status,plant.status,plant.lookalikes],[map,map]]'), [
    ['shield exclamation-triangle-fill', 1, 0, 'Protection et statuts · Protection et statuts · Plantes à confondre'], ['map', 1, 0, 'Carte · Carte']]);
  assert.deepEqual(menu('[[plant.status,plant.lookalikes,plant.interactions,plant.climate]]'), [
    ['shield exclamation-triangle-fill bug', 1, 0, 'Protection et statuts · Plantes à confondre · Pollinisateurs et interactions · Climat et pollen']]);
  // What differs hidden past three icons: numbered (the same column twice, the same number).
  assert.deepEqual(menu('[[plant.name,plant.names,plant.ids,plant.uses],[plant.name,plant.names,plant.ids,plant.calendar],[plant.name,plant.names,plant.ids,plant.uses]]').map(m => m.slice(0, 3)), [
    ['tag translate hash', 1, 1], ['tag translate hash', 1, 2], ['tag translate hash', 1, 1]]);
});

/** A random layout (names of the registry, views, parameters, shares). @param {(n: number) => number} rnd @param {number} depth @returns {G.LayoutNode} */
function randomNode(rnd, depth) {
  if (depth < G.MAX_DEPTH && rnd(3) === 0) {
    const kids = Array.from({ length: 2 + rnd(2) }, () => randomNode(rnd, depth + 1));
    return G.list(kids, rnd(3) === 0 ? 10 + rnd(60) : null);
  }
  const all = names();
  const [name, view] = all[rnd(all.length)].split('.');
  const params = name === 'map' && rnd(2) ? [{ key: 'r', value: ['500m', '2km', '10km'][rnd(3)] }] : name === 'results' && rnd(2) ? [{ key: 'view', value: 'grid' }] : [];
  return G.cell(name, view ?? null, params, rnd(4) === 0 ? 5 + rnd(50) : null);
}

test('aller-retour : parse(serialize(t)) redonne t, pour 300 dispositions tirées au hasard', () => {
  const rnd = random(20261014);
  for (let n = 0; n < 300; n++) {
    const tree = G.normalize(G.list(Array.from({ length: 1 + rnd(4) }, () => randomNode(rnd, 1))));
    const text = G.serialize(tree);
    const back = G.parse(text);
    assert.deepEqual(back.errors, [], text);
    assert.deepEqual(G.strip(back.tree), G.strip(tree), text);
    assert.equal(G.serialize(back.tree), text);
    // Resolved (canonical) and written again: the same text.
    assert.equal(G.serialize(resolveTree(back.tree).tree), text, text);
  }
});

test('l’éditeur : une cellule à côté ou dessous, retirée, déplacée ; les bornes tenues', () => {
  let t = G.parse('[map,search]').tree;
  t = G.splitAt(t, [1], 'col', G.cell('plant'));
  assert.equal(G.serialize(t), '[map,[search,plant]]', 'dessous : la colonne devient deux lignes');
  t = G.splitAt(t, [1, 1], 'col', G.cell('media'));
  assert.equal(G.serialize(t), '[map,[search,plant,media]]', 'dessous dans une colonne : une ligne de plus');
  t = G.splitAt(t, [1, 1], 'row', G.cell('deck'));
  assert.equal(G.serialize(t), '[map,[search,[plant,deck],media]]', 'à côté dans une colonne : la ligne coupée en deux');
  t = G.splitAt(t, [0], 'row', G.cell('place'));
  assert.equal(G.serialize(t), '[map,place,[search,[plant,deck],media]]');
  t = G.moveAt(t, [1], -1);
  assert.equal(G.serialize(t), '[place,map,[search,[plant,deck],media]]');
  assert.equal(G.serialize(G.moveAt(t, [0], -1)), G.serialize(t), 'rien avant la première');
  t = G.removeAt(t, [2, 1, 0]);
  assert.equal(G.serialize(t), '[place,map,[search,deck,media]]', 'une ligne d’une seule cellule devient la cellule');
  t = G.replaceAt(t, [2, 1], G.cell('plant', 'wikipedia'));
  assert.equal(G.serialize(t), '[place,map,[search,plant.wikipedia,media]]');
  // A shared share is halved.
  assert.equal(G.serialize(G.splitAt(G.parse('[map@60,search@40]').tree, [0], 'row', G.cell('plant'))), '[map@30,plant@30,search@40]');
  // Bounds: no cell past MAX_CELLS, no list past MAX_DEPTH.
  const full = G.parse(Array.from({ length: G.MAX_CELLS }, () => 'map').join(',')).tree;
  assert.equal(G.splitAt(full, [0], 'row', G.cell('plant')), full);
  const deep = G.parse('[a,[b,[c,[d,e]]]]').tree;
  assert.equal(G.splitAt(deep, [1, 1, 1, 0], 'row', G.cell('f')), deep);
  assert.deepEqual(G.cells(G.removeAt(G.parse('[map]').tree, [0])), []);
});

test('l’état dans l’adresse : plante, zone, observation, recherche — lus et écrits, le reste ignoré', () => {
  const live = readLive('p=81541&at=48.85,2.35&r=1km&place=Paris%2010e&o=12345&q=ortie&family=Urticaceae');
  assert.deepEqual(live, { title: null, plant: 81541, at: [2.35, 48.85], r: 1000, place: 'Paris 10e', obs: '12345', periode: null });
  const query = readQuery('p=81541&q=ortie&family=Urticaceae&sort=sci');
  assert.equal(query.q, 'ortie');
  assert.deepEqual(query.filters.family, ['Urticaceae']);
  const search = liveSearch(live, query);
  assert.equal(search, 'p=81541&at=48.85000,2.35000&r=1km&place=Paris+10e&o=12345&q=ortie&family=Urticaceae&sort=sci');
  assert.deepEqual(readLive(search), live);
  // No scope: no radius written; a place without at= is one still to find (state.js): kept, with the radius said;
  // the default radius when the state has none.
  assert.equal(liveSearch({ title: null, plant: null, at: null, r: null, place: null, obs: null }, fromHash('#/')), '');
  assert.equal(liveSearch({ title: null, plant: null, at: null, r: 5000, place: 'X', obs: null }, fromHash('#/')), 'r=5km&place=X');
  assert.equal(liveSearch({ title: null, plant: null, at: [2, 48], r: null, place: null, obs: null }, fromHash('#/'), 500), 'at=48.00000,2.00000&r=500m');
  // Wrong values left out.
  const none = { title: null, plant: null, at: null, r: null, place: null, obs: null, periode: null };
  assert.deepEqual(readLive('p=abc&at=200,2&r=loin&o=<x>&periode=hier'), none);
  // The period every cell shows: read, written after the observation.
  const month = readLive('at=48.85,2.35&r=1km&periode=mois');
  assert.equal(month.periode, 'mois');
  assert.equal(liveSearch(month, fromHash('#/')), 'at=48.85000,2.35000&r=1km&periode=mois');
  assert.deepEqual(readLive('p=0&at=48.8'), none);
});

test('le titre et un lieu à trouver dans l’adresse : texte simple, une ligne, 80 caractères au plus, le titre écrit en premier', () => {
  const live = readLive('title=Orchid%C3%A9es%20de%20la%20colline%20de%20Mirabel&place=mirabel,%20menetrol,%2063&family=Orchidaceae');
  assert.deepEqual(live, { title: 'Orchidées de la colline de Mirabel', plant: null, at: null, r: null, place: 'mirabel, menetrol, 63', obs: null, periode: null });
  const query = readQuery('family=Orchidaceae');
  const search = liveSearch(live, query);
  assert.equal(search, 'title=Orchid%C3%A9es+de+la+colline+de+Mirabel&place=mirabel,+menetrol,+63&family=Orchidaceae');
  assert.deepEqual(readLive(search), live);
  // Found (state.js): at= and the label found replace the words, r= kept; the title still first.
  const found = { ...live, at: /** @type {[number, number]} */ ([3.1093, 45.8732]), place: 'Puy de Mirabel (Ménétrol)', r: 1000 };
  assert.equal(liveSearch(found, query), 'title=Orchid%C3%A9es+de+la+colline+de+Mirabel&at=45.87320,3.10930&r=1km&place=Puy+de+Mirabel+%28M%C3%A9n%C3%A9trol%29&family=Orchidaceae');
  // Spaces, lines and control characters folded; too long: cut; empty: none. Never HTML: kept as the text it is.
  assert.equal(readLive('title=%20%20Mes%0Aplantes%09%20').title, 'Mes plantes');
  assert.equal(readLive('title=' + 'a'.repeat(120)).title, 'a'.repeat(80));
  assert.equal(readLive('title=%20%20').title, null);
  assert.equal(readLive('title=' + encodeURIComponent('<b>Prés</b> & bois')).title, '<b>Prés</b> & bois');
  assert.equal(cleanText(' a\u0000b  '), 'a b');
});

test('le routeur : #/layout/<disposition>?<état>, aller-retour par href.layout', () => {
  const spec = '[map(r=2km),search,[plant.wikipedia,plant.calendar]]';
  const url = href.layout(spec, 'p=1&q=ortie');
  assert.equal(url, '#/layout/' + spec + '?p=1&q=ortie', 'crochets, parenthèses, = et @ restent lisibles');
  assert.deepEqual(route(url), { name: 'layout', spec, search: 'p=1&q=ortie' });
  assert.deepEqual(route('#/layout'), { name: 'layout', spec: '', search: '' });
  assert.deepEqual(route('#/layout/'), { name: 'layout', spec: '', search: '' });
  // What an address may not hold is encoded, and read back.
  const odd = href.layout('[carte(r=2 km),médias]');
  assert.equal(odd, '#/layout/[carte(r=2%20km),m%C3%A9dias]');
  assert.equal(read(/** @type {any} */ (route(odd)).spec).text, '[map(r=2km),media]');
});

test('le routeur : « Créer une app », #/builder[/<grille>][?g=<disposition>&<état>], aller-retour par href.builder', () => {
  assert.deepEqual(route('#/builder'), { name: 'builder', grid: null, spec: null, search: '' });
  assert.equal(href.builder(), '#/builder');
  // A layout with « + » and « & » in it, its state beside it.
  const spec = '[map(layers=znieff+n2000,lieu=A&B),slot]';
  const url = href.builder(spec, 'p=1&at=48.85,2.35');
  assert.equal(url, '#/builder?g=[map(layers%3Dznieff%2Bn2000,lieu%3DA%26B),slot]&p=1&at=48.85,2.35', 'crochets, parenthèses et @ lisibles ; = + & encodés');
  assert.deepEqual(route(url), { name: 'builder', grid: null, spec, search: 'p=1&at=48.85,2.35' });
  // The old links: a grid by its name; g= wins.
  assert.deepEqual(route('#/builder/trois'), { name: 'builder', grid: 'trois', spec: '[slot@30,slot@35,slot]', search: '' });
  assert.deepEqual(route('#/builder/trois?g=[slot,slot]&r=2km'), { name: 'builder', grid: 'trois', spec: '[slot,slot]', search: 'r=2km' });
  assert.deepEqual(route('#/builder/inconnue'), { name: 'builder', grid: 'inconnue', spec: null, search: '' });
});
