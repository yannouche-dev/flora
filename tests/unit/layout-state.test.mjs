// A free layout's live state (app/layout/state.js, LayoutState) against an IndexedDB in memory (fake-indexeddb): what it
// reads of the flora waits for the flora. On a first visit the layout is drawn while the flora downloads; a plant in the
// address (?p=) read then was « none » for good — its names never read again (the cells' heads empty) — and a plant
// left before its names came was never read when chosen again. Its search is its own (a SearchChannel), never Flore's:
// its zone keeps it to its plants, the store's query stays as it is, and it goes with the screen (never run again).
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// db.js upgrades the schema only from a page (a worker opens whatever version exists).
/** @type {any} */ (globalThis).window ??= globalThis;

const db = await import('../../app/core/db.js');
const { store } = await import('../../app/core/store.js');
const { LayoutState } = await import('../../app/layout/state.js');
const { APP, SearchChannel, emptyQuery } = await import('../../app/core/search-channel.js');
const { setModule } = await import('../../app/core/modules.js');

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
  assert.deepEqual(s.hover, { plant: AIL.id, from: 'list', by: null });
  // The same again: nothing said.
  s.hoverOn(AIL.id, 'list');
  assert.equal(hovers, 1);
  // Another row left (its leave told after the next row's enter), the map letting go: it stays lit.
  s.hoverOff(ORTIE.id, 'list');
  s.hoverOff(null, 'map');
  assert.deepEqual(s.hover, { plant: AIL.id, from: 'list', by: null });
  // A point of a map hovered: its plant, from that map (the others light it, not it) — the list letting go of what it
  // lit takes nothing, nor another map letting go of its own.
  const map = {}, other = {};
  s.hoverOn(ORTIE.id, 'map', map);
  s.hoverOff(null, 'list');
  s.hoverOff(null, 'map', other);
  assert.deepEqual(s.hover, { plant: ORTIE.id, from: 'map', by: map });
  s.hoverOff(null, 'map', map);
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
  const channel = /** @type {any} */ ({ query: {}, results: {}, setQuery() {}, run() {}, fetch: async () => null, publish() {}, addEventListener() {}, removeEventListener() {},
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

test('une source coupée dans Réglages › Modules : laissée des sources par défaut, jamais demandée ni dite manquante sur la carte ; demandée par l’adresse, dite ; les deux coupées : les deux, comme avant', async t => {
  const fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetch; setModule('gbif', true); setModule('inaturalist', true); });
  const AT = /** @type {[number, number]} */ ([2.35, 48.85]);
  /** @type {string[]} */
  const asked = [];
  globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ input) => {
    const host = new URL(String(input)).host;
    asked.push(host);
    return host === 'api.inaturalist.org'
      ? new Response(JSON.stringify({ total_results: 1, results: [{ id: 9, uri: 'https://www.inaturalist.org/observations/9', geojson: { type: 'Point', coordinates: AT },
        observed_on: '2026-05-02', place_guess: 'Paris', taxon: { id: AIL.id + 1, name: AIL.scientificName, preferred_common_name: null } }] }), { headers: { 'content-type': 'application/json' } })
      : new Response('', { status: 503 });
  });
  const channel = /** @type {any} */ ({ query: {}, results: {}, setQuery() {}, run() {}, fetch: async () => null, publish() {}, setScope() {}, addEventListener() {}, removeEventListener() {} });
  /** @param {InstanceType<typeof LayoutState>} s */
  const ready = async s => { for (let i = 0; i < 100 && s.speciesState !== 'ready'; i++) await tick(); assert.equal(s.speciesState, 'ready'); };
  setModule('gbif', false);
  const s = new LayoutState({ radius: 1000, channel });
  // GBIF off: iNaturalist alone by default — GBIF never asked, nothing said missing (cells.js: the map's « État »).
  assert.deepEqual(s.filters.sources, ['inat']);
  s.set({ at: AT }, 'none');
  await ready(s);
  assert.deepEqual([s.failed, s.species?.list.map(x => x.plantId)], [[], [AIL.id]]);
  assert.ok(asked.includes('api.inaturalist.org') && !asked.includes('api.gbif.org'));
  // The address asks GBIF (sources=inat,gbif): asked, its module said off — honest, it was asked.
  s.set({ filtres: { sources: ['inat', 'gbif'] } }, 'none');
  await tick();
  await ready(s);
  assert.deepEqual(s.failed, [{ name: 'GBIF', off: true }]);
  s.dispose();
  // iNaturalist off alone: GBIF; both off: both, as before (the zone says neither is on).
  setModule('gbif', true);
  setModule('inaturalist', false);
  assert.deepEqual(new LayoutState({ channel }).filters.sources, ['gbif']);
  setModule('gbif', false);
  assert.deepEqual(new LayoutState({ channel }).filters.sources, ['inat', 'gbif']);
});

