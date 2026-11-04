// A search of its own (app/core/search-channel.js, SearchChannel: each group of a screen of one's own), against a
// worker the test answers (core/search.js posts to it): its search run once the flora is there, published — an older
// run's answer, come last, dropped —, or fetched without being published; nothing said found before its first answer
// (`answered`); another screen's answer forgotten (`forget`: no answer again, its scope kept); kept to the plants of a
// zone, then to the whole flora again. The app's (Flore's: APP) never is. A search component's `answered`
// (SearchController): its channel's, the app's always.
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** The searches the worker was asked, in their order. @type {any[]} */
const asked = [];
/** How the worker answers a search (the test sets it). @type {(message: any) => Promise<any>} */
let answer = async () => found(0);

// The worker of core/search.js, made when it loads: this one, before it is imported.
/** @type {any} */ (globalThis).Worker = class {
  /** @type {((e: { data: any }) => void)[]} */ #heard = [];
  /** @param {string} type @param {(e: { data: any }) => void} fn */
  addEventListener(type, fn) { if (type === 'message') this.#heard.push(fn); }
  removeEventListener() {}
  terminate() {}
  /** @param {any} message */
  postMessage(message) {
    asked.push(message);
    const say = (/** @type {any} */ data) => { for (const fn of this.#heard) fn({ data: { requestId: message.requestId, ...data } }); };
    answer(message).then(say, (/** @type {Error} */ e) => say({ error: e.message }));
  }
};

const { APP, SearchChannel, SearchController, emptyQuery } = await import('../../app/core/search-channel.js');
const { runSearch } = await import('../../app/core/search.js');
const { store } = await import('../../app/core/store.js');

/** The worker's answer: `total` plants found. @param {number} total */
function found(total) {
  return { total, items: [], facets: {}, suggestions: [], fuzzy: 0, sort: 'fr', counted: false, inZone: null };
}
const wait = (/** @type {number} */ ms) => new Promise(resolve => setTimeout(resolve, ms));

test('une recherche à soi : rien de dit avant sa première réponse ; publiée, ses résultats et `change` ; la réponse d’une recherche plus ancienne, venue après, jetée', async () => {
  const ch = new SearchChannel();
  let changes = 0;
  ch.addEventListener('change', () => changes++);
  // The flora not there yet: nothing asked of the worker.
  ch.query = { ...emptyQuery(), q: 'ortie' };
  const waiting = ch.run();
  await wait(10);
  assert.deepEqual([asked.length, ch.answered, changes], [0, false, 0]);
  answer = async message => { await wait(message.q === 'ortie' ? 60 : 0); return found(message.q === 'ortie' ? 1 : 2); };
  store.set({ status: 'ready' });
  await waiting;
  assert.deepEqual([ch.answered, ch.results.total, changes], [true, 1, 1]);
  // Two runs: the first one's slow answer comes after the second's — dropped.
  const first = ch.run();
  await wait(10);
  ch.query = { ...emptyQuery(), q: 'ail' };
  await ch.run();
  assert.deepEqual([ch.results.total, changes], [2, 2]);
  await first;
  assert.deepEqual([ch.results.total, changes], [2, 2]);
  assert.deepEqual(asked.map(m => m.q), ['ortie', 'ortie', 'ail']);
});

test('fetch : la réponse sans la publier (publish la publie) ; une recherche qui échoue : rien, ni publié ni répondu', async () => {
  const ch = new SearchChannel();
  let changes = 0;
  ch.addEventListener('change', () => changes++);
  answer = async () => found(7);
  const got = await ch.fetch();
  assert.equal(got?.total, 7);
  assert.deepEqual([ch.answered, ch.results.total, changes], [false, 0, 0]);
  ch.publish(got);
  assert.deepEqual([ch.answered, ch.results.total, changes], [true, 7, 1]);
  answer = async () => { throw new Error('IndexedDB fermée'); };
  assert.equal(await ch.fetch(), null);
  await ch.run();
  assert.deepEqual([ch.results.total, changes], [7, 1]);
});

test('gardée aux plantes d’une zone : le moteur les reçoit, avec leurs observations et celles de la vue d’une carte ; sans zone, toute la flore', async () => {
  const ch = new SearchChannel();
  answer = async () => found(2);
  ch.setScope([3, 1], { observed: { 1: 4, 3: 2 }, within: [1] });
  await ch.run();
  const kept = asked.at(-1);
  assert.deepEqual([kept.only, kept.observed, kept.within], [[3, 1], { 1: 4, 3: 2 }, [1]]);
  ch.setScope(null, { observed: { 1: 4 } });
  await ch.run();
  const whole = asked.at(-1);
  assert.deepEqual([whole.only, whole.observed, whole.within], [null, null, null]);
});

test('la recherche de l’app (Flore) n’est jamais gardée à une zone : rien pour l’y garder, toute la flore demandée', async () => {
  assert.equal('setScope' in APP, false);
  answer = async () => found(300);
  store.set({ query: { ...emptyQuery(), q: 'chêne' } });
  await runSearch();
  const sent = asked.at(-1);
  assert.equal(sent.q, 'chêne');
  assert.deepEqual(['only', 'observed', 'within'].filter(k => sent[k] != null), []);
  assert.equal(store.state.results.total, 300);
});

test('forget : la réponse d’un autre écran oubliée — rien de trouvé ni de répondu, sans `change`, la zone gardée ; la recherche suivante répond', async () => {
  const ch = new SearchChannel();
  answer = async () => found(4);
  ch.setScope([5, 6]);
  await ch.run();
  assert.deepEqual([ch.answered, ch.results.total], [true, 4]);
  let changes = 0;
  ch.addEventListener('change', () => changes++);
  ch.forget();
  assert.deepEqual([ch.answered, ch.results.total, ch.results.items, ch.results.facets, ch.scope, changes], [false, 0, [], {}, [5, 6], 0]);
  answer = async () => found(1);
  await ch.run();
  assert.deepEqual([ch.answered, ch.results.total, changes], [true, 1, 1]);
  assert.deepEqual(asked.at(-1).only, [5, 6]);
});

test('SearchController.answered : celui de la recherche de son hôte (faux avant sa première réponse) ; celle de l’app (Flore), toujours', async () => {
  const host = { channel: /** @type {any} */ (null), addController() {}, removeController() {}, requestUpdate() {}, updateComplete: Promise.resolve(true) };
  const control = new SearchController(host);
  assert.equal(control.answered, true);
  const ch = new SearchChannel();
  host.channel = ch;
  assert.equal(control.answered, false);
  answer = async () => found(3);
  await ch.run();
  assert.equal(control.answered, true);
  host.channel = APP;
  assert.equal(control.answered, true);
});
