// @ts-check
// Les orchidées de la colline de Mirabel, on the map (the step « map »; what is pure about it: kit/orchids.js). A panel
// beside the map (a wide screen: on its left; a phone: under it) — its title, where the circle is and how far (the
// slider of the app's distances; the circle's handle on the map too), how many observations, the search by name, the
// light filters (genus, protection and statuses: chips with their counts, in observations), the orchids found (the
// most observed first; those named to the genus only, or above it, apart in the count) — and the map: the circle and
// every observation the filters keep, each its plant's photo (a leaf without one), its card on hover; one whose
// position is approximate drawn apart, with its margin (« position approximative (± 27 km) »). Its panel ▦, « Sur
// cette carte »: iNaturalist, GBIF (one at least), « Cultivées ou plantées », « Positions approximatives », all ticked
// at first, kept in the activity's context (unticked, the approximate ones hidden: the count says how many). An orchid's row
// hovered or focused lights its points; a point under the mouse lights its row. A point or a row touched: its plant's
// simple sheet (ma-plant-sheet `simple`: « Médias » and « L'essentiel »; the event ma-plant, the box keeps ?p=), the
// focus in it, beside the map on a wide screen (over it on a phone: the screen under it out of reach), Back or Échap
// closing it (the focus back on the row); an orchid the flora does not know, or named above the species, has none
// (said why). A long press on the map, confirmed (« Chercher autour d'ici ? »): the circle there; « Revenir à la
// colline » brings it back. Loading, nothing observed, nothing the filters keep, a source down or switched off,
// offline (asked again as the connection comes back), observations left out for their rough position: said in the
// panel (its status line read aloud), with « Réessayer » when it may help; a button that goes as it is pressed leaves
// the focus on what follows it. It writes only the activity's context (app.set): no mode, no sheet layout.

import { LitElement, html, css, nothing } from 'lit';
import { config } from '../../config.js';
import { forgetFailures } from '../../core/cache.js';
import { icon } from '../../core/icons.js';
import { fr } from '../../core/fr.js';
import { nearestStop } from '../../core/distance.js';
import { SOURCES, SOURCE_NAMES, failedText, obsNotes } from '../../core/observations.js';
import { speciesKey } from '../../components/map-style.js';
import { ui } from '../../styles/ui.js';
import { DISTANCES, distanceAt, distanceEvents, distanceKey, distLabel, distWords } from './cards.js';
import { NO_GENUS, SITE, askedKey, filtering, sameSpot, sourcesOf } from './orchids.js';
import './ma-plant-sheet.js';
import '../../components/gf-map.js';
import '../../components/gf-thumb.js';

/**
 * @typedef {import('./orchids.js').Orchid} Orchid
 * @typedef {import('./orchids.js').Choice} Choice
 * @typedef {import('./orchids.js').Shown} Shown
 * @typedef {import('./orchids.js').Found} Found
 */

/** Where the width of a plant's sheet beside the map is kept (the manifest's owns.keys: « Recommencer » forgets it). */
const SHEET_KEY = config.storageKeys.appPrefix + 'orchidees.sheet';
/** How the circle moves, said under the place and to the map's readers. */
const PRESS = 'Appui long sur la carte, puis « Confirmer » : le cercle s’y centre.';
/** The circle's handle on the map: from stop to stop of the slider (core/distance.js STOPS), its keys and its words. */
const HANDLE = { snap: (/** @type {number} */ m) => nearestStop(m), step: distanceKey, label: distLabel };
/** iNaturalist's observations asked at most, GBIF's page (core/observations.js): more in the circle, said. */
const INAT_MAX = 1000, GBIF_MAX = 300;
/** Each source's row of « Sur cette carte »: what it gives. */
const SOURCE_HINTS = { inat: 'ses observations dans le cercle', gbif: 'ses occurrences dans le cercle : herbiers, inventaires, Pl@ntNet…' };

