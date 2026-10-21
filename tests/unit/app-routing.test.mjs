// « Créer une app » : what is done in a cell is kept in the layout (registry.js#withParam, map-options.js) — a setting
// changed by the cell's own controls written as the editor writes it (left out when it is the cell's value without
// it), a map's layers in the order drawn with any layer of IGN's catalogue, their opacity, its binoculars, the view it
// starts on, a cell folded: each read, written short, read back the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../app/layout/grammar.js';
import { resolve, resolveTree, withParam } from '../../app/layout/registry.js';
import { groupsOf } from '../../app/layout/picker-model.js';
import { layersOf, layerWord, opacitiesOf, opacText, overlaysOf, readOpacities, readView, viewOf, viewText } from '../../app/layout/map-options.js';

/** A layout typed → its canonical text and what was wrong. @param {string} text */
function read(text) {
  const r = resolveTree(G.parse(text).tree);
  return { text: G.serialize(r.tree), problems: r.problems.map(x => x.message), cell: /** @type {any} */ (r.cells.get('0')) };
}
/** A cell, alone. @param {string} text */
const cellOf = text => /** @type {G.CellNode} */ (G.parse(text).tree.kids[0]);
/** A cell with settings changed, as the address writes it. @param {string} text @param {Record<string, unknown>} values */
const changed = (text, values) => {
  let n = cellOf(text);
  for (const [k, v] of Object.entries(values)) n = withParam(n, k, v);
  return read(G.serialize({ t: 'list', kids: [n], size: null })).text;
};

test('un réglage changé par la case : écrit, retiré quand il revient à ce que la case a sans lui', () => {
  assert.equal(changed('map', { '3d': true }), '[map(3d=1)]');
  assert.equal(changed('map(3d=1)', { '3d': false }), '[map(3d=0)]');
  assert.equal(changed('map(3d=1)', { '3d': null }), '[map]');
  // The intent's value: left out; another: written beside it.
  assert.equal(changed('map(relief)', { '3d': true }), '[map(relief)]');
  assert.equal(changed('map(relief)', { '3d': false }), '[map(relief,3d=0)]');
  assert.equal(changed('map(repartition)', { plante: 'grand' }), '[map(repartition,plante=grand)]');
  assert.equal(changed('map', { plante: 'seule', base: 'plan', legende: true }), '[map(base=plan,plante=seule,legende=1)]');
  assert.equal(changed('map(when=mois)', { when: 'toujours' }), '[map]');
  // Another component's: the filters opened, the results as a grid, a cell folded.
  assert.equal(changed('search', { filters: true }), '[search(filters=1)]');
  assert.equal(changed('results', { view: 'grid' }), '[results(view=grid)]');
  assert.equal(changed('plant(actions=replier)', { etat: 'replie' }), '[plant(actions=replier,etat=replie)]');
  assert.equal(changed('plant(actions=replier,etat=replie)', { etat: null }), '[plant(actions=replier)]');
  // Not one of its settings: the cell as it was.
  assert.equal(changed('results', { '3d': true }), '[results]');
});

test('les couches de la case : absentes, les communes à toutes les cartes ; sa dernière décochée, aucune (layers=aucune), même avec une intention', () => {
  // Its panel ▦ (gf-map look-change: no overlay left) writes none, not the common layers.
  assert.equal(changed('map(layers=cadastre)', { layers: [] }), '[map(layers=aucune)]');
  assert.equal(changed('map(base=plan,layers=cadastre)', { layers: [], opac: null }), '[map(base=plan,layers=aucune)]');
  assert.equal(changed('map(protege)', { layers: [] }), '[map(protege,layers=aucune)]');
  // « Revenir aux réglages communs »: left out — the common layers again.
  assert.equal(changed('map(layers=aucune)', { layers: null }), '[map]');
  assert.equal(changed('map(layers=cadastre,opac=cadastre.40)', { base: null, layers: null, opac: null }), '[map]');
  assert.equal(read('map').cell.params.layers, null);
  assert.deepEqual(read('map(layers=aucune)').cell.params.layers, []);
});

test('les couches : dans l’ordre dessiné, toute couche du catalogue de l’IGN (ign:<id>), une seule nommée par son nom court', () => {
  assert.equal(read('map(layers=hydro+znieff)').text, '[map(layers=hydro+znieff)]');
  assert.equal(read('map(layers=ign:LANDCOVER.FORESTINVENTORY.V2+znieff)').text, '[map(layers=ign:LANDCOVER.FORESTINVENTORY.V2+znieff)]');
  assert.equal(read('map(layers=ign:Patrinat_PNR)').text, '[map(layers=pnr)]');
  assert.equal(read('map(layers=ign:bad!id)').problems.length, 1);
  assert.equal(layerWord('ign:A.B_C-1'), 'ign:A.B_C-1');
  assert.equal(layerWord('ign:'), undefined);
  assert.equal(layerWord('foo'), undefined);
  // gf-map's overlays → names: a layer of several when all are there, in the order drawn.
  assert.deepEqual(layersOf(['ign:Patrinat_ZNIEFF1', 'contours', 'ign:Patrinat_ZNIEFF2', 'ign:X.Y']), ['znieff', 'courbes', 'ign:X.Y']);
  assert.deepEqual(layersOf(['ign:Patrinat_ZNIEFF2']), ['znieff2']);
  assert.deepEqual(overlaysOf(['znieff', 'ign:X.Y', 'parcs']), ['ign:Patrinat_ZNIEFF1', 'ign:Patrinat_ZNIEFF2', 'ign:X.Y', 'parcs']);
});

