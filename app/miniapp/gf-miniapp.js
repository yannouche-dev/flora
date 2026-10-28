// @ts-check
// The box of an activity (a mini-app, in the code: #/app/<id>[/<step>][?p=<plant>&v=<view>&m=<image>&fiche=1]): the
// activity alone on the screen — no header, no tab bar (gf-app) —, under a bar of 48 px: « × Quitter l’activité » (the
// one way out), its title, its steps (ma-steps, when « Afficher les étapes » says so), the film icon (Découvrir over
// it), and ⋯: show or hide its steps (for this activity alone: runtime.js#setOwnSteps; not while it draws a steps bar
// of its own), the layout back to its own, « Recommencer ».
//  - Its manifest is loaded when it opens (app/miniapps/index.js), checked against the kit, and run (runtime.js).
//  - The address is the whole screen, and the screen follows the address (a link, a reload, Back, Forward): the step,
//    and the context's keys the app has — ?p= its `focus`, &v= its `view`, &m= its `mediaAt`, &fiche=1 its `sheet`
//    (router.js, AppRoute). Each change of the context writes the address, once (the address applied to the context
//    writes nothing back: no loop). A step reached is a new entry (Back returns to the one before), a step an app
//    ported whole says it is on replaces the address (Back leaves it, as before); another plant (?p=) is a new entry
//    too — Back returns to the plant before —, and so is a sheet opened (Back closes it); the rest (the view, the
//    image, a sheet closed) replaces the address.
//  - A plant opened or closed by a component (the event ma-plant): Rencontres (the plant chosen, kit/around.js), the
//    plant chosen and its sheet open, or its sheet closed (the plant stays chosen); the others, the plant open (?p=:
//    its sheet), or closed — back to the entry it was opened from. Over a start screen, the plant of a link (?p=)
//    shows in a sheet of its own (ma-plant-sheet).
//  - The way out: exit.confirm(c) asks first if it says something; then back to where it was opened from (else Flore
//    as it was left: context.js floreHref). An activity launched from another (Découvrir over its box: its film icon, « Autres activités »)
//    takes that one's starting point, so « Quitter » leaves both; Back still returns to it. Doing or leaving it
//    changes nothing else in the app (no mode, no setting, no layout of the sheet).
//  - The plants seen in it (the event `seen` of the runtime: a card swiped, a plant opened, chosen or noted), in any
//    activity: counted for the first steps of the app (core/discover.js#plantSeen: Flore comes after a few).
//  - « Recommencer » asks first, in a dialog; then what the app owns is emptied (runtime.js#replay), here and in the
//    other tabs (core/sync.js), and it starts again at its first step.