/** « d’iNaturalist », « de GBIF ». @param {string} name */
const of = name => /^[aeiouyh]/i.test(name) ? 'd’' + name : 'de ' + name;
/** « 12 observations », « 1 orchidée ». @param {number} n @param {string} word */
const counted = (n, word) => `${n.toLocaleString('fr-FR')} ${word}${n > 1 ? 's' : ''}`;
/** Why an orchid has no sheet: named to the genus only, above it, or outside the app's flora. @param {Orchid} o */
const noSheet = o => o.rank === 'genus' ? 'identifiée au genre seulement' : o.rank === 'higher' ? 'genre non précisé' : 'hors de la flore de l’app';
/**
 * The orchids found, in words: those named to the species, then the others (« 4 orchidées et 2 non identifiées à
 * l’espèce »). @param {Orchid[]} orchids
 */
function orchidsText(orchids) {
  const named = orchids.filter(o => o.rank === 'species').length, rough = orchids.length - named;
  return [named || !rough ? counted(named, 'orchidée') : '', rough ? `${counted(rough, 'non identifiée')} à l’espèce` : ''].filter(Boolean).join(' et ');
}

export class MaOrchids extends LitElement {
  static properties = {
    app: { attribute: false },
    /** The activity's context: the circle, the filters, what the sources gave (`obs`) and what the filters keep (`shown`). */
    c: { attribute: false },
    /** The orchid lit (its row hovered or focused, or one of its points under the mouse): its key, and from where. */
    _lit: { state: true }
  };

  static styles = [ui, css`
    /* A grid cell gives it its height; the panel and the map share it. */
    :host { display: block; position: relative; height: 100%; min-height: 0; background: var(--gf-bg, var(--gf-surface-2)); container-type: inline-size; }
    /* A plant's sheet beside the map (a wide screen): the map keeps clear of it. */
    @media (min-width: 900px) { :host([sheet]) { padding-right: var(--ma-sheet-w, min(560px, 48vw)); box-sizing: border-box; } }
    .wrap { height: 100%; display: grid; grid-template-columns: minmax(280px, 360px) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
    .panel { display: flex; flex-direction: column; gap: 12px; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 16px 16px 24px;
      background: var(--gf-surface); border-right: 1px solid var(--gf-border); }
    /* Its parts keep their height: the panel scrolls (on a phone it always does), never squeezes them. */
    .panel > * { flex-shrink: 0; }
    .map { position: relative; min-height: 0; }
    .map gf-map { position: absolute; inset: 0; display: block; }
    /* A phone (or a narrow column): the map a band on top, the panel under it, scrolling. */
    @container (max-width: 699px) {
      .wrap { grid-template-columns: minmax(0, 1fr); grid-template-rows: min(44dvh, 400px) minmax(0, 1fr); }
      .map { grid-row: 1; }
      .panel { grid-row: 2; border-right: 0; border-top: 1px solid var(--gf-border); padding: 12px 16px 24px; }
    }
    h1 { margin: 0; font-size: 1.3rem; line-height: 1.25; text-wrap: balance; }
    h1:focus { outline: none; }
    h2 { margin: 0 0 6px; font-size: 0.8125rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--gf-text-muted); }
    p { margin: 0; }
    .where { display: flex; align-items: baseline; gap: 8px; font-weight: 600; }
    .where .bi { flex: none; color: var(--gf-accent); }
    .back-home { align-self: start; }
    /* The text actions a target of their own (a finger: 44 px). */
    .back-home, .clear, .empty .link { min-height: 32px; padding: 4px 0; }
    @media (pointer: coarse) { .back-home, .clear, .empty .link { min-height: 44px; } }
    .hint, .note, .credit { font-size: 0.8125rem; color: var(--gf-text-muted); }
    .radius { display: flex; align-items: center; gap: 10px; font-size: 0.9rem; }
    .radius input { flex: 1; min-width: 0; margin: 0; accent-color: var(--gf-accent); }
    .radius b { flex: none; min-width: 52px; text-align: right; font-variant-numeric: tabular-nums; color: var(--gf-accent); }
    .count { font-weight: 600; }
    .alert { display: grid; gap: 8px; justify-items: start; padding: 10px 12px; border-radius: 10px; color: var(--gf-danger); background: var(--gf-danger-bg); }
    .search { position: relative; display: block; }
    .search .bi { position: absolute; left: 12px; top: 50%; translate: 0 -50%; color: var(--gf-text-muted); pointer-events: none; }
    .search input { padding-left: 36px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chips button { gap: 6px; }
    .chips .n { color: var(--gf-text-muted); font-variant-numeric: tabular-nums; font-weight: 500; }
    .clear { align-self: start; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
    ul[aria-busy='true'] { opacity: 0.55; }
    .row { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 2px 10px; width: 100%; min-height: 56px; padding: 6px 8px;
      border: 1px solid transparent; border-radius: 12px; background: none; color: var(--gf-text); text-align: left; font-weight: 400; justify-content: stretch; }
    .row > gf-thumb, .row > .leaf { grid-row: span 2; }
    .row .leaf { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: var(--gf-surface-2); color: var(--gf-text-muted); }
    button.row:hover, li.lit .row { background: var(--gf-accent-soft); border-color: color-mix(in srgb, var(--gf-accent) 40%, transparent); }
    .names { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 8px; min-width: 0; }
    .names b { overflow-wrap: anywhere; }
    .names i { font-size: 0.8125rem; color: var(--gf-text-muted); overflow-wrap: anywhere; }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 0.8125rem; color: var(--gf-text-muted); }
    .tag { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: var(--gf-radius-pill); font-weight: 600; font-size: 0.75rem;
      background: var(--gf-surface-2); color: var(--gf-text); }
    .tag.prot { background: color-mix(in srgb, var(--gf-accent) 16%, var(--gf-surface)); }
    .tag.red { background: color-mix(in srgb, var(--gf-danger) 14%, var(--gf-surface)); }
    .none { font-style: italic; }
    .empty { display: grid; gap: 8px; justify-items: start; color: var(--gf-text-muted); }
  `];

