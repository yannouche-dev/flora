// What the activities made in Mes plantes, and whose it is (app/core/collections.js), against an IndexedDB in memory
// (fake-indexeddb): one rule makes it the user's — anything the user changes, not the activity itself nor the
// altitudes the app asks for (updatePlace: the collection, an entry changed, a plant filed in a list or noted in a
// lieu; savePlace: a list or a lieu of the user's; promotePlace: the favourites shared or exported alone). And what the
// app asks before it erases or lets something leave the device: « Retirer la position » (refused, « Copier en liste »),
// a plant taken out, a link, a file — each text as said. And « Noter ici »: the lieux near, offered before a new one is
// made (never a parcours), and its « Annuler », which takes away the note only.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// db.js upgrades the schema only from a page (a worker opens whatever version exists).
/** @type {any} */ (globalThis).window ??= globalThis;
// No service answers here (the altitudes of a lieu are asked in the background): refused at once.
const nodeFetch = globalThis.fetch;
globalThis.fetch = /** @type {any} */ (async (/** @type {any} */ input, /** @type {any} */ init) =>
  String(input instanceof Request ? input.url : input).startsWith('file:') ? nodeFetch(input, init) : new Response('', { status: 503 }));

const db = await import('../../app/core/db.js');
const C = await import('../../app/core/collections.js');
const { normalizeCollection } = await import('../../app/core/place-model.js');

const plant = (/** @type {number} */ id) => ({ id, scientificName: 'Planta ' + id, vernacularNames: ['Plante ' + id] });
/** The favourites: plant id → [origin, from] (none: null). */
const favourites = async () => Object.fromEntries(((await C.getPlace(C.FAVORITES_ID))?.properties.plants ?? [])
  .map(e => [e.plantId, [e.origin?.app ?? null, e.from?.app ?? null]]));
/** The favourites made anew, those of a game (`origin`) and the user's. @param {[number, string | null][]} list */
async function favouritesOf(list) {
  await db.remove('spots', C.FAVORITES_ID).catch(() => {});
  for (const [id, app] of list) await C.toggleFavorite(plant(id), app ? { app } : undefined);
}

test('rien à promouvoir ni à reprendre sans favoris : aucun favori créé pour rien', async () => {
  await C.promoteFavorites([1, 2]);
  await C.promotePlace(C.FAVORITES_ID);
  assert.equal(await C.forgetFavoriteMadeBy(1, 'rencontres'), false);
  assert.equal(await C.adoptMadeBy(['rencontres']), 0);
  assert.equal(await C.forgetFavoriteEntry('e1', /** @type {any} */ ({ notes: '', rating: 0, abundance: 'moyen', harvests: [] })), false);
  assert.equal(await C.getPlace(C.FAVORITES_ID), undefined);
  // A list of the user's with plants, the favourites never made: still none.
  await C.savePlace(C.withPlant(C.newCollection('list', { name: 'Vide de favoris' }), plant(1)));
  assert.equal(await C.getPlace(C.FAVORITES_ID), undefined);
});

test('un favori de partie rangé dans une liste, ou noté de nouveau dans un lieu, est à vous ; une altitude ne change rien', async () => {
  await favouritesOf([[1, 'rencontres'], [2, 'rencontres'], [3, 'cueillette'], [4, null]]);
  const list = await C.savePlace(C.newCollection('list', { name: 'Cuisine' }));
  await C.setInCollection(list.id, plant(1), true);
  assert.deepEqual(await favourites(), { 1: [null, 'rencontres'], 2: ['rencontres', null], 3: ['cueillette', null], 4: [null, null] });
  // A lieu holding the plant already: noted there again (another occurrence) makes its favourite the user's too.
  const place = await C.savePlace(C.withPlant(C.newPlace([2.35, 48.85], { name: 'Bois', origin: { app: 'parcours' } }), plant(2)));
  assert.deepEqual((await favourites())[2], ['rencontres', null], 'un lieu fait par une activité : rien n’est à vous');
  await C.updatePlace(place.id, c => C.withPlant(c, plant(2), undefined, { again: true }), { by: 'parcours' });
  assert.deepEqual((await favourites())[2], ['rencontres', null], 'ajouté par l’activité elle-même : rien n’est à vous');
  // The altitudes the app asks for: no change by the user — the lieu stays the activity's, nothing promoted.
  const high = await C.updatePlace(place.id, c => ({ ...c, properties: { ...c.properties,
    plants: c.properties.plants.map(e => ({ ...e, altitude: { m: 120, at: /** @type {[number, number]} */ (e.coordinates) } })) } }));
  assert.deepEqual(high.properties.origin, { app: 'parcours' });
  assert.deepEqual((await favourites())[2], ['rencontres', null]);
  // Noted again by the user: the lieu and the favourite are theirs.
  await C.updatePlace(place.id, c => C.withPlant(c, plant(2), undefined, { again: true }));
  assert.deepEqual((await C.getPlace(place.id))?.properties.from, { app: 'parcours' });
  assert.deepEqual((await favourites())[2], [null, 'rencontres']);
  // A new list of the user's (« Ajouter à… », « Noter ici », a link saved) with the plant: its favourite is theirs.
  await C.savePlace(C.withPlant(C.newCollection('list', { name: 'Tisanes' }), plant(3)));
  assert.deepEqual(await favourites(), { 1: [null, 'rencontres'], 2: [null, 'rencontres'], 3: [null, 'cueillette'], 4: [null, null] });
});