import { LitElement, html, css, nothing, repeat } from 'lit';
import { backTo, closeTo, depth, entryValue, markEntry, openModal, pushHash, replaceHash, sheetMark } from '../core/history.js';
import { href } from '../core/router.js';
import { floreHref, floreName } from '../core/context.js';
import { StoreController } from '../core/store.js';
import { plantSeen } from '../core/discover.js';
import { subscribe } from '../core/sync.js';
import { icon } from '../core/icons.js';
import { ui } from '../styles/ui.js';
import { askStyles, replayQuestion } from '../components/ui-kit.js';
import { startScreen, startStyles } from '../components/start-screen.js';
import { fr } from '../core/fr.js';
import '../components/gf-scenarios.js';
import { miniApp } from '../miniapps/index.js';
import { madeByApp } from '../core/collections.js';
import { kitProblems } from './define.js';
import { kit } from './kit.js';
import { MiniApp, replayItems } from './runtime.js';
import './ma-grid.js';
import './ma-steps.js';
import './kit/ma-plant-sheet.js';
import { quietLinks } from './quiet-links.js';

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

  static styles = [ui, startStyles, askStyles, css`
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
    /* Its scope said on screen (a touch screen shows no tooltip): under its label. */
    .menu .own span { display: grid; }
    .menu .own small { font-size: 0.78rem; font-weight: 400; color: var(--gf-text-muted); }
    gf-scenarios { flex: none; }
    .body { position: relative; min-height: 0; overflow: hidden; container-type: inline-size; }
    .body > ma-grid { height: 100%; }
    .start-host { height: 100%; overflow-y: auto; }
    .missing { padding: 24px 16px; }
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
    /** @type {import('../core/router.js').AppRoute | null} */
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
    // « Autres activités » of a component: Découvrir, over the box.
    this.addEventListener('open-scenarios', e => {
      e.stopPropagation();
      this.#scenarios();
    });
    // « Recommencer » this app, from Découvrir over it (confirmed there): started again, at its first step.
    this.addEventListener('ma-replay', e => {
      e.stopPropagation();
      if (/** @type {CustomEvent} */ (e).detail?.id !== this._app?.m.id) return;
      /** @type {any} */ (this.renderRoot.querySelector('ma-grid'))?.resetLayout?.();
      this._app?.replay();
    });
    // A plant opened by a component (detail.id), or closed (null).
    this.addEventListener('ma-plant', e => {
      e.stopPropagation();
      this.#plant(/** @type {CustomEvent} */ (e).detail?.id ?? null);
    });
  }

  #scenarios = () => { /** @type {any} */ (this.renderRoot.querySelector('gf-scenarios'))?.open(); };

  /**
   * A plant opened by a component, or closed (null). Rencontres: the plant chosen, its sheet open — or its sheet
   * closed, the plant still chosen. The others: the plant open (its sheet). Closed: back to the entry it was opened
   * from (kept in the entries: gfSheetFrom, core/history.js), past the plants its sheet went through; opened by a link:
   * the address without it.
   * @param {number | null} id
   */
  #plant(id) {
    const app = this._app;
    if (!app || !('focus' in app.m.context)) return;
    const chooses = 'sheet' in app.m.context;
    if (id == null) {
      // Back to the screen it was opened from, past the plants its sheet went through (Rencontres: the plant last shown
      // stays chosen); opened by a link: closed in place (the address without it), no entry added.
      const shut = chooses ? { sheet: false } : { focus: null, mediaAt: null };
      closeTo(sheetMark('gfSheetFrom', () => null), this.#href({ ...app.c, ...shut }),
        { instead: () => { app.set(shut); markEntry({ gfSheetFrom: null }); } });
      return;
    }
    app.set({ focus: id, ...(app.c.focus !== id ? { mediaAt: null } : {}), ...(chooses ? { sheet: true } : {}) });
  }

  /**
   * The depth of the entry it was opened from, or the one the activity it was launched from had (Quitter goes back to
   * it); null: nothing behind (Flore as it was left then). @type {number | null}
   */
  #from = null;
  /** @type {(() => void) | null} */ #unsync = null;
  #loading = '';

  connectedCallback() {
    super.connectedCallback();
    // No way out to another site from inside (but the credits a licence asks for).
    quietLinks(this);
    // « Recommencer » in another tab: emptied here too.
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
    if (this._app) { this._app.showSteps = this.#store.state.showSteps; this._app.view = this.#store.state.mode; }
    if (changed.has('route')) {
      if (this._app?.m.id === route.id) this.#follow();
      else if (this.#loading !== route.id) this.#open(route.id);
    }
  }

  /** The activity `id` opened: its manifest loaded and checked, run. @param {string} id */
  async #open(id) {
    this.#drop();
    this.#loading = id;
    this._error = null;
    const entry = miniApp(id);
    if (!entry) { this._error = 'Cette activité n’existe pas (ou plus).'; this.#loading = ''; return; }
    try {
      const m = (await entry.load()).default;
      const problems = kitProblems(m, kit);
      if (problems.length) throw new Error(`mini-app ${id}: ${problems.join('; ')}`);
      if (this.#loading !== id) return;
      const app = new MiniApp(m, { showSteps: this.#store.state.showSteps });
      app.view = this.#store.state.mode;
      app.addEventListener('change', this.#onChange);
      app.addEventListener('navigate', this.#onNavigate);
      app.addEventListener('exit', this.#onExit);
      app.addEventListener('scenarios', this.#scenarios);
      app.addEventListener('seen', this.#onSeen);
      // Where it was opened from: kept in the entry (a reload, Back and Forward find it again), or handed on by the
      // activity it was launched from (gf-launcher; null too: that one had nothing behind it).
      const kept = entryValue('gfAppFrom');
      this.#from = kept === null || typeof kept === 'number' ? kept : depth() > 0 ? depth() - 1 : null;
      markEntry({ gfAppFrom: this.#from });
      this._app = app;
      document.title = m.title + ' — GeoFlora';
      this.#follow(true);
    } catch (error) {
      console.error(error);
      this._error = 'Cette activité n’a pas pu s’ouvrir.';
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
    app.removeEventListener('scenarios', this.#scenarios);
    app.removeEventListener('seen', this.#onSeen);
    app.dispose();
    this._app = null;
  }

  /** The address being applied to the context: what it changes is not written back (no loop, no new entry). */
  #following = false;

  /**
   * The address followed (a link, a reload, Back, Forward): its step, and the context's keys it carries (?p=, &v=,
   * &m=, &fiche=1). `opening`: the app just opened — an address with no plant keeps the plant chosen with the game
   * (Rencontres: « Continuer » finds it), and writes it. @param {boolean} [opening]
   */
  #follow(opening = false) {
    const app = this._app, route = this.route;
    if (!app || !route) return;
    const ctx = app.m.context;
    /** @type {Record<string, unknown>} */
    const patch = {};
    if ('focus' in ctx && !(opening && route.plant == null && ctx.focus.persist)) patch.focus = route.plant;
    if ('view' in ctx) patch.view = route.view ?? null;
    if ('mediaAt' in ctx) patch.mediaAt = route.media ?? null;
    if ('sheet' in ctx) patch.sheet = Boolean(route.sheet);
    this.#following = true;
    try { app.set(patch); } finally { this.#following = false; }
    // An app ported whole leads its own steps: the address only says them.
    // (The step of the address meanwhile, until it says its own: the bar does not jump back to the start.)
    if (app.m.driven) { if (!route.step || !app.reached(route.step)) this.#syncUrl(); return; }
    // No step named: the game under way, if the manifest says where (resumeAt), else the start. A step that may not be
    // entered now (a link, a reload): the start, with no error.
    const step = route.step ?? app.m.resumeAt?.(app.c) ?? null;
    if (!app.follow(step)) { app.follow(null); this.#syncUrl(); }
    else if (!route.step || opening) this.#syncUrl();
  }

  /**
   * The address of the screen now (or with the context `c`): its step and the context's keys the address carries
   * (router.js, AppRoute). @param {Record<string, any>} [c]
   */
  #href(c = /** @type {MiniApp} */ (this._app).c) {
    const app = /** @type {MiniApp} */ (this._app);
    const ctx = app.m.context;
    const num = (/** @type {unknown} */ v) => typeof v === 'number' ? v : null;
    // Rencontres' start screen shows no plant: the one kept with the game is not in its address (unless its sheet is
    // open over it: a link).
    const shown = !('sheet' in ctx) || c.sheet === true || app.step.kind !== 'start';
    return href.app(app.m.id, app.step.id, 'focus' in ctx && shown ? num(c.focus) : null, {
      view: 'view' in ctx && typeof c.view === 'string' ? c.view : null,
      media: 'mediaAt' in ctx ? num(c.mediaAt) : null,
      sheet: 'sheet' in ctx && c.sheet === true
    });
  }

  /** The address in step, without a new entry (old addresses of Découvrir too). */
  #syncUrl() {
    if (!this._app) return;
    const want = this.#href();
    if (location.hash !== want) replaceHash(want);
  }

  #onChange = () => {
    // The context changed in place: the address follows — another plant, or a sheet opened, a new entry (Back returns
    // to the plant before, or closes the sheet); the rest replaces it. The address being followed: nothing written
    // (it is the address). A step changed: #onNavigate does.
    const app = this._app;
    if (app && !this.#following && /^#\/app\/[^/?]+\/([^?]+)/.exec(location.hash)?.[1] === app.step.id) {
      const want = this.#href();
      if (location.hash !== want) {
        const now = new URLSearchParams(location.hash.split('?')[1] || ''), next = new URLSearchParams(want.split('?')[1] || '');
        const newPlant = next.has('p') && next.get('p') !== now.get('p');
        const sheetOpened = next.get('fiche') === '1' && now.get('fiche') !== '1';
        if (newPlant || sheetOpened) pushHash(want, { gfAppFrom: this.#from, ...this.#sheetCarry(want) });
        else replaceHash(want);
      }
    }
    this.requestUpdate();
  };

  /**
   * The sheet mark the entry of `want` carries, its sheet open: opened now (this entry is under it) or kept open (this
   * entry's mark goes on: « Suivante », ‹ ›, a step). @param {string} want
   */
  #sheetCarry(want) {
    const sheet = 'sheet' in /** @type {MiniApp} */ (this._app).m.context;
    const open = (/** @type {string} */ h) => { const p = new URLSearchParams(h.split('?')[1] || ''); return sheet ? p.get('fiche') === '1' : p.has('p'); };
    if (!open(want)) return {};
    return { gfSheetFrom: open(location.hash) ? sheetMark('gfSheetFrom', () => null) : { from: depth(), start: depth() + 1 } };
  }

  /** A plant seen in the activity: one more for the first steps of the app. @param {Event} e */
  #onSeen = e => { plantSeen(/** @type {CustomEvent} */ (e).detail); };

  #onNavigate = (/** @type {Event} */ e) => {
    const app = this._app;
    if (!app) return;
    const { replace } = /** @type {CustomEvent} */ (e).detail || {};
    const want = this.#href();
    if (location.hash !== want) { if (replace) replaceHash(want); else pushHash(want, { gfAppFrom: this.#from, ...this.#sheetCarry(want) }); }
    const at = app.path.length, all = app.m.steps.length;
    this._said = fr(`Étape ${at} sur ${all} : ${app.step.label}`);
  };

  #onExit = async () => {
    const app = this._app;
    if (!app) return;
    const text = app.m.exit.confirm?.(app.c);
    if (text && !(await this.#ask('leave', text))) return;
    app.flush();
    backTo(this.#from, floreHref());
  };

  /** « Recommencer », once confirmed. */
  async #replay() {
    const app = this._app;
    if (!app) return;
    // What will be deleted, said: what it made in Mes plantes (its favourites, its parcours), what it keeps of its own.
    const items = replayItems(app.m, await madeByApp(app.m.id).catch(() => ({ favorites: [], collections: [], kept: { favorites: 0, collections: 0 } })));
    if (!(await this.#ask('replay', '', items))) return;
    /** @type {any} */ (this.renderRoot.querySelector('ma-grid'))?.resetLayout?.();
    await this._app.replay();
  }

  /** The answer of a confirmation dialog. @type {((yes: boolean) => void) | null} */ #answer = null;
  /** @type {{ kind: 'replay' | 'leave', text: string, items?: { gone: string[], kept: string[] } } | null} */ _asking = null;

  /** Asks in a modal dialog (a step in history: Back says no). @param {'replay' | 'leave'} kind @param {string} [text] @param {{ gone: string[], kept: string[] }} [items] what « Recommencer » deletes, and keeps @returns {Promise<boolean>} */
  async #ask(kind, text = '', items = { gone: [], kept: [] }) {
    this._asking = { kind, text, items };
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
    if (this._error) return html`<div class="bar"><button class="quit" type="button" title="Fermer" aria-label="Fermer" @click=${() => backTo(this.#from, floreHref())}>${icon('x-lg')}<span class="lbl"> Fermer</span></button></div>
      <p class="missing" role="alert">${this._error} <a href=${floreHref()}>Aller à ${floreName()}</a></p>`;
    const app = this._app;
    if (!app) return html`<div class="bar"></div><p class="missing" role="status">Chargement…</p>`;
    const step = app.step, m = app.m;
    const c = app.c;
    const kind = step.kind ?? 'grid';
    const drawn = kind !== 'grid' && !(m.driven && kind === 'start');
    // Its own steps bar (Rencontres' guided way): the box's, and the ⋯ item that shows or hides it, left out.
    const own = this._ownBar || Boolean(m.ownBar?.(c, app));
    const bar = app.guided && !own;
    // Over a start screen, the plant of a link in a sheet of its own (Rencontres: when the address opens its sheet,
    // &fiche=1 — never the plant kept with the game), as the manifest shows a plant (plantSheet: Orchidées de
    // Mirabel's simple sheet).
    const focus = drawn && (!('sheet' in m.context) || c.sheet) && 'focus' in m.context && typeof c.focus === 'number' ? c.focus : null;
    const asking = this._asking;
    return html`<div class="bar">
        <button class="quit" type="button" title=${fr(m.exit.label)} aria-label=${fr(m.exit.label)} @click=${() => app.exit()}>${icon('x-lg')}<span class="lbl">${fr(m.exit.label)}</span></button>
        <span class="title">${icon(/** @type {any} */ (m.icon))}<span>${fr(m.title)}</span></span>
        ${bar ? html`<ma-steps .app=${app} .c=${c} .path=${app.path}></ma-steps>` : html`<span class="spacer"></span>`}
        <gf-scenarios></gf-scenarios>
        <details class="more" @keydown=${(/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') /** @type {HTMLDetailsElement} */ (e.currentTarget).removeAttribute('open'); }}>
          <summary aria-label="Plus d’options" title="Plus d’options">${icon('three-dots')}</summary>
          <div class="menu" role="group" aria-label="Options de ${fr(m.title)}">
            ${own ? nothing : html`<button type="button" class="own" @click=${(/** @type {Event} */ e) => { this.#closeMenu(e); app.setOwnSteps(!bar); }}>${icon(bar ? 'eye-slash' : 'list-ul')}
              <span>${bar ? 'Masquer les étapes' : 'Afficher les étapes'} <small>Pour cette activité seulement</small></span></button>`}
            <button type="button" @click=${(/** @type {Event} */ e) => { this.#closeMenu(e); /** @type {any} */ (this.renderRoot.querySelector('ma-grid'))?.resetLayout?.(); }}>${icon('arrows-collapse')} Remettre la mise en page</button>
            <button type="button" class="replay" @click=${(/** @type {Event} */ e) => { this.#closeMenu(e); this.#replay(); }}>${icon('arrow-counterclockwise')} Recommencer</button>
          </div>
        </details>
      </div>
      <p class="visually-hidden" role="status">${this._said}</p>
      <div class="body">${repeat([app.generation], g => g, () => drawn
        ? html`<div class="start-host">${startScreen(app.startSpec(step))}</div>`
        : html`<ma-grid .app=${app} .c=${c} .path=${app.path}></ma-grid>`)}
        ${focus != null ? html`<ma-plant-sheet .open=${focus} scoped ?simple=${m.plantSheet?.simple ?? false}></ma-plant-sheet>` : nothing}</div>
      <dialog class="ask" aria-labelledby="ask-title" aria-describedby="ask-text">
        <form method="dialog">
          ${asking?.kind === 'leave'
            ? html`<h2 id="ask-title">${fr(m.exit.label)} ?</h2><p id="ask-text">${fr(asking.text)}</p>
              <div class="row"><button value="no" type="submit" autofocus>Rester</button><button class="primary" value="yes" type="submit">Quitter</button></div>`
            : html`${replayQuestion(m.title, asking?.items ?? { gone: [], kept: [] }, 'ask')}
              <div class="row"><button value="no" type="submit" autofocus>Annuler</button><button class="danger" value="yes" type="submit">${icon('arrow-counterclockwise')} Recommencer</button></div>`}
        </form>
      </dialog>`;
  }
}

customElements.define('gf-miniapp', GfMiniapp);