test('sans recherche donnée, la sienne (SearchChannel), jamais celle de Flore : sa zone la garde à ses plantes, la recherche de l’app reste telle quelle ; partie, plus gardée ni relancée', async t => {
  const fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetch; });
  const AT = /** @type {[number, number]} */ ([4.81, 45.76]);
  const row = (/** @type {number} */ id, /** @type {any} */ plant) => ({ id, uri: `https://www.inaturalist.org/observations/${id}`,
    geojson: { type: 'Point', coordinates: AT }, observed_on: '2026-05-02', place_guess: 'Lyon', taxon: { id: plant.id + 1, name: plant.scientificName, preferred_common_name: null } });
  globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ input) => new URL(String(input)).host === 'api.inaturalist.org'
    ? new Response(JSON.stringify({ total_results: 2, results: [row(1, AIL), row(2, ORTIE)] }), { headers: { 'content-type': 'application/json' } })
    : new Response('', { status: 503 }));
  // Flore's search, as it was left.
  const flore = { ...emptyQuery(), filters: { ...emptyQuery().filters, family: ['Rosaceae'] } };
  store.set({ query: flore });
  const s = new LayoutState({ radius: 1000 });
  assert.ok(s.channel instanceof SearchChannel);
  assert.notEqual(/** @type {any} */ (s.channel), APP);
  // Another screen's (another group's): apart.
  assert.notEqual(new LayoutState().channel, s.channel);
  // Its runs counted (the worker answers nothing here): asked with the zone's plants, published with them.
  let runs = 0;
  s.channel.fetch = async () => { runs++; return null; };
  s.set({ at: AT }, 'none');
  for (let i = 0; i < 100 && (s.speciesState !== 'ready' || !runs); i++) await tick();
  assert.deepEqual([s.speciesState, s.scoped, [...(s.channel.scope ?? [])].sort((a, b) => a - b)], ['ready', true, [AIL.id, ORTIE.id].sort((a, b) => a - b)]);
  assert.ok(runs > 0);
  assert.equal(store.state.query, flore);
  // Gone with its screen: kept to no zone, never run again.
  const ran = runs;
  s.dispose();
  await tick();
  assert.deepEqual([s.scoped, s.channel.scope, runs], [false, null, ran]);
  assert.equal(store.state.query, flore);
});

/**
 * iNaturalist's answer: these observations (their id and plant), in a row east of `at` (all in the zone).
 * @param {[number, number]} at @param {[number, any][]} obs
 */
const inatAnswer = (at, obs) => new Response(JSON.stringify({ total_results: obs.length, results: obs.map(([id, plant], i) => ({ id, uri: `https://www.inaturalist.org/observations/${id}`,
  geojson: { type: 'Point', coordinates: [at[0] + i * 0.0005, at[1]] }, observed_on: '2026-05-02', place_guess: 'Dijon', taxon: { id: plant.id + 1, name: plant.scientificName, preferred_common_name: null } })) }),
{ headers: { 'content-type': 'application/json' } });
/** A search of its own as the state uses it (core/search-channel.js): its answers, nothing found. */
const fakeChannel = () => /** @type {any} */ ({ query: emptyQuery(), results: {}, setQuery() {}, run() {}, setScope() {}, addEventListener() {}, removeEventListener() {},
  fetch: async () => ({ total: 0, items: [], inZone: null }), publish() {} });
