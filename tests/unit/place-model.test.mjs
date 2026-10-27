// app/core/place-model.js (the shape of a collection, for the database, imports and links) and app/core/portable.js
// (its slim GeoJSON: export file, backup, transfer link). Round trip: what toPortable writes, normalizeCollection
// reads back as it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../app/core/place-model.js';
import { FORMAT_VERSION, hasPersonal, toPortable } from '../../app/core/portable.js';
import { random } from './support/random.mjs';

const DATE = '2026-05-01T10:00:00.000Z';

test('validCoordinates : bornes, 7 décimales', () => {
  assert.deepEqual(M.validCoordinates([2.123456789, 48.987654321]), [2.1234568, 48.9876543]);
  assert.equal(M.validCoordinates([200, 0]), null);
  assert.equal(M.validCoordinates([0, 91]), null);
  assert.equal(M.validCoordinates(['2', 48]), null);
  assert.equal(M.validCoordinates(null), null);
});

test('normalizeHarvests : dates valides seulement, la plus récente d’abord, textes bornés', () => {
  const h = M.normalizeHarvests([{ date: '2025-06-01' }, { date: 'hier' }, { date: '2026-04-02T08:00', quantity: 'q'.repeat(300), note: 1 }, null]);
  assert.deepEqual(h.map(x => x.date), ['2026-04-02', '2025-06-01']);
  assert.equal(h[0].quantity.length, 200);
  assert.equal(h[0].note, '');
  assert.deepEqual(M.normalizeHarvests('pas une liste'), []);
});

test('normalizeEntry : valeurs par défaut, abondance et note bornées, position du lieu à défaut de la sienne', () => {
  const e = M.normalizeEntry({ plantId: 128268, abundance: 'énorme', rating: 9.4 }, DATE, [2.35, 48.85]);
  assert.equal(e.id, 'p128268');
  assert.equal(e.abundance, 'moyen');
  assert.equal(e.rating, 5);
  assert.equal(e.addedAt, DATE);
  assert.deepEqual(e.coordinates, [2.35, 48.85]);
  assert.equal(e.accuracy, null);
  const inList = M.normalizeEntry({ plantId: 1, coordinates: [2, 48], accuracy: 5 }, DATE);
  assert.equal(inList.coordinates, null, 'une liste ne garde pas de position');
  const unknown = M.normalizeEntry({ plantId: 'x', scientificName: 'Rubus sp.' }, DATE);
  assert.equal(unknown.plantId, null);
  assert.equal(unknown.id, 'pRubus_sp_');
});

test('normalizeCollection : format 1 (une plante par point), liste, favoris, entrées invalides', () => {
  const v1 = M.normalizeCollection({ type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [2, 48] }, properties: { plantId: 5, notes: 'n', createdAt: DATE } });
  assert.equal(v1?.properties.kind, 'place');
  assert.deepEqual(v1?.properties.plantIds, [5]);
  assert.equal(v1?.properties.plants[0].notes, 'n', 'la note du format 1 passe à la plante');
  assert.equal(v1?.properties.notes, '');
  const fav = M.normalizeCollection({ type: 'Feature', id: M.FAVORITES_ID, geometry: null, properties: { kind: 'list', name: 'x', plants: [{ plantId: 1 }, { plantId: 1, id: 'p1' }] } });
  assert.equal(fav?.properties.kind, 'favorites');
  assert.equal(fav?.properties.name, 'Favoris');
  assert.deepEqual(fav?.properties.plants.map(e => e.id), ['p1', 'p1-2'], 'identifiants rendus uniques');
  assert.equal(M.normalizeCollection({ type: 'Feature', geometry: { type: 'Point', coordinates: [500, 0] }, properties: {} }), null);
  assert.equal(M.normalizeCollection({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} }), null);
  assert.equal(M.normalizeCollection({ type: 'Point' }), null);
  const placeWithoutPoint = M.normalizeCollection({ type: 'Feature', id: 'b', geometry: null, properties: { kind: 'place' } });
  assert.equal(placeWithoutPoint?.properties.kind, 'list');
});

