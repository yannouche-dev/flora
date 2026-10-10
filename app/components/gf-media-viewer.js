// @ts-check
// « Médias »: every image of a plant in one viewer. The stage shows the current image as large as the pane
// allows, the filmstrip below the others (filtered by kind), the side column what is known of it (source,
// author, licence, size, specimen). Smart zoom: over the stage, a lens follows the pointer and the side column
// becomes a magnifier showing the ORIGINAL file under the lens (loaded on the first hover); the mouse wheel
// changes the magnification (×2 … ×8, « 1:1 » = one pixel of the original per screen pixel).
// Touch: swipe to browse; tap the photo to start the magnifier, drag to move the lens, tap again to stop.

import { LitElement, html, css, nothing } from 'lit';
import * as db from '../core/db.js';
import { icon } from '../core/icons.js';
import { imageKey, loadMedia } from '../core/media-items.js';
import { ui } from '../styles/ui.js';
import './gf-attribution.js';

/** @typedef {import('../core/media-items.js').MediaItem} MediaItem */

const KINDS = /** @type {const} */ ([['all', 'Tout'], ['photo', 'Photos'], ['observation', 'Observations'], ['herbarium', 'Herbier']]);
const KIND_LABEL = { photo: 'Photo', observation: 'Photo d’observation', herbarium: 'Planche d’herbier' };
const FACTORS = [2, 3, 4, 6, 8];
const nf = new Intl.NumberFormat('fr-FR');

export class GfMediaViewer extends LitElement {
  static properties = {
    plantId: { type: Number, attribute: 'plant-id' },
    view: {},
    /** Open at this item (the URL's ?media=n), applied once the media are loaded. */
    index: { type: Number },
    /** Open at the image of this URL (a photo clicked on the sheet). */
    startUrl: { attribute: 'start-url' },
    full: { type: Boolean, reflect: true },
    /** The host can show it over everything (not on a phone, where it already is). */
    canFull: { type: Boolean, attribute: 'can-full' },
    _plant: { state: true },
    _items: { state: true },
    _done: { state: true },
    _key: { state: true },
    _filter: { state: true },
    _zoom: { state: true },
    _lens: { state: true },
    _loupe: { state: true },
    _locked: { state: true },
    _factor: { state: true },
    _originals: { state: true },
    _failed: { state: true }
  };