  constructor() {
    super();
    /** @type {import('../runtime.js').MiniApp | null} */
    this.app = null;
    /** @type {Record<string, any> | null} */
    this.c = null;
    /** @type {{ key: string, from: 'list' | 'map' } | null} */
    this._lit = null;
  }

  /** The plant of the sheet open (the last one, its pager stepped through), whose row gets the focus back once it is closed. @type {number | null} */
  #from = null;
  /** A sheet was open at the last update. */
  #open = false;
  /** The plant touched (its row, its point): the focus into its sheet once it is open. @type {number | null} */
  #toSheet = null;
  /** Where the focus goes once drawn, the button pressed gone with the update (« Effacer les filtres »…): a selector. @type {string | null} */
  #then = null;
  /** A wide screen: the sheet beside the map (else over everything: the screen under it out of reach). */
  #wide = matchMedia('(min-width: 900px)');

  get #map() { return /** @type {any} */ (this.renderRoot.querySelector('gf-map')); }

  connectedCallback() {
    super.connectedCallback();
    addEventListener('online', this.#onOnline);
    this.#wide.addEventListener('change', this.#onWide);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    removeEventListener('online', this.#onOnline);
    this.#wide.removeEventListener('change', this.#onWide);
  }

  #onWide = () => { this.requestUpdate(); };

  /** The connection back, the observations missing for want of it: asked again (as « Réessayer »). */
  #onOnline = () => { if (/** @type {Found | null} */ (this.c?.obs)?.error?.offline && !this.#loading) this.#retry(); };

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (changed.has('c')) this.toggleAttribute('sheet', typeof this.c?.focus === 'number');
  }

