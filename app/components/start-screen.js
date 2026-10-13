// @ts-check
// The first screen of a scenario (a mini-app), one template for all, on the Parcours' model: an illustration, a
// title, a description, one large action; then, smaller, the other ways in (a commune, a name, one to take up
// again, a link); last, the one way out. Large on top, small below: the eye goes to the action.
// The template only lays out: the state (busy, error, the list to take up again) stays with the caller; the place
// search is its own element (its request, its states). Its DOM sits in the caller's shadow root, so the caller's
// code and the tests keep reaching `.go` and `.leave`. Every rule is scoped under `.start` and the template only
// uses the class names listed in START_CLASSES: a host must not style them.
// Usage: static styles = [ui, startStyles, css`…`]; render: startScreen({ id, art, title, lead, primary, alternatives, exit }).

import { html, css, nothing } from 'lit';
import { icon } from '../core/icons.js';
import { scene, sceneStyles } from '../core/scenes.js';
import './gf-place-search.js';

/**
 * @typedef {import('../core/icons.js').IconName} IconName
 * @typedef {string | import('lit').TemplateResult} Text
 *
 * @typedef {object} StartPrimary            the one large action
 * @property {string} label                  « Commencer ici »
 * @property {IconName} [icon]
 * @property {() => void} run
 * @property {boolean} [busy]                running: same look, says `busyLabel`, takes no second touch
 * @property {string} [busyLabel]            « Localisation… »
 * @property {() => void} [cancel]           while busy: a small « Annuler » under it
 * @property {boolean} [disabled]
 *
 * @typedef {{ text: string, retry?: () => void }} StartError
 * @typedef {{ key: string, label: Text, meta?: string, icon?: IconName, run: () => void }} StartChoice
 *
 * @typedef {{ kind: 'place', label: string, field?: string, placeholder?: string,
 *     pick: (p: { coordinates: [number, number], label: string }) => void }} StartPlace        « ou partir d’une commune » + <gf-place-search>
 * @typedef {{ kind: 'query', label: string, field: string, placeholder: string, submit: (text: string) => void }} StartQuery   a plain field, Entrée
 * @typedef {{ kind: 'choices', label: string, items: StartChoice[], max?: number }} StartChoices  max shown (default 3), the rest folded
 * @typedef {{ kind: 'link', label: string, icon?: IconName, run?: () => void, href?: string }} StartLink   a place to go (href: a real link), or an action
 * @typedef {StartPlace | StartQuery | StartChoices | StartLink} StartAlternative
 *
 * @typedef {{ label: string, icon?: IconName, run?: () => void, href?: string }} StartExit
 *
 * @typedef {object} StartSpec
 * @property {string} id                     the scenario key (data-start)
 * @property {string | import('lit').TemplateResult} art   a scene of core/scenes.js, or a picture of its own
 * @property {string} [kicker]               a small line above the title (Herbier: « La plante du lundi 12 octobre »)
 * @property {string} title
 * @property {Text} lead                     two or three short sentences
 * @property {{ text: string, icon?: IconName }} [caution]   a warning as readable as the description (Cueillette)
 * @property {StartPrimary} primary
 * @property {string | StartError | null} [error]   the action failed: in the danger colour, next to it
 * @property {string} [note]                 one small line under the action
 * @property {(StartAlternative | false | null | undefined)[]} [alternatives]
 * @property {StartExit} exit                the one way out
 */

/**
 * French spacing: a narrow no-break space before : ; ! ? » and after «, so a line never starts with « : ».
 * Strings only. @template T @param {T} t @returns {T}
 */
export const fr = t => /** @type {any} */ (typeof t === 'string' ? t.replace(/ ([:;!?»])/g, ' $1').replace(/« /g, '« ') : t);

/**
 * A GPS failure said on a start screen, from geo.js's code. `place`: a commune can be chosen instead.
 * @param {string | null | undefined} code @param {{ place?: boolean, retry?: () => void }} [o] @returns {StartError}
 */
export function geoProblem(code, o = {}) {
  const or = o.place ? ', ou choisissez une commune.' : '.';
  switch (code) {
    case 'denied': return { text: 'Localisation refusée. Autorisez-la dans les réglages du navigateur' + or };
    case 'timeout': return { text: 'Position introuvable pour le moment (essayez à découvert)' + or, retry: o.retry };
    case 'unsupported': return { text: 'Ce navigateur ne donne pas votre position.' + (o.place ? ' Choisissez une commune.' : '') };
    // Often passing (no position yet, the device's location off): worth trying again.
    default: return { text: 'Position indisponible pour le moment. Vérifiez que la localisation de l’appareil est activée' + or, retry: o.retry };
  }
}

