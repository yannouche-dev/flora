// @ts-check
import { LitElement, html, css, nothing, repeat } from 'lit';
import { STATUS_LABELS } from '../config.js';
import * as db from '../core/db.js';
import { commonOf, nameOf } from '../core/plants.js';
import { lastSearchHash } from '../core/query.js';
import { StoreController, arrange, arrangedMode, closeKing, openKing, whenReady } from '../core/store.js';
import { formatDistance, getMembership, promoteFavorite, setInCollection, toggleFavorite } from '../core/collections.js';
import { context } from '../core/context.js';
import { lastFix, oneFix } from '../core/geo.js';
import { savedRadius } from '../core/nearby.js';
import { href } from '../core/router.js';
import { share } from '../core/share.js';
import * as sources from '../core/sources.js';
import { moduleOn, modulesSignature } from '../core/modules.js';
import { baseOf, modeLabel } from '../core/modes.js';
import './gf-attribution.js';
import './gf-plant-spots.js';
import './gf-calendar.js';
import './gf-status.js';
import './gf-lookalikes.js';
import { emergency } from '../core/poison.js';
import './gf-add-to.js';
import './gf-sheet-map.js';
import { ownWords } from './gf-map-options.js';
import { lookFor } from '../core/map-settings.js';
import { ONE_GL_PER_SHEET } from './map3d-options.js';
import { ui } from '../styles/ui.js';
import { icon, modeIcon } from '../core/icons.js';
import './gf-mode-switch.js';
import {
  STYLES, SUBS, canBeEmpty, hidesEmpty, setHidesEmpty, isMap, isAddedMap, mapConfig, setMapConfig, createMap, deleteMap, blockModuleName, blockOrder, blockStyle, blockTitle, isTitleShown, setBlockStyle, setTitleShown, createNote, deleteNote, isHidden, isNote, isSubHidden, noteText, renameBlock,
  foldedByHand, serviceOff, serviceOffNote, setBlockOrder, setHidden, setNoteText, setSubHidden, setSubOrder, shownSubs, subOrder, subTitle,
  isOnEdge, placeOf, orderByCategory, treeOf, paneOf, dockBlock, toSheet, setPaneSizes, setStackState, isCustom, isLocked, isSubLocked, resetBlocks
} from '../core/sheet-blocks.js';
import { leaves as paneLeaves, stackOf, setSizes as treeSizes, patchStack, dock, undock } from '../core/pane-tree.js';
import { pressDock } from '../core/dock-drag.js';
import { gripStyles, shareGrip } from '../core/split-grip.js';
import { CATEGORIES, blockCategory, categoryOf } from '../core/categories.js';
import { FOCUS_EVENT, isFocused, noFocus, toggleFocus } from '../core/map-focus.js';
import * as openData from '../core/open-data.js';
import * as usesData from '../core/uses.js';
import { gravest, lookalikesOf, severityNote } from '../core/lookalikes.js';
import { harvestRuleText } from '../core/regulation.js';
import { dangerLevel, rank, reasonLine } from '../core/danger.js';
import { severityChip, severityStyles } from './ui-kit.js';
import { formatAltitude } from '../core/altitude.js';
import { chartStyles, climateChart, groupColor, groupLegend, networkChart, nicheChart } from '../core/charts.js';
import { unsafeCSS } from 'lit';
import './gf-sortable-list.js';
import './gf-media-viewer.js';
import './gf-web-pane.js';
import { registerWebPane, unregisterWebPane } from '../core/web-pane.js';
import { notesEvents } from '../core/sheet-notes.js';
import { verdictOf } from '../core/alerts.js';
import { sheetSession, setAnchorLock } from '../core/sheet-session.js';
import { openModal } from '../core/history.js';
import { hideImg, dropFigure, showImg } from '../core/img.js';
import { safeUrl } from '../core/safe-url.js';
import { forgetFailures } from '../core/cache.js';
import { isUnavailable } from '../core/net.js';
import { sourceDown } from '../core/source-state.js';

/** Remote text is untrusted HTML: keep only its text content (DOMParser never runs scripts). */
function toText(/** @type {string} */ value) {
  const { body } = new DOMParser().parseFromString(String(value ?? ''), 'text/html');
  body.querySelectorAll('script, style, noscript').forEach(node => node.remove());
  return body.textContent?.replace(/\s+/g, ' ').trim() || '';
}

/** The safety file or the look-alikes file could not be read (_open.safety, _open.confusions): never « nothing known ». */
const UNREAD = Object.freeze({ unread: true });

/**
 * The loads each block reads (#loadExtras, #loadGbif; 'details:<service>': a service the details could not reach):
 * one that failed makes the block say « Source indisponible — Réessayer » (audit STO-8), not « aucune donnée ».
 * @type {Record<string, string[]>}
 */
const BLOCK_LOADS = {
  wikipedia: ['wiki', 'details:wikidata'],
  descriptions: ['gbif:descriptions', 'details:gbif'],
  names: ['gbif:vernacularNames', 'details:gbif'],
  occurrences: ['gbif:stats', 'gbif:distributions', 'details:gbif'],
  gbifMedia: ['gbif:photos', 'gbif:herbarium', 'details:gbif'],
  gbifProfile: ['gbif:speciesProfiles', 'details:gbif'],
  literature: ['gbif:literature', 'details:gbif'],
  interactions: ['globi'],
  climate: ['niche', 'details:gbif'],
  uses: ['uses:wikidata', 'uses:recipes', 'details:wikidata'],
  taxonomy: ['science', 'gbif:synonyms', 'details:wikidata', 'details:gbif'],
  status: ['science', 'gbif:iucn'],
  ids: ['science', 'details:gbif', 'details:inaturalist', 'details:wikidata'],
  photos: ['details:commons', 'details:inaturalist'],
  trefle: ['details:trefle']
};

/** Loads whose value is in _open, by load key. @type {Record<string, string>} */
const OPEN_KEYS = { globi: 'interactions', niche: 'niche', 'uses:wikidata': 'wdUses', 'uses:recipes': 'recipes' };

/** A block not moved: the layout would have too many panes nested to be exported and read back (pane-tree.js dock). */
const TOO_DEEP = 'pas déplacé, trop de panneaux imbriqués';

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

/**
 * Wikipédia's sections by theme: their name, and the block of the sheet that shows them beside its own data
 * (none: they stay in the Wikipédia block).
 */