test('un favori de partie annoté, noté ou récolté dans les Favoris est à vous ; les Favoris partagés ou exportés seuls aussi', async () => {
  await favouritesOf([[1, 'rencontres'], [2, 'rencontres'], [3, 'mosaique']]);
  const entry = /** @type {any} */ (C.findEntry(/** @type {any} */ (await C.getPlace(C.FAVORITES_ID)), 1));
  await C.updatePlace(C.FAVORITES_ID, c => C.withEntry(c, entry.id, { notes: 'Près du lavoir' }));
  assert.deepEqual(await favourites(), { 1: [null, 'rencontres'], 2: ['rencontres', null], 3: ['mosaique', null] });
  // The editor's way (place-model.js rebase): a rating given.
  const base = /** @type {any} */ (await C.getPlace(C.FAVORITES_ID));
  await C.savePatch(base, C.withEntry(base, 2, { rating: 4 }));
  assert.deepEqual(await favourites(), { 1: [null, 'rencontres'], 2: [null, 'rencontres'], 3: ['mosaique', null] });
  // Shared or exported alone: every favourite of a match in them.
  await C.promotePlace(C.FAVORITES_ID);
  assert.deepEqual(await favourites(), { 1: [null, 'rencontres'], 2: [null, 'rencontres'], 3: [null, 'mosaique'] });
  // Nothing left to promote: nothing written.
  const before = (await C.getPlace(C.FAVORITES_ID))?.properties.updatedAt;
  await C.promotePlace(C.FAVORITES_ID);
  await C.promoteFavorites([1, 2, 3]);
  assert.equal((await C.getPlace(C.FAVORITES_ID))?.properties.updatedAt, before);
});

test('un cœur n’enlève jamais un favori ; reprendre celui d’une partie, ou celui d’un cœur tel qu’il l’a laissé', async () => {
  await favouritesOf([[4, null]]);
  // A heart on a favourite already (a stale ♥ in this tab): nothing added, nothing removed.
  assert.equal(await C.addFavorite(plant(4), { app: 'rencontres' }), null);
  assert.deepEqual(await favourites(), { 4: [null, null] });
  const added = await C.addFavorite(plant(5), { app: 'rencontres' });
  assert.equal(added?.plantId, 5);
  assert.equal(await C.addFavorite(plant(5), { app: 'rencontres' }), null, 'une fois');
  assert.deepEqual(await favourites(), { 4: [null, null], 5: ['rencontres', null] });
  // Taken back by its game only, while it is the game's.
  assert.equal(await C.forgetFavoriteMadeBy(4, 'rencontres'), false, 'un favori à vous reste');
  assert.equal(await C.forgetFavoriteMadeBy(5, 'mosaique'), false, 'une autre partie ne le reprend pas');
  assert.equal(await C.forgetFavoriteMadeBy(5, 'rencontres'), true);
  assert.deepEqual(await favourites(), { 4: [null, null] });
  // The deck of a layout (no origin): ↺ takes back the entry its heart added, as it left it — rated since, it stays.
  const one = /** @type {any} */ (await C.addFavorite(plant(6)));
  const two = /** @type {any} */ (await C.addFavorite(plant(7)));
  await C.updatePlace(C.FAVORITES_ID, c => C.withEntry(c, two.id, { rating: 3 }));
  assert.equal(await C.forgetFavoriteEntry(one.id, one), true);
  assert.equal(await C.forgetFavoriteEntry(two.id, two), false);
  assert.equal(await C.forgetFavoriteEntry(one.id, one), false, 'déjà repris');
  assert.deepEqual(await favourites(), { 4: [null, null], 7: [null, null] });
});

