// @ts-check
// Line icons drawn in currentColor, for buttons without text (the button carries the label).

import { svg } from 'lit';

const frame = (/** @type {import('lit').SVGTemplateResult} */ body) => svg`<svg viewBox="0 0 24 24" width="18" height="18" fill="none"
  stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

/** Display modes: Épuré (photo), Standard (lines), Scientifique (table). */
export const MODE_ICONS = {
  epure: frame(svg`<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="9.5" r="1.8"/><path d="M4 18l5.5-5.5 3.5 3.5 2.5-2.5L20 18"/>`),
  standard: frame(svg`<circle cx="5" cy="6.5" r="1.1" fill="currentColor"/><circle cx="5" cy="12" r="1.1" fill="currentColor"/><circle cx="5" cy="17.5" r="1.1" fill="currentColor"/><path d="M9 6.5h11M9 12h11M9 17.5h11"/>`),
  scientific: frame(svg`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14.5h18M9.5 4v16M15.5 4v16"/>`)
};
