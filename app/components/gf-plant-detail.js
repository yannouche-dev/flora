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
import { moduleOn, modulesSignature } from '../core/modules.js';
import { baseOf } from '../core/modes.js';
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
  setBlockOrder, setHidden, setNoteText, setSubHidden, setSubOrder, shownSubs, subOrder, subTitle,
  EDGE_SIZES, PLACES, blocksAt, edgeState, isOnEdge, placeOf, setEdgeState, setPlace, orderByCategory
} from '../core/sheet-blocks.js';
import { CATEGORIES, blockCategory, categoryOf } from '../core/categories.js';
import { FOCUS_EVENT, isFocused, noFocus, toggleFocus } from '../core/map-focus.js';
import * as openData from '../core/open-data.js';
import * as usesData from '../core/uses.js';
import { lookalikesOf } from '../core/lookalikes.js';
import { chartStyles, climateChart, groupColor, groupLegend, networkChart, nicheChart } from '../core/charts.js';
import { unsafeCSS } from 'lit';
import './gf-sortable-list.js';
import './gf-media-viewer.js';
import './gf-sheet-rail.js';
import { alertsOf } from '../core/alerts.js';
import { sheetSession } from '../core/sheet-session.js';
import { openModal } from '../core/history.js';

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
      means: row.establishmentMeans,
      // An ISO country code (some checklists): the map can show the occurrences there.
      country: /^[A-Z]{2}$/.test(row.country || '') ? row.country : /^ISO3166:[A-Z]{2}$/i.test(row.locationId || '') ? row.locationId.slice(-2).toUpperCase() : null
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
const sameName = (a, b) => Boolean(a && b) && nameKey(String(a)) === nameKey(String(b));

/**
 * A name's key, for the duplicates written differently: case, accents, hyphens and apostrophes, an article in
 * front (« la », « l’ »), plurals (« Orties »), spaces. @param {string} name
 */
function nameKey(name) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[-‐‑’'`´_.]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(le|la|les|l|the|der|die|das|el|il|lo|los|las)\s+/, '')
    .split(' ').map(w => w.length > 3 ? w.replace(/(s|x)$/, '') : w).join(' ');
}

/** How well a name is written: its accents (the first letter gets its capital anyway). @param {string} name */
const nameCare = name => name.normalize('NFD').length - name.length;

/**
 * Names without their duplicates: lists split (« grande ortie, ortie dioïque »), the same name written
 * differently counted once — its best-written form kept, at the place of its first one; the first letter in
 * capital. `except`: names already shown elsewhere (the title).
 * @param {(string | null | undefined)[]} names @param {(string | null | undefined)[]} [except] @returns {string[]}
 */
