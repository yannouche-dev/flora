// The block picker's pure part (app/layout/summary.js, app/layout/picker-model.js): a cell said in chips, a group's
// line, the control each kind of setting gets, a setting / an intent / a component chosen (the cell's canonical text),
// « Revenir à l'intention », a component too large for a cell, what to suggest given the other cells.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS, resolve } from '../../app/layout/registry.js';
import { cellChips, groupSummary, textChips, valueLabel, changed } from '../../app/layout/summary.js';
import { cellOf, cellText, choose, cleanWords, controlOf, fitReason, groupsOf, optionsOf, resetSettings, setParam, suggestions, warningOf, withIntent } from '../../app/layout/picker-model.js';

const spec = (/** @type {string} */ id) => /** @type {import('../../app/layout/registry.js').ComponentSpec} */ (COMPONENTS.find(c => c.id === id));
const known = (/** @type {string} */ text) => /** @type {any} */ (resolve(/** @type {any} */ (cellOf(text))));

test('une case en quelques mots : son composant, son bloc, son intention, ses réglages écrits', () => {
  assert.deepEqual(textChips('map(floraison,r=2km)'), ['Carte', 'Floraison du moment', '2 km']);
  assert.deepEqual(textChips('carte(terrain;base=plan;2d)'), ['Carte', 'Sur le terrain', 'Plan IGN', '2D']);
  // What the intent gives is the intent's: not said again.
  assert.deepEqual(textChips('map(floraison,when=mois,regroupe)'), ['Carte', 'Floraison du moment']);
  assert.deepEqual(textChips('map(layers=znieff+n2000)'), ['Carte', 'ZNIEFF (types I et II) + Natura 2000']);
  assert.deepEqual(textChips('plant.wikipedia(titre=Article,vide=masque)'), ['Fiche', 'Wikipédia', '« Article »', 'Case masquée']);
  assert.deepEqual(textChips('results(list,zone=0)'), ['Résultats', 'Liste', 'France']);
  assert.deepEqual(textChips('search(filters=1,list=0)'), ['Recherche', 'Filtres ouverts', 'sans liste des résultats']);
  assert.deepEqual(textChips('plant(plante=128268)'), ['Fiche', 'plante n° 128268']);
  assert.deepEqual(cellChips(resolve(/** @type {any} */ (cellOf('mpa')))), ['mpa', 'inconnu']);
  assert.equal(valueLabel(spec('map').params.r, null), null);
});

test('les groupes de réglages : ceux du composant, puis le cadre ; leur ligne ; le point des réglages changés', () => {
  assert.deepEqual(groupsOf(spec('map')).map(g => g.name), ['Où', 'Fond', 'Couches', 'Points', 'Liens', 'Interface', 'Cadre']);
  // No group of its own: « Réglages », then the frame's.
  assert.deepEqual(groupsOf(spec('results')).map(g => [g.name, g.keys]), [['Réglages', ['view']], ['Cadre', ['tete', 'titre', 'actions', 'vide']], ['Liens', ['zone', 'toucher', 'ecrit']]]);
  assert.deepEqual(groupsOf(spec('filters')).map(g => g.name), ['Cadre']);
  const r = known('map(floraison,base=plan,3d=0)');
  const line = (/** @type {string} */ name) => groupSummary(r, /** @type {any} */ (groupsOf(r.spec).find(g => g.name === name)).keys);
  assert.equal(line('Fond'), 'Plan IGN · 2D');
  assert.equal(line('Points'), 'Ce mois-ci · Plante courante en groupes');
  assert.equal(line('Couches'), 'Par défaut');
  // ● where written beside the intent, not where the intent gives it.
  assert.equal(changed(r, 'base'), true);
  assert.equal(changed(r, 'when'), false);
  assert.equal(changed(r, 'intent'), false);
});

test('le contrôle de chaque sorte de réglage', () => {
  const m = spec('map').params;
  assert.equal(controlOf(m.base), 'segmented');      // two values
  assert.equal(controlOf(m.ui), 'segmented');        // four
  assert.equal(controlOf(m['3d']), 'segmented');     // yes, no, as the settings say
  assert.equal(controlOf(m.regroupe), 'switch');
  assert.equal(controlOf(m.r), 'slider');
  assert.equal(controlOf(m.layers), 'chips');
  assert.equal(controlOf(m.lieu), 'text');
  assert.equal(controlOf(m.intent), 'cards');
  assert.equal(controlOf(spec('plant').params.plante), 'id');
  assert.equal(controlOf({ kind: 'enum', label: 'x', def: 'a', values: { a: 'A', b: 'B', c: 'C', d: 'D', e: 'E' } }), 'select');
  assert.deepEqual(optionsOf(m.base).map(o => o.label), ['Photos aériennes', 'Plan IGN']);
  assert.deepEqual(optionsOf(m['3d']).map(o => o.value), [null, true, false]);
  assert.equal(cleanWords(' Mirabel, (Ménétrol) = 63 '), 'Mirabel Ménétrol 63');
});

