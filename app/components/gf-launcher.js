// @ts-check
// The list of the ways to play, one card each: the mini-apps first (app/miniapps: each one opens alone on the
// screen, at #/app/<id>), then the scenarios still played in Découvrir (core/scenarios.js) — what each one does and
// « Jouer » (« Reprendre » for a mini-app with a game under way, « En cours » for the one on screen, « Rejouer » for
// the scenario on screen). One list, two places:
//  - `page`: the Découvrir tab (#/discover, and the start page during the first steps), a page of its own — a title,
//    each card with its picture (core/scenes.js); cards in a grid on a wide screen, a list on a phone; during the
//    first steps, « Passer : montrer toute l'application »;
//  - in the launcher's dialog (gf-scenarios, the film icon): compact, an icon each.
// A card played fires `launched` (the dialog closes on it).

import { LitElement, html, css, nothing } from 'lit';
import { icon } from '../core/icons.js';
import { openView } from '../core/history.js';
import { href, parse } from '../core/router.js';
import { scene, sceneStyles } from '../core/scenes.js';
import { SCENARIOS } from '../core/scenarios.js';
import { discoverEvents, discovering, finishDiscover } from '../core/discover.js';
import { MINIAPPS } from '../miniapps/index.js';
import { ui } from '../styles/ui.js';

/**
 * @typedef {{ key: string, app: boolean, title: string, pitch: string, icon: import('../core/icons.js').IconName, scene: string | null,
 *   verb: string, hint: string, here: boolean, run: () => void }} Entry
 */

/** The entries, in the launcher's order, as they are now (the address, the games under way). @returns {Entry[]} */
function entries() {
  const r = parse(location.hash);
  return [
    ...MINIAPPS.map(a => {
      const here = r.name === 'app' && r.id === a.id;
      const resume = !here && a.resume();
      return { key: a.id, app: true, title: a.title, pitch: a.pitch, icon: a.icon, scene: a.scene, here,
        verb: here ? 'En cours' : resume ? 'Reprendre' : 'Jouer', hint: resume ? 'Reprendre la partie là où vous l’aviez laissée' : '',
        run: () => openView(href.app(a.id)) };
    }),
    ...SCENARIOS.map(s => {
      const again = Boolean(s.played?.());
      return { key: s.key, app: false, title: s.title, pitch: s.pitch, icon: s.icon, scene: s.scene ?? null, here: false,
        verb: again ? 'Rejouer' : 'Jouer', hint: again ? 'Tout reprendre du début : lieu, distance, cartes, étapes' : '', run: s.play };
    })
  ];
}

export class GfLauncher extends LitElement {
  static properties = {
    /** The Découvrir tab's page (else: the launcher's dialog). */
    page: { type: Boolean, reflect: true }
  };

