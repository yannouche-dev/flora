// @ts-check
// The list of the ways to play, one card each: the mini-apps (app/miniapps: Rencontres, Parcours botanique, Cueillette
// prudente, Mosaïque, Faux amis; each one opens alone on the screen, at #/app/<id>) — what each one does and « Jouer ». (Not
// Scientifique: a mode, chosen in the header's switch or in Réglages, not a way to play.) A mini-app with a game under
// way on this device offers two actions instead: « Continuer » (where it was left: its last step) and « Recommencer »
// — asked first in a dialog, it empties what the mini-app owns, as its « Rejouer » does (runtime.js#replay, the other
// tabs too), and opens it at its first step. One list, two places:
//  - `page`: the Découvrir tab (#/discover, and the start page during the first steps), a page of its own — a title,
//    each card with its picture (core/scenes.js); cards on a wide screen (at most four a row, as many on each row as
//    can be: five, three and two — the shorter row centred; two a row on a medium one), a list on a phone; during the first steps, « Passer : montrer toute l'application »;
//  - in the launcher's dialog (gf-scenarios, the film icon): compact, an icon each.
// A card played fires `launched` (the dialog closes on it).

import { LitElement, html, css, nothing } from 'lit';
import { icon } from '../core/icons.js';
import { openView } from '../core/history.js';
import { href, parse } from '../core/router.js';
import { scene, sceneStyles } from '../core/scenes.js';
import { leftAt } from '../core/around-sessions.js';
import { discoverEvents, discovering, finishDiscover } from '../core/discover.js';
import { openModal } from '../core/history.js';
import { MINIAPPS } from '../miniapps/index.js';
import { madeByApp } from '../core/collections.js';
import { ui } from '../styles/ui.js';
import { askStyles, replayQuestion } from './ui-kit.js';

/**
 * @typedef {{ key: string, app: import('../miniapps/index.js').MiniAppEntry, title: string, pitch: string, icon: import('../core/icons.js').IconName,
 *   scene: string, here: boolean, underWay: boolean, run: () => void }} Entry
 */

/** The entries, in the launcher's order, as they are now (the address, the games under way). @returns {Entry[]} */
function entries() {
  const r = parse(location.hash);
  return MINIAPPS.map(a => {
    const here = r.name === 'app' && r.id === a.id;
    return { key: a.id, app: a, title: a.title, pitch: a.pitch, icon: a.icon, scene: a.scene, here, underWay: here || a.underWay(),
      // « Jouer » opens its start; « Continuer », the step it was left at (the box goes back to the start if that
      // step may no longer be entered).
      run: () => { if (!here) openView(href.app(a.id, a.underWay() ? leftAt(a.id) : null)); } };
  });
}

export class GfLauncher extends LitElement {
  static styles = [ui, sceneStyles, askStyles, css`
    :host { display: block; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); }
    li { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; align-items: start; padding: 14px; border: 1px solid var(--gf-border); border-radius: 14px;
      background: var(--gf-surface); }
    .ic { grid-row: span 3; width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; font-size: 1.3rem; background: var(--gf-accent-soft); color: var(--gf-accent); }
    h2, h3 { margin: 0; font-size: 1rem; line-height: 1.3; }
    li p { margin: 0; font-size: 0.86rem; color: var(--gf-text-muted); }
    li button { justify-self: start; margin-top: 6px; }
    li .acts { display: flex; flex-wrap: wrap; gap: 8px; justify-self: start; }
    li .acts button { margin-top: 6px; }

    /* The page: the tab's own screen. */
    :host([page]) { height: 100%; overflow-y: auto; background: var(--gf-bg); container-type: inline-size; }
    .page { max-width: 1120px; margin: 0 auto; padding: 24px 16px 32px; }
    .page > header { margin: 0 0 18px; }
    .page h1 { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 1.6rem; line-height: 1.2; }
    .page h1 .bi { color: var(--gf-accent); }
    .page .intro { margin: 6px 0 0; max-width: 40em; color: var(--gf-text-muted); font-size: 1rem; line-height: 1.45; }
    /* The cards in rows as even as can be (never three and one left alone): --wide and --mid, the cards a row there
       (render: at most four, at most three), the shorter row centred; two a row on a narrower screen. */
    .page ul { display: flex; flex-wrap: wrap; justify-content: center; gap: 16px; --cols: 2; }
    .page ul > li { box-sizing: border-box; flex: 0 0 calc((100% - (var(--cols) - 1) * 16px) / var(--cols)); min-width: 0; }
    @container (min-width: 760px) { .page ul { --cols: var(--mid, 2); } }
    @container (min-width: 1000px) { .page ul { --cols: var(--wide, 4); } }
    /* A wide screen: cards, the picture on top, the action at the bottom. */
    .page li { grid-template-columns: 1fr; grid-template-rows: auto auto 1fr auto; gap: 6px; padding: 0 0 16px; overflow: hidden; border-radius: 18px; box-shadow: var(--gf-shadow); }
    .page li > :not(.pic) { margin-inline: 16px; }
    .pic { display: grid; place-items: center; aspect-ratio: 320 / 190; padding: 12px 16px 0; background: color-mix(in srgb, var(--gf-accent-soft) 45%, var(--gf-surface)); }
    .pic .scene { width: 100%; max-width: 300px; }
    .page h2 { margin-top: 10px; font-size: 1.2rem; }
    .page li p { font-size: 0.95rem; line-height: 1.45; }
    .page li button { margin-top: 10px; min-width: 132px; min-height: 44px; font-size: 1rem; }
    .page li .acts button { margin-top: 10px; }
    .page .skip { margin: 24px 0 0; text-align: center; font-size: 0.9rem; }
    .page .skip a { display: inline-flex; align-items: center; min-height: 44px; }
    /* A phone: a list, a small picture beside the words. */
    @container (max-width: 599px) {
      .page { padding: 16px 16px 24px; }
      .page h1 { font-size: 1.4rem; }
      .page .intro { font-size: 0.95rem; }
      .page ul { display: grid; gap: 12px; grid-template-columns: 1fr; }
      .page li { grid-template-columns: 104px 1fr; grid-template-rows: auto auto auto; gap: 2px 12px; padding: 12px; }
      .page li > :not(.pic) { margin-inline: 0; }
      .pic { grid-row: span 3; align-self: start; padding: 4px; border-radius: 12px; }
      .page h2 { margin-top: 0; font-size: 1.05rem; }
      .page li p { font-size: 0.875rem; }
      .page li button, .page li .acts button { margin-top: 6px; min-width: 0; }
    }
  `];

