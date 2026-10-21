// app/miniapp: a manifest checked (define.js), the screen it builds step by step and fits in a box (layout.js), its
// context (context.js) and the runtime's path and « Rejouer » (runtime.js). Pure modules: no browser needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineMiniApp, kitProblems, paths, ManifestError } from '../../app/miniapp/define.js';
import { layoutAt, fit, tierOf, HANDLE } from '../../app/miniapp/layout.js';
import { createContext } from '../../app/miniapp/context.js';
import { MiniApp, guided, pathTo, storageKey } from '../../app/miniapp/runtime.js';
import { random } from './support/random.mjs';

/** A manifest on the model of Rencontres: map ┃ deck ┃ side, a fork, a component given blocks along the way. */
const meet = (/** @type {any} */ patch = {}) => ({
  id: 'meet-test', title: 'Rencontres', icon: 'heart-fill', exit: { label: 'Quitter Rencontres' },
  context: { point: { init: null, persist: true }, radius: { init: 1000, persist: true, min: 100, max: 50000 }, focus: { init: null }, liked: { init: [] } },
  derive: { focusId: (/** @type {any} */ c) => c.focus ?? null },
  columns: [{ id: 'map', base: 'fill', min: 260, rank: 3, heavy: true, title: 'Carte' },
    { id: 'deck', base: 380, min: 300, max: 520, rank: 2, mergeInto: 'map', title: 'Cartes' },
    { id: 'side', base: 560, min: 360, rank: 1, mergeInto: 'deck', title: 'Fiche' }],
  phone: { rows: [['map', '34dvh'], ['deck', 'auto'], ['side', 'tabs']] },
  steps: [
    { id: 'start', kind: 'start', label: 'Départ', next: 'map', start: () => ({}) },
    { id: 'map', label: 'Carte', can: (/** @type {any} */ c) => Boolean(c.point), next: 'cards',
      add: [{ id: 'map', use: 'map', col: 'map' }, { id: 'launch', use: 'radius', col: 'map', below: 'map' }] },
    { id: 'cards', label: 'Rencontres', drop: ['launch'], done: (/** @type {any} */ c) => c.liked.length > 0, next: 'photos',
      add: [{ id: 'deck', use: 'deck', col: 'deck' }] },
    { id: 'photos', label: 'Photos', next: 'wiki', add: [{ id: 'plant', use: 'plant', col: 'side', blocks: ['media'] }] },
    { id: 'wiki', label: 'Encyclopédie', add: [{ id: 'plant', blocks: ['wikipedia'] }],
      choose: [{ label: 'La cueillette', to: 'harvest' }, { label: 'La science', to: 'science' }] },
    { id: 'harvest', label: 'Cueillette', next: 'around', add: [{ id: 'plant', blocks: ['uses'] }] },
    { id: 'science', label: 'Science', next: 'around', add: [{ id: 'plant', blocks: ['map'] }] },
    { id: 'around', label: 'Voisines', add: [{ id: 'around', use: 'list', col: 'deck', below: 'deck' }] }
  ],
  ...patch
});

/** The message of the ManifestError a manifest throws. @param {any} spec */
const refused = spec => { try { defineMiniApp(spec); return ''; } catch (e) { assert.ok(e instanceof ManifestError); return /** @type {Error} */ (e).message; } };

test('defineMiniApp : un manifeste juste passe, gelé, avec ses valeurs par défaut', () => {
  const m = defineMiniApp(meet());
  assert.ok(Object.isFrozen(m));
  assert.deepEqual([m.uses, m.version, m.shared], [[], 1, []]);
  assert.deepEqual(paths(m), [['start', 'map', 'cards', 'photos', 'wiki', 'harvest', 'around'], ['start', 'map', 'cards', 'photos', 'wiki', 'science', 'around']]);
});

