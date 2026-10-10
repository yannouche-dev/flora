// @ts-check
// « Médias »: every image of a plant in one viewer, with one zoom that works the way photo apps do.
//  - The image shows at once from its thumbnail (blurred), then its display size fades in; zooming past what
//    the display size holds loads the original, on its own — there is nothing to choose.
//  - « Plein cadre »: the image fills the stage's width whenever its definition allows it; the map of the
//    whole image lies over the right edge (at the stage's height when it is narrow enough), showing the part seen.
//  - Zoom in place: double-click / double-tap (at that point), pinch, Ctrl + wheel (and the wheel alone when
//    the viewer is alone in a pane), + / − / 0 keys, the − % + buttons; drag to move around, or on the map.
//  - Browse: ‹ ›, the filmstrip, ← → (when the viewer has the focus), a swipe when not zoomed.
//  - Calm: the credit in one line under the image, « ⓘ » for the details; the controls fade when the pointer rests.
//  - Parts (Trefle): flower, leaf, fruit, bark, habit — an icon menu filtering every presentation.
//  - The same display from one plant to the next (filters, zoom choice, details, slideshow): sheet-session.js.
// Two sizes: in a pane (beside the sheet, full screen…) and `compact`, the « Médias » block of the sheet, whose
// frame keeps one shape (nothing jumps from one plant to the next) and where the wheel scrolls the sheet.

import { LitElement, html, css, nothing } from 'lit';
import * as db from '../core/db.js';
import { icon } from '../core/icons.js';
import { imageKey, loadMedia, PARTS } from '../core/media-items.js';
import { sheetSession, setMediaSession } from '../core/sheet-session.js';
import { ui } from '../styles/ui.js';
import './gf-attribution.js';

/** @typedef {import('../core/media-items.js').MediaItem} MediaItem */

const KINDS = /** @type {const} */ ([['all', 'Tous les médias'], ['photo', 'Photos'], ['observation', 'Observations'], ['herbarium', 'Herbier']]);
const KIND_LABEL = { photo: 'Photo', observation: 'Photo d’observation', herbarium: 'Planche d’herbier' };
/** The part menu: label and icon of each part. */
const PART_INFO = { all: ['Toutes les parties', 'images'], flower: ['Fleur', 'flower3'], leaf: ['Feuille', 'leaf'], fruit: ['Fruit', 'fruit'],
  bark: ['Écorce', 'bark'], habit: ['Port', 'tree'], other: ['Autre', 'three-dots'] };