export function dedupNames(names, except = []) {
  const skip = new Set(except.filter(Boolean).map(n => nameKey(String(n))));
  /** @type {Map<string, string>} */
  const kept = new Map();
  for (const raw of names) {
    for (const part of String(raw || '').split(/\s*[,;\/]\s*|\s+ou\s+/)) {
      const name = part.replace(/\s+/g, ' ').trim();
      if (name.length < 2) continue;
      const key = nameKey(name);
      if (!key || skip.has(key)) continue;
      const had = kept.get(key);
      if (!had || nameCare(name) > nameCare(had)) kept.set(key, name);
    }
  }
  return [...kept.values()].map(n => n.charAt(0).toLocaleUpperCase('fr') + n.slice(1));
}

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
/** My position used for pollen and climate once in this visit: later sheets show them without asking. */
let hereAllowed = false;

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
    byLang.set(lang, [...byLang.get(lang) || [], row.vernacularName]);
  }
  return [...byLang].map(([lang, list]) => [lang, dedupNames(list).slice(0, 4)]).slice(0, 12);
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
    /** The rubrics are shown by the host (the header of Flore's plant pane): the sheet tells them (`sheet-rail`). */
    outerRail: { type: Boolean, attribute: 'outer-rail' },
    /** Épuré (photo and one-tap actions), standard (general public), scientific (every data). */
    view: { reflect: true },
    _wiki: { state: true },
    _science: { state: true },
    _gbif: { state: true },
    _near: { state: true },
    _spotsOpen: { state: true },
    _plant: { state: true },
    _details: { state: true },
    /**
     * Only this block, at full size: the sheet's block shown in a pane beside it (Flore), or over the page.
     * Only its data is loaded.
     */
    only: {},
    /** In a pane (`only` media): the image to open at, by URL (a photo touched) or by place (the address). */
    paneStart: { attribute: false },
    paneAt: { attribute: false },
    /** The block shown in the pane beside this sheet (Flore): only a line here, not twice. */
    inPane: { attribute: false },
    /** A block opened over the page (outside Flore, where there is no pane): its key and the image it starts at. */
    _paneDialog: { state: true },
    /** The category of the block at the top of the sheet (lit in the side rail). */
    _activeCat: { state: true },
    /** The plant's alerts, as counts on the rubric icons (alerts.js). */
    _alerts: { state: true },
    /** The sheet is wide enough for the rubrics in a column on its left. */
    _railCol: { state: true },
    /** The edge shown over the whole plant pane for now (Échap or its button puts it back). */
    _maxEdge: { state: true },
    /** The sheet is wide enough for columns on its left and right edges (else they are bands at the top). */
    _wideSheet: { state: true },
    _error: { state: true },
    _shareNote: { state: true },
    _dragKey: { state: true },
    _dragOrder: { state: true },
    _dragY: { state: true },
    _renaming: { state: true },
    _subsOpen: { state: true },
    _mapsOpen: { state: true },
    _newNote: { state: true },
    _noteSaved: { state: true },
    /** What the sheet's maps show beyond their settings: a filter, a point, a compared plant (map-focus.js). */
    _focus: { state: true },
    /** Open data crossed with the plant: GloBI interactions, climate niche; « here » (pollen and climate of my position). */
    _open: { state: true }
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
    /* Mode King: the block's category (what the data says about the plant). */
    .block-title .cat { flex: none; padding: 0 8px; border-radius: var(--gf-radius-pill); background: var(--gf-surface-2); color: var(--gf-text-muted); font-size: 0.66rem; font-weight: 600; text-transform: none; letter-spacing: 0; margin-right: 2px; }
    @container (max-width: 420px) { .block-title .cat { display: none; } }
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
    /* Other names: a quiet list, in italics. */
    .names-list, .names { margin: 0; font-style: italic; font-size: 0.88rem; color: var(--gf-text-muted); line-height: 1.5; }
    .names-list .sep, .names .sep { font-style: normal; opacity: 0.5; padding: 0 0.3em; }
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
    .hero a, .gallery a { cursor: zoom-in; }
    .all-media { display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; }
    dialog.pane { width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; display: flex; flex-direction: column; background: var(--gf-surface); }
    dialog.pane:not([open]) { display: none; }
    dialog.pane gf-plant-detail { flex: 1; min-height: 0; }
    .pane-bar { display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 14px; border-bottom: 1px solid var(--gf-border); }
    .pane-bar h2 { flex: 1; margin: 0; font-size: 1rem; }
    /* A block alone, at full size (a pane). */
    :host([only]) { display: flex; flex-direction: column; min-height: 0; overflow: hidden auto; }
    :host([only='media']) { overflow: hidden; }
    :host([only]) gf-media-viewer { flex: 1; min-height: 0; }
    .only-pad { padding: 12px 16px; }
    .block.only { margin: 0; }
    .only-pad.fill, .only-pad.fill > .block, .only-pad.fill > .block > .content { flex: 1; display: flex; flex-direction: column; min-height: 0; }
    /* ⤢: a block in the pane beside the sheet. */
    .block { position: relative; }
    .to-pane { width: 30px; height: 30px; min-height: 0; font-size: 0.85rem; flex: none; opacity: 0; transition: opacity 0.15s; color: var(--gf-text-muted); }
    .block > .to-pane { position: absolute; top: 0; right: 0; z-index: 2; }
    .block:hover .to-pane, .to-pane:focus-visible { opacity: 1; }
    @media (hover: none) { .block-title .to-pane { opacity: 0.6; } }
    .in-pane { display: flex; align-items: center; gap: 6px; font-size: 0.9rem; }
    .paned { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 4px 0 10px; font-size: 0.85rem; color: var(--gf-text-muted); }
    .paned button { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--gf-border); background: var(--gf-surface); border-radius: var(--gf-radius-pill); padding: 3px 10px; font: inherit; color: var(--gf-text); cursor: pointer; }
    .paned button:hover { border-color: var(--gf-accent); }
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
    .facts .lang { font-style: normal; font-size: 0.75rem; font-weight: 700; color: var(--gf-text-muted); text-transform: uppercase; }
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
    ${unsafeCSS(chartStyles)}
    .prudence { border: 1px solid #d97706; background: color-mix(in srgb, #f59e0b 12%, var(--gf-surface)); border-radius: var(--gf-radius); padding: 8px 12px; margin-bottom: 10px; }
    .prudence.grave { border-color: #b91c1c; background: color-mix(in srgb, #ef4444 10%, var(--gf-surface)); }
    .prudence ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .prudence li { display: flex; gap: 8px; align-items: baseline; font-size: 0.9rem; line-height: 1.35; }
    .prudence li svg { flex: none; color: #d97706; }
    .prudence li.stop svg { color: #b91c1c; }
    .prudence p { margin: 8px 0 0; }
    .src { font-size: 0.72rem; color: var(--gf-text-muted); white-space: nowrap; }
    .src::before { content: '— '; }
    ul.recipes { margin: 4px 0 0; padding-left: 18px; font-size: 0.9rem; display: grid; gap: 3px; }
    .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin: 0 5px 0 2px; vertical-align: 0; }
    .partner em, .partners em { font-family: var(--gf-font-serif); }
    .pollen .level { display: inline-block; padding: 1px 10px; border-radius: var(--gf-radius-pill); font-weight: 700; font-size: 0.85rem; background: var(--gf-surface-2); }
    .pollen .level.l1 { background: #e8f5e9; color: #2e7d32; } .pollen .level.l2 { background: #fff8e1; color: #b26a00; }
    .pollen .level.l3 { background: #ffe0b2; color: #c43e00; } .pollen .level.l4 { background: #ffcdd2; color: #b71c1c; }
    details.here-climate summary { cursor: pointer; font-size: 0.85rem; font-weight: 600; margin: 6px 0; }
    /* Tabular data (style « Tableau », the default; « Liste » keeps the compact rows). */
    table.data { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin: 2px 0 6px; }
    table.data th, table.data td { text-align: left; padding: 5px 8px 5px 0; border-bottom: 1px solid var(--gf-border); vertical-align: baseline; }
    table.data thead th { color: var(--gf-text-muted); font-weight: 600; font-size: 0.75rem; }
    table.data tbody th { color: var(--gf-text-muted); font-weight: 600; width: 40%; }
    table.data .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    table.data.counts-table td:first-child { max-width: 0; width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    table.data .pct { width: 7.5em; }
    .meter { display: inline-block; width: 3em; height: 6px; margin-right: 6px; border-radius: 3px; background: var(--gf-surface-2); overflow: hidden; vertical-align: middle; }
    .meter i { display: block; height: 100%; background: var(--gf-accent); opacity: 0.8; }
    table.data td > button.focusable, table.data td .with-link > button.focusable { margin: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
    table.data .with-link { display: flex; gap: 6px; min-width: 0; align-items: baseline; }
    table.data .ext { flex: none; text-decoration: none; }
    h4 { font-size: 0.78rem; margin: 10px 0 2px; color: var(--gf-text-muted); font-weight: 600; }
    ul.plain { margin: 0; padding-left: 18px; display: grid; gap: 4px; font-size: 0.9rem; }

    /* A value that shows on the sheet's maps when touched (the sheet has a map): dotted underline, highlighted while shown. */
    button.focusable {
      display: inline; min-height: 0; padding: 0 3px; margin: 0 -3px; border: 0; border-radius: 4px; background: none; box-shadow: none;
      color: inherit; font: inherit; font-weight: inherit; text-align: inherit; cursor: pointer;
      text-decoration: underline dotted color-mix(in srgb, var(--gf-accent) 70%, transparent); text-underline-offset: 3px;
    }
    button.focusable:hover { color: var(--gf-accent); }
    button.focusable[aria-pressed='true'] { background: color-mix(in srgb, #f59e0b 28%, transparent); text-decoration: none; }
    button.focusable:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .counts li > button.focusable { display: block; margin: 0; padding: 0 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .counts .with-link { display: flex; gap: 6px; min-width: 0; align-items: baseline; }
    .counts .with-link > button.focusable { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .counts .ext { flex: none; text-decoration: none; }
    .bars button.bar { padding: 0; margin: 0; border: 0; border-radius: 3px 3px 0 0; background: none; text-decoration: none; }
    .bars button.bar:hover i { opacity: 1; background: color-mix(in srgb, var(--gf-accent) 80%, #000); }
    .bars button.bar[aria-pressed='true'] { background: none; }
    .bars button.bar[aria-pressed='true'] i { background: #f59e0b; opacity: 1; }
    .bars button.bar[aria-pressed='true'] b { color: #b45309; }
    figcaption button.where { display: flex; gap: 4px; align-items: center; margin: 0 0 4px; font-size: 0.72rem; color: var(--gf-text-muted); text-align: left; }
    .focus-hint { font-size: 0.75rem; color: var(--gf-text-muted); margin: 6px 0 0; }

    /*
     * Edges of the plant pane (Mode King › Position): blocks stuck to the top, left, right or bottom; the
     * sheet scrolls between them. Bands S / M / L high (or dragged), columns S / M / L wide.
     */
    :host { container-type: inline-size; }
    :host([edged]) { overflow: hidden; display: flex; flex-direction: column; padding: 0; }
    :host([edged]) .railed { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    :host([edged]) .railed-sheet { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    :host([edged]) .rail { position: static; margin: 0; }
    .frame.edged { position: relative; flex: 1; min-height: 0; display: grid; }
    :host([edged]) > .frame.edged { height: 100%; }
    .frame.edged > .main { grid-area: main; min-width: 0; min-height: 0; overflow-y: auto; padding: 16px 16px 0; }
    :host([embedded]) .frame.edged > .main { padding: 4px 14px 0; }
    .edge { position: relative; z-index: 7; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--gf-bg, var(--gf-surface-2)); }
    .edge[data-edge='top'] { grid-area: top; border-bottom: 1px solid var(--gf-border); }
    .edge[data-edge='bottom'] { grid-area: bottom; border-top: 1px solid var(--gf-border); }
    .edge[data-edge='left'] { grid-area: left; }
    .edge[data-edge='right'] { grid-area: right; }
    .edge.col[data-edge='left'] { border-right: 1px solid var(--gf-border); }
    .edge.col[data-edge='right'] { border-left: 1px solid var(--gf-border); }
    .edge.band[data-edge='left'], .edge.band[data-edge='right'] { border-bottom: 1px solid var(--gf-border); }
    /* Absolute in a grid: no area, so the frame itself holds it (an area would be its box). */
    .edge.max { grid-area: auto !important; position: absolute; inset: 0; z-index: 30; width: auto !important; height: auto !important; border: 0; box-shadow: var(--gf-shadow-float); }
    .edge-bar { flex: none; display: flex; align-items: center; gap: 4px; min-height: 36px; padding: 2px 6px 2px 8px; color: var(--gf-text-muted); font-size: 0.75rem; }
    .edge-tabs { flex: 1; min-width: 0; display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; }
    .edge-tabs::-webkit-scrollbar { display: none; }
    .edge-tabs button { display: inline-flex; align-items: center; gap: 5px; min-height: 28px; padding: 2px 8px; border: 0; border-radius: var(--gf-radius-sm); background: none;
      color: var(--gf-text-muted); font: inherit; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; cursor: pointer; }
    .edge-tabs button[aria-selected='true'] { background: var(--gf-surface); color: var(--gf-accent); box-shadow: var(--gf-shadow); }
    .edge-tabs:has(button:only-child) button { background: none; box-shadow: none; cursor: default; }
    .edge-sizes { display: inline-flex; flex: none; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-pill); overflow: hidden; }
    .edge-sizes button { min-height: 0; padding: 2px 8px; border: 0; border-radius: 0; background: var(--gf-surface); color: var(--gf-text-muted); font-size: 0.68rem; font-weight: 700; cursor: pointer; }
    .edge-sizes button[aria-pressed='true'] { background: var(--gf-accent-soft); color: var(--gf-accent); }
    .edge-btn { flex: none; width: 30px; height: 30px; min-height: 0; padding: 0; display: grid; place-items: center; border: 0; border-radius: var(--gf-radius-sm); background: none;
      color: var(--gf-text-muted); cursor: pointer; list-style: none; }
    .edge-btn::-webkit-details-marker { display: none; }
    .edge-btn:hover { background: var(--gf-surface); color: var(--gf-text); }
    .edge-sizes button:focus-visible, .edge-btn:focus-visible, .edge-tabs button:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .edge-opts { position: relative; flex: none; }
    .opts-pop { position: absolute; right: 0; top: 100%; z-index: 40; display: grid; gap: 6px; min-width: 230px; padding: 10px 12px; background: var(--gf-surface);
      border: 1px solid var(--gf-border); border-radius: var(--gf-radius); box-shadow: var(--gf-shadow-float); color: var(--gf-text); font-size: 0.85rem; text-transform: none; letter-spacing: 0; font-weight: 400; }
    .edge[data-edge='bottom'] .opts-pop { top: auto; bottom: 100%; }
    .opts-pop label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    .edge-body { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; padding: 4px 12px 10px; overscroll-behavior: contain; }
    .edge.bare .edge-body { padding: 0; }
    .edge.bare .edge-body > .block { margin: 0; }
    /* The bar names the edge's blocks: no second title (Mode King shows the block's tools). */
    .edge:not(.king) .edge-body > .block > h2.block-title, .edge:not(.king) .edge-body > .block > .to-pane { display: none; }
    .edge-body > .block { margin-top: 0; }
    .edge-body > .block.map-block, .edge-body > .block[data-key='media'] { flex: 1 0 200px; display: flex; flex-direction: column; min-height: 0; }
    .edge-body > .block.map-block > .content, .edge-body > .block[data-key='media'] > .content { flex: 1; display: flex; flex-direction: column; min-height: 0; }
    .edge-body .map-placeholder.fill { flex: 1; height: auto !important; }
    .edge-body gf-media-viewer { flex: 1; min-height: 0; }
    gf-sheet-map[fill] { flex: 1; min-height: 0; }
    /* Folded: its bar only (a column: a strip of its blocks' icons). */
    .edge.col.folded { width: 44px; }
    .edge.col.folded .edge-bar { flex-direction: column; padding: 6px 4px; gap: 6px; }
    .edge.col.folded .edge-tabs { flex-direction: column; overflow: visible; }
    .edge.col.folded .tab-name { display: none; }
    .edge.col .edge-tabs .tab-name { overflow: hidden; text-overflow: ellipsis; }
    /* Without title or frame: the block fills the edge; its tabs and « agrandir » float over it. */
    .edge-float { position: absolute; top: 6px; left: 6px; z-index: 3; display: flex; gap: 4px; padding: 2px; border-radius: var(--gf-radius-sm); background: color-mix(in srgb, var(--gf-surface) 85%, transparent); box-shadow: var(--gf-shadow); }
    .edge-float .tab-name { display: none; }
    /* Dragging an edge's inner border. */
    .edge-grip { position: absolute; z-index: 8; touch-action: none; }
    .edge-grip::after { content: ''; position: absolute; background: transparent; transition: background 0.12s; }
    .edge-grip:hover::after { background: var(--gf-accent); }
    .edge.band .edge-grip { left: 0; right: 0; height: 10px; cursor: row-resize; }
    .edge.band .edge-grip::after { left: 0; right: 0; top: 4px; height: 2px; }
    .edge.col .edge-grip { top: 0; bottom: 0; width: 10px; cursor: col-resize; }
    .edge.col .edge-grip::after { top: 0; bottom: 0; left: 4px; width: 2px; }
    .edge[data-edge='top'] .edge-grip, .edge.band[data-edge='left'] .edge-grip, .edge.band[data-edge='right'] .edge-grip { bottom: -5px; }
    .edge[data-edge='bottom'] .edge-grip { top: -5px; }
    .edge.col[data-edge='left'] .edge-grip { right: -5px; }
    .edge.col[data-edge='right'] .edge-grip { left: -5px; }
    /* Mode King: the position of a block — a cross of buttons. */
    .place-pick { position: relative; flex: none; }
    .place-pick > summary { list-style: none; display: inline-grid; place-items: center; cursor: pointer; }
    .place-pick > summary::-webkit-details-marker { display: none; }
    .place-grid { position: absolute; right: 0; top: 100%; z-index: 40; display: grid; grid-template-columns: repeat(3, 34px); grid-template-areas: '. t .' 'l s r' '. b .' 'x x x';
      gap: 3px; padding: 8px; background: var(--gf-surface); border: 1px solid var(--gf-border); border-radius: var(--gf-radius); box-shadow: var(--gf-shadow-float); }
    .place-grid button { height: 30px; min-height: 0; padding: 0; display: grid; place-items: center; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-sm); background: var(--gf-surface); color: var(--gf-text-muted); cursor: pointer; }
    .place-grid button[aria-pressed='true'] { background: var(--gf-accent); border-color: var(--gf-accent); color: var(--gf-accent-contrast); }
    .place-grid .p-top { grid-area: t; } .place-grid .p-left { grid-area: l; } .place-grid .p-sheet { grid-area: s; } .place-grid .p-right { grid-area: r; } .place-grid .p-bottom { grid-area: b; }
    .place-grid .p-beside { grid-area: x; }
    .edge[data-edge='bottom'] .place-grid { top: auto; bottom: 100%; }
    /*
     * Side rail: an icon per category of the sheet's blocks (Noms, Images, Protection…). Narrow sheet: a strip
     * stuck at the top; wide: a column stuck on the left. Hover (or focus): the category's blocks.
     */
    .railed { --rail-h: 44px; }
    .rail { position: sticky; top: -16px; z-index: 9; margin: -16px -16px 6px; padding: 4px 10px; background: var(--gf-surface); border-bottom: 1px solid var(--gf-border); }
    :host([embedded]) .rail { top: -4px; margin: -4px -14px 6px; }
    .block { scroll-margin-top: calc(var(--rail-h, 0px) + 8px); }
    .block[data-flash] { animation: flash 1.2s ease-out; }
    @keyframes flash { from { box-shadow: 0 0 0 3px var(--gf-accent); } to { box-shadow: 0 0 0 3px transparent; } }
    @container (min-width: 560px) {
      .railed { --rail-h: 0px; display: grid; grid-template-columns: 44px minmax(0, 1fr); column-gap: 8px; }
      .rail { top: 0; align-self: start; margin: 0 0 0 -8px; padding: 6px 4px; border: 0; border-right: 1px solid var(--gf-border); background: none; }
      :host([embedded]) .rail { top: 0; margin: 0 0 0 -6px; }
      .railed-sheet { min-width: 0; }
      /* With edges: the rail beside the frame, both as high as the pane. */
      :host([edged]) .railed { display: grid; grid-template-rows: minmax(0, 1fr); column-gap: 0; }
      :host([edged]) .rail { margin: 0; padding: 6px 4px; border-right: 1px solid var(--gf-border); }
    }
    @media (prefers-reduced-motion: reduce) { .skeleton { animation: none; } .block[data-flash] { animation: none; } }
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
    // Panels opened on the previous plant stay open on this one (sheet-session.js).
    /** @type {Set<string>} */
    this._subsOpen = sheetSession.subsOpen;
    /** King mode: the map blocks showing their settings. @type {Set<string>} */
    this._mapsOpen = sheetSession.mapsOpen;
    /** @type {string | null} */
    this._maxEdge = sheetSession.maxEdge;
    /** @type {{ safety: any, edible: any } | null} */
    this._alerts = null;
    this._railCol = false;
    this.outerRail = false;
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
    /** @type {import('../core/map-focus.js').SheetFocus} */
    this._focus = noFocus();
    /** @type {{ interactions?: any, niche?: any, here?: any }} */
    this._open = {};
    // A value touched in a block: the maps show it (touched again, it goes).
    this.addEventListener(FOCUS_EVENT, e => {
      e.stopPropagation();
      this._focus = toggleFocus(this._focus, /** @type {CustomEvent} */ (e).detail);
    });
  }

  /** The sheet's height, for the dock (pinned blocks) to fill it. */
  #resize = new ResizeObserver(([entry]) => {
    this.style.setProperty('--host-h', Math.round(entry.contentRect.height + this.#padY()) + 'px');
    const wide = entry.contentRect.width >= 640;
    if (wide !== this._wideSheet) this._wideSheet = wide;
    const col = entry.contentRect.width >= 560;
    if (col !== this._railCol) this._railCol = col;
  });

  #padY() {
    const cs = getComputedStyle(this);
    return parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  }

  connectedCallback() {
    super.connectedCallback();
    this.#resize.observe(this);
    // The sheet scrolls itself, or its middle when edges are used (scroll does not bubble: caught on the way down).
    this.renderRoot.addEventListener('scroll', this.#onScroll, { passive: true, capture: true });
    this.addEventListener('scroll', this.#onScroll, { passive: true });
    this.addEventListener('keydown', this.#onEdgeKey);
    // A menu (position, edge options) closes when touching elsewhere.
    this.renderRoot.addEventListener('pointerdown', this.#closeMenus, { capture: true });
  }

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
    // The panels opened follow to the next plant (not from a preview card, which is not read).
    if (!this.preview && !this.only) {
      if (changed.has('_subsOpen')) sheetSession.subsOpen = this._subsOpen;
      if (changed.has('_mapsOpen')) sheetSession.mapsOpen = this._mapsOpen;
      if (changed.has('_maxEdge')) sheetSession.maxEdge = this._maxEdge;
    }
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
    this.#resize.disconnect();
    this.#abort?.abort();
  }

  /** The page's title: this plant, unless it is only a preview. */
  #title() {
    const plant = this._plant;
    if (!this.preview && !this.only && plant && !plant.failed) document.title = (plant.vernacularNames?.[0] || plant.scientificName) + ' — GeoFlora';
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
    this._focus = noFocus();
    this._open = {};
    this._alerts = null;
    this.#requested.clear();
    this.scrollTop = 0;
    this.#restored = false;

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
    alertsOf(plant).then(a => { if (!abort.signal.aborted) this._alerts = a; }, () => {});

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
    // In a pane: that block's data only.
    const shown = (/** @type {string} */ key) => this.only ? key === this.only : !isHidden(v, key);
    const qid = plant.identifiers?.wikidata || details?.identifiers?.wikidata?.id;
    const settle = (/** @type {Promise<any>} */ task, /** @type {(v: any) => void} */ set) =>
      task.then(v => { if (!signal?.aborted && this._plant === plant) set(v ?? null); })
        .catch(() => { if (!signal?.aborted && this._plant === plant) set(null); });
    const once = (/** @type {string} */ key) => !this.#requested.has(key) && Boolean(this.#requested.add(key));
    if (shown('wikipedia') && once('wiki')) settle(sources.wikipedia(plant, qid, signal, v), x => { this._wiki = x; });
    const science = shown('ids') || (baseOf(v) === 'scientific' && (shown('taxonomy') || shown('status')));
    if (science && once('science')) settle(sources.wikidataScience(plant, qid, signal, v), x => { this._science = x; });
    this.#loadGbif(plant, details, signal, settle, once, shown);
    const putOpen = (/** @type {string} */ k, /** @type {any} */ x) => { this._open = { ...this._open, [k]: x }; };
    if (shown('interactions') && once('globi')) settle(openData.interactions(plant.scientificName, signal, v), x => putOpen('interactions', x));
    const gbifKey = details?.identifiers?.gbif?.id ?? null;
    if (shown('climate') && !isSubHidden(v, 'climate', 'niche') && details !== undefined && once('niche')) {
      if (gbifKey) settle(openData.climateNiche(gbifKey, signal, v), x => putOpen('niche', x)); else putOpen('niche', null);
    }
    // « Usages et cuisine sauvage »: the local safety file first, then Wikidata and Wikibooks.
    if (shown('uses')) {
      if (once('uses:safety')) {
        settle(usesData.safetyOf(plant), x => putOpen('safety', x));
        settle(lookalikesOf(plant).then(list => list.length), x => putOpen('confusions', x || 0));
      }
      const usesQid = plant.identifiers?.wikidata || details?.identifiers?.wikidata?.id;
      if (details !== undefined && once('uses:wikidata')) {
        if (usesQid && moduleOn('wikidata', v)) settle(usesData.wikidataUses(usesQid, signal, v), x => putOpen('wdUses', x)); else putOpen('wdUses', null);
      }
      if (!isSubHidden(v, 'uses', 'kitchen') && once('uses:recipes')) {
        if (moduleOn('wikibooks', v)) settle(usesData.recipes({ french: plant.vernacularNames?.[0] || null, latin: plant.scientificName }, signal), x => putOpen('recipes', x));
        else putOpen('recipes', null);
      }
    }
    // My position already known in this visit: its pollen and climate come with the sheet.
    if (shown('climate') && hereAllowed && once('here')) queueMicrotask(() => this.#findHere());
  }

  /** Pollen and climate at my position (asked once; later sheets of the visit reuse it). */
  async #findHere() {
    const plant = this._plant;
    hereAllowed = true;
    this._open = { ...this._open, here: { state: 'locating' } };
    const known = lastFix();
    const fix = known && Date.now() - known.timestamp < 30 * 60000 ? known : await oneFix();
    if (this._plant !== plant) return;
    if (!fix || 'error' in fix) { this._open = { ...this._open, here: { state: 'error', message: fix && 'error' in fix ? fix.error : 'Position introuvable pour le moment.' } }; return; }
    const point = /** @type {[number, number]} */ (fix.coordinates);
    this._open = { ...this._open, here: { state: 'loading', point } };
    const [pollen, climate] = await Promise.all([
      openData.pollensAt(point).catch(() => null),
      openData.climateAt(point).catch(() => null)
    ]);
    if (this._plant === plant) this._open = { ...this._open, here: { state: 'done', point, pollen, climate } };
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
    if (baseOf(v) === 'scientific' && sub('taxonomy', 'gbifSynonyms')) species('synonyms');
    if (baseOf(v) === 'scientific' && sub('status', 'iucn')) species('iucn', 'iucnRedListCategory');
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
    if (this.only) return this.#onlyBlock(this.only, ctx);
    const pane = this._paneDialog;
    return html`${baseOf(this.view) === 'epure' ? this.#epure(ctx) : this.#full(ctx)}${pane ? html`
      <dialog class="pane" aria-label=${blockTitle(pane.key)} @close=${() => { this._paneDialog = null; }}>
        <div class="pane-bar"><h2>${blockTitle(pane.key)} — <i>${plant.scientificName}</i></h2>
          <button class="icon-btn" type="button" aria-label="Fermer" title="Fermer" @click=${(/** @type {Event} */ e) => /** @type {HTMLElement} */ (e.currentTarget).closest('dialog')?.close()}>${icon('x-lg')}</button></div>
        <gf-plant-detail embedded only=${pane.key} plant-id=${plant.id} view=${this.view} .paneStart=${pane.url}
          @media-close=${(/** @type {Event} */ e) => /** @type {HTMLElement} */ (e.currentTarget).closest('dialog')?.close()}></gf-plant-detail>
      </dialog>` : nothing}`;
  }

  /** One block at full size (a pane): the media viewer fills it, any other block scrolls in it. @param {string} key @param {any} ctx */
  #onlyBlock(key, ctx) {
    if (key === 'media') {
      return ctx.photosOff ? html`<p class="muted only-pad">Photos en ligne désactivées (<a href=${href.settings()}>Réglages › Modules</a>).</p>`
        : html`<gf-media-viewer plant-id=${ctx.plant.id} .view=${this.view} presentation=${blockStyle(this.view, 'media')} .index=${this.paneAt ?? 0} .startUrl=${this.paneStart ?? null}></gf-media-viewer>`;
    }
    return html`<div class="only-pad ${isMap(key) ? 'fill' : ''}"><section class="block only ${isMap(key) ? 'map-block' : ''}" data-key=${key}><div class="content">${this.#content(key, ctx)}</div></section></div>`;
  }

  /**
   * A block in the pane beside the sheet (⤢ on the block, a photo touched for « Médias »). Flore shows it in a
   * pane in place of the results (a phone: over the sheet); elsewhere (Mes plantes, Carte) it opens over the page.
   * @param {string} key @param {string | null} [url] the image to open at
   */
  #openPane(key, url = null) {
    const plant = this._plant;
    if (!plant || this.preview || this.only) return;
    const asked = new CustomEvent('open-pane', { detail: { plantId: plant.id, key, url }, bubbles: true, composed: true, cancelable: true });
    if (!this.dispatchEvent(asked)) return;
    this._paneDialog = { key, url };
    this.updateComplete.then(() => openModal(/** @type {HTMLDialogElement | null} */ (this.renderRoot.querySelector('dialog.pane'))));
  }


  /** A photo touched: the « Médias » viewer at that image, in the pane. @param {Event} e @param {string | null} [url] */
  #openMedia(e, url = null) {
    e.preventDefault();
    this.#openPane('media', url);
  }

  /** « Tous les médias »: the viewer from its first image. */
  #allMedia() {
    return html`<button class="link all-media" type="button" @click=${(/** @type {Event} */ e) => this.#openMedia(e)}>${icon('images')} Tous les médias</button>`;
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
      ${baseOf(this.view) === 'epure' ? html`<p class="meta">${plant.family}</p>` : nothing}`;
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
            <a href=${image.sourceUrl || image.pageUrl || image.url} title="Voir en grand (Médias)" @click=${(/** @type {Event} */ e) => this.#openMedia(e, image.url)}>
              <img src=${image.url} alt=${plant.scientificName} loading="lazy" decoding="async" referrerpolicy="no-referrer" />
            </a>
            <figcaption><gf-attribution .media=${image}></gf-attribution></figcaption>
          </figure>`)}
      </div>${this.#allMedia()}` : loading ? html`<div class="skeleton"></div>` : html`<p class="muted">Aucune photo sous licence libre trouvée.</p>`;
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
    // Blocks stuck to an edge are there, not in the flow.
    // Outside « Mode King », folded blocks are not there at all.
    // Outside it too, a block with nothing for this plant (no other name, no Wikipédia article).
    // Blocks placed beside the sheet: a button each (Mode King: in the flow, to arrange them).
    const keys = blockOrder(this.view).filter(k => !isOnEdge(this.view, k) && (king || placeOf(this.view, k) !== 'beside') && this.#visible(k, ctx));
    const beside = king ? [] : blocksAt(this.view, 'beside').filter(k => this.#visible(k, ctx));
    return html`${beside.length ? html`<div class="paned">${icon('arrows-angle-expand')} À côté :
        ${beside.map(k => html`<button type="button" @click=${() => this.#openPane(k)}>${blockTitle(k)}</button>`)}</div>` : nothing}
      <div class="blocks ${king ? 'king' : ''} ${sorting ? 'sorting' : ''}">${repeat(keys, k => k, k =>
      king ? this.#block(k, ctx, sorting ? order.indexOf(k) : null) : this.#plainBlock(k, ctx))}</div>
      ${king && !sorting ? this.#newNote() : nothing}`;
  }

  /** Shown here: everything in Mode King; outside it, not folded, not left out for being empty. @param {string} k @param {any} ctx */
  #visible(k, ctx) {
    return this.#store.state.kingMode || (!isHidden(this.view, k) && !(hidesEmpty(this.view, k) && this.#emptyHere(k, ctx)));
  }

  /** The blocks shown on an edge, in order. @param {any} ctx @param {import('../core/sheet-blocks.js').Edge} edge */
  #edgeBlocks(ctx, edge) {
    return blocksAt(this.view, edge).filter(k => this.#visible(k, ctx));
  }

  /** Does the sheet show a map (in the flow or pinned)? Its data can then be touched to show on it. */
  get #hasMap() {
    return blockOrder(this.view).some(k => isMap(k) && !isHidden(this.view, k));
  }

  /** Icons and names of the places a block can take. */
  static PLACE_INFO = /** @type {Record<string, [string, import('../core/icons.js').IconName]>} */ ({
    sheet: ['Dans la fiche', 'list-ul'], top: ['En haut', 'chevron-up'], left: ['À gauche', 'chevron-bar-left'],
    right: ['À droite', 'chevron-bar-right'], bottom: ['En bas', 'chevron-down'], beside: ['À côté de la fiche', 'arrows-angle-expand']
  });

  /**
   * Mode King: where a block sits — in the sheet, stuck to an edge of the plant pane, or beside it.
   * A cross of buttons: ↑ ← fiche → ↓, and « À côté ».
   * @param {string} key
   */
  #placePicker(key) {
    const title = blockTitle(key);
    const now = placeOf(this.view, key) || 'sheet';
    const info = GfPlantDetail.PLACE_INFO;
    const pick = (/** @type {Event} */ e, /** @type {string} */ place) => {
      /** @type {HTMLDetailsElement | null} */ ((/** @type {HTMLElement} */ (e.currentTarget)).closest('details'))?.removeAttribute('open');
      setPlace(this.view, key, place === 'sheet' ? null : /** @type {any} */ (place));
    };
    const cell = (/** @type {string} */ place) => html`<button type="button" class="p-${place}" aria-pressed=${now === place ? 'true' : 'false'}
      title=${info[place][0]} aria-label=${`« ${title} » : ${info[place][0].toLowerCase()}`} @click=${(/** @type {Event} */ e) => pick(e, place)}>${icon(info[place][1])}</button>`;
    return html`<details class="place-pick" @keydown=${(/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') { e.stopPropagation(); /** @type {HTMLDetailsElement} */ (e.currentTarget).removeAttribute('open'); } }}>
      <summary class="tool" title=${'Position : ' + info[now][0].toLowerCase()} aria-label=${`Position de « ${title} » : ${info[now][0].toLowerCase()}`}>${icon(info[now][1])}</summary>
      <div class="place-grid" role="group" aria-label=${'Position de « ' + title + ' »'}>
        ${cell('top')}${cell('left')}${cell('sheet')}${cell('right')}${cell('bottom')}${cell('beside')}
      </div>
    </details>`;
  }

  /**
   * An edge of the plant pane: its blocks (tabs when several), sized S / M / L or dragged, foldable to its bar,
   * across the whole pane or not (bands), without title or frame, shown over the whole pane for a while.
   * @param {any} ctx @param {import('../core/sheet-blocks.js').Edge} edge @param {string[]} keys @param {boolean} wide
   */
  #edge(ctx, edge, keys, wide) {
    const king = this.#store.state.kingMode;
    const st = edgeState(this.view, edge);
    const tab = keys.includes(/** @type {string} */ (st.tab)) ? /** @type {string} */ (st.tab) : keys[0];
    const column = wide && (edge === 'left' || edge === 'right');
    const max = this._maxEdge === edge;
    const bare = st.bare && !king && !max;
    const names = { s: 'Petit', m: 'Moyen', l: 'Grand' };
    const where = GfPlantDetail.PLACE_INFO[edge][0].toLowerCase();
    const f = { s: 0.3, m: 0.45, l: 0.6 }[st.size], cw = { s: 34, m: 45, l: 58 }[st.size];
    // Bands share the height with the sheet, which keeps at least 220 px between them.
    const room = 'calc((var(--host-h, 80vh) - 220px) / var(--bands, 1))';
    const size = st.folded || max ? '' : column ? `width:${st.px ? `min(${st.px}px, 80cqw)` : cw + 'cqw'}`
      : `height:min(${st.px ? st.px + 'px' : `calc(var(--host-h, 80vh) * ${f})`}, ${room})`;
    const tabs = html`<span class="edge-tabs" role="tablist" aria-label=${'Blocs ' + where}>${keys.map(k => html`<button type="button" role="tab"
      aria-selected=${k === tab ? 'true' : 'false'} title=${blockTitle(k)} @click=${() => setEdgeState(this.view, edge, { tab: k, folded: false })}>
      ${icon(categoryOf(blockCategory(k)).icon)}<span class="tab-name">${blockTitle(k)}</span></button>`)}</span>`;
    return html`<aside class="edge ${column ? 'col' : 'band'} ${st.folded && !max ? 'folded' : ''} ${bare ? 'bare' : ''} ${max ? 'max' : ''} ${king ? 'king' : ''}"
        data-edge=${edge} style=${size} aria-label=${'Volet ' + where}>
      ${bare ? html`<div class="edge-float">${keys.length > 1 ? tabs : nothing}
          <button class="edge-btn" type="button" title="Agrandir à tout le panneau" aria-label=${'Agrandir le volet ' + where} @click=${() => { this._maxEdge = edge; }}>${icon('arrows-fullscreen')}</button></div>`
        : html`<div class="edge-bar">
        ${tabs}
        ${king ? this.#placePicker(tab) : nothing}
        ${st.folded && !max ? nothing : html`<span class="edge-sizes" role="group" aria-label=${'Taille du volet ' + where}>${EDGE_SIZES.map(z => html`<button type="button"
          aria-pressed=${z === st.size && !st.px ? 'true' : 'false'} title=${'Volet ' + names[z].toLowerCase()} aria-label=${'Volet ' + where + ' ' + names[z].toLowerCase()}
          @click=${() => setEdgeState(this.view, edge, { size: z, folded: false })}>${z.toUpperCase()}</button>`)}</span>
        <details class="edge-opts">
          <summary class="edge-btn" title="Options d’affichage" aria-label=${'Options d’affichage du volet ' + where}>${icon('gear')}</summary>
          <div class="opts-pop">
            ${column ? nothing : html`<label><input type="checkbox" .checked=${st.full} @change=${(/** @type {any} */ e) => setEdgeState(this.view, edge, { full: e.target.checked })} /> Pleine largeur du panneau</label>`}
            <label><input type="checkbox" .checked=${st.bare} @change=${(/** @type {any} */ e) => setEdgeState(this.view, edge, { bare: e.target.checked })} /> Sans titre ni cadre</label>
            <label><input type="checkbox" .checked=${st.folded} @change=${(/** @type {any} */ e) => setEdgeState(this.view, edge, { folded: e.target.checked })} /> Replié (s’ouvre au toucher)</label>
            ${st.px ? html`<button type="button" class="link" @click=${() => setEdgeState(this.view, edge, { size: st.size })}>Taille ${st.size.toUpperCase()} (oublier la taille tirée)</button>` : nothing}
          </div>
        </details>`}
        <button class="edge-btn" type="button" title=${max ? 'Remettre à sa place (Échap)' : 'Agrandir à tout le panneau'}
          aria-label=${(max ? 'Remettre le volet ' : 'Agrandir le volet ') + where} @click=${() => { this._maxEdge = max ? null : edge; }}>${icon(max ? 'fullscreen-exit' : 'arrows-fullscreen')}</button>
        ${max ? nothing : html`<button class="edge-btn" type="button" aria-expanded=${st.folded ? 'false' : 'true'} aria-label=${(st.folded ? 'Déplier le volet ' : 'Replier le volet ') + where}
          @click=${() => setEdgeState(this.view, edge, { folded: !st.folded })}>${icon(st.folded ? (edge === 'bottom' ? 'chevron-up' : 'chevron-down') : (edge === 'bottom' ? 'chevron-down' : 'chevron-up'))}</button>`}
      </div>`}
      ${st.folded && !max ? nothing : html`<div class="edge-body">${repeat([tab], k => k, k => king ? this.#block(k, ctx, null) : this.#plainBlock(k, ctx))}</div>`}
      ${st.folded || max || bare ? nothing : html`<div class="edge-grip" role="separator" aria-orientation=${column ? 'vertical' : 'horizontal'} aria-label=${'Taille du volet ' + where}
        title="Tirer pour changer la taille" @pointerdown=${(/** @type {PointerEvent} */ e) => this.#gripDown(e, edge, column)}></div>`}
    </aside>`;
  }

  /** Dragging an edge's border: its own size, kept for the mode. @param {PointerEvent} e @param {import('../core/sheet-blocks.js').Edge} edge @param {boolean} column */
  #gripDown(e, edge, column) {
    const grip = /** @type {HTMLElement} */ (e.currentTarget);
    const el = /** @type {HTMLElement} */ (grip.closest('.edge'));
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const start = column ? e.clientX : e.clientY;
    const size0 = column ? el.getBoundingClientRect().width : el.getBoundingClientRect().height;
    const sign = edge === 'right' || edge === 'bottom' ? -1 : 1;
    let px = size0;
    const move = (/** @type {PointerEvent} */ ev) => {
      px = Math.max(80, size0 + sign * ((column ? ev.clientX : ev.clientY) - start));
      el.style.setProperty(column ? 'width' : 'height', px + 'px');
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      if (Math.abs(px - size0) > 2) setEdgeState(this.view, edge, { px: Math.round(px) });
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  }

  /** The sheet, with the side rail of categories and the dock of pinned blocks when there are some. @param {any} ctx @param {unknown} article */
  #layout(ctx, article) {
    const rail = this.#rail(ctx);
    const sheet = this.#docked(ctx, article);
    return rail === nothing ? sheet : html`<div class="railed">${rail}<div class="railed-sheet">${sheet}</div></div>`;
  }

  // ── Side rail: the categories of the sheet's blocks, one icon each ─────────────────────────────────────

  /** The blocks of the sheet a category leads to, in order (flow, pinned, in the pane). @param {any} ctx @param {string} cat */
  #categoryBlocks(ctx, cat) {
    return blockOrder(this.view).filter(k => blockCategory(k) === cat && k !== 'name' && this.#visible(k, ctx) && !isHidden(this.view, k));
  }

  /**
   * The rubrics of the sheet (categories with blocks shown), their blocks and alerts: for the rail, here or in
   * the host's header. @param {any} ctx @returns {import('./gf-sheet-rail.js').RailItem[]}
   */
  #railItems(ctx) {
    const usesCat = blockCategory('uses');
    const items = CATEGORIES.map(c => ({
      key: c.key, label: c.label, question: c.question, icon: c.icon,
      blocks: this.#categoryBlocks(ctx, c.key).map(k => ({ key: k, title: blockTitle(k), note: placeOf(this.view, k) ? GfPlantDetail.PLACE_INFO[/** @type {string} */ (placeOf(this.view, k))][0].toLowerCase() : undefined })),
      badge: c.key === 'safety' ? this._alerts?.safety : c.key === usesCat ? this._alerts?.edible : null
    })).filter(c => c.blocks.length);
    return items.length < 2 ? [] : items;
  }

  /** The rubrics, beside or above the sheet (or told to the host, which shows them in its header). @param {any} ctx */
  #rail(ctx) {
    if (this.preview || this.only) return nothing;
    const items = this.#railItems(ctx);
    if (this.outerRail) { this.#railOut = items; return nothing; }
    if (!items.length) return nothing;
    return html`<div class="rail"><gf-sheet-rail .items=${items} .active=${this._activeCat} orientation=${this._railCol ? 'column' : 'row'}
      @rail-go=${(/** @type {CustomEvent} */ e) => this.goTo(e.detail.key)}></gf-sheet-rail></div>`;
  }
  /** @type {any[] | null} */ #railOut = null;
  /** @type {string} */ #railSent = '';

  /** Tells the host the rubrics (and the one read), when they change. */
  #sendRail() {
    if (!this.outerRail || this.preview || this.only || !this.#railOut) return;
    const items = this.#railOut, active = this._activeCat;
    const sig = JSON.stringify([items, active]);
    if (sig === this.#railSent) return;
    this.#railSent = sig;
    this.dispatchEvent(new CustomEvent('sheet-rail', { detail: { items, active, plantId: this.plantId }, bubbles: true, composed: true }));
  }

  /** To a rubric's block, asked by the host's rail. @param {string} key */
  goTo(key) {
    sheetSession.anchor = blockCategory(key);
    return this.#goTo(key);
  }

  /** To a block: its place in the sheet, the dock (unfolded) or the pane. @param {string} key @param {{ instant?: boolean }} [opts] */
  async #goTo(key, { instant = false } = {}) {
    const king = this.#store.state.kingMode;
    const place = placeOf(this.view, key);
    if (!king && place === 'beside') { this.#openPane(key); return; }
    // On an edge: its tab, unfolded.
    if (place && place !== 'beside') setEdgeState(this.view, place, { tab: key, folded: false });
    await this.updateComplete;
    const section = /** @type {HTMLElement | null} */ (this.renderRoot.querySelector(`.block[data-key="${CSS.escape(key)}"]`));
    if (!section) return;
    if (instant) {
      section.scrollIntoView({ behavior: 'auto', block: 'start' });
      this._activeCat = blockCategory(key);
      return;
    }
    section.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    // An attribute, not a class: the block's class is the template's, rewritten on the next render.
    section.removeAttribute('data-flash');
    void section.offsetWidth;
    section.setAttribute('data-flash', '');
    setTimeout(() => section.removeAttribute('data-flash'), 1300);
    this._activeCat = blockCategory(key);
  }

  /** The block at the top of the sheet: its category lights up in the rail (and is kept for the next plant). */
  #onScroll = () => {
    if (this.#scrollFrame) return;
    this.#scrollFrame = requestAnimationFrame(() => {
      this.#scrollFrame = 0;
      let current = null;
      const scroller = this.#sheetScroller;
      if (this.#restoring) return;
      const top = scroller.getBoundingClientRect().top + 72;
      for (const el of /** @type {NodeListOf<HTMLElement>} */ (this.renderRoot.querySelectorAll('.blocks > .block'))) {
        if (el.getBoundingClientRect().top <= top) current = el.dataset.key; else break;
      }
      const cat = current ? blockCategory(current) : null;
      if (cat !== this._activeCat) this._activeCat = cat;
      // Read by the user: the next plant opens at the same rubric (the top: from the top).
      if (!this.preview && !this.only && this._plant) sheetSession.anchor = scroller.scrollTop < 40 ? null : cat;
    });
  };
  #scrollFrame = 0;

  /** The sheet's scrolling part: its middle when it has edges, else itself. */
  get #sheetScroller() { return /** @type {HTMLElement} */ (this.renderRoot.querySelector('.frame.edged > .main') || this); }

  /**
   * A new plant opens at the rubric read on the previous one; while its blocks come in (and grow), it stays
   * there — until the user scrolls, or after 2.5 s.
   */
  async #restoreAnchor() {
    const cat = sheetSession.anchor;
    if (!cat || this.preview || this.only) return;
    await this.updateComplete;
    // The rubric's first block in the sheet's flow (on an edge or in the pane, it is already in view).
    const first = () => /** @type {HTMLElement | undefined} */ ([...this.renderRoot.querySelectorAll('.blocks > .block')]
      .find(el => blockCategory(/** @type {HTMLElement} */ (el).dataset.key || '') === cat));
    if (!first()) return;
    this.#restoring = true;
    const scroller = this.#sheetScroller;
    const pin = () => first()?.scrollIntoView({ behavior: 'auto', block: 'start' });
    pin();
    this._activeCat = cat;
    const body = this.renderRoot.querySelector('article') || scroller;
    const grow = new ResizeObserver(() => pin());
    grow.observe(body);
    const stop = () => {
      grow.disconnect();
      clearTimeout(timer);
      for (const ev of ['wheel', 'touchstart', 'keydown', 'pointerdown']) scroller.removeEventListener(ev, stop);
      requestAnimationFrame(() => { this.#restoring = false; });
    };
    const timer = setTimeout(stop, 2500);
    for (const ev of ['wheel', 'touchstart', 'keydown', 'pointerdown']) scroller.addEventListener(ev, stop, { passive: true, once: true });
  }
  #restoring = false;
  #restored = false;

  /**
   * The sheet, with its edges when blocks are stuck to them: a grid — top band, left column, the sheet,
   * right column, bottom band — the sheet alone scrolling between them. A band « across the whole pane » runs
   * over the columns. On a narrow sheet the columns are bands at the top.
   * @param {any} ctx @param {unknown} article
   */
  #docked(ctx, article) {
    const wide = this._wideSheet !== false;
    /** @type {Record<string, string[]>} */
    const at = {};
    for (const edge of /** @type {const} */ (['top', 'left', 'right', 'bottom'])) { const keys = this.#edgeBlocks(ctx, edge); if (keys.length) at[edge] = keys; }
    const edges = /** @type {import('../core/sheet-blocks.js').Edge[]} */ (Object.keys(at));
    if (!edges.length) return html`${article}${this.#actionBar(ctx.plant)}`;
    /** @type {string[][]} */
    let rows;
    let cols, heights;
    if (wide) {
      const line = [...(at.left ? ['left'] : []), 'main', ...(at.right ? ['right'] : [])];
      const band = (/** @type {'top' | 'bottom'} */ e) => line.map(c => c === 'main' || edgeState(this.view, e).full ? e : c);
      rows = [...(at.top ? [band('top')] : []), line, ...(at.bottom ? [band('bottom')] : [])];
      cols = line.map(c => c === 'main' ? 'minmax(0, 1fr)' : 'auto').join(' ');
      heights = [...(at.top ? ['auto'] : []), 'minmax(0, 1fr)', ...(at.bottom ? ['auto'] : [])].join(' ');
    } else {
      const order = ['top', 'left', 'right', 'main', 'bottom'].filter(e => e === 'main' || at[e]);
      rows = order.map(e => [e]);
      cols = 'minmax(0, 1fr)';
      heights = order.map(e => e === 'main' ? 'minmax(0, 1fr)' : 'auto').join(' ');
    }
    const areas = rows.map(r => `"${r.join(' ')}"`).join(' ');
    // Bands unfolded (the columns too on a narrow sheet): they share the height left to the sheet.
    const bands = edges.filter(e => (!wide || e === 'top' || e === 'bottom') && !edgeState(this.view, e).folded).length || 1;
    return html`<div class="frame edged ${this._maxEdge ? 'maxed' : ''}" style=${`--bands:${bands};grid-template-areas:${areas};grid-template-columns:${cols};grid-template-rows:${heights}`}>
      <div class="main">${article}${this.#actionBar(ctx.plant)}</div>
      ${edges.map(edge => this.#edge(ctx, edge, at[edge], wide))}
    </div>`;
  }

  updated() {
    // The sheet scrolls in its middle when it has edges: the host itself does not.
    this.toggleAttribute('edged', Boolean(this.renderRoot.querySelector('.frame.edged')));
    this.#sendRail();
    // The plant is drawn (and read, not a card waiting underneath): at the rubric read on the previous one.
    if (!this.#restored && this._plant && !this._plant.failed && !this.preview && !this.only) { this.#restored = true; this.#restoreAnchor(); }
  }

  /** A block read without its title (Mode King › title on/off, per view). @param {string} key */
  #headless = key => !isTitleShown(this.view, key);

  /** A block as read outside « Mode King »: its title, its content. @param {string} key @param {any} ctx */
  #plainBlock(key, ctx) {
    // A component that hides itself when it has nothing (protection, look-alikes, calendar): the block goes with it (CSS).
    const headless = this.#headless(key);
    return html`<section class="block ${headless ? 'headless' : ''} ${hidesEmpty(this.view, key) ? 'hide-empty' : ''} ${isMap(key) ? 'map-block' : ''}" data-key=${key}>
      ${headless ? this.#paneButton(key) : html`<h2 class="block-title"><span class="name">${blockTitle(key)}</span>${this.#paneButton(key)}</h2>`}
      <div class="content">${this.inPane === key ? this.#shownInPane(key) : this.#content(key, ctx)}</div>
    </section>`;
  }

  /** A block open in the pane beside: a line saying so (and bringing it back). @param {string} key */
  #shownInPane(key) {
    return html`<p class="muted in-pane">${icon('arrows-angle-expand')} « ${blockTitle(key)} » affiché dans le volet, à côté.</p>`;
  }

  /** Blocks that make no sense alone in a pane. */
  static NO_PANE = ['name', 'actions', 'media'];

  /** ⤢ on a block: open it in the pane beside the sheet. @param {string} key */
  #paneButton(key) {
    if (this.preview || GfPlantDetail.NO_PANE.includes(key) || isNote(key)) return nothing;
    return html`<button class="icon-btn to-pane" type="button" title="Ouvrir en volet, à côté de la fiche" aria-label=${`Ouvrir « ${blockTitle(key)} » en volet`}
      @click=${() => this.#openPane(key)}>${icon('arrows-angle-expand')}</button>`;
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
    return html`<section class="block ${off ? 'off' : ''} ${dragging ? 'dragging' : ''} ${titled ? '' : 'untitled'} ${isMap(key) ? 'map-block' : ''}" data-key=${key} style=${style}>
      <h2 class="block-title" title="Glisser pour déplacer" @pointerdown=${e => this.#press(e, key)}>
        <button class="grip" type="button" aria-label="Déplacer le bloc « ${title} »" title="Glisser pour déplacer (↑ ↓ au clavier)"
          @keydown=${e => this.#gripKey(e, key)}>${icon('grip-vertical')}</button>
        ${this._renaming === key
          ? html`<input class="rename" aria-label="Nouveau nom du bloc « ${title} »" .value=${title} maxlength="60"
              @keydown=${e => { if (e.key === 'Enter') this.#rename(key, e.target.value); else if (e.key === 'Escape') this._renaming = null; }}
              @blur=${e => this.#rename(key, e.target.value)} />`
          : html`<span class="name">${title}</span>`}
        <span class="cat" title=${categoryOf(blockCategory(key)).question}>${categoryOf(blockCategory(key)).label}</span>
        ${off && module ? html`<small class="off-note">module ${module} désactivé dans ce mode</small>` : nothing}
        <button class="tool" type="button" aria-pressed=${titled ? 'true' : 'false'} aria-label=${(titled ? 'Masquer' : 'Montrer') + ` le titre « ${title} » hors mode King`}
          title=${titled ? 'Titre affiché (toucher pour le cacher)' : 'Titre caché hors mode King (toucher pour l’afficher)'}
          @click=${() => setTitleShown(this.view, key, !titled)}>${icon('type-h2')}</button>
        ${canBeEmpty(key) ? html`<button class="tool" type="button" aria-pressed=${hidesEmpty(this.view, key) ? 'true' : 'false'}
          aria-label=${hidesEmpty(this.view, key) ? `Afficher « ${title} » même vide, hors mode King` : `Ne pas afficher « ${title} » s’il est vide, hors mode King`}
          title=${hidesEmpty(this.view, key) ? 'Masqué quand il est vide (toucher pour l’afficher quand même)' : 'Affiché même vide (toucher pour le masquer quand il est vide)'}
          @click=${() => setHidesEmpty(this.view, key, !hidesEmpty(this.view, key))}>${icon('eye-slash')}</button>` : nothing}
        ${GfPlantDetail.NO_PANE.includes(key) && key !== 'media' ? nothing : this.#placePicker(key)}
        ${this._renaming === key ? nothing : html`<button class="tool" type="button" aria-label="Renommer le bloc « ${title} »" title=${isNote(key) ? 'Renommer' : 'Renommer (vide : nom d’origine)'}
          @click=${() => this.#startRename(key)}>${icon('pencil')}</button>`}
        ${STYLES[key] && !off ? html`<span class="styles" role="group" aria-label="Style du bloc « ${title} »">${STYLES[key].styles.map(st => html`
          <button type="button" aria-pressed=${blockStyle(this.view, key) === st.key ? 'true' : 'false'} title=${'Style : ' + st.title}
            @click=${() => setBlockStyle(this.view, key, st.key)}>${icon(/** @type {any} */ ({ list: 'list-ul', graph: 'diagram-3', scene: 'image', mosaic: 'images', slideshow: 'arrows-fullscreen' })[st.key] || 'table')} ${st.title}</button>`)}</span>` : nothing}
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
        }}>${icon('plus-lg')} Bloc Carte</button>
        <button type="button" title="Les blocs d’une même catégorie ensemble (Noms, Images, Savoirs…), dans ce mode"
          @click=${() => orderByCategory(this.view, k => CATEGORIES.findIndex(c => c.key === blockCategory(k)))}>${icon('list-nested')} Ranger par catégorie</button></p>`;
  }

  /**
   * A « Carte » block: the map component, set up as configured (the card under a swiped one shows a
   * placeholder rather than a second map). @param {string} key @param {any} ctx
   */
  #map(key, { plant, details, inat }) {
    const config = mapConfig(key);
    // Pinned, or alone in a pane: the map fills the room.
    const fill = isOnEdge(this.view, key) || this.only === key;
    if (this.preview) return html`<div class="map-placeholder ${fill ? 'fill' : ''}" style=${`height:${{ s: 180, m: 260, l: 380 }[config.height]}px`}></div>`;
    return html`<gf-sheet-map .plant=${plant} .gbifKey=${details?.identifiers?.gbif?.id ?? null} .inatId=${inat?.id ?? null}
      .config=${config} mode=${this.view} ?fill=${fill} .focus=${this._focus}
      @focus-clear=${(/** @type {CustomEvent} */ e) => { this._focus = { ...this._focus, [e.detail.kind]: null }; }}
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
  /** Names separated by a light dot. @param {string[]} names */
  #nameList(names) {
    return names.map((n, i) => html`${i ? html`<span class="sep" aria-hidden="true">·</span>` : nothing}${n}`);
  }

  #otherFrench({ plant, name }) {
    return dedupNames([...(plant.vernacularNames || []), ...gbifFrenchNames(plant, this._gbif)], [name]);
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
      case 'media': return ctx.photosOff || (!ctx.loading && !ctx.images.length && loaded(this._gbif.photos) && !this._gbif.photos?.length);
      // Épuré and Standard: the component hides itself when empty (CSS, see .hide-empty).
      case 'status': return baseOf(v) === 'scientific' && !ctx.plant.statuses?.length && loaded(this._science) && !this._science?.iucn && loaded(g.iucn) && !g.iucn?.code;
      case 'mine': return !(getMembership().byPlant.get(ctx.plant.id) || []).length;
      case 'descriptions': return loaded(g.descriptions) && !descriptions(g).filter(row => baseOf(v) === 'scientific' || /^(fra|fre|fr)$/.test(row.language || '')).length;
      case 'occurrences': return !ctx.loading && !ctx.details?.identifiers?.gbif?.id && !ctx.inat?.observationsCount;
      case 'gbifMedia': return ctx.photosOff || shownSubs(v, 'gbifMedia').every(k => loaded(g[k]) && !g[k]?.length);
      case 'gbifProfile': { const p = profile(g); return !p.habitats.length && !p.forms.length && !p.invasive.length; }
      case 'literature': return !g.literature?.items?.length;
      case 'interactions': return loaded(this._open.interactions) && !this._open.interactions?.roles?.length;
      case 'uses': { const o = this._open; return loaded(o.safety) && !o.safety && !o.confusions && loaded(o.wdUses) && !o.wdUses?.uses?.length && !o.wdUses?.products?.length && !o.wdUses?.dishes?.length && !o.recipes?.length && !this.#danger(ctx.plant).length; }
      case 'climate': return !openData.pollenOf(ctx.plant) && loaded(this._open.niche) && !this._open.niche?.points?.length;
      case 'trefle': return !ctx.loading && !trefleFacts(ctx.details).length;
      default: return false;
    }
  }


  /** The Noms block has nothing to show here. @param {any} ctx */
  #namesEmpty(ctx) {
    if (this.#otherFrench(ctx).length) return false;
    return blockStyle(this.view, 'names') === 'list' || baseOf(this.view) !== 'scientific' || !otherNames(this._gbif).length;
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
      case 'media':
        return ctx.photosOff ? html`<p class="muted">Photos en ligne désactivées (<a href=${href.settings()}>Réglages › Modules</a>).</p>`
          // In the sheet: compact; stuck to an edge: the full viewer, filling it (its keys only when it has the focus).
          : html`<gf-media-viewer ?compact=${!isOnEdge(this.view, 'media')} ?local=${isOnEdge(this.view, 'media')} plant-id=${plant.id} .view=${this.view}
            presentation=${blockStyle(this.view, 'media')} .label=${isTitleShown(this.view, 'media') ? null : blockTitle('media')}
            @open-pane=${(/** @type {CustomEvent} */ e) => { e.stopPropagation(); this.#openPane('media', e.detail.url); }}></gf-media-viewer>`;
      case 'photos': {
        if (baseOf(v) !== 'epure') return this.#gallery(ctx, baseOf(v) === 'standard' ? 6 : Infinity);
        const hero = ctx.images[0];
        return html`<figure class="hero">
          ${hero ? html`<a href=${hero.sourceUrl || hero.url} title="Voir en grand (Médias)" @click=${(/** @type {Event} */ e) => this.#openMedia(e, hero.url)}><img src=${hero.url} alt=${plant.scientificName} decoding="async" referrerpolicy="no-referrer" /></a>
            <figcaption><gf-attribution .media=${hero}></gf-attribution></figcaption>`
            : html`<div class=${loading ? 'skeleton' : 'no-photo'} aria-hidden="true">${loading ? '' : icon('flower1')}</div>`}
        </figure>`;
      }
      case 'status':
        return baseOf(v) === 'scientific' ? this.#statuses(ctx)
          : html`<gf-status .plant=${plant}></gf-status>${ifEmpty('Aucune protection, réglementation ni liste rouge connue (INPN).')}`;
      case 'lookalikes':
        return html`<gf-lookalikes .plant=${plant} ?compact=${baseOf(v) === 'epure'} ?detailed=${baseOf(v) === 'scientific'} ?map-linked=${this.#hasMap} .focus=${this._focus}></gf-lookalikes>
          ${ifEmpty('Aucune confusion signalée par l’Anses et les Centres antipoison.')}`;
      case 'taxonomy': return baseOf(v) === 'scientific' ? this.#taxonomy(ctx) : this.#tags(ctx);
      case 'mine': {
        if (baseOf(v) === 'scientific') return html`<gf-plant-spots plant-id=${plant.id} notitle ?map-linked=${this.#hasMap} .focus=${this._focus}></gf-plant-spots>`;
        const count = (getMembership().byPlant.get(plant.id) || []).length;
        return html`
          <div class="mine">
            <span>${count ? `Dans ${count} de mes collections` : 'Dans aucune de mes collections'}</span>
            <button class="link" type="button" aria-expanded=${this._spotsOpen ? 'true' : 'false'}
              @click=${() => { this._spotsOpen = !this._spotsOpen; }}>${this._spotsOpen ? 'Masquer' : count ? 'Voir' : 'Lieux'}</button>
          </div>
          ${this._spotsOpen ? html`<gf-plant-spots plant-id=${plant.id} notitle ?map-linked=${this.#hasMap} .focus=${this._focus}></gf-plant-spots>` : nothing}`;
      }
      case 'calendar':
        return html`<gf-calendar .plant=${plant} mode=${v} notitle></gf-calendar>${ifEmpty('Aucune période de floraison ni d’observation connue.')}`;
      case 'wikipedia':
        return this._wiki ? this.#wikipedia() : this._wiki === undefined ? pending : empty('Pas d’article Wikipédia en français trouvé.');
      case 'descriptions': {
        const texts = descriptions(this._gbif).filter(row => baseOf(v) === 'scientific' || /^(fra|fre|fr)$/.test(row.language || ''));
        return texts.length
          ? texts.map(row => html`<div class="description"><small>${row.type || 'Description'}${row.source ? ' — ' + row.source : ''} · ${row.language} · GBIF</small>${row.text}</div>`)
          : this._gbif.descriptions === undefined ? pending : empty(baseOf(v) === 'scientific' ? 'Aucune description sur GBIF.' : 'Aucune description en français sur GBIF.');
      }
      case 'names': {
        const names = this.#otherFrench(ctx);
        const foreign = baseOf(v) === 'scientific' ? otherNames(this._gbif) : [];
        if (!names.length && !foreign.length) return this._gbif.vernacularNames === undefined ? pending : empty('Aucun autre nom français connu.');
        // « Liste » (Épuré's default): just the French names.
        if (blockStyle(v, 'names') === 'list') return shownSubs(v, 'names').includes('french') && names.length ? html`<p class="names-list">${this.#nameList(names)}</p>` : nothing;
        return html`<dl class="facts">${this.#subs('names', {
          french: () => names.length ? html`<dt>Autres noms français</dt><dd class="names">${this.#nameList(names)}</dd>` : nothing,
          foreign: () => foreign.length ? html`<dt>Autres langues (GBIF)</dt><dd class="names">${foreign.map(([lang, list]) => html`<span class="lang">${lang || '?'}</span> ${this.#nameList(/** @type {string[]} */ (list))} `)}</dd>` : nothing
        })}</dl>
        <p class="credit">Sources : TAXREF v18 · GBIF.</p>`;
      }
      case 'occurrences': return this.#occurrences(ctx);
      case 'gbifMedia': return this.#gbifMedia(ctx);
      case 'gbifProfile': return this.#gbifProfile();
      case 'literature': return this.#literature(ctx);
      case 'interactions': return this.#interactions(ctx);
      case 'climate': return this.#climate(ctx);
      case 'uses': return this.#uses(ctx);
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

  /**
   * A value of the sheet that shows on its maps when touched (map-focus.js): a button when the sheet has a
   * map, plain text otherwise. @param {import('../core/map-focus.js').MapFocus} f @param {unknown} content @param {string} [cls]
   */
  #focusable(f, content, cls = '') {
    if (!this.#hasMap) return content;
    const on = isFocused(this._focus, f);
    return html`<button type="button" class="focusable ${cls}" aria-pressed=${on ? 'true' : 'false'}
      title=${on ? 'Retirer de la carte' : 'Voir sur la carte de la fiche'} @click=${() => this.#focusOn(f)}>${content}</button>`;
  }

  /** Shows a value on the maps (or takes it off); a map out of sight comes into view. @param {import('../core/map-focus.js').MapFocus} f */
  async #focusOn(f) {
    this._focus = toggleFocus(this._focus, f);
    if (!isFocused(this._focus, f)) return;
    await this.updateComplete;
    const maps = [...this.renderRoot.querySelectorAll('gf-sheet-map')];
    const box = this.getBoundingClientRect();
    const seen = maps.some(m => { const r = m.getBoundingClientRect(); return r.height && r.bottom > box.top + 20 && r.top < box.bottom - 20; });
    if (!seen) maps[0]?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  /**
   * Counts as a table (value, occurrences, share with a small bar) or as a list, as the block's style says.
   * @param {string} head @param {{ label: unknown, count: number }[]} rows @param {number} total
   */
  #counts(head, rows, total) {
    if (blockStyle(this.view, 'occurrences') === 'list') return html`<ul class="counts">${rows.map(r => html`
      <li>${r.label}<b>${r.count.toLocaleString('fr-FR')}</b><small>${percent(r.count, total)}</small></li>`)}</ul>`;
    const max = Math.max(1, ...rows.map(r => r.count));
    return html`<table class="data counts-table">
      <thead><tr><th scope="col">${head}</th><th scope="col" class="num">Occurrences</th><th scope="col" class="num">Part</th></tr></thead>
      <tbody>${rows.map(r => html`<tr><td>${r.label}</td><td class="num">${r.count.toLocaleString('fr-FR')}</td>
        <td class="num pct"><span class="meter" aria-hidden="true"><i style=${`width:${Math.round(r.count / max * 100)}%`}></i></span>${percent(r.count, total)}</td></tr>`)}</tbody>
    </table>`;
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
      basis: () => stats?.basis?.length ? html`<h3>Types de relevés</h3>${this.#counts('Type', stats.basis.map((/** @type {any} */ b) => {
        const label = BASIS_LABELS[/** @type {keyof typeof BASIS_LABELS} */ (b.basis)] || b.basis;
        return { count: b.count, label: this.#focusable({ kind: 'filter', label, params: { basisOfRecord: b.basis } }, html`<span>${label}</span>`) };
      }), stats.count)}` : nothing,
      datasets: () => stats?.datasets?.length ? html`<h3>Principales sources</h3>${this.#counts('Source', stats.datasets.map((/** @type {any} */ d) => ({
        count: d.count,
        label: this.#hasMap
          ? html`<span class="with-link">${this.#focusable({ kind: 'filter', label: g.titles?.[d.key] ?? 'source GBIF', params: { datasetKey: d.key } }, html`<span>${g.titles?.[d.key] ?? '…'}</span>`)}
              <a class="ext" href=${'https://www.gbif.org/dataset/' + d.key} target="_blank" rel="noopener" title="Le jeu de données sur GBIF.org" aria-label="Le jeu de données sur GBIF.org">↗</a></span>`
          : html`<a href=${'https://www.gbif.org/dataset/' + d.key} target="_blank" rel="noopener">${g.titles?.[d.key] ?? '…'}</a>`
      })), stats.count)}` : nothing,
      distribution: () => places.length ? html`<h3>Répartition dans le monde (listes GBIF)</h3>
        <ul class="inline">${places.map(row => html`<li>${row.country
          ? this.#focusable({ kind: 'filter', label: row.place, params: { country: row.country } }, row.place, 'chip')
          : row.place}${row.means ? html` <span class="muted">(${row.means.toLowerCase()})</span>` : nothing}</li>`)}</ul>` : nothing
    })}
    ${key && statsShown && stats ? html`<p class="credit">Source : <a href=${search} target="_blank" rel="noopener">GBIF.org</a> — occurrences en France : présences seulement, coordonnées sans problème connu.</p>` : nothing}
    ${key && statsShown && stats?.count && this.#hasMap ? html`<p class="focus-hint">${icon('map')} Touchez une zone, un mois, une année, un type de relevé ou une source : la carte de la fiche n’affiche que ces occurrences.</p>` : nothing}`;
  }

  /** Occurrences per month, January to December. @param {number[]} months */
  #monthBars(months) {
    const max = Math.max(1, ...months);
    const names = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    return html`<h3>Occurrences par mois</h3>
      <div class="bars months" role="img" aria-label=${'Occurrences GBIF en France par mois : ' + months.map((c, i) => `${names[i]} ${c}`).join(', ')}>
        ${months.map((c, i) => {
          const bar = html`<i style=${`height:${Math.round(c / max * 100)}%`}></i><b>${'JFMAMJJASOND'[i]}</b>`;
          if (!this.#hasMap) return html`<span class="bar" title=${`${names[i]} : ${c.toLocaleString('fr-FR')}`}>${bar}</span>`;
          /** @type {import('../core/map-focus.js').FilterFocus} */ const f = { kind: 'filter', label: names[i], params: { month: String(i + 1) } };
          const on = isFocused(this._focus, f);
          return html`<button type="button" class="bar focusable" aria-pressed=${on ? 'true' : 'false'} aria-label=${`${names[i]} : ${c} occurrences, sur la carte`}
            title=${`${names[i]} : ${c.toLocaleString('fr-FR')} — ${on ? 'retirer de la carte' : 'voir sur la carte'}`} @click=${() => this.#focusOn(f)}>${bar}</button>`;
        })}
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
        ${list.map(([y, c]) => {
          const bar = html`<i style=${`height:${Math.round(c / max * 100)}%`}></i>`;
          if (!this.#hasMap || !c) return html`<span class="bar" title=${`${y} : ${c.toLocaleString('fr-FR')}`}>${bar}</span>`;
          /** @type {import('../core/map-focus.js').FilterFocus} */ const f = { kind: 'filter', label: String(y), params: { year: String(y) } };
          const on = isFocused(this._focus, f);
          return html`<button type="button" class="bar focusable" aria-pressed=${on ? 'true' : 'false'} aria-label=${`${y} : ${c} occurrences, sur la carte`}
            title=${`${y} : ${c.toLocaleString('fr-FR')} — ${on ? 'retirer de la carte' : 'voir sur la carte'}`} @click=${() => this.#focusOn(f)}>${bar}</button>`;
        })}
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
    const name = (/** @type {any} */ a) => this.#focusable({ kind: 'filter', label: t[a.gid] ?? a.gid, params: { gadmGid: a.gid } },
      html`${t[a.gid] ?? '…'} <small class="muted">(${a.count.toLocaleString('fr-FR')})</small>`, 'chip');
    const head = html`<h3>Régions et départements</h3>
      <p>Occurrences dans <strong>${departments.length}</strong> département${departments.length > 1 ? 's' : ''} et <strong>${regions.length}</strong> région${regions.length > 1 ? 's' : ''}.</p>`;
    const credit = html`<p class="credit">Découpage administratif : GADM, via GBIF.</p>`;
    if (blockStyle(this.view, 'occurrences') !== 'list') {
      const label = (/** @type {any} */ a) => this.#focusable({ kind: 'filter', label: t[a.gid] ?? a.gid, params: { gadmGid: a.gid } }, html`<span>${t[a.gid] ?? '…'}</span>`);
      return html`${head}
        ${regions.length ? html`<h4>Régions</h4>${this.#counts('Région', regions.map((/** @type {any} */ r) => ({ label: label(r), count: r.count })), stats.count)}` : nothing}
        ${departments.length ? html`<h4>Départements les plus cités</h4>${this.#counts('Département', departments.slice(0, 8).map((/** @type {any} */ d) => ({ label: label(d), count: d.count })), stats.count)}` : nothing}
        ${credit}`;
    }
    return html`${head}
      <dl class="facts">
        ${departments.length ? html`<dt>Départements les plus cités</dt><dd>${departments.slice(0, 5).map((/** @type {any} */ d, /** @type {number} */ i) => html`${i ? ' · ' : ''}${name(d)}`)}</dd>` : nothing}
        ${regions.length ? html`<dt>Régions</dt><dd>${regions.map((/** @type {any} */ r, /** @type {number} */ i) => html`${i ? ' · ' : ''}${name(r)}`)}</dd>` : nothing}
      </dl>
      ${credit}`;
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
          ${this.#focusable({ kind: 'point', label: 'GBIF à ' + formatDistance(o.distance), coordinates: o.coordinates, url: 'https://www.gbif.org/occurrence/' + o.key },
            html`<strong>${formatDistance(o.distance)}</strong>`)}
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
    })}${g.photos?.length || g.herbarium?.length ? this.#allMedia() : nothing}`;
  }

  /** @param {any} plant @param {string} title @param {any[] | null | undefined} list @param {string} none @param {boolean} herbarium */
  #mediaGallery(plant, title, list, none, herbarium) {
    const head = html`<h3>${title}</h3>`;
    if (list === undefined) return html`${head}<p class="muted">chargement…</p>`;
    if (!list?.length) return html`${head}<p class="muted">${none}</p>`;
    return html`${head}<div class="gallery ${herbarium ? 'herbarium' : ''}">${list.map(image => html`<figure>
      <a href=${image.sourceUrl || image.url} title="Voir en grand (Médias)" @click=${(/** @type {Event} */ e) => this.#openMedia(e, image.url)}><img src=${image.url} alt=${(herbarium ? 'Planche d’herbier de ' : '') + plant.scientificName} loading="lazy" decoding="async" referrerpolicy="no-referrer" /></a>
      <figcaption>
        ${herbarium ? html`<span class="specimen">${[image.institution, image.catalogNumber && 'n° ' + image.catalogNumber, image.year, image.country].filter(Boolean).join(' · ')}</span>` : nothing}
        ${image.coordinates && this.#hasMap ? this.#focusable({ kind: 'point', label: (herbarium ? 'Planche ' : 'Photo ') + ([image.institution, image.year].filter(Boolean).join(' ') || 'GBIF'), coordinates: image.coordinates, url: image.sourceUrl },
          html`${icon('geo-alt-fill')} ${image.locality ? image.locality.slice(0, 60) + (image.locality.length > 60 ? '…' : '') : 'Lieu de récolte'}`, 'where') : nothing}
        <gf-attribution .media=${image}></gf-attribution>
      </figcaption></figure>`)}</div>`;
  }

  /** « Habitat et écologie (GBIF) »: what the species profiles of GBIF checklists say. */
  #gbifProfile() {
    if (this._gbif.speciesProfiles === undefined) return html`<p class="muted">chargement…</p>`;
    const p = profile(this._gbif);
    if (!p.habitats.length && !p.forms.length && !p.invasive.length) return html`<p class="muted">Aucun profil d’espèce exploitable sur GBIF.</p>`;
    const key = this._details?.identifiers?.gbif?.id;
    const credit = html`<p class="credit">Source : <a href=${'https://www.gbif.org/species/' + key} target="_blank" rel="noopener">GBIF.org</a> — profils d’espèce de ${p.sources} liste${p.sources > 1 ? 's' : ''} de référence.</p>`;
    if (blockStyle(this.view, 'gbifProfile') === 'list') return html`<ul class="plain">
        ${p.habitats.length ? html`<li><b>Milieu :</b> ${p.habitats.map(([h]) => h).join(' · ')}</li>` : nothing}
        ${p.forms.length ? html`<li><b>Port :</b> ${p.forms.map(([f]) => f).join(' · ')}</li>` : nothing}
        ${p.invasive.length ? html`<li><b>Signalée envahissante :</b> ${p.invasive.slice(0, 4).join(' · ')}${p.invasive.length > 4 ? ` et ${p.invasive.length - 4} autres listes` : ''}</li>` : nothing}
      </ul>${credit}`;
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
    const authors = (/** @type {any} */ r) => r.authors.slice(0, 3).join(', ') + (r.authors.length > 3 ? ' et al.' : '');
    if (blockStyle(this.view, 'literature') !== 'list') return html`<table class="data papers-table">
        <thead><tr><th scope="col">Titre</th><th scope="col">Auteurs</th><th scope="col">Revue</th><th scope="col" class="num">Année</th></tr></thead>
        <tbody>${l.items.map((/** @type {any} */ r) => html`<tr>
          <td>${r.url ? html`<a href=${r.url} target="_blank" rel="noopener">${r.title}</a>` : r.title}</td>
          <td>${authors(r)}</td><td>${r.source}</td><td class="num">${r.year ?? ''}</td></tr>`)}</tbody>
      </table>
      <p class="credit">${l.total.toLocaleString('fr-FR')} publication${l.total > 1 ? 's' : ''} utilisant des données GBIF sur cette espèce —
        <a href=${'https://www.gbif.org/resource/search?contentType=literature&gbifTaxonKey=' + key} target="_blank" rel="noopener">toutes sur GBIF.org</a>.</p>`;
    return html`<ul class="papers">${l.items.map((/** @type {any} */ r) => html`<li>
        ${r.url ? html`<a href=${r.url} target="_blank" rel="noopener">${r.title}</a>` : r.title}
        <small>${[r.authors.slice(0, 3).join(', ') + (r.authors.length > 3 ? ' et al.' : ''), r.source, r.year].filter(Boolean).join(' · ')}</small>
      </li>`)}</ul>
      <p class="credit">${l.total.toLocaleString('fr-FR')} publication${l.total > 1 ? 's' : ''} utilisant des données GBIF sur cette espèce —
        <a href=${'https://www.gbif.org/resource/search?contentType=literature&gbifTaxonKey=' + key} target="_blank" rel="noopener">toutes sur GBIF.org</a>.</p>`;
  }


  /**
   * What says to be careful with this plant, each with its source: ANSM liste B, TPPT toxicity, confusions
   * with toxic plants (Anses), protection and harvest rules (INPN). @param {any} plant
   */
  #danger(plant) {
    const o = this._open;
    /** @type {{ level: 'stop' | 'warn', text: unknown }[]} */
    const out = [];
    const ansm = /** @type {any[]} */ (o.safety?.ansm || []), tppt = o.safety?.tppt;
    for (const b of ansm.filter(a => a.list === 'B')) out.push({ level: 'stop', text: html`<b>Pharmacopée française, liste B</b>${b.genus ? ' (tout le genre)' : ''} : plante médicinale dont les effets indésirables potentiels l’emportent sur le bénéfice attendu${b.parts ? html` — partie concernée : ${b.parts}` : nothing}. <span class="src">ANSM</span>` });
    for (const a of ansm.filter(a => a.list === 'A' && a.toxicParts)) out.push({ level: 'warn', text: html`<b>Parties toxiques</b> : ${a.toxicParts}. <span class="src">ANSM, Pharmacopée liste A</span>` });
    if (tppt) out.push({ level: tppt.level >= 3 ? 'stop' : 'warn', text: html`<b>${tppt.level >= 2 ? 'Plante toxique' : 'Attention'}</b>${tppt.levelLabel ? ` (${tppt.levelLabel})` : ''}${tppt.parts ? html` — ${tppt.level >= 2 ? 'parties toxiques' : 'parties concernées'} : ${tppt.parts}` : nothing}${tppt.toxins?.length ? html` ; substances : ${tppt.toxins.slice(0, 4).join(', ')}` : nothing}. <span class="src">Agroscope, base TPPT</span>` });
    if (o.confusions) out.push({ level: 'warn', text: html`<b>Risque de confusion</b> avec une plante toxique : voir « ${blockTitle('lookalikes')} ». <span class="src">Anses, Centres antipoison</span>` });
    const st = plant.statuses || [];
    if (st.some((/** @type {any} */ x) => /^P[NRD]$/.test(x.type))) out.push({ level: 'stop', text: html`<b>Espèce protégée</b> (${[...new Set(st.filter((/** @type {any} */ x) => /^P[NRD]$/.test(x.type)).map((/** @type {any} */ x) => x.area || x.label))].slice(0, 3).join(', ')}) : cueillette interdite là où elle l’est. <span class="src">INPN</span>` });
    else if (st.some((/** @type {any} */ x) => x.type === 'REGL')) out.push({ level: 'warn', text: html`<b>Cueillette réglementée</b> dans certains départements (voir « ${blockTitle('status')} »). <span class="src">INPN</span>` });
    // The gravest first (stable sort: the source order stays within a level).
    return out.sort((a, b) => (a.level === 'stop' ? 0 : 1) - (b.level === 'stop' ? 0 : 1));
  }

  /** « Usages et cuisine sauvage »: safety first, then sourced uses, parts and products, dishes and recipes. @param {any} ctx */
  #uses({ plant }) {
    const o = this._open;
    const style = blockStyle(this.view, 'uses');
    const danger = this.#danger(plant);
    const wd = o.wdUses;
    const ansmA = (/** @type {any[]} */ (o.safety?.ansm || [])).filter(a => a.list === 'A');
    const pending = html`<p class="muted">chargement…</p>`;
    const KIND = { food: 'Alimentation', medicine: 'Médecine traditionnelle', other: 'Autres usages' };
    return html`${this.#subs('uses', {
      safety: () => danger.length ? html`<div class="prudence ${danger.some(d => d.level === 'stop') ? 'grave' : ''}">
          <ul>${danger.map(d => html`<li class=${d.level}>${icon(d.level === 'stop' ? 'exclamation-octagon-fill' : 'exclamation-triangle-fill')}<span>${d.text}</span></li>`)}</ul>
          <p class="small">En cas de doute, ne pas consommer. Centre antipoison 24 h/24 ; le 15 en cas de détresse vitale. <span class="src">Anses</span></p>
        </div>` : nothing,
      uses: () => {
        const head = html`<h3>${danger.length ? 'Usages rapportés (non vérifiés, voir Prudence)' : 'Usages rapportés'}</h3>`;
        const groups = /** @type {Record<string, any[]>} */ ({});
        for (const u of wd?.uses || []) (groups[u.kind] ||= []).push(u);
        if (wd === undefined && !ansmA.length) return html`${head}${pending}`;
        if (!wd?.uses?.length && !ansmA.length) return nothing;
        return html`${head}
          ${ansmA.length ? html`<p class="small"><b>Pharmacopée française, liste A</b> : plante médicinale utilisée traditionnellement — partie${ansmA.length > 1 || /,/.test(ansmA[0].parts || '') ? 's' : ''} utilisée${ansmA.length > 1 || /,/.test(ansmA[0].parts || '') ? 's' : ''} : ${ansmA.map(a => a.parts).filter(Boolean).join(' ; ') || 'non précisée'}. <span class="src">ANSM</span></p>` : nothing}
          ${Object.keys(groups).length ? html`<dl class="facts">${['food', 'medicine', 'other'].filter(k => groups[k]).map(k => html`<dt>${KIND[/** @type {'food'} */ (k)]}</dt>
            <dd>${groups[k].map((u, i) => html`${i ? ' · ' : ''}<a href=${'https://www.wikidata.org/wiki/' + u.id} target="_blank" rel="noopener">${u.label}</a>`)}</dd>`)}</dl>
            <p class="credit">Usages déclarés sur <a href=${'https://www.wikidata.org/wiki/' + wd?.qid} target="_blank" rel="noopener">Wikidata</a> (CC0), sans source détaillée : à recouper.</p>` : nothing}`;
      },
      parts: () => {
        if (!wd?.products?.length) return nothing;
        const rows = wd.products;
        return html`<h3>Parties et produits</h3>${style === 'list'
          ? html`<p class="small">${rows.map((p, i) => html`${i ? ' · ' : ''}${p.label}${p.parts.length ? html` <span class="muted">(${p.parts.join(', ')})</span>` : nothing}`)}</p>`
          : html`<table class="data"><thead><tr><th scope="col">Produit</th><th scope="col">Partie de la plante</th></tr></thead>
            <tbody>${rows.map(p => html`<tr><td><a href=${'https://www.wikidata.org/wiki/' + p.id} target="_blank" rel="noopener">${p.label}</a></td><td>${p.parts.join(', ') || html`<span class="muted">—</span>`}</td></tr>`)}</tbody></table>`}
          <p class="credit">Source : Wikidata (CC0).</p>`;
      },
      kitchen: () => {
        const dishes = wd?.dishes || [];
        const books = o.recipes || [];
        if (!dishes.length && !books.length) return o.recipes === undefined && wd === undefined ? html`<h3>En cuisine</h3>${pending}` : nothing;
        return html`<h3>En cuisine</h3>
          ${dishes.length ? html`<p class="small"><b>Plats</b> : ${dishes.map((d, i) => html`${i ? ' · ' : ''}<a href=${d.url || 'https://www.wikidata.org/wiki/' + d.id} target="_blank" rel="noopener">${d.label}</a>`)}</p>` : nothing}
          ${books.length ? html`<ul class="recipes">${books.map((/** @type {any} */ r) => html`<li><a href=${r.url} target="_blank" rel="noopener">${r.title.replace(/^Cookbook:/, '')}</a> <span class="muted">(${r.lang === 'fr' ? 'Wikibooks' : 'Wikibooks, en anglais'})</span></li>`)}</ul>` : nothing}
          <p class="credit">Plats : Wikidata (CC0) ; recettes : Wikibooks (CC BY-SA), non vérifiées.</p>`;
      },
      links: () => {
        const links = [];
        if (wd?.pfaf) links.push(html`<a href=${'https://pfaf.org/user/Plant.aspx?LatinName=' + encodeURIComponent(wd.pfaf.replace(/_/g, ' '))} target="_blank" rel="noopener">Plants For A Future (PFAF)</a>`);
        links.push(html`<a href=${'https://www.ema.europa.eu/en/search?search_api_fulltext=' + encodeURIComponent(plant.scientificName.split(' ').slice(0, 2).join(' '))} target="_blank" rel="noopener">Monographies de plantes (EMA)</a>`);
        if (o.safety?.ansm?.length) links.push(html`<a href="https://ansm.sante.fr/pharmacopee/liste-des-plantes-medicinales-utilisees-traditionnellement" target="_blank" rel="noopener">Pharmacopée française (ANSM)</a>`);
        return html`<h3>Pour aller plus loin</h3><ul class="inline links">${links.map(l => html`<li>${l}</li>`)}</ul>`;
      }
    })}`;
  }

  /** « Pollinisateurs et interactions » (GloBI): by role, as a table, a list or a network. @param {any} ctx */
  #interactions({ plant }) {
    const data = this._open.interactions;
    if (data === undefined) return html`<p class="muted">chargement…</p>`;
    if (!data?.roles?.length) return html`<p class="muted">Aucune interaction connue de GloBI pour cette espèce.</p>`;
    const keys = shownSubs(this.view, 'interactions');
    const roles = data.roles.filter((/** @type {any} */ r) => keys.includes(r.key));
    const style = blockStyle(this.view, 'interactions');
    const credit = html`<p class="credit">Source : <a href=${data.url} target="_blank" rel="noopener">GloBI — Global Biotic Interactions</a> :
      ${data.total.toLocaleString('fr-FR')} mention${data.total > 1 ? 's' : ''} tirées de ${data.studies.toLocaleString('fr-FR')} étude${data.studies > 1 ? 's' : ''} ou jeu${data.studies > 1 ? 'x' : ''} de données (CC BY selon les sources).</p>`;
    if (!roles.length) return html`<p class="muted">Aucune interaction de ce type connue de GloBI.</p>${credit}`;
    const partner = (/** @type {any} */ p) => html`<span class="partner"><i class="dot" style=${`background:${groupColor(p.group)}`}></i><em>${p.name}</em></span>`;
    if (style === 'graph') return html`${networkChart(plant.scientificName, roles)}${groupLegend(roles)}${credit}`;
    if (style === 'list') return html`${roles.map((/** @type {any} */ r) => {
      const groups = new Map();
      for (const p of r.partners) groups.set(p.group, (groups.get(p.group) || 0) + 1);
      return html`<h3>${r.label} <small class="muted">(${r.count})</small></h3>
        <p class="small">${[...groups].sort((a, b) => b[1] - a[1]).map(([g, n], i) => html`${i ? ' · ' : ''}<i class="dot" style=${`background:${groupColor(g)}`}></i>${g} (${n})`)}</p>
        <p class="small partners">${r.partners.slice(0, 12).map((/** @type {any} */ p, /** @type {number} */ i) => html`${i ? ', ' : ''}<em>${p.name}</em>`)}${r.count > 12 ? ` et ${r.count - 12} autres` : ''}.</p>`;
    })}${credit}`;
    return html`${roles.map((/** @type {any} */ r) => html`<h3>${r.label} <small class="muted">(${r.count} espèce${r.count > 1 ? 's' : ''} ou groupe${r.count > 1 ? 's' : ''})</small></h3>
      <table class="data counts-table"><thead><tr><th scope="col">Espèce ou groupe</th><th scope="col">Groupe</th><th scope="col" class="num">Mentions</th></tr></thead>
        <tbody>${r.partners.slice(0, 12).map((/** @type {any} */ p) => html`<tr><td>${partner(p)}</td><td>${p.group}</td><td class="num">${p.count}</td></tr>`)}</tbody></table>
      ${r.count > 12 ? html`<p class="muted small">Et ${r.count - 12} autres sur <a href=${data.url} target="_blank" rel="noopener">GloBI</a>.</p>` : nothing}`)}${credit}`;
  }

  /** « Climat et pollen » (Open-Meteo × GBIF): today's pollen of the plant, its climate niche, my position on it. @param {any} ctx */
  #climate({ plant }) {
    const v = this.view;
    const here = this._open.here;
    const pollen = openData.pollenOf(plant);
    const ask = (/** @type {string} */ label) => html`<p><button type="button" class="here-ask" @click=${() => this.#findHere()}>${icon('crosshair')} ${label}</button></p>
      <p class="credit">Votre position (arrondie à 100 m) est envoyée à Open-Meteo pour ce calcul, sans être enregistrée.</p>`;
    const hereState = !here ? null : here.state === 'locating' ? html`<p class="muted">Recherche de votre position…</p>` : here.state === 'loading' ? html`<p class="muted">chargement…</p>`
      : here.state === 'error' ? html`<p class="muted">${here.message} <button class="link" type="button" @click=${() => this.#findHere()}>Réessayer</button></p>` : null;
    return html`${this.#subs('climate', {
      pollen: () => {
        if (!pollen) return nothing;
        const head = html`<h3>Pollen de ${pollen.label.toLowerCase()} aujourd’hui</h3>`;
        if (!here) return html`${head}${ask('Voir le pollen là où je suis')}`;
        if (hereState) return html`${head}${hereState}`;
        const value = here.pollen?.values?.[pollen.key];
        if (value == null) return html`${head}<p class="muted">Pas de prévision de pollen ici (le modèle CAMS couvre l’Europe).</p>`;
        const lvl = openData.pollenLevel(value);
        return html`${head}<p class="pollen"><span class="level l${lvl.level}">${lvl.label}</span> — jusqu’à <strong>${Math.round(value)}</strong> grains/m³ aujourd’hui autour de vous.</p>
          <p class="credit">Prévision : Copernicus CAMS via <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0).</p>`;
      },
      niche: () => {
        const niche = this._open.niche;
        const head = html`<h3>Niche climatique en France</h3>`;
        if (niche === undefined) return html`${head}<p class="muted">chargement…</p>`;
        if (!niche?.points?.length) return html`${head}<p class="muted">Pas assez d’occurrences GBIF localisées en France pour situer son climat.</p>`;
        const temps = niche.points.map((/** @type {any} */ p) => p.temp).sort((/** @type {number} */ a, /** @type {number} */ b) => a - b);
        const rains = niche.points.map((/** @type {any} */ p) => p.precip).sort((/** @type {number} */ a, /** @type {number} */ b) => a - b);
        const mine = here?.state === 'done' && here.climate ? { temp: here.climate.annualTemp, precip: here.climate.annualPrecip, label: 'chez vous' } : null;
        const inside = mine && mine.temp >= temps[Math.floor(temps.length * 0.1)] && mine.temp <= temps[Math.ceil(temps.length * 0.9) - 1]
          && mine.precip >= rains[Math.floor(rains.length * 0.1)] && mine.precip <= rains[Math.ceil(rains.length * 0.9) - 1];
        return html`${head}${nicheChart(niche.points, mine)}
          <p class="small">Là où elle a été observée : <strong>${temps[0]} à ${temps[temps.length - 1]} °C</strong> de moyenne annuelle,
            <strong>${rains[0].toLocaleString('fr-FR')} à ${rains[rains.length - 1].toLocaleString('fr-FR')} mm</strong> de pluie par an (${niche.points.length} lieux, cadre : 80 % d’entre eux).
            ${mine ? html`Chez vous : ${mine.temp} °C, ${mine.precip.toLocaleString('fr-FR')} mm — ${inside ? 'dans sa niche' : 'en dehors du cœur de sa niche'}.` : nothing}</p>
          ${!mine && !here ? ask('Me situer sur ce graphique') : hereState || nothing}
          ${mine && baseOf(v) !== 'epure' ? html`<details class="here-climate"><summary>Climat chez vous (${here.climate.years})</summary>${climateChart(here.climate.temp, here.climate.precip)}</details>` : nothing}
          <p class="credit">Climat : ERA5 via <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (moyennes ${niche.years}, CC BY 4.0) aux occurrences de <a href=${'https://www.gbif.org/species/' + (this._details?.identifiers?.gbif?.id ?? '')} target="_blank" rel="noopener">GBIF.org</a>.</p>`;
      }
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
    const value = (/** @type {any} */ id, /** @type {any} */ url) => url ? html`<a href=${url} target="_blank" rel="noopener">${id}</a>` : id;
    if (blockStyle(this.view, 'ids') === 'list') return html`<ul class="inline ids">${ids.map(([label, id, url]) => html`<li><span class="muted">${label}</span> ${value(id, url)}</li>`)}</ul>`;
    return html`<table class="data ids"><tbody>${ids.map(([label, id, url]) => html`<tr><th scope="row">${label}</th><td>${value(id, url)}</td></tr>`)}</tbody></table>`;
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

  /** ↑ ↓ on a focused grip: one place up or down, saved; the grip keeps the focus. @param {KeyboardEvent} e @param {string} key */
  async #gripKey(e, key) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const order = this.#moved(key, e.key === 'ArrowUp' ? -1 : 1, blockOrder(this.view).filter(k => !isOnEdge(this.view, k)));
    if (!order) return;
    setBlockOrder(this.view, this.#withPinned(this.view, order));
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
    if (e.button !== 0 || /** @type {Element} */ (e.target).closest('button:not(.grip), summary, details')) return;
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
      // Pinned blocks are not in the flow: they keep their place in the order.
      this._dragOrder = blockOrder(this.view).filter(k => !isOnEdge(this.view, k));
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
    if (order) setBlockOrder(drag.view, this.#withPinned(drag.view, order));
    await this.updateComplete;
    this.#section(drag.key)?.scrollIntoView({ block: 'nearest' });
  };

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
      <article class=${baseOf(this.view) === 'scientific' ? 'science' : ''}>
        <a class="back link" href=${lastSearchHash()}>${icon('arrow-left')} Recherche</a>
        <gf-add-to .plant=${ctx.plant}></gf-add-to>
        ${this._error ? html`<p class="muted">${this._error}</p>` : nothing}
        ${this.#blocks(ctx)}
      </article>`);
  }
}

customElements.define('gf-plant-detail', GfPlantDetail);
