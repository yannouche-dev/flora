// @ts-check
import { html, nothing, repeat } from 'lit';
import { nameOf } from '../core/plants.js';
import { arrange, arrangedMode, closeKing, openKing } from '../core/store.js';
import { addedTo, getMembership, setInCollection, toggleFavorite } from '../core/collections.js';
import { context } from '../core/context.js';
import { recentFix } from '../core/geo.js';
import { href } from '../core/router.js';
import { share } from '../core/share.js';
import { baseOf, modeLabel } from '../core/modes.js';
import './gf-add-to.js';
import { confirmAsk } from './gf-ask.js';
import { ownWords } from './gf-map-options.js';
import { lookFor } from '../core/map-settings.js';
import { icon, modeIcon } from '../core/icons.js';
import './gf-mode-switch.js';
import {
  STYLES, SUBS, canBeEmpty, hidesEmpty, setHidesEmpty, isMap, isAddedMap, createMap, deleteMap, blockModuleName, blockOrder, blockStyle, blockTitle, isTitleShown, setBlockStyle, setTitleShown, createNote, deleteNote, isHidden, isNote, isSubHidden, renameBlock,
  foldedByHand, serviceOff, serviceOffNote, setBlockOrder, setHidden, setSubHidden, setSubOrder, subOrder, subTitle,
  isOnEdge, placeOf, orderByCategory, treeOf, paneOf, dockBlock, toSheet, setPaneSizes, setStackState, isCustom, isLocked, isSubLocked, resetBlocks
} from '../core/sheet-blocks.js';
import { mapConfig, setMapConfig } from '../core/sheet-layout.js';
import { leaves as paneLeaves, stackOf, setSizes as treeSizes, patchStack, dock, undock } from '../core/pane-tree.js';
import { pressDock } from '../core/dock-drag.js';
import { shareGrip } from '../core/split-grip.js';
import { CATEGORIES, blockCategory, categoryOf } from '../core/categories.js';
import { isFocused } from '../core/map-focus.js';
import { reasonLine } from '../core/danger.js';
import './gf-sortable-list.js';
import { registerWebPane, unregisterWebPane } from '../core/web-pane.js';
import { verdictOf } from '../core/alerts.js';
import { sheetSession, setAnchorLock } from '../core/sheet-session.js';
import { SheetBase, KEEP_MAX_MS, WIKI_THEMES } from './sheet-base.js';
import { sheetStyles } from './sheet-styles.js';
import './gf-sheet-block.js';

/** A block not moved: the layout would have too many panes nested to be exported and read back (pane-tree.js dock). */
const TOO_DEEP = 'pas déplacé, trop de panneaux imbriqués';

/** Everything arrived: the place is kept until the sheet has not grown for this long (ms). */
const KEEP_QUIET_MS = 700;
/** All the rubrics stacked above and below (« full ») when that leaves this share of the sheet to read; back to one at the top under the lower share (no flip for a few pixels: a phone's address bar). */
const STACK_ENTER = 0.62;
const STACK_LEAVE = 0.57;

export class GfPlantDetail extends SheetBase {
  static properties = {
    /** « Ma région » of the sheet's maps (told by them: `map-region`), offered in a map's ⚙ only when known. */
    _mapRegion: { state: true },
    /** Shown in the Flore tab's plant pane: compact padding, the pane has its own close / back controls. */
    embedded: { type: Boolean, reflect: true },
    /** The plant waiting under the swiped card (Flore): not the page's plant yet, so it leaves the title alone. */
    preview: { type: Boolean },
    /**
     * Opened in an activity, alone on the screen: no action leading out of it (Carte); « Noter ici » opens its dialog
     * over it (gf-capture, the address unchanged).
     */
    scoped: { type: Boolean },
    /** The panes of the tree only, not the sheet (Découvrir: the panes its steps add, beside the cards). */
    panesOnly: { type: Boolean, attribute: 'panes-only' },
    /** Panes only: the blocks shown in them (Découvrir: those its steps added), the others left out. */
    paneKeys: { attribute: false },
    /**
     * A tree of panes of the host's own (Rencontres' guided way: the panes its steps built), shown in place of the
     * mode's: what is done to it (a grip dragged, a tab, a fold, a block moved, a pane made bigger) never touches the
     * mode's layout (sheetLayout), nor the pane the next sheet makes bigger — the tree changed comes back to the host as
     * `pane-sizes` (detail: the new tree; not composed), for it to keep and hand back. A block it puts in a pane shows
     * whatever the mode folds (its service off still folds it).
     */
    tree: { attribute: false },
    /**
     * The host's sheet (`flore`, `collections`): « Personnaliser la fiche » (its crown, at the end of the action bar)
     * opens there only — never on a card underneath, panes alone, a host's own tree, an activity (a block alone is
     * gf-sheet-block).
     */
    sheet: {},
    /** The block shown in the pane beside this sheet (Flore): only a line here, not twice. */
    inPane: { attribute: false },
    /** The plant's verdict (core/danger.js, read by alerts.js): the Alertes rubric's badge, its count and colour. */
    _verdict: { state: true },
    /** The sheet is wide enough for its panes beside it (else bands above and under it). */
    /** The edge shown over the whole plant pane for now (Échap or its button puts it back). */
    _maxEdge: { state: true },
    /** Said to screen readers: the last move of a block (King). */
    _said: { state: true },
    /** The safety block whose padlock was touched: why it is always shown, written under its title. */
    _lockTip: { state: true },
    /** The sheet is wide enough for columns on its left and right edges (else they are bands at the top). */
    _wideSheet: { state: true },
    _shareNote: { state: true },
    _dragKey: { state: true },
    _dragOrder: { state: true },
    _dragY: { state: true },
    _renaming: { state: true },
    _subsOpen: { state: true },
    _mapsOpen: { state: true },
    _newNote: { state: true },
  };

  static styles = sheetStyles;

  constructor() {
    super();
    /** @type {import('../core/territory.js').MapRegion | null} */
    this._mapRegion = null;
    /** @type {string | null} */
    this._shareNote = null;
    /** @type {string | null} */
    this.sheet = null;
    this.preview = false;
    this.scoped = false;
    /** Block being dragged, and the order shown meanwhile (else the saved one). @type {string | null} */
    this._dragKey = null;
    /** @type {string[] | null} */
    this._dragOrder = null;
    this._dragY = 0;
    /** King: the block being renamed, the blocks showing their sub-blocks list, naming a new note block. @type {string | null} */
    this._renaming = null;
    // Panels opened on the previous plant stay open on this one (sheet-session.js).
    /** @type {Set<string>} */
    this._subsOpen = sheetSession.subsOpen;
    /** King: the map blocks showing their settings. @type {Set<string>} */
    this._mapsOpen = sheetSession.mapsOpen;
    /** @type {string | null} */
    this._maxEdge = sheetSession.maxEdge;
    this._said = '';
    /** @type {string | null} */
    this._lockTip = null;
    /** @type {import('../core/danger.js').Verdict | null} */
    this._verdict = null;
    this.panesOnly = false;
    /** @type {string[] | null} */
    this.paneKeys = null;
    /** @type {import('../core/pane-tree.js').PaneNode | null} */
    this.tree = null;
    this._newNote = false;
  }

  /** The sheet's height, for the dock (pinned blocks) to fill it — and how its rubrics stack (#stackMode). */
  #resize = new ResizeObserver(([entry]) => {
    this.style.setProperty('--host-h', Math.round(entry.contentRect.height + this.#padY()) + 'px');
    const wide = entry.contentRect.width >= 640;
    if (wide !== this._wideSheet) this._wideSheet = wide;
    this.#stackMode();
  });

