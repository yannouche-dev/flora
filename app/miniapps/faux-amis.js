// @ts-check
// Faux amis: six pairs of plants mistaken for one another — the plant sought and its toxic look-alike — from the list of
// the Anses and the Centres antipoison (data/lookalikes.json: bundled, it plays offline). Four cards ask whose a
// criterion of the sources is, two show a pair they give none for (« Je ne cueille pas »); then the recap: the six
// pairs and their criteria, each plant's sheet, whom to call. No timer, no map; never a word that a plant can be eaten.
// Built from the kit: its game (kit/faux-amis.js), its start screen (below, drawn by the box), the cards and the recap
// (ma-faux-amis). Départ › Partie, each one an address (#/app/faux-amis/play); opened with no step named, a game under
// way comes back at once (resumeAt).
// Owns — everything « Rejouer » / « Recommencer » empties: its state (geoflora.app.faux-amis.state: the game dealt and
// its answers) and layout (runtime.js#replay). Shares: nothing of the user's but the settings (« Photos en ligne »).

import { lookalikeData, UNREAD_LOOKALIKES } from '../core/lookalikes.js';
import { defineMiniApp } from '../miniapp/define.js';
import { cardsOf, dealGame, nextCard, underWay } from '../miniapp/kit/faux-amis.js';

/** The file read again for a game kept, and unreadable: said over its cards (never « nothing to fear »). */
const UNREAD = Object.freeze({ unread: true });

/** A new game, from the file; unreadable, said (app.error, on the start screen) and no game. @param {import('../miniapp/runtime.js').MiniApp} app */
async function deal(app) {
  let data;
  try { data = await lookalikeData(); } catch { throw new Error(UNREAD_LOOKALIKES); }
  app.set({ lookalikes: data, game: dealGame(data.pairs), focus: null });
  app.go('play');
}

/**
 * The first screen: « Jouer » (« Nouvelle partie » when one is under way, offered just under it); the way out, the
 * other scenarios. @param {any} c @param {import('../miniapp/runtime.js').MiniApp} app
 * @returns {import('../components/start-screen.js').StartSpec}
 */
function start(c, app) {
  const kept = underWay(c.game) ? c.game : null;
  return {
    id: 'faux-amis',
    art: 'twins',
    title: 'Faux amis',
    lead: 'Six paires de plantes qu’on confond : la plante cherchée et son sosie toxique. À qui est chaque indice des sources ?',
    caution: { text: 'Un jeu pour apprendre, pas pour reconnaître : ne cueillez jamais une plante sur la foi d’un indice ou d’une photo.' },
    primary: { icon: 'lightbulb', label: kept ? 'Nouvelle partie' : 'Jouer', busyLabel: 'Les cartes…', busy: app.busy('deal'), run: () => { app.do('deal'); } },
    note: 'Indices, dangers et sources : Anses et Centres antipoison.',
    alternatives: [kept && { kind: 'choices', label: 'Reprendre', items: [{ key: 'resume', icon: 'arrow-right', label: 'La partie en cours',
      meta: `carte ${nextCard(kept) + 1} sur ${kept.cards.length}`, run: () => { app.go('play'); } }] }],
    exit: { icon: 'camera-reels', label: 'Quitter Faux amis : autres scénarios', run: () => { app.scenarios(); } }
  };
}

export default defineMiniApp({
  id: 'faux-amis',
  title: 'Faux amis',
  icon: 'lightbulb',
  scene: 'twins',
  pitch: 'Six paires de plantes qu’on confond : à qui est chaque indice ? Sans indice sûr, on ne cueille pas.',
  exit: { label: 'Quitter Faux amis' },
  shared: ['réglages'],
  context: {
    // The game dealt and its answers (kit/faux-amis.js Game), kept on this device.
    game: { init: null, persist: true },
    // data/lookalikes.json, read again at each visit: a game's words are always the file's ({ unread: true }: it could not be).
    lookalikes: { init: null },
    // A plant's sheet open from the recap (?p=).
    focus: { init: null }
  },
  derive: { cards: c => cardsOf(c.game, c.lookalikes) },
  data: { lookalikes: { key: c => c.game ? 'lookalikes' : null, load: () => lookalikeData().catch(() => UNREAD), into: 'lookalikes' } },
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
