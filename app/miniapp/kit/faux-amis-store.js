// @ts-check
// Faux amis: where a game kept on this device stands — the card to answer, a game under way —, for the list of the
// ways to play (app/miniapps/index.js, at every launch) as for the game itself; the rest of the game is in
// faux-amis.js, loaded with the mini-app. Pure: tested under Node (tests/unit/faux-amis.test.mjs).

/** @typedef {{ cards?: ({ answer?: string | null } | null)[] }} KeptGame */

/** The card to answer now, -1 when all are (the recap) or there is no game. @param {KeptGame | null | undefined} game */
export const nextCard = game => Array.isArray(game?.cards) ? game.cards.findIndex(k => k?.answer == null) : -1;

/** A game started and not finished (the list offers « Continuer »). @param {KeptGame | null | undefined} game */
export const underWay = game => nextCard(game) >= 0;