  static styles = [ui, css`
    :host { display: flex; flex-direction: column; min-height: 0; flex: 1; background: var(--gf-surface); container-type: inline-size; outline: none; }
    .bar { display: flex; align-items: center; gap: 6px; padding: 6px 8px 6px 12px; border-bottom: 1px solid var(--gf-border); min-height: 48px; flex: none; }
    .bar h2 { margin: 0; font-size: 0.95rem; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .bar h2 i { font-family: var(--gf-font-serif); font-weight: 500; }
    .bar .count { color: var(--gf-text-muted); font-variant-numeric: tabular-nums; font-size: 0.85rem; white-space: nowrap; }
    .icon-btn[aria-pressed="true"] { background: var(--gf-accent-soft); color: var(--gf-accent); }

    .main { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }
    /* Wide: the side column (details, or the magnifier while zooming) beside the stage. */
    @container (min-width: 700px) {
      .main { grid-template-columns: minmax(0, 1fr) clamp(260px, 36%, 520px); grid-template-rows: minmax(0, 1fr); }
      .side { border-left: 1px solid var(--gf-border); }
    }

    .stage { position: relative; min-height: 220px; background: #111; overflow: hidden; display: grid; place-items: center; touch-action: pan-y; user-select: none; }
    .stage.zooming { cursor: crosshair; touch-action: none; }
    .stage img.photo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; display: block; }
    .stage .nav {
      position: absolute; top: 50%; translate: 0 -50%; width: 44px; height: 64px; border: 0; border-radius: var(--gf-radius-sm);
      background: rgb(0 0 0 / 40%); color: #fff; font-size: 1.3rem; display: grid; place-items: center; cursor: pointer; z-index: 2;
    }
    .stage .nav:hover { background: rgb(0 0 0 / 65%); }
    .stage .nav.prev { left: 8px; } .stage .nav.next { right: 8px; }
    .stage .nav:disabled { visibility: hidden; }
    .stage .hint { position: absolute; left: 8px; bottom: 8px; padding: 3px 8px; border-radius: var(--gf-radius-pill); background: rgb(0 0 0 / 55%); color: #fff; font-size: 0.75rem; pointer-events: none; z-index: 2; }
    .stage .spinner { color: #ddd; }
    .lens { position: absolute; border: 2px solid #fff; box-shadow: 0 0 0 1px rgb(0 0 0 / 50%), 0 0 0 9999px rgb(0 0 0 / 25%); pointer-events: none; z-index: 1; }

    .side { position: relative; min-height: 0; overflow: auto; background: var(--gf-surface); }
    .info { padding: 12px 14px; display: grid; gap: 8px; font-size: 0.9rem; }
    .info h3 { margin: 0; font-size: 0.95rem; }
    .info .kind { color: var(--gf-text-muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }
    .info dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; font-size: 0.85rem; }
    .info dt { color: var(--gf-text-muted); }
    .info dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .info .links { display: flex; flex-wrap: wrap; gap: 6px; }
    .info .links a { display: inline-flex; align-items: center; gap: 5px; }
    .info .tip { color: var(--gf-text-muted); font-size: 0.8rem; }
    gf-attribution { white-space: normal; font-size: 0.8rem; }

    /* The magnifier: the original under the lens. Wide: the side column. Narrow: over half of the stage. */
    .magnifier { position: absolute; inset: 0; background-color: #111; background-repeat: no-repeat; z-index: 3; }
    .magnifier .label { position: absolute; left: 8px; top: 8px; padding: 3px 8px; border-radius: var(--gf-radius-pill); background: rgb(0 0 0 / 60%); color: #fff; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
    .stage .magnifier { inset: auto 0 0 0; height: 50%; border-top: 2px solid #fff; }
    .stage .magnifier.top { inset: 0 0 auto 0; border-top: 0; border-bottom: 2px solid #fff; }

    .strip { flex: none; border-top: 1px solid var(--gf-border); background: var(--gf-surface-2); padding: 6px 8px 8px; display: grid; gap: 6px; }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .chips button { border: 1px solid var(--gf-border); background: var(--gf-surface); border-radius: var(--gf-radius-pill); padding: 2px 10px; font: inherit; font-size: 0.8rem; color: var(--gf-text); cursor: pointer; }
    .chips button[aria-pressed="true"] { background: var(--gf-accent); border-color: var(--gf-accent); color: var(--gf-accent-contrast); }
    .chips button:disabled { opacity: 0.45; cursor: default; }
    .thumbs { display: flex; gap: 6px; overflow-x: auto; scroll-behavior: smooth; padding-bottom: 2px; scrollbar-width: thin; }
    .thumbs button { flex: none; width: 76px; height: 76px; padding: 0; border: 2px solid transparent; border-radius: var(--gf-radius-sm); overflow: hidden; background: var(--gf-surface); cursor: pointer; }
    .thumbs button[aria-current="true"] { border-color: var(--gf-accent); }
    .thumbs button:focus-visible { box-shadow: var(--gf-focus); outline: none; }
    .thumbs img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .thumbs .herbarium img { object-fit: contain; background: #f4f1e8; }
    .empty { padding: 24px; color: var(--gf-text-muted); text-align: center; }
    @media (prefers-reduced-motion: reduce) { .thumbs { scroll-behavior: auto; } }
  `];

