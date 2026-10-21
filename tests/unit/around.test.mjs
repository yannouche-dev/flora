// The games around a place (Rencontres, Cueillette prudente, Mosaïque): the pure part of their cards
// (app/miniapp/kit/cards.js — Cueillette prudente's order and its toxic look-alikes, never a match but recognised to
// avoid, the safety lines of a card's bio, the swipes, the slider of
// the distances: a distance between two stops shown between them, its keys from stop to stop), each game's
// own session and its hand-over from the shared one of before (core/around-sessions.js), and what a mini-app made in
// Mes plantes, taken away by « Recommencer » (place-model.js#madeBy, withoutMadeBy, tagLegacy; runtime.js#replayItems).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { avoid, bio, deckOf, distanceAt, distanceEvents, distanceKey, distanceNear, distLabel, ethnoSentence, harvestOrder, nextDistance, swipe, toAvoid, unswipe } from '../../app/miniapp/kit/cards.js';
import { lookalikesOf } from '../../app/core/lookalikes.js';
import { UNREAD, dangerLevel, rank } from '../../app/core/danger.js';
import { verdictOf } from '../../app/core/alerts.js';
import { keptCtx, forgetPlaces, keptPlace, leftAt, migrateDiscover, clearAroundGames } from '../../app/core/around-sessions.js';
import * as M from '../../app/core/place-model.js';
import { toPortable } from '../../app/core/portable.js';
import { defineMiniApp } from '../../app/miniapp/define.js';
import { MiniApp, replayItems, storageKey } from '../../app/miniapp/runtime.js';

const plants = JSON.parse(await readFile(new URL('../fixtures/plants.json', import.meta.url), 'utf8'));
const plant = (/** @type {string} */ name) => plants.find((/** @type {any} */ x) => x.scientificName === name);
/** A card of the deck. @param {string} name @param {Partial<import('../../app/miniapp/kit/cards.js').Card>} [more] */
const card = (name, more = {}) => ({ plant: plant(name), count: 10, photo: null, credit: null, blooming: false, verdict: null, ...more });

test('Cueillette prudente : seulement les plantes à sosie dangereux, la mortelle d’abord ; liste illisible : toutes gardées', async () => {
  const cards = await Promise.all(['Urtica dioica', 'Conium maculatum', 'Allium ursinum'].map(async n => {
    const c = card(n, { count: n === 'Conium maculatum' ? 5 : 80 });
    c.confusions = await lookalikesOf(c.plant);
    return c;
  }));
  const order = harvestOrder(cards, false).map(c => c.plant.scientificName);
  // The nettle has no dangerous look-alike: not in the list. The wild garlic's (Colchique) is deadly: first.
  assert.deepEqual(order, ['Allium ursinum', 'Conium maculatum']);
  const unread = harvestOrder(cards.map(c => ({ ...c, confusions: [] })), true);
  assert.equal(unread.length, 3, 'la liste des confusions illisible : aucune plante écartée');
});

test('bio : la sécurité d’abord — confusions, toxicité illisible, toxique, jamais « à table » pour une plante toxique', async () => {
  const ail = card('Allium ursinum');
  ail.confusions = await lookalikesOf(ail.plant);
  ail.verdict = dangerLevel({ statuses: ail.plant.statuses, confusions: ail.confusions });
  const lines = bio(ail, new Set());
  assert.match(lines[0], /^⚠️ Ne me confondez pas avec Colchique \(mortel\)\. Partie : feuilles\.$/);
  // The species the Anses names: the part it says is picked, « à table » (never « comestible »).
  assert.ok(lines.includes('🍽️ Partie consommée selon l’Anses : feuilles. J’ai des sosies dangereux (2) : lisez ma fiche avant de passer à table.'), lines.join('\n'));
  const cigue = card('Conium maculatum');
  cigue.confusions = await lookalikesOf(cigue.plant);
  cigue.verdict = dangerLevel({ statuses: cigue.plant.statuses, safety: { ansm: [{ list: 'B', parts: 'fruit' }] }, confusions: cigue.confusions });
  const l2 = bio(cigue, new Set());
  assert.match(l2[0], /^☠️ Je suis le sosie .* de Persil plat\.$/);
  assert.ok(l2.includes('☠️ Pharmacopée française, liste B : effets indésirables supérieurs au bénéfice attendu. On regarde, on ne goûte pas.'), l2.join('\n'));
  const unread = bio(card('Urtica dioica', { verdict: dangerLevel({ unread: true }) }), new Set());
  assert.equal(unread[0], '⚠️ ' + UNREAD + '.', 'données illisibles : dites en premier');
  // The species named, but toxic by the ANSM (list B): never « à table ».
  const toxicEdible = bio(card('Allium ursinum', { verdict: dangerLevel({ safety: { ansm: [{ list: 'B' }] }, confusions: ail.confusions }) }), new Set());
  assert.ok(toxicEdible.some(l => l === '⚠️ J’ai des sosies dangereux (2). Lisez ma fiche avant toute cueillette.'));
  assert.ok(!toxicEdible.some(l => /à table|consommée/.test(l)));
  assert.ok(bio(card('Urtica dioica'), new Set()).length <= 4, 'quatre lignes au plus');
});

