// @ts-check
import { LitElement, html, css, nothing, repeat } from 'lit';
import { STATUS_LABELS } from '../config.js';
import * as db from '../core/db.js';
import { lastSearchHash } from '../core/query.js';
import { setPlantView, setTarget, StoreController, whenReady } from '../core/store.js';
import { getMembership, setInCollection, toggleFavorite } from '../core/collections.js';
import { href } from '../core/router.js';
import { share } from '../core/share.js';
import * as sources from '../core/sources.js';
import { modulesSignature } from '../core/modules.js';
import './gf-attribution.js';
import './gf-plant-spots.js';
import './gf-calendar.js';
import './gf-status.js';
import './gf-lookalikes.js';
import './gf-add-to.js';
import { ui } from '../styles/ui.js';
import { icon } from '../core/icons.js';
import {
  STYLES, SUBS, blockModuleName, blockOrder, blockStyle, blockTitle, isTitleShown, setBlockStyle, setTitleShown, createNote, deleteNote, isHidden, isNote, isSubHidden, noteText, renameBlock,
  setBlockOrder, setHidden, setNoteText, setSubHidden, setSubOrder, shownSubs, subOrder, subTitle
} from '../core/sheet-blocks.js';
import './gf-sortable-list.js';

/** Remote text is untrusted HTML: keep only its text content (DOMParser never runs scripts). */
function toText(/** @type {string} */ value) {
  const { body } = new DOMParser().parseFromString(String(value ?? ''), 'text/html');
  body.querySelectorAll('script, style, noscript').forEach(node => node.remove());
  return body.textContent?.replace(/\s+/g, ' ').trim() || '';
}

const truncate = (/** @type {string} */ text, max = 900) =>
  text.length > max ? text.slice(0, max).replace(/\s+\S*$/, '') + '…' : text;

const commonsKey = (/** @type {string | undefined} */ url) => {
  try { return decodeURIComponent(url || '').replace(/_/g, ' ').toLowerCase(); } catch { return url || ''; }
};

/**
 * Builds the gallery: the dataset thumbnail first, then free-licensed Commons images,
 * then the iNaturalist default photo; deduplicated by Commons page.
 */
function gallery(plant, details) {
  const images = [];
  const seen = new Set();
  const add = (/** @type {any} */ image) => {
    const key = commonsKey(image.sourceUrl || image.pageUrl || image.url);
    if (!image.url || seen.has(key)) return;
    seen.add(key);
    images.push(image);
  };

  if (plant.thumbnail?.url) add(plant.thumbnail);
  for (const image of details?.commons || []) {
    add({ ...image, url: image.thumbnail || image.url, source: 'Wikimedia Commons' });
  }
  const inat = details?.identifiers?.inaturalist;
  if (inat?.photo?.url) {
    add({
      url: inat.photo.url,
      attribution: inat.photo.attribution,
      license: inat.photo.license,
      source: 'iNaturalist',
      sourceUrl: 'https://www.inaturalist.org/taxa/' + inat.id
    });
  }
  return images;
}

/** GBIF descriptions, French first, then English; one per type. */
function descriptions(details) {
  const rows = details?.gbif?.descriptions?.results || [];
  const order = { fra: 0, fre: 0, fr: 0, eng: 1, en: 1 };
  const byType = new Map();
  rows
    .filter(row => row.description && row.language in order)
    .sort((a, b) => order[a.language] - order[b.language])
    .forEach(row => {
      const type = row.type || 'description';
      if (!byType.has(type)) byType.set(type, { ...row, text: truncate(toText(row.description)) });
    });
  return [...byType.values()].filter(row => row.text).slice(0, 4);
}

function distributions(details) {
  const rows = details?.gbif?.distributions?.results || [];
  const seen = new Set();
  return rows
    .map(row => ({
      place: row.locality || row.country || row.locationId,
      means: row.establishmentMeans
    }))
    .filter(row => row.place && !seen.has(row.place) && seen.add(row.place))
    .slice(0, 24);
}

