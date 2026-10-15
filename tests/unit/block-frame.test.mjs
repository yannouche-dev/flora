// « Disposition libre » : the frame every cell shares (registry.js#FRAME) — its head (tete, titre), the actions of its
// head, its empty state, its links (plante, zone, toucher, ecrit) — read in French and English, accents and case free,
// written back after the component's own parameters, never when default, in a stable order; which component honours
// which (FRAME_OF: never a setting that does nothing), and what touching a plant does (touchOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../app/layout/grammar.js';
import { COMPONENTS, FRAME_OF, cellMark, cellName, resolve, resolveTree, touchOf } from '../../app/layout/registry.js';

/** A layout typed → its canonical text, what was wrong, its first cell. @param {string} text */
function read(text) {
  const r = resolveTree(G.parse(text).tree);
  return { text: G.serialize(r.tree), problems: r.problems.map(x => x.message), cell: /** @type {any} */ (r.cells.get('0')) };
}

test('chaque composant a l’en-tête, le titre et les actions ; vide, plante, zone, toucher, ecrit seulement là où ils font quelque chose', () => {
  const frame = Object.fromEntries(COMPONENTS.map(c => [c.id, Object.keys(c.params).filter(k => c.params[k].frame)]));
  assert.deepEqual(frame, {
    map: ['tete', 'titre', 'actions', 'etat'], search: ['tete', 'titre', 'actions', 'etat', 'toucher', 'ecrit'], filters: ['tete', 'titre', 'actions', 'etat'],
    results: ['tete', 'titre', 'actions', 'etat', 'vide', 'zone', 'toucher', 'ecrit'], plant: ['tete', 'titre', 'actions', 'etat', 'vide', 'plante', 'toucher', 'ecrit'],
    media: ['tete', 'titre', 'actions', 'etat', 'vide', 'plante'], deck: ['tete', 'titre', 'actions', 'etat', 'vide', 'toucher', 'ecrit'], place: ['tete', 'titre', 'actions', 'etat'],
    slot: ['tete', 'titre', 'actions', 'etat']
  });
  assert.deepEqual(Object.keys(FRAME_OF).sort(), COMPONENTS.map(c => c.id).sort());
  // The frame after the component's own, grouped « Cadre » then « Liens ».
  for (const c of COMPONENTS) {
    const keys = Object.keys(c.params);
    const first = keys.findIndex(k => c.params[k].frame);
    assert.ok(keys.slice(first).every(k => c.params[k].frame), c.id);
    assert.ok(keys.filter(k => c.params[k].frame).every(k => ['Cadre', 'Liens'].includes(/** @type {string} */ (c.params[k].group))), c.id);
  }
  // The map keeps its own links (suit, plante, toucher): untouched.
  const map = read('map(plante=seule,toucher=fiche)').cell;
  assert.equal(map.params.plante, 'seule');
  assert.equal(map.params.toucher, 'fiche');
  assert.equal(touchOf(map), null);
});

test('les défauts : rien ne change (en-tête complet, pas d’action, un message, la plante courante, la zone, toucher choisit)', () => {
  for (const name of ['map', 'search', 'filters', 'results', 'plant', 'plant.wikipedia', 'media', 'deck', 'place']) {
    const { cell, text } = read(name);
    assert.equal(cell.params.tete, 'oui', name);
    assert.equal(cell.params.titre, null, name);
    assert.deepEqual(cell.params.actions, [], name);
    if ('vide' in cell.params) assert.equal(cell.params.vide, 'message', name);
    if ('plante' in cell.params && name !== 'map') assert.equal(cell.params.plante, null, name);
    if ('zone' in cell.params) assert.equal(cell.params.zone, true, name);
    assert.equal(text, `[${name}]`);
  }
});

