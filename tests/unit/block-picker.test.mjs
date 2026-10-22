// The block picker's pure part (app/layout/summary.js, app/layout/picker-model.js): a cell said in chips, a group's
// line, the control each kind of setting gets, a setting / an intent / a component chosen (the cell's canonical text),
// « Revenir à l'intention », a component too large for a cell, what to suggest given the other cells.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS, resolve } from '../../app/layout/registry.js';
import { cellChips, groupSummary, valueLabel, changed } from '../../app/layout/summary.js';
import { cellOf, cellText, choose, cleanWords, controlOf, fitReason, groupsOf, optionsOf, resetSettings, setParam, suggestions, warningOf, withIntent } from '../../app/layout/picker-model.js';

const spec = (/** @type {string} */ id) => /** @type {import('../../app/layout/registry.js').ComponentSpec} */ (COMPONENTS.find(c => c.id === id));
const known = (/** @type {string} */ text) => /** @type {any} */ (resolve(/** @type {any} */ (cellOf(text))));
/** A cell written alone (« map(floraison,r=2km) »), its chips. */
const chips = (/** @type {string} */ text) => cellChips(known(text));

test('une case en quelques mots : son composant, son bloc, son intention, ses réglages écrits', () => {
  assert.deepEqual(chips('map(floraison,r=2km)'), ['Carte', 'Floraison du moment', '2 km']);
  assert.deepEqual(chips('carte(terrain;base=plan;2d)'), ['Carte', 'Sur le terrain', 'Plan IGN', '2D']);
  assert.deepEqual(chips('map(base=spot,noms=0)'), ['Carte', 'Satellite (SPOT)', 'sans noms sur le fond']);
  // What the intent gives is the intent's: not said again.
  assert.deepEqual(chips('map(floraison,when=mois,regroupe)'), ['Carte', 'Floraison du moment']);
  assert.deepEqual(chips('map(layers=znieff+n2000)'), ['Carte', 'ZNIEFF (types I et II) + Natura 2000']);
  assert.deepEqual(chips('plant.wikipedia(titre=Article,vide=masque)'), ['Fiche', 'Wikipédia', '« Article »', 'Case masquée']);
  assert.deepEqual(chips('results(list,zone=0)'), ['Résultats', 'Liste', 'France']);
  assert.deepEqual(chips('search(filters=1,list=0)'), ['Recherche', 'Filtres ouverts', 'sans liste des résultats']);
  assert.deepEqual(chips('plant(plante=128268)'), ['Fiche', 'plante n° 128268']);
  assert.deepEqual(cellChips(resolve(/** @type {any} */ (cellOf('mpa')))), ['mpa', 'inconnu']);
  assert.equal(valueLabel(spec('map').params.r, null), null);
});