test('bio : une plante du côté toxique d’une confusion a sa ligne ☠️ partout — sans ses confusions (Rencontres, Mosaïque, le paquet d’une disposition) aussi', async () => {
  const skull = (/** @type {string[]} */ lines) => lines.filter(l => l.startsWith('☠️'));
  // Rencontres: the card carries its verdict, never its confusions.
  for (const [name, line] of [
    ['Oenanthe crocata', '☠️ Plante mortelle, confondue avec Carotte sauvage. On regarde, on ne goûte pas.'],
    ['Colchicum bulbocodium', '☠️ Plante mortelle, confondue avec Ail des ours, Poireau sauvage. On regarde, on ne goûte pas.'],
    ['Aesculus hippocastanum', '☠️ Plante toxique, confondue avec Châtaigne. On regarde, on ne goûte pas.']
  ]) {
    const lines = bio(card(name, { verdict: await verdictOf(plant(name)) }), new Set());
    assert.equal(lines[0], line, name + ' :\n' + lines.join('\n'));
  }
  // Cueillette prudente: its confusion line says it, never twice.
  const oenanthe = card('Oenanthe crocata', { confusions: await lookalikesOf(plant('Oenanthe crocata')), verdict: await verdictOf(plant('Oenanthe crocata')) });
  assert.deepEqual(skull(bio(oenanthe, new Set())), ['☠️ Je suis le sosie mortel de Carotte sauvage.']);
});