test('l’opacité des couches (opac=) : par couche, en %, seulement celles qui ne sont pas à l’opacité habituelle', () => {
  assert.equal(readOpacities('znieff.60+ign:A.B.40'), 'znieff.60+ign:A.B.40');
  assert.equal(readOpacities('Natura.5'), 'n2000.5');
  assert.equal(readOpacities('znieff.160'), undefined);
  assert.equal(readOpacities('znieff'), undefined);
  assert.equal(read('map(layers=znieff,opac=znieff.60)').text, '[map(layers=znieff,opac=znieff.60)]');
  assert.equal(read('map(opac=lune.3)').problems.length, 1);
  assert.deepEqual(opacitiesOf('znieff.60+parcs.100'), { 'ign:Patrinat_ZNIEFF1': 0.6, 'ign:Patrinat_ZNIEFF2': 0.6, parcs: 1 });
  const keys = ['ign:Patrinat_ZNIEFF1', 'ign:Patrinat_ZNIEFF2', 'parcs', 'ign:A.B'];
  assert.equal(opacText({ 'ign:Patrinat_ZNIEFF1': 0.6, 'ign:Patrinat_ZNIEFF2': 0.6, parcs: 0.8, 'ign:A.B': 0.35 }, keys, 0.8), 'znieff.60+ign:A.B.35');
  assert.equal(opacText({ parcs: 0.8 }, keys, 0.8), null);
});

test('les jumelles (jumelles=, jrayon=) : absentes, éteintes ; aucune source, allumées sans source', () => {
  assert.equal(read('map').cell.params.jumelles, null);
  assert.equal(changed('map', { jumelles: ['inat', 'gbif'], jrayon: 5000 }), '[map(jumelles=inat+gbif,jrayon=5km)]');
  assert.equal(changed('map(jumelles=inat)', { jumelles: [] }), '[map(jumelles=aucune)]');
  assert.deepEqual(read('map(jumelles=aucune)').cell.params.jumelles, []);
  assert.equal(changed('map(jumelles=inat,jrayon=5km)', { jumelles: null, jrayon: null }), '[map]');
  // Never a bare value (map(densite) is not jumelles=densite): only named.
  assert.equal(read('map(densite)').cell.params.jumelles, null);
});

test('le cadrage de départ (vue=) : centre, zoom, et en 3D inclinaison et rotation ; lu, réécrit court', () => {
  assert.equal(readView('45.771234567:3.0812345:13.456'), '45.77123:3.08123:13.46');
  assert.equal(readView('45.77:3.08:13:60:-20'), '45.77:3.08:13:60:-20');
  assert.equal(readView('45.77:3.08:13:0:0'), '45.77:3.08:13');
  assert.equal(readView('95:3:13'), undefined);
  assert.equal(readView('45:3'), undefined);
  assert.deepEqual(viewOf('45.77:3.08:13:60:-20'), { lat: 45.77, lon: 3.08, zoom: 13, pitch: 60, bearing: -20 });
  assert.equal(viewText({ lat: 45.7712345, lon: 3.08, zoom: 13.5, pitch: 0, bearing: 0 }), '45.77123:3.08:13.5');
  assert.equal(read('map(vue=45.77:3.08:13)').text, '[map(vue=45.77:3.08:13)]');
  assert.equal(read('map(vue=lune)').problems.length, 1);
  // In the address of the app, then again: the same.
  const text = '[map(r=2km,3d=1,vue=45.77:3.08:13:60:-20),results]';
  assert.equal(read(text).text, text);
});

test('ce que règlent les commandes de la case n’est pas dans « Affiner » du choix du contenu', () => {
  const r = resolve(cellOf('map'));
  assert.ok(r.known);
  const keys = groupsOf(/** @type {any} */ (r).spec).flatMap(g => g.keys);
  for (const k of ['vue', 'opac', 'jumelles', 'jrayon', 'legende', 'etat']) assert.ok(!keys.includes(k), k);
  for (const k of ['base', '3d', 'layers', 'when']) assert.ok(keys.includes(k), k);
});

test('les liens d’une case (le constructeur) : ce qu’elle suit et change, et le réglage qui l’en détache', async () => {
  const { linksOf, CURRENT } = await import('../../app/layout/registry.js');
  const links = (/** @type {string} */ text) => linksOf(resolve(cellOf(text))).map(l => [l.link, l.on, l.toggle]);
  assert.deepEqual(links('map'), [['zone', true, { portee: 'france' }], ['recherche', true, { suit: false }], ['periode', true, null], ['plante', true, { plante: 'non' }],
    ['liste', true, { liste: 'zone' }]]);
  assert.deepEqual(links('map(france,suit=0,plante=non)'), [['zone', false, { portee: null }], ['recherche', false, { suit: null }], ['periode', true, null], ['plante', false, { plante: null }],
    ['liste', false, null]]);
  // The list: the zone's all (liste=zone), then what the map shows again; a map of France never leads it, said.
  assert.deepEqual(links('map(liste=zone)').at(-1), ['liste', false, { liste: null }]);
  assert.deepEqual(links('results(zone=0)').map(l => l.slice(0, 2)), [['recherche', true], ['zone', false], ['periode', false], ['plante', true]]);
  assert.deepEqual(links('plant.wikipedia'), [['plante', true, { plante: CURRENT }]]);
  assert.deepEqual(links('plant(plante=128268)'), [['plante', false, { plante: null }]]);
  assert.deepEqual(links('slot'), []);
  // The map's reach: read, written short, a bare word.
  assert.equal(read('map(france)').text, '[map(portee=france)]');
  assert.equal(read('carte(monde)').text, '[map(portee=monde)]');
  assert.equal(read('map(portee=zone)').text, '[map(portee=zone)]');
  assert.equal(changed('map(portee=france)', { portee: 'zone' }), '[map]');
});