  #padY() {
    const cs = getComputedStyle(this);
    return parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  }

  connectedCallback() {
    super.connectedCallback();
    this.#resize.observe(this);
    // The hand (wheel, touch, keys, pointer): a place kept for a moment lets go at once; where the sheet stops,
    // once the hand has moved it, is noted for the next plant (#noteRead) — nothing is computed while it scrolls.
    for (const ev of ['wheel', 'touchstart', 'keydown', 'pointerdown']) this.addEventListener(ev, this.#onHand, { passive: true, capture: true });
    for (const ev of ['touchend', 'touchcancel', 'pointerup', 'pointercancel']) window.addEventListener(ev, this.#onLift, { passive: true, capture: true });
    // A control stuck in place (a header of the stacks, a block's title, the action bar) focused: already in view.
    this.renderRoot.addEventListener('focusin', this.#onFocusIn, true);
    // The sheet scrolls itself, or its middle when edges are used (scroll does not bubble: caught on the way down).
    this.renderRoot.addEventListener('scroll', this.#onScroll, { passive: true, capture: true });
    this.addEventListener('scroll', this.#onScroll, { passive: true });
    // The media's controls drawn in its pane's header follow the viewer.
    this.renderRoot.addEventListener('media-bar', () => this.requestUpdate());
    this.renderRoot.addEventListener('map-region', this.#onMapRegion);
    this.addEventListener('keydown', this.#onEdgeKey);
    // A menu (position, edge options) closes when touching elsewhere.
    this.renderRoot.addEventListener('pointerdown', this.#closeMenus, { capture: true });
  }

  /**
   * A control stuck in place focused (a header of the stacks, a block's title and its tools, the theme's title, the
   * action bar): it is in view already, but the browser counts the stuck margins and scrolls the sheet to « show »
   * it — again at each Tab. That scroll is undone. @param {Event} e
   */
  #onFocusIn = e => {
    const el = /** @type {Element} */ (e.composedPath()[0]);
    const pre = this.#preFocus;
    this.#preFocus = null;
    if (!(el instanceof Element) || this.#appFocus) return;
    const stuck = el.closest('.rub-head, .block-title, .wiki-theme > summary, .action-bar, .king-bar');
    const scroller = this.#sheetScroller, now = scroller.scrollTop;
    // Where it was: noted at the key or pointer down; else where its last scroll left it (the browser's own scroll
    // to the focus has not been told yet).
    const was = pre && performance.now() - pre.at < 300 ? pre.st : this.#lastTop;
    if (!stuck || was === null || Math.abs(now - was) <= 1) return;
    // The browser has already scrolled (before this event): back where the sheet was, if the control was seen
    // there — in the sheet, not under something else stuck. Else (out of view) the browser's scroll stays.
    scroller.scrollTop = was;
    const r = el.getBoundingClientRect(), s = scroller.getBoundingClientRect();
    const hit = r.height && r.top >= s.top && r.bottom <= s.bottom ? /** @type {any} */ (this.renderRoot).elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    if (!hit || !stuck.contains(hit)) scroller.scrollTop = now;
  };
  /** Where the sheet was when a key or a pointer went down (before the browser scrolls to what gets the focus), until it scrolls otherwise (#onScroll). @type {{ st: number, at: number } | null} */
  #preFocus = null;
  /** Where the sheet's last scroll left it (or the app, at once). @type {number | null} */
  #lastTop = null;
  /** The app gives the focus itself (without scrolling): nothing to undo. */
  #appFocus = false;

  /** @param {Event} e */
  #closeMenus = e => {
    const path = e.composedPath();
    for (const d of /** @type {NodeListOf<HTMLDetailsElement>} */ (this.renderRoot.querySelectorAll('details.place-pick[open], details.edge-opts[open]'))) {
      if (!path.includes(d)) d.removeAttribute('open');
    }
  };

  /** Échap: an edge shown over the pane goes back. @param {KeyboardEvent} e */
  #onEdgeKey = e => {
    if (e.key !== 'Escape') return;
    const open = this.renderRoot.querySelector('details.edge-opts[open], details.place-pick[open]');
    if (open) { e.stopPropagation(); open.removeAttribute('open'); return; }
    if (this._maxEdge) { e.stopPropagation(); this._maxEdge = null; }
  };

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (changed.has('preview') && changed.get('preview') === true && !this.preview) this.#promoted = true;
    // Another view (the host's, or the one arranged here) or King opened or closed here reorders the sheet: the place
    // read now is reached again once drawn (#placeAgain).
    const king = this.#kingHere, view = this._view;
    const viewChanged = view !== this.#lastView;
    if (this.#placed && this._plant && !this.preview && !this.panesOnly && ((viewChanged && this.#lastView !== null) || king !== this.#king)) {
      const { cat, block, wiki } = this.#readPlace();
      if (cat || block) this.#rePlace = { cat, block, wiki };
    }
    this.#king = king;
    this.#lastView = view;
    // The panels opened follow to the next plant (not from a preview card, which is not read).
    if (!this.preview) {
      if (changed.has('_subsOpen')) sheetSession.subsOpen = this._subsOpen;
      if (changed.has('_mapsOpen')) sheetSession.mapsOpen = this._mapsOpen;
      // (A pane of a host's own tree made bigger is that host's: not the next sheet's.)
      if (changed.has('_maxEdge') && !this.tree) sheetSession.maxEdge = this._maxEdge;
      if (changed.has('_spotsOpen')) sheetSession.spotsOpen = this._spotsOpen;
      // The themes of the article opened or closed (not the sections read whole, which are this plant's).
      if (changed.has('_wikiOpen')) sheetSession.wikiThemes = new Set([...this._wikiOpen].filter(k => /^(theme|closed):/.test(k)));
    }
    super.willUpdate(changed);
    // The card underneath became the sheet.
    if (!changed.has('plantId') && changed.has('preview') && !this.preview) this.#title();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    for (const ev of ['touchend', 'touchcancel', 'pointerup', 'pointercancel']) window.removeEventListener(ev, this.#onLift, { capture: true });
    this.#touching = this.#buttonDown = false;
    unregisterWebPane(this);
    this.#resize.disconnect();
    this.#barSize.disconnect();
    this.#barSeen = null;
    this.#letGo();
    clearTimeout(this.#readTimer);
  }

  /** The page's title: this plant, unless it is only a preview, or in a free layout that has its own title (?title=). */
  #title() {
    const plant = this._plant;
    /** @type {Node | null} */
    let host = this;
    while (host && host.nodeName !== 'GF-LAYOUT') { const root = host.getRootNode(); host = root instanceof ShadowRoot ? root.host : null; }
    if (/** @type {any} */ (host)?.pageTitle) return;
    if (!this.preview && plant && !plant.failed) document.title = nameOf(plant) + ' — GeoFlora';
  }

  // ── SheetBase's hooks: what the sheet's layout changes in its blocks ─────────────────────────────────────────

  /** The card under a swiped one: a placeholder rather than a second map. */
  get _drawsMaps() { return !this.preview; }

  /** The panes alone (Découvrir): its « Médias » a showcase, photos first. */
  get _showcase() { return this.panesOnly; }

  /**
   * The panes alone (Rencontres' guided way): a map only when one of its panes holds one — none in the picking pane,
   * whose sosies' « Comparer sur la carte » would lead nowhere (plain text there, as in a block alone).
   */
  get _hasMap() {
    if (!this.panesOnly) return super._hasMap;
    return (this.paneKeys ?? blockOrder(this._view)).some((/** @type {string} */ k) => isMap(k) && Boolean(this._paneOf(k)));
  }

  /** A plant to read: the place read on the one before noted, nothing kept, nothing placed yet, no verdict. */
  _willLoad() {
    // The hand had just stopped on the previous plant: its place is noted now, before it goes.
    if (this.#readTimer) { clearTimeout(this.#readTimer); this.#readTimer = 0; if (this.#handAt && this._plant) this.#noteRead(); }
    this.#handAt = 0;
    this.#lastPlace = null;
    this._verdict = null;
    this.#letGo();
    this.#placed = false;
  }

  /** The plant read: the page's title, and its verdict (the Alertes rubric's badge). @param {any} plant @param {AbortSignal} signal */
  _loaded(plant, signal) {
    this.#title();
    verdictOf(plant).then(v => { if (!signal.aborted) this._verdict = v; }, () => {});
  }

  /** @param {any} plant */
  _safetyRetried(plant) {
    verdictOf(plant).then(v => { if (this._plant === plant) this._verdict = v; }, () => {});
  }

  /** A host's sheet, read as such: « Personnaliser la fiche » can open here (its crown). */
  get #crownable() { return Boolean(this.sheet) && !this.preview && !this.panesOnly && !this.tree && !this.scoped; }

  /** « Personnaliser la fiche » (code name: King) open on this sheet. */
  get #kingHere() { return this.#crownable && this._store.state.king?.sheet === this.sheet; }

  /**
   * The mode shown: the one arranged here while King is open (its bar), else the host's view. The card underneath
   * (Flore's next plant) is drawn and loaded in the mode arranged on its sheet too, without King's tools: on top, it
   * stays as it is. @returns {string}
   */
  get _view() {
    const arranged = this.#kingHere || (this.preview && this._store.state.king?.sheet === this.sheet && Boolean(this.sheet)
      && !this.panesOnly && !this.tree && !this.scoped);
    return arranged ? arrangedMode(/** @type {string} */ (this.sheet), this.view) : this.view;
  }

  /**
   * The action bar, docked at the bottom of the sheet (above the tab bar on a phone): the actions this view
   * shows, in its order. King shows them all, each with its ☑ (shown or not in this view), the actions inert meanwhile.
   * @param {any} plant
   */
  #actionBar(plant) {
    const v = this._view;
    const king = this.#kingHere, crown = this.#crownable;
    const fav = this._store.state.favorites.has(plant.id);
    const name = nameOf(plant);
    /** @type {Record<string, () => unknown>} */
    const buttons = {
      // A favourite with a note or a harvest log taken out: asked first, as « Ajouter à… » does (toggleFavorite).
      fav: () => html`<button type="button" class="fav" ?inert=${king} aria-pressed=${fav ? 'true' : 'false'} @click=${() => toggleFavorite(plant, undefined, confirmAsk)}>
        ${icon(fav ? 'heart-fill' : 'heart')}<span>Favori</span></button>`,
      addTo: () => html`<button type="button" ?inert=${king} @click=${() => /** @type {any} */ (this.renderRoot.querySelector('gf-add-to'))?.open()}>${icon('plus-lg')}<span>Ajouter à…</span></button>`,
      share: () => html`<button type="button" ?inert=${king} @click=${() => this.#share(plant, name)}>${icon('share')}<span>Partager</span></button>`,
      // The Carte filtered on this plant (its places, its GBIF distribution).
      map: () => html`<a class="button" ?inert=${king} href=${href.map({ plants: [plant.id] })}>${icon('map')}<span>Carte</span></a>`,
      // In one tap, into the collection or place last opened (context.js), when it is not there yet.
      addCurrent: () => {
        const current = this.#currentCollection(plant);
        if (!current) return king ? html`<button type="button" disabled title="Ouvrez une liste ou un lieu : vous y ajouterez d’un geste">${icon('plus-lg')}<span>Liste ou lieu en cours</span></button>` : nothing;
        return html`<button type="button" ?inert=${king} title=${'Ajouter à « ' + current.name + ' »'} @click=${() => this.#addCurrent(plant, current)}>
          ${icon(current.kind === 'place' ? 'geo-alt-fill' : 'plus-lg')}<span class="short">${current.name}</span></button>`;
      },
      // The one « Noter ici » (gf-capture), this plant chosen: over the page, an activity too.
      spot: () => html`<button type="button" ?inert=${king} @click=${() => this.#noteHere(plant)}>${icon('geo-alt-fill')}<span>Noter ici</span></button>`
    };
    const keys = subOrder(v, 'actions').filter(k => buttons[k] && !(this.scoped && k === 'map')
      && (king || (!isSubHidden(v, 'actions', k) && (k !== 'addCurrent' || this.#currentCollection(plant)))));
    if (!keys.length && !crown) return nothing;
    return html`<nav class="action-bar ${king ? 'king' : ''}" aria-label="Actions">
      ${this._shareNote ? html`<p class="share-note" role="status">${this._shareNote}</p>` : nothing}
      <div class="acts">${keys.map(k => {
        const off = isSubHidden(v, 'actions', k);
        return html`<span class="act ${off ? 'off' : ''}" data-key=${k}>
          ${buttons[k]()}
          ${king ? html`<label class="act-toggle" title=${off ? 'Afficher cette action dans ce mode' : 'Masquer cette action dans ce mode'}>
            <input type="checkbox" .checked=${!off} aria-label=${`« ${subTitle('actions', k)} » dans la barre d’actions`}
              @change=${e => setSubHidden(v, 'actions', k, !e.target.checked)} /></label>` : nothing}
        </span>`;
      })}${crown ? html`<span class="act crown"><button type="button" aria-pressed=${king ? 'true' : 'false'} aria-label="Personnaliser la fiche"
        title=${king ? 'Personnaliser la fiche : toucher pour terminer' : 'Personnaliser la fiche : ses blocs, leur ordre, ses panneaux, pour chaque mode'}
        @click=${() => { if (king) closeKing(); else openKing(/** @type {string} */ (this.sheet)); }}>${icon('crown')}</button></span>` : nothing}</div>
    </nav>`;
  }

  /** « Noter ici » with this plant chosen: the app's one dialog (gf-app opens gf-capture). @param {any} plant */
  #noteHere(plant) {
    this.dispatchEvent(new CustomEvent('open-capture', { bubbles: true, composed: true, detail: { plant } }));
  }

  /** The current collection or place (context.js), when this plant is not in it yet. @param {any} plant */
  #currentCollection(plant) {
    const id = context().collection;
    if (!id) return null;
    const summary = this._store.state.collections.find((/** @type {any} */ c) => c.id === id);
    if (!summary || (getMembership().byPlant.get(plant.id) || []).includes(id)) return null;
    return summary;
  }

  /**
   * Into the current list or lieu, in one tap: a lieu takes it at your position when you stand near it (a position from
   * the last minute), else at its point — said (addedTo). @param {any} plant @param {{ id: string, name: string, kind: string }} current
   */
  async #addCurrent(plant, current) {
    try {
      const fix = recentFix();
      this._shareNote = addedTo(await setInCollection(current.id, plant, true, fix), fix);
    } catch (error) {
      this._shareNote = 'Ajout impossible : ' + /** @type {Error} */ (error).message;
    }
    setTimeout(() => { this._shareNote = null; }, 3000);
  }

  /** @param {any} plant @param {string} name */
  async #share(plant, name) {
    const result = await share({ title: name + ' — GeoFlora', text: `${name} (${plant.scientificName})`, url: href.plant(plant.id) });
    this._shareNote = result === 'copied' ? 'Lien copié.' : null;
    if (this._shareNote) setTimeout(() => { this._shareNote = null; }, 2500);
  }

  render() {
    const plant = this._plant;
    if (plant === undefined) return html`<article><div class="skeleton"></div></article>`;
    if (plant?.failed) {
      return html`<article>
        ${this._heading('Impossible de lire la flore locale')}
        <p class="muted">${plant.failed}</p>
        <p><button class="primary" type="button" @click=${() => this._load(this.plantId)}>Réessayer</button></p>
      </article>`;
    }
    if (plant === null) {
      return html`<article>${this._heading('Plante introuvable')}</article>`;
    }

    const ctx = this._context(plant);
    // What a move did (King: « Déplacer vers… », a drag, « Par défaut »), said — in the panes alone too (Découvrir). The
    // region is there before its first message (one born with its text is seldom read out).
    const said = html`<p class="said visually-hidden" aria-live="polite">${this._said}</p>`;
    if (this.panesOnly) return html`${this.#panesOnlyView(ctx)}${said}`;
    return html`${baseOf(this._view) === 'epure' ? this.#epure(ctx) : this.#full(ctx)}${said}${this._paneDialogView(plant)}`;
  }

  /** The panes of the tree without the sheet (none yet: what the host slots in). @param {any} ctx */
  #panesOnlyView(ctx) {
    /** @param {any} n @returns {any} */
    const drop = n => {
      if (!n || n.t === 'sheet') return null;
      if (n.t === 'stack') {
        const keys = this.paneKeys;
        if (!keys) return n;
        const tabs = n.tabs.filter((/** @type {string} */ k) => keys.includes(k));
        return tabs.length ? { ...n, tabs } : null;
      }
      const kids = [], sizes = [];
      n.kids.forEach((/** @type {any} */ k, /** @type {number} */ i) => { const c = drop(k); if (c) { kids.push(c); sizes.push(n.sizes[i]); } });
      return !kids.length ? null : kids.length === 1 ? kids[0] : { ...n, kids, sizes };
    };
    const tree = drop(this.#shownNode(ctx, this.#tree()));
    if (!tree) return html`<slot></slot>`;
    if (this._wideSheet === false) {
      return html`<div class="frame edged narrow panes-only">${repeat(paneLeaves(tree), n => n.id, n => html`<div class="cell band-cell grow">${this.#pane(ctx, /** @type {any} */ (n), /** @type {any} */ (n).tabs, 'col')}</div>`)}</div>`;
    }
    return html`<div class="frame edged panes-only" data-drop-node="root">${this.#node(ctx, tree, nothing)}</div>`;
  }

  /** ⤢ and a photo touched open a block at full size (SheetBase#_openPane): not from the card underneath. */
  get _canOpenPane() { return !this.preview; }

  /** To a theme of the article (its anchor in the Wikipédia block): opened, then reached (#arrive). @param {string} t */
  async #wikiGo(t) {
    if (!this._wikiThemeOpen(t)) this._wikiOpen = new Set([...this._wikiOpen, 'theme:' + t]);
    await this.updateComplete;
    const el = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.blocks #wiki-' + t));
    if (el) { this.#arrive(el); return; }
    // The article in a pane: the theme brought to the top of its pane; the sheet does not move.
    const there = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.edge-body #wiki-' + t));
    const body = there?.closest('.edge-body');
    if (there && body) { body.scrollTop += there.getBoundingClientRect().top - body.getBoundingClientRect().top - 4; return; }
    // Not drawn yet: to the block itself.
    this.#goTo('wikipedia');
  }

  // ── Blocks: below the header, titled, the same in every view, in the order chosen for it ────────────────
  // Drag a block by its title (or ↑ ↓ on its grip); fold it away with its trash icon, bring it back with ↺.

  /** @param {any} ctx */
  #blocks(ctx) {
    // Blocks stuck to an edge are there, not in the flow.
    // Outside King, folded blocks are not there at all.
    // Outside it too, a block with nothing for this plant (no other name, no Wikipédia article).
    if (this.#kingHere) {
      // King arranges the blocks one by one: their plain list, each with its handle.
      const order = this._dragOrder || blockOrder(this._view);
      const sorting = Boolean(this._dragOrder);
      const keys = blockOrder(this._view).filter(k => !isOnEdge(this._view, k) && this.#visible(k, ctx));
      return html`${this.#palette()}<div class="blocks king ${sorting ? 'sorting' : ''}">${repeat(keys, k => k, k => this.#block(k, ctx, sorting ? order.indexOf(k) : null))}</div>
        ${sorting ? nothing : this.#newNote()}`;
    }
    // Read: the name, then the blocks gathered by rubric, each rubric under its header (#rubric).
    const rubrics = this.#rubrics(ctx);
    const name = !isOnEdge(this._view, 'name') && this.#visible('name', ctx) ? this.#plainBlock('name', ctx) : nothing;
    return html`<div class="blocks rubrics" style=${`--count:${rubrics.length}`}>${name}${repeat(rubrics, g => g.cat, (g, i) => this.#rubric(g, i, ctx))}</div>
      ${this.preview ? nothing : this.#toc(ctx)}`;
  }

  /**
   * The rubrics of the sheet in the mode's order — a rubric comes where its first block comes (the order of Mode
   * King within it) — each with the blocks it shows here and those it has in a pane. A rubric is there as soon as
   * the mode has a block for it, whatever the plant's data: the stack keeps its places from one plant to the next.
   * @param {any} ctx @returns {{ cat: string, keys: string[], pane: string[] }[]}
   */
  #rubrics(ctx) {
    /** @type {Map<string, { cat: string, keys: string[], pane: string[] }>} */
    const by = new Map();
    for (const k of blockOrder(this._view)) {
      if (k === 'name' || isHidden(this._view, k) || (k === 'web' && !this._paneOf('web'))) continue;
      const cat = blockCategory(k);
      const g = by.get(cat) || { cat, keys: [], pane: [] };
      by.set(cat, g);
      if (isOnEdge(this._view, k)) { if (this.#visible(k, ctx)) g.pane.push(k); }
      else if (this.#visible(k, ctx)) g.keys.push(k);
    }
    return [...by.values()];
  }

  /**
   * The badge of a rubric: on Alertes only, the plant's verdict (core/danger.js) — every reason counted, the confusions
   * too, in the colour of the gravest (as its chip on the cards); none when our sources say nothing.
   * @param {string} cat @returns {{ count: number, tone: string, text: string[] } | null}
   */
  #badge(cat) {
    const v = this._verdict;
    return cat === 'safety' && v?.reasons.length ? { count: v.reasons.length, tone: v.level, text: [v.word, ...v.reasons.map(reasonLine)] } : null;
  }

  /**
   * A rubric: its header, stuck while the rubric is read — stacked with the others above and below like the
   * filters' when there is room, else alone at the top, pushed by the next (#stackMode) — then its blocks. The
   * header says where the reading is: nothing is computed while scrolling.
   * @param {{ cat: string, keys: string[], pane: string[] }} g @param {number} i @param {any} ctx
   */
  #rubric(g, i, ctx) {
    const c = categoryOf(g.cat);
    const badge = this.#badge(g.cat);
    return html`<div class="rubric" data-cat=${g.cat} style=${`--stack:${i}`}>
      <i class="rub-mark" data-cat=${g.cat} aria-hidden="true"></i>
      <div class="rub-head">
        <button type="button" class="rub-go" title=${c.question + (badge ? '\n' + badge.text.join('\n') : '')}
          aria-label=${c.label + (badge ? ` — ${badge.count} alerte${badge.count > 1 ? 's' : ''}` : '')}
          @click=${() => this.#onRubric(g.cat)}><span class="rub-ic" aria-hidden="true">${icon(/** @type {any} */ (c.icon))}</span><span class="rub-label">${c.label}</span>${badge
            ? html`<span class="rub-badge ${badge.tone}" aria-hidden="true">${badge.count}</span>` : nothing}</button>
        ${this.preview ? nothing : html`<button type="button" class="rub-toc" aria-label="Sommaire de la fiche" title="Sommaire : les rubriques, leurs blocs, les thèmes de l’article"
          aria-haspopup="dialog" aria-controls="toc" aria-expanded="false" @click=${(/** @type {Event} */ e) => this.#openToc(e)}>${icon('list-ul')}</button>`}
      </div>
      ${repeat(g.keys, k => k, k => this.#plainBlock(k, ctx))}
      ${g.pane.length ? html`<p class="rub-note">${g.pane.map(k => blockTitle(k)).join(' · ')} : dans un panneau.
        <button type="button" class="link" @click=${() => this.#goTo(g.pane[0])}>Afficher</button></p>` : nothing}
      ${g.keys.length || g.pane.length ? nothing : html`<p class="rub-note">${this._loadingNow ? 'Chargement…' : 'Rien dans les sources consultées.'}</p>`}
    </div>`;
  }

  /** A touch on a rubric's header: to the rubric's start, in every stack (the ☰ beside it: the table of contents). @param {string} cat */
  #onRubric(cat) { this.goTo('rub:' + cat); }

  /**
   * The table of contents (a popover, over everything): every rubric, its blocks, the article's themes — a touch
   * goes there; and the padlock (every plant opens at the place read). @param {any} ctx
   */
  #toc(ctx) {
    const items = this.#tocItems(ctx);
    const lock = sheetSession.anchorLock;
    return html`<div class="toc" id="toc" popover tabindex="-1" role="dialog" aria-label="Sommaire de la fiche" @beforetoggle=${this.#onTocToggle} @keydown=${this.#onTocKey}>
      <div class="toc-head">${this.#entity ? html`<span class="entity">${this.#entity}</span>` : nothing}<b>Sommaire</b>
        <button type="button" class="icon-btn toc-lock" aria-pressed=${String(lock)}
          title=${lock ? 'Ancre verrouillée : chaque plante s’ouvre à la place lue — toucher pour déverrouiller' : 'Verrouiller l’ancre : chaque plante s’ouvrira à la place lue maintenant'}
          aria-label=${lock ? 'Déverrouiller l’ancre' : 'Verrouiller l’ancre'} @click=${() => { setAnchorLock(!lock); if (!lock) this.#noteRead(true); this.requestUpdate(); }}>${icon(lock ? 'lock-fill' : 'unlock')}</button></div>
      <ul>${items.map(c => html`<li>
        <button type="button" class="toc-rub" data-key=${'rub:' + c.key} @click=${() => this.#tocGo('rub:' + c.key)}>${icon(/** @type {any} */ (c.icon))}<span>${c.label}</span>${c.badge
          ? html`<span class="rub-badge ${c.badge.tone}">${c.badge.count}</span>` : nothing}</button>
        ${c.blocks.length > 1 || c.blocks.some(b => b.subs?.length || b.note) ? html`<ul>${c.blocks.map(b => html`<li>
          <button type="button" data-key=${b.key} @click=${() => this.#tocGo(b.key)}>${b.title}${b.note ? html` <small>(${b.note})</small>` : nothing}</button>
          ${b.subs?.length ? html`<ul class="subs">${b.subs.map(x => html`<li><button type="button" data-key=${x.key} @click=${() => this.#tocGo(x.key)}>${x.title}</button></li>`)}</ul>` : nothing}
        </li>`)}</ul>` : nothing}
      </li>`)}</ul>
    </div>`;
  }

  get #tocEl() { return /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.toc')); }
  #tocOpen() { const pop = this.#tocEl; return Boolean(pop && (pop.showPopover ? pop.matches(':popover-open') : pop.hasAttribute('data-open'))); }

  /**
   * The table of contents, from a header's ☰: under it, or over it when there is no room under (the stack at the
   * bottom), always whole on the screen; the place read marked, the focus in it. The ☰ touched again closes it.
   * @param {Event} e
   */
  #openToc(e) {
    const pop = this.#tocEl;
    if (!pop) return;
    const button = /** @type {HTMLElement} */ (e.currentTarget);
    // Open, or closed by this very touch (a popover closes as soon as the pointer goes down outside it): closed.
    if (this.#tocOpen() || (this.#tocClosedFrom === button && performance.now() - this.#tocClosedAt < 400)) { this.#closeToc(true); return; }
    this.#tocFrom = button;
    this.#tocMark(pop);
    if (pop.showPopover) pop.showPopover(); else { pop.setAttribute('data-open', ''); this.#onTocToggle(/** @type {any} */ ({ newState: 'open' })); }
    this.#tocPlace(pop, button.getBoundingClientRect());
    const at = /** @type {HTMLElement | null} */ (pop.querySelector('button[aria-current="location"]') || pop.querySelector('button[aria-current]') || pop.querySelector('ul button'));
    if (at) {
      at.focus({ preventScroll: true });
      const head = /** @type {HTMLElement | null} */ (pop.querySelector('.toc-head'))?.offsetHeight || 0;
      pop.scrollTop = Math.max(0, at.offsetTop - head - (pop.clientHeight - head) / 3);
    }
  }

  /** Where the table of contents goes: 8 px from every edge of the screen. @param {HTMLElement} pop @param {DOMRect} r */
  #tocPlace(pop, r) {
    const m = 8;
    pop.style.maxHeight = '';
    const h = pop.offsetHeight, w = pop.offsetWidth || 300;
    const below = innerHeight - r.bottom - 4 - m, above = r.top - 4 - m;
    let top;
    if (h <= below) top = r.bottom + 4;
    else if (h <= above) top = r.top - 4 - h;
    else if (below >= above) { top = r.bottom + 4; pop.style.maxHeight = Math.max(120, below) + 'px'; }
    else { top = m; pop.style.maxHeight = above + 'px'; }
    pop.style.top = Math.round(top) + 'px';
    pop.style.left = Math.round(Math.max(m, Math.min(r.left, innerWidth - w - m))) + 'px';
  }

  /** The place read, marked in the table of contents: its rubric, and its block or theme. @param {HTMLElement} pop */
  #tocMark(pop) {
    const { cat, block, wiki } = this.#readPlace();
    const here = wiki ? 'wiki:' + wiki : block;
    for (const b of /** @type {NodeListOf<HTMLElement>} */ (pop.querySelectorAll('button[data-key]'))) {
      const k = b.dataset.key;
      if (here && k === here) b.setAttribute('aria-current', 'location');
      else if (cat && k === 'rub:' + cat) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    }
  }

  /** @param {boolean} [back] the focus back on the ☰ it was opened from */
  #closeToc(back = false) {
    const pop = this.#tocEl;
    if (!pop || !this.#tocOpen()) return;
    this.#tocClosing = true;
    if (pop.hidePopover) pop.hidePopover(); else { pop.removeAttribute('data-open'); this.#onTocToggle(/** @type {any} */ ({ newState: 'closed' })); }
    this.#tocClosing = false;
    if (back) this.#tocFrom?.focus({ preventScroll: true });
  }

  /**
   * Opening or closing (a touch elsewhere, Échap, a place chosen): the ☰ says so. Before the change, at once — a
   * touch on the ☰ closes it on pointer down, then its click must know (the toggle event comes after the click).
   * @param {Event} e
   */
  #onTocToggle = e => {
    const open = /** @type {any} */ (e).newState === 'open';
    this.#tocFrom?.setAttribute('aria-expanded', String(open));
    // Closed by a touch outside it (the pointer going down on its ☰ too): its ☰'s click must not open it again.
    if (open || this.#tocClosing) return;
    this.#tocClosedAt = performance.now();
    this.#tocClosedFrom = this.#tocFrom;
  };
  #tocClosing = false;

  /**
   * Keys in the table of contents: ↑ ↓ (Début, Fin) from entry to entry; Échap closes it, back to its ☰ — and
   * neither Échap nor ← → reach the page (Découvrir would close the plant, the lists would change it).
   * @param {KeyboardEvent} e
   */
  #onTocKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.#closeToc(true); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      const list = [...(/** @type {HTMLElement} */ (e.currentTarget)).querySelectorAll('button')];
      const i = list.indexOf(/** @type {any} */ (this.renderRoot).activeElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
      /** @type {HTMLElement} */ (list[next])?.focus();
      e.preventDefault(); e.stopPropagation();
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.stopPropagation();
  };
  /** @type {HTMLElement | null} */ #tocFrom = null;
  /** @type {HTMLElement | null} */ #tocClosedFrom = null;
  #tocClosedAt = 0;

  /** An entry chosen: there, and the focus with it (Tab goes on from the place reached). @param {string} key */
  async #tocGo(key) {
    const from = this.#tocFrom;
    this.#closeToc();
    await this.goTo(key);
    const q = (/** @type {string} */ sel) => /** @type {HTMLElement | null} */ (this.renderRoot.querySelector(sel));
    const at = key.startsWith('rub:') ? q(`.rubric[data-cat="${CSS.escape(key.slice(4))}"] .rub-go`)
      : key.startsWith('wiki:') ? q(`.blocks #wiki-${CSS.escape(key.slice(5))} > summary`)
      : q(`.blocks .block[data-key="${CSS.escape(key)}"]`);
    if (at && !at.matches('button, summary')) at.tabIndex = -1;
    this.#appFocus = true;
    (at || from)?.focus({ preventScroll: true });
    this.#appFocus = false;
  }

  /** Shown here: everything in King; outside it, not folded, not left out for being empty. @param {string} k @param {any} ctx */
  #visible(k, ctx) {
    // « Page web » works in a pane only: elsewhere, King alone shows it (to be placed).
    if (k === 'web') return this.#kingHere || Boolean(this._paneOf('web'));
    return this.#kingHere || (!this._folded(k) && !(hidesEmpty(this._view, k) && this._emptyHere(k, ctx)));
  }

  /**
   * Folded: by hand in the mode, or its service off. A block a host's own tree puts in a pane (Rencontres' guided way)
   * is the host's: only its service off folds it. @param {string} k
   */
  _folded(k) { return this.tree && stackOf(this.tree, k) ? serviceOff(k) : isHidden(this._view, k); }

  /**
   * King, keyboard and touch way to arrange the panes: « Déplacer vers… » — back in the sheet, a new pane on
   * a side of the sheet, or a tab of a pane already there. (Dragging does the same with the pointer.)
   * @param {string} key
   */
  #placePicker(key) {
    const title = blockTitle(key);
    const tree = this.#tree(), here = this._paneOf(key);
    // After the move (or a refusal), the focus on the block where it is now: its grip, else its tab.
    const move = (/** @type {Event} */ e, /** @type {() => unknown} */ fn, /** @type {string} */ said) => {
      /** @type {HTMLDetailsElement | null} */ ((/** @type {HTMLElement} */ (e.currentTarget)).closest('details'))?.removeAttribute('open');
      this._said = `« ${title} » : ${fn() === false ? TOO_DEEP : said}`;
      this.#focusMoved(key);
    };
    const panes = /** @type {import('../core/pane-tree.js').StackNode[]} */ (paneLeaves(tree).filter(n => n.t === 'stack' && n !== here));
    const sides = /** @type {const} */ ([['right', 'à droite', 'chevron-bar-right'], ['left', 'à gauche', 'chevron-bar-left'], ['top', 'en haut', 'chevron-up'], ['bottom', 'en bas', 'chevron-down']]);
    // Opened: the focus on its first choice (↑ ↓ Début Fin among them, #menuKey; Tab leaves them all at once); Échap
    // closes it, back on its button; the focus gone elsewhere (Tab) closes it too: nothing is left open over the tools
    // the focus reaches. « Page web » works in a pane only: no « Dans la fiche » (its trash takes it out).
    return html`<details class="place-pick" @toggle=${this.#onPickToggle} @keydown=${(/** @type {KeyboardEvent} */ e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        const d = /** @type {HTMLDetailsElement} */ (e.currentTarget);
        d.removeAttribute('open');
        /** @type {HTMLElement | null} */ (d.querySelector('summary'))?.focus();
      }} @focusout=${(/** @type {FocusEvent} */ e) => {
        const d = /** @type {HTMLDetailsElement} */ (e.currentTarget), to = /** @type {Node | null} */ (e.relatedTarget);
        if (to && !d.contains(to)) d.removeAttribute('open');
      }}>
      <summary class="tool" title="Déplacer vers…" aria-label=${`Déplacer « ${title} » vers…`}>${icon('arrows-angle-expand')}</summary>
      <div class="move-menu" role="menu" aria-label=${'Déplacer « ' + title + ' » vers'} @keydown=${this.#menuKey}>
        ${key === 'web' ? nothing
          : html`<button type="button" role="menuitem" tabindex="-1" ?disabled=${!here} @click=${(/** @type {Event} */ e) => move(e, () => this.#toSheet(key), 'dans la fiche')}>${icon('list-ul')} Dans la fiche</button>`}
        ${sides.map(([side, label, ic]) => html`<button type="button" role="menuitem" tabindex="-1" @click=${(/** @type {Event} */ e) => move(e, () => this.#dock(key, 'sheet', side), 'nouveau panneau ' + label + ' de la fiche')}>${icon(ic)} Nouveau panneau ${label}</button>`)}
        ${panes.map(p => html`<button type="button" role="menuitem" tabindex="-1" @click=${(/** @type {Event} */ e) => move(e, () => this.#dock(key, p.id, 'center'), 'onglet de « ' + blockTitle(/** @type {string} */ (p.active)) + ' »')}>
          ${icon('collection')} Onglet de « ${blockTitle(/** @type {string} */ (p.active))} »</button>`)}
      </div>
    </details>`;
  }

  /**
   * « Déplacer vers… » opened (`toggle` does not bubble: on the details itself): the focus on its first choice — without
   * scrolling anything (the menu hangs from the button just touched; a menu wider than a narrow sheet would else
   * scroll the panes around it sideways).
   * @param {Event} e
   */
  #onPickToggle = e => {
    const d = /** @type {HTMLDetailsElement} */ (e.currentTarget);
    if (d.open) /** @type {HTMLElement | null} */ (d.querySelector('[role="menuitem"]:not([disabled])'))?.focus({ preventScroll: true });
  };

  /** ↑ ↓ (round), Début, Fin among the choices of « Déplacer vers… » that can be taken. @param {KeyboardEvent} e */
  #menuKey = e => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const items = /** @type {HTMLElement[]} */ ([.../** @type {HTMLElement} */ (e.currentTarget).querySelectorAll('[role="menuitem"]:not([disabled])')]);
    if (!items.length) return;
    const i = items.indexOf(/** @type {any} */ (this.renderRoot).activeElement);
    const last = items.length - 1;
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? last
      : e.key === 'ArrowDown' ? (i < 0 || i === last ? 0 : i + 1) : (i <= 0 ? last : i - 1);
    items[next].focus();
  };

  /** After a move: the focus on the block where it is now — its grip (the sheet, a pane's tab shown), else its tab. @param {string} key */
  async #focusMoved(key) {
    const k = CSS.escape(key);
    const find = () => /** @type {HTMLElement | null} */ (this.renderRoot.querySelector(`.block[data-key="${k}"] .grip`) || this.renderRoot.querySelector(`.edge-tabs [data-drag-key="${k}"]`));
    await this.updateComplete;
    find()?.focus();
    // A pane beside the sheet widens the host (Flore), which may draw the sheet again, wide: the focus lost with the
    // old nodes follows the block, once settled (never taken from where the hand put it).
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await this.updateComplete;
    if (!(/** @type {ShadowRoot} */ (this.renderRoot).activeElement)) find()?.focus();
  }

  /**
   * A pane of the tree: its blocks as tabs, foldable to its bar, without title or frame, shown over the whole
   * plant pane for a while. `dir`: the direction of the split it is in (its fold: a strip across it).
   * @param {any} ctx @param {import('../core/pane-tree.js').StackNode} node @param {string[]} keys @param {'row' | 'col' | null} dir
   */
  #pane(ctx, node, keys, dir) {
    const king = this.#kingHere;
    const tab = keys.includes(/** @type {string} */ (node.active)) ? /** @type {string} */ (node.active) : keys[0];
    const column = dir === 'row';
    const max = this._maxEdge === node.id;
    const folded = this.#foldedNow(node);
    const bare = Boolean(node.bare) && !king && !max;
    const where = '« ' + blockTitle(tab) + ' »';
    // A tab chosen while personalising is the one read first (the fold, a setting then, stays as it is).
    const tabs = html`<span class="edge-tabs" role="tablist" aria-label=${'Blocs du panneau ' + where}>${keys.map(k => html`<button type="button" role="tab" data-drag-key=${k}
      aria-selected=${k === tab ? 'true' : 'false'} title=${blockTitle(k)} @click=${() => this.#setStack(node.id, king ? { active: k } : { active: k, folded: false })}
      @pointerdown=${king ? (/** @type {PointerEvent} */ e) => this.#press(e, k) : null}>
      ${icon(k === 'web' ? 'globe-europe-africa' : categoryOf(blockCategory(k)).icon)}<span class="tab-name">${blockTitle(k)}</span></button>`)}</span>`;
    return html`<aside class="edge ${column ? 'col' : 'band'} ${folded ? 'folded' : ''} ${bare ? 'bare' : ''} ${max ? 'max' : ''} ${king ? 'king' : ''}"
        data-pane=${node.id} data-drop-node=${node.id} aria-label=${'Panneau ' + where}>
      ${bare ? html`<div class="edge-float">${keys.length > 1 ? tabs : nothing}${tab === 'media' ? this.#mediaControls() : nothing}
          <button class="edge-btn" type="button" title="Agrandir à tout le panneau" aria-label=${'Agrandir le panneau ' + where} @click=${() => { this._maxEdge = node.id; }}>${icon('arrows-fullscreen')}</button></div>`
        : html`<div class="edge-bar">
        ${tabs}
        ${king && node.folded ? html`<span class="fold-note" title="Replié à la lecture : sa barre seule, il s’ouvre au toucher (⚙ pour changer)">replié à la lecture</span>` : nothing}
        ${tab === 'media' && !folded ? this.#mediaControls() : nothing}
        ${king ? this.#placePicker(tab) : nothing}
        ${folded ? nothing : html`<details class="edge-opts">
          <summary class="edge-btn" title="Options d’affichage" aria-label=${'Options d’affichage du panneau ' + where}>${icon('gear')}</summary>
          <div class="opts-pop">
            <label><input type="checkbox" .checked=${Boolean(node.bare)} @change=${(/** @type {any} */ e) => this.#setStack(node.id, { bare: e.target.checked })} /> Sans titre ni cadre</label>
            <label><input type="checkbox" .checked=${Boolean(node.folded)} @change=${(/** @type {any} */ e) => this.#setStack(node.id, { folded: e.target.checked })} /> Replié (s’ouvre au toucher)</label>
          </div>
        </details>`}
        <button class="edge-btn" type="button" title=${max ? 'Remettre à sa place (Échap)' : 'Agrandir à tout le panneau'}
          aria-label=${(max ? 'Remettre le panneau ' : 'Agrandir le panneau ') + where} @click=${() => { this._maxEdge = max ? null : node.id; }}>${icon(max ? 'fullscreen-exit' : 'arrows-fullscreen')}</button>
        ${max || king ? nothing : html`<button class="edge-btn" type="button" aria-expanded=${folded ? 'false' : 'true'} aria-label=${(folded ? 'Déplier le panneau ' : 'Replier le panneau ') + where}
          @click=${() => this.#setStack(node.id, { folded: !node.folded })}>${icon(folded ? 'chevron-down' : 'chevron-up')}</button>`}
      </div>`}
      ${folded ? nothing : html`<div class="edge-body">${repeat([tab], k => k, k => king ? this.#block(k, ctx, null) : this.#plainBlock(k, ctx))}</div>`}
    </aside>`;
  }

  /**
   * A pane drawn folded (its bar only): folded in the layout, not shown over the whole plant pane, and not while the
   * sheet is personalised — its blocks are then drawn, to be arranged (« Replié », in its ⚙, stays the setting).
   * @param {import('../core/pane-tree.js').StackNode} node
   */
  #foldedNow(node) { return Boolean(node.folded) && this._maxEdge !== node.id && !this.#kingHere; }

  /** The media's controls (type, part of the plant, count) in its pane's header: one line less. */
  #mediaControls() {
    const viewer = /** @type {any} */ (this.renderRoot.querySelector('.edge gf-media-viewer[bar-out]'));
    return html`<span class="media-ctl">${viewer ? viewer.controls() : nothing}</span>`;
  }

  // ── The tree of panes: the mode's (sheetLayout), or the host's own (`tree`, handed back as pane-sizes) ──────────

  /** The tree of panes shown: the host's, else the mode's. @returns {import('../core/pane-tree.js').PaneNode} */
  #tree() { return this.tree ?? treeOf(this._view); }

  /** The pane holding a block. @param {string} key */
  _paneOf(key) { return this.tree ? stackOf(this.tree, key) : paneOf(this._view, key); }

  /** The host's tree changed: back to it, the mode's layout left alone. @param {import('../core/pane-tree.js').PaneNode} next */
  #handBack(next) { if (next !== this.tree) this.dispatchEvent(new CustomEvent('pane-sizes', { detail: next })); }

  /** New shares for a split's children. @param {string} id @param {number[]} sizes */
  #setSizes(id, sizes) { if (this.tree) this.#handBack(treeSizes(this.tree, id, sizes)); else setPaneSizes(this._view, id, sizes); }

  /** A pane's state (its tab, folded, bare). @param {string} id @param {Partial<import('../core/pane-tree.js').StackNode>} patch */
  #setStack(id, patch) { if (this.tree) this.#handBack(patchStack(this.tree, id, patch)); else setStackState(this._view, id, patch); }

  /**
   * A block docked (a new pane, a tab); false: not moved (too many panes nested).
   * @param {string} key @param {string} target @param {import('../core/pane-tree.js').Zone} zone
   */
  #dock(key, target, zone) {
    if (!this.tree) return dockBlock(this._view, key, target, zone);
    const next = dock(this.tree, key, target, zone);
    if (next === this.tree) return false;
    this.#handBack(next);
    return true;
  }

  /** A block back in the sheet. @param {string} key @param {string | null} [beforeKey] */
  #toSheet(key, beforeKey = null) {
    if (this.tree) this.#handBack(undock(this.tree, key));
    else toSheet(this._view, key, beforeKey);
  }

  /**
   * The blocks a pane shows here (King: all; else not folded, not empty for this plant); a pane with none
   * is left out (its split closes over it). @param {any} ctx @param {import('../core/pane-tree.js').PaneNode} node
   * @returns {import('../core/pane-tree.js').PaneNode | null}
   */
  #shownNode(ctx, node) {
    if (node.t === 'sheet') return node;
    if (node.t === 'stack') { const tabs = node.tabs.filter(k => this.#visible(k, ctx)); return tabs.length ? { ...node, tabs } : null; }
    /** @type {import('../core/pane-tree.js').PaneNode[]} */ const kids = [];
    /** @type {number[]} */ const sizes = [];
    node.kids.forEach((k, i) => { const c = this.#shownNode(ctx, k); if (c) { kids.push(c); sizes.push(node.sizes[i]); } });
    if (!kids.length) return null;
    return kids.length === 1 ? kids[0] : { ...node, kids, sizes };
  }

  /**
   * A node of the tree: a split lays its children in a row or a column, their shares as flex weights, a grip
   * between two (drag: new shares; ← → or ↑ ↓; double-click: equal shares); a pane; the sheet.
   * @param {any} ctx @param {import('../core/pane-tree.js').PaneNode} node @param {unknown} sheet @param {'row' | 'col' | null} dir
   */
  #node(ctx, node, sheet, dir = null) {
    if (node.t === 'sheet') return html`<div class="main" data-drop-node="sheet">${sheet}</div>`;
    if (node.t === 'stack') return this.#pane(ctx, node, node.tabs, dir);
    const total = node.sizes.reduce((a, b) => a + b, 0);
    const set = (/** @type {number[]} */ sizes) => this.#setSizes(node.id, sizes);
    return html`<div class="split ${node.dir}" data-split=${node.id}>${repeat(node.kids, k => k.id, (k, i) => html`
      ${i ? shareGrip({ dir: node.dir, sizes: node.sizes, i, set, label: `Redimensionner ${this.#nodeName(node.kids[i - 1])} et ${this.#nodeName(k)}`, controls: 'cell-' + node.kids[i - 1].id }) : nothing}
      <div class="cell ${k.t === 'stack' && this.#foldedNow(k) ? 'folded' : ''}" id=${'cell-' + k.id} style=${`flex:${node.sizes[i] / total} 1 0`}>${this.#node(ctx, k, sheet, node.dir)}</div>`)}</div>`;
  }

  /** What a grip's name says of a side: « la fiche », a pane by its block shown, a split by its first pane. @param {import('../core/pane-tree.js').PaneNode} n @returns {string} */
  #nodeName(n) {
    if (n.t === 'sheet') return 'la fiche';
    if (n.t === 'stack') return '« ' + blockTitle(/** @type {string} */ (n.active && n.tabs.includes(n.active) ? n.active : n.tabs[0])) + ' »';
    return this.#nodeName(n.kids[0]);
  }

  /** The sheet, with its panes when it has some. @param {any} ctx @param {unknown} article */
  #layout(ctx, article) { return this.#docked(ctx, article); }

  // ── The table of contents, places reached and kept, the place read ─────────────────────────────────────

  /** The blocks of the sheet a category leads to, in order (flow, pinned, in the pane). @param {any} ctx @param {string} cat */
  #categoryBlocks(ctx, cat) {
    return blockOrder(this._view).filter(k => blockCategory(k) === cat && k !== 'name' && this.#visible(k, ctx) && !isHidden(this._view, k));
  }

  /**
   * The rubrics of the sheet in its order, their blocks (and the article's themes) and alerts: the table of
   * contents. @param {any} ctx
   */
  #tocItems(ctx) {
    return this.#rubrics(ctx).map(g => {
      const c = categoryOf(g.cat);
      return {
        key: g.cat, label: c.label, question: c.question, icon: c.icon, badge: this.#badge(g.cat),
        blocks: this.#categoryBlocks(ctx, g.cat).map(k => ({ key: k, title: blockTitle(k), note: placeOf(this._view, k) ? 'dans un panneau' : undefined,
          // The article's themes, each to its anchor in the Wikipédia block.
          subs: k === 'wikipedia' && !placeOf(this._view, k) ? this._wikiThemes.map(t => ({ key: 'wiki:' + t, title: WIKI_THEMES[t][0] })) : undefined }))
      };
    });
  }

  /** What the sheet is, from its name: a genus, a species, a subspecies, a variety, a form, a hybrid. */
  get #entity() {
    const name = String(this._plant?.scientificName || '');
    if (!name) return null;
    if (/\ssubsp\.\s/.test(name)) return 'Sous-espèce';
    if (/\svar\.\s/.test(name)) return 'Variété';
    if (/\sf\.\s/.test(name)) return 'Forme';
    if (/(^|\s)[×x]\s/.test(name)) return 'Hybride';
    return /^\S+\s+[a-zà-ÿ-]+/.test(name) ? 'Espèce' : 'Genre';
  }

  /** The sheet's scrolling part: its middle when it has edges, else itself. */
  get #sheetScroller() { return /** @type {HTMLElement} */ (this.renderRoot.querySelector('.frame.edged .main[data-drop-node="sheet"]') || this); }

  /**
   * To a rubric (« rub:<category> »), a block, or a theme of the article (« wiki:<theme> »), asked by the table of
   * contents, a rubric's header, a link of the sheet or the host. The place is noted for the next plant (choosing
   * a place moves the padlock too). @param {string} key
   */
  goTo(key) {
    if (key.startsWith('wiki:')) {
      this.#noteAnchor(blockCategory('wikipedia'), 'wikipedia', key.slice(5));
      return this.#wikiGo(key.slice(5));
    }
    if (key.startsWith('rub:')) {
      this.#noteAnchor(key.slice(4), null, null);
      return this.#goRubric(key.slice(4));
    }
    this.#noteAnchor(blockCategory(key), key, null);
    return this.#goTo(key);
  }

  /** The place noted for the next plant (in memory: sheet-session.js). @param {string | null} cat @param {string | null} block @param {string | null} wiki */
  #noteAnchor(cat, block, wiki) {
    if (this.preview) return;
    sheetSession.anchor = cat;
    sheetSession.anchorBlock = block;
    sheetSession.anchorOffset = 0;
    sheetSession.anchorWiki = wiki;
  }

  /**
   * To a rubric: its start, right under the rubrics stuck above it — its blocks all in panes: the first one's tab
   * shown too (unfolded). @param {string} cat
   */
  async #goRubric(cat) {
    await this.updateComplete;
    if (!this._plant || this._plant.failed) return;
    const first = this.#categoryBlocks(this._context(this._plant), cat)[0];
    const mark = this.renderRoot.querySelector(`.rub-mark[data-cat="${CSS.escape(cat)}"]`);
    if (mark) {
      this.#arrive(mark, { flash: mark.nextElementSibling });
      if (first && this._paneOf(first) && !mark.parentElement?.querySelector(':scope > .block')) this.#goTo(first);
      return;
    }
    // King (no rubrics): its first block.
    if (first) this.#goTo(first);
  }

  /** To a block: its place in the sheet — or, in a pane, its tab (unfolded): the sheet does not move. @param {string} key */
  async #goTo(key) {
    const pane = this._paneOf(key);
    if (pane && (pane.active !== key || pane.folded)) this.#setStack(pane.id, { active: key, folded: false });
    await this.updateComplete;
    if (pane) return;
    const section = this.renderRoot.querySelector(`.blocks .block[data-key="${CSS.escape(key)}"]`);
    if (section) this.#arrive(section);
  }

  /** How far `el` is from its place: right under what stays stuck above it (its scroll-margin), px. @param {Element} el @param {HTMLElement} scroller */
  #offset(el, scroller) {
    const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - margin;
  }

  /**
   * Arrives at `el`, right under the rubrics stuck above it (its scroll-margin): at once — gliding only when it is
   * near (within a screen, motion allowed) — lit, then kept there while the content above it still arrives (#keep).
   * `quiet`: no glide, no light (a new plant opening there). `prefer`: a finer place still to come, reached when it
   * comes (the article's theme read on the previous plant). Only a place of the sheet itself: a pane has its own.
   * @param {Element} el @param {{ flash?: Element | null, prefer?: (() => Element | null) | null, quiet?: boolean }} [opts]
   */
  #arrive(el, { flash = el, prefer = null, quiet = false } = {}) {
    const scroller = this.#sheetScroller;
    this.#letGo();
    if (!this.#inSheet(el)) return;
    this.#handAt = 0;
    this.#lastPlace = { el, prefer };
    this.#preFocus = null;
    const d = this.#offset(el, scroller);
    const glide = !quiet && Math.abs(d) > 1 && Math.abs(d) < scroller.clientHeight && 'onscrollend' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (Math.abs(d) > 1) scroller.scrollTo({ top: scroller.scrollTop + d, behavior: glide ? 'smooth' : 'auto' });
    this.#lastTop = glide ? null : scroller.scrollTop;
    this.#padTo(el);
    // One place lit at a time: the one before goes out.
    this.#lit?.removeAttribute('data-flash');
    const lit = () => {
      this.#litOff = null;
      if (!flash || quiet) return;
      this.#lit = /** @type {HTMLElement} */ (flash);
      flash.removeAttribute('data-flash');
      void (/** @type {HTMLElement} */ (flash)).offsetWidth;
      flash.setAttribute('data-flash', '');
      setTimeout(() => flash.removeAttribute('data-flash'), 1300);
    };
    if (glide) { scroller.addEventListener('scrollend', lit, { once: true }); this.#litOff = () => scroller.removeEventListener('scrollend', lit); } else lit();
    this.#keep(el, { prefer, glide });
  }
  /** The place reached last (with its finer place to come), to reach again when the stack changes. @type {{ el: Element, prefer: (() => Element | null) | null } | null} */
  #lastPlace = null;
  /** @type {HTMLElement | null} */ #lit = null;
  /** @type {(() => void) | null} */ #litOff = null;

  /** Shows a value on the maps (or takes it off); a map out of sight comes into view. @param {import('../core/map-focus.js').MapFocus} f */
  async _focusOn(f) {
    super._focusOn(f);
    if (!isFocused(this._focus, f)) return;
    await this.updateComplete;
    const maps = [...this.renderRoot.querySelectorAll('gf-sheet-map')];
    const box = this.getBoundingClientRect();
    const seen = maps.some(m => { const r = m.getBoundingClientRect(); return r.height && r.bottom > box.top + 20 && r.top < box.bottom - 20; });
    if (seen || !maps[0]) return;
    // A map of the sheet: its block reached (only the sheet scrolls); a map in a pane: brought into its pane's view.
    const block = maps[0].closest('.blocks .block');
    const key = /** @type {HTMLElement | null} */ (block)?.dataset.key;
    if (block && key) { this.#noteAnchor(blockCategory(key), key, null); this.#arrive(block); } else maps[0].scrollIntoView({ block: 'nearest' });
  }

  /** In the sheet itself (not in one of its panes). @param {Element} el */
  #inSheet(el) {
    const scroller = this.#sheetScroller;
    return el.isConnected && !el.closest('.edge-body') && (scroller === this || scroller.contains(el));
  }

  /**
   * Keeps `el` at its place while the content above it still arrives (photos, the article, other blocks' data): at
   * once, each time the sheet grows — until the plant's data has all arrived and the sheet has stopped growing
   * (KEEP_QUIET_MS; KEEP_MAX_MS at most), never against the hand (wheel, touch, keys, pointer let go at once:
   * #onHand), never past another place reached or another plant. A finer place to come (`prefer`) is reached when
   * it comes, as long as it is kept. `at`: kept where it is now (px from the sheet's top) instead of at its place —
   * what the eye reads when the hand stopped (#holdEye); `outer` (its block) kept instead if it goes.
   * @param {Element} el @param {{ prefer?: (() => Element | null) | null, glide?: boolean, at?: number | null, outer?: Element | null }} opts
   */
  #keep(el, { prefer = null, glide = false, at = null, outer = null }) {
    const scroller = this.#sheetScroller;
    const start = performance.now();
    const top = (/** @type {Element} */ x) => x.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const outerAt = outer && at !== null ? top(outer) : 0;
    let target = el, gliding = glide, grewAt = start, timer = 0, want = at;
    const fix = () => {
      if (!this.isConnected) { this.#letGo(); return; }
      const better = prefer?.();
      if (better && better !== target && this.#inSheet(better)) { target = better; this.#lastPlace = { el: better, prefer }; this.#padTo(target); }
      if (!target.isConnected && outer?.isConnected) { target = outer; want = outerAt; }
      if (gliding || !target.isConnected) return;
      const d = want === null ? this.#offset(target, scroller) : top(target) - want;
      if (Math.abs(d) > 1) scroller.scrollTop += d;
      kept.wrote = this.#lastTop = scroller.scrollTop;
    };
    /** Where the sheet was put by the app (a scroll elsewhere is the hand's: #onScroll lets go). */
    const kept = this.#kept = { wrote: scroller.scrollTop, gliding: () => gliding };
    const grow = new ResizeObserver(() => { grewAt = performance.now(); fix(); });
    let body = this.renderRoot.querySelector('article');
    if (body) grow.observe(body);
    // Each render too (before it is painted): the article itself may be drawn anew (the details arrived).
    this.#keepFix = () => {
      const now = this.renderRoot.querySelector('article');
      if (now !== body) { if (body) grow.unobserve(body); body = now; if (body) grow.observe(body); }
      grewAt = performance.now();
      fix();
    };
    const end = () => { gliding = false; kept.wrote = scroller.scrollTop; fix(); };
    scroller.addEventListener('scrollend', end);
    // One hand on the place while it is kept: the browser's own anchoring (which would hold another line) waits.
    scroller.style.overflowAnchor = 'none';
    const check = () => {
      const now = performance.now();
      if (gliding && now - start > 1500) end();
      if (now - start > KEEP_MAX_MS || (!this._loadingNow && !gliding && now - grewAt > KEEP_QUIET_MS)) { this.#letGo(); return; }
      timer = setTimeout(check, 200);
    };
    timer = setTimeout(check, 200);
    this.#keeper = () => { grow.disconnect(); scroller.removeEventListener('scrollend', end); clearTimeout(timer); scroller.style.overflowAnchor = ''; this.#keepFix = null; this.#kept = null; };
  }
  /** The place kept, put back after a render (#keep). @type {(() => void) | null} */
  #keepFix = null;
  /** What the place kept wrote last, and whether it is still gliding there. @type {{ wrote: number, gliding: () => boolean } | null} */
  #kept = null;
  /** @type {(() => void) | null} */ #keeper = null;

  /** The place kept lets go. */
  #letGo() { this.#keeper?.(); this.#keeper = null; this.#litOff?.(); this.#litOff = null; }

  /**
   * What stays stuck above and below the place read, as the sheet's scroll padding: the browser then keeps that
   * place when content grows above it (scroll anchoring), a page down (Page suivante, Espace) shows the next lines
   * and no more, and what the keyboard focuses never lands under the stacks. Above: the rubrics, then the rubric's
   * own header, the block's title or the theme's title; below: the rubrics to come (« full ») and the action bar.
   * @param {Element} el
   */
  #padTo(el) {
    let top = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    if (el.classList.contains('rub-mark')) top += this.#rubH();
    // (A block's title sticks in its rubric only: personalising, it scrolls with the block.)
    else if (el.matches('.rubric > .block:not(.headless)')) top += this.#titleH();
    else if (el.matches('.wiki-theme[open]')) top += el.querySelector(':scope > summary')?.getBoundingClientRect().height || 0;
    const full = this.getAttribute('stack') === 'full';
    const stack = parseFloat(getComputedStyle(el).getPropertyValue('--stack')) || 0;
    this.#pad(top, full ? (this.#rubCount() - stack - 1) * this.#rubH() + this.#barH() : this.#barH());
  }

  /**
   * The hand stopped while the plant's data still arrives: what the eye reads (the first line under what is stuck
   * above) stays where it is until everything has arrived and the sheet is still — or the hand moves again. The
   * browser's own anchoring cannot do it: what is stuck hides the lines it would hold.
   */
  #holdEye() {
    const scroller = this.#sheetScroller, r = scroller.getBoundingClientRect();
    const y = r.top + (parseFloat(scroller.style.scrollPaddingTop) || 0) + 24, x = r.left + Math.min(r.width / 2, 200);
    /** @type {Element | undefined} */
    const el = /** @type {any} */ (this.renderRoot).elementsFromPoint(x, y).find((/** @type {Element} */ e) => e.closest('.blocks') && !e.closest('.rub-head, .block-title, .wiki-theme > summary')
      && getComputedStyle(e).position !== 'sticky' && e.getBoundingClientRect().height < r.height);
    // The line read belongs to the place read (its block, its theme): that line is held. Else the place read itself
    // (a block still empty, its start under the stack): its start is held, what comes fills it downwards.
    const place = this.#readPlace().el;
    const held = el && this.#inSheet(el) && (!place || place.contains(el)) ? el : place;
    if (!held) return;
    this.#keep(held, { at: held.getBoundingClientRect().top - r.top, outer: held === el ? el.closest('.block') : null });
  }

  /** The sheet's padding with no place read (its top): nothing stuck above, every rubric below (« full »). */
  #padBase() {
    const full = this.getAttribute('stack') === 'full';
    this.#pad(0, (full ? this.#rubCount() * this.#rubH() : 0) + this.#barH());
  }

  /** @param {number} top @param {number} bottom (personalising, the bar « Mise en page de la fiche » stuck above, at least) */
  #pad(top, bottom) {
    const s = this.#sheetScroller.style;
    const t = Math.max(0, Math.round(top), this.#kingBarH()) + 'px', b = Math.max(0, Math.round(bottom)) + 'px';
    if (s.scrollPaddingTop !== t) s.scrollPaddingTop = t;
    if (s.scrollPaddingBottom !== b) s.scrollPaddingBottom = b;
  }

  #rubH() { return parseFloat(getComputedStyle(this).getPropertyValue('--rub-h')) || 30; }
  #barH() { return parseFloat(this.style.getPropertyValue('--bar-h')) || 0; }
  /** The bar « Mise en page de la fiche » stuck over the sheet (none with panes: it stands above them). */
  #kingBarH() { return this.hasAttribute('edged') ? 0 : Math.round(parseFloat(this.style.getPropertyValue('--kb-h')) || 0); }
  #titleH() { return parseFloat(this.style.getPropertyValue('--title-h')) || 38; }
  #rubCount() { return this.renderRoot.querySelectorAll('.blocks > .rubric').length; }

  /**
   * The hand on the sheet: what is kept lets go, the table of contents closes; its scrolling will be a reading
   * (#onScroll). Opening or going through the table of contents is not reading: it changes nothing here. A finger
   * on the screen or a button held (the scrollbar's thumb) is noted until it lifts: nothing is held under it.
   * @param {Event} e
   */
  #onHand = e => {
    if (e.type === 'keydown' || e.type === 'pointerdown') this.#preFocus = { st: this.#sheetScroller.scrollTop, at: performance.now() };
    const path = e.composedPath();
    if (path.some(x => x instanceof Element && (x.classList.contains('toc') || x.classList.contains('rub-toc')))) return;
    if (e.type === 'touchstart') this.#touching = true;
    else if (e.type === 'pointerdown' && /** @type {PointerEvent} */ (e).pointerType !== 'touch') this.#buttonDown = true;
    this.#handAt = Date.now();
    this.#letGo();
    this.#closeToc();
  };
  /** The finger or the button lifted (anywhere): the line read may be held now, if the hand stopped meanwhile. @param {Event} e */
  #onLift = e => {
    if (e.type === 'touchend' || e.type === 'touchcancel') { if (/** @type {TouchEvent} */ (e).touches.length) return; this.#touching = false; }
    else if (/** @type {PointerEvent} */ (e).pointerType !== 'touch') this.#buttonDown = false;
    else return;
    if (this.#holdLater && !this.#readTimer) this.#readTimer = setTimeout(() => { this.#readTimer = 0; this.#handStopped(); }, 180);
  };
  #touching = false;
  #buttonDown = false;
  /** The hand stopped while still down: the line is held once it lifts. */
  #holdLater = false;
  /** When the hand last touched the sheet; 0: the app moved it since (a place reached, a new plant). */
  #handAt = 0;

  /**
   * The sheet scrolled by the hand: once it stops, the place read is noted (#noteRead). Nothing else happens while
   * it scrolls — the stuck headers say where the reading is. @param {Event} e
   */
  #onScroll = e => {
    const scroller = this.#sheetScroller;
    if (e.composedPath()[0] !== scroller) return;
    this.#lastTop = scroller.scrollTop;
    // Where the sheet was at the last key or pointer down is past: it scrolled since (a grip moved into view, the
    // hand…). The browser's scroll to a focus is told only after its focusin: never this one (#onFocusIn).
    this.#preFocus = null;
    // A scroll the place kept did not write (the scrollbar's thumb, the page's search, a finger whose events went
    // elsewhere): the hand has the sheet.
    const kept = this.#kept;
    if (kept && !kept.gliding() && Math.abs(scroller.scrollTop - kept.wrote) > 1) { this.#handAt = Date.now(); this.#letGo(); }
    if (!this.#handAt) return;
    clearTimeout(this.#readTimer);
    this.#readTimer = setTimeout(() => { this.#readTimer = 0; this.#handStopped(); }, 180);
  };
  /** @type {any} */ #readTimer = 0;

  /**
   * The place read, noted for the next plant (unless the padlock keeps another one; `force`: being locked here):
   * the rubric whose header is stuck at the top, its block whose start has passed under the stack, the article's
   * theme likewise. @param {boolean} [force]
   */
  #noteRead(force = false) {
    if (this.preview || (sheetSession.anchorLock && !force)) return;
    const { cat, block, wiki, el } = this.#readPlace();
    this.#noteAnchor(cat, block, wiki);
    if (el) this.#padTo(el); else this.#padBase();
  }

  /** The hand stopped: the place read noted, and — data still arriving — the line read held (#holdEye), once the hand has lifted. */
  #handStopped() {
    this.#noteRead();
    this.#holdLater = this.#touching || this.#buttonDown;
    if (!this.#holdLater && this._loadingNow && !this.#keeper) this.#holdEye();
  }

  /** Where the reading is: the rubric, block and theme whose starts have passed under what is stuck above them. */
  #readPlace() {
    const scroller = this.#sheetScroller;
    if (scroller.scrollTop < 8) return { cat: null, block: null, wiki: null, el: null };
    const past = (/** @type {Element} */ el) => this.#offset(el, scroller) <= 2;
    /** @type {HTMLElement | null} */ let mark = null;
    for (const m of /** @type {NodeListOf<HTMLElement>} */ (this.renderRoot.querySelectorAll('.blocks .rub-mark'))) { if (past(m)) mark = m; else break; }
    // King has no rubrics: the block at the top.
    const blocks = /** @type {HTMLElement[]} */ ([...(mark ? mark.parentElement?.querySelectorAll(':scope > .block') || [] : this.renderRoot.querySelectorAll('.blocks > .block'))]);
    /** @type {HTMLElement | null} */ let block = null;
    for (const b of blocks) { if (past(b)) block = b; else break; }
    /** @type {HTMLElement | null} */ let wiki = null;
    if (block?.dataset.key === 'wikipedia') for (const t of /** @type {NodeListOf<HTMLElement>} */ (block.querySelectorAll('.wiki-theme'))) { if (past(t)) wiki = t; else break; }
    const cat = mark?.dataset.cat || (block ? blockCategory(block.dataset.key || '') : null);
    return { cat, block: block?.dataset.key || null, wiki: wiki?.dataset.theme || null, el: wiki || block || mark };
  }

  /**
   * A plant drawn: at the place read on the previous one, at once — nothing hidden, nothing seen moving. Its
   * rubric is always there (a header does not wait for the data); its block, or the article's theme, is reached
   * as soon as it comes, unless the hand moves the sheet first.
   */
  async #place() {
    if (this.panesOnly) return;
    await this.updateComplete;
    const scroller = this.#sheetScroller;
    const cat = sheetSession.anchor;
    this.#handAt = 0;
    if (!cat) { if (scroller.scrollTop) scroller.scrollTop = 0; this.#padBase(); return; }
    const q = (/** @type {string} */ sel) => /** @type {HTMLElement | null} */ (this.renderRoot.querySelector(sel));
    const finer = () => (sheetSession.anchorWiki && q('.blocks #wiki-' + CSS.escape(sheetSession.anchorWiki)))
      || (sheetSession.anchorBlock && q(`.blocks .block[data-key="${CSS.escape(sheetSession.anchorBlock)}"]`)) || null;
    const el = finer() || q(`.rub-mark[data-cat="${CSS.escape(cat)}"]`)
      || [...this.renderRoot.querySelectorAll('.blocks > .block')].find(b => blockCategory(/** @type {HTMLElement} */ (b).dataset.key || '') === cat) || null;
    if (el) this.#arrive(el, { quiet: true, prefer: finer });
  }

  /**
   * The view or King changed the sheet's order: the place read before is reached again, quietly (its block,
   * its theme, else its rubric). @param {{ cat: string | null, block: string | null, wiki: string | null }} p
   */
  #placeAgain(p) {
    const q = (/** @type {string} */ sel) => /** @type {HTMLElement | null} */ (this.renderRoot.querySelector(sel));
    const el = (p.wiki && q('.blocks #wiki-' + CSS.escape(p.wiki))) || (p.block && q(`.blocks .block[data-key="${CSS.escape(p.block)}"]`))
      || (p.cat && (q(`.rub-mark[data-cat="${CSS.escape(p.cat)}"]`)
        || /** @type {HTMLElement | undefined} */ ([...this.renderRoot.querySelectorAll('.blocks > .block')].find(b => blockCategory(/** @type {HTMLElement} */ (b).dataset.key || '') === p.cat)))) || null;
    if (el) this.#arrive(el, { quiet: true });
  }
  /** The place read when the view or King changes, to reach again once drawn. @type {{ cat: string | null, block: string | null, wiki: string | null } | null} */
  #rePlace = null;
  /** King open here at the last update. */
  #king = false;
  /** The view shown at the last update (#view). @type {string | null} */
  #lastView = null;
  /** The plant was placed (#place). */
  #placed = false;
  /** The card underneath just came on top. */
  #promoted = false;
  /** The bar « Mise en page de la fiche » stuck over the sheet, as the sheet's padding last counted it (#kingBarH). */
  #padKing = 0;
  /** The bar « Mise en page de la fiche » drawn, its size followed (its mode switch draws its buttons after it). */
  #barSize = new ResizeObserver(() => { this.#kingBarSized(); this.#keepFix?.(); });
  /** @type {Element | null} */ #barSeen = null;

  /**
   * The bar « Mise en page de la fiche », personalising, above the frame: its height (--kb-h), for the bands of a
   * narrow sheet to share what is left. Stuck over a sheet without panes, the blocks are reached and read under it
   * (their scroll margin) and the keyboard's focus never lands under it (the sheet's padding, #pad).
   */
  #kingBarSized() {
    const kb = /** @type {HTMLElement | null} */ (this.#barSeen)?.offsetHeight || 0;
    if (this.style.getPropertyValue('--kb-h') === kb + 'px' && this.#padKing === this.#kingBarH()) return;
    this.style.setProperty('--kb-h', kb + 'px');
    this.#padKing = this.#kingBarH();
    if (this._plant && !this.panesOnly) { const read = this.#readPlace().el; if (read) this.#padTo(read); else this.#padBase(); }
  }

  /**
   * The sheet in its tree of panes (King arranges it): splits in rows and columns, panes of tabs, the sheet
   * alone scrolling among them. On a narrow sheet the panes are bands above and under the sheet, in the tree's
   * order (the tree itself does not change).
   * @param {any} ctx @param {unknown} article
   */
  #docked(ctx, article) {
    const sheet = html`${article}${this.#actionBar(ctx.plant)}`;
    // King open here: its bar above the sheet and its panes (stuck at the top of a sheet without panes) — the same
    // node whatever the tree below it: a mode with panes chosen in it keeps the focus there.
    const bar = this.#kingHere ? this.#kingBar() : nothing;
    return html`${bar}${this.#frame(ctx, sheet)}`;
  }

  /** The sheet alone, or in its frame of panes (#docked). @param {any} ctx @param {unknown} sheet */
  #frame(ctx, sheet) {
    const tree = this.#shownNode(ctx, this.#tree()) || { t: 'sheet', id: 'sheet' };
    if (tree.t === 'sheet') return sheet;
    const wide = this._wideSheet !== false;
    if (!wide) {
      const list = paneLeaves(tree);
      const bands = list.filter(n => n.t === 'stack' && !this.#foldedNow(n)).length || 1;
      return html`<div class="frame edged narrow ${this._maxEdge ? 'maxed' : ''}" style=${`--bands:${bands}`}>${repeat(list, n => n.id, n => n.t === 'sheet'
        ? html`<div class="main" data-drop-node="sheet">${sheet}</div>`
        : html`<div class="cell band-cell ${this.#foldedNow(/** @type {any} */ (n)) ? 'folded' : ''}">${this.#pane(ctx, /** @type {any} */ (n), /** @type {any} */ (n).tabs, 'col')}</div>`)}</div>`;
    }
    return html`<div class="frame edged ${this._maxEdge ? 'maxed' : ''}" data-drop-node="root">${this.#node(ctx, tree, sheet)}</div>`;
  }

  /**
   * « Mise en page de la fiche »: the mode arranged on this sheet, named and switched here — the app's mode stays as
   * it is (none picked: the app's, and it follows it) —, « Barre d’actions » (its list: tick, order), « Par défaut »
   * (this mode back to its own layout), « Ranger par catégorie », and « Terminé » (the sheet read again; the focus
   * back on the crown).
   */
  #kingBar() {
    const m = this._view;
    const label = modeLabel(m);
    // Open from one plant to the next, like the sub-blocks' lists (sheet-session.js).
    const actionsOpen = this._subsOpen.has('actions');
    return html`<section class="king-bar" aria-label="Mise en page de la fiche">
      <span class="kb-mode">${icon('crown')} Mise en page : ${modeIcon(m)} <b>${label}</b></span>
      <gf-mode-switch large .value=${m} ?overridden=${m !== this.view} scope="la mise en page"
        @mode-change=${(/** @type {CustomEvent} */ e) => { e.stopPropagation(); arrange(e.detail.mode, this.view); this.#modeFocus(); }}></gf-mode-switch>
      <span class="kb-tools">
        <button type="button" class="small kb-actions" aria-expanded=${actionsOpen ? 'true' : 'false'} aria-controls="king-actions"
          title="Les actions de la barre du bas dans ce mode : les cocher, les ordonner"
          @click=${() => { const open = new Set(this._subsOpen); if (actionsOpen) open.delete('actions'); else open.add('actions'); this._subsOpen = open; }}>${icon('three-dots')} Barre d’actions</button>
        <button type="button" class="small" ?disabled=${!isCustom(m)} title=${`Remettre la mise en page de « ${label} » par défaut`}
          @click=${() => this.#resetMode(m)}>${icon('arrow-counterclockwise')} Par défaut</button>
        <button type="button" class="small" title="Les blocs d’une même catégorie ensemble (Noms, Images, Savoirs…), dans ce mode"
          @click=${() => orderByCategory(m, k => CATEGORIES.findIndex(c => c.key === blockCategory(k)))}>${icon('list-nested')} Ranger par catégorie</button>
        <button type="button" class="small primary" @click=${this.#endKing}>Terminé</button>
      </span>
      ${actionsOpen ? html`<div class="king-actions" id="king-actions">
        <p>Cochez les actions de « ${label} » ; glissez-les, ou ↑ ↓ sur leur poignée, pour les ordonner.</p>
        <gf-sortable-list label="Barre d’actions"
          .items=${subOrder(m, 'actions').map(k => ({ key: k, label: subTitle('actions', k), checked: !isSubHidden(m, 'actions', k) }))}
          @reorder=${(/** @type {CustomEvent} */ e) => setSubOrder(m, 'actions', e.detail.keys)}
          @toggle=${(/** @type {CustomEvent} */ e) => setSubHidden(m, 'actions', e.detail.key, !e.detail.on)}></gf-sortable-list>
      </div>` : nothing}
    </section>`;
  }

  /**
   * « Par défaut »: the mode arranged back to its own layout — order, hidden blocks and sub-blocks, styles, titles
   * shown or not, « masqué si vide », panes, its action bar —, once confirmed in the app's question (gf-ask.js); the
   * names given to blocks, the Note and Carte blocks stay. The focus goes to « Barre d’actions » (the button pressed is
   * now greyed). @param {string} m
   */
  async #resetMode(m) {
    const label = modeLabel(m);
    if (!await confirmAsk({ title: `Remettre « ${label} » par défaut ?`, yes: 'Remettre par défaut', danger: true,
      text: 'Ordre, blocs et sous-blocs masqués, styles, titres affichés ou cachés, « masqué si vide », panneaux et barre d’actions de ce mode reviennent par défaut ; les noms donnés aux blocs, les blocs Note et Carte restent.' })) return;
    resetBlocks(m);
    this._maxEdge = null;
    this._said = `« ${label} » : mise en page par défaut`;
    await this.updateComplete;
    /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.king-bar .kb-actions'))?.focus();
  }

  /**
   * A Note block's ✕, once asked (the app's question): the block out of every mode, with what is written in it on each
   * plant's sheet (sheet-blocks.js deleteNote). @param {string} key @param {string} title
   */
  async #deleteNote(key, title) {
    if (await confirmAsk({ title: `Supprimer le bloc « ${title} » ?`, yes: 'Supprimer', danger: true,
      text: 'Le bloc quittera tous les modes ; ce qui y est écrit, sur la fiche de chaque plante, sera effacé. Cette action est définitive.' })) deleteNote(key);
  }

  /** An added Carte block's ✕, once asked: out of every mode, with its settings ⚙ (sheet-blocks.js deleteMap). @param {string} key @param {string} title */
  async #deleteMap(key, title) {
    if (await confirmAsk({ title: `Supprimer la carte « ${title} » ?`, yes: 'Supprimer', danger: true,
      text: 'Le bloc quittera tous les modes, avec ses réglages ⚙.' })) deleteMap(key);
  }

  /** A mode chosen in the bar: the focus, if it went with the button pressed (↺, gone once back), on the mode now arranged. */
  async #modeFocus() {
    await this.updateComplete;
    const modes = /** @type {any} */ (this.renderRoot.querySelector('.king-bar gf-mode-switch'));
    await modes?.updateComplete;
    if (modes && !modes.shadowRoot.activeElement) /** @type {HTMLElement | null} */ (modes.shadowRoot.querySelector('.segmented > [aria-pressed="true"]'))?.focus();
  }

  /** « Terminé »: King closed, the focus back on the crown that opened it. */
  #endKing = async () => {
    closeKing();
    await this.updateComplete;
    /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.act.crown > button'))?.focus({ preventScroll: true });
  };

  /** « Terminé » asked by the sheet's host: Échap there (gf-flora, gf-collections) ends King, never closes the sheet. */
  endKing() { return this.#endKing(); }

  /** A page arrived for the « Page web » pane: its tab shown, unfolded. */
  revealWeb() {
    const pane = this._paneOf('web');
    if (pane && (pane.active !== 'web' || pane.folded)) this.#setStack(pane.id, { active: 'web', folded: false });
  }

  updated() {
    // A « Page web » pane in this layout: the app's links to other sites come to it.
    if (this._paneOf('web')) registerWebPane(this); else unregisterWebPane(this);
    // The sheet scrolls in its middle when it has edges: the host itself does not.
    this.toggleAttribute('edged', Boolean(this.renderRoot.querySelector('.frame.edged')));
    // The action bar's height: the rubrics stacked at the bottom wait above it.
    const bar = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.action-bar'))?.offsetHeight || 0;
    if (this.style.getPropertyValue('--bar-h') !== bar + 'px') this.style.setProperty('--bar-h', bar + 'px');
    // The bar « Mise en page de la fiche » (personalising): measured now, and again as it grows (#barSize).
    const kingBar = this.renderRoot.querySelector('.king-bar');
    if (kingBar !== this.#barSeen) {
      if (this.#barSeen) this.#barSize.unobserve(this.#barSeen);
      if (kingBar) this.#barSize.observe(kingBar);
      this.#barSeen = kingBar;
    }
    this.#kingBarSized();
    // A block's title, stuck under the rubrics: the article's theme read sticks under it.
    const title = this.renderRoot.querySelector('.rubric > .block:not(.headless) > .block-title');
    const th = title ? Math.round(title.getBoundingClientRect().height) : 0;
    if (th && this.style.getPropertyValue('--title-h') !== th + 'px') this.style.setProperty('--title-h', th + 'px');
    this.#stackMode();
    // The plant is drawn: at the place read on the previous one. The card underneath (a preview) is put there too,
    // ready to come on top; on top, it is put there again (the place read may have changed meanwhile) — already
    // there, nothing moves.
    if (!this.#placed && this._plant && !this._plant.failed) { this.#placed = true; this.#place(); }
    else if (this.#promoted && this._plant && !this._plant.failed) this.#place();
    else if (this.#rePlace) this.#placeAgain(this.#rePlace);
    this.#rePlace = null;
    this.#promoted = false;
    this.#keepFix?.();
  }

  /**
   * How the rubrics stack: all of them, stuck above and below like the filters' (« full »), when that leaves most
   * of the sheet to read once the block's title is stuck too (STACK_ENTER; it stays so down to STACK_LEAVE: no flip
   * for a few pixels); else the rubric read alone at the top, pushed by the next (« push »: phones, low panes). Mode
   * King and a sheet without rubrics: none. A place reached, untouched since, is reached again under the new stack.
   */
  #stackMode() {
    const h = this.#sheetScroller.clientHeight;
    if (!h) return;
    if (this.style.getPropertyValue('--sheet-h') !== h + 'px') this.style.setProperty('--sheet-h', h + 'px');
    const count = this.#rubCount();
    const was = this.getAttribute('stack');
    let mode = 'none';
    if (count) {
      const room = (h - count * this.#rubH() - this.#barH() - this.#titleH()) / h;
      mode = room >= (was === 'full' ? STACK_LEAVE : STACK_ENTER) ? 'full' : 'push';
    }
    if (was === mode) return;
    this.setAttribute('stack', mode);
    const read = this.#readPlace().el;
    if (read) this.#padTo(read); else this.#padBase();
    const place = this.#lastPlace;
    if (was && !this.#handAt && place?.el.isConnected && !this.#keeper) requestAnimationFrame(() => { if (place.el.isConnected && !this.#handAt) this.#arrive(place.el, { quiet: true, prefer: place.prefer }); });
  }

  /** A block read without its title (King › title on/off, per view). @param {string} key */
  #headless = key => !isTitleShown(this._view, key);

  /** A block as read outside King: its title, its content. @param {string} key @param {any} ctx */
  #plainBlock(key, ctx) {
    // A component that hides itself when it has nothing (protection, look-alikes, calendar): the block goes with it (CSS).
    const headless = this.#headless(key);
    return html`<section class="block ${headless ? 'headless' : ''} ${hidesEmpty(this._view, key) ? 'hide-empty' : ''} ${isMap(key) ? 'map-block' : ''}" data-key=${key}>
      ${headless ? this.#paneButton(key) : html`<h2 class="block-title"><span class="name">${blockTitle(key)}</span>${this.#paneButton(key)}</h2>`}
      <div class="content">${this.inPane === key ? this.#shownInPane(key) : this._content(key, ctx)}</div>
    </section>`;
  }

  /** A block open in the pane beside: a line saying so (and bringing it back). @param {string} key */
  #shownInPane(key) {
    return html`<p class="muted in-pane">${icon('arrows-angle-expand')} « ${blockTitle(key)} » affiché dans le panneau, à côté.</p>`;
  }

  /** Blocks that make no sense alone in a pane. */
  static NO_PANE = ['name', 'actions', 'media', 'web'];

  /** ⤢ on a block: open it in the pane beside the sheet. @param {string} key */
  #paneButton(key) {
    if (this.preview || GfPlantDetail.NO_PANE.includes(key) || isNote(key)) return nothing;
    return html`<button class="icon-btn to-pane" type="button" title="Ouvrir en panneau, à côté de la fiche" aria-label=${`Ouvrir « ${blockTitle(key)} » en panneau`}
      @click=${() => this._openPane(key)}>${icon('arrows-angle-expand')}</button>`;
  }

  /** @param {string} key @param {any} ctx @param {number | null} slot  place shown while dragging (CSS order: the nodes do not move) */
  #block(key, ctx, slot) {
    const title = blockTitle(key);
    const off = isHidden(this._view, key);
    const module = blockModuleName(key);
    // Its service off for the whole device: folded, nothing to show; only Réglages › Modules brings it back.
    const cut = serviceOffNote(key);
    const dragging = this._dragKey === key;
    const subsOpen = this._subsOpen.has(key);
    const style = slot === null ? '' : `order:${slot}${dragging ? `;transform:translateY(${this._dragY}px)` : ''}`;
    const titled = isTitleShown(this._view, key);
    // Safety (Plantes à confondre, Usages and its Prudence): a padlock instead of the trash; touched, it says why.
    const lockWhy = `« ${title} » ne se masque dans aucun mode : sécurité`;
    return html`<section class="block ${off ? 'off' : ''} ${dragging ? 'dragging' : ''} ${titled ? '' : 'untitled'} ${isMap(key) ? 'map-block' : ''}" data-key=${key} style=${style}>
      <h2 class="block-title" title="Glisser pour déplacer" @pointerdown=${e => this.#press(e, key)}>
        <button class="grip" type="button" aria-label="Déplacer le bloc « ${title} »" title="Glisser pour déplacer (↑ ↓ au clavier)"
          @keydown=${e => this.#gripKey(e, key)}>${icon('grip-vertical')}</button>
        ${this._renaming === key
          ? html`<input class="rename" aria-label="Nouveau nom du bloc « ${title} »" .value=${title} maxlength="60"
              @keydown=${e => {
                if (e.key !== 'Enter' && e.key !== 'Escape') return;
                // (No keypress left: « Renommer », focused by then, would take this Entrée and open the field again.)
                e.preventDefault();
                if (e.key === 'Enter') this.#rename(key, e.target.value); else this._renaming = null;
                // Ended at the keyboard: the focus back on « Renommer » (a click elsewhere keeps it where it went).
                this.#toolFocus(key, 'rename');
              }}
              @blur=${e => this.#rename(key, e.target.value)} />`
          : html`<span class="name">${title}</span>`}
        <span class="cat" title=${categoryOf(blockCategory(key)).question}>${categoryOf(blockCategory(key)).label}</span>
        ${cut ? html`<small class="off-note">${cut} (Réglages › Modules)</small>` : nothing}
        <button class="tool" type="button" aria-pressed=${titled ? 'true' : 'false'} aria-label=${(titled ? 'Masquer' : 'Montrer') + ` le titre « ${title} » à la lecture`}
          title=${titled ? 'Titre affiché (toucher pour le cacher)' : 'Titre caché à la lecture (toucher pour l’afficher)'}
          @click=${() => setTitleShown(this._view, key, !titled)}>${icon('type-h2')}</button>
        ${canBeEmpty(key) ? html`<button class="tool" type="button" aria-pressed=${hidesEmpty(this._view, key) ? 'true' : 'false'}
          aria-label=${hidesEmpty(this._view, key) ? `Afficher « ${title} » même vide, à la lecture` : `Ne pas afficher « ${title} » s’il est vide, à la lecture`}
          title=${hidesEmpty(this._view, key) ? 'Masqué quand il est vide (toucher pour l’afficher quand même)' : 'Affiché même vide (toucher pour le masquer quand il est vide)'}
          @click=${() => setHidesEmpty(this._view, key, !hidesEmpty(this._view, key))}>${icon('eye-slash')}</button>` : nothing}
        ${['name', 'actions'].includes(key) ? nothing : this.#placePicker(key)}
        ${this._renaming === key ? nothing : html`<button class="tool" type="button" data-tool="rename" aria-label="Renommer le bloc « ${title} »" title=${isNote(key) ? 'Renommer' : 'Renommer (vide : nom d’origine)'}
          @click=${() => this.#startRename(key)}>${icon('pencil')}</button>`}
        ${STYLES[key] ? html`<span class="styles" role="group" aria-label="Style du bloc « ${title} »">${STYLES[key].styles.map(st => html`
          <button type="button" aria-pressed=${blockStyle(this._view, key) === st.key ? 'true' : 'false'} title=${'Style : ' + st.title}
            @click=${() => setBlockStyle(this._view, key, st.key)}>${icon(/** @type {any} */ ({ list: 'list-ul', graph: 'diagram-3', scene: 'image', mosaic: 'images', slideshow: 'arrows-fullscreen' })[st.key] || 'table')} ${st.title}</button>`)}</span>` : nothing}
        ${SUBS[key] ? html`<button class="tool" type="button" aria-expanded=${subsOpen ? 'true' : 'false'} aria-label="Sous-blocs de « ${title} »" title="Sous-blocs : ordre et présence"
          @click=${() => { const open = new Set(this._subsOpen); if (subsOpen) open.delete(key); else open.add(key); this._subsOpen = open; }}>${icon('list-nested')}</button>` : nothing}
        ${cut ? this.#cutTools(key, title, cut)
          : isLocked(key)
          ? html`<button class="tool lock" type="button" aria-label=${lockWhy} title="Ne se masque dans aucun mode : sécurité"
              @click=${() => { this._lockTip = this._lockTip === key ? null : key; }}>${icon('lock-fill')}</button>`
          // Each swapped for the other: the focus goes to it.
          : off
          ? html`<button class="tool" type="button" data-tool="show" aria-label="Réafficher le bloc « ${title} »" title="Réafficher"
              @click=${() => { setHidden(this._view, key, false); this.#toolFocus(key, 'hide'); }}>${icon('arrow-counterclockwise')}</button>`
          : html`<button class="tool" type="button" data-tool="hide" aria-label="Masquer le bloc « ${title} »" title=${module ? `Masquer dans ce mode (le service ${module} reste utilisé)` : 'Masquer'}
              @click=${() => { if (key === 'web' && this._paneOf('web')) this.#putAwayWeb(); else setHidden(this._view, key, true); this.#toolFocus(key, 'show'); }}>${icon('trash3')}</button>`}
        ${isMap(key) && !off ? html`<button class="tool" type="button" aria-expanded=${this._mapsOpen.has(key) ? 'true' : 'false'} aria-label="Configurer la carte « ${title} »" title="Ce que la carte montre et permet"
          @click=${() => { const open = new Set(this._mapsOpen); if (open.has(key)) open.delete(key); else open.add(key); this._mapsOpen = open; }}>${icon('gear')}</button>` : nothing}
        ${isNote(key) ? html`<button class="tool" type="button" aria-label="Supprimer le bloc « ${title} »" title="Supprimer le bloc et ses textes"
          @click=${() => this.#deleteNote(key, title)}>${icon('x-lg')}</button>` : nothing}
        ${isAddedMap(key) ? html`<button class="tool" type="button" aria-label="Supprimer le bloc « ${title} »" title="Supprimer cette carte"
          @click=${() => this.#deleteMap(key, title)}>${icon('x-lg')}</button>` : nothing}
      </h2>
      ${isLocked(key) ? html`<p class="lock-tip" role="status">${this._lockTip === key ? lockWhy : nothing}</p>` : nothing}
      ${subsOpen && SUBS[key] ? html`<div class="subs-editor">
        <gf-sortable-list label=${'Sous-blocs de ' + title}
          .items=${subOrder(this._view, key).map(k => ({ key: k, label: subTitle(key, k), checked: !isSubHidden(this._view, key, k), locked: isSubLocked(key, k) }))}
          @reorder=${e => setSubOrder(this._view, key, e.detail.keys)}
          @toggle=${e => setSubHidden(this._view, key, e.detail.key, !e.detail.on)}></gf-sortable-list>
      </div>` : nothing}
      ${isMap(key) && !off && this._mapsOpen.has(key) ? this.#mapForm(key) : nothing}
      ${off ? nothing : html`<div class="content">${this._content(key, ctx)}</div>`}
    </section>`;
  }

  /**
   * A block whose service is off (Réglages › Modules): the way there, and its own choice in this mode — kept hidden
   * when the service comes back, or back with it (named « Garder… », not « Réafficher »: the service decides now).
   * @param {string} key @param {string} title @param {string} cut what is off, said
   */
  #cutTools(key, title, cut) {
    const kept = foldedByHand(this._view, key);
    return html`<a class="tool" href=${href.settings('modules')} aria-label=${`Réglages › Modules : ${cut}`} title="Réglages › Modules">${icon('gear')}</a>
      <button class="tool" type="button" aria-pressed=${kept ? 'true' : 'false'} aria-label=${`Garder « ${title} » masqué dans ce mode`}
        title=${kept ? 'Restera masqué dans ce mode quand le service reviendra' : 'Reviendra dans ce mode avec son service'}
        @click=${() => setHidden(this._view, key, !kept)}>${icon('trash3')}</button>`;
  }

  /** « Page web » taken out of its pane: hidden (it shows in a pane only; its chip in « Ajouter » puts it in one again). */
  #putAwayWeb() {
    this.#toSheet('web');
    setHidden(this._view, 'web', true);
  }

  /**
   * A block's tool swapped for another (Masquer ↔ Réafficher, the name field back to « Renommer »): the focus on that
   * one, once drawn — in the sheet (a block put away from its pane comes back there). @param {string} key @param {string} tool
   */
  async #toolFocus(key, tool) {
    await this.updateComplete;
    /** @type {HTMLElement | null} */ (this.renderRoot.querySelector(`.block[data-key="${CSS.escape(key)}"] .block-title [data-tool="${tool}"]`))?.focus();
  }

  /** @param {string} key */
  async #startRename(key) {
    this._renaming = key;
    await this.updateComplete;
    const input = /** @type {HTMLInputElement | null} */ (this.renderRoot.querySelector('.block-title input.rename'));
    input?.focus();
    input?.select();
  }

  /** @param {string} key @param {string} title */
  #rename(key, title) {
    if (this._renaming !== key) return;
    this._renaming = null;
    renameBlock(key, title);
  }

  /** King, after the blocks: a new « Note » block. */
  #newNote() {
    return this._newNote
      ? html`<form class="new-note" @submit=${e => {
          e.preventDefault();
          const key = createNote(e.target.elements.title.value);
          this._newNote = false;
          this.updateComplete.then(() => this.renderRoot.querySelector(`.block[data-key="${key}"] textarea`)?.focus());
        }}>
          <input name="title" aria-label="Nom du bloc Note" placeholder="Nom du bloc (ex. Récolte)" maxlength="60" required />
          <button class="primary" type="submit">Créer</button>
          <button type="button" @click=${() => { this._newNote = false; }}>Annuler</button>
        </form>`
      : html`<p class="new-note"><button type="button" @click=${async () => {
          this._newNote = true;
          await this.updateComplete;
          /** @type {HTMLInputElement | null} */ (this.renderRoot.querySelector('.new-note input'))?.focus();
        }}>${icon('plus-lg')} Bloc Note</button>
        <button type="button" @click=${async () => {
          const key = createMap('Carte');
          this._mapsOpen = new Set([...this._mapsOpen, key]);
          await this.updateComplete;
          this.renderRoot.querySelector(`.block[data-key="${key}"]`)?.scrollIntoView({ block: 'center' });
        }}>${icon('plus-lg')} Bloc Carte</button></p>`;
  }


  /** A map of the sheet found its « Ma région » (or none). @param {Event} e */
  #onMapRegion = e => { this._mapRegion = /** @type {CustomEvent} */ (e).detail; };

  /**
   * King: what a map block shows and lets do (the same in every mode). Its background, IGN's layers and 2D / 3D:
   * its panel ▦, as on every map (gf-map-options.js) — said here.
   * @param {string} key
   */
  #mapForm(key) {
    const c = mapConfig(key);
    // « Ma région » offered only when known; chosen but unknown, said as what the map does then (France).
    /** @type {[string, string][]} */
    const frames = [['auto', 'Automatique (selon les couches)'], ['france', 'France entière'], ['world', 'Monde entier'], ['content', 'Ajusté à ce qui est affiché'], ['me', 'Autour de moi']];
    if (this._mapRegion) frames.push(['region', `Ma région (${this._mapRegion.name})`]);
    else if (c.frame === 'region') frames.push(['region', 'Ma région (inconnue : France entière)']);
    const set = (/** @type {any} */ patch) => setMapConfig(key, patch);
    /** @param {string} label @param {string} field @param {[string, string][]} options */
    const select = (label, field, options) => html`<label>${label}
      <select @change=${(/** @type {any} */ e) => set({ [field]: e.target.value })}>
        ${options.map(([value, text]) => html`<option value=${value} ?selected=${/** @type {any} */ (c)[field] === value}>${text}</option>`)}
      </select></label>`;
    const check = (/** @type {string} */ label, /** @type {boolean} */ on, /** @type {(on: boolean) => void} */ change) =>
      html`<label class="check"><input type="checkbox" .checked=${on} @change=${(/** @type {any} */ e) => change(e.target.checked)} /> ${label}</label>`;
    const action = (/** @type {keyof typeof c.actions} */ a, /** @type {string} */ label) => check(label, c.actions[a], on => set({ actions: { [a]: on } }));
    return html`<div class="map-form" role="group" aria-label="Réglages de la carte">
      <fieldset><legend>Sujet</legend>
        ${select('La carte montre', 'subject', [['plant', 'Cette plante'], ['results', 'Les résultats (recherche et filtres)'], ...(c.subject === 'collection' ? [['collection', 'Une liste ou un lieu (choisi sous la carte)']] : [])])}
      </fieldset>
      <fieldset><legend>Couches</legend>
        ${select('Répartition GBIF', 'gbif', [['fr', 'France'], ['world', 'Monde'], ['off', 'Non']])}
        ${check('Mes lieux de cette plante (et chaque plant)', c.places, on => set({ places: on }))}
        ${select('Observations proches', 'near', [['off', 'Non'], ['both', 'iNaturalist et GBIF'], ['inat', 'iNaturalist'], ['gbif', 'GBIF']])}
      </fieldset>
      <fieldset><legend>Affichage</legend>
        ${select('Cadrage', 'frame', frames)}
        ${select('Hauteur', 'height', [['s', 'Petite'], ['m', 'Moyenne'], ['l', 'Grande']])}
      </fieldset>
      <fieldset><legend>Actions</legend>
        ${action('open', 'Ouvrir dans la Carte')}
        ${action('create', 'Créer un lieu ici (appui long)')}
        ${action('edit', 'Déplacer mes plantes notées (✎)')}
        ${action('spot', 'Noter ici')}
        ${action('locate', 'Me localiser')}
      </fieldset>
      <p class="look-note">Fond, couches IGN, 2D ou 3D : dans le panneau ▦ de la carte (${c.look ? `cette carte a ${ownWords(c.look, lookFor(c.look).base)} ; le panneau propose de revenir aux réglages communs` : 'réglages communs à toutes les cartes'}).</p>
    </div>`;
  }


  /** An order of the flow, with the pinned blocks back where they were. @param {any} view @param {string[]} order */
  #withPinned(view, order) {
    const all = blockOrder(view);
    const out = [...order];
    all.forEach((k, i) => {
      if (out.includes(k)) return;
      const before = all.slice(0, i).reverse().find(b => out.includes(b));
      out.splice(before ? out.indexOf(before) + 1 : 0, 0, k);
    });
    return out;
  }

  /** @param {string} key @param {-1 | 1} delta @param {string[]} order */
  #moved(key, delta, order) {
    const i = order.indexOf(key), j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return null;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  }

  /**
   * ↑ ↓ on a focused grip: one place up or down, saved; the grip keeps the focus, in view (never under the bar stuck
   * above: the sheet's scroll padding, #pad). @param {KeyboardEvent} e @param {string} key
   */
  async #gripKey(e, key) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const order = this.#moved(key, e.key === 'ArrowUp' ? -1 : 1, blockOrder(this._view).filter(k => !isOnEdge(this._view, k)));
    if (!order) return;
    setBlockOrder(this._view, this.#withPinned(this._view, order));
    await this.updateComplete;
    const grip = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector(`.block[data-key="${key}"] .grip`));
    grip?.focus();
    grip?.scrollIntoView({ block: 'nearest' });
  }

  /**
   * King: dragging a block (its title, its tab, a chip of the palette) arranges the tree of panes —
   * dock-drag.js shows where it lands: a new pane on a side, a tab, back in the sheet between two blocks.
   * @param {PointerEvent} e @param {string} key @param {(() => string) | null} [make] a new block made on the drop (palette « Nouvelle carte »)
   */
  #press(e, key, make = null) {
    const el = /** @type {Element} */ (e.target);
    if (e.button !== 0 || el.closest('button:not(.grip):not([data-drag-key]), a[href], summary, details, input, textarea, select')) return;
    // A finger on a block's title scrolls the sheet: it drags by the grip ⠿ only (tabs and chips drag as they are).
    if (e.pointerType === 'touch' && el.closest('.block-title') && !el.closest('.grip')) return;
    pressDock(e, {
      root: /** @type {ShadowRoot} */ (this.renderRoot), key, label: make ? key : blockTitle(key),
      sheetFallback: this.renderRoot.querySelector('article'),
      onStart: () => this.toggleAttribute('docking', true),
      onEnd: () => this.toggleAttribute('docking', false),
      onDrop: ({ target, zone, beforeKey }) => {
        const k = make ? make() : key;
        // « Page web » shows in a pane only: dropped in the sheet, it is put away (its chip brings it back).
        if (k === 'web' && zone === 'sheet') { this.#putAwayWeb(); this._said = `« ${blockTitle(k)} » : masqué (il ne s’affiche que dans un panneau)`; return; }
        const moved = zone === 'sheet' ? (this.#toSheet(k, beforeKey), true) : this.#dock(k, target, zone);
        this._said = `« ${blockTitle(k)} » : ${!moved ? TOO_DEEP : zone === 'sheet' ? 'dans la fiche' : typeof zone === 'object' || zone === 'center' ? 'onglet d’un panneau' : 'nouveau panneau'}`;
      }
    });
  }

  /**
   * King: the blocks to add — those folded in this mode (not those folded only because their service is off:
   * Réglages › Modules brings them back), and new map and note blocks; dragged to a place (or touched: back in the sheet).
   */
  #palette() {
    const hidden = blockOrder(this._view).filter(k => foldedByHand(this._view, k) && k !== 'actions');
    return html`<div class="palette" aria-label="Ajouter un bloc : glisser vers la fiche ou un panneau">
      <span class="pal-title">${icon('plus-lg')} Ajouter</span>
      ${hidden.map(k => k === 'web'
        // « Page web » shows in a pane only: touched (or Entrée), a new pane on the right of the sheet.
        ? html`<button type="button" class="chip" data-drag-key=${k} title="Toucher : dans un nouveau panneau à droite ; ou glisser vers un panneau"
            @pointerdown=${(/** @type {PointerEvent} */ e) => this.#press(e, k)}
            @click=${() => { this._said = `« ${blockTitle(k)} » : ${this.#dock(k, 'sheet', 'right') === false ? TOO_DEEP : 'nouveau panneau à droite de la fiche'}`; this.#focusMoved(k); }}>${icon(categoryOf(blockCategory(k)).icon)} ${blockTitle(k)}</button>`
        : html`<button type="button" class="chip" data-drag-key=${k} title="Glisser vers un panneau, ou toucher pour l’afficher dans la fiche"
            @pointerdown=${(/** @type {PointerEvent} */ e) => this.#press(e, k)} @click=${() => this.#toSheet(k)}>${icon(categoryOf(blockCategory(k)).icon)} ${blockTitle(k)}</button>`)}
      <button type="button" class="chip new" data-drag-key="new-map" title="Glisser une nouvelle carte vers un panneau"
        @pointerdown=${(/** @type {PointerEvent} */ e) => this.#press(e, 'Nouvelle carte', () => createMap('Carte'))}>${icon('map')} Nouvelle carte</button>
    </div>`;
  }

  // ── The three views: their own header, then the same blocks ─────────────────────────────────────────────

  /** Épuré: the plant at a glance, and one tap to put it in the current collection. @param {any} ctx */
  #epure(ctx) {
    return this.#layout(ctx, html`
      <article class="epure">
        <gf-add-to .plant=${ctx.plant}></gf-add-to>
        ${this.#blocks(ctx)}
      </article>`);
  }

  /** Standard (for everyone) and Scientifique (everything the app holds or can fetch, each with its source). @param {any} ctx */
  #full(ctx) {
    return this.#layout(ctx, html`
      <article class=${baseOf(this._view) === 'scientific' ? 'science' : ''}>
        <gf-add-to .plant=${ctx.plant}></gf-add-to>
        ${this._error ? html`<p class="muted">${this._error}</p>` : nothing}
        ${this.#blocks(ctx)}
      </article>`);
  }
}

customElements.define('gf-plant-detail', GfPlantDetail);
