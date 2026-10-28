// @ts-check
import { LitElement, html, css, nothing } from 'lit';
import { floreHref, floreName, tabHref } from '../core/context.js';
import { MediaController, PHONE_QUERY } from '../core/media.js';
import { href, isStart, RouterController } from '../core/router.js';
import { setMode, store, StoreController, whenReady } from '../core/store.js';
import { backupContents, downloadBackup, exportGeoJSON, readBackup, restorePending } from '../core/collections.js';
import './gf-flora.js';
import './gf-tabbar.js';
import './gf-mode-switch.js';
import './gf-scenarios.js';
import './gf-launcher.js';
import { discoverEvents, markAnnounced, pendingUnlocks, tabShown, UNLOCKS } from '../core/discover.js';
import { modalOpen, openView, replaceView } from '../core/history.js';
import { ui } from '../styles/ui.js';
import { icon } from '../core/icons.js';

/**
 * The screens other than Flore and Découvrir, each loaded the first time it shows: the start of the app — the search —
 * loads a third less code. A screen is drawn only once its module is there (its element upgraded before it gets its
 * properties, as when it was loaded with the app). All precached by the service worker: offline they come as fast.
 * @type {Record<string, () => Promise<unknown>>}
 */
const SCREENS = {
  map: () => import('./gf-map-page.js'),
  collections: () => import('./gf-collections.js'),
  shared: () => import('./gf-shared.js'),
  'spot-new': () => import('./gf-spot-editor.js'),
  spot: () => import('./gf-spot-editor.js'),
  settings: () => import('./gf-settings.js'),
  legal: () => import('./gf-legal.js'),
  app: () => import('../miniapp/gf-miniapp.js'),
  layout: () => import('../layout/gf-layout.js'),
  builder: () => import('../layout/gf-builder.js')
};
/**
 * « Noter ici » (gf-capture and what it brings: the plants, their alerts, the position…), out of the start: loaded once
 * the search is ready, while the app is idle — or at its first opening, if it comes sooner.
 * @type {Promise<unknown> | null}
 */
let captureModule = null;
const loadCapture = () => (captureModule ??= import('./gf-capture.js').catch(error => { captureModule = null; console.error(error); }));
whenReady().then(() => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => loadCapture(), { timeout: 3000 });
  else setTimeout(loadCapture, 500);
});

/**
 * The banner of IndexedDB that does not open (what to try, « Réparer le stockage »), loaded only then: never part of the
 * start. Until it has come (or if it cannot), the error's one line and « Recharger ».
 * @type {Promise<unknown> | null}
 */
let storageModule = null;
/** It could not be loaded: the one line is all there is (then announced). */
let storageModuleFailed = false;
const loadStorageError = () => (storageModule ??= import('./gf-storage-error.js').catch(error => { storageModuleFailed = true; console.error(error); }));

/**
 * The brief toast (core/toast.js), out of the start: loaded the first time a tab that came is to be announced (the
 * first steps only), then kept.
 * @type {Promise<typeof import('../core/toast.js') | void> | null}
 */
let toastModule = null;
/** @type {typeof import('../core/toast.js') | null} */
let toast = null;
const loadToast = () => (toastModule ??= import('../core/toast.js').then(m => { toast = m; return m; }, error => { toastModule = null; console.error(error); }));

/** How long the announcement of tabs that came shows (ms); with its « Voir » hovered or focused, until left. */
const ANNOUNCE_MS = 9000;
/** Shown less than this (ms) — another message took its place —, it is announced again once that one has gone. */
const ANNOUNCE_READ_MS = 2000;
/** Tab names joined as said: « Carte et Mes plantes ». */
const AND = new Intl.ListFormat('fr', { type: 'conjunction' });

/** The screens asked for, and those loaded. @type {Set<string>} */
const asked = new Set(), loaded = new Set();
/**
 * Whether a screen can be drawn now; if not, its module is asked for (once) and `then` runs when it has come (a
 * failure said in the console, asked again next time).
 * @param {string} name @param {() => void} then
 */
function screenReady(name, then) {
  if (!SCREENS[name] || loaded.has(name)) return true;
  if (!asked.has(name)) {
    asked.add(name);
    SCREENS[name]().then(() => { loaded.add(name); then(); }, error => { asked.delete(name); console.error(error); });
  }
  return false;
}