test('les groupes de réglages : ceux du composant, puis le cadre ; leur ligne ; le point des réglages changés', () => {
  assert.deepEqual(groupsOf(spec('map')).map(g => g.name), ['Où', 'Fond', 'Couches', 'Points', 'Liens', 'Interface', 'Cadre']);
  // No group of its own: « Réglages », then the frame's.
  assert.deepEqual(groupsOf(spec('results')).map(g => [g.name, g.keys]), [['Réglages', ['view']], ['Cadre', ['tete', 'titre', 'actions', 'vide']], ['Liens', ['zone', 'toucher', 'ecrit', 'groupe']]]);
  assert.deepEqual(groupsOf(spec('filters')).map(g => g.name), ['Cadre', 'Liens']);
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
  assert.equal(controlOf(m.base), 'segmented');      // three values, and the common one (none written)
  assert.equal(controlOf(m.annee), 'select');        // every year and period: a menu
  assert.equal(controlOf(m.ui), 'segmented');        // four
  assert.equal(controlOf(m['3d']), 'segmented');     // yes, no, as the settings say
  assert.equal(controlOf(m.regroupe), 'switch');
  assert.equal(controlOf(m.r), 'slider');
  assert.equal(controlOf(m.layers), 'chips');
  assert.equal(controlOf(m.lieu), 'text');
  assert.equal(controlOf(m.intent), 'cards');
  assert.equal(controlOf(spec('plant').params.plante), 'id');
  assert.equal(controlOf({ kind: 'enum', label: 'x', def: 'a', values: { a: 'A', b: 'B', c: 'C', d: 'D', e: 'E' } }), 'select');
  assert.deepEqual(optionsOf(m.base).map(o => o.label), ['Par défaut', 'Photos aériennes', 'Plan IGN', 'Satellite (SPOT)']);
  const years = optionsOf(m.annee);
  assert.equal(years[0].label, 'Par défaut');
  assert.ok(years.some(o => o.value === '2016-2020' && o.label === '2016 – 2020'), 'une période');
  assert.ok(years.some(o => o.value === '1950-1965') && years.some(o => o.value === '2025') && years.some(o => o.value === '2000'));
  // The dates of its background only (never one it has not: dropped, the choice would not hold), the most recent first.
  const dates = (/** @type {string | null} */ base) => optionsOf(m.annee, { ...known(base ? `map(base=${base})` : 'map').params }).map(o => o.value);
  assert.deepEqual(dates('spot'), [null, '2025', '2024', '2023', '2022', '2021', '2020', '2019', '2018', '2017', '2016', '2015', '2014', '2013']);
  const photo = dates('photo');
  assert.deepEqual(photo.slice(0, 4), [null, '2024', '2023', '2022']);
  assert.deepEqual(photo.slice(-9), ['2000', '2021-2023', '2016-2020', '2011-2015', '2006-2010', '2000-2005', '1980-1995', '1965-1980', '1950-1965']);
  assert.equal(photo.length, 1 + 25 + 5 + 3);
  assert.deepEqual(dates('plan'), [null]);
  // None written (the common background): the photos', then SPOT's that only it has, all the most recent first.
  assert.deepEqual(dates(null).slice(0, 4), [null, '2025', '2024', '2023']);
  // Each one chosen holds: written in the cell.
  for (const base of ['spot', 'photo', null]) {
    for (const w of dates(base).slice(2)) assert.match(setParam(/** @type {any} */ (cellOf(base ? `map(base=${base})` : 'map')), 'annee', w), new RegExp(`annee=${w}\\)$`), `${base} ${w}`);
  }
  assert.deepEqual(optionsOf(m['3d']).map(o => o.value), [null, true, false]);
  // The names over the photos and SPOT's: as the common settings say, yes, no.
  assert.equal(controlOf(m.noms), 'segmented');
  assert.deepEqual(optionsOf(m.noms).map(o => [o.value, o.label]), [[null, 'Par défaut'], [true, 'Oui'], [false, 'Non']]);
  assert.equal(cleanWords(' Mirabel, (Ménétrol) = 63 '), 'Mirabel Ménétrol 63');
});

test('changer un réglage, une intention, un composant : le texte canonique de la case', () => {
  const c = /** @type {any} */ (cellOf('carte(floraison;rayon=2km)'));
  assert.equal(cellText(c), 'carte(floraison,rayon=2km)');
  assert.equal(setParam(c, 'base', 'plan'), 'map(floraison,r=2km,base=plan)');
  // The photos written are this cell's own background (none written: the maps' common one).
  assert.equal(setParam(c, 'base', 'photo'), 'map(floraison,r=2km,base=photo)');
  assert.equal(setParam(c, 'base', null), 'map(floraison,r=2km)');
  // Its year (named: never a bare value), after its background; SPOT's latest is SPOT without a year.
  assert.equal(setParam(/** @type {any} */ (cellOf(setParam(c, 'base', 'spot'))), 'annee', '2020'), 'map(floraison,r=2km,base=spot,annee=2020)');
  assert.equal(setParam(/** @type {any} */ (cellOf('map(base=spot,annee=2020)')), 'annee', '2025'), 'map(base=spot)');
  // The plan has no year: the year left out. Its names are its own (noms= kept: found again on the photos).
  assert.equal(setParam(/** @type {any} */ (cellOf('map(base=spot,annee=2020)')), 'base', 'plan'), 'map(base=plan)');
  assert.equal(setParam(/** @type {any} */ (cellOf('map(base=spot,noms=0)')), 'base', 'plan'), 'map(base=plan,noms=0)');
  assert.equal(setParam(/** @type {any} */ (cellOf('map(base=photo,annee=2016;3d=0)')), 'noms', false), 'map(base=photo,annee=2016,noms=0;3d=0)');
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