  firstUpdated() {
    // The step reached (« Commencer »: its button gone): the focus on the screen's title.
    if (typeof this.c?.focus !== 'number') /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('#or-title'))?.focus();
  }

  updated() {
    const c = this.c;
    if (!c) return;
    // While the circle's observations come: a thin line at the map's top (gf-map busy; said by the panel's status line).
    this.#map?.busy?.('orchids', this.#loading);
    // A sheet opened by a touch (its row, its point): the focus into it. Closed (Back, Échap, its ←): the focus back
    // on its plant's row (else the title: filtered out since).
    const open = typeof c.focus === 'number';
    if (open) this.#from = c.focus;
    else if (this.#open && this.#from != null) {
      const row = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector(`button.row[data-id="${this.#from}"]`));
      (row ?? /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('#or-title')))?.focus();
      this.#from = null;
    }
    if (open && this.#toSheet === c.focus) {
      this.#toSheet = null;
      /** @type {any} */ (this.renderRoot.querySelector('ma-plant-sheet'))?.takeFocus();
    }
    this.#open = open;
    // The button pressed gone (the filters cleared, the circle back on the hill, asked again): the focus on what follows.
    if (this.#then) {
      const to = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector(this.#then));
      if (!/** @type {ShadowRoot} */ (this.renderRoot).activeElement) to?.focus();
      this.#then = null;
    }
  }

  /** What is asked is not what is shown yet (the circle changed, « Réessayer »): it comes. */
  get #loading() {
    const c = /** @type {any} */ (this.c);
    return !c.obs || c.obs.key !== askedKey(c);
  }

  /** An orchid's sheet (its plant), touched: the box keeps it in the address (?p=); the focus into it. @param {number} id */
  #sheet(id) {
    if (this.c?.focus === id) { /** @type {any} */ (this.renderRoot.querySelector('ma-plant-sheet'))?.takeFocus(); return; }
    this.#toSheet = id;
    this.dispatchEvent(new CustomEvent('ma-plant', { detail: { id }, bubbles: true, composed: true }));
  }

  /** @param {string} key @param {string} value */
  #toggle(key, value) {
    const now = /** @type {string[]} */ (this.c?.[key] ?? []);
    this.app?.set({ [key]: now.includes(value) ? now.filter(v => v !== value) : [...now, value] });
  }

  /**
   * « Réessayer »: the circle asked again — the sources' failures remembered for a few minutes forgotten first (the
   * zone's, core/cache.js), as a free layout's « Réessayer » does.
   */
  #retry() {
    forgetFailures('around');
    this.#then = '#or-title';
    this.app?.set({ retry: (this.c?.retry ?? 0) + 1 });
  }

  /** « Effacer les filtres »: every filter off, the search too (the focus there). */
  #clear() {
    this.#then = 'input[type="search"]';
    this.app?.set({ genera: [], marks: [], query: '' });
  }

  /** « Revenir à la colline »: the circle on the hill again (the focus on the screen's title). */
  #home() {
    this.#then = '#or-title';
    this.app?.set({ point: SITE });
  }

  /** An orchid lit, or none (`from`: its row, or one of its points). @param {string | null} key @param {'list' | 'map'} [from] */
  #light(key, from = 'list') {
    if (key == null) { if (this._lit?.from === from) this._lit = null; return; }
    if (this._lit?.key !== key || this._lit.from !== from) this._lit = { key, from };
  }

  /** A point touched on the map: its plant's sheet, or, outside the flora, said. @param {CustomEvent} e */
  #onPick = e => {
    const key = e.detail?.point?.orchid;
    const o = /** @type {Found | null} */ (this.c?.obs)?.orchids.find(x => x.key === key);
    if (!o) return;
    if (o.plant) this.#sheet(o.plant.id);
    else this.#map?.toast(fr(`${o.common || o.name} : pas de fiche (${noSheet(o)}).`));
  };

  /** A point under the mouse (never a touch: it picks): its row lit. @param {CustomEvent} e */
  #onHover = e => { this.#light(e.detail?.point?.orchid ?? null, 'map'); };

  /** A long press confirmed (« Chercher autour d’ici ? »): the circle there (within a metre: where it is already). @param {CustomEvent} e */
  #onPress = e => {
    const at = e.detail?.coordinates;
    if (!Array.isArray(at) || sameSpot(this.c?.point, /** @type {[number, number]} */ (at))) return;
    this.app?.set({ point: [Number(at[0].toFixed(5)), Number(at[1].toFixed(5))] });
  };

  /** The image its « Médias » show (the address's &m=). @param {CustomEvent} e */
  #onMediaIndex = e => {
    e.stopPropagation();
    const at = Number(e.detail?.index) || null;
    if (this.c && this.c.mediaAt !== at) this.app?.set({ mediaAt: at });
  };

  /**
   * « Sur cette carte » of the map's panel ▦: the sources (one at least: the last one ticked cannot be unticked, said
   * why), the plants grown, the approximate positions — the activity's choices, kept. The same array while the same.
   * @returns {import('../../components/gf-map-options.js').DataRow[]}
   */
  #dataRows() {
    const c = /** @type {Record<string, any>} */ (this.c), sources = sourcesOf(c);
    /** @type {import('../../components/gf-map-options.js').DataRow[]} */
    const rows = SOURCES.map(s => {
      const alone = sources.length === 1 && sources[0] === s, other = SOURCE_NAMES[SOURCES.find(x => x !== s) ?? s];
      return { key: 'src:' + s, kind: /** @type {const} */ ('check'), label: SOURCE_NAMES[s], hint: SOURCE_HINTS[s], value: sources.includes(s),
        ...(alone ? { disabled: true, why: `Une source au moins : cochez ${other} pour décocher celle-ci.` } : {}) };
    });
    rows.push({ key: 'cultivated', kind: 'check', label: 'Cultivées ou plantées', value: c.cultivated !== false,
      hint: 'cultivées ou captives (iNaturalist) ; gérées, cultivées, captives ou relâchées (GBIF) — décochées : les sauvages seulement' });
    rows.push({ key: 'approximate', kind: 'check', label: 'Positions approximatives', value: c.approximate !== false,
      hint: 'masquées par l’observateur, ou plus larges que le cercle : dessinées avec leur marge' });
    const key = JSON.stringify(rows);
    if (this.#rowsMemo?.key !== key) this.#rowsMemo = { key, rows };
    return this.#rowsMemo.rows;
  }
  /** @type {{ key: string, rows: import('../../components/gf-map-options.js').DataRow[] } | null} */ #rowsMemo = null;

  /** A row of « Sur cette carte » changed: the activity's choice (the circle asked again). @param {CustomEvent} e */
  #onData = e => {
    const { key, value } = e.detail ?? {};
    const c = /** @type {Record<string, any>} */ (this.c);
    if (typeof key !== 'string' || !c) return;
    if (key.startsWith('src:')) {
      const now = sourcesOf(c), next = SOURCES.filter(s => 'src:' + s === key ? Boolean(value) : now.includes(s));
      if (next.length) this.app?.set({ sources: next });
    } else if (key === 'cultivated' || key === 'approximate') this.app?.set({ [key]: Boolean(value) });
  };

  /** The circle and the observations the filters keep, the same object while they do not change (the map keeps its points). */
  #area() {
    const c = /** @type {Record<string, any>} */ (this.c), points = c.shown?.points ?? [];
    const a = this.#areaMemo;
    if (a && a.center === c.point && a.radius === c.radius && a.points === points) return a;
    return (this.#areaMemo = { center: c.point, radius: c.radius, fit: true, leaves: true, points });
  }
  /** @type {any} */ #areaMemo = null;

  /** The points of the orchid whose row is hovered or focused, lit on the map (by their kin keys: map-style.js speciesKey). */
  #litKeys() {
    const lit = this._lit, points = this.c?.shown?.points;
    if (!lit || lit.from !== 'list' || !points) return null;
    const m = this.#litMemo;
    if (m && m.key === lit.key && m.points === points) return m.keys;
    const keys = new Set(points.filter((/** @type {any} */ p) => p.orchid === lit.key).map(speciesKey).filter(Boolean));
    this.#litMemo = { key: lit.key, points, keys: keys.size ? keys : null };
    return this.#litMemo.keys;
  }
  /** @type {{ key: string, points: unknown, keys: Set<string> | null } | null} */ #litMemo = null;

  /**
   * The cards a sheet steps through (‹ Préc., Suivante ›): the orchids of the list that have one — and the one open,
   * in its place, if the filters left it out since (a wide screen: they are beside it).
   */
  #cards() {
    const orchids = /** @type {Orchid[]} */ (this.c?.shown?.orchids ?? []), all = /** @type {Orchid[]} */ (this.c?.obs?.orchids ?? []), open = this.c?.focus;
    const m = this.#cardsMemo;
    if (m && m.orchids === orchids && m.all === all && m.open === open) return m.cards;
    const kept = new Set(orchids.map(o => o.key));
    const cards = all.filter(o => o.plant && (kept.has(o.key) || o.plant.id === open)).map(o => ({ plant: o.plant }));
    this.#cardsMemo = { orchids, all, open, cards };
    return cards;
  }
  /** @type {{ orchids: Orchid[], all: Orchid[], open: unknown, cards: any[] } | null} */ #cardsMemo = null;

  render() {
    const c = this.c, app = this.app;
    if (!c || !app) return nothing;
    const found = /** @type {Found | null} */ (c.obs), shown = /** @type {Shown | null} */ (c.shown);
    const ok = found && !found.error;
    const sheet = typeof c.focus === 'number'
      ? html`<ma-plant-sheet .open=${c.focus} .mediaAt=${c.mediaAt ?? 0} .cards=${this.#cards()} scoped simple layout-key=${SHEET_KEY}
          @media-index=${this.#onMediaIndex}></ma-plant-sheet>` : nothing;
    // The panel first: the keyboard reaches the filters and the list before the map's points.
    // A phone: the sheet over everything, what is under it out of reach until it closes.
    return html`<div class="wrap" ?inert=${sheet !== nothing && !this.#wide.matches}>
      <section class="panel" aria-labelledby="or-title">
        <h1 id="or-title" tabindex="-1">Les orchidées de la colline de Mirabel</h1>
        ${this.#where()}
        ${this.#radius()}
        ${this.#said(found, shown)}
        ${ok && found.orchids.length ? html`${this.#search()}${shown ? this.#filters(shown) : nothing}${shown ? this.#list(found, shown) : nothing}` : nothing}
        <p class="credit">${fr('Observations : iNaturalist et GBIF ; protection et statuts : INPN.')}</p>
      </section>
      <div class="map"><gf-map no-create no-search no-areas press="zone" point-click="pick" aria-description=${PRESS}
        .area=${this.#area()} .litKeys=${this.#litKeys()} .radiusHandle=${HANDLE} .data=${this.#dataRows()}
        @point-pick=${this.#onPick} @point-hover=${this.#onHover} @point-info=${this.#onPress} @data-change=${this.#onData}
        @radius-change=${(/** @type {CustomEvent} */ e) => app.set({ radius: e.detail.radius })}></gf-map></div>
    </div>${sheet}`;
  }

  /** Where the circle is: the hill, or the point a long press chose (« Revenir à la colline »); how to move it. */
  #where() {
    const c = /** @type {Record<string, any>} */ (this.c), home = sameSpot(c.point, SITE);
    return html`<p class="where">${icon('geo-alt-fill')}<span>${home ? 'Colline de Mirabel, Ménétrol (Puy-de-Dôme)' : 'Autour du point choisi sur la carte'}</span></p>
      ${home ? nothing : html`<button class="link back-home" type="button" @click=${() => this.#home()}>Revenir à la colline</button>`}
      <p class="hint">${fr(PRESS)}</p>`;
  }

  /** How far: the app's distances, from stop to stop (cards.js), as the games' and a free layout's sliders. */
  #radius() {
    const c = /** @type {Record<string, any>} */ (this.c);
    const on = distanceEvents(() => /** @type {Record<string, any>} */ (this.c).radius, m => this.app?.set({ radius: m }));
    return html`<label class="radius"><span>Rayon</span>
      <input type="range" min="0" max=${DISTANCES.length - 1} step="any" .value=${String(distanceAt(c.radius))} aria-label="Rayon du cercle"
        aria-valuetext=${distWords(c.radius)} @input=${on.input} @keydown=${on.keydown} />
      <b>${distLabel(c.radius)}</b></label>`;
  }

  /**
   * What the panel says of the observations, its status line read aloud: coming, how many (of how many when filtered;
   * those hidden for their approximate position, « Positions approximatives » unticked), none here; a source that did
   * not answer, the other's alone; more than the map holds; those on the map with their margin; no source at all, an
   * alert (« Réessayer » unless switched off). @param {Found | null} found @param {Shown | null} shown
   */
  #said(found, shown) {
    const loading = this.#loading;
    if (found?.error && !loading) {
      return html`<p class="count" role="status"></p><div class="alert" role="alert">${icon('exclamation-triangle-fill')}<span>${fr(found.error.text)}</span>
        ${found.error.retry ? html`<button class="small retry" type="button" @click=${() => this.#retry()}>${icon('arrow-clockwise')} Réessayer</button>` : nothing}</div>`;
    }
    const total = found && !found.error ? found.points.length : 0, hidden = found && !found.error ? found.hidden ?? 0 : 0;
    const few = hidden.toLocaleString('fr-FR');
    const status = loading || !found || found.error ? 'Les orchidées observées arrivent…'
      : !total ? `Aucune orchidée observée dans ce cercle${hidden ? `, sauf ${few} ${hidden > 1 ? 'cachées' : 'cachée'} : position approximative` : ''}.`
      : `${shown && shown.points.length !== total ? `${counted(shown.points.length, 'observation')} sur ${total.toLocaleString('fr-FR')}` : counted(total, 'observation')}`
        + `${hidden ? ` (${few} ${hidden > 1 ? 'autres cachées' : 'autre cachée'} : position approximative)` : ''} · ${orchidsText(shown?.orchids ?? found.orchids)}`;
    const notes = [];
    if (found && !found.error) {
      const failed = found.failed, answered = SOURCES.filter(s => found.totals[s] != null).map(s => SOURCE_NAMES[s]);
      if (failed.length && answered.length) notes.push(`${failedText(failed)} : les observations ${of(answered[0])} seules.`);
      if ((found.totals.inat ?? 0) > INAT_MAX) notes.push(`iNaturalist en compte ${found.totals.inat?.toLocaleString('fr-FR')} : les ${INAT_MAX.toLocaleString('fr-FR')} plus récentes sont sur la carte.`);
      if ((found.totals.gbif ?? 0) > GBIF_MAX) notes.push(`GBIF en compte ${found.totals.gbif?.toLocaleString('fr-FR')} : ${GBIF_MAX} sont sur la carte.`);
      if (found.vague) notes.push(`${counted(found.vague, 'observation')} à la position approximative (masquée par l’observateur, ou plus large que le cercle) : `
        + `${found.vague > 1 ? 'leur' : 'sa'} marge en pointillés sur la carte.`);
    }
    return html`<p class="count" role="status">${fr(status)}</p>
      ${notes.map(n => html`<p class="note">${fr(n)}</p>`)}
      ${found && !found.error && !total && !loading ? html`<p class="empty">${fr('Agrandissez le cercle, ou centrez-le ailleurs : appui long sur la carte.')}</p>` : nothing}`;
  }

  /** The search by name: French or scientific, any of its words, case and accents aside. */
  #search() {
    const c = /** @type {Record<string, any>} */ (this.c);
    return html`<label class="search">${icon('search')}<span class="visually-hidden">Chercher une orchidée par son nom</span>
      <input type="search" .value=${c.query} placeholder="Un nom : ophrys, orchis…" autocomplete="off" enterkeyhint="search"
        @input=${(/** @type {InputEvent} */ e) => this.app?.set({ query: /** @type {HTMLInputElement} */ (e.target).value })} /></label>`;
  }

  /** The light filters: the genera, the protection and statuses — chips with their counts —, and « Effacer les filtres ». @param {Shown} shown */
  #filters(shown) {
    const c = /** @type {Record<string, any>} */ (this.c);
    return html`${this.#group('genus', 'Genre', 'genera', shown.genera)}
      ${this.#group('marks', 'Protection et statuts', 'marks', shown.marks)}
      ${filtering(c) ? html`<button class="link clear" type="button" @click=${() => this.#clear()}>Effacer les filtres</button>` : nothing}`;
  }

  /**
   * A filter: its choices as chips (pressed: chosen), each with its count of observations; none to choose, left out.
   * @param {string} id @param {string} label @param {'genera' | 'marks'} key @param {Choice[]} choices
   */
  #group(id, label, key, choices) {
    if (!choices.length) return nothing;
    const chosen = /** @type {string[]} */ (this.c?.[key] ?? []);
    return html`<div class="facet" role="group" aria-labelledby=${'or-' + id}>
      <h2 id=${'or-' + id}>${label}</h2>
      <div class="chips">${choices.map(x => html`<button type="button" class="chip" data-value=${x.value} aria-pressed=${String(chosen.includes(x.value))}
        aria-label=${`${x.label}, ${counted(x.count, 'observation')}`} title=${x.title ?? nothing} @click=${() => this.#toggle(key, x.value)}>${key === 'genera' && x.value !== NO_GENUS
          ? html`<i>${x.label}</i>` : x.label} <span class="n" aria-hidden="true">${x.count.toLocaleString('fr-FR')}</span></button>`)}</div>
    </div>`;
  }

  /** The orchids the filters keep, the most observed first; none, said. @param {Found} found @param {Shown} shown */
  #list(found, shown) {
    if (!shown.orchids.length) {
      return html`<p class="empty">${fr('Aucune orchidée ne répond à ces filtres.')}
        <button class="link" type="button" @click=${() => this.#clear()}>Effacer les filtres</button></p>`;
    }
    // The sources that answered (those not asked, or not answering, have no count).
    const sources = SOURCES.filter(s => found.totals[s] != null);
    const notes = obsNotes(new Map(shown.orchids.map((o, i) => [i, o])), sources);
    return html`<div><h2 id="or-list">Orchidées observées</h2>
      <ul aria-labelledby="or-list" aria-busy=${String(this.#loading)}>${shown.orchids.map((o, i) => this.#row(o, notes.get(i)))}</ul></div>`;
  }

  /**
   * An orchid: its photo, its names, its observations, what protects it here; touched, its sheet (none outside the
   * flora, said). Hovered or focused, its points lit on the map.
   * @param {Orchid} o @param {{ text: string, title: string } | undefined} note
   */
  #row(o, note) {
    const lit = this._lit?.key === o.key;
    const body = html`${o.plant ? html`<gf-thumb .plant=${o.plant} size="40" round></gf-thumb>` : html`<span class="leaf" aria-hidden="true">${icon('flower2')}</span>`}
      <span class="names"><b>${o.common || o.name}</b>${o.common ? html`<i>${o.name}</i>` : nothing}</span>
      <span class="meta"><span title=${note?.title ?? nothing}>${note?.text}</span>${this.#tags(o)}${o.plant ? nothing : html`<span class="none">${fr(`pas de fiche : ${noSheet(o)}`)}</span>`}</span>`;
    const on = () => this.#light(o.key), off = () => this.#light(null);
    return html`<li class=${lit ? 'lit' : ''} data-key=${o.key}>${o.plant
      ? html`<button class="row" type="button" data-id=${o.plant.id} @click=${() => this.#sheet(o.plant.id)} @mouseenter=${on} @mouseleave=${off} @focus=${on} @blur=${off}>${body}</button>`
      : html`<div class="row" @mouseenter=${on} @mouseleave=${off}>${body}</div>`}</li>`;
  }

  /** What protects an orchid where the circle is (INPN), in a few words. @param {Orchid} o */
  #tags(o) {
    const f = o.facts;
    if (!f) return nothing;
    return html`${f.here ? html`<span class="tag prot">${icon('shield-check')} Protégée (${f.here})</span>` : nothing}${f.red
      ? html`<span class="tag red">${fr(`Liste rouge : ${f.red}`)}</span>` : nothing}${f.endemic ? html`<span class="tag">Endémique</span>` : nothing}`;
  }
}

customElements.define('ma-orchids', MaOrchids);
