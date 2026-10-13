// @ts-check
// The box of a mini-app (#/app/<id>[/<step>][?p=<plant>]): the app alone on the screen — no header, no tab bar
// (gf-app) —, under a bar of 48 px: « × Quitter … » (the one way out), its title, its steps (ma-steps, when
// « Afficher les étapes » says so), and ⋯: show or hide the steps, the layout back to its own, « Rejouer ».
//  - Its manifest is loaded when it opens (app/miniapps/index.js), checked against the kit, and run (runtime.js).
//  - The address follows it: a step reached is a new entry (Back returns to the one before), a step an app ported
//    whole says it is on replaces the address (Back leaves it, as before); ?p= is the context's `focus`.
//  - The way out: exit.confirm(c) asks first if it says something; then exit.handoff, within the grants; then back
//    to where it was opened from (else the start page).
//  - « Rejouer » asks first, in a dialog; then what the app owns is emptied (runtime.js#replay), here and in the
//    other tabs (core/sync.js), and it starts again at its first step.

import { LitElement, html, css, repeat } from 'lit';
import { backTo, depth, entryValue, markEntry, openModal, pushHash, replaceHash } from '../core/history.js';
import { href } from '../core/router.js';
import { plantViewOf, setHarvestMode, setMode, setShowSteps, StoreController } from '../core/store.js';
import { subscribe } from '../core/sync.js';
import { icon } from '../core/icons.js';
import { ui } from '../styles/ui.js';
import { startScreen, startStyles, fr } from '../components/start-screen.js';
import '../components/gf-scenarios.js';
import { miniApp } from '../miniapps/index.js';
import { kitProblems } from './define.js';
import { kit } from './kit.js';
import { MiniApp } from './runtime.js';
import './ma-grid.js';
import './ma-steps.js';

export class GfMiniapp extends LitElement {
  static properties = {
    /** The route of the box: { name: 'app', id, step, plant } (router.js). */
    route: { attribute: false },
    _app: { state: true },
    _error: { state: true },
    /** Said to screen readers: the step reached. */
    _said: { state: true },
    /** The component of an app ported whole shows its own steps bar (Découvrir's guided way): the box's is left out. */
    _ownBar: { state: true }
  };

  static styles = [ui, startStyles, css`
    :host { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0; background: var(--gf-bg, var(--gf-surface-2)); }
    .bar { display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 4px 8px; background: var(--gf-surface); border-bottom: 1px solid var(--gf-border); min-width: 0; }
    .quit { flex: none; min-height: 40px; padding: 4px 12px 4px 8px; gap: 6px; border: 0; background: none; box-shadow: none; color: var(--gf-text-muted); font-weight: 500; }
    .quit:hover { background: var(--gf-surface-2); color: var(--gf-text); }
    .title { flex: none; display: inline-flex; align-items: center; gap: 8px; margin: 0; font-size: 1rem; font-weight: 700; white-space: nowrap; color: var(--gf-text); }
    .title .bi { color: var(--gf-accent); }
    ma-steps { flex: 1; }
    .spacer { flex: 1; }
    .more { position: relative; flex: none; }
    .more summary { list-style: none; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; cursor: pointer; color: var(--gf-text-muted); font-size: 1.2rem; }
    .more summary::-webkit-details-marker { display: none; }
    .more summary:hover { background: var(--gf-surface-2); color: var(--gf-text); }
    .more summary:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 30; display: grid; min-width: 240px; padding: 6px; border-radius: 12px;
      background: var(--gf-surface); border: 1px solid var(--gf-border); box-shadow: var(--gf-shadow-float); }
    .menu button { justify-content: flex-start; gap: 10px; min-height: 40px; border: 0; background: none; box-shadow: none; font-weight: 500; text-align: left; }
    .menu button:hover { background: var(--gf-surface-2); }
    gf-scenarios { flex: none; }
    .body { position: relative; min-height: 0; overflow: hidden; container-type: inline-size; }
    .body > ma-grid { height: 100%; }
    .start-host { height: 100%; overflow-y: auto; }
    .missing { padding: 24px 16px; }
    dialog { width: min(440px, calc(100vw - 24px)); padding: 20px; border: 0; border-radius: 16px; background: var(--gf-surface); color: var(--gf-text); box-shadow: var(--gf-shadow-float); }
    dialog::backdrop { background: rgb(0 0 0 / 45%); }
    dialog h2 { margin: 0 0 8px; font-size: 1.15rem; }
    dialog p { margin: 0 0 16px; color: var(--gf-text-muted); }
    dialog .row { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; }
    /* A phone: the way out as an icon, the steps on a line of their own. */
    @container (max-width: 699px) { .bar { flex-wrap: wrap; } }
    @media (max-width: 699px) {
      .bar { flex-wrap: wrap; row-gap: 0; padding: 2px 4px; }
      .quit .lbl { display: none; }
      .quit { padding: 4px 10px; }
      ma-steps { order: 5; flex: 1 0 100%; }
      .spacer { display: block; }
    }
  `];