test('normalizeCollection : un parcours, marqué ou fait par le Parcours ; jamais sans point, jamais deviné', () => {
  const at = { type: 'Point', coordinates: [2, 48] };
  const walk = (/** @type {any} */ geometry, /** @type {any} */ properties) =>
    M.normalizeCollection({ type: 'Feature', id: 'w', geometry, properties: { plants: [], ...properties } })?.properties.walk;
  assert.equal(walk(at, { walk: true }), true);
  assert.equal(walk(at, { origin: { app: 'parcours' } }), true, 'en cours, d’avant la marque (un fichier, une copie, un lien)');
  assert.equal(walk(at, { from: { app: 'parcours' } }), true, 'terminé, d’avant la marque');
  assert.equal(walk(at, { origin: { app: 'rencontres' } }), undefined);
  assert.equal(walk(at, { notes: 'Parcours botanique', startedHere: true }), undefined, 'ni d’après un texte, ni d’après son départ');
  assert.equal(walk(at, { walk: 'oui' }), undefined);
  assert.equal(walk(null, { walk: true, origin: { app: 'parcours' } }), undefined, 'une liste n’est pas un parcours');
  assert.equal(walk(null, { kind: 'place', walk: true }), undefined);
});

test('toPortable : seulement ce que l’utilisateur a saisi ; sans le personnel sur demande', () => {
  const place = /** @type {M.Collection} */ (M.normalizeCollection({ type: 'Feature', id: 'p', geometry: { type: 'Point', coordinates: [2.35, 48.85] }, properties: {
    kind: 'place', name: 'Bois', notes: 'secret', createdAt: DATE, updatedAt: DATE, walk: true, startedHere: true,
    plants: [
      { plantId: 1, abundance: 'rare', notes: 'cueilli', harvests: [{ date: '2026-05-02', quantity: '1 kg' }], coordinates: [2.3501, 48.8501], accuracy: 4 },
      { plantId: 2, coordinates: [2.35, 48.85], accuracy: 30, addedAt: '2026-05-01T10:20:00.000Z' }
    ] } }));
  const full = toPortable([place]);
  assert.equal(full.formatVersion, 6);
  assert.equal(full.formatVersion, FORMAT_VERSION);
  const [f] = full.features;
  assert.equal(f.properties.notes, 'secret');
  // A parcours, started where the walker stood: said (format 6), and read back.
  assert.equal(f.properties.walk, true);
  assert.equal(f.properties.startedHere, true);
  assert.deepEqual([M.normalizeCollection(f)?.properties.walk, M.normalizeCollection(f)?.properties.startedHere], [true, true]);
  assert.deepEqual(f.properties.plants[0], { plantId: 1, abundance: 'rare', coordinates: [2.3501, 48.8501], accuracy: 4, notes: 'cueilli', harvests: [{ date: '2026-05-02', quantity: '1 kg' }] });
  // The day it was noted kept (the order a walk met its plants), but the creation's, which a reader falls back on.
  assert.deepEqual(f.properties.plants[1], { plantId: 2, addedAt: '2026-05-01T10:20:00.000Z' }, 'au point du lieu, abondance par défaut : sa date seule');
  assert.equal(M.normalizeCollection(f)?.properties.plants[1].addedAt, '2026-05-01T10:20:00.000Z');
  assert.equal(M.normalizeCollection(f)?.properties.plants[0].addedAt, DATE);
  // A list is no parcours: neither mark is written.
  const list = /** @type {M.Collection} */ (M.normalizeCollection({ type: 'Feature', id: 'l', geometry: null, properties: { kind: 'list', name: 'L', walk: true, startedHere: true, plants: [] } }));
  assert.deepEqual([list.properties.walk, list.properties.startedHere], [undefined, undefined]);
  assert.deepEqual(Object.keys(toPortable([list]).features[0].properties), ['name', 'createdAt', 'updatedAt', 'plants']);
  assert.ok(hasPersonal(full));
  const shared = toPortable([place], { personal: false });
  assert.equal(shared.features[0].properties.notes, undefined);
  assert.equal(hasPersonal(shared), false);
});

