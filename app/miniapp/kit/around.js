// @ts-check
// What the three mini-apps around a place share in their manifests (Rencontres, Cueillette prudente, Mosaïque): the
// context their components read (the place, the distance, the swipes, kept; the plant open, the start's error), the
// first screen (« Autour de moi », a commune, « Reprendre » the place kept), the action that finds where you are, and
// the steps start › map › cards (a place chosen: the map, its distance; then the cards).

import { FIX_MAX_AGE, geoProblem, takeFix } from '../../core/geo.js';
import { discovering, finishDiscover } from '../../core/discover.js';
import { href } from '../../core/router.js';
import { distLabel } from './cards.js';
import { sessionOf } from './session.js';

/** @typedef {'meet' | 'harvest' | 'mosaic'} AroundKind */

/** The words of each one's first screen (`name`: in « Quitter … : autres scénarios »). */
export const WORDS = {
  meet: { name: 'les rencontres', title: 'Rencontrez les plantes d’ici',
    lead: 'Une carte par plante observée autour de vous. Un coup de cœur à droite, au suivant à gauche. Vos coups de cœur rejoignent vos favoris.' },
  harvest: { name: 'la cueillette', title: 'Cueillette prudente', lead: 'Ce qui se cueille autour de vous, et ses sosies dangereux. Les plus toxiques passent en premier.',
    caution: { text: 'Ne cueillez jamais une plante sans être sûr de vous.' } },
  mosaic: { name: 'la mosaïque', title: 'La mosaïque du coin', lead: 'Les photos des plantes observées près d’ici, en grand. Touchez une image pour voir toutes celles de la plante.' }
};

/**
 * The context of a mini-app around a place: kept (persist) — the place chosen and its name, the distance, the cards
 * swiped right (matches) and left (passed); for the visit, each in the address (router.js, AppRoute) — the plant open
 * (?p=), the view of the list (&v=: « matchs », « toutes »; null: its own), the image shown (&m=: its place among the
 * plant's media; null: the first) —, why « Autour de moi » failed. Rencontres adds the plant chosen (chosenContext).
 * @returns {Record<string, import('../define.js').ContextKey>}
 */
export const aroundContext = () => ({
  point: { init: null, persist: true },
  place: { init: null, persist: true },
  radius: { init: 1000, persist: true, min: 200, max: 50000 },
  matches: { init: [], persist: true },
  passed: { init: [], persist: true },
  focus: { init: null },
  view: { init: null },
  mediaAt: { init: null },
  startError: { init: null }
});

/**
 * Rencontres: ONE plant on the screen, « la plante choisie » — the map's highlight, the photos beside the deck and the
 * plant's sheet all show it (kit/session.js#chosenId). `focus` (?p=) is that plant, kept with the game: the last one
 * loved, or picked since (the sheet's « Suivante », a point of the map, a tile of « Matchs » or « Toutes »); none yet:
 * the card on top of the deck (followed as it is swiped). `sheet` (&fiche=1): its sheet open, beside the cards (a
 * phone: over them). `media`: the photos the first heart brought (once a game) — { by: the plant whose heart brought
 * them (its ↺ takes them away), closed: the pane closed }; none: not yet.
 * @returns {Record<string, import('../define.js').ContextKey>}
 */
export const chosenContext = () => ({
  focus: { init: null, persist: true },
  sheet: { init: false },
  media: { init: null, persist: true }
});

/** A place chosen: the map and its distance, then the cards. @param {any} c */
const placed = c => Array.isArray(c.point);

/**
 * « Autour de moi »: once; a commune chosen meanwhile, « Annuler », the app left drop its answer; an old fix is not
 * taken. Found: the place, and on to the map. @type {import('../define.js').ActionSpec}
 */
export const locate = {
  mode: 'exclusive',
  run: (/** @type {import('../runtime.js').MiniApp} */ app) => new Promise(resolve => {
    app.set({ startError: null });
    // Within the watch's call (takeFix): a fix the watch already holds is on the map before the start is drawn again.
    takeFix({ maxAge: FIX_MAX_AGE, signal: app.signal('locate') }, r => {
      resolve(undefined);
      if (!r) return;
      if ('error' in r) app.set({ startError: geoProblem(r.code, { place: true, retry: () => app.do('locate') }) });
      else { sessionOf(app).setPoint(r.coordinates, null); app.go('map'); }
    });
  })
};