test('« Revoir les premiers pas » : les favoris des parties nommées deviennent les vôtres, en une fois, et pas les autres', async () => {
  await favouritesOf([[1, 'rencontres'], [2, 'cueillette'], [3, 'faux-amis'], [4, null]]);
  assert.equal(await C.adoptMadeBy(['rencontres']), 1);
  assert.deepEqual(await favourites(), { 1: [null, 'rencontres'], 2: ['cueillette', null], 3: ['faux-amis', null], 4: [null, null] });
  assert.equal(await C.adoptMadeBy(['rencontres', 'cueillette', 'mosaique']), 1);
  assert.deepEqual(await favourites(), { 1: [null, 'rencontres'], 2: [null, 'cueillette'], 3: ['faux-amis', null], 4: [null, null] });
  // Adopted: « Recommencer » the game takes nothing back.
  assert.equal(await C.forgetMadeBy('rencontres'), 0);
  assert.equal(await C.adoptMadeBy(['rencontres', 'cueillette', 'mosaique']), 0, 'rien de plus');
});

// ── « Retirer la position » : demandée, ou refusée avec « Copier en liste » ──

const AT = /** @type {[number, number]} */ ([2.35, 48.85]);
/** A lieu « Bois » at AT holding these plants (normalized as stored). @param {any[]} plants @param {any} [more] */
const bois = (plants, more = {}) => /** @type {any} */ (normalizeCollection({ type: 'Feature', id: 'bois', geometry: { type: 'Point', coordinates: AT },
  properties: { name: 'Bois', createdAt: '2026-05-01T10:00:00.000Z', updatedAt: '2026-05-01T10:00:00.000Z', plants, ...more } }));

test('locationQuestion : refusée quand la liste perdrait quelque chose, chaque texte ; sinon demandée', () => {
  const refused = (/** @type {string} */ parts) => ({ refused: true, title: 'Le lieu garde sa position',
    text: `Une liste n’a pas de position et ne note chaque plante qu’une fois : retirer la position effacerait ${parts}. « Copier en liste » crée une liste de ses plantes ; le lieu garde ses positions.` });
  const away = (/** @type {number} */ id, /** @type {any} */ more = {}) => ({ id: 'e' + id + (more.id ?? ''), plantId: id, coordinates: [2.351, 48.85], ...more });
  assert.deepEqual(C.locationQuestion(bois([away(1)])), refused('la position d’une plante'));
  assert.deepEqual(C.locationQuestion(bois([away(1), away(2)])), refused('les positions de 2 plantes'));
  assert.deepEqual(C.locationQuestion(bois([{ plantId: 1 }, { plantId: 1, id: 'b' }])), refused('les autres fois où une plante est notée'));
  assert.deepEqual(C.locationQuestion(bois([{ plantId: 1 }, { plantId: 1, id: 'b' }, { plantId: 2 }, { plantId: 2, id: 'c' }])), refused('les autres fois où 2 plantes sont notées'));
  assert.deepEqual(C.locationQuestion(bois([], { walk: true })), refused('le tracé du parcours'));
  assert.deepEqual(C.locationQuestion(bois([away(1), away(2), { plantId: 2, id: 'x' }], { walk: true })),
    refused('les positions de 2 plantes, les autres fois où une plante est notée et le tracé du parcours'));
  // Nothing lost: asked, its harvest logs said to stay when there are some.
  assert.deepEqual(C.locationQuestion(bois([{ plantId: 1, coordinates: AT, accuracy: 6 }])),
    { refused: false, title: 'Retirer la position ?', yes: 'Retirer la position', text: 'Le lieu devient une liste de plantes.' });
  assert.equal(C.locationQuestion(bois([{ plantId: 1, harvests: [{ date: '2026-05-02' }] }])).text,
    'Le lieu devient une liste de plantes. Ses journaux de récolte restent, mais ne s’affichent que dans un lieu.');
});