test('changer un réglage, une intention, un composant : le texte canonique de la case', () => {
  const c = /** @type {any} */ (cellOf('carte(floraison;rayon=2km)'));
  assert.equal(cellText(c), 'carte(floraison,rayon=2km)');
  assert.equal(setParam(c, 'base', 'plan'), 'map(floraison,r=2km,base=plan)');
  assert.equal(setParam(c, 'base', 'photo'), 'map(floraison,r=2km)');
  // What the intent gives: left out; against it: written.
  assert.equal(setParam(c, 'regroupe', true), 'map(floraison,r=2km)');
  assert.equal(setParam(c, 'when', 'toujours'), 'map(floraison,r=2km,when=toujours)');
  // The default, with no intent saying otherwise: left out.
  assert.equal(setParam(c, 'pts', 'photo'), 'map(floraison,r=2km)');
  assert.equal(setParam(c, 'r', null), 'map(floraison)');
  assert.equal(setParam(c, 'r', 5000), 'map(floraison,r=5km)');
  assert.equal(setParam(c, 'layers', ['znieff', 'n2000']), 'map(floraison,r=2km,layers=znieff+n2000)');
  assert.equal(setParam(c, 'lieu', 'Fontainebleau 77'), 'map(floraison,r=2km,lieu=Fontainebleau 77)');
  // An intent: the others give way, but where it is (Où) and its frame.
  const busy = /** @type {any} */ (cellOf('map(floraison,r=2km,base=plan,ui=nue,tete=simple)'));
  assert.equal(withIntent(busy, 'terrain'), 'map(terrain,r=2km,tete=simple)');
  assert.equal(withIntent(busy, 'explorer'), 'map(r=2km,tete=simple)');
  assert.equal(resetSettings(busy), 'map(floraison,r=2km,tete=simple)');
  assert.equal(resetSettings(/** @type {any} */ (cellOf('results(grid,vide=masque)'))), 'results(vide=masque)');
  // Another component: the frame's settings it honours kept.
  assert.equal(choose(/** @type {any} */ (cellOf('map(terrain,tete=non,titre=Ici)')), 'plant', 'wikipedia'), 'plant.wikipedia(tete=non,titre=Ici)');
  assert.equal(choose(/** @type {any} */ (cellOf('results(vide=masque,zone=0)')), 'map'), 'map');
  assert.equal(choose(null, 'results'), 'results');
});

test('la place qu’il faut, les suggestions selon les autres cases', () => {
  assert.equal(fitReason(spec('map'), { w: 200, h: 400 }), 'Un peu étroit pour « Carte » : 240 px de large conseillés (la case en a 200)');
  assert.equal(fitReason(spec('deck'), { w: 300, h: 200 }), 'Un peu bas pour « Rencontres » : 360 px de haut conseillés (la case en a 200)');
  assert.equal(fitReason(spec('map'), { w: 400, h: 400 }), null);
  assert.equal(fitReason(spec('map'), null), null);
  // Nothing chooses a plant: those that do.
  assert.deepEqual([...suggestions([]).keys()], ['map', 'search', 'results', 'deck']);
  assert.match(/** @type {string} */ (suggestions([known('plant')]).get('results')), /montrent les autres cases/);
  // A map chooses one, nothing shows it: the sheet, the photos; the map not again.
  const withMap = suggestions([known('map(floraison)')]);
  assert.deepEqual([...withMap.keys()], ['plant', 'media']);
  assert.deepEqual([...suggestions([known('map'), known('plant')]).keys()], []);
  // A sheet with nothing to choose its plant: said.
  assert.match(/** @type {string} */ (warningOf(spec('plant'), [])), /^Aucune autre case ne choisit la plante \(Carte, Recherche, Résultats, Rencontres\)$/);
  assert.equal(warningOf(spec('plant'), [known('results')]), null);
  assert.equal(warningOf(spec('map'), []), null);
});