test('bio : toute la flore — aucune plante toxique (danger ou mortelle) sans sa ligne ☠️, avec ou sans ses confusions ; jamais une plante au moins « danger » sans ligne de prudence en tête', async () => {
  const read = async (/** @type {string} */ path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
  const [flora, safety] = await Promise.all([read('../../data/plants.json'), read('../../data/safety.json')]);
  const toxicKinds = new Set(['toxic-side', 'tppt', 'ansm-b', 'ansm-a']);
  let checked = 0;
  for (const p of flora) {
    // What verdictOf gives (danger.test.mjs), each file read once: the confusions serve Cueillette prudente's card too.
    const confusions = await lookalikesOf(p);
    const v = dangerLevel({ statuses: p.statuses, safety: safety.plants[p.id] ?? null, confusions });
    if (rank(v.level) < rank('danger')) continue;
    checked++;
    const own = v.reasons.filter(r => toxicKinds.has(r.kind) && rank(r.level) >= rank('danger'));
    // Each game's card: Rencontres, Mosaïque, a free layout's deck (no confusions); Cueillette prudente (its confusions).
    for (const c of [{ plant: p, verdict: v }, { plant: p, verdict: v, confusions }].map(more => card(p.scientificName, more))) {
      const lines = bio(c, new Set());
      const where = `${p.scientificName} (${c.confusions ? 'avec' : 'sans'} ses confusions) :\n${lines.join('\n')}`;
      assert.match(lines[0], /^(☠️|⚠️|🛡️|🍽️ .*sosies dangereux)/, where);
      if (!own.length) continue;
      // Among the first three: what a card shows under its Wikipédia sentence (ma-deck.js).
      assert.ok(lines.slice(0, 3).some(l => l.startsWith('☠️')), where);
      // No confusion line on the toxic side: the ☠️ line names what it is mistaken for.
      const side = own.find(r => r.kind === 'toxic-side');
      const saidSide = (c.confusions || []).slice(0, 2).some(l => l.side === 'toxic');
      if (side && !saidSide) assert.ok(lines.includes('☠️ ' + side.text + '. On regarde, on ne goûte pas.'), where);
    }
  }
  assert.ok(checked > 100, 'la flore lue : ' + checked + ' plantes au moins « danger »');
});

test('cartes : balayées à droite (match) ou à gauche, reprises ; le paquet sans elles ; distances', () => {
  let s = { matches: [], passed: [] };
  s = swipe(s, 1, true);
  s = swipe(s, 2, false);
  assert.deepEqual(s, { matches: [1], passed: [2] });
  assert.deepEqual(swipe(s, 1, false), { matches: [], passed: [2, 1] });
  assert.deepEqual(unswipe(s, 2), { matches: [1], passed: [] });
  const deck = deckOf([1, 2, 3].map(id => ({ plant: { id } })).map(c => /** @type {any} */ (c)), s);
  assert.deepEqual(deck.map(c => c.plant.id), [3]);
  assert.equal(distLabel(1000), '1 km');
  assert.equal(distLabel(500), '500 m');
  assert.equal(nextDistance(1000), 2000);
  assert.equal(nextDistance(50000), undefined);
  assert.equal(ethnoSentence({ sections: [{ theme: 'names', text: 'Son nom vient du latin ursus, l’ours. Et puis…' }] }), 'Son nom vient du latin ursus, l’ours.');
  assert.equal(ethnoSentence(null), '');
});

test('Cueillette prudente : un sosie toxique jamais aimé — à droite, reconnu à éviter (compté à part, hors du paquet), repris par ↺', async () => {
  const cards = await Promise.all(['Allium ursinum', 'Colchicum autumnale', 'Urtica dioica'].map(async n => {
    const c = card(n);
    c.confusions = await lookalikesOf(c.plant);
    return c;
  }));
  const [ail, colchique, ortie] = cards;
  // The toxic side only (the wild garlic is the edible one); a card without its confusions (Rencontres): never.
  assert.deepEqual(cards.map(toAvoid), [false, true, false]);
  assert.equal(toAvoid(card('Colchicum autumnale')), false);
  const id = colchique.plant.id;
  /** @type {import('../../app/miniapp/kit/cards.js').Swipes} */
  let s = { matches: [id], passed: [id], avoided: [] };
  s = avoid(s, id);
  assert.deepEqual(s, { matches: [], passed: [], avoided: [id] }, 'jamais un match en même temps');
  assert.deepEqual(deckOf(cards, s), [ail, ortie]);
  assert.deepEqual(unswipe(s, id), { matches: [], passed: [], avoided: [] });
  assert.deepEqual(swipe(s, id, false), { matches: [], passed: [id], avoided: [] });
  // A game that does not keep them (Rencontres, Mosaïque): no key added.
  assert.deepEqual(unswipe({ matches: [1], passed: [] }, 1), { matches: [], passed: [] });
});

test('le curseur des distances : une distance entre deux crans montrée entre eux (3 km entre 2 et 5), jamais sur un cran qu’elle n’est pas ; glissé, le cran le plus proche ; au clavier, de cran en cran', () => {
  // Its stops: 200 m, 500 m, 1, 2, 5, 10, 20, 50 km (0…7).
  assert.equal(distanceAt(200), 0);
  assert.equal(distanceAt(2000), 3);
  assert.equal(distanceAt(50000), 7);
  // A free layout's r=3km: between 2 km (3) and 5 km (4), as far along as its ratio (log 1.5 / log 2.5).
  assert.ok(Math.abs(distanceAt(3000) - (3 + Math.log(1.5) / Math.log(2.5))) < 1e-9);
  assert.ok(distanceAt(3000) > 3 && distanceAt(3000) < 4);
  assert.ok(distanceAt(1500) > 2 && distanceAt(1500) < 3);
  // Before the first stop (a layout's 100 m) or past the last: at that end.
  assert.equal(distanceAt(100), 0);
  assert.equal(distanceAt(80000), 7);
  // Dragged, the track touched: the closest stop.
  assert.equal(distanceNear(3.44), 2000);
  assert.equal(distanceNear(3.5), 5000);
  assert.equal(distanceNear('4'), 5000);
  assert.equal(distanceNear(-1), 200);
  assert.equal(distanceNear(9), 50000);
  // The keys: from 3 km, → 5 km and ← 2 km (its two neighbours), never 3 km again by a stop it is not.
  assert.equal(distanceKey('ArrowRight', 3000), 5000);
  assert.equal(distanceKey('ArrowUp', 3000), 5000);
  assert.equal(distanceKey('ArrowLeft', 3000), 2000);
  assert.equal(distanceKey('ArrowDown', 3000), 2000);
  assert.equal(distanceKey('ArrowRight', 2000), 5000);
  assert.equal(distanceKey('ArrowLeft', 2000), 1000);
  assert.equal(distanceKey('PageUp', 3000), 10000);
  assert.equal(distanceKey('PageDown', 3000), 1000);
  assert.equal(distanceKey('Home', 3000), 200);
  assert.equal(distanceKey('End', 3000), 50000);
  // At an end, the same distance; another key, none.
  assert.equal(distanceKey('ArrowRight', 50000), 50000);
  assert.equal(distanceKey('ArrowLeft', 200), 200);
  assert.equal(distanceKey('ArrowLeft', 100), 100);
  assert.equal(distanceKey('a', 3000), null);
  // The listeners: the distance set, the thumb put on its stop; an unchanged one not set again; other keys left alone.
  let radius = 3000;
  /** @type {number[]} */
  const set = [];
  const on = distanceEvents(() => radius, m => { set.push(m); radius = m; });
  const target = { value: '3.44' };
  let prevented = 0;
  on.keydown({ key: 'ArrowRight', target, preventDefault: () => { prevented++; } });
  assert.deepEqual(set, [5000]);
  assert.equal(target.value, '4');
  assert.equal(prevented, 1);
  on.keydown({ key: 'Tab', target, preventDefault: () => { prevented++; } });
  assert.equal(prevented, 1);
  target.value = '4.3';
  on.input({ target });
  assert.deepEqual(set, [5000]);
  assert.equal(target.value, '4');
  target.value = '5.6';
  on.input({ target });
  assert.deepEqual(set, [5000, 20000]);
  assert.equal(target.value, '6');
});

test('sessions : la partie partagée d’avant donnée à la dernière jouée (sinon Rencontres), une fois ; « Oublier ma position »', () => {
  localStorage.clear();
  const old = { point: [2.35, 48.85], place: 'Paris', radius: 2000, matches: [7], passed: [8] };
  localStorage.setItem('geoflora.app.rencontres.state', JSON.stringify({ v: 1, path: ['start', 'map', 'cards'], ctx: {}, finished: false }));
  migrateDiscover(old, '#/collections');
  assert.deepEqual(keptCtx('rencontres'), old, 'rien ne dit laquelle : Rencontres');
  assert.deepEqual([keptCtx('cueillette'), keptCtx('mosaique')], [{}, {}], 'les autres : rien, pas de « Continuer »');
  assert.equal(leftAt('rencontres'), 'cards', 'l’étape où on l’a laissée, gardée');
  assert.equal(leftAt('cueillette'), null);
  clearAroundGames();
  // Opened at the old address of a scenario: that one was played last.
  migrateDiscover(old, '#/discover?s=mosaic&p=3');
  assert.deepEqual(keptCtx('mosaique'), old);
  assert.deepEqual([keptCtx('rencontres'), keptCtx('cueillette')], [{}, {}]);
  clearAroundGames();
  migrateDiscover(old, '#/discover?s=harvest');
  assert.deepEqual(keptCtx('cueillette'), old);
  assert.equal(leftAt('cueillette'), 'start');
  assert.deepEqual(keptPlace(), { point: [2.35, 48.85], place: 'Paris' });
  forgetPlaces();
  assert.equal(keptPlace(), null);
  assert.deepEqual(keptCtx('cueillette').matches, [7], 'le reste de la partie gardé');
  // Nothing to hand over: nothing written.
  clearAroundGames();
  migrateDiscover({ point: null, matches: [], passed: [] });
  assert.equal(localStorage.getItem('geoflora.app.cueillette.state'), null);
});

/** Every key kept on the device, with its value. */
function footprint() {
  /** @type {Record<string, string | null>} */
  const out = {};
  for (let i = 0; i < localStorage.length; i++) { const k = /** @type {string} */ (localStorage.key(i)); out[k] = localStorage.getItem(k); }
  return out;
}

/** A collection, normalized. @param {any} feature */
const col = feature => /** @type {import('../../app/core/place-model.js').Collection} */ (M.normalizeCollection(feature));

test('provenance : l’origine d’une entrée ou d’un lieu gardée, relue d’un fichier, refusée si invalide', () => {
  const fav = col({ type: 'Feature', id: 'favorites', geometry: null, properties: { plants: [{ plantId: 1, scientificName: 'A', origin: { app: 'rencontres' } }, { plantId: 2, scientificName: 'B', origin: { app: 'X!' } }] } });
  assert.deepEqual(fav.properties.plants.map(e => e.origin ?? null), [{ app: 'rencontres' }, null]);
  const walk = col({ type: 'Feature', id: 'w', geometry: { type: 'Point', coordinates: [2, 48] }, properties: { name: 'Chemin', origin: { app: 'parcours' }, plants: [] } });
  assert.deepEqual(walk.properties.origin, { app: 'parcours' });
  // Exported, read again: the same origins (the backup and the files keep them).
  const back = toPortable([fav, walk]).features.map(f => col(f));
  assert.deepEqual(back[0].properties.plants.map(e => e.origin ?? null), [{ app: 'rencontres' }, null]);
  assert.deepEqual(back[1].properties.origin, { app: 'parcours' });
});

test('Recommencer : ce que la mini-application a fait et qui est encore le sien, et seulement cela', () => {
  const fav = col({ type: 'Feature', id: 'favorites', geometry: null, properties: { plants: [
    { plantId: 1, scientificName: 'A', origin: { app: 'rencontres' } }, { plantId: 2, scientificName: 'B' }, { plantId: 3, scientificName: 'C', origin: { app: 'cueillette' } },
    { plantId: 7, scientificName: 'G', from: { app: 'rencontres' } }] } });
  const walk = col({ type: 'Feature', id: 'w', geometry: { type: 'Point', coordinates: [2, 48] }, properties: { name: 'Chemin', origin: { app: 'parcours' },
    plants: [{ id: 'e1', plantId: 4, scientificName: 'D', origin: { app: 'parcours' } }, { id: 'e2', plantId: 5, scientificName: 'E', origin: { app: 'parcours' } }] } });
  const done = col({ type: 'Feature', id: 'd', geometry: { type: 'Point', coordinates: [2, 48] }, properties: { name: 'Fini', from: { app: 'parcours' }, plants: [{ plantId: 4, scientificName: 'D' }] } });
  const mine = col({ type: 'Feature', id: 'm', geometry: { type: 'Point', coordinates: [2, 48] }, properties: { name: 'Jardin', plants: [{ plantId: 6, scientificName: 'F' }] } });
  const all = [fav, walk, done, mine];
  const made = M.madeBy(all, 'rencontres');
  assert.deepEqual(made.favorites.map(e => e.plantId), [1]);
  assert.deepEqual(made.collections, []);
  assert.deepEqual(made.kept, { favorites: 1, collections: 0 });
  assert.deepEqual(M.madeBy(all, 'parcours').collections, [{ id: 'w', name: 'Chemin', plants: 2 }]);
  assert.deepEqual(M.madeBy(all, 'parcours').kept, { favorites: 0, collections: 1 });
  assert.deepEqual(M.withoutMadeBy(fav, 'rencontres')?.properties.plantIds, [2, 3, 7], 'le favori de Flore, celui d’une autre partie et celui fait sien restent');
  assert.equal(M.withoutMadeBy(walk, 'parcours'), null, 'le parcours en cours supprimé');
  assert.equal(M.withoutMadeBy(done, 'parcours'), done, 'le parcours terminé, fait sien : gardé');
  assert.equal(M.withoutMadeBy(mine, 'parcours'), mine, 'un lieu à soi : intact');
  // Made the user's own (promoted): no origin, where it came from kept, its entries too.
  const own = M.promoted(walk);
  assert.equal(own.properties.origin, undefined);
  assert.deepEqual(own.properties.from, { app: 'parcours' });
  assert.deepEqual(own.properties.plants.map(e => [e.origin ?? null, e.from]), [[null, { app: 'parcours' }], [null, { app: 'parcours' }]]);
  assert.equal(M.withoutMadeBy(own, 'parcours'), own);
  assert.deepEqual(toPortable([own]).features.map(f => col(f).properties.from), [{ app: 'parcours' }], 'gardé dans les exports');
  // A change by the user, not the altitudes the app asks for: makes it theirs.
  assert.equal(M.userChange(walk, { ...walk, properties: { ...walk.properties, plants: walk.properties.plants.map(e => ({ ...e, altitude: { m: 120, at: /** @type {[number, number]} */ ([2, 48]) } })) } }), false);
  assert.equal(M.userChange(walk, { ...walk, properties: { ...walk.properties, name: 'Autre nom' } }), true);
  // Said in the confirmation, with the counts.
  const parcours = defineMiniApp({ id: 'parcours', title: 'Parcours botanique', icon: 'geo-alt', exit: { label: 'Quitter' }, columns: [{ id: 'main', base: 'fill', min: 300, rank: 1 }],
    owns: { made: { label: 'le parcours en cours', kept: ['Votre parcours enregistré dans Mes plantes est conservé.', 'Vos {n} parcours enregistrés dans Mes plantes sont conservés.'] } },
    steps: [{ id: 'start', kind: 'start', label: 'Départ', start: () => ({}) }] });
  assert.deepEqual(replayItems(parcours, M.madeBy(all, 'parcours')), { gone: ['le parcours en cours « Chemin » (2 plantes)', 'la partie en cours'],
    kept: ['Votre parcours enregistré dans Mes plantes est conservé.'] });
  assert.deepEqual(replayItems(parcours, { favorites: [], collections: [], kept: { favorites: 0, collections: 3 } }).kept, ['Vos 3 parcours enregistrés dans Mes plantes sont conservés.']);
  const meet = defineMiniApp({ ...parcours, id: 'rencontres', title: 'Rencontres', owns: {} });
  assert.deepEqual(replayItems(meet, { favorites: [fav.properties.plants[0], fav.properties.plants[0]], collections: [], kept: { favorites: 0, collections: 0 } }),
    { gone: ['2 favoris ajoutés par Rencontres', 'la partie en cours'], kept: [] });
});

test('avant les origines : le parcours en cours et les vides tagués ; les parcours terminés et tous les favoris, déjà à soi', () => {
  const mine = col({ type: 'Feature', id: 'm', geometry: { type: 'Point', coordinates: [2, 48] }, properties: { name: 'Jardin', plants: [{ plantId: 6, scientificName: 'F' }] } });
  const old = col({ type: 'Feature', id: 'favorites', geometry: null, properties: { plants: [{ plantId: 1, scientificName: 'A' }, { plantId: 2, scientificName: 'B' }, { plantId: 9, scientificName: 'Z' }] } });
  const empty = col({ type: 'Feature', id: 'e', geometry: { type: 'Point', coordinates: [2, 48] }, properties: { name: 'Vide', startedHere: true, plants: [] } });
  const finished = col({ type: 'Feature', id: 'f', geometry: { type: 'Point', coordinates: [2, 48] }, properties: { name: 'Fini', plants: [{ plantId: 4, scientificName: 'D' }] } });
  const current = col({ type: 'Feature', id: 'c', geometry: { type: 'Point', coordinates: [2, 48] }, properties: { name: 'En cours', plants: [{ plantId: 5, scientificName: 'E' }] } });
  const tagged = M.tagLegacy([old, empty, finished, current, mine], { walks: ['f'], walk: 'c' });
  const by = Object.fromEntries(tagged.map(c => [c.id, c]));
  assert.equal(by.favorites, undefined, 'les favoris d’avant sont à soi : jamais tagués');
  assert.deepEqual(by.e.properties.origin, { app: 'parcours' });
  assert.deepEqual(by.c.properties.origin, { app: 'parcours' });
  assert.deepEqual([by.f.properties.origin, by.f.properties.from], [undefined, { app: 'parcours' }], 'terminé avec ses plantes : gardé');
  assert.equal(by.m, undefined, 'un lieu à soi n’est pas tagué');
});

test('runtime : « Rejouer » ne laisse rien derrière lui, comme jamais ouverte', async () => {
  localStorage.clear();
  const m = defineMiniApp({ id: 'cueillette-t', title: 'Cueillette', icon: 'leaf', exit: { label: 'Quitter' }, columns: [{ id: 'main', base: 'fill', min: 300, rank: 1 }],
    context: { point: { init: null, persist: true }, matches: { init: [], persist: true } },
    steps: [{ id: 'start', kind: 'start', label: 'Départ', next: 'map', start: () => ({}) }, { id: 'map', label: 'Carte', can: c => Boolean(c.point) }] });
  const before = footprint();
  const opened = new MiniApp(m);
  opened.dispose();
  assert.equal(localStorage.getItem(storageKey('cueillette-t', 'state')), null, 'ouverte puis quittée au départ : rien d’écrit');
  const app = new MiniApp(m);
  app.set({ point: [2, 48], matches: [3] });
  app.go('map');
  app.flush();
  assert.ok(localStorage.getItem(storageKey('cueillette-t', 'state')));
  localStorage.setItem(storageKey('cueillette-t', 'layout'), '{"widths":{}}');
  await app.replay();
  app.dispose();
  assert.equal(localStorage.getItem(storageKey('cueillette-t', 'state')), null);
  assert.equal(localStorage.getItem(storageKey('cueillette-t', 'layout')), null);
  assert.deepEqual(footprint(), before);
});
