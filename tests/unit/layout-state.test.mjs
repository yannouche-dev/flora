// A free layout's live state (app/layout/state.js, LayoutState) against an IndexedDB in memory (fake-indexeddb): what it
// reads of the flora waits for the flora. On a first visit the layout is drawn while the flora downloads; a plant in the
// address (?p=) read then was « none » for good — its names never read again (the cells' heads empty) — and a plant
// left before its names came was never read when chosen again.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// db.js upgrades the schema only from a page (a worker opens whatever version exists).
/** @type {any} */ (globalThis).window ??= globalThis;

const db = await import('../../app/core/db.js');
const { store } = await import('../../app/core/store.js');
const { LayoutState } = await import('../../app/layout/state.js');

const AIL = { id: 81541, scientificName: 'Allium ursinum', vernacularNames: ['Ail des ours'] };
const ORTIE = { id: 128268, scientificName: 'Urtica dioica', vernacularNames: ['Ortie dioïque'] };

/** The state's next drawing whose plant names are there. @param {InstanceType<typeof LayoutState>} s */
const named = s => new Promise(resolve => {
  const check = () => { if (s.plantInfo) { s.removeEventListener('change', check); resolve(s.plantInfo); } };
  s.addEventListener('change', check);
  check();
});
const tick = () => new Promise(resolve => setTimeout(resolve, 20));

test('une plante dans l’adresse avant que la flore soit là : ses noms lus une fois la flore enregistrée, jamais « aucune »', async () => {
  assert.equal(store.state.status, 'loading');
  const s = new LayoutState();
  s.set({ plant: AIL.id }, 'none');
  await tick();
  // The flora not stored yet: no names, and none taken for « no such plant ».
  assert.equal(s.plantInfo, null);
  // Left (Back) and chosen again while it waits: read when the flora comes, all the same.
  s.set({ plant: null }, 'none');
  s.set({ plant: ORTIE.id }, 'none');
  s.set({ plant: AIL.id }, 'none');
  await db.replacePlants([AIL, ORTIE], { plants: 2 });
  store.set({ status: 'ready' });
  assert.deepEqual(await named(s), { id: AIL.id, name: 'Ail des ours', sci: 'Allium ursinum' });
  // The flora there: another plant read at once.
  s.set({ plant: ORTIE.id }, 'none');
  await tick();
  assert.deepEqual(s.plantInfo, { id: ORTIE.id, name: 'Ortie dioïque', sci: 'Urtica dioica' });
  s.dispose();
});

test('un lieu en mots dans l’adresse (place= sans at=) : trouvé, il devient la zone et l’adresse le remplace ; introuvable ou hors ligne : dit, place= gardé', async () => {
  /** @type {string[]} */
  const asked = [];
  const found = { label: 'Puy de Mirabel (Ménétrol)', coordinates: /** @type {[number, number]} */ ([3.1093, 45.8732]), kind: /** @type {'poi'} */ ('poi') };
  /** @param {string} text */
  const find = async text => {
    asked.push(text);
    if (text === 'hors ligne') throw Object.assign(new Error('offline'), { name: 'SourceError', kind: 'offline' });
    return text.startsWith('mirabel') ? found : null;
  };
  const s = new LayoutState({ radius: 1000, find });
  /** @type {{ how: string, keys: string[] }[]} */
  const changes = [];
  s.addEventListener('change', e => { const d = /** @type {CustomEvent} */ (e).detail; if (d.keys.length) changes.push(d); });
  s.set({ place: 'mirabel, menetrol, 63' }, 'none');
  assert.equal(s.placeState, 'finding');
  await tick();
  assert.deepEqual(s.live.at, [3.1093, 45.8732]);
  assert.equal(s.live.place, 'Puy de Mirabel (Ménétrol)');
  assert.deepEqual([s.placeState, s.placeError], ['idle', null]);
  // The address replaced, not a new entry.
  assert.deepEqual(changes.at(-1), { how: 'replace', keys: ['at', 'place'] });
  assert.deepEqual(asked, ['mirabel, menetrol, 63']);
  // Not found: no scope, why said, the words kept (a reload asks again).
  s.setScope(null);
  s.set({ place: 'Zzyzx' }, 'none');
  await tick();
  assert.deepEqual([s.live.at, s.live.place, s.placeState, s.placeError], [null, 'Zzyzx', 'failed', 'Lieu introuvable : Zzyzx']);
  s.set({ place: 'hors ligne' }, 'none');
  await tick();
  assert.equal(s.placeError, 'Hors ligne : lieu non cherché (hors ligne)');
  // No scope asked: nothing said any more.
  s.setScope(null);
  assert.deepEqual([s.placeState, s.placeError], ['idle', null]);
  s.dispose();
});