test('defineMiniApp : chaque règle refuse ce qu’elle doit, en le disant', () => {
  const m = meet();
  assert.match(refused({ ...m, id: 'Meet' }), /id must be/);
  assert.match(refused({ ...m, steps: m.steps.slice(1) }), /first step is the start/);
  assert.match(refused({ ...m, steps: [m.steps[0], { ...m.steps[1], kind: 'start' }, ...m.steps.slice(2)] }), /only the first step is the start/);
  assert.match(refused({ ...m, steps: [m.steps[0], m.steps[1], m.steps[1], ...m.steps.slice(2)] }), /step « map » twice/);
  // A step but the last that does not say how it goes on.
  assert.match(refused({ ...m, steps: [m.steps[0], { ...m.steps[1], next: undefined }, ...m.steps.slice(2)] }), /says how it goes on/);
  assert.match(refused({ ...m, steps: [{ ...m.steps[0], next: 'nowhere' }, ...m.steps.slice(1)] }), /no step « nowhere »/);
  assert.match(refused({ ...m, uses: ['nothing'] }), /unknown module/);
  assert.match(refused({ ...m, exit: {} }), /exit needs a label/);
  assert.match(refused({ ...m, columns: [...m.columns, { id: 'more', base: 'fill', min: 100, rank: 0 }] }), /one column at most fills/);
  assert.match(refused({ ...m, columns: m.columns.map(c => c.id === 'map' ? { ...c, mergeInto: 'side' } : c) }), /in a loop/);
  assert.match(refused({ ...m, columns: m.columns.map(c => c.id === 'deck' ? { ...c, base: 600 } : c) }), /base outside/);
  assert.match(refused({ ...m, phone: { rows: [['nope', 'auto']] } }), /not a column/);
  // The same component twice on a path; blocks before their component; a block twice; a drop of nothing there.
  assert.match(refused({ ...m, steps: m.steps.map(s => s.id === 'around' ? { ...s, add: [{ id: 'deck', use: 'deck', col: 'deck' }] } : s) }), /component deck is already there/);
  assert.match(refused({ ...m, steps: m.steps.map(s => s.id === 'photos' ? { ...s, add: [] } : s) }), /gets blocks before it is added/);
  assert.match(refused({ ...m, steps: m.steps.map(s => s.id === 'science' ? { ...s, add: [{ id: 'plant', blocks: ['media'] }] } : s) }), /block media of plant is already there/);
  assert.match(refused({ ...m, steps: m.steps.map(s => s.id === 'photos' ? { ...s, drop: ['launch'] } : s) }), /drops launch, not there/);
  assert.match(refused({ ...m, steps: m.steps.map(s => s.id === 'around' ? { ...s, next: 'map' } : s) }), /loop back/);
  assert.match(refused({ ...m, context: { ...m.context, focusId: { init: null } } }), /both in context and derive/);
  // What it owns: storage keys of the app only.
  assert.match(refused({ ...m, owns: { keys: ['favorites'] } }), /owns.keys/);
  assert.match(refused({ ...m, owns: { reset: 'all' } }), /owns.reset/);
});

test('defineMiniApp : une application portée en entier (driven) dessine son départ par son composant', () => {
  const start = { id: 'start', kind: 'start', label: 'Départ', next: 'walk', add: [{ id: 'trail', use: 'trail', col: 'main' }] };
  const spec = { id: 'walk-test', title: 'Parcours', icon: 'geo-alt-fill', exit: { label: 'Quitter' }, driven: true,
    columns: [{ id: 'main', base: 'fill', min: 300, rank: 1 }], steps: [start, { id: 'walk', label: 'En marche' }] };
  assert.equal(defineMiniApp(spec).driven, true);
  assert.match(refused({ ...spec, driven: false }), /start\(\) gives its screen/);
  assert.match(refused({ ...spec, steps: [{ ...start, add: [] }, spec.steps[1]] }), /adds the component that draws it/);
});

test('kitProblems : un composant absent du kit, une clé lue non déclarée', () => {
  const m = defineMiniApp(meet());
  const kit = { map: { reads: ['focusId'] }, radius: { reads: ['radius'] }, deck: { reads: ['liked', 'shown'] }, plant: { reads: ['focusId'] } };
  assert.deepEqual(kitProblems(m, kit), ['component « deck » reads « shown », not in context nor derive', 'no component « list » in the kit']);
});