test('asList puis copyAsList : chaque plante une fois, notes réunies, ni position, ni récolte, ni origine ; le lieu inchangé', async () => {
  const place = bois([
    { id: 'o1', plantId: 1, notes: 'Près du ruisseau', rating: 2, coordinates: [2.351, 48.85], accuracy: 4, addedAt: '2026-05-02T08:00:00.000Z', harvests: [{ date: '2026-05-02' }] },
    { id: 'o2', plantId: 1, notes: 'Sous les frênes', rating: 5, abundance: 'abondant', coordinates: [2.352, 48.85], harvests: [{ date: '2026-06-02' }] },
    { id: 'o3', plantId: 2, notes: '', coordinates: AT, accuracy: 6, origin: { app: 'parcours' }, from: { app: 'parcours' } }
  ], { walk: true, startedHere: true, from: { app: 'parcours' }, notes: 'Accès par le pont' });
  const before = structuredClone(place);
  const list = C.asList(place, 'Bois (liste)');
  assert.deepEqual(list.properties.plants.map((/** @type {any} */ e) => [e.plantId, e.notes, e.rating, e.abundance, e.coordinates, e.accuracy, e.harvests, e.origin, e.from, e.addedAt]), [
    [1, 'Près du ruisseau\n\nSous les frênes', 5, 'abondant', null, null, [], undefined, undefined, '2026-05-02T08:00:00.000Z'],
    [2, '', 0, 'moyen', null, null, [], undefined, undefined, '2026-05-01T10:00:00.000Z']
  ]);
  assert.ok(list.properties.plants.every((/** @type {any} */ e) => !['o1', 'o2', 'o3'].includes(e.id)), 'de nouveaux identifiants');
  assert.deepEqual([list.geometry, list.properties.kind, list.properties.name, list.properties.notes, list.properties.walk, list.properties.startedHere,
    list.properties.origin, list.properties.from], [null, 'list', 'Bois (liste)', '', undefined, undefined, undefined, undefined]);
  assert.deepEqual(place, before, 'le lieu n’est pas touché');

  // Saved, against the base: the list « Bois (liste) » made, the lieu as it was.
  const stored = await C.savePlace(place);
  const copy = await C.copyAsList(stored.id);
  assert.equal(copy.properties.name, 'Bois (liste)');
  assert.deepEqual((await C.getPlace(copy.id))?.properties.plantIds, [1, 2]);
  assert.deepEqual(await C.getPlace(stored.id), stored);
  await db.remove('spots', stored.id);
  await assert.rejects(C.copyAsList(stored.id), { name: 'GoneError' });
});

// ── Retirer une plante : ce qui part, dit avant ──

