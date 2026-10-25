// @ts-check
// Faux amis: six pairs of plants mistaken for one another — the plant sought and its toxic look-alike — from the list of
// the Anses and the Centres antipoison (data/lookalikes.json: bundled, it plays offline). Four cards ask whose a
// criterion of the sources is, two show a pair they give none for (« Je ne cueille pas »); then the recap: the six
// pairs and their criteria, each plant's sheet, whom to call. No timer, no map; never a word that a plant can be eaten.
// Built from the kit: its game (kit/faux-amis.js; where a kept game stands: kit/faux-amis-store.js), its start screen
// (below, drawn by the box), the cards and the recap (ma-faux-amis). Départ › Partie, each one an address
// (#/app/faux-amis/play); opened with no step named, a game under way comes back at once (resumeAt).
// A game under way is never thrown away without being asked: on the start screen, « Continuer la partie » is the big
// action, « Nouvelle partie » a small one that says so; « Recommencer » asks first.
// Owns — everything « Recommencer » empties: its state (geoflora.app.faux-amis.state: the game dealt and
// its answers) and layout (runtime.js#replay), the width of a plant's sheet beside the recap
// (geoflora.app.faux-amis.sheet). Shares: nothing of the user's but the settings (« Photos en ligne »).

import { lookalikeData, UNREAD_LOOKALIKES } from '../core/lookalikes.js';
import { defineMiniApp } from '../miniapp/define.js';
import { cardsOf, dealGame } from '../miniapp/kit/faux-amis.js';
import { nextCard, underWay } from '../miniapp/kit/faux-amis-store.js';

/** The file read again for a game kept, and unreadable: said over its cards (never « nothing to fear »). */
const UNREAD = Object.freeze({ unread: true });

/**
 * A new game, from the file; unreadable, said (app.error, on the start screen) and no game. Stopped (« Quitter »,
 * « Recommencer » while the file is read): nothing dealt. @param {import('../miniapp/runtime.js').MiniApp} app
 */
async function deal(app) {
  const signal = app.signal('deal');
  let data;
  try { data = await lookalikeData(); } catch { throw new Error(UNREAD_LOOKALIKES); }
  if (signal.aborted) return;
  app.set({ lookalikes: data, game: dealGame(data.pairs) });
  app.go('play');
}

/**
 * To the game under way; the file unreadable at the last try, read again first (the game is kept).
 * @param {any} c @param {import('../miniapp/runtime.js').MiniApp} app
 */
function resume(c, app) {
  if (c.lookalikes?.unread) app.set({ lookalikes: null, retry: c.retry + 1 });
  app.go('play');
}

/**
 * The first screen: « Commencer »; a game under way, « Continuer la partie » (where it was left) in its place, and a
 * new game, smaller, saying it replaces it. The link at the bottom: the other activities (Découvrir over it).
 * @param {any} c @param {import('../miniapp/runtime.js').MiniApp} app @returns {import('../components/start-screen.js').StartSpec}
 */
function start(c, app) {
  const kept = underWay(c.game) ? c.game : null;
  return {
    id: 'faux-amis',
    art: 'twins',
    title: 'Faux amis',
    lead: 'Six paires de plantes qu’on confond : la plante cherchée et son sosie toxique. À qui est chaque indice des sources ?',
    caution: { text: 'Un jeu pour apprendre, pas pour reconnaître : ne cueillez jamais une plante sur la foi d’un indice ou d’une photo.' },
    primary: kept
      ? { icon: 'arrow-right', label: 'Continuer la partie', run: () => resume(c, app) }
      : { icon: 'lightbulb', label: 'Commencer', busyLabel: 'Les cartes…', busy: app.busy('deal'), run: () => { app.do('deal'); } },
    note: kept ? `Carte ${nextCard(kept) + 1} sur ${kept.cards.length}.` : 'Indices et sources : Anses et Centres antipoison ; gravité, aussi la base TPPT (Agroscope).',
    alternatives: [kept && { kind: 'link', icon: 'arrow-counterclockwise', label: 'Nouvelle partie : celle en cours sera effacée', run: () => { app.do('deal'); } }],
    exit: { icon: 'camera-reels', label: 'Autres activités', run: () => { app.scenarios(); } }
  };
}

export default defineMiniApp({
  id: 'faux-amis',
  title: 'Faux amis',
  icon: 'lightbulb',
  scene: 'twins',
  pitch: 'Six paires de plantes qu’on confond : à qui est chaque indice ? Sans indice sûr, on ne cueille pas.',
  exit: { label: 'Quitter l’activité' },
  owns: { keys: ['geoflora.app.faux-amis.sheet'], label: 'la partie en cours' },
  shared: ['réglages'],
  context: {
    // The game dealt and its answers (kit/faux-amis.js Game), kept on this device.
    game: { init: null, persist: true },
    // data/lookalikes.json, read again at each visit: a game's words are always the file's ({ unread: true }: it could
    // not be); `retry` reads it again (« Réessayer »), the game kept.
    lookalikes: { init: null },
    retry: { init: 0 },
    // A plant's sheet open from the recap (?p=).
    focus: { init: null }
  },
  derive: { cards: c => cardsOf(c.game, c.lookalikes) },
  data: { lookalikes: { key: c => c.game ? 'lookalikes:' + c.retry : null, load: () => lookalikeData().catch(() => UNREAD), into: 'lookalikes' } },
  actions: { deal: { run: deal } },
  resumeAt: c => underWay(c.game) ? 'play' : null,
  columns: [{ id: 'main', base: 'fill', min: 300, rank: 1, title: 'Faux amis' }],
  phone: { rows: [['main', '1fr']] },
  steps: [
    { id: 'start', kind: 'start', label: 'Départ', about: 'Six paires de plantes', next: 'play', start: (c, app) => start(c, app) },
    { id: 'play', label: 'Partie', about: 'À qui est cet indice ?', can: c => Boolean(c.game?.cards?.length),
      add: [{ id: 'game', use: 'fauxAmis', col: 'main', title: 'Faux amis' }] }
  ]
});