  static styles = [ui, sceneStyles, css`
    :host { display: block; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); }
    li { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; align-items: start; padding: 14px; border: 1px solid var(--gf-border); border-radius: 14px;
      background: var(--gf-surface); }
    .ic { grid-row: span 3; width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; font-size: 1.3rem; background: var(--gf-accent-soft); color: var(--gf-accent); }
    h2, h3 { margin: 0; font-size: 1rem; line-height: 1.3; }
    li p { margin: 0; font-size: 0.86rem; color: var(--gf-text-muted); }
    li button { justify-self: start; margin-top: 6px; }

    /* The page: the tab's own screen. */
    :host([page]) { height: 100%; overflow-y: auto; background: var(--gf-bg); container-type: inline-size; }
    .page { max-width: 1120px; margin: 0 auto; padding: 24px 16px 32px; }
    .page > header { margin: 0 0 18px; }
    .page h1 { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 1.6rem; line-height: 1.2; }
    .page h1 .bi { color: var(--gf-accent); }
    .page .intro { margin: 6px 0 0; max-width: 40em; color: var(--gf-text-muted); font-size: 1rem; line-height: 1.45; }
    .page ul { gap: 16px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); }
    /* A wide screen: cards, the picture on top, the action at the bottom. */
    .page li { grid-template-columns: 1fr; grid-template-rows: auto auto 1fr auto; gap: 6px; padding: 0 0 16px; overflow: hidden; border-radius: 18px; box-shadow: var(--gf-shadow); }
    .page li > :not(.pic) { margin-inline: 16px; }
    .pic { display: grid; place-items: center; aspect-ratio: 320 / 190; padding: 12px 16px 0; background: color-mix(in srgb, var(--gf-accent-soft) 45%, var(--gf-surface)); }
    .pic .scene { width: 100%; max-width: 300px; }
    .pic .ic { width: 72px; height: 72px; border-radius: 20px; font-size: 2.1rem; }
    .page h2 { margin-top: 10px; font-size: 1.2rem; }
    .page li p { font-size: 0.95rem; line-height: 1.45; }
    .page li button { margin-top: 10px; min-width: 132px; min-height: 44px; font-size: 1rem; }
    .page .skip { margin: 24px 0 0; text-align: center; font-size: 0.9rem; }
    .page .skip a { display: inline-flex; align-items: center; min-height: 44px; }
    /* A phone: a list, a small picture beside the words. */
    @container (max-width: 599px) {
      .page { padding: 16px 16px 24px; }
      .page h1 { font-size: 1.4rem; }
      .page .intro { font-size: 0.95rem; }
      .page ul { gap: 12px; }
      .page li { grid-template-columns: 104px 1fr; grid-template-rows: auto auto auto; gap: 2px 12px; padding: 12px; }
      .page li > :not(.pic) { margin-inline: 0; }
      .pic { grid-row: span 3; align-self: start; padding: 4px; border-radius: 12px; }
      .pic .ic { width: 52px; height: 52px; border-radius: 14px; font-size: 1.5rem; }
      .page h2 { margin-top: 0; font-size: 1.05rem; }
      .page li p { font-size: 0.875rem; }
      .page li button { margin-top: 6px; min-width: 0; }
    }
  `];

  constructor() {
    super();
    this.page = false;
  }

  #onChange = () => this.requestUpdate();

  connectedCallback() {
    super.connectedCallback();
    discoverEvents.addEventListener('change', this.#onChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    discoverEvents.removeEventListener('change', this.#onChange);
  }

  /** @param {Entry} e */
  #play(e) {
    e.run();
    this.dispatchEvent(new CustomEvent('launched', { detail: e.key, bubbles: true, composed: true }));
    this.requestUpdate();
  }

  /** @param {Entry} e */
  #card(e) {
    const id = 'play-' + e.key;
    const title = this.page ? html`<h2 id=${id}>${e.title}</h2>` : html`<h3 id=${id}>${e.title}</h3>`;
    const picture = this.page
      ? html`<div class="pic" aria-hidden="true">${e.scene ? scene(e.scene) : html`<span class="ic">${icon(e.icon)}</span>`}</div>`
      : html`<span class="ic" aria-hidden="true">${icon(e.icon)}</span>`;
    return html`<li data-app=${e.app ? e.key : nothing} data-scenario=${e.app ? nothing : e.key}>
      ${picture}
      ${title}
      <p>${e.pitch}</p>
      <button class="primary" type="button" ?disabled=${e.here} aria-label=${`${e.verb} : ${e.title}`} title=${e.hint || nothing}
        @click=${() => this.#play(e)}>${e.verb}</button>
    </li>`;
  }

  render() {
    const list = html`<ul>${entries().map(e => this.#card(e))}</ul>`;
    if (!this.page) return list;
    return html`<section class="page" aria-labelledby="discover-title">
      <header>
        <h1 id="discover-title">${icon('binoculars-fill')} Découvrir</h1>
        <p class="intro">Des façons de découvrir la flore, chacune avec les outils qu’il lui faut. On peut en changer quand on veut.</p>
      </header>
      ${list}
      ${discovering() ? html`<p class="skip"><a class="link muted" href=${href.search()} @click=${() => finishDiscover()}>Passer : montrer toute l’application</a></p>` : nothing}
    </section>`;
  }
}

customElements.define('gf-launcher', GfLauncher);