const WIKI_THEMES = /** @type {Record<string, [string, string | null]>} */ ({
  description: ['Description', 'descriptions'], biology: ['Biologie et floraison', 'calendar'], ecology: ['Habitat et écologie', 'gbifProfile'],
  distribution: ['Répartition', 'occurrences'], toxicity: ['Toxicité et confusions', 'uses'], food: ['Alimentation', 'uses'], uses: ['Usages', 'uses'],
  names: ['Noms et étymologie', 'names'], history: ['Histoire et symbolique', null], taxonomy: ['Taxonomie', null], other: ['Autres sujets', null]
});
/** A section's text: at first, its beginning only. */
const WIKI_SHORT = 600;

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
    for (const part of String(raw || '').split(/\s*[,;/]\s*|\s+ou\s+/)) {
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

/**
 * A place reached (a rubric, a block, a theme of the article) is kept in place while the plant's data still arrives
 * above it — until the hand moves the sheet, another place is reached, or at the latest after this long (ms).
 */
const KEEP_MAX_MS = 15000;
/** Everything arrived: the place is kept until the sheet has not grown for this long (ms). */
const KEEP_QUIET_MS = 700;
/** All the rubrics stacked above and below (« full ») when that leaves this share of the sheet to read; back to one at the top under the lower share (no flip for a few pixels: a phone's address bar). */
const STACK_ENTER = 0.62;
const STACK_LEAVE = 0.57;

export class GfPlantDetail extends LitElement {
  static properties = {
    plantId: { type: Number, attribute: 'plant-id' },
    /** Shown in the Flore tab's plant pane: compact padding, the pane has its own close / back controls. */
    embedded: { type: Boolean, reflect: true },
    /** Under a screen's own title (a mini-app, a layout's cell): its name a heading of level 2, never a second h1. */
    subheading: { type: Boolean },
    /** The plant waiting under the swiped card (Flore): not the page's plant yet, so it leaves the title alone. */
    preview: { type: Boolean },
    /** Opened in a scenario played as an app of its own (the Parcours): no action leading out of it (Carte, Noter ici). */
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
    /** Épuré (photo and one-tap actions), standard (general public), scientific (every data). */
    view: { reflect: true },
    /**
     * The host's sheet (`flore`, `collections`): « Personnaliser la fiche » (its crown, at the end of the action bar)
     * opens there only — never on a card underneath, a block alone, panes alone, a host's own tree, an activity.
     */
    sheet: {},
    _wiki: { state: true },
    /** Wikipédia: the sections read whole, the themes opened in its block. */
    _wikiOpen: { state: true },
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
    /**
     * `only`, a block among others (Orchidées de Mirabel's simple sheet, kit/ma-plant-sheet.js): as the sheet reads it
     * — its title when the view shows it (an h3, under the rubric's), left out when the view leaves it out empty.
     */
    titled: { type: Boolean },
    /** In a pane (`only` media): the image to open at, by URL (a photo touched) or by place (the address). */
    paneStart: { attribute: false },
    paneAt: { attribute: false },
    /** Its « Médias » (the block in the sheet, or on an edge) open at this image, by its place (a mini-app's address, &m=). */
    mediaAt: { attribute: false },
    /** The block shown in the pane beside this sheet (Flore): only a line here, not twice. */
    inPane: { attribute: false },
    /** A block opened over the page (outside Flore, where there is no pane): its key and the image it starts at. */
    _paneDialog: { state: true },
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
    _noteFailed: { state: true },
    /** What the sheet's maps show beyond their settings: a filter, a point, a compared plant (map-focus.js). */
    _focus: { state: true },
    /** Open data crossed with the plant: GloBI interactions, climate niche; « here » (pollen and climate of my position). */
    _open: { state: true },
    _failed: { state: true }
  };

  static styles = [ui, severityStyles, css`
    :host {
      display: block;
      overflow-y: auto;
      /* No vertical padding: what is stuck (the rubrics) sticks to the very top, the action bar to the very bottom
         (the article keeps the space). */
      padding: 0 16px;
      /* A rubric's header, stuck while it is read (one line, whatever its text). */
      --rub-h: 30px;
    }
    article { padding: 16px 0 24px; }
    article { max-width: 920px; margin: 0 auto; }
    :host([embedded]) { padding: 0 14px; }
    :host([embedded]) article { padding-top: 4px; }
    :host([embedded]) .back { display: none; }
    :host([embedded]) :is(h1, h2.h1) { margin-top: 4px; }
    .back { font-size: 0.9rem; }
    /* The name, an h1, or an h2 under a screen's own title that looks the same (not as a block's title). */
    :is(h1, h2.h1) { margin: 8px 0 0; font-size: 1.6rem; line-height: 1.2; font-weight: 700; text-transform: none; letter-spacing: normal; color: var(--gf-text); }
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
    /* Personalised: the title is a handle for the mouse; a finger drags by the grip ⠿ only (on the title it scrolls the
       sheet, #press). Its tools wrap under the name when the row is short. */
    .king .block-title { position: relative; flex-wrap: wrap; row-gap: 2px; margin-left: -6px; cursor: grab; user-select: none; -webkit-user-select: none; }
    .king .grip { touch-action: none; }
    /* Its rows are as narrow as the list (a sheet squeezed by its panes, a pane's column), not as the whole sheet. */
    .blocks.king, .edge.king .edge-body { container-type: inline-size; }
    /* « Déplacer vers… » hangs from the end of the title row: a picker wrapped to its start would push the menu out. */
    .king .block-title .place-pick { position: static; }
    .block-title .name { flex: 1; min-width: 0; }
    .king .block-title .name { min-width: min(11em, calc(100% - 52px)); }
    /* King: the block's category (what the data says about the plant). */
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
    /* A safety block's padlock (no trash): touched, it says why, under the title. */
    .block-title .tool.lock { cursor: help; font-size: 0.85rem; }
    .lock-tip { margin: -4px 0 8px; font-size: 0.8rem; color: var(--gf-text-muted); }
    .lock-tip:empty { display: none; }
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
    /* King: every action, each with its ☑ — the one target there, the action inert under it until « Terminé » (no two
       targets on top of each other: WCAG 2.5.8); an action hidden in this view is faded too. */
    .action-bar .act-toggle { position: absolute; top: 0; right: 2px; display: grid; place-items: center; width: 22px; height: 22px; cursor: pointer; }
    .action-bar .act-toggle input { margin: 0; width: 16px; height: 16px; }
    .action-bar .act.off > button, .action-bar .act.off > a.button { opacity: 0.4; text-decoration: line-through; pointer-events: none; }
    /* « Personnaliser la fiche »: the crown, last, an icon at a finger's size; gold while open. */
    .action-bar .act.crown { flex: none; width: 44px; }
    .action-bar .act.crown > button { min-height: 44px; place-content: center; color: var(--gf-text-muted); }
    .action-bar .act.crown > button[aria-pressed='true'] { color: var(--gf-crown); background: color-mix(in srgb, #f5c518 18%, var(--gf-surface)); }
    /* « Mise en page de la fiche »: the mode arranged and its tools, stuck at the top (above the panes when there are). */
    .king-bar { position: sticky; top: 0; z-index: 8; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin: 0 -16px; padding: 6px 16px;
      border-bottom: 2px solid #d4a017; background: color-mix(in srgb, #f5c518 10%, var(--gf-surface)); font-size: 0.85rem; }
    :host([embedded]) .king-bar { margin: 0 -14px; padding: 6px 14px; }
    :host([edged]) .king-bar { position: static; flex: none; margin: 0; }
    /* Stuck over a sheet without panes: a block reached, or read, is the one right below it (#offset), never beneath it. */
    :host(:not([edged])) .blocks.king > .block { scroll-margin-top: var(--kb-h, 0px); }
    .king-bar .kb-mode { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
    .king-bar .kb-mode > svg:first-child { color: #b8860b; font-size: 1.1rem; }
    .king-bar .kb-tools { display: inline-flex; flex-wrap: wrap; gap: 6px; margin-left: auto; }
    /* « Barre d’actions »: its list on a line of its own, scrolling when tall (the sheet stays in view). */
    .king-actions { flex: 1 1 100%; max-height: min(45vh, 360px); overflow-y: auto; overscroll-behavior: contain; padding: 6px 8px; border: 1px dashed var(--gf-border);
      border-radius: var(--gf-radius); background: var(--gf-surface); }
    .king-actions p { margin: 0 0 6px; color: var(--gf-text-muted); font-size: 0.8rem; }
    /* The name and the actions read without a title (King titles them, to move them like the others). */
    .block.headless { margin-top: 8px; }
    .block.headless:first-child { margin-top: 0; }
    .block[data-key='name'] :is(h1, h2.h1) { margin-top: 4px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    /* Other names: a quiet list, in italics. */
    .names-list, .names { margin: 0; font-style: italic; font-size: 0.88rem; color: var(--gf-text-muted); line-height: 1.5; }
    .names-list .sep, .names .sep { font-style: normal; opacity: 0.5; padding: 0 0.3em; }
    .block-title input.rename { flex: 1; min-width: 0; font: inherit; text-transform: none; letter-spacing: 0; padding: 2px 6px; border: 1px solid var(--gf-accent); border-radius: var(--gf-radius-sm); background: var(--gf-surface); color: var(--gf-text); }
    .block-title .tool[aria-expanded='true'], .block-title .tool[aria-pressed='true'] { opacity: 1; color: var(--gf-accent); }
    /* King: a title hidden when read is drawn struck and slanted (not faded: its contrast kept). */
    .block.untitled > .block-title .name { font-style: italic; text-decoration: line-through; }
    .block-title .styles { display: inline-flex; flex: none; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-pill); overflow: hidden; margin-right: 4px; }
    .block-title .styles button { min-height: 0; padding: 2px 8px; border: 0; border-radius: 0; background: var(--gf-surface); color: var(--gf-text-muted); font-size: 0.7rem; text-transform: none; letter-spacing: 0; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
    .block-title .styles button[aria-pressed='true'] { background: var(--gf-accent-soft); color: var(--gf-accent); }
    .block-title .styles button:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .map-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin: 0 0 10px; padding: 10px; border: 1px dashed var(--gf-border); border-radius: var(--gf-radius); background: var(--gf-surface); font-size: 0.85rem; }
    .map-form fieldset { border: 0; margin: 0; padding: 0; display: grid; gap: 6px; align-content: start; }
    .map-form legend { font-weight: 700; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--gf-text-muted); padding: 0; margin-bottom: 2px; }
    .map-form label { display: grid; gap: 2px; }
    .map-form label.check { display: flex; gap: 6px; align-items: center; }
    .map-form .look-note { grid-column: 1 / -1; margin: 0; color: var(--gf-text-muted); }
    .map-placeholder { border-radius: var(--gf-radius); background: var(--gf-surface-2); }
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
    /* Titled (a block among others): its title as the sheet's (an h3 there). */
    .block.only > h3.block-title { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--gf-text-muted); font-weight: 600; }
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
    .epure :is(h1, h2.h1) { font-size: 1.8rem; }
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
    .credit.error { color: var(--gf-danger); }
    .wiki p.credit { margin-top: 6px; }
    /* The Wikipédia summary reads like the other blocks: flush left, no card (its source line names it). */
    .description.wiki { background: none; padding: 0; border-radius: 0; }
    .description.wiki p { margin: 0 0 8px; }
    .wiki-desc { font-style: italic; color: var(--gf-text-muted); }
    /* The article's menu: in the block's header, stuck at the top of the sheet while reading it. */
    .wiki-menu { display: flex; gap: 4px; align-items: center; overflow-x: auto; scrollbar-width: none; margin: 0 -4px 10px; padding: 6px 4px;
      background: color-mix(in srgb, var(--gf-surface) 94%, transparent); backdrop-filter: blur(6px); border-bottom: 1px solid var(--gf-border);
      mask-image: linear-gradient(90deg, #000 calc(100% - 16px), transparent); }
    .wiki-menu::-webkit-scrollbar { display: none; }
    .wiki-logo { flex: none; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%; border: 1px solid var(--gf-border); font-size: 0.85rem; color: var(--gf-text-muted); }
    .wiki-menu a { flex: none; padding: 4px 10px; border-radius: var(--gf-radius-pill); font-size: 0.8rem; color: var(--gf-text-muted); text-decoration: none; white-space: nowrap; }
    .wiki-menu a:hover { color: var(--gf-text); background: var(--gf-surface-2); }
    .wiki-menu a:focus-visible { outline: none; box-shadow: var(--gf-focus); }
    .wiki-theme { border-top: 1px solid var(--gf-border); }
    .wiki-theme > summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; padding: 10px 0; cursor: pointer; font-weight: 600; list-style: none; }
    .wiki-theme > summary::-webkit-details-marker { display: none; }
    .wiki-theme > summary::before { content: '›'; display: inline-block; transition: transform 0.15s; color: var(--gf-text-muted); }
    .wiki-theme[open] > summary::before { transform: rotate(90deg); }
    .wiki-theme > summary small { font-weight: 400; color: var(--gf-text-muted); font-size: 0.75rem; }
    .wiki-theme > summary .also { margin-left: auto; font-size: 0.75rem; font-weight: 400; }
    .wiki-theme[data-flash] { animation: flash 1.2s ease-out; }
    .wiki-in { padding: 0 0 10px 14px; }
    /* Wikipédia's words, under a block's own data. */
    .wiki-bits { margin-top: 12px; padding: 10px 12px; border-left: 3px solid color-mix(in srgb, var(--gf-accent) 40%, transparent); background: color-mix(in srgb, var(--gf-surface) 70%, transparent); border-radius: 0 var(--gf-radius-sm) var(--gf-radius-sm) 0; }
    .wiki-x h3 { margin: 0 0 4px; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--gf-text-muted); }
    .wiki-x p { margin: 0 0 6px; font-size: 0.92rem; line-height: 1.5; }
    .wiki-x + .wiki-x { margin-top: 10px; }
    ${unsafeCSS(chartStyles)}
    .prudence { border: 1px solid #d97706; background: color-mix(in srgb, #f59e0b 12%, var(--gf-surface)); border-radius: var(--gf-radius); padding: 8px 12px; margin-bottom: 10px; }
    .prudence.grave { border-color: #b91c1c; background: color-mix(in srgb, #ef4444 10%, var(--gf-surface)); }
    .prudence .verdict { margin: 0 0 6px; }
    .prudence ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .prudence li { display: flex; gap: 8px; align-items: baseline; font-size: 0.9rem; line-height: 1.35; }
    .prudence li svg { flex: none; color: #d97706; }
    /* data-level, not a class: .danger is the shared stylesheet's destructive look (styles/ui.js). */
    .prudence li[data-level='danger'] svg { color: #b91c1c; }
    .prudence li[data-level='deadly'] svg { color: var(--gf-deadly); }
    .prudence li[data-level='info'] svg { color: var(--gf-text-muted); }
    .prudence p { margin: 8px 0 0; }
    .prudence .sos a { color: inherit; }
    .prudence li button.link { min-height: 0; padding: 0 4px; font-size: inherit; }
    .no-tox { margin: 0 0 10px; padding: 6px 10px; border-left: 3px solid var(--gf-text-muted); color: var(--gf-text-muted); }
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
     * The plant pane's tree of panes (King: « Déplacer vers… », a drag): panes on the top, left, right or bottom
     * of the sheet, which scrolls between them. Bands S / M / L high (or dragged), columns S / M / L wide.
     */
    :host { container-type: inline-size; }
    :host([edged]) { overflow: hidden; display: flex; flex-direction: column; padding: 0; }
    .frame.edged { position: relative; flex: 1; min-height: 0; display: flex; }
    :host([edged]) > .frame.edged { height: 100%; }
    /* The tree: splits in rows and columns, each child its share (flex), a grip between two. */
    .split { flex: 1; min-width: 0; min-height: 0; display: flex; }
    .split.row { flex-direction: row; } .split.col { flex-direction: column; }
    .cell { display: flex; min-width: 0; min-height: 0; }
    /* The media's pane keeps the room its viewer needs (its image, zoom bar and thumbnails never overlap). */
    .split.col > .cell:not(.folded):has(gf-media-viewer:not([compact])) { min-height: 400px; }
    .split.row > .cell:not(.folded):has(gf-media-viewer:not([compact])) { min-width: 280px; }
    .cell > * { flex: 1; min-width: 0; min-height: 0; }
    .cell.folded { flex: 0 0 auto !important; }
    /* The grips between them: core/split-grip.js (gripStyles, at the end of the styles). */
    .frame.edged .main { flex: 1; min-width: 0; min-height: 0; overflow-y: auto; padding: 0 16px; }
    :host([embedded]) .frame.edged .main { padding: 0 14px; }
    /* Narrow: the panes as bands above and under the sheet, sharing the height left to it. */
    .frame.edged.narrow { flex-direction: column; }
    /* (Personalising, the bar « Mise en page de la fiche » above the frame takes its share first: --kb-h.) */
    .band-cell { flex: none; height: min(calc((var(--host-h, 80vh) - var(--kb-h, 0px)) * 0.45), calc((var(--host-h, 80vh) - var(--kb-h, 0px) - 220px) / var(--bands, 1)));
      border-bottom: 1px solid var(--gf-border); }
    .band-cell.folded { height: auto; }
    /* A narrow sheet: the media's band too keeps the room its viewer needs. */
    .band-cell:not(.folded):has(gf-media-viewer:not([compact])) { min-height: 400px; }
    .panes-only .band-cell.grow { flex: 1 0 300px; height: auto; }
    .frame.edged.narrow.panes-only { overflow-y: auto; }
    /* Panes only (Découvrir): the tree left without its sheet fills the whole frame — one pane alone too. */
    .frame.edged.panes-only:not(.narrow) > * { flex: 1 1 0; min-width: 0; }
    .edge { position: relative; z-index: 7; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--gf-bg, var(--gf-surface-2)); }
    /* Over the whole plant pane for a while (the frame holds it: the cells are not positioned). */
    .edge.max { position: absolute; inset: 0; z-index: 30; box-shadow: var(--gf-shadow-float); }
    .edge-bar { flex: none; display: flex; align-items: center; gap: 4px; min-height: 36px; padding: 2px 6px 2px 8px; color: var(--gf-text-muted); font-size: 0.75rem; }
    /* The media's controls in its header (type, part, count): what the viewer's own line held. */
    .media-ctl { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: 6px; overflow-x: auto; scrollbar-width: none; color: var(--gf-text); }
    .media-ctl:empty { display: none; }
    .media-ctl::-webkit-scrollbar { display: none; }
    .media-ctl select { font: inherit; font-size: 0.78rem; padding: 2px 4px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-sm); background: var(--gf-surface); color: var(--gf-text); max-width: 150px; min-height: 0; height: 28px; }
    .media-ctl .count { color: var(--gf-text-muted); font-variant-numeric: tabular-nums; font-size: 0.78rem; white-space: nowrap; }
    .media-ctl .parts { flex: none; display: flex; gap: 1px; padding: 2px; border-radius: var(--gf-radius-pill); background: var(--gf-surface-2); }
    .media-ctl .parts button { width: 26px; height: 24px; min-height: 0; padding: 0; border: 0; border-radius: var(--gf-radius-pill); background: none; color: var(--gf-text-muted); display: grid; place-items: center; cursor: pointer; font-size: 0.8rem; }
    .media-ctl .parts button[aria-checked='true'] { background: var(--gf-surface); color: var(--gf-accent); box-shadow: 0 1px 3px rgb(0 0 0 / 15%); }
    .media-ctl .parts button:disabled { opacity: 0.3; cursor: default; }
    .media-ctl .icon-btn { width: 28px; height: 28px; min-height: 0; }
    .media-ctl .back-mosaic { white-space: nowrap; font-size: 0.78rem; }
    .edge-bar:has(.media-ctl:not(:empty)) .edge-tabs .tab-name { display: none; }
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
    .opts-pop label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    .edge-body { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; padding: 4px 12px 10px; overscroll-behavior: contain; }
    .edge.bare .edge-body { padding: 0; }
    .edge.bare .edge-body > .block { margin: 0; }
    /* The bar names the edge's blocks: no second title (King shows the block's tools). */
    .edge:not(.king) .edge-body > .block > h2.block-title, .edge:not(.king) .edge-body > .block > .to-pane { display: none; }
    .edge-body > .block { margin-top: 0; }
    .edge-body > .block.map-block, .edge-body > .block[data-key='media'] { flex: 1 0 200px; display: flex; flex-direction: column; min-height: 0; }
    .edge-body > .block.map-block > .content, .edge-body > .block[data-key='media'] > .content { flex: 1; display: flex; flex-direction: column; min-height: 0; }
    .edge-body .map-placeholder.fill { flex: 1; height: auto !important; }
    .edge-body gf-media-viewer { flex: 1; min-height: 0; }
    .edge-body > .block[data-key='web'] { flex: 1 0 260px; display: flex; flex-direction: column; min-height: 0; }
    .edge-body > .block[data-key='web'] > .content { flex: 1; display: flex; flex-direction: column; min-height: 0; }
    .edge-body:has(> .block[data-key='web']) { padding: 0; }
    gf-sheet-map[fill] { flex: 1; min-height: 0; }
    /* Folded: its bar only (a column: a strip of its blocks' icons). */
    .edge.col.folded { width: 44px; }
    .edge.col.folded .edge-bar { flex-direction: column; padding: 6px 4px; gap: 6px; }
    .edge.col.folded .edge-tabs { flex-direction: column; overflow: visible; }
    .edge.col.folded .tab-name { display: none; }
    .edge.col .edge-tabs .tab-name { overflow: hidden; text-overflow: ellipsis; }
    /* Personalising: a folded pane drawn open, its bar saying so. */
    .edge-bar .fold-note { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.7rem; color: var(--gf-text-muted); }
    /* Without title or frame: the block fills the edge; its tabs and « agrandir » float over it. */
    .edge-float { position: absolute; top: 6px; left: 6px; z-index: 3; display: flex; gap: 4px; padding: 2px; border-radius: var(--gf-radius-sm); background: color-mix(in srgb, var(--gf-surface) 85%, transparent); box-shadow: var(--gf-shadow); }
    .edge-float .tab-name { display: none; }
    /* King: « Déplacer vers… » a block — the sheet, a new pane on a side, a tab of a pane. */
    .place-pick { position: relative; flex: none; }
    .place-pick > summary { list-style: none; display: inline-grid; place-items: center; cursor: pointer; }
    .place-pick > summary::-webkit-details-marker { display: none; }
    .move-menu { position: absolute; right: 0; top: 100%; z-index: 40; display: grid; min-width: 230px; padding: 6px; background: var(--gf-surface); border: 1px solid var(--gf-border);
      border-radius: var(--gf-radius); box-shadow: var(--gf-shadow-float); text-transform: none; letter-spacing: 0; font-weight: 400; }
    .move-menu button { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 32px; padding: 4px 8px; border: 0; border-radius: var(--gf-radius-sm); background: none;
      color: var(--gf-text); font: inherit; font-size: 0.85rem; text-align: left; cursor: pointer; }
    .move-menu button:hover:not(:disabled), .move-menu button:focus-visible { background: var(--gf-accent-soft); outline: none; }
    .move-menu button:disabled { opacity: 0.45; cursor: default; }
    .said { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    /* King: the blocks to add, as chips to drag. */
    .palette { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0 0 10px; padding: 8px 10px; border: 1px dashed var(--gf-border); border-radius: var(--gf-radius); }
    .palette .pal-title { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--gf-text-muted); display: inline-flex; gap: 4px; align-items: center; }
    .palette .chip { display: inline-flex; gap: 5px; align-items: center; min-height: 28px; padding: 2px 10px; border: 1px solid var(--gf-border); border-radius: var(--gf-radius-pill);
      background: var(--gf-surface); font: inherit; font-size: 0.8rem; cursor: grab; touch-action: none; }
    .palette .chip.new { border-style: dashed; color: var(--gf-accent); }
    :host([docking]) { user-select: none; -webkit-user-select: none; }
    :host([docking]) .block-title, :host([docking]) .edge-tabs button { cursor: grabbing; }
    /*
     * The rubrics, like the filters' facets: the blocks gathered by rubric, each rubric under its header, stuck
     * while the rubric is read. « full » (room enough): the wrapper has no box, so every header sticks along the
     * whole list — those passed stacked at the top, those to come waiting stacked at the bottom, above the action
     * bar. « push »: the rubric is a box, its header alone at the top, pushed away by the next one's. Under the
     * headers: the block read's title (level 1), then the article's theme read (level 2). Where the reading is, is
     * drawn by the browser alone: nothing is computed while scrolling.
     */
    .rubric { display: contents; --lvl1: calc((var(--stack, 0) + 1) * var(--rub-h)); }
    :host(:not([stack='full'])) .rubric { display: block; --lvl1: var(--rub-h); }
    .rub-mark { display: block; height: 0; scroll-margin-top: calc(var(--stack, 0) * var(--rub-h)); }
    :host(:not([stack='full'])) .rub-mark { scroll-margin-top: 0; }
    .rub-head { position: sticky; z-index: 5; top: 0; box-sizing: border-box; height: var(--rub-h); margin: 0 -6px; padding: 0 2px 0 6px;
      display: flex; align-items: center; gap: 2px; background: var(--gf-surface); border-bottom: 1px solid var(--gf-border);
      font-size: 0.82rem; font-weight: 600; letter-spacing: 0; text-transform: none; }
    :host([stack='full']) .rub-head { top: calc(var(--stack, 0) * var(--rub-h)); bottom: calc((var(--count, 1) - var(--stack, 0) - 1) * var(--rub-h) + var(--bar-h, 0px));
      box-shadow: 0 -1px 0 var(--gf-border); }
    .rubric:first-of-type > .rub-mark { margin-top: 14px; }
    .rub-go { flex: 1; min-width: 0; height: 100%; min-height: 0; display: flex; align-items: center; justify-content: flex-start; gap: 8px; padding: 0; border: 0; border-radius: 0; background: none; color: var(--gf-text);
      font: inherit; text-align: left; cursor: pointer; }
    .rub-go:focus-visible, .rub-toc:focus-visible { outline: none; box-shadow: var(--gf-focus); border-radius: var(--gf-radius-sm); }
    .rub-ic { flex: none; display: grid; place-items: center; width: 22px; color: var(--gf-accent); font-size: 0.95rem; }
    .rub-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rub-badge { flex: none; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: var(--gf-radius-pill); display: inline-grid; place-items: center;
      font-size: 0.7rem; font-weight: 700; color: #fff; background: var(--gf-warn, #b45309); }
    .rub-badge.danger { background: var(--gf-danger, #dc2626); }
    .rub-badge.deadly { background: var(--gf-deadly); color: var(--gf-deadly-contrast); }
    .rub-badge.info { background: var(--gf-text-muted); }
    @media (prefers-color-scheme: dark) { .rub-badge { color: #1d1405; } }
    .rub-toc { flex: none; width: 28px; height: 28px; min-height: 0; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; background: none; color: var(--gf-text-muted); cursor: pointer; }
    .rub-toc:hover, .rub-go:hover .rub-label { color: var(--gf-text); }
    .rub-head[data-flash] { animation: rub-flash 1.2s ease-out; }
    @keyframes rub-flash { from { background: var(--gf-accent-soft); } }
    .rub-note { margin: 8px 0 4px; font-size: 0.82rem; color: var(--gf-text-muted); }
    .rubric > .block { scroll-margin-top: var(--lvl1); }
    .rubric > .block > .block-title { position: sticky; top: var(--lvl1); z-index: 4; background: var(--gf-surface); margin: 0 -6px 8px; padding: 4px 6px; box-shadow: 0 1px 0 var(--gf-border); }
    .rubric > .block > .wiki-theme, .rubric .wiki-theme { scroll-margin-top: var(--lvl1); }
    .rubric .wiki-theme[open] > summary { position: sticky; top: var(--lvl1); z-index: 3; background: var(--gf-surface); box-shadow: 0 1px 0 var(--gf-border); }
    .rubric > .block:not(.headless) .wiki-theme { scroll-margin-top: calc(var(--lvl1) + var(--title-h, 38px)); }
    .rubric > .block:not(.headless) .wiki-theme[open] > summary { top: calc(var(--lvl1) + var(--title-h, 38px)); }
    /* Room after the last rubric: it too comes right under the rubrics stuck above it. */
    .blocks.rubrics { --room-stack: var(--rub-h); --room-gap: 160px; }
    :host([stack='full']) .blocks.rubrics { --room-stack: calc(var(--count, 1) * var(--rub-h)); --room-gap: 120px; }
    :host(:not([edged])) .blocks.rubrics::after, .frame.edged .main[data-drop-node='sheet'] .blocks.rubrics::after { content: ''; display: block; flex: none;
      height: max(0px, calc(var(--sheet-h, 100vh) - var(--room-stack) - var(--bar-h, 0px) - var(--room-gap))); }
    /* King: the plain list — any block can come under the top (room after the last one). */
    .frame.edged .main[data-drop-node='sheet']:has(.blocks.king)::after { content: ''; display: block; height: max(0px, calc(100% - 160px)); }
    /* The table of contents: over everything (the top layer), under the header touched. */
    .toc { position: fixed; inset: auto; margin: 0; width: min(300px, calc(100vw - 16px)); max-height: min(70vh, 560px); overflow-y: auto; padding: 8px; box-sizing: border-box;
      border: 1px solid var(--gf-border); border-radius: var(--gf-radius); background: var(--gf-surface); color: var(--gf-text); box-shadow: var(--gf-shadow-float); }
    .toc { display: none; }
    .toc[data-open] { display: block; }
    .toc:popover-open { display: block; }
    .toc:focus { outline: none; }
    .toc-head { display: flex; align-items: center; gap: 8px; padding: 2px 4px 6px; border-bottom: 1px solid var(--gf-border); margin-bottom: 4px;
      position: sticky; top: -8px; z-index: 1; background: var(--gf-surface); }
    .toc { overscroll-behavior: contain; }
    .blocks .block[tabindex='-1']:focus { outline: none; }
    .toc-head b { flex: 1; }
    .toc-head .entity { font-size: 0.7rem; font-weight: 600; padding: 1px 8px; border-radius: var(--gf-radius-pill); background: var(--gf-surface-2); color: var(--gf-text-muted); }
    .toc-lock[aria-pressed='true'] { color: var(--gf-accent); }
    .toc ul { list-style: none; margin: 0; padding: 0; }
    .toc ul ul { padding-left: 30px; }
    .toc ul ul.subs { padding-left: 14px; }
    .toc button { display: flex; align-items: center; justify-content: flex-start; gap: 8px; width: 100%; min-height: 32px; padding: 4px 6px; border: 0; border-radius: var(--gf-radius-sm); background: none;
      color: var(--gf-text); font: inherit; font-size: 0.86rem; text-align: left; cursor: pointer; }
    .toc button:hover, .toc button:focus-visible { background: var(--gf-surface-2); outline: none; }
    .toc .toc-rub { font-weight: 600; }
    .toc .toc-rub .bi { color: var(--gf-accent); }
    .toc .toc-rub span:not(.rub-badge) { flex: 1; }
    .toc ul ul button { color: var(--gf-text-muted); font-size: 0.82rem; min-height: 28px; }
    .toc button[aria-current] { background: var(--gf-accent-soft); color: var(--gf-text); }
    .block[data-flash] { animation: flash 1.2s ease-out; }
    @keyframes flash { from { box-shadow: 0 0 0 3px var(--gf-accent); } to { box-shadow: 0 0 0 3px transparent; } }
    @media (prefers-reduced-motion: reduce) { .skeleton { animation: none; } .block[data-flash], .rub-head[data-flash] { animation: none; } }
    /* Personalising a narrow list (a phone, a sheet squeezed by its panes, a pane): the grip and the name on the first
       line, the tools under; « Déplacer vers… » across the title row. */
    @container (max-width: 420px) {
      .king .block-title :is(.name, input.rename) { flex: 1 0 calc(100% - 52px); }
      .king .block-title .off-note { flex: 1 1 100%; }
      .king .block-title .move-menu { left: 0; right: 0; min-width: 0; }
    }
    /* A finger: every target of the personalised sheet at 44 px (last: over the sizes above). */
    @media (pointer: coarse) {
      .grip, .block-title .tool, .place-pick > summary { width: 44px; height: 44px; }
      .block-title .styles button { min-height: 44px; }
      .action-bar .act-toggle { width: 44px; height: 44px; top: 0; right: 0; }
      .king-bar button, .palette .chip, .move-menu button { min-height: 44px; }
    }
  `, gripStyles];

  constructor() {
    super();
    /** @type {number} */
    this.plantId = 0;
    /** The image its « Médias » open at (a mini-app's &m=). @type {number} */
    this.mediaAt = 0;
    /** @type {any} */
    this._plant = undefined;
    /** @type {any} */
    this._details = undefined;
    /** @type {string | null} */
    this._error = null;
    /** @type {string | null} */
    this._shareNote = null;
    this.view = 'standard';
    /** @type {string | null} */
    this.sheet = null;
    this.preview = false;
    this.scoped = false;
    /** @type {string | null} */
    this.only = null;
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
    this.subheading = false;
    this.titled = false;
    /** @type {string[] | null} */
    this.paneKeys = null;
    /** @type {import('../core/pane-tree.js').PaneNode | null} */
    this.tree = null;
    this._newNote = false;
    /** Note block whose text was just saved. @type {string | null} */
    this._noteSaved = null;
    /** Note block whose text could not be stored (storage full or unavailable). @type {string | null} */
    this._noteFailed = null;
    /** @type {any} */ this._wiki = undefined;
    /** @type {Set<string>} */
    this._wikiOpen = new Set();
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
    /** What the opened blocks loaded (undefined: not yet; null: nothing). @type {{ interactions?: any, niche?: any, here?: any, safety?: any, confusions?: any, recipes?: any, wdUses?: any, herbarium?: any, photos?: any }} */
    this._open = {};
    /**
     * The loads that failed (a source unavailable, not a module switched off), by load key ('wiki', 'gbif:stats',
     * 'details:gbif'…): the blocks they feed say « Source indisponible — Réessayer », not « aucune donnée ».
     * @type {Record<string, any>}
     */
    this._failed = {};
    // A value touched in a block: the maps show it (touched again, it goes).
    this.addEventListener(FOCUS_EVENT, e => {
      e.stopPropagation();
      this._focus = toggleFocus(this._focus, /** @type {CustomEvent} */ (e).detail);
    });
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

  /** The note texts read (at startup) or changed in another tab: shown. */
  #onNotes = () => this.requestUpdate();

  connectedCallback() {
    super.connectedCallback();
    notesEvents.addEventListener('change', this.#onNotes);
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
    if (changed.has('preview') && changed.get('preview') === true && !this.preview) this.#promoted = true;
    // Another view (the host's, or the one arranged here) or King opened or closed here reorders the sheet: the place
    // read now is reached again once drawn (#placeAgain).
    const king = this.#kingHere, view = this.#view;
    const viewChanged = view !== this.#lastView;
    if (this.#placed && this._plant && !this.preview && !this.only && !this.panesOnly && ((viewChanged && this.#lastView !== null) || king !== this.#king)) {
      const { cat, block, wiki } = this.#readPlace();
      if (cat || block) this.#rePlace = { cat, block, wiki };
    }
    this.#king = king;
    this.#lastView = view;
    // The panels opened follow to the next plant (not from a preview card, which is not read).
    if (!this.preview && !this.only) {
      if (changed.has('_subsOpen')) sheetSession.subsOpen = this._subsOpen;
      if (changed.has('_mapsOpen')) sheetSession.mapsOpen = this._mapsOpen;
      // (A pane of a host's own tree made bigger is that host's: not the next sheet's.)
      if (changed.has('_maxEdge') && !this.tree) sheetSession.maxEdge = this._maxEdge;
      if (changed.has('_spotsOpen')) sheetSession.spotsOpen = this._spotsOpen;
      // The themes of the article opened or closed (not the sections read whole, which are this plant's).
      if (changed.has('_wikiOpen')) sheetSession.wikiThemes = new Set([...this._wikiOpen].filter(k => /^(theme|closed):/.test(k)));
    }
    const signature = modulesSignature();
    const hidden = this.#store.state.sheetLayout;
    const modulesChanged = this.#signature !== null && signature !== this.#signature;
    const hiddenChanged = hidden !== this.#hidden;
    this.#signature = signature;
    this.#hidden = hidden;
    if (changed.has('plantId')) { this.#load(this.plantId); return; }
    // The card underneath became the sheet.
    if (changed.has('preview') && !this.preview) this.#title();
    // A module switched on or off (Réglages › Modules): its data comes or goes.
    if (modulesChanged) this.#refresh();
    // Blocks folded or shown, another view (the card underneath come on top in the mode arranged here too): what it
    // shows now (each load once per plant).
    else if ((hiddenChanged || viewChanged) && this._plant && this._details !== undefined) this.#loadExtras(this._plant, this._details, this.#abort?.signal);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    notesEvents.removeEventListener('change', this.#onNotes);
    for (const ev of ['touchend', 'touchcancel', 'pointerup', 'pointercancel']) window.removeEventListener(ev, this.#onLift, { capture: true });
    this.#touching = this.#buttonDown = false;
    unregisterWebPane(this);
    this.#resize.disconnect();
    this.#barSize.disconnect();
    this.#barSeen = null;
    this.#abort?.abort();
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
    if (!this.preview && !this.only && plant && !plant.failed) document.title = nameOf(plant) + ' — GeoFlora';
  }

  /** @param {number} id */
  async #load(id) {
    // The hand had just stopped on the previous plant: its place is noted now, before it goes.
    if (this.#readTimer) { clearTimeout(this.#readTimer); this.#readTimer = 0; if (this.#handAt && this._plant) this.#noteRead(); }
    this.#handAt = 0;
    this.#lastPlace = null;
    this.#pending = new Set();
    this.#loadStart = performance.now();
    this.#abort?.abort();
    const abort = this.#abort = new AbortController();
    this._plant = undefined;
    this._details = undefined;
    this._error = null;
    this._wiki = undefined;
    this._wikiOpen = new Set(sheetSession.wikiThemes);
    this._science = undefined;
    this._gbif = {};
    this._near = undefined;
    this._spotsOpen = sheetSession.spotsOpen;
    this._focus = noFocus();
    this._open = {};
    this._failed = {};
    this._verdict = null;
    this.#requested.clear();
    this.#letGo();
    this.scrollTop = 0;
    this.#placed = false;

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
    verdictOf(plant).then(v => { if (!abort.signal.aborted) this._verdict = v; }, () => {});

    try {
      const details = await sources.details(plant, abort.signal);
      if (!abort.signal.aborted) { this._details = details; this.#noteDetails(details); }
      if (!abort.signal.aborted) this.#loadExtras(plant, details, abort.signal);
    } catch (error) {
      if (!abort.signal.aborted) {
        if (isUnavailable(error)) this._failed = { ...this._failed, 'details:all': error };
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
    this.#loadStart = performance.now();
    this._wiki = undefined;
    this._science = undefined;
    this._gbif = {};
    this._near = undefined;
    this._failed = {};
    this._error = null;
    const details = await sources.details(plant, abort.signal).catch(error => {
      if (!abort.signal.aborted && isUnavailable(error)) this._failed = { ...this._failed, 'details:all': error };
      return null;
    });
    if (abort.signal.aborted) return;
    this._details = details;
    this.#noteDetails(details);
    this.#loadExtras(plant, details, abort.signal);
  }

  /**
   * The services the details could not reach (lib/plant-sources.mjs `unavailable`): their blocks say so, with « Réessayer ».
   * @param {any} details
   */
  #noteDetails(details) {
    const down = details?.unavailable || [];
    if (!down.length) return;
    this._failed = { ...this._failed, ...Object.fromEntries(down.map((/** @type {string} */ s) => ['details:' + s, { source: s }])) };
  }

  /**
   * « Réessayer » on a block: the failures remembered are forgotten (core/cache.js) and what failed is asked again —
   * the details and everything after them when they were incomplete, else only the loads that failed.
   */
  #retry() {
    const plant = this._plant;
    if (!plant?.id) return;
    forgetFailures();
    const keys = Object.keys(this._failed);
    this._failed = {};
    if (keys.some(k => k.startsWith('details:'))) { this.#refresh(); return; }
    /** @type {Record<string, any>} */
    const open = { ...this._open };
    const gbif = { ...this._gbif };
    for (const k of keys) {
      this.#requested.delete(k);
      if (k === 'wiki') this._wiki = undefined;
      else if (k === 'science') this._science = undefined;
      else if (k.startsWith('gbif:')) delete gbif[k.slice(5)];
      else if (OPEN_KEYS[k]) delete open[OPEN_KEYS[k]];
    }
    this._open = open;
    this._gbif = gbif;
    this.#loadExtras(plant, this._details, this.#abort?.signal);
  }

  /** The loads of a block that failed (see BLOCK_LOADS). @param {string} key @returns {any[]} */
  #down(key) {
    const loads = BLOCK_LOADS[key];
    if (!loads) return [];
    const failed = this._failed;
    return Object.keys(failed).filter(k => k === 'details:all' || loads.includes(k)).map(k => failed[k]);
  }

  /**
   * What the shown blocks need beyond the details, in every view: the Wikipedia summary, the Wikidata
   * classification, IUCN status and identifiers, the GBIF count in France. A folded block fetches nothing;
   * each loads once per plant.
   * @param {any} plant @param {any} details @param {AbortSignal} [signal]
   */
  #loadExtras(plant, details, signal) {
    const v = this.#view;
    // In a pane: that block's data only.
    const shown = (/** @type {string} */ key) => this.only ? key === this.only : !isHidden(v, key);
    const qid = plant.identifiers?.wikidata || details?.identifiers?.wikidata?.id;
    // Each load in flight is counted: a place reached is kept while the data still arrives (#keep).
    const pending = this.#pending;
    // A load that fails: null for its value, and, when its source is unavailable (not a module switched off), noted
    // under its key so its blocks say so (#down).
    const settle = (/** @type {Promise<any>} */ task, /** @type {(v: any) => void} */ set, /** @type {string} */ key = '') => {
      const done = task.then(v => { if (!signal?.aborted && this._plant === plant) set(v ?? null); })
        .catch(error => {
          if (signal?.aborted || this._plant !== plant) return;
          if (key && isUnavailable(error)) this._failed = { ...this._failed, [key]: error };
          set(null);
        });
      pending.add(done);
      done.finally(() => { pending.delete(done); if (!pending.size && pending === this.#pending) this.requestUpdate(); });
    };
    const once = (/** @type {string} */ key) => !this.#requested.has(key) && Boolean(this.#requested.add(key));
    // Wikipédia feeds its block and, by theme, Descriptions, Calendrier, Habitat, Occurrences, Usages and Noms.
    if (['wikipedia', 'descriptions', 'calendar', 'gbifProfile', 'occurrences', 'uses', 'names'].some(shown) && once('wiki')) settle(sources.wikipedia(plant, qid, signal), x => { this._wiki = x; }, 'wiki');
    const science = shown('ids') || (baseOf(v) === 'scientific' && (shown('taxonomy') || shown('status')));
    if (science && once('science')) settle(sources.wikidataScience(plant, qid, signal), x => { this._science = x; }, 'science');
    this.#loadGbif(plant, details, signal, settle, once, shown);
    const putOpen = (/** @type {string} */ k, /** @type {any} */ x) => { this._open = { ...this._open, [k]: x }; };
    if (shown('interactions') && once('globi')) settle(openData.interactions(plant.scientificName, signal), x => putOpen('interactions', x), 'globi');
    const gbifKey = details?.identifiers?.gbif?.id ?? null;
    if (shown('climate') && !isSubHidden(v, 'climate', 'niche') && details !== undefined && once('niche')) {
      if (gbifKey) settle(openData.climateNiche(gbifKey, signal), x => putOpen('niche', x), 'niche'); else putOpen('niche', null);
    }
    // « Usages et cuisine sauvage »: the local safety file first, then Wikidata and Wikibooks.
    if (shown('uses')) {
      if (once('uses:safety')) {
        const [safety, confusions] = this.#safetyTasks(plant);
        settle(safety, x => putOpen('safety', x));
        settle(confusions, x => putOpen('confusions', x));
      }
      const usesQid = plant.identifiers?.wikidata || details?.identifiers?.wikidata?.id;
      if (details !== undefined && once('uses:wikidata')) {
        if (usesQid && moduleOn('wikidata')) settle(usesData.wikidataUses(usesQid, signal), x => putOpen('wdUses', x), 'uses:wikidata'); else putOpen('wdUses', null);
      }
      if (!isSubHidden(v, 'uses', 'kitchen') && once('uses:recipes')) {
        if (moduleOn('wikibooks')) settle(usesData.recipes({ french: commonOf(plant), latin: plant.scientificName }, signal), x => putOpen('recipes', x), 'uses:recipes');
        else putOpen('recipes', null);
      }
    }
    // My position already known in this visit: its pollen and climate come with the sheet.
    if (shown('climate') && hereAllowed && once('here')) queueMicrotask(() => this.#findHere());
  }

  /**
   * The local safety data of « Usages » (Prudence): the safety file's entry (null: none) and the plant's confusions,
   * UNREAD when a file could not be read. @param {any} plant
   */
  #safetyTasks(plant) {
    return [usesData.safetyOf(plant).catch(() => UNREAD), lookalikesOf(plant).catch(() => UNREAD)];
  }

  /**
   * « Réessayer »: the safety and look-alikes files read again (a file that failed is asked again), with the
   * alerts. `lookalikes`: also the « Plantes à confondre » blocks (the retry did not come from one of them).
   */
  #retrySafety(lookalikes = true) {
    const plant = this._plant;
    if (!plant?.id) return;
    if (lookalikes) for (const el of this.renderRoot.querySelectorAll('gf-lookalikes')) /** @type {any} */ (el).reload();
    const put = (/** @type {string} */ k, /** @type {any} */ x) => { if (this._plant === plant) this._open = { ...this._open, [k]: x ?? null }; };
    const [safety, confusions] = this.#safetyTasks(plant);
    safety.then(x => put('safety', x));
    confusions.then(x => put('confusions', x));
    verdictOf(plant).then(v => { if (this._plant === plant) this._verdict = v; }, () => {});
  }

  /** Pollen and climate at my position (asked once; later sheets of the visit reuse it). */
  async #findHere() {
    const plant = this._plant;
    hereAllowed = true;
    this._open = { ...this._open, here: { state: 'locating' } };
    const known = lastFix();
    // A fix of the last half hour if known, else the GPS asked once: a fix of the last five minutes, or why there is
    // none (20 s at most).
    const fix = known && Date.now() - known.timestamp < 30 * 60000 ? known : await oneFix({ maxAge: 5 * 60000, timeout: 20000 });
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
   * @param {(task: Promise<any>, set: (v: any) => void, key?: string) => void} settle @param {(key: string) => boolean} once
   * @param {(key: string) => boolean} shown
   */
  #loadGbif(plant, details, signal, settle, once, shown) {
    const v = this.#view;
    if (details === undefined) return;
    const key = details?.identifiers?.gbif?.id ?? null;
    const sub = (/** @type {string} */ block, /** @type {string} */ k) => shown(block) && !isSubHidden(v, block, k);
    const put = (/** @type {string} */ name, /** @type {any} */ value) => { this._gbif = { ...this._gbif, [name]: value }; };
    const part = (/** @type {string} */ name, /** @type {() => Promise<any>} */ load) => {
      if (!once('gbif:' + name)) return;
      if (!key) { put(name, null); return; }
      settle(load(), x => put(name, x), 'gbif:' + name);
    };
    const species = (/** @type {string} */ name, /** @type {string} */ api = name) => part(name, () => sources.gbifSpecies(plant, key, api, signal));
    if (shown('names')) species('vernacularNames');
    if (shown('descriptions')) species('descriptions');
    if (sub('occurrences', 'distribution')) species('distributions');
    if (shown('gbifProfile')) species('speciesProfiles');
    if (baseOf(v) === 'scientific' && sub('taxonomy', 'gbifSynonyms')) species('synonyms');
    if (baseOf(v) === 'scientific' && sub('status', 'iucn')) species('iucn', 'iucnRedListCategory');
    if (['gbif', 'months', 'years', 'regions', 'basis', 'datasets'].some(k => sub('occurrences', k))) {
      part('stats', () => sources.gbifStats(plant, key, signal).then(stats => { this.#loadTitles(stats, signal); return stats; }));
    }
    if (!this.#store.state.modules.photos) { if (once('gbif:noPhotos')) { put('photos', []); put('herbarium', []); } }
    else {
      if (sub('gbifMedia', 'photos')) part('photos', () => sources.gbifMedia(plant, key, 'photos', signal));
      if (sub('gbifMedia', 'herbarium')) part('herbarium', () => sources.gbifMedia(plant, key, 'herbarium', signal));
    }
    if (shown('literature')) part('literature', () => sources.gbifLiterature(plant, key, signal));
    // « Près d’ici » asked on an earlier sheet of this visit: look around again, without asking.
    if (nearAllowed && key && sub('occurrences', 'near') && once('gbif:near')) queueMicrotask(() => this.#findNear());
    // Arrived before the region and source names were shown: name them now.
    if (this._gbif.stats) this.#loadTitles(this._gbif.stats, signal);
  }

  /** Names of the top sources and of the areas the plant is found in (each fetched once, then cached). @param {any} stats @param {AbortSignal} [signal] */
  #loadTitles(stats, signal) {
    if (!stats) return;
    const v = this.#view;
    const shown = (/** @type {string} */ k) => !isHidden(v, 'occurrences') && !isSubHidden(v, 'occurrences', k);
    /** @type {[string, Promise<string | null>][]} */
    const wanted = [];
    const titles = this._gbif.titles || {};
    if (shown('datasets')) for (const d of stats.datasets) if (!(d.key in titles)) wanted.push([d.key, sources.gbifDatasetTitle(d.key, signal)]);
    if (shown('regions')) {
      for (const r of stats.regions) if (!(r.gid in titles)) wanted.push([r.gid, sources.gadmName(r.gid, signal)]);
      for (const d of stats.departments.slice(0, 5)) if (!(d.gid in titles)) wanted.push([d.gid, sources.gadmName(d.gid, signal)]);
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

  /** A host's sheet, read as such: « Personnaliser la fiche » can open here (its crown). */
  get #crownable() { return Boolean(this.sheet) && !this.preview && !this.only && !this.panesOnly && !this.tree && !this.scoped; }

  /** « Personnaliser la fiche » (code name: King) open on this sheet. */
  get #kingHere() { return this.#crownable && this.#store.state.king?.sheet === this.sheet; }

  /**
   * The mode shown: the one arranged here while King is open (its bar), else the host's view. The card underneath
   * (Flore's next plant) is drawn and loaded in the mode arranged on its sheet too, without King's tools: on top, it
   * stays as it is. @returns {string}
   */
  get #view() {
    const arranged = this.#kingHere || (this.preview && this.#store.state.king?.sheet === this.sheet && Boolean(this.sheet)
      && !this.only && !this.panesOnly && !this.tree && !this.scoped);
    return arranged ? arrangedMode(/** @type {string} */ (this.sheet), this.view) : this.view;
  }

  /**
   * The parts of a block this view shows, in the order chosen for it (King › Sous-blocs). `parts`: sub-block
   * key → its markup, or nothing when this view or this plant has none.
   * @param {string} block @param {Record<string, () => unknown>} parts
   */
  #subs(block, parts) {
    return shownSubs(this.#view, block).map(k => parts[k]?.() ?? nothing).filter(x => x !== nothing);
  }

  /**
   * The action bar, docked at the bottom of the sheet (above the tab bar on a phone): the actions this view
   * shows, in its order. King shows them all, each with its ☑ (shown or not in this view), the actions inert meanwhile.
   * @param {any} plant
   */
  #actionBar(plant) {
    const v = this.#view;
    const king = this.#kingHere, crown = this.#crownable;
    const fav = this.#store.state.favorites.has(plant.id);
    const name = nameOf(plant);
    /** @type {Record<string, () => unknown>} */
    const buttons = {
      fav: () => html`<button type="button" class="fav" ?inert=${king} aria-pressed=${fav ? 'true' : 'false'} @click=${() => toggleFavorite(plant)}>
        ${icon(fav ? 'heart-fill' : 'heart')}<span>Favori</span></button>`,
      addTo: () => html`<button type="button" ?inert=${king} @click=${() => /** @type {any} */ (this.renderRoot.querySelector('gf-add-to'))?.open()}>${icon('plus-lg')}<span>Ajouter à…</span></button>`,
      share: () => html`<button type="button" ?inert=${king} @click=${() => this.#share(plant, name)}>${icon('share')}<span>Partager</span></button>`,
      // The Carte filtered on this plant (its places, its GBIF distribution).
      map: () => html`<a class="button" ?inert=${king} href=${href.map({ plant: plant.id })}>${icon('map')}<span>Carte</span></a>`,
      // In one tap, into the collection or place last opened (context.js), when it is not there yet.
      addCurrent: () => {
        const current = this.#currentCollection(plant);
        if (!current) return king ? html`<button type="button" disabled title="Ouvrez une liste ou un lieu : vous y ajouterez d’un geste">${icon('plus-lg')}<span>Liste ou lieu en cours</span></button>` : nothing;
        return html`<button type="button" ?inert=${king} title=${'Ajouter à « ' + current.name + ' »'} @click=${() => this.#addCurrent(plant, current)}>
          ${icon(current.kind === 'place' ? 'geo-alt-fill' : 'plus-lg')}<span class="short">${current.name}</span></button>`;
      },
      spot: () => html`<a class="button" ?inert=${king} href=${href.newSpot(plant.id)}>${icon('geo-alt-fill')}<span>Noter ici</span></a>`
    };
    const keys = subOrder(v, 'actions').filter(k => buttons[k] && !(this.scoped && (k === 'map' || k === 'spot'))
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
        ${this.#heading('Impossible de lire la flore locale')}
        <p class="muted">${plant.failed}</p>
        <p><button class="primary" type="button" @click=${() => this.#load(this.plantId)}>Réessayer</button></p>
      </article>`;
    }
    if (plant === null) {
      return html`<article><a class="back link" href=${lastSearchHash()}>${icon('arrow-left')} Recherche</a>${this.#heading('Plante introuvable')}</article>`;
    }

    const ctx = this.#context(plant);
    if (this.only) return this.#onlyBlock(this.only, ctx);
    // What a move did (King: « Déplacer vers… », a drag, « Par défaut »), said — in the panes alone too (Découvrir). The
    // region is there before its first message (one born with its text is seldom read out).
    const said = html`<p class="said" aria-live="polite">${this._said}</p>`;
    if (this.panesOnly) return html`${this.#panesOnlyView(ctx)}${said}`;
    const pane = this._paneDialog;
    return html`${baseOf(this.#view) === 'epure' ? this.#epure(ctx) : this.#full(ctx)}${said}${pane ? html`
      <dialog class="pane" aria-label=${blockTitle(pane.key)} @close=${() => { this._paneDialog = null; }}>
        <div class="pane-bar"><h2>${blockTitle(pane.key)} — <i>${plant.scientificName}</i></h2>
          <button class="icon-btn" type="button" aria-label="Fermer" title="Fermer" @click=${(/** @type {Event} */ e) => /** @type {HTMLElement} */ (e.currentTarget).closest('dialog')?.close()}>${icon('x-lg')}</button></div>
        <gf-plant-detail embedded only=${pane.key} plant-id=${plant.id} view=${this.#view} .paneStart=${pane.url}
          @media-close=${(/** @type {Event} */ e) => /** @type {HTMLElement} */ (e.currentTarget).closest('dialog')?.close()}></gf-plant-detail>
      </dialog>` : nothing}`;
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

  /**
   * One block at full size (a pane): the media viewer fills it, any other block scrolls in it. Titled (a block among
   * others): its title as the view shows it, nothing when the view leaves it out empty. @param {string} key @param {any} ctx
   */
  #onlyBlock(key, ctx) {
    if (key === 'media') {
      return ctx.photosOff ? html`<p class="muted only-pad">Photos en ligne désactivées (<a href=${href.settings()}>Réglages › Modules</a>).</p>`
        : html`<gf-media-viewer plant-id=${ctx.plant.id} presentation=${blockStyle(this.#view, 'media')} .index=${this.paneAt ?? 0} .startUrl=${this.paneStart ?? null}></gf-media-viewer>`;
    }
    const empty = this.titled && hidesEmpty(this.#view, key);
    if (empty && this.#emptyHere(key, ctx)) return nothing;
    const title = this.titled && isTitleShown(this.#view, key) ? html`<h3 class="block-title"><span class="name">${blockTitle(key)}</span></h3>` : nothing;
    return html`<div class="only-pad ${isMap(key) ? 'fill' : ''}"><section class="block only ${empty ? 'hide-empty' : ''} ${isMap(key) ? 'map-block' : ''}" data-key=${key}>${title}<div class="content">${this.#content(key, ctx)}</div></section></div>`;
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
      name: nameOf(plant),
      // Photos en ligne switched off (Réglages › Modules): no remote image anywhere on the sheet.
      photosOff: !this.#store.state.modules.photos,
      images: this.#store.state.modules.photos ? gallery(plant, details) : [],
      inat,
      wikidata: plant.identifiers?.wikidata || details?.identifiers?.wikidata?.id,
      links: sources.links(plant),
      status: plant.status?.france
    };
  }

  /** The sheet's title: its h1, or under a screen's own title (`subheading`) an h2 that looks the same. @param {string} text */
  #heading(text) { return this.subheading ? html`<h2 class="h1">${text}</h2>` : html`<h1>${text}</h1>`; }

  /** The « Nom » block: French and scientific names (Épuré: the family too; flowering is the Calendrier's). @param {any} ctx */
  #name({ plant, name }) {
    return html`
      ${this.#heading(name)}
      <div class="sci"><i>${plant.scientificName}</i> <span class="author">${plant.author}</span></div>
      ${baseOf(this.#view) === 'epure' ? html`<p class="meta">${plant.family}</p>` : nothing}`;
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
            <a href=${safeUrl(image.sourceUrl || image.pageUrl || image.url) || '#'} title="Voir en grand (Médias)" @click=${(/** @type {Event} */ e) => this.#openMedia(e, image.url)}>
              <img src=${image.url} alt=${plant.scientificName} loading="lazy" decoding="async" referrerpolicy="no-referrer" @error=${dropFigure} @load=${showImg} />
            </a>
            <figcaption><gf-attribution .media=${image}></gf-attribution></figcaption>
          </figure>`)}
      </div>${this.#allMedia()}` : loading ? html`<div class="skeleton"></div>` : html`<p class="muted">Aucune photo sous licence libre trouvée.</p>`;
  }

  /** The block that shows a theme of the article beside its own data, when it is in the sheet. @param {string} theme */
  #wikiHost(theme) {
    const host = WIKI_THEMES[theme]?.[1];
    return host && !this.only && !this.#folded(host) && !this.#paneOf(host) ? host : null;
  }

  /** The article's sections of these themes. @param {string[]} themes */
  #wikiSections(themes) { return (this._wiki?.sections || []).filter((/** @type {any} */ x) => themes.includes(x.theme)); }

  /**
   * The article's sections of these themes: their title, their beginning (« Lire la suite »: whole). Under a
   * block's own data (`under`), with the credit and a way to the article, at that theme.
   * @param {string[]} themes @param {boolean} [under]
   */
  #wikiBits(themes, under = true) {
    const list = this.#wikiSections(themes);
    if (!list.length) return nothing;
    const reader = !this.only && !this.#folded('wikipedia') && !this.#paneOf('wikipedia');
    return html`<div class=${under ? 'wiki-bits' : 'wiki-in'}>${list.map((/** @type {any} */ x) => {
      const id = x.theme + ':' + x.title, whole = this._wikiOpen.has(id) || x.text.length <= WIKI_SHORT + 80;
      const text = whole ? x.text : x.text.slice(0, WIKI_SHORT).replace(/\s+\S*$/, '') + '…';
      return html`<section class="wiki-x"><h3>${x.title.split(' › ').pop()}</h3>${text.split('\n').map(p => html`<p>${p}</p>`)}
        ${whole ? nothing : html`<button class="link" type="button" @click=${() => { this._wikiOpen = new Set([...this._wikiOpen, id]); }}>Lire la suite</button>`}</section>`;
    })}${under ? html`<p class="credit">D’après <a href=${this._wiki.url} target="_blank" rel="noopener">Wikipédia</a> · CC BY-SA 4.0
      ${reader ? html` · <button class="link" type="button" @click=${() => this.goTo('wiki:' + themes[0])}>Lire dans l’article</button>` : nothing}</p>` : nothing}</div>`;
  }

  /** The themes of the article, in the menu's order. */
  get #wikiThemes() { return Object.keys(WIKI_THEMES).filter(t => this.#wikiSections([t]).length); }

  /** A theme of the article open: Description from the start, the others when asked. @param {string} t */
  #wikiThemeOpen(t) { return this._wikiOpen.has('theme:' + t) || (t === 'description' && !this._wikiOpen.has('closed:description')); }

  /** To a theme of the article (its anchor in the Wikipédia block): opened, then reached (#arrive). @param {string} t */
  async #wikiGo(t) {
    if (!this.#wikiThemeOpen(t)) this._wikiOpen = new Set([...this._wikiOpen, 'theme:' + t]);
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

  /**
   * The Wikipédia block, read like an article: at its top, the menu of its themes (a table of contents, not stuck:
   * the theme read is the one whose title stays stuck under the rubric); the description and the lead; each theme
   * folded under its anchor, Description open. A theme also shown in a block of the sheet (Usages, Habitat…) says so.
   */
  #wikipedia() {
    const wiki = this._wiki;
    if (!wiki) return nothing;
    if (!wiki.extract) {
      return wiki.english ? html`<p class="muted">Pas d’article Wikipédia en français. <a href=${wiki.english} target="_blank" rel="noopener">Lire l’article en anglais</a></p>` : nothing;
    }
    const themes = this.#wikiThemes;
    const date = wiki.touched ? new Date(wiki.touched).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
    return html`<div class="description wiki">
      ${themes.length ? html`<nav class="wiki-menu" aria-label="Sommaire de l’article Wikipédia">
        <span class="wiki-logo" aria-hidden="true">${icon('wikipedia')}</span>
        ${themes.map(t => html`<a href=${'#wiki-' + t} @click=${(/** @type {Event} */ e) => { e.preventDefault(); this.goTo('wiki:' + t); }}>${WIKI_THEMES[t][0]}</a>`)}
      </nav>` : nothing}
      ${wiki.description ? html`<p class="wiki-desc">${wiki.description}</p>` : nothing}
      ${wiki.extract.split('\n').map((/** @type {string} */ p) => html`<p>${p}</p>`)}
      ${themes.map(t => {
        const host = this.#wikiHost(t), open = this.#wikiThemeOpen(t);
        return html`<details class="wiki-theme" id=${'wiki-' + t} data-theme=${t} ?open=${open}
            @toggle=${(/** @type {Event} */ e) => {
              const now = /** @type {HTMLDetailsElement} */ (e.currentTarget).open;
              if (now === this.#wikiThemeOpen(t)) return;
              const o = new Set(this._wikiOpen);
              if (now) { o.add('theme:' + t); o.delete('closed:' + t); } else { o.delete('theme:' + t); o.add('closed:' + t); }
              this._wikiOpen = o;
            }}>
          <summary>${WIKI_THEMES[t][0]} <small>${this.#wikiSections([t]).length} section${this.#wikiSections([t]).length > 1 ? 's' : ''}</small>
            ${host ? html`<button class="link also" type="button" title=${`Aussi dans « ${blockTitle(host)} », avec ses autres données`}
              @click=${(/** @type {Event} */ e) => { e.preventDefault(); e.stopPropagation(); this.goTo(host); }}>aussi dans « ${blockTitle(host)} » →</button>` : nothing}</summary>
          ${open ? this.#wikiBits([t], false) : nothing}
        </details>`;
      })}
      <p class="credit">Source : <a href=${wiki.url} target="_blank" rel="noopener">article Wikipédia</a> · texte sous licence CC BY-SA 4.0${date ? ' · modifié le ' + date : ''}</p>
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
    // Blocks stuck to an edge are there, not in the flow.
    // Outside King, folded blocks are not there at all.
    // Outside it too, a block with nothing for this plant (no other name, no Wikipédia article).
    if (this.#kingHere) {
      // King arranges the blocks one by one: their plain list, each with its handle.
      const order = this._dragOrder || blockOrder(this.#view);
      const sorting = Boolean(this._dragOrder);
      const keys = blockOrder(this.#view).filter(k => !isOnEdge(this.#view, k) && this.#visible(k, ctx));
      return html`${this.#palette()}<div class="blocks king ${sorting ? 'sorting' : ''}">${repeat(keys, k => k, k => this.#block(k, ctx, sorting ? order.indexOf(k) : null))}</div>
        ${sorting ? nothing : this.#newNote()}`;
    }
    // Read: the name, then the blocks gathered by rubric, each rubric under its header (#rubric).
    const rubrics = this.#rubrics(ctx);
    const name = !isOnEdge(this.#view, 'name') && this.#visible('name', ctx) ? this.#plainBlock('name', ctx) : nothing;
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
    for (const k of blockOrder(this.#view)) {
      if (k === 'name' || isHidden(this.#view, k) || (k === 'web' && !this.#paneOf('web'))) continue;
      const cat = blockCategory(k);
      const g = by.get(cat) || { cat, keys: [], pane: [] };
      by.set(cat, g);
      if (isOnEdge(this.#view, k)) { if (this.#visible(k, ctx)) g.pane.push(k); }
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
      ${g.keys.length || g.pane.length ? nothing : html`<p class="rub-note">${this.#loading ? 'Chargement…' : 'Rien dans les sources consultées.'}</p>`}
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
    if (k === 'web') return this.#kingHere || Boolean(this.#paneOf('web'));
    return this.#kingHere || (!this.#folded(k) && !(hidesEmpty(this.#view, k) && this.#emptyHere(k, ctx)));
  }

  /**
   * Folded: by hand in the mode, or its service off. A block a host's own tree puts in a pane (Rencontres' guided way)
   * is the host's: only its service off folds it. @param {string} k
   */
  #folded(k) { return this.tree && stackOf(this.tree, k) ? serviceOff(k) : isHidden(this.#view, k); }

  /** Does the sheet show a map (in the flow or pinned)? Its data can then be touched to show on it. */
  get #hasMap() {
    return blockOrder(this.#view).some(k => isMap(k) && !isHidden(this.#view, k));
  }

  /**
   * King, keyboard and touch way to arrange the panes: « Déplacer vers… » — back in the sheet, a new pane on
   * a side of the sheet, or a tab of a pane already there. (Dragging does the same with the pointer.)
   * @param {string} key
   */
  #placePicker(key) {
    const title = blockTitle(key);
    const tree = this.#tree(), here = this.#paneOf(key);
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
  #tree() { return this.tree ?? treeOf(this.#view); }

  /** The pane holding a block. @param {string} key */
  #paneOf(key) { return this.tree ? stackOf(this.tree, key) : paneOf(this.#view, key); }

  /** The host's tree changed: back to it, the mode's layout left alone. @param {import('../core/pane-tree.js').PaneNode} next */
  #handBack(next) { if (next !== this.tree) this.dispatchEvent(new CustomEvent('pane-sizes', { detail: next })); }

  /** New shares for a split's children. @param {string} id @param {number[]} sizes */
  #setSizes(id, sizes) { if (this.tree) this.#handBack(treeSizes(this.tree, id, sizes)); else setPaneSizes(this.#view, id, sizes); }

  /** A pane's state (its tab, folded, bare). @param {string} id @param {Partial<import('../core/pane-tree.js').StackNode>} patch */
  #setStack(id, patch) { if (this.tree) this.#handBack(patchStack(this.tree, id, patch)); else setStackState(this.#view, id, patch); }

  /**
   * A block docked (a new pane, a tab); false: not moved (too many panes nested).
   * @param {string} key @param {string} target @param {import('../core/pane-tree.js').Zone} zone
   */
  #dock(key, target, zone) {
    if (!this.tree) return dockBlock(this.#view, key, target, zone);
    const next = dock(this.tree, key, target, zone);
    if (next === this.tree) return false;
    this.#handBack(next);
    return true;
  }

  /** A block back in the sheet. @param {string} key @param {string | null} [beforeKey] */
  #toSheet(key, beforeKey = null) {
    if (this.tree) this.#handBack(undock(this.tree, key));
    else toSheet(this.#view, key, beforeKey);
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
    return blockOrder(this.#view).filter(k => blockCategory(k) === cat && k !== 'name' && this.#visible(k, ctx) && !isHidden(this.#view, k));
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
        blocks: this.#categoryBlocks(ctx, g.cat).map(k => ({ key: k, title: blockTitle(k), note: placeOf(this.#view, k) ? 'dans un panneau' : undefined,
          // The article's themes, each to its anchor in the Wikipédia block.
          subs: k === 'wikipedia' && !placeOf(this.#view, k) ? this.#wikiThemes.map(t => ({ key: 'wiki:' + t, title: WIKI_THEMES[t][0] })) : undefined }))
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
    if (this.preview || this.only) return;
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
    const first = this.#categoryBlocks(this.#context(this._plant), cat)[0];
    const mark = this.renderRoot.querySelector(`.rub-mark[data-cat="${CSS.escape(cat)}"]`);
    if (mark) {
      this.#arrive(mark, { flash: mark.nextElementSibling });
      if (first && this.#paneOf(first) && !mark.parentElement?.querySelector(':scope > .block')) this.#goTo(first);
      return;
    }
    // King (no rubrics): its first block.
    if (first) this.#goTo(first);
  }

  /** To a block: its place in the sheet — or, in a pane, its tab (unfolded): the sheet does not move. @param {string} key */
  async #goTo(key) {
    const pane = this.#paneOf(key);
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

  /** In the sheet itself (not in one of its panes). @param {Element} el */
  #inSheet(el) {
    const scroller = this.#sheetScroller;
    return el.isConnected && !el.closest('.edge-body') && (scroller === this || scroller.contains(el));
  }

  /** Data of the plant still on its way (the details, the article, GBIF, the open data): what is there may still grow. */
  get #loading() { return (this._details === undefined || this.#pending.size > 0) && performance.now() - this.#loadStart < KEEP_MAX_MS; }
  /** When the plant's data were asked (a source that never answers stops counting after KEEP_MAX_MS). */
  #loadStart = 0;
  /** The plant's loads in flight (#loadExtras). @type {Set<Promise<any>>} */
  #pending = new Set();

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
      if (now - start > KEEP_MAX_MS || (!this.#loading && !gliding && now - grewAt > KEEP_QUIET_MS)) { this.#letGo(); return; }
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
    if (this.preview || this.only || (sheetSession.anchorLock && !force)) return;
    const { cat, block, wiki, el } = this.#readPlace();
    this.#noteAnchor(cat, block, wiki);
    if (el) this.#padTo(el); else this.#padBase();
  }

  /** The hand stopped: the place read noted, and — data still arriving — the line read held (#holdEye), once the hand has lifted. */
  #handStopped() {
    this.#noteRead();
    this.#holdLater = this.#touching || this.#buttonDown;
    if (!this.#holdLater && this.#loading && !this.#keeper) this.#holdEye();
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
    if (this.only || this.panesOnly) return;
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
    if (this._plant && !this.only && !this.panesOnly) { const read = this.#readPlace().el; if (read) this.#padTo(read); else this.#padBase(); }
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
    const m = this.#view;
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
   * shown or not, « masqué si vide », panes, its action bar —, once confirmed; the names given to blocks, the Note and
   * Carte blocks stay. The focus goes to « Barre d’actions » (the button pressed is now greyed). @param {string} m
   */
  async #resetMode(m) {
    const label = modeLabel(m);
    if (!confirm(`Remettre « ${label} » par défaut ? Ordre, blocs et sous-blocs masqués, styles, titres affichés ou cachés, « masqué si vide », panneaux et barre d’actions de ce mode reviennent par défaut ; les noms donnés aux blocs, les blocs Note et Carte restent.`)) return;
    resetBlocks(m);
    this._maxEdge = null;
    this._said = `« ${label} » : mise en page par défaut`;
    await this.updateComplete;
    /** @type {HTMLElement | null} */ (this.renderRoot.querySelector('.king-bar .kb-actions'))?.focus();
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

  /** A page arrived for the « Page web » pane: its tab shown, unfolded. */
  revealWeb() {
    const pane = this.#paneOf('web');
    if (pane && (pane.active !== 'web' || pane.folded)) this.#setStack(pane.id, { active: 'web', folded: false });
  }

  updated() {
    // A « Page web » pane in this layout: the app's links to other sites come to it.
    if (this.#paneOf('web') && !this.only) registerWebPane(this); else unregisterWebPane(this);
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
    if (!this.#placed && this._plant && !this._plant.failed && !this.only) { this.#placed = true; this.#place(); }
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
  #headless = key => !isTitleShown(this.#view, key);

  /** A block as read outside King: its title, its content. @param {string} key @param {any} ctx */
  #plainBlock(key, ctx) {
    // A component that hides itself when it has nothing (protection, look-alikes, calendar): the block goes with it (CSS).
    const headless = this.#headless(key);
    return html`<section class="block ${headless ? 'headless' : ''} ${hidesEmpty(this.#view, key) ? 'hide-empty' : ''} ${isMap(key) ? 'map-block' : ''}" data-key=${key}>
      ${headless ? this.#paneButton(key) : html`<h2 class="block-title"><span class="name">${blockTitle(key)}</span>${this.#paneButton(key)}</h2>`}
      <div class="content">${this.inPane === key ? this.#shownInPane(key) : this.#content(key, ctx)}</div>
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
      @click=${() => this.#openPane(key)}>${icon('arrows-angle-expand')}</button>`;
  }

  /** @param {string} key @param {any} ctx @param {number | null} slot  place shown while dragging (CSS order: the nodes do not move) */
  #block(key, ctx, slot) {
    const title = blockTitle(key);
    const off = isHidden(this.#view, key);
    const module = blockModuleName(key);
    // Its service off for the whole device: folded, nothing to show; only Réglages › Modules brings it back.
    const cut = serviceOffNote(key);
    const dragging = this._dragKey === key;
    const subsOpen = this._subsOpen.has(key);
    const style = slot === null ? '' : `order:${slot}${dragging ? `;transform:translateY(${this._dragY}px)` : ''}`;
    const titled = isTitleShown(this.#view, key);
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
          @click=${() => setTitleShown(this.#view, key, !titled)}>${icon('type-h2')}</button>
        ${canBeEmpty(key) ? html`<button class="tool" type="button" aria-pressed=${hidesEmpty(this.#view, key) ? 'true' : 'false'}
          aria-label=${hidesEmpty(this.#view, key) ? `Afficher « ${title} » même vide, à la lecture` : `Ne pas afficher « ${title} » s’il est vide, à la lecture`}
          title=${hidesEmpty(this.#view, key) ? 'Masqué quand il est vide (toucher pour l’afficher quand même)' : 'Affiché même vide (toucher pour le masquer quand il est vide)'}
          @click=${() => setHidesEmpty(this.#view, key, !hidesEmpty(this.#view, key))}>${icon('eye-slash')}</button>` : nothing}
        ${['name', 'actions'].includes(key) ? nothing : this.#placePicker(key)}
        ${this._renaming === key ? nothing : html`<button class="tool" type="button" data-tool="rename" aria-label="Renommer le bloc « ${title} »" title=${isNote(key) ? 'Renommer' : 'Renommer (vide : nom d’origine)'}
          @click=${() => this.#startRename(key)}>${icon('pencil')}</button>`}
        ${STYLES[key] ? html`<span class="styles" role="group" aria-label="Style du bloc « ${title} »">${STYLES[key].styles.map(st => html`
          <button type="button" aria-pressed=${blockStyle(this.#view, key) === st.key ? 'true' : 'false'} title=${'Style : ' + st.title}
            @click=${() => setBlockStyle(this.#view, key, st.key)}>${icon(/** @type {any} */ ({ list: 'list-ul', graph: 'diagram-3', scene: 'image', mosaic: 'images', slideshow: 'arrows-fullscreen' })[st.key] || 'table')} ${st.title}</button>`)}</span>` : nothing}
        ${SUBS[key] ? html`<button class="tool" type="button" aria-expanded=${subsOpen ? 'true' : 'false'} aria-label="Sous-blocs de « ${title} »" title="Sous-blocs : ordre et présence"
          @click=${() => { const open = new Set(this._subsOpen); if (subsOpen) open.delete(key); else open.add(key); this._subsOpen = open; }}>${icon('list-nested')}</button>` : nothing}
        ${cut ? this.#cutTools(key, title, cut)
          : isLocked(key)
          ? html`<button class="tool lock" type="button" aria-label=${lockWhy} title="Ne se masque dans aucun mode : sécurité"
              @click=${() => { this._lockTip = this._lockTip === key ? null : key; }}>${icon('lock-fill')}</button>`
          // Each swapped for the other: the focus goes to it.
          : off
          ? html`<button class="tool" type="button" data-tool="show" aria-label="Réafficher le bloc « ${title} »" title="Réafficher"
              @click=${() => { setHidden(this.#view, key, false); this.#toolFocus(key, 'hide'); }}>${icon('arrow-counterclockwise')}</button>`
          : html`<button class="tool" type="button" data-tool="hide" aria-label="Masquer le bloc « ${title} »" title=${module ? `Masquer dans ce mode (le service ${module} reste utilisé)` : 'Masquer'}
              @click=${() => { if (key === 'web' && this.#paneOf('web')) this.#putAwayWeb(); else setHidden(this.#view, key, true); this.#toolFocus(key, 'show'); }}>${icon('trash3')}</button>`}
        ${isMap(key) && !off ? html`<button class="tool" type="button" aria-expanded=${this._mapsOpen.has(key) ? 'true' : 'false'} aria-label="Configurer la carte « ${title} »" title="Ce que la carte montre et permet"
          @click=${() => { const open = new Set(this._mapsOpen); if (open.has(key)) open.delete(key); else open.add(key); this._mapsOpen = open; }}>${icon('gear')}</button>` : nothing}
        ${isNote(key) ? html`<button class="tool" type="button" aria-label="Supprimer le bloc « ${title} »" title="Supprimer le bloc et ses textes"
          @click=${() => { if (confirm(`Supprimer le bloc « ${title} » et tout ce qui y est écrit ?`)) deleteNote(key); }}>${icon('x-lg')}</button>` : nothing}
        ${isAddedMap(key) ? html`<button class="tool" type="button" aria-label="Supprimer le bloc « ${title} »" title="Supprimer cette carte"
          @click=${() => { if (confirm(`Supprimer la carte « ${title} » ?`)) deleteMap(key); }}>${icon('x-lg')}</button>` : nothing}
      </h2>
      ${isLocked(key) ? html`<p class="lock-tip" role="status">${this._lockTip === key ? lockWhy : nothing}</p>` : nothing}
      ${subsOpen && SUBS[key] ? html`<div class="subs-editor">
        <gf-sortable-list label=${'Sous-blocs de ' + title}
          .items=${subOrder(this.#view, key).map(k => ({ key: k, label: subTitle(key, k), checked: !isSubHidden(this.#view, key, k), locked: isSubLocked(key, k) }))}
          @reorder=${e => setSubOrder(this.#view, key, e.detail.keys)}
          @toggle=${e => setSubHidden(this.#view, key, e.detail.key, !e.detail.on)}></gf-sortable-list>
      </div>` : nothing}
      ${isMap(key) && !off && this._mapsOpen.has(key) ? this.#mapForm(key) : nothing}
      ${off ? nothing : html`<div class="content">${this.#content(key, ctx)}</div>`}
    </section>`;
  }

  /**
   * A block whose service is off (Réglages › Modules): the way there, and its own choice in this mode — kept hidden
   * when the service comes back, or back with it (named « Garder… », not « Réafficher »: the service decides now).
   * @param {string} key @param {string} title @param {string} cut what is off, said
   */
  #cutTools(key, title, cut) {
    const kept = foldedByHand(this.#view, key);
    return html`<a class="tool" href=${href.settings()} aria-label=${`Réglages › Modules : ${cut}`} title="Réglages › Modules">${icon('gear')}</a>
      <button class="tool" type="button" aria-pressed=${kept ? 'true' : 'false'} aria-label=${`Garder « ${title} » masqué dans ce mode`}
        title=${kept ? 'Restera masqué dans ce mode quand le service reviendra' : 'Reviendra dans ce mode avec son service'}
        @click=${() => setHidden(this.#view, key, !kept)}>${icon('trash3')}</button>`;
  }

  /** « Page web » taken out of its pane: hidden (it shows in a pane only; its chip in « Ajouter » puts it in one again). */
  #putAwayWeb() {
    this.#toSheet('web');
    setHidden(this.#view, 'web', true);
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

  /**
   * A « Carte » block: the map component, set up as configured (the card under a swiped one shows a
   * placeholder rather than a second map). @param {string} key @param {any} ctx
   */
  #map(key, { plant, details, inat }) {
    const config = mapConfig(key);
    // Pinned, or alone in a pane: the map fills the room.
    const fill = Boolean(this.#paneOf(key)) || this.only === key;
    if (this.preview) return html`<div class="map-placeholder ${fill ? 'fill' : ''}" style=${`height:${{ s: 180, m: 260, l: 380 }[config.height]}px`}></div>`;
    // One WebGL map per sheet: the main « Carte » block may show in 3D, the map blocks added stay in 2D (gf-map-gl.js).
    return html`<gf-sheet-map .plant=${plant} .gbifKey=${details?.identifiers?.gbif?.id ?? null} .inatId=${inat?.id ?? null}
      map-3d=${key === 'map' ? 'auto' : 'off'} map-3d-why=${ONE_GL_PER_SHEET} .config=${config} ?fill=${fill} .mapFocus=${this._focus}
      @map-config=${(/** @type {CustomEvent} */ e) => setMapConfig(key, e.detail)}
      @focus-clear=${(/** @type {CustomEvent} */ e) => { this._focus = { ...this._focus, [e.detail.kind]: null }; }}></gf-sheet-map>`;
  }

  /**
   * King: what a map block shows and lets do (the same in every mode). Its background, IGN's layers and 2D / 3D:
   * its panel ▦, as on every map (gf-map-options.js) — said here.
   * @param {string} key
   */
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
      <fieldset><legend>Sujet</legend>
        ${select('La carte montre', 'subject', [['plant', 'Cette plante'], ['results', 'Les résultats (recherche et filtres)'], ...(c.subject === 'collection' ? [['collection', 'Une liste ou un lieu (choisi sous la carte)']] : [])])}
      </fieldset>
      <fieldset><legend>Couches</legend>
        ${select('Répartition GBIF', 'gbif', [['fr', 'France'], ['world', 'Monde'], ['off', 'Non']])}
        ${check('Mes lieux de cette plante (et chaque plant)', c.places, on => set({ places: on }))}
        ${select('Observations proches', 'near', [['off', 'Non'], ['both', 'iNaturalist et GBIF'], ['inat', 'iNaturalist'], ['gbif', 'GBIF']])}
      </fieldset>
      <fieldset><legend>Affichage</legend>
        ${select('Cadrage', 'frame', [['auto', 'Automatique (selon les couches)'], ['france', 'France entière'], ['world', 'Monde entier'], ['content', 'Ajusté à ce qui est affiché'], ['me', 'Autour de moi'], ['region', 'Ma région']])}
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

  /** @type {number | undefined} */
  #noteTimer;

  /** A note block: free text for this plant, saved as it is typed. @param {string} key @param {any} plant */
  #note(key, plant) {
    return html`<textarea class="note-text" rows="3" aria-label=${blockTitle(key)} placeholder="Votre note sur cette plante"
      .value=${noteText(key, plant.id)}
      @input=${e => {
        const text = e.target.value;
        clearTimeout(this.#noteTimer);
        this.#noteTimer = setTimeout(async () => {
          // Said only once it is stored: a refusal (storage full) is said, never a false « Enregistré ».
          const stored = await setNoteText(key, plant.id, text);
          this._noteFailed = stored ? null : key;
          if (!stored) return;
          // A favourite of a game, given a note: the user's own now (« Recommencer » the game keeps it).
          if (text.trim()) promoteFavorite(plant.id);
          this._noteSaved = key;
          setTimeout(() => { if (this._noteSaved === key) this._noteSaved = null; }, 1500);
        }, 400);
      }}></textarea>
      ${this._noteFailed === key
        ? html`<p class="credit error" role="alert">Non enregistré : stockage plein ou indisponible. Copiez votre texte, puis exportez vos plantes et libérez de l’espace.</p>`
        : html`<p class="credit" aria-live="polite">${this._noteSaved === key ? 'Enregistré sur cet appareil.' : 'Note personnelle, gardée sur cet appareil (et dans l’export de Mes plantes).'}</p>`}`;
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
    return dedupNames([...(plant.vernacularNames || []), ...gbifFrenchNames(plant, this._gbif), ...(this._wiki?.aliases || [])], [name]);
  }

  /**
   * A block with nothing to show for this plant, left out outside King: Noms with no other name, Wikipédia
   * with no article (or not yet: it appears when the summary arrives).
   * @param {string} key @param {any} ctx
   */
  #emptyHere(key, ctx) {
    // A source unavailable: the block stays, to say so and offer « Réessayer ».
    return !this.#down(key).length && this.#nothingHere(key, ctx);
  }

  /** The block has no data for this plant (whatever the reason). @param {string} key @param {any} ctx */
  #nothingHere(key, ctx) {
    const v = this.#view;
    const g = this._gbif;
    const loaded = (/** @type {any} */ x) => x !== undefined;
    if (isNote(key)) return !noteText(key, ctx.plant.id);
    switch (key) {
      case 'names': return this.#namesEmpty(ctx);
      // Wikipédia: shown when the summary arrives.
      case 'wikipedia': return !this._wiki || (!this._wiki.extract && !this._wiki.english);
      case 'photos': return ctx.photosOff || (!ctx.loading && !ctx.images.length);
      case 'media': return ctx.photosOff || (!ctx.loading && !ctx.images.length && loaded(this._gbif.photos) && !this._gbif.photos?.length);
      // Épuré and Standard: the component hides itself when empty (CSS, see .hide-empty).
      case 'status': return baseOf(v) === 'scientific' && !ctx.plant.statuses?.length && loaded(this._science) && !this._science?.iucn && loaded(g.iucn) && !g.iucn?.code;
      case 'mine': return !(getMembership().byPlant.get(ctx.plant.id) || []).length;
      case 'descriptions': return !this.#wikiSections(['description']).length && loaded(g.descriptions) && !descriptions(g).filter(row => baseOf(v) === 'scientific' || /^(fra|fre|fr)$/.test(row.language || '')).length;
      case 'occurrences': return !ctx.loading && !ctx.details?.identifiers?.gbif?.id && !ctx.inat?.observationsCount;
      case 'gbifMedia': return ctx.photosOff || shownSubs(v, 'gbifMedia').every(k => loaded(g[k]) && !g[k]?.length);
      case 'gbifProfile': { const p = profile(g); return !this.#wikiSections(['ecology']).length && !p.habitats.length && !p.forms.length && !p.invasive.length; }
      case 'literature': return !g.literature?.items?.length;
      case 'interactions': return loaded(this._open.interactions) && !this._open.interactions?.roles?.length;
      // Prudence always says something once read (a warning, the data unavailable, or that none is known).
      case 'uses': { const o = this._open; return isSubHidden(v, 'uses', 'safety') && !this.#wikiSections(['toxicity', 'food', 'uses']).length && loaded(o.safety) && !o.safety && !o.confusions?.length && loaded(o.wdUses) && !o.wdUses?.uses?.length && !o.wdUses?.products?.length && !o.wdUses?.dishes?.length && !o.recipes?.length && !this.#danger(ctx.plant).items.length; }
      case 'climate': return !openData.pollenOf(ctx.plant) && loaded(this._open.niche) && !this._open.niche?.points?.length;
      case 'trefle': return !ctx.loading && !trefleFacts(ctx.details).length;
      default: return false;
    }
  }


  /** The Noms block has nothing to show here. @param {any} ctx */
  #namesEmpty(ctx) {
    if (this.#otherFrench(ctx).length || this.#wikiSections(['names']).length) return false;
    return blockStyle(this.#view, 'names') === 'list' || baseOf(this.#view) !== 'scientific' || !otherNames(this._gbif).length;
  }

  /**
   * A block's content, as this view shows it. A source it reads failed: « Source indisponible — Réessayer », alone
   * when the block has nothing else to show, else above what it has (its « nothing known » lines left out).
   * @param {string} key @param {any} ctx
   */
  #content(key, ctx) {
    const down = this.#down(key);
    if (!down.length) return this.#blockContent(key, ctx, false);
    const notice = sourceDown(down, () => this.#retry());
    return this.#nothingHere(key, ctx) ? notice : html`${notice}${this.#blockContent(key, ctx, true)}`;
  }

  /** @param {string} key @param {any} ctx @param {boolean} down a source of the block failed: no « nothing known » line */
  #blockContent(key, ctx, down) {
    const v = this.#view;
    const { plant, details, loading } = ctx;
    const pending = html`<p class="muted">chargement…</p>`;
    const empty = (/** @type {string} */ text) => down ? nothing : html`<p class="muted">${text}</p>`;
    // After a part that hides itself when it has nothing for this plant.
    const ifEmpty = (/** @type {string} */ text) => down ? nothing : html`<p class="muted if-empty">${text}</p>`;
    if (isNote(key)) return this.#note(key, plant);
    if (isMap(key)) return this.#map(key, ctx);
    switch (key) {
      case 'name': return this.#name(ctx);
      case 'web': return html`<gf-web-pane ?inactive=${!this.#paneOf('web')}></gf-web-pane>`;
      case 'media': {
        if (ctx.photosOff) return html`<p class="muted">Photos en ligne désactivées (<a href=${href.settings()}>Réglages › Modules</a>).</p>`;
        // In the sheet: compact; in a pane (the mode's, or the host's own): the full viewer, filling it (its keys only
        // when it has the focus).
        const edged = Boolean(this.#paneOf('media'));
        return html`<gf-media-viewer ?prefer-photos=${this.panesOnly} ?showcase=${this.panesOnly} ?bar-out=${edged} ?compact=${!edged} ?local=${edged} plant-id=${plant.id} .index=${this.mediaAt ?? 0}
            presentation=${blockStyle(this.#view, 'media')} .label=${isTitleShown(this.#view, 'media') ? null : blockTitle('media')}
            @open-pane=${(/** @type {CustomEvent} */ e) => { e.stopPropagation(); this.#openPane('media', e.detail.url); }}></gf-media-viewer>`;
      }
      case 'photos': {
        if (baseOf(v) !== 'epure') return this.#gallery(ctx, baseOf(v) === 'standard' ? 6 : Infinity);
        const hero = ctx.images[0];
        return html`<figure class="hero">
          ${hero ? html`<a href=${safeUrl(hero.sourceUrl || hero.url) || '#'} title="Voir en grand (Médias)" @click=${(/** @type {Event} */ e) => this.#openMedia(e, hero.url)}><img src=${hero.url} alt=${plant.scientificName} decoding="async" referrerpolicy="no-referrer" @error=${hideImg} @load=${showImg} /></a>
            <figcaption><gf-attribution .media=${hero}></gf-attribution></figcaption>`
            : html`<div class=${loading ? 'skeleton' : 'no-photo'} aria-hidden="true">${loading ? '' : icon('flower1')}</div>`}
        </figure>`;
      }
      case 'status':
        return baseOf(v) === 'scientific' ? this.#statuses(ctx)
          : html`<gf-status .plant=${plant}></gf-status>${ifEmpty('Aucune protection, réglementation ni liste rouge connue (INPN).')}`;
      case 'lookalikes':
        return html`<gf-lookalikes .plant=${plant} ?compact=${baseOf(v) === 'epure'} ?detailed=${baseOf(v) === 'scientific'} ?map-linked=${this.#hasMap} .mapFocus=${this._focus}
            @safety-retry=${() => this.#retrySafety(false)}></gf-lookalikes>
          ${ifEmpty('Aucune confusion de notre liste (Anses, Centres antipoison) ne concerne cette plante : cela ne garantit pas l’absence de risque.')}`;
      case 'taxonomy': return baseOf(v) === 'scientific' ? this.#taxonomy(ctx) : this.#tags(ctx);
      case 'mine': {
        if (baseOf(v) === 'scientific') return html`<gf-plant-spots plant-id=${plant.id} notitle ?map-linked=${this.#hasMap} .mapFocus=${this._focus}></gf-plant-spots>`;
        const count = (getMembership().byPlant.get(plant.id) || []).length;
        return html`
          <div class="mine">
            <span>${count ? `Dans ${count} de mes listes et lieux` : 'Dans aucune liste ni aucun lieu'}</span>
            <button class="link" type="button" aria-expanded=${this._spotsOpen ? 'true' : 'false'}
              @click=${() => { this._spotsOpen = !this._spotsOpen; }}>${this._spotsOpen ? 'Masquer' : count ? 'Voir' : 'Lieux'}</button>
          </div>
          ${this._spotsOpen ? html`<gf-plant-spots plant-id=${plant.id} notitle ?map-linked=${this.#hasMap} .mapFocus=${this._focus}></gf-plant-spots>` : nothing}`;
      }
      case 'calendar':
        return html`<gf-calendar .plant=${plant} notitle></gf-calendar>${this.#wikiSections(['biology']).length ? this.#wikiBits(['biology']) : ifEmpty('Aucune période de floraison ni d’observation connue.')}`;
      case 'wikipedia':
        return this._wiki ? this.#wikipedia() : this._wiki === undefined ? pending : empty('Pas d’article Wikipédia en français trouvé.');
      case 'descriptions': {
        const texts = descriptions(this._gbif).filter(row => baseOf(v) === 'scientific' || /^(fra|fre|fr)$/.test(row.language || ''));
        if (this.#wikiSections(['description']).length) return html`${this.#wikiBits(['description'])}${texts.map(row => html`<div class="description"><small>${row.type || 'Description'}${row.source ? ' — ' + row.source : ''} · ${row.language} · GBIF</small>${row.text}</div>`)}`;
        return texts.length
          ? texts.map(row => html`<div class="description"><small>${row.type || 'Description'}${row.source ? ' — ' + row.source : ''} · ${row.language} · GBIF</small>${row.text}</div>`)
          : this._gbif.descriptions === undefined ? pending : empty(baseOf(v) === 'scientific' ? 'Aucune description sur GBIF.' : 'Aucune description en français sur GBIF.');
      }
      case 'names': {
        const names = this.#otherFrench(ctx);
        const foreign = baseOf(v) === 'scientific' ? otherNames(this._gbif) : [];
        const wikiNames = this.#wikiBits(['names']);
        if (!names.length && !foreign.length) return wikiNames !== nothing ? wikiNames : this._gbif.vernacularNames === undefined ? pending : empty('Aucun autre nom français connu.');
        // « Liste » (Épuré's default): just the French names.
        if (blockStyle(v, 'names') === 'list') return html`${shownSubs(v, 'names').includes('french') && names.length ? html`<p class="names-list">${this.#nameList(names)}</p>` : nothing}${wikiNames}`;
        return html`<dl class="facts">${this.#subs('names', {
          french: () => names.length ? html`<dt>Autres noms français</dt><dd class="names">${this.#nameList(names)}</dd>` : nothing,
          foreign: () => foreign.length ? html`<dt>Autres langues (GBIF)</dt><dd class="names">${foreign.map(([lang, list]) => html`<span class="lang">${lang || '?'}</span> ${this.#nameList(/** @type {string[]} */ (list))} `)}</dd>` : nothing
        })}</dl>
        <p class="credit">Sources : TAXREF v18 · GBIF${this._wiki?.aliases?.length ? ' · Wikidata' : ''}.</p>${wikiNames}`;
      }
      case 'occurrences': return html`${this.#occurrences(ctx)}${this.#wikiBits(['distribution'])}`;
      case 'gbifMedia': return this.#gbifMedia(ctx);
      case 'gbifProfile': {
        const w = this.#wikiBits(['ecology']);
        if (w === nothing) return this.#gbifProfile();
        const p = profile(this._gbif);
        return html`${p.habitats.length || p.forms.length || p.invasive.length ? this.#gbifProfile() : nothing}${w}`;
      }
      case 'literature': return this.#literature(ctx);
      case 'interactions': return this.#interactions(ctx);
      case 'climate': return this.#climate(ctx);
      case 'uses': return html`${this.#uses(ctx)}${this.#wikiBits(['toxicity', 'food', 'uses'])}`;
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
    const gbifSyn = shownSubs(this.#view, 'taxonomy').includes('gbifSynonyms') ? gbifSynonyms(plant, this._gbif) : [];
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
    if (seen || !maps[0]) return;
    // A map of the sheet: its block reached (only the sheet scrolls); a map in a pane: brought into its pane's view.
    const block = maps[0].closest('.blocks .block');
    const key = /** @type {HTMLElement | null} */ (block)?.dataset.key;
    if (block && key) { this.#noteAnchor(blockCategory(key), key, null); this.#arrive(block); } else maps[0].scrollIntoView({ block: 'nearest' });
  }

  /**
   * Counts as a table (value, occurrences, share with a small bar) or as a list, as the block's style says.
   * @param {string} head @param {{ label: unknown, count: number }[]} rows @param {number} total
   */
  #counts(head, rows, total) {
    if (blockStyle(this.#view, 'occurrences') === 'list') return html`<ul class="counts">${rows.map(r => html`
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
    const statsShown = ['gbif', 'months', 'years', 'regions', 'basis', 'datasets'].some(k => shownSubs(this.#view, 'occurrences').includes(k));
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
    if (blockStyle(this.#view, 'occurrences') !== 'list') {
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
    const fix = known && Date.now() - known.timestamp < 5 * 60000 ? known : await oneFix({ maxAge: 5 * 60000, timeout: 20000 });
    if (this._plant !== plant) return;
    if (!fix || 'error' in fix) { this._near = { state: 'error', message: fix && 'error' in fix ? fix.error : 'Position introuvable pour le moment.' }; return; }
    const radius = savedRadius();
    this._near = { state: 'loading' };
    try {
      const result = await sources.gbifNear(key, fix.coordinates, radius);
      if (this._plant === plant) this._near = result ? { state: 'done', radius, ...result } : { state: 'error', message: 'GBIF est désactivé (Réglages › Modules).' };
    } catch {
      if (this._plant === plant) this._near = { state: 'error', message: 'GBIF ne répond pas pour le moment.' };
    }
  }

  /** « Médias GBIF »: field photos and herbarium sheets, apart. @param {any} ctx */
  #gbifMedia({ plant, photosOff }) {
    if (photosOff) return html`<p class="muted">Photos en ligne désactivées (Réglages › Modules).</p>`;
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
    // Its source failed: the block says so above (#content), not « none ».
    if (!list?.length) return this._failed['gbif:' + (herbarium ? 'herbarium' : 'photos')] || this._failed['details:gbif'] ? head : html`${head}<p class="muted">${none}</p>`;
    return html`${head}<div class="gallery ${herbarium ? 'herbarium' : ''}">${list.map(image => html`<figure>
      <a href=${safeUrl(image.sourceUrl || image.url) || '#'} title="Voir en grand (Médias)" @click=${(/** @type {Event} */ e) => this.#openMedia(e, image.url)}><img src=${image.url} alt=${(herbarium ? 'Planche d’herbier de ' : '') + plant.scientificName} loading="lazy" decoding="async" referrerpolicy="no-referrer" @error=${dropFigure} @load=${showImg} /></a>
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
    if (blockStyle(this.#view, 'gbifProfile') === 'list') return html`<ul class="plain">
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
    if (blockStyle(this.#view, 'literature') !== 'list') return html`<table class="data papers-table">
        <thead><tr><th scope="col">Titre</th><th scope="col">Auteurs</th><th scope="col">Revue</th><th scope="col" class="num">Année</th></tr></thead>
        <tbody>${l.items.map((/** @type {any} */ r) => html`<tr>
          <td>${safeUrl(r.url) ? html`<a href=${safeUrl(r.url)} target="_blank" rel="noopener">${r.title}</a>` : r.title}</td>
          <td>${authors(r)}</td><td>${r.source}</td><td class="num">${r.year ?? ''}</td></tr>`)}</tbody>
      </table>
      <p class="credit">${l.total.toLocaleString('fr-FR')} publication${l.total > 1 ? 's' : ''} utilisant des données GBIF sur cette espèce —
        <a href=${'https://www.gbif.org/resource/search?contentType=literature&gbifTaxonKey=' + key} target="_blank" rel="noopener">toutes sur GBIF.org</a>.</p>`;
    return html`<ul class="papers">${l.items.map((/** @type {any} */ r) => html`<li>
        ${safeUrl(r.url) ? html`<a href=${safeUrl(r.url)} target="_blank" rel="noopener">${r.title}</a>` : r.title}
        <small>${[r.authors.slice(0, 3).join(', ') + (r.authors.length > 3 ? ' et al.' : ''), r.source, r.year].filter(Boolean).join(' · ')}</small>
      </li>`)}</ul>
      <p class="credit">${l.total.toLocaleString('fr-FR')} publication${l.total > 1 ? 's' : ''} utilisant des données GBIF sur cette espèce —
        <a href=${'https://www.gbif.org/resource/search?contentType=literature&gbifTaxonKey=' + key} target="_blank" rel="noopener">toutes sur GBIF.org</a>.</p>`;
  }


  /**
   * The plant's verdict from what « Usages » read (core/danger.js#dangerLevel, as the badge, the cards and the harvest
   * warning have it): the safety file's entry and the confusions, a file that could not be read said first.
   * @param {any} plant
   */
  #sheetVerdict(plant) {
    const o = this._open;
    return dangerLevel({ statuses: plant.statuses, safety: o.safety === UNREAD ? null : o.safety,
      confusions: Array.isArray(o.confusions) ? o.confusions : [], unread: o.safety === UNREAD || o.confusions === UNREAD });
  }

  /**
   * What says to be careful with this plant, each with its source, at its verdict's level (core/danger.js): a file
   * that could not be read, ANSM liste B and liste A's toxic parts, TPPT toxicity, confusions with toxic plants
   * (Anses: the edible side's in one line), protection and harvest rules, the Red List (INPN). The gravest first.
   * @param {any} plant @returns {{ verdict: import('../core/danger.js').Verdict, items: { level: import('../core/danger.js').Level, text: unknown }[] }}
   */
  #danger(plant) {
    const o = this._open;
    const verdict = this.#sheetVerdict(plant);
    /** The level the verdict gives a kind of reason (its gravest, for the confusions). @param {import('../core/danger.js').Kind} kind */
    const levelOf = kind => verdict.reasons.filter(r => r.kind === kind).reduce((/** @type {import('../core/danger.js').Level} */ l, r) => rank(r.level) > rank(l) ? r.level : l, 'none');
    /** @type {{ level: import('../core/danger.js').Level, text: unknown }[]} */
    const out = [];
    if (o.safety === UNREAD || o.confusions === UNREAD) {
      const what = o.safety !== UNREAD ? 'Liste des confusions indisponible' : o.confusions === UNREAD ? 'Données de toxicité et liste des confusions indisponibles' : 'Données de toxicité indisponibles';
      out.push({ level: levelOf('unread'), text: html`<b>${what} pour le moment</b> : ne consommez aucune plante sans vérification. <button type="button" class="link" @click=${() => this.#retrySafety()}>Réessayer</button>` });
    }
    const ansm = /** @type {any[]} */ (o.safety === UNREAD ? [] : [].concat(o.safety?.ansm || [])), tppt = o.safety === UNREAD ? null : o.safety?.tppt;
    // The pair's severity, on both sides: the toxic side is the dangerous plant itself, even without ANSM or TPPT data.
    const confusions = /** @type {import('../core/lookalikes.js').Lookalike[]} */ (Array.isArray(o.confusions) ? o.confusions : []);
    const toxicSide = confusions.filter(l => l.side === 'toxic'), edibleSide = confusions.filter(l => l.side === 'edible');
    const see = html` Voir « ${blockTitle('lookalikes')} ». <span class="src">Anses, Centres antipoison</span>`;
    if (toxicSide.length) out.push({ level: levelOf('toxic-side'), text: html`<b>Plante ${gravest(toxicSide).plant}</b>, confondue avec ${[...new Set(toxicSide.flatMap(l => l.others.map(x => x.label)))].join(', ')}.${see}` });
    // TPPT in French; the base's own words on hover (levelEn, partsEn). Level 0: listed, toxicity to humans unknown. A
    // plant kept toxic by hand against the base (`reviewed`): its reason on hover, and the review as its source.
    if (tppt) out.push({ level: levelOf('tppt'), text: html`<b title=${tppt.reviewed || (tppt.levelEn ? 'TPPT : ' + tppt.levelEn : nothing)}>${tppt.level >= 2 ? 'Plante toxique' : tppt.level === 0 ? 'Toxicité pour l’humain inconnue' : 'Attention'}</b>${tppt.levelLabel && tppt.level > 0 ? ` (${tppt.levelLabel})` : ''}${tppt.parts ? html` — <span title=${tppt.partsEn ? 'TPPT : ' + tppt.partsEn : nothing}>${tppt.level >= 2 ? 'parties toxiques' : 'parties concernées'} : ${tppt.parts}</span>` : nothing}${tppt.toxins?.length ? html` ; substances : ${tppt.toxins.slice(0, 4).join(', ')}` : nothing}. <span class="src">${tppt.reviewed ? 'Genre toxique, revu à la main' : 'Agroscope, base TPPT'}</span>` });
    for (const b of ansm.filter(a => a.list === 'B')) out.push({ level: levelOf('ansm-b'), text: html`<b>Pharmacopée française, liste B</b>${b.from ? ` (listée sous « ${b.from} sp. », genre dont elle faisait partie)` : b.genus ? ' (tout le genre)' : ''} : plante médicinale dont les effets indésirables potentiels l’emportent sur le bénéfice attendu${b.parts ? html` — partie concernée : ${b.parts}` : nothing}. <span class="src">ANSM</span>` });
    for (const a of ansm.filter(a => a.list === 'A' && a.toxicParts)) out.push({ level: levelOf('ansm-a'), text: html`<b>Parties toxiques</b> : ${a.toxicParts}. <span class="src">ANSM, Pharmacopée liste A</span>` });
    if (edibleSide.length) out.push({ level: levelOf('edible-side'), text: html`<b>Risque de confusion</b> avec une plante ${gravest(edibleSide).plant} : ${[...new Set(edibleSide.flatMap(l => l.others.map(x => x.label + severityNote(l.pair))))].join(', ')}.${see}` });
    const st = plant.statuses || [];
    const protectedIn = [...new Set(st.filter((/** @type {any} */ x) => /^P[NRD]$/.test(x.type)).map((/** @type {any} */ x) => x.area || x.label))].slice(0, 3);
    if (protectedIn.length) out.push({ level: levelOf('protected') === 'none' ? levelOf('protected-elsewhere') : levelOf('protected'), text: html`<b>Espèce protégée</b> (${protectedIn.join(', ')}) : cueillette interdite là où elle l’est. <span class="src">INPN</span>` });
    const rule = harvestRuleText(st);
    if (rule) out.push({ level: levelOf('regulated'), text: html`<b>${rule}</b> (voir « ${blockTitle('status')} »). <span class="src">INPN</span>` });
    const red = verdict.reasons.find(r => r.kind === 'threatened');
    if (red) out.push({ level: red.level, text: html`<b>${red.text}</b> (voir « ${blockTitle('status')} »). <span class="src">${red.source}</span>` });
    // The gravest first (stable sort: the order above stays within a level, as the verdict's).
    return { verdict, items: out.sort((a, b) => rank(b.level) - rank(a.level)) };
  }

  /** « Usages et cuisine sauvage »: safety first, then sourced uses, parts and products, dishes and recipes. @param {any} ctx */
  #uses({ plant }) {
    const o = this._open;
    const style = blockStyle(this.#view, 'uses');
    const { verdict, items: danger } = this.#danger(plant);
    const wd = o.wdUses;
    const ansmA = (/** @type {any[]} */ (o.safety?.ansm || [])).filter(a => a.list === 'A');
    const pending = html`<p class="muted">chargement…</p>`;
    const KIND = { food: 'Alimentation', medicine: 'Médecine traditionnelle', other: 'Autres usages' };
    return html`${this.#subs('uses', {
      safety: () => {
        // No toxicity in our sources (and not the toxic side of a confusion): said so, without reassuring.
        const tox = (/** @type {any[]} */ (o.safety?.ansm || [])).some(a => a.list === 'B' || a.toxicParts) || o.safety?.tppt
          || (Array.isArray(o.confusions) && o.confusions.some(l => l.side === 'toxic'));
        const none = o.safety !== undefined && o.safety !== UNREAD && Array.isArray(o.confusions) && !tox;
        if (!danger.length && !none) return nothing;
        // The verdict's chip on top: the same word and colour as the badge of Alertes and the plant's cards.
        return html`${danger.length ? html`<div class="prudence ${rank(verdict.level) >= rank('danger') ? 'grave' : ''}">
          <p class="verdict">${severityChip(verdict)}</p>
          <ul>${danger.map(d => html`<li data-level=${d.level}>${icon(rank(d.level) >= rank('danger') ? 'exclamation-octagon-fill' : 'exclamation-triangle-fill')}<span>${d.text}</span></li>`)}</ul>
          <p class="small">En cas de doute, ne la consommez pas. ${emergency()}. <span class="src">Anses</span></p>
        </div>` : nothing}${none ? html`<p class="small no-tox">Aucune donnée de toxicité dans nos sources (ANSM, TPPT) : cela ne veut pas dire qu’elle est comestible ni sans danger. En cas de doute, ne la consommez pas.</p>` : nothing}`;
      },
      uses: () => {
        const head = html`<h3>${danger.length ? 'Usages rapportés (non vérifiés, voir Prudence)' : 'Usages rapportés (non vérifiés)'}</h3>`;
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
          ${dishes.length ? html`<p class="small"><b>Plats</b> : ${dishes.map((d, i) => html`${i ? ' · ' : ''}<a href=${safeUrl(d.url) || 'https://www.wikidata.org/wiki/' + d.id} target="_blank" rel="noopener">${d.label}</a>`)}</p>` : nothing}
          ${books.length ? html`<ul class="recipes">${books.map((/** @type {any} */ r) => html`<li>${safeUrl(r.url) ? html`<a href=${safeUrl(r.url)} target="_blank" rel="noopener">${r.title.replace(/^Cookbook:/, '')}</a>` : r.title.replace(/^Cookbook:/, '')} <span class="muted">(${r.lang === 'fr' ? 'Wikibooks' : 'Wikibooks, en anglais'})</span></li>`)}</ul>` : nothing}
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
    const keys = shownSubs(this.#view, 'interactions');
    const roles = data.roles.filter((/** @type {any} */ r) => keys.includes(r.key));
    const style = blockStyle(this.#view, 'interactions');
    const globi = safeUrl(data.url) || 'https://www.globalbioticinteractions.org/';
    const credit = html`<p class="credit">Source : <a href=${globi} target="_blank" rel="noopener">GloBI — Global Biotic Interactions</a> :
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
      ${r.count > 12 ? html`<p class="muted small">Et ${r.count - 12} autres sur <a href=${globi} target="_blank" rel="noopener">GloBI</a>.</p>` : nothing}`)}${credit}`;
  }

  /** « Climat et pollen » (Open-Meteo × GBIF): today's pollen of the plant, its climate niche, my position on it. @param {any} ctx */
  #climate({ plant }) {
    const v = this.#view;
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
        if (!niche?.points?.length) return this._failed.niche || this._failed['details:gbif'] ? head : html`${head}<p class="muted">Pas assez d’occurrences GBIF localisées en France pour situer son climat.</p>`;
        const temps = niche.points.map((/** @type {any} */ p) => p.temp).sort((/** @type {number} */ a, /** @type {number} */ b) => a - b);
        const rains = niche.points.map((/** @type {any} */ p) => p.precip).sort((/** @type {number} */ a, /** @type {number} */ b) => a - b);
        const mine = here?.state === 'done' && here.climate ? { temp: here.climate.annualTemp, precip: here.climate.annualPrecip, label: 'chez vous' } : null;
        const inside = mine && mine.temp >= temps[Math.floor(temps.length * 0.1)] && mine.temp <= temps[Math.ceil(temps.length * 0.9) - 1]
          && mine.precip >= rains[Math.floor(rains.length * 0.1)] && mine.precip <= rains[Math.ceil(rains.length * 0.9) - 1];
        return html`${head}${nicheChart(niche.points, mine)}
          <p class="small">Là où elle a été observée : <strong>${temps[0]} à ${temps[temps.length - 1]} °C</strong> de moyenne annuelle,
            <strong>${rains[0].toLocaleString('fr-FR')} à ${rains[rains.length - 1].toLocaleString('fr-FR')} mm</strong> de pluie par an (${niche.points.length} lieux, cadre : 80 % d’entre eux).
            ${mine ? html`Chez vous : ${mine.temp} °C, ${mine.precip.toLocaleString('fr-FR')} mm — ${inside ? 'dans sa niche' : 'en dehors du cœur de sa niche'}.` : nothing}</p>
          ${this.#altitudes(niche.altitudes, here?.state === 'done' ? here.climate?.elevation : null)}
          ${!mine && !here ? ask('Me situer sur ce graphique') : hereState || nothing}
          ${mine && baseOf(v) !== 'epure' ? html`<details class="here-climate"><summary>Climat chez vous (${here.climate.years})</summary>${climateChart(here.climate.temp, here.climate.precip)}</details>` : nothing}
          <p class="credit">Climat : ERA5 via <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (moyennes ${niche.years}, CC BY 4.0) aux occurrences de <a href=${'https://www.gbif.org/species/' + (this._details?.identifiers?.gbif?.id ?? '')} target="_blank" rel="noopener">GBIF.org</a>.</p>`;
      }
    })}`;
  }

  /**
   * The altitudes where it was observed in France (GBIF), and mine (Open-Meteo's, for my position) beside them.
   * @param {import('../core/open-data.js').Altitudes | null | undefined} a @param {number | null | undefined} mine
   */
  #altitudes(a, mine) {
    if (!a) return nothing;
    const m = (/** @type {number} */ v) => formatAltitude(v);
    const where = typeof mine === 'number' ? (mine >= a.low && mine <= a.high ? 'dans cette tranche' : mine < a.low ? 'plus bas que la plupart' : 'plus haut que la plupart') : '';
    return html`<p class="small">${icon('triangle')} Altitude : le plus souvent <strong>entre ${m(a.low)} et ${m(a.high)}</strong>
      (de ${m(a.min)} à ${m(a.max)} ; ${a.n} des ${a.of} occurrences GBIF la donnent).
      ${where ? html`Chez vous : ${m(/** @type {number} */ (mine))}, ${where}.` : nothing}</p>`;
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
    const ids = shownSubs(this.#view, 'ids').map(k => all[k]).filter(row => row?.[1]);
    const value = (/** @type {any} */ id, /** @type {any} */ url) => url ? html`<a href=${url} target="_blank" rel="noopener">${id}</a>` : id;
    if (blockStyle(this.#view, 'ids') === 'list') return html`<ul class="inline ids">${ids.map(([label, id, url]) => html`<li><span class="muted">${label}</span> ${value(id, url)}</li>`)}</ul>`;
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

  /**
   * ↑ ↓ on a focused grip: one place up or down, saved; the grip keeps the focus, in view (never under the bar stuck
   * above: the sheet's scroll padding, #pad). @param {KeyboardEvent} e @param {string} key
   */
  async #gripKey(e, key) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const order = this.#moved(key, e.key === 'ArrowUp' ? -1 : 1, blockOrder(this.#view).filter(k => !isOnEdge(this.#view, k)));
    if (!order) return;
    setBlockOrder(this.#view, this.#withPinned(this.#view, order));
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
    const hidden = blockOrder(this.#view).filter(k => foldedByHand(this.#view, k) && k !== 'actions');
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
      <article class=${baseOf(this.#view) === 'scientific' ? 'science' : ''}>
        <a class="back link" href=${lastSearchHash()}>${icon('arrow-left')} Recherche</a>
        <gf-add-to .plant=${ctx.plant}></gf-add-to>
        ${this._error ? html`<p class="muted">${this._error}</p>` : nothing}
        ${this.#blocks(ctx)}
      </article>`);
  }
}

customElements.define('gf-plant-detail', GfPlantDetail);