/** The map of the whole image: at the stage's height when it takes at most this share of its width (else smaller). */
const MAP_SHARE = 0.45, MAP_SHARE_NARROW = 0.35;
const nf = new Intl.NumberFormat('fr-FR');
/** @param {number} v @param {number} a @param {number} b */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class GfMediaViewer extends LitElement {
  static properties = {
    plantId: { type: Number, attribute: 'plant-id' },
    /** The block's title (compact). */
    label: {},
    view: {},
    /** Open at this item (the URL's ?i=n), applied once the media are loaded. */
    index: { type: Number },
    /** Open at the image of this URL (a photo clicked on the sheet). */
    startUrl: { attribute: 'start-url' },
    /** In the sheet: a block among the others (the wheel scrolls the sheet). */
    compact: { type: Boolean, reflect: true },
    /** Stuck to an edge of the plant pane. */
    local: { type: Boolean, reflect: true },
    /** 'scene' (stage and filmstrip), 'mosaic' (every image in a grid) or 'slideshow' (one image, full frame). */
    presentation: { reflect: true },
    _opened: { state: true },
    _playing: { state: true },
    _plant: { state: true },
    _items: { state: true },
    _done: { state: true },
    _key: { state: true },
    _filter: { state: true },
    _part: { state: true },
    /** Zoom: scale over « fit » (1 = the whole image) and offset of its centre from the stage's, in px. */
    _z: { state: true },
    _tx: { state: true },
    _ty: { state: true },
    /** Stage size, and the shown image's natural size (the original's when known). */
    _stage: { state: true },
    _natural: { state: true },
    /** Layers of the shown image: the display size loaded, the original asked / loaded / failed. */
    _loaded: { state: true },
    _hd: { state: true },
    _info: { state: true },
    _idle: { state: true },
    _failed: { state: true }
  };

  static styles = [ui, css`
    :host { display: flex; flex-direction: column; min-height: 0; flex: 1; background: var(--gf-surface); container-type: inline-size; outline: none; }
    .bar { display: flex; align-items: center; gap: 6px; padding: 4px 6px 4px 12px; border-bottom: 1px solid var(--gf-border); min-height: 42px; flex: none; }
    .bar h2 { margin: 0; font-size: 0.95rem; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .bar .count { color: var(--gf-text-muted); font-variant-numeric: tabular-nums; font-size: 0.85rem; white-space: nowrap; }
    .bar select { font: inherit; font-size: 0.8rem; padding: 2px 6px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-sm); background: var(--gf-surface); color: var(--gf-text); max-width: 46%; }
    .icon-btn[aria-pressed="true"] { background: var(--gf-accent-soft); color: var(--gf-accent); }

    .main { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); position: relative; }
    @container (min-width: 760px) { .main.with-info { grid-template-columns: minmax(0, 1fr) clamp(240px, 30%, 380px); } }

    /* The stage: the image fitted, zoomed and moved by one transform. */
    .stage { position: relative; min-height: 200px; background: #111; overflow: hidden; user-select: none; -webkit-user-select: none; touch-action: none; cursor: zoom-in; outline: none; }
    :host([compact]) .stage { touch-action: pan-y; }
    :host([compact]) .stage.zoomed { touch-action: none; }
    /* In the sheet: one shape whatever the image (nothing jumps from one plant to the next). */
    :host([compact]) .stage { aspect-ratio: 4 / 3; max-height: 72vh; }
    @container (min-width: 560px) { :host([compact]) .stage { aspect-ratio: 3 / 2; } }
    .stage.zoomed { cursor: grab; }
    .stage.dragging { cursor: grabbing; }
    /* Where the image does not cover the stage: the same image, enlarged and blurred, behind it. */
    .backdrop { position: absolute; inset: -40px; width: calc(100% + 80px); height: calc(100% + 80px); object-fit: cover; filter: blur(28px) saturate(1.15) brightness(0.6);
      pointer-events: none; -webkit-user-drag: none; }
    .frame { position: absolute; left: 50%; top: 50%; transform-origin: center; will-change: transform; overflow: hidden; }
    .frame.ready .ph { visibility: hidden; }
    .frame img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none; -webkit-user-drag: none; }
    .frame .ph { filter: blur(10px); transform: scale(1.04); }
    .frame .disp, .frame .hd { opacity: 0; transition: opacity 0.25s; }
    .frame .disp.on, .frame .hd.on { opacity: 1; }
    .stage.animate .frame { transition: transform 0.22s ease-out; }
    .nav { position: absolute; top: 50%; translate: 0 -50%; z-index: 3; width: 40px; height: 56px; border: 0; border-radius: var(--gf-radius-sm);
      background: rgb(0 0 0 / 38%); color: #fff; font-size: 1.2rem; display: grid; place-items: center; cursor: pointer; transition: opacity 0.2s; }
    .nav:hover { background: rgb(0 0 0 / 62%); }
    .nav.prev { left: 6px; } .nav.next { right: 6px; }
    .nav:disabled { visibility: hidden; }
    .zoombar { position: absolute; right: 8px; bottom: 8px; z-index: 3; display: flex; align-items: center; gap: 2px; padding: 2px; border-radius: var(--gf-radius-pill);
      background: rgb(0 0 0 / 55%); color: #fff; transition: opacity 0.2s; }
    .zoombar button { min-height: 0; height: 30px; min-width: 30px; padding: 0 8px; border: 0; border-radius: var(--gf-radius-pill); background: none; color: #fff; font: inherit; font-size: 0.8rem; font-variant-numeric: tabular-nums; cursor: pointer; }
    .zoombar button:hover { background: rgb(255 255 255 / 15%); }
    .zoombar button:disabled { opacity: 0.4; cursor: default; }
    .zoombar .pct { min-width: 92px; }
    /* The map comes in softly. */
    .minimap { animation: map-in 0.25s ease-out; }
    @keyframes map-in { from { opacity: 0; transform: translateX(8px); } }
    /* The frame's size follows the image's shape smoothly (a guessed shape corrected). */
    .stage.animate .frame { transition: transform 0.22s ease-out, width 0.22s ease-out, height 0.22s ease-out; }
    .hd-state { position: absolute; left: 8px; bottom: 8px; z-index: 3; padding: 3px 9px; border-radius: var(--gf-radius-pill); background: rgb(0 0 0 / 55%); color: #fff; font-size: 0.72rem; pointer-events: none; }
    /* The controls fade while the pointer rests (wide, mouse). */
    .stage.idle .nav, .stage.idle .zoombar { opacity: 0; }
    .stage:focus-visible { box-shadow: inset var(--gf-focus); }
    /* The image past the stage: the whole of it laid over the right edge, at the stage's height, and the part seen. */
    .minimap { position: absolute; right: 8px; top: 8px; z-index: 3; border: 1px solid rgb(255 255 255 / 45%); border-radius: 4px; overflow: hidden;
      background: rgb(0 0 0 / 70%); box-shadow: 0 2px 12px rgb(0 0 0 / 45%); cursor: crosshair; touch-action: none; transition: opacity 0.3s; }
    .minimap img { display: block; width: 100%; height: 100%; object-fit: fill; pointer-events: none; }
    .minimap .view { transition: left 0.22s ease-out, top 0.22s ease-out; }
    .stage.dragging .minimap .view, .minimap.dragging .view { transition: none; }
    .minimap .view { position: absolute; border: 1px solid rgb(255 255 255 / 85%); border-radius: 2px; box-shadow: 0 0 0 9999px rgb(0 0 0 / 18%); pointer-events: none; }
    .stage.idle .minimap { opacity: 0.9; }
    .nav.next { right: calc(var(--map-w, -8px) + 14px); }
    .zoombar { right: calc(var(--map-w, -8px) + 16px); }

    /* The credit under the image, one line; « ⓘ » for the details. */
    .caption { flex: none; display: flex; align-items: center; gap: 8px; padding: 4px 6px 4px 12px; border-top: 1px solid var(--gf-border); font-size: 0.78rem; color: var(--gf-text-muted); min-height: 39px; }
    .caption .what { white-space: nowrap; }
    .caption gf-attribution { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 0.78rem; }
    .caption .icon-btn { width: 30px; height: 30px; min-height: 0; flex: none; }
    .info { padding: 12px 14px; display: grid; gap: 8px; align-content: start; font-size: 0.9rem; background: var(--gf-surface); overflow: hidden auto; }
    .info h3 { margin: 0; font-size: 0.95rem; }
    .info .kind { color: var(--gf-text-muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }
    .info dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; font-size: 0.85rem; }
    .info dt { color: var(--gf-text-muted); }
    .info dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .info .links { display: flex; flex-wrap: wrap; gap: 8px; }
    .info .links a { display: inline-flex; align-items: center; gap: 5px; }
    .info .tip { color: var(--gf-text-muted); font-size: 0.8rem; margin: 0; }
    .info gf-attribution { white-space: normal; font-size: 0.82rem; }
    @container (min-width: 760px) { .main.with-info .info { border-left: 1px solid var(--gf-border); } }
    @container (max-width: 759px) { .main.with-info .info { position: absolute; left: 0; right: 0; bottom: 0; z-index: 5; max-height: 70%; border-top: 1px solid var(--gf-border); box-shadow: 0 -8px 20px rgb(0 0 0 / 25%); } }

    .strip { flex: none; border-top: 1px solid var(--gf-border); background: var(--gf-surface-2); padding: 6px 8px; }
    .thumbs { display: flex; gap: 6px; overflow-x: auto; scroll-behavior: smooth; scrollbar-width: none;
      mask-image: linear-gradient(90deg, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%); padding-inline: 4px; }
    .thumbs::-webkit-scrollbar { display: none; }
    .thumbs button { flex: none; width: 64px; height: 64px; padding: 0; border: 2px solid transparent; border-radius: var(--gf-radius-sm); overflow: hidden; background: var(--gf-surface); cursor: pointer; opacity: 0.8; }
    .thumbs button[aria-current="true"] { border-color: var(--gf-accent); opacity: 1; }
    .thumbs button:hover { opacity: 1; }
    .thumbs button:focus-visible { box-shadow: var(--gf-focus); outline: none; }
    .thumbs img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .thumbs .herbarium img { object-fit: contain; background: #f4f1e8; }
    :host([compact]) .thumbs button { width: 52px; height: 52px; }

    /* Mosaic: every image in a grid. */
    .mosaic-wrap { flex: 1; min-height: 0; overflow-y: auto; padding: 8px; background: var(--gf-surface-2); }
    .mosaic { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; }
    .mosaic button { padding: 0; border: 0; border-radius: var(--gf-radius-sm); overflow: hidden; aspect-ratio: 1; background: var(--gf-surface); cursor: zoom-in; }
    .mosaic button:focus-visible { box-shadow: var(--gf-focus); outline: none; }
    .mosaic img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.2s; }
    .mosaic button:hover img { transform: scale(1.04); }
    .mosaic .herbarium img { object-fit: contain; background: #f4f1e8; }
    :host([compact]) .mosaic-wrap { max-height: 70vh; }
    :host([compact]) .mosaic { grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); }
    .back-mosaic { display: inline-flex; align-items: center; gap: 4px; font-size: 0.85rem; }
    .play, .pause { font-size: 0.75rem; font-weight: 700; }

    /* In the sheet: framed, the stage takes the image's shape (within limits). */
    :host([compact]) { flex: none; border: 1px solid var(--gf-border); border-radius: var(--gf-radius); overflow: hidden; }
    :host([compact]) .bar { min-height: 38px; padding: 2px 4px 2px 10px; }
    .empty { padding: 24px; color: var(--gf-text-muted); text-align: center; }
    /* Parts of the plant (Trefle): one icon each. */
    .parts { display: flex; gap: 1px; padding: 2px; border-radius: var(--gf-radius-pill); background: var(--gf-surface-2); }
    .parts button { width: 30px; height: 28px; min-height: 0; padding: 0; border: 0; border-radius: var(--gf-radius-pill); background: none; color: var(--gf-text-muted);
      display: grid; place-items: center; cursor: pointer; }
    .parts button:hover:not(:disabled) { color: var(--gf-text); background: var(--gf-surface); }
    .parts button[aria-checked="true"] { background: var(--gf-surface); color: var(--gf-accent); box-shadow: 0 1px 3px rgb(0 0 0 / 15%); }
    .parts button:disabled { opacity: 0.3; cursor: default; }
    .parts button:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    /* Loading: the viewer's shape at once, so the sheet does not move when the images come. */
    .skel { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .skel .stage { cursor: default; background: linear-gradient(100deg, #1b1b1b 40%, #262626 50%, #1b1b1b 60%) 0 0 / 300% 100%; animation: shimmer 1.4s linear infinite; }
    .skel .stage .spinner { position: absolute; inset: auto 0 12px; text-align: center; color: rgb(255 255 255 / 60%); font-size: 0.8rem; }
    .skel .caption i { display: block; height: 10px; width: 45%; border-radius: 5px; background: var(--gf-surface-2); }
    .skel .thumbs i { flex: none; width: 64px; height: 64px; border-radius: var(--gf-radius-sm); background: var(--gf-surface); }
    :host([compact]) .skel .thumbs i { width: 52px; height: 52px; }
    @keyframes shimmer { to { background-position: -300% 0; } }
    @media (prefers-reduced-motion: reduce) {
      .thumbs { scroll-behavior: auto; } .mosaic img, .frame .disp, .frame .hd, .stage.animate .frame { transition: none; }
      .skel .stage { animation: none; }
    }
  `];

  constructor() {
    super();
    /** @type {number | null} */
    this.plantId = null;
    /** @type {string | null} */
    this.label = null;
    /** @type {any} */
    this.view = 'standard';
    this.index = 0;
    /** @type {string | null} */
    this.startUrl = null;
    this.compact = false;
    this.local = false;
    /** @type {string} */
    this.presentation = 'scene';
    // The display chosen on the previous plant.
    const m = sheetSession.media;
    this._opened = m.opened;
    this._playing = false;
    /** @type {any} */
    this._plant = null;
    /** @type {MediaItem[]} */
    this._items = [];
    this._done = false;
    /** The item shown, by key (items arriving later do not move it). @type {string | null} */
    this._key = null;
    /** @type {'all' | 'photo' | 'observation' | 'herbarium'} */
    this._filter = /** @type {any} */ (m.filter);
    /** @type {string} */
    this._part = m.part;
    this._z = 1; this._tx = 0; this._ty = 0;
    this._stage = { w: 0, h: 0 };
    /** @type {{ w: number, h: number } | null} */
    this._natural = null;
    this._loaded = false;
    /** @type {'none' | 'loading' | 'on' | 'error'} */
    this._hd = 'none';
    this._info = m.info;
    this._idle = false;
    /** Images that failed at a size: key → the next URL tried. @type {Map<string, string>} */
    this._failed = new Map();
  }

  /** @type {AbortController | null} */ #abort = null;

  firstUpdated() {
    // Alone in a pane: the keys are the viewer's at once (in the sheet, after a click in it).
    if (!this.compact && !this.local) this.focus({ preventScroll: true });
    if (sheetSession.media.playing && this.presentation === 'slideshow') this.#play(true);
  }

  connectedCallback() {
    super.connectedCallback();
    // The keys belong to the viewer only while it has the focus: the page (and ← → for plants) keeps its own.
    this.addEventListener('keydown', this.#onKey);
    if (!this.hasAttribute('tabindex')) this.tabIndex = -1;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this.#onKey);
    this.#abort?.abort();
    clearTimeout(this.#settleTimer);
    clearInterval(this.#timer);
    clearTimeout(this.#idleTimer);
    this.#stageObserver.disconnect();
  }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if ((changed.has('plantId') || changed.has('view')) && this.plantId != null) this.#load();
    // Another image asked by the address (Back / Forward, a link) while the viewer is open.
    else if (changed.has('index') && changed.get('index') !== undefined && this._done && this._items[this.index]) { this._filter = 'all'; this.#select(this._items[this.index]); }
    // Another photo clicked on the sheet while the viewer is open.
    else if (changed.has('startUrl') && this.startUrl) {
      const want = imageKey(this.startUrl);
      const found = this._items.find(i => i.key === want);
      if (found) { this._filter = 'all'; this.#select(found); }
    }
    if (changed.has('_key')) this.#resetImage();
    // Until the user zooms or moves, the image keeps the chosen view (its shape and the stage's can still change).
    // The true shape arriving (or the stage resized) eases the image into place; a new image starts there.
    if (!this.#touched && (changed.has('_key') || changed.has('_stage') || changed.has('_natural'))) this.#toHome(!changed.has('_key') && this._loaded);
    // The display follows to the next plant.
    if (changed.has('_filter') || changed.has('_part') || changed.has('_info') || changed.has('_opened') || changed.has('_playing')) {
      setMediaSession({ filter: this._filter, part: this._part, info: this._info, opened: this._opened, playing: this._playing });
    }
  }

  async #load() {
    this.#abort?.abort();
    const abort = this.#abort = new AbortController();
    this._items = []; this._done = false; this._key = null;
    this.#settled = false;
    clearTimeout(this.#settleTimer);
    const plant = await db.get('plants', /** @type {number} */ (this.plantId)).catch(() => null);
    if (abort.signal.aborted) return;
    this._plant = plant;
    if (!plant) { this._done = true; return; }
    await loadMedia(plant, this.view, abort.signal, (items, done) => {
      this._items = items;
      this._done = done;
      if (this._key === null && this.startUrl) {
        const want = imageKey(this.startUrl);
        const found = items.find(i => i.key === want);
        if (found) this._key = found.key;
      }
      // The image shown is chosen once, when every source has answered or 0.9 s after the first images (before,
      // the order still changes as sources come: the image would change under the eyes); till then, the skeleton.
      if (this._key !== null) this.#settled = true;
      else if (done) this.#settle();
      else if (items.length && !this.#settleTimer) this.#settleTimer = setTimeout(() => this.#settle(), 900);
      // An image asked for (address, photo clicked) that the filters chosen earlier would hide: they open up.
      if (this._key !== null && !this.#shown.some(i => i.key === this._key) && (this.startUrl || this.index) && items.some(i => i.key === this._key)) { this._filter = 'all'; this._part = 'all'; }
      this.#announce();
    });
  }

  /** The image to show is chosen (see #load). */
  #settled = false;
  /** @type {any} */ #settleTimer = 0;

  #settle() {
    clearTimeout(this.#settleTimer);
    this.#settleTimer = 0;
    if (this.#settled) return;
    this.#settled = true;
    const shown = this.#shown;
    if (this._key === null && shown.length) this._key = shown[Math.min(Math.max(0, this.index || 0), shown.length - 1)].key;
    this.#announce();
    this.requestUpdate();
  }

  // ── Current item, browsing ─────────────────────────────────────────────

  /**
   * The items of the kind and part chosen. A choice with nothing for this plant shows them all (the choice is
   * kept for the next plant); while loading, nothing yet (no image that would be replaced at once).
   */
  get #shown() {
    const kind = this._filter, part = this._part;
    const list = this._items.filter(i => (kind === 'all' || i.kind === kind) && (part === 'all' || i.part === part));
    if (list.length || (kind === 'all' && part === 'all')) return list;
    if (!this._done) return [];
    const ofKind = kind === 'all' ? this._items : this._items.filter(i => i.kind === kind);
    return ofKind.length ? ofKind : this._items;
  }

  get #current() {
    if (!this.#settled) return null;
    const shown = this.#shown;
    return shown.find(i => i.key === this._key) || (this._key === null ? shown[Math.min(Math.max(0, this.index || 0), shown.length - 1)] : shown[0]) || null;
  }

  /** The place of the item shown among all media, for the host to keep in the address. */
  #announce() {
    const at = this._items.findIndex(i => i.key === this.#current?.key);
    if (at >= 0) this.dispatchEvent(new CustomEvent('media-index', { detail: { index: at }, bubbles: true, composed: true }));
  }

  /** @param {number} step relative move among the items shown, or Infinity / -Infinity for the last / first */
  #go(step) {
    const shown = this.#shown;
    if (!shown.length) return;
    const at = shown.indexOf(/** @type {MediaItem} */ (this.#current));
    const next = step === Infinity ? shown.length - 1 : step === -Infinity ? 0 : Math.min(shown.length - 1, Math.max(0, at + step));
    this.#select(shown[next]);
  }

  /** @param {MediaItem} item */
  #select(item) {
    if (!item || item.key === this.#current?.key) return;
    this._key = item.key;
    this.#announce();
  }

  /** A new image: in the chosen view, its layers from the start; its shape from the source when known. */
  #resetImage() {
    const item = this._items.find(i => i.key === this._key);
    this._z = 1; this._tx = 0; this._ty = 0;
    this._loaded = false; this._hd = 'none';
    this._natural = item?.width && item?.height ? { w: item.width, h: item.height } : null;
    this.#guessed = false;
    this.#touched = false;
  }
  /** The user zoomed or moved this image: its view is theirs. */
  #touched = false;
  /** The shape comes from the thumbnail only (its size is not the original's yet). */
  #guessed = false;

  /** @param {string} kind @param {string} [part] */
  #setFilter(kind, part = this._part) {
    this._filter = /** @type {any} */ (kind);
    this._part = part;
    const shown = this.#shown;
    // The image shown is not of that kind: the first one that is (its own key, so it is drawn afresh).
    if (shown.length && !shown.some(i => i.key === this._key)) { this._key = shown[0].key; this.#announce(); }
  }

  /** @param {KeyboardEvent} e */
  #onKey = e => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const target = /** @type {HTMLElement} */ (e.composedPath()[0]);
    if (target?.closest?.('input, textarea, select, [contenteditable]')) return;
    /** @param {() => void} f */
    const take = f => { e.preventDefault(); e.stopPropagation(); f(); };
    const zoomed = this._z > this.#home + 0.01;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // Zoomed: the arrows move around the image; else they browse.
      if (zoomed && this.#overflowX) take(() => this.#panBy(e.key === 'ArrowLeft' ? 80 : -80, 0));
      else take(() => this.#go(e.key === 'ArrowLeft' ? -1 : 1));
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && this._z > 1.01 && !this.compact) take(() => this.#panBy(0, e.key === 'ArrowUp' ? 80 : -80));
    else if (e.key === 'Home' || e.key === 'End') take(() => this.#go(e.key === 'Home' ? -Infinity : Infinity));
    else if (e.key === '+' || e.key === '=') take(() => this.#zoomAt(this._z * 1.5, 0, 0, true));
    else if (e.key === '-') take(() => this.#zoomAt(this._z / 1.5, 0, 0, true));
    else if (e.key === '0') take(() => this.#reset());
    else if (e.key === 'Escape') {
      if (zoomed) take(() => this.#reset());
      else if (this._info) take(() => { this._info = false; });
      else if (this._opened) take(() => { this._opened = false; });
      else if (!this.compact && !this.local) take(() => this.#close());
    }
  };

  #close() { this.dispatchEvent(new CustomEvent('media-close', { bubbles: true, composed: true })); }

  /** ⤢ (in the sheet): the viewer in the pane, at the image shown. */
  #toPane() {
    this.dispatchEvent(new CustomEvent('open-pane', { detail: { key: 'media', url: this.#current?.src || null }, bubbles: true, composed: true }));
  }

  /** Mosaic: the scene of an image opened from it; slideshow: the image alone. */
  get #view() { return this.presentation === 'mosaic' ? (this._opened ? 'scene' : 'mosaic') : this.presentation === 'slideshow' ? 'slideshow' : 'scene'; }

  /** Slideshow: plays or stops. */
  #play(on = !this._playing) {
    clearInterval(this.#timer);
    this._playing = on;
    if (!on) return;
    this.#timer = setInterval(() => {
      if (this._z > this.#home + 0.01) return;
      const shown = this.#shown, at = shown.indexOf(/** @type {MediaItem} */ (this.#current));
      if (shown.length > 1) this.#select(shown[(at + 1) % shown.length]);
    }, 5000);
  }
  /** @type {any} */ #timer = 0;

  // ── Zoom: one scale and one offset ─────────────────────────────────────

  #stageObserver = new ResizeObserver(([entry]) => {
    const { width: w, height: h } = entry.contentRect;
    if (Math.abs(w - this._stage.w) > 0.5 || Math.abs(h - this._stage.h) > 0.5) { this._stage = { w, h }; this.#clampPan(); }
  });
  /** @type {Element | null} */ #observedStage = null;

  /** The image fitted in the stage (z = 1): its size in px. */
  get #fit() {
    const n = this._natural, { w, h } = this._stage;
    if (!n || !w || !h) return null;
    const s = Math.min(w / n.w, h / n.h);
    return { w: n.w * s, h: n.h * s };
  }

  /** Zoom at which one pixel of the original is one screen pixel. */
  get #oneToOne() {
    const fit = this.#fit, n = this._natural;
    return fit && n ? n.w / fit.w : 4;
  }

  /** Up to twice the original's pixels (at least ×4). */
  get #maxZoom() { return Math.max(4, this.#oneToOne * 2); }

  /**
   * Plein cadre: the zoom at which the image fills the stage's width — whenever its definition allows it (its
   * pixels cover the width on this screen, a little enlargement aside), else 1, the whole image.
   */
  get #fill() {
    const n = this._natural, { w } = this._stage, fit = this.#fit;
    if (!n || !fit || !w || this.#guessed) return 1;
    const z = w / fit.w;
    if (z <= 1.01) return 1;
    if (w * (devicePixelRatio || 1) > n.w * 1.25) return 1;
    return Math.min(z, this.#maxZoom);
  }

  /** The view chosen (and kept from one image, one plant to the next): plein cadre, whole image or 100 %. */
  get #home() {
    const pref = sheetSession.media.zoom;
    return pref === 'fit' ? 1 : pref === 'one' ? clamp(this.#oneToOne, 1, this.#maxZoom) : this.#fill;
  }

  /** The image wider than the stage (it moves sideways). */
  get #overflowX() { const fit = this.#fit; return !!fit && fit.w * this._z > this._stage.w + 1; }

  /** Back to the chosen view, centred. @param {boolean} [animate] */
  #toHome(animate = false) {
    this._z = this.#home; this._tx = 0; this._ty = 0;
    this.#clampPan();
    if (animate) this.#animate(true);
    this.#maybeHd();
  }

  /** « Ajusté » → « Plein cadre » (when there is one) → « 100 % » → « Ajusté »…: the choice is kept. */
  #cycleView() {
    const z = this._z, fill = this.#fill, one = clamp(this.#oneToOne, 1, this.#maxZoom);
    const near = (/** @type {number} */ a) => Math.abs(z - a) < 0.02;
    /** @type {'auto' | 'fit' | 'one'} */
    const next = near(1) ? (fill > 1 ? 'auto' : 'one') : near(fill) && fill > 1 ? (one > fill + 0.02 ? 'one' : 'fit') : 'fit';
    setMediaSession({ zoom: next });
    this.#touched = false;
    this.#toHome(true);
    this.requestUpdate();
  }

  /** Keeps the image over the stage (no empty band beyond its edges). */
  #clampPan() {
    const fit = this.#fit;
    if (!fit) return;
    const mx = Math.max(0, (fit.w * this._z - this._stage.w) / 2), my = Math.max(0, (fit.h * this._z - this._stage.h) / 2);
    this._tx = clamp(this._tx, -mx, mx);
    this._ty = clamp(this._ty, -my, my);
  }

  /**
   * Zoom to `z`, keeping the image point under (px, py) — from the stage's centre — where it is.
   * @param {number} z @param {number} px @param {number} py @param {boolean} [animate]
   */
  #zoomAt(z, px, py, animate = false) {
    this.#touched = true;
    const z2 = clamp(z, 1, this.#maxZoom), k = z2 / this._z;
    this._tx = px - (px - this._tx) * k;
    this._ty = py - (py - this._ty) * k;
    this._z = z2;
    if (z2 <= 1.001) { this._tx = 0; this._ty = 0; }
    this.#clampPan();
    this.#animate(animate);
    this.#maybeHd();
  }

  /** Back to the chosen view (plein cadre, whole image or 100 %). */
  #reset() { this.#touched = false; this.#toHome(true); }

  /** @param {number} dx @param {number} dy */
  #panBy(dx, dy) { this.#touched = true; this._tx += dx; this._ty += dy; this.#clampPan(); this.#animate(true); }

  /** A smooth move for buttons, keys and double taps (not for fingers, which follow at once). @param {boolean} on */
  #animate(on) {
    const stage = this.renderRoot.querySelector('.stage');
    if (!stage) return;
    stage.classList.toggle('animate', on && !matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (on) setTimeout(() => stage.classList.remove('animate'), 260);
  }

  /** Past what the display size holds: the original, once. */
  #maybeHd() {
    const item = this.#current, fit = this.#fit;
    if (!item || !fit || this._hd !== 'none' || item.original === item.display) return;
    const img = /** @type {HTMLImageElement | null} */ (this.renderRoot.querySelector('.frame .disp'));
    const shown = img?.naturalWidth || 1280;
    if (fit.w * this._z * (devicePixelRatio || 1) > shown * 1.15) this._hd = 'loading';
  }

  /** Double click / double tap: in to the point (×3, or 100 % when it is about that), or back to the whole image. @param {number} px @param {number} py */
  #toggleZoom(px, py) {
    const home = this.#home;
    if (this._z > home + 0.01) { this.#reset(); return; }
    const one = this.#oneToOne;
    this.#zoomAt(Math.max(home * 2, one > 1.3 && one < 5 ? one : 3), px, py, true);
  }

  // Pointers: one drags (zoomed) or swipes (not zoomed); two pinch. A quick second tap zooms.
  /** @type {Map<number, { x: number, y: number }>} */ #pointers = new Map();
  /** @type {{ x: number, y: number, tx: number, ty: number, t: number, moved: boolean } | null} */ #drag = null;
  /** @type {{ d: number, z: number, cx: number, cy: number, tx: number, ty: number } | null} */ #pinch = null;
  #lastTap = { t: 0, x: 0, y: 0 };
  #tapZoomed = 0;

  /** Pointer position from the stage's centre. @param {PointerEvent | WheelEvent | MouseEvent} e */
  #local(e) {
    const r = /** @type {HTMLElement} */ (this.renderRoot.querySelector('.stage')).getBoundingClientRect();
    return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2];
  }

  /** @param {PointerEvent} e */
  #down(e) {
    if (/** @type {HTMLElement} */ (e.target).closest('button, .minimap')) return;
    const stage = /** @type {HTMLElement} */ (e.currentTarget);
    try { stage.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ }
    this.#pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.#pointers.size === 2) {
      const [a, b] = [...this.#pointers.values()];
      const [cx, cy] = this.#local(/** @type {any} */ ({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }));
      this.#pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this._z, cx, cy, tx: this._tx, ty: this._ty };
      this.#drag = null;
      return;
    }
    this.#drag = { x: e.clientX, y: e.clientY, tx: this._tx, ty: this._ty, t: Date.now(), moved: false };
  }

  /** @param {PointerEvent} e */
  #move(e) {
    this.#wake();
    if (!this.#pointers.has(e.pointerId)) return;
    this.#pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.#pinch && this.#pointers.size >= 2) {
      const [a, b] = [...this.#pointers.values()], p = this.#pinch;
      this.#touched = true;
      const z = clamp(p.z * Math.hypot(a.x - b.x, a.y - b.y) / p.d, 1, this.#maxZoom), k = z / p.z;
      const [cx, cy] = this.#local(/** @type {any} */ ({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }));
      // The point under the fingers stays under them, and follows them.
      this._tx = cx - (p.cx - p.tx) * k; this._ty = cy - (p.cy - p.ty) * k; this._z = z;
      this.#clampPan();
      return;
    }
    const d = this.#drag;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.hypot(dx, dy) > 4) d.moved = true;
    if (this._z > 1.01) {
      /** @type {HTMLElement} */ (e.currentTarget).classList.add('dragging');
      if (d.moved) this.#touched = true;
      this._tx = d.tx + dx; this._ty = d.ty + dy;
      this.#clampPan();
    }
  }

  /** @param {PointerEvent} e */
  #up(e) {
    /** @type {HTMLElement} */ (e.currentTarget).classList.remove('dragging');
    this.#pointers.delete(e.pointerId);
    if (this.#pinch) {
      if (this.#pointers.size < 2) { this.#pinch = null; if (this._z <= 1.02) { this._z = 1; this._tx = 0; this._ty = 0; } this.#maybeHd(); }
      return;
    }
    const d = this.#drag;
    this.#drag = null;
    if (!d || e.type === 'pointercancel') return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    // Nothing to move sideways: a quick sideways swipe browses.
    if (!this.#overflowX && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - d.t < 700) { this.#go(dx < 0 ? 1 : -1); return; }
    if (d.moved) { this.#maybeHd(); return; }
    // A tap: the second one, close in time and place, zooms (a mouse uses dblclick).
    if (e.pointerType === 'mouse') return;
    const now = Date.now(), last = this.#lastTap;
    if (now - last.t < 450 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 40) {
      const [px, py] = this.#local(e);
      this.#toggleZoom(px, py);
      this.#lastTap = { t: 0, x: 0, y: 0 };
      // Browsers also send a dblclick for a double tap: it must not undo this one.
      this.#tapZoomed = now;
    } else this.#lastTap = { t: now, x: e.clientX, y: e.clientY };
  }

  /** @param {MouseEvent} e */
  #dblclick(e) {
    if (/** @type {HTMLElement} */ (e.target).closest('button, .minimap') || Date.now() - this.#tapZoomed < 700) return;
    const [px, py] = this.#local(e);
    this.#toggleZoom(px, py);
  }

  /**
   * Wheel: zooms with Ctrl (and a trackpad's pinch), or always when the viewer is alone in a pane; in the
   * sheet the wheel alone scrolls the sheet.
   * @param {WheelEvent} e
   */
  #wheel(e) {
    if (!e.ctrlKey && (this.compact || this._z <= this.#home + 0.01 && this.local)) return;
    e.preventDefault();
    const [px, py] = this.#local(e);
    this.#zoomAt(this._z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)), px, py);
  }

  /**
   * The map of the whole image. Grabbing the frame of the part seen moves it from where it was grabbed (no jump);
   * touching elsewhere glides the view there, then dragging goes on from that point.
   */
  /** @type {{ x: number, y: number, tx: number, ty: number } | null} */ #mapDrag = null;

  /** @param {PointerEvent} e */
  #mapDown(e) {
    e.stopPropagation();
    const el = /** @type {HTMLElement} */ (e.currentTarget), fit = this.#fit;
    if (!fit) return;
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    this.#touched = true;
    const view = el.querySelector('.view')?.getBoundingClientRect();
    const inside = view && e.clientX >= view.left - 6 && e.clientX <= view.right + 6 && e.clientY >= view.top - 6 && e.clientY <= view.bottom + 6;
    if (!inside) {
      // Elsewhere on the map: the view glides there.
      const r = el.getBoundingClientRect();
      const fx = clamp((e.clientX - r.left) / r.width, 0, 1) - 0.5, fy = clamp((e.clientY - r.top) / r.height, 0, 1) - 0.5;
      this._tx = -fx * fit.w * this._z; this._ty = -fy * fit.h * this._z;
      this.#clampPan();
      this.#animate(true);
    }
    this.#mapDrag = { x: e.clientX, y: e.clientY, tx: this._tx, ty: this._ty };
  }

  /** @param {PointerEvent} e */
  #mapMove(e) {
    const d = this.#mapDrag, fit = this.#fit;
    if (!d || !fit || !e.buttons) return;
    const el = /** @type {HTMLElement} */ (e.currentTarget);
    // Following the finger: no easing (the glide was for the tap).
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 2) { el.classList.add('dragging'); this.renderRoot.querySelector('.stage')?.classList.remove('animate'); }
    const r = el.getBoundingClientRect();
    // A move on the map is that move times the image's scale over the map's, the other way (the view follows the frame).
    const k = (fit.w * this._z) / r.width;
    this._tx = d.tx - (e.clientX - d.x) * k;
    this._ty = d.ty - (e.clientY - d.y) * k;
    this.#clampPan();
  }

  #mapUp() { this.#mapDrag = null; this.renderRoot.querySelector('.minimap')?.classList.remove('dragging'); this.#maybeHd(); }

  /** The controls show while the pointer moves, and fade 2 s after it rests (not on touch). */
  #wake() {
    if (this._idle) this._idle = false;
    clearTimeout(this.#idleTimer);
    if (matchMedia('(hover: hover)').matches) this.#idleTimer = setTimeout(() => { this._idle = true; }, 2000);
  }
  /** @type {any} */ #idleTimer = 0;

  /** A size that does not exist (Commons does not enlarge, a host without that size): try the next one. @param {MediaItem} item @param {string} url */
  #broken(item, url) {
    const next = [item.display, item.src, item.original].find(u => u !== url && !this.#tried.has(item.key + ' ' + u));
    this.#tried.add(item.key + ' ' + url);
    if (next) this._failed = new Map(this._failed).set(item.key, next);
  }
  #tried = new Set();

  // ── Render ─────────────────────────────────────────────────────────────

  updated() {
    // The same image kept (its address did not change): already loaded, no new « load » to wait for.
    const disp = /** @type {HTMLImageElement | null} */ (this.renderRoot.querySelector('.frame .disp'));
    const item = this.#current;
    if (!this._loaded && item && disp?.complete && disp.naturalWidth) this.#displayLoaded(item, disp);
    const stage = this.renderRoot.querySelector('.stage');
    if (stage !== this.#observedStage) {
      this.#stageObserver.disconnect();
      if (stage) this.#stageObserver.observe(stage);
      this.#observedStage = stage;
    }
    // Keep the current thumbnail in view (in the strip only: the page itself does not scroll).
    const strip = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.thumbs'));
    const cur = /** @type {HTMLElement | null} */ (strip?.querySelector('[aria-current="true"]'));
    if (strip && cur && cur !== this.#scrolledTo) {
      this.#scrolledTo = cur;
      strip.scrollTo({ left: Math.max(0, cur.offsetLeft - strip.offsetLeft - (strip.clientWidth - cur.clientWidth) / 2) });
    }
    // Next and previous, ready before they are asked for.
    const shown = this.#shown, at = shown.indexOf(/** @type {MediaItem} */ (this.#current));
    for (const n of [shown[at + 1], shown[at - 1]]) if (n && !this.#preloaded.has(n.key)) { this.#preloaded.add(n.key); const i = new Image(); i.referrerPolicy = 'no-referrer'; i.src = n.display; }
  }
  /** @type {HTMLElement | null} */ #scrolledTo = null;
  #preloaded = new Set();

  render() {
    const plant = this._plant, item = this.#current, shown = this.#shown;
    const at = item ? shown.indexOf(item) : -1;
    const kinds = KINDS.filter(([k]) => k === 'all' || this._items.some(i => i.kind === k));
    return html`
      <div class="bar">
        ${this.compact ? html`${icon('images')}<h2>${this.label || 'Médias'}</h2>` : html`<h2></h2>`}
        ${this.presentation === 'mosaic' && this._opened ? html`<button class="link back-mosaic" type="button" @click=${() => { this._opened = false; }}>${icon('chevron-left')} Mosaïque</button>` : nothing}
        ${kinds.length > 2 ? html`<select aria-label="Type de média" @change=${(/** @type {any} */ e) => this.#setFilter(e.target.value)}>
          ${kinds.map(([k, label]) => html`<option value=${k} ?selected=${this._filter === k}>${label} (${k === 'all' ? this._items.length : this._items.filter(i => i.kind === k).length})</option>`)}</select>` : nothing}
        ${this.#partMenu()}
        ${item ? html`<span class="count" aria-live="polite">${at + 1} / ${shown.length}</span>` : this._done ? nothing : html`<span class="count">chargement…</span>`}
        ${this.#view === 'slideshow' && shown.length > 1 ? html`<button class="icon-btn" type="button" aria-pressed=${String(this._playing)}
          title=${this._playing ? 'Arrêter le diaporama' : 'Lancer le diaporama (une image toutes les 5 s)'} aria-label=${this._playing ? 'Arrêter le diaporama' : 'Lancer le diaporama'}
          @click=${() => this.#play()}>${this._playing ? html`<b class="pause">❚❚</b>` : html`<b class="play">▶</b>`}</button>` : nothing}
        ${this.compact ? html`<button class="icon-btn" type="button" title="Ouvrir en grand, à côté de la fiche" aria-label="Ouvrir les médias en volet"
          @click=${() => this.#toPane()}>${icon('arrows-angle-expand')}</button>` : nothing}
      </div>
      ${!item ? (this._done ? this.#empty(plant) : this.#skeleton()) : this.#view === 'mosaic' ? this.#mosaic(shown) : html`
        <div class="main ${this._info ? 'with-info' : ''} ${this.#view === 'slideshow' ? 'slideshow' : ''}">${this.#stage(item, at, shown.length)}${this._info ? this.#details(item) : nothing}</div>
        ${this.#caption(item)}
        ${this.#view === 'slideshow' || (shown.length < 2 && this._done) ? nothing : html`<div class="strip">${this.#thumbs(shown, item)}</div>`}`}`;
  }

  /** @param {any} plant */
  #empty(plant) {
    return html`<div class="empty">${plant ? 'Aucune image sous licence libre pour cette plante (ou modules photos désactivés).' : 'Plante introuvable.'}</div>`;
  }

  /** While loading: the stage, the credit line and the strip, empty — the viewer's size from the start. */
  #skeleton() {
    return html`<div class="skel" aria-busy="true">
      <div class="main"><div class="stage"><span class="spinner">chargement des médias…</span></div></div>
      <div class="caption"><i></i></div>
      ${this.#view === 'slideshow' ? nothing : html`<div class="strip"><div class="thumbs">${[0, 1, 2, 3, 4, 5].map(() => html`<i></i>`)}</div></div>`}
    </div>`;
  }

  /** The parts of the plant (Trefle's photos): shown only when some image has one. */
  #partMenu() {
    const items = this._filter === 'all' ? this._items : this._items.filter(i => i.kind === this._filter);
    if (!this._items.some(i => i.part)) return nothing;
    const count = (/** @type {string} */ p) => p === 'all' ? items.length : items.filter(i => i.part === p).length;
    return html`<div class="parts" role="radiogroup" aria-label="Partie de la plante">
      ${['all', ...PARTS].map(p => {
        const n = count(p), [label, ic] = PART_INFO[/** @type {keyof PART_INFO} */ (p)];
        if (p === 'other' && !n) return nothing;
        return html`<button type="button" role="radio" aria-checked=${String(this._part === p)} ?disabled=${!n} title=${label + ' (' + n + ')'}
          aria-label=${label + ', ' + n + ' image' + (n > 1 ? 's' : '')} @click=${() => this.#setFilter(this._filter, p)}>${icon(/** @type {any} */ (ic))}</button>`;
      })}
    </div>`;
  }

  /** @param {MediaItem[]} shown @param {MediaItem} item */
  #thumbs(shown, item) {
    return html`<div class="thumbs" role="listbox" aria-label="Médias">
      ${shown.map(i => html`<button type="button" role="option" class=${i.kind} aria-current=${String(i.key === item.key)} aria-selected=${String(i.key === item.key)}
        title=${[KIND_LABEL[i.kind], i.source].join(' · ')} @click=${() => this.#select(i)}>
        <img src=${i.thumb} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"
          @error=${(/** @type {Event} */ e) => { const img = /** @type {HTMLImageElement} */ (e.target); if (img.src !== i.src) img.src = i.src; }} />
      </button>`)}
    </div>`;
  }

  /** Mosaic: every image of the filter, in a grid; one touched opens in the scene. @param {MediaItem[]} shown */
  #mosaic(shown) {
    return html`<div class="mosaic-wrap"><div class="mosaic" role="list" aria-label="Médias">${shown.map(i => html`<button type="button" role="listitem" class=${i.kind}
      title=${[KIND_LABEL[i.kind], i.source, i.author].filter(Boolean).join(' · ')} @click=${() => { this.#select(i); this._key = i.key; this._opened = true; }}>
      <img src=${i.thumb} alt=${KIND_LABEL[i.kind]} loading="lazy" decoding="async" referrerpolicy="no-referrer"
        @error=${(/** @type {Event} */ e) => { const img = /** @type {HTMLImageElement} */ (e.target); if (img.src !== i.src) img.src = i.src; }} />
    </button>`)}</div></div>`;
  }

  /** The credit, one line, under the image; « ⓘ » opens the details. @param {MediaItem} item */
  #caption(item) {
    return html`<div class="caption">
      <span class="what">${KIND_LABEL[item.kind]} · ${item.source}</span>
      <gf-attribution .media=${item}></gf-attribution>
      <button class="icon-btn" type="button" aria-pressed=${String(this._info)} title="À propos de cette image" aria-label="À propos de cette image"
        @click=${() => { this._info = !this._info; }}><b aria-hidden="true">ⓘ</b></button>
    </div>`;
  }

  /** @param {MediaItem} item @param {number} at @param {number} n */
  #stage(item, at, n) {
    const fit = this.#fit, z = this._z, home = this.#home, zoomed = z > home + 0.01, over = z > 1.01;
    const src = this._failed.get(item.key) || item.display;
    const frame = fit ? `width:${fit.w}px;height:${fit.h}px;transform:translate(calc(-50% + ${this._tx}px), calc(-50% + ${this._ty}px)) scale(${z})` : 'display:none';
    const pct = Math.round(z / this.#oneToOne * 100);
    const one = this.#oneToOne;
    const map = over && fit ? this.#mapSize(fit) : null;
    return html`<div class="stage ${zoomed ? 'zoomed' : ''} ${this._idle ? 'idle' : ''}" tabindex="0" style=${map ? `--map-w:${map.w}px` : ''}
        aria-label=${(KIND_LABEL[item.kind] || 'Image') + (this._plant ? ' de ' + this._plant.scientificName : '') + ' — double-clic pour zoomer'}
        @pointerdown=${this.#down} @pointermove=${this.#move} @pointerup=${this.#up} @pointercancel=${this.#up}
        @dblclick=${this.#dblclick} @wheel=${this.#wheel} @pointerleave=${() => { if (!this.#drag) this._idle = matchMedia('(hover: hover)').matches; }}>
      ${fit ? html`<img class="backdrop" src=${item.thumb} alt="" aria-hidden="true" decoding="async" referrerpolicy="no-referrer" draggable="false" />` : nothing}
      <div class="frame ${this._loaded ? 'ready' : ''}" style=${frame}>
        <img class="ph" src=${item.thumb} alt="" decoding="async" referrerpolicy="no-referrer" draggable="false" />
        <img class="disp ${this._loaded ? 'on' : ''}" src=${src} alt=${(KIND_LABEL[item.kind] || 'Image') + (this._plant ? ' de ' + this._plant.scientificName : '')}
          decoding="async" referrerpolicy="no-referrer" draggable="false"
          @load=${(/** @type {Event} */ e) => this.#displayLoaded(item, /** @type {HTMLImageElement} */ (e.target))} @error=${() => this.#broken(item, src)} />
        ${this._hd !== 'none' && this._hd !== 'error' ? html`<img class="hd ${this._hd === 'on' ? 'on' : ''}" src=${item.original} alt="" decoding="async" referrerpolicy="no-referrer" draggable="false"
          @load=${(/** @type {Event} */ e) => this.#hdLoaded(/** @type {HTMLImageElement} */ (e.target))} @error=${() => { this._hd = 'error'; }} />` : nothing}
      </div>
      ${fit ? nothing : html`<img class="probe" src=${item.thumb} alt="" referrerpolicy="no-referrer" hidden @load=${(/** @type {Event} */ e) => this.#guessShape(/** @type {HTMLImageElement} */ (e.target))} />`}
      <button class="nav prev" type="button" aria-label="Média précédent" ?disabled=${at <= 0} @click=${() => this.#go(-1)}>${icon('chevron-left')}</button>
      <button class="nav next" type="button" aria-label="Média suivant" ?disabled=${at >= n - 1} @click=${() => this.#go(1)}>${icon('chevron-right')}</button>
      ${map && fit ? this.#minimap(item, fit, map) : nothing}
      ${this._hd === 'loading' ? html`<span class="hd-state" role="status">Chargement de l’original…</span>` : this._hd === 'on' && zoomed ? html`<span class="hd-state">Original</span>` : nothing}
      <div class="zoombar" role="group" aria-label="Zoom">
        <button type="button" aria-label="Dézoomer" title="Dézoomer (−)" ?disabled=${!over} @click=${() => this.#zoomAt(z / 1.5, 0, 0, true)}>−</button>
        ${this.#viewButton(z, pct, one)}
        <button type="button" aria-label="Zoomer" title="Zoomer (+)" ?disabled=${z >= this.#maxZoom - 0.01} @click=${() => this.#zoomAt(z * 1.5, 0, 0, true)}>+</button>
      </div>
    </div>`;
  }

  /**
   * The view button: the view shown (« Ajusté », « Plein cadre », « 100 % » or the zoom), a touch for the next
   * one — the choice is kept for the next images and plants.
   * @param {number} z @param {number} pct @param {number} one
   */
  #viewButton(z, pct, one) {
    const near = (/** @type {number} */ a) => Math.abs(z - a) < 0.02, fill = this.#fill;
    const label = near(1) ? 'Ajusté' : fill > 1 && near(fill) ? 'Plein cadre' : nf.format(pct) + ' %';
    const next = near(1) ? (fill > 1 ? 'Plein cadre' : '100 %') : fill > 1 && near(fill) && clamp(one, 1, this.#maxZoom) > fill + 0.02 ? '100 %' : 'l’image entière';
    return html`<button type="button" class="pct" title=${'Passer à : ' + next + ' (gardé pour les images suivantes)'} aria-label=${label + ' — passer à ' + next}
      @click=${() => this.#cycleView()}>${label}</button>`;
  }

  /**
   * The map's size: the stage's height (less its margins) when the image is narrow enough for it (as in plein
   * cadre); else a smaller map, at most 30 % of the stage's width.
   * @param {{ w: number, h: number }} fit
   */
  #mapSize(fit) {
    const a = fit.w / fit.h, H = Math.max(40, this._stage.h - 16), full = this._stage.w * (this._stage.w < 420 ? MAP_SHARE_NARROW : MAP_SHARE);
    const h = H * a <= full ? H : Math.min(H, this._stage.w * MAP_SHARE_NARROW / a);
    return { w: Math.round(h * a), h: Math.round(h) };
  }

  /** The whole image, and the part of it on the stage. @param {MediaItem} item @param {{ w: number, h: number }} fit @param {{ w: number, h: number }} size */
  #minimap(item, fit, size) {
    const z = this._z, vw = Math.min(1, this._stage.w / (fit.w * z)), vh = Math.min(1, this._stage.h / (fit.h * z));
    const cx = 0.5 - this._tx / (fit.w * z), cy = 0.5 - this._ty / (fit.h * z);
    return html`<div class="minimap" role="img" aria-label="Où se trouve la vue sur l’image entière" style=${`width:${size.w}px;height:${size.h}px`}
        @pointerdown=${(/** @type {PointerEvent} */ e) => this.#mapDown(e)} @pointermove=${(/** @type {PointerEvent} */ e) => this.#mapMove(e)}
        @pointerup=${() => this.#mapUp()} @pointercancel=${() => this.#mapUp()}>
      <img src=${item.thumb} alt="" referrerpolicy="no-referrer" draggable="false" />
      <div class="view" style=${`left:${(cx - vw / 2) * 100}%;top:${(cy - vh / 2) * 100}%;width:${vw * 100}%;height:${vh * 100}%`}></div>
    </div>`;
  }

  /** The display size is in: shown (fading in); its shape when the source did not give it. @param {MediaItem} item @param {HTMLImageElement} img */
  #displayLoaded(item, img) {
    if (item.key !== this.#current?.key) return;
    if ((!this._natural || this.#guessed) && img.naturalWidth) { this._natural = { w: img.naturalWidth, h: img.naturalHeight }; this.#guessed = false; }
    this._loaded = true;
    this.#maybeHd();
  }

  /** The thumbnail gives the shape before the display size arrives. @param {HTMLImageElement} img */
  #guessShape(img) {
    if (!this._natural && img.naturalWidth) { this._natural = { w: img.naturalWidth, h: img.naturalHeight }; this.#guessed = true; }
  }

  /** The original is in: its true size (100 % is now exact). @param {HTMLImageElement} img */
  #hdLoaded(img) {
    const n = this._natural;
    if (img.naturalWidth && (!n || Math.abs(n.w / n.h - img.naturalWidth / img.naturalHeight) < 0.02)) this._natural = { w: img.naturalWidth, h: img.naturalHeight };
    this._hd = 'on';
  }

  /** What is known of the image. @param {MediaItem} item */
  #details(item) {
    const n = this._hd === 'on' || item.width ? this._natural : null;
    const page = item.pageUrl || item.sourceUrl;
    const where = [item.locality, item.country].filter(Boolean).join(', ');
    return html`<aside class="info" aria-label="À propos de l’image">
      <span class="kind">${KIND_LABEL[item.kind]} · ${item.source}</span>
      ${item.title ? html`<h3>${item.title}</h3>` : nothing}
      <gf-attribution .media=${item}></gf-attribution>
      <dl>
        ${n ? html`<dt>Original</dt><dd>${nf.format(n.w)} × ${nf.format(n.h)} px</dd>` : nothing}
        ${item.institution || item.catalogNumber ? html`<dt>Collection</dt><dd>${[item.institution, item.catalogNumber && 'n° ' + item.catalogNumber].filter(Boolean).join(' · ')}</dd>` : nothing}
        ${item.year ? html`<dt>Année</dt><dd>${item.year}</dd>` : nothing}
        ${where ? html`<dt>Lieu</dt><dd>${where}</dd>` : nothing}
      </dl>
      <div class="links">
        ${page ? html`<a href=${page} target="_blank" rel="noopener">${icon('box-arrow-up-right')} Voir à la source</a>` : nothing}
        <a href=${item.original} target="_blank" rel="noopener">${icon('image')} Ouvrir l’original</a>
      </div>
      <p class="tip">Double-clic ou double-tap : zoomer là ; pincer ou Ctrl + molette : zoom progressif ; glisser : se déplacer. Au-delà de l’image d’affichage, l’original se charge tout seul.</p>
    </aside>`;
  }
}

customElements.define('gf-media-viewer', GfMediaViewer);
