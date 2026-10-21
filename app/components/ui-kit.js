// @ts-check
// Templates and styles shared by the app's screens, written once: a sheet from the bottom (dialog.drawer: Flore's
// filters, « Ajouter à… », the map's panel, the harvest warning), a modal question (dialog.ask), « Recommencer : tout
// effacer ? » (the launcher, gf-launcher.js, and a mini-app's box, gf-miniapp.js, ask it the same way) and a plant's
// verdict as a chip (core/danger.js: the sheet, the cards of the games, the harvest warning, the confusions).

import { css, html, nothing } from 'lit';
import { fr } from '../core/fr.js';
import { icon } from '../core/icons.js';

/**
 * A sheet from the bottom (<dialog class="drawer">): the whole width on a phone, at most --drawer-w wide (520px) and
 * --drawer-h high (86dvh), the page dimmed by --drawer-dim (40%); `centered`: in the middle from 700 px wide; `rises`:
 * slides up as it opens (not with reduced motion).
 */
export const sheetStyles = css`
  dialog.drawer { position: fixed; inset: auto 0 0 0; width: 100%; max-width: var(--drawer-w, 520px); max-height: var(--drawer-h, 86dvh); margin: 0 auto; padding: 0;
    border: 0; border-radius: var(--gf-radius-lg) var(--gf-radius-lg) 0 0; background: var(--gf-surface); color: var(--gf-text); flex-direction: column; }
  dialog.drawer[open] { display: flex; }
  dialog.drawer::backdrop { background: rgb(0 0 0 / var(--drawer-dim, 40%)); }
  dialog.drawer.rises[open] { animation: drawer-up 0.2s ease-out; }
  @keyframes drawer-up { from { transform: translateY(40px); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { dialog.drawer.rises[open] { animation: none; } }
  @media (min-width: 700px) { dialog.drawer.centered { inset: 0; margin: auto; border-radius: var(--gf-radius-lg); height: fit-content; } }
`;

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

/**
 * A verdict's chip (core/danger.js#dangerLevel, or a confusion's: danger.js#confusionChip): its word in its level's
 * colour — `info` neutral, `warn` amber, `danger` red, `deadly` red filled —, after it the number of its reasons when
 * `count`, its reasons on hover. Nothing for `none` or no word: no chip ever says a plant is harmless. Not imported
 * from danger.js: this module is in the app's start, the verdict is not (tools/start-baseline.json).
 * @param {{ level: string, word: string, reasons?: { text: string }[] } | null | undefined} v
 * @param {{ count?: boolean }} [o]
 */
export function severityChip(v, { count = false } = {}) {
  if (!v?.word || !v.level || v.level === 'none') return nothing;
  const n = v.reasons?.length ?? 0;
  const glyph = v.level === 'deadly' || v.level === 'danger' ? icon('exclamation-octagon-fill') : v.level === 'warn' ? icon('exclamation-triangle-fill') : nothing;
  return html`<span class="sev-chip ${v.level}" title=${n ? v.reasons?.map(r => r.text).join('\n') ?? nothing : nothing}>${glyph}${fr(v.word)}${count && n ? ` · ${n}` : ''}</span>`;
}

/** The chip's colours (Faux amis' tag, one per level): text at 4.5:1 on its tint, light or dark; `deadly` filled. */
export const severityStyles = css`
  .sev-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 2px 8px; box-sizing: border-box; border-radius: var(--gf-radius-pill);
    font-size: 0.75rem; font-weight: 700; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: middle;
    background: var(--gf-surface-2); color: var(--gf-text); }
  .sev-chip .bi { flex: none; }
  .sev-chip.warn { background: var(--gf-warn-bg); color: color-mix(in srgb, var(--gf-warn) 78%, var(--gf-text)); }
  .sev-chip.danger { background: var(--gf-danger-bg); color: var(--gf-danger); }
  .sev-chip.deadly { background: var(--gf-deadly); color: var(--gf-deadly-contrast); }
`;
