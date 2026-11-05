// @ts-check
// One block of a plant's sheet, alone: <gf-sheet-block plant-id key view> — wherever a block shows without its sheet:
// Flore's pane beside the sheet (?pane=), a block opened over the page (⤢, outside Flore), a screen's cell
// plant.<bloc> (layout/cells.js), an activity's simple sheet (miniapp/kit/ma-plant-sheet.js, one per block). It reads
// its plant and what that block shows only (SheetBase, sheet-base.js: the same loads and contents as the sheet's): the
// plant unreadable or not found said under its name's heading, a source down said with « Réessayer ». Its name a
// heading of level 2 that looks like the sheet's h1 (a block alone is always under its host's own title). It never
// draws the sheet's layout (King, the crown, the action bar, the rubrics, the table of contents), never sets the
// page's title, never writes the place read nor the panels opened (sheet-session.js: it reads the themes opened and
// « Mes lieux » unfolded, as the sheet left them), never takes the « Page web » pane.
//  - key: a block of the sheet (BLOCKS), a Note block (note:<id>) or a Carte block (map:<id>);
//  - view: the mode, as its host resolves it (Flore: the mode arranged on its sheet; a cell: its mode= or the app's;
//    over the page: the sheet's; the simple sheet: Épuré);
//  - titled: a block among others (the simple sheet) — its title an h3 when the view shows it, nothing when the view
//    leaves it out empty;
//  - local: among a screen's cells, its « Médias » viewer never takes the focus from where it is (nothing to close);
//  - at, startUrl: « Médias », the image to open at — by its place (Flore's &i=), or by its URL (a photo touched);
//  - channel: the search its maps about « Les résultats » read (core/search-channel.js), as the sheet's.
// Its media viewer's events (media-index, media-close) go through to the host as they are.

import { html, css, nothing } from 'lit';
import { href } from '../core/router.js';
import { icon } from '../core/icons.js';
import { aloneNote, blockStyle, blockTitle, hidesEmpty, isMap, isTitleShown } from '../core/sheet-blocks.js';
import { SheetBase, sheetStyles } from './sheet-base.js';

export class GfSheetBlock extends SheetBase {
  static properties = {
    /** The block shown. */
    key: { reflect: true },
    /** A block among others (an activity's simple sheet): titled as the sheet titles it. */
    titled: { type: Boolean },
    /** Among a screen's cells: its media viewer never takes the focus (gf-media-viewer local). */
    local: { type: Boolean },
    /** « Médias »: the image to open at, by its place among the plant's media. */
    at: { attribute: false },
    /** « Médias »: the image to open at, by its URL (a photo touched). */
    startUrl: { attribute: false }
  };

  static styles = [sheetStyles, css`
    /* A block alone, at full size (a pane, a cell, over the page): the media viewer fills it, any other block scrolls. */
    :host { display: flex; flex-direction: column; min-height: 0; overflow: hidden auto; padding: 0 14px; }
    :host([key='media']) { overflow: hidden; }
    gf-media-viewer { flex: 1; min-height: 0; }
    article { padding-top: 4px; }
    :is(h1, h2.h1) { margin-top: 4px; }
    .only-pad { padding: 12px 16px; }
    .block.only { margin: 0; }
    /* Titled (a block among others): its title as the sheet's (an h3 there). */
    .block.only > h3.block-title { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--gf-text-muted); font-weight: 600; }
    .only-pad.fill, .only-pad.fill > .block, .only-pad.fill > .block > .content { flex: 1; display: flex; flex-direction: column; min-height: 0; }
  `];

  constructor() {
    super();
    this.key = '';
    this.titled = false;
    this.local = false;
    /** @type {number | null} */
    this.at = null;
    /** @type {string | null} */
    this.startUrl = null;
    // Always under its host's own title.
    this.subheading = true;
  }

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    super.willUpdate(changed);
    // Another block in its place (the pane, the block over the page, turned to another one): its data, same plant.
    if (changed.has('key') && !changed.has('plantId')) this._loadShown();
  }

  // ── SheetBase's hooks: a block alone ──────────────────────────────────────────────────────────────────────

  /** Its own block's data only — none when it cannot show it (aloneNote). @param {string} key */
  _shows(key) { return key === this.key && !aloneNote(key); }

  /** A map alone fills its room. @param {string} key */
  _fills(key) { return true; }

  /** The article's themes stay in it: no other block beside it. @param {string} theme */
  _wikiHost(theme) { return null; }

  /** No article beside it to read in. */
  get _reader() { return false; }

  /** No map beside it: what the sheet's map would show stays text (Occurrences' areas, months, sources; the sosies). */
  get _hasMap() { return false; }

  /** To a theme of the article (its menu): opened, then brought to the top of the block. @param {string} key */
  async goTo(key) {
    await super.goTo(key);
    if (!key.startsWith('wiki:')) return;
    await this.updateComplete;
    this.renderRoot.querySelector('#wiki-' + CSS.escape(key.slice(5)))?.scrollIntoView({ block: 'start' });
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
    if (plant === null) return html`<article>${this._heading('Plante introuvable')}</article>`;
    return html`${this.#block(this._context(plant))}${this._paneDialogView(plant)}`;
  }

  /**
   * The block at full size: the media viewer fills it (alone in a pane, the keys its at once; among a screen's cells,
   * never the focus), any other block scrolls in it. Titled: its title as the view shows it, nothing when the view
   * leaves it out empty. What it cannot show, it says (aloneNote). @param {any} ctx
   */
  #block(ctx) {
    const key = this.key, v = this._view;
    const note = aloneNote(key);
    if (note) {
      return html`<p class="muted only-pad">${note.kind === 'off'
        ? html`${icon('eye-slash')} ${note.text} (<a href=${href.settings()}>Réglages › Modules</a>).` : note.text}</p>`;
    }
    if (key === 'media') {
      return ctx.photosOff ? html`<p class="muted only-pad">Photos en ligne désactivées (<a href=${href.settings()}>Réglages › Modules</a>).</p>`
        : html`<gf-media-viewer ?local=${this.local} plant-id=${ctx.plant.id} presentation=${blockStyle(v, 'media')} .index=${this.at ?? 0} .startUrl=${this.startUrl}></gf-media-viewer>`;
    }
    const empty = this.titled && key !== 'uses' && hidesEmpty(v, key);
    if (empty && this._emptyHere(key, ctx)) return nothing;
    const title = this.titled && isTitleShown(v, key) ? html`<h3 class="block-title"><span class="name">${blockTitle(key)}</span></h3>` : nothing;
    return html`<div class="only-pad ${isMap(key) ? 'fill' : ''}"><section class="block only ${empty ? 'hide-empty' : ''} ${isMap(key) ? 'map-block' : ''}" data-key=${key}>${title}<div class="content">${this._content(key, ctx)}</div></section></div>`;
  }
}

customElements.define('gf-sheet-block', GfSheetBlock);