test('layoutAt : les étapes ajoutent, étendent et retirent ; revenir en arrière recalcule', () => {
  const m = defineMiniApp(meet());
  assert.deepEqual(layoutAt(m, ['start']), { columns: [], places: [], stacks: {}, newest: [] });
  const atMap = layoutAt(m, ['start', 'map']);
  assert.deepEqual(atMap.stacks, { map: [['map'], ['launch']] });
  assert.deepEqual(atMap.columns.map(c => c.id), ['map']);
  const atCards = layoutAt(m, ['start', 'map', 'cards']);
  assert.deepEqual(atCards.stacks, { map: [['map']], deck: [['deck']] });
  assert.deepEqual(atCards.newest, ['deck']);
  const atScience = layoutAt(m, ['start', 'map', 'cards', 'photos', 'wiki', 'science']);
  assert.deepEqual(atScience.places.find(p => p.id === 'plant')?.blocks, ['media', 'wikipedia', 'map']);
  assert.deepEqual(atScience.columns.map(c => c.id), ['map', 'deck', 'side']);
  assert.deepEqual(layoutAt(m, ['start', 'map', 'cards', 'photos', 'wiki', 'science', 'around']).stacks.deck, [['deck'], ['around']]);
  // Back to the cards: the sheet's column is gone again.
  assert.deepEqual(layoutAt(m, ['start', 'map', 'cards']).columns.map(c => c.id), ['map', 'deck']);
});

test('fit : les paliers, la fusion par rang dans mergeInto, les largeurs gardées puis bornées', () => {
  const m = defineMiniApp(meet());
  const cols = layoutAt(m, ['start', 'map', 'cards', 'photos']).columns;
  assert.deepEqual([tierOf(390), tierOf(820), tierOf(1280)], ['phone', 'tablet', 'wide']);
  const wide = fit(cols, 1280);
  assert.deepEqual(wide.cols.map(c => [c.id, c.w, c.tabs]), [['map', 'fill', ['map']], ['deck', 380, ['deck']], ['side', 560, ['side']]]);
  assert.deepEqual(wide.handles, [['map', 'deck'], ['deck', 'side']]);
  assert.equal(wide.template, `minmax(0, 1fr) ${HANDLE}px 380px ${HANDLE}px 560px`);
  // A tablet: 260 + 300 + 360 + 14 > 820, the sheet (rank 1) goes into the deck, as a tab.
  const tablet = fit(cols, 820);
  assert.deepEqual(tablet.cols.map(c => [c.id, c.tabs]), [['map', ['map']], ['deck', ['deck', 'side']]]);
  // A phone: one column, every other one under it.
  assert.deepEqual(fit(cols, 390).cols.map(c => c.tabs), [['map', 'deck', 'side']]);
  // A width the user left: kept, within min and max; the one remembered is never rewritten.
  const saved = { wide: { deck: 9999, side: 400 } };
  assert.deepEqual(fit(cols, 1280, saved).cols.map(c => c.w), ['fill', 520, 400]);
  assert.deepEqual(saved, { wide: { deck: 9999, side: 400 } });
});

test('fit : jamais plus large que la boîte, quelle qu’elle soit (propriété)', () => {
  const m = defineMiniApp(meet());
  const cols = layoutAt(m, ['start', 'map', 'cards', 'photos']).columns;
  const rand = random(42);
  for (let i = 0; i < 500; i++) {
    const W = 700 + rand(1400);
    const saved = { [tierOf(W)]: { deck: 300 + rand(400), side: 300 + rand(800) } };
    const f = fit(cols, W, saved);
    const fixed = f.cols.reduce((n, c) => n + (c.w === 'fill' ? c.min : c.w), 0) + HANDLE * (f.cols.length - 1);
    assert.ok(fixed <= W, `W ${W}: ${JSON.stringify(f.cols)}`);
    assert.ok(f.cols.every(c => c.w === 'fill' || c.w >= c.min), `W ${W}: under a minimum`);
    assert.equal(f.cols.filter(c => c.w === 'fill').length, 1);
  }
});

