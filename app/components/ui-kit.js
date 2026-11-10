// @ts-check
// Templates and styles shared by the app's screens, written once: a sheet from the bottom (dialog.drawer: Flore's
// filters, « Ajouter à… », the map's panel, the harvest warning, « Noter ici »), a modal question (dialog.ask; gf-ask.js
// asks any), « Recommencer : tout effacer ? » (the list of Découvrir, gf-launcher.js, and an activity's box,
// gf-miniapp.js, ask it the same way), a plant's verdict as a chip (core/danger.js: the sheet, the cards of the games, the
// harvest warning, the confusions) and the GPS dot of a position (« Noter ici », a lieu's editor).

import { css, html, nothing } from 'lit';
import { fr } from '../core/fr.js';
import { icon } from '../core/icons.js';
import { href } from '../core/router.js';

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
  dialog.ask { width: min(440px, calc(100vw - 24px)); padding: 20px; border: 0; border-radius: var(--gf-radius-lg); background: var(--gf-surface); color: var(--gf-text); box-shadow: var(--gf-shadow-float); }
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
  return html`<span class="sev-chip ${v.level}" title=${n ? v.reasons?.map(r => r.text).join('\n') ?? nothing : nothing}>${severityGlyph(v.level)}${fr(v.word)}${count && n ? ` · ${n}` : ''}</span>`;
}

/** A level's sign: an octagon for danger and deadly, a triangle for a warning, none below. @param {string} level */
export const severityGlyph = level =>
  level === 'deadly' || level === 'danger' ? icon('exclamation-octagon-fill') : level === 'warn' ? icon('exclamation-triangle-fill') : nothing;

/**
 * The colours of a level, one per level: the chip (Faux amis' tag, Flore's « Protection » column) and the line of a
 * warning (`.sev-line`, the toast of « Noter ici »), each on its own tint — readable on any surface, text at 4.5:1,
 * light or dark; `deadly` filled. The box of a level (`.sev-box`: the sheet's Prudence, Statut and confusions,
 * Cueillette prudente's banner): its border and tint, the page's text — danger and deadly the same red box (the chip
 * in it says which) —, its own sign (a glyph right in it) in its level's colour. Never `.danger` alone on a box:
 * styles/ui.js gives that class the destructive look (its colour; `.sev-box` sets its own).
 */
export const severityStyles = css`
  .sev-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 2px 8px; box-sizing: border-box; border-radius: var(--gf-radius-pill);
    font-size: 0.75rem; font-weight: 700; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: middle;
    background: var(--gf-surface-2); color: var(--gf-text); }
  .sev-chip .bi { flex: none; }
  .sev-line { display: block; padding: 6px 10px; border-radius: var(--gf-radius-sm); background: var(--gf-surface-2); color: var(--gf-text);
    font-size: 0.85rem; font-weight: 600; line-height: 1.35; }
  .sev-line a { color: inherit; }
  .sev-chip.warn, .sev-line.warn { background: var(--gf-warn-bg); color: color-mix(in srgb, var(--gf-warn) 78%, var(--gf-text)); }
  .sev-chip.danger, .sev-line.danger { background: var(--gf-danger-bg); color: var(--gf-danger); }
  .sev-chip.deadly, .sev-line.deadly { background: var(--gf-deadly); color: var(--gf-deadly-contrast); }
  .sev-box { display: block; padding: 8px 12px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius); background: var(--gf-surface-2);
    color: var(--gf-text); }
  .sev-box.warn { border-color: var(--gf-warn); background: var(--gf-warn-bg); }
  .sev-box.danger, .sev-box.deadly { border-color: var(--gf-danger); background: var(--gf-danger-bg); }
  .sev-box.warn > .bi { color: var(--gf-warn); }
  .sev-box:is(.danger, .deadly) > .bi { color: var(--gf-danger); }
`;

/**
 * The GPS dot before the words of a position (« Noter ici », a lieu's editor — the words are theirs): `good` green,
 * within config.goodAccuracy (or a point placed by hand); `weak` amber, beyond it; `none` red, no position (its error
 * said); grey while it is searched. Its green and amber are the same in both themes, like the maps' marks.
 * @param {'good' | 'weak' | 'none' | ''} level
 */
export const gpsDot = level => html`<span class="gps-dot ${level}"></span>`;

/** The GPS dot's look (gpsDot), in the shadow root of what shows it. */
export const gpsStyles = css`
  .gps-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--gf-text-muted); flex: none; }
  .gps-dot.good { background: #16a34a; }
  .gps-dot.weak { background: #f59e0b; }
  .gps-dot.none { background: var(--gf-danger); }
`;

/**
 * « Photos en ligne » switched off (Réglages › Modules): the one line said where photos would be — in the sheet (Photos,
 * Médias, Médias GBIF), a block alone, a screen's Médias cell —, the way back to it in it.
 */
export const photosOffLine = () => html`Photos en ligne désactivées (<a href=${href.settings('modules')}>Réglages › Modules</a>).`;