test('une plante survolée (une ligne, un point) : son propre événement, jamais un changement ni l’adresse ; lâchée seulement par ce qui l’a allumée', () => {
  const s = new LayoutState();
  let changes = 0, hovers = 0;
  s.addEventListener('change', () => changes++);
  s.addEventListener('hover', () => hovers++);
  const live = s.live;
  s.hoverOn(AIL.id, 'list');
  assert.deepEqual(s.hover, { plant: AIL.id, from: 'list' });
  // The same again: nothing said.
  s.hoverOn(AIL.id, 'list');
  assert.equal(hovers, 1);
  // Another row left (its leave told after the next row's enter), the map letting go: it stays lit.
  s.hoverOff(ORTIE.id, 'list');
  s.hoverOff(null, 'map');
  assert.deepEqual(s.hover, { plant: AIL.id, from: 'list' });
  // A point of the map hovered: its plant, from the map — the list letting go of what it lit takes nothing.
  s.hoverOn(ORTIE.id, 'map');
  s.hoverOff(null, 'list');
  assert.deepEqual(s.hover, { plant: ORTIE.id, from: 'map' });
  s.hoverOff(null, 'map');
  assert.equal(s.hover, null);
  assert.equal(hovers, 3);
  // Never a change: nothing written in the address.
  assert.equal(changes, 0);
  assert.equal(s.live, live);
  // The layout gone: nothing hovered.
  s.hoverOn(AIL.id, 'list');
  s.dispose();
  assert.equal(s.hover, null);
});

test('ce que montre une carte de la zone : la liste gardée à ses plantes, la recherche relancée seulement quand elles changent ; tout le cercle : la zone ; un autre cercle lâche la vue, une autre période la garde ; « Toute la zone » recadre la carte', async t => {
  // The zone's observations (iNaturalist, answered here): the wild garlic east of the centre, the nettle west.
  const fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetch; });
  const AT = /** @type {[number, number]} */ ([4.81, 45.76]);
  const row = (/** @type {number} */ id, /** @type {any} */ plant, /** @type {number} */ lon) => ({ id, uri: `https://www.inaturalist.org/observations/${id}`,
    geojson: { type: 'Point', coordinates: [lon, AT[1]] }, observed_on: '2026-05-02', place_guess: 'Lyon', taxon: { id: plant.id + 1, name: plant.scientificName, preferred_common_name: null } });
  globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ input) => new URL(String(input)).host === 'api.inaturalist.org'
    ? new Response(JSON.stringify({ total_results: 2, results: [row(1, AIL, AT[0] + 0.004), row(2, ORTIE, AT[0] - 0.004)] }), { headers: { 'content-type': 'application/json' } })
    : new Response('', { status: 503 }));
  // Its search: what it is kept to, each time it is.
  /** @type {{ ids: number[] | null, within: number[] | null }[]} */
  const kept = [];
  const channel = /** @type {any} */ ({ query: {}, results: {}, setQuery() {}, run() {}, addEventListener() {}, removeEventListener() {},
    setScope(/** @type {number[] | null} */ ids, /** @type {any} */ extra = {}) { kept.push({ ids: ids && [...ids].sort((a, b) => a - b), within: extra.within ?? null }); } });
  const s = new LayoutState({ radius: 1000, channel });
  let refit = null;
  s.addEventListener('refit', e => { refit = /** @type {CustomEvent} */ (e).detail; });
  const ready = async () => { for (let i = 0; i < 100 && s.speciesState !== 'ready'; i++) await tick(); assert.equal(s.speciesState, 'ready'); };
  s.set({ at: AT }, 'none');
  await ready();
  assert.deepEqual(kept.at(-1), { ids: [AIL.id, ORTIE.id].sort((a, b) => a - b), within: null });
  // The east half of the zone shown: the garlic alone.
  const east = [AT[0], AT[1] - 0.02, AT[0] + 0.02, AT[1] + 0.02];
  s.setView(east, { kinds: ['inat'], by: 'map' });
  assert.deepEqual(s.within, [AIL.id]);
  assert.deepEqual(kept.at(-1)?.within, [AIL.id]);
  // Moved a little, the same plants: the search not run again.
  const runs = kept.length;
  s.setView([AT[0] + 0.001, AT[1] - 0.02, AT[0] + 0.021, AT[1] + 0.02], { kinds: ['inat'], by: 'map' });
  assert.equal(kept.length, runs);
  // Another source shown alone: none of these points.
  s.setView(east, { kinds: ['gbif'], by: 'map' });
  assert.deepEqual(s.within, []);
  // All of the circle shown: the whole zone, no view.
  s.setView([AT[0] - 0.05, AT[1] - 0.05, AT[0] + 0.05, AT[1] + 0.05], { kinds: ['inat'], by: 'map' });
  assert.deepEqual([s.view, s.within, kept.at(-1)?.within], [null, null, null]);
  // Another period: the view kept, its plants found among the new points.
  s.setView(east, { kinds: ['inat'], by: 'map' });
  s.set({ periode: 'annee' }, 'none');
  await tick();
  await ready();
  assert.deepEqual([s.view?.box, s.within, kept.at(-1)?.within], [east, [AIL.id], [AIL.id]]);
  // « Toute la zone »: the whole zone, the map that led it framed again.
  s.wholeZone();
  assert.deepEqual([s.view, s.within, kept.at(-1)?.within, refit], [null, null, null, { by: 'map' }]);
  // Another circle: the view let go.
  s.setView(east, { kinds: ['inat'], by: 'map' });
  s.set({ r: 2000 }, 'none');
  assert.deepEqual([s.view, s.within], [null, null]);
  await tick();
  await ready();
  assert.equal(kept.at(-1)?.within, null);
  s.dispose();
});