test('removeQuestion : la note, le journal de récolte, les autres fois notées — dits, chaque texte ; rien à dire, rien demandé', () => {
  const ask = (/** @type {string} */ title, /** @type {string} */ text) => ({ title, text, yes: 'Retirer', danger: true });
  const one = (/** @type {any} */ e) => bois([{ id: 'o1', plantId: 1, vernacularName: 'Ortie dioïque', ...e }, { id: 'a1', plantId: 2, vernacularName: 'Ail des ours' }]);
  const harvest = [{ date: '2026-05-02', quantity: '1 kg' }];
  assert.deepEqual(C.removeQuestion(one({ notes: 'Jeunes pousses', harvests: harvest }), 'o1'),
    ask('Retirer Ortie dioïque de ce lieu ?', 'Sa note et son journal de récolte seront effacés.'));
  assert.deepEqual(C.removeQuestion(one({ notes: 'Jeunes pousses' }), 1), ask('Retirer Ortie dioïque de ce lieu ?', 'Sa note sera effacée.'));
  assert.deepEqual(C.removeQuestion(one({ harvests: harvest }), 'o1'), ask('Retirer Ortie dioïque de ce lieu ?', 'Son journal de récolte sera effacé.'));
  assert.equal(C.removeQuestion(one({ notes: '  ' }), 'o1'), null, 'rien que sa présence');
  assert.equal(C.removeQuestion(one({}), 'inconnue'), null);

  // Noted twice in a lieu: unticked (its plant id), every noting goes — and their positions.
  const twice = (/** @type {any} */ e) => bois([{ id: 'o1', plantId: 1, vernacularName: 'Ortie dioïque' }, { id: 'o2', plantId: 1, vernacularName: 'Ortie dioïque', ...e }]);
  assert.deepEqual(C.removeQuestion(twice({}), 1), ask('Retirer Ortie dioïque, notée 2 fois, de ce lieu ?', 'Ses 2 positions seront effacées.'));
  assert.deepEqual(C.removeQuestion(twice({ notes: 'n' }), 1), ask('Retirer Ortie dioïque, notée 2 fois, de ce lieu ?', 'Ses 2 positions et ses notes seront effacées.'));
  assert.deepEqual(C.removeQuestion(twice({ harvests: harvest }), 1), ask('Retirer Ortie dioïque, notée 2 fois, de ce lieu ?', 'Ses 2 positions et ses journaux de récolte seront effacés.'));
  assert.deepEqual(C.removeQuestion(twice({ notes: 'n', harvests: harvest }), 1),
    ask('Retirer Ortie dioïque, notée 2 fois, de ce lieu ?', 'Ses 2 positions, ses notes et ses journaux de récolte seront effacés.'));
  // One of them (its entry id, the editor's ✕): which one, as the editor numbers them.
  assert.deepEqual(C.removeQuestion(twice({ notes: 'n' }), 'o2'), ask('Retirer Ortie dioïque n° 2 de ce lieu ?', 'Sa note sera effacée.'));
  assert.equal(C.removeQuestion(twice({ notes: 'n' }), 'o1'), null);

  // A list, the favourites: no position; said where.
  const list = /** @type {any} */ (normalizeCollection({ type: 'Feature', id: 'l', geometry: null, properties: { kind: 'list', name: 'Cuisine',
    plants: [{ plantId: 1, vernacularName: 'Ortie dioïque', notes: 'soupe' }, { plantId: 2, vernacularName: 'Ail des ours' }] } }));
  assert.deepEqual(C.removeQuestion(list, 1), ask('Retirer Ortie dioïque de cette liste ?', 'Sa note sera effacée.'));
  assert.equal(C.removeQuestion(list, 2), null);
  const favourites = /** @type {any} */ (normalizeCollection({ type: 'Feature', id: C.FAVORITES_ID, geometry: null,
    properties: { plants: [{ plantId: 2, vernacularName: 'Ail des ours', harvests: harvest }] } }));
  assert.deepEqual(C.removeQuestion(favourites, 2), ask('Retirer Ail des ours des favoris ?', 'Son journal de récolte sera effacé.'));
  // A list holding a plant twice (from before): its notes said, no positions.
  const doubled = /** @type {any} */ (normalizeCollection({ type: 'Feature', id: 'd', geometry: null, properties: { kind: 'list',
    plants: [{ id: 'x', plantId: 1, vernacularName: 'Ortie dioïque', notes: 'a' }, { id: 'y', plantId: 1, vernacularName: 'Ortie dioïque' }] } }));
  assert.deepEqual(C.removeQuestion(doubled, 1), ask('Retirer Ortie dioïque, notée 2 fois, de cette liste ?', 'Ses notes seront effacées.'));
  assert.equal(C.removeQuestion({ ...doubled, properties: { ...doubled.properties, plants: doubled.properties.plants.map((/** @type {any} */ e) => ({ ...e, notes: '' })) } }, 1), null);
});

// ── Partager, exporter : la position, les notes et les récoltes, dites avant ──