test('propriété : normalizeCollection(toPortable(c)) rend la collection (300 collections tirées au hasard)', () => {
  const rnd = random(7);
  const pick = (/** @type {any[]} */ a) => a[rnd(a.length)];
  for (let run = 0; run < 300; run++) {
    const kind = pick(['place', 'place', 'list', 'favorites']);
    const at = /** @type {[number, number]} */ ([Math.round((-5 + rnd(14000) / 1000) * 1e6) / 1e6, Math.round((42 + rnd(9000) / 1000) * 1e6) / 1e6]);
    const plants = Array.from({ length: rnd(8) }, (_, i) => ({
      id: 'e' + run + '-' + i, plantId: rnd(5) ? 1000 + rnd(50) : null, scientificName: 'Planta ' + i,
      abundance: pick(['rare', 'moyen', 'abondant']), rating: rnd(6), notes: rnd(2) ? '' : 'note ' + i + ' « été » 🌿',
      harvests: rnd(3) ? [] : [{ date: '2026-0' + (1 + rnd(9)) + '-1' + rnd(10), quantity: '', note: 'x' }],
      coordinates: kind === 'place' && rnd(2) ? [at[0] + rnd(1000) / 1e6, at[1] - rnd(1000) / 1e6] : null,
      accuracy: rnd(2) ? 1 + rnd(50) : null,
      // When it was noted: none (its collection's creation), the creation itself, or a day of its own.
      ...(rnd(3) ? { addedAt: rnd(4) ? '2026-0' + (5 + rnd(5)) + '-1' + rnd(10) + 'T0' + rnd(10) + ':' + rnd(6) + '0:00.000Z' : DATE } : {}),
      ...(rnd(4) ? {} : { origin: { app: pick(['rencontres', 'parcours']) } }),
      ...(rnd(4) ? {} : { from: { app: pick(['cueillette', 'parcours']) } })
    }));
    const raw = { type: 'Feature', id: kind === 'favorites' ? M.FAVORITES_ID : 'c' + run, geometry: kind === 'place' ? { type: 'Point', coordinates: at } : null,
      properties: { kind, name: kind === 'favorites' ? '' : 'Collection ' + run, notes: rnd(2) ? 'n' : '', accuracy: kind === 'place' ? rnd(30) || null : null,
        ...(rnd(3) ? {} : { startedHere: true }), ...(rnd(3) ? {} : { walk: true }),
        ...(rnd(3) ? {} : { origin: { app: pick(['parcours', 'rencontres']) } }), ...(rnd(3) ? {} : { from: { app: pick(['parcours', 'mosaique']) } }),
        createdAt: DATE, updatedAt: DATE, plants } };
    const original = /** @type {M.Collection} */ (M.normalizeCollection(raw));
    const back = M.normalizeCollection(toPortable([original]).features[0]);
    // What the file leaves out on purpose: the names (filled again from the flora). The days the plants were noted,
    // a parcours' marks and who made what come back (format 6).
    const comparable = (/** @type {any} */ c) => ({ ...c, properties: { ...c.properties, plants: c.properties.plants.map((/** @type {any} */ e) => ({ ...e, scientificName: e.plantId === null ? e.scientificName : '', vernacularName: null })) } });
    assert.deepEqual(comparable(back), comparable(original), `run ${run}`);
  }
});

test('walkMarked : un parcours d’avant la marque, marqué sans rien changer d’autre ; rien pour les autres', () => {
  const at = { type: 'Point', coordinates: [2.35, 48.85] };
  const rec = (/** @type {string} */ id, /** @type {any} */ properties, geometry = /** @type {any} */ (at)) =>
    ({ type: 'Feature', id, geometry, properties: { kind: geometry ? 'place' : 'list', name: id, notes: '', createdAt: DATE, updatedAt: '2026-06-01T08:00:00.000Z', plants: [{ plantId: 1, scientificName: 'A' }], ...properties } });
  const known = { walks: ['listed'], walk: 'under-way' };
  // Made by the Parcours (under way, or made the user's own), started « ici », in the list kept, under way: marked.
  for (const r of [rec('made', { origin: { app: 'parcours' } }), rec('mine', { from: { app: 'parcours' } }), rec('here', { startedHere: true }), rec('listed', {}), rec('under-way', {})]) {
    const out = M.walkMarked(r, known);
    assert.deepEqual(out, { ...r, properties: { ...r.properties, walk: true } }, r.id);
    assert.equal(out.properties.updatedAt, '2026-06-01T08:00:00.000Z', 'sa date de modification gardée');
    assert.equal(M.walkMarked(out, known), null, 'déjà marqué : rien à faire');
  }
  // Not walks: a lieu of the user's, a game's, one whose notes merely say so; a list (even listed); none at all.
  assert.equal(M.walkMarked(rec('jardin', {}), known), null);
  assert.equal(M.walkMarked(rec('match', { origin: { app: 'rencontres' } }), known), null);
  assert.equal(M.walkMarked(rec('notes', { notes: 'Parcours botanique' }), known), null);
  assert.equal(M.walkMarked(rec('listed', { origin: { app: 'parcours' } }, null), known), null);
  assert.equal(M.walkMarked(rec(M.FAVORITES_ID, {}, null), { walks: [M.FAVORITES_ID] }), null);
  assert.equal(M.walkMarked(null, known), null);
});