/** @param {string} name */
const tabOf = name => name === 'map' ? 'map' : name === 'discover' ? 'discover'
  : ['collections', 'spot', 'spot-new', 'shared'].includes(name) ? 'mine'
  : name === 'settings' || name === 'legal' || name === 'layout' || name === 'builder' ? 'more' : 'flore';

/** App shell: header + route outlet + (phone) bottom tab bar. */
export class GfApp extends LitElement {
  static styles = [ui, css`
    :host {
      display: grid;
      grid-template-rows: auto 1fr auto;
      /* The window's width, never a view's: a layout wider than the screen never makes the page scroll sideways. */
      grid-template-columns: minmax(0, 1fr);
      height: 100%;
    }
    /* Three parts: the sections (left), the logo (centred), the tools (right). */
    header {
      display: grid;
      grid-template-columns: minmax(max-content, 1fr) auto minmax(max-content, 1fr);
      align-items: center;
      gap: var(--gf-gap);
      padding: 6px 16px;
      background: var(--gf-surface);
      border-bottom: 1px solid var(--gf-border);
    }
    header .side { display: flex; align-items: center; gap: var(--gf-gap); min-width: 0; }
    header .side.end { justify-content: flex-end; }
    /* The logo: bigger, centred, in sight — and quiet (the accent, a light wordmark). */
    .brand {
      display: flex;
      align-items: center;
      gap: 9px;
      color: var(--gf-accent);
      text-decoration: none;
      white-space: nowrap;
      padding: 2px 10px 2px 4px;
      border-radius: var(--gf-radius-pill);
      transition: background 0.15s;
    }
    .brand:hover { background: var(--gf-accent-soft); }
    span.brand:hover { background: none; }
    /* A mini-app (#/app/…): alone on the screen, under its own bar — no header, no tab bar. */
    :host([boxed]) { grid-template-rows: minmax(0, 1fr); }
    .brand:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .brand img { width: 38px; height: 38px; filter: drop-shadow(0 1px 1px rgb(0 0 0 / 0.12)); }
    .brand span { font-size: 1.12rem; font-weight: 600; letter-spacing: 0.01em; }
    nav.tabs { flex: none; }
    nav.tabs a { color: var(--gf-text); text-decoration: none; white-space: nowrap; display: inline-flex; align-items: center; }
    /* The page's tab, on the accent: its contrasting text (the rule above outweighs the .segmented one of ui.js). */
    nav.tabs a[aria-current='page'] { color: var(--gf-accent-contrast); }
    /* A tab that came, lit while it is announced (first steps). */
    nav.tabs a.new { box-shadow: inset 0 0 0 2px var(--gf-warn); }
    .note, .mode { flex: none; }
    gf-map-page, gf-spot-editor, gf-collections, gf-shared, gf-flora, gf-miniapp, gf-launcher, gf-layout, gf-builder { flex: 1; min-height: 0; }
    /* Storage full: over everything (a plant's sheet covers the page on a phone), until closed. */
    .full { position: fixed; z-index: 1004; left: 50%; transform: translateX(-50%); top: calc(8px + env(safe-area-inset-top, 0px)); width: min(520px, calc(100vw - 24px));
      box-sizing: border-box; padding: 10px 14px; border-radius: 14px; background: var(--gf-surface); color: var(--gf-text); border: 2px solid var(--gf-danger); box-shadow: var(--gf-shadow); font-size: 0.9rem; }
    .full p { margin: 0 0 8px; }
    .full strong { color: var(--gf-danger); }
    .full div { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    .settings {
      flex: none;
      color: var(--gf-text-muted);
      text-decoration: none;
      font-size: 1.3rem;
      line-height: 1;
      padding: 4px;
    }
    main { position: relative; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
    gf-settings { flex: 1; min-height: 0; }
    .banner {
      padding: 8px 16px;
      font-size: 0.875rem;
      background: var(--gf-accent-soft);
    }
    .banner.error { color: var(--gf-danger); }
    .banner details { margin-top: 4px; color: var(--gf-text-muted); font-size: 0.8rem; overflow-wrap: anywhere; }

    /* Not much room: the logo alone, « Noter ici » as an icon. */
    @media (min-width: 700px) and (max-width: 1099px) { .brand span { display: none; } }
    @media (min-width: 700px) and (max-width: 899px) { .note .lbl { display: none; } .note { padding-inline: 10px; } }
    @media (max-width: 560px) {
      header { gap: 8px; padding: 6px 10px; }
      .brand img { width: 34px; height: 34px; }
      .brand span { font-size: 1.02rem; }
      nav.tabs a { padding: 4px 10px; }
    }
  `];