/** The zone's answer given (its plants known). @param {InstanceType<typeof LayoutState>} s */
const zoneReady = async s => { for (let i = 0; i < 100 && s.speciesState !== 'ready'; i++) await tick(); assert.equal(s.speciesState, 'ready'); };

test('une seule publication : les points de la zone, ses plantes, leurs nombres et la réponse de sa recherche donnés ensemble, dans une même tâche — rien avant', async t => {
  const fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetch; });
  const AT = /** @type {[number, number]} */ ([5.04, 47.32]);
  globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ input) => new URL(String(input)).host === 'api.inaturalist.org'
    ? inatAnswer(AT, [[11, AIL], [12, AIL], [13, ORTIE]]) : new Response('', { status: 503 }));
  // Its search's answer, given when the test says.
  /** @type {(found: any) => void} */
  let answer = () => {};
  let asked = 0, late = false;
  /** @type {{ points: number, species: string }[]} */
  const published = [];
  const channel = /** @type {any} */ ({ query: emptyQuery(), results: {}, setQuery() {}, run() {}, setScope() {}, addEventListener() {}, removeEventListener() {},
    fetch: () => { asked++; return new Promise(resolve => { answer = resolve; }); },
    publish() { published.push({ points: s.points.length, species: s.speciesState }); setTimeout(() => { late = true; }); } });
  const s = new LayoutState({ radius: 1000, channel });
  t.after(() => s.dispose());
  /** @type {{ points: number, species: string, updating: boolean, published: number, late: boolean }[]} */
  const changes = [];
  s.addEventListener('change', () => changes.push({ points: s.points.length, species: s.speciesState, updating: s.updating, published: published.length, late }));
  s.set({ at: AT, filtres: { sources: ['inat'] } }, 'none');
  for (let i = 0; i < 100 && !asked; i++) await tick();
  await tick();
  // Its search asked with the zone's plants — nothing given yet: no point, no plant, no count, no answer; dimmed.
  assert.equal(asked, 1);
  assert.ok(changes.length > 0 && changes.every(c => c.points === 0 && c.published === 0));
  assert.deepEqual([s.points.length, s.species, s.obsCounts, s.speciesState, s.updating], [0, null, null, 'loading', true]);
  const before = changes.length;
  answer({ total: 2, items: [], inZone: null });
  await tick();
  // Given at once: one change, the search's answer published just before it, in the same task.
  assert.deepEqual(changes.slice(before), [{ points: 3, species: 'ready', updating: false, published: 1, late: false }]);
  assert.deepEqual(published, [{ points: 3, species: 'ready' }]);
  s.dispose();
});