test('lus en français, accents et casse indifférents ; écrits après les paramètres du composant, dans un ordre stable', () => {
  const cases = [
    ['plant.wikipedia(Entête=simple;Titre=Mon article 2;actions=Agrandir+partager;vide=masqué;plante=128268)', '[plant.wikipedia(tete=simple,actions=agrandir+partager,vide=masque,plante=128268,titre=Mon article 2)]'],
    ['plant(titre=Ma fiche;mode=epure;head=none)', '[plant(mode=epure,tete=non,titre=Ma fiche)]'],
    ['results(france,grille,tap=sheet,écrire=non)', '[results(view=grid,zone=0,toucher=fiche,ecrit=0)]'],
    ['results(zone=non)', '[results(zone=0)]'],
    ['media(123)', '[media(plante=123)]'],
    ['deck(masquée)', '[deck(vide=masque)]'],
    ['deck(caché)', '[deck(vide=masque)]'],
    ['search(en-tête=aucun;boutons=plein écran+replier)', '[search(tete=non,actions=agrandir+replier)]'],
    ['carte(r=2km;bandeau=titre seul)', '[map(r=2km)]'],
    ['map(r=2km;tete=seul;lieu=Paris 75)', '[map(r=2km,tete=simple,lieu=Paris 75)]'],
    ['place(actions=share+collapse+maximize)', '[place(actions=agrandir+replier+partager)]'],
    ['plant(epingle=128268;ecrit=0;toucher=rien)', '[plant(plante=128268,toucher=rien,ecrit=0)]']
  ];
  for (const [typed, written] of cases) {
    const r = read(typed);
    assert.equal(r.text, written, typed);
    // Read again: the same (a canonical text is a fixed point).
    assert.equal(read(r.text).text, written, written);
    assert.deepEqual(read(written).problems, [], written);
  }
  // A head only its title (tete=simple) — « titre seul » is not one of its words: said, left out.
  assert.match(read('map(bandeau=titre seul)').problems[0], /n’est pas une valeur de en-tête/);
});

test('jamais écrits quand ils valent leur défaut', () => {
  for (const typed of ['plant(tete=oui)', 'plant(actions=aucune)', 'plant(vide=message)', 'results(zone=1)', 'results(toucher=plante)', 'deck(ecrit=1)', 'plant(entête=complet;actions=rien)']) {
    const r = read(typed);
    assert.equal(r.text, '[' + typed.split('(')[0] + ']', typed);
    assert.deepEqual(r.problems, [], typed);
  }
});

test('le titre : du texte simple, une ligne, 40 caractères au plus ; le nom de la case partout (en-tête, onglet, menu)', () => {
  const long = read('plant(titre=Un titre bien trop long pour une case de cette taille-ci vraiment)');
  assert.equal(long.cell.params.titre, 'Un titre bien trop long pour une case de');
  assert.equal(long.cell.params.titre.length, 40);
  assert.equal(long.text, '[plant(titre=Un titre bien trop long pour une case de)]');
  // Control characters and spaces: one line.
  const raw = resolve(G.cell('plant', 'wikipedia', [{ key: 'titre', value: 'Deux\u0007  lignes\nici' }]));
  assert.ok(raw.known);
  assert.equal(raw.params.titre, 'Deux lignes ici');
  assert.equal(raw.title, 'Deux lignes ici');
  assert.equal(cellName(raw), 'Deux lignes ici');
  // A grammar's separator ends the value: « titre=a,b » is a title « a » and a bare « b » (said).
  const cut = read('plant(titre=a,b)');
  assert.equal(cut.cell.params.titre, 'a');
  assert.equal(cut.problems.length, 1);
  // No mark for the frame (its head, its links): the menu's marks stay those of the component's own choices.
  assert.equal(cellMark(read('plant(tete=non,actions=agrandir,vide=masque,plante=12)').cell), null);
  assert.deepEqual(cellMark(read('plant(epure,tete=non)').cell), { label: 'Épuré', short: 'É' });
});

