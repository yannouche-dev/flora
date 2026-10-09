// @ts-check
import { LitElement, html, css, nothing, repeat } from 'lit';
import { STATUS_LABELS } from '../config.js';
import * as db from '../core/db.js';
import { lastSearchHash } from '../core/query.js';
import { StoreController, whenReady } from '../core/store.js';
import { formatDistance, getMembership, setInCollection, toggleFavorite } from '../core/collections.js';
import { context } from '../core/context.js';
import { lastFix, watchLocation } from '../core/geo.js';
import { savedRadius } from '../core/nearby.js';
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
import './gf-sheet-map.js';
import { OVERLAYS } from '../core/ign.js';
import { ui } from '../styles/ui.js';
import { icon } from '../core/icons.js';
import {
  STYLES, SUBS, canBeEmpty, hidesEmpty, setHidesEmpty, isMap, isAddedMap, mapConfig, setMapConfig, createMap, deleteMap, blockModuleName, blockOrder, blockStyle, blockTitle, isTitleShown, setBlockStyle, setTitleShown, createNote, deleteNote, isHidden, isNote, isSubHidden, noteText, renameBlock,
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

/** GBIF descriptions, French first, then English; one per type. @param {any} gbif the sheet's GBIF data */
function descriptions(gbif) {
  const rows = gbif?.descriptions?.results || [];
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

/** @param {any} gbif */
function distributions(gbif) {
  const rows = gbif?.distributions?.results || [];
  const seen = new Set();
  return rows
    .map(row => ({
      place: row.locality || row.country || row.locationId,
      means: row.establishmentMeans
    }))
    .filter(row => row.place && !seen.has(row.place) && seen.add(row.place))
    .slice(0, 24);
}

/** @param {any} plant @param {any} gbif */
function gbifFrenchNames(plant, gbif) {
  const known = new Set((plant.vernacularNames || []).map(name => name.toLowerCase()));
  const names = (gbif?.vernacularNames?.results || [])
    .filter(row => /^(fra|fre|fr)$/.test(row.language || ''))
    .map(row => row.vernacularName)
    .filter(name => name && !known.has(name.toLowerCase()) && known.add(name.toLowerCase()));
  return names.slice(0, 12);
}

/** Same name, case and accents aside. @param {string | undefined} a @param {string | undefined} b */
const sameName = (a, b) => Boolean(a && b) && String(a).localeCompare(String(b), 'fr', { sensitivity: 'base' }) === 0;

const STATUS_TYPES = {
  PN: 'Protection nationale',
  PR: 'Protection régionale',
  PD: 'Protection départementale',
  REGL: 'Réglementation (cueillette, commerce)',
  LRN: 'Liste rouge nationale',
  LRR: 'Liste rouge régionale'
};

/** « 12 % » of a total. @param {number} n @param {number} total */
const percent = (n, total) => total ? (n / total * 100).toLocaleString('fr-FR', { maximumFractionDigits: n / total < 0.1 ? 1 : 0 }) + ' %' : '';

/** « Près d’ici » was asked once in this visit: later sheets look around without asking again. */
let nearAllowed = false;

/**
 * One GPS fix, or why there is none (20 s at most).
 * @returns {Promise<{ coordinates: [number, number], timestamp: number } | { error: string } | null>}
 */
function oneFix() {
  return new Promise(resolve => {
    /** @type {(() => void) | null} */ let stop = null;
    let done = false;
    const finish = (/** @type {any} */ value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // The watch calls back synchronously once before `stop` is known.
      queueMicrotask(() => stop?.());
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 20000);
    stop = watchLocation(state => {
      if (state.fix && Date.now() - state.fix.timestamp < 5 * 60000) finish(state.fix);
      else if (state.error) finish({ error: state.error });
    });
  });
}

/** Kinds of GBIF records, in French. */
const BASIS_LABELS = {
  HUMAN_OBSERVATION: 'Observations', OBSERVATION: 'Observations (autres)', MACHINE_OBSERVATION: 'Observations automatiques',
  PRESERVED_SPECIMEN: 'Spécimens d’herbier', LIVING_SPECIMEN: 'Spécimens vivants (jardins)', MATERIAL_SAMPLE: 'Échantillons',
  MATERIAL_CITATION: 'Citations de publications', FOSSIL_SPECIMEN: 'Fossiles', OCCURRENCE: 'Non précisé'
};

/** IUCN Red List categories, in French. */
const IUCN_LABELS = {
  EX: 'Éteinte', EW: 'Éteinte à l’état sauvage', CR: 'En danger critique', EN: 'En danger', VU: 'Vulnérable',
  NT: 'Quasi menacée', LC: 'Préoccupation mineure', DD: 'Données insuffisantes', NE: 'Non évaluée'
};

/** Habitats and life forms of GBIF species profiles that read the same in any checklist, in French. */
const HABITATS = [[/terrestr|terr[ií]cola/i, 'terrestre'], [/fresh|dulce|douce|dulcícola/i, 'eau douce'], [/brackish|saumâtre|salobre/i, 'eau saumâtre'], [/marine|marin/i, 'marin']];
const LIFE_FORMS = [
  [/^(herb|herbaceous|hierba|erva|herbacée)s?$/i, 'herbacée'], [/^(shrub|arbusto|arbuste)s?$/i, 'arbuste'], [/^(subshrub|subarbusto|sous-arbrisseau)s?$/i, 'sous-arbrisseau'],
  [/^(tree|árbol|arbre|árvore)s?$/i, 'arbre'], [/climb|vine|liana|trepadeira|grimpante/i, 'grimpante'],
  [/geophyt/i, 'géophyte'], [/hemicryptophyt/i, 'hémicryptophyte'], [/chamaephyt/i, 'chaméphyte'], [/therophyt/i, 'thérophyte'], [/phanerophyt/i, 'phanérophyte']
];

/**
 * What GBIF species profiles agree on: habitats and life forms (only values that translate cleanly), and the
 * checklists that flag the plant as invasive somewhere. @param {any} gbif
 */
function profile(gbif) {
  const rows = gbif?.speciesProfiles?.results || [];
  /** @type {Map<string, number>} */ const habitats = new Map();
  /** @type {Map<string, number>} */ const forms = new Map();
  /** @type {string[]} */ const invasive = [];
  const count = (/** @type {Map<string, number>} */ m, /** @type {string} */ k) => m.set(k, (m.get(k) || 0) + 1);
  for (const r of rows) {
    const found = new Set();
    for (const [re, label] of HABITATS) if (re.test(String(r.habitat || ''))) found.add(label);
    if (r.terrestrial) found.add('terrestre');
    if (r.freshwater) found.add('eau douce');
    if (r.marine) found.add('marin');
    found.forEach(h => count(habitats, h));
    const lifeForm = String(r.lifeForm || '');
    if (lifeForm && !lifeForm.startsWith('{')) for (const part of lifeForm.split(/[,;|/]/)) {
      const label = LIFE_FORMS.find(([re]) => re.test(part.trim()))?.[1];
      if (label) count(forms, label);
    }
    if (r.isInvasive === true && r.source && !invasive.includes(r.source)) invasive.push(r.source);
  }
  const sorted = (/** @type {Map<string, number>} */ m) => [...m].sort((a, b) => b[1] - a[1]);
  return { habitats: sorted(habitats), forms: sorted(forms), invasive, sources: rows.length };
}

/** GBIF synonyms that TAXREF does not list (names compared without authors). @param {any} plant @param {any} gbif */
function gbifSynonyms(plant, gbif) {
  const known = (plant.synonyms || []).map((/** @type {string} */ n) => n.toLowerCase());
  /** @type {string[]} */ const out = [];
  for (const r of gbif?.synonyms?.results || []) {
    const canonical = r.canonicalName || r.scientificName;
    // Shown with its rank and author (« Urtica dioica subsp. eudioica Selander »), compared without them.
    const name = r.scientificName || canonical;
    if (!canonical || out.includes(name)) continue;
    const lower = canonical.toLowerCase();
    if (lower === String(plant.scientificName).toLowerCase() || known.some((/** @type {string} */ k) => k === lower || k.startsWith(lower + ' '))) continue;
    out.push(name);
  }
  return out.slice(0, 30);
}

/** Vernacular names in other languages (GBIF), grouped by language. @param {any} gbif */
function otherNames(gbif) {
  const byLang = new Map();
  for (const row of gbif?.vernacularNames?.results || []) {
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
    /** The plant waiting under the swiped card (Flore): not the page's plant yet, so it leaves the title alone. */
    preview: { type: Boolean },
    /** Épuré (photo and one-tap actions), standard (general public), scientific (every data). */
    view: { reflect: true },
    _wiki: { state: true },
    _science: { state: true },
    _gbif: { state: true },
    _near: { state: true },
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
    _mapsOpen: { state: true },
    _newNote: { state: true },
    _noteSaved: { state: true }
  };

  static styles = [ui, css`
    :host {
      display: block;
      overflow-y: auto;
      /* No bottom padding: the action bar docks at the very bottom (the article keeps the space). */
      padding: 16px 16px 0;
    }
    article { padding-bottom: 24px; }
    article { max-width: 920px; margin: 0 auto; }
    :host([embedded]) { padding: 4px 14px 0; }
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
    /* The action bar: docked at the bottom of the sheet (above the tab bar on a phone), equal buttons. */
    .action-bar {
      position: sticky;
      bottom: 0;
      z-index: 6;
      margin: 0 -16px;
      padding: 6px 8px;
      background: var(--gf-surface);
      border-top: 1px solid var(--gf-border);
      box-shadow: 0 -4px 14px rgb(0 0 0 / 0.06);
    }
    :host([embedded]) .action-bar { margin: 0 -14px; }
    .action-bar .acts { display: flex; gap: 4px; max-width: 920px; margin: 0 auto; }
    .action-bar .act { position: relative; flex: 1; min-width: 0; display: flex; }
    .action-bar .act > button, .action-bar .act > a.button {
      flex: 1;
      min-width: 0;
      display: grid;
      justify-items: center;
      gap: 2px;
      padding: 6px 4px;
      min-height: 0;
      border: 0;
      border-radius: var(--gf-radius);
      background: none;
      color: var(--gf-text);
      font-size: 0.72rem;
      font-weight: 600;
      text-decoration: none;
      box-shadow: none;
    }
    .action-bar .act svg { font-size: 1.2rem; }
    .action-bar .act span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    .action-bar .act > button:hover, .action-bar .act > a.button:hover { background: var(--gf-surface-2); }
    .action-bar .fav[aria-pressed='true'] { color: var(--gf-fav); }
    .action-bar .share-note { position: absolute; left: 50%; bottom: calc(100% + 6px); transform: translateX(-50%); margin: 0; padding: 4px 10px; border-radius: var(--gf-radius-pill); background: var(--gf-text); color: var(--gf-surface); white-space: nowrap; }
    /* Mode King: every action, each with its ☑; an action hidden in this view is faded and does nothing. */
    .action-bar .act-toggle { position: absolute; top: 0; right: 2px; display: grid; place-items: center; width: 22px; height: 22px; cursor: pointer; }
    .action-bar .act-toggle input { margin: 0; width: 16px; height: 16px; }
    .action-bar .act.off > button, .action-bar .act.off > a.button { opacity: 0.4; text-decoration: line-through; pointer-events: none; }
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
    .map-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin: 0 0 10px; padding: 10px; border: 1px dashed var(--gf-border); border-radius: var(--gf-radius); background: var(--gf-surface); font-size: 0.85rem; }
    .map-form fieldset { border: 0; margin: 0; padding: 0; display: grid; gap: 6px; align-content: start; }
    .map-form legend { font-weight: 700; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--gf-text-muted); padding: 0; margin-bottom: 2px; }
    .map-form label { display: grid; gap: 2px; }
    .map-form label.check { display: flex; gap: 6px; align-items: center; }
    .map-placeholder { border-radius: var(--gf-radius); background: var(--gf-surface-2); }
    .subs-editor { margin: 0 0 10px 20px; padding: 8px 10px; border: 1px dashed var(--gf-border); border-radius: var(--gf-radius); background: var(--gf-surface); }
    .note-text { width: 100%; font: inherit; padding: 8px 10px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius); background: var(--gf-surface); color: var(--gf-text); resize: vertical; }
    .note-text:focus-visible { outline: none; border-color: var(--gf-accent); box-shadow: var(--gf-focus); }
    .new-note { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0 0; }
    /* Mode King: room at the end so the crown, floating at the bottom, never covers the last controls. */
    .blocks.king ~ .new-note { padding-bottom: 80px; }
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
    /* Left out when empty: a block whose component found nothing for this plant. */
    .block.hide-empty:has(> .content > [hidden]:not([loading])) { display: none; }
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
    /* GBIF charts: one bar per month or year (no library). */
    .bars { display: flex; align-items: flex-end; gap: 3px; height: 84px; margin: 4px 0 0; }
    .bars .bar { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; }
    .bars .bar i { display: block; width: 100%; min-height: 1px; background: var(--gf-accent); border-radius: 3px 3px 0 0; opacity: 0.85; }
    .bars.months { height: 100px; }
    .bars.months .bar b { font-size: 0.65rem; font-weight: 600; color: var(--gf-text-muted); line-height: 1.4; }
    .bars.years { gap: 1px; height: 64px; }
    .axis { display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--gf-text-muted); }
    .small { font-size: 0.8rem; }
    .counts { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 0.9rem; }
    .counts li { display: grid; grid-template-columns: 1fr auto 3.6em; gap: 10px; align-items: baseline; }
    .counts li > :first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .counts b { font-variant-numeric: tabular-nums; font-weight: 600; }
    .counts small { color: var(--gf-text-muted); text-align: right; font-variant-numeric: tabular-nums; }
    .near { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; font-size: 0.88rem; }
    .near li { display: grid; grid-template-columns: 4.5em 1fr auto; gap: 10px; align-items: baseline; }
    .near li span { color: var(--gf-text-muted); min-width: 0; overflow-wrap: anywhere; }
    .papers { margin: 0; padding-left: 18px; display: grid; gap: 8px; font-size: 0.9rem; }
    .papers small { display: block; color: var(--gf-text-muted); }
    /* Herbarium sheets are tall: shown whole, not cropped. */
    .gallery.herbarium img { aspect-ratio: 3 / 4; object-fit: contain; background: #f4f1ea; }
    .specimen { display: block; font-size: 0.75rem; font-weight: 600; margin-bottom: 2px; }
    .credit a { color: inherit; }
    .wiki p.credit { margin-top: 6px; }
    /* The Wikipédia summary reads like the other blocks: flush left, no card (its source line names it). */
    .description.wiki { background: none; padding: 0; border-radius: 0; }
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
    /** King mode: the map blocks showing their settings. @type {Set<string>} */
    this._mapsOpen = new Set();
    this._newNote = false;
    /** Note block whose text was just saved. @type {string | null} */
    this._noteSaved = null;
    /** @type {any} */ this._wiki = undefined;
    /** @type {any} */ this._science = undefined;
    /**
     * GBIF data of the plant, each part loaded when a block or sub-block shows it (undefined: not yet; null: none):
     * vernacularNames, descriptions, distributions, speciesProfiles, synonyms, iucn, stats, photos, herbarium,
     * literature; names of datasets and areas in `titles`.
     * @type {Record<string, any>}
     */
    this._gbif = {};
    /** « Près d’ici »: not asked, looking for the position, loading, the result, or what went wrong. @type {any} */
    this._near = undefined;
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
    // The card underneath became the sheet.
    else if (changed.has('preview') && !this.preview) this.#title();
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

  /** The page's title: this plant, unless it is only a preview. */
  #title() {
    const plant = this._plant;
    if (!this.preview && plant && !plant.failed) document.title = (plant.vernacularNames?.[0] || plant.scientificName) + ' — GeoFlora';
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
    this._gbif = {};
    this._near = undefined;
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
    this.#title();

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
    this._gbif = {};
    this._near = undefined;
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
    this.#loadGbif(plant, details, signal, settle, once, shown);
  }

  /**
   * GBIF, part by part: only what the shown blocks and sub-blocks use (the Backbone key comes with the details).
   * @param {any} plant @param {any} details @param {AbortSignal | undefined} signal
   * @param {(task: Promise<any>, set: (v: any) => void) => void} settle @param {(key: string) => boolean} once
   * @param {(key: string) => boolean} shown
   */
  #loadGbif(plant, details, signal, settle, once, shown) {
    const v = this.view;
    if (details === undefined) return;
    const key = details?.identifiers?.gbif?.id ?? null;
    const sub = (/** @type {string} */ block, /** @type {string} */ k) => shown(block) && !isSubHidden(v, block, k);
    const put = (/** @type {string} */ name, /** @type {any} */ value) => { this._gbif = { ...this._gbif, [name]: value }; };
    const part = (/** @type {string} */ name, /** @type {() => Promise<any>} */ load) => {
      if (!once('gbif:' + name)) return;
      if (!key) { put(name, null); return; }
      settle(load(), x => put(name, x));
    };
    const species = (/** @type {string} */ name, /** @type {string} */ api = name) => part(name, () => sources.gbifSpecies(plant, key, api, signal, v));
    if (shown('names')) species('vernacularNames');
    if (shown('descriptions')) species('descriptions');
    if (sub('occurrences', 'distribution')) species('distributions');
    if (shown('gbifProfile')) species('speciesProfiles');
    if (v === 'scientific' && sub('taxonomy', 'gbifSynonyms')) species('synonyms');
    if (v === 'scientific' && sub('status', 'iucn')) species('iucn', 'iucnRedListCategory');
    if (['gbif', 'months', 'years', 'regions', 'basis', 'datasets'].some(k => sub('occurrences', k))) {
      part('stats', () => sources.gbifStats(plant, key, signal, v).then(stats => { this.#loadTitles(stats, signal); return stats; }));
    }
    if (!this.#store.state.modules.photos[v]) { if (once('gbif:noPhotos')) { put('photos', []); put('herbarium', []); } }
    else {
      if (sub('gbifMedia', 'photos')) part('photos', () => sources.gbifMedia(plant, key, 'photos', signal, v));
      if (sub('gbifMedia', 'herbarium')) part('herbarium', () => sources.gbifMedia(plant, key, 'herbarium', signal, v));
    }
    if (shown('literature')) part('literature', () => sources.gbifLiterature(plant, key, signal, v));
    // « Près d’ici » asked on an earlier sheet of this visit: look around again, without asking.
    if (nearAllowed && key && sub('occurrences', 'near') && once('gbif:near')) queueMicrotask(() => this.#findNear());
    // Arrived before the region and source names were shown: name them now.
    if (this._gbif.stats) this.#loadTitles(this._gbif.stats, signal);
  }

  /** Names of the top sources and of the areas the plant is found in (each fetched once, then cached). @param {any} stats @param {AbortSignal} [signal] */
  #loadTitles(stats, signal) {
    if (!stats) return;
    const v = this.view;
    const shown = (/** @type {string} */ k) => !isHidden(v, 'occurrences') && !isSubHidden(v, 'occurrences', k);
    /** @type {[string, Promise<string | null>][]} */
    const wanted = [];
    const titles = this._gbif.titles || {};
    if (shown('datasets')) for (const d of stats.datasets) if (!(d.key in titles)) wanted.push([d.key, sources.gbifDatasetTitle(d.key, signal, v)]);
    if (shown('regions')) {
      for (const r of stats.regions) if (!(r.gid in titles)) wanted.push([r.gid, sources.gadmName(r.gid, signal, v)]);
      for (const d of stats.departments.slice(0, 5)) if (!(d.gid in titles)) wanted.push([d.gid, sources.gadmName(d.gid, signal, v)]);
    }
    if (!wanted.length) return;
    const plant = this._plant;
    // Placeholders first: asked once.
    this._gbif = { ...this._gbif, titles: { ...titles, ...Object.fromEntries(wanted.map(([k]) => [k, undefined])) } };
    Promise.all(wanted.map(([k, task]) => task.catch(() => null).then(name => [k, name]))).then(named => {
      if (signal?.aborted || this._plant !== plant) return;
      this._gbif = { ...this._gbif, titles: { ...this._gbif.titles, ...Object.fromEntries(named) } };
    });
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

  /**
   * The action bar, docked at the bottom of the sheet (above the tab bar on a phone): the actions this view
   * shows, in its order. Mode King shows them all, each with its ☑ (shown or not in this view).
   * @param {any} plant
   */
  #actionBar(plant) {
    const v = this.view;
    const king = this.#store.state.kingMode;
    const fav = this.#store.state.favorites.has(plant.id);
    const name = plant.vernacularNames?.[0] || plant.scientificName;
    /** @type {Record<string, () => unknown>} */
    const buttons = {
      fav: () => html`<button type="button" class="fav" aria-pressed=${fav ? 'true' : 'false'} @click=${() => toggleFavorite(plant)}>
        ${icon(fav ? 'heart-fill' : 'heart')}<span>Favori</span></button>`,
      addTo: () => html`<button type="button" @click=${() => /** @type {any} */ (this.renderRoot.querySelector('gf-add-to'))?.open()}>${icon('plus-lg')}<span>Ajouter à…</span></button>`,
      share: () => html`<button type="button" @click=${() => this.#share(plant, name)}>${icon('share')}<span>Partager</span></button>`,
      // The Carte filtered on this plant (its places, its GBIF distribution).
      map: () => html`<a class="button" href=${href.map({ plant: plant.id })}>${icon('map')}<span>Carte</span></a>`,
      // In one tap, into the collection or place last opened (context.js), when it is not there yet.
      addCurrent: () => {
        const current = this.#currentCollection(plant);
        if (!current) return king ? html`<button type="button" disabled title="Ouvrez une collection ou un lieu : il devient la collection courante">${icon('plus-lg')}<span>Collection courante</span></button>` : nothing;
        return html`<button type="button" title=${'Ajouter à « ' + current.name + ' »'} @click=${() => this.#addCurrent(plant, current)}>
          ${icon(current.kind === 'place' ? 'geo-alt-fill' : 'plus-lg')}<span class="short">${current.name}</span></button>`;
      },
      spot: () => html`<a class="button" href=${href.newSpot(plant.id)}>${icon('geo-alt-fill')}<span>Noter ici</span></a>`
    };
    const keys = subOrder(v, 'actions').filter(k => buttons[k] && (king || (!isSubHidden(v, 'actions', k) && (k !== 'addCurrent' || this.#currentCollection(plant)))));
    if (!keys.length) return nothing;
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
      })}</div>
    </nav>`;
  }

  /** The current collection or place (context.js), when this plant is not in it yet. @param {any} plant */
  #currentCollection(plant) {
    const id = context().collection;
    if (!id) return null;
    const summary = this.#store.state.collections.find((/** @type {any} */ c) => c.id === id);
    if (!summary || (getMembership().byPlant.get(plant.id) || []).includes(id)) return null;
    return summary;
  }

  /** @param {any} plant @param {{ id: string, name: string, kind: string }} current */
  async #addCurrent(plant, current) {
    try {
      await setInCollection(current.id, plant, true);
      this._shareNote = `Ajoutée à « ${current.name} ».`;
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
      status: plant.status?.france
    };
  }

  /** The « Nom » block: French and scientific names (Épuré: the family too; flowering is the Calendrier's). @param {any} ctx */
  #name({ plant, name }) {
    return html`
      <h1>${name}</h1>
      <div class="sci"><i>${plant.scientificName}</i> <span class="author">${plant.author}</span></div>
      ${this.view === 'epure' ? html`<p class="meta">${plant.family}</p>` : nothing}`;
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
    // Outside it too, a block with nothing for this plant (no other name, no Wikipédia article).
    const keys = blockOrder(this.view).filter(k => king || (!isHidden(this.view, k) && !(hidesEmpty(this.view, k) && this.#emptyHere(k, ctx))));
    return html`<div class="blocks ${king ? 'king' : ''} ${sorting ? 'sorting' : ''}">${repeat(keys, k => k, k =>
      king ? this.#block(k, ctx, sorting ? order.indexOf(k) : null) : this.#plainBlock(k, ctx))}</div>
      ${king && !sorting ? this.#newNote() : nothing}`;
  }

  /** A block read without its title (Mode King › title on/off, per view). @param {string} key */
  #headless = key => !isTitleShown(this.view, key);

  /** A block as read outside « Mode King »: its title, its content. @param {string} key @param {any} ctx */
  #plainBlock(key, ctx) {
    // A component that hides itself when it has nothing (protection, look-alikes, calendar): the block goes with it (CSS).
    return html`<section class="block ${this.#headless(key) ? 'headless' : ''} ${hidesEmpty(this.view, key) ? 'hide-empty' : ''}" data-key=${key}>
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
        ${canBeEmpty(key) ? html`<button class="tool" type="button" aria-pressed=${hidesEmpty(this.view, key) ? 'true' : 'false'}
          aria-label=${hidesEmpty(this.view, key) ? `Afficher « ${title} » même vide, hors mode King` : `Ne pas afficher « ${title} » s’il est vide, hors mode King`}
          title=${hidesEmpty(this.view, key) ? 'Masqué quand il est vide (toucher pour l’afficher quand même)' : 'Affiché même vide (toucher pour le masquer quand il est vide)'}
          @click=${() => setHidesEmpty(this.view, key, !hidesEmpty(this.view, key))}>${icon('eye-slash')}</button>` : nothing}
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
        ${isMap(key) && !off ? html`<button class="tool" type="button" aria-expanded=${this._mapsOpen.has(key) ? 'true' : 'false'} aria-label="Configurer la carte « ${title} »" title="Ce que la carte montre et permet"
          @click=${() => { const open = new Set(this._mapsOpen); if (open.has(key)) open.delete(key); else open.add(key); this._mapsOpen = open; }}>${icon('gear')}</button>` : nothing}
        ${isNote(key) ? html`<button class="tool" type="button" aria-label="Supprimer le bloc « ${title} »" title="Supprimer le bloc et ses textes"
          @click=${() => { if (confirm(`Supprimer le bloc « ${title} » et tout ce qui y est écrit ?`)) deleteNote(key); }}>${icon('x-lg')}</button>` : nothing}
        ${isAddedMap(key) ? html`<button class="tool" type="button" aria-label="Supprimer le bloc « ${title} »" title="Supprimer cette carte"
          @click=${() => { if (confirm(`Supprimer la carte « ${title} » ?`)) deleteMap(key); }}>${icon('x-lg')}</button>` : nothing}
      </h2>
      ${subsOpen && !off ? html`<div class="subs-editor">
        <gf-sortable-list label=${'Sous-blocs de ' + title}
          .items=${subOrder(this.view, key).map(k => ({ key: k, label: subTitle(key, k), checked: !isSubHidden(this.view, key, k) }))}
          @reorder=${e => setSubOrder(this.view, key, e.detail.keys)}
          @toggle=${e => setSubHidden(this.view, key, e.detail.key, !e.detail.on)}></gf-sortable-list>
      </div>` : nothing}
      ${isMap(key) && !off && this._mapsOpen.has(key) ? this.#mapForm(key) : nothing}
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
        }}>${icon('plus-lg')} Bloc Note</button>
        <button type="button" @click=${async () => {
          const key = createMap('Carte');
          this._mapsOpen = new Set([...this._mapsOpen, key]);
          await this.updateComplete;
          this.renderRoot.querySelector(`.block[data-key="${key}"]`)?.scrollIntoView({ block: 'center' });
        }}>${icon('plus-lg')} Bloc Carte</button></p>`;
  }

  /**
   * A « Carte » block: the map component, set up as configured (the card under a swiped one shows a
   * placeholder rather than a second map). @param {string} key @param {any} ctx
   */
  #map(key, { plant, details, inat }) {
    const config = mapConfig(key);
    if (this.preview) return html`<div class="map-placeholder" style=${`height:${{ s: 180, m: 260, l: 380 }[config.height]}px`}></div>`;
    return html`<gf-sheet-map .plant=${plant} .gbifKey=${details?.identifiers?.gbif?.id ?? null} .inatId=${inat?.id ?? null}
      .config=${config} mode=${this.view}
      @map-layers=${(/** @type {CustomEvent} */ e) => {
        const { base, overlays } = e.detail;
        if (base !== config.base || overlays.join() !== config.overlays.join()) setMapConfig(key, { base, overlays });
      }}></gf-sheet-map>`;
  }

  /** Mode King: what a map block shows and lets do (the same in every mode). @param {string} key */
  #mapForm(key) {
    const c = mapConfig(key);
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
      <fieldset><legend>Couches</legend>
        ${select('Répartition GBIF', 'gbif', [['fr', 'France'], ['world', 'Monde'], ['off', 'Non']])}
        ${check('Mes lieux de cette plante (et chaque plant)', c.places, on => set({ places: on }))}
        ${select('Observations proches', 'near', [['off', 'Non'], ['both', 'iNaturalist et GBIF'], ['inat', 'iNaturalist'], ['gbif', 'GBIF']])}
      </fieldset>
      <fieldset><legend>Fond et couches IGN</legend>
        ${select('Fond', 'base', [['plan', 'Plan IGN'], ['photo', 'Photos aériennes']])}
        ${Object.entries(OVERLAYS).map(([k, def]) => check(def.label, c.overlays.includes(k),
          on => set({ overlays: on ? [...c.overlays, k] : c.overlays.filter(o => o !== k) })))}
      </fieldset>
      <fieldset><legend>Affichage</legend>
        ${select('Cadrage', 'frame', [['auto', 'Automatique (selon les couches)'], ['france', 'France entière'], ['world', 'Monde entier'], ['content', 'Ajusté à ce qui est affiché'], ['me', 'Autour de moi']])}
        ${select('Hauteur', 'height', [['s', 'Petite'], ['m', 'Moyenne'], ['l', 'Grande']])}
      </fieldset>
      <fieldset><legend>Actions</legend>
        ${action('open', 'Ouvrir dans la Carte')}
        ${action('create', 'Créer un endroit ici (appui long)')}
        ${action('edit', 'Déplacer mes plants (✎)')}
        ${action('spot', 'Noter ici')}
        ${action('locate', 'Me localiser')}
      </fieldset>
    </div>`;
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

  /**
   * The plant's other French names (TAXREF, GBIF), without the one it is shown under and without repeats (case
   * and accents aside). Not iNaturalist's common name: it comes in English when there is no French one.
   * @param {any} ctx @returns {string[]}
   */
  #otherFrench({ plant, name }) {
    /** @type {string[]} */
    const out = [];
    for (const n of [...(plant.vernacularNames || []), ...gbifFrenchNames(plant, this._gbif)].filter(Boolean)) {
      if (!sameName(n, name) && !out.some(o => sameName(o, n))) out.push(n);
    }
    return out;
  }

  /**
   * A block with nothing to show for this plant, left out outside Mode King: Noms with no other name, Wikipédia
   * with no article (or not yet: it appears when the summary arrives).
   * @param {string} key @param {any} ctx
   */
  #emptyHere(key, ctx) {
    const v = this.view;
    const g = this._gbif;
    const loaded = (/** @type {any} */ x) => x !== undefined;
    if (isNote(key)) return !noteText(key, ctx.plant.id);
    switch (key) {
      case 'names': return this.#namesEmpty(ctx);
      // Wikipédia: shown when the summary arrives.
      case 'wikipedia': return !this._wiki;
      case 'photos': return ctx.photosOff || (!ctx.loading && !ctx.images.length);
      // Épuré and Standard: the component hides itself when empty (CSS, see .hide-empty).
      case 'status': return v === 'scientific' && !ctx.plant.statuses?.length && loaded(this._science) && !this._science?.iucn && loaded(g.iucn) && !g.iucn?.code;
      case 'mine': return !(getMembership().byPlant.get(ctx.plant.id) || []).length;
      case 'descriptions': return loaded(g.descriptions) && !descriptions(g).filter(row => v === 'scientific' || /^(fra|fre|fr)$/.test(row.language || '')).length;
      case 'occurrences': return !ctx.loading && !ctx.details?.identifiers?.gbif?.id && !ctx.inat?.observationsCount;
      case 'gbifMedia': return ctx.photosOff || shownSubs(v, 'gbifMedia').every(k => loaded(g[k]) && !g[k]?.length);
      case 'gbifProfile': { const p = profile(g); return !p.habitats.length && !p.forms.length && !p.invasive.length; }
      case 'literature': return !g.literature?.items?.length;
      case 'trefle': return !ctx.loading && !trefleFacts(ctx.details).length;
      default: return false;
    }
  }


  /** The Noms block has nothing to show here. @param {any} ctx */
  #namesEmpty(ctx) {
    if (this.#otherFrench(ctx).length) return false;
    return blockStyle(this.view, 'names') === 'list' || this.view !== 'scientific' || !otherNames(this._gbif).length;
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
    if (isMap(key)) return this.#map(key, ctx);
    switch (key) {
      case 'name': return this.#name(ctx);
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
        const texts = descriptions(this._gbif).filter(row => v === 'scientific' || /^(fra|fre|fr)$/.test(row.language || ''));
        return texts.length
          ? texts.map(row => html`<div class="description"><small>${row.type || 'Description'}${row.source ? ' — ' + row.source : ''} · ${row.language} · GBIF</small>${row.text}</div>`)
          : this._gbif.descriptions === undefined ? pending : empty(v === 'scientific' ? 'Aucune description sur GBIF.' : 'Aucune description en français sur GBIF.');
      }
      case 'names': {
        const names = this.#otherFrench(ctx);
        const foreign = v === 'scientific' ? otherNames(this._gbif) : [];
        if (!names.length && !foreign.length) return this._gbif.vernacularNames === undefined ? pending : empty('Aucun autre nom français connu.');
        // « Liste » (Épuré's default): just the French names.
        if (blockStyle(v, 'names') === 'list') return shownSubs(v, 'names').includes('french') && names.length ? html`<p class="names-list">${names.join(' · ')}</p>` : nothing;
        return html`<dl class="facts">${this.#subs('names', {
          french: () => names.length ? html`<dt>Autres noms français</dt><dd>${names.join(' · ')}</dd>` : nothing,
          foreign: () => foreign.length ? html`<dt>Autres langues (GBIF)</dt><dd>${foreign.map(([lang, list]) => html`<span class="lang">${lang || '?'}</span> ${list.join(', ')} `)}</dd>` : nothing
        })}</dl>
        <p class="credit">Sources : TAXREF v18 · GBIF.</p>`;
      }
      case 'occurrences': return this.#occurrences(ctx);
      case 'gbifMedia': return this.#gbifMedia(ctx);
      case 'gbifProfile': return this.#gbifProfile();
      case 'literature': return this.#literature(ctx);
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
    const gbifSyn = shownSubs(this.view, 'taxonomy').includes('gbifSynonyms') ? gbifSynonyms(plant, this._gbif) : [];
    return html`
      <dl class="facts">${this.#subs('taxonomy', {
        chain: () => html`<dt>Classification</dt>
          <dd>${chain.length ? html`${chain.map(t => html`<span class="rank"><i>${t.name || t.label}</i></span> › `)}<i>${plant.scientificName}</i>`
            : sci === undefined && wikidata ? html`<span class="muted">chargement…</span>` : html`${plant.family} › <i>${plant.genus}</i> › <i>${plant.scientificName}</i>`}</dd>`,
        ranks: () => html`<dt>Famille · genre · espèce</dt><dd>${plant.family} · <i>${plant.genus}</i> · <i>${plant.species}</i></dd>`,
        author: () => html`<dt>Auteur</dt><dd>${plant.author || '—'}</dd>`,
        france: () => html`<dt>Statut en France</dt><dd>${status ? `${STATUS_LABELS[status] || status} (TAXREF ${status})` : '—'}</dd>`,
        synonyms: () => plant.synonyms?.length ? html`<dt>Synonymes (${plant.synonyms.length})</dt><dd class="sci-list"><i>${plant.synonyms.join(' · ')}</i></dd>` : nothing,
        gbifSynonyms: () => gbifSyn.length ? html`<dt>Synonymes GBIF absents de TAXREF (${gbifSyn.length})</dt><dd class="sci-list"><i>${gbifSyn.join(' · ')}</i></dd>` : nothing,
        inat: () => inat?.observationsCount != null ? html`<dt>Observations iNaturalist</dt><dd>${inat.observationsCount.toLocaleString('fr-FR')}</dd>` : nothing
      })}</dl>
      <p class="credit">Sources : TAXREF v18 (PatriNat) · Wikidata (classification)${inat?.observationsCount != null ? ' · iNaturalist' : ''}${gbifSyn.length ? ' · GBIF Backbone (synonymes)' : ''}.</p>`;
  }

  /** @param {any} ctx */
  #statuses({ plant, wikidata }) {
    const sci = this._science;
    // Global IUCN category from GBIF (IUCN Red List checklist) when Wikidata has none.
    const gbifIucn = !sci?.iucn && this._gbif.iucn?.code ? String(this._gbif.iucn.code) : null;
    const statuses = [...(plant.statuses || [])].sort((a, b) =>
      Object.keys(STATUS_TYPES).indexOf(a.type) - Object.keys(STATUS_TYPES).indexOf(b.type) || String(a.area).localeCompare(String(b.area), 'fr'));
    return html`
      ${this.#subs('status', {
        iucn: () => html`<dl class="facts">
          <dt>UICN (monde)</dt><dd>${sci?.iucn ? sci.iucn.label || sci.iucn.id
            : gbifIucn ? `${IUCN_LABELS[/** @type {keyof typeof IUCN_LABELS} */ (gbifIucn)] || gbifIucn} (${gbifIucn}) — GBIF`
            : (sci === undefined && wikidata) || this._gbif.iucn === undefined ? html`<span class="muted">chargement…</span>` : '—'}</dd>
        </dl>`,
        table: () => statuses.length ? html`<table class="statuses">
          <thead><tr><th>Type</th><th>Territoire</th><th>Statut</th></tr></thead>
          <tbody>${statuses.map(st => html`<tr><td>${STATUS_TYPES[st.type] || st.type}</td><td>${st.area}${st.level ? html` <span class="muted">(${st.level})</span>` : nothing}</td><td>${st.code && st.code !== st.label ? html`<b>${st.code}</b> ` : nothing}${st.label}</td></tr>`)}</tbody>
        </table>` : html`<p class="muted">Aucune protection, réglementation ni liste rouge connue (INPN).</p>`
      })}
      <p class="credit">Sources : INPN – Base de connaissance Statuts (PatriNat) · ${gbifIucn ? 'GBIF (Liste rouge UICN)' : 'Wikidata (UICN)'}.</p>`;
  }

  /** @param {any} ctx */
  #occurrences({ details, inat }) {
    const key = details?.identifiers?.gbif?.id ?? null;
    const g = this._gbif;
    const stats = g.stats;
    const places = distributions(g);
    const pending = html`<span class="muted">chargement…</span>`;
    const search = 'https://www.gbif.org/occurrence/search?country=FR&occurrence_status=present&has_geospatial_issue=false&taxon_key=' + key;
    const statsShown = ['gbif', 'months', 'years', 'regions', 'basis', 'datasets'].some(k => shownSubs(this.view, 'occurrences').includes(k));
    return html`${this.#subs('occurrences', {
      inat: () => html`<dl class="facts"><dt>Observations iNaturalist</dt><dd>${inat?.observationsCount != null ? inat.observationsCount.toLocaleString('fr-FR') : details === undefined ? pending : '—'}</dd></dl>`,
      gbif: () => html`<dl class="facts"><dt>Occurrences GBIF en France</dt><dd>${stats?.count != null
        ? html`<a href=${search} target="_blank" rel="noopener">${stats.count.toLocaleString('fr-FR')}</a>`
        : details === undefined || (key && stats === undefined) ? pending : '—'}</dd></dl>`,
      near: () => key ? this.#nearView() : nothing,
      months: () => stats?.count ? this.#monthBars(stats.months) : nothing,
      years: () => stats?.years?.length ? this.#yearBars(stats.years) : nothing,
      regions: () => stats?.count ? this.#areas(stats) : nothing,
      basis: () => stats?.basis?.length ? html`<h3>Types de relevés</h3><ul class="counts">${stats.basis.map((/** @type {any} */ b) => html`
        <li><span>${BASIS_LABELS[/** @type {keyof typeof BASIS_LABELS} */ (b.basis)] || b.basis}</span><b>${b.count.toLocaleString('fr-FR')}</b>
          <small>${percent(b.count, stats.count)}</small></li>`)}</ul>` : nothing,
      datasets: () => stats?.datasets?.length ? html`<h3>Principales sources</h3><ul class="counts">${stats.datasets.map((/** @type {any} */ d) => html`
        <li><a href=${'https://www.gbif.org/dataset/' + d.key} target="_blank" rel="noopener">${g.titles?.[d.key] ?? '…'}</a><b>${d.count.toLocaleString('fr-FR')}</b>
          <small>${percent(d.count, stats.count)}</small></li>`)}</ul>` : nothing,
      distribution: () => places.length ? html`<h3>Répartition dans le monde (listes GBIF)</h3>
        <ul class="inline">${places.map(row => html`<li>${row.place}${row.means ? html` <span class="muted">(${row.means.toLowerCase()})</span>` : nothing}</li>`)}</ul>` : nothing
    })}
    ${key && statsShown && stats ? html`<p class="credit">Source : <a href=${search} target="_blank" rel="noopener">GBIF.org</a> — occurrences en France : présences seulement, coordonnées sans problème connu.</p>` : nothing}`;
  }

  /** Occurrences per month, January to December. @param {number[]} months */
  #monthBars(months) {
    const max = Math.max(1, ...months);
    const names = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    return html`<h3>Occurrences par mois</h3>
      <div class="bars months" role="img" aria-label=${'Occurrences GBIF en France par mois : ' + months.map((c, i) => `${names[i]} ${c}`).join(', ')}>
        ${months.map((c, i) => html`<span class="bar" title=${`${names[i]} : ${c.toLocaleString('fr-FR')}`}><i style=${`height:${Math.round(c / max * 100)}%`}></i><b>${'JFMAMJJASOND'[i]}</b></span>`)}
      </div>`;
  }

  /** Occurrences per year, the last 60 years (older ones summed). @param {{ year: number, count: number }[]} years */
  #yearBars(years) {
    const last = years[years.length - 1].year;
    const first = Math.max(years[0].year, last - 59);
    const by = new Map(years.map(y => [y.year, y.count]));
    /** @type {[number, number][]} */ const list = [];
    for (let y = first; y <= last; y++) list.push([y, by.get(y) || 0]);
    const max = Math.max(1, ...list.map(([, c]) => c));
    const older = years.filter(y => y.year < first).reduce((n, y) => n + y.count, 0);
    return html`<h3>Occurrences par année</h3>
      <div class="bars years" role="img" aria-label=${`Occurrences GBIF en France par année, de ${first} à ${last}`}>
        ${list.map(([y, c]) => html`<span class="bar" title=${`${y} : ${c.toLocaleString('fr-FR')}`}><i style=${`height:${Math.round(c / max * 100)}%`}></i></span>`)}
      </div>
      <div class="axis"><span>${first}</span><span>${last}</span></div>
      ${older ? html`<p class="muted small">Et ${older.toLocaleString('fr-FR')} avant ${first}.</p>` : nothing}`;
  }

  /** Regions and départements (GADM areas of France) with occurrences. @param {any} stats */
  #areas(stats) {
    // Points near a border may fall in a neighbour's areas: France's only (GADM ids FRA.*).
    const regions = stats.regions.filter((/** @type {any} */ r) => r.gid.startsWith('FRA.'));
    const departments = stats.departments.filter((/** @type {any} */ d) => d.gid.startsWith('FRA.'));
    if (!regions.length && !departments.length) return nothing;
    const t = this._gbif.titles || {};
    const name = (/** @type {any} */ a) => html`${t[a.gid] ?? '…'} <small class="muted">(${a.count.toLocaleString('fr-FR')})</small>`;
    return html`<h3>Régions et départements</h3>
      <p>Occurrences dans <strong>${departments.length}</strong> département${departments.length > 1 ? 's' : ''} et <strong>${regions.length}</strong> région${regions.length > 1 ? 's' : ''}.</p>
      <dl class="facts">
        ${departments.length ? html`<dt>Départements les plus cités</dt><dd>${departments.slice(0, 5).map((/** @type {any} */ d, /** @type {number} */ i) => html`${i ? ' · ' : ''}${name(d)}`)}</dd>` : nothing}
        ${regions.length ? html`<dt>Régions</dt><dd>${regions.map((/** @type {any} */ r, /** @type {number} */ i) => html`${i ? ' · ' : ''}${name(r)}`)}</dd>` : nothing}
      </dl>
      <p class="credit">Découpage administratif : GADM, via GBIF.</p>`;
  }

  /** « Près d’ici »: GBIF occurrences around the user, on demand (the position is sent to GBIF). */
  #nearView() {
    const n = this._near;
    const radius = savedRadius();
    const head = html`<h3>Près d’ici</h3>`;
    if (!n) return html`${head}
      <p><button type="button" class="near-ask" @click=${() => this.#findNear()}>${icon('crosshair')} Chercher autour de moi (${formatDistance(radius)})</button></p>
      <p class="credit">Votre position est envoyée à GBIF pour cette recherche, sans être enregistrée.</p>`;
    if (n.state === 'locating') return html`${head}<p class="muted">Recherche de votre position…</p>`;
    if (n.state === 'loading') return html`${head}<p class="muted">chargement…</p>`;
    if (n.state === 'error') return html`${head}<p class="muted">${n.message} <button class="link" type="button" @click=${() => this.#findNear()}>Réessayer</button></p>`;
    return html`${head}
      ${n.total ? html`<p><strong>${n.total.toLocaleString('fr-FR')}</strong> occurrence${n.total > 1 ? 's' : ''} GBIF à moins de ${formatDistance(n.radius)}${n.nearest.length ? ' ; les plus proches :' : '.'}</p>
        <ul class="near">${n.nearest.map((/** @type {any} */ o) => html`<li title=${o.dataset || ''}>
          <strong>${formatDistance(o.distance)}</strong>
          <span>${o.date ? new Date(o.date).toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' }) : 'date inconnue'}
            · ${BASIS_LABELS[/** @type {keyof typeof BASIS_LABELS} */ (o.basis)] || o.basis || ''}</span>
          <a href=${'https://www.gbif.org/occurrence/' + o.key} target="_blank" rel="noopener">voir</a></li>`)}</ul>`
        : html`<p class="muted">Aucune occurrence GBIF à moins de ${formatDistance(n.radius)}.</p>`}
      <p class="credit">Source : GBIF.org — présences, coordonnées sans problème connu. Rayon : celui d’« Autour » (Carte).</p>`;
  }

  /** Looks for GBIF occurrences around the user's position (a recent one, else asks the GPS once). */
  async #findNear() {
    const key = this._details?.identifiers?.gbif?.id;
    const plant = this._plant;
    if (!key) return;
    nearAllowed = true;
    this._near = { state: 'locating' };
    const known = lastFix();
    const fix = known && Date.now() - known.timestamp < 5 * 60000 ? known : await oneFix();
    if (this._plant !== plant) return;
    if (!fix || 'error' in fix) { this._near = { state: 'error', message: fix && 'error' in fix ? fix.error : 'Position introuvable pour le moment.' }; return; }
    const radius = savedRadius();
    this._near = { state: 'loading' };
    try {
      const result = await sources.gbifNear(key, fix.coordinates, radius, undefined, this.view);
      if (this._plant === plant) this._near = result ? { state: 'done', radius, ...result } : { state: 'error', message: 'GBIF est désactivé dans ce mode.' };
    } catch {
      if (this._plant === plant) this._near = { state: 'error', message: 'GBIF ne répond pas pour le moment.' };
    }
  }

  /** « Médias GBIF »: field photos and herbarium sheets, apart. @param {any} ctx */
  #gbifMedia({ plant, photosOff }) {
    if (photosOff) return html`<p class="muted">Photos en ligne désactivées dans ce mode.</p>`;
    const g = this._gbif;
    return html`${this.#subs('gbifMedia', {
      photos: () => this.#mediaGallery(plant, 'Photos d’observation (France)', g.photos, 'Aucune photo d’observation sous licence libre sur GBIF.', false),
      herbarium: () => this.#mediaGallery(plant, 'Planches d’herbier', g.herbarium, 'Aucune planche d’herbier sous licence libre sur GBIF.', true)
    })}`;
  }

  /** @param {any} plant @param {string} title @param {any[] | null | undefined} list @param {string} none @param {boolean} herbarium */
  #mediaGallery(plant, title, list, none, herbarium) {
    const head = html`<h3>${title}</h3>`;
    if (list === undefined) return html`${head}<p class="muted">chargement…</p>`;
    if (!list?.length) return html`${head}<p class="muted">${none}</p>`;
    return html`${head}<div class="gallery ${herbarium ? 'herbarium' : ''}">${list.map(image => html`<figure>
      <a href=${image.sourceUrl || image.url} target="_blank" rel="noopener"><img src=${image.url} alt=${(herbarium ? 'Planche d’herbier de ' : '') + plant.scientificName} loading="lazy" decoding="async" referrerpolicy="no-referrer" /></a>
      <figcaption>
        ${herbarium ? html`<span class="specimen">${[image.institution, image.catalogNumber && 'n° ' + image.catalogNumber, image.year, image.country].filter(Boolean).join(' · ')}</span>` : nothing}
        <gf-attribution .media=${image}></gf-attribution>
      </figcaption></figure>`)}</div>`;
  }

  /** « Habitat et écologie (GBIF) »: what the species profiles of GBIF checklists say. */
  #gbifProfile() {
    if (this._gbif.speciesProfiles === undefined) return html`<p class="muted">chargement…</p>`;
    const p = profile(this._gbif);
    if (!p.habitats.length && !p.forms.length && !p.invasive.length) return html`<p class="muted">Aucun profil d’espèce exploitable sur GBIF.</p>`;
    const key = this._details?.identifiers?.gbif?.id;
    return html`<dl class="facts">
        ${p.habitats.length ? html`<dt>Milieu</dt><dd>${p.habitats.map(([h]) => h).join(' · ')}</dd>` : nothing}
        ${p.forms.length ? html`<dt>Port</dt><dd>${p.forms.map(([f]) => f).join(' · ')}</dd>` : nothing}
        ${p.invasive.length ? html`<dt>Signalée envahissante</dt><dd>${p.invasive.slice(0, 4).join(' · ')}${p.invasive.length > 4 ? ` et ${p.invasive.length - 4} autres listes` : ''}</dd>` : nothing}
      </dl>
      <p class="credit">Source : <a href=${'https://www.gbif.org/species/' + key} target="_blank" rel="noopener">GBIF.org</a> — profils d’espèce de ${p.sources} liste${p.sources > 1 ? 's' : ''} de référence.</p>`;
  }

  /** « Publications (GBIF) »: the latest papers that used GBIF data on this taxon. @param {any} ctx */
  #literature({ details }) {
    const l = this._gbif.literature;
    if (l === undefined) return html`<p class="muted">chargement…</p>`;
    if (!l?.items?.length) return html`<p class="muted">Aucune publication citant des données GBIF sur cette espèce.</p>`;
    const key = details?.identifiers?.gbif?.id;
    return html`<ul class="papers">${l.items.map((/** @type {any} */ r) => html`<li>
        ${r.url ? html`<a href=${r.url} target="_blank" rel="noopener">${r.title}</a>` : r.title}
        <small>${[r.authors.slice(0, 3).join(', ') + (r.authors.length > 3 ? ' et al.' : ''), r.source, r.year].filter(Boolean).join(' · ')}</small>
      </li>`)}</ul>
      <p class="credit">${l.total.toLocaleString('fr-FR')} publication${l.total > 1 ? 's' : ''} utilisant des données GBIF sur cette espèce —
        <a href=${'https://www.gbif.org/resource/search?contentType=literature&gbifTaxonKey=' + key} target="_blank" rel="noopener">toutes sur GBIF.org</a>.</p>`;
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
      </article>
      ${this.#actionBar(ctx.plant)}`;
  }

  /** Standard (for everyone) and Scientifique (everything the app holds or can fetch, each with its source). @param {any} ctx */
  #full(ctx) {
    return html`
      <article class=${this.view === 'scientific' ? 'science' : ''}>
        <a class="back link" href=${lastSearchHash()}>${icon('arrow-left')} Recherche</a>
        <gf-add-to .plant=${ctx.plant}></gf-add-to>
        ${this._error ? html`<p class="muted">${this._error}</p>` : nothing}
        ${this.#blocks(ctx)}
      </article>
      ${this.#actionBar(ctx.plant)}`;
  }
}

customElements.define('gf-plant-detail', GfPlantDetail);