test('rien de périmé : d’autres filtres pendant un chargement, la réponse d’avant arrivée en retard est ignorée — ce qui était montré gardé (estompé) jusqu’à la nouvelle ; entre deux cercles, ni les points de l’ancien ni ceux de la plante', async t => {
  const fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetch; });
  const AT = /** @type {[number, number]} */ ([5.1, 47.4]), AT2 = /** @type {[number, number]} */ ([5.2, 47.4]);
  /** @type {(() => void) | null} */
  let release = null;
  globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ input) => {
    const url = new URL(String(input));
    if (url.host !== 'api.inaturalist.org') return new Response('', { status: 503 });
    const grade = url.searchParams.get('quality_grade');
    const at = Number(url.searchParams.get('lng')) > 5.15 ? AT2 : AT;
    // Every grade: the garlic twice and the nettle; the verified ones and those to identify: held, then the nettle
    // alone (late); the verified ones: the garlic once.
    if (grade === 'research,needs_id') { await new Promise(resolve => { release = () => resolve(null); }); return inatAnswer(at, [[29, ORTIE]]); }
    return inatAnswer(at, grade === 'research' ? [[31, AIL]] : [[21, AIL], [22, AIL], [23, ORTIE]]);
  });
  const s = new LayoutState({ radius: 1000, channel: fakeChannel() });
  t.after(() => s.dispose());
  s.set({ at: AT, plant: AIL.id, filtres: { sources: ['inat'] } }, 'none');
  await zoneReady(s);
  assert.deepEqual([s.points.length, s.plantObs?.points.length, s.updating], [3, 2, false]);
  const shown = s.points, plantShown = s.plantObs;
  // Other filters, their answer held: what was shown stays — the plant's big points too —, dimmed.
  s.set({ filtres: { sources: ['inat'], qualite: ['recherche', 'aidentifier'] } }, 'none');
  for (let i = 0; i < 100 && !release; i++) await tick();
  assert.ok(release);
  assert.ok(s.points === shown && s.plantObs === plantShown);
  assert.deepEqual([s.speciesState, s.updating], ['loading', true]);
  // Others again before it answered: theirs given; the held one's, answering late, never.
  s.set({ filtres: { sources: ['inat'], qualite: ['recherche'] } }, 'none');
  await zoneReady(s);
  const now = () => [s.points.map(p => p.id), s.species?.list.map(x => x.plantId), s.plantObs?.points.length, s.updating];
  assert.deepEqual(now(), [['i31'], [AIL.id], 1, false]);
  /** @type {() => void} */ (/** @type {unknown} */ (release))();
  await tick();
  await tick();
  assert.deepEqual(now(), [['i31'], [AIL.id], 1, false]);
  // Another circle: the old one's points and the plant's go at once — never shown under it.
  s.set({ at: AT2 }, 'none');
  assert.deepEqual([s.points, s.plantObs, s.obsCounts, s.updating], [[], null, null, true]);
  await zoneReady(s);
  assert.deepEqual([s.plantObs?.points.length, s.plantObs?.points[0].coordinates[0]], [1, AT2[0]]);
  s.dispose();
});

test('les gros points de la plante choisie : de la zone, les siens parmi ses observations — aucune requête, autant que sa ligne en compte ; hors de la zone, ceux d’iNaturalist seul, demandés selon les filtres et la période', async t => {
  const fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetch; });
  const AT = /** @type {[number, number]} */ ([5.3, 47.4]);
  /** @type {string[]} */
  const asked = [];
  globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ input) => {
    const url = new URL(String(input));
    if (url.host !== 'api.inaturalist.org') return new Response('', { status: 503 });
    asked.push(url.href);
    if (url.pathname === '/v1/taxa') return new Response(JSON.stringify({ results: [{ id: ORTIE.id + 1, name: ORTIE.scientificName }] }), { headers: { 'content-type': 'application/json' } });
    return inatAnswer(AT, url.searchParams.get('taxon_id') ? [[51, ORTIE], [52, ORTIE]] : [[41, AIL], [42, AIL], [43, AIL]]);
  });
  const s = new LayoutState({ radius: 1000, channel: fakeChannel() });
  t.after(() => s.dispose());
  s.set({ at: AT, periode: 'annee', filtres: { sources: ['inat'] } }, 'none');
  await zoneReady(s);
  // The garlic, of the zone: its own among the zone's points, at once — as many as its row says; nothing asked.
  s.pick(AIL.id, { how: 'none' });
  const counted = s.obsCounts?.counts.get(AIL.id);
  assert.deepEqual([s.plantObs?.points.length, s.plantObs?.outside], [3, false]);
  assert.equal(s.plantObs?.points.length, (counted?.inat ?? 0) + (counted?.gbif ?? 0));
  await tick();
  assert.deepEqual(asked.filter(u => u.includes('taxon_id=') || u.includes('/v1/taxa')), []);
  // The nettle, not among them: iNaturalist's alone, asked once — every grade (the zone's filters say none), this year.
  s.pick(ORTIE.id, { how: 'none' });
  assert.equal(s.plantObs, null);
  for (let i = 0; i < 100 && !s.plantObs; i++) await tick();
  assert.deepEqual([s.plantObs?.points.length, s.plantObs?.outside, [...new Set(s.plantObs?.points.map(p => p.kind))]], [2, true, ['inat']]);
  const own = asked.filter(u => u.includes('taxon_id='));
  assert.equal(own.length, 1);
  const q = new URL(own[0]).searchParams;
  assert.deepEqual([q.get('taxon_id'), q.get('quality_grade'), q.get('year')], [String(ORTIE.id + 1), null, String(new Date().getFullYear())]);
  s.dispose();
});

