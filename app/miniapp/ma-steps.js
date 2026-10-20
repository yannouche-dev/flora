// @ts-check
// The steps bar of a mini-app: the steps walked and those ahead (up to a fork), the current one marked
// (aria-current="step"). A step walked is a button back to it; at a fork, its choices; a step that waits for no
// condition, « Suite ». An app ported whole (driven) leads its own steps: the bar only shows them.

import { LitElement, html, css, nothing } from 'lit';
import { followers } from './define.js';
import { pathTo } from './runtime.js';
import { fr } from '../core/fr.js';
import { icon } from '../core/icons.js';
import { ui } from '../styles/ui.js';

/** The steps as the bar shows them: the path, then the next ones while there is one way on. @param {import('./runtime.js').MiniApp} app */
export function shownSteps(app) {
  const ids = [...app.path];
  const byId = new Map(app.m.steps.map(s => [s.id, s]));
  for (let next = followers(app.m, app.step); next.length === 1 && !ids.includes(next[0]); next = followers(app.m, /** @type {any} */ (byId.get(next[0])))) ids.push(next[0]);
  return ids.map(id => /** @type {import('./define.js').Step} */ (byId.get(id)));
}

export class MaSteps extends LitElement {
  static properties = {
    app: { attribute: false },
    /** The context as last rendered (a new one: drawn again). */
    c: { attribute: false },
    /** The steps walked (another path: drawn again). */
    path: { attribute: false }
  };

  static styles = [ui, css`
    :host { display: flex; align-items: center; gap: 8px; min-width: 0; }
    nav { min-width: 0; overflow-x: auto; scrollbar-width: none; }
    ol { display: flex; align-items: center; gap: 2px; margin: 0; padding: 0; list-style: none; white-space: nowrap; }
    li { display: flex; align-items: center; gap: 2px; color: var(--gf-text-muted); font-size: 0.85rem; }
    li + li::before { content: '›'; padding: 0 4px; color: var(--gf-border-strong, var(--gf-text-muted)); }
    li > span, li > button { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 2px 10px; border-radius: var(--gf-radius-pill); }
    li > button { border: 0; background: none; color: var(--gf-text); font-weight: 500; box-shadow: none; }
    li > button:hover { background: var(--gf-surface-2); }
    li [aria-current='step'] { background: var(--gf-accent-soft); color: var(--gf-accent); font-weight: 700; }
    .n { display: inline-grid; place-items: center; width: 1.4em; height: 1.4em; border-radius: 50%; background: var(--gf-surface-2); font-size: 0.75rem; font-weight: 700; }
    [aria-current='step'] .n { background: var(--gf-accent); color: var(--gf-accent-contrast); }
    .ahead { color: var(--gf-text-muted); }
    .acts { display: flex; gap: 6px; flex: none; }
    .acts button { min-height: 32px; padding: 4px 12px; font-size: 0.85rem; }
  `];

  constructor() {
    super();
    /** @type {import('./runtime.js').MiniApp | null} */
    this.app = null;
    /** @type {Record<string, any> | null} */
    this.c = null;
    /** @type {string[]} */
    this.path = [];
  }

  render() {
    const app = this.app;
    if (!app) return nothing;
    const steps = shownSteps(app), at = app.path.length - 1, step = app.step;
    const driven = Boolean(app.m.driven);
    const next = followers(app.m, step);
    return html`<nav aria-label="Étapes"><ol>${steps.map((s, i) => html`<li>${i < at && !driven
      ? html`<button type="button" title=${fr(s.about || 'Revenir à cette étape')} @click=${() => app.go(s.id)}><span class="n">${i + 1}</span>${fr(s.label)}</button>`
      : html`<span class=${i > at ? 'ahead' : ''} aria-current=${i === at ? 'step' : nothing} title=${fr(s.about || '')}><span class="n">${i + 1}</span>${fr(s.label)}</span>`}</li>`)}
    </ol></nav>
    ${driven ? nothing : html`<span class="acts">
      ${step.choose ? step.choose.map(ch => html`<button type="button" class="primary" @click=${() => app.go(ch.to)}>${ch.icon ? icon(/** @type {any} */ (ch.icon)) : nothing}${fr(ch.label)}</button>`) : nothing}
      ${step.kind !== 'start' && !step.done && next.length === 1 && pathTo(app.m, app.path, next[0], app.c) ? html`<button type="button" class="secondary" @click=${() => app.go(next[0])}>Suite ${icon('chevron-right')}</button>` : nothing}
      ${step.action ? html`<button type="button" class="secondary" @click=${() => step.action?.run(app)}>${fr(step.action.label)}</button>` : nothing}
    </span>`}`;
  }
}

customElements.define('ma-steps', MaSteps);