/**
 * The first screen (start-screen.js's template): its picture and words, « Autour de moi »; smaller, a commune, the
 * place kept (« Reprendre »); the way out — « Passer » during the first steps (Rencontres), else the launcher.
 * @param {any} c @param {import('../runtime.js').MiniApp} app @param {AroundKind} kind
 * @returns {import('../../components/start-screen.js').StartSpec}
 */
export function aroundStart(c, app, kind) {
  const w = /** @type {{ name: string, title: string, lead: string, caution?: { text: string } }} */ (WORDS[kind]);
  const stop = () => { app.cancel('locate'); app.set({ startError: null }); };
  return {
    id: kind, art: kind, title: w.title, lead: w.lead, caution: w.caution,
    primary: { icon: 'geo-alt-fill', label: 'Autour de moi', busyLabel: 'Localisation…', busy: app.busy('locate'), cancel: stop, run: () => { app.do('locate'); } },
    error: c.startError,
    note: 'Votre position est envoyée à iNaturalist et à l’IGN pour chercher autour de vous ; elle n’est gardée que sur cet appareil.',
    alternatives: [
      { kind: 'place', label: 'ou choisir une commune', field: 'Choisir une commune', pick: p => { stop(); sessionOf(app).setPoint(p.coordinates, p.label); app.go('map'); } },
      placed(c) && { kind: 'choices', label: 'Reprendre', items: [{ key: 'kept', icon: 'geo-alt', label: c.place ? `Autour de ${c.place}` : 'Au dernier lieu choisi',
        meta: distLabel(c.radius || 1000), run: () => { stop(); app.go('map'); } }] }
    ],
    exit: kind === 'meet' && discovering()
      ? { label: 'Passer : montrer toute l’application', href: href.search(), run: () => finishDiscover() }
      : { icon: 'camera-reels', label: `Quitter ${w.name} : autres scénarios`, run: () => { stop(); app.scenarios(); } }
  };
}

/**
 * The columns of the three games: the map (its step « map », then beside the cards; its width the user's — kept per
 * tier with the layout, forgotten by « Recommencer »), the cards filling the rest (and the photos, Rencontres: their
 * pane inside it while there is room for the deck and them, else full screen). A phone: the map a band on top, the
 * cards under it. @param {string} title the cards' column
 * @returns {{ columns: import('../define.js').Column[], phone: { rows: [string, string][] } }}
 */
export const aroundColumns = title => ({
  columns: [
    { id: 'map', base: 480, min: 300, max: 1100, rank: 1, heavy: true, title: 'Carte', mergeInto: 'cards' },
    { id: 'cards', base: 'fill', min: 380, rank: 2, title }
  ],
  phone: { rows: [['map', 'auto'], ['cards', '1fr']] }
});

/** The last step's name in the steps bar, and what it shows. */
const CARDS = {
  meet: { label: 'Rencontres', about: 'Une carte à la fois' },
  harvest: { label: 'Cueillette', about: 'Ce qui se cueille, et ses sosies dangereux' },
  mosaic: { label: 'Mosaïque', about: 'Les photos des plantes d’ici' }
};

/**
 * The steps: the start, the map (how far), the cards — added beside the map, which stays (the same map: its circle,
 * its points; its distance a chip then). `map` and `cards` add the components of each app.
 * @param {AroundKind} kind @param {{ map?: import('../define.js').Place[], cards?: import('../define.js').Place[], drop?: string[] }} put
 * @returns {import('../define.js').Step[]}
 */
export const aroundSteps = (kind, put) => [
  { id: 'start', kind: 'start', label: 'Départ', about: 'Autour de vous, ou d’une commune', next: 'map', start: (c, app) => aroundStart(c, app, kind) },
  { id: 'map', label: 'Carte', about: 'Jusqu’où chercher', can: placed, next: 'cards', add: put.map ?? [] },
  { id: 'cards', label: CARDS[kind].label, about: CARDS[kind].about, can: placed,
    add: put.cards ?? [], drop: put.drop ?? [] }
];