  #router = new RouterController(this);
  #store = new StoreController(this);
  #phone = new MediaController(this, PHONE_QUERY);

  #onDiscover = () => this.requestUpdate();

  /** The tabs announced now, lit in the bar and the header meanwhile. @type {string[]} */
  _lit = [];
  /** The announcement shown (core/toast.js), or null. @type {{ hide: () => void } | null} */
  #announcing = null;
  /** @type {any} */ #announceTimer = 0;
  /**
   * The tabs that came, looked at again in a moment: a screen drawn, a dialog closed (its step gone back: popstate), the
   * window shown again, the toast place let go. Throttled, not put off: the store's frequent renders never hold it back.
   */
  #announceSoon = () => {
    if (!this.#announceTimer) this.#announceTimer = setTimeout(() => { this.#announceTimer = 0; this.#announce(); }, 600);
  };

  connectedCallback() {
    super.connectedCallback();
    discoverEvents.addEventListener('change', this.#onDiscover);
    window.addEventListener('popstate', this.#announceSoon);
    document.addEventListener('visibilitychange', this.#announceSoon);
    toast?.toastEvents.addEventListener('free', this.#announceSoon);
    window.visualViewport?.addEventListener('resize', this.#onKeyboard);
    window.visualViewport?.addEventListener('scroll', this.#onKeyboard);
    window.addEventListener('fit-keyboard', this.#onKeyboard);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    discoverEvents.removeEventListener('change', this.#onDiscover);
    window.removeEventListener('popstate', this.#announceSoon);
    document.removeEventListener('visibilitychange', this.#announceSoon);
    toast?.toastEvents.removeEventListener('free', this.#announceSoon);
    clearTimeout(this.#announceTimer);
    this.#announceTimer = 0;
    window.visualViewport?.removeEventListener('resize', this.#onKeyboard);
    window.visualViewport?.removeEventListener('scroll', this.#onKeyboard);
    window.removeEventListener('fit-keyboard', this.#onKeyboard);
  }

  /**
   * The keyboard up while a parcours is walked (`data-fit-keyboard`, set by the Parcours' walk: app/miniapp/kit/ma-walk.js): the app over it, its bottom
   * (the search, the tab bar) right above the keys. Most browsers resize the page themselves (the walk asks for
   * interactive-widget=resizes-content); the others (Safari) leave the page under the keyboard: there, the app
   * takes the height that is left, and the page is not scrolled away. Elsewhere, the browser's own way.
   */
  #onKeyboard = () => {
    const vv = window.visualViewport;
    if (!vv) return;
    const typing = document.documentElement.hasAttribute('data-fit-keyboard') && Math.abs(vv.scale - 1) < 0.01 && innerHeight - vv.height > 80;
    const h = typing ? Math.round(vv.height) + 'px' : '';
    if (this.style.height !== h) this.style.height = h;
    if (typing && (scrollY || vv.offsetTop)) scrollTo(0, 0);
  };

  /**
   * « Noter ici » opened — the same dialog from everywhere (the header, the Carte's +, Mes plantes, a plant's sheet and
   * its map, a plant card, an activity's sheet: `open-capture`, its `plant` chosen already when it comes from a plant):
   * at once once its module is there (it is, past the first moments: loaded while idle), else as soon as it comes —
   * drawn first (its dialog), never opened half-made.
   * @param {any} [plant]
   */
  #openCapture(plant) {
    const c = /** @type {any} */ (this.renderRoot.querySelector('gf-capture'));
    if (!c) return;
    if (c.hasUpdated) { c.open({ plant }); return; }
    loadCapture().then(() => customElements.whenDefined('gf-capture')).then(() => c.updateComplete).then(() => { if (c.isConnected) c.open({ plant }); });
  }

  constructor() {
    super();
    // A plain Event (no detail): the list to choose from.
    this.addEventListener('open-capture', e => this.#openCapture(/** @type {CustomEvent} */ (e).detail?.plant));
    this.addEventListener('open-scenarios', () => /** @type {any} */ ([...this.renderRoot.querySelectorAll('gf-scenarios')].find(s => s.getClientRects().length))?.open());
  }

  render() {
    const route = this.#router.route;
    const tab = this.#tab(route);
    const { status, statusText, offline, updateReady, datasetDeferred, storageFull, restore } = this.#store.state;
    const phone = this.#phone.matches;
    // A mini-app: alone on the screen (its box has its own bar, its one way out).
    const boxed = route.name === 'app';
    const brand = html`<img src="assets/icons/icon.svg" alt="" /><span>GeoFlora</span>`;
    // Phone: a plant's sheet covers the header (gf-flora): out of reach until it closes; the tab bar stays.
    const covered = phone && route.name === 'plant';

    const page = boxed ? html`<main>
        ${updateReady ? html`<div class="banner" role="status">Nouvelle version de GeoFlora disponible.
          <button class="link" type="button" @click=${() => location.reload()}>Recharger</button></div>` : nothing}
        ${status === 'loading' ? html`<div class="banner over" role="status">${statusText || 'Chargement…'}</div>` : nothing}
        ${status === 'error' ? this.#errorBanner() : nothing}
        ${this.#outlet(route)}
      </main>` : html`
      <header ?inert=${covered}>
        <div class="side">${phone ? nothing : html`<nav class="tabs segmented" aria-label="Sections">
          <a href=${href.discover()} aria-current=${tab === 'discover' ? 'page' : 'false'}>Découvrir</a>
          ${tabShown('flore') ? html`<a class=${this._lit.includes('flore') ? 'new' : ''} href=${tabHref('flore')} aria-current=${route.name === 'search' || route.name === 'plant' ? 'page' : 'false'}>Flore</a>` : nothing}
          ${tabShown('map') ? html`<a class=${this._lit.includes('map') ? 'new' : ''} href=${tabHref('map')} aria-current=${route.name === 'map' ? 'page' : 'false'}>Carte</a>` : nothing}
          ${tabShown('mine') ? html`<a class=${this._lit.includes('mine') ? 'new' : ''} href=${tabHref('mine')} aria-current=${['collections', 'spot', 'spot-new', 'shared'].includes(route.name) ? 'page' : 'false'}>Mes plantes</a>` : nothing}
        </nav>`}</div>
        <a class="brand" href=${floreHref()} aria-label=${'GeoFlora — aller à ' + floreName()}>${brand}</a>
        <div class="side end">${phone ? html`<gf-scenarios class="phone-scenarios"></gf-scenarios>` : html`
        ${tabShown('flore') ? html`<gf-mode-switch class="mode" scope="toute l’application" value=${this.#store.state.mode}
          @mode-change=${e => setMode(e.detail.mode || 'standard')}></gf-mode-switch>` : nothing}
        ${tabShown('map') ? html`<button class="note primary" type="button" aria-label="Noter ici" @click=${() => this.#openCapture()}>${icon('plus-lg')}<span class="lbl"> Noter ici</span></button>` : nothing}
        <gf-scenarios></gf-scenarios>
        <a class="settings" href=${href.settings()} title="À propos et réglages" aria-label="À propos et réglages">${icon('gear')}</a>`}</div>
      </header>
      <main>
        ${updateReady ? html`<div class="banner" role="status">Nouvelle version de GeoFlora disponible.
          <button class="link" type="button" @click=${() => location.reload()}>Recharger</button></div>` : nothing}
        ${status === 'loading' ? html`<div class="banner" role="status">${statusText || 'Chargement…'}</div>` : nothing}
        ${status === 'error' ? this.#errorBanner() : nothing}
        ${restore && !restore.closed ? this.#restoreBanner(restore) : nothing}
        ${offline && status === 'ready' && route.name === 'search' ? html`<div class="banner">Hors ligne — recherche sur la copie locale.</div>`
          : datasetDeferred && status === 'ready' && route.name === 'search' ? html`<div class="banner" role="status">Mise à jour de la flore reportée — recherche sur la copie locale.</div>` : nothing}
        ${this.#outlet(route)}
      </main>
      ${phone ? html`<gf-tabbar current=${tab} .lit=${this._lit}></gf-tabbar>` : html`<span></span>`}
      ${storageFull && status !== 'error' ? html`<div class="full" role="alert">
        <p><strong>Espace de stockage plein</strong> : GeoFlora n’a pas pu enregistrer une modification sur cet appareil.
          Exportez vos plantes pour ne rien perdre, puis libérez de l’espace (fichiers, applications, données d’autres sites) et rechargez la page.</p>
        <div><button class="primary" type="button" @click=${() => exportGeoJSON().catch(error => console.error(error))}>Exporter mes plantes</button>
          <button class="link" type="button" @click=${() => store.set({ storageFull: false })}>Fermer</button></div></div>` : nothing}
    `;
    // « Noter ici » after either: one element for the whole app, kept on entering or leaving an activity (its toast never
    // cut short), which an activity's sheet opens too.
    return html`${page}<gf-capture></gf-capture>`;
  }

  willUpdate() {
    const route = this.#router.route;
    this.toggleAttribute('boxed', route.name === 'app');
    // Nothing over an activity: an announcement read (2 s) is done, else it waits for the way out.
    if (route.name === 'app') this.#announcing?.hide();
    // The start page during the first steps is Découvrir's list — the start alone (`#/`, router.js isStart): any other
    // Flore address has brought Flore (discover.js arrivedAt) — at its own address, so that an activity left
    // (« Quitter l’activité », back to here) finds the list again, even once Flore — the start page then — has come.
    if (route.name === 'search' && !tabShown('flore') && isStart(location.hash)) replaceView(href.discover());
  }

  updated() {
    this.toggleAttribute('phone', this.#phone.matches);
    this.#announceSoon();
  }

  /**
   * The tabs that came during the first steps (core/discover.js pendingUnlocks), announced once: on the first screen
   * outside an activity, the app ready, no dialog open, this window in sight (the other tabs of the browser show
   * nothing), the toast place free (a capture's « Annuler », a safety warning, a map's word first) — all in one toast,
   * said to screen readers, their tabs lit meanwhile. « Voir » for one tab that is not the screen's own (one come with
   * the address shown has none). Cut short by another message before it could be read: announced again once that one
   * has gone; else, or its « Voir » taken: announced, here and in the other tabs.
   */
  #announce() {
    if (this.#announcing || !this.isConnected) return;
    const tabs = pendingUnlocks();
    const route = this.#router.route;
    if (!tabs.length || route.name === 'app' || this.#store.state.status !== 'ready' || modalOpen() || document.visibilityState !== 'visible') return;
    // The toast's module, the first time (out of the start): looked at again once it has come.
    if (!toast) {
      loadToast().then(m => {
        if (!m || !this.isConnected) return;
        m.toastEvents.addEventListener('free', this.#announceSoon);
        this.#announceSoon();
      });
      return;
    }
    if (!toast.toastSlotFree()) return;
    const one = tabs.length === 1 ? tabs[0] : null;
    const words = one ? `Nouveau : ${UNLOCKS[one].label} — ${UNLOCKS[one].text}.` : `Nouveaux onglets : ${AND.format(tabs.map(t => UNLOCKS[t].label))}.`;
    const to = one && one !== this.#tab(route) ? (one === 'flore' ? floreHref() : one === 'mine' ? href.collections() : href.map()) : null;
    const phone = this.#phone.matches;
    const shown = Date.now();
    this.#announcing = toast.briefToast(words, {
      near: this.renderRoot.querySelector(phone ? 'gf-tabbar' : 'main'), at: phone ? 'above' : 'bottom', offset: phone ? 8 : 24,
      ms: ANNOUNCE_MS, weight: 1,
      action: to ? { label: 'Voir', run: () => { markAnnounced(tabs); openView(to); } } : null,
      onHide: () => {
        this.#announcing = null;
        this._lit = [];
        this.requestUpdate();
        if (Date.now() - shown >= ANNOUNCE_READ_MS) markAnnounced(tabs); else this.#announceSoon();
      }
    });
    if (this.#announcing) { this._lit = tabs; this.requestUpdate(); }
  }

  /** The tab of a view; the start page is « Découvrir » until Flore has come. @param {import('../core/router.js').Route} route */
  #tab(route) { return route.name === 'search' && !tabShown('flore') ? 'discover' : tabOf(route.name); }

  /**
   * The launch failed. IndexedDB that does not open: its own banner (gf-storage-error), once loaded; else, or until
   * then, the error's line and « Recharger » — and, a repair waiting for the flora, that nothing of the user's is lost.
   * While that banner loads, its line is no live region: the banner announces itself, once.
   */
  #errorBanner() {
    const { statusText, storageError } = this.#store.state;
    if (storageError && customElements.get('gf-storage-error')) return html`<gf-storage-error .problem=${storageError}></gf-storage-error>`;
    if (storageError && !storageModuleFailed) loadStorageError().then(() => this.requestUpdate());
    return html`<div class="banner error" role=${storageError && !storageModuleFailed ? nothing : 'alert'}>${statusText}
      ${restorePending() ? ' Vos plantes et vos notes sont gardées dans la copie de secours : elles reviendront dès que la flore aura pu être téléchargée.' : ''}
      <button class="link" type="button" @click=${() => location.reload()}>Recharger</button></div>`;
  }

  /**
   * After « Réparer le stockage » (or a base the browser emptied): what the backup copy gave back, in the words of the
   * repair's dialog — or that it did not, what to do, and the browser's words folded away (main.js restoreAfter).
   * @param {import('../core/store.js').RestoreOutcome} r
   */
  #restoreBanner(r) {
    const close = html`<button class="link" type="button" @click=${() => store.set({ restore: { ...r, closed: true } })}>Fermer</button>`;
    if (!r.done) {
      return html`<div class="banner error">
        <span role="alert">Vos plantes et vos notes n’ont pas pu être remises depuis la copie de secours de cet appareil. Elles y restent,
          gardées telles quelles : rechargez la page pour réessayer.</span>
        <button class="link" type="button" @click=${() => location.reload()}>Recharger</button>
        ${readBackup() ? html`<button class="link" type="button" @click=${() => downloadBackup()}>Télécharger la copie de secours</button>` : nothing}
        ${close}
        <details><summary>Détails techniques</summary><code>${r.error?.name || 'Erreur'}</code>${r.error?.message ? ` — ${r.error.message}` : ''}</details>
      </div>`;
    }
    const what = r.reason === 'lost' ? 'Le navigateur avait vidé le stockage de GeoFlora' : 'Stockage réparé';
    return html`<div class="banner" role="status">${r.contents
      ? `${what} : la copie de secours de cet appareil a remis ${backupContents(r.contents)}.`
      : `${what} : la copie de secours de cet appareil n’avait rien à remettre.`} ${close}</div>`;
  }

  /** Découvrir: the list of the activities (gf-launcher, as in Découvrir's dialog under the film icon). */
  #discover() { return html`<gf-launcher page></gf-launcher>`; }

  /** @param {import('../core/router.js').Route} route */
  #flora(route) { return html`<gf-flora .route=${route}></gf-flora>`; }

  /** @param {import('../core/router.js').Route} route */
  #outlet(route) {
    if (!screenReady(route.name, () => this.requestUpdate())) return html`<div class="banner loading-screen" role="status">Chargement…</div>`;
    switch (route.name) {
      case 'discover':
        document.title = 'Découvrir — GeoFlora';
        return this.#discover();
      case 'search':
      case 'plant':
        if (route.name === 'search' && !tabShown('flore')) return this.#discover();
        // One template for the list and a plant: Lit keeps the same gf-flora (its list, filters, scroll), only the route changes.
        return this.#flora(route);
      case 'map':
        return html`<gf-map-page .route=${route}></gf-map-page>`;
      case 'collections':
        return html`<gf-collections .route=${route}></gf-collections>`;
      case 'shared':
        document.title = 'Partage — GeoFlora';
        return html`<gf-shared .data=${route.data}></gf-shared>`;
      case 'spot-new':
        return html`<gf-spot-editor kind=${route.kind} plant-id=${route.plant ?? ''} .at=${route.at}></gf-spot-editor>`;
      case 'spot':
        return html`<gf-spot-editor spot-id=${route.id} add-plant=${route.add ?? ''} ?pick=${route.pick}></gf-spot-editor>`;
      case 'settings':
        document.title = 'Réglages — GeoFlora';
        return html`<gf-settings></gf-settings>`;
      case 'legal':
        return html`<gf-legal></gf-legal>`;
      case 'app':
        return html`<gf-miniapp .route=${route}></gf-miniapp>`;
      case 'builder':
        // « Créer une app » (app/layout/gf-builder.js): a grid or a model, then the free layout built on it, live.
        return html`<gf-builder .route=${route}></gf-builder>`;
      case 'layout':
        // « Disposition libre » (app/layout): its layout and its state in the address.
        return html`<gf-layout .route=${route}></gf-layout>`;
      default:
        return html`<div class="banner">Page introuvable. <a href=${floreHref()}>Aller à ${floreName()}</a></div>`;
    }
  }
}

customElements.define('gf-app', GfApp);