test('positionQuestion, fileQuestion : la position comptée, le départ d’un parcours ; ce qu’un fichier dit de vous', () => {
  const link = (/** @type {string} */ text) => ({ title: 'Partager ce lieu ?', yes: 'Partager', text });
  assert.deepEqual(C.positionQuestion(bois([{ plantId: 1 }])), link('Le lien contiendra la position exacte de ce lieu et de sa plante.'));
  assert.deepEqual(C.positionQuestion(bois([{ plantId: 1 }, { plantId: 2 }, { plantId: 3 }])), link('Le lien contiendra la position exacte de ce lieu et de ses 3 plantes.'));
  assert.deepEqual(C.positionQuestion(bois([{ plantId: 1 }, { plantId: 1, id: 'b' }, { plantId: 1, id: 'c' }])),
    link('Le lien contiendra la position exacte de ce lieu et de sa plante, notée 3 fois.'));
  assert.deepEqual(C.positionQuestion(bois([{ plantId: 1 }, { plantId: 1, id: 'b' }, { plantId: 2 }])),
    link('Le lien contiendra la position exacte de ce lieu et de ses 2 plantes, notées 3 fois.'));
  assert.deepEqual(C.positionQuestion(bois([])), link('Le lien contiendra la position exacte de ce lieu.'));
  // A parcours started where the walker stood: its start said.
  assert.deepEqual(C.positionQuestion(bois([{ plantId: 1 }, { plantId: 2 }], { walk: true, startedHere: true })), { title: 'Partager le parcours ?', yes: 'Partager',
    text: 'Le lien contiendra la position exacte de ce parcours et de ses 2 plantes. Son départ est la position où vous étiez quand vous l’avez commencé.' });
  assert.equal(C.positionQuestion(bois([{ plantId: 1 }], { walk: true })).text, 'Le lien contiendra la position exacte de ce parcours et de sa plante.');
  // No point: nothing to ask.
  const list = /** @type {any} */ (normalizeCollection({ type: 'Feature', id: 'l', geometry: null, properties: { kind: 'list', name: 'Cuisine', plants: [{ plantId: 1 }] } }));
  const favourites = /** @type {any} */ (normalizeCollection({ type: 'Feature', id: C.FAVORITES_ID, geometry: null, properties: { plants: [{ plantId: 2, notes: 'Au jardin' }] } }));
  assert.equal(C.positionQuestion(list), null);
  assert.equal(C.positionQuestion(favourites), null);

  const file = (/** @type {string} */ text) => ({ title: 'Envoyer ce fichier ?', yes: 'Envoyer', text });
  assert.deepEqual(C.fileQuestion([bois([{ plantId: 1, notes: 'Jeunes pousses', harvests: [{ date: '2026-05-02' }] }])]),
    file('Le fichier contient la position exacte de ce lieu et de sa plante, vos notes et vos journaux de récolte.'));
  assert.deepEqual(C.fileQuestion([bois([{ plantId: 1 }], { notes: 'Accès par le pont' })]), file('Le fichier contient la position exacte de ce lieu et de sa plante et vos notes.'));
  assert.equal(C.fileQuestion([list]), null, 'une liste sans notes ne dit rien de vous');
  assert.deepEqual(C.fileQuestion([favourites]), file('Le fichier contient vos notes.'));
});

test('shareCollection : la position demandée d’abord ; refusée, rien ne part ni ne change ; partagée, à vous', async () => {
  /** @type {string[]} */
  const copied = [];
  Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: { writeText: async (/** @type {string} */ t) => { copied.push(t); } } });
  const walk = await C.savePlace(C.withPlant(C.newPlace(AT, { name: 'Chemin du lavoir', walk: true, startedHere: true, origin: { app: 'parcours' } }), plant(1)));
  /** @type {any[]} */
  const asked = [];
  const answer = (/** @type {boolean} */ yes) => async (/** @type {any} */ q) => { asked.push(q); return yes; };
  assert.equal(await C.shareCollection(walk, answer(false)), 'refused');
  assert.equal(asked[0].title, 'Partager le parcours ?');
  assert.deepEqual([copied, (await C.getPlace(walk.id))?.properties.origin], [[], { app: 'parcours' }], 'refusé : rien copié, toujours au Parcours');
  assert.equal(await C.shareCollection(walk, answer(true)), 'copied');
  assert.match(copied[0], /#\/shared\?d=z/);
  const shared = await C.getPlace(walk.id);
  assert.deepEqual([shared?.properties.origin, shared?.properties.from], [undefined, { app: 'parcours' }], 'partagé : à vous');
  // A list: no position, nothing asked.
  const list = await C.savePlace(C.withPlant(C.newCollection('list', { name: 'Cuisine' }), plant(2)));
  assert.equal(await C.shareCollection(list, answer(false)), 'copied');
  assert.equal(asked.length, 2);
  await db.remove('spots', walk.id);
  await db.remove('spots', list.id);
});

// ── « Noter ici » : les lieux proches, offerts avant ; « Annuler » ne retire que la note ──