test('createContext : clés déclarées seulement, bornes, égalité, dérivés mémoïsés sur ce qu’ils lisent', () => {
  let runs = 0;
  const ctx = createContext({ a: { init: 1, min: 0, max: 10 }, b: { init: 'x', persist: true }, list: { init: [] } },
    { twice: c => { runs++; return { v: c.a * 2 }; } }, { b: 'kept', a: 99 });
  assert.equal(ctx.get().b, 'kept');
  assert.equal(ctx.get().a, 1, 'only the persist keys come back');
  const first = ctx.get().twice;
  let told = 0;
  ctx.subscribe(() => { told++; });
  assert.equal(ctx.set({ a: 1, nope: 3 }), false, 'nothing changed: nobody told');
  assert.equal(told, 0);
  ctx.set({ list: [1] });
  assert.equal(ctx.get().twice, first, 'a key it does not read: the same object');
  ctx.set({ a: 50 });
  assert.equal(ctx.get().a, 10, 'clamped to max');
  assert.deepEqual(ctx.get().twice, { v: 20 });
  assert.equal(runs, 2);
  assert.deepEqual(ctx.persisted(), { b: 'kept' });
});

test('runtime : le chemin, can, l’avance par done, guided', () => {
  const m = defineMiniApp(meet({ id: 'meet-path' }));
  assert.equal(pathTo(m, ['start'], 'map', { point: null }), null, 'can is false');
  assert.deepEqual(pathTo(m, ['start'], 'cards', { point: [2, 48] }), ['start', 'map', 'cards']);
  assert.deepEqual(pathTo(m, ['start', 'map', 'cards'], 'map', { point: [2, 48] }), ['start', 'map']);
  assert.deepEqual([guided('auto', false), guided('auto', true), guided('on', true), guided('off', false)], [true, false, true, false]);
  const app = new MiniApp(m, { saved: null });
  const said = [];
  app.addEventListener('navigate', e => said.push(/** @type {CustomEvent} */ (e).detail.step));
  assert.equal(app.go('map'), false);
  app.set({ point: [2.35, 48.85] });
  assert.equal(app.go('map'), true);
  app.go('cards');
  // Guided: the first heart, and on to the photos.
  app.set({ liked: [1] });
  assert.deepEqual(app.path, ['start', 'map', 'cards', 'photos']);
  assert.deepEqual(said, ['map', 'cards', 'photos']);
  app.dispose();
});

test('runtime : « Rejouer » vide ce que l’application possède, et seulement cela, puis revient au départ', async () => {
  localStorage.setItem('geoflora.app.meet-replay.session', '"walk"');
  localStorage.setItem('geoflora.favorites-of-the-user', '"kept"');
  let resets = 0;
  const m = defineMiniApp(meet({ id: 'meet-replay', owns: { keys: ['geoflora.app.meet-replay.session'], reset: () => { resets++; } }, shared: ['favoris'] }));
  const app = new MiniApp(m, { saved: null });
  app.set({ point: [2.35, 48.85], radius: 5000 });
  app.go('cards');
  app.set({ liked: [3] });
  app.flush();
  assert.ok(localStorage.getItem(storageKey('meet-replay', 'state')));
  /** @type {any[]} */
  const navigations = [];
  app.addEventListener('navigate', e => navigations.push(/** @type {CustomEvent} */ (e).detail));
  const generation = app.generation;
  await app.replay();
  assert.deepEqual(app.path, ['start']);
  assert.deepEqual({ point: app.c.point, radius: app.c.radius, liked: app.c.liked }, { point: null, radius: 1000, liked: [] });
  assert.equal(app.generation, generation + 1);
  assert.equal(resets, 1);
  assert.equal(localStorage.getItem('geoflora.app.meet-replay.session'), null);
  assert.equal(localStorage.getItem('geoflora.favorites-of-the-user'), '"kept"', 'what it only uses stays');
  assert.deepEqual(navigations, [{ step: 'start', replace: true }]);
  app.flush();
  // Nothing left behind, as if never opened: no state, no layout.
  assert.equal(localStorage.getItem(storageKey('meet-replay', 'state')), null);
  assert.equal(localStorage.getItem(storageKey('meet-replay', 'layout')), null);
  // As found again on the next visit: nothing to take up again.
  const again = new MiniApp(m);
  assert.deepEqual([again.c.point, again.savedPath, again.finished, again.resume()], [null, [], false, null]);
  again.dispose();
  app.dispose();
});
