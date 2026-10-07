// @ts-check
// Shared UI styles for every component's shadow root: buttons, chips, inputs, cards, badges.
// One look for one role:
//   <button>              secondary — outlined pill (the default)
//   .primary              main action — filled with the accent
//   .danger               destructive — outlined, danger colour
//   .link                 text action — accent, underlined
//   .chip                 toggle / suggestion — small pill, aria-pressed="true" = accent-soft + accent border
//   .icon-btn             round icon button (44 px tap target)
//   .small                smaller control (in dense rows)
// The same classes work on <a>.

import { css } from 'lit';

export const ui = css`
  :host { -webkit-tap-highlight-color: transparent; }
  *, *::before, *::after { box-sizing: border-box; }

  /* ── Buttons ─────────────────────────────────────────────── */
  :where(button, .button, a.primary, a.secondary, a.danger) {
    font: inherit;
    font-size: 0.9rem;
    font-weight: 500;
    line-height: 1.2;
    min-height: var(--gf-control-h);
    padding: 8px 16px;
    border-radius: var(--gf-radius-pill);
    border: 1px solid var(--gf-border);
    background: var(--gf-surface);
    color: var(--gf-text);
    cursor: pointer;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    transition: background-color 0.12s, border-color 0.12s, color 0.12s;
  }
  :where(button:hover, .button:hover, a.secondary:hover) { background: var(--gf-surface-2); }
  :where(button:focus-visible, .button:focus-visible, a:focus-visible, summary:focus-visible) {
    outline: none;
    box-shadow: var(--gf-focus);
  }
  :where(button:disabled, .button[aria-disabled='true']) { opacity: 0.5; cursor: default; pointer-events: none; }

  :where(.primary, a.primary) {
    background: var(--gf-accent);
    border-color: var(--gf-accent);
    color: var(--gf-accent-contrast);
    font-weight: 600;
  }
  :where(.primary:hover, a.primary:hover) { background: color-mix(in srgb, var(--gf-accent) 88%, var(--gf-text)); }
  :where(.primary.large) { min-height: 48px; padding: 12px 22px; font-size: 1rem; }

  :where(.danger, a.danger) { color: var(--gf-danger); border-color: color-mix(in srgb, var(--gf-danger) 45%, var(--gf-border)); }
  :where(.danger:hover) { background: color-mix(in srgb, var(--gf-danger) 10%, var(--gf-surface)); }

  :where(.link, a.link) {
    min-height: 0;
    padding: 2px 0;
    border: 0;
    border-radius: 0;
    background: none;
    color: var(--gf-accent);
    font-size: 0.85rem;
    font-weight: 500;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  :where(.link:hover) { background: none; color: color-mix(in srgb, var(--gf-accent) 75%, var(--gf-text)); }
  :where(.link.muted) { color: var(--gf-text-muted); }
  :where(.link.danger) { color: var(--gf-danger); }

  :where(.chip, button[aria-pressed]) {
    min-height: 32px;
    padding: 4px 12px;
    font-size: 0.85rem;
  }
  :where(.chip[aria-pressed='true'], button[aria-pressed='true']) {
    background: var(--gf-accent-soft);
    border-color: var(--gf-accent);
    color: var(--gf-text);
    font-weight: 600;
  }
  :where(.small) { min-height: 32px; padding: 4px 12px; font-size: 0.85rem; }

  :where(.icon-btn) {
    min-height: 0;
    width: 44px;
    height: 44px;
    padding: 0;
    border-radius: 50%;
    border-color: transparent;
    background: none;
    font-size: 1.3rem;
    color: var(--gf-text-muted);
  }
  :where(.icon-btn:hover) { background: var(--gf-surface-2); }

  /* A row of actions. */
  :where(.actions) { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }

  /* Segmented control: buttons joined in one pill. */
  :where(.segmented) { display: inline-flex; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-pill); overflow: hidden; background: var(--gf-surface); }
  :where(.segmented > *) { border: 0; border-radius: 0; min-height: 32px; padding: 4px 14px; font-size: 0.85rem; }
  :where(.segmented > [aria-pressed='true'], .segmented > [aria-current='page']) { background: var(--gf-accent); color: var(--gf-accent-contrast); }

  /* ── Fields ──────────────────────────────────────────────── */
  :where(input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='file']), select, textarea) {
    font: inherit;
    font-size: 1rem;
    color: var(--gf-text);
    background: var(--gf-surface);
    border: 1px solid var(--gf-border);
    border-radius: var(--gf-radius-sm);
    padding: 9px 12px;
    min-height: var(--gf-control-h);
    width: 100%;
  }
  :where(input[type='search']) { border-radius: var(--gf-radius-pill); padding-left: 14px; padding-right: 14px; }
  :where(select) { width: auto; padding-right: 28px; }
  :where(textarea) { min-height: 80px; resize: vertical; }
  :where(input:focus-visible, select:focus-visible, textarea:focus-visible) {
    outline: none;
    border-color: var(--gf-accent);
    box-shadow: var(--gf-focus);
  }
  :where(input[type='checkbox'], input[type='radio']) { accent-color: var(--gf-accent); width: 18px; height: 18px; }
  :where(label.field) { display: grid; gap: 4px; font-size: 0.85rem; color: var(--gf-text-muted); }

  /* ── Surfaces ────────────────────────────────────────────── */
  :where(.card) {
    background: var(--gf-surface);
    border: 1px solid var(--gf-border);
    border-radius: var(--gf-radius);
    padding: 12px 14px;
  }
  :where(.kicker) {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--gf-text-muted);
    font-weight: 600;
  }
  :where(.muted) { color: var(--gf-text-muted); }
  :where(.badge) {
    display: inline-block;
    background: var(--gf-season);
    color: var(--gf-season-text);
    border-radius: var(--gf-radius-pill);
    padding: 0 8px;
    font-size: 0.75rem;
    font-weight: 600;
  }
  :where(.badge.soon) { background: var(--gf-accent-soft); color: var(--gf-text); }
  :where(.toast) {
    background: var(--gf-text);
    color: var(--gf-bg);
    border-radius: var(--gf-radius);
    box-shadow: var(--gf-shadow-float);
    padding: 10px 16px;
    font-size: 0.9rem;
  }
  :where(.toast .link, .toast a) { color: var(--gf-accent-soft); font-weight: 600; }
`;
