// @ts-check
// The look of a plant's sheet and of a block alone (sheet-base.js: what they share; the static styles of
// gf-plant-detail.js and gf-sheet-block.js): its name and photos, its rubrics and blocks, Wikipédia's themes, the
// charts (core/charts.js), Prudence, its panes and their grips (core/split-grip.js, last), « Personnaliser la fiche »
// and the action bar — in both themes, at every width.

import { css, unsafeCSS } from 'lit';
import { ui } from '../styles/ui.js';
import { severityStyles } from './ui-kit.js';
import { gripStyles } from '../core/split-grip.js';
import { chartStyles } from '../core/charts.js';

export const sheetStyles = [ui, severityStyles, css`
    :host {
      display: block;
      overflow-y: auto;
      /* No vertical padding: what is stuck (the rubrics) sticks to the very top, the action bar to the very bottom
         (the article keeps the space). */
      padding: 0 16px;
      /* A rubric's header, stuck while it is read (one line, whatever its text). */
      --rub-h: 30px;
    }
    article { padding: 16px 0 24px; }
    article { max-width: 920px; margin: 0 auto; }
    :host([embedded]) { padding: 0 14px; }
    :host([embedded]) article { padding-top: 4px; }
    :host([embedded]) :is(h1, h2.h1) { margin-top: 4px; }
    /* The name, an h1, or an h2 under a screen's own title that looks the same (not as a block's title). */
    :is(h1, h2.h1) { margin: 8px 0 0; font-size: 1.6rem; line-height: 1.2; font-weight: 700; text-transform: none; letter-spacing: normal; color: var(--gf-text); }
    .sci { font-family: var(--gf-font-serif); font-size: 1.2rem; }
    .sci i { font-style: italic; }
    .author { color: var(--gf-text-muted); font-size: 0.9em; }
    .tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; padding: 0; list-style: none; }
    .tags li {
      background: var(--gf-accent-soft);
      border-radius: var(--gf-radius-pill);
      padding: 2px 10px;
      font-size: 0.8rem;
    }
    section { margin-top: 24px; }
    /* Blocks below the header: a title (drag it to move the block) with its grip and trash / revive icon, then the content. */
    .blocks { display: flex; flex-direction: column; }
    .block { margin-top: 20px; border-radius: var(--gf-radius); transition: box-shadow 0.15s, background 0.15s, opacity 0.15s; }
    .block-title { display: flex; align-items: center; gap: 2px; margin: 0 0 8px; }
    /* Personalised: the title is a handle for the mouse; a finger drags by the grip ⠿ only (on the title it scrolls the
       sheet, #press). Its tools wrap under the name when the row is short. */
    .king .block-title { position: relative; flex-wrap: wrap; row-gap: 2px; margin-left: -6px; cursor: grab; user-select: none; -webkit-user-select: none; }
    .king .grip { touch-action: none; }
    /* Its rows are as narrow as the list (a sheet squeezed by its panes, a pane's column), not as the whole sheet. */
    .blocks.king, .edge.king .edge-body { container-type: inline-size; }
    /* « Déplacer vers… » hangs from the end of the title row: a picker wrapped to its start would push the menu out. */
    .king .block-title .place-pick { position: static; }
    .block-title .name { flex: 1; min-width: 0; }
    .king .block-title .name { min-width: min(11em, calc(100% - 52px)); }
    /* King: the block's category (what the data says about the plant). */
    .block-title .cat { flex: none; padding: 0 8px; border-radius: var(--gf-radius-pill); background: var(--gf-surface-2); color: var(--gf-text-muted); font-size: 0.66rem; font-weight: 600; text-transform: none; letter-spacing: 0; margin-right: 2px; }
    @container (max-width: 420px) { .block-title .cat { display: none; } }
    .off-note { flex: none; font-size: 0.7rem; text-transform: none; letter-spacing: 0; font-weight: 400; }
    .grip, .block-title .tool {
      flex: none;
      width: 26px;
      height: 26px;
      min-height: 0;
      padding: 0;
      display: grid;
      place-items: center;
      border: 0;
      border-radius: var(--gf-radius-sm);
      background: none;
      color: var(--gf-text-muted);
      font-size: 0.95rem;
      opacity: 0.6;
    }
    .grip { cursor: grab; }
    .block-title .tool { cursor: pointer; }
    .grip:hover, .grip:focus-visible, .block-title .tool:hover, .block-title .tool:focus-visible { opacity: 1; background: var(--gf-surface-2); color: var(--gf-text); }
    .grip:focus-visible, .block-title .tool:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    /* A safety block's padlock (no trash): touched, it says why, under the title. */
    .block-title .tool.lock { cursor: help; font-size: 0.85rem; }
    .lock-tip { margin: -4px 0 8px; font-size: 0.8rem; color: var(--gf-text-muted); }
    .lock-tip:empty { display: none; }
    /* The action bar: docked at the bottom of the sheet (above the tab bar on a phone), equal buttons. */
    .action-bar {
      position: sticky;
      bottom: 0;
      z-index: 6;
      margin: 0 -16px;
      padding: 6px 8px;
      background: var(--gf-surface);
      border-top: 1px solid var(--gf-border);
      box-shadow: 0 -4px 14px rgb(0 0 0 / 0.06);
    }
    :host([embedded]) .action-bar { margin: 0 -14px; }
    .action-bar .acts { display: flex; gap: 4px; max-width: 920px; margin: 0 auto; }
    .action-bar .act { position: relative; flex: 1; min-width: 0; display: flex; }
    .action-bar .act > button, .action-bar .act > a.button {
      flex: 1;
      min-width: 0;
      display: grid;
      justify-items: center;
      gap: 2px;
      padding: 6px 4px;
      min-height: 0;
      border: 0;
      border-radius: var(--gf-radius);
      background: none;
      color: var(--gf-text);
      font-size: 0.72rem;
      font-weight: 600;
      text-decoration: none;
      box-shadow: none;
    }
    .action-bar .act svg { font-size: 1.2rem; }
    .action-bar .act span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    .action-bar .act > button:hover, .action-bar .act > a.button:hover { background: var(--gf-surface-2); }
    .action-bar .fav[aria-pressed='true'] { color: var(--gf-fav); }
    .action-bar .share-note { position: absolute; left: 50%; bottom: calc(100% + 6px); transform: translateX(-50%); margin: 0; padding: 4px 10px; border-radius: var(--gf-radius-pill); background: var(--gf-text); color: var(--gf-surface); white-space: nowrap; }
    /* King: every action, each with its ☑ — the one target there, the action inert under it until « Terminé » (no two
       targets on top of each other: WCAG 2.5.8); an action hidden in this view is faded too. */
    .action-bar .act-toggle { position: absolute; top: 0; right: 2px; display: grid; place-items: center; width: 22px; height: 22px; cursor: pointer; }
    .action-bar .act-toggle input { margin: 0; width: 16px; height: 16px; }
    .action-bar .act.off > button, .action-bar .act.off > a.button { opacity: 0.4; text-decoration: line-through; pointer-events: none; }
    /* « Personnaliser la fiche »: the crown, last, an icon at a finger's size; gold while open. */
    .action-bar .act.crown { flex: none; width: 44px; }
    .action-bar .act.crown > button { min-height: 44px; place-content: center; color: var(--gf-text-muted); }
    .action-bar .act.crown > button[aria-pressed='true'] { color: var(--gf-crown); background: color-mix(in srgb, #f5c518 18%, var(--gf-surface)); }
    /* « Mise en page de la fiche »: the mode arranged and its tools, stuck at the top (above the panes when there are). */
    .king-bar { position: sticky; top: 0; z-index: 8; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin: 0 -16px; padding: 6px 16px;
      border-bottom: 2px solid #d4a017; background: color-mix(in srgb, #f5c518 10%, var(--gf-surface)); font-size: 0.85rem; }
    :host([embedded]) .king-bar { margin: 0 -14px; padding: 6px 14px; }
    :host([edged]) .king-bar { position: static; flex: none; margin: 0; }
    /* Stuck over a sheet without panes: a block reached, or read, is the one right below it (#offset), never beneath it. */
    :host(:not([edged])) .blocks.king > .block { scroll-margin-top: var(--kb-h, 0px); }
    .king-bar .kb-mode { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
    .king-bar .kb-mode > svg:first-child { color: #b8860b; font-size: 1.1rem; }
    .king-bar .kb-tools { display: inline-flex; flex-wrap: wrap; gap: 6px; margin-left: auto; }
    /* « Barre d’actions »: its list on a line of its own, scrolling when tall (the sheet stays in view). */
    .king-actions { flex: 1 1 100%; max-height: min(45vh, 360px); overflow-y: auto; overscroll-behavior: contain; padding: 6px 8px; border: 1px dashed var(--gf-border);
      border-radius: var(--gf-radius); background: var(--gf-surface); }
    .king-actions p { margin: 0 0 6px; color: var(--gf-text-muted); font-size: 0.8rem; }
    /* The name and the actions read without a title (King titles them, to move them like the others). */
    .block.headless { margin-top: 8px; }
    .block.headless:first-child { margin-top: 0; }
    .block[data-key='name'] :is(h1, h2.h1) { margin-top: 4px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    /* Other names: a quiet list, in italics. */
    .names-list, .names { margin: 0; font-style: italic; font-size: 0.88rem; color: var(--gf-text-muted); line-height: 1.5; }
    .names-list .sep, .names .sep { font-style: normal; opacity: 0.5; padding: 0 0.3em; }
    .block-title input.rename { flex: 1; min-width: 0; font: inherit; text-transform: none; letter-spacing: 0; padding: 2px 6px; border: 1px solid var(--gf-accent); border-radius: var(--gf-radius-sm); background: var(--gf-surface); color: var(--gf-text); }
    .block-title .tool[aria-expanded='true'], .block-title .tool[aria-pressed='true'] { opacity: 1; color: var(--gf-accent); }
    /* King: a title hidden when read is drawn struck and slanted (not faded: its contrast kept). */
    .block.untitled > .block-title .name { font-style: italic; text-decoration: line-through; }
    .block-title .styles { display: inline-flex; flex: none; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-pill); overflow: hidden; margin-right: 4px; }
    .block-title .styles button { min-height: 0; padding: 2px 8px; border: 0; border-radius: 0; background: var(--gf-surface); color: var(--gf-text-muted); font-size: 0.7rem; text-transform: none; letter-spacing: 0; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
    .block-title .styles button[aria-pressed='true'] { background: var(--gf-accent-soft); color: var(--gf-accent); }
    .block-title .styles button:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .map-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin: 0 0 10px; padding: 10px; border: 1px dashed var(--gf-border); border-radius: var(--gf-radius); background: var(--gf-surface); font-size: 0.85rem; }
    .map-form fieldset { border: 0; margin: 0; padding: 0; display: grid; gap: 6px; align-content: start; }
    .map-form legend { font-weight: 700; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--gf-text-muted); padding: 0; margin-bottom: 2px; }
    .map-form label { display: grid; gap: 2px; }
    .map-form label.check { display: flex; gap: 6px; align-items: center; }
    .map-form .look-note { grid-column: 1 / -1; margin: 0; color: var(--gf-text-muted); }
    .map-placeholder { border-radius: var(--gf-radius); background: var(--gf-surface-2); }
    .subs-editor { margin: 0 0 10px 20px; padding: 8px 10px; border: 1px dashed var(--gf-border); border-radius: var(--gf-radius); background: var(--gf-surface); }
    .note-text { width: 100%; font: inherit; padding: 8px 10px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius); background: var(--gf-surface); color: var(--gf-text); resize: vertical; }
    .note-text:focus-visible { outline: none; border-color: var(--gf-accent); box-shadow: var(--gf-focus); }
    .new-note { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0 0; }
    .new-note input { flex: 1; min-width: 160px; }
    /* Folded away: the title only, faded; ↺ brings it back. */
    .block.off { opacity: 0.45; }
    .block.off .block-title { margin-bottom: 0; }
    .block.off:hover, .block.off:focus-within { opacity: 0.8; }
    /* While dragging: every block shows its title only; the dragged one floats under the pointer. */
    .blocks.sorting .content { display: none; }
    .blocks.sorting .block { margin-top: 6px; padding: 4px 8px; background: var(--gf-surface); border: 1px dashed var(--gf-border); }
    .blocks.sorting .block-title { margin: 0; }
    .block.dragging { position: relative; z-index: 2; opacity: 1; background: var(--gf-surface); box-shadow: var(--gf-shadow-float); outline: 2px solid var(--gf-accent); border-style: solid; transition: none; }
    .block.dragging .block-title, .block.dragging .grip { cursor: grabbing; }
    .block.dragging .grip { opacity: 1; color: var(--gf-accent); }
    /* A part with nothing for this plant hides itself; the block then says so. */
    .content .if-empty { display: none; }
    /* Left out when empty: a block whose component found nothing for this plant. */
    .block.hide-empty:has(> .content > [hidden]:not([loading])) { display: none; }
    .content > [hidden]:not([loading]) ~ .if-empty { display: block; }
    @media (prefers-reduced-motion: reduce) { .block { transition: none; } }
    h2 {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--gf-text-muted);
      font-weight: 600;
      margin: 0 0 8px;
    }
    .gallery {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: var(--gf-gap);
    }
    figure {
      margin: 0;
      background: var(--gf-surface);
      border-radius: var(--gf-radius);
      overflow: hidden;
      box-shadow: var(--gf-shadow);
    }
    figure img {
      display: block;
      width: 100%;
      aspect-ratio: 1;
      object-fit: cover;
      background: var(--gf-surface-2);
    }
    figcaption { padding: 6px 8px; }
    p { margin: 0 0 12px; }
    .actions { margin: 12px 0 4px; }
    .actions .fav { min-height: var(--gf-control-h); padding: 8px 16px; font-size: 0.9rem; }
    .actions .fav[aria-pressed='true'] { color: var(--gf-fav); border-color: var(--gf-fav); background: color-mix(in srgb, var(--gf-fav) 10%, var(--gf-surface)); }
    .share-note { color: var(--gf-text-muted); font-size: 0.85rem; margin: 4px 0 0; }
    .description { background: var(--gf-surface); border-radius: var(--gf-radius); padding: 12px 14px; margin-bottom: 8px; }
    .description small { display: block; color: var(--gf-text-muted); margin-bottom: 4px; }
    ul.inline { padding: 0; margin: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 6px 14px; }
    .links a {
      display: inline-block;
      color: var(--gf-accent);
      border: 1px solid var(--gf-border);
      border-radius: var(--gf-radius-pill);
      padding: 4px 12px;
      text-decoration: none;
      background: var(--gf-surface);
    }
    .links a:hover { background: var(--gf-surface-2); }
    .skeleton {
      height: 180px;
      border-radius: var(--gf-radius);
      background: linear-gradient(90deg, var(--gf-surface-2), var(--gf-surface), var(--gf-surface-2));
      background-size: 200% 100%;
      animation: pulse 1.4s ease-in-out infinite;
    }
    @keyframes pulse { from { background-position: 100% 0; } to { background-position: -100% 0; } }

    /* Épuré: big photo, the essentials, one-tap add to the current collection. */
    .epure { max-width: 560px; }
    .hero { margin: 4px 0 12px; border-radius: var(--gf-radius-lg); overflow: hidden; background: var(--gf-surface-2); box-shadow: var(--gf-shadow); }
    .hero img, .hero .skeleton, .hero .no-photo { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; height: auto; border-radius: 0; }
    .hero .no-photo { display: grid; place-items: center; font-size: 3rem; }
    .hero figcaption { padding: 4px 10px; }
    .hero a, .gallery a { cursor: zoom-in; }
    .all-media { display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; }
    dialog.pane { width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; display: flex; flex-direction: column; background: var(--gf-surface); }
    dialog.pane:not([open]) { display: none; }
    dialog.pane gf-sheet-block { flex: 1; min-height: 0; }
    .pane-bar { display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 14px; border-bottom: 1px solid var(--gf-border); }
    .pane-bar h2 { flex: 1; margin: 0; font-size: 1rem; }
    /* ⤢: a block in the pane beside the sheet. */
    .block { position: relative; }
    .to-pane { width: 30px; height: 30px; min-height: 0; font-size: 0.85rem; flex: none; opacity: 0; transition: opacity 0.15s; color: var(--gf-text-muted); }
    .block > .to-pane { position: absolute; top: 0; right: 0; z-index: 2; }
    .block:hover .to-pane, .to-pane:focus-visible { opacity: 1; }
    @media (hover: none) { .block-title .to-pane { opacity: 0.6; } }
    .in-pane { display: flex; align-items: center; gap: 6px; font-size: 0.9rem; }
    .paned { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 4px 0 10px; font-size: 0.85rem; color: var(--gf-text-muted); }
    .paned button { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--gf-border); background: var(--gf-surface); border-radius: var(--gf-radius-pill); padding: 3px 10px; font: inherit; color: var(--gf-text); cursor: pointer; }
    .paned button:hover { border-color: var(--gf-accent); }
    .epure :is(h1, h2.h1) { font-size: 1.8rem; }
    .meta { color: var(--gf-text-muted); margin: 6px 0 10px; }
    .more { margin-top: 18px; }

    /* Standard: collections as one discreet line. */
    .mine { display: flex; align-items: center; gap: 10px; font-size: 0.9rem; color: var(--gf-text-muted); margin: 4px 0; }

    /* Scientifique: facts as label / value rows, tables, sources. */
    h3 { font-size: 0.85rem; margin: 14px 0 6px; }
    .facts { display: grid; grid-template-columns: minmax(120px, max-content) 1fr; gap: 6px 14px; margin: 0; font-size: 0.9rem; }
    .facts dt { color: var(--gf-text-muted); }
    .facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .facts .lang { font-style: normal; font-size: 0.75rem; font-weight: 700; color: var(--gf-text-muted); text-transform: uppercase; }
    .statuses { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-top: 10px; }
    .statuses th, .statuses td { text-align: left; padding: 5px 8px 5px 0; border-bottom: 1px solid var(--gf-border); vertical-align: top; }
    .statuses th { color: var(--gf-text-muted); font-weight: 600; }
    .science p.muted { font-size: 0.9rem; }
    .credit { font-size: 0.75rem; color: var(--gf-text-muted); margin: 8px 0 0; }
    /* GBIF charts: one bar per month or year (no library). */
    .bars { display: flex; align-items: flex-end; gap: 3px; height: 84px; margin: 4px 0 0; }
    .bars .bar { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; }
    .bars .bar i { display: block; width: 100%; min-height: 1px; background: var(--gf-accent); border-radius: 3px 3px 0 0; opacity: 0.85; }
    .bars.months { height: 100px; }
    .bars.months .bar b { font-size: 0.65rem; font-weight: 600; color: var(--gf-text-muted); line-height: 1.4; }
    .bars.years { gap: 1px; height: 64px; }
    .axis { display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--gf-text-muted); }
    .small { font-size: 0.8rem; }
    .counts { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 0.9rem; }
    .counts li { display: grid; grid-template-columns: 1fr auto 3.6em; gap: 10px; align-items: baseline; }
    .counts li > :first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .counts b { font-variant-numeric: tabular-nums; font-weight: 600; }
    .counts small { color: var(--gf-text-muted); text-align: right; font-variant-numeric: tabular-nums; }
    .near { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; font-size: 0.88rem; }
    .near li { display: grid; grid-template-columns: 4.5em 1fr auto; gap: 10px; align-items: baseline; }
    .near li span { color: var(--gf-text-muted); min-width: 0; overflow-wrap: anywhere; }
    .papers { margin: 0; padding-left: 18px; display: grid; gap: 8px; font-size: 0.9rem; }
    .papers small { display: block; color: var(--gf-text-muted); }
    /* Herbarium sheets are tall: shown whole, not cropped. */
    .gallery.herbarium img { aspect-ratio: 3 / 4; object-fit: contain; background: #f4f1ea; }
    .specimen { display: block; font-size: 0.75rem; font-weight: 600; margin-bottom: 2px; }
    .credit a { color: inherit; }
    .credit.error { color: var(--gf-danger); }
    .wiki p.credit { margin-top: 6px; }
    /* The Wikipédia summary reads like the other blocks: flush left, no card (its source line names it). */
    .description.wiki { background: none; padding: 0; border-radius: 0; }
    .description.wiki p { margin: 0 0 8px; }
    .wiki-desc { font-style: italic; color: var(--gf-text-muted); }
    /* The article's menu: in the block's header, stuck at the top of the sheet while reading it. */
    .wiki-menu { display: flex; gap: 4px; align-items: center; overflow-x: auto; scrollbar-width: none; margin: 0 -4px 10px; padding: 6px 4px;
      background: color-mix(in srgb, var(--gf-surface) 94%, transparent); backdrop-filter: blur(6px); border-bottom: 1px solid var(--gf-border);
      mask-image: linear-gradient(90deg, #000 calc(100% - 16px), transparent); }
    .wiki-menu::-webkit-scrollbar { display: none; }
    .wiki-logo { flex: none; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%; border: 1px solid var(--gf-border); font-size: 0.85rem; color: var(--gf-text-muted); }
    .wiki-menu a { flex: none; padding: 4px 10px; border-radius: var(--gf-radius-pill); font-size: 0.8rem; color: var(--gf-text-muted); text-decoration: none; white-space: nowrap; }
    .wiki-menu a:hover { color: var(--gf-text); background: var(--gf-surface-2); }
    .wiki-menu a:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .wiki-theme { border-top: 1px solid var(--gf-border); }
    .wiki-theme > summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; padding: 10px 0; cursor: pointer; font-weight: 600; list-style: none; }
    .wiki-theme > summary::-webkit-details-marker { display: none; }
    .wiki-theme > summary::before { content: '›'; display: inline-block; transition: transform 0.15s; color: var(--gf-text-muted); }
    .wiki-theme[open] > summary::before { transform: rotate(90deg); }
    .wiki-theme > summary small { font-weight: 400; color: var(--gf-text-muted); font-size: 0.75rem; }
    .wiki-theme > summary .also { margin-left: auto; font-size: 0.75rem; font-weight: 400; }
    .wiki-theme[data-flash] { animation: flash 1.2s ease-out; }
    .wiki-in { padding: 0 0 10px 14px; }
    /* Wikipédia's words, under a block's own data. */
    .wiki-bits { margin-top: 12px; padding: 10px 12px; border-left: 3px solid color-mix(in srgb, var(--gf-accent) 40%, transparent); background: color-mix(in srgb, var(--gf-surface) 70%, transparent); border-radius: 0 var(--gf-radius-sm) var(--gf-radius-sm) 0; }
    .wiki-x h3 { margin: 0 0 4px; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--gf-text-muted); }
    .wiki-x p { margin: 0 0 6px; font-size: 0.92rem; line-height: 1.5; }
    .wiki-x + .wiki-x { margin-top: 10px; }
    ${unsafeCSS(chartStyles)}
    /* The Prudence: the box of the verdict's level (ui-kit.js .sev-box). */
    .prudence { margin-bottom: 10px; }
    .prudence .verdict { margin: 0 0 6px; }
    .prudence ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .prudence li { display: flex; gap: 8px; align-items: baseline; font-size: 0.9rem; line-height: 1.35; }
    /* Each reason's sign in its level's colour — data-level, not a class: .danger is the shared stylesheet's destructive
       look (styles/ui.js); « à savoir » has none (severityGlyph), its words in line with the others'. */
    .prudence li svg { flex: none; }
    .prudence li[data-level='warn'] svg { color: var(--gf-warn); }
    .prudence li[data-level='danger'] svg { color: var(--gf-danger); }
    .prudence li[data-level='deadly'] svg { color: var(--gf-deadly); }
    .prudence li[data-level='info'] { padding-left: calc(1em + 8px); }
    .prudence p { margin: 8px 0 0; }
    .prudence .sos a { color: inherit; }
    .prudence li button.link { min-height: 0; padding: 0 4px; font-size: inherit; }
    .no-tox { margin: 0 0 10px; padding: 6px 10px; border-left: 3px solid var(--gf-text-muted); color: var(--gf-text-muted); }
    .src { font-size: 0.72rem; color: var(--gf-text-muted); white-space: nowrap; }
    .src::before { content: '— '; }
    ul.recipes { margin: 4px 0 0; padding-left: 18px; font-size: 0.9rem; display: grid; gap: 3px; }
    .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin: 0 5px 0 2px; vertical-align: 0; }
    .partner em, .partners em { font-family: var(--gf-font-serif); }
    .pollen .level { display: inline-block; padding: 1px 10px; border-radius: var(--gf-radius-pill); font-weight: 700; font-size: 0.85rem; background: var(--gf-surface-2); }
    .pollen .level.l1 { background: #e8f5e9; color: #2e7d32; } .pollen .level.l2 { background: #fff8e1; color: #b26a00; }
    .pollen .level.l3 { background: #ffe0b2; color: #c43e00; } .pollen .level.l4 { background: #ffcdd2; color: #b71c1c; }
    details.here-climate summary { cursor: pointer; font-size: 0.85rem; font-weight: 600; margin: 6px 0; }
    /* Tabular data (style « Tableau », the default; « Liste » keeps the compact rows). */
    table.data { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin: 2px 0 6px; }
    table.data th, table.data td { text-align: left; padding: 5px 8px 5px 0; border-bottom: 1px solid var(--gf-border); vertical-align: baseline; }
    table.data thead th { color: var(--gf-text-muted); font-weight: 600; font-size: 0.75rem; }
    table.data tbody th { color: var(--gf-text-muted); font-weight: 600; width: 40%; }
    table.data .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    table.data.counts-table td:first-child { max-width: 0; width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    table.data .pct { width: 7.5em; }
    .meter { display: inline-block; width: 3em; height: 6px; margin-right: 6px; border-radius: 3px; background: var(--gf-surface-2); overflow: hidden; vertical-align: middle; }
    .meter i { display: block; height: 100%; background: var(--gf-accent); opacity: 0.8; }
    table.data td > button.focusable, table.data td .with-link > button.focusable { margin: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
    table.data .with-link { display: flex; gap: 6px; min-width: 0; align-items: baseline; }
    table.data .ext { flex: none; text-decoration: none; }
    h4 { font-size: 0.78rem; margin: 10px 0 2px; color: var(--gf-text-muted); font-weight: 600; }
    ul.plain { margin: 0; padding-left: 18px; display: grid; gap: 4px; font-size: 0.9rem; }

    /* A value that shows on the sheet's maps when touched (the sheet has a map): dotted underline, highlighted while shown. */
    button.focusable {
      display: inline; min-height: 0; padding: 0 3px; margin: 0 -3px; border: 0; border-radius: 4px; background: none; box-shadow: none;
      color: inherit; font: inherit; font-weight: inherit; text-align: inherit; cursor: pointer;
      text-decoration: underline dotted color-mix(in srgb, var(--gf-accent) 70%, transparent); text-underline-offset: 3px;
    }
    button.focusable:hover { color: var(--gf-accent); }
    button.focusable[aria-pressed='true'] { background: color-mix(in srgb, #f59e0b 28%, transparent); text-decoration: none; }
    button.focusable:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .counts li > button.focusable { display: block; margin: 0; padding: 0 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .counts .with-link { display: flex; gap: 6px; min-width: 0; align-items: baseline; }
    .counts .with-link > button.focusable { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .counts .ext { flex: none; text-decoration: none; }
    .bars button.bar { padding: 0; margin: 0; border: 0; border-radius: 3px 3px 0 0; background: none; text-decoration: none; }
    .bars button.bar:hover i { opacity: 1; background: color-mix(in srgb, var(--gf-accent) 80%, #000); }
    .bars button.bar[aria-pressed='true'] { background: none; }
    .bars button.bar[aria-pressed='true'] i { background: #f59e0b; opacity: 1; }
    .bars button.bar[aria-pressed='true'] b { color: #b45309; }
    figcaption button.where { display: flex; gap: 4px; align-items: center; margin: 0 0 4px; font-size: 0.72rem; color: var(--gf-text-muted); text-align: left; }
    .focus-hint { font-size: 0.75rem; color: var(--gf-text-muted); margin: 6px 0 0; }

    /*
     * The plant pane's tree of panes (King: « Déplacer vers… », a drag): panes on the top, left, right or bottom
     * of the sheet, which scrolls between them. Bands S / M / L high (or dragged), columns S / M / L wide.
     */
    :host { container-type: inline-size; }
    :host([edged]) { overflow: hidden; display: flex; flex-direction: column; padding: 0; }
    .frame.edged { position: relative; flex: 1; min-height: 0; display: flex; }
    :host([edged]) > .frame.edged { height: 100%; }
    /* The tree: splits in rows and columns, each child its share (flex), a grip between two. */
    .split { flex: 1; min-width: 0; min-height: 0; display: flex; }
    .split.row { flex-direction: row; } .split.col { flex-direction: column; }
    .cell { display: flex; min-width: 0; min-height: 0; }
    /* The media's pane keeps the room its viewer needs (its image, zoom bar and thumbnails never overlap). */
    .split.col > .cell:not(.folded):has(gf-media-viewer:not([compact])) { min-height: 400px; }
    .split.row > .cell:not(.folded):has(gf-media-viewer:not([compact])) { min-width: 280px; }
    .cell > * { flex: 1; min-width: 0; min-height: 0; }
    .cell.folded { flex: 0 0 auto !important; }
    /* The grips between them: core/split-grip.js (gripStyles, at the end of the styles). */
    .frame.edged .main { flex: 1; min-width: 0; min-height: 0; overflow-y: auto; padding: 0 16px; }
    :host([embedded]) .frame.edged .main { padding: 0 14px; }
    /* Narrow: the panes as bands above and under the sheet, sharing the height left to it. */
    .frame.edged.narrow { flex-direction: column; }
    /* (Personalising, the bar « Mise en page de la fiche » above the frame takes its share first: --kb-h.) */
    .band-cell { flex: none; height: min(calc((var(--host-h, 80vh) - var(--kb-h, 0px)) * 0.45), calc((var(--host-h, 80vh) - var(--kb-h, 0px) - 220px) / var(--bands, 1)));
      border-bottom: 1px solid var(--gf-border); }
    .band-cell.folded { height: auto; }
    /* A narrow sheet: the media's band too keeps the room its viewer needs. */
    .band-cell:not(.folded):has(gf-media-viewer:not([compact])) { min-height: 400px; }
    .panes-only .band-cell.grow { flex: 1 0 300px; height: auto; }
    .frame.edged.narrow.panes-only { overflow-y: auto; }
    /* Panes only (Découvrir): the tree left without its sheet fills the whole frame — one pane alone too. */
    .frame.edged.panes-only:not(.narrow) > * { flex: 1 1 0; min-width: 0; }
    .edge { position: relative; z-index: 7; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--gf-bg); }
    /* Over the whole plant pane for a while (the frame holds it: the cells are not positioned). */
    .edge.max { position: absolute; inset: 0; z-index: 30; box-shadow: var(--gf-shadow-float); }
    .edge-bar { flex: none; display: flex; align-items: center; gap: 4px; min-height: 36px; padding: 2px 6px 2px 8px; color: var(--gf-text-muted); font-size: 0.75rem; }
    /* The media's controls in its header (type, part, count): what the viewer's own line held. */
    .media-ctl { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: 6px; overflow-x: auto; scrollbar-width: none; color: var(--gf-text); }
    .media-ctl:empty { display: none; }
    .media-ctl::-webkit-scrollbar { display: none; }
    .media-ctl select { font: inherit; font-size: 0.78rem; padding: 2px 4px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-sm); background: var(--gf-surface); color: var(--gf-text); max-width: 150px; min-height: 0; height: 28px; }
    .media-ctl .count { color: var(--gf-text-muted); font-variant-numeric: tabular-nums; font-size: 0.78rem; white-space: nowrap; }
    .media-ctl .parts { flex: none; display: flex; gap: 1px; padding: 2px; border-radius: var(--gf-radius-pill); background: var(--gf-surface-2); }
    .media-ctl .parts button { width: 26px; height: 24px; min-height: 0; padding: 0; border: 0; border-radius: var(--gf-radius-pill); background: none; color: var(--gf-text-muted); display: grid; place-items: center; cursor: pointer; font-size: 0.8rem; }
    .media-ctl .parts button[aria-checked='true'] { background: var(--gf-surface); color: var(--gf-accent); box-shadow: 0 1px 3px rgb(0 0 0 / 15%); }
    .media-ctl .parts button:disabled { opacity: 0.3; cursor: default; }
    .media-ctl .icon-btn { width: 28px; height: 28px; min-height: 0; }
    .media-ctl .back-mosaic { white-space: nowrap; font-size: 0.78rem; }
    .edge-bar:has(.media-ctl:not(:empty)) .edge-tabs .tab-name { display: none; }
    .edge-tabs { flex: 1; min-width: 0; display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; }
    .edge-tabs::-webkit-scrollbar { display: none; }
    .edge-tabs button { display: inline-flex; align-items: center; gap: 5px; min-height: 28px; padding: 2px 8px; border: 0; border-radius: var(--gf-radius-sm); background: none;
      color: var(--gf-text-muted); font: inherit; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; cursor: pointer; }
    .edge-tabs button[aria-selected='true'] { background: var(--gf-surface); color: var(--gf-accent); box-shadow: var(--gf-shadow); }
    .edge-tabs:has(button:only-child) button { background: none; box-shadow: none; cursor: default; }
    .edge-sizes { display: inline-flex; flex: none; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-pill); overflow: hidden; }
    .edge-sizes button { min-height: 0; padding: 2px 8px; border: 0; border-radius: 0; background: var(--gf-surface); color: var(--gf-text-muted); font-size: 0.68rem; font-weight: 700; cursor: pointer; }
    .edge-sizes button[aria-pressed='true'] { background: var(--gf-accent-soft); color: var(--gf-accent); }
    .edge-btn { flex: none; width: 30px; height: 30px; min-height: 0; padding: 0; display: grid; place-items: center; border: 0; border-radius: var(--gf-radius-sm); background: none;
      color: var(--gf-text-muted); cursor: pointer; list-style: none; }
    .edge-btn::-webkit-details-marker { display: none; }
    .edge-btn:hover { background: var(--gf-surface); color: var(--gf-text); }
    .edge-sizes button:focus-visible, .edge-btn:focus-visible, .edge-tabs button:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .edge-opts { position: relative; flex: none; }
    .opts-pop { position: absolute; right: 0; top: 100%; z-index: 40; display: grid; gap: 6px; min-width: 230px; padding: 10px 12px; background: var(--gf-surface);
      border: 1px solid var(--gf-border); border-radius: var(--gf-radius); box-shadow: var(--gf-shadow-float); color: var(--gf-text); font-size: 0.85rem; text-transform: none; letter-spacing: 0; font-weight: 400; }
    .opts-pop label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    .edge-body { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; padding: 4px 12px 10px; overscroll-behavior: contain; }
    .edge.bare .edge-body { padding: 0; }
    .edge.bare .edge-body > .block { margin: 0; }
    /* The bar names the edge's blocks: no second title (King shows the block's tools). */
    .edge:not(.king) .edge-body > .block > h2.block-title, .edge:not(.king) .edge-body > .block > .to-pane { display: none; }
    .edge-body > .block { margin-top: 0; }
    .edge-body > .block.map-block, .edge-body > .block[data-key='media'] { flex: 1 0 200px; display: flex; flex-direction: column; min-height: 0; }
    .edge-body > .block.map-block > .content, .edge-body > .block[data-key='media'] > .content { flex: 1; display: flex; flex-direction: column; min-height: 0; }
    .edge-body .map-placeholder.fill { flex: 1; height: auto !important; }
    .edge-body gf-media-viewer { flex: 1; min-height: 0; }
    .edge-body > .block[data-key='web'] { flex: 1 0 260px; display: flex; flex-direction: column; min-height: 0; }
    .edge-body > .block[data-key='web'] > .content { flex: 1; display: flex; flex-direction: column; min-height: 0; }
    .edge-body:has(> .block[data-key='web']) { padding: 0; }
    gf-sheet-map[fill] { flex: 1; min-height: 0; }
    /* Folded: its bar only (a column: a strip of its blocks' icons). */
    .edge.col.folded { width: 44px; }
    .edge.col.folded .edge-bar { flex-direction: column; padding: 6px 4px; gap: 6px; }
    .edge.col.folded .edge-tabs { flex-direction: column; overflow: visible; }
    .edge.col.folded .tab-name { display: none; }
    .edge.col .edge-tabs .tab-name { overflow: hidden; text-overflow: ellipsis; }
    /* Personalising: a folded pane drawn open, its bar saying so. */
    .edge-bar .fold-note { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.7rem; color: var(--gf-text-muted); }
    /* Without title or frame: the block fills the edge; its tabs and « agrandir » float over it. */
    .edge-float { position: absolute; top: 6px; left: 6px; z-index: 3; display: flex; gap: 4px; padding: 2px; border-radius: var(--gf-radius-sm); background: color-mix(in srgb, var(--gf-surface) 85%, transparent); box-shadow: var(--gf-shadow); }
    .edge-float .tab-name { display: none; }
    /* King: « Déplacer vers… » a block — the sheet, a new pane on a side, a tab of a pane. */
    .place-pick { position: relative; flex: none; }
    .place-pick > summary { list-style: none; display: inline-grid; place-items: center; cursor: pointer; }
    .place-pick > summary::-webkit-details-marker { display: none; }
    .move-menu { position: absolute; right: 0; top: 100%; z-index: 40; display: grid; min-width: 230px; padding: 6px; background: var(--gf-surface); border: 1px solid var(--gf-border);
      border-radius: var(--gf-radius); box-shadow: var(--gf-shadow-float); text-transform: none; letter-spacing: 0; font-weight: 400; }
    .move-menu button { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 32px; padding: 4px 8px; border: 0; border-radius: var(--gf-radius-sm); background: none;
      color: var(--gf-text); font: inherit; font-size: 0.85rem; text-align: left; cursor: pointer; }
    .move-menu button:hover:not(:disabled), .move-menu button:focus-visible { background: var(--gf-accent-soft); outline: none; }
    .move-menu button:disabled { opacity: 0.45; cursor: default; }
    /* King: the blocks to add, as chips to drag. */
    .palette { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0 0 10px; padding: 8px 10px; border: 1px dashed var(--gf-border); border-radius: var(--gf-radius); }
    .palette .pal-title { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--gf-text-muted); display: inline-flex; gap: 4px; align-items: center; }
    .palette .chip { display: inline-flex; gap: 5px; align-items: center; min-height: 28px; padding: 2px 10px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-pill);
      background: var(--gf-surface); font: inherit; font-size: 0.8rem; cursor: grab; touch-action: none; }
    .palette .chip.new { border-style: dashed; color: var(--gf-accent); }
    :host([docking]) { user-select: none; -webkit-user-select: none; }
    :host([docking]) .block-title, :host([docking]) .edge-tabs button { cursor: grabbing; }
    /*
     * The rubrics, like the filters' facets: the blocks gathered by rubric, each rubric under its header, stuck
     * while the rubric is read. « full » (room enough): the wrapper has no box, so every header sticks along the
     * whole list — those passed stacked at the top, those to come waiting stacked at the bottom, above the action
     * bar. « push »: the rubric is a box, its header alone at the top, pushed away by the next one's. Under the
     * headers: the block read's title (level 1), then the article's theme read (level 2). Where the reading is, is
     * drawn by the browser alone: nothing is computed while scrolling.
     */
    .rubric { display: contents; --lvl1: calc((var(--stack, 0) + 1) * var(--rub-h)); }
    :host(:not([stack='full'])) .rubric { display: block; --lvl1: var(--rub-h); }
    .rub-mark { display: block; height: 0; scroll-margin-top: calc(var(--stack, 0) * var(--rub-h)); }
    :host(:not([stack='full'])) .rub-mark { scroll-margin-top: 0; }
    .rub-head { position: sticky; z-index: 5; top: 0; box-sizing: border-box; height: var(--rub-h); margin: 0 -6px; padding: 0 2px 0 6px;
      display: flex; align-items: center; gap: 2px; background: var(--gf-surface); border-bottom: 1px solid var(--gf-border);
      font-size: 0.82rem; font-weight: 600; letter-spacing: 0; text-transform: none; }
    :host([stack='full']) .rub-head { top: calc(var(--stack, 0) * var(--rub-h)); bottom: calc((var(--count, 1) - var(--stack, 0) - 1) * var(--rub-h) + var(--bar-h, 0px));
      box-shadow: 0 -1px 0 var(--gf-border); }
    .rubric:first-of-type > .rub-mark { margin-top: 14px; }
    .rub-go { flex: 1; min-width: 0; height: 100%; min-height: 0; display: flex; align-items: center; justify-content: flex-start; gap: 8px; padding: 0; border: 0; border-radius: 0; background: none; color: var(--gf-text);
      font: inherit; text-align: left; cursor: pointer; }
    .rub-go:focus-visible, .rub-toc:focus-visible { outline: none; box-shadow: var(--gf-focus); border-radius: var(--gf-radius-sm); }
    .rub-ic { flex: none; display: grid; place-items: center; width: 22px; color: var(--gf-accent); font-size: 0.95rem; }
    .rub-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rub-badge { flex: none; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: var(--gf-radius-pill); display: inline-grid; place-items: center;
      font-size: 0.7rem; font-weight: 700; color: #fff; background: var(--gf-warn); }
    .rub-badge.danger { background: var(--gf-danger); }
    .rub-badge.deadly { background: var(--gf-deadly); color: var(--gf-deadly-contrast); }
    .rub-badge.info { background: var(--gf-text-muted); }
    @media (prefers-color-scheme: dark) { .rub-badge { color: #1d1405; } }
    .rub-toc { flex: none; width: 28px; height: 28px; min-height: 0; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; background: none; color: var(--gf-text-muted); cursor: pointer; }
    .rub-toc:hover, .rub-go:hover .rub-label { color: var(--gf-text); }
    .rub-head[data-flash] { animation: rub-flash 1.2s ease-out; }
    @keyframes rub-flash { from { background: var(--gf-accent-soft); } }
    .rub-note { margin: 8px 0 4px; font-size: 0.82rem; color: var(--gf-text-muted); }
    .rubric > .block { scroll-margin-top: var(--lvl1); }
    .rubric > .block > .block-title { position: sticky; top: var(--lvl1); z-index: 4; background: var(--gf-surface); margin: 0 -6px 8px; padding: 4px 6px; box-shadow: 0 1px 0 var(--gf-border); }
    .rubric > .block > .wiki-theme, .rubric .wiki-theme { scroll-margin-top: var(--lvl1); }
    .rubric .wiki-theme[open] > summary { position: sticky; top: var(--lvl1); z-index: 3; background: var(--gf-surface); box-shadow: 0 1px 0 var(--gf-border); }
    .rubric > .block:not(.headless) .wiki-theme { scroll-margin-top: calc(var(--lvl1) + var(--title-h, 38px)); }
    .rubric > .block:not(.headless) .wiki-theme[open] > summary { top: calc(var(--lvl1) + var(--title-h, 38px)); }
    /* Room after the last rubric: it too comes right under the rubrics stuck above it. */
    .blocks.rubrics { --room-stack: var(--rub-h); --room-gap: 160px; }
    :host([stack='full']) .blocks.rubrics { --room-stack: calc(var(--count, 1) * var(--rub-h)); --room-gap: 120px; }
    :host(:not([edged])) .blocks.rubrics::after, .frame.edged .main[data-drop-node='sheet'] .blocks.rubrics::after { content: ''; display: block; flex: none;
      height: max(0px, calc(var(--sheet-h, 100vh) - var(--room-stack) - var(--bar-h, 0px) - var(--room-gap))); }
    /* King: the plain list — any block can come under the top (room after the last one). */
    .frame.edged .main[data-drop-node='sheet']:has(.blocks.king)::after { content: ''; display: block; height: max(0px, calc(100% - 160px)); }
    /* The table of contents: over everything (the top layer), under the header touched. */
    .toc { position: fixed; inset: auto; margin: 0; width: min(300px, calc(100vw - 16px)); max-height: min(70vh, 560px); overflow-y: auto; padding: 8px; box-sizing: border-box;
      border: 1px solid var(--gf-border); border-radius: var(--gf-radius); background: var(--gf-surface); color: var(--gf-text); box-shadow: var(--gf-shadow-float); }
    .toc { display: none; }
    .toc[data-open] { display: block; }
    .toc:popover-open { display: block; }
    .toc:focus { outline: none; }
    .toc-head { display: flex; align-items: center; gap: 8px; padding: 2px 4px 6px; border-bottom: 1px solid var(--gf-border); margin-bottom: 4px;
      position: sticky; top: -8px; z-index: 1; background: var(--gf-surface); }
    .toc { overscroll-behavior: contain; }
    .blocks .block[tabindex='-1']:focus { outline: none; }
    .toc-head b { flex: 1; }
    .toc-head .entity { font-size: 0.7rem; font-weight: 600; padding: 1px 8px; border-radius: var(--gf-radius-pill); background: var(--gf-surface-2); color: var(--gf-text-muted); }
    .toc-lock[aria-pressed='true'] { color: var(--gf-accent); }
    .toc ul { list-style: none; margin: 0; padding: 0; }
    .toc ul ul { padding-left: 30px; }
    .toc ul ul.subs { padding-left: 14px; }
    .toc button { display: flex; align-items: center; justify-content: flex-start; gap: 8px; width: 100%; min-height: 32px; padding: 4px 6px; border: 0; border-radius: var(--gf-radius-sm); background: none;
      color: var(--gf-text); font: inherit; font-size: 0.86rem; text-align: left; cursor: pointer; }
    .toc button:hover, .toc button:focus-visible { background: var(--gf-surface-2); outline: none; }
    .toc .toc-rub { font-weight: 600; }
    .toc .toc-rub .bi { color: var(--gf-accent); }
    .toc .toc-rub span:not(.rub-badge) { flex: 1; }
    .toc ul ul button { color: var(--gf-text-muted); font-size: 0.82rem; min-height: 28px; }
    .toc button[aria-current] { background: var(--gf-accent-soft); color: var(--gf-text); }
    .block[data-flash] { animation: flash 1.2s ease-out; }
    @keyframes flash { from { box-shadow: 0 0 0 3px var(--gf-accent); } to { box-shadow: 0 0 0 3px transparent; } }
    @media (prefers-reduced-motion: reduce) { .skeleton { animation: none; } .block[data-flash], .rub-head[data-flash] { animation: none; } }
    /* Personalising a narrow list (a phone, a sheet squeezed by its panes, a pane): the grip and the name on the first
       line, the tools under; « Déplacer vers… » across the title row. */
    @container (max-width: 420px) {
      .king .block-title :is(.name, input.rename) { flex: 1 0 calc(100% - 52px); }
      .king .block-title .off-note { flex: 1 1 100%; }
      .king .block-title .move-menu { left: 0; right: 0; min-width: 0; }
    }
    /* A finger: every target of the personalised sheet at 44 px (last: over the sizes above). */
    @media (pointer: coarse) {
      .grip, .block-title .tool, .place-pick > summary { width: 44px; height: 44px; }
      .block-title .styles button { min-height: 44px; }
      .action-bar .act-toggle { width: 44px; height: 44px; top: 0; right: 0; }
      .king-bar button, .palette .chip, .move-menu button { min-height: 44px; }
    }
  `, gripStyles];