test('ce qui ne s’applique pas est dit et laissé ; une valeur fausse aussi', () => {
  const cases = [
    ['filters(vide=masque)', 'Filtres : « vide » ne s’applique pas à ce composant.'],
    ['map(vide=masque)', 'Carte : « vide » ne s’applique pas à ce composant.'],
    ['search(zone=0)', 'Recherche : « zone » ne s’applique pas à ce composant.'],
    ['deck(plante=12)', 'Rencontres : « plante » ne s’applique pas à ce composant.'],
    ['place(ecrit=0)', 'Zone : « ecrit » ne s’applique pas à ce composant.'],
    ['plant(plante=ortie)', 'Fiche : « ortie » n’est pas une valeur de plante fixée (attendu : le numéro d’une plante (celui de p= dans l’adresse)).'],
    ['plant(tete=peut-etre)', 'Fiche : « peut-etre » n’est pas une valeur de en-tête (attendu : oui, simple, non).'],
    ['plant(actions=agrandir+voler)', 'Fiche : « voler » n’est pas une valeur de actions de l’en-tête (attendu : agrandir, replier, partager, joints par « + »).']
  ];
  for (const [typed, problem] of cases) assert.deepEqual(read(typed).problems, [problem], typed);
  assert.equal(read('plant(actions=agrandir+voler)').text, '[plant(actions=agrandir)]');
  assert.equal(read('map(vide=masque)').text, '[map]');
});

test('toucher une plante : la choisir, ouvrir sa fiche, rien ; ecrit=0 ouvre la fiche au lieu de choisir', () => {
  const touch = (/** @type {string} */ t) => touchOf(read(t).cell);
  assert.equal(touch('results'), 'plante');
  assert.equal(touch('results(toucher=fiche)'), 'fiche');
  assert.equal(touch('search(rien)'), 'rien');
  assert.equal(touch('results(ecrit=0)'), 'fiche');
  assert.equal(touch('deck(ecrit=0,toucher=rien)'), 'rien');
  assert.equal(touch('plant.lookalikes(ecrit=0)'), 'fiche');
  for (const t of ['map', 'media', 'filters', 'place']) assert.equal(touch(t), null, t);
});

test('aller-retour : des cellules au cadre tiré au hasard restent les mêmes une fois écrites', () => {
  let seed = 7;
  const rnd = (/** @type {number} */ n) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
  const pick = (/** @type {string[]} */ a) => a[rnd(a.length)];
  for (let i = 0; i < 300; i++) {
    const c = pick(['map', 'search', 'filters', 'results', 'plant', 'plant.calendar', 'media', 'deck', 'place']);
    const id = c.split('.')[0];
    const ps = [];
    if (rnd(2)) ps.push('tete=' + pick(['oui', 'simple', 'non', 'Entête', 'aucun']).replace('Entête', 'oui'));
    if (rnd(2)) ps.push('titre=' + pick(['Mon bloc', 'Zone 63', 'Été']));
    if (rnd(2)) ps.push('actions=' + pick(['agrandir', 'replier+partager', 'partager+agrandir', 'aucune']));
    if (FRAME_OF[id].includes('vide') && rnd(2)) ps.push('vide=' + pick(['message', 'masque', 'masquée']));
    if (FRAME_OF[id].includes('plante') && rnd(2)) ps.push('plante=' + (1 + rnd(500000)));
    if (FRAME_OF[id].includes('zone') && rnd(2)) ps.push('zone=' + pick(['0', '1', 'non']));
    if (FRAME_OF[id].includes('toucher') && rnd(2)) ps.push('toucher=' + pick(['plante', 'fiche', 'rien']));
    if (FRAME_OF[id].includes('ecrit') && rnd(2)) ps.push('ecrit=' + pick(['0', '1']));
    ps.sort(() => rnd(3) - 1);
    const typed = `[${c}${ps.length ? '(' + ps.join(';') + ')' : ''},plant]`;
    const once = read(typed);
    assert.deepEqual(once.problems, [], typed);
    assert.equal(read(once.text).text, once.text, typed);
    // The frame last, in its order, never a default.
    const written = /\((.*)\)/.exec(once.text.split('],')[0].split(',plant]')[0])?.[1] ?? '';
    const keys = written ? written.split(',').map(p => p.split('=')[0]) : [];
    const order = ['tete', 'actions', 'vide', 'plante', 'zone', 'toucher', 'ecrit', 'titre'];
    const frameKeys = keys.filter(k => order.includes(k));
    assert.deepEqual(frameKeys, [...frameKeys].sort((a, b) => order.indexOf(a) - order.indexOf(b)), once.text);
    assert.ok(!/tete=oui|actions=aucune|vide=message|zone=1|toucher=plante|ecrit=1/.test(once.text), once.text);
  }
});
