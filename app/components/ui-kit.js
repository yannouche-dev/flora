// @ts-check
// Templates and styles shared by the app's screens, written once: a modal question (dialog.ask) and « Recommencer :
// tout effacer ? » (the launcher, gf-launcher.js, and a mini-app's box, gf-miniapp.js, ask it the same way).

import { css, html } from 'lit';
import { fr } from '../core/fr.js';

/** A modal question (<dialog class="ask">): its box, its title, its text, its row of buttons at the end. */
export const askStyles = css`
  dialog.ask { width: min(440px, calc(100vw - 24px)); padding: 20px; border: 0; border-radius: 16px; background: var(--gf-surface); color: var(--gf-text); box-shadow: var(--gf-shadow-float); }
  dialog.ask::backdrop { background: rgb(0 0 0 / 45%); }
  dialog.ask h2 { margin: 0 0 8px; font-size: 1.15rem; }
  dialog.ask p { margin: 0 0 16px; color: var(--gf-text-muted); }
  dialog.ask .row { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; }
  dialog.ask .row button { margin: 0; }
`;

/**
 * « Recommencer : tout effacer ? »: its title (`<id>-title`), what goes and what stays of the activity (`<id>-text`,
 * for aria-describedby), what is not the activity's and stays. The buttons are the caller's.
 * @param {string} title the activity's @param {{ gone: string[], kept: string[] } | null | undefined} items what its replay deletes, and keeps
 * @param {string} id
 */
export function replayQuestion(title, items, id) {
  return html`<h2 id=${id + '-title'}>${fr('Recommencer : tout effacer ?')}</h2>
    <p id=${id + '-text'}>${items ? fr(`Seront supprimés : ${items.gone.join(', ')}. Cette action est définitive.`) : ''}${(items?.kept ?? []).map(k => ' ' + fr(k))}</p>
    <p class="kept">${title ? fr(`Ce qui ne vient pas de ${title} reste : vos autres plantes et favoris, vos lieux, vos réglages.`) : ''}</p>`;
}