function gbifFrenchNames(plant, details) {
  const known = new Set((plant.vernacularNames || []).map(name => name.toLowerCase()));
  const names = (details?.gbif?.vernacularNames?.results || [])
    .filter(row => /^(fra|fre|fr)$/.test(row.language || ''))
    .map(row => row.vernacularName)
    .filter(name => name && !known.has(name.toLowerCase()) && known.add(name.toLowerCase()));
  return names.slice(0, 12);
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Baseflor flowering months, and whether this month is one of them. @param {any} plant */
function flowering(plant) {
  const [first, last] = plant.flowering || [];
  if (!first || !last) return null;
  const month = new Date().getMonth() + 1;
  const now = first <= last ? month >= first && month <= last : month >= first || month <= last;
  return { text: first === last ? MONTHS[first - 1] : MONTHS[first - 1] + ' → ' + MONTHS[last - 1], now };
}

const STATUS_TYPES = {
  PN: 'Protection nationale',
  PR: 'Protection régionale',
  PD: 'Protection départementale',
  REGL: 'Réglementation (cueillette, commerce)',
  LRN: 'Liste rouge nationale',
  LRR: 'Liste rouge régionale'
};

/** GBIF species media: still images under a free licence, credited. */
function gbifMedia(details) {
  const free = (/** @type {string} */ l) => /creativecommons\.org\/(licenses\/by(-sa)?\/|publicdomain)|^cc0|^cc[ -]by/i.test(l || '');
  return (details?.gbif?.media?.results || [])
    .filter(m => m.identifier && (!m.type || m.type === 'StillImage') && free(m.license))
    .slice(0, 12)
    .map(m => ({
      url: m.identifier,
      author: m.creator || m.rightsHolder || '',
      license: /publicdomain|cc0/i.test(m.license) ? 'CC0 / domaine public' : /by-sa/i.test(m.license) ? 'CC BY-SA' : 'CC BY',
      licenseUrl: /^https?:/.test(m.license) ? m.license : '',
      source: 'GBIF',
      sourceUrl: m.references || (details?.identifiers?.gbif?.id ? 'https://www.gbif.org/species/' + details.identifiers.gbif.id : '')
    }));
}

/** Vernacular names in other languages (GBIF), grouped by language. */
function otherNames(details) {
  const byLang = new Map();
  for (const row of details?.gbif?.vernacularNames?.results || []) {
    const lang = row.language || '';
    if (!row.vernacularName || /^(fra|fre|fr)$/.test(lang)) continue;
    const list = byLang.get(lang) || [];
    if (!list.includes(row.vernacularName) && list.length < 4) list.push(row.vernacularName);
    byLang.set(lang, list);
  }
  return [...byLang].slice(0, 12);
}

/** Trefle species record (user's own token): its scalar facts, flattened. */
function trefleFacts(details) {
  const t = details?.trefle;
  if (!t) return [];
  const facts = [];
  const add = (/** @type {string} */ label, /** @type {any} */ value) => {
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return;
    if (typeof value === 'object' && !Array.isArray(value)) {
      if ('cm' in value || 'mm' in value) return add(label, value.cm != null ? value.cm + ' cm' : value.mm != null ? value.mm + ' mm' : null);
      for (const [k, v] of Object.entries(value)) add(label + ' · ' + k.replace(/_/g, ' '), v);
      return;
    }
    facts.push([label, Array.isArray(value) ? value.join(', ') : String(value)]);
  };
  add('common name', t.common_name);
  add('observations', t.observations);
  add('duration', t.duration);
  add('edible', t.edible);
  add('edible part', t.edible_part);
  add('vegetable', t.vegetable);
  for (const key of ['specifications', 'growth', 'flower', 'foliage', 'fruit_or_seed']) add(key.replace(/_/g, ' '), t[key]);
  return facts.slice(0, 60);
}

export class GfPlantDetail extends LitElement {
  static properties = {
    plantId: { type: Number, attribute: 'plant-id' },
    /** Shown in the Flore tab's plant pane: compact padding, the pane has its own close / back controls. */
    embedded: { type: Boolean, reflect: true },
    /** Épuré (photo and one-tap actions), standard (general public), scientific (every data). */
    view: { reflect: true },
    _wiki: { state: true },
    _science: { state: true },
    _occurrences: { state: true },
    _spotsOpen: { state: true },
    _plant: { state: true },
    _details: { state: true },
    _error: { state: true },
    _shareNote: { state: true },
    _dragKey: { state: true },
    _dragOrder: { state: true },
    _dragY: { state: true },
    _renaming: { state: true },
    _subsOpen: { state: true },
    _newNote: { state: true },
    _noteSaved: { state: true }
  };

  static styles = [ui, css`
    :host {
      display: block;
      overflow-y: auto;
      padding: 16px;
    }
    article { max-width: 920px; margin: 0 auto; }
    :host([embedded]) { padding: 4px 14px 24px; }
    :host([embedded]) .back { display: none; }
    :host([embedded]) h1 { margin-top: 4px; }
    .back { font-size: 0.9rem; }
    h1 { margin: 8px 0 0; font-size: 1.6rem; line-height: 1.2; }
    .sci { font-family: var(--gf-font-serif); font-size: 1.2rem; }
    .sci i { font-style: italic; }
    .author { color: var(--gf-text-muted); font-size: 0.9em; }
    .tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; padding: 0; list-style: none; }
    .tags li {
      background: var(--gf-accent-soft);
      border-radius: var(--gf-radius-pill);
      padding: 2px 10px;
      font-size: 0.8rem;
    }
    section { margin-top: 24px; }
    /* Blocks below the header: a title (drag it to move the block) with its grip and trash / revive icon, then the content. */
    .blocks { display: flex; flex-direction: column; }
    .block { margin-top: 20px; border-radius: var(--gf-radius); transition: box-shadow 0.15s, background 0.15s, opacity 0.15s; }
    .block-title { display: flex; align-items: center; gap: 2px; margin: 0 0 8px; }
    /* « Mode King »: the title is a handle. */
    .king .block-title { margin-left: -6px; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; }
    .block-title .name { flex: 1; min-width: 0; }
    .off-note { flex: none; font-size: 0.7rem; text-transform: none; letter-spacing: 0; font-weight: 400; }
    .grip, .block-title .tool {
      flex: none;
      width: 26px;
      height: 26px;
      min-height: 0;
      padding: 0;
      display: grid;
      place-items: center;
      border: 0;
      border-radius: var(--gf-radius-sm);
      background: none;
      color: var(--gf-text-muted);
      font-size: 0.95rem;
      opacity: 0.6;
    }
    .grip { cursor: grab; }
    .block-title .tool { cursor: pointer; }
    .grip:hover, .grip:focus-visible, .block-title .tool:hover, .block-title .tool:focus-visible { opacity: 1; background: var(--gf-surface-2); color: var(--gf-text); }
    .grip:focus-visible, .block-title .tool:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    /* The name and the actions read without a title (Mode King titles them, to move them like the others). */
    .block.headless { margin-top: 8px; }
    .block.headless:first-child { margin-top: 0; }
    .block[data-key='name'] h1 { margin-top: 4px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .names-list { margin: 0; }
    .block-title input.rename { flex: 1; min-width: 0; font: inherit; text-transform: none; letter-spacing: 0; padding: 2px 6px; border: 1px solid var(--gf-accent); border-radius: var(--gf-radius-sm); background: var(--gf-surface); color: var(--gf-text); }
    .block-title .tool[aria-expanded='true'], .block-title .tool[aria-pressed='true'] { opacity: 1; color: var(--gf-accent); }
    /* Mode King: a title hidden outside the mode reads faded and struck. */
    .block.untitled > .block-title .name { opacity: 0.55; text-decoration: line-through; }
    .block-title .styles { display: inline-flex; flex: none; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-pill); overflow: hidden; margin-right: 4px; }
    .block-title .styles button { min-height: 0; padding: 2px 8px; border: 0; border-radius: 0; background: var(--gf-surface); color: var(--gf-text-muted); font-size: 0.7rem; text-transform: none; letter-spacing: 0; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
    .block-title .styles button[aria-pressed='true'] { background: var(--gf-accent-soft); color: var(--gf-accent); }
    .block-title .styles button:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .subs-editor { margin: 0 0 10px 20px; padding: 8px 10px; border: 1px dashed var(--gf-border); border-radius: var(--gf-radius); background: var(--gf-surface); }
    .note-text { width: 100%; font: inherit; padding: 8px 10px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius); background: var(--gf-surface); color: var(--gf-text); resize: vertical; }
    .note-text:focus-visible { outline: none; border-color: var(--gf-accent); box-shadow: var(--gf-focus); }
    .new-note { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0 0; }
    .new-note input { flex: 1; min-width: 160px; }
    /* Folded away: the title only, faded; ↺ brings it back. */
    .block.off { opacity: 0.45; }
    .block.off .block-title { margin-bottom: 0; }
    .block.off:hover, .block.off:focus-within { opacity: 0.8; }
    /* While dragging: every block shows its title only; the dragged one floats under the pointer. */
    .blocks.sorting .content { display: none; }
    .blocks.sorting .block { margin-top: 6px; padding: 4px 8px; background: var(--gf-surface); border: 1px dashed var(--gf-border); }
    .blocks.sorting .block-title { margin: 0; }
    .block.dragging { position: relative; z-index: 2; opacity: 1; background: var(--gf-surface); box-shadow: var(--gf-shadow-float); outline: 2px solid var(--gf-accent); border-style: solid; transition: none; }
    .block.dragging .block-title, .block.dragging .grip { cursor: grabbing; }
    .block.dragging .grip { opacity: 1; color: var(--gf-accent); }
    /* A part with nothing for this plant hides itself; the block then says so. */
    .content .if-empty { display: none; }
    .content > [hidden]:not([loading]) ~ .if-empty { display: block; }
    @media (prefers-reduced-motion: reduce) { .block { transition: none; } }
    h2 {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--gf-text-muted);
      font-weight: 600;
      margin: 0 0 8px;
    }
    .gallery {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: var(--gf-gap);
    }
    figure {
      margin: 0;
      background: var(--gf-surface);
      border-radius: var(--gf-radius);
      overflow: hidden;
      box-shadow: var(--gf-shadow);
    }
    figure img {
      display: block;
      width: 100%;
      aspect-ratio: 1;
      object-fit: cover;
      background: var(--gf-surface-2);
    }
    figcaption { padding: 6px 8px; }
    p { margin: 0 0 12px; }
    .actions { margin: 12px 0 4px; }
    .actions .fav { min-height: var(--gf-control-h); padding: 8px 16px; font-size: 0.9rem; }
    .actions .fav[aria-pressed='true'] { color: var(--gf-fav); border-color: var(--gf-fav); background: color-mix(in srgb, var(--gf-fav) 10%, var(--gf-surface)); }
    .share-note { color: var(--gf-text-muted); font-size: 0.85rem; margin: 4px 0 0; }
    .description { background: var(--gf-surface); border-radius: var(--gf-radius); padding: 12px 14px; margin-bottom: 8px; }
    .description small { display: block; color: var(--gf-text-muted); margin-bottom: 4px; }
    ul.inline { padding: 0; margin: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 6px 14px; }
    .links a {
      display: inline-block;
      color: var(--gf-accent);
      border: 1px solid var(--gf-border);
      border-radius: var(--gf-radius-pill);
      padding: 4px 12px;
      text-decoration: none;
      background: var(--gf-surface);
    }
    .links a:hover { background: var(--gf-surface-2); }
    .skeleton {
      height: 180px;
      border-radius: var(--gf-radius);
      background: linear-gradient(90deg, var(--gf-surface-2), var(--gf-surface), var(--gf-surface-2));
      background-size: 200% 100%;
      animation: pulse 1.4s ease-in-out infinite;
    }
    @keyframes pulse { from { background-position: 100% 0; } to { background-position: -100% 0; } }

    /* Épuré: big photo, the essentials, one-tap add to the current collection. */
    .epure { max-width: 560px; }
    .hero { margin: 4px 0 12px; border-radius: var(--gf-radius-lg); overflow: hidden; background: var(--gf-surface-2); box-shadow: var(--gf-shadow); }
    .hero img, .hero .skeleton, .hero .no-photo { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; height: auto; border-radius: 0; }
    .hero .no-photo { display: grid; place-items: center; font-size: 3rem; }
    .hero figcaption { padding: 4px 10px; }
    .epure h1 { font-size: 1.8rem; }
    .meta { color: var(--gf-text-muted); margin: 6px 0 10px; }
    .season { background: var(--gf-season, var(--gf-accent-soft)); color: var(--gf-text); border-radius: var(--gf-radius-pill); padding: 1px 8px; font-size: 0.8rem; font-weight: 600; }
    .gate { display: grid; gap: 8px; margin: 16px 0 8px; }
    .gate .add { width: 100%; justify-content: center; }
    .gate .add[aria-pressed='true'] { background: var(--gf-accent-soft); color: var(--gf-accent); border: 2px solid var(--gf-accent); }
    .more { margin-top: 18px; }

    /* Standard: collections as one discreet line. */
    .mine { display: flex; align-items: center; gap: 10px; font-size: 0.9rem; color: var(--gf-text-muted); margin: 4px 0; }

    /* Scientifique: facts as label / value rows, tables, sources. */
    h3 { font-size: 0.85rem; margin: 14px 0 6px; }
    .facts { display: grid; grid-template-columns: minmax(120px, max-content) 1fr; gap: 6px 14px; margin: 0; font-size: 0.9rem; }
    .facts dt { color: var(--gf-text-muted); }
    .facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .facts .lang { font-size: 0.75rem; font-weight: 700; color: var(--gf-text-muted); text-transform: uppercase; }
    .statuses { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-top: 10px; }
    .statuses th, .statuses td { text-align: left; padding: 5px 8px 5px 0; border-bottom: 1px solid var(--gf-border); vertical-align: top; }
    .statuses th { color: var(--gf-text-muted); font-weight: 600; }
    .science p.muted { font-size: 0.9rem; }
    .credit { font-size: 0.75rem; color: var(--gf-text-muted); margin: 8px 0 0; }
    .credit a { color: inherit; }
    .wiki p.credit { margin-top: 6px; }
    @media (prefers-reduced-motion: reduce) { .skeleton { animation: none; } }
  `];

  constructor() {
    super();
    /** @type {number} */
    this.plantId = 0;
    /** @type {any} */
    this._plant = undefined;
    /** @type {any} */
    this._details = undefined;
    /** @type {string | null} */
    this._error = null;
    /** @type {string | null} */
    this._shareNote = null;
    this.view = 'standard';
    /** Block being dragged, and the order shown meanwhile (else the saved one). @type {string | null} */
    this._dragKey = null;
    /** @type {string[] | null} */
    this._dragOrder = null;
    this._dragY = 0;
    /** King mode: the block being renamed, the blocks showing their sub-blocks list, naming a new note block. @type {string | null} */
    this._renaming = null;
    /** @type {Set<string>} */
    this._subsOpen = new Set();
    this._newNote = false;
    /** Note block whose text was just saved. @type {string | null} */
    this._noteSaved = null;
    /** @type {any} */ this._wiki = undefined;
    /** @type {any} */ this._science = undefined;
    /** @type {number | null | undefined} */ this._occurrences = undefined;
    this._spotsOpen = false;
  }

  /** @type {AbortController | null} */
  #abort = null;
  /** Modules off and folded blocks at the last update, to reload what they change. @type {string | null} */
  #signature = null;
  /** @type {any} */
  #hidden = null;
  /** Extras already requested for the current plant. */
  #requested = new Set();

  /** @param {Map<string, any>} changed */
  willUpdate(changed) {
    if (!this.#store.state.kingMode && this.#drag) this.#dragEnd();
    const signature = modulesSignature(this.view);
    const hidden = this.#store.state.sheetLayout;
    const modulesChanged = this.#signature !== null && !changed.has('view') && signature !== this.#signature;
    const hiddenChanged = hidden !== this.#hidden;
    this.#signature = signature;
    this.#hidden = hidden;
    if (changed.has('plantId')) this.#load(this.plantId);
    // A module switched on or off (a block folded or revived, or Réglages): its data comes or goes.
    else if (modulesChanged) this.#refresh();
    else if (hiddenChanged && this._plant && this._details !== undefined) this.#loadExtras(this._plant, this._details, this.#abort?.signal);
    // Another view may use other modules (Réglages › Modules): reload what depends on them.
    else if (changed.has('view') && changed.get('view') !== undefined && modulesSignature(this.view) !== modulesSignature(changed.get('view'))) this.#load(this.plantId);
    else if (changed.has('view') && this._plant && this._details !== undefined) this.#loadExtras(this._plant, this._details, this.#abort?.signal);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abort?.abort();
  }

  /** @param {number} id */
  async #load(id) {
    this.#abort?.abort();
    const abort = this.#abort = new AbortController();
    this._plant = undefined;
    this._details = undefined;
    this._error = null;
    this._wiki = undefined;
    this._science = undefined;
    this._occurrences = undefined;
    this._spotsOpen = false;
    this.#requested.clear();
    this.scrollTop = 0;

    let plant;
    try {
      await whenReady();
      if (abort.signal.aborted) return;
      plant = await db.get('plants', id);
    } catch (error) {
      console.error(error);
      if (!abort.signal.aborted) this._plant = { failed: /** @type {Error} */ (error).message };
      return;
    }
    if (abort.signal.aborted) return;
    this._plant = plant || null;
    if (!plant) return;
    document.title = (plant.vernacularNames?.[0] || plant.scientificName) + ' — GeoFlora';

    try {
      const details = await sources.details(plant, abort.signal, this.view);
      if (!abort.signal.aborted) this._details = details;
      if (!abort.signal.aborted) this.#loadExtras(plant, details, abort.signal);
    } catch (error) {
      if (!abort.signal.aborted) {
        this._details = null;
        this.#loadExtras(plant, null, abort.signal);
        this._error = navigator.onLine
          ? 'Les sources distantes ne répondent pas pour le moment.'
          : 'Hors ligne : les données distantes ne sont pas disponibles.';
      }
    }
  }

  /** Modules changed: fetch the plant's data again, in place (the sheet keeps its scroll). */
  async #refresh() {
    const plant = this._plant;
    if (!plant?.id) return;
    this.#abort?.abort();
    const abort = this.#abort = new AbortController();
    this.#requested.clear();
    this._wiki = undefined;
    this._science = undefined;
    this._occurrences = undefined;
    const details = await sources.details(plant, abort.signal, this.view).catch(() => null);
    if (abort.signal.aborted) return;
    this._details = details;
    this.#loadExtras(plant, details, abort.signal);
  }

  /**
   * What the shown blocks need beyond the details, in every view: the Wikipedia summary, the Wikidata
   * classification, IUCN status and identifiers, the GBIF count in France. A folded block fetches nothing;
   * each loads once per plant.
   * @param {any} plant @param {any} details @param {AbortSignal} [signal]
   */
  #loadExtras(plant, details, signal) {
    const v = this.view;
    const shown = (/** @type {string} */ key) => !isHidden(v, key);
    const qid = plant.identifiers?.wikidata || details?.identifiers?.wikidata?.id;
    const settle = (/** @type {Promise<any>} */ task, /** @type {(v: any) => void} */ set) =>
      task.then(v => { if (!signal?.aborted && this._plant === plant) set(v ?? null); })
        .catch(() => { if (!signal?.aborted && this._plant === plant) set(null); });
    const once = (/** @type {string} */ key) => !this.#requested.has(key) && Boolean(this.#requested.add(key));
    if (shown('wikipedia') && once('wiki')) settle(sources.wikipedia(plant, qid, signal, v), x => { this._wiki = x; });
    const science = shown('ids') || (v === 'scientific' && (shown('taxonomy') || shown('status')));
    if (science && once('science')) settle(sources.wikidataScience(plant, qid, signal, v), x => { this._science = x; });
    const gbif = details?.identifiers?.gbif;
    if (shown('occurrences') && once('occurrences')) settle(sources.occurrencesFR(plant, gbif?.nubKey ?? gbif?.id, signal, v), x => { this._occurrences = x; });
  }

  #store = new StoreController(this);

  /**
   * The parts of a block this view shows, in the order chosen for it (Mode King › Sous-blocs). `parts`: sub-block
   * key → its markup, or nothing when this view or this plant has none.
   * @param {string} block @param {Record<string, () => unknown>} parts
   */
  #subs(block, parts) {
    return shownSubs(this.view, block).map(k => parts[k]?.() ?? nothing).filter(x => x !== nothing);
  }

  /** @param {any} plant */
  #actions(plant) {
    const fav = this.#store.state.favorites.has(plant.id);
    const name = plant.vernacularNames?.[0] || plant.scientificName;
    const buttons = this.#subs('actions', {
      fav: () => html`<button type="button" class="fav" aria-pressed=${fav ? 'true' : 'false'} @click=${() => toggleFavorite(plant)}>
        ${icon(fav ? 'heart-fill' : 'heart')} Favori</button>`,
      addTo: () => html`<button type="button" @click=${() => /** @type {any} */ (this.renderRoot.querySelector('gf-add-to'))?.open()}>${icon('plus-lg')} Ajouter à…</button>`,
      share: () => html`<button type="button" @click=${() => this.#share(plant, name)}>${icon('share')} Partager</button>`,
      spot: () => html`<a class="button" href=${href.newSpot(plant.id)}>${icon('geo-alt-fill')} Noter ici</a>`
    });
    return html`
      <div class="actions" role="group" aria-label="Actions">${buttons}</div>
      ${this._shareNote ? html`<p class="share-note" role="status">${this._shareNote}</p>` : nothing}`;
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
        <a class="back link" href=${lastSearchHash()}>${icon('arrow-left')} Recherche</a>
        <h1>Impossible de lire la flore locale</h1>
        <p class="muted">${plant.failed}</p>
        <p><button class="primary" type="button" @click=${() => this.#load(this.plantId)}>Réessayer</button></p>
      </article>`;
    }
    if (plant === null) {
      return html`<article><a class="back link" href=${lastSearchHash()}>${icon('arrow-left')} Recherche</a><h1>Plante introuvable</h1></article>`;
    }

    const ctx = this.#context(plant);
    return this.view === 'epure' ? this.#epure(ctx) : this.#full(ctx);
  }

  /** Everything the views share, computed once per render. @param {any} plant */
  #context(plant) {
    const details = this._details;
    const inat = details?.identifiers?.inaturalist;
    return {
      plant,
      details,
      loading: details === undefined,
      name: plant.vernacularNames?.[0] || plant.scientificName,
      // Photos en ligne switched off (Réglages › Modules): no remote image anywhere on the sheet.
      photosOff: !this.#store.state.modules.photos[this.view],
      images: this.#store.state.modules.photos[this.view] ? gallery(plant, details) : [],
      inat,
      wikidata: plant.identifiers?.wikidata || details?.identifiers?.wikidata?.id,
      links: sources.links(plant),
      status: plant.status?.france,
      bloom: flowering(plant)
    };
  }

  /** The « Nom » block: French and scientific names (Épuré: family and flowering too). @param {any} ctx */
  #name({ plant, name, bloom }) {
    return html`
      <h1>${name}</h1>
      <div class="sci"><i>${plant.scientificName}</i> <span class="author">${plant.author}</span></div>
      ${this.view === 'epure' ? html`<p class="meta">${plant.family}${bloom ? html` · Floraison ${bloom.text}${bloom.now ? html` <span class="season">en fleur</span>` : nothing}` : nothing}</p>` : nothing}`;
  }

  /** @param {any} ctx */
  #tags({ plant, status, inat }) {
    return html`<ul class="tags">${this.#subs('taxonomy', {
      ranks: () => html`<li>${plant.family}</li><li>Genre <i>${plant.genus}</i></li>`,
      author: () => plant.author ? html`<li>${plant.author}</li>` : nothing,
      france: () => status ? html`<li title="Statut TAXREF ${status}">${STATUS_LABELS[status] || status}</li>` : nothing,
      synonyms: () => plant.synonyms?.length ? html`<li>${plant.synonyms.length} synonyme${plant.synonyms.length > 1 ? 's' : ''}</li>` : nothing,
      inat: () => inat?.observationsCount ? html`<li>${inat.observationsCount.toLocaleString('fr-FR')} observations iNaturalist</li>` : nothing
    })}</ul>`;
  }

  /** Photos of the plant (licensed), or why there are none. @param {any} ctx @param {number} [max] */
  #gallery({ plant, images, loading, photosOff }, max = Infinity) {
    const shown = images.slice(0, max);
    return photosOff ? html`<p class="muted">Photos en ligne désactivées (<a href=${href.settings()}>Réglages › Modules</a>).</p>` : shown.length ? html`
      <div class="gallery">
        ${shown.map(image => html`
          <figure>
            <a href=${image.sourceUrl || image.pageUrl || image.url} target="_blank" rel="noopener">
              <img src=${image.url} alt=${plant.scientificName} loading="lazy" decoding="async" referrerpolicy="no-referrer" />
            </a>
            <figcaption><gf-attribution .media=${image}></gf-attribution></figcaption>
          </figure>`)}
      </div>` : loading ? html`<div class="skeleton"></div>` : html`<p class="muted">Aucune photo sous licence libre trouvée.</p>`;
  }

  #wikipedia() {
    const wiki = this._wiki;
    if (!wiki) return nothing;
    return html`<div class="description wiki">
      ${wiki.extract}
      <p class="credit">Source : <a href=${wiki.url} target="_blank" rel="noopener">article Wikipédia</a> · texte sous licence CC BY-SA 4.0</p>
    </div>`;
  }

  /** @param {any} ctx */
  #resources({ details, inat, wikidata, links }) {
    const link = (/** @type {string} */ url, /** @type {string} */ label) => url ? html`<li><a href=${url} target="_blank" rel="noopener">${label}</a></li>` : nothing;
    return html`<ul class="inline links">${this.#subs('resources', {
      inpn: () => link(links.inpn, 'INPN'),
      taxref: () => link(links.taxref, 'TAXREF'),
      gbif: () => link(details?.identifiers?.gbif?.id ? 'https://www.gbif.org/species/' + details.identifiers.gbif.id : links.gbif, 'GBIF'),
      inaturalist: () => link(inat?.id ? 'https://www.inaturalist.org/taxa/' + inat.id : links.inaturalist, 'iNaturalist'),
      wikidata: () => link(wikidata ? 'https://www.wikidata.org/wiki/' + wikidata : links.wikidata, 'Wikidata'),
      commons: () => link(links.wikimedia, 'Wikimedia Commons'),
      wikipedia: () => link(this._wiki?.url || inat?.wikipediaUrl, 'Wikipédia')
    })}</ul>`;
  }

  // ── Blocks: below the header, titled, the same in every view, in the order chosen for it ────────────────
  // Drag a block by its title (or ↑ ↓ on its grip); fold it away with its trash icon, bring it back with ↺.

  /** @param {any} ctx */
  #blocks(ctx) {
    const king = this.#store.state.kingMode;
    const order = this._dragOrder || blockOrder(this.view);
    const sorting = Boolean(this._dragOrder);
    // Outside « Mode King », folded blocks are not there at all.
    const keys = blockOrder(this.view).filter(k => king || !isHidden(this.view, k));
    return html`<div class="blocks ${king ? 'king' : ''} ${sorting ? 'sorting' : ''}">${repeat(keys, k => k, k =>
      king ? this.#block(k, ctx, sorting ? order.indexOf(k) : null) : this.#plainBlock(k, ctx))}</div>
      ${king && !sorting ? this.#newNote() : nothing}`;
  }

  /** A block read without its title (Mode King › title on/off, per view). @param {string} key */
  #headless = key => !isTitleShown(this.view, key);

  /** A block as read outside « Mode King »: its title, its content. @param {string} key @param {any} ctx */
  #plainBlock(key, ctx) {
    return html`<section class="block ${this.#headless(key) ? 'headless' : ''}" data-key=${key}>
      ${this.#headless(key) ? nothing : html`<h2 class="block-title"><span class="name">${blockTitle(key)}</span></h2>`}
      <div class="content">${this.#content(key, ctx)}</div>
    </section>`;
  }

  /** @param {string} key @param {any} ctx @param {number | null} slot  place shown while dragging (CSS order: the nodes do not move) */
  #block(key, ctx, slot) {
    const title = blockTitle(key);
    const off = isHidden(this.view, key);
    const module = blockModuleName(key);
    const dragging = this._dragKey === key;
    const subsOpen = this._subsOpen.has(key);
    const style = slot === null ? '' : `order:${slot}${dragging ? `;transform:translateY(${this._dragY}px)` : ''}`;
    const titled = isTitleShown(this.view, key);
    return html`<section class="block ${off ? 'off' : ''} ${dragging ? 'dragging' : ''} ${titled ? '' : 'untitled'}" data-key=${key} style=${style}>
      <h2 class="block-title" title="Glisser pour déplacer" @pointerdown=${e => this.#press(e, key)}>
        <button class="grip" type="button" aria-label="Déplacer le bloc « ${title} »" title="Glisser pour déplacer (↑ ↓ au clavier)"
          @keydown=${e => this.#gripKey(e, key)}>${icon('grip-vertical')}</button>
        ${this._renaming === key
          ? html`<input class="rename" aria-label="Nouveau nom du bloc « ${title} »" .value=${title} maxlength="60"
              @keydown=${e => { if (e.key === 'Enter') this.#rename(key, e.target.value); else if (e.key === 'Escape') this._renaming = null; }}
              @blur=${e => this.#rename(key, e.target.value)} />`
          : html`<span class="name">${title}</span>`}
        ${off && module ? html`<small class="off-note">module ${module} désactivé dans ce mode</small>` : nothing}
        <button class="tool" type="button" aria-pressed=${titled ? 'true' : 'false'} aria-label=${(titled ? 'Masquer' : 'Montrer') + ` le titre « ${title} » hors mode King`}
          title=${titled ? 'Titre affiché (toucher pour le cacher)' : 'Titre caché hors mode King (toucher pour l’afficher)'}
          @click=${() => setTitleShown(this.view, key, !titled)}>${icon('type-h2')}</button>
        ${this._renaming === key ? nothing : html`<button class="tool" type="button" aria-label="Renommer le bloc « ${title} »" title=${isNote(key) ? 'Renommer' : 'Renommer (vide : nom d’origine)'}
          @click=${() => this.#startRename(key)}>${icon('pencil')}</button>`}
        ${STYLES[key] && !off ? html`<span class="styles" role="group" aria-label="Style du bloc « ${title} »">${STYLES[key].styles.map(st => html`
          <button type="button" aria-pressed=${blockStyle(this.view, key) === st.key ? 'true' : 'false'} title=${'Style : ' + st.title}
            @click=${() => setBlockStyle(this.view, key, st.key)}>${icon(st.key === 'list' ? 'list-ul' : 'table')} ${st.title}</button>`)}</span>` : nothing}
        ${SUBS[key] && !off ? html`<button class="tool" type="button" aria-expanded=${subsOpen ? 'true' : 'false'} aria-label="Sous-blocs de « ${title} »" title="Sous-blocs : ordre et présence"
          @click=${() => { const open = new Set(this._subsOpen); if (subsOpen) open.delete(key); else open.add(key); this._subsOpen = open; }}>${icon('list-nested')}</button>` : nothing}
        ${off
          ? html`<button class="tool" type="button" aria-label="Réafficher le bloc « ${title} »" title="Réafficher"
              @click=${() => setHidden(this.view, key, false)}>${icon('arrow-counterclockwise')}</button>`
          : html`<button class="tool" type="button" aria-label="Masquer le bloc « ${title} »" title=${module ? `Masquer (coupe le module ${module} dans ce mode)` : 'Masquer'}
              @click=${() => setHidden(this.view, key, true)}>${icon('trash3')}</button>`}
        ${isNote(key) ? html`<button class="tool" type="button" aria-label="Supprimer le bloc « ${title} »" title="Supprimer le bloc et ses textes"
          @click=${() => { if (confirm(`Supprimer le bloc « ${title} » et tout ce qui y est écrit ?`)) deleteNote(key); }}>${icon('x-lg')}</button>` : nothing}
      </h2>
      ${subsOpen && !off ? html`<div class="subs-editor">
        <gf-sortable-list label=${'Sous-blocs de ' + title}
          .items=${subOrder(this.view, key).map(k => ({ key: k, label: subTitle(key, k), checked: !isSubHidden(this.view, key, k) }))}
          @reorder=${e => setSubOrder(this.view, key, e.detail.keys)}
          @toggle=${e => setSubHidden(this.view, key, e.detail.key, !e.detail.on)}></gf-sortable-list>
      </div>` : nothing}
      ${off ? nothing : html`<div class="content">${this.#content(key, ctx)}</div>`}
    </section>`;
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

  /** King mode, after the blocks: a new « Note » block. */
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
        }}>${icon('plus-lg')} Bloc Note</button></p>`;
  }

  /** @type {number | undefined} */
  #noteTimer;

  /** A note block: free text for this plant, saved as it is typed. @param {string} key @param {any} plant */
  #note(key, plant) {
    return html`<textarea class="note-text" rows="3" aria-label=${blockTitle(key)} placeholder="Votre note sur cette plante"
      .value=${noteText(key, plant.id)}
      @input=${e => {
        const text = e.target.value;
        clearTimeout(this.#noteTimer);
        this.#noteTimer = setTimeout(() => { setNoteText(key, plant.id, text); this._noteSaved = key; setTimeout(() => { if (this._noteSaved === key) this._noteSaved = null; }, 1500); }, 400);
      }}></textarea>
      <p class="credit" aria-live="polite">${this._noteSaved === key ? 'Enregistré sur cet appareil.' : 'Note personnelle, gardée sur cet appareil.'}</p>`;
  }

  /** A block's content, as this view shows it. @param {string} key @param {any} ctx */
  #content(key, ctx) {
    const v = this.view;
    const { plant, details, loading } = ctx;
    const pending = html`<p class="muted">chargement…</p>`;
    const empty = (/** @type {string} */ text) => html`<p class="muted">${text}</p>`;
    // After a part that hides itself when it has nothing for this plant.
    const ifEmpty = (/** @type {string} */ text) => html`<p class="muted if-empty">${text}</p>`;
    if (isNote(key)) return this.#note(key, plant);
    switch (key) {
      case 'name': return this.#name(ctx);
      case 'actions': return this.#actions(plant);
      case 'photos': {
        if (v !== 'epure') return this.#gallery(ctx, v === 'standard' ? 6 : Infinity);
        const hero = ctx.images[0];
        return html`<figure class="hero">
          ${hero ? html`<img src=${hero.url} alt=${plant.scientificName} decoding="async" referrerpolicy="no-referrer" />
            <figcaption><gf-attribution .media=${hero}></gf-attribution></figcaption>`
            : html`<div class=${loading ? 'skeleton' : 'no-photo'} aria-hidden="true">${loading ? '' : icon('flower1')}</div>`}
        </figure>`;
      }
      case 'status':
        return v === 'scientific' ? this.#statuses(ctx)
          : html`<gf-status .plant=${plant}></gf-status>${ifEmpty('Aucune protection, réglementation ni liste rouge connue (INPN).')}`;
      case 'lookalikes':
        return html`<gf-lookalikes .plant=${plant} ?compact=${v === 'epure'} ?detailed=${v === 'scientific'}></gf-lookalikes>
          ${ifEmpty('Aucune confusion signalée par l’Anses et les Centres antipoison.')}`;
      case 'collect': return this.#collect(ctx);
      case 'taxonomy': return v === 'scientific' ? this.#taxonomy(ctx) : this.#tags(ctx);
      case 'mine': {
        if (v === 'scientific') return html`<gf-plant-spots plant-id=${plant.id} notitle></gf-plant-spots>`;
        const count = (getMembership().byPlant.get(plant.id) || []).length;
        return html`
          <div class="mine">
            <span>${count ? `Dans ${count} de mes collections` : 'Dans aucune de mes collections'}</span>
            <button class="link" type="button" aria-expanded=${this._spotsOpen ? 'true' : 'false'}
              @click=${() => { this._spotsOpen = !this._spotsOpen; }}>${this._spotsOpen ? 'Masquer' : count ? 'Voir' : 'Lieux'}</button>
          </div>
          ${this._spotsOpen ? html`<gf-plant-spots plant-id=${plant.id} notitle></gf-plant-spots>` : nothing}`;
      }
      case 'calendar':
        return html`<gf-calendar .plant=${plant} mode=${v} notitle></gf-calendar>${ifEmpty('Aucune période de floraison ni d’observation connue.')}`;
      case 'wikipedia':
        return this._wiki ? this.#wikipedia() : this._wiki === undefined ? pending : empty('Pas d’article Wikipédia en français trouvé.');
      case 'descriptions': {
        const texts = descriptions(details).filter(row => v === 'scientific' || /^(fra|fre|fr)$/.test(row.language || ''));
        return texts.length
          ? texts.map(row => html`<div class="description"><small>${row.type || 'Description'}${row.source ? ' — ' + row.source : ''} · ${row.language} · GBIF</small>${row.text}</div>`)
          : loading ? pending : empty(v === 'scientific' ? 'Aucune description sur GBIF.' : 'Aucune description en français sur GBIF.');
      }
      case 'names': {
        const names = [...(plant.vernacularNames || []), ...gbifFrenchNames(plant, details)];
        const foreign = v === 'scientific' ? otherNames(details) : [];
        if (!names.length && !foreign.length) return loading ? pending : empty('Aucun nom français connu.');
        // « Liste » (Épuré's default): just the French names.
        if (blockStyle(v, 'names') === 'list') return shownSubs(v, 'names').includes('french') && names.length ? html`<p class="names-list">${names.join(' · ')}</p>` : nothing;
        return html`<dl class="facts">${this.#subs('names', {
          french: () => html`<dt>Noms français</dt><dd>${names.join(' · ') || '—'}${ctx.inat?.commonName ? html` <span class="muted">(iNaturalist : ${ctx.inat.commonName})</span>` : nothing}</dd>`,
          foreign: () => foreign.length ? html`<dt>Autres langues (GBIF)</dt><dd>${foreign.map(([lang, list]) => html`<span class="lang">${lang || '?'}</span> ${list.join(', ')} `)}</dd>` : nothing
        })}</dl>
        <p class="credit">Sources : TAXREF v18 · GBIF${ctx.inat?.commonName ? ' · iNaturalist' : ''}.</p>`;
      }
      case 'occurrences': return this.#occurrences(ctx);
      case 'gbifMedia': {
        const media = ctx.photosOff ? [] : gbifMedia(details);
        return media.length ? html`<div class="gallery">${media.map(image => html`<figure>
          <a href=${image.sourceUrl || image.url} target="_blank" rel="noopener"><img src=${image.url} alt=${plant.scientificName} loading="lazy" decoding="async" referrerpolicy="no-referrer" /></a>
          <figcaption><gf-attribution .media=${image}></gf-attribution></figcaption></figure>`)}</div>`
          : loading ? pending : empty(ctx.photosOff ? 'Photos en ligne désactivées dans ce mode.' : 'Aucun média sur GBIF.');
      }
      case 'trefle': {
        const facts = trefleFacts(details);
        if (facts.length) return html`<dl class="facts">${facts.map(([k, val]) => html`<dt>${k}</dt><dd>${val}</dd>`)}</dl>
          <p class="credit">Source : Trefle (données en anglais, avec votre jeton).</p>`;
        if (!sources.getTrefleToken()) return html`<p class="muted">Ajoutez votre jeton Trefle dans <a href=${href.settings()}>Réglages › Modules</a>.</p>`;
        return loading ? pending : empty('Aucune donnée Trefle pour cette plante.');
      }
      case 'ids': return this.#ids(ctx);
      case 'resources': return this.#resources(ctx);
      default: return nothing;
    }
  }

  /** @param {any} ctx */
  #taxonomy({ plant, wikidata, status, inat }) {
    const sci = this._science;
    const chain = [...(sci?.classification || [])].reverse();
    return html`
      <dl class="facts">${this.#subs('taxonomy', {
        chain: () => html`<dt>Classification</dt>
          <dd>${chain.length ? html`${chain.map(t => html`<span class="rank"><i>${t.name || t.label}</i></span> › `)}<i>${plant.scientificName}</i>`
            : sci === undefined && wikidata ? html`<span class="muted">chargement…</span>` : html`${plant.family} › <i>${plant.genus}</i> › <i>${plant.scientificName}</i>`}</dd>`,
        ranks: () => html`<dt>Famille · genre · espèce</dt><dd>${plant.family} · <i>${plant.genus}</i> · <i>${plant.species}</i></dd>`,
        author: () => html`<dt>Auteur</dt><dd>${plant.author || '—'}</dd>`,
        france: () => html`<dt>Statut en France</dt><dd>${status ? `${STATUS_LABELS[status] || status} (TAXREF ${status})` : '—'}</dd>`,
        synonyms: () => plant.synonyms?.length ? html`<dt>Synonymes (${plant.synonyms.length})</dt><dd class="sci-list"><i>${plant.synonyms.join(' · ')}</i></dd>` : nothing,
        inat: () => inat?.observationsCount != null ? html`<dt>Observations iNaturalist</dt><dd>${inat.observationsCount.toLocaleString('fr-FR')}</dd>` : nothing
      })}</dl>
      <p class="credit">Sources : TAXREF v18 (PatriNat) · Wikidata (classification)${inat?.observationsCount != null ? ' · iNaturalist' : ''}.</p>`;
  }

  /** @param {any} ctx */
  #statuses({ plant, wikidata }) {
    const sci = this._science;
    const statuses = [...(plant.statuses || [])].sort((a, b) =>
      Object.keys(STATUS_TYPES).indexOf(a.type) - Object.keys(STATUS_TYPES).indexOf(b.type) || String(a.area).localeCompare(String(b.area), 'fr'));
    return html`
      ${this.#subs('status', {
        iucn: () => html`<dl class="facts">
          <dt>UICN (monde)</dt><dd>${sci?.iucn ? sci.iucn.label || sci.iucn.id : sci === undefined && wikidata ? html`<span class="muted">chargement…</span>` : '—'}</dd>
        </dl>`,
        table: () => statuses.length ? html`<table class="statuses">
          <thead><tr><th>Type</th><th>Territoire</th><th>Statut</th></tr></thead>
          <tbody>${statuses.map(st => html`<tr><td>${STATUS_TYPES[st.type] || st.type}</td><td>${st.area}${st.level ? html` <span class="muted">(${st.level})</span>` : nothing}</td><td>${st.code && st.code !== st.label ? html`<b>${st.code}</b> ` : nothing}${st.label}</td></tr>`)}</tbody>
        </table>` : html`<p class="muted">Aucune protection, réglementation ni liste rouge connue (INPN).</p>`
      })}
      <p class="credit">Sources : INPN – Base de connaissance Statuts (PatriNat) · Wikidata (UICN).</p>`;
  }

  /** @param {any} ctx */
  #occurrences({ details, inat }) {
    const gbif = details?.identifiers?.gbif;
    const places = distributions(details);
    const pending = html`<span class="muted">chargement…</span>`;
    return html`${this.#subs('occurrences', {
      inat: () => html`<dl class="facts"><dt>Observations iNaturalist</dt><dd>${inat?.observationsCount != null ? inat.observationsCount.toLocaleString('fr-FR') : details === undefined ? pending : '—'}</dd></dl>`,
      gbif: () => html`<dl class="facts"><dt>Occurrences GBIF en France</dt><dd>${this._occurrences != null ? html`<a href=${'https://www.gbif.org/occurrence/search?country=FR&taxon_key=' + (gbif?.nubKey ?? gbif?.id)} target="_blank" rel="noopener">${this._occurrences.toLocaleString('fr-FR')}</a>` : (this._occurrences === undefined && gbif) || details === undefined ? pending : '—'}</dd></dl>`,
      distribution: () => places.length ? html`<h3>Répartition (GBIF)</h3>
        <ul class="inline">${places.map(row => html`<li>${row.place}${row.means ? html` <span class="muted">(${row.means.toLowerCase()})</span>` : nothing}</li>`)}</ul>` : nothing
    })}`;
  }

  /** @param {any} ctx */
  #ids({ plant, details, inat, wikidata }) {
    const claims = this._science?.claims;
    const gbif = details?.identifiers?.gbif;
    /** @type {Record<string, [string, unknown, string | null | undefined]>} */
    const all = {
      taxref: ['TAXREF (cd_nom)', plant.id, plant.links?.taxref],
      inpn: ['INPN', plant.id, plant.links?.inpn],
      gbif: ['GBIF', gbif?.id, gbif?.id ? 'https://www.gbif.org/species/' + gbif.id : null],
      inaturalist: ['iNaturalist', inat?.id, inat?.id ? 'https://www.inaturalist.org/taxa/' + inat.id : null],
      wikidata: ['Wikidata', wikidata, wikidata ? 'https://www.wikidata.org/wiki/' + wikidata : null],
      tela: ['Tela Botanica', claims?.tela, claims?.tela ? 'https://www.tela-botanica.org/bdtfx-nn-' + claims.tela : null],
      ipni: ['IPNI', claims?.ipni, claims?.ipni ? 'https://www.ipni.org/n/' + claims.ipni : null],
      powo: ['POWO', claims?.powo, claims?.powo ? 'https://powo.science.kew.org/taxon/' + claims.powo : null],
      trefle: ['Trefle', details?.identifiers?.trefle?.id, details?.identifiers?.trefle?.slug ? 'https://trefle.io/species/' + details.identifiers.trefle.slug : null]
    };
    const ids = shownSubs(this.view, 'ids').map(k => all[k]).filter(row => row?.[1]);
    return html`<dl class="facts ids">${ids.map(([label, id, url]) => html`<dt>${label}</dt><dd>${url ? html`<a href=${url} target="_blank" rel="noopener">${id}</a>` : id}</dd>`)}</dl>`;
  }

  /** One tap to put the plant in the current collection, which to choose, and (Épuré) more about it. @param {any} ctx */
  #collect({ plant }) {
    const { collections, target } = this.#store.state;
    const choices = collections.filter(c => c.kind !== 'favorites');
    const current = choices.find(c => c.id === target) || null;
    const inTarget = current ? (getMembership().byPlant.get(plant.id) || []).includes(current.id) : false;
    const places = choices.filter(c => c.kind === 'place');
    const lists = choices.filter(c => c.kind !== 'place');
    const parts = this.#subs('collect', {
      add: () => current ? html`
        <button class="primary large add" type="button" aria-pressed=${inTarget ? 'true' : 'false'}
          @click=${() => setInCollection(current.id, plant, !inTarget).then(() => setTarget(current.id)).catch(console.error)}>
          ${icon(inTarget ? 'check-lg' : 'plus-lg')} ${inTarget ? 'Dans ' : 'Ajouter à '}${current.kind === 'place' ? html`${icon('geo-alt-fill')} ` : ''}${current.name}
        </button>` : nothing,
      choose: () => html`
        <select class="target" aria-label="Collection en cours" .value=${current?.id || ''}
          @change=${e => this.#pickTarget(e.target)}>
          <option value="" ?selected=${!current} disabled>${current ? 'Changer…' : 'Choisir où ajouter…'}</option>
          ${places.length ? html`<optgroup label="Mes lieux">${places.map(c => html`<option value=${c.id} ?selected=${c.id === current?.id}>${c.name}</option>`)}</optgroup>` : nothing}
          ${lists.length ? html`<optgroup label="Mes collections">${lists.map(c => html`<option value=${c.id} ?selected=${c.id === current?.id}>${c.name}</option>`)}</optgroup>` : nothing}
          <option value="__new">Nouvelle collection…</option>
        </select>`,
      more: () => this.view === 'epure'
        ? html`<p class="more"><button class="link" type="button" @click=${() => setPlantView('standard')}>Plus d’infos ${icon('arrow-right')}</button></p>` : nothing
    });
    return html`<div class="gate" role="group" aria-label="Ajouter à la collection en cours">${parts}</div>`;
  }

  /** @param {HTMLSelectElement} select */
  #pickTarget(select) {
    const value = select.value;
    if (value === '__new') {
      select.value = this.#store.state.target || '';
      /** @type {any} */ (this.renderRoot.querySelector('gf-add-to'))?.open();
      return;
    }
    if (value) setTarget(value);
  }

  /** @param {string} key @param {-1 | 1} delta @param {string[]} order */
  #moved(key, delta, order) {
    const i = order.indexOf(key), j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return null;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  }

  /** ↑ ↓ on a focused grip: one place up or down, saved; the grip keeps the focus. @param {KeyboardEvent} e @param {string} key */
  async #gripKey(e, key) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const order = this.#moved(key, e.key === 'ArrowUp' ? -1 : 1, blockOrder(this.view));
    if (!order) return;
    setBlockOrder(this.view, order);
    await this.updateComplete;
    /** @type {HTMLElement | null} */ (this.renderRoot.querySelector(`.block[data-key="${key}"] .grip`))?.focus();
  }

  /**
   * Dragging a title: past a few pixels every block folds to its title (the list gets short, each move shows),
   * the dragged one follows the pointer and takes a neighbour's place past its middle. The blocks only change
   * their CSS order meanwhile, so the node holding the pointer stays put; the order is saved on release.
   * @type {{ key: string, view: any, y0: number, started: boolean, scroller: Element | null } | null}
   */
  #drag = null;

  /** The element that scrolls the sheet (the pane, the phone sheet or the page). */
  #scroller() {
    /** @type {any} */ let el = this;
    while (el) {
      if (el instanceof Element && /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight) return el;
      el = el.parentNode || el.host;
    }
    return document.scrollingElement;
  }

  /** @param {PointerEvent} e @param {string} key */
  #press(e, key) {
    if (e.button !== 0 || /** @type {Element} */ (e.target).closest('button:not(.grip)')) return;
    this.#drag = { key, view: this.view, y0: e.clientY, started: false, scroller: null };
    /** @type {Element} */ (e.currentTarget).setPointerCapture?.(e.pointerId);
    addEventListener('pointermove', this.#dragMove);
    addEventListener('pointerup', this.#dragEnd);
    addEventListener('pointercancel', this.#dragEnd);
  }

  /** @param {string} key */
  #section(key) { return /** @type {HTMLElement | null} */ (this.renderRoot.querySelector(`.block[data-key="${key}"]`)); }

  /** Middle of a block where it sits in the flow (without the drag offset). @param {string} key */
  #mid(key) {
    const el = this.#section(key);
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return r.top + r.height / 2 - (key === this._dragKey ? this._dragY : 0);
  }

  /** @param {PointerEvent} e */
  #dragMove = async e => {
    const drag = this.#drag;
    if (!drag) return;
    const y = e.clientY;
    if (!drag.started) {
      if (Math.abs(y - drag.y0) < 5) return;
      drag.started = true;
      e.preventDefault();
      drag.scroller = this.#scroller();
      this._dragKey = drag.key;
      this._dragY = 0;
      this._dragOrder = blockOrder(this.view);
      await this.updateComplete;
      // Folded, the list is short: bring the dragged title under the pointer.
      const off = this.#mid(drag.key) - y;
      if (drag.scroller && off) drag.scroller.scrollTop += off;
    }
    const scroller = drag.scroller;
    if (scroller) {
      const box = scroller === document.scrollingElement ? { top: 0, bottom: innerHeight } : scroller.getBoundingClientRect();
      if (y < box.top + 40) scroller.scrollTop -= 12;
      else if (y > box.bottom - 40) scroller.scrollTop += 12;
    }
    const order = /** @type {string[]} */ (this._dragOrder);
    const i = order.indexOf(drag.key);
    let next = null;
    if (i > 0 && y < this.#mid(order[i - 1])) next = this.#moved(drag.key, -1, order);
    else if (i < order.length - 1 && y > this.#mid(order[i + 1])) next = this.#moved(drag.key, 1, order);
    if (next) { this._dragOrder = next; await this.updateComplete; }
    this._dragY = Math.round(y - this.#mid(drag.key));
  };

  #dragEnd = async () => {
    removeEventListener('pointermove', this.#dragMove);
    removeEventListener('pointerup', this.#dragEnd);
    removeEventListener('pointercancel', this.#dragEnd);
    const drag = this.#drag;
    const order = this._dragOrder;
    this.#drag = null;
    if (!drag?.started) return;
    this._dragKey = null;
    this._dragOrder = null;
    this._dragY = 0;
    if (order) setBlockOrder(drag.view, order);
    await this.updateComplete;
    this.#section(drag.key)?.scrollIntoView({ block: 'nearest' });
  };

  // ── The three views: their own header, then the same blocks ─────────────────────────────────────────────

  /** Épuré: the plant at a glance, and one tap to put it in the current collection. @param {any} ctx */
  #epure(ctx) {
    return html`
      <article class="epure">
        <gf-add-to .plant=${ctx.plant}></gf-add-to>
        ${this.#blocks(ctx)}
      </article>`;
  }

  /** Standard (for everyone) and Scientifique (everything the app holds or can fetch, each with its source). @param {any} ctx */
  #full(ctx) {
    return html`
      <article class=${this.view === 'scientific' ? 'science' : ''}>
        <a class="back link" href=${lastSearchHash()}>${icon('arrow-left')} Recherche</a>
        <gf-add-to .plant=${ctx.plant}></gf-add-to>
        ${this._error ? html`<p class="muted">${this._error}</p>` : nothing}
        ${this.#blocks(ctx)}
      </article>`;
  }
}

customElements.define('gf-plant-detail', GfPlantDetail);