test('la plante courante est un choix, jamais un filtre : choisie, elle reste choisie quand la recherche de son groupe ne la trouve plus — « hors du résultat », jamais avant sa réponse', () => {
  const channel = { ...fakeChannel(), answered: false, results: { total: 1, items: [{ id: AIL.id }], inZone: null } };
  const s = new LayoutState({ channel });
  // None chosen, or its search not answered yet: nothing said.
  assert.equal(s.outside, false);
  s.pick(ORTIE.id, { how: 'none' });
  assert.equal(s.outside, false);
  channel.answered = true;
  assert.deepEqual([s.live.plant, s.outside], [ORTIE.id, true]);
  s.pick(AIL.id, { how: 'none' });
  assert.equal(s.outside, false);
  // A map's view keeping the list to a part of the zone: the zone's plants count (inZone), not only what it lists.
  channel.results = { total: 0, items: [], inZone: [AIL.id] };
  assert.equal(s.outside, false);
  channel.results = { total: 1, items: [{ id: AIL.id }], inZone: [ORTIE.id] };
  assert.equal(s.outside, true);
  s.dispose();
});

test('une plante choisie dans la liste de son groupe sur toute la flore (results(zone=0)) : jamais « hors du résultat », sa ligne est là', () => {
  const channel = { ...fakeChannel(), answered: true, results: { total: 1, items: [{ id: AIL.id }], inZone: [AIL.id] } };
  const s = new LayoutState({ channel });
  s.pick(ORTIE.id, { how: 'none' });
  assert.equal(s.outside, true);
  // The whole flora's rows (wholeOf) list it: not outside.
  s.whole = { key: 'q:#/', total: 2, items: [{ id: AIL.id }, { id: ORTIE.id }] };
  assert.equal(s.outside, false);
  // Neither the zone's nor the whole flora's: outside again.
  s.whole = { key: 'q:#/', total: 1, items: [{ id: AIL.id }] };
  assert.equal(s.outside, true);
  s.dispose();
});

test('une autre période en échec : les gros points de la plante choisie partent avec les points de la zone — jamais restés, ni montrés sous une autre plante', async t => {
  const fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetch; });
  const AT = /** @type {[number, number]} */ ([5.75, 47.95]);
  // Every period: the garlic twice and the nettle; this month: iNaturalist down.
  globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ input) => {
    const url = new URL(String(input));
    return url.host === 'api.inaturalist.org' && !url.searchParams.get('month') ? inatAnswer(AT, [[71, AIL], [72, AIL], [73, ORTIE]]) : new Response('', { status: 503 });
  });
  const s = new LayoutState({ radius: 1000, channel: fakeChannel() });
  t.after(() => s.dispose());
  s.set({ at: AT, plant: AIL.id, filtres: { sources: ['inat'] } }, 'none');
  await zoneReady(s);
  assert.equal(s.plantObs?.points.length, 2);
  // This month, every source failing: no point, no big point either.
  s.set({ periode: 'mois' }, 'none');
  for (let i = 0; i < 100 && s.speciesState !== 'error'; i++) await tick();
  assert.deepEqual([s.speciesState, s.points.length, s.plantObs, s.updating], ['error', 0, null, false]);
  // Another plant meanwhile: none — never the garlic's under its name.
  s.pick(ORTIE.id, { how: 'none' });
  await tick();
  assert.equal(s.plantObs, null);
  s.dispose();
});