  #store = new StoreController(this);

  constructor() {
    super();
    /** @type {{ name: 'app', id: string, step: string | null, plant: number | null } | null} */
    this.route = null;
    /** @type {MiniApp | null} */
    this._app = null;
    /** @type {string | null} */
    this._error = null;
    this._said = '';
    this._ownBar = false;
    // An app ported whole says which step it is on.
    this.addEventListener('ma-step', e => {
      const d = /** @type {CustomEvent} */ (e).detail || {};
      this._ownBar = Boolean(d.ownBar);
      if (this._app?.reached(d.step)) this.#syncUrl();
    });
    // « Autres scénarios » of a component: the launcher, over the box.
    this.addEventListener('open-scenarios', e => {
      e.stopPropagation();
      /** @type {any} */ (this.renderRoot.querySelector('gf-scenarios'))?.open();
    });
  }

  /** The depth of the entry it was opened from (Quitter goes back to it). @type {number | null} */ #from = null;
  /** @type {(() => void) | null} */ #unsync = null;
  #loading = '';

  connectedCallback() {
    super.connectedCallback();
    // « Rejouer » in another tab: emptied here too.
    this.#unsync = subscribe('miniapp', d => { if (d.op === 'replay' && d.id === this._app?.m.id) this._app.replay(true); });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#unsync?.();
    this.#drop();
  }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    const route = this.route;
    if (!route) return;
    if (this._app) { this._app.showSteps = this.#store.state.showSteps; this._app.view = plantViewOf(this.#store.state); }
    if (changed.has('route')) {
      if (this._app?.m.id === route.id) this.#follow();
      else if (this.#loading !== route.id) this.#open(route.id);
    }
  }

  /** The mini-app `id` opened: its manifest loaded and checked, run. @param {string} id */
  async #open(id) {
    this.#drop();
    this.#loading = id;
    this._error = null;
    const entry = miniApp(id);
    if (!entry) { this._error = 'Cette mini-application n’existe pas (ou plus).'; this.#loading = ''; return; }
    try {
      const m = (await entry.load()).default;
      const problems = kitProblems(m, kit);
      if (problems.length) throw new Error(`mini-app ${id}: ${problems.join('; ')}`);
      if (this.#loading !== id) return;
      const app = new MiniApp(m, { showSteps: this.#store.state.showSteps });
      app.view = plantViewOf(this.#store.state);
      app.addEventListener('change', this.#onChange);
      app.addEventListener('navigate', this.#onNavigate);
      app.addEventListener('exit', this.#onExit);
      // Where it was opened from: kept in the entry (a reload, Back and Forward find it again).
      const kept = entryValue('gfAppFrom');
      this.#from = typeof kept === 'number' ? kept : depth() > 0 ? depth() - 1 : null;
      markEntry({ gfAppFrom: this.#from });
      this._app = app;
      document.title = m.title + ' — GeoFlora';
      this.#follow();
    } catch (error) {
      console.error(error);
      this._error = 'Cette mini-application n’a pas pu s’ouvrir.';
    } finally {
      if (this.#loading === id) this.#loading = '';
    }
  }

  #drop() {
    const app = this._app;
    if (!app) return;
    app.removeEventListener('change', this.#onChange);
    app.removeEventListener('navigate', this.#onNavigate);
    app.removeEventListener('exit', this.#onExit);
    app.dispose();
    this._app = null;
  }

  /** The address followed (a link, Back, Forward): its step, and its plant as the focus. */
  #follow() {
    const app = this._app, route = this.route;
    if (!app || !route) return;
    if ('focus' in app.m.context) app.set({ focus: route.plant });
    // An app ported whole leads its own steps: the address only says them.
    // (The step of the address meanwhile, until it says its own: the bar does not jump back to the start.)
    if (app.m.driven) { if (!route.step || !app.reached(route.step)) this.#syncUrl(); return; }
    // A step that may not be entered now (a link, a reload): the start, with no error.
    if (!app.follow(route.step)) { app.follow(null); this.#syncUrl(); }
    else if (!route.step) this.#syncUrl();
  }

  /** The address the box is at now. */
  #href() {
    const app = /** @type {MiniApp} */ (this._app);
    const focus = 'focus' in app.m.context ? app.c.focus : null;
    return href.app(app.m.id, app.step.id, typeof focus === 'number' ? focus : null);
  }

  /** The address in step, without a new entry (old addresses of Découvrir too). */
  #syncUrl() {
    if (!this._app) return;
    const want = this.#href();
    if (location.hash !== want) replaceHash(want);
  }

  #onChange = () => {
    // The plant (?p=) changed in place: the address follows; a step changed: #onNavigate does.
    const app = this._app;
    if (app && /^#\/app\/[^/?]+\/([^?]+)/.exec(location.hash)?.[1] === app.step.id) this.#syncUrl();
    this.requestUpdate();
  };

  #onNavigate = (/** @type {Event} */ e) => {
    const app = this._app;
    if (!app) return;
    const { replace } = /** @type {CustomEvent} */ (e).detail || {};
    const want = this.#href();
    if (location.hash !== want) { if (replace) replaceHash(want); else pushHash(want, { gfAppFrom: this.#from }); }
    const at = app.path.length, all = app.m.steps.length;
    this._said = fr(`Étape ${at} sur ${all} : ${app.step.label}`);
  };

  #onExit = async () => {
    const app = this._app;
    if (!app) return;
    const text = app.m.exit.confirm?.(app.c);
    if (text && !(await this.#ask('leave', text))) return;
    const h = app.handoff();
    if (h.mode) setMode(/** @type {any} */ (h.mode));
    if (typeof h.harvestMode === 'boolean') setHarvestMode(h.harvestMode);
    app.flush();
    backTo(typeof h.to === 'string' ? null : this.#from, typeof h.to === 'string' ? h.to : '#/');
  };

  /** « Rejouer », once confirmed. */
  async #replay() {
    if (!this._app || !(await this.#ask('replay'))) return;
    /** @type {any} */ (this.renderRoot.querySelector('ma-grid'))?.resetLayout?.();
    await this._app.replay();
  }

  /** The answer of a confirmation dialog. @type {((yes: boolean) => void) | null} */ #answer = null;
  /** @type {{ kind: 'replay' | 'leave', text: string } | null} */ _asking = null;

  /** Asks in a modal dialog (a step in history: Back says no). @param {'replay' | 'leave'} kind @param {string} [text] @returns {Promise<boolean>} */
  async #ask(kind, text = '') {
    this._asking = { kind, text };
    this.requestUpdate();
    await this.updateComplete;
    const dialog = /** @type {HTMLDialogElement | null} */ (this.renderRoot.querySelector('dialog.ask'));
    if (!dialog) return false;
    return new Promise(resolve => {
      this.#answer = resolve;
      dialog.addEventListener('close', () => { const a = this.#answer; this.#answer = null; a?.(dialog.returnValue === 'yes'); }, { once: true });
      dialog.returnValue = '';
      openModal(dialog);
    });
  }

  /** @param {Event} e */
  #closeMenu(e) { /** @type {HTMLElement} */ (e.currentTarget).closest('details')?.removeAttribute('open'); }

  render() {
    if (this._error) return html`<div class="bar"><button class="quit" type="button" @click=${() => backTo(this.#from, '#/')}>${icon('x-lg')}<span class="lbl"> Fermer</span></button></div>
      <p class="missing" role="alert">${this._error} <a href="#/">Retour à l’accueil</a></p>`;
    const app = this._app;
    if (!app) return html`<div class="bar"></div><p class="missing" role="status">Chargement…</p>`;
    const step = app.step, m = app.m;
    const c = app.c;
    const kind = step.kind ?? 'grid';
    const drawn = kind !== 'grid' && !(m.driven && kind === 'start');
    const bar = app.guided && !this._ownBar;
    const asking = this._asking;
    return html`<div class="bar">
        <button class="quit" type="button" title=${fr(m.exit.label)} aria-label=${fr(m.exit.label)} @click=${() => app.exit()}>${icon('x-lg')}<span class="lbl">${fr(m.exit.label)}</span></button>
        <span class="title">${icon(/** @type {any} */ (m.icon))}<span>${fr(m.title)}</span></span>
        ${bar ? html`<ma-steps .app=${app} .c=${c} .path=${app.path}></ma-steps>` : html`<span class="spacer"></span>`}
        <gf-scenarios></gf-scenarios>
        <details class="more" @keydown=${(/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') /** @type {HTMLDetailsElement} */ (e.currentTarget).removeAttribute('open'); }}>
          <summary aria-label="Plus d’options" title="Plus d’options">${icon('three-dots')}</summary>
          <div class="menu" role="group" aria-label="Options de ${fr(m.title)}">
            <button type="button" @click=${(/** @type {Event} */ e) => { this.#closeMenu(e); setShowSteps(bar ? 'off' : 'on'); }}>${icon(bar ? 'eye-slash' : 'list-ul')} ${bar ? 'Masquer les étapes' : 'Afficher les étapes'}</button>
            <button type="button" @click=${(/** @type {Event} */ e) => { this.#closeMenu(e); /** @type {any} */ (this.renderRoot.querySelector('ma-grid'))?.resetLayout?.(); }}>${icon('arrows-collapse')} Remettre la mise en page</button>
            <button type="button" class="replay" @click=${(/** @type {Event} */ e) => { this.#closeMenu(e); this.#replay(); }}>${icon('arrow-counterclockwise')} Rejouer</button>
          </div>
        </details>
      </div>
      <p class="visually-hidden" role="status">${this._said}</p>
      <div class="body">${repeat([app.generation], g => g, () => drawn
        ? html`<div class="start-host">${startScreen(app.startSpec(step))}</div>`
        : html`<ma-grid .app=${app} .c=${c} .path=${app.path}></ma-grid>`)}</div>
      <dialog class="ask" aria-labelledby="ask-title" aria-describedby="ask-text">
        <form method="dialog">
          ${asking?.kind === 'leave'
            ? html`<h2 id="ask-title">${fr(m.exit.label)} ?</h2><p id="ask-text">${fr(asking.text)}</p>
              <div class="row"><button value="no" type="submit" autofocus>Rester</button><button class="primary" value="yes" type="submit">Quitter</button></div>`
            : html`<h2 id="ask-title">${fr('Rejouer : tout recommencer depuis le début ?')}</h2>
              <p id="ask-text">Les données de cette partie seront effacées. Vos plantes, vos favoris et vos lieux restent.</p>
              <div class="row"><button value="no" type="submit" autofocus>Annuler</button><button class="danger" value="yes" type="submit">${icon('arrow-counterclockwise')} Rejouer</button></div>`}
        </form>
      </dialog>`;
  }
}

customElements.define('gf-miniapp', GfMiniapp);