test('locationLoss : ce qu’un lieu perdrait en liste — la position d’une plante, les autres fois qu’elle est notée, un tracé', () => {
  const lieu = (/** @type {any[]} */ plants, /** @type {any} */ more = {}, geometry = /** @type {any} */ ({ type: 'Point', coordinates: [2.35, 48.85] })) =>
    /** @type {M.Collection} */ (M.normalizeCollection({ type: 'Feature', id: 'l', geometry, properties: { name: 'Bois', createdAt: DATE, plants, ...more } }));
  // « Noter ici »: the plant on the lieu's point, with the accuracy of the fix — nothing lost but that.
  assert.deepEqual(M.locationLoss(lieu([{ plantId: 1, coordinates: [2.35, 48.85], accuracy: 6 }])), { placed: 0, repeats: 0, walk: false });
  // One plant 20 m away (≈ 0.00018° of latitude); 0.05 m away is the point still.
  assert.deepEqual(M.locationLoss(lieu([{ plantId: 1, coordinates: [2.35, 48.85018] }, { plantId: 2, coordinates: [2.35, 48.8500004] }])), { placed: 1, repeats: 0, walk: false });
  // The nettle noted twice at the point; a plant unknown to the flora twice too (by its name).
  assert.deepEqual(M.locationLoss(lieu([{ plantId: 1, id: 'a' }, { plantId: 1, id: 'b' }, { plantId: null, scientificName: 'Rubus sp.', id: 'c' },
    { plantId: null, scientificName: 'rubus SP.', id: 'd' }, { plantId: 3 }])), { placed: 0, repeats: 2, walk: false });
  assert.deepEqual(M.locationLoss(lieu([], { walk: true })), { placed: 0, repeats: 0, walk: true });
  // A list: nothing to lose.
  assert.deepEqual(M.locationLoss(lieu([{ plantId: 1 }, { plantId: 1, id: 'b' }], { kind: 'list' }, null)), { placed: 0, repeats: 0, walk: false });
});

test('joinEntry : deux fois la même plante réunies — notes une fois chacune, récoltes réunies, la meilleure note ; refusé au-delà de 5 000 caractères', () => {
  const entry = (/** @type {any} */ e) => M.normalizeEntry(e, DATE, [2.35, 48.85]);
  const a = entry({ id: 'a', plantId: 1, notes: 'Au bord du chemin', rating: 2, coordinates: [2.351, 48.85], accuracy: 5, addedAt: '2026-05-02T08:00:00.000Z', origin: { app: 'parcours' },
    harvests: [{ date: '2026-05-02', quantity: '200 g' }] });
  const b = entry({ id: 'b', plantId: 1, notes: '  Sous les frênes ', rating: 4, abundance: 'rare', coordinates: [2.352, 48.85],
    harvests: [{ date: '2026-05-02', quantity: '200 g' }, { date: '2026-06-01' }] });
  const one = /** @type {M.PlantEntry} */ (M.joinEntry(a, b));
  assert.equal(one.notes, 'Au bord du chemin\n\nSous les frênes');
  assert.deepEqual(one.harvests.map(h => h.date), ['2026-06-01', '2026-05-02'], 'chaque récolte une fois, la plus récente d’abord');
  assert.equal(one.rating, 4);
  assert.equal(one.abundance, 'rare', 'une abondance dite l’emporte sur « moyen »');
  // a's own: its id, its position, its date, its origin.
  assert.deepEqual([one.id, one.coordinates, one.accuracy, one.addedAt, one.origin], ['a', [2.351, 48.85], 5, '2026-05-02T08:00:00.000Z', { app: 'parcours' }]);
  // Joined again and again: never a note twice.
  assert.equal(M.joinEntry(/** @type {any} */ (M.joinEntry(one, b)), a)?.notes, 'Au bord du chemin\n\nSous les frênes');
  assert.equal(M.joinEntry(entry({ plantId: 1, abundance: 'abondant' }), b)?.abundance, 'abondant');
  assert.equal(M.joinEntry(entry({ plantId: 1 }), b)?.notes, 'Sous les frênes', 'sans note : celle de l’autre');
  assert.equal(M.joinEntry(a, entry({ plantId: 1, notes: '   ' }))?.notes, 'Au bord du chemin');
  // Past what a note holds (it would be cut on read): not joined.
  assert.equal(M.joinEntry(entry({ plantId: 1, notes: 'x'.repeat(4000) }), entry({ plantId: 1, notes: 'y'.repeat(999) })), null);
  assert.equal(M.joinEntry(entry({ plantId: 1, notes: 'x'.repeat(4000) }), entry({ plantId: 1, notes: 'y'.repeat(998) }))?.notes.length, 5000);
});