  constructor() {
    super();
    /** @type {number | null} */
    this.plantId = null;
    /** @type {any} */
    this.view = 'standard';
    this.index = 0;
    /** @type {string | null} */
    this.startUrl = null;
    this.full = false;
    this.canFull = true;
    /** @type {any} */
    this._plant = null;
    /** @type {MediaItem[]} */
    this._items = [];
    this._done = false;
    /** The item shown, by key (items arriving later do not move it). @type {string | null} */
    this._key = null;
    /** @type {'all' | 'photo' | 'observation' | 'herbarium'} */
    this._filter = 'all';
    /** Zooming now (pointer over the stage, or locked by a tap). */
    this._zoom = false;
    /** Lens and magnifier geometry. @type {any} */
    this._lens = null;
    /** Magnifier on hover (the loupe button). */
    this._loupe = true;
    this._locked = false;
    /** Magnification; null: the default for this image. @type {number | null} */
    this._factor = null;
    /** Originals loaded: key → natural size. @type {Map<string, { w: number, h: number } | 'error'>} */
    this._originals = new Map();
    /** Images that failed at a size: key → the next URL tried. @type {Map<string, string>} */
    this._failed = new Map();
  }

  /** @type {AbortController | null} */ #abort = null;

  connectedCallback() {
    super.connectedCallback();
    addEventListener('keydown', this.#onKey);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    removeEventListener('keydown', this.#onKey);
    this.#abort?.abort();
  }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if ((changed.has('plantId') || changed.has('view')) && this.plantId != null) this.#load();
    // Another photo clicked on the sheet while the viewer is open.
    else if (changed.has('startUrl') && this.startUrl) {
      const want = imageKey(this.startUrl);
      const found = this._items.find(i => i.key === want);
      if (found) { this._filter = 'all'; this.#select(found); }
    }
  }

  async #load() {
    this.#abort?.abort();
    const abort = this.#abort = new AbortController();
    this._items = []; this._done = false; this._key = null; this._filter = 'all';
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
      // The URL's index: once every source has answered (before, the order can still change).
      if (this._key === null && done && items.length) this._key = items[Math.min(Math.max(0, this.index || 0), items.length - 1)].key;
      this.#announce();
    });
  }

  // ── Current item, browsing ─────────────────────────────────────────────

  get #shown() { return this._filter === 'all' ? this._items : this._items.filter(i => i.kind === this._filter); }

  get #current() {
    const shown = this.#shown;
    return shown.find(i => i.key === this._key) || (this._key === null ? shown[Math.min(Math.max(0, this.index || 0), shown.length - 1)] : shown[0]) || null;
  }

  /** The URL of the item shown (its place among all media), for the host to keep in the address. */
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
    this._lens = null; this._factor = null;
    if (!this._locked) this._zoom = false;
    this.#announce();
  }

  /** @param {typeof KINDS[number][0]} kind */
  #setFilter(kind) {
    this._filter = kind;
    const shown = this.#shown;
    if (shown.length && !shown.some(i => i.key === this._key)) this.#select(shown[0]);
  }

  /** @param {KeyboardEvent} e */
  #onKey = e => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const target = /** @type {HTMLElement} */ (e.composedPath()[0]);
    if (target?.closest?.('input, textarea, select, [contenteditable]')) return;
    const keys = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity, PageUp: -1, PageDown: 1 };
    if (e.key in keys) { e.preventDefault(); e.stopImmediatePropagation(); this.#go(keys[/** @type {keyof typeof keys} */ (e.key)]); }
    else if (e.key === 'Escape') {
      if (this._zoom) { this._zoom = false; this._locked = false; this._lens = null; }
      else this.#close();
    } else if (e.key === '+' || e.key === '-') this.#zoomStep(e.key === '+' ? 1 : -1);
  };

  #close() { this.dispatchEvent(new CustomEvent('media-close', { bubbles: true, composed: true })); }

  // ── Smart zoom ─────────────────────────────────────────────────────────

  /** Size of the original: known from the source, or measured once loaded. @param {MediaItem} item */
  #originalSize(item) {
    const o = this._originals.get(item.key);
    if (o && o !== 'error') return o;
    return item.width && item.height ? { w: item.width, h: item.height } : null;
  }

  /** Loads the original once, to swap it into the magnifier. @param {MediaItem} item */
  #loadOriginal(item) {
    if (this._originals.has(item.key) || this.#pendingOriginal.has(item.key)) return;
    this.#pendingOriginal.add(item.key);
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => { this._originals = new Map(this._originals).set(item.key, { w: img.naturalWidth, h: img.naturalHeight }); };
    img.onerror = () => { this._originals = new Map(this._originals).set(item.key, 'error'); };
    img.src = item.original;
  }
  #pendingOriginal = new Set();

  /** The levels of magnification of this image, with « 1:1 » (its original pixels) among them. */
  #levels() {
    const one = this.#oneToOne();
    return [...new Set([...FACTORS, ...(one && one > 1.2 ? [Math.round(one * 10) / 10] : [])])].sort((a, b) => a - b);
  }

  /** Magnification at which one pixel of the original is one pixel of the screen. */
  #oneToOne() {
    const item = this.#current, box = this.#imageBox();
    const size = item && this.#originalSize(item);
    return size && box ? size.w / box.w : null;
  }

  /** Default magnification: 1:1 when it is reasonable, else ×3. */
  #factor() {
    if (this._factor) return this._factor;
    const one = this.#oneToOne();
    return one && one >= 1.5 && one <= 8 ? Math.round(one * 10) / 10 : 3;
  }

  /** @param {number} dir */
  #zoomStep(dir) {
    const levels = this.#levels(), f = this.#factor();
    const i = levels.findIndex(x => x >= f - 0.01);
    this._factor = levels[Math.min(levels.length - 1, Math.max(0, (i < 0 ? levels.length - 1 : i) + dir))];
    if (this._lens) this.#place(this._lens.cx, this._lens.cy);
  }

  /** Where the image is drawn in the stage (object-fit: contain): left, top, width, height, in stage pixels. */
  #imageBox() {
    const img = /** @type {HTMLImageElement | null} */ (this.renderRoot.querySelector('img.photo'));
    if (!img || !img.naturalWidth) return null;
    const w = img.clientWidth, h = img.clientHeight;
    const s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const rw = img.naturalWidth * s, rh = img.naturalHeight * s;
    return { x: img.offsetLeft + (w - rw) / 2, y: img.offsetTop + (h - rh) / 2, w: rw, h: rh };
  }

  /**
   * Lens and magnifier for a pointer at (cx, cy) in stage pixels.
   * @param {number} cx @param {number} cy
   */
  #place(cx, cy) {
    const box = this.#imageBox();
    const panel = this.#panelSize(cy);
    if (!box || !panel) { this._lens = null; return; }
    const f = this.#factor();
    // The lens: the part of the image the magnifier shows, centred on the pointer, kept inside the image.
    const lw = Math.min(box.w, panel.w / f), lh = Math.min(box.h, panel.h / f);
    const px = Math.min(box.w - lw / 2, Math.max(lw / 2, cx - box.x)), py = Math.min(box.h - lh / 2, Math.max(lh / 2, cy - box.y));
    this._lens = {
      cx, cy, f, top: panel.top,
      x: box.x + px - lw / 2, y: box.y + py - lh / 2, w: lw, h: lh,
      size: `${box.w * f}px ${box.h * f}px`,
      pos: `${-(px * f - panel.w / 2)}px ${-(py * f - panel.h / 2)}px`
    };
  }

  /** Size of the magnifier: the side column when wide, else half the stage (the half the pointer is not in). @param {number} cy */
  #panelSize(cy) {
    const side = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.side'));
    const stage = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.stage'));
    if (!stage) return null;
    if (this.#wide && side) return { w: side.clientWidth, h: side.clientHeight, top: false };
    const top = cy > stage.clientHeight / 2;
    return { w: stage.clientWidth, h: stage.clientHeight / 2, top };
  }

  get #wide() { return this.getBoundingClientRect().width >= 700; }

  /** A mouse (or pen) that hovers: the magnifier follows it; else a tap starts it. */
  #hover = matchMedia('(hover: hover)');

  /** @param {PointerEvent} e */
  #stagePoint(e) {
    const r = /** @type {HTMLElement} */ (e.currentTarget).getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  #down = /** @type {{ x: number, y: number, t: number, id: number } | null} */ (null);

  /** @param {PointerEvent} e */
  #onMove(e) {
    const item = this.#current;
    if (!item) return;
    if (e.pointerType === 'mouse') {
      if (!this._loupe || !this.#overImage(e)) { if (!this._locked && this._zoom) { this._zoom = false; this._lens = null; } return; }
      this._zoom = true;
    } else if (!this._zoom) return;
    this.#loadOriginal(item);
    const [x, y] = this.#stagePoint(e);
    this.#place(x, y);
  }

  /** The pointer is over the drawn image (not the letterbox around it). @param {PointerEvent} e */
  #overImage(e) {
    const box = this.#imageBox();
    if (!box) return false;
    const [x, y] = this.#stagePoint(e);
    return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
  }

  /** @param {PointerEvent} e */
  #onDown(e) {
    if (/** @type {HTMLElement} */ (e.target).closest('button')) return;
    this.#down = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
    if (e.pointerType !== 'mouse' && this._zoom) /** @type {HTMLElement} */ (e.currentTarget).setPointerCapture(e.pointerId);
  }

  /** Touch: a tap starts or stops the magnifier; a swipe (not zooming) browses. @param {PointerEvent} e */
  #onUp(e) {
    const d = this.#down;
    this.#down = null;
    if (!d || e.pointerType === 'mouse') return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.hypot(dx, dy) < 10 && Date.now() - d.t < 500) {
      if (this._zoom) { this._zoom = false; this._locked = false; this._lens = null; return; }
      if (!this.#overImage(e)) return;
      this._zoom = true; this._locked = true;
      const item = this.#current;
      if (item) this.#loadOriginal(item);
      const [x, y] = this.#stagePoint(e);
      this.#place(x, y);
    } else if (!this._zoom && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) this.#go(dx < 0 ? 1 : -1);
  }

  /** @param {WheelEvent} e */
  #onWheel(e) {
    if (!this._zoom) return;
    e.preventDefault();
    this.#zoomStep(e.deltaY < 0 ? 1 : -1);
  }

  /** @param {PointerEvent} e */
  #onLeave(e) {
    if (e.pointerType === 'mouse' && !this._locked) { this._zoom = false; this._lens = null; }
  }

  /** A size that does not exist (Commons does not enlarge, a host without that size): try the next one. @param {MediaItem} item @param {string} url */
  #broken(item, url) {
    const next = [item.display, item.src, item.original].find(u => u !== url && !this.#tried.has(item.key + ' ' + u));
    this.#tried.add(item.key + ' ' + url);
    if (next) this._failed = new Map(this._failed).set(item.key, next);
  }
  #tried = new Set();

  // ── Render ─────────────────────────────────────────────────────────────

  updated() {
    // Keep the current thumbnail in view (in the strip only: the page itself does not scroll).
    const strip = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.thumbs'));
    const cur = /** @type {HTMLElement | null} */ (strip?.querySelector('[aria-current="true"]'));
    if (strip && cur && cur !== this.#scrolledTo) {
      this.#scrolledTo = cur;
      const left = cur.offsetLeft - strip.offsetLeft - (strip.clientWidth - cur.clientWidth) / 2;
      strip.scrollTo({ left: Math.max(0, left) });
    }
    // Next and previous, ready before they are asked for.
    const shown = this.#shown, at = shown.indexOf(/** @type {MediaItem} */ (this.#current));
    for (const n of [shown[at + 1], shown[at - 1]]) if (n && !this.#preloaded.has(n.key)) { this.#preloaded.add(n.key); const i = new Image(); i.referrerPolicy = 'no-referrer'; i.src = n.display; }
  }
  /** @type {HTMLElement | null} */ #scrolledTo = null;
  #preloaded = new Set();

  render() {
    const plant = this._plant, items = this._items, item = this.#current, shown = this.#shown;
    const at = item ? shown.indexOf(item) : -1;
    const counts = Object.fromEntries(KINDS.map(([k]) => [k, k === 'all' ? items.length : items.filter(i => i.kind === k).length]));
    return html`
      <div class="bar">
        ${icon('images')}
        <h2>Médias${plant ? html` — <i>${plant.scientificName}</i>` : nothing}</h2>
        ${item ? html`<span class="count" aria-live="polite">${at + 1} / ${shown.length}</span>` : nothing}
        <button class="icon-btn" type="button" aria-pressed=${String(this._loupe)} title="Loupe sur l’original (survol)" aria-label="Loupe sur l’original"
          @click=${() => { this._loupe = !this._loupe; this._zoom = false; this._locked = false; this._lens = null; }}>${icon('zoom-in')}</button>
        ${this.canFull ? html`<button class="icon-btn" type="button" aria-pressed=${String(this.full)} title=${this.full ? 'Quitter le plein écran' : 'Plein écran'} aria-label="Plein écran"
          @click=${() => this.dispatchEvent(new CustomEvent('media-full', { detail: { on: !this.full }, bubbles: true, composed: true }))}>${icon(this.full ? 'fullscreen-exit' : 'arrows-fullscreen')}</button>` : nothing}
        <button class="icon-btn" type="button" title="Fermer les médias" aria-label="Fermer les médias" @click=${() => this.#close()}>${icon('x-lg')}</button>
      </div>
      ${!item ? html`<div class="empty">${this._done ? (plant ? 'Aucune image sous licence libre pour cette plante (ou modules photos désactivés).' : 'Plante introuvable.') : html`<span class="spinner">chargement des médias…</span>`}</div>` : html`
        <div class="main">
          ${this.#stage(item, at, shown.length)}
          <aside class="side" aria-label="À propos de l’image">${this._zoom && this._lens && this.#wide ? this.#magnifier(item) : this.#info(item)}</aside>
        </div>
        <div class="strip">
          <div class="chips" role="group" aria-label="Type de média">
            ${KINDS.map(([k, label]) => html`<button type="button" aria-pressed=${String(this._filter === k)} ?disabled=${!counts[k] && k !== 'all'}
              @click=${() => this.#setFilter(k)}>${label} ${counts[k]}</button>`)}
            ${this._done ? nothing : html`<span class="muted small">chargement…</span>`}
          </div>
          <div class="thumbs" role="listbox" aria-label="Médias">
            ${shown.map(i => html`<button type="button" role="option" class=${i.kind} aria-current=${String(i.key === item.key)} aria-selected=${String(i.key === item.key)}
              title=${[KIND_LABEL[i.kind], i.source].join(' · ')} @click=${() => this.#select(i)}>
              <img src=${i.thumb} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"
                @error=${(/** @type {Event} */ e) => { const img = /** @type {HTMLImageElement} */ (e.target); if (img.src !== i.src) img.src = i.src; }} />
            </button>`)}
          </div>
        </div>`}`;
  }

  /** @param {MediaItem} item @param {number} at @param {number} n */
  #stage(item, at, n) {
    const src = this._failed.get(item.key) || item.display;
    const lens = this._zoom ? this._lens : null;
    const original = this._originals.get(item.key);
    return html`<div class="stage ${this._zoom ? 'zooming' : ''}"
        @pointermove=${this.#onMove} @pointerdown=${this.#onDown} @pointerup=${this.#onUp} @pointerleave=${this.#onLeave} @wheel=${this.#onWheel}>
      <img class="photo" src=${src} alt=${(KIND_LABEL[item.kind] || 'Image') + (this._plant ? ' de ' + this._plant.scientificName : '')}
        decoding="async" referrerpolicy="no-referrer" draggable="false"
        @load=${() => { if (this._lens) this.#place(this._lens.cx, this._lens.cy); }} @error=${() => this.#broken(item, src)} />
      <button class="nav prev" type="button" aria-label="Média précédent" ?disabled=${at <= 0} @click=${() => this.#go(-1)}>${icon('chevron-left')}</button>
      <button class="nav next" type="button" aria-label="Média suivant" ?disabled=${at >= n - 1} @click=${() => this.#go(1)}>${icon('chevron-right')}</button>
      ${lens ? html`<div class="lens" style="left:${lens.x}px;top:${lens.y}px;width:${lens.w}px;height:${lens.h}px"></div>` : nothing}
      ${lens && !this.#wide ? this.#magnifier(item) : nothing}
      ${this._loupe && !this._zoom ? html`<span class="hint">${this.#hover.matches ? 'Survolez la photo : loupe sur l’original · molette : grossissement' : 'Touchez la photo : loupe sur l’original'}</span>`
        : this._zoom && original === undefined ? html`<span class="hint">Chargement de l’original…</span>` : nothing}
    </div>`;
  }

  /** The original under the lens. @param {MediaItem} item */
  #magnifier(item) {
    const lens = this._lens;
    if (!lens) return nothing;
    const original = this._originals.get(item.key);
    const url = original && original !== 'error' ? item.original : this._failed.get(item.key) || item.display;
    const one = this.#oneToOne();
    const f = lens.f;
    const label = original === 'error' ? `×${nf.format(f)} · original indisponible` : original === undefined ? `×${nf.format(f)} · chargement de l’original…`
      : one && Math.abs(one - f) < 0.06 ? `1:1 (×${nf.format(f)}) · original` : `×${nf.format(f)} · original`;
    return html`<div class="magnifier ${lens.top ? 'top' : ''}" role="img" aria-label="Loupe"
      style="background-image:url(&quot;${url}&quot;);background-size:${lens.size};background-position:${lens.pos}">
      <span class="label">${label}</span></div>`;
  }

  /** What is known of the image. @param {MediaItem} item */
  #info(item) {
    const size = this.#originalSize(item);
    const page = item.pageUrl || item.sourceUrl;
    const where = [item.locality, item.country].filter(Boolean).join(', ');
    return html`<div class="info">
      <span class="kind">${KIND_LABEL[item.kind]} · ${item.source}</span>
      ${item.title ? html`<h3>${item.title}</h3>` : nothing}
      <gf-attribution .media=${item}></gf-attribution>
      <dl>
        ${size ? html`<dt>Original</dt><dd>${nf.format(size.w)} × ${nf.format(size.h)} px</dd>` : nothing}
        ${item.institution || item.catalogNumber ? html`<dt>Collection</dt><dd>${[item.institution, item.catalogNumber && 'n° ' + item.catalogNumber].filter(Boolean).join(' · ')}</dd>` : nothing}
        ${item.year ? html`<dt>Année</dt><dd>${item.year}</dd>` : nothing}
        ${where ? html`<dt>Lieu</dt><dd>${where}</dd>` : nothing}
      </dl>
      <div class="links">
        ${page ? html`<a href=${page} target="_blank" rel="noopener">${icon('box-arrow-up-right')} Voir à la source</a>` : nothing}
        <a href=${item.original} target="_blank" rel="noopener">${icon('image')} Ouvrir l’original</a>
      </div>
      ${this._loupe ? html`<p class="tip">${this.#hover.matches ? `Survolez la photo : la loupe affiche ${this.#wide ? 'ici' : 'sous la photo'} l’original. Molette : grossissement ; ← → : média précédent / suivant.` : 'Touchez la photo pour la loupe ; glissez pour changer de média.'}</p>` : nothing}
    </div>`;
  }
}

customElements.define('gf-media-viewer', GfMediaViewer);