  static properties = {
    /** The Découvrir tab's page (else: the launcher's dialog). */
    page: { type: Boolean, reflect: true },
    /** « Recommencer » asked for (its entry, and what it will delete), waiting for its confirmation. */
    _asking: { state: true }
  };

  constructor() {
    super();
    this.page = false;
    /** @type {(Entry & { items: { gone: string[], kept: string[] } }) | null} */
    this._asking = null;
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

  /** « Recommencer »: asked first, in a dialog (Annuler, Échap: nothing changes). @param {Entry} e */
  async #ask(e) {
    // What will be deleted, said: what it made in Mes plantes (its favourites, its parcours), the game.
    // The runtime of the mini-apps (runtime.js) comes with « Recommencer » only: not at the start of the app.
    const [{ default: m }, { replayItems }] = await Promise.all([e.app.load(), import('../miniapp/runtime.js')]);
    this._asking = { ...e, items: replayItems(m, await madeByApp(m.id).catch(() => ({ favorites: [], collections: [], kept: { favorites: 0, collections: 0 } }))) };
    await this.updateComplete;
    openModal(/** @type {HTMLDialogElement | null} */ (this.renderRoot.querySelector('dialog.ask')));
  }

  /**
   * « Recommencer » confirmed: what the mini-app owns emptied (its « Rejouer »: here, in the box if it is the one on
   * screen, and in the other tabs), then the mini-app at its first step.
   */
  async #restart() {
    const e = this._asking, a = e?.app;
    const dialog = /** @type {HTMLDialogElement | null} */ (this.renderRoot.querySelector('dialog.ask'));
    if (!e || !a) return;
    if (e.here) {
      // The one on screen: its box plays it again (event ma-replay, up to gf-miniapp).
      this.dispatchEvent(new CustomEvent('ma-replay', { detail: { id: a.id }, bubbles: true, composed: true }));
    } else {
      const { replayApp } = await import('../miniapp/runtime.js');
      await replayApp((await a.load()).default);
      openView(href.app(a.id, 'start'));
    }
    dialog?.close();
    this._asking = null;
    this.dispatchEvent(new CustomEvent('launched', { detail: e.key, bubbles: true, composed: true }));
    this.requestUpdate();
  }

  /** @param {Entry} e */
  #card(e) {
    const id = 'play-' + e.key;
    const title = this.page ? html`<h2 id=${id}>${e.title}</h2>` : html`<h3 id=${id}>${e.title}</h3>`;
    const picture = this.page
      ? html`<div class="pic" aria-hidden="true">${scene(e.scene)}</div>`
      : html`<span class="ic" aria-hidden="true">${icon(e.icon)}</span>`;
    return html`<li data-app=${e.key}>
      ${picture}
      ${title}
      <p>${e.pitch}</p>
      ${e.underWay ? html`<div class="acts">
          <button class="primary continue" type="button" aria-label=${`Continuer : ${e.title}`} title="Reprendre la partie là où vous l’aviez laissée"
            @click=${() => this.#play(e)}>Continuer</button>
          <button class="secondary restart" type="button" aria-label=${`Recommencer : ${e.title}`} title="Tout recommencer depuis le début"
            @click=${() => this.#ask(e)}>Recommencer</button>
        </div>`
        : html`<button class="primary" type="button" aria-label=${`Jouer : ${e.title}`} @click=${() => this.#play(e)}>Jouer</button>`}
    </li>`;
  }

  /** The confirmation of « Recommencer » (a step in history: Back says no). */
  #askView() {
    const e = this._asking;
    return html`<dialog class="ask" aria-labelledby="restart-title" aria-describedby="restart-text" @close=${() => { this._asking = null; }}>
      ${replayQuestion(e?.title ?? '', e?.items, 'restart')}
      <div class="row">
        <button type="button" autofocus @click=${(/** @type {Event} */ ev) => /** @type {HTMLElement} */ (ev.currentTarget).closest('dialog')?.close()}>Annuler</button>
        <button class="danger" type="button" @click=${() => this.#restart()}>${icon('arrow-counterclockwise')} Recommencer</button>
      </div>
    </dialog>`;
  }

  render() {
    const all = entries();
    // The cards a row, at most `max`, the rows as even as can be (five: three and two).
    const cols = (/** @type {number} */ max) => Math.ceil(all.length / Math.ceil(all.length / max));
    const list = html`<ul style=${this.page ? `--wide: ${cols(4)}; --mid: ${cols(3)}` : ''}>${all.map(e => this.#card(e))}</ul>${this.#askView()}`;
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
