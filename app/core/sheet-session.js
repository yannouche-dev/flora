// @ts-check
// The display of the plant sheet while browsing: what the user chose on one plant stays on the next one —
// the rubric reached (« Saisons »…), the media filters and zoom, the panels opened. In memory only: it lasts as
// long as the browsing (a new visit starts from the top of the sheet).

/**
 * @typedef {{ filter: string, part: string, info: boolean, playing: boolean, opened: boolean, zoom: 'auto' | 'fit' | 'one' }} MediaSession
 */

export const sheetSession = {
  /** The rubric (category key) last reached; null at the top of the sheet. @type {string | null} */
  anchor: null,
  /** The block read in it (« Carte » in Répartition), and how far into it, in px. @type {string | null} */
  anchorBlock: null,
  anchorOffset: 0,
  /** In the Wikipédia block: the theme read (its anchor). @type {string | null} */
  anchorWiki: null,
  /** @type {MediaSession} */
  media: { filter: 'all', part: 'all', info: false, playing: false, opened: false, zoom: 'auto' },
  /** Blocks whose sub-blocks list is open. @type {Set<string>} */
  subsOpen: new Set(),
  /** Map blocks whose settings are open. @type {Set<string>} */
  mapsOpen: new Set(),
  /** The edge maximised to the whole sheet. @type {string | null} */
  maxEdge: null,
  /** Wikipédia: the themes opened (« theme:x ») or closed (« closed:x ») in its block. @type {Set<string>} */
  wikiThemes: new Set(),
  /** « Mes lieux » unfolded. */
  spotsOpen: false
};

/** @param {Partial<MediaSession>} patch */
export function setMediaSession(patch) {
  sheetSession.media = { ...sheetSession.media, ...patch };
}