test('la zone ôtée puis une autre aussitôt, avant la réponse sur toute la flore, et celle-ci en échec : la recherche sur toute la flore publiée — jamais les plantes de l’ancienne zone, rien laissé en attente', async t => {
  const fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetch; });
  const AT = /** @type {[number, number]} */ ([5.6, 47.7]), AT2 = /** @type {[number, number]} */ ([5.7, 47.7]);
  // iNaturalist answers for the first zone, not for the second.
  globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ input) => {
    const url = new URL(String(input));
    return url.host === 'api.inaturalist.org' && Number(url.searchParams.get('lng')) < 5.65 ? inatAnswer(AT, [[81, AIL], [82, ORTIE]]) : new Response('', { status: 503 });
  });
  // A search of its own whose answers take 80 ms: what it is kept to, what it was asked and what it published.
  let asked = 0, answers = 0;
  /** @type {(number[] | null)[]} */
  const published = [];
  const channel = /** @type {any} */ ({ query: emptyQuery(), results: {}, scope: /** @type {number[] | null} */ (null), setQuery() {}, run() {}, addEventListener() {}, removeEventListener() {},
    setScope(/** @type {number[] | null} */ ids) { this.scope = ids; asked++; },
    get pending() { return asked !== answers; },
    async fetch() { const at = asked, scope = this.scope; await new Promise(resolve => setTimeout(resolve, 80)); return { total: 0, items: [], inZone: null, scope, at }; },
    publish(/** @type {any} */ found) { published.push(found.scope); answers = found.at; } });
  const s = new LayoutState({ radius: 1000, channel });
  t.after(() => s.dispose());
  s.set({ at: AT, filtres: { sources: ['inat'] } }, 'none');
  await zoneReady(s);
  for (let i = 0; i < 100 && channel.pending; i++) await tick();
  assert.deepEqual(published.map(p => p?.length ?? null), [2]);
  // No zone, then at once another — which fails: the whole flora's answer, never the first zone's plants left.
  s.set({ at: null }, 'none');
  s.set({ at: AT2 }, 'none');
  for (let i = 0; i < 100 && s.speciesState !== 'error'; i++) await tick();
  for (let i = 0; i < 100 && channel.pending; i++) await tick();
  assert.deepEqual([s.speciesState, s.scoped, channel.scope, channel.pending, published.at(-1)], ['error', false, null, false, null]);
  // No zone again after a zone gone before its whole flora's answer: the answer owed published all the same.
  s.set({ at: AT }, 'none');
  await zoneReady(s);
  for (let i = 0; i < 100 && channel.pending; i++) await tick();
  s.set({ at: null }, 'none');
  s.set({ at: AT2 }, 'none');
  await tick(); await tick(); await tick(); await tick(); await tick();
  s.set({ at: null }, 'none');
  for (let i = 0; i < 100 && channel.pending; i++) await tick();
  assert.deepEqual([s.speciesState, channel.scope, channel.pending, published.at(-1)], ['idle', null, false, null]);
  s.dispose();
});

test('une plante hors de la zone, iNaturalist ôté des sources du groupe (GBIF seul) : rien demandé à iNaturalist — aucune de ses observations dans la zone', async t => {
  const fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetch; });
  const AT = /** @type {[number, number]} */ ([5.9, 47.6]);
  /** @type {string[]} */
  const asked = [];
  globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ input) => {
    const url = new URL(String(input));
    asked.push(url.href);
    if (url.host !== 'api.gbif.org') return new Response('', { status: 503 });
    const row = (/** @type {number} */ key) => ({ key, decimalLatitude: AT[1] + key * 1e-4, decimalLongitude: AT[0], species: AIL.scientificName, scientificName: AIL.scientificName + ' L.',
      eventDate: '2024-06-12', datasetName: 'Inventaire', datasetKey: 'cbn', locality: 'Vesoul' });
    return new Response(JSON.stringify({ count: 2, results: [row(1), row(2)] }), { headers: { 'content-type': 'application/json' } });
  });
  const s = new LayoutState({ radius: 1000, channel: fakeChannel() });
  t.after(() => s.dispose());
  s.set({ at: AT, filtres: { sources: ['gbif'] } }, 'none');
  await zoneReady(s);
  assert.deepEqual(s.species?.list.map(x => x.plantId), [AIL.id]);
  // The nettle, not among the zone's: none of iNaturalist's asked — none, said so on the map (cells.js).
  s.pick(ORTIE.id, { how: 'none' });
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual([s.plantObs?.points, s.plantObs?.outside], [[], true]);
  assert.deepEqual(asked.filter(u => new URL(u).host === 'api.inaturalist.org'), []);
  s.dispose();
});