/** @param {StartChoice} c */
const choice = c => html`<button type="button" data-key=${c.key} @click=${() => c.run()}>
  ${c.icon ? icon(c.icon) : nothing}<span>${fr(c.label)}</span>${c.meta ? html`<small>${c.meta}</small>` : nothing}</button>`;

/** @param {StartAlternative} a @param {number} i */
function alternative(a, i) {
  switch (a.kind) {
    case 'place':
      return html`<p class="or">${fr(a.label)}</p>
        <gf-place-search class="commune" placeholder=${a.placeholder || 'Une commune, un lieu-dit…'} label=${a.field || a.label}
          @place-pick=${(/** @type {CustomEvent} */ e) => a.pick(e.detail)}></gf-place-search>`;
    case 'query':
      return html`<p class="or">${fr(a.label)}</p>
        <form class="query" role="search" @submit=${(/** @type {SubmitEvent} */ e) => { e.preventDefault();
          const v = /** @type {HTMLInputElement} */ (/** @type {HTMLFormElement} */ (e.target).elements.namedItem('q')).value.trim(); if (v) a.submit(v); }}>
          ${icon('search')}<input name="q" type="search" placeholder=${a.placeholder} aria-label=${a.field} autocomplete="off" enterkeyhint="search" /></form>`;
    case 'choices': {
      if (!a.items.length) return nothing;
      const max = a.max ?? 3, shown = a.items.slice(0, max), more = a.items.slice(max);
      return html`<div class="choices" role="group" aria-labelledby=${'start-alt-' + i}>
        <h2 id=${'start-alt-' + i}>${fr(a.label)}</h2>
        ${shown.map(choice)}
        ${more.length ? html`<details><summary>Voir ${more.length === 1 ? 'l’autre' : `les ${more.length} autres`}</summary>${more.map(choice)}</details>` : nothing}
      </div>`;
    }
    case 'link':
      return a.href
        ? html`<a class="link alt" href=${a.href} @click=${() => a.run?.()}>${a.icon ? icon(a.icon) : nothing}${fr(a.label)}</a>`
        : html`<button class="link alt" type="button" @click=${() => a.run?.()}>${a.icon ? icon(a.icon) : nothing}${fr(a.label)}</button>`;
  }
}

/** @param {StartExit} x */
const exitLink = x => x.href
  ? html`<a class="leave link muted" href=${x.href} @click=${() => x.run?.()}>${x.icon ? icon(x.icon) : nothing}${fr(x.label)}</a>`
  : html`<button class="leave link muted" type="button" @click=${() => x.run?.()}>${x.icon ? icon(x.icon) : nothing}${fr(x.label)}</button>`;

/** A scenario's first screen. @param {StartSpec} o */
export function startScreen(o) {
  const p = o.primary;
  const alts = /** @type {StartAlternative[]} */ ((o.alternatives || []).filter(Boolean));
  const err = typeof o.error === 'string' ? { text: o.error } : o.error;
  return html`<section class="start" data-start=${o.id} aria-labelledby="start-title">
    <div class="art">${typeof o.art === 'string' ? scene(o.art) : o.art}</div>
    ${o.kicker ? html`<p class="kicker">${fr(o.kicker)}</p>` : nothing}
    <h1 id="start-title">${fr(o.title)}</h1>
    <p class="lead">${fr(o.lead)}</p>
    ${o.caution ? html`<p class="caution">${icon(o.caution.icon || 'exclamation-triangle-fill')}<span>${fr(o.caution.text)}</span></p>` : nothing}
    <div class="act">
      <!-- Busy: it says so and takes no second touch, but keeps the focus (aria-disabled, not disabled). -->
      <button class="primary go" type="button" ?disabled=${Boolean(p.disabled)} aria-disabled=${p.busy ? 'true' : nothing} aria-busy=${p.busy ? 'true' : 'false'}
        @click=${() => { if (!p.busy) p.run(); }}>
        ${p.icon ? icon(p.icon) : nothing}<span>${fr(p.busy ? p.busyLabel || p.label : p.label)}</span></button>
      ${err ? html`<p class="alert" role="alert">${icon('exclamation-triangle-fill')} <span>${fr(err.text)}</span>${err.retry
        ? html` <button class="link" type="button" @click=${() => err.retry?.()}>Réessayer</button>` : nothing}</p>`
        : p.busy && p.cancel ? html`<p class="cancel"><button class="link muted" type="button"
            @click=${(/** @type {Event} */ e) => { const go = /** @type {HTMLElement} */ (e.currentTarget).closest('.act')?.querySelector('.go'); p.cancel?.(); /** @type {HTMLElement | null | undefined} */ (go)?.focus(); }}>Annuler</button></p>`
        : nothing}
      <!-- The note stays, under « Annuler » or the error too (what is done with the position, as it is taken). -->
      ${o.note ? html`<p class="note">${fr(o.note)}</p>` : nothing}
    </div>
    ${alts.length ? html`<div class="alts">${alts.map((a, i) => alternative(a, i))}</div>` : nothing}
    ${exitLink(o.exit)}
  </section>`;
}