/** Far from the lieux of the tests above. */
const HERE = /** @type {[number, number]} */ ([5.72, 45.19]);
/** `m` metres north of HERE. @param {number} m @returns {[number, number]} */
const north = m => [HERE[0], HERE[1] + m / 111195];

test('placesNear : les lieux à moins de 100 m, les trois plus proches d’abord ; jamais un parcours, ni le lieu exclu', async () => {
  assert.equal(C.NEAR_PLACE, 100);
  const save = (/** @type {string} */ name, /** @type {number} */ m, more = {}) => C.savePlace(C.newPlace(north(m), { name, ...more }));
  const kept = await save('Lisière', 99.5), out = await save('Trop loin', 101);
  // Stored to 1e-7° (about 1 cm): the distances as stored, first.
  assert.ok(C.distance(HERE, /** @type {any} */ (kept.geometry).coordinates) <= 100);
  assert.ok(C.distance(HERE, /** @type {any} */ (out.geometry).coordinates) > 100);
  // Two parcours closer still (one made by the Parcours, one received marked): their point is only where they started.
  const walks = [await save('Parcours du matin', 10, { origin: { app: 'parcours' } }), await save('Parcours reçu', 20, { walk: true })];
  const names = async (/** @type {string | undefined} */ exclude) => (await C.placesNear(HERE, exclude)).map(r => r.place.properties.name);
  assert.deepEqual(await names(), ['Lisière']);
  const pre = await save('Pré', 30), others = [await save('Haie', 60), await save('Mare', 80)];
  const near = await C.placesNear(HERE);
  assert.deepEqual(near.map(r => [r.place.properties.name, Math.round(r.distance)]), [['Pré', 30], ['Haie', 60], ['Mare', 80]], 'les trois plus proches');
  assert.deepEqual(await names(pre.id), ['Haie', 'Mare', 'Lisière'], 'sans le lieu exclu');
  for (const c of [kept, out, ...walks, pre, ...others]) await db.remove('spots', c.id);
});

test('undoNewPlace : la note seule retirée ; le lieu qu’elle a créé supprimé seulement s’il est resté vide', async () => {
  /** A new lieu « Noter ici » made, and the entry it noted. @returns {Promise<[any, string]>} */
  const noted = async () => {
    const place = C.withPlant(C.newPlace(HERE, { accuracy: 8 }), plant(7), { coordinates: HERE, accuracy: 8 });
    return [await C.savePlace(place), /** @type {any} */ (C.lastEntry(place)).id];
  };
  let [p, e] = await noted();
  await C.undoNewPlace(p.id, e);
  assert.equal(await C.getPlace(p.id), undefined, 'resté vide : supprimé');
  // Named, or given notes, meanwhile (its editor, another tab): kept, without the plant.
  [p, e] = await noted();
  await C.updatePlace(p.id, c => ({ ...c, properties: { ...c.properties, name: 'Mon coin' } }));
  await C.undoNewPlace(p.id, e);
  assert.deepEqual([(await C.getPlace(p.id))?.properties.name, (await C.getPlace(p.id))?.properties.plantIds], ['Mon coin', []]);
  await db.remove('spots', p.id);
  [p, e] = await noted();
  await C.updatePlace(p.id, c => ({ ...c, properties: { ...c.properties, notes: 'Accès par le pont' } }));
  await C.undoNewPlace(p.id, e);
  assert.equal((await C.getPlace(p.id))?.properties.notes, 'Accès par le pont');
  await db.remove('spots', p.id);
  // Another plant noted in it meanwhile: kept, with it.
  [p, e] = await noted();
  await C.updatePlace(p.id, c => C.withPlant(c, plant(8)));
  await C.undoNewPlace(p.id, e);
  assert.deepEqual((await C.getPlace(p.id))?.properties.plantIds, [8]);
  // Undone twice: the second changes nothing.
  const before = await C.getPlace(p.id);
  await C.undoNewPlace(p.id, e);
  assert.deepEqual(await C.getPlace(p.id), before);
  await db.remove('spots', p.id);
  // Deleted already: nothing thrown, nothing made again.
  [p, e] = await noted();
  await C.deletePlace(p.id);
  await C.undoNewPlace(p.id, e);
  assert.equal(await C.getPlace(p.id), undefined);
});
