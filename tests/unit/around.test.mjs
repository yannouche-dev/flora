// The games around a place (Rencontres, Cueillette prudente, Mosaïque): the pure part of their cards
// (app/miniapp/kit/cards.js — Cueillette prudente's order, the safety lines of a card's bio, the swipes), each game's
// own session and its hand-over from the shared one of before (core/around-sessions.js), and what a mini-app made in
// Mes plantes, taken away by « Recommencer » (place-model.js#madeBy, withoutMadeBy, tagLegacy; runtime.js#replayItems).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bio, deckOf, distLabel, ethnoSentence, harvestOrder, nextDistance, swipe, unswipe } from '../../app/miniapp/kit/cards.js';
import { lookalikesOf } from '../../app/core/lookalikes.js';
import { UNREAD } from '../../app/core/alerts.js';
import { aroundKept, forgetPlaces, keptPlace, leftAt, migrateDiscover, clearAroundGames } from '../../app/core/around-sessions.js';
import * as M from '../../app/core/place-model.js';
import { toPortable } from '../../app/core/portable.js';
import { defineMiniApp } from '../../app/miniapp/define.js';
import { MiniApp, replayItems, storageKey } from '../../app/miniapp/runtime.js';

const plants = JSON.parse(await readFile(new URL('../fixtures/plants.json', import.meta.url), 'utf8'));
const plant = (/** @type {string} */ name) => plants.find((/** @type {any} */ x) => x.scientificName === name);
/** A card of the deck. @param {string} name @param {Partial<import('../../app/miniapp/kit/cards.js').Card>} [more] */
const card = (name, more = {}) => ({ plant: plant(name), count: 10, photo: null, credit: null, blooming: false, alerts: null, ...more });

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
  const lines = bio(ail, new Set());
  assert.match(lines[0], /^⚠️ Ne me confondez pas avec Colchique \(mortel\)\. Partie : feuilles\.$/);
  const cigue = card('Conium maculatum', { alerts: { safety: { tone: 'danger', text: ['Liste B de l’ANSM : toxicité de la plante'] }, edible: null } });
  cigue.confusions = await lookalikesOf(cigue.plant);
  const l2 = bio(cigue, new Set());
  assert.match(l2[0], /^☠️ Je suis le sosie .* de Persil plat\.$/);
  assert.ok(l2.includes('☠️ Liste B de l’ANSM : toxicité de la plante. On regarde, on ne goûte pas.'));
  const unread = bio(card('Urtica dioica', { alerts: { unread: true, safety: { tone: 'danger', text: [UNREAD] }, edible: null } }), new Set());
  assert.equal(unread[0], '⚠️ ' + UNREAD + '.', 'données illisibles : dites en premier');
  const toxicEdible = bio(card('Urtica dioica', { alerts: { toxic: true, safety: null, edible: { text: ['a', 'b'], parts: ['feuilles'] } } }), new Set());
  assert.ok(toxicEdible.some(l => l === '⚠️ J’ai des sosies dangereux (2). Lisez ma fiche avant toute cueillette.'));
  assert.ok(!toxicEdible.some(l => /à table/.test(l)));
  assert.ok(bio(card('Urtica dioica'), new Set()).length <= 4, 'quatre lignes au plus');
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

test('sessions : la partie partagée d’avant donnée à la dernière jouée (sinon Rencontres), une fois ; « Oublier ma position »', () => {
  localStorage.clear();
  const old = { point: [2.35, 48.85], place: 'Paris', radius: 2000, matches: [7], passed: [8] };
  localStorage.setItem('geoflora.app.rencontres.state', JSON.stringify({ v: 1, path: ['start', 'map', 'cards'], ctx: {}, finished: false }));
  migrateDiscover(old, '#/collections');
  assert.deepEqual(aroundKept('rencontres'), old, 'rien ne dit laquelle : Rencontres');
  assert.deepEqual([aroundKept('cueillette'), aroundKept('mosaique')], [{}, {}], 'les autres : rien, pas de « Continuer »');
  assert.equal(leftAt('rencontres'), 'cards', 'l’étape où on l’a laissée, gardée');
  assert.equal(leftAt('cueillette'), null);
  clearAroundGames();
  // Opened at the old address of a scenario: that one was played last.
  migrateDiscover(old, '#/discover?s=mosaic&p=3');
  assert.deepEqual(aroundKept('mosaique'), old);
  assert.deepEqual([aroundKept('rencontres'), aroundKept('cueillette')], [{}, {}]);
  clearAroundGames();
  migrateDiscover(old, '#/discover?s=harvest');
  assert.deepEqual(aroundKept('cueillette'), old);
  assert.equal(leftAt('cueillette'), 'start');
  assert.deepEqual(keptPlace(), { point: [2.35, 48.85], place: 'Paris' });
  forgetPlaces();
  assert.equal(keptPlace(), null);
  assert.deepEqual(aroundKept('cueillette').matches, [7], 'le reste de la partie gardé');
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