/**
 * The scale: three sizes. Large: title, description, action. Small: the alternatives and the note. Smallest: the
 * exit. Fluid with the host's width (cqi; the host is an inline-size container): phone (390) → desk (≥ 900):
 * title 32 → 40 px, description 18 → 20 px, action 56 → 60 px high, label 19 → 21 px; alternatives 14 px (the
 * fields keep 16 px on a touch screen: iOS zooms into a smaller one), exit 13 px. A short screen gets a smaller
 * picture, never smaller words. Every value with a plain fallback first.
 */
export const startStyles = [sceneStyles, css`
  .start { display: grid; justify-items: stretch; align-content: start; width: 100%; max-width: 640px; margin: 0 auto; box-sizing: border-box; text-align: center;
    padding: 24px 16px 40px; padding: clamp(12px, 3.5dvh, 40px) 16px 40px; }
  .start .art { justify-self: center; width: min(320px, 82%); }
  .start .art .scene { width: 100%; }
  .start .art > :not(.scene) { display: block; margin: 0 auto; }

  .start .kicker { margin: 16px 0 0; font-size: 0.8125rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--gf-accent); }
  .start h1 { margin: 16px 0 0; font-size: 2rem; font-size: clamp(2rem, 1.5rem + 1.8cqi, 2.5rem); font-weight: 700; line-height: 1.15; letter-spacing: -0.01em;
    text-wrap: balance; overflow-wrap: break-word; color: var(--gf-text); }
  .start .kicker + h1 { margin-top: 4px; }
  .start .lead { margin: 10px auto 0; max-width: 30em; font-size: 1.125rem; font-size: clamp(1.125rem, 1rem + 0.45cqi, 1.25rem); line-height: 1.45; text-wrap: pretty;
    color: var(--gf-text-muted); color: color-mix(in srgb, var(--gf-text) 40%, var(--gf-text-muted)); }
  .start .caution { justify-self: center; display: inline-flex; align-items: flex-start; gap: 8px; margin: 14px auto 0; max-width: 30em; padding: 8px 14px; border-radius: 12px;
    background: color-mix(in srgb, var(--gf-warn) 12%, var(--gf-surface)); color: var(--gf-text); font-size: 1rem; font-weight: 600; line-height: 1.35; text-align: left; }
  .start .caution .bi { flex: none; color: var(--gf-warn); margin-top: 0.15em; }

  .start .act { display: grid; justify-items: center; gap: 8px; margin-top: 24px; }
  .start .go { min-height: 56px; min-width: min(100%, 280px); padding: 14px 32px; gap: 10px; border-radius: var(--gf-radius-pill, 999px);
    font-size: 1.1875rem; font-size: clamp(1.1875rem, 1.1rem + 0.3cqi, 1.3125rem); font-weight: 600; line-height: 1.2;
    box-shadow: 0 10px 22px -10px color-mix(in srgb, var(--gf-accent) 70%, transparent); }
  .start .go .bi { font-size: 1.1em; }
  .start .go[aria-busy='true'] { opacity: 1; cursor: progress; }
  .start .go[aria-busy='true'] .bi { animation: start-pulse 1.1s ease-in-out infinite; }
  @keyframes start-pulse { 50% { opacity: 0.35; } }
  .start .alert { margin: 2px auto 0; max-width: 30em; font-size: 0.9375rem; line-height: 1.4; color: var(--gf-danger); text-wrap: pretty; }
  /* « Réessayer »: 44 px under the finger, the line kept as it is. */
  .start .alert .link { font-size: inherit; color: inherit; font-weight: 600; min-height: 44px; padding: 0 8px; margin: -11px -4px; vertical-align: middle; }
  .start .note { margin: 0; font-size: 0.8125rem; line-height: 1.4; color: var(--gf-text-muted); }
  .start .cancel { margin: 0; font-size: 0.8125rem; }
  .start .cancel .link { font-size: inherit; min-height: 44px; padding: 0 14px; }
  .start .go[aria-busy='true']:focus-visible { box-shadow: var(--gf-focus); }

  /* The other ways in: smaller, narrower, under a thin « ou ». */
  .start .alts { display: grid; gap: 10px; width: 100%; max-width: 400px; justify-self: center; margin-top: 28px; font-size: 0.875rem; }
  .start .or { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 0.8125rem; color: var(--gf-text-muted); }
  .start .or::before, .start .or::after { content: ''; flex: 1; border-top: 1px solid var(--gf-border); }
  .start .query { position: relative; margin: 0; }
  .start .query .bi { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--gf-text-muted); pointer-events: none; }
  .start .query input { width: 100%; box-sizing: border-box; min-height: 44px; padding: 8px 16px 8px 38px; font-size: 1rem; border-radius: var(--gf-radius-pill, 999px); background: var(--gf-surface); }
  .start .choices { display: grid; gap: 6px; margin-top: 4px; text-align: left; }
  .start .choices h2 { margin: 0 0 2px; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--gf-text-muted); }
  .start .choices button { justify-content: flex-start; width: 100%; min-height: 44px; padding: 6px 12px; gap: 10px; border-radius: var(--gf-radius);
    background: var(--gf-surface); font-size: 0.875rem; font-weight: 500; line-height: 1.3; text-align: left; }
  .start .choices button .bi { flex: none; color: var(--gf-accent); }
  .start .choices button > span { flex: 1; min-width: 0; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
  .start .choices button small { flex: none; font-size: 0.75rem; color: var(--gf-text-muted); }
  .start .choices details { display: grid; gap: 6px; }
  .start .choices summary { cursor: pointer; display: flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 2px; font-size: 0.8125rem; color: var(--gf-accent); list-style: none; text-align: center; }
  .start .choices summary::-webkit-details-marker { display: none; }
  .start .choices details[open] summary { display: none; }
  .start .alt { justify-self: center; display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 10px; font-size: 0.875rem; }

  .start .leave { justify-self: center; display: inline-flex; align-items: center; gap: 6px; min-height: 44px; margin-top: 20px; padding: 0 12px; font-size: 0.8125rem; color: var(--gf-text-muted); }

  @media (pointer: fine) {
    .start .choices button { min-height: 40px; }
    .start .leave, .start .alt, .start .cancel .link, .start .choices summary { min-height: 32px; }
    .start .alert .link { min-height: 0; margin: 0; padding: 2px 4px; }
    .start .query input { min-height: 40px; font-size: 0.9375rem; }
  }
  /* A wide host (desk, tablet): the large tier grows, the picture too. */
  @container (min-width: 700px) {
    .start .art { width: 360px; }
    .start h1 { margin-top: 20px; }
    .start .lead { margin-top: 12px; }
    .start .act { margin-top: 28px; }
    .start .go { min-height: 60px; padding: 16px 40px; }
    .start .alts { margin-top: 32px; }
  }
  /* A short screen (iPhone SE, a laptop with its bars): the picture gives way, the words keep their size. */
  @media (max-height: 720px) {
    .start .art { width: min(240px, 66%); }
    .start h1 { margin-top: 12px; }
    .start .act { margin-top: 20px; }
    .start .alts { margin-top: 22px; }
  }
  /* A phone on its side (short and wide): the picture on the left, the words and the action on the right, in sight. */
  @media (max-height: 500px) and (min-aspect-ratio: 3/2) {
    .start { max-width: 920px; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); column-gap: 28px; padding-top: 12px; }
    .start > * { grid-column: 2; }
    .start .art { grid-column: 1; grid-row: 1 / span 12; width: 100%; align-self: start; position: sticky; top: 12px; }
    .start .kicker, .start h1 { margin-top: 0; }
    .start .act { margin-top: 16px; }
    .start .alts { margin-top: 18px; }
  }
  @media (prefers-reduced-motion: reduce) { .start .go[aria-busy='true'] .bi { animation: none; } }
`];
